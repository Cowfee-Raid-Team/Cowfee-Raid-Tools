local ADDON, CRT = ...

-- Your own times for your raid note cooldowns (CRT.NoteShifts). A healer who may not change the raid note
-- drags their own cast on the Timeline's Healer CDs (Timeline/HealerView.lua): the new time is kept here, on
-- this computer only, and the raid note stays as it is for everyone. The alerts' note block (Notes/Engine.lua)
-- uses it for that line's item when the line is yours (your callout, bar and speech); nobody else's changes.
--
-- Saved in CRTDB.notes.personalShifts[noteId][key] = { ph, t, raw, spellID }: ph and t the phase and seconds
-- into it, as a note line writes its time; raw the line's text when it was moved; key that text's fingerprint
-- (Shifts.Key). Never shared, never in a profile (Profiles.SHARE). The Timeline's Undo keeps a copy of it
-- (Timeline/Undo.lua), so Ctrl+Z puts a move back.
--
-- A time only holds while its note still has that very line. When the note changes (the raid lead edits or
-- shares it again) a time whose line is gone is dropped, and chat says so; when the note now has your time on
-- that line (the lead took your change), it says that instead. Checked once per change of a note's text.

local Notes = CRT.Notes
local Shifts = {}
CRT.NoteShifts = Shifts

local TEXT = {
    reset = "Your moved %s time was reset: the raid note changed that line.",
    taken = "The raid note now has your %s time.",
    cooldown = "cooldown",
}
Shifts.TEXT = TEXT

local function readable(v)
    if issecretvalue then
        local ok, secret = pcall(issecretvalue, v)
        if not ok or secret then
            return false
        end
    end
    return true
end

-- The saved times, made when missing (an older save has none).
local function store()
    local db = CRT.db and CRT.db.notes
    if not db then
        return nil
    end
    if type(db.personalShifts) ~= "table" then
        db.personalShifts = {}
    end
    return db.personalShifts
end

