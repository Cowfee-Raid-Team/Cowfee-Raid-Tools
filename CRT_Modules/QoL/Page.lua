local ADDON, CRT = ...

-- The Quality of Life page: a home for small conveniences and their settings, in CRTDB.qol with
-- defaults in Core.lua: the experimental low-health alert (QoL/LowHealth.lua; for a sound, a line points to the
-- game's own Combat Audio Alerts pulse, since an addon can't play one for hidden health), and on its own tab the
-- break timer's other-addon formats and bridge (QoL/BreakTimer.lua, Integrations/Breaks.lua), and on the Sounds
-- tab the voice that speaks (sound.voice, Sound/Voices.lua) above your own sound files. The Battle res tab holds the
-- battle res icon's settings (QoL/BattleRes.lua). The Low health, Debuffs, Break timer and Battle res tabs each have a
-- preview button for their display (UI.PreviewButton); with no
-- Settings tab, the page has no group button. The
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
    -- the sound: a pointer to the game's own pulse (#1242); CRT plays none and changes none of its settings
    lowHealthSound = "Low-health sound",
    lowHealthSoundLine = "For a sound when your health is low, turn on the game's own low-health pulse in Options > Accessibility > Combat Audio Alerts, and set its health threshold near your banner's.",
    lowHealthSoundNote = "An addon can't play its own sound for this in Midnight: the game hides your health from addons, and every way to play a sound refuses that hidden value. The game's own pulse can, since it is the game's code. It loops while your health is under its threshold and gets faster as it drops.",
    voice = "Voice",
    voiceNote = "The voice that reads alerts and note lines out. %s say their words with recorded clips: a whole line such as Soak, Spread or Run out, and the numbers of a count. Any other line is read by the game's text to speech.",
    voiceTts = "Game text to speech reads every line with the voice picked in the game's Text to Speech settings, at the Raid Notes speech rate and volume.",
    voiceLists = "Every sound list also has the clips, under each voice's name.",
    voiceTest = "Test",
    voiceSample = "Spread",
    soundsTitle = "Your sound files",
    soundsNote = "Your own .ogg or .mp3 files, for every sound list in the addon. Copy the CowfeeRaidTools_Media folder from CowfeeRaidTools\\CRT_Media\\Media Addon Template into Interface\\AddOns once, put your files in its Sounds folder and list their names in Sounds.lua; updates never touch that folder. The game can't list a folder, so a file is known by its name. Test plays it and says whether the game found it. A file added while the game runs may need a restart.",
    soundsAdd = "Add",
    soundsTest = "Test",
    soundsRemove = "Remove",
    soundsNone = "No files yet. Type a file's name and press Add, or list them in CowfeeRaidTools_Media's Sounds.lua.",
    soundsMedia = "CowfeeRaidTools_Media: %s",
    soundsFromManifest = "from Sounds.lua",
    soundsTyped = "typed here",
    breakTitle = "Break timer",
    breakNote = "/crt break 10 starts a 10 minute break; /crt break 0 cancels it. From the raid leader or an assistant it reaches the whole group. Breaks the leader or an assistant starts in Northern Sky, BigWigs, DBM or MRT show here too.",
    breakAlso = "Also send to",
    breakAlsoNote = "When you start or cancel a break as the leader or an assistant, it is also sent in each ticked format, so raiders on those addons get it in their own break bar. Northern Sky needs NSRT loaded here; BigWigs and DBM are sent even if you don't run them.",
    breakBridge = "Bridge breaks between addons (raid leader)",
    breakBridgeNote = "When you are the raid leader and someone starts or cancels a break in another addon, your CRT sends the same break on in the formats it didn't arrive in, so everyone sees it. It waits a moment to see which formats came in, then sends each missing one once.",
    lowHealthNote = "Off until you tick \"Show a LOW HEALTH banner when my health is low\" below (or type /crt lowhp on).\n\nExperimental: the game hides your health from addons, so the banner lets the game compare it to your setting. If it misbehaves, untick it here or type /crt lowhp off. Use Preview banner to place the banner.",
    lowHealthPreview = "Preview banner",
    lowHealthPreviewTip = "Shows the LOW HEALTH banner with its drag box so you can drag it into place. Other previews stay as they are.",
    breakPreview = "Preview break timer",
    breakPreviewTip = "Shows the break timer with a sample break so you can drag it into place. Other previews stay as they are.",
    brezEnable = "Show battle res icon",
    brezNote = "An icon with your group's battle res charges in its corner. While a charge comes back, it shows the time to it. At 0 charges its border and number turn the theme's bad colour (red in Default: Blizzard). If the game hides the charges in a fight, it shows the count only.",
    brezShow = "Show it",
    brezBoss = "In boss fights",
    brezCombat = "In any combat in a raid",
    brezRaid = "Always in a raid",
    brezSize = "Size",
    brezTimer = "Show the timer",
    brezPreview = "Preview battle res",
    brezPreviewTip = "Shows the icon with 2 charges and one coming back, so you can drag it into place. Other previews stay as they are.",
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
-- The preview buttons: Low health's under its sound line (at top - 80, up to two lines of SOUND_LINE_W), Break
-- timer's under the bridge row.
local LOWHEALTH_PREVIEW_Y = 124
local SOUND_LINE_W = 520
local BREAK_PREVIEW_GAP = 44

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
    UI.HelpRight(heading, TEXT.lowHealth, TEXT.lowHealthNote)

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

    -- The sound: a line pointing to the game's own low-health pulse, with a (?) on why CRT plays none (#1242). CRT never
    -- turns the pulse on or changes its settings (QoL/LowHealthSound.lua only puts back what an older version changed).
    local soundLine = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    soundLine:SetPoint("TOPLEFT", 10, top - 80)
    soundLine:SetWidth(SOUND_LINE_W)
    soundLine:SetJustifyH("LEFT")
    soundLine:SetText(TEXT.lowHealthSoundLine)
    UI.HelpRight(soundLine, TEXT.lowHealthSound, TEXT.lowHealthSoundNote)

    local preview = UI.PreviewButton(pf, TEXT.lowHealthPreview, { "lowhealth" }, { tooltip = TEXT.lowHealthPreviewTip })
    preview:SetPoint("TOPLEFT", 8, top - LOWHEALTH_PREVIEW_Y)
