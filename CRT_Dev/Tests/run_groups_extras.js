// CRT_Modules/Groups/Data.lua and CRT_Modules/Groups/Page.lua on mock frames: the "In group, not in layout" list.
// usage: node run_groups_extras.js <addon folder>
const fs = require('fs');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local dataSrc, pageSrc, applySrc, inviteSrc = ...
local buttons, strings = {}, {}
local groupHelps = {} -- every (?) the page makes
local function mock(kind)
  local m = { shown = true, kind = kind }
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" then return function() local s = mock("r") strings[#strings + 1] = s return s end end
    if k == "CreateTexture" then return function() return mock("r") end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return rawget(self, "text") or "" end end
    if k == "Show" then return function(self) rawset(self, "shown", true) end end
    if k == "Hide" then return function(self) rawset(self, "shown", false) end end
    if k == "SetShown" then return function(self, on) rawset(self, "shown", on and true or false) end end
    if k == "IsShown" then return function(self) return rawget(self, "shown") end end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "IsMouseOver" then return function(self) return rawget(self, "over") or false end end
    if k == "HasFocus" then return function() return false end end
    if k == "SetBackdropBorderColor" then return function(self, r, g, b) rawset(self, "border", { r, g, b }) end end
    if k == "SetFrameStrata" then return function(self, s) rawset(self, "strata", s) end end
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabled", on) end end
    if k == "SetMaxLines" then return function(self, n) rawset(self, "maxLines", n) end end
    return function() end end })
