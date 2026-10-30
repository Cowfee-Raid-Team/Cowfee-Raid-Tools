// Debuff lists, the special alerts of kind debuffList: the boss file entry (CRT_Modules/Alerts/Special.lua's Special.Read),
// the sides, sort and tiers (CRT_Modules/Alerts/DebuffList.lua) and the display (CRT_Modules/Alerts/DebuffListView.lua) on
// mock frames, with a stand-in group and aura API. Secret values are proxies that raise an error on any use the game
// forbids (arithmetic, comparison, indexing, concatenation, calling, tostring), so code that touches one fails the check.
// Usage: node run_alerts_debufflist.js <addon folder>
const fs = require('fs');
const path = require('path');
const previewsLua = require('./previews_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const root = process.argv[2];
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = previewsLua(root) + `
local srcs = { ... }
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end

local SECRET = {}
local function forbidden() error("used a secret value") end
for _, k in ipairs({ "__index", "__newindex", "__len", "__concat", "__lt", "__le", "__eq", "__add", "__sub", "__mul", "__div", "__unm", "__call", "__tostring" }) do SECRET[k] = forbidden end
local function secret(v) return setmetatable({ inner = v }, SECRET) end
function issecretvalue(v) return getmetatable(v) == SECRET end
local realType = type
function type(v) if getmetatable(v) == SECRET then return realType(rawget(v, "inner")) end return realType(v) end

local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = e end end
function GetTime() return 100 end
function time() return 1792540800 end
function InCombatLockdown() return false end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
format = string.format

-- frames that remember what is done to them
local updating = {}
local function region(kind, parent)
  local r = { kind = kind, parent = parent, shown = true, pts = {}, scripts = {}, events = {} }
  function r:SetShown(v) self.shown = v and true or false end
  function r:Show() self.shown = true end
  function r:Hide() self.shown = false end
  function r:IsShown() return self.shown end
  function r:SetPoint(...) self.pts[#self.pts + 1] = { ... } end
  function r:ClearAllPoints() self.pts = {} end
  function r:SetSize(w, h) self.w, self.h = w, h end
  function r:SetWidth(w) self.w = w end
  function r:SetHeight(h) self.h = h end
  function r:GetWidth() return self.w or 0 end
  function r:GetHeight() return self.h or 0 end
  function r:SetText(t) self.text = t end
  function r:GetText() return self.text end
  function r:SetVertexColor(...) self.vertex = { ... } self.fromBoolean = nil end
  function r:SetVertexColorFromBoolean(v, a, b) self.fromBoolean = { v, a, b } self.vertex = nil end
  function r:SetScript(k, fn) self.scripts[k] = fn if k == "OnUpdate" then updating[self] = fn end end
  function r:RegisterEvent(e) self.events[e] = true end
  function r:UnregisterEvent(e) self.events[e] = nil end
  function r:CreateTexture() return region("Texture", self) end
  function r:CreateFontString() return region("FontString", self) end
  return setmetatable(r, { __index = function(_, k) if realType(k) == "string" and k:match("^%u") then return function() end end end })
end
local eventFrames = {}
function CreateFrame(kind, name, parent, template) local f = region(kind or "Frame", parent) f.template = template eventFrames[#eventFrames + 1] = f return f end
UIParent = region("Frame")
function CreateColor(r, g, b, a) return { r = r, g = g, b = b, a = a } end
local timers = {}
C_Timer = { NewTimer = function(s, fn) local t = { s = s, fn = fn } function t:Cancel() self.cancelled = true end timers[#timers + 1] = t return t end,
  After = function(s, fn) timers[#timers + 1] = { s = s, fn = fn } end }

-- the group: a raid of 10 by default, two per group, roles in turn
local raid, inRaid, inGroup = {}, true, true
local function setRaid(list) raid = list end
local function defaultRaid()
  local out, roles = {}, { "TANK", "HEALER", "DAMAGER", "DAMAGER", "DAMAGER" }
  for i = 1, 10 do out[i] = { name = "P" .. string.char(64 + ((i * 7) % 26) + 1) .. i, group = math.floor((i - 1) / 2) + 1, role = roles[(i - 1) % 5 + 1] } end
  return out
end
setRaid(defaultRaid())
function IsInRaid() return inRaid end
function IsInGroup() return inGroup end
function GetRaidRosterInfo(i)
  local p = raid[i]
  if not p then return nil, 0, 1, 1, nil, nil, nil, nil, nil, nil, false, "NONE" end
  return p.name, 0, p.group, 80, "Mage", "MAGE", "Zone", true, false, nil, false, p.combat or p.role
end
function UnitGroupRolesAssigned(unit) local i = tonumber(unit:match("%d+")) local p = i and raid[i] if p then return p.secretRole and secret(p.role) or p.role end return "NONE" end
local meIndex = 3
function UnitIsUnit(a, b) return b == "player" and a == "raid" .. meIndex end
function UnitName(u) return "Me" end

-- the aura API: auras[unit] = an aura table, a secret one, a secret boolean, or "error"
local auras, privateSpells, auraCalls = {}, {}, 0
C_UnitAuras = {
  GetUnitAuraBySpellID = function(unit, spellID) auraCalls = auraCalls + 1 local a = auras[unit] if a == "error" then error("blocked") end return a end,
  AuraIsPrivate = function(id) return privateSpells[id] == true end,
}

local CRT = { db = { alerts = { special = {}, debuffLists = {}, debuffTiers = {} } } }
function CRT:Print() end
CRT.PALETTE = { text = { 1, 1, 1 }, heading = { 1, 0.8, 0 } }
local previews, placements = {}, {}
CRT.UI = {
  Window = function(name, opts) local f = region("Frame") f.name = name f.opts = opts f:Hide() return f end,
  Tint = function(r, m, k) r.tint = r.tint or {} r.tint[m] = k end,
  RegisterThemed = function() end, OnTheme = function() end,
  ResetButton = function(p) return region("Button", p) end,
  PanelButton = function(p, label) local b = region("Button", p) b.text = label return b end,
  PanelButtonWidth = function(w) return w + 28 end,
  Placement = { Define = function(key, spec) local el = { key = key, spec = spec } function el:Attach(f, h) self.frame, self.handle = f, h end function el:Reset() self.reset = true end placements[key] = el return el end,
    FitHandle = function() end },
}
CRT_PREVIEWS(CRT, CRT.UI)
local realRegister = CRT.UI.RegisterPreview
CRT.UI.RegisterPreview = function(self, key, fn) previews[key] = fn return realRegister(self, key, fn) end
-- the boss registry: one boss, its file's special list
local ENC = 3492
local fileList
CRT.Bosses = { Get = function(_, id) if id == ENC then return { encounterID = ENC, name = "Boss", special = fileList } end end,
  Loaded = function() return true end, List = function() return { { encounterID = ENC } } end, DeclareField = function() end }
-- Alerts/Reminders.lua's time reader, for the timed alert beside the list
CRT.AlertReminders = { ParseTimes = function() return { { ph = 1, t = 30 } } end, AbsorbOf = function() return nil end }
for i = 1, #srcs, 2 do assert(load(srcs[i + 1], srcs[i]))("CowfeeRaidTools", CRT) end
local S, DL, V = CRT.AlertSpecial, CRT.AlertDebuffList, CRT.AlertDebuffListView
check(S and DL and V, "Special, DebuffList and DebuffListView loaded")

local FANGS = { kind = "debuffList", key = "fangs", label = "Grasping Fangs", spellID = 1301117,
  sides = { { key = "left", label = "Left", groups = { 1, 3 } }, { key = "right", label = "Right", groups = { 2, 4 } } },
  colors = { left = { on = { 0.9, 0.2, 0.7 }, off = { 0.35, 0.05, 0.1 } }, right = { on = { 0.2, 0.5, 1 }, off = { 0.05, 0.1, 0.3 } } } }
local function copy(t) if realType(t) ~= "table" then return t end local o = {} for k, v in pairs(t) do o[k] = copy(v) end return o end
local function with(over) local d = copy(FANGS) for k, v in pairs(over or {}) do d[k] = v end return d end

-- 1. The data parses -------------------------------------------------------------------------------------------
local e, why = S.Read(FANGS)
check(e and e.kind == "debuffList" and e.spellID == 1301117 and e.key == "fangs" and e.label == "Grasping Fangs", "a debuff list reads: " .. tostring(why))
check(e and #e.sides == 2 and e.sides[1].key == "left" and e.sides[1].groups[1] == 1 and e.sides[1].groups[2] == 3 and e.sides[2].label == "Right", "its sides and groups")
check(e and e.colors.left.on[1] == 0.9 and e.colors.right.off[3] == 0.3, "its colours by side")
check(e and e.showAll == false and e.sortByRole == true and e.barHeight == 24 and e.barWidth == 160, "the defaults: show those with it, by role, 24 by 160")
check(e and e.difficulty == nil and e.default == false, "every difficulty, off until ticked")
check(e and next(e.when) == nil and e.who.mode == "everyone" and #e.covers == 0 and not e.show.alert and not e.show.bar and e.speak == false, "an alert's fields are empty")
check(#S:Times(ENC, e) == 0 and #S:Items(ENC, e, { all = true }) == 0 and next(S:Covers(ENC, e)) == nil, "no times, no items, covers nothing")
local three = S.Read(with({ sides = { { key = "a", groups = { 1 } }, { key = "b", groups = { 2, 5 } }, { key = "c", groups = { 6, 7, 8 } } }, colors = nil }))
check(three and #three.sides == 3 and three.sides[1].label == "a" and three.colors.c.on[1] == 0.85 and three.colors.c.off[1] == 0.25, "three sides, a label from the key, grey without colours")
local one = S.Read(with({ sides = { { key = "all", label = "Raid", groups = { 8, 1, 2 } } }, colors = nil, showAll = true, sortByRole = false, barHeight = 30, barWidth = 200 }))
check(one and #one.sides == 1 and table.concat(one.sides[1].groups, ",") == "1,2,8" and one.showAll and not one.sortByRole and one.barHeight == 30 and one.barWidth == 200, "one side, groups in order, its own looks")
local noSpell = with()
noSpell.spellID = nil
local bad = {
  { noSpell, "spellID" }, { with({ spellID = 1.5 }), "spellID" }, { with({ sides = {} }), "sides" },
  { with({ sides = { { key = "x", groups = { 9 } } } }), "groups 1 to 8" }, { with({ sides = { { key = "x", groups = { 1, 1 } } } }), "groups 1 to 8" },
  { with({ sides = { { key = "x", groups = { 1 } }, { key = "x", groups = { 2 } } } }), "key of its own" },
  { with({ colors = { left = { on = { 2, 0, 0 } } } }), "colours" }, { with({ colors = { left = 5 } }), "colours" },
  { with({ when = { times = "0:30" } }), "no when" }, { with({ showAll = "yes" }), "showAll" }, { with({ barHeight = 300 }), "out of range" },
  { with({ kind = "other" }), "kind must be" },
}
for _, b in ipairs(bad) do
  local ok, w = S.Read(b[1])
  check(ok == nil and tostring(w):find(b[2], 1, true) ~= nil, "refused: " .. tostring(w))
end
fileList = { FANGS, { key = "waves", label = "Waves", when = { times = "0:30" } } }
local list = S:List(ENC)
check(#list == 2 and S.IsDebuffList(list[1]) and not S.IsDebuffList(list[2]), "the Special list holds it beside a timed alert")
check(#DL.Entries(ENC) == 1 and DL.Entries(ENC)[1].key == "fangs", "DL.Entries gives only the debuff lists")
C_Spell = { GetSpellTexture = function(id) return "tex" .. id end }
check(S.Icon(ENC, list[1]) == "tex1301117", "its icon is its spell's")
local entry = list[1]

-- 2. Sides split by group, any number of sides and players; sort by role ----------------------------------------
local look = DL:Look(ENC, entry)
local roster = DL.Roster()
check(#roster == 10 and roster[3].isMe and roster[1].unit == "raid1", "the raid's ten players, you among them")
local sides = DL.Sides(look, roster)
local function names(side) local o = {} for i, p in ipairs(side.players) do o[i] = p.name .. ":" .. p.group .. ":" .. p.role end return table.concat(o, " ") end
check(#sides[1].players == 4 and #sides[2].players == 4, "groups 1, 3 left and 2, 4 right: four each")
for _, p in ipairs(sides[1].players) do check(p.group == 1 or p.group == 3, "left: " .. p.name .. " in group " .. p.group) end
local inOrder = sides[1].players[1].role == "TANK"
for i = 2, #sides[1].players do
  local a, b = sides[1].players[i - 1], sides[1].players[i]
  local ra, rb = DL.ROLE_ORDER[a.role], DL.ROLE_ORDER[b.role]
  inOrder = inOrder and (ra < rb or (ra == rb and a.name < b.name))
end
check(inOrder and sides[1].players[3].role == "HEALER" and sides[1].players[4].role == "DAMAGER", "by role: tanks, healers, damage, then name: " .. names(sides[1]))
look.sortByRole = false
local byName = DL.Sides(look, roster)
local sorted = true
for i = 2, #byName[1].players do sorted = sorted and byName[1].players[i - 1].name < byName[1].players[i].name end
check(sorted, "Sort by role off: by name: " .. names(byName[1]))
look.sortByRole = true
-- 40 players, five sides
local big = {}
for i = 1, 40 do big[i] = { name = string.format("N%02d", 41 - i), group = math.floor((i - 1) / 5) + 1, role = i % 3 == 0 and "HEALER" or "DAMAGER" } end
setRaid(big)
local five = S.Read(with({ sides = { { key = "a", groups = { 1, 2 } }, { key = "b", groups = { 3 } }, { key = "c", groups = { 4, 5 } }, { key = "d", groups = { 6 } }, { key = "e", groups = { 7, 8 } } }, colors = nil }))
local fs = DL.Sides({ sides = five.sides, sortByRole = true }, DL.Roster())
check(#fs == 5 and #fs[1].players == 10 and #fs[2].players == 5 and #fs[5].players == 10, "five sides of 40 players: 10, 5, ..., 10")
check(fs[1].players[1].role == "HEALER" and fs[1].players[#fs[1].players].role == "DAMAGER", "healers before damage")
-- a hidden name or role leaves the player out; a party is group 1
big[2].secretRole = true
big[4].name = secret("Hidden")
check(#DL.Roster() == 38, "a hidden role or name leaves that player out: " .. #DL.Roster())
inRaid = false
local party = DL.Roster()
check(#party >= 1 and party[1].unit == "player" and party[1].group == 1 and party[1].isMe, "a party: you first, group 1")
inGroup = false
check(#DL.Roster() == 0, "solo: no one")
inRaid, inGroup = true, true
setRaid(defaultRaid())
roster = DL.Roster()

-- 3. The readable tier filters ------------------------------------------------------------------------------------
auras = { raid1 = { spellId = 1301117 }, raid6 = { spellId = 1301117 } }
local view = DL.Build(look, 1301117, roster)
local function rowNames(s) local o = {} for i, r in ipairs(s.rows) do o[i] = r.name .. "=" .. r.state end return table.concat(o, " ") end
check(view.tier == "readable" and view.any and not view.showAll, "readable: someone has it")
check(#view.sides[1].rows == 2 and view.sides[1].rows[1].state == "on" and view.sides[1].rows[2].state == "on" and #view.sides[2].rows == 0,
  "Show every player off: only those with it, raid1 (group 1) and raid6 (group 3) on the left: " .. rowNames(view.sides[1]))
look.showAll = true
view = DL.Build(look, 1301117, roster)
check(#view.sides[1].rows == 4 and #view.sides[2].rows == 4, "Show every player on: every player, on and off")
local onCount = 0
for _, r in ipairs(view.sides[1].rows) do if r.state == "on" then onCount = onCount + 1 end end
check(onCount == 2, "raid1 and raid6 on, the rest off: " .. rowNames(view.sides[1]))
-- nobody has it and nobody was ever seen with it: Show every player is refused, since the game may be hiding it
auras = {}
view = DL.Build(look, 1301117, roster)
check(not view.showAll and #view.sides[1].rows == 0 and #view.sides[2].rows == 0, "nobody seen yet: Show every player refused, the list empty (never every player as off)")
view = DL.Build(look, 1301117, roster, nil, false, true)
check(view.showAll and #view.sides[1].rows == 4, "once a pull saw someone with it (confirmed): every player")
look.showAll = false
-- an aura table the game hides still says has it (its truth is tested, never its fields)
auras = { raid3 = secret({ spellId = 1 }) }
view = DL.Build(look, 1301117, roster)
check(view.tier == "readable" and #view.sides[2].rows == 1 and view.sides[2].rows[1].unit == "raid3" and view.sides[2].rows[1].isMe, "a hidden aura table: has it, nothing read from it (you, on the right)")
check(#errors == 0, "no errors so far: " .. tostring(errors[1]))

-- 4. The secret tier never compares a secret and forces show-all --------------------------------------------------
auras = {}
for i = 1, 10 do auras["raid" .. i] = secret(i % 2 == 0) end
local ok, v = pcall(DL.Build, look, 1301117, roster)
check(ok, "a secret boolean is never tested or compared: " .. tostring(v))
view = ok and v or { sides = {} }
check(view.tier == "secret" and view.showAll == true, "the secret tier forces Show every player")
check(#view.sides[1].rows == 4 and #view.sides[2].rows == 4, "every player of each side shows")
check(view.sides[1].rows[1].state == "secret" and issecretvalue(view.sides[1].rows[1].raw), "each row keeps the game's secret as it came")
-- the bar takes it through SetVertexColorFromBoolean
local b = { fill = region("Texture") }
check(V.Paint(b, view.sides[1].rows[1], look.colors.left) and b.fill.fromBoolean and rawequal(b.fill.fromBoolean[1], view.sides[1].rows[1].raw) and b.fill.fromBoolean[2].r == 0.9 and b.fill.fromBoolean[3].r == 0.35,
  "the bar is coloured from the secret by SetVertexColorFromBoolean, on then off")
check(V.Paint(b, { state = "on" }, look.colors.left) and b.fill.vertex[1] == 0.9 and b.fill.fromBoolean == nil, "a readable bar: SetVertexColor in the side's on colour")
V.Paint(b, { state = "off" }, look.colors.right)
check(b.fill.vertex[3] == 0.3, "and off in its off colour")
-- the probe's and the pull's shared classify
check(DL.Classify({ a = { state = "off" }, b = { state = "secret" } }) == "secret", "one secret makes the tier secret")
check(DL.Classify({ a = { state = "error" }, b = { state = "error" } }) == "unreadable", "every lookup failing: unreadable")
check(DL.Classify({ a = { state = "error" }, b = { state = "off" } }) == "readable", "some readable: readable")

-- 5. The private tier shows nothing and sets the notice ----------------------------------------------------------
auras = { raid1 = { spellId = 1301117 } }
privateSpells[1301117] = true
check(DL.IsPrivate(1301117) == true, "AuraIsPrivate is asked")
view = DL.Build(look, 1301117, roster, nil, DL.IsPrivate(1301117))
check(view.tier == "private" and #view.sides[1].rows == 0 and #view.sides[2].rows == 0, "private: no rows, never a wrong list")
auras = { raid1 = "error", raid2 = "error", raid5 = "error", raid6 = "error", raid3 = "error", raid4 = "error", raid7 = "error", raid8 = "error" }
view = DL.Build(look, 1301117, roster, nil, false)
check(view.tier == "unreadable" and #view.sides[1].rows == 0, "every lookup failing: unreadable, no rows")
check(DL:Notice(ENC, 1301117) == nil, "no notice before a pull saw it")
check(DL:ShowAllRefused(ENC, 1301117) and not DL:Confirmed(ENC, 1301117), "nothing seen: Show every player refused")
local fired = 0
DL:OnChange(function() fired = fired + 1 end)
DL:SetSeen(ENC, 1301117, "private")
check(DL:Notice(ENC, 1301117) == "The game hides this debuff from addons, so the list can't fill in.", "private seen: the Looks tab's notice")
check(CRT.db.alerts.debuffTiers[ENC][1301117].tier == "private" and CRT.db.alerts.debuffTiers[ENC][1301117].at == 1792540800, "saved per boss and spell, with when")
local firstAt = CRT.db.alerts.debuffTiers[ENC][1301117]
DL:SetSeen(ENC, 1301117, "private")
check(fired == 1 and rawequal(CRT.db.alerts.debuffTiers[ENC][1301117], firstAt), "the same tier again: nothing written, nobody told")
DL:SetSeen(ENC, 1301117, "unreadable")
check(DL:Notice(ENC, 1301117) ~= nil and fired == 2, "unreadable: the same notice, written once")
DL:SetSeen(ENC, 1301117, "readable", false)
check(DL:Seen(ENC, 1301117) == "readable" and DL:ShowAllRefused(ENC, 1301117), "readable with nobody seen: still refused")
DL:SetSeen(ENC, 1301117, "readable", true)
check(DL:Confirmed(ENC, 1301117) and not DL:ShowAllRefused(ENC, 1301117) and CRT.db.alerts.debuffTiers[ENC][1301117].seen == true, "someone seen: Show every player allowed")
DL:SetSeen(ENC, 1301117, "readable", false)
check(DL:Confirmed(ENC, 1301117), "seen stays once a pull saw someone")
DL:SetSeen(ENC, 1301117, "secret")
check(DL:Notice(ENC, 1301117) == nil and DL:ForcedShowAll(ENC, 1301117) and not DL:ShowAllRefused(ENC, 1301117), "secret: no notice, Show every player forced")
DL:SetSeen(ENC, 1301117, "bogus")
check(DL:Seen(ENC, 1301117) == "secret", "an unknown tier is not saved")
check(DL:Seen(9999, 1301117) == nil, "kept per boss")
CRT.db.alerts.debuffTiers = {}
privateSpells = {}

-- Your looks: saved only while they differ from the file's
local groups, gwhy = DL.ParseGroups("1, 5,7")
check(groups and table.concat(groups, ",") == "1,5,7", "groups typed: 1, 5, 7")
check(DL.ParseGroups("9") == nil and DL.ParseGroups("1, x") == nil and DL.ParseGroups("") == nil and DL.ParseGroups("2 2") == nil, "1 to 8, each once, at least one")
DL:SetLook(ENC, entry, "groups", { 1, 5 }, "left")
check(table.concat(DL:Look(ENC, entry).sides[1].groups, ",") == "1,5" and DL:Look(ENC, entry).sides[1].own, "your groups for a side")
DL:SetLook(ENC, entry, "groups", { 1, 3 }, "left")
check(CRT.db.alerts.debuffLists[ENC].fangs.groups == nil, "the file's groups again: nothing saved")
DL:SetLook(ENC, entry, "color", { 0, 1, 0 }, "right", "on")
check(DL:Look(ENC, entry).colors.right.on[2] == 1 and DL:Look(ENC, entry).colors.right.off[3] == 0.3, "your colour for one part, the rest the file's")
DL:SetLook(ENC, entry, "color", nil, "right", "on")
check(CRT.db.alerts.debuffLists[ENC].fangs.colors == nil, "Default: back to the file's")
DL:SetLook(ENC, entry, "showAll", true)
DL:SetLook(ENC, entry, "barHeight", 99)
check(DL:Look(ENC, entry).showAll == true and DL:Look(ENC, entry).barHeight == 48, "Show every player saved; a size kept in range")
DL:SetLook(ENC, entry, "showAll", false)
DL:SetLook(ENC, entry, "barHeight", 24)
local saved = CRT.db.alerts.debuffLists[ENC].fangs
check(saved.showAll == nil and saved.barHeight == nil, "the file's values again: nothing kept")
DL:SetLook(ENC, entry, "sortByRole", false)
check(saved.sortByRole == false and DL:Look(ENC, entry).sortByRole == false, "Sort by role off is kept (a false choice is saved)")
DL:SetLook(ENC, entry, "sortByRole", true)
check(saved.sortByRole == nil, "on again: the file's")
check(DL.Heading({ label = "Left", groups = { 1, 3 } }) == "Left: groups 1, 3" and DL.Heading({ label = "Raid", groups = { 2 } }) == "Raid: group 2", "headings")

-- 6. The preview key is registered; the display ------------------------------------------------------------------
for _, f in ipairs(eventFrames) do if f.scripts.OnEvent then f.scripts.OnEvent(f, "PLAYER_LOGIN") end end
local KEY = "debufflist-3492-fangs"
check(V.Key(ENC, "fangs") == KEY and previews[KEY] ~= nil and placements[KEY] ~= nil, "the preview and placement key debufflist-<boss>-<key>")
check(#V.PreviewKeys() == 1 and V.PreviewKeys()[1] == KEY, "PreviewKeys lists it for Preview alerts")
V:Register()
check(#V.PreviewKeys() == 1, "registering again adds nothing")
CRT.UI:SetPreview(KEY, true)
local d = V.displays[KEY]
check(d.frame and d.frame.shown and d.handle.shown, "Preview: the display and its drag box")
check(d.frame.opts.layer == "alertbars", "on the alert bars' layer")
check(d.heads[1].text == "Left: groups 1, 3" and d.heads[2].text == "Right: groups 2, 4", "a heading per side")
check(d.bars[1][1].name.text == "Player 1" and d.bars[2][1].name.text == "Player 4" and d.bars[1][1].shown and d.bars[2][3].shown, "sample names on both sides")
check(d.bars[1][1].fill.vertex[1] == 0.9 and d.bars[1][2].fill.vertex[1] == 0.35, "some on, some off")
check(d.bars[1][1].edge.shown and not d.bars[1][2].edge.shown and d.bars[1][1].edge.tint.SetBackdropBorderColor == "heading", "your bar has the heading (gold) edge")
check(d.bars[1][1].w == 160 and d.bars[1][1].h == 24 and d.bars[2][1].pts[1][2] == 172, "bars at the look's size, the second side right of the first")
CRT.UI:SetPreview(KEY, false)
check(not d.frame.shown and not d.handle.shown, "Stop preview hides it")
-- Test: the samples without the drag box, then gone
check(V:Test(ENC, entry) == true and d.frame.shown and not d.handle.shown, "Test shows the samples, no drag box")
local t = timers[#timers]
check(t and t.s == 10, "for 10 seconds")
t.fn()
check(not d.frame.shown, "then hides")

-- The pull: on, engaged, in a group; one redraw per frame
local updater
for _, f in ipairs(eventFrames) do if f.events.ENCOUNTER_START then updater = f end end
local function fire(e, ...) updater.scripts.OnEvent(updater, e, ...) end
local function frame() local fn = updater.scripts.OnUpdate if fn then fn(updater, 0.016) end end
auras = { raid1 = { spellId = 1301117 } }
fire("ENCOUNTER_START", ENC, "Boss", 16, 20)
frame()
check(not d.frame.shown, "off (Alert me unticked): nothing in a pull")
check(not updater.events.UNIT_AURA and not updater.events.GROUP_ROSTER_UPDATE, "off: UNIT_AURA and the roster are not registered")
S:SetChoice(ENC, entry, "on", true)
frame()
check(d.frame.shown and d.bars[1][1].name.text == roster[1].name and not d.bars[1][2].shown, "on: the player with it, alone")
check(updater.events.UNIT_AURA and updater.events.GROUP_ROSTER_UPDATE, "ticked mid-pull: it listens to UNIT_AURA and the roster")
S:SetChoice(ENC, entry, "on", false)
frame()
check(not updater.events.UNIT_AURA and not updater.events.GROUP_ROSTER_UPDATE and not d.frame.shown, "unticked mid-pull: it stops listening, nothing shows")
S:SetChoice(ENC, entry, "on", true)
frame()
check(updater.events.UNIT_AURA and d.frame.shown, "ticked again: back")
check(DL:Confirmed(ENC, 1301117), "the pull saw raid1 with it: confirmed for Show every player")
local calls = auraCalls
auras.raid4 = { spellId = 1301117 }
for _ = 1, 20 do fire("UNIT_AURA", "raid4", {}) end
fire("UNIT_AURA", "nameplate3", {})
frame()
check(auraCalls - calls == 1, "twenty UNIT_AURA for raid4: one lookup, on the next frame: " .. (auraCalls - calls))
check(d.bars[2][1].shown and d.bars[2][1].name.text == roster[4].name, "raid4 shows on the right")
frame()
check(auraCalls - calls == 1, "no event, no work")
calls = auraCalls
fire("UNIT_AURA", secret("raid2"), secret({}))
frame()
check(auraCalls - calls == 8, "a hidden unit: every player read again: " .. (auraCalls - calls))
auras = {}
fire("UNIT_AURA", "raid1", {}) fire("UNIT_AURA", "raid4", {})
frame()
check(not d.frame.shown, "nobody has it: nothing shows")
-- secret values in a pull: every player shows, nothing compared, the tier saved
for i = 1, 10 do auras["raid" .. i] = secret(i == 1) end
fire("UNIT_AURA", secret("x"))
frame()
check(d.frame.shown and d.bars[1][4].shown and d.bars[1][1].fill.fromBoolean ~= nil, "secret: every player, coloured from the secret")
check(DL:Seen(ENC, 1301117) == "secret", "the pull saved the secret tier")
check(CRT.db.alerts.debuffPull.encounterID == ENC and CRT.db.alerts.debuffPull.difficultyID == 16, "the pull is kept for a /reload")
fire("ENCOUNTER_END", ENC, "Boss", 16, 20, 0)
frame()
check(not d.frame.shown and not updater.events.UNIT_AURA, "after the pull: hidden, UNIT_AURA no more")
check(CRT.db.alerts.debuffPull.encounterID == nil, "and the kept pull cleared")
-- a /reload mid-pull: PLAYER_LOGIN picks the pull up again while the encounter runs
auras = { raid1 = { spellId = 1301117 } }
CRT.db.alerts.debuffTiers = {}
CRT.db.alerts.debuffPull = { encounterID = ENC, difficultyID = 16 }
C_InstanceEncounter = { IsEncounterInProgress = function() return true end }
fire("PLAYER_LOGIN")
frame()
check(updater.events.UNIT_AURA and d.frame.shown, "a /reload mid-pull: the list runs again")
fire("ENCOUNTER_END", ENC, "Boss", 16, 20, 0)
frame()
CRT.db.alerts.debuffPull = { encounterID = ENC, difficultyID = 16 }
C_InstanceEncounter = { IsEncounterInProgress = function() return false end }
fire("PLAYER_LOGIN")
frame()
check(not updater.events.UNIT_AURA and CRT.db.alerts.debuffPull.encounterID == nil, "after the encounter ended: nothing runs, the kept pull cleared")
C_InstanceEncounter = nil
-- private: nothing, and the notice
privateSpells[1301117] = true
auras = { raid1 = { spellId = 1301117 } }
fire("ENCOUNTER_START", ENC, "Boss", 16, 20)
frame()
check(not d.frame.shown and DL:Notice(ENC, 1301117) ~= nil, "private in a pull: nothing shows, the notice is set")
fire("ENCOUNTER_END", ENC, "Boss", 16, 20, 0)
privateSpells = {}
-- another boss's pull: nothing listens
fire("ENCOUNTER_START", 9999, "Other", 16, 20)
check(not updater.events.UNIT_AURA, "a boss with no debuff list: nothing listens")
fire("ENCOUNTER_END", 9999, "Other", 16, 20, 0)
-- a Mythic-only list on Heroic
fileList = { with({ difficulty = "mythic" }) }
auras = { raid1 = { spellId = 1301117 } }
fire("ENCOUNTER_START", ENC, "Boss", 15, 20)
frame()
check(not d.frame.shown and not updater.events.UNIT_AURA, "a Mythic list on Heroic: nothing, nothing registered")
fire("ENCOUNTER_END", ENC, "Boss", 15, 20, 0)
check(#errors == 0, "no errors: " .. tostring(errors[1]))

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error("debuff list: " .. fails .. " failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Modules/Alerts/Rules.lua', 'CRT_Modules/Alerts/Engine.lua', 'CRT_Modules/Alerts/Special.lua',
  'CRT_Modules/Alerts/DebuffList.lua', 'CRT_Modules/Alerts/DebuffListView.lua'];
for (const f of files) { lua.lua_pushstring(L, to_luastring(f)); lua.lua_pushstring(L, to_luastring(read(f))); }
if (lua.lua_pcall(L, 2 * files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
