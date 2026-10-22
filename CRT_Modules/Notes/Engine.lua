local ADDON, CRT = ...

-- Runs a note's timers on the alerts engine (Alerts/Engine.lua). On ENCOUNTER_START the engine asks this
-- file for the note that matches the boss, and every timer counts down from the start of its phase.
-- There is no phase-change event an addon can use in Midnight, so phases after the first start when
-- someone presses Next phase (or /crt note next). /crt note test starts the active note at once, to try
-- it out of an encounter. The note is the engine's "note" block: one item per timer.

local Notes = CRT.Notes
local Alerts = CRT.Alerts
local Rules = CRT.AlertRules
local Engine = { running = false, runId = 0 }
CRT.NoteEngine = Engine

local note       -- the parsed note being run
local noteRunId  -- the engine run the note belongs to; any other run drops it
local claiming   -- true while Engine:Start starts the engine run for its note

local TOKEN_SECONDS = 5 -- how long the words that match you (or the player previewed as) are kept

-- Melee damage specializations, used for the "melee" and "ranged" tags. Tanks and healers match
-- "tank" and "healer" instead. A spec not listed counts as ranged.
local MELEE_SPECS = {
    [70] = true, -- Retribution Paladin
    [71] = true, [72] = true, -- Arms, Fury Warrior
    [251] = true, [252] = true, -- Frost, Unholy Death Knight
    [259] = true, [260] = true, [261] = true, -- Rogue
    [269] = true, -- Windwalker Monk
    [577] = true, -- Havoc Demon Hunter
    [103] = true, -- Feral Druid
    [255] = true, -- Survival Hunter
    [263] = true, -- Enhancement Shaman
}

local function specIdAndRole()
    local info = C_SpecializationInfo
    local getSpec = (info and info.GetSpecialization) or GetSpecialization
    local getInfo = (info and info.GetSpecializationInfo) or GetSpecializationInfo
    if not (getSpec and getInfo) then
        return nil, nil
    end
    local ok, index = pcall(getSpec)
    if not ok or not index then
        return nil, nil
    end
    local ok2, id, _, _, _, role = pcall(getInfo, index)
    if ok2 then
        return id, role
    end
    return nil, nil
end

-- Adds the tag words for one of Parse.lua's ROLE_WORDS keys ("everyone", "tank", "melee", ...) to t.
local function addRoleWords(t, key)
    for _, w in ipairs(CRT.NoteParser.ROLE_WORDS[key]) do
        t[w] = true
    end
end

-- The words that match you: your name, your role, and melee or ranged.
local myTokens, tokensAt
local function tokens()
    if myTokens and tokensAt and GetTime() - tokensAt < TOKEN_SECONDS then
        return myTokens
    end
    local t = {}
    addRoleWords(t, "everyone")
    local name = UnitName("player")
    if name then
        t[name:lower()] = true
    end
    local specId, specRole = specIdAndRole()
    local role = UnitGroupRolesAssigned("player")
    if not role or role == "NONE" then
        role = specRole
    end
    if role == "TANK" then
        addRoleWords(t, "tank")
    elseif role == "HEALER" then
        addRoleWords(t, "healer")
    else
        addRoleWords(t, "dps")
        addRoleWords(t, (specId and MELEE_SPECS[specId]) and "melee" or "ranged")
    end
    myTokens, tokensAt = t, GetTime()
    return t
end

local function readable(v)
    local T = CRT.Timeline
    if T and T.readable then
        return T.readable(v)
    end
    return true
end

