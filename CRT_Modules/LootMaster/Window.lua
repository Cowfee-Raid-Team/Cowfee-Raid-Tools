local ADDON, CRT = ...

-- The looter's window: the session's items as tabs down the left, and for the chosen item every raider's
-- row, sorted by the response's weight, then Raider Score, then roll (Session:Rows). Right-click a row to
-- award the item for a response, show the raider's popup again, ask them to roll again, or clear their
-- answer; right-click an item tab to do that for everyone who still needs it. A pop-out made by
-- UI.Window: drag it, resize it from the corner, Reset puts it back; its place is kept in CRTDB
-- lootmaster.window.

local LM = CRT.LootMaster
local UI = CRT.UI

local L = {
    width = 1040, height = 460, minWidth = 760, minHeight = 300,
    left = LM.TAB_COLUMN + 14, -- the item tabs (LootMaster/Tabs.lua), then the list
    headerH = 50, rowH = 22,
    headingH = 20, -- the column headings, above the rows
}

-- Columns: x and width inside a row.
local COLS = {
    { key = "name", x = 4, w = 130, title = "Name" },
    { key = "role", x = 138, w = 40, title = "Role" },
    { key = "response", x = 182, w = 160, title = "Response" },
    { key = "ilvl", x = 346, w = 48, title = "iLvl" },
    { key = "gear", x = 398, w = 92, title = "Gear" },
    { key = "note", x = 494, w = 170, title = "Note" },
    { key = "roll", x = 668, w = 60, title = "Roll" },
    { key = "score", x = 732, w = 50, title = "Score" },
}

local TEXT = {
    title = "Loot Master",
    test = "TEST",
    help = "Every raider's answer for the item picked on the left, best first: the answer's weight, then Raider Score, then the roll. Right-click a raider to give them the item, show their popup again, roll again for them, or clear their answer. Ctrl- or Shift-click picks several raiders first. Right-click an item on the left to do that for everyone who still needs it.",
    answered = "%d of %d answered",
    awarded = "Given to %s for %s",
    endSession = "End session",
    tradeHint = "Double-click to trade it to the winner (stand next to them).",
    waiting = "Choosing...",
    timeout = "No answer (timed out)",
    nocrt = "No CRT",
    loading = "Loading...",
    auto = "auto",
    autoClasses = "Answered by %s's CRT: the item is only for %s, not their class. You can turn this off on the Settings tab.",
    autoArmor = "Answered by %s's CRT: the item is %s, not their class's armor type. You can turn this off on the Settings tab.",
    autoWeapon = "Answered by %s's CRT: its weapon type (%s) is one their class can't use. You can turn this off on the Settings tab.",
    autoWhy = "Answered by %s's CRT: the game lists this item only for %s, and none of those is one of their specs. They can answer it themselves, and you can turn this off on the Settings tab.",
    awardFor = "Give for %s",
    resend = "Show their popup again",
    rerollAsk = "Roll again for them",
    clear = "Clear their answer",
    resendAll = "Show the popup again to everyone who hasn't answered (%d)",
    selected = "%d raiders",
}

local win, list, header, sorter
local tabs -- LM.ItemTabs
local loading = {} -- item IDs asked of the game, so the header fills in once each loads
local current = 1 -- the item shown
local selected = {} -- name -> true

local function settings()
    return CRT.db.lootmaster.window
end

local ROLE_TEXT = { T = "Tank", H = "Heal", D = "DPS", N = "" }

local function classColor(file)
    return file and (C_ClassColor and C_ClassColor.GetClassColor(file) or RAID_CLASS_COLORS[file]) or nil
end

local contextMenu = UI.ContextMenu -- above the window, which sits on the popups layer

-- Rows -----------------------------------------------------------------------------------------------

