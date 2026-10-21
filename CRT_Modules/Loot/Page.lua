local ADDON, CRT = ...

-- The Loot History page, with three tabs:
--   History   every recorded item, newest first, in a ScrollBox (only the visible rows exist, and a new
--             item is inserted, not the list rebuilt), with dropdown filters, a search box and a CSV
--             export of what the filters show. With RCLootCouncil, its awards that match a record fill in
--             the response, votes, note and gear columns, and the awards that match nothing are rows of
--             their own (Source: RCLootCouncil), read from Loot/RCLC.lua and never saved here
--   Summary   per player, the items and tier tokens in the same filtered view
--   Settings  what is recorded, how long it is kept, RCLootCouncil, and deleting
-- Right-click a recorded row to delete it. The data is in Loot/Store.lua.
-- A list entry is { rec, month } for a record or { award, month } for an RCLootCouncil award on its own;
-- fieldsOf(entry) reads either into the same fields, so the list, filters, summary and export share one
-- reader.

local Loot = CRT.Loot
local R = Loot.R
local UI = CRT.UI

local ROW_H = 20
local ALL = ""
local TOKEN_CLASS, TOKEN_SUBCLASS = 15, 0 -- Miscellaneous, Junk: how the game files tier tokens
local GEAR_ICON = 16 -- the Had column's item icons
local NOT_ROLLED = "~none~" -- the Response filter's key for items with no roll or response
local MAX_CANDIDATES = 25 -- lines of RCLootCouncil's candidate list in a row's tooltip

local TEXT = {
    title = "Loot History",
    help = "Every epic or better boss item someone in your group gets in a raid, recorded on your own computer: who got it, from which boss, on which difficulty, and how they rolled. With RCLootCouncil installed, its awards are read in too; hover a row for every candidate's response. Right-click an item to delete it.",
    filtersHelp = "Each dropdown narrows the list; All shows everything. Response lists what the Roll / response column shows. Source picks items CRT recorded or RCLootCouncil's awards. Search matches item, player and boss names. Export gives the list as CSV.",
    summaryHelp = "For the filters on the History tab: how many items each player got, and how many of them were tier tokens (in gold).",
    rcHelp = "With RCLootCouncil installed, CRT reads its saved awards: the response, votes, the winner's note and roll, and every candidate's response. An award that matches a recorded item fills it in; the others are listed on their own. CRT never changes that data. Re-scan reads it again now.",
    search = "Search",
    export = "Export CSV",
    count = "%d items",
    all = "All",
    notRolled = "Not rolled",
    sourceCRT = "Recorded by CRT",
    sourceRC = "RCLootCouncil only",
    rcRow = "From RCLootCouncil (not recorded by CRT)",
    deleteOne = "Delete this item from the history?",
    deleteBefore = "Delete every item from before %s?",
    deleteAll = "Delete the whole loot history? This can't be undone.",
    delete = "Delete",
}

local page, list, summary
local tabButtons, tabFrames = {}, {}
local currentTab = "history"
local filters = { player = ALL, boss = ALL, diff = ALL, month = ALL, roll = ALL, source = ALL, text = "" }
local controls = {}

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

local function confirm(text, onYes)
    UI.LiftOver(UI.ShownPopup(StaticPopup_ShowCustomGenericConfirmation({
        text = text, acceptText = TEXT.delete, cancelText = CANCEL, showAlert = true, callback = onYes,
    }), "GENERIC_CONFIRMATION"))
end

-- Reading an entry ---------------------------------------------------------------------------

local itemCache = {} -- itemID -> { name, link } once the game has it
local requested = {}
local refreshVisible -- set once the list exists

local function item(itemString)
    local id = Loot.ItemID(itemString)
    if not id then
        return nil
    end
    local cached = itemCache[id]
    if cached then
        return cached
    end
    local name, link = C_Item.GetItemInfo(itemString)
    if name then
        cached = { name = name, link = link }
        itemCache[id] = cached
        return cached
    end
    if not requested[id] then
        requested[id] = true
        local obj = Item:CreateFromItemID(id)
        obj:ContinueOnItemLoad(function()
            if refreshVisible then
                refreshVisible()
            end
        end)
    end
    return nil
