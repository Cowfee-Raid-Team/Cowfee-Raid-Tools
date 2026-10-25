// CRT_Core/Profiles.lua, Export settings only and its import: the allow-list guard against Core.lua's defaults,
// what is never shared, the round trip, the preview, Keep my window positions, the backup and Undo, and
// damaged, cut-off, wrong-typed and newer strings changing nothing. The game's C_EncodingUtil is stood in for
// by a small serializer, a checksummed "compressor" and real base64 written here.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local coreSrc, profilesSrc, shareSrc = ...
local failCount, okCount = 0, 0
local function check(cond, name) if cond then okCount = okCount + 1 print("ok " .. name) else failCount = failCount + 1 print("FAIL " .. name) end end
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
date, time = os.date, os.time
local reloads = 0
function ReloadUI() reloads = reloads + 1 end
function UnitName() return "Solex" end
function GetRealmName() return "Silvermoon" end
-- Core.lua needs fonts and a frame for ADDON_LOADED.
local eventFrames = {}
function CreateFrame() local f = { RegisterEvent = function() end, UnregisterEvent = function() end } f.SetScript = function(self, _, fn) self.OnEvent = fn end eventFrames[#eventFrames + 1] = f return f end
local function fontObject() local o = { path = "f", size = 12, flags = "" }
  function o:CopyFontObject() end function o:GetFont() return self.path, self.size, self.flags end
  function o:SetFont(p, s, fl) self.path, self.size, self.flags = p, s, fl end
  function o:GetTextColor() return 1, 1, 1 end function o:SetTextColor() end return o end
function CreateFont(name) local o = fontObject() _G[name] = o return o end
GameFontNormal, GameFontHighlight, GameFontDisable, GameFontHighlightSmall, GameFontDisableSmall, GameFontNormalLarge, GameFontNormalSmall, ChatFontNormal = fontObject(), fontObject(), fontObject(), fontObject(), fontObject(), fontObject(), fontObject(), fontObject()
Enum = { CompressionMethod = { Deflate = 0, Zlib = 1, Gzip = 2 } }

-- The stand-in encoder. -------------------------------------------------------------------------
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
  CompressString = function(s, method) methods[#methods + 1] = method return "Z" .. sum(s) .. ":" .. s end,
  DecompressString = function(s, method)
    local c, body = s:match("^Z(%d+):(.*)$")
    if not c or tonumber(c) ~= sum(body) then error("checksum") end
    return body
  end,
  EncodeBase64 = function(s) return b64(s) end,
  DecodeBase64 = function(s) return unb64(s) end,
}
C_EncodingUtil = GAME
-- A string made by hand, as a sender with a changed copy would: header lines, then the block.
local function craft(payload) return "# Cowfee Raid Tools settings\\n# From: X, today, v9\\nCRTS1:" .. GAME.EncodeBase64(GAME.CompressString(GAME.SerializeCBOR(payload), 1)) end
local function payloadOf(text) local block = text:match("CRTS1:(%S+)") return GAME.DeserializeCBOR(GAME.DecompressString(GAME.DecodeBase64(block), 1)) end

local CRT = {}
assert(load(coreSrc, "CRT_Core/Core.lua"))("CowfeeRaidTools", CRT)
function CRT:ResolveTheme(ui) return ui.theme or "blizzard" end
function CRT:UseTheme() end
CRT.PALETTE = {}
-- UI/Panel.lua's layer keys and strata, for the ui.layers check
CRT.UI = { STRATA = {}, LAYERS = {} }
for _, s in ipairs({ "BACKGROUND", "LOW", "MEDIUM", "HIGH", "DIALOG", "FULLSCREEN", "FULLSCREEN_DIALOG", "TOOLTIP" }) do table.insert(CRT.UI.STRATA, { key = s }) end
for _, k in ipairs({ "panel", "notes", "alert", "popups" }) do table.insert(CRT.UI.LAYERS, { key = k }) end
assert(load(shareSrc, "CRT_Core/Share.lua"))("CowfeeRaidTools", CRT) -- the share engine Profiles packs through
assert(load(profilesSrc, "CRT_Core/Profiles.lua"))("CowfeeRaidTools", CRT)
local P = CRT.Profiles
local paths0 = {} for _, e in ipairs(P.ShareEntries()) do paths0[e.path] = e end
local function boot(db, char) CRTDB = db CRTDBChar = char for _, f in ipairs(eventFrames) do if f.OnEvent then f.OnEvent(f, "ADDON_LOADED", "CowfeeRaidTools") end end CRT.db = CRTDB end
local function copy(v) if type(v) ~= "table" then return v end local o = {} for k, x in pairs(v) do o[k] = copy(x) end return o end
local function same(a, b)
  if type(a) ~= type(b) then return false end
  if type(a) ~= "table" then return a == b end
  for k, v in pairs(a) do if not same(v, b[k]) then return false end end
  for k in pairs(b) do if a[k] == nil then return false end end
  return true
end

-- The allow-list guard. ---------------------------------------------------------------------------
-- Tooltip position and its spot, General Settings' and each area's, travel with the settings
for path, def in pairs({ ["ui.tooltipMode"] = "spot", ["ui.tooltipSpot"] = "auto", ["loot.tooltipMode"] = "general", ["loot.tooltipSpot"] = "auto",
    ["lootmaster.tooltipMode"] = "general", ["lootmaster.tooltipSpot"] = "auto", ["lootmaster.itemTooltip"] = "area",
    ["timeline.tooltipMode"] = "general", ["timeline.tooltipSpot"] = "auto" }) do
  check(paths0[path] ~= nil and paths0[path].default == def, path .. " is shared, a plain setting with its default " .. def)
end
check(P.SHARE.lootmaster.tooltipMode == true and P.SHARE.lootmaster.tooltipSpot == true and P.SHARE.lootmaster.itemTooltip == true, "the Loot Master overrides are named in the mixed lootmaster rule")
check(P.SHARE.timeline.tooltipMode == true and P.SHARE.timeline.tooltipSpot == true, "the Timeline's Tooltip position is named in the mixed timeline rule")
for _, old in ipairs({ "lootmaster.tooltipAnchor", "ui.tooltipAnchor", "loot.tooltipPosition", "lootmaster.tooltipPosition" }) do
  check(paths0[old] == nil, old .. ", an old field read once into the new ones, is no longer shared")
end
-- the old Tooltip position fields are read once, on load: General Settings' tooltipAnchor ("game" stays the game's
-- spot, anything else is next to what you hover, each on its own side) and each area's tooltipPosition ("owner" is "spot")
for _, c in ipairs({ { "game", "game" }, { "owner", "spot" }, { "nonsense", "spot" }, { nil, "spot" } }) do
  boot({ ui = { tooltipAnchor = c[1] } }, {})
  check(CRTDB.ui.tooltipMode == c[2] and CRTDB.ui.tooltipSpot == "auto", "General Settings: an old " .. tostring(c[1]) .. " becomes " .. c[2] .. " on auto (got " .. tostring(CRTDB.ui.tooltipMode) .. " " .. tostring(CRTDB.ui.tooltipSpot) .. ")")
  check(CRTDB.ui.tooltipAnchor == c[1], "General Settings: the old field is kept as it was (" .. tostring(c[1]) .. ")")
