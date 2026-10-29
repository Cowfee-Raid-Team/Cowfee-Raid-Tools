local ADDON, CRT = ...

-- Interrupts: the kick list in the raid note (CRT.InterruptNote). An integration with Northern Sky Raid Tools' kick
-- list: NSRT's Interrupt Display reads a block in the raid note, as its settings page shows it (Alex's screenshot,
-- 2026-10-29), built here from that visible format only:
--   intstart
--   Solex Brenn Quick Mara        one line per group, in the setup's group order, its names in kick order,
--   Tovi Hale Ruun Pell           space separated, empty slots left out (a group with none is an empty line)
--   intend
-- The block goes into the boss's shared note for exactly the difficulty on show (Notes:FindExact / NoteFor exact, the
-- note Mech Alerts writes its lines to), made when it has none; an existing block there is replaced in place, every
-- other line kept byte for byte. Your own list is written: by Write to the raid note on the page, and after each change
-- of your own list (a second after the last), while you can change the raid note (Notes:CanEditRaid) and not in combat
-- or a boss fight (Notes.Busy). A list with no names takes the block out.
-- Read back: opening a boss on the page reads the block of its note into the raid's list (as a share does), when its
-- lines fit the setup (no more lines than groups, no more names on a line than the group's slots) and differ from the
-- raid's list now. The text functions are pure; Write and ReadInto go through the Notes API only.

local Block = {}
CRT.InterruptNote = Block

local Interrupts = CRT.Interrupts

Block.START, Block.END = "intstart", "intend"
Block.VIA = "Interrupts" -- how a note made here came (a note's via, in the Raid Notes list)
Block.DELAY = 1 -- seconds after your last change before your list is written

local TEXT = {
    noNotes = "Raid Notes isn't loaded.",
    busy = "The raid note can't be changed in combat or a boss fight.",
    noDifficulty = "This difficulty has no raid note.",
    noBoss = "This boss has no kick setup.",
    fromNote = "the raid note",
    written = "Wrote the kick list into the %s raid note for %s.",
    removed = "Took the kick list out of the %s raid note for %s.",
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
    -- trailing groups with no names add nothing
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

-- A block's rows as a list in def's group order, or nil when they don't fit it (more lines than groups, or more names
-- on a line than its group's slots).
function Block.Fit(def, rows)
    if type(rows) ~= "table" or #rows > #def.groups then
        return nil
    end
    local list = {}
    for g, grp in ipairs(def.groups) do
        local names = rows[g] or {}
        if #names > grp.slots then
            return nil
        end
        list[g] = {}
        for s = 1, grp.slots do
            list[g][s] = names[s] or ""
        end
    end
    return list
end

-- The note for a key: the Notes API, the key's parts, the setup and the note's Difficulty; or nil and why not.
local function target(key)
    local Notes = CRT.Notes
    if not (Notes and Notes.FindExact) then
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

-- Writes your own list for a key into its raid note. Returns true and the note's id (nil when there was nothing to
-- write and no note), or false and why not.
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
    local noteID
    if #lines == 0 then
        noteID = Notes:FindExact(t.id, t.difficulty)
    else
        noteID = Notes:NoteFor(t.id, t.difficulty, Interrupts:BossName(t.key), { exact = true, via = Block.VIA })
    end
    local record = noteID and Notes:Get(noteID)
    if not record then
        return true, nil
    end
    local raw = record.raw or ""
    local new = Block.Replace(raw, lines)
    if new ~= raw then
        Notes:UpdateRaw(noteID, new, "edited", { lines = true })
    end
    return true, noteID, #lines == 0
end

-- Reads the block of a key's raid note into the raid's list, when it fits and differs. True when it did.
function Block.ReadInto(key)
    local t = target(key)
    if not t then
        return false
    end
    local noteID = t.Notes:FindExact(t.id, t.difficulty)
    local record = noteID and t.Notes:Get(noteID)
    local list = record and Block.Fit(t.def, Block.Rows(record.raw))
    if not list then
        return false
    end
    local shared = Interrupts:Shared(t.key)
    if shared and Interrupts.SameList(t.def, shared.list, list) then
        return false
    end
    return Interrupts:ReceiveShared(t.key, list, TEXT.fromNote)
end

-- Your own list, written a moment after your last change to it.
local pending = {}
local function flush()
    for key in pairs(pending) do
        pending[key] = nil
        Block.Write(key)
    end
end

function Block.Flush()
    flush()
end

Interrupts:OnChange(function(what, key, source)
    if what ~= "list" or source ~= "own" or not key or not Interrupts:Enabled() then
        return
    end
    local Notes = CRT.Notes
    if not (Notes and Notes.CanEditRaid and Notes:CanEditRaid()) then
        return
    end
    local first = next(pending) == nil
    pending[key] = true
    if first and C_Timer and C_Timer.After then
        C_Timer.After(Block.DELAY, flush)
    end
end)
