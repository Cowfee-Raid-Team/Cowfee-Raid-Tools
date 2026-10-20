// CRT_Modules/Timeline/RehearsalWindow.lua on mock frames (stubs in the style of run_timeline_page.js), with the
// real CRT_Modules/Timeline/Rehearsal.lua and a stub Lanes.Build that records its call.
// Usage: node run_timeline_rehearsalwin.js CRT_Modules/Timeline/Rehearsal.lua CRT_Modules/Timeline/RehearsalWindow.lua
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = String.raw`
local rehSrc, winSrc = ...
local now = 1000
function GetTime() return now end
local cursorX = 0
function GetCursorPosition() return cursorX, 0 end
local function mock(kind)
  local m = { shown = false, kind = kind }
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" then return function() return mock("fs") end end
    if k == "CreateTexture" then return function() return mock("tex") end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return rawget(self, "text") or "" end end
    if k == "Show" then return function(self) rawset(self, "shown", true) end end
    if k == "Hide" then return function(self) local was = rawget(self, "shown") rawset(self, "shown", false) if was and rawget(self, "OnHide") then self.OnHide(self) end end end
    if k == "SetShown" then return function(self, on) if on then self:Show() else self:Hide() end end end
    if k == "IsShown" then return function(self) return rawget(self, "shown") end end
    if k == "SetScript" then return function(self, name, fn) rawset(self, name, fn) end end
    if k == "SetPoint" then return function(self, ...) rawset(self, "pt", { ... }) end end
    if k == "SetWidth" then return function(self, w) rawset(self, "w", w) end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "SetTexture" then return function(self, tex) rawset(self, "tex", tex) end end
    if k == "SetColorTexture" then return function(self, r, g, b, a) rawset(self, "color", { r, g, b, a }) end end
    if k == "SetTextColor" then return function(self, r, g, b) rawset(self, "tcolor", { r, g, b }) end end
    if k == "GetLeft" then return function() return 100 end end
    if k == "GetTop" then return function() return 700 end end
    if k == "GetHeight" then return function() return 768 end end
    if k == "GetEffectiveScale" then return function() return 1 end end
    if k == "StartMoving" then return function(self, v) rawset(self, "movedWith", v) end end
    if k == "SetClipsChildren" then return function(self, v) rawset(self, "clips", v) end end
    if k == "RegisterEvent" then return function(self, e) local r = rawget(self, "events") or {} r[e] = true rawset(self, "events", r) end end
    return function() end end })
end
local frames = {}
function CreateFrame(kind, name) local m = mock(kind) frames[#frames + 1] = m return m end
UIParent = mock()
UISpecialFrames = {}
function tinsert(t, v) table.insert(t, v) end
CRTFontButtonSmall, CRTFontButtonSmallHighlight, CRTFontButtonSmallDisable = {}, {}, {}
helpFrames = {}
local dropdowns, helps, titles, styled, layers = {}, {}, {}, 0, {}
local lanesCall
local CRT = {
  db = { timeline = { span = 300 } },
  MOCHA = { espresso = { 0.1, 0.1, 0.1 }, roast = { 0.2, 0.2, 0.2 }, edge = { 0.3, 0.3, 0.3 }, caramel = { 0.78, 0.56, 0.36 }, latte = { 0.87, 0.73, 0.56 }, cream = { 0.95, 0.9, 0.84 } },
  UI = { Help = function(_, title, text) helps[title] = text local m = mock() helpFrames[title] = m return m end,
    Dropdown = function(_, text, o) local m = mock() m.opts, m.label = o, text dropdowns[text] = m rawset(m, "refresh", function() end) return m end,
    StyleWindow = function() styled = styled + 1 end, RegisterLayer = function(_, k) layers[#layers + 1] = k end,
    SetFrameTitle = function(f, text) titles[#titles + 1] = text end, SkinTree = function() end },
}
CRT.Timeline = { Settings = function() return CRT.db.timeline end, WithoutIgnored = function(_, lanes) return lanes, {} end }
CRT.TimelineReference = { TYPES = { soak = { label = "Soak", color = { 1, 0.5, 0.82 } } } }
CRT.TimelineJournal = { Rows = function(_, eid) return { "rows of " .. tostring(eid) } end }
local lanes = {
  { kind = "deaths", label = "Deaths", marks = { { t = 5 } } },
  { kind = "reference", label = "Slam", icon = "iconSlam", color = { 1, 0, 0 }, marks = { { t = 10 }, { t = 30 } } },
  { kind = "reference", label = "Pool", icon = "iconPool", types = { "soak" }, marks = { { t = 20 } } },
  { kind = "reference", label = "Plain", icon = "iconPlain", marks = { { t = 60 } } },
}
local extra = { length = 100, phases = { { t = 0, label = "P1" }, { t = 50, label = "P2" } } }
CRT.TimelineLanes = { Build = function(...) lanesCall = { n = select("#", ...), ... } return lanes, {}, extra end }
assert(load(rehSrc, "CRT_Modules/Timeline/Rehearsal.lua"))("CowfeeRaidTools", CRT)
assert(load(winSrc, "CRT_Modules/Timeline/RehearsalWindow.lua"))("CowfeeRaidTools", CRT)
local RW = CRT.TimelineRehearsalWindow
assert(RW, "module exposed as CRT.TimelineRehearsalWindow")
local function near(a, b) return math.abs(a - b) < 1e-6 end
local function ok(name) print("ok " .. name) end
local DOT = string.char(194, 183)

local base = { reference = { name = "ref" } }
local calls = {}
RW.onPlay = function() calls[#calls + 1] = "play" end
RW.onPause = function() calls[#calls + 1] = "pause" end
RW.onSeek = function(t) calls[#calls + 1] = "seek " .. string.format("%g", t) end
RW.onClose = function() calls[#calls + 1] = "close" end
RW.onAs = function(as) calls[#calls + 1] = "as " .. tostring(as) end
local function lastCall() return calls[#calls] end

-- opens with the boss name ------------------------------------------------------------------------
now = 1000
RW:Open({ base = base, encounterID = 3470, group = "mythic", order = { "Iku", "Gebbo" }, bossName = "Nek'zali", difficultyName = "Mythic" })
local f = RW.frame
do
  assert(f and f:IsShown(), "the window shows")
  assert(titles[#titles] == "Rehearsal " .. DOT .. " Nek'zali", "title: " .. tostring(titles[#titles]))
  assert(f.bossName.text == "Nek'zali", "boss panel name")
  assert(styled == 1 and layers[1] == "popups", "the window follows the window look and the pop-up layer")
  assert(lanesCall[1] == base and lanesCall[2][1] == "rows of 3470" and lanesCall[3] == CRT.db.timeline and lanesCall[4] == 3470
    and lanesCall[5] == nil and lanesCall[6] == "mythic" and lanesCall[7][1] == "Iku", "lanes built from the source")
  assert(f.clockText.text == "0:00 / 1:40", "clock text: " .. tostring(f.clockText.text))
  assert(f.play.text == "Play", "starts paused")
  f.OnDragStart(f)
  assert(f.movedWith == true, "moved from the title with StartMoving(true)")
end
ok("opens with the boss name")

-- health drains with the clock --------------------------------------------------------------------
do
  assert(f.healthText.text == "100%", "100% at the pull: " .. tostring(f.healthText.text))
  local full = f.healthFill.w
  assert(near(full, RW.BAR_W), "full bar")
  RW:Seek(50)
  assert(f.healthText.text == "50%" and near(f.healthFill.w, full / 2), "50% halfway: " .. f.healthText.text)
  RW:Seek(75)
  assert(f.healthText.text == "25%", "25%")
  RW:Seek(100)
  assert(f.healthText.text == "0%" and not f.healthFill.shown, "0% at the length")
end
ok("health drains with the clock")

-- cast bar text and fill --------------------------------------------------------------------------
do
  RW:Seek(7.5) -- Slam ends at 10, shows from 5: half way
  assert(f.castName.text == "Slam" and f.castIcon.tex == "iconSlam" and f.castIcon.shown, "cast name and icon")
  assert(near(f.castFill.w, RW.CAST_W * 0.5) and f.castFill.shown, "half filled: " .. tostring(f.castFill.w))
  assert(f.castFill.color[1] == 1 and f.castFill.color[2] == 0, "lane color")
  RW:Seek(18.75)
  assert(f.castName.text == "Pool" and near(f.castFill.w, RW.CAST_W * 0.75), "3/4 filled")
  assert(near(f.castFill.color[1], 1) and near(f.castFill.color[2], 0.5) and near(f.castFill.color[3], 0.82), "no lane color: the type color")
  RW:Seek(59)
  assert(f.castName.text == "Plain" and near(f.castFill.color[1], 0.78), "no type: caramel")
  RW:Seek(12)
  assert(f.castName.text == "" and not f.castFill.shown and not f.castIcon.shown, "nothing casting: empty")
end
ok("cast bar text and fill")

-- next up lines -----------------------------------------------------------------------------------
do
  RW:Seek(0)
  assert(f.next[1].name.text == "Slam" and f.next[1].time.text == "0:10" and f.next[1].icon.tex == "iconSlam", "first")
  assert(f.next[2].name.text == "Pool" and f.next[2].time.text == "0:20", "second")
  assert(f.next[3].name.text == "Slam" and f.next[3].time.text == "0:30", "third")
  RW:Seek(31)
  assert(f.next[1].name.text == "Plain" and f.next[1].time.text == "0:29", "later first, counting down: " .. tostring(f.next[1].time.text))
  assert(f.next[2].name.text == "" and not f.next[2].icon.shown and f.next[3].name.text == "", "empty lines")
  assert(not f.next[2].bar.shown, "no bar on an empty line")
end
ok("next up lines")

-- next up counts down ------------------------------------------------------------------------------
do
  local count, barW = RW.NEXT_COUNT, RW.NEXT_BAR_W
  assert(count == 10 and barW and barW > 0, "the countdown window")
  RW:Seek(4) -- Slam at 10 is 6 s away, Pool at 20 is 16 s away
  assert(f.next[1].time.text == "6.0", "tenths inside the window: " .. tostring(f.next[1].time.text))
  assert(f.next[1].bar.shown and near(f.next[1].bar.w, barW * 0.8), "the bar fills as the cast nears, full at the cast bar: " .. tostring(f.next[1].bar.w))
  assert(f.next[1].bar.color[1] == 1, "the bar in the cast's color")
  assert(f.next[2].time.text == "0:16" and not f.next[2].bar.shown, "no bar outside the window")
  RW:Seek(4.5)
  assert(f.next[1].time.text == "5.5" and near(f.next[1].bar.w, barW * 0.9), "nearly there")
  RW:Seek(9.5) -- Slam is in the cast bar now, so Next up starts at Pool
  assert(f.castName.text == "Slam" and f.next[1].name.text == "Pool" and f.next[1].time.text == "0:10", "the cast bar's cast leaves Next up: " .. tostring(f.next[1].name.text))
  RW:Seek(0)
end
ok("next up counts down")

-- strip marks move with the clock -----------------------------------------------------------------
local function markAt(t)
  local s = f.strip
  for i = 1, s.shownMarks do if s.marks[i].t == t and s.marks[i].shown then return s.marks[i] end end
end
do
  local W, span = RW.STRIP_W, 40
  RW:Seek(0) -- strip from -13.3 to 26.7
  local m10, m20 = markAt(10), markAt(20)
  assert(m10 and m20 and not markAt(30) and not markAt(60), "the marks within 40 seconds")
  local x10 = m10.pt[4]
  assert(near(x10 + 1.5, (10 + span / 3) / span * W), "mark at its time: " .. x10)
  assert(m10.color[1] == 1 and near(m20.color[2], 0.5), "marks in their colors")
  assert(f.strip.shownPhases == 1 and f.strip.phaseLabels[1].text == "P1", "the phase line and label")
  RW:Seek(5)
  local m10b = markAt(10)
  assert(near(m10b.pt[4], x10 - 5 / span * W), "the mark moved left with the clock")
  assert(markAt(30), "a later mark comes in")
  RW:Seek(45)
  assert(f.strip.shownPhases == 1 and f.strip.phaseLabels[1].text == "P2" and f.strip.phaseLabels[1].shown, "the next phase")
  assert(not f.strip.phaseLines[2] or not f.strip.phaseLines[2].shown, "old phase hidden")
  assert(near(f.strip.nowLine.pt[4] + 1, math.floor(W / 3)), "the now line a third of the way across")
end
ok("strip marks move with the clock")

-- strip click seeks -------------------------------------------------------------------------------
do
  RW:Seek(20)
  local W = RW.STRIP_W
  cursorX = 100 + W / 3 + W / 4 -- strip left is 100; a quarter of the strip (10 s) right of now
  f.strip.OnMouseUp(f.strip, "LeftButton")
  assert(near(RW:Now(), 30), "jumped to the time under the mouse: " .. RW:Now())
  assert(lastCall() == "seek 30", "onSeek with the time: " .. tostring(lastCall()))
  cursorX = 100
  f.strip.OnMouseUp(f.strip, "RightButton")
  assert(near(RW:Now(), 30), "a right click does nothing")
end
ok("strip click seeks")

-- 30-second lines and the time over the now line ------------------------------------------------------
do
  local W, span = RW.STRIP_W, 40
  RW:Seek(20) -- strip from 6.7 to 46.7: one line, at 0:30
  local s = f.strip
  assert(s.shownTicks == 1 and s.ticks[1].t == 30 and s.tickLabels[1].text == "0:30", "a line every 30 seconds, labelled: " .. tostring(s.shownTicks))
  assert(near(s.ticks[1].pt[4], (30 - (20 - span / 3)) / span * W), "the line at its time")
  assert(s.nowText.text == "0:20", "the time over the now line: " .. tostring(s.nowText.text))
  RW:Seek(0) -- 0:00 and 0:30 within -13.3 to 26.7? only 0:00
  assert(s.shownTicks == 1 and s.tickLabels[1].text == "0:00" and (not s.ticks[2] or not s.ticks[2].shown), "no line before the pull")
  RW:Seek(55) -- 41.7 to 81.7: 1:00
  assert(s.shownTicks == 1 and s.tickLabels[1].text == "1:00", "1:00")
end
ok("30-second lines and the now time")

-- dragging scrubs ---------------------------------------------------------------------------------
do
  local W, span = RW.STRIP_W, 40
  for _, button in ipairs({ "LeftButton", "RightButton" }) do
    RW:Seek(20)
    local n = #calls
    cursorX = 300
    f.strip.OnMouseDown(f.strip, button)
    assert(f.strip.OnUpdate, "dragging follows the mouse")
    cursorX = 300 - W / 4 -- a quarter of the strip left: 10 s forward
    f.strip.OnUpdate(f.strip)
    assert(near(RW:Now(), 20), button .. ": the clock waits while dragging")
    assert(f.strip.nowText.text == "0:30" and f.clockText.text:find("^0:30"), button .. ": the window shows the time under the drag: " .. tostring(f.strip.nowText.text))
    assert(#calls == n, button .. ": no seek while dragging")
    f.strip.OnMouseUp(f.strip, button)
    assert(near(RW:Now(), 30) and lastCall() == "seek 30", button .. ": the release jumps there once: " .. RW:Now() .. " " .. tostring(lastCall()))
    assert(not rawget(f.strip, "OnUpdate"), button .. ": the drag ends")
  end
  -- a tiny wobble is still a click, which jumps to the time under the mouse
  RW:Seek(20)
  cursorX = 100 + W / 3 + W / 4
  f.strip.OnMouseDown(f.strip, "LeftButton")
  cursorX = cursorX + 1
  f.strip.OnUpdate(f.strip)
  f.strip.OnMouseUp(f.strip, "LeftButton")
  assert(near(RW:Now(), 30 + 1 / W * span), "a click that barely moved jumps: " .. RW:Now())
  -- a right click without a drag does nothing
  RW:Seek(20)
  cursorX = 150
  f.strip.OnMouseDown(f.strip, "RightButton")
  f.strip.OnMouseUp(f.strip, "RightButton")
  assert(near(RW:Now(), 20), "a right click alone does nothing")
  -- dragging while it plays: paused for the drag, playing again after, and kept inside the fight
  RW:Seek(95)
  RW:Play()
  cursorX = 300
  f.strip.OnMouseDown(f.strip, "LeftButton")
  cursorX = 300 - W
  f.strip.OnUpdate(f.strip)
  f.strip.OnMouseUp(f.strip, "LeftButton")
  assert(near(RW:Now(), 100), "held to the fight's length: " .. RW:Now())
  RW:Pause()
  RW:Seek(10)
  RW:Play()
  cursorX = 300
  f.strip.OnMouseDown(f.strip, "LeftButton")
  cursorX = 300 + W / 4
  f.strip.OnUpdate(f.strip)
  f.strip.OnMouseUp(f.strip, "LeftButton")
  assert(near(RW:Now(), 0) and RW.clock:Playing(), "back to 0:00 and playing again: " .. RW:Now())
  RW:Pause()
  RW:Seek(0)
end
ok("dragging scrubs")

-- play pause restart ------------------------------------------------------------------------------
do
  RW:Seek(10)
  calls = {}
  f.play.OnClick(f.play)
  assert(f.play.text == "Pause" and lastCall() == "play", "play")
  now = now + 3
  f.OnUpdate(f, 0.016)
  assert(near(RW:Now(), 13) and f.clockText.text == "0:13 / 1:40", "the OnUpdate redraws from the clock")
  f.play.OnClick(f.play)
  assert(f.play.text == "Play" and lastCall() == "pause", "pause")
  now = now + 5
  f.OnUpdate(f, 0.016)
  assert(near(RW:Now(), 13), "paused holds")
  f.play.OnClick(f.play)
  calls = {}
  f.restart.OnClick(f.restart)
  assert(near(RW:Now(), 0) and f.play.text == "Play" and calls[1] == "pause" and calls[2] == "seek 0", "restart goes to 0 and pauses")
  now = now + 5
  assert(near(RW:Now(), 0), "restart stays paused")
end
ok("play pause restart")

-- speed dropdown ----------------------------------------------------------------------------------
do
  local dd = dropdowns["Speed"]
  local o = dd.opts.options
  assert(#o == 3 and o[1].label == "1x" and o[2].label == "2x" and o[3].label == "4x", "1x 2x 4x")
  assert(dd.opts.get() == 1, "1x by default")
  RW:Seek(0)
  f.play.OnClick(f.play)
  dd.opts.set(4)
  assert(dd.opts.get() == 4 and RW:Speed() == 4, "4x picked")
  now = now + 2
  assert(near(RW:Now(), 8), "the clock runs at 4x: " .. RW:Now())
  f.play.OnClick(f.play)
end
ok("speed dropdown")

-- position, speed and preview as are saved --------------------------------------------------------
do
  f.OnDragStop(f)
  local s = CRT.db.timeline.rehearsal
  assert(s and s.point == "TOPLEFT" and s.x == 100 and s.y == 700 - 768, "position saved")
  assert(s.speed == 4, "speed saved")
  local as = dropdowns["Preview as"]
  local o = type(as.opts.options) == "function" and as.opts.options() or as.opts.options
  assert(#o == 2 and o[1].label == "Me" and o[2].label == "Everyone", "Me and Everyone")
  assert(as.opts.get() == "me" and s.as == nil, "you by default")
  as.opts.set("*")
  assert(s.as == "*" and as.opts.get() == "*" and lastCall() == "as *", "everyone saved and told")
  as.opts.set("me")
  assert(s.as == nil and lastCall() == "as nil", "back to you")
  as.opts.set("*")
  assert(helps["Preview as"], "Preview as explained in a (?)")
  for k in pairs(s) do assert(k == "point" or k == "x" or k == "y" or k == "speed" or k == "as", "only the planned fields: " .. k) end
  -- reopened: kept
  RW:Close()
  assert(not f:IsShown() and lastCall() == "close", "close hides and tells")
  RW:Open({ base = base, encounterID = 3470, bossName = "Nek'zali" })
  assert(RW:Speed() == 4 and RW:As() == "*" and f.pt[1] == "TOPLEFT" and f.pt[4] == 100 and f.pt[5] == -68, "kept when reopened")
end
ok("position, speed and preview as are saved")

-- over at the length ------------------------------------------------------------------------------
do
  dropdowns["Speed"].opts.set(1)
  RW:Seek(98)
  f.play.OnClick(f.play)
  assert(not f.over.shown, "not over yet")
  now = now + 5
  f.OnUpdate(f, 0.016)
  assert(near(RW:Now(), 100) and f.over.shown and f.over.text == "Rehearsal over", "over at the length")
  assert(f.play.text == "Play" and f.clockText.text == "1:40 / 1:40" and f.castName.text == "", "stopped")
  f.restart.OnClick(f.restart)
  assert(not f.over.shown and near(RW:Now(), 0), "restart plays again")
end
ok("over at the length")

-- The alerts engine (Task 4) ------------------------------------------------------------------------
-- a stub Alerts that records its calls, and the phase numbers as CRT_Modules/Alerts/Reminders.lua reads them
local acalls = {}
local A = { running = false, rehearsal = false, base = 0 }
CRT.Alerts = A
function A:Start(eid, diff, reason, o)
  if self.running then self:Stop(true) acalls[#acalls] = nil end
  acalls[#acalls + 1] = { "start", eid, diff, reason, o, at = o and o.clock and o.clock() }
  self.running, self.rehearsal, self.opts = true, reason == "rehearsal", o
  self.base = now - (reason == "rehearsal" and o and o.clock and o.clock() or 0)
end
function A:Stop(quiet) acalls[#acalls + 1] = { "stop", quiet } self.running, self.rehearsal = false, false end
function A:IsRehearsal() return self.running and self.rehearsal end
function A:TimeAt(s) return self.base + s end
function A:StartPhase(ph, src, at) acalls[#acalls + 1] = { "phase", ph, src, at } return true end
CRT.AlertReminders = { PhaseNumber = function(label)
  if type(label) ~= "string" then return nil end
  local num = label:match("%d+%.%d+") or label:match("%d+")
  return num and tonumber(num) or nil
end }
local roster = { { key = "Aly-Realm", name = "Aly", class = "MAGE" }, { key = "Bob", name = "Bob", class = "PRIEST" } }
CRT.AlertRoster = { Players = function() return roster end }
local Run = CRT.TimelineRehearsalRun
assert(Run and Run.Install, "the engine wiring is exposed as CRT.TimelineRehearsalRun")
RW.onPlay, RW.onPause, RW.onSeek, RW.onClose, RW.onAs = nil, nil, nil, nil, nil
Run.Install()
local function kinds() local out = {} for _, c in ipairs(acalls) do out[#out + 1] = c[1] .. (c[1] == "phase" and (" " .. string.format("%g", c[2])) or "") end return table.concat(out, ",") end
local function events()
  for _, fr in ipairs(frames) do if rawget(fr, "OnEvent") then return fr end end
end
RW:Close()
extra.phases = { { t = 0, label = "P1" }, { t = 20 }, { t = 30, label = "P1.5" }, { t = 50, label = "P2" }, { t = 70, label = "Intermission" }, { t = 80, label = "P3" } }
local src = { base = base, encounterID = 3470, group = "mythic", bossName = "Nek'zali", difficultyName = "Mythic" }
dropdowns["Speed"].opts.set(1)
dropdowns["Preview as"].opts.set("me")

-- play starts a rehearsal run ----------------------------------------------------------------------
do
  now = 5000
  RW:Open(src)
  acalls = {}
  RW:Seek(0)
  assert(#acalls == 0, "a jump before playing starts no run: " .. kinds())
  f.play.OnClick(f.play)
  local c = acalls[1]
  assert(c and c[1] == "start" and c[2] == 3470 and c[3] == "Mythic" and c[4] == "rehearsal", "Start(eid, difficultyName, rehearsal, opts): " .. kinds())
  assert(c[5].clock() == RW:Now() and c[5].speed() == 1 and c[5].as == nil, "opts: the clock, the speed and Preview as")
  assert(#acalls == 1, "phase 1 is the engine's own, so nothing else at 0:00: " .. kinds())
  now = now + 2
  assert(near(c[5].clock(), 2), "the clock runs: " .. c[5].clock())
  dropdowns["Speed"].opts.set(2)
  assert(c[5].speed() == 2, "the speed is read live")
  dropdowns["Speed"].opts.set(1)
  f.play.OnClick(f.play) -- pause
  assert(#acalls == 1 and A:IsRehearsal(), "pause leaves the run going")
  now = now + 3
  assert(near(c[5].clock(), 2), "the clock stands still")
  f.play.OnClick(f.play) -- resume
  assert(#acalls == 1, "resuming starts nothing new: " .. kinds())
end
ok("play starts a rehearsal run")

-- phase lines start phases while playing -----------------------------------------------------------
do
  acalls = {}
  local b = A.base
  now = now + 23 -- 25
  f.OnUpdate(f, 0.016)
  assert(#acalls == 0, "a line with no label starts nothing: " .. kinds())
  now = now + 10 -- 35
  f.OnUpdate(f, 0.016)
  assert(kinds() == "phase 1.5" and acalls[1][3] == "rehearsal" and near(acalls[1][4], b + 30), "P1.5 starts at its line: " .. kinds())
  f.OnUpdate(f, 0.016)
  assert(#acalls == 1, "once")
  now = now + 20 -- 55
  f.OnUpdate(f, 0.016)
  assert(kinds() == "phase 1.5,phase 2" and near(acalls[2][4], b + 50), "P2: " .. kinds())
  now = now + 30 -- 85
  f.OnUpdate(f, 0.016)
  assert(kinds() == "phase 1.5,phase 2,phase 3" and near(acalls[3][4], b + 80), "Intermission has no number, P3 starts: " .. kinds())
end
ok("phase lines start phases while playing")

-- jump starts the phases before it -----------------------------------------------------------------
do
  acalls = {}
  RW:Seek(60)
  assert(kinds() == "stop,start,phase 1.5,phase 2", "stop, start again, then the phases up to the new time: " .. kinds())
  assert(acalls[1][2] == true and acalls[2].at == 60, "a quiet stop, the run started at the new time")
  assert(near(acalls[3][4], A:TimeAt(30)) and near(acalls[4][4], A:TimeAt(50)), "each phase at its own line")
  f.OnUpdate(f, 0.016)
  assert(#acalls == 4, "the jump resets the tracking: nothing twice")
  now = now + 25 -- 85
  f.OnUpdate(f, 0.016)
  assert(kinds() == "stop,start,phase 1.5,phase 2,phase 3", "and the next line still starts: " .. kinds())
  acalls = {}
  f.play.OnClick(f.play) -- pause
  RW:Seek(40)
  assert(kinds() == "stop,start,phase 1.5", "a jump while paused restarts it too: " .. kinds())
  acalls = {}
  f.restart.OnClick(f.restart)
  assert(kinds() == "stop,start" and acalls[2].at == 0 and A:IsRehearsal(), "restart: back to 0:00 with the run started again: " .. kinds())
end
ok("jump starts the phases before it")

-- preview as lists the roster ----------------------------------------------------------------------
do
  local as = dropdowns["Preview as"]
  local function keys() local out = {} for _, o in ipairs(as.opts.options()) do out[#out + 1] = o.key .. "=" .. o.label end return table.concat(out, ",") end
  assert(type(as.opts.options) == "function", "the list is read when the menu opens")
  assert(keys() == "me=Me,*=Everyone,Aly=Aly,Bob=Bob", "Me, Everyone, then the roster: " .. keys())
  acalls = {}
  as.opts.set("Bob")
  assert(kinds() == "stop,start" and acalls[2][5].as == "Bob", "a new Preview as restarts the run with it: " .. kinds())
  assert(RW:As() == "Bob", "saved")
  roster = { { key = "Aly-Realm", name = "Aly" } }
  assert(keys() == "me=Me,*=Everyone,Aly=Aly,Bob=Bob", "a saved name not on the roster still shows: " .. keys())
  roster = { { key = "Aly-Realm", name = "Aly" }, { key = "Bob", name = "Bob" } }
  as.opts.set("me")
  assert(acalls[#acalls][1] == "start" and acalls[#acalls][5].as == nil, "back to you")
end
ok("preview as lists the roster")

-- close stops the run ------------------------------------------------------------------------------
do
  assert(A:IsRehearsal(), "a run is going")
  acalls = {}
  RW:Close()
  assert(kinds() == "stop" and not acalls[1][2] and not A.running, "closing stops it, not quietly: " .. kinds())
  RW:Open(src)
  f.play.OnClick(f.play)
  A:Start(3470, "Mythic", "encounter") -- a real run replaced it
  acalls = {}
  RW:Close()
  assert(#acalls == 0 and A.running, "a real run is never stopped: " .. kinds())
  RW:Open(src)
  f.play.OnClick(f.play)
  assert(#acalls == 0, "a real run is never replaced by Play: " .. kinds())
  A:Stop() RW:Close()
end
ok("close stops the run")

-- combat stops the rehearsal -----------------------------------------------------------------------
do
  local ev = events()
  assert(ev and ev.events.PLAYER_REGEN_DISABLED and ev.events.PLAYER_REGEN_ENABLED and ev.events.ENCOUNTER_START and ev.events.ENCOUNTER_END, "watches combat and encounters")
  RW:Open(src)
  f.play.OnClick(f.play)
  acalls = {}
  ev.OnEvent(ev, "PLAYER_REGEN_DISABLED")
  assert(not RW:IsOpen() and kinds() == "stop" and not A.running, "combat closes the window and stops the run: " .. kinds())
  assert(Run.Blocked(), "can't start in combat (InCombatLockdown is false inside the event)")
  ev.OnEvent(ev, "PLAYER_REGEN_ENABLED")
  assert(not Run.Blocked(), "out of combat again")
  -- ENCOUNTER_START, the engine's handler first: the real run is never stopped
  RW:Open(src)
  f.play.OnClick(f.play)
  A:Start(3470, "Mythic", "encounter")
  acalls = {}
  ev.OnEvent(ev, "ENCOUNTER_START", 3470)
  assert(not RW:IsOpen() and #acalls == 0 and A.running, "the engine first: closes, the real run goes on: " .. kinds())
  assert(Run.Blocked(), "can't start during an encounter")
  ev.OnEvent(ev, "ENCOUNTER_END", 3470)
  A:Stop()
  assert(not Run.Blocked(), "after the encounter")
  -- ours first
  RW:Open(src)
  f.play.OnClick(f.play)
  acalls = {}
  ev.OnEvent(ev, "ENCOUNTER_START", 3470)
  assert(not RW:IsOpen() and kinds() == "stop", "ours first: the rehearsal stops: " .. kinds())
  ev.OnEvent(ev, "ENCOUNTER_END", 3470)
end
ok("combat stops the rehearsal")

-- hiding the whole UI is not closing (review finding a) ---------------------------------------------
do
  RW:Open(src)
  f.play.OnClick(f.play)
  acalls = {}
  f.OnHide(f) -- UIParent hid (Alt+Z, a cinematic): the window is still shown
  assert(#acalls == 0 and A:IsRehearsal() and RW:IsOpen() and f.play.text == "Pause", "the rehearsal goes on: " .. kinds())
  now = now + 3
  assert(near(RW:Now(), 3), "the clock goes on")
  RW:Close()
  assert(kinds() == "stop", "a real close still stops it")
end
ok("hiding the UI keeps the rehearsal")

-- a second open swaps the fight and stops the old run (review finding b) -----------------------------
do
  RW:Open(src)
  f.play.OnClick(f.play)
  now = now + 10
  acalls = {}
  RW:Open({ base = base, encounterID = 3471, bossName = "Other", difficultyName = "Heroic" })
  assert(kinds() == "stop" and not A.running, "the old fight's run stops: " .. kinds())
  assert(near(RW:Now(), 0) and f.play.text == "Play", "the new fight opens paused at 0:00")
  f.play.OnClick(f.play)
  assert(acalls[2] and acalls[2][1] == "start" and acalls[2][2] == 3471 and acalls[2][3] == "Heroic", "play starts the new fight's run: " .. kinds())
  RW:Close()
end
ok("a second open stops the old run")

-- final review fixes ---------------------------------------------------------------------------------
do
  assert(f.strip.clips == true, "the strip clips its phase labels at its edges")
  local h = helpFrames["Strip"]
  assert(h and h.pt[2] == f.nextHead and h.pt[2] ~= f.strip, "the strip's (?) sits beside Next up, out of the label row")
end
ok("strip labels stay inside the strip")

do
  local ev = events()
  assert(ev.events.PLAYER_ENTERING_WORLD, "watches entering the world")
  ev.OnEvent(ev, "ENCOUNTER_START", 3470)
  ev.OnEvent(ev, "PLAYER_REGEN_DISABLED")
  assert(Run.Blocked(), "blocked")
  ev.OnEvent(ev, "PLAYER_ENTERING_WORLD") -- ENCOUNTER_END and REGEN_ENABLED were missed
  assert(not Run.Blocked(), "entering the world clears a missed encounter end and combat end")
end
ok("entering the world clears a stuck block")

do
  local ticks = 0
  A.RehearsalTick = function() ticks = ticks + 1 end
  RW:Open(src)
  f.OnUpdate(f, 0.016)
  assert(ticks == 0, "no run: no RehearsalTick")
  f.play.OnClick(f.play)
  f.OnUpdate(f, 0.016)
  assert(ticks == 1, "a run: RehearsalTick each frame")
  f.play.OnClick(f.play) -- paused: still ticks, so the engine sees the pause
  f.OnUpdate(f, 0.016)
  assert(ticks == 2, "paused: still ticks")
  RW:Close()
  A.RehearsalTick = nil
end
ok("the tick calls RehearsalTick during a run")

-- OpenAt: a Test button opens the rehearsal a few seconds before the tested alert, playing ----------
do
  local asked
  CRT.Timeline.RehearsalSourceFor = function(_, eid, group)
    asked = { eid, group }
    if eid == 9999 then return nil end
    return { base = base, encounterID = eid, group = group, bossName = "Nek'zali", difficultyName = "Heroic" }
  end
  -- as CRT_Modules/Timeline/Data.lua's: any name with "mythic" in it, any case
  CRT.Timeline.GroupFor = function(_, name)
    return type(name) == "string" and name:lower():find("mythic", 1, true) and "mythic" or "nh"
  end
  -- no difficulty from the caller keeps the source's; the group comes from GroupFor, as the engine's
  RW:OpenAt(3470, nil, 5, {})
  assert(asked[2] == "nh" and RW.source.difficultyName == "Heroic", "nil keeps the source's difficulty: " .. tostring(RW.source.difficultyName))
  RW:OpenAt(3470, "Mythic Keystone", 5, {})
  assert(asked[2] == "mythic" and RW.source.difficultyName == "Mythic Keystone", "the group by GroupFor")
  RW:Close()
  acalls = {}
  local alerts = { extra = { { id = "draft" } }, replaces = { block = "mine", id = 4 } }
  local okOpen, why = RW:OpenAt(3470, "Mythic", 22, { testing = "Soulcoil Rite", alerts = alerts })
  assert(okOpen == true and why == nil, "opened: " .. tostring(why))
  assert(asked[1] == 3470 and asked[2] == "mythic", "the source for the boss and its difficulty group")
  assert(RW:IsOpen() and near(RW:Now(), 22) and RW.clock:Playing(), "at the time, playing")
  assert(f.testing.text == "Testing: Soulcoil Rite", "the testing line: " .. tostring(f.testing.text))
  local c = acalls[#acalls]
  assert(c and c[1] == "start" and c[2] == 3470 and c[3] == "Mythic", "Start with the caller's encounter and difficulty: " .. kinds())
  assert(c[5].extra == alerts.extra and c[5].replaces == alerts.replaces and c[5].clock and c[5].speed, "opts.alerts passed into Start's opts")
  RW:Seek(40) -- a jump starts the run again, still with the tested alert (then starts P1.5)
  for i = #acalls, 1, -1 do if acalls[i][1] == "start" then c = acalls[i] break end end
  assert(c[1] == "start" and c[5].extra == alerts.extra and c[5].replaces == alerts.replaces, "a jump keeps opts.alerts")
  RW:OpenAt(3470, "Heroic", -5, { testing = "Other" })
  assert(asked[2] == "nh" and near(RW:Now(), 0) and RW.clock:Playing(), "Heroic is nh; a time before the pull starts at 0")
  c = acalls[#acalls]
  assert(c[1] == "start" and c[5].extra == nil and c[3] == "Heroic", "a new OpenAt drops the old alerts")
  RW:Close()
  RW:Open(src)
  assert(f.testing.text == "", "a plain Rehearse shows no testing line")
  f.play.OnClick(f.play)
  c = acalls[#acalls]
  assert(c[1] == "start" and c[5].extra == nil, "a plain Rehearse passes no alerts")
  RW:Close()
  local okNo, whyNo = RW:OpenAt(9999, "Mythic", 10, {})
  assert(okNo == false and type(whyNo) == "string" and whyNo:find("no ability timeline"), "no source: " .. tostring(whyNo))
  local ev = events()
  ev.OnEvent(ev, "PLAYER_REGEN_DISABLED")
  local okC, whyC = RW:OpenAt(3470, "Mythic", 10, {})
  assert(okC == false and whyC == "Rehearsal can't start in combat." and not RW:IsOpen(), "blocked in combat: " .. tostring(whyC))
  ev.OnEvent(ev, "PLAYER_REGEN_ENABLED")
  -- a quick test run gives way to OpenAt; a real pull doesn't, and neither does the plain Rehearse
  A.running, A.rehearsal, A.run = true, false, { reason = "test" }
  acalls = {}
  local okT, whyT = RW:OpenAt(3470, "Mythic", 10, {})
  assert(okT == true and whyT == nil and RW:IsOpen(), "a test run is replaced: " .. tostring(whyT))
  assert(acalls[1] and acalls[1][1] == "stop" and acalls[1][2] == true and acalls[2][1] == "start", "the test stops quietly, then the rehearsal starts: " .. kinds())
  RW:Close()
  A.running, A.rehearsal, A.run = true, false, { reason = "encounter" }
  local okE, whyE = RW:OpenAt(3470, "Mythic", 10, {})
  assert(okE == false and whyE == "Rehearsal can't start while the alerts are running a pull or a test." and A.running and not RW:IsOpen(), "a real pull is never replaced: " .. tostring(whyE))
  A.run = { reason = "test" }
  assert(Run.Blocked() == "Rehearsal can't start while the alerts are running a pull or a test.", "the plain Rehearse still waits for a test")
  A.running, A.rehearsal, A.run = false, false, nil
end
ok("open at a time for a test")

-- OpenAt's stopAt: the test plays from its countdown to a little after, then pauses there ----------
do
  dropdowns["Speed"].opts.set(1)
  acalls = {}
  RW:OpenAt(3470, "Mythic", 10, { testing = "Soulcoil Rite", stopAt = 14 })
  now = now + 3
  f.OnUpdate(f, 0.016)
  assert(RW.clock:Playing() and near(RW:Now(), 13), "playing before stopAt")
  now = now + 2
  f.OnUpdate(f, 0.016)
  assert(not RW.clock:Playing() and near(RW:Now(), 14), "paused at stopAt: " .. RW:Now())
  assert(RW:IsOpen() and A:IsRehearsal() and f.play.text == "Play", "the window stays open and the run stays")
  local stops = 0 for _, c in ipairs(acalls) do if c[1] == "stop" then stops = stops + 1 end end
  assert(stops == 0, "the run is never stopped: " .. kinds())
  assert(f.testing.text == "Testing: Soulcoil Rite", "the label stays")
  f.play.OnClick(f.play)
  now = now + 3
  f.OnUpdate(f, 0.016)
  assert(RW.clock:Playing() and near(RW:Now(), 17), "Play again runs on past it")
  -- a jump clears it
  RW:OpenAt(3470, "Mythic", 10, { stopAt = 14 })
  RW:Seek(12)
  now = now + 5
  f.OnUpdate(f, 0.016)
  assert(RW.clock:Playing() and near(RW:Now(), 17), "a jump clears stopAt")
  -- so does Restart, and a plain Rehearse never has one
  RW:OpenAt(3470, "Mythic", 10, { stopAt = 14 })
  RW:Restart()
  f.play.OnClick(f.play)
  now = now + 20
  f.OnUpdate(f, 0.016)
  assert(RW.clock:Playing() and near(RW:Now(), 20), "Restart clears stopAt")
  RW:OpenAt(3470, "Mythic", 10, { stopAt = 14 })
  RW:Open(src)
  f.play.OnClick(f.play)
  now = now + 20
  f.OnUpdate(f, 0.016)
  assert(RW.clock:Playing() and near(RW:Now(), 20), "a plain Rehearse has no stopAt")
  RW:Close()
  CRT.Timeline.RehearsalSourceFor = nil
end
ok("open at stops at stopAt")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const p of process.argv.slice(2, 4)) {
  let src; try { src = fs.readFileSync(p, 'utf8'); } catch (e) { console.error('cannot read ' + p); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('FAIL', lua.lua_tojsstring(L, -1)); process.exit(1); }
