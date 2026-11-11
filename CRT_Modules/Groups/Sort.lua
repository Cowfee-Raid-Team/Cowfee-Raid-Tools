local ADDON, CRT = ...

-- Raid Groups' Sort by (Groups/Page.lua) and the group changes Arrange Groups posts (Groups/Apply.lua). No frames.
-- Sort grid rewrites only the working grid, like a hand edit; it never moves anyone in the raid. It works on whoever
-- is in the grid and fills groups 1 upward, 5 per group, so 20 or fewer fit groups 1-4.
--   Sort.Read(grid)                     the grid's players, in slot order: { key, role, place, class, spec, index }
--   Sort.Arrange(method, players, opts) the new 40 slots. opts.rows: for "sides", the two rows' player keys
--   Sort.SideBlocks()                   the current season's assignment blocks with exactly two rows of players
--   Sort.SideRows(block, players)       a side block's two rows as the grid's player keys
--   Sort.Changes(before, after)         { [group] = { names } } of who is new in each group
--   Sort.ChangeLines(before, after)     the chat lines for them, split under the chat limit
-- Each method keeps the grid's order within a block of alike players (same role, place, class and spec), so sorting
-- twice gives the same grid.

local Sort = {}
CRT.GroupSort = Sort

-- Every word on the controls and in chat, in one place. Keep the keys, change the text in quotes.
local TEXT = {
    roles = "Role blocks",
    melee = "Melee and ranged groups",
    spread = "Spread duplicates",
    sides = "Left and right sides",
    noSides = "No two-row assignments",
    sideLabel = "%s: %s", -- boss: the mechanic (or the assignment's name)
    prefix = "[CRT] ", -- before every group changes line
    changes = "<Group %d Changes>: %s",
}
Sort.TEXT = TEXT

-- The methods, in the Sort by dropdown's order; the first is the default (CRTDB.groups.sortMethod).
Sort.METHODS = {
    { key = "roles", label = TEXT.roles },
    { key = "melee", label = TEXT.melee },
    { key = "spread", label = TEXT.spread },
    { key = "sides", label = TEXT.sides },
}
Sort.DEFAULT = "roles"

local GROUP_SIZE, MAX_GROUPS = 5, 8
local NUM_SLOTS = GROUP_SIZE * MAX_GROUPS
local CHAT_LIMIT = 255 -- the most a chat line can hold, the prefix included

function Sort.Valid(method)
    for _, m in ipairs(Sort.METHODS) do
        if m.key == method then
            return true
        end
    end
    return false
end

-- Reading the grid ---------------------------------------------------------------------------------------------------

-- Melee or ranged by the one rule the Interrupts palette uses (Interrupts/PagePalette.lua's Page.PlaceOf: every tank
-- melee, else the spec last seen, else a class that is one or the other in every spec), or nil when it can't tell.
local function placeOf(p)
    local page = CRT.InterruptsPage
    if not (page and page.PlaceOf) then
        return nil
    end
    local ok, pos = pcall(page.PlaceOf, p)
    return ok and (pos == "melee" or pos == "ranged") and pos or nil
end

-- The grid's players, in slot order, each once: { key, role, place, class, spec, index }. The role as the slot shows
-- it (Groups/Page.lua): set by hand (Groups.HandRole), else the game's, else the last seen; none known counts as
-- damage. The class from the group, else the class cache; the spec the last seen (Groups.CachedSpec).
function Sort.Read(grid)
    local Groups = CRT.Groups
    local lookup = Groups.MakeLookup(Groups:ReadRoster())
    local out, seen = {}, {}
    for i = 1, NUM_SLOTS do
        local key = grid[i]
        if type(key) == "string" and key ~= "" and not seen[key:lower()] then
            seen[key:lower()] = true
            local member = lookup(key)
            local role = Groups.HandRole(key) or (member and member.role) or Groups.CachedRole(key)
            if not Groups.ROLES[role] then
                role = "DAMAGER"
            end
            local class = (member and member.class) or (CRT.db.classCache and CRT.db.classCache[key:lower()])
            local p = { key = key, role = role, class = class, spec = Groups.CachedSpec and Groups.CachedSpec(key) or nil,
                index = #out + 1 }
            p.place = placeOf(p)
            out[#out + 1] = p
        end
    end
    return out
end

-- Placing ------------------------------------------------------------------------------------------------------------

local function groupsFor(n)
    return math.max(1, math.min(MAX_GROUPS, math.ceil(n / GROUP_SIZE)))
end

local function blockKey(p, tag)
    return table.concat({ p.role or "", p.place or "", p.class or "", tostring(p.spec or ""), tostring(tag and tag[p] or "") }, "|")
end

-- The 40 slots from where each player goes (at[p] = group). Players of one block (blockKey) are alike to every method,
-- so each block's groups go to its players in grid order: the grid's order within a block stays, and sorting again
-- gives the same grid. In a group, players go in rank order (rank[p]), then grid order. tag[p], when given, is part of
-- a player's block too (Left and right sides: their row).
local function toSlots(players, at, rank, tag)
    local blocks, order = {}, {}
    for _, p in ipairs(players) do
        local k = blockKey(p, tag)
        if not blocks[k] then
            blocks[k] = {}
            order[#order + 1] = k
        end
        table.insert(blocks[k], p)
    end
    for _, k in ipairs(order) do
        local list, groups = blocks[k], {}
        for i, p in ipairs(list) do
            groups[i] = at[p]
        end
        table.sort(groups)
        for i, p in ipairs(list) do -- list is in grid order already
            at[p] = groups[i]
        end
    end
    local members = {}
    for g = 1, MAX_GROUPS do
        members[g] = {}
    end
    for _, p in ipairs(players) do
        table.insert(members[at[p]], p)
    end
    local slots = {}
    for i = 1, NUM_SLOTS do
        slots[i] = ""
    end
    for g = 1, MAX_GROUPS do
        table.sort(members[g], function(a, b)
            if rank[a] ~= rank[b] then
                return rank[a] < rank[b]
            end
            return a.index < b.index
        end)
        for pos, p in ipairs(members[g]) do
            slots[(g - 1) * GROUP_SIZE + pos] = p.key
        end
    end
    return slots
end

-- The healers' groups: one per group from group 1 as far as they go, the rest from the last group back.
local function healerGroups(count, groups)
    local out = {}
    for i = 1, count do
        out[i] = (i <= groups) and i or (groups - ((i - groups - 1) % groups))
    end
    table.sort(out)
    return out
end

-- Role blocks and Melee and ranged groups: healers spread (healerGroups), then the others in seq's order fill the
-- seats left from group 1. breakAt: the first of seq that starts a new group when the rest still fit after it.
local function fill(players, seq, healers, breakAt)
    local groups = groupsFor(#players)
    local at, rank, free = {}, {}, {}
    for g = 1, groups do
        free[g] = GROUP_SIZE
    end
    for i, g in ipairs(healerGroups(#healers, groups)) do
        at[healers[i]], rank[healers[i]] = g, 1000 + i
        free[g] = free[g] - 1
    end
    local g, used = 1, 0
    for i, p in ipairs(seq) do
        if i == breakAt and used > 0 and free[g] > 0 then
            local after = 0
            for h = g + 1, groups do
                after = after + free[h]
            end
            if after >= #seq - i + 1 then
                g, used = g + 1, 0
            end
        end
        while free[g] == 0 do
            g, used = g + 1, 0
        end
        at[p], rank[p] = g, i
        free[g], used = free[g] - 1, used + 1
    end
    return toSlots(players, at, rank)
end

local function split(players)
    local tanks, healers, melee, ranged, unknown = {}, {}, {}, {}, {}
    for _, p in ipairs(players) do
        if p.role == "TANK" then
            tanks[#tanks + 1] = p
        elseif p.role == "HEALER" then
            healers[#healers + 1] = p
        elseif p.place == "melee" then
            melee[#melee + 1] = p
        elseif p.place == "ranged" then
            ranged[#ranged + 1] = p
        else
            unknown[#unknown + 1] = p
        end
    end
    return tanks, healers, melee, ranged, unknown
end

local function join(...)
    local out = {}
    for _, list in ipairs({ ... }) do
        for _, p in ipairs(list) do
            out[#out + 1] = p
        end
    end
    return out
end

-- Tanks first, then melee, then ranged (then damage it can't place), healers one per group.
local function roleBlocks(players)
    local tanks, healers, melee, ranged, unknown = split(players)
    return fill(players, join(tanks, melee, ranged, unknown), healers)
end

-- Tanks and melee in the first groups, ranged (and damage it can't place) from the next group, healers one per group.
local function meleeGroups(players)
    local tanks, healers, melee, ranged, unknown = split(players)
    local front = #tanks + #melee
    return fill(players, join(tanks, melee, ranged, unknown), healers, (front > 0 and front < #players - #healers) and front + 1 or nil)
end

-- Spread duplicates: tanks, then healers, then damage, each into the group with the fewest of its role (tanks and
-- healers), then of its class, then of its spec, then the fewest players, then the lowest number. Players go in an
-- order that doesn't depend on the grid (the most common class first), so the result is the same on a sorted grid.
local ROLE_RANK = { TANK = 1, HEALER = 2, DAMAGER = 3 }
local function spread(players)
    local groups = groupsFor(#players)
    local classCount = {}
    for _, p in ipairs(players) do
        if p.class then
            classCount[p.class] = (classCount[p.class] or 0) + 1
        end
    end
    local order = {}
    for i, p in ipairs(players) do
        order[i] = p
    end
    table.sort(order, function(a, b)
        local ra, rb = ROLE_RANK[a.role] or 3, ROLE_RANK[b.role] or 3
        if ra ~= rb then
            return ra < rb
        end
        local ca, cb = classCount[a.class] or 0, classCount[b.class] or 0
        if ca ~= cb then
            return ca > cb
        end
        if (a.class or "") ~= (b.class or "") then
            return (a.class or "") < (b.class or "")
        end
        if (a.spec or math.huge) ~= (b.spec or math.huge) then
            return (a.spec or math.huge) < (b.spec or math.huge)
        end
        if (a.place or "") ~= (b.place or "") then
            return (a.place or "") < (b.place or "")
        end
        return a.index < b.index
    end)
    local size, roles, classes, specs = {}, {}, {}, {}
    for g = 1, groups do
        size[g], roles[g], classes[g], specs[g] = 0, {}, {}, {}
    end
    local at, rank = {}, {}
    for n, p in ipairs(order) do
        local best, bestCost
        for g = 1, groups do
            if size[g] < GROUP_SIZE then
                local cost = {
                    p.role ~= "DAMAGER" and (roles[g][p.role] or 0) or 0,
                    p.class and (classes[g][p.class] or 0) or 0,
                    p.spec and (specs[g][p.spec] or 0) or 0,
                    size[g],
                }
                local better = not bestCost
                if not better then
                    for k = 1, #cost do
                        if cost[k] ~= bestCost[k] then
                            better = cost[k] < bestCost[k]
                            break
                        end
                    end
                end
                if better then
                    best, bestCost = g, cost
                end
            end
        end
        at[p], rank[p] = best, n
        size[best] = size[best] + 1
        roles[best][p.role] = (roles[best][p.role] or 0) + 1
        if p.class then
            classes[best][p.class] = (classes[best][p.class] or 0) + 1
        end
        if p.spec then
            specs[best][p.spec] = (specs[best][p.spec] or 0) + 1
        end
    end
    return toSlots(players, at, rank)
end

-- Left and right sides: the first row's players in groups 1-2, the second row's in 3-4 (in grid order); everyone else
-- evens the two sides out (Alex, 2026-11-11): the first of them in grid order to the side with fewer, the rest to the
-- other, so on a sorted grid the same ones go to the same side; past both sides' 10 seats, from group 5. A player in
-- both rows counts in the first; more than a side's 10 seats go with everyone else.
local function sides(players, rows)
    local side = {}
    for r = 2, 1, -1 do
        for _, key in ipairs(rows and rows[r] or {}) do
            side[key:lower()] = r
        end
    end
    local free = {}
    for g = 1, MAX_GROUPS do
        free[g] = GROUP_SIZE
    end
    local at, rank, rest = {}, {}, {}
    local n = 0
    local function seat(p, first, last)
        for g = first, last do
            if free[g] > 0 then
                n = n + 1
                at[p], rank[p] = g, n
                free[g] = free[g] - 1
                return true
            end
        end
        return false
    end
    for r = 1, 2 do
        for _, p in ipairs(players) do
            if side[p.key:lower()] == r and not seat(p, 2 * r - 1, 2 * r) then
                rest[#rest + 1] = p
            end
        end
    end
    for _, p in ipairs(players) do
        if not side[p.key:lower()] then
            rest[#rest + 1] = p
        end
    end
    table.sort(rest, function(a, b)
        return a.index < b.index
    end)
    -- how many of the rest go left: as many as make the sides even (an odd one goes left), within each side's seats
    local leftFree, rightFree = free[1] + free[2], free[3] + free[4]
    local leftHas, rightHas = 2 * GROUP_SIZE - leftFree, 2 * GROUP_SIZE - rightFree
    local toLeft = math.ceil((rightHas - leftHas + #rest) / 2)
    toLeft = math.max(0, math.min(toLeft, #rest, leftFree))
    if #rest - toLeft > rightFree then
        toLeft = math.min(#rest, leftFree, #rest - rightFree)
    end
    local tag = {}
    for i, p in ipairs(rest) do
        local placed
        if i <= toLeft then
            placed = seat(p, 1, 2)
        else
            placed = seat(p, 3, 4)
        end
        if not placed then
            seat(p, 5, MAX_GROUPS)
        end
        tag[p] = "rest"
    end
    for _, p in ipairs(players) do
        tag[p] = tag[p] or side[p.key:lower()]
    end
    return toSlots(players, at, rank, tag)
end

-- The new 40 slots for method ("roles", "melee", "spread" or "sides"), from players (Sort.Read). opts.rows: for
-- "sides", the two rows as player keys (Sort.SideRows). Nil for a method it doesn't know.
function Sort.Arrange(method, players, opts)
    if method == "roles" then
        return roleBlocks(players)
    elseif method == "melee" then
        return meleeGroups(players)
    elseif method == "spread" then
        return spread(players)
    elseif method == "sides" then
        return sides(players, opts and opts.rows)
    end
    return nil
end

-- Left and right sides' blocks ---------------------------------------------------------------------------------------

-- Whether an assignment row's word names a player: not a role, everyone or group word, and not a class (Notes/Parse.lua).
local function isPlayer(token)
    local Parser = CRT.NoteParser
    if type(token) ~= "string" or token == "" then
        return false
    end
    local lower = token:lower()
    if Parser then
        if (Parser.TAG_WORDS and Parser.TAG_WORDS[lower]) or (Parser.GROUP_WORDS and Parser.GROUP_WORDS[lower]) then
            return false
        end
        if Parser.ClassOf and Parser.ClassOf(token) then
            return false
        end
    end
    return not (lower:match("^g%d$") or lower:match("^grp%d$") or lower:match("^group%d$"))
end

-- A block's mechanic as a name: its spell's name when the block names one by its spell (for:, MechNote.Key), else the
-- block's heading, which is the mechanic's name unless renamed (a mechanic named by name is kept in lower case).
local function mechanicName(block, key)
    local spell = tonumber(block.mech or "")
    local Notes = CRT.Notes
    if spell and Notes and Notes.SpellInfo then
        local ok, info = pcall(Notes.SpellInfo, Notes, spell)
        if ok and info and type(info.name) == "string" and info.name ~= "" then
            return info.name
        end
    end
    return block.name or key
end

-- The current season's assignment blocks (the Assign tab's, Notes/Assign.lua) with exactly two rows that name players,
-- in the route's order: { id, label ("<Boss>: <mechanic>"), rows = { { names }, { names } } }. Each boss's block is read
-- from the shared note its Mythic pull runs (Notes:FindForEncounter). A row of only role, group or class words is not
-- a row of players; those words are left out of a row.
function Sort.SideBlocks()
    local out = {}
    local Bosses, Notes, Assign = CRT.Bosses, CRT.Notes, CRT.NoteAssign
    local season = Bosses and Bosses.Current and Bosses:Current()
    if not (season and Notes and Assign) then
        return out
    end
    for _, def in ipairs(Bosses:RouteList(season.key)) do
        local id = Notes:FindForEncounter(def.encounterID, "Mythic")
        local record = id and Notes:Get(id)
        local raw = record and record.raw
        if type(raw) == "string" and raw ~= "" then
            local okKeys, keys = pcall(Assign.Keys, raw)
            for _, key in ipairs(okKeys and keys or {}) do
                local ok, block = pcall(Assign.Read, raw, key)
                if ok and block then
                    local rows = {}
                    for _, row in ipairs(block.rows or {}) do
                        local names = {}
                        for _, token in ipairs(row.tokens or {}) do
                            if isPlayer(token) then
                                names[#names + 1] = token
                            end
                        end
                        if #names > 0 then
                            rows[#rows + 1] = names
                        end
                    end
                    if #rows == 2 then
                        out[#out + 1] = { id = def.encounterID .. ":" .. key,
                            label = string.format(TEXT.sideLabel, def.name, mechanicName(block, key)), rows = rows }
                    end
                end
            end
        end
    end
    return out
end

-- A side block's two rows as the keys of the grid's players they name. A block writes names without their realms
-- (Notes/Assign.lua), so a name matches a grid player by Name-Realm, or by name alone when only one grid player has it
-- (as Groups.MakeLookup). Names not in the grid, or that two grid players share, are left out.
function Sort.SideRows(block, players)
    local byKey, byBase = {}, {}
    for _, p in ipairs(players) do
        local lower = p.key:lower()
        byKey[lower] = p.key
        local base = lower:match("^[^-]+") or lower
        byBase[base] = (byBase[base] == nil) and p.key or false
    end
    local rows = { {}, {} }
    for r = 1, 2 do
        for _, name in ipairs(block and block.rows and block.rows[r] or {}) do
            local lower = name:lower()
            local key = byKey[lower] or byBase[lower]
            if key then
                rows[r][#rows[r] + 1] = key
            end
        end
    end
    return rows
end

-- Group changes ------------------------------------------------------------------------------------------------------

-- Who is new in each group: before = { [key] = group } before Arrange Groups, after = { { key, name, subgroup } } after
-- it, in raid order. Returns { [group] = { name, ... } }, a group with no one new left out.
function Sort.Changes(before, after)
    local out = {}
    for _, m in ipairs(after) do
        if m.subgroup and before[m.key] ~= m.subgroup then
            out[m.subgroup] = out[m.subgroup] or {}
            table.insert(out[m.subgroup], m.name)
        end
    end
    return out
end

-- Splits a line longer than max at the commas, as the ready check report does.
local function chunks(line, max)
    local Report = CRT.RaidReport
    if Report and Report.Chunks then
        return Report.Chunks(line, max)
    end
    return { line }
end

-- The chat lines for the changes, in group order: "[CRT] <Group N Changes>: Name, Name", each split at the commas so
-- every line, the prefix included, fits the chat limit. None when nothing changed.
function Sort.ChangeLines(before, after)
    local changes = Sort.Changes(before, after)
    local out = {}
    for g = 1, MAX_GROUPS do
        if changes[g] then
            local line = string.format(TEXT.changes, g, table.concat(changes[g], ", "))
            for _, part in ipairs(chunks(line, CHAT_LIMIT - #TEXT.prefix)) do
                out[#out + 1] = TEXT.prefix .. part
            end
        end
    end
    return out
end
