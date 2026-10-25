// CRT_Dev/Dev/BossDebug.lua and BossDebugPanel.lua on mock events: one switch logs every boss pull into one record
// per boss (the latest pull), with the clear, absorb and timeline probes' lines in their sections, and the
// Development page lists one row per boss with a Copy button. Secret values are proxies that raise an error on any
// use the game forbids, so code that touches one before its secret check fails the check.
// usage: node run_bossdebug.js <addon folder>
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local clearSrc, absorbSrc, timelineSrc, debugSrc, panelSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end

local SECRET = {}
local function forbidden() error("used a secret value") end
for _, k in ipairs({ "__index", "__newindex", "__len", "__concat", "__lt", "__le", "__eq", "__add", "__sub", "__mul", "__div", "__unm", "__call", "__tostring" }) do SECRET[k] = forbidden end
local function secret(v) return setmetatable({ inner = v }, SECRET) end
function issecretvalue(v) return getmetatable(v) == SECRET end
local realType = type
function type(v) if getmetatable(v) == SECRET then return realType(rawget(v, "inner")) end return realType(v) end

-- Frames: every one is kept, so an event reaches each frame that registered it, in creation order or reversed.
local frames = {}
local M = {}
local meta = { __index = function(t, k)
  local m = rawget(M, k)
  if m then return m end
  if realType(k) == "string" and k:match("^[A-Z]") then return function() end end -- any other game method: a no-op
  return nil
end }
local function region(kind, parent)
  return setmetatable({ kind = kind, parent = parent, shown = true, events = {}, scripts = {}, points = {} }, meta)
