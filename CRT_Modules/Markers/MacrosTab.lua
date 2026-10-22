local ADDON, CRT = ...

-- The Marker macros tab of the Raid Notes page (Notes/Page.lua builds it into its tab): what a raider needs to call
-- markers on a boss with a marker display (Markers/Display.lua).
--   Top     the boss, picked from the raid route (CRT.Bosses:Options); kept for the session
--   Left    How it works on this boss: the boss file's markerHelp (Markers:Help), or a line saying there is none
--   Right   Marker display: a small live copy of the boss's display, drawn from its own settings with
--           Markers.Geometry, and what it does (slots, layout, fill order, what clears it). Test markers starts the
--           display's test (Markers:Test), which listens to /say, party and raid chat; Stop test ends it
--   Bottom  Your macros: the Marker calls set (Markers/Macros.lua, made by CRT.Macros), one icon per marker with
--           its name, body and state. An icon not made yet makes just that macro when clicked; Generate all macros
--           makes the rest (and rewrites ours a newer version changed); Remove macros deletes only ours, after asking.
--           A made icon drags straight to an action bar (Macros:Pickup puts the macro on the cursor)
-- While this tab's test runs, clicking an icon sends its marker code to /say instead (C_ChatInfo.SendChatMessage,
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
    test = "Test markers",
    stop = "Stop test",
    testHelp = "Test markers turns on this boss's marker display outside a raid. It listens to /say, party and raid chat, and only marker codes fill it.\n\n"
        .. "The macros send to /raid, which only works in a raid group. So while the test runs, click a marker under Your macros to send it to /say, or type /say {rt1}.\n\n"
        .. "Stop test ends it.",
    macros = "Your macros",
    macrosHelp = "One macro per raid marker, CRT Star to CRT Skull. Each sends its marker to raid chat (/raid {rt1}), where the marker display reads it. Drag a made one from here straight to your action bars.\n\n"
        .. "Click a marker that isn't made yet to make just that one, or Generate all macros for all eight. They go in General Macros, for all your characters. When General Macros is full they go in this character's macros. When both are too full, nothing is made and chat says how many to free.\n\n"
        .. "Remove macros deletes only the macros the addon made. A macro you edited or renamed, or your own with the same name, is never changed.\n\n"
        .. "Not in combat: the game doesn't let addons change macros during a fight.",
    generate = "Generate all macros",
    remove = "Remove macros",
    removeAsk = "Remove the %s macros the addon made? Macros you edited or renamed stay.",
    combat = "Not in combat: the game doesn't let addons change macros during a fight.",
    sayCombat = "Not in combat: the test's /say waits until the fight ends.",
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
local COLUMNS_TOP = -48
local MACROS_TOP = -284
local CELL_W = math.floor((UI.PAGE_W - 16) / 8)
local ICON = 36

local tab
local boss -- the encounter ID picked
local testBoss -- the boss whose display this tab's test runs
local controls = {}
local preview = { cells = {}, lines = {} }
local cells = {}

local function makeButton(parent, label)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontNormal)
    b:SetHighlightFontObject(CRTFontHighlight)
    b:SetDisabledFontObject(CRTFontDisable)
    b:SetText(label)
    -- as wide as its label (UI.PanelButtonWidth: the label and the template's end caps)
    local fs = b:GetFontString()
    b:SetSize(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0), 24)
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

local function run(action, name)
    local ok, message = Macros[action](Macros, SET, name)
    if message then
        CRT:Print(message)
    end
    refresh()
    return ok
end

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

-- A macro's state, in words and colour, from its Status entry.
local function stateText(e)
    if e.state == "ours" then
        local where = e.perCharacter and " (this character)" or ""
        if e.outdated then
            return UI.WarnText("Out of date" .. where)
        end
        return UI.GoodText("Made" .. where)
    elseif e.state == "changed" then
        return UI.WarnText("Changed by you")
    elseif e.state == "conflict" then
        return UI.BadText("Blocked by your own")
    end
    return "Not made"
end

local function cellTooltip(cell)
    local e = cell.entry
    if not e then
        return
    end
    GameTooltip:SetOwner(cell.button, "ANCHOR_TOP")
    GameTooltip:SetText(e.def.name, 1, 1, 1)
    GameTooltip:AddLine(e.def.body, 0.85, 0.85, 0.85)
    if testingHere() then
        GameTooltip:AddLine("Click to send " .. (e.def.body:match("{[^{}]+}") or "it") .. " to /say for the test.", 0.85, 0.85, 0.85, true)
    elseif e.state == "missing" then
        GameTooltip:AddLine("Not made yet. Click to make this macro.", 0.85, 0.85, 0.85, true)
        if Macros:InCombat() then
            GameTooltip:AddLine(TEXT.combat, 1, 0.55, 0.1, true)
        end
    elseif e.state == "ours" then
        GameTooltip:AddLine((e.perCharacter and "In this character's macros." or "In General Macros, for all your characters.") .. " Drag it to an action bar.", 0.85, 0.85, 0.85, true)
    elseif e.state == "changed" then
        GameTooltip:AddLine("You edited this macro, so the addon leaves it as it is.", 0.85, 0.85, 0.85, true)
    else
        GameTooltip:AddLine("You have your own macro with this name, so the addon doesn't make one.", 0.85, 0.85, 0.85, true)
    end
    GameTooltip:Show()
