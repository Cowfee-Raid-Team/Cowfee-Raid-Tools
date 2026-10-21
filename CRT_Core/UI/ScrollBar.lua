local ADDON, CRT = ...
local UI = CRT.UI

-- Scroll bars, one look per theme. UI:SkinScrollBar(bar) takes either of the game's scroll bars CRT uses
-- and draws the theme's look over it; Default: Blizzard keeps the game's art. A theme picks its look by
-- name with scrollBar in its CRT.THEME_LIST entry (Themes.lua); a theme without one keeps the game's art.
--   rail     Blackout: Midnight. A thin rail in the edge colour, a square thumb in the accent
--   framed   Blackout: Nitro. A roast track with a 1 px edge, a solid accent thumb, a faint accent tick
--            just under the thumb
--   rounded  Beanworks: Cowfee. A rounded roast track with an edge border, and the slider knob's rounded
--            walnut thumb with its top shine (UI.RoundRect, UI.PaintShape)
-- No look has arrow buttons. The game's own scrolling is untouched: the wheel, dragging the thumb and
-- clicking the track still scroll, since the skin only hides art and draws textures over it. Hover
-- lightens the thumb. The bar joins UI.skinned, so a theme switch (UI:SetTheme -> UI:ApplyStyle) redraws
-- it live; colours are read from CRT.MOCHA each time.
--
-- The game's scroll bars, as Blizzard's UI source defines them (Gethe/wow-ui-source, live):
--   MinimalScrollBar, an EventFrame: Track (textures Begin, Middle, End), Track.Thumb (an EventButton with
--   Begin, Middle, End) and the Back and Forward stepper buttons. ScrollBarMixin only enables and disables
--   the steppers and shows the thumb and track itself.
--   https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_SharedXML/Shared/Scroll/MinimalScrollBar.xml
--   https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_SharedXML/Shared/Scroll/ScrollBar.lua
--   UIPanelScrollFrameTemplate's ScrollBar ($parentScrollBar), a UIPanelScrollBarTemplate Slider: its
--   ThumbTexture ($parentThumbTexture) and the ScrollUpButton and ScrollDownButton just past its ends; it
--   has no track art. ScrollFrame_OnScrollRangeChanged shows the two buttons and the thumb again on every
--   range change, so the skin fades the buttons and turns their mouse off rather than hiding them, and its
--   thumb follows the game's thumb texture's Show and Hide.
--   https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_SharedXML/SecureScrollTemplates.xml
--   https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_SharedXML/SecureScrollTemplates.lua

-- Each look's sizes (pixels, centred on the bar) and the CRT.MOCHA keys it paints with.
UI.SCROLL_BAR_LOOKS = {
    rail = { track = 2, thumb = 6, rail = "edge", face = "caramel" },
    framed = { track = 10, thumb = 6, tickGap = 2, tickAlpha = 0.35, fill = "roast", border = "edge", face = "caramel", tick = "caramel" },
    rounded = { track = 10, thumb = 8, radius = 4, thumbRadius = 3, fill = "roast", border = "edge", face = "walnut",
        faceEdge = "walnutEdge", shine = "walnutShine" },
}
local LOOKS = UI.SCROLL_BAR_LOOKS
local HOVER_LIGHTEN = 0.25 -- how far toward white the thumb goes under the mouse

local function mochaOf(key, lift)
    local c = CRT.MOCHA[key]
    lift = lift or 0
    return { c[1] + (1 - c[1]) * lift, c[2] + (1 - c[2]) * lift, c[3] + (1 - c[3]) * lift }
end

local function paintFlat(t, key, alpha, lift)
    local c = mochaOf(key, lift)
    t:SetColorTexture(c[1], c[2], c[3], alpha or 1)
end

local function isTable(v)
    return type(v) == "table"
end

