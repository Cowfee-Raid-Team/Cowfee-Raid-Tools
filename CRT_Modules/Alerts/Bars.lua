local ADDON, CRT = ...

-- The alert bars: a list of what is coming up, soonest first, each bar with its icon, text, seconds left and
-- a fill that empties as the time nears. It shows your note lines and your reminders (every line whose
-- outputs.bar is on) from the alerts engine. Built on Alerts/Areas.lua; the settings stay in
-- CRT.db.alerts.bars (shown, cap, ahead, width, height, spacing, border, grow, noteLines, font, fontSize, barColor,
-- bgColor, textColor, showType) and open from the area's gear.
-- Spacing is the gap between two bars' borders and Border a line around each bar, outside it, in the theme's
-- outline colour (its darkest, fully opaque, so the edge shows on any fill); a bar's step is its height + spacing + 2 * border, so No border and 0 touch. All three are
-- whole screen pixels (Bars.Metrics), so touching bars leave no seam. A bar is in its ability type's colour (Areas.DrawColor); the Bar,
-- Background and Text colours apply only with Use custom colours on (alerts.customColors), and then a line's own
-- colour still wins over the Bar colour. Off, they stay saved and their rows grey out.
-- With showType on (the default) a bar whose alert has a known ability type shows it after the text: "Hungering Pyre
-- (soak)"; a long text is cut with an ellipsis before the type, so the type and the seconds stay in view.
-- A bar starts full: its fill runs over the time left when it first showed, at most `ahead`.

local Areas = CRT.AlertAreas
local Alerts = CRT.Alerts
local Rules = CRT.AlertRules
local Notes = CRT.Notes

local TEXT = {
    title = "Alert bars",
    ahead = "Show bars from",
    width = "Width",
    height = "Height",
    more = "+%d more",
    font = "Font",
    textSize = "Text size",
    barColor = "Bar colour",
    bgColor = "Background",
    textColor = "Text colour",
    sampleBar = "Sample bar %d",
    testBar = "Test bar %d",
    showType = "Show the ability type",
    showTypeHelp = "Adds the ability's type after its name on a bar, such as Hungering Pyre (soak). A long name is cut short so the type and the seconds stay in view.",
    typeFormat = " (%s)",
    spacing = "Spacing",
    spacingHelp = "The gap between two bars. A border adds to it, so borders never overlap. With No border and 0, the bars touch.",
    border = "Border",
    borderHelp = "A dark line around each bar, in the theme's darkest colour.",
    noBorder = "No border",
    thin = "Thin (1 px)",
    thick = "Thick (2 px)",
}

