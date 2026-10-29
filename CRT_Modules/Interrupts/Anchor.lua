local ADDON, CRT = ...

-- Interrupts: each wave's anchor (CRT.InterruptAnchor). The module arms on ENCOUNTER_START with a boss whose
-- interrupts block exists, on the block's difficulty, while Enable Interrupts is on. Armed, it counts every cast
-- start of the block's anchor unit (UNIT_SPELLCAST_START: only the moment it fired is read, its payload is secret in
-- a boss fight); the boss casts a fixed cycle, and the count's ordinal cast in each cycle is a wave's anchor, which
-- OnWave listeners hear (the reminder resyncs to it). Anchor:For(castTime) gives the anchor a nameplate cast is
-- numbered from: the counted one while the cast is inside its window, else the block's fallback times from the pull
-- (an anchor cast that wasn't seen). After a /reload mid-pull nothing arms until the next pull: ENCOUNTER_START
-- doesn't fire again, so there is no pull time and no count. Disarmed on ENCOUNTER_END, a zone change (PLAYER_ENTERING_WORLD: a zone change
-- mid-fight never fires ENCOUNTER_END) or the switch turning off; OnArm listeners hear each change.
--
-- Test on trash (CRTDB.interrupts.test): armed with the first boss that has a block and no pull; a pack is numbered by
-- cast order (Anchor:TestNumber), not time, so any trash pack gets numbers. A
-- matching pull always wins over it, another boss's pull leaves it as it is, and at the pull's end it comes back.
--
-- Events: ENCOUNTER_START, ENCOUNTER_END and PLAYER_ENTERING_WORLD only while the module is on, UNIT_SPELLCAST_START
-- only while armed. Game values are checked for secrets before any compare.
-- Game calls (warcraft.wiki.gg, read 2026-10-28): ENCOUNTER_START (encounterID, encounterName, difficultyID,
-- groupSize), ENCOUNTER_END, PLAYER_ENTERING_WORLD, UNIT_SPELLCAST_START (unitTarget, castGUID, spellID, castBarID;
-- SecretWhenUnitSpellCastRestricted), GetTime, issecretvalue.

local Anchor = { armed = false, mode = nil, def = nil, encounterID = nil, pullTime = nil, waveListeners = {}, armListeners = {},
    castListeners = {} }
CRT.InterruptAnchor = Anchor

local Interrupts = CRT.Interrupts
local Lattice = CRT.InterruptLattice
local readable = CRT.Comm.Readable

local count = 0 -- the anchor unit's cast starts this pull
local counted -- the last counted anchor's time
local testWave -- Test on trash: { start, count }, the pack being numbered by cast order

local frame = CreateFrame("Frame")

local function now()
    return GetTime()
end

local function notify(list, ...)
    for _, fn in ipairs(list) do
        local ok, err = pcall(fn, ...)
        if not ok and geterrorhandler then
            geterrorhandler()(err)
        end
    end
end