end
boot({ ui = { tooltipAnchor = "game", tooltipMode = "cursor" } }, {})
check(CRTDB.ui.tooltipMode == "cursor", "General Settings: the old field is read only once, never over the new one")
for _, tbl in ipairs({ "loot", "lootmaster" }) do
  for _, c in ipairs({ { "owner", "spot" }, { "game", "game" }, { "cursor", "cursor" }, { "general", "general" }, { "nonsense", "general" }, { nil, "general" } }) do
    boot({ [tbl] = { tooltipPosition = c[1] } }, {})
    check(CRTDB[tbl].tooltipMode == c[2] and CRTDB[tbl].tooltipSpot == "auto", tbl .. ": an old " .. tostring(c[1]) .. " becomes " .. c[2] .. " (got " .. tostring(CRTDB[tbl].tooltipMode) .. ")")
    check(CRTDB[tbl].tooltipPosition == c[1], tbl .. ": the old field is kept as it was")
  end
  boot({ [tbl] = { tooltipPosition = "game", tooltipMode = "spot" } }, {})
  check(CRTDB[tbl].tooltipMode == "spot", tbl .. ": the old field is read only once, never over the new one")
end
check(paths0["lootmaster.tooltipAnchor"] == nil, "the old item-tab field is no longer shared (it is read once, into itemTooltip)")
-- the old Loot Master item-tab setting (lootmaster.tooltipAnchor) moves to lootmaster.itemTooltip once, on load
for _, c in ipairs({ { "right", "right" }, { "topcenter", "topcenter" }, { "default", "game" }, { "left", "area" }, { nil, "area" } }) do
  boot({ lootmaster = { tooltipAnchor = c[1] } }, {})
  check(CRTDB.lootmaster.itemTooltip == c[2], "item tabs: an old " .. tostring(c[1]) .. " becomes " .. c[2] .. " (got " .. tostring(CRTDB.lootmaster.itemTooltip) .. ")")
  check(CRTDB.lootmaster.tooltipAnchor == c[1], "item tabs: the old field is kept as it was (" .. tostring(c[1]) .. ")")
end
boot({ lootmaster = { tooltipAnchor = "right", itemTooltip = "bottomleft" } }, {})
check(CRTDB.lootmaster.itemTooltip == "bottomleft", "item tabs: the old field is read only once, never over the new one")
boot({}, {})
check(CRTDB.lootmaster.itemTooltip == "area" and CRTDB.lootmaster.tooltipMode == "general" and CRTDB.loot.tooltipMode == "general"
  and CRTDB.ui.tooltipMode == "spot" and CRTDB.ui.tooltipSpot == "auto" and CRTDB.loot.tooltipSpot == "auto" and CRTDB.lootmaster.tooltipSpot == "auto"
  and CRTDB.timeline.tooltipMode == "general" and CRTDB.timeline.tooltipSpot == "auto", "a fresh install: the defaults")