end

local function makeCell(i)
    local x = 8 + (i - 1) * CELL_W
    local cell = {}
    local b = CreateFrame("Button", nil, tab)
    b:SetSize(ICON, ICON)
    b:SetPoint("TOP", tab, "TOPLEFT", x + CELL_W / 2, MACROS_TOP - 24)
    b.icon = b:CreateTexture(nil, "ARTWORK")
    b.icon:SetAllPoints()
    b:SetHighlightTexture("Interface\\Buttons\\ButtonHilight-Square", "ADD")
    b.check = b:CreateTexture(nil, "OVERLAY")
    b.check:SetSize(16, 16)
    b.check:SetPoint("BOTTOMRIGHT", 4, -4)
    b.check:SetTexture("Interface\\RaidFrame\\ReadyCheck-Ready")
    cell.button = b
    cell.name = tab:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    cell.name:SetPoint("TOP", b, "BOTTOM", 0, -4)
    cell.name:SetWidth(CELL_W - 6)
    cell.name:SetWordWrap(false)
    cell.body = tab:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    cell.body:SetPoint("TOP", cell.name, "BOTTOM", 0, -2)
    cell.body:SetWidth(CELL_W - 6)
    cell.body:SetWordWrap(false)
    UI.Tint(cell.body, "SetTextColor", "muted")
    cell.state = tab:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    cell.state:SetPoint("TOP", cell.body, "BOTTOM", 0, -2)
    cell.state:SetWidth(CELL_W - 6)
    cell.state:SetWordWrap(false)
    b:SetScript("OnClick", function()
        local e = cell.entry
        if not e then
            return
        end
        if testingHere() then
            sayMarker(e.def)
        elseif e.state == "missing" then
            run("Create", e.def.name)
        end
    end)
    -- a made macro drags onto an action bar: the game's cursor carries it, as from its own macro window
    b:RegisterForDrag("LeftButton")
    b:SetScript("OnDragStart", function()
        local e = cell.entry
        if not e then
            return
        end
        GameTooltip:Hide()
        local _, message = Macros:Pickup(SET, e.def.name)
        if message then
            CRT:Print(message)
        end
    end)
    b:SetScript("OnEnter", function()
        cellTooltip(cell)
    end)
    b:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    cells[i] = cell
    return cell
end

local function buildMacros()
    heading(LEFT_X, MACROS_TOP, TEXT.macros, TEXT.macros, TEXT.macrosHelp)
    for i = 1, 8 do
        makeCell(i)
    end
    local generate = makeButton(tab, TEXT.generate)
    generate:SetPoint("TOPLEFT", LEFT_X, MACROS_TOP - 24 - ICON - 62)
    generate:SetScript("OnClick", function()
        run("Create")
        local st = Macros:Status(SET)
        if st and st.outdated > 0 then
            run("Update")
        end
    end)
    local remove = makeButton(tab, TEXT.remove)
    remove:SetPoint("LEFT", generate, "RIGHT", 6, 0)
    remove:SetScript("OnClick", function()
        local st = Macros:Status(SET)
        UI.LiftOver(UI.ShownPopup(StaticPopup_ShowCustomGenericConfirmation({
            text = TEXT.removeAsk,
            text_arg1 = st and st.label or SET,
            acceptText = TEXT.remove,
            cancelText = CANCEL,
            showAlert = true,
            callback = function()
                run("Remove")
            end,
        }), "GENERIC_CONFIRMATION"))
    end)
    local status = tab:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    status:SetPoint("LEFT", remove, "RIGHT", 12, 0)
    status:SetPoint("RIGHT", tab, "RIGHT", -8, 0)
    status:SetJustifyH("LEFT")
    status:SetWordWrap(false)

    local macros = { generate = generate, remove = remove, status = status }
    macros.refresh = function()
        local st = Macros:Status(SET)
        local free = not Macros:InCombat()
        generate:SetEnabled(free)
        remove:SetEnabled(free)
        if not st then
            status:SetText("")
            return
        end
        local text = Macros:StatusText(SET)
        if #st.changed > 0 or #st.conflicts > 0 or st.outdated > 0 then
            text = UI.WarnText(text)
        elseif st.created == st.total then
            text = UI.GoodText(text)
        end
        status:SetText(text == "none" and "None made yet." or text)
        for i, cell in ipairs(cells) do
            local e = st.entries[i]
            cell.entry = e
            cell.button:SetShown(e ~= nil)
            if e then
                cell.button.icon:SetTexture(e.def.icon)
                -- a macro of that name is in the list (ours, edited, or the player's own): a check, and its state
                cell.button.icon:SetDesaturated(e.state == "missing")
                cell.button.check:SetShown(e.state ~= "missing")
                cell.name:SetText(e.def.name)
                cell.body:SetText(e.def.body)
                cell.state:SetText(stateText(e))
            else
                cell.name:SetText("")
                cell.body:SetText("")
                cell.state:SetText("")
            end
        end
    end
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
    drop:SetPoint("TOPLEFT", LEFT_X, -8)
    controls[#controls + 1] = drop

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
