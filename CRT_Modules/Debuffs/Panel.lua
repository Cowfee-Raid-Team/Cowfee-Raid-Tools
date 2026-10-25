local ADDON, CRT = ...

-- The debuff panel: a movable row of the debuffs enemies put on you, shown everywhere, in and out of
-- combat, while it is turned on.
--
-- The row is one of Blizzard's AuraContainer frames (Blizzard_AuraContainer, patch 12.1.0, loaded
-- here before the first one is made). The container watches the player's HARMFUL auras itself and fills
-- buttons this addon builds (icon, swipe, time, stacks, dispel type) without handing the values to
-- addon code, which is how it keeps working in combat, when debuff details are secret. Its candidate
-- filters keep only debuffs not cast by you or your pet, no longer than Hide debuffs longer than, and
-- none of the excluded lockouts (Debuffs.EXCLUDED_SPELLS) or your ignored debuffs, shortest first. The
-- game applies a spell ID filter to a debuff on you only for spells it flags never secret (Data.lua).
-- Right-clicking an icon to ignore it is Click.lua's.
--
-- Tooltips on hover (the Show tooltips on hover box, off by default) are the game's own: an AuraButton
-- shows its aura's tooltip when hovered (OnEnter_Intrinsic, Blizzard_AuraContainer/Blizzard_AuraButton.lua
-- and .xml, Gethe live), filled by the game from the aura it holds, so it works in combat with secret
-- debuff data. Addon code only turns hover on (SetMouseMotionEnabled) and gives the anchor
-- (SetTooltipAnchorPoint: an anchor name such as ANCHOR_RIGHT and offsets on the button); the tooltip itself is
-- forbidden to addons. The anchor comes from the "debuffs" tooltip area (UI.TooltipAnchor), with the
-- game's own side for an aura button (below, to the left) on auto. With the box off, during a preview or
-- with the panel off, the buttons take no hover and the panel stays click-through. Clicks are never
-- turned on here. The boss debuff slots are the game's own frames and take no part in this.
--
-- The look (the LOOK table below): a dark frame with a thin bevel inside it, a big yellow countdown in
-- the middle and white stacks at the bottom right, both with an outline. The countdown is the
-- button's own text, which the game fills through a number formatter with the panel's rules, so it
-- keeps counting in combat, when the time left is secret. The preview tiles format their own.
--
-- The frame's dispel color and its glow are textures handed to the game the same way as the dispel
-- type icon (AddDispelTypeTexture, PreserveAsset style, with a customDispelColorMap): the game shows
-- them only on a debuff with a dispel type and tints them that type's color from the map, over the
-- dark frame. The preview tiles color theirs from their samples' known types (Debuffs:DispelColor).
--
-- Icons sit Debuffs:Step(size) apart: the icon, the border's width and the Spacing setting, so two
-- borders never overlap. The glow adds no space: it is on a frame inside its button, raised above every
-- button (GLOW_LEVEL), so it draws over its neighbours instead of under them. The game only takes a
-- dispel texture that is inside the button (AuraContainerUtil.ValidateInboundScriptObject), so the glow
-- can't move to one shared frame above the row. The timer and stacks sit one level above the glow.
-- The row grows from the panel's left end or, with Grow set to right to left, from its right end; the
-- container, the boss debuff slots and the preview tiles all follow it (rowPoint). The panel is held
-- on screen by that same end, so a change of icon size or count moves only its other end.
--
-- The game's boss debuff slots (C_UnitAuras.AddPrivateAuraAnchor, where the game draws a private aura
-- itself) are kept as an optional second row, off by default, in case boss mechanic debuffs don't
-- reach the container. Whether they do is checked in game. The slots can't be filtered: the anchor
-- takes no spell filter (AddPrivateAuraAnchorArgs), and the game never tells addon code which spell is
-- in a slot.
--
-- The panel is faded with alpha, not hidden, when it is turned off, because showing and hiding frames
-- can be blocked in combat. The container stays shown and enabled throughout. Positions and
-- settings are saved per player in CRTDB.debuffs.
--
-- During a boss encounter the container's buttons hold secret aura data and the game makes them, and
-- what is attached to them, forbidden to addon code; that lasts after you die, when combat has ended
-- but the encounter hasn't. So the buttons are set up in initializeFrame, and a settings change only
-- wires them again when it is safe (safeToWire: out of combat and no encounter running). A button
-- found forbidden is skipped and marked dirty, and wired again once it is safe. Anything that touches
-- the container or a button checks forbidden() first.

local Debuffs = CRT.Debuffs
local Panel = { layoutListeners = {} }
CRT.DebuffPanel = Panel

