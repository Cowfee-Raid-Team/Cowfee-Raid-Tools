local ADDON, CRT = ...

-- Loot History's store, in its own saved variable, CRTLootDB, so CRTDB stays small:
--   version   the schema (SCHEMA); Migrate brings an older one up to date
--   players, instances   names kept once each (interned), records point at them by index
--   bosses    encounterID -> boss name, as the game named it when the boss was killed
--   months    ["2026-10"] = { record, ... } in the order they were added
-- A record is a small array (the R index names its fields):
--   { time, encounterID, instanceIdx, difficultyID, playerIdx, classID, quantity, itemString,
--     rollType, lootListID }
-- itemString is "item:..." from the link (the name comes from the game's item cache when shown).
-- rollType: 0 or 1 need, 2 transmog, 3 greed, 4 no roll, 5 pass, nil not known (personal loot).
-- Settings are in CRTDB.loot (per profile): minQuality, dungeons, keepMonths, rcEnrich, tooltipPosition.
-- RCLootCouncil's awards matched to records (Loot/RCLC.lua) are kept only for the session, in
-- Loot.rc[record], since they can be read again from RCLootCouncil at any time.

local Loot = { listeners = {}, rc = {} }
CRT.Loot = Loot

local SCHEMA = 1
Loot.R = { TIME = 1, ENC = 2, INST = 3, DIFF = 4, PLAYER = 5, CLASS = 6, QTY = 7, ITEM = 8, ROLL = 9, LIST = 10 }
local R = Loot.R

Loot.ROLLS = {
    [0] = "Need", [1] = "Need (off spec)", [2] = "Transmog", [3] = "Greed", [4] = "No roll", [5] = "Pass",
}

local reverse = { players = {}, instances = {} } -- name -> index, built at load

local function db()
    return CRTLootDB
end

function Loot:Settings()
    return CRT.db.loot
end

function Loot:OnChange(fn)
    self.listeners[#self.listeners + 1] = fn
end

-- what: "added" (with the record and its month), "changed" (a record updated in place) or "reset"
-- (anything else: a delete, a prune, an RCLootCouncil scan).
function Loot:Fire(what, record, month)
    for _, fn in ipairs(self.listeners) do
        local ok, err = pcall(fn, what, record, month)
        if not ok then
            geterrorhandler()(err)
        end
    end
end

-- Schema --------------------------------------------------------------------------------------

-- Each step takes the table from one version to the next. None yet: version 1 is the first.
local MIGRATIONS = {}

local function rebuildReverse()
    for kind, map in pairs(reverse) do
        wipe(map)
        for i, name in ipairs(db()[kind]) do
            map[name] = i
        end
    end
end

function Loot:Migrate()
    CRTLootDB = type(CRTLootDB) == "table" and CRTLootDB or {}
    local d = CRTLootDB
    d.version = d.version or SCHEMA
    while d.version < SCHEMA do
        local step = MIGRATIONS[d.version]
        if step then
            step(d)
        end
        d.version = d.version + 1
    end
    d.players = d.players or {}
    d.instances = d.instances or {}
    d.bosses = d.bosses or {}
    d.months = d.months or {}
    rebuildReverse()
end

-- Names ---------------------------------------------------------------------------------------

function Loot:Intern(kind, name)
    if type(name) ~= "string" or name == "" then
        return nil
    end
    local i = reverse[kind][name]
    if not i then
        local list = db()[kind]
        list[#list + 1] = name
        i = #list
        reverse[kind][name] = i
    end
    return i
end

function Loot:Name(kind, index)
    return index and db()[kind][index] or nil
end

function Loot:Boss(encounterID)
    return encounterID and db().bosses[encounterID] or nil
end

-- The encounter ID a boss name was recorded under, or nil (for awards that carry only a name).
function Loot:BossID(name)
    if type(name) ~= "string" then
        return nil
    end
    for id, n in pairs(db().bosses) do
        if n == name then
            return id
        end
    end
    return nil
end

function Loot:SetBoss(encounterID, name)
    if encounterID and type(name) == "string" and name ~= "" then
        db().bosses[encounterID] = name
    end
end

-- Records -------------------------------------------------------------------------------------

function Loot.MonthOf(t)
    return date("%Y-%m", t)
end

-- Adds a record (fields by name, see the top). Returns the record and its month.
function Loot:Add(f)
    local t = f.time or time()
    local rec = {
        t, f.encounterID or 0, self:Intern("instances", f.instance), f.difficultyID or 0,
        self:Intern("players", f.player), f.classID or 0, f.quantity or 1, f.itemString, f.rollType, f.lootListID,
    }
    local month = Loot.MonthOf(t)
    local months = db().months
    months[month] = months[month] or {}
    table.insert(months[month], rec)
    self:Fire("added", rec, month)
    return rec, month
end

-- Updates fields of a record in place (winner, class, roll, loot list ID).
function Loot:Update(rec, f)
    if f.player then
        rec[R.PLAYER] = self:Intern("players", f.player)
    end
    if f.classID then
        rec[R.CLASS] = f.classID
    end
    if f.rollType ~= nil then
        rec[R.ROLL] = f.rollType
    end
    if f.lootListID then
        rec[R.LIST] = f.lootListID
    end
    if f.quantity then
        rec[R.QTY] = f.quantity
    end
    self:Fire("changed", rec)
end

-- Every record with its month, newest month first, newest first within it: fn(rec, month).
function Loot:Each(fn)
    local keys = {}
    for month in pairs(db().months) do
        keys[#keys + 1] = month
    end
    table.sort(keys, function(a, b)
        return a > b
    end)
    for _, month in ipairs(keys) do
        local list = db().months[month]
        for i = #list, 1, -1 do
            fn(list[i], month)
        end
    end
end

function Loot:Months()
    local keys = {}
    for month, list in pairs(db().months) do
        if #list > 0 then
            keys[#keys + 1] = month
        end
    end
    table.sort(keys, function(a, b)
        return a > b
    end)
    return keys
end

function Loot:Count()
    local n = 0
    for _, list in pairs(db().months) do
        n = n + #list
    end
    return n
end

function Loot.ItemID(itemString)
    return tonumber(type(itemString) == "string" and itemString:match("^item:(%d+)") or nil)
end

-- Deleting ------------------------------------------------------------------------------------

function Loot:Delete(rec, month)
    local list = db().months[month]
    for i, r in ipairs(list or {}) do
        if r == rec then
            table.remove(list, i)
            if #list == 0 then
                db().months[month] = nil
            end
            self.rc[rec] = nil
            self:Fire("reset")
            return true
        end
    end
    return false
end

-- Removes every month before the given one ("2026-01"). Returns how many records went.
function Loot:DeleteBefore(month)
    local gone = 0
    for m, list in pairs(db().months) do
        if m < month then
            gone = gone + #list
            db().months[m] = nil
        end
    end
    if gone > 0 then
        self:Compact()
        self:Fire("reset")
    end
    return gone
end

-- Keeps the newest keep months (0 keeps everything). Returns how many records went.
function Loot:Prune(keep)
    keep = tonumber(keep) or 0
    if keep <= 0 then
        return 0
    end
    local now = date("*t")
    local y, m = now.year, now.month - (keep - 1)
    while m < 1 do
        m = m + 12
        y = y - 1
    end
    return self:DeleteBefore(string.format("%04d-%02d", y, m))
end

function Loot:DeleteAll()
    local d = db()
    d.months, d.players, d.instances, d.bosses = {}, {}, {}, {}
    wipe(self.rc)
    rebuildReverse()
    self:Fire("reset")
end

-- Drops names no record uses any more, renumbering the rest. Run after a big delete.
function Loot:Compact()
    local d = db()
    for _, spec in ipairs({ { "players", R.PLAYER }, { "instances", R.INST } }) do
        local kind, field = spec[1], spec[2]
        local used = {}
        for _, list in pairs(d.months) do
            for _, rec in ipairs(list) do
                if rec[field] then
                    used[rec[field]] = true
                end
            end
        end
        local newList, newIndex = {}, {}
        for i, name in ipairs(d[kind]) do
            if used[i] then
                newList[#newList + 1] = name
                newIndex[i] = #newList
            end
        end
        for _, list in pairs(d.months) do
            for _, rec in ipairs(list) do
                if rec[field] then
                    rec[field] = newIndex[rec[field]]
                end
            end
        end
        d[kind] = newList
    end
    rebuildReverse()
end

local events = CreateFrame("Frame")
events:RegisterEvent("ADDON_LOADED")
events:RegisterEvent("PLAYER_LOGIN")
events:SetScript("OnEvent", function(self, event, name)
    if event == "ADDON_LOADED" and name == ADDON then
        Loot:Migrate()
        self:UnregisterEvent("ADDON_LOADED")
    elseif event == "PLAYER_LOGIN" then
        local keep = Loot:Settings().keepMonths
        if keep and keep > 0 then
            Loot:Prune(keep)
        end
    end
end)
