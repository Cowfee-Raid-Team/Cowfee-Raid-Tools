local ADDON, CRT = ...

-- My wishlist: your wishlist (LootMaster/Wishlist.lua) built from the current season's raid loot. Opened from the
-- My Loot card's My wishlist button (LootMaster/Tonight.lua) and /crt wishlist (LM:ShowWishlist). A pop-out made by
-- UI.Window; its place, size, the boss picked and Only my class are kept in CRTDB lootmaster.wishlistWindow.
--   Boss: the season's raid bosses in route order (CRT.Bosses:Options), with All bosses first.
--   Only my class: the Journal's class filter for your class.
--   One row per item the Encounter Journal lists for the boss (W.BossLoot, LootMaster/WishlistJournal.lua): a tick
--   (on your list), the item's icon in its quality's border with its tooltip, its name, its slot, and its rank
--   (a dropdown; "Not wanted", greyed, while unticked). A tick adds the item as W.DEFAULT_RANK.
--   The status line under the list: how many items are on your list and whether it went to the loot master.
-- The rows are worked out once per pick (and when the Journal's data arrives); the list only draws the rows in
-- view. The Journal's right-click menu changes the same list, so each shows the other's changes.

local LM = CRT.LootMaster
local UI = CRT.UI
local W = LM.Wishlist

local L = {
    width = 580, height = 460, minWidth = 540, minHeight = 300,
    top = -4, labelW = 40, bossW = 240, checkGap = 16,
    listTop = -42, statusH = 22, rowH = 28,
    tick = 2, icon = 26, iconSize = 24, iconEdge = 2, name = 56, nameW = 200, slot = 262, slotW = 90, rank = 356, rankW = 130,
}

local TEXT = {
    title = "My wishlist",
    help = "Tick the items you want from this season's raids and give each a rank: Big upgrade, Small upgrade or Off spec. The loot master and raid assists see your rank when the item drops, and it breaks ties between equal answers.\n\nYou can also right-click an item in the Adventure Guide's loot list. Your list goes to the group a few seconds after a change, when you join a group and when a loot session starts, never during a boss fight. Wanting an item counts for every difficulty.",
    boss = "Boss",
    allBosses = "All bosses",
    classOnly = "Only my class",
    countOne = "1 item on your list. %s",
    countMany = "%d items on your list. %s",
    loading = "Loading the items...",
    missing = "This boss isn't in the Adventure Guide's current expansion.",
    noJournal = "The Adventure Guide can't be read here.",
    none = "No items to show.",
}

local win, list, bossRow, classCheck, status, empty
local rows = {} -- the rows worked out for the pick: { header = name } or { item = { id, name, link, icon, quality, slot } }

local function saved()
    return CRT.db.lootmaster.wishlistWindow
end

local function seasonKey()
    local def = CRT.Bosses and CRT.Bosses:Current()
    return def and def.key or nil
end

local function bossOptions()
    local out = { { key = "all", label = TEXT.allBosses } }
    for _, o in ipairs(CRT.Bosses and CRT.Bosses:Options(seasonKey()) or {}) do
        out[#out + 1] = o
    end
    return out
end

local function picked()
    local s = saved()
    return s.boss or "all", s.classOnly and true or false
end

local function qualityColor(q)
    if type(q) == "number" and C_Item and C_Item.GetItemQualityColor then
        local ok, r, g, b = pcall(C_Item.GetItemQualityColor, q)
        if ok and type(r) == "number" then
            return r, g, b
        end
    end
    return UI.Color("border")
end

-- Rows ------------------------------------------------------------------------------------------------

local function showTip(owner, it)
    if not it then
        return
    end
    UI.TooltipOwner(GameTooltip, owner, "ANCHOR_RIGHT", nil, nil, "lootmaster")
    pcall(GameTooltip.SetHyperlink, GameTooltip, it.link or ("item:" .. it.id))
    GameTooltip:Show()
end

local function hideTip()
    GameTooltip:Hide()
end

local function rankOptions(row)
    local it = row.data and row.data.item
    if not (it and W.Rank(it.id)) then
        return { { key = "none", label = W.TEXT.notWanted } }
    end
    local out = {}
    for _, rank in ipairs(W.RANKS) do
        out[#out + 1] = { key = rank, label = W.Label(rank) }
    end
    return out
end

local function makeRow(row)
    row.heading = row:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    row.heading:SetPoint("LEFT", L.tick, 0)
    row.tick = CreateFrame("CheckButton", nil, row, "UICheckButtonTemplate")
    row.tick:SetSize(22, 22)
    row.tick:SetPoint("LEFT", L.tick, 0)
    UI:SkinCheckButton(row.tick)
    row.tick:SetScript("OnClick", function(self)
        local it = row.data and row.data.item
        if it then
            W.Set(it.id, self:GetChecked() and (W.Rank(it.id) or W.DEFAULT_RANK) or nil)
        end
    end)
    row.icon = CreateFrame("Button", nil, row, "BackdropTemplate")
    row.icon:SetSize(L.iconSize, L.iconSize)
    row.icon:SetPoint("LEFT", L.icon, 0)
    row.icon:SetBackdrop({ edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = L.iconEdge })
    row.icon.tex = row.icon:CreateTexture(nil, "ARTWORK")
    row.icon.tex:SetPoint("TOPLEFT", L.iconEdge, -L.iconEdge)
    row.icon.tex:SetPoint("BOTTOMRIGHT", -L.iconEdge, L.iconEdge)
    row.icon:SetScript("OnEnter", function(self)
        showTip(self, row.data and row.data.item)
    end)
    row.icon:SetScript("OnLeave", hideTip)
    row.name = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    row.name:SetPoint("LEFT", L.name, 0)
    row.name:SetWidth(L.nameW)
    row.name:SetJustifyH("LEFT")
    row.name:SetWordWrap(false)
    row.slot = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    row.slot:SetPoint("LEFT", L.slot, 0)
    row.slot:SetWidth(L.slotW)
    row.slot:SetJustifyH("LEFT")
    row.slot:SetWordWrap(false)
    UI.Tint(row.slot, "SetTextColor", "muted")
    row.rank = UI.Dropdown(row, "", {
        labelWidth = 0, width = L.rankW,
        options = function()
            return rankOptions(row)
        end,
        get = function()
            local it = row.data and row.data.item
            return it and W.Rank(it.id) or "none"
        end,
        set = function(rank)
            local it = row.data and row.data.item
            if it and W.IsRank(rank) then
                W.Set(it.id, rank)
            end
        end,
        enabledIf = function()
            local it = row.data and row.data.item
            return it ~= nil and W.Rank(it.id) ~= nil
        end,
    })
    row.rank:SetPoint("LEFT", L.rank, 0)
end

local function initRow(row, data)
    if not row.tick then
        makeRow(row)
    end
    row.data = data
    local it = data.item
    row.heading:SetShown(data.header ~= nil)
    row.heading:SetText(data.header or "")
    for _, part in ipairs({ row.tick, row.icon, row.name, row.slot, row.rank }) do
        part:SetShown(it ~= nil)
    end
    if not it then
        return
    end
    row.tick:SetChecked(W.Rank(it.id) ~= nil)
    row.icon.tex:SetTexture(it.icon or 134400)
    row.icon:SetBackdropBorderColor(qualityColor(it.quality))
    local r, g, b = qualityColor(it.quality)
    row.name:SetText(it.name or ("item:" .. it.id))
    row.name:SetTextColor(r, g, b) -- the game's item quality colour: not a theme colour
    row.slot:SetText(it.slot or "")
    row.rank.refresh()
end

-- Works out the rows for the pick (and why there are none): once per pick, and when the Journal's data arrives.
local function buildRows()
    local boss, classOnly = picked()
    local bosses = {}
    if boss == "all" then
        for _, def in ipairs(CRT.Bosses and CRT.Bosses:RouteList(seasonKey()) or {}) do
            bosses[#bosses + 1] = def
        end
    else
        local def = CRT.Bosses and CRT.Bosses:Get(boss)
        bosses[1] = def or { encounterID = boss, name = tostring(boss) }
    end
    local out, why = {}, nil
    for _, def in ipairs(bosses) do
        local items, reason = W.BossLoot(def.encounterID, classOnly)
        if items and #items > 0 then
            if boss == "all" then
                out[#out + 1] = { header = def.name }
            end
            for _, it in ipairs(items) do
                out[#out + 1] = { item = it }
            end
        elseif reason == "loading" or (reason and not why) then
            why = reason
        end
    end
    rows = out
    empty:SetText(why == "loading" and TEXT.loading or why == "missing" and TEXT.missing
        or why == "journal" and TEXT.noJournal or TEXT.none)
    empty:SetShown(#out == 0)
end

-- Draws the rows again (a tick, a rank, or a list sent), and the status line.
local function redraw()
    if not (win and win:IsShown()) then
        return
    end
    local n = W.Count()
    status:SetText(n == 1 and TEXT.countOne:format(W.StatusText()) or TEXT.countMany:format(n, W.StatusText()))
    bossRow.refresh()
    classCheck:SetChecked(select(2, picked()))
    list:SetDataProvider(CreateDataProvider(rows), ScrollBoxConstants and ScrollBoxConstants.RetainScrollPosition)
end

local function rebuild()
    if not (win and win:IsShown()) then
        return
    end
    buildRows()
    redraw()
end

-- The window -------------------------------------------------------------------------------------------

local function build()
    if win then
        return
    end
    win = UI.Window("CowfeeRaidToolsWishlist", {
        kind = "popout", title = TEXT.title, width = L.width, height = L.height,
        minWidth = L.minWidth, minHeight = L.minHeight, saved = saved,
    })
    win.strip:SetHelp(TEXT.title, TEXT.help)
    local c = win.content
    bossRow = UI.Dropdown(c, TEXT.boss, {
        labelWidth = L.labelW, width = L.bossW, maxHeight = 400,
        options = bossOptions,
        get = function()
            return (picked())
        end,
        set = function(key)
            saved().boss = key
            rebuild()
        end,
    })
    bossRow:SetPoint("TOPLEFT", 4, L.top)
    classCheck = CreateFrame("CheckButton", nil, c, "UICheckButtonTemplate")
    classCheck:SetSize(24, 24)
    classCheck:SetPoint("LEFT", bossRow, "RIGHT", L.checkGap, 0)
    UI:SkinCheckButton(classCheck)
    classCheck.label = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    classCheck.label:SetPoint("LEFT", classCheck, "RIGHT", 2, 0)
    classCheck.label:SetText(TEXT.classOnly)
    classCheck:SetScript("OnClick", function(self)
        saved().classOnly = self:GetChecked() and true or false
        rebuild()
    end)
    local box = CreateFrame("Frame", nil, c, "WowScrollBoxList")
    box:SetPoint("TOPLEFT", 0, L.listTop)
    box:SetPoint("BOTTOMRIGHT", -LM.LIST_SCROLL_GAP, L.statusH)
    local bar = CreateFrame("EventFrame", nil, c, "MinimalScrollBar")
    UI:SkinScrollBar(bar)
    bar:SetPoint("TOPLEFT", box, "TOPRIGHT", 6, 0)
    bar:SetPoint("BOTTOMLEFT", box, "BOTTOMRIGHT", 6, 0)
    local v = CreateScrollBoxListLinearView()
    v:SetElementExtent(L.rowH)
    v:SetElementInitializer("Frame", initRow)
    ScrollUtil.InitScrollBoxListWithScrollBar(box, bar, v)
    list = box
    empty = c:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    empty:SetPoint("TOP", box, "TOP", 0, -40)
    UI.Tint(empty, "SetTextColor", "muted")
    status = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    status:SetPoint("BOTTOMLEFT", 4, 4)
    status:SetJustifyH("LEFT")
    UI.Tint(status, "SetTextColor", "text")
    win:HookScript("OnShow", rebuild)
end

LM:OnChange(function(what, how)
    if what ~= "wishlist" then
        return
    end
    if how == "loot" then
        rebuild() -- the Journal's data, or an item's name and icon, arrived
    else
        redraw()
    end
end)
-- a new theme repaints the rows
UI:OnTheme(redraw)

function LM:ShowWishlist()
    build()
    if win:IsShown() then
        rebuild()
    else
        win:Show() -- its OnShow works out the rows
    end
end

-- For tests: the window's parts and rows.
function LM.WishlistWindowParts()
    return { win = win, list = list, boss = bossRow, classCheck = classCheck, status = status, empty = empty, rows = rows }
end
