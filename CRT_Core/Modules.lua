local ADDON, CRT = ...

-- Module switches: parts of the addon a player can turn off to keep it light. Every file still loads (one
-- addon, one .toc); a module that is off registers nothing that runs: no pages or menu entries, no /crt
-- words (they say it is off), no event frames, no hooks. A switch takes effect after a /reload: there is
-- no live unload. Core is always on.
--
-- The switch is saved in CRTDB.modules[key] (true or false; missing is on), one per profile. It never travels
-- in Export settings only (Profiles.lua's SHARE): a raid leader's settings would turn modules off for everyone
-- who imports them. The registry reads it once, on
-- Core's ADDON_LOADED (Modules:Start, called from Core.lua), so IsOn keeps saying what this session runs
-- until the next /reload.
--
-- A module's parts, declared at the bottom of this file:
--   label, help   its name, and its (?) on the Modules page (UI/ModulesPage.lua): what turns off with it,
--                 then what keeps working for raiders
--   files         the files it owns: turned off with it
--   raider        files in its folders that keep running when it is off: what raiders answer or see
--   core          files in its folders that are Core: the shared stores and data the rest of the addon reads
--   pages         the page keys it registers (UI:RegisterPage); dropped from the menu when off
--   words         the /crt words it registers (CRT.Slash:Register in Slash.lua), for the tests; a word whose
--                 bare form is a raider's (Slash.lua's raider) is listed with a word after it
-- A module's own files ask the registry for the rest, at file load:
--   Modules:Frame(key)        an event frame: made as CreateFrame("Frame"); when the module is off it is
--                             silenced on ADDON_LOADED (no events, no OnEvent or OnUpdate)
--   Modules:OnInit(key, fn)   fn runs on ADDON_LOADED, after the saved data, only when the module is on:
--                             hooks into other modules' changes, and anything that needs CRTDB
-- A file must still load without the registry (the test harnesses load files on their own), so module files
-- reach it as CRT.Modules and fall back to a plain frame or a straight call when it is missing.
-- run_modules.js loads the whole .toc with each module off and checks all of this.

local Modules = { list = {}, byKey = {}, frames = {}, inits = {}, started = false }
CRT.Modules = Modules

local TEXT = {
    off = "%s is turned off.",
}
Modules.TEXT = TEXT

local CORE = "core"
Modules.CORE = CORE
-- Core's row on the Modules page: always on, so never registered
Modules.CORE_INFO = {
    label = "Core",
    help = "Raid Notes, Mech Alerts, Ready Check, Quality of Life and the settings. It can't be turned off.",
}

