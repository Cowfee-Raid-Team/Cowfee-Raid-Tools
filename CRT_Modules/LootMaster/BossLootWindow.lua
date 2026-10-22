local ADDON, CRT = ...

-- The raid leader's Boss loot window: the boss rolls CRT handled (LootMaster/BossLoot.lua), one row each,
-- so the leader picks what goes into the loot session. Alex, 2026-10-20: "shows me the loot about to start
-- a session. This would make sure it's not starting on wrong items and gives the control to the raid
-- lead." It opens by itself on the first boss roll of a list. A pop-out made by UI.Window: drag it, resize
-- it from the corner, Reset puts it back; its place is kept in CRTDB lootmaster.bossLoot.
-- Each row: a checkbox (in the next session; pre-ticked by the loot filter), the item's icon, link and
-- detail (slot and item level, and for an item you have its time left to trade, a warning in its last
-- LM.TRADE_WARN; or why the filter left it out), and its state on the right: rolling
-- (honey), won (good), won by someone else or nobody (muted), or can't roll (red). Footer: the counts,
-- Clear, and Start session (only the ticked items you have won; it waits while a ticked one still rolls,
-- and queues behind a running session). While shown, it redraws every REDRAW_SECONDS so the times count down.

local LM = CRT.LootMaster
local UI = CRT.UI
local BL = LM.BossLoot

local L = { width = 620, height = 340, minWidth = 480, minHeight = 220, rowH = 40, footerH = 28, statusW = 230 }

local TEXT = {
    title = "Boss loot",
    help = "The boss items CRT rolled on for you, and in old raids with no rolls, the items the game gave you. Tick the ones to give out and press Start session; nothing starts by itself. Start waits while a ticked item is still rolling. A test session still running is ended first; if a loot session is running, these start when it ends. The Loot Master window opens either way. Items someone else won can't be ticked, and red means CRT couldn't roll on it. The list is kept for the whole raid, through a /reload or leaving the instance. An item you have stays until the game's 2 hours to trade it are over; chat warns 15 minutes before. Other rows leave 10 minutes after the kill. TEST items come from Test boss kill on Loot Master > Tonight; they never go into a real session.",
    counts = "%d of %d items ticked · %d still rolling",
    session = " · a loot session is running",
    clear = "Clear",
    start = "Start session",
    rolling = "Rolling… you rolled %s",
    won = "Won · you rolled %s",
    received = "Yours · the game gave it to you",
    bags = "Yours · from your bags",
    lost = "Won by %s",
    nowinner = "Nobody won it: everyone passed",
    cant = "Can't roll: %s. Tell the raid.",
    notFilter = "Not in your loot filter: %s",
    ilvl = "Item level %d",
    tradeHours = "%dh %02dm left to trade",
    tradeMinutes = "%dm left to trade",
    untimed = "Not bound: leaves with the other items",
    test = "TEST",
    testWon = "Yours · a test boss kill",
}

-- The loot filter's reasons, as the detail line says them (LM.PassesFilter's why).
local FILTER_WHY = {
    source = "boss loot is off",
    quality = "below the lowest quality",
    ilvl = "below the lowest item level",
    kind = "its kind is off",
}

-- The muted state's Classic color; Modern takes the theme's note. Won and can't roll are the theme's good
-- and bad; rolling is the accent in Modern and the game's gold (the heading) in Classic.
local CLASSIC = { muted = "9d9d9d" }

local win, list, footer

local function settings()
    return CRT.db.lootmaster.bossLoot
end

local function hexOf(key, classic)
    if not UI:IsModern() then
        return classic
    end
    local c = CRT.PALETTE[key]
    return string.format("%02x%02x%02x", math.floor(c[1] * 255 + 0.5), math.floor(c[2] * 255 + 0.5), math.floor(c[3] * 255 + 0.5))
end

local function colored(hex, text)
    return "|cff" .. hex .. text .. "|r"
end

