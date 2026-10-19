local ADDON, CRT = ...

-- Loot Master over addon messages (prefix CRTLoot2): the looter's running session (LM.current) and, on
-- every raider's computer, the session they were sent (LM.incoming), with inc.view, a copy of everyone's
-- answers and rolls for the raider window. Every message goes to the group channel, never as a whisper,
-- so answers work across realms and every window sees every answer. Raid messages come back to the
-- sender too, so the looter also gets the raider popup. Out of a group a message is handed straight to
-- the receiver here (the game sends nothing then), so a test works alone.
--
-- Messages, "<kind>|<fields>" (Data.lua's Wire):
--   looter: S session (id, test, item count, version, seconds, button count, auto-answer), B buttons and
--           I items (packed, several a message), Q show an item again to a raider, L a roll the looter's
--           CRT drew for a raider (silent: no /roll in chat), A an item given out, E end
--   raider: K hello, Y ready (every item and button arrived), R answer
--   leader: U who may run loot (the raid leader's list; raiders trust only that)
-- Who may run loot: the raid leader (unless their list says not) and the names on the current raid
-- leader's list. A raider's own settings never grant anyone authority; no list received means leader only.
-- A session survives a /reload on both sides (CRTDBChar.lootSession), with every clock started again.
-- Nothing here passes a Blizzard roll. Trading is in LootMaster/Trade.lua.

local LM = CRT.LootMaster
local Session, Wire = LM.Session, LM.Wire

local RESULT = Enum and Enum.SendAddonMessageResult or {}
local SUCCESS = RESULT.Success or 0
local THROTTLED = RESULT.AddonMessageThrottle or 3
local CHANNEL_THROTTLED = RESULT.ChannelThrottle or 8
local LOCKDOWN = RESULT.AddOnMessageLockdown or 11
local OFFLINE = RESULT.TargetOffline or 12
local TICK = 1 -- seconds between timeout checks
local LOCKDOWN_RETRY = 10 -- seconds between tries while messages are held, besides ENCOUNTER_END
local ROSTER_DELAY = 2 -- seconds after a roster change before the leader sends its list again

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

-- The current group leader's full name, or nil out of a group.
local function leaderName()
    if not IsInGroup() then
        return nil
    end
    if UnitIsGroupLeader("player") then
        return LM:Me()
    end
    for _, name in ipairs(LM:Roster()) do
        local unit = unitOf(name)
        if unit and UnitIsGroupLeader(unit) then
            return name
        end
    end
    return nil
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
local sending, held = false, false
local warned = {} -- results already reported, so a failure is printed once, not per message
local receive -- set below

local pump
local function resume()
    if held then
        held = false
        pump()
    end
end

-- Sends what the game takes now. On the throttle it waits a second; in an encounter's lockdown it holds
-- every message until the encounter ends (or LOCKDOWN_RETRY); anything else is dropped, reported once.
pump = function()
    while queue[1] do
        local ch = channel()
        if not ch then
            wipe(queue) -- left the group: no one to send to
            break
        end
        local ok, result = pcall(C_ChatInfo.SendAddonMessage, LM.PREFIX, queue[1], ch)
        if ok and (result == THROTTLED or result == CHANNEL_THROTTLED) then
            C_Timer.After(1, pump)
            return
        elseif ok and result == LOCKDOWN then
            if not held then
                held = true
                C_Timer.After(LOCKDOWN_RETRY, resume)
                if not warned.lockdown then
                    warned.lockdown = true
                    CRT:Print("Loot Master: messages are held during the encounter and sent when it ends.")
                end
            end
            return
        elseif not ok or not (result == nil or result == true or result == SUCCESS or result == OFFLINE) then
            local key = tostring(ok and result or "error")
            if not warned[key] then
                warned[key] = true
                CRT:Print("Loot Master: a message could not be sent (" .. key .. ").")
            end
        end
        table.remove(queue, 1)
    end
    sending = false
end

-- A finished message to the group; out of a group it is handed straight to receive().
local function sendText(text)
    if not channel() then
        receive(text, LM:Me())
        return
    end
    queue[#queue + 1] = text
    if not sending and not held then
        sending = true
        pump()
    end
end

local function send(kind, fields)
    sendText(Wire.Encode(kind, fields))
end
LM.Send = send

-- Loot authority -------------------------------------------------------------------------------------

-- The raid leader's list, as the current raid leader sent it: { from, leader (may the leader run loot),
-- names = { [lowercased Name-Realm] = true }, stamp }.
LM.authority = nil

local function normalize(name)
    local Groups = CRT.Groups
    if Groups and Groups.Normalize then
        local ok, n = pcall(Groups.Normalize, name) -- a plain function, Groups.Normalize(name)
        if ok and type(n) == "string" and n ~= "" then
            return n
        end
    end
    return full(name)
end
LM.NormalizeName = normalize

-- Your own list, from Settings (it only counts while you lead).
function LM:OwnAuthority()
    local a = self:Settings().authority or {}
    local names = {}
    for _, n in ipairs(a.names or {}) do
        names[#names + 1] = normalize(n)
    end
    return a.leader ~= false, names
end

-- Whether a player may run loot, by the current raid leader's list.
local function allowed(name)
    if not name then
        return false
    end
    local lead = leaderName()
    if not lead then
        return name == LM:Me() -- alone: a test
    end
    if lead == LM:Me() then
        local leaderOK, names = LM:OwnAuthority()
        if name == lead then
            return leaderOK
        end
        for _, n in ipairs(names) do
            if n:lower() == name:lower() then
                return true
            end
        end
        return false
    end
    local a = LM.authority
    if not a or a.from ~= lead then
        return name == lead -- no list from this leader: leader only
    end
    if name == lead then
        return a.leader
    end
    return a.names[name:lower()] and true or false
end
LM.Allowed = allowed

-- Whether you may run loot now.
function LM:CanLoot()
    return allowed(self:Me())
end

-- The leader's CRT sends its list: on joining, when the roster or the list changes, and at each start.
local stamp = 0
function LM:SendAuthority()
    if not (IsInGroup() and UnitIsGroupLeader("player")) then
        return
    end
    local leaderOK, names = self:OwnAuthority()
    stamp = (stamp % 9999) + 1
    local entries = {}
    for _, n in ipairs(names) do
        entries[#entries + 1] = { n }
    end
    if #entries == 0 then
        entries[1] = { "" }
    end
    local head = (leaderOK and "1" or "0") .. ":" .. stamp
    for _, text in ipairs((Wire.Pack("U", head, entries))) do
        sendText(text)
    end
end

-- The looter -----------------------------------------------------------------------------------------

local ticker

local function stopTicker()
    if ticker then
        ticker:Cancel()
        ticker = nil
    end
end

local function save() end -- set below, with the /reload code

-- The session to the group: S, the buttons (B), the items (I), packed so a start fits the game's burst.
local function sendSession(s)
    send("S", { s.id, s.test and 1 or 0, #s.items, LM.VERSION, s.seconds, #s.responses, s.autoPass and 1 or 0 })
    local buttons, items = {}, {}
    for i, r in ipairs(s.responses) do
        buttons[i] = { i, r.key, Wire.Color(r.color), r.weight, r.icon or "", r.label }
    end
    for i, it in ipairs(s.items) do
        items[i] = { i, it.ilvl and math.floor(it.ilvl + 0.5) or "", it.itemString }
    end
    for _, text in ipairs((Wire.Pack("B", s.id, buttons))) do
        sendText(text)
    end
    for _, text in ipairs((Wire.Pack("I", s.id, items))) do
        sendText(text)
    end
end

-- The session's clocks: hello, ready (those who never got everything are sent it again, once), timeouts.
local function startTimers(s)
    stopTicker()
    C_Timer.After(LM.HELLO_SECONDS, function()
        if LM.current == s then
            s:MarkNoCRT()
            LM:Fire("session")
        end
    end)
    C_Timer.After(LM.READY_SECONDS, function()
        if LM.current == s and #s:NotReady() > 0 then
            sendSession(s)
        end
    end)
    ticker = C_Timer.NewTicker(TICK, function()
        if LM.current ~= s then
            stopTicker()
        elseif s:Tick() then
            LM:Fire("session")
        end
    end)
end

-- items: { { itemString, link, ilvl } }. test marks it as a test everywhere.
function LM:Start(items, test)
    if not self:CanLoot() then
        CRT:Print("Loot Master: you can't run loot here (Loot Master > Settings > Loot authority, set by the raid leader).")
        return nil
    end
    local ok, long = {}, nil
    for _, it in ipairs(items or {}) do
        local _, tooLong = Wire.Pack("I", "x", { { 1, 1, it.itemString } })
        if #tooLong > 0 then
            long = (long or 0) + 1
        else
            ok[#ok + 1] = it
        end
    end
    if long then
        CRT:Print(string.format("Loot Master: %d item(s) left out, their item data is too long to send.", long))
    end
    if #ok == 0 then
        CRT:Print("Loot Master: no items to start a session with.")
        return nil
    end
    warned = {}
    local id = string.format("%x", (time() % 0xFFFFFF)) .. string.format("%02x", math.random(0, 255))
    local s = Session.New({ id = id, test = test, leader = self:Me(), items = ok })
    s.autoPass = self:Settings().autoPass ~= false
    s:Expect(self:Roster())
    self.current = s
    self:SendAuthority()
    sendSession(s)
    startTimers(s)
    self:Fire("started", s)
    save()
    return s
end

-- A roll for a raider's answer, drawn here and sent to everyone (force: the looter's Roll again).
local function drawRoll(s, name, index, force)
    if not s:NeedsRoll(name, index) then
        return
    end
    local p = s.players[name]
    if not force and p.answers[index].roll then
        return -- already rolled: a changed answer keeps its roll
    end
    local roll = math.random(1, 100)
    if s:SetRoll(name, index, roll, force) then
        send("L", { s.id, index, name, roll, force and 1 or 0 })
    end
end

-- The award message ------------------------------------------------------------------------------------

-- Where the award message goes (Settings): a chat type, "CHANNEL:<name>" for a chat channel you have
-- joined, "SELF" (only you) or "NONE". When the place isn't open to you (RAID out of a raid, GUILD with no
-- guild, a channel you left, chat locked during an encounter) it is shown only to you, saying why.
local CHAT = (C_ChatInfo and C_ChatInfo.SendChatMessage) or SendChatMessage
local COMMUNITY_CHANNEL = "Community:%s:%s" -- Blizzard's ChatFrameUtil.GetCommunitiesChannelName

local function where(target)
    if target == "NONE" then
        return nil
    elseif target == "RAID" or target == "RAID_WARNING" then
        return IsInRaid() and target or nil, "you are not in a raid"
    elseif target == "PARTY" then
        return IsInGroup() and "PARTY" or nil, "you are not in a group"
    elseif target == "GUILD" or target == "OFFICER" then
        return IsInGuild() and target or nil, "you are not in a guild"
    elseif type(target) == "string" and target:find("^CHANNEL:") then
        local id = GetChannelName(target:sub(9))
        return (id and id > 0) and "CHANNEL" or nil, "you are not in that channel", id
    elseif type(target) == "string" and target:find("^COMMUNITY:") then
        local club, stream = target:match("^COMMUNITY:([^:]+):([^:]+)$")
        local id = club and GetChannelName(COMMUNITY_CHANNEL:format(club, stream))
        if not (id and id > 0) then
            LM.JoinStream(target) -- joined now, ready for the next award
        end
        return (id and id > 0) and "CHANNEL" or nil, "joining the guild channel, the next award goes there", id
    end
    return nil
end

-- Guild channels ---------------------------------------------------------------------------------------

-- A guild's channels (the Guild & Communities window's streams) can't be posted to by an addon directly
-- (C_Club.SendMessage is protected since 8.1). Once added to chat (C_Club.AddClubStreamChatChannel, what
-- "Add to Chat Window" does), a stream is a chat channel named "Community:<clubId>:<streamId>", and a
-- click can post to it as CHANNEL.

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
    local target = self:Settings().awardChannel or "RAID"
    if target == "NONE" then
        return
    end
    if test then
        CRT:Print("Loot Master (test, only you see this): " .. text)
        return
    end
    if target == "SELF" then
        CRT:Print(text)
        return
    end
    local chatType, why, id = where(target)
    if chatType and C_ChatInfo and C_ChatInfo.InChatMessagingLockdown and C_ChatInfo.InChatMessagingLockdown() then
        chatType, why = nil, "chat is locked during the encounter"
    end
    if not chatType then
        CRT:Print(text .. "  |cff999999(only you: " .. (why or "no channel") .. ")|r")
        return
    end
    local ok, err = pcall(CHAT, text, chatType, nil, id)
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
    save()
end

-- Shows the popup again for these players, for an item they haven't answered: a Q to each. Anyone who
-- never got the whole session is sent it again first.
function LM:Resend(index, names)
    local s = self.current
    if not s then
        return 0
    end
    local n, again = 0, false
    for _, name in ipairs(names) do
        if s:CanResend(name, index) then
            local p = s.players[name]
            again = again or not p.ready
            s:Clear(name, index)
            n = n + 1
        end
    end
    if again then
        sendSession(s)
    end
    for _, name in ipairs(names) do
        local p = s.players[name]
        if p and p.answers[index] and not p.answers[index].response then
            send("Q", { s.id, index, name })
        end
    end
    self:Fire("session")
    return n
end

-- The looter's Roll again: a new number for each, shown to everyone.
function LM:Reroll(index, names)
    local s = self.current
    if not s then
        return 0
    end
    local n = 0
    for _, name in ipairs(names) do
        if s:CanReroll(name, index) then
            drawRoll(s, name, index, true)
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
        send("Q", { s.id, index, name })
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
    save()
end

-- The raider -----------------------------------------------------------------------------------------

-- Your answer for an item, to everyone. The looter's CRT draws your roll and sends it back.
function LM:Answer(index, response, note)
    local inc = self.incoming
    if not inc or not inc.items[index] then
        return
    end
    if inc.mine[index] and inc.mine[index].auto then
        return -- answered for you because you can't use it: you can see it, not answer it
    end
    local mine = inc.mine[index] or {}
    inc.mine[index] = mine
    mine.response, mine.note = response, note
    local gear = self:MyGear(inc.items[index].itemString)
    local _, classFile = UnitClass("player")
    send("R", { inc.id, index, response, self:MyRole(), classFile or "", self:MyItemLevel(),
        Wire.GearText(gear[1]), Wire.GearText(gear[2]), "", "", note or "" })
    self:Fire("incoming")
    save()
end

-- Items you can't use ----------------------------------------------------------------------------------

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

local function secret(v)
    return issecretvalue and issecretvalue(v) or false
end

-- The class names on the item's "Classes: ..." tooltip line, read from tooltip data (no tooltip is
-- shown), or nil.
local function classesLine(itemString)
    if not (C_TooltipInfo and C_TooltipInfo.GetHyperlink and ITEM_CLASSES_ALLOWED) then
        return nil
    end
    local ok, data = pcall(C_TooltipInfo.GetHyperlink, itemString)
    if not ok or type(data) ~= "table" or type(data.lines) ~= "table" then
        return nil
    end
    for _, line in ipairs(data.lines) do
        local text = line.leftText
        if type(text) == "string" and not secret(text) then
            local names = LM.ParseClassesLine(text, ITEM_CLASSES_ALLOWED)
            if names then
                return names
            end
        end
    end
    return nil
end

-- Class names as the game writes them in this language, male and female (Blizzard's
-- LOCALIZED_CLASS_NAMES_MALE and _FEMALE: class file -> name): yours, and every class's.
local function classNames(classFile)
    local mine, known = {}, {}
    for _, list in ipairs({ LOCALIZED_CLASS_NAMES_MALE or {}, LOCALIZED_CLASS_NAMES_FEMALE or {} }) do
        for file, name in pairs(list) do
            known[name] = true
            if file == classFile then
                mine[name] = true
            end
        end
    end
    return mine, known
end

-- Why an item can't be used by you: "spec" with the spec IDs, "classes" with the classes it is for,
-- "armor" with its armor subclass; nil when it can be, or when anything is unclear. The probe calls it
-- too (/crt dev loot probe spec), so what it prints is the real decision.
function LM.CantUse(itemString, loaded)
    local ok, specs = pcall(C_Item.GetItemSpecInfo, itemString)
    if ok and not secret(specs) and LM.SpecVerdict(specs, mySpecs(), loaded) == "auto" then
        return "spec", table.concat(specs, ",")
    end
    local okI, _, _, _, equipLoc, _, itemClass, subClass = pcall(C_Item.GetItemInfoInstant, itemString)
    local _, classFile = UnitClass("player")
    local mine, known = classNames(classFile)
    local classes = classesLine(itemString)
    local verdict, why = LM.ClassVerdict({
        loaded = loaded and okI, itemClass = itemClass, subClass = subClass, equipLoc = equipLoc,
        myClass = classFile, myClassNames = mine, knownClassNames = known, classes = classes,
    })
    if verdict == "auto" then
        return why, why == "classes" and table.concat(classes, "/") or tostring(subClass)
    end
    return nil
end

-- Answers one item for you when you can't use it (your specs, your class, your armor type); else leaves
-- it alone.
local function judge(inc, index, loaded)
    local it = inc.items[index]
    if not it or LM.incoming ~= inc or (inc.mine[index] and inc.mine[index].response) then
        return
    end
    local why, detail = LM.CantUse(it.itemString, loaded)
    if not why then
        return
    end
    local response = inc.byKey.tmog and "tmog" or "pass"
    local gear = LM:MyGear(it.itemString)
    local _, classFile = UnitClass("player")
    -- hidden, unless you chose to see every item; either way you can see it but not answer it
    inc.mine[index] = { response = response, auto = true, autoWhy = why, autoSpecs = why == "spec" and LM.ParseSpecs(detail) or nil,
        closed = not LM:Settings().showAllItems }
    send("R", { inc.id, index, response, LM:MyRole(), classFile or "", LM:MyItemLevel(),
        Wire.GearText(gear[1]), Wire.GearText(gear[2]), why, detail or "", "" })
end

-- Checks every item of a session, then calls done once: when all are judged, or after SPEC_WAIT.
-- Off when the leader turned it off. "Show me items my specs can't use" only shows them.
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

-- Receiving ------------------------------------------------------------------------------------------

-- Once every item and button is in (and the items you can't use are answered), the popup opens and the
-- looter is told you are ready, which starts your clock there.
local function checkReady(inc)
    if inc.got < inc.n or #inc.responses < inc.nResponses then
        return
    end
    if inc.checked then
        LM:Fire("incoming", "shown")
    elseif not inc.checking then
        inc.checking = true
        LM:CheckSpecs(inc, function()
            inc.checked = true
            for _, it in pairs(inc.items) do
                it.shownAt = GetTime()
            end
            send("Y", { inc.id })
            LM:Fire("incoming", "shown")
            save()
        end)
    end
end

-- From the session's own looter.
local function fromLooter(inc, f, sender)
    return inc and inc.id == f[1] and inc.leader == sender
end

local HANDLERS = {}

-- U: the raid leader's list of who may run loot. Parts share a stamp; a new stamp starts a new list.
HANDLERS.U = function(f, sender)
    if sender ~= leaderName() then
        return -- only the current raid leader's list counts
    end
    local flag, st = tostring(f[1] or ""):match("^([01]):(%d+)$")
    if not flag then
        return
    end
    local a = LM.authority
    if not a or a.from ~= sender or a.stamp ~= st then
        a = { from = sender, leader = flag == "1", names = {}, stamp = st }
        LM.authority = a
    end
    for _, e in ipairs(Wire.Unpack(f[2])) do
        if e[1] and e[1] ~= "" then
            a.names[e[1]:lower()] = true
        end
    end
    LM:Fire("authority")
end

-- S: a session starts (or is sent again).
HANDLERS.S = function(f, sender)
    if not allowed(sender) then
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
        -- everyone's answers, for the raider window
        inc.view = Session.New({ id = id, test = inc.test, leader = sender, items = {}, responses = {}, seconds = inc.seconds })
        inc.view.items, inc.view.responses, inc.view.byKey = inc.items, inc.responses, inc.byKey
        LM.incoming = inc
    end
    send("K", { id, LM.VERSION })
end

-- B: the buttons, packed: index, key, colour, weight, icon, label.
HANDLERS.B = function(f, sender)
    local inc = LM.incoming
    if not fromLooter(inc, f, sender) then
        return
    end
    for _, e in ipairs(Wire.Unpack(f[2])) do
        local index = tonumber(e[1])
        if index and index <= LM.MAX_RESPONSES and e[2] and e[2] ~= "" and not inc.responses[index] then
            local r = { key = e[2], color = Wire.ParseColor(e[3]), weight = tonumber(e[4]) or 0,
                icon = e[5] ~= "" and e[5] or nil, label = e[6] or e[2] }
            inc.responses[index] = r
            inc.byKey[r.key] = r
        end
    end
    checkReady(inc)
end

-- I: the items, packed: index, item level, item string. A repeat (the session sent again) changes nothing.
HANDLERS.I = function(f, sender)
    local inc = LM.incoming
    if not fromLooter(inc, f, sender) then
        return
    end
    for _, e in ipairs(Wire.Unpack(f[2])) do
        local index = tonumber(e[1])
        if index and index <= LM.MAX_ITEMS and e[3] and e[3] ~= "" and not inc.items[index] then
            inc.items[index] = { itemString = e[3], ilvl = tonumber(e[2]), shownAt = GetTime() }
            inc.got = inc.got + 1
        end
    end
    checkReady(inc)
end

-- Q: show an item again to one raider (their answer is cleared everywhere).
HANDLERS.Q = function(f, sender)
    local inc = LM.incoming
    local index = tonumber(f[2])
    if not (fromLooter(inc, f, sender) and index and inc.items[index]) then
        return
    end
    inc.view:Clear(f[3], index)
    if f[3] == LM:Me() then
        inc.mine[index] = nil
        inc.items[index].shownAt = GetTime() -- a fresh timer
        LM:Fire("incoming", "shown")
    else
        LM:Fire("incoming")
    end
end

-- L: a roll the looter's CRT drew for a raider (1 at the end: Roll again).
HANDLERS.L = function(f, sender)
    local inc = LM.incoming
    local index, roll = tonumber(f[2]), tonumber(f[4])
    if not (fromLooter(inc, f, sender) and index and roll) then
        return
    end
    inc.view:SetRoll(f[3], index, roll, f[5] == "1")
    if f[3] == LM:Me() and inc.mine[index] then
        inc.mine[index].roll = roll
    end
    LM:Fire("incoming")
end

-- A: an item was given out.
HANDLERS.A = function(f, sender)
    local inc = LM.incoming
    local index = tonumber(f[2])
    if fromLooter(inc, f, sender) and index and inc.items[index] then
        inc.items[index].award = { name = f[3], response = f[4] }
        LM:Fire("incoming")
        save()
    end
end

-- E: the session ended.
HANDLERS.E = function(f, sender)
    local inc = LM.incoming
    if fromLooter(inc, f, sender) then
        LM.incoming = nil
        LM:Fire("incoming", "ended")
        save()
    end
end

-- From raiders, to the looter and to every raider window: K hello, Y ready, R answer.
HANDLERS.K = function(f, sender)
    local s, inc = LM.current, LM.incoming
    if s and s.id == f[1] then
        s:Ack(sender, f[2])
        LM:Fire("session")
    end
    if inc and inc.id == f[1] then
        inc.view:Ack(sender, f[2])
        LM:Fire("incoming")
    end
end

HANDLERS.Y = function(f, sender)
    local s, inc = LM.current, LM.incoming
    if s and s.id == f[1] and s:Ready(sender) then
        LM:Fire("session")
    end
    if inc and inc.id == f[1] then
        inc.view:Ready(sender)
    end
end

local function answerFields(f)
    return {
        response = f[3], role = f[4] ~= "" and f[4] or nil, class = f[5] ~= "" and f[5] or nil,
        ilvl = tonumber(f[6]), gear = { Wire.Gear(f[7]), Wire.Gear(f[8]) }, note = f[11] ~= "" and f[11] or nil,
        auto = (f[9] or "") ~= "", autoWhy = (f[9] == "1" or f[9] == "spec") and "spec" or f[9], autoDetail = f[10],
        autoSpecs = (f[9] == "1" or f[9] == "spec") and LM.ParseSpecs(f[10]) or nil,
    }
end

HANDLERS.R = function(f, sender)
    local index = tonumber(f[2])
    if not index then
        return
    end
    local s, inc = LM.current, LM.incoming
    -- the raider window's copy first, so the roll the looter draws below finds the answer there too
    if inc and inc.id == f[1] then
        inc.view:Answer(sender, index, answerFields(f))
        LM:Fire("incoming")
    end
    if s and s.id == f[1] and s:Answer(sender, index, answerFields(f)) then
        if (f[9] or "") == "" then
            s:Ready(sender) -- an answer of their own means they have the session
        end
        drawRoll(s, sender, index, false)
        LM:Fire("session")
        save()
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

-- Surviving a /reload ------------------------------------------------------------------------------------

-- The running session and the one you were sent are kept in CRTDBChar.lootSession and brought back after
-- a /reload (not after RESTORE_HOURS), with every clock started again. End clears it.
save = function()
    CRTDBChar = CRTDBChar or {}
    if not (LM.current or LM.incoming) then
        CRTDBChar.lootSession = nil
        return
    end
    CRTDBChar.lootSession = { savedAt = time(), current = LM.current, incoming = LM.incoming }
end
LM.Save = function()
    save()
end

local function restore()
    local saved = CRTDBChar and CRTDBChar.lootSession
    if type(saved) ~= "table" or not saved.savedAt or time() - saved.savedAt > LM.RESTORE_HOURS * 3600 then
        if CRTDBChar then
            CRTDBChar.lootSession = nil
        end
        return
    end
    local s = LM.Revive(saved.current)
    local inc = saved.incoming
    if s and (s.test or IsInGroup()) then
        LM.current = s
        startTimers(s)
        LM:Fire("started", s)
    end
    if type(inc) == "table" and type(inc.items) == "table" and (inc.test or IsInGroup()) then
        inc.view = LM.Revive(inc.view)
        if inc.view then
            inc.view.items, inc.view.responses, inc.view.byKey = inc.items, inc.responses, inc.byKey
        end
        inc.byKey = {}
        for _, r in ipairs(inc.responses or {}) do
            inc.byKey[r.key] = r
        end
        if inc.view then
            inc.view.byKey = inc.byKey
        end
        for _, it in pairs(inc.items) do
            it.shownAt = GetTime() -- a fresh timer after the reload
        end
        inc.checking, inc.checked = true, true
        LM.incoming = inc
        LM:Fire("incoming", "shown")
    end
    save()
end

local events = CreateFrame("Frame")
events:RegisterEvent("CHAT_MSG_ADDON")
events:RegisterEvent("PLAYER_LOGIN")
events:RegisterEvent("PLAYER_LOGOUT")
events:RegisterEvent("ENCOUNTER_END")
events:RegisterEvent("PLAYER_REGEN_ENABLED")
events:RegisterEvent("GROUP_ROSTER_UPDATE")
events:RegisterEvent("PARTY_LEADER_CHANGED")
local rosterPending = false
events:SetScript("OnEvent", function(_, event, a1, a2, a3, a4)
    if event == "CHAT_MSG_ADDON" then
        if a1 == LM.PREFIX then
            receive(a2, a4)
        end
    elseif event == "PLAYER_LOGIN" then
        restore()
    elseif event == "PLAYER_LOGOUT" then
        save()
    elseif event == "ENCOUNTER_END" or event == "PLAYER_REGEN_ENABLED" then
        resume()
    elseif not rosterPending then
        rosterPending = true
        C_Timer.After(ROSTER_DELAY, function()
            rosterPending = false
            LM:SendAuthority()
            LM:Fire("authority")
        end)
    end
end)
