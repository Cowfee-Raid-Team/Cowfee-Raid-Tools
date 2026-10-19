local ADDON, CRT = ...

-- Loot Master over addon messages: the looter's running session (LM.current) and, on every raider's
-- computer, the session they were sent (LM.incoming). The message kinds are listed in Data.lua.
-- Raid messages come back to the sender too, so the looter also gets the raider popup, like everyone.
-- Out of a group, or to yourself, a message is handed straight to the receiver here (the game sends
-- nothing then), so a test works alone.
-- Raiders accept a session only from the raid leader (or themselves). Nothing here passes a Blizzard
-- roll or trades: those come in later steps, behind their own checks.

local LM = CRT.LootMaster
local Session, Wire = LM.Session, LM.Wire

local RESULT = Enum and Enum.SendAddonMessageResult or {}
local SUCCESS = RESULT.Success or 0
local THROTTLED = RESULT.AddonMessageThrottle or 3
local TICK = 1 -- seconds between timeout checks

if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then
    C_ChatInfo.RegisterAddonMessagePrefix(LM.PREFIX)
end

-- Names ----------------------------------------------------------------------------------------------

local function realm()
    return (GetNormalizedRealmName and GetNormalizedRealmName()) or ""
end

-- A full "Name-Realm"; the game leaves the realm off names from your own realm.
local function full(name)
    if type(name) ~= "string" or name == "" then
        return nil
    end
    if not name:find("-", 1, true) then
        name = name .. "-" .. realm()
    end
    return name
end
LM.FullName = full

function LM:Me()
    local name = UnitName("player")
    return full(name)
end

-- The unit token of a group member by full name, or nil.
local function unitOf(name)
    if name == LM:Me() then
        return "player"
    end
    local prefix, n = IsInRaid() and "raid" or "party", IsInRaid() and GetNumGroupMembers() or GetNumSubgroupMembers()
    for i = 1, n do
        local unit = prefix .. i
        local un, ur = UnitName(unit)
        if un and full(ur and ur ~= "" and (un .. "-" .. ur) or un) == name then
            return unit
        end
    end
    return nil
end
LM.UnitOf = unitOf

