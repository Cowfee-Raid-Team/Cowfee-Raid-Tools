local ADDON, CRT = ...

-- The one tooltip of a boss ability, wherever CRT shows one: the Timeline's icons and rows (Timeline/View.lua),
-- the Mech Alerts list (Notes/Reminders.lua) and Season Stats' death causes (SeasonStats/Page.lua). Top to bottom:
--   the game's spell tooltip (GameTooltip:SetSpellByID; the name as a gold title when the game refuses it or
--     there is no spell),
--   the caller's own lines (a cast's time, how long it lasts),
--   "Encounter Journal (Mythic)" and the ability's Journal text in white, at the difficulty the page shows
--     (Journal:AbilitySection: read once per boss and difficulty, then kept; none when the Journal doesn't
--     have the ability or can't be read now),
--   its ability types, each in its type's colour (Reference.TypeLine), or the caller's line for none,
--   the Journal's icons on one line.
-- Placed by UI.TooltipOwner with the caller's area key, so each page's Tooltip position reaches it.
--   AbilityTip:Show(tooltip, owner, area, info)
--     info = { encounterID, group, spellID, name, sectionID, types, tags, row, lines = { { text, r, g, b } },
--              empty }
--     row: an ability timeline row; its types, tags and [section N] stand in for ones info doesn't give.

local Tip = {}
CRT.AbilityTip = Tip

local TEXT = {
    journal = "Encounter Journal (%s)",
    journalPlain = "Encounter Journal",
    unknown = "Unknown",
}

local GOLD = { 1, 0.82, 0 } -- GameTooltip's own title gold, as its spell titles
local WHITE = { 1, 1, 1 }
local TAG_ICON = 14

-- The difficulty's name as the game writes it, else the group's.
local function difficultyName(difficultyID, group)
    if difficultyID and GetDifficultyInfo then
        local ok, name = pcall(GetDifficultyInfo, difficultyID)
        if ok and type(name) == "string" and name ~= "" then
            return name
        end
    end
    local names = CRT.Timeline and CRT.Timeline.GROUP_NAMES
    return names and names[group] or nil
end

-- The Journal's text as tooltip lines: an Overview's "$bullet;" marks start lines of their own.
local function journalText(s)
    local text = s:gsub("%s*%$bullet;%s*", "\n- ")
    return (text:gsub("^%s+", ""):gsub("%s+$", ""))
end

local function addSpell(tooltip, spellID, name)
    if type(spellID) == "number" and spellID > 0 and tooltip.SetSpellByID
        and pcall(tooltip.SetSpellByID, tooltip, spellID) then
        return
    end
    tooltip:SetText(name or TEXT.unknown, GOLD[1], GOLD[2], GOLD[3])
end

local function addJournal(tooltip, info)
    local Journal = CRT.TimelineJournal
    if not (Journal and Journal.AbilitySection) then
        return
    end
    local sectionID = info.sectionID or (info.row and info.row.sectionID)
    local ok, s, difficultyID = pcall(Journal.AbilitySection, Journal, info.encounterID, info.group, info.spellID, info.name, sectionID)
    if not ok or type(s) ~= "table" then
        return nil
    end
    local text = type(s.description) == "string" and journalText(s.description) or ""
    if text ~= "" then
        local heading = difficultyName(difficultyID, info.group)
        tooltip:AddLine(heading and TEXT.journal:format(heading) or TEXT.journalPlain, GOLD[1], GOLD[2], GOLD[3])
        tooltip:AddLine(text, WHITE[1], WHITE[2], WHITE[3], true)
    end
    return s
end

local function addTypes(tooltip, types, empty)
    local Reference = CRT.TimelineReference
    local any = false
    for _, key in ipairs(types or {}) do
        local line, c
        if Reference then
            line, c = Reference.TypeLine(key)
        end
        if line then
            tooltip:AddLine(line, c[1], c[2], c[3], true)
            any = true
        end
    end
    if not any and empty then
        tooltip:AddLine(empty, WHITE[1], WHITE[2], WHITE[3], true)
    end
end

-- The Journal's icons on one line, each with its name: "[icon] Magic  [icon] Healer".
local function addTags(tooltip, tags)
    local TAGS = CRT.TimelineReference and CRT.TimelineReference.TAGS
    local parts = {}
    for _, key in ipairs(tags or {}) do
        local t = TAGS and TAGS[key]
        if t then
            parts[#parts + 1] = string.format("|A:%s:%d:%d|a %s", t.atlas, TAG_ICON, TAG_ICON, t.label)
        end
    end
    if parts[1] then
        tooltip:AddLine(table.concat(parts, "  "), WHITE[1], WHITE[2], WHITE[3], true)
    end
end

function Tip:Show(tooltip, owner, area, info)
    tooltip = tooltip or GameTooltip
    info = info or {}
    local row = info.row
    CRT.UI.TooltipOwner(tooltip, owner, "ANCHOR_RIGHT", nil, nil, area)
    addSpell(tooltip, info.spellID, info.name)
    for _, line in ipairs(info.lines or {}) do
        tooltip:AddLine(line[1], line[2] or WHITE[1], line[3] or WHITE[2], line[4] or WHITE[3], true)
    end
    local section = addJournal(tooltip, info)
    addTypes(tooltip, info.types or (row and row.types), info.empty)
    addTags(tooltip, info.tags or (row and row.tags) or (section and section.tags))
    tooltip:Show()
end
