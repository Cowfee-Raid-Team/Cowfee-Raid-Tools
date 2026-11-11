local ADDON, CRT = ...

-- The Interrupts page's players (Interrupts/Page.lua builds it through Page.BuildPalette): the panel on the right of
-- Assignments, the note editor's own (Notes/Palette.lua: Palette.Build and Palette.Draw): a Players heading with its
-- (?), Search, Players from (Current group, then each Raid Groups layout; no invite list, a kick list has no note),
-- then that source's Players, General, Groups and Classes as chips, class coloured with their class icons. The choice
-- is saved (CRTDB.interrupts.playersFrom); a layout that is gone falls back to Current group. A chip dragged onto a
-- group's row fills its next slot (Interrupts/PageGrid.lua takes the drop): a player's chip adds that player, a General,
-- Group or Class chip every player of the chosen roster it matches (Page.MatchingPlayers).
--
-- The group, the Players from choices and the chosen source's players are worked out once and kept (Page.Cache,
-- Page.Players) until the group changes (GROUP_ROSTER_UPDATE), a Raid Groups layout changes (Groups:OnChange), combat
-- or a pull ends (PLAYER_REGEN_ENABLED, ENCOUNTER_END: a name read as secret can be read again) or another boss is
-- shown (Page.ClearCache); another source works out only its own players. A group read with a name or class unreadable
-- is read again on the next draw, and so is the current group's palette read in combat (Palette.LiveRoster gives none
-- there). The page, its rows, the palette and Who has it all read the same copy. Page.counts counts the work, for the
-- harness and /crt dev kicks perf.
-- Who has it and the rows' class colours read the Addon check's roster (Page.Roster, Page.MemberOf); the palette reads
-- the note editor's sources (Notes/EditModel.lua: Model.Sources through Palette.Choices, Palette.Roster).

local UI = CRT.UI
local Interrupts = CRT.Interrupts
local Palette = CRT.NotePalette
local Model = CRT.NoteEditModel
local Parser = CRT.NoteParser
local Page = CRT.InterruptsPage

local TEXT = {
    players = "Players",
    playersHelp = "Pick who is listed in Players from: your group or a Raid Groups layout.\n\nDrag a player onto a group's row to give them its next kick. Drag a name along its row to change the order, or onto another group's row to move it there. Click x on a name to take it off.\n\nDrag a General, Group or Class chip onto a row to add every matching player from the list you picked, in its order. Anyone already on the row is skipped, and the row takes no more than its slots. Melee and Ranged add only players CRT can place: tanks, players whose spec it has seen, and classes that are melee or ranged in every spec.\n\nIn a group, only the raid leader and assistants can change the list. Solo, the list is yours to test with.",
}
Page.PaletteText = TEXT

local LAYOUT = {
    headY = -8, top = -32, bottom = 8, -- the heading, then the shared palette (Search, Players from, the chips) under it
}
Page.PaletteLayout = LAYOUT

-- A Raid Groups layout's slot is (group - 1) * 5 + its place in the group (Groups/Data.lua).
local GROUP_SIZE = 5

local L = Page.LAYOUT

Page.counts = { roster = 0, layouts = 0, players = 0, refresh = 0, note = 0 }
local cache -- { roster, byName, choices, dirty, players, source, playersDirty }, or nil until asked again

-- A value that is there and not secret (CRT.Comm.Readable); secret: a value the game hides, nil or not.
local function readable(v)
    return CRT.Comm.Readable(v)
end

local function secret(v)
    return CRT.Comm.IsSecret(v) and true or false
end

-- A player's class: the one Raid Groups stored for the name, else the shared class lookup the notes use.
local function classOf(name)
    local stored = CRT.db and CRT.db.classCache
    if type(stored) == "table" then
        local class = stored[name:lower()] or stored[Interrupts.CleanName(name):lower()]
        if class then
            return class
        end
    end
    local lookup = Palette.ClassLookup()
    return lookup and lookup(name) or nil
end

-- How many the group has, or nil when the game can't say.
local function groupSize()
    local ok, n
    if IsInRaid and IsInRaid() then
        ok, n = pcall(GetNumGroupMembers)
    elseif IsInGroup and IsInGroup() then
        ok, n = pcall(GetNumSubgroupMembers)
        n = ok and type(n) == "number" and n + 1 or n
    else
        return 1
    end
    return ok and readable(n) and type(n) == "number" and n or nil
