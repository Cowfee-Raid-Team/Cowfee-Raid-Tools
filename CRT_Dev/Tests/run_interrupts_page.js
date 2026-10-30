// The Interrupts page (CRT_Modules/Interrupts/Page.lua) built on mock frames with a stubbed CRT.UI, over the real
// lists, anchor and sharing (Data.lua, Anchor.lua, Comm.lua) on the sample season pack: registered hidden, two tabs
// with Settings last, one boss listed with its difficulty, the status bar's states (no list, your own list, the raid's
// list and your kick, enemy nameplates off first), Share greyed with its reason, the work per show (the group, the
// layouts and the note read once, one refresh), the kick rows (the note editor's rows: kick order, class colours, your
// own outlined, x, read-only for a raider), the palette (your group, then each Raid Groups layout), drops from the
// palette, along a row and onto another, a full row refusing, Add name, Clear list asking first, Use the raid's list,
// Who has it in its pop-out from the Addon check, How the numbers are worked out in the Kick list's (?), Test on trash,
// Preview reminder, the Settings tab's
// sliders and colours, every control inside the page area, /crt interrupts, and the General Settings switch hiding and
// showing the page. Usage: node run_interrupts_page.js <addon folder>
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const dir = process.argv[2];
const harness = themeLua(dir) + `
local registrySrc, seasonSrc, bossSrc, commSrc, latticeSrc, setupSrc, dataSrc, anchorSrc, kickSrc, pageSrc, parseSrc, notesSrc, editModelSrc, noteBlockSrc, gridSrc, editorSrc, exportSrc, paletteSrc, pagePaletteSrc, whoSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
local function plain(s) return (tostring(s or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")) end
time = function() return 1790000000 end
date = function() return "2026-10-29 12:00" end
InCombatLockdown = function() return false end
GetTime = function() return 100 end
strtrim = function(t) return (t:gsub("^%s+", ""):gsub("%s+$", "")) end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
Ambiguate = function(n) return (n:gsub("%-.*$", "")) end
-- C_Timer.After(0): queued until flush() runs it, as the next frame would; longer waits never come
local nextFrame = {}
C_Timer = { After = function(d, fn) if d == 0 then nextFrame[#nextFrame + 1] = fn end end, NewTimer = function() return { Cancel = function() end } end }
local function flush() local n = 0 while #nextFrame > 0 and n < 100 do n = n + 1 table.remove(nextFrame, 1)() end end
issecretvalue = function() return false end
local ME = "Solex"
UnitName = function(u) if u == "player" then return ME end end
local lead = true
UnitIsGroupLeader = function(u) return u == "player" and lead end
UnitIsGroupAssistant = function() return false end
local grouped = true
LE_PARTY_CATEGORY_INSTANCE = 2
IsInGroup = function(c) return grouped and c ~= 2 end
IsInRaid = function() return grouped end
GetNumGroupMembers = function() return 3 end -- the Addon check's three below
GetNumSubgroupMembers = function() return 2 end
GetCursorPosition = function() return 0, 0 end
C_InstanceEncounter = { IsEncounterInProgress = function() return false end }
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, SendAddonMessage = function() return 0 end }
local cvars = { nameplateShowEnemies = "1" }
GetCVar = function(name) return cvars[name] end
GetDifficultyInfo = function(id) if id == 16 then return "Mythic" end end
RAID_CLASS_COLORS = { MAGE = { r = 0.25, g = 0.78, b = 0.92 }, WARRIOR = { r = 0.78, g = 0.61, b = 0.43 } }
GameTooltip = { lines = {} }
function GameTooltip:SetText(t) self.lines = { t } end
function GameTooltip:AddLine(t) self.lines[#self.lines + 1] = t end
function GameTooltip:Show() end
function GameTooltip:Hide() end

-- frames: what the page set on each, every unknown call taken and ignored
local all = {}
local function mock(kind, parent)
  local m = { kind = kind, parent = parent, shown = true, scripts = {}, points = {}, enabled = true, events = {} }
  local methods = {
    SetText = function(self, t) self.text = t end, GetText = function(self) return self.text end,
    SetShown = function(self, v) self.shown = v and true or false end,
    Show = function(self) self.shown = true if self.scripts.OnShow then self.scripts.OnShow(self) end end,
    Hide = function(self) self.shown = false if self.scripts.OnHide then self.scripts.OnHide(self) end end,
    IsShown = function(self) return self.shown end,
    SetEnabled = function(self, v) self.enabled = v and true or false end,
    IsEnabled = function(self) return self.enabled end,
    SetScript = function(self, k, fn) self.scripts[k] = fn end, GetScript = function(self, k) return self.scripts[k] end,
    SetPoint = function(self, ...) self.points[#self.points + 1] = { ... } end, ClearAllPoints = function(self) self.points = {} end,
    SetSize = function(self, w, h) self.w, self.h = w, h end, SetWidth = function(self, w) self.w = w end, SetHeight = function(self, h) self.h = h end,
    GetWidth = function(self) return self.w or 0 end, GetHeight = function(self) return self.h or 0 end,
    SetChecked = function(self, v) self.checked = v and true or false end, GetChecked = function(self) return self.checked end,
    SetTextColor = function(self, r, g, b) self.color = { r, g, b } end,
    HasFocus = function() return false end, ClearFocus = function() end,
    GetFontString = function(self) if not self.fs then self.fs = mock("FontString", self) end return self.fs end,
    GetStringWidth = function(self) return #(self.text or "") * 6 end,
    GetParent = function(self) return self.parent end,
    GetObjectType = function(self) return self.kind end,
    CreateFontString = function(self) return mock("FontString", self) end,
    CreateTexture = function(self) return mock("Texture", self) end,
    RegisterEvent = function(self, e) self.events[e] = true end, UnregisterEvent = function(self, e) self.events[e] = nil end,
    UnregisterAllEvents = function(self) self.events = {} end,
    SetMotionScriptsWhileDisabled = function(self, v) self.motionWhileDisabled = v end,
    SetAlpha = function(self, a) self.alpha = a end,
    IsMouseOver = function(self) return self.mouseOver and true or false end,
    HookScript = function(self, k, fn) local old = self.scripts[k] self.scripts[k] = old and function(...) old(...) fn(...) end or fn end,
    SetBackdropBorderColor = function(self, r, g, b) self.border = { r, g, b } end,
  }
  all[#all + 1] = m
  return setmetatable(m, { __index = function(_, k) if methods[k] then return methods[k] end if type(k) == "string" and k:match("^%u") then return function() end end end })
end
CreateFrame = function(kind, _, parent) return mock(kind or "Frame", parent) end
UIParent = mock("Frame")
CRTFontButtonSmall, CRTFontButtonSmallHighlight, CRTFontButtonSmallDisable, CRTFontEdit = {}, {}, {}, {}

-- the UI stand-ins
local pages, shown, tabs, rows, picked, helps = {}, {}, {}, {}, {}, {}
local UI = { PAGE_W = 1026, PAGE_H = 560 }
function UI:RegisterPage(key, title, builder) pages[key] = { key = key, title = title, builder = builder } end
function UI:SetPageHidden(key, hidden) if pages[key] then pages[key].hidden = hidden and true or false end end
function UI:Show(key) shown[#shown + 1] = key end
function UI:RegisterTab(b) tabs[#tabs + 1] = b end
function UI:SetTabSelected(b, on) b.selected = on end
function UI:SkinEditBox(e) e.skinned = true end
function UI.PanelButtonWidth(w) return math.max(40, math.ceil(w) + 28) end
function UI.PanelButton(parent, text, h, onClick) local b = mock("Button", parent) b.text = text b.h = h b.scripts.OnClick = onClick return b end
function UI.TooltipOwner() end
function UI.Help(parent, title, text) local m = mock("Button", parent) m.helpTitle, m.helpText = title, text helps[#helps + 1] = m return m end
local function row(kind, parent, text, opts, extra)
  local r = mock("Frame", parent)
  r.label, r.opts, r.rowKind = text, opts, kind
  r.w = (opts.labelWidth or 140) + 5 + (opts.width or 200) + (extra or 0)
  r.h = 32
  -- as UI.Dropdown's refresh does: GenerateMenu runs the menu's generator, which asks options()
  r.refresh = function()
    if kind == "dropdown" and type(opts.options) == "function" then opts.options() end
    if opts.enabledIf then r.enabled = opts.enabledIf() and true or false end
  end
  rows[#rows + 1] = r
  return r
end
function UI.Dropdown(parent, text, opts) return row("dropdown", parent, text, opts) end
function UI.SoundDropdown(parent, text, opts) return row("sound", parent, text, opts, 50 + 24) end
function UI.Slider(parent, text, opts) return row("slider", parent, text, opts, 44) end
function UI.PickColor(color, set, opts) picked[#picked + 1] = { color = color, set = set, opts = opts } end
function UI.Window(name, opts) local w = mock("Frame") w.content = mock("Frame", w) w.content.h = 300 w.strip = mock("Frame", w) w.name, w.opts = name, opts w.shown = false return w end
function UI.ScrollGutter(w) return 6 + (w or 18) end
local skinnedBars = 0
function UI:SkinScrollBar() skinnedBars = skinnedBars + 1 end
local CRT = { UI = UI, db = { interrupts = { enabled = false, own = {}, shared = {}, use = {}, accept = true, test = false,
  plates = { on = true, all = false, size = 50, font = 24, offset = 20, mineBox = { 0, 1, 0, 1 }, mineText = { 1, 0, 0, 1 }, box = { 1, 0, 0, 1 }, text = { 1, 1, 1, 1 } },
  reminder = { on = true, sound = "none", size = 48 } } } }
CRT_THEME(CRT, UI)
local printed = {}
function CRT:Print(m) printed[#printed + 1] = m end
local words = {}
CRT.Slash = { Register = function(_, word, def) words[word] = def end }
-- the Addon check: the group and each member's answer
local ROSTER = { { name = "Solex", class = "MAGE", online = true }, { name = "Brenn", class = "WARRIOR", online = true }, { name = "Quick-Kazzak", class = "MAGE", online = true } }
local STATES = { Solex = { "you", "1.2.0", { interrupts = true } }, Brenn = { "same", "1.2.0", { interrupts = false } }, ["Quick-Kazzak"] = { "none" } }
local asked, checkListeners = 0, {}
CRT.AddonCheck = { Register = function() end, Roster = function() return ROSTER end,
  Status = function(_, r) local s = STATES[r.name] or { "waiting" } return s[1], s[2], s[3] end,
  OnChange = function(_, fn) checkListeners[#checkListeners + 1] = fn end, MaybeCheck = function() asked = asked + 1 end, Check = function() end }
local previewed = 0
CRT.InterruptReminder = { Preview = function() previewed = previewed + 1 end }
CRT.db.notes = { list = {}, nextId = 1 }
CRT.db.classCache = { tovi = "WARRIOR" }
-- Raid Groups: one layout, as the note editor's Players from reads it
local MAIN = { "Tovi-Kazzak", "", "Solex", "Brenn" }
local groupsListeners = {}
CRT.Groups = { Presets = function() return { { id = 7, name = "Main" } } end,
  Find = function(_, id) if id == 7 then return { slots = MAIN } end end,
  OnChange = function(_, fn) groupsListeners[#groupsListeners + 1] = fn end }
for _, src in ipairs({ registrySrc, seasonSrc, bossSrc, commSrc, parseSrc, notesSrc, editModelSrc, paletteSrc, latticeSrc, setupSrc, dataSrc }) do assert(load(src))("CowfeeRaidTools", CRT) end
CRT.Bosses:Get(3470).interrupts = { { difficulty = 16, label = "Kick", groups = { { key = "left", label = "Left", slots = 5 }, { key = "right", label = "Right", slots = 5 } },
  timing = { anchor = { unit = "boss2", cycle = 7, ordinal = 5, times = { 33, 94, 188, 249, 343, 404 } },
  firstCast = 4.5, spacing = 1.0, tolerance = 0.3, adds = 10, perNumber = 2, window = 25 }, note = "Mythic only here." } }
-- a second boss with another shape: one group of seven
CRT.Bosses:Register({ encounterID = 3421, name = "Second Boss", season = "sample", interrupts = { { difficulty = 16, label = "Stop",
  groups = { { key = "north", label = "North", slots = 7 } },
  timing = { anchor = { unit = "boss1", cycle = 3, ordinal = 1, times = { 20 } }, firstCast = 2, spacing = 1.5, tolerance = 0.3, adds = 7,
  perNumber = 1, window = 20 } } } })
local shownExport
CRT.ConsumablesTools = { ShowText = function(_, _, text) shownExport = text end }
for _, src in ipairs({ anchorSrc, kickSrc, noteBlockSrc, pageSrc, gridSrc, pagePaletteSrc, whoSrc, editorSrc, exportSrc }) do assert(load(src))("CowfeeRaidTools", CRT) end
local I, P = CRT.Interrupts, CRT.InterruptsPage
-- P.Refresh draws on the next frame: here, the frame comes at once, so a check after it sees the page drawn
do local queue = P.Refresh P.Refresh = function() queue() flush() end end
local T = P.TEXT
local id = 3470

check(pages.interrupts ~= nil, "page: registered")
eq(pages.interrupts and pages.interrupts.title, "Interrupts", "page: its title")
check(pages.interrupts.hidden, "page: hidden until the module is on")
I:SetEnabled(true); check(not pages.interrupts.hidden, "switch: on shows the page")
local pf = mock("Frame"); pf.w, pf.h = UI.PAGE_W, UI.PAGE_H
pf.shown = false
pages.interrupts.builder(pf)
pf:Show()
eq(#tabs, 2, "page: two tabs"); eq(P.tabs.settings.label, "Settings", "page: settings last")
eq(tabs[2].text and tabs[2].text.text, "Settings", "page: the second tab button is Settings")
check(P.tabs.assignments.frame.shown and not P.tabs.settings.frame.shown, "page: opens on Assignments")
eq(asked, 1, "page: opening asks the Addon check when stale")
eq(#P.BossOptions(), 2, "page: the two bosses with a block listed")
eq(P.BossOptions()[1].label, "Nek'zali the Soulcoiler \\194\\183 Mythic", "page: the boss with its difficulty")

-- the work per show (#1211): the group read, the Raid Groups layouts read, the page refreshed and the note read, at most
-- once each when the page is shown again, and the Addon check's answer arriving while it shows coalesced into one refresh
do
  flush()
  local n = { roster = 0, layouts = 0, refresh = 0, note = 0 }
  local realRoster, realPresets, realStatus, realRead = CRT.AddonCheck.Roster, CRT.Groups.Presets, P.Status, CRT.InterruptNote.ReadInto
  CRT.AddonCheck.Roster = function(...) n.roster = n.roster + 1 return realRoster(...) end
  CRT.Groups.Presets = function(...) n.layouts = n.layouts + 1 return realPresets(...) end
  P.Status = function(...) n.refresh = n.refresh + 1 return realStatus(...) end
  CRT.InterruptNote.ReadInto = function(...) n.note = n.note + 1 return realRead(...) end
  -- the group changed while the page was hidden: the next show works it out again, once
  pf:Hide()
  local told = 0
  for _, f in ipairs(all) do
    if f.events.GROUP_ROSTER_UPDATE and f.scripts.OnEvent then f.scripts.OnEvent(f, "GROUP_ROSTER_UPDATE") told = told + 1 end
  end
  check(told > 0, "perf: something follows the group while the page is hidden")
  pf:Show()
  for _, fn in ipairs(checkListeners) do fn("reply") end
  flush()
  print(string.format("work per show: %d roster builds, %d layout reads, %d refreshes, %d note reads", n.roster, n.layouts, n.refresh, n.note))
  eq(n.roster, 1, "perf: the changed group read once a show")
  eq(n.layouts, 1, "perf: the Raid Groups layouts read once a show")
  eq(n.refresh, 1, "perf: one refresh a show")
  check(n.note <= 1, "perf: the note read at most once a show (got " .. n.note .. ")")
  -- shown again with nothing changed: the group and layouts come from the cache, the note isn't read again
  for k in pairs(n) do n[k] = 0 end
  pf:Hide(); pf:Show(); flush()
  print(string.format("work per show, nothing changed: %d roster builds, %d layout reads, %d refreshes, %d note reads", n.roster, n.layouts, n.refresh, n.note))
  eq(n.roster, 0, "perf: nothing changed, the group from the cache")
  eq(n.layouts, 0, "perf: nothing changed, the layouts from the cache")
  eq(n.note, 0, "perf: nothing changed, the note not read again")
  eq(n.refresh, 1, "perf: and one refresh")
  CRT.AddonCheck.Roster, CRT.Groups.Presets, P.Status, CRT.InterruptNote.ReadInto = realRoster, realPresets, realStatus, realRead
end

-- the status bar and Share
local function statusText() return plain(P.status.text) end
eq(statusText(), T.statusNone, "status: no list")
check(P.share.motionWhileDisabled == true, "share: its tooltip shows while it is greyed (SetMotionScriptsWhileDisabled)")
check(not P.share.enabled and P.share.crtReason and P.share.crtReason:find("all 10", 1, true), "share: disabled with the slots reason: " .. tostring(P.share.crtReason))
P.share.scripts.OnEnter(P.share)
check(GameTooltip.lines[2] and GameTooltip.lines[2]:find("all 10", 1, true), "share: its tooltip says why")
local function fillOwn(withMe)
  local n = 0
  for g = 1, 2 do for s = 1, 5 do n = n + 1 I:SetName(id, g, s, (withMe and g == 1 and s == 3) and "Solex" or ("P" .. n)) end end
end
fillOwn(true); P.Refresh()
check(statusText():find(T.statusOwn, 1, true) == 1, "status: your own list: " .. statusText())
check(statusText():find("Your kick: Kick #3 Left.", 1, true), "status: and your kick")
eq(P.statusKind, "warn", "status: your own list is a warning")
check(P.share.enabled and P.share.crtReason == nil, "share: enabled with a full list, as the leader")
local list = { {}, {} }
for g = 1, 2 do for s = 1, 5 do list[g][s] = "R" .. g .. s end end
list[2][1] = "Solex"
I:ReceiveShared(id, list, "Brenn"); P.Refresh()
check(statusText():find("Your kick", 1, true) and statusText():find("from Brenn", 1, true), "status: the raid's list and your kick: " .. statusText())
eq(P.statusKind, "good", "status: the raid's list with you on it is good")
list[2][1] = "Other"; I:ReceiveShared(id, list, "Brenn"); P.Refresh()
check(statusText():find(T.notOn, 1, true), "status: not on the raid's list")
eq(P.statusKind, "warn", "status: and a warning")
cvars.nameplateShowEnemies = "0"; P.Refresh()
eq(statusText(), "Enemy nameplates are off (Interface > Nameplates), so no numbers can show.", "status: warns when enemy nameplates are off")
eq(P.statusKind, "warn", "status: in the warn colour")
cvars.nameplateShowEnemies = "1"; P.Refresh()
check(not statusText():find("nameplates", 1, true), "status: back on, the warning goes")
C_CVar = { GetCVar = function(name) return name == "nameplateShowEnemies" and "0" or "1" end }
P.Refresh()
check(statusText():find("nameplates", 1, true), "status: read through C_CVar.GetCVar first")
C_CVar = nil; P.Refresh()

-- the kick rows (the note editor's group rows): your own list in kick order, class coloured, your own outlined,
-- read-only for a raider
local function chipsOf(g)
  local out, row = {}, P.rows[g]
  if not (row and row.shown) then return out end
  for _, c in ipairs(row.chips) do if c.shown then out[#out + 1] = c end end
  return out
end
local function namesOf(g)
  local t = {}
  for _, c in ipairs(chipsOf(g)) do t[#t + 1] = (plain(c.text.text):gsub("^%d+ ", "")) end
  return table.concat(t, ",")
end
local function isKey(c, key) local p = CRT.PALETTE[key] return c and math.abs(c[1] - p[1]) < 1e-6 and math.abs(c[2] - p[2]) < 1e-6 and math.abs(c[3] - p[3]) < 1e-6 end
local drag = P.dragState.drag.opts
eq(namesOf(1), "P1,P2,Solex,P4,P5", "rows: your own list in kick order")
eq(plain(chipsOf(1)[3].text.text), "3 Solex", "rows: a chip is its kick number, then the name")
eq(chipsOf(1)[3].text.color and chipsOf(1)[3].text.color[1], 0.25, "rows: a group member in their class colour")
check(chipsOf(1)[1].text.color and chipsOf(1)[1].text.color[1] ~= 0.25, "rows: anyone else in the text colour")
check(isKey(chipsOf(1)[3].border, "heading") and not isKey(chipsOf(1)[1].border, "heading"), "rows: your own chip outlined")
check(P.rows[1].label.text:find("Left", 1, true) and P.rows[1].label.text:find("5/5", 1, true), "rows: the label, and how many slots are filled: " .. tostring(P.rows[1].label.text))
check(P.rows[1].kind == "Button" and P.rows[1].chips ~= nil, "rows: made by the note editor's row (Palette.MakeRow)")
check(chipsOf(1)[1].remove.shown, "rows: x on each chip for the leader")
check(not P.rows[1].add.shown, "rows: a full row has no Add name")
check(P.rows[1].add.skinned, "rows: Add name follows the theme (UI:SkinEditBox)")
lead = false; P.Refresh()
check(not chipsOf(1)[1].remove.shown, "rows: no x for a raider in a group")
check(drag.readOnly(), "rows: no drag for a raider")
check(not P.DropKick({ name = "Brenn" }, { g = 1 }), "rows: a raider's drop refused")
check(not P.RemoveKick(1, 1), "rows: a raider's x refused")
grouped = false; P.Refresh()
check(chipsOf(1)[1].remove.shown and not drag.readOnly(), "rows: editable solo")
grouped, lead = true, true; P.Refresh()

-- the palette: your group, then each Raid Groups layout
local sections = P.PaletteSections()
eq(sections[1].title, "In your group", "palette: your group first")
eq(sections[1].entries[1].name, "Brenn", "palette: the group sorted")
eq(sections[1].entries[2].name, "Quick", "palette: names without realm")
eq(sections[2] and sections[2].title, "Raid Groups: Main", "palette: then each Raid Groups layout")
eq(sections[2] and sections[2].entries[1].name, "Tovi", "palette: a layout's players, without realm")
eq(sections[2] and sections[2].entries[1].class, "WARRIOR", "palette: a layout player's class from the class cache")
eq(sections[2] and sections[2].entries[2].name, "Solex", "palette: the layout's slots in order")
eq(sections[2] and #sections[2].entries, 3, "palette: empty slots left out")
eq(#sections, 2, "palette: nothing else")
local pchips = 0
for _, c in ipairs(P.dragState.paletteChips) do if c.shown then pchips = pchips + 1 end end
eq(pchips, 6, "palette: a chip per player in each section")
eq(P.dragState.paletteChips[1].source.name, "Brenn", "palette: a chip drags its name")
check(P.paletteHelp and P.paletteHelp.helpTarget == P.paletteHead, "palette: how to drag in its (?)")

-- drops: from the palette, along a row, onto another row; a full row refuses
I:Clear(id); P.Refresh()
eq(namesOf(1), "", "drop: an empty row")
check(P.rows[1].add.shown, "drop: Add name on a row with room")
drag.drop({ name = "Brenn" }, { g = 1 }); flush()
drag.drop({ name = "Quick" }, { g = 1 }); flush()
drag.drop({ name = "Solex" }, { g = 1, at = 1 }); flush()
eq(namesOf(1), "Solex,Brenn,Quick", "drop: dropped on a chip, a name takes its place")
eq(I:Own(id)[1][1] .. "," .. I:Own(id)[1][2] .. "," .. I:Own(id)[1][3], "Solex,Brenn,Quick", "drop: saved slot by slot")
check(P.rows[1].label.text:find("3/5", 1, true), "drop: the count follows")
drag.drop({ g = 1, k = 1 }, { g = 1 }); flush()
eq(namesOf(1), "Brenn,Quick,Solex", "drop: along the row to its end")
drag.drop({ g = 1, k = 3 }, { g = 1, at = 1 }); flush()
eq(namesOf(1), "Solex,Brenn,Quick", "drop: along the row onto the first")
drag.drop({ g = 1, k = 2 }, { g = 2 }); flush()
eq(namesOf(1) .. "|" .. namesOf(2), "Solex,Quick|Brenn", "drop: onto another row moves it, the gap closed up")
eq(I:Own(id)[1][3], "", "drop: the last slot emptied")
chipsOf(1)[1].remove.scripts.OnClick(chipsOf(1)[1].remove); flush()
eq(namesOf(1), "Quick", "x: takes the chip off, the rest close up")
eq(plain(chipsOf(1)[1].text.text), "1 Quick", "x: the numbers follow the order")
for s = 1, 5 do I:SetName(id, 2, s, "F" .. s) end
P.Refresh()
check(not P.DropKick({ name = "Brenn" }, { g = 2 }), "full: a drop on a full row refused")
check(not P.DropKick({ g = 1, k = 1 }, { g = 2, at = 1 }), "full: a move onto a full row refused")
eq(namesOf(1) .. "|" .. namesOf(2), "Quick|F1,F2,F3,F4,F5", "full: nothing changed")
check(P.DropKick({ g = 2, k = 5 }, { g = 2, at = 1 }), "full: a full row can still be put in another order")
P.Refresh()
eq(namesOf(2), "F5,F1,F2,F3,F4", "full: in the new order")
eq(P.MoveKick({ { "A", "B" } }, { 2 }, { name = "C" }, { g = 1 }), nil, "move: refused on a full row")
eq(P.MoveKick({ { "A", "B" } }, { 3 }, { g = 1, k = 2 }, { g = 1 }), nil, "move: the last chip to the end changes nothing")
local addBox = P.rows[1].add
addBox.text = "  Typed-Realm "; addBox.scripts.OnEnterPressed(addBox); flush()
eq(namesOf(1), "Quick,Typed", "add: a typed name at the row's end, trimmed and without realm")
-- the row and chip under the mouse
P.gridScroll.mouseOver, P.rows[2].mouseOver, chipsOf(2)[2].mouseOver = true, true, true
local tgt = P.KickTarget()
check(tgt and tgt.g == 2 and tgt.at == 2, "target: the row and the chip under the mouse")
chipsOf(2)[2].mouseOver = false
tgt = P.KickTarget()
check(tgt and tgt.g == 2 and tgt.at == nil, "target: the row's end")
P.gridScroll.mouseOver, P.rows[2].mouseOver = false, false
check(P.KickTarget() == nil, "target: none outside the rows")

-- a gap in a saved list (the old per-slot fields): the chip's number is the kick number the plates and status use
do
  I:Clear(id)
  CRT.db.interrupts.kicks[3470][16].own.left = { "P1", "", "Solex", "", "" }
  I:SetUse(id, "own"); P.Refresh()
  eq(plain(chipsOf(1)[2].text.text), "2 Solex", "gap: closed up on the page")
  eq(select(1, I:Mine(id)), 2, "gap: the same number for the plates and the reminder (Interrupts:Mine)")
  check(plain(P.status.text):find("Your kick: Kick #2 Left.", 1, true), "gap: and the status bar: " .. plain(P.status.text))
  eq(CRT.db.interrupts.kicks[3470][16].own.left[2], "Solex", "gap: closed up in the saved list")
  -- a name a row has already is refused, case and realm left out
  check(not P.DropKick({ name = "solex-Kazzak" }, { g = 1 }), "dup: a name the row has is refused")
  check(P.DropKick({ name = "Solex" }, { g = 2 }), "dup: the same name on another row is fine")
  check(not P.DropKick({ g = 2, k = 1 }, { g = 1 }), "dup: and can't move onto a row that has it")
  I:Clear(id); P.Refresh()
end

-- a row drawn again mid-drag: the drop carries the name it picked up, and a chip now holding another drops nothing
do
  for s, n in ipairs({ "Solex", "Brenn" }) do I:SetName(id, 1, s, n) end
  P.Refresh()
  local D = P.dragState.drag
  local chip = chipsOf(1)[1]
  D:Down(chip, "LeftButton")
  P.dragState.press.dragging = true
  -- the list changes under the drag: chip 1 is now Brenn
  I:SetName(id, 1, 1, "Brenn"); I:SetName(id, 1, 2, "Solex"); P.Refresh()
  P.gridScroll.mouseOver, P.rows[2].mouseOver = true, true
  D:Up(chip)
  eq(namesOf(1) .. "|" .. namesOf(2), "Brenn,Solex|", "drag: a chip drawn again with another name drops nothing")
  check(P.dragState.press == nil, "drag: and the press ends")
  -- drawn again with the same name: the drop goes on, from where the chip is now
  D:Down(chip, "LeftButton")
  P.dragState.press.dragging = true
  P.Refresh()
  D:Up(chip); flush()
  eq(namesOf(1) .. "|" .. namesOf(2), "Solex|Brenn", "drag: drawn again with the same name, it drops")
  P.gridScroll.mouseOver, P.rows[2].mouseOver = false, false
  I:Clear(id); P.Refresh()
end

-- the cache: a Raid Groups change, another boss, a group read while a name was secret
do
  local before = P.counts.layouts
  MAIN[2] = "Newcomer"
  for _, fn in ipairs(groupsListeners) do fn() end
  local found = false
  for _, e in ipairs(P.PaletteSections()[2].entries) do if e.name == "Newcomer" then found = true end end
  check(found, "cache: a Raid Groups change shows on the palette")
  eq(P.counts.layouts, before + 1, "cache: the layouts read again once")
  MAIN[2] = ""
  for _, fn in ipairs(groupsListeners) do fn() end
  local r = P.counts.roster
  P.bossRow.opts.set("3470:16"); flush()
  eq(P.counts.roster, r + 1, "cache: another boss reads the group again")
  P.Refresh()
  eq(P.counts.roster, r + 1, "cache: and keeps it")
  ROSTER[2].class = nil -- a class the game wouldn't say (a secret value)
  P.ClearCache(); P.Refresh()
  r = P.counts.roster
  P.Refresh()
  eq(P.counts.roster, r + 1, "cache: a group read with a class unreadable is read again on the next draw")
  ROSTER[2].class = "WARRIOR"
  P.Refresh(); r = P.counts.roster
  P.Refresh()
  eq(P.counts.roster, r, "cache: whole again, kept")
  local told = {}
  for _, f in ipairs(all) do
    for _, e in ipairs({ "PLAYER_REGEN_ENABLED", "ENCOUNTER_END" }) do
      if f.events[e] and f.scripts.OnEvent then told[e] = true end
    end
  end
  check(told.PLAYER_REGEN_ENABLED and told.ENCOUNTER_END, "cache: cleared after combat and after a pull")
end

-- Use the raid's list and Clear list ask first
check(P.useRaid.enabled, "use raid: there is a raid's list")
P.useRaid.scripts.OnClick(P.useRaid)
local dlg
for _, f in ipairs(all) do if f.name == "CowfeeRaidToolsKickConfirm" then dlg = f end end
check(dlg and dlg.shown, "use raid: asks first")
dlg.ok.scripts.OnClick(dlg.ok)
eq(I:Own(id)[2][1], "Other", "use raid: the raid's list copied over your own")
P.clear.scripts.OnClick(P.clear)
check(dlg.shown and plain(dlg.msg.text):find("Empty every name", 1, true), "clear: asks first")
eq(I:Own(id)[1][1], "R11", "clear: nothing cleared before OK")
dlg.cancel.scripts.OnClick(dlg.cancel)
eq(I:Own(id)[1][1], "R11", "clear: Cancel keeps it")
P.clear.scripts.OnClick(P.clear); dlg.ok.scripts.OnClick(dlg.ok)
eq(I:Own(id)[1][1], "", "clear: OK empties your own list")

-- Who has it: a pop-out window opened by its button, and How the numbers are worked out in a (?)
fillOwn(true); I:SetUse(id, "own")
I:SetName(id, 1, 4, "Brenn"); I:SetName(id, 1, 5, "Quick"); P.Refresh()
eq(P.whoButton and plain(P.whoButton.text), "Who has it (1 of 10)", "who: the button counts who has it")
check(P.Who.window == nil, "who: no window until it is opened")
local statusCalls = 0
do
  local realMember = P.MemberOf
  P.MemberOf = function(...) statusCalls = statusCalls + 1 return realMember(...) end
  P.whoButton.scripts.OnClick(P.whoButton)
  P.MemberOf = realMember
end
local WW = P.Who.window
eq(statusCalls, 20, "who: filled once as it opens (ten names: each one's state and colour)")
do
  statusCalls = 0
  local realMember = P.MemberOf
  P.MemberOf = function(...) statusCalls = statusCalls + 1 return realMember(...) end
  WW.scripts.OnSizeChanged(WW)
  P.MemberOf = realMember
  eq(statusCalls, 20, "who: filled once as its size changes")
end
check(WW and WW.shown and WW.opts.kind == "popout", "who: the button opens a pop-out (UI.Window)")
check(WW.opts.saved() == CRT.db.interrupts.whoWindow, "who: its place kept in the saved settings")
WW.content.h = 300
P.Who.Refresh()
local function whoRows()
  local out = {}
  for _, r in ipairs(WW.rows) do if r.name.shown and r.name.text and r.name.text ~= "" then out[#out + 1] = r end end
  return out
end
local who = {}
for _, r in ipairs(whoRows()) do who[plain(r.name.text)] = plain(r.state.text) end
eq(who.Solex, "you, v1.2.0", "who: you, with Interrupts on")
eq(who.Brenn, "Interrupts off", "who: a CRT with Interrupts off")
eq(who.Quick, "No CRT", "who: no CRT")
eq(who.P1, "not in your group", "who: a name not in the group")
check(P.WhoText("Solex"):find("|cff", 1, true) == 1, "who: in colour")
-- each player once, in the order they first appear, however many slots they fill (Alex's screenshot: Solex four times)
for s = 1, 4 do I:SetName(id, 2, s, "Solex") end
I:SetName(id, 1, 1, "Brenn"); P.Refresh()
local order, count = {}, {}
for _, r in ipairs(whoRows()) do
  local n = plain(r.name.text)
  order[#order + 1] = n count[n] = (count[n] or 0) + 1
end
eq(count.Solex, 1, "who: Solex once though on five slots")
eq(count.Brenn, 1, "who: Brenn once though on two")
eq(table.concat(order, ","), "Brenn,P2,Solex,Quick,P10", "who: in the order they first appear on the list")
eq(table.concat(P.WhoNames({ { "A", "b", "" }, { "B", "a", "C" } }), ","), "A,b,C", "who: case left out, empty slots left out")
eq(#P.WhoNames({}), 0, "who: nobody on an empty list")
check(WW.check and WW.check.text == "Check now", "who: Check now in the window")
do
  local list = { {} }
  for i = 1, 20 do list[1][i] = "N" .. i end
  local realList = I.List
  I.List = function() return list, "own" end
  P.Who.Refresh()
  local shown = whoRows()
  eq(#shown, 15, "who: as many rows as fit the window")
  eq(plain(shown[#shown].name.text), "and 6 more", "who: more names than rows end in how many more")
  I.List = realList
  P.Who.Refresh()
end
-- closed, it does no work
do
  WW:Hide()
  local asked = 0
  local realStatus = CRT.AddonCheck.Status
  CRT.AddonCheck.Status = function(...) asked = asked + 1 return realStatus(...) end
  P.Who.Refresh()
  I:SetName(id, 1, 2, "Quick")
  eq(asked, 0, "who: closed, the Addon check isn't read for it")
  CRT.AddonCheck.Status = realStatus
  P.whoButton.scripts.OnClick(P.whoButton)
  check(WW.shown, "who: the button opens it again")
  P.whoButton.scripts.OnClick(P.whoButton)
  check(not WW.shown, "who: and closes it")
end
fillOwn(true); I:SetName(id, 1, 4, "Brenn"); I:SetName(id, 1, 5, "Quick"); P.Refresh()
eq(P.listHead and P.listHead.text, "Kick list", "how: the Kick list heading")
check(P.howHelp and P.howHelp.helpTarget == P.listHead and P.howHelp.helpText == P.HowText, "how: How the numbers are worked out in its (?)")
local how = P.HowText()
check(how:find(T.howHelp, 1, true) == 1, "how: the setup's note first")
for _, line in ipairs({ "A wave starts at cast 5 of every 7 from boss2.", "Add 1 casts 4.5 s after it, then one every 1 s.",
  "A cast more than 0.3 s off its beat is not an add.", "10 adds a wave, 2 to a number.", "A cast over 25 s after the wave's start is not in it.",
  "Without a cast count, waves start at 0:33, 1:34, 3:08, 4:09, 5:43, 6:44." }) do
  check(how:find(line, 1, true), "how: " .. line)
end
local bossHelp
for _, h in ipairs(helps) do if h.helpTarget == P.bossRow then bossHelp = h end end
check(bossHelp and type(bossHelp.helpText) == "function" and bossHelp.helpText():find("Mythic only here.", 1, true), "boss: the block's note in its (?)")
for _, h in ipairs(helps) do check(h.helpTarget ~= nil, "help: every (?) placed by UI.HelpRight: " .. tostring(h.helpTitle)) end

-- Test on trash and Preview reminder
P.test.checked = true; P.test.scripts.OnClick(P.test)
check(CRT.InterruptAnchor.armed and CRT.InterruptAnchor.mode == "test", "test: ticking arms test mode")
P.test.checked = false; P.test.scripts.OnClick(P.test)
check(not CRT.InterruptAnchor.armed, "test: unticking stops it")
P.preview.scripts.OnClick(P.preview)
eq(previewed, 1, "preview: the reminder's preview")

-- the Settings tab
P.SelectTab("settings")
check(P.tabs.settings.frame.shown and not P.tabs.assignments.frame.shown, "settings: the tab shows")
local fired = {}
I:OnChange(function(what) fired[#fired + 1] = what end)
local function rowNamed(label) for _, r in ipairs(rows) do if r.label == label then return r end end end
local size = rowNamed(T.size)
check(size and size.opts.min == 10 and size.opts.max == 100, "settings: box size 10 to 100")
size.opts.set(70); eq(CRT.db.interrupts.plates.size, 70, "settings: box size saved")
eq(fired[#fired], "settings", "settings: a change is told at once")
local font = rowNamed(T.font); check(font and font.opts.min == 8 and font.opts.max == 60, "settings: number size 8 to 60")
local offset = rowNamed(T.offset); check(offset and offset.opts.min == -100 and offset.opts.max == 100, "settings: height -100 to 100")
local rsize = rowNamed(T.reminderSize); check(rsize and rsize.opts.min == 16 and rsize.opts.max == 128, "settings: reminder size 16 to 128")
local sound = rowNamed(T.sound); check(sound and sound.rowKind == "sound" and sound.opts.playButton and sound.opts.help, "settings: the sound dropdown with Play and its (?)")
sound.opts.set("kit:8960"); eq(CRT.db.interrupts.reminder.sound, "kit:8960", "settings: the sound saved")
local swatches = 0
for _, f in ipairs(all) do if f.kind == "Button" and f.scripts.OnClick and f.parent == P.tabs.settings.frame and f.w == 36 then swatches = swatches + 1 f.scripts.OnClick(f) end end
eq(swatches, 4, "settings: four colour swatches")
eq(#picked, 4, "settings: each opens the colour picker")
picked[1].set({ 0.5, 0.5, 0.5, 1 })
eq(CRT.db.interrupts.plates.mineBox[1], 0.5, "settings: your box colour saved")
check(picked[1].opts and picked[1].opts.hasOpacity, "settings: with its opacity")

-- the controls under a switch grey out while it is off
CRT.db.interrupts.plates.on = false; P.Refresh()
check(rowNamed(T.size).enabled == false and rowNamed(T.font).enabled == false and rowNamed(T.offset).enabled == false, "settings: the box sliders grey with numbers off")
check(P.allCheck.enabled == false, "settings: Show every number greys with numbers off")
local function isColor(c, key) local p = CRT.PALETTE[key] return c and math.abs(c[1] - p[1]) < 1e-6 and math.abs(c[2] - p[2]) < 1e-6 and math.abs(c[3] - p[3]) < 1e-6 end
check(isColor(P.allCheck.label.color, "muted"), "settings: a greyed checkbox's label in the theme's muted colour")
for _, sw in ipairs(P.swatches) do
  check(sw.button.enabled == false and sw.button.alpha and sw.button.alpha < 1, "settings: a greyed swatch is dimmed")
  check(isColor(sw.label.color, "muted"), "settings: and its label muted")
end
CRT.db.interrupts.plates.on = true; P.Refresh()
check(rowNamed(T.size).enabled and P.allCheck.enabled, "settings: and come back")
check(isColor(P.allCheck.label.color, "text"), "settings: the label back in the theme's text colour")
for _, sw in ipairs(P.swatches) do
  check(sw.button.enabled and sw.button.alpha == 1 and isColor(sw.label.color, "text"), "settings: the swatch and its label back")
end
eq(#P.swatches, 4, "settings: four swatches tracked")
CRT.db.interrupts.reminder.on = false; P.Refresh()
check(rowNamed(T.sound).enabled == false and rowNamed(T.reminderSize).enabled == false, "settings: the sound and size grey with the countdown off")
CRT.db.interrupts.reminder.on = true; P.Refresh()
check(rowNamed(T.sound).enabled and rowNamed(T.reminderSize).enabled, "settings: and come back")
P.SelectTab("assignments")

-- no boss with a setup: no rows
do
  local realBosses = I.Bosses
  I.Bosses = function() return {} end
  P.Refresh()
  check(not P.rows[1].shown and not P.rows[2].shown, "grid: no boss, no rows")
  I.Bosses = realBosses
  P.Refresh()
  check(P.rows[1].shown and P.rows[2].shown, "grid: back with the rows")
end

-- another boss's shape: the rows follow (pooled, the extras hidden, labels, the buttons under them)
local LAY = P.LAYOUT
local function yOf(f) return f.points[#f.points] and f.points[#f.points][3] end
local twoH = P.gridScroll.h
eq(yOf(P.clear), LAY.gridY - twoH - LAY.buttonGap, "shape: the buttons sit under the rows")
check(P.rows[1].points[1][3] == 0 and P.rows[2].points[1][3] < 0, "shape: a row per group, one under the other")
P.bossRow.opts.set("3421:16"); flush()
check(P.rows[1].label.text:find("North", 1, true), "shape: the group's label")
check(P.rows[1].label.text:find("/7", 1, true), "shape: seven slots")
check(not P.rows[2].shown, "shape: the second group's row hidden")
check(P.HowText():find("7 adds a wave, 1 to a number.", 1, true), "shape: How the numbers are worked out follows")
P.bossRow.opts.set("3470:16"); flush()
check(P.rows[2].shown, "shape: back to two groups")
eq(P.gridScroll.h, twoH, "shape: the list as tall as before")
eq(yOf(P.clear), LAY.gridY - twoH - LAY.buttonGap, "shape: the buttons back where they were")

-- an untimed setup by raid marker on another difficulty: listed with its difficulty, marker icons on its rows
GetDifficultyInfo = function(d) if d == 16 then return "Mythic" elseif d == 15 then return "Heroic" end end
CRT.Bosses:Get(3470).interrupts[2] = { difficulty = 15, spell = { name = "Wail of Terror" },
  groups = { { key = "skull", label = "Skull add", marker = 8, slots = 4 }, { key = "cross", label = "Cross add", marker = 7, slots = 4 } } }
I:ClearCache()
eq(#P.BossOptions(), 3, "untimed: listed")
eq(P.BossOptions()[2].label, "Nek'zali the Soulcoiler \\194\\183 Heroic", "untimed: with its difficulty")
P.bossRow.opts.set("3470:15"); flush()
check(P.rows[1].label.text:find("UI-RaidTargetingIcon_8", 1, true) and P.rows[1].label.text:find("Skull add", 1, true), "untimed: the row has its marker: " .. tostring(P.rows[1].label.text))
check(P.rows[2].label.text:find("/4", 1, true), "untimed: four slots a group")
for s = 1, 4 do check(P.DropKick({ name = "K" .. s }, { g = 1 }), "untimed: kick " .. s .. " fills the row") end
check(not P.DropKick({ name = "K5" }, { g = 1 }), "untimed: a fifth drop is refused")
I:Clear("3470:15")
check(P.HowText():find("Kicks: Wail of Terror.", 1, true), "how: the spell")
check(P.HowText():find("Skull add: 4 to kick.", 1, true), "how: each group and its marker")
-- Test on trash takes the setup shown
P.test.checked = true; P.test.scripts.OnClick(P.test)
eq(CRT.InterruptAnchor.key, "3470:15", "test: the setup shown")
P.test.checked = false; P.test.scripts.OnClick(P.test)

-- many groups: the rows scroll, the buttons stay inside the page
I:SetCustom("3470:15", { groups = (function() local g = {} for i = 1, 8 do g[i] = { key = "g" .. i, label = "Add " .. i, marker = i, slots = 10 } end return g end)() })
for g = 1, 8 do for s = 1, 10 do I:SetName("3470:15", g, s, "N" .. g .. s) end end
P.Refresh()
check(P.BossOptions()[2].label:find("your setup", 1, true), "custom: named as yours in the list")
check(P.rows[8] and P.rows[8].shown and #chipsOf(8) == 10, "scroll: eight groups of ten, all made")
check(P.gridContentH > LAY.gridMaxH, "scroll: taller than the room")
eq(P.gridScroll.h, LAY.gridMaxH, "scroll: the list scrolls past its room")
eq(P.gridChild.h, P.gridContentH, "scroll: the scroll child holds it all")
eq(yOf(P.clear), LAY.gridY - LAY.gridMaxH - LAY.buttonGap, "scroll: the buttons under the room")
check(yOf(P.clear) - 22 - LAY.testGap - 24 >= -(UI.PAGE_H - 66), "scroll: and inside the page")
I:DropCustom("3470:15")

-- Write to the raid note
P.bossRow.opts.set("3470:15")
for s, n in ipairs({ "Solex", "Brenn", "Quick", "Tovi" }) do I:SetName("3470:15", 1, s, n) end
P.Refresh()
check(P.write.enabled, "write: on for the leader")
P.write.scripts.OnClick(P.write)
local noteID = CRT.Notes:FindExact(3470, "Heroic")
check(noteID and CRT.Notes:Get(noteID).raw:find("intstart\\nSolex Brenn Quick Tovi\\nintend", 1, true), "write: the block in the Heroic note")
check(printed[#printed] == 'Wrote the kick list into the raid note "' .. CRT.Notes:Get(noteID).name .. '".', "write: names the note: " .. tostring(printed[#printed]))
lead = false; P.Refresh()
check(not P.write.enabled and P.write.crtReason, "write: off for a raider, with why")
lead = true; P.Refresh()
-- opening a boss reads its note's block into the raid's list
CRT.Notes:UpdateRaw(noteID, "EncounterID:3470;Difficulty:Heroic\\nintstart\\nA B C D\\nE F G H\\nintend\\n")
P.bossRow.opts.set("3470:16"); P.bossRow.opts.set("3470:15")
eq(select(2, I:List("3470:15")), "raid", "read: opening the boss reads its note")
eq(I:Shared("3470:15").list[2][1], "E", "read: the names")
-- a block with a gap left out is not read, and says so once
CRT.Notes:UpdateRaw(noteID, "EncounterID:3470;Difficulty:Heroic\\nintstart\\nA B C\\nintend\\n")
local said = #printed
P.bossRow.opts.set("3470:16"); P.bossRow.opts.set("3470:15")
eq(#printed, said + 1, "read: a block that doesn't fit says so")
check(printed[#printed]:find("doesn't fit", 1, true), "read: why: " .. tostring(printed[#printed]))
P.bossRow.opts.set("3470:16"); P.bossRow.opts.set("3470:15")
eq(#printed, said + 1, "read: once")
eq(I:Shared("3470:15").list[2][1], "E", "read: the raid's list kept")
-- shown again: the note read again only once its text changed
do
  local reads = P.counts.note
  pf:Hide(); pf:Show(); flush()
  eq(P.counts.note, reads, "read: shown again, the same note isn't read again")
  CRT.Notes:UpdateRaw(noteID, "EncounterID:3470;Difficulty:Heroic\\nintstart\\nW X Y Z\\nQ R S T\\nintend\\n")
  pf:Hide(); pf:Show(); flush()
  eq(P.counts.note, reads + 1, "read: a changed note is read again as the page shows")
  eq(I:Shared("3470:15").list[2][1], "Q", "read: its names")
end

-- Edit setup opens the setup editor on the setup shown
check(P.editSetup and P.editSetup.text == T.editSetup, "edit: the button beside Boss")
P.editSetup.scripts.OnClick(P.editSetup)
local E = CRT.InterruptSetupEditor
check(E.window and E.window.shown, "edit: the editor opens")
eq(E.Draft().boss, 3470, "edit: on the boss shown"); eq(E.Draft().difficulty, 15, "edit: and its difficulty")
eq(#E.Draft().groups, 2, "edit: its groups to start from")
CRT.Bosses:Get(3470).interrupts[2] = nil
I:ClearCache()
P.bossRow.opts.set("3470:16")

-- the setup editor: a setup of your own for a boss and difficulty with none
do
  local EL = E.LAYOUT
  eq(E.window.opts.kind, "dialog", "editor: a UI.Window dialog")
  E:Open("3421:15")
  local d = E.Draft()
  check(d.boss == 3421 and d.difficulty == 15, "editor: a boss and difficulty with no setup")
  eq(#d.groups, 1, "editor: starts with one group"); eq(d.groups[1].label, "Group 1", "editor: named Group 1"); eq(d.groups[1].slots, 4, "editor: of four")
  local rowsShown = 0
  for _, r in ipairs(rows) do if r.opts.options == E.MarkerOptions and r.shown then rowsShown = rowsShown + 1 end end
  eq(rowsShown, 1, "editor: one group row shown")
  local markers = E.MarkerOptions()
  eq(#markers, 8, "editor: the eight markers, no none (an untimed group needs one)")
  check(markers[1].label:find("Skull", 1, true) and markers[1].label:find("RaidTargetingIcon_8", 1, true), "editor: Skull first, with its icon")
  eq(E.Draft().groups[1].marker, 8, "editor: a new group takes Skull")
  E.addGroup.scripts.OnClick(E.addGroup)
  eq(#E.Draft().groups, 2, "editor: + Group adds one")
  eq(E.Draft().groups[2].marker, 7, "editor: the next takes the first marker free, Cross")
  -- the rows: label typed, marker picked, slots slid
  local markerRows, slotRows = {}, {}
  for _, r in ipairs(rows) do
    if r.opts.options == E.MarkerOptions then markerRows[#markerRows + 1] = r end
    if r.label == E.TEXT.slots then slotRows[#slotRows + 1] = r end
  end
  eq(#markerRows, 8, "editor: a row per possible group, pooled")
  check(slotRows[1].rowKind == "slider" and slotRows[1].opts.min == 1 and slotRows[1].opts.max == 10, "editor: kickers 1 to 10 on a slider")
  markerRows[2].opts.set(8)
  eq(E.Draft().groups[2].marker, 8, "editor: Skull picked for group 2")
  eq(E.Draft().groups[1].marker, 7, "editor: group 1 takes group 2's Cross in exchange")
  slotRows[2].opts.set(3)
  local labelEdits = {}
  for _, f in ipairs(all) do if f.kind == "EditBox" and f.parent == E.window.content and f.w == EL.labelEditW then labelEdits[#labelEdits + 1] = f end end
  labelEdits[1].text = "Cross add"; labelEdits[1].scripts.OnTextChanged(labelEdits[1], true)
  labelEdits[2].text = "Skull add"; labelEdits[2].scripts.OnTextChanged(labelEdits[2], true)
  E.spellName.text = "Wail of Terror"; E.spellName.scripts.OnTextChanged(E.spellName, true)
  E.spellID.text = "1234"; E.spellID.scripts.OnTextChanged(E.spellID, true)
  E.addGroup.scripts.OnClick(E.addGroup)
  local removes = {}
  for _, f in ipairs(all) do if f.kind == "Button" and f.text == E.TEXT.remove then removes[#removes + 1] = f end end
  removes[3].scripts.OnClick(removes[3])
  eq(#E.Draft().groups, 2, "editor: Remove takes a group out")
  E.save.scripts.OnClick(E.save)
  check(I:IsCustom("3421:15"), "editor: Save keeps your setup")
  local def = I:Def("3421:15")
  eq(def.groups[1].label .. "/" .. def.groups[1].marker .. "/" .. def.groups[1].slots, "Cross add/7/4", "editor: group 1 as edited")
  eq(def.groups[2].label .. "/" .. def.groups[2].marker .. "/" .. def.groups[2].slots, "Skull add/8/3", "editor: group 2 as edited")
  eq(def.groups[1].key, "cross_add", "editor: a new group's key from its label")
  eq(def.spell.name .. "/" .. def.spell.spellID, "Wail of Terror/1234", "editor: the spell and its ID")
  eq(def.timing, nil, "editor: untimed")
  eq(CRT.db.interrupts.setups[3421][15].groups[2].key, "skull_add", "editor: saved per boss and difficulty")
  eq(P.Boss(), "3421:15", "editor: the page shows it")
  -- a label changed later keeps the group's key, so the names stay with it
  I:SetName("3421:15", 1, 1, "Solex")
  E:Open("3421:15")
  local relabel
  for _, f in ipairs(all) do if f.kind == "EditBox" and f.parent == E.window.content and f.w == EL.labelEditW then relabel = f break end end
  relabel.text = "X add"; relabel.scripts.OnTextChanged(relabel, true)
  E.save.scripts.OnClick(E.save)
  eq(I:Def("3421:15").groups[1].key, "cross_add", "editor: a relabelled group keeps its key")
  eq(I:Own("3421:15")[1][1], "Solex", "editor: and its names")
  eq(E.shipped.text, E.TEXT.delete, "editor: no shipped setup, so Delete my setup")
  check(E.shipped.enabled, "editor: on for your own setup")
  -- a timed shipped setup can't be saved over
  E:Open("3470:16")
  eq(#E.Draft().groups, 2, "editor: a shipped setup to start from")
  check(not E.save.enabled and E.save.crtReason == I.TEXT.timed, "editor: Save greyed on a timed setup, with why")
  E.save.scripts.OnEnter(E.save)
  check(GameTooltip.lines[2] == I.TEXT.timed, "editor: its tooltip says why")
  check(not E:Save(), "editor: and Save refuses it")
  check(not I:IsCustom("3470:16") and I:Def("3470:16").timing ~= nil, "editor: the lattice kept")
  eq(E.Draft().groups[1].marker, nil, "editor: a timed setup shown as shipped, no markers made up")
  check(not E.addGroup.enabled and not E.spellName.enabled, "editor: a timed setup is read-only")
  local tRows, tSlots = {}, {}
  for _, r in ipairs(rows) do
    if r.opts.options == E.MarkerOptions and r.shown then r.refresh() tRows[#tRows + 1] = r end
    if r.label == E.TEXT.slots and r.shown then r.refresh() tSlots[#tSlots + 1] = r end
  end
  check(#tRows == 2 and tRows[1].enabled == false and tSlots[1].enabled == false, "editor: its markers and kickers greyed")
  local tRemove
  for _, f in ipairs(all) do if f.kind == "Button" and f.text == E.TEXT.remove and f.shown then tRemove = f break end end
  check(tRemove and not tRemove.enabled, "editor: no Remove")
  -- your own setup in place of an untimed shipped one, and back
  CRT.Bosses:Get(3470).interrupts[2] = { difficulty = 15, groups = { { key = "skull", label = "Skull add", marker = 8, slots = 4 } } }
  I:ClearCache()
  E:Open("3470:15")
  check(E.save.enabled, "editor: Save on for an untimed shipped setup")
  E.save.scripts.OnClick(E.save)
  check(I:IsCustom("3470:15"), "editor: your own in place of the shipped one")
  E:Refresh()
  eq(E.shipped.text, E.TEXT.shipped, "editor: Back to the shipped setup")
  check(E.shipped.enabled, "editor: Back to the shipped setup on")
  E.shipped.scripts.OnClick(E.shipped)
  check(not I:IsCustom("3470:15") and I:Def("3470:15").groups[1].slots == 4, "editor: back to the shipped setup")
  CRT.Bosses:Get(3470).interrupts[2] = nil
  I:ClearCache()
  -- inside its window
  for _, f in ipairs(all) do
    local p = f.points[1]
    if f.parent == E.window.content and p and p[1] == "TOPLEFT" and type(p[2]) == "number" then
      check(p[2] >= 0 and p[2] + (f.w or 0) <= EL.width - 16 and p[3] <= 0 and p[3] - (f.h or 0) >= -(EL.height - 26 - 16 - 22), "editor: inside the window (" .. tostring(f.label or f.text or f.kind) .. " at " .. p[2] .. ", " .. p[3] .. ")")
    end
  end

  -- Export (dev only): the boss's setups as the boss file's block
  local X = CRT.KickSetupExport
  check(X ~= nil, "export: the dev file is loaded")
  local exportButton
  for _, f in ipairs(all) do if f.kind == "Button" and f.text == "Export" and f.parent == E.window.content then exportButton = f end end
  check(exportButton ~= nil, "export: a button on the editor")
  E:Open("3421:15")
  exportButton.scripts.OnClick(exportButton)
  check(shownExport and shownExport:find("interrupts = {", 1, true), "export: shows the block: " .. tostring(shownExport))
  check(shownExport:find('{ key = "cross_add", label = "X add", marker = 7, slots = 4 },', 1, true), "export: each group on a line")
  check(shownExport:find('spell = { name = "Wail of Terror", spellID = 1234 },', 1, true), "export: the spell")
  local back = assert(load("return { " .. shownExport .. " }"))().interrupts
  local read = CRT.InterruptSetup.Read(back)
  check(read and #read == 2 and read[2].groups[2].key == "skull_add" and read[2].difficulty == 15, "export: every difficulty, reading back as the same setups")
  check(read and read[1].timing and read[1].difficulty == 16, "export: the shipped Mythic one with its timing")
  local timed = X.Text(I:Setups(3470))
  local tback = CRT.InterruptSetup.Read(assert(load("return { " .. timed .. " }"))().interrupts)
  check(tback and tback[1].timing and tback[1].timing.anchor.times[6] == 404 and tback[1].note == "Mythic only here.", "export: a timed setup keeps its timing and note")
  check(X.Text({ { difficulty = 16, label = "Kick", spell = { name = "W" }, groups = { { key = "a", label = "A", slots = 1 } } } }):find("TODO id", 1, true), "export: a spell with no ID says where it comes from")
  -- a share's shape is never exported
  I:ReceiveShared("3421:14", { { "A", "B" } }, "Brenn", CRT.InterruptSetup.FromShape(14, "skull:8:2:Skull add", "Kick"))
  check(I:Def("3421:14") ~= nil and not X.ForBoss(3421):find("difficulty = 14", 1, true), "export: a share's shape left out")
  -- Delete my setup, for a boss and difficulty with nothing shipped
  E:Open("3421:15")
  E.shipped.scripts.OnClick(E.shipped)
  check(not I:IsCustom("3421:15") and I:Def("3421:15") == nil, "editor: Delete my setup drops it")
  check(printed[#printed]:find("Deleted your kick setup", 1, true), "editor: and says so")
  P.bossRow.opts.set("3470:16")
end

-- every control inside the page area (UI.PAGE_W x UI.PAGE_H, under the tabs)
local AREA_H = UI.PAGE_H - 66
for _, f in ipairs(all) do
  local p = f.points[1]
  if (f.parent == P.tabs.assignments.frame or f.parent == P.tabs.settings.frame) and p and p[1] == "TOPLEFT" and type(p[2]) == "number" then
    local x, y = p[2], p[3]
    check(x >= 0 and x + (f.w or 0) <= UI.PAGE_W and y <= 0 and y - (f.h or 0) >= -AREA_H, "layout: inside the page (" .. tostring(f.label or f.text or f.kind) .. " at " .. x .. ", " .. y .. ", " .. tostring(f.w) .. " wide)")
  end
end

-- /crt interrupts, and the switch
check(words.interrupts ~= nil, "slash: registered")
check(words.interrupts.help and words.interrupts.help[1]:find("/crt interrupts", 1, true), "slash: its help line")
words.interrupts.run("")
eq(shown[#shown], "interrupts", "slash: opens the page")
eq(words.interrupts.run("other"), false, "slash: another word after it is unknown")
I:SetEnabled(false); check(pages.interrupts.hidden, "switch: off hides the page")
words.interrupts.run("")
eq(shown[#shown], "settings", "slash: off opens General Settings")
eq(printed[#printed], T.slashOff, "slash: and says why")
I:SetEnabled(true); check(not pages.interrupts.hidden, "switch: on shows it again")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const FILES = ['CRT_Data/Bosses/Registry.lua', 'CRT_Dev/Tests/SamplePack/Season.lua', 'CRT_Dev/Tests/SamplePack/NekzaliTheSoulcoiler.lua',
  'CRT_Core/Comm.lua', 'CRT_Modules/Interrupts/Lattice.lua', 'CRT_Modules/Interrupts/Setup.lua', 'CRT_Modules/Interrupts/Data.lua', 'CRT_Modules/Interrupts/Anchor.lua',
  'CRT_Modules/Interrupts/Comm.lua', 'CRT_Modules/Interrupts/Page.lua', 'CRT_Modules/Notes/Parse.lua', 'CRT_Modules/Notes/Data.lua',
  'CRT_Modules/Notes/EditModel.lua', 'CRT_Modules/Interrupts/NoteBlock.lua', 'CRT_Modules/Interrupts/PageGrid.lua', 'CRT_Modules/Interrupts/SetupEditor.lua',
  'CRT_Dev/Dev/KickSetupExport.lua', 'CRT_Modules/Notes/Palette.lua', 'CRT_Modules/Interrupts/PagePalette.lua', 'CRT_Modules/Interrupts/WhoWindow.lua'];
lua.lua_checkstack(L, FILES.length + 4); // more sources than Lua's default stack room
for (const f of FILES) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, FILES.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
