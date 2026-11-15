local ADDON, CRT = ...

-- The note check (#1288, Alex 2026-11-15): what in a raid note's callouts clashes, is missing or belongs to no one.
-- No frames; the note editor shows it as a banner (Notes/EditorCheck.lua). A complicated note (a pasted planner note
-- made into Assign blocks a piece at a time) keeps old lines beside the blocks that replaced them; this finds them.
--   Check.Run(src, saved)   src: a note's text or an editor session; saved: the note's saved links (Links.Saved).
--                           { doubles, old, missing, orphans }:
--     doubles   one player with two callouts at the same moment (phase and time) from different lines:
--               { { name, ph, t, lines = { line }, block (the Assign block's key when one of them is a block's), planned
--               (the block's callout is on a cast it has no line for yet: see missing) } }, by phase, time and name
--     old       the typed lines an Assign block replaced, which Remove old lines takes out (a set's sorted line
--               numbers): a typed line that doubles a block's callout for the same player; and a typed line at
--               one of a block's casts that follows no row and shares a word with the block's lines ("Grab {skull}
--               green orb" beside a block of "{star} green orb" rows: the callout from before the block)
--     missing   a block's typed casts (times: on its heading) that no row has a line for, when it has players:
--               { { key, name, casts = { cast number }, times = { { ph, t } } } }
--     orphans   typed text lines for a player that no group row, block row or the kick block mentions (warning
--               only), sorted line numbers
--   Never a double or an orphan: a spell's line (a cooldown: spellid: on a line no block marked) or the kick block.
--   Check.Clean(result)       whether it found nothing
--   Check.RemoveOld(text, result)   the text without the old lines (result: Run's, else run now), every other byte kept
--   Check.AddMissing(text)    the text with each block's missing casts written (Assign.Lines in its place, Replace):
--                             every row on a list of casts takes them, so a block whose last cast lost its lines
--                             gets them back; its lines keep their looks

local Check = {}
CRT.NoteCheck = Check

local Parser = CRT.NoteParser
local Model = CRT.NoteEditModel

Check.MIN_WORD = 3 -- a word shared with a block's lines counts from this many letters ("orb")

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

-- The words of a text a block's lines share with an old line: lower case, MIN_WORD letters or more, no marker code.
local function wordsOf(text, set)
    set = set or {}
    for w in tostring(text or ""):lower():gmatch("%S+") do
        if #w >= Check.MIN_WORD and not w:find("^{") then
            set[w] = true
        end
    end
    return set
end

local function shares(text, set)
    for w in pairs(wordsOf(text)) do
        if set[w] then
            return true
        end
    end
    return false
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

-- Rows on a list of casts take the casts given; a row then on every one of n casts is on all.
local function fill(block, add, n)
    local Assign = CRT.NoteAssign
    if #add == 0 then
        return
    end
    for _, row in ipairs(block.rows) do
        if type(row.casts) == "table" then
            local set, list = {}, {}
            for _, c in ipairs(row.casts) do
                set[c] = true
            end
            for _, c in ipairs(add) do
                set[c] = true
            end
            for c in pairs(set) do
                list[#list + 1] = c
            end
            table.sort(list)
            row.casts = #list >= n and Assign.ALL or list
        end
    end
end

-- One block: its missing casts (out.missing), the callouts it plans (planned[moment \1 name] = { key, line: its
-- marked line there, or nil }), as written once its missing casts are back, and its casts' moments with the words
-- of its lines (casts[moment] = { words }).
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
            out.missing[#out.missing + 1] = { key = key, name = b.name, casts = gone, times = times }
        end
    end
    fill(b, gone, #list)
    local words = {}
    for r, entries in ipairs(Assign.RowLines(b, list)) do
        for _, e in ipairs(entries) do
            for _, token in ipairs(b.rows[r].tokens) do
                local k = moment(e.ph, e.t) .. "\1" .. nameKey(token)
                planned[k] = planned[k] or { key = key, line = marked[k] }
            end
            wordsOf(e.text, words)
        end
    end
    for _, e in ipairs(list) do
        local mk = moment(e.ph, e.t)
        casts[mk] = casts[mk] or {}
        casts[mk][#casts[mk] + 1] = words
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
    local byIndex, near = {}, {}
    for _, line in ipairs(lines) do
        byIndex[line.index] = line
    end
    for _, e in ipairs(m.near) do
        near[e.line.index] = true
    end
    -- doubles, and the typed lines that double a block's callout
    local old = {}
    local at, keys = calloutsOf(lines, kick)
    for _, k in ipairs(keys) do
        local g, p = at[k], planned[k]
        local virtual = p ~= nil and p.line == nil
        if #g.lines + (virtual and 1 or 0) >= 2 then
            out.doubles[#out.doubles + 1] = { name = g.name, ph = g.ph, t = g.t, lines = g.lines, block = p and p.key, planned = virtual or nil }
            if p then
                for _, i in ipairs(g.lines) do
                    if not byIndex[i].marked then
                        old[i] = true
                    end
                end
            end
        end
    end
    -- typed lines at a block's cast, following no row, in the block's words: the callouts from before it
    local who = mentioned(s, rows, kick)
    for _, line in ipairs(lines) do
        local t = line.timer
        if callout(line) and not line.marked and not kick[line.index] and not old[line.index] then
            local list = casts[moment(t.ph, t.time)]
            if list and not m.follow[line.index] and not near[line.index] then
                for _, words in ipairs(list) do
                    if shares(t.text, words) then
                        old[line.index] = true
                        break
                    end
                end
            end
            if not old[line.index] then
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
        local b = Assign.Read(text, miss.key, nil)
        if b and b.times then
            fill(b, miss.casts, #b.times)
            text = Assign.Replace(text, miss.key, Assign.Lines(b, b.times, { key = miss.key }))
        end
    end
    return text
end
