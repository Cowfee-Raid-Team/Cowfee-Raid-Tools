local ADDON, CRT = ...

-- The timeline area: a thin line (the track) with each alert's spell icon sliding along it toward the end, the
-- countdown on the icon, the ability's name beside it, small Encounter Journal icons (tank, healer, dispel,
-- Mythic...) when the boss data has them, and a diamond tick with its seconds (5 s by default). At 0 the icon
-- plays a NOW effect: Flash and fade, Ring burst, a text pop, Slide off, or None. It shows every line whose
-- outputs.timeline is on (the alert editor's and Mech Alerts' Timeline box, and Raid Notes > Alerts' routing of
-- your note lines). This is CRT's own area; the Mode (Standalone, Add to the game's boss timeline, Replace the game's
-- timeline) is Alerts/GameTimeline.lua's, and its rows come last in these settings.
-- Built on Alerts/Areas.lua with its own layout (def.layout): the area is the track's box, centred on the saved
-- position, and the widgets (one icon each, pooled) are placed along it. Settings: CRT.db.alerts.areas.timeline
-- (defaults in CRT_Core/Core.lua): direction (down, up, left, right: where the icons go), side (right or left of a
-- vertical line, above or below a sideways one: the names), length, seconds (on the line), size, thickness,
-- lineColor (only with Use custom colours on; else the theme's accent), showNames, showCountdown, tenths (seconds
-- shown in tenths under this many; 0 off), badges, ticks (a list of seconds, "5" or "3,5"), nowEffect, nowText,
-- nowTime (how long the NOW effect lasts), stack, font, fontSize, beside the common shown and cap.
-- Colours as on the bars (Areas.DrawColor): the icon's 1 px edge and its name are in the ability type's colour,
-- a raid note line's own colour always wins and yours with Use custom colours on; the edge turns white in the
-- last 3 seconds. The Areas ticker redraws every 0.1 s; between those, one OnUpdate moves the icons smoothly, set
-- only while something is on the track. The Journal is never read here: the indicator icons are the tags
-- Alerts/Colors.lua stamped on each item at the pull, from the boss's ability timeline and the Journal rows the
-- Timeline already read (Journal:CachedRows).
--   Timeline.Offset(direction, d, across) -> anchor, x, y: where a point d px from the line's end sits, across px
--                     to the side (the names' side is positive), as SetPoint("CENTER", area.frame, anchor, x, y)
--   Timeline.Effect(kind, t, duration) -> alpha, flash, ring, ringScale, popScale: a NOW effect t seconds after 0
--   Timeline.Seconds(s) -> the seconds on the line, 5 to 60
--   Timeline.Ticks(s) -> the tick seconds shown on the line, in order
--   Timeline.Badges(line) -> the line's Journal icons (Reference.TAG_ORDER keys) in the Journal's order

local Areas = CRT.AlertAreas
local Alerts = CRT.Alerts

local TEXT = {
    title = "Alert timeline",
    direction = "Direction",
    down = "Down",
    up = "Up",
    left = "Left",
    right = "Right",
    side = "Names on",
    above = "Above",
    below = "Below",
    length = "Line length",
    seconds = "Seconds on the line",
    size = "Icon size",
    thickness = "Line thickness",
    lineColor = "Line colour",
    showNames = "Show the names",
    showCountdown = "Show the countdown",
    tenths = "Tenths under",
    off = "Off",
    badges = "Indicator icons",
    badgesHelp = "Small icons beside the name from the Encounter Journal: tank, healer, dispel, Mythic and the rest. They show only when the boss's ability timeline or the Journal has them for that spell.",
    ticks = "Tick marks",
    noTicks = "None",
    nowEffect = "NOW effect",
    flash = "Flash and fade",
    ring = "Ring burst",
    pop = "Text pop",
    slide = "Slide off",
    none = "None",
    nowText = "NOW text",
    nowTime = "NOW lasts",
    stack = "Stack icons that overlap",
    stackHelp = "Moves an icon to the side when it would cover another one, so both stay readable.",
    font = "Font",
    textSize = "Text size",
    seconds1 = "%d s",
    halfSeconds = "%.1f s",
    tick = "%d",
    sampleRaid = "Raid damage",
    sampleSoak = "Soak",
    sampleDispel = "Dispel",
}

-- Tune the look in game here.
local MEDIA = CRT.MEDIA or ("Interface\\AddOns\\" .. ADDON .. "\\CRT_Media\\Media\\") -- the fallback is for test harnesses without Core.lua
local RING_TEXTURE = MEDIA .. "RingThin"    -- the Ring burst, a 256 px white ring (see Circles.lua)
local DIAMOND_TEXTURE = MEDIA .. "Diamond"  -- the tick marks, a 32 px white diamond
local QUESTION_ICON = "Interface\\Icons\\INV_Misc_QuestionMark" -- an alert with no icon
-- Right of the screen's middle, clear of the other areas' default places (run_alerts_layout.js checks).
local DEFAULT_POSITION = { point = "CENTER", relativePoint = "CENTER", x = 420, y = -40 }
-- The defaults, as in CRT_Core/Core.lua: the approved mockup's look.
local DEFAULTS = { direction = "down", side = "right", length = 300, seconds = 10, size = 32, thickness = 2,
    tenths = 0, ticks = "5", nowEffect = "flash", nowText = "NOW!", nowTime = 1, font = "Friz Quadrata", fontSize = 14 }
local LIMITS = { -- min, max, step of each slider
    length = { 120, 600, 10 }, seconds = { 5, 60, 1 }, size = { 20, 64, 1 }, thickness = { 1, 6, 1 },
    tenths = { 0, 5, 1 }, nowTime = { 0.5, 3, 0.5 }, fontSize = { 10, 24, 1 },
}
local TRIM = { 0.07, 0.93, 0.07, 0.93 }
local EDGE = 1             -- the icon's coloured edge
local WHITE_EDGE = 3       -- seconds left from which the edge is white
local LABEL_GAP = 5        -- between the icon, its Journal icons and its name
local LANE_GAP = 4         -- between stacked icons
local MAX_LANES = 2        -- the line's own and one beside it; a third overlapping icon shares the first
local MAX_BADGES = 4
local TICK_SIZE = 10
local TICK_GAP = 3
local MAX_TICKS = 6
local OUTLINE = "OUTLINE"
local FLASH_PART = 0.4     -- of the NOW time: the white flash is gone by then
local RING_GROW = 2.5      -- the ring's size at the end, in icon sizes
local POP_SCALE, POP_GROW, POP_HOLD = 1.6, 0.2, 0.5 -- the text pop grows to this over the first part, fades after the hold
local WHITE = { 1, 1, 1 }  -- the countdown, the flash and the last seconds' edge: not a theme colour
local SAMPLE_GAP = 1       -- seconds between preview ticks that mean it was turned off
-- The Previews: three icons of three types, at these parts of the line, with Journal icons.
local SAMPLES = {
    { text = TEXT.sampleRaid, icon = 136243, abilityType = "raid", abilityTags = { "healer" }, part = 0.35 },
    { text = TEXT.sampleSoak, icon = 135808, abilityType = "soak", abilityTags = { "tank", "mythic" }, part = 0.65 },
    { text = TEXT.sampleDispel, icon = 136116, abilityType = "dispel", abilityTags = { "healer", "magic" }, part = 0.95 },
}

-- Each direction: the point of the area the line ends at, whether the line is upright, and which way from the
-- end the icons come (+1 up or right of it, -1 down or left).
local DIRS = {
    down = { anchor = "BOTTOM", vertical = true, sign = 1 },
    up = { anchor = "TOP", vertical = true, sign = -1 },
    left = { anchor = "LEFT", vertical = false, sign = 1 },
    right = { anchor = "RIGHT", vertical = false, sign = -1 },
}
local DIRECTION_OPTIONS = {
    { key = "down", label = TEXT.down }, { key = "up", label = TEXT.up },
    { key = "left", label = TEXT.left }, { key = "right", label = TEXT.right },
}
local EFFECT_OPTIONS = {
    { key = "flash", label = TEXT.flash }, { key = "ring", label = TEXT.ring }, { key = "pop", label = TEXT.pop },
    { key = "slide", label = TEXT.slide }, { key = "none", label = TEXT.none },
}
local EFFECTS = { flash = true, ring = true, pop = true, slide = true, none = true }
local NOW_TEXT_OPTIONS = {
    { key = "NOW!", label = "NOW!" }, { key = "NOW", label = "NOW" }, { key = "GO!", label = "GO!" }, { key = "0", label = "0" },
}
local TICK_OPTIONS = {
    { key = "", label = TEXT.noTicks }, { key = "5", label = "5 s" }, { key = "3,5", label = "3 and 5 s" },
    { key = "5,10", label = "5 and 10 s" }, { key = "3,5,10", label = "3, 5 and 10 s" }, { key = "10", label = "10 s" },
}

local Timeline = {}
local EMPTY = {}
local badgeCache = setmetatable({}, { __mode = "k" }) -- a line's tags table -> its Journal icons in order

local function clamp(v, key)
    local l = LIMITS[key]
    v = type(v) == "number" and v or DEFAULTS[key]
    return math.max(l[1], math.min(l[2], v))
end

local function dirOf(s)
    return DIRS[s.direction] and s.direction or DEFAULTS.direction
end

-- The names' side: "left" or "below" puts them on the negative side (left of an upright line, under a sideways
-- one), anything else on the positive side.
local function namesPositive(s)
    return not (s.side == "left" or s.side == "below")
