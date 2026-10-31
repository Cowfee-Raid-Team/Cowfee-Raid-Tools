local ADDON, CRT = ...

-- Import reminders: reads an export of the Timeline Reminders addon, pasted as text, into your own reminders, so
-- each of its alerts sits on the Timeline's Personal notes row as one of your reminders. Built only from a sample
-- export: no code of that addon was read. Nothing here draws; the pop-out is Timeline/ImportWindow.lua.
--
-- The format, as the sample has it:
--   EncounterID:3492;Difficulty:Heroic;Name:Ula'tek          a boss's header; blank lines between bosses
--   ph:1;time:135.5;tag:11;dur:10;text:Damage Amp;          one reminder: key:value; pairs, in any order
--   ph:1;time:407.5;tag:everyone;dur:20;text:Soak;colors:1.0000 0.0745 0.1529 1;
--   ph:1;time:34.4;tag:Dotsanhots;dur:8;spellid:383410;TTS:true;countdown:5;DisplayType:Circle;
--   ph:1;time:60.2;tag:Dotsanhots;dur:8;spellid:22812;TTS:true;TTSTimer:3;DisplayType:Text;
-- ph is the phase number, time seconds (with decimals), tag who it is for (see TAG_KINDS: "everyone", a class ID, a
-- player's name), dur how long it shows, text what it says (may be empty or missing), colors "r g b a" from 0 to 1,
-- spellid its spell, TTS:true to read it out, countdown:N a spoken count, TTSTimer:N when it is read out and
-- DisplayType Circle or Text how it shows (see Import.Speech and Import.Display for how each maps). A key or header
-- field not listed, or a known key whose value doesn't read, is kept as written on the reminder (import.extra,
-- import.bossExtra) and never stops the import.
--
--   Import.Parse(text)          the text as { bosses = { { encounterID, difficulty, name, reminders, skipped,
--                               extra } }, skipped }, pure: reminders are { line, ph, time, tag, dur, text, color,
--                               spellID, tts, countdown, ttsTimer, display, extra }, skipped { { line, reason } };
--                               lines before any header are skipped at the top
--   Import.Me()                 you, read once per import: { name, realm, classID, classFile, specID, role, group }
--   Import.Plan(parsed, me)     what would be imported for you: per boss its group, whether the season knows it,
--                               the reminders for you (ForPlayer) as reminder tables, and every skipped line
--   Import.Apply(plan, opts)    writes them through the reminders' own save path (Alerts/Draft.lua, Alerts/Reminders.lua)
--
-- Saved data (additive): each imported reminder has import = { source = Import.SOURCE, tag, tagKind, ph, time, dur,
-- text, countdown, ttsTimer, extra, bossExtra } (text only when the line's was empty; countdown and ttsTimer the
-- line's own numbers, as written before they are fitted to the reminder's ranges; extra and bossExtra only when
-- there are unknown fields). Its spell is the reminder's own spellID; the count, Before 0 and TTS words are its
-- countFrom, speakAt/speakBefore and speakText (Alerts/Reminders.lua).
-- Replace deletes only reminders whose import.source is Import.SOURCE, for the bosses and difficulty groups pasted.
-- It never touches a note, for a raid leader or a raider: only CRT.db.alerts.reminders.

local Import = {}
CRT.TimelineImport = Import

Import.SOURCE = "timeline-reminders"
Import.FORMAT_NAME = "Timeline Reminders"

local TEXT = {
    placeholder = "Reminder",
    beforeBoss = "before any boss line",
    notReminder = "not a reminder line",
    noTime = "no time",
    badTime = "bad time (%s)",
    beforePull = "a time before the pull (%s)",
    badPhase = "bad phase (%s)",
    noTag = "no tag",
    otherTag = "for another tag (%s)",
    -- a tag of a kind (TAG_KINDS) that isn't you, by its kind's key
    other = {
        player = "for another player (%s)",
        class = "for another class (%s)",
        group = "for another group (%s)",
        role = "for another role (%s)",
        spec = "for another spec (%s)",
        position = "for another position (%s)",
    },
    roles = { TANK = "Tank", HEALER = "Healer", DAMAGER = "DPS" },
    positions = { melee = "Melee", ranged = "Ranged" },
    badBoss = "no encounter ID",
    badDifficulty = "unknown difficulty (%s)",
    noDifficulty = "no difficulty",
    duplicate = "already one of your reminders",
    combat = "Can't import during combat.",
    saveFailed = "could not be saved",
}
Import.TEXT = TEXT

