local ADDON, CRT = ...

-- Interrupts: kick numbers above a boss's adds, a countdown before your own kick, and a kick list the raid leader
-- shares (CRT.Interrupts). An optional module, off for everyone until they tick Enable Interrupts on General
-- Settings (CRTDB.interrupts.enabled); off, nothing of it runs and nothing of Notes, Alerts or Timeline is touched.
-- This file holds the kick lists, the list in use, your number, the switch and the settings:
--   Lattice.lua   the numbering, from the boss's interrupts block (in its season-pack file)
--   Anchor.lua    each wave's anchor, from the boss's cast count, or the fallback times from the pull
--   Plates.lua    the numbers above the adds' nameplates
--   Reminder.lua  the countdown before your pair's first cast
--   Comm.lua      sharing the list; Page.lua the page
--
-- A kick list is groups x slots names without realm, list[group][slot], "" for an empty slot. Two per boss, as pace
-- plans have: your own (CRTDB.interrupts.own[encounterID]) and the raid's (shared[encounterID] = { list, from, at }).
-- The list in use is the raid's while there is one, unless you switched the boss to your own (use[encounterID] =
-- "own"); a new share always switches you back to the raid's. Editing your own puts it in use. Your number is the
-- slot your name is in, in the list in use, and your group the column's heading.

local Interrupts = { listeners = {}, defs = {} }
CRT.Interrupts = Interrupts

local function db()
    return CRT.db.interrupts
end

-- The saved tables kept per boss, declared for the dev season purge (Bosses:DeclareStore, CRT_Data/Bosses/Registry.lua).
if CRT.Bosses and CRT.Bosses.DeclareField then
    CRT.Bosses:DeclareField("own kick lists", "interrupts", "own")
    CRT.Bosses:DeclareField("shared kick lists", "interrupts", "shared")
    CRT.Bosses:DeclareField("kick list choices", "interrupts", "use")
end

local readable = CRT.Comm.Readable -- false for nil and for a secret