-- A line's fingerprint (djb2 and the length, the note share's way): the key its time is saved under, and
-- the line's name in a proposal to the raid lead (Notes/Proposals.lua).
function Shifts.Key(text)
    text = tostring(text or "")
    local h = 5381
    for i = 1, #text do
        h = (h * 33 + text:byte(i)) % 4294967296
    end
    -- in two halves, so %x never gets a number past a 32-bit signed integer
    return string.format("%04x%04x%x", math.floor(h / 65536), h % 65536, #text)
end

local version = 0 -- goes up on every change made here, so ByLine reads again
local byLine = {} -- noteId -> { raw, entries, version, map }: ByLine's answer per note text

local function changed()
    version = version + 1
    Notes:Fire()
end

-- Whether a note line's tags name this player: a tag that is their name, with or without the realm. A tag
-- with a realm must have theirs.
function Shifts.TagsName(tags, name)
    if not (readable(name) and type(name) == "string" and name ~= "") then
        return false
    end
    local full = name:lower()
    local base = full:match("^[^%-]+") or full
    local realm = full:match("^[^%-]+%-(.+)$")
    for _, tag in ipairs(tags or {}) do
        if type(tag) == "string" then
            local t = tag:lower()
            local tBase, tRealm = t:match("^([^%-]+)%-(.+)$")
            if tBase then
                if tBase == base and (realm == nil or tRealm == realm) then
                    return true
                end
            elseif t == base then
                return true
            end
        end
    end
    return false
end

-- A note's saved times by key, or nil.
function Shifts:ForNote(id)
    local all = store()
    local list = all and id ~= nil and all[id]
    return type(list) == "table" and next(list) ~= nil and list or nil
end

-- The time saved for the line with this text, or nil.
function Shifts:Find(id, raw)
    local list = self:ForNote(id)
    local e = list and list[Shifts.Key(raw)]
    return e and e.raw == raw and e or nil
end

-- Your time for one line of a note: phase ph, t seconds into it. False when the note has no such line.
function Shifts:Set(id, raw, ph, t, spellID)
    local all = store()
    if not (all and Notes:Get(id) and type(raw) == "string" and type(ph) == "number" and type(t) == "number") then
        return false
    end
    all[id] = all[id] or {}
    all[id][Shifts.Key(raw)] = { ph = ph, t = t, raw = raw, spellID = type(spellID) == "number" and spellID or nil }
    changed()
    return true
end

-- Drops your time for one line.
function Shifts:Clear(id, raw)
    local list = self:ForNote(id)
    local key = Shifts.Key(raw)
    if list and list[key] then
        list[key] = nil
        if next(list) == nil then
            store()[id] = nil
        end
        changed()
    end
end

-- Drops every time of these notes (Reset mine). Returns how many went.
function Shifts:ClearNotes(ids)
    local all, n = store(), 0
    for _, id in ipairs(ids or {}) do
        local list = all and all[id]
        if type(list) == "table" then
            for _ in pairs(list) do
                n = n + 1
            end
            all[id] = nil
        end
    end
    if n > 0 then
        changed()
    end
    return n
end

-- How many times the notes have.
function Shifts:Count(ids)
    local n = 0
    for _, id in ipairs(ids or {}) do
        for _ in pairs(self:ForNote(id) or {}) do
            n = n + 1
        end
    end
    return n
end

-- A note's times by line number ({ [line] = entry }), for the lines that still read as they did when
-- moved. Worked out once per note text and change.
function Shifts:ByLine(id)
    local list = self:ForNote(id)
    local record = Notes:Get(id)
    if not (list and record) then
        return nil
    end
    local c = byLine[id]
    if c and c.raw == record.raw and c.entries == list and c.version == version then
        return c.map
    end
    local map = {}
    for i, raw in ipairs(Notes:RawLines(id)) do
        local e = list[Shifts.Key(raw)]
        if e and e.raw == raw then
            map[i] = e
        end
    end
    byLine[id] = { raw = record.raw, entries = list, version = version, map = map }
    return map
end

-- Checking against the notes ---------------------------------------------------------------------------

local checked = {} -- noteId -> { raw, entries }: the text each note's times were last checked against

local function spellLabel(spellID)
    local info = type(spellID) == "number" and Notes.SpellInfo and Notes:SpellInfo(spellID)
    if info and type(info.name) == "string" then
        return info.name
    end
    if C_Spell and C_Spell.GetSpellName and type(spellID) == "number" then
        local ok, name = pcall(C_Spell.GetSpellName, spellID)
        if ok and readable(name) and type(name) == "string" and name ~= "" then
            return name
        end
    end
    return TEXT.cooldown
end

-- Whether the note now has your time for that spell on one of your lines.
local function taken(id, e)
    local note = Notes:Parsed(id)
    local me = UnitName and UnitName("player")
    for _, timer in ipairs(note and note.timers or {}) do
        if timer.spellId == e.spellID and timer.ph == e.ph and timer.time == e.t and Shifts.TagsName(timer.tags, me) then
            return true
        end
    end
    return false
end

-- Drops the times whose line is gone from its note, saying so in chat; the times of a deleted note go
-- quietly. Only notes whose text changed since their last check are read.
function Shifts:Check()
    local all = store()
    if not all then
        return
    end
    for id, list in pairs(all) do
        local record = Notes:Get(id)
        if type(list) ~= "table" or not record then
            all[id] = nil
            checked[id] = nil
        else
            local c = checked[id]
            if not (c and c.raw == record.raw and c.entries == list) then
                local lines = {}
                for _, raw in ipairs(Notes:RawLines(id)) do
                    lines[raw] = true
                end
                for key, e in pairs(list) do
                    if type(e) ~= "table" or not lines[e.raw] then
                        list[key] = nil
                        version = version + 1
                        if type(e) == "table" then
                            local word = spellLabel(e.spellID)
                            CRT:Print(string.format(taken(id, e) and TEXT.taken or TEXT.reset, word))
                        end
                    end
                end
                if next(list) == nil then
                    all[id] = nil
                    checked[id] = nil
                else
                    checked[id] = { raw = record.raw, entries = list }
                end
            end
        end
    end
end

-- Every change of the notes (a share received, an edit, Undo) checks the times; the listeners after this
-- one (the Timeline, Undo) see the times as checked.
Notes:OnChange(function()
    local ok, err = pcall(Shifts.Check, Shifts)
    if not ok and geterrorhandler then
        geterrorhandler()(err)
    end
end)
