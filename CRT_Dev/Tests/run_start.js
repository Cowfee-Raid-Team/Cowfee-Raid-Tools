// The first run and Start here (CRT_Core/UI/Welcome.lua, CRT_Core/UI/StartPage.lua; job 20261124-ux-welcome):
// a fresh install prints one chat line and opens the Welcome on the first open of the main window, once; an upgrade
// does neither; the Welcome reopens from Start here's button and /crt welcome; its two choices show three steps each,
// whose buttons go there; Got it closes it; welcome is account-wide and never exported; a new profile opens on Start
// here and a saved page is kept; What's on is built from its one table, each row a checkbox reading and writing its
// saved field with a link to its page; the page fits the page area at the smallest and largest text size in both looks.
// The rows' binding to the real modules is checked in run_addon.js.
// Usage: node run_start.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const FILES = ['CRT_Core/Core.lua', 'CRT_Core/Themes.lua', 'CRT_Core/Profiles.lua', 'CRT_Core/Slash.lua', 'CRT_Core/UI/Panel.lua',
  'CRT_Core/UI/ScrollBar.lua', 'CRT_Core/UI/Controls.lua', 'CRT_Core/UI/Toggle.lua', 'CRT_Core/UI/StartPage.lua', 'CRT_Core/UI/Welcome.lua'];
