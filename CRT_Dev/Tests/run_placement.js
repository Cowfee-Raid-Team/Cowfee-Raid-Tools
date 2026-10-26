// CRT_Core/UI/Placement.lua, PlacementPanel.lua and PlacementSelect.lua: the one helper every movable CRT element is
// placed by.
// On mock frames that work out where they are from their anchors (as the game does): old saved places load unchanged;
// X and Y apply and stay on the screen; Centre horizontally and vertically; the arrow keys nudge 1 and Shift 10 px
// and only while selected and out of combat; a drag snaps within 6 px and not with Shift; an element anchored to
// another keeps its offset and follows it (a move, a nudge, a reset, and while it is hidden); a loop can't be made;
// Reset clears the anchor; the gear and the panel refuse in combat; Select Anchor's overlay takes the clicks (the
// frame under it hears none), its hit test finds the topmost frame that takes the mouse, a left click selects, a
// right click or Escape cancels, the refusals apply, and combat refuses and cancels it. Then a lint: every movable
// element in the modules is placed by the helper, with none of its own drag or save code.
// Usage: node run_placement.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const root = process.argv[2];
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// Every movable element, the file that defines it and its key. A new movable overlay goes here.
const ELEMENTS = [
  ['CRT_Modules/Alerts/Areas.lua', 'alert'], // alerttexts, alerticons, alertbars, alertcircles, alerttimeline
  ['CRT_Modules/Notes/Alert.lua', 'notecallout'],
  ['CRT_Modules/QoL/BreakTimer.lua', 'breaktimer'],
  ['CRT_Modules/QoL/LowHealth.lua', 'lowhealth'],
  ['CRT_Modules/Markers/Display.lua', 'markers'],
  ['CRT_Modules/Consumables/Display.lua', 'consumables'],
  ['CRT_Modules/Debuffs/Panel.lua', 'debuffs'],
  ['CRT_Modules/Pace/Display.lua', 'pace'],
  ['CRT_Modules/ReadyCheck/Window.lua', 'readycheck'],
];

