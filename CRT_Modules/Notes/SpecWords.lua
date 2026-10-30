local ADDON, CRT = ...

-- Spec words: a note line's tag word that names a spec, as a class word names a class (Parse.lua). The one table
-- of them, read by the alerts (Notes/Engine.lua IsMine), the rendered note (Notes/Render.lua) and Healer CDs'
-- healer slots (Timeline/HealerSlots.lua, Timeline/HealerView.lua):
--   Specs.List()                  every spec word's entry, in menu order: { word, spec, class, label }
--   Specs.ByID(spec)              the entry of a SpecializationID, or nil
--   Specs.Read(word)              the entry a tag word names and its slot number, or nil: "RestoDruid",
--                                 "restodruid" and "RESTODRUID2" (slot 2) in any case; a number of 0 is no slot
--   Specs.Word(spec, n)           the word written for it: "RestoDruid", or "RestoDruid2" for slot 2
--   Specs.Label(spec, n)          the words shown for it: "Resto Druid", "Resto Druid 2"
--   Specs.Players(spec)           the roster's players known to play it: you by the game, anyone else by the
--                                 spec seen last (Groups.CachedSpec); unknown spec is nobody's
--   Specs.Matching(e, n, info)    who a spec word means (below)
--   Specs.Mark(note)              gives a parsed note's timers with a spec word the note's slot counts (Parse.lua)
-- Who a word means: a word with no number means every player of that spec, as a class word does. A numbered word
-- ("RestoDruid2") is a healer slot no player was assigned to yet (an assigned slot writes its player's name), so it
-- means a player only when that is not in doubt: the one player of that spec in the raid, while the boss has only one
-- slot of that spec. The boss's slots are the more of the ones planned on this computer (CRTDB.timeline.healerSlots,
-- Timeline/HealerSlots.lua) and the slot numbers the note itself names, so a raider who never planned the boss reads
-- the same answer from the note. More specs are more rows of SPECS, never more code. SpecializationIDs are from
-- warcraft.wiki.gg/wiki/SpecializationID, as the season's GameIDs.lua cites them.

local Specs = {}
CRT.NoteSpecs = Specs

local SPECS = {
    { word = "RestoDruid", spec = 105, class = "DRUID", label = "Resto Druid" },
    { word = "PresEvoker", spec = 1468, class = "EVOKER", label = "Preservation Evoker" },
    { word = "Mistweaver", spec = 270, class = "MONK", label = "Mistweaver Monk" },
    { word = "HolyPaladin", spec = 65, class = "PALADIN", label = "Holy Paladin" },
    { word = "DiscPriest", spec = 256, class = "PRIEST", label = "Disc Priest" },
    { word = "HolyPriest", spec = 257, class = "PRIEST", label = "Holy Priest" },
    { word = "RestoShaman", spec = 264, class = "SHAMAN", label = "Resto Shaman" },
}

local byWord, byID = {}, {}
for _, e in ipairs(SPECS) do
    byWord[e.word:lower()] = e
    byID[e.spec] = e
end

local KEEP_SECONDS = 5 -- how long the players of each spec are kept, as Engine.lua keeps the words that match you

local function readable(v)
    return not (issecretvalue and issecretvalue(v))
end

local function usable(v)
    return readable(v) and type(v) == "string" and v ~= ""
end

function Specs.List()
    return SPECS
end

function Specs.ByID(spec)
    return type(spec) == "number" and byID[spec] or nil
end

function Specs.Read(word)
    if not usable(word) then
        return nil
    end
    local base, digits = word:match("^(%a+)(%d*)$")
    local e = base and byWord[base:lower()]
    if not e then
        return nil
    end
    local n = digits ~= "" and tonumber(digits) or nil
    if n == 0 then
        return nil
    end
    return e, n
end

function Specs.Word(spec, n)
    local e = byID[spec]
    return e and (e.word .. (n and tostring(n) or "")) or nil
end

function Specs.Label(spec, n)
    local e = byID[spec]
    return e and (e.label .. (n and (" " .. tostring(n)) or "")) or nil
end

-- The players ------------------------------------------------------------------------------------------

local kept, keptAt = nil, nil

