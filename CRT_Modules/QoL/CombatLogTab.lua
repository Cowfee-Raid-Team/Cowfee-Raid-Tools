local ADDON, CRT = ...

-- Quality of Life > Combat log: the settings of automatic combat logging (QoL/CombatLog.lua, CRTDB.qol.combatLog).
-- Left: Log combat automatically, the raid and dungeon ticks and Stop when I leave, greyed while the master is off.
-- Right: Setup (Advanced Combat Logging, read live on show, and the combat log's last known state, with a button for
-- each), Now (what the log is doing and why) and Say in chat. The page (QoL/Page.lua) calls Build with its tab frame,
-- its controls list and its refresh. The combat log's state is never asked for here: only the buttons call the game,
-- one call per click, since the game allows few calls.

local UI = CRT.UI

local TEXT = {
    enable = "Log combat automatically",
    enableNote = "Starts the game's combat log when you enter content ticked below, so your log is written without typing /combatlog. Ticking it also turns on the game's Advanced Combat Logging, which log sites need. The log is a WoWCombatLog file in the game's Logs folder.",
    raids = "Raids",
    dungeons = "Dungeons",
    stopOnLeave = "Stop when I leave",
    stopOnLeaveNote = "Stops the log when you leave that content, but only a log CRT started. A log you started yourself, with /combatlog or Start logging now, is never stopped.",
    setup = "Setup",
    setupIntro = "What the combat log needs.",
    acl = "Advanced combat logging",
    aclTip = "The game's setting in Options > System > Network. Log sites need it for full details.",
    log = "Combat log",
    logTip = "Whether the game is writing the log, as CRT last saw it. The game lets addons ask only a few times in 10 seconds, so CRT asks when you enter content you ticked, not all the time.",
    aclLine = "Advanced combat logging: %s",
    logLine = "Combat log: %s",
    on = "On",
    off = "Off",
    unknown = "not checked yet",
    turnOn = "Turn on advanced logging",
    start = "Start logging now",
    stop = "Stop logging",
    now = "Now",
    announce = "Say in chat when logging starts or stops",
}

local COLUMN_X = 480 -- the right column
local LINE_W = 480

local function checkRow(pf, x, y, text)
    local check = CreateFrame("CheckButton", nil, pf, "UICheckButtonTemplate")
    check:SetSize(24, 24)
    check:SetPoint("TOPLEFT", x, y)
    check.label = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    check.label:SetPoint("LEFT", check, "RIGHT", 1, 0)
    check.label:SetText(text)
    return check
end

-- A box that is greyed while the master tick is off.
local function setLive(check, live)
    check:SetEnabled(live)
    check.label:SetFontObject(live and CRTFontSmall or CRTFontDisableSmall)
end

local function heading(pf, x, y, text)
    local fs = pf:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    fs:SetPoint("TOPLEFT", x, y)
    fs:SetText(text)
    return fs
end

