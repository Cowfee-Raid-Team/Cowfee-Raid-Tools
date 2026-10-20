local ADDON, CRT = ...

-- The Quality of Life page: a home for small conveniences and their settings, in CRTDB.qol with
-- defaults in Core.lua: the experimental low-health alert (QoL/LowHealth.lua), and on its own tab the
-- break timer's other-addon formats and bridge (QoL/BreakTimer.lua, Integrations/Breaks.lua). The
-- window scale moved to the Addon Settings page (UI/SettingsPage.lua) in 0.13.1.

local UI = CRT.UI
local LowHealth = CRT.LowHealth

-- Every word on this page, in one place so the wording is easy to change.
local TEXT = {
    title = "Quality of Life",
    hint = "Small conveniences for raid nights.",

    lowHealth = "Low-health alert",
    lowHealthTag = "(experimental)",
    lowHealthEnable = "Show a LOW HEALTH banner when my health is low",
    lowHealthThreshold = "Show it at or under this much health:",
    lowHealthSound = "Also play the game's low-health pulse sound  |cff999999(WIP)|r",
    lowHealthSoundWIP = "Work in progress: the low-health sound doesn't work yet, so it is switched off. The game hides its low-health decision from addons, and its Combat Audio Alerts errored alongside other addons when turned on. Any game setting it changed has been put back. We'll come back to it.",
    lowHealthSoundNote = "Turns on the game's own low-health pulse (Combat Audio Alerts, in the game's Accessibility options): a sound that loops while your health is under your threshold, faster as it drops. The game compares your health itself, so it works in combat, where an addon can't.\n\nThe pulse works in 10% steps, so your threshold is rounded to the nearest one (35% becomes 40%).\n\nIf you weren't using Combat Audio Alerts, its spoken alerts are switched off so only the pulse plays. Unticking this puts every game setting it changed back.",
    lowHealthVolume = "Volume",
    lowHealthChoice = "Sound",
    lowHealthChoiceNote = "The game's pulse loops and speeds up as your health drops. Any other sound repeats, faster at each lower 10%.\n\nShared sounds come from other addons through LibSharedMedia, when one of them is installed.\n\nYour own sounds are listed on the Sounds tab, which says where the files go.\n\nVolume only changes the game's sounds. Shared and your own sounds play at the volume of their output channel.",
    lowHealthOnce = "Play once each time my health drops under",
    lowHealthOnceNote = "On: the sound plays one time, in full, each time your health drops under the threshold. Dropping lower during the same dip doesn't play it again; healing and dropping again does.\n\nOff: it repeats until you heal, faster as your health drops, each repeat cutting off the one before.\n\nThe game's pulse is a loop and keeps looping either way.",
    soundsTitle = "Your sound files",
    soundsNote = "Your own .ogg or .mp3 files, for every sound list in the addon (marked yours) and, as CRT: <name>, for other addons that use LibSharedMedia.\n\nWhere they go: the CowfeeRaidTools_Media companion addon. Copy the CowfeeRaidTools_Media folder from Interface\\AddOns\\CowfeeRaidTools\\CRT_Media\\Media Addon Template into Interface\\AddOns once, put your files in its Sounds folder and list their names in its Sounds.lua. Updating Cowfee Raid Tools never touches that folder. Files in the old places, CowfeeRaidTools\\CRT_Media\\Sounds and CowfeeRaidTools\\Sounds, still play, but an update removes them.\n\nThe game can't list a folder, so a file is known by name: from Sounds.lua, or typed here and added. Test plays a file and says whether the game found it. A file copied in while the game is running may need a game restart, not only a /reload.",
    soundsAdd = "Add",
    soundsTest = "Test",
    soundsRemove = "Remove",
    soundsNone = "No files yet. Type a file's name and press Add, or list them in CowfeeRaidTools_Media's Sounds.lua.",
    soundsMedia = "CowfeeRaidTools_Media: %s",
    soundsFromManifest = "from Sounds.lua",
    soundsTyped = "typed here",
    lowHealthOutput = "Output",
    lowHealthOutputNote = "Game default plays the sound on the game's voice output, like its own pulse. Pick a channel to follow that channel's volume and mute in the game's Sound settings instead.\n\nAny sound other than the game's pulse, or any channel, is played by the addon: the game's pulse runs silently and the addon plays yours whenever it starts or stops, so it still works in combat.",
    lowHealthTest = "Test sound",
    lowHealthStop = "Stop sound",
    breakTitle = "Break timer",
    breakNote = "/crt break 10 starts a 10 minute break, /crt break 0 cancels it. From the raid leader or an assistant it reaches the whole group.\n\nA break from the leader or an assistant started in Northern Sky (/ns break), BigWigs, DBM or MRT's Timers page shows here too.",
    breakAlso = "Also send to",
    breakAlsoNote = "When you start or cancel a break as the leader or an assistant, it is also sent as a break in each ticked format, so raiders running those addons get it in their own break bar.\n\nNorthern Sky: NSRT's break bar. It needs NSRT loaded here.\n\nBigWigs and DBM: their break bars. They are sent even if you don't run them, since your raiders may. MRT's Timers page uses these two, so there is no separate MRT format.",
    breakBridge = "Bridge breaks between addons (raid leader)",
    breakBridgeNote = "When you are the raid leader and someone starts or cancels a break in one addon (such as /ns break, or MRT's Timers page), your CRT sends the same break on in the formats it didn't arrive in, and as a CRT break, so everyone sees it whichever addon they run.\n\nIt waits a moment to see which formats the break came in, then sends each missing one once. Your own breaks are never bridged, and breaks that end within 3 seconds of each other count as one.",
    lowHealthNote = "Experimental: in combat the game hides your health from addons, so the banner lets the game compare it to your setting. If it misbehaves, untick it here or type /crt lowhp off. Use Previews to place the banner.",
}