-- Your class file ("DEATHKNIGHT"). Which words name it ("Death Knight", "DEATHKNIGHT", the client's own name)
-- is Parse.lua's class words, the one table of them.
-- Only IsMine and assignment lines read it: a class word is common in ordinary sentences, so it never marks
-- other free text as yours.
local myClass, classAt
local function myClassFile()
    if classAt and GetTime() - classAt < TOKEN_SECONDS then
        return myClass
    end
    local file
    if UnitClass then
        local ok, _, f = pcall(UnitClass, "player")
        if ok and readable(f) and type(f) == "string" and f ~= "" then
            file = f
        end
    end
    myClass, classAt = file, GetTime()
    return file
end

-- Your raid group number. In a party or solo you count as group 1.
local function mySubgroup()
    if IsInRaid() then
        for i = 1, GetNumGroupMembers() do
            if UnitIsUnit("raid" .. i, "player") then
                local _, _, subgroup = GetRaidRosterInfo(i)
                return subgroup
            end
        end
    end
    return 1
end

-- The group number a tag names: "G1", "Grp1" or "Group1" in one word, or "G", "Grp" or "Group"
-- followed by a number as the next word, so "Group 1" works too. Returns the number and how many
-- words it used, or nil. The words are Parse.lua's GROUP_WORDS.
local function groupTag(word, nextWord)
    local GROUP_WORDS = CRT.NoteParser.GROUP_WORDS
    local prefix, number = word:match("^(%a+)(%d)$")
    if prefix and GROUP_WORDS[prefix] then
        return tonumber(number), 1
    end
    if GROUP_WORDS[word] and nextWord and nextWord:match("^%d$") then
        return tonumber(nextWord), 2
    end
    return nil
end

-- Preview as (a rehearsal): the words that match another player, their name and, when CRT.AlertRoster
-- knows it, their class. Their role, spec and group can't be known, so those tags never match them.
-- Kept for a few seconds per name, as your own are, since the windows ask for every line.
local preview = {}
local function previewTokens(name)
    if preview.name == name and preview.at and GetTime() - preview.at < TOKEN_SECONDS then
        return preview.t, preview.class
    end
    local t = {}
    addRoleWords(t, "everyone")
    local short = name:lower():gsub("%-.*$", "")
    t[short] = true
    local Roster = CRT.AlertRoster
    local class = Roster and Roster.ClassOf and Roster:ClassOf(name) or nil
    if not (readable(class) and type(class) == "string") then
        class = nil
    end
    preview.name, preview.at, preview.t, preview.class = name, GetTime(), t, class
    return t, class
end

-- Whether a timer is for you: your name, your role, your class, everyone, or your raid group. A name in
-- a tag may carry a realm, which is ignored. A class name of several words may be split over them, and is
-- read as one class first, so "Demon Hunter" is never a Hunter's (Parse.lua's class words).
-- In a rehearsal, Preview as decides instead: "*" takes every tagged line (an untagged line is for no
-- one, so it still shows only in the timers window), and a player's name takes their lines.
function Engine:IsMine(item)
    local tags = item.tags
    local as = Alerts.PreviewAs and Alerts:PreviewAs()
    if as == "*" then
        return #tags > 0
    end
    local mine, myFile
    if as then
        mine, myFile = previewTokens(as)
    else
        mine, myFile = tokens(), myClassFile()
    end
    local subgroup
    local classAtWord = CRT.NoteParser.ClassAt
    local i = 1
    while i <= #tags do
        local word = tags[i]:lower():gsub("%-.*$", "")
        if mine[word] then
            return true
        end
        local class, n = classAtWord(tags, i)
        local number, used = groupTag(word, tags[i + 1])
        if class then
            if class == myFile then
                return true
            end
            i = i + n -- the whole class name: its last word is not read again as a class of its own
        elseif number then
            -- another player's group can't be known, so a group tag never matches them
            if not as then
                subgroup = subgroup or mySubgroup()
                if number == subgroup then
                    return true
                end
            end
            i = i + used
        else
            i = i + 1
        end
    end
    return false
end

-- Whether a timer stays when "Show only me" is on: it is yours, or it has no tag, which means everyone.
function Engine:IsForMe(item)
    return #item.tags == 0 or self:IsMine(item)
end

-- Words that also appear in ordinary sentences, so they never mark a line of free text as yours.
local NOT_IN_TEXT = { all = true, everyone = true, raid = true, range = true, heal = true, damager = true }

-- Whether a word of a note's free text is your name or your role, such as "Tanks" or "Melee".
function Engine:WordIsMe(word)
    local w = word:lower():gsub("%-.*$", "")
    if NOT_IN_TEXT[w] then
        return false
    end
    return tokens()[w] and true or false
end

