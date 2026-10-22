// Loot Master: End session asks first, and Add item from your bags (CRT_Modules/LootMaster/EndAll.lua, AddItem.lua,
// BossLoot.lua, Page.lua), on stand-in frames and a stand-in game:
//   End: the confirm shows with the open counts, only when a session runs or items wait; Cancel changes nothing; End all
//     ends the session and every waiting chunk (real waiting items go back to Held boss loot, unticked; TEST ones go);
//     Tonight's button, the looter window's and /crt loot end all ask.
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
local dataSrc, commSrc, gateSrc, lootingSrc, bossSrc, endSrc, winSrc, testSrc, addSrc, pageSrc, windowSrc, tradeSrc, slotSrc = ...
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
  [301] = "Bag Helm", [302] = "Bag Ring", [303] = "Old Sword", [304] = "Equipped Cloak", [305] = "Plain Bracers", [306] = "Bank Boots",
  [307] = "Potion", [308] = "Tier Token", [309] = "Trinket", [310] = "Ore", [311] = "Flask", [312] = "Bound Phial", [313] = "Toy" }
-- C_Item.GetItemInfoInstant's equipLoc and classID: gear unless listed here
local KIND = { [307] = { "", 0 }, [308] = { "", 15 }, [310] = { "", 7 }, [311] = { "", 0 }, [312] = { "", 0 }, [313] = { "", 15 } }
local BIND = { [303] = 1, [304] = 2, [312] = 0 } -- bind on pickup, bind on equip, no bind type (soulbound by a quest)
local function link(id, name) return "|cffa335ee|Hitem:" .. id .. "::::::::80:::::|h[" .. (name or NAMES[id]) .. "]|h|r" end
local function idOf(s) return tonumber(tostring(s or ""):match("item:(%d+)")) end
C_Item = {
  GetItemInfo = function(s) local id = idOf(s) if id and NAMES[id] then return NAMES[id], link(id), 4, 250, 0, "Armor", "Plate", 1, "INVTYPE_HEAD", 133000, 0, 4, 4, BIND[id] or 1 end return nil end,
  GetDetailedItemLevelInfo = function() return 250 end,
  GetItemInfoInstant = function(s) local k = KIND[idOf(s)] or { "INVTYPE_HEAD", 4 } return idOf(s), "Armor", "Plate", k[1], 133000, k[2], 4 end,
}
-- the bags: [bag][slot] = item; a bound item's tooltip has the trade time line when tradeLine is set
local BAGS = { [0] = {}, [1] = {}, [-1] = {} }
local function put(bag, slot, id, bound, tradeLine, l, stack)
  BAGS[bag][slot] = { hyperlink = l or link(id), itemID = id, isBound = bound, isLocked = false, stackCount = stack or 1, tradeLine = tradeLine }
