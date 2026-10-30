local ADDON, CRT = ...

-- The note callout ("Note callout/assignments" on screen): a movable alert that appears only when a timer
-- with your name (or your role) is coming up, shows the spell or text with a countdown, and can read it out
-- with text to speech. Its settings are CRT.db.notes.alert; how it looks and speaks is set on Raid Notes >
-- Alert Settings > Configuration, whose panel (Alerts/Areas.lua) shows Alert.PanelEntry's rows (below).

local Notes = CRT.Notes
local Engine = CRT.NoteEngine
local Alert = {}
CRT.NoteAlert = Alert

-- Every word the callout and its settings show, in one place so the wording is easy to change.
local TEXT = {
    title = "Note callout/assignments",
    drag = "%s: drag to move",
    sample = "Your spell",
    early = "Show it early by",
    earlyHelp = "How many seconds before its time each of your note lines shows. It counts for every place your note lines go, not only here.",
    font = "Font",
    addonFont = "Addon font",
    size = "Size",
    outline = "Outline",
    align = "Align",
    left = "Left",
    right = "Right",
    above = "Above",
    below = "Below",
    icon = "Spell icon",
    speech = "Read them out (text to speech)",
    speechHelp = "The same switch as Read them out under Your note lines go to: ticking or unticking one ticks or unticks the other.\n\n"
        .. "On, your note lines are read out wherever they show, here included. Off, nothing is read out, your reminders included.\n\n"
        .. "The rows under it set when, how loud and how fast.",
    readAt = "Read it at",
    readAtValue = "%ds left",
    volume = "Speech volume",
    rate = "Speech rate",
    testSpeech = "Test speech",
    testPhrase = "Cowfee Raid Tools. Avenging Wrath in three.",
}

local REFRESH_SECONDS = 0.1
local ICON_GAP = 8 -- between the icon and the text
local LINE_GAP = 2 -- between the name and the countdown
local MIN_SIZE, MAX_SIZE, DEFAULT_SIZE = 10, 60, 20
-- Each alignment: where the name sits in the two lines' block, and the countdown under it.
local ALIGN_POINTS = {
    LEFT = { "TOPLEFT", "BOTTOMLEFT" },
    CENTER = { "TOP", "BOTTOM" },
    RIGHT = { "TOPRIGHT", "BOTTOMRIGHT" },
}

local frame, handle, icon, block, label, countdown
local handleText -- the drag box's title
local handleMin -- the drag box's least width: its whole title and Reset
local DEFAULT_POSITION = { point = "CENTER", relativePoint = "CENTER", x = 3, y = 113 } -- Alex's layout, under the critical alerts text
local previewOn = false
local elapsed = 0

local function settings()
    return Notes:Alert()
end

-- The look -----------------------------------------------------------------------------------

local function fontSize(s)
    local size = type(s.fontSize) == "number" and s.fontSize or DEFAULT_SIZE
    return math.max(MIN_SIZE, math.min(MAX_SIZE, size))
end

local function alignOf(s)
    return ALIGN_POINTS[s.align] and s.align or "CENTER"
end

-- The face the addon's own large text is drawn in, for "Addon font" (the "default" font) and a shared font
-- that is gone, so it follows General Settings' font and the theme. Nil before the addon's fonts exist.
local function addonFontPath()
    local large = _G.CRTFontLarge
    return large and large.GetFont and (large:GetFont()) or nil
end

local lookAlign -- the alignment last applied, so a refresh that changes nothing sets nothing

-- Sets the font, size and outline on both lines (Alerts/Areas.lua SetFont, which skips an unchanged font),
-- and the alignment when it changed. Returns the look's key.
local function applyLook()
    local s = settings()
    local Areas = CRT.AlertAreas
    local size, align, fallback = fontSize(s), alignOf(s), addonFontPath()
    local outline = Areas.OUTLINES[s.outline] and s.outline or ""
    Areas.SetFont(label, s.font, size, outline, fallback)
    Areas.SetFont(countdown, s.font, size, outline, fallback)
    if align ~= lookAlign then
        lookAlign = align
        local points = ALIGN_POINTS[align]
        label:SetJustifyH(align)
        countdown:SetJustifyH(align)
        label:ClearAllPoints()
        label:SetPoint(points[1])
        countdown:ClearAllPoints()
        countdown:SetPoint(points[1], label, points[2], 0, -LINE_GAP)
    end
    return tostring(s.font) .. "|" .. size .. "|" .. outline .. "|" .. align .. "|" .. tostring(fallback)
end

