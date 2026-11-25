local ADDON, CRT = ...

-- The Marker macros tab of the Raid Notes page (Notes/Page.lua builds it into its tab): what a raider needs to call
-- markers on a boss with a marker display (Markers/Display.lua).
--   Top     the boss, picked from the raid route (CRT.Bosses:Options); kept for the session; Preview marker display
--           (UI.PreviewButton) shows the display on screen to place it
--   Left    How it works on this boss: the boss file's markerHelp (Markers:Help), or a line saying there is none
--   Right   Marker display: a small live copy of the boss's display, drawn from its own settings with
--           Markers.Geometry, and what it does (slots, layout, fill order, what clears it). Test starts the
--           display's test (Markers:Test), which listens to /say, party and raid chat; Stop test ends it
--   Bottom  Your macros: the Marker calls set (Markers/Macros.lua, made by CRT.Macros) in the shared block,
--           UI.MacroSet (CRT_Core/UI/MacroSet.lua, also on Interrupts > Macros): one icon per marker with its name,
--           body and state; a click makes a missing one or removes one of ours; Generate all macros, Remove macros;
--           a made icon drags straight to an action bar
-- While this tab's test runs, clicking an icon sends its marker code to /say instead, through the block's onClick
-- hook (C_ChatInfo.SendChatMessage,
-- else the global SendChatMessage; SAY needs a hardware event in the open world, which a click is), so the display
-- fills without a group: the macros' /raid only reaches a raid group. Never in combat.

local UI = CRT.UI
local Macros = CRT.Macros
local Markers = CRT.MarkerDisplay

local SET = "markers" -- Markers/Macros.lua's set

-- Every word on this tab, in one place so the wording is easy to change.
local TEXT = {
    boss = "Boss",
    how = "How it works on this boss",
    howHelp = "What raiders do with their marker macros on this boss. It comes with the addon, written for each boss.",
    noHelp = "No marker calls are planned on this boss yet.",
    display = "Marker display",
    noDisplay = "This boss has no marker display.",
    test = "Test",
    stop = "Stop test",
    testHelp = "Test turns on this boss's marker display outside a raid. It listens to /say, party and raid chat, and only marker codes fill it.\n\n"
        .. "The macros send to /raid, which only works in a raid group. So while the test runs, click a marker under Your macros to send it to /say, or type /say {rt1}.\n\n"
        .. "Stop test ends it.",
    macros = "Your macros",
    macrosHelp = {
        "One macro per raid marker, CRT Star to CRT Skull. Each sends its marker to raid chat (/raid {rt1}), where the marker display reads it. Drag a made one from here straight to your action bars.\n\n"
            .. "Click a marker to make just that one. Click it again to remove it.",
        { "Generate all macros", "makes all eight. They go in General Macros, for all your characters. When General Macros is full they go in this character's macros. When both are too full, nothing is made and chat says how many to free." },
        { "Remove macros", "deletes only the macros the addon made. A macro you edited or renamed, or your own with the same name, is never changed." },
        "Not in combat: the game doesn't let addons change macros during a fight.",
    },
    sayTip = "Click to send %s to /say for the test.",
    sayCombat = "Not in combat: the test's /say waits until the fight ends.",
    preview = "Preview marker display",
    previewTip = "Shows the marker display on screen with sample markers so you can drag it into place.",
}

local LAYOUTS = { row = "Row, left to right", column = "Column, top to bottom", grid = "Grid, rows of four", free = "Freeform" }

-- The tab is UI.PAGE_H - 66 high under the tabs (Notes/Page.lua): the boss on top, two columns, the macros along
-- the bottom.
local TAB_H = UI.PAGE_H - 66
local LEFT_X, LEFT_W = 8, 430
local RIGHT_X = 464
local BOX_W, BOX_H = 300, 160
local FACTS_X = RIGHT_X + BOX_W + 12
local FACTS_W = UI.PAGE_W - 8 - FACTS_X
local TOP_ROW_Y = -8 -- the boss list, and the display's preview button over the right column
local COLUMNS_TOP = -48
local MACROS_TOP = -284

