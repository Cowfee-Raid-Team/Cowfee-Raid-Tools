// CRT_Core/Sound/Effects.lua: the sound effects shipped in CRT_Media/Media/Sounds/<Category>, against the files on
// disk (every listed file there, every file listed, no ID3 tag, GEOB or c2pa), their headings in every sound list
// (after the voices, before Game sounds: Short, Impacts, Instruments, Devices), their labels, a crt: reference playing
// the right file, and that they are never a voice's word.
// Usage: node run_sound_effects.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local onDisk, engineSrc, voicesSrc, effectsSrc = ...
local passed, failed = 0, 0
local function check(name, cond, detail)
  if cond then passed = passed + 1 print("ok " .. name) else failed = failed + 1 print("FAIL " .. name .. (detail and (": " .. tostring(detail)) or "")) end
end
local played = {}
function PlaySoundFile(p, channel) played[#played + 1] = { path = p, channel = channel } return true, #played end
function PlaySound() return true end
function StopSound() end
function GetTime() return 0 end
function CreateFrame() return setmetatable({}, { __index = function() return function() end end }) end
SOUNDKIT = { RAID_WARNING = 8959, READY_CHECK = 8960 }
C_VoiceChat = { SpeakText = function() end }
C_TTSSettings = { GetVoiceOptionID = function() return 1 end }
local CRT = { db = { sound = { custom = {}, voice = "xavier" }, ui = { soundChannel = "Dialog" } }, Print = function() end }
for i, src in ipairs({ engineSrc, voicesSrc }) do assert(load(src, "@f" .. i))("CowfeeRaidTools", CRT) end
local voiceCount = #CRT.Sound.BUNDLED
check("Effects.lua loads", effectsSrc ~= "" and pcall(assert(load(effectsSrc, "@Effects.lua")), "CowfeeRaidTools", CRT))
local Sound = CRT.Sound
local E = Sound.EFFECTS
check("the effects table", type(E) == "table" and #E == 4)
if type(E) ~= "table" or #E ~= 4 then print(passed .. " passed, " .. failed .. " failed") error("no effects table") end

-- The table against the files on disk ------------------------------------------------------------------
local keys, sizes = {}, {}
for i, c in ipairs(E) do keys[i] = c.key .. "/" .. c.label .. "/" .. c.folder sizes[i] = #c.files end
check("the four categories, in order", table.concat(keys, ",") == "short/Short/Short,impacts/Impacts/Impacts,instruments/Instruments/Instruments,devices/Devices/Devices", table.concat(keys, ","))
check("26, 10, 12 and 11 sounds: 59", table.concat(sizes, ",") == "26,10,12,11", table.concat(sizes, ","))
for _, c in ipairs(E) do
  local files, missing, extra, listed, tagged = onDisk[c.folder] or {}, {}, {}, {}, {}
  for _, f in ipairs(c.files) do
    listed[f.name .. ".mp3"] = true
    if not files[f.name .. ".mp3"] then missing[#missing + 1] = f.name end
  end
  for name, f in pairs(files) do
    if not listed[name] then extra[#extra + 1] = name end
    if f.tag or f.meta then tagged[#tagged + 1] = name end
    if not f.sync then tagged[#tagged + 1] = name .. " (no audio frame first)" end
  end
  check(c.folder .. ": every listed sound has its file", #missing == 0, table.concat(missing, ","))
  check(c.folder .. ": every file is listed", #extra == 0, table.concat(extra, ","))
  check(c.folder .. ": no file has an ID3 tag or a GEOB or c2pa frame, and each starts on an audio frame", #tagged == 0, table.concat(tagged, ","))
  local unlabelled = {}
  for _, f in ipairs(c.files) do if type(f.label) ~= "string" or f.label == "" then unlabelled[#unlabelled + 1] = f.name end end
  check(c.folder .. ": every sound has a label", #unlabelled == 0, table.concat(unlabelled, ","))
end

-- In the sound lists ---------------------------------------------------------------------------------
check("each sound is in Sound.BUNDLED, after the voices", #Sound.BUNDLED == voiceCount + 59 and Sound.BUNDLED[voiceCount + 1].name == "Short-BellStrike", #Sound.BUNDLED - voiceCount)
local list = Sound:Choices({ none = "None" })
local order, at = {}, {}
for i, c in ipairs(list) do if c.title then order[#order + 1] = c.label at[c.label] = i end end
check("headings: the voices, Short, Impacts, Instruments, Devices, then Game sounds", table.concat(order, ",") == "Xavier,Lola,Short,Impacts,Instruments,Devices,Game sounds", table.concat(order, ","))
check("Short's sounds under Short", list[at.Short + 1].key == "crt:Short-BellStrike" and at.Impacts - at.Short - 1 == 26, list[at.Short + 1].key)
check("Devices' sounds under Devices, then Game sounds", list[at.Devices + 1].key == "crt:Devices-AirHorn" and at["Game sounds"] - at.Devices - 1 == 11)
local t2 = {}
for _, c in ipairs(Sound:Choices({ filesOnly = true })) do if c.title then t2[#t2 + 1] = c.label end end
check("files only (aura sounds): the same headings, no Game sounds", table.concat(t2, ",") == "Xavier,Lola,Short,Impacts,Instruments,Devices", table.concat(t2, ","))
local labels = {}
for _, c in ipairs(list) do if c.key then labels[c.key] = c.label end end
check("labels", labels["crt:Devices-AirHorn"] == "Air horn" and labels["crt:Short-CowBell"] == "Cowbell" and labels["crt:Devices-TrashcanLid"] == "Trash can lid"
  and labels["crt:Impacts-PopClick"] == "Pop click" and labels["crt:Instruments-Warhorn"] == "War horn",
  tostring(labels["crt:Devices-AirHorn"]) .. " " .. tostring(labels["crt:Short-CowBell"]) .. " " .. tostring(labels["crt:Instruments-Warhorn"]))
check("a chosen effect names its category", Sound:Label("crt:Devices-AirHorn") == "Devices: Air horn", Sound:Label("crt:Devices-AirHorn"))

-- Playing ---------------------------------------------------------------------------------------------
local horn = Sound:Resolve("crt:Devices-AirHorn")
check("crt:Devices-AirHorn is Devices' AirHorn.mp3", horn and horn.kind == "file" and horn.paths[1] == Sound.BUNDLED_FOLDER .. "Devices\\\\AirHorn.mp3", horn and horn.paths[1])
local a, b = Sound:Resolve("crt:Short-StovePipe"), Sound:Resolve("crt:Devices-StovePipe")
check("the two StovePipes are two files, told apart by their folder", a and b and a.paths[1] ~= b.paths[1] and a.paths[1]:find("Short", 1, true) ~= nil)
Sound:Play("crt:Impacts-AnvilStrike")
local last = played[#played]
check("it plays its file", last and last.path == Sound.BUNDLED_FOLDER .. "Impacts\\\\AnvilStrike.mp3", last and last.path)

-- Sounds, not speech ------------------------------------------------------------------------------------
check("no effect is a voice's word", Sound:ClipFor("Air horn") == nil and Sound:ClipFor("Cowbell") == nil and Sound:ClipFor("Triangle") == nil)
local words = 0
for _, v in ipairs(Sound.VOICES) do words = words + #v.words end
check("the voices keep their 70 words each", words == 140, words)
print(passed .. " passed, " .. failed .. " failed")
if failed > 0 then error(failed .. " checks failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
function id3Length(b) { return b.length >= 10 && b.slice(0, 3).toString() === 'ID3' ? 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]) + ((b[5] & 0x10) ? 10 : 0) : 0; }
// the files on disk, by folder: { Short = { ["BellStrike.mp3"] = { tag, meta, sync }, ... } }
lua.lua_newtable(L);
for (const v of ['Short', 'Impacts', 'Instruments', 'Devices']) {
  lua.lua_newtable(L);
  const dir = path.join(d, 'CRT_Media', 'Media', 'Sounds', v);
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const b = fs.readFileSync(path.join(dir, f));
    lua.lua_newtable(L);
    lua.lua_pushboolean(L, id3Length(b) > 0 ? 1 : 0); lua.lua_setfield(L, -2, to_luastring('tag'));
    lua.lua_pushboolean(L, (b.indexOf('GEOB') >= 0 || b.indexOf('c2pa') >= 0) ? 1 : 0); lua.lua_setfield(L, -2, to_luastring('meta'));
    lua.lua_pushboolean(L, (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) ? 1 : 0); lua.lua_setfield(L, -2, to_luastring('sync'));
    lua.lua_setfield(L, -2, to_luastring(f));
  }
  lua.lua_setfield(L, -2, to_luastring(v));
}
const files = ['CRT_Core/Sound/Engine.lua', 'CRT_Core/Sound/Voices.lua', 'CRT_Core/Sound/Effects.lua'];
for (const f of files) { const p = path.join(d, f); lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '')); }
if (lua.lua_pcall(L, files.length + 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
