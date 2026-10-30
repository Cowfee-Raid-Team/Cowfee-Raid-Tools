local ADDON, CRT = ...

-- Timeline: the ability rows of a boss. The rows come from the Encounter Journal (every ability
-- that has a spell, in Journal order, each spell once), followed by spells you added yourself.
-- The game only gives the Journal's boss list for the instance you are in, so the boss is found
-- through the map you stand on first, then by looking through the current tier's raids; the
-- Journal's own selected instance is put back afterwards so its window is not disturbed. Once the
-- Journal window's addon has loaded, nothing is selected any more: only the map's instance and the
-- one the Journal has selected are read (journalLoaded below). Nothing is looked up during combat
-- or while the Journal window is open, and what is found is kept for the rest of the session. Hiding a row only sets a flag: the page decides what to draw. A
-- reference timeline that only knows its boss by name finds the boss the same way, by the name
-- the Journal gives it (EncounterByName), so its rows get icons and tooltips anywhere. Each row
-- keeps the ID of its first Journal section. The Journal's text of an ability, for the shared
-- ability tooltip, is read here too (Journal:AbilitySection, near the end).

local Journal = {}
CRT.TimelineJournal = Journal

local cache = {}
-- bosses the Journal could not find: [encounterID] = the Journal tier searched (EJ_GetCurrentTier), so a miss
-- that only came from the tier the Journal had picked is tried again once another is picked; cleared on a zone change
local missed = {}
-- boss names looked up in the Journal: [name] = dungeon encounter id, or { tier } (the tier searched) when not found
local byName = {}
-- the bosses of each raid instance, by Journal instance id
local raidCache = {}
-- where each boss found so far is: [dungeonEncounterID] = { root = section id, instanceID = Journal instance }
local roots = {}

-- the Journal's text of each boss's abilities, for the ability tooltip (Journal:AbilitySection below):
-- ["encounterID|difficultyID"] = the boss's sections
local texts = {}

-- The game's Encounter Journal window (Blizzard_EncounterJournal, load-on-demand). Once it has loaded, it answers
-- EJ_DIFFICULTY_UPDATE even while hidden by redrawing itself (Blizzard_EncounterJournal.lua: EncounterJournal_OnLoad
-- registers it; EncounterJournal_UpdateDifficulty runs EncounterJournal_Refresh, which selects its own instance
-- again). From then on CRT never changes the Journal's selection (no EJ_SelectInstance, no EJ_SetDifficulty): it
-- only reads, at the difficulty the Journal has picked.
local function journalLoaded()
    if EncounterJournal ~= nil then
        return true
    end
    return C_AddOns ~= nil and C_AddOns.IsAddOnLoaded ~= nil and C_AddOns.IsAddOnLoaded("Blizzard_EncounterJournal") and true or false
end
Journal.Loaded = journalLoaded

local function currentTier()
    if not EJ_GetCurrentTier then
        return 0
    end
    local ok, tier = pcall(EJ_GetCurrentTier)
    return ok and tier or 0
end

-- A miss kept with the tier it was searched in still holds only while that tier is picked.
local function stillMissed(tier)
    return tier ~= nil and tier ~= false and tier == currentTier()
end

local zoneFrame = CreateFrame("Frame")
zoneFrame:RegisterEvent("ZONE_CHANGED_NEW_AREA")
zoneFrame:RegisterEvent("PLAYER_ENTERING_WORLD")
-- a spell's text that loaded late (the Journal reads its own again on it too): its kept text is read again
zoneFrame:RegisterEvent("SPELL_TEXT_UPDATE")
-- the season's bosses' Journal text is read once after login, before the Journal window is first opened
zoneFrame:RegisterEvent("PLAYER_LOGIN")
zoneFrame:RegisterEvent("PLAYER_REGEN_ENABLED")
zoneFrame:SetScript("OnEvent", function(_, event, spellID)
    if event == "SPELL_TEXT_UPDATE" then
        if Journal.TextChanged then
            Journal.TextChanged(spellID)
        end
        return
    elseif event == "PLAYER_LOGIN" or event == "PLAYER_REGEN_ENABLED" then
        if Journal.Warm then
            Journal.Warm(event == "PLAYER_LOGIN")
        end
        return
    end
    missed = {}
    for name, id in pairs(byName) do
        if type(id) ~= "number" then
            byName[name] = nil
        end
    end
end)

-- A boss name made comparable: trimmed, lower case, curly apostrophes made straight.
local function nameKey(s)
    s = tostring(s or ""):gsub("\226\128\153", "'"):gsub("\226\128\152", "'")
    return (s:gsub("^%s+", ""):gsub("%s+$", "")):lower()
end

local function settings()
    return CRT.Timeline:Settings()
end

-- The saved row settings of a boss, made when first needed.
local function bossRows(encounterID)
    local rows = settings().rows
    if not rows then
        rows = {}
        settings().rows = rows
    end
    local r = rows[encounterID]
    if not r then
        r = {}
        rows[encounterID] = r
    end
    r.hidden = r.hidden or {}
    r.custom = r.custom or {}
    return r