-- Declares a module (see the top of this file for def's fields). Returns def.
function Modules:Register(key, def)
    def.key = key
    if not self.byKey[key] then
        self.list[#self.list + 1] = def
    end
    self.byKey[key] = def
    if def.init then
        self:OnInit(key, def.init)
    end
    return def
end

function Modules:Get(key)
    return self.byKey[key]
end

-- Every module, in the order declared.
function Modules:List()
    return self.list
end

-- The switch as saved (true unless it says false), whatever this session runs.
function Modules:Saved(key)
    if key == CORE or not self.byKey[key] then
        return true
    end
    local saved = CRT.db and CRT.db.modules
    return not (type(saved) == "table" and saved[key] == false)
end

-- Whether a module runs in this session: Core and an unknown key always; a module as its switch was read on
-- ADDON_LOADED (before that, as saved).
function Modules:IsOn(key)
    if key == CORE or not self.byKey[key] then
        return true
    end
    if self.state then
        return self.state[key] ~= false
    end
    return self:Saved(key)
end

-- Saves a module's switch. It takes effect after a /reload: returns true when one is needed for it.
function Modules:Set(key, on)
    if key == CORE or not self.byKey[key] or not (CRT.db and CRT.db.modules) then
        return false
    end
    CRT.db.modules[key] = on and true or false
    return self:Saved(key) ~= self:IsOn(key)
end

-- "<Module> is turned off.", or, where the Modules page is loaded (it sets pageText; a developer build only
-- for now), its own line saying to turn it on there. A release build has no page to point at.
function Modules:OffText(key)
    local def = self.byKey[key]
    return (self.pageText or TEXT.off):format(def and def.label or tostring(key))
end

-- True when the module is on; otherwise says it is off in chat and returns false.
function Modules:Check(key)
    if self:IsOn(key) then
        return true
    end
    CRT:Print(self:OffText(key))
    return false
end

-- An event frame of a module, made at file load (see the top of this file).
function Modules:Frame(key)
    local f = CreateFrame("Frame")
    self.frames[#self.frames + 1] = { key = key, frame = f }
    return f
end

local function run(fn, key)
    local ok, err = pcall(fn)
    if not ok and geterrorhandler then
        geterrorhandler()("CRT module " .. tostring(key) .. ": " .. tostring(err))
    end
end

-- fn runs once the saved data is in, when the module is on (straight away if that was already settled).
function Modules:OnInit(key, fn)
    if self.started then
        if self:IsOn(key) then
            run(fn, key)
        end
        return
    end
    self.inits[#self.inits + 1] = { key = key, fn = fn }
end

local function dropPage(UI, key)
    if not (UI and UI.pages) then
        return
    end
    UI.pages[key] = nil
    for i = #UI.order, 1, -1 do
        if UI.order[i] == key then
            table.remove(UI.order, i)
        end
    end
end

-- On Core's ADDON_LOADED, after CRT.db is set (Core.lua): reads every switch once, takes a module that is
-- off out of the page registry (the menu leaves out a page that isn't registered, UI/Panel.lua's
-- menuGroups) and silences its event frames, then runs the inits of the modules that are on. Nothing here
-- counts on the order frames get an event in: a module frame that also waits for ADDON_LOADED either got it
-- before this ran (its handler ran as with the module on: today the only one is Loot/Store.lua's, which brings
-- the Loot History store's format up to date, harmless with Loot off) or has no handler left when it comes.
function Modules:Start()
    if self.started then
        return
    end
    if CRT.db and type(CRT.db.modules) ~= "table" then
        CRT.db.modules = {}
    end
    local state = {}
    for _, def in ipairs(self.list) do
        state[def.key] = self:Saved(def.key)
    end
    self.state = state
    self.started = true
    for _, def in ipairs(self.list) do
        if not state[def.key] then
            for _, page in ipairs(def.pages or {}) do
                dropPage(CRT.UI, page)
            end
        end
    end
    -- General Settings' layer rows of a module that is off (a row's module, UI.LAYER_GROUPS in UI/Panel.lua)
    local groups = CRT.UI and CRT.UI.LAYER_GROUPS
    for i = #(groups or {}), 1, -1 do
        if groups[i].module and not self:IsOn(groups[i].module) then
            table.remove(groups, i)
        end
    end
    for _, rec in ipairs(self.frames) do
        if not self:IsOn(rec.key) then
            local f = rec.frame
            f:UnregisterAllEvents()
            f:SetScript("OnEvent", nil)
            f:SetScript("OnUpdate", nil)
        end
    end
    local inits = self.inits
    self.inits = {}
    for _, rec in ipairs(inits) do
        if self:IsOn(rec.key) then
            run(rec.fn, rec.key)
        end
    end
end

-- The modules ---------------------------------------------------------------------------------------------
-- Paths from the addon folder, as the .toc lists them. Every other file is Core.

Modules:Register("loot", {
    label = "Loot",
    help = "Loot Master, Loot History and Requests. Your loot popup and /crt loot keep working when a leader runs a session.",
    pages = { "lootmaster", "loot", "requests" },
    -- /crt loot alone is the raider's (your loot popup, LootMaster/RaiderWindow.lua) and runs with Loot off;
    -- loot settings stands for the leader's words after it
    words = { "loot settings" },
    files = {
        "CRT_Modules/Loot/Store.lua", "CRT_Modules/Loot/Capture.lua", "CRT_Modules/Loot/RCLC.lua", "CRT_Modules/Loot/Page.lua",
        "CRT_Modules/LootMaster/Score.lua", "CRT_Modules/LootMaster/BossLoot.lua", "CRT_Modules/LootMaster/EndAll.lua",
        "CRT_Modules/LootMaster/Window.lua", "CRT_Modules/LootMaster/BossLootWindow.lua", "CRT_Modules/LootMaster/Trade.lua",
        "CRT_Modules/LootMaster/Test.lua", "CRT_Modules/LootMaster/AddItem.lua", "CRT_Modules/LootMaster/LootingPrompt.lua",
        "CRT_Modules/LootMaster/FilterTab.lua", "CRT_Modules/LootMaster/Tonight.lua", "CRT_Modules/LootMaster/Page.lua",
        "CRT_Modules/Requests/Page.lua",
    },
    -- a raider's side of a loot session and of a request (prefix CRTLootRemaster): the leader's tools
    -- (CRT Looting's prompt and Turn on, LootMaster/Looting.lua) refuse while Loot is off
    raider = {
        "CRT_Modules/LootMaster/Data.lua", "CRT_Modules/LootMaster/Filter.lua", "CRT_Modules/LootMaster/Comm.lua",
        "CRT_Modules/LootMaster/Sync.lua", "CRT_Modules/LootMaster/Resync.lua", "CRT_Modules/LootMaster/AutoPass.lua",
        "CRT_Modules/LootMaster/Looting.lua", "CRT_Modules/LootMaster/Rolls.lua", "CRT_Modules/LootMaster/Tabs.lua",
        "CRT_Modules/LootMaster/Popup.lua", "CRT_Modules/LootMaster/RaiderWindow.lua",
        "CRT_Modules/Requests/Data.lua", "CRT_Modules/Requests/Popup.lua",
    },
})

Modules:Register("timeline", {
    label = "Timeline",
    help = "Pull review, Healer CDs and the Rehearsal. Mech Alerts, alerts and pull recording keep working.",
    pages = { "timeline" },
    words = { "timeline" },
    files = {
        "CRT_Modules/Timeline/Rehearsal.lua", "CRT_Modules/Timeline/RehearsalWindow.lua", "CRT_Modules/Timeline/View.lua",
        "CRT_Modules/Timeline/HealerView.lua", "CRT_Modules/Timeline/HealerPanel.lua", "CRT_Modules/Timeline/HealerRows.lua",
        "CRT_Modules/Timeline/ReferencePage.lua", "CRT_Modules/Timeline/ReviewTab.lua", "CRT_Modules/Timeline/SettingsTab.lua",
        "CRT_Modules/Timeline/Page.lua", "CRT_Modules/Timeline/JournalExport.lua",
    },
    -- the pull store and recording, the boss journal, the shipped ability timelines, the lanes, the ability
    -- tooltip and undo: Alerts, Notes and Season Stats read them
    core = {
        "CRT_Modules/Timeline/Data.lua", "CRT_Modules/Timeline/Journal.lua", "CRT_Modules/Timeline/Database.lua",
        "CRT_Modules/Timeline/Reference.lua", "CRT_Modules/Timeline/Lanes.lua", "CRT_Modules/Timeline/AbilityTip.lua",
        "CRT_Modules/Timeline/Undo.lua",
    },
})

Modules:Register("raidlead", {
    label = "Raid Lead",
    help = "Raid Groups, Gear Checker, Late Tracker, the Pace page, the Season Stats page and Tattlebot. Gear replies, repair reports, Pace bars and Season Stats counting keep working.",
    pages = { "groups", "gearcheck", "late", "pace", "seasonstats", "tattle" },
    words = { "groups", "gear", "late", "pace", "tattle" },
    files = {
        "CRT_Modules/Groups/Apply.lua", "CRT_Modules/Groups/Invite.lua", "CRT_Modules/Groups/Page.lua",
        "CRT_Modules/GearChecker/Data.lua", "CRT_Modules/GearChecker/Inspect.lua", "CRT_Modules/GearChecker/Page.lua",
        "CRT_Modules/Late/Data.lua", "CRT_Modules/Late/Page.lua", "CRT_Modules/Pace/Page.lua",
        "CRT_Modules/SeasonStats/Page.lua",
        "CRT_Modules/Tattlebot/Data.lua", "CRT_Modules/Tattlebot/Page.lua",
    },
    -- the Gear Checker's answer (prefix CRTGearCheck) and your repair reports (CRTRepair)
    raider = { "CRT_Modules/GearChecker/Comm.lua", "CRT_Modules/SeasonStats/Repairs.lua" },
    -- the raid layouts and names everyone reads (Groups/Data.lua), the shipped Tattlebot and Pace stores the
    -- boss library fills (CRT_Data/Bosses/Registry.lua), the Pace bars raiders see with their plans (CRTPace1), and
    -- Season Stats' counters, which keep counting pulls with Raid Lead off (only its page goes with it)
    core = {
        "CRT_Modules/Groups/Data.lua", "CRT_Modules/SeasonStats/Data.lua", "CRT_Modules/Tattlebot/Database.lua", "CRT_Modules/Pace/Database.lua",
        "CRT_Modules/Pace/Data.lua", "CRT_Modules/Pace/Display.lua", "CRT_Modules/Pace/Comm.lua",
    },
})
