local ADDON, CRT = ...

-- UI.StatusMark: a small round badge with a glyph, the second cue a status needs besides its colour (UX rule 6:
-- no status by colour alone). The consumables bar puts one on an icon's top right corner ("!" missing, a clock
-- running low) and the Gear Checker on a cell ("!" a missing enchant or gem, a down arrow a low item).
--   local mark = UI.StatusMark(owner, size, sublevel)  textures on owner (a frame), size the disc's width in
--                                             pixels; sublevel the OVERLAY sublevel of its rim (default 4), the
--                                             disc one above and the glyph two above (-8 to 5)
--   mark:SetPoint(...)                        places the disc; the rest follows it
--   mark:Set(glyph, color)                    shows it: glyph "alert" (!), "clock" or "down" (an arrow), on a disc
--                                             in color ({ r, g, b }, the theme's bad or warn); nil hides it
--   mark:Hide(), mark:IsShown(), mark.glyph   the glyph shown now, nil when hidden
-- The glyph is drawn from plain white rectangles (Interface\Buttons\WHITE8X8), snapped to whole pixels, on CRT's
-- own disc (CRT_Media/Media/Disc.tga); the clock has a face (CRT_Media/Media/RingThick.tga). So it needs no game
-- atlas. Its ink is black or white, whichever reads better on the disc's colour (UI.StatusMarkInk); the rim round
-- the disc is the theme's outline colour, so the mark reads on any icon. Every texture is made once, here: Set
-- only lays out and paints them, and makes no tables.
--
-- UI.CapFontSize(fs, font, low, high): draws a font string in a font object's face and outline at its size held
-- between low and high points. For small labels on a fixed-size icon (the bar's corner labels, the Gear
-- Checker's track tag), which must not grow into a mark at a large text size. Cheap to call on every refresh:
-- it sets the font only when the font object changed. A capped string keeps the size it was given and stops
-- following the font object (a text size change in General Settings) until it is capped again: a caller on a
-- surface that never refreshes must call it again when the fonts change. After SetFontObject on the string, clear
-- fs.crtCapPath so the next call sets the size again.

local UI = CRT.UI

local MEDIA = CRT.MEDIA or ("Interface\\AddOns\\" .. ADDON .. "\\CRT_Media\\Media\\") -- the fallback is for test harnesses without Core.lua
local DISC = MEDIA .. "Disc"
local FACE = MEDIA .. "RingThick" -- a 256 px white ring, 36 px wide (see Alerts/Circles.lua)
local WHITE = "Interface\\Buttons\\WHITE8X8"
local GRID = 12 -- the glyphs are drawn on a 12 x 12 grid, scaled to the disc
local RIM = 2 -- the rim round the disc, in pixels
local RIM_ALPHA = 0.85
local FACE_SIZE = 10.5 -- the clock's face, across, on the grid

-- Each glyph: rectangles { x, y, w, h } on the grid, centred on the disc's middle, y up.
local GLYPHS = {
    alert = { { 0, 1.5, 2, 5 }, { 0, -3, 2, 2 } }, -- a bar and a dot
    clock = { { 0, 1.4, 1.4, 3.6 }, { 1.1, 0, 2.8, 1.4 } }, -- two hands, at twelve and three, inside the face
    down = { { 0, 2, 2, 4 }, { 0, -0.5, 8, 1 }, { 0, -1.5, 6, 1 }, { 0, -2.5, 4, 1 }, { 0, -3.5, 2, 1 } }, -- a shaft and a stepped head
}
UI.STATUS_GLYPHS = GLYPHS
local FACED = { clock = true }
local PARTS = 5 -- the most rectangles a glyph uses

local function lin(c)
    return c <= 0.03928 and c / 12.92 or ((c + 0.055) / 1.055) ^ 2.4
end

-- A colour's relative luminance (WCAG 2), from 0 (black) to 1 (white).
local function luminance(r, g, b)
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
end

-- The glyph's ink on a disc of this colour: 0 (black) or 1 (white), whichever has the higher contrast.
function UI.StatusMarkInk(r, g, b)
    local l = luminance(r, g, b)
    return ((l + 0.05) / 0.05 > 1.05 / (l + 0.05)) and 0 or 1
end

-- A length on the grid in whole pixels, never under 1.
local function px(v, u)
    return math.max(1, math.floor(v * u + 0.5))
end

-- An offset from the disc's middle that puts a part of width w on whole pixels: a whole number when w and the
-- disc have the same evenness, else a half.
local function snap(v, u, w, size)
    local o = math.floor(v * u + 0.5)
    if (w % 2) ~= (size % 2) then
        o = o + 0.5
    end
    return o
end

local Mark = {}
Mark.__index = Mark

function UI.StatusMark(owner, size, sublevel)
    sublevel = sublevel or 4
    local m = setmetatable({ size = size, parts = {} }, Mark)
    m.rim = owner:CreateTexture(nil, "OVERLAY", nil, sublevel)
    m.rim:SetTexture(DISC)
    m.rim:SetSize(size + RIM, size + RIM)
    m.disc = owner:CreateTexture(nil, "OVERLAY", nil, sublevel + 1)
    m.disc:SetTexture(DISC)
    m.disc:SetSize(size, size)
    m.rim:SetPoint("CENTER", m.disc, "CENTER")
    local u = size / GRID
    m.face = owner:CreateTexture(nil, "OVERLAY", nil, sublevel + 2)
    m.face:SetTexture(FACE)
    m.face:SetSize(px(FACE_SIZE, u), px(FACE_SIZE, u))
    m.face:SetPoint("CENTER", m.disc, "CENTER")
    for i = 1, PARTS do
        local t = owner:CreateTexture(nil, "OVERLAY", nil, sublevel + 2)
        t:SetTexture(WHITE)
        m.parts[i] = t
    end
    m:Hide()
    return m
end

function Mark:SetPoint(...)
    self.disc:ClearAllPoints()
    self.disc:SetPoint(...)
end

function Mark:Hide()
    self.glyph = nil
    self.rim:Hide()
    self.disc:Hide()
    self.face:Hide()
    for _, t in ipairs(self.parts) do
        t:Hide()
    end
end

function Mark:IsShown()
    return self.glyph ~= nil
end

function Mark:Set(glyph, color)
    local shape = glyph and GLYPHS[glyph]
    if not (shape and color) then
        self:Hide()
        return
    end
    local r, g, b = color[1], color[2], color[3]
    self.disc:SetVertexColor(r, g, b, 1)
    local o = CRT.PALETTE.outline
    self.rim:SetVertexColor(o[1], o[2], o[3], RIM_ALPHA)
    self.rim:Show()
    self.disc:Show()
    local ink = UI.StatusMarkInk(r, g, b)
    if self.glyph ~= glyph then
        local size = self.size
        local u = size / GRID
        for i, t in ipairs(self.parts) do
            local p = shape[i]
            t:SetShown(p ~= nil)
            if p then
                local w, h = px(p[3], u), px(p[4], u)
                t:ClearAllPoints()
                t:SetPoint("CENTER", self.disc, "CENTER", snap(p[1], u, w, size), snap(p[2], u, h, size))
                t:SetSize(w, h)
            end
        end
        self.face:SetShown(FACED[glyph] == true)
    end
    for i, t in ipairs(self.parts) do
        if shape[i] then
            t:SetVertexColor(ink, ink, ink, 1)
        end
    end
    self.face:SetVertexColor(ink, ink, ink, 1)
    self.glyph = glyph
end

function UI.CapFontSize(fs, font, low, high)
    if not (font and font.GetFont and fs.SetFont) then
        return
    end
    local path, size, flags = font:GetFont()
    if not (path and size) then
        return
    end
    if fs.crtCapPath == path and fs.crtCapFrom == size and fs.crtCapFlags == flags then
        return
    end
    fs.crtCapPath, fs.crtCapFrom, fs.crtCapFlags = path, size, flags
    fs:SetFont(path, math.max(low, math.min(high, size)), flags or "")
end