-- Forgets the players kept, so the next question reads the roster and the specs again.
function Specs.Reset()
    kept, keptAt = nil, nil
end

local function now()
    return GetTime and GetTime() or 0
end

-- Your own key ("Name-Realm", lower case), or nil.
local function selfKey()
    local Groups = CRT.Groups
    if not (Groups and Groups.Normalize and UnitName) then
        return nil
    end
    local ok, name = pcall(UnitName, "player")
    if not (ok and usable(name)) then
        return nil
    end
    local key = Groups.Normalize(name)
    return key ~= "" and key:lower() or nil
end

-- spec -> { { key, name, class, me } } for every roster player whose spec is known.
local function readPlayers()
    local Roster, Groups = CRT.AlertRoster, CRT.Groups
    local out = {}
    if not (Roster and Roster.Players and Groups) then
        return out
    end
    local ok, list = pcall(Roster.Players, Roster)
    local me = selfKey()
    for _, p in ipairs(ok and type(list) == "table" and list or {}) do
        local isMe = me ~= nil and p.key:lower() == me
        local spec
        if isMe and Groups.PlayerSpecID then
            spec = Groups.PlayerSpecID()
        elseif Groups.CachedSpec then
            spec = Groups.CachedSpec(p.key)
        end
        if spec and byID[spec] then
            out[spec] = out[spec] or {}
            local bucket = out[spec]
            bucket[#bucket + 1] = { key = p.key, name = p.name, class = p.class or byID[spec].class, me = isMe }
        end
    end
    return out
end

function Specs.Players(spec)
    if not (kept and keptAt and now() - keptAt < KEEP_SECONDS) then
        kept, keptAt = readPlayers(), now()
    end
    return kept[spec] or {}
end

-- How many slots of spec the boss has: the more of those planned here and the numbers the note names. info is
-- the note's (Specs.Mark), or nil.
local function slotCount(spec, info)
    local fromNote = info and info.counts and info.counts[spec] or 0
    local Slots = CRT.TimelineHealerSlots
    local planned = info and info.encounterID and Slots and Slots.CountOf and Slots.CountOf(info.encounterID, spec) or 0
    return math.max(fromNote, planned)
end

-- The players spec word e (slot n, or nil for no number) means: every player of its spec, or for a numbered word
-- the one player of its spec while the boss has one slot of it, else nobody. info: the note's slot counts.
function Specs.Matching(e, n, info)
    local players = Specs.Players(e.spec)
    if n == nil then
        return players
    end
    if #players == 1 and slotCount(e.spec, info) <= 1 then
        return players
    end
    return {}
end

-- How a note shows spec word `word` (the rendered note, Notes/Render.lua, and the timers window, Notes/Window.lua):
-- the one player it means when exactly one is known, else its label, with the class to colour it in. Returns the
-- text, the class file and the player ({ key, name, class, me }) or nil; nil for any other word. info: the note's
-- slot counts; who (optional): Matching's stand-in.
function Specs.Display(word, info, who)
    local e, n = Specs.Read(word)
    if not e then
        return nil
    end
    local list = (who or Specs.Matching)(e, n, info)
    local p = #list == 1 and usable(list[1].name) and list[1] or nil
    if p then
        return p.name, p.class or e.class, p
    end
    return Specs.Label(e.spec, n), e.class, nil
end

-- Gives every timer of a parsed note whose tags hold a spec word the note's slot counts, one table for the note:
-- t.specInfo = { encounterID, counts = { [spec] = how many slot numbers the note names } }. Nothing else changes.
function Specs.Mark(note)
    local info = { encounterID = note.encounterID, counts = {} }
    local seen, any = {}, false
    for _, t in ipairs(note.timers or {}) do
        for _, tag in ipairs(t.tags or {}) do
            local e, n = Specs.Read(tag)
            if e then
                t.specInfo, any = info, true
                if n then
                    seen[e.spec] = seen[e.spec] or {}
                    if not seen[e.spec][n] then
                        seen[e.spec][n] = true
                        info.counts[e.spec] = (info.counts[e.spec] or 0) + 1
                    end
                end
            end
        end
    end
    return any
end