const harness = `
local sources = { ... }
local NAMES = { ${FILES.map(f => JSON.stringify(f)).join(', ')} }
local say = print -- print itself is stood in below, to catch the chat lines
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 say("FAIL " .. what) end end
local sectionFails = 0
local function section(what) if fails == sectionFails then say("ok start: " .. what) end sectionFails = fails end
local unpack = unpack or table.unpack

-- Stand-in frames. A font string measures its text at its font's size: 0.55 of the size a character (colour codes
-- left out) and 1.2 of it a line, wrapping at its width when it has one.
local function plain(s) return (tostring(s or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")) end
local function fontSize(f)
  if type(f) == "string" then f = _G[f] end
  return type(f) == "table" and f.size or 12
end
local made = {}
local function mock(kind)
  local m = { kind = kind, shown = true, pts = {}, regions = {}, children = {}, scripts = {}, alpha = 1 }
  made[#made + 1] = m
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" then return function(self, _, layer, font)
      local fsx = mock("FontString") rawset(fsx, "font", font) rawset(fsx, "text", "") rawset(fsx, "parent", self) table.insert(self.regions, fsx) return fsx end end
    if k == "CreateTexture" then return function(self) local tx = mock("Texture") rawset(tx, "parent", self) table.insert(self.regions, tx) return tx end end
    if k == "GetRegions" then return function(self) return unpack(self.regions) end end
    if k == "GetChildren" then return function(self) return unpack(self.children) end end
    if k == "GetParent" then return function(self) return rawget(self, "parent") end end
    if k == "GetObjectType" then return function(self) return self.kind end end
    if k == "SetScript" then return function(self, n, fn) self.scripts[n] = fn end end
    if k == "GetScript" then return function(self, n) return self.scripts[n] end end
    if k == "HookScript" then return function(self, n, fn) local old = self.scripts[n] self.scripts[n] = function(...) if old then old(...) end fn(...) end end end
    if k == "Show" then return function(self) local was = self.shown self.shown = true if not was and self.scripts.OnShow then self.scripts.OnShow(self) end end end
    if k == "Hide" then return function(self) local was = self.shown self.shown = false if was and self.scripts.OnHide then self.scripts.OnHide(self) end end end
    if k == "SetShown" then return function(self, on) if on then self:Show() else self:Hide() end end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "IsVisible" then return function(self) return self.shown end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "SetWidth" then return function(self, w) rawset(self, "w", w) end end
    if k == "SetHeight" then return function(self, h) rawset(self, "h", h) end end
    if k == "GetWidth" then return function(self) return rawget(self, "w") or 0 end end
    if k == "GetHeight" then return function(self) return rawget(self, "h") or 0 end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "ClearAllPoints" then return function(self) self.pts = {} end end
    if k == "SetText" then return function(self, s)
      rawset(self, "text", s)
      local fsx = rawget(self, "fontString") if fsx then fsx.text = s end
    end end
    if k == "GetText" then return function(self) return rawget(self, "text") end end
    if k == "GetFontString" then return function(self)
      local fsx = rawget(self, "fontString")
      if not fsx then fsx = mock("FontString") rawset(fsx, "font", "CRTFontButtonSmall") rawset(fsx, "text", rawget(self, "text") or "") rawset(self, "fontString", fsx) end
      return fsx
    end end
    if k == "SetWordWrap" then return function(self, on) rawset(self, "wrap", on) end end
    if k == "GetStringWidth" or k == "GetUnboundedStringWidth" then return function(self) return #plain(rawget(self, "text")) * fontSize(rawget(self, "font")) * 0.55 end end
    if k == "GetStringHeight" then return function(self)
      local size = fontSize(rawget(self, "font"))
      local w, box = #plain(rawget(self, "text")) * size * 0.55, rawget(self, "w")
      local lines = 1
      if rawget(self, "wrap") ~= false and box and box > 0 and w > box then lines = math.ceil(w / box) end
      return size * 1.2 * lines
    end end
    if k == "SetFontObject" then return function(self, o) rawset(self, "font", o) end end
    if k == "GetFont" then return function(self) return "f", fontSize(rawget(self, "font")), "" end end
    if k == "SetChecked" then return function(self, v) rawset(self, "checked", v and true or false) end end
    if k == "GetChecked" then return function(self) return rawget(self, "checked") == true end end
    if k == "SetEnabled" then return function(self, v) rawset(self, "enabled", v and true or false) end end
    if k == "IsEnabled" then return function(self) return rawget(self, "enabled") ~= false end end
    if k == "SetAlpha" then return function(self, a) rawset(self, "alpha", a) end end
    if k == "GetAlpha" then return function(self) return rawget(self, "alpha") end end
    if k == "SetColorTexture" then return function(self, r, g, b, a) rawset(self, "color", { r, g, b, a }) end end
    if k == "SetTextColor" then return function(self, r, g, b) rawset(self, "textColor", { r, g, b }) end end
    if k == "SetAtlas" then return function(self, a) rawset(self, "atlas", a) end end
    if k == "SetScrollChild" then return function(self, c) rawset(self, "child", c) end end
    if k == "IsMouseEnabled" then return function() return true end end
    if k == "GetFrameLevel" then return function() return 1 end end
    if k == "GetJustifyH" then return function(self) return rawget(self, "justify") or "CENTER" end end
    if k == "SetJustifyH" then return function(self, j) rawset(self, "justify", j) end end
    if k == "GetNumPoints" then return function(self) return #self.pts end end
    return function() end end })
end
function CreateFrame(kind, name, parent, template)
  local f = mock(kind) rawset(f, "parent", parent) rawset(f, "template", template) rawset(f, "name", name)
  if parent and rawget(parent, "children") then table.insert(parent.children, f) end
  if template == "BasicFrameTemplateWithInset" then f:CreateTexture() rawset(f, "CloseButton", mock("Button")) end
  if template == "UIPanelScrollFrameTemplate" then
    local bar = mock("Slider")
    rawset(bar, "ThumbTexture", mock("Texture")) rawset(bar, "ScrollUpButton", mock("Button")) rawset(bar, "ScrollDownButton", mock("Button"))
    rawset(f, "ScrollBar", bar)
  end
  if name then _G[name] = f end
  return f
end
function hooksecurefunc(t, name, hook) if type(t) == "string" then t, name, hook = _G, t, name end local old = t[name] rawset(t, name, function(...) local r = { old(...) } hook(...) return unpack(r) end) end
CreateColor = function(r, g, b, a) return { r = r, g = g, b = b, a = a } end
date, time = os.date, os.time
UIParent = mock("UIParent") UISpecialFrames = {} SlashCmdList = {}
GameTooltip = mock("GameTooltip")
function tinsert(t, v) table.insert(t, v) end
format = string.format
strtrim = function(s) return ((s or ""):gsub("^%s+", ""):gsub("%s+$", "")) end
InCombatLockdown = function() return false end
GetTime = function() return 0 end
C_AddOns = { GetAddOnMetadata = function(_, field) if field == "Version" then return "1.4.9" end end }
C_Timer = { After = function() end }
local function fontObject(path, size, flags)
  local o = { path = path, size = size, flags = flags, color = { 1, 1, 1 } }
  function o:CopyFontObject(src) self.path, self.size, self.flags = src.path, src.size, src.flags end
  function o:GetFont() return self.path, self.size, self.flags end
  function o:SetFont(p, s, f) self.path, self.size, self.flags = p, s, f end
  function o:GetTextColor() return self.color[1], self.color[2], self.color[3] end
  function o:SetTextColor(r, g, b) self.color = { r, g, b } end
  return o
end
GameFontNormal = fontObject("Fonts/FRIZQT__.TTF", 12, "") GameFontHighlight = GameFontNormal GameFontDisable = GameFontNormal
GameFontHighlightSmall = fontObject("Fonts/FRIZQT__.TTF", 10, "") GameFontDisableSmall = GameFontHighlightSmall
GameFontNormalLarge = fontObject("Fonts/FRIZQT__.TTF", 16, "")
GameFontNormalSmall = fontObject("Fonts/FRIZQT__.TTF", 10, "") ChatFontNormal = fontObject("Fonts/ARIALN.TTF", 14, "")
LibStub = { GetLibrary = function() end }
function CreateFont(name) local o = fontObject("Fonts/FRIZQT__.TTF", 12, "") _G[name] = o return o end
local printed = {}
print = function(...) local t = {} for i = 1, select("#", ...) do t[#t + 1] = tostring((select(i, ...))) end printed[#printed + 1] = table.concat(t, " ") end

-- One login: every file loaded into a new CRT, CRTDB as saved (nil: a first install), then ADDON_LOADED and
-- PLAYER_LOGIN. The pages the Welcome and the links go to are stood in, recording what opened.
local function boot(saved)
  made = {}
  printed = {}
  local CRT = {}
  CRTDB, CRTDBChar = saved, {}
  for i, src in ipairs(sources) do
    assert(load(src, NAMES[i]))("CowfeeRaidTools", CRT)
    if NAMES[i] == "CRT_Core/UI/Panel.lua" then
      -- the window helper and the tooltip owner are tested elsewhere (run_window.js, run_tooltip.js)
      CRT.UI.Window = function(wname, o)
        local w = CreateFrame("Frame", wname, UIParent) w.opts = o w.content = mock("Frame") rawset(w.content, "parent", w) w.shown = false
        w.strip = mock("Frame") w.strip.SetTitle = function(self, t) self.title = t end
        rawset(w, "Raise", function() end)
        if wname then tinsert(UISpecialFrames, wname) end
        return w
      end
      CRT.UI.TooltipOwner = function() return "spot" end
      CRT.UI.WINDOW_DEFAULTS = { titleHeight = 26, inset = 8 }
    end
  end
  local frames = {}
  for _, f in ipairs(made) do if f.scripts.OnEvent then frames[#frames + 1] = f end end
  local function fire(e, ...) for _, f in ipairs(frames) do if f.events == nil or true then f.scripts.OnEvent(f, e, ...) end end end
  -- the ADDON_LOADED frame (Core.lua) and the PLAYER_LOGIN ones; each guards its own event
  for _, f in ipairs(frames) do pcall(f.scripts.OnEvent, f, "ADDON_LOADED", "CowfeeRaidTools") end
  CRT.db.ui.theme, CRT.db.ui.modern = "blizzard", false
  CRT:UseTheme("blizzard")
  for _, f in ipairs(frames) do pcall(f.scripts.OnEvent, f, "PLAYER_LOGIN") end
  local UI = CRT.UI
  local opened = {}
  for _, key in ipairs({ "settings", "qol", "notes", "readycheck", "groups", "pace", "tattle", "timeline", "interrupts" }) do
    UI:RegisterPage(key, ({ settings = "General Settings", qol = "Quality of Life", notes = "Raid Notes", readycheck = "Ready Check",
      groups = "Raid Groups", pace = "Pace", tattle = "Tattlebot", timeline = "Timeline", interrupts = "Interrupts" })[key], function() end)
  end
  UI:SetPageHidden("interrupts", true)
  CRT.NotesPage = { Open = function(tab) opened[#opened + 1] = "notes:" .. tostring(tab) end }
  CRT.ReadyCheckPage = { Open = function(tab) opened[#opened + 1] = "readycheck:" .. tostring(tab) end }
  CRT.QoLPage = { Open = function(tab) opened[#opened + 1] = "qol:" .. tostring(tab) end }
  CRT.SettingsPage = { Open = function(tab) opened[#opened + 1] = "settings:" .. tostring(tab) end }
  CRT.TattlePage = { Open = function(tab) opened[#opened + 1] = "tattle:" .. tostring(tab) end }
  local show = UI.Show
  UI.Show = function(self, key) opened[#opened + 1] = key or "?" return show(self, key) end
  return { CRT = CRT, UI = UI, opened = opened, printed = printed,
    welcome = function() return _G.CRTWelcome end,
    shown = function() local w = _G.CRTWelcome return w ~= nil and w.shown == true end,
    slash = function(msg) SlashCmdList.COWFEERAIDTOOLS(msg) end }
end
local function click(b) b.scripts.OnClick(b) end
local function copy(t) if type(t) ~= "table" then return t end local o = {} for k, v in pairs(t) do o[k] = copy(v) end return o end

-- 1. A fresh install: one chat line at login, the Welcome on the first open, once ---------------------------------
local p = boot(nil)
check(p.CRT.freshInstall == true, "no CRTDB: a fresh install")
check(#p.printed == 1, "a fresh install prints one chat line at login, got " .. #p.printed .. ": " .. table.concat(p.printed, " | "))
local line = p.printed[1] or ""
check(line:find("Cowfee Raid Tools", 1, true) and line:find("/crt|r", 1, true) and line:find("/crt help|r", 1, true), "the line names /crt and /crt help: " .. line)
check(p.CRT.db.welcome.pending == true, "a fresh install leaves the Welcome to open")
check(p.CRT.db.lastPage == "start", "a new profile opens on Start here, got " .. tostring(p.CRT.db.lastPage))
check(not p.shown(), "nothing opens before the main window does")
p.slash("")
check(p.UI.frame and p.UI.frame.shown, "/crt opens the main window")
check(p.opened[1] == nil or p.opened[1] == "?", "/crt opens the saved page")
check(p.UI.pages.start.frame and p.UI.pages.start.frame.shown, "on Start here")
check(p.shown(), "the first /crt opens the Welcome over it")
local W = p.CRT.Welcome
local got
for _, b in ipairs(made) do if rawget(b, "text") == "Got it" and b.kind == "Button" then got = b end end
check(got ~= nil, "the Welcome has Got it")
click(got)
check(not p.shown(), "Got it closes it")
check(p.CRT.db.welcome.pending == false, "closed: it no longer opens by itself")
p.slash("") p.slash("")
check(not p.shown(), "the next /crt: no Welcome")
section("a fresh install: the chat line, the Welcome on the first /crt, once")

-- 2. Reopened: Start here's Welcome button and /crt welcome ----------------------------------------------------------
p.slash("welcome")
check(p.shown(), "/crt welcome opens it")
p.welcome():Hide()
local v = p.CRT.StartPage.view
check(v.welcome and v.welcome.text == "Welcome", "Start here has a Welcome button")
click(v.welcome)
check(p.shown(), "Start here > Welcome opens it")
p.welcome():Hide()
check(p.CRT.db.welcome.pending == false, "opened by hand: still never by itself")
local helpBefore = #p.printed
p.slash("help")
local help = table.concat(p.printed, "\\n", helpBefore + 1)
check(help:find("/crt welcome|r", 1, true) ~= nil, "/crt help lists /crt welcome")
section("the Welcome reopens from Start here and /crt welcome")

-- 3. The Welcome's choices: three steps each, their buttons go there ------------------------------------------------
W:Open()
local wv = W.view
check(not wv.pick.shown == false and wv.picked == nil, "it opens with neither choice picked, asking for one")
for _, r in ipairs(wv.steps) do check(not r.button.shown, "no steps before a pick") end
local tall0 = p.welcome().h
for _, choice in ipairs({ "raider", "leader" }) do
  local b
  for _, half in ipairs(wv.choice.buttons) do if half.key == choice then b = half end end
  click(b)
  check(wv.picked == choice and not wv.pick.shown, choice .. ": picked, the prompt hides")
  local steps = W.STEPS[choice]
  check(#steps == 3, choice .. ": three steps")
  for i, step in ipairs(steps) do
    local r = wv.steps[i]
    check(r.button.shown and r.button.text == step.button and r.text.text == step.text and r.number.text == i .. ".", choice .. " step " .. i .. ": its number, text and button")
    check(r.button.w >= r.button:GetFontString():GetStringWidth(), choice .. " step " .. i .. ": its button is as wide as its label")
  end
  check(p.welcome().h > tall0, choice .. ": the window grows to hold the steps")
end
local before = #p.opened
for i = 1, 3 do click(wv.steps[i].button) end
check(table.concat(p.opened, " ", before + 1) == "groups readycheck notes:notes", "the leader's steps go to Raid Groups, Ready Check and Raid Notes: " .. table.concat(p.opened, " ", before + 1))
for _, half in ipairs(wv.choice.buttons) do if half.key == "raider" then click(half) end end
before = #p.opened
for i = 1, 3 do click(wv.steps[i].button) end
check(table.concat(p.opened, " ", before + 1) == "? notes:alerts start", "the raider's steps go to Previews, Alert settings and Start here: " .. table.concat(p.opened, " ", before + 1))
check(p.UI.previewing == true or next(p.UI.previews) == nil, "Previews turns the previews on")
p.UI:SetPreviews(false)
check(p.shown(), "a step's button leaves the Welcome open; Got it closes it")
-- the Previews step toggles and follows the real state
do
  local shownFor = {}
  p.UI:RegisterPreview("demo", function(on) shownFor.demo = on end)
  local pb = wv.steps[1].button
  check(pb.text == "Previews", "Previews: the button reads Previews while off")
  click(pb)
  check(p.UI.previewing == true and shownFor.demo == true, "Previews: a click turns the previews on")
  check(pb.text == "Previews: ON", "Previews: the button reads Previews: ON while on, got " .. tostring(pb.text))
  check(pb.w >= pb:GetFontString():GetStringWidth(), "Previews: the button is as wide as its longer label")
  click(pb)
  check(p.UI.previewing == false and shownFor.demo == false, "Previews: a second click turns them off")
  check(pb.text == "Previews", "Previews: the button reads Previews again")
  p.UI:SetPreviews(true)
  check(pb.text == "Previews: ON", "Previews: turned on elsewhere (title bar, /crt previews), the button follows")
  p.UI:SetPreviews(false)
  check(pb.text == "Previews", "Previews: turned off elsewhere, the button follows")
  p.UI:SetPreviews(true)
  p.UI.frame:Hide()
  check(pb.text == "Previews" and p.UI.previewing == false, "Previews: the main window closing turns them off and the button follows")
  local realCombat = InCombatLockdown
  InCombatLockdown = function() return true end
  local n = #p.printed
  click(pb)
  InCombatLockdown = realCombat
  check(p.UI.previewing == false and pb.text == "Previews", "Previews: in combat the click refuses and the button stays")
  check(#p.printed == n + 1 and p.printed[#p.printed]:find("combat", 1, true) ~= nil, "Previews: in combat the refusal is printed")
  p.UI:SetPreviews(false)
  p.UI.previews.demo = nil
end
-- at the largest text size everything fits the window's width and the steps hold their text
p.CRT.db.ui.fontSize = 22 p.CRT:ApplyFonts() W.Fill()
local inner = W.LAYOUT.width - 2 * p.UI.WINDOW_DEFAULTS.inset
for i = 1, 3 do
  local r = wv.steps[i]
  check(W.LAYOUT.number + r.text.w + W.LAYOUT.buttonGap + r.button.w <= inner, "22 pt: step " .. i .. " and its button fit the width")
  check(r.h >= r.text:GetStringHeight(), "22 pt: step " .. i .. "'s row holds its wrapped text")
end
check((wv.choice.buttons[1].w or 0) + 4 + (wv.choice.buttons[2].w or 0) <= inner, "22 pt: both choices fit")
p.CRT.db.ui.fontSize = 12 p.CRT:ApplyFonts()
p.welcome():Hide()
section("the Welcome's two choices, their steps and buttons, fitting at 22 pt")

-- 4. An upgrade: no line, no Welcome; a saved page kept -------------------------------------------------------------
local saved = copy(CRTDB)
p = boot({ ui = { theme = "blizzard" }, lastPage = "notes", debuffs = { size = 50 } })
check(p.CRT.freshInstall == false and #p.printed == 0, "an upgrade prints nothing")
check(p.CRT.db.welcome.pending == false, "an upgrade never has the Welcome waiting")
check(p.CRT.db.lastPage == "notes", "an existing profile keeps its saved page, got " .. tostring(p.CRT.db.lastPage))
p.slash("")
check(not p.shown(), "an upgrade's first /crt opens no Welcome")
-- the next login after the fresh install above: no line, no Welcome
p = boot(saved)
check(#p.printed == 0 and p.CRT.db.welcome.pending == false, "the login after a fresh install: no line, nothing waiting")
p.slash("")
check(not p.shown(), "and no Welcome")
-- a fresh install that reloads before the first /crt: the Welcome still waits, the line doesn't come again
p = boot(nil)
saved = copy(CRTDB)
p = boot(saved)
check(#p.printed == 0 and p.CRT.db.welcome.pending == true, "reloaded before the first /crt: no second line, the Welcome still waits")
p.slash("")
check(p.shown(), "and the first /crt opens it")
section("an upgrade: no line, no Welcome, the saved page kept")

-- 5. Saved data: welcome is account-wide and never in Export settings only -----------------------------------------
local profilesSrc = sources[3]
check(profilesSrc:match("local SHARED = (%b{})"):find("welcome = true", 1, true) ~= nil, "welcome is account-wide (SHARED)")
check(p.CRT.Profiles.SHARE.welcome == false, "Export settings only leaves welcome out")
check(p.CRT.defaults.welcome and p.CRT.defaults.welcome.pending == false, "welcome's default: nothing waiting")
p.CRT.db.welcome.pending = false
p.CRT.Profiles:Load()
check(CRTDB.welcome and CRTDB.welcome.pending == false, "a profile switch keeps welcome at the top of CRTDB")
section("welcome is account-wide and never exported")

-- 6. Start here: What's on from its one table ----------------------------------------------------------------------
p = boot(nil)
p.slash("")
p.welcome():Hide()
local S = p.CRT.StartPage
v = S.view
local rows = 0
for _, section in ipairs(S.WHATS_ON) do
  check(type(section.title) == "string" and #section > 0, "a section has a title and rows")
  for _, row in ipairs(section) do
    rows = rows + 1
    check(type(row.key) == "string" and type(row.label) == "string" and type(row.path) == "string" and type(row.where) == "string", row.key .. ": key, label, path and where")
    check(row.label:sub(2) == row.label:sub(2):lower() or row.label:find("Interrupts") or row.label:find("What's"), row.key .. ": its label in sentence case: " .. row.label)
  end
end
check(#v.rows == rows and rows > 0, "one row on the page per row of the table (" .. #v.rows .. ")")
for _, r in ipairs(v.rows) do
  check(r.check.kind == "CheckButton" and r.check.template == "UICheckButtonTemplate" and r.check.label == r.label, r.def.key .. ": a checkbox with its label")
  check(r.check:GetChecked() == S.Get(r.def), r.def.key .. ": the box shows the saved switch")
  check(r.link and r.link.label.text ~= nil and r.link.label.text ~= "", r.def.key .. ": a link")
end
-- a row with no setter of its own writes its field; the box follows
local function rowOf(key) for _, r in ipairs(v.rows) do if r.def.key == key then return r end end end
local wn = rowOf("whatsNew")
wn.check:SetChecked(false) click(wn.check)
check(p.CRT.db.whatsNew.show == false and S.Get(wn.def) == false, "unticked: What's new after updates writes whatsNew.show")
wn.check:SetChecked(true) click(wn.check)
check(p.CRT.db.whatsNew.show == true, "ticked again")
-- the inverted field: Minimap button is minimap.hide's opposite
local mm = rowOf("minimap")
local hidden
p.CRT.MinimapButton = { SetHidden = function(_, h) hidden = h p.CRT.db.minimap.hide = h end }
mm.check:SetChecked(false) click(mm.check)
check(hidden == true and p.CRT.db.minimap.hide == true and S.Get(mm.def) == false, "Minimap button unticked hides it through its own setter")
mm.check:SetChecked(true) click(mm.check)
check(p.CRT.db.minimap.hide == false and S.Get(mm.def) == true, "ticked shows it")
-- the links open their page on its tab
local before = #p.opened
click(rowOf("consumables").link) click(rowOf("debuffs").link) click(rowOf("speech").link) click(rowOf("pace").link) click(rowOf("minimap").link)
click(rowOf("tattle").link)
check(table.concat(p.opened, " ", before + 1) == "readycheck:auto qol:debuffs notes:alerts pace settings:appearance tattle:settings", "the links open their page and tab (Tattlebot on its Settings tab, where its switch is): " .. table.concat(p.opened, " ", before + 1))
check(rowOf("consumables").link.label.text == "Ready Check" and rowOf("debuffs").link.label.text == "Quality of Life", "a link reads its page's name")
-- Interrupts' page is hidden while it is off: its link greys, says why, and opens nothing
local kick = rowOf("interrupts")
p.CRT.Interrupts = { SetEnabled = function(_, on) p.CRT.db.interrupts.enabled = on p.UI:SetPageHidden("interrupts", not on) end }
S.Refresh()
check(kick.link.alpha < 1 and not kick.link.arrow.shown, "Interrupts off: its link greyed, no >")
before = #p.opened
click(kick.link)
check(#p.opened == before, "and a click opens nothing")
local ok, why = S.CanOpen(kick.def)
check(not ok and why and why:find("Enable Interrupts", 1, true), "its reason says to tick Enable Interrupts")
local gone = { key = "gone", page = "nosuchpage", where = "Nowhere" }
local okGone, whyGone = S.CanOpen(gone)
check(okGone == false and type(whyGone) == "string" and whyGone ~= "", "a link to a page that isn't loaded is greyed with a reason")
check(kick.help ~= nil, "Enable Interrupts keeps its (?)")
kick.check:SetChecked(true) click(kick.check)
check(p.CRT.db.interrupts.enabled == true and p.UI.pages.interrupts.hidden == false, "ticked on What's on: the Interrupts page shows")
check(kick.link.alpha == 1 and kick.link.arrow.shown, "and its link opens it")
kick.check:SetChecked(false) click(kick.check)
check(p.UI.pages.interrupts.hidden == true, "unticked: hidden again")
section("What's on: a checkbox per row bound to its field, links to each page")

-- 7. The page fits at the smallest and largest text sizes, in both looks ---------------------------------------------
local PW, PH = p.UI.PAGE_W, p.UI.PAGE_H
local function rightOf(r)
  -- the link's left edge: the check's x, then the check, the gap, the shared label width and the link gap
  local pt = r.link.pts[1]
  local cx = r.check.pts[1][2]
  return cx + S.LAYOUT.check + pt[4] + r.link.w
end
for _, look in ipairs({ { "blizzard", "Classic" }, { "cowfee", "Modern" } }) do
  p.UI:SetTheme(look[1])
  for _, pt in ipairs({ 8, 22 }) do
    p.CRT.db.ui.fontSize = pt p.CRT:ApplyFonts()
    S.Layout()
    local name = look[2] .. " " .. pt .. " pt"
    check(-v.bottom <= PH, name .. ": What's on ends inside the page (" .. -v.bottom .. " of " .. PH .. ")")
    local col2 = S.LAYOUT.col2
    for _, r in ipairs(v.rows) do
      local x0 = r.check.pts[1][2]
      local right = rightOf(r)
      local limit = x0 < col2 and col2 or PW
      check(right <= limit, name .. ": " .. r.def.key .. "'s link ends inside its column (" .. math.floor(right) .. " of " .. limit .. ")")
      check(r.h >= r.label:GetStringHeight(), name .. ": " .. r.def.key .. "'s row holds its text")
      check(r.link:GetHeight() >= r.link.label:GetStringHeight(), name .. ": " .. r.def.key .. "'s link holds its text")
    end
    -- rows don't overlap within a column
    for _, s in ipairs(v.sections) do
      for i = 2, #s.rows do check(s.rows[i].top <= s.rows[i - 1].top - s.rows[i - 1].h, name .. ": rows don't overlap") end
    end
    -- the intro line and the Welcome button fit the page's width
    local welcomeW = v.welcome:GetWidth()
    check(welcomeW >= v.welcome:GetFontString():GetStringWidth() + 2 * p.UI.PANEL_BUTTON_PAD, name .. ": the Welcome button is as wide as its label at this size")
    local introW = S.LAYOUT.x + v.title:GetStringWidth() + S.LAYOUT.introGap + v.intro:GetStringWidth() + S.LAYOUT.linkGap + welcomeW
    check(introW <= PW, name .. ": the title, the intro and Welcome fit on one line (" .. math.floor(introW) .. " of " .. PW .. ")")
  end
end
p.UI:SetTheme("blizzard")
section("Start here fits the page at 8 and 22 pt in Classic and Modern")

-- 8. The menu: Start here first in General -----------------------------------------------------------------------
check(p.UI.MENU_GROUPS[1][1] == "start" and p.UI.MENU_GROUPS[1].label == "General", "Start here is first in General")
check(p.UI.MENU_GROUPS[4].label == "Extras", "the Modules group is now Extras")
p.UI:SelectPage("nothing")
check(p.CRT.db.lastPage == "start", "a page that is gone falls back to Start here")
section("the menu: Start here first, Extras")

say(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of FILES) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, FILES.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
