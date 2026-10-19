local ADDON, CRT = ...

-- The Loot Master page (/crt lootmaster), with three tabs:
--   Tonight       the running session (or none), and buttons to test, open the looter window, show your
--                 popup and end the session; CRT Looting's state, with the leader's Turn on / Turn off
--                 for everyone (LootMaster/Looting.lua)
--   Raider Score  every player's score from the Late Tracker's nights (LootMaster/Score.lua)
--   Settings      the response buttons raiders see (label, colour, weight, icon, order), how long they
--                 have to answer, the award message, the Raider Score weights, loot authority, and the
--                 leader's Sync Master Loot (LootMaster/Sync.lua)
-- Laid out for the main window's page area (1026 x 560) with nothing scrolling but the score list.
-- Layout numbers are in L; wording in TEXT.

local LM = CRT.LootMaster
local UI = CRT.UI

local L = {
    tabW = 150, tabH = 26, tabTop = -36, body = -66,
    col1 = 8, col2 = 430, col3 = 724,
    respRow = 30, respTop = -30,
    label = 104, weight = 40, icon = 120,
    sliderLabel = 118, sliderW = 110,
    scoreRow = 20,
    authorityRows = LM.AUTHORITY_MAX, -- named players with loot authority
    -- the Loot authority Add row: "Add", the guild dropdown, then a box filling the rest of the column
    addLabel = 30, addPick = 146, addGap = 12, addEdge = 4, -- addGap: the box's border art starts ~5 left of it
    dropdownGap = 5, -- UI.Dropdown's gap between its label and the dropdown
    previewLines = 4, -- the award preview is cut after this many lines, so it never reaches Sync
    -- Sync Master Loot, in the second column under the award message: "Sync to", the dropdown, a box
    syncTop = -306, syncLabel = 46, syncPick = 124,
}
L.col3W = UI.PAGE_W - L.col3 - 8 -- the third column, to the page's right margin
L.col2W = L.col3 - L.col2 - 12 -- the second column, with a gap before the third

local TEXT = {
    title = "Loot Master",
    help = "Run the loot: the raid leader gives each boss item out from one window, and every raider with CRT answers from a popup. Settings has the buttons raiders see and the Raider Score weights.\n\n/crt loot test tries it with sample items.",
    tonight = "Tonight",
    score = "Raider Score",
    settings = "Settings",
    session = "Loot session",
    sessionHelp = "The session you are running. Test sends sample items marked TEST to you and everyone with CRT; nothing is passed or traded.",
    none = "No loot session is running.",
    running = "%s%d items, %d of %d raiders with CRT, %d answers in",
    testTag = "TEST · ",
    test = "Test", window = "Looter window", popup = "My popup", endSession = "End session",
    items = "Items",
    crtLooting = "CRT Looting",
    crtLootingHelp = "When CRT Looting is on, every raider with CRT will pass the game's roll so the raid leader gets each boss item to give out. Only the raid leader turns it on or off, for everyone, in a raid instance; CRT asks them on the way in. It starts off after a /reload, until the leader's next word. A wipe keeps it on while the leader is out of the instance for up to 10 minutes.\n\nThis version shows the state only. It doesn't pass any roll yet.",
    turnOn = "Turn on", turnOff = "Turn off for everyone",
    awarded = "given to %s (%s)",
    open = "open",
    scoreHelp = "Built from the Late Tracker's saved nights: everyone starts at 100, a late arrival and a no-show cost points, and points come back every week. Change the weights on the Settings tab. Players with no night in the time counted have no score.",
    scoreEmpty = "No Late Tracker nights in the time counted yet.",
    responses = "Response buttons",
    responsesHelp = "The buttons raiders see, in this order. Weight sorts the looter's list, higher first. Click the colour to change it. Icon picks one of the game's loot icons (Need, Greed, Transmog, Disenchant, Pass), shown inside the button. At most 8 buttons; the last one (Pass at first) always weighs 0 and can't be removed, and you can rename it, to Transmog for example. Every answer gets a roll, and you can give an item for any of them.\n\nYour buttons are sent with each session you start, so raiders always see the leader's set.",
    add = "Add", reset = "Defaults",
    looting = "Looting",
    lootingHelp = "How long raiders have to answer an item before its popup closes.",
    responseTime = "Time to answer",
    scoreSettings = "Raider Score",
    scoreSettingsHelp = "Each night counted where a player was expected: a no-show costs the No-show points, a late arrival the Late points plus the Per 10 min points for every full ten minutes. Each penalty shrinks by Back each week, a week at a time. Only the last weeks you pick count.",
    showScore = "Show the Score column",
    authority = "Loot authority",
    authorityHelp = "Who may run loot: start a session, give items out, show popups again, roll again, end it. Everyone else gets the raider window only.\n\nRaiders only accept a session from the current raid leader, or from a name on the list the raid leader's CRT sends. Your own list only counts while you lead, so officers who lead should keep the same list. No list received means the leader only.",
    authorityLeader = "The raid leader",
    authorityAlso = "Also these players:",
    authorityAdd = "Add",
    authorityPick = "Pick a guild member",
    authorityType = "Type a name",
    authorityNone = "(nobody yet)",
    late = "Late", per10 = "Per 10 min", noShow = "No-show", recover = "Back each week", weeks = "Count the last",
    colLabel = "Label", colWeight = "Weight", colIcon = "Icon",
    noIcon = "No icon",
    guildStream = "Guild: %s",
    specs = "Items a raider can't use",
    specsHelp = "CRT always answers these for raiders. Each raider's own CRT answers an item for them when they can't use it, and leaves it off their popup. The game's data shows it in one of four ways: none of their specs is listed (a tank trinket for a mage), a Classes line without their class, an armor type that isn't their class's, or a weapon type the game marks in red for their class. The looter window shows it with an 'auto' tag and why.\n\nThe answer is always Transmog: your own Transmog button when you have one (or a button labelled Transmog), else a built-in Transmog that weighs 1 (below every button you weighted above 0). A looter on an older CRT with no Transmog button gets Pass. Every answer gets a roll.\n\nOnly a clear answer from the game counts. If the item hasn't loaded, or the game gives no list, an empty list or anything odd, the item is shown as normal.\n\nRaiders who tick Show me items I can't use see those items with their buttons off: they can look, not answer.",
    showAll = "Show me items I can't use (greyed out, just for you)",
    partyHelp = "CRT Looting is for raid groups. With Enable in party on, a party's leader can turn it on in a raid instance too, and your CRT follows a party leader who did. Off by default. Finder groups never count.",
    enableInParty = "Enable in party",
    award = "Award message",
    awardHelp = "Sent when you give an item out. %i is the item, %p the player, %r their answer (BiS, Upgrade...), and %v their roll. Your guild's own channels (from the Guild & Communities window) are listed too; picking one adds it to your chat so CRT can post there. When the place you pick isn't open to you (Raid out of a raid, a channel you left, chat locked in an encounter), only you see it, with the reason. In a test only you see it.",
    awardVars = "%i item   %p player   %r answer   %v roll",
    channel = "Send to",
    noRoll = "If no roll, %v is",
    preview = "Preview:",
    channels = {
        { key = "RAID", label = "Raid" }, { key = "RAID_WARNING", label = "Raid warning" }, { key = "PARTY", label = "Party" },
        { key = "GUILD", label = "Guild" }, { key = "OFFICER", label = "Officer" }, { key = "SELF", label = "Only you" },
        { key = "NONE", label = "Don't send" },
    },
    sync = "Sync Master Loot",
    syncHelp = "Only the raid leader can sync. It sends your Loot Master settings to the player you pick and to everyone on your Loot authority list who is in the group, and replaces theirs: the response buttons, Time to answer, the award message, Send to, the no-roll text, the Raider Score weights and the Loot authority list.\n\nTheir window places, their sort and their Show me items I can't use box stay their own. A player only takes a sync from their current raid leader.\n\nThe list has the group members whose CRT can take a sync. For anyone else, type their name. After a few seconds the line under the button says who got it.",
    syncTo = "Sync to",
    syncPickOne = "Pick a player",
    syncNobody = "(no one with CRT found yet)",
    syncType = "Type a name",
}

