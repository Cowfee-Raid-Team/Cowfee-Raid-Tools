// The one confirm and the one Undo (CRT_Core/UI/Confirm.lua, #1299): UI.Confirm shows the game's popup with CRT's dialog,
// its text naming the thing and what goes with it, the accept button naming the action; accept runs once, Cancel and
// Escape run nothing. UI.UndoToast shows its message and Undo near the bottom of the window the action happened in;
// Undo puts the state back once, it goes after UI.UNDO_SECONDS, and a second toast replaces the first. Also: no
// two-click "Click again" confirm and no typed-name confirm is left in CRT_Core or CRT_Modules.
// Usage: node run_confirm.js <addon folder>
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local confirmSrc, scanSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end

-- frames: any method is a no-op unless known
local function mock(kind)
  local o = { kind = kind, shown = true, level = 1 }
  return setmetatable(o, { __index = function(t, k)
    local m = ({
      SetText = function(self, s) self.text = s end,
      GetText = function(self) return self.text end,
      Show = function(self) self.shown = true end,
      Hide = function(self) self.shown = false end,
      IsShown = function(self) return self.shown end,
      SetParent = function(self, p) self.parent = p end,
      GetParent = function(self) return self.parent end,
      SetPoint = function(self, ...) self.point = { ... } end,
      ClearAllPoints = function(self) self.point = nil end,
      SetWidth = function(self, w) self.w = w end,
      GetWidth = function(self) return self.w or 0 end,
      SetFrameLevel = function(self, l) self.level = l end,
      GetFrameLevel = function(self) return self.level end,
      SetScript = function(self, n, fn) self[n] = fn end,
      GetStringWidth = function(self) return #(self.text or "") * 6 end,
      CreateTexture = function() return mock("Texture") end,
      CreateFontString = function() return mock("FontString") end,
      SetBackdropColor = function(self, r, g, b, a) self.bg = { r, g, b, a } end,
      SetBackdropBorderColor = function(self, r, g, b, a) self.border = { r, g, b, a } end,
      SetColorTexture = function(self, r, g, b, a) self.color = { r, g, b, a } end,
    })[k]
    if m then return m end
    if type(k) == "string" and k:match("^%u") then return function() end end
    return nil
  end })
end
CreateFrame = function(kind, name) local f = mock(kind) if name then _G[name] = f end return f end
UIParent = mock("Frame") UIParent.w = 1920
CANCEL = "Cancel"

-- the game's popup, as Blizzard_StaticPopup/StaticPopup.lua runs it: the dialog's table read at each show, accept runs
-- OnAccept(dialog, data), the second button OnCancel(dialog, data, "clicked"), Escape hides a hideOnEscape dialog after
-- OnCancel unless noCancelOnEscape
StaticPopupDialogs = {}
local shown -- { which, text, data, info, labels, alert }
local lifted = 0
function StaticPopup_Show(which, a1, a2, data)
  local info = StaticPopupDialogs[which]
  if not info then return nil end
  local text = info.text == "" and a1 or string.format(info.text, a1, a2)
  shown = { which = which, text = text, data = data, info = info, button1 = info.button1, button2 = info.button2, alert = info.showAlert, frame = mock("Frame") }
  return shown.frame
end
local function click(which)
  local s = shown
  shown = nil
  if which == 1 then if s.info.OnAccept then s.info.OnAccept(s.frame, s.data) end
  elseif which == 2 then if s.info.OnCancel then s.info.OnCancel(s.frame, s.data, "clicked") end
  else
    check(s.info.hideOnEscape, "Escape closes it (hideOnEscape)")
    if s.info.OnCancel and not s.info.noCancelOnEscape then s.info.OnCancel(s.frame, s.data, "clicked") end
  end
end

