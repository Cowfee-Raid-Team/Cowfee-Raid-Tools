local ADDON, CRT = ...

-- Alert colours from the ability's type. Every alert (bar, circle, icon and text) is drawn in the colour of its
-- ability's type, the Timeline's ability types (the one table, Reference.ABILITY_TYPES in Timeline/Reference.lua:
-- dispel blue, soak pink, Mythic only orange, ...). The type is found from the boss data the Timeline already has,
-- in this order:
--   1. the ability's label (yours, then the boss file's) on the Timeline (Timeline:Ability(boss, spell).type)
--   2. the boss's ability timeline: the row of the alert's spell (by spell ID, else by the spell's name or the
--      alert's text, as reminders find their times) and its first, main type. The difficulty's own ability
--      timelines are asked first, then the boss's others.
--   3. the Encounter Journal's icons for the spell (Reference.TAG_TYPES): a dispel icon is dispel, the Mythic and
--      Heroic icons are mythic and heroic; the first icon that is a type, as the Journal export writes it. Only
--      rows the Timeline already read this session (Journal:CachedRows): the Journal is never walked at a pull.
-- With no known type an alert is drawn in the theme's accent. Which colour wins over the type's
-- (the raid leader's note colour, and yours with Use custom colours on) is Alerts:OwnColor (Alerts/Engine.lua).
-- Alerts:Start stamps each item's type as item.abilityType; the areas look the colour up as they draw
-- (Areas.DrawColor), so a theme switch follows. Nothing here is saved.
--   Colors.TypeOf(encounterID, spellID, text, bossName, difficultyName) -> a type key, or nil
--   Colors.Types(encounterID, bossName, difficultyName) -> typesOf(spellID, text) -> every type key, main first
--   Colors.TypeColor(key) -> { r, g, b }: the type's colour, else the theme's accent (nil with no theme loaded)
--   Colors.KnownTypeColor(key) -> { r, g, b } of a known type, else nil
--   Colors.Stamp(items, run) sets abilityType on each item of a run that has no known type of its own, and
--     abilityTags, the ability's Journal icons from the same row (or the cached Journal row), for the timeline area

local Colors = {}
CRT.AlertColors = Colors

local ACCENT = "accent" -- the style guide's accent

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

-- The boss's references: first the one the Timeline and the alerts' times use for the run's difficulty
-- group (Timeline:ReferenceFor), then the others.
local function references(encounterID, bossName, group)
    local Reference, T = CRT.TimelineReference, CRT.Timeline
    local name = bossName or recordedName(encounterID)
    local ok, found = pcall(Reference.ForBoss, Reference, encounterID, name)
    if not ok or type(found) ~= "table" then
        return {}
    end
    local out, seen = {}, {}
    if T and T.ReferenceFor then
        group = group or "nh" -- no difficulty known: Normal/Heroic's, as the Rehearsal opens with none
        local okP, entry = pcall(T.ReferenceFor, T, encounterID, group, name, nil, found)
        if okP and type(entry) == "table" then
            out[1] = entry
            seen[entry.key or entry] = true
        end
    end
    for _, entry in ipairs(found) do
        if not seen[entry.key or entry] then
            out[#out + 1] = entry
        end
    end
    return out
end

-- What one lookup needs about the boss, read once per run: its references and the Journal rows already read this
-- session. The Journal is never walked here: a run starts at the pull, when combat may not be set yet.
local function bossContext(encounterID, bossName, group)
    local Journal = CRT.TimelineJournal
    local rows
    if Journal and Journal.CachedRows then
        local ok, res = pcall(Journal.CachedRows, Journal, encounterID)
        rows = ok and type(res) == "table" and res or nil
    end
    return { encounterID = encounterID, refs = references(encounterID, bossName, group), rows = rows or {} }
end

-- The difficulty group of a difficulty's name (Timeline:GroupOf), or nil.
local function groupOfName(difficultyName)
    local T = CRT.Timeline
    return T and T.GroupOf and T:GroupOf(nil, difficultyName) or nil
end

-- The reference row of the alert's ability, and its spell (its own [spell], else the cached Journal row's of its name).
local function referenceRow(ctx, spellID, text)
    local Reminders = CRT.AlertReminders
    if not (Reminders and Reminders.RowFor) then
        return nil
    end
    local want = { spellID = spellID, text = text }
    for _, entry in ipairs(ctx.refs) do
        local ok, row = pcall(Reminders.RowFor, entry.ref, ctx.encounterID, want, ctx.rows)
        if ok and row then
            local Lanes = CRT.TimelineLanes
            local okS, id = false, nil
            if Lanes and Lanes.RowSpell then
                okS, id = pcall(Lanes.RowSpell, row, ctx.encounterID, ctx.rows)
            end
            return row, okS and type(id) == "number" and id > 0 and id or nil
        end
    end
    return nil
end

-- The type of the ability's label (yours, then the boss file's) for a spell of the boss.
local function labelType(encounterID, spellID)
    local T = CRT.Timeline
    if not (spellID and T and T.Ability) then
        return nil
    end
    local ok, a = pcall(T.Ability, T, encounterID, spellID)
    return ok and type(a) == "table" and known(a.type) and a.type or nil
end

-- The types the Journal's icons give a spell of the boss, in its icons' order, each once, from the rows the
-- Timeline already read this session.
local function journalTypes(ctx, spellID)
    local Reference = CRT.TimelineReference
    local out, seen = {}, {}
    if not (spellID and Reference.TAG_TYPES) then
        return out
    end
    for _, row in ipairs(ctx.rows) do
        if row.spellID == spellID then
            for _, tag in ipairs(type(row.tags) == "table" and row.tags or {}) do
                local t = Reference.TAG_TYPES[tag]
                if known(t) and not seen[t] then
                    seen[t] = true
                    out[#out + 1] = t
                end
            end
            return out
        end
    end
    return out
end

-- The Journal's icons of an ability (Reference.TAGS words), as the Timeline's rows show them: the ability timeline
-- row's own (tags ...), else the cached Journal row's for its spell. Nil when none is known.
local function tagsIn(ctx, row, spell)
    if row and type(row.tags) == "table" and #row.tags > 0 then
        return row.tags
    end
    if spell then
        for _, r in ipairs(ctx.rows) do
            if r.spellID == spell then
                return type(r.tags) == "table" and #r.tags > 0 and r.tags or nil
            end
        end
    end
    return nil
end

-- Every type of an ability, its main one first: the ability's label's (yours, then the boss file's; the one type), else the ability timeline row's
-- known types, else the Journal icons'. An empty list when none is known. Second value: its Journal icons (tagsIn).
local function typesIn(ctx, spellID, text)
    if not (readable(spellID) and type(spellID) == "number" and spellID > 0) then
        spellID = nil
    end
    if not (readable(text) and type(text) == "string") then
        text = nil
    end
    local row, rowSpell = referenceRow(ctx, spellID, text)
    local spell = spellID or rowSpell
    local tags = tagsIn(ctx, row, spell)
    local t = labelType(ctx.encounterID, spell)
    if t then
        return { t }, tags
    end
    local out = {}
    for _, key in ipairs(row and type(row.types) == "table" and row.types or {}) do
        if known(key) then
            out[#out + 1] = key
        end
    end
    if out[1] then
        return out, tags
    end
    return journalTypes(ctx, spell), tags
end

-- The ability's main type and its Journal icons.
local function typeIn(ctx, spellID, text)
    local list, tags = typesIn(ctx, spellID, text)
    return list[1], tags
end

function Colors.TypeOf(encounterID, spellID, text, bossName, difficultyName)
    if not CRT.TimelineReference then
        return nil
    end
    return (typeIn(bossContext(encounterID, bossName, groupOfName(difficultyName)), spellID, text))
end

-- A lookup of every type of the boss's abilities, the boss read once: Colors.Types(encounterID, bossName,
-- difficultyName) returns typesOf(spellID, text) -> { key, ... }, the main type first, empty when none is known.
-- For a list of the boss's abilities (the Mech Alerts list), where TypeOf would read the boss for each row.
-- The difficulty's group picks the ability timeline asked first (Timeline:ReferenceFor, as the alerts' times).
function Colors.Types(encounterID, bossName, difficultyName)
    local ctx
    return function(spellID, text)
        if not CRT.TimelineReference then
            return {}
        end
        ctx = ctx or bossContext(encounterID, bossName, groupOfName(difficultyName))
        return typesIn(ctx, spellID, text)
    end
end

function Colors.TypeColor(key)
    local Reference = CRT.TimelineReference
    local t = type(key) == "string" and Reference and Reference.TYPES[key]
    if t then
        return t.color
    end
    return CRT.PALETTE and CRT.PALETTE[ACCENT] or nil
end

-- A known type's colour, or nil (no accent): for a display with its own default, such as the note callout.
function Colors.KnownTypeColor(key)
    return known(key) and CRT.TimelineReference.TYPES[key].color or nil
end

-- Every item of a run gets its ability type (nil when none is known) and its Journal icons (abilityTags, a list of
-- Reference.TAGS words, nil when none is known; the timeline area shows them). The boss's references and cached
-- Journal rows are read once, and each spell and text asked once. An item whose block already named a known type
-- keeps it, and one that already has its icons keeps them.
function Colors.Stamp(items, run)
    if type(items) ~= "table" or type(run) ~= "table" or not CRT.TimelineReference then
        return
    end
    local ctx
    local cache = {}
    for _, it in ipairs(items) do
        if type(it) == "table" and not (known(it.abilityType) and type(it.abilityTags) == "table") then
            -- a value the game hides is never turned into a string
            local spell = readable(it.spellID) and type(it.spellID) == "number" and it.spellID or 0
            local text = readable(it.text) and type(it.text) == "string" and it.text or ""
            local key = spell .. "|" .. text
            if cache[key] == nil then
                -- the run's difficulty group (by its difficulty ID) picks the ability timeline asked first
                local A = CRT.Alerts
                ctx = ctx or bossContext(run.encounterID, run.bossName,
                    A and A.RunGroup and A:RunGroup(run) or groupOfName(run.difficultyName))
                local t, tags = typeIn(ctx, it.spellID, it.text)
                cache[key] = { t = t, tags = tags }
            end
            if not known(it.abilityType) then
                it.abilityType = cache[key].t
            end
            if type(it.abilityTags) ~= "table" then
                it.abilityTags = cache[key].tags
            end
        end
    end
end
