local ADDON, CRT = ...

-- Special alerts: a boss's scripted alerts, written in its boss file and run on the alerts engine as the
-- "special" block, beside the raid note and your reminders. A boss file lists them on Bosses:Register:
--   special = { {
--     key = "orbSoaks",                 required: a short name, one per boss (your settings are saved by it)
--     label = "Orb soaks",              required: the name on Mech Alerts' Special list
--     help = "...",                     optional: the (?) beside its name
--     type = "soak",                    optional: an ability type (Timeline/Reference.lua TYPES), for its colour
--     difficulty = "mythic",            optional: "mythic" or "nh" (Normal/Heroic); nil is both
--     default = false,                  optional: on for a player who never ticked it (default off)
--     when = { row = "Orb Burst" },     one of: row, an ability timeline row's name (each of its casts);
--            { spellID = 1234 },        the row of that spell; or times typed as reminders type them,
--            { times = "P1 0:30, 1:10" }  "P1 0:30, 1:10; P2 0:20". A phase 1 time may be before the pull,
--                                         "-0:15" or "-15": it plays only from the game's pull timer (the countdown
--                                         run, Alerts/Countdown.lua), never in a pull's run or a rehearsal
--     lead = 5,                         optional: seconds before each time it shows (default 5)
--     icon = 2825,                      optional: a spell ID (2825 is Bloodlust); the icon is that spell's texture
--     iconFile = 136243,                optional: a texture file ID, the alert's icon as it is (never read as a
--                                         spell). With both, icon wins (iconFile when the game knows no such
--                                         spell). With neither: the texture of when's spell (spellID, or its
--                                         row's spell). A texture the game hides shows no icon
--     who = { mode = "everyone" },      everyone (the default) gets every cast;
--           { mode = "rotation", rotation = { { 1, 2 }, { 3, 4 } } }
--                                       or one step per cast in turn, wrapping: raid groups by number, or the
--                                       words a note tag takes ("tank", "healer", "melee", a class or a name).
--                                       The steps count the casts from the pull: a cast before the pull takes
--                                       step 1 and never moves the rest, so the first cast after it is step 1;
--           { mode = "roles", roles = { "tank", "healer" } }
--                                       or every cast to each player the words fit, read as a note's tags read
--                                       them: tank, healer, dps, melee, ranged, a class (its English or file
--                                       name), Group1 to Group8 or a number 1 to 8 (shown as "Group 3"), a
--                                       player's name;
--           { mode = "note", note = "Soak" }
--                                       or the names on the active raid note's "Soak:" line (every cast), or on
--                                       its "Soak 1:", "Soak 2:" lines (one per cast in turn, wrapping, counted
--                                       as a rotation's are)
--     text = "Soak now: {group}",       optional: the callout and speech (default the label); {group} is the step
--                                         (roles: the words, joined with ", ")
--     show = { callout = true, bar = true, text = false, icon = false, circle = false, timeline = false,
--              speech = true },         optional: the Show as choices a player starts with
--     markers = { marks = { "star", "circle" } },
--                                       optional: the raid markers for the players of each step
--     ticks = { 0, 2.5 },               optional: seconds after each cast when its impacts land, drawn as
--     barTo = "last",                     lines on its bar (Alerts/Bars.lua); barTo "last" (the default) runs
--                                         the bar to the last impact, "cast" ends it at the cast
--     bar = { length = 8, ticks = { 4.5, 6.5 }, start = 0 },
--                                       optional, the other way to write it: a bar of its own that appears
--                                         start seconds after each cast (negative: before it; default 0), runs
--                                         length seconds, with impacts ticks seconds into it. Not with ticks.
--     fill = "up",                      optional: whether its bar fills up as the cast nears ("up", the default for
--                                         special alerts) or empties ("down"); each player may change it
--     covers = { 1234, 5678 },          optional: more spells this alert stands for (besides when's spell or
--                                         row), so your own reminder on them doesn't alert the same cast twice
--   } }
-- No double alerts: an alert covers its when.spellID, its when.row's spell and its covers. When you have it on
-- and your own reminder on for one of those spells, the engine leaves out your reminder's alert for any cast
-- the special one also alerts (the same phase, within Alerts.COVER_WINDOW seconds); the rest still come.
-- Only the players of a cast's step get its alert ("mine", as the note's tags say); everyone else gets
-- nothing, unless the mode is everyone. A step's words are cut at spaces before they are read as tags, so
-- "Group 3" and "Demon Hunter" read as in a note. Unknown fields are ignored. An entry that doesn't read is
-- skipped, with a chat warning in developer builds only.
-- Pre-pull: the special block gives a run whose reason is "countdown" only its phase 1 items before the pull
-- (time < 0), and every other run only the rest, so a pre-pull alert never shows twice.
-- Raid markers: SetRaidTarget is a protected function since patch 12.0 (warcraft.wiki.gg API_SetRaidTarget;
-- Blizzard calls it only from its secure templates), so an addon can never put a marker on a player. The
-- alert names the marks in its text instead (Special.MARKING says so to the Mech Alerts panel).
-- Each player's choices: CRT.db.alerts.special[encounterID][key] = { on, show = { alert, text, icon, bar,
-- circle, timeline }, speak, markers, fill, lead }, saved once changed; until then the entry's own defaults apply.
-- lead is your Show from (seconds before each cast it shows, LEAD_MIN to LEAD_MAX as on the Mechanics panel), kept
-- only while it differs from the entry's lead. It moves when the alert shows (callout, text, icon, speech, and a bar
-- with no start of its own, which shows with it); a bar of its own (bar.start) keeps the boss file's place.
-- /crt dev special (developer builds) adds a sample to Special.dev[encounterID], never saved.

