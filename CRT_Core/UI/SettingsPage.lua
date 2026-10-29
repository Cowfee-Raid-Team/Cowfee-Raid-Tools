local ADDON, CRT = ...

-- The General Settings page: settings for the whole addon, on three tabs (the last one is remembered in
-- CRTDB.ui.settingsTab).
--   Appearance  three columns. Left: Window (the main window's scale and opacity, UI:ApplyStyle in
--               UI/Panel.lua; the look is the title bar's UI button) and Text (the font, outline and
--               size of every text the addon draws with its shared fonts, CRT:ApplyFonts in Core.lua).
--               Middle: Sound, Reports, the Minimap button and Tooltips (where tooltips open, with the spot
--               picker under the dropdown: UI.TooltipPositionSetting in UI/Tooltip.lua). Right: Layers (which frame strata each
--               group of windows is drawn in, UI:SetLayer in UI/Panel.lua) and Team raids (tonight's team,
--               Push to raid and Remove team: buildTeam, on Team.lua and TeamList.lua)
--   Profiles    Profiles.lua: switch, create, copy, delete and reset profiles; Export (the whole profile),
--               Export settings only (for raiders), Import (either kind, with a preview) and Undo last import
--   Addon check AddonCheck.lua: who in the group runs CRT, which version and which optional modules they have
--               on, one row per member with a cell per registered module; Module and Show filters, Check
--               (buildAddonCheck). Opening the tab asks the group when the last ask is stale.
-- Named Addon Settings before 0.16.0. Its key is still "settings".

local UI = CRT.UI
local Profiles = CRT.Profiles

-- The columns of the Appearance tab, a third of the page each (UI.PAGE_W): a slider row is LABEL_W + 5
-- + CONTROL_W plus its value, about 330, and a dropdown row about 285.
local COL_W = math.floor(UI.PAGE_W / 3)
local LEFT_X, MIDDLE_X, RIGHT_X = 10, 10 + COL_W, 10 + 2 * COL_W
local LABEL_W = 120
local CONTROL_W = 160
local CHECK_TEXT_W = COL_W - 40 -- a checkbox's text wraps at this width, inside its column

-- The profile text window: its size, how many differences the import preview lists, and the height
-- kept under the text box for the preview and the row under it.
local TEXT_W, TEXT_H = 560, 440
local PREVIEW_LINES = 6
local PREVIEW_H = 118 -- room for its first line, PREVIEW_LINES differences, "and N more" and the skipped count
local IMPORT_BOTTOM = 76 + PREVIEW_H -- the text box's bottom edge when importing
local EXPORT_BOTTOM = 76 -- and when exporting, over the copy hint (two lines when values were left out)
local KEEP_TOP = 66 -- Keep my window positions' top edge, from the window's bottom

local TEXT = {
    export = "Export",
    import = "Import",
    reset = "Reset profile",
    newName = "New profile name",
    exportSettings = "Export settings only",
    droppedOne = "1 saved setting had a wrong value and is left out.",
    dropped = "%d saved settings had a wrong value and are left out.",
    undo = "Undo last import",
    selectAll = "Select all",
    keep = "Keep my window positions",
    exportTitle = "Export profile: %s",
    exportSettingsTitle = "Export settings only: %s",
    importTitle = "Import (paste the text below)",
    copyFull = "Ctrl+C to copy. The whole profile: settings, layouts, notes and history.",
    copySettings = "Ctrl+C to copy. Settings and window positions only.",
    full = "A whole profile with %d parts: settings, layouts, notes and history. Import saves it as a new profile.",
    differOne = "From %s, 1 setting differs from yours:",
    differ = "From %s, %d settings differ from yours:",
    more = "and %d more",
    same = "From %s: your settings already match.",
    skipped = "%d unknown settings are skipped.",
    confirmImport = "Import the settings from %s onto this profile?\n\nYour current settings are saved first, so Undo last import can put them back. Your interface reloads.",
    acceptImport = "Import and reload",
    confirmUndo = "Put back the settings you had before importing from %s?\n\nYour interface reloads.",
    acceptUndo = "Undo and reload",
    teamTitle = "Team raids",
    teamTonight = "Tonight's team",
    teamPush = "Push to raid",
    teamRemove = "Remove team",
    teamMerge = "Merge team\226\128\166",
    teamLocked = "Set by %s (raid leader). You can change or remove it after you leave the group.",
    -- the game's lock icon (Blizzard_GroupFinder's LFGFrame.xml uses this file), inline before the line
    teamLockIcon = "|TInterface\\LFGFrame\\UI-LFG-ICON-LOCK:14:14|t ",
    teamHelp = "Pick which team tonight's raid is: Pug, or one of your teams. Season Stats keeps each team's pulls apart, and Tattlebot and the Late Tracker can record team raids only: any team but Pug. Add team at the bottom of the list adds your own. A new raid group starts on the team you had last.\n\nWhen you join a new raid group, CRT asks which team it is. The raid leader can push the team to everyone in the raid with CRT, with Push to raid or the popup's Save and push. Raiders can't change it then until they leave the group.\n\nRemove team deletes one of your teams and its Season Stats, after two warnings. Pug can't be removed.\n\nMerge team moves one of your teams' Season Stats, Tattlebot pulls and raid nights into another team or Pug, and takes it off your list. Before teams, the pulls from before you had teams of your own, can be merged into one of your teams the same way. Names that differ only in case, spaces or punctuation are one team; when two such teams are saved, CRT asks once whether to merge them.\n\nParties, solo play and finder groups are never team raids.",
    help = "A profile holds everything the addon saves: settings, window positions, layouts, notes, consumables lists and history. Each character remembers its own; new characters start on the one under New characters. Switching, copying or resetting a profile reloads your interface.\n\nExport gives the whole profile as text, for your own characters: Import saves it as a new profile.\n\nExport settings only gives just settings and window positions, for raiders (where your reports go, whose notes and loot leaders you trust and your own sound files stay yours): Import shows what differs and applies it to this profile, after saving your settings for Undo last import. Keep my window positions keeps where your windows are and the size of your note windows.",
}

local page
local controls = {}

