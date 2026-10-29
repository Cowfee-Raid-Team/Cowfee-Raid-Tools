local ADDON, CRT = ...

-- Interrupts: the reminder before your own kick (CRT.InterruptReminder). Its own overlay, not an alert area: your
-- interrupt's icon and a line under it. No number, no reminder.
-- A timed setup counts down: a draining swipe, the whole seconds left on it, and "Kick #3 Left" under it, from the
-- setup's label, your number and your group. LEAD seconds before the cast it shows; at 0 it hides and plays the chosen
-- sound (CRT.Sound, on General Settings' sound channel).
-- An untimed setup has nothing to count down. When the cast before yours starts on your group's add (Plates:OnTurn moves
-- it to the number before yours) it shows "Your kick next: Skull add #2" as a heads-up; when your own cast starts it
-- shows "Kick now: Skull add #2" with the sound. It hides when the add moves past you, or after HOLD seconds.
--
-- The schedule: when a pull arms (Interrupts/Anchor.lua), one timer per entry of the block's anchor.times, at
-- pullTime + time + PairOffset(number) - LEAD, since wave 1's reminder is due before its anchor is even cast. When
-- the anchor is counted for a wave, that wave's timer is set again from the real time; a reminder already on screen
-- moves to the new end. Test on trash has no pull, so no schedule; Preview reminder runs one 5 second countdown.
--
-- The window is a UI.Window overlay; its place, drag, nudge and Reset are the shared placement helper's (Previews
-- shows its drag box), saved per character in CRTDBChar.interrupts.reminder.position.
--
-- The icon: your spec's interrupt, else your class's (the season's game IDs, Bosses:Kicks), else the game's kick icon.
-- Game calls (warcraft.wiki.gg, read 2026-10-28): C_Timer.NewTimer, GetTime, CreateFrame("Cooldown", ...,
-- "CooldownFrameTemplate"), Cooldown:SetCooldown, SetReverse (true: the dark part grows), SetHideCountdownNumbers,
-- C_Spell.GetSpellTexture(spellID) -> iconID (nothing for an unknown spell), UnitClass, and your spec through
-- Groups.PlayerSpecID (C_SpecializationInfo.GetSpecialization and GetSpecializationInfo).

local Reminder = { LEAD = 5, HOLD = 12 }
CRT.InterruptReminder = Reminder

local Interrupts = CRT.Interrupts
local Anchor = CRT.InterruptAnchor
local Lattice = CRT.InterruptLattice
local UI = CRT.UI

local TEXT = {
    title = "Kick reminder",
    drag = "Kick reminder: drag to move",
    line = "%s #%d %s", -- Kick #3 Left
    next = "Your kick next: %s #%d", -- Your kick next: Skull add #2
    now = "Kick now: %s #%d",
}
local FALLBACK_ICON = "Interface\\Icons\\ability_kick"
local GAP = 4 -- between the icon and the line under it

local timers = {} -- wave -> its pending timer
local done = {} -- wave -> true once its reminder showed this pull
local showing -- { wave, endAt, preview } while a countdown is on screen
local endTimer
local placing = false -- Previews is on

local function settings()
    return Interrupts:Settings().reminder
end

local function readable(v)
    return CRT.Comm.Readable(v)
end

-- The icon ----------------------------------------------------------------------------------------------------------

local function spellIcon(spellID)
    if not (C_Spell and C_Spell.GetSpellTexture and type(spellID) == "number") then
        return nil
    end
    local ok, icon = pcall(C_Spell.GetSpellTexture, spellID)
    return ok and readable(icon) and icon or nil
end

function Reminder.KickIcon()
    local kicks = CRT.Bosses and CRT.Bosses.Kicks and CRT.Bosses:Kicks()
    if kicks then
        local spec = CRT.Groups and CRT.Groups.PlayerSpecID and CRT.Groups.PlayerSpecID()
        local bySpec = spec and type(kicks.specs) == "table" and kicks.specs[spec]
        if bySpec == false then
            return FALLBACK_ICON
        end
        local spell = bySpec
        if not spell then
            local ok, _, classFile = pcall(UnitClass, "player")
            if ok and readable(classFile) and type(kicks.classes) == "table" then
                spell = kicks.classes[classFile]
            end
        end
        local icon = spellIcon(spell)
        if icon then
            return icon
        end
    end
    return FALLBACK_ICON
end

-- The window ----------------------------------------------------------------------------------------------------------

local function store()
    CRTDBChar = type(CRTDBChar) == "table" and CRTDBChar or {}
    CRTDBChar.interrupts = type(CRTDBChar.interrupts) == "table" and CRTDBChar.interrupts or {}
    CRTDBChar.interrupts.reminder = type(CRTDBChar.interrupts.reminder) == "table" and CRTDBChar.interrupts.reminder or {}
    return CRTDBChar.interrupts.reminder
end

local placement = UI.Placement.Define("kickreminder", {
    title = TEXT.title,
    store = store,
    default = { point = "CENTER", relativePoint = "CENTER", x = 0, y = 120 },
    point = "CENTER",
})

local f = UI.Window("CowfeeRaidToolsKickReminder", { kind = "overlay", layer = "alert", width = 48, height = 72 })
Reminder.frame = f
local icon = f:CreateTexture(nil, "ARTWORK")
icon:SetPoint("TOP")
Reminder.icon = icon
local cooldown = CreateFrame("Cooldown", nil, f, "CooldownFrameTemplate")
cooldown:SetAllPoints(icon)
cooldown:SetReverse(true)
if cooldown.SetHideCountdownNumbers then
    cooldown:SetHideCountdownNumbers(true) -- the seconds are drawn here, above the swipe
end
Reminder.cooldown = cooldown
local over = CreateFrame("Frame", nil, f)
over:SetAllPoints(icon)
over:SetFrameLevel(cooldown:GetFrameLevel() + 2)
local count = over:CreateFontString(nil, "OVERLAY")
count:SetPoint("CENTER")
Reminder.count = count
local label = f:CreateFontString(nil, "OVERLAY", "CRTFontLargeOutline")
label:SetPoint("TOP", icon, "BOTTOM", 0, -GAP)
Reminder.label = label

local handle = CreateFrame("Frame", nil, f, "BackdropTemplate")
handle:SetHeight(20)
handle:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
UI:RegisterThemed(handle, { bg = { 0.3, 0.25, 0.05, 0.9 }, border = { 0.78, 0.63, 0.31 } })
local handleText = handle:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
handleText:SetPoint("LEFT", 6, 0)
handleText:SetText(TEXT.drag)
local reset = UI.ResetButton(handle, function()
    placement:Reset()
end)
reset:SetPoint("RIGHT", -2, 0)
UI.Placement.FitHandle(handle, f, handleText)
handle:Hide()
placement:Attach(f, handle, { reset = reset })

function Reminder:Refresh()
    local size = settings().size
    icon:SetSize(size, size)
    count:SetFont(STANDARD_TEXT_FONT, math.max(10, math.floor(size * 0.5 + 0.5)), "OUTLINE")
    f:SetSize(math.max(size, 120), size + GAP + 24)
    icon:SetTexture(Reminder.KickIcon())
end

-- The text under the icon: your kick, or a sample one when you have none (Preview, Previews).
local function line(key)
    local def = key and Interrupts:Def(key)
    if not def then
        local first = Interrupts:Bosses()[1]
        key = first and first.key
        def = key and Interrupts:Def(key)
    end
    local n, group = nil, nil
    if key then
        n, group = Interrupts:Mine(key)
    end
    return string.format(TEXT.line, def and def.label or "Kick", n or 1, group or (def and def.groups[1].label) or "")
end

local function writeCount()
    if showing and showing.endAt then
        count:SetText(tostring(math.max(0, math.ceil(showing.endAt - GetTime() - 1e-6))))
    end
end

f:SetScript("OnUpdate", function()
    writeCount()
end)

local function hide()
    showing = nil
    if endTimer then
        endTimer:Cancel()
        endTimer = nil
    end
    if cooldown.Clear then
        cooldown:Clear()
    end
    if placing then
        count:SetText(tostring(Reminder.LEAD))
    else
        f:Hide()
    end
end

local function finish()
    endTimer = nil
    local sound = settings().sound
    hide()
    if sound and sound ~= "none" and CRT.Sound then
        CRT.Sound:Play(sound)
    end
end

-- Shows a countdown ending at endAt (the cast's time). wave is nil for Preview.
local function show(wave, endAt, text)
    Reminder:Refresh()
    if endTimer then
        endTimer:Cancel()
    end
    showing = { wave = wave, endAt = endAt }
    label:SetText(text)
    cooldown:SetCooldown(endAt - Reminder.LEAD, Reminder.LEAD)
    endTimer = C_Timer.NewTimer(math.max(0, endAt - GetTime()), finish)
    writeCount()
    f:Show()
end

-- The schedule ----------------------------------------------------------------------------------------------------------

local function cancelAll()
    for wave, t in pairs(timers) do
        t:Cancel()
        timers[wave] = nil
    end
    wipe(done)
end

-- One wave's timer, showing at `at`; at once when that is already past (its cast is still ahead).
local function setTimer(wave, at)
    if timers[wave] then
        timers[wave]:Cancel()
        timers[wave] = nil
    end
    local id = Anchor.key
    local function fire()
        timers[wave] = nil
        done[wave] = true
        local n, group = Interrupts:Mine(id)
        local def = Anchor.def
        if n and def then
            show(wave, at + Reminder.LEAD, string.format(TEXT.line, def.label, n, group or ""))
        end
    end
    if at <= GetTime() then
        fire()
    else
        timers[wave] = C_Timer.NewTimer(at - GetTime(), fire)
    end
end

function Reminder:Schedule()
    cancelAll()
    local def, pull = Anchor.def, Anchor.pullTime
    local timing = def and def.timing
    if not (Anchor.mode == "pull" and timing and pull and Interrupts:Enabled() and settings().on) then
        return
    end
    local n = Interrupts:Mine(Anchor.key)
    if not n then
        return
    end
    local offset = Lattice.PairOffset(timing, n)
    for wave, t in ipairs(timing.anchor.times) do
        local at = pull + t + offset - self.LEAD
        if at + self.LEAD > GetTime() then
            setTimer(wave, at)
        end
    end
end

-- A counted anchor for a wave: its timer set again from the real time, or the reminder on screen moved to it. A wave
-- the fallback table has no timer for (more waves than its times) starts from the counted anchor; one already shown
-- is left alone.
function Reminder:Resync(wave, anchorTime)
    local timing = Anchor.def and Anchor.def.timing
    if not (timing and Anchor.mode == "pull" and settings().on and Interrupts:Enabled()) then
        return
    end
    local n = Interrupts:Mine(Anchor.key)
    if not n then
        return
    end
    local endAt = anchorTime + Lattice.PairOffset(timing, n)
    if showing and showing.wave == wave then
        show(wave, endAt, label:GetText())
    elseif not done[wave] and endAt > GetTime() then
        setTimer(wave, endAt - self.LEAD)
    end
end

function Reminder:Stop()
    cancelAll()
    if showing and (showing.wave or showing.untimed) then
        hide()
    end
end

-- An untimed setup: a group's add moved to number n. On your group: the number before yours is the heads-up, yours is
-- Kick now (with the sound), any other hides it.
function Reminder:OnTurn(g, n)
    local def = Anchor.def
    if not (def and not def.timing and Anchor.armed and Interrupts:Enabled() and settings().on) then
        return
    end
    local mine, _, myGroup = Interrupts:Mine(Anchor.key)
    if not mine or g ~= myGroup then
        return
    end
    local slots = def.groups[g] and def.groups[g].slots or 1
    local before = (mine - 2) % slots + 1
    local now = n == mine
    if not now and n ~= before then
        if showing and showing.untimed then
            hide()
        end
        return
    end
    self:Refresh()
    if endTimer then
        endTimer:Cancel()
    end
    if cooldown.Clear then
        cooldown:Clear()
    end
    showing = { untimed = true, group = g }
    label:SetText(string.format(now and TEXT.now or TEXT.next, def.groups[g].label, mine))
    count:SetText("")
    endTimer = C_Timer.NewTimer(self.HOLD, function()
        endTimer = nil
        hide()
    end)
    f:Show()
    local sound = settings().sound
    if now and sound and sound ~= "none" and CRT.Sound then
        CRT.Sound:Play(sound)
    end
end

if CRT.InterruptPlates and CRT.InterruptPlates.OnTurn then
    CRT.InterruptPlates:OnTurn(function(g, n)
        Reminder:OnTurn(g, n)
    end)
end

-- Preview reminder: one LEAD second countdown, with the sound, your kick (or a sample).
function Reminder:Preview()
    if not Interrupts:Enabled() then
        return
    end
    show(nil, GetTime() + self.LEAD, line(Anchor.key))
end

-- Previews: the drag box and a still sample, until Previews ends.
UI:RegisterPreview("interrupts-reminder", function(on)
    placing = on and Interrupts:Enabled() and true or false
    handle:SetShown(placing)
    if placing then
        Reminder:Refresh()
        if not showing then
            label:SetText(line(Anchor.key))
            count:SetText(tostring(Reminder.LEAD))
        end
        f:Show()
    elseif not showing then
        f:Hide()
    end
end)

Anchor:OnArm(function(on)
    if on then
        Reminder:Schedule()
    else
        Reminder:Stop()
    end
end)

Anchor:OnWave(function(wave, at)
    Reminder:Resync(wave, at)
end)

-- A new list, a new number: the schedule follows. The size and the switch too.
Interrupts:OnChange(function(what)
    if what == "list" or what == "enabled" then
        if Anchor.mode == "pull" then
            Reminder:Schedule()
        end
    elseif what == "settings" then
        Reminder:Refresh()
    end
end)
