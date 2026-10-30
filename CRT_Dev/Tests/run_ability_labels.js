// Ability labels shipped in the boss files: the boss file's abilities field (CRT_Data/Bosses/Registry.lua:
// Bosses.ReadAbilities, Bosses:Abilities), laid under your own labels field by field (CRT_Modules/Timeline/Data.lua:
// Timeline:Ability, Labels, ApplyAbilities), and the /crt dev labels window that exports them for the boss files and
// clears yours (CRT_Dev/Dev/AbilityLabels.lua): its boss tick boxes with All and None, Export, and Clear.
// Usage: node run_ability_labels.js <addon folder>
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = String.raw`
local regSrc, seasonSrc, refSrc, dataSrc, labelsSrc = ...
local unpack = unpack or table.unpack

-- A stand-in frame: scripts, shown, checked, enabled and text are kept; any other method does nothing.
local function frame(kind)
  local f = { kind = kind, scripts = {}, shown = true, enabled = true, checked = false, children = {} }
  local m = {}
  function m:SetScript(k, fn) self.scripts[k] = fn end
  function m:HookScript(k, fn) local old = self.scripts[k] self.scripts[k] = function(...) if old then old(...) end return fn(...) end end
  function m:GetScript(k) return self.scripts[k] end
  function m:Show() local was = self.shown self.shown = true if not was and self.scripts.OnShow then self.scripts.OnShow(self) end end
  function m:Hide() self.shown = false end
  function m:SetShown(v) if v then self:Show() else self:Hide() end end
  function m:IsShown() return self.shown end
  function m:SetChecked(v) self.checked = v and true or false end
  function m:GetChecked() return self.checked end
  function m:SetEnabled(v) self.enabled = v and true or false end
  function m:IsEnabled() return self.enabled end
  function m:SetText(t) self.text = t end
  function m:GetText() return self.text end
  function m:CreateFontString() local s = frame("FontString") table.insert(self.children, s) return s end
  function m:CreateTexture() return frame("Texture") end
  function m:Click() if self.enabled and self.scripts.OnClick then self.scripts.OnClick(self) end end
  return setmetatable(f, { __index = function(_, k) return m[k] or function() end end })
end
local made = {}
function CreateFrame(kind, name, parent)
  local f = frame(kind)
  made[#made + 1] = f
  if parent and parent.children then table.insert(parent.children, f) end
  return f
end
function InCombatLockdown() return false end
C_Timer = { After = function() end }
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
date = os.date
CANCEL = "Cancel"

local printed = {}
local CRT = { db = { timeline = { bosses = {}, nextId = 1 } } }
function CRT:Print(m) printed[#printed + 1] = m end
local popup, shownText
function StaticPopup_ShowCustomGenericConfirmation(data) popup = data end
CRT.ConsumablesTools = { ShowText = function(_, title, text) shownText = { title = title, text = text } end }
CRT.UI = {
  HeadingText = function(t) return "<h>" .. t end,
  ColorText = function(t, key) return "<" .. key .. ">" .. t end,
  SkinCheckButton = function() end, SkinScrollBar = function() end,
  LiftOver = function() end, ShownPopup = function(r) return r end,
  PanelButton = function(parent, label, h, fn) local b = CreateFrame("Button", nil, parent) b.text = label b:SetScript("OnClick", fn) return b end,
  Window = function(name, opts)
    local w = CreateFrame("Frame", name)
    w.opts = opts
    w.content = CreateFrame("Frame", nil, w)
    w.strip = { SetHelp = function(_, t, h) w.helpTitle, w.help = t, h end }
    w.shown = false
    return w
  end,
}

assert(load(regSrc, "Registry.lua"))("CowfeeRaidTools", CRT)
assert(load(seasonSrc, "Season.lua"))("CowfeeRaidTools", CRT)
assert(load(refSrc, "Reference.lua"))("CowfeeRaidTools", CRT)
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
assert(load(labelsSrc, "AbilityLabels.lua"))("CowfeeRaidTools", CRT)
local B, T, D = CRT.Bosses, CRT.Timeline, CRT.AbilityLabelsDev

local fails = 0
local function check(name, ok) print((ok and "PASS " or "FAIL ") .. name) if not ok then fails = fails + 1 end end
local function list(t) local out = {} for i, v in ipairs(t or {}) do out[i] = tostring(v) end return table.concat(out, ",") end

-- the field parses -----------------------------------------------------------------------------------------
CRT.Dev = {} -- a developer build: skipped entries are said in chat
B:Register({ encounterID = 3470, name = "Nek'zali the Soulcoiler", season = "sample", abilities = {
  [5001] = { type = "raid", name = "Big Hit", row = true, tags = { "tank", "magic" } },
  [5002] = { type = "nonsense", name = "Odd" },
  [5003] = { type = "soak", also = { "spread" } },
  [5004] = { tags = { "tank", "sparkly" } },
  ["5005"] = { type = "raid" },
  [5006] = { name = 42, row = "yes", type = "raid" },
} })
B:Register({ encounterID = 3445, name = "Entombed Sentinels", season = "sample" })
B:Register({ encounterID = 3420, name = "Sszorak", season = "sample" })
B:Build()
local a = B:Abilities(3470)
check("the field is read by spell ID", a and a[5001] and a[5001].type == "raid" and a[5001].name == "Big Hit" and a[5001].row == true and list(a[5001].tags) == "tank,magic")
check("an unknown type is left out, the rest of its label kept", a[5002] and a[5002].type == nil and a[5002].name == "Odd")
check("one type only: also is not part of the format", a[5003] and a[5003].type == "soak" and a[5003].also == nil)
check("an unknown tag is left out", list(a[5004].tags) == "tank")
check("a spell ID written as text is left out", a["5005"] == nil and a[5005] == nil)
local said = table.concat(printed, "\n")
check("a developer build says what was left out", said:find("type nonsense of spell 5002", 1, true) ~= nil and said:find("field also of spell 5003", 1, true) ~= nil
  and said:find("tag sparkly of spell 5004", 1, true) ~= nil and said:find("entry 5005", 1, true) ~= nil)
check("a name that isn't text and a row that isn't true are left out, and said", a[5006] and a[5006].type == "raid" and a[5006].name == nil and a[5006].row == nil
  and said:find("name 42 of spell 5006", 1, true) ~= nil and said:find("row yes of spell 5006", 1, true) ~= nil)
check("a boss with no field has none", B:Abilities(3445) == nil and B:Abilities(9999) == nil)
printed = {}
CRT.Dev = nil
check("a packaged build reads it quietly", B.ReadAbilities({ [1] = { type = "nope" } }, 1) == nil and #printed == 0)
CRT.Dev = {}

-- the layers, field by field --------------------------------------------------------------------------------
local function lanes()
  return {
    { key = "ref:A", kind = "reference", label = "Ref A", spellID = 5001, types = { "dodge" }, color = { 0, 0, 0 } },
    { key = "ref:O", kind = "reference", label = "Ref Odd", spellID = 5002, types = { "dodge" } },
    { key = "ref:N", kind = "reference", label = "Ref None", spellID = 7777, types = { "dodge" } },
    { key = "deaths", kind = "deaths", label = "Deaths" },
  }
end
local journal = { { spellID = 5001, name = "Journal A", icon = 1 }, { spellID = 6001, name = "Journal New", icon = 2 } }
local function byKey(ls) local out = {} for _, l in ipairs(ls) do out[l.key] = l end return out end
local Rd = CRT.TimelineReference

local s = byKey(T:ApplyAbilities(lanes(), 3470, {}))
check("shipped: name, type, colour and icons over the ability timeline's", s["ref:A"].label == "Big Hit" and s["ref:A"].baseLabel == "Ref A" and list(s["ref:A"].types) == "raid"
  and s["ref:A"].color == Rd.TYPES.raid.color and list(s["ref:A"].tags) == "tank,magic")
check("shipped: an unknown type keeps the ability timeline's", list(s["ref:O"].types) == "dodge" and s["ref:O"].label == "Odd")
check("no label anywhere: the ability timeline's (type ...)", list(s["ref:N"].types) == "dodge" and s["ref:N"].label == "Ref None")
local j = byKey(T:ApplyAbilities({}, 3470, journal))
check("shipped row = true gives a row for everyone", j["journal:5001"] ~= nil and j["journal:5001"].label == "Big Hit" and j["journal:6001"] == nil)

T:SetAbility(3470, 5001, "type", "soak")
s = byKey(T:ApplyAbilities(lanes(), 3470, {}))
check("your type wins, the shipped name and icons stay", list(s["ref:A"].types) == "soak" and s["ref:A"].label == "Big Hit" and list(s["ref:A"].tags) == "tank,magic")
T:SetAbility(3470, 5001, "name", "Mine")
T:SetAbility(3470, 5001, "tags", { "healer" })
s = byKey(T:ApplyAbilities(lanes(), 3470, {}))
check("your name and icons win", s["ref:A"].label == "Mine" and list(s["ref:A"].tags) == "healer" and list(s["ref:A"].types) == "soak")
T:SetAbility(3470, 5001, "type", nil)
s = byKey(T:ApplyAbilities(lanes(), 3470, {}))
check("cleared type falls back to the shipped one", list(s["ref:A"].types) == "raid" and s["ref:A"].label == "Mine")
check("Ability lays both, OwnAbility only yours", T:Ability(3470, 5001).name == "Mine" and T:Ability(3470, 5001).type == "raid" and T:Ability(3470, 5001).row == true
  and T:OwnAbility(3470, 5001).type == nil and T:OwnAbility(3470, 5001).name == "Mine")
check("Ability is nil for an ability with no label", T:Ability(3470, 4242) == nil and T:Ability("Some Boss", 5001) == nil)
T:SetAbility(3445, 8001, "type", "spread")
check("your own label alone, on a boss with none shipped", list(byKey(T:ApplyAbilities({ { key = "s", kind = "spell", label = "S", spellID = 8001 } }, 3445, {})).s.types) == "spread")

CRT.Dev = nil -- a packaged build: yours are left out, the boss file's still apply
s = byKey(T:ApplyAbilities(lanes(), 3470, {}))
check("packaged build: the shipped label applies", s["ref:A"].label == "Big Hit" and list(s["ref:A"].types) == "raid" and list(s["ref:A"].tags) == "tank,magic")
check("packaged build: the shipped row applies", byKey(T:ApplyAbilities({}, 3470, journal))["journal:5001"] ~= nil)
check("packaged build: your own is not read", T:OwnAbility(3470, 5001) == nil and T:Ability(3470, 5001).name == "Big Hit" and T:Ability(3445, 8001) == nil)
CRT.Dev = {}

-- the window: tick boxes with All and None -------------------------------------------------------------------
T:SetAbility(3470, 6001, "row", true)
T:SetAbility(3470, 6001, "name", "Brand New")
check("/crt dev labels is the window's word", D:Command("dev labels") == true and D:Command("dev label") == false)
local win = D.window
check("a pop-out that keeps its place and size", win and win.shown and win.opts.kind == "popout" and win.opts.saved() == CRT.db.dev.labelsWindow and win.help ~= nil)
local function line(text)
  for _, l in ipairs(win.lines) do if l.shown and l.label.text and l.label.text:find(text, 1, true) then return l end end
end
check("the raid heading", line("<h>Sample Raid") ~= nil and not line("<h>Sample Raid").check.shown)
local nek, ent, ssz = line("Nek'zali the Soulcoiler ("), line("Entombed Sentinels ("), line("Sszorak (")
check("each boss with your label count: " .. tostring(nek and nek.label.text), nek and nek.label.text == "Nek'zali the Soulcoiler (2)" and ent.label.text == "Entombed Sentinels (1)")
check("a boss with none is greyed out", ssz.label.text == "<muted>Sszorak (0)" and ssz.check.enabled == false)
check("nothing ticked, Export and Clear are off", not nek.check.checked and not win.export.enabled and not win.clear.enabled)
win.all:Click()
check("All ticks every boss with labels", nek.check.checked and ent.check.checked and not ssz.check.checked and list(D.Ticked()) == "3470,3445")
check("Export and Clear are on", win.export.enabled and win.clear.enabled)
win.none:Click()
check("None unticks them all", not nek.check.checked and not ent.check.checked and #D.Ticked() == 0)
ssz.check.checked = true ssz.check.scripts.OnClick(ssz.check)
check("a greyed boss can't be ticked", not ssz.check.checked and #D.Ticked() == 0)
nek.check.checked = true nek.check:Click()
ent.check.checked = true ent.check:Click()
check("ticking one by one", list(D.Ticked()) == "3470,3445")

-- Export: one block per ticked boss, and it round-trips through Register ----------------------------------
local function snapshot()
  local out = {}
  for _, id in ipairs({ 3470, 3445 }) do
    local ls = T:ApplyAbilities({
      { key = "ref:A", kind = "reference", label = "Ref A", spellID = 5001, types = { "dodge" } },
      { key = "s", kind = "spell", label = "S", spellID = 8001 },
    }, id, journal)
    for _, l in ipairs(ls) do
      out[#out + 1] = id .. "|" .. l.key .. "|" .. tostring(l.label) .. "|" .. list(l.types) .. "|" .. list(l.tags)
    end
  end
  return table.concat(out, "\n")
end
local before = snapshot()
win.export:Click()
local text = shownText and shownText.text or ""
local blocks = {}
for block in (text .. "\n\n"):gmatch("(.-)\n\n") do blocks[#blocks + 1] = block end
check("Export writes one block per ticked boss", #blocks == 2 and shownText.title:find("Ctrl+C", 1, true) ~= nil)
check("each block is headed by the boss, its encounter ID and the day", blocks[1]:find("-- Nek'zali the Soulcoiler (encounter 3470): ability labels, exported " .. os.date("%Y-%m-%d"), 1, true) ~= nil
  and blocks[2]:find("-- Entombed Sentinels (encounter 3445)", 1, true) ~= nil)
check("the block is the shipped labels with yours over them", blocks[1]:find('[5001] = { type = "raid", name = "Mine", row = true, tags = { "healer" } },', 1, true) ~= nil
  and blocks[1]:find('[6001] = { name = "Brand New", row = true },', 1, true) ~= nil and blocks[1]:find("[5002]", 1, true) ~= nil)
for _, block in ipairs(blocks) do
  local id = tonumber(block:match("%(encounter (%d+)%)"))
  local t = assert(load("return {\n" .. block .. "\n}"))()
  local def = B:Get(id)
  B:Register({ encounterID = id, name = def.name, season = "sample", abilities = t.abilities })
end
B.abilities = {}
B:Build()
T:ClearAbilities(3470) T:ClearAbilities(3445)
local after = snapshot()
check("round trip: exported, registered and cleared, the same lanes", after == before)
if after ~= before then print(before) print("--") print(after) end

-- Clear touches only the ticked bosses, and lists what isn't shipped yet ----------------------------------
T:SetAbility(3470, 5001, "name", "Mine") -- the same as the boss file now
T:SetAbility(3470, 7001, "type", "dispel") -- not in the boss file
T:SetAbility(3445, 8001, "type", "soak") -- another boss, not ticked
D.None() D.SetTicked(3470, true) D.Refresh()
popup = nil
win.clear:Click()
local q = popup and popup.text_arg1 or ""
check("Clear asks first", popup ~= nil and popup.text == "%s" and q:find("Clear your ability labels for 1 boss?", 1, true) ~= nil)
check("the question lists a label that differs from the boss file, not one that matches", q:find("Nek'zali the Soulcoiler: spell 7001 (7001)", 1, true) ~= nil and q:find("Mine", 1, true) == nil)
check("nothing cleared before the answer", T:OwnAbility(3470, 7001) ~= nil)
popup.callback()
check("Clear drops the ticked boss's labels", T:OwnAbilities(3470) == nil)
check("Clear leaves the other bosses alone", T:OwnAbility(3445, 8001) ~= nil and T:OwnAbility(3445, 8001).type == "soak")
check("the shipped label shows again", T:Ability(3470, 5001).name == "Mine" and T:Ability(3470, 5001).type == "raid")
check("the window follows: the boss is unticked and greyed", not nek.check.checked and nek.label.text == "<muted>Nek'zali the Soulcoiler (0)")
local many = {} for i = 1, 15 do many[i] = 100 + i end
for _, sp in ipairs(many) do T:SetAbility(3445, sp, "type", "raid") end
check("a long list is cut with a count", D.ClearQuestion({ 3445 }):find("and 4 more", 1, true) ~= nil)

print(fails == 0 and "all passed" or (fails .. " failed"))
if fails > 0 then error(fails .. " failed", 0) end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Data/Bosses/Registry.lua', 'CRT_Dev/Tests/SamplePack/Season.lua', 'CRT_Modules/Timeline/Reference.lua', 'CRT_Modules/Timeline/Data.lua', 'CRT_Dev/Dev/AbilityLabels.lua'])
  lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[2] + '/' + f, 'utf8')));
if (lua.lua_pcall(L, 5, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
