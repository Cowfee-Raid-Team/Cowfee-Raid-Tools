local ADDON, CRT = ...

-- The game's boss timeline (Blizzard_EncounterTimeline) and our Alert timeline: the Mode on the Alert timeline area.
--   Standalone (default)            our Alert timeline only. Nothing is sent and the game's timeline is never touched.
--   Add to the game's timeline      our alerts are sent into the game's timeline. Our Alert timeline shows them too
--                                   only with Also show the Alert timeline on (off by default).
--   Replace the game's timeline     the game's display is turned off, and our Alert timeline shows everything.
-- Sending (Add): in a pull or a quick test, every line whose outputs.timeline is on is added to the game's timeline
-- as a script event (C_EncounterTimeline.AddScriptEvent) once it is the area's Seconds on the line away (5 to 60,
-- TimelineArea's Timeline.Seconds), with its spell, icon, name, Journal icons (the icons mask: each of
-- line.abilityTags with a gameIcon in Reference.TAGS) and a severity from its priority. At most the area's At once
-- count of lines is on the game's timeline at a time, soonest first. At its time a line is finished
-- (FinishScriptEvent); a line that goes away first (a later phase cut it, the pull ended or wiped, the Mode changed)
-- is canceled (CancelScriptEvent). Only our own event IDs are touched, never CancelAllScriptEvents, which would take
-- other addons' events too. Never in a rehearsal: its clock pauses, jumps and runs at 2x or 4x, and a script event
-- counts down on real time. Every value passed is read through CRT.Timeline.readable first, so nothing secret
-- reaches the API; a secret name, spell or icon is left out.
-- Nothing is sent while the game's timeline shows nothing: a rehearsal, the game's timeline turned off in its
-- options (IsFeatureEnabled), or its view type None (another addon replacing it). Then, and for any line not on the
-- game's timeline (not sent yet, or refused), our Alert timeline shows the line even with Also show off
-- (TimelineArea asks Game.ShowsHere), so no alert is on neither.
-- A /reload mid-pull: the event IDs on the game's timeline are kept in CRTDBChar.gameTimelineSent (id -> name),
-- cleared at a real login. After a reload they are taken back at ENCOUNTER_END or at the next run's start, each only
-- when the game still has it as a script event of that name (the name may be secret in a fight: then the ID alone).
-- Replace: the game's supported route, EncounterTimeline:SetAttribute("overrideViewType", None) and
-- C_EncounterTimeline.SetViewType(None) (EncounterTimelineMixin:UpdateSystemSettingViewType reads the attribute over
-- the Edit Mode choice). Any override another addon had set is remembered, and leaving Replace puts it back (or
-- clears ours), then the frame's own UpdateSystemSettingViewType sets the view type again. The game's frames are
-- never hidden, moved or re-skinned. Applied at login, out of combat only (it waits for PLAYER_REGEN_ENABLED), and
-- the game's timeline is never touched for a player who never chose Replace.
-- Settings, on the Alert timeline area (CRT.db.alerts.areas.timeline, defaults in CRT_Core/Core.lua): gameMode
-- ("standalone", "add" or "replace") and gameAlsoHere.
-- Sources: Gethe/wow-ui-source live, Blizzard_APIDocumentationGenerated/EncounterTimelineDocumentation.lua and
-- Blizzard_EncounterTimeline/EncounterTimeline.lua. The dev probe is CRT_Dev/Dev/GameTimelineProbe.lua.
--   Game:Sync()           sends, finishes and cancels to match the run now (on every engine change, and while
--                         lines are coming, every TICK seconds)
--   Game.ShowsHere(line)  -> whether our area shows the line
--   Game.Request(line, seconds) -> the AddScriptEvent table for a line due in `seconds`
--   Game:ApplyReplace()   sets or undoes Replace as saved; false when it has to wait or the game has no timeline
--   Game.Mode(s)          -> "standalone", "add" or "replace"

local Alerts = CRT.Alerts
local Areas = CRT.AlertAreas

