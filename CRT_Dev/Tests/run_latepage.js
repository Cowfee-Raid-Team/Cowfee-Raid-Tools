// Builds CRT_Modules/Late/Page.lua on mock frames with two saved nights and prints the totals table rows.
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local dataSrc, pageSrc, coreSrc = ...
local strings = {}
local lateHelps = {} -- every (?) made
tinsert = table.insert
UISpecialFrames = {}
local function mock()
  local m = { shown = false }
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" then return function() local x = mock() strings[#strings+1] = x return x end end
    if k == "CreateTexture" then return function() return mock() end end
    if k == "SetText" then return function(self, s) self.text = s end end
    if k == "Show" then return function(self) self.shown = true if rawget(self, "OnShow") then self.OnShow(self) end end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) if on then self:Show() else self:Hide() end end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "HasFocus" then return function() return false end end
    if k == "GetWidth" then return function() return 378 end end
    if k == "GetStringHeight" then return function() return 14 end end
    if k == "SetScript" then return function(self, name, fn) rawset(self, name, fn) end end
    if k == "SetPoint" then return function(self, p, x, y) if type(x) == "number" then rawset(self, "x", x) rawset(self, "y", y) end end end
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabled", on) end end
    if k == "Enable" then return function(self) rawset(self, "enabled", true) end end
    if k == "Disable" then return function(self) rawset(self, "enabled", false) end end
    if k == "GetText" then return function(self) return rawget(self, "text") end end
    return function() end end })
