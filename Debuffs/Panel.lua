local ADDON, CRT = ...

-- The in-combat debuff panel: a movable row of the debuffs enemies put on you.
--
-- The row is one of Blizzard's AuraContainer frames (Blizzard_AuraContainer, patch 12.1.0, loaded
-- here before the first one is made). The container watches the player's HARMFUL auras itself and fills
-- buttons this addon builds (icon, swipe, time, stacks, dispel type) without handing the values to
-- addon code, which is how it keeps working in combat, when debuff details are secret. Its candidate
-- filters keep only debuffs not cast by you or your pet, no longer than Hide debuffs longer than, and
-- none of the excluded lockouts (Debuffs.EXCLUDED_SPELLS), shortest first.
--
-- The game's boss debuff slots (C_UnitAuras.AddPrivateAuraAnchor, where the game draws a private aura
-- itself) are kept as an optional second row, off by default, in case boss mechanic debuffs don't
-- reach the container. Whether they do is checked in game.
--
-- The panel is faded with alpha, not hidden, when you are out of combat, because showing and hiding
-- frames can be blocked in combat. The container stays shown and enabled throughout. Positions and
-- settings are saved per player in CRTDB.debuffs.

local Debuffs = CRT.Debuffs
local Panel = {}
CRT.DebuffPanel = Panel

local CONTAINER_ADDON = "Blizzard_AuraContainer"
local TEMPLATES = { "CustomAuraContainerTemplate, DisableUntrustedLayoutScriptsTemplate", "CustomAuraContainerTemplate" }
local GROUP = "debuffs"
local GAP = 4
local MAX_SLOTS = 8
local SLOT_ROW_OFFSET = 24 -- gap above the boss debuff slots, which leaves room for the row's timer text
local REFRESH_SECONDS = 0.5
local TIMER_FONT = "CRTFontSmall"
local COUNT_FONT = "CRTFontHighlight"
local BORDER_COLOR = { 0, 0, 0, 1 }

local frame, container, handle
local slots = {} -- one frame per private aura slot
local anchorIds = {} -- the private aura anchors added for those slots
local tiles = {} -- preview tiles
local buttons = {} -- every container button built, with its parts, to apply the look again
local dragging
local previewOn = false
local inCombat = false
local elapsed = 0
local report = { loaded = nil, template = nil, created = false, error = nil, notes = {} }
local appliedAnchors, appliedContainer -- the settings each part was last built for

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

local function rowWidth()
    local size, count = Debuffs:Size(), Debuffs:MaxCount()
    return count * size + (count - 1) * GAP, size
end

-- The whole panel: the container's row, and the slot row under it when that is on.
local function panelSize()
    local width, size = rowWidth()
    local height = size
    if Debuffs:PrivateSlots() then
        height = height + SLOT_ROW_OFFSET + size
    end
    return width, height, size
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
    if not frame or InCombatLockdown() then
        return
    end
    local on = Debuffs:PrivateSlots()
    local size, count = Debuffs:Size(), Debuffs:MaxCount()
    local timerPoint, timerRelative, timerX, timerY = Debuffs:TimerAnchor()
    local signature = table.concat({ tostring(on), size, count, tostring(Debuffs:DispelIcon()), tostring(Debuffs:Get("swipe")), tostring(Debuffs:Get("swipeEdge")),
        tostring(Debuffs:SwipeNumbers()), tostring(timerPoint), tostring(timerX), tostring(timerY), tostring(Debuffs:Get("borderScale")) }, ":")
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

    local top = -(size + SLOT_ROW_OFFSET)
    for index = 1, MAX_SLOTS do
        local slot = slots[index]
        if not slot then
            slot = CreateFrame("Frame", nil, frame)
            slots[index] = slot
        end
        if index <= count then
            slot:SetSize(size, size)
            slot:ClearAllPoints()
            slot:SetPoint("TOPLEFT", frame, "TOPLEFT", (index - 1) * (size + GAP), top)
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

local function applyCooldownLook(cooldown)
    pcall(cooldown.SetDrawSwipe, cooldown, Debuffs:Get("swipe") and true or false)
    pcall(cooldown.SetDrawEdge, cooldown, (Debuffs:Get("swipe") and Debuffs:Get("swipeEdge")) and true or false)
    pcall(cooldown.SetDrawBling, cooldown, false)
    pcall(cooldown.SetHideCountdownNumbers, cooldown, not Debuffs:SwipeNumbers())
