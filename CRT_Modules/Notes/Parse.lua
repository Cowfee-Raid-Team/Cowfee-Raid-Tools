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
--   shield:boss2,15,any;   a shield bar (Alerts/Absorb.lua): the bar shows the absorb shield on boss unit boss2 (boss1
--                     to boss8) with 15 seconds to break it; "any" also on a difficulty whose ability timeline has no
--                     times for it. Read as timer.absorb = { unit, length, anyDifficulty }; a value that doesn't read
--                     is no shield. A CRT from before it reads the line as before (its bar a plain bar) and keeps the
--                     field when it writes the line back (UnknownFields).
--   ticks:2,4; fill:up; countto:impact;   the bar's impact ticks (seconds into the bar, which runs from warn: before the
--                     time to the time), the bar filling up instead of emptying, and its number counting to each impact
--                     instead of the time, as a Mech Alert's bar (Alerts/Reminders.lua). Read as timer.ticks (a sorted
--                     list), timer.fill ("up") and timer.countTo ("impact"); anything else is none. A CRT from before them
--                     shows the plain bar and keeps the fields when it writes the line back (UnknownFields).
--   prio:high;        the line's priority among your alerts at the same moment, high or low (absent: normal), as a
--                     Mech Alert's (Alerts/Rules.lua Priority). Read as timer.prio; a CRT from before it keeps it.
--   mech:1234;        the Mech Alerts ability a line was written for (Notes/MechNote.lua). FormatLine never writes it,
--                     so every writer keeps it with the other fields it doesn't know. Read as timer.mech, in lower case.
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

-- The one rule for a shield bar's absorb (Alerts/Absorb.lua), shared by a note line's shield: (below), your reminders
-- and templates (Reminders.AbsorbOf) and a boss file's special entry (Alerts/Special.lua): unit boss1 to boss8, length
-- seconds over 0, anyDifficulty true, false or nil (off). Returns { unit, length, anyDifficulty }, a fresh table, or
-- nil and what doesn't read: "unit", "length" or "anyDifficulty". This file loads before the other two.
local ABSORB_UNITS = {}
for i = 1, 8 do
    ABSORB_UNITS["boss" .. i] = true
end
Parser.ABSORB_UNITS = ABSORB_UNITS

function Parser.ReadAbsorb(unit, length, anyDifficulty)
    if not ABSORB_UNITS[unit] then
        return nil, "unit"
    end
    if type(length) ~= "number" or length ~= length or length <= 0 or length >= math.huge then
        return nil, "length"
    end
    if anyDifficulty ~= nil and type(anyDifficulty) ~= "boolean" then
        return nil, "anyDifficulty"
    end
    return { unit = unit, length = length, anyDifficulty = anyDifficulty == true }
end

