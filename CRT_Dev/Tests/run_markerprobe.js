// CRT_Dev/Dev/MarkerProbe.lua on mock frames: /crt dev markerprobe lists the last group chat messages, each with
// whether the game hid it and three pcall-wrapped tries at drawing a raid marker from its text. Secret values are
// proxies that flag any use the game forbids (compare, index, length, arithmetic), even inside a pcall; joining
// and string.format work on them and give a new secret, as in the game.
// usage: node run_markerprobe.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local probeSrc, tocSrc, slashSrc, pkgSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end

-- Secret values: joining is allowed (gives a secret) unless concatRefused; anything else is misuse.
local SECRET = {}
local misused = false
local concatRefused = false
local function forbidden() misused = true error("used a secret value") end
local function secret(v) return setmetatable({ inner = v }, SECRET) end
SECRET.__index = forbidden
SECRET.__newindex = forbidden
SECRET.__len = forbidden
SECRET.__lt = forbidden
SECRET.__le = forbidden
SECRET.__eq = forbidden
SECRET.__add = forbidden
SECRET.__sub = forbidden
SECRET.__call = forbidden
SECRET.__concat = function(a, b)
  if concatRefused then error("attempt to concatenate a secret value") end
  local function raw(x) return getmetatable(x) == SECRET and rawget(x, "inner") or x end
  return secret(raw(a) .. raw(b))
end
local function isS(v) return getmetatable(v) == SECRET end
issecretvalue = isS
local function inner(v) return getmetatable(v) == SECRET and rawget(v, "inner") or v end
local realFormat = string.format
string.format = function(fmt, ...)
  local args = { ... }
  local any = false
  for i = 1, select("#", ...) do if isS(args[i]) then any = true args[i] = rawget(args[i], "inner") end end
  local s = realFormat(fmt, table.unpack(args, 1, select("#", ...)))
  return any and secret(s) or s
end

-- Textures and font strings remember what they were given; refuseSecret makes the setters refuse a secret.
local refuseSecret = false
local function region()
  local r = { shown = true }
  function r:SetText(t) self.text = t end
  function r:GetText() return self.text end
  function r:SetTexture(p)
    if refuseSecret and isS(p) then error("bad argument #1 to 'SetTexture' (secret value)") end
    self.path, self.atlas = p, nil
    if isS(p) then return secret(true) end
    return p ~= nil
  end
  function r:SetAtlas(a)
    if refuseSecret and isS(a) then error("bad argument #1 to 'SetAtlas' (secret value)") end
    self.atlas, self.path = a, nil
  end
  function r:Show() self.shown = true end
  function r:Hide() self.shown = false end
  function r:SetShown(s) self.shown = s and true or false end
  function r:IsShown() return self.shown end
  function r:GetStringWidth() return 40 end
  return setmetatable(r, { __index = function(_, k) if type(k) == "string" and k:match("^%u") then return function() end end end })