-- fn() runs after each layout, which happens only when it is safe to wire (out of combat, no
-- encounter): the right-click spots over the icons follow it (Click.lua).
function Panel:OnLayout(fn)
    self.layoutListeners[#self.layoutListeners + 1] = fn
end

local function notifyLayout()
    for _, fn in ipairs(Panel.layoutListeners) do
        fn()
    end
end

local CONTAINER_ADDON = "Blizzard_AuraContainer"
local TEMPLATES = { "CustomAuraContainerTemplate, DisableUntrustedLayoutScriptsTemplate", "CustomAuraContainerTemplate" }
local GROUP = "debuffs"
local MAX_SLOTS = 8
local SLOT_ROW_OFFSET = 24 -- the least gap above the boss debuff slots, which leaves room for the row's timer text
local REFRESH_SECONDS = 0.5
local WHITE = "Interface\\Buttons\\WHITE8X8"

-- The look of each debuff, the container's buttons and the preview tiles alike. The frame's own
-- color is Debuffs.BORDER_COLOR and its width the Border size setting (Debuffs:Edge).
local LOOK = {
    -- The countdown and stacks font: the General Settings font, or the game's own when that is the
    -- default. Sizes are a fraction of the icon size, so the text grows with the icon.
    font = "Fonts\\FRIZQT__.TTF",
    timerScale = 0.45, -- the countdown on the icon
    besideScale = 0.3, -- the countdown beside it (above, below, left or right), kept smaller
    stackScale = 0.3,
    minTimer = 10, -- the smallest sizes, so the text stays readable on a small icon
    minStack = 9,
    thickFrom = 16, -- a countdown this size or bigger gets the thick outline, a smaller one the thin
    timerColor = { 1, 0.82, 0 }, -- the approved big yellow countdown, readable on icons in every theme: not a theme colour
    stackColor = { 1, 1, 1 },
    stackInset = 2, -- pixels from the icon's bottom right corner
    -- A thin light line just outside the icon, inside the frame, so the frame looks bevelled. It is
    -- see-through, so on a dispel color it lightens that color. No bevel on a frame thinner than
    -- bevelMinEdge (the Border size in pixels, both sides together).
    bevelColor = { 1, 1, 1, 0.22 },
    bevelWidth = 1,
    bevelMinEdge = 4,
    -- The swipe's fill: a muted black. The swipe runs reversed from the action bar's, so a fresh
    -- debuff is fully lit and the dark part grows until it covers the icon as the debuff ends.
    swipeColor = { 0, 0, 0, 0.6 },
}
Panel.LOOK = LOOK
-- The glow around a dispel type's border: the game's white glow for a new item in the bags, drawn
-- additively, so the dispel type's color tints it cleanly. Without the atlas there is no glow: a plain
-- square drawn above the icon would tint the whole icon.
local GLOW_ATLAS = "bags-glow-white"
local GLOW_ALPHA = 0.8
-- Frame levels above each icon's own: the glow's frame, over every other icon in the row and its
-- swipe, and the timer and stacks, over the glow.
local GLOW_LEVEL = 20
local TEXT_LEVEL = 21

local frame, container, handle
local frameWidth, frameHeight = 0, 0 -- the panel's size as last set, to turn a position into its fixed corner
local slots = {} -- one frame per private aura slot
local anchorIds = {} -- the private aura anchors added for those slots
local tiles = {} -- preview tiles
local buttons = {} -- every container button built, with its parts, to apply the look again
local dirty = {} -- buttons skipped while forbidden, to wire again when it is safe
local skipped = 0 -- how many times a forbidden button was skipped, for the diagnostics
local encounter = false -- between ENCOUNTER_START and ENCOUNTER_END
local pendingApply = false -- a settings change waiting for a safe moment
local lastApply = 0 -- GetTime() of the last Apply, so a button that stays forbidden is retried slowly
local RETRY_SECONDS = 5
local placement -- its place, below
local previewOn = false
local inCombat = false -- set from PLAYER_REGEN_DISABLED/ENABLED, for the diagnostics
local elapsed = 0
local report = { loaded = nil, template = nil, created = false, error = nil, notes = {} }
local appliedAnchors, appliedContainer -- the settings each part was last built for
local appliedTooltips -- the hover and tooltip anchor last given to every button
local TOOLTIP_AREA = "debuffs" -- UI.TOOLTIP_AREAS: the panel's own Tooltip position
local TOOLTIP_SIDE = "ANCHOR_BOTTOMLEFT" -- on auto: the game's own side for an aura button (Blizzard_AuraButton.xml)

local function isSecret(value)
    return issecretvalue and issecretvalue(value) or false
end

local function note(text)
    if #report.notes < 40 then
        report.notes[#report.notes + 1] = text
    end
end

-- Calls a method, recording a note if it fails or does not exist. Returns ok, results...
local function try(label, object, method, ...)
    local fn = object and object[method]
    if type(fn) ~= "function" then
        note(label .. ": method " .. method .. " is missing")
        return false
    end
    local ok, a, b = pcall(fn, object, ...)
    if not ok then
        note(label .. ": " .. method .. " failed: " .. tostring(a))
        return false
    end
    return true, a, b
end

-- Whether a frame or region may be touched by addon code right now.
local function forbidden(object)
    if object == nil then
        return false
    end
    local fn = object.IsForbidden
    if type(fn) ~= "function" then
        return false
    end
    local ok, result = pcall(fn, object)
    return not ok or result == true
end

local function encounterActive()
    return encounter or (IsEncounterInProgress and IsEncounterInProgress() and true or false)
end

-- Setting up the container and its buttons: out of combat, and no encounter (you may be dead in one).
local function safeToWire()
    return not InCombatLockdown() and not encounterActive()
end
Panel.SafeToWire = safeToWire

local function rowWidth()
    local size, count = Debuffs:Size(), Debuffs:MaxCount()
    return (count - 1) * Debuffs:Step(size) + size, size
end

-- Where the index-th icon of a row sits on the panel, for the Grow setting: from the top left going
-- right, or from the top right going left. Returns the point (on the icon and the panel alike) and x.
-- The panel itself stays where it was placed, so switching direction never moves it.
local function rowPoint(index)
    local x = (index - 1) * Debuffs:Step(Debuffs:Size())
    if Debuffs:Grow() == "left" then
        return "TOPRIGHT", -x
    end
    return "TOPLEFT", x
end
Panel.RowPoint = rowPoint

-- The panel's frame, or nil before it is built.
function Panel:Frame()
    return frame
end

-- The gap above the boss debuff slots: room for the row's timer text, which grows with the icon.
local function slotRowOffset()
    return math.max(SLOT_ROW_OFFSET, Panel.TimerFontSize(Debuffs:Size()) + 6)
end

-- The whole panel: the container's row, and the slot row under it when that is on.
local function panelSize()
    local width, size = rowWidth()
    local height = size
    if Debuffs:PrivateSlots() then
        height = height + slotRowOffset() + size
    end
    return width, height, size
end

-- Sizes the panel to its rows, keeping the size for the position (applyPosition).
local function sizeFrame()
    frameWidth, frameHeight = panelSize()
    frame:SetSize(frameWidth, frameHeight)
end

-- Boss debuff slots (optional second row) ---------------------------------------------------

local function removeAnchors()
    for index, id in pairs(anchorIds) do
        pcall(C_UnitAuras.RemovePrivateAuraAnchor, id)
        anchorIds[index] = nil
    end
end

-- One private aura anchor per slot, the way Blizzard's debuff frame does, when the setting is on. The
-- game draws these itself and takes only a few options. Out of combat only.
local function addAnchors()
    if not frame or not safeToWire() then
        return
    end
    local on = Debuffs:PrivateSlots()
    local size, count = Debuffs:Size(), Debuffs:MaxCount()
    local timerPoint, timerRelative, timerX, timerY = Debuffs:TimerAnchor()
    local signature = Debuffs:LookSignature()
    if signature == appliedAnchors then
        return
    end
    appliedAnchors = signature
    removeAnchors()
    if not on then
        for _, slot in pairs(slots) do
            slot:Hide()
        end
        return
    end
    if not (C_UnitAuras and C_UnitAuras.AddPrivateAuraAnchor) then
        report.error = "C_UnitAuras.AddPrivateAuraAnchor is not available on this client"
        return
    end

    local top = -(size + slotRowOffset())
    for index = 1, MAX_SLOTS do
        local slot = slots[index]
        if not slot then
            slot = CreateFrame("Frame", nil, frame)
            slots[index] = slot
        end
        if index <= count then
            slot:SetSize(size, size)
            slot:ClearAllPoints()
            local point, x = rowPoint(index)
            slot:SetPoint(point, frame, point, x, top)
            slot:Show()
            local args = {
                unitToken = "player",
                auraIndex = index,
                parent = slot,
                showCooldownFrame = Debuffs:Get("swipe") and true or false,
                showCooldownEdge = (Debuffs:Get("swipe") and Debuffs:Get("swipeEdge")) and true or false,
                showCountdownNumbers = Debuffs:SwipeNumbers(),
                showDispelIcon = Debuffs:DispelIcon(),
                isContainer = false,
                iconInfo = {
                    iconAnchor = { point = "CENTER", relativeTo = slot, relativePoint = "CENTER", offsetX = 0, offsetY = 0 },
                    iconWidth = size,
                    iconHeight = size,
                    borderScale = Debuffs:Get("borderScale") or 1,
                },
            }
            -- The game always draws its timer text, so to hide it, it goes far off the top of the screen.
            if timerPoint then
                args.durationAnchor = { point = timerPoint, relativeTo = slot, relativePoint = timerRelative, offsetX = timerX, offsetY = timerY }
            else
                args.durationAnchor = { point = "BOTTOM", relativeTo = UIParent, relativePoint = "TOP", offsetX = 0, offsetY = 2000 }
            end
            local ok, id = pcall(C_UnitAuras.AddPrivateAuraAnchor, args)
            if ok and id then
                anchorIds[index] = id
            else
                note("private aura anchor " .. index .. " failed: " .. tostring(id))
            end
        else
            slot:Hide()
        end
    end
end

-- The look of one debuff, shared by the container's buttons and the preview tiles -------------

-- The countdown's text for seconds left: whole seconds with no unit under a minute (rounded up, so
-- the last second reads 1), m:ss from 60 seconds. The game's formatter (timeFormatter) follows the
-- same rules for the real debuffs. A time between 59 and 60 reads 59, as the formatter clamps it.
-- nil for a secret or missing value, which is never compared.
function Panel.FormatTime(seconds)
    if isSecret(seconds) or type(seconds) ~= "number" then
        return nil
    end
    if seconds >= 60 then
        local whole = math.ceil(seconds)
        return format("%d:%02d", math.floor(whole / 60), whole % 60)
    end
    return tostring(math.max(0, math.min(59, math.ceil(seconds))))
end

-- The stacks' text, as the game fills it: the count from 2 up, nothing for one stack.
function Panel.StackText(count)
    if isSecret(count) or type(count) ~= "number" or count < 2 then
        return ""
    end
    return tostring(count)
end

-- The countdown's font size for an icon size: big on the icon, smaller beside it.
function Panel.TimerFontSize(size)
    local scale = Debuffs:Get("timerPosition") == "center" and LOOK.timerScale or LOOK.besideScale
    return math.max(LOOK.minTimer, math.floor(size * scale + 0.5))
end

function Panel.StackFontSize(size)
    return math.max(LOOK.minStack, math.floor(size * LOOK.stackScale + 0.5))
end

-- The General Settings font's file, or the game's own font when that is the default.
local function fontPath()
    local ui = CRT.db and CRT.db.ui
    local path = ui and CRT.FontPath and CRT:FontPath(ui.font)
    return path or LOOK.font
end

-- The countdown's and the stacks' font, size and color. The game may have made a text's color secret
-- once it fills it, so each call is guarded.
local function styleText(parts, size)
    local path = fontPath()
    local timerSize = Panel.TimerFontSize(size)
    pcall(parts.time.SetFont, parts.time, path, timerSize, timerSize >= LOOK.thickFrom and "THICKOUTLINE" or "OUTLINE")
    local c = LOOK.timerColor
    pcall(parts.time.SetTextColor, parts.time, c[1], c[2], c[3])
    pcall(parts.count.SetFont, parts.count, path, Panel.StackFontSize(size), "OUTLINE")
    c = LOOK.stackColor
    pcall(parts.count.SetTextColor, parts.count, c[1], c[2], c[3])
end

-- The swipe: the game's cooldown drives it from the debuff's own time, so the addon never reads the
-- time. Reversed (the dark part grows), the look's muted color, the edge line only when the Bright
-- edge box is ticked, and no bling when it ends.
local function applyCooldownLook(cooldown)
    pcall(cooldown.SetDrawSwipe, cooldown, Debuffs:Get("swipe") and true or false)
    pcall(cooldown.SetReverse, cooldown, true)
    local c = LOOK.swipeColor
    pcall(cooldown.SetSwipeColor, cooldown, c[1], c[2], c[3], c[4])
    pcall(cooldown.SetDrawEdge, cooldown, (Debuffs:Get("swipe") and Debuffs:Get("swipeEdge")) and true or false)
    pcall(cooldown.SetDrawBling, cooldown, false)
    pcall(cooldown.SetHideCountdownNumbers, cooldown, not Debuffs:SwipeNumbers())
end

-- The parts of a debuff on a frame (a container button or a preview tile): border, icon, swipe, timer
-- text and stacks on a frame above the swipe, and the dispel type icon. Behind the icon: the plain
-- border, and the dispel type's border over it. The glow is on its own frame, raised over the other
-- icons (raiseParts); it never takes the mouse.
-- Whether the game has the glow's atlas. Checked once; a missing one is noted for the diagnostics.
local glowAtlas
local function hasGlowAtlas()
    if glowAtlas == nil then
        glowAtlas = (C_Texture and C_Texture.GetAtlasInfo and C_Texture.GetAtlasInfo(GLOW_ATLAS)) and true or false
        if not glowAtlas then
            note("the glow atlas " .. GLOW_ATLAS .. " is missing, so there is no glow")
        end
    end
    return glowAtlas
end

-- An owner's frame level, or nil when the game hides it or won't give it.
local function frameLevel(owner)
    local ok, level = pcall(owner.GetFrameLevel, owner)
    if not ok or isSecret(level) or type(level) ~= "number" then
        return nil
    end
    return level
end

local function makeParts(owner)
    local parts = {}
    parts.glowFrame = CreateFrame("Frame", nil, owner)
    parts.glowFrame:SetAllPoints()
    parts.glowFrame:EnableMouse(false)
    parts.glow = parts.glowFrame:CreateTexture(nil, "BACKGROUND", nil, -1)
    parts.glow:SetPoint("CENTER")
    if hasGlowAtlas() then
        parts.glow:SetAtlas(GLOW_ATLAS)
        parts.glow:SetAlpha(GLOW_ALPHA)
    end
    parts.glow:SetBlendMode("ADD")
    parts.glow:Hide()
    parts.border = owner:CreateTexture(nil, "BACKGROUND")
    parts.border:SetPoint("CENTER")
    parts.dispelBorder = owner:CreateTexture(nil, "BACKGROUND", nil, 1)
    parts.dispelBorder:SetPoint("CENTER")
    parts.dispelBorder:SetTexture(WHITE)
    parts.dispelBorder:Hide()
    parts.bevel = owner:CreateTexture(nil, "BACKGROUND", nil, 2)
    parts.bevel:SetPoint("CENTER")
    local b = LOOK.bevelColor
    parts.bevel:SetColorTexture(b[1], b[2], b[3], b[4])
    parts.icon = owner:CreateTexture(nil, "ARTWORK")
    parts.icon:SetAllPoints()
    parts.icon:SetTexCoord(0.07, 0.93, 0.07, 0.93)
    local ok, cooldown = pcall(CreateFrame, "Cooldown", nil, owner, "CooldownFrameTemplate")
    if ok and cooldown then
        cooldown:SetAllPoints(parts.icon)
        parts.cooldown = cooldown
    else
        note("could not create a Cooldown frame")
    end
    -- The text sits on its own frame above the swipe, so the swipe never covers it.
    parts.over = CreateFrame("Frame", nil, owner)
    parts.over:SetAllPoints()
    local level = frameLevel(owner)
    if level then
        pcall(parts.over.SetFrameLevel, parts.over, level + TEXT_LEVEL) -- raiseParts keeps it there
    end
    -- Made from the addon's fonts, then given the look's font, size and color (styleText).
    parts.time = parts.over:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    parts.count = parts.over:CreateFontString(nil, "OVERLAY", "CRTFontHighlight")
    parts.count:SetPoint("BOTTOMRIGHT", -LOOK.stackInset, LOOK.stackInset)
    parts.count:SetJustifyH("RIGHT")
    styleText(parts, Debuffs:Size())
    parts.dispel = parts.over:CreateTexture(nil, "OVERLAY")
    parts.dispel:SetPoint("TOPRIGHT", -1, -1)
    return parts
end

-- Raises the glow over every icon in the row and the text over the glow, as levels above the owner's
-- own. Every icon in a row shares one level, so this puts the glow over its neighbours. Done each time
-- the parts are laid out, in case the game has moved the owner's level. A level the game hides or
-- won't give leaves the parts where they are.
local function raiseParts(owner, parts)
    local level = frameLevel(owner)
    if not level then
        return
    end
    pcall(parts.glowFrame.SetFrameLevel, parts.glowFrame, level + GLOW_LEVEL)
    pcall(parts.over.SetFrameLevel, parts.over, level + TEXT_LEVEL)
end

-- Size, frame, swipe, text and where the timer text goes, the same for a button and a tile.
local function layoutParts(owner, parts, size)
    pcall(owner.SetSize, owner, size, size) -- a container button may be set up in combat
    raiseParts(owner, parts)
    local edge = Debuffs:Edge()
    parts.border:SetSize(size + edge, size + edge)
    local plain = Debuffs.BORDER_COLOR
    parts.border:SetColorTexture(plain[1], plain[2], plain[3], plain[4])
    parts.border:SetShown(edge > 0)
    local bevel = size + 2 * LOOK.bevelWidth
    parts.bevel:SetSize(bevel, bevel)
    parts.bevel:SetShown(edge >= LOOK.bevelMinEdge)
    parts.dispelBorder:SetSize(size + edge, size + edge)
    local glow = size + edge + 2 * math.max(4, math.floor(size * 0.2))
    parts.glow:SetSize(glow, glow)
    local mark = math.max(10, math.floor(size * Debuffs:DispelIconScale()))
    parts.dispel:SetSize(mark, mark)
    if parts.cooldown then
        applyCooldownLook(parts.cooldown)
    end
    styleText(parts, size)
    local timerPoint, timerRelative, timerX, timerY = Debuffs:TimerAnchor()
    parts.time:ClearAllPoints()
    if timerPoint then
        parts.time:SetPoint(timerPoint, owner, timerRelative, timerX, timerY)
    end
    return timerPoint ~= nil
end

-- The timer text for the real debuffs, through the game's number formatter (C_StringUtil, 12.0.5),
-- with Panel.FormatTime's rules: whole seconds rounded up and held at 59 under a minute, then minutes
-- and seconds, each part rounded down from the whole seconds (NumericRuleFormatComponent's div and
-- mod). The game runs it on the secret time left, so the addon never sees the number. Without
-- minutes and seconds (an older client refusing the components) it falls back to seconds only, and
-- without the formatter to the game's own text.
local formatter, formatterNote
local function timeBreakpoints(withMinutes)
    local rounding = Enum and Enum.NumericRuleFormatRounding
    local up, down = rounding and rounding.Up, rounding and rounding.Down
    local seconds = { threshold = 0, step = 1, rounding = up, format = "%.0f" }
    if not withMinutes then
        return { seconds }
    end
    seconds.max = 59
    return { seconds, { threshold = 60, step = 1, rounding = up, format = "%.0f:%02.0f", components = {
        { div = 60, step = 1, rounding = down },
        { mod = 60, step = 1, rounding = down },
    } } }
end

local function timeFormatter()
    if formatter == nil then
        formatter = false
        if C_StringUtil and C_StringUtil.CreateNumericRuleFormatter then
            local ok, f = pcall(C_StringUtil.CreateNumericRuleFormatter)
            if ok and f then
                if pcall(f.SetBreakpoints, f, timeBreakpoints(true)) then
                    formatter, formatterNote = f, "m:ss from a minute"
                elseif pcall(f.SetBreakpoints, f, timeBreakpoints(false)) then
                    formatter, formatterNote = f, "seconds only"
                    note("the time formatter refused minutes and seconds, so long debuffs show seconds")
                end
            end
        end
        if not formatter then
            note("the game's number formatter is missing, so the timer uses the game's own text")
        end
    end
    return formatter or nil
end

-- The game's dispel type texture styles (Enum.CustomAuraButtonDispelTypeTextureStyle): Icon swaps the
-- texture for the type's icon; PreserveAsset keeps the texture as it is, so the border stays a plain
-- square and the glow keeps its glow.
local function dispelStyle(name)
    local styles = Enum and Enum.CustomAuraButtonDispelTypeTextureStyle
    return type(styles) == "table" and styles[name or "Icon"] or nil
end

-- Each dispel type's color as the game's color objects, keyed by type name (the options'
-- customDispelColorMap): the game tints the border and glow with the one for the debuff's type, so
-- the addon never sees the type. Built once, the first time it is needed.
local colorMap
local function dispelColorMap()
    if colorMap == nil then
        colorMap = false
        if type(CreateColor) == "function" then
            local map = {}
            for kind in pairs(Debuffs.DISPEL_COLORS) do
                local r, g, b = Debuffs:DispelColor(kind)
                map[kind] = CreateColor(r, g, b, 1)
            end
            colorMap = map
        else
            note("CreateColor is missing, so the dispel border has no colors")
        end
    end
    return colorMap or nil
end

-- Hides a dispel border or glow the game no longer fills. The game may have made its shown state
-- secret, so the call is guarded.
local function hidePart(texture)
    pcall(texture.Hide, texture)
end

-- The frame's dispel color, and its glow, on a container button. The game fills both: it shows them
-- only on a debuff that has a dispel type, tinted that type's color from the color map, so a debuff
-- with none keeps the dark frame. Both need a border size above 0.
local function wireDispelBorder(button, parts)
    local style = dispelStyle("PreserveAsset")
    local edge = Debuffs:Edge()
    local options = { style = style, showWhenHarmful = true, showWhenHelpful = false, showWithoutDispelType = false,
        customDispelColorMap = dispelColorMap() }
    if edge > 0 and style ~= nil then
        try("button", button, "AddDispelTypeTexture", parts.dispelBorder, options)
    else
        hidePart(parts.dispelBorder)
    end
    if Debuffs:DispelGlow() and edge > 0 and style ~= nil and hasGlowAtlas() then
        try("button", button, "AddDispelTypeTexture", parts.glow, options)
    else
        hidePart(parts.glow)
    end
end

-- Whether the buttons take hover for the game's tooltip, where it opens (UI.TooltipAnchor), and the two
-- as one string, to tell when they change.
local function tooltipState()
    local on = Debuffs:Tooltips() and Debuffs:Enabled() and not previewOn
    local anchor, x, y = CRT.UI.TooltipAnchor(TOOLTIP_AREA, TOOLTIP_SIDE, 0, 0, Debuffs:Size())
    return on, anchor, x, y, table.concat({ tostring(on), anchor, x, y }, ":")
end

-- Hover on or off for one button, and the anchor of the game's tooltip on it, kept in combat too
-- (SetHideTooltipInCombat). Hover only: the button's clicks are left as they are.
local function wireTooltip(button)
    local on, anchor, x, y = tooltipState()
    if on then
        try("button", button, "SetTooltipAnchorPoint", anchor, x, y)
        try("button", button, "SetHideTooltipInCombat", false)
    end
    try("button", button, "SetMouseMotionEnabled", on)
end

-- Gives every button the hover and anchor again when either has changed (the box, a preview, the panel
-- turned on or off, the icon size, or a Tooltip position here or on General Settings). Out of combat only,
-- from layout(). A forbidden button is skipped and the change tried again at the next layout.
local function applyTooltips()
    local signature = select(5, tooltipState())
    if signature == appliedTooltips then
        return
    end
    local all = true
    for button in pairs(buttons) do
        if forbidden(button) then
            all = false
        else
            wireTooltip(button)
        end
    end
    appliedTooltips = all and signature or nil
end

-- Points a container button's parts at the game: what it fills, and what it leaves out (the Clear
-- calls), so a setting turned off stops showing at once.
local function wireButton(button, parts)
    if forbidden(button) or forbidden(parts.icon) or forbidden(parts.border) or forbidden(parts.over) or forbidden(parts.dispelBorder)
        or forbidden(parts.bevel) or forbidden(parts.glowFrame) or forbidden(parts.glow) then
        dirty[button] = true
        skipped = skipped + 1
        pendingApply = true
        return false
    end
    dirty[button] = nil
    local size = Debuffs:Size()
    local timerShown = layoutParts(button, parts, size)
    if parts.cooldown and (Debuffs:Get("swipe") or Debuffs:SwipeNumbers()) then
        parts.cooldown:Show()
        try("button", button, "SetDurationCooldown", parts.cooldown)
    else
        if parts.cooldown then
            parts.cooldown:Hide()
        end
        try("button", button, "ClearDurationCooldown")
    end
    if timerShown then
        parts.time:Show()
        local f = timeFormatter()
        try("button", button, "SetDurationText", parts.time, f and { textFormatter = f } or {})
    else
        parts.time:Hide()
        try("button", button, "ClearDurationText")
    end
    try("button", button, "SetApplicationCount", parts.count, {})
    try("button", button, "ClearDispelTypeTextures")
    local style = dispelStyle()
    if Debuffs:DispelIcon() and style ~= nil then
        parts.dispel:Show()
        try("button", button, "AddDispelTypeTexture", parts.dispel, { style = style, showWhenHarmful = true, showWhenHelpful = false })
    else
        parts.dispel:Hide()
    end
    wireDispelBorder(button, parts)
    wireTooltip(button)
    return true
