local ADDON, CRT = ...

-- Timeline: the ability rows of a boss. The rows come from the Encounter Journal (every ability
-- that has a spell, in Journal order, each spell once), followed by spells you added yourself.
-- The game only gives the Journal's boss list for the instance you are in, so the boss is found
-- through the map you stand on first, then by looking through the current tier's raids; the
-- Journal's own selected instance is put back afterwards so its window is not disturbed. Nothing
-- is looked up during combat or while the Journal window is open, and what is found is kept for
-- the rest of the session. Hiding a row only sets a flag: the page decides what to draw. A
-- reference timeline that only knows its boss by name finds the boss the same way, by the name
-- the Journal gives it (EncounterByName), so its rows get icons and tooltips anywhere. Each row
-- keeps the ID of its first Journal section. The Journal's text of an ability, for the shared
-- ability tooltip, is read here too (Journal:AbilitySection, near the end).

local Journal = {}
CRT.TimelineJournal = Journal

local cache = {}
-- bosses the Journal could not be asked about in this zone; only your own rows are listed for them
local missed = {}
-- boss names looked up in the Journal: [name] = dungeon encounter id, or false when not found
local byName = {}
-- the bosses of each raid instance, by Journal instance id
local raidCache = {}

-- the Journal's text of each boss's abilities, for the ability tooltip (Journal:AbilitySection below):
-- ["encounterID|difficultyID"] = the boss's sections, or false when the Journal doesn't know the boss
local texts = {}

