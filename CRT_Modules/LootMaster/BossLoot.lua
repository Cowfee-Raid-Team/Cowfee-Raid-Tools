local ADDON, CRT = ...

-- The raid leader's Boss loot list, with no frames (the window is LootMaster/BossLootWindow.lua). Alex,
-- 2026-10-20: "all loot is held for rolls until the raid lead clicks 'start session'". One row per boss
-- roll the leader's CRT handled (LootMaster/Rolls.lua), in the order they started:
--   rollID, link, itemString, ilvl, at (GetTime), expires (GetTime when its kill is LM.BOSS_SECONDS old)
--   pass, why      the loot filter's word (LM:FilterLoot as boss loot): passed, else why not
--   ticked         in the next session; pre-ticked when it passed the filter
--   status         "rolling" (CRT rolled rollType), "won" (you won it), "lost" (winner won it),
--                  "nowinner" (everyone passed) or "cant" (CRT couldn't roll: reason)
--   received       true for an item the game gave you with no roll (rollID is then CRT's own, below 0)
-- Only a won row can go into a session. Start session (BL:Start) starts LM:Start with the ticked rows you
-- have won, LM.MAX_ITEMS a session, the rest after it ends. It waits while a ticked row is still rolling:
-- untick a row to leave it out. Nothing starts a session on its own. Alex, 2026-10-21: Start session should
-- work "in all cases": a test session still running is ended first, and a real one keeps going while
-- these wait their turn; either way the Loot Master window shows.
-- The list empties on Clear, on leaving the instance, when CRT Looting turns off (the lead lost too), and
-- row by row LM.BOSS_SECONDS after its kill. Changes fire LM:Fire("bossloot", what): "open" (the first
-- row of a new list: the window shows), "changed" or "cleared".
--
-- Who won, from the game (checked 2026-10-20):
--   LOOT_HISTORY_UPDATE_DROP (encounterID, lootListID): https://warcraft.wiki.gg/wiki/LOOT_HISTORY_UPDATE_DROP;
--     the drop is read with C_LootHistory.GetSortedInfoForDrop(encounterID, lootListID):
--     https://warcraft.wiki.gg/wiki/API_C_LootHistory.GetSortedInfoForDrop (itemHyperlink, winner with
--     playerName and isSelf, allPassed). The main source, as Loot History's (Loot/Capture.lua).
--   ENCOUNTER_LOOT_RECEIVED (encounterID, itemID, itemLink, quantity, playerName, classFileName):
--     https://warcraft.wiki.gg/wiki/ENCOUNTER_LOOT_RECEIVED. A second word on who got it.
-- A result is matched to the oldest row still rolling from the same boss (the kill's encounterID) with
-- the same item string, else the same item ID. Each history drop sets a row once, and the two sources
-- count against each other per boss and item, so a drop both report sets one row only.
-- A winner that can't be read (a secret value, a failing call) leaves the row rolling.
--
-- Received loot (Alex, 2026-10-21: old raids never started a session). A raid the game runs with no
-- loot rolls (an old raid on Legacy Loot) hands each item straight to a player, and only
-- ENCOUNTER_LOOT_RECEIVED tells. While CRT Looting is on and you lead it, an item it says you received
-- after a kill with no roll goes on the list as won, so Start session can give it out. A kill the game
-- rolled on (BL:SawRoll, from LootMaster/Rolls.lua) never adds one, so a rolled drop isn't listed twice.
-- Other players' items are theirs: only what is in your bags can be given out. Whether the game lets you
-- trade it is the game's rule; the trade says so.

local LM = CRT.LootMaster
local BL = { rows = {}, waiting = {} }
LM.BossLoot = BL

local TEXT = {
    cleared = "Loot Master cleared the boss loot list: %s.",
    left = "you left the instance",
    off = "CRT Looting is off",
    dropped = "Loot Master dropped the waiting boss loot: %s.",
    testEnded = "Loot Master ended the test session to start this one.",
    queued = "Loot Master: %d %s will start when the running session ends.",
    expired = "Loot Master: %d won %s left the boss loot list 10 minutes after the kill, with no session started.",
    tooOld = "it waited over 10 minutes",
}

local function secret(v)
    return issecretvalue and issecretvalue(v) or false
end

local function readable(...)
    for i = 1, select("#", ...) do
        if secret((select(i, ...))) then
            return false
        end
    end
    return true
end

-- The link's item string, its empty tail dropped so a message stays small.
function LM.LinkItemString(link)
    local s = type(link) == "string" and link:match("|H(item:[^|]+)|h")
    return s and (s:gsub(":+$", "")) or nil
end

local function itemID(s)
    return tonumber(tostring(s or ""):match("item:(%d+)"))
end

-- Results already applied: each drop once ({ ["<encounterID>:<lootListID>"] = true }), and per item string
-- how many rows a result has set, and how many results each source has given, so the loot history and
-- the receive event for the same drop count once.
local applied, fromSource = {}, { history = {}, received = {} }
local rolledKill -- the kill (its time) the game last started a roll after, while you led CRT Looting
local nextOwn = 0 -- received rows' rollIDs: -1, -2, … so they never meet the game's

local function changed(what)
    if #BL.rows == 0 then
        BL.boss, BL.difficulty = nil, nil -- the badge follows the next kill's rows
        applied, fromSource = {}, { history = {}, received = {} }
    end
    LM:Fire("bossloot", what or "changed")
end

-- Expiry ---------------------------------------------------------------------------------------------

local function expire()
    local now, kept, n, won = GetTime(), {}, #BL.rows, 0
    for _, r in ipairs(BL.rows) do
        if not (r.expires and now >= r.expires) then
            kept[#kept + 1] = r
        elseif r.status == "won" then
            won = won + 1
        end
    end
    if #kept ~= n then
        BL.rows = kept
        if won > 0 then
            CRT:Print(TEXT.expired:format(won, won == 1 and "item" or "items"))
        end
        changed(#kept == 0 and "cleared" or "changed")
    end
end

-- Rows -----------------------------------------------------------------------------------------------

function BL:Rows()
    return self.rows
end

function BL:Row(rollID)
    for _, r in ipairs(self.rows) do
        if r.rollID == rollID then
            return r
        end
    end
    return nil
end

-- A boss roll the leader's CRT handled. fields: status ("rolling" or "cant"), rollType, reason. kill:
-- LM:LastKill(). Returns the row, or nil without a link (the caller says so in chat).
function BL:Add(rollID, link, fields, kill)
    local s = LM.LinkItemString(link)
    if not s or self:Row(rollID) then
        return nil
    end
    local first = #self.rows == 0
    -- the badge shows the newest kill's boss
    self.instance = LM.InstanceKey()
    self.boss = kill and kill.name or self.boss
    local ok, _, _, _, difficultyName = pcall(GetInstanceInfo)
    self.difficulty = (ok and type(difficultyName) == "string" and not secret(difficultyName)) and difficultyName or nil
    local pass, why = LM:FilterLoot(s, "boss", link)
    local okL, ilvl = pcall(C_Item.GetDetailedItemLevelInfo, link)
    local age = (kill and type(kill.at) == "number") and math.max(0, time() - kill.at) or 0
    local r = {
        rollID = rollID, link = link, itemString = s, ilvl = (okL and type(ilvl) == "number" and not secret(ilvl)) and ilvl or nil,
        at = GetTime(), expires = GetTime() + math.max(0, LM.BOSS_SECONDS - age), pass = pass and true or false, why = why,
        status = fields.status, rollType = fields.rollType, reason = fields.reason, received = fields.received,
        encounterID = kill and kill.encounterID or nil,
    }
    r.ticked = r.pass and r.status ~= "cant"
    self.rows[#self.rows + 1] = r
    C_Timer.After(r.expires - GetTime() + 0.05, expire)
    changed(first and "open" or "changed")
    return r
end

-- The game started a roll after this kill (LM:LastKill()): items received from it came from rolls.
function BL:SawRoll(kill)
    rolledKill = kill and kill.at or rolledKill
end

-- An item the game gave you after kill with no roll: a won row, or nil (no link, or already listed).
function BL:AddReceived(link, kill)
    nextOwn = nextOwn - 1
    return self:Add(nextOwn, link, { status = "won", received = true }, kill)
end

-- Whether a row can be ticked: only one that is yours or may still be.
function BL.Tickable(r)
    return r.status == "rolling" or r.status == "won"
end

function BL:SetTicked(rollID, on)
    local r = self:Row(rollID)
    if r and BL.Tickable(r) then
        r.ticked = on and true or false
        changed()
    end
end

-- ticked, rows, ticked rows still rolling, ticked rows won.
function BL:Counts()
    local ticked, rolling, won = 0, 0, 0
    for _, r in ipairs(self.rows) do
        if r.ticked then
            ticked = ticked + 1
            if r.status == "rolling" then
                rolling = rolling + 1
            elseif r.status == "won" then
                won = won + 1
            end
        end
    end
    return ticked, #self.rows, rolling, won
end

-- Whether Start session can run now: true, or false and why ("rolling", "none"). A running session
-- doesn't stop it (BL:Start); BL:Busy says one is.
function BL:CanStart()
    local _, _, rolling, won = self:Counts()
    if rolling > 0 then
        return false, "rolling"
    elseif won == 0 then
        return false, "none"
    end
    return true
end

-- Whether a real loot session is running or boss loot waits for one: Start session queues behind it.
function BL:Busy()
    return (LM.current and not LM.current.test) or #self.waiting > 0
end

local function startNext()
    if LM.current or #BL.waiting == 0 then
        return
    end
    local w = table.remove(BL.waiting, 1)
    if GetTime() - w.at > LM.BOSS_SECONDS then
        BL.waiting = {}
        CRT:Print(TEXT.dropped:format(TEXT.tooOld))
        changed()
        return
    end
    if not LM:Start(w.items) then
        table.insert(BL.waiting, 1, w) -- LM:Start said why; tried again when a session ends
    end
    changed()
end

-- Start session: the ticked rows you have won, LM.MAX_ITEMS a session. A running test is ended first; a
-- running real session keeps going and these all wait for it. They leave the list once the first session
-- has started or they are waiting; when LM:Start refuses (it says why), they stay. The Loot Master window
-- shows either way. Returns the number of items sent, or false and why (BL:CanStart's, or "failed").
function BL:Start()
    local ok, why = self:CanStart()
    if not ok then
        return false, why
    end
    local items, kept = {}, {}
    for _, r in ipairs(self.rows) do
        if r.ticked and r.status == "won" then
            items[#items + 1] = { itemString = r.itemString, link = r.link, ilvl = r.ilvl }
        else
            kept[#kept + 1] = r
        end
    end
    local chunks = {}
    for i = 1, #items, LM.MAX_ITEMS do
        local chunk = {}
        for j = i, math.min(#items, i + LM.MAX_ITEMS - 1) do
            chunk[#chunk + 1] = items[j]
        end
        chunks[#chunks + 1] = { items = chunk, at = GetTime() }
    end
    if self:Busy() then
        self.rows = kept
        for _, c in ipairs(chunks) do
            self.waiting[#self.waiting + 1] = c
        end
        CRT:Print(TEXT.queued:format(#items, #items == 1 and "item" or "items"))
        startNext() -- boss loot left waiting by a refused start goes now, when nothing runs
        changed()
        if LM.current then
            LM:ShowWindow()
        end
        return #items
    end
    if LM.current and LM.current.test then
        LM:End()
        CRT:Print(TEXT.testEnded)
    end
    if not LM:Start(chunks[1].items) then
        changed()
        return false, "failed"
    end
    self.rows = kept
    for i = 2, #chunks do
        self.waiting[#self.waiting + 1] = chunks[i]
    end
    changed()
    return #items
end

-- Empties the list (why: words for chat, or nil for the Clear button) and drops the waiting sessions.
function BL:Clear(why)
    local had = #self.rows > 0 or #self.waiting > 0
    self.rows, self.waiting = {}, {}
    if had then
        if why then
            CRT:Print(TEXT.cleared:format(why))
        end
        changed("cleared")
    end
end

-- Results --------------------------------------------------------------------------------------------

-- The oldest row still rolling for this item from this boss (encounterID; nil matches any): the same
-- item string first, else the same item ID.
local function rowFor(link, encounterID)
    local s = LM.LinkItemString(link)
    local id = itemID(s)
    local byID
    for _, r in ipairs(BL.rows) do
        if r.status == "rolling" and (encounterID == nil or r.encounterID == nil or r.encounterID == encounterID) then
            if s and r.itemString == s then
                return r
            end
            if not byID and id and itemID(r.itemString) == id then
                byID = r
            end
        end
    end
    return byID
end

-- A roll's result from source ("history" or "received"): who won (full or short name), whether it was
-- you, or nobody (everyone passed). Each source's nth result for a boss's item is the nth drop of it, so
-- a drop both sources report sets one row only. Returns true when a row changed.
function BL:Result(link, winner, isSelf, allPassed, encounterID, source)
    local r = rowFor(link, encounterID)
    if not r then
        return false
    end
    if not (isSelf == true or allPassed == true or (type(winner) == "string" and winner ~= "")) then
        return false
    end
    local key = tostring(r.encounterID or encounterID or "?") .. ":" .. tostring(itemID(r.itemString))
    local seen = fromSource[source or "history"] or fromSource.history
    seen[key] = (seen[key] or 0) + 1
    if seen[key] <= (applied[key] or 0) then
        return false -- the other source has told this drop already
    end
    applied[key] = (applied[key] or 0) + 1
    if isSelf == true then
        r.status, r.winner = "won", nil
    elseif allPassed == true then
        r.status, r.ticked = "nowinner", false
    else
        r.status, r.winner, r.ticked = "lost", winner, false
    end
    changed()
    return true
end

local drops = {} -- the history's drops that set a row: { ["<encounterID>:<lootListID>"] = true }

local function fromHistory(encounterID, lootListID)
    if not readable(encounterID, lootListID) or #BL.rows == 0 or not (C_LootHistory and C_LootHistory.GetSortedInfoForDrop) then
        return
    end
    local drop = tostring(encounterID) .. ":" .. tostring(lootListID)
    if drops[drop] then
        return -- its winner is in already; later updates of the same drop change nothing
    end
    local ok, info = pcall(C_LootHistory.GetSortedInfoForDrop, encounterID, lootListID)
    if not ok or type(info) ~= "table" or not readable(info.itemHyperlink, info.allPassed) then
        return
    end
    local w = type(info.winner) == "table" and info.winner or nil
    local set = false
    if w and readable(w.playerName, w.isSelf) then
        set = BL:Result(info.itemHyperlink, w.playerName, w.isSelf == true, false, encounterID, "history")
    elseif info.allPassed == true then
        set = BL:Result(info.itemHyperlink, nil, false, true, encounterID, "history")
    end
    if set or (w and readable(w.playerName)) or info.allPassed == true then
        drops[drop] = true
    end
end

-- An item the game gave you with no roll, after a kill here while you lead CRT Looting.
local function receivedDirect(link, encounterID)
    local kill = LM:LastKill()
    if not kill or rolledKill == kill.at or not LM:LootingOn() or not LM.InstanceKey() or kill.instance ~= LM.InstanceKey() then
        return
    end
    if kill.encounterID and encounterID and kill.encounterID ~= encounterID then
        return
    end
    BL:AddReceived(link, kill)
end

local function received(encounterID, _, link, _, playerName)
    if not readable(encounterID, link, playerName) or type(playerName) ~= "string" or type(link) ~= "string" then
        return
    end
    local me = LM:Me()
    local full = LM.FullName(playerName)
    local isSelf = full ~= nil and full == me
    local enc = type(encounterID) == "number" and encounterID or nil
    if #BL.rows > 0 and BL:Result(link, playerName, isSelf, false, enc, "received") then
        return
    end
    if isSelf then
        receivedDirect(link, enc)
    end
end

-- Emptying -------------------------------------------------------------------------------------------

LM:OnChange(function(what)
    if what == "ended" then
        startNext()
    elseif what == "looting" and not LM:LootingOn() then
        BL:Clear(TEXT.off)
    end
end)

local events = CreateFrame("Frame")
for _, e in ipairs({ "PLAYER_ENTERING_WORLD", "ZONE_CHANGED_NEW_AREA", "ENCOUNTER_LOOT_RECEIVED" }) do
    events:RegisterEvent(e)
end
pcall(events.RegisterEvent, events, "LOOT_HISTORY_UPDATE_DROP")
events:SetScript("OnEvent", function(_, event, ...)
    if event == "LOOT_HISTORY_UPDATE_DROP" then
        fromHistory(...)
    elseif event == "ENCOUNTER_LOOT_RECEIVED" then
        received(...)
    elseif (#BL.rows > 0 or #BL.waiting > 0) and LM.InstanceKey() ~= BL.instance then
        BL:Clear(TEXT.left)
    end
end)