end

local function effectOf(s)
    return EFFECTS[s.nowEffect] and s.nowEffect or DEFAULTS.nowEffect
end

-- How long a line stays after 0: its NOW effect's time, none with None.
local function afterZero(s)
    return effectOf(s) == "none" and 0 or clamp(s.nowTime, "nowTime")
end

local function fontName(s)
    return type(s.font) == "string" and s.font or DEFAULTS.font
end

local function nowText(s)
    return type(s.nowText) == "string" and s.nowText ~= "" and s.nowText or DEFAULTS.nowText
end

-- The line's colour: yours with Use custom colours on, else the theme's accent, read as it draws.
local function lineColor(s)
    local c = s.lineColor
    if Areas.CustomColors() and type(c) == "table" and type(c[1]) == "number" and type(c[2]) == "number" and type(c[3]) == "number" then
        return c
    end
    return CRT.PALETTE and CRT.PALETTE.accent or WHITE
end

-- The time the area draws on: Previews and tests on real time, a run on the engine's (a rehearsal's clock),
-- Previews or not (Area:DrawsRun).
local function clockOf(area)
    if not area:DrawsRun() or not Alerts.Now then
        return GetTime()
    end
    return Alerts:Now()
end

function Timeline.Offset(direction, d, across)
    local dir = DIRS[direction] or DIRS[DEFAULTS.direction]
    if dir.vertical then
        return dir.anchor, across, dir.sign * d
    end
    return dir.anchor, dir.sign * d, across