-- The state on the right of a row.
function LM.BossLootStatus(r)
    local roll = LM.AutoPass.ROLL_NAME[r.rollType or 0] or ""
    if r.status == "won" and r.test then
        return UI.GoodText(TEXT.testWon)
    elseif r.status == "won" and r.bags then
        return UI.GoodText(TEXT.bags)
    elseif r.status == "won" and r.received then
        return UI.GoodText(TEXT.received)
    elseif r.status == "won" then
        return UI.GoodText(TEXT.won:format(roll))
    elseif r.status == "lost" then
        return colored(hexOf("muted", CLASSIC.muted), TEXT.lost:format(Ambiguate(r.winner or "?", "short")))
    elseif r.status == "nowinner" then
        return colored(hexOf("muted", CLASSIC.muted), TEXT.nowinner)
    elseif r.status == "cant" then
        return UI.BadText(TEXT.cant:format(r.reason or "?"))
    end
    return UI.ColorText(TEXT.rolling:format(roll), UI:IsModern() and "accent" or "heading")
end

-- The detail under the link: slot and item level, or why the loot filter left it out. withBoss: the
-- row's boss first (always for a TEST row, whose boss isn't the window's badge).
function LM.BossLootDetail(r, withBoss)
    local boss = (withBoss or r.test) and type(r.boss) == "string" and r.boss or nil
    if not r.pass and not r.bags then -- an item you added from your bags is in on purpose
        local why = TEXT.notFilter:format(FILTER_WHY[r.why] or tostring(r.why or "?"))
        return boss and (boss .. " · " .. why) or why
    end
    local ok, _, _, _, equipLoc = pcall(C_Item.GetItemInfoInstant, r.link)
    local slot = ok and type(equipLoc) == "string" and equipLoc ~= "" and _G[equipLoc] or nil
    local parts = { boss }
    if type(slot) == "string" then
        parts[#parts + 1] = slot
    end
    if r.ilvl then
        parts[#parts + 1] = TEXT.ilvl:format(r.ilvl)
    end
    local left = BL.TradeLeft(r)
    if r.untimed then
        parts[#parts + 1] = TEXT.untimed -- no trade time of its own (LootMaster/BossLoot.lua)
    elseif left then
        local m = math.ceil(left / 60)
        local text = m >= 60 and TEXT.tradeHours:format(math.floor(m / 60), m % 60) or TEXT.tradeMinutes:format(m)
        parts[#parts + 1] = left <= LM.TRADE_WARN and UI.WarnText(text) or text
    end
    return table.concat(parts, " · ")
end

-- Draws one Boss loot row on row (a Button): the checkbox, icon, link (with TEST in the warn colour for a
-- test boss kill's row), detail and state. The window's list and Loot Master > Tonight's Held boss loot
-- both use it; row.withBoss puts each row's boss in its detail (Tonight has no badge).
function LM.BossLootRow(row, r)
    if not row.check then
        row.check = CreateFrame("CheckButton", nil, row, "UICheckButtonTemplate")
        row.check:SetSize(24, 24)
        row.check:SetPoint("LEFT", 2, 0)
        UI:SkinCheckButton(row.check)
        row.check:SetScript("OnClick", function(self)
            local d = row.data
            if d then
                BL:SetTicked(d.rollID, self:GetChecked())
            end
        end)
        row.icon = row:CreateTexture(nil, "ARTWORK")
        row.icon:SetSize(32, 32)
        row.icon:SetPoint("LEFT", 32, 0)
        row.status = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        row.status:SetPoint("RIGHT", -6, 0)
        row.status:SetWidth(L.statusW)
        row.status:SetJustifyH("RIGHT")
        row.name = row:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
        row.name:SetPoint("TOPLEFT", row.icon, "TOPRIGHT", 8, -1)
        row.name:SetPoint("RIGHT", row.status, "LEFT", -8, 0)
        row.name:SetJustifyH("LEFT")
        row.name:SetWordWrap(false)
        row.detail = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        row.detail:SetPoint("BOTTOMLEFT", row.icon, "BOTTOMRIGHT", 8, 1)
        row.detail:SetPoint("RIGHT", row.status, "LEFT", -8, 0)
        row.detail:SetJustifyH("LEFT")
        row.detail:SetWordWrap(false)
        UI.Tint(row.detail, "SetTextColor", "muted") -- muted, and follows the theme
        local hl = row:CreateTexture(nil, "HIGHLIGHT")
        hl:SetAllPoints()
        hl:SetColorTexture(1, 1, 1, 0.06)
        row:SetScript("OnEnter", function(self)
            if self.data and self.data.link then
                UI.TooltipOwner(GameTooltip, self, "ANCHOR_RIGHT")
                GameTooltip:SetHyperlink(self.data.link)
                GameTooltip:Show()
            end
        end)
        row:SetScript("OnLeave", function()
            GameTooltip:Hide()
        end)
    end
    row.data = r
    row.check:SetChecked(r.ticked and true or false)
    row.check:SetEnabled(BL.Tickable(r))
    local okI, _, _, _, _, icon = pcall(C_Item.GetItemInfoInstant, r.link)
    row.icon:SetTexture(okI and icon or 134400)
    row.icon:SetDesaturated(not BL.Tickable(r))
    local link = r.link
    if r.test then
        -- a sample's link made from its item string gets the item's name once the game has it
        local okL, _, gameLink = pcall(C_Item.GetItemInfo, r.itemString)
        link = ((okL and type(gameLink) == "string") and gameLink or link) .. "  " .. UI.WarnText(TEXT.test)
    end
    row.name:SetText(link)
    row.detail:SetText(LM.BossLootDetail(r, row.withBoss))
    row.status:SetText(LM.BossLootStatus(r))
end

local REDRAW_SECONDS = 30
local redraw -- the countdown's ticker, while the window shows

local function refresh()
    if not win then
        return
    end
    local badge = BL.boss and (BL.difficulty and (BL.boss .. " · " .. BL.difficulty) or BL.boss) or nil
    win.strip:SetBadge(badge, nil, badge and UI.TITLE_STRIP.neutral or nil)
    list:SetDataProvider(CreateDataProvider(BL:Rows()), ScrollBoxConstants and ScrollBoxConstants.RetainScrollPosition)
    local ticked, total, rolling = BL:Counts()
    local ok = BL:CanStart()
    footer.counts:SetText(TEXT.counts:format(ticked, total, rolling) .. (BL:Busy() and TEXT.session or ""))
    footer.start:SetEnabled(ok and true or false)
    footer.clear:SetEnabled(total > 0)
end

local function build()
    if win then
        return
    end
    win = UI.Window("CowfeeRaidToolsBossLoot", {
        kind = "popout", title = TEXT.title, width = L.width, height = L.height,
        minWidth = L.minWidth, minHeight = L.minHeight, saved = settings,
    })
    win.refresh = refresh -- a theme change repaints the states (UI:RepaintTheme)
    win:HookScript("OnShow", function()
        redraw = redraw or C_Timer.NewTicker(REDRAW_SECONDS, refresh)
    end)
    win:HookScript("OnHide", function()
        if redraw then
            redraw:Cancel()
            redraw = nil
        end
    end)
    local c = win.content
    footer = CreateFrame("Frame", nil, c)
    footer:SetPoint("BOTTOMLEFT", 0, 0)
    footer:SetPoint("BOTTOMRIGHT", 0, 0)
    footer:SetHeight(L.footerH)
    footer.start = UI.PanelButton(footer, TEXT.start, 22, function()
        BL:Start()
    end)
    footer.start:SetPoint("RIGHT", 0, 0)
    footer.clear = UI.PanelButton(footer, TEXT.clear, 22, function()
        BL:Clear()
    end)
    footer.clear:SetPoint("RIGHT", footer.start, "LEFT", -8, 0)
    footer.counts = footer:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    footer.counts:SetPoint("LEFT", 4, 0)
    footer.help = UI.HelpRight(footer.counts, TEXT.title, TEXT.help)
    local box = CreateFrame("Frame", nil, c, "WowScrollBoxList")
    box:SetPoint("TOPLEFT", 0, 0)
    box:SetPoint("BOTTOMRIGHT", -20, L.footerH + 6)
    local bar = CreateFrame("EventFrame", nil, c, "MinimalScrollBar")
    UI:SkinScrollBar(bar)
    bar:SetPoint("TOPLEFT", box, "TOPRIGHT", 6, 0)
    bar:SetPoint("BOTTOMLEFT", box, "BOTTOMRIGHT", 6, 0)
    local v = CreateScrollBoxListLinearView()
    v:SetElementExtent(L.rowH)
    v:SetElementInitializer("Button", LM.BossLootRow)
    ScrollUtil.InitScrollBoxListWithScrollBar(box, bar, v)
    list = box
end

LM:OnChange(function(what, sub)
    if what == "bossloot" then
        if sub == "open" then
            build()
            refresh()
            win:Show()
        elseif win then
            refresh()
        end
    elseif (what == "started" or what == "ended") and win then
        refresh() -- Start session waits for a running session
    end
end)

-- /crt loot boss: the window again.
function LM:ShowBossLoot()
    build()
    refresh()
    win:Show()
end