local TEXT = {
    mode = "Mode",
    modeHelp = "Standalone shows your alerts on this timeline only. Add to the game's timeline puts them on the game's boss timeline too. Replace the game's timeline hides the game's one, so only this one shows. In combat, Replace waits until combat ends.",
    standalone = "Standalone",
    add = "Add to the game's timeline",
    replace = "Replace the game's timeline",
    alsoHere = "Also show the Alert timeline",
    alsoHereHelp = "Shows your alerts here as well as on the game's timeline. Off, an alert shows here only when the game's timeline can't show it.",
}

-- Tune in game.
local DEFAULT_LEAD = 10 -- seconds ahead when the area's Seconds on the line can't be read (its default)
local DEFAULT_CAP = 5   -- lines on the game's timeline at a time when the area's At once can't be read
local TICK = 0.2  -- seconds between checks while lines are coming
local QUESTION_ICON = 134400 -- INV_Misc_QuestionMark: an alert with no icon (the request needs a file ID)
local ATTRIBUTE = "overrideViewType"
-- The game's enums, with their numbers from the documentation for a client that lacks them.
local VIEW_NONE_FALLBACK = 0
local SCRIPT_SOURCE_FALLBACK = 1
local SEVERITY_FALLBACK = { Low = 0, Medium = 1, High = 2 }
local SEVERITY_BY_LEVEL = { [1] = "Low", [2] = "Medium", [3] = "High" } -- Rules.Priority's level: the last digit
local ICON_FALLBACK = { DeadlyEffect = 1, EnrageEffect = 2, BleedEffect = 4, MagicEffect = 8, DiseaseEffect = 16,
    CurseEffect = 32, PoisonEffect = 64, TankRole = 128, HealerRole = 256, DpsRole = 512 }
local MODES = { standalone = true, add = true, replace = true }
local MODE_OPTIONS = { { key = "standalone", label = TEXT.standalone }, { key = "add", label = TEXT.add },
    { key = "replace", label = TEXT.replace } }
local EMPTY = {}

local Game = { QUESTION_ICON = QUESTION_ICON, TEXT = TEXT }
CRT.AlertGameTimeline = Game

local sent = {}    -- line key -> the game's event ID, while it is on the game's timeline
local names = {}   -- line key -> the name it was sent with
local done = {}    -- line key -> true once finished, so it is never sent again this run
local failed = {}  -- line key -> true when the game refused it: it shows here instead
local runId        -- the run the tables above belong to
local orphans      -- after a /reload: { [id] = name } left on the game's timeline by the UI before it

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

local function modeOf(s)
    return MODES[s.gameMode] and s.gameMode or "standalone"
end

Game.Mode = modeOf

-- How far ahead lines are sent: the area's Seconds on the line.
local function leadOf(s)
    local T = CRT.AlertTimeline
    if T and T.Seconds then
        return T.Seconds(s)
    end
    return type(s.seconds) == "number" and s.seconds or DEFAULT_LEAD
end

-- How many lines may be on the game's timeline at a time: the area's At once (1 to 10).
local function capOf(s)
    local n = type(s.cap) == "number" and math.floor(s.cap) or DEFAULT_CAP
    return math.max(1, math.min(10, n))
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

local function viewNone()
    return enumValue("EncounterTimelineViewType", "None", VIEW_NONE_FALLBACK)
end

-- Whether the game's timeline shows anything: the player has it on, and its view type is not None.
local function gameShowing(C)
    if type(C.IsFeatureEnabled) == "function" then
        local ok, on = pcall(C.IsFeatureEnabled)
        if not (ok and readable(on) and on == true) then
            return false
        end
    end
    if type(C.GetViewType) == "function" then
        local ok, view = pcall(C.GetViewType)
        if ok and readable(view) and view == viewNone() then
            return false
        end
    end
    return true
end

-- Whether lines are being sent now, and the API when they are.
local function sending()
    local s = settings()
    if modeOf(s) ~= "add" or not Alerts.running or Alerts:IsRehearsal() then
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

