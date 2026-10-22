// Loot Master: End session asks first, and Add item from your bags (CRT_Modules/LootMaster/EndAll.lua, AddItem.lua,
// BossLoot.lua, Page.lua), on stand-in frames and a stand-in game:
//   End: the confirm shows with the open counts, only when a session runs or items wait; Cancel changes nothing; End all
//     ends the session and every waiting chunk; Tonight's button, the looter window's and /crt loot end all ask.
//   Add item: a drag adds a tradeable item as a real row (won, ticked, from your bags, its real trade time); a shift-click
//     in bags adds while Tonight shows, and not when a chat box has the keyboard, the tab is hidden or it isn't a
//     shift-click; untradeable items are refused with the reason; no duplicates; added rows start a session.
// Usage: node run_lootmaster_addend.js <addon folder>
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local dataSrc, commSrc, gateSrc, lootingSrc, bossSrc, endSrc, winSrc, testSrc, addSrc, pageSrc, windowSrc = ...
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
GetLocale = function() return "enUS" end
INVTYPE_HEAD = "Head"
NUM_BAG_SLOTS = 4
local NAMES = { [201] = "Helm", [202] = "Gloves", [203] = "Ring", [204] = "Cloak", [205] = "Belt", [206] = "Boots",
  [301] = "Bag Helm", [302] = "Bag Ring", [303] = "Old Sword", [304] = "Equipped Cloak", [305] = "Plain Bracers", [306] = "Bank Boots" }
local BIND = { [303] = 1, [304] = 2 } -- bind on pickup, bind on equip
local function link(id, name) return "|cffa335ee|Hitem:" .. id .. "::::::::80:::::|h[" .. (name or NAMES[id]) .. "]|h|r" end
local function idOf(s) return tonumber(tostring(s or ""):match("item:(%d+)")) end
C_Item = {
  GetItemInfo = function(s) local id = idOf(s) if id and NAMES[id] then return NAMES[id], link(id), 4, 250, 0, "Armor", "Plate", 1, "INVTYPE_HEAD", 133000, 0, 4, 4, BIND[id] or 1 end return nil end,
  GetDetailedItemLevelInfo = function() return 250 end,
  GetItemInfoInstant = function(s) return idOf(s), "Armor", "Plate", "INVTYPE_HEAD", 133000, 4, 4 end,
}
-- the bags: [bag][slot] = item; a bound item's tooltip has the trade time line when tradeLine is set
local BAGS = { [0] = {}, [1] = {}, [-1] = {} }
local function put(bag, slot, id, bound, tradeLine)
  BAGS[bag][slot] = { hyperlink = link(id), itemID = id, isBound = bound, isLocked = false, stackCount = 1, tradeLine = tradeLine }
