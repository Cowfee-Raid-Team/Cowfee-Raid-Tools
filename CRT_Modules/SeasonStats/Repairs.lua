local ADDON, CRT = ...

-- Season Stats' repairs: your own repair bill per pull, and the raid's from every raider running CRT, for the
-- Your repairs and Raid costs cards and columns (SeasonStats/Page.lua). Nothing here is saved; the counters are
-- Data.lua's (repairs, repairPulls, raidRepairs, raidReporters, raidPulls).
--
-- Your bill is what the game would charge to repair your gear: each damaged item's repairCost in its tooltip data
-- (C_TooltipInfo.GetInventoryItem("player", slot), a data call that draws no tooltip; checked 2026-10-24 on
-- warcraft.wiki.gg and in Blizzard's TooltipDataRules.lua, which reads tooltipData.repairCost). It's read at
-- ENCOUNTER_START and again out of combat after ENCOUNTER_END (at once, or on PLAYER_REGEN_ENABLED), so a release
-- and run back adds nothing. When the read at the pull fails (a secret or missing cost), the last read out of
-- combat stands in: on entering the raid, after the last pull, and when a vendor or repair bot closes. A smaller
-- bill after the pull than before (repaired) counts nothing. The bill is added to the counters the Timeline's save
-- hook counted the pull in (Stats:Record calls Rep:Claim), once, so a pull the Timeline doesn't keep adds nothing.
--
-- Cheap on every computer: the events are only listened to inside a raid instance, PLAYER_REGEN_ENABLED only while
-- a pull waits for its read; a read asks 17 slots' durability (GetInventoryItemDurability) and reads tooltip data
-- only for damaged slots, and only when the durability changed since the last read. No OnUpdate.
--
-- The raid's costs: after its read, each raider's CRT sends one message under the prefix CRTRepair to the raid
-- (never in combat; never in Raid Finder, a finder group or outside a raid group):
--   "<version>|<encounterID>|<group>|<start>|<copper>"   e.g. "1|3129|mythic|1793232000|7000"
-- start is the pull's start on the server's clock (GetServerTime, the same on every computer), so the reports of
-- one pull agree within MATCH seconds. A newer version may add fields after these. Every CRT client in the raid adds
-- what it hears to the boss's raid costs: one report per sender per pull (duplicates and your own echo ignored,
-- secret senders never compared), your own included. Raiders without CRT send nothing, so aren't counted.

local Stats = CRT.SeasonStats
local Rep = {}
CRT.SeasonRepairs = Rep

Rep.PREFIX = "CRTRepair"
Rep.VERSION = 1
Rep.MATCH = 10 -- seconds between two starts of the same pull (two computers, or the Timeline's and this one's)
Rep.MAX_COST = 50000000 -- copper: more than any raider's pull could cost (5,000 gold), so a broken message
Rep.FIRST_SLOT, Rep.LAST_SLOT = 1, 17 -- head to off hand; the shirt, ranged and tabard slots have no durability
Rep.KEEP = 4 -- pulls read after kept for the Timeline's save, starts kept per boss, messages waiting to go
Rep.TRIES = 3 -- tries to send a message the game throttled
Rep.RETRY = 2 -- seconds before trying again
Rep.FIRE_DELAY = 1 -- seconds of reports added up before the page is told

local FINDER = { [7] = true, [17] = true } -- Raid Finder difficulties
local RESULT = Enum and Enum.SendAddonMessageResult or {}
local THROTTLED = RESULT.AddonMessageThrottle or 3
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
local cache -- the last read: { sig = durability, cost }
local baseline -- the last bill read out of combat
local pending -- the pull running: { encounterID, difficultyID, group, at = time(), key = server time, before, ended }
local finished = {} -- pulls read after, newest last: pending plus cost, claimed, counters
local heard = {} -- [sender] = { ["encounterID|group"] = start of the last report }
local starts = {} -- ["encounterID|group"] = the starts of the last pulls reported, newest last
local queue = {} -- messages waiting to go
local fireQueued = false

-- Reading your bill --------------------------------------------------------------------------------------------------

