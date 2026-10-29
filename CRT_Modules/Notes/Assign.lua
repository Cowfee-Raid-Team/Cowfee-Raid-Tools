local ADDON, CRT = ...

-- An assignment block: who does what on a mechanic (soaks, sides, who sends a cooldown), written into a raid note.
-- No frames: the Mech Alerts Assign tab (Notes/AssignTab.lua) and the note editor's Add assignment
-- (Notes/EditorWindow.lua) both edit a block through these functions, so both write the same lines.
-- A block is { name, rows, times, spellID }:
--   name     the heading line over the rows (the mechanic's name by default)
--   rows     { { label, text, tokens, casts } }: each row's label ("Left"), the text its timed lines show ("Soak
--            left"; empty: the label), its players or tag words (names, "healer", "Group1", "Demon Hunter") and the
--            casts it is on: "all", "rotate" (the rotate rows take the casts in turn: the first row cast 1, the
--            second cast 2, ...) or a list of cast numbers ({ 2, 4, 6 })
--   times    nil: the mechanic's casts, read from the ability timeline by the caller; else its own { { ph, t } }
--   spellID  the mechanic's spell (its icon on the timed lines), or nil
-- In the note, a block is plain lines every reader understands, the heading, one "Label: names" assignment line per
-- row, then one timed line per row per cast it is on (a row with no one in it has none):
--   Ravenous Feast
--   Left: Solex, Rixxy
--   Right: Abu, Cheo
--   time:36;ph:1;tag:Solex Rixxy;spellid:1234;text:Soak left;assign:ravenous feast/1;
-- The timed lines carry a marker, assign:<key>/<row>, the block's key (Key: its name in lower case) and the row's
-- number; FormatLine never writes it, so other writers keep it on the line, and an older CRT reads the line as any
-- other timed line. The heading and its rows are found by the heading's text (the first heading line with the
-- block's name that has assignment lines under it), so the note editor shows them as rows, as any group list. The
-- note is the one source: Read gives the block back from the text. An untimed block (no times) is its heading and
-- rows only; its rows' texts and casts are then not kept, as no line shows them.
-- Replace writes a block in place of its old lines, every other line byte for byte (MechNote.ReplaceLines); Write
-- does it in the boss's note for exactly one difficulty (MechNote.WriteWith), and links each timed line to its row
-- (Notes/Links.lua LinkTo), so in the note editor a change to a row's names is written on its lines too.
--   Assign.Lines(block, times, opts)     the block's lines. opts: key (default Key(name)), spellID
--   Assign.Read(text, key, times)        the block with that key in a note's text, or nil
--   Assign.Candidates(text)              group lists that timed lines follow but are no block yet (a pasted note)
--   Assign.FromRows(text, heading, times)   such a list as a block, and the lines it takes in
--   Assign.Adopt(text, heading, times, opts)   the text with that list rewritten as a block

local Assign = {}
CRT.NoteAssign = Assign

local Parser = CRT.NoteParser
local Model = CRT.NoteEditModel

Assign.FIELD = "assign"
Assign.ALL, Assign.ROTATE = "all", "rotate"
Assign.MAX_ROWS = 20
Assign.SAME_TIME = 0.05 -- seconds: a line's time and a cast's this close are the same cast

local TEXT = {
    row = "Row %d",
    untitled = "Assignment",
}
Assign.TEXT = TEXT

local function trim(s)
    return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

-- Text fit for a note field: no ";" (it ends a field) and no line ends.
local function clean(s)
    return trim((tostring(s or ""):gsub(";", ""):gsub("[\r\n]+", " ")))
end

local function words(s)
    return (s:gsub("%s+", " "))
end

-- Names and keys ---------------------------------------------------------------------------------------------

-- A heading the note editor reads as one: no ":" (that makes a row), "|" or "**", one space between words.
function Assign.CleanName(name)
    local s = words(clean(name):gsub("[:|]", ""):gsub("%*%*", ""))
    s = trim(s)
    return s ~= "" and s or TEXT.untitled
end

-- A block's key: its name in lower case, without "/" (the marker's row mark).
function Assign.Key(name)
    return (Assign.CleanName(name):gsub("/", ""):lower())
