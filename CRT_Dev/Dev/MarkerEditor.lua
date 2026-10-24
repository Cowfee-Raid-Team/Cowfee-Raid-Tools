local ADDON, CRT = ...

-- DEVELOPER ONLY. The marker display editor, /crt dev markers: make a boss's marker display
-- (Markers/Display.lua), with its help text (how the marker calls work on that boss, shown on Raid
-- Notes > Marker macros), try it with Test, and Export it as the boss file's markers and markerHelp
-- fields (CRT_Data/Seasons/<season>/<Boss>.lua; the crt-season-data skill says how a pasted export is
-- applied) so it ships for everyone. Drafts are saved in CRTDB.dev.markerDisplays and used in place of
-- the shipped display while they exist, so a display can be tried in a real pull before it ships.
-- Delete drops a draft.
--
-- Show preview puts the display on screen with sample markers and names, following every change before
-- it is saved. A Freeform layout shows its slots on screen while the editor is open, each a faint
-- numbered marker to drag to its place on the canvas (kept in the draft's places, and in Export). A test
-- stops the preview (they share the window), and Show preview during a test stops the test.
--
-- This file never ships: its .toc line is inside the do-not-package block, and the CRT_Dev folder is in
-- .pkgmeta's ignore list.

local UI = CRT.UI
local Markers = CRT.MarkerDisplay

local Editor = {}
CRT.MarkerEditor = Editor

local LAYOUTS = {
    { key = "row", label = "Row (left to right)" },
    { key = "column", label = "Column (top to bottom)" },
    { key = "grid", label = "Grid (rows of four)" },
    { key = "free", label = "Freeform (drag the slots)" },
}
local SHAPES = {
    { key = "square", label = "Square" },
    { key = "circle", label = "Circle" },
    { key = "none", label = "None (just the slots)" },
}
local HIDDEN = {
    { key = "fill", label = "Fill a slot for any message" },
    { key = "ignore", label = "Ignore hidden messages" },
}
local HIDDEN_HELP = "In a raid and during a boss fight, the game hides chat text from addons. The addon can't read it, so it can't tell a marker from a typo.\n\n"
    .. "Fill a slot for any message: every group chat message fills a slot. Its marker codes still show as icons, but any other text shows too.\n\n"
    .. "Ignore hidden messages: hidden messages fill nothing. Inside a raid the text is always hidden, so the display stays empty there.\n\n"
    .. "When the text can be read, only a marker code fills a slot, and only its icon shows."
local FREE_HELP = "Freeform: drag each numbered slot to its place on the canvas. Slot 1 fills first, then slot 2, and so on.\n\n"
    .. "Shape draws a faint square or circle behind the slots. Canvas size sets how big it is; the slots keep their places when it or the icon size changes.\n\n"
    .. "Snap to ring spaces the slots evenly on the circle. Spread evenly puts them in a grid."
local CLEAR_KINDS = {
    { key = "timeline", label = "Timeline spell" },
    { key = "cast", label = "Boss cast" },
    { key = "emote", label = "Boss emote or yell" },
    { key = "targetable", label = "Boss targetable change" },
}
local CLEAR_WHEN = {
    { key = "end", label = "When it finishes" },
    { key = "start", label = "When it starts" },
}
local CLEAR_ON_HELP = "Boss moments that clear the display, such as a reset between phases. The first one to happen clears it.\n\n"
    .. "Timeline spell: an event on the game's boss timeline for this spell ID.\n\n"
    .. "Boss cast: boss1 to boss5 casts this spell ID.\n\n"
    .. "Boss emote or yell: the boss's emote, yell or say holds this text (any case).\n\n"
    .. "Boss targetable change: a boss becomes targetable or untargetable.\n\n"
    .. "During a boss fight the game may hide spell IDs and text. Then that entry never fires. Run /crt dev clearprobe on a pull to see what the boss sends readably."
local CLEAR_ROWS = 8 -- at most this many entries
local DEFAULT = Markers.DEFAULT
-- help is the draft's help text: exported as markerHelp, not a display setting.
local FIELDS = { "name", "slots", "layout", "iconSize", "number", "names", "clearGap", "clearFull", "clearPhase", "hidden", "shape", "canvas", "places", "help", "clearOn" }

local win
local controls = {}
local bossID -- the encounter being edited
local draft = {}
local previewing = false -- Show preview is on

-- The drafts are kept per boss: declared for the season purge (Bosses:DeclareStore, CRT_Data/Bosses/Registry.lua).
if CRT.Bosses and CRT.Bosses.DeclareField then
    CRT.Bosses:DeclareField("marker display drafts", "dev", "markerDisplays")
end

local function drafts()
    CRT.db.dev = CRT.db.dev or {}
    CRT.db.dev.markerDisplays = CRT.db.dev.markerDisplays or {}
    return CRT.db.dev.markerDisplays
end

local function copyPlaces(places)
    if type(places) ~= "table" then
        return nil
    end
    local out = {}
    for i, p in ipairs(places) do
        out[i] = { p[1], p[2] }
    end
    return out
end

local function copyClearOn(list)
    if type(list) ~= "table" then
        return nil
    end
    local out = {}
    for _, e in ipairs(list) do
        local c = {}
        for k, v in pairs(e) do
            c[k] = v
        end
        out[#out + 1] = c
    end
    return out
end

-- A display's fields, with the defaults for missing ones and its own copy of the places and clearOn.
local function copyFields(src)
    local out = {}
    for _, f in ipairs(FIELDS) do
        local v = src[f]
        if v == nil then
            v = DEFAULT[f]
        end
        if f == "places" then
            v = copyPlaces(v)
        elseif f == "clearOn" then
            v = copyClearOn(v)
        end
        out[f] = v
    end
    return out
end

local function loadDraft(id)
    bossID = id
    draft = copyFields((id and Markers:For(id)) or DEFAULT)
    draft.help = Markers:Help(id)
end

-- The draft being edited, for tests.
function Editor:Draft()
    return draft
end

-- A dragged slot's place, from the cursor: x and y from the display's top left, in its own scale. The
-- other slots keep the places they are shown at, so they don't move when one is dragged.
local updateView
local function follow(i)
    local f = Markers:Frame()
    local left, top = f:GetLeft(), f:GetTop()
    if not left or not top then
        return
    end
    local x, y = GetCursorPosition()
    local scale = f:GetEffectiveScale()
    local old = type(draft.places) == "table" and draft.places or {}
    local places = {}
    for k = 1, math.max(draft.slots, #old) do
        places[k] = k <= draft.slots and { Markers.Place(draft, k) } or old[k]
    end
    places[i] = { Markers.PlaceAt(draft, x / scale - left, top - y / scale) }
    draft.places = places
    updateView()
end

-- A freeform display's slots take the mouse while the editor shows them: drag one to place it.
local function wireSlots()
    if not Markers:EditorView() then
        return
    end
    local free = draft.layout == "free"
    for i = 1, 8 do
        local c = Markers:SlotFrame(i)
        if c then
            c:EnableMouse(free)
            if free and not c.crtDrag then
                c.crtDrag = true
                c:RegisterForDrag("LeftButton")
                c:SetScript("OnDragStart", function(self)
                    self:SetScript("OnUpdate", function()
                        follow(i)
                    end)
                end)
                c:SetScript("OnDragStop", function(self)
                    self:SetScript("OnUpdate", nil)
                    follow(i)
                end)
            end
        end
    end
end

-- What the editor shows of its draft: the preview when it is on, a freeform display's slots to drag,
-- or nothing; nothing while it is closed or a test runs.
function updateView()
    local mode
    if win and win:IsShown() and not Markers:Testing() then
        mode = (previewing and "sample") or (draft.layout == "free" and "ghost") or nil
    end
    if mode then
        Markers:ShowEditorView(draft, mode)
        wireSlots()
    else
        Markers:ShowEditorView(nil)
    end
end

local function refresh()
    if not win or not win:IsShown() then
        return
    end
    for _, c in ipairs(controls) do
        c.refresh()
    end
    if not win.name:HasFocus() then
        win.name:SetText(draft.name or "")
    end
    if not win.help:HasFocus() then
        win.help:SetText(draft.help or "")
    end
    local shipped = bossID and CRT.MarkerDisplayDB.displays[bossID]
    local hasDraft = bossID and drafts()[bossID]
    win.status:SetText(not bossID and "Pick a boss." or hasDraft and "Saved as a draft (used in place of the shipped one)." or shipped and "This boss's display ships with the addon." or "Not saved.")
    win.test:SetText(Markers:Testing() and "Stop test" or "Test")
    win.preview:SetText(previewing and "Hide preview" or "Show preview")
    local free = draft.layout == "free"
    win.snap:SetEnabled(free)
    win.spread:SetEnabled(free)
end

-- The bosses in the raid route, each raid a heading (CRT.Bosses:Options), with their encounter IDs.
local function bosses()
    local out = {}
    for _, o in ipairs(CRT.Bosses:Options()) do
        out[#out + 1] = o.title and o or { key = o.key, label = o.label .. " (" .. o.key .. ")" }
    end
    return out
end

-- A place's fraction, short: 0.5, 0.125, 1.
local function fraction(v)
    return (string.format("%.3f", v):gsub("0+$", ""):gsub("%.$", ""))
end

-- The clearOn entries as Lua, for Export: { event = "cast", spellID = 123, when = "start" }, ...
local function clearOnText(list)
    local parts = {}
    for _, e in ipairs(list) do
        local s = string.format("{ event = %q", e.event)
        if e.spellID then
            s = s .. ", spellID = " .. e.spellID
        end
        if e.when then
            s = s .. string.format(", when = %q", e.when)
        end
        if e.contains then
            s = s .. string.format(", contains = %q", e.contains)
        end
        parts[#parts + 1] = s .. " }"
    end
    return table.concat(parts, ", ")
end

-- The export: a comment saying where it goes, the boss file's markers field, and its markerHelp field when
-- the draft has help text.
local function exportText()
    local d = draft
    local line = string.format('markers = { name = %q, slots = %d, layout = %q, iconSize = %d, number = %s, names = %s, clearGap = %d, clearFull = %d, clearPhase = %s, hidden = %q',
        d.name or "", d.slots, d.layout, d.iconSize, tostring(d.number), tostring(d.names), d.clearGap, d.clearFull, tostring(d.clearPhase), d.hidden or DEFAULT.hidden)
    if type(d.clearOn) == "table" and #d.clearOn > 0 then
        line = line .. ", clearOn = { " .. clearOnText(d.clearOn) .. " }"
    end
    if d.layout == "free" then
        local places = {}
        for i = 1, d.slots do
            local x, y = Markers.Place(d, i)
            places[i] = "{ " .. fraction(x) .. ", " .. fraction(y) .. " }"
        end
        line = line .. string.format(", shape = %q, canvas = %d, places = { %s }", d.shape or DEFAULT.shape, math.floor(d.canvas or DEFAULT.canvas), table.concat(places, ", "))
    end
    line = line .. " },"
    local help = type(d.help) == "string" and (d.help:gsub("^%s+", ""):gsub("%s+$", "")) or ""
    if help ~= "" then
        line = line .. "\n" .. string.format("markerHelp = %q,", help)
    end
    local boss = CRT.Bosses.Get and CRT.Bosses:Get(bossID)
    local header = string.format("-- Marker display for %s (encounter %d, season %s). Paste into the boss file's markers = { ... }, field\n-- in CRT_Data/Seasons/<season>/<Boss>.lua (not Database.lua), replacing the one there:",
        boss and boss.name or "this boss", bossID or 0, boss and boss.season or "?")
    return header .. "\n" .. line
end

local function add(row, y)
    row:SetPoint("TOPLEFT", 14, y)
    controls[#controls + 1] = row
    return row
end

local function isFree()
    return draft.layout == "free"
end

local function slider(label, field, low, high, y, format, step, enabledIf)
    return add(UI.Slider(win, label, { min = low, max = high, step = step or 1, labelWidth = 150, width = 160, format = format, enabledIf = enabledIf,
        get = function()
            return draft[field]
        end,
        set = function(v)
            draft[field] = v
            updateView()
        end }), y)
end

local function check(label, field, y)
    local cb = CreateFrame("CheckButton", nil, win, "UICheckButtonTemplate")
    cb:SetSize(24, 24)
    cb:SetPoint("TOPLEFT", 10, y)
    local fs = win:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    fs:SetPoint("LEFT", cb, "RIGHT", 2, 0)
    fs:SetText(label)
    cb:SetScript("OnClick", function(self)
        draft[field] = self:GetChecked() and true or false
        updateView()
    end)
    cb.refresh = function()
        cb:SetChecked(draft[field] and true or false)
    end
    controls[#controls + 1] = cb
end

-- A button as wide as its widest label (at least 120), from the label's string width.
local function button(text, longest)
    local b = CreateFrame("Button", nil, win, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontButtonSmall)
    b:SetHighlightFontObject(CRTFontButtonSmallHighlight)
    b:SetText(longest or text)
    local fs = b:GetFontString()
    b:SetSize(math.max(120, math.ceil((fs and fs:GetStringWidth() or 96) + 24)), 22)
    b:SetText(text)
    return b
end

local function seconds(v)
    return v == 0 and "never" or (v .. "s")
end

-- Layout, shape, canvas size and the place buttons (the freeform ones grey out for the other layouts).
local function buildLayout()
    local layoutRow = add(UI.Dropdown(win, "Layout", { options = LAYOUTS, labelWidth = 150, width = 200,
        get = function()
            return draft.layout
        end,
        set = function(key)
            draft.layout = key
            updateView()
            refresh()
        end }), -128)
    UI.HelpRight(layoutRow, "Freeform", FREE_HELP)
    add(UI.Dropdown(win, "Shape", { options = SHAPES, labelWidth = 150, width = 200, enabledIf = isFree,
        get = function()
            return draft.shape
        end,
        set = function(key)
            draft.shape = key
            updateView()
        end }), -160)
    slider("Canvas size", "canvas", 80, 400, -192, nil, 10, isFree)

    win.snap = button("Snap to ring")
    win.snap:SetPoint("TOPLEFT", 14, -230)
    win.snap:SetScript("OnClick", function()
        draft.places = Markers.RingPlaces(draft.slots)
        updateView()
    end)
    win.spread = button("Spread evenly")
    win.spread:SetPoint("LEFT", win.snap, "RIGHT", 6, 0)
    win.spread:SetScript("OnClick", function()
        draft.places = Markers.GridPlaces(draft.slots)
        updateView()
    end)
end

-- Save draft, Delete draft, Test, Export and Show preview, along the bottom.
local function buildButtons()
    local save = button("Save draft")
    save:SetPoint("BOTTOMLEFT", 14, 46)
    win.save = save
    save:SetScript("OnClick", function()
        if not bossID then
            CRT:Print("Pick a boss first.")
            return
        end
        drafts()[bossID] = copyFields(draft)
        CRT:Print("Saved the marker display draft for encounter " .. bossID .. ".")
        refresh()
    end)
    local delete = button("Delete draft")
    delete:SetPoint("LEFT", save, "RIGHT", 6, 0)
    delete:SetScript("OnClick", function()
        if bossID and drafts()[bossID] then
            drafts()[bossID] = nil
            loadDraft(bossID)
            CRT:Print("Deleted the draft for encounter " .. bossID .. ".")
            updateView()
            refresh()
        end
    end)
    win.test = button("Test", "Stop test")
    win.test:SetPoint("LEFT", delete, "RIGHT", 6, 0)
    win.test:SetScript("OnClick", function()
        if Markers:Testing() then
            Markers:Test(nil)
        else
            previewing = false -- the test takes the window
            Markers:Test(draft)
        end
        updateView()
        refresh()
    end)
    win.export = button("Export")
    win.export:SetPoint("BOTTOMLEFT", 14, 18)
    win.export:SetScript("OnClick", function()
        if not bossID then
            CRT:Print("Pick a boss first.")
            return
        end
        CRT.ConsumablesTools:ShowText("Marker display (Ctrl+C to copy, paste to Claude)", exportText())
    end)
    win.preview = button("Show preview", "Hide preview")
    win.preview:SetPoint("LEFT", win.export, "RIGHT", 6, 0)
    win.preview:SetScript("OnClick", function()
        previewing = not previewing
        if previewing and Markers:Testing() then
            Markers:Test(nil) -- the preview takes the window
        end
        updateView()
        refresh()
    end)
end

-- Clear on, in the right-hand column: pick a kind, type its spell ID or text, Add; each entry is listed
-- with a Remove button. The entries go in the draft's clearOn (Markers/ClearOn.lua).
local addKind, addWhen = "cast", "end"

local function buildClearOn()
    local x = 434
    local title = win:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    title:SetPoint("TOPLEFT", x, -34)
    title:SetText("Clear on a boss moment")
    UI.HelpRight(title, "Clear on a boss moment", CLEAR_ON_HELP)

    local function place(row, y)
        row:SetPoint("TOPLEFT", x, y)
        controls[#controls + 1] = row
    end
    place(UI.Dropdown(win, "Clear on", { options = CLEAR_KINDS, labelWidth = 110, width = 200,
        get = function()
            return addKind
        end,
        set = function(key)
            addKind = key
            refresh()
        end }), -60)

    local valueLabel = win:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    valueLabel:SetPoint("TOPLEFT", x, -100)
    valueLabel:SetText("Spell ID or text")
    win.clearValue = CreateFrame("EditBox", nil, win, "InputBoxTemplate")
    win.clearValue:SetSize(196, 20)
    win.clearValue:SetPoint("TOPLEFT", x + 116, -96)
    win.clearValue:SetAutoFocus(false)
    win.clearValue:SetFontObject(CRTFontEdit)
    win.clearValue:SetScript("OnEnterPressed", win.clearValue.ClearFocus)

    place(UI.Dropdown(win, "When", { options = CLEAR_WHEN, labelWidth = 110, width = 200,
        enabledIf = function()
            return addKind == "timeline" or addKind == "cast"
        end,
        get = function()
            return addWhen
        end,
        set = function(key)
            addWhen = key
        end }), -124)

    win.clearAdd = button("Add")
    win.clearAdd:SetPoint("TOPLEFT", x, -162)
    win.clearAdd:SetScript("OnClick", function()
        local text = win.clearValue:GetText() or ""
        local spell = addKind == "timeline" or addKind == "cast"
        local entry = CRT.MarkerClearOn.Valid({ event = addKind, spellID = spell and tonumber(text) or nil,
            when = spell and addWhen or nil, contains = addKind == "emote" and text or nil })
        if not entry then
            CRT:Print(spell and "Type the spell ID, a whole number." or "Type the text to look for.")
            return
        end
        draft.clearOn = draft.clearOn or {}
        if #draft.clearOn >= CLEAR_ROWS then
            CRT:Print("At most " .. CLEAR_ROWS .. " boss moments.")
            return
        end
        draft.clearOn[#draft.clearOn + 1] = entry
        win.clearValue:SetText("")
        win.clearValue:ClearFocus()
        refresh()
    end)

    -- The entries, one row each.
    win.clearRows = {}
    for i = 1, CLEAR_ROWS do
        local row = CreateFrame("Frame", nil, win)
        row:SetSize(330, 24)
        row:SetPoint("TOPLEFT", x, -196 - (i - 1) * 26)
        row.remove = button("Remove")
        row.remove:SetParent(row)
        row.remove:SetPoint("RIGHT", row, "RIGHT", 0, 0)
        row.remove:SetScript("OnClick", function()
            if draft.clearOn and draft.clearOn[i] then
                table.remove(draft.clearOn, i)
                if #draft.clearOn == 0 then
                    draft.clearOn = nil
                end
                refresh()
            end
        end)
        row.label = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        row.label:SetPoint("LEFT", 0, 0)
        row.label:SetPoint("RIGHT", row.remove, "LEFT", -6, 0)
        row.label:SetJustifyH("LEFT")
        row.label:SetWordWrap(false)
        row:Hide()
        win.clearRows[i] = row
    end
    controls[#controls + 1] = { refresh = function()
        local list = draft.clearOn or {}
        for i, row in ipairs(win.clearRows) do
            local e = list[i] and CRT.MarkerClearOn.Valid(list[i])
            row:SetShown(e ~= nil)
            if e then
                row.label:SetText(CRT.MarkerClearOn.Describe(e))
            end
        end
    end }
end

local function build()
    win = CreateFrame("Frame", "CowfeeRaidToolsMarkerEditor", UIParent, "BasicFrameTemplateWithInset")
    UI:StyleWindow(win)
    win:SetSize(780, 690) -- the settings on the left, Clear on in a column on the right
    win:SetPoint("CENTER")
    UI:RegisterLayer("popups", win)
    win:SetMovable(true)
    win:EnableMouse(true)
    win:RegisterForDrag("LeftButton")
    win:SetScript("OnDragStart", function(self) self:StartMoving(true) end)
    win:SetScript("OnDragStop", win.StopMovingOrSizing)
    win:SetClampedToScreen(true)
    tinsert(UISpecialFrames, "CowfeeRaidToolsMarkerEditor")
    UI.SetFrameTitle(win, "Marker displays (dev)")

    add(UI.Dropdown(win, "Boss", { options = bosses, labelWidth = 60, width = 300,
        get = function()
            return bossID
        end,
        set = function(id)
            loadDraft(id)
            updateView()
            refresh()
        end }), -30)

    local nameLabel = win:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    nameLabel:SetPoint("TOPLEFT", 14, -72)
    nameLabel:SetText("Name")
    win.name = CreateFrame("EditBox", nil, win, "InputBoxTemplate")
    win.name:SetSize(240, 20)
    win.name:SetPoint("TOPLEFT", 170, -68)
    win.name:SetAutoFocus(false)
    win.name:SetFontObject(CRTFontEdit)
    win.name:SetScript("OnTextChanged", function(self, user)
        if user then
            draft.name = self:GetText()
            updateView()
        end
    end)
    win.name:SetScript("OnEnterPressed", win.name.ClearFocus)

    slider("Slots", "slots", 1, 8, -96)
    buildLayout()
    slider("Icon size", "iconSize", 16, 96, -262)
    check("Show the slot number above each marker", "number", -298)
    check("Show who sent it under each marker", "names", -322)

    local clearTitle = win:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    clearTitle:SetPoint("TOPLEFT", 14, -358)
    clearTitle:SetText("Clear (always on the pull and on a kill or wipe)")
    slider("After no messages for", "clearGap", 0, 60, -378, seconds)
    slider("After the last slot fills", "clearFull", 0, 60, -410, seconds)
    check("When a new phase starts", "clearPhase", -446)

    local hiddenRow = add(UI.Dropdown(win, "When chat is hidden", { options = HIDDEN, labelWidth = 150, width = 200,
        get = function()
            return draft.hidden
        end,
        set = function(key)
            draft.hidden = key
        end }), -482)
    UI.HelpRight(hiddenRow, "When chat is hidden", HIDDEN_HELP)

    -- How the marker calls work on this boss, for Raid Notes > Marker macros (exported as markerHelp).
    local helpLabel = win:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    helpLabel:SetPoint("TOPLEFT", 14, -522)
    helpLabel:SetText("Help text")
    UI.HelpRight(helpLabel, "Help text", "How the marker calls work on this boss, in a sentence or two. Raid Notes > Marker macros shows it under How it works on this boss. Export writes it as markerHelp.")
    win.help = CreateFrame("EditBox", nil, win, "InputBoxTemplate")
    win.help:SetSize(240, 20)
    win.help:SetPoint("TOPLEFT", 170, -518)
    win.help:SetAutoFocus(false)
    win.help:SetFontObject(CRTFontEdit)
    win.help:SetMaxLetters(400)
    win.help:SetScript("OnTextChanged", function(self, user)
        if user then
            draft.help = self:GetText()
        end
    end)
    win.help:SetScript("OnEnterPressed", win.help.ClearFocus)
    win.help:SetScript("OnEscapePressed", win.help.ClearFocus)

    win.status = win:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    win.status:SetPoint("TOPLEFT", 14, -548)
    win.status:SetWidth(390)
    win.status:SetJustifyH("LEFT")

    buildButtons()
    buildClearOn()

    win:SetScript("OnShow", function()
        updateView()
        refresh()
    end)
    -- Closing the editor ends the preview and the slots on screen; a test keeps going until stopped.
    win:SetScript("OnHide", function()
        previewing = false
        updateView()
    end)
    UI:SkinTree(win)
end

function Editor:Toggle()
    if not win then
        build()
        local list = bosses()
        loadDraft(CRT.Bosses.FirstKey(list))
    end
    win:SetShown(not win:IsShown())
    updateView()
    refresh()
end