end

local function changed(encounterID)
    cache[encounterID] = nil
    CRT.Timeline:Fire()
end

-- The boss that match(name, dungeonEncounterID) accepts among the bosses of instanceID, or of the instance
-- the Journal has selected when instanceID is nil: its Journal root section and dungeon encounter id, or nil.
-- Read only: listing an instance by its ID works once it was selected this session.
local function rootIn(match, instanceID)
    local j = 1
    while j < 100 do
        local ok, _, _, journalID
        if instanceID then
            ok, _, _, journalID = pcall(EJ_GetEncounterInfoByIndex, j, instanceID)
        else
            ok, _, _, journalID = pcall(EJ_GetEncounterInfoByIndex, j)
        end
        if not ok or not journalID then
            return nil
        end
        local ok2, name, _, _, rootSectionID, _, _, dungeonEncounterID = pcall(EJ_GetEncounterInfo, journalID)
        if ok2 and match(name, dungeonEncounterID) then
            return rootSectionID, dungeonEncounterID
        end
        j = j + 1
    end
end

-- The Journal instance of the map we stand on, or nil.
local function mapInstance()
    if not (EJ_GetInstanceForMap and C_Map and C_Map.GetBestMapForUnit) then
        return nil
    end
    local okMap, map = pcall(C_Map.GetBestMapForUnit, "player")
    if not (okMap and map) then
        return nil
    end
    local okInst, instanceID = pcall(EJ_GetInstanceForMap, map)
    return okInst and instanceID and instanceID ~= 0 and instanceID or nil
end

local function selectedInstance()
    if not EJ_GetCurrentInstance then
        return nil
    end
    local ok, id = pcall(EJ_GetCurrentInstance)
    return ok and id or nil
end

-- The Journal root section and dungeon encounter id of the boss match accepts, or nil when it cannot be
-- found; a boss found is kept in roots with its instance. Before the Journal window has loaded, the map's
-- instance and then every raid of the current tier are selected in turn, and the Journal's own selected
-- instance is put back. After it has loaded nothing is selected: only the map's instance (listed by ID) and
-- the instance the Journal has selected are read.
local function findRoot(match)
    if not (EJ_GetEncounterInfoByIndex and EJ_GetEncounterInfo) then
        return nil
    end
    local root, found, where
    local inMap = mapInstance()
    if journalLoaded() or not EJ_SelectInstance then
        if inMap then
            root, found = rootIn(match, inMap)
            where = inMap
        end
        if not root then
            root, found = rootIn(match, nil)
            where = selectedInstance()
        end
    else
        local previous = selectedInstance()
        if inMap then
            pcall(EJ_SelectInstance, inMap)
            root, found = rootIn(match, nil)
            where = inMap
        end
        -- otherwise every raid of the current tier
        if not root and EJ_GetInstanceByIndex then
            local i = 1
            while i < 100 do
                local ok, instanceID = pcall(EJ_GetInstanceByIndex, i, true)
                if not ok or not instanceID then
                    break
                end
                pcall(EJ_SelectInstance, instanceID)
                root, found = rootIn(match, nil)
                if root then
                    where = instanceID
                    break
                end
                i = i + 1
            end
        end
        if previous and previous ~= 0 and selectedInstance() ~= previous then
            pcall(EJ_SelectInstance, previous)
        end
    end
    if root and type(found) == "number" then
        roots[found] = { root = root, instanceID = where }
    end
    return root, found
end

local function byEncounter(encounterID)
    return function(_, dungeonEncounterID)
        return dungeonEncounterID == encounterID
    end
end

-- The Journal's Overview section (its role summaries: Damage Dealers, Healer, Tank) repeats the boss's
-- abilities under a role's icon, so its abilities are read from their own sections, never from it. The
-- Journal's own code calls this header type EJ_HTYPE_OVERVIEW.
local HTYPE_OVERVIEW = 3