end

-- The group: { { name (no realm), class, row (the Addon check's) } }, sorted by name; and whether it is whole (every
-- member's name and class readable). The Addon check leaves out a name it can't read (a secret one) and a class it
-- can't read is nil: such a group is used, never kept.
local function readRoster()
    Page.counts.roster = Page.counts.roster + 1
    local rows = CRT.AddonCheck and CRT.AddonCheck:Roster() or {}
    local out, whole = {}, true
    for _, row in ipairs(rows) do
        out[#out + 1] = { name = Interrupts.CleanName(row.name), class = row.class, row = row }
        if not row.class then
            whole = false
        end
    end
    local size = groupSize()
    if size == nil or #rows < size then
        whole = false
    end
    table.sort(out, function(a, b)
        return a.name:lower() < b.name:lower()
    end)
    return out, whole
end

-- The Players from choices: Current group, then every Raid Groups layout (Model.Sources), no invite list.
local function readChoices()
    Page.counts.layouts = Page.counts.layouts + 1
    return Palette.Choices(nil, true)
end

-- Each name's raid group in a layout's slots: lower-case name -> group.
local function layoutGroups(from)
    local preset = Palette.FindLayout(from)
    local slots = preset and type(preset.slots) == "table" and preset.slots or {}
    local out = {}
    for i, key in pairs(slots) do
        if type(i) == "number" and type(key) == "string" and key ~= "" then
            local g, lower = math.ceil(i / GROUP_SIZE), key:lower()
            if not out[lower] or g < out[lower] then
                out[lower] = g
            end
        end
    end
    return out
end

-- A role set by hand on Raid Groups for a name, or nil.
local function handRole(key)
    local Groups = CRT.Groups
    if not (Groups and Groups.HandRole) then
        return nil
    end
    local ok, role = pcall(Groups.HandRole, key)
    return ok and role or nil
end

-- The chosen source's players in its own order (the group's raid order, a layout's slots): { key, class, role,
-- subgroup } (Palette.Roster). The group's raid groups and roles are the game's; a layout's group is its slot's, its
-- role the one set by hand on Raid Groups, else the last seen. Returns them, and whether to read them again on the next
-- draw (the current group in combat, which Palette.LiveRoster leaves empty).
local function readPlayers(from)
    Page.counts.players = Page.counts.players + 1
    local list = Palette.Roster(from, nil, classOf)
    if from == Model.SOURCE_GROUP then
        return list, (InCombatLockdown and InCombatLockdown()) and true or false
    end
    local groups = layoutGroups(from)
    for _, p in ipairs(list) do
        p.subgroup = groups[p.key:lower()]
        p.role = handRole(p.key) or p.role
    end
    return list, false
end

-- The group and the Players from choices, worked out the first time they are asked for after a change. A group read
-- while a name or class was unreadable is marked dirty: it serves the draw it was read for, and the next draw reads it
-- again (Page.DropDirty).
function Page.Cache()
    if not cache then
        local roster, whole = readRoster()
        local byName = {}
        for _, m in ipairs(roster) do
            byName[m.name:lower()] = m
        end
        cache = { roster = roster, byName = byName, choices = readChoices(), dirty = not whole }
    end
    return cache
end

-- Before each draw of the page: a dirty group is read again, and a palette read in combat.
function Page.DropDirty()
    if cache and cache.dirty then
        cache = nil
    elseif cache and cache.playersDirty then
        cache.players = nil
    end
end

function Page.ClearCache()
    cache = nil
end

function Page.Roster()
    return Page.Cache().roster
end

-- The group member with a name (case left out), or nil.
function Page.MemberOf(name)
    if type(name) ~= "string" or name == "" then
        return nil
    end
    return Page.Cache().byName[name:lower()]
end

-- The class a chip's name is coloured in: the group's, else the stored or shared class lookup.
function Page.ClassOf(name)
    local m = Page.MemberOf(name)
    if m then
        return m.class
    end
    return (type(name) == "string" and name ~= "") and classOf(name) or nil
end

-- Players from -----------------------------------------------------------------------------------------------------

-- The source the palette shows: the saved one while it can still be listed, else Current group (saved as that).
function Page.Source()
    local s = Interrupts:Settings()
    local from = s.playersFrom
    if from == nil or not Palette.ValidSource(from, true) then
        from = Model.SOURCE_GROUP
        s.playersFrom = from
    end
    return from
end

-- Picks a source (Current group or a layout that still exists) and draws the palette from it. False when it can't be
-- listed.
function Page.SetSource(key)
    if key == nil or not Palette.ValidSource(key, true) then
        return false
    end
    Interrupts:Settings().playersFrom = key
    Page.Refresh()
    return true
end

-- The chosen source's players (readPlayers), worked out once until the source or the cache changes; and the source.
function Page.Players()
    local c = Page.Cache()
    local from = Page.Source()
    if c.players == nil or c.source ~= from then
        c.players, c.playersDirty = readPlayers(from)
        c.source = from
    end
    return c.players, from
end

-- What a chip dropped on a row adds -----------------------------------------------------------------------------------
-- A kick list holds players, so a General, Group or Class chip adds the players of the chosen roster it matches. A
-- player whose role, raid group or place the source can't tell is left out.

local ROLE_OF = { tank = "TANK", healer = "HEALER", dps = "DAMAGER" } -- Model.GENERAL's role tokens

-- Melee or ranged by the note alerts' one rule (Notes/Engine.lua's Engine.Position), or nil without it.
local function position(role, spec)
    local E = CRT.NoteEngine
    if not (E and E.Position) then
        return nil
    end
    local ok, pos = pcall(E.Position, role, spec)
    return ok and (pos == "melee" or pos == "ranged") and pos or nil
end

-- A class file's classID (GetClassInfo(index) -> name, file, classID), or nil.
local function classID(class)
    local okN, n = pcall(GetNumClasses)
    for i = 1, (okN and readable(n) and type(n) == "number") and n or 0 do
        local ok, _, file, id = pcall(GetClassInfo, i)
        if ok and readable(file) and file == class and readable(id) and type(id) == "number" then
            return id
        end
    end
    return nil
end

-- A class's place when every one of its specs of a role (every spec, role nil) is on one side by Engine.Position;
-- nil when they differ or the game can't say. Kept once known (places[class:role], false: they differ). Game calls as
-- Groups/Data.lua's (C_SpecializationInfo.GetNumSpecializationsForClassID, its global alias, and
-- GetSpecializationInfoForClassID(classID, index) -> id, name, description, icon, role; warcraft.wiki.gg, read
-- 2026-11-10).
local places = {}
local function classPlace(class, role)
    local key = class .. ":" .. tostring(role)
    if places[key] ~= nil then
        return places[key] or nil
    end
    local count = (C_SpecializationInfo and C_SpecializationInfo.GetNumSpecializationsForClassID) or GetNumSpecializationsForClassID
    local id = GetNumClasses and GetClassInfo and classID(class)
    if not (id and count and GetSpecializationInfoForClassID) then
        return nil
    end
    local okN, n = pcall(count, id)
    if not (okN and readable(n) and type(n) == "number" and n > 0) then
        return nil
    end
    local found
    for i = 1, n do
        local ok, spec, _, _, _, specRole = pcall(GetSpecializationInfoForClassID, id, i)
        if not (ok and readable(spec) and readable(specRole)) then
            return nil
        end
        if type(spec) == "number" and (role == nil or specRole == role) then
            local pos = position(specRole, spec)
            if not pos or (found and found ~= pos) then
                places[key] = pos and false or nil
                return nil
            end
            found = pos
        end
    end
    places[key] = found or nil
    return found
end

-- A spec's own role (GetSpecializationInfoByID(specID) -> id, name, description, icon, role, as Groups.SpecInfo reads
-- it), or nil.
local function specRole(spec)
    if not GetSpecializationInfoByID then
        return nil
    end
    local ok, _, _, _, _, role = pcall(GetSpecializationInfoByID, spec)
    return ok and readable(role) and type(role) == "string" and role or nil
