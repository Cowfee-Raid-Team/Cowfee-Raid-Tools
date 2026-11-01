local ADDON, CRT = ...

-- Every setting an alert can have, in one table, and the controls the alert editor (Alerts/Editor.lua) and the Mech
-- Alerts panel (Notes/Reminders.lua) build from it, so a setting changed here changes on both screens.
--   Fields.LIST   one entry per setting: key (the draft's field), tab (the subtab it sits on, Alerts/SubTabs.lua), kind
--                 (check, slider, dropdown, edit, sound, boxes, color, icon, section), label and help (Fields.TEXT),
--                 range (min, max, step) and default, enabledIf(draft, host) and shownIf(draft, host) where the screens
--                 grey or hide it, saved (the reminder field it is saved as), note (its raid note line field, nil when a
--                 line can't carry it) and lives: where it can be kept (reminder, template, note, share).
--   Fields.TEXT   every label and (?) of those settings: the one copy both screens show.
-- Built from it: the Sound and speech tab whole (BuildSound, DrawSound), and When's Show from and Linger (BuildTiming)
-- and Looks' Show as boxes (BuildShowAs). The rest of When and Looks (the times, Text, Icon, Color, the bar's rows) and
-- the Shield bar tab (Alerts/ShieldSection.lua, already one section for both) are each screen's own.
-- Loads after Alerts/SubTabs.lua (the tabs' names). Both screens read the shared words from Fields.TEXT.
-- CRT_Dev/AlertSettings.md is the table as a document, and the crt-alert-settings skill says how to add a setting;
-- run_alert_settings.js checks every key here is in that document.
-- A host is what a screen gives the builders: draft() (the draft on show, or nil), set(fn) (a control's setter: fn
-- edits the draft, then the host saves or redraws), typed(key, text, userInput) (a box was typed in), editDone()
-- (optional: Enter or leaving a box), register(row) (a dropdown or slider redrawn with the host's rows), editable()
-- (optional: false on a read-only note line), kind() (optional: where the draft is kept, "reminder", "template" or
-- "note"; a setting that can't live there is greyed, by its entry's lives; default "reminder"), x and y (the tab's
-- top left), menuH (optional: the Sound menu's height) and onRelease (optional: sliders save when let go).

local UI = CRT.UI
local Reminders = CRT.AlertReminders

local Fields = {}
CRT.AlertFields = Fields

-- Every word of the shared settings. Keep the keys, change the text in quotes, save, /reload.
local TEXT = {
    sound = "Sound",
    none = "None",
    auraSound = "Also when it lands on me",
    auraSoundHelp = "Plays the sound whenever this ability's debuff lands on you, even in combat; the game plays it itself, so it works for hidden boss debuffs. It needs the alert's spell and a sound. If a game sound stays silent, pick a file.\n\nOnly your own alerts have it: a raid note line can't carry it.",
    also = "Also",
    speak = "Speak the text",
    sayInstead = "Say instead",
    sayInsteadHelp = "Words to say in place of the alert's text. Leave it empty to say the text.\n\nRaiders on an older CRT hear the text.",
    count = "Count down from",
    countDownHelp = "Says one number each second, from N down to 1, then the text at 0 when Speak the text is on. Speaks even when Read them out is off.",
    speakAt = "Speak at",
    speakAtHelp = "When the text is said: as the alert shows (On show), at its time (At 0), or a set time before it (Before 0).\n\nWith Count down on, On show and At 0 both say the text after the count, the moment \"1\" ends.",
    onShow = "On show",
    atZero = "At 0",
    beforeZero = "Before 0",
    secondsBefore = "Seconds before",
    halfSeconds = "%g s",
    glow = "Glow at 0",
    showFrom = "Duration",
    showFromHelp = "How long before the specified time this alert should start showing up",
    linger = "Linger",
    seconds = "%d s",
    showAs = "Show as",
    callout = "Note callout/assignments",
    showText = "Critical alerts text",
    showIcon = "Icon",
    bar = "Bar",
    circle = "Circle",
    timeline = "Alert timeline",
    text = "Text",
    icon = "Icon",
    color = "Color",
    ticks = "Impact ticks",
    barFill = "Bar fill",
    countTo = "Count down to",
}
Fields.TEXT = TEXT

-- Show as's boxes by key, in Alerts/Draft.lua SHOW_ROWS order.
Fields.SHOW_LABELS = { alert = TEXT.callout, text = TEXT.showText, icon = TEXT.showIcon, bar = TEXT.bar, circle = TEXT.circle,
    timeline = TEXT.timeline }

local function editable(h)
    return not (h and h.editable) or h.editable() and true or false
end

-- Whether a setting can be kept where the host's draft is (its entry's lives, by the host's kind()).
local function livesHere(key, h)
    local kind = h and h.kind and h.kind() or "reminder"
    local f = Fields.BY_KEY[key]
    return f ~= nil and f.lives ~= nil and f.lives[kind] == true
end

local function speaks(d)
    return d ~= nil and d.speak and true or false
end

local function counts(d)
    return d ~= nil and d.count and true or false
end

-- Also when it lands on me needs the alert's spell, a sound and the game's aura sounds (Sound/Auras.lua), and somewhere
-- that keeps it: your own reminder, never a template or a note line (its entry's lives).
local function auraOK(d, h)
    local Auras = CRT.SoundAuras
    return d ~= nil and livesHere("auraSound", h) and d.spellID ~= nil and CRT.Sound ~= nil and CRT.Sound.Normalize(d.sound) ~= nil
        and Auras ~= nil and Auras:Available() and true or false
end

local function beforeZero(d)
    return d ~= nil and CRT.AlertDraft.SpeakAtKey(d) == "before"
end

local ALL = { reminder = true, template = true, note = true, share = true }
local NO_TEMPLATE = { reminder = true, note = true, share = true }

-- The settings, tab by tab, each tab's rows in the order they show. note: the raid note line's field.
Fields.LIST = {
    -- When
    { key = "warn", tab = "when", kind = "slider", label = TEXT.showFrom, help = TEXT.showFromHelp,
        range = { min = 1, max = 60, step = 1 }, default = 5, saved = "warn", note = "warn:N", lives = ALL,
        meaning = "Seconds before the time the alert starts to show." },
    { key = "linger", tab = "when", kind = "slider", label = TEXT.linger, range = { min = 0, max = 10, step = 1 }, default = 0,
        saved = "linger", note = "linger:N", lives = ALL, meaning = "Seconds the alert stays after 0." },
    -- Looks
    { key = "show", tab = "looks", kind = "boxes", label = TEXT.showAs, default = "alert, bar", saved = "outputs",
        note = "show:alert,text,icon,bar,circle,timeline", lives = ALL,
        meaning = "Where it shows: the note callout, Critical alerts text, Icon, Bar, Circle, Alert timeline." },
    { key = "text", tab = "looks", kind = "edit", label = TEXT.text, default = "the spell's name", saved = "text",
        note = "text:words", lives = ALL, meaning = "What it shows (and says, without Say instead)." },
    { key = "iconID", tab = "looks", kind = "icon", label = TEXT.icon, default = "the spell's icon", saved = "spellID, iconID",
        note = "spellid:N, icon:N", lives = ALL, meaning = "The spell, or an icon's file ID in its place." },
    { key = "color", tab = "looks", kind = "color", label = TEXT.color, default = "the area's colour", saved = "color",
        note = "colors:r g b a", lives = ALL, meaning = "Its colour; your own alert's needs Use custom colours." },
    { key = "ticksText", tab = "looks", kind = "edit", label = TEXT.ticks, default = "none", saved = "ticks", note = "ticks:2,4",
        lives = NO_TEMPLATE, meaning = "Seconds into the bar when each hit lands (Mech Alerts only)." },
    { key = "fill", tab = "looks", kind = "dropdown", label = TEXT.barFill, default = "empties", saved = "fill", note = "fill:up",
        lives = NO_TEMPLATE, meaning = "The bar fills up instead of emptying (Mech Alerts only)." },
    { key = "countTo", tab = "looks", kind = "dropdown", label = TEXT.countTo, default = "the cast", saved = "countTo",
        note = "countto:impact", lives = NO_TEMPLATE, meaning = "The bar's number counts to each hit (Mech Alerts only)." },
    -- Sound and speech
    { key = "sound", tab = "sound", kind = "sound", label = TEXT.sound, default = "none", saved = "sound", note = "sound:name",
        lives = ALL, enabledIf = function(_, h) return editable(h) end, meaning = "A sound played at 0." },
    { key = "auraSound", tab = "sound", kind = "check", label = TEXT.auraSound, help = TEXT.auraSoundHelp, default = false,
        saved = "auraSound", lives = { reminder = true, share = true },
        enabledIf = function(d, h) return editable(h) and auraOK(d, h) end,
        meaning = "The sound also plays when the spell's debuff lands on you." },
    { key = "speak", tab = "sound", kind = "check", label = TEXT.speak, default = true, saved = "speech", note = "tts:1",
        lives = ALL, enabledIf = function(_, h) return editable(h) end, meaning = "Reads the text out." },
    { key = "speakText", tab = "sound", kind = "edit", label = TEXT.sayInstead, help = TEXT.sayInsteadHelp, default = "empty",
        saved = "speakText", note = "say:words", lives = ALL, enabledIf = function(d, h) return editable(h) and speaks(d) end,
        meaning = "Words said in place of the text." },
    { key = "count", tab = "sound", kind = "check", label = TEXT.count, help = TEXT.countDownHelp, default = false,
        saved = "speech", note = "count:1", lives = ALL, enabledIf = function(_, h) return editable(h) end,
        meaning = "Counts down to 0." },
    { key = "countFrom", tab = "sound", kind = "slider", label = TEXT.count, range = Reminders.COUNT_FROM,
        default = Reminders.COUNT_FROM.default, saved = "countFrom", note = "countfrom:N", lives = ALL,
        enabledIf = function(d, h) return editable(h) and counts(d) end, meaning = "The number the count starts from." },
    { key = "speakAt", tab = "sound", kind = "dropdown", label = TEXT.speakAt, help = TEXT.speakAtHelp, default = "On show",
        saved = "speakAt", note = "ttsat:0 (At 0), ttsbefore:N (Before 0)", lives = ALL,
        enabledIf = function(d, h) return editable(h) and speaks(d) end,
        meaning = "When the text is said: On show, At 0 or Before 0." },
    { key = "speakBefore", tab = "sound", kind = "slider", label = TEXT.secondsBefore, range = Reminders.SPEAK_BEFORE,
        default = Reminders.SPEAK_BEFORE.default, saved = "speakBefore", note = "ttsbefore:N", lives = ALL,
        enabledIf = function(d, h) return editable(h) and speaks(d) and beforeZero(d) end,
        shownIf = function(d) return beforeZero(d) end, meaning = "Before 0's seconds before the time." },
    { key = "glow", tab = "sound", kind = "check", label = TEXT.glow, default = false, saved = "glow", note = "glow:1",
        lives = ALL, enabledIf = function(_, h) return editable(h) end, meaning = "The alert glows at 0." },
    -- Shield bar
    { key = "shield", tab = "shield", kind = "section", label = CRT.AlertSubTabs.TEXT.shield, default = "off", saved = "absorb",
        note = "shield:boss2,15,any", lives = ALL, meaning = "The bar shows a boss's absorb shield (Alerts/Absorb.lua)." },
}

Fields.BY_KEY = {}
for _, f in ipairs(Fields.LIST) do
    Fields.BY_KEY[f.key] = f
end

-- Whether a setting is on for the draft on a host (its enabledIf; none: always).
function Fields.Enabled(key, d, h)
    local f = Fields.BY_KEY[key]
    return not (f and f.enabledIf) or f.enabledIf(d, h) and true or false
end

-- The layout of the Sound and speech tab, the alert editor's approved one (Alex, 2026-10-31), from the tab's top left:
-- Sound with its Play button and Speak at beside it, then Also, one box a row: Also when it lands on me (Seconds before
-- beside it, under Speak at, for Before 0), Speak the text, Say instead (indented), Count down from with its slider,
-- Glow at 0. It fits 600 px (the editor) and the Mech Alerts panel's 748.
local S = {
    SOUND_LABEL = 70, SOUND_W = 160, SPEAK_AT_DX = 300, SPEAK_AT_LABEL = 56, SPEAK_AT_W = 104,
    CHECK_DX = 75, ROW = 30, FIRST = 34, INDENT = 26, SAY_DX = 106, SAY_W = 220, BEFORE_INDENT = 16,
    BEFORE_LABEL = 86, BEFORE_W = 110, COUNT_W = 120, CHECK = 24,
}
Fields.SOUND_LAYOUT = S

local function makeCheck(p, label, x, y, onClick)
    local check = CreateFrame("CheckButton", nil, p, "UICheckButtonTemplate")
    check:SetSize(S.CHECK, S.CHECK)
    check:SetPoint("TOPLEFT", x, y)
    local fs = p:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    fs:SetPoint("LEFT", check, "RIGHT", 2, 0)
    fs:SetJustifyH("LEFT")
    fs:SetWordWrap(false)
    fs:SetText(label)
    check.label = fs
    check:SetScript("OnClick", function(self)
        onClick(self:GetChecked() and true or false)
    end)
    return check
end

local function makeLabel(p, text, x, y)
    local fs = p:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    fs:SetPoint("TOPLEFT", x, y)
    fs:SetText(text)
    return fs
end

-- A box of the theme (UI:SkinEditBox), typed into through the host.
local function makeEdit(p, h, key, x, y, width)
    local edit = CreateFrame("EditBox", nil, p, "InputBoxTemplate")
    if UI.SkinEditBox then
        UI:SkinEditBox(edit)
    end
    edit:SetAutoFocus(false)
    edit:SetFontObject(CRTFontEdit)
    edit:SetSize(width, 20)
    edit:SetPoint("TOPLEFT", x, y)
    edit:SetScript("OnTextChanged", function(self, userInput)
        h.typed(key, self:GetText(), userInput)
    end)
    edit:SetScript("OnEnterPressed", function(self)
        if h.editDone then
            h.editDone()
        end
        self:ClearFocus()
    end)
    edit:SetScript("OnEditFocusLost", function()
        if h.editDone then
            h.editDone()
        end
    end)
    edit:SetScript("OnEscapePressed", function(self)
        self:ClearFocus()
    end)
    return edit
end

local function draftOf(h)
    return h.draft()
end

local function setField(h, key)
    return h.set(function(v) h.draft()[key] = v end)
end

-- The Sound and speech tab into p. Returns its controls: sound, speakAt, auraSound, also = { speak, count, glow },
-- sayInstead, countFrom, speakBefore, each named as the hosts always had them.
function Fields.BuildSound(p, h)
    local Draft = CRT.AlertDraft
    local x, y = h.x, h.y
    local c = {}
    local B = Fields.BY_KEY
    c.sound = UI.SoundDropdown(p, TEXT.sound, {
        labelWidth = S.SOUND_LABEL, width = S.SOUND_W, maxHeight = h.menuH, playButton = true,
        enabledIf = function() return Fields.Enabled("sound", draftOf(h), h) end,
        options = function() return Draft.SoundOptions(TEXT.none) end,
        get = function() local d = draftOf(h) return d and Draft.SoundKey(d.sound) or Draft.NO_SOUND end,
        set = h.set(function(v) h.draft().sound = v ~= Draft.NO_SOUND and v or nil end),
    })
    c.sound:SetPoint("TOPLEFT", x, y)
    h.register(c.sound)
    c.speakAt = UI.Dropdown(p, TEXT.speakAt, {
        labelWidth = S.SPEAK_AT_LABEL, width = S.SPEAK_AT_W,
        enabledIf = function() return Fields.Enabled("speakAt", draftOf(h), h) end,
        options = function() return Draft.SpeakAtOptions(TEXT.onShow, TEXT.atZero, TEXT.beforeZero) end,
        get = function() return Draft.SpeakAtKey(draftOf(h)) end,
        set = h.set(function(v) Draft.SetSpeakAt(h.draft(), v) end),
    })
    c.speakAt:SetPoint("TOPLEFT", x + S.SPEAK_AT_DX, y)
    h.register(c.speakAt)
    UI.HelpRight(c.speakAt, TEXT.speakAt, B.speakAt.help)

    local cx, row1 = x + S.CHECK_DX, y - S.FIRST
    local function rowY(n)
        return row1 - (n - 1) * S.ROW
    end
    makeLabel(p, TEXT.also, x, row1 - 6)
    c.auraSound = makeCheck(p, TEXT.auraSound, cx, rowY(1), setField(h, "auraSound"))
    UI.HelpRight(c.auraSound.label, TEXT.auraSound, B.auraSound.help)
    c.speakBefore = UI.Slider(p, TEXT.secondsBefore, {
        min = B.speakBefore.range.min, max = B.speakBefore.range.max, step = B.speakBefore.range.step,
        labelWidth = S.BEFORE_LABEL, width = S.BEFORE_W, onRelease = h.onRelease,
        enabledIf = function() return Fields.Enabled("speakBefore", draftOf(h), h) end,
        format = function(v) return string.format(TEXT.halfSeconds, v) end,
        get = function() local d = draftOf(h) return d and d.speakBefore or B.speakBefore.default end,
        set = setField(h, "speakBefore"),
    })
    c.speakBefore:SetPoint("TOPLEFT", x + S.SPEAK_AT_DX + S.BEFORE_INDENT, rowY(1))
    h.register(c.speakBefore)
    -- Say instead, indented under Speak the text, in a row of its own before Count down from
    c.also = {
        speak = makeCheck(p, TEXT.speak, cx, rowY(2), setField(h, "speak")),
        count = makeCheck(p, TEXT.count, cx, rowY(4), setField(h, "count")),
        glow = makeCheck(p, TEXT.glow, cx, rowY(5), setField(h, "glow")),
    }
    makeLabel(p, TEXT.sayInstead, cx + S.INDENT, rowY(3) - 4)
    c.sayInstead = makeEdit(p, h, "speakText", cx + S.SAY_DX, rowY(3), S.SAY_W)
    UI.HelpRight(c.sayInstead, TEXT.sayInstead, B.speakText.help)
    c.countFrom = UI.Slider(p, "", {
        min = B.countFrom.range.min, max = B.countFrom.range.max, step = B.countFrom.range.step, labelWidth = 0,
        width = S.COUNT_W, onRelease = h.onRelease,
        enabledIf = function() return Fields.Enabled("countFrom", draftOf(h), h) end,
        get = function() local d = draftOf(h) return d and d.countFrom or B.countFrom.default end,
        set = setField(h, "countFrom"),
    })
    c.countFrom:SetPoint("LEFT", c.also.count.label, "RIGHT", 6, 0)
    h.register(c.countFrom)
    UI.HelpRight(c.countFrom, TEXT.count, B.count.help)
    return c
end

-- The Sound and speech tab from the draft: the boxes ticked and greyed, Say instead greyed with Speak the text off,
-- Seconds before shown only for Before 0. Its dropdowns and sliders redraw with the host's rows (their enabledIf).
-- The Say instead box's text is the host's to fill (Fields.FillSound), so typing in it is never undone.
function Fields.DrawSound(c, h)
    local d = draftOf(h)
    if not (c and d) then
        return
    end
    local on = editable(h)
    for key, check in pairs(c.also) do
        check:SetChecked(d[key] and true or false)
        check:SetEnabled(on)
    end
    local aura = Fields.Enabled("auraSound", d, h)
    c.auraSound:SetChecked(d.auraSound and true or false)
    c.auraSound:SetEnabled(aura)
    local v = aura and 1 or 0.5
    c.auraSound.label:SetTextColor(v, v, v)
    c.sayInstead:SetEnabled(Fields.Enabled("speakText", d, h))
    c.speakBefore:SetShown(Fields.BY_KEY.speakBefore.shownIf(d, h))
end

-- The tab's boxes (Say instead) from the draft, on open or another row picked. put(edit, text) (optional) is the
-- host's own way to fill a box, such as one that leaves a box being typed in alone; default SetText.
function Fields.FillSound(c, d, put)
    if c and c.sayInstead then
        local text = d and d.speakText or ""
        if put then
            put(c.sayInstead, text)
        else
            c.sayInstead:SetText(text)
        end
    end
end

-- When's Show from and Linger sliders into p at x, y (Linger at lingerX), each from its entry. Returns both.
function Fields.BuildTiming(p, h, x, y, lingerX)
    local B = Fields.BY_KEY
    local function seconds(v)
        return string.format(TEXT.seconds, v)
    end
    local function slider(key, labelWidth, tip)
        local f = B[key]
        local s = UI.Slider(p, f.label, {
            min = f.range.min, max = f.range.max, step = f.range.step, labelWidth = labelWidth, width = 150,
            format = seconds, onRelease = h.onRelease, enabledIf = h.editable,
            tipTitle = tip and f.label or nil, tipText = tip and f.help or nil,
            get = function() local d = draftOf(h) return d and d[key] or f.default end,
            set = setField(h, key),
        })
        h.register(s)
        return s
    end
    local showFrom, linger = slider("warn", 70, true), slider("linger", 50, false)
    showFrom:SetPoint("TOPLEFT", x, y)
    linger:SetPoint("TOPLEFT", lingerX, y)
    return showFrom, linger
end

-- Looks' Show as boxes into p, one per Draft.SHOW_ROWS key, all at x, y: the host lays them out (Draft.FlowShowAs).
-- Returns them by key, each with its label.
function Fields.BuildShowAs(p, h, x, y)
    local checks = {}
    for _, keys in ipairs(CRT.AlertDraft.SHOW_ROWS) do
        for _, key in ipairs(keys) do
            checks[key] = makeCheck(p, Fields.SHOW_LABELS[key], x, y, h.set(function(on) h.draft().show[key] = on end))
        end
    end
    return checks
end

-- Where a setting can live, as the document's words: Reminder, Template, Note line, Share code.
local LIVES = { { "reminder", "Reminder" }, { "template", "Template" }, { "note", "Note line" }, { "share", "Share code" } }

-- The settings as a markdown table (CRT_Dev/AlertSettings.md is made from it: run_alert_settings.js table).
function Fields.Table()
    local out = { "| Key | Tab | Meaning | Range | Default | Lives in | Note line |", "|---|---|---|---|---|---|---|" }
    for _, f in ipairs(Fields.LIST) do
        local range = f.range and string.format("%g to %g, step %g", f.range.min, f.range.max, f.range.step) or ""
        local lives = {}
        for _, l in ipairs(LIVES) do
            if f.lives and f.lives[l[1]] then
                lives[#lives + 1] = l[2]
            end
        end
        local tab = CRT.AlertSubTabs.TEXT[f.tab] or f.tab
        out[#out + 1] = string.format("| `%s` | %s | %s | %s | %s | %s | %s |", f.key, tab, f.meaning or "", range,
            tostring(f.default), table.concat(lives, ", "), f.note and ("`" .. f.note .. "`") or "none")
    end
    return table.concat(out, "\n")
end
