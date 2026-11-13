local ADDON, CRT = ...

-- Loot Master > Wishlists (Alex, 2026-11-11, Issue #1269): the raiders' saved wishlists (LootMaster/WishlistSaved.lua),
-- for a keeper (W.Keeps: a guild officer, the loot master, the raid leader or an assist). Everyone else sees one line
-- saying who keeps lists, with a (?).
--   View      Bosses: per boss in route order, Big / Small / Off counts and a value bar; the headings sort (Value,
--             Big, Small, Off; a third click goes back to route order); a click on a boss opens Boss detail.
--             Boss detail: the boss's items someone wants (icon in its quality's border, with its tooltip, and name),
--             then who wants each, by rank ("Big: A, B  Small: C  Off: D"), names in class colour.
--             Raiders: per raider, Big/Small/Off counts per boss (one column a boss, blank when none) and Updated (how
--             old their list is; past V.OLD_DAYS in warn). Players in your raid with no list show "no list". The X
--             forgets one raider's list.
--   Team      Everyone kept, In my raid now, Raid Groups layout: then a Layout dropdown beside it picks which saved
--             layout (Groups:PresetNames; the one in use by default, never changing Use This Group).
--   Forget all asks first (W.AskForgetAll).
-- The rows are worked out once per data change (a list heard or forgotten, your own list, the Journal's data, the
-- roster, a Raid Groups layout, a pick); the lists draw only the rows in view. The view, team, layout, boss and sort are kept in
-- lootmaster.wishlistsTab. Built by Page.lua's tab (LM.BuildWishlistsTab), inside the page area.

local LM = CRT.LootMaster
local UI = CRT.UI
local W = LM.Wishlist
local V = W.Views

local L = {
    x = 8, top = -8, controls = -30, head = -70, list = -90, rowH = 24, bottom = 8, scrollGap = 20,
    -- the controls' row: View, Team, Layout (only for a Raid Groups layout) and Boss (only in Boss detail), all four
    -- left of Forget all at the page's width
    -- (Boss narrows to bossNarrowW while Layout shows)
    viewLabel = 34, viewW = 130, teamLabel = 38, teamW = 170, layoutLabel = 44, layoutW = 160, bossLabel = 34, bossW = 220,
    bossNarrowW = 200, gap = 16,
    -- Bosses
    bossName = 4, bossNameW = 260, count = 60, big = 270, small = 334, off = 398, value = 462, barW = 300, barH = 10, valueY = -6, valueW = 60,
    -- Boss detail
    icon = 4, iconSize = 22, iconEdge = 2, itemName = 32, itemNameW = 240, wants = 282,
    -- Raiders
    name = 4, nameW = 160, grid = 170, updatedW = 80, forget = 16, minCol = 48,
}

local TEXT = {
    title = "Raiders' wishlists",
    -- the list form (UI.AddTooltipText): one paragraph per view and the Team filter
    help = {
        "The wishlists raiders made in the Adventure Guide or with /crt wishlist. Guild officers, the loot master, the raid leader and raid assists keep a copy of each list they hear, saved between sessions. Raiders send their list to the guild when it changes and a little after they log in, so it arrives without a group.",
        { "Bosses", "the wants for each boss's items, as Big upgrade, Small upgrade and Off spec. Value adds them up as Big 3, Small 1 and Off 0.5. Click a boss to see its items." },
        { "Boss detail", "who wants each item, by rank." },
        { "Raiders", "each raider's wants per boss as Big/Small/Off, and how old their list is." },
        { "Team", "everyone you keep, the players in your raid now, or the players in a Raid Groups layout you pick." },
    },
    notKeeper = "Only officers and raid assists keep raiders' lists.",
    notKeeperHelp = "Raiders' wishlists are kept by guild officers (a rank that can edit officer notes), the loot master, the raid leader and raid assists.\n\nYour own list is My wishlist, on the Tonight tab.",
    view = "View",
    views = { { key = "bosses", label = "Bosses" }, { key = "detail", label = "Boss detail" }, { key = "raiders", label = "Raiders" } },
    team = "Team",
    teams = { all = "Everyone kept", raid = "In my raid now", team = "Raid Groups layout" },
    noLayout = "Save a layout on Raid Groups first.",
    layout = "Layout",
    inUse = "%s (in use)",
    boss = "Boss",
    forgetAll = "Forget all",
    forget = "Forget %s's list",
    colBoss = "Boss", colBig = "Big", colSmall = "Small", colOff = "Off", colValue = "Value",
    colItem = "Item", colWants = "Who wants it",
    colRaider = "Raider", colUpdated = "Updated",
    big = "Big", small = "Small", off = "Off",
    noList = "no list",
    today = "today", day = "1 day", days = "%d days",
    none = "No wishlists kept yet.",
    noneDetail = "Nobody wants this boss's items yet.",
    loading = "Loading the items...",
}

