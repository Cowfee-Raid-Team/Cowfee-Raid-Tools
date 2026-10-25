// CRT_Core/Share.lua, the share engine: a table as a "!CRT:<kind>:<version>:<payload>" code and back, the round
// trip, header lines and line breaks in a paste, codes of another kind, newer, cut-off, changed and too long, the
// plain-data caps (depth, entries, total, text length, no functions), and Profiles' CRTP1: and CRTS1: texts made
// the way they were before the engine still reading (CRT_Core/Profiles.lua packs through it now).
// The game's C_EncodingUtil is stood in for by a small serializer, a checksummed "compressor" and real base64.
// Usage: node run_share.js <addon folder>
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local coreSrc, shareSrc, profilesSrc = ...
local failCount, okCount = 0, 0
local function check(cond, name) if cond then okCount = okCount + 1 print("ok " .. name) else failCount = failCount + 1 print("FAIL " .. name) end end
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
date, time = os.date, os.time
function ReloadUI() end
function UnitName() return "Solex" end
local eventFrames = {}
function CreateFrame() local f = { RegisterEvent = function() end, UnregisterEvent = function() end } f.SetScript = function(self, _, fn) self.OnEvent = fn end eventFrames[#eventFrames + 1] = f return f end
local function fontObject() local o = { path = "f", size = 12, flags = "" }
  function o:CopyFontObject() end function o:GetFont() return self.path, self.size, self.flags end
  function o:SetFont(p, s, fl) self.path, self.size, self.flags = p, s, fl end
  function o:GetTextColor() return 1, 1, 1 end function o:SetTextColor() end return o end
function CreateFont(name) local o = fontObject() _G[name] = o return o end
GameFontNormal, GameFontHighlight, GameFontDisable, GameFontHighlightSmall, GameFontDisableSmall, GameFontNormalLarge, GameFontNormalSmall, ChatFontNormal = fontObject(), fontObject(), fontObject(), fontObject(), fontObject(), fontObject(), fontObject(), fontObject()
Enum = { CompressionMethod = { Deflate = 0, Zlib = 1, Gzip = 2 } }

-- The stand-in encoder (as run_profiles_share.js). -----------------------------------------------
local function ser(v, out)
  local t = type(v)
  if t == "number" then out[#out + 1] = "n" .. string.format("%.17g", v) .. ";"
  elseif t == "string" then out[#out + 1] = "s" .. #v .. ":" .. v
  elseif t == "boolean" then out[#out + 1] = v and "T" or "F"
  elseif t == "table" then out[#out + 1] = "{" for k, x in pairs(v) do ser(k, out) ser(x, out) end out[#out + 1] = "}"
  else error("can't serialize " .. t) end
end
local function des(s, i)
  local c = s:sub(i, i)
  if c == "n" then local j = s:find(";", i, true) if not j then error("bad number") end return assert(tonumber(s:sub(i + 1, j - 1))), j + 1
  elseif c == "s" then local j = s:find(":", i, true) if not j then error("bad string") end local n = tonumber(s:sub(i + 1, j - 1)) if not n or j + n > #s then error("cut string") end return s:sub(j + 1, j + n), j + n + 1
  elseif c == "T" then return true, i + 1 elseif c == "F" then return false, i + 1
  elseif c == "{" then local t = {} i = i + 1
    while s:sub(i, i) ~= "}" do if i > #s then error("cut table") end local k, x k, i = des(s, i) x, i = des(s, i) t[k] = x end
    return t, i + 1
  else error("bad byte " .. c) end
end
local function sum(s) local a = 0 for i = 1, #s do a = (a * 31 + s:byte(i)) % 1000003 end return a end
local B = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local function b64(s)
  local out = {}
  for i = 1, #s, 3 do
    local a, b, c = s:byte(i, i + 2)
    local n = a * 65536 + (b or 0) * 256 + (c or 0)
    local q = { math.floor(n / 262144) % 64, math.floor(n / 4096) % 64, math.floor(n / 64) % 64, n % 64 }
    out[#out + 1] = B:sub(q[1] + 1, q[1] + 1) .. B:sub(q[2] + 1, q[2] + 1) .. (b and B:sub(q[3] + 1, q[3] + 1) or "=") .. (c and B:sub(q[4] + 1, q[4] + 1) or "=")
  end
  return table.concat(out)
end
local function unb64(s)
  if #s % 4 ~= 0 or s:find("[^%w%+/=]") then error("bad base64") end
  local out = {}
  for i = 1, #s, 4 do
    local n, pad = 0, 0
    for j = 0, 3 do local ch = s:sub(i + j, i + j) local v if ch == "=" then v = 0 pad = pad + 1 else v = B:find(ch, 1, true) - 1 end n = n * 64 + v end
    local bytes = string.char(math.floor(n / 65536) % 256, math.floor(n / 256) % 256, n % 256)
    out[#out + 1] = bytes:sub(1, 3 - pad)
  end
  return table.concat(out)
end
local methods = {}
local GAME = {
  SerializeCBOR = function(v) local out = {} ser(v, out) return table.concat(out) end,
  DeserializeCBOR = function(s) local v, i = des(s, 1) if i ~= #s + 1 then error("trailing bytes") end return v end,
  CompressString = function(s, method) methods[#methods + 1] = method or "default" return "Z" .. (method or 0) .. ":" .. sum(s) .. ":" .. s end,
  DecompressString = function(s, method)
    local m, c, body = s:match("^Z(%d+):(%d+):(.*)$")
    if not c or tonumber(c) ~= sum(body) then error("checksum") end
    if tonumber(m) ~= (method or 0) then error("wrong method") end
    return body
  end,
  EncodeBase64 = function(s) return b64(s) end,
  DecodeBase64 = function(s) return unb64(s) end,
}
C_EncodingUtil = GAME
local function same(a, b)
  if type(a) ~= type(b) then return false end
  if type(a) ~= "table" then return a == b end
  for k, v in pairs(a) do if not same(v, b[k]) then return false end end
  for k in pairs(b) do if a[k] == nil then return false end end
  return true
end

local CRT = {}
assert(load(coreSrc, "CRT_Core/Core.lua"))("CowfeeRaidTools", CRT)
function CRT:ResolveTheme(ui) return ui.theme or "blizzard" end
function CRT:UseTheme() end
CRT.PALETTE = {}
CRT.UI = { STRATA = {}, LAYERS = {} }
assert(load(shareSrc, "CRT_Core/Share.lua"))("CowfeeRaidTools", CRT)
local S = CRT.Share
check(S and S.Encode and S.Decode, "CRT.Share exists with Encode and Decode")
if not S then print(okCount .. " passed, " .. failCount .. " failed") return end

-- The round trip. ----------------------------------------------------------------------------------
local data = { v = 1, from = "Solex", list = { 1, 2.5, -3 }, map = { [3421] = { nh = { on = true, text = "Soak: {group}" } } }, flag = false }
local code, err = S.Encode("alerts", 1, data)
check(type(code) == "string" and code:find("^!CRT:alerts:1:") ~= nil, "Encode gives !CRT:alerts:1: and the payload (" .. tostring(err or code and code:sub(1, 20)) .. ")")
check(methods[#methods] == 1, "codes compress with Zlib, for its checksum")
local back, version = S.Decode(code, "alerts", 1)
check(same(back, data) and version == 1, "Decode gives the same table back, and its version")
check(S.Peek(code) == "alerts" and select(2, S.Peek(code)) == 1, "Peek names the kind and version without reading the payload")
-- a paste with header lines, spaces and line breaks still reads
local pasted = "# Alerts from Solex\\n  " .. code:sub(1, 30) .. "\\r\\n" .. code:sub(31, 60) .. " \\n" .. code:sub(61) .. "\\n"
check(same(S.Decode(pasted, "alerts", 1), data), "a code pasted with a # header line and line breaks still reads")

-- Codes that don't read. ----------------------------------------------------------------------------
local function rejects(text, name, want, kind, maxVersion, caps)
  local v, e = S.Decode(text, kind or "alerts", maxVersion or 1, caps)
  check(v == nil and e == want, name .. " (" .. tostring(e) .. ")")
end
rejects("hello there", "text that isn't a code: Not a CRT alerts code", "Not a CRT alerts code.")
rejects("", "empty text is not a code", "Not a CRT alerts code.")
rejects(nil, "nothing pasted is not a code", "Not a CRT alerts code.")
local other = S.Encode("profile", 1, { a = 1 })
rejects(other, "a code of another kind is not an alerts code", "Not a CRT alerts code.")
rejects(S.Encode("alerts", 2, data), "a newer version: Made by a newer CRT", S.TEXT.newer)
check(S.TEXT.newer:find("^Made by a newer CRT") and S.TEXT.damaged:find("^Damaged code"), "the errors read as the spec says")
check(S.Decode(S.Encode("alerts", 2, data), "alerts", 2) ~= nil, "a reader that knows version 2 reads it")
rejects(code:sub(1, #code - 8), "a cut-off code is damaged", S.TEXT.damaged)
local mid = math.floor(#code * 0.7)
rejects(code:sub(1, mid - 1) .. (code:sub(mid, mid) == "A" and "B" or "A") .. code:sub(mid + 1), "a changed code is damaged", S.TEXT.damaged)
rejects("!CRT:alerts:0:" .. code:match("^!CRT:alerts:1:(.*)$"), "version 0 is damaged", S.TEXT.damaged)
rejects("!CRT:alerts:1:" .. b64(GAME.CompressString(GAME.SerializeCBOR("just text"), 1)), "a payload that isn't a table is damaged", S.TEXT.damaged)
rejects("!CRT:alerts:1:" .. b64(GAME.CompressString(GAME.SerializeCBOR({ a = 1 }), 0)), "a payload packed another way is damaged", S.TEXT.damaged)
rejects(code .. string.rep(" ", S.MAX_TEXT), "a paste over the size limit isn't read", S.TEXT.tooLong)

-- The caps: only plain data, never too deep, too wide, too many or too long. ------------------------
local function craft(payload) return "!CRT:alerts:1:" .. b64(GAME.CompressString(GAME.SerializeCBOR(payload), 1)) end
local deep = {} local t = deep for i = 1, 12 do t.x = {} t = t.x end
rejects(craft(deep), "a table nested deeper than the cap is damaged", S.TEXT.damaged)
local wide = {} for i = 1, S.CAPS.entries + 1 do wide[i] = i end
rejects(craft({ list = wide }), "a table with more entries than the cap is damaged", S.TEXT.damaged)
local many = {} for i = 1, 3 do many[i] = {} for j = 1, 40 do many[i][j] = j end end
rejects(craft({ many = many }), "more entries in all than the total cap is damaged", S.TEXT.damaged, nil, nil, { depth = 8, entries = 500, total = 100, string = 100 })
check(S.Decode(craft({ many = many }), "alerts", 1) ~= nil, "the same code reads under the default total cap")
rejects(craft({ text = string.rep("x", S.CAPS.string + 1) }), "text longer than the cap is damaged", S.TEXT.damaged)
rejects(craft({ [string.rep("k", S.CAPS.string + 1)] = 1 }), "a key longer than the cap is damaged", S.TEXT.damaged)
rejects(craft({ a = 1 }), "a caller's own caps apply (depth 1, a table inside fails)", S.TEXT.damaged, nil, nil, { depth = 0 })
check(S.IsPlain({ a = { 1, 2 }, b = "x", c = true }) and not S.IsPlain({ f = print }) and not S.IsPlain({ n = 0/0 }) and not S.IsPlain({ n = math.huge })
  and not S.IsPlain({ [true] = 1 }), "IsPlain takes text, finite numbers, true or false and tables of those, nothing else")
check(S.Encode("bad kind", 1, data) == nil and S.Encode("alerts", 1.5, data) == nil and S.Encode("alerts", 1, "x") == nil, "Encode refuses a bad kind, version or data")

-- No encoding API. -----------------------------------------------------------------------------------
C_EncodingUtil = nil
check(select(2, S.Encode("alerts", 1, data)) == S.TEXT.noApi and select(2, S.Decode(code, "alerts", 1)) == S.TEXT.noApi, "without the game's encoder both say so")
C_EncodingUtil = GAME

-- Profiles packs through the engine, and its texts made the old way still read. -----------------------
assert(load(profilesSrc, "CRT_Core/Profiles.lua"))("CowfeeRaidTools", CRT)
local P = CRT.Profiles
CRTDB = {} CRTDBChar = {}
for _, f in ipairs(eventFrames) do if f.OnEvent then f.OnEvent(f, "ADDON_LOADED", "CowfeeRaidTools") end end
CRT.db = CRTDB
check(not profilesSrc:find("C_EncodingUtil", 1, true), "Profiles.lua no longer calls the game's encoder itself: it goes through CRT.Share")
-- a whole profile as the old code made it: CBOR, the default compression, base64, behind CRTP1:
local oldFull = "CRTP1:" .. GAME.EncodeBase64(GAME.CompressString(GAME.SerializeCBOR({ v = 1, data = { debuffs = { size = 61 }, ui = { font = "Morpheus" } } })))
check(P:Import(oldFull, "From before") == true and CRTDB.profiles["From before"].debuffs.size == 61, "a CRTP1: profile made the old way still imports")
local i = P:Read(oldFull)
check(i and i.kind == "full" and i.parts == 2, "and Read tells it is a whole profile")
-- settings only as the old code made them: header lines, CRTS1:, CBOR, Zlib, base64
local oldShare = "# Cowfee Raid Tools settings\\n# From: Rixxy, 2026-10-01, v1.0.0\\nCRTS1:" .. GAME.EncodeBase64(GAME.CompressString(GAME.SerializeCBOR({ v = 1, kind = "settings", from = "Rixxy", data = { debuffs = { size = 52 } }, unset = {} }), 1))
local si, se = P:Read(oldShare)
check(si and si.kind == "settings" and si.from == "Rixxy" and si.values["debuffs.size"] == 52, "a CRTS1: settings text made the old way still reads (" .. tostring(se) .. ")")
-- and today's exports are byte for byte what the old code made
local full = P:Export()
local fp = GAME.DeserializeCBOR(GAME.DecompressString(GAME.DecodeBase64(full:sub(7))))
check(full:sub(1, 6) == "CRTP1:" and fp.v == 1 and type(fp.data) == "table" and methods[#methods] == "default", "the whole-profile Export keeps its CRTP1: format and the default compression")
local st = P:ExportSettings()
check(st and st:find("\\nCRTS1:") and methods[#methods] == 1 and P:Read(st).kind == "settings", "Export settings only keeps its CRTS1: format, with Zlib")
print(okCount .. " passed, " .. failCount .. " failed")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
for (const p of ['CRT_Core/Core.lua', 'CRT_Core/Share.lua', 'CRT_Core/Profiles.lua']) lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/' + p, 'utf8')));
if (lua.lua_pcall(L, 3, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