-- Every slot's durability as one text, and the damaged slots; nil when a value is secret.
local function durability()
    local parts, damaged = {}, {}
    for slot = Rep.FIRST_SLOT, Rep.LAST_SLOT do
        local ok, cur, max = pcall(GetInventoryItemDurability, slot)
        if ok and cur ~= nil then
            if not (readable(cur) and readable(max)) then
                return nil
            end
            if type(cur) == "number" and type(max) == "number" then
                parts[#parts + 1] = slot .. ":" .. cur .. "/" .. max
                if cur < max then
                    damaged[#damaged + 1] = slot
                end
            end
        end
    end
    return table.concat(parts, ","), damaged
end

-- Your gear's repair bill in copper, or nil when it can't be read (a damaged item's cost secret or missing).
-- Unchanged durability gives the last read again without asking the game.
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

local function sendNext(tries)
    local text = queue[1]
    if not text then
        return
    end
    if InCombatLockdown() or not Rep.CanShare() or not (C_ChatInfo and C_ChatInfo.SendAddonMessage) then
        wipe(queue)
        return
    end
    local ok, result = pcall(C_ChatInfo.SendAddonMessage, Rep.PREFIX, text, "RAID")
    if ok and result == THROTTLED and tries < Rep.TRIES then
        C_Timer.After(Rep.RETRY, function()
            sendNext(tries + 1)
        end)
        return
    end
    table.remove(queue, 1)
    if queue[1] then
        C_Timer.After(Rep.RETRY, function()
            sendNext(1)
        end)
    end
end

local function send(text)
    queue[#queue + 1] = text
    while #queue > Rep.KEEP do
        table.remove(queue, 1)
    end
    if #queue == 1 then
        sendNext(1)
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

-- Adds one raider's report to the raid's costs, unless that sender already reported that pull. Returns true when
-- it counted.
function Rep:Hear(sender, encounterID, group, start, copper)
    local id = encounterID .. "|" .. group
    local mine = heard[sender]
    if not mine then
        mine = {}
        heard[sender] = mine
    end
    if mine[id] and math.abs(mine[id] - start) <= Rep.MATCH then
        return false
    end
    mine[id] = start
    local list = starts[id]
    if not list then
        list = {}
        starts[id] = list
    end
    local newPull = true
    for _, s in ipairs(list) do
        if math.abs(s - start) <= Rep.MATCH then
            newPull = false
            break
        end
    end
    if newPull then
        list[#list + 1] = start
        while #list > Rep.KEEP do
            table.remove(list, 1)
        end
    end
    Stats:AddRaidRepair(encounterID, group, copper, newPull)
    queueFire()
    return true
end

-- One pull ----------------------------------------------------------------------------------------------------------

local function sameStart(p, pull)
    return p.encounterID == pull.encounterID and type(pull.startedAt) == "number" and math.abs(p.at - pull.startedAt) <= Rep.MATCH
end

-- Gives a pull's bill to the counters the Timeline's save counted it in (Stats:Record), once. A pull still waiting
-- for its read after gets it when the read finishes.
function Rep:Claim(pull, c)
    if type(c) ~= "table" or type(pull) ~= "table" then
        return false
    end
    for i = #finished, 1, -1 do
        local p = finished[i]
        if not p.claimed and sameStart(p, pull) then
            p.claimed = true
            Stats:AddRepair(c, p.cost)
            return true
        end
    end
    if pending and not pending.claimed and sameStart(pending, pull) then
        pending.claimed, pending.counters = true, c
        return true
    end
    return false
end

local function finish(p)
    finished[#finished + 1] = p
    while #finished > Rep.KEEP do
        table.remove(finished, 1)
    end
    if p.counters then
        Stats:AddRepair(p.counters, p.cost)
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
    if not (p and p.ended) then
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
    if before == nil then
        return
    end
    local diff = readable(difficultyID) and type(difficultyID) == "number" and difficultyID or nil
    pending = {
        encounterID = encounterID, difficultyID = diff, group = diff and Stats.GroupOf(diff) or nil,
        at = time(), key = GetServerTime and GetServerTime() or time(), before = before,
    }
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

local LIVE = { "ENCOUNTER_START", "ENCOUNTER_END", "MERCHANT_CLOSED", "CHAT_MSG_ADDON" }

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
    elseif event == "MERCHANT_CLOSED" and not pending then
        outOfCombatRead()
    end
end

driver:RegisterEvent("PLAYER_ENTERING_WORLD")
driver:SetScript("OnEvent", function(_, event, ...)
    Rep.HandleEvent(event, ...)
end)