local parts = {} -- the tab's frames, kept for the tests
local rows = { bosses = {}, detail = {}, raiders = {} } -- worked out per data change; people: who counts (V.Raiders)
local frame -- the tab's frame

local function state()
    local set = LM:Settings()
    if type(set.wishlistsTab) ~= "table" then
        set.wishlistsTab = {}
    end
    return set.wishlistsTab
end

local function picked()
    local s = state()
    local team = s.team or "all"
    if not V.HasTeam(team) then
        team = "all"
    end
    return s.view or "bosses", team
end

-- The Raid Groups layout Team reads: the one picked while it is still saved, else the one in use, else the first.
local function layoutPick()
    return V.LayoutPick(state().layout)
end

local function seasonKey()
    local def = CRT.Bosses and CRT.Bosses:Current()
    return def and def.key or nil
end

-- The boss Boss detail shows: the one picked while it is in this season's map, else the season's first (a boss
-- kept from an older season reads as the first).
local function detailBoss()
    local s = state()
    local bosses = V.Map().bosses or {}
    for _, b in ipairs(bosses) do
        if b.encounterID == s.boss then
            return s.boss
        end
    end
    return bosses[1] and bosses[1].encounterID or nil
end

local function classText(name, class)
    local short = Ambiguate(name, "none")
    local c = class and (C_ClassColor and C_ClassColor.GetClassColor(class) or (RAID_CLASS_COLORS and RAID_CLASS_COLORS[class]))
    return c and c.WrapTextInColorCode and c:WrapTextInColorCode(short) or short
end

local function count(n, key)
    return n > 0 and UI.ColorText(tostring(n), key) or UI.ColorText("0", "muted")
end

-- "2/1/0" in the ranks' colours, or "" when all are 0.
local function bso(c)
    if not c or c.big + c.small + c.off == 0 then
        return ""
    end
    return UI.ColorText(tostring(c.big), W.RANK_COLOR.big) .. "/" .. UI.ColorText(tostring(c.small), W.RANK_COLOR.small)
        .. "/" .. UI.ColorText(tostring(c.off), W.RANK_COLOR.off)
end

