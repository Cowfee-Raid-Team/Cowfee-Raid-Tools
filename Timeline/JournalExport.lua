local ADDON, CRT = ...

-- Export reference: a button on the game's Encounter Journal, on the row of its tabs at the bottom right
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
    button = "Export reference",
    tip = "Cowfee Raid Tools: a reference timeline for this boss and difficulty, with every Journal ability and its spell ID, to add the cast times to on the Timeline's Advanced tab.",
    title = "Reference for %s (Ctrl+C to copy)",
    send = "Send to Timeline",
    none = "Open a boss in the Journal first.",
    combat = "The Journal can't be read in combat.",
    help = {
        "# From the Encounter Journal. Take the # off an ability's line and add its times after the colon,",
        "# as m:ss or seconds, separated by commas: Soulcoil Rite [spell 1284033]: 0:02, 1:17, 2:28",
        "# Each stage has a Phase line: take its # off and put the time the stage starts. Lines left with # are skipped.",
        "# type colors the row (from the Journal's dispel, Heroic and Mythic icons); tags are the Journal's icons.",
    },
}

-- The Journal's icons that are reference types too: a dispellable debuff, a Heroic or a Mythic mechanic.
local TYPE_OF_TAG = { magic = "dispel", curse = "dispel", poison = "dispel", disease = "dispel", heroic = "heroic",
    mythic = "mythic" }

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

-- The reference text for a Journal encounter at a difficulty ID; nil when the Journal can't say.
function Export.Build(journalEncounterID, difficultyID)
    local Journal = CRT.TimelineJournal
    local name, dungeonID, rows, stages = Journal.FromJournalEncounter(journalEncounterID)
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
    local shownStage
    for _, row in ipairs(rows) do
        if row.stage and row.stage ~= shownStage then
            shownStage = row.stage
            lines[#lines + 1] = "# --- " .. row.stage .. " ---"
            if phaseOf[row.stage] then
                lines[#lines + 1] = "# Phase: P" .. phaseOf[row.stage] .. " 0:00"
            end
        end
        lines[#lines + 1] = "# " .. row.name .. " [spell " .. row.spellID .. "]" .. Export.Options(row.tags) .. ":"
    end
    return table.concat(lines, "\n"), name
end

local function show(text, name)
    CRT.ConsumablesTools:ShowText(string.format(TEXT.title, name), text, {
        label = TEXT.send,
        onClick = function(t)
            CRT.Timeline:OpenReferenceText(t)
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
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
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