-- Whether an assignment line ("Orb Soak 1: Demon Hunter Warlock", a label Parse.lua's LooksLikeLabel takes)
-- names your class, as your name or role would (Alex, 2026-10-21). Its classes are the ones Parse.lua's
-- AssignmentClasses counts, so "Demon Hunter" is never a Hunter's, "Soak: priest, monk" is a Priest's and
-- "Note: the Hunter kites" is no one's. Any other line is never yours by class.
function Engine:ClassLineIsMine(line)
    local Parser = CRT.NoteParser
    local label, rest = line:match("^([^:]+):(.*)$")
    local file = label and Parser.LooksLikeLabel(label) and myClassFile()
    if not file then
        return false
    end
    for _, item in ipairs(Parser.AssignmentClasses(rest)) do
        if item.counts and item.class == file then
            return true
        end
    end
    return false
end

function Engine:Note()
    return note
end

-- Starts a run of the note. Inside a pull (the engine's onPull hook) the run is already starting and
-- collects the note's items right after, so the engine is only started here for a test run.
function Engine:Start(parsedNote, reason)
    if not parsedNote then
        return
    end
    note = parsedNote
    self.reason = reason
    myTokens, classAt = nil, nil
    if Alerts.starting then
        noteRunId = Alerts.runId
    else
        claiming = true
        Alerts:Start(parsedNote.encounterID, nil, reason)
        claiming = false
    end
end

function Engine:Stop()
    Alerts:Stop()
end

-- Starts the next phase of the alerts run now, with or without a note (a pull may run only
-- reminders). Returns the phase that started, or nil.
function Engine:NextPhase()
    if not Alerts.running then
        return nil
    end
    return Alerts:NextPhase()
end

-- The phase Next phase would start, or nil. Starts nothing.
function Engine:PeekNextPhase()
    return Alerts:PeekNextPhase()
end

function Engine:PhaseStarted(ph)
    return Alerts:PhaseStart(ph) ~= nil
end

function Engine:CurrentPhase()
    return Alerts:CurrentPhase()
end

-- Seconds since the pull.
function Engine:Elapsed()
    if not self.running or not note then
        return nil
    end
    return Alerts:Elapsed()
end

-- Seconds until a timer, or nil if its phase has not started. Negative once it has passed.
-- Whether a later phase has started before this line's time (the phase mask, Alerts:IsCut).
-- Also true when the raid's chosen order moves the line past its part's new window.
function Engine:IsCut(item)
    local t = Alerts:OrderTime(item.spellId, item.text, item.ph, item.time)
    if t == false then
        return true
    end
    return Alerts:IsCut(item.ph, t)
end

function Engine:Remaining(item)
    local start = Alerts:PhaseStart(item.ph)
    if not start then
        return nil
    end
    local t = Alerts:OrderTime(item.spellId, item.text, item.ph, item.time)
    return start + (t or item.time) - (Alerts.Now and Alerts:Now() or GetTime())
end

-- The note block -----------------------------------------------------------------------------

-- The note a run uses: the one running for the current run, or (for any other run, such as the
-- Phases tab asking which phases a boss has) the note saved for that boss.
local function noteFor(run)
    if run == nil or run == Alerts.run then
        return note
    end
    if run.encounterID then
        local id = Notes:FindForEncounter(run.encounterID, run.difficultyName)
        if id then
            return Notes:Parsed(id)
        end
    end
    return nil
end

-- The alert item of one timer, `index` its place in the note and `mine` whether it is for you. Your
-- timers alert, show as bars and are read out, or, when the line has show:, use exactly the displays it
-- names; anyone else's only show in the timers window, so they carry no outputs. Used by the block and by
-- the alert editor's Test of a note line.
function Engine.ItemFor(t, index, mine)
    local s = Notes:Alert() or {}
    local info = t.kind == "spell" and Notes:SpellInfo(t.spellId) or nil
    local item = {
        id = "note:" .. index,
        ph = t.ph,
        time = t.time,
        spellID = t.spellId,
        icon = info and info.icon,
        text = t.kind == "spell" and (info and info.name or ("Spell " .. tostring(t.spellId))) or (t.text or ""),
        color = t.color,
    }
    -- A line with show: is labelled by its text: when it has one, as a reminder is; the spell gives the
    -- icon. A line without show: keeps the spell's name. ownLabel tells the Next spell alert to show the
    -- item's own text, icon and colour, as the areas do.
    if t.show then
        item.ownLabel = true
    end
    if t.show and type(t.text) == "string" and t.text ~= "" then
        item.text = t.text
    end
    if t.show and type(t.iconID) == "number" and t.iconID > 0 then
        item.icon = t.iconID
    end
    if not mine then
        return item
    end
    item.priority = Rules.Priority(2, "normal")
    if t.show then
        local show = t.show
        local speaks = (t.tts or t.count) and true or false
        item.outputs = {
            alert = show.alert and true or false,
            text = show.text and true or false,
            icon = show.icon and true or false,
            bar = show.bar and true or false,
            circle = show.circle and true or false,
            timeline = show.timeline and true or false,
            speech = speaks,
        }
        item.warn = t.warn or s.seconds or 10
        item.hold = math.max(0.5, t.linger or t.dur or 0)
        item.sound = t.sound
        item.glow = t.glow and true or nil
        item.speech = Rules.SpeechItems(item.text, item.warn, t.tts and true or false, t.count and true or false,
            t.speakAt == "zero")
        return item
    end
    local settings = Alerts:Settings() or {}
    local bars = settings.bars or {}
    item.outputs = {
        alert = s.enabled and true or false,
        bar = (bars.shown and bars.noteLines) and true or false,
        -- Read out wherever the line shows, with or without the Next spell alert (ruling B2).
        speech = s.tts and true or false,
    }
    -- Where else the player sends their own note lines (Raid Notes > Alerts); each is off unless chosen,
    -- so the outputs stay as they were for anyone who has not.
    local routing = type(settings.noteLines) == "table" and settings.noteLines or {}
    for _, area in ipairs({ "text", "icon", "circle", "timeline" }) do
        if routing[area] then
            item.outputs[area] = true
        end
    end
    item.warn = s.seconds or 10
    -- A spell shows for half a second after its time, a text line for its dur:.
    item.hold = t.kind == "text" and (t.dur or 0) or 0.5
    -- ttsat:0 reads it out at its time, as a line with show: does
    item.speech = { { offset = t.speakAt == "zero" and 0 or (s.ttsSeconds or 3), text = info and info.name or t.text or "" } }
    return item
end

-- One item per timer.
local function entries(run)
    local n = noteFor(run)
    if not n then
        return {}
    end
    local out = {}
    for index, t in ipairs(n.timers) do
        out[#out + 1] = Engine.ItemFor(t, index, Engine:IsMine(t))
    end
    return out
end

-- Whether an item of this block is the note line a rehearsal's test replaces ({ noteID, line }, see
-- Alerts:Collect): the run's note is that note and the item's timer (its index, "note:<n>") is on that line.
local function replaces(run, rep, item)
    local n = noteFor(run)
    local index = type(item.id) == "string" and tonumber(item.id:match("^note:(%d+)$"))
    local t = n and index and n.timers[index]
    return t ~= nil and Engine.noteId ~= nil and Engine.noteId == rep.noteID and t.line == rep.line
end

Alerts:RegisterBlock("note", { label = "Raid note", group = false, Entries = entries, Replaces = replaces })

-- Your personal note for the run's boss (Notes:PersonalFor): every line of it is yours, alerting as your
-- own note lines do, on every pull of that boss whichever shared note runs. Never shared.
local function personalEntries(run)
    run = run or Alerts.run
    if not (run and run.encounterID) then
        return {}
    end
    local id = Notes.PersonalFor and Notes:PersonalFor(run.encounterID, run.difficultyName)
    local n = id and Notes:Parsed(id)
    if not n then
        return {}
    end
    local out = {}
    for index, t in ipairs(n.timers) do
        local item = Engine.ItemFor(t, index, true)
        item.id = "personal:" .. index
        out[#out + 1] = item
    end
    return out
end

-- own: your personal note is yours alone, so a Rehearsal previewing as another player leaves it out
Alerts:RegisterBlock("personal", { label = "Your personal note", group = false, own = true, Entries = personalEntries })

-- On a pull, the note for the boss (preferring the same difficulty) becomes the note in use and runs.
Alerts.onPull[#Alerts.onPull + 1] = function(run)
    note = nil
    local id = Notes:FindForEncounter(run.encounterID, run.difficultyName)
    if id then
        Notes:SetActive(id)
        Engine:Start(Notes:Parsed(id), "encounter")
    end
end

-- A rehearsal runs the boss's note (preferring the same difficulty) without making it the active one,
-- and without the pull's hooks.
Alerts.onRehearsal = Alerts.onRehearsal or {}
-- Engine.noteId is the rehearsed note's id (the timers window shows that note, not the active one); it is
-- cleared whenever the note is dropped.
Alerts.onRehearsal[#Alerts.onRehearsal + 1] = function(run)
    note = nil
    Engine.noteId = nil
    local id = Notes:FindForEncounter(run.encounterID, run.difficultyName)
    if id then
        note = Notes:Parsed(id)
        noteRunId = Alerts.runId
        Engine.noteId = id
        Engine.reason = "rehearsal"
    end
    preview.at = nil -- the roster may have changed since the last rehearsal
end

-- running and runId follow the engine; running is only true while the engine runs a note, so a pull
-- of a boss with no note shows as not running, as before. When the engine stops (Stop, or the end of
-- the encounter) or another run replaces the note's (such as the reminder editor's Test), the note is
-- dropped. Every change tells the note windows and pages.
Alerts:OnChange(function()
    if claiming and Alerts.running then
        noteRunId = Alerts.runId
    end
    if not Alerts.running or Alerts.runId ~= noteRunId then
        note = nil
    end
    if not note or not (Alerts.IsRehearsal and Alerts:IsRehearsal()) then
        Engine.noteId = nil
    end
    Engine.running = Alerts.running and note ~= nil
    Engine.runId = Alerts.runId
    Notes:Fire()
end)
