// CRT_Modules/Groups/Data.lua and CRT_Modules/Groups/Page.lua on mock frames: the "In group, not in layout" list.
// usage: node run_groups_extras.js <addon folder>
const fs = require('fs');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local dataSrc, pageSrc, applySrc, inviteSrc, sortSrc = ...
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
local dropdowns = {} -- every UI.Dropdown the page makes: its label and opts; refresh() asks enabledIf
local gridRef
local CRT = { db = { groups = { presets = {}, nextId = 1, keepChanges = false, source = "raid", working = {} }, classCache = {}, roleCache = {}, ui = {} } }
function CRT:Print(m) print("  [chat] " .. m) end
local pages = {}
CRT.UI = { SkinScrollBar = function() end, SlotGrid = function() local g = { slots = {}, labels = {}, blockH = 143, slotW = 188 } for i = 1, 40 do local b = mock() rawset(b, "index", i) rawset(b, "icon", mock()) rawset(b, "text", mock()) rawset(b, "right", mock()) g.slots[i] = b end gridRef = g return g end, FitText = function() end, GoodText = function(t) return t end, ClipText = function() return mock() end, PAGE_W = 1026, PAGE_H = 560, Help = function(_, title, text) local m = mock("help") rawset(m, "helpTitle", title) rawset(m, "helpText", text) groupHelps[#groupHelps + 1] = m return m end, RegisterPage = function(_, k, t, fn) pages[k] = fn end,
  PanelButtonWidth = function(w) return w + 28 end,
  Dropdown = function(_, text, opts) local row = mock("dropdown") rawset(row, "label", text) rawset(row, "opts", opts)
    rawset(row, "refresh", function() rawset(row, "enabled", not opts.enabledIf or opts.enabledIf() and true or false) end) dropdowns[#dropdowns + 1] = row return row end, ContextMenu = function(owner, fill) local m = { owner = owner, fill = fill, Close = function(self) self.closed = true end } menus[#menus + 1] = m return m end }
CRT_THEME(CRT, CRT.UI)
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
assert(load(sortSrc, "Sort.lua"))("CowfeeRaidTools", CRT)
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

-- A roster sent with a note (Groups:StoreFrom): in the layouts list as active, and its tooltip says who from; your own
-- layouts have no such tooltip.
do
  local mineId = CRT.db.groups.selected
  local id = G:StoreFrom("Kip-Area52", "Mythic (from Kip)", { "Abu-KelThuzad", "", "Solex-Area52" })
  check(G:Active() == id, "a received roster is the active layout")
  local mine, theirs
  for _, b in ipairs(buttons) do
    if rawget(b, "presetId") == id and b.shown then theirs = b end
    if rawget(b, "presetId") == mineId and b.shown then mine = b end
  end
  check(theirs and theirs.text.text == "Mythic (from Kip)" and theirs.active.shown, "in the list, marked active")
  tip = {}
  theirs.OnEnter(theirs)
  check(tip[1] == "Mythic (from Kip)" and tip[2] == "from Kip", "its tooltip names the sender: " .. tostring(tip[2]))
  check(tostring(tip[3]):find("next roster they send replaces it", 1, true), "and says the next one replaces it: " .. tostring(tip[3]))
  tip = {}
  mine.OnEnter(mine)
  check(#tip == 0, "your own layout: no tooltip")
  G:Delete(id)
end

-- A roster that opens in the grid while the name picker, a slot menu or a drag is open on your layout: they close,
-- and nothing from them lands on the roster.
do
  local mineId = CRT.db.groups.selected
  G:Select(mineId) -- nothing unsaved, so the roster will open
  local mineSlots = {}
  for i = 1, 40 do mineSlots[i] = G:Working()[i] end
  gridRef.slots[2].OnClick(gridRef.slots[2], "LeftButton")
  local picker
  for _, f in ipairs(frames) do if rawget(f, "slotIndex") == 2 then picker = f end end
  check(picker and picker.shown, "the name picker is open on slot 2")
  local items = openMenu(6)
  local menu = menus[1]
  check(items and items[3].label == "Clear slot", "and slot 6's menu")
  gridRef.slots[1].OnDragStart(gridRef.slots[1])
  local id, opened = G:StoreFrom("Kip-Area52", "Heroic (from Kip)", { "Kip-Area52", "Zed-Area52", "", "", "", "Abu-KelThuzad" })
  check(opened and CRT.db.groups.selected == id, "the roster opened in the grid")
  check(not picker.shown, "the name picker closed")
  check(menu.closed == true, "the slot menu closed")
  picker.edit:SetText("Balevolence")
  picker.edit.OnEnterPressed(picker.edit)
  items[3].fn()
  for _, b in ipairs(gridRef.slots) do rawset(b, "over", b.index == 3) end
  gridRef.slots[1].OnDragStop(gridRef.slots[1])
  for _, b in ipairs(gridRef.slots) do rawset(b, "over", false) end
  local w2 = G:Working()
  check(w2[2] == "Zed-Area52" and w2[6] == "Abu-KelThuzad" and w2[1] == "Kip-Area52" and w2[3] == "",
    "no pick, clear or drag from them landed on the roster: " .. table.concat({ w2[1], w2[2], w2[3], w2[6] }, ","))
  local same = true
  for i = 1, 40 do if (G:Find(mineId).slots[i] or "") ~= mineSlots[i] then same = false end end
  check(same, "and your layout is unchanged")
  -- on your own layout's grid the picker still works
  G:Select(mineId)
  gridRef.slots[3].OnClick(gridRef.slots[3], "LeftButton")
  picker.edit:SetText("Balevolence")
  picker.edit.OnEnterPressed(picker.edit)
  check(G:Working()[3] == "Balevolence-Area52", "the picker fills a slot on the open grid: " .. tostring(G:Working()[3]))
  G:Delete(id)
end

-- Sort by: a dropdown of the four methods, Sort grid and its (?); Left and right sides adds the assignment dropdown,
-- and with no two-row assignment Sort grid is greyed with the reason. Sort grid rewrites the grid only.
do
  local function dropdown(label) for _, d in ipairs(dropdowns) do if d.label == label then return d end end end
  local sortBy, side = dropdown("Sort by"), dropdown("Assignment")
  check(sortBy ~= nil and side ~= nil, "the Sort by and Assignment dropdowns are there")
  local keys = {}
  for _, o in ipairs(sortBy.opts.options) do keys[#keys + 1] = o.label end
  check(table.concat(keys, "|") == "Role blocks|Melee and ranged groups|Spread duplicates|Left and right sides", "the four methods in order: " .. table.concat(keys, "|"))
  check(sortBy.opts.get() == "roles", "Role blocks is picked by default")
  local sortButton
  for _, b in ipairs(buttons) do if rawget(b, "text") == "Sort grid" then sortButton = b end end
  check(sortButton ~= nil, "the Sort grid button")
  local helpTargets = {}
  for _, h in ipairs(groupHelps) do helpTargets[h.helpTitle] = rawget(h, "helpTarget") end
  check(helpTargets["Sort by"] == sortButton, "Sort by's (?) is right of Sort grid")
  check(not side.shown and sortButton.enabled == true, "Role blocks: no Assignment dropdown, Sort grid enabled")
  sortBy.opts.set("sides")
  check(CRT.db.groups.sortMethod == "sides" and side.shown, "Left and right sides: saved, and the Assignment dropdown shows")
  local opts = side.opts.options()
  check(#opts == 1 and opts[1].label == "No two-row assignments" and opts[1].disabled, "no two-row assignments: it says so")
  check(side.enabled == false and sortButton.enabled == false, "and both are greyed")
  tip = {}
  sortButton.OnEnter(sortButton)
  check(tip[2] and tip[2]:find("two rows", 1, true), "Sort grid's tooltip says why: " .. tostring(tip[2]))
  check(tip[2] and tip[2]:find("Raid Notes > Mech Alerts > Mechanics (pick the boss and the ability, then its Assign tab)", 1, true), "and where to make one, by its full path: " .. tostring(tip[2]))
  -- Sort by's (?): one paragraph per method, in the list form (UI.AddTooltipText), the sides one naming the same path
  local sortHelp
  for _, h in ipairs(groupHelps) do if h.helpTitle == "Sort by" then sortHelp = rawget(h, "helpText") end end
  local items = {}
  for _, item in ipairs(type(sortHelp) == "table" and sortHelp or {}) do if type(item) == "table" then items[#items + 1] = item end end
  check(#items == 4 and items[1][1] == "Role blocks" and items[2][1] == "Melee and ranged groups" and items[3][1] == "Spread duplicates" and items[4][1] == "Left and right sides",
    "Sort by's (?) has one item per method, by its on-screen name")
  check(items[4] and items[4][2]:find("Raid Notes > Mech Alerts > Mechanics (pick the boss and the ability, then its Assign tab)", 1, true), "the sides method names where its assignment is made")
  sortBy.opts.set("roles")
  check(not side.shown and sortButton.enabled == true, "back to Role blocks")
  -- Sort grid: the same names, rearranged, as an unsaved edit; nobody in the raid moves (SetRaidSubgroup isn't there)
  local w0, set0 = G:Working(), {}
  G:ReplaceWorking({ "Solex-Area52", "", "", "", "", "Abu-KelThuzad", "", "", "", "", "Balevolence-Area52", "", "", "", "", "Newguy-Area52" })
  G.dirty = false
  for _, k in ipairs(G:Working()) do if k ~= "" then set0[k] = true end end
  sortButton.OnClick(sortButton)
  local w1, n = G:Working(), 0
  for i = 1, 40 do if w1[i] ~= "" then n = n + 1 check(set0[w1[i]], "kept " .. w1[i]) end end
  check(n == 4 and w1[1] ~= "" and w1[5] == "" and w1[6] == "", "the four fill group 1: " .. table.concat({ w1[1], w1[2], w1[3], w1[4] }, ","))
  check(G.dirty == true, "an unsaved edit")
  G:ReplaceWorking({})
  sortButton.OnClick(sortButton)
  check(sortButton.enabled == false, "an empty grid: greyed")
end
-- Post group changes to raid chat: a check box right of Arrange Groups, saved; off by default
do
  local post
  for _, f in ipairs(frames) do local l = rawget(f, "label") if type(l) == "table" and rawget(l, "text") == "Post group changes to raid chat" then post = f end end
  check(post ~= nil, "the Post group changes check box")
  local helpTarget
  for _, h in ipairs(groupHelps) do if h.helpTitle == "Post group changes to raid chat" then helpTarget = rawget(h, "helpTarget") end end
  check(post and helpTarget == post.label, "its (?) is right of its label")
  check(not CRT.db.groups.postChanges, "off to begin with")
  rawset(post, "GetChecked", function() return true end)
  post.OnClick(post)
  check(CRT.db.groups.postChanges == true, "ticking it saves it")
  rawset(post, "GetChecked", function() return false end)
  post.OnClick(post)
  check(CRT.db.groups.postChanges == false, "unticking it saves it")
end
-- PresetNames: any saved layout's names, in slot order, each once (any case); ActiveNames reads the active one
-- through it (the Wishlists tab's Layout pick, Issue #1277)
do
  check(type(G.PresetNames) == "function", "Groups:PresetNames is there")
  local mineId = CRT.db.groups.selected
  local id = G:StoreFrom("Kip-Area52", "Names (from Kip)", { "", "Zed-Area52", "", "Abu-KelThuzad", "", "zed-area52", "Kip-Area52" })
  check(G:Active() == id, "the received layout is active")
  local function joined(t) return table.concat(t or {}, ",") end
  check(joined(G.PresetNames and G:PresetNames(id)) == "Zed-Area52,Abu-KelThuzad,Kip-Area52", "its names in slot order, each once: " .. joined(G.PresetNames and G:PresetNames(id)))
  check(joined(G:ActiveNames()) == joined(G.PresetNames and G:PresetNames(id)), "ActiveNames is the active layout's PresetNames")
  local want, seen = {}, {}
  for i = 1, 40 do local k = G:Find(mineId).slots[i] if type(k) == "string" and k ~= "" and not seen[k:lower()] then seen[k:lower()] = true want[#want + 1] = k end end
  check(G.PresetNames and joined(G:PresetNames(mineId)) == joined(want), "a layout not in use reads its own names: " .. joined(G.PresetNames and G:PresetNames(mineId)))
  check(G.PresetNames and #G:PresetNames("no-such-layout") == 0 and #G:PresetNames(nil) == 0, "no such layout: no names")
  G:Delete(id)
end
if fails > 0 then error(fails .. " groups invite checks failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness + tail)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Modules/Groups/Data.lua', 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Modules/Groups/Page.lua', 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Modules/Groups/Apply.lua', 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Modules/Groups/Invite.lua', 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Modules/Groups/Sort.lua', 'utf8')));
if (lua.lua_pcall(L, 5, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