end

-- Before 0 (t < 0): fully shown, no effect. After it, over `duration` seconds: Flash and fade whitens the icon and
-- fades it; Ring burst grows a ring out of it as both fade; the text pop grows the NOW text, holds, then fades;
-- Slide off fades as the icon runs on past the end (the caller moves it); None is gone at once.
function Timeline.Effect(kind, t, duration)
    if t < 0 then
        return 1, 0, 0, 1, 1
    end
    if kind == "none" then
        return 0, 0, 0, 1, 1
    end
    local p = (type(duration) == "number" and duration > 0) and math.min(1, t / duration) or 1
    if kind == "ring" then
        return 1 - p, 0, 1 - p, 1 + (RING_GROW - 1) * p, 1
    elseif kind == "pop" then
        local alpha = p < POP_HOLD and 1 or (1 - (p - POP_HOLD) / (1 - POP_HOLD))
        return alpha, 0, 0, 1, 1 + (POP_SCALE - 1) * math.min(1, p / POP_GROW)
    elseif kind == "slide" then
        return 1 - p, 0, 0, 1, 1
    end
    return 1 - p, math.max(0, 1 - p / FLASH_PART), 0, 1, 1
end

-- The seconds on the line (5 to 60). The game's timeline is sent lines this far ahead too (Alerts/GameTimeline.lua).
function Timeline.Seconds(s)
    return clamp(s.seconds, "seconds")
end

