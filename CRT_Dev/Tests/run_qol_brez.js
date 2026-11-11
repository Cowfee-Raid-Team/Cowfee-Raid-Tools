// CRT_Modules/QoL/BattleRes.lua and CRT_Dev/Dev/BattleResProbe.lua: the battle res icon. It shows and hides per its
// Show it setting on the game's events (boss fights, any combat in a raid, always in a raid), never while it is off;
// writes the charges; at 0 plain charges turns its number and border the theme's bad colour; runs the sweep and the
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
issecretvalue = function(v) return type(v) == "table" and getmetatable(v) == secretMeta end
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

local CRT = { db = { qol = { battleRes = { enabled = false, show = "boss", timer = true, size = 100 } } } }
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
for _, e in ipairs({ "ENCOUNTER_START", "ENCOUNTER_END", "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED", "PLAYER_ENTERING_WORLD" }) do
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

-- In boss fights (the default)
s.enabled = true
s.show = "boss"
B:Apply()
check(not shown(), "boss: hidden before the pull")
fire("ENCOUNTER_START")
check(shown(), "boss: shown on ENCOUNTER_START")
local p = parts()
check(p.icon.texture == 136080, "the icon is Rebirth's (136080): " .. tostring(p.icon.texture))
check(p.cooldown.template == "CooldownFrameTemplate", "the sweep is a CooldownFrameTemplate cooldown")
check(p.count.text == 2, "the count is written: " .. tostring(p.count.text))
check(near(p.count.rgb, P.text) and near(p.frame.edge, P.outline), "2 charges: the text colour and the outline")
check(p.timeText.text == "", "nothing recharging: no time")
fire("PLAYER_REGEN_DISABLED")
fire("PLAYER_REGEN_ENABLED")
check(shown(), "boss: combat ending inside the fight keeps it")
fire("ENCOUNTER_END")
check(not shown(), "boss: hidden on ENCOUNTER_END")
fire("PLAYER_REGEN_DISABLED")
check(not shown(), "boss: trash combat shows nothing")
fire("PLAYER_REGEN_ENABLED")

-- In any combat in a raid
s.show = "combat"
B:Apply()
fire("PLAYER_REGEN_DISABLED")
check(not shown(), "combat: outside a raid instance, nothing")
fire("PLAYER_REGEN_ENABLED")
inside, kind = true, "raid"
fire("ZONE_CHANGED_NEW_AREA")
check(not shown(), "combat: in a raid, out of combat, nothing")
fire("PLAYER_REGEN_DISABLED")
check(shown(), "combat: in combat in a raid, shown")
fire("PLAYER_REGEN_ENABLED")
check(not shown(), "combat: hidden when combat ends")
inside, kind = true, "party"
fire("PLAYER_REGEN_DISABLED")
check(not shown(), "combat: a dungeon is not a raid")
fire("PLAYER_REGEN_ENABLED")

-- Always in a raid
s.show = "raid"
inside, kind = true, "raid"
fire("PLAYER_ENTERING_WORLD")
check(shown(), "raid: shown inside a raid instance")
inside, kind = false, "none"
fire("ZONE_CHANGED_NEW_AREA")
check(not shown(), "raid: hidden outside")
inside, kind = true, "raid"
fire("PLAYER_ENTERING_WORLD")

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

-- Nothing to read (no shared charges now): an empty count
info = nil
fire("SPELL_UPDATE_CHARGES")
check(p.count.text == "" and near(p.count.rgb, P.text), "no reading: an empty count, normal colours")
C_Spell.GetSpellCharges = nil
ok, err = pcall(fire, "SPELL_UPDATE_CHARGES")
check(ok and p.count.text == "", "no GetSpellCharges at all: no error: " .. tostring(err))
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
check(all:find("currentCharges: <secret table>", 1, true) and all:find("maxCharges: 5", 1, true) and all:find("isActive: true", 1, true), "the probe prints each field, a secret by its type: " .. all)
check(all:find("Encounter active", 1, true) and all:find("SetCooldownFromDurationObject", 1, true), "the probe says whether the encounter is active and tries the duration object")
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
if (!/battleRes = \{ enabled = false, show = "boss", timer = true, size = 100 \}/.test(read('CRT_Core/Core.lua'))) { console.log('FAIL Core.lua lacks the battleRes defaults'); srcFails++; }
const slash = read('CRT_Core/Slash.lua');
const slashDev = slash.slice(slash.indexOf('--@do-not-package@'), slash.indexOf('--@end-do-not-package@'));
if (!slashDev.includes('CRT.BattleResProbe:Command(msg)')) { console.log('FAIL /crt dev brez is not in Slash.lua\'s do-not-package block'); srcFails++; }
const page = read('CRT_Modules/QoL/Page.lua');
if (!/\{ key = "brez", label = "Battle res" \},\s*\{ key = "sounds"/.test(page)) { console.log('FAIL the Battle res tab is missing from Quality of Life'); srcFails++; }
for (const k of ['UI.Dropdown(pf, TEXT.brezShow', 'UI.Slider(pf, TEXT.brezSize', 'UI.PreviewButton(pf, TEXT.brezPreview, { "battleres" }', 'UI.HelpRight(enable.label']) {
  if (!page.includes(k)) { console.log('FAIL the Battle res tab lacks ' + k); srcFails++; }
}
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(src));
lua.lua_pushstring(L, to_luastring(read('CRT_Dev/Dev/BattleResProbe.lua')));
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
if (srcFails > 0) process.exit(1);
console.log('ok battle res icon: shows per setting, secret charges never compared');
