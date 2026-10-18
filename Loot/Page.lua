local ADDON, CRT = ...

-- The Loot History page, with three tabs:
--   History   every recorded item, newest first, in a ScrollBox (only the visible rows exist, and a new
--             item is inserted, not the list rebuilt), with dropdown filters, a search box and a CSV
--             export of what the filters show
--   Summary   per player, the items and tier tokens in the same filtered view
--   Settings  what is recorded, how long it is kept, RCLootCouncil matching, and deleting
-- Right-click a row to delete it. The data is in Loot/Store.lua.

local Loot = CRT.Loot
local R = Loot.R
local UI = CRT.UI

local ROW_H = 20
local ALL = ""
local TOKEN_CLASS, TOKEN_SUBCLASS = 15, 0 -- Miscellaneous, Junk: how the game files tier tokens

local TEXT = {
    title = "Loot History",
    help = "Every boss item of epic quality or better that someone in your group gets in a raid, recorded on your own computer from what the game reports: who got it, from which boss, on which difficulty, and how they rolled when it was group loot.\n\nWith RCLootCouncil installed, its council responses, notes and votes are added to the matching items (read only).\n\nRight-click an item to delete it. Settings has what is recorded, how long it is kept, and deleting more.",
    filtersHelp = "Filters: each dropdown narrows the list; All shows everything. Search matches the item, player and boss names (an item's name shows once the game has loaded it).\n\nExport gives what the list shows now as CSV, to paste into a spreadsheet or Notion.",
    summaryHelp = "For the filters on the History tab: how many items each player got, and how many of them were tier tokens (in gold).",
    search = "Search",
    export = "Export CSV",
    count = "%d items",
    all = "All",
    deleteOne = "Delete this item from the history?",
    deleteBefore = "Delete every item from before %s?",
    deleteAll = "Delete the whole loot history? This can't be undone.",
    delete = "Delete",
}

local page, list, summary
local tabButtons, tabFrames = {}, {}
local currentTab = "history"
local filters = { player = ALL, boss = ALL, diff = ALL, month = ALL, roll = ALL, text = "" }
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

-- Reading a record ---------------------------------------------------------------------------

local itemCache = {} -- itemID -> { name, link } once the game has it
local requested = {}
local refreshVisible -- set once the list exists

local function item(rec)
    local id = Loot.ItemID(rec[R.ITEM])
    if not id then
        return nil
    end
    local cached = itemCache[id]
    if cached then
        return cached
    end
    local name, link = C_Item.GetItemInfo(rec[R.ITEM])
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

local function classColor(classID)
    local _, file = GetClassInfo(classID or 0)
    local c = file and (C_ClassColor and C_ClassColor.GetClassColor(file) or RAID_CLASS_COLORS[file])
    return c
end

local function difficultyName(id)
    local name = id and id > 0 and GetDifficultyInfo(id)
    return name or "?"
end

local function playerName(rec)
    return Loot:Name("players", rec[R.PLAYER]) or "?"
end

local function rollText(rec)
    local rc = Loot.rc[rec]
    if rc and rc.response then
        return rc.response, rc.color
    end
    return Loot.ROLLS[rec[R.ROLL] or -1] or "", nil
end

local searchCache = setmetatable({}, { __mode = "k" })
local function searchText(rec)
    local s = searchCache[rec]
    local it = item(rec)
    if not s or (it and not s.named) then
        local text = ((it and it.name or "") .. "\n" .. playerName(rec) .. "\n" .. (Loot:Boss(rec[R.ENC]) or "")):lower()
        s = { text = text, named = it ~= nil }
        searchCache[rec] = s
    end
    return s.text
end

local function passes(rec, month)
    if filters.player ~= ALL and playerName(rec) ~= filters.player then
        return false
    elseif filters.boss ~= ALL and tostring(rec[R.ENC]) ~= filters.boss then
        return false
    elseif filters.diff ~= ALL and tostring(rec[R.DIFF]) ~= filters.diff then
        return false
    elseif filters.month ~= ALL and month ~= filters.month then
        return false
    elseif filters.roll ~= ALL and tostring(rec[R.ROLL] or "none") ~= filters.roll then
        return false
    end
    if filters.text ~= "" and not searchText(rec):find(filters.text, 1, true) then
        return false
    end
    return true
end

