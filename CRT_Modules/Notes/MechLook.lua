local ADDON, CRT = ...

-- How the Mech Alerts tab's lists look, in one place: the Mechanics list (Notes/Reminders.lua) and the Special
-- list (Notes/SpecialAlerts.lua) draw their names and their selected row through these, so both stay alike.

local Look = {
    WHITE = { 1, 1, 1 },
    GREY = { 0.5, 0.5, 0.5 },
    TIMES_GREY = { 0.55, 0.5, 0.45 }, -- read-only times and When lines
    -- a name in its ability type's colour: mixed this far toward GREY when its alert is off, and toward WHITE on
    -- the selected row, so it reads on the highlight in every theme
    DIM = 0.5,
    LIFT = 0.5,
    -- the selected row: the colour of a selected tab (UI:StyleTab), Classic and Modern
    SEL_CLASSIC_ALPHA = 0.18, -- over the heading colour (the game's gold)
    SEL_MODERN_ALPHA = 0.95,
}
CRT.MechLook = Look

-- c mixed toward `to` by t (0 to 1), as r, g, b.
function Look.Mix(c, to, t)
    return c[1] + (to[1] - c[1]) * t, c[2] + (to[2] - c[2]) * t, c[3] + (to[3] - c[3]) * t
end

-- A row name's colour as r, g, b: its ability type's (typeKey, a Timeline/Reference.lua TYPES key), dimmed when
-- off and lifted when selected; with no known type the theme's text colour, or GREY when off.
function Look.NameColor(typeKey, on, isSelected)
    local Colors = CRT.AlertColors
    local c = typeKey and Colors and Colors.KnownTypeColor and Colors.KnownTypeColor(typeKey)
    if not c then
        c = on and CRT.PALETTE.text or Look.GREY
        return c[1], c[2], c[3]
    end
    if not on then
        c = { Look.Mix(c, Look.GREY, Look.DIM) }
    end
    if isSelected then
        return Look.Mix(c, Look.WHITE, Look.LIFT)
    end
    return c[1], c[2], c[3]
end

-- The selected row's tint as r, g, b, a, for the look on show (modern: UI:IsModern()).
function Look.SelectedColor(modern)
    if modern then
        local m = CRT.PALETTE.selected
        return m[1], m[2], m[3], Look.SEL_MODERN_ALPHA
    end
    local h = CRT.PALETTE.heading
    return h[1], h[2], h[3], Look.SEL_CLASSIC_ALPHA
end
