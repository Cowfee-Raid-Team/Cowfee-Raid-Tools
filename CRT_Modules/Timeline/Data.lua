local ADDON, CRT = ...

-- Timeline: the saved pulls of each raid boss, for the Timeline page. This file is the store: it
-- keeps the last few pulls of every boss, per difficulty, in CRTDB.timeline.bosses (a pull is when the boss spells
-- were cast and when players died, in seconds from the pull start), drops the oldest past the
-- keep limit, and answers the questions the page asks (the bosses, a boss's pulls, the deaths of
-- recent pulls). Everything is read from CRT.db.timeline fresh each time, so switching profile
-- gives the new profile's pulls. Change listeners are told when anything is saved or deleted.
-- The bottom half records the pulls: during a raid boss fight it notes each boss spell when its
-- timeline event finishes, and after the fight (out of combat, when the game's damage meter has
-- stopped hiding values) it reads who died and what killed them, then saves the pull.

local Timeline = { listeners = {} }
CRT.Timeline = Timeline

local function tdb()
    return CRT.db.timeline
end

function Timeline:OnChange(fn)
    self.listeners[#self.listeners + 1] = fn
end

function Timeline:Fire()
    for _, fn in ipairs(self.listeners) do
        -- A listener (the page) failing must never stop the recording.
        local ok, err = pcall(fn)
        if not ok and geterrorhandler then
            geterrorhandler()(err)
        end
    end
end

function Timeline:Settings()
    return tdb()
end

function Timeline:Set(field, value)
    tdb()[field] = value
    self:Fire()
end

-- Ignored mechanics: boss mechanics you hide from your own timeline, per boss, by name (a reference row
-- and a recorded pull's spell row of the same ability share it), in timeline.ignored[boss][name in
-- lower case] = the name as shown. Only what you see: the notes, alerts, reminders and anything shared
-- are never touched, and a hidden mechanic's alerts still fire. The view lists them under Ignored
-- mechanics, and the Rehearsal leaves them out too.

local function ignoreKey(name)
    return tostring(name or ""):lower()
end

-- Whether a lane is a boss mechanic that can be ignored (not deaths, notes or overlay ticks).
function Timeline.Ignorable(lane)
    return lane ~= nil and (lane.kind == "reference" or lane.kind == "spell" or lane.kind == "journal")
        and lane.label ~= nil
end

-- The name a lane is ignored by: its own, not one you gave it (ApplyAbilities keeps it as baseLabel).
function Timeline.IgnoreName(lane)
    return lane and (lane.baseLabel or lane.label)
end

function Timeline:Ignored(encounterID, name)
    local all = tdb().ignored
    local list = all and all[tostring(encounterID)]
    return (list and list[ignoreKey(name)] ~= nil) or false
end

function Timeline:SetIgnored(encounterID, name, on)
    if encounterID == nil or name == nil then
        return
    end
    local db = tdb()
    db.ignored = db.ignored or {}
    local boss = tostring(encounterID)
    db.ignored[boss] = db.ignored[boss] or {}
    db.ignored[boss][ignoreKey(name)] = on and name or nil
    if next(db.ignored[boss]) == nil then
        db.ignored[boss] = nil
    end
    self:Fire()
end

-- lanes split into the ones to draw and the ignored ones, each in its order.
function Timeline:WithoutIgnored(lanes, encounterID)
    local shown, hidden = {}, {}
    for _, lane in ipairs(lanes or {}) do
        if self.Ignorable(lane) and self:Ignored(encounterID, self.IgnoreName(lane)) then
            hidden[#hidden + 1] = lane
        else
            shown[#shown + 1] = lane
        end
    end
    return shown, hidden
end

-- Whether this is a developer build with the Development page open (/crt dev). Players never have it:
-- the page and every Dev file are left out of the package.
function Timeline.DevMode()
    local pages = type(CRT.UI) == "table" and rawget(CRT.UI, "pages")
    local page = type(pages) == "table" and rawget(pages, "dev")
    return type(page) == "table" and not page.hidden
end

-- Hidden abilities: boss mechanics taken off the timeline for everyone, unlike ignored mechanics, which
-- are one player's and listed to bring back. They ship as the boss file's hidden list of names
-- (Bosses:Register({ ..., hidden = { "Disgusting Fish" } })). A developer build sets them from the
-- right-click menu of a row (Review tab, pop-out, Advanced tab) while /crt dev is open, saved on that
-- computer as dev.hiddenAbilities[boss][name in lower case] = the name (hidden) or false (shown though
-- shipped hidden), until the list is copied into the boss file (/crt dev hidden prints it). Hidden rows
-- leave the Review tab, the pop-out and the Rehearsal; alerts, notes and reminders are untouched.

-- The same pattern serves a second list, hidden from the Mech Alerts tab (Notes/Reminders.lua) and not from
-- the timeline: the boss file's mechHidden list, dev.mechHidden on a developer's computer, printed by
-- /crt dev mechhidden. Each list is { field in the boss file, store under CRTDB.dev }.
local HIDDEN = { field = "hidden", store = "hiddenAbilities" }
local MECH_HIDDEN = { field = "mechHidden", store = "mechHidden" }

local function shippedList(encounterID, list)
    local def = CRT.Bosses and CRT.Bosses.Get and CRT.Bosses:Get(encounterID)
    local names = def and def[list.field]
    return type(names) == "table" and names or {}
end

local function shippedHidden(encounterID, key, list)
    for _, name in ipairs(shippedList(encounterID, list)) do
        if ignoreKey(name) == key then
            return true
        end
    end
    return false
end

local function devHidden(encounterID, list, make)
    local db = CRT.db
    if not db then
        return nil
    end
    local boss = tostring(encounterID)
    if make then
        db.dev = db.dev or {}
        db.dev[list.store] = db.dev[list.store] or {}
        db.dev[list.store][boss] = db.dev[list.store][boss] or {}
    end
    local all = db.dev and db.dev[list.store]
    return all and all[boss]
end

local function isHidden(encounterID, name, list)
    if encounterID == nil or name == nil then
        return false
    end
    local key = ignoreKey(name)
    local mine = devHidden(encounterID, list)
    if mine and mine[key] ~= nil then
        return mine[key] ~= false
    end
    return shippedHidden(encounterID, key, list)
end

-- names: one name or a list of them, saved with one Fire.
local function setHidden(encounterID, names, on, list)
    if encounterID == nil or names == nil then
        return
    end
    local mine = devHidden(encounterID, list, true)
    for _, name in ipairs(type(names) == "table" and names or { names }) do
        local key = ignoreKey(name)
        if (on and true or false) == shippedHidden(encounterID, key, list) then
            mine[key] = nil -- the same as shipped: nothing to keep
        else
            mine[key] = on and name or false
        end
    end
    if next(mine) == nil then
        CRT.db.dev[list.store][tostring(encounterID)] = nil
    end
    Timeline:Fire()
end

-- The names hidden for a boss as they should ship: the boss file's list in its order, less any this
-- computer shows again, then this computer's own.
local function hiddenNames(encounterID, list)
    local out, seen = {}, {}
    for _, name in ipairs(shippedList(encounterID, list)) do
        local key = ignoreKey(name)
        if not seen[key] and isHidden(encounterID, name, list) then
            seen[key] = true
            out[#out + 1] = name
        end
    end
    local extra = {}
    for key, name in pairs(devHidden(encounterID, list) or {}) do
        if name and not seen[key] then
            extra[#extra + 1] = name
        end
    end
    table.sort(extra)
    for _, name in ipairs(extra) do
        out[#out + 1] = name
    end
    return out
end

function Timeline:Hidden(encounterID, name)
    return isHidden(encounterID, name, HIDDEN)
end

-- Developer builds only (the menus offer it in DevMode).
function Timeline:SetHidden(encounterID, name, on)
    setHidden(encounterID, name, on, HIDDEN)
end

function Timeline:HiddenNames(encounterID)
    return hiddenNames(encounterID, HIDDEN)
end

-- Hidden from the Mech Alerts list for everyone (players still keep a reminder they made on one).
function Timeline:MechHidden(encounterID, name)
    return isHidden(encounterID, name, MECH_HIDDEN)
end

-- Developer builds only (the Mech Alerts tab's menu offers it in DevMode). names: one or a list.
function Timeline:SetMechHidden(encounterID, names, on)
    setHidden(encounterID, names, on, MECH_HIDDEN)
end

function Timeline:MechHiddenNames(encounterID)
    return hiddenNames(encounterID, MECH_HIDDEN)
end

-- lanes without the hidden boss mechanics.
function Timeline:WithoutHidden(lanes, encounterID)
    local shown = {}
    for _, lane in ipairs(lanes or {}) do
        if not (self.Ignorable(lane) and self:Hidden(encounterID, self.IgnoreName(lane))) then
            shown[#shown + 1] = lane
        end
    end
    return shown
end

-- Your labels for a boss's Encounter Journal abilities, set from the Advanced tab's Journal list: per boss
-- by spell ID, timeline.abilities[boss][spellID] = { row = true, type = "raid", name = "Tank buster",
-- tags = { "tank", "magic" } }.
-- row gives the ability a row of its own on the timeline even when nothing has a time for it, type colors
-- its row as a reference type does, and name shows instead of the Journal's. Only what you see, like
-- ignored mechanics: no reference, note or anything shared changes.

function Timeline:Ability(encounterID, spellID)
    local all = tdb().abilities
    local list = all and all[tostring(encounterID)]
    return list and list[spellID] or nil
end

-- field: "row", "type" or "name"; nil (or "") clears it.
function Timeline:SetAbility(encounterID, spellID, field, value)
    if encounterID == nil or type(spellID) ~= "number" then
        return
    end
    local db = tdb()
    db.abilities = db.abilities or {}
    local boss = tostring(encounterID)
    db.abilities[boss] = db.abilities[boss] or {}
    local a = db.abilities[boss][spellID] or {}
    if value == "" or value == false then
        value = nil
    end
    a[field] = value
    db.abilities[boss][spellID] = next(a) and a or nil
    if next(db.abilities[boss]) == nil then
        db.abilities[boss] = nil
    end
    self:Fire()
end

-- lanes with your labels laid on: each lane of an ability you labelled takes its name and type, and
-- each ability you gave a row and that has no lane yet gets an empty one (after the boss's rows, kind
-- "journal"). rows are the boss's Journal rows (Journal:Rows). Returns the new list.
function Timeline:ApplyAbilities(lanes, encounterID, rows)
    local all = tdb().abilities
    local list = all and all[tostring(encounterID)]
    if not list then
        return lanes
    end
    local Reference = CRT.TimelineReference
    local function dress(lane, a)
        if a.name then
            lane.baseLabel = lane.baseLabel or lane.label
            lane.label = a.name
        end
        local t = a.type and Reference and Reference.TYPES[a.type]
        if t then
            lane.types = { a.type }
            lane.color = t.color
        end
        if type(a.tags) == "table" then
            lane.tags = a.tags -- your choice of the Journal's icons, in place of the Journal's own
        end
    end
    local out, has = {}, {}
    for _, lane in ipairs(lanes or {}) do
        local a = lane.spellID and list[lane.spellID]
        if a and self.Ignorable(lane) then
            dress(lane, a)
        end
        if lane.spellID then
            has[lane.spellID] = true
        end
        out[#out + 1] = lane
    end
    for _, row in ipairs(rows or {}) do
        local a = row.spellID and list[row.spellID]
        if a and a.row and not has[row.spellID] then
            has[row.spellID] = true
            local lane = { key = "journal:" .. row.spellID, label = row.name, kind = "journal", spellID = row.spellID,
                icon = row.icon, marks = {}, tags = row.tags }
            dress(lane, a)
            out[#out + 1] = lane
        end
    end
    return out
end

-- The raid's chosen order of a boss's parts (see Reference.PartMover), per boss and difficulty group,
-- saved as its Reference.OrderKey ("Iku > Gebbo > Nama") in timeline.orders[encounterID][group]. Nil
-- means the order the reference was written in. Setting nil clears it.
function Timeline:Order(encounterID, group)
    local orders = tdb().orders
    return orders and orders[encounterID] and orders[encounterID][group or "nh"]
end

function Timeline:SetOrder(encounterID, group, key)
    if encounterID == nil then
        return
    end
    local db = tdb()
    db.orders = db.orders or {}
    db.orders[encounterID] = db.orders[encounterID] or {}
    db.orders[encounterID][group or "nh"] = key
    self:Fire()
end

-- The game's own name for Mythic raids (GetDifficultyInfo(16), else PLAYER_DIFFICULTY6), lower case, or nil:
-- what an older reminder saved from the game's words reads as on a client in another language.
local function gameMythicName()
    local name
    if GetDifficultyInfo then
        local ok, n = pcall(GetDifficultyInfo, 16)
        if ok and Timeline.readable(n) and type(n) == "string" and n ~= "" then
            name = n
        end
    end
    if not name and type(PLAYER_DIFFICULTY6) == "string" and PLAYER_DIFFICULTY6 ~= "" then
        name = PLAYER_DIFFICULTY6
    end
    return name and name:lower() or nil
end

-- The difficulty group of a difficulty's name ("Mythic", "Heroic", "Normal", as notes write it, or the
-- game's own name for Mythic in the client's language): "mythic" for Mythic, "nh" for anything else.
function Timeline:GroupFor(difficultyName)
    if type(difficultyName) ~= "string" then
        return "nh"
    end
    local name = difficultyName:lower()
    if name:find("mythic", 1, true) or name == gameMythicName() then
        return "mythic"
    end
    return "nh"
end

-- The difficulty group of a run: by its difficultyID (Timeline.DifficultyGroup: 16 is Mythic), which reads
-- the same on every client language; with no readable ID (older data, a test) by the name (GroupFor), and
-- nil when there is neither.
function Timeline:GroupOf(difficultyID, difficultyName)
    if Timeline.readable(difficultyID) and type(difficultyID) == "number" then
        return Timeline.DifficultyGroup(difficultyID)
    end
    if type(difficultyName) == "string" and difficultyName ~= "" then
        return self:GroupFor(difficultyName)
    end
    return nil
end

-- The one picker of a boss's ability timeline on a difficulty group, used by the Timeline's alert flags,
-- the Rehearsal (RehearsalSourceFor), the alerts' times (Alerts/Reminders.lua), their type colours
-- (Alerts/Colors.lua) and the chosen order (OrderShift): the boss's first reference of the group, yours
-- first as Reference:List orders them. A reference with no Encounter: line is the boss's by name:
-- bossName, else the boss library's name for encounterID, else the name its pulls were saved under.
-- prefer (optional) is a Difficulty line's text ("Normal") that wins inside the group. found (optional)
-- is the boss's references a caller already read (Reference:ForBoss), so the boss is read once. The
-- entry ({ key, ref, own, ... }) or nil.
function Timeline:ReferenceFor(encounterID, group, bossName, prefer, found)
    local Reference = CRT.TimelineReference
    if not Reference then
        return nil
    end
    local name = bossName
    if type(name) ~= "string" or name == "" then
        local def = CRT.Bosses and CRT.Bosses.Get and CRT.Bosses:Get(encounterID)
        local boss = tdb().bosses and tdb().bosses[encounterID]
        name = (def and def.name) or (boss and boss.name) or nil
    end
    if type(found) ~= "table" then
        found = Reference:ForBoss(encounterID, name)
    end
    local list = Reference:ForGroup(found, group == "mythic" and "mythic" or "nh")
    if type(prefer) == "string" then
        local want = prefer:lower()
        for _, entry in ipairs(list) do
            if type(entry.ref.difficulty) == "string" and entry.ref.difficulty:lower() == want then
                return entry
            end
        end
    end
    return list[1]
end

-- For the alerts: how the raid's chosen order moves a line's time. Nil when the boss's reference for
-- the group (your own first, else the shipped one) has no Order line, or the chosen order is the
-- written one. Otherwise a function(spellID, text, t) giving t moved as Reference.PartMover moves a
-- cast of the part row the line belongs to: found by spellID, else by a row name in the text. A line
-- of no part row keeps t; a line that would run past its new window gives false. The second result,
-- unshift(spellID, text, t), is the reverse, for a time picked on the drawn timeline: back to the
-- written order, or false when t is outside the part's chosen window.
function Timeline:OrderShift(encounterID, group)
    local Reference = CRT.TimelineReference
    -- the reference the Timeline shows for the group (ReferenceFor); its Order line, if it has one
    local entry = self:ReferenceFor(encounterID, group or "nh")
    local ref = entry and entry.ref.order and entry.ref or nil
    if not ref then
        return nil
    end
    local chosen = Reference.ResolveOrder(ref, self:Order(encounterID, group))
    if Reference.OrderKey(chosen) == Reference.OrderKey(ref.order.parts) then
        return nil
    end
    local move, _, unmove = Reference.PartMover(ref, chosen)
    local function partRow(spellID, text)
        local found
        for _, row in ipairs(ref.rows) do
            if row.part and spellID and spellID ~= 0 and CRT.TimelineLanes.RowSpell(row, encounterID) == spellID then
                found = row
                break
            end
        end
        if not found and type(text) == "string" then
            local lower = text:lower()
            for _, row in ipairs(ref.rows) do
                if row.part and lower:find(row.name:lower(), 1, true) then
                    found = row
                    break
                end
            end
        end
        return found
    end
    return function(spellID, text, t)
        local row = partRow(spellID, text)
        if not row then
            return t
        end
        return move(row, t)
    end, function(spellID, text, t)
        local row = partRow(spellID, text)
        if not row then
            return t
        end
        return unmove(row, t)
    end
end

-- The name of each group, as the dropdowns and messages show it.
Timeline.GROUP_NAMES = { nh = "Normal/Heroic", mythic = "Mythic" }

-- The difficulty group a difficultyID belongs to: Mythic (16) is "mythic", every other
-- difficulty (or none) is "nh" (Normal/Heroic).
function Timeline.DifficultyGroup(difficultyID)
    return difficultyID == 16 and "mythic" or "nh"
end

local groupOf = Timeline.DifficultyGroup

-- True when a pull belongs in the asked group; no group asks for every pull.
local function inGroup(pull, group)
    return group == nil or groupOf(pull.difficultyID) == group
end

-- Saves a finished pull under its boss, numbers it, and keeps only the newest `keep` pulls of its
-- difficulty group for that boss (the other group's pulls are never dropped).
function Timeline:SavePull(pull)
    local db = tdb()
    local boss = db.bosses[pull.encounterID]
    if not boss then
        boss = { name = pull.name, pulls = {} }
        db.bosses[pull.encounterID] = boss
    end
    boss.name = pull.name or boss.name
    pull.id = db.nextId
    db.nextId = db.nextId + 1
    boss.pulls[#boss.pulls + 1] = pull
    local group = groupOf(pull.difficultyID)
    local inGroupCount = 0
    for _, p in ipairs(boss.pulls) do
        if groupOf(p.difficultyID) == group then
            inGroupCount = inGroupCount + 1
        end
    end
    local keep = db.keep or 10
    local i = 1
    while inGroupCount > keep and i <= #boss.pulls do
        if groupOf(boss.pulls[i].difficultyID) == group then
            table.remove(boss.pulls, i)
            inGroupCount = inGroupCount - 1
        else
            i = i + 1
        end
    end
    self:Fire()
    return pull.id
end

-- Every boss with saved pulls, by name. With a group, count is that group's pull count (a boss
-- with pulls only in the other group is still listed, with count 0).
function Timeline:Bosses(group)
    local list = {}
    for encounterID, boss in pairs(tdb().bosses) do
        local count = #boss.pulls
        if group then
            count = 0
            for _, pull in ipairs(boss.pulls) do
                if inGroup(pull, group) then
                    count = count + 1
                end
            end
        end
        list[#list + 1] = { encounterID = encounterID, name = boss.name or "", count = count }
    end
    table.sort(list, function(a, b)
        if a.name ~= b.name then
            return a.name < b.name
        end
        return a.encounterID < b.encounterID
    end)
    return list
end

-- A boss's pulls, newest first; with a group, only that group's pulls.
function Timeline:Pulls(encounterID, group)
    local list = {}
    local boss = tdb().bosses[encounterID]
    if boss then
        for i = #boss.pulls, 1, -1 do
            if inGroup(boss.pulls[i], group) then
                list[#list + 1] = boss.pulls[i]
            end
        end
    end
    return list
end

function Timeline:Pull(encounterID, id)
    local boss = tdb().bosses[encounterID]
    if boss then
        for _, pull in ipairs(boss.pulls) do
            if pull.id == id then
                return pull
            end
        end
    end
end

function Timeline:DeleteBoss(encounterID)
    tdb().bosses[encounterID] = nil
    self:Fire()
end

-- The deaths of pull fromID (the newest pull when nil) and of the count - 1 pulls saved before it,
-- newest first, for drawing earlier pulls' deaths over the shown one. With a group, only that
-- group's pulls are counted and walked.
function Timeline:RecentDeaths(encounterID, count, fromID, group)
    local list = {}
    local boss = tdb().bosses[encounterID]
    if not boss then
        return list
    end
    local start = #boss.pulls
    if fromID then
        start = 0
        for i, pull in ipairs(boss.pulls) do
            if pull.id == fromID then
                start = i
            end
        end
    end
    for i = start, 1, -1 do
        if #list >= count then
            break
        end
        local pull = boss.pulls[i]
        if inGroup(pull, group) then
            list[#list + 1] = { pull = pull, deaths = pull.deaths or {} }
        end
    end
    return list
end

-- Keeps the deaths whose role is switched on (a death with role "NONE" is always kept), in time
-- order with deaths of unknown time last, and cuts to the first firstDeaths when that is above 0.
function Timeline.FilterDeaths(deaths, settings)
    local kept = {}
    for _, death in ipairs(deaths) do
        local role = death.role
        if role == nil or role == "NONE" or settings.roles[role] then
            kept[#kept + 1] = death
        end
    end
    table.sort(kept, function(a, b)
        if a.t == nil or b.t == nil then
            return a.t ~= nil and b.t == nil
        end
        return a.t < b.t
    end)
    local limit = settings.firstDeaths or 0
    if limit > 0 then
        for i = #kept, limit + 1, -1 do
            kept[i] = nil
        end
    end
    return kept
end

-- Recording ---------------------------------------------------------------------------------------

local READ_DELAY = 1 -- seconds after combat ends before reading, so the meter has the whole fight
local RETRY_DELAY = 2
local RETRIES = 5

local function enum(group, key, fallback)
    local e = Enum and Enum[group]
    return (e and e[key]) or fallback
end

-- The values from the game's documentation, used if the Enum table is missing.
local CURRENT = enum("DamageMeterSessionType", "Current", 1)
local DEATHS = enum("DamageMeterType", "Deaths", 9)
local ENCOUNTER = enum("EncounterTimelineEventSource", "Encounter", 0)
local FINISHED = enum("EncounterTimelineEventState", "Finished", 2)
local CANCELED = enum("EncounterTimelineEventState", "Canceled", 3)

-- False for a secret value, which can't be compared, used as a key or added up.
local function readable(v)
    if issecretvalue then
        local ok, secret = pcall(issecretvalue, v)
        if not ok or secret then
            return false
        end
    end
    return true
end
Timeline.readable = readable

-- Seconds to a tenth (Lua 5.1 has no math.round).
local function round1(x)
    return math.floor(x * 10 + 0.5) / 10
end

local current -- the pull being recorded: its fields plus startTime and pending = { [eventID] = { dur, spellID } }
local awaiting = {} -- ended pulls waiting for combat to end before their deaths are read
local unsaved = {} -- every ended pull not yet saved (waiting, in READ_DELAY or retrying)
local done = setmetatable({}, { __mode = "k" }) -- pulls already saved, so queued callbacks skip them

function Timeline:Recording()
    return current
end

local function inRaid()
    local ok, _, kind = pcall(GetInstanceInfo)
    return ok and kind == "raid"
end

-- Role of everyone in the group, by GUID and by name.
local function groupRoles()
    local byGuid, byName = {}, {}
    local units = {}
    if IsInRaid() then
        for i = 1, GetNumGroupMembers() do
            units[#units + 1] = "raid" .. i
        end
    else
        units[1] = "player"
        for i = 1, 4 do
            units[#units + 1] = "party" .. i
        end
    end
    for _, unit in ipairs(units) do
        local ok, role = pcall(UnitGroupRolesAssigned, unit)
        if ok and type(role) == "string" and readable(role) then
            local okGuid, guid = pcall(UnitGUID, unit)
            if okGuid and readable(guid) and guid then
                byGuid[guid] = role
            end
            local okName, name = pcall(UnitName, unit)
            if okName and type(name) == "string" and readable(name) then
                byName[name] = role
            end
        end
    end
    return byGuid, byName
end

-- The spell that killed a player: the first readable spell in their death recap (the game lists
-- recap events newest first, so the first is the killing blow), else the first spell the meter
-- marks as deadly, else 0.
local function killingBlow(recapID, sourceGUID)
    local ok, events = pcall(C_DeathRecap.GetRecapEvents, recapID)
    if ok and type(events) == "table" then
        for i = 1, #events do
            local id = events[i] and events[i].spellId
            if readable(id) and id and type(id) == "number" and id > 0 then
                return id
            end
        end
    end
    if readable(sourceGUID) and sourceGUID then
        local okSrc, src = pcall(C_DamageMeter.GetCombatSessionSourceFromType, CURRENT, DEATHS, sourceGUID)
        if okSrc and type(src) == "table" and type(src.combatSpells) == "table" then
            for _, spell in ipairs(src.combatSpells) do
                local id, deadly = spell.spellID, spell.isDeadly
                if readable(deadly) and deadly and readable(id) and id and type(id) == "number" then
                    return id
                end
            end
        end
    end
    return 0
end

-- The deaths in the meter's current session. The second return is true when a name or a time was
-- still secret.
local function readDeaths()
    local deaths, secret = {}, false
    local ok, session = pcall(C_DamageMeter.GetCombatSessionFromType, CURRENT, DEATHS)
    if not ok or type(session) ~= "table" or type(session.combatSources) ~= "table" then
        return deaths, false
    end
    local byGuid, byName = groupRoles()
    for _, src in ipairs(session.combatSources) do
        local recapID = src.deathRecapID
        if readable(recapID) and recapID and type(recapID) == "number" and recapID ~= 0 then
            local death = { recapID = recapID }
            local name = src.name
            if type(name) == "string" and readable(name) then
                death.name = name
            else
                secret = true
            end
            local class = src.classFilename
            if type(class) == "string" and readable(class) then
                death.class = class
            end
            local at = src.deathTimeSeconds
            if type(at) == "number" and readable(at) and at >= 0 then
                death.t = round1(at)
            else
                secret = true
            end
            local guid = src.sourceGUID
            local role = readable(guid) and guid and byGuid[guid]
            death.role = role or (death.name and byName[death.name]) or "NONE"
            death.spellID = killingBlow(recapID, guid)
            deaths[#deaths + 1] = death
        end
    end
    return deaths, secret
end

-- Saves an ended pull once. A saved pull ignores any timer or regen callback still queued for it.
local function save(pull)
    if done[pull] then
        return
    end
    done[pull] = true
    pull.startTime = nil
    pull.pending = nil
    for i, p in ipairs(awaiting) do
        if p == pull then
            table.remove(awaiting, i)
            break
        end
    end
    for i, p in ipairs(unsaved) do
        if p == pull then
            table.remove(unsaved, i)
            break
        end
    end
    Timeline:SavePull(pull)
end

-- Reads the deaths into the ended pull and saves it, trying again while values are still secret.
local function finish(pull, attempt)
    if done[pull] then
        return
    end
    local deaths, secret = readDeaths()
    pull.deaths = deaths -- kept as the last completed read, in case a new pull forces a save
    if secret and attempt < RETRIES then
        C_Timer.After(RETRY_DELAY, function()
            finish(pull, attempt + 1)
        end)
        return
    end
    save(pull)
end

local function scheduleRead(pull)
    C_Timer.After(READ_DELAY, function()
        finish(pull, 0)
    end)
end

-- Saves every ended pull still waiting for its death read, with the deaths of its last completed
-- read. Used when new combat starts, because the meter's current session then becomes the new
-- fight's.
local function saveUnsaved()
    for i = #unsaved, 1, -1 do
        if unsaved[i] then
            save(unsaved[i])
        end
    end
end

local function startPull(encounterID, name, difficultyID)
    saveUnsaved()
    current = nil
    if not tdb().record or not inRaid() or not readable(encounterID) or type(encounterID) ~= "number" then
        return
    end
    current = {
        encounterID = encounterID,
        name = readable(name) and name or nil,
        difficultyID = readable(difficultyID) and difficultyID or nil,
        startedAt = time(),
        startTime = GetTime(),
        pending = {},
        casts = {},
        deaths = {},
    }
end

local function endPull(encounterID, success)
    local pull = current
    if not pull or not readable(encounterID) or encounterID ~= pull.encounterID then
        return
    end
    current = nil
    pull.length = round1(GetTime() - pull.startTime)
    pull.kill = readable(success) and success == 1
    if pull.length < (tdb().minPull or 15) then
        return
    end
    unsaved[#unsaved + 1] = pull
    if InCombatLockdown() then
        awaiting[#awaiting + 1] = pull
    else
        scheduleRead(pull)
    end
end

local function eventState(eventID)
    local ok, state = pcall(C_EncounterTimeline.GetEventState, eventID)
    if ok and readable(state) and state ~= nil then
        return state
    end
end

-- The driver's OnEvent body, exposed so tests can drive it.
function Timeline.HandleEvent(event, ...)
    if event == "ENCOUNTER_START" then
        startPull(...)
    elseif event == "ENCOUNTER_END" then
        local encounterID, _, _, _, success = ...
        endPull(encounterID, success)
    elseif event == "PLAYER_REGEN_DISABLED" then
        saveUnsaved()
    elseif event == "PLAYER_REGEN_ENABLED" then
        local list = awaiting
        awaiting = {}
        for _, pull in ipairs(list) do
            scheduleRead(pull)
        end
    elseif current then
        local pending = current.pending
        if event == "ENCOUNTER_TIMELINE_EVENT_ADDED" then
            local info = ...
            if type(info) == "table" and info.source == ENCOUNTER and info.id ~= nil then
                local spell = info.spellID
                pending[info.id] = { dur = info.duration, spellID = readable(spell) and spell or 0 }
            end
        elseif event == "ENCOUNTER_TIMELINE_EVENT_STATE_CHANGED" then
            local eventID = ...
            local entry = pending[eventID]
            if entry then
                local state = eventState(eventID)
                if state == FINISHED then
                    local casts = current.casts
                    casts[#casts + 1] = { t = round1(GetTime() - current.startTime), dur = entry.dur, spellID = entry.spellID }
                    pending[eventID] = nil
                elseif state == CANCELED then
                    pending[eventID] = nil
                end
            end
        elseif event == "ENCOUNTER_TIMELINE_EVENT_REMOVED" then
            local eventID = ...
            pending[eventID] = nil
        end
    end
end

local driver = CreateFrame("Frame")
for _, event in ipairs({ "ENCOUNTER_START", "ENCOUNTER_END", "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED",
    "ENCOUNTER_TIMELINE_EVENT_ADDED", "ENCOUNTER_TIMELINE_EVENT_STATE_CHANGED", "ENCOUNTER_TIMELINE_EVENT_REMOVED" }) do
    driver:RegisterEvent(event)
end
driver:SetScript("OnEvent", function(_, event, ...)
    Timeline.HandleEvent(event, ...)
end)