local Alerts = CRT.Alerts
local Rules = CRT.AlertRules

local Special = { dev = {} }
CRT.AlertSpecial = Special

-- Your choices are kept per boss: declared for the dev season purge (Bosses:DeclareStore, CRT_Data/Bosses/Registry.lua).
if CRT.Bosses and CRT.Bosses.DeclareField then
    CRT.Bosses:DeclareField("special alert choices", "alerts", "special")
end

local BLOCK = "special"
Special.BLOCK = BLOCK
local DEFAULT_LEAD = 5
-- your Show from: the Mechanics panel's range (Notes/Reminders.lua, Alerts/Share.lua)
local LEAD_MIN, LEAD_MAX = 1, 60
Special.LEAD_MIN, Special.LEAD_MAX = LEAD_MIN, LEAD_MAX
local MAX_GROUP = 8

-- Whether an addon may set raid markers on players during a pull: no (see the top of this file).
Special.MARKING = { allowed = false }

local SHOW_KEYS = { "alert", "text", "icon", "bar", "circle", "timeline" }
Special.SHOW_KEYS = SHOW_KEYS
-- the boss file's Show as words, by the alert's own keys
local DATA_SHOW = { alert = "callout", text = "text", icon = "icon", bar = "bar", circle = "circle", timeline = "timeline" }
-- what a new entry shows when its file says nothing: the note callout and a bar, read out
local SHOW_DEFAULT = { alert = true, bar = true }

local MODES = { everyone = true, rotation = true, roles = true, note = true }
-- the run the pull timer starts (Alerts/Countdown.lua): it takes only the items before the pull
local COUNTDOWN = "countdown"
Special.COUNTDOWN = COUNTDOWN
local FILLS = { up = true, down = true }
local DEFAULT_FILL = "up" -- a special alert is usually a cast coming: its bar fills up to it
local GROUPS = { mythic = true, nh = true }

-- The raid markers by the words a boss file may use, as the game numbers them (1 star ... 8 skull).
local MARKS = { star = 1, circle = 2, diamond = 3, triangle = 4, moon = 5, square = 6, cross = 7, x = 7, skull = 8 }
local MARK_NAMES = { "Star", "Circle", "Diamond", "Triangle", "Moon", "Square", "Cross", "Skull" }

local function trim(s)
    return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

local function readable(v)
    local T = CRT.Timeline
    if T and T.readable then
        return T.readable(v)
    end
    return not (issecretvalue and issecretvalue(v))
end

local function text(v)
    return type(v) == "string" and trim(v) ~= "" and trim(v) or nil
end

