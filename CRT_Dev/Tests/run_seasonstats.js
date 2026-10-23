// Season Stats (CRT_Modules/SeasonStats/): the raid's own counters per boss and difficulty group, from the
// Timeline's one save hook; the fill from the Timeline's saved pulls, once; kills, wipes, pulls to first kill,
// best kill, each night's longest pull and furthest phase (the alerts engine's), the spells that killed most,
// deaths per pull over the last 10 against the 10 before; raid nights from the Late Tracker, the avoidable damage
// trend from Tattlebot (Tattle:BossPulls); the page: the Season and Difficulty dropdowns, the cards, the table in
// route order, the reflection, the empty states, inside the page area; saved data only (never in Export settings
// only, CRT_Dev/Tests/run_profiles_share.js); no season facts in the feature code.
// Usage: node run_seasonstats.js <addon folder>
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local timelineSrc, registrySrc, lateSrc, tattleSrc, dataSrc, pageSrc, coreSrc, panelSrc, profilesSrc, tocSrc, referenceSrc, tattlePageSrc, abilityTipSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
-- a text without its colour codes
local function plain(s) return (tostring(s):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")) end
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end
issecretvalue = function(v) return v == "SECRET" end
format = string.format
date = os.date
local NOW = os.time({ year = 2026, month = 10, day = 20, hour = 20, min = 0, sec = 0 })
time = function(t) if t then return os.time(t) end return NOW end
GetTime = function() return 1000 end
C_Timer = { After = function() end, NewTicker = function() return { Cancel = function() end } end }
C_Spell = { GetSpellName = function(id) return ({ [111] = "Fang Bite", [222] = "Venom Pool", [333] = "Tail Swipe" })[id] end,
  GetSpellTexture = function(id) return ({ [111] = "tex111", [222] = "tex222" })[id] end }
local tip = { lines = {} }
GameTooltip = { SetOwner = function(self, o) self.owner = o self.lines = {} end, SetText = function(self, t) self.lines = { t } self.colors = {} end,
  AddLine = function(self, t, r, g, b) self.lines[#self.lines + 1] = t self.colors = self.colors or {} self.colors[#self.lines] = r and { r, g, b } end, Show = function(self) self.shown = true end, Hide = function(self) self.shown = false end,
  ClearAllPoints = function() end, SetPoint = function() end }

-- stand-in frames, keeping where they were put
local function mock()
  local o = { shown = true, scripts = {}, events = {}, kids = {} }
  return setmetatable(o, { __index = function(t, k)
    local m = ({
      SetText = function(self, v) self.text = v end,
      SetTexture = function(self, v) self.texture = v end,
      GetText = function(self) return self.text end,
      Show = function(self) self.shown = true if self.scripts.OnShow then self.scripts.OnShow(self) end end,
      Hide = function(self) self.shown = false end,
      IsShown = function(self) return self.shown end,
      IsVisible = function(self) return self.shown and (not self.parent or self.parent:IsVisible()) end,
      SetShown = function(self, v) self.shown = v and true or false end,
      SetScript = function(self, name, fn) self.scripts[name] = fn end,
      HookScript = function(self, name, fn) local old = self.scripts[name] self.scripts[name] = function(...) if old then old(...) end fn(...) end end,
      RegisterEvent = function(self, e) self.events[e] = true end,
      SetSize = function(self, w, h) self.w, self.h = w, h end,
      SetWidth = function(self, w) self.w = w end,
      SetHeight = function(self, h) self.h = h end,
      GetWidth = function(self) return self.w or 0 end,
      GetHeight = function(self) return self.h or 0 end,
      SetPoint = function(self, ...) self.point = { ... } end,
      ClearAllPoints = function(self) self.point = nil end,
      SetTextColor = function(self, r, g, b) self.color = { r, g, b } end,
      SetColorTexture = function(self, r, g, b, a) self.colorTex = { r, g, b, a } end,
      CreateTexture = function(self) local x = mock() x.parent = self self.kids[#self.kids + 1] = x return x end,
      CreateFontString = function(self) local x = mock() x.parent = self x.isText = true self.kids[#self.kids + 1] = x return x end,
      GetStringWidth = function(self) return #(self.text or "") * 6 end,
      GetStringHeight = function() return 12 end,
      SetVerticalScroll = function(self, v) self.vscroll = v end,
      GetParent = function(self) return self.parent end,
      GetFrameLevel = function() return 1 end,
    })[k]
    if m then return m end
    if type(k) == "string" and k:match("^%u") then return function() end end
    return nil
  end })
end
local made = {}
CreateFrame = function(_, name, parent) local f = mock() f.parent = parent f.name = name made[#made + 1] = f if parent and parent.kids then parent.kids[#parent.kids + 1] = f end return f end
UIParent = mock()

-- the CRT: its saved data, the boss library with two test seasons, the Late Tracker, Tattlebot, the Timeline
local helps, pages, dropdowns, sorts = {}, {}, {}, {}
local selectedPage
local UI = {
  PAGE_W = 1026, PAGE_H = 560, pages = pages,
  RegisterPage = function(_, key, title, build) pages[key] = { title = title, build = build } end,
  -- the panel's page switch: builds the page once, then shows it
  SelectPage = function(_, key) selectedPage = key local p = pages[key] if not p then return end
    if not p.frame then p.frame = mock() p.frame.shown = false p.build(p.frame) end p.frame:Show() end,
  SetTabSelected = function() end, RegisterTab = function() end, SkinScrollBar = function() end, SkinCheckButton = function() end,
  HelpRight = function(target, title, text) helps[title] = text local h = mock() h.target = target return h end,
  Dropdown = function(parent, label, opts) local row = mock() row.parent = parent row.label, row.opts = label, opts row.refresh = function() row.refreshed = (row.refreshed or 0) + 1 end
    dropdowns[label] = row return row end,
  SortHeaders = function(parent, cols, opts) local s = { cols = cols, opts = opts, refreshed = 0 } s.refresh = function() s.refreshed = s.refreshed + 1 end sorts[#sorts + 1] = s return s end,
  IsModern = function() return true end,
}
local CRT = { UI = UI, db = {
  ui = {},
  timeline = { record = true, minPull = 15, keep = 10, bosses = {}, rows = {}, nextId = 1 },
  late = { days = {}, hour = 20, minute = 0, grace = 0, history = {}, nextId = 1, lastAuto = "" },
  tattle = { enabled = true, raidsOnly = true, avoidable = false, custom = {}, season = "Season 1", history = {}, nextId = 1 },
} }
function CRT:Print() end
CRT.Groups = { OnChange = function() end, ClassColor = function() return 1, 1, 1 end, ReportName = function(k) return k end }
CRT_THEME(CRT, UI)
-- the saved default from Core.lua, as the game fills it in
local coreDefault = coreSrc:match("\\n    seasonStats = (%b{}),")
check(coreDefault ~= nil, "Core.lua has a seasonStats default")
CRT.db.seasonStats = assert(load("return " .. (coreDefault or "{}")))()
eq(CRT.db.seasonStats.filled, false, "default: not filled yet")
check(type(CRT.db.seasonStats.bosses) == "table" and next(CRT.db.seasonStats.bosses) == nil, "default: no bosses")

-- the alerts engine's phases, as Alerts/Engine.lua exposes them
local alertsListeners = {}
local starts = {}
local customColors = false -- Use custom colours (Raid Notes > Alerts), which Reference.RowColor reads
CRT.Alerts = { running = false, OnChange = function(_, fn) alertsListeners[#alertsListeners + 1] = fn end,
  Phases = function() return { 1, 2, 3 } end, PhaseStart = function(_, ph) return starts[ph] end,
  CustomColors = function() return customColors end }
local function alertsFire() for _, fn in ipairs(alertsListeners) do fn() end end

assert(load(timelineSrc, "Timeline/Data.lua"))("CowfeeRaidTools", CRT)
assert(load(registrySrc, "Registry.lua"))("CowfeeRaidTools", CRT)
local B = CRT.Bosses
B:Season({ key = "test-s1", name = "Test Season 1", order = 1, raids = { { key = "r1", name = "Raid One", bosses = { 9001, 9002 } } } })
B:Season({ key = "test-s2", name = "Test Season 2", order = 2, current = true, raids = { { key = "r2", name = "Raid Two", bosses = { 9103, 9101, 9102 } } } })
for id, def in pairs({ [9001] = { "Alpha", "test-s1" }, [9002] = { "Beta", "test-s1" }, [9101] = { "Gamma", "test-s2" }, [9102] = { "Delta", "test-s2" }, [9103] = { "Epsilon", "test-s2" } }) do
  B:Register({ encounterID = id, name = def[1], season = def[2] })
end
assert(load(lateSrc, "Late/Data.lua"))("CowfeeRaidTools", CRT)
CRT.TattleDB = { bosses = { { boss = "Alpha", encounterID = 9001, mechanics = { { name = "Puddle", spells = { 555 } } } } } }
assert(load(tattleSrc, "Tattlebot/Data.lua"))("CowfeeRaidTools", CRT)
assert(load(referenceSrc, "Timeline/Reference.lua"))("CowfeeRaidTools", CRT)
-- the shared ability tooltip the causes use, and the Journal text it reads (a stand-in: Tail Swipe is in the Journal,
-- kept once read; the others are not)
assert(load(abilityTipSrc, "Timeline/AbilityTip.lua"))("CowfeeRaidTools", CRT)
local journalAsked = {}
CRT.TimelineJournal = { AbilitySection = function(_, enc, group, spellID, name, sectionID, cachedOnly)
  journalAsked[#journalAsked + 1] = tostring(enc) .. "/" .. tostring(group) .. "/" .. tostring(spellID) .. "/" .. tostring(cachedOnly)
  if spellID == 333 then return { description = "Swipes the tail.", icon = 4040 }, 16 end end }
function GetDifficultyInfo(id) return id == 16 and "Mythic" or nil end
local T = CRT.Timeline

-- the Timeline as it was before Season Stats: Gamma 118 Mythic pulls, the newest 12 kept (no kills); Delta three
-- Normal pulls, the third a kill; Epsilon five Mythic pulls, kills on 4 and 5
local DAY = 86400
local function pull(enc, name, diff, number, at, length, kill, deaths)
  return { id = number, encounterID = enc, name = name, difficultyID = diff, number = number, startedAt = at, length = length, kill = kill, casts = {}, deaths = deaths or {} }
end
local gamma = { name = "Gamma", counts = { mythic = 118 }, pulls = {} }
for n = 107, 118 do gamma.pulls[#gamma.pulls + 1] = pull(9101, "Gamma", 16, n, NOW - 10 * DAY + n * 60, 100 + n, false, { { spellID = 111 } }) end
local delta = { name = "Delta", counts = { nh = 3 }, pulls = {
  pull(9102, "Delta", 14, 1, NOW - 9 * DAY, 120, false), pull(9102, "Delta", 14, 2, NOW - 9 * DAY + 600, 200, false), pull(9102, "Delta", 14, 3, NOW - 9 * DAY + 1200, 300, true) } }
local eps = { name = "Epsilon", counts = { mythic = 5 }, pulls = {} }
for n, len in ipairs({ 150, 200, 240, 280, 260 }) do eps.pulls[n] = pull(9103, "Epsilon", 16, n, NOW - 8 * DAY + n * 600, len, n >= 4) end
CRT.db.timeline.bosses = { [9101] = gamma, [9102] = delta, [9103] = eps }
CRT.db.timeline.nextId = 200

assert(load(dataSrc, "SeasonStats/Data.lua"))("CowfeeRaidTools", CRT)
local S = CRT.SeasonStats
check(S ~= nil, "CRT.SeasonStats exists")

-- 1. The fill, once -------------------------------------------------------------------------------------------------
local changes = 0
S:OnChange(function() changes = changes + 1 end)
local login
for _, f in ipairs(made) do if f.events.PLAYER_LOGIN and f.scripts.OnEvent and not login then
  -- the Late Tracker's and Tattlebot's drivers listen too: only Season Stats' fills
  local before = CRT.db.seasonStats.filled
  f.scripts.OnEvent(f, "PLAYER_LOGIN")
  if CRT.db.seasonStats.filled ~= before then login = f end
end end
check(login ~= nil, "the fill runs at login")
eq(CRT.db.seasonStats.filled, true, "the fill is marked done")
local g = S:Boss(9101, "mythic")
check(g ~= nil, "Gamma Mythic has counters")
eq(g and g.pulls, 118, "Gamma: 118 pulls, from the Timeline's counter")
eq(g and g.kills, 0, "Gamma: no kills")
eq(g and g.wipes, 118, "Gamma: 118 wipes")
eq(g and g.untimed, 106, "Gamma: the 106 pulls the Timeline no longer keeps have no length")
eq(S:Boss(9101, "nh"), nil, "Gamma: nothing on Normal/Heroic")
local d = S:Boss(9102, "nh")
eq(d and (d.pulls .. "/" .. d.wipes .. "/" .. d.kills), "3/2/1", "Delta Normal: 3 pulls, 2 wipes, 1 kill")
eq(d and d.firstKillPull, 3, "Delta: first kill on pull 3")
eq(d and d.bestKill, 300, "Delta: best kill 5:00")
eq(d and d.firstKillAt, NOW - 9 * DAY + 1200, "Delta: the first kill's time")
local e = S:Boss(9103, "mythic")
eq(e and (e.pulls .. "/" .. e.wipes .. "/" .. e.kills), "5/3/2", "Epsilon Mythic: 5 pulls, 3 wipes, 2 kills")
eq(e and e.firstKillPull, 4, "Epsilon: pulls to first kill, 4")
eq(e and e.bestKill, 260, "Epsilon: best kill, the shorter of the two")
eq(e and e.killTime, 540, "Epsilon: total kill time")
eq(e and e.pullTime, 1130, "Epsilon: total pull time")
eq(S:Backfill(), false, "the fill never runs twice")
eq(S:Boss(9101, "mythic").pulls, 118, "and changes nothing the second time")

-- 2. Counting from the Timeline's one save hook -----------------------------------------------------------------------
check(dataSrc:find("CRT.Timeline:OnSaved(", 1, true) ~= nil, "counted through Timeline:OnSaved")
check(not dataSrc:find("ENCOUNTER_END", 1, true) and not dataSrc:find("ENCOUNTER_START", 1, true), "never from the encounter events")
-- the alerts engine reaches Phase 2 on Gamma's pull
starts = { [1] = 1000, [2] = 1060 }
CRT.Alerts.running, CRT.Alerts.run = true, { reason = "encounter", encounterID = 9101 }
alertsFire()
CRT.Alerts.running, CRT.Alerts.run = false, nil
alertsFire()
T:SavePull({ encounterID = 9101, name = "Gamma", difficultyID = 16, startedAt = NOW + 2, length = 400, kill = true, casts = {},
  deaths = { { spellID = 222 }, { spellID = 222 }, { spellID = 0 } } })
g = S:Boss(9101, "mythic")
eq(g.pulls, 119, "a saved pull counts once")
eq(g.kills .. "/" .. g.wipes, "1/118", "a kill")
eq(g.firstKillPull, 119, "pulls to first kill: the pull's own number")
eq(g.bestKill, 400, "best kill")
local night = g.nights[S.NightKey(NOW)]
eq(night and night.phase, 2, "the night's furthest phase, from the alerts engine")
eq(night and night.longest, 400, "the night's longest pull")
eq(g.causes[222], 2, "death causes counted by spell")
eq(g.causes[0], 1, "an unknown cause is kept apart")
-- deleting the boss's pulls in the Timeline resets its counter: the season's own count goes on, the first kill stays
local firstAt = g.firstKillAt
T:DeleteBoss(9101)
T:SavePull({ encounterID = 9101, name = "Gamma", difficultyID = 16, startedAt = NOW + 60, length = 390, kill = true, casts = {}, deaths = {} })
g = S:Boss(9101, "mythic")
eq(g.pulls, 120, "after the Timeline's delete: Season Stats counts on")
eq(g.firstKillPull, 119, "the first kill's pull number is kept")
eq(g.firstKillAt, firstAt, "and its date")
eq(g.kills, 2, "the new kill counts")
-- a Normal pull of the same boss leaves Mythic alone
T:SavePull({ encounterID = 9101, name = "Gamma", difficultyID = 14, startedAt = NOW + 600, length = 50, kill = false, casts = {}, deaths = {} })
eq(S:Boss(9101, "mythic").pulls, 120, "another difficulty leaves Mythic alone")
eq(S:Boss(9101, "nh") and S:Boss(9101, "nh").pulls, 1, "and counts on its own")
eq(S:Boss(9101, "nh").nights[S.NightKey(NOW + 600)].phase, nil, "a pull with no alerts run has no phase")
-- a run whose encounter ID is secret is never compared: no error, no phase
CRT.Alerts.running, CRT.Alerts.run = true, { reason = "encounter", encounterID = "SECRET" }
local okSecret = pcall(alertsFire)
CRT.Alerts.running, CRT.Alerts.run = false, nil
check(okSecret, "a secret encounter ID on the alerts run is skipped")
eq(S.PhaseFor({ encounterID = 9101, startedAt = NOW + 1200 }), nil, "and gives no phase")
check(changes >= 3, "the page hears of each change")

do
  -- the first save after an update fills from the Timeline, that pull among them, counted once and with its phase
  local saved = CRT.db.seasonStats
  CRT.db.seasonStats = { filled = false, bosses = {} }
  starts = { [1] = 1000, [2] = 1050, [3] = 1100 }
  CRT.Alerts.running, CRT.Alerts.run = true, { reason = "encounter", encounterID = 9103 }
  alertsFire()
  CRT.Alerts.running, CRT.Alerts.run = false, nil
  T:SavePull({ encounterID = 9103, name = "Epsilon", difficultyID = 16, startedAt = NOW + 3, length = 250, kill = false, casts = {}, deaths = {} })
  local ep = S:Boss(9103, "mythic")
  eq(CRT.db.seasonStats.filled, true, "the first save after an update fills")
  eq(ep and ep.pulls, 6, "the saved pull is counted once, with the five before it")
  eq(ep and ep.nights[S.NightKey(NOW + 3)].phase, 3, "and keeps its phase")
  CRT.db.seasonStats = saved
end

-- 3. Nights, phases, causes and the deaths trend ----------------------------------------------------------------------
eq(S.NightKey(os.time({ year = 2026, month = 10, day = 21, hour = 0, min = 30 })), "2026-10-20", "a pull after midnight counts on the night before")
eq(S.NightKey(os.time({ year = 2026, month = 10, day = 21, hour = 19 })), "2026-10-21", "an evening pull on its own day")
local function rec(enc, diff, at, length, kill, phase, deaths)
  S:Record({ encounterID = enc, name = "Alpha", difficultyID = diff, startedAt = at, length = length, kill = kill, deaths = deaths or {} }, phase)
end
local A1 = os.time({ year = 2026, month = 9, day = 15, hour = 20 })
rec(9001, 14, A1, 100, false, 1, { { spellID = 111 }, { spellID = 111 } })
rec(9001, 14, A1 + 600, 250, false, 2, { { spellID = 111 }, { spellID = 222 } })
rec(9001, 14, A1 + 4.5 * 3600, 180, false, 2, { { spellID = 333 }, { spellID = 444 }, { spellID = 222 } })
rec(9001, 14, A1 + 2 * DAY, 320, false, 3, { { spellID = 0 }, { spellID = 0 } })
rec(9001, 14, A1 + 2 * DAY + 600, 330, false, 3)
local a = S:Boss(9001, "nh")
local r = S.Reflection(a, 8)
eq(#r.nights, 2, "two nights")
eq(r.nights[1].key .. " " .. r.nights[1].longest .. " " .. tostring(r.nights[1].phase) .. " " .. r.nights[1].pulls, "2026-09-15 250 2 3", "night one: longest 250, phase 2, three pulls (one after midnight)")
eq(r.nights[2].key .. " " .. r.nights[2].longest .. " " .. tostring(r.nights[2].phase), "2026-09-17 330 3", "night two: longest 330, phase 3")
eq(r.longest, 330, "the longest of the shown nights")
eq(r.furthest and (r.furthest.phase .. " " .. r.furthest.key), "3 2026-09-17", "furthest phase and the night it was first reached")
eq(#r.causes, 3, "the top three causes")
eq(r.causes[1] and (r.causes[1].spellID .. "x" .. r.causes[1].count), "111x3", "most deaths: 111, three")
eq(r.causes[2] and (r.causes[2].spellID .. "x" .. r.causes[2].count), "222x2", "then 222, two")
eq(r.causes[3] and r.causes[3].spellID, 333, "a tie goes to the lower spell ID; unknown causes never listed")
eq(#S.Reflection(a, 1).nights, 1, "the nights shown are capped to the newest")
eq(S.Reflection(a, 1).nights[1].key, "2026-09-17", "the newest night kept")
for i = 1, 15 do rec(9002, 14, A1 + i * 60, 60, false, nil, { {}, {}, {}, {} }) end
for i = 16, 25 do rec(9002, 14, A1 + i * 60, 60, false, nil, { {} }) end
local b = S:Boss(9002, "nh")
eq(#b.deaths, 20, "deaths per pull: only the last 20 kept")
r = S.Reflection(b)
check(r.recent == 1 and r.recentN == 10, "deaths per pull: the last 10")
check(r.before == 4 and r.beforeN == 10, "deaths per pull: the 10 before")
r = S.Reflection(S:Boss(9103, "mythic"))
eq(r.recentN .. " " .. tostring(r.before), "5 nil", "fewer than 11 pulls: no earlier ten")
r = S.Reflection(nil)
check(#r.nights == 0 and #r.causes == 0 and r.recent == nil and r.furthest == nil, "no counters: an empty reflection")

-- 4. Seasons, groups, rows and cards ------------------------------------------------------------------------------------
local so = S.SeasonOptions()
eq(#so, 2, "both seasons in the Season dropdown")
eq(so[1].key .. "/" .. so[1].label, "test-s2/Test Season 2", "the current season first")
eq(so[2].key, "test-s1", "then the others")
local go = S.GroupOptions()
eq(go[1].key .. "=" .. go[1].label .. ", " .. go[2].key .. "=" .. go[2].label, "nh=Normal/Heroic, mythic=Mythic", "the Timeline's difficulty groups")
local rows = S:Rows("test-s2", "mythic")
eq(#rows, 3, "a row per boss of the season")
eq(rows[1].name .. ", " .. rows[2].name .. ", " .. rows[3].name, "Epsilon, Gamma, Delta", "rows in route order")
eq(rows[3].pulls, 0, "a boss with no pulls on this difficulty: zeros")
eq(rows[3].counters, nil, "and no counters")
eq(S:DefaultGroup("test-s2"), "mythic", "the page opens on the difficulty with more pulls")
eq(S:DefaultGroup("test-s1"), "nh", "Normal/Heroic when that has more")
-- Late Tracker nights: one before the season, two in it, the running one in it too
CRT.db.late.history = {
  { id = 1, startedAt = NOW - 60 * DAY, players = {} },
  { id = 2, startedAt = A1 - 1800, players = {} },
  { id = 3, startedAt = A1 + 2 * DAY - 1800, players = {} },
}
CRT.db.late.current = { id = 4, startedAt = A1 + 2 * DAY + 300, players = {} }
eq(S:RaidNights("test-s1"), 3, "raid nights: the Late Tracker's nights in the season's range")
CRT.db.late.current = nil
eq(S:RaidNights("test-s1"), 2, "without the running night")
local card = S:Cards("test-s2", "mythic")
eq(card.killed .. "/" .. card.bosses, "2/3", "bosses killed of the route")
eq(card.pulls, 125, "pulls on the difficulty")
eq(card.pullTime, 1130 + S:Boss(9101, "mythic").pullTime, "time in pulls")
eq(card.untimed, 106, "pulls with no length")
local empty = S:Cards("test-s1", "mythic")
check(empty.killed == 0 and empty.pulls == 0 and empty.pullTime == 0 and empty.pullNights == 0, "an empty difficulty: zeros")
eq(#S:Rows("no-such-season", "nh"), 0, "an unknown season: no rows")

-- 5. Tattlebot's avoidable damage trend ------------------------------------------------------------------------------
local function tpull(at, diff, a, b2) return { at = at, encounterID = 9001, name = "Alpha", difficulty = diff,
  players = { ["A-R"] = { spells = { [555] = a } }, ["B-R"] = { spells = { [555] = b2, [999] = 7000 } } } } end
CRT.db.tattle.history = {
  { id = 1, startedAt = A1, season = "Season 1", pulls = { tpull(A1, 14, 1000, 500), tpull(A1 + 600, 14, 2000, 500), tpull(A1 + 900, 16, 9000, 0) } },
}
CRT.db.tattle.current = { id = 2, startedAt = A1 + 2 * DAY, pulls = { tpull(A1 + 2 * DAY, 14, 600, 400) } }
CRT.db.tattle.history[1].pulls[#CRT.db.tattle.history[1].pulls + 1] = tpull(A1 + 1200, nil, 50000, 0)
local bp = CRT.Tattle:BossPulls(9001)
eq(#bp, 5, "Tattle:BossPulls: every pull on the boss, the running night too")
check(S:AvoidableTrend(9001, "nh", 4)[2].pulls == 2, "a pull with no readable difficulty is left out of the trend")
eq(bp[1].damage, 1500, "only the counted damage (a spell Tattlebot doesn't track is left out)")
eq(bp[5].at, A1 + 2 * DAY, "oldest first")
eq(#CRT.Tattle:BossPulls(9999), 0, "a boss with no pulls: none")
local trend = S:AvoidableTrend(9001, "nh", 4)
eq(trend and #trend, 2, "the trend: one entry per night")
check(trend and trend[1].key == "2026-09-17" and trend[1].perPull == 1000, "newest night first, damage per pull")
check(trend and trend[2].key == "2026-09-15" and trend[2].pulls == 2 and trend[2].perPull == 2000, "the night before: two pulls, 2000 a pull")
eq(S:AvoidableTrend(9001, "mythic", 4)[1].perPull, 9000, "Mythic pulls apart")
eq(S:AvoidableTrend(9101, "mythic", 4), nil, "no Tattlebot pulls on a boss: no trend")
-- each line carries its Tattlebot night, to open it there
eq(bp[1].night, 1, "Tattle:BossPulls: each pull's night id")
eq(bp[5].night, 2, "the running night's id too")
eq(trend[1].nightID, 2, "the trend's newest line: the running night")
eq(trend[2].nightID, 1, "the night before: the saved night")
eq(trend[2].nightIDs and #trend[2].nightIDs, 1, "one Tattlebot night on that date")
do
  -- two Tattlebot nights on one date: both kept, the newest opened
  local hist = CRT.db.tattle.history
  hist[#hist + 1] = { id = 3, startedAt = A1 + 3000, season = "Season 1", pulls = { tpull(A1 + 3000, 14, 100, 0) } }
  local t2 = S:AvoidableTrend(9001, "nh", 4)
  eq(t2[2].nightIDs and table.concat(t2[2].nightIDs, ","), "3,1", "two nights on a date: newest first")
  eq(t2[2].nightID, 3, "and the newest is the one opened")
  hist[#hist] = nil
end
eq(CRT.Tattle:Night(1) and CRT.Tattle:Night(1).id, 1, "Tattle:Night: a saved night")
eq(CRT.Tattle:Night(2) and CRT.Tattle:Night(2).id, 2, "Tattle:Night: the running night")
eq(CRT.Tattle:Night(99), nil, "Tattle:Night: a night that is gone")
eq(CRT.Tattle:Night(nil), nil, "Tattle:Night: no id")

-- the death causes on the boss's ability timeline: by spell ID, else by name; cached until the Timeline changes
local R = CRT.TimelineReference
CRT.db.timeline.references = { { id = 1, text = "Boss: Gamma\\nEncounter: 9101\\nDifficulty: Mythic\\n"
  .. "Fang Bite [spell 111] (type raid dodge): 0:10\\nvenom pool (type soak, color 112233): 0:20\\nOther Thing [spell 777]: 0:30" } }
CRT.db.timeline.nextRef = 2
local fang = S:AbilityRow(9101, "mythic", 111, "Fang Bite", "Gamma")
eq(fang and fang.name, "Fang Bite", "a cause on the ability timeline, by spell ID")
local venom = S:AbilityRow(9101, "mythic", 222, "Venom Pool", "Gamma")
eq(venom and venom.name, "venom pool", "a cause on the ability timeline, by name in any case")
eq(S:AbilityRow(9101, "mythic", 333, "Tail Swipe", "Gamma"), nil, "a cause not on the ability timeline: none")
eq(S:AbilityRow(9101, "mythic", 0, nil, "Gamma"), nil, "an unknown cause: none")
eq(S:AbilityRow(9101, "nh", 111, "Fang Bite", "Gamma"), nil, "another difficulty group's ability timeline isn't read")
local reads = 0
local realFor = T.ReferenceFor
T.ReferenceFor = function(...) reads = reads + 1 return realFor(...) end
S:AbilityRow(9101, "mythic", 111, "Fang Bite", "Gamma")
S:AbilityRow(9101, "mythic", 222, "Venom Pool", "Gamma")
eq(reads, 0, "the ability timeline is read once per boss and group")
T:Fire()
S:AbilityRow(9101, "mythic", 111, "Fang Bite", "Gamma")
eq(reads, 1, "and again after the Timeline changes")
T:SetChosenReference(9101, "mythic", nil)
S:AbilityRow(9101, "mythic", 111, "Fang Bite", "Gamma")
eq(reads, 2, "and again after another ability timeline is picked In use")
T.ReferenceFor = realFor

-- 6. Text ------------------------------------------------------------------------------------------------------------
eq(S.Clock(272), "4:32", "clock")
eq(S.Clock(3725), "1:02:05", "clock past an hour")
eq(S.Hours(11100), "3h 05m", "hours")
eq(S.Hours(2700), "45m", "minutes")
eq(S.PhaseText(2), "Phase 2", "phase")
eq(S.PhaseText(1.5), "Phase 1.5", "an intermission phase")

-- 7. The page --------------------------------------------------------------------------------------------------------
assert(load(pageSrc, "SeasonStats/Page.lua"))("CowfeeRaidTools", CRT)
-- Tattlebot's page, which a night's line opens (built only when it is first shown)
assert(load(tattlePageSrc, "Tattlebot/Page.lua"))("CowfeeRaidTools", CRT)
local P = pages.seasonstats
check(P ~= nil, "the page registers as seasonstats")
eq(P and P.title, "Season Stats", "its title")
local pf = mock()
P.build(pf)
local V = S.view
check(V and V.cards and V.rows and V.refl and V.refresh, "the page's parts")
check(helps["Season Stats"] ~= nil, "the page's (?)")
local reflHelp
for title, text in pairs(helps) do if text:find("health", 1, true) then reflHelp = text end end
check(reflHelp and reflHelp:find("longest pull", 1, true) and reflHelp:find("furthest phase", 1, true), "the reflection's (?) says the longest pull and furthest phase stand in for the boss's health")
check(reflHelp and reflHelp:find("Click a night", 1, true) and reflHelp:find("ability timeline", 1, true), "and that a night opens in Tattlebot and causes take the ability timeline's colours")
local sd, dd = dropdowns.Season, dropdowns.Difficulty
check(sd and dd, "the Season and Difficulty dropdowns")
local sopts = type(sd.opts.options) == "function" and sd.opts.options() or sd.opts.options
eq(sopts[1].key, "test-s2", "Season: the current season first")
eq(sd.opts.get(), "test-s2", "the page opens on the current season")
eq(dd.opts.get(), "mythic", "and on the difficulty with more pulls")
local dopts = type(dd.opts.options) == "function" and dd.opts.options() or dd.opts.options
eq(#dopts, 2, "Difficulty: the two groups")
-- cards
eq(V.cards.killed.value.text, "2 / 3", "card: bosses killed")
eq(V.cards.pulls.value.text, "125", "card: pulls")
eq(V.cards.nights.value.text, "0", "card: raid nights (none in this season)")
eq(V.cards.time.value.text, S.Hours(card.pullTime), "card: time in pulls")
-- the table, route order
local function rowName(i) return V.rows[i] and V.rows[i].shown and V.rows[i].name.text end
eq(rowName(1) .. ", " .. rowName(2) .. ", " .. rowName(3), "Epsilon, Gamma, Delta", "the table in route order")
eq(plain(V.rows[1].pulls.text .. " " .. V.rows[1].wipes.text .. " " .. V.rows[1].kills.text .. " " .. V.rows[1].toKill.text .. " " .. V.rows[1].best.text),
  "5 3 2 4 4:20", "Epsilon's row: pulls, wipes, kills, pulls to first kill, best kill")
eq(V.rows[1].first.text, date("%Y-%m-%d", NOW - 8 * DAY + 2400), "first kill date")
eq(V.rows[3].toKill.text, "-", "no pulls: a dash")
check(not V.rows[4] or not V.rows[4].shown, "no extra rows")
-- sorting by a column, then back to route order
local sh = sorts[1]
check(sh and sh.opts.backToDefault, "sortable headers that go back to route order")
sh.opts.set("pulls", -1)
eq(rowName(1), "Gamma", "sorted by pulls, most first")
sh.opts.set(nil, 1)
eq(rowName(1), "Epsilon", "back to route order")
-- the reflection: empty until a boss is picked
check(V.refl.hint.shown and V.refl.hint.text ~= "" and not V.refl.body.shown, "no boss picked: a line says to pick one")
-- a Gamma death to a spell on no ability timeline, for the third cause
S:Record({ encounterID = 9101, name = "Gamma", difficultyID = 16, startedAt = NOW + 900, length = 60, kill = false, deaths = { { spellID = 333 } } })
V.rows[2].scripts.OnClick(V.rows[2])
check(not V.refl.hint.shown and V.refl.body.shown, "Gamma picked: the reflection fills")
check(V.refl.title.text:find("Gamma", 1, true) ~= nil, "the reflection names the boss")
check(V.refl.bars[1].shown and V.refl.bars[1].value.text:find("6:40", 1, true) and V.refl.bars[1].value.text:find("Phase 2", 1, true), "a bar per night: longest pull and phase (" .. tostring(V.refl.bars[1].value.text) .. ")")
check(V.refl.furthest.text:find("Phase 2", 1, true) ~= nil, "furthest phase line")
local c1, c2, c3 = V.refl.causes[1], V.refl.causes[2], V.refl.causes[3]
check(plain(c1.label.text):find("Fang Bite", 1, true) and c1.label.text:find("12", 1, true), "top cause by name, with its count (" .. tostring(c1.label.text) .. ")")
check(plain(c2.label.text):find("Venom Pool", 1, true) ~= nil, "second cause")
-- coloured as the Timeline draws the ability timeline's row
check(c1.label.text:lower():find("|cff" .. R.TYPES.raid.hex:lower() .. "fang bite|r", 1, true) ~= nil, "a cause on the ability timeline by spell ID: its row's type colour (" .. c1.label.text .. ")")
check(c2.label.text:lower():find("|cff" .. R.TYPES.soak.hex:lower() .. "venom pool|r", 1, true) ~= nil, "by name, custom colours off: the type's colour (" .. c2.label.text .. ")")
eq(c3.label.text, "Tail Swipe: 1", "a cause on no ability timeline: plain")
customColors = true
V.refresh()
check(c2.label.text:lower():find("|cff112233venom pool|r", 1, true) ~= nil, "custom colours on: the row's own colour (" .. c2.label.text .. ")")
check(c1.label.text:lower():find("|cff" .. R.TYPES.raid.hex:lower(), 1, true) ~= nil, "a row with no colour of its own keeps its type's")
customColors = false
V.refresh()
c1.scripts.OnEnter(c1)
eq(GameTooltip.owner, c1, "a cause's tooltip, on its line")
local tl = table.concat(GameTooltip.lines, "\\n")
check(GameTooltip.lines[1] == "Fang Bite" and tl:find(R.TypeLine("raid"), 1, true) and tl:find(R.TypeLine("dodge"), 1, true), "the tooltip: the spell, then its types (" .. tl .. ")")
check(GameTooltip.colors[2] and GameTooltip.colors[2][1] == R.TYPES.raid.color[1], "each type line in its type's colour")
c3.scripts.OnEnter(c3)
check(#GameTooltip.lines == 3 and GameTooltip.lines[1] == "Tail Swipe" and GameTooltip.lines[2] == "Encounter Journal (Mythic)" and GameTooltip.lines[3] == "Swipes the tail.",
  "not on the ability timeline: the spell and its Journal text (" .. table.concat(GameTooltip.lines, " / ") .. ")")
check(journalAsked[#journalAsked] == "9101/mythic/333/nil", "the Journal asked for the boss and difficulty shown: " .. tostring(journalAsked[#journalAsked]))
-- each cause with its icon: the spell's, else the Journal's once read, else a question mark
eq(c1.icon.texture, "tex111", "a cause's spell icon")
check(c1.icon.w == 16 and c1.icon.h == 16 and c1.label.point[2] >= 16, "a 16 px icon left of the name")
eq(c3.icon.texture, 4040, "no spell icon: the Journal's")
eq(S:CauseIcon(9101, "mythic", 0, nil), S.UNKNOWN_ICON, "an unknown spell: a question mark")
eq(S:CauseIcon(9101, "mythic", 444, "Nothing"), S.UNKNOWN_ICON, "no icon anywhere: a question mark")
check(journalAsked[1] and journalAsked[1]:find("/true$"), "drawing never reads the Journal anew: " .. tostring(journalAsked[1]))
c3.scripts.OnLeave(c3)
check(V.refl.trend.text:find("in the last", 1, true) ~= nil, "deaths per pull line")
check(V.refl.avoid[1] and not V.refl.avoid[1].shown, "no Tattlebot pulls on Gamma: no avoidable lines")
check(V.refl.avoidHint.shown, "and a line says so")
-- hover: the row's tooltip, placed by UI.TooltipOwner
V.rows[2].scripts.OnEnter(V.rows[2])
eq(GameTooltip.owner, V.rows[2], "the row's tooltip, on the row")
check(table.concat(GameTooltip.lines, " "):find("Time in pulls", 1, true) ~= nil, "the tooltip has the boss's time in pulls")
V.rows[2].scripts.OnLeave(V.rows[2])
-- the other season and difficulty
sd.opts.set("test-s1")
dd.opts.set("nh")
eq(rowName(1) .. ", " .. rowName(2), "Alpha, Beta", "Test Season 1's bosses")
eq(V.cards.nights.value.text, "2", "raid nights from the Late Tracker")
check(V.refl.hint.shown, "a new season: the pick is cleared")
V.rows[1].scripts.OnClick(V.rows[1])
local av1, av2 = V.refl.avoid[1], V.refl.avoid[2]
check(av1.shown and av1.label.text:find("2026-09-17", 1, true) and av1.label.text:find("1K", 1, true), "Tattlebot's trend, newest night first (" .. tostring(av1.label.text) .. ")")
check(av2.shown and av2.label.text:find("2K", 1, true), "then the night before")
-- each night opens in Tattlebot
check(av2.arrow.shown and plain(av2.arrow.text) == ">", "a night in Tattlebot: a > at its right")
check(av2.arrow.text ~= ">", "the > in the heading colour")
av2.scripts.OnEnter(av2)
eq(GameTooltip.owner, av2, "the night's tooltip, on its line")
check(table.concat(GameTooltip.lines, " "):find("Open this night in Tattlebot", 1, true) ~= nil, "it says the click opens it in Tattlebot")
av2.scripts.OnLeave(av2)
av2.scripts.OnClick(av2)
eq(selectedPage, "tattle", "click: the Tattlebot page")
local tab, sel, season = CRT.TattlePage.State()
eq(tab .. " " .. tostring(sel) .. " " .. tostring(season), "history 1 all", "on History, all seasons, with that night selected")
av1.scripts.OnClick(av1)
eq((CRT.TattlePage.State()), "tonight", "the running night opens on Tattlebot's Tonight tab")
-- a Mechanic filter picked in Tattlebot: opening a night shows all of it again
dropdowns.Mechanic.opts.set("spell/555")
eq(select(4, CRT.TattlePage.State()), "spell/555", "a Mechanic filter picked")
CRT.TattlePage.ShowNight(1)
eq(select(4, CRT.TattlePage.State()), "all", "opening a night resets the Mechanic filter to All")
-- an old night far down History's list: the list scrolls it into view
do
  local hist = CRT.db.tattle.history
  for n = 1, 8 do table.insert(hist, n, { id = 10 + n, startedAt = A1 - (9 - n) * DAY, season = "Season 1", pulls = {} }) end
  local listScroll
  for _, f in ipairs(made) do if f.name == "CowfeeRaidToolsTattleListScroll" then listScroll = f end end
  check(listScroll ~= nil, "Tattlebot's History list")
  listScroll.h, listScroll.vscroll = 88, nil
  -- the list: Totals, night 1, then 18 down to 11; night 13 is the 8th row
  check(CRT.TattlePage.ShowNight(13), "an old night opens")
  eq(listScroll.vscroll, 7 * 22 - 44, "the list scrolls the old night to its middle")
  listScroll.vscroll = nil
  CRT.Tattle:Fire()
  eq(listScroll.vscroll, nil, "only once: a later redraw leaves the scroll alone")
  CRT.TattlePage.ShowNight(11)
  eq(listScroll.vscroll, 10 * 22 - 88, "the last night: no further than the list's end")
  for n = 1, 8 do table.remove(hist, 1) end
end
-- Tattlebot's page hidden: no >, and nothing opens
pages.tattle.hidden = true
V.refresh()
check(av2.shown and not av2.arrow.shown, "Tattlebot's page hidden: no >")
local stateBefore = { CRT.TattlePage.State() }
selectedPage = nil
eq(CRT.TattlePage.ShowNight(1), false, "ShowNight: false with the page hidden")
eq(selectedPage, nil, "and the panel stays")
eq(table.concat({ CRT.TattlePage.State() }, " "), table.concat(stateBefore, " "), "and Tattlebot's state is left alone")
pages.tattle.hidden = nil
V.refresh()
check(av2.arrow.shown, "shown again: the > is back")
-- a night deleted from Tattlebot while the line still shows it: not clickable
pf.shown = false
CRT.Tattle:Delete(1)
selectedPage = nil
av2.scripts.OnEnter(av2)
check(table.concat(GameTooltip.lines, " "):find("no longer in Tattlebot", 1, true) ~= nil, "a night that is gone: the tooltip says so")
check(not av2.arrow.shown, "and its > goes")
av2.scripts.OnClick(av2)
eq(selectedPage, nil, "and a click opens nothing")
pf.shown = true
CRT.Tattle:Fire()
check(av1.shown and not av2.shown, "a change in Tattlebot redraws the lines while the page shows")
-- a boss with no pulls on this difficulty
dd.opts.set("mythic")
check(V.refl.hint.shown == false and V.refl.empty.shown, "a picked boss with no pulls on the difficulty: says so")
check(V.empty.shown, "and the table says there are no pulls")
dd.opts.set("nh")
check(not V.empty.shown, "the table's empty line goes again")
-- it refreshes on a change while shown
local before = V.cards.pulls.value.text
S:Record({ encounterID = 9002, name = "Beta", difficultyID = 14, startedAt = NOW, length = 30, kill = false, deaths = {} })
check(V.cards.pulls.value.text ~= before, "a new pull updates the page")
-- everything inside the page area
local outside = {}
local function walk(f, ox, oy)
  for _, k in ipairs(f.kids or {}) do
    local p = k.point
    if p and type(p[2]) == "number" and (p[1] == "TOPLEFT") then
      local x, y = ox + p[2], oy + p[3]
      if x < 0 or x + (k.w or 0) > UI.PAGE_W or y > 0 or y - (k.h or 0) < -UI.PAGE_H then outside[#outside + 1] = tostring(k.text or k.name or "?") .. " at " .. x .. "," .. y end
      walk(k, x, y)
    end
  end
end
walk(pf, 0, 0)
check(#outside == 0, "nothing reaches outside the page area: " .. table.concat(outside, "; "))

-- 8. Saved data, the menu, the share, the .toc, no season facts -------------------------------------------------------
check(panelSrc:find('"requests", "seasonstats"', 1, true) ~= nil, "Modules lists Season Stats right after Requests")
check(profilesSrc:find("seasonStats = false", 1, true) ~= nil, "Export settings only keeps Season Stats back")
check(tocSrc:find("CRT_Modules\\\\SeasonStats\\\\Data.lua", 1, true) and tocSrc:find("CRT_Modules\\\\SeasonStats\\\\Page.lua", 1, true), "both files in the .toc")
local tocTl = tocSrc:find("CRT_Modules\\\\Timeline\\\\Data.lua", 1, true)
check(tocTl and tocTl < tocSrc:find("CRT_Modules\\\\SeasonStats\\\\Data.lua", 1, true), "after the Timeline's store")
for _, name in ipairs({ "Midnight", "midnight-s1", "Twin Fang", "Nek'zali", "Season 1" }) do
  check(not dataSrc:find(name, 1, true) and not pageSrc:find(name, 1, true), "no season fact in the feature code: " .. name)
end
check(not pageSrc:find("CRTDB", 1, true), "the page saves nothing of its own")
check(not (pageSrc:match("local COLS = (%b{})") or "title"):find("title", 1, true), "the column titles come from TEXT")
eq(sorts[1].cols[5].title, "To first kill", "the headers still read their titles")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Modules/Timeline/Data.lua', 'CRT_Data/Bosses/Registry.lua', 'CRT_Modules/Late/Data.lua', 'CRT_Modules/Tattlebot/Data.lua',
  'CRT_Modules/SeasonStats/Data.lua', 'CRT_Modules/SeasonStats/Page.lua', 'CRT_Core/Core.lua', 'CRT_Core/UI/Panel.lua', 'CRT_Core/Profiles.lua',
  'CowfeeRaidTools.toc', 'CRT_Modules/Timeline/Reference.lua', 'CRT_Modules/Tattlebot/Page.lua', 'CRT_Modules/Timeline/AbilityTip.lua'];
for (const f of files) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