-- The filtered view, newest first: { { rec, month } }.
local function view()
    local out = {}
    Loot:Each(function(rec, month)
        if passes(rec, month) then
            out[#out + 1] = { rec = rec, month = month }
        end
    end)
    return out
end

-- Filter choices, from what has been recorded.
local function choices(kind)
    local out, seen = { { key = ALL, label = TEXT.all } }, {}
    local function add(key, label)
        if key ~= nil and not seen[key] then
            seen[key] = true
            out[#out + 1] = { key = key, label = label }
        end
    end
    if kind == "month" then
        for _, m in ipairs(Loot:Months()) do
            add(m, m)
        end
        return out
    end
    local found = {}
    Loot:Each(function(rec)
        if kind == "player" then
            local name = playerName(rec)
            found[#found + 1] = { name, Ambiguate(name, "short") }
        elseif kind == "boss" then
            found[#found + 1] = { tostring(rec[R.ENC]), Loot:Boss(rec[R.ENC]) or ("Boss " .. rec[R.ENC]) }
        elseif kind == "diff" then
            found[#found + 1] = { tostring(rec[R.DIFF]), difficultyName(rec[R.DIFF]) }
        elseif kind == "roll" then
            local roll = rec[R.ROLL]
            found[#found + 1] = { tostring(roll or "none"), roll and Loot.ROLLS[roll] or "Not rolled" }
        end
    end)
    table.sort(found, function(a, b)
        return a[2] < b[2]
    end)
    for _, f in ipairs(found) do
        add(f[1], f[2])
    end
    return out
end

-- History: the list ------------------------------------------------------------------------------

-- Columns: x and width inside a row.
local COLS = {
    { key = "date", x = 4, w = 104 },
    { key = "player", x = 112, w = 150 },
    { key = "item", x = 266, w = 290 },
    { key = "boss", x = 560, w = 180 },
    { key = "diff", x = 744, w = 100 },
    { key = "roll", x = 848, w = 120 },
}

local function initRow(row, entry)
    if not row.cols then
        row.cols = {}
        for _, c in ipairs(COLS) do
            local fs = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
            fs:SetPoint("LEFT", c.x, 0)
            fs:SetWidth(c.w)
            fs:SetJustifyH("LEFT")
            fs:SetWordWrap(false)
            row.cols[c.key] = fs
        end
        local hl = row:CreateTexture(nil, "HIGHLIGHT")
        hl:SetAllPoints()
        hl:SetColorTexture(1, 1, 1, 0.08)
        row:RegisterForClicks("RightButtonUp")
        row:SetScript("OnEnter", function(self)
            local rec = self.entry and self.entry.rec
            if not rec then
                return
            end
            GameTooltip:SetOwner(self, "ANCHOR_CURSOR")
            pcall(GameTooltip.SetHyperlink, GameTooltip, rec[R.ITEM])
            local rc = Loot.rc[rec]
            if rc then
                GameTooltip:AddLine(" ")
                GameTooltip:AddLine("RCLootCouncil: " .. (rc.response or "?"), 1, 0.82, 0)
                if rc.note and rc.note ~= "" then
                    GameTooltip:AddLine("Note: " .. rc.note, 1, 1, 1, true)
                end
                if rc.votes then
                    GameTooltip:AddLine("Votes: " .. rc.votes, 1, 1, 1)
                end
            end
            GameTooltip:Show()
        end)
        row:SetScript("OnLeave", function()
            GameTooltip:Hide()
        end)
        row:SetScript("OnClick", function(self)
            local e = self.entry
            if e then
                confirm(TEXT.deleteOne, function()
                    Loot:Delete(e.rec, e.month)
                end)
            end
        end)
    end
    row.entry = entry
    local rec = entry.rec
    row.cols.date:SetText(date("%Y-%m-%d %H:%M", rec[R.TIME]))
    local name = playerName(rec)
    local c = classColor(rec[R.CLASS])
    row.cols.player:SetText(Ambiguate(name, "short"))
    if c then
        row.cols.player:SetTextColor(c.r, c.g, c.b)
    else
        row.cols.player:SetTextColor(1, 1, 1)
    end
    local it = item(rec)
    row.cols.item:SetText(it and it.link or ("item " .. tostring(Loot.ItemID(rec[R.ITEM]))))
    row.cols.boss:SetText(Loot:Boss(rec[R.ENC]) or "")
    row.cols.diff:SetText(difficultyName(rec[R.DIFF]))
    local roll, color = rollText(rec)
    row.cols.roll:SetText(roll)
    if color then
        row.cols.roll:SetTextColor(color[1], color[2], color[3])
    else
        row.cols.roll:SetTextColor(0.85, 0.85, 0.85)
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
    local lines = { "date,time,player,class,item id,item name,boss,instance,difficulty,roll type,rc response,rc note" }
    for _, e in ipairs(view()) do
        local rec = e.rec
        local it = item(rec)
        local rc = Loot.rc[rec] or {}
        local _, classFile = GetClassInfo(rec[R.CLASS] or 0)
        local roll = rec[R.ROLL]
        local fields = {
            date("%Y-%m-%d", rec[R.TIME]), date("%H:%M:%S", rec[R.TIME]), playerName(rec), classFile or "",
            Loot.ItemID(rec[R.ITEM]) or "", it and it.name or "", Loot:Boss(rec[R.ENC]) or "",
            Loot:Name("instances", rec[R.INST]) or "", difficultyName(rec[R.DIFF]),
            roll and Loot.ROLLS[roll] or "", rc.response or "", rc.note or "",
        }
        for i, f in ipairs(fields) do
            fields[i] = csvField(f)
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
        { "Month", 42, 100, "month" }, { "Roll", 30, 100, "roll" } }) do
        local row = filterDropdown(f, spec[1], spec[2], spec[3], spec[4])
        row:SetPoint("TOPLEFT", x, -4)
        x = x + spec[2] + 5 + spec[3] + 12
    end

    local searchLabel = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    searchLabel:SetPoint("TOPLEFT", 8, -46)
    searchLabel:SetText(TEXT.search)
    local search = CreateFrame("EditBox", nil, f, "InputBoxTemplate")
    search:SetAutoFocus(false)
    search:SetFontObject(CRTFontHighlight)
    search:SetSize(220, 22)
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
        h:SetText(({ date = "Date", player = "Player", item = "Item", boss = "Boss", diff = "Difficulty", roll = "Roll / response" })[c.key])
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
    bar:SetPoint("TOPLEFT", box, "TOPRIGHT", 8, 0)
    bar:SetPoint("BOTTOMLEFT", box, "BOTTOMRIGHT", 8, 0)
    local v = CreateScrollBoxListLinearView()
    v:SetElementExtent(ROW_H)
    v:SetElementInitializer("Button", initRow)
    ScrollUtil.InitScrollBoxListWithScrollBar(box, bar, v)
    list = { box = box }
end

-- Summary ------------------------------------------------------------------------------------

local function isToken(rec)
    local id = Loot.ItemID(rec[R.ITEM])
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
        local c = classColor(e.classID)
        row.name:SetTextColor(c and c.r or 1, c and c.g or 1, c and c.b or 1)
        row.items:SetText(e.items .. " items")
        row.tokens:SetText(e.tokens > 0 and ("|cffffd100" .. e.tokens .. " tier|r") or "")
    end)
    ScrollUtil.InitScrollBoxListWithScrollBar(box, bar, v)
    summary = {
        refresh = function(entries)
            local by, order = {}, {}
            for _, e in ipairs(entries) do
                local name = playerName(e.rec)
                local s = by[name]
                if not s then
                    s = { name = name, classID = e.rec[R.CLASS], items = 0, tokens = 0 }
                    by[name] = s
                    order[#order + 1] = s
                end
                s.items = s.items + 1
                if isToken(e.rec) then
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
    UI.Help(f, "Recording", "What is recorded: items from raid bosses, of the quality you pick or better. Tick Dungeons to record dungeon bosses too.\n\nEach player's own computer records what it sees; nothing is shared."):SetPoint("LEFT", heading, "RIGHT", 6, 0)
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
    UI.Help(f, "RCLootCouncil", "With RCLootCouncil installed, its saved awards add the council's response, note and votes to the matching items: same player and item, within a few hours. CRT only reads RCLootCouncil's data, never changes it. Re-scan reads it again now."):SetPoint("LEFT", rcHeading, "RIGHT", 6, 0)
    check(f, 6, -164, "Add RCLootCouncil's responses", function()
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
    UI.Help(f, "Deleting", "Delete the months before the one you pick, or everything. Single items are deleted with a right-click on the History tab."):SetPoint("LEFT", delHeading, "RIGHT", 6, 0)
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
        if passes(rec, month) then
            list.provider:InsertAtIndex({ rec = rec, month = month }, 1)
            countText:SetText(string.format(TEXT.count, list.provider:GetSize()))
        end
    elseif what == "changed" then
        refreshVisible()
    elseif page:IsVisible() then
        rebuild()
    end
end)

UI:RegisterPage("loot", TEXT.title, build)
