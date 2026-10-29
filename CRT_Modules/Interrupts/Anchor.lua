local ADDON, CRT = ...

-- Interrupts: arming, and each wave's anchor (CRT.InterruptAnchor). The module arms on ENCOUNTER_START with a boss
-- that has a kick setup for that difficulty (Interrupts:Def of "encounterID:difficultyID"), while Enable Interrupts is
-- on; Anchor.key is the setup's key and Anchor.def the setup. An untimed setup (no timing) only arms: its numbers
-- follow each marked add's casts (Interrupts/Plates.lua). A timed one, armed, counts every cast
-- start of the block's anchor unit (UNIT_SPELLCAST_START: only the moment it fired is read, its payload is secret in
-- a boss fight); the boss casts a fixed cycle, and the count's ordinal cast in each cycle is a wave's anchor, which
-- OnWave listeners hear (the reminder resyncs to it). Anchor:For(castTime) gives the anchor a nameplate cast is
-- numbered from: the counted one while the cast is inside its window, else the block's fallback times from the pull
-- (an anchor cast that wasn't seen). After a /reload mid-pull nothing arms until the next pull: ENCOUNTER_START
-- doesn't fire again, so there is no pull time and no count. Disarmed on ENCOUNTER_END, a zone change (PLAYER_ENTERING_WORLD: a zone change
-- mid-fight never fires ENCOUNTER_END) or the switch turning off; OnArm listeners hear each change.
--
-- Test on trash (CRTDB.interrupts.test): armed with the setup shown on the page (Anchor:StartTest(key)), else the
-- first one, and no pull. A timed setup numbers a pack by cast order (Anchor:TestNumber), not time, so any trash pack
-- gets numbers; an untimed one numbers marked mobs as in a pull. A
-- matching pull always wins over it, another boss's pull leaves it as it is, and at the pull's end it comes back.
--
-- Events: ENCOUNTER_START, ENCOUNTER_END and PLAYER_ENTERING_WORLD only while the module is on, UNIT_SPELLCAST_START
-- only while armed. Game values are checked for secrets before any compare.
-- Game calls (warcraft.wiki.gg, read 2026-10-28): ENCOUNTER_START (encounterID, encounterName, difficultyID,
-- groupSize), ENCOUNTER_END, PLAYER_ENTERING_WORLD, UNIT_SPELLCAST_START (unitTarget, castGUID, spellID, castBarID;
-- SecretWhenUnitSpellCastRestricted), GetTime, issecretvalue.

local Anchor = { armed = false, mode = nil, def = nil, key = nil, encounterID = nil, pullTime = nil, waveListeners = {}, armListeners = {},
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

local function set(mode, def, key, pullTime)
    Anchor.armed = mode ~= nil
    Anchor.mode = mode
    Anchor.def, Anchor.key, Anchor.encounterID, Anchor.pullTime = def, key, (Interrupts.SplitKey(key)), pullTime
    Anchor:Reset()
    listen()
    notify(Anchor.armListeners, Anchor.armed, mode)
end

local function disarm()
    if Anchor.armed then
        set(nil)
    end
end

-- Test on trash, with the setup key given (the page's), else the last one given, else the first setup.
function Anchor:StartTest(key)
    if key then
        self.testKey = key
    end
    if not Interrupts:Enabled() or not Interrupts:Settings().test or self.mode == "pull" then
        return
    end
    local skey, def = Interrupts:Resolve(self.testKey)
    if not def then
        local first = Interrupts:Bosses()[1]
        skey, def = Interrupts:Resolve(first and first.key)
    end
    if def then
        set("test", def, skey, nil)
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
    local timing = self.def and self.def.timing
    if not (self.armed and timing) then
        return nil
    end
    if self.mode == "pull" then
        if counted and castTime >= counted and castTime - counted < timing.window then
            return counted, false
        end
        return Lattice.Fallback(timing, self.pullTime, castTime), false
    end
    return nil -- Test on trash numbers by cast order: Anchor:TestNumber
end

-- Test on trash: the number of the next new caster in the pack, by cast order (the 1st and 2nd casters 1, the 3rd
-- and 4th 2, ..., the lattice's pairs, whatever the gaps between casts), and when the pack started. A cast window
-- seconds after the pack's first, or past its adds, starts a new pack at 1.
function Anchor:TestNumber(castTime)
    local timing = self.def and self.def.timing
    if self.mode ~= "test" or not timing then
        return nil
    end
    if not testWave or castTime - testWave.start >= timing.window or testWave.count >= timing.adds then
        testWave = { start = castTime, count = 0 }
    end
    local index = testWave.count
    testWave.count = index + 1
    return Lattice.SlotNumber(timing, index), testWave.start
end

local function onStart(encounterID, difficultyID)
    if not (readable(encounterID) and readable(difficultyID)) or type(encounterID) ~= "number" or type(difficultyID) ~= "number" then
        return
    end
    local key, def = Interrupts:Resolve(Interrupts.Key(encounterID, difficultyID))
    if def then
        set("pull", def, key, now())
    elseif Anchor.mode == "pull" then
        settle() -- a pull that never ended, replaced by another boss's
    end
end

local function onCast(unit)
    local timing = Anchor.def and Anchor.def.timing
    if Anchor.mode ~= "pull" or not timing or not readable(unit) or unit ~= timing.anchor.unit then
        return
    end
    count = count + 1
    notify(Anchor.castListeners, count, now())
    local cycle, ordinal = timing.anchor.cycle, timing.anchor.ordinal
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