function Anchor:OnWave(fn)
    self.waveListeners[#self.waveListeners + 1] = fn
end

-- fn(count, at) at every cast start of the anchor unit in a pull, before any OnWave it makes (the kick probe).
function Anchor:OnCast(fn)
    self.castListeners[#self.castListeners + 1] = fn
end

function Anchor:OnArm(fn)
    self.armListeners[#self.armListeners + 1] = fn
end

-- The pull events while the module is on, the cast events while armed.
local function listen()
    local on = Interrupts:Enabled()
    for _, e in ipairs({ "ENCOUNTER_START", "ENCOUNTER_END", "PLAYER_ENTERING_WORLD" }) do
        if on then
            frame:RegisterEvent(e)
        else
            frame:UnregisterEvent(e)
        end
    end
    if on and Anchor.armed then
        -- unfiltered: nameplate tokens come and go, and the anchor unit is one unit among them
        frame:RegisterEvent("UNIT_SPELLCAST_START")
    else
        frame:UnregisterEvent("UNIT_SPELLCAST_START")
    end
end
Anchor.Listen = listen

-- Forgets the counted anchors (and the test wave), keeping the pull.
function Anchor:Reset()
    count, counted, testWave = 0, nil, nil
end

local function set(mode, def, encounterID, pullTime)
    Anchor.armed = mode ~= nil
    Anchor.mode = mode
    Anchor.def, Anchor.encounterID, Anchor.pullTime = def, encounterID, pullTime
    Anchor:Reset()
    listen()
    notify(Anchor.armListeners, Anchor.armed, mode)
end

local function disarm()
    if Anchor.armed then
        set(nil)
    end
end

-- Test on trash, with the first boss that has a block.
function Anchor:StartTest()
    if not Interrupts:Enabled() or not Interrupts:Settings().test or self.mode == "pull" then
        return
    end
    local first = Interrupts:Bosses()[1]
    local def = first and Interrupts:Def(first.key)
    if def then
        set("test", def, first.key, nil)
    end
end

function Anchor:StopTest()
    Interrupts:Settings().test = false
    if self.mode == "test" then
        disarm()
    end
end

-- Back to test mode when it is on, else disarmed.
local function settle()
    disarm()
    Anchor:StartTest()
end

function Anchor:For(castTime)
    local def = self.def
    if not (self.armed and def) then
        return nil
    end
    if self.mode == "pull" then
        if counted and castTime >= counted and castTime - counted < def.window then
            return counted, false
        end
        return Lattice.Fallback(def, self.pullTime, castTime), false
    end
    return nil -- Test on trash numbers by cast order: Anchor:TestNumber
end

-- Test on trash: the number of the next new caster in the pack, by cast order (the 1st and 2nd casters 1, the 3rd
-- and 4th 2, ..., the lattice's pairs, whatever the gaps between casts), and when the pack started. A cast window
-- seconds after the pack's first, or past its adds, starts a new pack at 1.
function Anchor:TestNumber(castTime)
    local def = self.def
    if self.mode ~= "test" or not def then
        return nil
    end
    if not testWave or castTime - testWave.start >= def.window or testWave.count >= def.adds then
        testWave = { start = castTime, count = 0 }
    end
    local index = testWave.count
    testWave.count = index + 1
    return Lattice.SlotNumber(def, index), testWave.start
end

local function onStart(encounterID, difficultyID)
    if not (readable(encounterID) and readable(difficultyID)) then
        return
    end
    local def = Interrupts:Def(encounterID)
    if def and difficultyID == def.difficulty then
        set("pull", def, encounterID, now())
    elseif Anchor.mode == "pull" then
        settle() -- a pull that never ended, replaced by another boss's
    end
end

local function onCast(unit)
    local def = Anchor.def
    if Anchor.mode ~= "pull" or not readable(unit) or unit ~= def.anchor.unit then
        return
    end
    count = count + 1
    notify(Anchor.castListeners, count, now())
    local cycle, ordinal = def.anchor.cycle, def.anchor.ordinal
    if count % cycle == ordinal % cycle then
        counted = now()
        notify(Anchor.waveListeners, (count - ordinal) / cycle + 1, counted)
    end
end

function Anchor:HandleEvent(event, ...)
    if not Interrupts:Enabled() then
        return
    end
    if event == "ENCOUNTER_START" then
        local encounterID, _, difficultyID = ...
        onStart(encounterID, difficultyID)
    elseif event == "ENCOUNTER_END" then
        if self.mode == "pull" then
            settle()
        end
    elseif event == "PLAYER_ENTERING_WORLD" then
        if self.mode == "test" then
            Interrupts:Settings().test = false
            Interrupts:Fire("settings")
        end
        disarm()
    elseif event == "UNIT_SPELLCAST_START" then
        onCast((...))
    end
end

frame:SetScript("OnEvent", function(_, event, ...)
    Anchor:HandleEvent(event, ...)
end)

-- The switch: off disarms at once, test mode too.
Interrupts:OnChange(function(what)
    if what ~= "enabled" then
        return
    end
    if not Interrupts:Enabled() then
        disarm()
    end
    listen()
end)

-- The saved switch is in by PLAYER_LOGIN.
local login = CreateFrame("Frame")
login:RegisterEvent("PLAYER_LOGIN")
login:SetScript("OnEvent", function()
    if CRT.db then
        listen()
    end
end)