-- The icons mask of a line's Journal tags (Reference.TAGS[tag].gameIcon), or nil for none.
local function iconMask(line)
    local tags = line.abilityTags
    local TAGS = CRT.TimelineReference and CRT.TimelineReference.TAGS
    if type(tags) ~= "table" or not TAGS then
        return nil
    end
    local seen, mask = {}, 0
    for _, key in ipairs(tags) do
        local name = TAGS[key] and TAGS[key].gameIcon
        if name and ICON_FALLBACK[name] and not seen[name] then
            seen[name] = true
            mask = mask + enumValue("EncounterEventIconmask", name, ICON_FALLBACK[name])
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

-- Session memory of what is on the game's timeline, kept through a /reload ------------------

local function store()
    if type(CRTDBChar) ~= "table" then
        return nil
    end
    if type(CRTDBChar.gameTimelineSent) ~= "table" then
        CRTDBChar.gameTimelineSent = {}
    end
    return CRTDBChar.gameTimelineSent
end

local function remember(id, name)
    local list = store()
    if list then
        list[id] = name or ""
    end
end

local function forget(id)
    local list = store()
    if list then
        list[id] = nil
    end
end

-- Takes back what the UI before a /reload left, each only while the game still has it as a script event of that
-- name, so another addon's event that took its ID is never touched.
local function cancelOrphans()
    if not orphans then
        return
    end
    local C = api()
    for id, name in pairs(orphans) do
        local ok, info = false, nil
        if C and type(C.GetEventInfo) == "function" then
            ok, info = pcall(C.GetEventInfo, id)
        end
        if ok and type(info) == "table" then
            local source, spellName = info.source, info.spellName
            local isScript = not readable(source) or source == enumValue("EncounterTimelineEventSource", "Script", SCRIPT_SOURCE_FALLBACK)
            local sameName = not readable(spellName) or spellName == name
            if isScript and sameName then
                call(C, "CancelScriptEvent", id)
            end
        end
        forget(id)
    end
    orphans = nil
end

Game.CancelOrphans = cancelOrphans

-- A new run starts clean; what an earlier run left on the game's timeline is taken back.
local function newRun(C)
    if runId == Alerts.runId then
        return
    end
    for key, id in pairs(sent) do
        call(C or api(), "CancelScriptEvent", id)
        forget(id)
        sent[key] = nil
    end
    names, done, failed = {}, {}, {}
    runId = Alerts.runId
    if Alerts.running then
        cancelOrphans()
    end
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
    local req = Game.Request(line, seconds)
    local ok, id = pcall(C.AddScriptEvent, req)
    if ok and readable(id) and type(id) == "number" and id > 0 then
        sent[key] = id
        names[key] = req.overrideName
        remember(id, req.overrideName)
        return true
    end
    failed[key] = true
    return false
end

local function byTime(a, b)
    return a.at < b.at
end

