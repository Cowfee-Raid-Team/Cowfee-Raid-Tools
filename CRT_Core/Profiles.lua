local ADDON, CRT = ...

-- Profiles. A profile is a full copy of the addon's saved data: every setting, plus the raid layouts,
-- notes, consumables lists, and the Late Tracker and Tattlebot history. The class, role and spec caches, and the
-- list of macros the addon made (Macros.lua: the game's macro list is the account's), are shared by every profile.
--
-- The active profile lives at the top of CRTDB, under the same keys as before profiles existed, so no
-- stored field moved. The others wait in CRTDB.profiles[name]. Each character remembers its profile in
-- CRTDBChar.profile (SavedVariablesPerCharacter), and a character with none uses CRTDB.defaultProfile.
-- The swap happens in CRT.Profiles:Load, as the saved data loads and before anything reads it, so
-- switching, copying or resetting a profile saves the choice and reloads the interface.
--
-- Two kinds of text to share. Export gives the whole profile (CRTP1:), which Import saves as a new
-- profile: for your own characters. Export settings only (CRTS1:, after a few # header lines) gives only
-- the paths in Profiles.SHARE below, and Import applies them onto the active profile after a preview,
-- keeping one backup (CRTDB.importBackup, so each profile has its own) for Undo last import: for raiders.
-- Both are packed and read through the share engine's parts (CRT_Core/Share.lua: Pack, Unpack, Clean, IsPlain),
-- keeping their own CRTP1: and CRTS1: prefixes, so every text made before reads as it did.

local Profiles = {}
CRT.Profiles = Profiles
local Share = CRT.Share -- CRT_Core/Share.lua, loaded just before this file

local DEFAULT = "Default"
-- whatsNew: the installed addon version is the account's, so What's new shows once whatever the profile
local SHARED = { classCache = true, roleCache = true, specCache = true, macros = true, whatsNew = true }
local EXPORT_PREFIX = "CRTP1:"
local SHARE_PREFIX = "CRTS1:"
local SHARE_VERSION = 1
local MAX_DEPTH = 5 -- a table with no default to match (a position, a list) may nest this deep
local MAX_STRING = 255 -- the longest text a shared setting may hold
local MAX_FROM = 48 -- the sender's name, as the preview shows it

local TEXT = {
    header = "# Cowfee Raid Tools settings",
    from = "# From: %s, %s, v%s",
    noApi = "This game client can't read or write profile text.",
    notOurs = "That isn't a Cowfee Raid Tools profile.",
    damaged = "The text is damaged or cut off. Copy it again.",
    newer = "This text is from a newer version of Cowfee Raid Tools. Update the addon first.",
    badValue = "The text has a wrong value for %s, so nothing was read.",
    someone = "someone",
}
Profiles.TEXT = TEXT

-- What Export settings only carries: settings and window positions, never notes, layouts, saved alerts,
-- reminders, history, caches or state, nor where your reports go, who you trust, or your own sound files.
-- true takes everything under that key, false nothing, and a table says the same one level down (and
-- may nest again). CRT_Dev/Tests/run_profiles_share.js fails when a key of CRT.defaults under a table
-- here (the top level included) is missing, so new data is never shared by accident.
Profiles.SHARE = {
    window = true, -- the main window's place and scale
    ui = true,
    lastPage = false, -- the open page
    minimap = true,
    classCache = false,
    roleCache = false,
    specCache = false,
    macros = false, -- the macros the addon made in this account's macro list
    groups = { presets = false, nextId = false, working = false, keepChanges = true, source = true, roles = false }, -- roles: guild roster data
    consumables = { enabled = true, notStarter = true, lowMinutes = true, categoryOrder = true, itemOrder = true, extra = false, learned = false, position = true },
    readycheck = {
        tab = false, auto = true, onPull = true, raidsOnly = true, notLFR = true, include = true, buffLock = true,
        fadeOnPull = true, earlyPull = true, food = true, flaskWarn = true, lowFlask = true, window = true,
        output = false, earlyPullOutput = false, -- where your reports go stays yours
    },
    debuffs = true,
    notes = {
        list = false, nextId = false, history = false, links = false, personalText = false, showOutsideRaid = true, shareTarget = true,
        window = true, assignments = true, personal = true, editor = true, alert = true,
        trustedOnly = false, -- whose notes you accept stays yours
        personalShifts = false, autoAcceptCooldowns = false, -- your own cooldown times, and whose changes you accept
    },
    qol = {
        lowHealth = {
            enabled = true, threshold = true, sound = true, soundVolume = true, soundChoice = true, soundChannel = true, soundOnce = true,
            position = true,
            customSounds = false, -- your own sound files, which a raider doesn't have
        },
        breakTimer = true,
    },
    loot = true, -- Loot History's settings only (the history is in CRTLootDB), Tooltip position and spot among them
    lootmaster = {
        window = true, popup = true, answers = true, bossLoot = true, lootingPrompt = true, responseSeconds = true, score = true,
        noRoll = true, tooltipMode = true, tooltipSpot = true, itemTooltip = true, showAllItems = true, enableInParty = true, filter = true,
        awardMessage = false, awardChannel = false, -- what you post, and where
        authority = false, -- who you trust to run loot stays yours
        sort = false,
        responses = false, -- the response buttons (saved once edited): the leader's own, kept back
    },
    gearChecker = { filter = false, belowTrack = true, popout = true, extra = true },
    sound = false, -- the names of your own sound files
    late = { days = true, hour = true, minute = true, grace = true, onlyTeam = true, history = false, nextId = false, lastAuto = false },
    tattle = {
        enabled = true, raidsOnly = true, onlyTeam = true, avoidable = true, maxPlayers = true, custom = true,
        output = false, autoPost = false, -- where and whether your reports post
        season = false, history = false, nextId = false,
    },
    timeline = {
        record = true, minPull = true, keep = true, span = true, grid = true, iconSize = true, deathRows = true, roles = true,
        firstDeaths = true, overlay = true, overlayOn = true, hideEmpty = true, popout = true, tooltipMode = true, tooltipSpot = true,
        popView = false, -- the pop-out's view: page state
        bosses = false, rows = false, references = false, nextRef = false, nextId = false,
        reviewRefs = false, -- which ability timeline is in use: your own ones' keys mean nothing on another computer
        healerRows = false, -- the Healer CDs rows you picked per player stay on this computer
    },
    team = { threshold = false, list = false, popup = true }, -- your team names (and the Season Stats saved under them) stay yours
    seasonStats = false, -- the raid's pull counters: data
    longTerm = false, -- long-term data (Core.lua): never a setting
    markers = true,
    pace = { disabled = true, shown = true, position = true, own = false, shared = false, use = false },
    alerts = {
        bars = true, areas = true, noteLines = true, customColors = true, cooldownFilter = true,
        special = true, -- your special alerts' on/off and Show as choices
        specialView = false, specialViewPicked = false, -- the page state of Mech Alerts' list
        speechNotice = false, reminders = false, phases = false, overrides = false, nextId = false, saved = false, nextSavedId = false,
        shieldPulls = false, -- last pull's shields: data
    },
    importBackup = false, -- the backup Undo last import puts back
    whatsNew = false, -- Show after updates and the last version seen: personal
}

-- Window places and sizes: "Keep my window positions" leaves these as they are. Most are saved only once
-- a window is moved, so they are not in the defaults. alerts.bars.positionV marks a bars position as
-- already moved by Alerts/Bars.lua's fix for the old window, so it travels with that position.
Profiles.POSITIONS = {
    "window.point", "window.relativePoint", "window.x", "window.y", "minimap.angle",
    "consumables.position", "readycheck.window.position", "debuffs.position",
    "notes.window.position", "notes.assignments.position", "notes.personal.position", "notes.alert.position", "notes.editor",
    "notes.window.width", "notes.window.height", "notes.assignments.width", "notes.assignments.height",
    "notes.personal.width", "notes.personal.height",
    "qol.lowHealth.position", "qol.breakTimer.position",
    "lootmaster.window", "lootmaster.popup", "lootmaster.answers", "lootmaster.bossLoot", "lootmaster.lootingPrompt", "team.popup",
    "gearChecker.popout", "timeline.popout", "markers.position", "pace.position",
    "alerts.bars.position", "alerts.bars.positionV", "alerts.areas.icons.position", "alerts.areas.texts.position", "alerts.areas.circles.position",
    "alerts.areas.timeline.position",
}

-- Settings saved only once they are set, so they have no default to match: their path and shape
-- ("number", or "colour" for { r, g, b [, a] } from 0 to 1). The guard test can't see a setting with no
-- default, so a new one is shared only when it is added here.
Profiles.LATE_SETTINGS = {
    ["ui.fontSize"] = "number", -- set from the old textSize the first time the fonts apply (Core.lua)
    ["alerts.areas.timeline.lineColor"] = "colour", -- saved once picked (Alerts/TimelineArea.lua)
}

-- What a window position may hold: the anchor points SetPoint takes, and numbers.
local ANCHORS = {
    TOPLEFT = true, TOP = true, TOPRIGHT = true, LEFT = true, CENTER = true, RIGHT = true,
    BOTTOMLEFT = true, BOTTOM = true, BOTTOMRIGHT = true,
}
local POSITION_FIELDS = {
    point = "anchor", relativePoint = "anchor", x = "number", y = "number", width = "number", height = "number", angle = "number",
    positionV = "number",
    anchor = "element", -- the key of the CRT element a place is anchored to, or frame:<name> of a frame on screen (UI/Placement.lua)
    screenX = "number", screenY = "number", -- where a place anchored to a frame sits while that frame isn't loaded
    userSized = "flag", -- a pop-out's size was chosen with its grip (UI/Window.lua)
    -- a size a pop-out keeps for one of its views, { width, height, userSized } (the Timeline's, Timeline/Page.lua)
    abilities = "size", healers = "size",
}
-- The fields a position table may hold; positionV and angle are single settings of their own.
local TABLE_FIELDS = { point = true, relativePoint = true, x = true, y = true, width = true, height = true, userSized = true,
    abilities = true, healers = true, anchor = true, screenX = true, screenY = true }
-- The fields a view's size may hold.
local SIZE_FIELDS = { width = true, height = true, userSized = true }
-- The most entries one table in a shared setting may hold. markers.disabled and pace.disabled grow by
-- one for each boss switched off, so this leaves room for many seasons of bosses.
local MAX_LIST = 200

-- A string value naming one of your own sound files (Sound/Engine.lua's "file:" keys) is never shared.
local function ownFile(v)
    return type(v) == "string" and v:find("^file:") ~= nil
end

-- Shared but not listed in the import preview: bookkeeping, not a setting anyone picks.
local QUIET = { ["alerts.bars.positionV"] = true }

-- The diff preview names a setting by its page, then its saved path.
local SECTIONS = {
    window = "Main window", ui = "General", minimap = "Minimap", groups = "Raid Groups", consumables = "Consumables",
    readycheck = "Ready Check", debuffs = "Debuffs", notes = "Raid Notes", qol = "Quality of Life", loot = "Loot History",
    lootmaster = "Loot Master", gearChecker = "Gear Checker", sound = "Sounds", late = "Late Tracker", tattle = "Tattlebot",
    timeline = "Timeline", markers = "Markers", pace = "Pace", alerts = "Alerts", team = "Team raids",
}

-- The top-level keys a profile holds: every key in the defaults, except the shared caches.
local function profileKeys()
    local keys = {}
    for key in pairs(CRT.defaults) do
        if not SHARED[key] then
            keys[#keys + 1] = key
        end
    end
    return keys
end

local function deepCopy(value)
    if type(value) ~= "table" then
        return value
    end
    local out = {}
    for k, v in pairs(value) do
        out[k] = deepCopy(v)
    end
    return out
end

-- Takes the active profile's data off the top of CRTDB, as a table.
local function takeActive(db)
    local data = {}
    for _, key in ipairs(profileKeys()) do
        data[key] = db[key]
        db[key] = nil
    end
    return data
end

-- Puts a profile's data at the top of CRTDB. Missing keys are filled from the defaults afterwards.
local function putActive(db, data)
    for _, key in ipairs(profileKeys()) do
        db[key] = data and data[key] or nil
    end
end

-- Called from Core.lua on ADDON_LOADED, before the defaults are filled in.
function Profiles:Load()
    local db = CRTDB
    CRTDBChar = CRTDBChar or {}
    db.profiles = db.profiles or {}
    db.activeProfile = db.activeProfile or DEFAULT
    db.defaultProfile = db.defaultProfile or DEFAULT
    local want = CRTDBChar.profile or db.defaultProfile
    if want ~= db.activeProfile then
        db.profiles[db.activeProfile] = takeActive(db)
        putActive(db, db.profiles[want])
        db.profiles[want] = nil
        db.activeProfile = want
    end
    CRTDBChar.profile = want
end

function Profiles:Current()
    return CRTDB.activeProfile or DEFAULT
end

function Profiles:Default()
    return CRTDB.defaultProfile or DEFAULT
end

function Profiles:SetDefault(name)
    if self:Exists(name) then
        CRTDB.defaultProfile = name
    end
end

function Profiles:Exists(name)
    return name == self:Current() or CRTDB.profiles[name] ~= nil
end

-- Every profile's name, sorted, with the active one included.
function Profiles:List()
    local names = { self:Current() }
    for name in pairs(CRTDB.profiles) do
        if name ~= self:Current() then
            names[#names + 1] = name
        end
    end
    table.sort(names, function(a, b)
        return a:lower() < b:lower()
    end)
    return names
end

-- Every profile except the active one, as dropdown options.
function Profiles:Others()
    local out = {}
    for _, name in ipairs(self:List()) do
        if name ~= self:Current() then
            out[#out + 1] = { key = name, label = name }
        end
    end
    return out
end

function Profiles:All()
    local out = {}
    for _, name in ipairs(self:List()) do
        out[#out + 1] = { key = name, label = name }
    end
    return out
end

-- Switches this character to a profile, new or existing, and reloads.
function Profiles:Switch(name)
    name = strtrim(name or "")
    if name == "" or name == self:Current() then
        return
    end
    if not CRTDB.profiles[name] then
        CRTDB.profiles[name] = {} -- a new profile starts from the defaults
    end
    CRTDBChar.profile = name
    ReloadUI()
end

-- Replaces the active profile's data with a copy of another profile's, and reloads.
function Profiles:CopyFrom(name)
    local source = CRTDB.profiles[name]
    if not source then
        return
    end
    putActive(CRTDB, deepCopy(source))
    CRTDB.importBackup = {} -- the other profile's backup would undo to its settings, not this one's
    ReloadUI()
end

-- Puts the active profile back to the defaults, and reloads.
function Profiles:Reset()
    putActive(CRTDB, nil)
    ReloadUI()
end

-- Deletes a profile that isn't active. A character that used it starts on the default profile, and a
-- deleted default profile becomes the active one.
function Profiles:Delete(name)
    if name == self:Current() or not CRTDB.profiles[name] then
        return
    end
    CRTDB.profiles[name] = nil
    if CRTDB.defaultProfile == name then
        CRTDB.defaultProfile = self:Current()
    end
end

-- The active profile as one line of text to share, through the game's own CBOR, deflate and base64.
-- The import backup stays behind: it would undo to another character's settings. So does the raid notes'
-- history (notes.history): the earlier texts stay on this computer.
function Profiles:Export()
    if not Share.Encoder() then
        return nil, "This game client can't export profiles."
    end
    local data = {}
    for _, key in ipairs(profileKeys()) do
        if key == "notes" and type(CRTDB.notes) == "table" then
            local notes = {}
            for k, v in pairs(CRTDB.notes) do
                if k ~= "history" then
                    notes[k] = v
                end
            end
            data.notes = notes
        elseif key ~= "importBackup" then
            data[key] = CRTDB[key]
        end
    end
    -- the game's default compression, as every CRTP1: text was made
    local text = Share.Pack({ v = 1, data = data })
    if not text then
        return nil, "The profile couldn't be exported."
    end
    return EXPORT_PREFIX .. text
end

-- Pasted text without its # header lines and without the spaces and line breaks a paste can add.
local function cleanText(text)
    return Share.Clean(text)
end

local function decodeFull(text)
    text = cleanText(text)
    if text:sub(1, #EXPORT_PREFIX) ~= EXPORT_PREFIX then
        return nil, "That isn't a Cowfee Raid Tools profile."
    end
    local decoded = Share.Unpack(text:sub(#EXPORT_PREFIX + 1))
    if type(decoded) ~= "table" or type(decoded.data) ~= "table" then
        return nil, "The profile text is damaged. Copy it again."
    end
    local data = {}
    for _, key in ipairs(profileKeys()) do
        if key ~= "importBackup" and type(decoded.data[key]) == type(CRT.defaults[key]) then
            data[key] = decoded.data[key]
        end
    end
    return data
end

-- Reads an exported profile and saves it as a new profile. Returns true, or nil and the reason.
function Profiles:Import(text, name)
    name = strtrim(name or "")
    if name == "" then
        return nil, "Give the new profile a name."
    end
    if self:Exists(name) then
        return nil, "A profile named " .. name .. " already exists."
    end
    local data, err = decodeFull(text)
    if not data then
        return nil, err
    end
    CRTDB.profiles[name] = data
    return true
end

-- Export settings only. ---------------------------------------------------------------------------

local function encoder()
    return Share.Encoder()
end

local function splitPath(path)
    local keys = {}
    for key in path:gmatch("[^.]+") do
        keys[#keys + 1] = key
    end
    return keys
end

local function getPath(t, keys)
    for _, key in ipairs(keys) do
        if type(t) ~= "table" then
            return nil
        end
        t = t[key]
    end
    return t
end

-- Sets a value, making the tables on the way. Clearing a value never makes them.
local function setPath(t, keys, value)
    for i = 1, #keys - 1 do
        if type(t[keys[i]]) ~= "table" then
            if value == nil then
                return
            end
            t[keys[i]] = {}
        end
        t = t[keys[i]]
    end
    t[keys[#keys]] = value
end

local function same(a, b)
    if type(a) ~= type(b) then
        return false
    end
    if type(a) ~= "table" then
        return a == b
    end
    for k, v in pairs(a) do
        if not same(v, b[k]) then
            return false
        end
    end
    for k in pairs(b) do
        if a[k] == nil then
            return false
        end
    end
    return true
end

-- Only plain saved data: true or false, a finite number, a short text, or a table of those, keyed by
-- text or number, at most MAX_DEPTH deep and MAX_LIST entries wide (the share engine's check, with these caps).
local PLAIN = { depth = MAX_DEPTH, entries = MAX_LIST, string = MAX_STRING }
local function isPlain(v, depth)
    return Share.IsPlain(v, PLAIN, depth)
end

local function isField(kind, v)
    if kind == "anchor" then
        return ANCHORS[v] == true
    end
    if kind == "flag" then
        return type(v) == "boolean"
    end
    if kind == "element" then
        -- an element's key, or frame: and a frame's global name
        return type(v) == "string" and #v <= 80 and (v:find("^[%w_]+$") ~= nil or v:find("^frame:[%w_]+$") ~= nil)
    end
    if kind == "size" then
        if type(v) ~= "table" then
            return false
        end
        for k, x in pairs(v) do
            if not (SIZE_FIELDS[k] and isField(POSITION_FIELDS[k], x)) then
                return false
            end
        end
        return true
    end
    return type(v) == "number" and isPlain(v, 1)
end

-- A position: a single field (window.point, window.x, minimap.angle) or a table of point, relativePoint,
-- x, y, width and height (and a pop-out's userSized and its views' sizes, and the key of the element a place is
-- anchored to), each an anchor name, a number, true or false, an element's key, or a view's { width, height, userSized }. A field this version doesn't know (a newer
-- one's) is left out and counted; a known field with a bad value rejects it.
-- Returns ok, the value to use, and how many fields were left out.
local function isPosition(entry, v)
    local kind = POSITION_FIELDS[entry.keys[#entry.keys]]
    if kind then
        return isField(kind, v), v, 0
    end
    if type(v) ~= "table" then
        return false
    end
    local out, dropped = {}, 0
    for k, x in pairs(v) do
        if not TABLE_FIELDS[k] then
            dropped = dropped + 1
        elseif isField(POSITION_FIELDS[k], x) then
            out[k] = x
        else
            return false
        end
    end
    return true, out, dropped
end

-- A list default ({ r, g, b, a }): the same length or shorter, every entry of the first one's type.
local function isList(default, v)
    if type(v) ~= "table" then
        return false
    end
    local want = type(default[1])
    for k, x in pairs(v) do
        if type(k) ~= "number" or k < 1 or k > #default or k % 1 ~= 0 or type(x) ~= want or not isPlain(x, 2) then
            return false
        end
    end
    return true
end

local function isColour(v)
    if type(v) ~= "table" or #v < 3 then
        return false
    end
    for k, x in pairs(v) do
        if type(k) ~= "number" or k < 1 or k > 4 or k % 1 ~= 0 or type(x) ~= "number" or x < 0 or x > 1 then
            return false
        end
    end
    return true
end

-- ui.layers: each layer set to one of UI.STRATA (UI/Panel.lua). A layer key this version doesn't have
-- (a newer one's) is left out and counted; a strata the game doesn't have rejects it.
local function isLayers(v)
    local UI = CRT.UI
    if type(v) ~= "table" or not (UI and UI.LAYERS and UI.STRATA) then
        return false
    end
    local layers, strata = {}, {}
    for _, layer in ipairs(UI.LAYERS) do
        layers[layer.key] = true
    end
    for _, s in ipairs(UI.STRATA) do
        strata[s.key] = true
    end
    local out, dropped = {}, 0
    for k, x in pairs(v) do
        if not strata[x] then
            return false
        elseif layers[k] then
            out[k] = x
        else
            dropped = dropped + 1
        end
    end
    return true, out, dropped
end

-- debuffs.ignored: { [spellID] = true }, each key a positive whole number. Anything else rejects it.
local function isSpellSet(v)
    if type(v) ~= "table" then
        return false
    end
    for k, x in pairs(v) do
        if type(k) ~= "number" or k < 1 or k % 1 ~= 0 or k > 2147483647 or x ~= true then
            return false
        end
    end
    return true, v, 0
end

-- Shared settings with a shape of their own, by path.
local SHAPES = { ["ui.layers"] = isLayers, ["debuffs.ignored"] = isSpellSet }

-- A shared value must be plain and of its default's type, at every level: a list default's entries
-- too, and a position, ui.layers or a late setting by its own shape. A table that starts empty (a map,
-- an order) has no default inside to match, so only plainness is checked there.
-- Returns ok, the value to use (a position or ui.layers without the parts this version doesn't know),
-- and how many such parts were left out.
local function isValid(entry, v)
    if not isPlain(v, 1) then
        return false
    end
    if entry.position then
        return isPosition(entry, v)
    end
    if SHAPES[entry.path] then
        return SHAPES[entry.path](v)
    end
    local ok
    if entry.want == "colour" then
        ok = isColour(v)
    else
        local want = entry.want or (entry.default ~= nil and type(entry.default)) or nil
        ok = not (want and type(v) ~= want)
        if ok and type(entry.default) == "table" and entry.default[1] ~= nil then
            ok = isList(entry.default, v)
        end
    end
    return ok, v, 0
end

-- Whether a path is under a true in Profiles.SHARE.
local function allowed(keys)
    local rule = Profiles.SHARE
    for _, key in ipairs(keys) do
        if rule == true then
            return true
        end
        if type(rule) ~= "table" then
            return false
        end
        rule = rule[key]
    end
    return rule == true
end

local entriesCache

local function addEntries(list, seen, positions, keys, default, rule)
    local path = table.concat(keys, ".")
    if positions[path] then
        list[#list + 1] = { path = path, keys = keys, default = default, position = true }
        seen[path] = true
        return
    end
    if not rule then
        return
    end
    -- a list (a colour's { r, g, b, a }) is copied whole, like an empty table
    if type(default) == "table" and (type(rule) == "table" or (next(default) ~= nil and default[1] == nil)) then
        for k, v in pairs(default) do
            local sub = rule == true or rule[k]
            if sub then
                local child = {}
                for i, key in ipairs(keys) do
                    child[i] = key
                end
                child[#child + 1] = k
                addEntries(list, seen, positions, child, v, sub)
            end
        end
        return
    end
    list[#list + 1] = { path = path, keys = keys, default = default }
    seen[path] = true
end

-- Every shared setting, one entry per value copied: { path, keys, default, position, want }, sorted by path.
-- A table that starts empty in the defaults (a list, a map) and a position are copied whole.
function Profiles.ShareEntries()
    if entriesCache then
        return entriesCache
    end
    local list, seen, positions = {}, {}, {}
    for _, path in ipairs(Profiles.POSITIONS) do
        positions[path] = true
    end
    for key, default in pairs(CRT.defaults) do
        addEntries(list, seen, positions, { key }, default, Profiles.SHARE[key])
    end
    for _, path in ipairs(Profiles.POSITIONS) do
        local keys = splitPath(path)
        if not seen[path] and allowed(keys) then
            list[#list + 1] = { path = path, keys = keys, position = true }
            seen[path] = true
        end
    end
    for path, want in pairs(Profiles.LATE_SETTINGS) do
        local keys = splitPath(path)
        if not seen[path] and allowed(keys) then
            list[#list + 1] = { path = path, keys = keys, want = want }
            seen[path] = true
        end
    end
    table.sort(list, function(a, b)
        return a.path < b.path
    end)
    entriesCache = list
    return list
end

local function uncovered(missing, defaults, rules, prefix)
    for key, default in pairs(defaults) do
        local rule, path = rules[key], prefix .. key
        if rule == nil then
            missing[#missing + 1] = path
        elseif type(rule) == "table" and type(default) == "table" then
            uncovered(missing, default, rule, path .. ".")
        end
    end
end

-- The saved keys Profiles.SHARE says nothing about: a key of the defaults at the top level or under a
-- table rule. The test suite fails on any, so each new key is shared or kept back on purpose.
function Profiles.ShareUncovered()
    local missing = {}
    uncovered(missing, CRT.defaults, Profiles.SHARE, "")
    table.sort(missing)
    return missing
end

local function playerName()
    local ok, name = pcall(UnitName, "player")
    if not ok or type(name) ~= "string" or (issecretvalue and issecretvalue(name)) then
        return TEXT.someone
    end
    return name
end

-- The active profile's shared settings as text: the # header lines, then CRTS1: and the block.
-- Positions never moved are listed in unset, so an import can put them back to their default. Returns
-- the text and how many saved values were left out for not having their default's shape (0 normally);
-- a choice of one of your own sound files is left out without counting.
function Profiles:ExportSettings()
    if not encoder() then
        return nil, TEXT.noApi
    end
    local data, unset, dropped = {}, {}, 0
    for _, entry in ipairs(Profiles.ShareEntries()) do
        local v = getPath(CRTDB, entry.keys)
        if v == nil then
            if entry.position then
                unset[#unset + 1] = entry.path
            end
        else
            local ok, clean = isValid(entry, v)
            if not ok then
                dropped = dropped + 1
            elseif not ownFile(clean) then
                setPath(data, entry.keys, deepCopy(clean))
            end
        end
    end
    local name, day, version = playerName(), date("%Y-%m-%d"), tostring(CRT.version or "dev")
    local payload = { v = SHARE_VERSION, kind = "settings", from = name, date = day, version = version, data = data, unset = unset }
    local block = Share.Pack(payload, Share.ZLIB)
    if not block then
        return nil, TEXT.damaged
    end
    return TEXT.header .. "\n" .. TEXT.from:format(name, day, version) .. "\n" .. SHARE_PREFIX .. block, dropped
end

-- Walks the received data beside the shared entries: counts what CRT doesn't share (skipped) and
-- returns the path of the first value of the wrong type, if any.
local function scan(node, prefix, known, inner)
    local unknown = 0
    for k, v in pairs(node) do
        local path = type(k) == "string" and (prefix == "" and k or prefix .. "." .. k) or nil
        if path and known[path] then
            local ok, clean, n = isValid(known[path], v)
            if not ok then
                return unknown, path
            end
            node[k] = clean -- without the parts this version doesn't know (an existing key: safe in pairs)
            unknown = unknown + n
        elseif path and inner[path] then
            if type(v) ~= "table" then
                return unknown, path
            end
            local n, bad = scan(v, path, known, inner)
            unknown = unknown + n
            if bad then
                return unknown, bad
            end
        else
            unknown = unknown + 1
        end
    end
    return unknown
end

local function cleanName(from)
    if type(from) ~= "string" then
        return TEXT.someone
    end
    from = from:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("|", ""):sub(1, MAX_FROM)
    return from ~= "" and from or TEXT.someone
end

local function readSettings(text)
    if not encoder() then
        return nil, TEXT.noApi
    end
    local payload = Share.Unpack(text:sub(#SHARE_PREFIX + 1), Share.ZLIB)
    if type(payload) ~= "table" or type(payload.v) ~= "number" then
        return nil, TEXT.damaged
    end
    if payload.v > SHARE_VERSION then
        return nil, TEXT.newer
    end
    if payload.kind ~= "settings" or type(payload.data) ~= "table" then
        return nil, TEXT.damaged
    end
    local known, inner = {}, {}
    for _, entry in ipairs(Profiles.ShareEntries()) do
        known[entry.path] = entry
        for i = 1, #entry.keys - 1 do
            inner[table.concat(entry.keys, ".", 1, i)] = true
        end
    end
    local unknown, bad = scan(payload.data, "", known, inner)
    if bad then
        return nil, TEXT.badValue:format(bad)
    end
    local info = { kind = "settings", from = cleanName(payload.from), values = {}, unset = {}, unknown = unknown }
    for _, entry in ipairs(Profiles.ShareEntries()) do
        local v = getPath(payload.data, entry.keys)
        if ownFile(v) then
            info.unknown = info.unknown + 1 -- the sender's own sound file: this computer doesn't have it
        elseif v ~= nil then
            info.values[entry.path] = v
        end
    end
    for _, path in ipairs(type(payload.unset) == "table" and payload.unset or {}) do
        if known[path] and known[path].position and info.values[path] == nil then
            info.unset[path] = true
        else
            info.unknown = info.unknown + 1
        end
    end
    return info
end

-- Reads pasted text without changing anything. Returns { kind = "settings", from, values, unset,
-- unknown } for a settings string, { kind = "full", parts } for a whole profile, or nil and the reason.
function Profiles:Read(text)
    text = cleanText(text)
    if text:sub(1, #SHARE_PREFIX) == SHARE_PREFIX then
        return readSettings(text)
    end
    if text:sub(1, #EXPORT_PREFIX) ~= EXPORT_PREFIX then
        return nil, TEXT.notOurs
    end
    if not encoder() then
        return nil, TEXT.noApi
    end
    local data, err = decodeFull(text)
    if not data then
        return nil, err
    end
    local parts = 0
    for _ in pairs(data) do
        parts = parts + 1
    end
    return { kind = "full", parts = parts }
end

local function label(entry)
    local keys = entry.keys
    local out = { SECTIONS[keys[1]] or keys[1] }
    for i = 2, #keys do
        out[#out + 1] = tostring(keys[i])
    end
    return table.concat(out, " > ")
end

local function shown(v)
    if v == nil then
        return "default"
    elseif v == true then
        return "on"
    elseif v == false then
        return "off"
    end
    return (tostring(v):gsub("|", "||")) -- a | shows as itself, never as a colour or link code
end

-- What an import would change on the active profile, in path order: { path, text } with text
-- "label: old -> new" ("label: changed" for a table, "label: back to default" when it is cleared).
function Profiles:Diff(info, keepPositions)
    local out = {}
    for _, entry in ipairs(Profiles.ShareEntries()) do
        if not (keepPositions and entry.position) and not QUIET[entry.path] and (info.values[entry.path] ~= nil or info.unset[entry.path]) then
            local old, new = getPath(CRTDB, entry.keys), info.values[entry.path]
            if not same(old, new) then
                local text
                if new == nil then
                    text = label(entry) .. ": back to default"
                elseif type(old) == "table" or type(new) == "table" then
                    text = label(entry) .. ": changed"
                else
                    text = label(entry) .. ": " .. shown(old) .. " -> " .. shown(new)
                end
                out[#out + 1] = { path = entry.path, text = text }
            end
        end
    end
    return out
end

-- Puts values (path -> value) and unset paths (path -> true) onto the active profile. A backup (exact)
-- goes back as it was saved, without the import's checks: it came from this profile.
local function put(values, unset, keepPositions, exact)
    for _, entry in ipairs(Profiles.ShareEntries()) do
        if not (keepPositions and entry.position) then
            local v = values[entry.path]
            if v == nil then
                if unset[entry.path] then
                    setPath(CRTDB, entry.keys, nil)
                end
            else
                local ok, clean = exact, v
                if not exact then
                    ok, clean = isValid(entry, v)
                end
                if ok then
                    setPath(CRTDB, entry.keys, deepCopy(clean))
                end
            end
        end
    end
end

-- Applies a read settings string onto the active profile: first one backup of every shared setting as it
-- is now (replacing the last), then the values, then a reload.
function Profiles:ApplySettings(info, keepPositions)
    local backup = { from = info.from, saved = time and time() or 0, values = {}, unset = {} }
    for _, entry in ipairs(Profiles.ShareEntries()) do
        local v = getPath(CRTDB, entry.keys)
        if v == nil then
            backup.unset[entry.path] = true
        else
            backup.values[entry.path] = deepCopy(v)
        end
    end
    CRTDB.importBackup = backup
    put(info.values, info.unset, keepPositions)
    ReloadUI()
end

function Profiles:HasBackup()
    local b = CRTDB and CRTDB.importBackup
    return type(b) == "table" and type(b.values) == "table" and next(b.values) ~= nil
end

-- Whose import the backup was taken before, for the Undo question.
function Profiles:BackupFrom()
    return self:HasBackup() and cleanName(CRTDB.importBackup.from) or nil
end

-- Puts back the settings from before the last import, forgets the backup, and reloads.
function Profiles:UndoImport()
    if not self:HasBackup() then
        return
    end
    local b = CRTDB.importBackup
    put(b.values, type(b.unset) == "table" and b.unset or {}, false, true)
    CRTDB.importBackup = {}
    ReloadUI()
end