function Timeline.Ticks(s)
    local text = type(s.ticks) == "string" and s.ticks or DEFAULTS.ticks
    local window = clamp(s.seconds, "seconds")
    local out, seen = {}, {}
    for word in text:gmatch("[%d%.]+") do
        local n = tonumber(word)
        if n and n > 0 and n <= window and not seen[n] then
            seen[n] = true
            out[#out + 1] = n
        end
    end
    table.sort(out)
    while #out > MAX_TICKS do
        table.remove(out)
    end
    return out
end

function Timeline.Badges(line)
    local tags = line.abilityTags
    local Reference = CRT.TimelineReference
    if type(tags) ~= "table" or not Reference then
        return EMPTY
    end
    local cached = badgeCache[tags]
    if cached then
        return cached
    end
    local set = {}
    for _, key in ipairs(tags) do
        set[key] = true
    end
    local out = {}
    for _, key in ipairs(Reference.TAG_ORDER) do
        if set[key] and Reference.TAGS[key] then
            out[#out + 1] = key
        end
    end
    badgeCache[tags] = out
    return out
end

-- A widget: the icon with its edge, the countdown, the flash and ring of the NOW effects, the popping NOW text,
-- the name and the Journal icons. Made once per pool slot.
local function make(parent)
    local w = CreateFrame("Frame", nil, parent)
    w.edge = w:CreateTexture(nil, "BACKGROUND")
    w.edge:SetPoint("TOPLEFT", w, "TOPLEFT", -EDGE, EDGE)
    w.edge:SetPoint("BOTTOMRIGHT", w, "BOTTOMRIGHT", EDGE, -EDGE)
    w.icon = w:CreateTexture(nil, "ARTWORK")
    w.icon:SetAllPoints(w)
    w.icon:SetTexCoord(TRIM[1], TRIM[2], TRIM[3], TRIM[4])
    w.flash = w:CreateTexture(nil, "OVERLAY")
    w.flash:SetAllPoints(w)
    w.flash:SetColorTexture(WHITE[1], WHITE[2], WHITE[3], 1)
    w.flash:SetAlpha(0)
    w.ring = w:CreateTexture(nil, "OVERLAY")
    w.ring:SetPoint("CENTER", w, "CENTER", 0, 0)
    w.ring:SetTexture(RING_TEXTURE)
    w.ring:Hide()
    w.count = w:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    w.count:SetPoint("CENTER", w, "CENTER", 0, 0)
    w.count:SetTextColor(WHITE[1], WHITE[2], WHITE[3])
    w.count:SetShadowOffset(1, -1)
    -- the popping text sits on a frame of its own, scaled around the icon's centre
    w.pop = CreateFrame("Frame", nil, w)
    w.pop:SetSize(1, 1)
    w.pop:SetPoint("CENTER", w, "CENTER", 0, 0)
    w.popText = w.pop:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    w.popText:SetPoint("CENTER", w.pop, "CENTER", 0, 0)
    w.popText:SetShadowOffset(1, -1)
    w.pop:Hide()
    w.name = w:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    w.name:SetWordWrap(false)
    w.name:SetShadowOffset(1, -1)
    w.badges = {}
    for i = 1, MAX_BADGES do
        local b = w:CreateTexture(nil, "OVERLAY")
        b:Hide()
        w.badges[i] = b
    end
    return w
end

-- What a line shows, set every redraw (0.1 s); where it is and the countdown are set by place, every frame.
local function draw(w, line, now, s)
    local size = clamp(s.size, "size")
    local textSize = clamp(s.fontSize, "fontSize")
    local font = fontName(s)
    w:SetSize(size, size)
    w.line = line
    local icon = Areas.LineIcon(line) or QUESTION_ICON
    if w.iconKey ~= icon then
        w.iconKey = icon
        w.icon:SetTexture(icon)
    end
    local c = Areas.DrawColor(line) or WHITE
    w.color = c
    w.edgeWhite = nil -- painted again by place
    Areas.SetFont(w.count, font, math.max(8, math.floor(size * 0.45)), OUTLINE)
    Areas.SetFont(w.popText, font, math.max(10, math.floor(size * 0.5)), OUTLINE)
    w.popText:SetText(nowText(s))
    w.popText:SetTextColor(c[1], c[2], c[3])
    w.ring:SetVertexColor(c[1], c[2], c[3])
    Areas.SetFont(w.name, font, textSize, OUTLINE)
    w.name:SetText(Areas.ShownText(line))
    w.name:SetTextColor(c[1], c[2], c[3])
    w.name:SetShown(s.showNames ~= false)
    local list = s.badges ~= false and Timeline.Badges(line) or EMPTY
    local TAGS = CRT.TimelineReference and CRT.TimelineReference.TAGS or EMPTY
    local n = 0
    for i = 1, MAX_BADGES do
        local b, key = w.badges[i], list[i]
        if key and TAGS[key] then
            n = i
            if b.key ~= key then
                b.key = key
                b:SetAtlas(TAGS[key].atlas)
            end
            b:SetSize(textSize, textSize)
            b:Show()
        else
            b:Hide()
        end
    end
    w.badgeCount = n
end

-- The countdown on the icon: whole seconds, rounded up, or tenths under the tenths setting, rounded down so it
-- never reads the threshold itself (2.96 under 3 is 2.9, not 3.0).
local function countdown(remaining, s)
    local tenths = clamp(s.tenths, "tenths")
    if tenths > 0 and remaining < tenths then
        return format("%.1f", math.floor(remaining * 10) / 10)
    end
    return tostring(math.ceil(remaining))
end

local function setCount(w, text)
    if w.countText ~= text then
        w.countText = text
        w.count:SetText(text)
    end
end

-- The edge: the line's colour, white in the last seconds. Painted only when it changes.
local function paintEdge(w, white)
    if w.edgeWhite ~= white then
        w.edgeWhite = white
        local c = white and WHITE or w.color or WHITE
        w.edge:SetColorTexture(c[1], c[2], c[3], 1)
    end
end

-- Where a widget is at `now`, its countdown and its NOW effect. Run every frame while the line has icons.
local function place(area, w, now, s, direction)
    local line = w.line
    local remaining = line.at - now
    local window, length = clamp(s.seconds, "seconds"), clamp(s.length, "length")
    local effect = effectOf(s)
    local d = 0
    if remaining >= 0 then
        d = math.min(remaining, window) / window * length
    elseif effect == "slide" then
        d = remaining / window * length -- on past the end
    end
    local anchor, x, y = Timeline.Offset(direction, d, w.across or 0)
    w:ClearAllPoints()
    w:SetPoint("CENTER", area.frame, anchor, x, y)
    if remaining > window then
        w:SetAlpha(0) -- not on the line yet (a test or preview line further out)
        return
    end
    local alpha, flash, ring, ringScale, popScale = Timeline.Effect(effect, -remaining, clamp(s.nowTime, "nowTime"))
    w:SetAlpha(alpha)
    w.flash:SetAlpha(flash)
    if ring > 0 then
        local size = clamp(s.size, "size") * ringScale
        w.ring:SetSize(size, size)
        w.ring:SetAlpha(ring)
        w.ring:Show()
    else
        w.ring:Hide()
    end
    if remaining > 0 then
        setCount(w, s.showCountdown ~= false and countdown(remaining, s) or "")
        w.pop:Hide()
    else
        setCount(w, "")
        w.pop:SetShown(effect == "pop")
        if effect == "pop" then
            w.pop:SetScale(popScale)
        end
    end
    paintEdge(w, remaining <= WHITE_EDGE)
end

-- The name and the Journal icons beside the icon, on the names' side (sidePositive), placed again only when that
-- side, the count of Journal icons or their size changed.
local function placeLabels(w, vertical, sidePositive, badgeSize)
    local n = w.badgeCount or 0
    local key = tostring(vertical) .. tostring(sidePositive) .. n .. "|" .. badgeSize
    if w.labelKey == key then
        return
    end
    w.labelKey = key
    local sign = sidePositive and 1 or -1
    local step = badgeSize + 1
    w.name:ClearAllPoints()
    if vertical then
        local from, to = sidePositive and "LEFT" or "RIGHT", sidePositive and "RIGHT" or "LEFT"
        for i = 1, n do
            w.badges[i]:ClearAllPoints()
            w.badges[i]:SetPoint(from, w, to, sign * (LABEL_GAP + (i - 1) * step), 0)
        end
        w.name:SetPoint(from, w, to, sign * (LABEL_GAP + (n > 0 and n * step + LABEL_GAP - 1 or 0)), 0)
    else
        local from, to = sidePositive and "BOTTOM" or "TOP", sidePositive and "TOP" or "BOTTOM"
        for i = 1, n do
            w.badges[i]:ClearAllPoints()
            w.badges[i]:SetPoint(from, w, to, (i - (n + 1) / 2) * step, sign * LABEL_GAP)
        end
        w.name:SetPoint(from, w, to, 0, sign * (LABEL_GAP + (n > 0 and badgeSize + LABEL_GAP or 0)))
    end
end

-- The track, its ticks and the mover, made the first time the area lays out.
local function parts(area)
    local tl = area.tl
    if tl then
        return tl
    end
    tl = { ticks = {} }
    tl.track = area.frame:CreateTexture(nil, "BACKGROUND")
    tl.mover = CreateFrame("Frame", nil, area.frame)
    tl.mover.area = area
    area.tl = tl
    return tl
end

local function paintTrack(area, tl, s, vertical, length)
    local thickness = clamp(s.thickness, "thickness")
    local c = lineColor(s)
    local track = tl.track
    track:ClearAllPoints()
    if vertical then
        track:SetPoint("TOP", area.frame, "TOP", 0, 0)
        track:SetPoint("BOTTOM", area.frame, "BOTTOM", 0, 0)
        track:SetWidth(thickness)
    else
        track:SetPoint("LEFT", area.frame, "LEFT", 0, 0)
        track:SetPoint("RIGHT", area.frame, "RIGHT", 0, 0)
        track:SetHeight(thickness)
    end
    track:SetColorTexture(c[1], c[2], c[3], 1)
    track:Show()
    return c
end

-- The diamond ticks and their seconds, on the side away from the names. Placed again only when the ticks, the
-- seconds on the line, the direction, the length, the names' side or the colour changed.
local function placeTicks(area, tl, s, direction, length, color)
    local list = Timeline.Ticks(s)
    local window = clamp(s.seconds, "seconds")
    local vertical = DIRS[direction].vertical
    local positive = namesPositive(s)
    local key = table.concat(list, ",") .. "|" .. window .. "|" .. direction .. "|" .. length .. "|" .. tostring(positive)
        .. "|" .. color[1] .. "," .. color[2] .. "," .. color[3]
    if tl.tickKey == key then
        return
    end
    tl.tickKey = key
    for i = 1, MAX_TICKS do
        local t = tl.ticks[i]
        local sec = list[i]
        if sec and not t then
            t = { diamond = area.frame:CreateTexture(nil, "ARTWORK"), label = area.frame:CreateFontString(nil, "OVERLAY", "CRTFontSmall") }
            t.diamond:SetTexture(DIAMOND_TEXTURE)
            t.diamond:SetSize(TICK_SIZE, TICK_SIZE)
            t.label:SetShadowOffset(1, -1)
            tl.ticks[i] = t
        end
        if t then
            t.diamond:SetShown(sec ~= nil)
            t.label:SetShown(sec ~= nil)
        end
        if sec then
            local anchor, x, y = Timeline.Offset(direction, sec / window * length, 0)
            t.diamond:ClearAllPoints()
            t.diamond:SetPoint("CENTER", area.frame, anchor, x, y)
            t.diamond:SetVertexColor(color[1], color[2], color[3], 1)
            t.label:ClearAllPoints()
            if vertical then
                t.label:SetPoint(positive and "RIGHT" or "LEFT", t.diamond, positive and "LEFT" or "RIGHT", positive and -TICK_GAP or TICK_GAP, 0)
            else
                t.label:SetPoint(positive and "TOP" or "BOTTOM", t.diamond, positive and "BOTTOM" or "TOP", 0, positive and -TICK_GAP or TICK_GAP)
            end
            t.label:SetText(format(TEXT.tick, sec))
            t.label:SetTextColor(color[1], color[2], color[3])
        end
    end
end

-- A line's own key for its lane: its id and time, so the lane follows the line from widget to widget.
local function laneKey(line)
    if line.id == nil then
        return line
    end
    return tostring(line.id) .. "@" .. tostring(line.at)
end

-- Stacking: an icon that would cover another in its lane in flight moves to the next lane, beside the line on the
-- side away from the names. Icons all move at one speed, so two that overlap do so for the whole flight: each
-- icon's lane is chosen once, from the times, when it first shows, and kept until it's gone. Never from where the
-- icons are at the moment: one holding at the end for its NOW effect would push the next aside just before its
-- own 0, and one finishing would pull the icon beside it back onto the line (and its name across).
local function assignLanes(area, tl, n, s)
    local size = clamp(s.size, "size")
    local window, length = clamp(s.seconds, "seconds"), clamp(s.length, "length")
    local stack = s.stack ~= false
    local away = namesPositive(s) and -1 or 1
    -- a change to what the lanes depend on lays them all out again
    local sig = tostring(stack) .. "|" .. size .. "|" .. window .. "|" .. length
    local laneOf = tl.laneOf
    if not laneOf or tl.laneSig ~= sig then
        laneOf = {}
        tl.laneOf, tl.laneSig = laneOf, sig
    end
    local apart = (size + LANE_GAP) * window / length -- seconds between two icons that just clear each other
    local keys, live = {}, {}
    for i = 1, n do
        local key = laneKey(area.pool[i].line)
        keys[i] = key
        live[key] = true
    end
    for key in pairs(laneOf) do
        if not live[key] then
            laneOf[key] = nil
        end
    end
    -- soonest first (the lines come sorted), each new icon tested against every icon already given a lane
    for i = 1, n do
        local line, key = area.pool[i].line, keys[i]
        if not laneOf[key] then
            local lane = 0
            if stack then
                lane = nil
                for k = 0, MAX_LANES - 1 do
                    local free = true
                    for j = 1, n do
                        local other = keys[j]
                        if j ~= i and laneOf[other] == k and math.abs(area.pool[j].line.at - line.at) < apart then
                            free = false
                            break
                        end
                    end
                    if free then
                        lane = k
                        break
                    end
                end
                lane = lane or 0 -- a third overlapping icon shares the first lane
            end
            laneOf[key] = lane
        end
    end
    for i = 1, n do
        local w = area.pool[i]
        local lane = laneOf[keys[i]]
        w.lane = lane
        w.across = away * lane * (size + LANE_GAP)
    end
end

-- Moves every icon on the line to where it is now (run every frame, inside pcall).
local function moveAll(area)
    local s = area:Settings()
    local now, direction = clockOf(area), dirOf(s)
    for i = 1, area.count do
        place(area, area.pool[i], now, s, direction)
    end
end

local function onUpdate(mover)
    local area = mover.area
    local ok, err = pcall(moveAll, area)
    if not ok then
        -- a failure each frame would flood: stop moving until the next redraw, and say it once
        mover:SetScript("OnUpdate", nil)
        mover.moving = false
        if not area.moveFailed and geterrorhandler then
            area.moveFailed = true
            geterrorhandler()(err)
        end
    end
end

local function layout(area, n, now, s)
    local tl = parts(area)
    local direction = dirOf(s)
    local vertical = DIRS[direction].vertical
    local length, size = clamp(s.length, "length"), clamp(s.size, "size")
    local color = paintTrack(area, tl, s, vertical, length)
    placeTicks(area, tl, s, direction, length, color)
    assignLanes(area, tl, n, s)
    local positive = namesPositive(s)
    local badgeSize = clamp(s.fontSize, "fontSize")
    for i = 1, n do
        local w = area.pool[i]
        -- a stacked icon's name goes on its own outer side, so it never crosses the line
        local sidePositive = positive
        if (w.lane or 0) > 0 then
            sidePositive = not positive
        end
        placeLabels(w, vertical, sidePositive, badgeSize)
        place(area, w, now, s, direction)
    end
    -- the one OnUpdate, only while something is on the line
    local moving = n > 0
    if tl.mover.moving ~= moving then
        tl.mover.moving = moving
        tl.mover:SetScript("OnUpdate", moving and onUpdate or nil)
    end
    if vertical then
        return size, length, direction == "up"
    end
    return length, size, false
end

-- The lines on the line: those with outputs.timeline on, from `seconds` before 0 until the NOW effect ends, less
-- those the game's timeline shows instead (Mode Add without Also show the Alert timeline, Alerts/GameTimeline.lua).
local function byTime(a, b)
    return a.at < b.at
end

local function lines(now, s, cap)
    local window, after = clamp(s.seconds, "seconds"), afterZero(s)
    local Game = CRT.AlertGameTimeline
    local list = {}
    for _, line in ipairs(Alerts:Lines(now)) do
        local o = line.outputs
        if o and o.timeline and line.at - now <= window and now < line.at + after and (not Game or Game.ShowsHere(line)) then
            list[#list + 1] = line
        end
    end
    table.sort(list, byTime)
    local out = {}
    for i = 1, math.min(cap, #list) do
        out[i] = list[i]
    end
    return out, #list - #out
end

-- The samples keep one base time while the preview runs (a gap between calls means it was turned off and on),
-- so the icons slide instead of restarting every tick; they start over once all have played their NOW effect.
local sampleBase, sampleLast
local sampleCycle = 0
local sampleArea
local function sample(now)
    local s = sampleArea and sampleArea:Settings() or DEFAULTS
    local window = clamp(s.seconds, "seconds")
    local span = window + afterZero(s) + 0.5
    if not sampleBase or now - sampleLast > SAMPLE_GAP or now > sampleBase + span then
        sampleBase = now
        sampleCycle = sampleCycle + 1
    end
    sampleLast = now
    local out = {}
    for i, x in ipairs(SAMPLES) do
        out[i] = { id = "sample" .. i .. "#" .. sampleCycle, text = x.text, icon = x.icon, abilityType = x.abilityType,
            abilityTags = x.abilityTags, at = sampleBase + window * x.part, hold = afterZero(s) }
    end
    return out
end

local function slider(panel, s, label, key, format)
    local l = LIMITS[key]
    panel:Slider(label, {
        min = l[1], max = l[2], step = l[3], format = format,
        get = function()
            return clamp(s[key], key)
        end,
        set = function(value)
            s[key] = value
        end,
    })
end

-- The rows for the line, the icons, the names and the NOW effect.
local function settingsLine(panel, s)
    panel:Dropdown(TEXT.direction, {
        options = DIRECTION_OPTIONS,
        get = function()
            return dirOf(s)
        end,
        set = function(key)
            s.direction = key
        end,
    })
    panel:Dropdown(TEXT.side, {
        options = function()
            if DIRS[dirOf(s)].vertical then
                return { { key = "right", label = TEXT.right }, { key = "left", label = TEXT.left } }
            end
            return { { key = "above", label = TEXT.above }, { key = "below", label = TEXT.below } }
        end,
        get = function()
            local positive = namesPositive(s)
            if DIRS[dirOf(s)].vertical then
                return positive and "right" or "left"
            end
            return positive and "above" or "below"
        end,
        set = function(key)
            s.side = key
        end,
    })
    slider(panel, s, TEXT.length, "length")
    slider(panel, s, TEXT.seconds, "seconds", function(v)
        return format(TEXT.seconds1, v)
    end)
    slider(panel, s, TEXT.size, "size")
    slider(panel, s, TEXT.thickness, "thickness")
    panel:Color(TEXT.lineColor, function()
        local c = lineColor(s)
        return { c[1], c[2], c[3], 1 }
    end, function(c)
        s.lineColor = c
    end, function()
        -- greyed and unused without Use custom colours; the theme's accent then
        return s.shown and Areas.CustomColors() and true or false
    end)
    panel:Dropdown(TEXT.ticks, {
        options = TICK_OPTIONS,
        get = function()
            return type(s.ticks) == "string" and s.ticks or DEFAULTS.ticks
        end,
        set = function(key)
            s.ticks = key
        end,
    })
end

local function settingsLook(panel, s)
    panel:Check(TEXT.showNames, function()
        return s.showNames ~= false
    end, function(on)
        s.showNames = on
    end)
    panel:Check(TEXT.showCountdown, function()
        return s.showCountdown ~= false
    end, function(on)
        s.showCountdown = on
    end)
    slider(panel, s, TEXT.tenths, "tenths", function(v)
        return v == 0 and TEXT.off or format(TEXT.seconds1, v)
    end)
    panel:Check(TEXT.badges, function()
        return s.badges ~= false
    end, function(on)
        s.badges = on
    end, TEXT.badgesHelp)
    panel:Check(TEXT.stack, function()
        return s.stack ~= false
    end, function(on)
        s.stack = on
    end, TEXT.stackHelp)
    panel:Dropdown(TEXT.nowEffect, {
        options = EFFECT_OPTIONS,
        get = function()
            return effectOf(s)
        end,
        set = function(key)
            s.nowEffect = key
        end,
    })
    panel:Dropdown(TEXT.nowText, {
        options = NOW_TEXT_OPTIONS,
        get = function()
            return nowText(s)
        end,
        set = function(key)
            s.nowText = key
        end,
        enabledIf = function()
            return effectOf(s) == "pop"
        end,
    })
    panel:Slider(TEXT.nowTime, {
        min = LIMITS.nowTime[1], max = LIMITS.nowTime[2], step = LIMITS.nowTime[3],
        format = function(v)
            return format(TEXT.halfSeconds, v)
        end,
        get = function()
            return clamp(s.nowTime, "nowTime")
        end,
        set = function(value)
            s.nowTime = value
        end,
        enabledIf = function()
            return effectOf(s) ~= "none"
        end,
    })
    panel:Dropdown(TEXT.font, {
        -- read each time the menu opens, so fonts another addon shares later appear
        options = Areas.FontOptions,
        get = function()
            return fontName(s)
        end,
        set = function(name)
            s.font = name
        end,
    })
    slider(panel, s, TEXT.textSize, "fontSize")
end

local function settings(panel, s)
    settingsLine(panel, s)
    settingsLook(panel, s)
    -- Mode and Also show the Alert timeline (Alerts/GameTimeline.lua)
    if CRT.AlertGameTimeline then
        CRT.AlertGameTimeline.SettingsRows(panel, s)
    end
end

local area = Areas.New({
    key = "timeline",
    output = "timeline",
    layer = "alerttimeline",
    title = TEXT.title,
    settingsKey = "timeline",
    defaultPosition = DEFAULT_POSITION,
    noGrow = true,
    make = make,
    draw = draw,
    layout = layout,
    lines = lines,
    lead = function(_, s)
        return clamp(s.seconds, "seconds")
    end,
    sample = sample,
    settings = settings,
})
sampleArea = area
for k, v in pairs(Timeline) do
    area[k] = v
end
CRT.AlertTimeline = area

-- A theme switch while the line shows: the line and its ticks take the new accent at once (the icons keep their
-- types' colours). Only this area's own textures are recoloured.
local UI = CRT.UI
if UI and UI.OnTheme then
    UI:OnTheme(function()
        local tl = area.tl
        if not (tl and area.frame and area.frame:IsShown()) then
            return
        end
        local c = lineColor(area:Settings())
        tl.track:SetColorTexture(c[1], c[2], c[3], 1)
        for _, t in ipairs(tl.ticks) do
            t.diamond:SetVertexColor(c[1], c[2], c[3], 1)
            t.label:SetTextColor(c[1], c[2], c[3])
        end
    end)
end
