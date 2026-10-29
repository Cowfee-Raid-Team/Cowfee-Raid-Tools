local ADDON, CRT = ...

-- The Interrupts page, after Pace in the menu, shown only while Enable Interrupts is on (General Settings). Two tabs:
--   Assignments  the boss, the status bar (which list is in use and your kick), the kick list (groups x slots name
--                fields, each with a picker of your group), Clear list, Use the raid's list, Share to raid, Test on
--                trash and Preview reminder; on the right, Who has it (the Addon check's answers for the names on the
--                list) and How the numbers are worked out (the boss block, read-only)
--   Settings     the numbers above the nameplates, the reminder and sharing
-- The fields edit your own list, and are read-only in a group for anyone who can't share. A name the group has is in
-- its class colour. While the page is open it follows the group (GROUP_ROSTER_UPDATE, PARTY_LEADER_CHANGED) and the
-- enemy nameplates switch (CVAR_UPDATE). Game calls (warcraft.wiki.gg, read 2026-10-28): GetCVar("nameplateShowEnemies"),
-- GetDifficultyInfo(difficultyID) -> name, CVAR_UPDATE (cvarName, value), GROUP_ROSTER_UPDATE, PARTY_LEADER_CHANGED.

local UI = CRT.UI
local Interrupts = CRT.Interrupts
local Anchor = CRT.InterruptAnchor
local KickComm = CRT.InterruptComm

local Page = { fields = {}, pickers = {}, whoRows = {}, howLines = {}, tabs = {} }
CRT.InterruptsPage = Page

local TEXT = {
    title = "Interrupts",
    help = "Kick numbers above a boss's adds, a countdown before your own kick, and the raid leader's kick list.\n\nThe game hides every add's name and spells in a raid fight, so an add is known by when its first cast starts: each wave's adds cast in spawn order on a fixed beat after the wave starts. Two adds share each number. Left and Right can't be told apart, so your side is only in your reminder.\n\nNumbers only show for adds whose nameplate is on your screen when they first cast.",
    assignments = "Assignments",
    settings = "Settings",
    boss = "Boss",
    bossHelp = "The bosses with kick numbers, each on the one difficulty it works on.",
    noBoss = "No boss with kick numbers is loaded.",
    nameplatesOff = "Enemy nameplates are off (Interface > Nameplates), so no numbers can show.",
    statusNone = "No kick list for this boss yet.",
    statusOwn = "Your own kick list is in use.",
    statusRaid = "The raid's kick list from %s is in use.",
    yourKick = "Your kick: %s #%d %s.",
    notOn = "You are not on it.",
    kick = "%s #%d",
    gridHelp = "Type a name, or pick one from your group with the arrow. Names are kept without their realm. Each number is two adds in a row, so both players on it kick one add each.\n\nIn a group, only the raid leader and assistants can edit the list. Solo, the list is yours to test with.",
    clear = "Clear list",
    clearAsk = "Empty every name on your own kick list for %s?",
    useRaid = "Use the raid's list",
    useRaidAsk = "Copy the raid's kick list from %s over your own list for %s?",
    share = "Share to raid",
    shareHelp = "Sends your list to everyone in the group with CRT and Interrupts on. Only the raid leader or an assistant can share, with every slot filled, before the pull. A shared list sets each raider's number at once.",
    test = "Test on trash",
    testHelp = "Numbers any pack you fight: the first cast seen starts a wave, and every cast after it is numbered without the timing check. Turns off when you change zone.",
    preview = "Preview reminder",
    who = "Who has it",
    whoHelp = "The names on the list and whether their CRT has Interrupts on, from the Addon check on General Settings. Green: on. Orange: an older CRT, or Interrupts off. Red: no CRT.",
    check = "Check now",
    noNames = "No names on the list yet.",
    notHere = "not in your group",
    you = "you, v%s",
    on = "v%s",
    off = "Interrupts off",
    tooOld = "v%s, no Interrupts",
    older = "older CRT v%s",
    none = "No CRT",
    waiting = "asking...",
    offline = "offline",
    how = "How the numbers are worked out",
    howHelp = "The boss's timing as CRT ships it. If a hotfix moves the adds, numbers stop showing or land on the wrong adds until CRT is updated.",
    howAnchor = "A wave starts at cast %d of every %d from %s.",
    howFirst = "Add 1 casts %s s after it, then one every %s s.",
    howTolerance = "A cast more than %s s off its beat is not an add.",
    howAdds = "%d adds a wave, %d to a number.",
    howWindow = "A cast over %d s after the wave's start is not in it.",
    howFallback = "Without a cast count, waves start at %s.",
    plates = "Numbers above nameplates",
    platesHelp = "The box above each add's nameplate. Your kick is in your colours; the other numbers show only with Show every number.",
    platesOn = "Show numbers in the pull",
    all = "Show every number",
    allHelp = "Shows the other kicks' numbers too, in the other colours.",
    size = "Box size",
    font = "Number size",
    offset = "Height above the plate",
    yours = "Your kick",
    others = "Other kicks",
    box = "Box",
    number = "Number",
    reminder = "Reminder",
    reminderHelp = "Your interrupt's icon counts down the last 5 seconds before your pair's first cast, with your number and side. Move it with Previews.",
    reminderOn = "Count down before my kick",
    sound = "Sound",
    reminderSize = "Size",
    sharing = "Sharing",
    sharingHelp = "Ticked, a kick list the raid leader or an assistant shares replaces the raid's list here and sets your number. Your own list is never changed.",
    accept = "Accept kick lists from the leader and assistants",
    ok = "OK",
    cancel = "Cancel",
    confirm = "Interrupts",
    slashOff = "Interrupts is switched off. Tick Enable Interrupts on General Settings first.",
    soundNone = "None",
}
Page.TEXT = TEXT

