local ADDON, CRT = ...

-- Export reference: a button on the game's Encounter Journal, beside the boss's name while a boss is
-- open. It reads that boss (EncounterJournal.encounterID, set by EncounterJournal_DisplayEncounter) and the
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
        "# Add a Length line and Phase lines (Phase: P2 7:20) if you know them. Lines left with # are skipped.",
    },
}

-- The reference text for a Journal encounter at a difficulty ID; nil when the Journal can't say.
function Export.Build(journalEncounterID, difficultyID)
    local Journal = CRT.TimelineJournal
    local name, dungeonID, rows = Journal.FromJournalEncounter(journalEncounterID)
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
    for _, row in ipairs(rows) do
        lines[#lines + 1] = "# " .. row.name .. " [spell " .. row.spellID .. "]:"
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
    button = CreateFrame("Button", nil, info, "UIPanelButtonTemplate")
    button:SetSize(130, 22)
    button:SetPoint("LEFT", info.encounterTitle, "RIGHT", 10, 0)
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
