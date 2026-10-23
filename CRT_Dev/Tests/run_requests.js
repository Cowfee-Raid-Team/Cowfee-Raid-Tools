// Requests (CRT_Modules/Requests/): ask the raid who needs an item, trade one to each. Several CRTs in one raid,
// each its own copy of the files, every addon message handed to every one of them, on stand-in frames:
//   the ask, answer and close messages on Loot Master's prefix, round trip and version (a later major version is
//   skipped, a later minor one read); only the raid leader or an assist (or anyone out of a group) can ask, and a
//   raider takes an ask only from one; answers only from group members for the open request; a frozen 1.1.0
//   client (CRT_Dev/Tests/old_Comm.lua) drops the new kinds; the chat lockdown refuses an ask with red error text;
//   the status line's counts; the raider popup's buttons, its item tooltip, and Close request closing it; the
//   page's item slot (the shared UI.ItemDropSlot); Trade 1 opens a trade and puts one copy in through
//   LootMaster/Trade.lua; Given counts only a completed trade with the item still in it; Trade 1 greys with
//   none left and reads Done once given; Loot Master's double-click trade still works.
// Usage: node run_requests.js <addon folder>
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local slotSrc, lmDataSrc, commSrc, addSrc, tradeSrc, dataSrc, popupSrc, pageSrc, oldCommSrc, panelSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
Ambiguate = function(n) return (n:gsub("%-.*$", "")) end
strtrim = function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
local CLOCK = 100
GetTime = function() return CLOCK end
time = function() return 1790000000 + CLOCK end
local timers = {}
C_Timer = { After = function(s, fn) timers[#timers + 1] = { at = CLOCK + s, fn = fn } end,
  NewTicker = function(s, fn) local t = { every = s, fn = fn } t.Cancel = function() t.cancelled = true end return t end }
local function advance(s)
  local target = CLOCK + s
  while true do
    table.sort(timers, function(a, b) return a.at < b.at end)
    local t = timers[1]
    if not t or t.at > target then break end
    table.remove(timers, 1)
    CLOCK = t.at
    t.fn()
  end
  CLOCK = target
end

-- one raid on Sargeras: Solex leads, Assist is an assistant, Quick and Old are raiders (Old runs 1.1.0)
local ME = "Solex"
local NAMES = { "Solex", "Quick", "Assist", "Old" }
local grouped, raid = true, true
UnitName = function(u)
  if u == "player" then return ME end
  local i = tonumber((u or ""):match("^raid(%d+)$")) or tonumber((u or ""):match("^party(%d+)$"))
  return i and NAMES[i]
end
UnitFullName = UnitName
UnitClass = function() return "Paladin", "PALADIN" end
local function unitName(u) return u == "player" and ME or UnitName(u) end
UnitIsGroupLeader = function(u) return grouped and unitName(u) == "Solex" end
local assistSecret = false
UnitIsGroupAssistant = function(u) if assistSecret then return "SECRET" end return grouped and raid and unitName(u) == "Assist" end
issecretvalue = function(v) return v == "SECRET" end
GetNormalizedRealmName = function() return "Sargeras" end
LE_PARTY_CATEGORY_INSTANCE = 2
IsInGroup = function(c) return grouped and c == nil end
IsInRaid = function() return grouped and raid end
GetNumGroupMembers = function() return grouped and #NAMES or 0 end
GetNumSubgroupMembers = function() return grouped and #NAMES - 1 or 0 end
GetRaidRosterInfo = function(i) return NAMES[i] end
IsInGuild = function() return false end
InCombatLockdown = function() return false end
NUM_BAG_SLOTS = 4
ERR_TRADE_COMPLETE = "Trade complete."
CRTDBChar = {}

-- items
local RUNE, FLASK, BOUND = 250001, 250002, 250003
local INAMES = { [RUNE] = "Vantus Rune", [FLASK] = "Flask", [BOUND] = "Bound Phial" }
local function link(id) return "|cff0070dd|Hitem:" .. id .. "::::::::80:::::|h[" .. INAMES[id] .. "]|h|r" end
local function idOf(s) return tonumber(tostring(s or ""):match("item:(%d+)")) end
C_Item = {
  GetItemInfo = function(s) local id = idOf(s) if id and INAMES[id] then return INAMES[id], link(id) end return nil end,
  GetItemInfoInstant = function(s) local id = idOf(s) return id, "Consumable", "Other", "", 4000 + (id or 0), 0, 0 end,
}
Item = { CreateFromItemID = function() return { IsItemDataCached = function() return true end, ContinueOnItemLoad = function(_, fn) fn() end } end }
Enum = { TooltipDataLineType = { TradeTimeRemaining = 36 } }
C_TooltipInfo = { GetBagItem = function() return { lines = {} } end }
-- each player's bags: BAGS[name][bag][slot]
local BAGS = { Solex = { [0] = {} }, Quick = { [0] = {} }, Assist = { [0] = {} } }
local function put(who, bag, slot, id, stack, bound)
  BAGS[who][bag] = BAGS[who][bag] or {}
  BAGS[who][bag][slot] = { hyperlink = link(id), itemID = id, stackCount = stack or 1, isBound = bound or false, isLocked = false }
end
local function bags() return BAGS[ME] or {} end
local cursor
C_Container = {
  GetContainerNumSlots = function(bag) return bags()[bag] and 16 or 0 end,
  GetContainerItemInfo = function(bag, slot) return bags()[bag] and bags()[bag][slot] end,
}
GetCursorInfo = function() if cursor then return "item", idOf(cursor.hyperlink), cursor.hyperlink end return nil end
ClearCursor = function() cursor = nil for _, b in pairs(bags()) do for _, it in pairs(b) do it.isLocked = false end end end
local function pickUp(bag, slot) local it = bags()[bag][slot] it.isLocked = true cursor = { hyperlink = it.hyperlink } end
-- the trade
local initiated, tradeWith, TRADE, split = {}, nil, {}, {}
InitiateTrade = function(unit) initiated[#initiated + 1] = unit end
GetUnitName = function(u) if u == "NPC" then return tradeWith end end
GetTradePlayerItemLink = function(i) return TRADE[i] end
C_Container.SplitContainerItem = function(bag, slot, n) split[#split + 1] = bag .. ":" .. slot .. "x" .. n cursor = { hyperlink = bags()[bag][slot].hyperlink, n = n } end
C_Container.PickupContainerItem = function(bag, slot) split[#split + 1] = bag .. ":" .. slot cursor = { hyperlink = bags()[bag][slot].hyperlink, n = 1 } end
ClickTradeButton = function(i) if cursor then TRADE[i] = cursor.hyperlink cursor = nil end end
-- red error text, the tooltip, the keyboard
local errors = {}
UIErrorsFrame = { AddMessage = function(_, text) errors[#errors + 1] = text end }
local tip = { lines = {} }
GameTooltip = { SetOwner = function(self, o, a) self.owner, self.anchor = o, a end, SetHyperlink = function(self, l) self.link = l end,
  Show = function(self) self.shown = true end, Hide = function(self) self.shown = false end, ClearAllPoints = function() end, SetPoint = function() end }
IsModifiedClick = function(what) return what == "CHATLINK" end
GetCurrentKeyBoardFocus = function() return nil end
ChatFrameUtil = { GetActiveWindow = function() return nil end }
HandleModifiedItemClick = function() return false end
hooksecurefunc = function(a, b, c)
  if type(a) == "string" then local old = _G[a] _G[a] = function(...) local r = old(...) b(...) return r end
  else local old = a[b] a[b] = function(...) local r = old(...) c(...) return r end end
end
UISpecialFrames = {}
tinsert = table.insert
-- addon messages: every one sent, with who sent it; result is what the game answers next
local outbox, result, locked = {}, 0, false
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, InChatMessagingLockdown = function() return locked end,
  SendAddonMessage = function(prefix, text) if result ~= 0 then local r = result result = 0 return r end outbox[#outbox + 1] = { prefix = prefix, text = text, from = ME } return 0 end }

-- stand-in frames
local made -- the frames the CRT being booted makes
local function mock()
  local o = { shown = false, enabled = true, scripts = {}, events = {} }
  return setmetatable(o, { __index = function(t, k)
    local m = ({
      SetText = function(self, v) self.text = v end,
      GetText = function(self) return self.text end,
      Show = function(self) self.shown = true if self.scripts.OnShow then self.scripts.OnShow(self) end end,
      Hide = function(self) local was = self.shown self.shown = false if was and self.scripts.OnHide then self.scripts.OnHide(self) end end,
      IsShown = function(self) return self.shown end,
      IsVisible = function(self) return self.shown and (not self.parent or self.parent:IsVisible()) end,
      SetShown = function(self, v) if v then self:Show() else self:Hide() end end,
      SetEnabled = function(self, v) self.enabled = v and true or false end,
      IsEnabled = function(self) return self.enabled end,
      SetScript = function(self, name, fn) self.scripts[name] = fn end,
      HookScript = function(self, name, fn) local old = self.scripts[name] self.scripts[name] = function(...) if old then old(...) end fn(...) end end,
      RegisterEvent = function(self, e) self.events[e] = true end,
      SetSize = function(self, w, h) self.w, self.h = w, h end,
      SetWidth = function(self, w) self.w = w end,
      GetWidth = function(self) return self.w or 0 end,
      SetPoint = function(self, ...) self.point = { ... } end,
      SetTexture = function(self, v) self.texture = v end,
      SetTextColor = function(self, r, g, b) self.color = { r, g, b } end,
      CreateTexture = function(self) local x = mock() x.parent = self x.shown = true return x end,
      CreateFontString = function(self) local x = mock() x.parent = self x.shown = true return x end,
      GetStringWidth = function(self) return #(self.text or "") * 6 end,
      GetFontString = function(self) local x = mock() x.text = self.text return x end,
      GetFrameLevel = function() return 1 end,
    })[k]
    if m then return m end
    if type(k) == "string" and k:match("^%u") then return function() end end
    return nil
  end })
end
CreateFrame = function(_, name, parent) local f = mock() f.parent = parent f.name = name if made then made[#made + 1] = f end return f end
UIParent = mock()

-- a CRT with Requests: its own CRT table, UI stand-ins and frames
local function boot(name)
  made = {}
  local windows, buttons, helps, pages = {}, {}, {}, {}
  local UI = {
    PAGE_W = 1026, PAGE_H = 560,
    Window = function(wname, opts) local w = mock() w.name, w.opts = wname, opts w.content = mock() w.content.parent = w w.strip = mock() w.CloseButton = mock() windows[wname] = w return w end,
    PanelButton = function(parent, label, h, onClick)
      local b = mock() b.parent, b.label, b.text, b.h, b.shown = parent, label, label, h, true
      b.scripts.OnClick = onClick
      b.w = math.max(40, #label * 6 + 28)
      buttons[#buttons + 1] = b return b
    end,
    PanelButtonWidth = function(w) return math.max(40, math.ceil(w) + 28) end,
    Help = function(p, title, text) helps[title] = text local h = mock() h.shown = true return h end,
    RegisterPage = function(_, key, title, build) pages[key] = { title = title, build = build } end,
    IsModern = function() return true end,
  }
  local CRT = { UI = UI, db = { ui = {}, lootmaster = { authority = { leader = true, names = {} } } } }
  local printed = {}
  function CRT:Print(m) printed[#printed + 1] = m end
  CRT.Groups = { Normalize = function(n) if not n:find("-") then return n .. "-Sargeras" end return n end }
  CRT_THEME(CRT, UI)
  local prevMe = ME
  ME = name
  for _, src in ipairs({ slotSrc, lmDataSrc, commSrc, addSrc, tradeSrc, dataSrc, popupSrc, pageSrc }) do assert(load(src))("CowfeeRaidTools", CRT) end
  ME = prevMe
  local p = { name = name, full = name .. "-Sargeras", CRT = CRT, R = CRT.Requests, LM = CRT.LootMaster, UI = UI, windows = windows,
    buttons = buttons, helps = helps, pages = pages, printed = printed, on = {}, frames = made }
  for _, f in ipairs(made) do
    if f.events.CHAT_MSG_ADDON then p.on[#p.on + 1] = f.scripts.OnEvent end
    if f.events.TRADE_SHOW then p.trade = f end
  end
  made = nil
  return p
end
-- 1.1.0: Loot Master's Comm only, no Requests
local function bootOld(name)
  made = {}
  local CRT = { db = { lootmaster = { authority = { leader = true, names = {} } } } }
  function CRT:Print() end
  CRT.Groups = { Normalize = function(n) if not n:find("-") then return n .. "-Sargeras" end return n end }
  assert(load(lmDataSrc))("CowfeeRaidTools", CRT)
  local LM = CRT.LootMaster
  function LM:MyRole() return "D" end
  function LM:MyItemLevel() return "285.0" end
  function LM:MyGear() return {} end
  assert(load(oldCommSrc))("CowfeeRaidTools", CRT)
  local p = { name = name, full = name .. "-Sargeras", CRT = CRT, LM = LM, on = {}, old = true }
  for _, f in ipairs(made) do if f.events.CHAT_MSG_ADDON then p.on[#p.on + 1] = f.scripts.OnEvent end end
  made = nil
  return p
end
local function as(p, fn) local prev = ME ME = p.name local r = { fn() } ME = prev return table.unpack(r) end
local everyone
local function deliver()
  while #outbox > 0 do
    local box = outbox outbox = {}
    for _, m in ipairs(box) do
      for _, p in ipairs(everyone) do
        as(p, function() for _, fn in ipairs(p.on) do fn(nil, "CHAT_MSG_ADDON", m.prefix, m.text, "RAID", m.from) end end)
      end
    end
  end
end
-- one message straight to one CRT, as if from sender
local function hand(p, text, sender)
  as(p, function() for _, fn in ipairs(p.on) do fn(nil, "CHAT_MSG_ADDON", p.LM.PREFIX, text, "RAID", sender) end end)
end
local function kinds() local out = {} for _, m in ipairs(outbox) do out[#out + 1] = m.text:sub(1, 1) end return table.concat(out) end
local function button(p, label) for _, b in ipairs(p.buttons) do if b.label == label then return b end end end
local function click(p, b) as(p, function() b.scripts.OnClick(b) end) end

local solex, quick, assist, old = boot("Solex"), boot("Quick"), boot("Assist"), bootOld("Old")
everyone = { solex, quick, assist, old }
local R = solex.R
check(R ~= nil, "CRT.Requests exists")
eq(R.KIND.ask .. R.KIND.answer .. R.KIND.close, "NWZ", "the message kinds: N ask, W answer, Z close")
for _, k in ipairs({ "S", "B", "I", "Q", "L", "A", "E", "K", "Y", "R", "G", "U", "M", "O", "F", "H", "X" }) do
  check(R.KIND.ask ~= k and R.KIND.answer ~= k and R.KIND.close ~= k, "no clash with Loot Master's kind " .. k)
end

-- 1. Who can ask ------------------------------------------------------------------------------------------------
check(as(solex, function() return R:CanAsk() end), "the raid leader can ask")
check(as(assist, function() return assist.R:CanAsk() end), "an assist can ask")
check(not as(quick, function() return quick.R:CanAsk() end), "a raider can't")
assistSecret = true
check(not as(assist, function() return assist.R:CanAsk() end), "an assist flag that is secret: no")
assistSecret = false
raid = false
check(not as(assist, function() return assist.R:CanAsk() end), "in a party there are no assists: no")
check(as(solex, function() return R:CanAsk() end), "the party leader can ask")
raid = true
grouped = false
check(as(quick, function() return quick.R:CanAsk() end), "out of a group anyone can ask (a test)")
grouped = true
local ok, why = as(quick, function() return quick.R:Ask(link(RUNE)) end)
eq(ok, nil, "a raider's ask is refused")
eq(#outbox, 0, "and sends nothing")

-- 2. The page: the shared item slot ------------------------------------------------------------------------------
check(solex.pages.requests ~= nil, "the page registers as requests")
eq(solex.pages.requests and solex.pages.requests.title, "Requests", "its title")
local pf = mock()
pf.shown = true
as(solex, function() solex.pages.requests.build(pf) end)
local V = R.view
check(V and V.slot and V.ask and V.close and V.status and V.rows, "the page's parts")
check(V.slot.Say ~= nil and V.slot.ShowItem ~= nil, "the slot is the shared UI.ItemDropSlot")
check(slotSrc:find("function UI.ItemDropSlot", 1, true) ~= nil and not pageSrc:find("GetCursorInfo", 1, true), "the page doesn't copy the slot's cursor code")
check(solex.helps["Requests"] ~= nil, "the page's (?)")
check(slotSrc:find('UI.Tint(slot, "SetBackdropColor", "surface"', 1, true) and slotSrc:find('UI.Tint(slot, "SetBackdropBorderColor", "border"', 1, true),
  "the slot's box takes the theme's colours")
check(not pageSrc:find("SetBackdrop", 1, true), "the page has no box look of its own")
eq(V.ask.enabled, false, "Ask the raid waits for an item")
eq(V.close.enabled, false, "Close request: nothing open")
put("Solex", 0, 1, RUNE, 5)
put("Solex", 0, 2, BOUND, 1, true)
as(solex, function() pickUp(0, 2) V.slot.scripts.OnReceiveDrag(V.slot) end)
check((V.slot.status.text or ""):find("can't", 1, true) ~= nil, "a soulbound item: refused (" .. tostring(V.slot.status.text) .. ")")
eq(cursor, nil, "the cursor is cleared")
as(solex, function() pickUp(0, 1) V.slot.scripts.OnReceiveDrag(V.slot) end)
check((V.slot.status.text or ""):find("You have 5", 1, true) ~= nil, "the slot says how many you have (" .. tostring(V.slot.status.text) .. ")")
eq(V.slot.icon.shown, true, "the slot shows the item's icon")
eq(V.ask.enabled, true, "Ask the raid: ready")
GameTooltip.link = nil
as(solex, function() V.slot.scripts.OnEnter(V.slot) end)
eq(GameTooltip.link, link(RUNE), "the slot's item tooltip")
eq(GameTooltip.owner, V.slot, "placed by UI.TooltipOwner on the slot")

-- 3. Ask: the message, the raiders' popups -----------------------------------------------------------------------
locked = true
errors = {}
click(solex, V.ask)
eq(#outbox, 0, "chat locked in an encounter: nothing sent")
eq(errors[1], "Can't do that during a boss encounter.", "red error text says why")
eq(R.open, nil, "and nothing is open")
locked = false
click(solex, V.ask)
eq(kinds(), "N", "Ask the raid: one ask")
local id = R.open and R.open.id
check(outbox[1] and outbox[1].text == "N|" .. tostring(id) .. "|1|item:" .. RUNE .. "::::::::80:::::", "the ask carries its ID, the version and the item string (" .. tostring(outbox[1] and outbox[1].text) .. ")")
check(#outbox[1].text <= 255, "one message")
deliver()
local qp = quick.windows.CowfeeRaidToolsRequestPopup
check(qp and qp.shown, "Quick's popup shows")
check(qp and qp.opts.kind == "dialog" and (qp.opts.layer == nil or qp.opts.layer == "popups"), "a UI.Window dialog on the popups layer")
eq(qp and qp.ask.text, "Solex asks: need one?", "the popup's question")
eq(qp and qp.link.text, link(RUNE), "the popup's item")
local ap = assist.windows.CowfeeRaidToolsRequestPopup
check(ap and ap.shown, "Assist's popup shows too")
local sp = solex.windows.CowfeeRaidToolsRequestPopup
check(not (sp and sp.shown), "the asker gets no popup in a group")
eq(old.LM.incoming, nil, "the old client: nothing changed")
check(button(quick, "Need one") and button(quick, "No thanks"), "the popup's two buttons")
GameTooltip.link = nil
as(quick, function() qp.item.scripts.OnEnter(qp.item) end)
eq(GameTooltip.link, link(RUNE), "the popup's item tooltip")
eq(GameTooltip.owner, qp.item, "placed by UI.TooltipOwner")

-- 4. Answers -----------------------------------------------------------------------------------------------------
local rows = as(solex, function() return R:Rows() end)
eq(#rows, 3, "the list: everyone but you")
local need, no, waiting = R.Counts(rows)
eq(need .. "/" .. no .. "/" .. waiting, "0/0/3", "no answers yet")
click(quick, button(quick, "Need one"))
check(not qp.shown, "Quick's popup closes on the answer")
eq(kinds(), "W", "the answer")
eq(outbox[1].text, "W|" .. id .. "|1|1", "the answer carries the request, the version, then need (1)")
deliver()
click(assist, button(assist, "No thanks"))
check(not ap.shown, "Assist's popup closes")
eq(outbox[1].text, "W|" .. id .. "|1|0", "no thanks (0), the version in the same place")
deliver()
rows = as(solex, function() return R:Rows() end)
local byName = {}
for _, r in ipairs(rows) do byName[r.name] = r end
eq(byName["Quick-Sargeras"].answer, "need", "Quick needs one")
eq(byName["Assist-Sargeras"].answer, "no", "Assist said no")
eq(byName["Old-Sargeras"].answer, nil, "Old (no Requests) never answers")
eq(rows[1].name, "Quick-Sargeras", "who needs one comes first")
need, no, waiting = R.Counts(rows)
eq(need .. "/" .. no .. "/" .. waiting, "1/1/1", "the counts")
eq(R.StatusText(42, 9, 6, 5), "Asked 0:42 ago. 9 need one, 6 said no, 5 haven't answered.", "the status line")
eq(R.StatusText(125, 1, 1, 1), "Asked 2:05 ago. 1 needs one, 1 said no, 1 hasn't answered.", "the status line, one each")
eq(R.StatusText(3, 0, 0, 0), "Asked 0:03 ago. 0 need one, 0 said no, 0 haven't answered.", "the status line, none")
local ticker
local realTicker = C_Timer.NewTicker
C_Timer.NewTicker = function(s, fn) ticker = realTicker(s, fn) return ticker end
as(solex, function() pf.scripts.OnShow(pf) end)
C_Timer.NewTicker = realTicker
check(ticker and ticker.every == 1, "the page's clock ticks every second while it shows")
advance(42)
V.rows[1].name.text = "untouched"
as(solex, function() ticker.fn() end)
eq(V.status.text, "Asked 0:42 ago. 1 needs one, 1 said no, 1 hasn't answered.", "the clock updates the status line")
eq(V.rows[1].name.text, "untouched", "and only the status line")
for _, f in ipairs(solex.frames) do if f.events.BAG_UPDATE_DELAYED then as(solex, function() f.scripts.OnEvent(f, "BAG_UPDATE_DELAYED") end) end end
eq(V.rows[1].name.text, "Quick", "a bag change redraws the rows")
as(solex, function() pf.scripts.OnHide(pf) end)
check(ticker.cancelled, "the clock stops when the page hides")
as(solex, function() V.refresh() end)
eq(V.status.text, "Asked 0:42 ago. 1 needs one, 1 said no, 1 hasn't answered.", "the page's status line")
-- answers that don't count
hand(solex, "W|" .. id .. "|1|1", "Stranger-Sargeras")
check(not as(solex, function() for _, r in ipairs(R:Rows()) do if r.name == "Stranger-Sargeras" then return true end end end), "an answer from outside the group is ignored")
hand(solex, "W|someoneelse|1|1", "Old-Sargeras")
eq(byName["Old-Sargeras"].answer, nil, "an answer to another request is ignored")
hand(solex, "W|" .. id .. "|1|maybe", "Old-Sargeras")
rows = as(solex, function() return R:Rows() end)
for _, r in ipairs(rows) do if r.name == "Old-Sargeras" then eq(r.answer, nil, "a garbled answer is ignored") end end
-- asks that don't count
hand(quick, "N|fake|1|item:" .. FLASK, "Old-Sargeras")
check(not qp.shown, "an ask from a raider is ignored")
hand(quick, "N|fake2|1|item:" .. FLASK, "Stranger-Sargeras")
check(not qp.shown, "an ask from outside the group is ignored")
hand(quick, "N|later|2|item:" .. FLASK, "Solex-Sargeras")
check(not qp.shown, "a later major version is skipped")
hand(quick, "N|minor|1.3|item:" .. FLASK .. "|a field for later", "Solex-Sargeras")
check(qp.shown and qp.link.text == link(FLASK), "a later minor version is read")
-- No thanks from the X: the popup goes, nothing is sent
outbox = {}
as(quick, function() qp:Hide() end)
eq(#outbox, 0, "closing the popup sends nothing")
as(quick, function() quick.R:Fire("test") end)
check(not qp.shown, "and it stays closed")
-- one open request per leader: a new ask replaces the old one on the popup
hand(quick, "N|first|1|item:" .. FLASK, "Assist-Sargeras")
hand(quick, "N|second|1|item:" .. RUNE, "Assist-Sargeras")
eq(quick.R:Waiting() and quick.R:Waiting().id, "second", "one request at a time per asker: the newer one")
hand(quick, "Z|first|1", "Assist-Sargeras")
check(qp.shown, "closing an older request leaves the newer one")
hand(quick, "Z|second|1", "Solex-Sargeras")
check(qp.shown, "only its asker can close it")
hand(quick, "Z|second|1", "Assist-Sargeras")
check(not qp.shown, "its asker closes it: the popup goes")
hand(quick, "N|third|1|item:" .. RUNE, "Assist-Sargeras")
hand(quick, "Z|third|2", "Assist-Sargeras")
check(qp.shown, "a close of a later major version is skipped")
hand(quick, "Z|third|1.4|later", "Assist-Sargeras")
check(not qp.shown, "a close of a later minor version is read")
-- the version is the second field of every kind
for _, k in ipairs({ "ask", "answer", "close" }) do check(dataSrc:find("send(R.KIND." .. k .. ", { ", 1, true) ~= nil, "the " .. k .. " is sent") end
check(dataSrc:find("send(R.KIND.ask, { id, R.VERSION,", 1, true) and dataSrc:find("send(R.KIND.answer, { inc.id, R.VERSION,", 1, true)
  and dataSrc:find("send(R.KIND.close, { open.id, R.VERSION }", 1, true), "N, W and Z carry the version second")

-- an ask expires: its asker leaves the group, stops leading, or ASK_SECONDS pass
local function groupEvent(p, e) for _, f in ipairs(p.frames) do if f.events[e] then as(p, function() f.scripts.OnEvent(f, e) end) end end end
hand(quick, "N|gone|1|item:" .. RUNE, "Assist-Sargeras")
check(qp.shown, "an ask from Assist")
NAMES = { "Solex", "Quick", "Old" }
groupEvent(quick, "GROUP_ROSTER_UPDATE")
check(not qp.shown, "Assist left the group: the ask goes, the popup closes")
NAMES = { "Solex", "Quick", "Assist", "Old" }
hand(quick, "N|demoted|1|item:" .. RUNE, "Assist-Sargeras")
check(qp.shown, "an ask from Assist again")
-- what can't be read keeps the ask: a secret assist flag, an unreadable leader flag, a name not loaded yet
assistSecret = true
groupEvent(quick, "GROUP_ROSTER_UPDATE")
check(qp.shown, "a secret assist flag on a roster update: the ask stays")
assistSecret = false
local realLeader = UnitIsGroupLeader
UnitIsGroupLeader = function() error("unreadable") end
groupEvent(quick, "PARTY_LEADER_CHANGED")
check(qp.shown, "an unreadable leader flag: the ask stays")
UnitIsGroupLeader = realLeader
NAMES = { "Solex", "Quick", false, "Old" }
local realName = UnitName
UnitName = function(u) local n = realName(u) if n == false then return nil end return n end
groupEvent(quick, "GROUP_ROSTER_UPDATE")
check(qp.shown, "a group member's name not loaded yet: the ask stays")
UnitName = realName
NAMES = { "Solex", "Quick", "Assist", "Old" }
local realAssist = UnitIsGroupAssistant
UnitIsGroupAssistant = function() return false end
groupEvent(quick, "PARTY_LEADER_CHANGED")
check(not qp.shown, "Assist no longer an assist: the ask goes")
UnitIsGroupAssistant = realAssist
check(type(quick.R.ASK_SECONDS) == "number" and quick.R.ASK_SECONDS >= 300, "an ask's time is a named constant (" .. tostring(quick.R.ASK_SECONDS) .. ")")
hand(quick, "N|slow|1|item:" .. RUNE, "Assist-Sargeras")
check(qp.shown, "an ask that waits")
advance(quick.R.ASK_SECONDS - 1)
check(qp.shown, "still there just before its time is up")
advance(2)
check(not qp.shown, "its time is up: the popup closes")
eq(quick.R:Waiting(), nil, "and nothing waits")

-- 5. The old client drops every new kind ------------------------------------------------------------------------
local errs = fails
for _, text in ipairs({ "N|" .. id .. "|1|item:" .. RUNE, "W|" .. id .. "|1|1", "Z|" .. id .. "|1" }) do hand(old, text, "Solex-Sargeras") end
eq(fails, errs, "the old client takes the new kinds without an error")
eq(old.LM.incoming, nil, "and does nothing with them")
check(oldCommSrc:find("HANDLERS.N", 1, true) == nil and oldCommSrc:find("HANDLERS.W", 1, true) == nil and oldCommSrc:find("HANDLERS.Z", 1, true) == nil,
  "1.1.0 has no handler for N, W or Z")

-- 6. Trade 1 -----------------------------------------------------------------------------------------------------
local function tradeButton(i) return V.rows[i] and V.rows[i].trade end
as(solex, function() V.refresh() end)
local tb = tradeButton(1)
check(tb and tb.shown and tb.text == "Trade 1", "Trade 1 on the player who needs one")
eq(tb and tb.enabled, true, "enabled: you have 5")
check(not (tradeButton(2) and tradeButton(2).shown), "no Trade 1 for No thanks")
check(not (tradeButton(3) and tradeButton(3).shown), "no Trade 1 for No answer")
initiated, split, TRADE = {}, {}, {}
click(solex, tb)
eq(initiated[1], "raid2", "Trade 1 opens a trade with Quick")
tradeWith = "Quick"
as(solex, function() solex.trade.scripts.OnEvent(solex.trade, "TRADE_SHOW") end)
eq(split[1], "0:1x1", "one copy split off the stack")
eq(TRADE[1], link(RUNE), "and put in the trade")
eq(cursor, nil, "nothing left on the cursor")
check(table.concat(solex.printed, "\\n"):find("Requests: ", 1, true) ~= nil, "the chat lines say Requests")
-- cancelled: TRADE_CLOSED only
as(solex, function() solex.trade.scripts.OnEvent(solex.trade, "TRADE_CLOSED") end)
advance(5)
eq(R.open.given["Quick-Sargeras"], nil, "a cancelled trade gives nothing")
-- the item taken out again before it completes
TRADE = {}
click(solex, tb)
as(solex, function() solex.trade.scripts.OnEvent(solex.trade, "TRADE_SHOW") end)
TRADE[1] = nil
as(solex, function() solex.trade.scripts.OnEvent(solex.trade, "TRADE_PLAYER_ITEM_CHANGED", 1) end)
as(solex, function() solex.trade.scripts.OnEvent(solex.trade, "TRADE_CLOSED") end)
as(solex, function() solex.trade.scripts.OnEvent(solex.trade, "UI_INFO_MESSAGE", 1, ERR_TRADE_COMPLETE) end)
eq(R.open.given["Quick-Sargeras"], nil, "a trade that completed without the item gives nothing")
-- completed with the item in it
TRADE = {}
click(solex, tb)
as(solex, function() solex.trade.scripts.OnEvent(solex.trade, "TRADE_SHOW") end)
as(solex, function() solex.trade.scripts.OnEvent(solex.trade, "TRADE_ACCEPT_UPDATE", 1, 1) end)
as(solex, function() solex.trade.scripts.OnEvent(solex.trade, "UI_INFO_MESSAGE", 1, "Something else.") end)
eq(R.open.given["Quick-Sargeras"], nil, "another info line isn't the trade")
as(solex, function() solex.trade.scripts.OnEvent(solex.trade, "UI_INFO_MESSAGE", 1, ERR_TRADE_COMPLETE) end)
as(solex, function() solex.trade.scripts.OnEvent(solex.trade, "TRADE_CLOSED") end)
eq(R.open.given["Quick-Sargeras"], 1, "a completed trade: Given counts it")
as(solex, function() V.refresh() end)
eq(V.rows[1].given.text, "1", "the row's Given")
eq(tb.text, "Done", "the row says Done")
eq(tb.enabled, false, "and its button is off")
-- the line after TRADE_CLOSED still counts, a late one doesn't
R.open.given["Quick-Sargeras"] = nil
TRADE = {}
click(solex, tb)
eq(#initiated, 4, "Trade 1 again once the count is cleared")
R.open.answers["Assist-Sargeras"] = "need"
TRADE = {}
local tb2
as(solex, function() V.refresh() end)
for i = 1, 3 do if V.rows[i].name.text == "Assist" then tb2 = V.rows[i].trade end end
initiated = {}
click(solex, tb2)
eq(initiated[1], "raid3", "Trade 1 for Assist")
tradeWith = "Assist"
as(solex, function() solex.trade.scripts.OnEvent(solex.trade, "TRADE_SHOW") end)
as(solex, function() solex.trade.scripts.OnEvent(solex.trade, "TRADE_CLOSED") end)
advance(1)
as(solex, function() solex.trade.scripts.OnEvent(solex.trade, "UI_INFO_MESSAGE", 1, ERR_TRADE_COMPLETE) end)
eq(R.open.given["Assist-Sargeras"], 1, "the complete line just after TRADE_CLOSED counts")
-- Assist's Trade 1, found again: the rows sort again as Given changes
local function tradeFor(short)
  as(solex, function() V.refresh() end)
  for i = 1, #V.rows do if V.rows[i].name.text == short then return V.rows[i].trade end end
end
-- a complete line long after TRADE_CLOSED is another trade's: not counted
R.open.given["Assist-Sargeras"] = nil
TRADE, initiated = {}, {}
click(solex, tradeFor("Assist"))
eq(initiated[1], "raid3", "Trade 1 for Assist again")
as(solex, function() solex.trade.scripts.OnEvent(solex.trade, "TRADE_SHOW") end)
as(solex, function() solex.trade.scripts.OnEvent(solex.trade, "TRADE_CLOSED") end)
advance(3)
as(solex, function() solex.trade.scripts.OnEvent(solex.trade, "UI_INFO_MESSAGE", 1, ERR_TRADE_COMPLETE) end)
check(TRADE[1] == link(RUNE), "the rune went in")
eq(R.open.given["Assist-Sargeras"], nil, "a complete line more than DONE_SECONDS after TRADE_CLOSED isn't counted")
-- another language: the client's own ERR_TRADE_COMPLETE
local english = ERR_TRADE_COMPLETE
ERR_TRADE_COMPLETE = "Handel abgeschlossen."
TRADE = {}
click(solex, tradeFor("Assist"))
as(solex, function() solex.trade.scripts.OnEvent(solex.trade, "TRADE_SHOW") end)
eq(TRADE[1], link(RUNE), "the rune is in Assist's trade")
as(solex, function() solex.trade.scripts.OnEvent(solex.trade, "UI_INFO_MESSAGE", 1, english) end)
eq(R.open.given["Assist-Sargeras"], nil, "in German the English line isn't the trade")
as(solex, function() solex.trade.scripts.OnEvent(solex.trade, "UI_INFO_MESSAGE", 1, "Handel abgeschlossen.") end)
eq(R.open.given["Assist-Sargeras"], 1, "in German the client's own line counts")
ERR_TRADE_COMPLETE = english
-- none left: Trade 1 greys
BAGS.Solex[0][1] = nil
R.open.given["Assist-Sargeras"] = nil
tb2 = tradeFor("Assist")
eq(tb2.text, "Trade 1", "Assist's Trade 1 again")
eq(tb2.enabled, false, "none left in your bags: Trade 1 greys")
initiated = {}
click(solex, tb2)
eq(#initiated, 0, "and does nothing")
check((V.slot.status.text or ""):find("You have 0", 1, true) ~= nil, "the slot says you have none (" .. tostring(V.slot.status.text) .. ")")
put("Solex", 0, 1, RUNE, 5)

-- 7. Close request ------------------------------------------------------------------------------------------------
as(solex, function() pickUp(0, 1) V.slot.scripts.OnReceiveDrag(V.slot) end)
outbox = {}
click(solex, V.ask)
local id2 = R.open.id
check(id2 ~= id, "a new ask gets a new ID")
deliver()
check(qp.shown, "the popup again")
outbox = {}
click(solex, V.close)
eq(kinds(), "Z", "Close request: one close")
eq(outbox[1].text, "Z|" .. id2 .. "|1", "the close names the request, then the version")
eq(R.open, nil, "nothing open")
deliver()
check(not qp.shown, "Close request closes the raiders' popups")
as(solex, function() V.refresh() end)
eq(V.close.enabled, false, "Close request: off again")
-- an answer after the close is ignored
hand(solex, "W|" .. id2 .. "|1|1", "Quick-Sargeras")
eq(R.open, nil, "an answer after the close opens nothing")
-- asking again closes the open one first
click(solex, V.ask)
outbox = {}
click(solex, V.ask)
eq(kinds(), "ZN", "asking again: the old request closes, the new one asks")
deliver()
click(solex, V.close)
deliver()

-- 8. A raider's page: Ask is off, the line says why
local qf = mock()
qf.shown = true
as(quick, function() quick.pages.requests.build(qf) end)
local QV = quick.R.view
as(quick, function() put("Quick", 0, 1, FLASK, 2) pickUp(0, 1) QV.slot.scripts.OnReceiveDrag(QV.slot) QV.refresh() end)
eq(QV.ask.enabled, false, "a raider's Ask the raid is off")
eq(QV.status.text, "Only the raid leader or an assist can ask.", "and the line says why")

-- 9. Out of a group: a test with yourself
grouped = false
as(solex, function() R:Ask(link(RUNE)) end)
sp = solex.windows.CowfeeRaidToolsRequestPopup
check(sp and sp.shown, "alone: your own popup shows, to try it")
as(solex, function() click(solex, button(solex, "Need one")) end)
rows = as(solex, function() return R:Rows() end)
eq(#rows, 1, "alone: the list is you")
eq(rows[1] and rows[1].answer, "need", "alone: your own answer")
as(solex, function() R:Close() end)
grouped = true

-- 10. Loot Master's double-click trade still goes the same way
local LM = solex.LM
LM.current = { items = { { itemString = "item:" .. RUNE, award = { name = "Quick-Sargeras" } } } }
initiated, split, TRADE = {}, {}, {}
tradeWith = "Quick"
as(solex, function() LM:TradeItem(1) solex.trade.scripts.OnEvent(solex.trade, "TRADE_SHOW") end)
eq(initiated[1], "raid2", "Loot Master: the trade opens")
eq(split[1], "0:1x1", "Loot Master: one copy")
check(solex.printed[#solex.printed]:find("^Loot Master: ") ~= nil, "Loot Master's lines still say Loot Master")
LM.current = nil

-- 11. The menu: Requests is under Modules, after Loot Master
local groups = panelSrc:match("UI.MENU_GROUPS = (%b{})") or ""
check(groups:find('"lootmaster", "requests"', 1, true) ~= nil, "Modules lists requests right after lootmaster")
-- nothing saved
check(not dataSrc:find("CRTDB", 1, true) and not pageSrc:find("CRTDB", 1, true) and not popupSrc:find("CRTDB", 1, true), "Requests saves nothing")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Core/UI/ItemSlot.lua', 'CRT_Modules/LootMaster/Data.lua', 'CRT_Modules/LootMaster/Comm.lua',
  'CRT_Modules/LootMaster/AddItem.lua', 'CRT_Modules/LootMaster/Trade.lua', 'CRT_Modules/Requests/Data.lua',
  'CRT_Modules/Requests/Popup.lua', 'CRT_Modules/Requests/Page.lua', 'CRT_Dev/Tests/old_Comm.lua', 'CRT_Core/UI/Panel.lua'];
for (const f of files) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
