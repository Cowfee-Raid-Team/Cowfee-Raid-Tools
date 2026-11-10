// CRT_Modules/ReadyCheck/Window.lua and the Window tab (ReadyCheck/Page.lua), on the shared placement helper
// (CRT_Core/UI/Placement.lua) and the shared fade (UI.FadeOut and UI.CancelFade, taken from CRT_Core/UI/Panel.lua).
// On mock frames that work out where they are from their anchors, and a click and a drag that go to the topmost frame
// under the cursor that takes clicks, as the game does: unlocked, a drag outside Previews moves the window and saves
// its place, from the title, a cell (which passes clicks through) or a heading; locked it doesn't; Previews move it
// either way; the gear and Reset stay for Previews; right-click still closes it. Past its seconds it stays while the
// mouse is over it and closes HOVER_GRACE after the mouse leaves (Keep it open off: at its seconds); a pull timer's
// fade stops while the mouse is over it and starts again when it leaves. The defaults and the two check boxes.
// Usage: node run_readycheck_window.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const root = process.argv[2];
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// The shared fade, as it is in Panel.lua: from its "local fades" line to the function after UI.CancelFade.
const panel = read('CRT_Core/UI/Panel.lua');
const fadeStart = panel.indexOf('local fades = {}');
const fadeEnd = panel.indexOf('function UI.SetFrameTitle');
if (fadeStart < 0 || fadeEnd < fadeStart) { console.error('FAIL UI.FadeOut and UI.CancelFade not found in Panel.lua'); process.exit(1); }
const fade = 'local ADDON, CRT = ...\nlocal UI = CRT.UI\n' + panel.slice(fadeStart, fadeEnd);
// The themed backdrops, as they are in Panel.lua: UI.themed, UI:ApplyThemed and UI:RegisterThemed, which a theme
// switch repaints (UI:ApplyStyle runs UI:ApplyThemed on each).
const themedStart = panel.indexOf('UI.themed = {}');
const themedEnd = panel.indexOf("-- The game's grey stone");
if (themedStart < 0 || themedEnd < themedStart) { console.error('FAIL UI:RegisterThemed not found in Panel.lua'); process.exit(1); }
const themed = 'local ADDON, CRT = ...\nlocal UI = CRT.UI\n' + panel.slice(themedStart, themedEnd);

