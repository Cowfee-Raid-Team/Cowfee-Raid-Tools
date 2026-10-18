local ADDON, CRT = ...

-- Aura sounds: a sound the game itself plays when an aura is put on a unit, its stacks go up, or it
-- goes. The game watches the aura, so this works in combat and for boss debuffs hidden from addons
-- (private auras), where an addon can't see the aura at all. C_UnitAuras.AddAuraSound(trigger, info)
-- returns an ID, RemoveAuraSound(id) takes it away; info is { unitToken, spellID, soundFileName,
-- outputChannel, throttleSeconds }.
--
-- CRT.Sound:AddAuraSound(key, spellID, ref, opts) and :RemoveAuraSound(key) keep a wanted list, keyed by
-- the caller; the game's registrations are rebuilt from it, all at once, only when it is safe: out of
-- combat and with no encounter running (the same guard as the debuff panel). A change made meanwhile
-- waits for PLAYER_REGEN_ENABLED or ENCOUNTER_END. opts: unit ("player"), trigger ("added", "stacks" or
-- "removed"), throttle (seconds, 0 to 5, default 1), channel.
--
-- The game takes a sound file. A game sound (kit:) is passed as soundKitID, which isn't confirmed to
-- work; text to speech can't be an aura sound. /crt dev sound auras lists what is registered and why
-- anything wasn't.
--
-- First user: a Mech Alerts reminder with "Also when it lands on me" ticked (r.auraSound) plays its
-- sound when its spell's aura is put on you, through Auras:SyncReminders.

local Sound = CRT.Sound
local Auras = { wanted = {}, registered = {}, problems = {}, pending = false }
CRT.SoundAuras = Auras

local THROTTLE_DEFAULT, THROTTLE_MAX = 1, 5
local TRIGGERS = { added = "Added", stacks = "ApplicationsIncreased", removed = "Removed" }

local encounter = false

function Auras:Available()
    return C_UnitAuras ~= nil and C_UnitAuras.AddAuraSound ~= nil and C_UnitAuras.RemoveAuraSound ~= nil
        and Enum ~= nil and Enum.UnitAuraSoundTrigger ~= nil
end

local function safe()
    return not InCombatLockdown() and not encounter
        and not (IsEncounterInProgress and IsEncounterInProgress())
end

local function clampThrottle(value)
    value = tonumber(value) or THROTTLE_DEFAULT
    return math.max(0, math.min(THROTTLE_MAX, value))
end

-- The sound part of the game's info for a reference, or nil and why.
local function soundInfo(ref)
    local source = Sound:Resolve(ref)
    if not source then
        return nil, "no such sound"
    elseif source.kind == "file" then
        return { soundFileName = source.paths[1] }
    elseif source.kind == "kit" then
        return { soundKitID = source.id }
    end
    return nil, "text to speech can't be an aura sound"
end

local function removeAll()
    for key, ids in pairs(Auras.registered) do
        for _, id in ipairs(ids) do
            pcall(C_UnitAuras.RemoveAuraSound, id)
        end
        Auras.registered[key] = nil
    end
end

-- Rebuilds the game's registrations from the wanted list, or waits until it is safe.
function Auras:Sync()
    if not self:Available() then
        return
    end
    if not safe() then
        self.pending = true
        return
    end
    self.pending = false
    removeAll()
    wipe(self.problems)
    for key, w in pairs(self.wanted) do
        local info, why = soundInfo(w.ref)
        local trigger = Enum.UnitAuraSoundTrigger[TRIGGERS[w.trigger] or "Added"]
        if not info then
            self.problems[key] = why
        elseif trigger == nil then
            self.problems[key] = "this client has no trigger " .. tostring(w.trigger)
        else
            info.unitToken = w.unit
            info.spellID = w.spellID
            info.outputChannel = w.channel or Sound:Channel()
            info.throttleSeconds = w.throttle
            local ok, id = pcall(C_UnitAuras.AddAuraSound, trigger, info)
            if ok and id then
                self.registered[key] = { id }
            else
                self.problems[key] = "the game refused it: " .. tostring(id)
            end
        end
    end
end

function Sound:AddAuraSound(key, spellID, ref, opts)
    spellID = tonumber(spellID)
    if not (key and spellID and ref) then
        return false
    end
    opts = opts or {}
    Auras.wanted[key] = {
        spellID = spellID,
        ref = ref,
        unit = opts.unit or "player",
        trigger = TRIGGERS[opts.trigger or "added"] and (opts.trigger or "added") or "added",
        throttle = clampThrottle(opts.throttle),
        channel = opts.channel,
    }
    if not opts.batch then
        Auras:Sync()
    end
    return true
end

function Sound:RemoveAuraSound(key, batch)
    Auras.wanted[key] = nil
    if not batch then
        Auras:Sync()
    end
end

-- Mech Alerts: every reminder that is on, has a spell and a sound, and has "Also when it lands on me"
-- ticked, as an aura sound on you. Rebuilt whenever the reminders change.
local REMINDER_PREFIX = "reminder:"

function Auras:SyncReminders()
    for key in pairs(self.wanted) do
        if key:sub(1, #REMINDER_PREFIX) == REMINDER_PREFIX then
            self.wanted[key] = nil
        end
    end
    local db = CRT.Alerts and CRT.Alerts:Settings()
    for encounterID, list in pairs(db and db.reminders or {}) do
        for id, r in pairs(list) do
            if r.auraSound and r.enabled ~= false and r.spellID and Sound.Normalize(r.sound) then
                Sound:AddAuraSound(REMINDER_PREFIX .. tostring(encounterID) .. ":" .. tostring(id), r.spellID, r.sound,
                    { unit = "player", trigger = "added", batch = true })
            end
        end
    end
    self:Sync()
end

function Auras:PrintStatus()
    CRT:Print("Aura sounds: " .. (self:Available() and "available" or "not available on this client")
        .. ", safe to change now: " .. tostring(safe()) .. ", waiting: " .. tostring(self.pending))
    for key, w in pairs(self.wanted) do
        local state = self.registered[key] and ("registered, id " .. tostring(self.registered[key][1]))
            or (self.problems[key] and ("not registered: " .. self.problems[key])) or "waiting"
        print(string.format("  %s: spell %d, %s on %s, %s, throttle %s s: %s", key, w.spellID, Sound:Label(w.ref), w.unit,
            w.trigger, tostring(w.throttle), state))
    end
end

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_LOGIN")
events:RegisterEvent("PLAYER_REGEN_ENABLED")
events:RegisterEvent("ENCOUNTER_START")
events:RegisterEvent("ENCOUNTER_END")
events:SetScript("OnEvent", function(_, event)
    if event == "PLAYER_LOGIN" then
        if CRT.Alerts and CRT.Alerts.OnChange then
            CRT.Alerts:OnChange(function()
                Auras:SyncReminders()
            end)
        end
        Auras:SyncReminders()
    elseif event == "ENCOUNTER_START" then
        encounter = true
    elseif event == "ENCOUNTER_END" then
        encounter = false
        if Auras.pending then
            Auras:Sync()
        end
    elseif event == "PLAYER_REGEN_ENABLED" and Auras.pending then
        Auras:Sync()
    end
end)
