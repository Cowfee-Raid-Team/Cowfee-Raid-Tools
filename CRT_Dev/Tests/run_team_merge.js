// Look-alike teams and merging (CRT_Core/TeamList.lua's Team.MatchKey, Team:LookAlikes, Team:Merge, with every owner
// of data saved under a team's name: CRT_Modules/SeasonStats/Data.lua, Tattlebot/Data.lua, Late/Data.lua). Names
// match ignoring case, spaces and punctuation; a push of a look-alike lands on the saved team; a look-alike add is
// refused; Team, Pug and All look-alikes are the built-ins. Merging moves every Season Stats counter (each kind of
// field), restamps Tattlebot pulls and Late Tracker nights, moves the Team filter and tonight's team, and takes the
// team off the list; never by itself, never from a built-in team, never while a push locks either team.
// Usage: node run_team_merge.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local teamSrc, listSrc, lateSrc, tattleSrc, statsSrc, dialogsSrc, popupSrc, lookSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end
issecretvalue = function(v) return v == "SECRET" end
format = string.format
date = os.date
local NOW = os.time({ year = 2026, month = 10, day = 20, hour = 20, min = 0, sec = 0 })
time = function(t) if t then return os.time(t) end return NOW end
GetTime = function() return 1000 end
local timers = {}
C_Timer = { After = function(s, fn) timers[#timers + 1] = { s = s, fn = fn } end, NewTicker = function() return { Cancel = function() end } end }
-- runs the timers due so far (each once)
local function runTimers() local list = timers timers = {} for _, t in ipairs(list) do t.fn() end end
LE_PARTY_CATEGORY_INSTANCE = 2
local inRaid, lead, leaderName = false, false, "Gadios"
IsInRaid = function() return inRaid end
IsInGroup = function(cat) return inRaid and cat ~= LE_PARTY_CATEGORY_INSTANCE end
local combat = false
InCombatLockdown = function() return combat end
UnitName = function() return "Solex" end
GetNormalizedRealmName = function() return "Silvermoon" end
GetRaidRosterInfo = function(i)
  if not inRaid then return nil end
  if i == 1 then return "Solex", 0, 1, 90, "P", "P", "Z", 1 end
  if i == 2 then return leaderName, 2, 1, 90, "P", "P", "Z", 1 end
end
UnitIsGroupLeader = function(unit) return unit == "raid2" end
GetInstanceInfo = function() return "x", "none" end
-- stand-in frames: shown or not, text, points, scripts (OnHide runs on a shown frame's Hide), enabled
local METHODS = {
  SetText = function(self, v) rawset(self, "text", v) end,
  GetText = function(self) return rawget(self, "text") end,
  Show = function(self) rawset(self, "shown", true) end,
  Hide = function(self) local was = rawget(self, "shown") rawset(self, "shown", false) local h = rawget(self, "scripts").OnHide if was and h then h(self) end end,
  IsShown = function(self) return rawget(self, "shown") == true end,
  SetShown = function(self, v) rawset(self, "shown", v and true or false) end,
  SetScript = function(self, n, fn) rawget(self, "scripts")[n] = fn end,
  HookScript = function(self, n, fn) local sc = rawget(self, "scripts") local old = sc[n] sc[n] = function(...) if old then old(...) end fn(...) end end,
  SetEnabled = function(self, v) rawset(self, "enabled", v and true or false) end,
  IsEnabled = function(self) return rawget(self, "enabled") ~= false end,
  SetPoint = function(self, ...) table.insert(rawget(self, "pts"), { ... }) end,
  ClearAllPoints = function(self) rawset(self, "pts", {}) end,
  SetHeight = function(self, h) rawset(self, "h", h) end,
  GetStringWidth = function(self) return #(rawget(self, "text") or "") * 6 end,
  GetFontString = function(self) local fs = setmetatable({ scripts = {}, pts = {}, text = rawget(self, "text") }, getmetatable(self)) return fs end,
}
local MT = { __index = function(_, k) return METHODS[k] or function() end end }
local function mock() return setmetatable({ scripts = {}, pts = {}, shown = false }, MT) end
METHODS.CreateFontString = function() local f = mock() f.shown = true return f end
METHODS.CreateTexture = METHODS.CreateFontString
CreateFrame = function() return mock() end
CRTFontEdit = {}
local printed = {}
local UI = {
  Window = function(name, opts) local w = mock() w.name, w.opts = name, opts w.content = mock()
    w.strip = { title = opts.title, SetTitle = function(self, t) self.title = t end, SetHelp = function() return mock() end } return w end,
  Dropdown = function(_, label, opts) local row = mock() row.label, row.opts = label, opts row.refreshed = 0
    row.refresh = function() row.refreshed = row.refreshed + 1 end return row end,
  PanelButton = function(_, label, _, onClick) local b = mock() b.text, b.OnClick = label, onClick return b end,
  PanelButtonWidth = function(w) return w + 20 end,
  HelpRight = function() return mock() end,
  Toggle2 = function() local t = { buttons = {} } function t:Size() end function t:PlaceLeft() end function t:Select() end return t end,
  SkinEditBox = function() end,
  BadText = function(x) return x end,
}
CRTDBChar = {}

local function fresh(list, stats, tattle, late)
  return { db = {
    team = { list = list or {}, popup = {} },
    seasonStats = stats or { filled = true, scoped = true, bosses = {} },
    tattle = tattle or { history = {}, nextId = 1, custom = {} },
    late = late or { days = {}, history = {}, nextId = 1 },
  } }
end

local CRT
local function load_all(db, withUI)
  CRT = db
  function CRT:Print(msg) printed[#printed + 1] = msg end
  CRT.UI = UI
  CRT.Groups = { OnChange = function() end, Active = function() end }
  CRT.TattleDB = { bosses = {} }
  assert(load(teamSrc, "Team.lua"))("CowfeeRaidTools", CRT)
  assert(load(listSrc, "TeamList.lua"))("CowfeeRaidTools", CRT)
  assert(load(lateSrc, "Late/Data.lua"))("CowfeeRaidTools", CRT)
  assert(load(tattleSrc, "Tattlebot/Data.lua"))("CowfeeRaidTools", CRT)
  assert(load(statsSrc, "SeasonStats/Data.lua"))("CowfeeRaidTools", CRT)
  if withUI then
    assert(load(dialogsSrc, "TeamDialogs.lua"))("CowfeeRaidTools", CRT)
    assert(load(popupSrc, "TeamPopup.lua"))("CowfeeRaidTools", CRT)
    assert(load(lookSrc, "TeamLookAlike.lua"))("CowfeeRaidTools", CRT)
  end
  return CRT.Team, CRT.SeasonStats
end

-- 1. The match key ---------------------------------------------------------------------------------------------------
local Team = load_all(fresh())
local K = Team.MatchKey
eq(K("Chaos Born"), "chaosborn", "spaces dropped, lower case")
eq(K("ChaosBorn"), "chaosborn", "the pushed spelling: the same key")
eq(K("chaos-born"), "chaosborn", "punctuation dropped")
eq(K("  C.h_a'o s!Born "), "chaosborn", "every space and punctuation character")
eq(K("Team 2"), "team2", "digits stay")
eq(K("Caf\\195\\169 Crew"), "caf\\195\\169crew", "letters of other alphabets stay")
eq(K("SECRET"), nil, "a secret value is never read")
eq(K(nil), nil, "nil: no key")

-- 2. Find, add and push go through it --------------------------------------------------------------------------------
eq(Team:AddTeam("Chaos Born"), "Chaos Born", "Chaos Born added")
eq(Team:Find("ChaosBorn"), "Chaos Born", "Find: a look-alike reads as the saved spelling")
local n, why = Team:AddTeam("chaos-born")
check(n == nil and why == "There is already a team named Chaos Born.", "a look-alike add is refused with the saved spelling (" .. tostring(why) .. ")")
n, why = Team:AddTeam("T-e-a-m")
check(n == nil and tostring(why):find("named Team", 1, true), "T-e-a-m is the built-in Team (" .. tostring(why) .. ")")
n, why = Team:AddTeam("P u g")
check(n == nil and tostring(why):find("named Pug", 1, true), "P u g is the built-in Pug (" .. tostring(why) .. ")")
n, why = Team:AddTeam("A.l.l")
check(n == nil and tostring(why):find("can't be a team name", 1, true), "A.l.l is reserved like All (" .. tostring(why) .. ")")
eq(Team:Find("P u g"), "Pug", "Find reads P u g as Pug")
eq(Team:Find("!!!"), nil, "a name of only punctuation matches no team")
eq(Team:Ensure("ChaosBorn"), "Chaos Born", "a pushed look-alike lands on the saved team")
eq(#CRT.db.team.list, 1, "and adds nothing")
eq(Team:Ensure("T e a m"), "Team", "a pushed look-alike of Team is Team")
-- the leader's push through the message path: tonight is the saved spelling, locked by the leader
inRaid = true
Team.HandleEvent("GROUP_ROSTER_UPDATE")
check(Team:Hear("Gadios-Silvermoon", "T|1|ChaosBorn"), "the leader's push is taken")
eq(Team:Tonight(), "Chaos Born", "tonight is the saved spelling")
eq(CRTDBChar.team.tonight, "Chaos Born", "and saved so")
eq(Team:LockedBy(), "Gadios", "locked, set by the leader")
eq(#CRT.db.team.list, 1, "no second team")
inRaid = false
Team.HandleEvent("GROUP_ROSTER_UPDATE")
Team.HandleEvent("PLAYER_ENTERING_WORLD", false, false)
eq(Team:LockedBy(), nil, "unlocked out of the group")

-- 3. Alex's saved data: both spellings saved, stats under each --------------------------------------------------------
local function c(t)
  local base = { pulls = 0, wipes = 0, kills = 0, killTime = 0, pullTime = 0, untimed = 0, nights = {}, causes = {}, deaths = {},
    repairs = 0, repairPulls = 0, raidRepairs = 0, raidReporters = 0, raidPulls = 0 }
  for k, v in pairs(t) do base[k] = v end
  return base
end
local D1, D2, D3 = NOW - 9 * 86400, NOW - 2 * 86400, NOW - 86400
local stats = { filled = true, scoped = true, show = "ChaosBorn", bosses = {
  [3421] = { name = "Boss A",
    all = { mythic = c({ pulls = 99 }) },
    mythic = c({ pulls = 1 }),
    teams = {
      ["Chaos Born"] = { mythic = c({ pulls = 10, wipes = 9, kills = 1, killTime = 300, pullTime = 2000, untimed = 1,
        first = D1, last = D1 + 3000, bestKill = 300, firstKillPull = 10, firstKillAt = D1 + 3000,
        nights = { ["n1"] = { longest = 300, phase = 2, pulls = 10 }, ["n2"] = { longest = 100, pulls = 1 } },
        causes = { [111] = 4, [0] = 1 }, deaths = { 1, 2, 3 },
        repairs = 500, repairPulls = 5, raidRepairs = 9000, raidReporters = 10, raidPulls = 5 }) },
      ["ChaosBorn"] = { mythic = c({ pulls = 4, wipes = 3, kills = 1, killTime = 250, pullTime = 700, untimed = 0,
        first = D2, last = D3, bestKill = 250, firstKillPull = 2, firstKillAt = D2 + 600,
        nights = { ["n2"] = { longest = 250, phase = 3, pulls = 3 }, ["n3"] = { longest = 50, pulls = 1 } },
        causes = { [111] = 1, [222] = 2 }, deaths = { 7, 8 },
        repairs = 100, repairPulls = 2, raidRepairs = 1000, raidReporters = 3, raidPulls = 2, futureField = 42 }) },
      Pug = { mythic = c({ pulls = 5 }) },
    } },
  [3429] = { name = "Boss B",
    teams = { ["ChaosBorn"] = { nh = c({ pulls = 3, wipes = 3, first = D3, last = D3 + 900, nights = { n3 = { longest = 80, pulls = 3 } }, deaths = { 4 } }) } } },
} }
local tattle = { nextId = 3, custom = {},
  current = { id = 2, startedAt = D3, pulls = { { team = true, teamName = "ChaosBorn" }, { team = true, teamName = "chaosborn" } } },
  history = { { id = 1, startedAt = D1, pulls = { { team = true, teamName = "Chaos Born" }, { team = false, teamName = "Pug" }, { team = true } } } } }
local late = { days = {}, nextId = 3,
  current = { id = 2, startedAt = D3, team = true, teamName = "ChaosBorn", players = {} },
  history = { { id = 1, startedAt = D1, team = true, teamName = "Chaos Born", players = {} }, { id = 0, startedAt = D1 - 86400, team = true, players = {} } } }
CRTDBChar = { team = { tonight = "ChaosBorn", setBy = "Gadios", groupKey = "g1", picked = true } }
local Team, S = load_all(fresh({ "Chaos Born", "ChaosBorn" }, stats, tattle, late))

-- look-alikes, and the two spellings kept apart until merged
local groups = Team:LookAlikes()
eq(#groups, 1, "one group of look-alikes")
eq(groups[1] and table.concat(groups[1], "|"), "Chaos Born|ChaosBorn", "first listed first")
eq(Team:Find("ChaosBorn"), "ChaosBorn", "both saved: the exact spelling is its own team until merged")
eq(Team:Tonight(), "ChaosBorn", "tonight reads as saved")
eq(S:Boss(3421, "mythic", "ChaosBorn").pulls, 4, "and its counters are still reachable")
eq(CRT.db.seasonStats.show, "ChaosBorn", "nothing ran by itself at load")

-- refused merges
eq(Team:Merge("Team", "Chaos Born"), nil, "never from Team")
eq(Team:Merge("Pug", "Chaos Born"), nil, "never from Pug")
eq(Team:Merge("Chaos Born", "Chaos Born"), nil, "never into itself")
eq(Team:Merge("Nobody", "Chaos Born"), nil, "never from a team not saved")
eq(Team:Merge("ChaosBorn", "Nobody"), nil, "never into a team not saved")
-- locked by a push: either team refused while it is tonight's
inRaid = true
Team.HandleEvent("GROUP_ROSTER_UPDATE")
CRTDBChar.team.setByKey = "gadios-silvermoon"
check(Team:IsLocked(), "a leader's push locks tonight's team")
eq(Team:Merge("ChaosBorn", "Chaos Born"), nil, "refused while the push locks from")
eq(Team:CanMerge("Chaos Born", "ChaosBorn"), nil, "or into")
inRaid = false
Team.HandleEvent("GROUP_ROSTER_UPDATE")
Team.HandleEvent("PLAYER_ENTERING_WORLD", false, false)
check(not Team:IsLocked(), "out of the group: unlocked")
CRTDBChar.team.setBy = "Gadios" -- kept as it was saved
eq(CRT.db.seasonStats.bosses[3421].teams.ChaosBorn.mythic.pulls, 4, "a refused merge changes nothing")

-- the merge
local sum = Team:Merge("ChaosBorn", "Chaos Born")
check(type(sum) == "table", "merged")
eq(sum and sum.pulls, 7, "the summary: Season Stats pulls moved (4 + 3)")
eq(sum and sum.tattlePulls, 2, "Tattlebot pulls restamped")
eq(sum and sum.nights, 1, "Late Tracker nights restamped")
eq(sum and sum.from .. ">" .. sum.into, "ChaosBorn>Chaos Born", "from and into as saved")
eq(table.concat(CRT.db.team.list, "|"), "Chaos Born", "the loser left the list")
local m = S:Boss(3421, "mythic", "Chaos Born")
eq(m.pulls .. "/" .. m.wipes .. "/" .. m.kills, "14/12/2", "pulls, wipes and kills summed")
eq(m.killTime .. "/" .. m.pullTime .. "/" .. m.untimed, "550/2700/1", "killTime, pullTime, untimed summed")
eq(m.first, D1, "first: the earlier")
eq(m.last, D3, "last: the later")
eq(m.bestKill, 250, "best kill: the faster")
eq(m.firstKillPull .. "@" .. m.firstKillAt, "10@" .. (D1 + 3000), "first kill: the earlier one, with its pull number")
eq(m.nights.n1.pulls .. "/" .. m.nights.n1.longest .. "/" .. m.nights.n1.phase, "10/300/2", "a night only one team had stays")
eq(m.nights.n2.pulls .. "/" .. m.nights.n2.longest .. "/" .. m.nights.n2.phase, "4/250/3", "a shared night: pulls summed, longest and phase the higher")
eq(m.nights.n3.pulls, 1, "a night only the loser had is added")
eq(m.causes[111] .. "/" .. m.causes[222] .. "/" .. m.causes[0], "5/2/1", "causes summed by spell")
eq(table.concat(m.deaths, ","), "1,2,3,7,8", "the deaths trend: both teams' pulls in time order")
eq(m.repairs .. "/" .. m.repairPulls .. "/" .. m.raidRepairs .. "/" .. m.raidReporters .. "/" .. m.raidPulls, "600/7/10000/13/7", "repairs summed")
eq(m.futureField, 42, "a field the merge doesn't know is kept")
eq(CRT.db.seasonStats.bosses[3421].teams.ChaosBorn, nil, "the loser's counters are gone")
eq(S:Boss(3421, "mythic", "Pug").pulls, 5, "Pug untouched")
eq(S:Boss(3421, "mythic", "all").pulls, 99, "All untouched (it counted both already)")
eq(S:Boss(3421, "mythic", "team").pulls, 1, "Team untouched")
local b = S:Boss(3429, "nh", "Chaos Born")
eq(b and b.pulls, 3, "a boss only the loser pulled: its counters move")
eq(CRT.db.seasonStats.bosses[3429].teams.ChaosBorn, nil, "and leave the loser")
eq(CRT.db.seasonStats.show, "Chaos Born", "the Team filter moves to the winner")
eq(tattle.current.pulls[1].teamName .. "|" .. tattle.current.pulls[2].teamName, "Chaos Born|Chaos Born", "Tattlebot pulls restamped, any case")
eq(tattle.history[1].pulls[2].teamName, "Pug", "a Pug pull stays Pug")
eq(tattle.history[1].pulls[3].teamName, nil, "an unnamed pull stays unnamed")
eq(late.current.teamName, "Chaos Born", "the running Late night restamped")
eq(late.history[2].teamName, nil, "an unnamed night stays unnamed")
eq(CRTDBChar.team.tonight, "Chaos Born", "tonight's team moves to the winner")
eq(CRTDBChar.team.setBy, "Gadios", "setBy stays")
eq(#Team:LookAlikes(), 0, "no look-alikes left")
eq(Team:Merge("ChaosBorn", "Chaos Born"), nil, "a second merge has nothing to move")
eq(Team.Resolve("ChaosBorn"), "Chaos Born", "another character's saved spelling reads as the winner")
eq(S.ScopeOf("ChaosBorn"), "Chaos Born", "and Season Stats files it there")

-- 4. Any two teams, into Pug and into Team -----------------------------------------------------------------------------
do
  local st = { filled = true, scoped = true, show = "Old Crew", bosses = {
    [1] = { mythic = c({ pulls = 2, wipes = 2, deaths = { 1 } }), teams = { ["Old Crew"] = { mythic = c({ pulls = 3, wipes = 3 }) }, ["Alts"] = { nh = c({ pulls = 6 }) } } } } }
  local ta = { nextId = 2, custom = {}, history = { { id = 1, pulls = { { team = true, teamName = "Alts" }, { team = true, teamName = "Old Crew" } } } } }
  local la = { days = {}, nextId = 2, history = { { id = 1, team = true, teamName = "Alts", players = {} } } }
  CRTDBChar = { team = { tonight = "Alts", pushed = "Alts" } }
  local T2, S2 = load_all(fresh({ "Old Crew", "Alts" }, st, ta, la))
  local r = T2:Merge("Old Crew", "Team")
  eq(r and r.pulls, 3, "into the built-in Team")
  eq(S2:Boss(1, "mythic", "team").pulls, 5, "Team's counters (the field from before) get them")
  eq(st.show, "team", "the filter moves to Team")
  eq(ta.history[1].pulls[2].teamName, "Team", "its Tattlebot pull now reads Team")
  r = T2:Merge("Alts", "Pug")
  eq(r and r.pulls, 6, "into Pug")
  eq(S2:Boss(1, "nh", "Pug").pulls, 6, "Pug's counters get them")
  eq(ta.history[1].pulls[1].teamName .. "/" .. tostring(ta.history[1].pulls[1].team), "Pug/false", "a pull merged into Pug is a Pug pull")
  eq(la.history[1].teamName .. "/" .. tostring(la.history[1].team), "Pug/false", "and a night")
  eq(CRTDBChar.team.tonight .. "/" .. CRTDBChar.team.pushed, "Pug/Pug", "tonight and the push follow")
  eq(#CRT.db.team.list, 0, "both left the list")
end

-- 5. Old data with no teams is untouched ------------------------------------------------------------------------------
do
  local st = { filled = true, scoped = true, bosses = { [1] = { mythic = c({ pulls = 2 }) } } }
  CRTDBChar = {}
  local T3 = load_all(fresh({}, st))
  eq(#T3:LookAlikes(), 0, "no teams: no look-alikes")
  eq(st.bosses[1].mythic.pulls, 2, "and nothing changed")
  eq(st.show, nil, "no filter written")
  eq(CRT.db.team.merged, nil, "no flag written")
end

-- Alex's shape again, for the windows: two spellings, stats under the loser
local function alexShape(extra)
  local st = { filled = true, scoped = true, bosses = {
    [3421] = { teams = { ["Chaos Born"] = { mythic = c({ pulls = 10 }) }, ["ChaosBorn"] = { mythic = c({ pulls = 4 }) } } },
    [3429] = { teams = { ["ChaosBorn"] = { nh = c({ pulls = 3 }) } } } } }
  local db = fresh({ "Chaos Born", "ChaosBorn" }, st)
  for k, v in pairs(extra or {}) do db.db.team[k] = v end
  return db
end

-- 6. The Merge teams dialog ----------------------------------------------------------------------------------------------
do
  CRTDBChar = {}
  printed = {}
  local T6, S6 = load_all(alexShape(), true)
  local D = CRT.TeamDialogs
  local fired = 0
  S6:OnChange(function() fired = fired + 1 end)
  local done
  D.AskMerge("ChaosBorn", "Chaos Born", function(sum) done = sum end)
  check(D.win:IsShown(), "Merge teams opens")
  eq(D.mode, "merge", "in merge mode")
  eq(D.win.strip.title, "Merge teams", "titled Merge teams")
  check(D.fromDrop:IsShown() and D.intoDrop:IsShown() and not D.edit:IsShown(), "two dropdowns, no name box")
  eq(D.fromDrop.label .. "/" .. D.intoDrop.label, "Merge/into", "Merge [..] into [..]")
  eq(D.fromDrop.opts.labelWidth, D.intoDrop.opts.labelWidth, "the rows line up")
  local function keys(opts) local out = {} for _, o in ipairs(opts) do out[#out + 1] = o.key end return table.concat(out, ",") end
  eq(keys(D.fromDrop.opts.options()), "Chaos Born,ChaosBorn", "Merge lists your saved teams, not Team or Pug")
  eq(keys(D.intoDrop.opts.options()), "Team,Pug,Chaos Born", "into lists Team, Pug and your teams but the one above")
  eq(D.message:GetText(), "ChaosBorn's 7 pulls, Tattlebot pulls and raid nights move into Chaos Born, and ChaosBorn leaves your list. This can't be undone.", "the summary")
  eq(D.ok.text, "Merge", "[Merge]")
  eq(D.cancel.text, "Cancel", "[Cancel]")
  check(D.ok:IsEnabled(), "Merge enabled for a pair it can merge")
  -- picking the other team above: into can't stay on it, the summary follows
  D.fromDrop.opts.set("Chaos Born")
  eq(D.intoDrop.opts.get(), "Team", "into can't be the team being merged: back to Team")
  eq(keys(D.intoDrop.opts.options()), "Team,Pug,ChaosBorn", "and its list leaves it out")
  eq(D.message:GetText(), "Chaos Born's 10 pulls, Tattlebot pulls and raid nights move into Team, and Chaos Born leaves your list. This can't be undone.", "the summary is rebuilt on every pick")
  D.intoDrop.opts.set("Pug")
  check(D.message:GetText():find("move into Pug", 1, true) ~= nil, "and on into's pick")
  D.fromDrop.opts.set("ChaosBorn") D.intoDrop.opts.set("Chaos Born")
  -- Cancel merges nothing
  D.cancel.OnClick()
  check(not D.win:IsShown() and #CRT.db.team.list == 2, "Cancel closes and merges nothing")
  D.AskMerge("ChaosBorn", "Chaos Born", function(sum) done = sum end)
  D.ok.OnClick()
  check(not D.win:IsShown(), "Merge closes the dialog")
  eq(table.concat(CRT.db.team.list, "|"), "Chaos Born", "Team:Merge ran")
  eq(done and done.pulls, 7, "done gets the summary (the settings page refreshes)")
  check(fired > 0, "Season Stats is told, so its page refreshes")
  eq(printed[#printed], "Merged ChaosBorn into Chaos Born (7 pulls).", "one chat line")
  -- with no saved team nothing opens
  CRT.db.team.list = {}
  D.AskMerge(nil, nil)
  check(not D.win:IsShown(), "no saved team: nothing to merge")
end

-- 7. The look-alike prompt ---------------------------------------------------------------------------------------------
do
  local function login(db)
    timers = {}
    local T7 = load_all(db, true)
    CRT.TeamLookAlike.HandleEvent("PLAYER_ENTERING_WORLD")
    runTimers()
    return T7, CRT.TeamLookAlike
  end
  CRTDBChar = {}
  printed = {}
  local db = alexShape()
  local T7, P = login(db)
  check(P.IsShown(), "after login: the prompt for Alex's look-alikes")
  eq(P.win.strip.title, "Same team?", "titled Same team?")
  eq(P.message:GetText(), "ChaosBorn looks like Chaos Born. Merge ChaosBorn (7 pulls) into Chaos Born?", "names the pair, first listed kept")
  eq(P.merge.text .. "/" .. P.keep.text, "Merge/Keep apart", "[Merge] [Keep apart]")
  -- X: asked again at the next login, not before
  P.win:Hide()
  P.Try()
  check(not P.IsShown(), "closed with X: not asked again this session")
  T7, P = login(db)
  check(P.IsShown(), "X: asked again at the next login")
  -- Keep apart: remembered across a reload
  P.keep.OnClick()
  check(not P.IsShown(), "Keep apart closes it")
  eq(db.db.team.keepApart and db.db.team.keepApart["chaos born|chaosborn"], true, "and saves the pair")
  eq(#db.db.team.list, 2, "merging nothing")
  T7, P = login(db)
  check(not P.IsShown(), "a kept-apart pair is never asked about again")
  -- Merge
  CRTDBChar = {}
  db = alexShape()
  T7, P = login(db)
  P.merge.OnClick()
  check(not P.IsShown(), "Merge closes it")
  eq(table.concat(db.db.team.list, "|"), "Chaos Born", "and merges")
  eq(printed[#printed], "Merged ChaosBorn into Chaos Born (7 pulls).", "with one chat line")
  T7, P = login(db)
  check(not P.IsShown(), "nothing left to ask")
  -- in combat it waits for combat's end
  db = alexShape()
  combat = true
  T7, P = login(db)
  check(not P.IsShown(), "in combat: no prompt")
  combat = false
  P.HandleEvent("PLAYER_REGEN_ENABLED")
  check(P.IsShown(), "shown when combat ends")
  P.win:Hide()
  -- never while a push locks either team
  db = alexShape()
  CRTDBChar = { team = { tonight = "ChaosBorn", groupKey = "g1", picked = true, setBy = "Gadios", setByKey = "gadios-silvermoon" } }
  inRaid = true
  timers = {}
  T7 = load_all(db, true)
  P = CRT.TeamLookAlike
  T7.HandleEvent("GROUP_ROSTER_UPDATE")
  check(T7:IsLocked(), "a push locks tonight's team")
  P.HandleEvent("PLAYER_ENTERING_WORLD") runTimers()
  check(not P.IsShown(), "locked: no prompt")
  inRaid = false
  CRTDBChar = {}
  -- not in the middle of the new raid group popup: it waits until that closes
  db = alexShape()
  timers = {}
  T7 = load_all(db, true)
  P = CRT.TeamLookAlike
  CRT.TeamPopup.Show(false)
  P.HandleEvent("PLAYER_ENTERING_WORLD") runTimers()
  check(not P.IsShown(), "behind the new raid group popup: waits")
  CRT.TeamPopup.Hide()
  runTimers()
  check(P.IsShown(), "and asks once it closes")
  P.win:Hide()
  -- no look-alikes: nothing
  T7, P = login(fresh({ "Chaos Born", "Night Crew" }))
  check(not P.IsShown(), "no look-alikes: no prompt")
  check(lookSrc:find("UI.Window(", 1, true) ~= nil, "the prompt is a UI.Window (the popups layer)")
end

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Core/Team.lua', 'CRT_Core/TeamList.lua', 'CRT_Modules/Late/Data.lua', 'CRT_Modules/Tattlebot/Data.lua', 'CRT_Modules/SeasonStats/Data.lua',
  'CRT_Core/UI/TeamDialogs.lua', 'CRT_Core/UI/TeamPopup.lua', 'CRT_Core/UI/TeamLookAlike.lua'];
for (const f of files) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
