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

local Page = { fields = {}, pickers = {}, slotLabels = {}, headings = {}, whoRows = {}, howLines = {}, tabs = {} }
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

-- Every place and size on the page, from the page's top left (UI.PAGE_W x UI.PAGE_H); the tab frames start at contentY.
local LAYOUT = {
    tabY = -36, contentY = -66, tabW = 160, tabH = 26, tabGap = 4,
    leftX = 8, rightX = 630,
    bossY = -8, bossLabelW = 40, bossW = 300,
    statusY = -46, statusH = 28,
    -- the kick list: Lattice.MAX_GROUPS columns of Lattice.MAX_SLOTS rows, pooled; a boss shows what its block has
    gridY = -86, headH = 22, colW = 300, rowH = 30, fieldH = 22, labelW = 56, editX = 64, editW = 140,
    pickX = 210, pickW = 70, pickDY = 5,
    buttonGap = 16, buttonH = 22, buttonSpace = 6, testGap = 38,
    -- the right column
    whoY = -8, whoTop = -32, whoRowH = 18, whoNameW = 190, whoStateX = 196, howGap = 20, howHeadH = 22, howRowH = 18, howLines = 6,
    -- the Settings tab
    setX2 = 520, setLabelW = 150, setControlW = 160, swatchW = 36, swatchH = 18, swatchLabelW = 100, swatchStep = 100,
    platesY = { head = -8, on = -28, all = -52, size = -80, font = -114, offset = -148, yours = -192, others = -222 },
    reminderY = { head = -8, on = -28, sound = -56, size = -92, sharing = -144, accept = -164 },
    reminderLabelW = 80, soundW = 200,
    checkSize = 24, checkInset = 4,
}
LAYOUT.rightW = UI.PAGE_W - LAYOUT.rightX - 8
LAYOUT.statusW = LAYOUT.rightX - LAYOUT.leftX - 22
LAYOUT.whoRows = CRT.InterruptLattice.MAX_GROUPS * CRT.InterruptLattice.MAX_SLOTS
Page.LAYOUT = LAYOUT
local L = LAYOUT
local TAB_Y, CONTENT_Y = L.tabY, L.contentY
local MAX_GROUPS, MAX_SLOTS = CRT.InterruptLattice.MAX_GROUPS, CRT.InterruptLattice.MAX_SLOTS

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
    b:SetSize(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0), L.buttonH)
    b:SetScript("OnClick", onClick)
    return b
end

-- enabledIf, when given, greys the box and its label while it returns false (the switch it depends on is off).
local function checkbox(parent, x, y, text, get, set, enabledIf)
    local cb = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
    cb:SetSize(L.checkSize, L.checkSize)
    cb:SetPoint("TOPLEFT", x, y)
    cb.label = label(parent, text)
    cb.label:SetPoint("LEFT", cb, "RIGHT", 2, 0)
    cb:SetScript("OnClick", function(self)
        set(self:GetChecked() and true or false)
    end)
    cb.refresh = function()
        cb:SetChecked(get() and true or false)
        if enabledIf then
            local on = enabledIf() and true or false
            cb:SetEnabled(on)
            local c = on and 1 or 0.5
            cb.label:SetTextColor(c, c, c)
        end
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

