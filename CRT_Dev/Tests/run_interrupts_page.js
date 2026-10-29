// The Interrupts page (CRT_Modules/Interrupts/Page.lua) built on mock frames with a stubbed CRT.UI, over the real
// lists, anchor and sharing (Data.lua, Anchor.lua, Comm.lua) on the sample season pack: registered hidden, two tabs
// with Settings last, one boss listed with its difficulty, the status bar's states (no list, your own list, the raid's
// list and your kick, enemy nameplates off first), Share greyed with its reason, the fields read-only for a raider in a
// group and class coloured for a group member, Clear list asking first, Use the raid's list, Who has it from the Addon
// check, How the numbers are worked out from the boss block, Test on trash, Preview reminder, the Settings tab's
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
local registrySrc, seasonSrc, bossSrc, commSrc, latticeSrc, dataSrc, anchorSrc, kickSrc, pageSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
local function plain(s) return (tostring(s or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")) end
time = function() return 1790000000 end
GetTime = function() return 100 end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
Ambiguate = function(n) return (n:gsub("%-.*$", "")) end
C_Timer = { After = function() end, NewTimer = function() return { Cancel = function() end } end }
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
function UI.TooltipOwner() end
function UI.Help(parent, title, text) local m = mock("Button", parent) m.helpTitle, m.helpText = title, text helps[#helps + 1] = m return m end
local function row(kind, parent, text, opts, extra)
  local r = mock("Frame", parent)
  r.label, r.opts, r.rowKind = text, opts, kind
  r.w = (opts.labelWidth or 140) + 5 + (opts.width or 200) + (extra or 0)
  r.h = 32
  r.refresh = function() if opts.enabledIf then r.enabled = opts.enabledIf() and true or false end end
  rows[#rows + 1] = r
  return r
end
function UI.Dropdown(parent, text, opts) return row("dropdown", parent, text, opts) end
function UI.SoundDropdown(parent, text, opts) return row("sound", parent, text, opts, 50 + 24) end
function UI.Slider(parent, text, opts) return row("slider", parent, text, opts, 44) end
function UI.PickColor(color, set, opts) picked[#picked + 1] = { color = color, set = set, opts = opts } end
function UI.Window(name, opts) local w = mock("Frame") w.content = mock("Frame", w) w.name, w.opts = name, opts w.shown = false return w end
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
for _, src in ipairs({ registrySrc, seasonSrc, bossSrc, commSrc, latticeSrc, dataSrc }) do assert(load(src))("CowfeeRaidTools", CRT) end
CRT.Bosses:Get(3470).interrupts = { difficulty = 16, anchor = { unit = "boss2", cycle = 7, ordinal = 5, times = { 33, 94, 188, 249, 343, 404 } },
  firstCast = 4.5, spacing = 1.0, tolerance = 0.3, adds = 10, perNumber = 2, window = 25,
  groups = { "Left", "Right" }, slots = 5, label = "Kick", note = "Mythic only here." }
-- a second boss with another shape: one group of seven
CRT.Bosses:Register({ encounterID = 3421, name = "Second Boss", season = "sample", interrupts = { difficulty = 16,
  anchor = { unit = "boss1", cycle = 3, ordinal = 1, times = { 20 } }, firstCast = 2, spacing = 1.5, tolerance = 0.3, adds = 7,
  perNumber = 1, window = 20, groups = { "North" }, slots = 7, label = "Stop" } })
for _, src in ipairs({ anchorSrc, kickSrc, pageSrc }) do assert(load(src))("CowfeeRaidTools", CRT) end
local I, P = CRT.Interrupts, CRT.InterruptsPage
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

-- the status bar and Share
local function statusText() return plain(P.status.text) end
eq(statusText(), T.statusNone, "status: no list")
check(P.share.motionWhileDisabled == true, "share: its tooltip shows while it is greyed (SetMotionScriptsWhileDisabled)")
check(P.fields[1][1].skinned, "fields: the name boxes follow the theme (UI:SkinEditBox)")
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

-- the fields: your own list, class coloured, read-only for a raider
eq(P.fields[1][3].text, "Solex", "fields: your own list")
eq(P.fields[1][3].color and P.fields[1][3].color[1], 0.25, "fields: a group member in their class colour")
eq(P.fields[1][1].color and P.fields[1][1].color[1], 1, "fields: anyone else in white")
check(P.fields[1][1].enabled, "fields: editable for the leader")
lead = false; P.Refresh()
check(not P.fields[1][1].enabled, "fields: read-only for a raider in a group")
check(not P.share.enabled and P.share.crtReason:find("raid leader", 1, true), "share: a raider's reason")
grouped = false; P.Refresh()
check(P.fields[1][1].enabled, "fields: editable solo")
check(P.share.crtReason and P.share.crtReason:find("in a group", 1, true), "share: solo, the group reason")
grouped, lead = true, true; P.Refresh()
-- a picker sets the slot
local pick = P.pickers[1][2]
local options = pick.opts.options()
eq(options[1].key, "", "picker: an empty choice first")
eq(options[2].key, "Brenn", "picker: the group sorted")
eq(plain(options[4].label), "Solex", "picker: names without realm")
check(options[4].label:find("|cff40c7eb", 1, true) == 1, "picker: in class colour: " .. options[4].label)
pick.opts.set("Brenn")
eq(I:Own(id)[1][2], "Brenn", "picker: sets your own slot")
-- Edit a field by typing
P.fields[2][5].text = "  Typed-Realm "
P.fields[2][5].scripts.OnEnterPressed(P.fields[2][5])
eq(I:Own(id)[2][5], "Typed", "fields: a typed name, trimmed and without realm")

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

-- Who has it and How the numbers are worked out
fillOwn(true); I:SetUse(id, "own")
I:SetName(id, 1, 4, "Brenn"); I:SetName(id, 1, 5, "Quick"); P.Refresh()
local who = {}
for _, r in ipairs(P.whoRows) do if r.name.text and r.name.text ~= "" then who[plain(r.name.text)] = plain(r.state.text) end end
eq(who.Solex, "you, v1.2.0", "who: you, with Interrupts on")
eq(who.Brenn, "Interrupts off", "who: a CRT with Interrupts off")
eq(who.Quick, "No CRT", "who: no CRT")
eq(who.P1, "not in your group", "who: a name not in the group")
check(P.WhoText("Solex", { { name = "Solex", row = ROSTER[1] } }):find("|cff", 1, true) == 1, "who: in colour")
local how = {}
for i, fs in ipairs(P.howLines) do how[i] = fs.text end
eq(how[1], "A wave starts at cast 5 of every 7 from boss2.", "how: the anchor")
eq(how[2], "Add 1 casts 4.5 s after it, then one every 1 s.", "how: the first casts")
eq(how[3], "A cast more than 0.3 s off its beat is not an add.", "how: the tolerance")
eq(how[4], "10 adds a wave, 2 to a number.", "how: the adds")
eq(how[5], "A cast over 25 s after the wave's start is not in it.", "how: the window")
eq(how[6], "Without a cast count, waves start at 0:33, 1:34, 3:08, 4:09, 5:43, 6:44.", "how: the fallback times")
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

-- no boss with a block: the first heading's (?) hides with it
do
  local realBosses = I.Bosses
  I.Bosses = function() return {} end
  P.Refresh()
  check(not P.headings[1].shown and P.gridHelp and not P.gridHelp.shown, "grid: no heading, no (?)")
  I.Bosses = realBosses
  P.Refresh()
  check(P.headings[1].shown and P.gridHelp.shown, "grid: back with the heading")
end

-- another boss's shape: the grid follows (pooled fields, the extras hidden, headings, labels, the rows under it)
local LAY = P.LAYOUT
local function yOf(f) return f.points[#f.points] and f.points[#f.points][3] end
local clearY5 = yOf(P.clear)
P.bossRow.opts.set(3421)
eq(P.headings[1].text, "North", "shape: the group heading")
check(not P.headings[2].shown, "shape: the second group's heading hidden")
check(P.fields[1][7].shown and P.slotLabels[1][7].text == "Stop #7", "shape: seven slots, labelled from the block")
check(not P.fields[2][1].shown and not P.pickers[2][1].shown, "shape: the second group's fields hidden")
eq(yOf(P.clear), LAY.gridY - LAY.headH - 6 * LAY.rowH - LAY.fieldH - LAY.buttonGap, "shape: the buttons sit under seven rows")
check(yOf(P.clear) < clearY5, "shape: lower than under five")
eq(#P.howLines >= 6 and P.howLines[4].text, "7 adds a wave, 1 to a number.", "shape: How the numbers are worked out follows")
P.bossRow.opts.set(id)
check(P.headings[2].shown and P.fields[2][1].shown and not P.fields[1][7].shown, "shape: back to two groups of five")
eq(yOf(P.clear), clearY5, "shape: the buttons back where they were")
eq(P.slotLabels[1][1].text, "Kick #1", "shape: the labels back")

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
  'CRT_Core/Comm.lua', 'CRT_Modules/Interrupts/Lattice.lua', 'CRT_Modules/Interrupts/Data.lua', 'CRT_Modules/Interrupts/Anchor.lua',
  'CRT_Modules/Interrupts/Comm.lua', 'CRT_Modules/Interrupts/Page.lua'];
for (const f of FILES) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, FILES.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