local page
local tabButtons, tabFrames = {}, {}
local currentTab = "tonight"
local refreshers = {}

local function skin(frame, alpha)
    frame:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    frame:SetBackdropColor(0, 0, 0, alpha or 0.5)
    frame:SetBackdropBorderColor(0.35, 0.35, 0.35, 1)
end

local function makeButton(parent, label, width)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontStandard)
    b:SetHighlightFontObject(CRTFontStandardHighlight)
    b:SetDisabledFontObject(CRTFontStandardDisable)
    b:SetSize(width, 24)
    b:SetText(label)
    return b
end

local function heading(f, x, y, text, help)
    local h = f:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    h:SetPoint("TOPLEFT", x, y)
    h:SetText(text)
    if help then
        UI.Help(f, text, help):SetPoint("LEFT", h, "RIGHT", 6, 0)
    end
    return h
end

local function check(f, x, y, text, get, set)
    local c = CreateFrame("CheckButton", nil, f, "UICheckButtonTemplate")
    c:SetSize(24, 24)
    c:SetPoint("TOPLEFT", x, y)
    c.label = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    c.label:SetPoint("LEFT", c, "RIGHT", 2, 0)
    c.label:SetText(text)
    c:SetScript("OnClick", function(self)
        set(self:GetChecked() and true or false)
    end)
    refreshers[#refreshers + 1] = function()
        c:SetChecked(get() and true or false)
    end
    return c
end

-- placeholder (optional): grey text shown in the empty box while it doesn't have focus.
local function editBox(parent, width, onCommit, placeholder)
    local e = CreateFrame("EditBox", nil, parent, "InputBoxTemplate")
    e:SetAutoFocus(false)
    e:SetFontObject(CRTFontHighlight)
    e:SetSize(width, 20)
    local hint
    local function showHint()
        if hint then
            hint:SetShown(not e:HasFocus() and (e:GetText() or "") == "")
        end
    end
    local function commit(self)
        self:ClearFocus()
        onCommit(strtrim(self:GetText() or ""))
    end
    e:SetScript("OnEnterPressed", commit)
    e:SetScript("OnEditFocusLost", function(self)
        onCommit(strtrim(self:GetText() or ""))
        showHint()
    end)
    e:SetScript("OnEscapePressed", function(self)
        self:ClearFocus()
    end)
    if placeholder then
        hint = e:CreateFontString(nil, "OVERLAY", "CRTFontHighlight")
        hint:SetPoint("LEFT", 1, 0)
        hint:SetTextColor(0.5, 0.5, 0.5)
        hint:SetText(placeholder)
        e:HookScript("OnEditFocusGained", showHint) -- hooked: the template's own handlers still run
        e:HookScript("OnTextChanged", showHint)
        e.showHint = showHint
    end
    return e
end

-- Makes an edit box as tall as another control, its template's border art too (the art keeps its own
-- height otherwise). Art the template doesn't have is skipped.
local function matchHeight(e, h)
    e:SetHeight(h)
    for _, key in ipairs({ "Left", "Middle", "Right" }) do
        local art = e[key]
        if type(art) == "table" and art.SetHeight then
            art:SetHeight(h)
        end
    end
