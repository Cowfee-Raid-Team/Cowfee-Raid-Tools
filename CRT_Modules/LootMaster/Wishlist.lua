local ADDON, CRT = ...

-- Loot Master wishlists: each raider keeps a ranked list of the items they want (Alex, 2026-11-11, Issue #1263),
-- and the loot master and raid assists see it in their loot windows when an item drops. No frames here: the list,
-- its message and who keeps what. The Encounter Journal's right-click menu and the item tooltip line are in
-- LootMaster/WishlistJournal.lua, the My wishlist window in LootMaster/WishlistWindow.lua, the Wishlist column in
-- LootMaster/Window.lua (the Master Loot Window) and RaiderWindow.lua (All Loot Rolls, for assists).
--
-- Your list is saved per character, CRTDBChar.lootmaster.wishlist = { [itemID] = { rank, at = time() } }. Only the
-- item ID is the key: a Journal link carries the difficulty's bonus IDs, and wanting an item means any difficulty.
-- Ranks, best first: big (Big upgrade), small (Small upgrade), off (Off spec).
--
-- Message, on LM.PREFIX (Comm.lua's channel and queue): an older CRT drops a kind it doesn't know.
--   X|<stamp>:<part>/<parts>|<itemID>,<b|s|o>;...   your whole list, packed (Wire.Pack), in as many parts as it takes;
--                                                   a list with no items is one part with no entries (cleared)
--   X|?                                             the loot master (or a leader or assist) asks for everyone's list
-- You send your list a few seconds after it changes (SEND_DELAY, so several clicks go as one), when you join a
-- group, and when someone who may keep lists asks (the loot master asks at each session start, and after a /reload
-- in a group). Never during a boss encounter: it waits for ENCOUNTER_END. Out of a group nothing is sent.
-- Only the loot master (LM:CanLoot), the group leader and raid assists keep the lists they hear (W.Sees), in
-- memory for this login (W.lists): a /reload asks again, so nothing about other players is saved.

local LM = CRT.LootMaster
local Wire = LM.Wire

local W = {}
LM.Wishlist = W

W.RANKS = { "big", "small", "off" } -- best first
W.RANK_ORDER = { big = 3, small = 2, off = 1 } -- the roll windows' tiebreak: higher first
W.RANK_COLOR = { big = "good", small = "warn", off = "muted" } -- theme keys (CRT_Dev/StyleGuide.md)
W.DEFAULT_RANK = "big" -- a tick in the My wishlist window
local TO_WIRE = { big = "b", small = "s", off = "o" }
local FROM_WIRE = { b = "big", s = "small", o = "off" }

W.MAX = 200 -- items on one list (yours, and one heard); a few messages at most
W.MAX_PARTS = 20 -- parts of one list a receiver takes
W.SEND_DELAY = 3 -- seconds after a change before your list goes
W.ASK_SECONDS = 10 -- at most one ask this often

W.TEXT = {
    big = "Big upgrade",
    small = "Small upgrade",
    off = "Off spec",
    notListed = "Not listed",
    notWanted = "Not wanted",
    tooltip = "Wishlist: %s",
    sent = "Sent to the loot master.",
    held = "Will send after the fight.",
    sending = "Sending...",
    solo = "Sends when you join a group.",
    column = "Wishlist",
}
local TEXT = W.TEXT

local function secret(v)
    return issecretvalue ~= nil and issecretvalue(v) or false
end

-- Your list --------------------------------------------------------------------------------------------

-- Your character's list, made when missing.
function W.Store()
    CRTDBChar = type(CRTDBChar) == "table" and CRTDBChar or {}
    local lm = CRTDBChar.lootmaster
    if type(lm) ~= "table" then
        lm = {}
        CRTDBChar.lootmaster = lm
    end
    if type(lm.wishlist) ~= "table" then
        lm.wishlist = {}
    end
    return lm.wishlist
end

-- An item's ID from an item ID, an item string or a link; nil when it doesn't read or is secret.
function W.ItemID(item)
    if item == nil or secret(item) then
        return nil
    end
    local id
    if type(item) == "number" then
        id = item
    elseif type(item) == "string" then
        id = tonumber(item:match("item:(%d+)") or item:match("^%s*(%d+)%s*$"))
    end
    if id and id > 0 and id == math.floor(id) then
        return id
    end
    return nil
end

function W.IsRank(rank)
    return rank ~= nil and W.RANK_ORDER[rank] ~= nil
end

-- Your rank for an item, or nil.
function W.Rank(item)
    local id = W.ItemID(item)
    local e = id and W.Store()[id]
    if type(e) == "table" and W.IsRank(e.rank) then
        return e.rank
    end
    return nil
end

function W.Count()
    local n = 0
    for _, e in pairs(W.Store()) do
        if type(e) == "table" and W.IsRank(e.rank) then
            n = n + 1
        end
    end
    return n
end

-- Your list as { { id, rank, at } }, best rank first, then by item ID.
function W.Items()
    local out = {}
    for id, e in pairs(W.Store()) do
        if type(id) == "number" and type(e) == "table" and W.IsRank(e.rank) then
            out[#out + 1] = { id = id, rank = e.rank, at = e.at }
        end
    end
    table.sort(out, function(a, b)
        if a.rank ~= b.rank then
            return W.RANK_ORDER[a.rank] > W.RANK_ORDER[b.rank]
        end
        return a.id < b.id
    end)
    return out
end

local changed -- set below: a change is told to every window and sent

-- Puts an item on your list at a rank (nil takes it off). Returns whether anything changed. A full list takes
-- no new item.
function W.Set(item, rank)
    local id = W.ItemID(item)
    if not id or (rank ~= nil and not W.IsRank(rank)) then
        return false
    end
    local store = W.Store()
    local before = W.Rank(id)
    if before == rank then
        return false
    end
    if rank == nil then
        store[id] = nil
    else
        if not before and W.Count() >= W.MAX then
            return false
        end
        store[id] = { rank = rank, at = time() }
    end
    changed()
    return true
end

function W.Remove(item)
    return W.Set(item, nil)
end

function W.Label(rank)
    return rank and TEXT[rank] or TEXT.notListed
end

-- A rank as coloured text for a window: its rank's theme colour, or "Not listed" muted.
function W.Cell(rank)
    local UI = CRT.UI
    local text, key = W.Label(rank), W.IsRank(rank) and W.RANK_COLOR[rank] or "muted"
    if UI and UI.ColorText then
        return UI.ColorText(text, key)
    end
    return text
end

-- The message ------------------------------------------------------------------------------------------

local HEAD_PAD = ":00/00" -- the part numbers' place, the same width as the real ones

-- Your list (or items, { { id, rank } }) as X messages for stamp, each 255 bytes or less.
function W.Encode(stamp, items)
    items = items or W.Items()
    local entries = {}
    for _, it in ipairs(items) do
        if TO_WIRE[it.rank] and #entries < W.MAX then
            entries[#entries + 1] = { it.id, TO_WIRE[it.rank] }
        end
    end
    local head = tostring(stamp) .. HEAD_PAD
    local messages = Wire.Pack("X", head, entries)
    if #messages == 0 then
        messages = { "X|" .. head .. "|" }
    end
    local skip = #("X|" .. head) + 1
    for i, text in ipairs(messages) do
        messages[i] = "X|" .. tostring(stamp) .. string.format(":%02d/%02d", i, #messages) .. text:sub(skip)
    end
    return messages
end

-- One part's head: stamp, part, parts; nil when it doesn't read.
function W.ParseHead(field)
    local stamp, i, n = tostring(field or ""):match("^(%x+):(%d+)/(%d+)$")
    i, n = tonumber(i), tonumber(n)
    if not stamp or not i or not n or n < 1 or n > W.MAX_PARTS or i < 1 or i > n then
        return nil
    end
    return stamp, i, n
end

-- The items of a list's parts joined: { [itemID] = rank }. Entries that don't read are left out.
function W.Decode(parts)
    local items, n = {}, 0
    for _, field in ipairs(parts) do
        for _, e in ipairs(Wire.Unpack(field)) do
            local id, rank = W.ItemID(tonumber(e[1])), FROM_WIRE[e[2] or ""]
            if id and rank and not items[id] and n < W.MAX then
                items[id] = rank
                n = n + 1
            end
        end
    end
    return items
end

-- Who keeps lists ----------------------------------------------------------------------------------------

local function isTrue(v)
    return not secret(v) and v == true
end

-- Whether a group member (a unit) leads the group or is a raid assist.
local function leads(unit)
    if not unit then
        return false
    end
    return isTrue(UnitIsGroupLeader(unit)) or (IsInRaid() and UnitIsGroupAssistant ~= nil and isTrue(UnitIsGroupAssistant(unit)))
end

-- Whether you keep the lists you hear: the loot master, the group leader or a raid assist.
function W.Sees()
    if LM:CanLoot() then
        return true
    end
    return IsInGroup() and leads("player") or false
end

-- Whether a player may ask for everyone's list: one who may run loot, the leader or an assist.
local function mayAsk(name)
    return LM.Allowed(name) or leads(LM.UnitOf(name))
end

-- The lists heard: { [Name-Realm] = { items = { [itemID] = rank }, at } } (this login only).
W.lists = {}

-- A player's rank for an item: yours from your own list, another's from the list they sent; nil when none.
function W.RankFor(name, item)
    if name == nil then
        return nil
    end
    if name == LM:Me() then
        return W.Rank(item)
    end
    local id, list = W.ItemID(item), W.lists[name]
    return id and list and list.items[id] or nil
end

function W.Order(rank)
    return rank and W.RANK_ORDER[rank] or 0
end

-- Receiving ----------------------------------------------------------------------------------------------

local partsIn = {} -- [sender] = { stamp, n, parts = { [i] = field } }

local ask -- set below
local queue -- set below

LM.Handle("X", function(f, sender)
    if not sender then
        return
    end
    if f[1] == "?" then
        if sender ~= LM:Me() and mayAsk(sender) then
            queue(true)
        end
        return
    end
    if not W.Sees() then
        partsIn[sender] = nil
        return -- only the loot master, the leader and assists keep lists
    end
    local stamp, i, n = W.ParseHead(f[1])
    if not stamp then
        return
    end
    local p = partsIn[sender]
    if not p or p.stamp ~= stamp or p.n ~= n then
        p = { stamp = stamp, n = n, parts = {} }
        partsIn[sender] = p
    end
    p.parts[i] = f[2] or ""
    for k = 1, n do
        if not p.parts[k] then
            return
        end
    end
    partsIn[sender] = nil
    W.lists[sender] = { items = W.Decode(p.parts), at = time() }
    LM:Fire("wishlist", sender)
end)

-- Sending ------------------------------------------------------------------------------------------------

local pending, timerSet, inEncounter = false, false, false
local stampN = 0
local lastSentCount -- how many items your last list sent had (nil before the first)
local lastAsk, askPending = nil, false
W.status = "solo" -- "solo", "sending", "held" or "sent", for the window's line

local function held()
    return inEncounter or LM.ChatLocked()
end

local function sendNow(force)
    timerSet = false
    if not pending then
        return
    end
    if not IsInGroup() then
        pending = false
        W.status = "solo"
        LM:Fire("wishlist")
        return
    end
    if held() then
        W.status = "held" -- sent at ENCOUNTER_END
        LM:Fire("wishlist")
        return
    end
    pending = false
    local items = W.Items()
    if #items == 0 and not force and (lastSentCount or 0) == 0 then
        W.status = "sent" -- nothing to say: an empty list was never sent anything else
        LM:Fire("wishlist")
        return
    end
    stampN = (stampN % 0xFFFF) + 1
    for _, text in ipairs(W.Encode(string.format("%x", stampN), items)) do
        LM.SendText(text)
    end
    lastSentCount = #items
    W.status = "sent"
    LM:Fire("wishlist")
end

-- Your list goes SEND_DELAY seconds from now (more changes meanwhile go with it), or after the encounter.
-- force: sent even when empty (an ask: the asker learns you have none).
queue = function(force)
    if force then
        pending = "force"
    elseif pending ~= "force" then
        pending = true
    end
    if not IsInGroup() then
        W.status = "solo"
        pending = false
        return
    end
    W.status = held() and "held" or "sending"
    if timerSet then
        return
    end
    timerSet = true
    C_Timer.After(W.SEND_DELAY, function()
        sendNow(pending == "force")
    end)
end
W.Queue = queue

-- Asks the group for everyone's list (the loot master at a session start; a leader or assist after a /reload),
-- at most once every ASK_SECONDS; during an encounter it waits for its end.
ask = function()
    if not (IsInGroup() and W.Sees()) then
        return false
    end
    if held() then
        askPending = true
        return false
    end
    if lastAsk and GetTime() - lastAsk < W.ASK_SECONDS then
        return false
    end
    lastAsk, askPending = GetTime(), false
    LM.SendText(Wire.Encode("X", { "?" }))
    return true
end
W.Ask = ask

changed = function()
    LM:Fire("wishlist")
    queue(false)
end

-- The window's status line.
function W.StatusText()
    return TEXT[W.status] or TEXT.solo
end

-- Whether your list waits to go (for tests).
function W.Pending()
    return pending and true or false
end

-- Events -------------------------------------------------------------------------------------------------

LM:OnChange(function(what)
    if what == "started" then
        ask() -- a session starts (or comes back after a /reload): everyone sends their list
    end
end)

local wasInGroup = false
local events = CreateFrame("Frame")
for _, e in ipairs({ "ENCOUNTER_START", "ENCOUNTER_END", "GROUP_ROSTER_UPDATE", "PLAYER_LOGIN" }) do
    events:RegisterEvent(e)
end
events:SetScript("OnEvent", function(_, event)
    if event == "ENCOUNTER_START" then
        inEncounter = true
        if pending then
            W.status = "held"
            LM:Fire("wishlist")
        end
    elseif event == "ENCOUNTER_END" then
        inEncounter = false
        if pending then
            queue(pending == "force")
        end
        if askPending then
            ask()
        end
    elseif event == "GROUP_ROSTER_UPDATE" then
        local now = IsInGroup() and true or false
        if now and not wasInGroup then
            if W.Count() > 0 then
                queue(false) -- joined a group: your list goes
            end
            ask() -- a leader or assist who joins asks
        elseif not now then
            W.lists, partsIn = {}, {}
            lastSentCount = nil
            W.status = "solo"
            LM:Fire("wishlist")
        end
        wasInGroup = now
    elseif event == "PLAYER_LOGIN" then
        wasInGroup = IsInGroup() and true or false
        if wasInGroup then
            C_Timer.After(W.SEND_DELAY, function()
                ask() -- a /reload in a group: lists heard before are gone, so ask again
            end)
        end
    end
end)

-- /crt wishlist (CRT_Core/Slash.lua's registry); the window is LootMaster/WishlistWindow.lua.
if CRT.Slash then
    CRT.Slash:Register("wishlist", {
        run = function()
            if LM.ShowWishlist then
                LM:ShowWishlist()
            end
            return true
        end,
        help = { "[/crt wishlist] - open your loot wishlist: the items you want, ranked, for the loot master" },
    })
end