local tab
local boss -- the encounter ID picked
local testBoss -- the boss whose display this tab's test runs
local controls = {}
local preview = { cells = {}, lines = {} }

local function makeButton(parent, label)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontNormal)
    b:SetHighlightFontObject(CRTFontHighlight)
    b:SetDisabledFontObject(CRTFontDisable)
    b:SetText(label)
    -- as wide as its label, measured again when its label or the text size changes (UI.FitButton)
    b:SetHeight(24)
    UI.FitButton(b)
    return b
end

local function heading(x, y, text, title, help)
    local fs = tab:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    fs:SetPoint("TOPLEFT", x, y)
    fs:SetText(text)
    UI.HelpRight(fs, title or text, help)
    return fs
end

local function readable(v)
    if issecretvalue and issecretvalue(v) then
        return false
    end
    return v ~= nil
end

-- The bosses, the first with a marker display picked to start.
local function firstBoss()
    local list = CRT.Bosses:Options()
    for _, o in ipairs(list) do
        if not o.title and Markers:For(o.key) then
            return o.key
        end
    end
    return CRT.Bosses.FirstKey(list)
end

local function testingHere()
    return Markers:Testing() and testBoss ~= nil and testBoss == boss
end

local function refresh()
    if not tab or not tab:IsShown() then
        return
    end
    for _, c in ipairs(controls) do
        c.refresh()
    end
end

-- The preview ----------------------------------------------------------------------------------------------------

local function previewCell(i)
    local c = preview.cells[i]
    if c then
        return c
    end
    c = CreateFrame("Frame", nil, preview.canvas)
    c.number = c:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    c.number:SetPoint("TOP", 0, -4)
    c.icon = c:CreateFontString(nil, "OVERLAY")
    c.icon:SetFontObject(preview.font)
    c.icon:SetWordWrap(false)
    c.name = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    c.name:SetWordWrap(false)
    preview.cells[i] = c
    return c
end

-- What slot i shows: the test's message while this boss's test runs (which may be hidden text, put on screen as it
-- is), else a sample marker and name.
local function cellContent(i)
    if testingHere() then
        local f = Markers:Filled()[i]
        if not f then
            return "", ""
        end
        local sender = f.sender
        if readable(sender) and type(sender) == "string" then
            sender = Ambiguate(sender, "short")
        end
        return f.text, sender
    end
    return Markers.SampleSlot(i)
end

local function drawPreview(def)
    preview.empty:SetShown(def == nil)
    preview.canvas:SetShown(def ~= nil)
    if not def then
        return
    end
    local s = Markers.Settings(def)
    local g = Markers.Geometry(def)
    local scale = math.min(1, (BOX_W - 8) / g.width, (BOX_H - 8) / g.height)
    preview.canvas:SetScale(scale)
    preview.canvas:SetSize(g.width, g.height)
    preview.font:SetFont(CRT:FontPath(CRT.db.ui.font) or "Fonts\\FRIZQT__.TTF", g.size, "")
    for i = 1, 8 do
        local c = previewCell(i)
        local cell = g.cells[i]
        if cell then
            c:ClearAllPoints()
            c:SetSize(g.cellW, g.cellH)
            c:SetPoint(cell.point, preview.canvas, "TOPLEFT", cell.x, -cell.y)
            c.number:SetShown(s.number)
            c.number:SetText(tostring(i))
            c.icon:ClearAllPoints()
            c.icon:SetPoint("TOP", 0, -4 - g.numberH)
            c.icon:SetWidth(g.cellW - 4)
            c.name:ClearAllPoints()
            c.name:SetPoint("TOP", c.icon, "BOTTOM", 0, -2)
            c.name:SetWidth(g.cellW - 4)
            c.name:SetShown(s.names)
            local text, sender = cellContent(i)
            -- either may be hidden (secret) text in a raid: putting it on screen is allowed, and pcall keeps a
            -- refusal harmless
            pcall(c.icon.SetText, c.icon, text)
            pcall(c.name.SetText, c.name, sender)
            c:Show()
        else
            c:Hide()
        end
    end
    Markers.DrawOutline(preview.canvas, preview.lines, def)
