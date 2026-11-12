// CRT_Modules/QoL/BattleRes.lua and CRT_Dev/Dev/BattleResProbe.lua: the battle res icon. It shows and hides per its
// Show it setting on the game's events (boss fights, any combat, always; the open world, dungeons and raids alike),
// never while it is off, and with Only in a group never solo; writes the charges, and with no charge pool (nothing to
// read) shows a dimmed dash; at 0 plain charges turns its number and border the theme's bad colour; runs the sweep and the
// time from plain numbers; and with the charges secret (proxies that raise an error on any comparison or arithmetic)
// passes the count straight to SetText, skips the bad colour, never hands a secret to SetCooldown or keeps one, and
// feeds the sweep from the game's duration object instead. Its preview shows a sample, and the probe prints secrets
// by their type only.
// Usage: node run_qol_brez.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const themeLua = require('./theme_stub');
const root = process.argv[2];
const harness = themeLua(root) + require('./placement_stub')(root) + `
local brezSrc, probeSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function near(c, want) return c ~= nil and want ~= nil and math.abs(c[1] - want[1]) < 0.003 and math.abs(c[2] - want[2]) < 0.003 and math.abs(c[3] - want[3]) < 0.003 end

-- A secret: issecretvalue says so, and any comparison, arithmetic, concatenation or length raises an error.
local secretMeta = {}
local function boom() error("a secret value was compared or used in arithmetic") end
for _, k in ipairs({ "__lt", "__le", "__eq", "__add", "__sub", "__mul", "__div", "__mod", "__pow", "__unm", "__concat", "__len" }) do
  secretMeta[k] = boom
end
local function secret() return setmetatable({}, secretMeta) end
local rawtype = type
issecretvalue = function(v) return rawtype(v) == "table" and getmetatable(v) == secretMeta end
-- In the game a secret number's type is "number", so a type() test never stands in for the issecretvalue guards:
-- with one of those guards gone, the code reaches a comparison or SetCooldown with the secret and a check fails.
type = function(v) if issecretvalue(v) then return "number" end return rawtype(v) end
local function holdsSecret(t)
  for _, v in pairs(t) do if issecretvalue(v) then return true end end
  return false
end

-- frames, textures, font strings and cooldowns that remember what they were given
local made = {}
local function region(kind, template)
  local r = { shown = true, kind = kind, template = template, scripts = {}, calls = {} }
  local m = {
    SetTextColor = function(self, cr, cg, cb) self.rgb = { cr, cg, cb } end,
    SetBackdropBorderColor = function(self, cr, cg, cb) self.edge = { cr, cg, cb } end,
    SetText = function(self, t) self.text = t end,
    GetText = function(self) return self.text end,
    SetTexture = function(self, t) self.texture = t end,
    SetScript = function(self, k, fn) self.scripts[k] = fn end,
    GetScript = function(self, k) return self.scripts[k] end,
    Show = function(self) self.shown = true end, Hide = function(self) self.shown = false end,
    SetShown = function(self, v) self.shown = v and true or false end, IsShown = function(self) return self.shown end,
    SetSize = function(self, w, h) self.w, self.h = w, h end,
    GetFrameLevel = function() return 1 end,
    CreateTexture = function() return region("Texture") end,
    CreateFontString = function(_, _, _, tmpl) return region("FontString", tmpl) end,
    GetPoint = function() return "CENTER", nil, "CENTER", -260, 120 end,
    RegisterEvent = function(self, e) self.events = self.events or {} self.events[e] = true end,
    SetCooldown = function(self, start, length, rate) self.cd = { start, length, rate } self.calls[#self.calls + 1] = "SetCooldown" end,
    SetCooldownFromDurationObject = function(self, d) self.fromDuration = d self.calls[#self.calls + 1] = "fromDuration" end,
    Clear = function(self) self.cd = nil self.fromDuration = nil self.calls[#self.calls + 1] = "Clear" end,
    SetHideCountdownNumbers = function(self, v) self.hideNumbers = v end,
    SetAlpha = function(self, a) self.alpha = a end,
  }
  return setmetatable(r, { __index = function(_, k) return m[k] or (type(k) == "string" and k:find("^%u") and function() end) or nil end })
end
CreateFrame = function(kind, name, _, template)
  local f = region(kind, template)
  made[#made + 1] = f
  if name then _G[name] = f end
  return f
end
UIParent = region("Frame")
STANDARD_TEXT_FONT = "Fonts\\\\FRIZQT__.TTF"
local now = 1000
GetTime = function() return now end
local inside, kind = false, "none"
IsInInstance = function() return inside, kind end
-- timers wait here until the check runs them
local timers = {}
C_Timer = { After = function(sec, fn) timers[#timers + 1] = { sec = sec, fn = fn } end }
local function runTimers() local due = timers timers = {} for _, t in ipairs(due) do t.fn() end return #due end
local grouped = false
IsInGroup = function() return grouped end
IsEncounterInProgress = function() return false end
UnitAffectingCombat = function() return false end
InCombatLockdown = function() return false end

-- the game's charge reading, set per check
local info
local duration = { "a duration object" }
local durationCalls = 0
C_Spell = {
  GetSpellCharges = function(id) assert(id == 20484, "Rebirth's charges") return info end,
  GetSpellChargeDuration = function(id) durationCalls = durationCalls + 1 return duration end,
}

local CRT = { db = { qol = { battleRes = { enabled = false, show = "boss", groupOnly = false, timer = true, size = 100 } } } }
CRT.UI = {}
CRT_THEME(CRT, CRT.UI)
CRT_PLACEMENT(CRT)
local UI = CRT.UI
local previews = {}
function UI:RegisterLayer() end
function UI:RegisterThemed() end
function UI:RegisterPreview(key, fn) previews[key] = fn end
function UI.ResetButton() return region("Button") end
local printed = {}
function CRT:Print(t) printed[#printed + 1] = t end
assert(load(brezSrc, "BattleRes.lua"))("CowfeeRaidTools", CRT)
local B = CRT.BattleRes
check(B ~= nil, "CRT.BattleRes exists")

-- the events frame: the last frame made at load
local events
for _, f in ipairs(made) do if f.events and f.events.SPELL_UPDATE_CHARGES then events = f end end
check(events ~= nil, "it listens to SPELL_UPDATE_CHARGES")
for _, e in ipairs({ "ENCOUNTER_START", "ENCOUNTER_END", "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED", "PLAYER_ENTERING_WORLD", "GROUP_ROSTER_UPDATE", "CHALLENGE_MODE_START", "CHALLENGE_MODE_COMPLETED", "CHALLENGE_MODE_RESET" }) do
  check(events and events.events[e], "it listens to " .. e)
end
local function fire(e) events.scripts.OnEvent(events, e) end
local function parts() return B.Parts() end
local function shown() local f = parts().frame return f ~= nil and f.shown end
local s = CRT.db.qol.battleRes
local P = CRT.PALETTE

info = { currentCharges = 2, maxCharges = 5, cooldownStartTime = 0, cooldownDuration = 0, chargeModRate = 1, isActive = false }

-- Off: never shown, whatever happens
fire("PLAYER_LOGIN")
fire("ENCOUNTER_START")
check(not shown(), "off: a boss pull shows nothing")
inside, kind = true, "raid"
s.show = "raid"
fire("PLAYER_ENTERING_WORLD")
check(not shown(), "off: always in a raid still shows nothing")
s.show = "combat"
fire("PLAYER_REGEN_DISABLED")
check(not shown(), "off: combat in a raid still shows nothing")
fire("PLAYER_REGEN_ENABLED")
fire("ENCOUNTER_END")
inside, kind = false, "none"
fire("ZONE_CHANGED_NEW_AREA")

-- Where: the open world, a dungeon (Mythic+ too) and a raid all count for every mode (Alex, 2026-11-12)
local DASH = "\\226\\128\\147" -- an en dash, UTF-8
local PLACES = { { false, "none", "the open world" }, { true, "party", "a dungeon" }, { true, "raid", "a raid" } }

-- In boss fights (the default): between ENCOUNTER_START and ENCOUNTER_END, wherever the boss is
s.enabled = true
s.show = "boss"
B:Apply()
for _, place in ipairs(PLACES) do
  inside, kind = place[1], place[2]
  fire("PLAYER_ENTERING_WORLD")
  check(not shown(), "boss: hidden in " .. place[3] .. " before the pull")
  fire("PLAYER_REGEN_DISABLED")
  check(not shown(), "boss: trash combat in " .. place[3] .. " shows nothing")
  fire("ENCOUNTER_START")
  check(shown(), "boss: shown on ENCOUNTER_START in " .. place[3])
  fire("PLAYER_REGEN_ENABLED")
  check(shown(), "boss: combat ending inside the fight keeps it in " .. place[3])
  fire("ENCOUNTER_END")
  check(not shown(), "boss: hidden on ENCOUNTER_END in " .. place[3])
end
inside, kind = true, "raid"
fire("PLAYER_ENTERING_WORLD")
fire("ENCOUNTER_START")
local p = parts()
check(p.icon.texture == 136080, "the icon is Rebirth's (136080): " .. tostring(p.icon.texture))
check(p.cooldown.template == "CooldownFrameTemplate", "the sweep is a CooldownFrameTemplate cooldown")
check(p.count.text == 2, "the count is written: " .. tostring(p.count.text))
check(p.frame.alpha == 1, "a charge pool: full brightness: " .. tostring(p.frame.alpha))
check(near(p.count.rgb, P.text) and near(p.frame.edge, P.outline), "2 charges: the text colour and the outline")
check(p.timeText.text == "", "nothing recharging: no time")
fire("ENCOUNTER_END")

-- In any combat: between PLAYER_REGEN_DISABLED and PLAYER_REGEN_ENABLED, anywhere
s.show = "combat"
for _, place in ipairs(PLACES) do
  inside, kind = place[1], place[2]
  fire("ZONE_CHANGED_NEW_AREA")
  check(not shown(), "combat: out of combat in " .. place[3] .. ", nothing")
  fire("PLAYER_REGEN_DISABLED")
  check(shown(), "combat: in combat in " .. place[3] .. ", shown")
  fire("PLAYER_REGEN_ENABLED")
  check(not shown(), "combat: hidden when combat ends in " .. place[3])
end

-- Always (the stored key stays "raid"): anywhere, in or out of combat
s.show = "raid"
for _, place in ipairs(PLACES) do
  inside, kind = place[1], place[2]
  fire("ZONE_CHANGED_NEW_AREA")
  check(shown(), "Always: shown in " .. place[3])
end

-- Only in a group: solo hides it in every mode; joining or leaving a group (GROUP_ROSTER_UPDATE) applies at once
s.groupOnly = true
grouped = false
fire("GROUP_ROSTER_UPDATE")
check(not shown(), "Only in a group: solo, Always shows nothing")
grouped = true
fire("GROUP_ROSTER_UPDATE")
check(shown(), "Only in a group: in a party, Always shows it")
grouped = false
fire("GROUP_ROSTER_UPDATE")
check(not shown(), "Only in a group: leaving the group hides it")
s.show = "combat"
fire("PLAYER_REGEN_DISABLED")
check(not shown(), "Only in a group: solo combat on a dummy shows nothing")
grouped = true
fire("GROUP_ROSTER_UPDATE")
check(shown(), "Only in a group: a party in combat shows it")
fire("PLAYER_REGEN_ENABLED")
check(not shown(), "Only in a group: still hidden out of combat in a party")
s.show = "boss"
grouped = false
fire("ENCOUNTER_START")
check(not shown(), "Only in a group: a solo boss shows nothing")
grouped = true
fire("GROUP_ROSTER_UPDATE")
check(shown(), "Only in a group: a boss in a party shows it")
fire("ENCOUNTER_END")
IsInGroup = function() error("no group API") end
s.show = "raid"
local okG, errG = pcall(fire, "GROUP_ROSTER_UPDATE")
check(okG and not shown(), "Only in a group: a failing IsInGroup counts as solo, no error: " .. tostring(errG))
IsInGroup = function() return grouped end
s.groupOnly = false
grouped = false
fire("GROUP_ROSTER_UPDATE")
check(shown(), "Only in a group off: solo shows it again")
inside, kind = true, "raid"
fire("PLAYER_ENTERING_WORLD")

-- No charge pool (outside a boss fight or a key, GetSpellCharges gives nothing): dimmed, a dash, no sweep, no time,
-- normal colours; full again when a pool appears
info = { currentCharges = 1, maxCharges = 5, cooldownStartTime = now - 60, cooldownDuration = 300, chargeModRate = 1, isActive = true }
fire("SPELL_UPDATE_CHARGES")
info = nil
fire("SPELL_UPDATE_CHARGES")
check(p.count.text == DASH, "no pool: a dash for the count: " .. tostring(p.count.text))
check(type(p.frame.alpha) == "number" and p.frame.alpha < 1 and p.frame.alpha > 0, "no pool: dimmed: " .. tostring(p.frame.alpha))
check(p.cooldown.cd == nil and p.cooldown.fromDuration == nil and p.timeText.text == "", "no pool: no sweep, no time")
check(near(p.count.rgb, P.text) and near(p.frame.edge, P.outline), "no pool: normal colours")
info = { currentCharges = 1, maxCharges = 5, cooldownStartTime = now - 60, cooldownDuration = 300, chargeModRate = 1, isActive = true }
fire("SPELL_UPDATE_CHARGES")
check(p.frame.alpha == 1 and p.count.text == 1, "a pool appears (SPELL_UPDATE_CHARGES): full brightness and the count")
info = nil
fire("SPELL_UPDATE_CHARGES")
info = { currentCharges = 2, maxCharges = 2, cooldownStartTime = 0, cooldownDuration = 0, chargeModRate = 1, isActive = false }
fire("ENCOUNTER_START")
check(p.frame.alpha == 1 and p.count.text == 2, "a pool on ENCOUNTER_START, full and not recharging (isActive false): full brightness")
fire("ENCOUNTER_END")
info = { currentCharges = 1, maxCharges = 0, cooldownStartTime = 0, cooldownDuration = 0, chargeModRate = 1, isActive = false }
fire("SPELL_UPDATE_CHARGES")
check(p.count.text == DASH and p.frame.alpha < 1, "a reading with no charges at all (maxCharges 0): no pool")

-- A stale pool: Always keeps the icon after ENCOUNTER_END; the game may still give the old pool at that moment, so
-- the charges are read again a moment later, and with no pool then it dims back to the dash
timers = {}
info = { currentCharges = 1, maxCharges = 5, cooldownStartTime = 0, cooldownDuration = 0, chargeModRate = 1, isActive = false }
fire("ENCOUNTER_START")
fire("ENCOUNTER_END")
check(shown() and p.count.text == 1 and p.frame.alpha == 1, "ENCOUNTER_END: the pool still read at once, full")
check(#timers == 1 and timers[1].sec > 0 and timers[1].sec <= 2, "ENCOUNTER_END: one re-read a moment later: " .. #timers)
info = nil
runTimers()
check(p.count.text == DASH and p.frame.alpha < 1, "the delayed re-read with no pool: the dimmed dash")
-- a key: start and complete read the charges again (completed and reset once more a moment later)
info = { currentCharges = 1, maxCharges = 1, cooldownStartTime = 0, cooldownDuration = 0, chargeModRate = 1, isActive = false }
fire("CHALLENGE_MODE_START")
check(p.count.text == 1 and p.frame.alpha == 1, "CHALLENGE_MODE_START: the key's pool read, full")
check(#timers == 0, "CHALLENGE_MODE_START: no delayed re-read")
info = nil
fire("CHALLENGE_MODE_COMPLETED")
check(p.count.text == DASH and p.frame.alpha < 1, "CHALLENGE_MODE_COMPLETED: read again, the dimmed dash")
info = { currentCharges = 1, maxCharges = 1, cooldownStartTime = 0, cooldownDuration = 0, chargeModRate = 1, isActive = false }
fire("CHALLENGE_MODE_START")
fire("CHALLENGE_MODE_COMPLETED")
check(p.count.text == 1, "(set up) the pool still there right after the key")
check(#timers == 2, "CHALLENGE_MODE_COMPLETED: a delayed re-read: " .. #timers)
info = nil
runTimers()
check(p.count.text == DASH and p.frame.alpha < 1, "after the key, the delayed re-read: the dimmed dash")
info = { currentCharges = 1, maxCharges = 1, cooldownStartTime = 0, cooldownDuration = 0, chargeModRate = 1, isActive = false }
fire("CHALLENGE_MODE_START")
info = nil
fire("CHALLENGE_MODE_RESET")
check(p.count.text == DASH and #timers == 1, "CHALLENGE_MODE_RESET: read again and once more later")
runTimers()
-- the timer never errors when the icon is hidden by then, nor without C_Timer
s.enabled = false
fire("ENCOUNTER_END")
local okT, errT = pcall(runTimers)
check(okT and not shown(), "a delayed re-read while hidden: nothing, no error: " .. tostring(errT))
s.enabled = true
local keepTimer = C_Timer
C_Timer = nil
okT, errT = pcall(fire, "ENCOUNTER_END")
check(okT and shown(), "no C_Timer: no error: " .. tostring(errT))
C_Timer = keepTimer

-- Charges change: SPELL_UPDATE_CHARGES writes the new count
info = { currentCharges = 1, maxCharges = 5, cooldownStartTime = now - 60, cooldownDuration = 300, chargeModRate = 1, isActive = true }
fire("SPELL_UPDATE_CHARGES")
check(p.count.text == 1, "a battle res used: the count drops: " .. tostring(p.count.text))
check(p.cooldown.cd and p.cooldown.cd[1] == now - 60 and p.cooldown.cd[2] == 300, "plain numbers: the sweep runs from them")
check(p.cooldown.hideNumbers == true, "plain numbers: the game's numbers stay hidden (the time text shows)")
check(p.timeText.text == "4:00", "the time to the next charge: " .. tostring(p.timeText.text))
now = now + 200
p.frame.scripts.OnUpdate(p.frame, 1)
check(p.timeText.text == "40", "the time counts down on the tick: " .. tostring(p.timeText.text))
s.timer = false
B:Apply()
check(p.timeText.text == "", "Show the timer off: no time")
s.timer = true
B:Apply()

-- 0 charges: the theme's bad colour on the number and the border; back to normal at 1
info = { currentCharges = 0, maxCharges = 5, cooldownStartTime = now - 10, cooldownDuration = 300, chargeModRate = 1, isActive = true }
fire("SPELL_UPDATE_CHARGES")
check(p.count.text == 0, "0 charges written")
check(near(p.count.rgb, P.bad) and near(p.frame.edge, P.bad), "0 charges: the number and the border are the theme's bad")
UI.SwitchTheme("nitro")
check(near(p.count.rgb, CRT.THEMES.nitro.bad) and near(p.frame.edge, CRT.THEMES.nitro.bad), "a theme switch repaints the bad colour")
UI.SwitchTheme("cowfee")
info = { currentCharges = 1, maxCharges = 5, cooldownStartTime = now, cooldownDuration = 300, chargeModRate = 1, isActive = true }
fire("SPELL_UPDATE_CHARGES")
check(near(p.count.rgb, P.text) and near(p.frame.edge, P.outline), "a charge back: normal colours again")

-- Full charges: no sweep, no time
info = { currentCharges = 5, maxCharges = 5, cooldownStartTime = 0, cooldownDuration = 0, chargeModRate = 1, isActive = false }
fire("SPELL_UPDATE_CHARGES")
check(p.cooldown.cd == nil and p.timeText.text == "", "nothing recharging: the sweep and the time clear")

-- Secret charges: no error, the count through SetText as it is, no bad colour, nothing secret kept or given to SetCooldown
info = { currentCharges = 0, maxCharges = 5, cooldownStartTime = 0, cooldownDuration = 0, chargeModRate = 1, isActive = false }
fire("SPELL_UPDATE_CHARGES")
check(near(p.count.rgb, P.bad), "(set up) plain 0 is bad")
local cs = secret()
info = { currentCharges = cs, maxCharges = 5, cooldownStartTime = secret(), cooldownDuration = secret(), chargeModRate = 1, isActive = true }
p.cooldown.calls = {}
local ok, err = pcall(fire, "SPELL_UPDATE_CHARGES")
check(ok, "secret charges raise no error: " .. tostring(err))
check(p.count.text == cs, "secret charges: the count goes to SetText as it is")
check(near(p.count.rgb, P.text) and near(p.frame.edge, P.outline), "secret charges: no bad colour (it needs a comparison)")
check(not (p.cooldown.cd and holdsSecret(p.cooldown.cd)), "secret charges: SetCooldown never gets a secret")
check(p.cooldown.fromDuration == duration, "secret charges: the sweep comes from the game's duration object")
check(p.cooldown.hideNumbers == false, "secret charges: the game's own numbers show the time")
check(p.timeText.text == "", "secret charges: no time worked out here")
check(not holdsSecret(B.State()), "secret charges: nothing secret kept")
check(p.frame.alpha == 1, "secret charges: a pool, full brightness")
-- a secret maxCharges (never secret by the docs, guarded anyway): still a pool, never compared
info = { currentCharges = secret(), maxCharges = secret(), cooldownStartTime = secret(), cooldownDuration = secret(), chargeModRate = 1, isActive = true }
ok, err = pcall(fire, "SPELL_UPDATE_CHARGES")
check(ok and p.frame.alpha == 1, "secret maxCharges: a pool, no error: " .. tostring(err))
info = { currentCharges = cs, maxCharges = 5, cooldownStartTime = secret(), cooldownDuration = secret(), chargeModRate = 1, isActive = true }
fire("SPELL_UPDATE_CHARGES")
s.timer = false
B:Apply()
check(p.cooldown.hideNumbers == true, "secret charges, Show the timer off: the game's numbers hidden too")
s.timer = true
-- secret with isActive false: the sweep clears, still no error
info = { currentCharges = secret(), maxCharges = 5, cooldownStartTime = secret(), cooldownDuration = secret(), chargeModRate = secret(), isActive = false }
ok, err = pcall(fire, "SPELL_UPDATE_CHARGES")
check(ok and p.cooldown.cd == nil and p.cooldown.fromDuration == nil, "secret, not recharging: the sweep clears: " .. tostring(err))
-- no duration API: count only
local keep = C_Spell.GetSpellChargeDuration
C_Spell.GetSpellChargeDuration = nil
info = { currentCharges = secret(), maxCharges = 5, cooldownStartTime = secret(), cooldownDuration = secret(), chargeModRate = 1, isActive = true }
ok, err = pcall(fire, "SPELL_UPDATE_CHARGES")
check(ok and p.cooldown.cd == nil and p.cooldown.fromDuration == nil, "no duration object: count only, no sweep: " .. tostring(err))
-- the duration setter refusing it: count only
C_Spell.GetSpellChargeDuration = keep
p.cooldown.SetCooldownFromDurationObject = function() error("refused") end
ok, err = pcall(fire, "SPELL_UPDATE_CHARGES")
check(ok and p.cooldown.cd == nil, "the duration refused: count only, no error: " .. tostring(err))
p.cooldown.SetCooldownFromDurationObject = nil

-- Nothing to read (no shared charges now): the dimmed dash
info = nil
fire("SPELL_UPDATE_CHARGES")
check(p.count.text == DASH and near(p.count.rgb, P.text), "no reading: a dash, normal colours")
C_Spell.GetSpellCharges = nil
ok, err = pcall(fire, "SPELL_UPDATE_CHARGES")
check(ok and p.count.text == DASH and p.frame.alpha < 1, "no GetSpellCharges at all: the dimmed dash, no error: " .. tostring(err))
-- the preview is never dimmed
previews.battleres(true)
check(p.frame.alpha == 1 and p.count.text == "2", "preview over no pool: full brightness")
previews.battleres(false)
check(p.frame.alpha < 1 and p.count.text == DASH, "preview off with no pool: dimmed dash again")
C_Spell.GetSpellCharges = function() return info end

-- Size
s.size = 200
B:Apply()
check(p.frame.w == 88 and p.frame.h == 88, "Size 200%: twice the side: " .. tostring(p.frame.w))
s.size = 50
B:Apply()
check(p.frame.w == 22, "Size 50%: half the side: " .. tostring(p.frame.w))
s.size = 100

-- Preview: a sample (2 ready, one coming back) with its drag box, even while off; it ends where it was
s.enabled = false
B:Apply()
check(not shown(), "(set up) off and hidden")
check(previews.battleres ~= nil, "the preview key is battleres")
previews.battleres(true)
check(shown() and p.handle.shown, "preview: shown with its drag box while off")
check(p.count.text == "2", "preview: 2 ready: " .. tostring(p.count.text))
check(p.cooldown.cd ~= nil and p.timeText.text == "3:42", "preview: one charge coming back: " .. tostring(p.timeText.text))
info = { currentCharges = 0, maxCharges = 5, cooldownStartTime = 0, cooldownDuration = 0, chargeModRate = 1, isActive = false }
fire("SPELL_UPDATE_CHARGES")
check(p.count.text == "2", "preview: a charge update leaves the sample")
previews.battleres(false)
check(not shown() and not p.handle.shown, "preview off: hidden again (the icon is off)")
s.enabled = true
inside, kind = true, "raid"
s.show = "raid"
previews.battleres(true)
previews.battleres(false)
check(shown() and not p.handle.shown and p.count.text == 0, "preview off while wanted: the real charges again")

-- Entering the world (a zone-in or a release mid-fight): the fight and combat are read again, not only at login
s.show = "boss"
fire("ENCOUNTER_END")
check(not shown(), "(set up) no fight, hidden")
IsEncounterInProgress = function() return true end
fire("PLAYER_ENTERING_WORLD")
check(shown(), "boss: entering the world mid-fight shows it")
IsEncounterInProgress = function() return false end
fire("PLAYER_ENTERING_WORLD")
check(not shown(), "boss: entering the world after the fight hides it")
s.show = "combat"
inside, kind = true, "raid"
UnitAffectingCombat = function() return true end
fire("PLAYER_ENTERING_WORLD")
check(shown(), "combat: entering a raid in combat shows it")
UnitAffectingCombat = function() return false end
fire("PLAYER_ENTERING_WORLD")
check(not shown(), "combat: entering out of combat hides it")
s.show = "raid"

-- The probe: every field, secrets by type only; no error with secret fields
assert(load(probeSrc, "BattleResProbe.lua"))("CowfeeRaidTools", CRT)
local out = {}
local realPrint = print
print = function(t) out[#out + 1] = tostring(t) end
info = { currentCharges = secret(), maxCharges = 5, cooldownStartTime = secret(), cooldownDuration = secret(), chargeModRate = 1, isActive = true }
printed = {}
ok, err = pcall(function() return CRT.BattleResProbe:Command("dev brez") end)
print = realPrint
check(ok and err == true, "/crt dev brez runs with secret fields: " .. tostring(err))
local all = table.concat(out, "\\n")
check(all:find("currentCharges: <secret number>", 1, true) and all:find("maxCharges: 5", 1, true) and all:find("isActive: true", 1, true), "the probe prints each field, a secret by its type: " .. all)
check(all:find("Encounter active", 1, true) and all:find("SetCooldownFromDurationObject", 1, true), "the probe says whether the encounter is active and tries the duration object")
check(all:find("in a group false", 1, true) and all:find("instance raid", 1, true) and not all:find("in a raid", 1, true), "the probe prints in a group and the instance kind: " .. all)
check(CRT.BattleResProbe:Command("dev other") == false, "the probe takes only dev brez")

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error(fails .. " battle res checks failed") end
`;
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const src = read('CRT_Modules/QoL/BattleRes.lua');
let srcFails = 0;
// no fixed colour: the texts and the border read the palette
if (/SetTextColor\(\s*[\d.]+\s*,/.test(src) || /SetBackdropBorderColor\(\s*[\d.]+/.test(src)) { console.log('FAIL BattleRes.lua writes a fixed colour'); srcFails++; }
// wording in a TEXT table, and no other addon's name
if (!/^local TEXT = \{/m.test(src)) { console.log('FAIL BattleRes.lua has no TEXT table'); srcFails++; }
for (const f of ['CRT_Modules/QoL/BattleRes.lua', 'CRT_Dev/Dev/BattleResProbe.lua']) {
  if (/BigWigs|DBM|Northern Sky|NSRT|\bMRT\b|WeakAuras|Details/i.test(read(f))) { console.log('FAIL ' + f + ' names another addon'); srcFails++; }
}
// wired in: the .toc (the probe inside the do-not-package block), the defaults, the slash command, the page's tab
const toc = read('CowfeeRaidTools.toc');
const dev = toc.slice(toc.indexOf('#@do-not-package@'), toc.indexOf('#@end-do-not-package@'));
if (!/CRT_Modules\\QoL\\BreakTimer\.lua\r?\nCRT_Modules\\QoL\\BattleRes\.lua/.test(toc)) { console.log('FAIL BattleRes.lua is not in the .toc beside the QoL files'); srcFails++; }
if (!dev.includes('CRT_Dev\\Dev\\BattleResProbe.lua')) { console.log('FAIL BattleResProbe.lua is not in the do-not-package block'); srcFails++; }
if (!/battleRes = \{ enabled = false, show = "boss", groupOnly = false, timer = true, size = 100 \}/.test(read('CRT_Core/Core.lua'))) { console.log('FAIL Core.lua lacks the battleRes defaults'); srcFails++; }
const slash = read('CRT_Core/Slash.lua');
const slashDev = slash.slice(slash.indexOf('--@do-not-package@'), slash.indexOf('--@end-do-not-package@'));
if (!slashDev.includes('CRT.BattleResProbe:Command(msg)')) { console.log('FAIL /crt dev brez is not in Slash.lua\'s do-not-package block'); srcFails++; }
const page = read('CRT_Modules/QoL/Page.lua');
if (!/\{ key = "brez", label = "Battle res" \},\s*\{ key = "sounds"/.test(page)) { console.log('FAIL the Battle res tab is missing from Quality of Life'); srcFails++; }
for (const k of ['UI.Dropdown(pf, TEXT.brezShow', 'UI.Slider(pf, TEXT.brezSize', 'UI.PreviewButton(pf, TEXT.brezPreview, { "battleres" }', 'UI.HelpRight(enable.label', 'checkRow(pf, 6, top - 66, TEXT.brezGroupOnly)', 'UI.HelpRight(show, TEXT.brezShow, {']) {
  if (!page.includes(k)) { console.log('FAIL the Battle res tab lacks ' + k); srcFails++; }
}
// the three choices' labels (stored keys unchanged), and no raid-only wording left on the page or in the defaults' comment
for (const k of ['{ key = "boss", label = TEXT.brezBoss }', '{ key = "combat", label = TEXT.brezCombat }', '{ key = "raid", label = TEXT.brezRaid }', 'brezBoss = "In boss fights"', 'brezCombat = "In any combat"', 'brezRaid = "Always"', 'brezGroupOnly = "Only in a group"']) {
  if (!page.includes(k)) { console.log('FAIL Page.lua lacks ' + k); srcFails++; }
}
if (/raids only|never shows in dungeons|in a raid"/i.test(page)) { console.log('FAIL Page.lua still says the icon is raid-only'); srcFails++; }
if (/inRaid\(/.test(src)) { console.log('FAIL BattleRes.lua still gates on a raid instance'); srcFails++; }
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(src));
lua.lua_pushstring(L, to_luastring(read('CRT_Dev/Dev/BattleResProbe.lua')));
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
if (srcFails > 0) process.exit(1);
console.log('ok battle res icon: shows per setting, secret charges never compared');