end
-- the same item with another specializationID (field 10) and bonus IDs (fields 13 on)
local function linkWith(id, spec, bonus)
  local b = bonus and (#bonus .. ":" .. table.concat(bonus, ":")) or ""
  return "|cffa335ee|Hitem:" .. id .. "::::::::80:" .. spec .. "::3:" .. b .. "|h[" .. NAMES[id] .. "]|h|r"
end
-- the client's time formats and trade time line (its GlobalStrings, enUS)
BIND_TRADE_TIME_REMAINING = "You may trade this item with players that were also eligible to loot this item for the next %s (including time offline)."
D_HOURS, D_MINUTES, D_SECONDS = "%d |4Hour:Hours;", "%d |4Minute:Minutes;", "%d |4Second:Seconds;"
INT_GENERAL_DURATION_HOURS, INT_GENERAL_DURATION_MIN, INT_GENERAL_DURATION_SEC = "%d |4hour:hours;", "%d |4minute:minutes;", "%d |4second:seconds;"
INT_SPELL_DURATION_HOURS, INT_SPELL_DURATION_MIN, INT_SPELL_DURATION_SEC = "%d |4hour:hrs;", "%d min", "%d sec"
HOURS_ABBR, MINUTES_ABBR, SECONDS_ABBR = "%d |4Hr:Hr;", "%d |4Min:Min;", "%d |4Sec:Sec;"
C_Container = {
  GetContainerNumSlots = function(bag) return BAGS[bag] and 16 or 0 end,
  GetContainerItemInfo = function(bag, slot) local it = BAGS[bag] and BAGS[bag][slot] return it end,
}
Enum = { TooltipDataLineType = { ItemName = 22, ItemBinding = 20, TradeTimeRemaining = 36 } }
local TRADE_TEXT = BIND_TRADE_TIME_REMAINING
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
      SetWordWrap = function(self, v) self.wrap = v end,
      SetJustifyH = function(self, v) self.justify = v end,
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
  SpotPicker = function() local s = mock() s.refresh = function() end return s end, SPOT_PICKER_W = 126, SPOT_PICKER_H = 70, SPOT_PICKER_GAP = 12,
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
local filtered = {} -- the items the loot filter was asked about
function LM:FilterLoot(s, source, link) filtered[#filtered + 1] = link if link:find("Belt", 1, true) or link:find("Bracers", 1, true) then return false, "quality" end return true end
LM.Filter = function() return {} end
LM.ItemFacts = function(s) return { isToken = idOf(s) == 308 } end -- a tier token: a Miscellaneous item with a Classes line
LM.PassesFilter = function() return true end
assert(load(testSrc, "Test.lua"))("CowfeeRaidTools", CRT)
assert(load(slotSrc, "ItemSlot.lua"))("CowfeeRaidTools", CRT) -- the shared drop slot (CRT_Core/UI/ItemSlot.lua)
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
local addLabel
for i = #texts, 1, -1 do if texts[i].text == "Add item: drag an item from your bags here, or shift-click it." then addLabel = texts[i] break end end
check(addLabel ~= nil, "Tonight: the Add item line")
-- the line and the status line under it never overlap (the screenshot: the long line wrapped onto the status)
check(addLabel and addLabel.wrap == false, "the Add item line is one line, never wrapped")
check(addLabel and addLabel.width and addLabel.width > #addLabel.text * 6, "the Add item line fits its width (" .. tostring(addLabel and addLabel.width) .. ")")
local addHelp = helps["Add item"]
check(addHelp and addHelp:find("Any item you can still trade", 1, true) ~= nil, "the detail is in the (?): any tradeable item")
check(addHelp and addHelp:find("one copy", 1, true) ~= nil and addHelp:find("split", 1, true) ~= nil, "the (?) says a stack adds one copy, and shift-click on a stack is the game's split")
local statusLine
for _, t in ipairs(texts) do if t.point and t.point[2] == addLabel then statusLine = t end end
check(statusLine ~= nil and statusLine.point[1] == "TOPLEFT" and statusLine.point[3] == "BOTTOMLEFT" and statusLine.point[5] < 0,
  "the status line is anchored under the Add item line's real bottom")
check(statusLine and statusLine.wrap == false, "the status line is one line too")
eq(slot and slot.w, 36, "the slot is 36 px")
check(slot and type(slot.scripts.OnReceiveDrag) == "function", "the slot takes a drag")
check(slot and type(slot.scripts.OnMouseUp) == "function", "the slot takes a click with an item on the cursor")
local function status() for i = #texts, 1, -1 do local t = texts[i].text if type(t) == "string" and (t:find("can't be added", 1, true) or t:find("Added ", 1, true)) then return t end end return "" end

-- End: the line under the question --------------------------------------------------------------------------------------
eq(LM.EndDetail(3, 4, 0), "3 items are still being decided, and 4 more are waiting and go back to Held boss loot.", "detail: deciding and real waiting")
eq(LM.EndDetail(3, 0, 4), "3 items are still being decided, and 4 more are waiting to start.", "detail: deciding and TEST waiting")
eq(LM.EndDetail(1, 0, 0), "1 item is still being decided.", "detail: one deciding")
eq(LM.EndDetail(0, 4, 0), "4 items are waiting and go back to Held boss loot.", "detail: only real waiting")
eq(LM.EndDetail(0, 1, 0), "1 item is waiting and goes back to Held boss loot.", "detail: one real waiting")
eq(LM.EndDetail(0, 0, 1), "1 item is waiting to start.", "detail: one TEST waiting")
eq(LM.EndDetail(2, 1, 0), "2 items are still being decided, and 1 more is waiting and goes back to Held boss loot.", "detail: one more waiting")
eq(LM.EndDetail(2, 1, 3), "2 items are still being decided, 3 more are waiting to start, and 1 more is waiting and goes back to Held boss loot.", "detail: all three")
eq(LM.EndDetail(0, 0, 0), nil, "detail: nothing open")

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

-- End all with a real waiting chunk: its items go back to Held boss loot, unticked, with their times
local realKill = { name = "Big Boss", at = CLOCK, instance = "2810-16" }
local realIds = { 201, 202, 203, 204, 206, 201, 202, 203, 204, 206 }
for _, id in ipairs(realIds) do BL:AddReceived(link(id), realKill) end
eq(BL:Start(), 10, "real: 10 items started")
check(LM.current and not LM.current.test, "real: a real session")
local realWaiting = BL.waiting[1] and BL.waiting[1].items or {}
eq(#realWaiting, 2, "real: 2 wait")
local waitExpires = realWaiting[1] and realWaiting[1].expires
popup = nil
LM:AskEnd()
check(popup and popup.text:find("8 items are still being decided, and 2 more are waiting and go back to Held boss loot.", 1, true) ~= nil,
  "real: the dialog says the waiting items go back (" .. tostring(popup and popup.text) .. ")")
popup.callback()
eq(LM.current, nil, "real End all: no session")
eq(#BL.waiting, 0, "real End all: nothing waits")
eq(#BL:Rows(), 2, "real End all: the 2 waiting items are back in Held boss loot")
for i, r in ipairs(BL:Rows()) do
  eq(r.ticked, false, "real End all: back unticked " .. i)
  eq(r.status, "won", "real End all: still yours " .. i)
  eq(r.expires, waitExpires, "real End all: the time it had left " .. i)
end
eq(BL:StartCount(), 0, "real End all: Start session waits for a tick")
NOW = NOW + 1
runTimers()
eq(LM.current, nil, "real End all: nothing starts later")
check(CRTDBChar.lootmaster.bossLootList and #CRTDBChar.lootmaster.bossLootList.rows == 2, "real End all: kept for a /reload")
BL:Clear()

-- the looter window's End session asks too
check(windowSrc:find("LM:AskEnd()", 1, true) ~= nil and not windowSrc:find("TEXT.endSession, function()%s*LM:End%(%)"), "the looter window's End session asks first")

-- Add item ------------------------------------------------------------------------------------------------------------
-- the trade time, read with the client's own time words
eq(LM.TradeSecondsFromText(TRADE_TEXT:format("1 hour 52 minutes")), 6720, "trade time: 1 hour 52 minutes")
eq(LM.TradeSecondsFromText(TRADE_TEXT:format("1 Hr 5 Min")), 3900, "trade time: 1 Hr 5 Min")
eq(LM.TradeSecondsFromText(TRADE_TEXT:format("1 hrs 5 min")), 3900, "trade time: 1 hrs 5 min")
eq(LM.TradeSecondsFromText(TRADE_TEXT:format("45 Minutes")), 2700, "trade time: 45 Minutes")
eq(LM.TradeSecondsFromText(TRADE_TEXT:format("30 sec")), 30, "trade time: 30 sec")
eq(LM.TradeSecondsFromText(TRADE_TEXT:format("3 hours")), LM.TRADE_SECONDS, "trade time: never past 2 hours")
eq(LM.TradeSecondsFromText(TRADE_TEXT:format("1 fortnight")), nil, "trade time: an unknown word is not read")
eq(LM.TradeSecondsFromText(TRADE_TEXT:format("90")), nil, "trade time: a number with no word is not read")
eq(LM.TradeSecondsFromText("Something else 1 hour"), nil, "trade time: another line is not read")
eq(LM.TradeSecondsFromText(TRADE_TEXT:format("soon")), nil, "trade time: no number")
local enTemplate, enH, enM = BIND_TRADE_TIME_REMAINING, D_HOURS, D_MINUTES
BIND_TRADE_TIME_REMAINING, D_HOURS, D_MINUTES = "Handelbar noch %s.", "%d |4Stunde:Stunden;", "%d |4Minute:Minuten;"
eq(LM.TradeSecondsFromText("Handelbar noch 1 Stunde 5 Minuten."), 3900, "another language: the client's own words")
local enHA, enMA = HOURS_ABBR, MINUTES_ABBR
HOURS_ABBR, MINUTES_ABBR = "%d |4Std.:Std.;", "%d |4Min.:Min.;"
eq(LM.TradeSecondsFromText("Handelbar noch 1 Std. 5 Min.."), 3900, "an abbreviated unit with a full stop: Std.")
HOURS_ABBR, MINUTES_ABBR = enHA, enMA
BIND_TRADE_TIME_REMAINING = nil
eq(LM.TradeSecondsFromText(TRADE_TEXT:format("1 hour")), nil, "no trade line format in the client: not read")
BIND_TRADE_TIME_REMAINING, D_HOURS, D_MINUTES = enTemplate, enH, enM

put(0, 1, 301, true, "1 hour 52 minutes") -- a raid drop you can still trade
put(0, 2, 302, true, "45 min")
put(0, 3, 303, true, nil) -- bind on pickup, its trade time over
put(0, 4, 304, true, nil) -- bind on equip, equipped once: soulbound
put(0, 5, 305, false, nil) -- not bound
put(-1, 1, 306, true, "1 hour") -- in the bank
put(0, 7, 307, false, nil, nil, 5) -- a stack of potions
put(0, 8, 308, true, "1 hour") -- a tier token
put(0, 9, 309, true, "until later") -- a trade time line CRT can't read
put(0, 10, 307, false, nil) -- one potion
put(0, 11, 310, false, nil) -- crafting material
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
-- the same item after a spec change (another specializationID in its link): still the same item
put(0, 1, 301, true, "1 hour 52 minutes", linkWith(301, 577))
pickUp(0, 1)
slot.scripts.OnReceiveDrag(slot)
eq(#BL:Rows(), 1, "the same item with another specID: refused")
check(status():find("it's already in the list", 1, true) ~= nil, "another specID: the reason (" .. status() .. ")")
put(0, 1, 301, true, "1 hour 52 minutes")
eq(LM.ItemKey(linkWith(301, 577, { 12, 10 })), "301:10:12", "item key: the item ID and its sorted bonus IDs")
eq(LM.ItemKey(linkWith(301, 0, { 10, 12 })), LM.ItemKey(linkWith(301, 250, { 12, 10 })), "item key: linkLevel and specID left out")
check(LM.ItemKey(linkWith(301, 0, { 10 })) ~= LM.ItemKey(linkWith(301, 0, { 11 })), "item key: other bonus IDs are another item")
eq(LM.ItemKey(link(301)), "301", "item key: the item ID when there are no bonus IDs")
-- a row won by someone else doesn't count: the same item from your bags goes in
BL:Clear()
local realKill2 = { name = "Big Boss", at = CLOCK, instance = "2810-16" }
BL:Add(1, link(301), { status = "rolling", rollType = 1 }, realKill2)
BL:Result(link(301), "Other-Sargeras", false, false)
pickUp(0, 1)
slot.scripts.OnReceiveDrag(slot)
eq(#BL:Rows(), 2, "a row someone else won doesn't block the item")
BL:Clear()
pickUp(0, 1)
slot.scripts.OnReceiveDrag(slot)
eq(#BL:Rows(), 1, "added again after Clear")
-- a click with nothing on the cursor does nothing
slot.scripts.OnMouseUp(slot)
eq(#BL:Rows(), 1, "a click with no item does nothing")
-- a click with an item on the cursor drops it; an item that isn't bound has no trade time
printed = {}
pickUp(0, 5)
slot.scripts.OnMouseUp(slot)
eq(#BL:Rows(), 2, "a click with an item on the cursor adds it")
local plain = BL:Rows()[2]
eq(plain.untimed, true, "not bound: no trade time")
eq(plain.expires, NOW + LM.TRADE_SECONDS, "not bound: its own end, 2 hours after it was added")
eq(BL.TradeLeft(plain), nil, "not bound: no time left to show")
check(LM.BossLootDetail(plain):find("Not bound: leaves in 2h 00m", 1, true) ~= nil, "not bound: its own wording (" .. LM.BossLootDetail(plain) .. ")")
eq(plain.ticked, true, "an item outside the loot filter from your bags is still ticked")
eq(plain.pass, true, "an item from your bags is the leader's own choice: kept out of the loot filter")
local askedFilter = false
for _, l in ipairs(filtered) do if l == link(305) then askedFilter = true end end
eq(askedFilter, false, "an item from your bags: the loot filter isn't asked (no skip, no chat line)")
local keptPlain
for _, c in ipairs(CRTDBChar.lootmaster.bossLootList.rows) do if c.untimed then keptPlain = c end end
check(keptPlain ~= nil and keptPlain.endsAt == CLOCK + LM.TRADE_SECONDS, "not bound: kept for a /reload with its end")
-- a trade time line CRT can't read: the full 2 hours
pickUp(0, 9)
slot.scripts.OnReceiveDrag(slot)
eq(#BL:Rows(), 3, "an unread trade time: added")
eq(BL:Rows()[3] and BL:Rows()[3].expires, NOW + LM.TRADE_SECONDS, "an unread trade time: the full 2 hours")
-- the unbound row: no warning, a countdown, and it leaves at its own end; the chat line counts it
NOW = NOW + LM.TRADE_SECONDS - LM.TRADE_WARN + 1
runTimers()
local warned = 0
for _, m in ipairs(printed) do if m:find("Plain Bracers", 1, true) then warned = warned + 1 end end
eq(warned, 0, "not bound: no trade time warning")
eq(#BL:Rows(), 3, "not bound: still listed before its end")
check(LM.BossLootDetail(plain):find("Not bound: leaves in 15m", 1, true) ~= nil, "not bound: the countdown (" .. LM.BossLootDetail(plain) .. ")")
printed = {}
NOW = NOW + LM.TRADE_WARN + 10
runTimers()
eq(#BL:Rows(), 0, "not bound: gone at its end, with the other rows whose time is over")
eq(printed[1], "Loot Master: 2 won items left the boss loot list: the game's 2 hours to trade them are over.", "the expiry chat line for the rows with a trade time")
eq(printed[2], "Loot Master: 1 unbound item left the boss loot list: its time on the list is over.", "the unbound row's own chat line")
-- added alone: it still leaves
BL:Clear()
pickUp(0, 5)
slot.scripts.OnMouseUp(slot)
eq(#BL:Rows(), 1, "not bound alone: added")
NOW = NOW + LM.TRADE_SECONDS + 1
runTimers()
eq(#BL:Rows(), 0, "not bound alone: leaves at its end")
eq(CRTDBChar.lootmaster.bossLootList, nil, "not bound alone: nothing kept for the next login")
-- the timed rows leave through Start: the unbound row still leaves at its end
pickUp(0, 1)
slot.scripts.OnReceiveDrag(slot)
pickUp(0, 5)
slot.scripts.OnMouseUp(slot)
local alone = BL:Rows()[2]
BL:SetTicked(alone.rollID, false)
eq(BL:Start(), 1, "Start: the timed row goes out")
eq(BL:Rows()[1], alone, "Start: the unbound row stays")
LM:EndAll()
NOW = NOW + LM.TRADE_SECONDS + 1
runTimers()
eq(#BL:Rows(), 0, "not bound after Start: leaves at its end")
-- a /reload with only unbound rows saved: back with the time left, and one whose time is over is dropped
CRTDBChar.lootmaster.bossLootList = { rows = {
  { link = link(305), itemString = "item:305", status = "won", ticked = true, pass = true, bags = true, untimed = true, endsAt = CLOCK + 600 },
  { link = link(305), itemString = "item:305", status = "won", ticked = true, pass = true, bags = true, untimed = true, endsAt = CLOCK - 5 },
}, waiting = {} }
printed = {}
BL:Load()
eq(#BL:Rows(), 1, "load: the unbound row with time left is back")
eq(BL:Rows()[1] and BL:Rows()[1].expires, NOW + 600, "load: with the time it had left")
eq(printed[1], "Loot Master: 1 unbound item left the boss loot list: its time on the list is over.", "load: the one whose time is over is said in chat")
NOW = NOW + 601
runTimers()
eq(#BL:Rows(), 0, "load: the unbound row leaves at its end")
eq(CRTDBChar.lootmaster.bossLootList, nil, "load: nothing kept after it left")
-- what goes in: any item you can still trade, gear or not
put(0, 12, 311, false, nil, nil, 3) -- a stack of 3 flasks
put(0, 13, 312, true, nil) -- a soulbound phial: no trade time line
put(0, 14, 313, false, nil) -- a toy
pickUp(0, 8)
slot.scripts.OnReceiveDrag(slot)
eq(#BL:Rows(), 1, "a tier token: added")
local function countOf(id) local n = 0 for _, row in ipairs(BL:Rows()) do if idOf(row.itemString) == id then n = n + 1 end end return n end
-- a flask from a stack of 3: one row per drag, up to the 3 you have
filtered = {}
for i = 1, 3 do
  pickUp(0, 12)
  slot.scripts.OnReceiveDrag(slot)
  eq(countOf(311), i, "a flask stack: drag " .. i .. " adds one row")
  check(status():find("Added " .. link(311), 1, true) ~= nil, "a flask stack: drag " .. i .. " says added (" .. status() .. ")")
  eq(cursor, nil, "a flask stack: the stack goes back to its slot " .. i)
end
pickUp(0, 12)
slot.scripts.OnReceiveDrag(slot)
eq(countOf(311), 3, "a flask stack: never more rows than the 3 you have")
check(status():find("it's already in the list", 1, true) ~= nil, "a flask stack: the 4th drag is refused (" .. status() .. ")")
local flask = BL:Rows()[2]
eq(flask and flask.untimed, true, "a flask that isn't bound: no trade time")
eq(flask and flask.ticked, true, "a flask: ticked")
eq(flask and flask.pass, true, "a flask: not held to the loot filter")
eq(#filtered, 0, "items from your bags never go through the loot filter")
-- a potion: a stack of 5 and one alone, 6 in all, each drag one copy
pickUp(0, 10)
slot.scripts.OnReceiveDrag(slot)
eq(countOf(307), 1, "a single potion: added")
for i = 1, 5 do
  pickUp(0, 7)
  slot.scripts.OnReceiveDrag(slot)
end
eq(countOf(307), 6, "a potion stack: one row per drag, 6 for the 6 you have")
pickUp(0, 7)
slot.scripts.OnReceiveDrag(slot)
eq(countOf(307), 6, "a potion stack: the 7th drag is refused")
check(status():find("it's already in the list", 1, true) ~= nil, "a potion stack: the reason (" .. status() .. ")")
-- a crafting material and a toy go in too
pickUp(0, 11)
slot.scripts.OnReceiveDrag(slot)
eq(countOf(310), 1, "a crafting material: added")
pickUp(0, 14)
slot.scripts.OnReceiveDrag(slot)
eq(countOf(313), 1, "a toy: added")
-- a bound consumable you can't trade is still refused
pickUp(0, 13)
slot.scripts.OnReceiveDrag(slot)
eq(countOf(312), 0, "a soulbound phial: refused")
check(status():find("it's soulbound", 1, true) ~= nil, "a soulbound phial: the reason (" .. status() .. ")")
check(not status():find("gear", 1, true), "no word of gear only")
BL:Clear()
pickUp(0, 5)
slot.scripts.OnMouseUp(slot)
-- untradeable items are refused with the reason
pickUp(0, 3)
slot.scripts.OnReceiveDrag(slot)
eq(#BL:Rows(), 1, "trade time over: refused")
check(status():find("its trade time is over", 1, true) ~= nil, "trade time over: the reason (" .. status() .. ")")
pickUp(0, 4)
slot.scripts.OnReceiveDrag(slot)
eq(#BL:Rows(), 1, "soulbound: refused")
check(status():find("it's soulbound", 1, true) ~= nil, "soulbound: the reason (" .. status() .. ")")
pickUp(0, 1)
slot.scripts.OnReceiveDrag(slot)
eq(#BL:Rows(), 2, "the raid drop again")
-- shift-click in bags
slot.shown = true -- Tonight shows
original = 0
shiftClick(0, 2)
eq(original, 1, "shift-click: the game's own click still runs")
eq(#BL:Rows(), 3, "shift-click with Tonight shown: added")
eq(BL:Rows()[3] and BL:Rows()[3].expires, NOW + 2700, "shift-click: the real trade time")
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
local before = status()
shiftClick(-1, 1)
eq(#BL:Rows(), 2, "shift-click in the bank: not added")
eq(status(), before, "shift-click in the bank: the status line stays as it was")
HandleModifiedItemClick(link(302), nil)
eq(#BL:Rows(), 2, "a modified click on a link with no bag slot (chat, loot): nothing")
-- a stack: left to the game's split, with no error (the (?) says to drag a stack)
original = 0
before = status()
shiftClick(0, 7)
eq(original, 1, "shift-click on a stack: the game's click (its split) still runs")
eq(#BL:Rows(), 2, "shift-click on a stack: nothing added")
eq(status(), before, "shift-click on a stack: no error on the status line")
slot.shown = false
shiftClick(0, 7)
eq(status(), before, "shift-click on a stack with Tonight hidden: no word")
slot.shown = true
-- a single consumable shift-clicks in like gear
shiftClick(0, 10)
eq(#BL:Rows(), 3, "shift-click on one potion: added")
BL.rows[3] = nil
-- a failing hook body is reported, and the game's click still works
local realShift, reported = LM.BagShiftClick, {}
LM.BagShiftClick = function() error("boom") end
local realHandler = geterrorhandler
geterrorhandler = function() return function(e) reported[#reported + 1] = e end end
original = 0
local okClick, ret = pcall(HandleModifiedItemClick, BAGS[0][2].hyperlink, location(0, 2))
check(okClick, "a failing hook: the click raises no error")
eq(original, 1, "a failing hook: the game's click ran")
eq(ret, false, "a failing hook: the game's answer is kept")
eq(#reported, 1, "a failing hook: the error is reported")
geterrorhandler, LM.BagShiftClick = realHandler, realShift
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

-- a flask stack in a session: each row is one copy, and the trade gives one copy (the game's split of 1)
assert(load(tradeSrc, "Trade.lua"))("CowfeeRaidTools", CRT)
local tradeEvents
for _, f in ipairs(frames) do if f.events and f.events.TRADE_SHOW then tradeEvents = f end end
local picked, split, clicked = {}, {}, {}
-- the game's side: a pickup or split puts the item on the cursor, the trade slot takes it off
local pickupWorks, splitWorks, tradeTakes, clickFails = true, true, true, false
C_Container.PickupContainerItem = function(bag, s) picked[#picked + 1] = bag .. ":" .. s if pickupWorks then cursor = BAGS[bag][s].hyperlink end end
C_Container.SplitContainerItem = function(bag, s, n) split[#split + 1] = bag .. ":" .. s .. "x" .. n if splitWorks then cursor = BAGS[bag][s].hyperlink end end
InitiateTrade = function() end
GetTradePlayerItemLink = function() return nil end
ClickTradeButton = function(i) clicked[#clicked + 1] = i if clickFails then error("boom") end if tradeTakes then cursor = nil end end
GetUnitName = function() return "Other-Sargeras" end
local realUnitOf = LM.UnitOf
LM.UnitOf = function() return "raid2" end
local function trade(index)
  printed, picked, split, clicked = {}, {}, {}, {}
  LM:TradeItem(index)
  tradeEvents.scripts.OnEvent(tradeEvents, "TRADE_SHOW")
end
local function said(words) for _, m in ipairs(printed) do if m:find(words, 1, true) then return true end end return false end
BL:Clear()
pickUp(0, 12) slot.scripts.OnReceiveDrag(slot)
pickUp(0, 12) slot.scripts.OnReceiveDrag(slot)
pickUp(0, 5) slot.scripts.OnMouseUp(slot)
eq(BL:Start(), 3, "Start session: two flasks and the bracers")
local items = LM.current and LM.current.items or {}
eq(#items, 3, "the session: one item per row")
eq(idOf(items[1] and items[1].itemString), 311, "the session: the first flask")
eq(idOf(items[2] and items[2].itemString), 311, "the session: the second flask, its own item")
LM:Award(1, "Other-Sargeras", LM.current.responses[1].key)
LM:Award(3, "Other-Sargeras", LM.current.responses[1].key)
trade(1)
eq(split[1], "0:12x1", "the trade: one flask split off the stack")
eq(#picked, 0, "the trade: never the whole stack")
eq(clicked[1], 1, "the trade: into the first free slot")
check(said("is in the trade window"), "the trade: placed")
eq(cursor, nil, "the trade: nothing left on the cursor")
trade(3)
eq(picked[1], "0:5", "the trade: a single item is picked up as it is")
eq(#split, 0, "the trade: no split for a single item")
check(said("is in the trade window"), "the trade: the single item placed")
-- a split that leaves the cursor empty: no click, the failure line, never "placed"
splitWorks = false
trade(1)
eq(#clicked, 0, "a split that put nothing on the cursor: the trade slot isn't clicked")
check(said("couldn't take one"), "a split that put nothing on the cursor: the failure line")
check(not said("is in the trade window"), "a split that put nothing on the cursor: not placed")
splitWorks = true
-- a pickup that leaves the cursor empty: the same for a single item
pickupWorks = false
trade(3)
eq(#clicked, 0, "a pickup that put nothing on the cursor: the trade slot isn't clicked")
check(said("couldn't pick up"), "a pickup that put nothing on the cursor: the failure line")
check(not said("is in the trade window"), "a pickup that put nothing on the cursor: not placed")
pickupWorks = true
-- the trade slot leaves the item on the cursor: it goes back to the bags, and the line says so
tradeTakes = false
trade(1)
eq(cursor, nil, "a flask the trade didn't take: the cursor is cleared (back in its slot)")
check(said("couldn't be put in the trade"), "a flask the trade didn't take: the failure line")
check(not said("is in the trade window"), "a flask the trade didn't take: not placed")
trade(3)
eq(cursor, nil, "a single item the trade didn't take: the cursor is cleared")
check(said("couldn't be put in the trade"), "a single item the trade didn't take: the failure line")
tradeTakes = true
-- an error halfway (the trade slot's call fails with the item on the cursor): the cursor is cleared
clickFails = true
trade(1)
eq(cursor, nil, "an error in the trade with a split flask: the cursor is cleared")
check(said("could not be opened"), "an error in the trade: said in chat")
trade(3)
eq(cursor, nil, "an error in the trade with a single item: the cursor is cleared")
clickFails = false
-- a stack size that can't be read: nothing goes in, never the whole stack
BAGS[0][12].stackCount = nil
trade(1)
eq(#picked + #split + #clicked, 0, "an unread stack size: nothing picked up or put in")
check(said("couldn't read how many"), "an unread stack size: the line says why")
BAGS[0][12].stackCount = 3
issecretvalue = function(v) return v == 3 end
trade(1)
eq(#picked + #split + #clicked, 0, "a secret stack size: nothing picked up or put in")
issecretvalue = nil
LM.UnitOf = realUnitOf
LM:AskEnd()
if popup then popup.callback() end

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Modules/LootMaster/Data.lua', 'CRT_Modules/LootMaster/Comm.lua', 'CRT_Modules/LootMaster/AutoPass.lua',
  'CRT_Modules/LootMaster/Looting.lua', 'CRT_Modules/LootMaster/BossLoot.lua', 'CRT_Modules/LootMaster/EndAll.lua',
  'CRT_Modules/LootMaster/BossLootWindow.lua', 'CRT_Modules/LootMaster/Test.lua', 'CRT_Modules/LootMaster/AddItem.lua',
  'CRT_Modules/LootMaster/Page.lua', 'CRT_Modules/LootMaster/Window.lua', 'CRT_Modules/LootMaster/Trade.lua', 'CRT_Core/UI/ItemSlot.lua'];
for (const f of files) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