-- Adds a section's tags to a row already made for its spell (an ability the Journal lists twice).
local function mergeTags(row, tags)
    row.tags = row.tags or {}
    for _, t in ipairs(tags or {}) do
        local have = false
        for _, h in ipairs(row.tags) do
            have = have or h == t
        end
        if not have then
            row.tags[#row.tags + 1] = t
        end
    end
end

-- Every ability section under root, depth first in Journal order: children, then siblings. The Overview is
-- left out.
local function collect(root, rows, seen)
    local visited = {}
    local function walk(id)
        while id and id ~= 0 and not visited[id] do
            visited[id] = true
            local ok, info = pcall(C_EncounterJournal.GetSectionInfo, id)
            if not ok or type(info) ~= "table" then
                return
            end
            if info.headerType ~= HTYPE_OVERVIEW then
                local spellID = info.spellID
                local tags = Journal.SectionTags and Journal.SectionTags(id) or nil -- the Journal's icons
                if type(spellID) == "number" and spellID > 0 and seen[spellID] then
                    mergeTags(seen[spellID], tags)
                elseif type(spellID) == "number" and spellID > 0 then
                    local okName, name = pcall(C_Spell.GetSpellName, spellID)
                    local okIcon, icon = pcall(C_Spell.GetSpellTexture, spellID)
                    rows[#rows + 1] = {
                        spellID = spellID,
                        name = (okName and name) or info.title or "",
                        icon = (okIcon and icon) or info.abilityIcon,
                        own = false,
                        tags = tags,
                        sectionID = id, -- the first of its sections, for the ability tooltip and [section N]
                    }
                    seen[spellID] = rows[#rows] -- a later section of the same spell adds its icons to this row
                end
                walk(info.firstChildSectionID)
            end
            id = info.siblingSectionID
        end
    end
    walk(root)
end

-- The Journal's icon flags of a section as tag words (Reference.TAGS), in the Journal's own enum, so a
-- renumbered flag still reads right: Interruptible is "interrupt", the rest their names in lower case.
local function sectionTags(sectionID)
    local flags = C_EncounterJournal and C_EncounterJournal.GetSectionIconFlags
    local enum = Enum and Enum.JournalEncounterIconFlags
    if not (flags and enum) then
        return {}
    end
    local ok, list = pcall(flags, sectionID)
    if not ok or type(list) ~= "table" then
        return {}
    end
    local byValue = {}
    for key, value in pairs(enum) do
        byValue[value] = (key == "Interruptible") and "interrupt" or key:lower()
    end
    local out = {}
    for _, f in ipairs(list) do
        if byValue[f] then
            out[#out + 1] = byValue[f]
        end
    end
    return out
end

Journal.SectionTags = sectionTags

-- Whether a Journal section starts a stage of the fight: its title begins with Stage, Phase or Intermission
-- (after any numbering, any case), or it is a header with no spell that heads other headers (sections with
-- their own children). An add's header ("Echo of Jawae", only abilities under it) is not one: its abilities
-- belong to the stage above it. Nor is a header that holds stages (a boss's page put under one header):
-- the stages under it are. The Overview is never a stage.
local function getSection(id)
    local ok, info = pcall(C_EncounterJournal.GetSectionInfo, id)
    return ok and type(info) == "table" and info or nil
end

local function titledStage(info)
    local title = tostring(info.title or ""):lower():gsub("^%s*[%d%.%)%-:]*%s*", "")
    return title:find("^stage") ~= nil or title:find("^phase") ~= nil or title:find("^intermission") ~= nil
end

function Journal.IsStage(info)
    if not info or info.headerType == HTYPE_OVERVIEW then
        return false
    end
    if titledStage(info) then
        return true
    end
    if type(info.spellID) == "number" and info.spellID > 0 then
        return false
    end
    local headsHeaders = false
    local child, guard = info.firstChildSectionID, 0
    while child and child ~= 0 and guard < 200 do
        guard = guard + 1
        local c = getSection(child)
        if not c then
            break
        end
        if titledStage(c) then
            return false -- it holds stages, it isn't one
        end
        if c.firstChildSectionID and c.firstChildSectionID ~= 0 then
            headsHeaders = true
        end
        child = c.siblingSectionID
    end
    return headsHeaders
end

-- Which page a boss has in the Journal, decided the way the Journal window decides it (Blizzard_EncounterJournal,
-- EncounterJournal_DisplayInstance with EncounterJournal_SearchForOverview): an instance where any boss's root
-- section is an Overview (headerType EJ_HTYPE_OVERVIEW) gets an Overview tab, and its pages have stages; one
-- where none is (the raids before Warlords of Draenor) shows a single Abilities tab, its pages a plain tree of
-- creatures, headers and spells. "overview" or "abilities"; nil when the boss's instance can't be listed (the
-- bosses are listed by EJ_GetEncounterInfoByIndex, which needs the Journal to have selected an instance once).
-- An instance's answer and its bosses are kept for the session, once its bosses could be listed; a boss missing
-- from the kept list has the instance listed again, and a listing that holds it replaces the kept one.
local layouts = {} -- [journalInstanceID] = { layout = "overview" or "abilities", bosses = { [journalEncounterID] = true } }

function Journal.Layout(journalEncounterID)
    if not (journalEncounterID and EJ_GetEncounterInfo and EJ_GetEncounterInfoByIndex and C_EncounterJournal) then
        return nil
    end
    local ok, name, _, _, _, _, journalInstanceID = pcall(EJ_GetEncounterInfo, journalEncounterID)
    if not ok or not name then
        return nil
    end
    local known = journalInstanceID and layouts[journalInstanceID]
    if known and known.bosses[journalEncounterID] then
        return known.layout
    end
    -- not in the kept list (it may depend on the picked difficulty): the instance is listed again
    local found, overview, bosses = false, false, {}
    for i = 1, 100 do
        local okBoss, _, _, bossID, bossRoot
        if journalInstanceID then
            okBoss, _, _, bossID, bossRoot = pcall(EJ_GetEncounterInfoByIndex, i, journalInstanceID)
        else
            okBoss, _, _, bossID, bossRoot = pcall(EJ_GetEncounterInfoByIndex, i)
        end
        if not okBoss or not bossID then
            break
        end
        found = found or bossID == journalEncounterID
        bosses[bossID] = true
        local root = type(bossRoot) == "number" and bossRoot > 0 and getSection(bossRoot)
        overview = overview or (root and root.headerType == HTYPE_OVERVIEW) or false
    end
    if not found then
        return nil
    end
    local layout = overview and "overview" or "abilities"
    if journalInstanceID then
        layouts[journalInstanceID] = { layout = layout, bosses = bosses }
    end
    return layout
end

-- The rows of a boss with the Abilities page (Journal.Layout): every spell in Journal order, as the Journal walks
-- its list (EncounterJournal_ToggleHeaders: sections hidden for the picked difficulty left out with what is under
-- them, and headerType not looked at, since on these pages it is only the section's depth). A section with no
-- spell that has sections under it is a header (a creature, "Grounded Abilities"), its title in the headers of the
-- rows under it; one with nothing under it is an entry with no spellID (the export writes it as a "#" line).
-- Within one header a spell is listed once, with its sections' icons merged.
local function abilitiesRows(rootSectionID)
    local rows, seen, visited = {}, {}, {}
    local function walk(id, headers)
        while id and id ~= 0 and not visited[id] do
            visited[id] = true
            local info = getSection(id)
            if not info then
                return
            end
            if not info.filteredByDifficulty then
                local spellID = info.spellID
                local hasSpell = type(spellID) == "number" and spellID > 0
                local child = info.firstChildSectionID
                local under = headers
                if hasSpell or not (child and child ~= 0) then
                    local key = table.concat(headers, "\n") .. "|" .. (hasSpell and spellID or ("#" .. tostring(info.title)))
                    if seen[key] then
                        mergeTags(seen[key], sectionTags(id))
                    elseif hasSpell or (info.title or "") ~= "" then
                        local okName, spellName
                        if hasSpell then
                            okName, spellName = pcall(C_Spell.GetSpellName, spellID)
                        end
                        rows[#rows + 1] = {
                            spellID = hasSpell and spellID or nil,
                            name = (okName and spellName) or info.title or "",
                            icon = info.abilityIcon,
                            tags = sectionTags(id),
                            sectionID = id,
                            headers = headers,
                        }
                        seen[key] = rows[#rows]
                    end
                else
                    under = {}
                    for i, h in ipairs(headers) do
                        under[i] = h
                    end
                    under[#under + 1] = info.title or ""
                end
                walk(child, under)
            end
            id = info.siblingSectionID
        end
    end
    walk(rootSectionID, {})
    return rows
end

-- A Journal encounter (its Journal ID, as the Journal window shows it): its name, dungeon encounter ID and
-- ability rows in Journal order, each { spellID, name, icon, tags, stage, sectionID } with stage the title of its
-- nearest stage (Journal.IsStage, at any depth), and stages, those titles in order. An ability listed in two
-- stages is in both; within one stage it is listed once, with its sections' icons merged. A stage header
-- that has a spell of its own is an ability of that stage too. Sections the Journal leaves out for its picked
-- difficulty (filteredByDifficulty) are left out with what is under them, and so is the Overview. Read
-- without changing the Journal's selection. Nil when unknown. A boss with the older Abilities page
-- (Journal.Layout) has no stages: its rows come from abilitiesRows, each with headers, the titles of the
-- headers above it, and "abilities" is returned fifth.
function Journal.FromJournalEncounter(journalEncounterID)
    if not (journalEncounterID and EJ_GetEncounterInfo and C_EncounterJournal) then
        return nil
    end
    local ok, name, _, _, rootSectionID, _, _, dungeonEncounterID = pcall(EJ_GetEncounterInfo, journalEncounterID)
    if not ok or not name then
        return nil
    end
    if Journal.Layout(journalEncounterID) == "abilities" then
        local rows = (rootSectionID and rootSectionID > 0) and abilitiesRows(rootSectionID) or {}
        return name, dungeonEncounterID, rows, {}, "abilities"
    end
    local rows, stages, seen, visited = {}, {}, {}, {}
    local function walk(id, stage)
        while id and id ~= 0 and not visited[id] do
            visited[id] = true
            local info = getSection(id)
            if not info then
                return
            end
            if not info.filteredByDifficulty and info.headerType ~= HTYPE_OVERVIEW then
                local spellID = info.spellID
                local here = stage
                if Journal.IsStage(info) then
                    here = info.title
                    stages[#stages + 1] = info.title
                end
                if type(spellID) == "number" and spellID > 0 then
                    local key = tostring(here) .. "|" .. spellID -- once per stage
                    if seen[key] then
                        mergeTags(seen[key], sectionTags(id))
                    else
                        local okName, spellName = pcall(C_Spell.GetSpellName, spellID)
                        rows[#rows + 1] = {
                            spellID = spellID,
                            name = (okName and spellName) or info.title or "",
                            icon = info.abilityIcon,
                            tags = sectionTags(id),
                            sectionID = id,
                            stage = here,
                        }
                        seen[key] = rows[#rows]
                    end
                end
                walk(info.firstChildSectionID, here)
            end
            id = info.siblingSectionID
        end
    end
    if rootSectionID and rootSectionID > 0 then
        walk(rootSectionID, nil)
    end
    return name, dungeonEncounterID, rows, stages
end

-- The rows of a boss: Journal abilities, then your own. Empty in combat or while the Journal is
-- open (nothing cached then). When the Journal does not know the boss only your own spells are
-- listed. A miss found by selecting the tier's raids (before the Journal window loaded) is remembered
-- until the zone changes or another tier is picked; one after it loaded (read only) is not remembered.
function Journal:Rows(encounterID)
    -- a reference timeline has no encounter id to look up (its key is text), so never walk for it
    if type(encounterID) ~= "number" then
        return {}
    end
    if cache[encounterID] then
        return cache[encounterID]
    end
    if InCombatLockdown() or (EncounterJournal and EncounterJournal:IsShown()) then
        return {}
    end
    local rows, seen = {}, {}
    local root = roots[encounterID] and roots[encounterID].root
    if not root and not stillMissed(missed[encounterID]) then
        root = findRoot(byEncounter(encounterID))
        if not root and not journalLoaded() then
            missed[encounterID] = currentTier()
        end
    end
    if root then
        collect(root, rows, seen)
    end
    -- your own spells: a developer build only (Timeline.DevBuild); the Advanced tab adds them
    local mine = CRT.Timeline.DevBuild() and settings().rows and settings().rows[encounterID]
    if mine and mine.custom then
        for _, spellID in ipairs(mine.custom) do
            if not seen[spellID] then
                seen[spellID] = true
                local okName, name = pcall(C_Spell.GetSpellName, spellID)
                local okIcon, icon = pcall(C_Spell.GetSpellTexture, spellID)
                rows[#rows + 1] = { spellID = spellID, name = (okName and name) or tostring(spellID), icon = okIcon and icon or nil, own = true }
            end
        end
    end
    if root then
        cache[encounterID] = rows
    end
    return rows
end

-- The rows of a boss already read this session, or nil. Never walks the Journal, so it is safe at a pull's
-- start, when combat may not be set yet (the alerts' type colours read it).
function Journal:CachedRows(encounterID)
    return cache[encounterID]
end

-- The dungeon encounter id of a boss found in the Journal by its name, or nil. Looked up out of
-- combat with the Journal closed; a name that is not found is tried again after a zone change or
-- once another tier is picked, and every time while the Journal window has loaded (read only then).
function Journal:EncounterByName(name)
    local key = nameKey(name)
    if key == "" then
        return nil
    end
    local known = byName[key]
    if type(known) == "number" then
        return known
    elseif type(known) == "table" and stillMissed(known.tier) then
        return nil
    end
    if InCombatLockdown() or (EncounterJournal and EncounterJournal:IsShown()) then
        return nil
    end
    local _, id = findRoot(function(bossName)
        return type(bossName) == "string" and nameKey(bossName) == key
    end)
    if type(id) == "number" then
        byName[key] = id
        return id
    end
    byName[key] = not journalLoaded() and { tier = currentTier() } or nil
    return nil
end

-- The bosses of the raid you are standing in, from the Encounter Journal: { { encounterID, name } }.
-- Asked out of combat only, only inside a raid, kept per instance, and empty when anything is
-- missing or fails. The Timeline page and the Reminders and Phases tabs list these bosses.
function Journal:RaidBosses()
    local out = {}
    local okType, _, kind = pcall(GetInstanceInfo)
    if not okType or kind ~= "raid" then
        return out
    end
    if InCombatLockdown() or not (EJ_GetInstanceForMap and EJ_GetEncounterInfoByIndex and EJ_GetEncounterInfo and C_Map and C_Map.GetBestMapForUnit) then
        return out
    end
    local okMap, mapID = pcall(C_Map.GetBestMapForUnit, "player")
    if not okMap or not mapID then
        return out
    end
    local okInst, instanceID = pcall(EJ_GetInstanceForMap, mapID)
    if not okInst or not instanceID or instanceID == 0 then
        return out
    end
    if raidCache[instanceID] then
        return raidCache[instanceID]
    end
    for i = 1, 30 do
        local r = { pcall(EJ_GetEncounterInfoByIndex, i, instanceID) }
        local name, journalID = r[2], r[4]
        if not r[1] or not name or not journalID then
            break
        end
        local d = { pcall(EJ_GetEncounterInfo, journalID) }
        local encounterID = d[1] and d[8] or nil
        if type(encounterID) == "number" then
            out[#out + 1] = { encounterID = encounterID, name = name }
        end
    end
    if #out > 0 then
        raidCache[instanceID] = out
    end
    return out
end

-- The encounter id to ask the Journal about for a boss key: the key itself when it is a number,
-- else a reference's Encounter line, else the reference's boss found in the Journal by name.
function Journal:ResolveID(encounterID, ref)
    if type(encounterID) == "number" then
        return encounterID
    end
    if ref then
        if type(ref.encounterID) == "number" then
            return ref.encounterID
        end
        return self:EncounterByName(ref.boss)
    end
    return nil
end

-- The Journal's text of an ability, for the ability tooltip ----------------------------------------------------------
-- CRT.AbilityTip (Timeline/AbilityTip.lua) shows an ability's Encounter Journal text under its spell. The text
-- follows the Journal's picked difficulty (EJ_SetDifficulty; the game writes the numbers in). A boss's sections
-- are read once per difficulty and kept, by "encounterID|difficultyID", until the season's route changes:
--   Before the Journal window has loaded (Blizzard_EncounterJournal is load-on-demand, so nothing answers a change
--   then), a boss is read at the difficulty of the page that asks, Mythic (16) for the "mythic" group and Heroic
--   (15) for "nh", with the boss's instance selected, and the Journal's difficulty and instance are put back. After
--   login the current season's route bosses are read this way for both groups, a few each frame, out of combat
--   (Journal.Warm), stopping for good the moment the Journal loads.
--   Once it has loaded, CRT changes nothing: a boss not kept at the asked difficulty is read at the Journal's own
--   (EJ_GetDifficulty), from the sections of a boss found before or found without selecting anything, and the
--   tooltip's heading names that difficulty. A boss that can't be found so gets no Journal text.
-- Nothing new is read in combat. A section is found by an explicit [section N] first, else its spell, else its
-- title or spell name (Reference.Norm); one the difficulty hides never replaces one it shows, and the Overview's
-- role summaries are left out. A text that hadn't loaded is read again once on a later hover, and the game's
-- SPELL_TEXT_UPDATE has that spell's kept text read again: at once while the Journal hasn't loaded, else on the
-- next hover when the text was kept at the Journal's current difficulty.
Journal.GROUP_DIFFICULTY = { mythic = 16, nh = 15 }
local WARM_DELAY, WARM_GAP, WARM_PER_TICK = 5, 0.2, 2 -- seconds after login, between ticks, bosses a tick
local STALE_DELAY = 0.5 -- SPELL_TEXT_UPDATE comes in bursts: the kept texts are read again once after one

local function currentDifficulty()
    if not EJ_GetDifficulty then
        return nil
    end
    local ok, d = pcall(EJ_GetDifficulty)
    return ok and type(d) == "number" and d or nil
end

local function setDifficulty(d)
    if d and EJ_SetDifficulty and currentDifficulty() ~= d then
        pcall(EJ_SetDifficulty, d)
    end
end

-- a number the game may have made secret, as a plain number or nil
local function plainNumber(v)
    if issecretvalue and issecretvalue(v) then
        return nil
    end
    return type(v) == "number" and v > 0 and v or nil
end

local function textKey(s)
    if type(s) ~= "string" then
        return nil
    end
    local Reference = CRT.TimelineReference
    return Reference and Reference.Norm and Reference.Norm(s) or nameKey(s)
end

local function keyOf(encounterID, difficultyID)
    return encounterID .. "|" .. tostring(difficultyID)
end

-- A section as the tooltip reads it: { sectionID, spellID, title, description, icon, tags, hidden }.
local function sectionText(id, info)
    return {
        sectionID = id,
        spellID = plainNumber(info.spellID),
        title = info.title,
        description = type(info.description) == "string" and info.description or nil,
        icon = info.abilityIcon,
        tags = sectionTags(id),
        hidden = info.filteredByDifficulty and true or nil,
    }
end

-- Keeps a section under key; a section the difficulty shows wins over one it hides, else the first.
local function index(list, key, s)
    if key == nil or key == "" then
        return
    end
    local have = list[key]
    if not have or (have.hidden and not s.hidden) then
        list[key] = s
    end
end

local function readTexts(root, difficultyID)
    local map = { difficultyID = difficultyID, bySpell = {}, byName = {}, byID = {} }
    local visited = {}
    local function walk(id, depth)
        while id and id ~= 0 and not visited[id] do
            visited[id] = true
            local info = getSection(id)
            if not info then
                return
            end
            -- the Overview is the root (and its siblings) with the Overview header type; deeper down that
            -- number is only a depth (the older Abilities pages, Journal.Layout)
            if not (depth == 0 and info.headerType == HTYPE_OVERVIEW) then
                local s = sectionText(id, info)
                map.byID[id] = s
                index(map.bySpell, s.spellID, s)
                index(map.byName, textKey(info.title), s)
                if s.spellID then
                    local ok, spellName = pcall(C_Spell.GetSpellName, s.spellID)
                    index(map.byName, ok and textKey(spellName) or nil, s)
                end
                walk(info.firstChildSectionID, depth + 1)
            end
            id = info.siblingSectionID
        end
    end
    walk(root, 0)
    return map
end

-- Only before the Journal window has loaded: read(difficultyID) with the boss's instance (where.instanceID)
-- selected and the Journal at difficulty want, then the Journal's instance and difficulty put back (the
-- difficulty again once its own instance is selected, should the boss's instance not have it). Returns read's
-- result and the difficulty read at.
local function atDifficulty(where, want, read)
    local beforeInstance, beforeDifficulty = selectedInstance(), currentDifficulty()
    local instanceID = where and where.instanceID
    if instanceID and EJ_SelectInstance and beforeInstance ~= instanceID then
        pcall(EJ_SelectInstance, instanceID)
    end
    setDifficulty(want)
    local at = currentDifficulty() or want
    local result = read(at)
    setDifficulty(beforeDifficulty)
    if EJ_SelectInstance and beforeInstance and beforeInstance ~= 0 and selectedInstance() ~= beforeInstance then
        pcall(EJ_SelectInstance, beforeInstance)
    end
    setDifficulty(beforeDifficulty)
    return result, at
end

-- Where a boss's sections are, { root, instanceID }: kept from an earlier find, else found now (read only once
-- the Journal has loaded); nil when it can't be found.
local function rootOf(encounterID)
    if not roots[encounterID] and not stillMissed(missed[encounterID]) then
        local root = findRoot(byEncounter(encounterID))
        if not root and not journalLoaded() then
            missed[encounterID] = currentTier()
        end
    end
    return roots[encounterID]
end

-- Reads and keeps a boss's sections: at want before the Journal window has loaded, else at its own difficulty.
local function build(encounterID, want)
    local where = rootOf(encounterID)
    if not where then
        return nil
    end
    local map, at
    if journalLoaded() then
        at = currentDifficulty()
        map = readTexts(where.root, at)
    else
        map, at = atDifficulty(where, want, function(d)
            return readTexts(where.root, d)
        end)
    end
    map.difficultyID, map.encounterID = at, encounterID
    texts[keyOf(encounterID, at)] = map
    if want and want ~= at then
        texts[keyOf(encounterID, want)] = map -- the game didn't take want: kept under it too, named by at
    end
    return map
end

-- One section read again alone at its map's difficulty: info (nil when the game gives nothing) and whether it
-- could be read at all (after the Journal loaded, only when it is on that difficulty).
local function readSection(map, sectionID)
    if journalLoaded() then
        if map.difficultyID ~= currentDifficulty() then
            return nil, false
        end
        return getSection(sectionID), true
    end
    local info, at = atDifficulty(roots[map.encounterID], map.difficultyID, function(d)
        return (map.difficultyID == nil or d == map.difficultyID) and getSection(sectionID) or nil
    end)
    return info, map.difficultyID == nil or at == map.difficultyID
end

local function refresh(map, s)
    local info, read = readSection(map, s.sectionID)
    if read then
        if info then
            s.description = type(info.description) == "string" and info.description or nil
        end
        s.stale, s.retried = nil, true
    end
end

-- The kept sections marked by SPELL_TEXT_UPDATE, read again together, one difficulty change per boss.
local stalePending = false
local function readStale()
    stalePending = false
    if journalLoaded() or InCombatLockdown() then
        return
    end
    for _, map in pairs(texts) do
        local list = {}
        for _, s in pairs(map.byID) do
            if s and s.stale then
                list[#list + 1] = s
            end
        end
        if list[1] then
            atDifficulty(roots[map.encounterID], map.difficultyID, function(d)
                if map.difficultyID ~= nil and d ~= map.difficultyID then
                    return
                end
                for _, s in ipairs(list) do
                    local info = getSection(s.sectionID)
                    if info then
                        s.description = type(info.description) == "string" and info.description or nil
                    end
                    s.stale = nil
                end
            end)
        end
    end
end

-- SPELL_TEXT_UPDATE: the kept sections of that spell are read again, together a moment later while the Journal
-- hasn't loaded, else on their next hover.
function Journal.TextChanged(spellID)
    spellID = plainNumber(spellID)
    if not spellID then
        return
    end
    for _, map in pairs(texts) do
        for _, s in pairs(map.byID) do
            if s and s.spellID == spellID then
                s.stale = true
            end
        end
    end
    if not stalePending and not journalLoaded() and C_Timer and C_Timer.After then
        stalePending = true
        C_Timer.After(STALE_DELAY, readStale)
    end
end

-- The Journal section of an ability for the ability tooltip: { sectionID, spellID, title, description (nil when
-- the game has none), icon, tags }, and the difficulty ID its text was read at (the heading names it); nil when
-- there is none or it can't be read now. encounterID is the dungeon encounter ID; group "mythic" or "nh" (nil:
-- the Journal's own difficulty); sectionID an explicit [section N]; cachedOnly reads nothing new (for drawing).
function Journal:AbilitySection(encounterID, group, spellID, name, sectionID, cachedOnly)
    if type(encounterID) ~= "number" then
        return nil
    end
    local want = Journal.GROUP_DIFFICULTY[group]
    local canRead = not cachedOnly and not InCombatLockdown()
    local map = want and texts[keyOf(encounterID, want)]
    local built = false
    if not map then
        local loaded = journalLoaded()
        if loaded or not want then
            map = texts[keyOf(encounterID, currentDifficulty())]
        end
        if not map and canRead then
            map = build(encounterID, not loaded and want or nil)
            built = true
        end
    end
    if not map then
        return nil
    end
    local s
    sectionID = plainNumber(sectionID)
    if sectionID then
        s = map.byID[sectionID]
        if s == nil and canRead then
            local info, read = readSection(map, sectionID)
            if read then
                s = info and sectionText(sectionID, info) or false
                map.byID[sectionID] = s
            end
        end
        s = s or nil
    end
    spellID = plainNumber(spellID)
    if not s and spellID then
        s = map.bySpell[spellID]
    end
    if not s then
        local k = textKey(name)
        s = k and map.byName[k] or nil
    end
    -- read just now, it is as new as it gets; a later hover reads a missing text once more
    if s and canRead and not built and (s.stale or (s.description == nil and not s.retried)) then
        refresh(map, s)
    end
    return s, map.difficultyID
end

-- The warm-up: the current season's route bosses, read for both groups before the Journal window loads.
local warmQueue -- encounter IDs still to read, or nil when done or stopped for good
local warmTimer = false

local function routeBosses()
    local out, B = {}, CRT.Bosses
    local season = B and B.Current and B:Current()
    if season and season.key and B.RouteList then
        for _, def in ipairs(B:RouteList(season.key)) do
            if type(def.encounterID) == "number" then
                out[#out + 1] = def.encounterID
            end
        end
    end
    return out
end

local function warmBoss(encounterID)
    pcall(Journal.Rows, Journal, encounterID)
    for _, group in ipairs({ "mythic", "nh" }) do
        pcall(Journal.AbilitySection, Journal, encounterID, group)
    end
end

local function scheduleWarm(delay)
    if warmTimer or not warmQueue or not (C_Timer and C_Timer.After) then
        return
    end
    warmTimer = true
    C_Timer.After(delay, function()
        warmTimer = false
        if journalLoaded() then
            warmQueue = nil -- for good: from now on nothing may change the Journal
            return
        end
        if InCombatLockdown() then
            return -- PLAYER_REGEN_ENABLED goes on with the rest
        end
        for _ = 1, WARM_PER_TICK do
            local encounterID = warmQueue and table.remove(warmQueue, 1)
            if not encounterID then
                warmQueue = nil
                return
            end
            warmBoss(encounterID)
        end
        scheduleWarm(WARM_GAP)
    end)
end

-- fresh: start over with the route's bosses (at login, on a route change); else go on with what is left.
function Journal.Warm(fresh)
    if journalLoaded() then
        warmQueue = nil
        return
    end
    if fresh then
        warmQueue = routeBosses()
    end
    scheduleWarm(fresh and WARM_DELAY or WARM_GAP)
end

-- a new season or route: every boss's text is read again
if CRT.Bosses and CRT.Bosses.OnRouteChange then
    CRT.Bosses:OnRouteChange(function()
        texts = {}
        Journal.Warm(true)
    end)
end

function Journal:AddCustom(encounterID, spellID)
    local r = bossRows(encounterID)
    for _, id in ipairs(r.custom) do
        if id == spellID then
            return
        end
    end
    r.custom[#r.custom + 1] = spellID
    changed(encounterID)
end

function Journal:RemoveCustom(encounterID, spellID)
    local r = bossRows(encounterID)
    for i, id in ipairs(r.custom) do
        if id == spellID then
            table.remove(r.custom, i)
            break
        end
    end
    changed(encounterID)
end

function Journal:SetHidden(encounterID, spellID, hidden)
    bossRows(encounterID).hidden[spellID] = hidden and true or nil
    changed(encounterID)
end

-- A row you hid on the Advanced tab: a developer build only (Timeline.DevBuild).
function Journal:IsHidden(encounterID, spellID)
    if not CRT.Timeline.DevBuild() then
        return false
    end
    local r = settings().rows and settings().rows[encounterID]
    return (r and r.hidden and r.hidden[spellID]) and true or false
end
