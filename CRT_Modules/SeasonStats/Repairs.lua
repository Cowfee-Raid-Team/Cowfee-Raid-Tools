local ADDON, CRT = ...

-- Season Stats' repairs: your own repair bill per pull, and the raid's from every raider running CRT, for the
-- Your repairs and Raid costs cards and columns (SeasonStats/Page.lua). Nothing here is saved; the counters are
-- Data.lua's (repairs, repairPulls, raidRepairs, raidReporters, raidPulls), in each scope the pull counted in (all,
-- and team for a team raid).
--
-- Your bill is what the game would charge to repair your gear: each damaged item's repairCost in its tooltip data
-- (C_TooltipInfo.GetInventoryItem("player", slot), a data call that draws no tooltip; checked 2026-10-24 on
-- warcraft.wiki.gg and in Blizzard's TooltipDataRules.lua, which reads tooltipData.repairCost). It's read at
-- ENCOUNTER_START and again out of combat after ENCOUNTER_END (at once, or on PLAYER_REGEN_ENABLED), so a release
-- and run back adds nothing. When the read at the pull fails (a secret or missing cost), the last read out of
-- combat stands in: on entering the raid, after the last pull, when a vendor or repair bot closes, and when your
-- durability changes out of combat. A smaller bill after the pull than before (repaired) counts nothing.
--
-- Each pull is kept here (the last KEEP) until the Timeline's save hook counts it: Stats:Record calls Rep:Claim,
-- which gives the pull the counters it was counted in. Your bill and the raid's reports go to those counters only,
-- once, so Your repairs and Raid costs count the same pulls, and a pull the Timeline doesn't keep adds nothing.
--
-- Cheap on every computer: the events are only listened to inside a raid instance, PLAYER_REGEN_ENABLED only while
-- a pull waits for its read; a read asks 17 slots' item and durability (GetInventoryItemID,
-- GetInventoryItemDurability) and reads tooltip data only for damaged slots, and only when those changed since the
-- last read. No OnUpdate.
--
-- The raid's costs: after its read, each raider's CRT sends one message under the prefix CRTRepair to the raid
-- (never in combat; never in Raid Finder, a finder group or outside a raid group):
--   "<version>|<encounterID>|<group>|<start>|<copper>"   e.g. "1|3129|mythic|1793232000|7000"
-- start is the pull's start on the server's clock (GetServerTime, the same on every computer), so the reports of
-- one pull agree within MATCH seconds. A newer version may add fields after these. A report counts only for a pull
-- this computer saw too (same boss, difficulty group and start) and that Season Stats counted: one report per
-- sender per pull (repeats and your own echo ignored, secret senders never compared), your own included. Anything
-- else is dropped, and a report never makes counters of its own. Raiders without CRT send nothing.

local Stats = CRT.SeasonStats
local Rep = {}
CRT.SeasonRepairs = Rep

