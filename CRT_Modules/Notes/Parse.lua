local ADDON, CRT = ...

-- Reads a raid note's text. The format is lines of "key:value;" pairs:
--   EncounterID:3470;Difficulty:Mythic;Name:Nek'zali              the boss this note is for
--   time:34;ph:1;tag:Cheoeqar;spellid:64843;                     a spell for a player, 34s into phase 1
--   ph:1;time:34;tag:Cheoeqar;spellid:64843;                     the same, with ph first
--   time:48;ph:1;tag:Abu Sixz;text:Group 1 go in;dur:8;colors:0 1 1 1;DisplayType:Text;
--                                                                a text callout shown for 8 seconds
--   invitelist:Name-Realm,Name-Realm,,Name-Realm;                the roster, in group order
-- Any other line is free text shown under the timers. A tag is one or more player names, role words
-- (tank, healer, dps, melee, ranged, all) or class names, separated by spaces.
-- A timed line may also say how it shows. Without show: it shows as it always has.
--   show:icon,text;   only these displays: alert, text, icon, bar, circle, timeline
--   tts:1; count:1;   read the line out; count down 3, 2, 1
--   ttsat:0;          read the line out at its time, not when it shows (absent: when it shows)
--   sound:RAID_WARNING; glow:1; warn:6; linger:3; icon:135940;
-- DisplayType: is ignored.

local Parser = {}
CRT.NoteParser = Parser

local function trim(s)
    return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

-- "key:value;key:value;" into a table with lowercase keys.
local function fields(line)
    local out = {}
    for part in line:gmatch("[^;]+") do
        local key, value = part:match("^%s*([^:]+):(.*)$")
        if key then
            out[trim(key):lower()] = trim(value)
        end
    end
    return out
end