local TAB_Y, CONTENT_Y = -36, -66
local LEFT_X, RIGHT_X = 8, 630
local RIGHT_W = UI.PAGE_W - RIGHT_X - 8
local COL_W = 300 -- one group's column of the kick list
local ROW_H = 30
local GRID_Y = -86
local STATUS_W = RIGHT_X - LEFT_X - 22
local WHO_ROWS = 12
local SET_X2 = 520 -- the Settings tab's second column

local page
local selected -- the boss shown
local controls = {}
local refresh

local function settings()
    return Interrupts:Settings()
end

local function boss()
    local list = Interrupts:Bosses()
    for _, b in ipairs(list) do
        if b.key == selected then
            return selected
        end
    end
    selected = list[1] and list[1].key or nil
    return selected
end

local function label(parent, text, font)
    local fs = parent:CreateFontString(nil, "OVERLAY", font or "CRTFontSmall")
    fs:SetJustifyH("LEFT")
    fs:SetText(text)
    return fs
end

-- A button as wide as its label.
local function button(parent, text, onClick)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontButtonSmall)
    b:SetHighlightFontObject(CRTFontButtonSmallHighlight)
    b:SetDisabledFontObject(CRTFontButtonSmallDisable)
    b:SetText(text)
    local fs = b:GetFontString()
    b:SetSize(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0), 22)
    b:SetScript("OnClick", onClick)
    return b
end

