local ADDON, CRT = ...

-- Settings for the debuff panel (shown in and out of combat while enabled), saved per player in CRTDB.debuffs:
--   enabled, size (icon size), maxCount (how many at once), dispelIcon, maxDuration (seconds; debuffs
--   longer than this are left out, 0 shows every length) and privateSlots (the game's boss debuff
--   slots as a second row, a fallback).
--   dispelIconScale is that icon's size, a fraction of the debuff icon (0.2 to 1).
--   The look: swipe, swipeEdge, timerPosition, timerX, timerY, borderScale, spacing (pixels between two
--   icons' borders, 0 to 20; the border's width is added to it) and dispelGlow (a soft glow around a
--   dispellable debuff's frame).
--   grow is "right" (left to right) or "left" (right to left, from the panel's right end).
--   tooltips: the game's tooltip when you hover a debuff (Panel.lua), off by default; tooltipMode and
--   tooltipSpot are where it opens, the "debuffs" area of UI/Tooltip.lua.
--   A reverse option existed until 0.13.0, includeRegular (the old optional second row) until the
--   AuraContainer became the panel, and dispelBorder (a box for the border colored by dispel type)
--   until the frame always took that color. Their saved values may remain and are ignored.
--   ignored = { [spellID] = true }: your own debuffs to leave out (see "Your own ignored debuffs").
--   position = { point, relativePoint, x, y } once the panel has been moved. Panel.lua saves it from
--   the corner the row grows from (TOPLEFT or TOPRIGHT) and turns one saved at any other point into
--   that corner the first time it applies it.
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

-- Your own ignored debuffs ------------------------------------------------------------------
-- ignored = { [spellID] = true }, added on the Debuffs tab or by right-clicking a debuff on the panel,
-- and left out like the built-in ones above. It travels with the profile and Export settings only
-- (Profiles.lua checks each key is a spell ID).
--
-- The game decides which of them it really hides. Its candidate filter (Blizzard_AuraContainerUtil.lua,
-- CanApplyIdentityCandidateFilters, Gethe live) applies excludeSpellIDs to a debuff on you only when
-- the spell is flagged never secret (C_Secrets.GetSpellAuraSecrecy), so an addon can't hide a boss
-- mechanic by its ID. Lockouts such as Exhaustion and Sated carry that flag; Debuffs.CanHide asks the
-- game for any other spell.

-- The most entries your list holds: the most one shared settings table may hold (Profiles.lua's MAX_LIST).
Debuffs.MAX_IGNORED = 200
local MAX_SPELL_ID = 2147483647

Debuffs.IGNORE_TEXT = {
    notID = "Type a spell ID: a whole number.",
    notSpell = "The game has no spell with that ID.",
    builtIn = "That one is built in, so it's always ignored.",
    already = "That one is already on your list.",
    full = "Your list is full. Remove one first.",
    -- shown on the tab and in the right-click menu for a spell Debuffs.CanHide says no to
    cantHide = "The game won't let addons hide this one on you, so it still shows.",
}

-- A spell ID, typed or saved: a positive whole number (text of digits only), else nil.
function Debuffs.SpellID(value)
    if isSecret(value) then
        return nil
    end
    if type(value) == "string" then
        value = tonumber(value:match("^%s*(%d+)%s*$"))
    end
    if type(value) ~= "number" or value ~= value or value < 1 or value > MAX_SPELL_ID or value % 1 ~= 0 then
        return nil
    end
    return value
end

-- A spell's name and icon (a file ID, or nil), or nil when the game has no spell with that ID. Name and
-- icon come from the game's own spell data, so they need no load (C_Spell.GetSpellInfo). A secret
-- value is never compared.
function Debuffs.SpellInfo(value)
    local id = Debuffs.SpellID(value)
    if not id or not C_Spell then
        return nil
    end
    if C_Spell.DoesSpellExist then
        local ok, exists = pcall(C_Spell.DoesSpellExist, id)
        if ok and not isSecret(exists) and exists == false then
            return nil
        end
    end
    local name, icon
    if C_Spell.GetSpellInfo then
        local ok, info = pcall(C_Spell.GetSpellInfo, id)
        if ok and type(info) == "table" then
            name, icon = info.name, info.iconID
        end
    elseif C_Spell.GetSpellName then
        local ok, n = pcall(C_Spell.GetSpellName, id)
        name = ok and n or nil
    end
    if isSecret(name) or type(name) ~= "string" or name == "" then
        return nil
    end
    if icon == nil and C_Spell.GetSpellTexture then
        local ok, t = pcall(C_Spell.GetSpellTexture, id)
        icon = ok and t or nil
    end
    if isSecret(icon) or (type(icon) ~= "number" and type(icon) ~= "string") then
        icon = nil
    end
    return name, icon
end

-- Whether the game lets the panel hide this debuff on you by its spell ID (see above): true, false,
-- or nil when this client can't say. The answer is the spell's base secrecy, the same all session, so
-- each spell is asked once (an unknown answer is asked again).
local canHideCache = {}

function Debuffs.CanHide(value)
    local id = Debuffs.SpellID(value)
    local get = C_Secrets and C_Secrets.GetSpellAuraSecrecy
    local never = Enum and Enum.SecrecyLevel and Enum.SecrecyLevel.NeverSecret
    if not id or type(get) ~= "function" or never == nil then
        return nil
    end
    if canHideCache[id] ~= nil then
        return canHideCache[id]
    end
    local ok, level = pcall(get, id)
    if not ok or isSecret(level) or level == nil then
        return nil
    end
    canHideCache[id] = level == never
    return canHideCache[id]
end

-- The saved list, made when old saved data has none.
function Debuffs:Ignored()
    local d = ddb()
    if type(d.ignored) ~= "table" then
        d.ignored = {}
    end
    return d.ignored
end

-- Your ignored spell IDs, lowest first. A saved key that isn't a spell ID is skipped.
function Debuffs:IgnoredList()
    local out = {}
    for id, on in pairs(self:Ignored()) do
        if on == true and self.SpellID(id) == id then
            out[#out + 1] = id
        end
    end
    table.sort(out)
    return out
end

-- The built-in spell IDs, lowest first.
function Debuffs:BuiltInList()
    local out = {}
    for id in pairs(self.EXCLUDED_SPELLS) do
        out[#out + 1] = id
    end
    table.sort(out)
    return out
end

function Debuffs:IsIgnored(value)
    local id = self.SpellID(value)
    return id ~= nil and self:Ignored()[id] == true
end

-- Adds a spell to your list. Returns its ID, or nil and the reason (Debuffs.IGNORE_TEXT).
function Debuffs:AddIgnored(value)
    local T = self.IGNORE_TEXT
    local id = self.SpellID(value)
    if not id then
        return nil, T.notID
    end
    if self.EXCLUDED_SPELLS[id] then
        return nil, T.builtIn
    end
    if self:IsIgnored(id) then
        return nil, T.already
    end
    if not self.SpellInfo(id) then
        return nil, T.notSpell
    end
    if #self:IgnoredList() >= self.MAX_IGNORED then
        return nil, T.full
    end
    self:Ignored()[id] = true
    self:Fire()
    return id
end

function Debuffs:RemoveIgnored(value)
    local id = self.SpellID(value)
    if id and self:Ignored()[id] ~= nil then
        self:Ignored()[id] = nil
        self:Fire()
    end
end

-- What the panel's AuraContainer group keeps of your HARMFUL auras: not cast by you or your pet, no
-- longer than maxDuration (when set), and none of the built-in or your ignored spells (which the game
-- applies only to spells it lets addons hide, see above). A new table each call, since the container
-- may keep it.
function Debuffs:CandidateFilters()
    local exclude = {}
    for id in pairs(self.EXCLUDED_SPELLS) do
        exclude[id] = true
    end
    for _, id in ipairs(self:IgnoredList()) do
        exclude[id] = true
    end
    local filters = { isFromPlayerOrPlayerPet = false, excludeSpellIDs = exclude }
    if self:MaxDuration() > 0 then
        filters.maxDuration = self:MaxDuration()
    end
    return filters
end

-- The debuffs the panel's row holds now, in its order, for right-clicking one: the row's own buttons
-- never hand their aura to addon code (only the game's private part of AuraButton holds it), so this
-- reads your debuffs (C_UnitAuras.GetAuraDataByIndex) and picks them the way the game's candidate
-- filter and its ExpirationOnly sort do (Blizzard_AuraContainerUtil.lua, AuraUtil.lua, Gethe live):
-- soonest to end first, debuffs with no end last, then by aura instance. Each entry is
-- { spellId, name, icon, canHide }, or { unreadable = true } for a debuff with a secret value (it holds
-- its spot as best its readable values place it, and nothing in it is compared). nil only when the game
-- can't be asked. Boss debuffs the game hides from addons are never in this list, though the row may
-- show them.
local MAX_AURAS = 255

-- The sort keys of a debuff whose values can't all be read: its end time and instance if readable.
local function unreadable(expires, instance)
    local ends = (not isSecret(expires) and type(expires) == "number" and expires > 0) and expires or math.huge
    return { unreadable = true, ends = ends, instance = (not isSecret(instance) and type(instance) == "number") and instance or 0 }
end

function Debuffs:Current()
    local get = C_UnitAuras and C_UnitAuras.GetAuraDataByIndex
    if type(get) ~= "function" then
        return nil
    end
    local filters = self:CandidateFilters()
    local list = {}
    for index = 1, MAX_AURAS do
        local ok, aura = pcall(get, "player", index, "HARMFUL")
        if not ok then
            return nil
        end
        if aura == nil then
            break
        end
        if isSecret(aura) or type(aura) ~= "table" then
            list[#list + 1] = unreadable()
        else
            local entry = self:CurrentEntry(aura, filters)
            if entry then
                list[#list + 1] = entry
            end
        end
    end
    table.sort(list, function(a, b)
        if a.ends ~= b.ends then
            return a.ends < b.ends
        end
        return a.instance < b.instance
    end)
    return list
end

-- One debuff of Debuffs:Current, or nil when the row leaves it out. Every value is checked for a secret
-- before anything else touches it; a nil one (a missing icon) is fine.
function Debuffs:CurrentEntry(aura, filters)
    local id, name, icon, duration, expires = aura.spellId, aura.name, aura.icon, aura.duration, aura.expirationTime
    local fromYou, instance = aura.isFromPlayerOrPlayerPet, aura.auraInstanceID
    local values = { id, name, icon, duration, expires, fromYou, instance }
    for i = 1, 7 do
        if isSecret(values[i]) then
            if not isSecret(fromYou) and fromYou == true then
                return nil -- yours, which the row never shows (the game never makes this secret)
            end
            return unreadable(expires, instance)
        end
    end
    if fromYou == true then
        return nil
    end
    if type(id) ~= "number" or type(duration) ~= "number" or type(expires) ~= "number" or type(instance) ~= "number" then
        return unreadable(expires, instance)
    end
    if filters.maxDuration and (duration > filters.maxDuration or duration == 0) then
        return nil
    end
    local canHide = self.CanHide(id)
    if filters.excludeSpellIDs[id] and canHide then
        return nil
    end
    if type(icon) ~= "number" and type(icon) ~= "string" then
        icon = nil
    end
    return { spellId = id, name = type(name) == "string" and name or ("Spell " .. id), icon = icon, canHide = canHide,
        ends = expires > 0 and expires or math.huge, instance = instance }
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

-- Which way the row grows: "right" puts the first debuff at the panel's left end and the next ones to
-- its right; "left" puts it at the right end and the next ones to its left. Anything else, such as
-- saved data from before this setting, reads as "right".
Debuffs.GROW_DIRECTIONS = {
    { key = "right", label = "Left to right" },
    { key = "left", label = "Right to left" },
}

function Debuffs:Grow()
    return ddb().grow == "left" and "left" or "right"
end

function Debuffs:SetGrow(direction)
    if direction == "left" or direction == "right" then
        ddb().grow = direction
    end
    self:Fire()
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

-- The game's tooltip when you hover a debuff on the panel. Off by default, so the panel ignores the
-- mouse unless you ask for it.
function Debuffs:Tooltips()
    return ddb().tooltips and true or false
end

function Debuffs:SetTooltips(value)
    ddb().tooltips = value and true or false
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
        tostring(timerY), tostring(self:Get("borderScale")), tostring(self:DispelGlow()), self:Spacing(), self:Grow() }, ":")
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