local function names()
    local out = {}
    for n in pairs(selected) do
        out[#out + 1] = n
    end
    table.sort(out)
    return out
end

local function rowMenu(row)
    local s = LM.current
    local r = row.data
    if not (s and r) then
        return
    end
    if not selected[r.name] then
        wipe(selected)
        selected[r.name] = true
        LM:Fire("session")
    end
    local picked = names()
    local index = current
    contextMenu(row, function(root)
        root:CreateTitle(#picked == 1 and Ambiguate(picked[1], "short") or string.format(TEXT.selected, #picked))
        if #picked == 1 then
            -- every answer can win an item, the weight-0 last button and the built-in Transmog too
            for _, resp in ipairs(s:AwardResponses()) do
                local c = resp.color
                local label = string.format("|cff%02x%02x%02x%s|r", c[1] * 255, c[2] * 255, c[3] * 255, string.format(TEXT.awardFor, resp.label))
                root:CreateButton(label, function()
                    LM:Award(index, picked[1], resp.key)
                end)
            end
            root:CreateDivider()
        end
        local canResend, canReroll = 0, 0
        for _, n in ipairs(picked) do
            canResend = canResend + (s:CanResend(n, index) and 1 or 0)
            canReroll = canReroll + (s:CanReroll(n, index) and 1 or 0)
        end
        local b = root:CreateButton(TEXT.resend .. (#picked > 1 and (" (" .. canResend .. ")") or ""), function()
            LM:Resend(index, picked)
        end)
        b:SetEnabled(canResend > 0)
        b = root:CreateButton(TEXT.rerollAsk .. (#picked > 1 and (" (" .. canReroll .. ")") or ""), function()
            LM:Reroll(index, picked)
        end)
        b:SetEnabled(canReroll > 0)
        if #picked == 1 then
            b = root:CreateButton(TEXT.clear, function()
                LM:ClearAnswer(index, picked[1])
            end)
            local pl = s.players[picked[1]]
            b:SetEnabled((pl and pl.answers[index] and pl.answers[index].response) and true or false)
        end
    end)
end

local function responseCell(r, s)
    if r.state == "nocrt" then
        return "|cffff8a40" .. TEXT.nocrt .. "|r"
    elseif r.state == "timeout" then
        return UI.BadText(TEXT.timeout)
    elseif r.state == "loading" then
        return "|cff9c8a78" .. TEXT.loading .. "|r"
    elseif r.response then
        local resp = s:Response(r.response)
        local c = resp.color
        return string.format("|cff%02x%02x%02x%s|r", c[1] * 255, c[2] * 255, c[3] * 255, resp.label)
            .. (r.auto and ("  |cff9c8a78" .. TEXT.auto .. "|r") or "")
    end
    return "|cff9c8a78" .. TEXT.waiting .. "|r"
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
        local gx = COLS[5].x
        for i = 1, 2 do
            row.gear[i] = LM.GearIcon(row, gx + (i - 1) * 20)
        end
        row.diff = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        row.diff:SetPoint("LEFT", gx + 44, 0)
        row.sel = row:CreateTexture(nil, "BACKGROUND")
        row.sel:SetAllPoints()
        local hl = row:CreateTexture(nil, "HIGHLIGHT")
        hl:SetAllPoints()
        hl:SetColorTexture(1, 1, 1, 0.06)
        row:RegisterForClicks("LeftButtonUp", "RightButtonUp")
        row:SetScript("OnClick", function(self, button)
            local name = self.data and self.data.name
            if not name then
                return
            end
            if button == "RightButton" then
                rowMenu(self)
                return
            end
            if IsControlKeyDown() or IsShiftKeyDown() then
                selected[name] = not selected[name] or nil
            else
                wipe(selected)
                selected[name] = true
            end
            LM:Fire("session")
        end)
        row:SetScript("OnEnter", function(self)
            local d = self.data
            if not d or not ((d.note and d.note ~= "") or d.auto) then
                return
            end
            GameTooltip:SetOwner(self, "ANCHOR_CURSOR")
            GameTooltip:SetText(Ambiguate(d.name, "short"), 1, 1, 1)
            if d.note and d.note ~= "" then
                GameTooltip:AddLine(d.note, 0.85, 0.85, 0.85, true)
            end
            if d.auto then
                -- why it was answered for them, by the reason their CRT sent
                local who = Ambiguate(d.name, "short")
                local text
                if d.autoWhy == "classes" then
                    text = string.format(TEXT.autoClasses, who, (d.autoDetail or "?"):gsub("/", ", "))
                elseif d.autoWhy == "armor" then
                    local sub = tonumber(d.autoDetail)
                    local name = sub and C_Item.GetItemSubClassInfo and C_Item.GetItemSubClassInfo(LM.ITEM_CLASS_ARMOR, sub)
                    text = string.format(TEXT.autoArmor, who, name or "?")
                elseif d.autoWhy == "weapon" then
                    text = string.format(TEXT.autoWeapon, who, d.autoDetail or "?")
                else
                    local names = {}
                    for _, id in ipairs(d.autoSpecs or {}) do
                        local ok, _, spec, _, _, _, _, class = pcall(GetSpecializationInfoByID, id)
                        names[#names + 1] = ok and spec and (spec .. " " .. (class or "")) or tostring(id)
                    end
                    text = string.format(TEXT.autoWhy, who, #names > 0 and table.concat(names, ", ") or "?")
                end
                GameTooltip:AddLine(text, 0.85, 0.85, 0.85, true)
            end
            GameTooltip:Show()
        end)
        row:SetScript("OnLeave", function()
            GameTooltip:Hide()
        end)
    end
    row.data = r
    local cols = row.cols
    local cc = classColor(r.class)
    cols.name:SetText(Ambiguate(r.name, "short"))
    cols.name:SetTextColor(cc and cc.r or 0.85, cc and cc.g or 0.85, cc and cc.b or 0.85)
    cols.role:SetText(ROLE_TEXT[r.role or "N"] or "")
    cols.response:SetText(responseCell(r, LM.current))
    cols.ilvl:SetText(r.ilvl and string.format("%.0f", r.ilvl) or "")
    local item = LM.current and LM.current.items[current]
    for i, t in ipairs(row.gear) do
        LM.SetGear(t, r.gear[i], r.name == LM:Me() and item and item.itemString or nil)
    end
    if r.diff then
        row.diff:SetText(r.diff > 0 and UI.GoodText("+" .. r.diff) or (r.diff < 0 and UI.BadText(r.diff) or "0"))
    else
        row.diff:SetText("")
    end
    cols.note:SetText(r.note or "")
    if r.roll then
        cols.roll:SetText(tostring(r.roll))
    elseif r.response then
        cols.roll:SetText("|cff9c8a78...|r") -- drawn when the answer arrives
    else
        cols.roll:SetText("")
    end
    cols.score:SetText(r.score and tostring(r.score) or "—")
    local accent = CRT.MOCHA.caramel -- a picked raider, in the theme's accent
    row.sel:SetColorTexture(accent[1], accent[2], accent[3], 0.18)
    row.sel:SetShown(selected[r.name] and true or false)
end

-- Item tabs ------------------------------------------------------------------------------------------

local function tabMenu(tab)
    local s = LM.current
    local index = tab.index
    if not s then
        return
    end
    local missing = {} -- raiders with CRT who haven't answered this item
    for _, name in ipairs(s.order) do
        if s:CanResend(name, index) then
            missing[#missing + 1] = name
        end
    end
    contextMenu(tab, function(root)
        root:CreateTitle(s.items[index].link or s.items[index].itemString)
        local b = root:CreateButton(string.format(TEXT.resendAll, #missing), function()
            LM:Resend(index, missing)
        end)
        b:SetEnabled(#missing > 0)
    end)
end

-- The window -----------------------------------------------------------------------------------------

local function build()
    if win then
        return
    end
    win = UI.Window("CowfeeRaidToolsLootMaster", {
        kind = "popout", title = TEXT.title, width = L.width, height = L.height,
        minWidth = L.minWidth, minHeight = L.minHeight, saved = settings,
    })
    local c = win.content
    -- the line between the item tabs and the list
    local divider = c:CreateTexture(nil, "ARTWORK")
    divider:SetColorTexture(0.35, 0.35, 0.35, 0.8)
    divider:SetWidth(1)
    divider:SetPoint("TOPLEFT", LM.TAB_COLUMN + 6, 0)
    divider:SetPoint("BOTTOMLEFT", LM.TAB_COLUMN + 6, 0)
    tabs = LM.ItemTabs(c, {
        window = win,
        onSelect = function(index)
            current = index
            wipe(selected)
            LM:Fire("session")
        end,
        onRightClick = tabMenu,
        onDoubleClick = function(index)
            LM:TradeItem(index)
        end,
        doubleClickHint = TEXT.tradeHint,
    })
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
    header.help = UI.Help(header, TEXT.title, TEXT.help)
    header.help:SetPoint("LEFT", header.name, "RIGHT", 4, 0)
    local endButton = UI.HeaderButton(header, TEXT.endSession, function()
        LM:End()
    end)
    endButton:SetPoint("RIGHT", 0, 0)
    header.answered = header:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    header.answered:SetPoint("RIGHT", endButton, "LEFT", -12, 0)

    -- the headings and the rows clip at the same edge when the window is narrow (LM.ListArea)
    local area = LM.ListArea(c, L.left, -L.headerH - 4)
    sorter = UI.SortHeaders(area, COLS, {
        x = 0, y = 0, backToDefault = true,
        get = function()
            local s = CRT.db.lootmaster.sort
            return s.looterKey, s.looterDir or 1
        end,
        set = function(key, dir)
            local s = CRT.db.lootmaster.sort
            s.looterKey, s.looterDir = key, dir
            LM:Fire("session")
        end,
    })
    local box = CreateFrame("Frame", nil, area, "WowScrollBoxList")
    box:SetPoint("TOPLEFT", 0, -L.headingH)
    box:SetPoint("BOTTOMRIGHT", 0, 0)
    -- the scroll bar is outside the clipped area, so it always shows
    local bar = CreateFrame("EventFrame", nil, c, "MinimalScrollBar")
    UI:SkinScrollBar(bar)
    bar:SetPoint("TOPLEFT", box, "TOPRIGHT", 6, 0)
    bar:SetPoint("BOTTOMLEFT", box, "BOTTOMRIGHT", 6, 0)
    local v = CreateScrollBoxListLinearView()
    v:SetElementExtent(L.rowH)
    v:SetElementInitializer("Button", initRow)
    ScrollUtil.InitScrollBoxListWithScrollBar(box, bar, v)
    list = box
end

local function refresh()
    local s = LM.current
    if not (win and s) then
        return
    end
    if not s.items[current] then
        current = 1
    end
    win.strip:SetTitle(TEXT.title)
    -- TEST for a test, else the boss this computer saw killed just before (LM:RecentBoss)
    win.strip:SetBadge(s.test and TEXT.test or s.boss, nil, not s.test and UI.TITLE_STRIP.neutral or nil)
    tabs:Update(s.items, current, function(i)
        return s:AnswerCount(i)
    end, function(name)
        return s.players[name] and s.players[name].class
    end)
    local it = s.items[current]
    header.icon:SetTexture(C_Item.GetItemIconByID(it.itemString or "") or 134400)
    local _, link = C_Item.GetItemInfo(it.itemString or "")
    it.link = it.link or link
    local id = tonumber((it.itemString or ""):match("item:(%d+)"))
    if not it.link and id and not loading[id] then
        loading[id] = true
        Item:CreateFromItemID(id):ContinueOnItemLoad(function()
            LM:Fire("session")
        end)
    end
    header.name:SetText(it.link or it.itemString)
    if it.award then
        local r = s:Response(it.award.response)
        header.info:SetText(string.format(TEXT.awarded, Ambiguate(it.award.name, "short"), r and r.label or it.award.response))
    else
        header.info:SetText(it.ilvl and ("Item level " .. it.ilvl) or "")
    end
    -- the same count as the tab; everyone in, matcha in a Modern theme
    local answered, expected = s:AnswerCount(current)
    local count = string.format(TEXT.answered, answered, expected)
    header.answered:SetText((expected > 0 and answered >= expected) and UI.GoodText(count) or count)
    local rows = s:Rows(current, LM.Score)
    local sort = CRT.db.lootmaster.sort
    if sort.looterKey then
        LM.SortRows(rows, sort.looterKey, sort.looterDir or 1)
    end
    sorter.refresh()
    list:SetDataProvider(CreateDataProvider(rows), ScrollBoxConstants and ScrollBoxConstants.RetainScrollPosition)
end

LM:OnChange(function(what)
    if what == "started" then
        build()
        current = 1
        wipe(selected)
        refresh()
        win:Show()
    elseif what == "session" or what == "scores" then
        refresh()
    elseif what == "ended" and win then
        win:Hide()
    end
end)
-- a new theme repaints the rows, the tabs and the answered count
UI:OnTheme(refresh)

function LM:ShowWindow()
    if not self.current then
        CRT:Print("Loot Master: no loot session is running. /crt loot test starts a test.")
        return
    end
    build()
    refresh()
    win:Show()
end
