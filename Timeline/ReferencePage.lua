local ADDON, CRT = ...

-- The Timeline page's References tab. On the left, a box to paste or write a reference timeline
-- (the text format of Timeline/Reference.lua) with Save, and a status line that says "Saved for ..." or
-- the first errors. On the right, the selected boss's references: yours with Edit and Delete, the
-- shipped ones with Copy, which puts their text in the box to change and save as your own. The
-- Timeline page builds it with Build(parent, ctx) and calls tab:Refresh() when anything changes;
-- ctx gives it selectedBoss(), bossName(), difficulty() (the page's difficulty group, "nh" or
-- "mythic"), references() (the selected boss's references of that group, by the same rule as the
-- boss list) and refresh(). Save stamps the text with the page's difficulty, and each listed
-- reference has a Copy to button that adds a copy for the other group. Recent(parent, width, pullLabel, toggle) makes the
-- Review tab's Recent pulls list: the boss's saved pulls beside a reference, where a click lays
-- one over it (toggle(pullID)); the page keeps which one, and says with recent:Update.

local Reference = CRT.TimelineReference
local Journal = CRT.TimelineJournal
local UI = CRT.UI
local View = CRT.TimelineView

local ReferencePage = {}
CRT.TimelineReferencePage = ReferencePage

local ROW_H = 46 -- a reference row: name and kind above, its buttons below
local BOX_W = 340
local LIST_X = 364 -- the Journal abilities, the full height of the middle column
local LIST_W = 310
local REFS_X = UI.PAGE_W - 8 - LIST_W -- the boss's references, in the right column, out of the way
local MAX_ERRORS = 3
local ABILITY_H = 20

local GROUP_NAMES = CRT.Timeline.GROUP_NAMES
local OTHER_GROUP = { nh = "mythic", mythic = "nh" }

local GRAY = { 0.35, 0.35, 0.35 }
local GOLD = { 1, 0.82, 0 }
local BACKDROP = {
    bgFile = "Interface\\Buttons\\WHITE8X8",
    edgeFile = "Interface\\Buttons\\WHITE8X8",
    edgeSize = 1,
}

local FORMAT_HELP = "One line per thing:\n\n"
    .. "Boss: Nek'zali the Soulcoiler  (required)\n"
    .. "Difficulty: Mythic  (shown in its name; Save writes the difficulty chosen on the Review tab)\n"
    .. "Length: 9:48  (else the last cast plus its bar)\n"
    .. "Encounter: 3001  (the boss's encounter ID, optional)\n"
    .. "Phase: P2 7:20  (a phase line, the label is optional)\n"
    .. "Soulcoil Rite (type raid, lead 7) [spell 123456]: 0:02+45, 1:17, 95\n\n"
    .. "A time is m:ss or plain seconds, and +N after it draws a bar N seconds long. type says what the ability is, one or more of the words below: the first colors the row, and each other one adds a dot to its name. tags lists the Encounter Journal's icons for it (tank, healer, dps, heroic, mythic, deadly, important, interrupt, magic, curse, poison, disease, enrage, bleed), which the Journal's Export Abilities writes for you. lead N draws the cast line N seconds before each icon, color rrggbb colors the name instead of its type, and [spell N] gives the icon and tooltip; without it the row is matched by name to the boss's Journal abilities. Blank lines and lines starting with # are skipped. Nothing is saved until every line reads.\n\n"
    .. CRT.TimelineReference.Legend()
    .. "\n\nIcons and the match to a Journal ability come from the Encounter Journal, which is not read in combat, so they can be blank until you are out of combat."

local function skin(frame, alpha)
    frame:SetBackdrop(BACKDROP)
    frame:SetBackdropColor(0, 0, 0, alpha or 0.5)
    frame:SetBackdropBorderColor(GRAY[1], GRAY[2], GRAY[3], 1)
end

local function label(parent, text, font)
    local fs = parent:CreateFontString(nil, "OVERLAY", font or "CRTFontNormal")
    fs:SetText(text)
    return fs
end

local function button(parent, text, width)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontButtonSmall)
    b:SetHighlightFontObject(CRTFontButtonSmallHighlight)
    b:SetDisabledFontObject(CRTFontButtonSmallDisable)
    b:SetSize(width, 20)
    b:SetText(text)
    return b
end

-- Asks in the game's own confirmation box, then runs accept.
local function confirm(text, arg, acceptText, accept)
    StaticPopup_ShowCustomGenericConfirmation({
        text = text,
        text_arg1 = arg,
        acceptText = acceptText,
        cancelText = CANCEL,
        showAlert = true,
        callback = accept,
    })
end

-- The Recent pulls list -------------------------------------------------------------------------

local RECENT_H = 36 -- a pull's box and the gap under it