-- C_CVar.GetCVar (warcraft.wiki.gg: the namespaced call since 8.1.5; the global is FrameXML's wrapper of it).
local function nameplatesOff()
    local get = (C_CVar and C_CVar.GetCVar) or GetCVar
    if not get then
        return false
    end
    local ok, v = pcall(get, "nameplateShowEnemies")
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
    bar:SetPoint("TOPLEFT", L.leftX, L.statusY)
    bar:SetSize(L.statusW, L.statusH)
    bar:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    UI.Tint(bar, "SetBackdropColor", "surface", 0.6)
    UI.Tint(bar, "SetBackdropBorderColor", "border")
    local text = label(bar, "")
    text:SetPoint("LEFT", 8, 0)
    text:SetWidth(L.statusW - 16)
    text:SetWordWrap(false)
    Page.status = text
    controls[#controls + 1] = { refresh = function()
        local s, kind = Page.Status(boss())
        Page.statusKind = kind
        text:SetText(kind == "good" and UI.GoodText(s) or kind == "warn" and UI.WarnText(s) or s)
    end }
end

local function colorByte(v)
    return math.floor(v * 255 + 0.5)
end

-- One slot of the pool: its Kick #N label, its name field and its picker, at group g's column and row s.
local function buildSlot(f, g, s)
    local x, y = L.leftX + (g - 1) * L.colW, L.gridY - L.headH - (s - 1) * L.rowH
    local num = label(f, "")
    num:SetPoint("TOPLEFT", x, y - 4)
    num:SetWidth(L.labelW)
    local edit = CreateFrame("EditBox", nil, f, "InputBoxTemplate")
    edit:SetSize(L.editW, L.fieldH)
    edit:SetPoint("TOPLEFT", x + L.editX, y)
    edit:SetAutoFocus(false)
    edit:SetFontObject(CRTFontEdit)
    edit:SetMaxLetters(48)
    UI:SkinEditBox(edit)
    local function save(self)
        if boss() then
            Interrupts:SetName(boss(), g, s, self:GetText())
        end
    end
    edit:SetScript("OnEnterPressed", function(self)
        self:ClearFocus()
        save(self)
    end)
    edit:SetScript("OnEditFocusLost", save)
    edit:SetScript("OnEscapePressed", function(self)
        self:ClearFocus()
    end)
    local pick = UI.Dropdown(f, "", { labelWidth = 0, width = L.pickW,
        options = function()
            local out = { { key = "", label = "-" } }
            for _, m in ipairs(roster()) do
                local r, gr, b = classColor(m.class)
                out[#out + 1] = { key = m.name, label = string.format("|cff%02x%02x%02x%s|r", colorByte(r), colorByte(gr), colorByte(b), m.name) }
            end
            return out
        end,
        get = function()
            local own = boss() and Interrupts:Own(boss())
            return own and own[g] and own[g][s] or ""
        end,
        set = function(name)
            if boss() then
                Interrupts:SetName(boss(), g, s, name)
            end
        end,
        enabledIf = canEdit })
    pick:SetPoint("TOPLEFT", x + L.pickX, y + L.pickDY)
    Page.fields[g][s], Page.slotLabels[g][s], Page.pickers[g][s] = edit, num, pick
end

-- The rows under the kick list follow its height: Clear list (Use the raid's list and Share follow it), Test on trash
-- and Preview reminder.
local function placeBelow(slots)
    local y = L.gridY - L.headH - (slots - 1) * L.rowH - L.fieldH - L.buttonGap
    if Page.clear then
        Page.clear:ClearAllPoints()
        Page.clear:SetPoint("TOPLEFT", L.leftX, y)
    end
    if Page.test then
        Page.test:ClearAllPoints()
        Page.test:SetPoint("TOPLEFT", L.leftX - L.checkInset, y - L.testGap)
        Page.preview:ClearAllPoints()
        Page.preview:SetPoint("TOPLEFT", L.leftX + L.colW, y - L.testGap)
    end
end

-- The kick list in the shape of the boss shown: the pooled fields its block has, the rest hidden.
local function refreshGrid()
    local id = boss()
    local def = id and Interrupts:Def(id)
    local own = id and Interrupts:Own(id)
    local group = roster()
    local editable = canEdit()
    local groups, slots = def and #def.groups or 0, def and def.slots or 0
    for g = 1, MAX_GROUPS do
        Page.headings[g]:SetShown(g <= groups)
        Page.headings[g]:SetText(def and def.groups[g] or "")
        for s = 1, MAX_SLOTS do
            local on = g <= groups and s <= slots
            local edit, pick = Page.fields[g][s], Page.pickers[g][s]
            Page.slotLabels[g][s]:SetShown(on)
            edit:SetShown(on)
            pick:SetShown(on)
            if on then
                Page.slotLabels[g][s]:SetText(string.format(TEXT.kick, def.label, s))
                local name = own[g][s] or ""
                if not edit:HasFocus() then
                    edit:SetText(name)
                end
                local m = memberOf(name, group)
                edit:SetTextColor(classColor(m and m.class))
                edit:SetEnabled(editable)
                pick.refresh()
            end
        end
    end
    placeBelow(math.max(slots, 1))
end

local function buildGrid(f)
    for g = 1, MAX_GROUPS do
        local head = label(f, "", "CRTFontNormal")
        head:SetPoint("TOPLEFT", L.leftX + (g - 1) * L.colW, L.gridY)
        Page.headings[g] = head
        if g == 1 then
            UI.HelpRight(head, TEXT.title, TEXT.gridHelp)
        end
        Page.fields[g], Page.slotLabels[g], Page.pickers[g] = {}, {}, {}
        for s = 1, MAX_SLOTS do
            buildSlot(f, g, s)
        end
    end
    controls[#controls + 1] = { refresh = refreshGrid }
end

-- The tooltip of a button says why it is greyed: b.crtReason. A disabled button gets no OnEnter unless told to.
local function reasonTip(b, title)
    if b.SetMotionScriptsWhileDisabled then
        b:SetMotionScriptsWhileDisabled(true)
    end
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

local function buildButtons(f)
    local clear = button(f, TEXT.clear, function()
        local id = boss()
        if id then
            confirm(string.format(TEXT.clearAsk, Interrupts:BossName(id)), function()
                Interrupts:Clear(id)
            end)
        end
    end)
    local useRaid = button(f, TEXT.useRaid, function()
        local id = boss()
        local shared = id and Interrupts:Shared(id)
        if shared then
            confirm(string.format(TEXT.useRaidAsk, shared.from or "?", Interrupts:BossName(id)), function()
                Interrupts:CopyRaids(id)
            end)
        end
    end)
    useRaid:SetPoint("LEFT", clear, "RIGHT", L.buttonSpace, 0)
    local share = button(f, TEXT.share, function()
        if boss() then
            KickComm:Share(boss())
        end
    end)
    share:SetPoint("LEFT", useRaid, "RIGHT", L.buttonSpace, 0)
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
    head:SetPoint("TOPLEFT", L.rightX, L.whoY)
    UI.HelpRight(head, TEXT.who, TEXT.whoHelp)
    local check = button(f, TEXT.check, function()
        if CRT.AddonCheck then
            CRT.AddonCheck:Check()
        end
    end)
    check:SetPoint("TOPRIGHT", f, "TOPLEFT", L.rightX + L.rightW, L.whoY + 4)
    for i = 1, L.whoRows do
        local y = L.whoTop - (i - 1) * L.whoRowH
        local row = { name = label(f, ""), state = label(f, "") }
        row.name:SetPoint("TOPLEFT", L.rightX, y)
        row.name:SetWidth(L.whoNameW)
        row.name:SetWordWrap(false)
        row.state:SetPoint("TOPLEFT", L.rightX + L.whoStateX, y)
        row.state:SetWidth(L.rightW - L.whoStateX)
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
    local y = L.whoTop - L.whoRows * L.whoRowH - L.howGap
    local head = label(f, TEXT.how, "CRTFontNormal")
    head:SetPoint("TOPLEFT", L.rightX, y)
    UI.HelpRight(head, TEXT.how, TEXT.howHelp)
    for i = 1, L.howLines do
        local fs = label(f, "")
        fs:SetPoint("TOPLEFT", L.rightX, y - L.howHeadH - (i - 1) * L.howRowH)
        fs:SetWidth(L.rightW)
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
    local bossRow = UI.Dropdown(f, TEXT.boss, { options = bossOptions, labelWidth = L.bossLabelW, width = L.bossW,
        get = function()
            return boss()
        end,
        set = function(id)
            selected = id
            refresh()
        end })
    add(bossRow, L.leftX, L.bossY)
    Page.bossRow = bossRow
    -- the boss block's own note (why only that difficulty), from its season-pack file
    UI.HelpRight(bossRow, TEXT.boss, function()
        local def = boss() and Interrupts:Def(boss())
        local note = def and type(def.note) == "string" and def.note or nil
        return note and (TEXT.bossHelp .. "\n\n" .. note) or TEXT.bossHelp
    end)
    buildStatus(f)
    buildButtons(f)
    local test = checkbox(f, L.leftX - L.checkInset, 0, TEXT.test, function()
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
    Page.preview = button(f, TEXT.preview, function()
        CRT.InterruptReminder:Preview()
    end)
    -- the grid last among the left column's refreshes, so it places the rows under it once they exist
    buildGrid(f)
    placeBelow(MAX_SLOTS)
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

local function plates()
    return settings().plates
end

local function reminder()
    return settings().reminder
end

local function platesOn()
    return plates().on
end

local function reminderOn()
    return reminder().on
end

-- A colour swatch for one of the player's box colours (saved RGBA, not a theme colour).
local function swatch(f, x, y, text, key)
    local name = label(f, text)
    name:SetPoint("TOPLEFT", x, y - 2)
    local b = CreateFrame("Button", nil, f, "BackdropTemplate")
    b:SetSize(L.swatchW, L.swatchH)
    b:SetPoint("LEFT", name, "RIGHT", 6, 0)
    b:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    b:SetBackdropBorderColor(0, 0, 0, 1) -- the swatch's edge: not a theme colour
    b.refresh = function()
        local c = plates()[key]
        b:SetBackdropColor(c[1], c[2], c[3], c[4] or 1)
        b:SetEnabled(platesOn() and true or false)
    end
    b:SetScript("OnClick", function()
        UI.PickColor(plates()[key], function(c)
            plates()[key] = c
            changed()
        end, { hasOpacity = true })
    end)
    controls[#controls + 1] = b
    return b
end

local function slider(f, x, y, text, holder, key, low, high, labelW, enabledIf)
    return add(UI.Slider(f, text, { min = low, max = high, labelWidth = labelW or L.setLabelW, width = L.setControlW,
        enabledIf = enabledIf,
        get = function()
            return holder()[key]
        end,
        set = function(v)
            holder()[key] = v
            changed()
        end }), x, y)
end

local function swatchRow(f, y, text, boxKey, textKey)
    local name = label(f, text, "CRTFontNormal")
    name:SetPoint("TOPLEFT", L.leftX, y)
    name:SetWidth(L.swatchLabelW)
    swatch(f, L.leftX + L.swatchLabelW + 4, y, TEXT.box, boxKey)
    swatch(f, L.leftX + L.swatchLabelW + 4 + L.swatchStep, y, TEXT.number, textKey)
end

local function buildPlatesSettings(f)
    local Y, x = L.platesY, L.leftX
    heading(f, x, Y.head, TEXT.plates, TEXT.platesHelp)
    checkbox(f, x - L.checkInset, Y.on, TEXT.platesOn, platesOn, function(on)
        plates().on = on
        changed()
    end)
    local all = checkbox(f, x - L.checkInset, Y.all, TEXT.all, function()
        return plates().all
    end, function(on)
        plates().all = on
        changed()
    end, platesOn)
    UI.HelpRight(all, TEXT.all, TEXT.allHelp)
    Page.allCheck = all
    slider(f, x, Y.size, TEXT.size, plates, "size", 10, 100, nil, platesOn)
    slider(f, x, Y.font, TEXT.font, plates, "font", 8, 60, nil, platesOn)
    slider(f, x, Y.offset, TEXT.offset, plates, "offset", -100, 100, nil, platesOn)
    swatchRow(f, Y.yours, TEXT.yours, "mineBox", "mineText")
    swatchRow(f, Y.others, TEXT.others, "box", "text")
end

local function buildReminderSettings(f)
    local Y, x = L.reminderY, L.setX2
    heading(f, x, Y.head, TEXT.reminder, TEXT.reminderHelp)
    checkbox(f, x - L.checkInset, Y.on, TEXT.reminderOn, reminderOn, function(on)
        reminder().on = on
        changed()
    end)
    add(UI.SoundDropdown(f, TEXT.sound, { none = TEXT.soundNone, labelWidth = L.reminderLabelW, width = L.soundW, playButton = true,
        help = true, enabledIf = reminderOn,
        get = function()
            return reminder().sound
        end,
        set = function(key)
            reminder().sound = key
            changed()
        end }), x, Y.sound)
    slider(f, x, Y.size, TEXT.reminderSize, reminder, "size", 16, 128, L.reminderLabelW, reminderOn)
    heading(f, x, Y.sharing, TEXT.sharing, TEXT.sharingHelp)
    checkbox(f, x - L.checkInset, Y.accept, TEXT.accept, function()
        return settings().accept
    end, function(on)
        settings().accept = on
        refresh()
    end)
end

local function buildSettings(f)
    buildPlatesSettings(f)
    buildReminderSettings(f)
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
    b:SetSize(L.tabW, L.tabH)
    b:SetPoint("TOPLEFT", L.leftX + (i - 1) * (L.tabW + L.tabGap), TAB_Y)
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
