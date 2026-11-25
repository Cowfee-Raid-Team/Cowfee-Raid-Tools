// The Ready Check page's Your bar tab (CRT_Modules/Consumables/Page.lua) with the real CRT_Modules/Consumables/Data.lua:
// Remove on one of your own items takes it off at once and offers Undo (the UX rule "Lost work asks first; quick
// actions can be undone", #1310), naming the item; Undo puts the same entry back in its place in the list, and only
// while the item isn't listed again. The bag, aura and status reads are stubbed: only the lists are under test.
// Usage: node run_consumables_page.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local dataSrc, pageSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end
local ok, err = xpcall(function()
format = string.format
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end

-- frames: any method is a no-op unless known; SetScript keeps the handler under its name
local function mock()
  local o = { shown = true }
  return setmetatable(o, { __index = function(t, k)
    local m = ({
      SetScript = function(self, n, fn) rawset(self, n, fn) end,
      SetText = function(self, s) rawset(self, "text", s) end,
      GetText = function(self) return rawget(self, "text") end,
      Show = function(self) self.shown = true end,
      Hide = function(self) self.shown = false end,
      SetShown = function(self, on) self.shown = on and true or false end,
      IsShown = function(self) return self.shown end,
      CreateFontString = function() return mock() end,
      CreateTexture = function() return mock() end,
      GetCenter = function() return 0, 0 end,
    })[k]
    if m then return m end
    if type(k) == "string" and k:match("^%u") then return function() end end
    return nil
  end })
end
local frames = {}
CreateFrame = function() local f = mock() frames[#frames + 1] = f return f end
GetCursorInfo = function() return nil end
C_Item = { GetItemNameByID = function(id) return "Item " .. id end, GetItemInfoInstant = function() return nil end }

local toasts = {}
local CRT = { db = { consumables = { extra = {}, itemOrder = {}, learned = {}, categoryOrder = { "food", "flask", "potion", "weapon", "rune" } } }, PALETTE = { heading = { 1, 0.82, 0 } } }
function CRT:Print() end
CRT.ConsumablesDB = { categories = { food = { { item = 100, name = "Shipped Stew" } } } }
CRT.Ants = { Update = function() end }
CRT.ConsumablesBar = { Size = function() return 100, 40 end, BACKDROP = {}, CreateSlot = function() return mock() end,
  Apply = function() end, AddStatusLines = function() end }
CRT.ConsumablesDisplay = { Preview = function() end }
CRT.UI = {
  FitButton = function() end, HelpRight = function() end, PreviewButton = function() return mock() end,
  Tint = function() end, SkinScrollBar = function() end,
  HeadingText = function(s) return s end, GoodText = function(s) return s end,
  -- the shared Undo (CRT_Core/UI/Confirm.lua, run_confirm.js tests it): what it was given
  UndoToast = function(o) toasts[#toasts + 1] = o return o end,
}
assert(load(dataSrc, "Consumables/Data.lua"))("CowfeeRaidTools", CRT)
local C = CRT.Consumables
-- the reads of the game: no bags, no auras
C.RefreshBags = function() end
C.Status = function() return {} end
C.LearningText = function() return "" end
C.ItemIcon = function() return 1 end
C.ItemCount = function() return 0 end
assert(load(pageSrc, "Consumables/Page.lua"))("CowfeeRaidTools", CRT)
local page = mock()
CRT.ConsumablesPage.Build(page)

local function names()
  local out = {}
  for _, e in ipairs(C:Entries("food")) do out[#out + 1] = tostring(e.item) end
  return table.concat(out, ",")
end
CRT.db.consumables.extra.food = { { item = 201, name = "Mine A" }, { item = 202, name = "Mine B" }, { item = 203, name = "Mine C" } }
CRT.db.consumables.itemOrder.food = { 202, 100, 201, 203 }
C:Fire()
page.OnShow(page)
check(names() == "202,100,201,203", "the food list in your order: " .. names())

-- the rows' Remove buttons, in row order: the frames whose text is Remove
local removes = {}
for _, f in ipairs(frames) do if rawget(f, "text") == "Remove" then removes[#removes + 1] = f end end
check(#removes == 4 and removes[1].shown and not removes[2].shown, "Remove only on your own items")
local before = CRT.db.consumables.extra.food[2]
removes[1].OnClick(removes[1]) -- row 1 is item 202
local toast = toasts[#toasts]
check(names() == "100,201,203", "Remove takes the item off at once: " .. names())
local shown = C:ItemName(before) -- the name its row shows
check(toast and toast.text and toast.text:find(shown, 1, true) ~= nil and type(toast.onUndo) == "function", "and offers Undo naming the item as its row did: " .. tostring(toast and toast.text))
check(toast and toast.owner == removes[1], "its toast in the button's window")
toast.onUndo()
check(names() == "202,100,201,203", "Undo puts it back in its place: " .. names())
check(CRT.db.consumables.extra.food[2] == before and #CRT.db.consumables.extra.food == 3, "the same saved entry, at its place in your list")
-- removed, then added again by hand: Undo changes nothing
page.OnShow(page)
removes[1].OnClick(removes[1])
toast = toasts[#toasts]
CRT.db.consumables.extra.food[#CRT.db.consumables.extra.food + 1] = { item = 202, name = "Mine B" }
C:Fire()
toast.onUndo()
local n = 0
for _, e in ipairs(CRT.db.consumables.extra.food) do if e.item == 202 then n = n + 1 end end
check(n == 1, "Undo after the item was added again changes nothing")
-- a shipped item has no Remove, so no Undo comes from it
check(C:RemoveExtra("food", 100) == nil, "a shipped item can't be removed")

end, debug.traceback)
if not ok then print(err) fails = fails + 1 end
print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Modules/Consumables/Data.lua', 'CRT_Modules/Consumables/Page.lua']) {
  lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, f), 'utf8')));
}
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
