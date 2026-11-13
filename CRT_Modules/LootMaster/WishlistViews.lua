local ADDON, CRT = ...

-- The Wishlists tab's numbers (Issue #1269), with no frames: LootMaster/WishlistTab.lua draws them.
--   Raiders(team, layoutId)  who counts: the saved lists (LootMaster/WishlistSaved.lua), your own list, and the
--                      players in your raid with no list ("no list"); team "all" (everyone kept), "raid" (in your group
--                      now) or "team" (a saved Raid Groups layout's names, Groups:PresetNames; LayoutPick says which)
--   BossRows(raiders)  view A: per boss of the season, in route order (CRT.Bosses:RouteList), how many wants of each
--                      rank its items have, and a value (VALUE: Big 3, Small 1, Off 0.5)
--   Detail(raiders, encounterID)  view B: each item of the boss someone wants, with who wants it by rank
--   RaiderRows(raiders)           view C: per raider, B/S/O counts per boss, and how old their list is
-- Which boss drops an item comes from the Encounter Journal (W.BossLoot, the My wishlist window's reader), read once
-- for every boss and kept (Map) until the Journal's data changes (ForgetMap). Nothing here reads the Journal per row.

local LM = CRT.LootMaster
local W = LM.Wishlist

local V = {}
W.Views = V

V.VALUE = { big = 3, small = 1, off = 0.5 } -- a want's weight in a boss's value
V.OLD_DAYS = 7 -- a list older than this many days shows in the warn colour
V.TEAMS = { "all", "raid", "team" }

local DAY = 86400

local function seasonKey()
    local def = CRT.Bosses and CRT.Bosses:Current()
    return def and def.key or nil
end

-- The item map ------------------------------------------------------------------------------------------

local map -- { bosses = { { encounterID, name, items } }, byItem = { [itemID] = encounterID }, loading }

-- The season's bosses in route order, each with its Journal loot, and which boss drops each item. Worked out once;
-- loading is true while the Journal still reads some boss (it fires LM:Fire("wishlist", "loot") when it has).
function V.Map()
    if map then
        return map
    end
    local out = { bosses = {}, byItem = {}, loading = false }
    for _, def in ipairs(CRT.Bosses and CRT.Bosses:RouteList(seasonKey()) or {}) do
        local items, why = W.BossLoot(def.encounterID, false)
        if why == "loading" then
            out.loading = true
        end
        local boss = { encounterID = def.encounterID, name = def.name or tostring(def.encounterID), items = items or {} }
        out.bosses[#out.bosses + 1] = boss
        for _, it in ipairs(boss.items) do
            if out.byItem[it.id] == nil then
                out.byItem[it.id] = def.encounterID
            end
        end
    end
    map = out
    return map
end

function V.ForgetMap()
    map = nil
end

-- Who counts ---------------------------------------------------------------------------------------------

local function lower(name)
    return type(name) == "string" and name:lower() or ""
end

-- The saved Raid Groups layouts (Groups:Presets, in their saved order), or none while Raid Groups isn't loaded.
local function layouts()
    local Groups = CRT.Groups
    if not (Groups and Groups.Presets and Groups.PresetNames) then
        return {}
    end
    return Groups:Presets() or {}
end
V.Layouts = layouts

-- The layout the team filter reads: id when it is still saved, else the one in use (Groups:Active), else the first.
function V.LayoutPick(id)
    local list = layouts()
    for _, p in ipairs(list) do
        if p.id == id then
            return id
        end
    end
    local active = CRT.Groups and CRT.Groups.Active and CRT.Groups:Active()
    for _, p in ipairs(list) do
        if p.id == active then
            return active
        end
    end
    return list[1] and list[1].id or nil
end

-- The names the team filter keeps ({ [lower name] = name }), or nil for everyone kept. layoutId: the layout "team"
-- reads (V.LayoutPick).
local function teamNames(team, layoutId)
    local out = {}
    if team == "raid" then
        for _, name in ipairs(IsInGroup() and LM:Roster() or {}) do
            out[lower(name)] = name
        end
    elseif team == "team" then
        local id = V.LayoutPick(layoutId)
        for _, name in ipairs(id ~= nil and CRT.Groups:PresetNames(id) or {}) do
            out[lower(name)] = name
        end
    else
        return nil
    end
    return out
end

-- Whether the team filter can be picked: "team" needs a saved Raid Groups layout with names.
function V.HasTeam(team)
    if team ~= "team" then
        return true
    end
    for _, p in ipairs(layouts()) do
        if #CRT.Groups:PresetNames(p.id) > 0 then
            return true
        end
    end
    return false
end

-- The raiders for a team filter: { { name, class, items (nil: no list), at } }, sorted by name, those with no list
-- last. Your own list counts as yours; players in your raid (or the team) with no list are there as "no list".
-- layoutId: the Raid Groups layout "team" reads (V.LayoutPick: nil is the one in use, else the first).
function V.Raiders(team, layoutId)
    local keep = teamNames(team, layoutId)
    local out, seen = {}, {}
    local function add(name, items, at, class)
        local key = lower(name)
        if seen[key] or (keep and not keep[key]) then
            return
        end
        seen[key] = true
        out[#out + 1] = { name = name, items = items, at = at, class = class or W.ClassOf(name) }
    end
    local me = LM:Me()
    if me and W.Count() > 0 then
        local mine = {}
        for _, it in ipairs(W.Items()) do
            mine[it.id] = it.rank
        end
        add(me, mine, W.Stamp())
    end
    for name, e in pairs(W.Saved()) do
        if type(e) == "table" and type(e.items) == "table" then
            add(name, e.items, tonumber(e.at), type(e.class) == "string" and e.class or nil)
        end
    end
    -- the players in your raid (or the team) with no list
    local others = keep or teamNames("raid")
    for _, name in pairs(others) do
        add(name, nil, nil)
    end
    table.sort(out, function(a, b)
        if (a.items == nil) ~= (b.items == nil) then
            return a.items ~= nil
        end
        return lower(a.name) < lower(b.name)
    end)
    return out
end

-- Counts -------------------------------------------------------------------------------------------------

local function newCounts()
    return { big = 0, small = 0, off = 0 }
end

function V.Value(c)
    return c.big * V.VALUE.big + c.small * V.VALUE.small + c.off * V.VALUE.off
end

-- View A: one row per boss, in route order: { encounterID, name, order, big, small, off, value }.
function V.BossRows(raiders)
    local m = V.Map()
    local rows, byBoss = {}, {}
    for i, boss in ipairs(m.bosses) do
        local row = newCounts()
        row.encounterID, row.name, row.order = boss.encounterID, boss.name, i
        rows[#rows + 1] = row
        byBoss[boss.encounterID] = row
    end
    for _, r in ipairs(raiders) do
        for id, rank in pairs(r.items or {}) do
            local row = byBoss[m.byItem[id] or false]
            if row and row[rank] then
                row[rank] = row[rank] + 1
            end
        end
    end
    for _, row in ipairs(rows) do
        row.value = V.Value(row)
    end
    return rows
end

-- View A's order: route order (key nil), or by value, big, small or off (dir 1 low to high, -1 high to low); ties
-- keep route order.
function V.SortBossRows(rows, key, dir)
    local out = {}
    for i, r in ipairs(rows) do
        out[i] = r
    end
    table.sort(out, function(a, b)
        if key and a[key] ~= nil and a[key] ~= b[key] then
            if (dir or 1) < 0 then
                return a[key] > b[key]
            end
            return a[key] < b[key]
        end
        return a.order < b.order
    end)
    return out
end

-- View B: the boss's items someone wants, most value first (then the Journal's order):
-- { item = { id, name, link, icon, quality }, wants = { big = { raider, ... }, small, off }, value }.
function V.Detail(raiders, encounterID)
    local m = V.Map()
    local boss
    for _, b in ipairs(m.bosses) do
        if b.encounterID == encounterID then
            boss = b
        end
    end
    if not boss then
        return {}
    end
    local rows = {}
    for i, it in ipairs(boss.items) do
        local wants, c = { big = {}, small = {}, off = {} }, newCounts()
        for _, r in ipairs(raiders) do
            local rank = r.items and r.items[it.id]
            if rank and wants[rank] then
                table.insert(wants[rank], r)
                c[rank] = c[rank] + 1
            end
        end
        if c.big + c.small + c.off > 0 then
            rows[#rows + 1] = { item = it, wants = wants, value = V.Value(c), order = i }
        end
    end
    table.sort(rows, function(a, b)
        if a.value ~= b.value then
            return a.value > b.value
        end
        return a.order < b.order
    end)
    return rows
end

-- How many whole days ago a stamp was (0 today), or nil.
function V.Age(at)
    if type(at) ~= "number" or at <= 0 then
        return nil
    end
    return math.max(0, math.floor((time() - at) / DAY))
end

-- View C: one row per raider: { name, class, noList, counts = { [encounterID] = { big, small, off } } (bosses with
-- any want only), age (days), old (older than OLD_DAYS) }.
function V.RaiderRows(raiders)
    local m = V.Map()
    local rows = {}
    for _, r in ipairs(raiders) do
        local row = { name = r.name, class = r.class, noList = r.items == nil, counts = {} }
        for id, rank in pairs(r.items or {}) do
            local boss = m.byItem[id]
            if boss and W.IsRank(rank) then
                local c = row.counts[boss] or newCounts()
                c[rank] = c[rank] + 1
                row.counts[boss] = c
            end
        end
        row.age = not row.noList and V.Age(r.at) or nil
        row.old = row.age ~= nil and row.age > V.OLD_DAYS
        rows[#rows + 1] = row
    end
    return rows
end