-- Text to speech is the alerts speech queue; the callout's Test speech button (below) speaks through here.
function Alert:Speak(text)
    CRT.AlertSpeech:SpeakNow(text)
end

-- The alert -------------------------------------------------------------------------------

-- Wide enough for the whole title left of the gear and Reset, and at least as wide as the alert. Measured
-- again whenever Previews turn on, so a font change applies.
local function measureHandle()
    if not (handle and handleText) then
        return
    end
    local titleWidth = handleText.GetUnboundedStringWidth and handleText:GetUnboundedStringWidth() or handleText:GetStringWidth()
    local P = CRT.UI.Placement
    handleMin = math.ceil(6 + titleWidth + 4 + P.GEAR_SIZE + P.GEAR_GAP + CRT.UI.ResetButtonWidth() + 2)
    handle:SetWidth(math.max(handleMin, frame and frame:GetWidth() or 0))
end

-- Lays the alert out: the name and the countdown centered under each other, and the icon, two text
-- lines tall, on the side chosen in its settings (Spell icon). The alert is kept centered on its
-- saved position, so it grows evenly as the name changes.
local function layout()
    local nameHeight = select(2, label:GetFont()) or 18
    local timeHeight = select(2, countdown:GetFont()) or 18
    local height = math.floor(nameHeight + LINE_GAP + timeHeight + 0.5)
    local width = math.max(label:GetStringWidth(), countdown:GetStringWidth(), 20)
    block:SetSize(width, height)
    icon:SetSize(height, height)

    icon:ClearAllPoints()
    block:ClearAllPoints()
    local position = settings().iconPosition or "left"
    if not icon:IsShown() then
        block:SetPoint("CENTER")
        frame:SetSize(width, height)
    elseif position == "right" then
        block:SetPoint("LEFT")
        icon:SetPoint("LEFT", block, "RIGHT", ICON_GAP, 0)
        frame:SetSize(width + ICON_GAP + height, height)
    elseif position == "above" then
        icon:SetPoint("TOP")
        block:SetPoint("TOP", icon, "BOTTOM", 0, -ICON_GAP / 2)
        frame:SetSize(math.max(width, height), height * 2 + ICON_GAP / 2)
    elseif position == "below" then
        block:SetPoint("TOP")
        icon:SetPoint("TOP", block, "BOTTOM", 0, -ICON_GAP / 2)
        frame:SetSize(math.max(width, height), height * 2 + ICON_GAP / 2)
    else
        icon:SetPoint("LEFT")
        block:SetPoint("LEFT", icon, "RIGHT", ICON_GAP, 0)
        frame:SetSize(height + ICON_GAP + width, height)
    end
    if handle and handleMin then
        handle:SetWidth(math.max(handleMin, frame:GetWidth() or 0))
    end
end

-- What the alert last drew, so a refresh that changes nothing skips the work.
local drawn

local function show(iconTexture, text, time, color)
    local look = applyLook()
    local key = tostring(iconTexture) .. "|" .. text .. "|" .. time .. "|" .. (color and table.concat(color, ",") or "") .. "|" .. tostring(settings().iconPosition) .. "|" .. look
    if key == drawn and frame:IsShown() then
        return
    end
    drawn = key
    icon:SetShown(iconTexture ~= nil)
    if iconTexture then
        icon:SetTexture(iconTexture)
    end
    -- raid marker codes ({cross}) as their icons, as tall as the text (CRT_Core/MarkerText.lua)
    label:SetText(CRT.MarkerText and CRT.MarkerText(text) or text)
    if color then
        label:SetTextColor(color[1], color[2], color[3])
    else
        label:SetTextColor(CRT.UI.Color("heading"))
    end
    countdown:SetText(time)
    layout()
    frame:Show()
end

-- The alert's colour, as every alert display draws it: a colour of its own when it may show (a raid note line's
-- always, yours with Use custom colours on: Alerts:OwnColor), else its ability type's (Alerts/Colors.lua). Nil
-- (the heading colour) when neither is known.
local function lineColor(line)
    local Alerts, Colors = CRT.Alerts, CRT.AlertColors
    local own = Alerts.OwnColor and Alerts:OwnColor(line)
    if own then
        return own
    end
    return Colors and Colors.KnownTypeColor(line.abilityType) or nil
end

local function countdownText(remaining)
    if remaining <= 0 then
        return "NOW"
    elseif remaining < 10 then
        return format("%.1fs", remaining)
    end
    return math.floor(remaining) .. "s"
end