end

-- A player's place, melee or ranged: every tank melee; else by the spec last seen (Groups.CachedSpec), with that
-- spec's own role (a tank spec is melee whatever role the source has for the player), else by a class that is on one
-- side in every spec of the player's role. nil when none of these can tell.
local function placeOf(p)
    if p.role == "TANK" then
        return position("TANK", nil)
    end
    local Groups = CRT.Groups
    if Groups and Groups.CachedSpec then
        local ok, spec = pcall(Groups.CachedSpec, p.key)
        if ok and spec then
            return position(specRole(spec) or p.role, spec)
        end
    end
    return p.class and classPlace(p.class, p.role) or nil
end

-- Whether a player matches a chip: General (everyone, a role, melee or ranged), Group ("Group3") or Class.
local function matches(p, token, kind)
    if kind == "general" then
        if token == "everyone" then
            return true
        elseif ROLE_OF[token] then
            return p.role ~= nil and p.role == ROLE_OF[token]
        elseif token == "melee" or token == "ranged" then
            return placeOf(p) == token
        end
    elseif kind == "group" then
        local g = tonumber(token:match("^[Gg]roup(%d)$") or "")
        return g ~= nil and p.subgroup == g
    elseif kind == "class" then
        local class = Parser.ClassOf(token)
        return class ~= nil and p.class == class
    end
    return false