-- The keys a reminder line reads, in lower case; any other is kept in import.extra.
local LINE_KEYS = { ph = true, time = true, tag = true, dur = true, text = true, colors = true, spellid = true,
    tts = true, countdown = true, ttstimer = true, displaytype = true }
local HEADER_KEYS = { encounterid = true, difficulty = true, name = true }
-- The difficulty names a header may give, in lower case: only these are read (Normal and Heroic share a group).
local DIFFICULTIES = { normal = "Normal", heroic = "Heroic", mythic = "Mythic" }

local function trim(s)
    return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

-- "k:v;k:v;" into { { key, value } } in order, the key as written and the value trimmed. A part with no ":" gives
-- nil (the line is not key:value pairs). The last part may lack its ";".
local function pairsOf(line)
    local out = {}
    for part in (line .. ";"):gmatch("([^;]*);") do
        if trim(part) ~= "" then
            local key, value = part:match("^%s*([^:]-)%s*:(.*)$")
            if not key or key == "" then
                return nil
            end
            out[#out + 1] = { key = key, value = trim(value) }
        end
    end
    return out
end

-- "1.0000 0.0745 0.1529 1" into { r, g, b, 1 } (the alerts' colour shape, Alerts/Editor.lua's), or nil.
function Import.Color(s)
    local nums = {}
    for word in tostring(s or ""):gmatch("%S+") do
        nums[#nums + 1] = tonumber(word)
    end
    for i = 1, 3 do
        local v = nums[i]
        if type(v) ~= "number" or v ~= v or v < 0 or v > 1 then
            return nil
        end
    end
    return { nums[1], nums[2], nums[3], 1 }
end

-- A whole number of 0 or more, or nil.
local function count(s)
    local n = tonumber(s)
    if n and n == n and n >= 0 and n < math.huge and n == math.floor(n) then
        return n
    end
    return nil
end

-- A number of seconds of 0 or more, or nil.
local function seconds(s)
    local n = tonumber(s)
    if n and n == n and n >= 0 and n < math.huge then
        return n
    end
    return nil
end

-- The keys read into the reminder's spell, speech and display: { key in lower case, field, read(value) }. A value
-- that doesn't read (nil) is kept as written in extra.
local READS = {
    { "spellid", "spellID", function(v) local n = count(v) return n and n > 0 and n or nil end },
    -- true, false, or the words to say in place of the text ("TTS:Testing")
    { "tts", "tts", function(v)
        local l = v:lower()
        if l == "true" then
            return true
        elseif l == "false" then
            return false
        end
        return v ~= "" and v or nil
    end },
    { "countdown", "countdown", count },
    { "ttstimer", "ttsTimer", seconds },
    -- only a DisplayType Import.Display maps; another stays in extra
    { "displaytype", "display", function(v) return Import.Display(v) and v or nil end },
}

-- One reminder line into { line, ph, time, tag, dur, text, color, spellID, tts, countdown, ttsTimer, display,
-- extra }, or nil and why it is skipped.
local function readLine(raw, list)
    local r = { line = raw, extra = nil }
    local written = {} -- each known key as written, so one that doesn't read is kept as it was
    for _, p in ipairs(list) do
        local key = p.key:lower()
        if LINE_KEYS[key] then
            r[key] = p.value
            written[key] = p.key
        else
            r.extra = r.extra or {}
            r.extra[p.key] = p.value
        end
    end
    if r.time == nil then
        return nil, TEXT.noTime
    end
    local t = tonumber(r.time)
    if not t or t ~= t or t == math.huge then
        return nil, string.format(TEXT.badTime, r.time)
    end
    if t < 0 then
        return nil, string.format(TEXT.beforePull, r.time)
    end
    local ph = 1
    if r.ph ~= nil and r.ph ~= "" then
        ph = tonumber(r.ph)
        -- a whole phase number, 1 or more
        if not ph or ph < 1 or ph ~= math.floor(ph) then
            return nil, string.format(TEXT.badPhase, r.ph)
        end
    end
    local out = { line = raw, ph = ph, time = t, tag = r.tag, dur = tonumber(r.dur), text = trim(r.text),
        extra = r.extra }
    if r.colors ~= nil then
        out.color = Import.Color(r.colors)
        if not out.color then
            -- a colour that doesn't read is kept as it was
            out.extra = out.extra or {}
            out.extra.colors = r.colors
        end
    end
    for _, k in ipairs(READS) do
        local value = r[k[1]]
        if value ~= nil then
            out[k[2]] = k[3](value)
            if out[k[2]] == nil then
                out.extra = out.extra or {}
                out.extra[written[k[1]]] = value
            end
        end
    end
    return out
end

-- A header line's pairs into a boss.
local function readHeader(list)
    local boss = { reminders = {}, skipped = {} }
    for _, p in ipairs(list) do
        local key = p.key:lower()
        if key == "encounterid" then
            boss.encounterID = tonumber(p.value)
        elseif key == "difficulty" then
            boss.difficulty = p.value
        elseif key == "name" then
            boss.name = p.value
        end
        if not HEADER_KEYS[key] then
            boss.extra = boss.extra or {}
            boss.extra[p.key] = p.value
        end
    end
    return boss
end

local function isHeader(list)
    for _, p in ipairs(list) do
        if p.key:lower() == "encounterid" then
            return true
        end
    end
    return false
end

-- The pasted text into bosses. Pure: no saved data, no game calls.
function Import.Parse(text)
    local out = { bosses = {}, skipped = {} }
    if type(text) ~= "string" then
        return out
    end
    local boss
    for raw in (text:gsub("\r\n?", "\n") .. "\n"):gmatch("([^\n]*)\n") do
        local line = trim(raw)
        if line ~= "" then
            local list = pairsOf(line)
            if list and #list > 0 and isHeader(list) then
                boss = readHeader(list)
                out.bosses[#out.bosses + 1] = boss
            elseif not boss then
                out.skipped[#out.skipped + 1] = { line = line, reason = TEXT.beforeBoss }
            elseif not list or #list == 0 then
                boss.skipped[#boss.skipped + 1] = { line = line, reason = TEXT.notReminder }
            else
                local r, why = readLine(line, list)
                if r then
                    boss.reminders[#boss.reminders + 1] = r
                else
                    boss.skipped[#boss.skipped + 1] = { line = line, reason = why }
                end
            end
        end
    end
    return out
end

-- The rules (each in one place) ------------------------------------------------------------------------

-- You ---------------------------------------------------------------------------------------------------------

local function readable(v)
    return not (issecretvalue and issecretvalue(v))
end

local function word(v)
    return readable(v) and type(v) == "string" and v ~= "" and v or nil
end

local function number(v)
    return readable(v) and type(v) == "number" and v or nil
end

-- The player's class ID, or nil when the game doesn't give a readable one.
function Import.PlayerClassID()
    if not UnitClass then
        return nil
    end
    local ok, _, _, id = pcall(UnitClass, "player")
    return ok and number(id) or nil
end

-- A class ID's name as notes write it ("Death Knight", Parse.lua's) and its class file, or nil when the game has
-- no such class.
local function classByID(id)
    if type(id) ~= "number" or not GetClassInfo then
        return nil
    end
    local ok, name, file = pcall(GetClassInfo, id)
    file = ok and word(file) or nil
    if not file then
        return nil
    end
    local P = CRT.NoteParser
    return (P and P.ClassName and P.ClassName(file)) or word(name) or file, file
end

-- How many classes the game has (class IDs run 1 to it), or nil.
local function classCount()
    if not GetNumClasses then
        return nil
    end
    local ok, n = pcall(GetNumClasses)
    return ok and number(n) or nil
end

-- A SpecializationID's name ("Arms"), through Groups.SpecInfo (GetSpecializationInfoByID), or nil.
local function specName(id)
    local Groups = CRT.Groups
    if not (Groups and Groups.SpecInfo) then
        return nil
    end
    local ok, name = pcall(Groups.SpecInfo, id)
    return ok and word(name) or nil
end

-- Your role: the one picked in the group, else your spec's (GetSpecializationInfoByID's fifth value), else DPS, as
-- the note alerts read it (Notes/Engine.lua).
local ROLES = { TANK = true, HEALER = true, DAMAGER = true }
local function roleOf(specID)
    if UnitGroupRolesAssigned then
        local ok, role = pcall(UnitGroupRolesAssigned, "player")
        if ok and readable(role) and ROLES[role] then
            return role
        end
    end
    if specID and GetSpecializationInfoByID then
        local ok, _, _, _, _, role = pcall(GetSpecializationInfoByID, specID)
        if ok and readable(role) and ROLES[role] then
            return role
        end
    end
    return "DAMAGER"
end

-- Your raid group's number from the raid roster (GetRaidRosterInfo's subgroup); in a party or alone, 1, as the
-- note alerts count you.
local function subgroup()
    local okRaid, inRaid = pcall(IsInRaid or function() return false end)
    if not (okRaid and inRaid == true) then
        return 1
    end
    local okN, n = pcall(GetNumGroupMembers)
    for i = 1, (okN and number(n)) or 0 do
        -- the answer read only once it is known not to be secret
        local okMe, me = pcall(function()
            local v = UnitIsUnit("raid" .. i, "player")
            return readable(v) and v == true
        end)
        if okMe and me == true then
            local ok, _, _, group = pcall(GetRaidRosterInfo, i)
            return ok and number(group) or nil
        end
    end
    return nil
end

-- Melee or ranged, for everyone (Alex, 2026-10-31): every tank is melee; a healer or DPS is melee when its spec is in
-- the shared melee list (Notes/Engine.lua's MELEE_SPECS: the melee damage specs, Holy Paladin and Mistweaver Monk),
-- else ranged.
local function positionOf(role, specID)
    if role == "TANK" then
        return "melee"
    end
    local E = CRT.NoteEngine
    local melee = E and E.MELEE_SPECS
    return (specID and melee and melee[specID]) and "melee" or "ranged"
end

-- You, read once per import, each value guarded (an error or a secret leaves it out): { name, realm, classID,
-- classFile, specID, role, position, group }.
function Import.Me()
    local me = {}
    if UnitName then
        local ok, name = pcall(UnitName, "player")
        me.name = ok and word(name) or nil
    end
    if GetNormalizedRealmName then
        local ok, realm = pcall(GetNormalizedRealmName)
        me.realm = ok and word(realm) or nil
    end
    if UnitClass then
        local ok, _, file, id = pcall(UnitClass, "player")
        if ok then
            me.classFile, me.classID = word(file), number(id)
        end
    end
    local Groups = CRT.Groups
    if Groups and Groups.PlayerSpecID then
        local ok, spec = pcall(Groups.PlayerSpecID)
        me.specID = ok and number(spec) or nil
    end
    me.role = roleOf(me.specID)
    me.position = positionOf(me.role, me.specID)
    me.group = subgroup()
    return me
end

-- A class ID alone (an older caller) as a me table.
local function meOf(v)
    if type(v) == "table" then
        return v
    end
    local me = { classID = type(v) == "number" and v or nil }
    me.classFile = select(2, classByID(me.classID))
    return me
end

-- Who a line is for ------------------------------------------------------------------------------------------

local function squash(s)
    return (s:gsub("[%s%-']", ""):lower())
end

-- A tag that is a character's name, "Name" or "Name-Realm": the name and the realm (nil without), or nil. A name
-- has no spaces, digits or punctuation.
local function nameOf(tag)
    local name, realm = tag:match("^([^%-]+)%-(.+)$")
    name = name or tag
    if name:find("[%s%d%p]") then
        return nil
    end
    return name, realm
end

-- Whether a tag is your name, in any case; a realm, when it has one, must be yours. CRT has no case-folding name
-- normaliser (Groups.Normalize only adds the realm), and lower() folds ASCII letters only: "Ä" and "ä" differ.
local function namesMe(tag, me)
    local name, realm = nameOf(tag)
    if not (name and me.name) or name:lower() ~= me.name:lower() then
        return false
    end
    return realm == nil or me.realm == nil or squash(realm) == squash(me.realm)
end

-- The words of one of Parse.lua's ROLE_WORDS keys, in lower case, as a set.
local function roleWords(key)
    local P = CRT.NoteParser
    local out = {}
    for _, w in ipairs(P and P.ROLE_WORDS and P.ROLE_WORDS[key] or {}) do
        out[w] = true
    end
    return out
end

-- The role a tag names ("tank", "healer"/"heal", "dps"/"damager": Parse.lua's words), or nil.
local function roleTag(tag)
    local lower = tag:lower()
    for key, role in pairs({ tank = "TANK", healer = "HEALER", dps = "DAMAGER" }) do
        if roleWords(key)[lower] then
            return role
        end
    end
    return nil
end

-- "melee" or "ranged" for a tag of either (Parse.lua's words), or nil.
local function positionTag(tag)
    local lower = tag:lower()
    for _, key in ipairs({ "melee", "ranged" }) do
        if roleWords(key)[lower] then
            return key
        end
    end
    return nil
end

-- A raid group's number, 1 to 8: "Group1" (the export's own form) and "G3", "Grp3" as notes write it (Parse.lua's
-- GROUP_WORDS), any case; or nil.
local function groupOf(tag)
    local prefix, n = tag:lower():match("^(%a+)([1-8])$")
    local P = CRT.NoteParser
    local words = P and P.GROUP_WORDS or { g = true, grp = true, group = true }
    return prefix and words[prefix] and tonumber(n) or nil
end

-- A tag that is a whole number: a class ID (1 to the game's class count, or any the game knows as a class), else a
-- SpecializationID ("71" is Arms). Returns the number and "class" or "spec", or nil.
local function numberTag(tag)
    if not tag:match("^%d+$") then
        return nil
    end
    local n = tonumber(tag)
    local classes = classCount()
    if (classes and n >= 1 and n <= classes) or classByID(n) then
        return n, "class"
    end
    return n, "spec"
end

-- The kinds of tag a line can have, in the order they are tried: the first whose matches gives true or false
-- decides (true: the line is yours; false: it is for another of that kind, and label(tag) names whom); nil means
-- the tag is not of that kind. A tag no kind takes is skipped "for another tag". me is Import.Me()'s.
local TAG_KINDS = {
    -- your own name first, as the note alerts read it, so a player named Tank keeps their lines
    { key = "player", matches = function(tag, me) return namesMe(tag, me) or nil end },
    { key = "everyone", matches = function(tag) return roleWords("everyone")[tag:lower()] or nil end },
    { key = "group", label = function(tag) return tostring(groupOf(tag)) end,
        matches = function(tag, me)
            local n = groupOf(tag)
            if n then
                return n == me.group
            end
        end },
    { key = "class", label = function(tag) return (classByID(tonumber(tag))) or tag end,
        matches = function(tag, me)
            local n, kind = numberTag(tag)
            if kind == "class" then
                return n == me.classID
            end
        end },
    { key = "spec", label = function(tag) return specName(tonumber(tag)) or tag end,
        matches = function(tag, me)
            local n, kind = numberTag(tag)
            if kind == "spec" then
                return me.specID ~= nil and n == me.specID
            end
        end },
    { key = "role", label = function(tag) return TEXT.roles[roleTag(tag)] end,
        matches = function(tag, me)
            local role = roleTag(tag)
            if role then
                return role == me.role
            end
        end },
    { key = "position", label = function(tag) return TEXT.positions[positionTag(tag)] end,
        matches = function(tag, me)
            local pos = positionTag(tag)
            if pos then
                return pos == me.position
            end
        end },
    -- a spec word of the notes ("RestoDruid", Notes/SpecWords.lua): yours when you play that spec now
    { key = "spec", label = function(tag) local e = CRT.NoteSpecs.Read(tag) return e and e.label or tag end,
        matches = function(tag, me)
            local Specs = CRT.NoteSpecs
            local e = Specs and Specs.Read and Specs.Read(tag)
            if e then
                return me.specID ~= nil and e.spec == me.specID
            end
        end },
    -- a class by its English name or file token, in any case and spacing ("Death Knight", "deathknight", "DRUID")
    { key = "class", label = function(tag) local P = CRT.NoteParser return P.ClassName(P.ClassOf(tag)) or tag end,
        matches = function(tag, me)
            local P = CRT.NoteParser
            local file = P and P.ClassOf and P.ClassOf(tag)
            if file then
                return file == me.classFile
            end
        end },
    -- any other name: another player's (a word the notes give another meaning, such as "damage", is not a name)
    { key = "player", label = function(tag) return tag end,
        matches = function(tag, me)
            local P = CRT.NoteParser
            if nameOf(tag) and not (P and P.TAG_WORDS and P.TAG_WORDS[tag:lower()]) then
                return namesMe(tag, me)
            end
        end },
}
Import.TAG_KINDS = TAG_KINDS

-- Who a line is for: true and the tag's kind when it is yours, else false, why (naming the kind) and the kind (nil
-- for a tag no kind takes). me is Import.Me()'s (a class ID alone also works).
function Import.ForPlayer(tag, me)
    if type(tag) ~= "string" or trim(tag) == "" then
        return false, TEXT.noTag
    end
    tag = trim(tag)
    me = meOf(me)
    for _, kind in ipairs(TAG_KINDS) do
        local ok, mine = pcall(kind.matches, tag, me)
        if ok and mine == true then
            return true, nil, kind.key
        elseif ok and mine == false then
            local okLabel, label = pcall(kind.label, tag)
            return false, string.format(TEXT.other[kind.key], okLabel and label or tag), kind.key
        end
    end
    return false, string.format(TEXT.otherTag, tag), nil
end

-- What a line says aloud, as the reminder's Read out choices (Alerts/Draft.lua's speak, count and speakAt):
--   no TTS (or TTS:false)  nothing is read out
--   TTS:true               the text (or the spell's name) is read out when the alert shows, Show from before its time;
--   TTS:<words>            those words instead (Import.Words)
--   countdown:N            a spoken count from N to the time (Count down from, countFrom). The reminders count from
--                          3 to 10, so N under 3 counts from 3 and over 10 from 10 (N is kept in import.countdown)
--   TTSTimer:N             read out N seconds before the time (Speak at: Before 0, speakBefore), on the half second
--                          nearest N from 0.5 to 10; 0 is At 0 (N is kept in import.ttsTimer)
-- Returns speak, count, speakAt (nil, "zero" or "before"), countFrom and speakBefore (nil when not used).
local function nearest(n, range)
    local v = math.floor((n - range.min) / range.step + 0.5) * range.step + range.min
    return math.max(range.min, math.min(range.max, v))
end

function Import.Speech(line)
    local R = CRT.AlertReminders
    local speak = line.tts == true or (type(line.tts) == "string" and line.tts ~= "")
    local count = type(line.countdown) == "number" and line.countdown > 0
    local countFrom = count and nearest(line.countdown, R.COUNT_FROM) or nil
    local speakAt, speakBefore
    if speak and type(line.ttsTimer) == "number" then
        if line.ttsTimer == 0 then
            speakAt = "zero"
        else
            speakAt, speakBefore = "before", nearest(line.ttsTimer, R.SPEAK_BEFORE)
        end
    end
    return speak, count, speakAt, countFrom, speakBefore
end

-- The words a TTS:<words> line says in place of its text, or nil (TTS:true says the text).
function Import.Words(line)
    return type(line.tts) == "string" and line.tts ~= "" and line.tts or nil
end

-- How a line shows, as the Show as box it ticks besides the new alert's (Alert and Bar): DisplayType Circle the
-- circle, Text the text; none, or one not listed (kept in import.extra), only the new alert's.
local DISPLAYS = { circle = "circle", text = "text" }
function Import.Display(display)
    return type(display) == "string" and DISPLAYS[trim(display):lower()] or nil
end

-- A line's time as the reminder's typed times: phase 1 is seconds from the pull ("P1 2:15.5"); a later phase's
-- time is seconds from that phase's start ("P2 +0:48.1"), as a typed P2 time is (Reminders.AbsoluteTime places it
-- from the phase line on the ability timeline).
function Import.Times(ph, time)
    return CRT.AlertReminders.FormatTimes({ { ph = ph, t = time } })
end

-- How long a line shows as the reminder's Show from (warn): its alert and bar come up dur seconds before its time
-- and run to it (Alerts/Reminders.lua's Items). Show from's own range, 1 to 60 seconds; none: the default 5.
local WARN_MIN, WARN_MAX, WARN_DEFAULT = 1, 60, 5
function Import.Warn(dur)
    if type(dur) ~= "number" or dur ~= dur then
        return WARN_DEFAULT
    end
    return math.max(WARN_MIN, math.min(WARN_MAX, math.floor(dur * 10 + 0.5) / 10))
end

-- A header's difficulty as a reminder's group ("nh" or "mythic", through Reminders.GroupOf), or nil and why.
function Import.Group(difficulty)
    local name = DIFFICULTIES[trim(difficulty):lower()]
    if not name then
        if trim(difficulty) == "" then
            return nil, TEXT.noDifficulty
        end
        return nil, string.format(TEXT.badDifficulty, trim(difficulty))
    end
    return CRT.AlertReminders.GroupOf({ difficulty = name })
end

-- Planning ------------------------------------------------------------------------------------------------

-- The reminder a line becomes, made as the alert editor makes a new one (Draft.New, Draft.BuildReminder): Only
-- me, its time typed, its spell (the icon), its text (else the spell's name, else the placeholder), colour, Show
-- from, what it reads out (Import.Speech) and how it shows (Import.Display); the rest the editor's defaults.
-- kind is the tag's kind (ForPlayer).
local function reminderOf(boss, line, kind)
    local Draft = CRT.AlertDraft
    local draft = Draft.New()
    Draft.SetGroup(draft, boss.group)
    draft.boss = boss.bossName
    draft.spellID = line.spellID
    draft.text = line.text ~= "" and line.text or CRT.AlertReminders.SpellName(line.spellID) or TEXT.placeholder
    draft.ph = line.ph
    draft.timeText = ("%.10g"):format(line.time)
    draft.timeTouched = true
    draft.warn = Import.Warn(line.dur)
    draft.color = line.color and { line.color[1], line.color[2], line.color[3], line.color[4] } or nil
    local countFrom, speakBefore
    draft.speak, draft.count, draft.speakAt, countFrom, speakBefore = Import.Speech(line)
    draft.countFrom = countFrom or draft.countFrom
    draft.speakBefore = speakBefore or draft.speakBefore
    draft.speakText = Import.Words(line) or ""
    local show = Import.Display(line.display)
    if show then
        draft.show[show] = true
    end
    local r = Draft.BuildReminder({ encounterID = boss.encounterID }, draft)
    -- the phase rule is Import.Times, whatever the draft's time box reads
    r.times = Import.Times(line.ph, line.time)
    r.import = { source = Import.SOURCE, tag = line.tag, tagKind = kind, ph = line.ph, time = line.time,
        dur = line.dur, text = line.text == "" and "" or nil, countdown = line.countdown, ttsTimer = line.ttsTimer,
        extra = line.extra, bossExtra = boss.extra }
    return r
end

-- What the parsed text would import for you (me: Import.Me()'s, or a class ID alone): { bosses = { { encounterID, name, difficulty, group,
-- known, reminders = { reminder tables }, skipped = { { line, reason } }, reason } }, skipped, count }. A boss
-- with a reason (no encounter ID, an unknown difficulty) imports nothing; known is false for a boss the season
-- doesn't have (still imported, by its encounter ID). count is how many reminders would be written.
function Import.Plan(parsed, me)
    me = meOf(me)
    local out = { bosses = {}, skipped = parsed and parsed.skipped or {}, count = 0 }
    local Bosses = CRT.Bosses
    for _, b in ipairs(parsed and parsed.bosses or {}) do
        local def = b.encounterID and Bosses and Bosses.Get and Bosses:Get(b.encounterID)
        local p = { encounterID = b.encounterID, name = (def and def.name) or b.name, difficulty = b.difficulty,
            known = def ~= nil and def ~= false, extra = b.extra, reminders = {}, skipped = {} }
        p.bossName = p.name
        for _, s in ipairs(b.skipped) do
            p.skipped[#p.skipped + 1] = s
        end
        if not b.encounterID then
            p.reason = TEXT.badBoss
        else
            p.group, p.reason = Import.Group(b.difficulty)
        end
        if not p.reason then
            for _, line in ipairs(b.reminders) do
                local mine, why, kind = Import.ForPlayer(line.tag, me)
                if mine then
                    p.reminders[#p.reminders + 1] = reminderOf(p, line, kind)
                else
                    p.skipped[#p.skipped + 1] = { line = line.line, reason = why }
                end
            end
        else
            for _, line in ipairs(b.reminders) do
                p.skipped[#p.skipped + 1] = { line = line.line, reason = p.reason }
            end
        end
        out.count = out.count + #p.reminders
        out.bosses[#out.bosses + 1] = p
    end
    return out
end

-- Writing ---------------------------------------------------------------------------------------------------

-- The time two reminders are compared by: an imported one's pasted phase and time (import.ph, import.time), so it
-- matches whatever its times field holds; any other's typed times. Nil for a reminder with neither.
local function timeOf(r)
    local imp = type(r.import) == "table" and r.import
    if imp and type(imp.ph) == "number" and type(imp.time) == "number" then
        return Import.Times(imp.ph, imp.time)
    end
    return r.times
end

-- The key two reminders are the same by: their group, time, text and spell (two spells at one time whose names
-- the game doesn't give are both the placeholder).
local function sameKey(group, r)
    local R = CRT.AlertReminders
    local times = timeOf(r)
    local list = type(times) == "string" and R.ParseTimes(times)
    if not list then
        return nil
    end
    local spell = type(r.spellID) == "number" and tostring(r.spellID) or ""
    return tostring(group) .. "|" .. R.FormatTimes(list) .. "|" .. trim(r.text):lower() .. "|" .. spell
end

local function imported(r)
    return type(r) == "table" and type(r.import) == "table" and r.import.source == Import.SOURCE
end

-- The bosses and groups a plan writes to, each once (a boss pasted twice, or as Normal and Heroic, is one pair).
local function targets(plan)
    local out, seen = {}, {}
    for _, p in ipairs(plan and plan.bosses or {}) do
        if p.group and p.encounterID then
            local key = tostring(p.encounterID) .. "|" .. p.group
            if not seen[key] then
                seen[key] = { encounterID = p.encounterID, group = p.group, bosses = {} }
                out[#out + 1] = seen[key]
            end
            local t = seen[key].bosses
            t[#t + 1] = p
        end
    end
    return out
end

-- One boss and group: with replace, what this importer wrote before is deleted (once for the pair); then each of
-- its pasted reminders is saved unless the same one (group, time, text) is already there.
local function applyTarget(t, replace, res)
    local R = CRT.AlertReminders
    if replace then
        for _, e in ipairs(R:List(t.encounterID)) do
            if imported(e.r) and R.GroupOf(e.r) == t.group then
                R:Delete(t.encounterID, e.id)
                res.removed = res.removed + 1
            end
        end
    end
    local seen = {}
    for _, e in ipairs(R:List(t.encounterID)) do
        local key = R.GroupOf(e.r) == t.group and sameKey(t.group, e.r)
        if key then
            seen[key] = true
        end
    end
    for _, p in ipairs(t.bosses) do
        for _, r in ipairs(p.reminders) do
            local key = sameKey(t.group, r)
            if key and seen[key] then
                res.duplicates = res.duplicates + 1
            elseif R:Save(t.encounterID, nil, r, t.group) then
                res.added = res.added + 1
                if key then
                    seen[key] = true
                end
            else
                res.failed = res.failed + 1
            end
        end
    end
end

-- Writes the plan: with opts.replace, first deletes what this importer wrote before for each boss and group
-- pasted; then saves each reminder through Reminders:Save, leaving out one that is the same (group, time, text)
-- as a reminder the boss already has. The alerts' change event fires once, at the end (Alerts:Batch), so the
-- Timeline and every list redraw once. Returns { added, removed, duplicates, failed }, or nil and the message
-- (during combat, as the Timeline's other edits).
function Import.Apply(plan, opts)
    if InCombatLockdown and InCombatLockdown() then
        return nil, TEXT.combat
    end
    local res = { added = 0, removed = 0, duplicates = 0, failed = 0 }
    local replace = opts and opts.replace and true or false
    local function run()
        for _, t in ipairs(targets(plan)) do
            applyTarget(t, replace, res)
        end
    end
    local Alerts = CRT.Alerts
    if Alerts and Alerts.Batch then
        Alerts:Batch(run)
    else
        run()
    end
    return res
end