end

-- The container calls this once for each button it makes; the button is the first argument.
local function initializeButton(button)
    if type(button) ~= "table" then
        note("initializeFrame was called without an aura button")
        return
    end
    if forbidden(button) then
        dirty[button] = true
        skipped = skipped + 1
        pendingApply = true
        return
    end
    if not button.SetIcon then
        note("initializeFrame was called without an aura button")
        return
    end
    local parts = buttons[button]
    if not parts then
        parts = makeParts(button)
        buttons[button] = parts
        try("button", button, "SetIcon", parts.icon)
        pcall(button.SetMouseMotionEnabled, button, false) -- no hover until wireTooltip says so
    end
    wireButton(button, parts)
end

-- The container (the panel's row) -------------------------------------------------------------

local function sortOptions()
    local methods = _G.AuraContainerSortMethod or (Enum and Enum.AuraContainerSortMethod)
    local directions = _G.AuraContainerSortDirection or (Enum and Enum.AuraContainerSortDirection)
    local method = type(methods) == "table" and (methods.ExpirationOnly or methods.Expiration) or nil
    local direction = type(directions) == "table" and directions.Normal or nil
    report.sort = method ~= nil and "shortest first" or "the game's default"
    return method, direction
end

local function groupLayout()
    local size = Debuffs:Size()
    return { elementWidth = size, elementHeight = size, elementSpacing = Debuffs:Step(size) - size }
end

-- The flow layout: one row from the top left growing right, or from the top right growing left (the
-- Grow setting). The game's flow layout (AnchorUtil.ApplyFlowLayout) anchors each button to the
-- container's anchor point and then sizes the container to its buttons, so for "left" the container
-- is held by its top right corner too, keeping the first debuff at the panel's right end.
local function applyContainerLayout()
    if not container or not safeToWire() or forbidden(container) then
        return
    end
    local width, size = rowWidth()
    local grow = Debuffs:Grow()
    local signature = width .. ":" .. size .. ":" .. grow
    if signature == appliedContainer then
        return
    end
    appliedContainer = signature
    local point = rowPoint(1)
    container:ClearAllPoints()
    container:SetPoint(point, frame, point, 0, 0)
    container:SetSize(width, size)
    local axis = AnchorUtil and AnchorUtil.FlowLayoutAxis and AnchorUtil.FlowLayoutAxis.Horizontal or 0
    local flow = AnchorUtil and AnchorUtil.FlowDirection
    local horizontal
    if grow == "left" then
        horizontal = flow and flow.Left or -1
    else
        horizontal = flow and flow.Right or 1
    end
    try("container", container, "SetFlowLayoutAxis", axis)
    try("container", container, "SetFlowLayoutAnchorPoint", point)
    try("container", container, "SetFlowLayoutGrowthDirection", horizontal, flow and flow.Down or -1)
    try("container", container, "SetFlowLayoutMaximumLineSize", width)
    try("container", container, "SetAuraGroupLayout", GROUP, groupLayout())
end

local function loadContainerAddon()
    if C_AddOns and C_AddOns.IsAddOnLoaded and not C_AddOns.IsAddOnLoaded(CONTAINER_ADDON) then
        local ok, loaded, reason = pcall(C_AddOns.LoadAddOn, CONTAINER_ADDON)
        if not ok or not loaded then
            note("LoadAddOn(" .. CONTAINER_ADDON .. ") failed: " .. tostring(ok and reason or loaded))
        end
    end
    report.loaded = C_AddOns and C_AddOns.IsAddOnLoaded and C_AddOns.IsAddOnLoaded(CONTAINER_ADDON) or false
end

local function createContainer()
    loadContainerAddon()
    for _, template in ipairs(TEMPLATES) do
        local ok, c = pcall(CreateFrame, "AuraContainer", nil, frame, template)
        if ok and c then
            container, report.template = c, template
            break
        end
        note("CreateFrame(\"AuraContainer\", \"" .. template .. "\") failed: " .. tostring(c))
    end
    if not container then
        return false
    end
    try("container", container, "SetUnit", "player")
    local method, direction = sortOptions()
    report.created = try("container", container, "AddAuraGroup", GROUP, "HARMFUL", {
        maxFrameCount = Debuffs:MaxCount(),
        initializeFrame = initializeButton,
        sortMethod = method,
        sortDirection = direction,
        candidateFilters = Debuffs:CandidateFilters(),
        layout = groupLayout(),
    })
    container:Show()
    try("container", container, "SetEnabled", true)
    appliedContainer = nil
    applyContainerLayout()
    try("container", container, "UpdateAllAuras")
    return report.created
end

-- Sizes the panel and its rows. Out of combat only.
local function layout()
    if not frame or not safeToWire() then
        return
    end
    sizeFrame()
    addAnchors()
    applyContainerLayout()
    applyTooltips()
    notifyLayout()
end

-- Preview tiles ----------------------------------------------------------------------
-- Sample debuffs in the same parts, size, spacing and look as the container's buttons, so the panel
-- can be placed and sized out of combat.

-- left is the seconds remaining when the preview starts. Each sample runs for SAMPLE_SECONDS (or its
-- own length), then starts over, so the swipe and the timer keep moving. One runs over a minute, to
-- show the m:ss countdown.
local SAMPLE_SECONDS = 30
local SAMPLES = {
    { spell = 589, left = 12, dispel = "Magic" },
    { spell = 116, left = 8, dispel = "Curse" },
    { spell = 172, left = 21, stacks = 3 },
    { spell = 703, left = 27, dispel = "Poison" },
    { spell = 348, left = 5, dispel = "Disease" },
    { spell = 686, left = 17, stacks = 2, dispel = "Magic" },
    { spell = 980, left = 103, length = 120 },
    { spell = 1022, left = 9, dispel = "Curse" },
}
Panel.SAMPLES = SAMPLES
-- The game's raid frame dispel type icons, for the samples.
local DISPEL_ICONS = {
    Magic = "Interface\\RaidFrame\\Raid-Icon-DebuffMagic",
    Curse = "Interface\\RaidFrame\\Raid-Icon-DebuffCurse",
    Poison = "Interface\\RaidFrame\\Raid-Icon-DebuffPoison",
    Disease = "Interface\\RaidFrame\\Raid-Icon-DebuffDisease",
}

local function sampleIcon(spellId)
    local ok, icon = pcall(C_Spell.GetSpellTexture, spellId)
    if ok and icon then
        return icon
    end
    return "Interface\\Icons\\INV_Misc_QuestionMark"
end

local function updateTiles()
    if not frame then
        return
    end
    local size, count = Debuffs:Size(), Debuffs:MaxCount()
    for index = 1, MAX_SLOTS do
        local tile = tiles[index]
        if not tile then
            tile = CreateFrame("Frame", nil, frame)
            tile.parts = makeParts(tile)
            tile:Hide()
            tiles[index] = tile
        end
        if previewOn and index <= count then
            local sample, parts = SAMPLES[index], tile.parts
            tile:ClearAllPoints()
            local point, x = rowPoint(index)
            tile:SetPoint(point, frame, point, x, 0)
            local timerShown = layoutParts(tile, parts, size)
            parts.icon:SetTexture(sampleIcon(sample.spell))
            parts.count:SetText(Panel.StackText(sample.stacks))
            parts.time:SetShown(timerShown)
            if parts.cooldown then
                parts.cooldown:SetShown(Debuffs:Get("swipe") or Debuffs:SwipeNumbers())
            end
            local dispel = Debuffs:DispelIcon() and sample.dispel and DISPEL_ICONS[sample.dispel]
            parts.dispel:SetTexture(dispel or nil)
            parts.dispel:SetShown(dispel and true or false)
            -- The samples' dispel types are the addon's own, so their frame is colored here.
            local typed = sample.dispel ~= nil
            local edge = Debuffs:Edge()
            local r, g, b = Debuffs:DispelColor(sample.dispel)
            parts.dispelBorder:SetVertexColor(r, g, b, 1)
            parts.dispelBorder:SetShown(typed and edge > 0)
            parts.glow:SetVertexColor(r, g, b, 1)
            parts.glow:SetShown(Debuffs:DispelGlow() and typed and edge > 0 and hasGlowAtlas())
            if not tile.endsAt then
                tile.length = sample.length or SAMPLE_SECONDS
                tile.endsAt = GetTime() + sample.left
                tile.timeText = Panel.FormatTime(sample.left)
                parts.time:SetText(tile.timeText)
                if parts.cooldown then
                    parts.cooldown:SetCooldown(tile.endsAt - tile.length, tile.length)
                end
            end
            tile:Show()
        else
            tile.endsAt = nil
            tile:Hide()
        end
    end
end

-- Counts the preview timers down, and starts a sample over when it runs out.
local function tickTiles()
    if not previewOn then
        return
    end
    local now = GetTime()
    for _, tile in ipairs(tiles) do
        if tile:IsShown() and tile.endsAt then
            if tile.endsAt <= now then
                tile.endsAt = now + tile.length
                if tile.parts.cooldown then
                    tile.parts.cooldown:SetCooldown(now, tile.length)
                end
            end
            -- Set only when the text changes: once a second, or less from a minute up.
            local text = Panel.FormatTime(tile.endsAt - now)
            if text ~= tile.timeText then
                tile.timeText = text
                tile.parts.time:SetText(text)
            end
        end
    end
end

-- Position and visibility -----------------------------------------------------------
-- Its place, drag, nudge and reset are the shared helper's (UI/Placement.lua). The panel is held by the corner
-- its row grows from (rowPoint(1)): its top left for left to right, its top right for right to left, so a change
-- of width moves only the other end. A position saved at any other point (one from before, or the other Grow) is
-- turned into that corner, at the same place on screen, and saved again (keepPoint). It holds the boss debuff
-- slots' private aura anchors, so it is never anchored to another element; another element may anchor to it.

local function corner()
    return (rowPoint(1))
end

placement = CRT.UI.Placement.Define("debuffs", {
    title = "Debuff panel",
    store = function()
        return Debuffs:PositionStore()
    end,
    default = Debuffs.DEFAULT_POSITION,
    point = corner,
    relativePoint = "CENTER",
    keepPoint = true,
    size = function()
        return frameWidth, frameHeight
    end,
    canAnchor = false,
    protected = true,
})

local function applyPosition()
    placement:Apply()
end

-- Shows the panel whenever it is turned on, in and out of combat, anywhere: only the settings (the
-- candidate filters) decide which debuffs it holds. Always while previewing. Alpha, not Show, because
-- showing and hiding may be blocked in combat. It runs every frame, so a missed event cannot leave it
-- stuck. During a preview the real row is faded out, so only the samples show.
local function updateVisibility()
    if not frame then
        return
    end
    local visible = previewOn or Debuffs:Enabled()
    local alpha = visible and 1 or 0
    if frame:GetAlpha() ~= alpha then
        frame:SetAlpha(alpha)
    end
    if container and not forbidden(container) then
        local real = previewOn and 0 or 1
        if container:GetAlpha() ~= real then
            container:SetAlpha(real)
        end
    end
    if handle then
        handle:SetShown(previewOn)
    end
end

-- The drag handle sits above the icons, or above their timer text when it is placed above them (the
-- text grows with the icon).
local function placeHandle()
    if not handle then
        return
    end
    local lift = Debuffs:Get("timerPosition") == "above" and (Panel.TimerFontSize(Debuffs:Size()) + 4) or 0
    handle:ClearAllPoints()
    handle:SetPoint("BOTTOMLEFT", frame, "TOPLEFT", 0, 2 + lift)
    handle:SetPoint("BOTTOMRIGHT", frame, "TOPRIGHT", 0, 2 + lift)
end

-- Applies the settings: position, the container's group options, and every button's look. In combat
-- or during an encounter it waits (pendingApply) for PLAYER_REGEN_ENABLED or ENCOUNTER_END.
function Panel:Apply()
    if not frame then
        return
    end
    if not safeToWire() then
        pendingApply = true
        return
    end
    pendingApply = false
    lastApply = GetTime()
    if CRT.UI.Placement.Dragging() ~= placement then
        applyPosition()
    end
    if container and forbidden(container) then
        pendingApply = true -- tried again at the next safe moment
    elseif container then
        try("container", container, "SetAuraGroupMaxFrameCount", GROUP, Debuffs:MaxCount())
        try("container", container, "SetAuraGroupCandidateFilters", GROUP, Debuffs:CandidateFilters())
        local method, direction = sortOptions()
        if method ~= nil then
            try("container", container, "SetAuraGroupSortMethod", GROUP, method, direction)
        end
        appliedContainer = nil
    end
    layout()
    for button, parts in pairs(buttons) do
        wireButton(button, parts)
    end
    for button in pairs(dirty) do
        if not buttons[button] then
            initializeButton(button)
        end
    end
    if container and not forbidden(container) then
        try("container", container, "SetEnabled", true)
        try("container", container, "UpdateAllAuras")
    end
    placeHandle()
    updateTiles()
    updateVisibility()
end

function Panel:SetPreview(on)
    previewOn = on and true or false
    updateTiles()
    layout()
    updateVisibility()
    if self.onPreviewChange then
        self.onPreviewChange(previewOn)
    end
end

function Panel:IsPreviewing()
    return previewOn
end

function Panel:ResetPosition()
    placement:Reset()
end

local function build()
    if frame then
        return
    end
    frame = CreateFrame("Frame", "CowfeeRaidToolsDebuffPanel", UIParent)
    CRT.UI:RegisterLayer("debuffs", frame)
    frame:SetClampedToScreen(true)
    sizeFrame()
    frame:SetAlpha(0)

    -- A drag handle above the panel, shown during a preview. It is a separate frame, not a child,
    -- so it keeps its own visibility.
    handle = CreateFrame("Frame", nil, UIParent, "BackdropTemplate")
    CRT.UI:RegisterLayer("debuffs", handle)
    handle:SetHeight(20)
    handle:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    handle:SetBackdropColor(0.35, 0.1, 0.1, 0.9)
    handle:SetBackdropBorderColor(0.9, 0.3, 0.3, 1)
    local text = handle:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    text:SetPoint("CENTER")
    text:SetText("Debuffs: drag to move")
    local reset = CRT.UI.ResetButton(handle, function()
        Panel:ResetPosition()
    end)
    reset:SetPoint("RIGHT", -2, 0)
    handle:Hide()
    placeHandle()
    -- dragged by its handle and saved from its fixed corner
    placement:Attach(frame, handle, { reset = reset })

    createContainer()
    layout()

    frame:SetScript("OnUpdate", function(_, dt)
        updateVisibility()
        elapsed = elapsed + dt
        if elapsed < REFRESH_SECONDS then
            return
        end
        elapsed = 0
        -- a change that waited for combat or an encounter to end, or buttons skipped while forbidden
        if pendingApply and safeToWire() and GetTime() - lastApply >= RETRY_SECONDS then
            Panel:Apply()
        end
        layout()
        tickTiles()
    end)
    updateVisibility()
end

-- Diagnostics: what was built, what failed, and what the game offers. --------------------

-- Text for any value. A secret value is printed as "(secret)", because joining one into text is an
-- error, and the size and position of some frames are secret.
local function safe(value)
    if isSecret(value) then
        return "(secret)"
    end
    return tostring(value)
end

local function describe(value, depth)
    if isSecret(value) then
        return "(secret)"
    end
    local kind = type(value)
    if kind == "table" then
        if depth <= 0 then
            return "{...}"
        end
        local parts = {}
        for k, v in pairs(value) do
            parts[#parts + 1] = safe(k) .. "=" .. describe(v, depth - 1)
            if #parts >= 40 then
                parts[#parts + 1] = "..."
                break
            end
        end
        table.sort(parts)
        return "{" .. table.concat(parts, ", ") .. "}"
    elseif kind == "function" then
        return "function"
    end
    return safe(value)
end

function Panel:InfoText()
    local lines = {}
    local function add(text)
        lines[#lines + 1] = text
    end

    add("Debuff panel diagnostics")
    add("Game build: " .. tostring(select(4, GetBuildInfo())))
    add("In combat: lockdown " .. tostring(InCombatLockdown()) .. ", flag " .. tostring(inCombat) .. ", UnitAffectingCombat " .. tostring(UnitAffectingCombat("player")) .. "; preview on: " .. tostring(previewOn) .. ", enabled: " .. tostring(Debuffs:Enabled()))
    local dirtyCount = 0
    for _ in pairs(dirty) do
        dirtyCount = dirtyCount + 1
    end
    add("Encounter in progress: " .. tostring(encounterActive()) .. " (flag " .. tostring(encounter) .. "), safe to set up buttons: " .. tostring(safeToWire())
        .. ", settings waiting: " .. tostring(pendingApply) .. ", forbidden buttons skipped: " .. skipped .. " (" .. dirtyCount .. " waiting)")
    local tipOn, tipAnchor, tipX, tipY = tooltipState()
    add(format("Settings: size %d, max %d, dispel icon %s, dispel icon size %d%%, hide longer than %s, boss debuff slots %s, grow %s, tooltips %s (hover %s, %s %s,%s)",
        Debuffs:Size(), Debuffs:MaxCount(), tostring(Debuffs:DispelIcon()), math.floor(Debuffs:DispelIconScale() * 100 + 0.5),
        Debuffs:MaxDuration() > 0 and (Debuffs:MaxDuration() .. " s") or "off", tostring(Debuffs:PrivateSlots()), Debuffs:Grow(),
        tostring(Debuffs:Tooltips()), tostring(tipOn), tostring(tipAnchor), tostring(tipX), tostring(tipY)))
    add(format("Look: swipe %s, edge %s, countdown numbers %s, timer %s (%s, %s), border %s, spacing %d (%g px from icon to icon), frame colored by dispel type, glow %s", tostring(Debuffs:Get("swipe")),
        tostring(Debuffs:Get("swipeEdge")), tostring(Debuffs:SwipeNumbers()), tostring(Debuffs:Get("timerPosition")), tostring(Debuffs:Get("timerX")),
        tostring(Debuffs:Get("timerY")), tostring(Debuffs:Get("borderScale")), Debuffs:Spacing(), Debuffs:Step(Debuffs:Size()), tostring(Debuffs:DispelGlow())))
    add(format("Text: countdown %d px, stacks %d px, font %s, time format %s", Panel.TimerFontSize(Debuffs:Size()), Panel.StackFontSize(Debuffs:Size()),
        fontPath(), tostring(timeFormatter() and formatterNote or "the game's own")))
    if frame then
        local point, _, relativePoint, x, y = frame:GetPoint()
        add(format("Panel: alpha %s, shown %s, effective alpha %s, size %s x %s, at %s %s %s,%s",
            safe(frame:GetAlpha()), tostring(frame:IsShown()), safe(frame:GetEffectiveAlpha()),
            safe(frame:GetWidth()), safe(frame:GetHeight()), tostring(point), tostring(relativePoint), safe(x), safe(y)))
    else
        add("Panel: not built")
    end
    if report.error then
        add("Error: " .. report.error)
    end

    -- The container.
    add("")
    add("Debuff row (Blizzard AuraContainer):")
    add("  " .. CONTAINER_ADDON .. " loaded: " .. tostring(report.loaded))
    add("  created: " .. tostring(container ~= nil) .. (report.template and (" (template " .. report.template .. ")") or "")
        .. ", aura group added: " .. tostring(report.created) .. ", sort: " .. tostring(report.sort))
    add("  group filter: HARMFUL, candidate filters: " .. describe(Debuffs:CandidateFilters(), 2))
    -- The game leaves out a spell ID only for a spell it flags never secret (Data.lua, Debuffs.CanHide).
    local hideable = {}
    for _, list in ipairs({ Debuffs:BuiltInList(), Debuffs:IgnoredList() }) do
        for _, id in ipairs(list) do
            local can = Debuffs.CanHide(id)
            hideable[#hideable + 1] = id .. "=" .. (can == true and "yes" or can == false and "no" or "?")
        end
    end
    add("  the game lets addons hide (never secret): " .. table.concat(hideable, ", "))
    add("  dispel icon style: " .. tostring(dispelStyle()) .. ", dispel border style: " .. tostring(dispelStyle("PreserveAsset")) .. ", time formatter: " .. tostring(timeFormatter() ~= nil))
    if container and forbidden(container) then
        add("  the container is forbidden right now (an encounter), so its frames can't be read")
    elseif container then
        local count = "?"
        local ok, n = pcall(container.GetAuraGroupFrameCount, container, GROUP)
        if ok and type(n) == "number" and not isSecret(n) then
            count = tostring(n)
        end
        local built = 0
        for _ in pairs(buttons) do
            built = built + 1
        end
        add("  live frames: " .. count .. ", buttons built: " .. built .. ", shown " .. tostring(container:IsShown())
            .. ", alpha " .. safe(container:GetAlpha()))
    end

    -- The boss debuff slots.
    add("")
    add("Boss debuff slots (private aura anchors, the fallback row): " .. (Debuffs:PrivateSlots() and "on" or "off"))
    add("  C_UnitAuras.AddPrivateAuraAnchor available: " .. tostring(C_UnitAuras and C_UnitAuras.AddPrivateAuraAnchor ~= nil))
    local made = 0
    for _ in pairs(anchorIds) do
        made = made + 1
    end
    add("  anchors added: " .. made)
    for index = 1, Debuffs:MaxCount() do
        local slot = slots[index]
        if slot and anchorIds[index] then
            local point, _, _, x, y = slot:GetPoint()
            add(format("  slot %d: anchor id %s, size %s x %s, at %s %s,%s", index, tostring(anchorIds[index]), safe(slot:GetWidth()), safe(slot:GetHeight()), tostring(point), safe(x), safe(y)))
        end
    end

    add("")
    add("Notes from setup:")
    if #report.notes == 0 then
        add("  none")
    end
    for _, text in ipairs(report.notes) do
        add("  " .. text)
    end
    return table.concat(lines, "\n")
end

function Panel:ShowInfo()
    local tools = CRT.ConsumablesTools
    if tools then
        tools:ShowText("Debuff panel diagnostics (Ctrl+C to copy)", self:InfoText())
    else
        print(self:InfoText())
    end
end

Debuffs:OnChange(function()
    Panel:Apply()
end)

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_LOGIN")
events:RegisterEvent("PLAYER_REGEN_DISABLED")
events:RegisterEvent("PLAYER_REGEN_ENABLED")
events:RegisterEvent("ENCOUNTER_START")
events:RegisterEvent("ENCOUNTER_END")
events:SetScript("OnEvent", function(_, event)
    if event == "PLAYER_REGEN_DISABLED" then
        inCombat = true
    elseif event == "PLAYER_REGEN_ENABLED" then
        inCombat = false
    elseif event == "ENCOUNTER_START" then
        encounter = true
        return
    elseif event == "ENCOUNTER_END" then
        encounter = false
        if frame then
            Panel:Apply() -- waits again if still in combat; PLAYER_REGEN_ENABLED then applies it
        elseif not InCombatLockdown() then
            build()
        end
        return
    end
    if event == "PLAYER_LOGIN" then
        inCombat = UnitAffectingCombat("player") and true or false
        if safeToWire() then
            build()
        end
    elseif frame then
        updateVisibility()
        if event == "PLAYER_REGEN_ENABLED" then
            Panel:Apply() -- after a death mid-encounter this waits for ENCOUNTER_END
        end
    elseif event == "PLAYER_REGEN_ENABLED" and not encounterActive() then
        build() -- a /reload in combat: the panel is built once combat (and any encounter) ends
    end
end)

-- Shows or hides the preview, building the panel first when it hasn't been yet: for Previews in the
-- main window, and for Preview debuffs on the Debuffs tab, which shows only this panel.
function Panel:ShowPreview(on)
    if not frame and safeToWire() then
        build()
    end
    self:SetPreview(on)
end

CRT.UI:RegisterPreview("debuffs", function(on)
    Panel:ShowPreview(on)
end)
