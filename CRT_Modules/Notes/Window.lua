local ADDON, CRT = ...

-- The three note windows, built from one shared design:
--   window       the timers of the note in use. Before the pull it lists every timer by phase. During the
--                fight each line counts down and disappears once its time has passed.
--   assignments  the note's text that is not a timer, such as "Kick order" and the names under it.
--   personal     your own personal note, typed on the Raid Notes page, under your personal reminders
--                for the current boss. Only you see it.
-- Each window has its own font, size, transparency, position and size, saved per player in CRTDB.notes.
-- Unlocked, a window can be dragged to move it and resized from its bottom-right corner. Locked, it lets
-- clicks through. Names are class colored, and a line for you (your name or your role) is marked.

local Notes = CRT.Notes
local Engine = CRT.NoteEngine
local NoteWindow = { windows = {} }
CRT.NoteWindow = NoteWindow

-- Whether the note windows may show where you are: in a raid instance, or anywhere when "Show outside of
-- raid" is ticked (Notes Settings, off by default), or during a rehearsal you started. Dungeons, delves, battlegrounds and the open
-- world all count as outside.
function NoteWindow.AllowedHere()
    local Alerts = CRT.Alerts
    if Notes:ShowOutsideRaid() or (Alerts and Alerts.IsRehearsal and Alerts:IsRehearsal()) then
        return true
    end
    local _, instanceType = IsInInstance()
    return instanceType == "raid"
end

local REFRESH_SECONDS = 0.1
local GRIP = "Interface\\ChatFrame\\UI-ChatIM-SizeGrabber"
local BACKDROP = { bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 }
-- The "note updated" stamp: how strong it starts, how long it holds, and how long it fades (seconds).
local FLASH_ALPHA = 0.75
local FLASH_HOLD = 0.15
local FLASH_FADE = 1.2
-- The windows that flash when a note is shared: all three, the personal one included, so a share is seen
-- whichever window you keep up.
local STAMP_WINDOWS = { window = true, assignments = true, personal = true }

-- The same list as the General Settings page's font choice, in Core.lua.
NoteWindow.FONTS = CRT.FONTS

local previewOn = false

-- Work once, draw often. The windows' text is rebuilt only when something it shows may have changed: the
-- note, the settings, the group, your role, your reminders, the alerts run (a phase start included), the
-- class cache, the theme, or previews. contentVersion goes up on each of those, and a window rebuilds when
-- it has not drawn the current version; out of a run, a rebuild every few seconds anyway catches anything
-- missed. While a note runs (the timers window) or a run of your reminders goes (the personal window), each
-- line's text is kept from that rebuild and a refresh only works out each line's whole second: a line's
-- time is made again only when its second changes, and a refresh that changes nothing on screen sets no
-- text at all.
local contentVersion = 1
local SAFETY_SECONDS = 5
local function changed()
    contentVersion = contentVersion + 1
end

-- The lines a window shows. Each line is { t = time text or nil, x = text }: on screen, t then x on one row
-- (the countdown in its own cell, so a new second sets only that cell). A line with no t and an empty x is
-- a blank line.
local NO_LINES = {}
local EMPTY = {}

-- Lines of plain text, one per line of `text`, made again only when the text changes (cache keeps them).
local function textLines(cache, text)
    if cache.text == text and cache.lines then
        return cache.lines
    end
    local lines = {}
    for line in (text .. "\n"):gmatch("(.-)\n") do
        lines[#lines + 1] = { x = line }
    end
    cache.text, cache.lines = text, lines
    return lines
end

-- Text helpers --------------------------------------------------------------------------

local function fmtTime(seconds)
    if seconds < 0 then
        seconds = 0
    end
    return format("%d:%02d", math.floor(seconds / 60), math.floor(seconds % 60))
end

-- Headings and your own lines, in the theme's heading colour (the game's gold in Default: Blizzard).
local function gold(text)
    return CRT.UI.HeadingText(text)
end

local function hex(color)
    if not color then
        return "ffffff"
    end
    return format("%02x%02x%02x", math.floor((color[1] or 1) * 255), math.floor((color[2] or 1) * 255), math.floor((color[3] or 1) * 255))
end

-- How many times the class cache has changed: CRT.Groups counts each class it saves (Groups/Data.lua).
local function classVersion()
    local G = CRT.Groups
    return G and G.classVersion or 0
end

-- Short name -> class, from the class cache. The cache can hold thousands of names, so the table is made
-- again only when the cache changes (or is a new table, as after a profile loads), never on a timer.
local shortClass, shortFrom, shortVersion = {}, nil, nil
local function classOf(word)
    local cache = CRT.db.classCache or EMPTY
    local version = classVersion()
    if cache ~= shortFrom or version ~= shortVersion then
        shortClass, shortFrom, shortVersion = {}, cache, version
        for key, class in pairs(cache) do
            local short = key:match("^[^-]+")
            if short and not shortClass[short] then
                shortClass[short] = class
            end
        end
    end
    return shortClass[(word:lower():gsub("%-.*$", ""))]
end

local function colorName(word)
    local class = classOf(word)
    local color = class and RAID_CLASS_COLORS[class]
    if color and color.colorStr then
        return "|c" .. color.colorStr .. word .. "|r"
    end
    return word
end

