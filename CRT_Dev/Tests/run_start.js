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
  'CRT_Core/UI/ScrollBar.lua', 'CRT_Core/UI/Controls.lua', 'CRT_Core/UI/Spotlight.lua', 'CRT_Core/UI/Toggle.lua', 'CRT_Core/UI/StartPage.lua', 'CRT_Core/UI/Welcome.lua'];
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
    if k == "SetParent" then return function(self, p)
      local old = rawget(self, "parent")
      if type(old) == "table" and rawget(old, "children") then for i, c in ipairs(old.children) do if c == self then table.remove(old.children, i) break end end end
      rawset(self, "parent", p)
      if type(p) == "table" and rawget(p, "children") then table.insert(p.children, self) end
    end end
    if k == "RegisterEvent" then return function(self, e) rawset(self, "events", rawget(self, "events") or {}) self.events[e] = true end end
    if k == "UnregisterEvent" then return function(self, e) local ev = rawget(self, "events") if ev then ev[e] = nil end end end
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
  CRT.TimelinePage = { Open = function(tab) opened[#opened + 1] = "timeline:" .. tostring(tab) end }
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
    -- the help line (#1311): beside the heading and its (?), or under the heading when that doesn't fit; inside the
    -- page either way, and above the first section
    local hp, lp = v.whatsOn.pts[1], v.whatsOnLine.pts[1]
    local headW, headH = v.whatsOn:GetStringWidth(), v.whatsOn:GetStringHeight()
    local lineH = v.whatsOnLine:GetStringHeight()
    local lineW = v.whatsOnLine.w and v.whatsOnLine.w > 0 and math.min(v.whatsOnLine.w, v.whatsOnLine:GetStringWidth()) or v.whatsOnLine:GetStringWidth()
    if v.lineBeside then
      check(lp[2] >= hp[2] + headW + p.UI.HELP_GAP + p.UI.HELP_SIZE, name .. ": the help line starts after the heading's (?)")
      check(lp[3] <= hp[3] and lp[3] - lineH >= hp[3] - headH - 1, name .. ": the help line sits on the heading's line")
    else
      check(lp[2] == hp[2] and lp[3] <= hp[3] - headH, name .. ": the help line goes under the heading")
      check(v.whatsOnLine:GetStringWidth() + lp[2] > PW - S.LAYOUT.x or hp[2] + headW + p.UI.HELP_GAP + p.UI.HELP_SIZE + S.LAYOUT.linkGap + v.whatsOnLine:GetStringWidth() > PW - S.LAYOUT.x, name .. ": under only when it doesn't fit beside")
    end
    if pt == 8 then check(v.lineBeside, name .. ": at the smallest size the help line is beside the heading") end
    check(lp[2] + lineW <= PW, name .. ": the help line ends inside the page (" .. math.floor(lp[2] + lineW) .. " of " .. PW .. ")")
    check(v.sections[1].heading.pts[1][3] <= lp[3] - lineH, name .. ": the first section starts under the help line")
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

-- 9. The help line's text, and each link's spotlight (#1311) ----------------------------------------------------------
-- The pages register stand-in switches here (the real pages' are checked in run_addon.js): a check box with its label.
p = boot(nil)
p.slash("")
p.welcome():Hide()
S = p.CRT.StartPage
v = S.view
local UI = p.UI
local SP = UI.SPOTLIGHT
check(v.whatsOnLine and v.whatsOnLine.text == "Tick to turn a feature on or off. Click a page name to go to its settings.", "the help line reads: " .. tostring(v.whatsOnLine and v.whatsOnLine.text))
check(S.TEXT.whatsOnLine == v.whatsOnLine.text, "its text is in the TEXT table")
check(v.whatsOnLine.font == "CRTFontSmall", "the help line is in the body text's font, not the muted grey")
check(v.whatsOnHelp ~= nil, "the heading keeps its (?) for the longer explanation")
local host = CreateFrame("Frame", nil, UIParent)
local function control(text)
  local cb = CreateFrame("CheckButton", nil, host, "UICheckButtonTemplate")
  cb:SetSize(24, 24)
  local fs = host:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
  fs:SetText(text)
  fs:SetPoint("LEFT", cb, "RIGHT", 2, 0)
  cb.label = fs
  return cb
end
local function linkOf(key) for _, r in ipairs(v.rows) do if r.def.key == key then return r.link end end end
local OPENS = {}
for _, r in ipairs(v.rows) do
  local d = r.def
  OPENS[d.key] = d.tab and (d.page .. ":" .. d.tab) or d.page
end
local switches, without = {}, {}
for _, r in ipairs(v.rows) do
  if r.def.spot then
    switches[r.def.key] = control(r.def.label .. " switch")
    UI:RegisterSpot(r.def.page, r.def.spot, switches[r.def.key])
  else
    without[#without + 1] = r.def.key
  end
end
table.sort(without)
check(table.concat(without, " ") == "interrupts whatsNew", "every row names its switch but Enable Interrupts (its only switch) and What's new (a window): " .. table.concat(without, " "))
local function boxOf() return UI.spotlight.box end
p.CRT.WhatsNew = { ShowNow = function() end }
for _, r in ipairs(v.rows) do
  local key = r.def.key
  local before = #p.opened
  click(r.link)
  if r.def.spot then
    local sw = switches[key]
    check(p.opened[before + 1] == OPENS[key], key .. ": its link opens " .. OPENS[key] .. ", got " .. tostring(p.opened[before + 1]))
    check(UI.spotlight.target == sw, key .. ": its switch there is spotlighted")
    local box = boxOf()
    check(box and box.shown and box.parent == host, key .. ": the box shows, on the switch's own parent (it hides with its page)")
    local pt = box and box.pts[1] or {}
    check(pt[1] == "LEFT" and pt[2] == sw and pt[3] == "LEFT" and pt[4] == -SP.pad, key .. ": the box starts " .. SP.pad .. " px left of the box")
    local textW = sw.label:GetStringWidth()
    check(box.w == 24 + 2 + textW + 2 * SP.pad and box.h == 24 + 2 * SP.pad, key .. ": the box covers the switch and its label, " .. SP.pad .. " px around (" .. tostring(box.w) .. " x " .. tostring(box.h) .. ")")
  end
end
-- the outline: four edges, 2 px, in the theme's accent colour
UI.Spotlight(switches.pace, { label = switches.pace.label })
local box = boxOf()
local ar, ag, ab = UI.Color("accent")
local e1 = box.edges and box.edges[1]
check(SP.edge == 2 and #box.edges == 4 and e1.color and e1.color[1] == ar and e1.color[2] == ag and e1.color[3] == ab and e1.color[4] == 1, "the outline is four 2 px edges in the accent colour, full at first")
check(box.events and box.events.GLOBAL_MOUSE_DOWN, "while it shows, it listens for a click")
-- a gentle pulse, then a fade, gone by SP.seconds; never fast
check(UI.SpotlightAlpha(0) == 1 and UI.SpotlightAlpha(SP.seconds) == 0, "the pulse starts full and ends at nothing")
check(SP.seconds >= 2.5 and SP.seconds <= 3.5, "it lasts about 3 s (" .. SP.seconds .. ")")
local dips, last, falling, low = 0, 1, false, 1
for i = 1, math.floor(SP.seconds * 100) do
  local a = UI.SpotlightAlpha(i / 100)
  if a > last and falling then dips = dips + 1 end
  falling = a < last
  if i / 100 < SP.seconds - SP.fade then low = math.min(low, a) end
  last = a
end
check(1 / SP.period < 3 and dips / SP.seconds < 3, "well under 3 pulses a second (" .. dips .. " in " .. SP.seconds .. " s)")
check(low >= SP.low - 0.001 and low > 0, "it never blinks out while it pulses (lowest " .. low .. ")")
local t = 0
while t < SP.seconds - 0.2 do box.scripts.OnUpdate(box, 0.1) t = t + 0.1 end
check(box.shown and UI.spotlight.target == switches.pace, "still up just before " .. SP.seconds .. " s")
box.scripts.OnUpdate(box, 0.3)
check(not box.shown and UI.spotlight.target == nil and not (box.events and box.events.GLOBAL_MOUSE_DOWN), "gone after " .. SP.seconds .. " s, and no longer listening")
-- a click anywhere takes it away early
UI.Spotlight(switches.pace)
box.scripts.OnEvent(box, "GLOBAL_MOUSE_DOWN", "LeftButton")
check(not box.shown and UI.spotlight.target == nil, "a click anywhere takes it away")
-- its page hiding takes it away, and it stays away when the page shows again
UI.Spotlight(switches.pace)
local function hideTree(f)
  f:Hide()
  local function down(x) for _, c in ipairs(rawget(x, "children") or {}) do if c.shown and c.scripts.OnHide then c.scripts.OnHide(c) end down(c) end end
  down(f)
end
hideTree(host)
check(not box.shown and UI.spotlight.target == nil, "its page hiding takes it away")
host:Show()
check(not box.shown, "and it stays away when the page shows again")
-- a missing switch: the page opens, no box, no error (logged here, never to chat)
UI.spots.pace.shown = nil
local printedBefore = #p.printed
local okMissing, err = pcall(click, linkOf("pace"))
check(okMissing, "a missing switch: no error: " .. tostring(err))
check(p.opened[#p.opened] == "pace" and UI.spotlight.target == nil and not box.shown, "a missing switch: the page opens with no box")
check(#p.printed == printedBefore, "a missing switch says nothing in chat")
say("  log start: the Pace window's switch not registered: Pace opened with no box")
-- a spot named by a function brings its control on screen first (an area picked in a list)
local picked
local area = control("Show these alerts")
UI:RegisterSpot("notes", "area:icons", function() picked = "icons" return area end)
click(linkOf("alertIcons"))
check(picked == "icons" and UI.spotlight.target == area and UI.spotlight.label == area.label, "a spot named by a function: it runs first, then its control and label are spotlighted")
-- a control in a scroll frame is scrolled into view, unless it already shows
local scroll = CreateFrame("ScrollFrame", nil, UIParent)
local child = CreateFrame("Frame", nil, scroll)
local deep = CreateFrame("CheckButton", nil, child)
local scrolled
rawset(scroll, "GetScrollChild", function() return child end)
rawset(scroll, "GetHeight", function() return 100 end)
rawset(scroll, "GetVerticalScroll", function() return 0 end)
rawset(scroll, "GetVerticalScrollRange", function() return 400 end)
rawset(scroll, "SetVerticalScroll", function(_, y) scrolled = y end)
rawset(child, "GetTop", function() return 500 end)
rawset(deep, "GetTop", function() return 200 end)
rawset(deep, "GetBottom", function() return 176 end)
UI.Spotlight(deep)
check(scrolled == 300 - SP.view, "a control below the fold is scrolled into view, with room above it: " .. tostring(scrolled))
scrolled = nil
rawset(deep, "GetTop", function() return 470 end)
rawset(deep, "GetBottom", function() return 446 end)
UI.Spotlight(deep)
check(scrolled == nil, "a control already in view isn't scrolled")
-- in a scroll frame the box sits on the scroll frame's parent, above it, cut to its edges, so nothing clips it
local pane = CreateFrame("Frame", nil, UIParent)
local list = CreateFrame("ScrollFrame", nil, pane)
local rows = CreateFrame("Frame", nil, list)
local first = CreateFrame("CheckButton", nil, rows)
first:SetSize(24, 24)
local wheel = 0
list:SetScript("OnMouseWheel", function() wheel = wheel + 1 end)
rawset(list, "GetScrollChild", function() return rows end)
rawset(list, "GetLeft", function() return 100 end) rawset(list, "GetRight", function() return 400 end)
rawset(list, "GetTop", function() return 500 end) rawset(list, "GetBottom", function() return 400 end)
rawset(list, "GetHeight", function() return 100 end)
rawset(list, "GetVerticalScroll", function() return 0 end)
rawset(list, "GetVerticalScrollRange", function() return 300 end)
rawset(list, "SetVerticalScroll", function() end)
rawset(rows, "GetTop", function() return 500 end)
-- the first row, its left edge 1 px inside the list and its top 2 px under the list's top
rawset(first, "GetLeft", function() return 101 end)
rawset(first, "GetTop", function() return 498 end) rawset(first, "GetBottom", function() return 474 end)
check(UI.Spotlight(first) ~= nil, "a control at the top of a list is spotlighted")
local bp = box.pts[1] or {}
check(box.parent == pane, "in a scroll frame the box is on the scroll frame's parent, never inside what it clips")
check(bp[1] == "TOPLEFT" and bp[2] == list and bp[3] == "TOPLEFT", "placed from the scroll frame's corner")
check((bp[4] or -1) >= 0 and (bp[5] or 1) <= 0, "its left and top never pass the scroll frame's edges (" .. tostring(bp[4]) .. ", " .. tostring(bp[5]) .. ")")
check(bp[4] + box.w <= 300 and -bp[5] + box.h <= 100, "nor its right and bottom")
check(bp[4] == 0 and bp[5] == 0 and box.w == 101 + 24 + SP.pad - 100 and box.h == 500 - (486 - 12 - SP.pad), "cut where the list's edge is, the rest " .. SP.pad .. " px around (" .. box.w .. " x " .. box.h .. ")")
-- the list scrolling takes it away: the wheel, or a scroll elsewhere; its own scroll doesn't
list.scripts.OnVerticalScroll(list, 0)
check(box.shown and UI.spotlight.target == first, "the scroll that brought it into view keeps it")
list.scripts.OnVerticalScroll(list, 40)
check(not box.shown and UI.spotlight.target == nil, "the list scrolled: the box goes")
UI.Spotlight(first)
list.scripts.OnMouseWheel(list, -1)
check(not box.shown and wheel == 1, "the mouse wheel on the list takes it away, and the list still scrolls")
-- a control out of the list's view gets no box
rawset(first, "GetTop", function() return 380 end) rawset(first, "GetBottom", function() return 356 end)
check(UI.Spotlight(first) == nil and not box.shown, "a control outside the list's view: no box")
-- a control that isn't shown gets no box
local hidden = control("Hidden switch")
hidden:Hide()
UI:RegisterSpot("pace", "hidden", hidden)
check(UI:GoToSpot("pace", "hidden") == nil and UI.Spotlight(hidden) == nil and not box.shown and not (box.events and box.events.GLOBAL_MOUSE_DOWN), "a switch that isn't shown: no box, not listening")
UI.ClearSpotlight()
-- the Welcome's voice step spotlights the voice it names
local voice = control("Voice")
UI:RegisterSpot("notes", "voice", function() return voice end)
local W = p.CRT.Welcome
W:Open()
for _, half in ipairs(W.view.choice.buttons) do if half.key == "raider" then click(half) end end
check(W.STEPS.raider[2].spot and W.STEPS.raider[2].spot[1] == "notes" and W.STEPS.raider[2].spot[2] == "voice", "the Welcome's voice step names the voice setting")
click(W.view.steps[2].button)
check(p.opened[#p.opened] == "notes:alerts" and UI.spotlight.target == voice, "the Welcome's voice step opens Alert settings and spotlights the voice")
-- the Welcome over the spotlighted Voice: it moves beside the main window, kept on screen
local function rectOf(f, l, r, t, b)
  rawset(f, "GetLeft", function() return l end) rawset(f, "GetRight", function() return r end)
  rawset(f, "GetTop", function() return t end) rawset(f, "GetBottom", function() return b end)
end
local win = p.welcome()
rectOf(UIParent, 0, 1920, 1080, 0)
rectOf(UI.frame, 300, 1100, 900, 300)
rectOf(win, 500, 960, 800, 600)
rectOf(voice, 520, 700, 700, 676)
win.pts = {}
click(W.view.steps[2].button)
local wp = win.pts[#win.pts] or {}
check(wp[1] == "TOPLEFT" and wp[2] == UIParent and wp[4] == 1100 + W.LAYOUT.aside and wp[5] == 800, "the Welcome covering the Voice moves right of the main window: " .. tostring(wp[4]) .. ", " .. tostring(wp[5]))
-- no room on the right: it goes left of it; no room on either side: kept on screen
rectOf(UI.frame, 1000, 1800, 900, 300)
win.pts = {}
click(W.view.steps[2].button)
wp = win.pts[#win.pts] or {}
check(wp[4] == 1000 - W.LAYOUT.aside - 460, "no room on the right: left of the main window: " .. tostring(wp[4]))
rectOf(UI.frame, 10, 1910, 900, 300)
win.pts = {}
click(W.view.steps[2].button)
wp = win.pts[#win.pts] or {}
check(wp[4] and wp[4] >= 0 and wp[4] + 460 <= 1920, "no room either side: kept on screen: " .. tostring(wp[4]))
-- the Welcome clear of the Voice stays where it is
rectOf(win, 1200, 1660, 800, 600)
rectOf(UI.frame, 300, 1100, 900, 300)
win.pts = {}
click(W.view.steps[2].button)
check(#win.pts == 0, "the Welcome clear of the Voice stays where it is")
UI.ClearSpotlight()
click(W.view.steps[3].button)
check(UI.spotlight.target == nil, "a step that names no setting opens its page with no box")
section("the help line, and each link's spotlight: opens, covers, pulses, fades, clears")


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