-- Left column: the master tick, the ticks under it, Stop when I leave.
local function buildTicks(pf, top, controls, refresh)
    local CombatLog = CRT.CombatLog
    local function s()
        return CRT.db.qol.combatLog
    end

    local enable = checkRow(pf, 6, top, TEXT.enable)
    enable:SetScript("OnClick", function(self)
        CombatLog:SetEnabled(self:GetChecked())
        refresh()
    end)
    enable.refresh = function()
        enable:SetChecked(s().enabled and true or false)
    end
    controls[#controls + 1] = enable
    UI.HelpRight(enable.label, TEXT.enable, TEXT.enableNote)

    local y = top - 32
    for _, group in ipairs({ { key = "raid", title = TEXT.raids }, { key = "dungeon", title = TEXT.dungeons } }) do
        heading(pf, 12, y, group.title)
        y = y - 18
        for _, tick in ipairs(CombatLog.TICKS[group.key]) do
            local check = checkRow(pf, 18, y, tick.label)
            check:SetScript("OnClick", function(self)
                s()[group.key][tick.key] = self:GetChecked() and true or false
            end)
            check.refresh = function()
                check:SetChecked(s()[group.key][tick.key] and true or false)
                setLive(check, s().enabled and true or false)
            end
            controls[#controls + 1] = check
            y = y - 24
        end
        y = y - 10
    end

    local stop = checkRow(pf, 6, y - 4, TEXT.stopOnLeave)
    stop:SetScript("OnClick", function(self)
        s().stopOnLeave = self:GetChecked() and true or false
    end)
    stop.refresh = function()
        stop:SetChecked(s().stopOnLeave and true or false)
        setLive(stop, s().enabled and true or false)
    end
    controls[#controls + 1] = stop
    UI.HelpRight(stop.label, TEXT.stopOnLeave, TEXT.stopOnLeaveNote)
end

local function onOff(v)
    if v == true then
        return UI.GoodText(TEXT.on)
    elseif v == false then
        return UI.BadText(TEXT.off)
    end
    return TEXT.unknown
end

-- Right column: Setup with its two lines and buttons, Now, Say in chat.
local function buildSetup(pf, top, controls, refresh)
    local CombatLog = CRT.CombatLog
    local x = COLUMN_X

    local title = heading(pf, x, top, TEXT.setup)
    UI.HelpRight(title, TEXT.setup, { TEXT.setupIntro, { TEXT.acl, TEXT.aclTip }, { TEXT.log, TEXT.logTip } })

    local aclLine = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    aclLine:SetPoint("TOPLEFT", x + 2, top - 24)
    local logLine = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    logLine:SetPoint("TOPLEFT", x + 2, top - 44)

    local result -- what the last button click did
    local turnOn = UI.PanelButton(pf, TEXT.turnOn, 22, function()
        CombatLog:TurnOnAdvanced()
        refresh()
    end)
    turnOn:SetPoint("TOPLEFT", x, top - 66)
    local toggle
    toggle = UI.PanelButton(pf, TEXT.start, 22, function()
        local ok, message
        if CombatLog:Status().logging == true then
            ok, message = CombatLog:StopNow()
        else
            ok, message = CombatLog:StartNow()
        end
        result = ok and UI.GoodText(message) or UI.BadText(message)
        refresh()
    end)
    toggle:SetPoint("LEFT", turnOn, "RIGHT", 8, 0)
    local resultText = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    resultText:SetPoint("TOPLEFT", x + 2, top - 96)
    resultText:SetWidth(LINE_W)
    resultText:SetJustifyH("LEFT")

    heading(pf, x, top - 124, TEXT.now)
    local nowLine = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    nowLine:SetPoint("TOPLEFT", x + 2, top - 146)
    nowLine:SetWidth(LINE_W)
    nowLine:SetJustifyH("LEFT")

    local say = checkRow(pf, x - 2, top - 176, TEXT.announce)
    say:SetScript("OnClick", function(self)
        CRT.db.qol.combatLog.announce = self:GetChecked() and true or false
    end)
    say.refresh = function()
        say:SetChecked(CRT.db.qol.combatLog.announce and true or false)
    end
    controls[#controls + 1] = say

    controls[#controls + 1] = {
        refresh = function()
            local acl = CombatLog:AdvancedOn() -- the CVar, read live
            local status = CombatLog:Status()
            aclLine:SetText(string.format(TEXT.aclLine, onOff(acl)))
            logLine:SetText(string.format(TEXT.logLine, onOff(status.logging)))
            turnOn:SetEnabled(acl ~= true)
            toggle:SetText(status.logging == true and TEXT.stop or TEXT.start)
            local fs = toggle:GetFontString()
            toggle:SetWidth(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0))
            resultText:SetText(result or "")
            nowLine:SetText(CombatLog:NowText())
        end,
    }
end

CRT.CombatLogTab = {
    Build = function(pf, controls, refresh)
        buildTicks(pf, -8, controls, refresh)
        buildSetup(pf, -8, controls, refresh)
    end,
}