Rep.PREFIX = "CRTRepair"
Rep.VERSION = 1
Rep.MATCH = 10 -- seconds between two starts of the same pull (two computers, or the Timeline's and this one's)
Rep.MAX_COST = 50000000 -- copper (5,000 gold): a report above this is dropped as broken
Rep.FIRST_SLOT, Rep.LAST_SLOT = 1, 17 -- head to off hand; the shirt, ranged and tabard slots have no durability
Rep.KEEP = 4 -- pulls kept for the Timeline's save and for reports, messages waiting to go
Rep.MAX_REPORTS = 40 -- reports kept per pull, a full raid's
Rep.TRIES = 3 -- tries to send a message the game throttled
Rep.LOCK_TRIES = 15 -- tries to send while the game holds addon messages (it can last past the encounter's end)
Rep.RETRY = 2 -- seconds before trying again
Rep.FIRE_DELAY = 1 -- seconds of reports added up before the page is told

local FINDER = { [7] = true, [17] = true } -- Raid Finder difficulties
local RESULT = Enum and Enum.SendAddonMessageResult or {}
local THROTTLED = RESULT.AddonMessageThrottle or 3
local CHANNEL_THROTTLED = RESULT.ChannelThrottle or 8
local LOCKDOWN = RESULT.AddOnMessageLockdown or 11
local SELF = "\1self" -- your own report's sender, never a player's name

if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then
    C_ChatInfo.RegisterAddonMessagePrefix(Rep.PREFIX)
end

-- False for a secret value, which can't be compared or added up.
local function readable(v)
    if issecretvalue then
        local ok, secret = pcall(issecretvalue, v)
        if not ok or secret then
            return false
        end
    end
    return true
end

local inside = false -- in a raid instance
local cache -- the last read: { sig = items and durability, cost }
local baseline -- the last bill read out of combat
local pending -- the pull waiting for its read after
-- the last KEEP pulls, newest last: { encounterID, group, at = time(), key = server time, before, ended, cost,
-- counters (once Claimed), repairAdded, reports = { [sender] = copper }, reportCount, raidCounted }
local pulls = {}
local queue = {} -- messages waiting to go: { text, throttles, locks }
local fireQueued = false

-- Reading your bill --------------------------------------------------------------------------------------------------

-- Every slot's item and durability as one text, and the damaged slots; nil when a value is secret.
local function durability()
    local parts, damaged = {}, {}
    for slot = Rep.FIRST_SLOT, Rep.LAST_SLOT do
        local ok, cur, max = pcall(GetInventoryItemDurability, slot)
        if ok and cur ~= nil then
            if not (readable(cur) and readable(max)) then
                return nil
            end
            if type(cur) == "number" and type(max) == "number" then
                local okID, item = pcall(GetInventoryItemID, "player", slot)
                if not okID or not readable(item) then
                    return nil
                end
                parts[#parts + 1] = slot .. "=" .. tostring(item) .. ":" .. cur .. "/" .. max
                if cur < max then
                    damaged[#damaged + 1] = slot
                end
            end
        end
    end
    return table.concat(parts, ","), damaged
end

-- Your gear's repair bill in copper, or nil when it can't be read (a damaged item's cost secret or missing).
-- Unchanged items and durability give the last read again without asking the game.
function Rep.Read()
    local sig, damaged = durability()
    if not sig then
        return nil
    end
    if cache and cache.sig == sig then
        return cache.cost
    end
    local total = 0
    for _, slot in ipairs(damaged) do
        local ok, data = pcall(C_TooltipInfo.GetInventoryItem, "player", slot)
        local cost = ok and type(data) == "table" and data.repairCost or nil
        if not readable(cost) or type(cost) ~= "number" or cost < 0 then
            return nil
        end
        total = total + cost
    end
    cache = { sig = sig, cost = total }
    return total
end

-- Forgets the last read, so the next asks the game again.
function Rep.Forget()
    cache = nil
end

local function outOfCombatRead()
    if InCombatLockdown() then
        return
    end
    local cost = Rep.Read()
    if cost then
        baseline = cost
    end
end

-- The group ---------------------------------------------------------------------------------------------------------

local function raidInstance()
    local ok, _, kind, difficultyID = pcall(GetInstanceInfo)
    return ok and kind == "raid", difficultyID
end

-- True when reports are sent and heard: in a raid instance, not Raid Finder, in your own raid group.
function Rep.CanShare()
    local raid, difficultyID = raidInstance()
    if not raid or not readable(difficultyID) or FINDER[difficultyID] then
        return false
    end
    return IsInRaid() and not IsInGroup(LE_PARTY_CATEGORY_INSTANCE) or false
end

local function isSelf(sender)
    local name, realm = UnitFullName("player")
    if type(name) ~= "string" then
        return false
    end
    realm = realm or (GetNormalizedRealmName and GetNormalizedRealmName())
    return sender == name or (type(realm) == "string" and sender == name .. "-" .. realm)
end

-- The message -------------------------------------------------------------------------------------------------------

function Rep.Encode(encounterID, group, start, copper)
    return string.format("%d|%d|%s|%d|%d", Rep.VERSION, encounterID, group, start, copper)
end

local function knownGroup(group)
    for _, g in ipairs(Stats.GROUPS) do
        if g == group then
            return true
        end
    end
    return false
end

-- encounterID, group, start, copper; nil for a message that isn't a report.
function Rep.Decode(text)
    if type(text) ~= "string" then
        return nil
    end
    local v, enc, group, start, copper, rest = text:match("^(%d+)|(%d+)|(%a+)|(%d+)|(%d+)(.*)$")
    v, enc, start, copper = tonumber(v), tonumber(enc), tonumber(start), tonumber(copper)
    if not (v and enc and start and copper) or v < 1 or (rest ~= "" and rest:sub(1, 1) ~= "|") then
        return nil
    end
    if not knownGroup(group) or copper > Rep.MAX_COST then
        return nil
    end
    return enc, group, start, copper
end

-- True while the game holds addon messages: in combat, or its chat messaging lockdown.
local function held()
    if InCombatLockdown() then
        return true
    end
    if C_ChatInfo.InChatMessagingLockdown then
        local ok, locked = pcall(C_ChatInfo.InChatMessagingLockdown)
        return ok and readable(locked) and locked == true
    end
    return false
end

local sendNext

local function later()
    C_Timer.After(Rep.RETRY, sendNext)
end

-- Sends the first waiting message; a throttled one is tried TRIES times, a held one LOCK_TRIES times.
sendNext = function()
    local item = queue[1]
    if not item then
        return
    end
    if not Rep.CanShare() or not (C_ChatInfo and C_ChatInfo.SendAddonMessage) then
        wipe(queue)
        return
    end
    local result
    if held() then
        result = LOCKDOWN
    else
        local ok, r = pcall(C_ChatInfo.SendAddonMessage, Rep.PREFIX, item.text, "RAID")
        result = ok and r or nil
    end
    if result == THROTTLED or result == CHANNEL_THROTTLED then
        item.throttles = item.throttles + 1
        if item.throttles < Rep.TRIES then
            return later()
        end
    elseif result == LOCKDOWN then
        item.locks = item.locks + 1
        if item.locks < Rep.LOCK_TRIES then
            return later()
        end
    end
    table.remove(queue, 1)
    if queue[1] then
        later()
    end
end

local function send(text)
    queue[#queue + 1] = { text = text, throttles = 0, locks = 0 }
    while #queue > Rep.KEEP do
        table.remove(queue, 1)
    end
    if #queue == 1 then
        sendNext()
    end
end

-- The page is told once for a burst of reports.
local function queueFire()
    if fireQueued then
        return
    end
    fireQueued = true
    C_Timer.After(Rep.FIRE_DELAY, function()
        fireQueued = false
        Stats:Fire()
    end)
end

-- One pull ----------------------------------------------------------------------------------------------------------

-- A pull's report into its counters (one per scope it counted in: all, and team for a team raid), the first of the
-- pull counting the pull.
local function addReport(p, copper)
    for _, c in ipairs(p.counters) do
        Stats:AddRaidRepair(c, copper, not p.raidCounted)
    end
    p.raidCounted = true
end

-- Your bill into the pull's counters, once both are known.
local function addOwn(p)
    if p.counters and p.cost and not p.repairAdded then
        p.repairAdded = true
        for _, c in ipairs(p.counters) do
            Stats:AddRepair(c, p.cost)
        end
    end
end

-- The kept pull a report is about: same boss and group, a start within MATCH seconds.
local function pullFor(encounterID, group, start)
    for i = #pulls, 1, -1 do
        local p = pulls[i]
        if p.encounterID == encounterID and p.group == group and math.abs(p.key - start) <= Rep.MATCH then
            return p
        end
    end
    return nil
end

-- Takes one raider's report of a pull: kept when the pull is one this computer saw, and added to its counters
-- once Season Stats counted it. A second report from the same sender on that pull is ignored. Returns true when
-- the report was taken.
function Rep:Hear(sender, encounterID, group, start, copper)
    local p = pullFor(encounterID, group, start)
    if not p or p.reports[sender] ~= nil or p.reportCount >= Rep.MAX_REPORTS then
        return false
    end
    p.reports[sender] = copper
    p.reportCount = p.reportCount + 1
    if p.counters then
        addReport(p, copper)
        queueFire()
    end
    return true
end

local function sameStart(p, pull)
    return p.encounterID == pull.encounterID and type(pull.startedAt) == "number" and math.abs(p.at - pull.startedAt) <= Rep.MATCH
end

-- Gives a pull the counters the Timeline's save counted it in (Stats:Record: a list, one per scope, or one
-- counters table), once: your bill (now, or when the read after finishes) and the raid's reports heard so far go
-- to each.
function Rep:Claim(pull, c)
    if type(c) ~= "table" or type(pull) ~= "table" then
        return false
    end
    if c.pulls ~= nil then
        c = { c }
    end
    for i = #pulls, 1, -1 do
        local p = pulls[i]
        if not p.counters and sameStart(p, pull) then
            p.counters = c
            addOwn(p)
            for _, copper in pairs(p.reports) do
                addReport(p, copper)
            end
            return true
        end
    end
    return false
end

local function finish(p)
    if p.counters then
        addOwn(p)
        queueFire()
    end
    if p.group and Rep.CanShare() then
        send(Rep.Encode(p.encounterID, p.group, p.key, p.cost))
        Rep:Hear(SELF, p.encounterID, p.group, p.key, p.cost)
    end
end

local driver = CreateFrame("Frame")

local function readAfter()
    local p = pending
    pending = nil
    driver:UnregisterEvent("PLAYER_REGEN_ENABLED")
    if not (p and p.ended and p.before) then
        return
    end
    local after = Rep.Read()
    if after == nil then
        return
    end
    baseline = after
    if after < p.before then
        return -- repaired since: no bill to tell
    end
    p.cost = after - p.before
    finish(p)
end

local function startPull(encounterID, _, difficultyID)
    pending = nil
    driver:UnregisterEvent("PLAYER_REGEN_ENABLED")
    if not readable(encounterID) or type(encounterID) ~= "number" then
        return
    end
    local before = Rep.Read()
    if before == nil then
        before = baseline
    end
    local diff = readable(difficultyID) and type(difficultyID) == "number" and difficultyID or nil
    pending = {
        encounterID = encounterID, group = diff and Stats.GroupOf(diff) or nil, at = time(),
        key = GetServerTime and GetServerTime() or time(), before = before, reports = {}, reportCount = 0,
    }
    pulls[#pulls + 1] = pending
    while #pulls > Rep.KEEP do
        table.remove(pulls, 1)
    end
end

local function endPull(encounterID)
    local p = pending
    if not p or not readable(encounterID) or encounterID ~= p.encounterID then
        return
    end
    p.ended = true
    if InCombatLockdown() then
        driver:RegisterEvent("PLAYER_REGEN_ENABLED")
    else
        readAfter()
    end
end

local function onMessage(prefix, text, _, sender)
    if not readable(prefix) or prefix ~= Rep.PREFIX then
        return
    end
    if not (readable(text) and readable(sender)) or type(text) ~= "string" or type(sender) ~= "string" then
        return
    end
    if isSelf(sender) or not Rep.CanShare() then
        return
    end
    local encounterID, group, start, copper = Rep.Decode(text)
    if encounterID then
        Rep:Hear(sender, encounterID, group, start, copper)
    end
end

local LIVE = { "ENCOUNTER_START", "ENCOUNTER_END", "MERCHANT_CLOSED", "UPDATE_INVENTORY_DURABILITY", "CHAT_MSG_ADDON" }

local function setInside(on)
    inside = on
    for _, event in ipairs(LIVE) do
        if on then
            driver:RegisterEvent(event)
        else
            driver:UnregisterEvent(event)
        end
    end
    if not on then
        pending = nil
        driver:UnregisterEvent("PLAYER_REGEN_ENABLED")
    end
end

-- The driver's OnEvent body, exposed so tests can drive it.
function Rep.HandleEvent(event, ...)
    if event == "PLAYER_ENTERING_WORLD" then
        setInside(raidInstance() and true or false)
        if inside then
            outOfCombatRead()
        end
        return
    end
    if not inside then
        return
    end
    if event == "CHAT_MSG_ADDON" then
        onMessage(...)
    elseif event == "ENCOUNTER_START" then
        startPull(...)
    elseif event == "ENCOUNTER_END" then
        endPull((...))
    elseif event == "PLAYER_REGEN_ENABLED" then
        readAfter()
    elseif (event == "MERCHANT_CLOSED" or event == "UPDATE_INVENTORY_DURABILITY") and not pending then
        outOfCombatRead()
    end
end

driver:RegisterEvent("PLAYER_ENTERING_WORLD")
driver:SetScript("OnEvent", function(_, event, ...)
    Rep.HandleEvent(event, ...)
end)