const harness = `
local SRC = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
format = string.format

local frames = {}
local function frac(p)
  p = p or "CENTER"
  return (p:find("LEFT") and -0.5 or p:find("RIGHT") and 0.5 or 0), (p:find("BOTTOM") and -0.5 or p:find("TOP") and 0.5 or 0)
end
local SCREEN_W, SCREEN_H = 1920, 1080
local function rect(f, depth)
  if f == UIParent then return SCREEN_W / 2, SCREEN_H / 2, SCREEN_W, SCREEN_H end
  depth = (depth or 0) + 1
  assert(depth < 20, "an anchor loop")
  local p = f.pts[1]
  if not p then return nil end
  local rx, ry, rw, rh = rect(p.rel, depth)
  if not rx then return nil end
  local rfx, rfy = frac(p.rp)
  local fx, fy = frac(p.point)
  return rx + rfx * rw + p.x - fx * f.w, ry + rfy * rh + p.y - fy * f.h, f.w, f.h
end
local inCombat, shiftDown = false, false
local cursorX, cursorY = 0, 0
local function mock(kind, parent, template, name)
  local m = { kind = kind, parent = parent, template = template, name = name, shown = true, pts = {}, w = 0, h = 0, text = "",
    scripts = {}, alpha = 1, level = parent and ((parent.level or 1) + 1) or 1, click = kind == "Button" or kind == "CheckButton" }
  frames[#frames + 1] = m
  local methods = {
    SetPoint = function(self, point, rel, rp, x, y)
      if type(rel) == "number" then rel, rp, x, y = nil, nil, rel, rp end
      if type(rp) == "number" then rp, x, y = nil, rp, x end
      table.insert(self.pts, { point = point, rel = rel or self.parent or UIParent, rp = rp or point, x = x or 0, y = y or 0 })
    end,
    ClearAllPoints = function(self) self.pts = {} end,
    GetPoint = function(self, i) local p = self.pts[i or 1] if p then return p.point, p.rel, p.rp, p.x, p.y end end,
    GetNumPoints = function(self) return #self.pts end,
    GetName = function(self) return self.name end,
    GetParent = function(self) return self.parent end,
    GetCenter = function(self) local cx, cy = rect(self) return cx, cy end,
    GetLeft = function(self) local cx, _, w = rect(self) return cx and cx - w / 2 end,
    SetSize = function(self, w, h) self.w, self.h = w, h end,
    SetWidth = function(self, w) self.w = w end, SetHeight = function(self, h) self.h = h end,
    GetWidth = function(self) return self.w end, GetHeight = function(self) return self.h end,
    Show = function(self) if not self.shown then self.shown = true local s = self.scripts.OnShow if s then s(self) end end end,
    Hide = function(self) if self.shown then self.shown = false local s = self.scripts.OnHide if s then s(self) end end end,
    SetShown = function(self, on) if on then self:Show() else self:Hide() end end,
    IsShown = function(self) return self.shown end,
    IsVisible = function(self) local f = self while f do if not f.shown then return false end f = f.parent end return true end,
    SetScript = function(self, k, fn) self.scripts[k] = fn end,
    GetScript = function(self, k) return self.scripts[k] end,
    HookScript = function(self, k, fn) local old = self.scripts[k] self.scripts[k] = function(...) if old then old(...) end fn(...) end end,
    RegisterEvent = function(self, e) self.events = self.events or {} self.events[e] = true end,
    CreateTexture = function(self) return mock("Texture", self) end,
    CreateFontString = function(self) return mock("FontString", self) end,
    SetText = function(self, t) self.text = t end, GetText = function(self) return self.text end,
    GetStringWidth = function(self) return #(self.text or "") * 6 end,
    SetAlpha = function(self, a) self.alpha = a end, GetAlpha = function(self) return self.alpha end,
    SetEnabled = function(self, on) self.enabled = on and true or false end,
    SetChecked = function(self, on) self.checked = on and true or false end,
    GetChecked = function(self) return self.checked == true end,
    GetFrameLevel = function(self) return self.level or 1 end,
    SetFrameLevel = function(self, l) self.level = l end,
    GetFrameStrata = function(self) return self.strata or "MEDIUM" end,
    SetFrameStrata = function(self, s) self.strata = s end,
    EnableMouse = function(self, on) self.click, self.motion = on and true or false, on and true or false end,
    SetMouseClickEnabled = function(self, on) self.click = on and true or false end,
    SetMouseMotionEnabled = function(self, on) self.motion = on and true or false end,
    RegisterForDrag = function(self, ...) self.dragButtons = { ... } end,
    HasFocus = function() return false end,
    SetBackdrop = function(self, b) self.backdrop = b end,
    SetBackdropColor = function(self, r, g, b, a) self.bg = { r, g, b, a or 1 } end,
    SetBackdropBorderColor = function(self, r, g, b, a) self.edge = { r, g, b, a or 1 } end,
    GetScale = function(self) return self.scale or 1 end,
    SetScale = function(self, s) self.scale = s end,
    IsMouseOver = function(self)
      local cx, cy, w, h = rect(self)
      if not cx then return false end
      return math.abs(cursorX - cx) <= w / 2 and math.abs(cursorY - cy) <= h / 2
    end,
  }
  return setmetatable(m, { __index = function(_, k)
    if methods[k] then return methods[k] end
    if type(k) == "string" and k:find("^%u") then return function() end end
  end })
end
UIParent = mock("Frame", nil, nil, "UIParent")
UIParent:SetSize(SCREEN_W, SCREEN_H)
WorldFrame = mock("Frame", nil, nil, "WorldFrame")
function CreateFrame(kind, name, parent, template) local f = mock(kind, parent, template, name) if name then _G[name] = f end return f end
function InCombatLockdown() return inCombat end
function IsShiftKeyDown() return shiftDown end
function GetCursorPosition() return cursorX, cursorY end
local clock = 100
function GetTime() return clock end
function issecretvalue() return false end
local errorLines = {}
UIErrorsFrame = { AddMessage = function(_, text) errorLines[#errorLines + 1] = text end }
GameTooltip = mock("GameTooltip")
GameTooltip.shown = false
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, SendAddonMessage = function() end }
C_Spell = { GetSpellTexture = function() return 1 end }
RAID_CLASS_COLORS = { PALADIN = { r = 1, g = 0.5, b = 0.7 }, MAGE = { r = 0.2, g = 0.8, b = 1 } }
function IsInGroup() return false end
function IsInRaid() return false end
function GetInventoryItemDurability() return nil end
function GetInventoryItemTexture() return 1 end
function UnitIsUnit(a, b) return a == b end
function UnitName() return "Solex" end
function GetUnitName(u) return u end
function Ambiguate(n) return n end
function UnitIsGroupLeader() return true end
function UnitIsGroupAssistant() return false end

-- The topmost frame under the cursor that takes clicks (frame level, then the one made later), as the game picks it.
local function topAt()
  local best
  for _, f in ipairs(frames) do
    if f.kind ~= "Texture" and f.kind ~= "FontString" and f.click and f:IsVisible() and f:IsMouseOver() then
      if not best or (f.level or 1) >= (best.level or 1) then best = f end
    end
  end
  return best
end
-- A click at the cursor: OnMouseUp, then a button's OnClick.
local function clickAt(button)
  local f = topAt()
  if f then
    if f.scripts.OnMouseUp then f.scripts.OnMouseUp(f, button) end
    if f.scripts.OnClick then f.scripts.OnClick(f, button) end
  end
  return f
end
-- Time passes in small steps: every shown frame's OnUpdate runs each step.
local function tick(seconds)
  local step = 0.05
  local n = math.floor(seconds / step + 0.5)
  for _ = 1, n do
    clock = clock + step
    for _, f in ipairs(frames) do
      local s = f.scripts.OnUpdate
      if s and f:IsVisible() then s(f, step) end
    end
  end
end
local function fire(event, ...)
  for _, f in ipairs(frames) do
    if f.events and f.events[event] and f.scripts.OnEvent then f.scripts.OnEvent(f, event, ...) end
  end
end
-- A left-button drag from the cursor to (x, y): the game gives it to the frame under the cursor that takes clicks, if
-- that frame is registered for the left button (Frame:RegisterForDrag), and gives it no click.
local function dragTo(x, y)
  local f = topAt()
  local ok = false
  for _, b in ipairs(f and f.dragButtons or {}) do if b == "LeftButton" then ok = true end end
  shiftDown = true -- no snapping
  if ok and f.scripts.OnDragStart then f.scripts.OnDragStart(f, "LeftButton") end
  cursorX, cursorY = x, y
  tick(0.05)
  if ok and f.scripts.OnDragStop then f.scripts.OnDragStop(f) end
  shiftDown = false
  return f
end

-- A stand-in CRT ---------------------------------------------------------------------------------------
local previews, pages, helps = {}, {}, {}
local window = { enabled = true, leadOnly = false, seconds = 30, scale = 100, groupBuffsOnly = false, order = {}, sort = "group",
  classBars = true, locked = false, holdOnHover = true, opacity = 90, border = true,
  columns = { food = true, flask = true, rune = true, vantus = false, durability = true, weapon = true } }
local CRT = { db = { readycheck = { fadeOnPull = true, window = window }, consumables = {} } }
function CRT:Print() end
local UI = { PAGE_W = 1026, PAGE_H = 560 }
CRT.UI = UI
function UI:RegisterPreview(key, fn) previews[key] = fn end
local modern = false
function UI:IsModern() return modern end
CRT.PALETTE = { background = { 0.11, 0.12, 0.13 }, accent = { 0.9, 0.5, 0.2 } }
-- a theme switch, as UI:ApplyStyle does it for the themed backdrops
local function switchTheme(on) modern = on for _, f in ipairs(UI.themed) do UI:ApplyThemed(f) end end
local sliders = {}
function UI.Slider(parent, text, opts)
  local r = mock("Frame", parent)
  r.opts, r.label = opts, text
  r:SetSize((opts.labelWidth or 140) + 5 + (opts.width or 200) + 44, 32)
  r.refresh = function() end
  sliders[text] = r
  return r
end
function UI:RegisterLayer() end
function UI:SkinCloseButton() end
function UI:OnTheme() end
function UI:RegisterPage(key, title, build) pages[key] = build end
function UI:RegisterTab() end
function UI:SetTabSelected() end
function UI:Show() end
function UI.Color() return 1, 1, 1, 1 end
function UI.Tint() end
function UI.TooltipOwner() end
function UI.BadText(t) return t end
function UI.WarnText(t) return t end
function UI.ResetButton(parent) return mock("Button", parent) end
function UI.PreviewButton(parent) return mock("Button", parent) end
function UI.HelpRight(target, title, text) local b = mock("Button", target.parent) helps[#helps + 1] = { target = target, title = title, text = text, b = b } return b end
function UI.Dropdown(parent) local r = mock("Frame", parent) r.refresh = function() end return r end
function UI.ContextMenu() end
CRT.RaidReport = {
  Buffs = function() return {} end,
  Buff = function() return nil end,
  ReadGroup = function()
    return { { name = "Solex", unit = "player", class = "PALADIN", subgroup = 1, order = 1 },
      { name = "Rixxy", unit = "party1", class = "MAGE", subgroup = 1, order = 2 } }
  end,
  Classes = function() return {} end,
  Cell = function() return { state = "ok", icon = 1 } end,
  CHECKS = {},
}
CRT.Consumables = { QUESTION_MARK = 1, Entries = function() return {} end, ItemIcon = function() return 1 end }
CRT.ConsumablesBar = { LongTime = function() return "1m" end }

assert(load(SRC.fade, "Fade"))("CowfeeRaidTools", CRT)
assert(load(SRC.themed, "Themed"))("CowfeeRaidTools", CRT)
assert(load(SRC.placement, "Placement"))("CowfeeRaidTools", CRT)
assert(load(SRC.window, "Window"))("CowfeeRaidTools", CRT)
assert(load(SRC.page, "Page"))("CowfeeRaidTools", CRT)
local W, P = CRT.ReadyCheckWindow, UI.Placement
check(W and P and type(UI.FadeOut) == "function", "the window, the helper and the shared fade load")
local GRACE, FADE = W.HOVER_GRACE, W.PULL_FADE
check(type(GRACE) == "number" and GRACE > 0 and type(FADE) == "number" and FADE > 0, "HOVER_GRACE and PULL_FADE are named numbers")

-- the defaults ------------------------------------------------------------------------------------------------
do
  local block -- the window table holding classBars: the ready check window's
  for b in SRC.core:gmatch("\\n%s*window = (%b{})") do if b:find("classBars", 1, true) then block = b end end
  check(block ~= nil, "Core.lua has the ready check window's defaults")
  block = block or ""
  check(block:find("\\n%s*locked = false,") ~= nil, "default: locked = false")
  check(block:find("\\n%s*holdOnHover = true,") ~= nil, "default: holdOnHover = true")
  check(block:find("\\n%s*opacity = 90,") ~= nil, "default: opacity = 90")
  check(block:find("\\n%s*border = true,") ~= nil, "default: border = true")
end

local frame
local function show(seconds)
  W:Show(seconds)
  frame = _G.CowfeeRaidToolsReadyCheckWindow
  return frame
end
local function overWindow() cursorX, cursorY = frame:GetCenter() cursorY = cursorY + frame.h / 2 - 8 cursorX = cursorX - 60 end
local function away() cursorX, cursorY = 5, 5 end

-- dragging outside Previews ----------------------------------------------------------------------------------
show()
check(frame and frame.shown, "the window opens")
check(frame.gear and not frame.gear.shown and frame.reset and not frame.reset.shown, "outside Previews: no gear or Reset")
local x0, y0 = frame:GetCenter()
-- by the title, near the top left (the frame itself under the cursor)
cursorX, cursorY = x0 - frame.w / 2 + 20, y0 + frame.h / 2 - 8
local got = dragTo(cursorX + 150, cursorY - 100)
local x1, y1 = frame:GetCenter()
check(got == frame, "a drag by the title goes to the window")
check(x1 == x0 + 150 and y1 == y0 - 100, "unlocked: a drag outside Previews moves it: " .. tostring(x1 - x0) .. ", " .. tostring(y1 - y0))
check(window.position ~= nil, "and saves its place")
check(not frame.gear.shown and not frame.reset.shown, "the gear and Reset stay hidden")
check(P.selected == nil, "and nothing is selected (no outline, no arrow keys)")
-- the place is kept for the next ready check
W:Hide()
show()
local x2, y2 = frame:GetCenter()
check(x2 == x1 and y2 == y1, "the next time it opens, it is where it was dragged")
-- from a cell: cells take hovering only, so the drag reaches the window
local row = nil
local cell
for _, f in ipairs(frames) do
  if f.kind == "Frame" and f.parent and f.parent.parent == frame and f.motion and not f.click and f.shown then cell = f break end
end
check(cell ~= nil, "a cell that takes hovering for its tooltip")
cursorX, cursorY = cell:GetCenter()
check(topAt() == frame, "a click on a cell goes through to the window")
got = dragTo(cursorX - 80, cursorY + 40)
local x3, y3 = frame:GetCenter()
check(got == frame and x3 == x2 - 80 and y3 == y2 + 40, "a drag that starts on a cell moves the window: " .. tostring(x3 - x2) .. ", " .. tostring(y3 - y2))
-- from a heading: a button of its own, which passes the drag on
local header
for _, f in ipairs(frames) do if f.kind == "Button" and f.parent == frame and f.key == "food" then header = f end end
check(header ~= nil, "the live window has its headings")
cursorX, cursorY = header:GetCenter()
check(topAt() == header, "a heading takes its own clicks")
got = dragTo(cursorX + 30, cursorY - 30)
local x4, y4 = frame:GetCenter()
check(got == header and x4 == x3 + 30 and y4 == y3 - 30, "a drag that starts on a heading moves the window: " .. tostring(x4 - x3))
check(frame.shown, "and doesn't close it")
-- the live headings' clicks: shift-click posts, right-click closes
local posted
local oldPost = W.PostColumn
W.PostColumn = function(_, key) posted = key end
cursorX, cursorY = header:GetCenter()
shiftDown = true clickAt("LeftButton") shiftDown = false
check(posted == "food", "a shift-click on a heading still posts it")
W.PostColumn = oldPost
check(frame.dragButtons and #frame.dragButtons == 1 and frame.dragButtons[1] == "LeftButton", "only the left button drags, so a right-click is always a click")
cursorX, cursorY = x4 - frame.w / 2 + 20, y4 + frame.h / 2 - 8
clickAt("RightButton")
check(not frame.shown, "right-click closes it")
-- locked: no drag outside Previews
window.locked = true
show()
local lx, ly = frame:GetCenter()
cursorX, cursorY = lx - frame.w / 2 + 20, ly + frame.h / 2 - 8
dragTo(cursorX + 150, cursorY - 100)
local lx1, ly1 = frame:GetCenter()
check(lx1 == lx and ly1 == ly, "locked: a drag outside Previews doesn't move it")
cursorX, cursorY = header:GetCenter()
dragTo(cursorX + 150, cursorY - 100)
check(select(1, frame:GetCenter()) == lx, "locked: nor does a drag on a heading")
-- Previews move it either way
for _, lock in ipairs({ true, false }) do
  window.locked = lock
  previews.readycheckwindow(true)
  check(frame.gear.shown and frame.reset.shown, "Previews: the gear and Reset show (locked " .. tostring(lock) .. ")")
  local px, py = frame:GetCenter()
  cursorX, cursorY = px - frame.w / 2 + 20, py + frame.h / 2 - 8
  dragTo(cursorX + 40, cursorY - 20)
  local px1 = frame:GetCenter()
  check(px1 == px + 40, "Previews: a drag moves it (locked " .. tostring(lock) .. ")")
  previews.readycheckwindow(false)
  check(not frame.gear.shown and not frame.reset.shown, "Previews off: the gear and Reset go")
end
-- combat: refused, with the helper's message
window.locked = false
show()
inCombat = true
local cx0, cy0 = frame:GetCenter()
cursorX, cursorY = cx0 - frame.w / 2 + 20, cy0 + frame.h / 2 - 8
local linesBefore = #errorLines
dragTo(cursorX + 100, cursorY)
inCombat = false
check(select(1, frame:GetCenter()) == cx0 and #errorLines == linesBefore, "in combat a drag outside Previews is refused silently")
-- in Previews (placing) the refusal keeps its message
previews.readycheckwindow(true)
inCombat = true
cx0, cy0 = frame:GetCenter()
cursorX, cursorY = cx0 - frame.w / 2 + 20, cy0 + frame.h / 2 - 8
dragTo(cursorX + 100, cursorY)
inCombat = false
check(select(1, frame:GetCenter()) == cx0 and errorLines[#errorLines] == P.TEXT.combat, "in combat a drag in Previews is refused, with a message")
previews.readycheckwindow(false)
W:Hide()

-- the window hiding mid-drag lets go of the drag: its driver stops, and it goes back to its saved place
local function midDrag()
  local mx, my = frame:GetCenter()
  cursorX, cursorY = mx - frame.w / 2 + 20, my + frame.h / 2 - 8
  shiftDown = true
  frame.scripts.OnDragStart(frame, "LeftButton")
  cursorX = cursorX + 60
  tick(0.05)
  shiftDown = false
  return mx, my
end
local function dropped(mx, what)
  check(P.Dragging() == nil, what .. ": the drag is cancelled")
  local before = select(1, frame:GetCenter())
  cursorX = cursorX + 200
  tick(0.1)
  check(select(1, frame:GetCenter()) == before and before == mx, what .. ": its driver stopped, back at its saved place")
end
away()
show(30)
local mx = midDrag()
check(P.Dragging() ~= nil, "(a drag under way)")
fire("START_PLAYER_COUNTDOWN")
window.holdOnHover = false
tick(FADE + 0.1)
check(not frame.shown, "a pull fade ends mid-drag: hidden")
dropped(mx, "hidden by the pull fade mid-drag")
window.holdOnHover = true
show(30)
mx = midDrag()
clickAt("RightButton")
check(not frame.shown, "a right-click mid-drag: hidden")
dropped(mx, "hidden by a right-click mid-drag")

-- the hover hold ----------------------------------------------------------------------------------------------
window.holdOnHover = true
away()
show(5)
tick(4.5)
check(frame.shown, "before its seconds it stays")
overWindow()
tick(1)
check(frame.shown, "past its seconds, the mouse over it: still shown")
tick(10)
check(frame.shown, "and as long as the mouse stays")
away()
tick(GRACE * 0.5)
check(frame.shown, "the mouse leaves: still shown for a moment")
tick(GRACE * 0.5 + 0.1)
check(not frame.shown, "hidden HOVER_GRACE after the mouse leaves")
-- the mouse left before its seconds: it closes at its seconds
show(5)
overWindow()
tick(3)
away()
tick(2.1)
check(not frame.shown, "the mouse gone before its seconds: closed at its seconds")
-- Keep it open off
window.holdOnHover = false
show(5)
overWindow()
tick(5.1)
check(not frame.shown, "Keep it open off: hidden at its seconds, mouse over or not")
-- /crt check: no timer, unchanged
window.holdOnHover = true
away()
W:Show(nil, false, true)
tick(120)
check(frame.shown, "/crt check stays open with no timer")
W:Hide()

-- the pull timer's fade -----------------------------------------------------------------------------------------
away()
show(30)
fire("START_PLAYER_COUNTDOWN")
tick(FADE * 0.5)
check(frame.shown and frame.alpha < 0.9 and frame.alpha > 0.1, "a pull timer fades it: " .. frame.alpha)
overWindow()
tick(0.1)
check(frame.shown and frame.alpha == 1, "the mouse over it mid-fade: the fade stops, at full alpha")
tick(FADE * 3)
check(frame.shown and frame.alpha == 1, "and it stays while the mouse does")
away()
tick(FADE * 0.5)
check(frame.shown and frame.alpha < 0.9, "the mouse leaves: the fade starts again")
overWindow()
tick(0.1)
check(frame.shown and frame.alpha == 1, "the mouse back: stopped again")
away()
tick(FADE - 0.2)
check(frame.shown, "leaving again: the full fade from the start, still shown near its end")
tick(0.4)
check(not frame.shown, "hidden at the end of the fade")
show(30)
check(frame.alpha == 1, "the next ready check shows it at full alpha")
-- past its seconds, a fade still runs its full length after the mouse leaves
show(3)
fire("START_PLAYER_COUNTDOWN")
overWindow()
tick(5)
away()
tick(GRACE + 0.1)
check(frame.shown, "past its seconds, the restarted fade isn't cut short by the hover grace")
tick(FADE)
check(not frame.shown, "the fade hides it")
-- Keep it open off: the fade runs as today
window.holdOnHover = false
show(30)
fire("START_PLAYER_COUNTDOWN")
overWindow()
tick(FADE * 0.5)
check(frame.shown and frame.alpha < 0.9, "Keep it open off: the mouse over it doesn't stop the fade")
tick(FADE * 0.5 + 0.1)
check(not frame.shown, "Keep it open off: hidden after the fade")
window.holdOnHover = true
-- Keep it open turned off while the fade is held: the fade starts again and closes it
show(30)
fire("START_PLAYER_COUNTDOWN")
overWindow()
tick(0.1)
check(frame.shown and frame.alpha == 1, "(the fade held by the mouse)")
window.holdOnHover = false
tick(0.1)
check(frame.alpha < 1, "Keep it open turned off while held: the fade starts again")
tick(FADE)
check(not frame.shown, "and closes it, mouse over or not")
window.holdOnHover = true
-- Previews on during a pull fade (running or held): the preview stays at full alpha
for _, held in ipairs({ false, true }) do
  away()
  show(30)
  fire("START_PLAYER_COUNTDOWN")
  if held then overWindow() end
  tick(FADE * 0.5)
  previews.readycheckwindow(true)
  away()
  tick(FADE * 2)
  check(frame.shown and frame.alpha == 1, "Previews on during a " .. (held and "held" or "running") .. " pull fade: shown at full alpha")
  previews.readycheckwindow(false)
end
-- right-click and the X still close it mid-hold
show(30)
fire("START_PLAYER_COUNTDOWN")
overWindow()
tick(0.1)
clickAt("RightButton")
check(not frame.shown, "right-click closes it while hovered mid-fade")
show(30)
frame.close.scripts.OnClick(frame.close)
check(not frame.shown, "the X closes it")
away()

-- the Window tab's two check boxes ------------------------------------------------------------------------------
local pf = mock("Frame", UIParent)
pages.readycheck(pf)
pf.scripts.OnShow(pf)
local boxes = {}
for _, f in ipairs(frames) do
  if f.kind == "CheckButton" and f.label then boxes[f.label.text] = f end
end
local lock, hold = boxes["Lock the window in place"], boxes["Keep it open while my mouse is over it"]
local opened = boxes["Open the window on a ready check"]
check(lock and hold and opened, "the Window tab has Lock the window in place and Keep it open while my mouse is over it")
if lock and hold and opened then
  local function helpOf(b) for _, h in ipairs(helps) do if h.target == b then return h end end end
  check(helpOf(lock) and helpOf(lock).text == "Unlocked, drag the window anywhere during a ready check. Locked, it only moves in Previews.", "Lock has its (?)")
  check(helpOf(hold) and helpOf(hold).text:find("Past its seconds, the window stays while your mouse is over it", 1, true) ~= nil, "Keep it open has its (?)")
  check(lock.checked == false and hold.checked == true, "they show the settings: unlocked, kept open")
  lock.checked = true lock.scripts.OnClick(lock)
  check(window.locked == true, "ticking Lock locks it")
  lock.checked = false lock.scripts.OnClick(lock)
  hold.checked = false hold.scripts.OnClick(hold)
  check(window.locked == false and window.holdOnHover == false, "unticking them saves both")
  hold.checked = true hold.scripts.OnClick(hold)
  check(lock.enabled == true and hold.enabled == true, "enabled while the window opens on a ready check")
  opened.checked = false opened.scripts.OnClick(opened)
  check(lock.enabled == false and hold.enabled == false, "greyed out when Open the window on a ready check is off")
  opened.checked = true opened.scripts.OnClick(opened)
  -- laid out in the right column, apart from the rows there and inside the page
  local function top(b) return b.pts[1].y end
  local function left(b) return b.pts[1].x end
  local classBars = boxes["Class color bar behind each row"]
  check(left(lock) == left(classBars) and left(hold) == left(classBars), "in the right column, under Class color bar")
  check(top(lock) <= top(classBars) - 24 and top(hold) <= top(lock) - 24, "each on its own row, under Class color bar")
  check(top(hold) - 24 > -148, "above the Columns line and the table")
  local width = (#lock.label.text > #hold.label.text and #lock.label.text or #hold.label.text) * 6
  check(left(hold) + 26 + width + 24 <= UI.PAGE_W, "inside the page's width")
end

-- the look: background opacity and the border ------------------------------------------------------------------
local live = frame
local sample
for _, f in ipairs(frames) do
  if f.template == "BackdropTemplate" and f ~= live and f.title then sample = f end
end
check(sample ~= nil, "the Window tab has its sample copy")
sample = sample or live
local function near(a, b) return a and math.abs(a - b) < 1e-6 end
local function bgAlpha(f) return f.bg and f.bg[4] end
local function edgeAlpha(f) return f.edge and f.edge[4] end
W:Show(nil, true)
window.opacity, window.border = 90, true
W:Apply()
check(near(bgAlpha(live), 0.9) and near(bgAlpha(sample), 0.9), "opacity 90: background alpha 0.9 on the window and the sample: " .. tostring(bgAlpha(live)))
check(near(edgeAlpha(live), 1) and near(edgeAlpha(sample), 1), "border on: the edge shows on both")
for _, case in ipairs({ { 100, 1 }, { 50, 0.5 }, { 0, 0 }, { 150, 1 }, { -5, 0 } }) do
  window.opacity = case[1]
  W:Apply()
  check(near(bgAlpha(live), case[2]) and near(bgAlpha(sample), case[2]), "opacity " .. case[1] .. ": background alpha " .. case[2] .. " on both: " .. tostring(bgAlpha(live)) .. ", " .. tostring(bgAlpha(sample)))
end
-- the hidden window follows too, so it opens with the setting
W:Hide()
window.opacity = 70
W:Apply()
check(near(bgAlpha(live), 0.7), "a closed window takes the setting too")
-- only the background fades: the frame itself stays at full alpha
check(live.alpha == 1 and sample.alpha == 1, "text, icons and bars stay at full alpha (the frame isn't faded)")
-- the border
window.border = false
W:Apply()
check(near(edgeAlpha(live), 0) and near(edgeAlpha(sample), 0), "border off: the edge is hidden on both")
check(live.backdrop and live.backdrop.edgeSize == 1 and sample.backdrop.edgeSize == 1, "border off keeps the 1 px edge's room: nothing shifts")
-- a theme switch keeps both, in every look
switchTheme(true)
check(near(bgAlpha(live), 0.7) and near(bgAlpha(sample), 0.7), "a Modern theme keeps the opacity: " .. tostring(bgAlpha(live)))
check(near(live.bg[1], CRT.PALETTE.background[1]), "and paints the theme's background")
check(near(edgeAlpha(live), 0) and near(edgeAlpha(sample), 0), "and keeps the border off")
window.border = true
W:Apply()
check(near(edgeAlpha(live), 1) and near(live.edge[1], CRT.PALETTE.accent[1]), "border on in Modern: the accent edge")
switchTheme(false)
check(near(bgAlpha(live), 0.7) and near(edgeAlpha(live), 1) and near(live.edge[1], 0.78), "back to Classic: opacity kept, the gold edge")
window.opacity = 90

-- the Window tab's two new controls
local slider = sliders["Background opacity"]
local borderBox = boxes["Show a border"]
check(slider ~= nil, "the Window tab has a Background opacity slider")
check(borderBox ~= nil, "the Window tab has a Show a border check box")
if slider and borderBox then
  local o = slider.opts
  check(o.min == 0 and o.max == 100 and (o.step or 1) == 1, "the slider runs 0 to 100 in steps of 1")
  check(not o.onRelease, "it applies as it moves")
  check(o.format and o.format(90) == "90%", "it shows a percent")
  check(o.get() == 90, "it shows the setting")
  o.set(40)
  check(window.opacity == 40 and near(bgAlpha(live), 0.4) and near(bgAlpha(sample), 0.4), "moving it sets the window and the sample at once")
  window.opacity = 90
  W:Apply()
  check(borderBox.checked == true, "Show a border shows the setting")
  borderBox.checked = false borderBox.scripts.OnClick(borderBox)
  check(window.border == false and near(edgeAlpha(live), 0) and near(edgeAlpha(sample), 0), "unticking it hides the edge on both")
  borderBox.checked = true borderBox.scripts.OnClick(borderBox)
  check(window.border == true and near(edgeAlpha(sample), 1), "ticking it shows the edge again")
  -- both stay enabled when the window doesn't open on a ready check: they style Show it now and /crt check too
  local opened = boxes["Open the window on a ready check"]
  opened.checked = false opened.scripts.OnClick(opened)
  check(borderBox.enabled ~= false and not o.enabledIf, "they stay enabled with Open the window on a ready check off")
  opened.checked = true opened.scripts.OnClick(opened)
  -- layout: the border box in the right column under Keep it open; the slider under Size % in the left column
  local hold, classBars = boxes["Keep it open while my mouse is over it"], boxes["Class color bar behind each row"]
  local sp = slider.pts[1]
  check(borderBox.pts[1].x == classBars.pts[1].x and borderBox.pts[1].y <= hold.pts[1].y - 24, "Show a border sits under Keep it open, in the right column")
  local sizeLabel
  for _, f in ipairs(frames) do if f.kind == "FontString" and f.text == "Size % (50 to 150)" then sizeLabel = f end end
  check(sizeLabel and sp.x == sizeLabel.pts[1].x and sp.y <= sizeLabel.pts[1].y - 20, "the slider sits under Size %, lined up with it")
  local helpRight = 0
  for _, h in ipairs(helps) do if h.target == slider then helpRight = 24 end end
  check(sp.x + slider.w + helpRight <= classBars.pts[1].x, "the slider (and its (?)) ends before the right column")
  local cols
  for _, f in ipairs(frames) do if f.kind == "FontString" and type(f.text) == "string" and f.text:find("^Columns:") then cols = f end end
  local slBottom = sp.y - slider.h
  check(cols and cols.pts[1].y <= slBottom - 8, "the Columns label is below the slider: " .. tostring(cols and cols.pts[1].y) .. " vs " .. slBottom)
  check(borderBox.pts[1].y - 24 > cols.pts[1].y, "Show a border is above the Columns label")
  local bp = sample.pts[1]
  local sampleTop = bp.y * sample:GetScale()
  check(sampleTop < cols.pts[1].y - 14, "the sample is below the Columns label")
  local orderButton
  for _, f in ipairs(frames) do if f.kind == "Button" and f.text == "Default order" then orderButton = f end end
  local by = orderButton and orderButton.pts[1].y
  check(by and by <= sampleTop - sample.h * sample:GetScale() - 4, "the buttons are below the sample: " .. tostring(by))
  check(by and by - 24 >= -(UI.PAGE_H - 66), "and inside the page's height")
end

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error(fails .. " ready check window checks failed") end
`;

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_newtable(L);
const SRC = {
  fade, themed, placement: read('CRT_Core/UI/Placement.lua'), window: read('CRT_Modules/ReadyCheck/Window.lua'),
  page: read('CRT_Modules/ReadyCheck/Page.lua'), core: read('CRT_Core/Core.lua'),
};
for (const [k, v] of Object.entries(SRC)) { lua.lua_pushstring(L, to_luastring(v)); lua.lua_setfield(L, -2, to_luastring(k)); }
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
console.log('ok ready check window: drag when unlocked (title, cell, heading), locked, Previews, the hover hold, the pull fade, the Window tab boxes');