end
function M:RegisterEvent(e) self.events[e] = true end
function M:UnregisterEvent(e) self.events[e] = nil end
function M:UnregisterAllEvents() self.events = {} self.all = nil end
function M:RegisterAllEvents() self.all = true end
function M:SetScript(n, fn) self.scripts[n] = fn end
function M:GetScript(n) return self.scripts[n] end
function M:HookScript(n, fn) self.scripts[n] = fn end
function M:Show() self.shown = true end
function M:Hide() self.shown = false end
function M:SetShown(v) self.shown = v and true or false end
function M:IsShown() return self.shown end
function M:IsVisible() local f = self while f do if not f.shown then return false end f = f.parent end return true end
function M:SetText(t) self.text = t end
function M:GetText() return self.text end
function M:SetChecked(v) self.checked = v and true or false end
function M:GetChecked() return self.checked end
function M:GetParent() return self.parent end
function M:SetPoint(...) self.points[#self.points + 1] = { ... } end
function M:ClearAllPoints() self.points = {} end
function M:GetStringWidth() return #(self.text or "") * 6 end
function M:CreateFontString() return region("FontString", self) end
function M:CreateTexture() return region("Texture", self) end
function M:GetFontString() self.fs = self.fs or region("FontString", self) return self.fs end
function M:GetObjectType() return self.kind end
function M:Click() if self.kind == "CheckButton" then self.checked = not self.checked end if self.scripts.OnClick then self.scripts.OnClick(self, "LeftButton") end end
function CreateFrame(kind, name, parent, template)
  local f = region(kind or "Frame", parent)
  f.template = template
  frames[#frames + 1] = f
  return f
end
UIParent = region("Frame")
local function fireOn(list, e, ...)
  for _, f in ipairs(list) do
    if (f.events[e] or f.all) and f.scripts.OnEvent then f.scripts.OnEvent(f, e, ...) end
  end
end
local function fire(e, ...) fireOn(frames, e, ...) end
local function fireReversed(e, ...)
  local list = {}
  for i = #frames, 1, -1 do list[#list + 1] = frames[i] end
  fireOn(list, e, ...)
end
local function listening(e) local n = 0 for _, f in ipairs(frames) do if f.events[e] then n = n + 1 end end return n end
local function anyAll() for _, f in ipairs(frames) do if f.all then return true end end return false end

local now = 100
function GetTime() return now end
local clock = 1792540800
function time() return clock end
date = os.date
function GetInstanceInfo() return "The Venemous Abyss", "raid" end
function GetDifficultyInfo(id) if id == 17 then return "Looking For Raid", "raid" elseif id == 16 then return "Mythic", "raid" end return nil end
C_EncounterTimeline = { GetEventState = function() return 1 end, GetEventTrack = function() return 1, 1 end,
  GetEventInfo = function() return nil end, IsFeatureEnabled = function() return true end }
C_Spell = { GetSpellName = function(id) return id == 111 and "Coil" or nil end }
function UnitExists(u) return u == "boss1" end
function UnitGUID(u) return u == "boss1" and secret("Creature-0-1") or nil end
function UnitName(u) return u == "boss1" and "Boss" or nil end
function UnitCanAttack() return true end
function UnitHealthPercent() return 50 end
local absorbs = {}
function UnitGetTotalAbsorbs(u) return absorbs[u] end
function AbbreviateNumbers() return "1" end
function AbbreviateLargeNumbers() return "1" end
function UnitCastingInfo() return nil end

local printed, shown, popup = {}, nil, nil
local db = { dev = {} }
CRTDB = db
local function newCRT()
  local CRT = { db = db }
  function CRT:Print(s) printed[#printed + 1] = s end
  CRT.ConsumablesTools = { ShowText = function(_, title, text) shown = { title = title, text = text } end }
  local route = { { encounterID = 3470, name = "Nek'zali" }, { encounterID = 3429, name = "The Coiled Altar" }, { encounterID = 3492, name = "Ula'tek" } }
  CRT.Bosses = {
    RouteList = function() return route end,
    Get = function(_, id) for _, d in ipairs(route) do if d.encounterID == id then return d end end end,
  }
  CRT.helps = {}
  CRT.UI = {
    HelpRight = function(target, title, text) CRT.helps[#CRT.helps + 1] = { target = target, title = title, text = text } return region("Button") end,
    PanelButton = function(parent, label, h, onClick) local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate") b:SetText(label) b:SetScript("OnClick", onClick) return b end,
    SkinTree = function() end,
    LiftOver = function() end,
    ShownPopup = function(r) return r end,
  }
  return CRT
end
function StaticPopup_ShowCustomGenericConfirmation(info) popup = info return region("Frame") end

local function loadAll(CRT)
  assert(load(clearSrc, "ClearProbe.lua"))("CowfeeRaidTools", CRT)
  assert(load(absorbSrc, "AbsorbProbe.lua"))("CowfeeRaidTools", CRT)
  assert(load(timelineSrc, "TimelineProbe.lua"))("CowfeeRaidTools", CRT)
  assert(load(debugSrc, "BossDebug.lua"))("CowfeeRaidTools", CRT)
  assert(load(panelSrc, "BossDebugPanel.lua"))("CowfeeRaidTools", CRT)
end
local CRT = newCRT()
loadAll(CRT)
fire("PLAYER_LOGIN")
local BD = CRT.BossDebug
check(BD and BD.MAX_LINES == 6000, "CRT.BossDebug exists, MAX_LINES 6000")
local function bosses() return db.dev.bossDebug and db.dev.bossDebug.bosses or {} end
local function rec(id) return bosses()[id] end
local function section(id, s) local r = rec(id) return r and r.lines[s] or {} end
local function has(id, s, text) for _, l in ipairs(section(id, s)) do if l:find(text, 1, true) then return true end end return false end

-- Off: a pull keeps nothing.
fire("ENCOUNTER_START", 3492, "Ula'tek", 17, 20)
fire("ENCOUNTER_END", 3492, "Ula'tek", 17, 20, 1)
check(next(bosses()) == nil, "off: a pull keeps no record")
check(BD:IsOn() == false, "off by default")

-- On: saved, the probes listen without their own switches.
check(BD:Command("dev bossdebug on") == true and db.dev.bossDebug.on == true, "/crt dev bossdebug on: saved in CRTDB.dev.bossDebug.on")
check(BD:Command("dev clearprobe on") == false and BD:Command("dev bossdebugger") == false, "another command is not Boss debug's")
check(not (db.dev.clearProbe and db.dev.clearProbe.on) and not (db.dev.absorbProbe and db.dev.absorbProbe.on), "the probes' own switches stay off")
check(listening("ENCOUNTER_START") >= 4, "Boss debug and the three probes listen for the pull: " .. listening("ENCOUNTER_START"))
check(not anyAll(), "no frame listens to every event while waiting")

-- A pull: the record opens, each probe writes its section, nothing is printed or shown.
printed, shown = {}, nil
now = 200
fire("ENCOUNTER_START", 3492, "Ula'tek", 17, 20)
check(rec(3492) ~= nil, "ENCOUNTER_START opens the boss's record")
local r = rec(3492) or { lines = {}, counts = {} }
check(r.name == "Ula'tek" and r.difficultyID == 17 and r.difficultyName == "Looking For Raid" and r.startedAt == clock and r.result == nil and r.endedAt == nil, "the record: name, difficulty, its name, start, still open")
check(section(3492, "clear")[1] == '+0.0 ENCOUNTER_START encounterID=3492 name="Ula\\'tek" difficultyID=17 groupSize=20', "the clear section starts with the pull, as the clear probe writes it: " .. tostring(section(3492, "clear")[1]))
check(has(3492, "absorb", "+0.0 APIS UnitGetTotalAbsorbs=true"), "the absorb section has its APIS line")
check(has(3492, "timeline", "+0.0 feature.enabled@event readable"), "the timeline section has its pull reads: " .. tostring(section(3492, "timeline")[1]))
check(not anyAll(), "the timeline probe adds no catch-all for Boss debug")
now = 212.34
fire("CHAT_MSG_RAID_BOSS_EMOTE", secret("The altar coils!"), secret("Ula'tek"), "", "")
check(has(3492, "clear", "+12.3 CHAT_MSG_RAID_BOSS_EMOTE text=<secret> sender=<secret>"), "a secret emote in the clear section")
check(has(3492, "timeline", "+12.3 chatemote.text@event secret"), "the same emote in the timeline section, as secret")
absorbs.boss1 = secret(5000)
fire("UNIT_ABSORB_AMOUNT_CHANGED", "boss1")
check(has(3492, "absorb", 'UNIT_ABSORB_AMOUNT_CHANGED unit="boss1" total=<secret> type="number" secret=true'), "a secret shield read in the absorb section")
fire("ENCOUNTER_TIMELINE_EVENT_ADDED", { id = 7, source = 0, spellID = secret(111), spellName = secret("Coil"), duration = 30, isApproximate = false })
check(has(3492, "clear", "ENCOUNTER_TIMELINE_EVENT_ADDED id=7 source=0 spellID=<secret>"), "a timeline event in the clear section")
check(has(3492, "timeline", "added@event id=readable source=readable spellName=secret spellID=secret"), "the same event in the timeline section, one line: " .. tostring(section(3492, "timeline")[#section(3492, "timeline")]))
fire("UNIT_SPELLCAST_START", "boss1", "Cast-1", 111)
check(has(3492, "clear", 'UNIT_SPELLCAST_START unit="boss1" spellID=111 spell="Coil"') and has(3492, "timeline", "bosscast.spellID@event readable"), "a boss cast in the clear and timeline sections")
now = 452.5
fire("ENCOUNTER_END", 3492, "Ula'tek", 17, 20, 1)
r = rec(3492)
check(r.result == "kill" and r.endedAt == clock and math.abs(r.length - 252.5) < 0.01, "ENCOUNTER_END closes it: kill, length 252.5 s")
check(has(3492, "clear", "+252.5 ENCOUNTER_END encounterID=3492 success=1"), "the clear probe's end line lands in the record")
fire("PLAYER_REGEN_ENABLED")
check(has(3492, "timeline", "@ooc"), "the timeline probe's after-combat reads land in the same record")
check(#printed == 0 and shown == nil, "nothing printed or shown during the pull: " .. table.concat(printed, "|"))
check(not (db.dev.clearProbe and db.dev.clearProbe.last) and not (db.dev.absorbProbe and db.dev.absorbProbe.last) and not (db.dev.probe and db.dev.probe.fields), "the probes' own stores are untouched")
check(r.counts.clear.secret >= 4 and r.counts.absorb.secret >= 1 and r.counts.timeline.secret >= 3, "secret counts per section: " .. r.counts.clear.secret .. ", " .. r.counts.absorb.secret .. ", " .. r.counts.timeline.secret)
fire("CHAT_MSG_RAID_BOSS_EMOTE", "after", "Ula'tek")
check(not has(3492, "clear", "after"), "nothing is logged after the pull")

-- The text: header, then the sections in order.
local text = BD:Text(3492) or ""
check(text:find("Boss debug: Ula'tek, encounter 3492", 1, true) ~= nil, "Text: the boss and encounter ID")
check(text:find("Looking For Raid (difficulty 17), pulled " .. os.date("%Y-%m-%d %H:%M", clock) .. ", kill, 4:12", 1, true) ~= nil, "Text: difficulty, date and time, kill, length m:ss")
check(text:find("Lines: " .. r.kept .. " kept, 0 dropped. Secret values: clear " .. r.counts.clear.secret .. ", absorb " .. r.counts.absorb.secret .. ", timeline " .. r.counts.timeline.secret .. ".", 1, true) ~= nil, "Text: lines kept and dropped, secret counts per section")
local c1, a1, t1 = text:find("== clear ==", 1, true), text:find("== absorb ==", 1, true), text:find("== timeline ==", 1, true)
check(c1 and a1 and t1 and c1 < a1 and a1 < t1, "Text: clear, absorb, timeline, in that order")
check(text:find("== clear ==\\n+0.0 ENCOUNTER_START", 1, true) ~= nil and text:find("+12.3 CHAT_MSG_RAID_BOSS_EMOTE", 1, true) ~= nil, "Text: each section's lines with their seconds")
check(BD:Text(1234) == nil, "Text of a boss with no record: nil")

-- A second boss, with the frames hearing ENCOUNTER_START in the other order: still one record, all lines in it.
now = 600
clock = clock + 600
fireReversed("ENCOUNTER_START", 3429, "The Coiled Altar", 16, 20)
check(rec(3429) and section(3429, "clear")[1] and section(3429, "clear")[1]:find("encounterID=3429", 1, true) and has(3429, "absorb", "APIS"), "the record opens whichever frame hears the pull first")
now = 662
fireReversed("ENCOUNTER_END", 3429, "The Coiled Altar", 16, 20, 0)
check(rec(3429).result == "wipe" and rec(3429).difficultyName == "Mythic", "a wipe")
check(#section(3492, "clear") > 3, "the first boss's record stays")

-- A secret encounter ID or result: no record, no error; the result left out.
now = 700
fire("ENCOUNTER_START", secret(3500), "X", 16, 20)
fire("ENCOUNTER_END", secret(3500), "X", 16, 20, 1)
local n = 0 for _ in pairs(bosses()) do n = n + 1 end
check(n == 2, "a secret encounter ID makes no record")

-- The page section: one row per boss in route order, each with Copy.
local P = CRT.BossDebugPanel
local page = CreateFrame("Frame")
local sec = P.Build(page, 360, -44)
sec.refresh()
local rows = {}
for _, row in ipairs(sec.rows) do if row.shown then rows[#rows + 1] = row end end
check(sec.check and sec.check:GetChecked() == true, "the checkbox shows Boss debug on")
check(sec.check.label and sec.check.label.text == "Log every boss pull", "the checkbox reads Log every boss pull")
local help = CRT.helps[#CRT.helps]
check(help and help.target == sec.check.label and help.text:find("one log per boss", 1, true) and help.text:find("Nothing ships; nothing shows during the pull.", 1, true), "its (?) explains it")
check(#rows == 2 and rows[1].title.text:find("The Coiled Altar", 1, true) and rows[2].title.text:find("Ula'tek", 1, true), "two rows, route order: " .. tostring(rows[1] and rows[1].title.text) .. " / " .. tostring(rows[2] and rows[2].title.text))
check(rows[2].title.text == "Ula'tek, Looking For Raid", "a row's first line: boss and difficulty")
check(rows[2].info.text == os.date("%m-%d %H:%M", 1792540800) .. ", kill 4:12, " .. rec(3492).kept .. " lines, " .. (rec(3492).counts.clear.secret + rec(3492).counts.absorb.secret + rec(3492).counts.timeline.secret) .. " secret", "a row's second line: time, kill m:ss, lines, secret: " .. tostring(rows[2].info.text))
check(rows[1].info.text:find("wipe 1:02", 1, true) ~= nil, "a wipe row: " .. tostring(rows[1].info.text))
shown = nil
rows[2].copy:Click()
check(shown and shown.text == BD:Text(3492) and shown.title:find("Ctrl+C", 1, true), "Copy opens the boss's text in the copy window")

-- A pull on a boss off the route goes after the route's bosses; a new pull on a listed boss updates its row.
now = 800
clock = clock + 600
fire("ENCOUNTER_START", 9999, "Practice Dummy", 16, 20)
fire("ENCOUNTER_END", 9999, "Practice Dummy", 16, 20, 1)
rows = {}
for _, row in ipairs(sec.rows) do if row.shown then rows[#rows + 1] = row end end
check(#rows == 3 and rows[3].title.text:find("Practice Dummy", 1, true), "OnChange rebuilt the rows; a boss off the route comes last")

-- The same boss again replaces its record; the other boss's stays.
local keep3429 = rec(3429)
now = 900
clock = clock + 600
fire("ENCOUNTER_START", 3492, "Ula'tek", 17, 20)
check(#section(3492, "clear") == 1 and rec(3492).startedAt == clock and rec(3492).result == nil, "a new pull on the same boss replaces its record")
check(rec(3429) == keep3429, "another boss's record stays")
now = 905
fire("ENCOUNTER_END", 3492, "Ula'tek", 17, 20, 0)

-- The cap: lines past MAX_LINES are counted, not kept.
BD.MAX_LINES = 20
now = 1000
fire("ENCOUNTER_START", 3470, "Nek'zali", 16, 20)
for i = 1, 30 do fire("ENCOUNTER_TIMELINE_EVENT_HIGHLIGHT", i) end
fire("ENCOUNTER_END", 3470, "Nek'zali", 16, 20, 1)
local capped = rec(3470)
local kept = #capped.lines.clear + #(capped.lines.absorb or {}) + #(capped.lines.timeline or {})
check(capped.kept == kept and #capped.lines.clear < 20 and not has(3470, "clear", "ENCOUNTER_END") and capped.dropped > 0, "the record stops taking lines at MAX_LINES and counts the dropped: " .. kept .. " kept, " .. tostring(capped.dropped) .. " dropped")
check(has(3470, "absorb", "ENCOUNTER_END"), "the absorb probe's kinds other than auras go in past the record's cap")
check((BD:Text(3470) or ""):find("Lines: " .. kept .. " kept, " .. capped.dropped .. " dropped.", 1, true) and (BD:Text(3470) or ""):find(capped.dropped .. " more lines dropped (a log keeps 20)", 1, true), "Text says how many were dropped")
BD.MAX_LINES = 6000

-- The absorb probe's caps per kind carry over: aura lines never flood the absorb section.
local AP = CRT.AbsorbProbe
AP.MAX_LINES = 5
local auraCalls = 0
local bossAuras = {}
for i = 1, 10 do bossAuras[i] = { spellId = 500 + i, name = "A", points = {} } end
C_UnitAuras = { GetAuraDataByIndex = function(u, i)
  if u == "boss2" then auraCalls = auraCalls + 1 error("Auras cannot be accessed when secret while tainted") end
  return u == "boss1" and bossAuras[i] or nil
end }
now = 1050
fire("ENCOUNTER_START", 3470, "Nek'zali", 16, 20)
fire("UNIT_AURA", "boss1", {})
for i = 1, 10 do fire("UNIT_AURA", "boss2", {}) end
absorbs.boss1 = 64000
fire("UNIT_ABSORB_AMOUNT_CHANGED", "boss1")
fire("ENCOUNTER_END", 3470, "Nek'zali", 16, 20, 1)
local auraLines = 0
for _, l in ipairs(section(3470, "absorb")) do if l:find("UNIT_AURA unit=", 1, true) then auraLines = auraLines + 1 end end
check(auraLines == 5 and rec(3470).capped and rec(3470).capped["absorb UNIT_AURA"] == 6, "aura lines stop at the probe's aura cap in the record: " .. auraLines .. " kept, " .. tostring(rec(3470).capped and rec(3470).capped["absorb UNIT_AURA"]) .. " capped")
check(has(3470, "absorb", "total=64000") and has(3470, "absorb", 'FORMAT kind="readable"') and has(3470, "absorb", 'BAR kind="readable"'), "the absorb, FORMAT and BAR lines after them are kept")
check((BD:Text(3470) or ""):find("Capped by kind: absorb UNIT_AURA 6", 1, true) ~= nil, "Text says which kind was capped")
AP.MAX_LINES = 3000
AP.KIND_MAX = 600
now = 1060
fire("ENCOUNTER_START", 3470, "Nek'zali", 16, 20)
for i = 1, 10 do fire("UNIT_AURA", "boss2", {}) end
fire("ENCOUNTER_END", 3470, "Nek'zali", 16, 20, 1)
local errLines = 0
for _, l in ipairs(section(3470, "absorb")) do if l:find('UNIT_AURA unit="boss2"', 1, true) then errLines = errLines + 1 end end
check(errLines == 1 and has(3470, "absorb", "tainted\\" count=10") and auraCalls == 2,"an aura error in the record: one line whose count is kept up to date")
C_UnitAuras = nil

-- The probes' own switches still work beside Boss debug.
CRT.ClearProbe:Command("dev clearprobe on")
now = 1100
fire("ENCOUNTER_START", 3429, "The Coiled Altar", 16, 20)
fire("ENCOUNTER_END", 3429, "The Coiled Altar", 16, 20, 1)
check(db.dev.clearProbe.last and db.dev.clearProbe.last.lines[1]:find("3429", 1, true) and #section(3429, "clear") == 2, "with the clear probe on too, both logs get the pull")
CRT.ClearProbe:Command("dev clearprobe off")
check(listening("ENCOUNTER_START") >= 4, "the clear probe off: it still listens for Boss debug")

-- Slash: show lists the rows; show <boss> or its ID opens the copy window.
printed = {}
BD:Command("dev bossdebug show")
local said = table.concat(printed, "|")
check(said:find("The Coiled Altar", 1, true) and said:find("Ula'tek", 1, true) and said:find("Practice Dummy", 1, true) and said:find("The Coiled Altar", 1, true) < said:find("Ula'tek", 1, true), "show lists the rows in chat, route order: " .. said)
shown = nil
BD:Command("dev bossdebug show ulatek")
check(shown and shown.text == BD:Text(3492), "show <boss> opens its copy window (the name without punctuation)")
shown = nil
BD:Command("dev bossdebug show 3429")
check(shown and shown.text == BD:Text(3429), "show <encounter ID> opens its copy window")
shown, printed = nil, {}
BD:Command("dev bossdebug show nobody")
check(shown == nil and #printed == 1, "show of a boss with no log says so")

-- Clear logs asks first, then empties the store; the switch stays on.
popup = nil
sec.clear:Click()
check(popup and popup.callback and next(bosses()) ~= nil, "Clear logs asks first")
popup.callback()
rows = {}
for _, row in ipairs(sec.rows) do if row.shown then rows[#rows + 1] = row end end
check(next(bosses()) == nil and #rows == 0 and BD:IsOn() and sec.check:GetChecked(), "Clear logs empties the store and the rows; Boss debug stays on")

-- Through a /reload: the switch stays on and the probes listen again.
for _, f in ipairs(frames) do f.events = {} f.all = nil end
frames = {}
local CRT2 = newCRT()
loadAll(CRT2)
fire("PLAYER_LOGIN")
check(CRT2.BossDebug:IsOn() and listening("ENCOUNTER_START") >= 4, "after a /reload: still on, the probes listen")
now = 2000
fire("ENCOUNTER_START", 3492, "Ula'tek", 17, 20)
fire("ENCOUNTER_END", 3492, "Ula'tek", 17, 20, 1)
check(rec(3492) and #section(3492, "clear") == 2 and #section(3492, "absorb") >= 2, "after a /reload a pull is logged")

-- The checkbox turns it off: nothing listens, the logs stay.
local sec2 = CRT2.BossDebugPanel.Build(CreateFrame("Frame"), 360, -44)
sec2.refresh()
sec2.check:Click()
check(db.dev.bossDebug.on == false and listening("ENCOUNTER_START") == 0 and rec(3492) ~= nil, "the checkbox off: nothing listens, the logs stay")

print(passes .. " passed, " .. fails .. " failed")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
for (const f of ['ClearProbe', 'AbsorbProbe', 'TimelineProbe', 'BossDebug', 'BossDebugPanel']) {
  lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Dev/Dev/' + f + '.lua', 'utf8')));
}
if (lua.lua_pcall(L, 5, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }

// Developer only: both files inside the .toc's do-not-package block, after the probes; the command inside Slash.lua's.
const toc = fs.readFileSync(d + '/CowfeeRaidTools.toc', 'utf8');
const slash = fs.readFileSync(d + '/CRT_Core/Slash.lua', 'utf8');
function inBlock(text, needle) {
  const a = text.indexOf('#@do-not-package@'), b = text.indexOf('#@end-do-not-package@'), i = text.indexOf(needle);
  return a >= 0 && i > a && i < b;
}
let bad = 0;
for (const f of ['CRT_Dev\\Dev\\BossDebug.lua', 'CRT_Dev\\Dev\\BossDebugPanel.lua']) {
  if (!inBlock(toc, f)) { console.log('FAIL ' + f + ' is not in the .toc do-not-package block'); bad++; }
}
if (toc.indexOf('CRT_Dev\\Dev\\BossDebug.lua') < toc.indexOf('CRT_Dev\\Dev\\AbsorbProbe.lua')) { console.log('FAIL BossDebug.lua loads before the probes'); bad++; }
if (toc.indexOf('CRT_Dev\\Dev\\BossDebugPanel.lua') > toc.indexOf('CRT_Dev\\Dev\\DevPage.lua')) { console.log('FAIL BossDebugPanel.lua loads after DevPage.lua'); bad++; }
const sa = slash.indexOf('--@do-not-package@'), sb = slash.indexOf('--@end-do-not-package@'), si = slash.indexOf('CRT.BossDebug:Command');
if (!(sa >= 0 && si > sa && si < sb)) { console.log('FAIL the bossdebug command is not in the Slash.lua do-not-package block'); bad++; }
if (bad === 0) console.log('ok the files and the command never ship');
process.exit(bad === 0 ? 0 : 1);