-- Text size in points, for the body text: 8 to 22 pt.
local TEXT_SIZES = {}
for pt = 8, 22 do
    TEXT_SIZES[#TEXT_SIZES + 1] = { key = pt, label = pt .. " pt" }
end

local OUTLINES = {
    { key = "", label = "None" },
    { key = "OUTLINE", label = "Outline" },
    { key = "THICKOUTLINE", label = "Thick outline" },
}

local function ui()
    return CRT.db.ui
end

local function percent(v)
    return v .. "%"
end

local function heading(pf, x, y, text, help)
    local fs = pf:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    fs:SetPoint("TOPLEFT", x - 2, y)
    fs:SetText(text)
    if help then
        UI.HelpRight(fs, text, help)
    end
    return fs
end

local function add(row, x, y)
    row:SetPoint("TOPLEFT", x, y)
    controls[#controls + 1] = row
    return row
end

-- Without a width, the button is as wide as its label (UI.PanelButtonWidth).
local function button(pf, text, width)
    local b = CreateFrame("Button", nil, pf, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontButtonSmall)
    b:SetHighlightFontObject(CRTFontButtonSmallHighlight)
    b:SetDisabledFontObject(CRTFontButtonSmallDisable)
    b:SetText(text)
    if not width then
        local fs = b:GetFontString()
        width = UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0)
    end
    b:SetSize(width, 20)
    return b
end

local function checkbox(pf, x, y, text, get, set)
    local cb = CreateFrame("CheckButton", nil, pf, "UICheckButtonTemplate")
    cb:SetSize(24, 24)
    cb:SetPoint("TOPLEFT", x - 4, y)
    local label = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    label:SetPoint("LEFT", cb, "RIGHT", 2, 0)
    label:SetWidth(CHECK_TEXT_W)
    label:SetJustifyH("LEFT")
    label:SetText(text)
    cb:SetScript("OnClick", function(self)
        set(self:GetChecked() and true or false)
    end)
    cb.refresh = function()
        cb:SetChecked(get() and true or false)
    end
    cb.label = label
    controls[#controls + 1] = cb
    return cb
end

local function refresh()
    if not page or not page:IsShown() then
        return
    end
    for _, control in ipairs(controls) do
        control.refresh()
    end
end

-- Read each time the menu opens, so fonts other addons share through LibSharedMedia appear.
local function fontChoices()
    local out = { { key = "default", label = "Default" } }
    for _, font in ipairs(CRT:FontList()) do
        out[#out + 1] = { key = font.name, label = font.name }
    end
    return out
end

local function fontLabel(key)
    return key == "default" and "Default" or key
end

-- Asks in the game's own confirmation box, then runs accept. The box is lifted over the profile text
-- window, which may be on a high layer.
local function confirm(text, arg, acceptText, accept)
    local ret = StaticPopup_ShowCustomGenericConfirmation({
        text = text,
        text_arg1 = arg,
        acceptText = acceptText,
        cancelText = CANCEL,
        showAlert = true,
        callback = accept,
    })
    UI.LiftOver(UI.ShownPopup(ret, "GENERIC_CONFIRMATION"))
end

-- The font changes every text in the addon, so it asks first.
local function confirmFont(key)
    if key == ui().font then
        return
    end
    confirm("Changing this changes all other fonts in this addon, the note windows included.\n\nUse %s for everything?", fontLabel(key), "Change all fonts", function()
        CRT:SetAddonFont(key)
        refresh()
    end)
end

-- Profile export and import: one window with a text box. Exporting, the box is read-only, with Select
-- all and a copy hint. Importing, what was pasted is read as it changes (Profiles:Read, which changes
-- nothing) and a preview shows under the box: red text for a bad string, a summary and a name box for a
-- whole profile, or what differs and Keep my window positions for a settings string. ---------------

local textDialog

local function previewLines(info, keep)
    local diff = Profiles:Diff(info, keep)
    local lines = {}
    if #diff == 0 then
        lines[1] = TEXT.same:format(info.from)
    else
        lines[1] = #diff == 1 and TEXT.differOne:format(info.from) or TEXT.differ:format(info.from, #diff)
        for i = 1, math.min(#diff, PREVIEW_LINES) do
            lines[#lines + 1] = "  " .. diff[i].text
        end
        if #diff > PREVIEW_LINES then
            lines[#lines + 1] = TEXT.more:format(#diff - PREVIEW_LINES)
        end
    end
    if info.unknown > 0 then
        lines[#lines + 1] = TEXT.skipped:format(info.unknown)
    end
    return table.concat(lines, "\n"), #diff > 0
end

-- Reads the pasted text and shows what an import would do.
local function updatePreview(d)
    local text = d.edit:GetText() or ""
    local info, err
    if strtrim(text) ~= "" then
        info, err = Profiles:Read(text)
    end
    d.state.info = info
    local preview, canImport = "", false
    if err then
        preview = UI.BadText(err)
    elseif info and info.kind == "full" then
        preview, canImport = TEXT.full:format(info.parts), true
    elseif info then
        preview, canImport = previewLines(info, d.state.keep)
    end
    d.preview:SetText(preview)
    local full = info and info.kind == "full" or false
    d.nameLabel:SetShown(full)
    d.name:SetShown(full)
    local settings = info and info.kind == "settings" or false
    d.keep:SetShown(settings)
    d.keep.label:SetShown(settings)
    d.ok:SetEnabled(canImport)
end

local function importClicked(d)
    local info = d.state.info
    if not info then
        return
    end
    if info.kind == "full" then
        local ok, message = Profiles:Import(d.edit:GetText(), d.name:GetText())
        if ok then
            CRT:Print("Imported the profile " .. strtrim(d.name:GetText()) .. ". Pick it under Use profile to switch to it.")
            d:Hide()
            refresh()
        else
            CRT:Print(message)
        end
        return
    end
    local keep = d.state.keep and true or false
    confirm(TEXT.confirmImport, info.from, TEXT.acceptImport, function()
        Profiles:ApplySettings(info, keep)
    end)
end

local function buildTextBox(d)
    d.scroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsProfileTextScroll", d, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(d.scroll.ScrollBar)
    d.scroll:SetPoint("TOPLEFT", 14, -34)
    d.edit = CreateFrame("EditBox", nil, d.scroll)
    d.edit:SetMultiLine(true)
    d.edit:SetAutoFocus(false)
    d.edit:SetFontObject(CRTFontEdit)
    d.edit:SetWidth(TEXT_W - 60)
    d.edit:SetScript("OnEscapePressed", function()
        d:Hide()
    end)
    -- Exporting, typing is undone, so the string can only be copied.
    d.edit:SetScript("OnTextChanged", function(self, userInput)
        if d.state.mode == "import" then
            updatePreview(d)
        elseif userInput and d.state.exportText then
            self:SetText(d.state.exportText)
            self:HighlightText()
        end
    end)
    d.scroll:SetScrollChild(d.edit)

    d.hint = d:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    d.hint:SetPoint("BOTTOMLEFT", 16, 44)
    d.hint:SetPoint("BOTTOMRIGHT", -16, 44)
    d.hint:SetJustifyH("LEFT")

    d.preview = d:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    d.preview:SetPoint("TOPLEFT", d, "BOTTOMLEFT", 16, IMPORT_BOTTOM - 4)
    d.preview:SetSize(TEXT_W - 32, PREVIEW_H)
    d.preview:SetJustifyH("LEFT")
    d.preview:SetJustifyV("TOP")
end

-- The row over the buttons (the new profile's name for a whole profile, or Keep my window positions),
-- then the buttons.
local function buildTextControls(d)
    d.nameLabel = d:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    d.nameLabel:SetPoint("BOTTOMLEFT", 16, 48)
    d.nameLabel:SetText(TEXT.newName)
    d.name = CreateFrame("EditBox", nil, d, "InputBoxTemplate")
    d.name:SetSize(200, 20)
    d.name:SetPoint("LEFT", d.nameLabel, "RIGHT", 12, 0)
    d.name:SetAutoFocus(false)
    d.name:SetFontObject(CRTFontEdit)
    d.keep = checkbox(d, 16, -(TEXT_H - KEEP_TOP), TEXT.keep, function()
        return d.state.keep
    end, function(on)
        d.state.keep = on
        updatePreview(d)
    end)

    d.ok = button(d, TEXT.import, 110)
    d.ok:SetHeight(24)
    d.ok:SetPoint("BOTTOM", -60, 12)
    d.ok:SetScript("OnClick", function()
        importClicked(d)
    end)
    d.selectAll = button(d, TEXT.selectAll, 110)
    d.selectAll:SetHeight(24)
    d.selectAll:SetPoint("BOTTOM", -60, 12)
    d.selectAll:SetScript("OnClick", function()
        d.edit:SetFocus()
        d.edit:HighlightText()
    end)
    d.close = button(d, CLOSE, 110)
    d.close:SetHeight(24)
    d.close:SetPoint("BOTTOM", 60, 12)
    d.close:SetScript("OnClick", function()
        d:Hide()
    end)
end

local function getTextDialog()
    if textDialog then
        return textDialog
    end
    -- the shared window helper: a pop-up layer, dragged by its title, closed by Escape, opened centred
    local d = UI.Window("CowfeeRaidToolsProfileText", { kind = "dialog", width = TEXT_W, height = TEXT_H })
    -- mode ("export" or "import"), exportText (what the read-only box holds), info (what Profiles:Read
    -- gave), keep (Keep my window positions)
    d.state = {}
    buildTextBox(d)
    buildTextControls(d)
    d:Hide()
    textDialog = d
    return d
end

-- Puts the window in "export" or "import" mode: which parts show, and where the text box ends.
local function setMode(d, mode)
    d.state.mode = mode
    local import = mode == "import"
    d.scroll:SetPoint("BOTTOMRIGHT", -34, import and IMPORT_BOTTOM or EXPORT_BOTTOM)
    d.hint:SetShown(not import)
    d.preview:SetShown(import)
    d.preview:SetText("")
    d.nameLabel:Hide()
    d.name:Hide()
    d.state.keep = false
    d.keep:Hide()
    d.keep.label:Hide()
    d.keep.refresh()
    d.ok:SetShown(import)
    d.selectAll:SetShown(not import)
    d.state.info = nil
end

local function showExportText(title, text, hint)
    local d = getTextDialog()
    setMode(d, "export")
    d.strip:SetTitle(title)
    d.hint:SetText(hint)
    d.state.exportText = text
    d.edit:SetText(text)
    d:Show()
    d.edit:SetFocus()
    d.edit:HighlightText()
end

local function showExport()
    local text, err = Profiles:Export()
    if not text then
        CRT:Print(err)
        return
    end
    showExportText(TEXT.exportTitle:format(Profiles:Current()), text, TEXT.copyFull)
end

local function showExportSettings()
    local text, dropped = Profiles:ExportSettings()
    if not text then
        CRT:Print(dropped)
        return
    end
    local hint = TEXT.copySettings
    if dropped > 0 then
        hint = hint .. " " .. UI.WarnText(dropped == 1 and TEXT.droppedOne or TEXT.dropped:format(dropped))
    end
    showExportText(TEXT.exportSettingsTitle:format(Profiles:Current()), text, hint)
end

local function showImport()
    local d = getTextDialog()
    d.state.exportText = nil
    setMode(d, "import")
    d.strip:SetTitle(TEXT.importTitle)
    d.name:SetText("")
    d.edit:SetText("")
    d.ok:SetEnabled(false)
    d:Show()
    d.edit:SetFocus()
end

-- The columns. -----------------------------------------------------------------------------------

local function buildLeft(pf)
    local x = LEFT_X

    heading(pf, x, -44, "Window", "The theme button in the title bar picks the look. Window Scale applies when you let go or press Enter (Ctrl + mouse wheel over the window works too). Background opacity is how solid every window's background is: 100% is solid, lower lets the game show through, down to 30%. Text and buttons never fade. The raider loot popup always stays solid.")
    add(UI.Slider(pf, "Window scale", {
        min = UI.MIN_SCALE,
        max = UI.MAX_SCALE,
        step = 5,
        labelWidth = LABEL_W,
        width = CONTROL_W,
        format = percent,
        onRelease = true,
        get = function()
            return UI:Scale()
        end,
        set = function(v)
            UI:SetScale(v)
        end,
    }), x, -62)
    local resetScale = button(pf, "Reset scale to 100%", 140)
    resetScale:SetPoint("TOPLEFT", x + LABEL_W + 5, -96)
    resetScale:SetScript("OnClick", function()
        UI:SetScale(100)
    end)
    -- every window's background, live (UI:ApplyOpacity)
    add(UI.Slider(pf, "Background opacity", {
        min = UI.MIN_OPACITY,
        max = UI.MAX_OPACITY,
        step = 5,
        labelWidth = LABEL_W,
        width = CONTROL_W,
        format = percent,
        get = function()
            return math.floor(UI:Opacity() * 100 + 0.5)
        end,
        set = function(v)
            ui().bgAlpha = v
            UI:ApplyOpacity()
        end,
    }), x, -120)

    heading(pf, x, -164, "Text", "The font, outline and size of the addon's text, note windows included. Default is the game's font in Default: Blizzard and Arial Narrow in the other themes; fonts shared by other addons are listed too. Text size is the body size (8 to 22 pt); headings and small text follow it. Note windows keep their own size and can get their own font on Raid Notes.")
    add(UI.Dropdown(pf, "Font", {
        options = fontChoices,
        labelWidth = LABEL_W,
        width = CONTROL_W,
        get = function()
            return ui().font
        end,
        set = confirmFont,
    }), x, -182)
    local warning = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    warning:SetPoint("TOPLEFT", x + LABEL_W + 5, -212)
    warning:SetWidth(CONTROL_W + 40)
    warning:SetJustifyH("LEFT")
    warning:SetTextColor(1, 0.55, 0.1)
    warning:SetWordWrap(false)
    warning:SetText("Changes all addon fonts.")
    add(UI.Dropdown(pf, "Outline", {
        options = OUTLINES,
        labelWidth = LABEL_W,
        width = CONTROL_W,
        get = function()
            return ui().outline
        end,
        set = function(key)
            ui().outline = key
            CRT:ApplyFonts()
            refresh()
        end,
    }), x, -226)
    add(UI.Dropdown(pf, "Text size", {
        options = TEXT_SIZES,
        labelWidth = LABEL_W,
        width = CONTROL_W,
        get = function()
            return ui().fontSize
        end,
        set = function(pt)
            ui().fontSize = pt
            CRT:ApplyFonts()
            refresh()
        end,
    }), x, -258)

    x = MIDDLE_X
    heading(pf, x, -44, "Sound", "Every sound the addon plays uses this game sound channel and follows its volume and mute. The low-health pulse and text to speech have their own volume, on Quality of Life and Raid Notes.")
    add(UI.Dropdown(pf, "Sound channel", {
        options = CRT.SOUND_CHANNELS,
        labelWidth = LABEL_W,
        width = CONTROL_W,
        get = function()
            return ui().soundChannel or "Master"
        end,
        set = function(key)
            ui().soundChannel = key
            refresh()
        end,
    }), x, -62)

    heading(pf, x, -106, "Reports", "Ticked, player names in the Late Tracker and Tattlebot show without their realm, in chat and exports too. Unticked, a realm shows only for players from another realm. The Raid Groups grid always keeps realms.")
    checkbox(pf, x, -124, "Leave realm names out of reports and Discord exports", function()
        return ui().hideRealms
    end, function(on)
        ui().hideRealms = on
    end)

    heading(pf, x, -184, "Minimap", "Left-click the minimap button to open or close this window, right-click it for General Settings, and drag it to move it. The addon is also in the game's addon menu by the minimap, with the button hidden.")
    checkbox(pf, x, -202, "Show the minimap button", function()
        return not CRT.db.minimap.hide
    end, function(on)
        CRT.MinimapButton:SetHidden(not on)
    end)

    heading(pf, x, -246, "Tooltips", "Where the addon's tooltips open. Outside the window: just past the edge of the window you are in, such as the main window or a pop-out, on the spot you click in the box below. Game's tooltip spot: where the game shows its own tooltips, or wherever your UI addon moved them. Follow the cursor: at your mouse.\n\nClicking a spot also picks Outside the window. With no spot lit, each tooltip opens on its own side, beside the button, row or icon under your mouse; click the lit spot again to go back to that. Something outside the addon's windows, such as the minimap button, opens its tooltip beside itself.\n\nLoot History, Loot Master and the Timeline have their own Tooltip position on their Settings tabs, and the debuff panel on Quality of Life > Debuffs. It follows this one until you change it there.\n\nThe button on the Encounter Journal always keeps its tooltip by it.")
    -- the dropdown, and its spot picker under it (UI/Tooltip.lua)
    local tooltips = UI.TooltipPositionSetting(pf, nil, { labelWidth = LABEL_W, width = CONTROL_W })
    tooltips.row:SetPoint("TOPLEFT", x, -264)
    controls[#controls + 1] = tooltips
end

-- Team raids (Team.lua, TeamList.lua): Tonight's team (Pug, your teams, Add team…), Push to raid (the raid
-- leader), Remove team (your own teams, two warnings: UI/TeamDialogs.lua), Merge team… (one of your teams into
-- another or Pug, Before teams into one of yours: UI/TeamDialogs.lua's merge mode), the lock line while the raid
-- leader's push holds the pick, and the status line.
local function buildTeam(pf, x, top)
    local Team = CRT.Team
    heading(pf, x, top, TEXT.teamTitle, TEXT.teamHelp)
    local unlocked = function()
        return not Team:IsLocked()
    end
    add(UI.Dropdown(pf, TEXT.teamTonight, {
        labelWidth = LABEL_W,
        width = CONTROL_W,
        options = function()
            return Team:Options()
        end,
        enabledIf = unlocked,
        get = function()
            return Team:Tonight()
        end,
        set = function(key)
            if key == Team.ADD_KEY then
                CRT.TeamDialogs.AskName(function(name)
                    Team:SetTonight(name)
                    refresh()
                end)
                return
            end
            Team:SetTonight(key)
            refresh()
        end,
    }), x, top - 18)
    local push = button(pf, TEXT.teamPush)
    push:SetPoint("TOPLEFT", x, top - 54)
    push:SetScript("OnClick", function()
        Team:Push()
        refresh()
    end)
    push.refresh = function()
        push:SetEnabled(Team.CanPush())
    end
    controls[#controls + 1] = push
    local remove = button(pf, TEXT.teamRemove)
    remove:SetPoint("LEFT", push, "RIGHT", 6, 0)
    remove:SetScript("OnClick", function()
        CRT.TeamDialogs.AskRemove(Team:Tonight(), refresh)
    end)
    remove.refresh = function()
        remove:SetEnabled(Team:CanRemove(Team:Tonight()))
    end
    controls[#controls + 1] = remove
    -- Merge team…: greyed while a push locks the pick (as Remove) and with fewer than two teams to merge from
    local merge = button(pf, TEXT.teamMerge)
    merge:SetPoint("LEFT", remove, "RIGHT", 6, 0)
    merge:SetScript("OnClick", function()
        CRT.TeamDialogs.AskMerge(Team:Tonight(), nil, refresh)
    end)
    merge.refresh = function()
        merge:SetEnabled(not Team:IsLocked() and #Team:MergeSources() >= 2)
    end
    controls[#controls + 1] = merge
    local status = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    status:SetPoint("TOPLEFT", x, top - 82)
    status:SetWidth(COL_W - 20)
    status:SetJustifyH("LEFT")
    status.refresh = function()
        status:SetText(Team.StatusLine())
    end
    controls[#controls + 1] = status
    -- while the raid leader's push holds it: who set it, with a lock
    local lock = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    lock:SetPoint("TOPLEFT", x, top - 100)
    lock:SetWidth(COL_W - 20)
    lock:SetJustifyH("LEFT")
    lock.refresh = function()
        local by = Team:LockedBy()
        lock:SetText(by and (TEXT.teamLockIcon .. TEXT.teamLocked:format(by)) or "")
        lock:SetShown(by ~= nil)
    end
    controls[#controls + 1] = lock
end

local function buildRight(pf)
    local x = RIGHT_X

    heading(pf, x, -44, "Layers", "Which layer each group of windows is drawn in, from Background (under everything) to Tooltip (over everything); a higher layer covers a lower one, the game's windows included.\n\nAlerts: the note callout, alert bars, icons, critical alerts text, circles, the alert timeline and the low-health banner. Raid windows: the ready check window, your consumables bar and the debuff panel. Pop-up windows: text to copy, imports and the Late Tracker roster.\n\nMixed means the group's windows differ; picking one puts them all in it.")
    for i, group in ipairs(UI.LAYER_GROUPS) do
        add(UI.Dropdown(pf, group.label, {
            options = function()
                local list = UI:GroupLayerChoices(group)
                if UI:GroupLayer(group) == "mixed" then
                    local withMixed = { { key = "mixed", label = "Mixed", disabled = true } }
                    for _, s in ipairs(list) do
                        withMixed[#withMixed + 1] = s
                    end
                    return withMixed
                end
                return list
            end,
            labelWidth = LABEL_W + 10,
            width = CONTROL_W - 20,
            get = function()
                return UI:GroupLayer(group)
            end,
            set = function(key)
                UI:SetGroupLayer(group, key)
                refresh()
            end,
        }), x, -62 - (i - 1) * 30)
    end
    local lastLayer = -62 - #UI.LAYER_GROUPS * 30
    local resetLayers = button(pf, "Default layers", 130)
    resetLayers:SetPoint("TOPLEFT", x, lastLayer - 4)
    resetLayers:SetScript("OnClick", function()
        for _, layer in ipairs(UI.LAYERS) do
            UI:SetLayer(layer.key, layer.default)
        end
        refresh()
    end)

    buildTeam(pf, x, lastLayer - 52)
end

local function buildProfiles(pf)
    local x, top = LEFT_X, -44
    heading(pf, x, top, "Profiles", TEXT.help)

    local current = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    current:SetPoint("TOPLEFT", x, top - 22)
    current.refresh = function()
        current:SetText("Current profile: " .. UI.HeadingText(Profiles:Current()))
    end
    controls[#controls + 1] = current

    add(UI.Dropdown(pf, "Use profile", {
        options = function()
            return Profiles:All()
        end,
        labelWidth = LABEL_W,
        width = CONTROL_W,
        get = function()
            return Profiles:Current()
        end,
        set = function(name)
            if name == Profiles:Current() then
                return
            end
            confirm("Switch this character to the profile %s?\n\nYour interface reloads.", name, "Switch and reload", function()
                Profiles:Switch(name)
            end)
        end,
    }), x, top - 36)

    local newLabel = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    newLabel:SetPoint("TOPLEFT", x, top - 78)
    newLabel:SetWidth(LABEL_W)
    newLabel:SetJustifyH("LEFT")
    newLabel:SetText("New profile")
    local newName = CreateFrame("EditBox", nil, pf, "InputBoxTemplate")
    newName:SetSize(CONTROL_W - 64, 20)
    newName:SetPoint("LEFT", newLabel, "RIGHT", 10, 0)
    newName:SetAutoFocus(false)
    newName:SetFontObject(CRTFontEdit)
    newName:SetMaxLetters(32)
    local create = button(pf, "Create", 60)
    create:SetPoint("LEFT", newName, "RIGHT", 4, 0)
    local function createProfile()
        local name = strtrim(newName:GetText() or "")
        if name == "" then
            CRT:Print("Type a name for the new profile first.")
            return
        end
        if Profiles:Exists(name) then
            CRT:Print("A profile named " .. name .. " already exists.")
            return
        end
        newName:ClearFocus()
        confirm("Create the profile %s, starting from the defaults, and switch this character to it?\n\nYour interface reloads.", name, "Create and reload", function()
            Profiles:Switch(name)
        end)
    end
    create:SetScript("OnClick", createProfile)
    newName:SetScript("OnEnterPressed", createProfile)
    newName:SetScript("OnEscapePressed", newName.ClearFocus)

    local hasOthers = function()
        return #Profiles:Others() > 0
    end
    add(UI.Dropdown(pf, "Copy from", {
        options = function()
            return Profiles:Others()
        end,
        labelWidth = LABEL_W,
        width = CONTROL_W,
        enabledIf = hasOthers,
        get = function()
            return nil
        end,
        set = function(name)
            confirm("Replace everything in this profile with a copy of %s?\n\nYour interface reloads.", name, "Copy and reload", function()
                Profiles:CopyFrom(name)
            end)
        end,
    }), x, top - 100).Dropdown:SetDefaultText("Pick a profile")
    add(UI.Dropdown(pf, "Delete profile", {
        options = function()
            return Profiles:Others()
        end,
        labelWidth = LABEL_W,
        width = CONTROL_W,
        enabledIf = hasOthers,
        get = function()
            return nil
        end,
        set = function(name)
            confirm("Delete the profile %s? This can't be undone.", name, DELETE, function()
                Profiles:Delete(name)
                refresh()
            end)
        end,
    }), x, top - 132).Dropdown:SetDefaultText("Pick a profile")
    add(UI.Dropdown(pf, "New characters", {
        options = function()
            return Profiles:All()
        end,
        labelWidth = LABEL_W,
        width = CONTROL_W,
        get = function()
            return Profiles:Default()
        end,
        set = function(name)
            Profiles:SetDefault(name)
            refresh()
        end,
    }), x, top - 164)

    local reset = button(pf, TEXT.reset, 100)
    reset:SetPoint("TOPLEFT", x, top - 204)
    reset:SetScript("OnClick", function()
        confirm("Put everything in the profile %s back to the defaults, its layouts, notes and history included? This can't be undone.\n\nYour interface reloads.", Profiles:Current(), "Reset and reload", function()
            Profiles:Reset()
        end)
    end)
    local export = button(pf, TEXT.export, 100)
    export:SetPoint("LEFT", reset, "RIGHT", 6, 0)
    export:SetScript("OnClick", showExport)
    local exportSettings = button(pf, TEXT.exportSettings)
    exportSettings:SetPoint("LEFT", export, "RIGHT", 6, 0)
    exportSettings:SetScript("OnClick", showExportSettings)
    local import = button(pf, TEXT.import, 100)
    import:SetPoint("LEFT", exportSettings, "RIGHT", 6, 0)
    import:SetScript("OnClick", showImport)

    -- greyed while this profile has no backup from a settings import
    local undo = button(pf, TEXT.undo)
    undo:SetPoint("TOPLEFT", reset, "BOTTOMLEFT", 0, -8)
    undo:SetScript("OnClick", function()
        confirm(TEXT.confirmUndo, Profiles:BackupFrom(), TEXT.acceptUndo, function()
            Profiles:UndoImport()
        end)
    end)
    undo.refresh = function()
        undo:SetEnabled(Profiles:HasBackup())
    end
    controls[#controls + 1] = undo
end

-- The Addon check tab (AddonCheck.lua): a heading with the tab's one (?) tooltip, the Module and Show filters,
-- Announce to (saved), Announce and Check on the first row, a status line, then the list: one row per group member with their name in
-- class colour, their version (good: yours or newer; warn: older; bad: No CRT; muted: Offline or waiting) and an
-- On / Off / — cell per registered module. A click on a No CRT or older row whispers that player. The filters
-- are page state, never saved. ---------------------------------------------------------------------------------

local CHECK = {
    heading = "Who runs CRT",
    help = "Asks everyone in your group which version of Cowfee Raid Tools they run and which optional modules they have switched on, and lists the answers. The group is asked when you open this tab and each time you press Check.\n\nGreen is your version, orange an older one, red No CRT no answer within 3 seconds. A dash means that player's CRT is too old to report that module.\n\nModule and Show narrow the list, so you can see before a pull who would miss a shared note, pace plan or kick list. The game blocks addon messages during a boss fight, so check before the pull.\n\nAnnounce posts who is missing CRT or on an older version, with the download link, where Announce to says: only to you, to the group's chat, as a raid warning (the raid leader or an assistant) or to officer chat. Click a red or orange row to whisper that player the same.",
    check = "Check",
    announce = "Announce",
    announceTo = "Announce to",
    announceWait = "Press Check first, and wait for the answers.",
    announceLead = "Only the raid leader or an assistant can send a raid warning, in a raid.",
    announceOfficer = "You can't speak in your guild's officer chat.",
    whisperTip = "Click to whisper %s about getting Cowfee Raid Tools.",
    whisperOlderTip = "Click to whisper %s about updating Cowfee Raid Tools.",
    whispered = "Whispered %s.",
    module = "Module",
    show = "Show",
    anyModule = "Any module",
    notGrouped = "Not in a group.",
    lockdown = "Addon messages are blocked during an encounter. Check again after the pull ends.",
    press = "Press Check to ask the group.",
    checked = "Checked %s ago:",
    inRaid = "%d in the raid",
    inParty = "%d in the party",
    onVersion = "%d on %s",
    older = "%d older",
    newer = "%d newer",
    noCRT = "%d without CRT",
    offline = "%d offline",
    waiting = "%d waiting",
    showing = "Showing %d of %d",
    name = "Name",
    version = "Version",
    you = "%s (you)",
    none = "No CRT",
    offlineRow = "Offline",
    waitingRow = "\226\128\166", -- …
    on = "On",
    off = "Off",
    unknown = "\226\128\148", -- —
}
local SHOW_OPTIONS = {
    { key = "all", label = "Everyone" },
    { key = "nocrt", label = "No CRT" },
    { key = "older", label = "Older version" },
    { key = "on", label = "Module on", needsModule = true },
    { key = "off", label = "Module off", needsModule = true },
}
local CHECK_ROW_H = 22
local CHECK_NAME_W, CHECK_VERSION_W, CHECK_CELL_W = 200, 110, 100
local CHECK_LIST_TOP = -112 -- the rows' top, from the tab frame's top (the heading row is at -44, the status line at -70, the column headings at -92)
local CHECK_BAR_W = 26 -- room for the scroll bar right of the rows

local check = { rows = {}, filterModule = nil, filterShow = "all", cells = {} }

-- A row's stripe: the surface colour in Modern, black in Classic, odd rows darker. Read when painted, so a
-- theme switch (which refreshes the page) repaints it.
local function stripeColor(odd)
    if UI:IsModern() then
        local c = CRT.PALETTE.surface
        return c[1], c[2], c[3], odd and 0.85 or 0.55
    end
    return 0, 0, 0, odd and 0.35 or 0.2
end

local function classColor(class)
    local c = class and ((C_ClassColor and C_ClassColor.GetClassColor(class)) or (RAID_CLASS_COLORS and RAID_CLASS_COLORS[class]))
    if type(c) == "table" and c.r then
        return c.r, c.g, c.b
    end
    if UI:IsModern() then
        local r, g, b = UI.Color("text")
        return r, g, b
    end
    return 1, 1, 1
end

local function ago(seconds)
    seconds = math.floor(seconds)
    if seconds < 60 then
        return seconds .. " s"
    end
    return math.floor(seconds / 60) .. " min"
end

-- The version cell's text for a row of AddonCheck:Rows().
local function versionText(row)
    local s = row.state
    if s == "you" then
        return UI.GoodText(CHECK.you:format(row.version))
    elseif s == "same" or s == "newer" then
        return UI.GoodText(row.version)
    elseif s == "older" then
        return UI.WarnText(row.version)
    elseif s == "none" then
        return UI.BadText(CHECK.none)
    elseif s == "offline" then
        return UI.ColorText(CHECK.offlineRow, "muted")
    end
    return UI.ColorText(CHECK.waitingRow, "muted")
end

-- A module cell: On, Off, — for a CRT that doesn't report it, nothing for a row with no answer.
local function cellText(row, key)
    local s = row.state
    if not (s == "you" or s == "same" or s == "newer" or s == "older") then
        return ""
    end
    local on = row.modules and row.modules[key]
    if on == true then
        return UI.GoodText(CHECK.on)
    elseif on == false then
        return UI.ColorText(CHECK.off, "muted")
    end
    return UI.ColorText(CHECK.unknown, "muted")
end

local function getCheckRow(i)
    local row = check.rows[i]
    if row then
        return row
    end
    -- a button, so a No CRT or older row whispers its player on a click (row.data is the row it shows)
    row = CreateFrame("Button", nil, check.child)
    row:SetHeight(CHECK_ROW_H)
    row:SetPoint("TOPLEFT", 0, -(i - 1) * CHECK_ROW_H)
    row:SetPoint("RIGHT", check.child, "RIGHT", 0, 0)
    row.stripe = row:CreateTexture(nil, "BACKGROUND")
    row.stripe:SetAllPoints()
    row.hl = row:CreateTexture(nil, "HIGHLIGHT")
    row.hl:SetAllPoints()
    row.hl:SetColorTexture(1, 1, 1, 0.08)
    row:SetScript("OnClick", function(self)
        local data = self.data
        if data and (data.state == "none" or data.state == "older") and CRT.AddonCheck:Whisper(data) then
            CRT:Print(CHECK.whispered:format(data.name))
        end
    end)
    row:SetScript("OnEnter", function(self)
        local data = self.data
        if not (data and (data.state == "none" or data.state == "older")) then
            return
        end
        UI.TooltipOwner(GameTooltip, self, "ANCHOR_RIGHT")
        GameTooltip:SetText(data.name)
        GameTooltip:AddLine((data.state == "none" and CHECK.whisperTip or CHECK.whisperOlderTip):format(data.name), 1, 1, 1, true)
        GameTooltip:Show()
    end)
    row:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    row.name = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    row.name:SetPoint("LEFT", 6, 0)
    row.name:SetWidth(CHECK_NAME_W - 12)
    row.name:SetJustifyH("LEFT")
    row.name:SetWordWrap(false)
    row.version = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    row.version:SetPoint("LEFT", CHECK_NAME_W + 6, 0)
    row.version:SetWidth(CHECK_VERSION_W - 12)
    row.version:SetJustifyH("LEFT")
    row.version:SetWordWrap(false)
    row.cells = {}
    for n, m in ipairs(CRT.AddonCheck:Modules()) do
        local fs = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        fs:SetPoint("LEFT", CHECK_NAME_W + CHECK_VERSION_W + (n - 1) * CHECK_CELL_W, 0)
        fs:SetWidth(CHECK_CELL_W)
        fs:SetJustifyH("CENTER")
        fs:SetWordWrap(false)
        row.cells[m.key] = fs
    end
    check.rows[i] = row
    return row
end

-- The status line: not in a group, press Check, or the counts of the last check (zero counts left out).
local function statusText(rows, counts)
    local Check = CRT.AddonCheck
    if not (IsInGroup and IsInGroup()) then
        return UI.ColorText(CHECK.notGrouped, "muted")
    end
    local at = Check:AskedAt()
    if not at then
        return UI.ColorText(CHECK.press, "muted")
    end
    local sep = UI.ColorText(" \194\183 ", "muted")
    local parts = {
        UI.ColorText(CHECK.checked:format(ago((GetTime and GetTime() or at) - at)), "muted") .. " " .. (IsInRaid() and CHECK.inRaid or CHECK.inParty):format(counts.total),
        UI.GoodText(CHECK.onVersion:format(counts.same, Check.VersionText())),
    }
    if counts.older > 0 then
        parts[#parts + 1] = UI.WarnText(CHECK.older:format(counts.older))
    end
    if counts.newer > 0 then
        parts[#parts + 1] = UI.GoodText(CHECK.newer:format(counts.newer))
    end
    if counts.none > 0 then
        parts[#parts + 1] = UI.BadText(CHECK.noCRT:format(counts.none))
    end
    if counts.offline > 0 then
        parts[#parts + 1] = UI.ColorText(CHECK.offline:format(counts.offline), "muted")
    end
    if counts.waiting > 0 then
        parts[#parts + 1] = UI.ColorText(CHECK.waiting:format(counts.waiting), "muted")
    end
    return table.concat(parts, sep)
end

local function refreshCheck()
    local Check = CRT.AddonCheck
    local rows = Check:Rows()
    local shown = Check.Filter(rows, check.filterModule, check.filterShow)
    check.status:SetText(statusText(rows, Check.Counts(rows)))
    check.showing:SetText(#shown < #rows and CHECK.showing:format(#shown, #rows) or "")
    for i, row in ipairs(shown) do
        local r = getCheckRow(i)
        r.data = row
        r.hl:SetShown(row.state == "none" or row.state == "older")
        r.stripe:SetColorTexture(stripeColor(i % 2 == 1))
        r.name:SetText(row.name)
        r.name:SetTextColor(classColor(row.class))
        r.version:SetText(versionText(row))
        for key, fs in pairs(r.cells) do
            fs:SetText(cellText(row, key))
        end
        r:Show()
    end
    for i = #shown + 1, #check.rows do
        check.rows[i]:Hide()
    end
    check.child:SetHeight(math.max(1, #shown * CHECK_ROW_H))
    local can, why = Check:CanCheck()
    check.button:SetEnabled(can or why == "gap")
    check.button.why = (not can and why ~= "gap") and why or nil
    local canSay, whyNot = Check:CanAnnounce()
    check.announce:SetEnabled(canSay and true or false)
    check.announce.why = (not canSay) and whyNot or nil
end

-- Asks the group again when the tab shows and the last ask is stale (AddonCheck.STALE).
local function checkTabShown()
    if page and page:IsShown() and CRT.db.ui.settingsTab == "addoncheck" then
        CRT.AddonCheck:MaybeCheck()
    end
end

local function buildAddonCheck(pf)
    local Check = CRT.AddonCheck
    local x, top = LEFT_X, -44
    heading(pf, x, top, CHECK.heading, CHECK.help)

    -- the first row's right side: Module, Show, Check
    local checkButton = button(pf, CHECK.check, 80)
    checkButton:SetPoint("TOPRIGHT", -10, top + 2)
    checkButton:SetScript("OnClick", function()
        Check:Check()
        refresh()
    end)
    checkButton:SetMotionScriptsWhileDisabled(true)
    checkButton:SetScript("OnEnter", function(self)
        if self.why then
            UI.TooltipOwner(GameTooltip, self, "ANCHOR_TOP")
            GameTooltip:SetText(CHECK.check)
            GameTooltip:AddLine(UI.BadText(self.why == "lockdown" and CHECK.lockdown or CHECK.notGrouped), 1, 1, 1, true)
            GameTooltip:Show()
        end
    end)
    checkButton:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    check.button = checkButton

    -- Announce, left of Check: greyed with the reason until a check has run and its window has closed
    local announce = button(pf, CHECK.announce, 90)
    announce:SetPoint("RIGHT", checkButton, "LEFT", -6, 0)
    announce:SetScript("OnClick", function()
        Check:Announce()
    end)
    announce:SetMotionScriptsWhileDisabled(true)
    announce:SetScript("OnEnter", function(self)
        if self.why then
            UI.TooltipOwner(GameTooltip, self, "ANCHOR_TOP")
            GameTooltip:SetText(CHECK.announce)
            local reason = (self.why == "group" and CHECK.notGrouped) or (self.why == "lead" and CHECK.announceLead) or (self.why == "officer" and CHECK.announceOfficer) or CHECK.announceWait
            GameTooltip:AddLine(UI.BadText(reason), 1, 1, 1, true)
            GameTooltip:Show()
        end
    end)
    announce:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    check.announce = announce

    -- where it posts, saved (CRTDB.addonCheck.announceTo)
    local announceTo = UI.Dropdown(pf, CHECK.announceTo, {
        options = Check.OUTPUTS,
        labelWidth = 80,
        width = 130,
        get = function()
            return Check:AnnounceTo()
        end,
        set = function(key)
            Check:SetAnnounceTo(key)
            refresh()
        end,
    })
    announceTo:SetPoint("RIGHT", announce, "LEFT", -6, 0)
    controls[#controls + 1] = announceTo

    local show = UI.Dropdown(pf, CHECK.show, {
        options = function()
            local out = {}
            for _, o in ipairs(SHOW_OPTIONS) do
                out[#out + 1] = { key = o.key, label = o.label, disabled = o.needsModule and not check.filterModule or nil }
            end
            return out
        end,
        labelWidth = 40,
        width = 150,
        get = function()
            return check.filterShow
        end,
        set = function(key)
            check.filterShow = key
            refresh()
        end,
    })
    show:SetPoint("RIGHT", announceTo, "LEFT", -12, 0)
    controls[#controls + 1] = show
    local module = UI.Dropdown(pf, CHECK.module, {
        options = function()
            local out = { { key = "any", label = CHECK.anyModule } }
            for _, m in ipairs(Check:Modules()) do
                out[#out + 1] = { key = m.key, label = m.label }
            end
            return out
        end,
        labelWidth = 50,
        width = 150,
        get = function()
            return check.filterModule or "any"
        end,
        set = function(key)
            check.filterModule = key ~= "any" and key or nil
            -- Module on / off need a module
            if not check.filterModule and (check.filterShow == "on" or check.filterShow == "off") then
                check.filterShow = "all"
            end
            refresh()
        end,
    })
    module:SetPoint("RIGHT", show, "LEFT", -8, 0)
    controls[#controls + 1] = module

    check.status = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    check.status:SetPoint("TOPLEFT", x, top - 26)
    check.status:SetJustifyH("LEFT")
    check.showing = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    check.showing:SetPoint("TOPRIGHT", -10, top - 26)
    check.showing:SetJustifyH("RIGHT")
    UI.Tint(check.showing, "SetTextColor", "muted")

    -- the column headings, then the list under a line
    local function head(text, offset, width, justify)
        local fs = pf:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
        fs:SetPoint("TOPLEFT", x + offset + 6, top - 48)
        fs:SetWidth(width - 12)
        fs:SetJustifyH(justify)
        fs:SetWordWrap(false)
        fs:SetText(text)
        return fs
    end
    head(CHECK.name, 0, CHECK_NAME_W, "LEFT")
    head(CHECK.version, CHECK_NAME_W, CHECK_VERSION_W, "LEFT")
    for n, m in ipairs(Check:Modules()) do
        head(m.label, CHECK_NAME_W + CHECK_VERSION_W + (n - 1) * CHECK_CELL_W, CHECK_CELL_W, "CENTER")
    end
    local line = pf:CreateTexture(nil, "ARTWORK")
    line:SetHeight(1)
    line:SetPoint("TOPLEFT", x, CHECK_LIST_TOP + 3)
    line:SetPoint("TOPRIGHT", -10 - CHECK_BAR_W, CHECK_LIST_TOP + 3)
    UI.Tint(line, "SetColorTexture", "border")

    local scroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsAddonCheckScroll", pf, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(scroll.ScrollBar)
    scroll:SetPoint("TOPLEFT", x, CHECK_LIST_TOP)
    scroll:SetPoint("BOTTOMRIGHT", -10 - CHECK_BAR_W, 8)
    check.child = CreateFrame("Frame", nil, scroll)
    check.child:SetSize(UI.PAGE_W - 20 - CHECK_BAR_W, 1)
    scroll:SetScrollChild(check.child)

    check.refresh = refreshCheck
    controls[#controls + 1] = check
    -- "Checked N s ago" keeps counting while the tab shows
    local elapsed = 0
    pf:SetScript("OnUpdate", function(_, dt)
        elapsed = elapsed + dt
        if elapsed >= 1 then
            elapsed = 0
            if check.status and page and page:IsShown() then
                refreshCheck()
            end
        end
    end)
    pf:SetScript("OnShow", checkTabShown)
    Check:OnChange(refresh)
end

-- The marker macros, which were on a Macros tab here, are on Raid Notes > Marker macros (Markers/MacrosTab.lua).
-- A saved settingsTab of "macros" opens Appearance.
local TABS = {
    { key = "appearance", label = "Appearance" },
    { key = "profiles", label = "Profiles" },
    { key = "addoncheck", label = "Addon check" },
}
local tabButtons, tabFrames = {}, {}

local function selectTab(key)
    if not tabFrames[key] then
        key = "appearance"
    end
    CRT.db.ui.settingsTab = key
    for _, tab in ipairs(TABS) do
        local on = tab.key == key
        tabFrames[tab.key]:SetShown(on)
        UI:SetTabSelected(tabButtons[tab.key], on)
    end
    checkTabShown()
end

local function build(pf)
    page = pf

    local title = pf:CreateFontString(nil, "OVERLAY", "CRTFontLarge")
    title:SetPoint("TOPLEFT", 8, -8)
    title:SetText("General Settings")
    UI.HelpRight(title, "General Settings", "Settings for the whole addon: the look, text, sound, reports, the minimap button, where tooltips open, window layers and profiles. Changes apply at once, except profile changes, which reload your interface.")

    for i, tab in ipairs(TABS) do
        local b = CreateFrame("Button", nil, pf, "BackdropTemplate")
        b:SetSize(160, 26)
        b:SetPoint("TOPLEFT", 8 + (i - 1) * 164, -36)
        b:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
        b.sel = b:CreateTexture(nil, "ARTWORK")
        b.sel:SetAllPoints()
        b.text = b:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
        b.text:SetPoint("CENTER")
        b.text:SetText(tab.label)
        b:SetScript("OnClick", function()
            selectTab(tab.key)
        end)
        tabButtons[tab.key] = b
        UI:RegisterTab(b)

        -- The tab's content starts 30 lower than the page did, so the columns keep their own offsets.
        local f = CreateFrame("Frame", nil, pf)
        f:SetPoint("TOPLEFT", 0, -30)
        f:SetPoint("BOTTOMRIGHT", 0, 0)
        f:Hide()
        tabFrames[tab.key] = f
    end
    local line = pf:CreateTexture(nil, "ARTWORK")
    line:SetColorTexture(0.35, 0.35, 0.35, 1)
    line:SetHeight(1)
    line:SetPoint("TOPLEFT", 8, -62)
    line:SetPoint("TOPRIGHT", -8, -62)

    buildLeft(tabFrames.appearance)
    buildRight(tabFrames.appearance)
    buildProfiles(tabFrames.profiles)
    buildAddonCheck(tabFrames.addoncheck)
    selectTab(CRT.db.ui.settingsTab)

    pf:SetScript("OnShow", function()
        refresh()
        checkTabShown()
    end)
    -- Ctrl + mouse wheel changes the scale too, so the slider follows it.
    UI.onScale = refresh
    -- a push, a hello or a roster change: Team raids follows while the page shows (refresh checks)
    CRT.Team:OnRecount(refresh)
    -- a merge, from the Merge teams dialog or the look-alike prompt: the list and Merge team… follow
    CRT.Team:OnMerge(refresh)
end

UI:RegisterPage("settings", "General Settings", build)
