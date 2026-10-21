local ADDON, CRT = ...

-- Alert colours from the ability's type. Every alert (bar, circle, icon and text) is drawn in the colour of its
-- ability's type, the Timeline's ability types (Timeline/Reference.lua Reference.TYPES: dispel blue, soak pink,
-- Mythic only orange, ...). The type is found from the boss data the Timeline already has, in this order:
--   1. your own label for the ability on the Timeline (Timeline:Ability(boss, spell).type)
--   2. the boss's ability timeline: the row of the alert's spell (by spell ID, else by the spell's name or the
--      alert's text, as reminders find their times) and its first, main type. The difficulty's own ability
--      timelines are asked first, then the boss's others.
--   3. the Encounter Journal's icons for the spell (Reference.TAG_TYPES): a dispel icon is dispel, the Mythic and
--      Heroic icons are mythic and heroic; the first icon that is a type, as the Journal export writes it
-- With no known type an alert is drawn in the theme's accent (caramel). Which colour wins over the type's
-- (the raid leader's note colour, and yours with Use custom colours on) is Alerts:OwnColor (Alerts/Engine.lua).
-- Alerts:Start stamps each item's type as item.abilityType; the areas look the colour up as they draw
-- (Areas.DrawColor), so a theme switch follows. Nothing here is saved.
--   Colors.TypeOf(encounterID, spellID, text, bossName, difficultyName) -> a type key, or nil
--   Colors.TypeColor(key) -> { r, g, b }: the type's colour, else the theme's accent (nil with no theme loaded)
--   Colors.Stamp(items, run) sets abilityType on each item of a run that has no known type of its own

local Colors = {}
CRT.AlertColors = Colors

local ACCENT = "caramel" -- the style guide's accent

local function readable(v)
    local T = CRT.Timeline
    if T and T.readable then
        return T.readable(v)
    end
    return true
end

local function known(key)
    local Reference = CRT.TimelineReference
    return type(key) == "string" and Reference ~= nil and Reference.TYPES[key] ~= nil
end

-- The name of a boss you have pulls of (the Timeline's store), for a pull whose name the game hid.
local function recordedName(encounterID)
    local T = CRT.Timeline
    local ok, db = pcall(function()
        return T:Settings()
    end)
    local boss = ok and type(db) == "table" and type(db.bosses) == "table" and db.bosses[encounterID]
    return boss and type(boss.name) == "string" and boss.name or nil
end

-- The boss's references, the difficulty's own first.
local function references(encounterID, bossName, difficultyName)
    local Reference, T = CRT.TimelineReference, CRT.Timeline
    local ok, found = pcall(Reference.ForBoss, Reference, encounterID, bossName or recordedName(encounterID))
    if not ok or type(found) ~= "table" then
        return {}
    end
    local out, seen = {}, {}
    if Reference.ForGroup and T and T.GroupFor then
        local okG, own = pcall(function()
            return Reference:ForGroup(found, T:GroupFor(difficultyName))
        end)
        for _, entry in ipairs(okG and own or {}) do
            out[#out + 1] = entry
            seen[entry] = true
        end
    end
    for _, entry in ipairs(found) do
        if not seen[entry] then
            out[#out + 1] = entry
        end
    end
    return out
end

-- The reference row of the alert's ability, and its spell (its own [spell], else the Journal's of its name).
local function referenceRow(encounterID, spellID, text, bossName, difficultyName)
    local Reminders = CRT.AlertReminders
    if not (CRT.TimelineReference and Reminders and Reminders.RowFor) then
        return nil
    end
    local want = { spellID = spellID, text = text }
    for _, entry in ipairs(references(encounterID, bossName, difficultyName)) do
        local ok, row = pcall(Reminders.RowFor, entry.ref, encounterID, want)
        if ok and row then
            local Lanes = CRT.TimelineLanes
            local okS, id = false, nil
            if Lanes and Lanes.RowSpell then
                okS, id = pcall(Lanes.RowSpell, row, encounterID)
            end
            return row, okS and type(id) == "number" and id > 0 and id or nil
        end
    end
    return nil
end

-- Your own label's type for a spell of the boss (the Timeline's Journal list).
local function labelType(encounterID, spellID)
    local T = CRT.Timeline
    if not (spellID and T and T.Ability) then
        return nil
    end
    local ok, a = pcall(T.Ability, T, encounterID, spellID)
    return ok and type(a) == "table" and known(a.type) and a.type or nil
end

-- The type the Journal's icons give a spell of the boss. Journal:Rows only answers out of combat (its rows are
-- kept once read), so in a pull this works for a boss whose rows the Timeline already read.
local function journalType(encounterID, spellID)
    local Journal, Reference = CRT.TimelineJournal, CRT.TimelineReference
    if not (spellID and Journal and Journal.Rows and Reference and Reference.TAG_TYPES) then
        return nil
    end
    local ok, rows = pcall(Journal.Rows, Journal, encounterID)
    if not ok or type(rows) ~= "table" then
        return nil
    end
    for _, row in ipairs(rows) do
        if row.spellID == spellID then
            for _, tag in ipairs(type(row.tags) == "table" and row.tags or {}) do
                local t = Reference.TAG_TYPES[tag]
                if known(t) then
                    return t
                end
            end
            return nil
        end
    end
    return nil
end

function Colors.TypeOf(encounterID, spellID, text, bossName, difficultyName)
    if not CRT.TimelineReference then
        return nil
    end
    if not (readable(spellID) and type(spellID) == "number" and spellID > 0) then
        spellID = nil
    end
    if not (readable(text) and type(text) == "string") then
        text = nil
    end
    local row, rowSpell = referenceRow(encounterID, spellID, text, bossName, difficultyName)
    local spell = spellID or rowSpell
    local t = labelType(encounterID, spell)
    if t then
        return t
    end
    local main = row and type(row.types) == "table" and row.types[1]
    if known(main) then
        return main
    end
    return journalType(encounterID, spell)
end

function Colors.TypeColor(key)
    local Reference = CRT.TimelineReference
    local t = type(key) == "string" and Reference and Reference.TYPES[key]
    if t then
        return t.color
    end
    return CRT.MOCHA and CRT.MOCHA[ACCENT] or nil
end

-- Every item of a run gets its ability type (nil when none is known). Asked once per spell and text. An item
-- whose block already named a known type keeps it.
function Colors.Stamp(items, run)
    if type(items) ~= "table" or type(run) ~= "table" then
        return
    end
    local cache = {}
    for _, it in ipairs(items) do
        if type(it) == "table" and not known(it.abilityType) then
            -- a value the game hides is never turned into a string
            local spell = readable(it.spellID) and type(it.spellID) == "number" and it.spellID or 0
            local text = readable(it.text) and type(it.text) == "string" and it.text or ""
            local key = spell .. "|" .. text
            if cache[key] == nil then
                cache[key] = Colors.TypeOf(run.encounterID, it.spellID, it.text, run.bossName, run.difficultyName) or false
            end
            it.abilityType = cache[key] or nil
        end
    end
end
