local ADDON, CRT = ...

-- Export Abilities: a button on the game's Encounter Journal, on the row of its tabs at the bottom right
-- (clear of the boss's name and the difficulty dropdown), while a boss is open. It reads that boss (EncounterJournal.encounterID, set by EncounterJournal_DisplayEncounter) and the
-- difficulty picked in the Journal (EJ_GetDifficulty), and writes a starting reference timeline for it:
-- the Boss, Difficulty and Encounter lines, then one line per Journal ability with its spell ID, each a
-- "#" line (skipped when read) until it gets times. It opens in a copy window with Send to Timeline, which
-- puts it in the Timeline's Advanced tab reference box to fill in and Save. The Journal is only read here,
-- for the boss already shown, so the window's own selection is never changed.
-- The Journal is a load-on-demand addon (Blizzard_EncounterJournal): the button is made when it loads.

local Export = {}
CRT.TimelineJournalExport = Export

local TEXT = {
    button = "Export Abilities",
    tip = "Cowfee Raid Tools: writes this boss's abilities as an ability timeline, with every spell, for you to add the cast times on the Timeline's Advanced tab.",
    title = "Abilities for %s (Ctrl+C to copy)",
    send = "Send to Timeline",
    none = "Open a boss in the Journal first.",
    combat = "The Journal can't be read in combat.",
    help = {
        "# From the Encounter Journal. Add each ability's times after its colon, as m:ss or seconds: 0:02, 1:17",
        "# A Phase line with no time yet is the stage's start to fill in: Phase: P1.5 3:17 (Intermission: ...)",
    },
    saved = "Saved the abilities for %s. Add their times on the Timeline's Advanced tab.",
}

-- The Journal's icons that are reference types too: a dispellable debuff, a Heroic or a Mythic mechanic.
local TYPE_OF_TAG = CRT.TimelineReference.TAG_TYPES

-- " (type dispel, tags magic healer)" for an ability's Journal icons, the types once each; "" with none.
function Export.Options(tags)
    if not (tags and tags[1]) then
        return ""
    end
    local types, seen = {}, {}
    for _, tag in ipairs(tags) do
        local t = TYPE_OF_TAG[tag]
        if t and not seen[t] then
            seen[t] = true
            types[#types + 1] = t
        end
    end
    local parts = {}
    if types[1] then
        parts[#parts + 1] = "type " .. table.concat(types, " ")
    end
    parts[#parts + 1] = "tags " .. table.concat(tags, " ")
    return " (" .. table.concat(parts, ", ") .. ")"
end

-- An ability's line: "Name [spell N] [section N] (tags ...):", the section its Journal text is read from by the
-- ability tooltip (Timeline/AbilityTip.lua).
local function abilityLine(row)
    local section = type(row.sectionID) == "number" and (" [section " .. row.sectionID .. "]") or ""
    return row.name .. " [spell " .. row.spellID .. "]" .. section .. Export.Options(row.tags) .. ":"
end

-- A boss with the older Abilities page (raids before Warlords of Draenor): its abilities in Journal order, with a
-- "#" line for each header above them ("# Theralion", "# Grounded Abilities") as it starts. Back at a shallower
-- level after a header's abilities, that level's header (the boss's name at the top) is repeated, so an ability
-- is never read as under the header before it. No header becomes a Phase line. An entry the Journal gives no
-- spell is a "#" line too, "# Pillar of Flame (no spell)": its title could be anything ("Phase 2: Molten",
-- "Order"), and as an ability line one title the reference reader rejects would fail the whole Send.
local function abilitiesLines(lines, rows, bossName)
    local shown = {}
    for _, row in ipairs(rows) do
        local headers = row.headers or {}
        local same = 0
        while same < #headers and same < #shown and headers[same + 1] == shown[same + 1] do
            same = same + 1
        end
        if same == #headers and #headers < #shown then
            lines[#lines + 1] = "# " .. (headers[#headers] or bossName)
        end
        for i = same + 1, #headers do
            lines[#lines + 1] = "# " .. headers[i]
        end
        shown = headers
        if row.spellID then
            lines[#lines + 1] = abilityLine(row)
        else
            lines[#lines + 1] = "# " .. row.name .. " (no spell)"
        end
    end
end

-- The reference text for a Journal encounter at a difficulty ID; nil when the Journal can't say.
function Export.Build(journalEncounterID, difficultyID)
    local Journal = CRT.TimelineJournal
    local name, dungeonID, rows, stages, layout = Journal.FromJournalEncounter(journalEncounterID)
    if not name then
        return nil
    end
    local difficulty = difficultyID and GetDifficultyInfo and GetDifficultyInfo(difficultyID) or nil
    local lines = { "Boss: " .. name }
    if difficulty and difficulty ~= "" then
        lines[#lines + 1] = "Difficulty: " .. difficulty
    end
    if type(dungeonID) == "number" and dungeonID > 0 then
        lines[#lines + 1] = "Encounter: " .. dungeonID
    end
    for _, help in ipairs(TEXT.help) do
        lines[#lines + 1] = help
    end
    if layout == "abilities" then
        abilitiesLines(lines, rows, name)
        return table.concat(lines, "\n"), name
    end
    -- each stage with abilities after the first gets a Phase line to fill in: P2, P3 for stages, P1.5 for an
    -- intermission (a stage the export lists no ability under, such as an empty header, isn't counted)
    local order, listed = {}, {}
    for _, row in ipairs(rows) do
        if row.stage and not listed[row.stage] then
            listed[row.stage] = true
            order[#order + 1] = row.stage
        end
    end
    local phaseOf, whole = {}, 1
    for i, title in ipairs(order) do
        if i > 1 then
            if title:lower():find("intermission") then
                phaseOf[title] = whole .. ".5"
            else
                whole = whole + 1
                phaseOf[title] = tostring(whole)
            end
        end
    end
    -- the first stage starts at the pull (a heading only); each later one is a Phase line with no time yet
    local Reference = CRT.TimelineReference
    local shownStage
    for _, row in ipairs(rows) do
        if row.stage and row.stage ~= shownStage then
            shownStage = row.stage
            if phaseOf[row.stage] then
                lines[#lines + 1] = Reference.PhaseLine("P" .. phaseOf[row.stage], nil, row.stage)
            else
                lines[#lines + 1] = "# " .. row.stage
            end
        end
        lines[#lines + 1] = abilityLine(row)
    end
    return table.concat(lines, "\n"), name
end

local function show(text, name)
    CRT.ConsumablesTools:ShowText(string.format(TEXT.title, name), text, {
        label = TEXT.send,
        onClick = function(t)
            if CRT.Timeline:SaveReferenceText(t) then
                CRT:Print(string.format(TEXT.saved, name))
            end
        end,
    })
end

function Export:Run()
    if InCombatLockdown() then
        CRT:Print(TEXT.combat)
        return
    end
    local id = EncounterJournal and EncounterJournal.encounterID
    if not id then
        CRT:Print(TEXT.none)
        return
    end
    local text, name = Export.Build(id, EJ_GetDifficulty and EJ_GetDifficulty() or nil)
    if not text then
        CRT:Print(TEXT.none)
        return
    end
    show(text, name)
end

local button

-- Shown while a boss is open in the Journal, beside its name.
local function place()
    if not button then
        return
    end
    button:SetShown(EncounterJournal and EncounterJournal.encounterID ~= nil)
end

local function build()
    local info = EncounterJournal and EncounterJournal.encounter and EncounterJournal.encounter.info
    if button or not (info and info.encounterTitle) then
        return
    end
    -- the boss panel holds it, so it hides with the panel; it sits under the Journal's bottom right corner
    button = CreateFrame("Button", nil, info, "UIPanelButtonTemplate")
    button:SetSize(140, 24)
    button:SetPoint("TOPRIGHT", EncounterJournal, "BOTTOMRIGHT", -6, -2)
    button:SetText(TEXT.button)
    button:SetScript("OnClick", function()
        Export:Run()
    end)
    button:SetScript("OnEnter", function(self)
        -- on the game's Encounter Journal, so the tooltip stays by the button
        CRT.UI.TooltipOwner(GameTooltip, self, "ANCHOR_RIGHT", nil, nil, CRT.UI.TOOLTIP_KEEP)
        GameTooltip:SetText(TEXT.tip, 1, 1, 1, 1, true)
        GameTooltip:Show()
    end)
    button:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    if hooksecurefunc then
        hooksecurefunc("EncounterJournal_DisplayEncounter", place)
        if EncounterJournal_DisplayInstance then
            hooksecurefunc("EncounterJournal_DisplayInstance", place)
        end
    end
    place()
end

local events = CreateFrame("Frame")
events:RegisterEvent("ADDON_LOADED")
events:SetScript("OnEvent", function(self, _, name)
    if name == "Blizzard_EncounterJournal" then
        build()
        self:UnregisterEvent("ADDON_LOADED")
    end
end)
-- already loaded (another addon opened it first)
if C_AddOns and C_AddOns.IsAddOnLoaded and C_AddOns.IsAddOnLoaded("Blizzard_EncounterJournal") then
    build()
end