local zoneFrame = CreateFrame("Frame")
zoneFrame:RegisterEvent("ZONE_CHANGED_NEW_AREA")
zoneFrame:RegisterEvent("PLAYER_ENTERING_WORLD")
-- a spell's text that loaded late (the Journal reads its own again on it too): its kept text is read again
zoneFrame:RegisterEvent("SPELL_TEXT_UPDATE")
zoneFrame:SetScript("OnEvent", function(_, event, spellID)
    if event == "SPELL_TEXT_UPDATE" then
        if Journal.TextChanged then
            Journal.TextChanged(spellID)
        end
        return
    end
    missed = {}
    for name, id in pairs(byName) do
        if id == false then
            byName[name] = nil
        end
    end
    for key, map in pairs(texts) do
        if map == false then
            texts[key] = nil
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

-- The boss in the instance that is selected right now that match(name, dungeonEncounterID)
-- accepts: its Journal root section and dungeon encounter id, or nil.
local function rootInSelected(match)
    local j = 1
    while j < 100 do
        local ok, _, _, journalID = pcall(EJ_GetEncounterInfoByIndex, j)
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

-- The Journal root section and dungeon encounter id of the boss match accepts, or nil when it
-- cannot be found. during(root), when given, runs while the boss's instance is still selected.
local function findRoot(match, during)
    if not (EJ_SelectInstance and EJ_GetEncounterInfoByIndex and EJ_GetEncounterInfo) then
        return nil
    end
    -- the instance the Journal has selected now, to put back afterwards
    local previous
    if EJ_GetCurrentInstance then
        local ok, id = pcall(EJ_GetCurrentInstance)
        previous = ok and id or nil
    elseif EncounterJournal then
        previous = EncounterJournal.instanceID
    end
    local root, found
    -- the instance of the map we stand on
    if EJ_GetInstanceForMap and C_Map and C_Map.GetBestMapForUnit then
        local okMap, map = pcall(C_Map.GetBestMapForUnit, "player")
        if okMap and map then
            local okInst, instanceID = pcall(EJ_GetInstanceForMap, map)
            if okInst and instanceID and instanceID ~= 0 then
                pcall(EJ_SelectInstance, instanceID)
                root, found = rootInSelected(match)
            end
        end
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
            root, found = rootInSelected(match)
            if root then
                break
            end
            i = i + 1
        end
    end
    if root and during then
        during(root)
    end
    if previous and previous ~= 0 then
        local now
        if EJ_GetCurrentInstance then
            local ok, id = pcall(EJ_GetCurrentInstance)
            now = ok and id or nil
        end
        if now ~= previous then
            pcall(EJ_SelectInstance, previous)
        end
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
-- listed, and that miss is remembered until the zone changes so the Journal is not walked again.
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
    local root
    if not missed[encounterID] then
        root = findRoot(byEncounter(encounterID))
        if not root then
            missed[encounterID] = true
        end
    end
    if root then
        collect(root, rows, seen)
    end
    local mine = settings().rows and settings().rows[encounterID]
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
-- combat with the Journal closed; a name that is not found is tried again after a zone change.
function Journal:EncounterByName(name)
    local key = nameKey(name)
    if key == "" then
        return nil
    end
    local known = byName[key]
    if known ~= nil then
        return known or nil
    end
    if InCombatLockdown() or (EncounterJournal and EncounterJournal:IsShown()) then
        return nil
    end
    local _, id = findRoot(function(bossName)
        return type(bossName) == "string" and nameKey(bossName) == key
    end)
    byName[key] = type(id) == "number" and id or false
    return byName[key] or nil
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
-- follows the Journal's picked difficulty (EJ_SetDifficulty; the game writes the numbers in), so a boss is read at
-- the difficulty of the page that asks: Mythic (16) for the "mythic" group, Heroic (15) for "nh", the Journal's own
-- for none. A boss is read once per difficulty, out of combat and with the Journal window closed (a new difficulty
-- makes the Journal redraw itself), with the Journal's difficulty and instance put back right after, and kept until
-- the season's route changes; in combat or with the Journal open only what is kept shows. A section is found by
-- an explicit [section N] first, else its spell, else its title or spell name (Reference.Norm); one the difficulty
-- hides never replaces one it shows, and the Overview's role summaries are left out. A boss the Journal doesn't
-- have is remembered until the zone changes. A section whose text hadn't loaded is read again, alone, on the next
-- hover, and so is one whose spell's text the game says loaded (SPELL_TEXT_UPDATE).
Journal.GROUP_DIFFICULTY = { mythic = 16, nh = 15 }

local function journalOpen()
    return EncounterJournal ~= nil and EncounterJournal.IsShown ~= nil and EncounterJournal:IsShown() and true or false
end

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

-- Reads a boss's sections at difficulty want, with the boss's instance selected, then puts the Journal's
-- difficulty back (again once its own instance is selected, should the boss's instance not have it).
local function buildTexts(encounterID, want)
    local before = currentDifficulty()
    local map
    findRoot(byEncounter(encounterID), function(root)
        setDifficulty(want)
        map = readTexts(root, currentDifficulty() or want)
        setDifficulty(before)
    end)
    setDifficulty(before)
    return map
end

-- One section read alone at the boss's difficulty: a kept one's text again, or one only an explicit
-- [section N] names. Nil when the game gives nothing.
local function readOne(map, sectionID)
    local before = currentDifficulty()
    setDifficulty(map.difficultyID)
    local info
    if map.difficultyID == nil or currentDifficulty() == map.difficultyID then
        info = getSection(sectionID)
    end
    setDifficulty(before)
    return info
end

local function refresh(map, s)
    local info = readOne(map, s.sectionID)
    if info then
        s.description = type(info.description) == "string" and info.description or nil
    end
    s.stale, s.retried = nil, true
end

-- SPELL_TEXT_UPDATE: the kept sections of that spell are read again on their next hover.
function Journal.TextChanged(spellID)
    spellID = plainNumber(spellID)
    if not spellID then
        return
    end
    for _, map in pairs(texts) do
        for _, s in pairs(map and map.byID or {}) do
            if s and s.spellID == spellID then
                s.stale = true
            end
        end
    end
end

-- The Journal section of an ability for the ability tooltip: { sectionID, spellID, title, description (nil when
-- the game has none), icon, tags }, and the difficulty ID its text was read at; nil when there is none or it
-- can't be read now. encounterID is the dungeon encounter ID; group "mythic" or "nh" (nil: the Journal's own
-- difficulty); sectionID an explicit [section N]; cachedOnly reads nothing new (for drawing).
function Journal:AbilitySection(encounterID, group, spellID, name, sectionID, cachedOnly)
    if type(encounterID) ~= "number" then
        return nil
    end
    local want = Journal.GROUP_DIFFICULTY[group] or currentDifficulty()
    local key = encounterID .. "|" .. tostring(want)
    local map = texts[key]
    local canRead = not cachedOnly and not InCombatLockdown() and not journalOpen()
    local built = false
    if map == nil then
        if not canRead then
            return nil
        end
        map = buildTexts(encounterID, want) or false
        texts[key] = map
        built = true
    end
    if not map then
        return nil
    end
    local s
    sectionID = plainNumber(sectionID)
    if sectionID then
        s = map.byID[sectionID]
        if s == nil and canRead then
            local info = readOne(map, sectionID)
            s = info and sectionText(sectionID, info) or false
            map.byID[sectionID] = s
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

-- a new season or route: every boss's text is read again
if CRT.Bosses and CRT.Bosses.OnRouteChange then
    CRT.Bosses:OnRouteChange(function()
        texts = {}
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

function Journal:IsHidden(encounterID, spellID)
    local r = settings().rows and settings().rows[encounterID]
    return (r and r.hidden and r.hidden[spellID]) and true or false
end
