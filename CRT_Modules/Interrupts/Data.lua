local ADDON, CRT = ...

-- Interrupts: kick numbers above a boss's adds, a reminder before your own kick, and a kick list the raid leader
-- shares (CRT.Interrupts). An optional module, off for everyone until they tick Enable Interrupts on General
-- Settings (CRTDB.interrupts.enabled); off, nothing of it runs and nothing of Notes, Alerts or Timeline is touched.
-- This file holds the kick setups in use, the kick lists, your number, the switch and the settings:
--   Setup.lua     a setup's format (groups, raid markers, slots, optional timing) and the shape a share carries
--   Lattice.lua   a timed setup's numbering;  Anchor.lua  each wave's anchor, or the fallback times from the pull
--   Plates.lua    the numbers above the adds' nameplates (by timing, or by raid marker for an untimed setup)
--   Reminder.lua  the countdown before your kick, or "Your kick next" for an untimed setup
--   Comm.lua      sharing the list;  NoteBlock.lua  the list in the raid note;  Page.lua, PageGrid.lua and
--   SetupEditor.lua  the page
--
-- A setup is one boss on one difficulty, named by its key "encounterID:difficultyID" (Interrupts.Key). The setup in
-- use for a key is, in order: the shape the raid's list came in, while that list is in use and its shape didn't fit
-- the setup here (a leader's own setup reaches raiders who have the shipped one, or none); the player's own (Edit
-- setup: CRTDB.interrupts.setups[encounterID][difficultyID], always untimed); the boss file's
-- (Bosses:Get(id).interrupts). A timed shipped setup can't be replaced by your own (its lattice would be lost). Every function taking a key also takes a bare
-- encounter ID, for the boss's first setup.
--
-- A kick list is names without realm per group key, "" for an empty slot, kept per boss and difficulty in
-- CRTDB.interrupts.kicks[encounterID][difficultyID] = { own = { [groupKey] = { names } }, shared = { lists =
-- { [groupKey] = { names } }, from, at, setup }, use }: your own list, the raid's (from a share or the raid note) and
-- use = "own" while you switched to your own. The functions here hand lists out in the setup's group order,
-- list[group][slot]. The list in use is the raid's while there is one, unless you switched to your own; a new share
-- always switches you back. Editing your own puts it in use. Your number is the slot your name is in, in the list in
-- use, and your group the column's heading.
--
-- The lists from before setups had groups (own, shared and use[encounterID], groups in order Left, Right) are read
-- once into kicks, for the boss's first setup with as many groups, the first time a boss's lists are asked for. The
-- old fields are left as they were.

local Interrupts = { listeners = {}, shipped = {} }
CRT.Interrupts = Interrupts

Interrupts.TEXT = {
    timed = "This boss's kick numbers come from its timing, so its setup can't be changed here.",
}

local Setup = CRT.InterruptSetup

local function db()
    local d = CRT.db.interrupts
    -- the two tables setups brought: in Core.lua's defaults, made here for saved data loaded without them
    d.kicks = type(d.kicks) == "table" and d.kicks or {}
    d.setups = type(d.setups) == "table" and d.setups or {}
    return d
end

-- The saved tables kept per boss, declared for the dev season purge (Bosses:DeclareStore, CRT_Data/Bosses/Registry.lua).
if CRT.Bosses and CRT.Bosses.DeclareField then
    CRT.Bosses:DeclareField("own kick lists", "interrupts", "own")
    CRT.Bosses:DeclareField("shared kick lists", "interrupts", "shared")
    CRT.Bosses:DeclareField("kick list choices", "interrupts", "use")
    CRT.Bosses:DeclareField("kick lists", "interrupts", "kicks")
    CRT.Bosses:DeclareField("your kick setups", "interrupts", "setups")
end

local readable = CRT.Comm.Readable -- false for nil and for a secret

function Interrupts:OnChange(fn)
    self.listeners[#self.listeners + 1] = fn
end

-- what says what changed: "enabled" for the switch, "list" for a kick list (key and source, "own" for your own
-- edits, "raid" for a share or the raid note), "setup" for a setup of your own, "settings" for the rest.
function Interrupts:Fire(what, ...)
    for _, fn in ipairs(self.listeners) do
        local ok, err = pcall(fn, what, ...)
        if not ok and geterrorhandler then
            geterrorhandler()(err)
        end
    end
end

function Interrupts:Settings()
    return db()
end

function Interrupts:Enabled()
    return CRT.db ~= nil and db().enabled == true
end

function Interrupts:SetEnabled(on)
    db().enabled = on and true or false
    if CRT.UI and CRT.UI.SetPageHidden then
        CRT.UI:SetPageHidden("interrupts", not db().enabled)
    end
    self:Fire("enabled")
end

-- Setups -------------------------------------------------------------------------------------------------------------

function Interrupts.Key(encounterID, difficulty)
    return tostring(encounterID) .. ":" .. tostring(difficulty)
end

-- A key's encounter ID and difficulty ID (nil for a bare encounter ID).
function Interrupts.SplitKey(key)
    if type(key) == "number" then
        return key, nil
    end
    if type(key) ~= "string" then
        return nil, nil
    end
    local id, diff = key:match("^(%d+):(%d+)$")
    return tonumber(id), tonumber(diff)
end

-- Mythic first, then Heroic, Normal and Looking For Raid, then any other.
local DIFFICULTY_ORDER = { [16] = 1, [15] = 2, [14] = 3, [17] = 4 }
local function byDifficulty(a, b)
    local ra, rb = DIFFICULTY_ORDER[a.difficulty] or 9, DIFFICULTY_ORDER[b.difficulty] or 9
    if ra ~= rb then
        return ra < rb
    end
    return a.difficulty < b.difficulty
end

-- The boss file's setups, read once (Setup.Read): a list, empty for a boss with none or a block that doesn't read.
local function shipped(encounterID)
    local cached = Interrupts.shipped[encounterID]
    if cached == nil then
        local boss = CRT.Bosses and CRT.Bosses:Get(encounterID)
        cached = boss and boss.interrupts and Setup.Read(boss.interrupts) or {}
        Interrupts.shipped[encounterID] = cached
    end
    return cached
end

local function shippedFor(encounterID, difficulty)
    for _, s in ipairs(shipped(encounterID)) do
        if s.difficulty == difficulty then
            return s
        end
    end
    return nil
end

local function byBossDiff(tbl, encounterID, difficulty)
    local boss = type(tbl) == "table" and tbl[encounterID]
    local v = type(boss) == "table" and boss[difficulty]
    return type(v) == "table" and v or nil
end

-- A saved untimed setup ({ label, spell, groups }) as a setup for that difficulty, or nil.
local function readSaved(raw, difficulty)
    if type(raw) ~= "table" then
        return nil
    end
    return (Setup.ReadOne({ difficulty = difficulty, label = raw.label, spell = raw.spell, groups = raw.groups }))
end

local function customFor(encounterID, difficulty)
    return readSaved(byBossDiff(db().setups, encounterID, difficulty), difficulty)
end

-- The shape the raid's list came in, and whether that list is in use (not when you switched to your own).
local function sharedFor(encounterID, difficulty)
    local e = byBossDiff(db().kicks, encounterID, difficulty)
    if not (e and type(e.shared) == "table") then
        return nil, false
    end
    return readSaved(e.shared.setup, difficulty), e.use ~= "own"
end

-- The difficulties a boss has a setup for, of any kind.
local function difficulties(encounterID)
    local seen, out = {}, {}
    local function add(d)
        if type(d) == "number" and not seen[d] then
            seen[d] = true
            out[#out + 1] = d
        end
    end
    for _, s in ipairs(shipped(encounterID)) do
        add(s.difficulty)
    end
    for _, tbl in ipairs({ db().setups, db().kicks }) do
        local boss = type(tbl) == "table" and tbl[encounterID]
        for d in pairs(type(boss) == "table" and boss or {}) do
            add(d)
        end
    end
    return out
end

-- The setup in use for one boss and difficulty: the raid's list's own shape while it is in use, else your own, else
-- the boss file's.
local function setupFor(encounterID, difficulty)
    local shared, inUse = sharedFor(encounterID, difficulty)
    if shared and inUse then
        return shared
    end
    -- with no setup of its own here, the share's shape stays the boss's setup
    return customFor(encounterID, difficulty) or shippedFor(encounterID, difficulty) or shared
end

-- A boss's own setups, Mythic first: your own or the boss file's per difficulty, never a share's shape (Export).
function Interrupts:OwnedSetups(encounterID)
    local out = {}
    for _, d in ipairs(type(encounterID) == "number" and difficulties(encounterID) or {}) do
        local s = customFor(encounterID, d) or shippedFor(encounterID, d)
        if s then
            out[#out + 1] = s
        end
    end
    table.sort(out, byDifficulty)
    return out
end

-- A boss's setups in use, Mythic first: { setup, ... }.
function Interrupts:Setups(encounterID)
    local out = {}
    if type(encounterID) ~= "number" then
        return out
    end
    for _, d in ipairs(difficulties(encounterID)) do
        local s = setupFor(encounterID, d)
        if s then
            out[#out + 1] = s
        end
    end
    table.sort(out, byDifficulty)
    return out
end

-- A key as "encounterID:difficultyID", the setup in use for it, its encounter ID and difficulty; nil when it has none.
-- A bare encounter ID is the boss's first setup.
function Interrupts:Resolve(key)
    local id, diff = self.SplitKey(key)
    if not id then
        return nil
    end
    local def
    if diff then
        def = setupFor(id, diff)
    else
        def = self:Setups(id)[1]
        diff = def and def.difficulty
    end
    if not def then
        return nil
    end
    return self.Key(id, diff), def, id, diff
end

-- The setup in use for a key, or nil.
function Interrupts:Def(key)
    local _, def = self:Resolve(key)
    return def
end

-- The boss file's setup for a key (whatever is in use), or nil.
function Interrupts:ShippedDef(key)
    local id, diff = self.SplitKey(key)
    if id and not diff then
        local first = shipped(id)[1]
        return first
    end
    return id and shippedFor(id, diff) or nil
end

-- Whether a key's setup in use is your own.
function Interrupts:IsCustom(key)
    local id, diff = self.SplitKey(key)
    return id ~= nil and diff ~= nil and customFor(id, diff) ~= nil
end

-- Saves your own setup for a boss and difficulty ({ label, spell, groups }, untimed): true, or false and what is wrong.
function Interrupts:SetCustom(key, raw)
    local id, diff = self.SplitKey(key)
    if not (id and diff) or type(raw) ~= "table" then
        return false, "no boss and difficulty"
    end
    local ship = shippedFor(id, diff)
    if ship and ship.timing then
        return false, Interrupts.TEXT.timed
    end
    local s, why = Setup.ReadOne({ difficulty = diff, label = raw.label, spell = raw.spell, groups = raw.groups })
    if not s then
        return false, why
    end
    local setups = db().setups
    setups[id] = type(setups[id]) == "table" and setups[id] or {}
    setups[id][diff] = { label = s.label, spell = s.spell, groups = s.groups }
    self:Fire("setup", self.Key(id, diff))
    return true
end

-- Back to the shipped setup: your own is dropped.
function Interrupts:DropCustom(key)
    local id, diff = self.SplitKey(key)
    local boss = id and diff and db().setups[id]
    if type(boss) == "table" and boss[diff] then
        boss[diff] = nil
        if next(boss) == nil then
            db().setups[id] = nil
        end
        self:Fire("setup", self.Key(id, diff))
    end
end

-- Forgets the boss files read, for a boss file that changed (the tests).
function Interrupts:ClearCache()
    wipe(self.shipped)
end

-- Every setup of the bosses in the route, in route order, Mythic first:
-- { { key = "encounterID:difficultyID", label = name, encounterID, difficulty }, ... }.
function Interrupts:Bosses()
    local out = {}
    for _, boss in ipairs(CRT.Bosses:RouteList()) do
        for _, s in ipairs(self:Setups(boss.encounterID)) do
            out[#out + 1] = { key = self.Key(boss.encounterID, s.difficulty), label = boss.name, encounterID = boss.encounterID,
                difficulty = s.difficulty }
        end
    end
    return out
end

function Interrupts:BossName(key)
    local id = self.SplitKey(key)
    local boss = id and CRT.Bosses and CRT.Bosses:Get(id)
    return boss and boss.name or ("encounter " .. tostring(id or key))
end

-- Lists -----------------------------------------------------------------------------------------------------------

-- A name as a slot keeps it: trimmed, without its realm. "" for anything that isn't readable text.
function Interrupts.CleanName(name)
    if not readable(name) or type(name) ~= "string" then
        return ""
    end
    name = name:match("^%s*(.-)%s*$")
    return (name:gsub("%-.*$", ""))
end
local clean = Interrupts.CleanName

local function emptyList(def)
    local list = {}
    for g, grp in ipairs(def.groups) do
        list[g] = {}
        for s = 1, grp.slots do
            list[g][s] = ""
        end
    end
    return list
end

-- A copy of list in the shape of def, every slot a cleaned name or "".
local function copyList(def, list)
    local out = emptyList(def)
    for g, grp in ipairs(def.groups) do
        local col = type(list) == "table" and list[g]
        for s = 1, grp.slots do
            local name = type(col) == "table" and col[s]
            out[g][s] = type(name) == "string" and clean(name) or ""
        end
    end
    return out
end
Interrupts.CopyList = copyList

-- A list in group order as lists by group key (copies), and back.
local function byKey(def, list)
    local out, copied = {}, copyList(def, list)
    for g, grp in ipairs(def.groups) do
        out[grp.key] = copied[g]
    end
    return out
end

local function inOrder(def, lists)
    local list = {}
    for g, grp in ipairs(def.groups) do
        list[g] = type(lists) == "table" and lists[grp.key] or nil
    end
    return copyList(def, list)
end

local function hasName(list)
    for _, col in ipairs(list) do
        for _, name in ipairs(col) do
            if name ~= "" then
                return true
            end
        end
    end
    return false
end
Interrupts.HasName = hasName

-- The lists from before group keys, read into kicks[encounterID] for the boss's first setup with as many groups.
local function migrate(encounterID, byBoss)
    local d = db()
    local oldOwn = type(d.own) == "table" and d.own[encounterID]
    local oldShared = type(d.shared) == "table" and d.shared[encounterID]
    local width = type(oldOwn) == "table" and #oldOwn or (type(oldShared) == "table" and type(oldShared.list) == "table" and #oldShared.list) or 0
    if width == 0 then
        return
    end
    for _, s in ipairs(Interrupts:Setups(encounterID)) do
        if #s.groups == width then
            local e = { own = {} }
            if type(oldOwn) == "table" then
                e.own = byKey(s, oldOwn)
            end
            if type(oldShared) == "table" and type(oldShared.list) == "table" then
                e.shared = { lists = byKey(s, oldShared.list), from = oldShared.from, at = oldShared.at }
            end
            if type(d.use) == "table" and d.use[encounterID] == "own" then
                e.use = "own"
            end
            byBoss[s.difficulty] = e
            return
        end
    end
end

-- The saved lists of one boss and difficulty; made when make is set. The old lists are read in the first time.
local function entry(encounterID, difficulty, make)
    local kicks = db().kicks
    local byBoss = kicks[encounterID]
    if type(byBoss) ~= "table" then
        byBoss = {}
        migrate(encounterID, byBoss)
        if not (make or next(byBoss)) then
            return nil
        end
        kicks[encounterID] = byBoss
    end
    local e = byBoss[difficulty]
    if type(e) ~= "table" then
        if not make then
            return nil
        end
        e = {}
        byBoss[difficulty] = e
    end
    e.own = type(e.own) == "table" and e.own or {}
    return e
end

-- Your saved column for a group key, filled out to slots with "" (never cut short: a share's smaller shape in use
-- for a while must not lose your names past it).
local function savedColumn(own, grp)
    local col = type(own[grp.key]) == "table" and own[grp.key] or {}
    own[grp.key] = col
    for s = 1, grp.slots do
        if type(col[s]) ~= "string" then
            col[s] = ""
        end
    end
    return col
end

-- Your own list for a key, in the setup's group order and shape: a copy (SetName changes it). nil for a key with no
-- setup.
function Interrupts:Own(key)
    local _, def, id, diff = self:Resolve(key)
    if not def then
        return nil
    end
    local own = entry(id, diff, true).own
    local view = {}
    for g, grp in ipairs(def.groups) do
        local col = savedColumn(own, grp)
        view[g] = {}
        for s = 1, grp.slots do
            view[g][s] = col[s]
        end
    end
    return view
end

-- The raid's list as shared ({ list, from, at }, list in group order), or nil.
function Interrupts:Shared(key)
    local _, def, id, diff = self:Resolve(key)
    local e = def and entry(id, diff)
    local s = e and e.shared
    if type(s) ~= "table" or type(s.lists) ~= "table" then
        return nil
    end
    return { list = inOrder(def, s.lists), from = s.from, at = s.at }
end

-- The list in use and where it comes from: "raid" or "own"; nil, nil when there is none (your own with no name).
function Interrupts:List(key)
    local _, def, id, diff = self:Resolve(key)
    if not def then
        return nil, nil
    end
    local shared = self:Shared(key)
    local e = entry(id, diff)
    if shared and not (e and e.use == "own") then
        return shared.list, "raid"
    end
    local own = self:Own(key)
    if hasName(own) then
        return own, "own"
    end
    return nil, nil
end

local function setUse(id, diff, use)
    entry(id, diff, true).use = use
end

-- Edits one slot of your own list; your own list is then the one in use. The same name again (a field focused and
-- left, the picker's own pick) changes nothing, so it never drops the raid's list.
function Interrupts:SetName(key, g, s, name)
    local skey, def, id, diff = self:Resolve(key)
    local grp = def and def.groups[g]
    if not (grp and type(s) == "number" and s >= 1 and s <= grp.slots) then
        return
    end
    local col = savedColumn(entry(id, diff, true).own, grp)
    name = clean(name)
    if name == col[s] then
        return
    end
    col[s] = name
    if self:Shared(skey) then
        setUse(id, diff, "own")
    end
    self:Fire("list", skey, "own")
end

-- Your own list for a key, every slot at once (a list in group order, as SetName would set each): the raid note's
-- block saved in the note editor (Interrupts/NoteBlock.lua's Saved). Your own list is then the one in use, unless the
-- raid's holds the same names. quiet: no change fired (the caller fires one). Returns whether a name changed.
function Interrupts:SetOwn(key, list, quiet)
    local skey, def, id, diff = self:Resolve(key)
    if not def then
        return false
    end
    local own = entry(id, diff, true).own
    local new = copyList(def, list)
    local changed = false
    for g, grp in ipairs(def.groups) do
        local col = savedColumn(own, grp)
        for s = 1, grp.slots do
            if col[s] ~= new[g][s] then
                col[s], changed = new[g][s], true
            end
        end
    end
    local shared = self:Shared(skey)
    if changed and shared and not Interrupts.SameList(def, shared.list, new) then
        setUse(id, diff, "own")
    end
    if changed and not quiet then
        self:Fire("list", skey, "own")
    end
    return changed
end

function Interrupts:Clear(key)
    local skey, def, id, diff = self:Resolve(key)
    if def then
        entry(id, diff, true).own = byKey(def, emptyList(def))
        self:Fire("list", skey, "own")
    end
end

-- Use the raid's list: copies it over your own, and the raid's is in use.
function Interrupts:CopyRaids(key)
    local skey, def, id, diff = self:Resolve(key)
    local shared = def and self:Shared(skey)
    if shared then
        local e = entry(id, diff, true)
        e.own = byKey(def, shared.list)
        e.use = nil
        self:Fire("list", skey, "own")
    end
end

function Interrupts:SetUse(key, use)
    local skey, def, id, diff = self:Resolve(key)
    if def then
        setUse(id, diff, (use == "own") and "own" or nil)
        self:Fire("list", skey)
    end
end

-- A list from the raid leader or an assistant, or from the raid note: saved as the raid's list and put in use. Your
-- own is left as it is. setup, when given, is the shape the list came in (Setup.FromShape), for a list that doesn't
-- fit the setup here (or a key with none): the list is read in it, and it is the key's setup while this list is in
-- use. Returns true when it was taken.
function Interrupts:ReceiveShared(key, list, sender, setup)
    local id, diff = self.SplitKey(key)
    local skey, def, rid, rdiff = self:Resolve(key)
    if not setup and rid then
        -- the list was read in the shape an earlier share brought (the same setup shared again, or read back from the
        -- raid note): that shape stays with it
        local shared, inUse = sharedFor(rid, rdiff)
        if shared and (inUse or not (customFor(rid, rdiff) or shippedFor(rid, rdiff))) then
            setup = shared
        end
    end
    if setup and id and (diff or setup.difficulty) then
        diff = diff or setup.difficulty
        skey, def = self.Key(id, diff), setup
    end
    if not def then
        return false
    end
    id, diff = self.SplitKey(skey)
    local e = entry(id, diff, true)
    e.shared = { lists = byKey(def, list), from = sender, at = time() }
    if setup then
        e.shared.setup = { label = setup.label, groups = setup.groups }
    end
    e.use = nil
    self:Fire("list", skey, "raid")
    return true
end

-- True when every slot of list has a name.
function Interrupts:Complete(key, list)
    local def = self:Def(key)
    if not def or type(list) ~= "table" then
        return false
    end
    for g, grp in ipairs(def.groups) do
        for s = 1, grp.slots do
            local name = type(list[g]) == "table" and list[g][s]
            if type(name) ~= "string" or name == "" then
                return false
            end
        end
    end
    return true
end

-- Whether two lists hold the same names in the same slots of def.
function Interrupts.SameList(def, a, b)
    a, b = copyList(def, a), copyList(def, b)
    for g, grp in ipairs(def.groups) do
        for s = 1, grp.slots do
            if a[g][s] ~= b[g][s] then
                return false
            end
        end
    end
    return true
end

-- Your kick number, your group's label and its index in the list in use: the first slot whose name is yours, case
-- and realm left out. nil when you are not on it (or there is no list).
function Interrupts:Mine(key)
    local list = self:List(key)
    local def = self:Def(key)
    if not list then
        return nil, nil, nil
    end
    local ok, me = pcall(UnitName, "player")
    me = ok and clean(me) or ""
    if me == "" then
        return nil, nil, nil
    end
    me = me:lower()
    for g, grp in ipairs(def.groups) do
        for s = 1, grp.slots do
            local name = list[g] and list[g][s]
            if type(name) == "string" and name ~= "" and clean(name):lower() == me then
                return s, grp.label, g
            end
        end
    end
    return nil, nil, nil
end

-- Test on trash never carries over a login, and the page follows the switch from the saved data.
local login = CreateFrame("Frame")
login:RegisterEvent("PLAYER_LOGIN")
login:SetScript("OnEvent", function()
    if not CRT.db then
        return
    end
    db().test = false
    if CRT.UI and CRT.UI.SetPageHidden then
        CRT.UI:SetPageHidden("interrupts", not Interrupts:Enabled())
    end
end)

-- The Addon check's Interrupts column (CRT_Core/AddonCheck.lua): on while the module is switched on. Nil in a
-- harness that loads this file alone.
if CRT.AddonCheck then
    CRT.AddonCheck:Register({ key = "interrupts", label = "Interrupts", order = 45, on = function()
        return CRT.db.interrupts.enabled == true
    end })
end
