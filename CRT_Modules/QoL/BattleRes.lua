local ADDON, CRT = ...

-- The battle res icon (optional, off by default): the Rebirth icon with the group's shared battle res charges in its
-- bottom-right corner and, while a charge is coming back, a cooldown sweep and the time to it in the middle. At 0
-- charges its border and number turn the theme's bad colour. Settings in CRTDB.qol.battleRes (defaults in Core.lua):
-- enabled, show ("boss": between ENCOUNTER_START and ENCOUNTER_END; "combat": in combat inside a raid instance;
-- "raid": always inside a raid instance), timer (the time text) and size (percent). Its place is the shared
-- Placement helper's (UI/Placement.lua), saved as battleRes.position. The settings are on Quality of Life's
-- Battle res tab (QoL/Page.lua), with a preview to place it.
--
-- Secret values: C_Spell.GetSpellCharges is SecretWhenCooldownsRestricted, so in a boss fight its currentCharges,
-- cooldownStartTime and cooldownDuration may be secret (maxCharges and isActive never are). This file never
-- compares, does arithmetic on or keeps any of those three while issecretvalue says secret:
--   the count goes straight into FontString:SetText (SecretArguments AllowedWhenTainted), so the game writes it;
--   the red state needs a comparison, so it is skipped while the count is secret;
--   the sweep: plain numbers go to Cooldown:SetCooldown and the time text is worked out here; secret ones are not
--   touched at all: C_Spell.GetSpellChargeDuration gives the game's own duration object for the recharge, which goes
--   to Cooldown:SetCooldownFromDurationObject, and the cooldown frame's own countdown numbers show the time
--   (SetHideCountdownNumbers, as the game's Cooldown Manager does for its timer). If any of that is missing or
--   refused, the icon shows the count only.
-- Combat comes from PLAYER_REGEN_DISABLED/ENABLED, not InCombatLockdown (as the debuff panel does).
-- Game calls (warcraft.wiki.gg and Gethe/wow-ui-source live API docs, read 2026-11-11): C_Spell.GetSpellCharges
-- (SpellChargeInfo: currentCharges, maxCharges, cooldownStartTime, cooldownDuration, chargeModRate, isActive),
-- C_Spell.GetSpellChargeDuration -> DurationObject, Cooldown:SetCooldownFromDurationObject(duration, clearIfZero),
-- Cooldown:SetCooldown(start, duration, modRate), Cooldown:Clear, Cooldown:SetHideCountdownNumbers, issecretvalue,
-- IsInInstance, IsEncounterInProgress, UnitAffectingCombat; events SPELL_UPDATE_CHARGES, ENCOUNTER_START,
-- ENCOUNTER_END, PLAYER_REGEN_DISABLED, PLAYER_REGEN_ENABLED, PLAYER_ENTERING_WORLD, ZONE_CHANGED_NEW_AREA.

local BattleRes = {}
CRT.BattleRes = BattleRes

local UI = CRT.UI

local TEXT = {
    title = "Battle res",
    drag = "Battle res: drag to move",
}

BattleRes.SPELL_ID = 20484 -- Rebirth: the group's shared battle res charges
BattleRes.ICON = 136080 -- Interface\Icons\Spell_Nature_Reincarnation
BattleRes.MODES = { "boss", "combat", "raid" }
local BASE = 44 -- the icon's side at 100%
local BORDER = 2
local TICK = 0.2 -- seconds between time text updates while shown
local SAMPLE = { charges = 2, length = 300, left = 222 } -- the preview: 2 ready, the next in 3:42
-- Colours from the theme (CRT_Dev/StyleGuide.md): the border is the outline, the number the text colour, both the
-- theme's bad at 0 charges. Each is a UI.Tint, so a theme switch repaints it.
local EDGE_KEY, TEXT_KEY, BAD_KEY = "outline", "text", "bad"

local frame, handle, icon, cooldown, over, count, timeText
local previewOn = false
local encounter = false -- between ENCOUNTER_START and ENCOUNTER_END
local inCombat = false -- between PLAYER_REGEN_DISABLED and PLAYER_REGEN_ENABLED
local bad -- whether the bad colour is on (nil until first painted)
local plainEnd -- GetTime() the next charge comes back, only from plain (not secret) numbers; nil otherwise
local elapsed = 0

local function settings()
    return CRT.db.qol.battleRes
end

local function isSecret(value)
    if not issecretvalue then
        return false
    end
    local ok, s = pcall(issecretvalue, value)
    return not ok or s == true
end

local function inRaid()
    if not IsInInstance then
        return false
    end
    local ok, inside, kind = pcall(IsInInstance)
    return ok and inside and kind == "raid" or false
end

local function clock(seconds)
    seconds = math.max(0, math.ceil(seconds - 1e-6))
    if seconds >= 60 then
        return string.format("%d:%02d", math.floor(seconds / 60), seconds % 60)
    end
    return tostring(seconds)
end

local function setBad(on)
    on = on and true or false
    if bad ~= on then
        bad = on
        UI.Tint(count, "SetTextColor", on and BAD_KEY or TEXT_KEY)
        UI.Tint(frame, "SetBackdropBorderColor", on and BAD_KEY or EDGE_KEY)
    end
end

-- The frame ----------------------------------------------------------------------------------------------------------

local build

local placement = UI.Placement.Define("battleres", {
    title = TEXT.title,
    store = settings,
    default = { point = "CENTER", relativePoint = "CENTER", x = -260, y = 120 },
    point = "CENTER",
    build = function()
        build()
    end,
})

function BattleRes:ResetPosition()
    placement:Reset()
end

local function writeTime()
    if not timeText then
        return
    end
    if plainEnd and settings().timer then
        local left = plainEnd - GetTime()
        if previewOn and left <= 0 then
            plainEnd = GetTime() + SAMPLE.length -- the sample charge comes back and the next starts
            cooldown:SetCooldown(GetTime(), SAMPLE.length)
            left = SAMPLE.length
        end
        timeText:SetText(left > 0 and clock(left) or "")
    else
        timeText:SetText("")
    end
end

local function onUpdate(_, dt)
    elapsed = elapsed + dt
    if elapsed < TICK then
        return
    end
    elapsed = 0
    writeTime()
end

function build()
    if frame then
        return
    end
    frame = CreateFrame("Frame", "CowfeeRaidToolsBattleRes", UIParent, "BackdropTemplate")
    UI:RegisterLayer("alert", frame)
    frame:SetClampedToScreen(true)
    frame:SetBackdrop({ edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = BORDER })
    icon = frame:CreateTexture(nil, "ARTWORK")
    icon:SetPoint("TOPLEFT", BORDER, -BORDER)
    icon:SetPoint("BOTTOMRIGHT", -BORDER, BORDER)
    icon:SetTexture(BattleRes.ICON)
    icon:SetTexCoord(0.07, 0.93, 0.07, 0.93)
    cooldown = CreateFrame("Cooldown", nil, frame, "CooldownFrameTemplate")
    cooldown:SetAllPoints(icon)
    if cooldown.SetDrawBling then
        cooldown:SetDrawBling(false)
    end
    cooldown:SetHideCountdownNumbers(true) -- plain numbers: the time text below; secret ones: the game's (feedSweep)
    -- The texts sit on a frame above the sweep.
    over = CreateFrame("Frame", nil, frame)
    over:SetAllPoints(icon)
    over:SetFrameLevel((cooldown:GetFrameLevel() or 1) + 2)
    timeText = over:CreateFontString(nil, "OVERLAY")
    timeText:SetPoint("CENTER")
    UI.Tint(timeText, "SetTextColor", TEXT_KEY)
    count = over:CreateFontString(nil, "OVERLAY")
    count:SetPoint("BOTTOMRIGHT", -1, 2)
    setBad(false)

    handle = CreateFrame("Frame", nil, frame, "BackdropTemplate")
    handle:SetHeight(20)
    handle:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    UI:RegisterThemed(handle, { bg = { 0.3, 0.25, 0.05, 0.9 }, border = { 0.78, 0.63, 0.31 } })
    local text = handle:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    text:SetPoint("LEFT", 6, 0)
    text:SetText(TEXT.drag)
    local reset = UI.ResetButton(handle, function()
        BattleRes:ResetPosition()
    end)
    reset:SetPoint("RIGHT", -2, 0)
    UI.Placement.FitHandle(handle, frame, text)
    handle:Hide()
    frame:Hide()
    frame:SetScript("OnUpdate", onUpdate)
    placement:Attach(frame, handle, { reset = reset })
end

-- The size setting: the icon and its texts.
function BattleRes:Resize()
    build()
    local scale = math.max(50, math.min(200, settings().size or 100)) / 100
    local side = math.floor(BASE * scale + 0.5)
    frame:SetSize(side, side)
    count:SetFont(STANDARD_TEXT_FONT, math.max(8, math.floor(side * 0.36 + 0.5)), "OUTLINE")
    timeText:SetFont(STANDARD_TEXT_FONT, math.max(8, math.floor(side * 0.3 + 0.5)), "OUTLINE")
end

-- The charges ----------------------------------------------------------------------------------------------------------

local function clearSweep()
    plainEnd = nil
    if cooldown.Clear then
        cooldown:Clear()
    end
    writeTime()
end

-- Secret recharge times: the game's own duration object straight into the cooldown frame. True when it took it.
local function feedFromGame()
    local getDuration = C_Spell and C_Spell.GetSpellChargeDuration
    if not (getDuration and cooldown.SetCooldownFromDurationObject) then
        return false
    end
    local ok, duration = pcall(getDuration, BattleRes.SPELL_ID)
    if not ok or type(duration) == "nil" then
        return false
    end
    return pcall(cooldown.SetCooldownFromDurationObject, cooldown, duration) and true or false
end

-- The sweep and the time from one charge reading. The three times are only read after their issecretvalue check.
local function feedSweep(info)
    local start, length = info.cooldownStartTime, info.cooldownDuration
    local plain = not isSecret(start) and not isSecret(length) and type(start) == "number" and type(length) == "number"
    local active = info.isActive -- never secret, but checked anyway: a secret one counts as recharging
    if isSecret(active) then
        active = true
    elseif active == nil then
        active = plain and start > 0 and length > 0
    end
    if not active then
        clearSweep()
        return
    end
    if plain then
        local rate = info.chargeModRate
        if isSecret(rate) or type(rate) ~= "number" then
            rate = 1
        end
        cooldown:SetHideCountdownNumbers(true)
        cooldown:SetCooldown(start, length, rate)
        plainEnd = start + length
        writeTime()
        return
    end
    plainEnd = nil
    writeTime()
    if feedFromGame() then
        cooldown:SetHideCountdownNumbers(not settings().timer)
    elseif cooldown.Clear then
        cooldown:Clear() -- count only
    end
end

local function showSample()
    count:SetText(tostring(SAMPLE.charges))
    setBad(false)
    cooldown:SetHideCountdownNumbers(true)
    cooldown:SetCooldown(GetTime() - (SAMPLE.length - SAMPLE.left), SAMPLE.length)
    plainEnd = GetTime() + SAMPLE.left
    writeTime()
end

-- Reads the charges and paints the icon. Nothing here keeps a charge reading.
function BattleRes:Update()
    if not frame or not frame:IsShown() then
        return
    end
    if previewOn then
        return -- the sample stays until the preview ends
    end
    local get = C_Spell and C_Spell.GetSpellCharges
    local ok, info = false, nil
    if get then
        ok, info = pcall(get, self.SPELL_ID)
    end
    if not ok or type(info) ~= "table" then
        count:SetText("")
        setBad(false)
        clearSweep()
        return
    end
    local charges = info.currentCharges
    local secret = isSecret(charges)
    if not pcall(count.SetText, count, charges) then
        count:SetText("")
    end
    -- the bad colour needs a comparison: only on a plain count
    setBad(not secret and type(charges) == "number" and charges < 1)
    feedSweep(info)
end

-- Showing -------------------------------------------------------------------------------------------------------------

-- Whether the setting wants the icon on screen now (the preview aside).
function BattleRes:Wanted()
    local s = settings()
    if not s.enabled then
        return false
    end
    if s.show == "combat" then
        return inCombat and inRaid()
    elseif s.show == "raid" then
        return inRaid()
    end
    return encounter
end

-- Shows or hides the icon for the setting, the fight and the preview, and paints it.
function BattleRes:Apply()
    local wanted = previewOn or self:Wanted()
    if not wanted then
        if frame then
            handle:Hide()
            frame:Hide()
        end
        return
    end
    self:Resize()
    handle:SetShown(previewOn)
    frame:Show()
    if previewOn then
        showSample()
    else
        self:Update()
    end
end

-- For the tests and the dev probe.
function BattleRes.State()
    return { encounter = encounter, combat = inCombat, raid = inRaid(), preview = previewOn, bad = bad, plainEnd = plainEnd }
end

function BattleRes.Parts()
    return { frame = frame, handle = handle, icon = icon, cooldown = cooldown, count = count, timeText = timeText }
end

UI:RegisterPreview("battleres", function(on)
    previewOn = on and true or false
    plainEnd = nil
    if not previewOn and cooldown then
        cooldown:Clear()
    end
    BattleRes:Apply()
end)

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_LOGIN")
events:RegisterEvent("PLAYER_ENTERING_WORLD")
events:RegisterEvent("ZONE_CHANGED_NEW_AREA")
events:RegisterEvent("PLAYER_REGEN_DISABLED")
events:RegisterEvent("PLAYER_REGEN_ENABLED")
events:RegisterEvent("ENCOUNTER_START")
events:RegisterEvent("ENCOUNTER_END")
events:RegisterEvent("SPELL_UPDATE_CHARGES")
events:SetScript("OnEvent", function(_, event)
    if event == "SPELL_UPDATE_CHARGES" then
        BattleRes:Update()
        return
    elseif event == "PLAYER_REGEN_DISABLED" then
        inCombat = true
    elseif event == "PLAYER_REGEN_ENABLED" then
        inCombat = false
    elseif event == "ENCOUNTER_START" then
        encounter = true
    elseif event == "ENCOUNTER_END" then
        encounter = false
    elseif event == "PLAYER_LOGIN" then
        -- a /reload mid-fight: the fight and combat as they are now
        inCombat = UnitAffectingCombat and UnitAffectingCombat("player") and true or false
        encounter = IsEncounterInProgress and IsEncounterInProgress() and true or false
    end
    BattleRes:Apply()
end)