-- "Big: A, B  Small: C  Off: D", the rank words in their colours, the names in class colour.
local function wantsText(wants)
    local out = {}
    for _, rank in ipairs(W.RANKS) do
        local list = wants[rank]
        if list and #list > 0 then
            local names = {}
            for i, r in ipairs(list) do
                names[i] = classText(r.name, r.class)
            end
            out[#out + 1] = UI.ColorText(TEXT[rank] .. ":", W.RANK_COLOR[rank]) .. " " .. table.concat(names, ", ")
        end
    end
    return table.concat(out, "  ")
end
LM.WishlistWantsText = wantsText -- for tests

local function ageText(row)
    if row.noList then
        return UI.ColorText(TEXT.noList, "muted")
    elseif row.age == nil then
        return ""
    end
    local text = row.age == 0 and TEXT.today or row.age == 1 and TEXT.day or TEXT.days:format(row.age)
    return row.old and UI.ColorText(text, "warn") or text
end
LM.WishlistAgeText = ageText -- for tests

local function fontString(row, x, w, justify)
    local fs = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    fs:SetPoint("LEFT", x, 0)
    if w then
        fs:SetWidth(w)
    end
    fs:SetJustifyH(justify or "LEFT")
    fs:SetWordWrap(false)
    return fs
end

local function hover(row)
    local hl = row:CreateTexture(nil, "HIGHLIGHT")
    hl:SetAllPoints()
    hl:SetColorTexture(1, 1, 1, 0.05)
end

-- One list: a WowScrollBoxList and its bar, under the headings, one row each extent.
local function makeList(f, init)
    local box = CreateFrame("Frame", nil, f, "WowScrollBoxList")
    box:SetPoint("TOPLEFT", L.x, L.list)
    box:SetPoint("BOTTOMRIGHT", -(L.x + L.scrollGap), L.bottom)
    local bar = CreateFrame("EventFrame", nil, f, "MinimalScrollBar")
    UI:SkinScrollBar(bar)
    bar:SetPoint("TOPLEFT", box, "TOPRIGHT", 6, 0)
    bar:SetPoint("BOTTOMLEFT", box, "BOTTOMRIGHT", 6, 0)
    local v = CreateScrollBoxListLinearView()
    v:SetElementExtent(L.rowH)
    v:SetElementInitializer("Button", init)
    ScrollUtil.InitScrollBoxListWithScrollBar(box, bar, v)
    box.bar = bar
    return box
end

local function heading(f, x, text, w)
    local h = f:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    h:SetPoint("TOPLEFT", L.x + x, L.head)
    if w then
        h:SetWidth(w)
        h:SetWordWrap(false)
    end
    h:SetJustifyH("LEFT")
    h:SetText(text)
    UI.Tint(h, "SetTextColor", "label")
    return h
end

local refresh -- set below

-- View A: Bosses ------------------------------------------------------------------------------------------

local function initBossRow(row, data)
    if not row.name then
        hover(row)
        row.name = fontString(row, L.bossName, L.bossNameW)
        row.big = fontString(row, L.big, L.count)
        row.small = fontString(row, L.small, L.count)
        row.off = fontString(row, L.off, L.count)
        -- the shared value bar (the catalog's Night bars, as Season Stats draws them), the value on its right
        row.bar = UI.ValueBar(row, { x = L.value, y = -(L.rowH - L.barH) / 2, w = L.barW, h = L.barH, textY = L.valueY, textW = L.valueW })
        row:SetScript("OnClick", function(self)
            if self.data then
                local s = state()
                s.boss, s.view = self.data.encounterID, "detail"
                refresh()
            end
        end)
    end
    row.data = data
    row.name:SetText(data.name)
    row.big:SetText(count(data.big, W.RANK_COLOR.big))
    row.small:SetText(count(data.small, W.RANK_COLOR.small))
    row.off:SetText(count(data.off, W.RANK_COLOR.off))
    UI.SetValueBar(row.bar, data.value, rows.maxValue, tostring(data.value))
end

local BOSS_COLS = {
    { key = "name", x = L.bossName, w = L.bossNameW, title = TEXT.colBoss, sortable = false },
    { key = "big", x = L.big, w = L.count, title = TEXT.colBig },
    { key = "small", x = L.small, w = L.count, title = TEXT.colSmall },
    { key = "off", x = L.off, w = L.count, title = TEXT.colOff },
    { key = "value", x = L.value, w = L.barW, title = TEXT.colValue },
}

local function buildBosses(f)
    local view = CreateFrame("Frame", nil, f)
    view:SetAllPoints()
    view.sorter = UI.SortHeaders(view, BOSS_COLS, {
        x = L.x, y = L.head, backToDefault = true,
        get = function()
            local s = state()
            return s.sortKey, s.sortDir or 1
        end,
        set = function(key, dir)
            local s = state()
            s.sortKey, s.sortDir = key, dir
            refresh()
        end,
    })
    view.list = makeList(view, initBossRow)
    return view
end

-- View B: Boss detail -------------------------------------------------------------------------------------

-- Every name for an item, one rank a line, for a row too long to read in full.
local function showWantsTip(owner, data)
    if not data then
        return
    end
    UI.TooltipOwner(GameTooltip, owner, "ANCHOR_RIGHT", nil, nil, "lootmaster")
    GameTooltip:SetText(data.item.name or ("item:" .. data.item.id))
    for _, rank in ipairs(W.RANKS) do
        local list = data.wants[rank]
        if #list > 0 then
            local names = {}
            for i, r in ipairs(list) do
                names[i] = classText(r.name, r.class)
            end
            GameTooltip:AddLine(UI.ColorText(W.Label(rank) .. ":", W.RANK_COLOR[rank]) .. " " .. table.concat(names, ", "), 1, 1, 1, true)
        end
    end
    GameTooltip:Show()
end

local function hideTip()
    GameTooltip:Hide()
end

local function initDetailRow(row, data)
    if not row.icon then
        hover(row)
        row.icon = W.ItemIcon(row, L.icon, L.iconSize, L.iconEdge, function()
            return row.data and row.data.item
        end)
        row.name = fontString(row, L.itemName, L.itemNameW)
        row.wants = fontString(row, L.wants)
        row.wants:SetPoint("RIGHT", -4, 0)
        row:SetScript("OnEnter", function(self)
            showWantsTip(self, self.data)
        end)
        row:SetScript("OnLeave", hideTip)
    end
    row.data = data
    local it = data.item
    W.SetItemIcon(row.icon, it)
    row.name:SetText(it.name or ("item:" .. it.id))
    row.name:SetTextColor(W.QualityColor(it.quality)) -- the game's item quality colour: not a theme colour
    row.wants:SetText(wantsText(data.wants))
end

local function buildDetail(f)
    local view = CreateFrame("Frame", nil, f)
    view:SetAllPoints()
    heading(view, L.icon, TEXT.colItem)
    heading(view, L.wants, TEXT.colWants)
    view.list = makeList(view, initDetailRow)
    return view
end

-- View C: Raiders -----------------------------------------------------------------------------------------

-- The boss columns: as many as the season has, sharing the width between the names and Updated.
local function gridLayout()
    local bosses = V.Map().bosses
    local width = UI.PAGE_W - 2 * L.x - L.scrollGap - L.grid - L.updatedW - L.forget - 8
    local colW = #bosses > 0 and math.max(L.minCol, math.floor(width / #bosses)) or L.minCol
    return bosses, colW, L.grid + colW * #bosses
end

local function initRaiderRow(row, data)
    if not row.name then
        hover(row)
        row.name = fontString(row, L.name, L.nameW)
        row.cells = {}
        row.updated = fontString(row, 0, L.updatedW)
        row.forget = CreateFrame("Button", nil, row, "UIPanelCloseButton")
        row.forget:SetSize(L.forget, L.forget)
        UI:SkinCloseButton(row.forget)
        row.forget:SetScript("OnClick", function()
            if row.data then
                W.Forget(row.data.name)
            end
        end)
        row.forget:SetScript("OnEnter", function(self)
            if row.data then
                UI.TooltipOwner(GameTooltip, self, "ANCHOR_RIGHT", nil, nil, "lootmaster")
                GameTooltip:SetText(TEXT.forget:format(Ambiguate(row.data.name, "none")))
                GameTooltip:Show()
            end
        end)
        row.forget:SetScript("OnLeave", hideTip)
    end
    row.data = data
    local bosses, colW, right = gridLayout()
    for i, boss in ipairs(bosses) do
        local cell = row.cells[i]
        if not cell then
            cell = fontString(row, 0, colW - 4)
            row.cells[i] = cell
        end
        cell:ClearAllPoints()
        cell:SetPoint("LEFT", L.grid + (i - 1) * colW, 0)
        cell:SetWidth(colW - 4)
        cell:SetText(bso(data.counts[boss.encounterID]))
        cell:Show()
    end
    for i = #bosses + 1, #row.cells do
        row.cells[i]:Hide()
    end
    row.name:SetText(data.noList and UI.ColorText(Ambiguate(data.name, "none"), "muted") or classText(data.name, data.class))
    row.updated:ClearAllPoints()
    row.updated:SetPoint("LEFT", right + 4, 0)
    row.updated:SetText(ageText(data))
    row.forget:ClearAllPoints()
    row.forget:SetPoint("LEFT", right + 4 + L.updatedW, 0)
    row.forget:SetShown(not data.noList and data.name ~= LM:Me())
end

-- A boss column's heading: its name cut to the column, the whole name on hover.
local function bossHeading(view, i)
    local b = CreateFrame("Button", nil, view)
    b:SetHeight(18)
    b.text = b:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    b.text:SetAllPoints()
    b.text:SetJustifyH("LEFT")
    b.text:SetWordWrap(false)
    UI.Tint(b.text, "SetTextColor", "label")
    b:SetScript("OnEnter", function(self)
        if self.name then
            UI.TooltipOwner(GameTooltip, self, "ANCHOR_TOP", nil, nil, "lootmaster")
            GameTooltip:SetText(self.name)
            GameTooltip:AddLine(TEXT.big .. "/" .. TEXT.small .. "/" .. TEXT.off, 1, 1, 1)
            GameTooltip:Show()
        end
    end)
    b:SetScript("OnLeave", hideTip)
    view.bossHeads[i] = b
    return b
end

local function placeHeadings(view)
    local bosses, colW, right = gridLayout()
    for i, boss in ipairs(bosses) do
        local b = view.bossHeads[i] or bossHeading(view, i)
        b:ClearAllPoints()
        b:SetPoint("TOPLEFT", L.x + L.grid + (i - 1) * colW, L.head)
        b:SetWidth(colW - 4)
        b.name = boss.name
        b.text:SetText(boss.name)
        b:Show()
    end
    for i = #bosses + 1, #view.bossHeads do
        view.bossHeads[i]:Hide()
    end
    view.updatedHead:ClearAllPoints()
    view.updatedHead:SetPoint("TOPLEFT", L.x + right + 4, L.head)
end

local function buildRaiders(f)
    local view = CreateFrame("Frame", nil, f)
    view:SetAllPoints()
    view.bossHeads = {}
    heading(view, L.name, TEXT.colRaider)
    view.updatedHead = heading(view, 0, TEXT.colUpdated)
    view.list = makeList(view, initRaiderRow)
    return view
end

-- The tab ---------------------------------------------------------------------------------------------------

-- Works the rows out for the pick: once per data change, never per row drawn.
local function work()
    local view, team = picked()
    local raiders = V.Raiders(team, layoutPick())
    local m = V.Map()
    local s = state()
    rows.view, rows.loading, rows.people = view, m.loading, raiders
    if view == "bosses" then
        local list = V.BossRows(raiders)
        local max = 0
        for _, r in ipairs(list) do
            max = math.max(max, r.value)
        end
        rows.maxValue = max
        rows.bosses = V.SortBossRows(list, s.sortKey, s.sortDir)
    elseif view == "detail" then
        rows.detail = V.Detail(raiders, detailBoss())
    else
        rows.raiders = V.RaiderRows(raiders)
    end
    return rows
end
LM.WishlistTabWork = work -- for tests

local function emptyText()
    if rows.loading then
        return TEXT.loading
    elseif rows.view == "detail" then
        return TEXT.noneDetail
    end
    return TEXT.none
end

refresh = function()
    if not (frame and frame:IsVisible()) then
        return
    end
    local keeps = W.Keeps()
    parts.note:SetShown(not keeps)
    parts.controls:SetShown(keeps)
    if not keeps then
        return
    end
    work()
    local view = rows.view
    local byLayout = select(2, picked()) == "team"
    parts.viewRow.refresh()
    parts.teamRow.refresh()
    parts.layoutRow:SetShown(byLayout)
    if byLayout then
        parts.layoutRow.refresh()
    end
    -- Boss sits right of Layout while it shows (narrower, to fit the page), else right of Team
    parts.bossRow.SetDropdownWidth(byLayout and L.bossNarrowW or L.bossW)
    parts.bossRow:ClearAllPoints()
    parts.bossRow:SetPoint("LEFT", byLayout and parts.layoutRow or parts.teamRow, "RIGHT", L.gap, 0)
    parts.bossRow.refresh()
    parts.bossRow:SetShown(view == "detail")
    local list
    for key, v in pairs(parts.views) do
        v:SetShown(key == view)
    end
    if view == "bosses" then
        parts.views.bosses.sorter.refresh()
        list = rows.bosses
    elseif view == "detail" then
        list = rows.detail
    else
        placeHeadings(parts.views.raiders)
        list = rows.raiders
    end
    parts.views[view].list:SetDataProvider(CreateDataProvider(list), ScrollBoxConstants and ScrollBoxConstants.RetainScrollPosition)
    parts.empty:SetText(emptyText())
    parts.empty:SetShown(#list == 0)
end

local function teamOptions()
    local out = {}
    for _, key in ipairs(V.TEAMS) do
        local o = { key = key, label = TEXT.teams[key] }
        if key == "team" then
            o.disabled = function()
                return not V.HasTeam("team")
            end
            o.tooltip = TEXT.noLayout
        end
        out[#out + 1] = o
    end
    return out
end

-- Every saved Raid Groups layout, in its saved order (asked when the list opens, so a rename or a new layout shows),
-- the one in use tagged.
local function layoutOptions()
    local active = CRT.Groups and CRT.Groups.Active and CRT.Groups:Active()
    local out = {}
    for _, p in ipairs(V.Layouts()) do
        local name = tostring(p.name or p.id)
        out[#out + 1] = { key = p.id, label = p.id == active and TEXT.inUse:format(name) or name }
    end
    return out
end

local function buildControls(f)
    local c = CreateFrame("Frame", nil, f)
    c:SetAllPoints()
    parts.controls = c
    parts.viewRow = UI.Dropdown(c, TEXT.view, {
        labelWidth = L.viewLabel, width = L.viewW, options = TEXT.views,
        get = function()
            return (picked())
        end,
        set = function(key)
            state().view = key
            refresh()
        end,
    })
    parts.viewRow:SetPoint("TOPLEFT", L.x, L.controls)
    parts.teamRow = UI.Dropdown(c, TEXT.team, {
        labelWidth = L.teamLabel, width = L.teamW, options = teamOptions,
        get = function()
            return select(2, picked())
        end,
        set = function(key)
            state().team = key
            refresh()
        end,
    })
    parts.teamRow:SetPoint("LEFT", parts.viewRow, "RIGHT", L.gap, 0)
    parts.layoutRow = UI.Dropdown(c, TEXT.layout, {
        labelWidth = L.layoutLabel, width = L.layoutW, maxHeight = 400, options = layoutOptions,
        get = layoutPick,
        set = function(key)
            state().layout = key
            refresh()
        end,
    })
    parts.layoutRow:SetPoint("LEFT", parts.teamRow, "RIGHT", L.gap, 0)
    parts.bossRow = UI.Dropdown(c, TEXT.boss, {
        labelWidth = L.bossLabel, width = L.bossW, maxHeight = 400,
        options = function()
            return CRT.Bosses and CRT.Bosses:Options(seasonKey()) or {}
        end,
        get = detailBoss,
        set = function(key)
            state().boss = key
            refresh()
        end,
    })
    parts.bossRow:SetPoint("LEFT", parts.teamRow, "RIGHT", L.gap, 0)
    parts.forgetAll = UI.PanelButton(c, TEXT.forgetAll, 24, function()
        W.AskForgetAll()
    end)
    parts.forgetAll:SetPoint("TOPRIGHT", -L.x, L.controls + 2)
    parts.views = { bosses = buildBosses(c), detail = buildDetail(c), raiders = buildRaiders(c) }
    parts.empty = c:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    parts.empty:SetPoint("TOP", 0, L.list - 40)
    UI.Tint(parts.empty, "SetTextColor", "muted")
end

-- Page.lua's Wishlists tab. h: { heading, refreshers }.
function LM.BuildWishlistsTab(f, h)
    frame = f
    h.heading(f, L.x, L.top, TEXT.title, TEXT.help)
    parts.note = f:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    parts.note:SetPoint("TOPLEFT", L.x, L.controls - 6)
    parts.note:SetText(TEXT.notKeeper)
    UI.Tint(parts.note, "SetTextColor", "text")
    UI.HelpRight(parts.note, TEXT.notKeeper, TEXT.notKeeperHelp)
    buildControls(f)
    h.refreshers[#h.refreshers + 1] = refresh
end

-- For tests: the tab's parts and rows.
function LM.WishlistTabParts()
    return parts, rows
end

local workSet = false -- a redraw waits for the next frame
local function soon(forgetMap)
    if forgetMap then
        V.ForgetMap()
    end
    if workSet or not (frame and frame:IsVisible()) then
        return
    end
    workSet = true
    C_Timer.After(0, function()
        workSet = false
        refresh()
    end)
end

LM:OnChange(function(what, how)
    if what == "wishlist" then
        soon(how == "loot") -- the Journal's data or an item's name arrived: the item map again
    elseif what == "wishlists" or what == "authority" then
        soon(false) -- a list kept or forgotten; the roster or who leads changed
    end
end)
if CRT.Groups and CRT.Groups.OnChange then
    CRT.Groups:OnChange(function()
        soon(false) -- a Raid Groups layout saved, renamed, edited or put in use
    end)
end
UI:OnTheme(refresh)
