local ADDON, CRT = ...

-- The teams you pick tonight's team from (CRT.Team, Team.lua): Pug, built in and never removed, then your own,
-- saved in CRTDB.team.list in the order added. Team, the built-in team from before your own teams, is no longer
-- picked: it stays only as the scope of the counts and records from before (Season Stats' "Before teams"), which
-- Team:Merge can move into one of your teams, and as a reserved name. A name is trimmed, 1 to MAX_NAME characters, with no | (it
-- travels in the push, "T|1|<name>") and no control characters. Two names are one team when their Team.MatchKey is
-- the same (lower case, spaces and punctuation dropped), so "Chaos Born" can't sit beside "ChaosBorn" or
-- "chaos-born", and a pushed "ChaosBorn" lands on a saved "Chaos Born"; All is reserved (Season Stats' filter) in
-- any such spelling, and at most MAX_TEAMS are saved. The dropdown's entries (Team:Options) end with "Add team…",
-- which General Settings and the new raid group popup both open as TeamDialogs.lua's name box.
--
-- Removing a team deletes the data saved under it: each owner of such data (Season Stats) registers with
-- Team:OnTeamData({ count = fn(name), delete = fn(name), merge = fn(from, into, restamp) }); Team:TeamPulls(name)
-- adds up count, and Team:RemoveTeam(name) calls every delete. Other records that only stamp a team's name
-- (Tattlebot, the Late Tracker) keep it, and read it as Team once the name is gone (Team.Resolve).
--
-- Merging (Team:Merge(from, into), never by itself): every owner's merge moves from's data into into's (Season
-- Stats' counters; Tattlebot's and the Late Tracker's stamps through Team.Restamp), tonight's team and your push
-- follow, and from leaves the list. Look-alikes saved before names matched this way (Team:LookAlikes) stay apart,
-- each found by its own spelling first, until merged: General Settings' Merge team… and the look-alike prompt
-- (UI/TeamLookAlike.lua) ask.

local Team = CRT.Team

Team.MAX_NAME = 24
Team.MAX_TEAMS = 20 -- your own teams saved at most; a push of a new team past it is used tonight, not saved
-- by MatchKey, never a team's name in any spelling: Season Stats' All filter, and Team (the counts from before teams)
Team.RESERVED = { all = true, team = true }
Team.ADD_KEY = "\0add" -- the dropdown's Add team… entry, never a name (Clean refuses control characters)
Team.LIST_TEXT = {
    add = "Add team\226\128\166",
    empty = "Type a name for the team.",
    long = "A team name is at most 24 characters.",
    bar = "A team name can't have a | in it.",
    taken = "There is already a team named %s.",
    reserved = "%s can't be a team name.",
    full = "You have 20 teams. Remove one to add another.",
    before = "Before teams", -- the built-in Team's counts, from before your own teams (Season Stats' filter too)
}

local function settings()
    local db = CRT.db
    return db and db.team
end

local function list()
    local s = settings()
    if not s then
        return {}
    end
    if type(s.list) ~= "table" then
        s.list = {}
    end
    return s.list
end

-- A name as it is saved, or nil and why not (a LIST_TEXT line): trimmed, 1 to MAX_NAME characters, no | and no
-- control characters. Never reads a secret value.
function Team.Clean(name)
    if not Team.Readable(name) or type(name) ~= "string" then
        return nil, Team.LIST_TEXT.empty
    end
    name = name:gsub("^%s+", ""):gsub("%s+$", "")
    if name == "" then
        return nil, Team.LIST_TEXT.empty
    end
    if name:find("|", 1, true) then
        return nil, Team.LIST_TEXT.bar
    end
    if name:find("%c") then
        return nil, Team.LIST_TEXT.empty
    end
    if #name > Team.MAX_NAME then
        return nil, Team.LIST_TEXT.long
    end
    return name
end

-- Whether a name is one of the two built-in teams.
function Team.BuiltIn(name)
    return name == Team.TEAM or name == Team.PUG
end

-- The key two team names are the same team by: lower case, every space and punctuation character dropped, so
-- "Chaos Born", "ChaosBorn" and "chaos-born" are one team. Letters and digits stay, other alphabets too (only
-- %s and %p are dropped). Nil for anything that isn't a readable string.
function Team.MatchKey(name)
    if not Team.Readable(name) or type(name) ~= "string" then
        return nil
    end
    return (name:lower():gsub("[%s%p]", ""))
end

-- The first of the teams that a test picks: Team, Pug, your list in order, then the pushed team your full list
-- couldn't keep.
local function firstTeam(test)
    if test(Team.TEAM) then
        return Team.TEAM
    elseif test(Team.PUG) then
        return Team.PUG
    end
    for _, n in ipairs(list()) do
        if type(n) == "string" and test(n) then
            return n
        end
    end
    local extra = Team.State and Team.State().extra
    if type(extra) == "string" and test(extra) then
        return extra
    end
    return nil
end

-- The team a name means, as saved: Team, Pug, one of your list, or the pushed team your full list couldn't keep
-- (CRTDBChar.team.extra, tonight only). The same name in any case first, so two look-alike teams saved before
-- MatchKey stay apart until merged; else the first team with its MatchKey. Nil for none.
function Team:Find(name)
    local clean = Team.Clean(name)
    if not clean then
        return nil
    end
    local low = clean:lower()
    local found = firstTeam(function(n)
        return n:lower() == low
    end)
    if found then
        return found
    end
    local key = Team.MatchKey(clean)
    if not key or key == "" then
        return nil
    end
    return firstTeam(function(n)
        return Team.MatchKey(n) == key
    end)
end

-- Every team tonight's can be: Pug first, then yours in the order added (and a pushed team your full list couldn't
-- keep, last). Never the built-in Team.
function Team:Names()
    local out = { Team.PUG }
    for _, n in ipairs(list()) do
        if type(n) == "string" then
            out[#out + 1] = n
        end
    end
    local extra = Team.State and Team.State().extra
    if type(extra) == "string" then
        out[#out + 1] = extra
    end
    return out
end

-- Your saved teams, in list order: not Team or Pug, nor a pushed team your full list couldn't keep.
function Team:Saved()
    local out = {}
    for _, n in ipairs(list()) do
        if type(n) == "string" then
            out[#out + 1] = n
        end
    end
    return out
end

-- The teams a merge can take from: Team (Before teams) while data owners count pulls under it, then your saved
-- teams.
function Team:MergeSources()
    local out = {}
    if self:TeamPulls(Team.TEAM) > 0 then
        out[1] = Team.TEAM
    end
    for _, n in ipairs(self:Saved()) do
        out[#out + 1] = n
    end
    return out
end

-- The dropdown's entries, { key, label }: every team, then Add team….
function Team:Options()
    local out = {}
    for _, n in ipairs(self:Names()) do
        out[#out + 1] = { key = n, label = n }
    end
    out[#out + 1] = { key = Team.ADD_KEY, label = Team.LIST_TEXT.add }
    return out
end

-- A name that can never be a team (Team.RESERVED), and why: nil for any other.
local function reserved(clean)
    if Team.RESERVED[Team.MatchKey(clean) or ""] then
        return Team.LIST_TEXT.reserved:format(clean)
    end
    return nil
end

-- Adds a team. Returns its name, or nil and why not (a line to show).
function Team:AddTeam(name)
    local clean, why = Team.Clean(name)
    if not clean then
        return nil, why
    end
    why = reserved(clean)
    if why then
        return nil, why
    end
    local found = self:Find(clean)
    if found and found ~= Team.State().extra then
        return nil, Team.LIST_TEXT.taken:format(found)
    end
    local l = list()
    if #l >= Team.MAX_TEAMS then
        return nil, Team.LIST_TEXT.full
    end
    l[#l + 1] = clean
    return clean
end

-- The team a push names, added to your list when new. With the list full it is still tonight's team, kept only
-- while you are in the group (CRTDBChar.team.extra). Nil for a name Clean refuses or a reserved one.
function Team:Ensure(name)
    local clean = Team.Clean(name)
    if not clean or reserved(clean) then
        return nil
    end
    local found = self:Find(clean)
    if found and found ~= Team.State().extra then
        return found
    end
    local added = self:AddTeam(clean)
    if added then
        return added
    end
    Team.State().extra = clean
    return clean
end

-- Data saved under team names ----------------------------------------------------------------------------------

Team.dataOwners = {}

function Team:OnTeamData(owner)
    self.dataOwners[#self.dataOwners + 1] = owner
end

-- How many pulls are saved under a team, over every owner.
function Team:TeamPulls(name)
    local n = 0
    for _, owner in ipairs(self.dataOwners) do
        if owner.count then
            local ok, c = pcall(owner.count, name)
            if ok and type(c) == "number" then
                n = n + c
            end
        end
    end
    return n
end

-- Whether a team can be removed now: one of yours, and not locked by the raid leader's push.
function Team:CanRemove(name)
    local found = self:Find(name)
    if found == nil or Team.BuiltIn(found) or found == Team.State().extra or self:IsLocked() then
        return false
    end
    return true
end

-- Removes one of your teams and every owner's data saved under it. Tonight's team goes back to Team when it was
-- this one. Returns true when it was removed.
function Team:RemoveTeam(name)
    if not self:CanRemove(name) then
        return false
    end
    local found = self:Find(name)
    local l = list()
    for i = #l, 1, -1 do
        if l[i] == found then
            table.remove(l, i)
        end
    end
    for _, owner in ipairs(self.dataOwners) do
        if owner.delete then
            local ok, err = pcall(owner.delete, found)
            if not ok and geterrorhandler then
                geterrorhandler()(err)
            end
        end
    end
    local s = Team.State()
    if s.tonight == found then
        s.tonight = Team.PUG
    end
    if s.last == found then
        s.last = nil
    end
    if s.pushed == found then
        s.pushed = nil -- never sent to a joiner once removed
    end
    Team.Update()
    return true
end

-- Merging teams ------------------------------------------------------------------------------------------------

-- Your saved teams that look alike (the same MatchKey): a list of groups, each its names in list order, the groups
-- in the order their first name is listed. Only groups of two or more.
function Team:LookAlikes()
    local groups, byKey = {}, {}
    for _, n in ipairs(list()) do
        local key = type(n) == "string" and Team.MatchKey(n)
        if key and key ~= "" then
            local g = byKey[key]
            if not g then
                g = {}
                byKey[key] = g
                groups[#groups + 1] = g
            end
            g[#g + 1] = n
        end
    end
    local out = {}
    for _, g in ipairs(groups) do
        if #g > 1 then
            out[#out + 1] = g
        end
    end
    return out
end

-- For the owners that only stamp a team's name on a record (Tattlebot's pulls, the Late Tracker's nights): a
-- record stamped with a name that reads as from (Team.Resolve) is stamped into instead, and, into Pug, as not a team
-- raid (team = false), as a Pug night is. Returns true when the record was stamped again.
-- From Team (before teams): every team raid's record whose name reads as Team, with no name (from before names) or a
-- team removed since; a record stamped not a team raid stays.
function Team.Restamp(record, from, into)
    if type(record) ~= "table" then
        return false
    end
    if from == Team.TEAM then
        if record.team == false or Team.Resolve(record.teamName) ~= Team.TEAM then
            return false
        end
    elseif type(record.teamName) ~= "string" or Team.Resolve(record.teamName) ~= from then
        return false
    end
    record.teamName = into
    if into == Team.PUG then
        record.team = false
    end
    return true
end

-- Whether from can be merged into into now, as saved: from one of your saved teams or Team (the counts from before
-- teams; never Pug), into Pug or another saved team (never Team), and neither locked by the raid leader's push.
-- Returns both names, or nil.
function Team:CanMerge(from, into)
    local f, i = self:Find(from), self:Find(into)
    local extra = Team.State().extra
    if not f or not i or f == i or f == Team.PUG or i == Team.TEAM or f == extra or i == extra then
        return nil
    end
    local tonight = self:Tonight()
    if self:IsLocked() and (tonight == f or tonight == i) then
        return nil
    end
    return f, i
end

-- Merges one team into another: every owner of data saved under a team name moves from's into into's
-- (Team:OnTeamData's merge = fn(from, into, Team.Restamp), returning a table of counts), tonight's team and your push follow, and
-- from leaves your list. Returns the summary, { from, into, pulls, ... every owner's counts }, or nil when
-- CanMerge refuses.
function Team:Merge(fromName, intoName)
    local from, into = self:CanMerge(fromName, intoName)
    if not from then
        return nil
    end
    local summary = { from = from, into = into, pulls = 0 }
    -- every owner first, while from is still listed (their saved names read through Find)
    for _, owner in ipairs(self.dataOwners) do
        if owner.merge then
            local ok, counts = pcall(owner.merge, from, into, Team.Restamp)
            if not ok then
                if geterrorhandler then
                    geterrorhandler()(counts)
                end
            elseif type(counts) == "table" then
                for k, v in pairs(counts) do
                    if type(v) == "number" then
                        summary[k] = (summary[k] or 0) + v
                    end
                end
            end
        end
    end
    local s = Team.State()
    if s.tonight ~= nil and Team.Resolve(s.tonight) == from then
        s.tonight = into
    end
    if s.pushed ~= nil and Team.Resolve(s.pushed) == from then
        s.pushed = into
    end
    if s.last ~= nil and Team.Resolve(s.last) == from then
        s.last = not Team.BuiltIn(into) and into or nil
    end
    local l = list()
    for i = #l, 1, -1 do
        if l[i] == from then
            table.remove(l, i)
        end
    end
    Team.Update()
    return summary
end
