local ADDON, CRT = ...

-- Your own times for your raid note cooldowns (CRT.NoteShifts). A healer who may not change the raid note
-- drags their own cast on the Timeline's Healer CDs (Timeline/HealerView.lua): the new time is kept here, on
-- this computer only, and the raid note stays as it is for everyone. The alerts' note block (Notes/Engine.lua)
-- uses it for that line's item when the line is yours (your callout, bar and speech); nobody else's changes.
--
-- Saved in CRTDB.notes.personalShifts[noteId][key] = { ph, t, raw, occ, who, spellID }: ph and t the phase and
-- seconds into it, as a note line writes its time; raw the line's text when it was moved and occ which line of
-- that very text it is (1 for the first; a note can hold the same line twice); who the character that moved it
-- ("name-realm", Shifts.PlayerKey: the saved data is the whole account's, so each character sees only its own);
-- key is who, the text's fingerprint (Shifts.Key) and occ. Never shared, never in a profile (Profiles.SHARE); kept
-- for as long as its note (long term, never in the season purge). The Timeline's Undo keeps a copy of it
-- (Timeline/Undo.lua), so Ctrl+Z puts a move back.
--
-- A time only holds while its note still has that very line. When the note changes (the raid lead edits or
-- shares it again) a time whose line is gone is dropped, and chat says so; when the note now has your time on
-- that line (the lead took your change), it says that instead. Checked once per change of a note's text.
-- Also the shared helpers of Notes/Proposals.lua: Readable, PlayerKey, SpellLabel, Key.

local Notes = CRT.Notes
local Shifts = {}
CRT.NoteShifts = Shifts

local TEXT = {
    reset = "Your moved %s time was reset: the raid note changed that line.",
    taken = "The raid note now has your %s time.",
    cooldown = "cooldown",
}
Shifts.TEXT = TEXT

-- False for a secret value, which can't be compared.
local function readable(v)
    if issecretvalue then
        local ok, secret = pcall(issecretvalue, v)
        if not ok or secret then
            return false
        end
    end
    return true
end
Shifts.Readable = readable

-- "Name" or "Name-Realm" as one key, lower case: your realm added when missing, the realm's spaces and dashes
-- left out. Nil for a secret or empty name.
function Shifts.PlayerKey(name)
    if not (readable(name) and type(name) == "string" and name ~= "") then
        return nil
    end
    local base, realm = name:match("^([^%-]+)%-(.+)$")
    if not base then
        base = name
        realm = GetNormalizedRealmName and GetNormalizedRealmName() or ""
        if not (readable(realm) and type(realm) == "string") then
            realm = ""
        end
    end
    return base:lower() .. "-" .. realm:lower():gsub("[%s%-]", "")
end

-- Your own key, or nil.
function Shifts.Me()
    if not UnitName then
        return nil
    end
    local ok, name = pcall(UnitName, "player")
    return ok and Shifts.PlayerKey(name) or nil
end

-- A spell's name for chat, or "cooldown".
function Shifts.SpellLabel(spellID)
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

-- A line's fingerprint (djb2 and the length, the note share's way): part of the key its time is saved under,
-- and the line's name in a proposal to the raid lead (Notes/Proposals.lua).
function Shifts.Key(text)
    text = tostring(text or "")
    local h = 5381
    for i = 1, #text do
        h = (h * 33 + text:byte(i)) % 4294967296
    end
    -- in two halves, so %x never gets a number past a 32-bit signed integer
    return string.format("%04x%04x%x", math.floor(h / 65536), h % 65536, #text)
end

local function entryKey(who, raw, occ)
    return tostring(who) .. "|" .. Shifts.Key(raw) .. "#" .. tostring(occ or 1)
end

-- Which line of its very text line n of a note is (1 for the first), and that text; nil for no such line.
function Shifts.Occurrence(id, n)
    local lines = Notes:RawLines(id)
    local raw = lines[n]
    if raw == nil then
        return nil
    end
    local occ = 0
    for i = 1, n do
        if lines[i] == raw then
            occ = occ + 1
        end
    end
    return occ, raw
end

local version = 0 -- goes up on every change made here, so ByLine reads again
local byLine = {} -- noteId -> { raw, entries, version, who, map }: ByLine's answer per note text

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

local function mine(e, me)
    return type(e) == "table" and e.who == me
end

-- A note's saved times by key (every character's), or nil.
local function forNote(id)
    local all = store()
    local list = all and id ~= nil and all[id]
    return type(list) == "table" and next(list) ~= nil and list or nil