end

local function fileColor(classFile)
    return classFile and (C_ClassColor and C_ClassColor.GetClassColor(classFile) or RAID_CLASS_COLORS[classFile]) or nil
end

local function classFileOf(classID)
    local _, file = GetClassInfo(classID or 0)
    return file
end

local function difficultyName(id)
    local name = id and id > 0 and GetDifficultyInfo(id)
    return name or "?"
end

-- The name inside an item link, for awards whose item the game hasn't loaded.
local function itemName(link)
    return type(link) == "string" and link:match("|h%[(.-)%]|h") or ""
end

-- The same fields for a record or an award. A record's are read each time (its winner and roll can
-- change); an award's are kept on the entry, since it only changes with a new scan, which rebuilds.
local function fieldsOf(e)
    if e.rec then
        local rec = e.rec
        local rc = Loot.rc[rec]
        local roll = rec[R.ROLL]
        return {
            time = rec[R.TIME], player = Loot:Name("players", rec[R.PLAYER]) or "?", classFile = classFileOf(rec[R.CLASS]),
            itemString = rec[R.ITEM], boss = Loot:Boss(rec[R.ENC]) or "", bossKey = tostring(rec[R.ENC]),
            instance = Loot:Name("instances", rec[R.INST]) or "", diff = rec[R.DIFF], roll = roll,
            rollKey = (rc and rc.response) or (roll and Loot.ROLLS[roll]) or NOT_ROLLED, rc = rc, source = "crt",
        }
    end
    if not e.f then
        local a = e.award
        local id = Loot:BossID(a.boss)
        e.f = {
            time = a.time, player = a.winner, classFile = a.class, itemString = a.itemString, link = a.link,
            boss = a.boss or "", bossKey = id and tostring(id) or ("rc:" .. (a.boss or "")), instance = a.instance or "",
            diff = a.difficultyID, rollKey = a.response or NOT_ROLLED, rc = a, source = "rc",
        }
    end
    return e.f
end

local function responseText(f)
    if f.rc and f.rc.response then
        return f.rc.response, f.rc.color
    end
    return Loot.ROLLS[f.roll or -1] or "", nil
end

local searchCache = setmetatable({}, { __mode = "k" }) -- by record or award
local function searchText(e, f)
    local key = e.rec or e.award
    local s = searchCache[key]
    local it = item(f.itemString)
    if not s or (it and not s.named) then
        local text = ((it and it.name or itemName(f.link)) .. "\n" .. f.player .. "\n" .. f.boss):lower()
        s = { text = text, named = it ~= nil }
        searchCache[key] = s
    end
    return s.text
end

local function passes(e)
    local f = fieldsOf(e)
    if filters.source ~= ALL and f.source ~= filters.source then
        return false
    elseif filters.player ~= ALL and f.player ~= filters.player then
        return false
    elseif filters.boss ~= ALL and f.bossKey ~= filters.boss then
        return false
    elseif filters.diff ~= ALL and tostring(f.diff) ~= filters.diff then
        return false
    elseif filters.month ~= ALL and e.month ~= filters.month then
        return false
    elseif filters.roll ~= ALL and f.rollKey ~= filters.roll then
        return false
    end
    if filters.text ~= "" and not searchText(e, f):find(filters.text, 1, true) then
        return false
    end
    return true
end

-- An award's entry is made once and kept (with its fields) until a scan replaces the award.
local awardEntries = setmetatable({}, { __mode = "k" })

