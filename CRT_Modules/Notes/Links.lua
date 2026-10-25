local ADDON, CRT = ...

-- Timer lines that follow an assignment line, for the note editor (Notes/EditorWindow.lua, Notes/EditorLinks.lua).
-- No frames. A raid lead's note often lists a group twice: once as an assignment line ("Left: Solex, Rixxy") and
-- again on every timed line for that group ("time:61;tag:Solex Rixxy;text:Soak First;"). When the line's names
-- change in the editor, the timed lines that follow it get the same names, so their countdowns go to the right
-- players. The note text stays plain names (Alex, 2026-10-25, option B): nothing new is written into it, so
-- older versions, sharing and the other raid note addons read it as before. Which lines follow which row is
-- worked out from the names, and remembered in CRTDB.notes.links by note.
--   Links.Rows(src)                the assignment lines: { index (its line), block (the heading above it, or ""),
--                                  label, names }. src: a session (Notes/EditModel.lua's Model.New) or a note's text
--   Links.Lines(src)               the timed lines: { index, names, sig, timer }. sig is the line's key without
--                                  its names (time, phase, spell, text, and which repeat of those), so a saved
--                                  link survives a name change
--   Links.Match(rows, lines, saved)   { follow = line index -> { row, saved }, byRow = row index -> lines,
--                                  exact = { { line, row } } (followed with no saved link: Link asks for them),
--                                  near = { { line, row, extra, missing, saved } } }. A line follows a row when it
--                                  lists the same players (any order, any case, realms ignored, as the alerts
--                                  read names): the row its saved link names, else the first row like it (an
--                                  implicit link, which needs no saved data, so a note shared from another raid
--                                  lead works too). A line one or two players off a row is a near-miss; so is a
--                                  linked line that no longer lists its row's players (edited by hand: it stops
--                                  following until it matches again).
--   Links.Summary(match)           for the editor's banner: exact and near grouped by row, the totals, and fix,
--                                  the one obvious fix (every near-miss on one row, listing the same extra
--                                  players and leaving no one out): { row, add = names }
--   Links.Snapshot(s, saved), Links.Apply(s, snap)   around a change to a session's rows: each row's names and
--                                  followers before it, then every row whose names changed has them written on
--                                  its followers, in the row's order (Session:SetTimerNames). Returns how many
--   Links.Rewrite(text, lineNumbers, names)   the text with those lines' names replaced, the rest as written
--   Links.Saved(key), Links.Link(key, s, lineIndices)   a note's saved links (key: the note's id, or "personal")
--   Links.Dismiss(key, text), Links.Dismissed(key, text)   Not now: the banner hidden until the text changes
--   Links.Forget(key)              a deleted note's links
-- Saved: CRTDB.notes.links[key] = { links = { { block, row (its label), sigs = { sig } } }, dismissed }. Never in
-- Export settings (Profiles.SHARE), as notes aren't.

local Links = {}
CRT.NoteLinks = Links

local Parser = CRT.NoteParser
local Model = CRT.NoteEditModel

Links.MIN_NAMES = 2 -- a row or line of one name links nothing: too likely by chance
Links.NEAR_MAX = 2 -- a near-miss differs from its row by at most this many players

local function trim(s)
    return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

local function num(n)
    return (("%.10g"):format(n))
end