end

-- Your sound files (Sound/Engine.lua) --------------------------------------------------------

local SOUND_ROWS = 12
local VOICE_H = 40 -- the Voice row above the files

-- The voice that speaks (sound.voice, Sound/Voices.lua), with Test, which says a sample in the voice picked.
local function buildVoice(pf, top)
    local Engine = CRT.Sound
    local row = UI.Dropdown(pf, TEXT.voice, {
        options = function()
            return Engine:VoiceChoices()
        end,
        labelWidth = 60,
        width = 200,
        get = function()
            return Engine:VoiceKey()
        end,
        set = function(key)
            CRT.db.sound.voice = key
            refresh()
        end,
    })
    row:SetPoint("TOPLEFT", 10, top)
    controls[#controls + 1] = row

    local test = smallButton(pf, TEXT.voiceTest)
    test:SetWidth(test:GetFontString():GetStringWidth() + 24)
    test:SetPoint("LEFT", row, "RIGHT", 8, 0)
    test:SetScript("OnClick", function()
        -- the alert speech's own path, so text to speech uses the Raid Notes rate and volume
        if CRT.AlertSpeech then
            CRT.AlertSpeech:SpeakNow(TEXT.voiceSample)
            return
        end
        local ok, why = Engine:Speak(TEXT.voiceSample)
        if not ok and why then
            CRT:Print(why)
        end
    end)
    row.test = test
    -- the voices' names and missing words come from the voice table (Sound/Voices.lua)
    UI.HelpRight(test, TEXT.voice, function()
        local parts = { string.format(TEXT.voiceNote, Engine:VoiceNames()) }
        local lacks = Engine:VoiceLacks()
        if lacks ~= "" then
            parts[#parts + 1] = lacks
        end
        parts[#parts + 1] = TEXT.voiceTts
        parts[#parts + 1] = Engine.VOICE_NO_VOLUME
        parts[#parts + 1] = TEXT.voiceLists
        return table.concat(parts, "\n\n")
    end)
end

local function buildSounds(pf, top)
    local Engine = CRT.Sound
    buildVoice(pf, top)
    top = top - VOICE_H
    local heading = pf:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    heading:SetPoint("TOPLEFT", 8, top)
    heading:SetText(TEXT.soundsTitle)
    UI.HelpRight(heading, TEXT.soundsTitle, TEXT.soundsNote)

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
                results[row.file] = played and UI.GoodText("played") or UI.BadText("not found")
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
            media:SetText(string.format(TEXT.soundsMedia, loaded and UI.GoodText("loaded") or (UI.BadText("not installed") .. " (see the (?))")))
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
    UI.HelpRight(heading, TEXT.breakTitle, TEXT.breakNote)

    local also = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    also:SetPoint("TOPLEFT", 8, top - 26)
    also:SetText(TEXT.breakAlso)
    -- The (?) also says, for each format, whether it can be sent from here.
    UI.HelpRight(also, TEXT.breakAlso, function()
        local lines = { TEXT.breakAlsoNote }
        for _, f in ipairs(Formats.FORMATS) do
            local ok, note = Formats.Available(f)
            lines[#lines + 1] = f.label .. ": " .. (ok and (note or "loaded here") or UI.BadText(note))
        end
        return table.concat(lines, "\n\n")
    end)

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
    UI.HelpRight(bridge.label, TEXT.breakBridge, TEXT.breakBridgeNote)

    local preview = UI.PreviewButton(pf, TEXT.breakPreview, { "break" }, { tooltip = TEXT.breakPreviewTip })
    preview:SetPoint("TOPLEFT", 8, y - BREAK_PREVIEW_GAP)
end

-- Battle res (QoL/BattleRes.lua) ----------------------------------------------------------------------

local BREZ_LABEL_W = 120

local function buildBattleRes(pf, top)
    local BattleRes = CRT.BattleRes
    local function brez()
        return CRT.db.qol.battleRes
    end
    local function on()
        return brez().enabled
    end
    local function changed()
        BattleRes:Apply()
        refresh()
    end

    local enable = checkRow(pf, 6, top, TEXT.brezEnable)
    enable:SetScript("OnClick", function(self)
        brez().enabled = self:GetChecked() and true or false
        changed()
    end)
    enable.refresh = function()
        enable:SetChecked(on() and true or false)
    end
    controls[#controls + 1] = enable
    UI.HelpRight(enable.label, TEXT.brezEnable, TEXT.brezNote)

    local show = UI.Dropdown(pf, TEXT.brezShow, {
        options = {
            { key = "boss", label = TEXT.brezBoss },
            { key = "combat", label = TEXT.brezCombat },
            { key = "raid", label = TEXT.brezRaid },
        },
        labelWidth = BREZ_LABEL_W,
        width = 200,
        get = function()
            return brez().show
        end,
        set = function(key)
            brez().show = key
            changed()
        end,
        enabledIf = on,
    })
    show:SetPoint("TOPLEFT", 10, top - 32)
    controls[#controls + 1] = show

    local size = UI.Slider(pf, TEXT.brezSize, {
        min = 50,
        max = 200,
        step = 10,
        onRelease = true,
        labelWidth = BREZ_LABEL_W,
        width = 200,
        format = percent,
        get = function()
            return brez().size or 100
        end,
        set = function(v)
            brez().size = v
            BattleRes:Apply()
        end,
        enabledIf = on,
    })
    size:SetPoint("TOPLEFT", 10, top - 66)
    controls[#controls + 1] = size

    local timer = checkRow(pf, 6, top - 100, TEXT.brezTimer)
    timer:SetScript("OnClick", function(self)
        brez().timer = self:GetChecked() and true or false
        changed()
    end)
    timer.refresh = function()
        local enabled = on() and true or false
        timer:SetChecked(brez().timer and true or false)
        timer:SetEnabled(enabled)
        timer.label:SetFontObject(enabled and CRTFontSmall or CRTFontDisableSmall)
    end
    controls[#controls + 1] = timer

    local preview = UI.PreviewButton(pf, TEXT.brezPreview, { "battleres" }, { tooltip = TEXT.brezPreviewTip })
    preview:SetPoint("TOPLEFT", 8, top - 136)
end

-- Tabs: Low health, Debuffs, Break timer, Battle res and Sounds (the debuff panel, Debuffs/Page.lua). All are only
-- settings and their previews.
local TABS = {
    { key = "lowhealth", label = "Low health" },
    { key = "debuffs", label = "Debuffs" },
    { key = "break", label = "Break timer" },
    { key = "brez", label = "Battle res" },
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

    UI.HelpRight(title, TEXT.title, TEXT.hint)

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
    buildBattleRes(tabFrames.brez, -8)
    buildSounds(tabFrames.sounds, -8)
    selectTab(CRT.db.qol.tab)

    pf:SetScript("OnShow", refresh)
    -- Leaving the page stops any sound being tried out.
    pf:SetScript("OnHide", function()
        CRT.LowHealthSound:StopPreview()
    end)
end

UI:RegisterPage("qol", TEXT.title, build)

-- Opens the page on a tab: "lowhealth", "debuffs" (/crt debuffs), "break", "brez" or "sounds".
CRT.QoLPage = {
    Open = function(key)
        UI:Show("qol")
        selectTab(key)
    end,
}
