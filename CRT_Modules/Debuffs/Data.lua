local ADDON, CRT = ...

-- Settings for the debuff panel (shown in and out of combat while enabled), saved per player in CRTDB.debuffs:
--   enabled, size (icon size), maxCount (how many at once), dispelIcon, maxDuration (seconds; debuffs
--   longer than this are left out, 0 shows every length) and privateSlots (the game's boss debuff
--   slots as a second row, a fallback).
--   dispelIconScale is that icon's size, a fraction of the debuff icon (0.2 to 1).
--   The look: swipe, swipeEdge, timerPosition, timerX, timerY, borderScale, spacing (pixels between two
--   icons' borders, 0 to 20; the border's width is added to it) and dispelGlow (a soft glow around a
--   dispellable debuff's frame).
--   A reverse option existed until 0.13.0, includeRegular (the old optional second row) until the
--   AuraContainer became the panel, and dispelBorder (a box for the border colored by dispel type)
--   until the frame always took that color. Their saved values may remain and are ignored.
--   position = { point, relativePoint, x, y } once the panel has been moved.
-- Each player has their own copy in their own saved variables, so nothing is shared between players.

local Debuffs = { listeners = {} }
CRT.Debuffs = Debuffs

local DEFAULT_POSITION = { point = "CENTER", relativePoint = "CENTER", x = 0, y = 150 }

-- The icon size range in pixels, and the dispel type icon's size range as a fraction of the icon.
Debuffs.MIN_SIZE, Debuffs.MAX_SIZE = 24, 128
Debuffs.MIN_DISPEL_SCALE, Debuffs.MAX_DISPEL_SCALE, Debuffs.DEFAULT_DISPEL_SCALE = 0.2, 1, 0.35

local function isSecret(value)
    return issecretvalue and issecretvalue(value) or false
end

local function ddb()
    return CRT.db.debuffs
end

function Debuffs:OnChange(fn)
    self.listeners[#self.listeners + 1] = fn
end

function Debuffs:Fire()
    for _, fn in ipairs(self.listeners) do
        fn()
    end
end

function Debuffs:Enabled()
    return ddb().enabled
end

function Debuffs:SetEnabled(value)
    ddb().enabled = value and true or false
    self:Fire()
end

function Debuffs:Size()
    return ddb().size
end

function Debuffs:SetSize(size)
    size = tonumber(size)
    if size then
        ddb().size = math.max(Debuffs.MIN_SIZE, math.min(Debuffs.MAX_SIZE, math.floor(size)))
    end
    self:Fire()
end

function Debuffs:MaxCount()
    return ddb().maxCount
end

function Debuffs:SetMaxCount(count)
    count = tonumber(count)
    if count then
        ddb().maxCount = math.max(1, math.min(8, math.floor(count)))
    end
    self:Fire()
end

-- Show the dispel type icon on a mechanic debuff.
function Debuffs:DispelIcon()
    return ddb().dispelIcon and true or false
end

function Debuffs:SetDispelIcon(value)
    ddb().dispelIcon = value and true or false
    self:Fire()
end

-- The dispel type icon's size, as a fraction of the debuff icon. Saved data from before this setting
-- has none, and reads as the size used until then.
function Debuffs:DispelIconScale()
    return tonumber(ddb().dispelIconScale) or self.DEFAULT_DISPEL_SCALE
end

function Debuffs:SetDispelIconScale(scale)
    scale = tonumber(scale)
    if scale then
        scale = math.floor(scale * 100 + 0.5) / 100
        ddb().dispelIconScale = math.max(self.MIN_DISPEL_SCALE, math.min(self.MAX_DISPEL_SCALE, scale))
    end
    self:Fire()
end

-- Debuffs longer than this many seconds are left out (the container's candidate filter maxDuration),
-- so long ones such as a lockout don't fill the panel. The game keeps one exactly this long and leaves
-- out permanent ones (duration 0) whenever a limit is set. 0 passes no limit and shows every length.
function Debuffs:MaxDuration()
    return tonumber(ddb().maxDuration) or 0
end

function Debuffs:SetMaxDuration(seconds)
    seconds = tonumber(seconds)
    if seconds then
        ddb().maxDuration = math.max(0, math.min(600, math.floor(seconds)))
    end
    self:Fire()
end

-- The game's boss debuff slots (private aura anchors) as a second row, a fallback in case boss
-- mechanic debuffs don't reach the container. Off by default.
function Debuffs:PrivateSlots()
    return ddb().privateSlots and true or false
end

function Debuffs:SetPrivateSlots(value)
    ddb().privateSlots = value and true or false
    self:Fire()
end

-- Debuffs never shown, whatever their length: lockouts and penalties that are on you for a long
-- time and aren't a mechanic.
Debuffs.EXCLUDED_SPELLS = {
    [57723] = true, -- Exhaustion (Heroism)
    [390435] = true, -- Exhaustion (Fury of the Aspects)
    [57724] = true, -- Sated (Bloodlust)
    [80354] = true, -- Temporal Displacement (Time Warp)
    [95809] = true, -- Insanity (Ancient Hysteria)
    [264689] = true, -- Fatigued (Primal Rage)
    [160455] = true, -- Fatigued (Netherwinds)
    [26013] = true, -- Deserter
    [71041] = true, -- Dungeon Deserter
}

-- What the panel's AuraContainer group keeps of your HARMFUL auras: not cast by you or your pet, no
-- longer than maxDuration (when set), and none of the excluded spells. A new table each call, since
-- the container may keep it.
function Debuffs:CandidateFilters()
    local exclude = {}
    for id in pairs(self.EXCLUDED_SPELLS) do
        exclude[id] = true
    end
    local filters = { isFromPlayerOrPlayerPet = false, excludeSpellIDs = exclude }
    if self:MaxDuration() > 0 then
        filters.maxDuration = self:MaxDuration()
    end
    return filters
end

-- The look ----------------------------------------------------------------------------------
-- The panel's debuffs are buttons of Blizzard's AuraContainer, built by this addon: the game fills
-- each one (icon, time, stacks, dispel type) without handing the values to addon code, so the panel
-- also works in combat, when debuff details are secret. The look is ours: the swipe and its edge, the
-- timer as text beside or on the icon or as countdown numbers on the swipe (never both), the dispel
-- type icon, and a dark frame of 5 x borderScale pixels around the icon, which takes the color of a
-- dispellable debuff's dispel type, with an optional glow. The game colors that frame itself, so the
-- addon never sees the type in combat. The frame's bevel, the countdown's font and colors are in
-- Panel.lua's LOOK table.

Debuffs.TIMER_POSITIONS = {
    { key = "below", label = "Below the icon" },
    { key = "above", label = "Above the icon" },
    { key = "left", label = "Left of the icon" },
    { key = "right", label = "Right of the icon" },
    { key = "center", label = "On the icon" },
    { key = "numbers", label = "Swipe numbers" },
    { key = "hidden", label = "Hidden" },
}

-- Each timer position as the text's point, the icon's point, and a small gap.
local TIMER_ANCHORS = {
    below = { "TOP", "BOTTOM", 0, -2 },
    above = { "BOTTOM", "TOP", 0, 2 },
    center = { "CENTER", "CENTER", 0, 0 },
    left = { "RIGHT", "LEFT", -3, 0 },
    right = { "LEFT", "RIGHT", 3, 0 },
}

function Debuffs:Get(field)
    return ddb()[field]
end

function Debuffs:Set(field, value)
    ddb()[field] = value
    self:Fire()
end

-- timerX and timerY, -40 to 40 pixels.
function Debuffs:SetNudge(field, value)
    value = tonumber(value)
    if value then
        ddb()[field] = math.max(-40, math.min(40, math.floor(value + 0.5)))
    end
    self:Fire()
end

-- Where the timer text goes beside the icon: point, relativePoint, x, y, or nil when the timer is
-- the swipe numbers or hidden.
function Debuffs:TimerAnchor()
    local position = ddb().timerPosition
    if position == "numbers" or position == "hidden" then
        return nil
    end
    local anchor = TIMER_ANCHORS[position] or TIMER_ANCHORS.below
    return anchor[1], anchor[2], anchor[3] + (ddb().timerX or 0), anchor[4] + (ddb().timerY or 0)
end

-- True when the timer is the game's countdown numbers on the swipe.
function Debuffs:SwipeNumbers()
    return ddb().timerPosition == "numbers"
end

-- The border's width: the game's debuff border is the icon plus 5 x borderScale pixels, half of it
-- on each side.
function Debuffs:Edge()
    return 5 * (tonumber(ddb().borderScale) or 1)
end

-- The pixels between two icons' borders, 0 to 20. Saved data from before this setting has none, and
-- reads as the gap used until then.
Debuffs.MIN_SPACING, Debuffs.MAX_SPACING, Debuffs.DEFAULT_SPACING = 0, 20, 4

function Debuffs:Spacing()
    return tonumber(ddb().spacing) or self.DEFAULT_SPACING
end

function Debuffs:SetSpacing(pixels)
    pixels = tonumber(pixels)
    if pixels then
        ddb().spacing = math.max(self.MIN_SPACING, math.min(self.MAX_SPACING, math.floor(pixels + 0.5)))
    end
    self:Fire()
end

-- The distance from one icon to the next: the icon, the border's width (half from each icon) and the
-- spacing, so two borders never overlap. The glow adds nothing: it is drawn over its neighbours.
function Debuffs:Step(size)
    return size + self:Edge() + self:Spacing()
end

-- The glow around a dispellable debuff's frame, in its dispel type's color. The frame itself always
-- takes that color (Panel.lua), so the glow depends on no other setting.
function Debuffs:DispelGlow()
    return ddb().dispelGlow and true or false
end

function Debuffs:SetDispelGlow(value)
    ddb().dispelGlow = value and true or false
    self:Fire()
end

-- The frame's color on a debuff with no dispel type: dark, so it reads on any background and in
-- every theme.
Debuffs.BORDER_COLOR = { 0.05, 0.05, 0.05, 1 }

-- The dispel types that color the border, each with its color for when the game doesn't give its own.
-- Panel.lua hands these colors to the game, which colors the container's borders in combat; the
-- preview samples use them directly.
Debuffs.DISPEL_COLORS = {
    Magic = { 0.2, 0.6, 1 }, -- blue
    Poison = { 0, 0.6, 0 }, -- green
    Curse = { 0.6, 0, 1 }, -- purple
    Disease = { 0.6, 0.4, 0 }, -- brown
    Bleed = { 0.8, 0, 0 }, -- red
}

-- The border color for a dispel type name such as "Magic", as r, g, b, a: the game's own color for it
-- (AuraUtil.GetAuraBorderColor, which the game also uses in combat) when it has one, else the table
-- above. No type, an unknown one or a secret value gives the plain border. A secret value is never
-- compared or used as a key.
function Debuffs:DispelColor(kind)
    local plain = self.BORDER_COLOR
    if isSecret(kind) or type(kind) ~= "string" or not self.DISPEL_COLORS[kind] then
        return plain[1], plain[2], plain[3], plain[4]
    end
    local get = AuraUtil and AuraUtil.GetAuraBorderColor
    if type(get) == "function" then
        local ok, color = pcall(get, kind)
        if ok and type(color) == "table" and type(color.GetRGB) == "function" then
            local okRGB, r, g, b = pcall(color.GetRGB, color)
            if okRGB and type(r) == "number" and type(g) == "number" and type(b) == "number" then
                return r, g, b, 1
            end
        end
    end
    local c = self.DISPEL_COLORS[kind]
    return c[1], c[2], c[3], 1
end

-- Every setting the panel's look is built from, as one string: a change to any of them rebuilds the
-- boss debuff slots (Panel.lua).
function Debuffs:LookSignature()
    local timerPoint, _, timerX, timerY = self:TimerAnchor()
    return table.concat({ tostring(self:PrivateSlots()), self:Size(), self:MaxCount(), tostring(self:DispelIcon()), self:DispelIconScale(),
        tostring(self:Get("swipe")), tostring(self:Get("swipeEdge")), tostring(self:SwipeNumbers()), tostring(timerPoint), tostring(timerX),
        tostring(timerY), tostring(self:Get("borderScale")), tostring(self:DispelGlow()), self:Spacing() }, ":")
end

-- The saved position, or the default one in the upper middle of the screen.
function Debuffs:Position()
    return ddb().position or DEFAULT_POSITION
end

function Debuffs:SavePosition(point, relativePoint, x, y)
    ddb().position = { point = point, relativePoint = relativePoint, x = x, y = y }
end

function Debuffs:ResetPosition()
    ddb().position = nil
    self:Fire()
end
