local ADDON, CRT = ...

-- The raider window: what everyone answered and rolled for each item, read only. It is the session you
-- were sent (LM.incoming) and its copy of everyone's answers (inc.view), in the same order the looter
-- sees (the answer's weight, then the roll; Raider Score is never shown to raiders). Nothing here
-- changes anything: no menus, no awards. Open it from the popup's title bar or /crt loot answers; it
-- stays until the session ends. A pop-out made by UI.Window; its place is kept in CRTDB
-- lootmaster.answers.

local LM = CRT.LootMaster
local UI = CRT.UI

local L = {
    width = 820, height = 380, minWidth = 640, minHeight = 260,
    left = LM.TAB_COLUMN + 14, headerH = 50, rowH = 22,
}

local COLS = {
    { key = "name", x = 4, w = 140, title = "Name" },
    { key = "role", x = 148, w = 46, title = "Role" },
    { key = "response", x = 198, w = 180, title = "Answer" },
    { key = "roll", x = 382, w = 50, title = "Roll" },
    { key = "ilvl", x = 436, w = 50, title = "iLvl" },
    { key = "gear", x = 490, w = 100, title = "Gear" },
}

local TEXT = {
    title = "Loot",
    test = "TEST",
    note = "all loot rolls, read only",
    help = "What everyone answered for each item and the roll the looter's CRT drew for them, in the order the looter sees. Only the looter gives items out; this window changes nothing.",
    choosing = "Choosing...",
    loading = "Loading...",
    timeout = "No answer",
    nocrt = "No CRT",
    auto = "auto",
    itemLevel = "Item level %d",
    given = "Given to %s",
}

local ROLE_TEXT = { T = "Tank", H = "Heal", D = "DPS", N = "" }

local win, list, header, tabs
local ticker -- refreshes the window while it is shown
local refresh
local REFRESH_SECONDS = 1
local current = 1

local function settings()
    return CRT.db.lootmaster.answers
end

local function classColor(file)
    return file and (C_ClassColor and C_ClassColor.GetClassColor(file) or RAID_CLASS_COLORS[file]) or nil
end

local function answerText(r, view)
    if r.state == "nocrt" then
        return "|cffff8a40" .. TEXT.nocrt .. "|r"
    elseif r.state == "timeout" then
        return "|cff9c8a78" .. TEXT.timeout .. "|r"
    elseif r.state == "loading" then
        return "|cff9c8a78" .. TEXT.loading .. "|r"
    elseif r.response then
        local resp = view:Response(r.response)
        local c = resp and resp.color or { 1, 1, 1 }
        return string.format("|cff%02x%02x%02x%s|r", c[1] * 255, c[2] * 255, c[3] * 255, resp and resp.label or r.response)
            .. (r.auto and ("  |cff9c8a78" .. TEXT.auto .. "|r") or "")
    end
    return "|cff9c8a78" .. TEXT.choosing .. "|r"
end

local function initRow(row, r)
    if not row.cols then
        row.cols = {}
        for _, c in ipairs(COLS) do
            if c.key ~= "gear" then
                local fs = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
                fs:SetPoint("LEFT", c.x, 0)
                fs:SetWidth(c.w)
                fs:SetJustifyH("LEFT")
                fs:SetWordWrap(false)
                row.cols[c.key] = fs
            end
        end
        row.gear = {}
        for i = 1, 2 do
            local t = row:CreateTexture(nil, "OVERLAY")
            t:SetSize(16, 16)
            t:SetPoint("LEFT", COLS[6].x + (i - 1) * 20, 0)
            row.gear[i] = t
        end
        row.diff = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        row.diff:SetPoint("LEFT", COLS[6].x + 44, 0)
        row.me = row:CreateTexture(nil, "BACKGROUND")
        row.me:SetAllPoints()
        row.me:SetColorTexture(0.78, 0.56, 0.36, 0.16)
    end
    local inc = LM.incoming
    local cc = classColor(r.class)
    row.cols.name:SetText(Ambiguate(r.name, "short"))
    row.cols.name:SetTextColor(cc and cc.r or 0.85, cc and cc.g or 0.85, cc and cc.b or 0.85)
    row.cols.role:SetText(ROLE_TEXT[r.role or "N"] or "")
    row.cols.response:SetText(inc and answerText(r, inc.view) or "")
    row.cols.roll:SetText(r.roll and tostring(r.roll) or "")
    row.cols.ilvl:SetText(r.ilvl and string.format("%.0f", r.ilvl) or "")
    for i, t in ipairs(row.gear) do
        local g = r.gear[i]
        local icon = g and g.id and C_Item.GetItemIconByID(g.id)
        t:SetTexture(icon)
        t:SetShown(icon ~= nil)
    end
    if r.diff then
        row.diff:SetText(r.diff > 0 and ("|cff1eff00+" .. r.diff .. "|r") or (r.diff < 0 and ("|cffff4040" .. r.diff .. "|r") or "0"))
    else
        row.diff:SetText("")
    end
    row.me:SetShown(r.name == LM:Me())
end

local function build()
    if win then
        return
    end
    win = UI.Window("CowfeeRaidToolsLootAnswers", {
        kind = "popout", title = TEXT.title, width = L.width, height = L.height,
        minWidth = L.minWidth, minHeight = L.minHeight, saved = settings,
    })
    local c = win.content
    tabs = LM.ItemTabs(c, {
        onSelect = function(index)
            current = index
            LM:Fire("incoming")
        end,
    })
    local divider = c:CreateTexture(nil, "ARTWORK")
    divider:SetColorTexture(0.35, 0.35, 0.35, 0.8)
    divider:SetWidth(1)
    divider:SetPoint("TOPLEFT", LM.TAB_COLUMN + 6, 0)
    divider:SetPoint("BOTTOMLEFT", LM.TAB_COLUMN + 6, 0)
    header = CreateFrame("Frame", nil, c)
    header:SetPoint("TOPLEFT", L.left, 0)
    header:SetPoint("TOPRIGHT", 0, 0)
    header:SetHeight(L.headerH)
    header.icon = header:CreateTexture(nil, "ARTWORK")
    header.icon:SetSize(40, 40)
    header.icon:SetPoint("TOPLEFT", 0, -2)
    header.name = header:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    header.name:SetPoint("TOPLEFT", header.icon, "TOPRIGHT", 8, 0)
    header.info = header:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    header.info:SetPoint("TOPLEFT", header.name, "BOTTOMLEFT", 0, -4)
    header.info:SetTextColor(0.7, 0.7, 0.7)
    UI.Help(header, TEXT.title, TEXT.help):SetPoint("LEFT", header.name, "RIGHT", 4, 0)
    for _, col in ipairs(COLS) do
        local h = c:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
        h:SetPoint("TOPLEFT", L.left + col.x, -L.headerH - 4)
        h:SetText(col.title)
    end
    local box = CreateFrame("Frame", nil, c, "WowScrollBoxList")
    box:SetPoint("TOPLEFT", L.left, -L.headerH - 24)
    box:SetPoint("BOTTOMRIGHT", -20, 0)
    local bar = CreateFrame("EventFrame", nil, c, "MinimalScrollBar")
    bar:SetPoint("TOPLEFT", box, "TOPRIGHT", 6, 0)
    bar:SetPoint("BOTTOMLEFT", box, "BOTTOMRIGHT", 6, 0)
    local v = CreateScrollBoxListLinearView()
    v:SetElementExtent(L.rowH)
    v:SetElementInitializer("Frame", initRow)
    ScrollUtil.InitScrollBoxListWithScrollBar(box, bar, v)
    list = box
    -- while it is shown, once a second, so an item whose time ran out turns orange without a message
    win:HookScript("OnShow", function()
        if not ticker then
            ticker = C_Timer.NewTicker(REFRESH_SECONDS, function()
                refresh()
            end)
        end
    end)
    win:HookScript("OnHide", function()
        if ticker then
            ticker:Cancel()
            ticker = nil
        end
    end)
end

refresh = function() -- declared above, for the ticker
    local inc = LM.incoming
    if not (win and win:IsShown() and inc and inc.view) then
        return
    end
    local view = inc.view
    if not inc.items[current] then
        current = 1
    end
    win.strip:SetTitle(TEXT.title)
    -- TEST for a test, else the boss you saw killed just before (LM:RecentBoss); the note shows either way
    win.strip:SetBadge(inc.test and TEXT.test or inc.boss, TEXT.note, not inc.test and UI.TITLE_STRIP.neutral or nil)
    tabs:Update(inc.items, current, function(i)
        return view:AnswerCount(i)
    end, function(name)
        return view.players[name] and view.players[name].class
    end)
    local it = inc.items[current]
    if not it then
        list:SetDataProvider(CreateDataProvider({}))
        return
    end
    header.icon:SetTexture(C_Item.GetItemIconByID(it.itemString or "") or 134400)
    local _, link = C_Item.GetItemInfo(it.itemString or "")
    header.name:SetText(link or it.itemString)
    if it.award then
        header.info:SetText(string.format(TEXT.given, Ambiguate(it.award.name, "short")))
    else
        header.info:SetText(it.ilvl and string.format(TEXT.itemLevel, it.ilvl) or "")
    end
    list:SetDataProvider(CreateDataProvider(view:Rows(current)), ScrollBoxConstants and ScrollBoxConstants.RetainScrollPosition)
end

LM:OnChange(function(what, how)
    if what ~= "incoming" or not win then
        return
    end
    if how == "ended" then
        win:Hide()
        return
    end
    refresh()
end)

function LM:ShowAnswers()
    if not (self.incoming and self.incoming.view) then
        CRT:Print("Loot Master: no loot session to show.")
        return
    end
    build()
    win:Show()
    refresh()
end