function ReferencePage.Recent(f, width, pullLabel, toggle)
    local frame = CreateFrame("Frame", nil, f)
    frame:SetPoint("TOPRIGHT", f, "TOPRIGHT", -8, -96)
    frame:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -8, 8)
    frame:SetWidth(width)
    frame:Hide()
    local title = label(frame, "Recent pulls")
    title:SetPoint("TOPLEFT", 4, 0)
    UI.Help(frame, "Recent pulls", "This boss's saved pulls. Click one to lay it over the ability timeline: its deaths go in the Deaths row, its casts are drawn as ticks in a row of their own (their spells are usually unreadable), and a line marks where it ended. Click it again to clear it."):SetPoint("LEFT", title, "RIGHT", 4, 0)

    local recent, lines = {}, {}
    -- pulls newest first, each in a box as the Raid Notes list draws its notes, overlayID the one laid
    -- over the reference (a gold border), shown whether a reference is shown at all
    function recent:Update(pulls, overlayID, shown)
        frame:SetShown(shown)
        for i, pull in ipairs(pulls) do
            local line = lines[i]
            if not line then
                line = CreateFrame("Button", nil, frame, "BackdropTemplate")
                line:SetSize(width, RECENT_H - 4)
                line:SetPoint("TOPLEFT", frame, "TOPLEFT", 0, -22 - (i - 1) * RECENT_H)
                skin(line, 0.45)
                line.title = label(line, "", "CRTFontSmall")
                line.title:SetPoint("TOPLEFT", 8, -3)
                line.title:SetPoint("RIGHT", line, "RIGHT", -6, 0)
                line.title:SetJustifyH("LEFT")
                line.title:SetWordWrap(false)
                line.deaths = label(line, "", "CRTFontSmall")
                line.deaths:SetPoint("TOPLEFT", 8, -17)
                line.deaths:SetTextColor(1, 0.3, 0.3)
                line:SetScript("OnClick", function(self)
                    toggle(self.pullID)
                end)
                lines[i] = line
            end
            line.pullID = pull.id
            line.title:SetText(pullLabel(pull))
            local n = #(pull.deaths or {})
            line.deaths:SetText(n == 1 and "1 death" or (n .. " deaths"))
            local c = pull.id == overlayID and GOLD or GRAY
            line:SetBackdropBorderColor(c[1], c[2], c[3], 1)
            line:Show()
        end
        for i = #pulls + 1, #lines do
            lines[i]:Hide()
        end
    end
    return recent
end

-- The Journal abilities' menu ------------------------------------------------------------------------

local TEXT_ROW = "row"
local TEXT_MENU = {
    row = "Show as a timeline row",
    type = "Set type",
    noType = "No type",
    tags = "Tags",
    journalTags = "Use the Journal's icons",
    addPhase = "Add phase here...",
    addIntermission = "Add intermission here...",
    setStart = "Set start time...",
    removePhase = "Remove this phase",
    intermissionTitle = "Intermission",
    phasePrompt = "When %s starts, m:ss or seconds (leave it empty to fill in later):",
    noTimes = "no times",
    noStart = "no start yet",
    refHeading = "Abilities",
    pullPhase = "Phase 1 (from the pull)",
    rename = "Rename...",
    unname = "Use the Journal's name",
    alert = "Make a Mech Alert",
    renamePrompt = "Your name for %s on the timeline:",
    hide = "Hide from the timeline (dev, ships)",
    hidden = "hidden",
}
local RENAME_ABILITY = "COWFEERAIDTOOLS_RENAME_ABILITY"
local abilityMenu -- set in Build, where the list is

local function acceptAbilityName(edit, data)
    if edit and data then
        CRT.Timeline:SetAbility(data.boss, data.spellID, "name", strtrim(edit:GetText() or ""))
    end
end

-- A popup with an edit box for your name of a Journal ability; an empty name goes back to the Journal's.
local function askAbilityName(boss, row, current)
    if not StaticPopupDialogs then
        return
    end
    if not StaticPopupDialogs[RENAME_ABILITY] then
        StaticPopupDialogs[RENAME_ABILITY] = {
            text = "%s",
            button1 = ACCEPT or "Accept",
            button2 = CANCEL or "Cancel",
            hasEditBox = true,
            maxLetters = 48,
            timeout = 0,
            whileDead = true,
            hideOnEscape = true,
            preferredIndex = 3,
            OnShow = function(dialog, data)
                local edit = CRT.UI.PopupEditBox(dialog)
                if edit then
                    edit:SetText(data and data.current or "")
                    edit:HighlightText()
                end
            end,
            OnAccept = function(dialog, data)
                acceptAbilityName(CRT.UI.PopupEditBox(dialog), data)
            end,
            EditBoxOnEnterPressed = function(edit, data)
                local parent = edit:GetParent()
                acceptAbilityName(edit, data or (parent and parent.data))
                StaticPopup_Hide(RENAME_ABILITY)
            end,
            EditBoxOnEscapePressed = function()
                StaticPopup_Hide(RENAME_ABILITY)
            end,
        }
    end
    StaticPopup_Show(RENAME_ABILITY, string.format(TEXT_MENU.renamePrompt, row.name or ""), nil,
        { boss = boss, spellID = row.spellID, current = current or row.name })
end

