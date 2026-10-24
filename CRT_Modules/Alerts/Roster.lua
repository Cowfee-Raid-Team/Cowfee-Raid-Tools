local ADDON, CRT = ...

-- The raid the alerts plan for: who a cooldown can be given to (the Timeline's assign menu) and who the
-- Rehearsal can preview as.
--   AlertRoster:Players()     -> { { key, name, class } } sorted by name: the names of the active Raid
--                                Groups layout (CRT.Groups:ActiveNames), or the live group when no layout is
--                                active or it is empty. key is "Name-Realm" as Groups keeps it; name is the
--                                display name (Groups.Display, Ambiguate "none": no realm on your own);
--                                class is the class file ("MAGE") from the live group when the player is in
--                                it, else from CRT.db.classCache, else nil. Values the game hides are left out.
--                                live (optional): the live group as Groups:ReadRoster gave it, when the caller has
--                                read it already, so it is read once.
--   AlertRoster:ClassOf(name) -> the class of the player with that name or key (realm optional), or nil.
-- The same list as the Timeline view's AssignRoster, so the view can read it from here unchanged.

local Roster = {}
CRT.AlertRoster = Roster

local function readable(v)
    local T = CRT.Timeline
    if T and T.readable then
        return T.readable(v)
    end
    return true
end

-- A string the game lets us read, and not empty.
local function usable(v)
    return readable(v) and type(v) == "string" and v ~= ""
end

function Roster:Players(given)
    local Groups = CRT.Groups
    if not Groups then
        return {}
    end
    local live = {}
    if given or Groups.ReadRoster then
        local ok, list = true, given
        if not given then
            ok, list = pcall(Groups.ReadRoster, Groups)
        end
        for _, entry in ipairs(ok and type(list) == "table" and list or {}) do
            if usable(entry.key) then
                live[#live + 1] = entry
            end
        end
    end
    local keys = Groups.ActiveNames and Groups:ActiveNames() or {}
    if #keys == 0 then
        for _, entry in ipairs(live) do
            keys[#keys + 1] = entry.key
        end
    end
    local lookup = Groups.MakeLookup and Groups.MakeLookup(live)
    local cache = CRT.db and CRT.db.classCache or {}
    local out = {}
    for _, key in ipairs(keys) do
        local entry = lookup and lookup(key)
        local class = entry and entry.class
        if not usable(class) then
            class = cache[key:lower()]
            if not usable(class) then
                class = nil
            end
        end
        local name = Groups.Display and Groups.Display(key) or key
        if usable(name) then
            out[#out + 1] = { key = key, name = name, class = class }
        end
    end
    table.sort(out, function(a, b)
        return a.name:lower() < b.name:lower()
    end)
    return out
end

-- The class of a player on the roster, matched by name or key, ignoring case; a name without a realm
-- matches a key with one when only one player has that name.
function Roster:ClassOf(name)
    if not usable(name) then
        return nil
    end
    local lower = name:lower()
    local base = lower:match("^[^-]+") or lower
    local found, matches = nil, 0
    for _, p in ipairs(self:Players()) do
        local key, display = p.key:lower(), p.name:lower()
        if key == lower or display == lower then
            return p.class
        end
        if (key:match("^[^-]+") or key) == base then
            found, matches = p.class, matches + 1
        end
    end
    return matches == 1 and found or nil
end
