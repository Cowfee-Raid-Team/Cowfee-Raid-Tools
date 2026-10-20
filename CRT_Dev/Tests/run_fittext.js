// UI/Controls.lua: UI.FitText shrinks text up to two sizes to fit its clip frame, then marks the rest
// to slide on hover; UI.ClipText's OnUpdate slides it while hovered and back after.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = String.raw`
local src = ...
local function mock(kind)
  local o = { scripts = {}, kind = kind }
  return setmetatable(o, { __index = function(t, k)
    return function() end
  end })
end
local made = {}
function CreateFrame(kind, name, parent)
  local f = mock(kind)
  f.SetClipsChildren = function(self, on) self.clips = on end
  f.SetScript = function(self, n, fn) self.scripts[n] = fn end
  f.HookScript = function(self, n, fn) self.scripts[n] = fn end
  f.GetWidth = function(self) return self.w or 0 end
  f.CreateFontString = function(self, _, _, font)
    local s = mock("FontString")
    s.size = 14
    s.SetFont = function(me, path, size) me.size = size end
    s.SetText = function(me, t) me.text = t end
    -- 7 pixels a character at 14 pt, scaled with the size
    s.GetUnboundedStringWidth = function(me) return #(me.text or "") * 7 * me.size / 14 end
    s.SetPoint = function(me, p, rel, rp, x) me.x = x end
    return s
  end
  return f
end
CRTFontSmall = { GetFont = function() return "font.ttf", 14, "" end }
local CRT = { UI = {} }
assert(load(src))("CowfeeRaidTools", CRT)
local UI = CRT.UI
local fails = 0
local function check(name, ok) print((ok and "PASS " or "FAIL ") .. name) if not ok then fails = fails + 1 end end

local parent = CreateFrame("Button")
local mouseOver = false
parent.IsMouseOver = function() return mouseOver end
local t = UI.ClipText(parent, "CRTFontSmall")
t.clip.w = 140
check("clip frame clips", t.clip.clips == true)

t:SetText("Notkvr-Stormrage") -- 16 chars: 112 at 14 pt
UI.FitText(t)
check("fits at full size", t.size == 14 and t.over == 0)

t:SetText("Mesmerknight-Storm") -- 18 chars: 126 at 14 pt
t.clip.w = 120
UI.FitText(t)
check("one size smaller fits", t.size == 13 and t.over == 0)

t:SetText("Teronhorefnd-Tichondrius") -- 24 chars: 168 at 14, 144 at 12
UI.FitText(t)
check("never more than two sizes smaller", t.size == 12)
check("the rest overruns by 24", t.over == 24)

-- hover: waits, then slides to the end; leave slides back
mouseOver = true
local upd = t.clip.scripts.OnUpdate
upd(nil, 0.3)
check("waits before sliding", t.slide == 0)
for _ = 1, 20 do upd(nil, 0.1) end
check("slid to the end", t.slide == 24 and t.x == -24)
mouseOver = false
for _ = 1, 20 do upd(nil, 0.1) end
check("slides back on leave", t.slide == 0 and t.x == 0)

t:SetText("")
UI.FitText(t)
check("empty text: nothing to slide", t.over == 0)
print(fails == 0 and "all passed" or (fails .. " failed"))
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const src = fs.readFileSync(process.argv[2] + '/UI/Controls.lua', 'utf8');
// Only the helpers at the end of Controls.lua are under test; the file's top needs CRT.UI only.
lua.lua_pushstring(L, to_luastring(src));
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