end
local frames = {}
function CreateFrame(kind, name, parent)
  local f = region()
  f.events, f.scripts, f.kind = {}, {}, kind
  function f:RegisterEvent(e) self.events[e] = true end
  function f:UnregisterEvent(e) self.events[e] = nil end
  function f:UnregisterAllEvents() self.events = {} end
  function f:SetScript(n, fn) self.scripts[n] = fn end
  function f:HookScript(n, fn) local old = self.scripts[n] self.scripts[n] = function(...) if old then old(...) end fn(...) end end
  function f:CreateTexture() return region() end
  function f:CreateFontString() return region() end
  function f:GetFontString() return region() end
  function f:Show() self.shown = true if self.scripts.OnShow then self.scripts.OnShow(self) end end
  function f:Hide() self.shown = false if self.scripts.OnHide then self.scripts.OnHide(self) end end
  frames[#frames + 1] = f
  return f
end
local atlases = { ["GM-raidMarker1"] = { file = 1 } }
C_Texture = { GetAtlasInfo = function(a) return atlases[a] end }

local CRT = { db = { dev = {} }, UI = {} }
local printed, shown = {}, nil
function CRT:Print(s) printed[#printed + 1] = s end
CRT.ConsumablesTools = { ShowText = function(_, title, text) shown = { title = title, text = text } end }
local helpTitle, helpText
function CRT.UI.Window(name, opts)
  local f = CreateFrame("Frame", name)
  f.shown = false
  f.opts = opts
  f.strip = { SetHelp = function(_, t, x) helpTitle, helpText = t, x end }
  return f
end
function CRT.UI:SkinTree() end
assert(load(probeSrc, "MarkerProbe.lua"))("CowfeeRaidTools", CRT)
local P = CRT.MarkerProbe

-- The window and its command.
check(P:Command("dev markers") == false and P:Command("dev markerprobex") == false, "other commands are not the probe's")
check(P:Command("dev markerprobe") == true, "/crt dev markerprobe is the probe's")
local win = P.window
check(win and win.shown, "the command opens the window")
check(helpText and helpText:find("/raid 1", 1, true) and helpText:find("Hidden = the game hid the text", 1, true) and helpText:find("A star means the path trick drew it", 1, true), "the help is in the window's (?) tooltip")
local listener
for _, f in ipairs(frames) do if f.events.CHAT_MSG_RAID then listener = f end end
check(listener ~= nil, "open: it listens to group chat")
local want = { "CHAT_MSG_RAID", "CHAT_MSG_RAID_LEADER", "CHAT_MSG_PARTY", "CHAT_MSG_PARTY_LEADER", "CHAT_MSG_INSTANCE_CHAT", "CHAT_MSG_INSTANCE_CHAT_LEADER", "CHAT_MSG_SAY" }
local all = true
for _, e in ipairs(want) do all = all and listener.events[e] == true end
check(all, "the marker display's chat events, and say for a solo test")
local function fire(e, ...) listener.scripts.OnEvent(listener, e, ...) end
local function row(i) return P.rows[i] end
local function visible() local n = 0 for _, r in ipairs(P.rows) do if r.shown then n = n + 1 end end return n end

-- A readable "1": every try draws the marker from the text.
fire("CHAT_MSG_SAY", "1", "Solex")
local r = row(1)
check(r and r.hidden:GetText() == "hidden: no", "a readable message: hidden: no (" .. tostring(r and r.hidden:GetText()) .. ")")
check(r.channel:GetText() == "say", "its channel: " .. tostring(r.channel:GetText()))
check(r.sender:GetText() == "Solex" and r.message:GetText() == "1", "the sender and text as the game gave them")
check(r.tries.a.icon.path == "Interface\\\\TargetingFrame\\\\UI-RaidTargetingIcon_1", "A: the joined path is set: " .. tostring(r.tries.a.icon.path))
check(r.tries.a.result:GetText() == "set ok, returned true", "A: set ok, with what SetTexture returned: " .. tostring(r.tries.a.result:GetText()))
check(r.tries.b.icon.path == "Interface\\\\TargetingFrame\\\\UI-RaidTargetingIcon_1" and r.tries.b.result:GetText() == "set ok, returned true", "B: the formatted path is set")
check(r.tries.c.icon.atlas == "GM-raidMarker1" and r.tries.c.result:GetText() == "set ok", "C: the atlas name from the text is set: " .. tostring(r.tries.c.result:GetText()))

-- A hidden "1": the hidden text goes straight into the setters, never read.
fire("CHAT_MSG_RAID", secret("1"), secret("Solex-Area52"))
r = row(1)
check(r.hidden:GetText() == "hidden: yes", "a hidden message: hidden: yes")
check(issecretvalue(r.sender:GetText()) and inner(r.sender:GetText()) == "Solex-Area52", "the hidden sender is shown as given")
check(issecretvalue(r.message:GetText()), "the hidden text is shown as given")
check(issecretvalue(r.tries.a.icon.path) and inner(r.tries.a.icon.path) == "Interface\\\\TargetingFrame\\\\UI-RaidTargetingIcon_1", "A: the joined hidden path is set")
check(r.tries.a.result:GetText() == "set ok, answer hidden", "A: a hidden return value is not read: " .. tostring(r.tries.a.result:GetText()))
check(issecretvalue(r.tries.b.icon.path) and inner(r.tries.b.icon.path) == "Interface\\\\TargetingFrame\\\\UI-RaidTargetingIcon_1", "B: the formatted hidden path is set")
check(issecretvalue(r.tries.c.icon.atlas) and inner(r.tries.c.icon.atlas) == "GM-raidMarker1" and r.tries.c.result:GetText() == "set ok", "C: the hidden atlas name is set")
check(row(2).hidden:GetText() == "hidden: no", "the newest message is on top")

-- Refused setters, and a refused join.
refuseSecret = true
fire("CHAT_MSG_RAID_LEADER", secret("8"), secret("Lead"))
r = row(1)
local a = r.tries.a.result:GetText()
check(a:find("^refused %(") and a:find("secret value", 1, true), "A: a refused SetTexture shows its error: " .. a)
check(r.tries.b.result:GetText():find("^refused %("), "B: refused too")
check(r.tries.c.result:GetText():find("^refused %(") and r.tries.c.result:GetText():find("SetAtlas", 1, true), "C: a refused SetAtlas shows its error")
check(r.tries.a.icon.path == nil and r.tries.c.icon.atlas == nil, "a reused texture is cleared before each try")
refuseSecret = false
concatRefused = true
fire("CHAT_MSG_PARTY", secret("2"), secret("Pal"))
r = row(1)
check(r.tries.a.result:GetText():find("^refused %(join:") and r.tries.c.result:GetText():find("^refused %(join:"), "a refused join says so: " .. tostring(r.tries.a.result:GetText()))
concatRefused = false

-- No issecretvalue: unknown.
local isv = issecretvalue
issecretvalue = nil
fire("CHAT_MSG_INSTANCE_CHAT", "lol", "Pug")
issecretvalue = isv
check(row(1).hidden:GetText() == "hidden: unknown", "no issecretvalue: hidden: unknown")

-- At most eight rows, newest first.
for i = 1, 9 do fire("CHAT_MSG_PARTY_LEADER", tostring(i), "P" .. i) end
check(visible() == P.MAX_ROWS and P.MAX_ROWS == 8, "only the last eight messages are listed: " .. visible())
check(row(1).message:GetText() == "9" and row(8).message:GetText() == "2", "newest first, the oldest dropped")
check(#P.rows == P.MAX_ROWS, "rows are reused, not made again: " .. #P.rows)

-- Copy: the rows as text, a hidden value as <hidden>.
fire("CHAT_MSG_RAID", secret("3"), secret("Hid"))
P:Copy()
check(shown and shown.text:find("raid | hidden: yes | <hidden> | <hidden> | A: set ok, answer hidden | B: set ok, answer hidden | C: set ok", 1, true), "copy: a hidden row as text: " .. tostring(shown and shown.text))
check(shown.text:find("party_leader | hidden: no | P9 | 9 |", 1, true), "copy: a readable row as text")

-- No marker atlas: C is skipped.
atlases = {}
fire("CHAT_MSG_RAID", "4", "Solex")
check(row(1).tries.c.result:GetText() == "skipped: no marker atlas" and row(1).tries.c.icon.atlas == nil, "no marker atlas in the game: C is skipped")

-- Clear, then closing stops listening.
P:Clear()
check(visible() == 0 and #P.entries == 0, "Clear empties the list")
win:Hide()
check(next(listener.events) == nil, "closed: it listens to nothing")
P:Command("dev markerprobe")
check(win.shown and listener.events.CHAT_MSG_RAID, "the command opens it again, listening")
P:Command("dev markerprobe")
check(not win.shown, "and closes it")

check(not misused, "no secret value was compared, indexed, measured or added")

-- Dev only: the .toc line and the slash command sit in the do-not-package blocks; the package leaves CRT_Dev out.
local block = tocSrc:match("#@do%-not%-package@(.-)#@end%-do%-not%-package@") or ""
check(block:find("CRT_Dev\\\\Dev\\\\MarkerProbe.lua", 1, true) and select(2, tocSrc:gsub("MarkerProbe", "")) == 1, "the .toc loads it only in the do-not-package block")
local sblock = slashSrc:match("%-%-@do%-not%-package@(.-)%-%-@end%-do%-not%-package@") or ""
check(sblock:find("MarkerProbe", 1, true) and select(2, slashSrc:gsub("MarkerProbe", "")) == select(2, sblock:gsub("MarkerProbe", "")), "the slash command is only in Slash.lua's do-not-package block")
check(pkgSrc:find("\\n%s*%-%s*CRT_Dev%s*\\n"), ".pkgmeta leaves CRT_Dev out of the package")

print(passes .. " passed, " .. fails .. " failed")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
for (const f of ['CRT_Dev/Dev/MarkerProbe.lua', 'CowfeeRaidTools.toc', 'CRT_Core/Slash.lua', '.pkgmeta']) {
  lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(d, f), 'utf8')));
}
if (lua.lua_pcall(L, 4, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