check(CRTDB.ui.tooltipAnchor == nil and CRTDB.loot.tooltipPosition == nil and CRTDB.lootmaster.tooltipPosition == nil, "a fresh install: no old field is written")
-- the note callout's look, new in this version: a fresh install takes the defaults (20, no outline); a save from
-- before it keeps the look it had, once: the size the addon's large font is drawn at (CRTFontLarge, after its
-- text size) and General Settings' outline
check(CRTDB.notes.alert.fontSize == 20 and CRTDB.notes.alert.outline == "", "a fresh install: the callout at 20, no outline")
for _, c in ipairs({ { nil, "OUTLINE" }, { 22, "THICKOUTLINE" }, { 10, "" }, { 14, "nonsense" } }) do
  boot({ notes = { alert = { enabled = true, tts = true } }, ui = { fontSize = c[1], outline = c[2] } }, {})
  local _, size = CRTFontLarge:GetFont()
  local want = c[2] == "nonsense" and "" or c[2]
  check(CRTDB.notes.alert.fontSize == math.floor(size + 0.5) and CRTDB.notes.alert.outline == want,
    "a save from before: the callout keeps its look at text size " .. tostring(c[1]) .. " (" .. tostring(CRTDB.notes.alert.fontSize) .. " for " .. size .. ", " .. tostring(CRTDB.notes.alert.outline) .. ")")