-- A marker's name in the client's language (the game's RAID_TARGET_n), else the English one.
function Special.MarkName(index)
    local name = _G["RAID_TARGET_" .. tostring(index)]
    if type(name) == "string" and readable(name) and name ~= "" then
        return name
    end
    return MARK_NAMES[index]
end

-- Developer builds (the Development page is in them) say why an entry was skipped; players never see it.
local warned = {}
local function warn(enc, key, why)
    local UI = CRT.UI
    local pages = type(UI) == "table" and rawget(UI, "pages")
    if not (type(pages) == "table" and rawget(pages, "dev")) then
        return
    end
    local id = tostring(enc) .. "|" .. tostring(key) .. "|" .. why
    if warned[id] or not CRT.Print then
        return
    end
    warned[id] = true
    CRT:Print(string.format("Special alert %s of boss %s skipped: %s.", tostring(key or "?"), tostring(enc), why))
end

-- One rotation step, or a roles list: a group number, a word, or a list of them. Returns { tags, words } or
-- nil. The tags are the words cut at spaces, as a note line's tags are ("Group 3", "Demon Hunter").
local function readStep(step)
    local list = type(step) == "table" and step or { step }
    local tags, words = {}, {}
    for _, v in ipairs(list) do
        if type(v) == "number" then
            if v ~= math.floor(v) or v < 1 or v > MAX_GROUP then
                return nil
            end
            tags[#tags + 1] = "G" .. v
            words[#words + 1] = "G" .. v
        elseif text(v) then
            for w in text(v):gmatch("%S+") do
                tags[#tags + 1] = w
            end
            words[#words + 1] = text(v)
        else
            return nil
        end
    end
    if #tags == 0 then
        return nil
    end
    return { tags = tags, words = words }
end

local function readWhen(when)
    if type(when) ~= "table" then
        return nil, "when needs row, spellID or times"
    end
    if text(when.row) then
        return { row = text(when.row) }
    end
    if type(when.spellID) == "number" and when.spellID > 0 then
        return { spellID = when.spellID }
    end
    if text(when.times) then
        -- a phase 1 time may be before the pull (see the top of this file)
        local list, err = CRT.AlertReminders.ParseTimes(when.times, true)
        if not list then
            return nil, "its times don't read (" .. tostring(err) .. ")"
        end
        return { times = text(when.times), list = list }
    end
    return nil, "when needs row, spellID or times"
end

local function readWho(who)
    if who == nil then
        return { mode = "everyone" }
    end
    if type(who) ~= "table" or not MODES[who.mode or "everyone"] then
        return nil, "who.mode must be everyone, rotation, roles or note"
    end
    local mode = who.mode or "everyone"
    if mode == "rotation" then
        if type(who.rotation) ~= "table" or #who.rotation == 0 then
            return nil, "a rotation needs its steps"
        end
        local steps = {}
        for i, step in ipairs(who.rotation) do
            steps[i] = readStep(step)
            if not steps[i] then
                return nil, "rotation step " .. i .. " is not groups 1 to 8 or words"
            end
        end
        return { mode = mode, steps = steps }
    elseif mode == "roles" then
        -- one step that every cast takes
        local step = type(who.roles) == "table" and #who.roles > 0 and readStep(who.roles)
        if not step then
            return nil, "roles must be words (a role, a class, a name) or groups 1 to 8"
        end
        -- a group by its number is read as G3 and shown as "Group 3" (one word per item of the list)
        for i, v in ipairs(who.roles) do
            if type(v) == "number" then
                step.words[i] = "Group " .. v
            end
        end
        return { mode = mode, roles = step.words, steps = { step } }
    elseif mode == "note" then
        if not text(who.note) then
            return nil, "note mode needs the note's label"
        end
        return { mode = mode, note = text(who.note) }
    end
    return { mode = mode }
end

local function readMarks(m)
    if type(m) ~= "table" or type(m.marks) ~= "table" then
        return nil
    end
    local out = {}
    for _, v in ipairs(m.marks) do
        local i = type(v) == "number" and v or (type(v) == "string" and MARKS[trim(v):lower()])
        if type(i) == "number" and i >= 1 and i <= 8 and i == math.floor(i) then
            out[#out + 1] = i
        end
    end
    return #out > 0 and out or nil
end

local function finite(v)
    return type(v) == "number" and v == v and v > -math.huge and v < math.huge
end

-- A list of seconds in order, or nil when it isn't one.
local function seconds(list)
    if type(list) ~= "table" then
        return nil
    end
    local out = {}
    for _, v in ipairs(list) do
        if not finite(v) then
            return nil
        end
        out[#out + 1] = v
    end
    table.sort(out)
    return out
end

-- The bar's impacts, from ticks (and barTo) or bar: { ticks (seconds after the cast, in order), barTo, barStart,
-- barEnd, length, start, inBar (bar's own ticks, seconds into it) }, as the bars read them (Alerts/Bars.lua).
-- Nil when the entry has neither; nil and why when one doesn't read.
local function readImpacts(def)
    if def.ticks ~= nil and def.bar ~= nil then
        return nil, "give ticks or bar, not both"
    end
    local b = def.bar
    if b ~= nil then
        if type(b) ~= "table" or not finite(b.length) or b.length <= 0 then
            return nil, "bar needs a length over 0 seconds"
        end
        local start = b.start == nil and 0 or b.start
        if not finite(start) then
            return nil, "bar.start must be seconds"
        end
        local inBar = b.ticks == nil and {} or seconds(b.ticks)
        if not inBar then
            return nil, "bar.ticks must be seconds into the bar"
        end
        local ticks = {}
        for i, t in ipairs(inBar) do
            if t < 0 or t > b.length then
                return nil, "bar.ticks must lie inside its length"
            end
            ticks[i] = start + t
        end
        return { ticks = ticks, barStart = start, barEnd = start + b.length, length = b.length, start = start, inBar = inBar }
    end
    if def.ticks ~= nil then
        local ticks = seconds(def.ticks)
        if not ticks or #ticks == 0 or ticks[1] < 0 then
            return nil, "ticks must be seconds after the cast"
        end
        if def.barTo ~= nil and def.barTo ~= "cast" and def.barTo ~= "last" then
            return nil, "barTo must be cast or last"
        end
        return { ticks = ticks, barTo = def.barTo or "last" }
    end
    return nil
end

-- Whether v is a game ID: a whole number over 0.
local function wholeID(v)
    return finite(v) and v > 0 and v == math.floor(v)
end

-- The spells an entry names in covers, or nil and why.
local function readCovers(list)
    if list == nil then
        return {}
    end
    if type(list) ~= "table" then
        return nil, "covers must be spell IDs"
    end
    local out = {}
    for _, id in ipairs(list) do
        if not wholeID(id) then
            return nil, "covers must be spell IDs"
        end
        out[#out + 1] = id
    end
    return out
end

-- One entry of a boss file, checked and in the shape the rest of the addon reads, or nil and why.
function Special.Read(def)
    if type(def) ~= "table" then
        return nil, "not a table"
    end
    local key, label = text(def.key), text(def.label)
    if not key then
        return nil, "no key"
    end
    if not label then
        return nil, "no label"
    end
    if def.difficulty ~= nil and not GROUPS[def.difficulty] then
        return nil, "difficulty must be mythic, nh or left out"
    end
    local when, whyWhen = readWhen(def.when)
    if not when then
        return nil, whyWhen
    end
    local who, whyWho = readWho(def.who)
    if not who then
        return nil, whyWho
    end
    local impacts, whyImpacts = readImpacts(def)
    if whyImpacts then
        return nil, whyImpacts
    end
    local covers, whyCovers = readCovers(def.covers)
    if not covers then
        return nil, whyCovers
    end
    if def.fill ~= nil and not FILLS[def.fill] then
        return nil, "fill must be up or down"
    end
    if def.icon ~= nil and not wholeID(def.icon) then
        return nil, "icon must be a spell ID"
    end
    if def.iconFile ~= nil and not wholeID(def.iconFile) then
        return nil, "iconFile must be a texture file ID"
    end
    local show, given = {}, type(def.show) == "table" and def.show or nil
    for _, k in ipairs(SHOW_KEYS) do
        local v = given and given[DATA_SHOW[k]]
        if v == nil then
            v = SHOW_DEFAULT[k] or false
        end
        show[k] = v and true or false
    end
    local lead = tonumber(def.lead)
    return {
        key = key,
        label = label,
        help = text(def.help),
        type = text(def.type),
        difficulty = def.difficulty,
        default = def.default == true,
        when = when,
        lead = (lead and lead > 0) and lead or DEFAULT_LEAD,
        who = who,
        text = text(def.text) or label,
        show = show,
        speak = not (given and given.speech == false),
        marks = readMarks(def.markers),
        impacts = impacts,
        covers = covers,
        fill = def.fill or DEFAULT_FILL,
        icon = def.icon,
        iconFile = def.iconFile,
    }
end

-- The boss file's list read once (by the list itself, so a /reload or a new file reads again).
local readCache = setmetatable({}, { __mode = "k" })

local function readList(enc, list)
    if type(list) ~= "table" then
        return {}
    end
    if readCache[list] then
        return readCache[list]
    end
    local out, seen = {}, {}
    for i, def in ipairs(list) do
        local entry, why = Special.Read(def)
        if entry and seen[entry.key] then
            entry, why = nil, "a second entry with the key " .. entry.key
        end
        if entry then
            seen[entry.key] = true
            out[#out + 1] = entry
        else
            warn(enc, type(def) == "table" and def.key or ("#" .. i), why)
        end
    end
    readCache[list] = out
    return out
end

-- A boss's special alerts for a difficulty group ("mythic" or "nh"; nil: every one), in the file's order,
-- then the developer's sample. Only bosses of a loaded season count.
function Special:List(encounterID, group)
    local out = {}
    local Bosses = CRT.Bosses
    local def = Bosses and Bosses.Get and Bosses:Get(encounterID)
    local loaded = def and (not Bosses.Loaded or Bosses:Loaded(encounterID))
    local all = {}
    for _, e in ipairs(loaded and readList(encounterID, def.special) or {}) do
        all[#all + 1] = e
    end
    for _, e in ipairs(readList(encounterID, self.dev[encounterID])) do
        all[#all + 1] = e
    end
    for _, e in ipairs(all) do
        if group == nil or e.difficulty == nil or e.difficulty == group then
            out[#out + 1] = e
        end
    end
    return out
end

function Special:Get(encounterID, key)
    for _, e in ipairs(self:List(encounterID)) do
        if e.key == key then
            return e
        end
    end
end

-- Your choices --------------------------------------------------------------------------------------

local function store(create)
    local db = Alerts:Settings()
    if type(db) ~= "table" then
        return nil
    end
    if create and type(db.special) ~= "table" then
        db.special = {}
    end
    return type(db.special) == "table" and db.special or nil
end

-- Your Show from for an entry, or nil: a saved lead in range that differs from the entry's.
local function ownLead(entry, v)
    if finite(v) and v >= LEAD_MIN and v <= LEAD_MAX and v ~= entry.lead then
        return v
    end
    return nil
end

-- Your choices for an entry: { on, show = { ... }, speak, markers, fill, lead }, the saved ones over the entry's
-- defaults. lead is nil until yours differs from the entry's (Special:Lead gives the one in use).
function Special:Choices(encounterID, entry)
    local all = store()
    local saved = all and type(all[encounterID]) == "table" and all[encounterID][entry.key]
    saved = type(saved) == "table" and saved or {}
    local show = {}
    local savedShow = type(saved.show) == "table" and saved.show or {}
    for _, k in ipairs(SHOW_KEYS) do
        if savedShow[k] ~= nil then
            show[k] = savedShow[k] and true or false
        else
            show[k] = entry.show[k]
        end
    end
    local function pick(v, default)
        if v == nil then
            return default
        end
        return v and true or false
    end
    return { on = pick(saved.on, entry.default), show = show, speak = pick(saved.speak, entry.speak),
        markers = pick(saved.markers, false), fill = FILLS[saved.fill] and saved.fill or entry.fill or DEFAULT_FILL,
        lead = ownLead(entry, saved.lead) }
end

-- Seconds before each cast the entry shows for you: your Show from, else the entry's lead.
function Special:Lead(encounterID, entry)
    return self:Choices(encounterID, entry).lead or entry.lead
end

-- Saves one choice ("on", "speak", "markers", "fill" = "up" or "down", "lead" = seconds or nil for the entry's,
-- or a Show as key with show = true) and tells the engine.
-- The whole set is saved, so a later change to the entry's defaults leaves your choices alone; a lead is saved
-- only while it differs from the entry's (one out of range is the entry's too).
function Special:SetChoice(encounterID, entry, field, value, show)
    local all = store(true)
    if not (all and entry) then
        return
    end
    local c = self:Choices(encounterID, entry)
    if show then
        c.show[field] = value and true or false
    elseif field == "fill" then
        c.fill = FILLS[value] and value or DEFAULT_FILL
    elseif field == "lead" then
        c.lead = ownLead(entry, value)
    else
        c[field] = value and true or false
    end
    all[encounterID] = type(all[encounterID]) == "table" and all[encounterID] or {}
    all[encounterID][entry.key] = c
    Alerts:Fire()
end

-- Times ---------------------------------------------------------------------------------------------

local function bossName(encounterID)
    local def = CRT.Bosses and CRT.Bosses.Get and CRT.Bosses:Get(encounterID)
    return def and def.name or nil
end

-- The ability timeline row of an entry: by its name, else by its spell (as reminders find theirs).
local function rowOf(ref, encounterID, when)
    if when.row then
        local want = when.row:lower()
        for _, row in ipairs(ref.rows or {}) do
            if type(row.name) == "string" and trim(row.name):lower() == want then
                return row
            end
        end
        return nil
    end
    local Reminders = CRT.AlertReminders
    return Reminders.RowFor(ref, encounterID, { spellID = when.spellID })
end

-- An entry's times as { { ph, t } } in cast order (the rotation counts them): the row's casts placed as the
-- Timeline draws them (Reminders.FromReference, the reminders' placement), on ref or the boss's ability
-- timeline for group (Reminders.ReferenceFor), or the typed times, in phase order. {} when none.
function Special:Times(encounterID, entry, group, ref)
    local Reminders = CRT.AlertReminders
    local out = {}
    if entry.when.list then
        for i, e in ipairs(entry.when.list) do
            out[i] = { ph = e.ph, t = e.t, n = i }
        end
        table.sort(out, function(a, b)
            if a.ph ~= b.ph then
                return a.ph < b.ph
            end
            if a.t ~= b.t then
                return a.t < b.t
            end
            return a.n < b.n
        end)
        return out
    end
    ref = ref or Reminders.ReferenceFor(encounterID, { boss = bossName(encounterID) }, group)
    local row = ref and rowOf(ref, encounterID, entry.when)
    if not row then
        return out
    end
    for _, e in ipairs(Reminders.FromReference(ref, row)) do
        out[#out + 1] = { ph = e.ph, t = e.t }
    end
    return out
end

-- The spell of an entry's when.row on ref or the boss's ability timeline for group, or nil.
local function rowSpell(encounterID, entry, group, ref)
    local Lanes = CRT.TimelineLanes
    if not (entry.when.row and Lanes and Lanes.RowSpell) then
        return nil
    end
    ref = ref or CRT.AlertReminders.ReferenceFor(encounterID, { boss = bossName(encounterID) }, group)
    local row = ref and rowOf(ref, encounterID, entry.when)
    local ok, id = false, nil
    if row then
        ok, id = pcall(Lanes.RowSpell, row, encounterID)
    end
    if ok and readable(id) and type(id) == "number" and id > 0 then
        return id
    end
    return nil
end

-- The spells an entry stands for, as a set (see "No double alerts" at the top of this file): its covers, its
-- when.spellID, and the spell of its when.row on ref or the boss's ability timeline for group.
function Special:Covers(encounterID, entry, group, ref)
    local out = {}
    for _, id in ipairs(entry.covers or {}) do
        out[id] = true
    end
    if entry.when.spellID then
        out[entry.when.spellID] = true
    end
    local id = rowSpell(encounterID, entry, group, ref)
    if id then
        out[id] = true
    end
    return out
end

-- What a boss's special alerts are read from: changes when its boss file's list or the developer's sample is
-- replaced (a list that is cached by its tables, such as Mech Alerts' rows, keys on it).
function Special:ListKey(encounterID)
    local Bosses = CRT.Bosses
    local def = Bosses and Bosses.Get and Bosses:Get(encounterID)
    return tostring(def and def.special) .. "|" .. tostring(self.dev[encounterID])
end

-- The first of a boss's special alerts for group that stands for an ability (its spell, or for one named by its
-- row, the row's name), or nil: Mech Alerts marks that ability's row (Notes/Reminders.lua).
function Special:CoveredBy(encounterID, group, spellID, name, ref)
    local want = type(name) == "string" and trim(name):lower() or nil
    for _, entry in ipairs(self:List(encounterID, group)) do
        if want and entry.when.row and entry.when.row:lower() == want then
            return entry
        end
        if type(spellID) == "number" and self:Covers(encounterID, entry, group, ref)[spellID] then
            return entry
        end
    end
    return nil
end

-- Who -----------------------------------------------------------------------------------------------

-- The names of an assignment line after its label, cut as the note's readers cut them (a class name of
-- several words is one), markup left out.
local function names(rest)
    local Parser = CRT.NoteParser
    local out = {}
    if Parser and Parser.ClassRuns then
        local groupWords = Parser.GROUP_WORDS or {}
        for _, item in ipairs(Parser.ClassRuns(rest, Parser.NAME_WORD)) do
            local before = out[#out]
            -- a group's number stays after its word ("Group 1"), as a note tag reads it
            local groupNumber = item.text:match("^%d$") and before and groupWords[before:lower()]
            if groupNumber or (item.text:find("%a") and not item.text:find("^{")) then
                out[#out + 1] = item.text
            end
        end
        return out
    end
    for w in rest:gmatch("[^%s,]+") do
        out[#out + 1] = w
    end
    return out
end

-- The steps a note gives a label: its "Label:" line (one step, every cast), else its "Label 1:", "Label 2:"
-- lines in number order (one per cast in turn). {} when the note has neither.
function Special.NoteSteps(parsed, label)
    local want = trim(label):lower()
    local whole, numbered = nil, {}
    for _, line in ipairs(type(parsed) == "table" and parsed.lines or {}) do
        local head, rest = line:match("^([^:]+):(.*)$")
        head = head and trim(head):lower()
        if head == want and not whole then
            whole = names(rest)
        elseif head then
            local n = head:sub(1, #want) == want and tonumber(trim(head:sub(#want + 1)))
            if n and not numbered[n] then
                numbered[n] = names(rest)
            end
        end
    end
    local function step(list)
        return { tags = list, words = list }
    end
    if whole then
        return { step(whole) }
    end
    local nums = {}
    for n in pairs(numbered) do
        nums[#nums + 1] = n
    end
    table.sort(nums)
    local out = {}
    for _, n in ipairs(nums) do
        out[#out + 1] = step(numbered[n])
    end
    return out
end

-- The note a run reads its labels from: the note the run uses (Notes/Engine.lua), else the boss's.
local function noteFor(run, encounterID)
    local Engine, Notes = CRT.NoteEngine, CRT.Notes
    if run and run == Alerts.run and Engine and Engine.Note then
        local n = Engine:Note()
        if n then
            return n
        end
    end
    if not (Notes and Notes.FindForEncounter and Notes.Parsed) then
        return nil
    end
    local id = Notes:FindForEncounter(encounterID, run and run.difficultyName)
    return id and Notes:Parsed(id) or nil
end
Special.NoteFor = noteFor

-- The steps of an entry: the rotation's, the roles' one step (every cast), the note's, or nil for everyone.
function Special.Steps(entry, note)
    if entry.who.mode == "rotation" or entry.who.mode == "roles" then
        return entry.who.steps
    elseif entry.who.mode == "note" then
        return Special.NoteSteps(note, entry.who.note)
    end
    return nil
end

-- The step of cast n (1 the first; the steps wrap), or nil.
function Special.StepAt(steps, n)
    if type(steps) ~= "table" or #steps == 0 then
        return nil
    end
    return steps[(n - 1) % #steps + 1]
end

-- Whether a step is yours, as a note line's tags would be (your name, role, class or raid group).
function Special.IsMine(step)
    local Engine = CRT.NoteEngine
    if not (step and Engine and Engine.IsMine) then
        return false
    end
    local ok, mine = pcall(Engine.IsMine, Engine, { tags = step.tags })
    return ok and mine and true or false
end

-- Items ---------------------------------------------------------------------------------------------

-- A spell's texture: the texture when it can be read; nil and true when the game hides it; nil when the game
-- knows no such spell.
local function spellTexture(spellID)
    if type(spellID) ~= "number" or not (C_Spell and C_Spell.GetSpellTexture) then
        return nil
    end
    local ok, tex = pcall(C_Spell.GetSpellTexture, spellID)
    if not ok or tex == nil then
        return nil
    end
    if readable(tex) then
        return tex
    end
    return nil, true
end

-- An entry's icon (see icon and iconFile at the top of this file): its icon spell's texture, else its iconFile
-- (also when the game knows no such spell), else the texture of when's spell (when.spellID, else its row's spell
-- on ref or the boss's ability timeline for group). Nil when there is none or the game hides it.
function Special.Icon(encounterID, entry, group, ref)
    if entry.icon then
        local tex, hidden = spellTexture(entry.icon)
        if tex or hidden then
            return tex
        end
    end
    if entry.iconFile then
        return readable(entry.iconFile) and entry.iconFile or nil
    end
    local spell = entry.when.spellID or rowSpell(encounterID, entry, group, ref)
    return (spellTexture(spell))
end

-- The entry's marks as text, in order ("Star, Circle"), or nil.
local function marksText(entry)
    if not entry.marks then
        return nil
    end
    local list = {}
    for i, m in ipairs(entry.marks) do
        list[i] = Special.MarkName(m)
    end
    return table.concat(list, ", ")
end

-- The alert's text for a step: {group} is the step's groups, words or names ("everyone" with none), and
-- the marks follow, since they can't be set (Special.MARKING).
function Special.TextFor(entry, step)
    local who = step and table.concat(step.words, ", ") or "everyone"
    local out = entry.text:gsub("{group}", function()
        return who
    end)
    local marks = marksText(entry)
    if marks then
        out = out .. " (" .. marks .. ")"
    end
    return out
end

local function item(entry, choices, n, at, step, covers, icon)
    local textOut = Special.TextFor(entry, step)
    local Reference = CRT.TimelineReference
    local outputs = {}
    for _, k in ipairs(SHOW_KEYS) do
        outputs[k] = choices.show[k] and true or false
    end
    outputs.speech = choices.speak and true or false
    -- your Show from, else the entry's: when the alert shows; a bar of its own keeps its start (barStart)
    local lead = choices.lead or entry.lead
    local spell = entry.when.spellID
    local imp = entry.impacts
    local ticks
    if imp then
        ticks = {}
        for i, t in ipairs(imp.ticks) do
            ticks[i] = t
        end
    end
    return {
        -- the bar's impacts (Alerts/Bars.lua) and the spells it stands for (Alerts/Engine.lua's no double alerts)
        ticks = ticks,
        barTo = imp and imp.barTo,
        barStart = imp and imp.barStart,
        barEnd = imp and imp.barEnd,
        fill = choices.fill or DEFAULT_FILL,
        covers = covers,
        id = BLOCK .. ":" .. entry.key .. ":" .. n,
        ph = at.ph,
        time = at.t,
        spellID = spell,
        icon = icon,
        text = textOut,
        priority = Rules.Priority(3, "normal"),
        warn = lead,
        hold = 0.5,
        abilityType = (entry.type and Reference and Reference.TYPES and Reference.TYPES[entry.type]) and entry.type or nil,
        outputs = outputs,
        speech = Rules.SpeechItems(textOut, lead, choices.speak and true or false, false, false),
        special = entry.key,
    }
end

-- The items of one entry for a run (or nil: the boss's own view), one per cast of yours: every cast when
-- the mode is everyone, else those whose step is yours (a cast before the pull takes step 1; the casts from the
-- pull count the steps, see who at the top of this file). opts: group, ref (the run's ability timeline),
-- choices (default yours), all (every cast, as if each were yours: a test).
function Special:Items(encounterID, entry, opts)
    opts = opts or {}
    local run = opts.run
    local choices = opts.choices or self:Choices(encounterID, entry)
    local steps = Special.Steps(entry, entry.who.mode == "note" and noteFor(run, encounterID) or nil)
    local out, covers, icon = {}, nil, nil
    local fromPull = 0 -- the casts at or after the pull: a step counts these, so a pre-pull cast never shifts one
    for n, at in ipairs(self:Times(encounterID, entry, opts.group, opts.ref)) do
        local index = 1
        if not (at.ph == 1 and at.t < 0) then
            fromPull = fromPull + 1
            index = fromPull
        end
        local step = Special.StepAt(steps, index)
        local mine = entry.who.mode == "everyone" or Special.IsMine(step)
        if mine or opts.all then
            if not covers then
                covers = self:Covers(encounterID, entry, opts.group, opts.ref)
                icon = Special.Icon(encounterID, entry, opts.group, opts.ref)
            end
            out[#out + 1] = item(entry, choices, n, at, step, covers, icon)
        end
    end
    return out
end

-- The one item a Test plays: the first cast that is yours, else the first cast, with your choices.
-- Nil when the entry has no times.
function Special:TestItem(encounterID, entry, group, ref)
    local mine = self:Items(encounterID, entry, { group = group, ref = ref })
    if mine[1] then
        return mine[1]
    end
    return self:Items(encounterID, entry, { group = group, ref = ref, all = true })[1]
end

-- The block: every entry of the run's boss for its difficulty group that you turned on. A countdown run (the
-- pull timer's) takes only the items before the pull; every other run (a pull, a rehearsal, a test) the rest.
local function entries(run)
    local out = {}
    if not (run and type(run.encounterID) == "number") then
        return out
    end
    local group = Alerts.RunGroup and Alerts:RunGroup(run) or nil
    local countdown = run.reason == COUNTDOWN
    for _, entry in ipairs(Special:List(run.encounterID)) do
        local fits = entry.difficulty == nil or run.anyDifficulty or entry.difficulty == group
        if fits and Special:Choices(run.encounterID, entry).on then
            local list = Special:Items(run.encounterID, entry, { run = run, group = group, ref = run.reference })
            for _, it in ipairs(list) do
                local prePull = it.ph == 1 and it.time < 0
                if prePull == countdown then
                    out[#out + 1] = it
                end
            end
        end
    end
    return out
end

Alerts:RegisterBlock(BLOCK, { label = "Special alerts", group = true, Entries = entries })
