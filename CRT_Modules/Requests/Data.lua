local ADDON, CRT = ...

-- Requests: the raid leader or an assist asks the group who needs an item (Alex, 2026-10-22: "who needs a
-- vantus rune ... so I can see who needs one faster than asking in raid chat"), raiders with CRT answer from
-- a small popup (Requests/Popup.lua), and the page (Requests/Page.lua) lists the answers with a Trade 1
-- button for each player who needs one, through Loot Master's one-copy trade (LM:TradeOne, LootMaster/Trade.lua).
-- Any item you can still trade. No frames here.
--
-- Messages go on Loot Master's prefix (LM.PREFIX), through its queue (LM.SendText: the throttle, and the
-- encounter's chat lockdown holds them), as "<kind>|<fields>" (LM.Wire):
--   N ask    <request id>|<version>|<item string>        from the raid leader or an assist
--   W answer <request id>|<1 need one, 0 no thanks>|<version>   from a raider, for the asker
--   Z close  <request id>                                 from the asker
-- version is R.VERSION, "<major>[.<minor>]": a receiver skips a higher major version and reads a later minor
-- one, leaving any fields after the ones it knows. A CRT from before Requests has no handler for N, W or Z and
-- drops them without a word (LootMaster/Comm.lua's receive).
-- Who may ask: the raid leader or an assist (UnitIsGroupLeader, UnitIsGroupAssistant, which is false in a
-- party and may be secret: secret is no); anyone out of a group, where the messages go straight back to you,
-- to try it. A raider takes an ask only from one of those, one at a time per asker (a newer ask replaces the
-- older one), and in a group not from themselves. The asker takes an answer only for the open request and only
-- from a group member.
-- Nothing is saved: the open request (R.open) and the asks waiting for your answer (R.incoming) are in memory,
-- so a /reload closes them.
--
-- From the game (checked 2026-10-22 on warcraft.wiki.gg): UnitIsGroupAssistant(unit) is true for a player
-- promoted to assistant, false for the leader (https://warcraft.wiki.gg/wiki/API_UnitIsGroupAssistant, marked
-- SecretWhenUnitIdentityRestricted); UnitIsGroupLeader(unit).

local LM = CRT.LootMaster
local Wire = LM.Wire

local R = { listeners = {}, incoming = {} }
CRT.Requests = R

R.VERSION = "1"
R.LABEL = "Requests" -- starts the trade's chat lines
R.KIND = { ask = "N", answer = "W", close = "Z" }
R.NEED, R.NO = "need", "no"

local TEXT = {
    status = "Asked %s ago. %s, %s, %s.",
    need = { "%d needs one", "%d need one" },
    no = { "%d said no", "%d said no" },
    waiting = { "%d hasn't answered", "%d haven't answered" },
}

local function secret(v)
    return issecretvalue and issecretvalue(v) or false
end

-- Listeners: fn(what), what is "open" (the asker's request), "answers" or "incoming" (an ask for you).
function R:OnChange(fn)
    self.listeners[#self.listeners + 1] = fn
end

function R:Fire(what)
    for _, fn in ipairs(self.listeners) do
        local ok, err = pcall(fn, what)
        if not ok then
            geterrorhandler()(err)
        end
    end
end

-- Whether a group member (a unit) leads: the leader, or an assist in a raid. Secret or unreadable is no.
local function leads(unit)
    local okL, leader = pcall(UnitIsGroupLeader, unit)
    if okL and not secret(leader) and leader == true then
        return true
    end
    if IsInRaid() and UnitIsGroupAssistant then
        local okA, assistant = pcall(UnitIsGroupAssistant, unit)
        return okA and not secret(assistant) and assistant == true
    end
    return false
end

function R:CanAsk()
    if not IsInGroup() then
        return true -- alone: a test with yourself
    end
    return leads("player")
end

-- The item string of a link (or an item string).
local function itemStringOf(link)
    return type(link) == "string" and not secret(link) and link:match("item:[%-%d:]+") or nil
end
R.ItemString = itemStringOf

-- The item's link, once the game has it (C_Item.GetItemInfo's second return), else nil; an item not loaded
-- yet fires "incoming" when it is.
function R.LinkOf(itemString)
    local ok, _, link = pcall(C_Item.GetItemInfo, itemString or "")
    if ok and type(link) == "string" and not secret(link) then
        return link
    end
    local id = tonumber((itemString or ""):match("item:(%d+)"))
    if id and Item and Item.CreateFromItemID then
        local item = Item:CreateFromItemID(id)
        if item and not item:IsItemDataCached() then
            item:ContinueOnItemLoad(function()
                R:Fire("incoming")
            end)
        end
    end
    return nil
end

-- How many copies of the item you have in your bags (LM.ItemKey: its item ID and bonus IDs).
function R.Have(itemString)
    return CRT.Bags.Count(LM.ItemKey(itemString), LM.ItemKey)
end

local function send(kind, fields)
    LM.SendText(Wire.Encode(kind, fields))
end

-- The asker ----------------------------------------------------------------------------------------------------

-- Asks the group about the item (a link or item string). Returns the open request, or nil and why: "lead"
-- (you can't ask), "locked" (a boss encounter holds chat: red error text says so), "item".
function R:Ask(link)
    if not self:CanAsk() then
        return nil, "lead"
    end
    if LM.ChatLocked() then
        LM.ShowError(LM.LOCKDOWN_ERROR)
        return nil, "locked"
    end
    local itemString = itemStringOf(link)
    if not itemString then
        return nil, "item"
    end
    if self.open then
        self:Close()
    end
    local id = string.format("%x", (time() % 0xFFFFFF)) .. string.format("%02x", math.random(0, 255))
    self.open = {
        id = id, itemString = itemString, link = (type(link) == "string" and link:find("|H", 1, true)) and link or R.LinkOf(itemString),
        askedAt = GetTime(), answers = {}, given = {},
    }
    send(R.KIND.ask, { id, R.VERSION, itemString })
    self:Fire("open")
    return self.open
end

function R:Close()
    local open = self.open
    if not open then
        return
    end
    self.open = nil
    send(R.KIND.close, { open.id })
    self:Fire("open")
end

-- A trade with the player completed with the item in it.
function R:Given(name)
    local open = self.open
    if open then
        open.given[name] = (open.given[name] or 0) + 1
        self:Fire("answers")
    end
end

-- Trade 1: one copy to a player who needs one and hasn't been given one, while you have one. Returns true when
-- the trade was asked for (they and you still press Trade).
function R:Trade(name)
    local open = self.open
    if not (open and open.answers[name] == R.NEED and (open.given[name] or 0) == 0) then
        return false
    end
    if R.Have(open.itemString) < 1 then
        return false
    end
    return LM:TradeOne(name, open.itemString, open.link, {
        label = R.LABEL,
        done = function(who)
            if R.open == open then
                R:Given(who)
            end
        end,
    })
end

-- The list: everyone in the group (you too when alone, but not in a group) and anyone who answered,
-- { name, answer (R.NEED, R.NO or nil), given }, who needs one first (not given yet before given), then no
-- answer, then no thanks; by name within each.
local ORDER = { [R.NEED] = 1, none = 2, [R.NO] = 3 }

function R:Rows()
    local open = self.open
    local rows, seen = {}, {}
    local me = LM:Me()
    local function add(name)
        if name and not seen[name] and (name ~= me or not IsInGroup()) then
            seen[name] = true
            rows[#rows + 1] = { name = name, answer = open and open.answers[name] or nil, given = open and open.given[name] or 0 }
        end
    end
    for _, name in ipairs(LM:Roster()) do
        add(name)
    end
    for name in pairs(open and open.answers or {}) do
        add(name)
    end
    table.sort(rows, function(a, b)
        local oa, ob = ORDER[a.answer or "none"], ORDER[b.answer or "none"]
        if oa ~= ob then
            return oa < ob
        end
        if (a.given > 0) ~= (b.given > 0) then
            return b.given > 0
        end
        return a.name < b.name
    end)
    return rows
end

-- How many need one, said no and haven't answered.
function R.Counts(rows)
    local need, no, waiting = 0, 0, 0
    for _, r in ipairs(rows) do
        if r.answer == R.NEED then
            need = need + 1
        elseif r.answer == R.NO then
            no = no + 1
        else
            waiting = waiting + 1
        end
    end
    return need, no, waiting
end

local function count(forms, n)
    return (n == 1 and forms[1] or forms[2]):format(n)
end

-- "Asked 0:42 ago. 9 need one, 6 said no, 5 haven't answered." Pure.
function R.StatusText(seconds, need, no, waiting)
    seconds = math.max(0, math.floor(seconds or 0))
    local ago = string.format("%d:%02d", math.floor(seconds / 60), seconds % 60)
    return TEXT.status:format(ago, count(TEXT.need, need), count(TEXT.no, no), count(TEXT.waiting, waiting))
end

-- The raider ---------------------------------------------------------------------------------------------------

-- The ask waiting for your answer, the oldest first: { id, itemString, from, at }, or nil.
function R:Waiting()
    local first
    for _, inc in pairs(self.incoming) do
        if not first or inc.at < first.at or (inc.at == first.at and inc.from < first.from) then
            first = inc
        end
    end
    return first
end

-- Your answer to the ask from that asker (need: true for Need one).
function R:Answer(from, need)
    local inc = self.incoming[from]
    if not inc then
        return
    end
    self.incoming[from] = nil
    send(R.KIND.answer, { inc.id, need and 1 or 0, R.VERSION })
    self:Fire("incoming")
end

-- The popup closed without an answer: the ask is dropped, nothing is sent.
function R:Dismiss(from)
    if self.incoming[from] then
        self.incoming[from] = nil
        self:Fire("incoming")
    end
end

-- Receiving ----------------------------------------------------------------------------------------------------

-- Whether a message's version can be read here: the same major version or an older one.
local function readable(version)
    local major = tonumber(tostring(version or ""):match("^(%d+)"))
    local mine = tonumber(R.VERSION:match("^(%d+)"))
    return major ~= nil and major <= mine
end

-- Whether the sender may ask: in a group a member who leads, never yourself; alone only yourself.
local function mayAsk(sender)
    local me = LM:Me()
    if not IsInGroup() then
        return sender == me
    end
    if sender == me then
        return false
    end
    local unit = LM.UnitOf(sender)
    return unit ~= nil and leads(unit)
end

LM.Handle(R.KIND.ask, function(f, sender)
    local id, itemString = f[1], itemStringOf(f[3])
    if not (id and id ~= "" and itemString and readable(f[2]) and mayAsk(sender)) then
        return
    end
    R.incoming[sender] = { id = id, itemString = itemString, from = sender, at = GetTime() }
    R:Fire("incoming")
end)

LM.Handle(R.KIND.answer, function(f, sender)
    local open = R.open
    if not (open and f[1] == open.id and readable(f[3]) and sender and LM.UnitOf(sender)) then
        return
    end
    local answer = (f[2] == "1" and R.NEED) or (f[2] == "0" and R.NO) or nil
    if answer then
        open.answers[sender] = answer
        R:Fire("answers")
    end
end)

LM.Handle(R.KIND.close, function(f, sender)
    local inc = R.incoming[sender]
    if inc and inc.id == f[1] then
        R.incoming[sender] = nil
        R:Fire("incoming")
    end
end)
