local ADDON, CRT = ...

-- "Marching ants": small dashes that crawl around the edge of a frame, used on the ready check
-- row to flag an expiring consumable. A missing one gets a solid edge instead, so the two differ by
-- their edge as well as their colour. Written from scratch with plain textures.

local Ants = {}
CRT.Ants = Ants

local COUNT = 14 -- dashes around the edge
local SPEED = 38 -- pixels per second, clockwise
local LONG, SHORT = 7, 2 -- dash length and thickness; the solid edge is SHORT thick too
local LAYER = 5 -- OVERLAY sublevel: under a status mark's disc (UI.StatusMark)

-- The solid edge's four sides, each centred on the frame's edge like the dashes.
local SIDES = {
    { "TOPLEFT", "TOPRIGHT", -1, 1, 1, 1, true },
    { "BOTTOMLEFT", "BOTTOMRIGHT", -1, -1, 1, -1, true },
    { "TOPLEFT", "BOTTOMLEFT", -1, 1, -1, -1, false },
    { "TOPRIGHT", "BOTTOMRIGHT", 1, 1, 1, -1, false },
}

function Ants:Attach(frame)
    if frame.ants then
        return
    end
    local ants = { dashes = {}, edges = {}, offset = 0, active = false }
    for i = 1, COUNT do
        local dash = frame:CreateTexture(nil, "OVERLAY", nil, LAYER)
        dash:SetColorTexture(1, 1, 1, 1)
        dash:Hide()
        ants.dashes[i] = dash
    end
    for i, s in ipairs(SIDES) do
        local edge = frame:CreateTexture(nil, "OVERLAY", nil, LAYER)
        edge:SetPoint(s[1], frame, s[1], s[3], s[4])
        edge:SetPoint(s[2], frame, s[2], s[5], s[6])
        if s[7] then
            edge:SetHeight(SHORT)
        else
            edge:SetWidth(SHORT)
        end
        edge:Hide()
        ants.edges[i] = edge
    end
    frame.ants = ants
end

-- style "dashed" (the default) crawls; "solid" is a still edge all round.
function Ants:Start(frame, r, g, b, style)
    local ants = frame.ants
    if not ants then
        return
    end
    style = style == "solid" and "solid" or "dashed"
    local solid = style == "solid"
    for _, dash in ipairs(ants.dashes) do
        dash:SetColorTexture(r, g, b, 1)
        dash:SetShown(not solid)
    end
    for _, edge in ipairs(ants.edges) do
        edge:SetColorTexture(r, g, b, 1)
        edge:SetShown(solid)
    end
    ants.style = style
    ants.active = true
end

function Ants:Stop(frame)
    local ants = frame.ants
    if not ants or not ants.active then
        return
    end
    for _, dash in ipairs(ants.dashes) do
        dash:Hide()
    end
    for _, edge in ipairs(ants.edges) do
        edge:Hide()
    end
    ants.style = nil
    ants.active = false
end

-- Moves every dash along the edge. Call each frame while active; a solid edge stays still.
function Ants:Update(frame, dt)
    local ants = frame.ants
    if not ants or not ants.active or ants.style == "solid" then
        return
    end
    local w, h = frame:GetWidth(), frame:GetHeight()
    local perimeter = 2 * (w + h)
    ants.offset = (ants.offset + SPEED * dt) % perimeter
    local spacing = perimeter / COUNT

    for i, dash in ipairs(ants.dashes) do
        local s = (ants.offset + (i - 1) * spacing) % perimeter
        local x, y, horizontal
        if s < w then
            x, y, horizontal = s, 0, true -- top edge, left to right
        elseif s < w + h then
            x, y, horizontal = w, s - w, false -- right edge, downward
        elseif s < 2 * w + h then
            x, y, horizontal = w - (s - w - h), h, true -- bottom edge, right to left
        else
            x, y, horizontal = 0, h - (s - 2 * w - h), false -- left edge, upward
        end
        dash:SetPoint("CENTER", frame, "TOPLEFT", x, -y)
        if dash.horizontal ~= horizontal then
            dash.horizontal = horizontal
            if horizontal then
                dash:SetSize(LONG, SHORT)
            else
                dash:SetSize(SHORT, LONG)
            end
        end
    end
end
