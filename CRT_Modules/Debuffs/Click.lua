local ADDON, CRT = ...

-- Right-click a debuff on the panel to ignore it (Debuffs:AddIgnored), out of combat only.
--
-- The panel's debuffs are the game's AuraContainer buttons. Addon code can't give them a script (an
-- AuraButton forbids untrusted scripts and scripted input) and can't read which aura one shows (only
-- the game's private part of the button holds it): Blizzard_AuraButton.xml and .lua, Gethe live. So each
-- icon spot gets a catcher of its own, a frame over the spot that takes only right-clicks, lets the
-- other mouse buttons pass through (SetPassThroughButtons) and never takes hover, so hover reaches the
-- button under it, which shows the game's tooltip when Show tooltips on hover is on (Panel.lua). Which debuff is in a
-- spot is worked out the way the game fills the row (Debuffs:Current), and the menu shows its name
-- and icon, so you see what you'd ignore.
--
-- The catchers take the mouse only out of combat and outside an encounter, only over a spot that holds
-- a debuff, and not during a preview; otherwise the panel is click-through. They follow the panel's
-- layout (Panel:OnLayout, every half second out of combat) and let go at once when combat or an
-- encounter starts. A menu still open then adds nothing and says to try again after combat. Which
-- spots hold a debuff is worked out again only when your debuffs change (UNIT_AURA), a setting changes,
-- or combat or an encounter ends, not on every layout.
--
-- A spot takes right-clicks, so a right-drag to turn the camera can't start over a debuff icon out of
-- combat: the game has no way to pass a drag through but keep a click (Ignore.lua's (?) says so).
-- A debuff the game won't hide can still be added, like typing it, and the menu says it still shows.

local Debuffs = CRT.Debuffs
local Panel = CRT.DebuffPanel
local UI = CRT.UI

local Click = { catchers = {}, list = nil, dirty = true }
CRT.DebuffClick = Click

Click.TEXT = {
    ignore = "Ignore this debuff",
    cancel = "Cancel",
    later = "Try again after combat",
    unreadable = "Can't read this debuff right now",
    added = "Ignoring %s. Remove it on Quality of Life > Debuffs.",
    noMenu = "This game client has no menu for this.",
}

-- Frame levels above the panel's own: over the buttons, their glow and their text (Panel.lua's
-- GLOW_LEVEL and TEXT_LEVEL are above each button's own level).
local LEVEL = 30
local PASS = { "LeftButton", "MiddleButton", "Button4", "Button5" }

local function isSecret(value)
    return issecretvalue and issecretvalue(value) or false
end

local function level(frame)
    local ok, n = pcall(frame.GetFrameLevel, frame)
    if not ok or isSecret(n) or type(n) ~= "number" then
        return nil
    end
    return n
end

local function setMouse(catcher, on)
    catcher:EnableMouse(on and true or false)
    if on then
        pcall(catcher.SetMouseMotionEnabled, catcher, false) -- clicks only: no hover, no tooltip
    end
end

-- The menu's title: the debuff's icon and name.
local function label(aura)
    local icon = aura.icon
    if type(icon) == "number" or type(icon) == "string" then
        return format("|T%s:16:16|t %s", tostring(icon), aura.name)
    end
    return aura.name
end

function Click.Ignore(aura)
    local T = Click.TEXT
    if InCombatLockdown() or not Panel.SafeToWire() then
        CRT:Print(T.later .. ".")
        return
    end
    local id, err = Debuffs:AddIgnored(aura.spellId)
    if id then
        CRT:Print(format(T.added, aura.name))
        if aura.canHide == false then
            CRT:Print(Debuffs.IGNORE_TEXT.cantHide)
        end
    elseif err then
        CRT:Print(err)
    end
end

-- Opens the menu for the debuff in a catcher's spot: its name, the warning when the game won't hide it,
-- then Ignore this debuff and Cancel. In combat it only says to try again after combat; a debuff with a
-- secret value out of combat says it can't be read right now.
function Click.Open(catcher)
    local T = Click.TEXT
    local aura, reason
    if InCombatLockdown() or not Panel.SafeToWire() then
        reason = T.later
    else
        local list = Debuffs:Current()
        aura = list and list[catcher.index]
        if not list then
            reason = T.unreadable
        elseif aura and aura.unreadable then
            aura, reason = nil, T.unreadable
        end
    end
    if not aura and not reason then
        return -- the spot has emptied since the catchers were placed
    end
    local menu = UI.ContextMenu(catcher, function(root)
        if reason then
            root:CreateTitle(reason)
        else
            root:CreateTitle(label(aura))
            if aura.canHide == false then
                root:CreateTitle(Debuffs.IGNORE_TEXT.cantHide)
            end
            root:CreateButton(T.ignore, function()
                Click.Ignore(aura)
            end)
        end
        root:CreateButton(T.cancel, function() end)
    end)
    if not menu then
        CRT:Print(T.noMenu)
    end
end

local function makeCatcher(frame, index)
    local c = CreateFrame("Button", nil, frame)
    c.index = index
    c:RegisterForClicks("RightButtonUp")
    -- restricted in combat; the catchers are made only when it is safe to wire
    pcall(c.SetPassThroughButtons, c, unpack(PASS))
    c:SetScript("OnClick", function(self, button)
        if button == "RightButton" then
            Click.Open(self)
        end
    end)
    setMouse(c, false)
    Click.catchers[index] = c
    return c
end

-- How many spots hold a debuff: worked out again only when something changed (Click.dirty).
local function liveCount(count)
    if Click.dirty or not Click.list then
        Click.list = Debuffs:Current()
        Click.dirty = false
    end
    return Click.list and math.min(#Click.list, count) or 0
end

-- Places a catcher over each icon spot and gives the mouse to those holding a debuff. Runs after the
-- panel's layout, which only happens when it is safe to wire.
function Click.Update()
    local frame = Panel:Frame()
    if not frame then
        return
    end
    local count, size = Debuffs:MaxCount(), Debuffs:Size()
    local live = 0
    if Panel.SafeToWire() and Debuffs:Enabled() and not Panel:IsPreviewing() then
        live = liveCount(count)
    end
    local base = level(frame)
    for index = 1, math.max(count, #Click.catchers) do
        local c = Click.catchers[index] or makeCatcher(frame, index)
        if index <= count then
            c:ClearAllPoints()
            local point, x = Panel.RowPoint(index)
            c:SetPoint(point, frame, point, x, 0)
            c:SetSize(size, size)
            if base then
                c:SetFrameLevel(base + LEVEL)
            end
            c:Show()
        else
            c:Hide()
        end
        setMouse(c, index <= live)
    end
end

-- Lets go of the mouse everywhere: the panel is click-through.
function Click.Release()
    for _, c in ipairs(Click.catchers) do
        setMouse(c, false)
    end
end

-- Something changed which debuffs the row holds: work it out again, now if it is safe.
local function changed()
    Click.dirty = true
    if Panel.SafeToWire() then
        Click.Update()
    end
end

Panel:OnLayout(Click.Update)
Debuffs:OnChange(changed) -- the filters (your list, the time limit) or the panel turned on or off

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_REGEN_DISABLED")
events:RegisterEvent("ENCOUNTER_START")
events:RegisterEvent("PLAYER_REGEN_ENABLED")
events:RegisterEvent("ENCOUNTER_END")
events:RegisterUnitEvent("UNIT_AURA", "player")
events:SetScript("OnEvent", function(_, event)
    if event == "PLAYER_REGEN_DISABLED" or event == "ENCOUNTER_START" then
        Click.dirty = true
        Click.Release()
    else
        changed() -- UNIT_AURA's payload isn't read: in combat it is secret
    end
end)
