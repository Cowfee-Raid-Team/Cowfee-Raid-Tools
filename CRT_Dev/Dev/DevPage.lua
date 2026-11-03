local ADDON, CRT = ...

-- DEVELOPER ONLY. The Development page (/crt dev): every developer tool in one place, so none of them
-- needs a slash command to find. It is in the menu only after /crt dev, until the main window closes,
-- and only in a developer build, since this file never ships: its .toc line is inside the
-- do-not-package block.
--
-- Four tabs under the title (the shared tab strip, Alerts/SubTabs.lua, owner "dev": the tab picked last
-- stays for the session, Layout the first time):
--   Layout     Layout editor: open it, and Move pieces (off by default, so the panel works as usual)
--   Windows    Windows: reset every movable window and the main panel; Window log: prints every move of
--              the main window, to find what makes it jump; Layers, each window: every window's layer on
--              its own (General Settings shows groups)
--   Boss data  Ability timelines: Manage ability timelines, delete your copies and mark shipped ones for
--              removal (Dev/ReferenceTypes.lua); Marker displays: the marker display editor; Season
--              packs: which seasons load, and purging one
--   Probes     Timeline probe: arm it for the next raid boss pull, show what it found; Diagnostics: the
--              debuff panel's; Boss debug: log every boss pull, one log per boss, a row per boss with
--              Copy (Dev/BossDebugPanel.lua)
-- Each tab's sections stack from the top of the tab area, in two columns, from SECTIONS below: a new
-- section is one more entry there and its builder.

local UI = CRT.UI

local DevPage = {}
CRT.DevPage = DevPage

-- Every number the page is placed with, in px, from the page's top left.
local L = {
    left = 8, right = 360, -- the two columns' left edges
    colW = 340, -- a column's width
    tabY = -36, -- the tab strip, under the title
    ruleY = -64, -- the line under the tabs
    top = -76, -- each column's first section
    headingH = 20, -- a heading to the first row under it
    rowH = 28, -- one row of buttons
    buttonH = 22, -- a button: the last row of a section
    textH = 28, -- two lines of small text, as a section's last row
    gap = 18, -- between two sections in a column
    layerH = 30, -- one layer dropdown
    wide = 180, narrow = 160, -- button widths
    pair = 168, -- a second button in a row, from the first
}
DevPage.L = L

DevPage.TABS = {
    { key = "layout", label = "Layout", width = 118 },
    { key = "windows", label = "Windows", width = 118 },
    { key = "bossdata", label = "Boss data", width = 118 },
    { key = "probes", label = "Probes", width = 118 },
}

local page, strip
local controls = {}

local function button(parent, text, width)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontButtonSmall)
    b:SetHighlightFontObject(CRTFontButtonSmallHighlight)
    b:SetDisabledFontObject(CRTFontButtonSmallDisable)
    b:SetSize(width, L.buttonH)
    b:SetText(text)
    return b
end

local function heading(pf, x, y, text, help)
    local fs = pf:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    fs:SetPoint("TOPLEFT", x, y)
    fs:SetText(text)
    if help then
        UI.HelpRight(fs, text, help)
    end
    return fs
end

local function action(pf, x, y, text, width, fn)
    local b = button(pf, text, width)
    b:SetPoint("TOPLEFT", x, y)
    b:SetScript("OnClick", fn)
    return b
end

-- The y of a section's row: 1 is the first under its heading.
local function row(y, n)
    return y - L.headingH - (n - 1) * L.rowH
end

-- A section's height with rows rows of buttons.
local function rows(n)
    return L.headingH + (n - 1) * L.rowH + L.buttonH
end

local function refresh()
    if not page or not page:IsShown() then
        return
    end
    for _, c in ipairs(controls) do
        c.refresh()
    end
end

-- The sections ------------------------------------------------------------------------------------------