-- A name as the alerts compare it (Notes/Engine.lua's IsMine): any case, the realm left out.
local function nameKey(name)
    return (name:lower():gsub("%-.*$", ""))
end

local function session(src)
    if type(src) == "table" then
        return src
    end
    return Model.New(src or "")
end

-- Reading ----------------------------------------------------------------------------------------------------

function Links.Rows(src)
    local s = session(src)
    local out, block = {}, ""
    for i, row in ipairs(s.rows) do
        if row.kind == "heading" then
            block = row.text or ""
        elseif row.kind == "label" then
            out[#out + 1] = { index = i, block = block, label = trim(row.label or ""), names = s:Names(i) }
        end
    end
    return out
end

function Links.Lines(src)
    local s = session(src)
    local out, seen = {}, {}
    for i, row in ipairs(s.rows) do
        if row.kind == "timer" then
            local t = row.timer
            local base = table.concat({ num(t.time), num(t.ph or 1), t.spellId and num(t.spellId) or "", t.text or "" }, "|")
            seen[base] = (seen[base] or 0) + 1
            out[#out + 1] = { index = i, names = s:TimerNames(i), sig = base .. "#" .. seen[base], timer = t, time = row.time,
                ph = row.ph }
        end
    end
    return out
end

-- Matching ---------------------------------------------------------------------------------------------------

-- The distinct names of a list, by nameKey, and how many.
local function keySet(names)
    local set, n = {}, 0
    for _, name in ipairs(names) do
        local k = nameKey(name)
        if not set[k] then
            set[k] = true
            n = n + 1
        end
    end
    return set, n
end

-- The line's players not in the row (extra) and the row's not on the line (missing), as written, and how many
-- distinct players each has.
local function compare(lineNames, rowNames)
    local lineSet, lineN = keySet(lineNames)
    local rowSet, rowN = keySet(rowNames)
    local extra, missing, done = {}, {}, {}
    for _, name in ipairs(lineNames) do
        local k = nameKey(name)
        if not rowSet[k] and not done[k] then
            done[k] = true
            extra[#extra + 1] = name
        end
    end
    for _, name in ipairs(rowNames) do
        local k = nameKey(name)
        if not lineSet[k] and not done[k] then
            done[k] = true
            missing[#missing + 1] = name
        end
    end
    return extra, missing, lineN, rowN
end

-- The row a saved link names: the same block and label, else the only row with that label (its heading renamed).
local function findRow(rows, block, label)
    local only, n = nil, 0
    for _, row in ipairs(rows) do
        if row.label == label then
            if row.block == block then
                return row
            end
            only, n = row, n + 1
        end
    end
    return n == 1 and only or nil
end

local function follow(m, line, row, saved)
    m.follow[line.index] = { row = row, saved = saved }
    local list = m.byRow[row.index] or {}
    m.byRow[row.index] = list
    list[#list + 1] = line
    if not saved then
        m.exact[#m.exact + 1] = { line = line, row = row }
    end
end

-- A line with no saved link: the first row with the same players, else the one row it is closest to.
local function bestRow(m, line, rows)
    local _, lineN = keySet(line.names)
    if lineN < Links.MIN_NAMES then
        return
    end
    local best, bestD, tie
    for _, row in ipairs(rows) do
        local extra, missing, _, rowN = compare(line.names, row.names)
        local d = #extra + #missing
        if rowN >= Links.MIN_NAMES then
            if d == 0 then
                follow(m, line, row, false)
                return
            end
            if d <= Links.NEAR_MAX and lineN - #extra >= Links.MIN_NAMES then
                if not bestD or d < bestD then
                    best, bestD, tie = { line = line, row = row, extra = extra, missing = missing }, d, false
                elseif d == bestD then
                    tie = true
                end
            end
        end
    end
    if best and not tie then
        m.near[#m.near + 1] = best
    end
end

function Links.Match(rows, lines, saved)
    local m = { rows = rows, lines = lines, follow = {}, byRow = {}, exact = {}, near = {} }
    local savedRow = {}
    for _, link in ipairs(saved or {}) do
        local row = type(link) == "table" and findRow(rows, link.block, link.row)
        if row then
            for _, sig in ipairs(link.sigs or {}) do
                savedRow[sig] = savedRow[sig] or row
            end
        end
    end
    for _, line in ipairs(lines) do
        local row = savedRow[line.sig]
        if row then
            local extra, missing = compare(line.names, row.names)
            if #extra == 0 and #missing == 0 and #row.names > 0 then
                follow(m, line, row, true)
            else
                m.near[#m.near + 1] = { line = line, row = row, extra = extra, missing = missing, saved = true }
            end
        else
            bestRow(m, line, rows)
        end
    end
    return m
end

local function namesKey(list)
    local out = {}
    for k, name in ipairs(list) do
        out[k] = nameKey(name)
    end
    table.sort(out)
    return table.concat(out, " ")
end

function Links.Summary(m)
    local sum = { exact = {}, near = {}, exactCount = #m.exact, nearCount = #m.near }
    sum.total = sum.exactCount + sum.nearCount
    local byKey = {}
    for _, e in ipairs(m.exact) do
        local g = byKey[e.row.index]
        if not g then
            g = { row = e.row, lines = {} }
            byKey[e.row.index] = g
            sum.exact[#sum.exact + 1] = g
        end
        g.lines[#g.lines + 1] = e.line
    end
    byKey = {}
    local fix, fixKey
    for k, e in ipairs(m.near) do
        local key = table.concat({ e.row.index, namesKey(e.extra), namesKey(e.missing), e.saved and "s" or "" }, "\1")
        local g = byKey[key]
        if not g then
            g = { row = e.row, extra = e.extra, missing = e.missing, saved = e.saved, lines = {} }
            byKey[key] = g
            sum.near[#sum.near + 1] = g
        end
        g.lines[#g.lines + 1] = e.line
        -- the one obvious fix: every near-miss the same row and the same extra players, no one left out
        local mine = e.row.index .. "\1" .. namesKey(e.extra)
        if k == 1 and #e.extra > 0 and #e.missing == 0 then
            fix, fixKey = { row = e.row, add = e.extra }, mine
        elseif fix and (mine ~= fixKey or #e.missing > 0) then
            fix = false
        end
    end
    sum.fix = fix or nil
    return sum
end

-- Writing ----------------------------------------------------------------------------------------------------

-- Whether names can go in a tag: no field or line marks in them.
local function writable(names)
    for _, name in ipairs(names) do
        if type(name) ~= "string" or name == "" or name:find("[;:|\r\n]") then
            return false
        end
    end
    return #names > 0
end

local function sameList(a, b)
    if #a ~= #b then
        return false
    end
    for k, v in ipairs(a) do
        if v ~= b[k] then
            return false
        end
    end
    return true
end

function Links.Snapshot(s, saved)
    local m = Links.Match(Links.Rows(s), Links.Lines(s), saved)
    local snap = {}
    for _, row in ipairs(m.rows) do
        local list = m.byRow[row.index]
        if list then
            snap[#snap + 1] = { index = row.index, names = row.names, lines = list }
        end
    end
    return snap
end

function Links.Apply(s, snap)
    local n = 0
    for _, e in ipairs(snap or {}) do
        local now = s:Names(e.index)
        -- an emptied row leaves its lines as they are: a countdown for no one helps nobody
        if not sameList(now, e.names) and writable(now) then
            for _, line in ipairs(e.lines) do
                if s:SetTimerNames(line.index, now) then
                    n = n + 1
                end
            end
        end
    end
    return n
end

function Links.Rewrite(text, lineNumbers, names)
    local pieces = CRT.Notes.SplitPieces(text or "")
    if writable(names) then
        local value = table.concat(names, " ")
        for _, n in ipairs(lineNumbers or {}) do
            local piece = pieces[n]
            local line = piece and Parser.ReplaceField(piece.text, "tag", value)
            if line then
                piece.text = line
            end
        end
    end
    local out = {}
    for k, piece in ipairs(pieces) do
        out[k] = piece.text .. piece.eol
    end
    return table.concat(out)
end

-- Saved links ------------------------------------------------------------------------------------------------

local function store(create)
    local db = CRT.db and CRT.db.notes
    if not db then
        return nil
    end
    if create and type(db.links) ~= "table" then
        db.links = {}
    end
    return type(db.links) == "table" and db.links or nil
end

local function entry(key, create)
    local st = key ~= nil and store(create)
    if not st then
        return nil
    end
    if create and type(st[key]) ~= "table" then
        st[key] = {}
    end
    return st[key]
end

function Links.Saved(key)
    local e = entry(key, false)
    return (e and type(e.links) == "table") and e.links or {}
end

-- Saves a link for each of the lines (by index) that follows a row now; links to lines no longer in the note are
-- dropped. Returns how many of the lines are linked.
function Links.Link(key, s, indices)
    if key == nil then
        return 0
    end
    local lines = Links.Lines(s)
    local m = Links.Match(Links.Rows(s), lines, Links.Saved(key))
    local want = {}
    for _, i in ipairs(indices or {}) do
        want[i] = true
    end
    local present = {}
    for _, line in ipairs(lines) do
        present[line.sig] = line
    end
    local out, byRow, n = {}, {}, 0
    local function add(block, label, sig)
        local id = block .. "\1" .. label
        local link = byRow[id]
        if not link then
            link = { block = block, row = label, sigs = {}, has = {} }
            byRow[id] = link
            out[#out + 1] = link
        end
        if not link.has[sig] then
            link.has[sig] = true
            link.sigs[#link.sigs + 1] = sig
        end
    end
    -- the links kept: their lines still in the note and not linked anew below
    for _, link in ipairs(Links.Saved(key)) do
        for _, sig in ipairs(link.sigs or {}) do
            local line = present[sig]
            if line and not want[line.index] then
                add(link.block or "", link.row or "", sig)
            end
        end
    end
    for _, line in ipairs(lines) do
        local f = want[line.index] and m.follow[line.index]
        if f then
            add(f.row.block, f.row.label, line.sig)
            n = n + 1
        end
    end
    for _, link in ipairs(out) do
        link.has = nil
    end
    entry(key, true).links = out
    return n
end

-- A short fingerprint of a text, so Not now can tell when the note changed without keeping a copy of it.
local function fingerprint(text)
    local h = 0
    for i = 1, #text do
        h = (h * 31 + text:byte(i)) % 2147483647
    end
    return #text .. ":" .. h
end

function Links.Dismiss(key, text)
    local e = entry(key, true)
    if e then
        e.dismissed = fingerprint(text or "")
    end
end

function Links.Dismissed(key, text)
    local e = entry(key, false)
    return e ~= nil and e.dismissed ~= nil and e.dismissed == fingerprint(text or "")
end

function Links.Forget(key)
    local st = store(false)
    if st and key ~= nil then
        st[key] = nil
    end
end
