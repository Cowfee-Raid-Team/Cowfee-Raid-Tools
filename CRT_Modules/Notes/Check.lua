local ADDON, CRT = ...

-- The note check (#1288, Alex 2026-11-15): what in a raid note's callouts clashes, is missing or belongs to no one.
-- No frames; the note editor shows it as a banner (Notes/EditorCheck.lua). A complicated note (a pasted planner note
-- made into Assign blocks a piece at a time) keeps old lines beside the blocks that replaced them; this finds them.
--   Check.Run(src, saved)   src: a note's text or an editor session; saved: the note's saved links (Links.Saved).
--                           { doubles, old, missing, orphans }:
--     doubles   one player with two callouts at the same moment (phase and time) from different lines:
--               { { name, ph, t, lines = { line }, block (the Assign block's key when one of them is a block's), planned
--               (the block's callout is on a cast it has no line for yet: see missing) } }, by phase, time and name
--     old       the typed lines an Assign block replaced, which Remove old lines takes out (sorted line numbers). Only
--               a typed line that follows no row of a list (nor is close to one) and whose text fits a block row's
--               wording (Links.Fits): one that doubles that row's callout for the same player ("Grab {cross} purple
--               orb" for Sixz beside the block's "{cross} purple orb: Sixz"), or one for players only, at one of the
--               block's casts ("Grab {star} green orb" for Gadios where the block's "{star} green orb" row now names
--               someone else). A line that follows another list's row ("Kicks: Abu") or is for a role is never old.
--     missing   a block's typed casts (times: on its heading) that no row has a line for, when it has players:
--               { { key, name, casts = { cast number }, times = { { ph, t } }, fixable (Add missing casts can write
--               them: some row is on every cast) } }
--     orphans   typed text lines for a player that no group row, block row or the kick block mentions (warning
--               only), sorted line numbers
--   Never a double or an orphan: a spell's line (a cooldown: spellid: on a line no block marked) or the kick block.
--   Check.Clean(result)       whether it found nothing
--   Check.RemoveOld(text, result)   the text without the old lines (result: Run's, else run now), every other byte kept
--   Check.AddMissing(text)    the text with each block's missing casts written (Assign.Lines in its place, Replace),
--                             only on rows set to every cast (Alex, 2026-11-15): "all", or a row whose lines are on
--                             every cast but the missing ones (its lines for them went, so Read sees a list). Rotate
--                             and picked-cast rows never get them; then the warning stays. Its lines keep their looks.

local Check = {}
CRT.NoteCheck = Check

local Parser = CRT.NoteParser
local Model = CRT.NoteEditModel

local function session(src)
    if type(src) == "table" then
        return src
    end
    return Model.New(src or "")
end

local function num(n)
    return (("%.10g"):format(n))
end

-- A name as the alerts compare it (Notes/Engine.lua's IsMine): any case, the realm left out.
local function nameKey(name)
    return (tostring(name):lower():gsub("%-.*$", ""))
end

-- A moment: the phase and the time, to a tenth of a second.
local function moment(ph, t)
    return num(ph or 1) .. "@" .. ("%.1f"):format(t or 0)
end

-- Whether a tag word names a player: no role, everyone or group word, no class.
local function isPlayer(word)
    local lower = tostring(word):lower()
    if Parser.TAG_WORDS[lower] or Parser.GROUP_WORDS[lower] or lower:match("^g%d+$") or lower:match("^grp%d+$")
        or lower:match("^group%d+$") or not lower:find("%a") then
        return false
    end
    return Parser.ClassOf(word) == nil
end

-- Whether every name of a line is a player's (and it has one).
local function allPlayers(names)
    for _, name in ipairs(names) do
        if not isPlayer(name) then
            return false
        end
    end
    return #names > 0
end

-- Whether a line's text fits a block row's wording (its label or its own text), as Links reads wording.
local function fitsRow(text, row)
    local Links = CRT.NoteLinks
    return Links.Fits(text, row.label) ~= nil or (row.text ~= nil and Links.Fits(text, row.text) ~= nil)
end

-- A callout line: a timed line with a text, never a cooldown (a spell's line no block marked).
local function callout(line)
    local t = line.timer
    return t.text ~= nil and t.text ~= "" and (line.marked or not t.spellId)
end

local function castAt(list, ph, t)
    local same = CRT.NoteAssign.SAME_TIME
    for c, e in ipairs(list) do
        if e.ph == (ph or 1) and math.abs(e.t - t) < same then
            return c
        end
    end
    return nil
end

-- The rows set to every cast of n, the casts in `gone` having lost their lines: "all", or a list of every other cast.
local function everyCast(row, gone, n)
    if row.casts == CRT.NoteAssign.ALL then
        return true
    end
    if type(row.casts) ~= "table" then
        return false
    end
    local set = {}
    for _, c in ipairs(row.casts) do
        set[c] = true
    end
    for _, c in ipairs(gone) do
        set[c] = true
    end
    for c = 1, n do
        if not set[c] then
            return false
        end
    end
    return true
end

-- Rows set to every cast are on all of them again (gone back); every other row stays as it is. How many rows changed.
local function fill(block, gone, n)
    local count = 0
    if #gone == 0 then
        return 0
    end
    for _, row in ipairs(block.rows) do
        if #row.tokens > 0 and type(row.casts) == "table" and everyCast(row, gone, n) then
            row.casts = CRT.NoteAssign.ALL
            count = count + 1
        elseif #row.tokens > 0 and row.casts == CRT.NoteAssign.ALL then
            count = count + 1
        end
    end
    return count
end

-- One block: its missing casts (out.missing), the callouts it plans (planned[moment \1 name] = { key, row, line: its
-- marked line there, or nil }), as written once Add missing casts ran, and its casts' moments with its rows
-- (casts[moment] = { { key, rows } }).
local function readBlock(s, key, out, planned, casts)
    local Assign = CRT.NoteAssign
    local b = Assign.Read(s, key, nil)
    local _, _, f = Assign.Find(s, key)
    local list = b and Assign.SortTimes(b.times) or {}
    if #list == 0 then
        return
    end
    local has, marked = {}, {}
    for _, i in ipairs(f.timed) do
        local row = s.rows[i]
        if row.kind == "timer" then
            local t = row.timer
            local c = castAt(list, t.ph, t.time)
            if c then
                has[c] = true
            end
            for _, name in ipairs(s:TimerNames(i)) do
                marked[moment(t.ph, t.time) .. "\1" .. nameKey(name)] = i
            end
        end
    end
    local gone = {}
    local head = f.heading and s.rows[f.heading].assign
    if head and head.times and Assign.HasNames(b) then
        local times = {}
        for c, e in ipairs(list) do
            if not has[c] then
                gone[#gone + 1] = c
                times[#times + 1] = { ph = e.ph, t = e.t }
            end
        end
        if #gone > 0 then
            out.missing[#out.missing + 1] = { key = key, name = b.name, casts = gone, times = times, fixable = fill(b, gone, #list) > 0 }
        end
    end
    for r, entries in ipairs(Assign.RowLines(b, list)) do
        for _, e in ipairs(entries) do
            for _, token in ipairs(b.rows[r].tokens) do
                local k = moment(e.ph, e.t) .. "\1" .. nameKey(token)
                planned[k] = planned[k] or { key = key, row = b.rows[r], line = marked[k] }
            end
        end
    end
    for _, e in ipairs(list) do
        local mk = moment(e.ph, e.t)
        casts[mk] = casts[mk] or {}
        casts[mk][#casts[mk] + 1] = { key = key, rows = b.rows }
    end
end

local function sortedSet(set)
    local out = {}
    for i in pairs(set) do
        out[#out + 1] = i
    end
    table.sort(out)
    return out
end

-- Each player's callouts by moment: at[moment \1 name] = { name, ph, t, lines }, and the keys by phase, time, name.
local function calloutsOf(lines, kick)
    local at, keys = {}, {}
    for _, line in ipairs(lines) do
        if callout(line) and not kick[line.index] then
            local t = line.timer
            local done = {}
            for _, name in ipairs(line.names) do
                local k = moment(t.ph, t.time) .. "\1" .. nameKey(name)
                if not done[k] then
                    done[k] = true
                    if not at[k] then
                        at[k] = { name = name, ph = t.ph or 1, t = t.time, lines = {} }
                        keys[#keys + 1] = k
                    end
                    at[k].lines[#at[k].lines + 1] = line.index
                end
            end
        end
    end
    table.sort(keys, function(a, b)
        local x, y = at[a], at[b]
        if x.ph ~= y.ph then
            return x.ph < y.ph
        elseif x.t ~= y.t then
            return x.t < y.t
        end
        return nameKey(x.name) < nameKey(y.name)
    end)
    return at, keys
end

-- Who the note's rows and kick block mention, by nameKey.
local function mentioned(s, rows, kick)
    local out = {}
    for _, row in ipairs(rows) do
        for _, name in ipairs(row.names) do
            out[nameKey(name)] = true
        end
    end
    for i in pairs(kick) do
        local p = s.pieces[i]
        for w in (p and p.text or ""):gmatch("[^%s,]+") do
            out[nameKey(w)] = true
        end
    end
    return out
end

-- Whether a typed line at one of a block's casts is that block's old callout: for players only, and its text fits one
-- of the block's rows.
local function blockWording(line, list)
    if not (list and allPlayers(line.names)) then
        return false
    end
    for _, blk in ipairs(list) do
        for _, row in ipairs(blk.rows) do
            if fitsRow(line.timer.text, row) then
                return true
            end
        end
    end
    return false
end

function Check.Run(src, saved)
    local s = session(src)
    local Links, Assign = CRT.NoteLinks, CRT.NoteAssign
    local rows, lines = Links.Rows(s), Links.Lines(s)
    local m = Links.Match(rows, lines, saved)
    local kick = Assign.KickLines(s)
    local out = { doubles = {}, old = {}, missing = {}, orphans = {} }
    local planned, casts = {}, {}
    for _, key in ipairs(Assign.Keys(s)) do
        readBlock(s, key, out, planned, casts)
    end
    -- a typed line that follows a list's row, or is close to one, is that list's: never old
    local byIndex, listed = {}, {}
    for _, line in ipairs(lines) do
        byIndex[line.index] = line
        if m.follow[line.index] then
            listed[line.index] = true
        end
    end
    for _, e in ipairs(m.near) do
        listed[e.line.index] = true
    end
    -- doubles, and the typed lines that double a block's callout in its row's words
    local old = {}
    local at, keys = calloutsOf(lines, kick)
    for _, k in ipairs(keys) do
        local g, p = at[k], planned[k]
        local virtual = p ~= nil and p.line == nil
        if #g.lines + (virtual and 1 or 0) >= 2 then
            out.doubles[#out.doubles + 1] = { name = g.name, ph = g.ph, t = g.t, lines = g.lines, block = p and p.key, planned = virtual or nil }
            for _, i in ipairs(p and g.lines or {}) do
                local line = byIndex[i]
                if not line.marked and not listed[i] and fitsRow(line.timer.text, p.row) then
                    old[i] = true
                end
            end
        end
    end
    -- typed lines for players at a block's cast, following no row, in a block row's words: the callouts from before it
    local who = mentioned(s, rows, kick)
    for _, line in ipairs(lines) do
        local t = line.timer
        if callout(line) and not line.marked and not kick[line.index] and not old[line.index] then
            if not listed[line.index] and blockWording(line, casts[moment(t.ph, t.time)]) then
                old[line.index] = true
            else
                for _, name in ipairs(line.names) do
                    if isPlayer(name) and not who[nameKey(name)] then
                        out.orphans[#out.orphans + 1] = line.index
                        break
                    end
                end
            end
        end
    end
    out.old = sortedSet(old)
    table.sort(out.orphans)
    return out
end

function Check.Clean(r)
    return r ~= nil and #r.doubles == 0 and #r.old == 0 and #r.missing == 0 and #r.orphans == 0
end

-- The text without the lines in `set` (line numbers), every other byte as written; lines that ended the note (no line
-- end after them): the line before them ends it again (as Assign's cut does).
local function without(text, set)
    local pieces = CRT.Notes.SplitPieces(text)
    local out = CRT.MechNote.ReplaceLines(text, function(i)
        return set[i] == true
    end, {})
    local n = #pieces
    if n > 0 and set[n] and pieces[n].eol == "" then
        local keep = n - 1
        while keep > 0 and set[keep] do
            keep = keep - 1
        end
        local eol = keep > 0 and pieces[keep].eol or ""
        if eol ~= "" and out:sub(-#eol) == eol then
            out = out:sub(1, #out - #eol)
        end
    end
    return out
end

function Check.RemoveOld(text, r)
    text = text or ""
    r = r or Check.Run(text)
    if #r.old == 0 then
        return text
    end
    local set = {}
    for _, i in ipairs(r.old) do
        set[i] = true
    end
    return without(text, set)
end

function Check.AddMissing(text)
    local Assign = CRT.NoteAssign
    text = text or ""
    for _, miss in ipairs(Check.Run(text).missing) do
        local b = miss.fixable and Assign.Read(text, miss.key, nil)
        if b and b.times then
            fill(b, miss.casts, #b.times)
            text = Assign.Replace(text, miss.key, Assign.Lines(b, b.times, { key = miss.key }))
        end
    end
    return text
end