const harness = `
local SRC, ELEMENTS, MODULES = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
format = string.format

-- Frames that work out their centre from their first anchor, as the game lays them out (hidden ones too).
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
local propagate = {}
local function mock(kind, parent, template, name)
  local m = { kind = kind, parent = parent, template = template, name = name, shown = true, pts = {}, w = 0, h = 0, text = "", scripts = {}, hooks = {} }
  frames[#frames + 1] = m
  m.idx = #frames
  local methods = {
    SetPoint = function(self, point, rel, rp, x, y)
      if type(rel) == "number" then rel, rp, x, y = nil, nil, rel, rp end
      if type(rp) == "number" then rp, x, y = nil, rp, x end
      -- as the game: an anchor-restricted region can't be anchored to from another hierarchy
      if rel and (rel.anchorRestricted or rel.refuseAnchors) then error("anchor family connection") end
      self.layoutCalls = (self.layoutCalls or 0) + 1
      table.insert(self.pts, { point = point, rel = rel or self.parent or UIParent, rp = rp or point, x = x or 0, y = y or 0 })
    end,
    ClearAllPoints = function(self) self.layoutCalls = (self.layoutCalls or 0) + 1 self.pts = {} end,
    GetPoint = function(self, i) local p = self.pts[i or 1] if p then return p.point, p.rel, p.rp, p.x, p.y end end,
    GetNumPoints = function(self) return #self.pts end,
    GetName = function(self) return self.name end,
    GetParent = function(self) return self.parent end,
    IsProtected = function(self) return self.protected == true, false end,
    IsForbidden = function(self) return self.forbidden == true end,
    IsAnchoringRestricted = function(self) return self.anchorRestricted == true end,
    RegisterEvent = function(self, e) self.events = self.events or {} self.events[e] = true end,
    UnregisterEvent = function(self, e) if self.events then self.events[e] = nil end end,
    GetCenter = function(self) local cx, cy = rect(self) return cx, cy end,
    SetSize = function(self, w, h) self.w, self.h = w, h end,
    SetWidth = function(self, w) self.w = w end, SetHeight = function(self, h) self.h = h end,
    GetWidth = function(self) return self.w end, GetHeight = function(self) return self.h end,
    Show = function(self) if not self.shown then self.shown = true local s = self.scripts.OnShow if s then s(self) end end end,
    Hide = function(self) if self.shown then self.shown = false local s = self.scripts.OnHide if s then s(self) end end end,
    SetShown = function(self, on) if on then self:Show() else self:Hide() end end,
    IsShown = function(self) return self.shown end,
    -- shown, and every parent shown, as in the game
    IsVisible = function(self) local f = self while f do if not f.shown then return false end f = f.parent end return true end,
    SetScript = function(self, k, fn) self.scripts[k] = fn end,
    GetScript = function(self, k) return self.scripts[k] end,
    HookScript = function(self, k, fn) local old = self.scripts[k] self.scripts[k] = function(...) if old then old(...) end fn(...) end end,
    CreateTexture = function(self) return mock("Texture", self) end,
    CreateFontString = function(self) return mock("FontString", self) end,
    SetText = function(self, t) self.text = t end, GetText = function(self) return self.text end,
    GetStringWidth = function(self) return #(self.text or "") * 6 end,
    SetEnabled = function(self, on) self.enabled = on and true or false end,
    EnableKeyboard = function(self, on) self.keyboard = on and true or false end,
    SetPropagateKeyboardInput = function(self, on)
      assert(not inCombat, "SetPropagateKeyboardInput in combat (#nocombat)")
      self.propagate = on and true or false
      propagate[#propagate + 1] = self.propagate
    end,
    HasFocus = function(self) return self.focus == true end,
    ClearFocus = function(self) self.focus = false end,
    GetFrameLevel = function(self) return self.level or 1 end,
    SetFrameLevel = function(self, l) self.level = l end,
    GetFrameStrata = function(self) return self.strata or "MEDIUM" end,
    SetFrameStrata = function(self, s) self.strata = s end,
    -- the mouse: off until enabled, as on a new frame; EnableMouse is both clicks and hovering
    EnableMouse = function(self, on) self.click, self.motion = on and true or false, on and true or false end,
    SetMouseClickEnabled = function(self, on) self.click = on and true or false end,
    SetMouseMotionEnabled = function(self, on) self.motion = on and true or false end,
    IsMouseClickEnabled = function(self) return self.click == true end,
    IsMouseMotionEnabled = function(self) return self.motion == true end,
    IsMouseOver = function(self)
      local cx, cy, w, h = rect(self)
      if not cx then return false end
      return math.abs(cursorX - cx) <= w / 2 and math.abs(cursorY - cy) <= h / 2
    end,
    SetAllPoints = function(self, rel)
      rel = rel or self.parent or UIParent
      self.pts = { { point = "CENTER", rel = rel, rp = "CENTER", x = 0, y = 0 } }
      local _, _, w, h = rect(rel)
      self.w, self.h = w or 0, h or 0
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
WorldFrame:SetSize(SCREEN_W, SCREEN_H)
WorldFrame:SetPoint("CENTER", UIParent, "CENTER")
-- named frames are globals, as in the game
function CreateFrame(kind, name, parent, template) local f = mock(kind, parent, template, name) if name then _G[name] = f end return f end
function InCombatLockdown() return inCombat end
function IsShiftKeyDown() return shiftDown end
function GetCursorPosition() return cursorX, cursorY end
-- every frame that isn't forbidden, in the order they were made (textures and texts are regions, not frames)
local enumerated = 0 -- how many times the frames were gone through
function EnumerateFrames(cur)
  if not cur then enumerated = enumerated + 1 end
  for i = cur and cur.idx + 1 or 1, #frames do
    local f = frames[i]
    if f.kind ~= "Texture" and f.kind ~= "FontString" and not f.forbidden then return f end
  end
end
local clock = 0
function GetTime() return clock end
-- The game's click: it goes to the topmost frame under the cursor that takes clicks (strata, then frame level, then
-- the one made later): its OnMouseDown, its OnMouseUp, and a button's OnClick.
local STRATA = { WORLD = 1, BACKGROUND = 2, LOW = 3, MEDIUM = 4, HIGH = 5, DIALOG = 6, FULLSCREEN = 7, FULLSCREEN_DIALOG = 8, TOOLTIP = 9 }
local function clickAt(button)
  local best
  for _, f in ipairs(frames) do
    if f.kind ~= "Texture" and f.kind ~= "FontString" and f.click and f:IsVisible() and f:IsMouseOver() then
      local r, l = STRATA[f:GetFrameStrata()], f:GetFrameLevel()
      if not best or r > best.r or (r == best.r and l >= best.l) then best = { f = f, r = r, l = l } end
    end
  end
  local f = best and best.f
  if f then
    if f.scripts.OnMouseDown then f.scripts.OnMouseDown(f, button) end
    if f.scripts.OnMouseUp then f.scripts.OnMouseUp(f, button, true) end
    if f.kind == "Button" and f.scripts.OnClick then f.scripts.OnClick(f, button, false) end
  end
  return f
end
local timers, timersEver = {}, 0
C_Timer = { After = function(d, fn) timersEver = timersEver + 1 timers[#timers + 1] = { d, fn } end }
-- an event to every frame that registered it
local function fire(event, ...)
  for _, f in ipairs(frames) do
    if f.events and f.events[event] and f.scripts.OnEvent then f.scripts.OnEvent(f, event, ...) end
  end
end
local function runTimers()
  local n = 0
  while #timers > 0 and n < 100 do n = n + 1 local t = table.remove(timers, 1) t[2]() end
end
function issecretvalue() return false end
local errorLines = {}
UIErrorsFrame = { AddMessage = function(_, text) errorLines[#errorLines + 1] = text end }
GameTooltip = mock("GameTooltip")

-- A stand-in CRT.UI with the shared controls the panel uses.
local previews, menus, dropdowns, buttons = {}, {}, {}, {}
local CRT = { db = { a = {}, b = {}, c = {}, d = {}, e = {}, f = {} } }
local UI = {}
CRT.UI = UI
function UI:RegisterPreview(key, fn) previews[key] = fn end
function UI.Color() return 1, 1, 1, 1 end
function UI.Tint() end
function UI:SkinEditBox() end
function UI.HelpRight(target, title, text, opts) local b = mock("Button", opts and opts.parent) b.tip = text return b end
function UI.TooltipOwner() end
function UI.ContextMenu(owner, fill)
  local root = { items = {} }
  function root:CreateButton(label, fn) self.items[#self.items + 1] = { label = label, fn = fn } return {} end
  fill(root)
  menus[#menus + 1] = root
  return root
end
function UI.PanelButton(parent, label, h, onClick) local b = mock("Button", parent) b.label = label b.height = h b.scripts.OnClick = onClick buttons[label] = b return b end
function UI.Dropdown(parent, label, opts) local r = mock("Row", parent) r.opts = opts r.refresh = function() end dropdowns[label] = r return r end
function UI.Window(name, opts)
  local f = mock("Frame", UIParent, nil, name)
  f.shown = false
  f.content = mock("Frame", f)
  f.strip = mock("Frame", f)
  f.strip.SetHelp = function(self, t, text) self.help = text end
  f.strip.SetTitle = function(self, t) self.title = t end
  return f
end

assert(load(SRC.placement, "Placement"))("CowfeeRaidTools", CRT)
assert(load(SRC.panel, "PlacementPanel"))("CowfeeRaidTools", CRT)
assert(load(SRC.select, "PlacementSelect"))("CowfeeRaidTools", CRT)
local P = UI.Placement
check(P and type(P.Define) == "function" and type(P.OpenPanel) == "function", "the helper and its panel load")

local function el(key, store, default, opts)
  opts = opts or {}
  local spec = { title = opts.title or key, store = function() return store end, default = default, point = opts.point,
    build = opts.build, settings = opts.settings, canAnchor = opts.canAnchor, target = opts.target, editing = opts.editing }
  return P.Define(key, spec)
end
local function make(e, w, h)
  local f = CreateFrame("Frame", nil, UIParent)
  f:SetSize(w or 200, h or 40)
  local handle = CreateFrame("Frame", nil, f)
  local reset = CreateFrame("Button", nil, handle)
  e:Attach(f, handle, { reset = reset })
  return f, handle
end
local function centre(f) return f:GetCenter() end
local function pt(f) local p = f.pts[1] return p.point, p.rel, p.rp, p.x, p.y end

-- old saved places load unchanged ---------------------------------------------------------------
CRT.db.a.position = { point = "TOPLEFT", relativePoint = "TOPLEFT", x = 10, y = -20 }
local A = el("texts", CRT.db.a, { point = "CENTER", relativePoint = "CENTER", x = 0, y = 300 }, { title = "Critical alerts text" })
local fa, ha = make(A)
local p1, r1, rp1, x1, y1 = pt(fa)
check(p1 == "TOPLEFT" and r1 == UIParent and rp1 == "TOPLEFT" and x1 == 10 and y1 == -20, "an old saved place loads as it was saved")
CRT.db.a.position = nil
A:Apply()
p1, r1, rp1, x1, y1 = pt(fa)
check(p1 == "CENTER" and r1 == UIParent and x1 == 0 and y1 == 300, "no saved place: its default")
check(A.gear and A.gear.parent == ha, "a gear on its drag box")

-- X and Y, and staying on the screen -----------------------------------------------------------
local x, y = A:Offset()
check(x == 0 and y == 300, "X and Y read its centre from the screen's: " .. tostring(x) .. ", " .. tostring(y))
A:SetOffset(25, -40)
x, y = A:Offset()
local s = CRT.db.a.position
check(x == 25 and y == -40 and s and s.point == "CENTER" and s.relativePoint == "CENTER" and s.x == 25 and s.y == -40 and s.anchor == nil,
  "X and Y apply and are saved: " .. tostring(x) .. ", " .. tostring(y))
A:SetOffset(5000, -9000)
x, y = A:Offset()
check(x == SCREEN_W / 2 - 100 and y == -(SCREEN_H / 2 - 20), "X and Y stay on the screen: " .. tostring(x) .. ", " .. tostring(y))
A:SetOffset(12.4, 7.6)
x, y = A:Offset()
check(x == 12 and y == 8, "whole pixels")

-- Centre horizontally and vertically -------------------------------------------------------------
A:SetOffset(25, -40)
A:CentreH()
x, y = A:Offset()
check(x == 0 and y == -40, "Centre horizontally: x 0, y kept")
A:SetOffset(25, -40)
A:CentreV()
x, y = A:Offset()
check(x == 25 and y == 0, "Centre vertically: y 0, x kept")

-- the arrow keys ------------------------------------------------------------------------------------
A:SetOffset(0, 0)
check(P.OnKey("RIGHT") == false and select(1, A:Offset()) == 0, "nothing selected: an arrow goes to the game")
P.Select(A)
local keys
for _, f in ipairs(frames) do if f.name == "CowfeeRaidToolsPlacementKeys" then keys = f end end
check(keys and keys.shown and keys.keyboard == true and keys.propagate == true, "selected: the keys frame takes the keyboard, passing keys on")
check(P.OnKey("RIGHT") == true and select(1, A:Offset()) == 1, "right arrow: 1 px")
check(keys.propagate == false, "an arrow is kept from the game")
keys.scripts.OnKeyUp(keys, "RIGHT")
check(keys.propagate == true, "let through again once released")
shiftDown = true
P.OnKey("UP")
shiftDown = false
x, y = A:Offset()
check(x == 1 and y == 10, "Shift and up: 10 px")
P.OnKey("LEFT") P.OnKey("DOWN")
x, y = A:Offset()
check(x == 0 and y == 9, "left and down")
check(P.OnKey("W") == false and keys.propagate == true, "any other key goes on to the game (movement keys)")
inCombat = true
check(P.OnKey("RIGHT") == false and select(1, A:Offset()) == 0, "in combat an arrow moves nothing and goes to the game")
inCombat = false
P.Deselect()
check(not keys.shown and keys.keyboard == false and keys.propagate == true, "deselected: the keyboard is let go")
P.Select(A)
inCombat = true
for _, f in ipairs(frames) do if f.scripts.OnEvent and not f.name then f.scripts.OnEvent(f, "PLAYER_REGEN_DISABLED") end end
check(P.selected == nil and not keys.shown, "combat starting drops the selection and hides the keys frame")
P.Select(A)
check(P.selected == nil, "nothing is selected in combat")
inCombat = false
P.Select(A)
previews.placement(false)
check(P.selected == nil and not keys.shown, "Previews off let go of the keys")

-- dragging and snapping --------------------------------------------------------------------------
local function dragTo(e, f, cx, cy, shift)
  local fx, fy = centre(f)
  cursorX, cursorY = fx, fy
  e:BeginDrag()
  shiftDown = shift or false
  cursorX, cursorY = cx, cy
  e.handle.scripts.OnDragStop(e.handle)
  shiftDown = false
end
A:SetOffset(100, 100)
dragTo(A, fa, SCREEN_W / 2 + 4, SCREEN_H / 2 + 200)
x, y = A:Offset()
check(x == 0 and y == 200, "a drag snaps to the screen's centre line within 6 px: " .. x .. ", " .. y)
check(CRT.db.a.position.x == 0 and CRT.db.a.position.y == 200, "and is saved there")
A:SetOffset(100, 100)
dragTo(A, fa, SCREEN_W / 2 + 4, SCREEN_H / 2 + 200, true)
x = A:Offset()
check(x == 4, "with Shift it doesn't snap: " .. x)
A:SetOffset(100, 100)
dragTo(A, fa, SCREEN_W / 2 + 7, SCREEN_H / 2 + 200)
x = A:Offset()
check(x == 7, "7 px away it doesn't snap: " .. x)
-- an edge snaps too: the left edge onto the centre line
A:SetOffset(300, 100)
dragTo(A, fa, SCREEN_W / 2 + 100 + 5, SCREEN_H / 2 + 200)
x = A:Offset()
check(x == 100, "its edge snaps to a guide: " .. x)
check(P.selected == A, "a drag selects it")
inCombat = true
local before = { A:Offset() }
cursorX, cursorY = centre(fa)
A:BeginDrag()
check(P.Dragging() == nil and errorLines[#errorLines] == P.TEXT.combat, "no drag in combat, with a message")
inCombat = false
P.Deselect()

-- anchoring to another element ---------------------------------------------------------------------
local B = el("callout", CRT.db.b, { point = "CENTER", relativePoint = "CENTER", x = 3, y = 113 }, { title = "Note callout" })
local fb = make(B, 120, 30)
A:SetOffset(0, 300)
local bx0, by0 = centre(fb)
check(B:SetAnchor("texts") == true, "anchored to another element")
local bx1, by1 = centre(fb)
check(bx1 == bx0 and by1 == by0, "it stays where it was on the screen")
local _, rel = pt(fb)
check(rel == fa and CRT.db.b.position.anchor == "texts" and CRT.db.b.position.relativePoint == "CENTER", "held by the other element's frame, the anchor saved")
B:SetOffset(0, -40)
local ax, ay = centre(fa)
bx1, by1 = centre(fb)
check(bx1 == ax and by1 == ay - 40, "Y -40: 40 px under it")
x, y = B:Offset()
check(x == 0 and y == -40, "its X and Y are from the other element's centre")
dragTo(A, fa, SCREEN_W / 2 + 300, SCREEN_H / 2 + 100)
ax, ay = centre(fa)
bx1, by1 = centre(fb)
check(bx1 == ax and by1 == ay - 40, "dragging the anchor moves it along, the offset kept")
P.Select(A) P.OnKey("LEFT") P.Deselect()
ax, ay = centre(fa)
bx1, by1 = centre(fb)
check(bx1 == ax and by1 == ay - 40, "nudging the anchor moves it along")
A:Reset()
ax, ay = centre(fa)
bx1, by1 = centre(fb)
check(ax == SCREEN_W / 2 and ay == SCREEN_H / 2 + 300 and bx1 == ax and by1 == ay - 40, "resetting the anchor moves it along")
fa:Hide()
B:Apply()
bx1, by1 = centre(fb)
_, rel = pt(fb)
check(rel == fa and by1 == ay - 40, "a hidden anchor: it keeps its place on it")
fa:Show()
-- a snap guide on the anchor: its centre line
B:SetOffset(30, -40)
dragTo(B, fb, ax + 5, ay - 60)
x, y = B:Offset()
check(x == 0 and y == -60, "a drag snaps to its anchor's centre line: " .. x .. ", " .. y)

-- loops ------------------------------------------------------------------------------------------
check(A:CanAnchorTo("callout") == false, "the anchor can't be anchored back to it (a loop)")
check(A:SetAnchor("callout") == false and CRT.db.a.position == nil, "trying it changes nothing")
local C = el("pace", CRT.db.c, { point = "TOP", relativePoint = "TOP", x = 0, y = -260 }, { title = "Pace", point = "TOP" })
local fc = make(C, 200, 100)
check(C:SetAnchor("callout") == true and A:CanAnchorTo("pace") == false, "a longer loop is refused too")
P.OpenPanel(A)
local opts = dropdowns["Anchor to"].opts.options()
local byKey = {}
for _, o in ipairs(opts) do byKey[o.key] = o end
check(opts[1].key == "screen" and byKey.callout and byKey.callout.disabled and byKey.pace and byKey.pace.disabled, "the list greys out the choices that would loop")
check(byKey.texts == nil, "and leaves itself out")
P.ClosePanel()
C:SetAnchor(nil)
check(CRT.db.c.position.anchor == nil and select(2, pt(fc)) == UIParent, "back on the screen")
local cx0, cy0 = centre(fc)
check(C:Point() == "TOP" and select(1, pt(fc)) == "TOP", "held by its own point")
x, y = C:Offset()
check(x ~= nil, "a TOP-held element has an X and Y")
C:CentreH() C:CentreV()
local ccx, ccy = centre(fc)
check(ccx == SCREEN_W / 2 and ccy == SCREEN_H / 2, "a TOP-held element centres by its centre")

-- saved data that loops, or names an element that is gone, puts it at its default --------------------
CRT.db.a.position = { point = "CENTER", relativePoint = "CENTER", x = 5, y = 5, anchor = "callout" }
CRT.db.b.position = { point = "CENTER", relativePoint = "CENTER", x = 5, y = 5, anchor = "texts" }
A:Apply() B:Apply()
check(select(2, pt(fa)) == UIParent and select(5, pt(fa)) == 300 and select(2, pt(fb)) == UIParent and select(5, pt(fb)) == 113, "a saved loop: both at their defaults")
CRT.db.b.position = { point = "CENTER", relativePoint = "CENTER", x = 1, y = 2, anchor = "nothere" }
B:Apply()
check(select(2, pt(fb)) == UIParent and select(4, pt(fb)) == 3 and CRT.db.b.position.anchor == "nothere", "an anchor that is gone: its default, the saved place kept")
CRT.db.a.position = nil

-- Reset clears the anchor ------------------------------------------------------------------------
B:SetAnchor("texts")
B:Reset()
check(CRT.db.b.position == nil and select(2, pt(fb)) == UIParent and select(4, pt(fb)) == 3 and select(5, pt(fb)) == 113, "Reset: its default, on the screen")

-- an anchor not built yet is built; one that can't anchor, or can't be a target --------------------
local built = false
local D
D = el("breaktimer", CRT.db.d, { point = "TOP", relativePoint = "TOP", x = 0, y = -140 }, { title = "Break timer", point = "TOP",
  build = function() if not D.frame then built = true make(D, 300, 56) end end })
check(B:CanAnchorTo("breaktimer") == true and B:SetAnchor("breaktimer") == true and built and select(2, pt(fb)) == D.frame, "anchoring to one not shown yet builds it")
B:Reset()
local E = el("consumables", CRT.db.e, { point = "TOP", relativePoint = "TOP", x = 0, y = -200 }, { title = "Consumables", canAnchor = false, target = false })
make(E, 300, 40)
check(E:CanAnchorTo("texts") == false and E:SetAnchor("texts") == false, "an element that holds protected buttons stays on the screen")
check(B:CanAnchorTo("consumables") == false, "nothing anchors to an element that isn't a target")
-- an element anchored to one defined later is placed once that one has its frame
local F = el("later", CRT.db.f, { point = "CENTER", relativePoint = "CENTER", x = 0, y = 0 }, { title = "Later" })
CRT.db.b.position = { point = "CENTER", relativePoint = "CENTER", x = 0, y = -40, anchor = "later" }
B:Apply()
check(select(2, pt(fb)) == UIParent, "its anchor has no frame yet: at its default for now")
local ff = make(F, 50, 50)
check(select(2, pt(fb)) == ff, "placed on it once it is made")
B:Reset()

-- the gear ------------------------------------------------------------------------------------------
local opened = 0
local G = el("withsettings", {}, nil, { title = "With settings", settings = function() opened = opened + 1 end })
make(G)
G.gear.scripts.OnClick(G.gear)
local menu = menus[#menus]
check(menu and menu.items[1].label == "Placement" and menu.items[2].label == "Settings", "the gear: Placement and Settings")
menu.items[2].fn()
check(opened == 1, "Settings opens its settings")
A.gear.scripts.OnClick(A.gear)
menu = menus[#menus]
check(#menu.items == 1 and menu.items[1].label == "Placement", "without settings: Placement")
menu.items[1].fn()
local panel = P.Panel()
check(panel and panel.shown and P.PanelShows() == A and P.selected == A, "Placement opens the panel on it, selected")
local count = #menus
inCombat = true
A.gear.scripts.OnClick(A.gear)
check(#menus == count and errorLines[#errorLines] == P.TEXT.combat, "in combat the gear refuses, with a message")
P.ClosePanel()
check(P.OpenPanel(A) == false and not panel.shown, "the panel won't open in combat")
inCombat = false

-- the panel ---------------------------------------------------------------------------------------
A:SetOffset(0, 300)
P.OpenPanel(A)
check(panel.strip.title == "Placement: Critical alerts text", "titled with its name: " .. tostring(panel.strip.title))
check(panel.xBox.text == "0" and panel.yBox.text == "300", "the boxes show X and Y")
panel.xBox.text, panel.yBox.text = "-15", "250"
panel.xBox.scripts.OnEnterPressed(panel.xBox)
x, y = A:Offset()
check(x == -15 and y == 250, "Enter applies X and Y")
panel.xBox.text = "nonsense"
panel.xBox.scripts.OnEnterPressed(panel.xBox)
check(select(1, A:Offset()) == -15 and panel.xBox.text == "-15", "a box that isn't a number goes back")
panel.yBox.scripts.OnKeyDown(panel.yBox, "UP")
check(select(2, A:Offset()) == 251, "up in a box steps 1")
shiftDown = true
panel.yBox.scripts.OnKeyDown(panel.yBox, "DOWN")
shiftDown = false
check(select(2, A:Offset()) == 241, "Shift and down steps 10")
buttons["Centre horizontally"].scripts.OnClick()
check(select(1, A:Offset()) == 0, "the Centre horizontally button")
buttons["Centre vertically"].scripts.OnClick()
check(select(2, A:Offset()) == 0, "the Centre vertically button")
check(dropdowns["Anchor to"].opts.get() == "screen", "Anchor to: Screen by default")
P.OpenPanel(B)
dropdowns["Anchor to"].opts.set("texts")
check(CRT.db.b.position.anchor == "texts" and dropdowns["Anchor to"].opts.get() == "texts", "Anchor to sets the anchor")
dropdowns["Anchor to"].opts.set("screen")
check(CRT.db.b.position.anchor == nil, "and Screen clears it")
-- Select Anchor: a click on another element's box anchors to it; Escape cancels
buttons["Select Anchor"].scripts.OnClick()
check(P.picking == B and panel.picking.shown, "picking, with its line on the panel")
P.Click(C)
check(P.picking == nil and CRT.db.b.position.anchor == "pace", "a click on another element's box anchors to it")
buttons["Select Anchor"].scripts.OnClick()
P.OnKey("ESCAPE")
check(P.picking == nil and P.selected == B and panel.shown, "Escape cancels picking")
P.OnKey("ESCAPE")
check(P.selected == nil and not panel.shown, "Escape again lets go and closes the panel")
P.OpenPanel(B)
P.Click(A)
check(P.PanelShows() == A and P.selected == A and panel.strip.title == "Placement: Critical alerts text", "a click on another element's box moves the open panel to it")
P.OpenPanel(B)
buttons["Reset"].scripts.OnClick()
check(CRT.db.b.position == nil, "the panel's Reset")
buttons["Done"].scripts.OnClick()
check(not panel.shown and P.selected == nil and not keys.shown, "Done closes it and lets go of the keys")
P.OpenPanel(E)
check(dropdowns["Anchor to"].opts.enabledIf() == false and buttons["Select Anchor"].enabled == false, "no Anchor to for an element that stays on the screen")
P.ClosePanel()

-- only in Previews (or a page's own preview): a hidden drag box, or a window that is its own drag box outside
-- Previews (the ready check window during a real check), takes no click, drag or key -----------------------
local editing = false
local R = el("rcwindow", {}, { point = "TOP", relativePoint = "TOP", x = 0, y = -140 }, { title = "Ready check window", point = "TOP",
  editing = function() return editing end })
local fr = CreateFrame("Frame", nil, UIParent)
fr:SetSize(300, 100)
R:Attach(fr, fr, {})
fr.scripts.OnMouseUp(fr, "LeftButton")
check(P.selected == nil and not keys.shown, "a click on a window that is its own drag box, outside Previews, selects nothing")
check(P.OnKey("RIGHT") == false, "and the arrows go to the game")
local before0 = { centre(fr) }
cursorX, cursorY = centre(fr)
R:BeginDrag()
check(P.Dragging() == nil, "and it isn't dragged")
fr.scripts.OnDragStop(fr)
check(R:Saved() == nil, "nor saved")
check(P.OpenPanel(R) == false and not (P.Panel() and P.Panel().shown), "nor does its panel open")
editing = true
fr.scripts.OnMouseUp(fr, "LeftButton")
check(P.selected == R and keys.shown, "in Previews it is selected")
editing = false
check(P.OnKey("RIGHT") == false and P.selected == nil and not keys.shown, "Previews gone (its own preview flag off): the next arrow lets go")
-- a drag box that hides (a page's own preview stopping) lets go and closes the panel
P.OpenPanel(A)
check(P.selected == A and P.Panel().shown, "the panel open on it")
ha:Hide()
check(P.selected == nil and not P.Panel().shown and not keys.shown, "its drag box hiding lets go and closes the panel")
ha.scripts.OnMouseUp(ha, "LeftButton")
check(P.selected == nil, "a hidden drag box takes no click")
ha:Show()

-- anchoring to an element with no place yet doesn't jump: nothing changes ---------------------------------
local N = el("noplace", {}, nil, { title = "No place yet" })
local fn = CreateFrame("Frame", nil, UIParent)
N:Attach(fn, CreateFrame("Frame", nil, fn), {})
fn:ClearAllPoints()
B:SetOffset(10, 10)
local bx2, by2 = centre(fb)
check(B:SetAnchor("noplace") == false and CRT.db.b.position.anchor == nil, "an anchor with no place yet is refused")
local bx3, by3 = centre(fb)
check(bx3 == bx2 and by3 == by2, "and it stays where it was")
N:Apply()

-- Reset in combat is refused --------------------------------------------------------------------------
A:SetOffset(40, 40)
inCombat = true
A:Reset()
check(CRT.db.a.position ~= nil and select(1, A:Offset()) == 40 and errorLines[#errorLines] == P.TEXT.combat, "Reset in combat is refused, with a message")
inCombat = false

-- combat cutting a drag puts it back where it was saved ------------------------------------------------
A:SetOffset(40, 40)
cursorX, cursorY = centre(fa)
A:BeginDrag()
cursorX = cursorX + 200
P.DragStep(false)
check(select(1, A:Offset()) == 240, "mid-drag it follows the cursor")
for _, f in ipairs(frames) do if f.scripts.OnEvent and not f.name then f.scripts.OnEvent(f, "PLAYER_REGEN_DISABLED") end end
check(P.Dragging() == nil and select(1, A:Offset()) == 40, "combat starting ends the drag and puts it back at its saved place")

-- an anchor that changes the point it is held by: the anchored one keeps its spot --------------------------
local corner = "TOPLEFT"
local K = el("corner", {}, { point = "TOPLEFT", relativePoint = "CENTER", x = -100, y = 0 }, { title = "Corner", point = function() return corner end })
local fk = make(K, 200, 50)
B:SetAnchor("corner")
local bx4, by4 = centre(fb)
check(CRT.db.b.position.relativePoint == "TOPLEFT", "anchored from the anchor's corner")
corner = "TOPRIGHT"
K:Apply() -- its Grow changed: held by its other corner now, at the same spot (keepPoint is the debuff panel's)
B:Apply()
local bx5, by5 = centre(fb)
check(CRT.db.b.position.relativePoint == "TOPRIGHT" and bx5 == bx4 and by5 == by4, "the anchored one follows the anchor's new corner and keeps its spot: " .. bx5 .. " vs " .. bx4)
B:Reset()

-- a box's up and down step only that box, never the other box's half-typed text ---------------------------
A:SetOffset(0, 0)
P.OpenPanel(A)
panel.yBox.text = "1-"
panel.xBox.scripts.OnKeyDown(panel.xBox, "UP")
x, y = A:Offset()
check(x == 1 and y == 0, "up in X moves X only: " .. x .. ", " .. y)
P.ClosePanel()

-- a drag box over a narrow frame is still wide enough for its title, the gear and Reset, and follows the frame's width
do
  local f = CreateFrame("Frame", nil, UIParent) f:SetSize(60, 20) f:SetPoint("CENTER")
  local h = CreateFrame("Frame", nil, f)
  local t = h:CreateFontString() t:SetText("Debuffs: drag to move")
  P.FitHandle(h, f, t)
  local need = #"Debuffs: drag to move" * 6 + 2 * (6 + P.GEAR_SIZE + P.GEAR_GAP + 44 + 2)
  check(h.w >= need and h.pts[1].point == "BOTTOMLEFT" and h.pts[1].rel == f, "a narrow frame's drag box fits its title, the gear and Reset: " .. h.w)
  f:SetSize(600, 20) h.crtFit.frame = f
  P.FitHandle(h, f, t)
  check(h.w == 600, "and is as wide as a wide frame")
end

-- anchoring to any named frame on screen (a unit frame from any addon) ------------------------------------
local T = P.TEXT
local Q = el("qpanel", {}, { point = "TOPLEFT", relativePoint = "CENTER", x = -100, y = -200 }, { title = "Q panel", point = "TOPLEFT" })
local fq, hq = make(Q, 160, 40)
-- a unit frame: named, protected, with an anonymous bar and a text on it
local unit = CreateFrame("Button", "TestUnitFrame", UIParent)
unit:SetSize(200, 60) unit:SetPoint("CENTER", UIParent, "CENTER", -300, -250) unit.protected = true
local bar = CreateFrame("StatusBar", nil, unit) bar:SetSize(180, 20) bar:SetPoint("CENTER", unit, "CENTER")
local barText = bar:CreateFontString()
local fr0, name0, own0 = P.ResolveFocus(barText)
check(fr0 == unit and name0 == "TestUnitFrame" and not own0, "the nearest named frame up from the hovered region: " .. tostring(name0))
local notGlobal = CreateFrame("Frame", nil, unit) notGlobal.name = "NotItsGlobal"
check(select(2, P.ResolveFocus(notGlobal)) == "TestUnitFrame", "a name that isn't its own global is passed over")
local anon = CreateFrame("Frame", nil, UIParent) anon:SetSize(50, 50) anon:SetPoint("CENTER", UIParent, "CENTER", 400, 0)
local anonChild = CreateFrame("Frame", nil, anon)
local fr1, name1, own1 = P.ResolveFocus(anonChild)
check(fr1 == nil and name1 == nil and not own1, "no named frame below the screen itself: none (UIParent is never picked)")
check(select(3, P.ResolveFocus(ha)) == true and select(3, P.ResolveFocus(fa)) == true, "a CRT element's box and frame are CRT's own")
check(P.ResolveFocus(WorldFrame) == nil, "the world is never picked")
-- what can be anchored to
check(Q:CanAnchorTo("frame:TestUnitFrame") == true, "any named frame can be anchored to")
local qx, qy = centre(fq)
local ok, msg = P.AnchorToName(Q, "TestUnitFrame")
local qs = Q:Saved()
check(ok == true and qs.anchor == "frame:TestUnitFrame" and select(2, pt(fq)) == unit, "a typed name anchors to that frame, saved as frame:<name>: " .. tostring(msg))
local qx1, qy1 = centre(fq)
check(qx1 == qx and qy1 == qy, "it stays where it was on the screen")
check(type(qs.screenX) == "number" and type(qs.screenY) == "number", "and its spot on the screen is kept, for when that frame isn't loaded")
unit:ClearAllPoints() unit:SetPoint("CENTER", UIParent, "CENTER", -200, -100)
local qx2, qy2 = centre(fq)
check(qx2 == qx + 100 and qy2 == qy + 150, "it follows the frame when that one moves")
Q:SetOffset(0, 60)
local ux, uy = centre(unit)
qx2, qy2 = centre(fq)
check(qx2 == ux and qy2 == uy + 60, "X and Y are from that frame's centre")
-- typed names that are refused, with a message, the anchor unchanged
local function refused(name, want, what)
  local okR, m = P.AnchorToName(Q, name)
  check(okR == false and m == want and Q:Saved().anchor == "frame:TestUnitFrame", what .. ": " .. tostring(m))
end
refused("NoSuchFrame", format(T.missing, "NoSuchFrame"), "a name no frame has")
refused("Player Frame!", format(T.missing, "Player Frame!"), "a name that can't be a frame's")
refused("UIParent", T.fullScreen, "the screen itself")
refused("WorldFrame", T.fullScreen, "the world frame")
local big = CreateFrame("Frame", "TestBigOverlay", UIParent) big:SetSize(SCREEN_W, SCREEN_H) big:SetPoint("CENTER")
refused("TestBigOverlay", T.fullScreen, "a frame that fills the screen")
local forb = CreateFrame("Frame", "TestForbidden", UIParent) forb:SetSize(10, 10) forb:SetPoint("CENTER") forb.forbidden = true
refused("TestForbidden", T.forbidden, "a forbidden frame")
local plate = CreateFrame("Frame", "TestPlate", UIParent) plate:SetSize(10, 10) plate:SetPoint("CENTER") plate.anchorRestricted = true
refused("TestPlate", T.forbidden, "an anchor-restricted frame (a nameplate)")
refused("CowfeeRaidToolsPlacementKeys", T.own, "one of CRT's own frames")
local crtNamed = CreateFrame("Frame", "CRTWhatsNewTest", UIParent) crtNamed:SetSize(30, 30) crtNamed:SetPoint("CENTER")
refused("CRTWhatsNewTest", T.own, "one of CRT's own frames named CRT...")
local nowhere = CreateFrame("Frame", "TestNowhere", UIParent)
refused("TestNowhere", T.nowhere, "a frame with no place on screen")
-- loops through other frames' anchors, read from their points
local loop1 = CreateFrame("Frame", "TestLoop1", UIParent) loop1:SetSize(20, 20) loop1:SetPoint("TOP", fq, "BOTTOM")
local loop2 = CreateFrame("Frame", "TestLoop2", UIParent) loop2:SetSize(20, 20) loop2:SetPoint("TOP", loop1, "BOTTOM")
refused("TestLoop1", T.loop, "a frame anchored to this one")
refused("TestLoop2", T.loop, "a frame anchored to this one through another")
local onA = CreateFrame("Frame", "TestOnA", UIParent) onA:SetSize(20, 20) onA:SetPoint("TOP", fa, "BOTTOM")
check(B:SetAnchor("frame:TestOnA") == true, "anchored to a frame that is anchored to another element")
check(A:CanAnchorTo("callout") == false, "that element can't anchor back to it (a loop through the other frame)")
B:Reset()
-- an element holding the game's protected buttons stays on the screen
check(E:CanAnchorTo("frame:TestUnitFrame") == false, "the consumables bar can't anchor to a frame")
-- a frame that is protected itself may only anchor to a protected frame, so it never spreads protection to one
local plain = CreateFrame("Frame", "TestPlainFrame", UIParent) plain:SetSize(80, 30) plain:SetPoint("CENTER", UIParent, "CENTER", 0, -300)
fq.protected = true
refused("TestPlainFrame", T.spread, "a protected element to a frame that isn't protected")
check(Q:CanAnchorTo("frame:TestUnitFrame") == true, "a protected element to a protected unit frame is fine")
-- the same rule for CRT's own elements: a protected element can't make an alert area protected
check(Q:CanAnchorTo("texts") == false and Q:AnchorProblem("texts") == T.spread, "a protected element can't anchor to a CRT element that isn't protected")
check(Q:SetAnchor("texts") == false and Q:Saved().anchor == "frame:TestUnitFrame", "trying it changes nothing")
P.OpenPanel(Q)
local byKeyP = {}
for _, o in ipairs(dropdowns["Anchor to"].opts.options()) do byKeyP[o.key] = o end
check(byKeyP.texts and byKeyP.texts.disabled, "the list greys it out")
P.ClosePanel()
fa.protected = true
check(Q:CanAnchorTo("texts") == true, "to a protected element it may")
fa.protected = nil
fq.protected = nil
check(Q:CanAnchorTo("frame:TestPlainFrame") == true and Q:CanAnchorTo("texts") == true, "an element that isn't protected may anchor to any frame or element")
-- an anchor the game refuses at SetPoint (an anchor family it keeps apart): it stays on the screen, with a message
local refuser = CreateFrame("Frame", "TestRefuser", UIParent) refuser:SetSize(40, 40) refuser:SetPoint("CENTER", UIParent, "CENTER", 200, 200)
refuser.refuseAnchors = true
local qxr, qyr = centre(fq)
local okR, whyR = P.AnchorToName(Q, "TestRefuser")
check(okR == false and whyR == T.forbidden, "a frame the game won't let it anchor to is refused: " .. tostring(whyR))
check(select(2, pt(fq)) == unit and Q:Saved().anchor == "frame:TestUnitFrame", "and it keeps its anchor and place")
-- the same, met on a saved anchor: on its screen spot, the anchor kept, and the panel says it can't be used
Q.spec.store().position = { point = "TOPLEFT", relativePoint = "TOPLEFT", x = 0, y = 0, anchor = "frame:TestRefuser", screenX = 120, screenY = -80 }
Q.refused = nil
Q:Apply()
check(select(2, pt(fq)) == UIParent and select(4, pt(fq)) == 120 and Q:Saved().anchor == "frame:TestRefuser", "a saved anchor the game refuses: on the screen spot, the anchor kept")
check(Q:AnchorStatus() == format(T.cantUse, "TestRefuser"), "and it can't be used now: " .. tostring(Q:AnchorStatus()))
Q:Reset()
P.AnchorToName(Q, "TestUnitFrame")

-- the panel: the Anchor to list, the frame name box and Select Anchor -----------------------------------------
P.OpenPanel(Q)
local list = dropdowns["Anchor to"].opts.options()
local hasUnit
for _, o in ipairs(list) do if o.key == "frame:TestUnitFrame" then hasUnit = o end end
check(hasUnit and hasUnit.label == "TestUnitFrame" and dropdowns["Anchor to"].opts.get() == "frame:TestUnitFrame", "the list holds the frame it is anchored to, chosen")
check(dropdowns["Anchor to"].opts.enabledIf() == true, "Anchor to is open for it")
panel.frameBox.text = "NoSuchFrame"
panel.frameBox.scripts.OnEnterPressed(panel.frameBox)
check(panel.status.shown and panel.status.text == format(T.missing, "NoSuchFrame") and Q:Saved().anchor == "frame:TestUnitFrame", "a wrong name in the box is refused, with a message")
panel.frameBox.text = "TestPlainFrame"
panel.frameBox.scripts.OnEnterPressed(panel.frameBox)
check(Q:Saved().anchor == "frame:TestPlainFrame" and select(2, pt(fq)) == plain, "a name in the box and Enter anchors to it")
dropdowns["Anchor to"].opts.set("screen")
check(Q:Saved().anchor == nil and select(2, pt(fq)) == UIParent, "Screen takes it back off")
-- Select Anchor: the screen dims under a click-catching overlay, the frame under the cursor is found by a hit test
-- (not the mouse focus, which is the overlay), outlined and named at the cursor; a left click selects it and never
-- reaches it (no target, no cast, no press), a right click or Escape cancels, Enter and Space still select
local SEL = buttons["Select Anchor"]
check(SEL and buttons["Pick on screen"] == nil, "the button is called Select Anchor")
check(SEL.height > buttons["Anchor"].height and SEL.pts[1].y > dropdowns["Anchor to"].pts[1].y, "Select Anchor is the main control: larger, and above Anchor to")
check(panel.frameHelp.tip:find("Select Anchor", 1, true) ~= nil, "the Frame name help points to Select Anchor")
local unitDowns, unitClicks = 0, 0
unit:EnableMouse(true)
unit.scripts.OnMouseDown = function() unitDowns = unitDowns + 1 end
unit.scripts.OnClick = function() unitClicks = unitClicks + 1 end
-- its bar and a part of the bar take hovering only (clicks go on to the unit frame), as the game's often do
bar:SetMouseMotionEnabled(true) bar:SetFrameLevel(2)
local deep = CreateFrame("Frame", nil, bar) deep:SetSize(20, 10) deep:SetPoint("CENTER", bar, "CENTER") deep:SetMouseMotionEnabled(true) deep:SetFrameLevel(2)
-- over it: a frame that takes no mouse, a hidden one, and one in a lower strata with a higher level, all passed over
local cover = CreateFrame("Frame", "TestCoverPlain", UIParent) cover:SetSize(300, 100) cover:SetPoint("CENTER", unit, "CENTER") cover:SetFrameStrata("HIGH")
local hiddenOver = CreateFrame("Frame", "TestHiddenOver", UIParent) hiddenOver:SetSize(50, 50) hiddenOver:SetPoint("CENTER", unit, "CENTER")
hiddenOver:EnableMouse(true) hiddenOver:SetFrameStrata("DIALOG") hiddenOver:Hide()
local lowHigh = CreateFrame("Frame", "TestLowHigh", UIParent) lowHigh:SetSize(50, 50) lowHigh:SetPoint("CENTER", unit, "CENTER")
lowHigh:EnableMouse(true) lowHigh:SetFrameStrata("LOW") lowHigh:SetFrameLevel(50)
-- a mouse-enabled window in front of the unit frame's right end
local over = CreateFrame("Frame", "TestDialogOver", UIParent) over:SetSize(30, 30) over:SetPoint("CENTER", unit, "CENTER", 80, 0)
over:EnableMouse(true) over:SetFrameStrata("DIALOG")
WorldFrame:EnableMouse(true) WorldFrame:SetFrameStrata("WORLD")
local ux0, uy0 = centre(unit)
cursorX, cursorY = ux0, uy0
SEL.scripts.OnClick()
local ov = P.pickOverlay
check(P.picking == Q and keys.shown, "selecting takes the keys, as the arrows do")
check(ov and ov.shown and ov.click == true and (ov.strata == "FULLSCREEN_DIALOG" or ov.strata == "TOOLTIP"), "a click-catching overlay on top of everything: " .. tostring(ov and ov.strata))
check(ov.w == SCREEN_W and ov.h == SCREEN_H and ov.dim ~= nil, "it covers the whole screen and dims it")
check(P.pickTag and P.pickTag.shown and P.pickTag.text.text == "TestUnitFrame", "the frame under the cursor is named at the cursor (through its unnamed children): " .. tostring(P.pickTag and P.pickTag.text.text))
local bx, by, bw, bh = rect(P.pickBox)
check(P.pickBox.shown and bx == ux0 and by == uy0 and bw >= 200 and bh >= 60, "and outlined: " .. tostring(bx) .. ", " .. tostring(by) .. " " .. tostring(bw))
check(P.pickBox.strata == "TOOLTIP" and (P.pickBox.level or 1) > (ov.level or 1) and (P.pickTag.level or 1) > (ov.level or 1), "the outline and the name show above the dimming")
cursorX = ux0 + 80
P.PickHover()
check(P.pickTag.text.text == "TestDialogOver", "a window in front of it wins (higher strata)")
cursorX = ux0
P.PickHover()
check(P.pickTag.text.text == "TestUnitFrame", "back on the unit frame")
-- the click: the overlay takes it, the unit frame hears nothing
local got = clickAt("LeftButton")
check(got == ov and unitDowns == 0 and unitClicks == 0, "a left click goes to the overlay, never to the frame under it")
check(P.picking == nil and Q:Saved().anchor == "frame:TestUnitFrame" and select(2, pt(fq)) == unit, "and selects it: anchored")
check(not ov.shown and not P.pickTag.shown and not P.pickBox.shown, "the overlay, the name and the outline go")
check(clickAt("LeftButton") == unit and unitClicks == 1, "(after selecting, a click reaches the unit frame again)")
unitDowns, unitClicks = 0, 0
-- Enter and Space still select
SEL.scripts.OnClick()
cursorX = ux0 + 80
P.PickHover()
check(P.OnKey("W") == false and keys.propagate == true, "any other key goes on to the game while selecting")
check(P.OnKey("ENTER") == true and keys.propagate == false, "Enter is taken from the game")
keys.scripts.OnKeyUp(keys, "ENTER")
check(P.picking == nil and Q:Saved().anchor == "frame:TestDialogOver", "Enter selects the frame under the cursor")
-- refused: nothing selected, a message, selecting goes on
SEL.scripts.OnClick()
anonChild:SetSize(20, 20) anonChild:SetPoint("CENTER", anon, "CENTER") anonChild:EnableMouse(true)
P.ForgetHits()
cursorX, cursorY = centre(anon)
P.PickHover()
check(P.pickTag.text.text == T.noName and not P.pickBox.shown, "a frame with no name says so, with no outline")
clickAt("LeftButton")
check(P.picking == Q and ov.shown and panel.status.text == T.noName and Q:Saved().anchor == "frame:TestDialogOver", "a click on it is refused, with that message, and selecting goes on")
P.OnKey("SPACE")
check(P.picking == Q and panel.status.text == T.noName, "Space on it too")
cursorX, cursorY = 100, 1000
P.PickHover()
check(P.pickTag.text.text == T.nothing, "over the world: nothing to anchor to")
clickAt("LeftButton")
check(P.picking == Q and panel.status.text == T.nothing, "a click there says so and selecting goes on")
local function refusedAt(f, want, what)
  f:EnableMouse(true)
  P.ForgetHits()
  cursorX, cursorY = centre(f)
  clickAt("LeftButton")
  check(P.picking == Q and panel.status.text == want and Q:Saved().anchor == "frame:TestDialogOver", what .. ": " .. tostring(panel.status.text))
  check(P.pickTag.shown and P.pickTag.text.text == want, what .. ": the reason shows at the cursor")
end
refusedAt(loop1, T.loop, "a frame anchored to this one")
plate:SetFrameLevel(5)
refusedAt(plate, T.forbidden, "a frame the game keeps from addons (a nameplate)")
fq.protected = true
refusedAt(plain, T.spread, "a protected element to a frame that isn't protected")
fq.protected = nil
crtNamed:EnableMouse(true)
P.ForgetHits()
cursorX, cursorY = centre(crtNamed)
cursorX = cursorX + 12
P.PickHover()
check(not P.pickTag.shown, "over CRT's own frames: no name")
clickAt("LeftButton")
check(P.picking == Q and panel.status.text == T.own, "a click there is refused")
-- CRT's elements: its own box shows nothing, another's selects that element
hq:SetSize(160, 16) hq:SetPoint("BOTTOM", fq, "TOP")
ha:SetSize(200, 16) ha:SetPoint("BOTTOM", fa, "TOP")
P.ForgetHits()
cursorX, cursorY = centre(hq)
P.PickHover()
check(not P.pickTag.shown and not P.pickBox.shown, "over its own box: no name, no outline")
cursorX, cursorY = centre(ha)
P.PickHover()
check(P.pickTag.shown and P.pickTag.text.text == "Critical alerts text" and P.pickBox.shown, "over another element's box: that element's name, outlined")
clickAt("LeftButton")
check(P.picking == nil and Q:Saved().anchor == "texts", "a click selects that element")
-- cancelling: a right click or Escape, nothing changed
SEL.scripts.OnClick()
cursorX, cursorY = ux0, uy0
P.PickHover()
check(clickAt("RightButton") == ov and unitDowns == 0 and unitClicks == 0, "a right click goes to the overlay too")
check(P.picking == nil and not ov.shown and Q:Saved().anchor == "texts", "and cancels: nothing changed")
SEL.scripts.OnClick()
P.OnKey("ESCAPE")
check(P.picking == nil and not ov.shown and not P.pickTag.shown and not P.pickBox.shown and Q:Saved().anchor == "texts", "Escape cancels")
-- the hit test is cheap: the frames are gone through once, again only after a while
local before2 = enumerated
SEL.scripts.OnClick()
for i = 1, 5 do cursorX = ux0 + i P.PickHover() end
check(enumerated - before2 == 1, "moving over the screen goes through the frames once: " .. (enumerated - before2))
clock = clock + 5
P.PickHover()
check(enumerated - before2 == 1, "a still cursor reads nothing again")
cursorX = ux0
P.PickHover()
check(enumerated - before2 == 2, "a move after a while reads them again, for frames shown since: " .. (enumerated - before2))
P.OnKey("ESCAPE")
-- combat: refused, and combat starting cancels it
SEL.scripts.OnClick()
P.Click(B)
check(P.picking == nil and Q:Saved().anchor == "callout", "a click on another element's box still anchors to it")
SEL.scripts.OnClick()
inCombat = true
check(P.OnKey("ENTER") == false and P.picking == Q, "in combat Enter goes to the game")
ov.scripts.OnUpdate(ov, 1)
check(P.picking == nil and not ov.shown, "in combat the overlay goes at once, even before the combat event")
inCombat = false
SEL.scripts.OnClick()
inCombat = true
fire("PLAYER_REGEN_DISABLED")
check(P.picking == nil and not ov.shown and not P.pickTag.shown and not P.pickBox.shown, "combat starting cancels selecting")
inCombat = false
P.OpenPanel(Q)
inCombat = true
local errs = #errorLines
SEL.scripts.OnClick()
check(P.picking == nil and #errorLines == errs + 1 and errorLines[#errorLines] == P.TEXT.combat and not ov.shown, "Select Anchor is refused in combat")
inCombat = false
SEL.scripts.OnClick()
dropdowns["Anchor to"].opts.set("screen")
check(P.picking == nil and Q:Saved().anchor == nil and not ov.shown, "a choice from the Anchor to list ends selecting")
P.ClosePanel()
Q:Reset()

-- late-loading frames: kept on its spot, tried again, anchored once the frame is there -------------------------
local qstore = Q.spec.store()
qstore.position = { point = "TOPLEFT", relativePoint = "TOPLEFT", x = 5, y = 5, anchor = "frame:TestLateFrame", screenX = 300, screenY = -200 }
runTimers()
local ever0 = timersEver
Q:Apply()
local pq, rq, rpq, xq, yq = pt(fq)
check(rq == UIParent and pq == "TOPLEFT" and rpq == "TOPLEFT" and xq == 300 and yq == -200, "its frame isn't loaded: it stays at its saved spot on the screen")
check(#timers > 0, "and it is tried again on a timer")
P.OpenPanel(Q)
check(panel.status.shown and panel.status.text == format(T.notLoaded, "TestLateFrame"), "the panel says the frame isn't loaded: " .. tostring(panel.status.text))
check(dropdowns["Anchor to"].opts.get() == "frame:TestLateFrame", "the list still shows that anchor")
P.ClosePanel()
local late = CreateFrame("Frame", "TestLateFrame", UIParent) late:SetSize(100, 30) late:SetPoint("CENTER", UIParent, "CENTER", 0, 200)
fire("PLAYER_ENTERING_WORLD")
check(select(2, pt(fq)) == late and Q:Saved().anchor == "frame:TestLateFrame", "once it is made it is anchored to it (PLAYER_ENTERING_WORLD)")
-- a frame that exists but has no place yet (its addon places it later): looked for again too
runTimers()
qstore.position = { point = "TOPLEFT", relativePoint = "TOPLEFT", x = 5, y = 5, anchor = "frame:TestPlacedLater", screenX = 300, screenY = -200 }
local placedLater = CreateFrame("Frame", "TestPlacedLater", UIParent) placedLater:SetSize(100, 30)
Q:Apply()
check(Q.waiting == "TestPlacedLater" and select(2, pt(fq)) == UIParent, "a frame with no place yet: waited for, on the screen spot")
placedLater:SetPoint("CENTER", UIParent, "CENTER", 0, -100)
fire("PLAYER_ENTERING_WORLD")
check(select(2, pt(fq)) == placedLater, "once it has a place it is anchored to it")
-- a frame that never loads: the retries stop, it stays on its spot and keeps the anchor
qstore.position = { point = "TOPLEFT", relativePoint = "TOPLEFT", x = 5, y = 5, anchor = "frame:TestNeverFrame", screenX = 250, screenY = -150 }
runTimers()
ever0 = timersEver
Q:Apply()
fire("PLAYER_LOGIN")
fire("PLAYER_ENTERING_WORLD")
runTimers()
Q:Apply()
runTimers()
check(timersEver - ever0 <= P.MAX_RETRIES and #timers == 0, "the retries are capped: " .. (timersEver - ever0))
check(select(2, pt(fq)) == UIParent and select(4, pt(fq)) == 250 and Q:Saved().anchor == "frame:TestNeverFrame", "it never loads: it stays where it was, the anchor kept")
-- a saved anchor with no screen spot (made elsewhere): its default
qstore.position = { point = "TOPLEFT", relativePoint = "TOPLEFT", x = 5, y = 5, anchor = "frame:TestNeverFrame" }
Q:Apply()
check(select(2, pt(fq)) == UIParent and select(4, pt(fq)) == -100 and select(5, pt(fq)) == -200, "no spot kept: its default")
Q:Reset()

-- combat: nothing anchored to another frame is moved in combat, it waits for combat to end ----------------------
P.AnchorToName(Q, "TestUnitFrame")
B:SetAnchor("qpanel")
inCombat = true
local before1, beforeB = fq.layoutCalls, fb.layoutCalls
Q:Apply() B:Apply()
check(fq.layoutCalls == before1 and fb.layoutCalls == beforeB, "in combat it isn't placed again (no SetPoint or ClearAllPoints), nor what is anchored to it")
inCombat = false
fire("PLAYER_REGEN_ENABLED")
check(fq.layoutCalls > before1 and fb.layoutCalls > beforeB and select(2, pt(fq)) == unit, "after combat it is placed")
B:Reset() Q:Reset()

-- the lint: every movable element is placed by the helper ---------------------------------------------
for _, e in ipairs(ELEMENTS) do
  local file, key = e[1], e[2]
  local src = MODULES[file]
  check(src ~= nil, file .. ": found")
  if src then
    check(src:find("Placement.Define(", 1, true) ~= nil, file .. ": defines its element with UI.Placement.Define")
    check(src:find('"' .. key, 1, true) ~= nil, file .. ": its key " .. key)
    check(src:find("StartMoving", 1, true) == nil and src:find("StopMovingOrSizing", 1, true) == nil, file .. ": no drag code of its own (the helper drags it)")
    check(src:find("%.position = {") == nil and src:find("SavePosition%(") == nil, file .. ": no position save of its own (the helper saves it)")
  end
end
-- the debuff panel may be anchored (to an element or a unit frame); the consumables bar holds protected buttons
-- and stays on the screen
do
  local deb, con = MODULES["CRT_Modules/Debuffs/Panel.lua"] or "", MODULES["CRT_Modules/Consumables/Display.lua"] or ""
  check(not deb:find("canAnchor%s*=%s*false"), "the debuff panel can be anchored")
  check(con:find("canAnchor%s*=%s*false") ~= nil and con:find("target%s*=%s*false") ~= nil, "the consumables bar stays on the screen, and nothing anchors to it")
end
-- a drag box's title is a string ending ": drag to move" (a help text that mentions dragging is not one)
-- a Reset button means a movable element too, whatever its drag box is called; the windows that keep their own
-- drag (decided 2026-10-25: the note windows and the alert editor) are listed
local OWN_DRAG = { ["CRT_Modules/Notes/Window.lua"] = true, ["CRT_Modules/Alerts/Editor.lua"] = true }
for file, src in pairs(MODULES) do
  if src:find("ResetButton(", 1, true) and not OWN_DRAG[file] then
    check(src:find("Placement.Define(", 1, true) ~= nil, file .. " has a Reset button: it must be placed by UI.Placement")
  end
end
for file, src in pairs(MODULES) do
  if src:find(': drag to move"', 1, true) then
    check(src:find("Placement.Define(", 1, true) ~= nil, file .. " has a drag box: it must be placed by UI.Placement")
  end
end

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error(fails .. " placement checks failed") end
`;

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out); else if (name.endsWith('.lua')) out.push(p);
  }
  return out;
}

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_newtable(L);
lua.lua_pushstring(L, to_luastring(read('CRT_Core/UI/Placement.lua'))); lua.lua_setfield(L, -2, to_luastring('placement'));
lua.lua_pushstring(L, to_luastring(read('CRT_Core/UI/PlacementPanel.lua'))); lua.lua_setfield(L, -2, to_luastring('panel'));
lua.lua_pushstring(L, to_luastring(read('CRT_Core/UI/PlacementSelect.lua'))); lua.lua_setfield(L, -2, to_luastring('select'));
lua.lua_newtable(L);
ELEMENTS.forEach(([file, key], i) => {
  lua.lua_newtable(L);
  lua.lua_pushstring(L, to_luastring(file)); lua.lua_rawseti(L, -2, 1);
  lua.lua_pushstring(L, to_luastring(key)); lua.lua_rawseti(L, -2, 2);
  lua.lua_rawseti(L, -2, i + 1);
});
lua.lua_newtable(L);
for (const p of walk(path.join(root, 'CRT_Modules'), [])) {
  const rel = path.relative(root, p).split(path.sep).join('/');
  lua.lua_pushstring(L, to_luastring(fs.readFileSync(p, 'utf8')));
  lua.lua_setfield(L, -2, to_luastring(rel));
}
if (lua.lua_pcall(L, 3, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
console.log('ok placement: X and Y, centring, nudging, snapping, anchoring and following, loops, reset, combat, and every movable element on the helper');