local function buildLayout(f, x, y)
    heading(f, x, y, "Layout editor", "Change where the pieces of a page sit, without changing the code: pick a piece, move it with the mouse or arrows, size it with the wheel. Changes are saved and applied after each /reload, and Export lists them so they can be written into the code.\n\nMove pieces is off by default, so with the editor open the panel still works as usual. Tick it to pick and move things.")
    local open = action(f, x, row(y, 1), "Open the layout editor", L.wide, function()
        CRT.Dev:Toggle()
        refresh()
    end)
    open.refresh = function()
        open:SetText(CRT.Dev:IsOn() and "Close the layout editor" or "Open the layout editor")
    end
    controls[#controls + 1] = open
    local move = CreateFrame("CheckButton", nil, f, "UICheckButtonTemplate")
    move:SetSize(24, 24)
    move:SetPoint("LEFT", open, "RIGHT", 10, 0)
    local moveText = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    moveText:SetPoint("LEFT", move, "RIGHT", 2, 0)
    moveText:SetText("Move pieces")
    move:SetScript("OnClick", function(self)
        CRT.Dev:SetMoving(self:GetChecked() and true or false)
    end)
    move.refresh = function()
        move:SetChecked(CRT.Dev:IsMoving())
    end
    controls[#controls + 1] = move
    action(f, x, row(y, 2), "Clear all layout changes", L.wide, function()
        CRT.Dev:ClearAll()
    end)
end

local function buildWindows(f, x, y)
    heading(f, x, y, "Windows", "Puts every movable window (your bar, the debuff panel, the note callout, the note windows, the low-health banner, the ready check window, marker displays, the pace window and the Timeline window) and the main panel back where they start.")
    action(f, x, row(y, 1), "Reset all positions", L.wide, function()
        CRT.Dev:ResetAllPositions()
    end)
end

local function buildWindowLog(f, x, y)
    heading(f, x, y, "Window log", "Prints to chat every time something moves, sizes or rescales the main window or the Timeline pop-out: its anchor, its place on screen and the line of code that did it, and where it is one frame into a drag. After a pop-out resize it also prints how the timeline laid out. For finding what makes a window jump or draw wrong. Click again to turn it off.")
    action(f, x, row(y, 1), "Window log on or off", L.narrow, function()
        CRT.WindowLog:Toggle()
    end)
    action(f, x, row(y, 2), "Check the layout", L.narrow, function()
        CRT.LayoutCheck:Run()
    end)
    action(f, x, row(y, 3), "Sample late night", L.narrow, function()
        CRT.LateTest:Toggle()
    end)
end

-- Every window's layer on its own (General Settings shows them in groups).
local function buildLayers(f, x, y)
    heading(f, x, y, "Layers, each window", "The layer of every window on its own. General Settings shows them in groups (Main window, Note windows, Timeline window, Alerts, Raid windows); a group whose windows differ shows Mixed there.")
    for i, layer in ipairs(UI.LAYERS) do
        local dd = UI.Dropdown(f, layer.label, {
            options = UI:LayerChoices(layer.key),
            labelWidth = 120,
            width = 130,
            get = function()
                return UI:Layer(layer.key)
            end,
            set = function(key)
                UI:SetLayer(layer.key, key)
                refresh()
            end,
        })
        dd:SetPoint("TOPLEFT", x, y - L.headingH - (i - 1) * L.layerH)
        controls[#controls + 1] = dd
    end
end

local function buildRefTypes(f, x, y)
    heading(f, x, y, "Ability timelines", "Manage ability timelines lists every ability timeline of a boss. It deletes your copies, and marks shipped ones for removal: they're hidden on this computer at once, and Export removals (or /crt dev removed) lists them for Claude to delete from the boss files.\n\nAn ability's types and icons are set by right-clicking it on the Timeline. Export labels on the Timeline gives them to paste to Claude.")
    action(f, x, row(y, 1), "Manage ability timelines", L.wide, function()
        CRT.ReferenceTypes:Toggle()
    end)
end

local function buildMarkers(f, x, y)
    heading(f, x, y, "Marker displays", "Make a boss's marker display: slots, layout, icon size and when it clears. Save it as a draft to try in a real pull, Test it in /say, and Export it to ship in the boss's file.")
    action(f, x, row(y, 1), "Open the marker editor", L.narrow, function()
        CRT.MarkerEditor:Toggle()
    end)
end

local function buildSeasons(f, x, y)
    heading(f, x, y, "Season packs", "Which season packs load (the current season only, or all), and purging one season's saved boss data: Timeline pulls, reminders, phase triggers, pace plans and switches, and marker display settings. Tattlebot's history, the Late Tracker and raid notes are always kept.")
    action(f, x, row(y, 1), "Open season packs", L.narrow, function()
        CRT.SeasonTools:Toggle()
    end)
    action(f, x + L.pair, row(y, 1), "Boss order", 120, function()
        CRT.BossOrder:Toggle()
    end)
    local loads = f:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    loads:SetPoint("TOPLEFT", x, row(y, 2))
    loads:SetWidth(250)
    loads:SetJustifyH("LEFT")
    loads.refresh = function()
        local current = CRT.Bosses and CRT.Bosses:Current()
        loads:SetText(string.format("Loading: %s. Current season: %s.", CRT.Bosses and CRT.Bosses:LoadMode() == "all" and "all seasons" or "the current season only", current and current.name or "none"))
    end
    controls[#controls + 1] = loads
end

local function buildProbe(f, x, y)
    heading(f, x, y, "Timeline probe", "For the next raid boss pull, logs whether each boss timeline, cast, damage meter, death recap and Journal value, and each phase event, was secret, readable or missing: when it fired, at the end of the encounter and after combat. Show prints what it found.")
    action(f, x, row(y, 1), "Arm for the next pull", L.narrow, function()
        if CRT.TimelineProbe then
            CRT.TimelineProbe:Arm()
        end
    end)
    action(f, x + L.pair, row(y, 1), "Show what it found", L.narrow, function()
        if CRT.TimelineProbe then
            CRT.TimelineProbe:Show()
        end
    end)
end

local function buildDiagnostics(f, x, y)
    heading(f, x, y, "Diagnostics", "Prints to chat what the game allows the debuff panel to do on this client: which of its setup calls worked.")
    action(f, x, row(y, 1), "Debuff panel diagnostics", L.wide, function()
        CRT.DebuffPanel:ShowInfo()
    end)
end

-- Boss debug: one log per boss pull, a row per boss (its own file places its rows from x, y).
local function buildBossDebug(f, x, y)
    controls[#controls + 1] = CRT.BossDebugPanel.Build(f, x, y)
end

-- Each tab's sections, in order down each column (col: "left" or "right"). height: px, or a function for
-- a section whose size follows the data (the layers, Boss debug's rows). when (optional): built only when
-- it returns true.
local SECTIONS = {
    { key = "layout", tab = "layout", col = "left", height = rows(2), build = buildLayout },
    { key = "windows", tab = "windows", col = "left", height = rows(1), build = buildWindows },
    { key = "windowlog", tab = "windows", col = "left", height = rows(3), build = buildWindowLog },
    { key = "layers", tab = "windows", col = "right", build = buildLayers, height = function()
        return L.headingH + #UI.LAYERS * L.layerH
    end },
    { key = "reftypes", tab = "bossdata", col = "left", height = rows(1), build = buildRefTypes },
    { key = "markers", tab = "bossdata", col = "left", height = rows(1), build = buildMarkers },
    { key = "seasons", tab = "bossdata", col = "left", height = L.headingH + L.rowH + L.textH, build = buildSeasons },
    { key = "probe", tab = "probes", col = "left", height = rows(1), build = buildProbe },
    { key = "diagnostics", tab = "probes", col = "left", height = rows(1), build = buildDiagnostics },
    { key = "bossdebug", tab = "probes", col = "right", build = buildBossDebug, height = function()
        return CRT.BossDebugPanel.HEIGHT
    end, when = function()
        return CRT.BossDebugPanel ~= nil
    end },
}
DevPage.SECTIONS = SECTIONS

-- Where each section sits: [tab] = { { key, x, y, w, h, build }, ... }, each column stacked from L.top.
function DevPage.Layout()
    local out, nextY = {}, {}
    for _, tab in ipairs(DevPage.TABS) do
        out[tab.key] = {}
        nextY[tab.key] = { left = L.top, right = L.top }
    end
    for _, s in ipairs(SECTIONS) do
        if not s.when or s.when() then
            local h = type(s.height) == "function" and s.height() or s.height
            local y = nextY[s.tab][s.col]
            local list = out[s.tab]
            list[#list + 1] = { key = s.key, x = L[s.col], y = y, w = L.colW, h = h, build = s.build }
            nextY[s.tab][s.col] = y - h - L.gap
        end
    end
    return out
end

-- The page ----------------------------------------------------------------------------------------------

local function build(pf)
    page = pf
    local title = pf:CreateFontString(nil, "OVERLAY", "CRTFontLarge")
    title:SetPoint("TOPLEFT", 8, -8)
    title:SetText("Development")
    UI.HelpRight(title, "Development", "Developer tools. This page is only in a developer build of the addon (from Git); release zips leave it out, along with every tool on it.\n\nThe same tools have slash commands: /crt dev (this page), /crt dev edit, /crt dev reset, /crt dev clear, /crt dev debuffs, /crt dev probe, /crt dev probe show, /crt dev clearprobe, /crt dev absorbprobe (on, off, show: can a boss's absorb be read in a pull), /crt dev aura (<spellID>, on [spellID], off, show: can a debuff on the group be read), /crt dev lowhp (on, off, show: what an addon sees of your health under the low-health threshold), /crt dev autorelease (status, now [encounterID], arm [encounterID], off: test Instantly release after wipe outside a raid, on the boss on show or the one given), /crt dev shieldbar (on, off: the shield bar on your own absorb, against a target dummy), /crt dev bossdebug (on, off, show, show <boss>: every boss pull logged, one log per boss, to copy; emotes [boss]: only its boss emotes and yells, with phase triggers), /crt dev markerprobe, /crt dev special (a sample special alert on Mech Alerts), /crt dev alerts (export and import alerts), /crt dev markers, /crt dev types (manage ability timelines), /crt dev labels, /crt dev removed, /crt dev winlog, /crt dev seasons and /crt dev seasons ids.")

    strip = CRT.AlertSubTabs.Build(pf, {
        owner = "dev",
        list = DevPage.TABS,
        x = L.left,
        y = L.tabY,
        rule = { y = L.ruleY, left = L.left, right = L.left },
        onPick = refresh,
    })
    for tab, list in pairs(DevPage.Layout()) do
        for _, s in ipairs(list) do
            s.build(strip.frames[tab], s.x, s.y)
        end
    end

    pf:SetScript("OnShow", function()
        strip:Select(CRT.AlertSubTabs.Picked("dev"))
        refresh()
    end)
end

-- The strip (tests), and opening a tab by key ("layout", "windows", "bossdata", "probes").
function DevPage.Strip()
    return strip
end

function DevPage.Select(key)
    if strip then
        strip:Select(key)
        refresh()
    end
end

UI:RegisterPage("dev", "Development", build)
-- Only /crt dev shows it, until the main window closes.
UI:SetPageHidden("dev", true, true)
