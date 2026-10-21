local ADDON, CRT = ...

-- The Gear Checker page: one row per group member with their name (class colour), average item level, an
-- issues count and a cell per gear slot (all 16 fit the page, so nothing scrolls sideways): the item's
-- icon in its quality's border, its item level, gem diamonds at the top right (filled, or empty with a red
-- edge) and, on a slot that takes an enchant, a dot at the top left (green, or red when missing). A missing
-- enchant or gem outlines the cell red, a low item orange. Filter chips pick who shows; Refresh asks the
-- group's CRTs and inspects the rest (Comm.lua, Inspect.lua), and says how many have CRT. Hover a cell for
-- the exact item, shift-click one with an issue to put it in the chat box, right-click a row to whisper,
-- post or inspect. Pop out moves the whole page into a window of its own (UI.Window "popout", its place and
-- size in CRTDB.gearChecker.popout), as the Timeline's does; closing it puts it back.
-- The rows are worked out once per change (GC:Rows) and a scroll only repaints the visible ones.
--
-- Game calls (warcraft.wiki.gg and Blizzard's UI source, live, read 2026-10-20): ChatFrameUtil.GetActiveWindow,
-- .InsertLink(text) and .OpenChat(text) (12.0; the older ChatEdit_GetActiveWindow, ChatEdit_InsertLink and
-- ChatFrame_OpenChat stay as fallbacks, aliases in Blizzard_DeprecatedChatInfo); InspectUnit(unit) (the game's
-- inspect window, Blizzard_InspectUI_Bootstrap); IsShiftKeyDown; C_ClassColor.GetClassColor, else
-- RAID_CLASS_COLORS; C_Item.GetItemQualityByID(itemInfo) and ColorManager.GetColorDataForItemQuality, else
-- ITEM_QUALITY_COLORS, redrawn on ITEM_DATA_LOAD_RESULT (itemID, success); C_Item.GetItemInfoInstant (the
-- icon); TextureBase:SetRotation(radians); the WowScrollBoxList, MinimalScrollBar and
-- ScrollUtil.InitScrollBoxListWithScrollBar as Loot History uses them.

local UI = CRT.UI
local GC = CRT.GearChecker
local Gear = CRT.Gear

local TEXT = {
    title = "Gear Checker",
    help = "Everyone's equipped gear, with what's missing.\n\nA red dot at the top left is a missing enchant, a green one an enchant. The diamonds at the top right are sockets: filled with a gem, or empty with a red edge. A red outline is a missing enchant or gem, an orange one an item %d or more item levels under the player's average.\n\nRefresh asks every CRT in the group for their gear, then inspects the others, one at a time, in range and out of combat.\n\nHover an item to see it. Shift-click one with an issue to put it in the chat box. Right-click a player to whisper them, post to group chat or inspect them.",
    refresh = "Refresh (%d/%d have CRT)",
    popOut = "Pop out",
    dock = "Dock",
    docked = "The Gear Checker is in its own window.",
    bringBack = "Bring it back",
    name = "Name",
    ilvl = "iLvl",
    issues = "Issues",
    notSeen = "not seen yet",
    notSeenWhy = { range = "not seen yet (out of range)", offline = "not seen yet (offline)", cannot = "not seen yet (can't inspect)" },
    shiftClick = "Shift-click to put this in the chat box.",
    whisper = "Whisper %s their issues",
    post = { RAID = "Post to raid chat", PARTY = "Post to party chat", INSTANCE_CHAT = "Post to instance chat" },
    chatBox = "Put in chat box",
    inspect = "Inspect %s",
    empty = "Nothing here",
    count = "%d shown",
}

-- Sizes in pixels. A row is NAME + ILVL + ISSUES + 16 cells; with the scroll bar it fits UI.PAGE_W.
local L = {
    chipH = 24, chipPad = 12, chipGap = 4, buttonH = 24,
    headY = -34, listY = -52,
    nameW = 130, ilvlW = 40, issuesW = 40, cellW = 48, rowH = 46,
    icon = 30, edge = 2, gem = 7, gemInner = 5, gemGap = 1, dot = 8, badgeW = 26, badgeH = 16,
    barGap = 6, barW = 8,
    popW = 1040, popH = 560, popMinW = 1024, popMinH = 300,
}
L.rowW = L.nameW + L.ilvlW + L.issuesW + #Gear.SLOTS * L.cellW
GC.PAGE_LAYOUT = L

-- Data colours, the same in every theme (not theme colours).
local COLORS = {
    bad = { 0.9, 0.15, 0.15 },
    low = { 1, 0.55, 0.1 },
    good = { 0.3, 0.85, 0.3 },
    gem = { 0.55, 0.8, 1 },
    socket = { 0.08, 0.08, 0.08 },
    emptyCell = { 0, 0, 0, 0.35 },
}

local DISC = (CRT.MEDIA or ("Interface\\AddOns\\" .. ADDON .. "\\CRT_Media\\Media\\")) .. "Disc" -- the fallback is for test harnesses without Core.lua
local WHITE = "Interface\\Buttons\\WHITE8X8"

-- The page's state, one table so the file stays far under Lua 5.1's upvalue limit.
local P = { rows = {}, chips = {}, headers = {}, refreshedOnce = false, popped = false }
GC.Page = P

-- Colours by look -------------------------------------------------------------------------------------------

-- A text colour: the theme's in Modern, the game's in Default: Blizzard (gold headings, white text).
local function textColor(kind)
    if UI:IsModern() then
        local c = CRT.MOCHA[kind == "heading" and "latte" or "cream"]
        return c[1], c[2], c[3]
    end
    if kind == "heading" then
        return 1, 0.82, 0
    end
    return 1, 1, 1
end

local function rowColor(odd)
    if UI:IsModern() then
        local c = CRT.MOCHA.roast
        return c[1], c[2], c[3], odd and 0.85 or 0.55
    end
    return 0, 0, 0, odd and 0.35 or 0.2
end

local function classColor(class)
    local c = class and ((C_ClassColor and C_ClassColor.GetClassColor(class)) or (RAID_CLASS_COLORS and RAID_CLASS_COLORS[class]))
    if type(c) == "table" and c.r then
        return c.r, c.g, c.b
    end
    return textColor("text")
end

local UNCOMMON = Enum and Enum.ItemQuality and Enum.ItemQuality.Uncommon or 2

local function secret(v)
    return issecretvalue and issecretvalue(v) or false
end

-- The quality's colour; Uncommon until the game has loaded the item (ITEM_DATA_LOAD_RESULT redraws it).
local function qualityColor(piece)
    local q
    if C_Item and C_Item.GetItemQualityByID then
        local ok, v = pcall(C_Item.GetItemQualityByID, piece.itemString or piece.link or piece.id)
        q = ok and not secret(v) and type(v) == "number" and v or nil
    end
    q = q or UNCOMMON
    local ok, c = pcall(function()
        return ColorManager and ColorManager.GetColorDataForItemQuality and ColorManager.GetColorDataForItemQuality(q)
    end)
    c = ok and c or (ITEM_QUALITY_COLORS and ITEM_QUALITY_COLORS[q])
    if type(c) == "table" and c.r then
        return c.r, c.g, c.b
    end
    return 1, 1, 1
end

local function iconOf(piece)
    if not (C_Item and C_Item.GetItemInfoInstant) then
        return nil
    end
    local ok, _, _, _, _, icon = pcall(C_Item.GetItemInfoInstant, piece.itemString or piece.link or piece.id)
    return ok and icon or nil
end

-- Chat ---------------------------------------------------------------------------------------------------------

-- Text into the chat box: into the one being typed in, else a new one opened with it (as the game's own
-- ChatFrameUtil.LinkItem does), for the player to edit and send.
function P.ToChatBox(text)
    if not text or text == "" then
        return false
    end
    local util = ChatFrameUtil
    local getActive = (util and util.GetActiveWindow) or ChatEdit_GetActiveWindow
    local insert = (util and util.InsertLink) or ChatEdit_InsertLink
    local open = (util and util.OpenChat) or ChatFrame_OpenChat
    local okA, active = pcall(getActive or function() end)
    if okA and active and insert then
        return pcall(insert, text)
    end
    if open then
        return pcall(open, text)
    end
    return false
end

local function shortName(name)
    return Ambiguate and Ambiguate(name or "", "short") or name
end

-- The row's right-click menu (UI.ContextMenu lifts it above every window).
function P.OpenMenu(owner, row)
    UI.ContextMenu(owner, function(root)
        local who = shortName(row.name)
        root:CreateTitle(who)
        local lines = GC.WhisperLines(row)
        local b = root:CreateButton(string.format(TEXT.whisper, who), function()
            GC.Say(GC.WhisperLines(row), "WHISPER", row.name)
        end)
        b:SetEnabled(#lines > 0 and not row.me)
        local chat = GC.GroupChat()
        b = root:CreateButton(TEXT.post[chat or "RAID"], function()
            GC.Say(GC.RaidLines(row), GC.GroupChat())
        end)
        b:SetEnabled(#lines > 0 and chat ~= nil)
        b = root:CreateButton(TEXT.chatBox, function()
            P.ToChatBox(GC.ChatBoxText(row))
        end)
        b:SetEnabled(#lines > 0)
        root:CreateDivider()
        b = root:CreateButton(string.format(TEXT.inspect, who), function()
            if InspectUnit and row.unit and not InCombatLockdown() then
                pcall(InspectUnit, row.unit)
            end
        end)
        b:SetEnabled(row.unit ~= nil and not row.me and not InCombatLockdown())
    end)
end

-- Cells ----------------------------------------------------------------------------------------------------------

-- Four lines round a region, thick px, on owner; returned as a list to colour together.
local function outline(owner, region, thick, layer, sublevel)
    local out = {}
    for _, side in ipairs({ { "TOPLEFT", "TOPRIGHT", true }, { "BOTTOMLEFT", "BOTTOMRIGHT", true }, { "TOPLEFT", "BOTTOMLEFT", false }, { "TOPRIGHT", "BOTTOMRIGHT", false } }) do
        local t = owner:CreateTexture(nil, layer, nil, sublevel)
        local dx = side[3] and 0 or (side[1]:find("LEFT") and -thick or thick)
        local dy = side[3] and (side[1]:find("TOP") and thick or -thick) or 0
        t:SetPoint(side[1], region, side[1], dx, dy)
        t:SetPoint(side[2], region, side[2], dx, dy)
        if side[3] then
            t:SetHeight(thick)
        else
            t:SetWidth(thick)
        end
        out[#out + 1] = t
    end
    return out
end

local function paintLines(lines, r, g, b, a)
    for _, t in ipairs(lines) do
        t:SetColorTexture(r, g, b, a or 1)
    end
end

local function showLines(lines, on)
    for _, t in ipairs(lines) do
        t:SetShown(on)
    end
end

local function diamond(owner, size, layer, sublevel)
    local t = owner:CreateTexture(nil, layer, nil, sublevel)
    t:SetTexture(WHITE)
    t:SetSize(size, size)
    t:SetRotation(math.pi / 4)
    return t
end

local function cellEnter(cell)
    local r = cell.result
    if not (r and r.piece) then
        return
    end
    Gear.ShowTooltip(cell, r.piece)
    local problems = GC.Problems(r)
    if problems and GameTooltip then
        GameTooltip:AddLine(problems, COLORS.bad[1], COLORS.bad[2], COLORS.bad[3], true)
        GameTooltip:AddLine(TEXT.shiftClick, 0.6, 0.6, 0.6, true)
        GameTooltip:Show()
    end
end

local function cellLeave()
    if GameTooltip then
        GameTooltip:Hide()
    end
end

local function cellClick(cell, button)
    local row, r = cell.row, cell.result
    if not row then
        return
    end
    if button == "RightButton" then
        P.OpenMenu(cell, row)
    elseif IsShiftKeyDown and IsShiftKeyDown() and r then
        P.ToChatBox(GC.SlotLine(row, r))
    end
end

local function makeCell(rowFrame, i)
    local c = CreateFrame("Button", nil, rowFrame)
    c:SetSize(L.cellW, L.rowH)
    c:SetPoint("LEFT", rowFrame, "LEFT", L.nameW + L.ilvlW + L.issuesW + (i - 1) * L.cellW, 0)
    c:RegisterForClicks("LeftButtonUp", "RightButtonUp")
    c.slot = Gear.SLOTS[i].id
    c.back = c:CreateTexture(nil, "BACKGROUND", nil, 1)
    c.back:SetSize(L.icon, L.icon)
    c.back:SetPoint("TOP", 0, -3)
    c.icon = c:CreateTexture(nil, "ARTWORK")
    c.icon:SetAllPoints(c.back)
    c.quality = outline(c, c.back, 1, "BORDER", 1)
    c.flag = outline(c, c.back, L.edge, "OVERLAY", 1) -- red (missing) or orange (low), over the quality
    c.ilvl = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    c.ilvl:SetPoint("TOP", c.back, "BOTTOM", 0, -1)
    c.dot = c:CreateTexture(nil, "OVERLAY", nil, 3)
    c.dot:SetTexture(DISC)
    c.dot:SetSize(L.dot, L.dot)
    c.dot:SetPoint("CENTER", c.back, "TOPLEFT", 1, -1)
    c.gems = {}
    for g = 1, 3 do
        local edge = diamond(c, L.gem, "OVERLAY", 4)
        local fill = diamond(c, L.gemInner, "OVERLAY", 5)
        edge:SetPoint("CENTER", c.back, "TOPRIGHT", -1 - (g - 1) * (L.gem + L.gemGap), -1)
        fill:SetPoint("CENTER", edge, "CENTER")
        c.gems[g] = { edge = edge, fill = fill }
    end
    c:SetScript("OnEnter", cellEnter)
    c:SetScript("OnLeave", cellLeave)
    c:SetScript("OnClick", cellClick)
    return c
end

-- One slot of a row, painted from its findings.
local function paintCell(c, row, r)
    c.row, c.result = row, r
    local piece = r and r.piece
    local e = COLORS.emptyCell
    c.back:SetColorTexture(e[1], e[2], e[3], e[4])
    c.icon:SetShown(piece ~= nil)
    showLines(c.quality, piece ~= nil)
    if piece then
        c.icon:SetTexture(iconOf(piece))
        paintLines(c.quality, qualityColor(piece))
    end
    c.ilvl:SetText(piece and piece.ilvl and tostring(piece.ilvl) or "")
    c.ilvl:SetTextColor(textColor("text"))
    local missing = r and (r.missingEnchant or r.emptySockets > 0)
    local flag = missing and COLORS.bad or (r and r.low and COLORS.low) or nil
    showLines(c.flag, flag ~= nil)
    if flag then
        paintLines(c.flag, flag[1], flag[2], flag[3])
    end
    local dot = piece and r.needsEnchant and piece.itemString and (r.missingEnchant and COLORS.bad or COLORS.good) or nil
    c.dot:SetShown(dot ~= nil)
    if dot then
        c.dot:SetVertexColor(dot[1], dot[2], dot[3], 1)
    end
    local sockets = piece and math.min(3, r.sockets or 0) or 0
    for g, d in ipairs(c.gems) do
        -- the sockets from the right: filled ones first, then the empty ones
        local shown = g <= sockets
        d.edge:SetShown(shown)
        d.fill:SetShown(shown)
        if shown then
            local filled = g <= r.gems
            if filled then
                d.edge:SetVertexColor(0, 0, 0, 1)
                d.fill:SetVertexColor(COLORS.gem[1], COLORS.gem[2], COLORS.gem[3], 1)
            else
                d.edge:SetVertexColor(COLORS.bad[1], COLORS.bad[2], COLORS.bad[3], 1)
                d.fill:SetVertexColor(COLORS.socket[1], COLORS.socket[2], COLORS.socket[3], 1)
            end
        end
    end
    c:SetShown(row.seen)
end

-- Rows -------------------------------------------------------------------------------------------------------

local function rowClick(frame, button)
    if button == "RightButton" and frame.data then
        P.OpenMenu(frame, frame.data)
    end
end

local function buildRow(f)
    f:RegisterForClicks("RightButtonUp")
    f:SetScript("OnClick", rowClick)
    f.bg = f:CreateTexture(nil, "BACKGROUND")
    f.bg:SetAllPoints()
    f.name = f:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    f.name:SetPoint("LEFT", 6, 0)
    f.name:SetWidth(L.nameW - 8)
    f.name:SetJustifyH("LEFT")
    f.name:SetWordWrap(false)
    f.ilvl = f:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    f.ilvl:SetPoint("LEFT", L.nameW, 0)
    f.ilvl:SetWidth(L.ilvlW)
    f.badge = f:CreateTexture(nil, "ARTWORK")
    f.badge:SetSize(L.badgeW, L.badgeH)
    f.badge:SetPoint("LEFT", L.nameW + L.ilvlW + (L.issuesW - L.badgeW) / 2, 0)
    f.issues = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    f.issues:SetPoint("CENTER", f.badge, "CENTER")
    f.notSeen = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    f.notSeen:SetPoint("LEFT", L.nameW + L.ilvlW + L.issuesW + 8, 0)
    f.cells = {}
    for i = 1, #Gear.SLOTS do
        f.cells[i] = makeCell(f, i)
    end
end

function P.InitRow(f, row)
    if not f.cells then
        buildRow(f)
    end
    f.data = row
    local index = row.index or 1
    f.bg:SetColorTexture(rowColor(index % 2 == 1))
    f.name:SetText(shortName(row.name))
    f.name:SetTextColor(classColor(row.class))
    f.ilvl:SetText(row.avg and string.format("%.1f", row.avg) or "")
    f.ilvl:SetTextColor(textColor("text"))
    f.badge:SetShown(row.seen)
    f.issues:SetShown(row.seen)
    if row.seen then
        local c = row.issues > 0 and COLORS.bad or COLORS.good
        f.badge:SetColorTexture(c[1], c[2], c[3], 0.85)
        f.issues:SetText(tostring(row.issues))
        f.issues:SetTextColor(1, 1, 1)
    end
    local why = not row.seen and GC.Inspect and GC.Inspect.skipped[row.name]
    f.notSeen:SetText(row.seen and "" or (why and TEXT.notSeenWhy[why] or TEXT.notSeen))
    f.notSeen:SetTextColor(0.6, 0.6, 0.6)
    for i, s in ipairs(Gear.SLOTS) do
        paintCell(f.cells[i], row, row.slots[s.id])
    end
end

-- The page ------------------------------------------------------------------------------------------------------

local function settings()
    return GC:Settings()
end

local function sizeButton(b)
    local fs = b:GetFontString()
    b:SetWidth(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0))
end

local function paintHeaders()
    for _, h in ipairs(P.headers) do
        h:SetTextColor(textColor("heading"))
    end
    P.countText:SetTextColor(textColor("text"))
    for _, chip in ipairs(P.chips) do
        UI:StyleTab(chip, chip.key == settings().filter)
    end
end

-- Works out the rows (once per change) and hands them to the list; only while the page or the pop-out shows.
function P.Refresh()
    if not P.body then
        return
    end
    if not P.body:IsVisible() then
        P.dirty = true
        return
    end
    P.dirty = false
    local filter = settings().filter or "all"
    local rows = GC:Rows(filter)
    for i, row in ipairs(rows) do
        row.index = i
    end
    P.rows = rows
    P.shownIds = {}
    for _, row in ipairs(rows) do
        for _, piece in ipairs(row.pieces) do
            if piece.id then
                P.shownIds[piece.id] = true
            end
        end
    end
    P.box:SetDataProvider(CreateDataProvider(rows), ScrollBoxConstants and ScrollBoxConstants.RetainScrollPosition)
    P.countText:SetText(#rows > 0 and string.format(TEXT.count, #rows) or TEXT.empty)
    local n, m = GC.Comm:Count(GC:Roster())
    P.refreshButton:SetText(string.format(TEXT.refresh, n, m))
    sizeButton(P.refreshButton)
    paintHeaders()
end

local function selectFilter(key)
    settings().filter = key
    P.Refresh()
end

local function makeChip(parent, filter, x)
    local b = CreateFrame("Button", nil, parent, "BackdropTemplate")
    b:SetBackdrop({ bgFile = WHITE, edgeFile = WHITE, edgeSize = 1 })
    b.sel = b:CreateTexture(nil, "ARTWORK")
    b.sel:SetAllPoints()
    b.text = b:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    b.text:SetPoint("CENTER")
    b.text:SetText(filter.label)
    b:SetSize(math.ceil(b.text:GetStringWidth() or 0) + 2 * L.chipPad, L.chipH)
    b:SetPoint("TOPLEFT", x, 0)
    b.key = filter.key
    b:SetScript("OnClick", function()
        selectFilter(filter.key)
    end)
    UI:RegisterTab(b)
    return b
end

local function buildBody(body)
    local x = 0
    for _, filter in ipairs(GC.FILTERS) do
        local chip = makeChip(body, filter, x)
        P.chips[#P.chips + 1] = chip
        x = x + chip:GetWidth() + L.chipGap
    end
    UI.Help(body, TEXT.title, string.format(TEXT.help, GC.LOW_ILVL)):SetPoint("LEFT", P.chips[#P.chips], "RIGHT", 8, 0)

    P.popButton = UI.PanelButton(body, TEXT.popOut, L.buttonH, function()
        P.TogglePopout()
    end)
    P.popButton:SetPoint("TOPRIGHT", body, "TOPRIGHT", 0, 0)
    P.refreshButton = UI.PanelButton(body, string.format(TEXT.refresh, 1, 1), L.buttonH, function()
        GC:Refresh()
    end)
    P.refreshButton:SetPoint("RIGHT", P.popButton, "LEFT", -6, 0)
    P.countText = body:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    P.countText:SetPoint("RIGHT", P.refreshButton, "LEFT", -10, 0)

    -- the column headings, over the list's columns
    local function heading(text, x0, w, justify)
        local h = body:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        h:SetPoint("TOPLEFT", x0, L.headY)
        h:SetWidth(w)
        h:SetJustifyH(justify or "CENTER")
        h:SetWordWrap(false)
        h:SetText(text)
        P.headers[#P.headers + 1] = h
        return h
    end
    heading(TEXT.name, 6, L.nameW - 6, "LEFT")
    heading(TEXT.ilvl, L.nameW, L.ilvlW)
    heading(TEXT.issues, L.nameW + L.ilvlW, L.issuesW)
    for i, s in ipairs(Gear.SLOTS) do
        heading(s.name, L.nameW + L.ilvlW + L.issuesW + (i - 1) * L.cellW, L.cellW)
    end

    local box = CreateFrame("Frame", nil, body, "WowScrollBoxList")
    box:SetPoint("TOPLEFT", 0, L.listY)
    box:SetPoint("BOTTOMLEFT", 0, 0)
    box:SetWidth(L.rowW)
    local bar = CreateFrame("EventFrame", nil, body, "MinimalScrollBar")
    UI:SkinScrollBar(bar)
    bar:SetPoint("TOPLEFT", box, "TOPRIGHT", L.barGap, 0)
    bar:SetPoint("BOTTOMLEFT", box, "BOTTOMRIGHT", L.barGap, 0)
    local view = CreateScrollBoxListLinearView()
    view:SetElementExtent(L.rowH)
    view:SetElementInitializer("Button", P.InitRow)
    ScrollUtil.InitScrollBoxListWithScrollBar(box, bar, view)
    P.box, P.bar = box, bar
end

-- The pop-out window ------------------------------------------------------------------------------------------

local function popSettings()
    local s = settings()
    s.popout = s.popout or {}
    return s.popout
end

local function buildPopout()
    if P.window then
        return
    end
    P.window = UI.Window("CowfeeRaidToolsGearCheckerWindow", {
        kind = "popout", title = TEXT.title, layer = "popups", saved = popSettings,
        width = L.popW, height = L.popH, minWidth = L.popMinW, minHeight = L.popMinH,
    })
    P.window.refresh = P.Refresh
    -- closing the window, however it closes (its X, Escape or Dock), puts the page back
    P.window:SetScript("OnHide", function()
        if P.popped then
            P.Dock()
        end
    end)
    P.window:SetScript("OnShow", P.Refresh)
end

function P.Dock()
    P.popped = false
    P.body:SetParent(P.page)
    P.body:ClearAllPoints()
    P.body:SetPoint("TOPLEFT", 8, -8)
    P.body:SetPoint("BOTTOMRIGHT", -8, 8)
    P.body:Show()
    P.dockedNote:Hide()
    P.popButton:SetText(TEXT.popOut)
    sizeButton(P.popButton)
    if P.window and P.window:IsShown() then
        P.window:Hide()
    end
    P.Refresh()
end

function P.PopOut()
    buildPopout()
    P.popped = true
    P.window:SetScale(UI:Scale() / 100)
    P.window:Place()
    P.body:SetParent(P.window.content)
    P.body:ClearAllPoints()
    P.body:SetAllPoints(P.window.content)
    P.body:Show()
    P.dockedNote:Show()
    P.popButton:SetText(TEXT.dock)
    sizeButton(P.popButton)
    P.window:Show()
    UI:SkinTree(P.window)
    P.Refresh()
end

function P.TogglePopout()
    if P.popped then
        P.Dock()
    else
        P.PopOut()
    end
end

-- /crt gear pop: the page in its own window, built first if the main window never showed it.
function GC.Popout()
    if not P.body then
        UI:Show("gearcheck")
    end
    if P.body and not P.popped then
        P.PopOut()
    end
end

local function build(page)
    P.page = page
    local body = CreateFrame("Frame", nil, page)
    body:SetPoint("TOPLEFT", 8, -8)
    body:SetPoint("BOTTOMRIGHT", -8, 8)
    P.body = body
    buildBody(body)
    body:SetScript("OnShow", function()
        if P.dirty then
            P.Refresh()
        end
    end)

    -- shown on the page while the pop-out holds the rest
    local note = CreateFrame("Frame", nil, page)
    note:SetAllPoints()
    note:Hide()
    local text = note:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    text:SetPoint("TOPLEFT", 8, -12)
    text:SetText(TEXT.docked)
    P.headers[#P.headers + 1] = text
    local back = UI.PanelButton(note, TEXT.bringBack, L.buttonH, function()
        P.Dock()
    end)
    back:SetPoint("LEFT", text, "RIGHT", 10, 0)
    P.dockedNote = note

    page:SetScript("OnShow", function()
        if not P.refreshedOnce then
            P.refreshedOnce = true
            GC:Refresh() -- the first time the page shows: ask the group and inspect the rest
        end
        P.Refresh()
    end)
    GC:OnChange(P.Refresh)
    UI:OnTheme(P.Refresh)
    P.Refresh()
end

-- An item shown on the page has loaded (its quality, and so its border colour, comes only then): one
-- redraw a moment later for all the items that load together.
P.LOAD_REDRAW = 0.2 -- seconds

function P.OnEvent(event, itemID)
    if event ~= "ITEM_DATA_LOAD_RESULT" or secret(itemID) or not (P.shownIds and P.shownIds[itemID]) or P.redrawWaiting then
        return
    end
    P.redrawWaiting = true
    C_Timer.After(P.LOAD_REDRAW, function()
        P.redrawWaiting = false
        P.Refresh()
    end)
end

if CreateFrame then
    local events = CreateFrame("Frame")
    events:RegisterEvent("ITEM_DATA_LOAD_RESULT")
    events:SetScript("OnEvent", function(_, event, itemID)
        P.OnEvent(event, itemID)
    end)
end

UI:RegisterPage("gearcheck", TEXT.title, build)
