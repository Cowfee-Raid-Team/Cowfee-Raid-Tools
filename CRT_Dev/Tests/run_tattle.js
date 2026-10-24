// Tattlebot and the team raid check (CRT_Modules/Tattlebot/Data.lua, Page.lua): Only record team raids (on by default)
// reads, saves and posts nothing for a pull that wasn't a team raid; turned off, every pull is saved and stamped team
// = true or false, and a night holds one kind (a pull of the other kind starts a new night); nights and pulls from
// before count as team raids; Tattlebot reads CRT.Team through its one accessor; the Settings tab's check box and
// History's Show filter, there only once a night that wasn't a team raid is saved.
// Usage: node run_tattle.js <addon folder>
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local dataSrc, pageSrc, coreSrc, profilesSrc = ...
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
CRT.Team = { PullIsTeam = function(_, enc) asked = asked + 1 return teamAnswer end }

assert(load(dataSrc, "Tattlebot/Data.lua"))("CowfeeRaidTools", CRT)
local Tattle = CRT.Tattle
local driver
for _, f in ipairs(made) do if f.events.ENCOUNTER_END and f.scripts.OnEvent then driver = f end end
check(driver ~= nil, "Tattlebot's driver")
local function pull(enc, name)
  driver.scripts.OnEvent(driver, "ENCOUNTER_END", enc, name, 16, 20, 0)
  runTimers()
end
local s = CRT.db.tattle

-- 1. Nights and pulls from before team raids count as team raids ----------------------------------------------------
s.history = { { id = 1, startedAt = NOW - 86400, season = "Season 1", pulls = { { at = NOW - 86400, encounterID = 9001, players = {} } } } }
s.nextId = 2
check(Tattle.IsTeam(s.history[1]) and Tattle.IsTeam(s.history[1].pulls[1]), "a night and a pull with no stamp are team raids")
eq(Tattle:HasOtherNights(), false, "only old nights: nothing but team raids")
eq(#Tattle.InScope(s.history, "team"), 1, "and they are in Team raids")

-- 2. Only record team raids on: a pull that isn't one records nothing ---------------------------------------------
s.autoPost = true
teamAnswer = false
reads = 0
pull(9001, "Alpha")
eq(asked, 1, "the check is asked once at the pull's end")
eq(s.current, nil, "not a team raid: no night started")
eq(reads, 0, "and the meter isn't even read")
eq(#posted, 0, "and nothing is posted")
-- a team raid pull is recorded, stamped
teamAnswer = true
pull(9001, "Alpha")
check(s.current ~= nil and #s.current.pulls == 1, "a team raid pull is recorded")
eq(s.current.team, true, "the night is stamped a team raid")
eq(s.current.pulls[1].team, true, "and the pull too")
eq(#posted, 1, "and posted")

-- 3. Off: every pull is recorded and stamped; a night holds one kind ----------------------------------------------
s.onlyTeam = false
teamAnswer = false
local teamNight = s.current
pull(9001, "Alpha")
check(s.current ~= teamNight, "a pull from a raid that isn't a team raid starts its own night")
eq(teamNight.endReason, "team", "the team night ended for it")
eq(s.history[#s.history], teamNight, "and was saved")
eq(s.current.team, false, "the new night is stamped not a team raid")
eq(s.current.pulls[1].team, false, "and its pull too")
pull(9001, "Alpha")
eq(#s.current.pulls, 2, "the next pull of the same kind joins it")
eq(Tattle:HasOtherNights(), true, "now there is a night that wasn't a team raid")
local pugNight = s.current
teamAnswer = true
pull(9001, "Alpha")
check(s.current ~= pugNight and s.current.team == true, "back in a team raid: a new team night")
eq(#Tattle.InScope(s.history, "team") + 1, #s.history, "Team raids leaves the other night out")
eq(#Tattle.InScope(s.history, "all"), #s.history, "All raids keeps every night")
local bp = Tattle:BossPulls(9001)
local pugPulls = 0 for _, p in ipairs(bp) do if p.team == false then pugPulls = pugPulls + 1 end end
eq(pugPulls, 2, "BossPulls marks each pull's kind, for Season Stats")
-- a fight saved by hand from the Last fight view is stamped too
teamAnswer = false
local scanned = Tattle:AddScannedPull({ spells = { { id = 555 } }, players = {}, boss = { name = "Alpha", encounterID = 9001 } }, { 555 })
eq(scanned.team, false, "a fight saved from the Last fight view is stamped")
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
CRT.TattlePage.ShowNight(teamNight.id)
check(sh.shown, "shown while a night that wasn't a team raid is saved")
eq(sh.opts.get(), "team", "Team raids by default")
local o = sh.opts.options
eq(o[1].key .. "=" .. o[1].label .. ", " .. o[2].key .. "=" .. o[2].label, "team=Team raids, all=All raids", "its choices")
CRT.TattlePage.ShowNight(pugNight.id)
eq(select(5, CRT.TattlePage.State()), "all", "opening a night that wasn't a team raid shows All raids, so it is listed")
eq(select(2, CRT.TattlePage.State()), pugNight.id, "and selected")
-- with only team nights, the filter goes
for i = #s.history, 1, -1 do if not Tattle.IsTeam(s.history[i]) then table.remove(s.history, i) end end
if not Tattle.IsTeam(s.current) then s.current = nil end
Tattle:Fire()
check(not sh.shown, "only team raids saved: no Show dropdown")
local core = coreSrc
check(profilesSrc:find("onlyTeam = true, avoidable", 1, true) ~= nil, "Only record team raids is shared in Export settings only")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Modules/Tattlebot/Data.lua', 'CRT_Modules/Tattlebot/Page.lua', 'CRT_Core/Core.lua', 'CRT_Core/Profiles.lua'];
for (const f of files) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
