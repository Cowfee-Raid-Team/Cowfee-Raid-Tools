local ADDON, CRT = ...

-- A Mech Alert saved as Raid note (Notes/Reminders.lua, Save as): the one place a reminder becomes raid note lines and
-- those lines are found again. One line per cast time, in the boss's raid note for the difficulty on show, each
-- carrying the alert's look and sound (Notes/Parse.lua's fields) and a marker field naming the ability:
--   time:36;ph:1;tag:all;spellid:1234;text:Spread;...;mech:1234;
-- The marker is the ability's key (MechNote.Key): its spell ID, or for a row with no spell its name in lower case,
-- with "#" and the reminder's id when another reminder of the boss has it already (UniqueKey).
-- FormatLine never writes it, so every other writer keeps it on the line (Parser.UnknownFields), and a CRT from
-- before it reads the line as any other timed line.
-- The reminder keeps what the panel chose in raidNote = { tag, key, difficulty }: who the lines are for (tag words:
-- "all", a role word, or players' names), the marker, and the note's Difficulty the lines went to (always a note for
-- exactly that difficulty, never one for any difficulty, so one difficulty's times never run on another's pull). While a reminder
-- has it, its own alerts step aside for the note's lines ("mine" block, Alerts/Reminders.lua); taking it away
-- (Only me) puts them back. A raider's own Only me alert for the same ability and the note's line both show.
-- The text functions are pure; Write, Sync and Leave change the notes store (Notes/Data.lua) and nothing else:
-- never the active note, never a share.

local MechNote = {}
CRT.MechNote = MechNote

MechNote.FIELD = "mech"
-- Who the lines can be for besides picked players: everyone, then the role words the alerts read (Notes/Parse.lua's
-- ROLE_WORDS), the first being the default.
MechNote.ROLES = { "all", "tank", "healer", "melee", "ranged" }
MechNote.VIA = "Mech Alerts" -- how a note made here came (a note's via, shown in the Raid Notes list)

local IS_ROLE = {}
for _, w in ipairs(MechNote.ROLES) do
    IS_ROLE[w] = true
end

local function trim(s)
    return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

-- Text fit for a note field: no ";" (it ends a field) and no line ends.
local function clean(s)
    return trim((tostring(s or ""):gsub(";", ""):gsub("[\r\n]+", " ")))
end

local function validID(v)
    return type(v) == "number" and v > 0 and v or nil
end

-- Keys ---------------------------------------------------------------------------------------------

-- The marker of an ability: its spell ID, else its name in lower case with one space between words (no ";" or ":"),
-- else nil.
function MechNote.Key(spellID, name)
    local id = validID(spellID)
    if id then
        return tostring(id)
    end
    local key = clean(name):gsub(":", ""):gsub("%s+", " "):lower()
    return key ~= "" and key or nil
end

-- The marker a raw note line carries, in lower case, or nil.
function MechNote.MarkerOf(line)
    local value = CRT.NoteParser.Field(line, MechNote.FIELD)
    value = value and value:lower() or nil
    return value ~= "" and value or nil
end

function MechNote.IsMarked(line, key)
    return key ~= nil and MechNote.MarkerOf(line) == tostring(key):lower()
end

-- Who the lines are for ------------------------------------------------------------------------------

-- A tag as its words: role words as they are, names as written. Empty or nil is everyone ("all").
function MechNote.TagWords(tag)
    local out = {}
    for word in clean(tag):gmatch("%S+") do
        out[#out + 1] = word
    end
    if #out == 0 then
        out[1] = MechNote.ROLES[1]
    end
    return out
end

-- Whether a tag is one of the role choices (everyone included); otherwise it names players.
function MechNote.IsRole(tag)
    return IS_ROLE[clean(tag):lower()] == true
end

-- Whether a tag names this player (by name, any realm).
function MechNote.HasPlayer(tag, name)
    if MechNote.IsRole(tag) or type(name) ~= "string" then
        return false
    end
    local want = name:lower()
    for _, w in ipairs(MechNote.TagWords(tag)) do
        if w:lower() == want then
            return true
        end
    end
    return false
end

-- A player ticked or unticked in the For list: the tag with the name added or taken out. A role tag gives way to
-- the players; the last player taken out leaves everyone.
function MechNote.TogglePlayer(tag, name)
    name = clean(name)
    if name == "" then
        return tag
    end
    local words, found = {}, false
    if not MechNote.IsRole(tag) then
        for _, w in ipairs(MechNote.TagWords(tag)) do
            if w:lower() == name:lower() then
                found = true
            else
                words[#words + 1] = w
            end
        end
    end
    if not found then
        words[#words + 1] = name
    end
    return #words > 0 and table.concat(words, " ") or MechNote.ROLES[1]
end

-- Lines -------------------------------------------------------------------------------------------

-- A reminder's look and sound as a note line's timer (Notes/Parse.lua's FormatLine), without its time, through the
-- draft the panel edits (Alerts/Draft.lua ForReminder, then NoteTimer: the one mapping of an alert to a note line),
-- with the For tag and the reminder's priority. The panel setting on the left, the note field on the right:
--   Text text: (no ";")       spell spellid:        Icon ID icon:          Color colors:
--   Show as show:             Speak the text tts:1  Count down count:1     Speak at At 0 ttsat:0
--   Glow at 0 glow:1          Sound sound:          Show from warn:        Linger linger:
--   Shield bar shield:        Impact ticks ticks:   Bar fills up fill:up   Count down to each impact countto:impact
--   (priority high or low) prio:
-- Also when it lands on me (an aura sound) stays yours: a note line can't carry it.
function MechNote.Timer(r, tag)
    local Draft = CRT.AlertDraft
    local t = Draft.NoteTimer(nil, Draft.ForReminder(r))
    t.tags = MechNote.TagWords(tag)
    t.prio = (r.priority == "high" or r.priority == "low") and r.priority or nil
    return t
end

-- The raw note lines of a reminder: one per time ({ ph, t }, a time with no phase in phase 1), in phase and time
-- order, each ending in the marker.
function MechNote.Lines(r, times, tag, key)
    local base = MechNote.Timer(r, tag)
    local list = {}
    for _, e in ipairs(times or {}) do
        if type(e.t) == "number" then
            list[#list + 1] = { ph = type(e.ph) == "number" and e.ph or 1, t = e.t }
        end
    end
    table.sort(list, function(a, b)
        if a.ph ~= b.ph then
            return a.ph < b.ph
        end
        return a.t < b.t
    end)
    local out = {}
    for i, e in ipairs(list) do
        base.ph, base.time = e.ph, e.t
        out[i] = CRT.NoteParser.FormatLine(base) .. MechNote.FIELD .. ":" .. key .. ";"
    end
    return out
end

-- The text as { text, eol } pieces (Notes/Data.lua's SplitPieces when loaded); concatenated they give it back.
local function pieces(raw)
    local Notes = CRT.Notes
    if Notes and Notes.SplitPieces then
        return Notes.SplitPieces(raw)
    end
    local out, pos = {}, 1
    while true do
        local nl = raw:find("\n", pos, true)
        if not nl then
            out[#out + 1] = { text = raw:sub(pos), eol = "" }
            return out
        end
        local text, eol = raw:sub(pos, nl - 1), "\n"
        if text:sub(-1) == "\r" then
            text, eol = text:sub(1, -2), "\r\n"
        end
        out[#out + 1] = { text = text, eol = eol }
        pos = nl + 1
    end
end

-- How many lines of a note's text carry the marker.
function MechNote.Count(raw, key)
    local n = 0
    for _, p in ipairs(pieces(raw or "")) do
        if MechNote.IsMarked(p.text, key) then
            n = n + 1
        end
    end
    return n
end

-- The note's text with the marked lines replaced by `lines`: where the first marked line was, else at the end.
-- Every other line, and the line ends, stay byte for byte. No lines takes the marked ones out.
function MechNote.Replace(raw, key, lines)
    raw = raw or ""
    local all = pieces(raw)
    local style = (all[1] and all[1].eol == "\r\n") and "\r\n" or "\n"
    local kept, at, lastEol = {}, nil, nil
    for _, p in ipairs(all) do
        if MechNote.IsMarked(p.text, key) then
            at = at or (#kept + 1)
            lastEol = p.eol
        else
            kept[#kept + 1] = p
        end
    end
    lines = lines or {}
    local new = {}
    for i, line in ipairs(lines) do
        new[i] = { text = line, eol = style }
    end
    if at then
        -- in place: the last new line ends as the last marked line did
        if #new > 0 then
            new[#new].eol = lastEol
        end
    elseif #new > 0 then
        -- at the end: after the note's last line (a newline added in its style), before a trailing blank
        local last = kept[#kept]
        if last and last.text == "" and last.eol == "" and #kept > 1 then
            at = #kept
        elseif last and last.text == "" and last.eol == "" then
            -- an empty text: the lines are all of it
            kept = {}
            at = 1
            new[#new].eol = ""
        else
            if last and last.eol == "" then
                last.eol = style
            end
            at = #kept + 1
            new[#new].eol = ""
        end
    end
    local out = {}
    for i = 1, #kept + 1 do
        if i == at then
            for _, p in ipairs(new) do
                out[#out + 1] = p.text .. p.eol
            end
        end
        if kept[i] then
            out[#out + 1] = kept[i].text .. kept[i].eol
        end
    end
    return table.concat(out)
end

-- The marked lines of a note's text, as written, in order.
function MechNote.MarkedLines(raw, key)
    local out = {}
    for _, p in ipairs(pieces(raw or "")) do
        if MechNote.IsMarked(p.text, key) then
            out[#out + 1] = p.text
        end
    end
    return out
end

-- The note ---------------------------------------------------------------------------------------

-- The Difficulty of the note the lines go to: the ability timeline's own (the one the times are read from), else the
-- group's: Mythic, or Heroic for Normal/Heroic.
function MechNote.NoteDifficulty(ref, group)
    local d = ref and ref.difficulty
    if type(d) == "string" and trim(d) ~= "" then
        return trim(d)
    end
    return group == "mythic" and "Mythic" or "Heroic"
end

local function sameDifficulty(a, b)
    return trim(a):lower() == trim(b):lower()
end

-- The boss's shared note for exactly that difficulty (Notes:FindExact), or nil. A note for any difficulty, or for
-- another one, is never written: Mythic times would run on a Heroic pull.
function MechNote.FindNote(encounterID, difficulty)
    local Notes = CRT.Notes
    return Notes and Notes.FindExact and Notes:FindExact(encounterID, difficulty) or nil
end

-- How many marked lines the boss's note for that difficulty has (0 with no note), and the note.
function MechNote.CountIn(encounterID, difficulty, key)
    local id = MechNote.FindNote(encounterID, difficulty)
    local record = id and CRT.Notes:Get(id)
    return record and MechNote.Count(record.raw, key) or 0, id
end

-- Writes the marked lines into the boss's note for that difficulty, in place of the ones there: a note named after
-- the boss is made when it has none (Notes:NoteFor, exact), only when there are lines to write. Returns the note's id
-- (nil when none was needed) and how many lines it now has. The active note and the shares are left alone.
function MechNote.Write(encounterID, difficulty, bossName, key, lines)
    local Notes = CRT.Notes
    if not (Notes and type(encounterID) == "number" and key) then
        return nil, 0
    end
    lines = lines or {}
    local id
    if #lines == 0 then
        id = MechNote.FindNote(encounterID, difficulty)
    else
        id = Notes:NoteFor(encounterID, difficulty, bossName, { exact = true, via = MechNote.VIA })
    end
    local record = id and Notes:Get(id)
    if not record then
        return nil, 0
    end
    local raw = record.raw or ""
    local new = MechNote.Replace(raw, key, lines)
    if new ~= raw then
        Notes:UpdateRaw(id, new, "edited", { lines = true })
    end
    return id, #lines
end

-- A reminder's Raid note choice ({ tag, key, difficulty }), or nil while it is Only me.
function MechNote.InNote(r)
    local n = type(r) == "table" and r.raidNote
    return type(n) == "table" and type(n.key) == "string" and n or nil
end

-- Takes a reminder's lines out of the note they went to. Returns how many were there.
function MechNote.Leave(encounterID, r)
    local n = MechNote.InNote(r)
    if not n then
        return 0
    end
    local before = MechNote.CountIn(encounterID, n.difficulty, n.key)
    if before > 0 then
        MechNote.Write(encounterID, n.difficulty, nil, n.key, {})
    end
    return before
end

-- The marker a reminder's lines get: its own, unless another reminder of the boss already uses it (an ability row and
-- your own reminder on the same spell, two of yours with the same text), then made its own with "#" and its id.
function MechNote.UniqueKey(encounterID, id, key)
    local Reminders = CRT.AlertReminders
    if not (Reminders and key) then
        return key
    end
    for _, e in ipairs(Reminders:List(encounterID)) do
        local n = e.id ~= id and MechNote.InNote(e.r)
        if n and n.key:lower() == key:lower() then
            return key .. "#" .. tostring(id)
        end
    end
    return key
end

-- What a saved reminder's lines should be now, without writing anything: the lines, the note's Difficulty and the
-- marker. Its times as read from opts.ref for opts.group (Reminders:Times), into the note for ref's difficulty; with
-- no ref, the difficulty its lines went to (its ability timeline preferred); none while it is turned off. Nil for a
-- reminder that is Only me.
function MechNote.Expected(encounterID, id, opts)
    local Reminders = CRT.AlertReminders
    local r = Reminders and Reminders:Get(encounterID, id)
    local n = MechNote.InNote(r)
    if not n then
        return nil
    end
    opts = opts or {}
    local difficulty = (opts.ref or not n.difficulty) and MechNote.NoteDifficulty(opts.ref, opts.group) or n.difficulty
    local key = MechNote.UniqueKey(encounterID, id, n.key)
    local lines = {}
    if r.enabled ~= false then
        local probe = r
        if not opts.ref and not r.difficulty then
            probe = {}
            for k, v in pairs(r) do
                probe[k] = v
            end
            probe.difficulty = difficulty -- that difficulty's ability timeline, inside the group
        end
        lines = MechNote.Lines(r, (Reminders:Times(encounterID, probe, opts.ref, opts.group)), n.tag, key)
    end
    return lines, difficulty, key
end

-- Whether the note holds exactly a reminder's lines (Expected): the same lines, in the note for the same difficulty.
function MechNote.InStep(encounterID, id, opts)
    local lines, difficulty, key = MechNote.Expected(encounterID, id, opts)
    if not lines then
        return true
    end
    local n = MechNote.InNote(CRT.AlertReminders:Get(encounterID, id))
    if key ~= n.key or not (n.difficulty and sameDifficulty(n.difficulty, difficulty)) then
        return false
    end
    local noteID = MechNote.FindNote(encounterID, difficulty)
    local record = noteID and CRT.Notes:Get(noteID)
    local have = record and MechNote.MarkedLines(record.raw, key) or {}
    if #have ~= #lines then
        return false
    end
    for i, line in ipairs(lines) do
        if have[i] ~= line then
            return false
        end
    end
    return true
end

-- Brings a saved reminder's lines in step with it (Expected), the panel after every save and an import over it: lines
-- left in the note of another difficulty (Times from changed) are taken out, and the reminder keeps the difficulty
-- and marker they went to. opts { ref, group, boss }. Returns the note's id and the line count, or nil for a
-- reminder that is Only me.
function MechNote.Sync(encounterID, id, opts)
    local lines, difficulty, key = MechNote.Expected(encounterID, id, opts)
    if not lines then
        return nil
    end
    local r = CRT.AlertReminders:Get(encounterID, id)
    local n = r.raidNote
    if n.difficulty and not sameDifficulty(n.difficulty, difficulty) then
        MechNote.Leave(encounterID, r)
    end
    n.difficulty, n.key = difficulty, key
    return MechNote.Write(encounterID, difficulty, (opts and opts.boss) or r.boss, key, lines)
end

-- The players the For list offers: you and your raid or party, with their realm when it isn't yours, in name order.
function MechNote.GroupNames()
    local out, seen = {}, {}
    local function readable(v)
        return not (issecretvalue and issecretvalue(v))
    end
    local function add(unit)
        local ok, name, realm = pcall(UnitName, unit)
        if ok and readable(name) and type(name) == "string" and name ~= "" then
            if readable(realm) and type(realm) == "string" and realm ~= "" then
                name = name .. "-" .. realm
            end
            if not seen[name:lower()] then
                seen[name:lower()] = true
                out[#out + 1] = name
            end
        end
    end
    if not UnitName then
        return out
    end
    add("player")
    local raid = IsInRaid and IsInRaid()
    local n = GetNumGroupMembers and GetNumGroupMembers() or 0
    for i = 1, raid and n or (n - 1) do
        add((raid and "raid" or "party") .. i)
    end
    table.sort(out)
    return out
end