end
local big = CRTDB.notes.alert.fontSize
boot({ notes = { alert = { enabled = true } }, ui = { fontSize = 22 } }, {})
check(CRTDB.notes.alert.fontSize > big, "a larger text size, a larger callout")
boot({ notes = { alert = { enabled = true, fontSize = 33, outline = "" } }, ui = { fontSize = 22, outline = "OUTLINE" } }, {})
check(CRTDB.notes.alert.fontSize == 33 and CRTDB.notes.alert.outline == "", "read only once: a chosen size and outline stay")
check(P.ShareUncovered and #P.ShareUncovered() == 0, "every saved key in Core.lua's defaults is shared or named as not shared" .. (P.ShareUncovered and (": missing " .. table.concat(P.ShareUncovered(), ", ")) or ""))
if P.ShareUncovered then
  CRT.defaults.brandNew = { x = 1 }
  CRT.defaults.notes.brandNewToo = true
  CRT.defaults.qol.lowHealth.brandNewThree = 1
  local miss = table.concat(P.ShareUncovered(), ",")
  check(miss:find("brandNew", 1, true) and miss:find("notes.brandNewToo", 1, true), "a new top-level key, or a new key under a mixed table, fails the guard (" .. miss .. ")")
  check(miss:find("qol.lowHealth.brandNewThree", 1, true), "a new key under a nested table rule fails the guard too")
  CRT.defaults.brandNew = nil CRT.defaults.notes.brandNewToo = nil CRT.defaults.qol.lowHealth.brandNewThree = nil
end
do
  local paths = {}
  for _, e in ipairs(P.ShareEntries and P.ShareEntries() or {}) do paths[e.path] = e end
  local bad = {}
  for _, p in ipairs(P.POSITIONS or {}) do if not (paths[p] and paths[p].position) then bad[#bad + 1] = p end end
  check(P.ShareEntries and #bad == 0, "every window position is a shared path (" .. table.concat(bad, ",") .. ")")
  for p in pairs(P.LATE_SETTINGS or {}) do if not paths[p] then bad[#bad + 1] = p end end
  check(#bad == 0, "every late setting is a shared path")
  local leaked = {}
  for p in pairs(paths) do for _, no in ipairs({ "notes.list", "groups.presets", "late.history", "tattle.history", "alerts.reminders", "alerts.saved", "timeline.bosses", "lootmaster.authority", "classCache", "importBackup",
      "readycheck.output", "readycheck.earlyPullOutput", "tattle.output", "tattle.autoPost", "tattle.season", "lootmaster.awardChannel", "lootmaster.awardMessage", "lootmaster.responses",
      "notes.trustedOnly", "sound", "qol.lowHealth.customSounds", "seasonStats", "whatsNew", "alerts.specialView", "alerts.specialViewPicked", "groups.roles", "timeline.popView" }) do
    if p == no or p:sub(1, #no + 1) == no .. "." then leaked[#leaked + 1] = p end end end
  check(#leaked == 0, "no excluded data, report output, trust setting or sound file name is a shared path (" .. table.concat(leaked, ",") .. ")")
  local kept = {}
  for _, want in ipairs({ "consumables.categoryOrder", "consumables.itemOrder", "tattle.custom", "markers.disabled", "alerts.areas.timeline.lineColor", "qol.lowHealth.soundChoice", "alerts.special" }) do
    if not paths[want] then kept[#kept + 1] = want end
  end
  check(#kept == 0, "consumables order, Tattlebot spells, marker switches, the timeline line colour and the sound choice are shared (" .. table.concat(kept, ",") .. ")")
  -- the team raid check's threshold and the two "Only record team raids" switches are settings: shared
  check(paths["team.threshold"] ~= nil and paths["team.threshold"].default == 0.75, "the team raid threshold is shared, with its default 75%")
  check(paths["tattle.onlyTeam"] ~= nil and paths["tattle.onlyTeam"].default == true, "Tattlebot's Only record team raids is shared, on by default")
  check(paths["late.onlyTeam"] ~= nil and paths["late.onlyTeam"].default == true, "the Late Tracker's Only record team raids is shared, on by default")
  check(paths["seasonStats.show"] == nil, "Season Stats' Show stays with its data, never shared")
  -- the Gear Checker's extra filters are settings: each tick and the level travel with the settings
  for path, def in pairs({ ["gearChecker.extra.upgrade"] = false, ["gearChecker.extra.ilvl"] = false, ["gearChecker.extra.quality"] = false,
      ["gearChecker.extra.empty"] = false, ["gearChecker.extra.minIlvl"] = 0 }) do
    check(paths[path] ~= nil and paths[path].default == def, path .. " is shared, with its default " .. tostring(def))
  end
  check(paths["gearChecker.filter"] == nil, "the Gear Checker's picked chip stays page state")
end

-- The sender: a profile with settings, positions and data. --------------------------------------
boot({}, {})
local db = CRTDB
check(type(db.importBackup) == "table" and next(db.importBackup) == nil, "importBackup has an empty default")
db.debuffs.size = 50 db.ui.font = "Morpheus" db.ui.fontSize = 16 db.readycheck.window.columns.food = false
db.alerts.bars.position = { point = "CENTER", relativePoint = "CENTER", x = 10, y = -20 }
db.debuffs.position = { point = "TOP", relativePoint = "TOP", x = 3, y = 4 }
db.ui.layers.panel = "DIALOG" db.markers.disabled[3001] = true
db.notes.list[1] = { text = "secret note" } db.notes.personalText = "my secret" db.notes.history[1] = { { text = "secret earlier note text", at = 1, how = "edited" } } db.groups.presets[1] = { name = "secret layout" }
db.late.history[1] = { secret = true } db.tattle.history[1] = { secret = true } db.alerts.reminders[1] = { text = "secret reminder" }
db.alerts.saved[1] = { name = "secret alert" } db.classCache.Someone = "MAGE" db.lootmaster.authority.names.Friend = true
db.ui.settingsTab = "profiles" db.lastPage = "notes"
db.readycheck.output = "raid" db.tattle.output = "officer" db.tattle.autoPost = true db.lootmaster.awardChannel = "GUILD" db.lootmaster.awardMessage = "secret message"
db.notes.trustedOnly = false db.sound.custom[1] = "secretfile.ogg" db.qol.lowHealth.customSounds[1] = "secretpulse.ogg" db.qol.lowHealth.soundChoice = "file:secretpulse.ogg"
db.tattle.season = "secret season" db.lootmaster.responses = { { key = "secretneed" } } db.tattle.custom[12345] = "Soak" db.consumables.categoryOrder = { "flask", "food" }
db.alerts.areas.timeline.lineColor = { 0.2, 0.4, 0.6, 1 }
db.alerts.special[3001] = { soaks = { on = true, show = { alert = true, bar = false }, speak = true, markers = false } } db.alerts.specialView = "special"
db.seasonStats.bosses[3001] = { name = "secret season boss", mythic = { pulls = 118 } } db.seasonStats.filled = true -- Season Stats' counters are data
db.debuffs.ignored[389123] = true db.debuffs.ignored[442611] = true -- your own ignored debuffs travel with the settings
db.debuffs.tooltips = true db.debuffs.tooltipMode = "cursor" db.debuffs.tooltipSpot = "top" -- the panel's tooltips, like its other look settings
-- a saved value without its default's shape is left out and counted
db.debuffs.maxCount = "four"
local text, err = P:ExportSettings()
check(type(text) == "string", "Export settings only gives a string (" .. tostring(err) .. ")")
check(err == 1, "a saved value with the wrong shape is left out and counted (got " .. tostring(err) .. ")")
db.debuffs.maxCount = 4
text = text or ""
local lines = {} for l in text:gmatch("[^\\n]+") do lines[#lines + 1] = l end
check(lines[1] == "# Cowfee Raid Tools settings", "first header line")
check(lines[2] and lines[2]:find("^# From: Solex, %d%d%d%d%-%d%d%-%d%d, v"), "From header line: " .. tostring(lines[2]))
check(lines[3] and lines[3]:find("^CRTS1:"), "the block starts with CRTS1:")
check(methods[#methods] == 1, "settings strings compress with Zlib, for its checksum")
local sent = text ~= "" and payloadOf(text) or {}
check(sent.v == 1 and sent.kind == "settings" and sent.from == "Solex" and type(sent.data) == "table", "payload version, kind, sender")
local flat = GAME.SerializeCBOR(sent)
check(not flat:find("secret", 1, true), "no note, note history, layout, history, reminder, saved alert or Season Stats counter is exported")
check(sent.data.seasonStats == nil, "Season Stats is kept back")
check(sent.data.whatsNew == nil, "What's new (Show after updates, the version seen) is kept back")
check(not flat:find("Someone", 1, true) and not flat:find("Friend", 1, true), "no class cache or loot authority is exported")
check(not flat:find("settingsTab", 1, true) and not flat:find("lastPage", 1, true), "no page state is exported")
check(not flat:find("GUILD", 1, true) and not flat:find("officer", 1, true) and sent.data.readycheck.output == nil and sent.data.tattle.autoPost == nil and sent.data.notes.trustedOnly == nil, "no report output, auto-post or note trust setting is exported")
check(sent.data.qol.lowHealth.soundChoice == nil and sent.data.sound == nil, "no sound file name, and no sound choice naming your own file, is exported")
check(sent.data.tattle.custom[12345] == "Soak" and sent.data.consumables.categoryOrder[1] == "flask" and sent.data.alerts.areas.timeline.lineColor[3] == 0.6, "Tattlebot spells, consumables order and the timeline line colour are exported")
check(sent.data.alerts.special and sent.data.alerts.special[3001] and sent.data.alerts.special[3001].soaks.on == true and sent.data.alerts.special[3001].soaks.show.bar == false
  and sent.data.alerts.specialView == nil, "your special alerts' choices are exported with the other alert settings, the list's page state is not")
check(sent.data.debuffs and sent.data.debuffs.ignored and sent.data.debuffs.ignored[389123] == true and sent.data.debuffs.ignored[442611] == true, "your ignored debuffs are exported")
check(sent.data.debuffs and sent.data.debuffs.tooltips == true and sent.data.debuffs.tooltipMode == "cursor" and sent.data.debuffs.tooltipSpot == "top", "the debuff panel's tooltips and their position are exported")
check(sent.data.debuffs and sent.data.debuffs.size == 50 and sent.data.ui.fontSize == 16 and sent.data.alerts.bars.position.x == 10, "settings, a late setting and a position are exported")
local senderValues = {}
for _, e in ipairs(P.ShareEntries and P.ShareEntries() or {}) do
  local t = db for k in e.path:gmatch("[^.]+") do t = type(t) == "table" and t[k] or nil end
  senderValues[e.path] = copy(t)
end

-- The raider: a fresh profile, with a window of their own moved. ---------------------------------
boot({}, {})
local alt = CRTDB
alt.notes.window.position = { point = "LEFT", relativePoint = "LEFT", x = 1, y = 2 }
alt.debuffs.position = { point = "BOTTOM", relativePoint = "BOTTOM", x = 7, y = 8 }
alt.notes.list[5] = { text = "raider note" }
local before = copy(alt)
local info, rerr = P.Read and P:Read(text)
check(info and info.kind == "settings" and info.from == "Solex" and info.unknown == 0, "Read: a settings string from Solex, nothing unknown (" .. tostring(rerr) .. ", " .. tostring(info and info.kind) .. " " .. tostring(info and info.from) .. " " .. tostring(info and info.unknown) .. ")")
check(same(alt, before), "Read changes nothing")
local diff = info and P:Diff(info, false) or {}
local labels = {} for _, d in ipairs(diff) do labels[#labels + 1] = d.text end
local all = table.concat(labels, "\\n")
check(all:find("Debuffs > size: 44 -> 50", 1, true), "the diff names a setting with old -> new (" .. (labels[1] or "none") .. ")")
check(all:find("General > font: default -> Morpheus", 1, true), "the diff shows text values")
check(all:find("Ready Check > window > columns > food: on -> off", 1, true), "the diff shows on and off")
check(all:find("Raid Notes > window > position", 1, true), "the diff lists a position the sender doesn't have as going back to default")
local keepDiff = info and P:Diff(info, true) or {}
local keepAll = {} for _, d in ipairs(keepDiff) do keepAll[#keepAll + 1] = d.text end
keepAll = table.concat(keepAll, "\\n")
check(#keepDiff < #diff and not keepAll:find("position", 1, true) and keepAll:find("Debuffs > size", 1, true), "Keep my window positions leaves positions out of the diff")

-- Keep my window positions. ----------------------------------------------------------------------
if info then P:ApplySettings(info, true) end
check(reloads == 1, "applying reloads")
check(alt.debuffs.size == 50 and alt.ui.font == "Morpheus" and alt.ui.fontSize == 16 and alt.readycheck.window.columns.food == false and alt.ui.layers.panel == "DIALOG" and alt.markers.disabled[3001] == true, "applied: the settings match the sender's")
check(alt.debuffs.ignored[389123] == true and alt.debuffs.ignored[442611] == true, "applied: the sender's ignored debuffs come across")
check(alt.debuffs.tooltips == true and alt.debuffs.tooltipMode == "cursor" and alt.debuffs.tooltipSpot == "top", "applied: the sender's debuff tooltips come across")
check(alt.debuffs.position.x == 7 and alt.notes.window.position.x == 1 and alt.alerts.bars.position == nil, "kept: the raider's window positions stay")
check(alt.notes.list[5] and alt.notes.list[5].text == "raider note" and alt.notes.list[1] == nil, "the raider's notes are untouched")
check(P:HasBackup(), "a backup is kept")
check(alt.importBackup.from == "Solex", "the backup says whose import it was")

-- Undo puts everything back. ---------------------------------------------------------------------
P:UndoImport()
check(reloads == 2, "undo reloads")
local back = copy(alt) back.importBackup = nil local was = copy(before) was.importBackup = nil
check(same(back, was), "undo restores the profile as it was before the import")
check(not P:HasBackup(), "after undo there is no backup, so Undo is greyed")

-- Without keeping positions: the round trip gives the sender's settings, positions and all. --------
info = P:Read(text)
P:ApplySettings(info, false)
local mismatch = {}
for _, e in ipairs(P.ShareEntries()) do
  local t = alt for k in e.path:gmatch("[^.]+") do t = type(t) == "table" and t[k] or nil end
  local sv = senderValues[e.path]
  if type(sv) == "string" and sv:find("^file:") then
    if t ~= "pulse" then mismatch[#mismatch + 1] = e.path .. " (the raider's own sound choice stays)" end
  elseif not same(t, sv) then mismatch[#mismatch + 1] = e.path end
end
check(#mismatch == 0, "round trip: every shared setting equals the sender's (" .. table.concat(mismatch, ",") .. ")")
check(alt.notes.window.position == nil and alt.debuffs.position.x == 3, "positions follow the sender, one the sender never moved goes back to default")
local applied = copy(alt)
P:UndoImport()
check(alt.notes.window.position and alt.notes.window.position.x == 1 and alt.debuffs.position.x == 7 and alt.debuffs.size == 44, "undo brings back a position the import cleared")

-- Bad strings change nothing. ---------------------------------------------------------------------
local now = copy(alt)
local function rejects(t, name, want)
  local i, e = P:Read(t)
  check(i == nil and type(e) == "string" and (not want or e:find(want, 1, true)) and same(alt, now), name .. " (" .. tostring(e) .. ")")
end
rejects(text:sub(1, #text - 12), "a cut-off string is rejected", P.TEXT.damaged)
local mid = math.floor(#text * 0.7)
rejects(text:sub(1, mid - 1) .. (text:sub(mid, mid) == "A" and "B" or "A") .. text:sub(mid + 1), "a changed string is rejected", P.TEXT.damaged)
rejects("hello there", "text that isn't ours is rejected", P.TEXT.notOurs)
rejects("", "empty text is rejected")
rejects(craft({ v = 1, kind = "settings", from = "X", data = { debuffs = { size = "big" } } }), "a wrong type is rejected", "debuffs.size")
rejects(craft({ v = 1, kind = "settings", from = "X", data = { readycheck = { window = { columns = "all" } } } }), "a wrong type higher up is rejected", "readycheck.window.columns")
rejects(craft({ v = 1, kind = "settings", from = "X", data = { debuffs = { position = { a = { b = { c = { d = { e = { f = 1 } } } } } } } } }), "a too deep table is rejected", "debuffs.position")
rejects(craft({ v = 1, kind = "settings", from = "X", data = { ui = { font = string.rep("x", 400) } } }), "an over-long text is rejected", "ui.font")
rejects(craft({ v = 2, kind = "settings", from = "X", data = {} }), "a newer version is rejected", P.TEXT.newer)
local function bad(data, name, path) rejects(craft({ v = 1, kind = "settings", from = "X", data = data }), name, path) end
bad({ alerts = { bars = { barColor = { "red", 0, 0, 1 } } } }, "a colour with a text entry is rejected", "alerts.bars.barColor")
bad({ alerts = { bars = { textColor = { 1, 1, 1, 1, 1 } } } }, "a colour longer than its default is rejected", "alerts.bars.textColor")
bad({ alerts = { areas = { circles = { ringColor = { r = 1 } } } } }, "a colour keyed by name is rejected", "alerts.areas.circles.ringColor")
bad({ alerts = { areas = { timeline = { lineColor = { 2, 0, 0 } } } } }, "a line colour out of 0 to 1 is rejected", "alerts.areas.timeline.lineColor")
bad({ window = { relativePoint = "MIDDLE" } }, "the main window's relativePoint must be an anchor name", "window.relativePoint")
bad({ window = { x = "10" } }, "the main window's x must be a number", "window.x")
bad({ debuffs = { position = { point = "TOP", relativePoint = "SIDEWAYS", x = 1, y = 2 } } }, "a position's relativePoint must be an anchor name", "debuffs.position")
bad({ timeline = { popout = { width = "wide", height = 600 } } }, "a window size must be a number", "timeline.popout")
bad({ timeline = { popout = { width = 900, height = 600, userSized = "yes" } } }, "a pop-out's userSized must be true or false", "timeline.popout")
do
  -- a pop-out's size chosen with its grip travels with it (UI/Window.lua's userSized)
  local i = P:Read(craft({ v = 1, kind = "settings", from = "X", data = { timeline = { popout = { width = 900, height = 600, userSized = true } } } }))
  check(i and i.unknown == 0 and i.values["timeline.popout"].userSized == true, "a pop-out's userSized is read with its size")
  -- the Timeline pop-out keeps a size for each view (Timeline/Page.lua): they travel with it too
  i = P:Read(craft({ v = 1, kind = "settings", from = "X", data = { timeline = { popout = { width = 900, height = 600,
    abilities = { width = 1000, height = 700, userSized = true }, healers = {} } } } }))
  local pop = i and i.values["timeline.popout"]
  check(pop and i.unknown == 0 and pop.abilities.width == 1000 and pop.abilities.userSized == true and type(pop.healers) == "table",
    "a pop-out's per-view sizes are read with it")
end
bad({ timeline = { popout = { abilities = { width = "wide" } } } }, "a view's size must be a number", "timeline.popout")
bad({ timeline = { popout = { healers = { userSized = 1 } } } }, "a view's userSized must be true or false", "timeline.popout")
bad({ timeline = { popout = { healers = 5 } } }, "a view's size must be a table", "timeline.popout")
bad({ ui = { layers = { panel = "ON_TOP" } } }, "a layer must be one of the game's strata", "ui.layers")
bad({ ui = { fontSize = "big" } }, "a late setting of the wrong type is rejected", "ui.fontSize")
bad({ debuffs = { ignored = { abc = true } } }, "an ignored debuff keyed by text is rejected", "debuffs.ignored")
bad({ debuffs = { ignored = { [0] = true } } }, "an ignored debuff with spell ID 0 is rejected", "debuffs.ignored")
bad({ debuffs = { ignored = { [-5] = true } } }, "a negative spell ID is rejected", "debuffs.ignored")
bad({ debuffs = { ignored = { [12.5] = true } } }, "a spell ID with decimals is rejected", "debuffs.ignored")
bad({ debuffs = { ignored = { [57723] = "yes" } } }, "an ignored debuff that isn't true is rejected", "debuffs.ignored")
bad({ debuffs = { ignored = 57723 } }, "an ignored list that isn't a table is rejected", "debuffs.ignored")
rejects(craft("just text"), "a payload that isn't a table is rejected", P.TEXT.damaged)

-- A newer version's layer or position field is left out and counted, and the rest still applies.
do
  local i, e = P:Read(craft({ v = 1, kind = "settings", from = "X", data = { ui = { layers = { madeUp = "HIGH", notes = "LOW" } }, debuffs = { position = { point = "TOP", relativePoint = "TOP", x = 1, y = 2, anchorFrame = "UIParent" } } } }))
  check(i and i.unknown == 2 and i.values["ui.layers"].notes == "LOW" and i.values["ui.layers"].madeUp == nil and i.values["debuffs.position"].x == 1 and i.values["debuffs.position"].anchorFrame == nil, "an unknown layer key and an unknown position field are skipped and counted (" .. tostring(e or (i and i.unknown)) .. ")")
  if i then P:ApplySettings(i, false) end
  check(alt.ui.layers.notes == "LOW" and alt.ui.layers.madeUp == nil and alt.debuffs.position.point == "TOP" and alt.debuffs.position.anchorFrame == nil, "the known layers and position fields apply")
  P:UndoImport()
end
-- A place anchored to another element (UI/Placement.lua) travels with that element's key.
do
  local i = P:Read(craft({ v = 1, kind = "settings", from = "X", data = { notes = { alert = { position = { point = "CENTER", relativePoint = "CENTER", x = 0, y = -40, anchor = "alerttexts" } } } } }))
  check(i and i.unknown == 0 and i.values["notes.alert.position"] and i.values["notes.alert.position"].anchor == "alerttexts", "an anchored position keeps its anchor")
end
bad({ notes = { alert = { position = { point = "CENTER", relativePoint = "CENTER", x = 0, y = 0, anchor = 5 } } } }, "a position's anchor must be an element's key", "notes.alert.position")
bad({ notes = { alert = { position = { point = "CENTER", relativePoint = "CENTER", x = 0, y = 0, anchor = "not a key!" } } } }, "a position's anchor must be letters and digits", "notes.alert.position")
-- The bars position travels with its positionV, so Alerts/Bars.lua doesn't move it a second time.
do
  local saved = { point = "CENTER", relativePoint = "CENTER", x = 0, y = 100 }
  local i = P:Read(craft({ v = 1, kind = "settings", from = "X", data = { alerts = { bars = { position = saved, positionV = 2 } } } }))
  check(i and i.values["alerts.bars.positionV"] == 2, "positionV is read with the bars position")
  local quiet = true for _, d in ipairs(i and P:Diff(i, false) or {}) do if d.path == "alerts.bars.positionV" then quiet = false end end
  check(quiet, "positionV isn't listed in the preview")
  if i then P:ApplySettings(i, false) end
  check(alt.alerts.bars.position.y == 100 and alt.alerts.bars.positionV == 2, "applied: the bars position and its positionV")
  P:UndoImport()
  check(alt.alerts.bars.positionV == nil, "undo takes positionV back off")
  check(paths0 and paths0["alerts.bars.positionV"] and paths0["alerts.bars.positionV"].position, "positionV is kept with Keep my window positions")
end
-- Keep my window positions keeps the note windows' sizes too.
do
  alt.notes.window.width = 500
  local i = P:Read(craft({ v = 1, kind = "settings", from = "X", data = { notes = { window = { width = 300, fontSize = 20 }, assignments = { height = 100 } } } }))
  if i then P:ApplySettings(i, true) end
  check(alt.notes.window.width == 500 and alt.notes.assignments.height == 240 and alt.notes.window.fontSize == 20, "kept: note window sizes stay, other note window settings apply")
  P:UndoImport()
  alt.notes.window.width = 420
end

-- Unknown keys are skipped and counted. -----------------------------------------------------------
do
  local i = P:Read(craft({ v = 1, kind = "settings", from = "Raid|cffff0000Lead|r", data = { debuffs = { size = 30, futureKey = 1 }, notes = { list = { { text = "x" } } }, somethingNew = {} }, unset = { "notes.window.position", "notes.list" } }))
  check(i and i.unknown == 4, "unknown keys are skipped and counted (got " .. tostring(i and i.unknown) .. ")")
  check(i and not i.from:find("|", 1, true), "the sender's name loses its escape codes: " .. tostring(i and i.from))
  if i then P:ApplySettings(i, false) end
  check(alt.debuffs.size == 30 and alt.debuffs.futureKey == nil and alt.somethingNew == nil and alt.notes.list[5] and alt.notes.window.position == nil, "only known settings are applied")
  P:UndoImport()
  -- kept-back settings in a hand-made string are skipped, never applied
  local k = P:Read(craft({ v = 1, kind = "settings", from = "X", data = { lootmaster = { responses = { { key = "need" } }, awardChannel = "GUILD" }, readycheck = { output = "raid" }, qol = { lowHealth = { soundChoice = "file:theirs.ogg" } } } }))
  check(k and k.unknown == 4, "kept-back settings and another's sound file are skipped and counted (got " .. tostring(k and k.unknown) .. ")")
  if k then P:ApplySettings(k, false) end
  check(alt.lootmaster.responses == nil and alt.lootmaster.awardChannel == "RAID" and alt.readycheck.output == "self" and alt.qol.lowHealth.soundChoice == "pulse", "kept-back settings stay the raider's own")
  P:UndoImport()
end

-- Undo puts the backup back exactly as it was saved, even a value an import would refuse.
do
  alt.importBackup = { from = "X", values = { ["ui.layers"] = { oldLayer = "HIGH" }, ["debuffs.size"] = 44 }, unset = {} }
  P:UndoImport()
  check(alt.ui.layers.oldLayer == "HIGH" and not P:HasBackup(), "undo restores the backup as saved, without the import's checks")
  alt.ui.layers.oldLayer = nil
end

-- The game client without the encoding API. -------------------------------------------------------
C_EncodingUtil = nil
local t2, e2 = P:ExportSettings()
check(t2 == nil and e2 == P.TEXT.noApi, "no encoding API: Export settings only says so")
local i2, e3 = P:Read(text)
check(i2 == nil and e3 == P.TEXT.noApi, "no encoding API: Import says so")
C_EncodingUtil = GAME

-- The full profile string still works, and Read tells it apart. ----------------------------------
do
  alt.importBackup = { from = "Solex", values = { ["debuffs.size"] = 1 }, unset = {} }
  local full = P:Export()
  check(type(full) == "string" and full:sub(1, 6) == "CRTP1:", "the full Export is unchanged")
  local fi = P:Read(full)
  check(fi and fi.kind == "full" and fi.parts > 5, "Read sees a full profile and counts its parts")
  local fp = GAME.DeserializeCBOR(GAME.DecompressString(GAME.DecodeBase64(full:sub(7))))
  check(fp.data.importBackup == nil and fp.data.notes ~= nil, "the full export carries everything but the import backup")
  check(P:Import(full, "Alt copy") == true and CRTDB.profiles["Alt copy"].debuffs, "a full string still imports as a new profile")
  check(P:Import("  " .. full:sub(1, 30) .. "\\n" .. full:sub(31) .. "  ", "Alt copy 2") == true, "a full string pasted with a line break still imports")
  alt.importBackup = {}
end
-- A pasted settings string with line breaks inside its block still reads.
do
  local block = text:match("CRTS1:(%S+)")
  local wrapped = "# Cowfee Raid Tools settings\\n\\nCRTS1:" .. block:sub(1, 40) .. "\\r\\n" .. block:sub(41)
  check(P:Read(wrapped) ~= nil, "a settings string with a line break inside still reads")
end
-- Copy from another profile leaves no backup behind: it would undo to that profile's settings.
do
  CRTDB.profiles.Other = { debuffs = { size = 33 }, importBackup = { from = "Someone", values = { ["debuffs.size"] = 99 }, unset = {} } }
  local r = reloads
  P:CopyFrom("Other")
  check(CRTDB.debuffs.size == 33 and next(CRTDB.importBackup) == nil and not P:HasBackup() and reloads == r + 1, "Copy from clears the copied import backup")
  check(CRTDB.profiles.Other.importBackup.from == "Someone", "the other profile keeps its own backup")
end
-- The module switches (Modules.lua) travel with Export settings only, like the theme.
do
  local i = P:Read(craft({ v = 1, kind = "settings", from = "X", data = { modules = { loot = false, timeline = true } } }))
  check(i and i.unknown == 0 and i.values["modules"] and i.values["modules"].loot == false and i.values["modules"].timeline == true, "the module switches are read from a settings string")
end
print(okCount .. " passed, " .. failCount .. " failed")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
for (const p of ['CRT_Core/Core.lua', 'CRT_Core/Profiles.lua', 'CRT_Core/Share.lua']) lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/' + p, 'utf8')));
if (lua.lua_pcall(L, 3, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
