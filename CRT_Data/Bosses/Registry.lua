local ADDON, CRT = ...

-- The boss library: everything the addon ships about each raid boss, in one file per boss, grouped
-- in season packs (Seasons/<season>/). Features never name a boss in their code; once every file has
-- loaded, this fills each feature's shipped table from the bosses of the loaded seasons:
--   references  -> CRT.TimelineDB.references   (Timeline reference timelines, text blocks)
--   phases      -> CRT.AlertPhaseDB[encounterID] (the alerts engine's phase triggers)
--   mechanics   -> CRT.TattleDB.bosses           (Tattlebot's tracked mechanics)
--   markers     -> CRT.MarkerDisplayDB.displays  (marker displays)
--   markerHelp  -> CRT.MarkerDisplayDB.help      (how the marker calls work on the boss, one string)
--   pace        -> CRT.PaceDB.bosses             (pace plans)
-- Two fields are read where they are used, through Bosses:Get, not copied here:
--   special     -> CRT.AlertSpecial (Alerts/Special.lua: the boss's scripted special alerts, on Mech Alerts'
--                  Special list), a list of { key, label, help, type, difficulty, default, when = { row |
--                  spellID | times (a P1 time may be before the pull: "-0:15") }, lead, icon (a spell ID),
--                  iconFile (a texture file ID), who = { mode = "everyone" | "rotation" (rotation = { { 1, 2 }, { 3, 4 } }) |
--                  "roles" (roles = { "tank", "healer" }) | "note" (note = "<label>") }, text, show, markers =
--                  { marks }, ticks = { s }, barTo = "last" | "cast", or bar = { length, ticks, start }, covers =
--                  { spellIDs } }. The full format is at the top of Alerts/Special.lua; an entry that doesn't read
--                  is skipped.
--   interrupts  -> CRT.Interrupts (Interrupts/Data.lua: the boss's kick setups, one per difficulty: groups with
--                  their raid markers and slots, and optional timing; Interrupts/Setup.lua's header has the format);
--                  a block that doesn't read is skipped.
-- Features that don't depend on a boss (the Late Tracker, Raid Groups) never read it. A season's own facts
-- that aren't about a boss (the Gear Checker's enchant, socket and season checks, the upgrade tracks, and the
-- game IDs: consumables, class cooldowns, raid buffs and class interrupts) live in a topic file each (Bosses:SeasonData) and are
-- read through their accessor (Bosses:GearChecks(), Tracks(), Consumables(), Cooldowns(), RaidBuffs(), Kicks()). Which seasons load is a dev-only choice (Dev/SeasonTools.lua, CRTDB.dev.seasons):
-- the current season only, by default, or all. See the vault note "Cowfee Raid Tools - Boss Library
-- Design".

local Bosses = { seasons = {}, bosses = {}, order = {}, topics = {}, stores = {} }
CRT.Bosses = Bosses

-- Per-boss stores ----------------------------------------------------------------------------
-- Every saved table that holds something per boss is declared here once, by the module that owns it, so the dev
-- season purge (Dev/SeasonTools.lua) clears it with the rest and a new store can't be missed:
--   Bosses:DeclareStore(label, getter, bySeason)
-- label names it in the purge's question ("recorded Timeline pulls"). getter(db) returns the table from a profile's
-- saved data (CRT.db), or nil while it isn't made. Its keys are encounter IDs, as numbers or as text (a purge
-- clears both), or season keys when bySeason is true. Long-term data, kept across seasons, is never declared: the
-- list of both kinds is above the defaults in CRT_Core/Core.lua. This file loads before every module.
function Bosses:DeclareStore(label, getter, bySeason)
    assert(type(label) == "string" and type(getter) == "function", "a store needs a label and a getter")
    local store = { label = label, getter = getter, bySeason = bySeason and true or false }
    for i, s in ipairs(self.stores) do
        if s.label == label then
            self.stores[i] = store
            return
        end
    end
    self.stores[#self.stores + 1] = store
end

-- The same for one field of a saved area, CRT.db[area][field], the usual shape.
function Bosses:DeclareField(label, area, field, bySeason)
    self:DeclareStore(label, function(db)
        local t = type(db) == "table" and db[area]
        return type(t) == "table" and t[field] or nil
    end, bySeason)
end

-- The declared stores, in the order they were declared: { { label, getter, bySeason }, ... }.
function Bosses:Stores()
    return self.stores
end

-- A season pack's description, from its Season.lua: { key, name, expansion, order, current, raids }
-- (raids is the route, below).
function Bosses:Season(def)
    assert(type(def) == "table" and type(def.key) == "string", "a season needs a key")
    self.seasons[def.key] = def
    for _, raid in ipairs(type(def.raids) == "table" and def.raids or {}) do
        for _, entry in ipairs(raid.bosses or {}) do
            self:Stub(def.key, entry)
        end
    end
end

-- A route entry's encounter ID: the entry is the ID, or { id = 3501, name = "New Boss" } for a boss with
-- no file of its own yet.
function Bosses.EntryID(entry)
    if type(entry) == "table" then
        return tonumber(entry.id)
    end
    return tonumber(entry)
end

-- A boss named only in the route ({ id, name }, added for a .5 or .7 patch with Boss order's Add boss):
-- registered with just its name and season (stub = true), so every boss list shows it. Its boss file,
-- once it has one (an ability timeline, phases, hidden abilities), replaces it, as Season.lua loads
-- first. A bare ID with no boss file stays skipped.
function Bosses:Stub(seasonKey, entry)
    local id = type(entry) == "table" and self.EntryID(entry)
    local name = type(entry) == "table" and entry.name
    if not (id and type(name) == "string" and name ~= "") or self.bosses[id] then
        return
    end
    self.bosses[id] = { encounterID = id, name = name, season = seasonKey, stub = true }
    self.order[#self.order + 1] = id
end

-- One boss, from its boss file. encounterID, name and season are required.
function Bosses:Register(def)
    assert(type(def) == "table" and type(def.encounterID) == "number", "a boss needs an encounterID")
    assert(type(def.name) == "string" and type(def.season) == "string", "a boss needs a name and a season")
    if not self.bosses[def.encounterID] then
        self.order[#self.order + 1] = def.encounterID
    end
    self.bosses[def.encounterID] = def
end

-- Season data that isn't about one boss: one file per topic in the pack's folder (Seasons/<pack>/<Topic>.lua),
-- each a Bosses:SeasonData(seasonKey, topic, data) call, listed in the .toc after the pack's Season.lua and before its boss files
-- (the store works in any order, but every pack keeps this one).
-- Each topic is read through its own accessor below (GearChecks, Tracks, Consumables, Cooldowns, RaidBuffs), never
-- by name in feature code. The packs load after every module (last in the .toc), so a reader asks its accessor when
-- it needs the data, never while its file loads. A pack
-- may also write a topic as a field of its Season.lua; the topic file wins.
function Bosses:SeasonData(seasonKey, topic, data)
    assert(type(seasonKey) == "string" and type(topic) == "string", "season data needs a season key and a topic")
    self.topics[seasonKey] = self.topics[seasonKey] or {}
    self.topics[seasonKey][topic] = data
end

-- The current season's table for a topic, or nil when it has none.
function Bosses:Topic(topic)
    local def = self:Current()
    if not def then
        return nil
    end
    local own = self.topics[def.key]
    local data = own and own[topic]
    if data == nil then
        data = def[topic]
    end
    return type(data) == "table" and data or nil
end

-- The current season's gear rules (topic gearChecks: which slots take an enchant, where an empty socket
-- counts, and the season's own checks), for the Gear Checker; nil when the season has none. Season data,
-- so a new season brings its own and no feature code names a slot rule or a season item.
function Bosses:GearChecks()
    return self:Topic("gearChecks")
end

-- The current season's upgrade tracks (topic tracks: the tracks in order, lowest first, and which bonus ID
-- puts an item on which track and rank), for the Gear Checker; nil when the season has none.
function Bosses:Tracks()
    return self:Topic("tracks")
end

-- The game IDs that change with the game, not with a boss (topic gameIDs, one file per pack: GameIDs.lua). Each
-- part is read through its own accessor below; nil when the season has none, and each reader then has nothing.
local function gameIDs(self, part)
    local ids = self:Topic("gameIDs")
    return ids and type(ids[part]) == "table" and ids[part] or nil
end

-- The consumables the ready check row and your bar know about ({ expansion, updated, foodBuffs, categories },
-- the format in Consumables/Database.lua).
function Bosses:Consumables()
    return gameIDs(self, "consumables")
end

-- The class cooldowns of the Timeline's Cooldowns row and Healer CDs view (the format in Alerts/CooldownData.lua).
function Bosses:Cooldowns()
    return gameIDs(self, "cooldowns")
end

-- The raid buffs the ready check looks for (the format above Report.BUFFS in ReadyCheck/Report.lua).
function Bosses:RaidBuffs()
    return gameIDs(self, "raidBuffs")
end

-- Each class's interrupt, for the Interrupts reminder's icon: { classes = { WARRIOR = spellID, ... }, specs =
-- { [SpecializationID] = spellID, or false for a spec with none } } (the spec's entry wins).
function Bosses:Kicks()
    return gameIDs(self, "kicks")
end

function Bosses:Get(encounterID)
    return encounterID and self.bosses[encounterID] or nil
end

-- The seasons, sorted by their order: { def, ... }.
function Bosses:Seasons()
    local out = {}
    for _, def in pairs(self.seasons) do
        out[#out + 1] = def
    end
    table.sort(out, function(a, b)
        return (a.order or 0) < (b.order or 0)
    end)
    return out
end

function Bosses:Current()
    for _, def in pairs(self.seasons) do
        if def.current then
            return def
        end
    end
end

-- The bosses of a season (or every boss), in the order their files loaded.
function Bosses:List(seasonKey)
    local out = {}
    for _, id in ipairs(self.order) do
        local def = self.bosses[id]
        if not seasonKey or def.season == seasonKey then
            out[#out + 1] = def
        end
    end
    return out
end

-- The route ----------------------------------------------------------------------------------
-- The order bosses are listed in everywhere: the raid progression route, grouped by raid. It ships in
-- each season's Season.lua as raids = { { key, name, bosses = { encounterID, ... } }, ... }, in route
-- order. The Boss order tool on the Development page (Dev/BossOrder.lua) can lay a different order over
-- it on the dev's own computer (CRTDB.dev.bossRoute[seasonKey], the same shape); it never ships.
-- Every boss list reads Route or RouteList and keeps their order: none sorts bosses itself. A boss with
-- a file but missing from the route goes at the end of the last raid, so a new boss file is never lost;
-- a route ID with no boss file is skipped, unless it is written { id = 3501, name = "New Boss" }, a boss
-- with only its name (Bosses:Stub).

local routeListeners = {}
local seasonLoaded -- defined below, with LoadMode

function Bosses:OnRouteChange(fn)
    routeListeners[#routeListeners + 1] = fn
end

function Bosses:FireRoute()
    for _, fn in ipairs(routeListeners) do
        fn()
    end
end

-- The raids of a season as written, with the dev's order over the shipped one: { { key, name, bosses } }.
function Bosses:Raids(seasonKey)
    local dev = CRT.db and CRT.db.dev and CRT.db.dev.bossRoute
    if dev and type(dev[seasonKey]) == "table" then
        return dev[seasonKey], true
    end
    local def = self.seasons[seasonKey]
    return (def and def.raids) or {}, false
end

-- One season's route: { { raid = { key, name }, bosses = { def, ... } }, ... }.
local function seasonRoute(self, seasonKey)
    local out, placed = {}, {}
    for _, raid in ipairs((self:Raids(seasonKey))) do
        local group = { raid = { key = raid.key, name = raid.name }, bosses = {} }
        for _, entry in ipairs(raid.bosses or {}) do
            self:Stub(seasonKey, entry) -- one the dev added on this computer
            local id = self.EntryID(entry)
            local def = id and self.bosses[id]
            if def and def.season == seasonKey and not placed[id] then
                placed[id] = true
                group.bosses[#group.bosses + 1] = def
            end
        end
        out[#out + 1] = group
    end
    for _, def in ipairs(self:List(seasonKey)) do
        if not placed[def.encounterID] then
            if #out == 0 then
                local season = self.seasons[seasonKey]
                out[1] = { raid = { key = seasonKey, name = season and season.name or seasonKey }, bosses = {} }
            end
            local last = out[#out].bosses
            last[#last + 1] = def
        end
    end
    return out
end

-- The route: one season's (seasonKey), or every loaded season's in season order (nil).
function Bosses:Route(seasonKey)
    if seasonKey then
        return seasonRoute(self, seasonKey)
    end
    local out = {}
    for _, season in ipairs(self:Seasons()) do
        if seasonLoaded(season.key) then
            for _, group in ipairs(seasonRoute(self, season.key)) do
                out[#out + 1] = group
            end
        end
    end
    return out
end

-- The route as one list of boss definitions, in order.
function Bosses:RouteList(seasonKey)
    local out = {}
    for _, group in ipairs(self:Route(seasonKey)) do
        for _, def in ipairs(group.bosses) do
            out[#out + 1] = def
        end
    end
    return out
end

-- A boss's place in the route (1 first), or nil when it is not a loaded boss. For callers that order
-- their own entries by it.
function Bosses:RouteIndex(encounterID)
    for i, def in ipairs(self:RouteList()) do
        if def.encounterID == encounterID then
            return i
        end
    end
end

-- The route as dropdown options for UI.Dropdown: each raid a heading (title = true), then its bosses,
-- { key = encounterID, label = name }. Only bosses in the library are listed. The first pickable key
-- is FirstKey(options).
function Bosses:Options(seasonKey)
    local out = {}
    for _, group in ipairs(self:Route(seasonKey)) do
        if #group.bosses > 0 then
            out[#out + 1] = { key = "raid:" .. tostring(group.raid.key), label = group.raid.name, title = true }
            for _, def in ipairs(group.bosses) do
                out[#out + 1] = { key = def.encounterID, label = def.name }
            end
        end
    end
    return out
end

function Bosses.FirstKey(options)
    for _, o in ipairs(options) do
        if not o.title then
            return o.key
        end
    end
end

-- Which seasons load: "current" (the default) or "all", set in the dev window.
function Bosses:LoadMode()
    local dev = CRT.db and CRT.db.dev
    return (dev and dev.seasons and dev.seasons.load) == "all" and "all" or "current"
end

seasonLoaded = function(key)
    if Bosses:LoadMode() == "all" then
        return true
    end
    local def = Bosses.seasons[key]
    return def and def.current and true or false
end

function Bosses:Loaded(encounterID)
    local def = self.bosses[encounterID]
    return def and seasonLoaded(def.season) or false
end

-- Fills each feature's shipped table from the loaded bosses, in route order, so lists built from those
-- tables (Tattlebot's mechanics) follow the route too. Runs once, after every file loads.
function Bosses:Build()
    local timeline = CRT.TimelineDB and CRT.TimelineDB.references
    local phases = CRT.AlertPhaseDB
    local tattle = CRT.TattleDB and CRT.TattleDB.bosses
    local markers = CRT.MarkerDisplayDB and CRT.MarkerDisplayDB.displays
    local markerHelp = CRT.MarkerDisplayDB and CRT.MarkerDisplayDB.help
    local pace = CRT.PaceDB and CRT.PaceDB.bosses
    for _, def in ipairs(self:RouteList()) do
        if seasonLoaded(def.season) then
            local id = def.encounterID
            if timeline then
                for _, text in ipairs(def.references or {}) do
                    -- As written: a reference names its own boss, and may give an Encounter: line.
                    timeline[#timeline + 1] = text
                end
            end
            if phases and def.phases then
                phases[id] = def.phases
            end
            if tattle and def.mechanics then
                tattle[#tattle + 1] = { boss = def.name, encounterID = id, mechanics = def.mechanics }
            end
            if markers and def.markers then
                markers[id] = def.markers
            end
            if markerHelp and type(def.markerHelp) == "string" then
                markerHelp[id] = def.markerHelp
            end
            if pace and def.pace then
                pace[id] = def.pace
            end
        end
    end
    self.built = true
end

local events = CreateFrame("Frame")
events:RegisterEvent("ADDON_LOADED")
events:SetScript("OnEvent", function(self, _, name)
    if name == ADDON then
        self:UnregisterEvent("ADDON_LOADED")
        Bosses:Build()
    end
end)