end
C_Container = {
  GetContainerNumSlots = function(bag) return BAGS[bag] and 16 or 0 end,
  GetContainerItemInfo = function(bag, slot) local it = BAGS[bag] and BAGS[bag][slot] return it end,
}
Enum = { TooltipDataLineType = { ItemName = 22, ItemBinding = 20, TradeTimeRemaining = 36 } }
local TRADE_TEXT = "You may trade this item with players that were also eligible to loot this item for the next %s."
C_TooltipInfo = { GetBagItem = function(bag, slot)
  local it = BAGS[bag] and BAGS[bag][slot]
  if not it then return nil end
  local lines = { { type = 22, leftText = NAMES[it.itemID] }, { type = 20, leftText = it.isBound and "Soulbound" or "Binds when equipped" } }
  if it.tradeLine then lines[#lines + 1] = { type = 36, leftText = TRADE_TEXT:format(it.tradeLine) } end
  return { lines = lines }
end }
-- the cursor
local cursor
GetCursorInfo = function() if cursor then return "item", idOf(cursor), cursor end return nil end
CursorHasItem = function() return cursor ~= nil end
local cleared = 0
ClearCursor = function() if cursor then cleared = cleared + 1 end cursor = nil
  for _, bag in pairs(BAGS) do for _, it in pairs(bag) do it.isLocked = false end end end
local function pickUp(bag, slot) local it = BAGS[bag][slot] it.isLocked = true cursor = it.hyperlink end
-- the keyboard and the click
local modified, focus, chatBox = true, nil, nil
IsModifiedClick = function(what) return modified and what == "CHATLINK" end
GetCurrentKeyBoardFocus = function() return focus end
ChatFrameUtil = { GetActiveWindow = function() return chatBox end }
-- the game's HandleModifiedItemClick and hooksecurefunc: the original keeps running, the hook after it
local original = 0
HandleModifiedItemClick = function(l, loc) original = original + 1 return false end
hooksecurefunc = function(a, b, c)
  if type(a) == "string" then local old = _G[a] _G[a] = function(...) local r = old(...) b(...) return r end
  else local old = a[b] a[b] = function(...) local r = old(...) c(...) return r end end
end
local function location(bag, slot)
  return { IsBagAndSlot = function() return true end, GetBagAndSlot = function() return bag, slot end }
end
local function shiftClick(bag, slot) return HandleModifiedItemClick(BAGS[bag][slot] and BAGS[bag][slot].hyperlink, location(bag, slot)) end
-- the game's confirm dialog: the last one asked is kept, to accept or cancel
local popup, lifted = nil, 0
StaticPopup_ShowCustomGenericConfirmation = function(data) popup = data return {} end
local sent = {}
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, InChatMessagingLockdown = function() return false end,
  SendAddonMessage = function(prefix, text) sent[#sent + 1] = text return 0 end }
local timers = {}
C_Timer = { After = function(s, fn) timers[#timers + 1] = { at = NOW + s, fn = fn } end,
  NewTicker = function() return { Cancel = function() end } end }
local texts, frames = {}, {}
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
      SetSize = function(self, w, h) self.w, self.h = w, h end,
      SetPoint = function(self, ...) self.point = { ... } end,
      SetWidth = function(self, v) self.width = v end,
      CreateTexture = function() return mock() end,
      CreateFontString = function() local fsx = mock() texts[#texts + 1] = fsx return fsx end,
      GetStringWidth = function(self) return #(self.text or "") * 6 end,
      GetHeight = function() return 26 end,
      GetFrameLevel = function() return 1 end,
      GetHighlightTexture = function() return mock() end,
    })[k]
    if m then return m end
    if type(k) == "string" and k:match("^%u") then return function() end end
    return nil
  end })