end

-- Your time for line n of a note: phase ph, t seconds into it. False when the note has no such line.
function Shifts:Set(id, n, ph, t, spellID)
    local all, me = store(), Shifts.Me()
    local occ, raw = Shifts.Occurrence(id, n)
    if not (all and me and occ and type(ph) == "number" and type(t) == "number") then
        return false
    end
    all[id] = all[id] or {}
    all[id][entryKey(me, raw, occ)] = { ph = ph, t = t, raw = raw, occ = occ, who = me,
        spellID = type(spellID) == "number" and spellID or nil }
    changed()
    return true
end

-- Drops your time for line n of a note.
function Shifts:Clear(id, n)
    local list, me = forNote(id), Shifts.Me()
    local occ, raw = Shifts.Occurrence(id, n)
    local key = occ and me and entryKey(me, raw, occ)
    if list and key and list[key] then
        list[key] = nil
        if next(list) == nil then
            store()[id] = nil
        end
        changed()
    end
end

-- Drops every time of yours in these notes (Reset mine). Returns how many went.
function Shifts:ClearNotes(ids)
    local all, me, n = store(), Shifts.Me(), 0
    for _, id in ipairs(ids or {}) do
        local list = all and all[id]
        if type(list) == "table" then
            for key, e in pairs(list) do
                if mine(e, me) then
                    list[key] = nil
                    n = n + 1
                end
            end
            if next(list) == nil then
                all[id] = nil
            end
        end
    end
    if n > 0 then
        changed()
    end
    return n
end

-- How many times of yours the notes have.
function Shifts:Count(ids)
    local me, n = Shifts.Me(), 0
    for _, id in ipairs(ids or {}) do
        for _, e in pairs(forNote(id) or {}) do
            if mine(e, me) then
                n = n + 1
            end
        end
    end
    return n
end

-- Your times of a note by line number ({ [line] = entry }), for the lines that still read as they did when
-- moved. Worked out once per note text and change.
function Shifts:ByLine(id)
    local list = forNote(id)
    local record = Notes:Get(id)
    local me = Shifts.Me()
    if not (list and record and me) then
        return nil
    end
    local c = byLine[id]
    if c and c.raw == record.raw and c.entries == list and c.version == version and c.who == me then
        return c.map
    end
    local map, seen = {}, {}
    for i, raw in ipairs(Notes:RawLines(id)) do
        seen[raw] = (seen[raw] or 0) + 1
        local e = list[entryKey(me, raw, seen[raw])]
        if e and e.raw == raw then
            map[i] = e
        end
    end
    byLine[id] = { raw = record.raw, entries = list, version = version, who = me, map = map }
    return map
end

-- Your time for line n of a note, or nil.
function Shifts:Find(id, n)
    local map = self:ByLine(id)
    return map and map[n] or nil
end

-- Checking against the notes ---------------------------------------------------------------------------

local checked = {} -- noteId -> { raw, entries }: the text each note's times were last checked against

-- Whether the note now has that time for that spell on one of your lines.
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

-- Drops the times whose line is gone from its note, saying so in chat for your own; the times of a deleted
-- note go quietly. Only notes whose text changed since their last check are read.
function Shifts:Check()
    local all = store()
    if not all then
        return
    end
    local me = Shifts.Me()
    for id, list in pairs(all) do
        local record = Notes:Get(id)
        if type(list) ~= "table" or not record then
            all[id] = nil
            checked[id] = nil
        else
            local c = checked[id]
            if not (c and c.raw == record.raw and c.entries == list) then
                local count = {}
                for _, raw in ipairs(Notes:RawLines(id)) do
                    count[raw] = (count[raw] or 0) + 1
                end
                for key, e in pairs(list) do
                    if type(e) ~= "table" or (count[e.raw] or 0) < (e.occ or 1) then
                        list[key] = nil
                        version = version + 1
                        if mine(e, me) then
                            CRT:Print(string.format(taken(id, e) and TEXT.taken or TEXT.reset, Shifts.SpellLabel(e.spellID)))
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