local function words(s)
    local out = {}
    for word in (s or ""):gmatch("%S+") do
        out[#out + 1] = word
    end
    return out
end

local function color(s)
    local r, g, b, a = (s or ""):match("([%d%.]+)%s+([%d%.]+)%s+([%d%.]+)%s*([%d%.]*)")
    if r then
        return { tonumber(r) or 1, tonumber(g) or 1, tonumber(b) or 1, tonumber(a) or 1 }
    end
    return nil
end

local SHOW_WORDS = { "alert", "text", "icon", "bar", "circle", "timeline" }
local IS_SHOW_WORD = {}
for _, w in ipairs(SHOW_WORDS) do
    IS_SHOW_WORD[w] = true
end

-- "icon, Text" into { icon = true, text = true }. Unknown words are left out.
local function showSet(s)
    local set = {}
    for word in s:gmatch("[^,]+") do
        word = trim(word):lower()
        if IS_SHOW_WORD[word] then
            set[word] = true
        end
    end
    return set
end

local YES = { ["1"] = true, ["true"] = true, yes = true }
local function flag(s)
    if s and YES[s:lower()] then
        return true
    end
    return nil
end

-- Comma separated, keeping empty entries so a blank leaves an empty group slot.
local function nameList(s)
    local names, pos = {}, 1
    while true do
        local comma = s:find(",", pos, true)
        names[#names + 1] = trim(s:sub(pos, (comma or 0) - 1))
        if not comma then
            break
        end
        pos = comma + 1
    end
    return names
end

-- Class words -------------------------------------------------------------------------------------
-- The one table of the words that name a class in a note, read by the note editor (EditModel.lua), the
-- alerts (Engine.lua), the rendered note (Render.lua) and the integrations (Integrations/*.lua):
--   Parser.ClassName(file)        the name a note writes for a class: "Demon Hunter", with its space
--   Parser.ClassOf(text)          the class file a class name names in any spelling, or nil
--   Parser.ClassAt(words, i)      the class the words from i on start with, how many words it takes, and
--                                 whether it surely is one (see sure)
--   Parser.ClassRuns(s, pattern)  the words of a line with each class name of several words made one item
--   Parser.JoinClassWords(words)  the words with each class name of several words made one, "Demon Hunter"
-- A spelling is matched in any case and with its spaces left out, so "Demon Hunter", "DemonHunter" and
-- "DEMONHUNTER" (the class file, which the editor used to write) are all the Demon Hunter. A note is shared
-- across clients, so the name written is the English one, kept here by class file; the client's own class
-- names are read too. A class the game adds later comes from GetClassInfo, written by the game's name.
local CLASS_NAMES = {
    { "WARRIOR", "Warrior" }, { "PALADIN", "Paladin" }, { "HUNTER", "Hunter" }, { "ROGUE", "Rogue" },
    { "PRIEST", "Priest" }, { "DEATHKNIGHT", "Death Knight" }, { "SHAMAN", "Shaman" }, { "MAGE", "Mage" },
    { "WARLOCK", "Warlock" }, { "MONK", "Monk" }, { "DRUID", "Druid" }, { "DEMONHUNTER", "Demon Hunter" },
    { "EVOKER", "Evoker" },
}

local function readable(v)
    return not (issecretvalue and issecretvalue(v))
end

local function spellingKey(s)
    return (s:gsub("%s+", ""):lower())
end

-- { byKey = spelling -> file, written = a class name as written (any case kept) -> true, names = file -> name,
-- most = the most words in a name }
local classWords

local function buildClassWords()
    local w = { byKey = {}, written = {}, names = {}, most = 1 }
    local function add(file, spelling)
        if readable(spelling) and type(spelling) == "string" and spelling ~= "" then
            w.most = math.max(w.most, select(2, spelling:gsub("%S+", "")))
            w.written[spelling] = true
            local key = spellingKey(spelling)
            if key ~= "" and w.byKey[key] == nil then
                w.byKey[key] = file
            end
        end
    end
    for _, c in ipairs(CLASS_NAMES) do
        w.names[c[1]] = c[2]
        add(c[1], c[1])
        add(c[1], c[2])
    end
    local fromGame = false
    for i = 1, GetNumClasses and GetNumClasses() or 0 do
        local ok, name, file = pcall(GetClassInfo, i)
        if ok and readable(file) and type(file) == "string" and file ~= "" then
            fromGame = true
            add(file, file)
            add(file, name)
            if w.names[file] == nil and readable(name) and type(name) == "string" and name ~= "" then
                w.names[file] = name
            end
        end
    end
    for _, list in ipairs({ LOCALIZED_CLASS_NAMES_MALE, LOCALIZED_CLASS_NAMES_FEMALE }) do
        if type(list) == "table" then
            for file, name in pairs(list) do
                if type(file) == "string" then
                    add(file, name)
                end
            end
        end
    end
    -- kept once the game has listed its classes; before that (or with no game) asked again next time
    classWords = fromGame and w or nil
    return w
end

local function classTable()
    return classWords or buildClassWords()
end

function Parser.ClassName(file)
    return type(file) == "string" and classTable().names[file] or nil
end

function Parser.ClassOf(text)
    if not (readable(text) and type(text) == "string") then
        return nil
    end
    local key = spellingKey(text)
    return key ~= "" and classTable().byKey[key] or nil
end

-- Whether one word that matches a class surely names it: in capitals as a class file is ("DEMONHUNTER"), or a
-- class name exactly as written ("Hunter", the client's own name). "Deathknight" may be a player and "hunter" a
-- word of a sentence, so they are matched but not sure. A class name of several words is always sure.
local function sure(w, word)
    return w.written[word] == true or (word:upper() == word and word:find("%u") ~= nil)
end

-- The longest run of words from i that names a class, so "Demon Hunter" is never read as Hunter. Returns the
-- class file, how many words, and whether it surely is the class; nil when the words name none.
function Parser.ClassAt(words, i)
    local w = classTable()
    local joined = ""
    local best, bestN
    for n = 1, math.min(w.most, #words - i + 1) do
        local word = words[i + n - 1]
        if not (readable(word) and type(word) == "string") then
            break
        end
        joined = joined .. spellingKey(word)
        local file = w.byKey[joined]
        if file then
            best, bestN = file, n
        end
    end
    if not best then
        return nil
    end
    return best, bestN, bestN > 1 or sure(w, words[i])
end

-- The words of s (each a match of pattern) as items { start, stop (one past its end), text (as written), class
-- (the class file or nil), sure }, a class name of several words with only spaces between them made one item
-- ("Demon Hunter"; "Demon, Hunter" and a tab keep two). The note editor, the rendered note and the integrations
-- cut their lines with it.
function Parser.ClassRuns(s, pattern)
    local found = {}
    for start, word, stop in s:gmatch("()(" .. pattern .. ")()") do
        found[#found + 1] = { start = start, word = word, stop = stop }
    end
    local out, k = {}, 1
    while k <= #found do
        local run = { found[k].word }
        for j = k + 1, #found do
            if not s:sub(found[j - 1].stop, found[j].start - 1):match("^ +$") then
                break
            end
            run[#run + 1] = found[j].word
        end
        local file, n, isSure = Parser.ClassAt(run, 1)
        n = n or 1
        local first, last = found[k], found[k + n - 1]
        out[#out + 1] = { start = first.start, stop = last.stop, text = s:sub(first.start, last.stop - 1), class = file,
            sure = isSure or false }
        k = k + n
    end
    return out
end

function Parser.JoinClassWords(words)
    local out, i = {}, 1
    while i <= #words do
        local file, n = Parser.ClassAt(words, i)
        if file and n > 1 then
            out[#out + 1] = table.concat(words, " ", i, i + n - 1)
            i = i + n
        else
            out[#out + 1] = words[i]
            i = i + 1
        end
    end
    return out
end

-- Whether the part before a line's colon reads as an assignment's label: short, with no markup ("{time:1:30}" and
-- the other {..} codes of shared notes, "|c" colours), and not a phase heading ("Phase 2: kite adds left"). The note
-- editor's label lines (EditModel.lua) and the integrations' class names read the same lines.
local LABEL_MAX_WORDS = 4 -- a label longer than this ("Stack on the boss and then: ...") is a sentence
function Parser.LooksLikeLabel(label)
    local t = trim(label)
    if t == "" or t:find("{", 1, true) or t:find("|", 1, true) then
        return false
    end
    local n = 0
    for _ in t:gmatch("%S+") do
        n = n + 1
    end
    if n > LABEL_MAX_WORDS then
        return false
    end
    local lower = t:lower()
    return not (lower:match("^phase%s*[%d%.]+$") or lower:match("^p[%d%.]+$") or lower:match("^intermission"))
end

-- Returns { encounterID, difficulty, name, timers = {...}, phases = {...}, lines = {...}, invite = {...},
-- unread = {...} }, unread the lines that start like a timer but have no time it can read, as written.
-- Each timer is { time, ph, tags, kind = "spell" or "text", spellId, text, dur, color, line } with `line`
-- its line number in the text, and, when the line has them: show (a set), tts, speakAt ("zero" for
-- ttsat:0), count, glow (true),
-- sound (the text as written; the sound engine plays it if it names a sound, see Sound/Engine.lua), warn, linger
-- (seconds) and iconID.
function Parser.Parse(text)
    local note = { timers = {}, phases = {}, lines = {}, invite = nil, unread = {} }
    local phaseSeen = {}
    local lineNo = 0

    for raw in ((text or "") .. "\n"):gmatch("(.-)\r?\n") do
        lineNo = lineNo + 1
        local line = trim(raw)
        local lower = line:lower()
        if line == "" then
            note.lines[#note.lines + 1] = ""
        elseif lower:find("^encounterid:") then
            local f = fields(line)
            note.encounterID = tonumber(f.encounterid)
            note.difficulty = f.difficulty
            note.name = f.name
        elseif lower:find("^time:") or (lower:find("^ph:%s*[%d%.]+%s*;") and lower:find(";%s*time:")) then
            -- a timed line, "time:" first or "ph:" first (shared raid notes use both orders)
            local f = fields(line)
            local t = tonumber(f.time)
            if t then
                local item = {
                    time = t,
                    ph = tonumber(f.ph) or 1,
                    tags = words(f.tag),
                    spellId = tonumber(f.spellid),
                    text = f.text,
                    dur = tonumber(f.dur),
                    color = color(f.colors),
                    line = lineNo,
                    show = f.show and showSet(f.show) or nil,
                    tts = flag(f.tts),
                    count = flag(f.count),
                    speakAt = (tonumber(f.ttsat) == 0) and "zero" or nil,
                    glow = flag(f.glow),
                    sound = (f.sound and f.sound ~= "") and f.sound or nil,
                    warn = tonumber(f.warn),
                    linger = tonumber(f.linger),
                    iconID = tonumber(f.icon),
                }
                item.kind = item.spellId and "spell" or "text"
                note.timers[#note.timers + 1] = item
                if not phaseSeen[item.ph] then
                    phaseSeen[item.ph] = true
                    note.phases[#note.phases + 1] = item.ph
                end
            else
                note.unread[#note.unread + 1] = line
            end
        elseif lower:find("^invitelist:") then
            local list = line:match("^[^:]+:(.*)$") or ""
            note.invite = nameList((list:gsub(";%s*$", "")))
        else
            note.lines[#note.lines + 1] = line
        end
    end

    table.sort(note.phases)
    table.sort(note.timers, function(a, b)
        if a.ph ~= b.ph then
            return a.ph < b.ph
        end
        return a.time < b.time
    end)

    -- Free text: no blank lines at the start or end, and never two in a row.
    local cleaned = {}
    for _, line in ipairs(note.lines) do
        if line ~= "" or (#cleaned > 0 and cleaned[#cleaned] ~= "") then
            cleaned[#cleaned + 1] = line
        end
    end
    while #cleaned > 0 and cleaned[#cleaned] == "" do
        cleaned[#cleaned] = nil
    end
    note.lines = cleaned
    return note
end

-- The note's lines as written, by line number (a timer's `line`), split as Parse splits them.
function Parser.SplitLines(text)
    local out = {}
    for raw in ((text or "") .. "\n"):gmatch("(.-)\r?\n") do
        out[#out + 1] = raw
    end
    return out
end

-- One field of a line, read as Parse reads it (the key in any case), or nil: Field(line, "displaytype").
function Parser.Field(line, key)
    return fields(line or "")[key:lower()]
end

-- A number as short as it can be written: 34, 1.5, -5.
local function num(n)
    return (("%.10g"):format(n))
end

-- One timer back into a note line, the reverse of Parse: Parse(FormatLine(t)) gives back the same timer.
-- Only the fields the timer has are written.
function Parser.FormatLine(t)
    local out = {}
    local function add(key, value)
        out[#out + 1] = key .. ":" .. value .. ";"
    end
    add("time", num(t.time or 0))
    if t.ph then
        add("ph", num(t.ph))
    end
    if t.tags and #t.tags > 0 then
        add("tag", table.concat(t.tags, " "))
    end
    if t.kind == "spell" and t.spellId then
        add("spellid", num(t.spellId))
    end
    if t.text then
        add("text", t.text)
    end
    if t.dur then
        add("dur", num(t.dur))
    end
    if t.color then
        local c = t.color
        add("colors", num(c[1] or 1) .. " " .. num(c[2] or 1) .. " " .. num(c[3] or 1) .. " " .. num(c[4] or 1))
    end
    if t.show then
        local list = {}
        for _, w in ipairs(SHOW_WORDS) do
            if t.show[w] then
                list[#list + 1] = w
            end
        end
        add("show", table.concat(list, ","))
    end
    if t.tts then
        add("tts", "1")
    end
    if t.speakAt == "zero" then
        add("ttsat", "0")
    end
    if t.count then
        add("count", "1")
    end
    if t.sound then
        add("sound", t.sound)
    end
    if t.glow then
        add("glow", "1")
    end
    if t.warn then
        add("warn", num(t.warn))
    end
    if t.linger then
        add("linger", num(t.linger))
    end
    if t.iconID then
        add("icon", num(t.iconID))
    end
    return table.concat(out)
end

-- The keys FormatLine writes.
local FORMAT_KEYS = {}
for _, k in ipairs({ "time", "ph", "tag", "spellid", "text", "dur", "colors", "show", "tts", "ttsat", "count", "sound",
    "glow", "warn", "linger", "icon" }) do
    FORMAT_KEYS[k] = true
end

-- The "key:value;" pairs of a raw note line that FormatLine doesn't write (such as DisplayType:Text;),
-- as written and in order, so a line written back from its timer can keep them.
function Parser.UnknownFields(line)
    local out = {}
    for part in tostring(line or ""):gmatch("[^;]+") do
        local key = part:match("^%s*([^:]+):")
        if key and not FORMAT_KEYS[trim(key):lower()] then
            out[#out + 1] = trim(part) .. ";"
        end
    end
    return table.concat(out)
end
