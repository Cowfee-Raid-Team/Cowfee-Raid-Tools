// Loot Master > Tonight's layout (CRT_Modules/LootMaster/Tonight.lua, built by Page.lua), on stand-in frames: My Loot on the
// left, a card that opens your loot popup and All Loot Rolls (LM:OpenMyLoot, RaiderWindow.lua), with a status line counting the
// items waiting for your answer and their icons (the last session's dimmed when nothing waits); Master loot on the right, with
// its (?), CRT Looting, the session line, a 2x2 grid (Test boss kill, Start session (N), Master Loot Window, End session), the
// compact Held boss loot list, Add from bags and the session's Items. Without loot authority the right side is greyed and Add
// from bags refuses with the reason; the card always works. "Master Loot Window" is the looter window's name wherever it shows.
// Usage: node run_lootmaster_tonight.js <addon folder>
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local dataSrc, commSrc, gateSrc, lootingSrc, bossSrc, endSrc, winSrc, testSrc, slotSrc, addSrc, raiderSrc, tonightSrc, pageSrc = ...
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
GetChannelList = function() end
INVTYPE_HEAD = "Head"
local NAMES = { [201] = "Helm", [202] = "Gloves", [203] = "Ring", [204] = "Cloak", [205] = "Belt", [206] = "Boots" }
local function link(id, name) return "|cffa335ee|Hitem:" .. id .. "::::::::80:::::|h[" .. name .. "]|h|r" end
local function idOf(s) return tonumber(tostring(s or ""):match("item:(%d+)")) end
C_Item = {
  GetItemInfo = function(s) local id = idOf(s) if id and NAMES[id] then return NAMES[id], link(id, NAMES[id]) end return nil end,
  GetDetailedItemLevelInfo = function() return 250 end,
  GetItemInfoInstant = function(s) return idOf(s), "Armor", "Plate", "INVTYPE_HEAD", 133000 + (idOf(s) or 0), 4, 4 end,
  GetItemIconByID = function(s) return 133000 + (idOf(s) or 0) end,
  GetItemQualityByID = function() return 4 end,
  GetItemQualityColor = function(q) return 0.64, 0.21, 0.93, "ffa335ee" end,
}
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, InChatMessagingLockdown = function() return false end,
  SendAddonMessage = function() return 0 end }
