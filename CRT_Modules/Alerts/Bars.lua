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
-- A bar starts full: its fill runs over the time left when it first showed, at most `ahead`. The area redraws
-- the bars every 0.1 s; in between, the fill, the seconds and the ticks' fade move every frame (animate).
-- Impact ticks: any line may carry ticks = { s, ... }, seconds after its cast (the line's `at`) when each impact
-- lands. Each is a thin line on the bar in the theme's text colour, placed on the fill's time scale, so the fill
-- reaches it as that impact lands; one already passed fades. A tick at either end is drawn TICK_INSET inside the
-- bar, so it shows. A special alert's bar with ticks only (barTo "last") runs TICK_TAIL past the last one, so every
-- tick sits inside it; its barTo = "cast" (a boss file's choice) ends it at the cast instead.
-- barEnd (seconds after the cast) ends it there instead, and barStart (seconds after the cast) is when the
-- bar appears: its fill then runs over barEnd - barStart, not over `ahead`: a bar of its own (a special alert's
-- bar = { start, length, ticks }, Alerts/Special.lua; a reminder's bar with ticks, from its Show from to the cast,
-- Alerts/Reminders.lua BarTicks). Ticks never move a bar of its own: one off it is not drawn.
-- A bar counts its seconds to its end; with countTo = "impact" a bar with ticks counts to the next impact on it
-- (0 as it lands), then to its end. A bar with ticks that starts
-- before its cast draws a faint cast line there, so it reads: the cast, then the impacts.
-- Only the bars read these; the callout, speech and the other areas keep the cast's time.
-- fill = "up" makes a line's bar fill up from empty as its time nears instead of emptying (any other value, or
-- none: it empties, as every bar did before); its ticks still sit where the fill's edge is at each impact.
-- Shield bars (a special alert's absorb): Alerts/Absorb.lua hands them out and drawAbsorb below draws them, the fill
-- the shield left, the tick and seconds its time left; the item that opens its window draws no bar of its own.

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
-- The second sample is a special alert's bar, so its fill up and impact ticks can be seen and placed: it
-- shows from the cycle's start, its cast SAMPLE_CAST seconds in, filling up over 8 s with impacts 4.5 and 6.5 s in.
local SAMPLE_CAST = 3
local SAMPLE_SPAN = { barStart = -3, barEnd = 5, ticks = { 1.5, 3.5 }, fill = "up" }
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
local TICK_COLOR = "text"  -- an impact tick, in the theme's text colour
local TICK_WIDTH = 2
local TICK_PASSED_ALPHA = 0.3 -- a tick whose impact has landed
local TICK_INSET = 2 -- a tick at either end of the bar is drawn this many pixels inside it, so it shows
local TICK_TAIL = Rules.TICK_TAIL -- seconds a bar ending at its last impact runs past it (1 s)
local CAST_LINE_WIDTH = 1 -- the cast's own line on a bar that starts before it: thinner and fainter than a tick
local CAST_LINE_ALPHA = 0.45
local ABSORB_TEXTURE = "Interface\\Buttons\\WHITE8X8" -- a shield bar's fill, tinted with SetStatusBarColor
local ABSORB_REDRAW = 0.1 -- seconds at least between two readings drawn on a shield bar
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

-- A line's impact ticks and bar span (see the top of this file), as seconds after its cast: the ticks in order,
-- where the bar ends and where it starts (nil: as any bar, when it first shows). Nil for a line with none.
local function span(line)
    local list = {}
    if type(line.ticks) == "table" then
        for _, t in ipairs(line.ticks) do
            if type(t) == "number" and t == t and t > -math.huge and t < math.huge then
                list[#list + 1] = t
            end
        end
    end
    local start = type(line.barStart) == "number" and line.barStart or nil
    local finish = type(line.barEnd) == "number" and line.barEnd or nil
    if #list == 0 and not start and not finish then
        return nil
    end
    table.sort(list)
    if not finish then
        finish = (line.barTo ~= "cast" and #list > 0) and math.max(0, list[#list] + TICK_TAIL) or 0
    end
    if start and start >= finish then
        start = nil -- a bar that would end before it starts shows as any bar
    end
    return list, finish, start
end

-- The lines as the bars draw them: a line with ticks or a span copied with `at` moved to where its bar ends,
-- castAt (its cast), tickAt (each impact's time) and barFrom (when its bar appears, or nil). Made once per
-- engine lines table (Alerts:Lines hands out the same one until something changes), never per frame.
local barCache = setmetatable({}, { __mode = "k" })
local function barLines(src)
    if #src == 0 then
        return src, false -- no run hands out a new empty table each time: nothing to keep
    end
    local done = barCache[src]
    if done then
        return done.lines, done.starts
    end
    local out, starts = src, false
    for i, line in ipairs(src) do
        -- a shield bar's item only opens its window: Alerts/Absorb.lua hands out its bar (lines, below)
        local ticks, finish, start
        if not line.absorb then
            ticks, finish, start = span(line)
        end
        if ticks or line.absorb then
            if out == src then
                out = {}
                for j = 1, i - 1 do
                    out[j] = src[j]
                end
            end
        end
        if ticks then
            local c = {}
            for k, v in pairs(line) do
                c[k] = v
            end
            c.castAt = line.at
            c.at = line.at + finish
            c.tickAt = {}
            for j, t in ipairs(ticks) do
                c.tickAt[j] = line.at + t
            end
            c.barFrom = start and line.at + start or nil
            starts = starts or start ~= nil
            out[#out + 1] = c
        elseif out ~= src and not line.absorb then
            out[#out + 1] = line
        end
    end
    barCache[src] = { lines = out, starts = starts }
    return out, starts
end

-- Where each tick sits on the bar, 0 (the left end) to 1 (the right): the fill's edge at the moment its impact
-- lands, emptying or filling up (up), so the edge reaches it then. Ticks off the bar (before it showed) are left out.
local function tickMarks(line, now, total, up)
    if type(line.tickAt) ~= "table" or not (total and total > 0) then
        return nil
    end
    local out = {}
    for _, at in ipairs(line.tickAt) do
        local pos = (line.at - at) / total
        if pos >= 0 and pos <= 1 then
            out[#out + 1] = { pos = up and 1 - pos or pos, at = at, passed = now >= at }
        end
    end
    return #out > 0 and out or nil
end

-- Where the cast sits on a bar that starts before it and ends after it (0 to 1, as tickMarks), else nil.
local function castMark(line, total, up)
    if type(line.castAt) ~= "number" or not (total and total > 0) then
        return nil
    end
    local pos = (line.at - line.castAt) / total
    if pos <= 0 or pos >= 1 then
        return nil
    end
    return up and 1 - pos or pos
end

-- The moment a bar's seconds count to: its end (the cast, for a reminder's bar), or, with countTo = "impact", its
-- next impact on the bar, else (no ticks, or all landed) its end. tickAt is in order.
local function countTo(line, now)
    if line.countTo ~= "impact" then
        return line.at
    end
    for _, at in ipairs(type(line.tickAt) == "table" and line.tickAt or {}) do
        if at >= now and at <= line.at then
            return at
        end
    end
    return line.at
end

-- What one bar shows. The fill is over the time left when the line first showed, at most `ahead`; a bar with
-- its own start (barFrom) fills over its own length.
local function row(line, now, ahead, shownAt, s)
    local total
    if line.barFrom then
        total = line.at - line.barFrom
    else
        total = math.min(ahead, line.at - (shownAt or now))
    end
    local fraction = math.max(0, math.min(1, total > 0 and (line.at - now) / total or 0))
    local up = line.fill == "up"
    local color, from = Areas.DrawColor(line, colorOf(s.barColor, DEFAULT_BAR_COLOR))
    color = color or DEFAULT_BAR_COLOR
    return {
        text = Areas.LineText(line),
        kind = typeWord(line, s),
        time = timeText(countTo(line, now) - now),
        icon = Areas.LineIcon(line),
        lineColor = from ~= "custom" and color or nil,
        color = color,
        fraction = fraction, -- the time left, over the bar's time
        fill = up and "up" or "down",
        filled = up and 1 - fraction or fraction, -- how much of the bar is filled
        ticks = tickMarks(line, now, total, up),
        cast = castMark(line, total, up), -- where the cast's line sits, or nil
        total = total, -- the bar's time, kept for animate
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

-- A line of width w, full height, centred on pos (0 to 1) of the fill's room, kept TICK_INSET inside either end.
local function placeLine(bar, t, pos, left, room, w, height)
    local inset = math.min(TICK_INSET, math.max(0, (room - w) / 2))
    local x = math.max(left + inset, math.min(left + room - w - inset, left + room * pos - w / 2))
    t:ClearAllPoints()
    t:SetPoint("TOPLEFT", bar, "TOPLEFT", x, 0)
    t:SetSize(w, height)
end

-- The impact ticks: one thin line per tick, full height, at the fill's edge for that moment; faded once passed.
-- Made on first need and kept with the bar.
local function drawTicks(bar, marks, left, room, height)
    bar.tickLines = bar.tickLines or {}
    local pool = bar.tickLines
    local w = snap(TICK_WIDTH, scaleOf(bar), 1)
    local n = marks and #marks or 0
    for i = 1, n do
        local t = pool[i]
        if not t then
            t = bar:CreateTexture(nil, "OVERLAY")
            UI.Tint(t, "SetColorTexture", TICK_COLOR, 1)
            pool[i] = t
        end
        local m = marks[i]
        placeLine(bar, t, m.pos, left, room, w, height)
        t:SetAlpha(m.passed and TICK_PASSED_ALPHA or 1)
        t:Show()
    end
    for i = n + 1, #pool do
        pool[i]:Hide()
    end
end

-- The cast's line (row.cast): one faint 1 px line in the text colour where the cast is, on a bar that starts before
-- it, so the bar reads cast, then impacts. Made on first need and kept with the bar.
local function drawCastLine(bar, pos, left, room, height)
    local t = bar.castLine
    if not pos then
        if t then
            t:Hide()
        end
        return
    end
    if not t then
        t = bar:CreateTexture(nil, "OVERLAY")
        UI.Tint(t, "SetColorTexture", TICK_COLOR, CAST_LINE_ALPHA)
        bar.castLine = t
    end
    placeLine(bar, t, pos, left, room, snap(CAST_LINE_WIDTH, scaleOf(bar), 1), height)
    t:Show()
end

-- Shield bars (Alerts/Absorb.lua): a line whose absorb is its shield's state. The fill is a StatusBar over the bar's
-- room, given the shield's readings as they came: its first as the maximum (SetMinMaxValues), each later one
-- (SetValue), at most once per ABSORB_REDRAW seconds. The amount on the left is AbbreviateNumbers' text of the last
-- reading through SetText, blank when that fails or in a Test. The readings may be secret, so nothing else
-- touches them: no compare, no sum, no measure of the amount's width. The tick is the time left, from the right
-- end to the left over the bar's length, and the seconds on the right count it down, both on CRT's clock. The
-- colour is the bar's usual one and never changes. Its texts and tick sit on the StatusBar, above its fill.

-- The status bar and its texts, made on first need and kept with the bar.
local function absorbParts(bar)
    local a = bar.absorbParts
    if a then
        return a
    end
    local sb = CreateFrame("StatusBar", nil, bar)
    sb:SetStatusBarTexture(ABSORB_TEXTURE)
    a = { sb = sb }
    for _, k in ipairs({ "amount", "label", "time" }) do
        local fs = sb:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
        fs:SetWordWrap(false)
        fs:SetShadowOffset(1, -1)
        a[k] = fs
    end
    a.amount:SetJustifyH("LEFT")
    a.label:SetJustifyH("CENTER")
    a.time:SetJustifyH("RIGHT")
    a.tick = sb:CreateTexture(nil, "OVERLAY")
    UI.Tint(a.tick, "SetColorTexture", TICK_COLOR, 1)
    bar.absorbParts = a
    return a
end

-- The amount's text for a shield's last reading: AbbreviateNumbers' (perhaps secret) text, or "" when it can't be had.
local function amountText(st)
    if st.sample or type(AbbreviateNumbers) ~= "function" then
        return ""
    end
    local ok, text = pcall(AbbreviateNumbers, st.value)
    if ok then
        return text
    end
    return ""
end

-- What a shield bar shows that moves: the tick (the time left over its length, 1 the right end), its seconds, and a new
-- reading on its fill and amount. Part of its draw and run every frame in between, as animate.
local function animateAbsorb(bar, now)
    local line, r, a = bar.line, bar.row, bar.absorbParts
    local st = line.absorb
    local sb = a.sb
    if bar.absorbState ~= st then
        bar.absorbState, bar.absorbSeq, bar.absorbDrawn = st, nil, nil
        pcall(sb.SetMinMaxValues, sb, 0, st.max)
    end
    if bar.absorbSeq ~= st.seq and not (bar.absorbDrawn and now >= bar.absorbDrawn and now - bar.absorbDrawn < ABSORB_REDRAW) then
        bar.absorbSeq, bar.absorbDrawn = st.seq, now
        pcall(sb.SetValue, sb, st.value)
        pcall(a.amount.SetText, a.amount, amountText(st))
    end
    local left = math.max(0, math.min(st.length, st.at + st.length - now))
    local pos = left / st.length
    placeLine(bar, a.tick, pos, bar.fillLeft, bar.fillRoom, snap(TICK_WIDTH, scaleOf(bar), 1), bar.fillHeight)
    local t = timeText(left)
    if t ~= bar.absorbTime then
        bar.absorbTime = t
        a.time:SetText(t)
    end
    r.time, r.tick = t, pos
end

-- A shield bar's row: its text, icon and colour as any bar's, the seconds and tick as animateAbsorb moves them.
local function absorbRow(line, now, s)
    local color, from = Areas.DrawColor(line, colorOf(s.barColor, DEFAULT_BAR_COLOR))
    color = color or DEFAULT_BAR_COLOR
    local st = line.absorb
    local left = math.max(0, math.min(st.length, st.at + st.length - now))
    return {
        absorb = true,
        text = Areas.LineText(line),
        icon = Areas.LineIcon(line),
        lineColor = from ~= "custom" and color or nil,
        color = color,
        time = timeText(left),
        tick = left / st.length,
        total = st.length,
    }
end

-- Draws a shield bar on the room right of the icon; the plain bar's own fill, texts and ticks are hidden.
local function drawAbsorb(bar, line, r, now, s, left, width, height, size, tc)
    bar.fill:Hide()
    bar.text:Hide()
    bar.time:Hide()
    bar.kind:Hide()
    drawTicks(bar, nil, left, width - left, height)
    drawCastLine(bar, nil)
    local a = absorbParts(bar)
    local sb = a.sb
    sb:ClearAllPoints()
    sb:SetPoint("TOPLEFT", bar, "TOPLEFT", left, 0)
    sb:SetPoint("BOTTOMRIGHT", bar, "BOTTOMRIGHT", 0, 0)
    sb:SetStatusBarColor(r.color[1], r.color[2], r.color[3], r.lineColor and LINE_ALPHA or r.color[4] or 1)
    for _, k in ipairs({ "amount", "label", "time" }) do
        Areas.SetFont(a[k], fontName(s), size, FONT_OUTLINE)
        a[k]:SetTextColor(tc[1], tc[2], tc[3], tc[4] or 1)
    end
    a.amount:ClearAllPoints()
    a.amount:SetPoint("LEFT", sb, "LEFT", ICON_GAP, 0)
    a.time:ClearAllPoints()
    a.time:SetPoint("RIGHT", sb, "RIGHT", -ICON_GAP, 0)
    -- the label in the middle, in the third of the room the amount and the seconds leave it
    a.label:SetText(r.text)
    a.label:ClearAllPoints()
    a.label:SetPoint("CENTER", sb, "CENTER", 0, 0)
    a.label:SetWidth(math.max(1, math.min(a.label:GetUnboundedStringWidth() + 2, (width - left) / 3)))
    bar.line, bar.row = line, r
    bar.fillLeft, bar.fillRoom, bar.fillHeight = left, width - left, height
    animateAbsorb(bar, now)
    sb:Show()
end

-- What moves with time on a bar: its fill, its seconds and its ticks' fade, from what its last draw kept (the
-- line, its row, the fill's room). Part of every draw, and run every frame in between (the area's def.move), so
-- the fill moves smoothly; a handful of calls per bar, and the seconds' text only when it changes.
local function animate(bar, now)
    local line, r = bar.line, bar.row
    if not (line and r) then
        return
    end
    if r.absorb then
        animateAbsorb(bar, now)
        return
    end
    local total = r.total
    local fraction = math.max(0, math.min(1, total > 0 and (line.at - now) / total or 0))
    local filled = r.fill == "up" and 1 - fraction or fraction
    r.fraction, r.filled = fraction, filled
    local fillWidth = bar.fillRoom * filled
    bar.fill:SetWidth(math.max(fillWidth, 1))
    bar.fill:SetShown(fillWidth > 0)
    local t = timeText(countTo(line, now) - now)
    if t ~= bar.timeShown then
        bar.timeShown = t
        bar.time:SetText(t)
    end
    r.time = t
    local marks, pool = r.ticks, bar.tickLines
    if marks and pool then
        for i, m in ipairs(marks) do
            local passed = now >= m.at
            if passed ~= m.passed then
                m.passed = passed
                pool[i]:SetAlpha(passed and TICK_PASSED_ALPHA or 1)
            end
        end
    end
end

local function draw(bar, line, now, s, shownAt)
    local width, height, _, border = metrics(s, scaleOf(bar))
    drawBorder(bar, border)
    local shield = type(line.absorb) == "table"
    local r = shield and absorbRow(line, now, s) or row(line, now, aheadOf(s), shownAt, s)
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
    if shield then
        drawAbsorb(bar, line, r, now, s, left, width, height, size, tc)
        return
    end
    if bar.absorbParts then
        bar.absorbParts.sb:Hide()
    end
    bar.text:Show()
    bar.time:Show()

    bar.fill:ClearAllPoints()
    bar.fill:SetPoint("LEFT", left, 0)
    bar.fill:SetHeight(height)
    bar.fill:SetColorTexture(r.color[1], r.color[2], r.color[3], r.lineColor and LINE_ALPHA or r.color[4] or 1)
    drawTicks(bar, r.ticks, left, width - left, height)
    drawCastLine(bar, r.cast, left, width - left, height)
    bar.line, bar.fillRoom = line, width - left
    animate(bar, now) -- the fill's width and the seconds

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
-- A line with its own start (barFrom) waits for it.
local function lines(now, s, cap)
    local list, starts = barLines(Alerts:Lines(now))
    if starts then
        local due = {}
        for _, line in ipairs(list) do
            if not (line.barFrom and now < line.barFrom) then
                due[#due + 1] = line
            end
        end
        list = due
    end
    local out, more = Rules.Bars(list, now, aheadOf(s), cap)
    -- the shield bars going now (Alerts/Absorb.lua) come first, whatever Show bars from says
    local Absorb = CRT.AlertAbsorb
    local shields = Absorb and Absorb:Lines(now)
    if not (shields and #shields > 0) then
        return out, more
    end
    local all = {}
    for _, line in ipairs(shields) do
        all[#all + 1] = line
    end
    for _, line in ipairs(out) do
        all[#all + 1] = line
    end
    local kept = {}
    for i = 1, math.min(cap, #all) do
        kept[i] = all[i]
    end
    return kept, more + #all - #kept
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
        if i == 2 then
            out[i].at = sampleBase + SAMPLE_CAST
            for k, v in pairs(SAMPLE_SPAN) do
                out[i][k] = v
            end
        end
    end
    return (barLines(out))
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
    move = animate,
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
Bars.Span = span

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
