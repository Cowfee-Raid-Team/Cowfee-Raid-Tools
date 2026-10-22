// CRT_Modules/LootMaster/BossLootWindow.lua: the raid leader's Boss loot window, built on stand-in frames. It opens on the
// first row of a list and not before; the badge is "<boss> · <difficulty>"; each row's checkbox, icon, link, detail and
// state (rolling in honey, won in the theme's good, someone else's muted, can't roll in its bad) in the Modern and Classic looks; the
// footer's counts, Clear and Start session (only enabled when the ticked rows are won and no session runs).
// Usage: node run_lootmaster_bosswin.js <addon folder>
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local dataSrc, commSrc, gateSrc, lootingSrc, bossSrc, winSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
local NOW, CLOCK = 100, 1790000000
GetTime = function() return NOW end
time = function() return CLOCK end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
Ambiguate = function(n) return (n:gsub("%-.*$", "")) end
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end
UnitName = function(u) if u == "player" then return "Solex" end end
GetNormalizedRealmName = function() return "Sargeras" end
LE_PARTY_CATEGORY_INSTANCE = 2
IsInGroup = function(cat) return cat ~= 2 end
IsInRaid = function() return true end
GetNumGroupMembers = function() return 1 end
GetNumSubgroupMembers = function() return 0 end
GetRaidRosterInfo = function() return "Solex-Sargeras" end
UnitIsGroupLeader = function() return true end
UnitIsConnected = function() return true end
UnitClass = function() return "Paladin", "PALADIN" end
IsInGuild = function() return false end
IsInInstance = function() return true, "raid" end
GetInstanceInfo = function() return "A Raid", "raid", 16, "Mythic", 20, 0, false, 2810, 20, nil end
INVTYPE_HEAD = "Head"
C_Item = {
  GetItemInfo = function() return nil end,
  GetDetailedItemLevelInfo = function() return 250 end,
  GetItemInfoInstant = function(link) return 1, "Armor", "Plate", "INVTYPE_HEAD", 133000, 4, 4 end,
}
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, InChatMessagingLockdown = function() return false end,
  SendAddonMessage = function() return 0 end }
