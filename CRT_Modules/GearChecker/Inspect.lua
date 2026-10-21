local ADDON, CRT = ...

-- Gear Checker: the game's inspect, for group members without CRT. One player at a time, with a pause
-- between them, only out of combat, only when the game says they can be inspected and are in range, and
-- never while you have the game's own inspect window open (it runs its own inspect). A player out of range
-- or offline is skipped until the next Refresh. Their gear goes to CRT.Gear:Remember as a whole set.
--
--   Inspect:Queue(names)   adds players to the queue and starts it
--   Inspect:Clear()        empties the queue and lets go of the player being inspected
--   Inspect.skipped[name]  why a player was skipped ("range", "offline", "cannot")
--
-- Game calls (warcraft.wiki.gg, read 2026-10-20, and Blizzard_InspectUI on live): NotifyInspect(unit) asks
-- for the unit's details (the unit must pass CanInspect and CheckInteractDistance; the server may drop
-- requests that come too fast, with no event); INSPECT_READY (inspecteeGUID) fires once they arrive;
-- GetInventoryItemLink(unit, slot) then reads their items (CRT.Gear:ReadUnit); ClearInspectPlayer() stops
-- the game watching them, as InspectFrame_OnHide does. CanInspect(unit, showError) -> canInspect;
-- CheckInteractDistance(unit, 1) is the 28 yard check and can't be called in combat (protected since
-- 10.2.0); UnitIsConnected, UnitGUID. Each is called in pcall, and a secret answer counts as no.

local GC = CRT.GearChecker
local Gear = CRT.Gear

local Inspect = { queue = {}, skipped = {}, current = nil, waiting = false, token = 0, pending = false }
GC.Inspect = Inspect

Inspect.DELAY = 1.5 -- seconds between two players
Inspect.TIMEOUT = 5 -- seconds to wait for INSPECT_READY before moving on
Inspect.RETRY = 0.5 -- seconds before reading again an item the game had no link for yet
Inspect.RETRIES = 2
Inspect.DISTANCE = 1 -- CheckInteractDistance's index for 28 yards (Compare Achievements)

local function secret(v)
    return issecretvalue and issecretvalue(v) or false
end

local function yes(fn, ...)
    if type(fn) ~= "function" then
        return false
    end
    local ok, v = pcall(fn, ...)
    return ok and not secret(v) and (v == true or v == 1)
end

local function inCombat()
    return InCombatLockdown and InCombatLockdown() and true or false
end

-- The game's own inspect window is open: it inspects someone itself, so ours waits.
local function gameInspecting()
    local f = _G.InspectFrame
    return type(f) == "table" and f.IsShown and f:IsShown() and true or false
end

-- One timer at a time (the pause, the timeout or a retry): Inspect.pending while it waits. A new one, or
-- cancel(), makes any older one do nothing when it fires.
local function after(seconds, fn)
    Inspect.token = Inspect.token + 1
    Inspect.pending = true
    local token = Inspect.token
    C_Timer.After(seconds, function()
        if token == Inspect.token then
            Inspect.pending = false
            fn()
        end
    end)
end

local function cancel()
    Inspect.token = Inspect.token + 1
    Inspect.pending = false
end

local function release()
    if Inspect.current then
        Inspect.current = nil
        if ClearInspectPlayer and not gameInspecting() then
            pcall(ClearInspectPlayer)
        end
    end
end

local step

-- Why a unit can't be inspected now ("offline", "cannot", "range"), or nil when it can.
function Inspect.Blocked(unit)
    if not unit then
        return "cannot"
    end
    if not yes(UnitIsConnected, unit) then
        return "offline"
    end
    if not yes(CanInspect, unit) then
        return "cannot"
    end
    if not yes(CheckInteractDistance, unit, Inspect.DISTANCE) then
        return "range"
    end
    return nil
end

-- Reads the inspected player's items; an item the game has no link for yet is read again shortly.
local function finish(tries)
    local cur = Inspect.current
    if not cur then
        return
    end
    local pieces, missing = Gear:ReadUnit(cur.unit)
    if missing > 0 and tries < Inspect.RETRIES then
        after(Inspect.RETRY, function()
            finish(tries + 1)
        end)
        return
    end
    if #pieces > 0 and Gear:Remember(cur.name, pieces, GC.SOURCE_INSPECT, true) then
        Inspect.skipped[cur.name] = nil
        GC:Fire("inspect")
    end
    release()
    after(Inspect.DELAY, step)
end

-- The next player in the queue, unless combat or the game's own inspect window holds it.
step = function()
    if Inspect.current then
        return
    end
    if inCombat() then
        Inspect.waiting = true -- PLAYER_REGEN_ENABLED starts it again
        return
    end
    if gameInspecting() then
        after(Inspect.DELAY, step)
        return
    end
    Inspect.waiting = false
    while #Inspect.queue > 0 do
        local name = table.remove(Inspect.queue, 1)
        -- their CRT may have sent the whole set while they waited here: then nothing to inspect
        local sent = GC.Comm and GC.Comm:HasSet(name)
        local unit = not sent and GC:UnitOf(name)
        local why = not sent and Inspect.Blocked(unit)
        if sent then
            Inspect.skipped[name] = nil
        elseif why then
            Inspect.skipped[name] = why
        else
            local okG, guid = pcall(UnitGUID, unit)
            Inspect.current = { name = name, unit = unit, guid = (okG and not secret(guid)) and guid or nil }
            pcall(NotifyInspect, unit)
            after(Inspect.TIMEOUT, function()
                release() -- no answer: on to the next one
                step()
            end)
            return
        end
    end
end

function Inspect:Queue(names)
    for _, name in ipairs(names or {}) do
        local listed = self.current and self.current.name == name
        for _, q in ipairs(self.queue) do
            listed = listed or q == name
        end
        if not listed then
            self.queue[#self.queue + 1] = name
        end
    end
    -- the queue is already going while a player is inspected or a timer (the pause between players, a
    -- timeout, a retry) waits: that timer moves on to the new names
    if not self.current and not self.pending then
        step()
    end
end

function Inspect:Clear()
    wipe(self.queue)
    cancel() -- drops any timer still waiting
    release()
end

-- The game's events (also called by the tests).
function Inspect:OnEvent(event, a1)
    if event == "INSPECT_READY" then
        local cur = self.current
        if cur and cur.guid and not secret(a1) and a1 == cur.guid then
            cancel() -- the timeout is no longer needed
            finish(0)
        end
    elseif event == "PLAYER_REGEN_DISABLED" then
        -- combat: let go of the player being inspected and try them again after it
        local cur = self.current
        if cur then
            table.insert(self.queue, 1, cur.name)
            cancel()
            release()
        end
        self.waiting = #self.queue > 0
    elseif event == "PLAYER_REGEN_ENABLED" then
        if self.waiting or #self.queue > 0 then
            step()
        end
    end
end

if CreateFrame then
    local events = CreateFrame("Frame")
    events:RegisterEvent("INSPECT_READY")
    events:RegisterEvent("PLAYER_REGEN_DISABLED")
    events:RegisterEvent("PLAYER_REGEN_ENABLED")
    events:SetScript("OnEvent", function(_, event, a1)
        Inspect:OnEvent(event, a1)
    end)
end