-- Everyone in the group, you included.
function LM:Roster()
    local out = { self:Me() }
    if IsInRaid() then
        for i = 1, GetNumGroupMembers() do
            local name = GetRaidRosterInfo(i)
            name = full(name)
            if name and name ~= out[1] then
                out[#out + 1] = name
            end
        end
    elseif IsInGroup() then
        for i = 1, GetNumSubgroupMembers() do
            local un, ur = UnitName("party" .. i)
            local name = un and full(ur and ur ~= "" and (un .. "-" .. ur) or un)
            if name then
                out[#out + 1] = name
            end
        end
    end
    return out
end

-- Sending --------------------------------------------------------------------------------------------

local function channel()
    if IsInGroup(LE_PARTY_CATEGORY_INSTANCE) then
        return "INSTANCE_CHAT"
    elseif IsInRaid() then
        return "RAID"
    elseif IsInGroup() then
        return "PARTY"
    end
    return nil
end

local queue = {}
local sending = false
local receive -- set below

local function pump()
    while queue[1] do
        local m = queue[1]
        local ch = m.target and "WHISPER" or channel()
        if not ch then
            table.remove(queue, 1) -- left the group: the message has no one to go to
        else
            local ok, result = pcall(C_ChatInfo.SendAddonMessage, LM.PREFIX, m.text, ch, m.target)
            if ok and result == THROTTLED then
                C_Timer.After(1, pump)
                return
            end
            if not ok or not (result == nil or result == true or result == SUCCESS) then
                CRT:Print("Loot Master: a message could not be sent (" .. tostring(result) .. ").")
            end
            table.remove(queue, 1)
        end
    end
    sending = false
end

-- Sends to the group, or to one player (target, a full name). To yourself, or with no group, it is
-- handed straight to receive().
local function send(kind, fields, target)
    local text = Wire.Encode(kind, fields)
    if (target and target == LM:Me()) or (not target and not channel()) then
        receive(text, LM:Me())
        return
    end
    queue[#queue + 1] = { text = text, target = target }
    if not sending then
        sending = true
        pump()
    end
end
LM.Send = send

-- The looter -----------------------------------------------------------------------------------------

local ticker

local function stopTicker()
    if ticker then
        ticker:Cancel()
        ticker = nil
    end
end

-- The session to one player (target) or the group: S, then its response buttons (B), then its items (I).
local function sendSession(s, target)
    send("S", { s.id, s.test and 1 or 0, #s.items, LM.VERSION, s.seconds, #s.responses, s.autoPass and 1 or 0 }, target)
    for i, r in ipairs(s.responses) do
        send("B", { s.id, i, r.key, Wire.Color(r.color), r.weight, r.icon or "", r.label }, target)
    end
    for i, it in ipairs(s.items) do
        send("I", { s.id, i, it.ilvl and math.floor(it.ilvl + 0.5) or "", it.itemString }, target)
    end
end

-- Whether you may run a session: the raid leader, or anyone out of a group (to test alone).
function LM:CanLoot()
    return not IsInGroup() or UnitIsGroupLeader("player")
end

-- items: { { itemString, link, ilvl } }. test marks it as a test everywhere.
function LM:Start(items, test)
    if not self:CanLoot() then
        CRT:Print("Loot Master: only the raid leader can start a loot session.")
        return nil
    end
    local id = string.format("%x", (time() % 0xFFFFFF)) .. string.format("%02x", math.random(0, 255))
    local s = Session.New({ id = id, test = test, leader = self:Me(), items = items })
    s.autoPass = self:Settings().autoPass ~= false
    s:Expect(self:Roster())
    self.current = s
    stopTicker()
    sendSession(s)
    C_Timer.After(LM.HELLO_SECONDS, function()
        if self.current == s then
            s:MarkNoCRT()
            self:Fire("session")
        end
    end)
    ticker = C_Timer.NewTicker(TICK, function()
        if self.current ~= s then
            stopTicker()
        elseif s:Tick() then
            self:Fire("session")
        end
    end)
    self:Fire("started", s)
    return s
end

-- The award message ------------------------------------------------------------------------------------

-- Where the award message goes (Settings): a chat type, "CHANNEL:<name>" for a chat channel you have
-- joined, "SELF" (only you) or "NONE". When the place isn't open to you (RAID out of a raid, GUILD with no
-- guild, a channel you left, chat locked during an encounter) it is shown only to you, saying why.
local CHAT = (C_ChatInfo and C_ChatInfo.SendChatMessage) or SendChatMessage
local COMMUNITY_CHANNEL -- set with the guild channel code below

local function where(channel)
    if channel == "NONE" then
        return nil
    elseif channel == "RAID" or channel == "RAID_WARNING" then
        return IsInRaid() and channel or nil, "you are not in a raid"
    elseif channel == "PARTY" then
        return IsInGroup() and "PARTY" or nil, "you are not in a group"
    elseif channel == "GUILD" or channel == "OFFICER" then
        return IsInGuild() and channel or nil, "you are not in a guild"
    elseif type(channel) == "string" and channel:find("^CHANNEL:") then
        local id = GetChannelName(channel:sub(9))
        return (id and id > 0) and "CHANNEL" or nil, "you are not in that channel", id
    elseif type(channel) == "string" and channel:find("^COMMUNITY:") then
        local club, stream = channel:match("^COMMUNITY:([^:]+):([^:]+)$")
        local id = club and GetChannelName(COMMUNITY_CHANNEL:format(club, stream))
        if not (id and id > 0) then
            LM.JoinStream(channel) -- joined now, ready for the next award
        end
        return (id and id > 0) and "CHANNEL" or nil, "joining the guild channel, the next award goes there", id
    end
    return nil
end

-- Guild channels ---------------------------------------------------------------------------------------

-- A guild's channels (the Guild & Communities window's streams) can't be posted to by an addon directly
-- (C_Club.SendMessage is protected since 8.1). Once added to chat (C_Club.AddClubStreamChatChannel, what
-- "Add to Chat Window" does), a stream is a chat channel named "Community:<clubId>:<streamId>"
-- (Blizzard's ChatFrameUtil.GetCommunitiesChannelName), and a click can post to it as CHANNEL.
COMMUNITY_CHANNEL = "Community:%s:%s" -- the local declared above where()

-- The guild's channels other than Guild and Officer (those are chat types already):
-- { { key = "COMMUNITY:<club>:<stream>", name } }. Empty with no guild, or while chat is locked.
function LM.GuildStreams()
    local out = {}
    if not (C_Club and C_Club.GetGuildClubId and C_Club.GetStreams) then
        return out
    end
    local ok, club = pcall(C_Club.GetGuildClubId)
    if not ok or not club then
        return out
    end
    local ok2, streams = pcall(C_Club.GetStreams, club)
    if not ok2 or type(streams) ~= "table" then
        return out
    end
    local skip = Enum and Enum.ClubStreamType or {}
    for _, st in ipairs(streams) do
        if st.streamType ~= skip.Guild and st.streamType ~= skip.Officer and type(st.name) == "string" then
            out[#out + 1] = { key = "COMMUNITY:" .. tostring(club) .. ":" .. tostring(st.streamId), name = st.name }
        end
    end
    return out
end

-- Joins a guild channel as a chat channel, so awards can be posted to it.
function LM.JoinStream(key)
    local club, stream = tostring(key or ""):match("^COMMUNITY:([^:]+):([^:]+)$")
    if club and C_Club and C_Club.AddClubStreamChatChannel then
        pcall(C_Club.AddClubStreamChatChannel, club, stream)
    end
end

function LM:AwardText(s, index, name, response)
    local it = s.items[index]
    local _, link = C_Item.GetItemInfo(it.itemString or "")
    local r = s:Response(response)
    local p = s.players[name]
    local a = p and p.answers[index]
    local set = self:Settings()
    return LM.FormatAward(set.awardMessage, {
        item = it.link or link or it.itemString, player = Ambiguate(name, "short"),
        response = r and r.label or response, roll = a and a.roll, noRoll = set.noRoll,
    })
end

function LM:Announce(text, test)
    local channel = self:Settings().awardChannel or "RAID"
    if channel == "NONE" then
        return
    end
    if test then
        CRT:Print("Loot Master (test, only you see this): " .. text)
        return
    end
    if channel == "SELF" then
        CRT:Print(text)
        return
    end
    local chatType, why, target = where(channel)
    if chatType and C_ChatInfo and C_ChatInfo.InChatMessagingLockdown and C_ChatInfo.InChatMessagingLockdown() then
        chatType, why = nil, "chat is locked during the encounter"
    end
    if not chatType then
        CRT:Print(text .. "  |cff999999(only you: " .. (why or "no channel") .. ")|r")
        return
    end
    local ok, err = pcall(CHAT, text, chatType, nil, target)
    if not ok then
        CRT:Print(text .. "  |cff999999(only you: " .. tostring(err) .. ")|r")
    end
end

function LM:Award(index, name, response)
    local s = self.current
    if not s then
        return
    end
    s:Award(index, name, response)
    send("A", { s.id, index, name, response })
    self:Announce(self:AwardText(s, index, name, response), s.test)
    self:Fire("session")
end

-- Shows the popup again for these players (a popup that didn't load, or ran out of time): they are sent
-- the whole session again, then told which item to answer.
function LM:Resend(index, names)
    local s = self.current
    if not s then
        return 0
    end
    local n = 0
    for _, name in ipairs(names) do
        if s:CanResend(name) then
            s:Clear(name, index)
            sendSession(s, name)
            send("Q", { s.id, index }, name)
            n = n + 1
        end
    end
    self:Fire("session")
    return n
end

function LM:AskReroll(index, names)
    local s = self.current
    if not s then
        return 0
    end
    local n = 0
    for _, name in ipairs(names) do
        if s:AskReroll(name, index) then
            send("X", { s.id, index }, name)
            n = n + 1
        end
    end
    self:Fire("session")
    return n
end

function LM:ClearAnswer(index, name)
    local s = self.current
    if s then
        s:Clear(name, index)
        send("Q", { s.id, index }, name)
        self:Fire("session")
    end
end

function LM:End()
    local s = self.current
    if not s then
        return
    end
    send("E", { s.id })
    self.current = nil
    stopTicker()
    self:Fire("ended", s)
end

-- The raider -----------------------------------------------------------------------------------------

local pendingRolls = {} -- item indexes waiting for your next /roll result, oldest first

-- Your answer for an item: sends it to the looter and, unless it is a pass, does a real /roll whose
-- result is sent when it shows in chat. Called from a button click.
function LM:Answer(index, response, note)
    local inc = self.incoming
    if not inc or not inc.items[index] then
        return
    end
    if inc.mine[index] and inc.mine[index].auto then
        return -- answered for you because your specs can't use it: you can see it, not answer it
    end
    local mine = inc.mine[index] or {}
    inc.mine[index] = mine
    mine.response, mine.note = response, note
    local gear = self:MyGear(inc.items[index].itemString)
    local _, classFile = UnitClass("player")
    send("R", { inc.id, index, response, self:MyRole(), classFile or "", self:MyItemLevel(),
        Wire.GearText(gear[1]), Wire.GearText(gear[2]), "", "", note or "" }, inc.leader)
    if response ~= "pass" and not mine.rolled then
        self:RollFor(index)
    end
    self:Fire("incoming")
end

-- A real /roll for an item. The result is matched to the item when it shows in chat.
function LM:RollFor(index)
    local inc = self.incoming
    if not inc then
        return
    end
    pendingRolls[#pendingRolls + 1] = index
    RandomRoll(1, 100)
end

-- The game's own "%s rolls %d (%d-%d)", so this follows the client's language.
local rollPattern
function LM.ReadRoll(text)
    if not rollPattern then
        local f = RANDOM_ROLL_RESULT or "%s rolls %d (%d-%d)"
        rollPattern = "^" .. f:gsub("[%(%)%.%-%+%*%?%[%]%^%$]", "%%%0"):gsub("%%s", "(.+)"):gsub("%%d", "(%%d+)") .. "$"
    end
    local who, roll, low, high = tostring(text or ""):match(rollPattern)
    return who, tonumber(roll), tonumber(low), tonumber(high)
end

local function ownRoll(text)
    local who, roll, low, high = LM.ReadRoll(text)
    if not who or low ~= 1 or high ~= 100 or (who ~= UnitName("player") and full(who) ~= LM:Me()) then
        return
    end
    local index = table.remove(pendingRolls, 1)
    local inc = LM.incoming
    if not (index and inc) then
        return
    end
    local mine = inc.mine[index] or {}
    inc.mine[index] = mine
    mine.roll, mine.rolled, mine.reroll = roll, true, nil
    send("L", { inc.id, index, roll }, inc.leader)
    LM:Fire("incoming")
end

-- Receiving ------------------------------------------------------------------------------------------

-- Items your specs can't use ------------------------------------------------------------------------------

LM.SPEC_WAIT = 2 -- seconds to wait for an item to load; one that isn't loaded by then is shown

function LM.ParseSpecs(text)
    local out = {}
    for id in tostring(text or ""):gmatch("%d+") do
        out[#out + 1] = tonumber(id)
    end
    return #out > 0 and out or nil
end

-- Your class's specs: { [specID] = true }.
local function mySpecs()
    local out = {}
    for i = 1, (GetNumSpecializations and GetNumSpecializations() or 0) do
        local ok, id = pcall(GetSpecializationInfo, i)
        if ok and type(id) == "number" then
            out[id] = true
        end
    end
    return out
end

-- Answers one item for you when your specs can't use it (LM.SpecVerdict); else leaves it alone.
local function judge(inc, index, loaded)
    local it = inc.items[index]
    if not it or LM.incoming ~= inc or (inc.mine[index] and inc.mine[index].response) then
        return
    end
    local ok, specs = pcall(C_Item.GetItemSpecInfo, it.itemString)
    if not ok or (issecretvalue and issecretvalue(specs)) then
        return
    end
    if LM.SpecVerdict(specs, mySpecs(), loaded) ~= "auto" then
        return
    end
    local response = inc.byKey.tmog and "tmog" or "pass"
    local gear = LM:MyGear(it.itemString)
    local _, classFile = UnitClass("player")
    -- hidden, unless you chose to see every item; either way you can see it but not answer it
    inc.mine[index] = { response = response, auto = true, autoSpecs = specs, closed = not LM:Settings().showAllItems }
    send("R", { inc.id, index, response, LM:MyRole(), classFile or "", LM:MyItemLevel(),
        Wire.GearText(gear[1]), Wire.GearText(gear[2]), "1", table.concat(specs, ","), "" }, inc.leader)
end

-- Checks every item of a session, then calls done once: when all are judged, or after SPEC_WAIT.
-- Off when the leader turned it off. "Show me every item anyway" only shows them: you still can't answer.
function LM:CheckSpecs(inc, done)
    local finished = false
    local function finish()
        if not finished then
            finished = true
            done()
        end
    end
    if not inc.autoPass or not (C_Item and C_Item.GetItemSpecInfo) then
        finish()
        return
    end
    local waiting = 0
    for index, it in pairs(inc.items) do
        local id = tonumber((it.itemString or ""):match("item:(%d+)"))
        local item = id and Item:CreateFromItemID(id)
        if item and item:IsItemDataCached() then
            judge(inc, index, true)
        elseif item then
            waiting = waiting + 1
            item:ContinueOnItemLoad(function()
                if not finished then
                    judge(inc, index, true)
                    waiting = waiting - 1
                    if waiting == 0 then
                        finish()
                    end
                end
            end)
        end
    end
    if waiting == 0 then
        finish()
    else
        C_Timer.After(LM.SPEC_WAIT, finish) -- not loaded in time: shown as normal
    end
end

-- Shows the items that were answered for you, to look at (their buttons stay off).
function LM:ShowAutoItems()
    local inc = self.incoming
    if not inc then
        return
    end
    for _, mine in pairs(inc.mine) do
        if mine.auto then
            mine.closed = nil
        end
    end
    self:Fire("incoming", "shown")
end

local function fromLeader(sender)
    if sender == LM:Me() then
        return true
    end
    local unit = unitOf(sender)
    return unit and UnitIsGroupLeader(unit) or false
end

local HANDLERS = {}

-- S: a session starts (or is sent again): id, test, item count, version, seconds to answer, button count,
-- whether items a raider's specs can't use are answered for them.
HANDLERS.S = function(f, sender)
    if not fromLeader(sender) then
        return
    end
    local id = f[1]
    local inc = LM.incoming
    if not inc or inc.id ~= id then
        inc = {
            id = id, test = f[2] == "1", n = tonumber(f[3]) or 0, leader = sender, items = {}, mine = {}, got = 0,
            seconds = tonumber(f[5]) or 60, nResponses = tonumber(f[6]) or 0, responses = {}, byKey = {},
            autoPass = f[7] == "1",
        }
        LM.incoming = inc
        wipe(pendingRolls)
    end
    send("K", { id, LM.VERSION }, sender)
end

-- I: one item: id, index, item level, item string.
HANDLERS.I = function(f, sender)
    local inc = LM.incoming
    local index = tonumber(f[2])
    if not (inc and inc.id == f[1] and inc.leader == sender and index and index <= LM.MAX_ITEMS) then
        return
    end
    if not inc.items[index] then
        inc.got = inc.got + 1
    end
    inc.items[index] = { itemString = f[4], ilvl = tonumber(f[3]), shownAt = GetTime() }
    if inc.got >= inc.n and #inc.responses >= inc.nResponses then
        if inc.checked then
            LM:Fire("incoming", "shown")
        elseif not inc.checking then
            -- first, answer the items your specs can't use; the popup opens once that is done
            inc.checking = true
            LM:CheckSpecs(inc, function()
                inc.checked = true
                LM:Fire("incoming", "shown")
            end)
        end
    end
end

-- B: one response button: id, index, key, colour, weight, icon, label (last, so a long one is cut).
HANDLERS.B = function(f, sender)
    local inc = LM.incoming
    local index = tonumber(f[2])
    if not (inc and inc.id == f[1] and inc.leader == sender and index and index <= LM.MAX_RESPONSES and f[3] ~= "") then
        return
    end
    local r = { key = f[3], color = Wire.ParseColor(f[4]), weight = tonumber(f[5]) or 0, icon = f[6] ~= "" and (tonumber(f[6]) or f[6]) or nil, label = f[7] }
    inc.responses[index] = r
    inc.byKey[r.key] = r
end

-- Q: answer this item again (the looter re-sent it or cleared your answer).
HANDLERS.Q = function(f, sender)
    local inc = LM.incoming
    local index = tonumber(f[2])
    if inc and inc.id == f[1] and inc.leader == sender and index and inc.items[index] then
        inc.mine[index] = nil
        inc.items[index].shownAt = GetTime() -- a fresh timer
        LM:Fire("incoming", "shown")
    end
end

-- X: roll again for this item.
HANDLERS.X = function(f, sender)
    local inc = LM.incoming
    local index = tonumber(f[2])
    if inc and inc.id == f[1] and inc.leader == sender and index and inc.items[index] then
        local mine = inc.mine[index] or {}
        inc.mine[index] = mine
        mine.reroll, mine.rolled, mine.closed = true, false, nil
        inc.items[index].shownAt = GetTime()
        LM:Fire("incoming", "shown")
    end
end

-- A: an item was awarded.
HANDLERS.A = function(f, sender)
    local inc = LM.incoming
    local index = tonumber(f[2])
    if inc and inc.id == f[1] and inc.leader == sender and index and inc.items[index] then
        inc.items[index].award = { name = f[3], response = f[4] }
        LM:Fire("incoming")
    end
end

-- E: the session ended.
HANDLERS.E = function(f, sender)
    local inc = LM.incoming
    if inc and inc.id == f[1] and inc.leader == sender then
        LM.incoming = nil
        wipe(pendingRolls)
        LM:Fire("incoming", "ended")
    end
end

-- To the looter: K hello, R answer, L roll.
HANDLERS.K = function(f, sender)
    local s = LM.current
    if s and s.id == f[1] then
        s:Ack(sender, f[2])
        LM:Fire("session")
    end
end

HANDLERS.R = function(f, sender)
    local s = LM.current
    local index = tonumber(f[2])
    if not (s and s.id == f[1] and index) then
        return
    end
    s:Answer(sender, index, {
        response = f[3], role = f[4] ~= "" and f[4] or nil, class = f[5] ~= "" and f[5] or nil,
        ilvl = tonumber(f[6]), gear = { Wire.Gear(f[7]), Wire.Gear(f[8]) }, note = f[11] ~= "" and f[11] or nil,
        auto = f[9] == "1", autoSpecs = LM.ParseSpecs(f[10]),
    })
    LM:Fire("session")
end

HANDLERS.L = function(f, sender)
    local s = LM.current
    local index = tonumber(f[2])
    if s and s.id == f[1] and index and s:Roll(sender, index, tonumber(f[3])) then
        LM:Fire("session")
    end
end

receive = function(text, sender)
    local kind, fields = Wire.Decode(text)
    local h = kind and HANDLERS[kind]
    if h then
        local ok, err = pcall(h, fields, full(sender))
        if not ok then
            geterrorhandler()(err)
        end
    end
end

local events = CreateFrame("Frame")
events:RegisterEvent("CHAT_MSG_ADDON")
events:RegisterEvent("CHAT_MSG_SYSTEM")
events:SetScript("OnEvent", function(_, event, a1, a2, a3, a4)
    if event == "CHAT_MSG_ADDON" then
        if a1 == LM.PREFIX then
            receive(a2, a4)
        end
    elseif event == "CHAT_MSG_SYSTEM" then
        if #pendingRolls > 0 then
            ownRoll(a1)
        end
    end
end)