local function names(item)
    local parts = {}
    for _, tag in ipairs(item.tags) do
        parts[#parts + 1] = colorName(tag)
    end
    return table.concat(parts, " ")
end

-- A timer's icon and label. Also true when it is a spell the game has not given its name yet, so a
-- kept line can ask again.
local function describe(item)
    if item.kind == "spell" then
        local info = Notes:SpellInfo(item.spellId)
        local icon = info and info.icon and ("|T" .. info.icon .. ":0|t ") or ""
        return icon .. (info and info.name or ("Spell " .. item.spellId)), not info
    end
    return "|cff" .. hex(item.color) .. (item.text or "") .. "|r", false
end

-- A timer line's time cell: yours with ">" in the heading colour, else grey.
local function timeText(mine, seconds)
    local time = fmtTime(seconds)
    if mine then
        return gold("> " .. time)
    end
    return "|cffaaaaaa" .. time .. "|r"
end

-- A timer line's text after its time: the label, then the names. Also describe's "ask again".
local function restText(item)
    local label, missing = describe(item)
    return "  " .. label .. "  " .. names(item), missing
end

local function timerLine(item, seconds)
    return timeText(Engine:IsMine(item), seconds) .. (restText(item))
end

-- A line of free text: names class colored, your own name in gold, and the line marked with ">" when it
-- names you or your role, or (an assignment line) your class. A line with no colon is treated as a heading,
-- unless noHeading.
local function textLine(line, noHeading)
    if line == "" then
        return ""
    end
    -- an assignment line naming your class is yours too; a sentence never is by class
    local mine = Engine:ClassLineIsMine(line)
    local myName = (UnitName("player") or ""):lower()
    local colored = line:gsub("[%w\128-\255]+", function(word)
        if Engine:WordIsMe(word) then
            mine = true
        end
        if word:lower() == myName then
            return gold(word)
        end
        return colorName(word)
    end)
    if not noHeading and not line:find(":", 1, true) then
        colored = gold(colored)
    end
    if mine then
        return gold("> ") .. colored
    end
    return colored
end

local function textBlock(lines)
    local out = {}
    local Kicks = CRT.InterruptNote
    for _, line in ipairs(lines) do
        -- a kick order line: its group's raid marker icon in front (Interrupts/NoteBlock.lua's Expand)
        local marker
        if Kicks then
            marker, line = Kicks.TakeMarker(line)
        end
        local icon = marker and Kicks.Icon(marker, 14) or ""
        out[#out + 1] = (icon ~= "" and (icon .. " ") or "") .. textLine(line)
    end
    return table.concat(out, "\n")
end

-- Formats lines of free text the way the assignments and personal windows show them.
NoteWindow.FormatText = textBlock

-- Markdown in your personal note, a small set the game's text can show (one font size, no italics):
--   # Heading, ## Heading   a gold heading line
--   **bold**                 amber
--   - item or * item         a bullet
--   ---                      a divider line
-- Applied before the names are colored, so a name in a bullet or in bold still shows its class color.
local BOLD = "|cffffb84d"
local BULLET = "  \226\128\162 "

local function markdownLine(line)
    local heading = line:match("^%s*#+%s+(.-)%s*$")
    if heading then
        return gold(heading), true
    end
    if line:match("^%s*%-%-%-+%s*$") or line:match("^%s*%*%*%*+%s*$") then
        return "|cff806040" .. string.rep("-", 30) .. "|r", true
    end
    local item = line:match("^%s*[%-%*]%s+(.+)$")
    if item then
        line = BULLET .. item
    end
    line = line:gsub("%*%*(.-)%*%*", function(inner)
        return BOLD .. inner .. "|r"
    end)
    return line, false
end

-- A free text line of the personal note: markdown, then the names and ">" as textLine gives them. A
-- heading or divider is shown as it is; a line markdown changed is never taken as a colon-less heading.
local function personalLine(line)
    if line == "" then
        return ""
    end
    local md, whole = markdownLine(line)
    if whole then
        return md
    end
    -- a bullet or bold line keeps its own look: never the gold of a line with no colon
    return textLine(md, md ~= line)
end
NoteWindow.PersonalLine = personalLine

local function splitLines(text)
    local lines = {}
    for line in ((text or "") .. "\n"):gmatch("(.-)\r?\n") do
        lines[#lines + 1] = line
    end
    while #lines > 0 and lines[#lines] == "" do
        lines[#lines] = nil
    end
    return lines
end

-- What each window shows: returns text, heading, hasContent ------------------------------------

-- The note the timers window shows: the rehearsed one during a rehearsal run (CRT.NoteEngine.noteId, which
-- need not be the active note), else the active note. Returns record, note.
local function timersNote()
    local Alerts = CRT.Alerts
    if Engine.noteId and Engine:Note() and Alerts and Alerts.IsRehearsal and Alerts:IsRehearsal() then
        local record = Notes:Get(Engine.noteId)
        if record then
            return record, Engine:Note()
        end
    end
    local _, record, note = Notes:Active()
    return record, note
end

-- The timers window. Its kept state: the note, record and settings it was built for, and per timer an
-- entry { item, mine, shown, cut, x, t, sec, missing } that is also the timer's line.
local SAMPLE_TIMERS = "  Avenging Wrath  Crazyoio\n|cffaaaaaa0:06|r  Sample spell  Cheoeqar\n|cffaaaaaa0:48|r  |cff00ffffGroup 1 go in|r  Cheoeqar Djaztech"
local ONLY_ME = { x = "|cff777777Nothing in this note is for you. Untick Show only me to see every line.|r" }
local MISSING_SECONDS = 1 -- how often a spell line the game has not named yet asks again during a run
local timers = { entries = {}, lines = {}, waits = {}, waiting = {}, sample = {}, empty = {}, builtAt = 0, askedAt = 0 }

-- Whether the kept lines no longer match what the window would show.
local function timersStale(record, note, onlyMe, as, running)
    local A = CRT.Alerts
    local k = timers
    return k.note ~= note or k.record ~= record or k.version ~= contentVersion or k.alerts ~= (A and A.version)
        or k.classes ~= classVersion() or k.onlyMe ~= onlyMe or k.as ~= as or k.running ~= running
end

-- Builds every timer's line text once: whether it is yours and shown, cut by a later phase, its label and
-- names. Out of a run, also the whole list by phase, as it stays until something changes.
local function timersRebuild(record, note, onlyMe, as, running)
    local k, A = timers, CRT.Alerts
    k.note, k.record, k.version, k.alerts, k.classes = note, record, contentVersion, A and A.version, classVersion()
    k.onlyMe, k.as, k.running, k.builtAt, k.missing = onlyMe, as, running, GetTime(), false
    local entries = k.entries
    for i, item in ipairs(note.timers) do
        local e = entries[i] or {}
        entries[i] = e
        e.item = item
        e.mine = Engine:IsMine(item) and true or false
        -- "Show only me" keeps your lines, your group's and role's, and lines with no tag.
        e.shown = not onlyMe or Engine:IsForMe(item)
        -- A later phase started first: this line never comes.
        e.cut = running and Engine.IsCut and Engine:IsCut(item) and true or false
        e.x, e.missing = restText(item)
        k.missing = k.missing or e.missing
        e.sec, e.t = nil, nil
    end
    for i = #note.timers + 1, #entries do
        entries[i] = nil
    end
    local heading = record.name .. (record.difficulty and (" (" .. record.difficulty .. ")") or "")
    if onlyMe and not as then
        heading = heading .. "   " .. gold("only me")
    end
    k.base, k.heading, k.headPhase, k.headSecond = heading, heading, nil, nil
    local lines = k.lines
    for i = #lines, 1, -1 do
        lines[i] = nil
    end
    if running then
        return
    end
    local lastPhase
    for i, item in ipairs(note.timers) do
        local e = entries[i]
        if e.shown then
            if item.ph ~= lastPhase then
                lines[#lines + 1] = { x = gold("Phase " .. item.ph) }
                lastPhase = item.ph
            end
            e.t = timeText(e.mine, item.time)
            lines[#lines + 1] = e
        end
    end
    if onlyMe and #lines == 0 and #note.timers > 0 then
        lines[1] = ONLY_ME
    end
end

-- A spell line the game had not named yet asks again, about once a second, until it is named.
local function askMissing()
    local k = timers
    if not k.missing or GetTime() - k.askedAt < MISSING_SECONDS then
        return
    end
    k.askedAt, k.missing = GetTime(), false
    for _, e in ipairs(k.entries) do
        if e.missing then
            e.x, e.missing = restText(e.item)
            k.missing = k.missing or e.missing
        end
    end
end

local function waitLine(ph)
    local line = timers.waits[ph]
    if not line then
        line = { x = "|cff777777Phase " .. ph .. " starts on Next phase|r" }
        timers.waits[ph] = line
    end
    return line
end

-- During a run: each line's remaining time, to the whole second shown. A line's time text is made again
-- only when that second changes; the kept text is used as it is.
local function timersTick(note, onlyMe)
    local k = timers
    askMissing()
    local hidePassed = Notes:WindowSettings("window").hidePassed
    local lines, waiting, entries = k.lines, k.waiting, k.entries
    for ph in pairs(waiting) do
        waiting[ph] = nil
    end
    local n = 0
    for i, item in ipairs(note.timers) do
        local e = entries[i]
        local remaining = Engine:Remaining(item)
        if remaining == nil then
            waiting[item.ph] = true
        elseif not e.cut and e.shown and not (hidePassed and remaining < -(item.dur or 0)) then
            -- the shown time is the whole second, 0 once passed (fmtTime)
            local second = remaining > 0 and math.floor(remaining) or 0
            if e.sec ~= second then
                e.sec, e.t = second, timeText(e.mine, second)
            end
            n = n + 1
            lines[n] = e
        end
    end
    for _, ph in ipairs(note.phases) do
        if waiting[ph] then
            n = n + 1
            lines[n] = waitLine(ph)
        end
    end
    if onlyMe and n == 0 and #note.timers > 0 then
        n = 1
        lines[1] = ONLY_ME
    end
    for i = #lines, n + 1, -1 do
        lines[i] = nil
    end
    local phase = Engine:CurrentPhase()
    local elapsed = Engine:Elapsed() or 0
    local second = elapsed > 0 and math.floor(elapsed) or 0
    if phase ~= k.headPhase or second ~= k.headSecond then
        k.headPhase, k.headSecond = phase, second
        k.heading = k.base .. "   Phase " .. tostring(phase) .. "   " .. fmtTime(second)
    end
end

-- force: rebuild the kept text even when nothing seems to have changed (a refresh out of a run).
local function timersBuild(_, force)
    local record, note = timersNote()
    if not note then
        if previewOn then
            return textLines(timers.sample, gold("> 0:03") .. SAMPLE_TIMERS), "Raid note (sample)", true
        end
        return textLines(timers.empty, "No note loaded."), "Raid note", false
    end
    local onlyMe = Notes:WindowSettings("window").onlyMe and true or false
    -- Previewing as another player in a rehearsal shows what their window would with Show only me on;
    -- as everyone, every line.
    local as = CRT.Alerts and CRT.Alerts.PreviewAs and CRT.Alerts:PreviewAs()
    if as == "*" then
        onlyMe = false
    elseif as then
        onlyMe = true
    end
    local running = (Engine.running and Engine:Note() == note) and true or false
    if force or timersStale(record, note, onlyMe, as, running) then
        timersRebuild(record, note, onlyMe, as, running)
    end
    if running then
        timersTick(note, onlyMe)
    end
    return timers.lines, timers.heading, #note.timers > 0
end

local SAMPLE_ASSIGNMENTS = {
    "Soulcoil Well Realm Groups",
    "Realm Group 1: Cheoeqar Djaztech Gadios",
    "",
    "Kick order",
    "Kicks G1: Teronhorefnd Gadios",
}

local function assignmentsText()
    local _, record, note = Notes:Active()
    local lines = note and note.lines
    -- the kick block reads as "Kick order" and a line per group (the saved text stays as written)
    if lines and record.raw and CRT.InterruptNote then
        local shown = CRT.InterruptNote.Expand(record.raw, record)
        if shown ~= record.raw then
            lines = CRT.NoteParser.Parse(shown).lines
        end
    end
    if lines and #lines > 0 then
        return textBlock(lines), "Assignments: " .. record.name, true
    end
    if previewOn then
        return textBlock(SAMPLE_ASSIGNMENTS), "Assignments (sample)", true
    end
    return "", "Assignments", false
end

local assignmentsCache = {}
local function assignmentsBuild()
    local text, heading, hasContent = assignmentsText()
    return textLines(assignmentsCache, text), heading, hasContent
end

-- Your reminders in the personal window ------------------------------------------------------
-- The current boss's personal reminders (CRT.AlertReminders, "Only me"), above the free text: a heading
-- with the boss's name, then each time of each reminder by phase. During a run of that boss they come
-- from the run itself (the alerts engine's "mine" items, so the difficulty and phase starts are the
-- run's), counting down like the timers window, the next one marked and passed ones hidden with the
-- timers window's "Hide lines once passed". The current boss is the running encounter, else the boss
-- of the note in use, else none (then only the free text). An editor Test run is not a boss.

local TEXT = {
    phase = "Phase %s",
    waiting = "Phase %s starts on Next phase",
    boss = "Boss %s",
    reminder = "Reminder",
}

-- False for a secret value (CRT.Timeline.readable, loaded later than this file).
local function readable(v)
    local T = CRT.Timeline
    if T and T.readable then
        return T.readable(v)
    end
    return not (issecretvalue and issecretvalue(v))
end

local function bossID(v)
    if readable(v) and type(v) == "number" and v > 0 then
        return v
    end
    return nil
end

-- encounterID, the run when it is that boss's, and the note record when the boss comes from the note. An editor
-- Test and the pull timer's countdown run (Alerts/Countdown.lua) aren't a boss's pull: the note's boss stays.
local function currentBoss()
    local Alerts = CRT.Alerts
    local run = Alerts and Alerts.running and Alerts.run
    if run and ((run.reason ~= "test" and run.reason ~= "countdown") or Engine.running) then
        local id = bossID(run.encounterID)
        if id then
            return id, run
        end
    end
    local _, record = Notes:Active()
    local id = record and bossID(record.encounterID)
    if id then
        return id, nil, record
    end
    return nil
end

-- The boss library's name, else the name saved on one of its reminders, else the note's.
local function bossName(encounterID, list, record)
    local def = CRT.Bosses and CRT.Bosses:Get(encounterID)
    if def and type(def.name) == "string" and def.name ~= "" then
        return def.name
    end
    for _, e in ipairs(list) do
        if type(e.r.boss) == "string" and e.r.boss ~= "" then
            return e.r.boss
        end
    end
    if record and type(record.name) == "string" and record.name ~= "" then
        return record.name
    end
    return format(TEXT.boss, tostring(encounterID))
end

local function reminderLine(item, seconds, isNext)
    local icon = item.icon and ("|T" .. tostring(item.icon) .. ":0|t ") or ""
    local text = icon .. tostring(item.text or TEXT.reminder)
    if isNext then
        return gold("> " .. fmtTime(seconds)) .. "  " .. text
    end
    return "|cffaaaaaa" .. fmtTime(seconds) .. "|r  " .. text
end

local function phaseHeading(ph)
    return gold(format(TEXT.phase, tostring(ph)))
end

-- Out of a run: every time of every turned-on reminder of one difficulty group, by phase: the note's, else
-- (a note of no difficulty, or none) the raid you are in, else Normal/Heroic. So the two copies of a
-- reminder split into one per group never both show. One saved as Raid note is left out, as the alerts leave it
-- out: the raid note lists its lines.
local function plannedLines(encounterID, list, record)
    local R = CRT.AlertReminders
    local difficulty = record and type(record.difficulty) == "string" and record.difficulty ~= "" and record.difficulty or nil
    local items = {}
    -- the group: the reminders of that group, and the ability timeline one on any difficulty (not split
    -- yet) reads
    local T, Draft = CRT.Timeline, CRT.AlertDraft
    local group = difficulty and T and T.GroupOf and T:GroupOf(nil, difficulty) or nil
    if not group and T and T.GroupOf and Draft and Draft.CurrentDifficultyID then
        group = T:GroupOf(Draft.CurrentDifficultyID(), nil)
    end
    group = group or "nh"
    for _, e in ipairs(list) do
        local r = R:Effective("mine", e.id, e.r)
        local own = R.GroupOf and R.GroupOf(r) or nil
        if r.enabled ~= false and not (R.InNote and R.InNote(r)) and not (own and group and own ~= group) then
            for _, it in ipairs(R:Items(encounterID, e.id, r, group)) do
                items[#items + 1] = it
            end
        end
    end
    table.sort(items, function(a, b)
        if a.ph ~= b.ph then
            return a.ph < b.ph
        end
        if a.time ~= b.time then
            return a.time < b.time
        end
        return a.id < b.id
    end)
    local lines, lastPhase = {}, nil
    for _, it in ipairs(items) do
        if it.ph ~= lastPhase then
            lines[#lines + 1] = phaseHeading(it.ph)
            lastPhase = it.ph
        end
        lines[#lines + 1] = reminderLine(it, it.time)
    end
    return lines
end

-- During a run: the run's own reminder items, counting down from each phase's start, on the engine's
-- time (a rehearsal's clock in one). Built once per change of the run (a phase start, a reminder saved):
-- the phases in order, each phase's rows in the order they come, each row's text after its time. A
-- refresh only works out each row's second, which rows are passed and which one is next (runTick).
local function runModel(head)
    local Alerts = CRT.Alerts
    local byPhase, order = {}, {}
    for index, it in ipairs(Alerts.items or {}) do
        if it.block == "mine" then
            local start = Alerts:PhaseStart(it.ph)
            if start and Alerts:IsCut(it.ph, it.time) then
                -- A later phase started first: this reminder never comes.
            elseif start then
                local p = byPhase[it.ph]
                if not p then
                    p = { ph = it.ph, rows = {}, head = { x = phaseHeading(it.ph) } }
                    byPhase[it.ph] = p
                    order[#order + 1] = p
                end
                local icon = it.icon and ("|T" .. tostring(it.icon) .. ":0|t ") or ""
                p.rows[#p.rows + 1] = { it = it, due = start + it.time, index = index, x = "  " .. icon .. tostring(it.text or TEXT.reminder) }
            elseif not Alerts:Skipped(it.ph) and not byPhase[it.ph] then
                local p = { ph = it.ph, wait = { x = "|cff777777" .. format(TEXT.waiting, tostring(it.ph)) .. "|r" } }
                byPhase[it.ph] = p
                order[#order + 1] = p
            end
        end
    end
    table.sort(order, function(a, b)
        return a.ph < b.ph
    end)
    for _, p in ipairs(order) do
        if p.rows then
            table.sort(p.rows, function(a, b)
                if a.due ~= b.due then
                    return a.due < b.due
                end
                return a.it.id < b.it.id
            end)
        end
    end
    return { run = true, head = head, order = order, lines = {} }
end

-- The run's lines now: the boss heading, then by phase the rows not passed (with "Hide lines once passed")
-- and the phases waiting for Next phase; the next row to come is marked. Nil when nothing is left.
local function runTick(m)
    local Alerts = CRT.Alerts
    local now = Alerts.Now and Alerts:Now() or GetTime()
    local hidePassed = Notes:WindowSettings("window").hidePassed
    local nextRow
    for _, p in ipairs(m.order) do
        for _, r in ipairs(p.rows or EMPTY) do
            local remaining = r.due - now
            r.remaining = remaining
            r.visible = not (hidePassed and remaining < -(r.it.hold or 0))
            -- the first of the run's items wins a tie, as the run lists them
            if r.visible and remaining >= 0 and (not nextRow or remaining < nextRow.remaining
                or (remaining == nextRow.remaining and r.index < nextRow.index)) then
                nextRow = r
            end
        end
    end
    local lines, n = m.lines, 1
    lines[1] = m.head
    for _, p in ipairs(m.order) do
        if p.rows then
            local headed = false
            for _, r in ipairs(p.rows) do
                if r.visible then
                    if not headed then
                        n = n + 1
                        lines[n] = p.head
                        headed = true
                    end
                    local second = r.remaining > 0 and math.floor(r.remaining) or 0
                    local isNext = r == nextRow
                    if r.sec ~= second or r.isNext ~= isNext then
                        r.sec, r.isNext = second, isNext
                        r.t = isNext and gold("> " .. fmtTime(second)) or ("|cffaaaaaa" .. fmtTime(second) .. "|r")
                    end
                    n = n + 1
                    lines[n] = r
                end
            end
        else
            n = n + 1
            lines[n] = p.wait
        end
    end
    for i = #lines, n + 1, -1 do
        lines[i] = nil
    end
    if n == 1 then
        return nil
    end
    return lines
end

-- The reminders block as kept: { run = true, ... } for a run (runModel), { lines } out of one, or nil when
-- there is no current boss or it has none.
local plannedCache = {}
local function remindersBlock()
    local R = CRT.AlertReminders
    if not R then
        return nil
    end
    local encounterID, run, record = currentBoss()
    if not encounterID then
        return nil
    end
    local list = R:List(encounterID)
    if #list == 0 then
        return nil
    end
    local head = gold(bossName(encounterID, list, record))
    if run then
        return runModel({ x = head })
    end
    local lines = plannedLines(encounterID, list, record)
    if #lines == 0 then
        return nil
    end
    table.insert(lines, 1, head)
    return { lines = textLines(plannedCache, table.concat(lines, "\n")) }
end

-- Whether the personal window counts down: the current boss comes from a run and has a reminder of
-- yours. Anything else (no reminders, the note's boss) uses the normal refresh. Asked every refresh, so the
-- answer is kept until the content or the run changes.
local live = {}
local function personalLive()
    local R, A = CRT.AlertReminders, CRT.Alerts
    if not (R and A and A.running) then
        return false
    end
    if live.version == contentVersion and live.alerts == A.version then
        return live.value
    end
    local value = false
    local ok, encounterID, run = pcall(currentBoss)
    if ok and encounterID and run then
        local listed, list = pcall(R.List, R, encounterID)
        value = listed and type(list) == "table" and #list > 0
    end
    live.version, live.alerts, live.value = contentVersion, A.version, value
    return value
end

-- Your personal note as typed. A raid note pasted in (an "EncounterID:…;Name:…" header, timed
-- "time:…;ph:…" lines, the timed-line format of shared raid notes) shows as a heading with the boss's name
-- and difficulty and its timed lines by phase, "0:34 [icon] Spell" (marked ">" when they name you), then
-- its other lines. Free text gets the markdown above. The personal note never runs alerts.
local function personalNoteBlock(text)
    local Parser = CRT.NoteParser
    local note = Parser and Parser.Parse(text or "")
    if not note or (not note.encounterID and not note.name and #note.timers == 0) then
        local out = {}
        for _, line in ipairs(splitLines(text)) do
            out[#out + 1] = personalLine(line)
        end
        return table.concat(out, "\n")
    end
    local out = {}
    if note.name or note.difficulty then
        out[#out + 1] = gold(note.name or "")
            .. (note.difficulty and ("|cffaaaaaa (" .. note.difficulty .. ")|r") or "")
    end
    local timers = {}
    for _, t in ipairs(note.timers) do
        timers[#timers + 1] = t
    end
    table.sort(timers, function(a, b)
        if (a.ph or 1) ~= (b.ph or 1) then
            return (a.ph or 1) < (b.ph or 1)
        end
        return (a.time or 0) < (b.time or 0)
    end)
    local shownPh
    local multi = timers[1] and timers[#timers] and (timers[1].ph or 1) ~= (timers[#timers].ph or 1)
    for _, t in ipairs(timers) do
        if multi and t.ph ~= shownPh then
            shownPh = t.ph
            out[#out + 1] = gold("Phase " .. tostring(t.ph or 1))
        end
        out[#out + 1] = timerLine(t, t.time or 0)
    end
    local lines = {}
    for _, line in ipairs(note.lines or {}) do
        lines[#lines + 1] = personalLine(line)
    end
    while #lines > 0 and lines[#lines] == "" do
        lines[#lines] = nil
    end
    if #lines > 0 then
        out[#out + 1] = ""
        for _, l in ipairs(lines) do
            out[#out + 1] = l
        end
    end
    return table.concat(out, "\n")
end
NoteWindow.PersonalNoteBlock = personalNoteBlock

-- The personal window's kept state: what was typed and its lines, the reminders block, and the lines shown.
local personal = { typedCache = {}, sample = {}, lines = {} }
local BLANK = { x = "" }

local function failed(err)
    -- a failure must never take the free text with it
    if geterrorhandler then
        geterrorhandler()(err)
    end
end

-- force: rebuild the kept text even when nothing seems to have changed (a refresh out of a run).
local function personalBuild(_, force)
    local k, A = personal, CRT.Alerts
    local typed = Notes:Personal()
    if force or k.typed ~= typed or k.version ~= contentVersion or k.alerts ~= (A and A.version) or k.classes ~= classVersion() then
        k.typed, k.version, k.alerts, k.classes = typed, contentVersion, A and A.version, classVersion()
        k.typedLines = #splitLines(typed) > 0 and textLines(k.typedCache, personalNoteBlock(typed)) or nil
        local ok, block = pcall(remindersBlock)
        if not ok then
            failed(block)
            block = nil
        end
        k.block = block
        k.first = Notes:PersonalFirst()
    end
    local reminders = k.block and k.block.lines
    if k.block and k.block.run then
        local ok, lines = pcall(runTick, k.block)
        if not ok then
            failed(lines)
            k.block, lines = nil, nil
        end
        reminders = lines
    end
    -- your reminders, then what you typed; "Display my notes first" (notes.personalFirst) swaps them
    local first, second = reminders, k.typedLines
    if k.first then
        first, second = k.typedLines, reminders
    end
    local out, n = k.lines, 0
    for _, line in ipairs(first or EMPTY) do
        n = n + 1
        out[n] = line
    end
    if first and second then
        n = n + 1
        out[n] = BLANK
    end
    for _, line in ipairs(second or EMPTY) do
        n = n + 1
        out[n] = line
    end
    for i = #out, n + 1, -1 do
        out[i] = nil
    end
    if n > 0 then
        return out, "Personal note", true
    end
    if previewOn then
        return textLines(k.sample, "Your personal note shows here.\nWrite it on the Raid Notes page."), "Personal note (sample)", true
    end
    return NO_LINES, "Personal note", false
end

-- One window --------------------------------------------------------------------------------

-- A note window's font: the one picked for it (from CRT:FontList), or the game's own for "default"
-- or a shared font that is no longer loaded.
local function fontPath(name)
    return CRT:FontPath(name) or (GameFontHighlight:GetFont())
end

-- The rows ------------------------------------------------------------------------------------
-- A window draws its lines as rows of two font strings each: a time cell (the countdown, when the line
-- has one) and the text cell after it. A row stays with its line while the line is shown, so a new second
-- sets only that row's time cell, and a line that goes (passed, or a phase cut) only moves the rows under
-- it. Rows are made as needed and kept for reuse. Each row sits under the one before (a blank line leaves
-- one line of space), and rows that do not fit in the window are hidden, as the window always cut its text.
local TIME_PAD = 2   -- spare width in a time cell, so a digit a little wider fits without moving its text
local TIME_SLACK = 6 -- how much narrower a time may get before its text moves left to follow it

local function newRow(w)
    local time = w.frame:CreateFontString(nil, "OVERLAY")
    time:SetFontObject(w.font)
    time:SetJustifyH("LEFT")
    time:SetJustifyV("TOP")
    time:SetWordWrap(false)
    time:SetShadowOffset(1, -1)
    local text = w.frame:CreateFontString(nil, "OVERLAY")
    text:SetFontObject(w.font)
    text:SetJustifyH("LEFT")
    text:SetJustifyV("TOP")
    text:SetWordWrap(true)
    text:SetShadowOffset(1, -1)
    return { time = time, text = text, gap = 0, cellW = 0 }
end

-- Places every row under the one before, sizes the cells to the window and hides the rows that don't fit.
local function layoutRows(w)
    local frame, order = w.frame, w.order
    local width = math.max(1, (frame:GetWidth() or 0) - 16)
    local height = (frame:GetHeight() or 0) - 36
    local lineH = w.lineH or 14
    local used, fits, prev = 0, true, nil
    for _, row in ipairs(order) do
        local timed = row.line.t ~= nil
        local to, at, x, y = frame, "TOPLEFT", 8, -28 - row.gap * lineH
        if prev then
            to, at, x, y = prev.text, "BOTTOMLEFT", -prev.cellW, -row.gap * lineH
        end
        -- each row is placed only on rows placed before it, so no anchor ever loops
        local text, time = row.text, row.time
        text:ClearAllPoints()
        time:ClearAllPoints()
        if timed then
            row.cellW = math.ceil(time:GetUnboundedStringWidth() or 0) + TIME_PAD
            time:SetPoint("TOPLEFT", to, at, x, y)
            time:SetWidth(row.cellW)
            text:SetPoint("TOPLEFT", time, "TOPRIGHT", 0, 0)
            text:SetWidth(math.max(1, width - row.cellW))
        else
            row.cellW = 0
            text:SetPoint("TOPLEFT", to, at, x, y)
            text:SetWidth(width)
        end
        used = used + row.gap * lineH + math.max(lineH, text:GetStringHeight() or 0)
        fits = fits and used <= height + 0.5
        text:SetShown(fits)
        time:SetShown(fits and timed)
        prev = row
    end
end

-- Draws lines: each row's cells get new text only when theirs changed, and the rows are placed again only
-- when a row came, went or moved, a text changed, a time no longer fits its cell, or the window changed.
local function drawLines(w, lines)
    local bound, order, free, mark = w.bound, w.order, w.free, w.mark
    local pass = w.pass + 1
    w.pass = pass
    for i = 1, #lines do
        lines[i][mark] = pass
    end
    local relayout = w.layoutDirty
    -- rows whose line is gone, kept for reuse (pushed last first, so they come back in order)
    for i = #order, 1, -1 do
        local row = order[i]
        if row.line[mark] ~= pass then
            bound[row.line] = nil
            row.line = nil
            row.time:Hide()
            row.text:Hide()
            free[#free + 1] = row
            relayout = true
        end
    end
    local n, gap = 0, 0
    for i = 1, #lines do
        local line = lines[i]
        if line.t == nil and line.x == "" then
            gap = gap + 1
        else
            local row = bound[line]
            if not row then
                row = table.remove(free) or newRow(w)
                bound[line] = row
                row.line = line
            end
            n = n + 1
            if order[n] ~= row then
                order[n] = row
                relayout = true
            end
            if row.gap ~= gap then
                row.gap = gap
                relayout = true
            end
            gap = 0
            if row.x ~= line.x then
                row.x = line.x
                row.text:SetText(line.x)
                relayout = true
            end
            if row.t ~= line.t then
                row.t = line.t
                if line.t == nil then
                    relayout = true
                else
                    row.time:SetText(line.t)
                    if not relayout then
                        local need = (row.time:GetUnboundedStringWidth() or 0) + TIME_PAD
                        relayout = need > row.cellW or need < row.cellW - TIME_SLACK
                    end
                end
            end
        end
    end
    for i = #order, n + 1, -1 do
        order[i] = nil
        relayout = true
    end
    if relayout then
        layoutRows(w)
    end
    w.layoutDirty = false
end

local function createWindow(key, defaultPosition, build)
    -- bound: line -> its row; order: the rows shown, top first; free: rows kept for reuse; mark: the key
    -- each drawn line carries this window's draw count under
    local w = { key = key, bound = {}, order = {}, free = {}, pass = 0, mark = "drawn_" .. key, lines = NO_LINES }
    local function s()
        return Notes:WindowSettings(key)
    end

    local frame = CreateFrame("Frame", "CowfeeRaidToolsNote_" .. key, UIParent, "BackdropTemplate")
    CRT.UI:RegisterLayer("notes", frame)
    frame:SetClampedToScreen(true)
    frame:SetMovable(true)
    frame:SetResizable(true)
    if frame.SetResizeBounds then
        frame:SetResizeBounds(160, 60, 1400, 1100)
    end
    if frame.SetDontSavePosition then
        pcall(frame.SetDontSavePosition, frame, true)
    end
    frame:SetBackdrop(BACKDROP)
    frame:RegisterForDrag("LeftButton")
    w.frame = frame

    -- The "note updated" stamp: an accent layer over the whole window, under the text, that appears at
    -- FLASH_ALPHA, holds for a moment and fades away to the window's own background, whatever its color
    -- or transparency. NoteWindow:Flash() plays it when a shared note arrives or is sent.
    -- on ARTWORK: above the backdrop's own background, whatever layer it uses, and under the text
    local flash = frame:CreateTexture(nil, "ARTWORK")
    flash:SetAllPoints()
    CRT.UI.Tint(flash, "SetColorTexture", "accent", FLASH_ALPHA)
    flash:SetAlpha(0)
    local stamp = flash:CreateAnimationGroup()
    local fade = stamp:CreateAnimation("Alpha")
    fade:SetFromAlpha(1)
    fade:SetToAlpha(0)
    fade:SetStartDelay(FLASH_HOLD)
    fade:SetDuration(FLASH_FADE)
    fade:SetSmoothing("IN")
    stamp:SetScript("OnPlay", function()
        flash:SetAlpha(1)
    end)
    stamp:SetScript("OnFinished", function()
        flash:SetAlpha(0)
        -- redraw: a window kept up only for the stamp of a cleared note hides again
        changed()
    end)
    w.stamp, w.stampTexture = stamp, flash

    local font = CreateFont("CRTNoteFont_" .. key)
    font:CopyFontObject(GameFontHighlight)

    local title = frame:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    title:SetPoint("TOPLEFT", 8, -6)
    title:SetPoint("TOPRIGHT", -8, -6)
    title:SetJustifyH("LEFT")
    title:SetWordWrap(false)

    -- the lines' rows (drawLines) use this window's font, and are placed again when the window's size
    -- changes (hooked: BackdropTemplate sizes its edge in its own OnSizeChanged)
    w.font = font
    frame:HookScript("OnSizeChanged", function()
        w.layoutDirty = true
    end)

    local hint = frame:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    hint:SetPoint("BOTTOMLEFT", 8, 6)
    hint:SetText("Unlocked: drag to move, drag the corner to resize")

    local reset = CRT.UI.ResetButton(frame, function()
        w:ResetPosition()
    end)
    reset:SetPoint("TOPRIGHT", -4, -4)

    local grip = CreateFrame("Button", nil, frame)
    grip:SetSize(16, 16)
    grip:SetPoint("BOTTOMRIGHT", -2, 2)
    grip:SetNormalTexture(GRIP .. "-Up")
    grip:SetHighlightTexture(GRIP .. "-Highlight")
    grip:SetPushedTexture(GRIP .. "-Down")

    local function save()
        local point, _, relativePoint, x, y = frame:GetPoint()
        local settings = s()
        settings.position = { point = point, relativePoint = relativePoint, x = x, y = y }
        settings.width = math.floor(frame:GetWidth() + 0.5)
        settings.height = math.floor(frame:GetHeight() + 0.5)
    end

    local function unlocked()
        return previewOn or not s().locked
    end

    frame:SetScript("OnDragStart", function()
        if unlocked() then
            frame:StartMoving(true)
        end
    end)
    frame:SetScript("OnDragStop", function()
        frame:StopMovingOrSizing()
        save()
    end)
    grip:SetScript("OnMouseDown", function()
        if unlocked() then
            frame:StartSizing("BOTTOMRIGHT")
        end
    end)
    grip:SetScript("OnMouseUp", function()
        frame:StopMovingOrSizing()
        save()
        w.layoutDirty = true
    end)

    function w:ApplyPosition()
        local p = s().position or defaultPosition
        frame:ClearAllPoints()
        frame:SetPoint(p.point, UIParent, p.relativePoint or p.point, p.x, p.y)
    end

    function w:ApplyStyle()
        local settings = s()
        font:SetFont(fontPath(settings.font), settings.fontSize or 14, CRT.db.ui.outline or "")
        frame:SetSize(settings.width or 360, settings.height or 240)
        frame:SetAlpha((settings.alpha or 100) / 100)
        local bg = (settings.bgAlpha or 50) / 100
        frame:SetBackdropColor(0, 0, 0, bg)
        local open = unlocked()
        -- unlocked, an edge in the theme's good colour shows where to drag; locked, no edge at all, so the
        -- window is seamless
        if open then
            frame:SetBackdropBorderColor(CRT.UI.Color("good"))
        else
            frame:SetBackdropBorderColor(0, 0, 0, 0)
        end
        -- Locked windows let clicks through to the game.
        frame:EnableMouse(open)
        grip:SetShown(open)
        hint:SetShown(open)
        reset:SetShown(open)
        self.lineH = settings.fontSize or 14
        self.layoutDirty = true
    end

    function w:Refresh()
        -- the timers window counts down while a note runs, the personal window while a run of a boss
        -- you have reminders for goes
        local live = (key == "window" and Engine.running) or (key == "personal" and personalLive()) or false
        local classes = classVersion()
        if not live and not self.wasLive and self.drawnVersion == contentVersion and self.drawnClasses == classes
            and GetTime() - (self.drawnAt or 0) < SAFETY_SECONDS then
            -- nothing to rebuild; a resize or a new font still places the rows again
            if self.layoutDirty and frame:IsShown() then
                drawLines(self, self.lines)
            end
            return
        end
        self.wasLive = live
        self.drawnVersion = contentVersion
        self.drawnClasses = classes
        self.drawnAt = GetTime()
        -- out of a run, every refresh that gets here rebuilds; during one, the kept text is reused
        local lines, heading, hasContent = build(self, not live)
        -- a stamp waits for this draw, so a window the new note just made visible shows it too; and a
        -- note with nothing for this window (an empty note, or a boss with no timers or text) keeps it
        -- up, blank, at least for the stamp
        local stampNow = self.flashPending
        self.flashPending = nil
        local stamping = stampNow or self.stamp:IsPlaying()
        -- Keep up when empty: a window with nothing to show stays up, blank at its own transparency
        local visible = previewOn or (NoteWindow.AllowedHere() and s().shown and (hasContent or stamping or s().keepEmpty))
        frame:SetShown(visible and true or false)
        if not visible then
            return
        end
        if not hasContent and not previewOn then
            lines, heading = NO_LINES, ""
        end
        if stampNow then
            self.stamp:Stop()
            self.stamp:Play()
        end
        if heading ~= self.heading then
            self.heading = heading
            title:SetText(heading)
        end
        self.lines = lines
        drawLines(self, lines)
    end

    -- The text the window shows, as one string: each line's time and text, lines joined by line breaks.
    function w:DrawnText()
        local out = {}
        for i, line in ipairs(self.lines) do
            out[i] = (line.t or "") .. line.x
        end
        return table.concat(out, "\n")
    end

    function w:ResetPosition()
        s().position = nil
        self:ApplyPosition()
    end

    w:ApplyPosition()
    w:ApplyStyle()
    frame:Hide()
    return w
end

-- Public -------------------------------------------------------------------------------------

function NoteWindow:Get(key)
    return self.windows[key]
end

function NoteWindow:ResetPosition(key)
    local w = self.windows[key]
    if w then
        w:ResetPosition()
    end
end

-- The "note updated" stamp on the note windows (timers, assignments and personal), played on their next
-- draw.
function NoteWindow:Flash()
    for key, w in pairs(self.windows) do
        if STAMP_WINDOWS[key] then
            w.flashPending = true
        end
    end
    changed()
end

function NoteWindow:RefreshAll()
    for _, w in pairs(self.windows) do
        w:Refresh()
    end
end

local function styleAll()
    for _, w in pairs(NoteWindow.windows) do
        w:ApplyStyle()
        w:Refresh()
    end
end

local built = false
local function build()
    if built then
        return
    end
    built = true
    NoteWindow.windows.window = createWindow("window", { point = "LEFT", relativePoint = "LEFT", x = 40, y = 120 }, timersBuild)
    NoteWindow.windows.assignments = createWindow("assignments", { point = "LEFT", relativePoint = "LEFT", x = 40, y = -170 }, assignmentsBuild)
    NoteWindow.windows.personal = createWindow("personal", { point = "RIGHT", relativePoint = "RIGHT", x = -60, y = -60 }, personalBuild)
end

-- One updater for all three. Timers need a quick refresh, and the others are cheap.
local driver = CreateFrame("Frame")
local elapsed = 0
driver:SetScript("OnUpdate", function(_, dt)
    if not built then
        return
    end
    elapsed = elapsed + dt
    if elapsed < REFRESH_SECONDS then
        return
    end
    elapsed = 0
    NoteWindow:RefreshAll()
end)
driver:RegisterEvent("PLAYER_LOGIN")
driver:RegisterEvent("GROUP_ROSTER_UPDATE")
driver:RegisterEvent("PLAYER_SPECIALIZATION_CHANGED")
driver:RegisterEvent("PLAYER_ROLES_ASSIGNED")
driver:RegisterEvent("PLAYER_ENTERING_WORLD")
driver:RegisterEvent("ZONE_CHANGED_NEW_AREA")
-- Your role, spec or group changed: the words that match you are read again now, not a few seconds later.
local TOKEN_EVENTS = { GROUP_ROSTER_UPDATE = true, PLAYER_SPECIALIZATION_CHANGED = true, PLAYER_ROLES_ASSIGNED = true }
driver:SetScript("OnEvent", function(_, event)
    if TOKEN_EVENTS[event] and Engine.ResetTokens then
        Engine:ResetTokens()
    end
    changed()
    if event == "PLAYER_LOGIN" then
        build()
        styleAll()
    elseif built and (event == "PLAYER_ENTERING_WORLD" or event == "ZONE_CHANGED_NEW_AREA") then
        -- the window rule follows the instance you are in
        NoteWindow:RefreshAll()
    end
end)

Notes:OnChange(function()
    changed()
    if built then
        styleAll()
    end
end)

-- Your reminders (saved, deleted, turned off) and runs starting, stopping or changing phase: the alerts
-- engine tells its listeners. The personal window shows the reminders.
if CRT.Alerts then
    CRT.Alerts:OnChange(changed)
end

-- A theme switch redraws the windows, so their headings, your lines and the unlocked edge follow it.
CRT.UI:OnTheme(function()
    changed()
    if built then
        styleAll()
    end
end)

CRT.UI:RegisterPreview("note", function(on)
    build()
    previewOn = on and true or false
    changed()
    styleAll()
end)