end

-- "after 10 seconds with no new marker; when a new phase starts; ..."
local function clearsText(s)
    local parts = {}
    if (s.clearGap or 0) > 0 then
        parts[#parts + 1] = s.clearGap .. " seconds after the last marker"
    end
    if (s.clearFull or 0) > 0 then
        parts[#parts + 1] = s.clearFull .. " seconds after the last slot fills"
    end
    if s.clearPhase then
        parts[#parts + 1] = "when a new phase starts"
    end
    parts[#parts + 1] = "at every pull, kill or wipe"
    return table.concat(parts, ", ")
end

-- The facts beside the preview, one per line.
function preview.facts(def)
    if not def then
        return ""
    end
    local s = Markers.Settings(def)
    local lines = {
        UI.HeadingText("Slots") .. "  " .. s.slots,
        UI.HeadingText("Layout") .. "  " .. (LAYOUTS[s.layout] or s.layout),
        UI.HeadingText("Fill order") .. "  slot 1 first, then each next marker sent fills the next slot, up to " .. s.slots,
        UI.HeadingText("Clears") .. "  " .. clearsText(s),
    }
    return table.concat(lines, "\n\n")
end

-- The (?) on hidden chat, for the display's hidden setting.
local function hiddenHelp()
    local def = Markers:For(boss)
    local s = Markers.Settings(def)
    local how = s.hidden == "ignore"
        and "This display leaves hidden messages out, so it stays empty inside a raid."
        or "This display fills a slot for any hidden group message: its marker codes show as icons, and any other text shows too."
    return "In a raid and during a boss fight, the game hides chat text from addons, so they can't tell a marker from a typo.\n\n" .. how
        .. "\n\nWhen the text can be read, only a marker code fills a slot, and only its icon shows."
end

local function buildDisplay()
    local title = heading(RIGHT_X, COLUMNS_TOP, TEXT.display, TEXT.display, hiddenHelp)
    local box = CreateFrame("Frame", nil, tab, "BackdropTemplate")
    box:SetPoint("TOPLEFT", RIGHT_X, COLUMNS_TOP - 22)
    box:SetSize(BOX_W, BOX_H)
    box:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    box:SetBackdropColor(0, 0, 0, 0.5)
    UI.Tint(box, "SetBackdropBorderColor", "border")
    box:SetClipsChildren(true)
    preview.box = box
    preview.canvas = CreateFrame("Frame", nil, box)
    preview.canvas:SetPoint("CENTER")
    preview.font = CreateFont("CRTMarkerMacrosPreviewFont")
    preview.font:CopyFontObject(GameFontHighlight)
    preview.empty = box:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    preview.empty:SetPoint("CENTER")
    preview.empty:SetWidth(BOX_W - 20)
    preview.empty:SetText(TEXT.noDisplay)

    local facts = tab:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    facts:SetPoint("TOPLEFT", FACTS_X, COLUMNS_TOP - 24)
    facts:SetWidth(FACTS_W)
    facts:SetJustifyH("LEFT")
    facts:SetJustifyV("TOP")
    preview.factsText = facts

    local test = makeButton(tab, TEXT.test)
    test:SetPoint("TOPLEFT", box, "BOTTOMLEFT", 0, -8)
    test:SetScript("OnClick", function()
        local def = Markers:For(boss)
        if def then
            testBoss = boss
            Markers:Test(def)
        end
        refresh()
    end)
    local stop = makeButton(tab, TEXT.stop)
    stop:SetPoint("LEFT", test, "RIGHT", 6, 0)
    stop:SetScript("OnClick", function()
        Markers:Test(nil)
        testBoss = nil
        refresh()
    end)
    UI.HelpRight(stop, TEXT.test, TEXT.testHelp)
    preview.test, preview.stop = test, stop

    preview.refresh = function()
        local def = Markers:For(boss)
        drawPreview(def)
        facts:SetText(preview.facts(def))
        test:SetEnabled(def ~= nil and not testingHere())
        stop:SetEnabled(Markers:Testing() and true or false)
    end
    controls[#controls + 1] = preview
    return title
end

-- The macros ---------------------------------------------------------------------------------------------------

-- Sends a macro's marker code to /say, for the test: out of combat, from a click.
local function sayMarker(def)
    local code = def.body:match("{[^{}]+}")
    if not code then
        return
    end
    if InCombatLockdown and InCombatLockdown() then
        CRT:Print(TEXT.sayCombat)
        return
    end
    local send = (C_ChatInfo and C_ChatInfo.SendChatMessage) or SendChatMessage
    local ok, err = pcall(send, code, "SAY")
    if not ok then
        CRT:Print("The game didn't send " .. code .. " to /say: " .. tostring(err))
    end
end

-- Your macros: the shared block (UI.MacroSet), with this tab's test in its hooks: while the test runs, a click sends
-- the marker to /say and the tooltip says so.
local function buildMacros()
    local macros = UI.MacroSet(tab, SET, {
        x = LEFT_X,
        y = MACROS_TOP,
        heading = TEXT.macros,
        help = TEXT.macrosHelp,
        onClick = function(e)
            if testingHere() then
                sayMarker(e.def)
                return true
            end
        end,
        tip = function(e)
            if testingHere() then
                return string.format(TEXT.sayTip, e.def.body:match("{[^{}]+}") or "it")
            end
        end,
    })
    controls[#controls + 1] = macros
end

-- The tab ------------------------------------------------------------------------------------------------------

local function buildHow()
    heading(LEFT_X, COLUMNS_TOP, TEXT.how, TEXT.how, TEXT.howHelp)
    local text = tab:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    text:SetPoint("TOPLEFT", LEFT_X, COLUMNS_TOP - 24)
    text:SetWidth(LEFT_W)
    text:SetJustifyH("LEFT")
    text:SetJustifyV("TOP")
    text:SetMaxLines(12) -- kept above Your macros
    local how = { text = text }
    how.refresh = function()
        text:SetText(Markers:Help(boss) or TEXT.noHelp)
    end
    controls[#controls + 1] = how
end

local function pickBoss(id)
    boss = id
    -- a test running here follows the new boss's display, or stops when it has none
    if testBoss and Markers:Testing() then
        local def = Markers:For(boss)
        testBoss = def and boss or nil
        Markers:Test(def)
    end
    refresh()
end

local function build(pf)
    tab = pf
    boss = boss or firstBoss()
    local drop = UI.Dropdown(pf, TEXT.boss, {
        options = function()
            return CRT.Bosses:Options()
        end,
        labelWidth = 40,
        width = 260,
        get = function()
            return boss
        end,
        set = pickBoss,
    })
    drop:SetPoint("TOPLEFT", LEFT_X, TOP_ROW_Y)
    controls[#controls + 1] = drop
    local previewButton = UI.PreviewButton(pf, TEXT.preview, { "markers" }, { tooltip = TEXT.previewTip })
    previewButton:SetPoint("TOPLEFT", RIGHT_X, TOP_ROW_Y)

    buildHow()
    buildDisplay()
    buildMacros()

    pf:SetScript("OnShow", refresh)
    Macros:OnChange(refresh)
    Markers:OnChange(refresh)
    CRT.Bosses:OnRouteChange(refresh)
    refresh()
end

CRT.MarkerMacrosTab = {
    Build = build,
    -- The boss shown, and picking one, for tests.
    Boss = function()
        return boss
    end,
    Pick = pickBoss,
}