end

-- A row's label as an assignment line's label (Parser.LooksLikeLabel: four words at most, no markup), else
-- "Row n".
function Assign.CleanLabel(label, n)
    local s = trim(words(clean(label):gsub("[:|{},]", "")))
    local out, count = {}, 0
    for w in s:gmatch("%S+") do
        count = count + 1
        if count <= 4 then
            out[#out + 1] = w
        end
    end
    s = table.concat(out, " ")
    if s == "" or not Parser.LooksLikeLabel(s) then
        return string.format(TEXT.row, n or 1)
    end
    return s
end

function Assign.CleanText(text)
    return clean(text)
end

-- Blocks and rows ------------------------------------------------------------------------------------------

function Assign.NewRow(n)
    return { label = string.format(TEXT.row, n), text = "", tokens = {}, casts = Assign.ALL }
end

function Assign.NewBlock(name)
    return { name = Assign.CleanName(name), rows = { Assign.NewRow(1) } }
end

function Assign.Copy(block)
    local out = { name = block.name, spellID = block.spellID, key = block.key, rows = {} }
    if block.times then
        out.times = {}
        for i, e in ipairs(block.times) do
            out.times[i] = { ph = e.ph, t = e.t }
        end
    end
    for r, row in ipairs(block.rows or {}) do
        local tokens = {}
        for k, w in ipairs(row.tokens or {}) do
            tokens[k] = w
        end
        local casts = row.casts
        if type(casts) == "table" then
            local list = {}
            for k, c in ipairs(casts) do
                list[k] = c
            end
            casts = list
        end
        out.rows[r] = { label = row.label, text = row.text, tokens = tokens, casts = casts }
    end
    return out
end

-- Adds a row (a label "Row n" of its own). False past MAX_ROWS.
function Assign.AddRow(block)
    if #block.rows >= Assign.MAX_ROWS then
        return false
    end
    block.rows[#block.rows + 1] = Assign.NewRow(#block.rows + 1)
    return true
end

-- Takes row r out; the last row stays (a block has one at least).
function Assign.RemoveRow(block, r)
    if #block.rows <= 1 or not block.rows[r] then
        return false
    end
    table.remove(block.rows, r)
    return true
end

local function hasToken(row, token)
    local lower, class = token:lower(), Parser.ClassOf(token)
    for _, w in ipairs(row.tokens) do
        if w:lower() == lower or (class and Parser.ClassOf(w) == class) then
            return true
        end
    end
    return false
end

-- Adds a player or tag word to row r (the palette's tokens, Model.ValidToken). False when it isn't one, or the row
-- has it already.
function Assign.AddToken(block, r, token)
    local row = block.rows[r]
    if not (row and Model.ValidToken(token)) or hasToken(row, token) then
        return false
    end
    row.tokens[#row.tokens + 1] = token
    return true
end

function Assign.RemoveToken(block, r, k)
    local row = block.rows[r]
    if not (row and row.tokens[k]) then
        return false
    end
    table.remove(row.tokens, k)
    return true
end

-- Moves row r's k-th token to row to. Nothing changes when that row can't take it.
function Assign.MoveToken(block, r, k, to)
    local row = block.rows[r]
    local word = row and row.tokens[k]
    if r == to or not word or not Assign.AddToken(block, to, word) then
        return false
    end
    return Assign.RemoveToken(block, r, k)
end

-- Whether any row has someone in it (the Assign tab's dot).
function Assign.HasNames(block)
    for _, row in ipairs(block and block.rows or {}) do
        if #row.tokens > 0 then
            return true
        end
    end
    return false
end

-- Casts ------------------------------------------------------------------------------------------------------

-- "all" (or nothing), "rotate", or cast numbers ("1, 4" or "1 4"), sorted, each once. Nil when it doesn't read.
function Assign.ParseCasts(text)
    local t = trim(text):lower()
    if t == "" or t == Assign.ALL then
        return Assign.ALL
    elseif t == Assign.ROTATE then
        return Assign.ROTATE
    end
    local list, seen = {}, {}
    for part in t:gmatch("[^,%s]+") do
        local n = tonumber(part)
        if not n or n < 1 or n ~= math.floor(n) then
            return nil
        end
        if not seen[n] then
            seen[n] = true
            list[#list + 1] = n
        end
    end
    table.sort(list)
    return #list > 0 and list or nil
end

function Assign.FormatCasts(casts)
    if type(casts) == "table" then
        local out = {}
        for i, n in ipairs(casts) do
            out[i] = tostring(n)
        end
        return table.concat(out, ", ")
    end
    return casts == Assign.ROTATE and Assign.ROTATE or Assign.ALL
end

-- The times in cast order ({ ph, t }, a time with no phase in phase 1): by phase, then time.
function Assign.SortTimes(times)
    local list = {}
    for _, e in ipairs(times or {}) do
        if type(e) == "table" and type(e.t) == "number" then
            list[#list + 1] = { ph = type(e.ph) == "number" and e.ph or 1, t = e.t }
        end
    end
    table.sort(list, function(a, b)
        if a.ph ~= b.ph then
            return a.ph < b.ph
        end
        return a.t < b.t
    end)
    return list
end

-- The cast numbers each row is on, of n casts: { [row] = { cast, ... } }.
function Assign.RowCasts(block, n)
    local rotate, pos = {}, {}
    for r, row in ipairs(block.rows) do
        if row.casts == Assign.ROTATE then
            rotate[#rotate + 1] = r
            pos[r] = #rotate
        end
    end
    local out = {}
    for r, row in ipairs(block.rows) do
        local list = {}
        if type(row.casts) == "table" then
            for _, c in ipairs(row.casts) do
                if c >= 1 and c <= n then
                    list[#list + 1] = c
                end
            end
        elseif row.casts == Assign.ROTATE then
            for c = pos[r], n, #rotate do
                list[#list + 1] = c
            end
        else
            for c = 1, n do
                list[c] = c
            end
        end
        out[r] = list
    end
    return out
end

-- Lines ------------------------------------------------------------------------------------------------------

local function labelLine(row, r)
    local label = Assign.CleanLabel(row.label, r)
    if #row.tokens == 0 then
        return label .. ":"
    end
    return label .. ": " .. table.concat(row.tokens, ", ")
end

-- The text a row's timed lines show: its own, else its label.
function Assign.RowText(row, r)
    local text = Assign.CleanText(row.text)
    return text ~= "" and text or Assign.CleanLabel(row.label, r)
end

-- Each row's timed lines, without writing them: { [row] = { { ph, t, cast, text } } }, in cast order.
function Assign.RowLines(block, times)
    local list = Assign.SortTimes(times)
    local on = Assign.RowCasts(block, #list)
    local out = {}
    for r, row in ipairs(block.rows) do
        out[r] = {}
        if #row.tokens > 0 then
            for _, c in ipairs(on[r]) do
                out[r][#out[r] + 1] = { ph = list[c].ph, t = list[c].t, cast = c, text = Assign.RowText(row, r) }
            end
        end
    end
    return out
end

-- The marker a block's timed line ends in.
function Assign.Marker(key, r)
    return Assign.FIELD .. ":" .. key .. "/" .. r .. ";"
end

-- The block's lines: its heading, a row line per row, then its timed lines in cast order (each cast's rows in
-- their order). times: the casts (nil or empty: none, an untimed block).
function Assign.Lines(block, times, opts)
    opts = opts or {}
    local key = opts.key or Assign.Key(block.name)
    local spellID = opts.spellID or block.spellID
    spellID = type(spellID) == "number" and spellID > 0 and spellID or nil
    local out = { Assign.CleanName(block.name) }
    for r, row in ipairs(block.rows) do
        out[#out + 1] = labelLine(row, r)
    end
    local list = Assign.SortTimes(times)
    local on = Assign.RowCasts(block, #list)
    local byCast = {}
    for r, row in ipairs(block.rows) do
        if #row.tokens > 0 then
            for _, c in ipairs(on[r]) do
                byCast[c] = byCast[c] or {}
                byCast[c][#byCast[c] + 1] = r
            end
        end
    end
    for c, e in ipairs(list) do
        for _, r in ipairs(byCast[c] or {}) do
            local row = block.rows[r]
            local t = { time = e.t, ph = e.ph, tags = row.tokens, text = Assign.RowText(row, r) }
            if spellID then
                t.kind, t.spellId = "spell", spellID
            end
            out[#out + 1] = Parser.FormatLine(t) .. Assign.Marker(key, r)
        end
    end
    return out
end

-- Finding a block in a note ----------------------------------------------------------------------------------

-- A line's marker: its block's key (lower case) and row number, or nil.
function Assign.MarkerOf(line)
    local v = Parser.Field(line or "", Assign.FIELD)
    if not v or v == "" then
        return nil
    end
    local key, r = v:match("^(.-)/(%d+)$")
    key = trim(key or v):lower()
    if key == "" then
        return nil
    end
    return key, tonumber(r)
end

local function session(src)
    if type(src) == "table" then
        return src
    end
    return Model.New(src or "")
end

-- The rows of a heading's group list: the assignment lines right under it.
local function labelsUnder(s, heading)
    local out = {}
    local i = heading + 1
    while s.rows[i] and s.rows[i].kind == "label" do
        out[#out + 1] = i
        i = i + 1
    end
    return out
end

-- Where a block is in a session's lines: { heading, labels = { line }, timed = { line } }.
local function find(s, key)
    key = tostring(key or ""):lower()
    local f = { labels = {}, timed = {} }
    for i, row in ipairs(s.rows) do
        if row.kind == "timer" or row.kind == "unread" then
            if Assign.MarkerOf(row.raw) == key then
                f.timed[#f.timed + 1] = i
            end
        elseif not f.heading and row.kind == "heading" and Assign.Key(row.text) == key then
            local labels = labelsUnder(s, i)
            if #labels > 0 then
                f.heading, f.labels = i, labels
            end
        end
    end
    return f
end

-- The line numbers a block holds in a note's text (a set), and whether it has any.
function Assign.Find(text, key)
    local f = find(session(text), key)
    local set, any = {}, false
    for _, i in ipairs(f.labels) do
        set[i], any = true, true
    end
    for _, i in ipairs(f.timed) do
        set[i], any = true, true
    end
    if f.heading then
        set[f.heading], any = true, true
    end
    return set, any, f
end

-- The note's text with the block's lines replaced by `lines` (where its first line was, else at the end), every
-- other line byte for byte. No lines takes the block out. oldKey (optional): a renamed block's old key, whose lines
-- go too, the new ones taking their place.
function Assign.Replace(text, key, lines, oldKey)
    local s = session(text or "")
    local set = Assign.Find(s, key)
    if oldKey and oldKey ~= key then
        for i in pairs((Assign.Find(s, oldKey))) do
            set[i] = true
        end
    end
    return CRT.MechNote.ReplaceLines(text or "", function(i)
        return set[i] == true
    end, lines)
end

-- The keys of the blocks a note's timed lines name, in order.
function Assign.Keys(text)
    local out, seen = {}, {}
    for _, row in ipairs(session(text).rows) do
        if row.kind == "timer" then
            local key = Assign.MarkerOf(row.raw)
            if key and not seen[key] then
                seen[key] = true
                out[#out + 1] = key
            end
        end
    end
    return out
end

-- Reading a block back --------------------------------------------------------------------------------------

local function castOf(list, ph, t)
    for c, e in ipairs(list) do
        if e.ph == ph and math.abs(e.t - t) < Assign.SAME_TIME then
            return c
        end
    end
    return nil
end

-- Each row's casts from the casts its lines are on (sets[row] = { [cast] = true }) of n: every cast is "all"; rows
-- that take the casts in turn are "rotate"; any other a list. A row with no lines is "all" (nothing says otherwise).
local function inferCasts(block, sets, n)
    local rest = {}
    for r, row in ipairs(block.rows) do
        local set = sets[r]
        local count = 0
        for _ in pairs(set or {}) do
            count = count + 1
        end
        if not set or count == 0 or count == n then
            row.casts = Assign.ALL
        else
            rest[#rest + 1] = r
        end
    end
    -- the rows taking the casts in turn: for k = 2, 3, ..., the first k rows (in order) whose casts are the 1st, 2nd,
    -- ... of every k
    local function onTurn(r, j, k)
        for c = 1, n do
            if (sets[r][c] == true) ~= ((c - 1) % k == j - 1) then
                return false
            end
        end
        return true
    end
    local turns = {}
    for k = 2, #rest do
        local picked, j = {}, 1
        for _, r in ipairs(rest) do
            if j <= k and onTurn(r, j, k) then
                picked[r], j = true, j + 1
            end
        end
        if j > k then
            turns = picked
            break
        end
    end
    for _, r in ipairs(rest) do
        if turns[r] then
            block.rows[r].casts = Assign.ROTATE
        else
            local list = {}
            for c in pairs(sets[r]) do
                list[#list + 1] = c
            end
            table.sort(list)
            block.rows[r].casts = list
        end
    end
end

-- Fills the rows' texts and casts from their timed lines ({ r, ph, t, text, spellId }), against times (the
-- mechanic's casts) or, with none, the lines' own times (then the block's typed times). Lines on no cast are left out
-- and returned.
local function fromLines(block, entries, times)
    local list = times and Assign.SortTimes(times)
    if not list then
        list = {}
        for _, e in ipairs(entries) do
            if not castOf(list, e.ph, e.t) then
                list[#list + 1] = { ph = e.ph, t = e.t }
            end
        end
        list = Assign.SortTimes(list)
        block.times = #list > 0 and list or nil
    end
    local sets, off = {}, {}
    for _, e in ipairs(entries) do
        local c = castOf(list, e.ph, e.t)
        local row = block.rows[e.r]
        if c and row then
            sets[e.r] = sets[e.r] or {}
            sets[e.r][c] = true
            if row.text == "" and e.text and e.text ~= "" and e.text ~= Assign.CleanLabel(row.label, e.r) then
                row.text = e.text
            end
            block.spellID = block.spellID or e.spellId
        else
            off[#off + 1] = e
        end
    end
    inferCasts(block, sets, #list)
    return off
end

local function rowFrom(s, i)
    return { label = trim(s.rows[i].label or ""), text = "", tokens = s:Names(i), casts = Assign.ALL }
end

-- The block with that key in a note's text, or nil: its name, its rows (labels, names, the text and casts of their
-- timed lines) and, with no times given, its own times from its lines. times: the mechanic's casts, or nil.
function Assign.Read(text, key, times)
    local s = session(text)
    local f = find(s, key)
    if not f.heading and #f.timed == 0 then
        return nil
    end
    local block = { key = tostring(key):lower(), rows = {} }
    block.name = f.heading and trim(s.rows[f.heading].text) or tostring(key)
    for r, i in ipairs(f.labels) do
        block.rows[r] = rowFrom(s, i)
    end
    local entries = {}
    for _, i in ipairs(f.timed) do
        local row = s.rows[i]
        if row.kind == "timer" then
            local _, r = Assign.MarkerOf(row.raw)
            r = r or 1
            while #block.rows < r do
                block.rows[#block.rows + 1] = Assign.NewRow(#block.rows + 1)
            end
            entries[#entries + 1] = { r = r, ph = row.timer.ph or 1, t = row.timer.time, text = row.timer.text,
                spellId = row.timer.spellId }
        end
    end
    if #block.rows == 0 then
        block.rows[1] = Assign.NewRow(1)
    end
    fromLines(block, entries, times)
    return block
end

-- Group lists that become blocks -----------------------------------------------------------------------------

local function linkMatch(s, saved)
    local Links = CRT.NoteLinks
    return Links.Match(Links.Rows(s), Links.Lines(s), saved)
end

-- Group lists in a note's text that timed lines follow (Notes/Links.lua) and that are no block yet: a heading with
-- assignment lines under it, such as a pasted planner note. { { heading (its line), name, rows (their lines),
-- lines (how many timed lines follow them) } }.
function Assign.Candidates(text, saved)
    local s = session(text)
    local m = linkMatch(s, saved)
    local blocks = {}
    for _, key in ipairs(Assign.Keys(s)) do
        blocks[key] = true
    end
    local out = {}
    for i, row in ipairs(s.rows) do
        if row.kind == "heading" and not blocks[Assign.Key(row.text)] then
            local labels = labelsUnder(s, i)
            local n = 0
            for _, li in ipairs(labels) do
                n = n + #(m.byRow[li] or {})
            end
            if n > 0 then
                out[#out + 1] = { heading = i, name = trim(row.text), rows = labels, lines = n }
            end
        end
    end
    return out
end

-- A group list (the heading at line `heading`) as a block: its rows, and the timed lines that follow each row
-- (Links.Match) read for its text and the casts it is on, against times (the mechanic's casts) or, with none, the
-- lines' own times. Returns the block and the lines it takes in (a set: the heading, its rows, and the lines on a
-- cast; a line on none stays as it is), or nil.
function Assign.FromRows(text, heading, times, saved)
    local s = session(text)
    local row = s.rows[heading]
    if not (row and row.kind == "heading") then
        return nil
    end
    local labels = labelsUnder(s, heading)
    if #labels == 0 then
        return nil
    end
    local m = linkMatch(s, saved)
    local block = { name = Assign.CleanName(row.text), rows = {} }
    local taken = { [heading] = true }
    local entries = {}
    for r, i in ipairs(labels) do
        block.rows[r] = rowFrom(s, i)
        block.rows[r].label = Assign.CleanLabel(block.rows[r].label, r)
        taken[i] = true
        for _, line in ipairs(m.byRow[i] or {}) do
            local t = line.timer
            entries[#entries + 1] = { r = r, ph = t.ph or 1, t = t.time, text = t.text, spellId = t.spellId, index = line.index }
        end
    end
    local off = fromLines(block, entries, times)
    local skip = {}
    for _, e in ipairs(off) do
        skip[e.index] = true
    end
    for _, e in ipairs(entries) do
        if not skip[e.index] then
            taken[e.index] = true
        end
    end
    return block, taken
end

-- The text with the group list at line `heading` rewritten as a block (FromRows, then Lines in its place), and the
-- block. opts: key, spellID (default the lines'), saved (the note's saved links).
function Assign.Adopt(text, heading, times, opts)
    opts = opts or {}
    local block, taken = Assign.FromRows(text, heading, times, opts.saved)
    if not block then
        return nil
    end
    block.spellID = opts.spellID or block.spellID
    local key = opts.key or Assign.Key(block.name)
    block.key = key
    local lines = Assign.Lines(block, times or block.times, { key = key })
    return CRT.MechNote.ReplaceLines(text or "", function(i)
        return taken[i] == true
    end, lines), block
end

-- The note -------------------------------------------------------------------------------------------------------

-- Links each of the block's timed lines to its row in the note (Links.LinkTo, saved under the note's id), so the
-- note editor shows them following it.
function Assign.Link(noteKey, text, key)
    local Links = CRT.NoteLinks
    if noteKey == nil or not (Links and Links.LinkTo) then
        return 0
    end
    local s = session(text)
    local f = find(s, key)
    local pairs_ = {}
    for _, i in ipairs(f.timed) do
        local _, r = Assign.MarkerOf(s.rows[i].raw)
        local li = f.labels[r or 1]
        if li and s.rows[i].kind == "timer" then
            pairs_[#pairs_ + 1] = { line = i, row = li }
        end
    end
    return Links.LinkTo(noteKey, s, pairs_)
end

-- Writes the block's lines into the boss's note for that difficulty, in place of its old lines (and of oldKey's: a
-- renamed block keeps its place); the note is made when it has none and there are lines (MechNote.WriteWith), and the
-- timed lines are linked to their rows. Returns the note's id, or nil when there was none to write to.
function Assign.Write(encounterID, difficulty, bossName, key, lines, oldKey)
    local id = CRT.MechNote.WriteWith(encounterID, difficulty, bossName, lines, function(raw)
        return Assign.Replace(raw, key, lines, oldKey)
    end)
    local record = id and CRT.Notes:Get(id)
    if record then
        Assign.Link(id, record.raw or "", key)
    end
    return id
end

-- How many timed lines of a block a note's text has.
function Assign.CountIn(text, key)
    local _, _, f = Assign.Find(text, key)
    return #f.timed
end