-- The run's timeline lines, soonest first.
local function timelineLines(now)
    local list = {}
    for _, line in ipairs(Alerts:Lines(now)) do
        local o = line.outputs
        if o and o.timeline and type(line.at) == "number" then
            list[#list + 1] = line
        end
    end
    table.sort(list, byTime)
    return list
end

function Game:Sync()
    local C = sending()
    newRun(C)
    local now = GetTime()
    local s = settings()
    local lead, cap = leadOf(s), capOf(s)
    local keep, coming = {}, false
    if C then
        local list = timelineLines(now)
        -- first what is on the game's timeline: finished at its time, else kept
        local live = 0
        for _, line in ipairs(list) do
            local key = keyOf(line)
            if sent[key] then
                if line.at - now <= 0 then
                    call(C, "FinishScriptEvent", sent[key])
                    forget(sent[key])
                    sent[key] = nil
                    done[key] = true
                else
                    keep[key] = true
                    live = live + 1
                end
            end
        end
        -- then the soonest new lines within reach, while there is room under At once
        for _, line in ipairs(list) do
            local key = keyOf(line)
            local left = line.at - now
            if not keep[key] and left > 0 and not done[key] and not failed[key] then
                if left > lead or live >= cap then
                    coming = true
                elseif add(C, line, key, left) then
                    keep[key] = true
                    live = live + 1
                end
            end
        end
    end
    -- gone from the run (cut, ended, turned off): off the game's timeline too
    for key, id in pairs(sent) do
        if not keep[key] then
            call(C or api(), "CancelScriptEvent", id)
            forget(id)
            sent[key] = nil
        end
    end
    setTicking(C ~= nil and (next(sent) ~= nil or coming))
end

-- In Add without Also show the Alert timeline, our area leaves out a line only while it is on the game's timeline
-- or after it finished there.
function Game.ShowsHere(line)
    local s = settings()
    if modeOf(s) ~= "add" or s.gameAlsoHere == true or not sending() then
        return true
    end
    local key = keyOf(line)
    return not (sent[key] or done[key])
end

-- Replace ------------------------------------------------------------------------------------

-- The view type again from the frame's own update, which reads the attribute over the Edit Mode choice.
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

local function getAttribute(frame)
    if type(frame.GetAttribute) ~= "function" then
        return false, nil
    end
    return pcall(frame.GetAttribute, frame, ATTRIBUTE)
end

function Game:ApplyReplace()
    local want = modeOf(settings()) == "replace"
    if not want and not self.replaced then
        return true -- Replace never chosen: the game's timeline is left as it is
    end
    local frame, C = EncounterTimeline, C_EncounterTimeline
    if type(frame) ~= "table" or type(frame.SetAttribute) ~= "function" or type(C) ~= "table" or type(C.SetViewType) ~= "function" then
        return false
    end
    if InCombatLockdown and InCombatLockdown() then
        self.frame:RegisterEvent("PLAYER_REGEN_ENABLED")
        return false
    end
    local none = viewNone()
    if want then
        if not self.replaced then
            -- another addon's override, put back when the Mode leaves Replace
            local ok, before = getAttribute(frame)
            self.before = (ok and before ~= none) and before or nil
        end
        pcall(frame.SetAttribute, frame, ATTRIBUTE, none)
        pcall(C.SetViewType, none)
        self.replaced = true
    else
        -- only our own value is replaced, so an override set since stays
        local ok, current = getAttribute(frame)
        if ok and current == none then
            pcall(frame.SetAttribute, frame, ATTRIBUTE, self.before)
        end
        self.before = nil
        restoreView(frame, C)
        self.replaced = false
    end
    return true
end

-- Settings rows --------------------------------------------------------------------------------

-- The rows on the Alert timeline area's settings (TimelineArea's settings call this).
function Game.SettingsRows(panel, s)
    panel:Dropdown(TEXT.mode, {
        options = MODE_OPTIONS,
        get = function()
            return modeOf(s)
        end,
        set = function(key)
            s.gameMode = key
            Game:ApplyReplace()
            Game:Sync()
        end,
        help = TEXT.modeHelp,
    })
    panel:Check(TEXT.alsoHere, function()
        return s.gameAlsoHere == true
    end, function(on)
        s.gameAlsoHere = on
    end, TEXT.alsoHereHelp, function()
        return modeOf(s) == "add"
    end)
end

local frame = CreateFrame("Frame")
Game.frame = frame
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("ENCOUNTER_END")
frame:SetScript("OnEvent", function(self, event, arg1, arg2)
    if event == "PLAYER_REGEN_ENABLED" then
        self:UnregisterEvent("PLAYER_REGEN_ENABLED")
        Game:ApplyReplace()
    elseif event == "PLAYER_LOGIN" or (event == "ADDON_LOADED" and arg1 == "Blizzard_EncounterTimeline") then
        Game:ApplyReplace()
    elseif event == "PLAYER_ENTERING_WORLD" then
        self:UnregisterEvent("PLAYER_ENTERING_WORLD")
        -- arg1 isInitialLogin, arg2 isReloadingUi: a login starts with nothing on the game's timeline
        local list = store()
        if arg2 and list and next(list) then
            orphans = {}
            for id, name in pairs(list) do
                orphans[id] = name
            end
        elseif list then
            CRTDBChar.gameTimelineSent = {}
        end
    elseif event == "ENCOUNTER_END" then
        cancelOrphans()
    end
end)

Alerts:OnChange(function()
    Game:Sync()
end)
