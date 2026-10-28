local ADDON, CRT = ...

-- The teams you pick tonight's team from (CRT.Team, Team.lua): Team and Pug, built in and never removed, then your
-- own, saved in CRTDB.team.list in the order added. A name is trimmed, 1 to MAX_NAME characters, with no | (it
-- travels in the push, "T|1|<name>") and no control characters; names are unique in any case, so "cowfee" can't sit
-- beside "Cowfee"; All is reserved (Season Stats' filter) and at most MAX_TEAMS are saved. The dropdown's entries (Team:Options) end with "Add team…", which General Settings and the new
-- raid group popup both open as TeamDialogs.lua's name box.
--
-- Removing a team deletes the data saved under it: each owner of such data (Season Stats) registers with
-- Team:OnTeamData({ count = fn(name), delete = fn(name) }); Team:TeamPulls(name) adds up count, and
-- Team:RemoveTeam(name) calls every delete. Other records that only stamp a team's name (Tattlebot, the Late
-- Tracker) keep it, and read it as Team once the name is gone (Team.Resolve).

local Team = CRT.Team

Team.MAX_NAME = 24
Team.MAX_TEAMS = 20 -- your own teams saved at most; a push of a new team past it is used tonight, not saved
Team.RESERVED = { all = true } -- Season Stats' All filter: never a team's name, in any case
Team.ADD_KEY = "\0add" -- the dropdown's Add team… entry, never a name (Clean refuses control characters)
Team.LIST_TEXT = {
    add = "Add team\226\128\166",
    empty = "Type a name for the team.",
    long = "A team name is at most 24 characters.",
    bar = "A team name can't have a | in it.",
    taken = "There is already a team named %s.",
    reserved = "%s can't be a team name.",
    full = "You have 20 teams. Remove one to add another.",
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

-- The team a name means, as saved (any case): Team, Pug, one of your list, or the pushed team your full list
-- couldn't keep (CRTDBChar.team.extra, tonight only). Nil for none.
function Team:Find(name)
    local clean = Team.Clean(name)
    if not clean then
        return nil
    end
    local low = clean:lower()
    if low == Team.TEAM:lower() then
        return Team.TEAM
    elseif low == Team.PUG:lower() then
        return Team.PUG
    end
    for _, n in ipairs(list()) do
        if type(n) == "string" and n:lower() == low then
            return n
        end
    end
    local extra = Team.State and Team.State().extra
    if type(extra) == "string" and extra:lower() == low then
        return extra
    end
    return nil
end

-- Every team, the built-in two first, then yours in the order added (and a pushed team your full list couldn't
-- keep, last).
function Team:Names()
    local out = { Team.TEAM, Team.PUG }
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
    if Team.RESERVED[clean:lower()] then
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
        s.tonight = Team.TEAM
    end
    if s.pushed == found then
        s.pushed = nil -- never sent to a joiner once removed
    end
    Team.Update()
    return true
end
