// CRT_Modules/LootMaster/SettingsLayout.lua: the Settings tab's third column as numbers. Nothing overlaps, everything stays
// inside the column and the tab, and the Order equal answers by dropdown fits its longest choice. Usage: node run_lootmaster_layout.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local layoutSrc, pageSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
local CRT = { LootMaster = {} }
assert(load(layoutSrc, "SettingsLayout.lua"))("CowfeeRaidTools", CRT)
local LM = CRT.LootMaster
local S = LM.SettingsLayout

-- the page's numbers, read from Page.lua's own constants
local function const(name) return tonumber(pageSrc:match(name .. " = (%d+)")) end
local PAGE_W, PAGE_H, BODY = 1026, 560, 66
local p = { sliderLabel = const("sliderLabel"), sliderW = const("sliderW"), authorityRows = 6, tabH = PAGE_H - BODY }
check(p.sliderLabel and p.sliderW, "the slider widths are found in Page.lua")
local col = S.Column3(PAGE_W, p)

-- no two rectangles overlap (touching is fine)
local names = {}
for name in pairs(col.rects) do names[#names + 1] = name end
table.sort(names)
local function overlap(a, b)
    local ax2, bx2 = a.x + a.w, b.x + b.w
    local ay2, by2 = a.y - a.h, b.y - b.h
    return a.x < bx2 and b.x < ax2 and ay2 < b.y and by2 < a.y
end
for i = 1, #names do
    for j = i + 1, #names do
        check(not overlap(col.rects[names[i]], col.rects[names[j]]), names[i] .. " and " .. names[j] .. " do not overlap")
    end
end

-- the column and the tab hold every rectangle
local lowest = 0
for _, name in ipairs(names) do
    local r = col.rects[name]
    check(r.x + r.w <= col.w, name .. " ends inside the column (" .. (r.x + r.w) .. " of " .. col.w .. ")")
    check(r.y <= 0, name .. " starts below the tab's top")
    lowest = math.min(lowest, r.y - r.h)
end
check(lowest >= -col.tabH, "the lowest control ends inside the tab (" .. lowest .. " of " .. -col.tabH .. ")")

-- the dropdown: wide enough for the longest choice, and for the real default
local longest = "Wishlist, then Raider Score"
local widest = 0
for _, c in ipairs(LM.TIE_CHOICES) do widest = math.max(widest, #c.label) end
eq(widest, #longest, "the longest choice is the one named")
check(col.tiePick >= #longest * S.CHAR_W + S.DROPDOWN_PAD, "the dropdown fits the longest label")
check(col.rects.tieRow.w - 5 == col.tiePick, "the row is the dropdown's width plus its gap")
eq(#LM.TIE_CHOICES, 4, "four choices")
-- the dropdown is built with that width on Page.lua
check(pageSrc:find("width = col3.tiePick", 1, true) ~= nil, "Page.lua builds the dropdown at the layout's width")
check(pageSrc:find("LM.SettingsLayout.Column3", 1, true) ~= nil, "Page.lua places the column from the layout")
-- the row is on its own line under the last slider
check(col.rects.tieRow.y <= col.rects.slider5.y - col.rects.slider5.h, "the dropdown row is under the Weeks slider's row")
print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Modules/LootMaster/SettingsLayout.lua', 'CRT_Modules/LootMaster/Page.lua']) lua.lua_pushstring(L, to_luastring(fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : 'error("missing")'));
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
