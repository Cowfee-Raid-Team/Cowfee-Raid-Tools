// Loot Master > Tonight's Test boss kill (CRT_Modules/LootMaster/Test.lua, BossLoot.lua, BossLootWindow.lua, Page.lua), on
// stand-in frames: each click adds 2 to 4 sample items to Boss loot as won, ticked TEST rows from "Test boss N", through
// BL:AddReceived; Held boss loot lists them on Tonight with its count line; Start session (N) starts a test session with the
// ticked rows (the popups go out, the looter window opens); End session clears the TEST rows and leaves real rows; a mixed
// tick starts the real ones only; TEST rows are never kept for a /reload, have no trade time and nothing reaches Loot History;
// a real kill's rows are as before.
// Usage: node run_lootmaster_testkill.js <addon folder>
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local dataSrc, commSrc, gateSrc, lootingSrc, bossSrc, winSrc, testSrc, pageSrc = ...
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
  GetItemInfoInstant = function(s) return idOf(s), "Armor", "Plate", "INVTYPE_HEAD", 133000, 4, 4 end,
}
local sent = {}
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, InChatMessagingLockdown = function() return false end,
  SendAddonMessage = function(prefix, text) sent[#sent + 1] = text return 0 end }
local timers = {}
C_Timer = { After = function(s, fn) timers[#timers + 1] = { at = NOW + s, fn = fn } end,
  NewTicker = function() return { Cancel = function() end } end }
local function runTimers() local due = timers timers = {} for _, t in ipairs(due) do if t.at <= NOW then t.fn() else timers[#timers + 1] = t end end end
local texts, frames = {}, {}
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
      IsVisible = function(self) return self.shown end,
      SetShown = function(self, v) self.shown = v and true or false end,
      SetEnabled = function(self, v) self.enabled = v and true or false end,
      IsEnabled = function(self) return self.enabled end,
      SetChecked = function(self, v) self.checked = v and true or false end,
      GetChecked = function(self) return self.checked end,
      SetScript = function(self, name, fn) self.scripts[name] = fn end,
      SetTexture = function(self, v) self.texture = v end,
      SetDesaturated = function(self, v) self.desaturated = v end,
      SetWidth = function(self, v) self.width = v end,
      CreateTexture = function() return mock() end,
      CreateFontString = function() local fsx = mock() texts[#texts + 1] = fsx return fsx end,
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
CreateFrame = function() local f = mock() frames[#frames + 1] = f f.events = {} f.RegisterEvent = function(me, e) me.events[e] = true end return f end
CreateScrollBoxListLinearView = function() return mock() end
ScrollUtil = { InitScrollBoxListWithScrollBar = function() end }
CreateDataProvider = function(rows) return rows end
local made, buttons, helps = {}, {}, {}
local pageBuild
CRT_UI = {
  PAGE_W = 1026, PAGE_H = 560,
  TITLE_STRIP = { neutral = { bg = "background" } },
  SkinScrollBar = function() end, SkinEditBox = function() end, SkinCloseButton = function() end, SkinButton = function() end,
  IsModern = function() return true end,
  Window = function(name, opts)
    local w = mock()
    w.name, w.opts, w.content = name, opts, mock()
    w.strip = mock()
    w.strip.SetBadge = function(self, text) self.badge = text end
    made[#made + 1] = w
    return w
  end,
  PanelButton = function(parent, label, h, onClick)
    local b = mock() b.label, b.onClick, b.text = label, onClick, label
    b.GetFontString = function(self) local fsx = mock() fsx.text = self.text return fsx end
    buttons[label] = b return b
  end,
  PanelButtonWidth = function(w) return math.max(80, math.ceil(w) + 24) end,
  SkinCheckButton = function() end,
  Help = function(p, title, text) helps[title] = text return mock() end,
  Dropdown = function() local d = mock() d.refresh = function() end d.Dropdown = mock() return d end,
  Slider = function() local s = mock() s.refresh = function() end return s end,
  SortHeaders = function() return { refresh = function() end } end,
  RegisterPage = function(_, key, title, build) pageBuild = build end,
  RegisterTab = function() end, SetTabSelected = function() end,
}
local CRT = { UI = CRT_UI, db = { lootmaster = { authority = { leader = true, names = {} }, bossLoot = {}, score = { show = true }, sort = {} } } }
CRT_THEME(CRT, CRT_UI)
CRT_UI.SwitchTheme("cowfee")
CRTDBChar = {}
local printed = {}
function CRT:Print(m) printed[#printed + 1] = m end
CRT.Groups = { Normalize = function(n) return n end }
-- Loot History: the samples' pool; any other use (a write) is a failure
local HISTORY = {}
for id in pairs(NAMES) do HISTORY[#HISTORY + 1] = { [8] = "item:" .. id .. "::::" } end
table.sort(HISTORY, function(a, b) return a[8] < b[8] end)
local lootWrites, lootRecords = 0, {}
CRT.Loot = setmetatable({ R = { ITEM = 8 }, ItemID = function(s) return idOf(s) end,
  Each = function(_, fn) for _, rec in ipairs(HISTORY) do fn(rec) end end,
  -- Loot History's writers (Loot/Store.lua): a record written here fails the checks below
  Add = function(_, f) lootRecords[#lootRecords + 1] = f end, Update = function(_, rec, f) lootRecords[#lootRecords + 1] = f end },
  { __index = function(_, k) lootWrites = lootWrites + 1 return function() end end })
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
local LM = CRT.LootMaster
assert(load(commSrc, "Comm.lua"))("CowfeeRaidTools", CRT)
assert(load(gateSrc, "AutoPass.lua"))("CowfeeRaidTools", CRT)
assert(load(lootingSrc, "Looting.lua"))("CowfeeRaidTools", CRT)
assert(load(bossSrc, "BossLoot.lua"))("CowfeeRaidTools", CRT)
assert(load(winSrc, "BossLootWindow.lua"))("CowfeeRaidTools", CRT)
-- the loot filter (Filter.lua isn't loaded): everything passes but a Belt, so a test row outside it shows
function LM:FilterLoot(s, source, link) if link:find("Belt", 1, true) then return false, "quality" end return true end
LM.Filter = function() return {} end
LM.ItemFacts = function(s) return s end
LM.PassesFilter = function(s) return not tostring(s):find("item:205", 1, true), nil end
assert(load(testSrc, "Test.lua"))("CowfeeRaidTools", CRT)
LM.BuildFilterTab = function() end
LM.ScoreList = function() return {} end
-- Sync.lua and Score.lua are not loaded: their parts of the page stand still
function LM:CanSync() return false end
function LM:SyncBlocked() return nil end
function LM:SyncStatus() return nil end
function LM:SyncPing() end
function LM:SyncTargets() return {} end
LM.ScoreChanged = function() end
assert(load(pageSrc, "Page.lua"))("CowfeeRaidTools", CRT)
local BL = LM.BossLoot
local fired = {}
LM:OnChange(function(what, s) fired[#fired + 1] = { what = what, s = s } end)
local function seeded(seed) return function(n) seed = (seed * 1103515245 + 12345) % 2147483648 return (seed % n) + 1 end end

-- the page: Tonight's buttons and Held boss loot
local pf = mock()
pf.shown = true
local okBuild, err = pcall(pageBuild, pf)
check(okBuild, "the page builds: " .. tostring(err))
check(buttons["Test boss kill"] ~= nil, "Tonight: a Test boss kill button")
eq(buttons["Test"], nil, "Tonight: no plain Test button")
local start = buttons["Start session (0)"]
check(start ~= nil, "Tonight: a Start session (N) button")
check(buttons["End session"] ~= nil and buttons["Looter window"] ~= nil and buttons["My popup"] ~= nil, "Tonight: the other session buttons stay")
check(type(helps["Held boss loot"]) == "string", "Tonight: Held boss loot has (?) help")
check(helps["Loot session"]:find("Test boss kill", 1, true) ~= nil, "Tonight: the session help says what Test boss kill does")
eq(start.enabled, false, "Start session: off with nothing held")

-- 1. Three test kills hold the right rows
printed = {}
local rand = seeded(7)
local kills = {}
for k = 1, 3 do kills[k] = LM:TestBossKill(rand) end
local total = 0
for k = 1, 3 do
  local n = #kills[k]
  check(n >= 2 and n <= 4, "kill " .. k .. ": 2 to 4 items (" .. n .. ")")
  total = total + n
  for _, r in ipairs(kills[k]) do
    eq(r.boss, "Test boss " .. k, "kill " .. k .. ": the boss label")
    eq(r.test, true, "kill " .. k .. ": a TEST row")
    eq(r.status, "won", "kill " .. k .. ": won")
    eq(r.ticked, true, "kill " .. k .. ": ticked")
    check(r.rollID < 0, "kill " .. k .. ": CRT's own rollID, as a received item")
    eq(r.received, nil, "kill " .. k .. ": not shown as received from the game")
  end
end
eq(#BL:Rows(), total, "the list holds every test kill's items")
eq(#printed, 3, "a chat line per kill")
check(printed[1]:find("Test boss 1", 1, true) ~= nil, "the chat line names the kill")
eq(#made, 0, "test kills don't open the Boss loot window")
local bosses, items = BL:Held()
eq(bosses, 3, "Held: three bosses")
eq(items, total, "Held: the items")
eq(CRTDBChar.lootmaster.bossLootList, nil, "TEST rows are never kept for a /reload")
eq(BL.TradeLeft(kills[1][1]), nil, "a TEST row has no trade time")
eq(kills[1][1].expires, NOW + LM.BOSS_SECONDS, "a TEST row leaves after the usual 10 minutes")
eq(BL.boss, nil, "test kills don't set the window's badge")
-- Tonight shows them
local heldStatus = string.format("3 bosses killed, %d items held", total)
LM:Fire("bossloot", "changed")
eq(start.text, "Start session (" .. total .. ")", "Start session: the ticked won count")
local function shown(text) for _, t in ipairs(texts) do if t.text == text then return true end end return false end
check(shown(heldStatus), "Tonight: the status says " .. heldStatus)
local heldShown = 0
for _, f in ipairs(frames) do if rawget(f, "withBoss") and f.shown then heldShown = heldShown + 1 end end
eq(heldShown, math.min(4, total), "Tonight: Held boss loot shows the rows, at most 4")
if total > 4 then check(shown("and " .. (total - 4) .. " more (/crt loot boss shows them all)"), "Tonight: and N more past the cap") end
eq(start.enabled, true, "Start session: on")
check(start.width and start.width >= #start.text * 6, "Start session: as wide as its label")
-- the Held list's rows are LM.BossLootRow's: find the first by its TEST tag
local first = kills[1][1]
local row = mock()
row.withBoss = true
LM.BossLootRow(row, first)
check(row.name.text:find("TEST", 1, true) ~= nil, "row: the TEST tag")
check(row.name.text:find("|cff" .. CRT_UI.Hex("warn") .. "TEST|r", 1, true) ~= nil, "row: TEST in the warn colour")
check(row.name.text:find("|Hitem:", 1, true) ~= nil, "row: the item link")
check(row.detail.text:find("^Test boss 1") ~= nil, "row: the boss label first (" .. tostring(row.detail.text) .. ")")
eq(row.check.checked, true, "row: ticked")
eq(row.status.text, ("|cff" .. CRT_UI.Hex("good") .. "Yours · a test boss kill|r"), "row: yours, from a test kill")
check(type(row.scripts.OnEnter) == "function", "row: the item tooltip on hover")
local winRow = mock()
LM.BossLootRow(winRow, first)
check(winRow.detail.text:find("^Test boss 1") ~= nil, "window row: a TEST row shows its boss too")

-- 4 (mixed). A real kill's row next to the TEST rows: Start starts the real ones only, and says so
local kill = { name = "Big Boss", at = CLOCK, instance = "2810-16" }
local real = BL:Add(1, link(101, "Real Helm"), { status = "rolling", rollType = 1 }, kill)
eq(#made, 1, "a real kill still opens the Boss loot window with TEST rows held")
eq(made[1].strip.badge, "Big Boss · Mythic", "the badge is the real boss")
eq(real.test, nil, "a real row isn't TEST")
eq(real.ticked, true, "a real row: ticked by the filter as before")
BL:Result(link(101, "Real Helm"), "Solex", true, false)
eq(real.expires, NOW + LM.TRADE_SECONDS, "a real won row: its 2 hours to trade as before")
check(CRTDBChar.lootmaster.bossLootList and #CRTDBChar.lootmaster.bossLootList.rows == 1, "only the real row is kept for a /reload")
LM:Fire("bossloot", "changed")
eq(start.text, "Start session (1)", "mixed tick: N counts what Start sends, the real item only")
printed, sent = {}, {}
eq(BL:Start(), 1, "mixed tick: one real item started")
check(LM.current and not LM.current.test, "mixed tick: a real session")
eq(LM.current and #LM.current.items, 1, "mixed tick: the real item only")
check(printed[1] and printed[1]:find("real items only", 1, true) ~= nil, "mixed tick: chat says so (" .. tostring(printed[1]) .. ")")
eq(#BL:Rows(), total, "mixed tick: the TEST rows stay")
LM:End()
eq(#BL:Rows(), total, "ending a real session leaves the TEST rows")

-- 2. Start session (N): a test session with the ticked TEST rows; the popups go out, the looter window opens
BL:SetTicked(first.rollID, false)
LM:Fire("bossloot", "changed")
eq(start.text, "Start session (" .. (total - 1) .. ")", "Start session: one fewer when one is unticked")
fired, sent, printed = {}, {}, {}
start.onClick()
local s = LM.current
check(s ~= nil and s.test == true, "Start session: a test session")
local want = math.min(total - 1, LM.MAX_ITEMS)
eq(s and #s.items, want, "Start session: the ticked TEST rows")
local opened = false
for _, f in ipairs(fired) do if f.what == "started" and f.s == s then opened = true end end
check(opened, "Start session: started, so the looter window opens")
local popups = false
for _, t in ipairs(sent) do if t:sub(1, 1) == "S" then popups = true end end
check(popups, "Start session: the session goes to the group (raider popups)")
eq(#BL:Rows(), 1, "Start session: the started rows leave the list, the unticked one stays")
eq(BL:Rows()[1], first, "the unticked TEST row is the one held")
-- an award in a test: only you see it
printed = {}
LM:Award(1, "Solex-Sargeras", s.responses[1].key)
check(printed[#printed] and printed[#printed]:find("only you see this", 1, true) ~= nil, "a test award is shown only to you")

-- 3. End session clears the TEST rows (and any waiting), leaves real rows; nothing reached Loot History
lootRecords = {}
local real2 = BL:Add(2, link(102, "Real Ring"), { status = "rolling", rollType = 1 }, kill)
buttons["End session"].onClick()
eq(LM.current and LM.current.test and #LM.current.items or 0, (total - 1) > LM.MAX_ITEMS and (total - 1 - LM.MAX_ITEMS) or 0,
  "End session: waiting TEST items start next, as the queue does")
if LM.current then buttons["End session"].onClick() end
eq(LM.current, nil, "End session: no session")
eq(BL:HasTests(), false, "End session: the TEST rows are gone")
eq(BL:Rows()[1], real2, "End session: the real row stays")
eq(#BL:Rows(), 1, "End session: only the real row")
eq(lootWrites, 0, "nothing reaches Loot History")
eq(#lootRecords, 0, "ending the test session wrote no Loot History record")
eq(#HISTORY, 6, "Loot History still holds only its own records")
-- End session with no session running still clears TEST rows
LM:TestBossKill(rand)
check(BL:HasTests(), "a new test kill")
eq(BL:Rows()[2].boss, "Test boss 1", "the count starts again once no TEST rows are held")
buttons["End session"].onClick()
eq(BL:HasTests(), false, "End session with no session: the TEST rows go")
eq(#BL:Rows(), 1, "End session with no session: the real row stays")
-- TEST rows go after 10 minutes, without the trade words
LM:TestBossKill(rand)
printed = {}
NOW = NOW + LM.BOSS_SECONDS + 1
runTimers()
eq(BL:HasTests(), false, "TEST rows leave after 10 minutes")
eq(#printed, 0, "no 'trade time over' line for TEST rows")
-- /crt loot test keeps the instant test; its end leaves held TEST rows alone
LM:TestBossKill(rand)
local heldTests = #BL:Rows()
fired = {}
LM:Command("loot test 2")
check(LM.current and LM.current.test and #LM.current.items == 2, "/crt loot test: an instant test session")
LM:End()
check(BL:HasTests(), "an instant test's end leaves held TEST rows")
eq(#BL:Rows(), heldTests, "an instant test's end: the list as it was")
eq(#lootRecords, 0, "an instant test wrote no Loot History record")
buttons["End session"].onClick()
eq(BL:HasTests(), false, "Tonight's End session clears them")
-- an empty item cache: a test kill still adds its rows, with a link made from the item string
local realInfo = C_Item.GetItemInfo
C_Item.GetItemInfo = function() return nil end
local cold = LM:TestBossKill(rand)
check(#cold >= 2 and #cold <= 4, "empty item cache: the kill still adds 2 to 4 rows (" .. #cold .. ")")
check(cold[1] and cold[1].link:find("|h%[Item %d+%]|h|r$") ~= nil, "empty item cache: a whole link (" .. tostring(cold[1] and cold[1].link) .. ")")
C_Item.GetItemInfo = realInfo
buttons["End session"].onClick()
-- the badge and the result matching start again once no real rows are left (TEST rows don't count)
BL:Clear()
BL:Add(3, link(103, "Real Cloak"), { status = "rolling", rollType = 1 }, kill)
LM:TestBossKill(rand)
BL:SetTicked(3, false)
BL:Result(link(103, "Real Cloak"), "Other-Sargeras", false, false)
eq(BL.boss, "Big Boss", "a real row held: the badge stays")
local test3 = {}
for _, r in ipairs(BL:Rows()) do if r.test then test3[#test3 + 1] = r end end
BL.rows = test3 -- the real row gone (its time over), only TEST rows left
BL:SetTicked(test3[1].rollID, true)
eq(BL.boss, nil, "only TEST rows left: the badge is cleared")
BL:Add(4, link(103, "Real Cloak"), { status = "rolling", rollType = 1 }, kill)
check(BL:Result(link(103, "Real Cloak"), "Solex", true, false, nil, "received"), "only TEST rows left: a new kill's same item matches again")
-- Held: an old saved row with no boss or kill time counts by its encounter, or not at all
BL:Clear()
BL.rows = { { rollID = -90, status = "won", encounterID = 3001 }, { rollID = -91, status = "won", encounterID = 3002 }, { rollID = -94, status = "won", encounterID = 3002 },
  { rollID = -92, status = "won" }, { rollID = -93, status = "won", boss = "Big Boss", killAt = CLOCK } }
local hb, hi = BL:Held()
eq(hb, 3, "Held: old rows count by encounter; one with neither isn't a boss")
eq(hi, 5, "Held: every row is an item")
BL.rows = {}

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Modules/LootMaster/Data.lua', 'CRT_Modules/LootMaster/Comm.lua', 'CRT_Modules/LootMaster/AutoPass.lua',
  'CRT_Modules/LootMaster/Looting.lua', 'CRT_Modules/LootMaster/BossLoot.lua', 'CRT_Modules/LootMaster/BossLootWindow.lua',
  'CRT_Modules/LootMaster/Test.lua', 'CRT_Modules/LootMaster/Page.lua'];
for (const f of files) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