local ICON_GAP = 4 -- between the icon and the text, and at the edges
local MORE_GAP = 2
-- the saved colours' defaults (CRT_Core/Core.lua), the player's to change, so they don't follow the theme
local DEFAULT_BAR_COLOR = { 0.44, 0.31, 0.22, 1 } -- not a theme colour
local DEFAULT_BG_COLOR = { 0, 0, 0, 0.6 }
local DEFAULT_TEXT_COLOR = { 0.95, 0.90, 0.84, 1 } -- not a theme colour
local DEFAULT_FONT_NAME = "Friz Quadrata"
local DEFAULT_FONT_SIZE = 13
local MIN_FONT, MAX_FONT = 8, 24
local FONT_OUTLINE = "OUTLINE"
local LINE_ALPHA = 0.9 -- the fill of an alert in its own or its type's colour
local SAMPLE_TYPES = { "dispel", "soak", "mythic" } -- the Previews' bars show three ability types' colours
-- The first bar's centre. The old window was centred here, three sample bars tall, so this is its top.
local DEFAULT_POSITION = { point = "CENTER", relativePoint = "CENTER", x = 0, y = 142 }
local SAMPLE_SPELL = 31884
local SAMPLE_TIMES = { 8, 14, 19 }
local SAMPLE_GAP = 1      -- seconds between preview ticks that mean it was turned off
local TEST_SECONDS = 12
local TEST_STEP = 4       -- seconds between the three test bars
local OLD_GAP = 2         -- between bars in the old window
local OLD_PREVIEW_BARS = 3 -- the old window could only be dragged showing its three samples
local POSITION_VERSION = 2
local DEFAULT_SPACING = 4 -- the gap bars had before the setting (Areas.lua's GAP), so nothing moves
local MAX_SPACING = 20
local BORDER_WIDTH = { none = 0, thin = 1, thick = 2 }
local DEFAULT_BORDER = "none" -- bars had no border before the setting
local BORDER_COLOR = "outline" -- the theme's darkest colour, drawn opaque (CRT_Dev/StyleGuide.md)
local BORDER_OPTIONS = {
    { key = "none", label = TEXT.noBorder },
    { key = "thin", label = TEXT.thin },
    { key = "thick", label = TEXT.thick },
}

local UI = CRT.UI
local Bars
local moreText

local function readable(v)
    return CRT.Timeline.readable(v)
end

local function number(v, default)
    return type(v) == "number" and v or default
end

-- The saved position of the old window was its centre, with three sample bars showing. The area saves
-- the first bar's centre, which is (h + OLD_GAP) higher than the old centre when the top is the same; so
-- that is moved once, marked by positionV, and a position saved later is left alone.
local function settings()
    local alerts = Alerts:Settings()
    if not alerts then
        return {}
    end
    alerts.bars = alerts.bars or {}
    local s = alerts.bars
    if s.positionV ~= POSITION_VERSION then
        s.positionV = POSITION_VERSION
        local p = s.position
        if type(p) == "table" and type(p.y) == "number" then
            local h = math.max(8, number(s.height, 20))
            local old = OLD_PREVIEW_BARS * (h + OLD_GAP) - OLD_GAP
            p.y = p.y + old / 2 - h / 2
        end
    end
    return s
end

-- A saved { r, g, b, a } or the default; old saves and edited files may lack it.
local function colorOf(c, default)
    if type(c) == "table" and type(c[1]) == "number" and type(c[2]) == "number" and type(c[3]) == "number" then
        if c[4] ~= nil and type(c[4]) ~= "number" then
            return { c[1], c[2], c[3], default[4] } -- a bad alpha takes the default's
        end
        return c
    end
    return default
end

-- A saved colour of the area, used only with Use custom colours on; the default otherwise.
local function customOf(c, default)
    return Areas.CustomColors() and colorOf(c, default) or default
end

local function fontName(s)
    return type(s.font) == "string" and s.font or DEFAULT_FONT_NAME
end

local function fontSize(s)
    return math.max(MIN_FONT, math.min(MAX_FONT, number(s.fontSize, DEFAULT_FONT_SIZE)))
end

local function aheadOf(s)
    local ahead = number(s.ahead, 20)
    return ahead > 0 and ahead or 20
end

local function spacingOf(s)
    return math.max(0, math.min(MAX_SPACING, number(s.spacing, DEFAULT_SPACING)))
end

local function borderOf(s)
    return BORDER_WIDTH[s.border] and s.border or DEFAULT_BORDER
end

-- A size in UI units rounded to whole screen pixels at `scale` (a frame's effective scale), at least
-- minPixels; as it is where the game's PixelUtil is missing.
local function snap(v, scale, minPixels)
    local P = PixelUtil
    if type(scale) == "number" and scale > 0 and P and P.GetNearestPixelSize then
        local ok, out = pcall(P.GetNearestPixelSize, v, scale, minPixels)
        if ok and type(out) == "number" then
            return out
        end
    end
    return v
end

local function scaleOf(frame)
    return frame and frame.GetEffectiveScale and frame:GetEffectiveScale() or nil
end

-- width, height, spacing, border: a bar's size, the gap between two bars' borders and the border's width,
-- each in whole screen pixels at `scale`. A border is never under one pixel.
local function metrics(s, scale)
    local width = snap(math.max(60, number(s.width, 240)), scale, 1)
    local height = snap(math.max(8, number(s.height, 20)), scale, 1)
    local border = BORDER_WIDTH[borderOf(s)]
    border = border > 0 and snap(border, scale, 1) or 0
    return width, height, snap(spacingOf(s), scale), border
end

-- The border: four textures just outside the bar, the top and bottom across the corners.
local function drawBorder(bar, size)
    if bar.borderSize == size then
        return
    end
    bar.borderSize = size
    local e = bar.edges
    for _, t in ipairs(e) do
        t:ClearAllPoints()
        t:SetShown(size > 0)
    end
    if size <= 0 then
        return
    end
    e[1]:SetPoint("BOTTOMLEFT", bar, "TOPLEFT", -size, 0)
    e[1]:SetPoint("BOTTOMRIGHT", bar, "TOPRIGHT", size, 0)
    e[1]:SetHeight(size)
    e[2]:SetPoint("TOPLEFT", bar, "BOTTOMLEFT", -size, 0)
    e[2]:SetPoint("TOPRIGHT", bar, "BOTTOMRIGHT", size, 0)
    e[2]:SetHeight(size)
    e[3]:SetPoint("TOPRIGHT", bar, "TOPLEFT", 0, 0)
    e[3]:SetPoint("BOTTOMRIGHT", bar, "BOTTOMLEFT", 0, 0)
    e[3]:SetWidth(size)
    e[4]:SetPoint("TOPLEFT", bar, "TOPRIGHT", 0, 0)
    e[4]:SetPoint("BOTTOMLEFT", bar, "BOTTOMRIGHT", 0, 0)
    e[4]:SetWidth(size)
end

local function timeText(remaining)
    if remaining < 10 then
        return format("%.1f", math.max(0, remaining))
    end
    return format("%d", math.floor(remaining))
end

-- " (soak)": the line's main ability type named after its text, whatever colour the bar uses; nil with no known
-- type or with Show the ability type off. The type's key is the word, as the Timeline's ability types are named.
local function typeWord(line, s)
    local Reference = CRT.TimelineReference
    local key = line.abilityType
    if s.showType == false or type(key) ~= "string" or not (Reference and Reference.TYPES[key]) then
        return nil
    end
    return format(TEXT.typeFormat, key)
end

-- What one bar shows. The fill is over the time left when the line first showed, at most `ahead`.
local function row(line, now, ahead, shownAt, s)
    local total = math.min(ahead, line.at - (shownAt or now))
    local fraction = total > 0 and (line.at - now) / total or 0
    local color, from = Areas.DrawColor(line, colorOf(s.barColor, DEFAULT_BAR_COLOR))
    color = color or DEFAULT_BAR_COLOR
    return {
        text = Areas.LineText(line),
        kind = typeWord(line, s),
        time = timeText(line.at - now),
        icon = Areas.LineIcon(line),
        lineColor = from ~= "custom" and color or nil,
        color = color,
        fraction = math.max(0, math.min(1, fraction)),
    }
end

local function make(parent)
    local bar = CreateFrame("Frame", nil, parent)
    bar.bg = bar:CreateTexture(nil, "BACKGROUND")
    bar.bg:SetAllPoints()
    bar.fill = bar:CreateTexture(nil, "ARTWORK")
    bar.icon = bar:CreateTexture(nil, "ARTWORK")
    bar.icon:SetTexCoord(0.07, 0.93, 0.07, 0.93)
    bar.time = bar:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    bar.time:SetPoint("RIGHT", -ICON_GAP, 0)
    bar.time:SetJustifyH("RIGHT")
    bar.time:SetShadowOffset(1, -1)
    bar.text = bar:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    bar.text:SetJustifyH("LEFT")
    bar.text:SetWordWrap(false)
    bar.text:SetShadowOffset(1, -1)
    -- the " (type)" after the text: its own string, so a long text is cut short before it, never the type
    bar.kind = bar:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    bar.kind:SetJustifyH("LEFT")
    bar.kind:SetWordWrap(false)
    bar.kind:SetShadowOffset(1, -1)
    bar.edges = {}
    for i = 1, 4 do
        local t = bar:CreateTexture(nil, "BACKGROUND")
        UI.Tint(t, "SetColorTexture", BORDER_COLOR, 1)
        t:Hide()
        bar.edges[i] = t
    end
    bar.borderSize = 0
    return bar
end

local function draw(bar, line, now, s, shownAt)
    local width, height, _, border = metrics(s, scaleOf(bar))
    drawBorder(bar, border)
    local r = row(line, now, aheadOf(s), shownAt, s)
    local bg = customOf(s.bgColor, DEFAULT_BG_COLOR)
    local tc = customOf(s.textColor, DEFAULT_TEXT_COLOR)
    local size = math.max(1, math.min(fontSize(s), height - 2)) -- text may not outgrow a small bar
    bar.row = r
    bar:SetSize(width, height)
    bar.bg:SetColorTexture(bg[1], bg[2], bg[3], bg[4] or 1)
    Areas.SetFont(bar.time, fontName(s), size, FONT_OUTLINE)
    Areas.SetFont(bar.text, fontName(s), size, FONT_OUTLINE)
    bar.time:SetTextColor(tc[1], tc[2], tc[3], tc[4] or 1)
    bar.text:SetTextColor(tc[1], tc[2], tc[3], tc[4] or 1)

    local left = 0
    bar.icon:SetShown(r.icon ~= nil)
    if r.icon ~= nil then
        bar.icon:ClearAllPoints()
        bar.icon:SetPoint("LEFT")
        bar.icon:SetSize(height, height)
        bar.icon:SetTexture(r.icon)
        left = height
    end

    local fillWidth = (width - left) * r.fraction
    bar.fill:ClearAllPoints()
    bar.fill:SetPoint("LEFT", left, 0)
    bar.fill:SetSize(math.max(fillWidth, 1), height)
    bar.fill:SetColorTexture(r.color[1], r.color[2], r.color[3], r.lineColor and LINE_ALPHA or r.color[4] or 1)
    bar.fill:SetShown(fillWidth > 0)

    bar.time:SetText(r.time)
    bar.text:SetText(r.text)
    bar.kind:SetText(r.kind or "")
    bar.kind:SetShown(r.kind ~= nil)
    bar.kind:SetTextColor(tc[1], tc[2], tc[3], tc[4] or 1)
    Areas.SetFont(bar.kind, fontName(s), size, FONT_OUTLINE)
    -- The text gets what is left after the seconds and the type; past that the game cuts it with an ellipsis.
    local kindWidth = r.kind and bar.kind:GetUnboundedStringWidth() or 0
    local room = width - left - ICON_GAP - bar.time:GetUnboundedStringWidth() - ICON_GAP * 2 - kindWidth
    local textWidth = math.max(1, math.min(bar.text:GetUnboundedStringWidth() + 2, room))
    bar.text:ClearAllPoints()
    bar.text:SetPoint("LEFT", left + ICON_GAP, 0)
    bar.text:SetWidth(textWidth)
    bar.kind:ClearAllPoints()
    bar.kind:SetPoint("LEFT", bar.text, "RIGHT", 0, 0)
end

-- The lines the bars show: those due within `ahead`, soonest first, and how many the cap left out.
local function lines(now, s, cap)
    return Rules.Bars(Alerts:Lines(now), now, aheadOf(s), cap)
end

-- "+N more" under the last bar (above it when they grow up, under the first when they grow sideways).
local function after(area, n, more)
    if not moreText then
        moreText = area.frame:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        moreText:SetJustifyH("LEFT")
        moreText:SetShadowOffset(1, -1)
    end
    if n == 0 or more <= 0 then
        moreText:Hide()
        return
    end
    local s = Bars:Settings()
    local grow = s.grow
    local _, _, _, border = metrics(s, scaleOf(area.frame))
    local gap = MORE_GAP + border -- clear of the bar's border
    moreText:ClearAllPoints()
    if grow == "up" then
        moreText:SetPoint("BOTTOMLEFT", area.pool[n], "TOPLEFT", ICON_GAP, gap)
    elseif grow == "left" or grow == "right" then
        moreText:SetPoint("TOPLEFT", area.pool[1], "BOTTOMLEFT", ICON_GAP, -gap)
    else
        moreText:SetPoint("TOPLEFT", area.pool[n], "BOTTOMLEFT", ICON_GAP, -gap)
    end
    local tc = customOf(s.textColor, DEFAULT_TEXT_COLOR)
    Areas.SetFont(moreText, fontName(s), fontSize(s), FONT_OUTLINE)
    moreText:SetTextColor(tc[1], tc[2], tc[3], tc[4] or 1)
    moreText:SetText(format(TEXT.more, more))
    moreText:Show()
end

-- The samples keep one base time while the preview runs (a gap between calls means it was turned off and
-- on), so the bars run down instead of restarting every tick; they start over, full, once all have passed.
local sampleBase, sampleLast
local sampleCycle = 0 -- ids change each cycle, so every bar starts full again
local function sample(now)
    if not sampleBase or now - sampleLast > SAMPLE_GAP or now > sampleBase + SAMPLE_TIMES[#SAMPLE_TIMES] then
        sampleBase = now
        sampleCycle = sampleCycle + 1
    end
    sampleLast = now
    local info = Notes:SpellInfo(SAMPLE_SPELL)
    local out = {}
    for i, remaining in ipairs(SAMPLE_TIMES) do
        out[i] = {
            id = "sample" .. i .. "#" .. sampleCycle,
            text = i == 1 and info and info.name or format(TEXT.sampleBar, i),
            icon = i == 1 and info and info.icon or nil,
            abilityType = SAMPLE_TYPES[i],
            at = sampleBase + remaining,
        }
    end
    return out
end

local function settingsRows(panel, s)
    local function on()
        return s.shown and true or false
    end
    panel:Slider(TEXT.ahead, {
        min = 5,
        max = 60,
        get = function()
            return aheadOf(s)
        end,
        set = function(value)
            s.ahead = value
        end,
        enabledIf = on,
    })
    panel:Slider(TEXT.width, {
        min = 120,
        max = 400,
        step = 10,
        get = function()
            return number(s.width, 240)
        end,
        set = function(value)
            s.width = value
        end,
        enabledIf = on,
    })
    panel:Slider(TEXT.height, {
        min = 12,
        max = 40,
        get = function()
            return number(s.height, 20)
        end,
        set = function(value)
            s.height = value
        end,
        enabledIf = on,
    })
    panel:Slider(TEXT.spacing, {
        min = 0,
        max = MAX_SPACING,
        get = function()
            return spacingOf(s)
        end,
        set = function(value)
            s.spacing = value
        end,
        enabledIf = on,
        help = TEXT.spacingHelp,
    })
    panel:Dropdown(TEXT.border, {
        options = BORDER_OPTIONS,
        get = function()
            return borderOf(s)
        end,
        set = function(key)
            s.border = key
        end,
        enabledIf = on,
        help = TEXT.borderHelp,
    })
    panel:Dropdown(TEXT.font, {
        options = Areas.FontOptions,
        get = function()
            return fontName(s)
        end,
        set = function(name)
            s.font = name
        end,
        enabledIf = on,
    })
    panel:Slider(TEXT.textSize, {
        min = MIN_FONT,
        max = MAX_FONT,
        get = function()
            return fontSize(s)
        end,
        set = function(value)
            s.fontSize = value
        end,
        enabledIf = on,
    })
    panel:Check(TEXT.showType, function()
        return s.showType ~= false
    end, function(on)
        s.showType = on
    end, TEXT.showTypeHelp)
    -- greyed and unused without Use custom colours; what is saved stays
    local function custom()
        return on() and Areas.CustomColors()
    end
    local function colorRow(label, key, default)
        panel:Color(label, function()
            return colorOf(s[key], default)
        end, function(c)
            s[key] = c
        end, custom)
    end
    colorRow(TEXT.barColor, "barColor", DEFAULT_BAR_COLOR)
    colorRow(TEXT.bgColor, "bgColor", DEFAULT_BG_COLOR)
    colorRow(TEXT.textColor, "textColor", DEFAULT_TEXT_COLOR)
end

Bars = Areas.New({
    key = "bars",
    output = "bar",
    layer = "alertbars",
    title = TEXT.title,
    settingsKey = "bars",
    store = settings,
    defaultPosition = DEFAULT_POSITION,
    make = make,
    draw = draw,
    lines = lines,
    lead = function(_, s)
        return aheadOf(s)
    end,
    after = after,
    space = function(s, frame)
        local _, _, spacing, border = metrics(s, scaleOf(frame))
        return spacing, border
    end,
    sample = sample,
    settings = settingsRows,
})
CRT.AlertBars = Bars
Bars.Metrics = metrics -- for the tests

-- For the tests: one table per bar on screen (text, time, icon, color, fraction), and the count left out.
local widgets = Bars.Visible
function Bars:Visible()
    local out = {}
    for i, w in ipairs(widgets(self)) do
        out[i] = w.row
    end
    return out
end

function Bars:More()
    return self.more
end

-- Three bars counting down from `seconds`, without a run, for trying the bars out by hand (/run).
local baseTest = Bars.Test
local testCount = 0
function Bars:Test(seconds)
    seconds = number(seconds, TEST_SECONDS)
    if seconds <= 0 then
        seconds = TEST_SECONDS
    end
    testCount = testCount + 1
    local now = GetTime()
    local list = {}
    for i = 1, 3 do
        list[i] = { id = "test" .. i .. "#" .. testCount, text = format(TEXT.testBar, i), at = now + seconds + (i - 1) * TEST_STEP }
    end
    baseTest(self, list)
end
