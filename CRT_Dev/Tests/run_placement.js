// CRT_Core/UI/Placement.lua and CRT_Core/UI/PlacementPanel.lua: the one helper every movable CRT element is placed by.
// On mock frames that work out where they are from their anchors (as the game does): old saved places load unchanged;
// X and Y apply and stay on the screen; Centre horizontally and vertically; the arrow keys nudge 1 and Shift 10 px
// and only while selected and out of combat; a drag snaps within 6 px and not with Shift; an element anchored to
// another keeps its offset and follows it (a move, a nudge, a reset, and while it is hidden); a loop can't be made;
// Reset clears the anchor; the gear and the panel refuse in combat. Then a lint: every movable element in the
// modules is placed by the helper, with none of its own drag or save code.
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
local propagate = {}
local function mock(kind, parent, template, name)
  local m = { kind = kind, parent = parent, template = template, name = name, shown = true, pts = {}, w = 0, h = 0, text = "", scripts = {}, hooks = {} }
  frames[#frames + 1] = m
  local methods = {
    SetPoint = function(self, point, rel, rp, x, y)
      if type(rel) == "number" then rel, rp, x, y = nil, nil, rel, rp end
      if type(rp) == "number" then rp, x, y = nil, rp, x end
      table.insert(self.pts, { point = point, rel = rel or self.parent or UIParent, rp = rp or point, x = x or 0, y = y or 0 })
    end,
    ClearAllPoints = function(self) self.pts = {} end,
    GetPoint = function(self) local p = self.pts[1] if p then return p.point, p.rel, p.rp, p.x, p.y end end,
    GetCenter = function(self) local cx, cy = rect(self) return cx, cy end,
    SetSize = function(self, w, h) self.w, self.h = w, h end,
    SetWidth = function(self, w) self.w = w end, SetHeight = function(self, h) self.h = h end,
    GetWidth = function(self) return self.w end, GetHeight = function(self) return self.h end,
    Show = function(self) if not self.shown then self.shown = true local s = self.scripts.OnShow if s then s(self) end end end,
    Hide = function(self) if self.shown then self.shown = false local s = self.scripts.OnHide if s then s(self) end end end,
    SetShown = function(self, on) if on then self:Show() else self:Hide() end end,
    IsShown = function(self) return self.shown end,
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
    GetFrameLevel = function() return 1 end,
  }
  return setmetatable(m, { __index = function(_, k)
    if methods[k] then return methods[k] end
    if type(k) == "string" and k:find("^%u") then return function() end end
  end })
end
UIParent = mock("Frame")
UIParent:SetSize(SCREEN_W, SCREEN_H)
function CreateFrame(kind, name, parent, template) return mock(kind, parent, template, name) end
function InCombatLockdown() return inCombat end
function IsShiftKeyDown() return shiftDown end
local cursorX, cursorY = 0, 0
function GetCursorPosition() return cursorX, cursorY end
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
function UI.PanelButton(parent, label, h, onClick) local b = mock("Button", parent) b.label = label b.scripts.OnClick = onClick buttons[label] = b return b end
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
local P = UI.Placement
check(P and type(P.Define) == "function" and type(P.OpenPanel) == "function", "the helper and its panel load")

local function el(key, store, default, opts)
  opts = opts or {}
  local spec = { title = opts.title or key, store = function() return store end, default = default, point = opts.point,
    build = opts.build, settings = opts.settings, canAnchor = opts.canAnchor, target = opts.target }
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
-- Pick on screen: the next click on another element's box anchors to it; Escape cancels
buttons["Pick on screen"].scripts.OnClick()
check(P.picking == B and panel.picking.shown, "picking, with its line on the panel")
P.Click(C)
check(P.picking == nil and CRT.db.b.position.anchor == "pace", "a click on another element's box anchors to it")
buttons["Pick on screen"].scripts.OnClick()
P.OnKey("ESCAPE")
check(P.picking == nil and P.selected == B and panel.shown, "Escape cancels picking")
P.OnKey("ESCAPE")
check(P.selected == nil and not panel.shown, "Escape again lets go and closes the panel")
P.OpenPanel(B)
buttons["Reset"].scripts.OnClick()
check(CRT.db.b.position == nil, "the panel's Reset")
buttons["Done"].scripts.OnClick()
check(not panel.shown and P.selected == nil and not keys.shown, "Done closes it and lets go of the keys")
P.OpenPanel(E)
check(dropdowns["Anchor to"].opts.enabledIf() == false and buttons["Pick on screen"].enabled == false, "no Anchor to for an element that stays on the screen")
P.ClosePanel()

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
-- a drag box's title is a string ending ": drag to move" (a help text that mentions dragging is not one)
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
