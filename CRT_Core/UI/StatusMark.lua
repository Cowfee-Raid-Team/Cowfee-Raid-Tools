local ADDON, CRT = ...

-- UI.StatusMark: a small round badge with a glyph, the second cue a status needs besides its colour (UX rule 6:
-- no status by colour alone). The consumables bar puts one on an icon's top right corner ("!" missing, a clock
-- running low) and the Gear Checker on a cell ("!" a missing enchant or gem, a down arrow a low item).
--   local mark = UI.StatusMark(owner, size)   textures on owner (a frame), size the disc's width in pixels
--   mark:SetPoint(...)                        places the disc; the glyph follows it
--   mark:Set(glyph, color)                    shows it: glyph "alert" (!), "clock" or "down" (an arrow), on a disc
--                                             in color ({ r, g, b }, the theme's bad or warn); nil hides it
--   mark:Hide(), mark:IsShown(), mark.glyph   the glyph shown now, nil when hidden
-- The glyph is drawn from plain white rectangles (Interface\Buttons\WHITE8X8) on CRT's own disc
-- (CRT_Media/Media/Disc.tga), so it is sharp at every size and needs no game atlas. Its ink is black or white,
-- whichever reads better on the disc's colour (UI.StatusMarkInk). Every texture is made once, here: Set only
-- lays out and paints them. Layers (OVERLAY): the dark rim 4, the disc 6, the glyph 7, so the consumables
-- bar's edge (sublevel 5) runs under the disc.

local UI = CRT.UI

local DISC = (CRT.MEDIA or ("Interface\\AddOns\\" .. ADDON .. "\\CRT_Media\\Media\\")) .. "Disc" -- the fallback is for test harnesses without Core.lua
local WHITE = "Interface\\Buttons\\WHITE8X8"
local GRID = 12 -- the glyphs are drawn on a 12 x 12 grid, scaled to the disc
local RIM = 2 -- the dark rim round the disc, in pixels, so it reads on any icon

-- Each glyph: rectangles { x, y, w, h } on the grid, centred on the disc's middle, y up.
local GLYPHS = {
    alert = { { 0, 1.5, 2, 5 }, { 0, -3, 2, 2 } }, -- a bar and a dot
    clock = { { 0, 1.75, 1.6, 5 }, { 1.5, 0, 4.6, 1.6 } }, -- two hands, at twelve and three
    down = { { 0, 2, 2, 4 }, { 0, -0.5, 8, 1 }, { 0, -1.5, 6, 1 }, { 0, -2.5, 4, 1 }, { 0, -3.5, 2, 1 } }, -- a shaft and a stepped head
}
UI.STATUS_GLYPHS = GLYPHS
local PARTS = 5 -- the most rectangles a glyph uses

-- A colour's relative luminance (WCAG 2), from 0 (black) to 1 (white).
local function luminance(r, g, b)
    local function lin(c)
        return c <= 0.03928 and c / 12.92 or ((c + 0.055) / 1.055) ^ 2.4
    end
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
end

-- The glyph's ink on a disc of this colour: 0 (black) or 1 (white), whichever has the higher contrast.
function UI.StatusMarkInk(r, g, b)
    local l = luminance(r, g, b)
    return ((l + 0.05) / 0.05 > 1.05 / (l + 0.05)) and 0 or 1
end

local Mark = {}
Mark.__index = Mark

function UI.StatusMark(owner, size)
    local m = setmetatable({ size = size, parts = {} }, Mark)
    m.rim = owner:CreateTexture(nil, "OVERLAY", nil, 4)
    m.rim:SetTexture(DISC)
    m.rim:SetVertexColor(0, 0, 0, 0.85) -- not a theme colour: a dark rim, in every theme
    m.rim:SetSize(size + RIM, size + RIM)
    m.disc = owner:CreateTexture(nil, "OVERLAY", nil, 6)
    m.disc:SetTexture(DISC)
    m.disc:SetSize(size, size)
    m.rim:SetPoint("CENTER", m.disc, "CENTER")
    for i = 1, PARTS do
        local t = owner:CreateTexture(nil, "OVERLAY", nil, 7)
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
    self.rim:Show()
    self.disc:Show()
    local ink = UI.StatusMarkInk(r, g, b)
    local u = self.size / GRID
    if self.glyph ~= glyph then
        for i, t in ipairs(self.parts) do
            local p = shape[i]
            t:SetShown(p ~= nil)
            if p then
                t:ClearAllPoints()
                t:SetPoint("CENTER", self.disc, "CENTER", p[1] * u, p[2] * u)
                t:SetSize(p[3] * u, p[4] * u)
            end
        end
    end
    for i, t in ipairs(self.parts) do
        if shape[i] then
            t:SetVertexColor(ink, ink, ink, 1)
        end
    end
    self.glyph = glyph
end
