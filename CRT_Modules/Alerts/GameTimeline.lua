local ADDON, CRT = ...

-- The game's boss timeline (Blizzard_EncounterTimeline): our alerts in it, and the choice to replace it.
-- Sending: in a pull or a quick test, every line whose outputs.timeline is on is added to the game's timeline as a
-- script event (C_EncounterTimeline.AddScriptEvent) once it is LEAD seconds away, with its spell, icon, name,
-- Journal icons (the icons mask, from line.abilityTags) and a severity from its priority. At its time it is finished
-- (FinishScriptEvent); a line that goes away first (a later phase cut it, the pull ended or wiped, Send was turned
-- off) is canceled (CancelScriptEvent). Only our own event IDs are touched, never CancelAllScriptEvents, which would
-- take other addons' events too. Never in a rehearsal: its clock pauses, jumps and runs at 2x or 4x, and a script
-- event counts down on real time. Every value passed is read through CRT.Timeline.readable first, so nothing secret
-- reaches the API; a secret name, spell or icon is left out.
-- Show in: "both" (default) shows those lines here and there; "game" leaves them off our area (TimelineArea asks
-- Game.ShowsHere), except a line the game refused, and everything shows here whenever nothing is being sent (Send
-- off, Replace on, a rehearsal, or the game's timeline turned off in its options: IsFeatureEnabled).
-- Replace: the game's supported route, EncounterTimeline:SetAttribute("overrideViewType", None) and
-- C_EncounterTimeline.SetViewType(None) (EncounterTimelineMixin:UpdateSystemSettingViewType reads the attribute over
-- the Edit Mode choice). Off again, the attribute is cleared and the frame's own UpdateSystemSettingViewType puts the
-- player's Edit Mode view type back. The game's frames are never hidden, moved or re-skinned. Applied at login, out
-- of combat only (it waits for PLAYER_REGEN_ENABLED), and the game's timeline is never touched for a player who
-- never turned it on.
-- Settings, on the Alert timeline area (CRT.db.alerts.areas.timeline, defaults in CRT_Core/Core.lua): gameSend,
-- gameShowIn ("both" or "game") and gameReplace.
-- Sources: Gethe/wow-ui-source live, Blizzard_APIDocumentationGenerated/EncounterTimelineDocumentation.lua and
-- Blizzard_EncounterTimeline/EncounterTimeline.lua. The dev probe is CRT_Dev/Dev/GameTimelineProbe.lua.
--   Game:Sync()           sends, finishes and cancels to match the run now (on every engine change, and while
--                         lines are coming, every TICK seconds)
--   Game.ShowsHere(line)  -> whether our area shows the line
--   Game.Request(line, seconds) -> the AddScriptEvent table for a line due in `seconds`
--   Game:ApplyReplace()   sets or undoes Replace as saved; false when it has to wait or the game has no timeline

local Alerts = CRT.Alerts
local Areas = CRT.AlertAreas

local TEXT = {
    send = "Send to the game's timeline",
    sendHelp = "Your alerts that show on this timeline also show on the game's boss timeline, beside the boss's own abilities. Only in a pull or a quick test. A Rehearsal can pause and run fast, and the game's timeline can't.",
    showIn = "Show in",
    showInHelp = "Both timelines shows each alert here and on the game's timeline. With The game's timeline only, this timeline leaves out what it sent there. When the game's timeline is off in the game's options, everything shows here.",
    both = "Both timelines",
    gameOnly = "The game's timeline only",
    replace = "Replace the game's timeline",
    replaceHelp = "Hides the game's boss timeline, the boss's own abilities too, so only this one shows. Nothing is sent there while it is on. Turn it off to get the game's timeline back as Edit Mode has it. In combat, the change waits until combat ends.",
}

-- Tune in game.
local LEAD = 30   -- seconds before its time a line is sent: the game's timeline shows about this far ahead
local TICK = 0.2  -- seconds between checks while lines are coming
local QUESTION_ICON = 134400 -- INV_Misc_QuestionMark: an alert with no icon (the request needs a file ID)
local ATTRIBUTE = "overrideViewType"
-- The game's enums, with their numbers from the documentation for a client that lacks them.
local VIEW_NONE_FALLBACK = 0
local SEVERITY_FALLBACK = { Low = 0, Medium = 1, High = 2 }
local SEVERITY_BY_LEVEL = { [1] = "Low", [2] = "Medium", [3] = "High" } -- Rules.Priority's level: the last digit
-- Our Journal tag (Reference.TAGS) -> the game's EncounterEventIconmask entry and its number. Heroic, Mythic,
-- Important and Interruptible have no icon on the game's timeline.
local ICON_BITS = {
    deadly = { "DeadlyEffect", 1 }, enrage = { "EnrageEffect", 2 }, bleed = { "BleedEffect", 4 },
    magic = { "MagicEffect", 8 }, disease = { "DiseaseEffect", 16 }, curse = { "CurseEffect", 32 },
    poison = { "PoisonEffect", 64 }, tank = { "TankRole", 128 }, healer = { "HealerRole", 256 }, dps = { "DpsRole", 512 },
}
local SHOW_IN_OPTIONS = { { key = "both", label = TEXT.both }, { key = "game", label = TEXT.gameOnly } }
local EMPTY = {}

local Game = { LEAD = LEAD, QUESTION_ICON = QUESTION_ICON, TEXT = TEXT }
CRT.AlertGameTimeline = Game

local sent = {}    -- line key -> the game's event ID, while it is on the game's timeline
local done = {}    -- line key -> true once finished, so it is never sent again this run
local failed = {}  -- line key -> true when the game refused it: it shows here instead
local runId        -- the run the tables above belong to

local function readable(v)
    local T = CRT.Timeline
    if T and T.readable then
        return T.readable(v)
    end
    return not (issecretvalue and issecretvalue(v))
end

local function settings()
    local alerts = CRT.db and CRT.db.alerts
    local areas = alerts and alerts.areas
    return areas and areas.timeline or EMPTY
end

local function showIn(s)
    return s.gameShowIn == "game" and "game" or "both"
end

-- The API table when this client has the game's timeline, else nil.
local function api()
    local C = C_EncounterTimeline
    if type(C) == "table" and type(C.AddScriptEvent) == "function" then
        return C
    end
    return nil
end

local function enumValue(enum, name, fallback)
    local e = Enum and Enum[enum]
    local v = e and e[name]
    return type(v) == "number" and v or fallback
end

-- Whether the player has the game's timeline on (it shows nothing otherwise).
local function gameShowing(C)
    if type(C.IsFeatureEnabled) ~= "function" then
        return true
    end
    local ok, on = pcall(C.IsFeatureEnabled)
    return ok and readable(on) and on == true
end

-- Whether lines are being sent now, and the API when they are.
local function sending()
    local s = settings()
    if s.gameSend == false or s.gameReplace == true or not Alerts.running or Alerts:IsRehearsal() then
        return nil
    end
    local C = api()
    if C and gameShowing(C) then
        return C
    end
    return nil
end

local function keyOf(line)
    return tostring(line.id) .. "@" .. format("%.2f", line.at)
end

-- The icons mask of a line's Journal tags, or nil for none.
local function iconMask(line)
    local tags = line.abilityTags
    if type(tags) ~= "table" then
        return nil
    end
    local seen, mask = {}, 0
    for _, key in ipairs(tags) do
        local bit = ICON_BITS[key]
        if bit and not seen[key] then
            seen[key] = true
            mask = mask + enumValue("EncounterEventIconmask", bit[1], bit[2])
        end
    end
    return mask > 0 and mask or nil
end

function Game.Request(line, seconds)
    local spellID = line.spellID
    if not (readable(spellID) and type(spellID) == "number" and spellID > 0) then
        spellID = 0
    end
    local icon = Areas.LineIcon(line) -- readable or nil
    if type(icon) ~= "number" then
        icon = QUESTION_ICON
    end
    local level = (readable(line.priority) and type(line.priority) == "number") and line.priority % 10 or 2
    local severity = SEVERITY_BY_LEVEL[level] or "Medium"
    return {
        spellID = spellID,
        iconFileID = icon,
        duration = seconds,
        maxQueueDuration = 0,
        overrideName = Areas.LineText(line), -- readable, "" when there is none
        icons = iconMask(line),
        severity = enumValue("EncounterEventSeverity", severity, SEVERITY_FALLBACK[severity]),
        paused = false,
    }
end

local function call(C, name, id)
    if C and type(C[name]) == "function" then
        pcall(C[name], id)
    end
end

-- A new run starts clean; what an earlier run left on the game's timeline is taken back.
local function newRun(C)
    if runId == Alerts.runId then
        return
    end
    for key, id in pairs(sent) do
        call(C or api(), "CancelScriptEvent", id)
        sent[key] = nil
    end
    done, failed = {}, {}
    runId = Alerts.runId
end

local function onUpdate(frame, elapsed)
    frame.wait = (frame.wait or 0) - elapsed
    if frame.wait <= 0 then
        frame.wait = TICK
        Game:Sync()
    end
end

local function setTicking(on)
    local frame = Game.frame
    if frame.ticking ~= on then
        frame.ticking = on
        frame.wait = TICK
        frame:SetScript("OnUpdate", on and onUpdate or nil)
    end
end

local function add(C, line, key, seconds)
    local ok, id = pcall(C.AddScriptEvent, Game.Request(line, seconds))
    if ok and readable(id) and type(id) == "number" and id > 0 then
        sent[key] = id
        return true
    end
    failed[key] = true
    return false
end

function Game:Sync()
    local C = sending()
    newRun(C)
    local now = GetTime()
    local keep, coming = {}, false
    if C then
        for _, line in ipairs(Alerts:Lines(now)) do
            local o = line.outputs
            if o and o.timeline and type(line.at) == "number" then
                local key = keyOf(line)
                local left = line.at - now
                if sent[key] then
                    if left <= 0 then
                        call(C, "FinishScriptEvent", sent[key])
                        sent[key] = nil
                        done[key] = true
                    else
                        keep[key] = true
                    end
                elseif left > 0 and not done[key] and not failed[key] then
                    if left > LEAD then
                        coming = true
                    elseif add(C, line, key, left) then
                        keep[key] = true
                    end
                end
            end
        end
    end
    -- gone from the run (cut, ended, turned off): off the game's timeline too
    for key, id in pairs(sent) do
        if not keep[key] then
            call(C or api(), "CancelScriptEvent", id)
            sent[key] = nil
        end
    end
    setTicking(C ~= nil and (next(sent) ~= nil or coming))
end

function Game.ShowsHere(line)
    if showIn(settings()) ~= "game" or not sending() then
        return true
    end
    return failed[keyOf(line)] == true
end

-- Replace ------------------------------------------------------------------------------------

-- The player's Edit Mode view type back: the frame's own update reads the attribute (now cleared) over Edit Mode.
local function restoreView(frame, C)
    if type(frame.UpdateSystemSettingViewType) == "function" and pcall(frame.UpdateSystemSettingViewType, frame) then
        return
    end
    local util = EncounterTimelineUtil
    local setting = Enum and Enum.EditModeEncounterEventsSetting and Enum.EditModeEncounterEventsSetting.ViewType
    if setting and util and type(util.GetViewTypeFromEditMode) == "function" and type(frame.GetSettingValue) == "function" then
        local ok, value = pcall(frame.GetSettingValue, frame, setting)
        local okView, view = pcall(util.GetViewTypeFromEditMode, ok and value or nil)
        if okView and type(view) == "number" then
            pcall(C.SetViewType, view)
        end
    end
end

function Game:ApplyReplace()
    local want = settings().gameReplace == true
    if not want and not self.replaced then
        return true -- never turned on: the game's timeline is left as it is
    end
    local frame, C = EncounterTimeline, C_EncounterTimeline
    if type(frame) ~= "table" or type(frame.SetAttribute) ~= "function" or type(C) ~= "table" or type(C.SetViewType) ~= "function" then
        return false
    end
    if InCombatLockdown and InCombatLockdown() then
        self.frame:RegisterEvent("PLAYER_REGEN_ENABLED")
        return false
    end
    local none = enumValue("EncounterTimelineViewType", "None", VIEW_NONE_FALLBACK)
    if want then
        pcall(frame.SetAttribute, frame, ATTRIBUTE, none)
        pcall(C.SetViewType, none)
        self.replaced = true
    else
        -- only our own value is cleared, so another addon's choice stays
        local okGet, current = pcall(frame.GetAttribute, frame, ATTRIBUTE)
        if okGet and current == none then
            pcall(frame.SetAttribute, frame, ATTRIBUTE, nil)
        end
        restoreView(frame, C)
        self.replaced = false
    end
    return true
end

-- Settings rows --------------------------------------------------------------------------------

-- The rows on the Alert timeline area's settings (TimelineArea's settings call this).
function Game.SettingsRows(panel, s)
    panel:Check(TEXT.send, function()
        return s.gameSend ~= false
    end, function(on)
        s.gameSend = on
        Game:Sync()
    end, TEXT.sendHelp)
    panel:Dropdown(TEXT.showIn, {
        options = SHOW_IN_OPTIONS,
        get = function()
            return showIn(s)
        end,
        set = function(key)
            s.gameShowIn = key
        end,
        enabledIf = function()
            return s.gameSend ~= false and s.gameReplace ~= true
        end,
        help = TEXT.showInHelp,
    })
    panel:Check(TEXT.replace, function()
        return s.gameReplace == true
    end, function(on)
        s.gameReplace = on
        Game:ApplyReplace()
        Game:Sync()
    end, TEXT.replaceHelp)
end

local frame = CreateFrame("Frame")
Game.frame = frame
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("ADDON_LOADED")
frame:SetScript("OnEvent", function(self, event, name)
    if event == "PLAYER_REGEN_ENABLED" then
        self:UnregisterEvent("PLAYER_REGEN_ENABLED")
        Game:ApplyReplace()
    elseif event == "PLAYER_LOGIN" or (event == "ADDON_LOADED" and name == "Blizzard_EncounterTimeline") then
        Game:ApplyReplace()
    end
end)

Alerts:OnChange(function()
    Game:Sync()
end)
