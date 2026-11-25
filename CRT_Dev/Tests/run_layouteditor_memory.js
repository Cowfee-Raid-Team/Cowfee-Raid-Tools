// CRT_Dev/Dev/LayoutEditor.lua's page-change hook (#1315 round 2): it puts the saved dev layout changes on their pieces
// after each page change. It walked every region of every built page on every page change, which made megabytes of
// garbage a click in a developer build. Loads the real file on mock pages of many pieces and counts the Lua tables made
// (fengari's luaH_new) per page change:
//   - with no saved changes, a page change walks nothing;
//   - a saved change is put on its piece when its page is built, and once every change is on, nothing is walked;
//   - a change made on the page while the editor runs is never looked for again; an out-of-date one is skipped once.
// Usage: node run_layouteditor_memory.js <addon folder>
const fs = require('fs');
const path = require('path');
const ltable = require('fengari/src/ltable.js');
let tablesMade = 0;
const newTable = ltable.luaH_new;
ltable.luaH_new = function (L) { tablesMade++; return newTable(L); };
const { lua, lauxlib, lualib, to_luastring } = require('fengari');

const root = process.argv[2];
const src = fs.readFileSync(path.join(root, 'CRT_Dev/Dev/LayoutEditor.lua'), 'utf8');

const harness = `
local SRC = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
format = string.format
local unpack = unpack or table.unpack
-- mock frames: children and regions kept in order, one anchor, a size and a font
local methods = {}
local MT = { __index = function(_, k) return methods[k] or function() end end }
local function frame(kind, parent)
  local f = setmetatable({ kind = kind or "Frame", kids = {}, regs = {}, shown = true, x = 0, y = 0, w = 10, h = 10 }, MT)
  if parent then parent.kids[#parent.kids + 1] = f end
  return f
end
function methods.GetChildren(f) return unpack(f.kids) end
function methods.GetRegions(f) return unpack(f.regs) end
function methods.GetObjectType(f) return f.kind end
function methods.GetPoint(f) return "TOPLEFT", nil, "TOPLEFT", f.x, f.y end
function methods.GetNumPoints() return 1 end
function methods.ClearAllPoints() end
function methods.SetPoint(f, _, _, _, x, y) f.x, f.y = x, y end
function methods.GetWidth(f) return f.w end
function methods.GetHeight(f) return f.h end
function methods.SetSize(f, w, h) f.w, f.h = w, h end
function methods.IsVisible(f) return f.shown end
function methods.Show(f) f.shown = true end
function methods.Hide(f) f.shown = false end
function methods.SetShown(f, on) f.shown = on and true or false end
function methods.RegisterEvent() end
function methods.SetScript() end
function CreateFrame(kind, _, parent) return frame(kind, parent) end
UIParent = frame()

-- a page of 200 boxes, each with a label: 400 pieces
local function buildPage(pf)
  for i = 1, 200 do
    local c = frame("Frame", pf)
    local fs = frame("FontString")
    c.regs[1] = fs
    c.x = i
  end
end
local said = {}
local CRT = { db = {}, Print = function(_, s) said[#said + 1] = s end }
local UI = { pages = {}, order = { "start", "notes", "qol" } }
UI.frame = frame()
UI.frame.content = frame("Frame", UI.frame)
for _, key in ipairs(UI.order) do UI.pages[key] = { key = key } end
-- the real SelectPage's part that matters here: builds a page on its first show, shows only it
function UI:SelectPage(key)
  local page = self.pages[key]
  if not page.frame then
    page.frame = frame("Frame", self.frame.content)
    buildPage(page.frame)
  end
  for _, p in pairs(self.pages) do if p.frame then p.frame:SetShown(p == page) end end
end
CRT.UI = UI
assert(load(SRC, "@CRT_Dev/Dev/LayoutEditor.lua"))("CowfeeRaidTools", CRT)

local function perChange(n)
  local t0 = TABLES()
  for i = 1, n do UI:SelectPage(UI.order[i % 3 + 1]) end
  return (TABLES() - t0) / n
end
-- every page built first
for _, key in ipairs(UI.order) do UI:SelectPage(key) end

-- no saved changes: a page change walks nothing
local cost = perChange(30)
print(format("measure page change with no saved changes: %.0f tables", cost))
check(cost <= 2, format("no saved changes: a page change makes at most 2 tables, got %.0f", cost))

-- a saved change on a page not built yet: put on its piece when the page is built, then nothing is walked
UI.pages.notes.frame = nil
CRT.db.dev = { overrides = { ["notes.c5"] = { dx = 3, dy = 0, dw = 0, dh = 0, font = 0, base = { x = 5, y = 0, w = 10, h = 10, font = 0 } } } }
UI:SelectPage("notes")
check(UI.pages.notes.frame.kids[5].x == 8, "the saved change is put on its piece when the page is built: x " .. UI.pages.notes.frame.kids[5].x)
cost = perChange(30)
check(cost <= 2, format("once every change is on, a page change makes at most 2 tables, got %.0f", cost))
check(UI.pages.notes.frame.kids[5].x == 8, "and the change isn't put on twice")

-- an out-of-date change (the code moved the piece): skipped once with a message, then never looked for again
CRT.db.dev.overrides["qol.c7"] = { dx = 1, dy = 0, dw = 0, dh = 0, font = 0, base = { x = 99, y = 0, w = 10, h = 10, font = 0 } }
local before = #said
UI:SelectPage("qol")
check(#said == before + 1 and said[#said]:find("qol.c7", 1, true) ~= nil, "an out-of-date change is skipped with a message")
check(UI.pages.qol.frame.kids[7].x == 7, "and not applied")
cost = perChange(30)
check(cost <= 2 and #said == before + 1, format("then nothing is walked or said again: %.0f tables", cost))

-- round 3: changes whose piece is gone (on a built page, on the panel, a text that isn't there), or whose page is
-- gone, never make a page change walk anything: a developer's old changes made megabytes a click
CRT.db.dev.overrides["qol.c999"] = { dx = 1, dy = 0, dw = 0, dh = 0, font = 0 }
CRT.db.dev.overrides["start.c3.r5"] = { dx = 1, dy = 0, dw = 0, dh = 0, font = 0 }
CRT.db.dev.overrides["panel.c99"] = { dx = 1, dy = 0, dw = 0, dh = 0, font = 0 }
CRT.db.dev.overrides["nopage.c1"] = { dx = 1, dy = 0, dw = 0, dh = 0, font = 0 }
before = #said
UI:SelectPage("start")
cost = perChange(30)
print(format("measure page change with gone pieces saved: %.0f tables", cost))
check(cost <= 2, format("changes whose piece or page is gone: a page change makes at most 2 tables, got %.0f", cost))
check(#said == before, "and nothing is said about them on every click")
-- a text on a piece: put on by its path
CRT.db.dev.overrides["start.c4.r1"] = { dx = 0, dy = 2, dw = 0, dh = 0, font = 0 }
UI:SelectPage("start")
check(UI.pages.start.frame.kids[4].regs[1].y == 2, "a change on a text is put on it: y " .. tostring(UI.pages.start.frame.kids[4].regs[1].y))
-- a piece made later (a tab built on its first show) still gets its change then, once
local late = frame("Frame", UI.pages.qol.frame) -- qol's child 201
CRT.db.dev.overrides["qol.c201"] = { dx = 4, dy = 0, dw = 0, dh = 0, font = 0 }
UI:SelectPage("qol")
check(late.x == 4, "a change whose piece was made later goes on: x " .. late.x)
UI:SelectPage("start") UI:SelectPage("qol")
check(late.x == 4, "and only once")

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error(fails .. " layout editor memory checks failed") end
`;
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
lua.lua_pushcfunction(L, (L) => { lua.lua_pushnumber(L, tablesMade); return 1; });
lua.lua_setglobal(L, to_luastring('TABLES'));
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(src));
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
console.log('ok layout editor: a page change walks no pages once every saved change is on');