end
local frames = {}
-- BasicFrameTemplate's TitleText (Blizzard_UIPanelTemplates: a GameFontNormal font string anchored TOP)
function CreateFrame(_, _, _, template) local f = mock() frames[#frames + 1] = f
  if template == "BasicFrameTemplateWithInset" then rawset(f, "TitleText", f:CreateFontString()) end
  return f end
local tip = {}
GameTooltip = { SetOwner = function() tip = {} end, SetText = function(_, s) tip[#tip + 1] = s end, AddLine = function(_, s) tip[#tip + 1] = s end, Show = function() end, Hide = function() end }
local menus, gridRef = {}, nil
local dropdowns = {} -- every UI.Dropdown made, with its opts and its label
local exported -- the last text shown for Discord
local sent, states, canInvite, inviteWhy = {}, {}, true, nil
InCombatLockdown = function() return false end
format = string.format
date = os.date
time = function(t) if t then return os.time(t) end return os.time({ year = 2026, month = 10, day = 14, hour = 23, min = 0 }) end
function IsInGroup() return false end
C_Timer = { After = function() end, NewTicker = function() end }
RAID_CLASS_COLORS = {}
local pages = {}
local CRT = { db = { late = { days = {}, hour = 20, minute = 0, grace = 0, history = {}, nextId = 3, lastAuto = "" } },
  UI = { SlotGrid = function() local g = { slots = {}, labels = {}, blockH = 143, slotW = 188 } for i = 1, 40 do local b = mock() rawset(b, "index", i) rawset(b, "icon", mock()) rawset(b, "text", mock()) rawset(b, "right", mock()) g.slots[i] = b end gridRef = g return g end, FitText = function() end, GoodText = function(t) return t end, ClipText = function() return mock() end, PAGE_W = 1026, PAGE_H = 560, Help = function(_, title, text) local m = mock() rawset(m, "helpTitle", title) rawset(m, "helpText", text) lateHelps[#lateHelps + 1] = m return m end, Dropdown = function(_, label, o) local m = mock() rawset(m, "Dropdown", mock()) rawset(m, "opts", o) local lab = mock() lab.text = label rawset(m, "Label", lab) dropdowns[#dropdowns + 1] = m rawset(m, "refresh", function() if o.enabledIf then rawset(m, "enabled", o.enabledIf() and true or false) end end) return m end, Slider = function(_, _, o) local m = mock() rawset(m, "refresh", function() if o.enabledIf then rawset(m, "enabled", o.enabledIf() and true or false) end end) return m end,  RegisterLayer = function() end, RegisterPage = function(_, key, title, fn) pages[key] = fn end, RegisterTab = function() end, SetTabSelected = function() end, SkinTree = function() end, SkinScrollBar = function() end, SetFrameTitle = function() end, StyleWindow = function() end,
    PanelButtonWidth = function(w) return w + 28 end, PanelButton = function(parent, label, h, onClick) local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate") b:SetText(label) b:SetScript("OnClick", onClick) return b end, ContextMenu = function(owner, fill) menus[#menus + 1] = { owner = owner, fill = fill } end },
  Invite = { CanInvite = function() return canInvite, inviteWhy end, Send = function(_, names, slots, from) sent[#sent + 1] = { names = names, slots = slots, from = from } return #names end,
    StateText = function(_, key) return states[key] end, Entry = function(_, key) return states[key] and { state = "invited" } end, Summary = function() return "SUMMARY" end, OnChange = function() end,
    GroupOf = function(slots, key) for i = 1, 40 do if slots[i] == key then return math.ceil(i / 5) end end end },
  Groups = { MakeLookup = function() return function() return nil end end, ActiveNames = function() return {} end, NUM_SLOTS = 40, Active = function() return nil end, Find = function() return nil end, OnChange = function() end, ReportName = function(k) return (k:gsub("%-.*", "")) end, Normalize = function(k) return k end, ReadRoster = function() return {} end, ClassColor = function() return 1, 1, 1 end, Display = function(k) return k end, Presets = function() return {} end, Find = function() return nil end, OnChange = function() end },
}
function CRT:Print(m) print(m) end
CRT.ConsumablesTools = { ShowText = function(_, title, text) exported = text end }
CRT_THEME(CRT, CRT.UI)
-- the shared dev-mode helper, cut out of CRT_Core/Core.lua (the rest of Core is not loaded here)
assert(load("local CRT = ... " .. coreSrc:match("function CRT%.DevMode%(%).-\\nend"), "DevMode"))(CRT)
local function at(h, m) return os.time({ year = 2026, month = 10, day = 14, hour = h, min = m }) end
CRT.db.late.history = {
  { id = 1, startedAt = at(20, 0), endedAt = at(22, 0), how = "schedule", endReason = "disband", layout = "Main", grace = 0,
    players = { { key = "Balevolence-Stormrage", joinedAt = at(20, 14) }, { key = "Abu-Kel'Thuzad", never = true }, { key = "Gadios-Silvermoon", joinedAt = at(20, 0) } } },
  { id = 2, startedAt = at(20, 0), endedAt = at(21, 0), how = "button", endReason = "button", layout = "Main", grace = 0,
    players = { { key = "Balevolence-Stormrage", joinedAt = at(20, 5) }, { key = "Gadios-Silvermoon", joinedAt = at(20, 0) } } },
}
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
assert(load(pageSrc, "Page.lua"))("CowfeeRaidTools", CRT)
local pf = mock()
pages.late(pf)
pf:Show()
-- Print the totals table: strings created after the page's own, grouped by y.
local rows = {}
for _, s in ipairs(strings) do
  local y = rawget(s, "y")
  if s.shown and y and y <= -24 and type(rawget(s, "text")) == "string" then
    rows[y] = rows[y] or {}
    table.insert(rows[y], (rawget(s, "x") or 0) .. ":" .. s.text)
  end
end
local ys = {} for y in pairs(rows) do ys[#ys+1] = y end table.sort(ys, function(a, b) return a > b end)
for _, y in ipairs(ys) do print(y, table.concat(rows[y], " | ")) end
-- The no-show count is the theme's bad colour, and follows a live switch (the page in view refreshes on a switch).
local function noShowCell()
  for _, s in ipairs(strings) do
    local t = rawget(s, "text")
    if s.shown and type(t) == "string" and t:find("^|cff%x%x%x%x%x%x1|r$") then return t end
  end
end
local fails = 0
local function check(ok, what) if ok then print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end
check(noShowCell() == "|cffff20201|r", "Default: Blizzard: the no-show count is the game's red: " .. tostring(noShowCell()))
CRT.UI.SwitchTheme("nitro")
pf:Show()
check(noShowCell() == "|cffff9a4d1|r", "Nitro: the no-show count follows the switch: " .. tostring(noShowCell()))
CRT.UI.SwitchTheme("blizzard")

-- Invites on the Tonight tab: click a row that isn't here to invite them, Invite all not here, greyed states.
local preset = { id = 7, name = "Main", slots = {} }
for i = 1, 40 do preset.slots[i] = "" end
preset.slots[1] = "Mesmertism-Stormrage" preset.slots[2] = "Gadios-Silvermoon" preset.slots[7] = "Balevolence-Stormrage"
CRT.Groups.Active = function() return 7 end
CRT.Groups.Find = function(_, id) if id == 7 then return preset end end
CRT.Groups.ActiveNames = function() return { "Mesmertism-Stormrage", "Gadios-Silvermoon", "Balevolence-Stormrage" } end
CRT.db.late.current = { id = 9, startedAt = time() - 600, how = "button", layout = "Main", grace = 0,
  players = { { key = "Mesmertism-Stormrage" }, { key = "Gadios-Silvermoon", joinedAt = time() - 600 }, { key = "Balevolence-Stormrage" } } }
canInvite, inviteWhy = true, nil
states["Balevolence-Stormrage"] = "invited 0:42"
pf:Show()
local function slot(i) return gridRef.slots[i] end
local function plain(s) return (tostring(s or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")) end
check(plain(slot(7).right.text) == "invited 0:42  10:00", "an invited row shows the invite next to the late time: " .. plain(slot(7).right.text))
check(plain(slot(1).right.text) == "10:00", "a row not invited shows its late time only: " .. plain(slot(1).right.text))
slot(1).OnEnter(slot(1))
check(tip[2] == "Click to invite Mesmertism-Stormrage. They move to group 1 when they join.", "the row's tooltip: " .. tostring(tip[2]))
slot(1).OnClick(slot(1), "LeftButton")
check(#sent == 1 and sent[1].names[1] == "Mesmertism-Stormrage" and sent[1].slots == preset.slots and sent[1].from == "Main", "clicking the row invites by Name-Realm from tonight's layout")
sent = {}
slot(2).OnClick(slot(2), "LeftButton")
check(#sent == 0, "clicking someone who is here invites nobody")
local inviteAll
for _, f in ipairs(frames) do if type(rawget(f, "text")) == "string" and f.text:find("^Invite all not here") then inviteAll = f end end
check(inviteAll and inviteAll.text == "Invite all not here (2)", "the button counts the two not here: " .. tostring(inviteAll and inviteAll.text))
check(inviteAll and inviteAll.enabled == true, "and is enabled")
inviteAll.OnClick(inviteAll)
check(#sent == 1 and #sent[1].names == 2 and sent[1].names[1] == "Mesmertism-Stormrage" and sent[1].names[2] == "Balevolence-Stormrage", "Invite all not here invites both")
local statusShown = false
for _, s in ipairs(strings) do if rawget(s, "text") == "SUMMARY" then statusShown = true end end
check(statusShown, "the status line shows the invite summary")
-- Right-click: Invite, or count them as here on time.
menus = {}
slot(1).OnClick(slot(1), "RightButton")
local items = {}
local root = { CreateTitle = function() end, CreateButton = function(_, label, fn) local it = { label = label, fn = fn, enabled = true } function it:SetEnabled(on) self.enabled = on end items[#items + 1] = it return it end }
if menus[1] then menus[1].fill(root) end
check(items[1] and items[1].label == "Invite Mesmertism-Stormrage", "right-click menu: Invite Mesmertism-Stormrage")
check(items[2] and items[2].label == "Count as here on time", "and Count as here on time")
if items[2] then items[2].fn() end
check(CRT.db.late.current.players[1].joinedAt ~= nil, "which counts them as here on time")
-- Not lead or assist: greyed with the reason; in combat the status says invites wait.
canInvite, inviteWhy = false, "Only the raid leader or an assist can invite."
sent = {}
pf:Show()
check(inviteAll.enabled == false, "not lead or assist: Invite all is greyed")
inviteAll.OnEnter(inviteAll)
check(tip[2] == "Only the raid leader or an assist can invite.", "its tooltip says why: " .. tostring(tip[2]))
slot(7).OnEnter(slot(7))
check(tip[2] == "Only the raid leader or an assist can invite.", "a row's tooltip says why: " .. tostring(tip[2]))
slot(7).OnClick(slot(7), "LeftButton")
check(#sent == 0, "and clicking a row invites nobody")
-- The greyed Invite in the row menu gives the same reason in its tooltip.
GameTooltip_AddNormalLine = function(t, s) t[#t + 1] = s end
menus, items = {}, {}
slot(7).OnClick(slot(7), "RightButton")
root.CreateButton = function(_, label, fn) local it = { label = label, fn = fn, enabled = true } function it:SetEnabled(on) self.enabled = on end function it:SetTooltip(f) self.tip = f end items[#items + 1] = it return it end
if menus[1] then menus[1].fill(root) end
local lines = {}
if items[1] and items[1].tip then items[1].tip(lines) end
check(items[1] and items[1].enabled == false and lines[1] == "Only the raid leader or an assist can invite.", "the greyed menu Invite says why: " .. tostring(lines[1]))
-- Edit roster opens the roster window; its (?) on the whole window sits right of the window's title
do
  local edit
  for _, f in ipairs(frames) do if rawget(f, "text") == "Edit roster" and rawget(f, "OnClick") then edit = f end end
  edit.OnClick(edit)
  local h
  for _, x in ipairs(lateHelps) do if x.helpTitle == "Edit tonight's roster" then h = x end end
  local target = h and rawget(h, "helpTarget")
  local window
  for _, f in ipairs(frames) do if rawget(f, "TitleText") ~= nil and rawget(f, "TitleText") == target then window = f end end
  check(window ~= nil, "the roster window's (?) is right of the window's title (its TitleText)")
  for _, x in ipairs(lateHelps) do check(rawget(x, "helpTarget") ~= nil, "the (?) " .. tostring(x.helpTitle) .. " is placed by UI.HelpRight") end
end
-- Team raids: Only record team raids on the Settings tab; History's Show filter (with its (?)) only once a night
-- that wasn't a team raid is saved, and Team raids keeps the totals to the team's nights
do
  local function find(pred) for _, s in ipairs(strings) do local t = rawget(s, "text") if type(t) == "string" and pred(t) then return s end end end
  check(find(function(t) return t == "Only record team raids" end) ~= nil, "Settings: an Only record team raids check box")
  local onlyHelp, showHelp
  for _, x in ipairs(lateHelps) do if x.helpTitle == "Only record team raids" then onlyHelp = x elseif x.helpTitle == "Show" then showHelp = x end end
  check(onlyHelp ~= nil, "with a (?)")
  CRT.db.late.current = nil
  pf:Show()
  check(showHelp ~= nil and not showHelp.shown, "only team raid nights: no Show filter")
  check(find(function(t) return t == "All 2 saved nights, most often late first." end) ~= nil, "the totals cover both nights")
  CRT.db.late.history[#CRT.db.late.history + 1] = { id = 3, startedAt = at(19, 0), endedAt = at(19, 30), how = "button", endReason = "button", layout = "Pug", grace = 0, team = false,
    players = { { key = "Balevolence-Stormrage" } } }
  pf:Show()
  check(showHelp.shown, "a night that wasn't a team raid saved: the Show filter")
  check(find(function(t) return t == "All 2 team raid nights, most often late first." end) ~= nil, "Team raids by default: the totals leave the other night out")
  table.remove(CRT.db.late.history)
end
-- the (?)s say a raider's tracker records only when it starts a night itself, and that a pushed roster becomes theirs
do
  local page, roster
  -- a list-form text (UI.AddTooltipText) as one string
  local function helpPlain(t) return CRT_HELP_PLAIN(t) end -- the real UI.TooltipPlain (theme_stub.js)
  for _, x in ipairs(lateHelps) do
    if x.helpTitle == "The Late Tracker" then page = x elseif x.helpTitle == "Expected roster" then roster = x end
  end
  check(page and helpPlain(page.helpText):find("A raider's tracker records only when their own schedule or Start raid now runs.", 1, true),
    "the page's (?) has the raider caveat")
  check(roster and helpPlain(roster.helpText):find("pushes a note with their roster, it becomes your active layout", 1, true),
    "the expected roster's (?) says a pushed roster becomes yours")
end
-- Edit night on History: one row per player with a status dropdown; changes save at once and every total follows
do
  local function plain(s) return (tostring(s or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")) end
  local function frameWith(text) for _, f in ipairs(frames) do if rawget(f, "text") == text and rawget(f, "OnClick") then return f end end end
  local function listLabel(id)
    for _, f in ipairs(frames) do
      if rawget(f, "value") == id and f.shown and rawget(f, "text") ~= nil then return plain(rawget(f, "text").text) end
    end
  end
  local function selectNight(id) for _, f in ipairs(frames) do if rawget(f, "value") == id and rawget(f, "OnClick") then f.OnClick(f) return end end end
  local function detail()
    local best
    for _, s in ipairs(strings) do local t = rawget(s, "text") if type(t) == "string" and t:find("Expected roster \\"Main\\"", 1, true) then best = t end end
    return plain(best)
  end
  local function rowFor(key)
    for _, d in ipairs(dropdowns) do if d.shown and rawget(d, "playerKey") == key then return d end end
  end
  local function labels(d) local out = {} for _, o in ipairs(d.opts.options()) do out[#out + 1] = o.label end return table.concat(out, " / ") end
  CRT.db.late.current = nil
  pf:Show()
  check(listLabel(1) and listLabel(1):find("(2 late)", 1, true), "the list: night 1 has 2 late: " .. tostring(listLabel(1)))
  local edit = frameWith("Edit night")
  check(edit ~= nil, "History has an Edit night button")
  local editHelp
  for _, x in ipairs(lateHelps) do if x.helpTitle == "Edit night" then editHelp = x end end
  check(editHelp ~= nil and rawget(editHelp, "helpTarget") == edit, "with its (?) right of it")
  -- Edit night is there only while the Development page is open (/crt dev), not for a build that merely has the dev files
  local function check_hidden(why)
    selectNight(1)
    check(not edit.shown, why .. ": no Edit night for a night")
    check(editHelp and not editHelp.shown, why .. ": nor its (?)")
    check(detail():find("Late (2):", 1, true), why .. ": the night reads as before")
    check(#dropdowns > 0 and not rowFor("Balevolence-Stormrage"), why .. ": and no edit rows")
  end
  check(rawget(CRT.UI, "pages") == nil, "the harness starts with no Development page")
  check_hidden("no dev page")
  CRT.Dev = {} -- the dev files loaded, but /crt dev not open
  check_hidden("dev files only")
  CRT.UI.pages = { dev = { hidden = true } } -- the page exists but is closed
  check_hidden("dev page hidden")
  CRT.UI.pages.dev.hidden = false -- /crt dev
  selectNight("totals")
  check(not edit.shown, "no Edit night on Totals")
  check(editHelp and not editHelp.shown, "nor its (?)")
  selectNight(1)
  check(edit.shown, "Edit night shows for a night")
  check(detail():find("Late (2):", 1, true), "the detail lists 2 late")
  edit.OnClick(edit)
  check(edit.text == "Done", "in edit mode it reads Done")
  local bale, abu, gad = rowFor("Balevolence-Stormrage"), rowFor("Abu-Kel'Thuzad"), rowFor("Gadios-Silvermoon")
  check(bale and abu and gad, "one row per player")
  check(bale and plain(bale.Label.text) == "Balevolence", "the row's label is the player's name: " .. tostring(bale and bale.Label.text))
  check(bale and labels(bale) == "On time / Late (joined 20:14) / No-show / Not expected", "Balevolence's choices: " .. (bale and labels(bale) or "-"))
  check(abu and labels(abu) == "On time / No-show / Not expected", "never joined: no Late choice: " .. (abu and labels(abu) or "-"))
  check(bale and bale.opts.get() == "late" and abu.opts.get() == "noshow" and gad.opts.get() == "ontime", "each dropdown shows the status")
  check(bale and bale.opts.labelWidth and bale.opts.labelWidth > 0, "a fixed label width")
  -- rows sorted as the detail sorts them: most late first
  check(abu and bale and gad and rawget(abu, "y") > rawget(bale, "y") and rawget(bale, "y") > rawget(gad, "y"), "rows sorted most late first")
  -- On time for the missed player: saved at once, the list and the detail follow
  bale.opts.set("ontime")
  check(listLabel(1):find("(1 late)", 1, true), "the list now has 1 late: " .. tostring(listLabel(1)))
  check(CRT.db.late.history[1].players[1].edited == true, "saved through the tracker (edited)")
  edit.OnClick(edit)
  check(edit.text == "Edit night", "Done leaves edit mode")
  check(not rowFor("Balevolence-Stormrage"), "and hides the rows")
  local d = detail()
  check(d:find("On time (2): Gadios, Balevolence (edited)", 1, true) or d:find("On time (2): Balevolence (edited), Gadios", 1, true), "Balevolence is on time, marked (edited): " .. d)
  check(not d:find("Gadios (edited)", 1, true), "an unedited player isn't marked")
  -- back to Late: restored from the recorded time
  edit.OnClick(edit)
  bale = rowFor("Balevolence-Stormrage")
  check(bale and labels(bale):find("Late (joined 20:14)", 1, true), "Late (joined 20:14) is still offered after the edit")
  bale.opts.set("late")
  check(listLabel(1):find("(2 late)", 1, true), "back to 2 late")
  -- Not expected: gone from the night and the totals, under a Not expected heading in edit mode
  abu = rowFor("Abu-Kel'Thuzad")
  abu.opts.set("excluded")
  check(listLabel(1):find("(1 late)", 1, true), "not expected: out of the count: " .. tostring(listLabel(1)))
  local heading
  for _, s in ipairs(strings) do if s.shown and type(rawget(s, "text")) == "string" and plain(s.text) == "Not expected (1)" then heading = s end end
  abu = rowFor("Abu-Kel'Thuzad")
  check(heading ~= nil, "edit mode shows a Not expected heading")
  check(abu ~= nil and heading and rawget(abu, "y") < rawget(heading, "y"), "with the player under it, so it can be undone")
  check(abu and abu.opts.get() == "excluded", "their dropdown reads Not expected")
  local lastY = 0
  for _, k in ipairs({ "Balevolence-Stormrage", "Gadios-Silvermoon" }) do local r = rowFor(k) lastY = math.min(lastY, rawget(r, "y")) end
  check(heading and rawget(heading, "y") < lastY, "the heading comes after the expected players")
  edit.OnClick(edit)
  d = detail()
  check(not d:find("Abu", 1, true), "the read-only night leaves the not expected player out: " .. d)
  selectNight("totals")
  local abuTotal = false
  for _, s in ipairs(strings) do if s.shown and type(rawget(s, "text")) == "string" and plain(s.text) == "Abu" then abuTotal = true end end
  check(not abuTotal, "and the Totals do too")
  selectNight(1)
  exported = nil
  frameWith("Export for Discord").OnClick()
  check(exported and not exported:find("Abu", 1, true), "and the Discord export")
  check(exported and not exported:find("edited", 1, true), "the export has no (edited) marks")
  -- set back to No-show: restored
  edit.OnClick(edit)
  rowFor("Abu-Kel'Thuzad").opts.set("noshow")
  check(listLabel(1):find("(2 late)", 1, true), "Not expected undone: 2 late again")
  -- picking another night leaves edit mode
  selectNight(2)
  check(edit.text == "Edit night" and not rowFor("Balevolence-Stormrage"), "another night: out of edit mode")
  -- dev mode going away while editing leaves edit mode on the next refresh; page re-checks on show
  selectNight(1)
  edit.OnClick(edit)
  check(rowFor("Balevolence-Stormrage") ~= nil, "editing again")
  CRT.UI.pages.dev.hidden = true
  pf:Show()
  check(not edit.shown, "dev closed: Edit night gone on the next show")
  check(not rowFor("Balevolence-Stormrage"), "dev closed: edit rows gone")
  check(detail():find("Late", 1, true), "dev closed: the night's detail is back")
  CRT.UI.pages.dev.hidden = false
  pf:Show()
  check(edit.shown and edit.text == "Edit night", "dev reopened: the button is back, not editing")
end
if fails > 0 then error(fails .. " late page checks failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[2], 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[3], 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[4], 'utf8')));
if (lua.lua_pcall(L, 3, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