end

-- The parts of a debuff on a frame (a container button or a preview tile): border, icon, swipe, timer
-- text and stacks on a frame above the swipe, and the dispel type icon.
local function makeParts(owner)
    local parts = {}
    parts.border = owner:CreateTexture(nil, "BACKGROUND")
    parts.border:SetPoint("CENTER")
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
    parts.over:SetFrameLevel(owner:GetFrameLevel() + 5)
    parts.time = parts.over:CreateFontString(nil, "OVERLAY", TIMER_FONT)
    parts.time:SetTextColor(1, 1, 1)
    parts.count = parts.over:CreateFontString(nil, "OVERLAY", COUNT_FONT)
    parts.count:SetPoint("BOTTOMRIGHT", -2, 2)
    parts.dispel = parts.over:CreateTexture(nil, "OVERLAY")
    parts.dispel:SetPoint("TOPRIGHT", -1, -1)
    return parts
end

-- Size, border, swipe and where the timer text goes, the same for a button and a tile.
local function layoutParts(owner, parts, size)
    pcall(owner.SetSize, owner, size, size) -- a container button may be set up in combat
    local edge = 5 * (Debuffs:Get("borderScale") or 1)
    parts.border:SetSize(size + edge, size + edge)
    parts.border:SetColorTexture(BORDER_COLOR[1], BORDER_COLOR[2], BORDER_COLOR[3], BORDER_COLOR[4])
    parts.border:SetShown(edge > 0)
    local mark = math.max(10, math.floor(size * 0.35))
    parts.dispel:SetSize(mark, mark)
    if parts.cooldown then
        applyCooldownLook(parts.cooldown)
    end
    local timerPoint, timerRelative, timerX, timerY = Debuffs:TimerAnchor()
    parts.time:ClearAllPoints()
    if timerPoint then
        parts.time:SetPoint(timerPoint, owner, timerRelative, timerX, timerY)
    end
    return timerPoint ~= nil
end

-- The timer text as whole seconds, through the game's number formatter when it has one.
local formatter
local function timeFormatter()
    if formatter == nil then
        formatter = false
        if C_StringUtil and C_StringUtil.CreateNumericRuleFormatter then
            local ok, f = pcall(C_StringUtil.CreateNumericRuleFormatter)
            if ok and f then
                local rounding = Enum.NumericRuleFormatRounding and Enum.NumericRuleFormatRounding.Up
                if pcall(f.SetBreakpoints, f, { { threshold = 0, step = 1, rounding = rounding, format = "%.0f s" } }) then
                    formatter = f
                end
            end
        end
    end
    return formatter or nil
end

local function dispelStyle()
    local styles = Enum and Enum.CustomAuraButtonDispelTypeTextureStyle
    return type(styles) == "table" and styles.Icon or nil
end

-- Points a container button's parts at the game: what it fills, and what it leaves out (the Clear
-- calls), so a setting turned off stops showing at once.
local function wireButton(button, parts)
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
end

-- The container calls this once for each button it makes; the button is the first argument.
local function initializeButton(button)
    if type(button) ~= "table" or not button.SetIcon then
        note("initializeFrame was called without an aura button")
        return
    end
    local parts = buttons[button]
    if not parts then
        parts = makeParts(button)
        buttons[button] = parts
        try("button", button, "SetIcon", parts.icon)
        pcall(button.SetMouseMotionEnabled, button, false)
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
    return { elementWidth = size, elementHeight = size, elementSpacing = GAP }
end

-- The flow layout: one row from the top left, growing right.
local function applyContainerLayout()
    if not container or InCombatLockdown() then
        return
    end
    local width, size = rowWidth()
    local signature = width .. ":" .. size
    if signature == appliedContainer then
        return
    end
    appliedContainer = signature
    container:SetSize(width, size)
    local axis = AnchorUtil and AnchorUtil.FlowLayoutAxis and AnchorUtil.FlowLayoutAxis.Horizontal or 0
    local flow = AnchorUtil and AnchorUtil.FlowDirection
    try("container", container, "SetFlowLayoutAxis", axis)
    try("container", container, "SetFlowLayoutAnchorPoint", "TOPLEFT")
    try("container", container, "SetFlowLayoutGrowthDirection", flow and flow.Right or 1, flow and flow.Down or -1)
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
    container:SetPoint("TOPLEFT", frame, "TOPLEFT", 0, 0)
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
    if not frame or InCombatLockdown() then
        return
    end
    local width, height = panelSize()
    frame:SetSize(width, height)
    addAnchors()
    applyContainerLayout()