local timers, clock = {}, 0
C_Timer = { After = function(s, fn) timers[#timers + 1] = { at = clock + s, fn = fn } end }
local function advance(s)
  clock = clock + s
  local due = {}
  for i = #timers, 1, -1 do if timers[i].at <= clock then due[#due + 1] = table.remove(timers, i) end end
  for _, t in ipairs(due) do t.fn() end
end

local mainWin = mock("Frame") mainWin.w = 1026 mainWin.level = 10
local editor = mock("Frame") editor.w = 400 editor.level = 40
local inEditor = mock("Button") inEditor.parent = editor
local modern = true
local UI = { skinned = {}, frame = mainWin,
  IsModern = function() return modern end,
  LiftOver = function(f) if f then lifted = lifted + 1 end end,
  ShownPopup = function(ret) return ret end,
  WindowOf = function(r) while r do if r == editor or r == mainWin then return r end r = r.parent end end,
  PanelButton = function(parent, label, h, fn) local b = mock("Button") b.parent = parent b.text = label b.OnClick = fn b.w = #label * 6 + 28 return b end,
}
local CRT = { UI = UI }
CRT_THEME(CRT, UI)
assert(load(confirmSrc, "Confirm.lua"))("CowfeeRaidTools", CRT)

-- 1. UI.Confirm
do
  local ran = 0
  local opts = { text = 'Delete the note "Nek\\'zali (Mythic)"?', detail = "Its 5 saved versions go too. This can't be undone.",
    accept = "Delete note", danger = true, onAccept = function() ran = ran + 1 end }
  check(UI.Confirm(opts) == true, "Confirm shows")
  eq(shown and shown.which, UI.CONFIRM_POPUP, "on CRT's own dialog")
  eq(shown and shown.text, 'Delete the note "Nek\\'zali (Mythic)"?\\n\\nIts 5 saved versions go too. This can\\'t be undone.', "the text names the thing, then what goes with it")
  eq(shown and shown.button1, "Delete note", "the accept button names the action")
  eq(shown and shown.button2, "Cancel", "the other is Cancel")
  check(shown and shown.alert, "danger shows the alert icon")
  eq(shown and shown.info.timeout, 0, "no timeout")
  check(shown and shown.info.whileDead, "shows while dead")
  check(lifted == 1, "lifted over CRT's windows")
  click(2)
  eq(ran, 0, "Cancel runs nothing")
  UI.Confirm(opts)
  click("escape")
  eq(ran, 0, "Escape runs nothing")
  UI.Confirm(opts)
  click(1)
  eq(ran, 1, "accept runs it")
  -- a second confirm with other words: the dialog's buttons follow
  UI.Confirm({ text = "Delete it?", accept = "Delete layout", onAccept = function() ran = ran + 10 end })
  eq(shown.button1, "Delete layout", "the accept label is set each time")
  check(not shown.alert, "no alert icon without danger")
  eq(shown.text, "Delete it?", "no detail: just the question")
  local data = shown.data
  click(1)
  eq(ran, 11, "its own onAccept runs")
  shown = { info = StaticPopupDialogs[UI.CONFIRM_POPUP], data = data, frame = mock() }
  click(1)
  eq(ran, 11, "and only once")
  local d100 = UI.Confirm({ text = "100% gone?", onAccept = function() end })
  eq(shown.text, "100% gone?", "a % in a name is shown as it is")
  click(2)
  local keep = StaticPopup_Show
  StaticPopup_Show = function() return nil end
  check(UI.Confirm({ text = "x", onAccept = function() ran = ran + 100 end }) == false and ran == 11, "no free dialog: false, nothing runs")
  StaticPopup_Show = nil
  check(UI.Confirm({ text = "x", onAccept = function() ran = ran + 100 end }) == false and ran == 11, "no popup at all: false, nothing runs")
  StaticPopup_Show = keep
end

-- 2. UI.UndoToast
do
  local state = { "a", "b", "c" }
  local saved = { "a", "b", "c" }
  for i = 1, 3 do state[i] = "" end
  local undone = 0
  local t = UI.UndoToast({ text = "Cleared the grid (3 names).", onUndo = function() undone = undone + 1 for i = 1, 3 do state[i] = saved[i] end end })
  check(t and t.shown, "the toast shows")
  eq(t.text.text, "Cleared the grid (3 names).", "with its message")
  eq(t.undo.text, "Undo", "and an Undo button")
  eq(t.parent, mainWin, "no owner: in the main window")
  check(t.point and t.point[1] == "BOTTOM" and t.point[2] == mainWin and t.point[3] == "BOTTOM", "near its bottom")
  check(t.level > mainWin.level, "above the page")
  check(t.w > 0 and t.w <= mainWin.w - 2 * UI.UNDO_TOAST.margin, "as wide as it needs, inside the window: " .. tostring(t.w))
  check(t.bg and t.border and t.edge.color, "painted: surface, border and accent edge")
  t.undo.OnClick(t.undo)
  eq(undone, 1, "Undo runs the undo")
  eq(table.concat(state, ","), "a,b,c", "and the state is back exactly")
  check(not t.shown, "the toast goes")
  t.undo.OnClick(t.undo)
  eq(undone, 1, "a second click does nothing")
  -- it goes after UNDO_SECONDS, taking its Undo with it
  eq(UI.UNDO_SECONDS, 10, "about 10 seconds of Undo")
  UI.UndoToast({ text = "Removed Abu.", owner = inEditor, onUndo = function() undone = undone + 1 end })
  eq(t.parent, editor, "an owner: in that window")
  check(t.level > editor.level, "above it")
  advance(9.5)
  check(t.shown, "still there at 9.5 s")
  advance(1)
  check(not t.shown, "gone after 10 s")
  t.undo.OnClick(t.undo)
  eq(undone, 1, "and its Undo is gone")
  -- a second toast replaces the first; the first's timer can't hide the second
  local first, second = 0, 0
  UI.UndoToast({ text = "One.", onUndo = function() first = first + 1 end })
  advance(6)
  UI.UndoToast({ text = "Two.", onUndo = function() second = second + 1 end })
  eq(t.text.text, "Two.", "a second toast replaces the first")
  advance(5)
  check(t.shown, "the first's timer doesn't hide the second")
  t.undo.OnClick(t.undo)
  check(first == 0 and second == 1, "Undo undoes the second only")
  -- a long message never makes it wider than the window
  UI.UndoToast({ text = string.rep("x", 400), owner = inEditor })
  check(t.w <= editor.w - 2 * UI.UNDO_TOAST.margin, "a long message stays inside the window: " .. tostring(t.w))
  UI.HideUndoToast()
  check(not t.shown, "HideUndoToast hides it")
  -- both looks: Classic paints the dark ground, Modern the theme's surface; the accent edge in both
  modern = false
  for _, s in ipairs(UI.skinned) do s.crtSkin(false) end
  check(t.bg[1] == 0 and t.bg[2] == 0 and t.bg[3] == 0, "Classic: the dark ground")
  local ar, ag, ab = UI.Color("accent")
  check(t.edge.color[1] == ar and t.edge.color[2] == ag and t.edge.color[3] == ab, "Classic: the accent edge")
  modern = true
  for _, s in ipairs(UI.skinned) do s.crtSkin(true) end
  local sr, sg, sb = UI.Color("surface")
  check(t.bg[1] == sr and t.bg[2] == sg and t.bg[3] == sb, "Modern: the theme's surface")
end

-- 3. No other confirm style is left (comments left out)
do
  local bad = {}
  for line in scanSrc:gmatch("[^\\n]+") do bad[#bad + 1] = line end
  check(#bad == 0, "no two-click or typed-name confirm in CRT_Core or CRT_Modules" .. (#bad > 0 and (":\\n" .. table.concat(bad, "\\n")) or ""))
end

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const confirmPath = path.join(dir, 'CRT_Core/UI/Confirm.lua');
lua.lua_pushstring(L, to_luastring(fs.existsSync(confirmPath) ? fs.readFileSync(confirmPath, 'utf8') : 'error("missing CRT_Core/UI/Confirm.lua")'));
// every line of CRT_Core and CRT_Modules (comments left out) that still arms a second click or asks for a typed name
const hits = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.lua')) {
      fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((line, i) => {
        const code = line.replace(/--.*$/, '');
        if (/Click again to|Type the team name|\barmToken\b/.test(code)) hits.push(path.relative(dir, p) + ':' + (i + 1) + ': ' + line.trim());
      });
    }
  }
}
walk(path.join(dir, 'CRT_Core'));
walk(path.join(dir, 'CRT_Modules'));
lua.lua_pushstring(L, to_luastring(hits.join('\n')));
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
