local ADDON, CRT = ...

-- The macro engine, CRT.Macros: makes, rewrites and removes ready-made macros in the game's macro list, safely.
-- It knows nothing about the features: each one registers a set,
--   Macros:Register({ key, label, perCharacter, macros = { { name, icon, body }, ... } })
-- (Markers/Macros.lua is the first, shown on Raid Notes > Marker macros, Markers/MacrosTab.lua).
--
-- Where they go. A set marked perCharacter goes in the character's macros. Any other set goes in General Macros
-- (the account's), and when General hasn't room for the missing ones, in the character's macros instead; when
-- neither has room for all of them alone, General is filled first and the rest go to the character's. When both
-- together haven't room, none are made and the message says how many slots to free.
--
-- Safety. CRT only edits or deletes a macro it made, and only while the player hasn't changed it:
--   * every name starts with PREFIX ("CRT "), checked when the set registers;
--   * what CRT made in General Macros is saved in CRTDB.macros.owned[setKey][name] = { body }, shared by every
--     profile (that list is the account's, not a profile's; Profiles.lua); what it made in the character's macros
--     is saved the same way in CRTDBChar.macros.owned, as each character has its own;
--   * a macro is ours only when its name is in the list for its place and its body is still the one saved there.
-- A macro of ours the player edited is "changed": kept and reported. One they renamed no longer has our name, so
-- it is never found. A macro with one of our names that CRT didn't make is a "conflict": never overwritten.
--
-- The game's macro API (checked 2026-10-21 on warcraft.wiki.gg and in Blizzard's Blizzard_MacroUI.lua and
-- MacroConstantsDocumentation.lua; listed in the vault's api-inventory):
--   GetNumMacros() -> account count, character count
--   GetMacroInfo(slot) -> name, icon (a file ID), body; slots 1 to MAX_ACCOUNT_MACROS are the account's
--     (General Macros), the character's follow from MAX_ACCOUNT_MACROS + 1
--   CreateMacro(name, icon, body, perCharacter) -> slot; nil perCharacter makes an account macro. It errors when
--     that list is full. Names over 16 characters don't fit the game's window; only 255 body characters are kept.
--   EditMacro(slot, name, icon, body) -> slot; nil keeps that part
--   DeleteMacro(slot)
--   Constants.MacroConsts.MAX_ACCOUNT_MACROS (120) and MAX_CHARACTER_MACROS (30)
--   UPDATE_MACROS fires after a macro changes
-- None of them may be called in combat (InCombatLockdown: "Programatic modification of macros or bindings is not
-- allowed"), so every change refuses then, and the page greys its buttons. Each list keeps its macros sorted by
-- name, so slots move after every change: the engine reads the list again before each one.

local Macros = {}
CRT.Macros = Macros

Macros.PREFIX = "CRT "
Macros.MAX_NAME = 16 -- the game's macro window shows no more
Macros.MAX_BODY = 255 -- the game keeps no more
-- Constants.MacroConsts's values on 2026-10-21, for a client without the table
local MAX_ACCOUNT, MAX_CHARACTER = 120, 30

local sets, order = {}, {}
local listeners = {}

local function limits()
    local c = Constants and Constants.MacroConsts
    return (c and c.MAX_ACCOUNT_MACROS) or MAX_ACCOUNT, (c and c.MAX_CHARACTER_MACROS) or MAX_CHARACTER
end

-- The game may keep a body with spaces or a line break at its end; they don't change what the macro does.
local function same(a, b)
    return type(a) == "string" and type(b) == "string" and a:gsub("%s+$", "") == b:gsub("%s+$", "")
end

-- What CRT made of a set: in General Macros (perCharacter false) or in this character's macros (true).
local function owned(key, perCharacter)
    local db
    if perCharacter then
        CRTDBChar = type(CRTDBChar) == "table" and CRTDBChar or {}
        CRTDBChar.macros = type(CRTDBChar.macros) == "table" and CRTDBChar.macros or {}
        db = CRTDBChar.macros
    else
        db = CRT.db.macros
    end
    db.owned = db.owned or {}
    db.owned[key] = db.owned[key] or {}
    return db.owned[key]
end

local function inCombat()
    return InCombatLockdown and InCombatLockdown() and true or false
end

function Macros:InCombat()
    return inCombat()
end

-- Registering --------------------------------------------------------------------------------------------------

-- Checks a set and adds it. Returns true, or nil and the reason (a broken set is left out, never half made).
function Macros:Register(set)
    if type(set) ~= "table" or type(set.key) ~= "string" or type(set.label) ~= "string" or type(set.macros) ~= "table" or #set.macros == 0 then
        return nil, "a set needs a key, a label and its macros"
    end
    local seen = {}
    for _, m in ipairs(set.macros) do
        if type(m.name) ~= "string" or m.name:sub(1, #self.PREFIX) ~= self.PREFIX then
            return nil, tostring(m.name) .. ": a name must start with " .. self.PREFIX
        end
        if #m.name > self.MAX_NAME then
            return nil, m.name .. ": a name has at most " .. self.MAX_NAME .. " characters"
        end
        if type(m.body) ~= "string" or #m.body > self.MAX_BODY then
            return nil, m.name .. ": a body has at most " .. self.MAX_BODY .. " characters"
        end
        if seen[m.name] then
            return nil, m.name .. ": named twice"
        end
        seen[m.name] = true
    end
    if not sets[set.key] then
        order[#order + 1] = set.key
    end
    sets[set.key] = set
    return true
end

-- The registered sets, in the order they registered.
function Macros:Sets()
    local out = {}
    for _, key in ipairs(order) do
        out[#out + 1] = sets[key]
    end
    return out
end

-- Reading the game's list --------------------------------------------------------------------------------------

-- Every macro: { slot, name, body, perCharacter }.
local function readAll()
    local out = {}
    local okCount, numAccount, numCharacter = pcall(GetNumMacros)
    if not okCount then
        return out
    end
    local maxAccount = limits()
    local function add(slot, perCharacter)
        local ok, name, _, body = pcall(GetMacroInfo, slot)
        if ok and name then
            out[#out + 1] = { slot = slot, name = name, body = body, perCharacter = perCharacter }
        end
    end
    for slot = 1, numAccount or 0 do
        add(slot, false)
    end
    for i = 1, numCharacter or 0 do
        add(maxAccount + i, true)
    end
    return out
end

-- One macro of a set: "ours" (with its slot, outdated when the set's body has changed since, and whether it is in
-- the character's macros), "changed" (ours, but the player edited it), "conflict" (the player's own, with our
-- name) or "missing". A macro is checked against what CRT saved for its own place.
local function classify(key, def, all)
    local named, edited = false, false
    for _, m in ipairs(all) do
        if m.name == def.name then
            named = true
            local mine = owned(key, m.perCharacter)[def.name]
            if mine and same(m.body, mine.body) then
                return "ours", m.slot, not same(mine.body, def.body), m.perCharacter
            elseif mine then
                edited = true
            end
        end
    end
    if not named then
        return "missing"
    end
    return edited and "changed" or "conflict"
end

-- Where a set stands now: { key, label, total, created, outdated, entries, missing, changed, conflicts }; entries
-- holds { def, state, slot, outdated, perCharacter } per macro and the three lists hold names. Nil for an unknown
-- set.
function Macros:Status(key)
    local set = sets[key]
    if not set then
        return nil
    end
    local all = readAll()
    local st = { key = key, label = set.label, total = #set.macros, created = 0, outdated = 0, entries = {}, missing = {}, changed = {}, conflicts = {} }
    for _, def in ipairs(set.macros) do
        local state, slot, outdated, perCharacter = classify(key, def, all)
        st.entries[#st.entries + 1] = { def = def, state = state, slot = slot, outdated = outdated, perCharacter = perCharacter }
        if state == "ours" then
            st.created = st.created + 1
            if outdated then
                st.outdated = st.outdated + 1
            end
        elseif state == "missing" then
            st.missing[#st.missing + 1] = def.name
        elseif state == "changed" then
            st.changed[#st.changed + 1] = def.name
        else
            st.conflicts[#st.conflicts + 1] = def.name
        end
    end
    return st
end

-- The page's status line: "none", "8 of 8 created", and what needs a look ("2 changed by you").
function Macros:StatusText(key)
    local st = self:Status(key)
    if not st then
        return ""
    end
    local parts = {}
    if st.created > 0 then
        parts[1] = st.created .. " of " .. st.total .. " created"
    end
    if #st.changed > 0 then
        parts[#parts + 1] = #st.changed .. " changed by you"
    end
    if #st.conflicts > 0 then
        parts[#parts + 1] = #st.conflicts .. " blocked by your own"
    end
    if st.outdated > 0 then
        parts[#parts + 1] = st.outdated .. " out of date"
    end
    if #parts == 0 then
        return "none"
    end
    return table.concat(parts, ", ")
end

-- The sentences that follow a change, for the macros it left alone.
local function leftAlone(st)
    local out = ""
    if #st.changed > 0 then
        out = out .. " Kept, as you changed them: " .. table.concat(st.changed, ", ") .. "."
    end
    if #st.conflicts > 0 then
        out = out .. " Not touched, as you have your own macro with that name: " .. table.concat(st.conflicts, ", ") .. "."
    end
    return out
end

local COMBAT = "Macros can't be changed in combat. Try again after the fight."

local function count(n)
    return n == 1 and "1 macro" or (n .. " macros")
end

local GENERAL = "General Macros, for all your characters"
local CHARACTER = "your character's macros"

-- How many of n new macros go in General Macros and how many in the character's, or nil and the free counts
-- when both together haven't room. A perCharacter set uses only the character's.
local function placeFor(set, n)
    local okCount, numAccount, numCharacter = pcall(GetNumMacros)
    if not okCount then
        numAccount, numCharacter = 0, 0
    end
    local maxAccount, maxCharacter = limits()
    local freeAccount = math.max(0, maxAccount - (numAccount or 0))
    local freeCharacter = math.max(0, maxCharacter - (numCharacter or 0))
    if set.perCharacter then
        if n <= freeCharacter then
            return 0, n
        end
        return nil, 0, freeCharacter
    end
    if n <= freeAccount then
        return n, 0
    elseif n <= freeCharacter then
        return 0, n -- all together in one place
    elseif n <= freeAccount + freeCharacter then
        return freeAccount, n - freeAccount
    end
    return nil, freeAccount, freeCharacter
end

-- "made 8 macros in General Macros, ...", or both places when they were split.
local function madeWhere(general, character)
    if character == 0 then
        return count(general) .. " in " .. GENERAL
    elseif general == 0 then
        return count(character) .. " in " .. CHARACTER
    end
    return count(general) .. " in General Macros and " .. character .. " in " .. CHARACTER
end

-- Changing them ------------------------------------------------------------------------------------------------
-- Each returns ok and a message for chat.

-- Makes the set's missing macros, or only the one named `only`, all or none: when General Macros and the
-- character's macros together haven't room for every one, it makes none (see the top of the file).
function Macros:Create(key, only)
    local set = sets[key]
    if not set then
        return false, "No such macro set."
    end
    if inCombat() then
        return false, COMBAT
    end
    local st = self:Status(key)
    local todo = {}
    for _, e in ipairs(st.entries) do
        if e.state == "missing" and (only == nil or e.def.name == only) then
            todo[#todo + 1] = e.def
        end
    end
    if #todo == 0 then
        if only then
            return true, only .. ": nothing to make, it is already in your macros." .. leftAlone(st)
        end
        return true, set.label .. ": nothing to make, the " .. count(st.created) .. " made before are still there." .. leftAlone(st)
    end
    local general, character, freeCharacter = placeFor(set, #todo)
    if not general then
        local freeGeneral = character
        if set.perCharacter then
            return false, string.format("%s: no macros made. They need %d free slots in %s, and %d are free. Delete %d and try again.", set.label, #todo, CHARACTER, freeCharacter, #todo - freeCharacter)
        end
        return false, string.format("%s: no macros made. They need %d free macro slots; General Macros has %d free and %s %d. Free %d more and try again.", set.label, #todo, freeGeneral, CHARACTER, freeCharacter, #todo - freeGeneral - freeCharacter)
    end
    local madeGeneral, madeCharacter, failed = 0, 0, {}
    for i, def in ipairs(todo) do
        local perCharacter = i > general
        local ok, slot = pcall(CreateMacro, def.name, def.icon, def.body, perCharacter and true or nil)
        if ok and slot then
            owned(key, perCharacter)[def.name] = { body = def.body }
            if perCharacter then
                madeCharacter = madeCharacter + 1
            else
                madeGeneral = madeGeneral + 1
            end
        else
            failed[#failed + 1] = def.name
        end
    end
    local msg = string.format("%s: made %s.", set.label, madeWhere(madeGeneral, madeCharacter))
    if madeCharacter > 0 and not set.perCharacter then
        msg = msg .. " General Macros had no room for them, so only this character has those."
    end
    if #failed > 0 then
        msg = msg .. " The game refused: " .. table.concat(failed, ", ") .. "."
    end
    return #failed == 0, msg .. leftAlone(st)
end

-- Deletes the set's macros that are still ours. The list is read again before each one, as slots move.
function Macros:Remove(key)
    local set = sets[key]
    if not set then
        return false, "No such macro set."
    end
    if inCombat() then
        return false, COMBAT
    end
    local removed, failed = 0, {}
    for _, def in ipairs(set.macros) do
        local state, slot, _, perCharacter = classify(key, def, readAll())
        if state == "ours" then
            if pcall(DeleteMacro, slot) then
                owned(key, perCharacter)[def.name] = nil
                removed = removed + 1
            else
                failed[#failed + 1] = def.name
            end
        end
    end
    local msg = string.format("%s: removed %s.", set.label, count(removed))
    if #failed > 0 then
        msg = msg .. " The game refused: " .. table.concat(failed, ", ") .. "."
    end
    return #failed == 0, msg .. leftAlone(self:Status(key))
end

-- Rewrites the bodies of the set's macros that are ours and older than the set; their names and icons stay.
function Macros:Update(key)
    local set = sets[key]
    if not set then
        return false, "No such macro set."
    end
    if inCombat() then
        return false, COMBAT
    end
    local updated, failed = 0, {}
    for _, def in ipairs(set.macros) do
        local state, slot, outdated, perCharacter = classify(key, def, readAll())
        if state == "ours" and outdated then
            if pcall(EditMacro, slot, nil, nil, def.body) then
                owned(key, perCharacter)[def.name] = { body = def.body }
                updated = updated + 1
            else
                failed[#failed + 1] = def.name
            end
        end
    end
    local st = self:Status(key)
    local msg
    if updated == 0 and #failed == 0 then
        msg = set.label .. ": nothing to update."
    else
        msg = string.format("%s: updated %s.", set.label, count(updated))
    end
    if #failed > 0 then
        msg = msg .. " The game refused: " .. table.concat(failed, ", ") .. "."
    end
    if #st.missing > 0 then
        msg = msg .. " Not made yet: " .. table.concat(st.missing, ", ") .. " (Generate all macros makes them)."
    end
    return #failed == 0, msg .. leftAlone(st)
end

-- Telling the page -------------------------------------------------------------------------------------------

-- fn() runs when a macro changes or combat starts or ends.
function Macros:OnChange(fn)
    listeners[#listeners + 1] = fn
end

local events = CreateFrame("Frame")
events:RegisterEvent("UPDATE_MACROS")
events:RegisterEvent("PLAYER_REGEN_DISABLED")
events:RegisterEvent("PLAYER_REGEN_ENABLED")
events:SetScript("OnEvent", function()
    for _, fn in ipairs(listeners) do
        fn()
    end
end)