end

-- The players of the chosen roster a General, Group or Class chip matches, in the roster's order, each once and
-- without realm (as a kick slot keeps a name). Empty when nobody matches.
function Page.MatchingPlayers(token, kind)
    local out, seen = {}, {}
    if type(token) ~= "string" then
        return out
    end
    for _, p in ipairs((Page.Players())) do
        -- the group read out of combat only, its values checked once more before any compare
        if readable(p.key) and type(p.key) == "string" and not (secret(p.class) or secret(p.role) or secret(p.subgroup)) then
            local name = Interrupts.CleanName(p.key)
            if name ~= "" and not seen[name:lower()] and matches(p, token, kind) then
                seen[name:lower()] = true
                out[#out + 1] = name
            end
        end
    end
    return out
end

-- The panel -------------------------------------------------------------------------------------------------------

local drawn -- the players the palette was last drawn from

local function draw(force)
    local state = Page.dragState
    if not (state and state.paletteChild) then
        return
    end
    local players = Page.Players()
    if players == drawn and not force then
        return
    end
    drawn = players
    Palette.Draw(state, players, Palette.InnerWidth(L.rightW))
end
Page.DrawPalette = draw

function Page.BuildPalette(f)
    local state = Page.dragState
    local head = Page.Label(f, TEXT.players, "CRTFontNormal")
    head:SetPoint("TOPLEFT", L.rightX, LAYOUT.headY)
    Page.paletteHelp = UI.HelpRight(head, TEXT.players, TEXT.playersHelp)
    Page.paletteHead = head
    -- Search, Players from and the chips: the note editor's palette, in the right column
    local right = Palette.Build(f, state, {
        width = L.rightW,
        names = { search = "CowfeeRaidToolsKickSearch", scroll = "CowfeeRaidToolsKickPalette" },
        onSearch = function()
            draw(true)
        end,
        choices = function()
            return Page.Cache().choices
        end,
        get = Page.Source,
        set = Page.SetSource,
    })
    right:SetPoint("TOPLEFT", L.rightX, LAYOUT.top)
    right:SetHeight(UI.PAGE_H + L.contentY + LAYOUT.top - LAYOUT.bottom)
    Page.palette, Page.paletteScroll = right, state.paletteScroll
    -- Players from shows the choice; the chips are drawn again only when the players were worked out again
    Page.AddControl(state.from)
    Page.AddControl({ refresh = function()
        draw(false)
    end })
    -- the group or a layout changed: worked out again on the next refresh
    -- out of combat and after a pull, the names and classes that were secret can be read again
    local events = CreateFrame("Frame")
    for _, e in ipairs({ "GROUP_ROSTER_UPDATE", "PLAYER_REGEN_ENABLED", "ENCOUNTER_END" }) do
        events:RegisterEvent(e)
    end
    events:SetScript("OnEvent", function()
        Page.ClearCache()
    end)
    if CRT.Groups and CRT.Groups.OnChange then
        CRT.Groups:OnChange(function()
            Page.ClearCache()
            Page.Refresh()
        end)
    end
end