C_Timer = { After = function() end, NewTicker = function() return { Cancel = function() end } end }
local texts, frames = {}, {}
-- stand-in frames: any method works; the ones read back here keep their values
local function mock()
  local o = { shown = true, enabled = true, checked = false, alpha = 1, scripts = {}, points = {} }
  return setmetatable(o, { __index = function(t, k)
    local m = ({
      SetText = function(self, v) self.text = v end,
      GetText = function(self) return self.text end,
      Show = function(self) self.shown = true end,
      Hide = function(self) self.shown = false end,
      IsShown = function(self) return self.shown end,
      IsVisible = function(self) return self.shown end,
      SetShown = function(self, v) self.shown = v and true or false end,
      SetEnabled = function(self, v) self.enabled = v and true or false end,
      IsEnabled = function(self) return self.enabled end,
      SetChecked = function(self, v) self.checked = v and true or false end,
      GetChecked = function(self) return self.checked end,
      SetScript = function(self, name, fn) self.scripts[name] = fn end,
      GetScript = function(self, name) return self.scripts[name] end,
      SetTexture = function(self, v) self.texture = v end,
      SetDesaturated = function(self, v) self.desaturated = v and true or false end,
      SetAlpha = function(self, v) self.alpha = v end,
      GetAlpha = function(self) return self.alpha end,
      SetWidth = function(self, v) self.width = v end,
      GetWidth = function(self) return self.width end,
      SetSize = function(self, w, h) self.width, self.height = w, h end,
      SetPoint = function(self, ...) self.points[#self.points + 1] = { ... } end,
      ClearAllPoints = function(self) self.points = {} end,
      SetWordWrap = function(self, v) self.wrap = v end,
      SetBackdropBorderColor = function(self, r, g, b, a) self.border = { r, g, b, a } end,
      CreateTexture = function() return mock() end,
      CreateFontString = function(self) local fsx = mock() fsx.parent = self texts[#texts + 1] = fsx return fsx end,
      GetParent = function(self) return self.parent end,
      GetStringWidth = function(self) return #(self.text or "") * 6 end,
      GetHeight = function() return 26 end,
      GetFrameLevel = function() return 1 end,
      GetHighlightTexture = function() return mock() end,
    })[k]
    if m then return m end
    if type(k) == "string" and k:match("^%u") then return function() end end -- any other method
    return nil
  end })
end
CreateFrame = function(kind, name, parent, template)
  local f = mock() f.kind, f.parent, f.template = kind, parent, template
  frames[#frames + 1] = f f.events = {} f.RegisterEvent = function(me, e) me.events[e] = true end
  return f
end
CreateScrollBoxListLinearView = function() local v = mock() v.SetElementInitializer = function(self, kind, fn) self.init = fn end return v end
local boxes = {}
ScrollUtil = { InitScrollBoxListWithScrollBar = function(box, bar, view) box.view = view boxes[#boxes + 1] = box end }
CreateDataProvider = function(rows) return rows end
local buttons, helps = {}, {}
StaticPopup_ShowCustomGenericConfirmation = function(data) return mock() end
local pageBuild
CRT_UI = {
  PAGE_W = 1026, PAGE_H = 560,
  TITLE_STRIP = { neutral = { bg = "background" } },
  SkinScrollBar = function() end, SkinEditBox = function() end, SkinCloseButton = function() end, SkinButton = function() end,
  IsModern = function() return true end,
  Window = function(name, opts) local w = mock() w.content, w.strip = mock(), mock() return w end,
  PanelButton = function(parent, label, h, onClick)
    local b = CreateFrame("Button", nil, parent) b.label, b.onClick, b.text = label, onClick, label
    b.GetFontString = function(self) local fsx = mock() fsx.text = self.text return fsx end
    buttons[label] = b return b
  end,
  PanelButtonWidth = function(w) return math.max(40, math.ceil(w) + 28) end,
  SkinCheckButton = function() end,
  Help = function(p, title, text) helps[title] = text return mock() end,
  Dropdown = function() local d = mock() d.refresh = function() end d.Dropdown = mock() return d end,
  Slider = function() local s = mock() s.refresh = function() end return s end,
  SpotPicker = function() local s = mock() s.refresh = function() end return s end, SPOT_PICKER_W = 126, SPOT_PICKER_H = 70, SPOT_PICKER_GAP = 12,
  TooltipPositionSetting = function() local r = { row = mock(), refresh = function() end } return r end,
  SortHeaders = function() return { refresh = function() end } end,
  RegisterPage = function(_, key, title, build) pageBuild = build end,
  RegisterTab = function() end, SetTabSelected = function() end,
  LiftOver = function() end, ShownPopup = function(ret) return ret end,
}
local CRT = { UI = CRT_UI, db = { lootmaster = { authority = { leader = true, names = {} }, bossLoot = {}, score = { show = true }, sort = {}, answers = {} } } }
CRT_THEME(CRT, CRT_UI)
CRT_UI.SwitchTheme("cowfee")
CRTDBChar = {}
local printed = {}
function CRT:Print(m) printed[#printed + 1] = m end
CRT.Groups = { Normalize = function(n) return n end }
CRT.Loot = setmetatable({ R = { ITEM = 8 }, ItemID = function(s) return idOf(s) end, Each = function() end }, { __index = function() return function() end end })
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
local LM = CRT.LootMaster
LM.TAB_COLUMN = 180 -- Tabs.lua isn't loaded: All Loot Rolls' left column
assert(load(commSrc, "Comm.lua"))("CowfeeRaidTools", CRT)
assert(load(gateSrc, "AutoPass.lua"))("CowfeeRaidTools", CRT)
assert(load(lootingSrc, "Looting.lua"))("CowfeeRaidTools", CRT)
assert(load(bossSrc, "BossLoot.lua"))("CowfeeRaidTools", CRT)
assert(load(endSrc, "EndAll.lua"))("CowfeeRaidTools", CRT)
assert(load(winSrc, "BossLootWindow.lua"))("CowfeeRaidTools", CRT)
function LM:FilterLoot() return true end
LM.Filter = function() return {} end
LM.ItemFacts = function(s) return s end
LM.PassesFilter = function() return true, nil end
assert(load(testSrc, "Test.lua"))("CowfeeRaidTools", CRT)
assert(load(slotSrc, "ItemSlot.lua"))("CowfeeRaidTools", CRT)
assert(load(addSrc, "AddItem.lua"))("CowfeeRaidTools", CRT)
assert(load(raiderSrc, "RaiderWindow.lua"))("CowfeeRaidTools", CRT)
LM.BuildFilterTab = function() end
LM.ScoreList = function() return {} end
function LM:CanSync() return false end
function LM:SyncBlocked() return nil end
function LM:SyncStatus() return nil end
function LM:SyncPing() end
function LM:SyncTargets() return {} end
LM.ScoreChanged = function() end
local slot
local realBuild = LM.BuildAddItem
LM.BuildAddItem = function(...) slot = realBuild(...) return slot end
assert(load(tonightSrc, "Tonight.lua"))("CowfeeRaidTools", CRT)
assert(load(pageSrc, "Page.lua"))("CowfeeRaidTools", CRT)
local BL = LM.BossLoot
-- the popup and All Loot Rolls (Popup.lua's and RaiderWindow.lua's open functions), counted
local opened = { popup = 0, answers = 0 }
function LM:ShowPopup() opened.popup = opened.popup + 1 end
function LM:ShowAnswers() opened.answers = opened.answers + 1 end
function LM:ShowLastPopup(s) opened.last = s end
local function shown(text) for _, t in ipairs(texts) do if t.text == text and t.shown then return t end end return nil end

local pf = mock()
local okBuild, err = pcall(pageBuild, pf)
check(okBuild, "the page builds: " .. tostring(err))
local T = LM.Tonight or {}
check(type(LM.Tonight) == "table", "Tonight's parts are reachable for tests (LM.Tonight)")

-- 1. Two columns: My Loot on the left, Master loot on the right
local card = T.card
check(card ~= nil and card.kind == "Button", "the My Loot card is a button")
local cardX = card and card.points[1] and card.points[1][2]
check(type(cardX) == "number" and cardX < 20, "the card sits on the left (x " .. tostring(cardX) .. ")")
check(card and card.width and card.width >= 380 and card.width <= 410, "the card is a large one, inside the left column (" .. tostring(card and card.width) .. ")")
check(card and card.height and card.height >= 160, "and tall (" .. tostring(card and card.height) .. ")")
check(T.cardTitle and T.cardTitle.text == "My Loot", "its title: My Loot")
check(T.cardHint and T.cardHint.text == "Click to open your roll window · /crt loot", "its hint: Click to open your roll window · /crt loot")
local accent = CRT.PALETTE.accent
check(card and card.border and math.abs(card.border[1] - accent[1]) < 0.01 and math.abs(card.border[3] - accent[3]) < 0.01, "its border is the theme's accent")
check(T.masterHeading and T.masterHeading.text == "Master loot", "the right side's heading: Master loot")
check(helps["Master loot"] and helps["Master loot"]:find("Only the master looter", 1, true) == 1, "its (?) says only the master looter uses this side")
check(helps["Master loot"] and helps["Master loot"]:find("Test boss kill", 1, true) ~= nil, "and what Test boss kill does")
local masterX = T.masterHeading and T.masterHeading.points[1] and T.masterHeading.points[1][2]
check(type(masterX) == "number" and masterX >= 410, "Master loot is the right column (x " .. tostring(masterX) .. ")")
-- the 2x2 grid
local tk, mw, en = buttons["Test boss kill"], buttons["Master Loot Window"], buttons["End session"]
local st = buttons["Start session (0)"]
check(tk and st and mw and en, "the four buttons: Test boss kill, Start session (N), Master Loot Window, End session")
eq(buttons["My popup"], nil, "no My popup button (the card replaces it)")
eq(buttons["Looter window"], nil, "no Looter window button (renamed)")
local function at(b) local p = b and b.points[1] return p and p[2], p and p[3] end
if tk and st and mw and en then
  local x1, y1 = at(tk) local x2, y2 = at(st) local x3, y3 = at(mw) local x4, y4 = at(en)
  check(x1 == x3 and x2 == x4 and x2 > x1, "two columns of buttons")
  check(y1 == y2 and y3 == y4 and y3 < y1, "two rows: Test boss kill and Start session above, Master Loot Window and End session under")
  check(x1 >= masterX, "the grid is on the right side")
  check(x2 >= x1 + math.max(tk.width or 0, mw.width or 0), "the second column starts after the wider first-column button")
end
check(mw and mw.width and mw.width >= #"Master Loot Window" * 6, "Master Loot Window is as wide as its label")
-- the other parts of the right side
check(type(helps["Held boss loot"]) == "string", "Held boss loot keeps its (?)")
check(T.heldList ~= nil and T.heldList.view ~= nil, "Held boss loot is a scrolling list")
check(T.addHeading and T.addHeading.text == "Add from bags", "an Add from bags heading")
check(slot ~= nil and type(helps["Add from bags"]) == "string", "the bag slot, with its (?)")
check(T.itemsHeading and T.itemsHeading.text == "Items", "the session's Items")

-- 2. The card's status line counts the items waiting for your answer, with their icons
LM:Fire("bossloot", "changed")
eq(T.cardStatus and T.cardStatus.text, "Nothing to roll on right now", "no session: nothing to roll on")
local function iconsShown() local n = 0 for _, ic in ipairs(T.cardIcons or {}) do if ic.shown then n = n + 1 end end return n end
eq(iconsShown(), 0, "no session ever: no icons")
local inc = { id = "s1", items = {}, mine = {}, seconds = 60, view = {} }
for i, id in ipairs({ 201, 202, 203 }) do inc.items[i] = { itemString = "item:" .. id .. "::::", ilvl = 250, shownAt = NOW } end
inc.mine[2] = { response = "bis" }
LM.incoming = inc
LM:Fire("incoming")
eq(T.cardStatus.text, "2 items waiting for your answer", "two of three unanswered")
eq(iconsShown(), 2, "an icon per waiting item")
local ic1 = T.cardIcons[1]
eq(ic1.icon.texture, 133201, "the first waiting item's icon")
check(ic1.border and math.abs(ic1.border[1] - 0.64) < 0.01, "its border in the item's quality colour")
check(not ic1.icon.desaturated and (ic1.alpha or 1) == 1, "waiting icons are not dimmed")
check(type(ic1.scripts.OnEnter) == "function", "an icon shows the item's tooltip on hover")
inc.mine[1] = { response = "bis" }
LM:Fire("incoming")
eq(T.cardStatus.text, "1 item waiting for your answer", "one left")
inc.mine[3] = { response = "pass" }
LM:Fire("incoming")
eq(T.cardStatus.text, "Nothing to roll on right now", "all answered: nothing to roll on")
eq(iconsShown(), 3, "all answered: the session's items still show")
check(T.cardIcons[1].alpha < 1, "dimmed")
inc.mine[3] = nil
NOW = NOW + 61
LM:Fire("incoming")
eq(T.cardStatus.text, "Nothing to roll on right now", "time ran out: nothing waits")
NOW = NOW - 61
-- an auto answer (an item you can't use) isn't waiting either
inc.mine[3] = { response = "transmog", auto = true }
LM:Fire("incoming")
eq(T.cardStatus.text, "Nothing to roll on right now", "an auto answer isn't waiting")
-- the session ends: the last one's items stay, dimmed
LM.incoming = nil
LM:Fire("incoming", "ended")
eq(T.cardStatus.text, "Nothing to roll on right now", "ended: nothing to roll on")
eq(iconsShown(), 3, "ended: the last session's items show")
check(T.cardIcons[1].alpha < 1, "dimmed")
-- the card refreshes itself while shown, so a timer running out shows without a message
check(type(card.scripts.OnUpdate) == "function", "the card redraws while shown")

-- 3. Clicking the card opens your loot popup and All Loot Rolls
LM.incoming = inc
opened.popup, opened.answers = 0, 0
card.scripts.OnClick(card)
eq(opened.popup, 1, "the card: your loot popup")
eq(opened.answers, 1, "the card: All Loot Rolls")
LM:Fire("incoming")
T.cardIcons[1].scripts.OnClick(T.cardIcons[1])
eq(opened.popup, 2, "an icon click opens them too")
eq(opened.answers, 2, "an icon click opens All Loot Rolls too")
-- no session: the last one, read only, in the popup (Popup.lua's LM:ShowLastPopup) and in All Loot Rolls
LM.incoming = nil
LM:Fire("incoming", "ended")
printed = {}
card.scripts.OnClick(card)
eq(opened.popup, 2, "no session: no answer popup")
eq(opened.last, inc, "no session: the popup shows the last session, read only")
eq(opened.answers, 3, "no session: All Loot Rolls opens (it shows the last session, or says there was none)")
eq(#printed, 0, "no session: no chat line")

-- 4. Without loot authority the right side is greyed, the card is not
local realCanLoot = LM.CanLoot
local canLoot = true
function LM:CanLoot() return canLoot end
LM:Fire("bossloot", "changed")
eq(T.body.alpha, 1, "leader: the right side is not greyed")
canLoot = false
LM:Fire("bossloot", "changed")
check(T.body.alpha < 1, "raider: the right side is greyed (" .. tostring(T.body.alpha) .. ")")
for _, b in ipairs({ tk, st, mw, en }) do eq(b.enabled, false, "raider: " .. tostring(b.label) .. " is off") end
eq(card.enabled, true, "raider: the card works")
eq(card.alpha, 1, "raider: the card is not greyed")
check(T.masterHeading.alpha == 1, "raider: the heading and its (?) stay readable")
-- Add from bags refuses with the reason
CRT.Bags.TakeCursor = function() return link(201, "Helm"), 0, 1 end
local before = #BL:Rows()
slot.scripts.OnReceiveDrag(slot)
eq(#BL:Rows(), before, "raider: nothing is added from bags")
check(slot.status.text and slot.status.text:find("Only the raid leader", 1, true) ~= nil, "raider: the slot says why (" .. tostring(slot.status.text) .. ")")
canLoot = true
LM.CanLoot = realCanLoot
LM:Fire("bossloot", "changed")
eq(T.body.alpha, 1, "back to the leader: not greyed")

-- 5. Held boss loot: a compact list (icon, name, item level), the count line
LM:TestBossKill(function(n) return 1 end)
LM:TestBossKill(function(n) return 1 end)
LM:Fire("bossloot", "changed")
local held = T.heldData or {}
eq(#held, #BL:Rows(), "the list holds every held row")
local bosses, items = BL:Held()
check(shown(string.format("%d bosses killed, %d items held", bosses, items)) ~= nil, "the count line")
local row = CreateFrame("Button")
LM.HeldLootRow(row, BL:Rows()[1])
check(row.name and row.name.text and row.name.text:find("|Hitem:", 1, true) ~= nil, "a row: the item link (in its quality colour)")
check(row.name.text:find("TEST", 1, true) ~= nil, "a row: a test kill's TEST tag")
check(row.ilvl and row.ilvl.text == "250", "a row: the item level (" .. tostring(row.ilvl and row.ilvl.text) .. ")")
check(row.icon and row.icon.texture ~= nil, "a row: the icon")
check(row.check and row.check.checked == true, "a row: ticked, as in Boss loot")
check(type(row.scripts.OnEnter) == "function", "a row: the tooltip on hover")
check(st.text:find("Start session (", 1, true) == 1 and st.enabled, "Start session counts what it sends")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
// "Master Loot Window" is the looter window's name wherever it shows: no on-screen string (in quotes, outside comments) in
// Loot Master's files names it the looter window or the Loot Master window
let srcFails = 0;
const lmDir = path.join(dir, 'CRT_Modules/LootMaster');
for (const f of fs.readdirSync(lmDir).filter((n) => n.endsWith('.lua'))) {
  fs.readFileSync(path.join(lmDir, f), 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (/^\s*--/.test(line)) return;
    const code = line.replace(/\s--\s.*$/, '');
    for (const m of code.match(/"(?:[^"\\]|\\.)*"/g) || []) {
      const hit = m.match(/looter window|loot master window|looter's window/i);
      if (hit) { console.log('FAIL ' + f + ':' + (i + 1) + ' says "' + hit[0] + '": it is the Master Loot Window'); srcFails++; }
    }
  });
}
const winSrc = fs.readFileSync(path.join(lmDir, 'Window.lua'), 'utf8');
if (!/title = "Master Loot Window"/.test(winSrc)) { console.log('FAIL Window.lua: the window\'s title is not Master Loot Window'); srcFails++; }
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Modules/LootMaster/Data.lua', 'CRT_Modules/LootMaster/Comm.lua', 'CRT_Modules/LootMaster/AutoPass.lua',
  'CRT_Modules/LootMaster/Looting.lua', 'CRT_Modules/LootMaster/BossLoot.lua', 'CRT_Modules/LootMaster/EndAll.lua', 'CRT_Modules/LootMaster/BossLootWindow.lua',
  'CRT_Modules/LootMaster/Test.lua', 'CRT_Core/UI/ItemSlot.lua', 'CRT_Modules/LootMaster/AddItem.lua', 'CRT_Modules/LootMaster/RaiderWindow.lua',
  'CRT_Modules/LootMaster/Tonight.lua', 'CRT_Modules/LootMaster/Page.lua'];
for (const f of files) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
if (srcFails > 0) { console.log(srcFails + ' source checks failed'); process.exit(1); }
