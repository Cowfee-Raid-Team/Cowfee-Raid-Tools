local ADDON, CRT = ...

-- Interrupts: a boss's kick setups (CRT.InterruptSetup). Pure functions, no frames and no game calls, so the Node
-- harness runs them (CRT_Dev/Tests/run_interrupts_setup.js).
--
-- A boss file's interrupts block is a list of setups, one per difficulty (the crt-season-data skill's "Kick setups"):
--   interrupts = {
--       {
--           difficulty = 16,                       -- the difficulty ID it arms on
--           label = "Kick",                        -- optional: the word before the number ("Kick #3"), "Kick" when left out
--           spell = { name = "Wail of Terror", spellID = 1234 }, -- optional: what is kicked; the ID once known
--           groups = {                             -- the kick list's columns, in order
--               { key = "skull", label = "Skull add", marker = 8, slots = 4 },
--               { key = "cross", label = "Cross add", marker = 7, slots = 4 },
--           },
--           timing = { ... },                      -- optional: Interrupts/Lattice.lua's fields
--           note = "...",                          -- optional: one line for the page's Boss (?)
--       },
--   }
-- A group's key names its list in the saved data and in a share, so it never changes once shipped: letters, digits
-- and _, starting with a letter. marker is a raid marker (1 Star to 8 Skull): a group's numbers show only on the
-- add with its marker. A setup without timing needs one on every group (it is how the group's add is found); a timed
-- setup's groups may have none. A setup with timing numbers adds by when their first cast lands
-- (Lattice.lua); one without is an untimed list in kick order, its numbers advancing on each cast of the marked add.
-- A player's own setup (Edit setup on the page, CRTDB.interrupts.setups) has the same fields and no timing.
--
-- The shape of a setup travels in a share (Interrupts/Comm.lua), so a raider without the setup still reads the list:
--   key:marker:slots:label/key:marker:slots:label   (marker 0 for none; a label without : / | , ; or line ends)
-- A setup made from a share's shape is untimed, so each of its groups needs a marker, and only a raid difficulty
-- (SHARE_DIFFICULTIES: Normal, Heroic, Mythic) is taken from a share.

local Setup = {}
CRT.InterruptSetup = Setup

Setup.MAX_GROUPS = 8 -- one per raid marker
Setup.MAX_SLOTS = 10
Setup.LABEL = "Kick"
Setup.MARKERS = { "Star", "Circle", "Diamond", "Triangle", "Moon", "Square", "Cross", "Skull" }
Setup.KEY_MAX = 16
Setup.SHARE_DIFFICULTIES = { [14] = true, [15] = true, [16] = true }

local Lattice = CRT.InterruptLattice

local function whole(v, min, max)
    return type(v) == "number" and v == v and v == math.floor(v) and v >= min and v <= (max or math.huge)
end

local function text(v)
    return type(v) == "string" and v:match("^%s*(.-)%s*$") ~= ""
end

-- A label fit for a share and a note: trimmed, without the characters that separate a share's fields.
function Setup.CleanLabel(s)
    if type(s) ~= "string" then
        return ""
    end
    s = s:gsub("[:/|,;\r\n]", " "):gsub("%s+", " ")
    return s:match("^%s*(.-)%s*$")
end

function Setup.ValidKey(key)
    return type(key) == "string" and #key <= Setup.KEY_MAX and key:match("^%a[%w_]*$") ~= nil
end

-- A key for a new group from its label ("Skull add" -> "skull_add"), not one of taken (key -> true).
function Setup.KeyFor(label, taken)
    local base = Setup.CleanLabel(label):lower():gsub("[^%w]+", "_"):gsub("^_+", ""):gsub("_+$", "")
    if not base:match("^%a") then
        base = "group" .. base
    end
    base = base:sub(1, Setup.KEY_MAX - 2)
    local key, n = base, 1
    while taken and taken[key] do
        n = n + 1
        key = base .. n
    end
    return key
end

-- The game's raid target icon as text (CRT_Core/MarkerText.lua's, the addon's one), "" for none.
function Setup.MarkerIcon(marker, size)
    if not whole(marker, 1, 8) then
        return ""
    end
    return CRT.MarkerCodes.Icon(marker, size)
end

local function readGroups(groups)
    if type(groups) ~= "table" or #groups < 1 then
        return nil, "groups needs at least one group"
    end
    if #groups > Setup.MAX_GROUPS then
        return nil, "more than " .. Setup.MAX_GROUPS .. " groups"
    end
    local out, keys, markers = {}, {}, {}
    for i, g in ipairs(groups) do
        if type(g) ~= "table" then
            return nil, "group " .. i .. " is not a table"
        end
        if not Setup.ValidKey(g.key) or keys[g.key] then
            return nil, "group " .. i .. " needs its own key (letters, digits and _)"
        end
        if not text(g.label) or Setup.CleanLabel(g.label) ~= g.label:match("^%s*(.-)%s*$") then
            return nil, "group " .. i .. "'s label is not plain text"
        end
        if g.marker ~= nil and not whole(g.marker, 1, 8) then
            return nil, "group " .. i .. "'s marker is not 1 to 8"
        end
        if g.marker and markers[g.marker] then
            return nil, "two groups have the same marker"
        end
        if not whole(g.slots, 1, Setup.MAX_SLOTS) then
            return nil, "group " .. i .. "'s slots must be 1 to " .. Setup.MAX_SLOTS
        end
        keys[g.key] = true
        if g.marker then
            markers[g.marker] = true
        end
        out[i] = { key = g.key, label = Setup.CleanLabel(g.label), marker = g.marker, slots = g.slots }
    end
    return out
end

-- One setup, checked: a copy, or nil and what is wrong.
function Setup.ReadOne(raw)
    if type(raw) ~= "table" then
        return nil, "a setup is not a table"
    end
    if not whole(raw.difficulty, 1) then
        return nil, "difficulty is not a difficulty ID"
    end
    local label = raw.label == nil and Setup.LABEL or raw.label
    if not text(label) then
        return nil, "label is not text"
    end
    local spell
    if raw.spell ~= nil then
        if type(raw.spell) ~= "table" or (raw.spell.name ~= nil and type(raw.spell.name) ~= "string")
            or (raw.spell.spellID ~= nil and not whole(raw.spell.spellID, 1)) then
            return nil, "spell needs a name and, when known, a spell ID"
        end
        spell = { name = raw.spell.name, spellID = raw.spell.spellID }
    end
    local groups, why = readGroups(raw.groups)
    if not groups then
        return nil, why
    end
    local out = { difficulty = raw.difficulty, label = Setup.CleanLabel(label), spell = spell, groups = groups,
        note = type(raw.note) == "string" and raw.note or nil }
    if raw.timing ~= nil then
        local timing, err = Lattice.Read(raw.timing, Setup.MaxSlots(out))
        if not timing then
            return nil, "timing: " .. tostring(err)
        end
        out.timing = timing
    else
        for i, g in ipairs(groups) do
            if not g.marker then
                return nil, "group " .. i .. " needs a raid marker (without timing, its add is found by it)"
            end
        end
    end
    return out
end

-- A boss's interrupts block: its setups in the order written, or nil and what is wrong. Each difficulty once.
function Setup.Read(raw)
    if type(raw) ~= "table" or #raw < 1 then
        return nil, "no setups"
    end
    local out, seen = {}, {}
    for i, entry in ipairs(raw) do
        local s, why = Setup.ReadOne(entry)
        if not s then
            return nil, "setup " .. i .. ": " .. why
        end
        if seen[s.difficulty] then
            return nil, "two setups for difficulty " .. s.difficulty
        end
        seen[s.difficulty] = true
        out[#out + 1] = s
    end
    return out
end

-- Every slot of a setup, and its most slots in a group (its kick numbers).
function Setup.Total(setup)
    local n = 0
    for _, g in ipairs(setup.groups) do
        n = n + g.slots
    end
    return n
end

function Setup.MaxSlots(setup)
    local n = 0
    for _, g in ipairs(setup.groups) do
        n = math.max(n, g.slots)
    end
    return n
end

-- The group whose marker is marker: its index and the group, or nil.
function Setup.GroupOfMarker(setup, marker)
    if not (setup and whole(marker, 1, 8)) then
        return nil
    end
    for i, g in ipairs(setup.groups) do
        if g.marker == marker then
            return i, g
        end
    end
    return nil
end

-- Shapes ----------------------------------------------------------------------------------------------------------

function Setup.Shape(setup)
    local parts = {}
    for i, g in ipairs(setup.groups) do
        parts[i] = string.format("%s:%d:%d:%s", g.key, g.marker or 0, g.slots, Setup.CleanLabel(g.label))
    end
    return table.concat(parts, "/")
end

-- A shape's groups ({ key, label, marker, slots }), or nil when it doesn't read.
function Setup.ParseShape(shape)
    if type(shape) ~= "string" or shape == "" then
        return nil
    end
    local groups = {}
    for part in (shape .. "/"):gmatch("([^/]*)/") do
        local key, marker, slots, label = part:match("^([^:]*):(%d+):(%d+):(.*)$")
        marker, slots = tonumber(marker), tonumber(slots)
        if not key then
            return nil
        end
        groups[#groups + 1] = { key = key, label = label ~= "" and label or key, marker = marker ~= 0 and marker or nil, slots = slots }
    end
    return (readGroups(groups))
end

-- An untimed setup from a share's shape, for a raider who has none for that boss and difficulty.
function Setup.FromShape(difficulty, shape, label)
    if not Setup.SHARE_DIFFICULTIES[difficulty] then
        return nil
    end
    local groups = Setup.ParseShape(shape)
    if not groups then
        return nil
    end
    return Setup.ReadOne({ difficulty = difficulty, label = text(label) and Setup.CleanLabel(label) or nil, groups = groups })
end