local timers = {}
C_Timer = { After = function(s, fn) timers[#timers + 1] = fn end,
  NewTicker = function() return { Cancel = function() end } end }
-- stand-in frames: any method works; the ones read back here keep their values
local function mock()
  local o = { shown = false, enabled = true, checked = false, scripts = {} }
  return setmetatable(o, { __index = function(t, k)
    local m = ({
      SetText = function(self, v) self.text = v end,
      GetText = function(self) return self.text end,
      Show = function(self) self.shown = true end,
      Hide = function(self) self.shown = false end,
      IsShown = function(self) return self.shown end,
      SetEnabled = function(self, v) self.enabled = v and true or false end,
      IsEnabled = function(self) return self.enabled end,
      SetChecked = function(self, v) self.checked = v and true or false end,
      GetChecked = function(self) return self.checked end,
      SetScript = function(self, name, fn) self.scripts[name] = fn end,
      SetTexture = function(self, v) self.texture = v end,
      SetDesaturated = function(self, v) self.desaturated = v end,
      CreateTexture = function() return mock() end,
      CreateFontString = function() return mock() end,
      GetStringWidth = function(self) return #(self.text or "") * 6 end,
    })[k]
    if m then return m end
    if type(k) == "string" and k:match("^%u") then return function() end end -- any other method
    return nil
  end })
end
CreateFrame = function() local f = mock() f.events = {} f.RegisterEvent = function(me, e) me.events[e] = true end return f end
local view = {}
CreateScrollBoxListLinearView = function()
  local v = mock()
  v.SetElementInitializer = function(self, kind, fn) view.init = fn end
  return v
end
ScrollUtil = { InitScrollBoxListWithScrollBar = function(box) view.box = box end }
local rowFrames = {}
CreateDataProvider = function(rows) return rows end
local function bindBox()
  view.box.SetDataProvider = function(self, rows)
    view.rows = rows
    for i, r in ipairs(rows) do
      rowFrames[i] = rowFrames[i] or mock()
      view.init(rowFrames[i], r)
    end
  end
end
local MODERN = true
local made, buttons = {}, {}
CRT_UI = {
  TITLE_STRIP = { neutral = { bg = "background" } },
  SkinScrollBar = function() end,
  IsModern = function() return MODERN end,
  Window = function(name, opts)
    local w = mock()
    w.name, w.opts, w.content = name, opts, mock()
    w.strip = mock()
    w.strip.SetBadge = function(self, text, note, colors) self.badge, self.badgeColors = text, colors end
    made[#made + 1] = w
    return w
  end,
  PanelButton = function(parent, label, h, onClick) local b = mock() b.label, b.onClick = label, onClick buttons[label] = b return b end,
  SkinCheckButton = function(self, cb) cb.skinned = true end,
  Help = function() return mock() end,
}
local CRT = { UI = CRT_UI, db = { lootmaster = { authority = { leader = true, names = {} }, bossLoot = {} } } }
CRT_THEME(CRT, CRT_UI) -- the colour helpers read the theme's palette
CRT_UI.Tint = function(region, method, key) region.tint = { method = method, key = key } end
CRT_UI.SwitchTheme("cowfee")
CRTDBChar = {}
local printed = {}
function CRT:Print(m) printed[#printed + 1] = m end
CRT.Groups = { Normalize = function(n) return n end }
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
local LM = CRT.LootMaster
assert(load(commSrc, "Comm.lua"))("CowfeeRaidTools", CRT)
assert(load(gateSrc, "AutoPass.lua"))("CowfeeRaidTools", CRT)
assert(load(lootingSrc, "Looting.lua"))("CowfeeRaidTools", CRT)
assert(load(bossSrc, "BossLoot.lua"))("CowfeeRaidTools", CRT)
assert(load(winSrc, "BossLootWindow.lua"))("CowfeeRaidTools", CRT)
function LM:FilterLoot(s, source, link) if link:find("Junk", 1, true) then return false, "quality" end return true end
local BL = LM.BossLoot
local function link(id, name) return "|cffa335ee|Hitem:" .. id .. "::::::::80:::::|h[" .. name .. "]|h|r" end
local kill = { name = "Big Boss", at = CLOCK, instance = "2810-16" }

-- 1. Not built before the first row; opens on it, with the boss and difficulty
eq(#made, 0, "no window before boss loot")
BL:Add(1, link(101, "Helm"), { status = "rolling", rollType = 1 }, kill)
eq(#made, 1, "the window is made on the first row")
local win = made[1]
eq(win.name, "CowfeeRaidToolsBossLoot", "the window's name")
eq(win.opts.kind, "popout", "a pop-out")
eq(win.opts.title, "Boss loot", "titled Boss loot")
eq(win.opts.saved(), CRT.db.lootmaster.bossLoot, "its place is kept in lootmaster.bossLoot")
eq(win.shown, true, "shown")
eq(win.strip.badge, "Big Boss · Mythic", "the badge: boss and difficulty")
eq(win.strip.badgeColors, CRT_UI.TITLE_STRIP.neutral, "a neutral badge")
bindBox()
BL:Add(2, link(102, "Junk Cloak"), { status = "rolling", rollType = 2 }, kill)
BL:Add(3, link(103, "Ring"), { status = "cant", reason = "the game doesn't allow it" }, kill)
local r1, r2, r3 = rowFrames[1], rowFrames[2], rowFrames[3]
eq(r1.check.checked, true, "row 1: ticked by the filter")
eq(r1.check.enabled, true, "row 1: can be ticked")
eq(r1.check.skinned, true, "row 1: the shared checkbox skin")
eq(r1.name.text, link(101, "Helm"), "row 1: the link")
eq(r1.detail.text, "Head · Item level 250", "row 1: slot and item level")
eq(r1.status.text, "|cffe2a14bRolling… you rolled Need|r", "row 1: rolling, in honey (Modern)")
eq(r1.icon.texture, 133000, "row 1: the icon")
eq(r2.check.checked, false, "row 2: not ticked, the filter left it out")
eq(r2.detail.text, "Not in your loot filter: below the lowest quality", "row 2: why")
eq(r3.check.enabled, false, "row 3: can't roll: can't be ticked")
eq(r3.status.text, "|cffc8553dCan't roll: the game doesn't allow it. Tell the raid.|r", "row 3: the theme's bad, short enough for the row")
eq(r1.detail.tint and r1.detail.tint.key, "muted", "detail: the theme's muted colour")
eq(r1.detail.tint and r1.detail.tint.method, "SetTextColor", "detail: as text colour")
eq(r3.icon.desaturated, true, "row 3: a grey icon")
local footer = buttons["Start session"]
eq(footer.enabled, false, "Start: waits while a ticked row rolls")
-- 2. Won, lost; clicking a box; Start
BL:Result(link(101, "Helm"), "Solex", true, false)
eq(r1.status.text, "|cff8fa876Won · you rolled Need|r", "row 1: won, in good")
eq(r1.detail.text, "Head · Item level 250 · 2h 00m left to trade", "row 1: won, with its time left to trade")
eq(footer.enabled, true, "Start: ready once the ticked rows are won")
BL:Result(link(102, "Junk Cloak"), "Quick-Sargeras", false, false)
eq(r2.status.text, "|cffccb599Won by Quick|r", "row 2: won by someone else, muted")
eq(r2.check.enabled, false, "row 2: can't be ticked")
r1.check.checked = false
r1.check.scripts.OnClick(r1.check)
eq(BL:Row(1).ticked, false, "clicking the box unticks the row")
eq(footer.enabled, false, "Start: nothing ticked and won")
r1.check.checked = true
r1.check.scripts.OnClick(r1.check)
-- Classic colors: a switch to Default: Blizzard redraws the rows in the game's gold, green and red
MODERN = false
CRT_UI.SwitchTheme("blizzard")
BL:Add(4, link(104, "Belt"), { status = "rolling", rollType = 4 }, kill)
eq(rowFrames[4].status.text, "|cff" .. CRT_UI.Hex("heading") .. "Rolling… you rolled Transmog|r", "Classic: rolling in the game's gold")
eq(rowFrames[1].status.text, "|cff" .. CRT_UI.Hex("good") .. "Won · you rolled Need|r", "Classic: won in the game's green")
eq(rowFrames[3].status.text, "|cff" .. CRT_UI.Hex("bad") .. "Can't roll: the game doesn't allow it. Tell the raid.|r", "Classic: can't roll in the game's red")
eq(CRT_UI.Hex("bad") .. CRT_UI.Hex("good"), "ff202019ff19", "Classic: the game's red and green")
CRT_UI.SwitchTheme("nitro")
BL:SetTicked(4, false)
eq(rowFrames[1].status.text, "|cff8fcfa0Won · you rolled Need|r", "Nitro: won in its good")
MODERN = true
footer.onClick()
check(LM.current ~= nil, "Start session starts the session")
eq(LM.current and #LM.current.items, 1, "with the ticked item you won")
eq(footer.enabled, false, "Start: waits while the session runs")
check(buttons.Clear.enabled, "Clear: there are rows")
buttons.Clear.onClick()
eq(#BL:Rows(), 0, "Clear empties the list")
eq(buttons.Clear.enabled, false, "Clear: nothing to clear")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Modules/LootMaster/Data.lua', 'CRT_Modules/LootMaster/Comm.lua', 'CRT_Modules/LootMaster/AutoPass.lua',
  'CRT_Modules/LootMaster/Looting.lua', 'CRT_Modules/LootMaster/BossLoot.lua', 'CRT_Modules/LootMaster/BossLootWindow.lua'];
for (const f of files) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
