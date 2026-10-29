local ADDON, CRT = ...

-- Stored raid notes and their settings, in CRTDB.notes (per player):
--   list[id] = { raw, name, encounterID, difficulty, updated, updatedBy, from, sharedAt, presetId, personal,
--                source, via }: updated and updatedBy the last change and who made it, from and sharedAt who
--                shared it to you and when
-- A note is shared or, with personal = true, your own.
--   Shared: the raid's notes. One from someone in your own guild is kept as your guild's note (source
--   "guild:<name>"): the next share from anyone in your guild replaces it for that boss and difficulty, so
--   several officers sharing in a night keep one note, which shows who updated it last. One from anyone
--   else (a pickup group, another guild, no guild) is an unknown source, "pug:<sender>": every share is a
--   note of its own, never replacing yours or another's, except an exact repeat from the same sender. The
--   newest share is the note in use, and the shared note in use runs on the pull (FindForEncounter).
--   `via` says how a note came: "CRT" (shared to you by this addon), "Imported" (pasted), "Timeline", or
--   another addon's short name (MRT, NSRT).
--   Personal: your own lines for a boss and difficulty, kept on this computer, never shared or replaced.
--   They run on every pull of that boss alongside the shared note in use (PersonalFor, Notes/Engine.lua's
--   "personal" block).
--   active = id of the note in use, nextId
--   window = note window settings, alert = personal alert settings, trustedOnly
--   history[id] = the note's earlier texts, newest first (see "History" below)
--   links[id] = which timer lines follow which assignment line, for the note editor (Notes/Links.lua)
-- A note's invite list becomes a Raid Groups layout when it is imported (presetId links them).

local TEXT = {
    notAdmin = "Only the raid leader or assistants can change the raid note.",
}

local Parser = CRT.NoteParser
local Notes = { listeners = {} }
CRT.Notes = Notes

local parsed = {} -- id -> { raw, note }, so a note is only parsed again when its text changes
local spells = {} -- spellId -> { name, icon }

local function ndb()
    return CRT.db.notes
end

-- Your name, for a note you change (updatedBy).
local function me()
    return UnitName and UnitName("player") or nil
end

local function isSecret(value)
    return issecretvalue and issecretvalue(value) or false
end

