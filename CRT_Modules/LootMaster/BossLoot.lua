local ADDON, CRT = ...

-- The raid leader's Boss loot list, with no frames (the window is LootMaster/BossLootWindow.lua). Alex,
-- 2026-10-20: "all loot is held for rolls until the raid lead clicks 'start session'". One row per boss
-- roll the leader's CRT handled (LootMaster/Rolls.lua), in the order they started:
--   rollID, link, itemString, ilvl, at (GetTime), expires (GetTime when its kill is LM.BOSS_SECONDS old)
--   pass, why      the loot filter's word (LM:FilterLoot as boss loot): passed, else why not
--   ticked         in the next session; pre-ticked when it passed the filter
--   status         "rolling" (CRT rolled rollType), "won" (you won it), "lost" (winner won it),
--                  "nowinner" (everyone passed) or "cant" (CRT couldn't roll: reason)
-- Only a won row can go into a session. Start session (BL:Start) starts LM:Start with the ticked rows you
-- have won, LM.MAX_ITEMS a session, the rest after it ends. It waits while a ticked row is still rolling,
-- or a session is running: untick a row to leave it out. Nothing starts a session on its own.
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
-- A result is matched to the oldest row still rolling with the same item string, else the same item ID.
-- A winner that can't be read (a secret value, a failing call) leaves the row rolling.

local LM = CRT.LootMaster
local BL = { rows = {}, waiting = {} }
LM.BossLoot = BL

local TEXT = {
    cleared = "Loot Master cleared the boss loot list: %s.",
    left = "you left the instance",
    off = "CRT Looting is off",
    dropped = "Loot Master dropped the waiting boss loot: %s.",
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

local function changed(what)
    LM:Fire("bossloot", what or "changed")
end

-- Expiry ---------------------------------------------------------------------------------------------

local function expire()
    local now, kept, n = GetTime(), {}, #BL.rows
    for _, r in ipairs(BL.rows) do
        if not (r.expires and now >= r.expires) then
            kept[#kept + 1] = r
        end
    end
    if #kept ~= n then
        BL.rows = kept
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
    if first then
        self.instance = LM.InstanceKey()
        self.boss = kill and kill.name or nil
        local ok, _, _, _, difficultyName = pcall(GetInstanceInfo)
        self.difficulty = (ok and type(difficultyName) == "string" and not secret(difficultyName)) and difficultyName or nil
    end
    local pass, why = LM:FilterLoot(s, "boss", link)
    local okL, ilvl = pcall(C_Item.GetDetailedItemLevelInfo, link)
    local age = (kill and type(kill.at) == "number") and math.max(0, time() - kill.at) or 0
    local r = {
        rollID = rollID, link = link, itemString = s, ilvl = (okL and type(ilvl) == "number" and not secret(ilvl)) and ilvl or nil,
        at = GetTime(), expires = GetTime() + math.max(0, LM.BOSS_SECONDS - age), pass = pass and true or false, why = why,
        status = fields.status, rollType = fields.rollType, reason = fields.reason,
    }
    r.ticked = r.pass and r.status ~= "cant"
    self.rows[#self.rows + 1] = r
    C_Timer.After(r.expires - GetTime() + 0.05, expire)
    changed(first and "open" or "changed")
    return r
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

-- Whether Start session can run now: true, or false and why ("session", "rolling", "none").
function BL:CanStart()
    local _, _, rolling, won = self:Counts()
    if LM.current or #self.waiting > 0 then
        return false, "session"
    elseif rolling > 0 then
        return false, "rolling"
    elseif won == 0 then
        return false, "none"
    end
    return true
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
    LM:Start(w.items)
    changed()
end

-- Start session: the ticked rows you have won, LM.MAX_ITEMS a session. They leave the list. Returns
-- the number of items sent, or false and why (BL:CanStart).
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
    self.rows = kept
    for i = 1, #items, LM.MAX_ITEMS do
        local chunk = {}
        for j = i, math.min(#items, i + LM.MAX_ITEMS - 1) do
            chunk[#chunk + 1] = items[j]
        end
        self.waiting[#self.waiting + 1] = { items = chunk, at = GetTime() }
    end
    startNext()
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

-- The oldest row still rolling for this item: the same item string first, else the same item ID.
local function rowFor(link)
    local s = LM.LinkItemString(link)
    local id = itemID(s)
    local byID
    for _, r in ipairs(BL.rows) do
        if r.status == "rolling" then
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

-- A roll's result: who won (full or short name), whether it was you, or nobody (everyone passed).
function BL:Result(link, winner, isSelf, allPassed)
    local r = rowFor(link)
    if not r then
        return false
    end
    if isSelf == true then
        r.status, r.winner = "won", nil
    elseif allPassed == true then
        r.status, r.ticked = "nowinner", false
    elseif type(winner) == "string" and winner ~= "" then
        r.status, r.winner, r.ticked = "lost", winner, false
    else
        return false
    end
    changed()
    return true
end

local function fromHistory(encounterID, lootListID)
    if not readable(encounterID, lootListID) or #BL.rows == 0 or not (C_LootHistory and C_LootHistory.GetSortedInfoForDrop) then
        return
    end
    local ok, info = pcall(C_LootHistory.GetSortedInfoForDrop, encounterID, lootListID)
    if not ok or type(info) ~= "table" or not readable(info.itemHyperlink, info.allPassed) then
        return
    end
    local w = type(info.winner) == "table" and info.winner or nil
    if w and readable(w.playerName, w.isSelf) then
        BL:Result(info.itemHyperlink, w.playerName, w.isSelf == true, false)
    elseif info.allPassed == true then
        BL:Result(info.itemHyperlink, nil, false, true)
    end
end

local function received(_, _, link, _, playerName)
    if not readable(link, playerName) or #BL.rows == 0 or type(playerName) ~= "string" then
        return
    end
    local me = LM:Me()
    local full = LM.FullName(playerName)
    BL:Result(link, playerName, full ~= nil and full == me, false)
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