function Interrupts:OnChange(fn)
    self.listeners[#self.listeners + 1] = fn
end

-- what says what changed: "enabled" for the switch, "list" for a kick list, "settings" for the rest.
function Interrupts:Fire(what)
    for _, fn in ipairs(self.listeners) do
        local ok, err = pcall(fn, what)
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

-- Bosses ----------------------------------------------------------------------------------------------------------

-- A boss's interrupts block, read once (Lattice.Read), or nil when it has none or it doesn't read.
function Interrupts:Def(encounterID)
    if encounterID == nil then
        return nil
    end
    local cached = self.defs[encounterID]
    if cached == nil then
        local boss = CRT.Bosses and CRT.Bosses:Get(encounterID)
        cached = boss and boss.interrupts and CRT.InterruptLattice.Read(boss.interrupts) or false
        self.defs[encounterID] = cached
    end
    return cached or nil
end

-- Forgets the blocks read, for a boss file that changed (the tests).
function Interrupts:ClearCache()
    wipe(self.defs)
end

-- The bosses with a block that reads, in route order: { { key = encounterID, label = name }, ... }.
function Interrupts:Bosses()
    local out = {}
    for _, boss in ipairs(CRT.Bosses:RouteList()) do
        if self:Def(boss.encounterID) then
            out[#out + 1] = { key = boss.encounterID, label = boss.name }
        end
    end
    return out
end

function Interrupts:BossName(encounterID)
    local boss = CRT.Bosses and CRT.Bosses:Get(encounterID)
    return boss and boss.name or ("encounter " .. tostring(encounterID))
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
    for g = 1, #def.groups do
        list[g] = {}
        for s = 1, def.slots do
            list[g][s] = ""
        end
    end
    return list
end

-- A copy of list in the shape of def, every slot a cleaned name or "".
local function copyList(def, list)
    local out = emptyList(def)
    for g = 1, #def.groups do
        local col = type(list) == "table" and list[g]
        for s = 1, def.slots do
            local name = type(col) == "table" and col[s]
            out[g][s] = type(name) == "string" and clean(name) or ""
        end
    end
    return out
end
Interrupts.CopyList = copyList

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

-- Your own list for a boss, made empty (or filled out to the boss's shape) when needed. nil for a boss with no block.
function Interrupts:Own(encounterID)
    local def = self:Def(encounterID)
    if not def then
        return nil
    end
    local own = db().own[encounterID]
    if type(own) ~= "table" then
        own = emptyList(def)
        db().own[encounterID] = own
    else
        for g = 1, #def.groups do
            own[g] = type(own[g]) == "table" and own[g] or {}
            for s = 1, def.slots do
                if type(own[g][s]) ~= "string" then
                    own[g][s] = ""
                end
            end
        end
    end
    return own
end

-- The raid's list as shared ({ list, from, at }), or nil.
function Interrupts:Shared(encounterID)
    local s = encounterID and db().shared[encounterID]
    return type(s) == "table" and type(s.list) == "table" and s or nil
end

-- The list in use and where it comes from: "raid" or "own"; nil, nil when there is none (your own with no name).
function Interrupts:List(encounterID)
    local def = self:Def(encounterID)
    if not def then
        return nil, nil
    end
    local shared = self:Shared(encounterID)
    if shared and db().use[encounterID] ~= "own" then
        return shared.list, "raid"
    end
    local own = self:Own(encounterID)
    if hasName(own) then
        return own, "own"
    end
    return nil, nil
end

-- Edits one slot of your own list; your own list is then the one in use. The same name again (a field focused and
-- left, the picker's own pick) changes nothing, so it never drops the raid's list.
function Interrupts:SetName(encounterID, g, s, name)
    local own = self:Own(encounterID)
    if not (own and own[g] and own[g][s] ~= nil) then
        return
    end
    name = clean(name)
    if name == own[g][s] then
        return
    end
    own[g][s] = name
    if self:Shared(encounterID) then
        db().use[encounterID] = "own"
    end
    self:Fire("list")
end

function Interrupts:Clear(encounterID)
    local def = self:Def(encounterID)
    if def then
        db().own[encounterID] = emptyList(def)
        self:Fire("list")
    end
end

-- Use the raid's list: copies it over your own, and the raid's is in use.
function Interrupts:CopyRaids(encounterID)
    local def, shared = self:Def(encounterID), self:Shared(encounterID)
    if def and shared then
        db().own[encounterID] = copyList(def, shared.list)
        db().use[encounterID] = nil
        self:Fire("list")
    end
end

function Interrupts:SetUse(encounterID, use)
    db().use[encounterID] = (use == "own") and "own" or nil
    self:Fire("list")
end

-- A list from the raid leader or an assistant: saved as the raid's list and put in use. Your own is left as it is.
function Interrupts:ReceiveShared(encounterID, list, sender)
    local def = self:Def(encounterID)
    if not def then
        return false
    end
    db().shared[encounterID] = { list = copyList(def, list), from = sender, at = time() }
    db().use[encounterID] = nil
    self:Fire("list")
    return true
end

-- True when every slot of list has a name.
function Interrupts:Complete(encounterID, list)
    local def = self:Def(encounterID)
    if not def or type(list) ~= "table" then
        return false
    end
    for g = 1, #def.groups do
        for s = 1, def.slots do
            local name = type(list[g]) == "table" and list[g][s]
            if type(name) ~= "string" or name == "" then
                return false
            end
        end
    end
    return true
end

-- Your kick number and group in the list in use: the first slot whose name is yours, case and realm left out.
-- nil, nil when you are not on it (or there is no list).
function Interrupts:Mine(encounterID)
    local list = self:List(encounterID)
    local def = self:Def(encounterID)
    if not list then
        return nil, nil
    end
    local ok, me = pcall(UnitName, "player")
    me = ok and clean(me) or ""
    if me == "" then
        return nil, nil
    end
    me = me:lower()
    for g = 1, #def.groups do
        for s = 1, def.slots do
            local name = list[g] and list[g][s]
            if type(name) == "string" and name ~= "" and clean(name):lower() == me then
                return s, def.groups[g]
            end
        end
    end
    return nil, nil
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
