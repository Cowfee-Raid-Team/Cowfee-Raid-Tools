// What's new (CRT_Core/WhatsNew/): the short window shown once after an update. The version compare (numbers,
// betas before their release); a fresh install records the version and shows nothing; an upgrade shows once,
// about 5 s after entering the world; skipped versions combine newest first, capped at 5 lines with the rest
// counted; a version with no entry shows nothing; it waits through combat, an encounter, a loading screen and a
// cinematic, then shows; seen is set when it closes (Got it, X or Escape), not before; Show after updates off
// never shows it, while /crt whatsnew still does; the shipped entries are short; the window's layout fits.
// Usage: node run_whatsnew.js <addon folder>
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local dataSrc, wnSrc, slashSrc, coreSrc, tocSrc, profilesSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
strtrim = function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
tinsert = table.insert
UISpecialFrames = {}
local CLOCK = 100
GetTime = function() return CLOCK end
local timers = {}
C_Timer = { After = function(s, fn) timers[#timers + 1] = { at = CLOCK + s, fn = fn } end }
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
local combat, encounter, cinematic, scene = false, false, false, false
InCombatLockdown = function() return combat end
C_InstanceEncounter = { IsEncounterInProgress = function() return encounter end }
InCinematic = function() return cinematic end
IsInCinematicScene = function() return scene end

-- stand-in frames: font strings measure 6 px a character and 14 px a line, wrapping at their width
local function mock()
  local o = { shown = false, enabled = true, scripts = {}, events = {}, points = {} }
  return setmetatable(o, { __index = function(t, k)
    local m = ({
      SetText = function(self, v) self.text = v end,
      GetText = function(self) return self.text end,
      Show = function(self) local was = self.shown self.shown = true if not was and self.scripts.OnShow then self.scripts.OnShow(self) end end,
      Hide = function(self) local was = self.shown self.shown = false if was and self.scripts.OnHide then self.scripts.OnHide(self) end end,
      IsShown = function(self) return self.shown end,
      SetShown = function(self, v) if v then self:Show() else self:Hide() end end,
      SetScript = function(self, name, fn) self.scripts[name] = fn end,
      HookScript = function(self, name, fn) local old = self.scripts[name] self.scripts[name] = function(...) if old then old(...) end fn(...) end end,
      RegisterEvent = function(self, e) self.events[e] = true end,
      UnregisterEvent = function(self, e) self.events[e] = nil end,
      UnregisterAllEvents = function(self) self.events = {} end,
      SetHitRectInsets = function(self, l, r, t, b) self.hit = { l, r, t, b } end,
      SetSize = function(self, w, h) self.w, self.h = w, h end,
      SetWidth = function(self, w) self.w = w end,
      SetHeight = function(self, h) self.h = h end,
      GetWidth = function(self) return self.w or 0 end,
      GetHeight = function(self) return self.h or 0 end,
      SetPoint = function(self, ...) self.points[#self.points + 1] = { ... } self.point = { ... } end,
      ClearAllPoints = function(self) self.points = {} self.point = nil end,
      SetTextColor = function(self, r, g, b) self.color = { r, g, b } end,
      SetChecked = function(self, v) self.checked = v and true or false end,
      GetChecked = function(self) return self.checked end,
      CreateTexture = function(self) local x = mock() x.parent = self x.shown = true return x end,
      CreateFontString = function(self, _, _, font) local x = mock() x.parent = self x.shown = true x.font = font return x end,
      GetStringWidth = function(self) return #(self.text or "") * 6 end,
      GetStringHeight = function(self)
        local w = #(self.text or "") * 6
        if self.w and self.w > 0 then return 14 * math.max(1, math.ceil(w / self.w)) end
        return 14
      end,
      GetFrameLevel = function() return 1 end,
    })[k]
    if m then return m end
    if type(k) == "string" and k:match("^%u") then return function() end end
    return nil
  end })
end
local made
CreateFrame = function(kind, name, parent) local f = mock() f.kind, f.name, f.parent = kind, name, parent if made then made[#made + 1] = f end return f end
UIParent = mock()

-- one CRT: its own CRT table, saved data and UI stand-ins. opts.version is the .toc version, opts.db the saved
-- whatsNew table (nil: the defaults), opts.fresh a first install, opts.data the entries (nil: the shipped ones)
local function boot(opts)
  made = {}
  timers = {}
  local windows, buttons = {}, {}
  local UI = {
    PAGE_W = 1026, PAGE_H = 560,
    WINDOW_DEFAULTS = { titleHeight = 26, inset = 8 },
    Window = function(wname, o) local w = mock() w.name, w.opts = wname, o w.w, w.h = o.width, o.height
      w.content = mock() w.content.parent = w w.strip = mock() w.strip.SetTitle = function(self, t) self.title = t end
      w.CloseButton = mock() windows[wname] = w if wname then tinsert(UISpecialFrames, wname) end return w end,
    PanelButton = function(parent, label, h, onClick)
      local b = mock() b.parent, b.label, b.text, b.h, b.shown = parent, label, label, h, true
      b.scripts.OnClick = onClick
      b.w = math.max(40, #label * 6 + 28)
      buttons[#buttons + 1] = b return b
    end,
    SkinCheckButton = function(_, cb) cb.skinned = true end,
    Help = function() local h = mock() h.shown = true return h end,
    IsModern = function() return true end,
  }
  local CRT, db
  if opts.core then
    -- the real CRT_Core/Core.lua and Profiles.lua: ADDON_LOADED with CRTDB as saved (nil: a first install)
    CRT = { UI = UI }
    assert(load(coreSrc, "Core.lua"))("CowfeeRaidTools", CRT)
    CRT_THEME(CRT, UI)
    assert(load(profilesSrc, "Profiles.lua"))("CowfeeRaidTools", CRT)
    CRTDB, CRTDBChar = opts.saved, {}
    for _, f in ipairs(made) do if f.events.ADDON_LOADED then f.scripts.OnEvent(f, "ADDON_LOADED", "CowfeeRaidTools") end end
    db = CRTDB
  else
    db = { whatsNew = opts.db or { show = true, window = {} } }
    CRT = { UI = UI, db = db, version = opts.version or "1.1.2", freshInstall = opts.fresh or false }
    CRT_THEME(CRT, UI)
  end
  local printed = {}
  function CRT:Print(m) printed[#printed + 1] = m end
  assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
  if opts.data then CRT.WhatsNewData = opts.data end
  assert(load(wnSrc, "WhatsNew.lua"))("CowfeeRaidTools", CRT)
  local p = { CRT = CRT, WN = CRT.WhatsNew, UI = UI, db = db.whatsNew, windows = windows, buttons = buttons, printed = printed }
  for _, f in ipairs(made) do if f.events.PLAYER_ENTERING_WORLD and f.events.LOADING_SCREEN_DISABLED then p.events = f end end
  made = nil
  p.fire = function(e, ...) if p.events and p.events.events[e] then p.events.scripts.OnEvent(p.events, e, ...) end end
  p.win = function() return windows.CRTWhatsNew end
  p.shown = function() local w = windows.CRTWhatsNew return w ~= nil and w.shown end
  p.button = function(label) for _, b in ipairs(buttons) do if b.label == label then return b end end end
  return p
end
local function login(p) p.fire("PLAYER_ENTERING_WORLD", true, false) end
-- Core.lua's needs: fonts, the .toc version, the character for Profiles.lua
local function fontObject() local o = { path = "f", size = 12, flags = "" }
  function o:CopyFontObject() end function o:GetFont() return self.path, self.size, self.flags end
  function o:SetFont(p, s, fl) self.path, self.size, self.flags = p, s, fl end
  function o:GetTextColor() return 1, 1, 1 end function o:SetTextColor() end return o end
function CreateFont(name) local o = fontObject() _G[name] = o return o end
GameFontNormal, GameFontHighlight, GameFontDisable, GameFontHighlightSmall, GameFontDisableSmall, GameFontNormalLarge, GameFontNormalSmall, ChatFontNormal = fontObject(), fontObject(), fontObject(), fontObject(), fontObject(), fontObject(), fontObject(), fontObject()
C_AddOns = { GetAddOnMetadata = function(_, field) if field == "Version" then return "1.1.2" end end }
UnitName = function() return "Solex" end
GetRealmName = function() return "Silvermoon" end
ReloadUI = function() end

-- 1. Version compare -------------------------------------------------------------------------------------------
local p = boot({})
local WN = p.WN
check(WN ~= nil, "CRT.WhatsNew exists")
local C = WN.Compare
eq(C("1.1.2", "1.1.2"), 0, "equal")
eq(C("1.1.3", "1.1.2"), 1, "1.1.3 > 1.1.2")
eq(C("1.1.10", "1.1.9"), 1, "numeric, not text: 1.1.10 > 1.1.9")
eq(C("1.2", "1.1.9"), 1, "1.2 > 1.1.9")
eq(C("1.1", "1.1.0"), 0, "1.1 = 1.1.0")
eq(C("1.1.3-beta1", "1.1.3"), -1, "a beta is before its release")
eq(C("1.1.3-beta1", "1.1.2"), 1, "a beta is after the last release")
eq(C("1.1.3-beta2", "1.1.3-beta1"), 1, "beta2 > beta1")
eq(C("1.1.3-beta10", "1.1.3-beta9"), 1, "beta10 > beta9")
eq(C("1.1.3-alpha1", "1.1.3-beta1"), -1, "alpha before beta")
eq(C("v1.1.3", "1.1.3"), 0, "a leading v is read")
eq(C("dev", "1.1.2"), nil, "a version that isn't one: nil")
eq(C(nil, "1.1.2"), nil, "nil: nil")

-- 2. Collect: what to show for installed and seen -----------------------------------------------------------
local DATA = {
  { version = "1.1.5", lines = { "five a", "five b" }, more = 2 },
  { version = "1.1.4", lines = { "four a", "four b", "four c" }, more = 1 },
  { version = "1.1.3", lines = { "three a", "three b" }, more = 4 },
}
local set = WN.Collect("1.1.5", "1.1.4", DATA)
check(set and set.version == "1.1.5" and #set.lines == 2 and set.more == 2, "one version newer: its entry")
set = WN.Collect("1.1.5", "1.1.2", DATA)
eq(set and set.version, "1.1.5", "several skipped: titled with the newest")
eq(set and table.concat(set.lines, "|"), "five a|five b|four a|four b|four c", "lines newest first, at most 5")
eq(set and set.more, 2 + 1 + 4 + 2, "the rest counted with the smaller fixes")
set = WN.Collect("1.1.4", "1.1.2", DATA)
eq(set and set.version, "1.1.4", "an entry newer than installed is left out")
eq(set and set.more, 1 + 4, "and its fixes too")
check(WN.Collect("1.1.6", "1.1.5", DATA) == nil, "a version with no entry: nothing")
check(WN.Collect("1.1.5", "1.1.5", DATA) == nil, "nothing newer than seen: nothing")
set = WN.Collect("1.1.4", nil, DATA)
check(set and set.version == "1.1.4" and #set.lines == 3 and set.more == 1, "no seen yet: only the installed version's entry")
check(WN.Collect("1.1.6", nil, DATA) == nil, "no seen yet, no entry for this version: nothing")
set = WN.Collect("1.1.5", "1.1.5-beta2", DATA)
check(set and set.version == "1.1.5", "seen a beta of this version: the release still shows")
set = WN.Collect("1.1.5", "1.1.4", { { version = "1.1.5", lines = { "a", "b", "c", "d", "e", "f", "g" }, more = 0 } })
check(set and #set.lines == 5 and set.more == 2, "one entry over 5 lines: capped, the rest counted")

-- 3. A fresh install records the version and shows nothing ----------------------------------------------
p = boot({ fresh = true, db = { show = true, window = {} } })
login(p) advance(30)
check(not p.shown(), "fresh install: no window")
eq(p.db.seen, "1.1.2", "fresh install: the version is recorded")

-- 4. An upgrade (no seen yet) shows once, about 5 s after login ------------------------------------------------
p = boot({ db = { show = true, window = {} } })
login(p)
check(not p.shown(), "upgrade: not straight away")
advance(4)
check(not p.shown(), "upgrade: not at 4 s")
advance(2)
check(p.shown(), "upgrade: shown about 5 s after entering the world")
local w = p.win()
eq(w.strip.title, "What's new in 1.1.2", "titled with the version")
check(w.opts.layer == nil or w.opts.layer == "popups", "on the popups layer")
check(w.opts.kind == "dialog", "a UI.Window dialog")
eq(p.db.seen, nil, "seen is not set while it is open")
-- a /reload before closing shows it again
p = boot({ db = { show = true, window = {} } })
login(p) advance(6)
check(p.shown(), "after a /reload before closing: shown again")
p.button("Got it").scripts.OnClick(p.button("Got it"))
check(not p.shown(), "Got it closes it")
eq(p.db.seen, "1.1.2", "seen is set on close")
p = boot({ db = p.db })
login(p) advance(30)
check(not p.shown(), "the next login: not again")
-- only the first entering the world of a session
p = boot({ db = { show = true, window = {} } })
login(p) advance(6) p.win():Hide()
eq(p.db.seen, "1.1.2", "closed with the X or Escape: seen too")
p.db.seen = nil
p.fire("PLAYER_ENTERING_WORLD", false, false) advance(30)
check(not p.shown(), "a later loading screen in the same session doesn't show it again")
check(UISpecialFrames[#UISpecialFrames] == "CRTWhatsNew", "Escape closes it (named in UISpecialFrames)")

-- 5. Skipped versions through the real flow ----------------------------------------------------------------
p = boot({ version = "1.1.5", db = { show = true, seen = "1.1.2", window = {} }, data = DATA })
login(p) advance(6)
check(p.shown(), "skipped versions: shown")
w = p.win()
eq(w.strip.title, "What's new in 1.1.5", "titled with the newest")
local texts = {}
for _, fs in ipairs(p.WN.view.lines) do if fs.shown then texts[#texts + 1] = fs.text end end
eq(#texts, 5, "5 lines shown")
eq(texts[1], "five a", "the newest version's first line first")
check(p.WN.view.more.shown and p.WN.view.more.text == "and 9 smaller fixes", "and N smaller fixes (" .. tostring(p.WN.view.more.text) .. ")")
local mc = p.WN.view.more.color
local muted = p.CRT.PALETTE.muted
check(mc and math.abs(mc[1] - muted[1]) < 0.01 and math.abs(mc[2] - muted[2]) < 0.01, "the fixes line is in the muted colour")
p.button("Got it").scripts.OnClick(p.button("Got it"))
eq(p.db.seen, "1.1.5", "seen is the installed version")
-- one fix: singular
p = boot({ version = "1.1.4", db = { show = true, seen = "1.1.3", window = {} }, data = DATA })
login(p) advance(6)
eq(p.WN.view.more.text, "and 1 smaller fix", "one fix: singular")
-- no fixes: no line
p = boot({ version = "1.1.4", db = { show = true, seen = "1.1.3", window = {} }, data = { { version = "1.1.4", lines = { "x" }, more = 0 } } })
login(p) advance(6)
check(not p.WN.view.more.shown, "no smaller fixes: no line")

-- 6. A version with no entry shows nothing ------------------------------------------------------------------
p = boot({ version = "1.1.6", db = { show = true, seen = "1.1.5", window = {} }, data = DATA })
login(p) advance(30)
check(not p.shown(), "no entry: nothing")
eq(p.db.seen, "1.1.6", "and the version is recorded")
p = boot({ version = "dev", db = { show = true, window = {} } })
login(p) advance(30)
check(not p.shown() and p.db.seen == nil, "a version that isn't one (dev): nothing, nothing saved")

-- 7. Waits in combat, an encounter, a loading screen or a cinematic; never drops -------------------------
p = boot({ db = { show = true, window = {} } })
combat = true
login(p) advance(60)
check(not p.shown(), "in combat: waits")
combat = false
p.fire("PLAYER_REGEN_ENABLED") advance(3)
check(p.shown(), "after combat: shown")
p = boot({ db = { show = true, window = {} } })
encounter = true
login(p) advance(6)
p.fire("ENCOUNTER_START", 1, "Boss", 16, 20)
encounter = false -- the API can say no while the event said yes: either keeps it waiting
advance(60)
check(not p.shown(), "in an encounter: waits")
p.fire("ENCOUNTER_END", 1, "Boss", 16, 20, 1) advance(3)
check(p.shown(), "after the encounter: shown")
p = boot({ db = { show = true, window = {} } })
login(p)
p.fire("LOADING_SCREEN_ENABLED") advance(60)
check(not p.shown(), "during a loading screen: waits")
p.fire("LOADING_SCREEN_DISABLED") advance(3)
check(p.shown(), "after the loading screen: shown")
p = boot({ db = { show = true, window = {} } })
cinematic = true
login(p) advance(60)
check(not p.shown(), "in a cinematic: waits")
cinematic = false
p.fire("CINEMATIC_STOP") advance(3)
check(p.shown(), "after the cinematic: shown")
p = boot({ db = { show = true, window = {} } })
scene = true
login(p) advance(60)
check(not p.shown(), "in a cutscene: waits")
scene = false
advance(15)
check(p.shown(), "a missed event: the slow re-check still shows it")
-- combat starting after the window is up doesn't close it
combat = true advance(10)
check(p.shown(), "combat after it is up: it stays")
combat = false

-- 8. Show after updates ---------------------------------------------------------------------------------------
p = boot({ db = { show = true, window = {} } })
login(p) advance(6)
local cb = p.WN.view.check
check(cb and cb.checked == true, "Show after updates is ticked")
check(cb.skinned, "the checkbox follows the look (UI:SkinCheckButton)")
eq(p.WN.view.checkText.text, "Show after updates", "its label")
cb.checked = false cb.scripts.OnClick(cb)
eq(p.db.show, false, "unticking saves show = false")
p = boot({ version = "1.1.5", db = { show = false, seen = "1.1.2", window = {} }, data = DATA })
login(p) advance(30)
check(not p.shown(), "Show after updates off: never shown after an update")
eq(p.db.seen, "1.1.5", "and the version is recorded, so turning it back on doesn't bring old news")
SlashCmdList = {}
assert(load(slashSrc, "Slash.lua"))("CowfeeRaidTools", p.CRT)
SlashCmdList.COWFEERAIDTOOLS("whatsnew")
check(p.shown(), "/crt whatsnew opens it even with Show after updates off")
eq(p.win().strip.title, "What's new in 1.1.5", "with the installed version's entry")
p.win():Hide()
p = boot({ version = "1.1.9", db = { show = true, seen = "1.1.9", window = {} }, data = DATA })
assert(load(slashSrc, "Slash.lua"))("CowfeeRaidTools", p.CRT)
SlashCmdList.COWFEERAIDTOOLS("whatsnew")
eq(p.shown() and p.win().strip.title, "What's new in 1.1.5", "no entry for this version: the newest entry")
p = boot({ db = { show = true, seen = "1.1.2", window = {} }, data = {} })
assert(load(slashSrc, "Slash.lua"))("CowfeeRaidTools", p.CRT)
SlashCmdList.COWFEERAIDTOOLS("whatsnew")
check(not p.shown() and #p.printed == 1, "no entries at all: a line in chat instead")
check(slashSrc:find("/crt whatsnew", 1, true) ~= nil, "/crt whatsnew is in the /crt help list")

-- 8b. Review fixes -------------------------------------------------------------------------------------------------
-- a release event before any try (the loading screen ending right after login) keeps the 5 s delay
p = boot({ db = { show = true, window = {} } })
login(p) advance(0.5)
p.fire("LOADING_SCREEN_DISABLED") p.fire("PLAYER_REGEN_ENABLED")
advance(3.5)
check(not p.shown(), "a release event right after login: not at 4 s")
advance(2)
check(p.shown(), "a release event right after login: shown at 6 s")
check(next(p.events.events) == nil, "once open, no events are listened to")
-- the whole interface hiding (Alt+Z) runs OnHide while the window is still shown: not a close
w = p.win()
w.scripts.OnHide(w)
eq(p.db.seen, nil, "the interface hiding doesn't mark it seen")
w:Hide()
eq(p.db.seen, "1.1.2", "a real close does")
-- nothing to show: no events stay
p = boot({ db = { show = true, seen = "1.1.2", window = {} } })
login(p)
check(next(p.events.events) == nil, "nothing to show: no events are listened to")
-- /crt whatsnew during the login wait, closed: it doesn't open again
p = boot({ db = { show = true, window = {} } })
SlashCmdList = {}
assert(load(slashSrc, "Slash.lua"))("CowfeeRaidTools", p.CRT)
login(p) advance(1)
SlashCmdList.COWFEERAIDTOOLS("whatsnew")
p.win():Hide()
advance(30)
check(not p.shown(), "/crt whatsnew closed during the wait: not opened again")
eq(p.db.seen, "1.1.2", "and seen")
-- the label clicks the box: its hit area reaches over the label
local v8 = p.WN.view
local hit = v8.check.hit
check(hit and hit[1] == 0 and hit[2] == -(p.WN.LAYOUT.checkGap + v8.checkText:GetStringWidth()) and hit[3] == 0 and hit[4] == 0,
  "the box's hit area covers its label (" .. tostring(hit and hit[2]) .. ")")

-- 9. The shipped entries: newest first, at most 5 short lines, a count of fixes, no other addon names ---------
p = boot({})
local shipped = p.CRT.WhatsNewData
check(type(shipped) == "table" and #shipped >= 1, "the data has entries")
local tocVersion = tocSrc:match("## Version:%s*([^\\r\\n]+)")
check(shipped[1] and WN.Compare(shipped[1].version, tocVersion) ~= nil and WN.Compare(shipped[1].version, tocVersion) <= 0, "the newest entry is not newer than the .toc version")
eq(shipped[#shipped] and shipped[#shipped].version, "1.1.2", "seeded with 1.1.2")
local BANNED = { "northern sky", "nsrt", "mrt", "method raid", "rclootcouncil", "rclc", "bigwigs", "dbm", "deadly boss", "weakauras", "liquid" }
for i, e in ipairs(shipped) do
  if i > 1 then check(WN.Compare(e.version, shipped[i - 1].version) == -1, e.version .. " comes after a newer one") end
  check(type(e.lines) == "table" and #e.lines >= 1 and #e.lines <= 5, e.version .. ": 1 to 5 lines")
  check(type(e.more) == "number" and e.more >= 0 and e.more == math.floor(e.more), e.version .. ": more is a whole count")
  for _, line in ipairs(e.lines) do
    check(type(line) == "string" and #line <= 60, e.version .. ": under 60 characters: " .. tostring(line))
    check(not line:find("\\n"), e.version .. ": one line: " .. tostring(line))
    for _, b in ipairs(BANNED) do check(not line:lower():find(b, 1, true), e.version .. ": names no other addon (" .. b .. ")") end
  end
end

-- 10. The window's layout fits ---------------------------------------------------------------------------------
p = boot({ version = "1.1.5", db = { show = true, seen = "1.1.2", window = {} }, data = {
  { version = "1.1.5", lines = { string.rep("w", 60), "b", "c", "d", "e" }, more = 3 } } })
login(p) advance(6)
w = p.win()
local v = p.WN.view
eq(w.w, 360, "about 360 wide")
local D = p.UI.WINDOW_DEFAULTS
local cw = 360 - 2 * D.inset
local y = 0 -- each row's top, down from the content's top
local bottom = 0
for i, fs in ipairs(v.lines) do
  if fs.shown then
    local top = -fs.point[5]
    check(top >= bottom, "line " .. i .. " starts under the one above")
    check(fs.point[4] + fs.w <= cw, "line " .. i .. " fits the width")
    bottom = top + fs:GetStringHeight()
  end
end
local moreTop = -v.more.point[5]
check(moreTop >= bottom, "the fixes line is under the lines")
bottom = moreTop + v.more:GetStringHeight()
local contentH = w.h - (D.titleHeight + 4) - D.inset
local got = p.button("Got it")
check(bottom + 4 <= contentH - got.h, "the lines end above the footer (" .. bottom .. " of " .. (contentH - got.h) .. ")")
check(contentH - got.h - bottom <= 30, "and the window is not much taller than its lines")
check(v.check.w + 4 + v.checkText:GetStringWidth() + 8 + got.w <= cw, "Show after updates and Got it fit side by side")
local wrapped = v.lines[1]:GetStringHeight()
check(wrapped > 14, "a long line wraps rather than run out of the window")
-- fewer lines: a shorter window
local tall = w.h
p.win():Hide()
p.CRT.WhatsNewData = { { version = "1.1.5", lines = { "a" }, more = 0 } }
p.WN:ShowNow()
check(p.win().h < tall, "fewer lines, a shorter window (" .. p.win().h .. " < " .. tall .. ")")
check(not v.lines[2].shown, "rows from a longer list are hidden")

-- 11. Saved data: a default in Core.lua, account-wide, never in Export settings only ---------------------------
-- through the real Core.lua: a first install (no CRTDB) records the version and shows nothing
p = boot({ core = true, saved = nil })
eq(p.CRT.version, "1.1.2", "Core.lua: the version from the .toc")
check(p.CRT.freshInstall == true, "Core.lua: no CRTDB is a fresh install")
check(p.db and p.db.show == true and type(p.db.window) == "table", "Core.lua: whatsNew's defaults, Show after updates on")
eq(p.db.seen, nil, "Core.lua: seen has no default")
login(p) advance(30)
check(not p.shown(), "Core.lua, first install: no window")
eq(p.db.seen, "1.1.2", "Core.lua, first install: the version recorded")
-- an existing save from before What's new: shown once
p = boot({ core = true, saved = { ui = { theme = "blizzard" }, debuffs = { size = 50 } } })
check(p.CRT.freshInstall == false, "Core.lua: an existing CRTDB is not a fresh install")
login(p) advance(6)
check(p.shown(), "Core.lua, an upgrade into the feature: shown")
eq(CRTDB.debuffs.size, 50, "and the old save is kept")
p.button("Got it").scripts.OnClick(p.button("Got it"))
eq(p.db.seen, "1.1.2", "Core.lua, an upgrade: seen on close")
-- a profile switch keeps it: whatsNew stays at the top of CRTDB
p.CRT.Profiles:Load()
eq(CRTDB.whatsNew and CRTDB.whatsNew.seen, "1.1.2", "Profiles: whatsNew is account-wide")
check(profilesSrc:find("whatsNew = false", 1, true) ~= nil, "Profiles.SHARE keeps whatsNew out of Export settings only")
check(profilesSrc:match("local SHARED = (%b{})"):find("whatsNew", 1, true) ~= nil, "whatsNew is account-wide, not per profile")
check(tocSrc:find("CRT_Core\\\\WhatsNew\\\\Data.lua", 1, true) and tocSrc:find("CRT_Core\\\\WhatsNew\\\\WhatsNew.lua", 1, true), "both files are in the .toc")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Core/WhatsNew/Data.lua', 'CRT_Core/WhatsNew/WhatsNew.lua', 'CRT_Core/Slash.lua', 'CRT_Core/Core.lua',
  'CowfeeRaidTools.toc', 'CRT_Core/Profiles.lua'];
for (const f of files) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