-- Every entry, newest first: the records, then RCLootCouncil's awards on their own merged in by time.
local function allEntries()
    local out = {}
    Loot:Each(function(rec, month)
        out[#out + 1] = { rec = rec, month = month }
    end)
    local awards = CRT.LootRCLC and CRT.LootRCLC.unmatched or {}
    if #awards > 0 then
        for _, a in ipairs(awards) do
            local e = awardEntries[a]
            if not e then
                e = { award = a, month = a.time and Loot.MonthOf(a.time) or "" }
                awardEntries[a] = e
            end
            out[#out + 1] = e
        end
        table.sort(out, function(x, y)
            local tx = x.rec and x.rec[R.TIME] or x.award.time or 0
            local ty = y.rec and y.rec[R.TIME] or y.award.time or 0
            return tx > ty
        end)
    end
    return out
end

-- The filtered view.
local function view()
    local out = {}
    for _, e in ipairs(allEntries()) do
        if passes(e) then
            out[#out + 1] = e
        end
    end
    return out
end

-- Filter choices, from what is listed.
local function choices(kind)
    local out, seen = { { key = ALL, label = TEXT.all } }, {}
    local function add(key, label)
        if key ~= nil and not seen[key] then
            seen[key] = true
            out[#out + 1] = { key = key, label = label }
        end
    end
    if kind == "source" then
        add("crt", TEXT.sourceCRT)
        add("rc", TEXT.sourceRC)
        return out
    end
    local found = {}
    local entries = allEntries()
    for _, e in ipairs(entries) do
        local f = fieldsOf(e)
        if kind == "player" then
            found[#found + 1] = { f.player, Ambiguate(f.player, "short") }
        elseif kind == "boss" then
            found[#found + 1] = { f.bossKey, f.boss ~= "" and f.boss or ("Boss " .. f.bossKey) }
        elseif kind == "diff" then
            found[#found + 1] = { tostring(f.diff), difficultyName(f.diff) }
        elseif kind == "roll" then
            found[#found + 1] = { f.rollKey, f.rollKey == NOT_ROLLED and TEXT.notRolled or f.rollKey }
        elseif kind == "month" and e.month ~= "" then
            found[#found + 1] = { e.month, e.month }
        end
    end
    if kind == "month" then
        table.sort(found, function(a, b)
            return a[1] > b[1]
        end)
    else
        table.sort(found, function(a, b)
            return a[2] < b[2]
        end)
    end
    for _, f in ipairs(found) do
        add(f[1], f[2])
    end
    return out
end

-- History: the list ------------------------------------------------------------------------------

-- Columns: x and width inside a row. "gear" holds icons, the others text. Sized from the game at its
-- default font (about 7.5 units a character in a row, 9 in a heading); the date column shows the day
-- only, and the tooltip has the time.
local COLS = {
    { key = "date", x = 4, w = 80, title = "Date" },
    { key = "player", x = 88, w = 108, title = "Player" },
    { key = "item", x = 200, w = 220, title = "Item" },
    { key = "boss", x = 424, w = 150, title = "Boss" },
    { key = "diff", x = 578, w = 62, title = "Difficulty" },
    { key = "roll", x = 644, w = 150, title = "Roll / response" },
    { key = "votes", x = 798, w = 44, title = "Votes" },
    { key = "note", x = 848, w = 80, title = "Note" },
    { key = "gear", x = 932, w = 40, title = "Had" },
}

local function addCandidates(rc)
    local list = rc.candidates or {}
    if #list == 0 then
        return
    end
    GameTooltip:AddLine(" ")
    GameTooltip:AddLine(string.format("Everyone who answered (%d)", #list), 1, 0.82, 0)
    for i, c in ipairs(list) do
        if i > MAX_CANDIDATES then
            GameTooltip:AddLine(string.format("... and %d more", #list - MAX_CANDIDATES), 0.7, 0.7, 0.7)
            break
        end
        local cc = fileColor(c.class)
        local rgb = c.color or { 0.85, 0.85, 0.85 }
        local right = (c.roll and ("roll " .. c.roll) or "") .. (c.ilvl and string.format("  ilvl %.0f", c.ilvl) or "")
        GameTooltip:AddDoubleLine(
            (cc and cc:WrapTextInColorCode(Ambiguate(c.name, "short")) or Ambiguate(c.name, "short")) .. "  " .. c.response,
            right, rgb[1], rgb[2], rgb[3], 0.85, 0.85, 0.85)
    end
end

local function showTooltip(row)
    local e = row.entry
    if not e then
        return
    end
    local f = fieldsOf(e)
    GameTooltip:SetOwner(row, "ANCHOR_CURSOR")
    pcall(GameTooltip.SetHyperlink, GameTooltip, f.link or f.itemString)
    GameTooltip:AddLine(" ")
    GameTooltip:AddDoubleLine("When", f.time and date("%Y-%m-%d %H:%M", f.time) or "?", 1, 1, 1, 1, 1, 1)
    if f.boss ~= "" then
        GameTooltip:AddDoubleLine("Boss", f.boss .. " (" .. difficultyName(f.diff) .. ")", 1, 1, 1, 1, 1, 1)
    end
    local rc = f.rc
    if rc then
        GameTooltip:AddLine(" ")
        if f.source == "rc" then
            GameTooltip:AddLine(TEXT.rcRow, 0.7, 0.7, 0.7)
        end
        local rgb = rc.color or { 1, 0.82, 0 }
        GameTooltip:AddDoubleLine("RCLootCouncil", rc.response or "?", 1, 0.82, 0, rgb[1], rgb[2], rgb[3])
        if rc.votes then
            GameTooltip:AddDoubleLine("Votes", tostring(rc.votes), 1, 1, 1, 1, 1, 1)
        end
        if rc.roll then
            GameTooltip:AddDoubleLine("Roll", tostring(rc.roll), 1, 1, 1, 1, 1, 1)
        end
        if rc.ilvl then
            GameTooltip:AddDoubleLine("Their item level", string.format("%.1f", rc.ilvl), 1, 1, 1, 1, 1, 1)
        end
        for i, link in ipairs(rc.replaced or {}) do
            GameTooltip:AddDoubleLine(i == 1 and "Had" or " ", link, 1, 1, 1)
        end
        if rc.owner then
            GameTooltip:AddDoubleLine("Looted by", Ambiguate(rc.owner, "short"), 1, 1, 1, 1, 1, 1)
        end
        if rc.instance then
            GameTooltip:AddDoubleLine("Instance", rc.instance, 1, 1, 1, 1, 1, 1)
        end
        if rc.note and rc.note ~= "" then
            GameTooltip:AddLine("Note: " .. rc.note, 1, 1, 1, true)
        end
        addCandidates(rc)
    end
    GameTooltip:Show()
end

local function initRow(row, entry)
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
            t:SetSize(GEAR_ICON, GEAR_ICON)
            t:SetPoint("LEFT", COLS[#COLS].x + (i - 1) * (GEAR_ICON + 4), 0)
            row.gear[i] = t
        end
        local hl = row:CreateTexture(nil, "HIGHLIGHT")
        hl:SetAllPoints()
        hl:SetColorTexture(1, 1, 1, 0.08)
        row:RegisterForClicks("RightButtonUp")
        row:SetScript("OnEnter", showTooltip)
        row:SetScript("OnLeave", function()
            GameTooltip:Hide()
        end)
        row:SetScript("OnClick", function(self)
            local e = self.entry
            if e and e.rec then -- an RCLootCouncil award is its data, not ours to delete
                confirm(TEXT.deleteOne, function()
                    Loot:Delete(e.rec, e.month)
                end)
            end
        end)
    end
    row.entry = entry
    local f = fieldsOf(entry)
    local cols = row.cols
    cols.date:SetText(f.time and date("%Y-%m-%d", f.time) or "?")
    local cc = fileColor(f.classFile)
    cols.player:SetText(Ambiguate(f.player, "short"))
    cols.player:SetTextColor(cc and cc.r or 1, cc and cc.g or 1, cc and cc.b or 1)
    local it = f.link and { link = f.link } or item(f.itemString)
    cols.item:SetText(it and it.link or ("item " .. tostring(Loot.ItemID(f.itemString))))
    cols.boss:SetText(f.boss)
    cols.diff:SetText(difficultyName(f.diff))
    local text, color = responseText(f)
    cols.roll:SetText(text)
    cols.roll:SetTextColor(color and color[1] or 0.85, color and color[2] or 0.85, color and color[3] or 0.85)
    local rc = f.rc
    cols.votes:SetText(rc and rc.votes and tostring(rc.votes) or "")
    cols.note:SetText(rc and rc.note or "")
    for i, t in ipairs(row.gear) do
        local link = rc and rc.replaced and rc.replaced[i]
        local icon = link and C_Item.GetItemIconByID(link)
        t:SetTexture(icon)
        t:SetShown(icon ~= nil)
    end
end

local countText

local function rebuild()
    if not list then
        return
    end
    local entries = view()
    list.provider = CreateDataProvider(entries)
    list.box:SetDataProvider(list.provider, ScrollBoxConstants and ScrollBoxConstants.RetainScrollPosition)
    countText:SetText(string.format(TEXT.count, #entries))
    if summary then
        summary.refresh(entries)
    end
end

refreshVisible = function()
    if list and list.box:IsVisible() then
        list.box:ForEachFrame(function(frame, entry)
            initRow(frame, entry)
        end)
    end
end

local function csvField(v)
    v = tostring(v or "")
    if v:find('[",\n]') then
        v = '"' .. v:gsub('"', '""') .. '"'
    end
    return v
end

local function exportCSV()
    local lines = { "date,time,player,class,item id,item name,boss,instance,difficulty,roll type,source,rc response,rc votes,rc roll,rc item level,rc note,had 1,had 2,candidates" }
    for _, e in ipairs(view()) do
        local f = fieldsOf(e)
        local it = item(f.itemString)
        local rc = f.rc or {}
        local replaced = rc.replaced or {}
        local fields = {
            f.time and date("%Y-%m-%d", f.time) or "", f.time and date("%H:%M:%S", f.time) or "", f.player, f.classFile or "",
            Loot.ItemID(f.itemString) or "", it and it.name or itemName(f.link), f.boss, f.instance, difficultyName(f.diff),
            f.roll and Loot.ROLLS[f.roll] or "", f.source == "rc" and "RCLootCouncil" or "CRT", rc.response or "",
            rc.votes or "", rc.roll or "", rc.ilvl or "", rc.note or "", itemName(replaced[1]), itemName(replaced[2]),
            #(rc.candidates or {}) > 0 and #rc.candidates or "",
        }
        for i, v in ipairs(fields) do
            fields[i] = csvField(v)
        end
        lines[#lines + 1] = table.concat(fields, ",")
    end
    CRT.ConsumablesTools:ShowText("Loot History as CSV (Ctrl+C to copy)", table.concat(lines, "\n"))
end

local function filterDropdown(f, label, labelW, width, key)
    local row = UI.Dropdown(f, label, {
        labelWidth = labelW, width = width, maxHeight = 300,
        options = function()
            return choices(key)
        end,
        get = function()
            return filters[key]
        end,
        set = function(v)
            filters[key] = v
            rebuild()
        end,
    })
    controls[#controls + 1] = row
    return row
end

local function buildHistory(f)
    local x = 8
    for _, spec in ipairs({ { "Player", 44, 140, "player" }, { "Boss", 34, 150, "boss" }, { "Difficulty", 62, 110, "diff" },
        { "Month", 42, 100, "month" }, { "Response", 62, 150, "roll" } }) do
        local row = filterDropdown(f, spec[1], spec[2], spec[3], spec[4])
        row:SetPoint("TOPLEFT", x, -4)
        x = x + spec[2] + 5 + spec[3] + 12
    end

    local source = filterDropdown(f, "Source", 44, 150, "source")
    source:SetPoint("TOPLEFT", 8, -38)
    local searchLabel = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    searchLabel:SetPoint("LEFT", source, "RIGHT", 16, 0)
    searchLabel:SetText(TEXT.search)
    local search = CreateFrame("EditBox", nil, f, "InputBoxTemplate")
    search:SetAutoFocus(false)
    search:SetFontObject(CRTFontHighlight)
    search:SetSize(200, 22)
    search:SetPoint("LEFT", searchLabel, "RIGHT", 10, 0)
    search:SetScript("OnTextChanged", function(self, user)
        if user then
            filters.text = strtrim(self:GetText()):lower()
            rebuild()
        end
    end)
    search:SetScript("OnEscapePressed", function(self)
        self:ClearFocus()
    end)
    local export = makeButton(f, TEXT.export, 110)
    export:SetPoint("LEFT", search, "RIGHT", 12, 0)
    export:SetScript("OnClick", exportCSV)
    UI.Help(f, "Filters and export", TEXT.filtersHelp):SetPoint("LEFT", export, "RIGHT", 6, 0)
    countText = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    countText:SetPoint("LEFT", export, "RIGHT", 40, 0)

    -- Column headings, then the list.
    for _, c in ipairs(COLS) do
        local h = f:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
        h:SetPoint("TOPLEFT", 8 + c.x, -74)
        h:SetText(c.title)
    end
    local box = CreateFrame("Frame", nil, f, "WowScrollBoxList")
    box:SetPoint("TOPLEFT", 8, -92)
    box:SetPoint("BOTTOMRIGHT", -28, 8)
    local back = CreateFrame("Frame", nil, f, "BackdropTemplate")
    back:SetPoint("TOPLEFT", box, -2, 2)
    back:SetPoint("BOTTOMRIGHT", box, 2, -2)
    back:SetFrameLevel(math.max(0, box:GetFrameLevel() - 1))
    skin(back, 0.35)
    local bar = CreateFrame("EventFrame", nil, f, "MinimalScrollBar")
    UI:SkinScrollBar(bar)
    bar:SetPoint("TOPLEFT", box, "TOPRIGHT", 8, 0)
    bar:SetPoint("BOTTOMLEFT", box, "BOTTOMRIGHT", 8, 0)
    local v = CreateScrollBoxListLinearView()
    v:SetElementExtent(ROW_H)
    v:SetElementInitializer("Button", initRow)
    ScrollUtil.InitScrollBoxListWithScrollBar(box, bar, v)
    list = { box = box }
end

-- Summary ------------------------------------------------------------------------------------

local function isToken(itemString)
    local id = Loot.ItemID(itemString)
    if not id then
        return false
    end
    local _, _, _, _, _, classID, subclassID = C_Item.GetItemInfoInstant(id)
    return classID == TOKEN_CLASS and subclassID == TOKEN_SUBCLASS
end

local function buildSummary(f)
    local heading = f:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    heading:SetPoint("TOPLEFT", 8, -8)
    heading:SetText("Items per player")
    UI.Help(f, "Summary", TEXT.summaryHelp):SetPoint("LEFT", heading, "RIGHT", 6, 0)
    local box = CreateFrame("Frame", nil, f, "WowScrollBoxList")
    box:SetPoint("TOPLEFT", 8, -32)
    box:SetSize(420, 1)
    box:SetPoint("BOTTOM", 0, 8)
    local bar = CreateFrame("EventFrame", nil, f, "MinimalScrollBar")
    UI:SkinScrollBar(bar)
    bar:SetPoint("TOPLEFT", box, "TOPRIGHT", 8, 0)
    bar:SetPoint("BOTTOMLEFT", box, "BOTTOMRIGHT", 8, 0)
    local v = CreateScrollBoxListLinearView()
    v:SetElementExtent(ROW_H)
    v:SetElementInitializer("Frame", function(row, e)
        if not row.name then
            row.name = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
            row.name:SetPoint("LEFT", 4, 0)
            row.name:SetWidth(220)
            row.name:SetJustifyH("LEFT")
            row.items = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
            row.items:SetPoint("LEFT", 230, 0)
            row.tokens = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
            row.tokens:SetPoint("LEFT", 310, 0)
        end
        row.name:SetText(Ambiguate(e.name, "short"))
        local c = fileColor(e.classFile)
        row.name:SetTextColor(c and c.r or 1, c and c.g or 1, c and c.b or 1)
        row.items:SetText(e.items .. " items")
        row.tokens:SetText(e.tokens > 0 and UI.HeadingText(e.tokens .. " tier") or "")
    end)
    ScrollUtil.InitScrollBoxListWithScrollBar(box, bar, v)
    summary = {
        refresh = function(entries)
            local by, order = {}, {}
            for _, e in ipairs(entries) do
                local fe = fieldsOf(e)
                local s = by[fe.player]
                if not s then
                    s = { name = fe.player, classFile = fe.classFile, items = 0, tokens = 0 }
                    by[fe.player] = s
                    order[#order + 1] = s
                end
                s.items = s.items + 1
                if isToken(fe.itemString) then
                    s.tokens = s.tokens + 1
                end
            end
            table.sort(order, function(a, b)
                if a.items ~= b.items then
                    return a.items > b.items
                end
                return a.name < b.name
            end)
            box:SetDataProvider(CreateDataProvider(order))
        end,
    }
end

-- Settings -----------------------------------------------------------------------------------

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
    c.refresh = function()
        c:SetChecked(get() and true or false)
    end
    controls[#controls + 1] = c
    return c
end

local function buildSettings(f)
    local s = function()
        return Loot:Settings()
    end
    local heading = f:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    heading:SetPoint("TOPLEFT", 8, -8)
    heading:SetText("Recording")
    UI.Help(f, "Recording", "Items from raid bosses, of the quality you pick or better; tick Dungeons to record dungeon bosses too. Each player's own computer records what it sees; nothing is shared."):SetPoint("LEFT", heading, "RIGHT", 6, 0)
    local quality = UI.Dropdown(f, "Minimum quality", {
        labelWidth = 110, width = 140,
        options = { { key = 3, label = "Rare" }, { key = 4, label = "Epic" }, { key = 5, label = "Legendary" } },
        get = function()
            return s().minQuality or 4
        end,
        set = function(v)
            s().minQuality = v
        end,
    })
    quality:SetPoint("TOPLEFT", 8, -28)
    controls[#controls + 1] = quality
    check(f, 6, -64, "Dungeons too", function()
        return s().dungeons
    end, function(on)
        s().dungeons = on
    end)

    local keep = UI.Slider(f, "Keep this many months", {
        min = 0, max = 36, labelWidth = 150, width = 200,
        format = function(v)
            return v == 0 and "Forever" or tostring(v)
        end,
        get = function()
            return s().keepMonths or 0
        end,
        set = function(v)
            s().keepMonths = v
        end,
    })
    keep:SetPoint("TOPLEFT", 8, -96)
    controls[#controls + 1] = keep
    UI.Help(f, "Keep", "Older months are removed when you log in. Forever keeps everything."):SetPoint("LEFT", keep, "RIGHT", 4, 0)

    local rcHeading = f:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    rcHeading:SetPoint("TOPLEFT", 8, -144)
    rcHeading:SetText("RCLootCouncil")
    UI.Help(f, "RCLootCouncil", TEXT.rcHelp):SetPoint("LEFT", rcHeading, "RIGHT", 6, 0)
    check(f, 6, -164, "Show RCLootCouncil's awards", function()
        return s().rcEnrich
    end, function(on)
        s().rcEnrich = on
        CRT.LootRCLC:Scan()
    end)
    local rescan = makeButton(f, "Re-scan", 90)
    rescan:SetPoint("TOPLEFT", 12, -194)
    local rcStatus = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    rcStatus:SetPoint("LEFT", rescan, "RIGHT", 10, 0)
    rescan:SetScript("OnClick", function()
        CRT.LootRCLC:Scan()
        rcStatus:SetText(CRT.LootRCLC:ReportText())
    end)
    controls[#controls + 1] = { refresh = function()
        rcStatus:SetText(CRT.LootRCLC.report and CRT.LootRCLC:ReportText() or "")
    end }

    local delHeading = f:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    delHeading:SetPoint("TOPLEFT", 8, -240)
    delHeading:SetText("Deleting")
    UI.Help(f, "Deleting", "Delete the months before the one you pick, or everything. Single items are deleted with a right-click on the History tab. RCLootCouncil's awards are its own data, so they are never deleted here."):SetPoint("LEFT", delHeading, "RIGHT", 6, 0)
    local before = ALL
    local monthDrop = UI.Dropdown(f, "Before", {
        labelWidth = 50, width = 120,
        options = function()
            local out = { { key = ALL, label = "Pick a month" } }
            for _, m in ipairs(Loot:Months()) do
                out[#out + 1] = { key = m, label = m }
            end
            return out
        end,
        get = function()
            return before
        end,
        set = function(v)
            before = v
        end,
    })
    monthDrop:SetPoint("TOPLEFT", 8, -260)
    controls[#controls + 1] = monthDrop
    local delBefore = makeButton(f, "Delete older", 110)
    delBefore:SetPoint("LEFT", monthDrop, "RIGHT", 8, 0)
    delBefore:SetScript("OnClick", function()
        if before ~= ALL then
            local m = before
            confirm(string.format(TEXT.deleteBefore, m), function()
                CRT:Print(string.format("Loot History: deleted %d items from before %s.", Loot:DeleteBefore(m), m))
            end)
        end
    end)
    local delAll = makeButton(f, "Delete all", 110)
    delAll:SetPoint("TOPLEFT", 12, -300)
    delAll:SetScript("OnClick", function()
        confirm(TEXT.deleteAll, function()
            Loot:DeleteAll()
            CRT:Print("Loot History: deleted everything.")
        end)
    end)
end

-- The page -----------------------------------------------------------------------------------

local TABS = {
    { key = "history", label = "History" },
    { key = "summary", label = "Summary" },
    { key = "settings", label = "Settings" },
}

local function selectTab(key)
    if not tabFrames[key] then
        key = "history"
    end
    currentTab = key
    for _, tab in ipairs(TABS) do
        local on = tab.key == key
        tabFrames[tab.key]:SetShown(on)
        UI:SetTabSelected(tabButtons[tab.key], on)
    end
end

local function refreshControls()
    for _, c in ipairs(controls) do
        c.refresh()
    end
end

local function build(pf)
    page = pf
    local title = pf:CreateFontString(nil, "OVERLAY", "CRTFontLarge")
    title:SetPoint("TOPLEFT", 8, -8)
    title:SetText(TEXT.title)
    UI.Help(pf, TEXT.title, TEXT.help):SetPoint("LEFT", title, "RIGHT", 6, 0)

    for i, tab in ipairs(TABS) do
        local b = CreateFrame("Button", nil, pf, "BackdropTemplate")
        b:SetSize(150, 26)
        b:SetPoint("TOPLEFT", 8 + (i - 1) * 154, -36)
        skin(b, 0.4)
        b.sel = b:CreateTexture(nil, "ARTWORK")
        b.sel:SetAllPoints()
        b.sel:SetColorTexture(UI.Color("heading", 0.18)) -- UI:RegisterTab styles it from here on
        b.text = b:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
        b.text:SetPoint("CENTER")
        b.text:SetText(tab.label)
        b:SetScript("OnClick", function()
            selectTab(tab.key)
        end)
        tabButtons[tab.key] = b
        UI:RegisterTab(b)
        local f = CreateFrame("Frame", nil, pf)
        f:SetPoint("TOPLEFT", 0, -66)
        f:SetPoint("BOTTOMRIGHT", 0, 0)
        f:Hide()
        tabFrames[tab.key] = f
    end
    local line = pf:CreateTexture(nil, "ARTWORK")
    line:SetColorTexture(0.35, 0.35, 0.35, 1)
    line:SetHeight(1)
    line:SetPoint("TOPLEFT", 8, -62)
    line:SetPoint("TOPRIGHT", -8, -62)

    buildHistory(tabFrames.history)
    buildSummary(tabFrames.summary)
    buildSettings(tabFrames.settings)

    pf:SetScript("OnShow", function()
        selectTab(currentTab)
        refreshControls()
        rebuild()
    end)
    selectTab(currentTab)
    rebuild()
end

-- New loot goes into the list without rebuilding it; anything else rebuilds it when the page is open.
Loot:OnChange(function(what, rec, month)
    if not (page and list) then
        return
    end
    if what == "added" then
        local e = { rec = rec, month = month }
        if passes(e) then
            list.provider:InsertAtIndex(e, 1)
            countText:SetText(string.format(TEXT.count, list.provider:GetSize()))
        end
    elseif what == "changed" then
        refreshVisible()
    elseif page:IsVisible() then
        rebuild()
    end
end)

UI:RegisterPage("loot", TEXT.title, build)