-- The parts of a scroll bar the skin uses, or nil for anything else. The track's drawing goes on
-- trackOwner over trackRegion; the thumb's on thumbOwner over thumbRegion; hover is the frame whose
-- OnEnter and OnLeave light the thumb.
local function partsOf(bar)
    local track = bar.Track
    if isTable(track) and isTable(track.Thumb) and isTable(bar.Back) and isTable(bar.Forward) then
        local thumb = track.Thumb
        local p = { trackOwner = track, trackRegion = track, thumbOwner = thumb, thumbRegion = thumb, hover = thumb,
            art = {}, buttons = { bar.Back, bar.Forward } }
        for _, part in ipairs({ track.Begin, track.Middle, track.End, thumb.Begin, thumb.Middle, thumb.End }) do
            if isTable(part) then
                p.art[#p.art + 1] = part
            end
        end
        return p
    end
    local thumb = bar.ThumbTexture
    if not isTable(thumb) and type(bar.GetThumbTexture) == "function" then
        thumb = bar:GetThumbTexture()
    end
    if isTable(thumb) and isTable(bar.ScrollUpButton) and isTable(bar.ScrollDownButton) then
        return { trackOwner = bar, trackRegion = bar, thumbOwner = bar, thumbRegion = thumb, hover = bar,
            art = { thumb }, buttons = { bar.ScrollUpButton, bar.ScrollDownButton }, gameThumb = thumb }
    end
    return nil
end

-- A texture as tall as region and width wide, centred on it.
local function column(owner, region, width, layer, sublevel)
    local t = owner:CreateTexture(nil, layer, nil, sublevel)
    t:SetPoint("TOP", region, "TOP")
    t:SetPoint("BOTTOM", region, "BOTTOM")
    t:SetWidth(width)
    return t
end

local function addShape(list, shape)
    for _, group in ipairs({ shape.corners, shape.fills }) do
        for _, t in ipairs(group) do
            list[#list + 1] = t
        end
    end
end

-- Each builder returns the look: its track and thumb textures (shown and hidden together), the named
-- parts, and paint(lift), which colours it with the thumb lifted toward white by lift.
local build = {}

function build.rail(p, k)
    local look = { track = {}, thumb = {} }
    look.rail = column(p.trackOwner, p.trackRegion, k.track, "BACKGROUND", 1)
    look.thumbFace = column(p.thumbOwner, p.thumbRegion, k.thumb, "ARTWORK", 1)
    look.track[1], look.thumb[1] = look.rail, look.thumbFace
    function look.paint(lift)
        paintFlat(look.rail, k.rail)
        paintFlat(look.thumbFace, k.face, 1, lift)
    end
    return look
end

function build.framed(p, k)
    local look = { track = {}, thumb = {}, edges = {} }
    look.fill = column(p.trackOwner, p.trackRegion, k.track, "BACKGROUND", 1)
    look.track[1] = look.fill
    for _, side in ipairs({ { "TOPLEFT", "TOPRIGHT", true }, { "BOTTOMLEFT", "BOTTOMRIGHT", true }, { "TOPLEFT", "BOTTOMLEFT", false }, { "TOPRIGHT", "BOTTOMRIGHT", false } }) do
        local e = p.trackOwner:CreateTexture(nil, "BACKGROUND", nil, 2)
        e:SetPoint(side[1], look.fill, side[1])
        e:SetPoint(side[2], look.fill, side[2])
        if side[3] then
            e:SetHeight(1)
        else
            e:SetWidth(1)
        end
        look.edges[#look.edges + 1] = e
        look.track[#look.track + 1] = e
    end
    look.thumbFace = column(p.thumbOwner, p.thumbRegion, k.thumb, "ARTWORK", 1)
    look.tick = p.thumbOwner:CreateTexture(nil, "ARTWORK", nil, 1)
    look.tick:SetPoint("TOP", look.thumbFace, "BOTTOM", 0, -k.tickGap)
    look.tick:SetSize(k.thumb, 1)
    look.thumb[1], look.thumb[2] = look.thumbFace, look.tick
    function look.paint(lift)
        paintFlat(look.fill, k.fill)
        for _, e in ipairs(look.edges) do
            paintFlat(e, k.border)
        end
        paintFlat(look.thumbFace, k.face, 1, lift)
        paintFlat(look.tick, k.tick, k.tickAlpha)
    end
    return look
end

function build.rounded(p, k)
    local look = { track = {}, thumb = {} }
    -- hidden areas the rounded shapes are drawn over, as the checkbox does
    local trackArea = column(p.trackOwner, p.trackRegion, k.track, "BACKGROUND", 0)
    trackArea:Hide()
    look.trackEdge = UI.RoundRect(p.trackOwner, trackArea, "BACKGROUND", 1, k.radius, 0)
    look.trackFace = UI.RoundRect(p.trackOwner, trackArea, "BACKGROUND", 2, k.radius - 1, 1)
    addShape(look.track, look.trackEdge)
    addShape(look.track, look.trackFace)
    local thumbArea = column(p.thumbOwner, p.thumbRegion, k.thumb, "ARTWORK", 0)
    thumbArea:Hide()
    look.thumbEdge = UI.RoundRect(p.thumbOwner, thumbArea, "ARTWORK", 1, k.thumbRadius, 0)
    look.thumbFace = UI.RoundRect(p.thumbOwner, thumbArea, "ARTWORK", 2, k.thumbRadius - 1, 1)
    addShape(look.thumb, look.thumbEdge)
    addShape(look.thumb, look.thumbFace)
    look.shine = p.thumbOwner:CreateTexture(nil, "ARTWORK", nil, 3)
    look.shine:SetPoint("TOPLEFT", thumbArea, "TOPLEFT", k.thumbRadius, -1)
    look.shine:SetPoint("TOPRIGHT", thumbArea, "TOPRIGHT", -k.thumbRadius, -1)
    look.shine:SetHeight(1)
    look.thumb[#look.thumb + 1] = look.shine
    function look.paint(lift)
        UI.PaintShape(look.trackEdge, k.border)
        UI.PaintShape(look.trackFace, k.fill)
        UI.PaintShape(look.thumbEdge, k.faceEdge)
        UI.PaintShape(look.thumbFace, mochaOf(k.face, lift))
        paintFlat(look.shine, k.shine, 1, lift)
    end
    return look
end

-- Shows the look in use (s.style, nil for the game's art) and hides the rest; a look is built the first
-- time it's used.
local function paint(s)
    local style = s.style and LOOKS[s.style] and build[s.style] and s.style or nil
    if style and not s.looks[style] then
        s.looks[style] = build[style](s.parts, LOOKS[style])
    end
    local on = style ~= nil
    for _, t in ipairs(s.parts.art) do
        t:SetAlpha(on and 0 or 1)
    end
    for _, b in ipairs(s.parts.buttons) do
        b:SetAlpha(on and 0 or 1)
        b:EnableMouse((not on) and s.mouse[b] or false)
    end
    local game = s.parts.gameThumb
    local thumbShown = not game or game:IsShown()
    for name, look in pairs(s.looks) do
        local active = name == style
        for _, t in ipairs(look.track) do
            t:SetShown(active)
        end
        for _, t in ipairs(look.thumb) do
            t:SetShown(active and thumbShown)
        end
        if active then
            look.paint(s.hover and HOVER_LIGHTEN or 0)
        end
    end
end

function UI:SkinScrollBar(bar)
    if not isTable(bar) or bar.crtSkin then
        return
    end
    local parts = partsOf(bar)
    if not parts then
        return
    end
    local s = { parts = parts, looks = {}, hover = false, mouse = {} }
    for _, b in ipairs(parts.buttons) do
        s.mouse[b] = b:IsMouseEnabled() and true or false
    end
    bar.crtScroll = s
    local function repaint()
        paint(s)
    end
    parts.hover:HookScript("OnEnter", function()
        s.hover = true
        repaint()
    end)
    parts.hover:HookScript("OnLeave", function()
        s.hover = false
        repaint()
    end)
    if parts.gameThumb then
        for _, method in ipairs({ "Show", "Hide", "SetShown" }) do
            hooksecurefunc(parts.gameThumb, method, repaint)
        end
    end
    bar.crtSkin = function(modern)
        s.style = modern and CRT.theme and CRT.theme.scrollBar or nil
        repaint()
    end
    self.skinned[#self.skinned + 1] = bar
    bar.crtSkin(self:IsModern())
end