end

-- Preview tiles ----------------------------------------------------------------------
-- Sample debuffs in the same parts, size, spacing and look as the container's buttons, so the panel
-- can be placed and sized out of combat.

-- left is the seconds remaining when the preview starts. Each sample runs for SAMPLE_SECONDS, then
-- starts over, so the swipe and the timer keep moving.
local SAMPLE_SECONDS = 30
local SAMPLES = {
    { spell = 589, left = 12, dispel = "Magic" },
    { spell = 116, left = 8, dispel = "Curse" },
    { spell = 172, left = 21, stacks = 3 },
    { spell = 703, left = 27, dispel = "Poison" },
    { spell = 348, left = 5, dispel = "Disease" },
    { spell = 686, left = 17, stacks = 2, dispel = "Magic" },
    { spell = 980, left = 24 },
    { spell = 1022, left = 9, dispel = "Curse" },
}
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
            tile:SetPoint("TOPLEFT", frame, "TOPLEFT", (index - 1) * (size + GAP), 0)
            local timerShown = layoutParts(tile, parts, size)
            parts.icon:SetTexture(sampleIcon(sample.spell))
            parts.count:SetText(sample.stacks or "")
            parts.time:SetShown(timerShown)
            if parts.cooldown then
                parts.cooldown:SetShown(Debuffs:Get("swipe") or Debuffs:SwipeNumbers())
            end
            local dispel = Debuffs:DispelIcon() and sample.dispel and DISPEL_ICONS[sample.dispel]
            parts.dispel:SetTexture(dispel or nil)
            parts.dispel:SetShown(dispel and true or false)
            if not tile.endsAt then
                tile.endsAt = GetTime() + sample.left
                if parts.cooldown then
                    parts.cooldown:SetCooldown(tile.endsAt - SAMPLE_SECONDS, SAMPLE_SECONDS)
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
                tile.endsAt = now + SAMPLE_SECONDS
                if tile.parts.cooldown then
                    tile.parts.cooldown:SetCooldown(now, SAMPLE_SECONDS)
                end
            end
            tile.parts.time:SetText(math.ceil(tile.endsAt - now) .. " s")
        end
    end
end

-- Position and visibility -----------------------------------------------------------

local function applyPosition()
    local saved = Debuffs:Position()
    frame:ClearAllPoints()
    frame:SetPoint(saved.point, UIParent, saved.relativePoint or saved.point, saved.x, saved.y)
end

-- Whether you are in combat. InCombatLockdown() is false inside the PLAYER_REGEN_DISABLED handler,
-- because the lockdown only starts after that event fires, so the events set a flag directly and
-- UnitAffectingCombat backs it up.
local function playerInCombat()
    return inCombat or (UnitAffectingCombat("player") and true or false)
end

-- Shows the panel during combat, or always while previewing. Alpha, not Show, because showing and
-- hiding may be blocked in combat. It runs every frame, so a missed event cannot leave it stuck. During
-- a preview the real row is faded out, so only the samples show.
local function updateVisibility()
    if not frame then
        return
    end
    local visible = previewOn or (Debuffs:Enabled() and playerInCombat())
    local alpha = visible and 1 or 0
    if frame:GetAlpha() ~= alpha then
        frame:SetAlpha(alpha)
    end
    if container then
        local real = previewOn and 0 or 1
        if container:GetAlpha() ~= real then
            container:SetAlpha(real)
        end
    end
    if handle then
        handle:SetShown(previewOn)
    end
end

-- The drag handle sits above the icons, or above their timer text when it is placed above them.
local function placeHandle()
    if not handle then
        return
    end
    local lift = Debuffs:Get("timerPosition") == "above" and 18 or 0
    handle:ClearAllPoints()
    handle:SetPoint("BOTTOMLEFT", frame, "TOPLEFT", 0, 2 + lift)
    handle:SetPoint("BOTTOMRIGHT", frame, "TOPRIGHT", 0, 2 + lift)
