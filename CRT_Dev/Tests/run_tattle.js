// Tattlebot and the team raid check (CRT_Modules/Tattlebot/Data.lua, Page.lua): Only record team raids (on by default)
// reads, saves and posts nothing for a pull that wasn't a team raid; turned off, every pull is saved and stamped team
// = true or false, and a night holds one kind (a pull of the other kind starts a new night); nights and pulls from
// before count as team raids; Tattlebot reads CRT.Team through its one accessor; the Settings tab's check box and
// History's Show filter, there only once a night that wasn't a team raid is saved. Also the season new nights are
// filed under: the current season pack's name (the sample pack's), your own typed name instead, Season 1 with no pack.
// Usage: node run_tattle.js <addon folder>
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local dataSrc, pageSrc, coreSrc, profilesSrc, registrySrc, sampleSeasonSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end
issecretvalue = function(v) return v == "SECRET" end
format = string.format
date = os.date
strtrim = function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
local NOW = os.time({ year = 2026, month = 10, day = 20, hour = 20, min = 0, sec = 0 })
time = function(t) if t then return os.time(t) end return NOW end
GetTime = function() return 1000 end
local timers = {}
C_Timer = { After = function(_, fn) timers[#timers + 1] = fn end, NewTicker = function() return { Cancel = function() end } end }
local function runTimers() for _ = 1, 10 do local list = timers timers = {} if #list == 0 then return end for _, fn in ipairs(list) do fn() end end end
GameTooltip = { SetOwner = function() end, SetText = function() end, AddLine = function() end, Show = function() end, Hide = function() end, ClearAllPoints = function() end, SetPoint = function() end }

-- stand-in frames
local function mock()
  local o = { shown = true, scripts = {}, events = {}, kids = {} }
  return setmetatable(o, { __index = function(t, k)
    local m = ({
      SetText = function(self, v) self.text = v end,
      GetText = function(self) return self.text end,
      Show = function(self) self.shown = true if self.scripts.OnShow then self.scripts.OnShow(self) end end,
      Hide = function(self) self.shown = false end,
      IsShown = function(self) return self.shown end,
      IsVisible = function(self) return self.shown and (not self.parent or self.parent:IsVisible()) end,
      SetShown = function(self, v) self.shown = v and true or false end,
      SetScript = function(self, name, fn) self.scripts[name] = fn end,
      RegisterEvent = function(self, e) self.events[e] = true end,
      SetSize = function(self, w, h) self.w, self.h = w, h end,
      SetWidth = function(self, w) self.w = w end,
      SetHeight = function(self, h) self.h = h end,
      GetWidth = function(self) return self.w or 300 end,
      GetHeight = function(self) return self.h or 300 end,
      SetPoint = function(self, ...) self.point = { ... } end,
      ClearAllPoints = function(self) self.point = nil end,
      SetChecked = function(self, v) self.checked = v end,
      GetChecked = function(self) return self.checked end,
      CreateTexture = function(self) local x = mock() x.parent = self self.kids[#self.kids + 1] = x return x end,
      CreateFontString = function(self) local x = mock() x.parent = self x.isText = true self.kids[#self.kids + 1] = x return x end,
      GetStringWidth = function(self) return #(self.text or "") * 6 end,
      GetStringHeight = function() return 12 end,
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

-- the game: a raid instance, the damage meter with one hit on a tracked spell, the leader posting
local _, inst = nil, "raid"
IsInInstance = function() return true, inst end
IsInRaid = function() return false end
GetNumSubgroupMembers = function() return 0 end
UnitGUID = function(u) return u == "player" and "G1" or nil end
UnitFullName = function(u) if u == "player" then return "Moo", "Realm" end end
UnitIsGroupLeader = function() return true end
GetNormalizedRealmName = function() return "Realm" end
C_DamageMeter = {
  IsDamageMeterAvailable = function() return true end,
  GetCombatSessionFromType = function() return { combatSources = { { classFilename = "PALADIN", sourceGUID = "G1", name = "Moo-Realm" } }, durationSeconds = 90 } end,
  GetCombatSessionSourceFromType = function() return { combatSpells = { { spellID = 555, totalAmount = 1000 } } } end,
}
local reads = 0
local realSession = C_DamageMeter.GetCombatSessionFromType
C_DamageMeter.GetCombatSessionFromType = function(...) reads = reads + 1 return realSession(...) end

-- the CRT
local helps, pages, dropdowns = {}, {}, {}
local UI = {
  PAGE_W = 1026, PAGE_H = 560, pages = pages,
  RegisterPage = function(_, key, title, build) pages[key] = { title = title, build = build } end,
  SelectPage = function(_, key) local p = pages[key] if not p then return end
    if not p.frame then p.frame = mock() p.frame.shown = false p.build(p.frame) end p.frame:Show() end,
  Show = function(self, key) self:SelectPage(key) end,
  SetTabSelected = function() end, RegisterTab = function() end, SkinScrollBar = function() end, SkinCheckButton = function() end,
  HelpRight = function(target, title, text) helps[title] = text local h = mock() h.target = target return h end,
  Dropdown = function(parent, label, opts) local row = mock() row.parent = parent row.label, row.opts = label, opts row.refresh = function() row.refreshed = (row.refreshed or 0) + 1 end
    dropdowns[label] = row return row end,
  IsModern = function() return true end,
}
local CRT = { UI = UI, db = {} }
local posted = {}
function CRT:Print() end
CRT.RaidReport = { Output = function(_, lines, out) posted[#posted + 1] = out end }
CRT.Groups = { OnChange = function() end, ClassColor = function() return 1, 1, 1 end, ReportName = function(k) return k end,
  Normalize = function(n) return n:find("-", 1, true) and n or (n .. "-Realm") end }
CRT_THEME(CRT, UI)
local coreDefault = coreSrc:match("\\n    tattle = (%b{}),")
check(coreDefault ~= nil, "Core.lua has a tattle default")
CRT.db.tattle = assert(load("return " .. (coreDefault or "{}")))()
eq(CRT.db.tattle.onlyTeam, true, "Only record team raids is on by default")
CRT.TattleDB = { bosses = { { boss = "Alpha", encounterID = 9001, mechanics = { { name = "Puddle", spells = { 555 } } } } } }

-- the team raid check, a stand-in: the answer at each pull's start
local teamAnswer = true
local asked = 0
local askedAt, nowAsked = nil, 0
local outsideRaid = false -- a pull outside a raid group (Raid Finder, a party): no team
-- tonight's team: Raid Alpha for a team raid, Pug for one that isn't (CRT_Core/Team.lua)
CRT.Team = { PullIsTeam = function(_, enc, at) asked = asked + 1 askedAt = at return teamAnswer end,
  IsTeam = function() nowAsked = nowAsked + 1 return teamAnswer end,
  PullTeam = function() if outsideRaid then return nil end return teamAnswer and "Raid Alpha" or "Pug" end,
  TeamNow = function() return teamAnswer and "Now Team" or "Pug" end }

assert(load(dataSrc, "Tattlebot/Data.lua"))("CowfeeRaidTools", CRT)
local Tattle = CRT.Tattle
local driver
for _, f in ipairs(made) do if f.events.ENCOUNTER_END and f.scripts.OnEvent then driver = f end end
check(driver ~= nil, "Tattlebot's driver")
local function pull(enc, name)
  driver.scripts.OnEvent(driver, "ENCOUNTER_START", enc, name, 16, 20)
  NOW = NOW + 120
  driver.scripts.OnEvent(driver, "ENCOUNTER_END", enc, name, 16, 20, 0)
  runTimers()
end
local s = CRT.db.tattle

-- 1. Nights and pulls from before team raids count as team raids ----------------------------------------------------
s.history = { { id = 1, startedAt = NOW - 86400, season = "Season 1", pulls = { { at = NOW - 86400, encounterID = 9001, players = {} } } } }
s.nextId = 2
check(Tattle.IsTeam(s.history[1].pulls[1]), "a pull with no stamp is a team raid")
eq(Tattle:HasOtherNights(), false, "only old nights: nothing but team raids")
eq(#Tattle.InScope(s.history, "team"), 1, "and they are in Team raids")

-- 2. Only record team raids on: a pull that isn't one records nothing ---------------------------------------------
s.autoPost = true
teamAnswer = false
reads = 0
pull(9001, "Alpha")
eq(asked, 1, "the check is asked once at the pull's end")
eq(askedAt, NOW - 120, "for the pull's own start, its snapshot at ENCOUNTER_START")
eq(s.current, nil, "not a team raid: no night started")
eq(reads, 0, "and the meter isn't even read")
eq(#posted, 0, "and nothing is posted")
-- a team raid pull is recorded, stamped
teamAnswer = true
pull(9001, "Alpha")
check(s.current ~= nil and #s.current.pulls == 1, "a team raid pull is recorded")
eq(s.current.pulls[1].team, true, "and stamped a team raid")
eq(s.current.pulls[1].teamName, "Raid Alpha", "with the name of the team it started with")
eq(#posted, 1, "and posted")
-- a pull waiting for combat's end is dropped when a pull that isn't a team raid ends first
local before = #s.current.pulls
driver.scripts.OnEvent(driver, "PLAYER_REGEN_DISABLED")
pull(9001, "Alpha")
teamAnswer = false
pull(9001, "Alpha")
driver.scripts.OnEvent(driver, "PLAYER_REGEN_ENABLED")
runTimers()
eq(#s.current.pulls, before, "a skipped pull leaves nothing waiting to be read")
teamAnswer = true

-- 3. Off: every pull is recorded and stamped; a night stays whole ---------------------------------------------
s.onlyTeam = false
teamAnswer = false
local teamNight = s.current
pull(9001, "Alpha")
pull(9001, "Alpha")
eq(s.current, teamNight, "pulls that aren't team raids join the same night")
eq(#teamNight.pulls, before + 2, "kept whole")
eq(teamNight.pulls[#teamNight.pulls].team, false, "each pull stamped as it was")
eq(teamNight.pulls[#teamNight.pulls].teamName, "Pug", "a Pug pull named Pug")
outsideRaid = true
pull(9001, "Alpha")
outsideRaid = false
eq(teamNight.pulls[#teamNight.pulls].team, false, "a pull outside a raid group (Raid Finder, a party) isn't a team raid")
eq(teamNight.pulls[#teamNight.pulls].teamName, nil, "and has no team's name, so it never files under Pug")
table.remove(teamNight.pulls)
eq(Tattle:HasOtherNights(), true, "now there is a pull that wasn't a team raid")
teamAnswer = true
pull(9001, "Alpha")
eq(s.current, teamNight, "back in a team raid: still the same night")
Tattle:EndNight("button")
-- a night of only other pulls
teamAnswer = false
pull(9001, "Alpha")
local pugNight = s.current
Tattle:EndNight("button")
local inTeam = Tattle.InScope(s.history, "team")
eq(#inTeam + 1, #s.history, "Team raids leaves out a night with no team pull")
local mixed
for _, n in ipairs(inTeam) do if n.id == teamNight.id then mixed = n end end
check(mixed and mixed ~= teamNight and #mixed.pulls == #teamNight.pulls - 2, "and shows a mixed night with its team pulls only")
eq(#teamNight.pulls, before + 3, "the saved night itself is left whole")
eq(#Tattle.InScope(s.history, "all"), #s.history, "All raids keeps every night")
local bp = Tattle:BossPulls(9001)
local pugPulls = 0 for _, p in ipairs(bp) do if p.team == false then pugPulls = pugPulls + 1 end end
eq(pugPulls, 3, "BossPulls marks each pull's kind, for Season Stats")
local named = {} for _, p in ipairs(bp) do named[tostring(p.teamName)] = (named[tostring(p.teamName)] or 0) + 1 end
eq(named.Pug, 3, "and its team's name, for Season Stats' Team filter")
-- a fight saved by hand from the Last fight view is stamped too
teamAnswer = false
local scanned = Tattle:AddScannedPull({ spells = { { id = 555 } }, players = {}, boss = { name = "Alpha", encounterID = 9001 } }, { 555 })
eq(scanned.team, false, "a fight saved from the Last fight view is stamped")
local n0 = nowAsked
teamAnswer = true
local scanned2 = Tattle:AddScannedPull({ spells = { { id = 555 } }, players = {} }, { 555 })
eq(nowAsked, n0 + 1, "a fight that wasn't a boss asks the answer now, not a pull's snapshot")
eq(scanned2.team, true, "and is stamped by it")
eq(scanned2.teamName, "Now Team", "with tonight's team now")
Tattle:EndNight("button")
-- only the accessor reads the check
local _, uses = dataSrc:gsub("= CRT%.Team", "")
eq(uses, 1, "Tattlebot/Data.lua reads CRT.Team in one place, its accessor")
check(not pageSrc:find("CRT.Team", 1, true), "the page never reads it")
CRT.Team = nil
eq(Tattle.PullIsTeam(9001), true, "with no check loaded, a pull is a team raid, as before")

-- 4. The page: the check box and the Show filter ---------------------------------------------------------------------
s.onlyTeam = true
assert(load(pageSrc, "Tattlebot/Page.lua"))("CowfeeRaidTools", CRT)
UI:SelectPage("tattle")
local pf = pages.tattle.frame
local box
local function walk(f) for _, k in ipairs(f.kids or {}) do if k.isText and k.text == "Only record team raids" then box = k end walk(k) end end
walk(pf)
check(box ~= nil, "Settings: an Only record team raids check box")
check(helps["Only record team raids"] ~= nil and helps["Only record team raids"]:find("General Settings", 1, true), "with a (?) saying where the share is set")
local sh = dropdowns.Show
check(sh ~= nil, "History: a Show dropdown")
eq(sh.opts.get(), "team", "Team raids by default")
CRT.TattlePage.ShowNight(pugNight.id)
check(sh.shown, "shown while a pull that wasn't a team raid is saved")

local o = sh.opts.options
eq(o[1].key .. "=" .. o[1].label .. ", " .. o[2].key .. "=" .. o[2].label, "team=Team raids, all=All raids", "its choices")
CRT.TattlePage.ShowNight(pugNight.id)
eq(select(5, CRT.TattlePage.State()), "all", "opening a night with other pulls shows All raids, so all of it is listed")
eq(select(2, CRT.TattlePage.State()), pugNight.id, "and selected")
-- with only team nights, the filter goes
for _, n in ipairs(s.history) do for i = #n.pulls, 1, -1 do if not Tattle.IsTeam(n.pulls[i]) then table.remove(n.pulls, i) end end end
s.current = nil
Tattle:Fire()
check(not sh.shown, "only team raids saved: no Show dropdown")
local core = coreSrc
check(profilesSrc:find("onlyTeam = true, avoidable", 1, true) ~= nil, "Only record team raids is shared in Export settings only")

-- 5. The season new nights are filed under: the season pack's name, unless you typed your own -------------------
eq(CRT.db.tattle.season, "", "the default is empty: follow the current season")
local _, literals = (dataSrc .. pageSrc):gsub('"Season 1"', "")
eq(literals, 1, "Season 1 is written once, as Tattle.DEFAULT_SEASON")
check(not coreSrc:find('"Season 1"', 1, true), "and not in Core.lua")
CRT.Bosses = nil
eq(Tattle:SeasonName(), "Season 1", "no season pack: Season 1")
s.season = "Season 1"
eq(Tattle:SeasonName(), "Season 1", "the old default, no season pack: Season 1")
assert(load(registrySrc, "Registry.lua"))("CowfeeRaidTools", CRT)
assert(load(sampleSeasonSrc, "Season.lua"))("CowfeeRaidTools", CRT)
eq(Tattle:SeasonName(), "Sample Season", "the old default saved in a profile follows the current season pack")
s.season = ""
eq(Tattle:SeasonName(), "Sample Season", "an empty name follows it too")
s.onlyTeam, teamAnswer = false, true
NOW = NOW + 86400
pull(9001, "Alpha")
eq(s.current and s.current.season, "Sample Season", "a new night is labelled with the current season's name")
Tattle:EndNight("button")
local packNight = s.history[#s.history]
Tattle:SetSeasonName("  Tier X  ")
eq(s.season, "Tier X", "a typed name is saved, trimmed")
eq(Tattle:SeasonName(), "Tier X", "and overrides the season pack")
NOW = NOW + 86400
pull(9001, "Alpha")
eq(s.current and s.current.season, "Tier X", "a new night takes the typed name")
Tattle:EndNight("button")
eq(packNight.season, "Sample Season", "a saved night keeps its label")
eq(s.history[1].season, "Season 1", "and so do the oldest")
local names = table.concat(Tattle:Seasons(), ", ")
eq(names, "Season 1, Sample Season, Tier X", "the History filter lists every season, oldest first")
Tattle:SetSeasonName("Sample Season")
eq(s.season, "", "typing the season pack's own name goes back to following it")
Tattle:SetSeasonName("Tier X")
Tattle:SetSeasonName("")
eq(s.season, "", "clearing the box goes back to following it")
-- the Settings tab's box shows the name new nights get, and saves what is typed
local seasonBox
local function find(f) for _, k in ipairs(f.kids or {}) do if k.scripts and k.scripts.OnEditFocusLost and k.refresh then seasonBox = k end find(k) end end
find(pf)
check(seasonBox ~= nil, "Settings: the Season box")
if seasonBox then
  seasonBox.refresh()
  eq(seasonBox.text, "Sample Season", "it shows the current season's name")
  seasonBox.text = "My Tier"
  seasonBox.scripts.OnEditFocusLost(seasonBox)
  eq(s.season, "My Tier", "typing a name saves it")
  eq(seasonBox.text, "My Tier", "and the box shows it")
  seasonBox.text = ""
  seasonBox.scripts.OnEditFocusLost(seasonBox)
  eq(s.season, "", "clearing the box follows the season again")
  eq(seasonBox.text, "Sample Season", "and shows its name")
end
check(helps.Season ~= nil and helps.Season:find("current season", 1, true) ~= nil, "the Season (?) says new nights take the current season's name")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Modules/Tattlebot/Data.lua', 'CRT_Modules/Tattlebot/Page.lua', 'CRT_Core/Core.lua', 'CRT_Core/Profiles.lua', 'CRT_Data/Bosses/Registry.lua', 'CRT_Dev/Tests/SamplePack/Season.lua'];
for (const f of files) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