local page
local controls = {}

local function settings()
    return CRT.db.qol.lowHealth
end

local function makeButton(parent, label, width, height)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontNormal)
    b:SetHighlightFontObject(CRTFontHighlight)
    b:SetDisabledFontObject(CRTFontDisable)
    b:SetSize(width, height or 24)
    b:SetText(label)
    return b
end

local function refresh()
    if not page or not page:IsShown() then
        return
    end
    for _, control in ipairs(controls) do
        control.refresh()
    end
end

-- Both sliders line up: the labels share one width. The sliders are Edit Mode sliders (UI/Controls.lua).
local SLIDER_LABEL_W = 230

local function percent(v)
    return v .. "%"
end

-- A small button in the game's small font, the size of the Previews button's text.
local function smallButton(pf, text)
    local b = makeButton(pf, text, 110, 20)
    b:SetNormalFontObject(CRTFontButtonSmall)
    b:SetHighlightFontObject(CRTFontButtonSmallHighlight)
    b:SetDisabledFontObject(CRTFontButtonSmallDisable)
    return b
end

-- Low-health alert ----------------------------------------------------------------------------

local function buildLowHealth(pf, top)
    local heading = pf:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    heading:SetPoint("TOPLEFT", 8, top)
    heading:SetText(TEXT.lowHealth .. "  |cff999999" .. TEXT.lowHealthTag .. "|r")
    UI.Help(pf, TEXT.lowHealth, TEXT.lowHealthNote):SetPoint("LEFT", heading, "RIGHT", 6, 0)

    local check = CreateFrame("CheckButton", nil, pf, "UICheckButtonTemplate")
    check:SetSize(24, 24)
    check:SetPoint("TOPLEFT", 6, top - 18)
    local checkText = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    checkText:SetPoint("LEFT", check, "RIGHT", 1, 0)
    checkText:SetText(TEXT.lowHealthEnable)
    check:SetScript("OnClick", function(self)
        LowHealth:SetEnabled(self:GetChecked())
        refresh()
    end)
    check.refresh = function()
        check:SetChecked(settings().enabled and true or false)
    end
    controls[#controls + 1] = check

    local slider = UI.Slider(pf, TEXT.lowHealthThreshold, {
        min = 5,
        max = 90,
        step = 5,
        labelWidth = SLIDER_LABEL_W,
        width = 200,
        format = percent,
        get = function()
            return settings().threshold or 35
        end,
        set = function(v)
            settings().threshold = v
            LowHealth:Apply()
        end,
        enabledIf = function()
            return settings().enabled
        end,
    })
    slider:SetPoint("TOPLEFT", 10, top - 42)
    controls[#controls + 1] = slider

    -- The sound: the game's own low-health pulse.
    local Sound = CRT.LowHealthSound
    local function alertOn()
        return settings().enabled
    end
    local sound = CreateFrame("CheckButton", nil, pf, "UICheckButtonTemplate")
    sound:SetSize(24, 24)
    sound:SetPoint("TOPLEFT", 6, top - 76)
    local soundText = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    soundText:SetPoint("LEFT", sound, "RIGHT", 1, 0)
    soundText:SetText(TEXT.lowHealthSound)
    UI.Help(pf, TEXT.lowHealthSound, function()
        return Sound.WIP and TEXT.lowHealthSoundWIP or TEXT.lowHealthSoundNote
    end):SetPoint("LEFT", soundText, "RIGHT", 6, 0)
    sound:SetScript("OnClick", function(self)
        settings().sound = self:GetChecked() and true or false
        Sound:Apply()
        refresh()
    end)
    sound.refresh = function()
        local on = alertOn() and Sound:Available() and not Sound.WIP
        sound:SetChecked((settings().sound and not Sound.WIP) and true or false)
        sound:SetEnabled(on)
        local c = on and 1 or 0.5
        soundText:SetTextColor(c, c, c)
    end
    controls[#controls + 1] = sound

    local function soundOn()
        return alertOn() and settings().sound and not Sound.WIP
    end
    -- A Play button inside each item of the Sound and Output menus: the Sound menu plays each sound on
    -- your output, the Output menu plays your sound on each output. Click again to stop; it stops by
    -- itself after 3 seconds.
    local function playButton(choiceOf, outputOf)
        return function(button, option)
            local choiceKey, outputKey = choiceOf(option), outputOf(option)
            local hit = button:AttachFrame("Button")
            hit:SetSize(40, 18)
            hit:SetPoint("RIGHT", -4, 0)
            hit:EnableMouse(true)
            local label = button:AttachFontString()
            label:SetFontObject(CRTFontButtonSmall)
            label:SetPoint("CENTER", hit, "CENTER")
            local token = {}
            hit.crtToken = token
            local function show()
                if Sound:IsPreviewing(choiceKey, outputKey) then
                    label:SetText("|cffff6060Stop|r")
                else
                    label:SetText("|cff80c0ffPlay|r")
                end
            end
            show()
            hit:SetScript("OnClick", function()
                Sound:Preview(choiceKey, outputKey, function()
                    -- The menu reuses its pieces, so only update this label if it is still this item's.
                    if hit.crtToken == token then
                        show()
                    end
                end)
                show()
            end)
            if button.fontString then
                button.fontString:SetPoint("RIGHT", hit, "LEFT", -6, 0)
            end
            local textWidth = button.fontString and button.fontString:GetUnboundedStringWidth() or 120
            return textWidth + 80, 20
        end
    end

    local choice = UI.Dropdown(pf, TEXT.lowHealthChoice, {
        options = Sound.Choices,
        decorate = playButton(function(option)
            return option.key
        end, function()
            return settings().soundChannel or "game"
        end),
        labelWidth = SLIDER_LABEL_W,
        width = 200,
        get = function()
            return settings().soundChoice or "pulse"
        end,
        set = function(key)
            settings().soundChoice = key
            Sound:Apply()
            refresh()
        end,
        enabledIf = soundOn,
    })
    choice:SetPoint("TOPLEFT", 10, top - 100)
    controls[#controls + 1] = choice
    UI.Help(pf, TEXT.lowHealthChoice, TEXT.lowHealthChoiceNote):SetPoint("LEFT", choice, "RIGHT", 6, 0)

    local output = UI.Dropdown(pf, TEXT.lowHealthOutput, {
        options = Sound.Outputs,
        decorate = playButton(function()
            return settings().soundChoice or "pulse"
        end, function(option)
            return option.key
        end),
        labelWidth = SLIDER_LABEL_W,
        width = 200,
        get = function()
            return settings().soundChannel or "game"
        end,
        set = function(key)
            settings().soundChannel = key
            Sound:Apply()
            refresh()
        end,
        enabledIf = soundOn,
    })
    output:SetPoint("TOPLEFT", 10, top - 130)
    controls[#controls + 1] = output
    UI.Help(pf, TEXT.lowHealthOutput, TEXT.lowHealthOutputNote):SetPoint("LEFT", output, "RIGHT", 6, 0)

    local volume = UI.Slider(pf, TEXT.lowHealthVolume, {
        min = 0,
        max = 100,
        step = 5,
        labelWidth = SLIDER_LABEL_W,
        width = 200,
        format = percent,
        get = function()
            return settings().soundVolume or 100
        end,
        set = function(v)
            settings().soundVolume = v
            Sound:Apply()
        end,
        enabledIf = soundOn,
    })
    volume:SetPoint("TOPLEFT", 10, top - 160)
    controls[#controls + 1] = volume

    -- Play once: the sound plays one time per dip under the threshold (not the game's looping pulse).
    local once = CreateFrame("CheckButton", nil, pf, "UICheckButtonTemplate")
    once:SetSize(24, 24)
    once:SetPoint("TOPLEFT", 6, top - 192)
    local onceText = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    onceText:SetPoint("LEFT", once, "RIGHT", 1, 0)
    onceText:SetText(TEXT.lowHealthOnce)
    UI.Help(pf, TEXT.lowHealthOnce, TEXT.lowHealthOnceNote):SetPoint("LEFT", onceText, "RIGHT", 6, 0)
    once:SetScript("OnClick", function(self)
        settings().soundOnce = self:GetChecked() and true or false
        Sound:StopOurs()
        refresh()
    end)
    once.refresh = function()
        local on = soundOn() and (settings().soundChoice or "pulse") ~= "pulse"
        once:SetChecked(settings().soundOnce ~= false)
        once:SetEnabled(on and true or false)
        local c = on and 1 or 0.5
        onceText:SetTextColor(c, c, c)
    end
    controls[#controls + 1] = once

    local test = smallButton(pf, TEXT.lowHealthTest)
    test:SetPoint("LEFT", volume, "RIGHT", 12, 0)
    -- Test sound plays your choice for 3 seconds; while it plays the button stops it.
    test:SetScript("OnClick", function()
        local started = Sound:Test(function()
            test:SetText(TEXT.lowHealthTest)
        end)
        test:SetText(started and TEXT.lowHealthStop or TEXT.lowHealthTest)
    end)
    -- Greyed out with the rest of the sound settings, and while the sound is a work in progress.
    controls[#controls + 1] = {
        refresh = function()
            test:SetEnabled(soundOn() and true or false)
        end,
    }

end

-- Your sound files (Sound/Engine.lua) --------------------------------------------------------

local SOUND_ROWS = 12

local function buildSounds(pf, top)
    local Engine = CRT.Sound
    local heading = pf:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    heading:SetPoint("TOPLEFT", 8, top)
    heading:SetText(TEXT.soundsTitle)
    UI.Help(pf, TEXT.soundsTitle, TEXT.soundsNote):SetPoint("LEFT", heading, "RIGHT", 6, 0)

    local media = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    media:SetPoint("TOPLEFT", 10, top - 22)

    local edit = CreateFrame("EditBox", nil, pf, "InputBoxTemplate")
    edit:SetAutoFocus(false)
    edit:SetFontObject(CRTFontHighlight)
    edit:SetMaxLetters(80)
    edit:SetSize(220, 22)
    edit:SetPoint("TOPLEFT", 16, top - 44)
    edit:SetScript("OnEscapePressed", function(self)
        self:ClearFocus()
    end)
    local add = smallButton(pf, TEXT.soundsAdd)
    add:SetWidth(60)
    add:SetPoint("LEFT", edit, "RIGHT", 8, 0)
    local function addTyped()
        local ok, message = Engine:AddCustom(edit:GetText())
        CRT:Print(message)
        if ok then
            edit:SetText("")
        end
        edit:ClearFocus()
        refresh()
    end
    add:SetScript("OnClick", addTyped)
    edit:SetScript("OnEnterPressed", addTyped)

    local empty = pf:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    empty:SetPoint("TOPLEFT", 10, top - 76)
    empty:SetText(TEXT.soundsNone)

    -- One row per file: its name, where it is listed, Test (and what Test found), and Remove for a typed one.
    local rows = {}
    local results = {} -- file name -> what its last Test found
    for i = 1, SOUND_ROWS do
        local y = top - 74 - (i - 1) * 24
        local row = {}
        row.name = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        row.name:SetPoint("TOPLEFT", 10, y - 4)
        row.name:SetWidth(220)
        row.name:SetJustifyH("LEFT")
        row.name:SetWordWrap(false)
        row.source = pf:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
        row.source:SetPoint("TOPLEFT", 236, y - 4)
        row.test = smallButton(pf, TEXT.soundsTest)
        row.test:SetWidth(60)
        row.test:SetPoint("TOPLEFT", 346, y)
        row.remove = smallButton(pf, TEXT.soundsRemove)
        row.remove:SetWidth(70)
        row.remove:SetPoint("LEFT", row.test, "RIGHT", 6, 0)
        row.result = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        row.result:SetPoint("LEFT", row.remove, "RIGHT", 10, 0)
        row.test:SetScript("OnClick", function()
            if row.file then
                local played, message = Engine:TestFile(row.file)
                results[row.file] = played and "|cff60ff60played|r" or "|cffff6060not found|r"
                CRT:Print(message)
                refresh()
            end
        end)
        row.remove:SetScript("OnClick", function()
            if row.file and Engine:RemoveCustom(row.file) then
                CRT:Print("Removed " .. row.file .. " from the list. The file itself stays where it is.")
                refresh()
            end
        end)
        rows[i] = row
    end
    local more = pf:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    more:SetPoint("TOPLEFT", 10, top - 74 - SOUND_ROWS * 24)

    controls[#controls + 1] = {
        refresh = function()
            local loaded = C_AddOns and C_AddOns.IsAddOnLoaded and C_AddOns.IsAddOnLoaded(Engine.MEDIA_ADDON)
            media:SetText(string.format(TEXT.soundsMedia, loaded and "|cff60ff60loaded|r" or "|cffff8080not installed|r (see the (?))"))
            local files = Engine:CustomFiles()
            empty:SetShown(#files == 0)
            for i, row in ipairs(rows) do
                local f = files[i]
                row.file = f and f.name or nil
                local shown = f ~= nil
                row.name:SetShown(shown)
                row.source:SetShown(shown)
                row.test:SetShown(shown)
                row.remove:SetShown(shown and f.source == "typed")
                row.result:SetShown(shown)
                if f then
                    row.name:SetText(f.name)
                    row.source:SetText(f.source == "manifest" and TEXT.soundsFromManifest or TEXT.soundsTyped)
                    row.result:SetText(results[f.name] or "")
                end
            end
            more:SetText(#files > SOUND_ROWS and ("+" .. (#files - SOUND_ROWS) .. " more") or "")
        end,
    }
end

-- Break timer ---------------------------------------------------------------------------------

local Formats = CRT.BreakFormats

local function checkRow(pf, x, y, text)
    local check = CreateFrame("CheckButton", nil, pf, "UICheckButtonTemplate")
    check:SetSize(24, 24)
    check:SetPoint("TOPLEFT", x, y)
    check.label = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    check.label:SetPoint("LEFT", check, "RIGHT", 1, 0)
    check.label:SetText(text)
    return check
end

local function buildBreak(pf, top)
    local heading = pf:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    heading:SetPoint("TOPLEFT", 8, top)
    heading:SetText(TEXT.breakTitle)
    UI.Help(pf, TEXT.breakTitle, TEXT.breakNote):SetPoint("LEFT", heading, "RIGHT", 6, 0)

    local also = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    also:SetPoint("TOPLEFT", 8, top - 26)
    also:SetText(TEXT.breakAlso)
    -- The (?) also says, for each format, whether it can be sent from here.
    UI.Help(pf, TEXT.breakAlso, function()
        local lines = { TEXT.breakAlsoNote }
        for _, f in ipairs(Formats.FORMATS) do
            local ok, note = Formats.Available(f)
            lines[#lines + 1] = f.label .. ": " .. (ok and (note or "loaded here") or ("|cffff8080" .. note .. "|r"))
        end
        return table.concat(lines, "\n\n")
    end):SetPoint("LEFT", also, "RIGHT", 6, 0)

    local y = top - 44
    for _, f in ipairs(Formats.FORMATS) do
        local check = checkRow(pf, 6, y, f.label)
        check:SetScript("OnClick", function(self)
            Formats.SetEnabled(f.key, self:GetChecked())
        end)
        check.refresh = function()
            local ok = Formats.Available(f)
            check:SetChecked(Formats.Enabled(f.key))
            check:SetEnabled(ok and true or false)
            if ok then
                check.label:SetTextColor(1, 1, 1)
            else
                check.label:SetTextColor(0.5, 0.5, 0.5)
            end
        end
        controls[#controls + 1] = check
        y = y - 24
    end

    local bridge = checkRow(pf, 6, y - 10, TEXT.breakBridge)
    bridge:SetScript("OnClick", function(self)
        CRT.db.qol.breakTimer.bridge = self:GetChecked() and true or false
    end)
    bridge.refresh = function()
        bridge:SetChecked(CRT.db.qol.breakTimer.bridge and true or false)
    end
    controls[#controls + 1] = bridge
    UI.Help(pf, TEXT.breakBridge, TEXT.breakBridgeNote):SetPoint("LEFT", bridge.label, "RIGHT", 6, 0)
end

-- Tabs: Low health, Debuffs, Break timer and Sounds (the debuff panel, Debuffs/Page.lua). Both are only settings.
local TABS = {
    { key = "lowhealth", label = "Low health" },
    { key = "debuffs", label = "Debuffs" },
    { key = "break", label = "Break timer" },
    { key = "sounds", label = "Sounds" },
}
local tabButtons, tabFrames = {}, {}

local function selectTab(key)
    if not tabFrames[key] then
        key = "lowhealth"
    end
    CRT.db.qol.tab = key
    for _, tab in ipairs(TABS) do
        local on = tab.key == key
        tabFrames[tab.key]:SetShown(on)
        UI:SetTabSelected(tabButtons[tab.key], on)
    end
end

local function build(pf)
    page = pf

    local title = pf:CreateFontString(nil, "OVERLAY", "CRTFontLarge")
    title:SetPoint("TOPLEFT", 8, -8)
    title:SetText(TEXT.title)

    UI.Help(pf, TEXT.title, TEXT.hint):SetPoint("LEFT", title, "RIGHT", 6, 0)

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

        local f = CreateFrame("Frame", nil, pf)
        f:SetPoint("TOPLEFT", 0, -66)
        f:SetPoint("BOTTOMRIGHT", 0, 0)
        f:Hide()
        tabFrames[tab.key] = f
    end
    local line = pf:CreateTexture(nil, "ARTWORK")
    line:SetColorTexture(0.35, 0.35, 0.35, 1)
    line:SetHeight(1)
    line:SetPoint("TOPLEFT", 8, -62)
    line:SetPoint("TOPRIGHT", -8, -62)

    buildLowHealth(tabFrames.lowhealth, -8)
    CRT.DebuffsPage.Build(tabFrames.debuffs)
    buildBreak(tabFrames["break"], -8)
    buildSounds(tabFrames.sounds, -8)
    selectTab(CRT.db.qol.tab)

    pf:SetScript("OnShow", refresh)
    -- Leaving the page stops any sound being tried out.
    pf:SetScript("OnHide", function()
        CRT.LowHealthSound:StopPreview()
    end)
end

UI:RegisterPage("qol", TEXT.title, build)

-- Opens the page on a tab: "lowhealth", "debuffs" (/crt debuffs), "break" or "sounds".
CRT.QoLPage = {
    Open = function(key)
        UI:Show("qol")
        selectTab(key)
    end,
}
