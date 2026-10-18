local ADDON, CRT = ...

-- Settings for the in-combat debuff panel, saved per player in CRTDB.debuffs:
--   enabled, size (icon size), maxCount (how many at once), dispelIcon, maxDuration (seconds; debuffs
--   longer than this are left out, 0 shows every length) and privateSlots (the game's boss debuff
--   slots as a second row, a fallback).
--   The look: swipe, swipeEdge, timerPosition, timerX, timerY and borderScale.
--   A reverse option existed until 0.13.0, and includeRegular (the old optional second row) until the
--   AuraContainer became the panel. Their saved values may remain and are ignored.
--   position = { point, relativePoint, x, y } once the panel has been moved.
-- Each player has their own copy in their own saved variables, so nothing is shared between players.

local Debuffs = { listeners = {} }
CRT.Debuffs = Debuffs

local DEFAULT_POSITION = { point = "CENTER", relativePoint = "CENTER", x = 0, y = 150 }

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
        ddb().size = math.max(24, math.min(96, math.floor(size)))
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

-- Debuffs longer than this many seconds are left out (the container's candidate filter maxDuration),
-- so long ones such as a lockout don't fill the panel. 0 shows every length.
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
-- type icon, and a border of 5 x borderScale pixels around the icon.

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