-- "boss2,15,any" into { unit = "boss2", length = 15, anyDifficulty = true }, or nil when it doesn't read: a boss
-- unit, then its seconds, then "any" or nothing (Parser.ReadAbsorb).
local function shieldOption(s)
    if type(s) ~= "string" then
        return nil
    end
    local parts = {}
    for piece in (s .. ","):gmatch("([^,]*),") do
        parts[#parts + 1] = trim(piece):lower()
    end
    if #parts > 3 or (parts[3] ~= nil and parts[3] ~= "any" and parts[3] ~= "") then
        return nil
    end
    return (Parser.ReadAbsorb(parts[1], tonumber(parts[2] or ""), parts[3] == "any"))
end

-- "2, 4" into { 2, 4 }: seconds into the bar, 0 or more, in order, each once; nil when none reads (a word or a
-- number under 0 makes the whole field none).
local function tickList(s)
    if type(s) ~= "string" then
        return nil
    end
    local out, seen = {}, {}
    for word in s:gmatch("[^,%s]+") do
        local t = word:match("^%d*%.?%d+$") and tonumber(word)
        if not t then
            return nil
        end
        if not seen[t] then
            seen[t] = true
            out[#out + 1] = t
        end
    end
    table.sort(out)
    return #out > 0 and out or nil
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
-- The capitals test is ASCII only (string.upper and %u know no other letters), as every class file is.
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

-- The tag words for a role, everyone or the raid, by what they name (Engine.lua's tokens read them by key), and
-- every one of them as a set: words that name no player. The note editor keeps them out of the invite list; an
-- assignment line of them is still a list. "damage" names no player but matches no one in the alerts.
Parser.ROLE_WORDS = {
    everyone = { "all", "everyone", "raid" },
    tank = { "tank", "tanks" },
    healer = { "healer", "healers", "heal" },
    dps = { "dps", "damager" },
    melee = { "melee", "melees" },
    ranged = { "ranged", "range" },
}
Parser.TAG_WORDS = { damage = true }
for _, list in pairs(Parser.ROLE_WORDS) do
    for _, w in ipairs(list) do
        Parser.TAG_WORDS[w] = true
    end
end
-- The words before a raid group's number: "G1", "Grp1", "Group1", or "Group 1" as two words (Engine.lua's groupTag).
Parser.GROUP_WORDS = { g = true, grp = true, group = true }

-- What a name is in an assignment line: anything between spaces and commas, so "(left)" and "{star}" are items of
-- their own. One pattern for every reader, so whether a line is a list never depends on who reads it.
Parser.NAME_WORD = "[^%s,]+"

-- Whether an item of an assignment line is markup or punctuation, which a list and a sentence both hold: a
-- {..} code ({star}, {rt1}), a |c..|r colour code, a bracketed note ("(left)"), or anything with no letter
-- (">", "->", "/", "1", "2.").
local function neutralItem(text)
    return text:find("^{.*}$") ~= nil or text:find("|c", 1, true) ~= nil or text:find("|r", 1, true) ~= nil
        or text:find("^%(.*%)$") ~= nil or not (text:find("%a") or text:find("[\128-\255]"))
end

-- Whether an item of an assignment line is one a list of names holds: a class, a role or everyone word, a group
-- ("G1", "Group1", "Group 1"), a name-like word, which starts with a capital or with a letter outside ASCII
-- (whose case can't be told), or markup and punctuation. A lower-case word of any other kind ("the", "kites")
-- makes the line a sentence.
local function listItem(item)
    local lower = item.text:lower()
    local G = Parser.GROUP_WORDS
    if item.class or Parser.TAG_WORDS[lower] or G[lower] or lower:match("^g%d$") or lower:match("^grp%d$")
        or lower:match("^group%d$") or neutralItem(item.text) then
        return true
    end
    return item.text:find("^%u") ~= nil or item.text:find("^[\128-\255]") ~= nil
end

-- Whether the names of an assignment line (the part after "Label:") are a list of names, every item a listItem
-- (cut with NAME_WORD), and not a sentence ("Note: the Hunter kites").
local function isNameList(rest)
    local items = Parser.ClassRuns(rest, Parser.NAME_WORD)
    for _, item in ipairs(items) do
        if not listItem(item) then
            return false
        end
    end
    return #items > 0
end

-- The names of an assignment line cut as ClassRuns cuts them with pattern (default NAME_WORD; the rendered note
-- cuts plain words to colour), each class item with counts: whether it is the class there. A class name of
-- several words always is. One word is only on a list of names (isNameList, decided with NAME_WORD whatever the
-- pattern), and only written as a class (sure, or all in lower case: "Soak: priest, monk"), never like a player's
-- name ("Kicks: Deathknight, Abu"). The rendered note, the integrations and the alerts (an assignment line for
-- your class) share it.
function Parser.AssignmentClasses(rest, pattern)
    local items = Parser.ClassRuns(rest, pattern or Parser.NAME_WORD)
    local list = isNameList(rest)
    for _, item in ipairs(items) do
        local single = not item.text:find(" ", 1, true)
        item.counts = item.class ~= nil
            and (not single or (list and (item.sure or item.text:lower() == item.text)))
    end
    return items
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

-- An assignment block's heading line (Notes/Assign.lua): "assign:<key>;name:<name>;" with an optional for: (the
-- mechanic's key) and times: (its typed times, "1@20,2@5": phase @ seconds), never a timed line. Every reader shows
-- it as a heading of its name: Parse puts the name in note.lines, the note editor's rows (EditModel.lua) and the
-- integrations (MRT.lua, NSRT.lua) write the name. Returns { key, name, mech, times } or nil.
function Parser.AssignHeading(line)
    local t = trim(line or "")
    if not t:lower():find("^assign:") then
        return nil
    end
    local f = fields(t)
    local key = f.assign and f.assign:lower() or ""
    if f.time or key == "" or key:find("/", 1, true) then
        return nil
    end
    local name = (f.name and f.name ~= "") and f.name or key
    return { key = key, name = name, mech = (f["for"] and f["for"] ~= "") and f["for"]:lower() or nil,
        times = (f.times and f.times ~= "") and f.times or nil }
end

-- Returns { encounterID, difficulty, name, timers = {...}, phases = {...}, lines = {...}, invite = {...},
-- unread = {...} }, unread the lines that start like a timer but have no time it can read, as written.
-- Each timer is { time, ph, tags, kind = "spell" or "text", spellId, text, dur, color, line } with `line`
-- its line number in the text, and, when the line has them: show (a set), tts, speakAt ("zero" for
-- ttsat:0), count, glow (true),
-- sound (the text as written; the sound engine plays it if it names a sound, see Sound/Engine.lua), warn, linger
-- (seconds), iconID, absorb (shield:, { unit, length, anyDifficulty }), ticks, fill, countTo, prio and mech.
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
                    absorb = shieldOption(f.shield),
                    ticks = tickList(f.ticks),
                    fill = (f.fill and f.fill:lower() == "up") and "up" or nil,
                    countTo = (f.countto and f.countto:lower() == "impact") and "impact" or nil,
                    prio = (f.prio and (f.prio:lower() == "high" or f.prio:lower() == "low")) and f.prio:lower() or nil,
                    mech = (f.mech and f.mech ~= "") and f.mech:lower() or nil,
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
            local heading = Parser.AssignHeading(line)
            note.lines[#note.lines + 1] = heading and heading.name or line -- an assignment block's heading: its name
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

-- The line with one field's value replaced, every other byte as written (the spaces around the old value kept),
-- or nil when the line has no such field. The last field of that key, the one Parse reads. A field is a
-- "key:value" between ";", so "text:tag:A" holds no tag. The note editor rewrites a timer's names with it
-- (Notes/Links.lua): ReplaceField(line, "tag", "Abu Cheo").
function Parser.ReplaceField(line, key, value)
    line = line or ""
    key = key:lower()
    local found, pos = nil, 1
    while true do
        local semi = line:find(";", pos, true)
        local stop = semi or (#line + 1)
        local part = line:sub(pos, stop - 1)
        local name, colon = part:match("^%s*([^:]+)():")
        if name and trim(name):lower() == key then
            found = { colon = pos + colon - 1, stop = stop }
        end
        if not semi then
            break
        end
        pos = semi + 1
    end
    if not found then
        return nil
    end
    local old = line:sub(found.colon + 1, found.stop - 1)
    local lead, trail = old:match("^(%s*)"), ""
    if #lead < #old then
        trail = old:match("(%s*)$")
    end
    return line:sub(1, found.colon) .. lead .. value .. trail .. line:sub(found.stop)
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
    local a = type(t.absorb) == "table" and t.absorb
    if a and type(a.unit) == "string" and type(a.length) == "number" then
        add("shield", a.unit .. "," .. num(a.length) .. (a.anyDifficulty and ",any" or ""))
    end
    if type(t.ticks) == "table" and #t.ticks > 0 then
        local list = {}
        for i, tick in ipairs(t.ticks) do
            list[i] = num(tick)
        end
        add("ticks", table.concat(list, ","))
    end
    if t.fill == "up" then
        add("fill", "up")
    end
    if t.countTo == "impact" then
        add("countto", "impact")
    end
    if t.prio == "high" or t.prio == "low" then
        add("prio", t.prio)
    end
    return table.concat(out)
end

-- The keys FormatLine writes.
local FORMAT_KEYS = {}
for _, k in ipairs({ "time", "ph", "tag", "spellid", "text", "dur", "colors", "show", "tts", "ttsat", "count", "sound",
    "glow", "warn", "linger", "icon", "shield", "ticks", "fill", "countto", "prio" }) do
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