end

-- Tonight -------------------------------------------------------------------------------------------

local function buildTonight(f)
    heading(f, L.col1, -8, TEXT.session, TEXT.sessionHelp)
    local status = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    status:SetPoint("TOPLEFT", L.col1, -34)
    status:SetWidth(400)
    status:SetJustifyH("LEFT")
    local x = L.col1
    for _, spec in ipairs({
        { TEXT.test, 70, function() LM:Test() end },
        { TEXT.window, 120, function() LM:ShowWindow() end },
        { TEXT.popup, 100, function() LM:ShowPopup() end },
        { TEXT.endSession, 110, function() LM:End() end },
    }) do
        local b = makeButton(f, spec[1], spec[2])
        b:SetPoint("TOPLEFT", x, -58)
        b:SetScript("OnClick", spec[3])
        x = x + spec[2] + 6
    end
    -- CRT Looting: the state, and the leader's button
    heading(f, L.col3, -8, TEXT.crtLooting, TEXT.crtLootingHelp)
    local looting = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    looting:SetPoint("TOPLEFT", L.col3, -34)
    looting:SetWidth(L.col3W)
    looting:SetJustifyH("LEFT")
    local toggle = UI.PanelButton(f, TEXT.turnOn, 24, function()
        if LM:LootingOn() then
            LM:ChooseLooting(false, "off")
        else
            LM:ChooseLooting(true)
        end
    end)
    toggle:SetPoint("TOPLEFT", looting, "BOTTOMLEFT", 4, -8) -- under the line, however many lines it takes
    refreshers[#refreshers + 1] = function()
        looting:SetText((LM:LootingStatus()))
        local leader = IsInGroup() and UnitIsGroupLeader("player")
        toggle:SetShown(leader and true or false)
        toggle:SetText(LM:LootingOn() and TEXT.turnOff or TEXT.turnOn)
        local fs = toggle:GetFontString()
        toggle:SetWidth(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0))
        toggle:SetEnabled(LM:LootingOn() or (LM:CanRunLooting()) or false)
    end
    heading(f, L.col1, -100, TEXT.items)
    local lines = {}
    for i = 1, LM.MAX_ITEMS do
        local fs = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        fs:SetPoint("TOPLEFT", L.col1, -100 - i * 20)
        fs:SetWidth(600)
        fs:SetJustifyH("LEFT")
        fs:SetWordWrap(false)
        lines[i] = fs
    end
    refreshers[#refreshers + 1] = function()
        local s = LM.current
        if not s then
            status:SetText(TEXT.none)
            for _, fs in ipairs(lines) do
                fs:SetText("")
            end
            return
        end
        local crt, answers = 0, 0
        for _, p in pairs(s.players) do
            if p.crt then
                crt = crt + 1
            end
        end
        for i in ipairs(s.items) do
            answers = answers + s:Answered(i)
        end
        status:SetText(string.format(TEXT.running, s.test and TEXT.testTag or "", #s.items, crt, #s.order, answers))
        for i, fs in ipairs(lines) do
            local it = s.items[i]
            if it then
                local _, link = C_Item.GetItemInfo(it.itemString or "")
                local state = TEXT.open
                if it.award then
                    local r = s:Response(it.award.response)
                    state = string.format(TEXT.awarded, Ambiguate(it.award.name, "short"), r and r.label or it.award.response)
                end
                fs:SetText((link or it.itemString) .. "  |cffaaaaaa" .. state .. "|r")
            else
                fs:SetText("")
            end
        end
    end
end

-- Raider Score ----------------------------------------------------------------------------------------

local SCORE_COLS = {
    { key = "name", x = 4, w = 180, title = "Player" },
    { key = "score", x = 188, w = 60, title = "Score" },
    { key = "nights", x = 252, w = 60, title = "Nights" },
    { key = "late", x = 316, w = 60, title = "Late" },
    { key = "never", x = 380, w = 70, title = "No-show" },
    { key = "last", x = 454, w = 110, title = "Last miss" },
}

local SCORE_VALUES = {
    name = function(t) return t.name:lower() end,
    score = function(t) return t.score end,
    nights = function(t) return t.nights end,
    late = function(t) return t.late end,
    never = function(t) return t.never end,
    last = function(t) return t.lastMiss or 0 end,
}

local refresh -- the page's refresh, set below

local function buildScore(f)
    heading(f, L.col1, -8, TEXT.score, TEXT.scoreHelp)
    local sorter = UI.SortHeaders(f, SCORE_COLS, {
        x = L.col1, y = -36,
        get = function()
            local s = LM:Settings().sort
            return s.scoreKey or "score", s.scoreDir or 1
        end,
        set = function(key, dir)
            local s = LM:Settings().sort
            s.scoreKey, s.scoreDir = key, dir
            refresh()
        end,
    })
    local empty = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    empty:SetPoint("TOPLEFT", L.col1 + 4, -62)
    empty:SetText(TEXT.scoreEmpty)
    local box = CreateFrame("Frame", nil, f, "WowScrollBoxList")
    box:SetPoint("TOPLEFT", L.col1, -56)
    box:SetSize(580, 1)
    box:SetPoint("BOTTOM", 0, 8)
    local back = CreateFrame("Frame", nil, f, "BackdropTemplate")
    back:SetPoint("TOPLEFT", box, -2, 2)
    back:SetPoint("BOTTOMRIGHT", box, 2, -2)
    back:SetFrameLevel(math.max(0, box:GetFrameLevel() - 1))
    skin(back, 0.35)
    local bar = CreateFrame("EventFrame", nil, f, "MinimalScrollBar")
    bar:SetPoint("TOPLEFT", box, "TOPRIGHT", 8, 0)
    bar:SetPoint("BOTTOMLEFT", box, "BOTTOMRIGHT", 8, 0)
    local v = CreateScrollBoxListLinearView()
    v:SetElementExtent(L.scoreRow)
    v:SetElementInitializer("Frame", function(row, t)
        if not row.cols then
            row.cols = {}
            for _, c in ipairs(SCORE_COLS) do
                local fs = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
                fs:SetPoint("LEFT", c.x, 0)
                fs:SetWidth(c.w)
                fs:SetJustifyH("LEFT")
                fs:SetWordWrap(false)
                row.cols[c.key] = fs
            end
        end
        row.cols.name:SetText(Ambiguate(t.name, "short"))
        local s = t.score
        row.cols.score:SetText(s >= 90 and ("|cff1eff00" .. s .. "|r") or (s >= 70 and ("|cffffd100" .. s .. "|r") or ("|cffff6040" .. s .. "|r")))
        row.cols.nights:SetText(t.nights)
        row.cols.late:SetText(t.late)
        row.cols.never:SetText(t.never)
        row.cols.last:SetText(t.lastMiss and date("%Y-%m-%d", t.lastMiss) or "")
    end)
    ScrollUtil.InitScrollBoxListWithScrollBar(box, bar, v)
    refreshers[#refreshers + 1] = function()
        if not f:IsVisible() then
            return
        end
        local list = LM.ScoreList()
        local s = LM:Settings().sort
        local key, dir = s.scoreKey or "score", s.scoreDir or 1
        local value = SCORE_VALUES[key]
        if value then
            table.sort(list, function(a, b)
                local x, y = value(a), value(b)
                if x == y then
                    return a.name:lower() < b.name:lower()
                end
                if dir < 0 then
                    return x > y
                end
                return x < y
            end)
        end
        sorter.refresh()
        empty:SetShown(#list == 0)
        box:SetDataProvider(CreateDataProvider(list))
    end
end

-- Settings -------------------------------------------------------------------------------------------

local respRows = {}
local NO_ICON = "~none~" -- the icon dropdown's key for no icon

-- A small square button with a character on it (move up / down).
local function smallButton(parent, text)
    local b = CreateFrame("Button", nil, parent, "BackdropTemplate")
    b:SetSize(18, 18)
    skin(b, 0.5)
    b.text = b:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    b.text:SetPoint("CENTER", 0, 1)
    b.text:SetText(text)
    b:SetHighlightTexture("Interface\\Buttons\\WHITE8X8")
    b:GetHighlightTexture():SetVertexColor(1, 1, 1, 0.15)
    b:SetScript("OnEnable", function(self)
        self.text:SetAlpha(1)
    end)
    b:SetScript("OnDisable", function(self)
        self.text:SetAlpha(0.3)
    end)
    return b
end

local function responseRow(f, i)
    local r = respRows[i]
    if r then
        return r
    end
    r = CreateFrame("Frame", nil, f)
    r:SetSize(400, L.respRow)
    r:SetPoint("TOPLEFT", L.col1, L.respTop - 20 - (i - 1) * L.respRow)
    r.up = smallButton(r, "^")
    r.up:SetPoint("LEFT", 0, 0)
    r.down = smallButton(r, "v")
    r.down:SetPoint("LEFT", r.up, "RIGHT", 2, 0)
    r.swatch = CreateFrame("Button", nil, r, "BackdropTemplate")
    r.swatch:SetSize(20, 20)
    r.swatch:SetPoint("LEFT", r.down, "RIGHT", 8, 0)
    r.swatch:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    r.swatch:SetBackdropBorderColor(0, 0, 0, 1)
    r.label = editBox(r, L.label, function(text)
        if r.key and text ~= "" then
            LM:UpdateResponse(r.key, { label = text })
        end
    end)
    r.label:SetPoint("LEFT", r.swatch, "RIGHT", 10, 0)
    r.label:SetMaxLetters(LM.LABEL_MAX)
    r.weight = editBox(r, L.weight, function(text)
        if r.key and tonumber(text) then
            LM:UpdateResponse(r.key, { weight = tonumber(text) })
        end
    end)
    r.weight:SetPoint("LEFT", r.label, "RIGHT", 10, 0)
    r.weight:SetNumeric(true)
    r.weight:SetMaxLetters(3)
    -- the icon: a dropdown of Blizzard's group loot icons, each shown in the list
    r.icon = UI.Dropdown(r, "", {
        labelWidth = 0, width = L.icon,
        options = function()
            local out = { { key = NO_ICON, label = TEXT.noIcon } }
            for _, ic in ipairs(LM.ICONS) do
                out[#out + 1] = { key = ic.key, label = LM.IconMarkup(ic.key, 16) .. " " .. ic.label }
            end
            return out
        end,
        get = function()
            local resp = r.key and LM:Response(r.key)
            return resp and resp.icon or NO_ICON
        end,
        set = function(v)
            if r.key then
                LM:UpdateResponse(r.key, { icon = v == NO_ICON and "" or v })
            end
        end,
    })
    r.icon:SetPoint("LEFT", r.weight, "RIGHT", 6, 0)
    r.remove = CreateFrame("Button", nil, r, "UIPanelCloseButton")
    r.remove:SetSize(20, 20)
    r.remove:SetPoint("LEFT", r.icon, "RIGHT", 4, 0)
    UI:SkinCloseButton(r.remove)
    r.up:SetScript("OnClick", function()
        LM:MoveResponse(r.key, -1)
    end)
    r.down:SetScript("OnClick", function()
        LM:MoveResponse(r.key, 1)
    end)
    r.remove:SetScript("OnClick", function()
        LM:RemoveResponse(r.key)
    end)
    r.swatch:SetScript("OnClick", function()
        local resp = LM:Response(r.key)
        if resp then
            UI.PickColor(resp.color, function(c)
                LM:UpdateResponse(r.key, { color = { c[1], c[2], c[3] } })
            end)
        end
    end)
    respRows[i] = r
    return r
end

local function slider(f, x, y, text, key, format)
    local lim = LM.LIMITS[key]
    local row = UI.Slider(f, text, {
        min = lim[1], max = lim[2], step = lim[3], labelWidth = L.sliderLabel, width = L.sliderW,
        format = format,
        get = function()
            return LM:Settings().score[key]
        end,
        set = function(v)
            LM:Settings().score[key] = v
            LM.ScoreChanged()
        end,
        enabledIf = function()
            return LM:Settings().score.show
        end,
    })
    row:SetPoint("TOPLEFT", x, y)
    refreshers[#refreshers + 1] = row.refresh
    return row
end

-- Sync Master Loot: "Sync to" a group member with CRT (or a typed name), and the button; the line under it
-- says who got it. Only the raid leader in a group can use it.
local function buildSync(f)
    heading(f, L.col2, L.syncTop, TEXT.sync, TEXT.syncHelp)
    local picked -- the name picked in the dropdown; a typed name wins over it
    local typed
    local function canSync()
        return LM:CanSync()
    end
    local pick = UI.Dropdown(f, TEXT.syncTo, {
        labelWidth = L.syncLabel, width = L.syncPick, maxHeight = 300,
        options = function()
            local out = { { key = "", label = TEXT.syncPickOne } }
            local targets = LM:SyncTargets()
            for _, name in ipairs(targets) do
                local unit = LM.UnitOf(name)
                local class = unit and select(2, UnitClass(unit))
                if issecretvalue and issecretvalue(class) then
                    class = nil
                end
                local c = class and (C_ClassColor and C_ClassColor.GetClassColor(class) or RAID_CLASS_COLORS[class])
                local label = Ambiguate(name, "none")
                out[#out + 1] = { key = name, label = c and c:WrapTextInColorCode(label) or label }
            end
            if #targets == 0 then
                out[#out + 1] = { key = "~nobody~", label = TEXT.syncNobody, disabled = true }
            end
            return out
        end,
        get = function()
            return picked or ""
        end,
        set = function(v)
            picked = v ~= "" and v or nil
            typed:SetText("")
            typed.showHint()
        end,
        enabledIf = canSync,
    })
    pick:SetPoint("TOPLEFT", L.col2, L.syncTop - 20)
    local boxW = L.col2W - L.syncLabel - L.dropdownGap - L.syncPick - L.addGap - L.addEdge
    typed = editBox(f, boxW, function(text)
        if text ~= "" then
            picked = nil
            pick.refresh()
        end
    end, TEXT.syncType)
    local dropH = pick.Dropdown:GetHeight()
    matchHeight(typed, (dropH and dropH >= 16) and dropH or 26)
    UI:SkinEditBox(typed)
    typed:SetPoint("LEFT", pick.Dropdown, "RIGHT", L.addGap, 0)
    local status = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    local button = UI.PanelButton(f, TEXT.sync, 24, function()
        local name = strtrim(typed:GetText() or "")
        LM:SyncTo(name ~= "" and name or picked)
        refresh()
    end)
    button:SetPoint("TOPLEFT", L.col2 + 4, L.syncTop - 58)
    -- greyed out during chat lockdown, with the reason on hover (motion scripts run while disabled)
    button:SetMotionScriptsWhileDisabled(true)
    button:SetScript("OnEnter", function(self)
        local why = LM:CanSync() and LM:SyncBlocked()
        if why then
            GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
            GameTooltip:SetText(TEXT.sync)
            GameTooltip:AddLine(why, 1, 0.82, 0, true)
            GameTooltip:Show()
        end
    end)
    button:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    -- a greyed button gets no clicks: during the lockdown a cover over it takes the click and says why in red
    local cover = CreateFrame("Frame", nil, f)
    cover:SetAllPoints(button)
    cover:SetFrameLevel(button:GetFrameLevel() + 5)
    cover:EnableMouse(true)
    cover:SetScript("OnMouseUp", function(_, mouseButton)
        if mouseButton == "LeftButton" then
            LM.ShowError(LM.LOCKDOWN_ERROR)
        end
    end)
    cover:SetScript("OnEnter", function()
        button:GetScript("OnEnter")(button)
    end)
    cover:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    cover:Hide()
    status:SetPoint("TOPLEFT", L.col2, L.syncTop - 90)
    status:SetWidth(L.col2W)
    status:SetJustifyH("LEFT")
    refreshers[#refreshers + 1] = function()
        local on = canSync()
        pick.refresh()
        typed:SetEnabled(on)
        typed.showHint()
        button:SetEnabled(on and not LM:SyncBlocked())
        cover:SetShown(on and LM:SyncBlocked() ~= nil)
        status:SetText(LM:SyncStatus() or "")
        if on and f:IsVisible() then
            LM:SyncPing() -- who has CRT, for the list (at most every SYNC_PING_SECONDS)
        end
    end
end

local function buildSettings(f)
    heading(f, L.col1, -8, TEXT.responses, TEXT.responsesHelp)
    for _, c in ipairs({ { TEXT.colLabel, 66 }, { TEXT.colWeight, 66 + L.label + 10 }, { TEXT.colIcon, 66 + L.label + 10 + L.weight + 10 } }) do
        local h = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        h:SetPoint("TOPLEFT", L.col1 + c[2], L.respTop)
        h:SetTextColor(0.7, 0.7, 0.7)
        h:SetText(c[1])
    end
    local add = makeButton(f, TEXT.add, 80)
    local reset = makeButton(f, TEXT.reset, 90)
    add:SetScript("OnClick", function()
        LM:AddResponse()
    end)
    reset:SetScript("OnClick", function()
        LM:ResetResponses()
    end)
    refreshers[#refreshers + 1] = function()
        local list = LM:Responses()
        for i = 1, LM.MAX_RESPONSES do
            local r = responseRow(f, i)
            local resp = list[i]
            if resp then
                r.key = resp.key
                r.swatch:SetBackdropColor(resp.color[1], resp.color[2], resp.color[3], 1)
                if not r.label:HasFocus() then
                    r.label:SetText(resp.label)
                end
                if not r.weight:HasFocus() then
                    r.weight:SetText(tostring(resp.weight))
                end
                r.icon.refresh()
                local pass = resp.key == "pass"
                r.weight:SetEnabled(not pass)
                r.remove:SetShown(not pass)
                r.up:SetEnabled(not pass and i > 1)
                r.down:SetEnabled(not pass and i < #list - 1)
                r:Show()
            else
                r.key = nil
                r:Hide()
            end
        end
        local y = L.respTop - 20 - #list * L.respRow - 8
        add:ClearAllPoints()
        add:SetPoint("TOPLEFT", L.col1 + 4, y)
        add:SetEnabled(#list < LM.MAX_RESPONSES)
        reset:SetPoint("LEFT", add, "RIGHT", 6, 0)
    end

    heading(f, L.col1, -350, TEXT.specs, TEXT.specsHelp)
    check(f, L.col1 - 2, -372, TEXT.showAll, function()
        return LM:Settings().showAllItems
    end, function(on)
        LM:Settings().showAllItems = on
    end)

    heading(f, L.col1, -404, TEXT.crtLooting, TEXT.partyHelp)
    check(f, L.col1 - 2, -426, TEXT.enableInParty, function()
        return LM:Settings().enableInParty
    end, function(on)
        LM:Settings().enableInParty = on
        LM.LootingRecheck("setting") -- a party leader who had it on turns it off
    end)

    heading(f, L.col2, -8, TEXT.looting, TEXT.lootingHelp)
    local secs = LM.LIMITS.responseSeconds
    local answerTime = UI.Slider(f, TEXT.responseTime, {
        min = secs[1], max = secs[2], step = secs[3], labelWidth = L.sliderLabel, width = L.sliderW,
        format = function(v)
            return v .. " s"
        end,
        get = function()
            return LM:ResponseSeconds()
        end,
        set = function(v)
            LM:Settings().responseSeconds = v
        end,
    })
    answerTime:SetPoint("TOPLEFT", L.col2, -28)
    refreshers[#refreshers + 1] = answerTime.refresh

    heading(f, L.col2, -78, TEXT.award, TEXT.awardHelp)
    local preview
    local message = editBox(f, 280, function(text)
        LM:Settings().awardMessage = LM.CleanAwardMessage(text) -- the same rule as a synced one
        refresh()
    end)
    message:SetPoint("TOPLEFT", L.col2 + 4, -100)
    message:SetMaxLetters(LM.AWARD_MAX)
    message:SetScript("OnTextChanged", function(self, user)
        if user and preview then
            preview.update(self:GetText())
        end
    end)
    local vars = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    vars:SetPoint("TOPLEFT", L.col2, -124)
    vars:SetTextColor(0.7, 0.7, 0.7)
    vars:SetText(TEXT.awardVars)
    local channel = UI.Dropdown(f, TEXT.channel, {
        labelWidth = L.sliderLabel - 30, width = 150, maxHeight = 300,
        options = function()
            local out = {}
            for _, c in ipairs(TEXT.channels) do
                out[#out + 1] = c
            end
            -- your guild's own channels (Guild & Communities), joined as chat when picked
            for _, st in ipairs(LM.GuildStreams()) do
                out[#out + 1] = { key = st.key, label = TEXT.guildStream:format(st.name) }
            end
            -- chat channels you have joined: GetChannelList gives id, name, disabled for each (guild
            -- channels added to chat show as Community:..., listed above by their names instead)
            local list = { GetChannelList() }
            for i = 1, #list, 3 do
                local name = list[i + 1]
                if type(name) == "string" and name ~= "" and not name:find("^Community:") then
                    out[#out + 1] = { key = "CHANNEL:" .. name, label = list[i] .. ". " .. name }
                end
            end
            return out
        end,
        get = function()
            return LM:Settings().awardChannel or "RAID"
        end,
        set = function(v)
            LM:Settings().awardChannel = v
            LM.JoinStream(v) -- a guild channel is joined now, so the first award can go there
        end,
    })
    channel:SetPoint("TOPLEFT", L.col2, -142)
    refreshers[#refreshers + 1] = channel.refresh
    local noRoll = UI.Dropdown(f, TEXT.noRoll, {
        labelWidth = L.sliderLabel - 30, width = 150,
        options = function()
            local out = {}
            for _, v in ipairs(LM.NO_ROLL_CHOICES) do
                out[#out + 1] = { key = v, label = '"' .. v .. '"' }
            end
            return out
        end,
        get = function()
            return LM:Settings().noRoll or "-"
        end,
        set = function(v)
            LM:Settings().noRoll = v
            refresh()
        end,
    })
    noRoll:SetPoint("TOPLEFT", L.col2, -174)
    refreshers[#refreshers + 1] = noRoll.refresh
    local previewLabel = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    previewLabel:SetPoint("TOPLEFT", L.col2, -214)
    previewLabel:SetTextColor(0.7, 0.7, 0.7)
    previewLabel:SetText(TEXT.preview)
    preview = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    preview:SetPoint("TOPLEFT", L.col2, -232)
    preview:SetWidth(285)
    preview:SetMaxLines(L.previewLines)
    preview:SetJustifyH("LEFT")
    preview:SetTextColor(1, 0.5, 0)
    function preview.update(template)
        local set = LM:Settings()
        preview:SetText(LM.FormatAward(template, { item = "[Twisted Horror's Tendril]", player = "Quickstab", response = "BiS", roll = 71 })
            .. "\n" .. LM.FormatAward(template, { item = "[Twisted Horror's Tendril]", player = "Halo", response = "Offspec", noRoll = set.noRoll }))
    end
    refreshers[#refreshers + 1] = function()
        local set = LM:Settings()
        if not message:HasFocus() then
            message:SetText(set.awardMessage or LM.AWARD_DEFAULT)
        end
        preview.update(message:GetText())
    end

    heading(f, L.col3, -8, TEXT.scoreSettings, TEXT.scoreSettingsHelp)
    check(f, L.col3 - 2, -28, TEXT.showScore, function()
        return LM:Settings().score.show
    end, function(on)
        LM:Settings().score.show = on
        LM.ScoreChanged()
        for _, fn in ipairs(refreshers) do
            fn()
        end
    end)
    local y = -56
    for _, spec in ipairs({
        { TEXT.late, "late" }, { TEXT.per10, "per10" }, { TEXT.noShow, "noShow" }, { TEXT.recover, "recover" },
    }) do
        slider(f, L.col3, y, spec[1], spec[2])
        y = y - 32
    end
    slider(f, L.col3, y, TEXT.weeks, "weeks", function(v)
        return v .. " wk"
    end)

    -- Loot authority: the raid leader, and named players (the leader's list is the one raiders trust)
    local function auth()
        local s = LM:Settings()
        s.authority = s.authority or { leader = true, names = {} }
        s.authority.names = s.authority.names or {}
        return s.authority
    end
    local function changed()
        LM:SendAuthority()
        refresh()
    end
    local ay = y - 48
    heading(f, L.col3, ay, TEXT.authority, TEXT.authorityHelp)
    check(f, L.col3 - 2, ay - 20, TEXT.authorityLeader, function()
        return auth().leader ~= false
    end, function(on)
        auth().leader = on
        changed()
    end)
    local also = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    also:SetPoint("TOPLEFT", L.col3, ay - 50)
    also:SetTextColor(0.7, 0.7, 0.7)
    also:SetText(TEXT.authorityAlso)
    local rows = {}
    for i = 1, L.authorityRows do
        local r = CreateFrame("Frame", nil, f)
        r:SetSize(260, 18)
        r:SetPoint("TOPLEFT", L.col3 + 8, ay - 66 - (i - 1) * 18)
        r.text = r:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        r.text:SetPoint("LEFT")
        r.remove = CreateFrame("Button", nil, r, "UIPanelCloseButton")
        r.remove:SetSize(16, 16)
        r.remove:SetPoint("LEFT", 200, 0)
        UI:SkinCloseButton(r.remove)
        r.remove:SetScript("OnClick", function()
            table.remove(auth().names, i)
            changed()
        end)
        rows[i] = r
    end
    local pick
    local function add(name)
        name = LM.NormalizeName(strtrim(name or ""))
        if not name or name == "" then
            return
        end
        for _, n in ipairs(auth().names) do
            if n:lower() == name:lower() then
                return
            end
        end
        if #auth().names < L.authorityRows then
            table.insert(auth().names, name)
            changed()
        end
    end
    pick = UI.Dropdown(f, TEXT.authorityAdd, {
        labelWidth = L.addLabel, width = L.addPick, maxHeight = 300,
        options = function()
            local out = { { key = "", label = TEXT.authorityPick } }
            local Groups = CRT.Groups
            local list = (Groups and Groups.ReadGuild) and Groups:ReadGuild() or {}
            table.sort(list, function(a, b)
                return a.key:lower() < b.key:lower()
            end)
            for _, m in ipairs(list) do
                local c = m.class and (C_ClassColor and C_ClassColor.GetClassColor(m.class) or RAID_CLASS_COLORS[m.class])
                out[#out + 1] = { key = m.key, label = c and c:WrapTextInColorCode(m.key) or m.key }
            end
            return out
        end,
        get = function()
            return ""
        end,
        set = function(v)
            add(v)
        end,
    })
    pick:SetPoint("TOPLEFT", rows[1], "BOTTOMLEFT", -8, -2) -- moved under the last name by the refresher
    -- the box fills the rest of the column, as tall as the dropdown and centred on it
    local boxW = L.col3W - L.addLabel - L.dropdownGap - L.addPick - L.addGap - L.addEdge
    local typed = editBox(f, boxW, function(text)
        add(text)
    end, TEXT.authorityType)
    local dropH = pick.Dropdown:GetHeight()
    matchHeight(typed, (dropH and dropH >= 16) and dropH or 26)
    UI:SkinEditBox(typed) -- flat in Modern, like the dropdown beside it
    typed:SetPoint("LEFT", pick.Dropdown, "RIGHT", L.addGap, 0)
    refreshers[#refreshers + 1] = function()
        local names = auth().names
        for i, r in ipairs(rows) do
            r:SetShown(names[i] ~= nil or i == 1)
            r.text:SetText(names[i] or ("|cff9c8a78" .. TEXT.authorityNone .. "|r"))
            r.remove:SetShown(names[i] ~= nil)
        end
        -- the Add row sits just under the last name shown
        pick:ClearAllPoints()
        pick:SetPoint("TOPLEFT", rows[math.max(1, math.min(#names, L.authorityRows))], "BOTTOMLEFT", -8, -2)
        if not typed:HasFocus() then
            typed:SetText("")
        end
        typed.showHint()
    end
    buildSync(f)
end

-- The page -------------------------------------------------------------------------------------------

local TABS = {
    { key = "tonight", label = TEXT.tonight, build = buildTonight },
    { key = "score", label = TEXT.score, build = buildScore },
    { key = "settings", label = TEXT.settings, build = buildSettings },
}

refresh = function()
    if not (page and page:IsVisible()) then
        return
    end
    for _, fn in ipairs(refreshers) do
        fn()
    end
end

local function selectTab(key)
    if not tabFrames[key] then
        key = "tonight"
    end
    currentTab = key
    for _, tab in ipairs(TABS) do
        local on = tab.key == key
        tabFrames[tab.key]:SetShown(on)
        UI:SetTabSelected(tabButtons[tab.key], on)
    end
    refresh()
end

local function build(pf)
    page = pf
    local title = pf:CreateFontString(nil, "OVERLAY", "CRTFontLarge")
    title:SetPoint("TOPLEFT", 8, -8)
    title:SetText(TEXT.title)
    UI.Help(pf, TEXT.title, TEXT.help):SetPoint("LEFT", title, "RIGHT", 6, 0)
    for i, tab in ipairs(TABS) do
        local b = CreateFrame("Button", nil, pf, "BackdropTemplate")
        b:SetSize(L.tabW, L.tabH)
        b:SetPoint("TOPLEFT", 8 + (i - 1) * (L.tabW + 4), L.tabTop)
        skin(b, 0.4)
        b.sel = b:CreateTexture(nil, "ARTWORK")
        b.sel:SetAllPoints()
        b.sel:SetColorTexture(1, 0.82, 0, 0.18)
        b.text = b:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
        b.text:SetPoint("CENTER")
        b.text:SetText(tab.label)
        b:SetScript("OnClick", function()
            selectTab(tab.key)
        end)
        tabButtons[tab.key] = b
        UI:RegisterTab(b)
        local f = CreateFrame("Frame", nil, pf)
        f:SetPoint("TOPLEFT", 0, L.body)
        f:SetPoint("BOTTOMRIGHT", 0, 0)
        f:Hide()
        tabFrames[tab.key] = f
        tab.build(f)
    end
    local line = pf:CreateTexture(nil, "ARTWORK")
    line:SetColorTexture(0.35, 0.35, 0.35, 1)
    line:SetHeight(1)
    line:SetPoint("TOPLEFT", 8, L.body + 4)
    line:SetPoint("TOPRIGHT", -8, L.body + 4)
    pf:SetScript("OnShow", function()
        selectTab(currentTab)
    end)
    selectTab(currentTab)
end

LM:OnChange(function(what)
    if what == "responses" or what == "session" or what == "started" or what == "ended" or what == "scores"
        or what == "authority" or what == "sync" or what == "looting" then
        refresh()
    end
end)

UI:RegisterPage("lootmaster", TEXT.title, build)
