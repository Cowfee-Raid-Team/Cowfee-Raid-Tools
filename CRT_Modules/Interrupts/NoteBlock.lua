local ADDON, CRT = ...

-- Interrupts: the kick list in the raid note (CRT.InterruptNote). An integration with Northern Sky Raid Tools' kick
-- list: NSRT's Interrupt Display reads a block in the raid note, as its settings page shows it (Alex's screenshot,
-- 2026-10-29), built here from that visible format only:
--   intstart
--   Solex Brenn Quick Mara        one line per group, in the setup's group order, its names in kick order,
--   Tovi Hale Ruun Pell           space separated, empty slots left out (a group with none is an empty line)
--   intend
-- Only Write to the raid note on the page writes it, your own list, into the note a pull of that difficulty reads
-- (Notes:FindForEncounter), so the block is where the pull finds it and no new note ever hides that one:
--   the boss has no note at all          a note for exactly that difficulty is made (Notes:NoteFor exact)
--   the pull reads that difficulty's     written there
--   the pull reads a note for every      written there only while the boss has kick setups (shipped, your own or a
--   difficulty (no Difficulty)           share's) for one difficulty; else refused, so Heroic and Mythic never write
--                                        over each other's block in one note
--   the pull reads another difficulty's  refused: "The Heroic pull reads the Mythic note. Make a Heroic note first
--                                        (Raid Notes), then write."
-- An existing block there is replaced in place, every other line kept byte for byte; a list with no names takes the
-- block out. Never in combat or a boss fight (Notes.Busy), and only while you can change the raid note
-- (Notes:CanEditRaid); a refused write says why.
-- Read back: opening a boss on the page reads the block of that same note (by the same rules, quietly) into the
-- raid's list (as a share does),
-- when it fits the setup in use: no more lines than groups, and each line either empty (an empty group) or exactly as
-- many names as its group's slots. A line with fewer names had empty slots left out, so where they were can't be
-- told: such a block is not read, and nothing is put in use from it. The text functions are pure (the note's lines
-- through Notes.SplitPieces); Write and ReadInto go through the Notes API only.

local Block = {}
CRT.InterruptNote = Block

local Interrupts = CRT.Interrupts

Block.START, Block.END = "intstart", "intend"
Block.VIA = "Interrupts" -- how a note made here came (a note's via, in the Raid Notes list)

local TEXT = {
    noNotes = "Raid Notes isn't loaded.",
    busy = "The raid note can't be changed in combat or a boss fight.",
    noDifficulty = "This difficulty has no raid note.",
    noBoss = "This boss has no kick setup.",
    fromNote = "the raid note",
    noFit = "The kick block in the raid note \"%s\" doesn't fit %s: each line needs every name of its group, or none.",
    otherNote = "The %s pull reads the %s note. Make a %s note first (Raid Notes), then write.",
    anyNote = "The %s pull reads the note \"%s\", which is for every difficulty, and this boss has kick setups for more than one. Make a %s note first (Raid Notes), then write.",
}
Block.TEXT = TEXT

-- A note's Difficulty for a difficulty ID (the words Mech Alerts' notes use).
local DIFFICULTY_NAMES = { [14] = "Normal", [15] = "Heroic", [16] = "Mythic" }
function Block.DifficultyName(difficulty)
    return DIFFICULTY_NAMES[difficulty]
end

local function trim(s)
    return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

-- The text as { text, eol } pieces: the notes store's own split (Notes/Data.lua), so a note is cut into lines one way.
local function pieces(raw)
    return CRT.Notes.SplitPieces(raw)
end

-- The block's lines for a list in def's group order (start and end included), or {} when it has no name.
function Block.Lines(def, list)
    local rows, any = {}, false
    for g, grp in ipairs(def.groups) do
        local names = {}
        for s = 1, grp.slots do
            local name = type(list) == "table" and type(list[g]) == "table" and list[g][s]
            if type(name) == "string" and trim(name) ~= "" then
                names[#names + 1] = trim(name)
                any = true
            end
        end
        rows[g] = table.concat(names, " ")
    end
    if not any then
        return {}
    end
    -- trailing groups with no names add nothing (a missing line reads as an empty group)
    while rows[#rows] == "" do
        rows[#rows] = nil
    end
    local out = { Block.START }
    for _, r in ipairs(rows) do
        out[#out + 1] = r
    end
    out[#out + 1] = Block.END
    return out
end

-- Where the block is in a note's pieces: its first and last piece, or nil (a start with no end is no block).
local function find(all)
    local first
    for i, p in ipairs(all) do
        local word = trim(p.text):lower()
        if not first and word == Block.START then
            first = i
        elseif first and word == Block.END then
            return first, i
        end
    end
    return nil
end

-- The block's lines in a note's text: { { names }, ... } one per line between start and end, or nil when it has none.
function Block.Rows(raw)
    local all = pieces(raw or "")
    local first, last = find(all)
    if not first then
        return nil
    end
    local rows = {}
    for i = first + 1, last - 1 do
        local names = {}
        for word in all[i].text:gmatch("%S+") do
            names[#names + 1] = word
        end
        rows[#rows + 1] = names
    end
    return rows
end

-- The note's text with its block replaced by lines (Block.Lines): in place, else at the end. No lines takes the
-- block out. Every other line, and the line ends, stay byte for byte.
function Block.Replace(raw, lines)
    raw = raw or ""
    lines = lines or {}
    local all = pieces(raw)
    local style = (all[1] and all[1].eol == "\r\n") and "\r\n" or "\n"
    local first, last = find(all)
    local kept, at, lastEol = {}, nil, nil
    for i, p in ipairs(all) do
        if first and i >= first and i <= last then
            at = at or (#kept + 1)
            lastEol = p.eol
        else
            kept[#kept + 1] = p
        end
    end
    local new = {}
    for i, line in ipairs(lines) do
        new[i] = { text = line, eol = style }
    end
    if at then
        if #new > 0 then
            new[#new].eol = lastEol
        end
    elseif #new > 0 then
        local tail = kept[#kept]
        if tail and tail.text == "" and tail.eol == "" and #kept > 1 then
            at = #kept -- before the note's trailing blank
        elseif tail and tail.text == "" and tail.eol == "" then
            kept, at = {}, 1 -- an empty text: the block is all of it
            new[#new].eol = ""
        else
            if tail and tail.eol == "" then
                tail.eol = style
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

-- Reading view: where CRT shows a note to read, the block is drawn as a "Kick order" heading and one "<label>: <names>"
-- line per group (the raid marker's icon before the label), never the intstart / intend lines. The note's text itself is
-- never changed. Pure: the text in, the display out; Render.lua (the note view), Window.lua (the Assignments window) and
-- EditModel.lua (the editor's rows) all take it from here.
TEXT.kickOrder = "Kick order"
TEXT.group = "Group %d"
local MARKER_TOKEN = "^{rt(%d)} (.*)$" -- Expand's way to carry a raid marker in plain text

-- The raid marker icon for a number 1 to 8 (as the Interrupts page draws it), or "".
function Block.Icon(marker, size)
    local Setup = CRT.InterruptSetup
    return Setup and Setup.MarkerIcon and Setup.MarkerIcon(marker, size) or ""
end

-- A line of Expand's text split into its raid marker (a number, or nil) and the rest.
function Block.TakeMarker(line)
    local marker, rest = tostring(line or ""):match(MARKER_TOKEN)
    if marker then
        return tonumber(marker), rest
    end
    return nil, line
end

local DIFFICULTY_IDS = {}
for id, name in pairs(DIFFICULTY_NAMES) do
    DIFFICULTY_IDS[name:lower()] = id
end

-- The group labels of the kick setup in use for a boss and a note's difficulty word: { { label, marker }, ... } in group
-- order, or {} when the module is off or the boss has none. With no difficulty, the boss's only setup.
function Block.Labels(encounterID, difficulty)
    local I = CRT.Interrupts
    if not (I and I.Enabled and I:Enabled() and type(encounterID) == "number") then
        return {}
    end
    local id = type(difficulty) == "string" and DIFFICULTY_IDS[difficulty:lower()] or nil
    local def
    if id then
        def = I:Def(I.Key(encounterID, id))
    else
        local all = I:Setups(encounterID)
        def = #all == 1 and all[1] or nil
    end
    local out = {}
    for g, grp in ipairs(def and def.groups or {}) do
        out[g] = { label = grp.label, marker = grp.marker }
    end
    return out
end

-- How a note's lines read: one entry per piece of Notes.SplitPieces (so the same line numbers), nil for a line that is
-- not in the block, else
--   { kind = "heading", text }          the start line
--   { kind = "kick", label, marker, names }   a line of names; the label from the setup, else "Group N"
--   { kind = "hidden" }                 the end line
-- Returns nil when the note has no block. Also returns the pieces.
function Block.View(raw)
    raw = raw or ""
    if not raw:lower():find(Block.START, 1, true) then
        return nil
    end
    local all = pieces(raw)
    local first, last = find(all)
    if not first then
        return nil
    end
    local note = CRT.NoteParser.Parse(raw)
    local labels = Block.Labels(note.encounterID, note.difficulty)
    local items = { [first] = { kind = "heading", text = TEXT.kickOrder }, [last] = { kind = "hidden" } }
    for i = first + 1, last - 1 do
        local n = i - first
        local names = {}
        for word in all[i].text:gmatch("%S+") do
            names[#names + 1] = word
        end
        local group = labels[n]
        local label = group and type(group.label) == "string" and group.label ~= "" and group.label or string.format(TEXT.group, n)
        items[i] = { kind = "kick", label = label, marker = group and group.marker or nil, names = names }
    end
    return items, all
end

-- The note's text as it is read: the block as "Kick order" and "<label>: <names>" lines (a raid marker as a "{rtN} "
-- token in front, Block.TakeMarker), the end line left out. The same text when the note has no block.
function Block.Expand(raw)
    local items, all = Block.View(raw)
    if not items then
        return raw
    end
    local out = {}
    for i, p in ipairs(all) do
        local item = items[i]
        if not item then
            out[#out + 1] = p.text .. p.eol
        elseif item.kind == "heading" then
            out[#out + 1] = item.text .. p.eol
        elseif item.kind == "kick" then
            local names = #item.names > 0 and (" " .. table.concat(item.names, " ")) or ""
            out[#out + 1] = (item.marker and ("{rt" .. item.marker .. "} ") or "") .. item.label .. ":" .. names .. p.eol
        end
    end
    return table.concat(out)
end

-- A block's rows as a list in def's group order, or nil when they don't fit it: more lines than groups, or a line
-- that is neither empty (an empty group; a missing line too) nor exactly its group's slots in names.
function Block.Fit(def, rows)
    if type(rows) ~= "table" or #rows > #def.groups then
        return nil
    end
    local list = {}
    for g, grp in ipairs(def.groups) do
        local names = rows[g] or {}
        if #names ~= 0 and #names ~= grp.slots then
            return nil
        end
        list[g] = {}
        for s = 1, grp.slots do
            list[g][s] = names[s] or ""
        end
    end
    return list
end

-- The Notes API, the key's parts, the setup and the note's Difficulty; or nil and why not.
local function target(key)
    local Notes = CRT.Notes
    if not (Notes and Notes.FindForEncounter and Notes.SplitPieces) then
        return nil, TEXT.noNotes
    end
    local skey, def, id, diff = Interrupts:Resolve(key)
    if not def then
        return nil, TEXT.noBoss
    end
    local name = Block.DifficultyName(diff)
    if not name then
        return nil, TEXT.noDifficulty
    end
    return { Notes = Notes, key = skey, def = def, id = id, difficulty = name }
end

-- The note the block lives in for t: the note a pull of that difficulty reads, when it may hold it. nil when the boss
-- has no note at all; nil and why when the pull reads a note the block can't go in.
local function noteOf(t)
    -- the shared rule (Notes:WriteTarget); a note for every difficulty is fine while the boss has one setup at most
    local id, _, record = t.Notes:WriteTarget(t.id, t.difficulty,
        { find = true, singleDifficulty = #Interrupts:Setups(t.id) <= 1 })
    if id or not record then
        return id
    end
    if type(record.difficulty) == "string" then
        return nil, string.format(TEXT.otherNote, t.difficulty, record.difficulty, t.difficulty)
    end
    return nil, string.format(TEXT.anyNote, t.difficulty, tostring(record.name), t.difficulty)
end
Block.NoteOf = function(key)
    local t = target(key)
    return t and noteOf(t) or nil
end

-- Writes your own list for a key into its raid note. Returns true, the note's id (nil when there was nothing to write
-- and no note), whether the block was taken out, and the note's name; or false and why not.
function Block.Write(key)
    local t, why = target(key)
    if not t then
        return false, why
    end
    local Notes = t.Notes
    local ok, reason = Notes:CanEditRaid()
    if not ok then
        return false, reason
    end
    if Notes.Busy() then
        return false, TEXT.busy
    end
    local lines = Block.Lines(t.def, Interrupts:Own(t.key))
    local noteID, refused = noteOf(t)
    if refused then
        return false, refused
    end
    if not noteID and #lines > 0 then
        -- the boss has no note at all
        noteID = Notes:NoteFor(t.id, t.difficulty, Interrupts:BossName(t.key), { exact = true, via = Block.VIA })
    end
    local record = noteID and Notes:Get(noteID)
    if not record then
        return true, nil, true
    end
    local raw = record.raw or ""
    local new = Block.Replace(raw, lines)
    if new ~= raw then
        Notes:UpdateRaw(noteID, new, "edited", { lines = true })
    end
    return true, noteID, #lines == 0, record.name
end

-- Reads the block of a key's raid note into the raid's list, when it fits and differs. True when it did; false and
-- why when the block is there but doesn't fit (nothing is put in use); false alone when there is nothing to read.
function Block.ReadInto(key)
    local t = target(key)
    if not t then
        return false
    end
    local noteID = noteOf(t)
    local record = noteID and t.Notes:Get(noteID)
    local rows = record and Block.Rows(record.raw)
    if not rows then
        return false
    end
    local list = Block.Fit(t.def, rows)
    if not list then
        return false, string.format(TEXT.noFit, tostring(record.name), Interrupts:BossName(t.key))
    end
    local shared = Interrupts:Shared(t.key)
    if shared and Interrupts.SameList(t.def, shared.list, list) then
        return false
    end
    return Interrupts:ReceiveShared(t.key, list, TEXT.fromNote)
end
