local ADDON, CRT = ...

-- Season Stats: the raid's own permanent counters per boss and difficulty group, for the Season Stats page
-- (SeasonStats/Page.lua). The Timeline keeps only the newest pulls of each boss; these keep the whole season.
-- Saved in CRTDB.seasonStats (defaults in CRT_Core/Core.lua; data, so never in Export settings only):
--   filled               true once the counters were filled from the Timeline's saved pulls (Backfill, once)
--   scoped               true once the counters from before team raids were copied into all (Migrate, once)
--   show                 the page's Team filter: "all" (All), "team" (Before teams: the built-in Team's counts, from
--                        before your own teams) or a team's name (Pug or one of yours, CRT_Core/TeamList.lua); none
--                        saved reads as Before teams while it has pulls, else tonight's team
--   bosses[encounterID]  { name, nh = counters, mythic = counters, all = { nh = counters, mythic = counters },
--                        teams = { [team name] = { nh = counters, mythic = counters } } }, the groups of
--                        Timeline.DifficultyGroup. A scope per team: boss[group] (the field from before scopes, kept)
--                        counts the built-in Team, boss.teams[name][group] Pug and each of your teams, and
--                        boss.all[group] every raid. A pull counts in all and in the team it started with (CRT.Team's
--                        snapshot at the pull's start, CRT_Core/Team.lua). Counters saved before scopes count as
--                        Team and all: Migrate copies them into all once. Pulls saved as not a team raid, before
--                        teams had names, are only in all. Removing a team (Team:RemoveTeam) deletes its teams entry;
--                        merging one into another (Team:Merge) adds its counters into the other's (MergeTeam).
--   counters             { pulls, wipes, kills, firstKillPull, firstKillAt, bestKill, killTime, pullTime, untimed,
--                          first, last, nights = { [night] = { longest, phase, pulls } }, causes = { [spellID] = deaths },
--                          deaths = { deaths per pull, newest last, the last TREND },
--                          repairs, repairPulls, raidRepairs, raidReporters, raidPulls }
-- repairs is your own repair bill over the pulls measured (repairPulls), raidRepairs the raid's from every raider
-- running CRT (raidReporters reports over raidPulls pulls), all copper, read and heard by SeasonStats/Repairs.lua.
-- Counted from the update that added them on, so counters saved before have none (read as 0).
-- Times are seconds, first, last and firstKillAt time() values; a night is NightKey of a pull's start. untimed counts
-- pulls with no saved length (the early ones the fill only knows by the Timeline's counter). causes[0] is deaths
-- whose spell wasn't known.
-- Counted from the Timeline's one save path (Timeline:OnSaved), never from the encounter events a second time, so
-- a pull the Timeline doesn't keep (Record off, outside a raid, shorter than its minimum) isn't counted either.
-- An encounter ID belongs to one season, so the counters are kept per boss, and the season is read from the boss
-- library's route (CRT.Bosses) when shown: a pull on a boss whose season pack ships later still counts.
-- The furthest phase is the alerts engine's (Alerts/Engine.lua): the highest phase it started in the pull's run.
-- Raid nights are the Late Tracker's (Late:History), the avoidable damage trend Tattlebot's (Tattle:BossPulls).

local Stats = { listeners = {} }
CRT.SeasonStats = Stats

Stats.NIGHT_SHIFT = 6 * 3600 -- a pull before 06:00 belongs to the night before
Stats.NIGHT_LEAD = 12 * 3600 -- a Late Tracker night may start this long before the season's first pull
Stats.TREND = 20 -- deaths per pull kept per boss and group
Stats.HALF = 10 -- the trend compares the last HALF pulls with the HALF before
Stats.TOP_CAUSES = 3
Stats.RUN_MATCH = 10 -- seconds between an alerts run's start and a pull's start for the run to be the pull's
Stats.GROUPS = { "nh", "mythic" }
Stats.TEAM, Stats.ALL = "team", "all"
Stats.SCOPES = { Stats.TEAM, Stats.ALL }
Stats.TEAM_NAME, Stats.PUG = "Team", "Pug" -- the built-in teams' names (CRT.Team.TEAM, PUG)
Stats.ALL_LABEL = "All"

local function sdb()
    return CRT.db.seasonStats
end

-- A team's name as it reads now: the built-in or listed team it names, else Team (a team removed since, or a stamp
-- from before names). Through Team.Resolve when the team list is loaded.
local function teamName(name)
    local Team = CRT.Team
    if Team and Team.Resolve then
        return Team.Resolve(name)
    end
    return type(name) == "string" and name or Stats.TEAM_NAME
end

-- The scope a team's pulls count in: "team" for the built-in Team (the field from before), else the name.
function Stats.ScopeOf(name)
    name = teamName(name)
    return name == Stats.TEAM_NAME and Stats.TEAM or name
end

local scopeHas -- below, with the counters

-- The page's Team filter: "all", "team" (Before teams) or a team's name; a team removed since reads as "team".
-- None saved (or Before teams with no pulls left) reads as Before teams while it has pulls, else tonight's team.
function Stats:Scope()
    local show = sdb().show
    if show == Stats.ALL then
        return Stats.ALL
    end
    if show ~= nil and show ~= Stats.TEAM then
        return Stats.ScopeOf(show)
    end
    local Team = CRT.Team
    if scopeHas(Stats.TEAM) or not (Team and Team.Tonight) then
        return Stats.TEAM
    end
    local ok, tonight = pcall(Team.Tonight, Team)
    return ok and type(tonight) == "string" and Stats.ScopeOf(tonight) or Stats.TEAM
end

function Stats:SetScope(scope)
    if scope == Stats.ALL or scope == Stats.TEAM then
        sdb().show = scope
    else
        sdb().show = Stats.ScopeOf(scope)
    end
    self:Fire()
end

-- The Team filter's entries, { key, label }: All, Before teams only while it has pulls, then each team that has
-- pulls, in the team list's order (Pug, then yours), and the one picked even with none.
function Stats.ScopeOptions()
    local out = { { key = Stats.ALL, label = Stats.ALL_LABEL } }
    local Team = CRT.Team
    if scopeHas(Stats.TEAM) then
        -- Before teams: the built-in Team's counts, from before your own teams (its name is TeamList.lua's)
        local before = Team and Team.LIST_TEXT and Team.LIST_TEXT.before or Stats.TEAM_NAME
        out[2] = { key = Stats.TEAM, label = before }
    end
    local names = Team and Team.Names and Team:Names() or { Stats.PUG }
    local picked = Stats:Scope()
    for _, name in ipairs(names) do
        local scope = Stats.ScopeOf(name)
        if scope ~= Stats.TEAM and (scope == picked or scopeHas(scope)) then
            out[#out + 1] = { key = scope, label = name }
        end
    end
    return out
end

-- The scopes a pull counts in: the team it started with (CRT.Team's snapshot at its start, else the team now) and
-- all. A pull outside a raid group (Raid Finder, a party, solo) has no team: all only. With no team check loaded,
-- Team and all, as every pull counted before.
local function pullScopes(pull)
    local Team = CRT.Team
    if not (Team and Team.PullTeam) then
        return Stats.SCOPES
    end
    local ok, name = pcall(Team.PullTeam, Team, pull.encounterID, pull.startedAt)
    if not ok or type(name) ~= "string" then
        return { Stats.ALL }
    end
    return { Stats.ScopeOf(name), Stats.ALL }
end

function Stats:OnChange(fn)
    self.listeners[#self.listeners + 1] = fn
end

function Stats:Fire()
    for _, fn in ipairs(self.listeners) do
        -- a listener (the page) failing must never stop the counting
        local ok, err = pcall(fn)
        if not ok and geterrorhandler then
            geterrorhandler()(err)
        end
    end
end

-- The night a start time belongs to, "2026-10-21": a pull after midnight counts on the night before.
function Stats.NightKey(at)
    return date("%Y-%m-%d", at - Stats.NIGHT_SHIFT)
end

local function groupOf(difficultyID)
    local T = CRT.Timeline
    if T and T.DifficultyGroup then
        return T.DifficultyGroup(difficultyID)
    end
    return difficultyID == 16 and "mythic" or "nh"
end
Stats.GroupOf = groupOf

-- A boss's counters for a group in a scope (team, the default; all; or a team's name); make creates them (and
-- the boss) when missing.
local function counters(encounterID, group, name, make, scope)
    local bosses = sdb().bosses
    local boss = bosses[encounterID]
    if not boss then
        if not make then
            return nil
        end
        boss = {}
        bosses[encounterID] = boss
    end
    if make and type(name) == "string" and name ~= "" then
        boss.name = name
    end
    local holder = boss
    if scope == Stats.ALL then
        holder = boss.all
        if type(holder) ~= "table" then
            if not make then
                return nil
            end
            holder = {}
            boss.all = holder
        end
    elseif scope ~= nil and scope ~= Stats.TEAM then
        if type(boss.teams) ~= "table" then
            if not make then
                return nil
            end
            boss.teams = {}
        end
        holder = boss.teams[scope]
        if type(holder) ~= "table" then
            if not make then
                return nil
            end
            holder = {}
            boss.teams[scope] = holder
        end
    end
    local c = holder[group]
    if not c and make then
        c = { pulls = 0, wipes = 0, kills = 0, killTime = 0, pullTime = 0, untimed = 0, nights = {}, causes = {}, deaths = {},
            repairs = 0, repairPulls = 0, raidRepairs = 0, raidReporters = 0, raidPulls = 0 }
        holder[group] = c
    end
    return c
end

-- Whether any boss has pulls in a scope.
scopeHas = function(scope)
    for encounterID in pairs(sdb().bosses) do
        for _, group in ipairs(Stats.GROUPS) do
            local c = counters(encounterID, group, nil, false, scope)
            if c and (c.pulls or 0) > 0 then
                return true
            end
        end
    end
    return false
end

-- The table a scope's counters are kept in for a boss: boss itself for "team" (boss[group], the field from before
-- scopes), boss.all for all, boss.teams[name] for a team. Nil when it has none.
local function holderOf(boss, scope)
    if type(boss) ~= "table" then
        return nil
    elseif scope == Stats.TEAM then
        return boss
    elseif scope == Stats.ALL then
        return type(boss.all) == "table" and boss.all or nil
    end
    return type(boss.teams) == "table" and type(boss.teams[scope]) == "table" and boss.teams[scope] or nil
end

-- Removing or merging a team (CRT_Core/TeamList.lua): how many pulls it has (Team: Before teams' counts), and
-- deleting them. Team (boss[group]) and all are never deleted this way.
function Stats:TeamPulls(name)
    local n = 0
    local scope = type(name) == "string" and (name == Stats.TEAM_NAME and Stats.TEAM or name)
    if not scope or scope == Stats.ALL then
        return 0
    end
    for _, boss in pairs(sdb().bosses) do
        local holder = holderOf(boss, scope)
        for _, group in ipairs(Stats.GROUPS) do
            local c = type(holder) == "table" and holder[group]
            n = n + (type(c) == "table" and tonumber(c.pulls) or 0)
        end
    end
    return n
end

function Stats:DeleteTeam(name)
    if type(name) ~= "string" or name == Stats.TEAM or name == Stats.ALL then
        return
    end
    for _, boss in pairs(sdb().bosses) do
        if type(boss) == "table" and type(boss.teams) == "table" then
            boss.teams[name] = nil
            if next(boss.teams) == nil then
                boss.teams = nil
            end
        end
    end
    if sdb().show == name then
        sdb().show = Stats.TEAM
    end
    self:Fire()
end

-- Merging a team into another (Team:Merge, CRT_Core/TeamList.lua) --------------------------------------------------

local SUMS = { "pulls", "wipes", "kills", "killTime", "pullTime", "untimed", "repairs", "repairPulls", "raidRepairs",
    "raidReporters", "raidPulls" }

local function num(v)
    return type(v) == "number" and v or nil
end

-- The smaller (or larger) of two values either of which may be missing.
local function least(a, b)
    a, b = num(a), num(b)
    if a and b then
        return math.min(a, b)
    end
    return a or b
end

local function most(a, b)
    a, b = num(a), num(b)
    if a and b then
        return math.max(a, b)
    end
    return a or b
end

-- One group's counters of from added into into's (both made by counters()): sums summed; first the earlier, last
-- the later, bestKill the faster; the first kill the earlier one (by firstKillAt, else the lower pull number) with
-- its pull number; each night's pulls summed, its longest and phase the higher; causes summed by spell; the deaths
-- trend, one entry per pull, as both teams' pulls in time order (the team whose last pull came first, first), the
-- newest TREND kept. A field this doesn't know (one added later) is taken from from when into has none.
local function mergeCounters(into, from)
    for _, k in ipairs(SUMS) do
        if num(from[k]) or num(into[k]) then
            into[k] = (num(into[k]) or 0) + (num(from[k]) or 0)
        end
    end
    into.first = least(into.first, from.first)
    into.bestKill = least(into.bestKill, from.bestKill)
    local intoLast, fromLast = num(into.last), num(from.last)
    into.last = most(intoLast, fromLast)
    -- pulls to first kill is each team's own count: when both pulled the boss before the earlier kill, the merged
    -- number is only that team's pulls, not both teams' together (which pulls came first isn't kept)
    if num(from.firstKillPull) then
        local takeFrom = not num(into.firstKillPull)
        if not takeFrom then
            local a, b = num(into.firstKillAt), num(from.firstKillAt)
            if a and b then
                takeFrom = b < a
            elseif b then
                takeFrom = true
            elseif not a then
                takeFrom = from.firstKillPull < into.firstKillPull
            end
        end
        if takeFrom then
            into.firstKillPull, into.firstKillAt = from.firstKillPull, from.firstKillAt
        end
    end
    into.nights = type(into.nights) == "table" and into.nights or {}
    for key, n in pairs(type(from.nights) == "table" and from.nights or {}) do
        local m = into.nights[key]
        if type(m) ~= "table" then
            into.nights[key] = n
        elseif type(n) == "table" then
            m.pulls = (num(m.pulls) or 0) + (num(n.pulls) or 0)
            m.longest = most(m.longest, n.longest) or 0
            m.phase = most(m.phase, n.phase)
        end
    end
    into.causes = type(into.causes) == "table" and into.causes or {}
    for id, n in pairs(type(from.causes) == "table" and from.causes or {}) do
        into.causes[id] = (num(into.causes[id]) or 0) + (num(n) or 0)
    end
    local mine = type(into.deaths) == "table" and into.deaths or {}
    local theirs = type(from.deaths) == "table" and from.deaths or {}
    local fromFirst = fromLast ~= nil and (intoLast == nil or fromLast <= intoLast)
    local trend = {}
    for _, list in ipairs(fromFirst and { theirs, mine } or { mine, theirs }) do
        for _, d in ipairs(list) do
            trend[#trend + 1] = d
        end
    end
    while #trend > Stats.TREND do
        table.remove(trend, 1)
    end
    into.deaths = trend
    for k, v in pairs(from) do
        if into[k] == nil then
            into[k] = v
        end
    end
end

-- Moves every counter saved under from (a saved team's name, or Team: Before teams' counts in boss[group]) into
-- into's scope (Pug or a saved team), then deletes from's; the Team filter on from goes to into. All is left as it
-- is (it counted both already). Returns how many pulls moved.
function Stats:MergeTeam(from, into)
    if type(from) ~= "string" or type(into) ~= "string" then
        return 0
    end
    local fromScope = from == Stats.TEAM_NAME and Stats.TEAM or from
    local scope = Stats.ScopeOf(into)
    if scope == fromScope or fromScope == Stats.ALL or scope == Stats.ALL then
        return 0
    end
    local moved = 0
    for encounterID, boss in pairs(sdb().bosses) do
        local holder = holderOf(boss, fromScope)
        if holder then
            for _, group in ipairs(Stats.GROUPS) do
                local c = holder[group]
                if type(c) == "table" then
                    moved = moved + (num(c.pulls) or 0)
                    local target = counters(encounterID, group, nil, true, scope)
                    mergeCounters(target, c)
                    holder[group] = nil
                end
            end
            if fromScope ~= Stats.TEAM then
                boss.teams[fromScope] = nil
                if next(boss.teams) == nil then
                    boss.teams = nil
                end
            end
        end
    end
    if sdb().show == fromScope then
        sdb().show = scope
    end
    self:Fire()
    return moved
end

local function deepCopy(v)
    if type(v) ~= "table" then
        return v
    end
    local out = {}
    for k, x in pairs(v) do
        out[k] = deepCopy(x)
    end
    return out
end

-- Once: the counters saved before scopes were team raids and all raids alike, so each is copied into all (the
-- team ones stay where they were). Marked done; returns true when it ran.
function Stats:Migrate()
    local s = sdb()
    if s.scoped then
        return false
    end
    for _, boss in pairs(s.bosses) do
        if type(boss) == "table" then
            for _, group in ipairs(Stats.GROUPS) do
                if type(boss[group]) == "table" then
                    if type(boss.all) ~= "table" then
                        boss.all = {}
                    end
                    if boss.all[group] == nil then
                        boss.all[group] = deepCopy(boss[group])
                    end
                end
            end
        end
    end
    s.scoped = true
    return true
end

local function addNight(c, at, length, phase)
    c.first = math.min(c.first or at, at)
    c.last = math.max(c.last or at, at)
    local key = Stats.NightKey(at)
    local night = c.nights[key]
    if not night then
        night = { longest = 0, pulls = 0 }
        c.nights[key] = night
    end
    night.pulls = night.pulls + 1
    if length and length > night.longest then
        night.longest = length
    end
    if type(phase) == "number" and (not night.phase or phase > night.phase) then
        night.phase = phase
    end
end

local function addKill(c, number, length, at)
    c.kills = c.kills + 1
    if length then
        c.killTime = c.killTime + length
        if not c.bestKill or length < c.bestKill then
            c.bestKill = length
        end
    end
    if not c.firstKillPull or number < c.firstKillPull then
        c.firstKillPull = number
        c.firstKillAt = at
    end
end

-- Counts one saved pull ({ encounterID, name, difficultyID, startedAt, length, kill, number, deaths }, as the
-- Timeline saves it). phase is the furthest phase it reached, when known. useNumber takes the pull's own number
-- for pulls to first kill (the fill only): the Timeline's counter starts again when its pulls of a boss are
-- deleted, so a live pull is numbered by these counters' own count.
local function addTo(c, pull, phase, useNumber)
    c.pulls = c.pulls + 1
    local number = useNumber and type(pull.number) == "number" and pull.number or c.pulls
    local length = type(pull.length) == "number" and pull.length or nil
    local at = type(pull.startedAt) == "number" and pull.startedAt or nil
    if length then
        c.pullTime = c.pullTime + length
    else
        c.untimed = c.untimed + 1
    end
    if pull.kill == true then
        addKill(c, number, length, at)
    else
        c.wipes = c.wipes + 1
    end
    if at then
        addNight(c, at, length, phase)
    end
    local deaths = type(pull.deaths) == "table" and pull.deaths or {}
    for _, d in ipairs(deaths) do
        local id = type(d) == "table" and type(d.spellID) == "number" and d.spellID or 0
        c.causes[id] = (c.causes[id] or 0) + 1
    end
    c.deaths[#c.deaths + 1] = #deaths
    while #c.deaths > Stats.TREND do
        table.remove(c.deaths, 1)
    end
end

-- Counts a pull in each of its scopes (pullScopes, or the list given). Returns the counters it went into, a list,
-- or nil for a pull that can't be counted.
local function add(pull, phase, useNumber, scopes)
    if type(pull) ~= "table" or type(pull.encounterID) ~= "number" then
        return nil
    end
    local list = {}
    for _, scope in ipairs(scopes or pullScopes(pull)) do
        local c = counters(pull.encounterID, groupOf(pull.difficultyID), pull.name, true, scope)
        addTo(c, pull, phase, useNumber)
        list[#list + 1] = c
    end
    return list
end

-- Fills the counters once from the Timeline's saved pulls (numbered per boss), oldest first. The Timeline keeps
-- only the newest of them, so the pulls its counter has numbered beyond the saved ones count as wipes with no
-- length (untimed). latest and phase: a pull being saved right now and its phase, when the fill runs from the
-- save hook. The Timeline's saved pulls are from before team raids, so they count as team and all alike; the pull
-- being saved counts in its own scopes. Marked done, so it never runs twice. Returns true when it filled, and the
-- counters the latest pull went into.
function Stats:Backfill(latest, phase)
    local s = sdb()
    local T = CRT.Timeline
    if s.filled or not T then
        return false
    end
    self:Migrate()
    local latestIn, latestTeam
    for _, b in ipairs(T:Bosses()) do
        local pulls = T:Pulls(b.encounterID) -- newest first
        for i = #pulls, 1, -1 do
            local p = pulls[i]
            if p == latest then
                local scopes = pullScopes(p)
                latestTeam = scopes[1] == Stats.TEAM
                latestIn = add(p, phase, true, scopes)
            else
                add(p, nil, true, Stats.SCOPES)
            end
        end
        for _, group in ipairs(Stats.GROUPS) do
            for _, scope in ipairs(Stats.SCOPES) do
                local total = T:PullCount(b.encounterID, group)
                -- the latest pull, when it started on another team, is in the Timeline's count but not in Team
                if scope == Stats.TEAM and latestIn and not latestTeam and latest.encounterID == b.encounterID and groupOf(latest.difficultyID) == group then
                    total = total - 1
                end
                local c = counters(b.encounterID, group, b.name, total > 0, scope)
                if c and total > c.pulls then
                    local extra = total - c.pulls
                    c.pulls, c.wipes, c.untimed = total, c.wipes + extra, c.untimed + extra
                end
            end
        end
    end
    s.filled = true
    s.scoped = true
    self:Fire()
    return true, latestIn
end

-- Your repair bill over the pull, when Repairs.lua measured it: added to the counters the pull just counted in (a
-- list, one per scope), once (Rep:Claim in SeasonStats/Repairs.lua keeps which pulls it gave), with the raid's
-- reports of that pull. With no read finished yet, the bill is added when the read finishes.
local function claimRepair(pull, list)
    local Rep = CRT.SeasonRepairs
    if Rep and Rep.Claim and type(list) == "table" and #list > 0 then
        Rep:Claim(pull, list)
    end
end

-- Counts a pull the Timeline just saved (its save hook). The first one after an update fills from the saved pulls
-- instead, this one among them.
function Stats:Record(pull, phase)
    self:Migrate()
    if not sdb().filled then
        local filled, list = self:Backfill(pull, phase)
        if filled then
            claimRepair(pull, list)
            return
        end
    end
    local list = add(pull, phase)
    if list then
        claimRepair(pull, list)
        self:Fire()
    end
end

-- Repairs ----------------------------------------------------------------------------------------------------------

-- Adds your repair bill over one pull (copper) to its counters.
function Stats:AddRepair(c, copper)
    if type(c) ~= "table" or type(copper) ~= "number" or copper < 0 then
        return
    end
    c.repairs = (c.repairs or 0) + copper
    c.repairPulls = (c.repairPulls or 0) + 1
end

-- Adds one raider's repair bill over a pull (copper) to the counters that pull was counted in; newPull when it's
-- the first report of that pull. Never makes counters: only a pull Season Stats counted gets reports.
function Stats:AddRaidRepair(c, copper, newPull)
    if type(c) ~= "table" or type(copper) ~= "number" or copper < 0 then
        return
    end
    c.raidRepairs = (c.raidRepairs or 0) + copper
    c.raidReporters = (c.raidReporters or 0) + 1
    if newPull then
        c.raidPulls = (c.raidPulls or 0) + 1
    end
end

-- Deletes one season's counters, every boss of it in the boss library (CRT.Bosses), both scopes. The counters are
-- long-term data, which the season purge keeps; the dev's /crt dev seasons clearstats <key> (Dev/SeasonTools.lua)
-- asks, then calls this. The one-time fill stays done, so the Timeline's saved pulls never count again. Returns how
-- many bosses had counters.
function Stats:ClearSeason(seasonKey)
    local B = CRT.Bosses
    local bosses = sdb().bosses
    local n = 0
    for _, def in ipairs(B and seasonKey and B:List(seasonKey) or {}) do
        if bosses[def.encounterID] ~= nil then
            bosses[def.encounterID] = nil
            n = n + 1
        end
    end
    if n > 0 then
        self:Fire()
    end
    return n
end

-- A boss's counters for a difficulty group, or nil when it has none.
-- scope is "team", "all" or a team's name, by default the page's Team filter (Stats:Scope).
function Stats:Boss(encounterID, group, scope)
    return counters(encounterID, group, nil, false, scope or self:Scope())
end

-- The furthest phase -------------------------------------------------------------------------------------------

-- The last few alerts runs of an encounter: { run, encounterID, at = time() at its start, phase }, newest last.
-- The Timeline saves a pull after combat, when its run has ended, so the phase is kept here until then.
local runs = {}

-- False for a secret value (the alerts run keeps the encounter ID as the game gave it), which can't be compared.
local function readable(v)
    if issecretvalue then
        local ok, secret = pcall(issecretvalue, v)
        if not ok or secret then
            return false
        end
    end
    return true
end

local function watchPhase()
    local A = CRT.Alerts
    local run = A and A.running and A.run
    if type(run) ~= "table" or run.reason ~= "encounter" or not readable(run.encounterID) or type(run.encounterID) ~= "number" then
        return
    end
    local last = runs[#runs]
    if not last or last.run ~= run then
        last = { run = run, encounterID = run.encounterID, at = time() }
        runs[#runs + 1] = last
        if #runs > 3 then
            table.remove(runs, 1)
        end
    end
    for _, ph in ipairs(A:Phases()) do
        if type(ph) == "number" and A:PhaseStart(ph) and (not last.phase or ph > last.phase) then
            last.phase = ph
        end
    end
end
Stats.WatchPhase = watchPhase

-- The furthest phase the alerts engine started in a pull, or nil when no run of its boss started with it.
function Stats.PhaseFor(pull)
    if type(pull) ~= "table" or type(pull.startedAt) ~= "number" then
        return nil
    end
    for i = #runs, 1, -1 do
        local r = runs[i]
        if r.encounterID == pull.encounterID and math.abs(r.at - pull.startedAt) <= Stats.RUN_MATCH then
            return r.phase
        end
    end
    return nil
end

-- Reading for the page --------------------------------------------------------------------------------------------

-- The seasons for the Season dropdown, { key, label }: the current one first, then the rest newest first.
function Stats.SeasonOptions()
    local B = CRT.Bosses
    local out = {}
    if not B then
        return out
    end
    local current = B:Current()
    if current then
        out[1] = { key = current.key, label = current.name or current.key }
    end
    local list = B:Seasons()
    for i = #list, 1, -1 do
        local def = list[i]
        if def ~= current then
            out[#out + 1] = { key = def.key, label = def.name or def.key }
        end
    end
    return out
end

-- The difficulty groups for the Difficulty dropdown, the Timeline's names.
function Stats.GroupOptions()
    local names = CRT.Timeline and CRT.Timeline.GROUP_NAMES or {}
    local out = {}
    for _, group in ipairs(Stats.GROUPS) do
        out[#out + 1] = { key = group, label = names[group] or group }
    end
    return out
end

-- One row per boss of a season's route, in route order: { encounterID, name, counters, pulls, wipes, kills,
-- firstKillPull, firstKillAt, bestKill, pullTime, repairs, repairPulls, raidRepairs, raidReporters, raidPulls };
-- a boss with no pulls has zeros and no counters. scope is "team", "all" or a team's name, by default the Team filter.
local REPAIR_FIELDS = { "repairs", "repairPulls", "raidRepairs", "raidReporters", "raidPulls" }
Stats.REPAIR_FIELDS = REPAIR_FIELDS

function Stats:Rows(seasonKey, group, scope)
    scope = scope or self:Scope()
    local out = {}
    local B = CRT.Bosses
    for _, def in ipairs(B and seasonKey and B:RouteList(seasonKey) or {}) do
        local c = counters(def.encounterID, group, nil, false, scope)
        local row = {
            encounterID = def.encounterID, name = def.name, counters = c,
            pulls = c and c.pulls or 0, wipes = c and c.wipes or 0, kills = c and c.kills or 0,
            firstKillPull = c and c.firstKillPull, firstKillAt = c and c.firstKillAt, bestKill = c and c.bestKill,
            pullTime = c and c.pullTime or 0,
        }
        for _, key in ipairs(REPAIR_FIELDS) do
            row[key] = c and c[key] or 0
        end
        out[#out + 1] = row
    end
    return out
end

-- The difficulty group the page opens on: the one with more pulls in the season, Mythic on a tie.
function Stats:DefaultGroup(seasonKey, scope)
    local n = {}
    for _, group in ipairs(Stats.GROUPS) do
        n[group] = 0
        for _, row in ipairs(self:Rows(seasonKey, group, scope)) do
            n[group] = n[group] + row.pulls
        end
    end
    return (n.nh or 0) > (n.mythic or 0) and "nh" or "mythic"
end

-- Whether a Late Tracker night or a Tattlebot pull (stamped team, false when not a team raid, and teamName, its
-- team's name) is in a scope: every one in all; in Pug the ones named Pug; in a team's scope the team raids whose
-- name reads as that team (no name, from before names, or a team removed since: Team). One stamped not a team raid
-- with no name (from before names, or outside a raid group) is in all only.
function Stats.InScope(scope, team, name)
    if scope == Stats.ALL then
        return true
    end
    if scope == Stats.PUG then
        return team == false and teamName(name) == Stats.PUG
    end
    if team == false then
        return false
    end
    return Stats.ScopeOf(name) == scope
end

-- The Late Tracker's raid nights in a season: its saved nights (and the running one) that started between the
-- season's first pull (less NIGHT_LEAD) and its last, on any difficulty. 0 with no pulls or no Late Tracker. In a
-- team's scope, only that team's nights (Stats.InScope).
function Stats:RaidNights(seasonKey, scope)
    scope = scope or self:Scope()
    local first, last
    for _, group in ipairs(Stats.GROUPS) do
        for _, row in ipairs(self:Rows(seasonKey, group, scope)) do
            local c = row.counters
            if c and c.first then
                first = math.min(first or c.first, c.first)
                last = math.max(last or c.last, c.last)
            end
        end
    end
    local Late = CRT.Late
    if not first or not Late then
        return 0
    end
    local nights = {}
    for _, night in ipairs(Late:History() or {}) do
        nights[#nights + 1] = night
    end
    nights[#nights + 1] = Late:Current()
    local count = 0
    for _, night in ipairs(nights) do
        local at = type(night) == "table" and night.startedAt
        local inScope = type(night) == "table" and Stats.InScope(scope, night.team, night.teamName)
        if inScope and type(at) == "number" and at >= first - Stats.NIGHT_LEAD and at <= last then
            count = count + 1
        end
    end
    return count
end

-- The cards and the rows: { bosses, killed, pulls, pullTime, untimed, nights (the Late Tracker's),
-- pullNights (nights with a pull on this difficulty), and the season's repairs, repairPulls, raidRepairs,
-- raidReporters and raidPulls }, rows, in a scope (by default the page's Team filter).
function Stats:Cards(seasonKey, group, scope)
    scope = scope or self:Scope()
    local rows = self:Rows(seasonKey, group, scope)
    local card = { bosses = #rows, killed = 0, pulls = 0, pullTime = 0, untimed = 0, pullNights = 0 }
    for _, key in ipairs(REPAIR_FIELDS) do
        card[key] = 0
    end
    local seen = {}
    for _, row in ipairs(rows) do
        for _, key in ipairs(REPAIR_FIELDS) do
            card[key] = card[key] + row[key]
        end
        local c = row.counters
        if c then
            card.killed = card.killed + (c.kills > 0 and 1 or 0)
            card.pulls = card.pulls + c.pulls
            card.pullTime = card.pullTime + c.pullTime
            card.untimed = card.untimed + c.untimed
            for key in pairs(c.nights) do
                if not seen[key] then
                    seen[key] = true
                    card.pullNights = card.pullNights + 1
                end
            end
        end
    end
    card.nights = self:RaidNights(seasonKey, scope)
    return card, rows
end

local function average(list, from, to)
    if to < from then
        return nil, 0
    end
    local sum = 0
    for i = from, to do
        sum = sum + list[i]
    end
    return sum / (to - from + 1), to - from + 1
end

-- What the reflection shows for a boss's counters (nil gives an empty one): nights, the last maxNights nights
-- oldest first ({ key, longest, phase, pulls }) and longest, the longest of them; furthest, { phase, key }, the
-- highest phase and the first night it was reached; causes, the TOP_CAUSES spells that killed most
-- ({ spellID, count }, unknown spells left out); recent and before, the average deaths per pull over the last HALF
-- pulls and the HALF before them, with recentN and beforeN pulls (before nil with none).
function Stats.Reflection(c, maxNights)
    local r = { nights = {}, longest = 0, causes = {}, recentN = 0, beforeN = 0 }
    if not c then
        return r
    end
    local keys = {}
    for key in pairs(c.nights) do
        keys[#keys + 1] = key
    end
    table.sort(keys)
    for i, key in ipairs(keys) do
        local night = c.nights[key]
        if night.phase and (not r.furthest or night.phase > r.furthest.phase) then
            r.furthest = { phase = night.phase, key = key }
        end
        if i > #keys - (maxNights or #keys) then
            r.nights[#r.nights + 1] = { key = key, longest = night.longest, phase = night.phase, pulls = night.pulls }
            r.longest = math.max(r.longest, night.longest)
        end
    end
    for id, count in pairs(c.causes) do
        if id ~= 0 then
            r.causes[#r.causes + 1] = { spellID = id, count = count }
        end
    end
    table.sort(r.causes, function(a, b)
        if a.count ~= b.count then
            return a.count > b.count
        end
        return a.spellID < b.spellID
    end)
    for i = #r.causes, Stats.TOP_CAUSES + 1, -1 do
        r.causes[i] = nil
    end
    local d, half = c.deaths, Stats.HALF
    local n = #d
    r.recent, r.recentN = average(d, math.max(1, n - half + 1), n)
    r.before, r.beforeN = average(d, math.max(1, n - 2 * half + 1), n - half)
    return r
end

-- Tattlebot's avoidable damage on a boss and group per night, newest first, at most max nights:
-- { key, pulls, damage, perPull, nightIDs, nightID }. nightIDs are the Tattlebot nights with a pull on that date,
-- newest first; a date can have two (End night pressed, then more pulls), and nightID, the one the page opens in
-- Tattlebot (CRT.TattlePage.ShowNight), is the first of them, the newest. Nil when Tattlebot has no pull on the
-- boss in that group. In a team's scope (by default the page's Team filter), only that team's Tattlebot pulls
-- (Stats.InScope).
function Stats:AvoidableTrend(encounterID, group, max, scope)
    local Tattle = CRT.Tattle
    if not (Tattle and Tattle.BossPulls) then
        return nil
    end
    scope = scope or self:Scope()
    local byKey, list = {}, {}
    for _, p in ipairs(Tattle:BossPulls(encounterID)) do
        -- a difficulty that wasn't readable (secret, saved as nil) belongs to no group
        local inScope = Stats.InScope(scope, p.team, p.teamName)
        if inScope and type(p.at) == "number" and type(p.difficulty) == "number" and groupOf(p.difficulty) == group then
            local key = Stats.NightKey(p.at)
            local night = byKey[key]
            if not night then
                night = { key = key, pulls = 0, damage = 0, nights = {} }
                byKey[key] = night
                list[#list + 1] = night
            end
            night.pulls = night.pulls + 1
            night.damage = night.damage + (p.damage or 0)
            if p.night ~= nil and not night.nights[p.night] then
                night.nights[p.night] = p.nightAt or p.at
            end
        end
    end
    for _, night in ipairs(list) do
        local ids = {}
        for id in pairs(night.nights) do
            ids[#ids + 1] = id
        end
        table.sort(ids, function(a, b)
            return night.nights[a] > night.nights[b]
        end)
        night.nightIDs, night.nightID, night.nights = ids, ids[1], nil
    end
    if #list == 0 then
        return nil
    end
    table.sort(list, function(a, b)
        return a.key > b.key
    end)
    for i = #list, (max or #list) + 1, -1 do
        list[i] = nil
    end
    for _, night in ipairs(list) do
        night.perPull = night.damage / night.pulls
    end
    return list
end

-- Death causes on the ability timeline ------------------------------------------------------------------------------
-- The row of the boss's ability timeline for a difficulty group (the one picker, Timeline:ReferenceFor) that a death
-- cause is: by spell ID, else by the spell's name against the row's name. The page colours the cause as the Timeline
-- draws the row (Reference.RowColor, read when drawn, so Use custom colours is followed) and lists its types.
-- The rows are read once per boss and group and kept until the Timeline changes (an ability timeline edited,
-- another picked, a pull saved).

local abilityRows = {} -- ["encounterID|group"] = { bySpell = { [spellID] = row }, byName = { [name] = row } }

local function foldName(s)
    local Reference = CRT.TimelineReference
    if Reference and Reference.Norm then
        return Reference.Norm(s)
    end
    return type(s) == "string" and s:lower() or nil
end

local function readAbilityRows(encounterID, group, bossName)
    local out = { bySpell = {}, byName = {} }
    local T = CRT.Timeline
    if not (T and T.ReferenceFor) then
        return out
    end
    local ok, entry = pcall(T.ReferenceFor, T, encounterID, group, bossName)
    local rows = ok and type(entry) == "table" and type(entry.ref) == "table" and entry.ref.rows or {}
    for _, row in ipairs(rows) do
        if type(row.spellID) == "number" and row.spellID > 0 and not out.bySpell[row.spellID] then
            out.bySpell[row.spellID] = row
        end
        local name = foldName(row.name)
        if name and name ~= "" and not out.byName[name] then
            out.byName[name] = row
        end
    end
    return out
end

-- The ability timeline row a death cause is, or nil: spellID (0 for an unknown spell gives nil), name the spell's
-- name when known; bossName the boss library's name, for an ability timeline with no Encounter line.
function Stats:AbilityRow(encounterID, group, spellID, name, bossName)
    if type(spellID) ~= "number" or spellID <= 0 then
        return nil
    end
    local key = tostring(encounterID) .. "|" .. tostring(group)
    local rows = abilityRows[key]
    if not rows then
        rows = readAbilityRows(encounterID, group, bossName)
        abilityRows[key] = rows
    end
    local folded = foldName(name)
    return rows.bySpell[spellID] or (folded and rows.byName[folded]) or nil
end

-- A death cause's icon: its spell's (C_Spell.GetSpellTexture), else the Journal's for that ability when the Journal
-- was read already (never read for a drawing), else a question mark, as for an unknown spell (0).
Stats.UNKNOWN_ICON = "Interface\\Icons\\INV_Misc_QuestionMark"

function Stats:CauseIcon(encounterID, group, spellID, name)
    if type(spellID) ~= "number" or spellID <= 0 then
        return Stats.UNKNOWN_ICON
    end
    if C_Spell and C_Spell.GetSpellTexture then
        local ok, tex = pcall(C_Spell.GetSpellTexture, spellID)
        if ok and (type(tex) == "number" or type(tex) == "string") then
            return tex
        end
    end
    local Journal = CRT.TimelineJournal
    if Journal and Journal.AbilitySection then
        local ok, section = pcall(Journal.AbilitySection, Journal, encounterID, group, spellID, name, nil, true)
        if ok and type(section) == "table" and section.icon then
            return section.icon
        end
    end
    return Stats.UNKNOWN_ICON
end

-- Text -------------------------------------------------------------------------------------------------------------

-- 272 -> "4:32", 3725 -> "1:02:05".
function Stats.Clock(seconds)
    local s = math.floor((seconds or 0) + 0.5)
    if s >= 3600 then
        return string.format("%d:%02d:%02d", math.floor(s / 3600), math.floor(s % 3600 / 60), s % 60)
    end
    return string.format("%d:%02d", math.floor(s / 60), s % 60)
end

-- 11100 -> "3h 05m", 2700 -> "45m".
function Stats.Hours(seconds)
    local m = math.floor((seconds or 0) / 60 + 0.5)
    if m >= 60 then
        return string.format("%dh %02dm", math.floor(m / 60), m % 60)
    end
    return string.format("%dm", m)
end

-- Copper as the game writes money, with its coin icons: GetMoneyString (Blizzard_SharedXML/FormattingUtil.lua,
-- thousands separated), else C_CurrencyInfo.GetCoinTextureString. From 10 gold up it shows whole gold, under that
-- gold and silver, under a silver copper.
function Stats.Money(copper)
    copper = math.max(0, math.floor(copper or 0))
    if copper >= 100000 then
        copper = math.floor(copper / 10000) * 10000
    elseif copper >= 100 then
        copper = math.floor(copper / 100) * 100
    end
    if GetMoneyString then
        local ok, s = pcall(GetMoneyString, copper, true)
        if ok and type(s) == "string" then
            return s
        end
    end
    if C_CurrencyInfo and C_CurrencyInfo.GetCoinTextureString then
        local ok, s = pcall(C_CurrencyInfo.GetCoinTextureString, copper)
        if ok and type(s) == "string" then
            return s
        end
    end
    local gold, silver = math.floor(copper / 10000), math.floor(copper % 10000 / 100)
    if gold > 0 then
        return silver > 0 and string.format("%dg %ds", gold, silver) or string.format("%dg", gold)
    end
    if silver > 0 then
        return string.format("%ds", silver)
    end
    return string.format("%dc", copper)
end

-- 2 -> "Phase 2", 1.5 -> "Phase 1.5".
function Stats.PhaseText(ph)
    if ph == math.floor(ph) then
        return string.format("Phase %d", ph)
    end
    return "Phase " .. tostring(ph)
end

-- Counts each saved pull, and keeps each encounter's furthest phase while it runs.
if CRT.Timeline and CRT.Timeline.OnSaved then
    CRT.Timeline:OnSaved(function(pull)
        Stats:Record(pull, Stats.PhaseFor(pull))
    end)
end
-- the ability timelines' rows are read again after any Timeline change
if CRT.Timeline and CRT.Timeline.OnChange then
    CRT.Timeline:OnChange(function()
        abilityRows = {}
    end)
end
if CRT.Alerts and CRT.Alerts.OnChange then
    CRT.Alerts:OnChange(watchPhase)
end

-- removing a team deletes its counters; merging one moves them
if CRT.Team and CRT.Team.OnTeamData then
    CRT.Team:OnTeamData({
        count = function(name)
            return Stats:TeamPulls(name)
        end,
        delete = function(name)
            Stats:DeleteTeam(name)
        end,
        merge = function(from, into)
            return { pulls = Stats:MergeTeam(from, into) }
        end,
    })
end

local driver = CreateFrame("Frame")
driver:RegisterEvent("PLAYER_LOGIN")
driver:SetScript("OnEvent", function()
    -- the counters from before team raids into all first, then the fill (which counts in both)
    Stats:Migrate()
    Stats:Backfill()
end)
