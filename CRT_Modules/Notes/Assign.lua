local ADDON, CRT = ...

-- An assignment block: who does what on a mechanic (soaks, sides, who sends a cooldown), written into a raid note.
-- No frames: the Mech Alerts Assign tab (Notes/AssignTab.lua) and the note editor's Add assignment
-- (Notes/EditorAssign.lua) both edit a block through these functions, so both write the same lines.
-- A block is { name, rows, times, spellID, mech }:
--   name     the heading over the rows (the mechanic's name by default)
--   rows     { { label, text, tokens, casts } }: each row's label ("Left"), the text its timed lines show ("Soak
--            left"; empty: the label), its players or tag words (names, "healer", "Group1", "Demon Hunter") and the
--            casts it is on: "all", "rotate" (the rotate rows take the casts in turn: the first row cast 1, the
--            second cast 2, ...) or a list of cast numbers ({ 2, 4, 6 })
--   times    nil: the mechanic's casts, read from the ability timeline by the caller; else its own typed { { ph, t } }
--   spellID  the mechanic's spell (its icon on the timed lines), or nil
--   mech     the mechanic it belongs to (MechNote.Key: its spell ID, or its name), or nil (the note editor's own)
-- In the note, a block is its marked heading line, one "Label: names" assignment line per row, then one timed line
-- per row per cast it is on (a row with no one in it has none). Names go without their realms, one space between
-- them, as the Kick order's lines have them; a new block goes at the note's end after a blank line:
--   assign:ravenous feast;name:Ravenous Feast;for:1234;
--   Left: Solex Rixxy
--   Right: Abu Cheo
--   time:36;ph:1;tag:Solex Rixxy;spellid:1234;text:Soak left;assign:ravenous feast/1/1;
-- The heading line (Parser.AssignHeading) carries the block's key (Key: its name in lower case), its name, the
-- mechanic (for:) and its typed times (times:, "1@20,1@60": phase @ seconds, so they stay with no one in a row); every
-- reader shows it as a heading of its name (Parse, the note editor, the MRT and NSRT texts). Only a marked heading is
-- a block: a group list someone typed under a plain heading never is, until Make an Assign block (Adopt) turns it
-- into one. The timed lines carry assign:<key>/<row>/<cast> (the cast's number, so a line follows its cast when the
-- ability timeline moves it); FormatLine never writes it, so other writers keep it, and an older CRT reads the line
-- as any other timed line. The note is the one source: Read gives the block back from the text. An untimed block is
-- its heading and rows; its rows' texts and casts are then not kept, as no line shows them.
-- A key is unique in its note (KeyTaken: another block's, or a typed group list's heading). Replace writes a block in
-- place of its old lines, every other line byte for byte (MechNote.ReplaceLines); Write does it in the note the pull
-- of that difficulty reads (MechNote.WriteWith, Notes:WriteTarget), and links each timed line to its row
-- (Notes/Links.lua LinkTo), so in the note editor a change to a row's names is written on its lines too.
--   Assign.Lines(block, times, opts)     the block's lines. opts: key (default Key(name)), spellID, mech
--   Assign.Read(text, key, times)        the block with that key in a note's text, or nil
--   Assign.BlocksFor(text, mech)         the keys of a mechanic's blocks
--   Assign.KeyTaken(text, key, oldKey), Assign.FreeName(text, base)
--   Assign.Candidates(text)              group lists that timed lines follow but are no block yet (a pasted note)
--   Assign.FromRows(text, heading, times)   such a list as a block, and the lines it takes in; AdoptChanges says what
--                                        making it a block changes
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

-- A row's name as a block writes it: without its realm, as the note's other group lines (the Kick order's) have it
-- (Alex, 2026-10-30). The alerts read a tag without its realm all the same (Notes/Engine.lua). A tag word has none.
local function short(token)
    return (tostring(token or ""):gsub("%-.*$", ""))
end

local function shortAll(tokens)
    local out = {}
    for k, w in ipairs(tokens) do
        out[k] = short(w)
    end
    return out
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

-- Whether the row has the token, a player's with or without a realm, a class in any spelling.
local function hasToken(row, token)
    local lower, class = short(token):lower(), Parser.ClassOf(token)
    for _, w in ipairs(row.tokens) do
        if short(w):lower() == lower or (class and Parser.ClassOf(w) == class) then
            return true
        end
    end
    return false
end

-- Adds a player (without its realm) or tag word to row r (the palette's tokens, Model.ValidToken). False when it isn't
-- one, or the row has it already.
function Assign.AddToken(block, r, token)
    local row = block.rows[r]
    if not (row and Model.ValidToken(token)) or hasToken(row, token) then
        return false
    end
    row.tokens[#row.tokens + 1] = short(token)
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

-- "Label: names", one space between the names, as the Kick order's lines and the timed lines' tag: write them.
local function labelLine(row, r)
    local label = Assign.CleanLabel(row.label, r)
    if #row.tokens == 0 then
        return label .. ":"
    end
    return label .. ": " .. table.concat(shortAll(row.tokens), " ")
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

-- The marker a block's timed line ends in: its key, row and cast.
function Assign.Marker(key, r, c)
    return Assign.FIELD .. ":" .. key .. "/" .. r .. "/" .. c .. ";"
end

-- The block's lines: its heading, a row line per row, then its timed lines in cast order (each cast's rows in
-- their order). times: the casts (nil or empty: none, an untimed block).
function Assign.Lines(block, times, opts)
    opts = opts or {}
    local key = opts.key or Assign.Key(block.name)
    local spellID = opts.spellID or block.spellID
    spellID = type(spellID) == "number" and spellID > 0 and spellID or nil
    local out = { Assign.HeadingLine(block, key, opts.mech or block.mech) }
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
            local t = { time = e.t, ph = e.ph, tags = shortAll(row.tokens), text = Assign.RowText(row, r) }
            if spellID then
                t.kind, t.spellId = "spell", spellID
            end
            out[#out + 1] = Parser.FormatLine(t) .. Assign.Marker(key, r, c)
        end
    end
    return out
end

-- Typed times as the heading's times: field, "1@20,1@60" (phase @ seconds), and back.
local function num(n)
    return (("%.10g"):format(n))
end

function Assign.FormatTimesField(list)
    local out = {}
    for i, e in ipairs(Assign.SortTimes(list)) do
        out[i] = num(e.ph) .. "@" .. num(e.t)
    end
    return table.concat(out, ",")
end

function Assign.ParseTimesField(text)
    local out = {}
    for ph, t in tostring(text or ""):gmatch("([%d%.]+)@(%-?[%d%.]+)") do
        if tonumber(ph) and tonumber(t) then
            out[#out + 1] = { ph = tonumber(ph), t = tonumber(t) }
        end
    end
    return Assign.SortTimes(out)
end

-- A mechanic's key as the heading's for: (no ";").
local function cleanMech(mech)
    local m = mech and trim((tostring(mech):gsub("[;\r\n]", ""))):lower()
    return (m and m ~= "") and m or nil
end

-- The block's heading line: its key and name, the mechanic (for:) and its typed times (times:), when it has them.
function Assign.HeadingLine(block, key, mech)
    local out = Assign.FIELD .. ":" .. key .. ";name:" .. Assign.CleanName(block.name) .. ";"
    mech = cleanMech(mech)
    if mech then
        out = out .. "for:" .. mech .. ";"
    end
    if block.times then
        out = out .. "times:" .. Assign.FormatTimesField(block.times) .. ";"
    end
    return out
end

-- Finding a block in a note ----------------------------------------------------------------------------------

-- A line's marker: its block's key (lower case), row number and cast number (each nil when missing), or nil.
function Assign.MarkerOf(line)
    local v = Parser.Field(line or "", Assign.FIELD)
    if not v or v == "" then
        return nil
    end
    local key, r, c = v:match("^(.-)/(%d+)/(%d+)$")
    if not key then
        key, r = v:match("^(.-)/(%d+)$")
    end
    key = trim(key or v):lower()
    if key == "" then
        return nil
    end
    return key, tonumber(r), tonumber(c)
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

-- Where a block is in a session's lines: { heading (its marked heading line), labels = { line } (the assignment
-- lines right under it), timed = { line } (its marked timed lines) }. A plain heading of the same name is never it.
local function find(s, key)
    key = tostring(key or ""):lower()
    local f = { labels = {}, timed = {} }
    for i, row in ipairs(s.rows) do
        if row.kind == "timer" or row.kind == "unread" then
            if Assign.MarkerOf(row.raw) == key then
                f.timed[#f.timed + 1] = i
            end
        elseif not f.heading and row.assign and row.assign.key == key then
            f.heading, f.labels = i, labelsUnder(s, i)
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

local function blankAt(s, i)
    local row = s.rows[i]
    return row ~= nil and row.kind == "blank"
end

-- Whether a block added at the end needs a blank line before it: the line it goes after (the last one, or the one
-- before a trailing line end) is neither blank nor the header, nor is the note empty.
local function needsGap(s)
    local p, n = s.pieces, #s.pieces
    if n > 1 and p[n].text == "" and p[n].eol == "" then
        n = n - 1
    end
    local row = s.rows[n]
    return row ~= nil and row.kind ~= "blank" and row.kind ~= "header"
end

-- A block taken out: the blank line right before it goes too when only a blank line or the note's end follows it.
local function dropGap(s, set)
    local first, last
    for i in pairs(set) do
        first, last = math.min(first or i, i), math.max(last or i, i)
    end
    if first and blankAt(s, first - 1) and (s.pieces[last + 1] == nil or blankAt(s, last + 1)) then
        set[first - 1] = true
    end
end

-- The note's text with the block's lines replaced by `lines` (where its first line was, else at the end), every
-- other line byte for byte. No lines takes the block out. oldKey (optional): a renamed block's old key, whose lines
-- go too, the new ones taking their place. A new block at the end gets a blank line before it, so it never reads as
-- part of the group over it (Alex, 2026-10-30), and the blank line goes with it when it is taken out (dropGap).
function Assign.Replace(text, key, lines, oldKey)
    local s = session(text or "")
    local set, any = Assign.Find(s, key)
    if oldKey and oldKey ~= key then
        local old, oldAny = Assign.Find(s, oldKey)
        for i in pairs(old) do
            set[i] = true
        end
        any = any or oldAny
    end
    lines = lines or {}
    if not any and #lines > 0 and needsGap(s) then
        local gapped = { "" }
        for i, line in ipairs(lines) do
            gapped[i + 1] = line
        end
        lines = gapped
    elseif any and #lines == 0 then
        dropGap(s, set)
    end
    return CRT.MechNote.ReplaceLines(text or "", function(i)
        return set[i] == true
    end, lines)
end

-- The keys of the blocks in a note: their marked headings', then any its timed lines name alone, in order.
function Assign.Keys(text)
    local s = session(text)
    local out, seen = {}, {}
    local function add(key)
        if key and not seen[key] then
            seen[key] = true
            out[#out + 1] = key
        end
    end
    for _, row in ipairs(s.rows) do
        add(row.assign and row.assign.key)
    end
    for _, row in ipairs(s.rows) do
        if row.kind == "timer" then
            add((Assign.MarkerOf(row.raw)))
        end
    end
    return out
end

-- The keys of a mechanic's blocks (their headings' for:), in order.
function Assign.BlocksFor(text, mech)
    mech = cleanMech(mech)
    local out = {}
    for _, row in ipairs(session(text).rows) do
        if mech and row.assign and row.assign.mech == mech then
            out[#out + 1] = row.assign.key
        end
    end
    return out
end

-- Whether a block can't take this key in the note: another block has it, or a group list someone typed (a plain
-- heading with assignment lines under it) has that name. oldKey: the block's own key, which it keeps.
function Assign.KeyTaken(text, key, oldKey)
    key = tostring(key or ""):lower()
    if oldKey and key == tostring(oldKey):lower() then
        return false
    end
    local s = session(text)
    for _, k in ipairs(Assign.Keys(s)) do
        if k == key then
            return true
        end
    end
    for i, row in ipairs(s.rows) do
        if row.kind == "heading" and not row.assign and Assign.Key(row.text) == key and #labelsUnder(s, i) > 0 then
            return true
        end
    end
    return false
end

-- base, else "base 2", "base 3", ...: the first name whose key the note has free.
function Assign.FreeName(text, base)
    local s = session(text)
    base = Assign.CleanName(base)
    local name, n = base, 2
    while Assign.KeyTaken(s, Assign.Key(name)) do
        name = base .. " " .. n
        n = n + 1
    end
    return name
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
        -- typed times: each cast's time from its lines (by their cast numbers, else their times)
        local byCast, loose = {}, {}
        for _, e in ipairs(entries) do
            if e.cast then
                byCast[e.cast] = byCast[e.cast] or { ph = e.ph, t = e.t }
            elseif not castOf(loose, e.ph, e.t) then
                loose[#loose + 1] = { ph = e.ph, t = e.t }
            end
        end
        local numbers = {}
        for c in pairs(byCast) do
            numbers[#numbers + 1] = c
        end
        table.sort(numbers)
        list = {}
        for _, c in ipairs(numbers) do
            list[#list + 1] = byCast[c]
        end
        for _, e in ipairs(Assign.SortTimes(loose)) do
            if not castOf(list, e.ph, e.t) then
                list[#list + 1] = e
            end
        end
        -- the lines' cast numbers now count in this list
        for _, e in ipairs(entries) do
            e.cast = nil
        end
        block.times = #list > 0 and list or nil
    end
    local sets, off = {}, {}
    for _, e in ipairs(entries) do
        -- a marked line is on its cast by number (the timeline may have moved it), else by its time
        local c = (e.cast and list[e.cast]) and e.cast or castOf(list, e.ph, e.t)
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
    local h = f.heading and s.rows[f.heading].assign
    local block = { key = tostring(key):lower(), rows = {}, hasHeading = h ~= nil, hasLines = #f.timed > 0 }
    block.name = h and h.name or tostring(key)
    block.mech = h and h.mech or nil
    if h and h.times then
        block.times = Assign.ParseTimesField(h.times) -- typed times: they are the casts
    end
    for r, i in ipairs(f.labels) do
        block.rows[r] = rowFrom(s, i)
    end
    local labelled = #block.rows
    local entries = {}
    for _, i in ipairs(f.timed) do
        local row = s.rows[i]
        if row.kind == "timer" then
            local _, r, c = Assign.MarkerOf(row.raw)
            r = r or 1
            while #block.rows < r do
                block.rows[#block.rows + 1] = Assign.NewRow(#block.rows + 1)
            end
            -- a row with no assignment line (its heading's rows edited away): its names from its lines' tag:
            if r > labelled and #block.rows[r].tokens == 0 then
                block.rows[r].tokens = Parser.JoinClassWords(row.timer.tags or {})
            end
            entries[#entries + 1] = { r = r, cast = c, ph = row.timer.ph or 1, t = row.timer.time, text = row.timer.text,
                spellId = row.timer.spellId }
        end
    end
    if #block.rows == 0 then
        block.rows[1] = Assign.NewRow(1)
    end
    fromLines(block, entries, block.times or times)
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
    local out = {}
    for i, row in ipairs(s.rows) do
        if row.kind == "heading" and not row.assign then -- a block's marked heading is a block already
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
    if not (row and row.kind == "heading" and not row.assign) then
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
            entries[#entries + 1] = { r = r, ph = t.ph or 1, t = t.time, text = t.text, spellId = t.spellId, index = line.index,
                raw = s.rows[line.index].raw }
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
    block.adopted = { entries = entries, off = off }
    return block, taken
end

-- The fields a block's timed line keeps; any other (colours, a display, a sound) is dropped when a list is adopted.
local KEPT = { time = true, ph = true, tag = true, text = true, spellid = true }

-- What making the group list at line `heading` a block changes, for the confirmation: { lines (the timed lines
-- rewritten), off (left as they are: on no cast), texts (the rows whose lines had several texts, now one), dropped
-- (lines that lose other fields) }, or nil.
function Assign.AdoptChanges(text, heading, times, saved)
    local block = Assign.FromRows(text, heading, times, saved)
    if not block then
        return nil
    end
    local out = { name = block.name, lines = #block.adopted.entries - #block.adopted.off, off = #block.adopted.off, texts = {},
        dropped = 0 }
    local textsOf, off = {}, {}
    for _, e in ipairs(block.adopted.off) do
        off[e] = true -- left as they are: nothing changes on them
    end
    for _, e in ipairs(block.adopted.entries) do
        if not off[e] then
            textsOf[e.r] = textsOf[e.r] or {}
            textsOf[e.r][e.text or ""] = true
            for part in (e.raw or ""):gmatch("[^;]+") do
                local k = part:match("^%s*([^:]+):")
                if k and not KEPT[trim(k):lower()] then
                    out.dropped = out.dropped + 1
                    break
                end
            end
        end
    end
    for r, set in pairs(textsOf) do
        local n = 0
        for _ in pairs(set) do
            n = n + 1
        end
        if n > 1 then
            out.texts[#out.texts + 1] = Assign.CleanLabel(block.rows[r].label, r)
        end
    end
    table.sort(out.texts)
    return out
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
    block.mech = opts.mech
    block.adopted = nil
    -- typed times (no mechanic's casts) are kept on the heading
    if times then
        block.times = nil
    end
    local key = opts.key or Assign.Key(block.name)
    -- the list itself goes, so only the rest of the note can hold its name already
    local rest = CRT.MechNote.ReplaceLines(text or "", function(i)
        return taken[i] == true
    end, {})
    if Assign.KeyTaken(rest, key) then
        block.name = Assign.FreeName(rest, block.name)
        key = Assign.Key(block.name)
    end
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

-- Links the timed lines of every block in a saved note's text to their rows (the note editor's Save; never a text
-- that isn't saved).
function Assign.LinkAll(noteKey, text)
    local n = 0
    for _, key in ipairs(Assign.Keys(text)) do
        n = n + Assign.Link(noteKey, text, key)
    end
    return n
end

-- Writes the block's lines into the note the pull of that difficulty reads, in place of its old lines (and of oldKey's:
-- a renamed block keeps its place); the note is made when the boss has none (MechNote.WriteWith), and the timed lines
-- are linked to their rows. Refused, nothing written, when the key is another block's or list's in that note
-- (KeyTaken), in combat or a boss encounter, or when the pull reads another note. Returns the note's id, or nil and the
-- reason.
Assign.TEXT.keyTaken = "The note already has an assignment or a group list named %s. Pick another name."
function Assign.Write(encounterID, difficulty, bossName, key, lines, oldKey)
    local M = CRT.MechNote
    local target = M.FindNote(encounterID, difficulty)
    local current = target and CRT.Notes:Get(target)
    if current and lines and #lines > 0 and Assign.KeyTaken(current.raw or "", key, oldKey) then
        return nil, string.format(Assign.TEXT.keyTaken, key)
    end
    local id, _, why = M.WriteWith(encounterID, difficulty, bossName, lines, function(raw)
        return Assign.Replace(raw, key, lines, oldKey)
    end)
    local record = id and CRT.Notes:Get(id)
    if record then
        Assign.Link(id, record.raw or "", key)
    end
    return id, why
end

-- How many timed lines of a block a note's text has.
function Assign.CountIn(text, key)
    local _, _, f = Assign.Find(text, key)
    return #f.timed
end