local function checkbox(parent, x, y, text, get, set)
    local cb = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
    cb:SetSize(24, 24)
    cb:SetPoint("TOPLEFT", x, y)
    cb.label = label(parent, text)
    cb.label:SetPoint("LEFT", cb, "RIGHT", 2, 0)
    cb:SetScript("OnClick", function(self)
        set(self:GetChecked() and true or false)
    end)
    cb.refresh = function()
        cb:SetChecked(get() and true or false)
    end
    controls[#controls + 1] = cb
    return cb
end

local function add(row, x, y)
    row:SetPoint("TOPLEFT", x, y)
    controls[#controls + 1] = row
    return row
end

local function changed()
    Interrupts:Fire("settings")
    refresh()
end

-- The status bar ------------------------------------------------------------------------------------------------

local function nameplatesOff()
    if not GetCVar then
        return false
    end
    local ok, v = pcall(GetCVar, "nameplateShowEnemies")
    return ok and CRT.Comm.Readable(v) and v == "0"
end

-- The status bar's text and kind ("good", "warn" or "neutral") for a boss.
function Page.Status(encounterID)
    if nameplatesOff() then
        return TEXT.nameplatesOff, "warn"
    end
    if not encounterID then
        return TEXT.noBoss, "neutral"
    end
    local _, source = Interrupts:List(encounterID)
    if not source then
        return TEXT.statusNone, "neutral"
    end
    local def = Interrupts:Def(encounterID)
    local n, group = Interrupts:Mine(encounterID)
    local kick = n and string.format(TEXT.yourKick, def.label, n, group or "") or TEXT.notOn
    if source == "raid" then
        local shared = Interrupts:Shared(encounterID)
        return string.format(TEXT.statusRaid, shared and shared.from or "?") .. " " .. kick, n and "good" or "warn"
    end
    return TEXT.statusOwn .. " " .. kick, "warn"
end

-- The group, for the pickers and the name colours ----------------------------------------------------------------

local function roster()
    local rows = CRT.AddonCheck and CRT.AddonCheck:Roster() or {}
    local out = {}
    for _, row in ipairs(rows) do
        out[#out + 1] = { name = Interrupts.CleanName(row.name), class = row.class, row = row }
    end
    table.sort(out, function(a, b)
        return a.name:lower() < b.name:lower()
    end)
    return out
end

local function memberOf(name, list)
    if name == "" then
        return nil
    end
    name = name:lower()
    for _, m in ipairs(list) do
        if m.name:lower() == name then
            return m
        end
    end
    return nil
end

local function classColor(class)
    local c = class and RAID_CLASS_COLORS and RAID_CLASS_COLORS[class]
    if c then
        return c.r, c.g, c.b
    end
    return 1, 1, 1
end

local function canEdit()
    return not CRT.Comm.Channel() or CRT.Comm.IsLeaderOrAssist("player")
end

-- A confirm dialog: one window, made the first time.
local dialog
local function confirm(text, onAccept)
    if not dialog then
        dialog = UI.Window("CowfeeRaidToolsKickConfirm", { kind = "dialog", title = TEXT.confirm, width = 420, height = 150 })
        dialog.msg = label(dialog.content, "", "CRTFontNormal")
        dialog.msg:SetPoint("TOPLEFT", 8, -8)
        dialog.msg:SetPoint("TOPRIGHT", -8, -8)
        dialog.ok = button(dialog.content, TEXT.ok, function()
            dialog:Hide()
            if dialog.onAccept then
                dialog.onAccept()
            end
        end)
        dialog.ok:SetPoint("BOTTOMRIGHT", dialog.content, "BOTTOM", -4, 4)
        dialog.cancel = button(dialog.content, TEXT.cancel, function()
            dialog:Hide()
        end)
        dialog.cancel:SetPoint("BOTTOMLEFT", dialog.content, "BOTTOM", 4, 4)
    end
    dialog.msg:SetText(text)
    dialog.onAccept = onAccept
    dialog:Show()
end
Page.Confirm = confirm

-- Assignments ------------------------------------------------------------------------------------------------------

local function difficultyName(id)
    if GetDifficultyInfo then
        local ok, name = pcall(GetDifficultyInfo, id)
        if ok and CRT.Comm.Readable(name) and type(name) == "string" and name ~= "" then
            return name
        end
    end
    return "difficulty " .. tostring(id)
end

local function bossOptions()
    local out = {}
    for _, b in ipairs(Interrupts:Bosses()) do
        local def = Interrupts:Def(b.key)
        out[#out + 1] = { key = b.key, label = b.label .. " \194\183 " .. difficultyName(def.difficulty) }
    end
    return out
end
Page.BossOptions = bossOptions

local function buildStatus(f)
    local bar = CreateFrame("Frame", nil, f, "BackdropTemplate")
    bar:SetPoint("TOPLEFT", LEFT_X, -46)
    bar:SetSize(STATUS_W, 28)
    bar:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    UI.Tint(bar, "SetBackdropColor", "surface", 0.6)
    UI.Tint(bar, "SetBackdropBorderColor", "border")
    local text = label(bar, "")
    text:SetPoint("LEFT", 8, 0)
    text:SetWidth(STATUS_W - 16)
    text:SetWordWrap(false)
    Page.status = text
    controls[#controls + 1] = { refresh = function()
        local s, kind = Page.Status(boss())
        Page.statusKind = kind
        text:SetText(kind == "good" and UI.GoodText(s) or kind == "warn" and UI.WarnText(s) or s)
    end }
end

local function buildSlot(f, def, g, s, x, y)
    local num = label(f, string.format(TEXT.kick, def.label, s))
    num:SetPoint("TOPLEFT", x, y - 4)
    num:SetWidth(56)
    local edit = CreateFrame("EditBox", nil, f, "InputBoxTemplate")
    edit:SetSize(140, 22)
    edit:SetPoint("TOPLEFT", x + 64, y)
    edit:SetAutoFocus(false)
    edit:SetFontObject(CRTFontEdit)
    edit:SetMaxLetters(48)
    local function save(self)
        self:ClearFocus()
        if boss() then
            Interrupts:SetName(boss(), g, s, self:GetText())
        end
    end
    edit:SetScript("OnEnterPressed", save)
    edit:SetScript("OnEditFocusLost", function(self)
        if boss() then
            Interrupts:SetName(boss(), g, s, self:GetText())
        end
    end)
    edit:SetScript("OnEscapePressed", function(self)
        self:ClearFocus()
    end)
    Page.fields[g] = Page.fields[g] or {}
    Page.fields[g][s] = edit
    local pick = UI.Dropdown(f, "", { labelWidth = 0, width = 70,
        options = function()
            local out = { { key = "", label = "-" } }
            for _, m in ipairs(roster()) do
                local r, gr, b = classColor(m.class)
                local function byte(v)
                    return math.floor(v * 255 + 0.5)
                end
                out[#out + 1] = { key = m.name, label = string.format("|cff%02x%02x%02x%s|r", byte(r), byte(gr), byte(b), m.name) }
            end
            return out
        end,
        get = function()
            local own = boss() and Interrupts:Own(boss())
            return own and own[g][s] or ""
        end,
        set = function(name)
            if boss() then
                Interrupts:SetName(boss(), g, s, name)
            end
        end,
        enabledIf = canEdit })
    pick:SetPoint("TOPLEFT", x + 210, y + 5)
    Page.pickers[#Page.pickers + 1] = pick
end

local function refreshGrid()
    local id = boss()
    local own = id and Interrupts:Own(id)
    local group = roster()
    local editable = canEdit()
    for g, col in pairs(Page.fields) do
        for s, edit in pairs(col) do
            local name = own and own[g] and own[g][s] or ""
            if not edit:HasFocus() then
                edit:SetText(name)
            end
            local m = memberOf(name, group)
            edit:SetTextColor(classColor(m and m.class))
            edit:SetEnabled(editable and id ~= nil)
        end
    end
    for _, pick in ipairs(Page.pickers) do
        pick.refresh()
    end
end

local function buildGrid(f)
    local def = boss() and Interrupts:Def(boss())
    if not def then
        return
    end
    for g, name in ipairs(def.groups) do
        local x = LEFT_X + (g - 1) * COL_W
        local head = label(f, name, "CRTFontNormal")
        head:SetPoint("TOPLEFT", x, GRID_Y)
        if g == 1 then
            UI.HelpRight(head, TEXT.title, TEXT.gridHelp)
        end
        for s = 1, def.slots do
            buildSlot(f, def, g, s, x, GRID_Y - 22 - (s - 1) * ROW_H)
        end
    end
    controls[#controls + 1] = { refresh = refreshGrid }
end

-- The (?) of a greyed button says why: b.crtReason.
local function reasonTip(b, title)
    b:SetScript("OnEnter", function(self)
        UI.TooltipOwner(GameTooltip, self, "ANCHOR_TOP")
        GameTooltip:SetText(title, 1, 1, 1)
        if self.crtReason then
            GameTooltip:AddLine(self.crtReason, 0.85, 0.85, 0.85, true)
        end
        GameTooltip:Show()
    end)
    b:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
end

local function buildButtons(f, y)
    local clear = button(f, TEXT.clear, function()
        local id = boss()
        if id then
            confirm(string.format(TEXT.clearAsk, Interrupts:BossName(id)), function()
                Interrupts:Clear(id)
            end)
        end
    end)
    clear:SetPoint("TOPLEFT", LEFT_X, y)
    local useRaid = button(f, TEXT.useRaid, function()
        local id = boss()
        local shared = id and Interrupts:Shared(id)
        if shared then
            confirm(string.format(TEXT.useRaidAsk, shared.from or "?", Interrupts:BossName(id)), function()
                Interrupts:CopyRaids(id)
            end)
        end
    end)
    useRaid:SetPoint("LEFT", clear, "RIGHT", 6, 0)
    local share = button(f, TEXT.share, function()
        if boss() then
            KickComm:Share(boss())
        end
    end)
    share:SetPoint("LEFT", useRaid, "RIGHT", 6, 0)
    reasonTip(share, TEXT.share)
    UI.HelpRight(share, TEXT.share, TEXT.shareHelp)
    Page.share, Page.clear, Page.useRaid = share, clear, useRaid
    controls[#controls + 1] = { refresh = function()
        local id = boss()
        local ok, why = false, TEXT.noBoss
        if id then
            ok, why = KickComm:CanShare(id)
        end
        share:SetEnabled(ok and true or false)
        share.crtReason = (not ok) and why or nil
        clear:SetEnabled(id ~= nil and canEdit())
        useRaid:SetEnabled(id ~= nil and Interrupts:Shared(id) ~= nil)
    end }
end

local function whoText(name, group)
    local m = memberOf(name, group)
    if not m then
        return UI.ColorText(TEXT.notHere, "muted")
    end
    local state, version, modules = CRT.AddonCheck:Status(m.row, m.row.online)
    version = tostring(version or "?")
    local on = modules and modules.interrupts
    if state == "you" or state == "same" or state == "newer" then
        if on == true then
            return UI.GoodText(string.format(state == "you" and TEXT.you or TEXT.on, version))
        end
        return UI.WarnText(on == false and TEXT.off or string.format(TEXT.tooOld, version))
    elseif state == "older" then
        return UI.WarnText(string.format(TEXT.older, version))
    elseif state == "none" then
        return UI.BadText(TEXT.none)
    elseif state == "offline" then
        return UI.ColorText(TEXT.offline, "muted")
    end
    return UI.ColorText(TEXT.waiting, "muted")
end
Page.WhoText = whoText

local function refreshWho()
    local id = boss()
    local list = id and Interrupts:List(id)
    local names = {}
    for _, col in ipairs(list or {}) do
        for _, name in ipairs(col) do
            if name ~= "" then
                names[#names + 1] = name
            end
        end
    end
    local group = roster()
    for i, row in ipairs(Page.whoRows) do
        local name = names[i]
        if i == 1 and not name then
            row.name:SetText(UI.ColorText(TEXT.noNames, "muted"))
            row.state:SetText("")
        else
            local m = name and memberOf(name, group)
            row.name:SetText(name or "")
            row.name:SetTextColor(classColor(m and m.class))
            row.state:SetText(name and whoText(name, group) or "")
        end
    end
end

local function buildWho(f)
    local head = label(f, TEXT.who, "CRTFontNormal")
    head:SetPoint("TOPLEFT", RIGHT_X, -8)
    UI.HelpRight(head, TEXT.who, TEXT.whoHelp)
    local check = button(f, TEXT.check, function()
        if CRT.AddonCheck then
            CRT.AddonCheck:Check()
        end
    end)
    check:SetPoint("TOPRIGHT", f, "TOPLEFT", RIGHT_X + RIGHT_W, -4)
    for i = 1, WHO_ROWS do
        local y = -32 - (i - 1) * 18
        local row = { name = label(f, ""), state = label(f, "") }
        row.name:SetPoint("TOPLEFT", RIGHT_X, y)
        row.name:SetWidth(190)
        row.name:SetWordWrap(false)
        row.state:SetPoint("TOPLEFT", RIGHT_X + 196, y)
        row.state:SetWidth(RIGHT_W - 196)
        row.state:SetJustifyH("RIGHT")
        row.state:SetWordWrap(false)
        Page.whoRows[i] = row
    end
    controls[#controls + 1] = { refresh = refreshWho }
end

local function seconds(v)
    return (string.format("%.1f", v):gsub("%.0$", ""))
end

local function clock(t)
    return string.format("%d:%02d", math.floor(t / 60), math.floor(t % 60))
end

-- The boss block, as lines for How the numbers are worked out.
function Page.HowLines(def)
    if not def then
        return {}
    end
    local times = {}
    for _, t in ipairs(def.anchor.times) do
        times[#times + 1] = clock(t)
    end
    return {
        string.format(TEXT.howAnchor, def.anchor.ordinal, def.anchor.cycle, def.anchor.unit),
        string.format(TEXT.howFirst, seconds(def.firstCast), seconds(def.spacing)),
        string.format(TEXT.howTolerance, seconds(def.tolerance)),
        string.format(TEXT.howAdds, def.adds, def.perNumber),
        string.format(TEXT.howWindow, def.window),
        string.format(TEXT.howFallback, table.concat(times, ", ")),
    }
end

local function buildHow(f)
    local y = -32 - WHO_ROWS * 18 - 20
    local head = label(f, TEXT.how, "CRTFontNormal")
    head:SetPoint("TOPLEFT", RIGHT_X, y)
    UI.HelpRight(head, TEXT.how, TEXT.howHelp)
    for i = 1, 6 do
        local fs = label(f, "")
        fs:SetPoint("TOPLEFT", RIGHT_X, y - 22 - (i - 1) * 18)
        fs:SetWidth(RIGHT_W)
        fs:SetWordWrap(false)
        Page.howLines[i] = fs
    end
    controls[#controls + 1] = { refresh = function()
        local lines = Page.HowLines(boss() and Interrupts:Def(boss()))
        for i, fs in ipairs(Page.howLines) do
            fs:SetText(lines[i] or "")
        end
    end }
end

local function buildAssignments(f)
    local bossRow = UI.Dropdown(f, TEXT.boss, { options = bossOptions, labelWidth = 40, width = 300,
        get = function()
            return boss()
        end,
        set = function(id)
            selected = id
            refresh()
        end })
    add(bossRow, LEFT_X, -8)
    Page.bossRow = bossRow
    -- the boss block's own note (why only that difficulty), from its season-pack file
    UI.HelpRight(bossRow, TEXT.boss, function()
        local def = boss() and Interrupts:Def(boss())
        local note = def and type(def.note) == "string" and def.note or nil
        return note and (TEXT.bossHelp .. "\n\n" .. note) or TEXT.bossHelp
    end)
    buildStatus(f)
    buildGrid(f)
    local def = boss() and Interrupts:Def(boss())
    local bottom = GRID_Y - 22 - ((def and def.slots or 5) - 1) * ROW_H - 22
    buildButtons(f, bottom - 16)
    local test = checkbox(f, LEFT_X - 4, bottom - 54, TEXT.test, function()
        return settings().test
    end, function(on)
        settings().test = on
        if on then
            Anchor:StartTest()
        else
            Anchor:StopTest()
        end
        refresh()
    end)
    UI.HelpRight(test, TEXT.test, TEXT.testHelp)
    Page.test = test
    local preview = button(f, TEXT.preview, function()
        CRT.InterruptReminder:Preview()
    end)
    preview:SetPoint("TOPLEFT", LEFT_X + COL_W, bottom - 54)
    Page.preview = preview
    buildWho(f)
    buildHow(f)
end

-- Settings -----------------------------------------------------------------------------------------------------------

local function heading(f, x, y, text, help)
    local fs = label(f, text, "CRTFontNormal")
    fs:SetPoint("TOPLEFT", x, y)
    UI.HelpRight(fs, text, help)
    return fs
end

-- A colour swatch for one of the player's box colours (saved RGBA, not a theme colour).
local function swatch(f, x, y, text, key)
    local name = label(f, text)
    name:SetPoint("TOPLEFT", x, y - 2)
    local b = CreateFrame("Button", nil, f, "BackdropTemplate")
    b:SetSize(36, 18)
    b:SetPoint("LEFT", name, "RIGHT", 6, 0)
    b:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    b:SetBackdropBorderColor(0, 0, 0, 1) -- the swatch's edge: not a theme colour
    b.refresh = function()
        local c = settings().plates[key]
        b:SetBackdropColor(c[1], c[2], c[3], c[4] or 1)
    end
    b:SetScript("OnClick", function()
        UI.PickColor(settings().plates[key], function(c)
            settings().plates[key] = c
            changed()
        end, { hasOpacity = true })
    end)
    controls[#controls + 1] = b
    return b
end

local function slider(f, x, y, text, holder, key, low, high)
    return add(UI.Slider(f, text, { min = low, max = high, labelWidth = 150, width = 160,
        get = function()
            return holder()[key]
        end,
        set = function(v)
            holder()[key] = v
            changed()
        end }), x, y)
end

local function plates()
    return settings().plates
end

local function reminder()
    return settings().reminder
end

local function buildSettings(f)
    heading(f, LEFT_X, -8, TEXT.plates, TEXT.platesHelp)
    checkbox(f, LEFT_X - 4, -28, TEXT.platesOn, function()
        return plates().on
    end, function(on)
        plates().on = on
        changed()
    end)
    local all = checkbox(f, LEFT_X - 4, -52, TEXT.all, function()
        return plates().all
    end, function(on)
        plates().all = on
        changed()
    end)
    UI.HelpRight(all, TEXT.all, TEXT.allHelp)
    slider(f, LEFT_X, -80, TEXT.size, plates, "size", 10, 100)
    slider(f, LEFT_X, -114, TEXT.font, plates, "font", 8, 60)
    slider(f, LEFT_X, -148, TEXT.offset, plates, "offset", -100, 100)
    local yours = label(f, TEXT.yours, "CRTFontNormal")
    yours:SetPoint("TOPLEFT", LEFT_X, -192)
    yours:SetWidth(100)
    swatch(f, LEFT_X + 104, -192, TEXT.box, "mineBox")
    swatch(f, LEFT_X + 204, -192, TEXT.number, "mineText")
    local others = label(f, TEXT.others, "CRTFontNormal")
    others:SetPoint("TOPLEFT", LEFT_X, -222)
    others:SetWidth(100)
    swatch(f, LEFT_X + 104, -222, TEXT.box, "box")
    swatch(f, LEFT_X + 204, -222, TEXT.number, "text")

    heading(f, SET_X2, -8, TEXT.reminder, TEXT.reminderHelp)
    checkbox(f, SET_X2 - 4, -28, TEXT.reminderOn, function()
        return reminder().on
    end, function(on)
        reminder().on = on
        changed()
    end)
    add(UI.SoundDropdown(f, TEXT.sound, { none = TEXT.soundNone, labelWidth = 80, width = 200, playButton = true, help = true,
        get = function()
            return reminder().sound
        end,
        set = function(key)
            reminder().sound = key
            changed()
        end }), SET_X2, -56)
    add(UI.Slider(f, TEXT.reminderSize, { min = 16, max = 128, labelWidth = 80, width = 160,
        get = function()
            return reminder().size
        end,
        set = function(v)
            reminder().size = v
            changed()
        end }), SET_X2, -92)
    heading(f, SET_X2, -144, TEXT.sharing, TEXT.sharingHelp)
    checkbox(f, SET_X2 - 4, -164, TEXT.accept, function()
        return settings().accept
    end, function(on)
        settings().accept = on
        refresh()
    end)
end

-- The page -------------------------------------------------------------------------------------------------------------

local TABS = { { key = "assignments", label = TEXT.assignments }, { key = "settings", label = TEXT.settings } }

local function selectTab(key)
    for _, tab in ipairs(TABS) do
        local on = tab.key == key
        Page.tabs[tab.key].frame:SetShown(on)
        UI:SetTabSelected(Page.tabs[tab.key].button, on)
    end
    Page.tab = key
    refresh()
end
Page.SelectTab = selectTab

refresh = function()
    if not page or not page:IsShown() then
        return
    end
    for _, c in ipairs(controls) do
        c.refresh()
    end
end
Page.Refresh = function()
    refresh()
end

local function makeTab(pf, i, tab)
    local b = CreateFrame("Button", nil, pf, "BackdropTemplate")
    b:SetSize(160, 26)
    b:SetPoint("TOPLEFT", 8 + (i - 1) * 164, TAB_Y)
    b:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    b.sel = b:CreateTexture(nil, "ARTWORK")
    b.sel:SetAllPoints()
    b.sel:SetColorTexture(UI.Color("heading", 0.18)) -- UI:RegisterTab styles it from here on
    b.text = b:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    b.text:SetPoint("CENTER")
    b.text:SetText(tab.label)
    b:SetScript("OnClick", function()
        selectTab(tab.key)
    end)
    UI:RegisterTab(b)
    local f = CreateFrame("Frame", nil, pf)
    f:SetPoint("TOPLEFT", 0, CONTENT_Y)
    f:SetPoint("BOTTOMRIGHT", 0, 0)
    f:Hide()
    Page.tabs[tab.key] = { button = b, frame = f, label = tab.label }
    return f
end

local function build(pf)
    page = pf
    local title = label(pf, TEXT.title, "CRTFontLarge")
    title:SetPoint("TOPLEFT", 8, -8)
    UI.HelpRight(title, TEXT.title, TEXT.help)
    buildAssignments(makeTab(pf, 1, TABS[1]))
    buildSettings(makeTab(pf, 2, TABS[2]))
    local line = pf:CreateTexture(nil, "ARTWORK")
    UI.Tint(line, "SetColorTexture", "border")
    line:SetHeight(1)
    line:SetPoint("TOPLEFT", 8, CONTENT_Y + 4)
    line:SetPoint("TOPRIGHT", -8, CONTENT_Y + 4)

    -- while the page is open: the group (names, who may edit and share) and the nameplates switch
    local watch = CreateFrame("Frame")
    watch:SetScript("OnEvent", function(_, event, cvar)
        if event == "CVAR_UPDATE" and cvar ~= "nameplateShowEnemies" then
            return
        end
        refresh()
    end)
    pf:SetScript("OnShow", function()
        for _, e in ipairs({ "GROUP_ROSTER_UPDATE", "PARTY_LEADER_CHANGED", "CVAR_UPDATE" }) do
            watch:RegisterEvent(e)
        end
        if CRT.AddonCheck then
            CRT.AddonCheck:MaybeCheck()
        end
        selectTab(Page.tab or "assignments")
    end)
    pf:SetScript("OnHide", function()
        watch:UnregisterAllEvents()
        if dialog then
            dialog:Hide()
        end
    end)
    Interrupts:OnChange(refresh)
    if CRT.AddonCheck then
        CRT.AddonCheck:OnChange(refresh)
    end
    CRT.Bosses:OnRouteChange(refresh)
    if pf:IsShown() then
        pf:GetScript("OnShow")(pf)
    end
end

UI:RegisterPage("interrupts", TEXT.title, build)
-- hidden until Enable Interrupts is on: Data.lua shows it at login from the saved switch, and on every change
UI:SetPageHidden("interrupts", true)

-- /crt interrupts (CRT_Core/Slash.lua's registry)
if CRT.Slash then
    CRT.Slash:Register("interrupts", {
        run = function(rest)
            if rest ~= "" then
                return false
            end
            if not Interrupts:Enabled() then
                CRT:Print(TEXT.slashOff)
                UI:Show("settings")
                return
            end
            UI:Show("interrupts")
        end,
        help = { "[/crt interrupts] - kick numbers above the adds and the kick list" },
    })
end