function Alert:Refresh()
    if not frame then
        return
    end
    handle:SetShown(previewOn)
    -- The alert: the engine's line inside its warn and hold window, soonest first, on the engine's time
    -- (a rehearsal's clock in one). With Previews on, a run's alert (a Test's too) shows in place of the
    -- sample while it is due, and the sample the rest of the time, so the drag box stays.
    local s = settings()
    local best, now
    if s.enabled and CRT.Alerts.running then
        now = CRT.Alerts.Now and CRT.Alerts:Now() or GetTime()
        best = CRT.AlertRules.Alert(CRT.Alerts:Lines(now), now)
    end
    if not best then
        if previewOn then
            local info = Notes:SpellInfo(31884)
            show(info and info.icon or 134400, info and info.name or TEXT.sample, "5.0s")
        else
            frame:Hide()
        end
        return
    end
    local remaining = best.at - now
    if best.block == "note" and type(best.spellID) == "number" and not best.ownLabel then
        -- A note's spell line shows the spell's own name, as it always did. A line with show:
        -- (ownLabel) shows its own text, icon and colour below, like a reminder.
        local info = Notes:SpellInfo(best.spellID)
        show(info and info.icon or best.icon, info and info.name or best.text or ("Spell " .. best.spellID), countdownText(remaining),
            lineColor(best))
    else
        -- Any other line (a reminder, or a merged "Soak + Defensive") shows its own text, with the
        -- spell's icon when the line has none of its own.
        local icon = best.icon
        if icon == nil and type(best.spellID) == "number" then
            local info = Notes:SpellInfo(best.spellID)
            icon = info and info.icon
        end
        show(icon, best.text or "", countdownText(remaining), lineColor(best))
    end
end

local build

-- Its place, drag, nudge, reset and anchor are the shared helper's (UI/Placement.lua); its gear's Settings open
-- Raid Notes > Alert Settings on the callout.
local placement = CRT.UI.Placement.Define("notecallout", {
    title = TEXT.title,
    store = settings,
    default = DEFAULT_POSITION,
    build = function()
        build()
    end,
    settings = function()
        if CRT.NoteAlertsTab then
            CRT.NoteAlertsTab.Select("callout")
        end
        if CRT.NotesPage then
            CRT.NotesPage.Open("alerts")
        end
    end,
})

function Alert:ResetPosition()
    placement:Reset()
end

function build()
    if frame then
        return
    end
    frame = CreateFrame("Frame", "CowfeeRaidToolsNoteAlert", UIParent)
    frame:SetSize(320, 56)
    CRT.UI:RegisterLayer("alert", frame)
    frame:SetClampedToScreen(true)

    icon = frame:CreateTexture(nil, "ARTWORK")
    icon:SetTexCoord(0.07, 0.93, 0.07, 0.93)

    -- The two text lines, centered under each other in their own frame.
    block = CreateFrame("Frame", nil, frame)
    label = block:CreateFontString(nil, "OVERLAY", "CRTFontLarge")
    label:SetPoint("TOP")
    label:SetJustifyH("CENTER")
    label:SetWordWrap(false)
    label:SetShadowOffset(1, -1)

    countdown = block:CreateFontString(nil, "OVERLAY", "CRTFontLarge")
    countdown:SetPoint("TOP", label, "BOTTOM", 0, -LINE_GAP)
    countdown:SetJustifyH("CENTER")
    countdown:SetTextColor(1, 1, 1)
    countdown:SetShadowOffset(1, -1)

    handle = CreateFrame("Frame", nil, frame, "BackdropTemplate")
    handle:SetHeight(20)
    handle:SetPoint("BOTTOM", frame, "TOP", 0, 2)
    handle:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    CRT.UI.Tint(handle, "SetBackdropColor", "surface", 0.9) -- the theme's field colour under its heading-coloured edge
    CRT.UI.Tint(handle, "SetBackdropBorderColor", "heading")
    local text = handle:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    text:SetPoint("LEFT", 6, 0)
    text:SetText(format(TEXT.drag, TEXT.title))
    handle.reset = CRT.UI.ResetButton(handle, function()
        Alert:ResetPosition()
    end)
    handle.reset:SetPoint("RIGHT", -2, 0)
    handleText = text
    measureHandle()
    handle:Hide()
    frame:Hide()
    -- Held by its center, so the alert grows evenly around where you put it.
    handle.gear = placement:Attach(frame, handle, { reset = handle.reset })
end

-- The alert hides itself when there is nothing to show, so this frame keeps it updated.
local ticker = CreateFrame("Frame")
ticker:SetScript("OnUpdate", function(_, dt)
    elapsed = elapsed + dt
    if elapsed < REFRESH_SECONDS then
        return
    end
    elapsed = 0
    if frame then
        Alert:Refresh()
    end
end)
ticker:RegisterEvent("PLAYER_LOGIN")
ticker:SetScript("OnEvent", function()
    build()
end)

-- A theme switch draws the alert again on its next update, so a line with no colour of its own takes the
-- new heading colour.
CRT.UI:OnTheme(function()
    drawn = nil
    lookAlign = nil
end)

-- Its settings on Raid Notes > Alert Settings > Configuration ----------------------------------

local ICON_OPTIONS = {
    { key = "left", label = TEXT.left },
    { key = "right", label = TEXT.right },
    { key = "above", label = TEXT.above },
    { key = "below", label = TEXT.below },
}

local function set(field)
    return function(value)
        Notes:Set("alert", field, value)
    end
end

local function speechOn()
    return settings().tts and true or false
end

-- The callout's rows, added with the panel's row helpers (Alerts/Areas.lua): when it shows, its look, then
-- whether it is read out and how. s is CRT.db.notes.alert.
local function panelRows(panel, s)
    panel:Slider(TEXT.early, {
        min = 1, max = 60, help = TEXT.earlyHelp,
        format = function(v) return (v or 0) .. "s" end,
        get = function() return s.seconds or 10 end,
        set = set("seconds"),
    })
    panel:Dropdown(TEXT.font, {
        -- read each time the menu opens, so fonts another addon shares later appear
        options = function() return CRT.AlertAreas.FontOptions(TEXT.addonFont) end,
        get = function() return s.font or "default" end,
        set = set("font"),
    })
    panel:Slider(TEXT.size, {
        min = MIN_SIZE, max = MAX_SIZE,
        get = function() return fontSize(s) end,
        set = set("fontSize"),
    })
    panel:Dropdown(TEXT.outline, {
        options = CRT.AlertAreas.OUTLINE_OPTIONS,
        get = function() return CRT.AlertAreas.OUTLINES[s.outline] and s.outline or "" end,
        set = set("outline"),
    })
    panel:Dropdown(TEXT.align, {
        options = CRT.AlertAreas.ALIGN_OPTIONS,
        get = function() return alignOf(s) end,
        set = set("align"),
    })
    panel:Dropdown(TEXT.icon, {
        options = ICON_OPTIONS,
        get = function() return s.iconPosition or "left" end,
        set = set("iconPosition"),
    })
    panel:Check(TEXT.speech, function() return s.tts end, set("tts"), TEXT.speechHelp)
    panel:Slider(TEXT.readAt, {
        min = 0, max = 30, enabledIf = speechOn,
        format = function(v) return format(TEXT.readAtValue, v or 0) end,
        get = function() return s.ttsSeconds or 3 end,
        set = set("ttsSeconds"),
    })
    panel:Slider(TEXT.volume, {
        min = 0, max = 100, enabledIf = speechOn,
        format = function(v) return (v or 0) .. "%" end,
        get = function() return s.ttsVolume or 100 end,
        set = set("ttsVolume"),
    })
    -- the game's speech rate, -10 (slow) to 10 (fast)
    panel:Slider(TEXT.rate, {
        min = -10, max = 10, enabledIf = speechOn,
        format = function(v) return (v or 0) > 0 and ("+" .. v) or tostring(v or 0) end,
        get = function() return s.ttsRate or 0 end,
        set = set("ttsRate"),
    })
    panel:Button(TEXT.testSpeech, function()
        Alert:Speak(TEXT.testPhrase)
    end, speechOn)
end

-- What the Configuration panel shows for the callout, shaped like an alert area (Areas.Panel): its rows,
-- without the areas' Show these alerts, At once and Grow (the callout is turned on and off under Your note
-- lines go to, and shows one line at a time).
Alert.PanelEntry = {
    def = { key = "callout", noCommon = true, settings = panelRows },
    Settings = function()
        return settings()
    end,
    Refresh = function()
        Alert:Refresh()
    end,
}

CRT.UI:RegisterPreview("alert", function(on)
    build()
    if on then
        measureHandle()
    end
    previewOn = on and true or false
    Alert:Refresh()
    if not previewOn and not Engine.running then
        frame:Hide()
    end
end)

-- The Addon check's Note callout column (CRT_Core/AddonCheck.lua): on while the callout is enabled. Nil in a
-- harness that loads this file alone.
if CRT.AddonCheck then
    CRT.AddonCheck:Register({ key = "callout", label = "Note callout", order = 20, on = function()
        return CRT.db.notes.alert.enabled ~= false
    end })
end