end

function Panel:Apply()
    if not frame or InCombatLockdown() then
        return
    end
    if not dragging then
        applyPosition()
    end
    if container then
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
    if container then
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
end

function Panel:ResetPosition()
    Debuffs:ResetPosition()
    if frame and not InCombatLockdown() then
        applyPosition()
    end
end

local function build()
    if frame then
        return
    end
    frame = CreateFrame("Frame", "CowfeeRaidToolsDebuffPanel", UIParent)
    CRT.UI:RegisterLayer("debuffs", frame)
    frame:SetMovable(true)
    frame:SetClampedToScreen(true)
    local width, height = panelSize()
    frame:SetSize(width, height)
    applyPosition()
    frame:SetAlpha(0)

    -- A drag handle above the panel, shown during a preview. It is a separate frame, not a child,
    -- so it keeps its own visibility.
    handle = CreateFrame("Frame", nil, UIParent, "BackdropTemplate")
    CRT.UI:RegisterLayer("debuffs", handle)
    handle:SetHeight(20)
    handle:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    handle:SetBackdropColor(0.35, 0.1, 0.1, 0.9)
    handle:SetBackdropBorderColor(0.9, 0.3, 0.3, 1)
    handle:EnableMouse(true)
    handle:RegisterForDrag("LeftButton")
    local text = handle:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    text:SetPoint("CENTER")
    text:SetText("Debuffs: drag to move")
    CRT.UI.ResetButton(handle, function()
        Panel:ResetPosition()
    end):SetPoint("RIGHT", -2, 0)
    handle:SetScript("OnDragStart", function()
        if InCombatLockdown() then
            return
        end
        dragging = true
        frame:StartMoving(true)
    end)
    handle:SetScript("OnDragStop", function()
        frame:StopMovingOrSizing()
        dragging = false
        local point, _, relativePoint, x, y = frame:GetPoint()
        Debuffs:SavePosition(point, relativePoint, x, y)
    end)
    handle:Hide()
    placeHandle()

    createContainer()
    layout()

    frame:SetScript("OnUpdate", function(_, dt)
        updateVisibility()
        elapsed = elapsed + dt
        if elapsed < REFRESH_SECONDS then
            return
        end
        elapsed = 0
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
    add(format("Settings: size %d, max %d, dispel icon %s, hide longer than %s, boss debuff slots %s", Debuffs:Size(), Debuffs:MaxCount(),
        tostring(Debuffs:DispelIcon()), Debuffs:MaxDuration() > 0 and (Debuffs:MaxDuration() .. " s") or "off", tostring(Debuffs:PrivateSlots())))
    add(format("Look: swipe %s, edge %s, countdown numbers %s, timer %s (%s, %s), border %s", tostring(Debuffs:Get("swipe")), tostring(Debuffs:Get("swipeEdge")),
        tostring(Debuffs:SwipeNumbers()), tostring(Debuffs:Get("timerPosition")), tostring(Debuffs:Get("timerX")), tostring(Debuffs:Get("timerY")), tostring(Debuffs:Get("borderScale"))))
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
    add("  dispel icon style: " .. tostring(dispelStyle()) .. ", time formatter: " .. tostring(timeFormatter() ~= nil))
    if container then
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
events:SetScript("OnEvent", function(_, event)
    if event == "PLAYER_REGEN_DISABLED" then
        inCombat = true
    elseif event == "PLAYER_REGEN_ENABLED" then
        inCombat = false
    end
    if event == "PLAYER_LOGIN" then
        inCombat = UnitAffectingCombat("player") and true or false
        if not InCombatLockdown() then
            build()
        end
    elseif frame then
        updateVisibility()
        if event == "PLAYER_REGEN_ENABLED" then
            Panel:Apply()
        end
    elseif event == "PLAYER_REGEN_ENABLED" then
        build() -- a /reload in combat: the panel is built once combat ends
    end
end)

CRT.UI:RegisterPreview("debuffs", function(on)
    if not frame and not InCombatLockdown() then
        build()
    end
    Panel:SetPreview(on)
end)
