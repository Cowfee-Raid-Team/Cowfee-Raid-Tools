local ADDON, CRT = ...

-- Interrupts: the numbering lattice (CRT.InterruptLattice). Nothing can be read off a boss's add in a raid fight
-- (its name, GUID and spells are secret), so an add is known only by when its first cast starts. Each wave has an
-- anchor moment (Interrupts/Anchor.lua finds it), and the adds' first casts land on a fixed lattice after it:
-- add 1 at anchor + firstCast, then one every spacing seconds. The slot a first cast falls into is the add's place
-- in spawn order, and perNumber adds in a row share one kick number. Pure functions, no frames and no game calls,
-- so the Node harness runs them (CRT_Dev/Tests/run_interrupts_lattice.js).
--
-- The numbers come from the boss's interrupts block in its season-pack file, read through Bosses:Get:
--   difficulty  the difficulty ID the module arms on
--   anchor      { unit (the boss unit whose casts are counted), cycle (casts in its cycle), ordinal (the cast in
--               each cycle that starts a wave), times (seconds from the pull to each wave's anchor, used while no
--               anchor has been counted) }
--   firstCast   seconds from the anchor to add 1's first cast
--   spacing     seconds between one add's first cast and the next
--   tolerance   a cast further than this from its slot is not an add of the wave
--   adds        adds per wave; perNumber  adds that share one kick number, in spawn order
--   window      a cast this long after the anchor can't belong to the wave
--   groups      the kick list's column headings and the side in the reminder ({ "Left", "Right" })
--   slots       kick numbers per group; label  the word before the number ("Kick")
--   note        optional: one line for the page's Boss (?), such as why it works on one difficulty only

local Lattice = {}
CRT.InterruptLattice = Lattice

-- The most groups and slots a block may have: what the Interrupts page's kick list fits (Interrupts/Page.lua lays out
-- MAX_GROUPS columns of MAX_SLOTS rows, and Who has it one row per name).
Lattice.MAX_GROUPS = 2
Lattice.MAX_SLOTS = 8

local EPSILON = 1e-9 -- so a cast exactly on the tolerance edge counts, whatever the float sums give

local function number(v, min)
    return type(v) == "number" and v == v and v >= (min or -math.huge) and v < math.huge
end

local function whole(v, min)
    return number(v, min) and v == math.floor(v)
end

local function copy(t)
    if type(t) ~= "table" then
        return t
    end
    local out = {}
    for k, v in pairs(t) do
        out[k] = copy(v)
    end
    return out
end

-- A boss's interrupts block, checked: a copy, or nil and what is wrong.
function Lattice.Read(raw)
    if type(raw) ~= "table" then
        return nil, "no interrupts block"
    end
    local a = raw.anchor
    if not whole(raw.difficulty, 1) then
        return nil, "difficulty is not a difficulty ID"
    end
    if type(a) ~= "table" or type(a.unit) ~= "string" or a.unit == "" then
        return nil, "anchor.unit is missing"
    end
    if not whole(a.cycle, 1) or not whole(a.ordinal, 1) or a.ordinal > a.cycle then
        return nil, "anchor.cycle and anchor.ordinal must be whole numbers, the ordinal inside the cycle"
    end
    if type(a.times) ~= "table" or #a.times < 1 then
        return nil, "anchor.times needs at least one time"
    end
    for _, t in ipairs(a.times) do
        if not number(t, 0) then
            return nil, "anchor.times holds something that isn't a time"
        end
    end
    if not number(raw.firstCast, 0) or not number(raw.spacing) or raw.spacing <= 0 or not number(raw.tolerance, 0) then
        return nil, "firstCast, spacing and tolerance must be numbers, spacing above 0"
    end
    if not number(raw.window) or raw.window <= 0 then
        return nil, "window must be above 0"
    end
    if not whole(raw.adds, 1) or not whole(raw.perNumber, 1) or not whole(raw.slots, 1) then
        return nil, "adds, perNumber and slots must be whole numbers of 1 or more"
    end
    if type(raw.groups) ~= "table" or #raw.groups < 1 then
        return nil, "groups needs at least one group"
    end
    if #raw.groups > Lattice.MAX_GROUPS or raw.slots > Lattice.MAX_SLOTS then
        return nil, "more groups or slots than the Interrupts page fits"
    end
    for _, g in ipairs(raw.groups) do
        if type(g) ~= "string" or g == "" then
            return nil, "a group's name is not text"
        end
    end
    if type(raw.label) ~= "string" or raw.label == "" then
        return nil, "label is not text"
    end
    if raw.adds > #raw.groups * raw.slots * raw.perNumber then
        return nil, "more adds than the kick list has numbers for"
    end
    return copy(raw)
end

-- The kick number of the add in slot index (0 first, in spawn or cast order): perNumber adds in a row share one.
-- nil outside the wave's adds.
function Lattice.SlotNumber(def, index)
    if index < 0 or index >= def.adds then
        return nil
    end
    return math.ceil((index + 1) / def.perNumber)
end

-- The kick number of an add whose first cast started at castTime, in the wave anchored at anchorTime, or nil when
-- the cast is on no slot of the wave.
function Lattice.Number(def, anchorTime, castTime)
    if type(def) ~= "table" or not number(anchorTime) or not number(castTime) then
        return nil
    end
    local offset = castTime - anchorTime - def.firstCast
    local index = math.floor(offset / def.spacing + 0.5)
    if index < 0 or index >= def.adds then
        return nil
    end
    if math.abs(offset - index * def.spacing) > def.tolerance + EPSILON then
        return nil
    end
    return Lattice.SlotNumber(def, index)
end

-- Seconds from the anchor to the first cast of a kick number's first add.
function Lattice.PairOffset(def, n)
    return def.firstCast + (n - 1) * def.perNumber * def.spacing
end

-- The anchor time from the fallback table for a cast at castTime, when no anchor was counted: the first
-- pullTime + times[i] the cast is at or after and less than window seconds from. nil when none.
function Lattice.Fallback(def, pullTime, castTime)
    if type(def) ~= "table" or not number(pullTime) or not number(castTime) then
        return nil
    end
    for _, t in ipairs(def.anchor.times) do
        local at = pullTime + t
        if castTime >= at and castTime - at < def.window then
            return at
        end
    end
    return nil
end