function Notes:OnChange(fn)
    self.listeners[#self.listeners + 1] = fn
end

function Notes:Fire()
    for _, fn in ipairs(self.listeners) do
        fn()
    end
end

-- Settings ------------------------------------------------------------------------------

function Notes:Window()
    return ndb().window
end

-- Settings for one of the three windows: "window" (timers), "assignments" or "personal".
function Notes:WindowSettings(key)
    return ndb()[key]
end

function Notes:Personal()
    return ndb().personalText or ""
end

function Notes:SetPersonal(text)
    ndb().personalText = text or ""
    self:Fire()
end

-- How the Raid Notes list shows its notes (Notes Settings): "grouped" under difficulty headings that fold,
-- "dropdown" one difficulty picked in a dropdown, or "chips" one picked with buttons. listDifficulty is the
-- difficulty the dropdown and the chips show ("All" for every note), listFolded the folded headings.
Notes.LIST_STYLES = { "grouped", "dropdown", "chips" }
Notes.DIFFICULTIES = { "Mythic", "Heroic", "Normal" } -- in this order; any other is listed as Other

function Notes:ListStyle()
    local s = ndb().listStyle
    for _, k in ipairs(Notes.LIST_STYLES) do
        if k == s then
            return s
        end
    end
    return "grouped"
end

function Notes:SetListStyle(style)
    ndb().listStyle = style
    self:Fire()
end

function Notes:ListDifficulty()
    return ndb().listDifficulty or "All"
end

function Notes:SetListDifficulty(d)
    ndb().listDifficulty = (d ~= "All") and d or nil
    self:Fire()
end

function Notes:ListFolded(group)
    return (ndb().listFolded or {})[group] and true or false
end

function Notes:SetListFolded(group, folded)
    ndb().listFolded = ndb().listFolded or {}
    ndb().listFolded[group] = folded and true or nil
    self:Fire()
end

-- A note's difficulty group: Mythic, Heroic or Normal as written (any case), else Other.
function Notes.DifficultyGroup(record)
    local d = (record and record.difficulty or ""):lower()
    for _, k in ipairs(Notes.DIFFICULTIES) do
        if k:lower() == d then
            return k
        end
    end
    return "Other"
end

-- Display my notes first: the personal window shows what you typed above your reminders.
function Notes:PersonalFirst()
    return ndb().personalFirst and true or false
end

function Notes:SetPersonalFirst(on)
    ndb().personalFirst = on and true or nil
    self:Fire()
end

function Notes:Alert()
    return ndb().alert
end

-- Whether the note windows show outside a raid instance (Notes Settings). Off unless ticked.
function Notes:ShowOutsideRaid()
    return ndb().showOutsideRaid == true
end

function Notes:TrustedOnly()
    return ndb().trustedOnly
end

-- Who may change the raid note ------------------------------------------------------------------

-- A yes/no the game reports (IsInRaid, UnitIsGroupLeader): true or false, or nil when it can't be read
-- (missing, an error, or a secret value).
local function groupFlag(fn, ...)
    if type(fn) ~= "function" then
        return nil
    end
    local ok, value = pcall(fn, ...)
    if not ok or isSecret(value) then
        return nil
    end
    return value and true or false
end

-- Whether you may change the raid note (the lines on the Timeline and in the editor): in a raid, the
-- leader or an assistant, the same check Comm:CanShare makes; in a party, the leader; on your own,
-- always. A group state that can't be read counts as no. Returns ok, and the reason when not.
function Notes:CanEditRaid()
    local raid = groupFlag(IsInRaid)
    if raid == nil then
        return false, TEXT.notAdmin
    end
    if raid then
        if groupFlag(UnitIsGroupLeader, "player") or groupFlag(UnitIsGroupAssistant, "player") then
            return true
        end
        return false, TEXT.notAdmin
    end
    local party = groupFlag(IsInGroup)
    if party == nil then
        return false, TEXT.notAdmin
    end
    if not party or groupFlag(UnitIsGroupLeader, "player") then
        return true
    end
    return false, TEXT.notAdmin
end

function Notes:Set(section, key, value)
    local target = section and ndb()[section] or ndb()
    target[key] = value
    self:Fire()
end

-- Spells: name and icon, cached out of combat so the note never reads them during a fight. -------

function Notes:SpellInfo(spellId)
    if not spellId then
        return nil
    end
    local cached = spells[spellId]
    if cached then
        return cached
    end
    local name, icon
    if C_Spell and C_Spell.GetSpellInfo then
        local ok, info = pcall(C_Spell.GetSpellInfo, spellId)
        if ok and type(info) == "table" then
            name, icon = info.name, info.iconID
        end
    end
    if isSecret(name) or isSecret(icon) then
        return nil
    end
    if name then
        spells[spellId] = { name = name, icon = icon }
        return spells[spellId]
    end
    return nil
end

local function cacheSpells(note)
    for _, item in ipairs(note.timers) do
        if item.spellId then
            Notes:SpellInfo(item.spellId)
        end
    end
end

-- History -------------------------------------------------------------------------------------
-- Each stored note keeps its last HISTORY_MAX earlier texts in CRTDB.notes.history[id], newest first:
--   { text, at = time(), how, who, from, lines }
-- An entry is the text as it was just before a change, and that change: when (at), how and who.
--   how: "edited" (Save text changes, the pop-out editor's Save, or lines changed on the Timeline or in the
--        alert editor, which set lines = true), "imported", "received" (who = the sender) or "restored"
--        (from = the `at` of the version put back).
-- Recorded in one place, store() below, which every write of a note's text goes through (and Notes:RememberRaw,
-- for the Timeline's undo, which writes whole records). A change that
-- leaves the text as it was adds nothing. Line changes in a row by the same player within LINE_BURST
-- seconds keep one entry, the text before the first, so a few Timeline drags don't push out the saves.
-- All notes' history together holds at most HISTORY_BYTES of text: over that, the note whose history holds
-- the most text loses its oldest entry, again until it fits (so a short note's history is not emptied for a
-- long one's). History stays on this computer: never shared to the raid, never
-- in a profile export (CRT_Core/Profiles.lua).

local HISTORY_MAX = 5
local HISTORY_BYTES = 256 * 1024
local LINE_BURST = 300
Notes.HISTORY_MAX, Notes.HISTORY_BYTES = HISTORY_MAX, HISTORY_BYTES

local function now()
    return time and time() or 0
end

local function historyDb()
    local db = ndb()
    db.history = db.history or {}
    return db.history
end

-- Drops the oldest entries until the whole history fits HISTORY_BYTES, and the history of notes that are gone.
local function trimHistory()
    local all, list = historyDb(), ndb().list
    local total = 0
    for id, entries in pairs(all) do
        if not list[id] or #entries == 0 then
            all[id] = nil
        else
            for _, e in ipairs(entries) do
                total = total + #(e.text or "")
            end
        end
    end
    while total > HISTORY_BYTES do
        local worst, most, bytes
        for id, entries in pairs(all) do
            local size = 0
            for _, e in ipairs(entries) do
                size = size + #(e.text or "")
            end
            if not worst or size > bytes or (size == bytes and #entries > most) then
                worst, most, bytes = id, #entries, size
            end
        end
        if not worst then
            return
        end
        local dropped = table.remove(all[worst])
        total = total - #(dropped and dropped.text or "")
        if #all[worst] == 0 then
            all[worst] = nil
        end
    end
end

-- Keeps `old` (the note's text before a change) as its newest earlier version. extra: who, from, lines.
local function remember(id, old, how, extra)
    local entries = historyDb()[id] or {}
    local who = extra and extra.who or me()
    local last = entries[1]
    if extra and extra.lines and last and last.lines and last.who == who and now() - (last.at or 0) < LINE_BURST then
        return -- the same run of line changes: the text before its first is kept already
    end
    table.insert(entries, 1, { text = old, at = now(), how = how, who = who, from = extra and extra.from,
        lines = extra and extra.lines or nil })
    while #entries > HISTORY_MAX do
        table.remove(entries)
    end
    historyDb()[id] = entries
    trimHistory()
end

-- The one place a stored note's text changes: the text before is kept in its history (when it differs),
-- then the new text is set. how and extra as for remember.
local function store(record, id, text, how, extra)
    if record.raw ~= nil and record.raw ~= text then
        remember(id, record.raw, how, extra)
    end
    record.raw = text
end

-- For a writer that replaces a note's whole record (the Timeline's Ctrl+Z and Ctrl+Y, Timeline/Undo.lua): keeps
-- the note's text now in its history when `text` (what is about to be written) differs. how and extra as for
-- remember.
function Notes:RememberRaw(id, text, how, extra)
    local record = self:Get(id)
    if record and type(record.raw) == "string" and type(text) == "string" and record.raw ~= text then
        remember(id, record.raw, how or "edited", extra)
    end
end

-- A note's earlier versions, newest first (the saved entries: read them, don't change them).
function Notes:History(id)
    return id and ndb().history and ndb().history[id] or {}
end

function Notes:HistoryCount(id)
    return #self:History(id)
end

-- Puts a note's earlier version back as its text: the text now is kept first, as a "restored" entry, so
-- restoring that entry undoes it. Only your copy changes; nothing is shared. Returns true when done.
function Notes:Restore(id, index)
    local record = self:Get(id)
    local entry = self:History(id)[index]
    if not (record and entry and type(entry.text) == "string") then
        return false
    end
    if entry.text == record.raw then
        return true
    end
    return self:UpdateRaw(id, entry.text, "restored", { from = entry.at })
end

-- Notes -----------------------------------------------------------------------------------

function Notes:Get(id)
    return id and ndb().list[id]
end

function Notes:Parsed(id)
    local record = self:Get(id)
    if not record then
        return nil
    end
    local entry = parsed[id]
    if not entry or entry.raw ~= record.raw then
        entry = { raw = record.raw, note = Parser.Parse(record.raw) }
        parsed[id] = entry
        if not InCombatLockdown() then
            cacheSpells(entry.note)
        end
    end
    return entry.note
end

-- The id of the note a parsed note (from Parsed) was read from, or nil (the alerts' note block asks it).
function Notes:IdOf(note)
    for id, entry in pairs(parsed) do
        if entry.note == note then
            return id
        end
    end
    return nil
end

local DIFFICULTY_RANK = { mythic = 1, heroic = 2, normal = 3 }

-- Your guild's name, read now (so a guild renamed or changed shows at once); nil out of a guild.
local function myGuild()
    return IsInGuild and IsInGuild() and GetGuildInfo and GetGuildInfo("player") or nil
end

-- A shared note you put out becomes your guild's (labelled "- <your guild>", so your guildies' later
-- shares update it instead of adding another): on a share, `shared` true, also marked as shared by you
-- through this addon; on a save, only a note that has no source yet (your own) is claimed, never someone
-- else's. Personal notes are never claimed. Out of a guild a share is still marked as yours.
function Notes:ClaimForGuild(id, shared)
    local record = self:Get(id)
    if not record or record.personal then
        return
    end
    if not shared and record.source then
        return
    end
    local guild = myGuild()
    if guild then
        record.source = "guild:" .. guild
    end
    if shared then
        record.from = me()
        record.sharedAt = date("%Y-%m-%d %H:%M")
        record.via = "CRT"
    end
end

-- A player's name without the realm: "Rixxy" for "Rixxy-TwistingNether".
function Notes.ShortName(name)
    return name and (name:match("^([^%-]+)") or name) or nil
end

-- How a note came, short: CRT, MRT, NSRT, Imported or Timeline (older notes kept the long name).
local VIA_SHORT = { ["Cowfee Raid Tools"] = "CRT", ["Method Raid Tools"] = "MRT", ["Northern Sky"] = "NSRT",
    ["Northern Sky Raid Tools"] = "NSRT" }
function Notes.ViaLabel(via)
    return via and (VIA_SHORT[via] or via) or nil
end

-- Whose a shared note is, for its label: your guild's name, else its sender without the realm.
function Notes.SourceLabel(record)
    local src = record and record.source
    local guild = type(src) == "string" and src:match("^guild:(.+)$")
    if guild then
        return guild
    end
    local from = record and record.from
    return from and (from:match("^([^%-]+)") or from) or nil
end

-- kind: "shared" or "personal" lists only those, nil every note.
-- All notes, in the raid route (CRT.Bosses:RouteIndex of the EncounterID in each note's header), the
-- same order as every boss list; a boss's notes Mythic, Heroic, Normal, then any other difficulty.
-- Notes for a boss the route doesn't list, or with no EncounterID, come last, by name: { id, record }.
function Notes:List(kind)
    local out = {}
    local Bosses = CRT.Bosses
    for id, record in pairs(ndb().list) do
        if kind == nil or (kind == "personal") == (record.personal == true) then
        local route = record.encounterID and Bosses and Bosses:RouteIndex(record.encounterID)
        out[#out + 1] = {
            id = id,
            record = record,
            route = route or math.huge,
            rank = DIFFICULTY_RANK[(record.difficulty or ""):lower()] or 4,
            name = (record.name or ""):lower(),
        }
        end
    end
    table.sort(out, function(a, b)
        if a.route ~= b.route then
            return a.route < b.route
        end
        -- outside the route, the name keeps one boss's notes together
        if a.route == math.huge and a.name ~= b.name then
            return a.name < b.name
        end
        if a.rank ~= b.rank then
            return a.rank < b.rank
        end
        if a.name ~= b.name then
            return a.name < b.name
        end
        return a.id < b.id
    end)
    return out
end

function Notes:Active()
    local id = ndb().active
    if id and ndb().list[id] then
        return id, ndb().list[id], self:Parsed(id)
    end
    return nil
end

function Notes:SetActive(id)
    ndb().active = id
    self:Fire()
end

local function sameDifficulty(record, difficultyName)
    return not (difficultyName and record.difficulty) or record.difficulty:lower() == difficultyName:lower()
end

-- The shared note a pull of a boss runs (and the Timeline adds lines to): the active note when it is a
-- shared note for this boss and difficulty; else that boss's shared note of that difficulty, then of any,
-- the newest when there are several (one per guild). Never a personal note.
function Notes:FindForEncounter(encounterID, difficultyName)
    local activeId = ndb().active
    local active = activeId and ndb().list[activeId]
    if active and not active.personal and active.encounterID == encounterID and sameDifficulty(active, difficultyName) then
        return activeId
    end
    local exact, any
    local function newer(id, best)
        return not best or (ndb().list[id].updated or "") > (ndb().list[best].updated or "")
    end
    for id, record in pairs(ndb().list) do
        if record.encounterID == encounterID and not record.personal then
            if difficultyName and record.difficulty and record.difficulty:lower() == difficultyName:lower() then
                if newer(id, exact) then
                    exact = id
                end
            elseif newer(id, any) then
                any = id
            end
        end
    end
    return exact or any
end

-- Your personal note for a boss: the one of that difficulty, else one with no difficulty. Nil when none.
function Notes:PersonalFor(encounterID, difficultyName)
    local loose
    for id, record in pairs(ndb().list) do
        if record.personal and record.encounterID == encounterID then
            if difficultyName and record.difficulty and record.difficulty:lower() == difficultyName:lower() then
                return id
            elseif not record.difficulty then
                loose = loose or id
            end
        end
    end
    return loose
end

-- Your personal note for a boss and difficulty, made (a header line, for your lines under it) when there
-- is none. Returns its id and whether it was just made.
function Notes:MakePersonal(encounterID, difficultyName, bossName)
    if type(encounterID) ~= "number" then
        return nil
    end
    for id, record in pairs(ndb().list) do
        if record.personal and record.encounterID == encounterID and (record.difficulty or "") == (difficultyName or "") then
            return id, false
        end
    end
    local header = "EncounterID:" .. encounterID .. (difficultyName and (";Difficulty:" .. difficultyName) or "")
        .. (bossName and (";Name:" .. bossName) or "")
    local id = self:Import(header .. "\n", nil, true)
    return id, id ~= nil
end

-- Builds a Raid Groups layout from the invite list, in order, keeping empty slots.
local function rosterFromInvite(note, title)
    local Groups = CRT.Groups
    if not (Groups and note.invite) then
        return nil
    end
    local slots, any = {}, false
    for i = 1, Groups.NUM_SLOTS do
        local name = note.invite[i] or ""
        slots[i] = Groups.Normalize(name)
        if slots[i] ~= "" then
            any = true
        end
    end
    if not any then
        return nil
    end
    return Groups:CreatePreset(title, slots)
end

-- Imports note text. A note for the same boss and difficulty is replaced. Returns id, message.
-- personal: the note is your own (the Personal tab's Import), replacing yours for that boss and
-- difficulty. Otherwise it is shared, replacing the shared note of the same source (a sender's guild, see
-- the top), or one from before sources were kept; never a personal note.
-- anyText: the Import/New dialog only. Text that doesn't read as a raid note is then saved as a new note
-- of its own (never replacing one) instead of refused.
function Notes:Import(text, from, personal, source, via, anyText)
    text = text or ""
    local note = Parser.Parse(text)
    local plain = not note.name and not note.encounterID and #note.timers == 0
    if plain and not anyText then
        return nil, "That doesn't look like a raid note. It needs an EncounterID line or time: lines."
    end
    local db = ndb()
    local id
    for existingId, record in pairs(plain and {} or db.list) do
        local sameBoss = note.encounterID and record.encounterID == note.encounterID
        local sameDifficulty = (record.difficulty or "") == (note.difficulty or "")
        local sameKind = (record.personal == true) == (personal == true)
        -- your guild's note is replaced by your guild's next share (and a note from before sources were
        -- kept by the first); an unknown source's note only by its exact repeat
        local sameSource
        if personal then
            sameSource = true
        elseif type(source) == "string" and source:find("^pug:") then
            sameSource = record.source == source and record.raw == text
        else
            sameSource = record.source == source or record.source == nil
        end
        if sameBoss and sameDifficulty and sameKind and sameSource then
            id = existingId
            break
        end
    end
    if not id then
        id = db.nextId
        db.nextId = db.nextId + 1
    end
    local record = db.list[id] or {}
    -- a note shared to you is "received", from its sender; one you pasted is "imported"
    store(record, id, text, from and "received" or "imported", { who = from or me() })
    record.name = note.name or ("Note " .. id)
    if plain then
        local first = text:match("^%s*([^\r\n]+)")
        first = first and first:gsub("%s+$", ""):sub(1, 40):gsub("%s+$", "")
        record.name = (first and first ~= "") and first or ("New note " .. id)
    end
    record.encounterID = note.encounterID
    record.difficulty = note.difficulty
    record.updated = date("%Y-%m-%d %H:%M")
    record.from = from
    record.updatedBy = from or me()
    if from then
        record.sharedAt = record.updated
    end
    record.personal = personal and true or nil
    record.source = (not personal) and source or nil
    record.via = via or record.via
    db.list[id] = record

    -- The invite list becomes a Raid Groups layout the first time, which can then be adjusted there.
    local message = "Imported " .. record.name .. (record.difficulty and (" (" .. record.difficulty .. ")") or "") .. "."
    if plain then
        message = "Saved as a new note: " .. record.name .. "."
    end
    if note.invite and not (record.presetId and CRT.Groups and CRT.Groups:Find(record.presetId)) then
        local presetId = rosterFromInvite(note, record.name .. " " .. (record.difficulty or "") .. " roster")
        if presetId then
            record.presetId = presetId
            message = message .. " Its invite list is now a layout in Raid Groups."
        end
    end
    parsed[id] = nil
    self:Parsed(id)
    self:Fire()
    return id, message
end

-- Saves a note's new text, keeping the text before in its history. how: "edited" (the default) or
-- "restored"; extra as for remember (lines = true for a change of single lines, below). Returns true.
function Notes:UpdateRaw(id, text, how, extra)
    local record = self:Get(id)
    if not record then
        return
    end
    local note = Parser.Parse(text)
    store(record, id, text, how or "edited", extra)
    record.name = note.name or record.name
    record.encounterID = note.encounterID or record.encounterID
    record.difficulty = note.difficulty or record.difficulty
    record.updated = date("%Y-%m-%d %H:%M")
    record.updatedBy = me() -- your own change
    if not record.source and not record.personal and Notes.ClaimForGuild then
        Notes:ClaimForGuild(id, false) -- your own note, saved: your guild's
    end
    parsed[id] = nil
    self:Parsed(id)
    self:Fire()
    return true
end

-- Single lines ------------------------------------------------------------------------------
-- The editor reads and writes one note line at a time. Line numbers are the parser's (timer.line):
-- 1-based, counting every line, with CRLF or LF ends. Every other line is kept byte for byte.

-- The raw text as { text, eol } pieces; concatenating them gives the raw text back exactly.
local function splitLines(raw)
    local pieces, pos = {}, 1
    while true do
        local nl = raw:find("\n", pos, true)
        if not nl then
            pieces[#pieces + 1] = { text = raw:sub(pos), eol = "" }
            return pieces
        end
        local text, eol = raw:sub(pos, nl - 1), "\n"
        if text:sub(-1) == "\r" then
            text, eol = text:sub(1, -2), "\r\n"
        end
        pieces[#pieces + 1] = { text = text, eol = eol }
        pos = nl + 1
    end
end

-- Shared with the note editor (Notes/EditModel.lua), so a note is cut into lines one way.
Notes.SplitPieces = splitLines

-- A change of single lines (the Timeline, the alert editor), for the note's history (remember).
local LINE_EDIT = { lines = true }

local function joinLines(pieces)
    local out = {}
    for i, piece in ipairs(pieces) do
        out[i] = piece.text .. piece.eol
    end
    return table.concat(out)
end

local function singleLine(line)
    return type(line) == "string" and not line:find("[\r\n]")
end

-- The pieces of a note and the piece at lineNumber, or nil when the note or line isn't there or
-- `expected` (the raw line the editor loaded) no longer matches it.
local function pieceAt(id, lineNumber, expected)
    local record = Notes:Get(id)
    if not (record and record.raw and type(lineNumber) == "number") then
        return nil
    end
    local pieces = splitLines(record.raw)
    local piece = pieces[lineNumber]
    if not piece or (expected ~= nil and piece.text ~= expected) then
        return nil
    end
    return pieces, piece
end

-- A name fit to sit in the header: trimmed, no line ends or semicolons; nil when nothing is left.
local function headerWord(value)
    if value == nil then
        return nil
    end
    value = tostring(value):gsub("[\r\n;]", ""):gsub("^%s+", ""):gsub("%s+$", "")
    return value ~= "" and value or nil
end

-- The timer parsed from a line, and the raw line itself (pass it back as `expected`). Nil when that
-- line isn't a timed line.
function Notes:TimerAt(id, lineNumber)
    local note = self:Parsed(id)
    local _, piece = pieceAt(id, lineNumber)
    if not (note and piece) then
        return nil
    end
    for _, timer in ipairs(note.timers) do
        if timer.line == lineNumber then
            return timer, piece.text
        end
    end
    return nil
end

-- The first line of a new note for a boss: "EncounterID:3470;Difficulty:Mythic;Name:Nek'zali".
local function headerLine(encounterID, difficultyName, bossName)
    local header = "EncounterID:" .. tostring(encounterID)
    if difficultyName then
        header = header .. ";Difficulty:" .. difficultyName
    end
    if bossName then
        header = header .. ";Name:" .. bossName
    end
    return header
end

-- The note a pull of that difficulty reads (FindForEncounter), made when the boss has no note at
-- all: a note with only the header line, which the Raid Notes page then shows like any other.
-- Returns the note id and true when it was just made.
function Notes:NoteFor(encounterID, difficultyName, bossName)
    if type(encounterID) ~= "number" then
        return nil
    end
    difficultyName, bossName = headerWord(difficultyName), headerWord(bossName)
    local id = self:FindForEncounter(encounterID, difficultyName)
    if id then
        return id, false
    end
    local newId = self:Import(headerLine(encounterID, difficultyName, bossName) .. "\n", nil, nil, nil, "Timeline")
    return newId, newId ~= nil
end

-- Adds a line where a pull of that difficulty reads it: the note FindForEncounter gives (that
-- difficulty's note, else the boss's other note). A new note is made only when the boss has none at
-- all. Returns the note id and the line's number.
function Notes:AddLine(encounterID, difficultyName, bossName, line)
    if not singleLine(line) then
        return nil
    end
    difficultyName, bossName = headerWord(difficultyName), headerWord(bossName)
    local id = self:FindForEncounter(encounterID, difficultyName)
    if not id then
        local newId = self:Import(headerLine(encounterID, difficultyName, bossName) .. "\n" .. line, nil, nil, nil, "Timeline")
        return newId, newId and 2 or nil
    end
    return id, self:AddLineTo(id, line)
end

-- Adds a line to the end of that very note. Returns the line's number, nil when the note or line isn't fit.
function Notes:AddLineTo(id, line)
    local record = self:Get(id)
    if not (record and singleLine(line)) then
        return nil
    end
    local pieces = splitLines(record.raw or "")
    local last = pieces[#pieces]
    if last.text ~= "" then
        -- no newline after the last line yet: add one, in the note's own style
        last.eol = (pieces[1].eol == "\r\n") and "\r\n" or "\n"
        pieces[#pieces + 1] = { text = line, eol = "" }
    else
        pieces[#pieces] = { text = line, eol = "" }
    end
    self:UpdateRaw(id, joinLines(pieces), "edited", LINE_EDIT)
    return #pieces
end

-- The raw lines of a note, from one split (line n is what a timer with line = n was parsed from).
function Notes:RawLines(id)
    local record = self:Get(id)
    local out = {}
    if record and record.raw then
        for i, piece in ipairs(splitLines(record.raw)) do
            out[i] = piece.text
        end
    end
    return out
end

-- Replaces one line. `expected` is the raw line the editor loaded; if the line has changed since,
-- nothing is written and false comes back.
function Notes:ReplaceLine(id, lineNumber, line, expected)
    local pieces, piece = pieceAt(id, lineNumber, expected)
    if not (piece and singleLine(line) and self:TimerAt(id, lineNumber)) then
        return false
    end
    piece.text = line
    self:UpdateRaw(id, joinLines(pieces), "edited", LINE_EDIT)
    return true
end

-- Moves a timed line to phase ph, t seconds in, or (add) writes the same line again there at the note's end.
-- Fields the parser doesn't know stay on the line. `expected` is the raw line as it was read; false when the
-- line has changed since (nothing is written). The Timeline's flag drag and an accepted cooldown change
-- (Notes/Proposals.lua) both write through it.
function Notes:MoveLine(id, lineNumber, ph, t, expected, add)
    local timer, raw = self:TimerAt(id, lineNumber)
    if not (timer and expected ~= nil and raw == expected) then
        return false
    end
    local moved = {}
    for k, v in pairs(timer) do
        moved[k] = v
    end
    moved.ph, moved.time = ph, t
    local line = Parser.FormatLine(moved) .. Parser.UnknownFields(expected)
    if add then
        return self:AddLineTo(id, line) ~= nil
    end
    return self:ReplaceLine(id, lineNumber, line, expected)
end

-- Removes one line and its line end (a last line with no end leaves the line before it as it was).
function Notes:RemoveLine(id, lineNumber, expected)
    local pieces = pieceAt(id, lineNumber, expected)
    if not (pieces and self:TimerAt(id, lineNumber)) then
        return false
    end
    table.remove(pieces, lineNumber)
    self:UpdateRaw(id, joinLines(pieces), "edited", LINE_EDIT)
    return true
end

function Notes:Delete(id)
    local db = ndb()
    db.list[id] = nil
    if db.history then
        db.history[id] = nil
    end
    if db.links then
        db.links[id] = nil -- which timer lines follow which assignment line (Notes/Links.lua)
    end
    parsed[id] = nil
    if db.active == id then
        db.active = nil
    end
    self:Fire()
end

-- The Addon check's Raid Notes column (CRT_Core/AddonCheck.lua): on while a shared note would be seen, in the
-- timers window or the assignments window. Nil in a harness that loads this file alone.
if CRT.AddonCheck then
    CRT.AddonCheck:Register({ key = "notes", label = "Raid Notes", order = 10, on = function()
        local n = ndb()
        return (n.window and n.window.shown ~= false) or (n.assignments and n.assignments.shown ~= false) or false
    end })
end
