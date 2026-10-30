local ADDON, CRT = ...

-- Debuff lists: the special alerts of kind debuffList (Alerts/Special.lua reads them from the boss file). This file is
-- the one place that finds who has the debuff and how the list may show it; Alerts/DebuffListView.lua draws it, and
-- Notes/SpecialDebuffLooks.lua is its Looks tab. Nothing here is per boss: every debuffList entry uses it.
--
-- Your looks: CRT.db.alerts.debuffLists[encounterID][key] = { groups = { [side] = { 1, 3 } }, colors = { [side] =
-- { on = { r, g, b }, off = { r, g, b } } }, showAll, sortByRole, barHeight, barWidth, position (the placement's) }.
-- Each is kept only while it differs from the boss file's, so a later change to the file reaches you. DL:Look gives
-- yours over the file's.
--
-- Reading the debuff (the tiers), best first, chosen at run time from what the game gives:
--   readable    C_UnitAuras.GetUnitAuraBySpellID(unit, spellID) gives an aura or nothing, so each player has it or
--               not. An aura table the game hides (a secret) still says "has it": a boolean test on a secret that is
--               not a boolean is allowed (warcraft.wiki.gg Secret_values), and its fields are never read. Rows can
--               be filtered: Show every player off lists only the players with it.
--   secret      the game gives a secret boolean: it is never tested or compared. It goes straight to the bar's
--               Region:SetVertexColorFromBoolean (12.0.0, AllowedWhenTainted), which colours it on or off. Rows
--               can't be filtered, so every player of the side shows (Show every player is forced on).
--   private     C_UnitAuras.AuraIsPrivate(spellID) says the game keeps it from addons: the list shows nothing.
--   unreadable  every lookup errored (or the function is missing): the list shows nothing.
-- GetUnitAuraBySpellID is RequiresNonSecretAura: on an aura the game hides it returns nothing, which reads as "doesn't
-- have it". So a readable tier that never sees anyone with it is not proof; /crt dev aura (CRT_Dev/Dev/AuraProbe.lua)
-- answers which tier a debuff is in on a real pull.
-- What a pull (or the probe) saw is kept per debuff in CRT.db.alerts.debuffTiers[spellID] = { tier, at }: private and
-- unreadable put a notice on the Looks tab, secret greys Show every player. readable is kept only once someone was
-- seen with it.
--
-- The rows: the group's players by side (their raid subgroup in the side's groups; a party is group 1), sorted by role
-- (tanks, healers, damage) then name when Sort by role is on, else by name. A player whose name, group or role the
-- game hides is left out. Solo there is no list.
-- Game calls (warcraft.wiki.gg and Blizzard's UnitAuraDocumentation.lua, live, read 2026-10-30):
-- C_UnitAuras.GetUnitAuraBySpellID(unit, spellID) -> AuraData? (RequiresNonSecretAura, SecretWhenUnitAuraRestricted,
-- AllowedWhenTainted); C_UnitAuras.AuraIsPrivate(spellID) -> bool (AllowedWhenTainted); IsInRaid(); IsInGroup();
-- GetRaidRosterInfo(i) -> name, rank, subgroup, ...; UnitName(unit); UnitGroupRolesAssigned(unit) ("TANK", "HEALER",
-- "DAMAGER", "NONE"; SecretWhenUnitIdentityRestricted); UnitIsUnit(a, b); issecretvalue(value).

local DL = { listeners = {} }
CRT.AlertDebuffList = DL

-- Your looks are kept per boss: declared for the dev season purge (Bosses:DeclareStore, CRT_Data/Bosses/Registry.lua).
if CRT.Bosses and CRT.Bosses.DeclareField then
    CRT.Bosses:DeclareField("debuff list looks", "alerts", "debuffLists")
end

DL.MAX_RAID = 40 -- the game's raid1 to raid40 (MAX_RAID_MEMBERS)
DL.MAX_PARTY = 4 -- party1 to party4
local MAX_GROUP = 8
DL.TIERS = { readable = true, secret = true, private = true, unreadable = true }
local ROLE_ORDER = { TANK = 1, HEALER = 2, DAMAGER = 3, NONE = 4 }
DL.ROLE_ORDER = ROLE_ORDER

-- Every word a player can see, in one place. Keep the keys, change the text in quotes, save, /reload.
local TEXT = {
    hidden = "The game hides this debuff from addons, so the list can't fill in.",
}
DL.TEXT = TEXT

local function isSecret(v)
    if not issecretvalue then
        return false
    end
    local ok, s = pcall(issecretvalue, v)
    return not ok or s == true
end
DL.IsSecret = isSecret

-- A value the game gave, or nil when it errored or is hidden.
local function ask(fn, ...)
    if type(fn) ~= "function" then
        return nil
    end
    local ok, v = pcall(fn, ...)
    if not ok or isSecret(v) then
        return nil
    end
    return v
end

local function Special()
    return CRT.AlertSpecial
end

local function copyColor(c)
    return { c[1], c[2], c[3] }
end

local function sameList(a, b)
    if type(a) ~= "table" or type(b) ~= "table" or #a ~= #b then
        return false
    end
    for i = 1, #a do
        if a[i] ~= b[i] then
            return false
        end
    end
    return true
end

-- Listeners ------------------------------------------------------------------------------------------

-- fn() runs after a look or a seen tier changes (the display and the Looks tab follow).
function DL:OnChange(fn)
    self.listeners[#self.listeners + 1] = fn
end

function DL:Fire()
    for _, fn in ipairs(self.listeners) do
        local ok, err = pcall(fn)
        if not ok and geterrorhandler then
            geterrorhandler()(err)
        end
    end
end

-- Your looks ---------------------------------------------------------------------------------------

local function settings()
    return CRT.db and CRT.db.alerts
end

-- The saved table of one entry (made when create), or nil.
function DL:Store(enc, key, create)
    local s = settings()
    if type(s) ~= "table" then
        return nil
    end
    if create and type(s.debuffLists) ~= "table" then
        s.debuffLists = {}
    end
    local all = type(s.debuffLists) == "table" and s.debuffLists or nil
    if not all then
        return nil
    end
    if create and type(all[enc]) ~= "table" then
        all[enc] = {}
    end
    local boss = type(all[enc]) == "table" and all[enc] or nil
    if not boss then
        return nil
    end
    if create and type(boss[key]) ~= "table" then
        boss[key] = {}
    end
    return type(boss[key]) == "table" and boss[key] or nil
end

-- "1, 3" (or "1 3", "1,3") as raid groups 1 to 8, each once, in order, or nil and why.
function DL.ParseGroups(s)
    if type(s) ~= "string" then
        return nil, "Type raid groups 1 to 8, such as 1, 3."
    end
    local list = {}
    for word in s:gmatch("[^%s,;]+") do
        local n = tonumber(word)
        if not n then
            return nil, "Type raid groups 1 to 8, such as 1, 3."
        end
        list[#list + 1] = n
    end
    local read = Special() and Special().ReadGroups(list)
    if not read then
        return nil, "Type raid groups 1 to 8, each once, such as 1, 3."
    end
    return read
end

function DL.GroupsText(list)
    local out = {}
    for i, g in ipairs(list or {}) do
        out[i] = tostring(g)
    end
    return table.concat(out, ", ")
end

-- The look in use for an entry: { sides = { { key, label, groups } }, colors = { [side] = { on, off } }, showAll,
-- sortByRole, barHeight, barWidth }, your choices over the boss file's.
function DL:Look(enc, entry)
    local saved = self:Store(enc, entry.key) or {}
    local groups = type(saved.groups) == "table" and saved.groups or {}
    local colors = type(saved.colors) == "table" and saved.colors or {}
    local S = Special()
    local look = { sides = {}, colors = {} }
    for i, side in ipairs(entry.sides) do
        local mine = S.ReadGroups(groups[side.key])
        look.sides[i] = { key = side.key, label = side.label, groups = mine or side.groups, own = mine ~= nil }
        local base, c = entry.colors[side.key], type(colors[side.key]) == "table" and colors[side.key] or {}
        look.colors[side.key] = {}
        for _, which in ipairs({ "on", "off" }) do
            local v = c[which]
            local ok = type(v) == "table" and type(v[1]) == "number" and type(v[2]) == "number" and type(v[3]) == "number"
            look.colors[side.key][which] = ok and copyColor(v) or copyColor(base[which])
        end
    end
    local function pick(v, default)
        if type(v) == "boolean" then
            return v
        end
        return default
    end
    look.showAll = pick(saved.showAll, entry.showAll)
    look.sortByRole = pick(saved.sortByRole, entry.sortByRole)
    local range = S.BAR_RANGE
    local function size(v, default, r)
        if type(v) == "number" and v >= r.min and v <= r.max then
            return v
        end
        return default
    end
    look.barHeight = size(saved.barHeight, entry.barHeight, range.height)
    look.barWidth = size(saved.barWidth, entry.barWidth, range.width)
    return look
end

-- Saves one look and tells the listeners. field: "groups" (value a list, or nil for the boss file's; side the side's
-- key), "color" (side, which = "on" or "off", value { r, g, b } or nil for the file's), "showAll", "sortByRole",
-- "barHeight", "barWidth" (nil for the file's). A value equal to the file's is saved as nothing.
function DL:SetLook(enc, entry, field, value, side, which)
    local s = self:Store(enc, entry.key, true)
    if not s then
        return
    end
    if field == "groups" then
        local base
        for _, sd in ipairs(entry.sides) do
            if sd.key == side then
                base = sd.groups
            end
        end
        if not base then
            return
        end
        local read = value ~= nil and Special().ReadGroups(value) or nil
        s.groups = type(s.groups) == "table" and s.groups or {}
        s.groups[side] = (read and not sameList(read, base)) and read or nil
        if next(s.groups) == nil then
            s.groups = nil
        end
    elseif field == "color" then
        local base = entry.colors[side] and entry.colors[side][which]
        if not base then
            return
        end
        s.colors = type(s.colors) == "table" and s.colors or {}
        local c = type(s.colors[side]) == "table" and s.colors[side] or {}
        local same = type(value) == "table" and value[1] == base[1] and value[2] == base[2] and value[3] == base[3]
        c[which] = (type(value) == "table" and not same) and copyColor(value) or nil
        s.colors[side] = next(c) and c or nil
        if next(s.colors) == nil then
            s.colors = nil
        end
    elseif field == "showAll" or field == "sortByRole" then
        local v = value and true or false
        s[field] = v ~= entry[field] and v or nil
    elseif field == "barHeight" or field == "barWidth" then
        local r = Special().BAR_RANGE[field == "barHeight" and "height" or "width"]
        local v = type(value) == "number" and math.floor(math.max(r.min, math.min(r.max, value)) + 0.5) or nil
        s[field] = v ~= entry[field] and v or nil
    else
        return
    end
    self:Fire()
end

-- The tier seen -------------------------------------------------------------------------------------

local function tierStore(create)
    local s = settings()
    if type(s) ~= "table" then
        return nil
    end
    if create and type(s.debuffTiers) ~= "table" then
        s.debuffTiers = {}
    end
    return type(s.debuffTiers) == "table" and s.debuffTiers or nil
end

-- The tier a pull or the probe last saw for a debuff, or nil.
function DL:Seen(spellID)
    local all = tierStore()
    local t = all and all[spellID]
    return type(t) == "table" and DL.TIERS[t.tier] and t.tier or nil
end

function DL:SetSeen(spellID, tier)
    if type(spellID) ~= "number" or not DL.TIERS[tier] then
        return
    end
    local all = tierStore(true)
    if not all then
        return
    end
    local before = self:Seen(spellID)
    all[spellID] = { tier = tier, at = time and time() or 0 }
    if before ~= tier then
        self:Fire()
    end
end

-- The Looks tab's one line for a debuff the game hides, or nil.
function DL:Notice(spellID)
    local t = self:Seen(spellID)
    if t == "private" or t == "unreadable" then
        return TEXT.hidden
    end
    return nil
end

-- Whether Show every player is forced on (the game gave a secret: rows can't be filtered).
function DL:ForcedShowAll(spellID)
    return self:Seen(spellID) == "secret"
end

-- Reading ------------------------------------------------------------------------------------------

-- One unit's state for a debuff: "on" (has it), "off" (doesn't, or the game gave nothing), "secret" (a secret boolean,
-- in raw, for SetVertexColorFromBoolean only) or "error" (the call failed or the function is missing).
function DL.ReadUnit(unit, spellID)
    local api = C_UnitAuras and C_UnitAuras.GetUnitAuraBySpellID
    if type(api) ~= "function" then
        return "error"
    end
    local ok, aura = pcall(api, unit, spellID)
    if not ok then
        return "error"
    end
    if isSecret(aura) and type(aura) == "boolean" then
        return "secret", aura -- never tested: it only goes to a setter that takes secrets
    end
    -- nil or an aura table (readable or hidden): a boolean test is allowed on both; the table is never read
    if aura then
        return "on"
    end
    return "off"
end

-- true when the game says the debuff is a private aura, false when it says not, nil when it can't say.
function DL.IsPrivate(spellID)
    local fn = C_UnitAuras and C_UnitAuras.AuraIsPrivate
    local v = ask(fn, spellID)
    if type(v) ~= "boolean" then
        return nil
    end
    return v
end

-- The tier of a set of unit states (state by unit) and the private answer.
function DL.Classify(states, private)
    if private == true then
        return "private"
    end
    local n, errors, secret, on = 0, 0, false, false
    for _, st in pairs(states) do
        n = n + 1
        if st.state == "error" then
            errors = errors + 1
        elseif st.state == "secret" then
            secret = true
        elseif st.state == "on" then
            on = true
        end
    end
    if secret then
        return "secret", on
    end
    if n > 0 and errors == n then
        return "unreadable", false
    end
    return "readable", on
end

-- The roster -------------------------------------------------------------------------------------

local function readableString(v)
    return type(v) == "string" and not isSecret(v) and v ~= "" and v or nil
end

-- A unit's role ("TANK", "HEALER", "DAMAGER", "NONE"), fallback when the game gives nothing, nil when it hides it.
local function roleOf(unit, fallback)
    local fn = UnitGroupRolesAssigned
    if type(fn) ~= "function" then
        return fallback or "NONE"
    end
    local ok, role = pcall(fn, unit)
    if not ok or isSecret(role) then
        return nil
    end
    if type(role) == "string" and ROLE_ORDER[role] then
        return role
    end
    return fallback or "NONE"
end

local function isMe(unit)
    if unit == "player" then
        return true
    end
    local ok, same = pcall(UnitIsUnit, unit, "player")
    return ok and not isSecret(same) and same == true
end

-- The group's players: { { unit, name, group, role, isMe } }, in raid or party order. {} when solo.
function DL.Roster()
    local out = {}
    if ask(IsInRaid) then
        for i = 1, DL.MAX_RAID do
            local unit = "raid" .. i
            local ok, name, _, subgroup, _, _, _, _, _, _, _, _, combatRole = pcall(GetRaidRosterInfo, i)
            name = ok and readableString(name)
            local group = ok and not isSecret(subgroup) and type(subgroup) == "number" and subgroup or nil
            local fallback = ok and not isSecret(combatRole) and ROLE_ORDER[combatRole] and combatRole or nil
            local role = name and group and roleOf(unit, fallback)
            if name and group and role then
                out[#out + 1] = { unit = unit, name = name, group = group, role = role, isMe = isMe(unit) }
            end
        end
    elseif ask(IsInGroup) then
        for i = 0, DL.MAX_PARTY do
            local unit = i == 0 and "player" or ("party" .. i)
            local name = readableString(ask(UnitName, unit))
            local role = name and roleOf(unit)
            if name and role then
                out[#out + 1] = { unit = unit, name = name, group = 1, role = role, isMe = i == 0 }
            end
        end
    end
    return out
end

-- The sides ---------------------------------------------------------------------------------------

local function byRoleThenName(a, b)
    local ra, rb = ROLE_ORDER[a.role] or 9, ROLE_ORDER[b.role] or 9
    if ra ~= rb then
        return ra < rb
    end
    return a.name < b.name
end

local function byName(a, b)
    return a.name < b.name
end

-- The players of each side of a look: { { key, label, groups, players = { player, ... } } }, sorted as the look says.
-- A player is on every side whose groups hold theirs.
function DL.Sides(look, roster)
    local out = {}
    for i, side in ipairs(look.sides) do
        local inSide = {}
        for _, g in ipairs(side.groups) do
            inSide[g] = true
        end
        local players = {}
        for _, p in ipairs(roster) do
            if inSide[p.group] then
                players[#players + 1] = p
            end
        end
        table.sort(players, look.sortByRole and byRoleThenName or byName)
        out[i] = { key = side.key, label = side.label, groups = side.groups, players = players }
    end
    return out
end

-- What the display shows: { tier, any (someone has it), showAll (in use), sides = { { key, label, groups, rows =
-- { { name, unit, role, isMe, state, raw } } } } }. read(unit) gives a unit's state and raw (default DL.ReadUnit for
-- spellID); private is DL.IsPrivate's answer. private and unreadable have no rows; secret lists every player;
-- readable every player with Show every player on, else those with it.
function DL.Build(look, spellID, roster, read, private)
    read = read or function(unit)
        return DL.ReadUnit(unit, spellID)
    end
    local sides = DL.Sides(look, roster)
    local states = {}
    for _, side in ipairs(sides) do
        for _, p in ipairs(side.players) do
            if not states[p.unit] then
                local state, raw = read(p.unit)
                states[p.unit] = { state = state, raw = raw }
            end
        end
    end
    local tier, any = DL.Classify(states, private)
    local view = { tier = tier, any = any, sides = {} }
    view.showAll = tier == "secret" or look.showAll
    for i, side in ipairs(sides) do
        local rows = {}
        if tier == "readable" or tier == "secret" then
            for _, p in ipairs(side.players) do
                local st = states[p.unit]
                if view.showAll or st.state == "on" then
                    rows[#rows + 1] = { name = p.name, unit = p.unit, role = p.role, isMe = p.isMe, state = st.state, raw = st.raw }
                end
            end
        end
        view.sides[i] = { key = side.key, label = side.label, groups = side.groups, rows = rows }
    end
    return view
end

-- The heading of a side: "Left: groups 1, 3".
function DL.Heading(side)
    local g = side.groups or {}
    return string.format(#g == 1 and "%s: group %s" or "%s: groups %s", side.label, DL.GroupsText(g))
end

-- The debuff lists of a boss, for a difficulty group (nil: every one).
function DL.Entries(enc, group)
    local S = Special()
    local out = {}
    if not (S and S.List) then
        return out
    end
    for _, e in ipairs(S:List(enc, group)) do
        if S.IsDebuffList(e) then
            out[#out + 1] = e
        end
    end
    return out
end

DL.MAX_GROUP = MAX_GROUP
