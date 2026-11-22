local ADDON, CRT = ...

-- Player names as CRT draws them. Every name a player reads (labels, tooltips, lists, menus, the lines CRT
-- prints or posts) is the short name, "Thisisfartaa" for "Thisisfartaa-Kil'jaeden": call CRT.ShortName at the
-- moment of drawing. The full Name-Realm stays everywhere a name does something: invites, whispers, group
-- moves, addon messages, saved keys and lookups, so two players of one name on different realms stay two.
-- Raid Groups and the Late Tracker keep their own rules (Groups.Display, Groups.ReportName).
-- Notes/Parse.lua's Parser.StripRealm is apart: it decides which words of a note's text are names.
-- Game API: issecretvalue (a combat value the game hides; never indexed or changed here).

-- Whether v is a value the game hides. Guarded: the function is missing on older clients.
local function secret(v)
    if not issecretvalue then
        return false
    end
    local ok, hidden = pcall(issecretvalue, v)
    return ok and hidden == true
end

-- The name without its realm: everything before the first "-". A secret value, nil, a non-string or a name
-- with nothing before the "-" comes back as given.
function CRT.ShortName(name)
    if type(name) ~= "string" or secret(name) then
        return name
    end
    local base = name:match("^([^%-]+)%-")
    return base or name
end
