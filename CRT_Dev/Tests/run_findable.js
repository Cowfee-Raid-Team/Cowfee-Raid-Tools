// Findable (UX rule 10, job 20261124-ux-findable): CRT's entry in Esc > Options > AddOns (CRT_Core/UI/OptionsEntry.lua)
// registers when the game's Settings API is there and is skipped without it, and its button closes the game's settings
// and opens the main window; the addon menu's enter and leave (CRT_Core/UI/Minimap.lua, named in the .toc) show and
// hide a tooltip with the clicks; every registered page has a one-line menu tip (UI.PageTip, CRT_Core/UI/Panel.lua),
// shown on hover in both looks; /crt help lists the everyday commands, /crt help all the rest, and an unknown word
// prints one line (CRT_Core/Slash.lua).
// Usage: node run_findable.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const dir = process.argv[2];
const FILES = ['CRT_Core/Core.lua', 'CRT_Core/Themes.lua', 'CRT_Core/Profiles.lua', 'CRT_Core/Slash.lua', 'CRT_Core/UI/Panel.lua',
  'CRT_Core/UI/ScrollBar.lua', 'CRT_Core/UI/Minimap.lua', 'CRT_Core/UI/OptionsEntry.lua'];
// Every page key the addon registers (UI:RegisterPage("key", ...) anywhere in its Lua), and whether it passes its own tip
const registered = [];
// and every word a module registers (CRT.Slash:Register("word", ...)), with Core's own (msg == "word" in Slash.lua)
const words = [];
for (const m of fs.readFileSync(path.join(dir, 'CRT_Core/Slash.lua'), 'utf8').matchAll(/msg == "([^"]+)"/g)) words.push(m[1]);
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!/^(\.|node_modules|Tests$)/.test(e.name)) walk(p); continue; }
    if (!e.name.endsWith('.lua')) continue;
    const src = fs.readFileSync(p, 'utf8');
    const re = /UI:RegisterPage\("([^"]+)",\s*([^,]+),\s*([^,\n)]+)(,\s*"([^"]*)")?\)/g;
    let m;
    while ((m = re.exec(src))) registered.push({ key: m[1], tip: m[5] || '', file: path.relative(dir, p) });
    const sw = /Slash:Register\("([^"]+)"/g;
    while ((m = sw.exec(src))) words.push(m[1]);
  }
})(dir);
const toc = fs.readFileSync(path.join(dir, 'CowfeeRaidTools.toc'), 'utf8');
const harness = `
local sources = { ... }
local NAMES = { ${FILES.map(f => JSON.stringify(f)).join(', ')} }
local REGISTERED = { ${registered.map(r => `{ key = ${JSON.stringify(r.key)}, tip = ${JSON.stringify(r.tip)}, file = ${JSON.stringify(r.file)} }`).join(', ')} }
local TOC = ${JSON.stringify(toc)}
local WORDS = {} for _, w in ipairs({ ${words.map(w => JSON.stringify(w)).join(', ')} }) do WORDS[w] = true end
local say = print
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 say("FAIL " .. what) end end
local sectionFails = 0
local function section(what) if fails == sectionFails then say("ok findable: " .. what) end sectionFails = fails end
local unpack = unpack or table.unpack

local made = {}
local function mock(kind)
  local m = { kind = kind, shown = true, pts = {}, regions = {}, children = {}, scripts = {}, events = {} }
  made[#made + 1] = m
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" then return function(self, _, layer, font)
      local fsx = mock("FontString") rawset(fsx, "font", font) rawset(fsx, "text", "") table.insert(self.regions, fsx) return fsx end end
    if k == "CreateTexture" then return function(self) local tx = mock("Texture") table.insert(self.regions, tx) return tx end end
    if k == "GetRegions" then return function(self) return unpack(self.regions) end end
    if k == "GetChildren" then return function(self) return unpack(self.children) end end
    if k == "GetParent" then return function(self) return rawget(self, "parent") end end
    if k == "GetObjectType" then return function(self) return self.kind end end
    if k == "SetScript" then return function(self, n, fn) self.scripts[n] = fn end end
    if k == "GetScript" then return function(self, n) return self.scripts[n] end end
    if k == "HookScript" then return function(self, n, fn) local old = self.scripts[n] self.scripts[n] = function(...) if old then old(...) end fn(...) end end end
    if k == "RegisterEvent" then return function(self, e) self.events[e] = true end end
    if k == "Show" then return function(self) self.shown = true end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) self.shown = on and true or false end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "SetWidth" then return function(self, w) rawset(self, "w", w) end end
    if k == "SetHeight" then return function(self, h) rawset(self, "h", h) end end
    if k == "GetWidth" then return function(self) return rawget(self, "w") or 0 end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "ClearAllPoints" then return function(self) self.pts = {} end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) local fsx = rawget(self, "fontString") if fsx then fsx.text = s end end end
    if k == "GetText" then return function(self) return rawget(self, "text") end end
    if k == "GetFontString" then return function(self)
      local fsx = rawget(self, "fontString")
      if not fsx then fsx = mock("FontString") rawset(fsx, "text", rawget(self, "text") or "") rawset(self, "fontString", fsx) end
      return fsx
    end end
    if k == "GetStringWidth" then return function(self) return #(rawget(self, "text") or "") * 7 end end
    if k == "GetFont" then return function() return "f", 12, "" end end
    if k == "SetFontObject" then return function(self, o) rawset(self, "font", o) end end
    if k == "SetColorTexture" then return function(self, r, g, b, a) rawset(self, "color", { r, g, b, a }) end end
    if k == "SetTextColor" then return function(self, r, g, b) rawset(self, "textColor", { r, g, b }) end end
    if k == "SetScrollChild" then return function(self, c) rawset(self, "child", c) end end
    if k == "IsMouseEnabled" then return function() return true end end
    if k == "GetFrameLevel" then return function() return 1 end end
    return function() end end })
end
function CreateFrame(kind, name, parent, template)
  local f = mock(kind) rawset(f, "parent", parent) rawset(f, "template", template)
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
UIParent = mock("UIParent") UISpecialFrames = {} SlashCmdList = {} Minimap = mock("Minimap")
function tinsert(t, v) table.insert(t, v) end
format = string.format
strtrim = function(s) return ((s or ""):gsub("^%s+", ""):gsub("%s+$", "")) end
InCombatLockdown = function() return false end
GetTime = function() return 0 end
C_AddOns = { GetAddOnMetadata = function(_, field) if field == "Version" then return "1.4.9" end end }
C_Timer = { After = function() end }
local function fontObject(p, size, flags)
  local o = { path = p, size = size, flags = flags, color = { 1, 1, 1 } }
  function o:CopyFontObject(src) self.path, self.size, self.flags = src.path, src.size, src.flags end
  function o:GetFont() return self.path, self.size, self.flags end
  function o:SetFont(a, s, f) self.path, self.size, self.flags = a, s, f end
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

-- The game's tooltip: who owns it, how it is anchored, its lines, and whether it shows
local tip = { lines = {}, shown = false }
GameTooltip = setmetatable(tip, { __index = function(_, k)
  if k == "SetOwner" then return function(self, owner, anchor) self.owner, self.anchor, self.lines = owner, anchor, {} end end
  if k == "SetText" then return function(self, s) self.lines = { s } end end
  if k == "AddLine" then return function(self, s) self.lines[#self.lines + 1] = s end end
  if k == "Show" then return function(self) self.shown = true end end
  if k == "Hide" then return function(self) self.shown = false end end
  return function() end
end })
local printed = {}
print = function(...) local t = {} for i = 1, select("#", ...) do t[#t + 1] = tostring((select(i, ...))) end printed[#printed + 1] = table.concat(t, " ") end

-- One login with the files above. settings: the game's Settings API stand-in, or nil for a client without it.
local function boot(settings, panel)
  made, printed = {}, {}
  Settings, SettingsPanel = settings, panel
  local CRT = {}
  CRTDB, CRTDBChar = nil, {}
  for i, src in ipairs(sources) do
    local fn, err = load(src, NAMES[i])
    assert(fn, err)
    fn("CowfeeRaidTools", CRT)
    if NAMES[i] == "CRT_Core/UI/Panel.lua" then
      -- placing tooltips is tested in run_tooltip.js: this one records the owner, the anchor and the how
      CRT.UI.TOOLTIP_KEEP = "keep"
      CRT.UI.TooltipOwner = function(t, owner, anchor, x, y, how) t:SetOwner(owner, anchor) t.how = how return "owner" end
    end
  end
  for _, f in ipairs(made) do if f.scripts.OnEvent and f.events.ADDON_LOADED then pcall(f.scripts.OnEvent, f, "ADDON_LOADED", "CowfeeRaidTools") end end
  CRT.db.ui.theme, CRT.db.ui.modern = "blizzard", false
  CRT:UseTheme("blizzard")
  local errs = {}
  for _, f in ipairs(made) do
    if f.scripts.OnEvent and f.events.PLAYER_LOGIN then
      local ok, e = pcall(f.scripts.OnEvent, f, "PLAYER_LOGIN")
      if not ok then errs[#errs + 1] = tostring(e) end
    end
  end
  return CRT, errs
end
local function slash(msg)
  local before = #printed
  SlashCmdList.COWFEERAIDTOOLS(msg)
  return table.concat(printed, "\\n", before + 1), #printed - before
end

-- 1. Esc > Options > AddOns ---------------------------------------------------------------------------------------
local calls = {}
local fakeSettings = {
  RegisterCanvasLayoutCategory = function(frame, name)
    calls[#calls + 1] = "canvas"
    local category = { frame = frame, name = name, GetID = function() return 77 end }
    return category, { frame = frame }
  end,
  RegisterAddOnCategory = function(category) calls[#calls + 1] = "addon" calls.category = category end,
}
local panel = mock("Frame")
panel.shown = true
rawset(panel, "Close", function(self, skip) self.closedWith = skip self.shown = false end)
local CRT, errs = boot(fakeSettings, panel)
local O = CRT.OptionsEntry
check(#errs == 0, "PLAYER_LOGIN runs without error: " .. table.concat(errs, " | "))
check(O ~= nil, "OptionsEntry.lua loads")
check(table.concat(calls, " ") == "canvas addon", "a canvas category, then listed under AddOns: " .. table.concat(calls, " "))
local cat = calls.category
check(cat and cat.name == "Cowfee Raid Tools" and O.category == cat, "named Cowfee Raid Tools, and kept")
check(cat and cat.frame and cat.frame.shown == false, "its canvas frame starts hidden; the game's panel shows it")
local v = O.view or {}
check(v.line and v.line.text ~= "" and v.line.text:find("%.$") ~= nil, "one line on what CRT is: " .. tostring(v.line and v.line.text))
check(v.open and v.open.text == "Open Cowfee Raid Tools" and v.open.template == "UIPanelButtonTemplate", "an Open Cowfee Raid Tools panel button")
check(v.open and v.open.w >= #v.open.text * 7, "the button is as wide as its label")
check(v.orType and v.orType.text == "Or type /crt.", "and Or type /crt.")
check(O.Register() == true and #calls == 2, "registering again does nothing more")
check(not CRT.UI.frame or not CRT.UI.frame.shown, "the main window is closed")
v.open.scripts.OnClick(v.open, "LeftButton")
check(panel.shown == false and panel.closedWith == true, "Open closes the game's settings, not back to the game menu")
check(CRT.UI.frame and CRT.UI.frame.shown, "and opens the main window")
-- the game's Close refused (it errors): the panel is hidden another way
panel.shown = true
rawset(panel, "Close", function() error("no") end)
local hidden
HideUIPanel = function(p) hidden = p p.shown = false end
CRT.UI.frame:Hide()
O.Open()
check(hidden == panel and CRT.UI.frame.shown, "with Close failing, HideUIPanel hides it and the window still opens")
HideUIPanel = nil
section("Esc > Options > AddOns: a canvas category; its button closes Options and opens /crt")

-- a client without the Settings API, or with one that errors
CRT, errs = boot(nil, nil)
check(#errs == 0 and CRT.OptionsEntry.category == nil, "no Settings API: skipped, no error")
check(CRT.OptionsEntry.Register() == false, "and Register says so")
CRT, errs = boot({ RegisterCanvasLayoutCategory = function() error("moved") end, RegisterAddOnCategory = function() end }, nil)
check(#errs == 0 and CRT.OptionsEntry.category == nil, "a Settings API that errors: skipped, no error")
CRT, errs = boot({ RegisterCanvasLayoutCategory = fakeSettings.RegisterCanvasLayoutCategory }, nil)
check(#errs == 0 and CRT.OptionsEntry.category == nil, "half an API (no RegisterAddOnCategory): skipped")
CRT.OptionsEntry.Open()
check(CRT.UI.frame and CRT.UI.frame.shown, "Open with no settings panel still opens the main window")
check(TOC:find("CRT_Core\\\\UI\\\\OptionsEntry.lua", 1, true) ~= nil, "OptionsEntry.lua has its .toc line")
section("no Settings API, or a broken one: nothing registers, nothing errors")

-- 2. The addon menu beside the minimap ----------------------------------------------------------------------------
CRT = boot(nil, nil)
check(TOC:find("## AddonCompartmentFuncOnEnter: CowfeeRaidTools_OnAddonCompartmentEnter", 1, true) ~= nil, "the .toc names the enter handler")
check(TOC:find("## AddonCompartmentFuncOnLeave: CowfeeRaidTools_OnAddonCompartmentLeave", 1, true) ~= nil, "the .toc names the leave handler")
check(type(CowfeeRaidTools_OnAddonCompartmentEnter) == "function" and type(CowfeeRaidTools_OnAddonCompartmentLeave) == "function", "both globals exist")
local menuButton = mock("Button")
CowfeeRaidTools_OnAddonCompartmentEnter("CowfeeRaidTools", menuButton)
local text = table.concat(GameTooltip.lines, " / ")
check(GameTooltip.shown and GameTooltip.owner == menuButton, "enter: the tooltip shows on the menu's button")
check(GameTooltip.lines[1] == "Cowfee Raid Tools", "titled Cowfee Raid Tools: " .. text)
check(text:find("Left-click: open", 1, true) and text:find("Right-click: General Settings.", 1, true), "it says what each click does: " .. text)
CowfeeRaidTools_OnAddonCompartmentLeave("CowfeeRaidTools", menuButton)
check(not GameTooltip.shown, "leave: it hides")
check(pcall(CowfeeRaidTools_OnAddonCompartmentEnter, "CowfeeRaidTools", nil), "enter with no button: no error")
-- the tooltip matches the clicks: left opens (or closes) the window, right opens General Settings
local shown = {}
local show = CRT.UI.Show
CRT.UI.Show = function(self, key) shown[#shown + 1] = key or "-" return show(self, key) end
CowfeeRaidTools_OnAddonCompartmentClick("CowfeeRaidTools", "LeftButton")
check(CRT.UI.frame and CRT.UI.frame.shown, "left-click opens the main window")
CowfeeRaidTools_OnAddonCompartmentClick("CowfeeRaidTools", "RightButton")
check(shown[#shown] == "settings", "right-click opens General Settings")
CRT.UI.Show = show
section("the addon menu's entry: enter shows the clicks, leave hides")

-- 3. Menu tips ----------------------------------------------------------------------------------------------------
check(#REGISTERED >= 16, "the addon's pages are found (" .. #REGISTERED .. ")")
CRT = boot(nil, nil) -- the pages register before the main window makes their entries, as at login
local UI = CRT.UI
for _, r in ipairs(REGISTERED) do
  if not UI.pages[r.key] then UI:RegisterPage(r.key, r.key, function() end, r.tip ~= "" and r.tip or nil) end
end
for _, r in ipairs(REGISTERED) do
  local t = UI.PageTip(r.key)
  check(type(t) == "string" and t ~= "", r.key .. " (" .. r.file .. ") has a menu tip")
  if type(t) == "string" then
    check(not t:find("\\n") and t:find("^%u") and t:find("%.$") and not t:find("%. %u"), r.key .. ": one sentence: " .. t)
    check(#t <= 80, r.key .. ": short enough for one tooltip line (" .. #t .. ")")
  end
end
local f = UI:Create()
for _, look in ipairs({ "blizzard", "cowfee" }) do
  UI:SetTheme(look)
  for _, r in ipairs(REGISTERED) do
    local b = UI.pages[r.key].button
    check(b and b.scripts.OnEnter and b.scripts.OnLeave, look .. ": " .. r.key .. "'s entry has hover scripts")
    if b and b.scripts.OnEnter then
      b.scripts.OnEnter(b)
      check(GameTooltip.shown and GameTooltip.owner == b and GameTooltip.anchor == "ANCHOR_RIGHT" and GameTooltip.how == "keep",
        look .. ": hovering " .. r.key .. " shows its tip right of the entry, beside the menu")
      check(GameTooltip.lines[1] == UI.pages[r.key].title and GameTooltip.lines[2] == UI.PageTip(r.key), look .. ": the page's name, then its tip")
      b.scripts.OnLeave(b)
      check(not GameTooltip.shown, look .. ": leaving hides it")
    end
  end
end
UI:SetTheme("blizzard")
section("every registered page has a one-sentence tip, shown on hover in both looks")

-- 4. /crt help, /crt help all, and an unknown word ----------------------------------------------------------------
CRT.Slash:Register("demo", { run = function() end, help = { "[/crt demo] - a module's own word" } })
local out, n = slash("help")
local want = { "/crt", "/crt welcome", "/crt settings", "/crt timeline", "/crt notes", "/crt check", "/crt groups", "/crt loot", "/crt previews", "/crt help all" }
check(out:find("v" .. CRT.version, 1, true) ~= nil, "/crt help starts with the version")
check(n == #want + 1, "/crt help is the version line and " .. #want .. " commands, got " .. n .. " lines")
local lines = {}
for l in (out .. "\\n"):gmatch("(.-)\\n") do lines[#lines + 1] = l end
for i, w in ipairs(want) do
  local l = lines[i + 1] or ""
  check(l:find("|cffffd100" .. w .. "|r", 1, true) ~= nil, "line " .. (i + 1) .. " is " .. w .. ": " .. l)
end
-- each everyday command is one the addon runs: Core's own, or a word a module registers
for _, w in ipairs(want) do
  local word = w:match("^/crt (.+)$")
  check(word == nil or WORDS[word] or WORDS[word:match("^%S+")], w .. " is a command the addon handles")
end
check(not out:find("/crt demo", 1, true) and not out:find("consumables scan", 1, true) and not out:find("/crt perf", 1, true), "maintenance and module words are left out of /crt help")
local all = slash("help all")
for _, w in ipairs({ "/crt readycheck", "/crt check food", "/crt rc", "/crt debuffs", "/crt notes", "/crt reminders", "/crt note test", "/crt break 10", "/crt qol",
    "/crt settings", "/crt team", "/crt minimap", "/crt lowhp off", "/crt perf", "/crt previews", "/crt consumables scan", "/crt consumables check", "/crt whatsnew", "/crt help", "/crt demo" }) do
  check(all:find("|cffffd100" .. w .. "|r", 1, true) ~= nil, "/crt help all lists " .. w)
end
check(select(2, slash("help all")) > 20, "/crt help all is the whole list")
check(select(2, slash("?")) == n, "/crt ? is /crt help")
for _, word in ipairs({ "nonsense", "help nothing", "demo2" }) do
  local u, c = slash(word)
  check(c == 1 and u:find("Unknown command. /crt help lists them.", 1, true) ~= nil, "/crt " .. word .. ": the one unknown line: " .. u)
end
section("/crt help is short, /crt help all has the rest, an unknown word says so")

say(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error("failures") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of FILES) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, FILES.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