end
local frames = {}
function CreateFrame(kind, name) local m = mock(kind) frames[#frames + 1] = m if kind == "Button" then buttons[#buttons + 1] = m end return m end
UIParent = mock()
format = string.format
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
C_Timer = { After = function() end }
GetNormalizedRealmName = function() return "Area52" end
Ambiguate = function(k) return (k:gsub("%-Area52$", "")) end
RAID_CLASS_COLORS = setmetatable({}, { __index = function() return { r = 1, g = 1, b = 1 } end })
UnitGroupRolesAssigned = function() return "DAMAGER" end
UnitIsUnit = function() return false end
IsInRaid = function() return true end
local raid = { { "Solex", 1, "MAGE" }, { "Abu-KelThuzad", 1, "SHAMAN" }, { "Balevolence", 2, "MONK" }, { "Newguy", 3, "PALADIN" } }
GetNumGroupMembers = function() return #raid end
GetRaidRosterInfo = function(i) local r = raid[i] return r[1], nil, r[2], nil, nil, r[3] end
GetCursorPosition = function() return 0, 0 end
local lead, combat, invites = true, false, {}
IsInGroup = function() return true end
UnitIsGroupLeader = function() return lead end
UnitIsGroupAssistant = function() return false end
InCombatLockdown = function() return combat end
UnitAffectingCombat = function() return false end
time = function() return 1000 end
C_PartyInfo = { InviteUnit = function(n) invites[#invites + 1] = n end, ConvertToRaid = function() end }
local tip = {}
GameTooltip = { SetOwner = function() tip = {} end, SetText = function(_, s) tip[#tip + 1] = s end, AddLine = function(_, s) tip[#tip + 1] = s end, Show = function() end, Hide = function() end }
local menus = {}
local gridRef
local CRT = { db = { groups = { presets = {}, nextId = 1, keepChanges = false, source = "raid", working = {} }, classCache = {}, roleCache = {}, ui = {} } }
function CRT:Print(m) print("  [chat] " .. m) end
local pages = {}
CRT.UI = { SkinScrollBar = function() end, SlotGrid = function() local g = { slots = {}, labels = {}, blockH = 143, slotW = 188 } for i = 1, 40 do local b = mock() rawset(b, "index", i) rawset(b, "icon", mock()) rawset(b, "text", mock()) rawset(b, "right", mock()) g.slots[i] = b end gridRef = g return g end, FitText = function() end, GoodText = function(t) return t end, ClipText = function() return mock() end, PAGE_W = 1026, PAGE_H = 560, Help = function(_, title) local m = mock("help") rawset(m, "helpTitle", title) groupHelps[#groupHelps + 1] = m return m end, RegisterPage = function(_, k, t, fn) pages[k] = fn end,
  PanelButtonWidth = function(w) return w + 28 end, ContextMenu = function(owner, fill) menus[#menus + 1] = { owner = owner, fill = fill } end }
CRT_THEME(CRT, CRT.UI)
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
assert(load(applySrc, "Apply.lua"))("CowfeeRaidTools", CRT)
assert(load(inviteSrc, "Invite.lua"))("CowfeeRaidTools", CRT)
local G = CRT.Groups
local w = G:Working()
w[1] = "Solex-Area52" w[2] = "Abu-KelThuzad" w[6] = "Gadios-Area52"
assert(load(pageSrc, "Page.lua"))("CowfeeRaidTools", CRT)
local pf = mock()
pages.groups(pf)
pf.OnShow(pf)
-- every (?) is UI.HelpRight's, right of the thing it explains
do
  local byTitle = {}
  for _, h in ipairs(groupHelps) do
    assert(rawget(h, "helpTarget") ~= nil, "the (?) " .. tostring(h.helpTitle) .. " is placed by UI.HelpRight")
    byTitle[h.helpTitle] = rawget(h, "helpTarget")
  end
  assert(byTitle["Use This Group"] and byTitle["Use This Group"].text == "Use This Group", "Use This Group's (?) is right of its button")
  assert(byTitle["Editing the groups"] and byTitle["Editing the groups"].text == "Clear grid", "the editing (?) is right of Clear grid, the last grid button")
  print("ok every (?) on Raid Groups is right of what it explains")
end
local function extras()
  local out = {}
  for _, b in ipairs(buttons) do if rawget(b, "entry") and b.shown then out[#out + 1] = b.text.text .. " " .. b.group.text end end
  return out
end
print("not in layout: " .. table.concat(extras(), ", "))
-- Click Balevolence (raid group 2): goes to the first empty slot of group 2 (slot 7, since 6 is Gadios).
for _, b in ipairs(buttons) do if rawget(b, "entry") and b.entry.key:find("Balevolence") then b:OnClick() break end end
print("after click: slot 7 = " .. w[7] .. "; list: " .. table.concat(extras(), ", "))
-- Drag Newguy onto slot 1 (Solex): replaces Solex, who then shows in the list.
local row
for _, b in ipairs(buttons) do if rawget(b, "entry") and b.shown and b.entry.key:find("Newguy") then row = b end end
row:OnDragStart()
-- The drag ghost's edge is the theme's heading colour and follows a live switch.
local ghost
for _, f in ipairs(frames) do if rawget(f, "strata") == "TOOLTIP" then ghost = f end end
local function near(c, r, g, b) return c and math.abs(c[1] - r) < 0.003 and math.abs(c[2] - g) < 0.003 and math.abs(c[3] - b) < 0.003 end
local themeFails = 0
local function check(ok, what) if ok then print("ok " .. what) else themeFails = themeFails + 1 print("FAIL " .. what) end end
check(ghost and near(rawget(ghost, "border"), 1, 0.82, 0), "Default: Blizzard: the drag ghost's edge is the game's gold")
CRT.UI.SwitchTheme("cowfee")
check(ghost and near(rawget(ghost, "border"), 0xD9 / 255, 0xB4 / 255, 0x8A / 255), "Beanworks: Cowfee: the drag ghost's edge follows the switch")
CRT.UI.SwitchTheme("blizzard")
if themeFails > 0 then error(themeFails .. " groups theme checks failed") end
`;
const tail = `
for _, b in ipairs(buttons) do if rawget(b, "index") == 1 then rawset(b, "over", true) end end
row:OnDragStop()
print("after drag onto slot 1: slot 1 = " .. w[1] .. "; list: " .. table.concat(extras(), ", "))

-- Invites: the Invite missing button, its count, greyed states, the status line and the slot menu.
local fails = 0
local function check(ok, what) if ok then print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end
local function plain(s) return (tostring(s or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")) end
local inviteButton
for _, b in ipairs(buttons) do if type(rawget(b, "text")) == "string" and b.text:find("^Invite missing") then inviteButton = b end end
-- The grid now: Solex, Abu (in the raid), Gadios (not), Balevolence (in the raid).
check(inviteButton and inviteButton.text == "Invite missing (1)", "the button counts the one missing: " .. tostring(inviteButton and inviteButton.text))
check(inviteButton and inviteButton.enabled == true, "and is enabled for the leader")
w[16] = "Mesmertism-Stormrage" G:Touch()
check(inviteButton.text == "Invite missing (2)", "the count follows the grid: " .. inviteButton.text)
lead = false G:Fire()
check(inviteButton.enabled == false, "not lead or assist: greyed")
inviteButton.OnEnter(inviteButton)
check(tip[2] == "Only the raid leader or an assist can invite.", "the tooltip says why: " .. tostring(tip[2]))
inviteButton.OnClick(inviteButton)
check(#invites == 0, "no invites when greyed")
lead, combat = true, true CRT.Invite:Fire()
check(inviteButton.enabled == false, "in combat: greyed")
lead, combat = true, false CRT.Invite:Fire()
check(inviteButton.enabled == true, "out of combat again: enabled")
CRT.db.groups.selected = G:CreatePreset("Main Raid", w)
inviteButton.OnClick(inviteButton)
check(#invites == 2 and invites[1] == "Gadios-Area52" and invites[2] == "Mesmertism-Stormrage", "Invite missing invites the two by Name-Realm: " .. table.concat(invites, ","))
-- The status line shows the summary.
local summary = plain(CRT.Invite:Summary())
check(summary:find('Invited 2 from "Main Raid". Each one moves to their group when they join.', 1, true) == 1, "status: " .. summary)
local statusShown = false
for _, s in ipairs(strings) do if rawget(s, "text") == CRT.Invite:Summary() then statusShown = s end end
check(statusShown, "the page's status line shows it")
check(statusShown and rawget(statusShown, "maxLines") == 3, "the status line is capped at 3 lines, so it can't grow into the grid")
-- Right-click a filled slot: a menu with Invite Name-Realm and Clear slot.
local function openMenu(index)
  menus = {}
  gridRef.slots[index].OnClick(gridRef.slots[index], "RightButton")
  local m = menus[1]
  if not m then return nil end
  local items = {}
  local root = { CreateTitle = function(_, t) items[#items + 1] = { label = "title:" .. t } end,
    CreateDivider = function() items[#items + 1] = { label = "divider" } end,
    CreateButton = function(_, label, fn) local it = { label = label, fn = fn, enabled = true, items = {} } function it:SetEnabled(on) self.enabled = on end
      -- a submenu's radios: the label, whether it is picked, and picking it
      function it:CreateRadio(l, isSel, set, data) local r = { label = l, isSel = isSel, set = set, data = data } self.items[#self.items + 1] = r return r end
      items[#items + 1] = it return it end }
  m.fill(root)
  return items
end
local items = openMenu(6)
check(items and items[2] and items[2].label == "Invite Gadios-Area52", "slot 6's menu: Invite Gadios-Area52: " .. tostring(items and items[2] and items[2].label))
check(items and items[3] and items[3].label == "Clear slot", "and Clear slot")
check(items and items[2].enabled == true, "invite is enabled for someone not in the group")
invites = {}
items[2].fn()
check(#invites == 1 and invites[1] == "Gadios-Area52", "the menu invites that player")
items = openMenu(1)
check(items and items[2].label == "Invite Solex-Area52" and items[2].enabled == false, "a player in the group: invite greyed (" .. tostring(items and items[2].label) .. ")")
items[3].fn()
check(w[1] == "", "Clear slot clears it")
check(openMenu(1) == nil, "an empty slot opens no menu")

-- Set role: a submenu on a filled slot (Tank, Healer, Damage, Use the game's role), saved per player.
do
  local slot = gridRef.slots[2] -- Abu-KelThuzad, in the raid as damage
  local icon = slot.icon
  rawset(icon, "SetTexCoord", function(self, a, b, c, d) rawset(self, "coords", { a, b, c, d }) end)
  G:Fire()
  check(rawget(icon, "coords") and icon.coords[1] == 20 / 64 and icon.coords[3] == 22 / 64, "the game's role to begin with: damage")
  check(slot.roleHand and not slot.roleHand.shown, "no set-by-hand marker yet")
  items = openMenu(2)
  local sub
  for _, it in ipairs(items or {}) do if it.label == "Set role" then sub = it end end
  check(sub ~= nil, "the slot menu has Set role")
  local labels = {}
  for _, r in ipairs(sub and sub.items or {}) do labels[#labels + 1] = r.label end
  check(table.concat(labels, "|") == "Tank|Healer|Damage|Use the game's role", "its choices: " .. table.concat(labels, "|"))
  check(sub.items[4].isSel(sub.items[4].data) == true and sub.items[2].isSel(sub.items[2].data) == false, "the game's role is picked while none is set")
  sub.items[2].set(sub.items[2].data)
  check(CRT.db.groups.roles["abu-kelthuzad"] == "HEALER" and G.HandRole("Abu-KelThuzad") == "HEALER", "Healer is saved for the player: " .. tostring(CRT.db.groups.roles["abu-kelthuzad"]))
  check(icon.coords[1] == 20 / 64 and icon.coords[3] == 1 / 64, "the slot's icon shows the role set by hand")
  check(slot.roleHand.shown == true, "with the set-by-hand marker")
  items = openMenu(2)
  for _, it in ipairs(items) do if it.label == "Set role" then sub = it end end
  check(sub.items[2].isSel(sub.items[2].data) == true and sub.items[4].isSel(sub.items[4].data) == false, "Healer is picked now")
  sub.items[4].set(sub.items[4].data)
  check(CRT.db.groups.roles["abu-kelthuzad"] == nil and G.HandRole("Abu-KelThuzad") == nil, "Use the game's role clears it")
  check(icon.coords[3] == 22 / 64 and slot.roleHand.shown == false, "back to the game's role, no marker")
  -- a role for someone not in the group shows too
  G:SetHandRole("Gadios-Area52", "TANK")
  local gslot
  for i = 1, 40 do if w[i] == "Gadios-Area52" then gslot = gridRef.slots[i] end end
  check(gslot and gslot.roleHand and gslot.roleHand.shown == true, "a role set by hand shows for a player out of the group")
  G:SetHandRole("Gadios-Area52", nil)
end
if fails > 0 then error(fails .. " groups invite checks failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness + tail)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Modules/Groups/Data.lua', 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Modules/Groups/Page.lua', 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Modules/Groups/Apply.lua', 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Modules/Groups/Invite.lua', 'utf8')));
if (lua.lua_pcall(L, 4, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