end
CreateFrame = function() local f = mock() frames[#frames + 1] = f f.events = {} f.RegisterEvent = function(me, e) me.events[e] = true end return f end
CreateScrollBoxListLinearView = function() return mock() end
ScrollUtil = { InitScrollBoxListWithScrollBar = function() end }
CreateDataProvider = function(rows) return rows end
local buttons, helps = {}, {}
local pageBuild
CRT_UI = {
  PAGE_W = 1026, PAGE_H = 560,
  TITLE_STRIP = { neutral = { bg = "background" } },
  SkinScrollBar = function() end, SkinEditBox = function() end, SkinCloseButton = function() end, SkinButton = function() end,
  IsModern = function() return true end,
  Window = function(name, opts) local w = mock() w.name, w.opts, w.content = name, opts, mock() w.strip = mock() w.strip.SetBadge = function() end return w end,
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
  LiftOver = function(d) if d then lifted = lifted + 1 end end, ShownPopup = function(ret) return ret end,
}
local CRT = { UI = CRT_UI, db = { lootmaster = { authority = { leader = true, names = {} }, bossLoot = {}, score = { show = true }, sort = {} } } }
CRT_THEME(CRT, CRT_UI)
CRT_UI.SwitchTheme("cowfee")
CRTDBChar = {}
local printed = {}
function CRT:Print(m) printed[#printed + 1] = m end
CRT.Groups = { Normalize = function(n) return n end }
local HISTORY = {}
for id = 201, 206 do HISTORY[#HISTORY + 1] = { [8] = "item:" .. id .. "::::" } end
CRT.Loot = setmetatable({ R = { ITEM = 8 }, ItemID = function(s) return idOf(s) end,
  Each = function(_, fn) for _, rec in ipairs(HISTORY) do fn(rec) end end,
  Add = function() end, Update = function() end }, { __index = function() return function() end end })
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
local LM = CRT.LootMaster
assert(load(commSrc, "Comm.lua"))("CowfeeRaidTools", CRT)
assert(load(gateSrc, "AutoPass.lua"))("CowfeeRaidTools", CRT)
assert(load(lootingSrc, "Looting.lua"))("CowfeeRaidTools", CRT)
assert(load(bossSrc, "BossLoot.lua"))("CowfeeRaidTools", CRT)
assert(load(endSrc, "EndAll.lua"))("CowfeeRaidTools", CRT)
assert(load(winSrc, "BossLootWindow.lua"))("CowfeeRaidTools", CRT)
-- the loot filter (Filter.lua isn't loaded): everything passes but a Belt and the Plain Bracers
function LM:FilterLoot(s, source, link) if link:find("Belt", 1, true) or link:find("Bracers", 1, true) then return false, "quality" end return true end
LM.Filter = function() return {} end
LM.ItemFacts = function(s) return s end
LM.PassesFilter = function() return true end
assert(load(testSrc, "Test.lua"))("CowfeeRaidTools", CRT)
assert(load(addSrc, "AddItem.lua"))("CowfeeRaidTools", CRT)
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
assert(load(pageSrc, "Page.lua"))("CowfeeRaidTools", CRT)
local BL = LM.BossLoot
local pf = mock()
pf.shown = true
local okBuild, err = pcall(pageBuild, pf)
check(okBuild, "the page builds: " .. tostring(err))
check(slot ~= nil, "Tonight: the Add item slot is built")
local function lastText(pattern) for i = #texts, 1, -1 do local t = texts[i].text if type(t) == "string" and t:find(pattern, 1, true) then return t end end return nil end
check(lastText("Add item: drag an item from your bags here, or shift-click it in your bags while this is open. Only items you can still trade.") ~= nil, "Tonight: the Add item line")
eq(slot and slot.w, 36, "the slot is 36 px")
check(slot and type(slot.scripts.OnReceiveDrag) == "function", "the slot takes a drag")
check(slot and type(slot.scripts.OnMouseUp) == "function", "the slot takes a click with an item on the cursor")
local function status() for i = #texts, 1, -1 do local t = texts[i].text if type(t) == "string" and (t:find("can't be added", 1, true) or t:find("Added ", 1, true)) then return t end end return "" end

-- End: the line under the question --------------------------------------------------------------------------------------
eq(LM.EndDetail(3, 4), "3 items are still being decided, and 4 more are waiting to start.", "detail: both")
eq(LM.EndDetail(1, 0), "1 item is still being decided.", "detail: one deciding")
eq(LM.EndDetail(0, 4), "4 items are waiting to start.", "detail: only waiting")
eq(LM.EndDetail(0, 1), "1 item is waiting to start.", "detail: one waiting")
eq(LM.EndDetail(2, 1), "2 items are still being decided, and 1 more is waiting to start.", "detail: one more waiting")
eq(LM.EndDetail(0, 0), nil, "detail: nothing open")

-- End with nothing running or waiting: no dialog, the TEST rows go
LM:TestBossKill(function() return 1 end)
check(BL:HasTests(), "a test kill's rows")
popup = nil
buttons["End session"].onClick()
eq(popup, nil, "nothing running or waiting: no dialog")
eq(BL:HasTests(), false, "nothing running or waiting: End session clears the TEST rows")

-- A test session bigger than one batch: 11 TEST rows, so 8 run and 3 wait
local kill = { name = "Test boss 1", at = CLOCK, test = true }
local ids = { 201, 202, 203, 204, 206, 201, 202, 203, 204, 206, 201 }
for _, id in ipairs(ids) do BL:AddReceived(link(id), kill, true) end
eq(BL:Start(), 11, "Start session: 11 TEST items")
check(LM.current and LM.current.test, "a test session runs")
eq(#LM.current.items, LM.MAX_ITEMS, "8 run")
eq(BL:WaitingCount(), 3, "3 wait")
LM:Award(1, "Solex-Sargeras", LM.current.responses[1].key)
local running = LM.current
popup, lifted = nil, 0
buttons["End session"].onClick()
check(popup ~= nil, "a session running: End session asks")
check(popup and popup.text:find("^Are you sure you want to end all loot sessions%?") ~= nil, "the question (" .. tostring(popup and popup.text) .. ")")
check(popup and popup.text:find("7 items are still being decided, and 3 more are waiting to start.", 1, true) ~= nil, "the counts")
eq(popup and popup.acceptText, "End all", "the accept button")
eq(popup and popup.cancelText, "Cancel", "the cancel button")
check(popup and not popup.text:find("%", 1, true), "no % in the text (the game formats it)")
eq(lifted, 1, "the dialog is lifted over CRT's windows")
-- Cancel: the dialog closes, nothing changes
popup = nil
eq(LM.current, running, "Cancel: the session still runs")
eq(BL:WaitingCount(), 3, "Cancel: the waiting items still wait")
-- /crt loot end asks the same
LM:Command("loot end")
check(popup ~= nil and popup.text:find("7 items", 1, true) ~= nil, "/crt loot end asks too")
eq(LM.current, running, "/crt loot end: nothing ends before End all")
-- End all: the session, the waiting chunk and the TEST rows
popup.callback()
eq(LM.current, nil, "End all: no session")
eq(BL:WaitingCount(), 0, "End all: nothing waits")
eq(#BL.waiting, 0, "End all: no waiting chunk")
eq(BL:HasTests(), false, "End all: the TEST rows go")
NOW = NOW + 1
runTimers = function() local due = timers timers = {} for _, t in ipairs(due) do if t.at <= NOW then t.fn() else timers[#timers + 1] = t end end end
runTimers()
eq(LM.current, nil, "End all: nothing starts later")
-- only waiting (a running session's items all given out): asks with the waiting count
for _, id in ipairs(ids) do BL:AddReceived(link(id), kill, true) end
BL:Start()
for i = 1, #LM.current.items do LM:Award(i, "Solex-Sargeras", LM.current.responses[1].key) end
popup = nil
LM:AskEnd()
check(popup and popup.text:find("3 items are waiting to start.", 1, true) ~= nil and not popup.text:find("decided", 1, true), "all given out: only the waiting count (" .. tostring(popup and popup.text) .. ")")
popup.callback()
eq(LM.current, nil, "End all again: no session")

-- the looter window's End session asks too
check(windowSrc:find("LM:AskEnd()", 1, true) ~= nil and not windowSrc:find("TEXT.endSession, function()%s*LM:End%(%)"), "the looter window's End session asks first")

-- Add item ------------------------------------------------------------------------------------------------------------
eq(LM.TradeSecondsFromText(TRADE_TEXT:format("1 hour 52 minutes")), 6720, "trade time: 1 hour 52 minutes")
eq(LM.TradeSecondsFromText(TRADE_TEXT:format("1 hr 5 min")), 3900, "trade time: 1 hr 5 min")
eq(LM.TradeSecondsFromText(TRADE_TEXT:format("45 min")), 2700, "trade time: 45 min")
eq(LM.TradeSecondsFromText(TRADE_TEXT:format("30 sec")), 30, "trade time: 30 sec")
eq(LM.TradeSecondsFromText("no time"), nil, "trade time: no number")
eq(LM.TradeSecondsFromText("3 hours"), LM.TRADE_SECONDS, "trade time: never past 2 hours")
GetLocale = function() return "deDE" end
eq(LM.TradeSecondsFromText("1 Stunde 5 Minuten"), 3900, "another language: hours and minutes by position")
eq(LM.TradeSecondsFromText("40 Minuten"), 2400, "another language: one number is minutes")
GetLocale = function() return "enUS" end

put(0, 1, 301, true, "1 hour 52 minutes") -- a raid drop you can still trade
put(0, 2, 302, true, "45 min")
put(0, 3, 303, true, nil) -- bind on pickup, its trade time over
put(0, 4, 304, true, nil) -- bind on equip, equipped once: soulbound
put(0, 5, 305, false, nil) -- not bound
put(-1, 1, 306, true, "1 hour") -- in the bank
BL:Clear()
-- drag and drop
pickUp(0, 1)
slot.scripts.OnReceiveDrag(slot)
local rows = BL:Rows()
eq(#rows, 1, "drag: the item joins the list")
local r = rows[1]
eq(r and r.link, link(301), "drag: the item")
eq(r and r.status, "won", "drag: won by you")
eq(r and r.ticked, true, "drag: ticked")
eq(r and r.bags, true, "drag: marked from your bags")
eq(r and r.test, nil, "drag: a real row")
eq(r and r.expires, NOW + 6720, "drag: the real trade time")
eq(BL.TradeLeft(r), 6720, "drag: its time left to trade")
check(r and LM.BossLootStatus(r):find("from your bags", 1, true) ~= nil, "drag: the row says from your bags")
eq(cursor, nil, "drag: the cursor is cleared")
eq(BAGS[0][1].isLocked, false, "drag: the item is back in its slot")
check(status():find("Added " .. link(301), 1, true) ~= nil, "drag: the status line says added (" .. status() .. ")")
check(CRTDBChar.lootmaster.bossLootList and CRTDBChar.lootmaster.bossLootList.rows[1].bags == true, "drag: saved for a /reload")
local held = select(2, BL:Held())
eq(held, 1, "drag: counted in Held")
-- the same item again: refused
pickUp(0, 1)
slot.scripts.OnReceiveDrag(slot)
eq(#BL:Rows(), 1, "the same item can't be added twice")
check(status():find("it's already in the list", 1, true) ~= nil, "duplicate: the reason (" .. status() .. ")")
eq(cursor, nil, "duplicate: the cursor is cleared too")
-- a click with nothing on the cursor does nothing
slot.scripts.OnMouseUp(slot)
eq(#BL:Rows(), 1, "a click with no item does nothing")
-- a click with an item on the cursor drops it
pickUp(0, 5)
slot.scripts.OnMouseUp(slot)
eq(#BL:Rows(), 2, "a click with an item on the cursor adds it")
local plain = BL:Rows()[2]
eq(plain.expires, NOW + LM.TRADE_SECONDS, "an item that isn't bound: the usual 2 hours")
eq(plain.ticked, true, "an item outside the loot filter from your bags is still ticked")
-- untradeable items are refused with the reason
pickUp(0, 3)
slot.scripts.OnReceiveDrag(slot)
eq(#BL:Rows(), 2, "trade time over: refused")
check(status():find("its trade time is over", 1, true) ~= nil, "trade time over: the reason (" .. status() .. ")")
pickUp(0, 4)
slot.scripts.OnReceiveDrag(slot)
eq(#BL:Rows(), 2, "soulbound: refused")
check(status():find("it's soulbound", 1, true) ~= nil, "soulbound: the reason (" .. status() .. ")")
-- shift-click in bags
slot.shown = true -- Tonight shows
original = 0
shiftClick(0, 2)
eq(original, 1, "shift-click: the game's own click still runs")
eq(#BL:Rows(), 3, "shift-click with Tonight shown: added")
eq(BL:Rows()[3].expires, NOW + 2700, "shift-click: the real trade time")
BL.rows[3] = nil
chatBox = mock()
shiftClick(0, 2)
eq(#BL:Rows(), 2, "shift-click with a chat box open: not added (the link goes to chat)")
chatBox = nil
focus = mock()
shiftClick(0, 2)
eq(#BL:Rows(), 2, "shift-click while a text box has the keyboard: not added")
focus = nil
slot.shown = false
shiftClick(0, 2)
eq(#BL:Rows(), 2, "shift-click with Tonight hidden: not added")
slot.shown = true
modified = false
HandleModifiedItemClick(BAGS[0][2].hyperlink, location(0, 2))
eq(#BL:Rows(), 2, "another modified click (not shift): not added")
modified = true
shiftClick(-1, 1)
eq(#BL:Rows(), 2, "shift-click in the bank: not added")
check(status():find("it isn't in your bags", 1, true) ~= nil, "bank: the reason (" .. status() .. ")")
HandleModifiedItemClick(link(302), nil)
eq(#BL:Rows(), 2, "a modified click on a link with no bag slot (chat, loot): nothing")
shiftClick(0, 2)
eq(#BL:Rows(), 3, "shift-click again: added")
-- added rows start a session like any other
popup = nil
eq(BL:Start(), 3, "Start session: the added items")
check(LM.current and not LM.current.test, "Start session: a real session")
local inSession = {}
for _, it in ipairs(LM.current and LM.current.items or {}) do inSession[idOf(it.itemString)] = true end
check(inSession[301] and inSession[302] and inSession[305], "Start session: every added item goes out")
-- an item in the running session can't be added again
pickUp(0, 1)
slot.scripts.OnReceiveDrag(slot)
eq(#BL:Rows(), 0, "an item in the running session can't be added again")
LM:AskEnd()
popup.callback()
eq(LM.current, nil, "End all: the real session ends")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Modules/LootMaster/Data.lua', 'CRT_Modules/LootMaster/Comm.lua', 'CRT_Modules/LootMaster/AutoPass.lua',
  'CRT_Modules/LootMaster/Looting.lua', 'CRT_Modules/LootMaster/BossLoot.lua', 'CRT_Modules/LootMaster/EndAll.lua',
  'CRT_Modules/LootMaster/BossLootWindow.lua', 'CRT_Modules/LootMaster/Test.lua', 'CRT_Modules/LootMaster/AddItem.lua',
  'CRT_Modules/LootMaster/Page.lua', 'CRT_Modules/LootMaster/Window.lua'];
for (const f of files) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