-- One ability's menu, shared by the Advanced tab's lists and (developer builds, /crt dev open) the Review
-- tab's and the pop-out's row names: with its spell, your own labels for it (Timeline:SetAbility: a row,
-- a type, the Journal's icons, a name) and Make a Mech Alert, which opens the Mech Alerts tab on it; in
-- DevMode, Hide from the timeline (Timeline:SetHidden), which ships. row: { name, spellID, tags } with the
-- Journal's name and icons; hideName: the name it is hidden by (nil for no Hide).
local AbilityMenu = {}
CRT.TimelineAbilityMenu = AbilityMenu

function AbilityMenu.Fill(root, boss, row, hideName)
    local spellID = boss and row.spellID and row.spellID ~= 0 and row.spellID or nil
    local Timeline = CRT.Timeline
    local function get(field)
        local a = spellID and Timeline:Ability(boss, spellID)
        return a and a[field]
    end
    root:CreateTitle((get("name") or row.name or "") .. (get("name") and (" (" .. (row.name or "") .. ")") or ""))
    if spellID then
        root:CreateCheckbox(TEXT_MENU.row, function()
            return get("row") and true or false
        end, function()
            Timeline:SetAbility(boss, spellID, "row", not get("row") or nil)
        end)
        local types = root:CreateButton(TEXT_MENU.type)
        types:CreateRadio(TEXT_MENU.noType, function()
            return get("type") == nil
        end, function()
            Timeline:SetAbility(boss, spellID, "type", nil)
        end)
        for _, key in ipairs(Reference.TYPE_ORDER) do
            local t = Reference.TYPES[key]
            local hex = string.format("%02x%02x%02x", t.color[1] * 255, t.color[2] * 255, t.color[3] * 255)
            types:CreateRadio("|cff" .. hex .. key:sub(1, 1):upper() .. key:sub(2) .. "|r  " .. t.label, function()
                return get("type") == key
            end, function()
                Timeline:SetAbility(boss, spellID, "type", key)
            end)
        end
        -- the Journal's icons for it: ticked ones are yours (they start as the Journal's own)
        local tags = root:CreateButton(TEXT_MENU.tags)
        local function current()
            local a = get("tags")
            return type(a) == "table" and a or (row.tags or {})
        end
        for _, key in ipairs(Reference.TAG_ORDER) do
            local t = Reference.TAGS[key]
            tags:CreateCheckbox("|A:" .. t.atlas .. ":14:14|a " .. t.label, function()
                for _, k in ipairs(current()) do
                    if k == key then
                        return true
                    end
                end
                return false
            end, function()
                local out, had = {}, false
                for _, k in ipairs(current()) do
                    if k == key then
                        had = true
                    else
                        out[#out + 1] = k
                    end
                end
                if not had then
                    out[#out + 1] = key
                end
                Timeline:SetAbility(boss, spellID, "tags", out)
            end)
        end
        if type(get("tags")) == "table" then
            tags:CreateButton(TEXT_MENU.journalTags, function()
                Timeline:SetAbility(boss, spellID, "tags", nil)
            end)
        end
        root:CreateButton(TEXT_MENU.rename, function()
            askAbilityName(boss, { name = row.name, spellID = spellID }, get("name"))
        end)
        if get("name") then
            root:CreateButton(TEXT_MENU.unname, function()
                Timeline:SetAbility(boss, spellID, "name", nil)
            end)
        end
        root:CreateButton(TEXT_MENU.alert, function()
            if CRT.NoteReminders and CRT.NoteReminders.Open then
                CRT.NoteReminders.Open(boss, spellID)
            end
        end)
    end
    if hideName and boss and Timeline.DevMode() then
        root:CreateDivider()
        root:CreateCheckbox(TEXT_MENU.hide, function()
            return Timeline:Hidden(boss, hideName)
        end, function()
            Timeline:SetHidden(boss, hideName, not Timeline:Hidden(boss, hideName))
        end)
    end
end

-- The References tab -----------------------------------------------------------------------------

function ReferencePage.Build(f, ctx)
    local tab = {}
    local editing -- the key of your reference that is in the box, nil for a new one
    local lines = {}

    -- Left: the text box, Save and Clear, and the status line.
    local title = label(f, "Abilities Text")
    title:SetPoint("TOPLEFT", f, "TOPLEFT", 8, -8)
    UI.Help(f, "Abilities Text", FORMAT_HELP):SetPoint("LEFT", title, "RIGHT", 6, 0)
    local mode = label(f, "", "CRTFontSmall")
    mode:SetPoint("TOPLEFT", f, "TOPLEFT", 160, -10)
    mode:SetWidth(BOX_W - 152)
    mode:SetJustifyH("RIGHT")
    mode:SetWordWrap(false)

    local box = CreateFrame("Frame", nil, f, "BackdropTemplate")
    box:SetPoint("TOPLEFT", f, "TOPLEFT", 8, -30)
    box:SetPoint("BOTTOMLEFT", f, "BOTTOMLEFT", 8, 84)
    box:SetWidth(BOX_W)
    skin(box, 0.4)
    local scroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsTimelineReferenceScroll", box, "UIPanelScrollFrameTemplate")
    scroll:SetPoint("TOPLEFT", 6, -6)
    scroll:SetPoint("BOTTOMRIGHT", -28, 6)
    local edit = CreateFrame("EditBox", nil, scroll)
    edit:SetMultiLine(true)
    edit:SetAutoFocus(false)
    edit:SetFontObject(CRTFontEdit)
    edit:SetWidth(BOX_W - 40)
    edit:SetScript("OnEscapePressed", function(self)
        self:ClearFocus()
    end)
    scroll:SetScrollChild(edit)
    scroll:SetScript("OnSizeChanged", function(_, width)
        edit:SetWidth(width)
    end)
    -- a click anywhere in the box types, not only on the lines that have text
    local function focus()
        edit:SetFocus()
        edit:SetCursorPosition(#(edit:GetText() or ""))
    end
    for _, frame in ipairs({ box, scroll }) do
        frame:EnableMouse(true)
        frame:SetScript("OnMouseDown", focus)
    end

    local status = label(f, "", "CRTFontSmall")
    status:SetPoint("TOPLEFT", box, "BOTTOMLEFT", 0, -32)
    status:SetWidth(BOX_W)
    status:SetJustifyH("LEFT")

    local function showMode()
        local entry = editing and Reference:Find(editing)
        if not entry then
            editing = nil
        end
        local where = " \194\183 " .. GROUP_NAMES[ctx.difficulty()]
        mode:SetText((entry and ("Editing " .. Reference.Label(entry.ref)) or "New abilities") .. where)
    end

    local refreshAbilities -- set below, with the abilities list; fill uses it

    -- Fills the box. key is your reference being edited, nil for text to save as a new one.
    local function fill(text, key)
        editing = key
        edit:SetText(text or "")
        edit:SetCursorPosition(0)
        status:SetText("")
        showMode()
        if refreshAbilities then
            refreshAbilities() -- the middle list shows your reference while it is open here
        end
    end

    local save = button(f, "Save", 80)
    save:SetPoint("TOPLEFT", box, "BOTTOMLEFT", 0, -6)
    save:SetScript("OnClick", function()
        edit:ClearFocus()
        -- What is typed is checked as typed (so an error names the right line); what is saved is
        -- stamped with the difficulty the page shows, and the box then shows it as saved.
        local typed = edit:GetText()
        local text = Reference.StampDifficulty(typed, ctx.difficulty())
        local ok, errors
        local _, typedErrors = Reference.Parse(typed)
        if typedErrors then
            errors = typedErrors
        elseif editing then
            ok, errors = Reference:Update(editing, text)
        else
            local key
            key, errors = Reference:Add(text)
            ok = key ~= nil
            editing = key or nil -- a second Save changes this one instead of adding another
        end
        if ok then
            edit:SetText(text)
            -- a reference for another boss is not in this boss's list: say where it went
            local saved = Reference.Parse(text)
            local here = false
            for _, entry in ipairs(ctx.references() or {}) do
                here = here or entry.key == editing
            end
            local sameName = saved and ctx.bossName() and saved.boss:lower() == ctx.bossName():lower()
            local where = (here or sameName) and GROUP_NAMES[ctx.difficulty()] or saved.boss
            if saved and saved.warnings then
                status:SetText("Saved for " .. where .. "\n" .. saved.warnings[1])
                status:SetTextColor(1, 0.82, 0)
            else
                status:SetText("Saved for " .. where)
                status:SetTextColor(0.4, 1, 0.4)
            end
        else
            local shown = {}
            for i = 1, math.min(MAX_ERRORS, #errors) do
                shown[i] = errors[i]
            end
            status:SetText(table.concat(shown, "\n"))
            status:SetTextColor(1, 0.3, 0.3)
        end
        showMode()
    end)
    local clear = button(f, "Clear", 80)
    clear:SetPoint("LEFT", save, "RIGHT", 8, 0)
    clear:SetScript("OnClick", function()
        fill("", nil)
    end)

    -- Adds a copy of a reference for the other difficulty group. Mythic-only rows are left out of a
    -- Normal/Heroic copy; a reference that is nothing but those rows has nothing to copy.
    local function copyTo(entry)
        local group = OTHER_GROUP[ctx.difficulty()]
        local text, removed = Reference.CopyTo(entry.text, group)
        local key = Reference:Add(text)
        if not key then
            status:SetText("Nothing to copy: every row is Mythic-only")
            status:SetTextColor(1, 0.3, 0.3)
            return
        end
        status:SetText("Copied to " .. GROUP_NAMES[group]
            .. (removed > 0 and (" (" .. removed .. " Mythic-only row" .. (removed == 1 and "" or "s") .. " left out)") or ""))
        status:SetTextColor(0.4, 1, 0.4)
    end

    -- The boss whose Journal abilities fit the box: its Boss and Encounter lines when it has them,
    -- else the selected boss. Returns the encounter ID to ask the Journal (or nil) and a name.
    local function journalBoss()
        local boss, encounterID = Reference.Header(edit:GetText())
        if boss or encounterID then
            return Journal:ResolveID(nil, { boss = boss, encounterID = encounterID }), boss or tostring(encounterID)
        end
        local selected = ctx.selectedBoss()
        local refs = selected and ctx.references() or {}
        return Journal:ResolveID(selected, refs[1] and refs[1].ref), ctx.bossName()
    end


    local fillIDs = button(f, "Fill spell IDs", 110)
    fillIDs:SetPoint("LEFT", clear, "RIGHT", 8, 0)
    fillIDs:SetScript("OnClick", function()
        edit:ClearFocus()
        local id, name = journalBoss()
        local rows = id and Journal:Rows(id) or {}
        if #rows == 0 then
            status:SetText("No Journal abilities found for " .. (name or "this boss") .. ".")
            status:SetTextColor(1, 0.3, 0.3)
        else
            local text, n = Reference.FillSpellIDs(edit:GetText(), rows)
            edit:SetText(text)
            status:SetText(n > 0 and ("Added " .. n .. " spell ID" .. (n == 1 and "" or "s") .. ". Save to keep them.")
                or "No more lines match a Journal ability.")
            status:SetTextColor(0.4, 1, 0.4)
        end
        refreshAbilities()
    end)
    UI.Help(f, "Fill spell IDs", "Adds [spell N] to every line whose name matches one of the boss's Encounter Journal abilities (listed on the right), so its icon and tooltip are fixed in the text. The boss is the one on the Boss line, or the selected boss.\n\nLines that already have a [spell] and lines that match nothing are left as they are. A name that doesn't match can be renamed to the Journal's name, or given [spell N] by hand.\n\nThe Journal is read out of combat with its window closed."):SetPoint("LEFT", fillIDs, "RIGHT", 4, 0)

    -- Right: the selected boss's references.
    local listLabel = label(f, "")
    listLabel:SetPoint("TOPLEFT", f, "TOPLEFT", REFS_X, -8)
    listLabel:SetWidth(310)
    listLabel:SetJustifyH("LEFT")
    listLabel:SetWordWrap(false)
    local empty = label(f, "No ability timelines for this boss yet", "CRTFontSmall")
    empty:SetPoint("TOPLEFT", f, "TOPLEFT", REFS_X, -34)

    local function line(i)
        local l = lines[i]
        if l then
            return l
        end
        l = CreateFrame("Frame", nil, f)
        l:SetSize(LIST_W, ROW_H)
        l:SetPoint("TOPLEFT", f, "TOPLEFT", REFS_X, -30 - (i - 1) * ROW_H)
        l.name = label(l, "", "CRTFontSmall")
        l.name:SetPoint("TOPLEFT", 0, -2)
        l.name:SetWidth(150)
        l.name:SetJustifyH("LEFT")
        l.name:SetWordWrap(false)
        l.kind = label(l, "", "CRTFontSmall")
        l.kind:SetPoint("TOPLEFT", 154, -2)
        l.kind:SetTextColor(0.6, 0.6, 0.6)
        l.delete = button(l, "Delete", 52)
        l.delete:SetPoint("BOTTOMRIGHT", 0, 2)
        l.edit = button(l, "Edit", 44)
        l.edit:SetPoint("RIGHT", l.delete, "LEFT", -4, 0)
        l.copy = button(l, "Copy", 52)
        l.copy:SetPoint("BOTTOMRIGHT", 0, 2)
        l.copyTo = button(l, "", 128)
        l.copyTo:SetPoint("RIGHT", l.edit, "LEFT", -4, 0)
        l.copyTo:SetScript("OnClick", function(self)
            local entry = Reference:Find(self.key)
            if entry then
                copyTo(entry)
            end
        end)
        l.edit:SetScript("OnClick", function(self)
            local entry = Reference:Find(self.key)
            if entry then
                fill(entry.text, entry.key)
            end
        end)
        l.copy:SetScript("OnClick", function(self)
            local entry = Reference:Find(self.key)
            if entry then
                fill(entry.text, nil)
            end
        end)
        l.delete:SetScript("OnClick", function(self)
            local key = self.key
            local entry = Reference:Find(key)
            if not entry then
                return
            end
            confirm("Delete your %s?", Reference.Label(entry.ref), "Delete", function()
                if editing == key then
                    editing = nil
                end
                Reference:Delete(key)
            end)
        end)
        lines[i] = l
        UI:SkinTree(l) -- so the Modern look skins the new buttons
        return l
    end

    -- Right, under the references: the boss's Journal abilities with their spell IDs.
    local abilitiesLabel = label(f, "")
    abilitiesLabel:SetWidth(280)
    abilitiesLabel:SetJustifyH("LEFT")
    abilitiesLabel:SetWordWrap(false)
    UI.Help(f, "Journal abilities", "The boss's abilities in the Encounter Journal, with their spell IDs. An ability line whose name matches one gets its icon and tooltip, or use Fill spell IDs to write the IDs into the text.\n\nClick or right-click an ability to give it a row on the timeline (even with no cast times, so notes, templates and cooldowns can go on it), a type that colors its row, your own name for it, or a Mech Alert. These are only yours: no ability timeline or note changes.\n\nWhile one of your ability timelines is open in the box (Edit, or the Journal's Send to Timeline), this list is that ability timeline: its abilities under its phases. Right-click an ability to add a phase or an intermission before it, and right-click a phase to set when it starts or take it out; the ability timeline's text follows.\n\nThe Journal's spell for an ability is sometimes a summary spell rather than the exact cast, so its ID may differ from what the damage meter shows.\n\nNothing shows in combat or while the Journal window is open."):SetPoint("LEFT", abilitiesLabel, "RIGHT", -4, 0)
    local abilitiesNone = label(f, "", "CRTFontSmall")
    abilitiesNone:SetWidth(300)
    abilitiesNone:SetJustifyH("LEFT")
    local abilitiesScroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsTimelineAbilitiesScroll", f, "UIPanelScrollFrameTemplate")
    -- the abilities take the middle column from the top down, beside the references (refCount is unused
    -- since the references moved to the right column, kept so the callers stay as they are)
    local function placeAbilities(refCount)
        local top = -8
        abilitiesLabel:ClearAllPoints()
        abilitiesLabel:SetPoint("TOPLEFT", f, "TOPLEFT", LIST_X, top)
        abilitiesNone:ClearAllPoints()
        abilitiesNone:SetPoint("TOPLEFT", f, "TOPLEFT", LIST_X, top - 24)
        abilitiesScroll:ClearAllPoints()
        abilitiesScroll:SetPoint("TOPLEFT", f, "TOPLEFT", LIST_X, top - 22)
        abilitiesScroll:SetPoint("BOTTOMLEFT", f, "BOTTOMLEFT", LIST_X, 8)
        abilitiesScroll:SetWidth(LIST_W - 10)
    end
    placeAbilities(0)
    local abilitiesChild = CreateFrame("Frame", nil, abilitiesScroll)
    abilitiesChild:SetSize(290, 1)
    abilitiesScroll:SetScrollChild(abilitiesChild)
    local abilityLines = {}

    local function abilityLine(i)
        local l = abilityLines[i]
        if l then
            return l
        end
        l = CreateFrame("Button", nil, abilitiesChild)
        l:SetSize(290, ABILITY_H)
        l:RegisterForClicks("LeftButtonUp", "RightButtonUp")
        l:SetHighlightTexture("Interface\\Buttons\\WHITE8X8")
        local hl = l:GetHighlightTexture()
        if hl then
            hl:SetVertexColor(1, 0.82, 0, 0.12)
        end
        l:SetScript("OnClick", function(self)
            abilityMenu(self)
        end)
        l:SetPoint("TOPLEFT", abilitiesChild, "TOPLEFT", 0, -(i - 1) * ABILITY_H)
        l.icon = l:CreateTexture(nil, "ARTWORK")
        l.icon:SetSize(16, 16)
        l.icon:SetPoint("LEFT", 0, 0)
        l.name = label(l, "", "CRTFontSmall")
        l.name:SetPoint("LEFT", 22, 0)
        l.name:SetWidth(200)
        l.name:SetJustifyH("LEFT")
        l.name:SetWordWrap(false)
        l.id = label(l, "", "CRTFontSmall")
        l.id:SetPoint("RIGHT", 0, 0)
        l.id:SetTextColor(0.6, 0.6, 0.6)
        l.tag = label(l, "", "CRTFontSmall")
        l.tag:SetPoint("RIGHT", l.id, "LEFT", -6, 0)
        l.tag:SetTextColor(0.85, 0.7, 0.4)
        abilityLines[i] = l
        return l
    end

    -- Edits the reference open in the box (editing) through its text, one line at a time: yours is
    -- updated; a shipped one is saved as a new one of yours (shipped references can't change). The box,
    -- the list and the Timeline follow.
    local function applyText(text)
        local entry = editing and Reference:Find(editing)
        local ok, errors
        if entry and entry.own then
            ok, errors = Reference:Update(editing, text)
        else
            local key
            key, errors = Reference:Add(text)
            ok = key ~= nil
            editing = key or editing
        end
        if ok then
            fill(text, editing)
            ctx.refresh()
        else
            status:SetText(errors and errors[1] or "")
            status:SetTextColor(1, 0.3, 0.3)
        end
    end

    -- A popup for a phase's start: m:ss or seconds, or empty to leave it for later. onDone(text).
    local PHASE_POPUP = "COWFEERAIDTOOLS_PHASE_START"
    local function askPhaseStart(prompt, current, onDone)
        if not StaticPopupDialogs then
            return
        end
        StaticPopupDialogs[PHASE_POPUP] = StaticPopupDialogs[PHASE_POPUP] or {
            text = "%s",
            button1 = ACCEPT or "Accept",
            button2 = CANCEL or "Cancel",
            hasEditBox = true,
            maxLetters = 12,
            timeout = 0,
            whileDead = true,
            hideOnEscape = true,
            preferredIndex = 3,
            OnShow = function(dialog, data)
                local e = CRT.UI.PopupEditBox(dialog)
                if e then
                    e:SetText(data and data.current or "")
                    e:HighlightText()
                end
            end,
            OnAccept = function(dialog, data)
                local e = CRT.UI.PopupEditBox(dialog)
                if e and data then
                    data.onDone(strtrim(e:GetText() or ""))
                end
            end,
            EditBoxOnEnterPressed = function(e, data)
                local parent = e:GetParent()
                data = data or (parent and parent.data)
                if data then
                    data.onDone(strtrim(e:GetText() or ""))
                end
                StaticPopup_Hide(PHASE_POPUP)
            end,
            EditBoxOnEscapePressed = function()
                StaticPopup_Hide(PHASE_POPUP)
            end,
        }
        StaticPopup_Show(PHASE_POPUP, prompt, nil, { current = current, onDone = onDone })
    end

    -- Puts a phase (or an intermission) before line `before` of the open reference, asking its start.
    local function addPhase(before, intermission)
        local entry = editing and Reference:Find(editing)
        if not entry then
            return
        end
        local label = Reference.NextPhaseLabel(entry.ref, before, intermission)
        local title = intermission and TEXT_MENU.intermissionTitle or nil
        askPhaseStart(string.format(TEXT_MENU.phasePrompt, label), "", function(timeText)
            if timeText ~= "" and not Reference.ParseTime(timeText) then
                status:SetText("Not a time: " .. timeText)
                status:SetTextColor(1, 0.3, 0.3)
                return
            end
            applyText(Reference.InsertLine(entry.text, before, Reference.PhaseLine(label, timeText, title)))
        end)
    end

    -- The menu on a phase heading of the open reference: its start time, or take it out.
    local function phaseMenu(l)
        local p, entry = l.phase, editing and Reference:Find(editing)
        if not (p and p.line and entry and MenuUtil and MenuUtil.CreateContextMenu) then
            return
        end
        MenuUtil.CreateContextMenu(l, function(_, root)
            root:CreateTitle(p.title or p.label or "")
            root:CreateButton(TEXT_MENU.setStart, function()
                askPhaseStart(string.format(TEXT_MENU.phasePrompt, p.title or p.label or ""), p.t and View.Format(p.t) or "", function(timeText)
                    if timeText ~= "" and not Reference.ParseTime(timeText) then
                        status:SetText("Not a time: " .. timeText)
                        status:SetTextColor(1, 0.3, 0.3)
                        return
                    end
                    applyText(Reference.ReplaceLine(entry.text, p.line, Reference.PhaseLine(p.label or "P2", timeText, p.title)))
                end)
            end)
            root:CreateButton(TEXT_MENU.removePhase, function()
                applyText(Reference.ReplaceLine(entry.text, p.line, nil))
            end)
        end)
    end

    -- The menu on an ability (left or right click). With its spell: your own labels for it
    -- (Timeline:SetAbility) and Make a Mech Alert, which opens the Mech Alerts tab on it. On a row of the
    -- open reference: also Add phase here and Add intermission here, put just before it.
    abilityMenu = function(l)
        if l.phase then
            phaseMenu(l)
            return
        end
        local boss, row = l.boss, l.row
        if not (row and MenuUtil and MenuUtil.CreateContextMenu) then
            return
        end
        MenuUtil.CreateContextMenu(l, function(_, root)
            AbilityMenu.Fill(root, boss, row, row.name)
            if l.refRow and row.line then
                root:CreateDivider()
                root:CreateButton(TEXT_MENU.addPhase, function()
                    addPhase(row.line, false)
                end)
                root:CreateButton(TEXT_MENU.addIntermission, function()
                    addPhase(row.line, true)
                end)
            end
        end)
    end

    -- One line of the list: an ability (its icon, name in its type's color, a tag, its spell ID), or on
    -- the open reference a phase heading (gold, its start or "no start yet").
    local function showAbility(l, id, row, refRow)
        local Timeline = CRT.Timeline
        l.boss, l.row, l.refRow, l.phase = id, row, refRow, nil
        local spellID = row.spellID ~= 0 and row.spellID or nil
        local a = spellID and Timeline.Ability and Timeline:Ability(id, spellID) or nil
        local typeKey = (a and a.type) or (row.types and row.types[1])
        local t = typeKey and Reference.TYPES[typeKey]
        l.icon:SetTexture(row.icon or 134400)
        l.icon:Show()
        l.name:SetPoint("LEFT", 22, 0)
        l.name:SetText((a and a.name) or row.name or "")
        if t then
            l.name:SetTextColor(t.color[1], t.color[2], t.color[3])
        else
            l.name:SetTextColor(1, 1, 1)
        end
        local tag = a and a.row and TEXT_ROW or ""
        if refRow and #(row.casts or {}) == 0 then
            tag = TEXT_MENU.noTimes
        end
        if Timeline.DevMode() and Timeline:Hidden(id, row.name) then
            tag = TEXT_MENU.hidden
        end
        l.tag:SetText(tag)
        l.id:SetText(spellID and tostring(spellID) or "")
        l:Show()
    end

    local function showPhase(l, p)
        l.boss, l.row, l.refRow, l.phase = nil, nil, nil, p
        l.icon:Hide()
        l.name:SetPoint("LEFT", 0, 0)
        l.name:SetText(p.title or p.label or "") -- "Intermission: Ritual of Awakening", not its number
        l.name:SetTextColor(1, 0.82, 0)
        l.tag:SetText("")
        l.id:SetText(p.pull and "" or (p.t and View.Format(p.t) or TEXT_MENU.noStart))
        l:Show()
    end

    local abilitiesFor -- the encounter ID the list was last filled for, so typing doesn't refill it
    refreshAbilities = function()
        local id, name = journalBoss()
        abilitiesFor = id
        local rows = id and Journal:Rows(id) or {}
        local entry = editing and Reference:Find(editing)
        local n = 0
        if entry then
            -- the open reference: its abilities under its phases, in the order they are written
            abilitiesLabel:SetText(TEXT_MENU.refHeading .. (entry.ref.boss and (": " .. entry.ref.boss) or ""))
            local items = {}
            for _, p in ipairs(entry.ref.phases or {}) do
                items[#items + 1] = { line = p.line or 0, phase = p }
            end
            for _, p in ipairs(entry.ref.pending or {}) do
                items[#items + 1] = { line = p.line or 0, phase = p }
            end
            for _, r in ipairs(entry.ref.rows or {}) do
                items[#items + 1] = { line = r.line or 0, row = r }
            end
            table.sort(items, function(x, y)
                return x.line < y.line
            end)
            n = n + 1
            showPhase(abilityLine(n), { label = TEXT_MENU.pullPhase, pull = true })
            local byID = {}
            for _, r in ipairs(rows) do
                byID[r.spellID] = r
            end
            local Lanes = CRT.TimelineLanes
            for _, it in ipairs(items) do
                n = n + 1
                if it.phase then
                    showPhase(abilityLine(n), it.phase)
                else
                    local r = it.row
                    local spellID = Lanes and Lanes.RowSpell(r, id, rows) or r.spellID or 0
                    local j = byID[spellID]
                    showAbility(abilityLine(n), id, {
                        name = r.name, spellID = spellID, types = r.types, tags = r.tags or (j and j.tags),
                        icon = j and j.icon, casts = r.casts, line = r.line,
                    }, true)
                end
            end
        else
            abilitiesLabel:SetText("Journal abilities" .. (name and (": " .. name) or ""))
            for _, row in ipairs(rows) do
                n = n + 1
                showAbility(abilityLine(n), id, row, false)
            end
        end
        for i = n + 1, #abilityLines do
            abilityLines[i]:Hide()
        end
        abilitiesChild:SetHeight(math.max(1, n * ABILITY_H))
        abilitiesNone:SetText(name and "No Journal abilities found" or "No boss picked")
        abilitiesNone:SetShown(n == 0)
    end
    edit:SetScript("OnTextChanged", function()
        local id = journalBoss()
        if id ~= abilitiesFor then
            refreshAbilities()
        end
    end)

    -- Puts text in the box: as a new reference (Save adds it), or as your reference key when given (the
    -- Journal's Send to Timeline saves first, then opens it here).
    function tab:Fill(text, key)
        fill(text or "", key)
    end

    function tab:Refresh()
        refreshAbilities()
        local boss = ctx.selectedBoss()
        listLabel:SetText(boss and ("Ability timelines for " .. (ctx.bossName() or tostring(boss)) .. " (" .. GROUP_NAMES[ctx.difficulty()] .. ")") or "Pick a boss on the Review tab")
        local refs = boss and ctx.references() or {}
        -- a reference that is no longer in this list (another difficulty or boss) is not edited any more:
        -- Save then adds a new one and the box keeps its text
        if editing then
            local listed = false
            for _, entry in ipairs(refs) do
                listed = listed or entry.key == editing
            end
            if not listed then
                editing = nil
            end
        end
        for i, entry in ipairs(refs) do
            local l = line(i)
            l.name:SetText(Reference.Label(entry.ref))
            l.kind:SetText(entry.own and "yours" or "shipped")
            l.edit.key, l.delete.key, l.copy.key = entry.key, entry.key, entry.key
            l.edit:SetShown(entry.own)
            l.delete:SetShown(entry.own)
            l.copy:SetShown(not entry.own)
            l.copyTo.key = entry.key
            l.copyTo:SetText("Copy to " .. GROUP_NAMES[OTHER_GROUP[ctx.difficulty()]])
            l.copyTo:ClearAllPoints()
            l.copyTo:SetPoint("RIGHT", entry.own and l.edit or l.copy, "LEFT", -4, 0)
            l.copyTo:Show()
            l:Show()
        end
        for i = #refs + 1, #lines do
            lines[i]:Hide()
            lines[i].edit:Hide()
            lines[i].delete:Hide()
            lines[i].copy:Hide()
            lines[i].copyTo:Hide()
        end
        empty:SetShown(boss ~= nil and #refs == 0)
        placeAbilities(#refs)
        showMode()
    end

    f:SetScript("OnShow", function()
        ctx.refresh()
    end)
    return tab
end
