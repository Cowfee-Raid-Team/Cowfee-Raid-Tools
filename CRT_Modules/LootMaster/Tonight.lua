local ADDON, CRT = ...

-- Loot Master > Tonight (LootMaster/Page.lua makes the tab and calls LM.BuildTonight). Two columns (Alex,
-- 2026-10-25: "I want the user's experience quite a bit cleaner and the Masterloot deals with the right hand
-- side"):
--   My Loot (left, everyone's): one large card. Its status line counts the items of the session you were
--     sent that still wait for your answer, with their icons (quality borders, tooltips); with nothing
--     waiting it shows the session's or the last one's items dimmed (LM.MyLoot, LootMaster/RaiderWindow.lua).
--     A click anywhere on it opens your loot popup and All Loot Rolls (LM:OpenMyLoot), as /crt loot does.
--   Master loot (right, the looter's): its heading's (?) says only the master looter uses it. CRT Looting's
--     state with the leader's Turn on / Turn off for everyone (LootMaster/Looting.lua); the session line; a
--     2x2 grid of Test boss kill, Start session (N), Master Loot Window and End session; Held boss loot as a
--     compact scrolling list (LootMaster/BossLoot.lua's rows); Add from bags (LootMaster/AddItem.lua); the
--     running session's Items. Without loot authority (LM:CanLoot) the buttons are off, with the reason on
--     hover, the rest is greyed, and Add from bags refuses with the reason.
-- Laid out for the tab's area under the page's tabs (UI.PAGE_W wide, 494 high). Numbers in L, wording in TEXT.
-- LM.Tonight holds the parts, for the tests.

local LM = CRT.LootMaster
local UI = CRT.UI

local L = {
    card = 8, cardTop = -8, cardW = 400, cardH = 200, cardPad = 16, cardEdge = 2,
    statusTop = -50, -- the card's status line, under its title
    icon = 36, iconGap = 6, iconTop = -84, iconEdge = 2, -- the waiting items' icons, at most LM.MAX_ITEMS
    oldAlpha = 0.4, -- the last session's icons, with nothing waiting
    redraw = 1, -- seconds between the card's redraws while it shows (an item's time runs out)
    col = 424, -- Master loot
    sub = 724, -- its second column, under the buttons: Add from bags and Items
    lootingTop = -32, sessionTop = -100, gridTop = -120, gridRow = 30, gridGap = 6, buttonH = 24,
    heldTop = -186, heldCountTop = -206, heldListTop = -224, heldRowH = 22, heldRows = 8, heldW = 262,
    addTop = -186, addSlotTop = -208, itemsTop = -266, itemRow = 18,
    dim = 0.5, -- the greyed right side, without loot authority
}
L.colW = UI.PAGE_W - L.col - 8
L.subW = UI.PAGE_W - L.sub - 8

local TEXT = {
    myLoot = "My Loot",
    hint = "Click to open your roll window · /crt loot",
    nothing = "Nothing to roll on right now",
    waitingOne = "1 item waiting for your answer",
    waitingMany = "%d items waiting for your answer",
    master = "Master loot",
    masterHelp = "Only the master looter uses this side: the raid leader, or a looter they name in Loot authority. For everyone else it is greyed out; My Loot on the left is yours.\n\nTest boss kill acts as one boss kill: it adds 2 to 4 sample items marked TEST to Held boss loot. Start session gives out the ticked items, as after a real kill. A session of TEST items is a test: everyone with CRT gets the popup, nothing is passed or saved to Loot History, and only you see the award message. Master Loot Window is where you give the items out. End session asks first, then ends the session, puts real items waiting to start back in Held boss loot unticked, and clears the TEST items. /crt loot test starts a test session at once.",
    none = "No loot session is running.",
    running = "%s%d items, %d of %d raiders with CRT, %d answers in",
    testTag = "TEST · ",
    testKill = "Test boss kill", start = "Start session (%d)", window = "Master Loot Window", endSession = "End session",
    noAuthority = "Only the raid leader, or a looter they name in Loot authority, can run loot.",
    held = "Held boss loot",
    heldHelp = "The boss items waiting for your next loot session, real and TEST, as in the Boss loot window (/crt loot boss). Tick the ones to give out and press Start session. TEST items never go into a real session: with both kinds ticked, only the real ones start. TEST items go at End session, after a /reload, or 10 minutes after their test kill. Add from bags puts an item from your bags on the list, marked from your bags, if you can still trade it. One that isn't bound has no trade time and leaves 2 hours after you added it.",
    heldNone = "No boss loot held.",
    heldCount = "%d %s killed, %d %s held",
    heldBoss = "boss", heldBosses = "bosses", heldItem = "item", heldItems = "items",
    test = "TEST",
    add = "Add from bags",
    items = "Items",
    crtLooting = "CRT Looting",
    crtLootingHelp = "When CRT Looting is on, for 10 minutes after a boss kill your CRT passes your loot rolls (trash too) and the raid leader's CRT rolls Need, so the leader gets the items to give out. Only items in the raid leader's loot filter: anything else is a normal roll, and so is an item your CRT can't read yet. Only the raid leader turns it on or off, for everyone; CRT asks on the way into a raid instance. It starts off after a /reload and turns off when the leader enters another instance.\n\nYou roll yourself when a test session is running, you aren't in the leader's instance, the leader is off, changed, offline or quiet for 90 seconds, the leader's CRT is too old, you are in a finder group, or no boss was killed here in the last 10 minutes. Chat says each pass.",
    turnOn = "Turn on", turnOff = "Turn off for everyone",
    awarded = "given to %s (%s)",
    open = "open",
}

local T = {} -- the parts (LM.Tonight)
LM.Tonight = T

local function canLoot()
    return LM:CanLoot() and true or false
end

-- A button as wide as its label.
local function fitWidth(b)
    local fs = b:GetFontString()
    b:SetWidth(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0))
end

-- An item's quality colour (the game's), else the theme's edge.
local function qualityColor(item)
    local ok, q = pcall(C_Item.GetItemQualityByID, item)
    if ok and type(q) == "number" then
        local okC, r, g, b = pcall(C_Item.GetItemQualityColor, q)
        if okC and type(r) == "number" then
            return r, g, b
        end
    end
    return UI.Color("border")
end

local function itemIcon(item)
    local ok, tex = pcall(C_Item.GetItemIconByID, item)
    return ok and tex or 134400
end

local function showItemTip(owner, item)
    if not item then
        return
    end
    local ok, _, gameLink = pcall(C_Item.GetItemInfo, item)
    UI.TooltipOwner(GameTooltip, owner, "ANCHOR_RIGHT", nil, nil, "lootmaster")
    pcall(GameTooltip.SetHyperlink, GameTooltip, (ok and type(gameLink) == "string") and gameLink or item)
    GameTooltip:Show()
end

local function hideTip()
    GameTooltip:Hide()
end

-- My Loot ---------------------------------------------------------------------------------------------

local function openMine()
    LM:OpenMyLoot()
end

local function makeIcon(card, i)
    local ic = CreateFrame("Button", nil, card, "BackdropTemplate")
    ic:SetSize(L.icon, L.icon)
    ic:SetPoint("TOPLEFT", L.cardPad + (i - 1) * (L.icon + L.iconGap), L.iconTop)
    ic:SetBackdrop({ edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = L.iconEdge })
    ic.icon = ic:CreateTexture(nil, "ARTWORK")
    ic.icon:SetPoint("TOPLEFT", L.iconEdge, -L.iconEdge)
    ic.icon:SetPoint("BOTTOMRIGHT", -L.iconEdge, L.iconEdge)
    ic:SetScript("OnEnter", function(self)
        showItemTip(self, self.item)
    end)
    ic:SetScript("OnLeave", hideTip)
    ic:SetScript("OnClick", openMine) -- the whole card opens your loot, its icons too
    ic:Hide()
    return ic
end

local function refreshCard()
    local count, items, old = LM.MyLoot()
    T.cardStatus:SetText(count == 0 and TEXT.nothing or (count == 1 and TEXT.waitingOne or TEXT.waitingMany:format(count)))
    for i, ic in ipairs(T.cardIcons) do
        local item = items[i]
        ic.item = item
        if item then
            ic.icon:SetTexture(itemIcon(item))
            ic.icon:SetDesaturated(old)
            ic:SetBackdropBorderColor(qualityColor(item))
            ic:SetAlpha(old and L.oldAlpha or 1)
            ic:Show()
        else
            ic:Hide()
        end
    end
end

local function buildCard(f, refreshers)
    local card = CreateFrame("Button", nil, f, "BackdropTemplate")
    card:SetSize(L.cardW, L.cardH)
    card:SetPoint("TOPLEFT", L.card, L.cardTop)
    card:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = L.cardEdge })
    UI.Tint(card, "SetBackdropColor", "surface", 0.9)
    UI.Tint(card, "SetBackdropBorderColor", "accent", 1)
    local hl = card:CreateTexture(nil, "HIGHLIGHT")
    hl:SetPoint("TOPLEFT", L.cardEdge, -L.cardEdge)
    hl:SetPoint("BOTTOMRIGHT", -L.cardEdge, L.cardEdge)
    hl:SetColorTexture(1, 1, 1, 0.06)
    card:SetScript("OnClick", openMine)
    T.card = card
    T.cardTitle = card:CreateFontString(nil, "OVERLAY", "CRTFontLarge")
    T.cardTitle:SetPoint("TOPLEFT", L.cardPad, -L.cardPad)
    T.cardTitle:SetText(TEXT.myLoot)
    T.cardStatus = card:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    T.cardStatus:SetPoint("TOPLEFT", L.cardPad, L.statusTop)
    T.cardStatus:SetWidth(L.cardW - 2 * L.cardPad)
    T.cardStatus:SetJustifyH("LEFT")
    T.cardStatus:SetWordWrap(false)
    UI.Tint(T.cardStatus, "SetTextColor", "text")
    T.cardIcons = {}
    for i = 1, LM.MAX_ITEMS do
        T.cardIcons[i] = makeIcon(card, i)
    end
    T.cardHint = card:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    T.cardHint:SetPoint("BOTTOMLEFT", L.cardPad, L.cardPad)
    T.cardHint:SetText(TEXT.hint)
    UI.Tint(T.cardHint, "SetTextColor", "muted")
    -- while it shows, so an item whose time ran out leaves the count without a message
    local elapsed = 0
    card:SetScript("OnUpdate", function(_, dt)
        elapsed = elapsed + dt
        if elapsed >= L.redraw then
            elapsed = 0
            refreshCard()
        end
    end)
    LM:OnChange(function(what)
        if what == "incoming" and card:IsVisible() then
            refreshCard()
        end
    end)
    refreshers[#refreshers + 1] = refreshCard
end

-- Held boss loot ------------------------------------------------------------------------------------

-- One compact row of Held boss loot on row (a Button): the tick (in the next session), the icon, the item in
-- its quality colour (with TEST for a test kill's) and its item level; the tooltip adds the row's state.
function LM.HeldLootRow(row, r)
    local BL = LM.BossLoot
    if not row.check then
        row.check = CreateFrame("CheckButton", nil, row, "UICheckButtonTemplate")
        row.check:SetSize(20, 20)
        row.check:SetPoint("LEFT", 0, 0)
        UI:SkinCheckButton(row.check)
        row.check:SetScript("OnClick", function(self)
            if row.data then
                BL:SetTicked(row.data.rollID, self:GetChecked())
            end
        end)
        row.icon = row:CreateTexture(nil, "ARTWORK")
        row.icon:SetSize(18, 18)
        row.icon:SetPoint("LEFT", 22, 0)
        row.ilvl = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        row.ilvl:SetPoint("RIGHT", -4, 0)
        row.ilvl:SetWidth(30)
        row.ilvl:SetJustifyH("RIGHT")
        row.name = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        row.name:SetPoint("LEFT", row.icon, "RIGHT", 4, 0)
        row.name:SetPoint("RIGHT", row.ilvl, "LEFT", -4, 0)
        row.name:SetJustifyH("LEFT")
        row.name:SetWordWrap(false)
        local hl = row:CreateTexture(nil, "HIGHLIGHT")
        hl:SetAllPoints()
        hl:SetColorTexture(1, 1, 1, 0.06)
        row:SetScript("OnEnter", function(self)
            local d = self.data
            if d and d.link then
                UI.TooltipOwner(GameTooltip, self, "ANCHOR_RIGHT", nil, nil, "lootmaster")
                GameTooltip:SetHyperlink(d.link)
                GameTooltip:AddLine(LM.BossLootStatus(d), 1, 1, 1, true)
                GameTooltip:Show()
            end
        end)
        row:SetScript("OnLeave", hideTip)
    end
    row.data = r
    local tickable = BL.Tickable(r)
    row.check:SetChecked(r.ticked and true or false)
    row.check:SetEnabled(tickable and canLoot())
    local okI, _, _, _, _, icon = pcall(C_Item.GetItemInfoInstant, r.link)
    row.icon:SetTexture(okI and icon or 134400)
    row.icon:SetDesaturated(not tickable)
    local link = r.link
    if r.test then
        -- a sample's link made from its item string gets the item's name once the game has it
        local okL, _, gameLink = pcall(C_Item.GetItemInfo, r.itemString)
        link = ((okL and type(gameLink) == "string") and gameLink or link) .. " " .. UI.WarnText(TEXT.test)
    end
    row.name:SetText(link or "")
    row.ilvl:SetText(r.ilvl and tostring(r.ilvl) or "")
end

local function buildHeld(body, heading, refreshers)
    heading(body, L.col, L.heldTop, TEXT.held, TEXT.heldHelp)
    local count = body:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    count:SetPoint("TOPLEFT", L.col, L.heldCountTop)
    count:SetWidth(L.heldW)
    count:SetJustifyH("LEFT")
    UI.Tint(count, "SetTextColor", "muted")
    local box = CreateFrame("Frame", nil, body, "WowScrollBoxList")
    box:SetPoint("TOPLEFT", L.col, L.heldListTop)
    box:SetSize(L.heldW, L.heldRows * L.heldRowH)
    local back = CreateFrame("Frame", nil, body, "BackdropTemplate")
    back:SetPoint("TOPLEFT", box, -2, 2)
    back:SetPoint("BOTTOMRIGHT", box, 2, -2)
    back:SetFrameLevel(math.max(0, box:GetFrameLevel() - 1))
    back:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    UI.Tint(back, "SetBackdropColor", "background", 0.35)
    UI.Tint(back, "SetBackdropBorderColor", "border", 1)
    local bar = CreateFrame("EventFrame", nil, body, "MinimalScrollBar")
    UI:SkinScrollBar(bar)
    -- 8 right of the rows, as Raider Score's list (the suite's scrollbar check reads the number here)
    bar:SetPoint("TOPLEFT", box, "TOPRIGHT", 8, 0)
    bar:SetPoint("BOTTOMLEFT", box, "BOTTOMRIGHT", 8, 0)
    local v = CreateScrollBoxListLinearView()
    v:SetElementExtent(L.heldRowH)
    v:SetElementInitializer("Button", LM.HeldLootRow)
    ScrollUtil.InitScrollBoxListWithScrollBar(box, bar, v)
    T.heldList = box
    refreshers[#refreshers + 1] = function()
        local BL = LM.BossLoot
        local rows = BL and BL:Rows() or {}
        T.heldData = rows
        box:SetDataProvider(CreateDataProvider(rows), ScrollBoxConstants and ScrollBoxConstants.RetainScrollPosition)
        local bosses, items = 0, 0
        if BL then
            bosses, items = BL:Held()
        end
        count:SetText(items == 0 and TEXT.heldNone
            or TEXT.heldCount:format(bosses, bosses == 1 and TEXT.heldBoss or TEXT.heldBosses, items, items == 1 and TEXT.heldItem or TEXT.heldItems))
    end
end

-- Master loot ---------------------------------------------------------------------------------------

-- CRT Looting: the state, and the leader's button (on f: shown only to the leader, so never greyed).
local function buildLooting(f, body, refreshers)
    local looting = body:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    looting:SetPoint("TOPLEFT", L.col, L.lootingTop)
    looting:SetWidth(L.colW - (UI.HELP_SIZE or 20) - (UI.HELP_GAP or 4))
    looting:SetJustifyH("LEFT")
    UI.HelpRight(looting, TEXT.crtLooting, TEXT.crtLootingHelp)
    local toggle = UI.PanelButton(f, TEXT.turnOn, L.buttonH, function()
        if LM:LootingOn() then
            LM:ChooseLooting(false, "off")
        else
            LM:ChooseLooting(true)
        end
    end)
    toggle:SetPoint("TOPLEFT", looting, "BOTTOMLEFT", 4, -8) -- under the line, however many lines it takes
    refreshers[#refreshers + 1] = function()
        local line, on = LM:LootingStatus()
        -- on: the good colour in a Modern theme, plain in Default: Blizzard, as before themes: not a theme colour
        looting:SetText(on and UI:IsModern() and UI.GoodText(line) or line) -- not a theme colour
        local leader = IsInGroup() and UnitIsGroupLeader("player")
        toggle:SetShown(leader and true or false)
        toggle:SetText(LM:LootingOn() and TEXT.turnOff or TEXT.turnOn)
        fitWidth(toggle)
        toggle:SetEnabled(LM:LootingOn() or (LM:CanRunLooting()) or false)
    end
end

-- A button only someone with loot authority may use: greyed without it, with the reason on hover (motion
-- scripts run while disabled).
local function gatedButton(f, label, action)
    local b = UI.PanelButton(f, label, L.buttonH, function()
        if LM:CanLoot() then
            action()
        end
    end)
    b:SetMotionScriptsWhileDisabled(true)
    b:SetScript("OnEnter", function(self)
        if not LM:CanLoot() then
            UI.TooltipOwner(GameTooltip, self, "ANCHOR_RIGHT", nil, nil, "lootmaster")
            GameTooltip:SetText(self:GetText() or "")
            GameTooltip:AddLine(UI.BadText(TEXT.noAuthority), 1, 1, 1, true)
            GameTooltip:Show()
        end
    end)
    b:SetScript("OnLeave", hideTip)
    return b
end

-- The 2x2 grid: Test boss kill and Master Loot Window in the first column, Start session (N) and End
-- session in the second, which starts after the wider of the first (Start session's count changes its
-- width only).
local function buildGrid(f, refreshers)
    local tk = gatedButton(f, TEXT.testKill, function() LM:TestBossKill() end)
    local start = gatedButton(f, TEXT.start:format(0), function() LM.BossLoot:Start() end)
    local win = gatedButton(f, TEXT.window, function() LM:ShowWindow() end)
    local stop = gatedButton(f, TEXT.endSession, function() LM:AskEnd() end) -- asks first (LootMaster/EndAll.lua)
    local grid = { tk, start, win, stop }
    refreshers[#refreshers + 1] = function()
        local BL = LM.BossLoot
        start:SetText(TEXT.start:format(BL and BL:StartCount() or 0)) -- what Start session would send
        for _, b in ipairs(grid) do
            fitWidth(b)
        end
        local x2 = L.col + math.max(tk:GetWidth() or 0, win:GetWidth() or 0) + L.gridGap
        for i, b in ipairs(grid) do
            b:ClearAllPoints()
            b:SetPoint("TOPLEFT", i % 2 == 1 and L.col or x2, L.gridTop - (i > 2 and L.gridRow or 0))
        end
        local authority = canLoot()
        for _, b in ipairs(grid) do
            b:SetEnabled(authority)
        end
        start:SetEnabled(authority and BL and BL:CanStart() and true or false)
    end
end

-- The session line, and its items in the second column.
local function buildSession(body, heading, refreshers)
    local status = body:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    status:SetPoint("TOPLEFT", L.col, L.sessionTop)
    status:SetWidth(L.colW)
    status:SetJustifyH("LEFT")
    T.itemsHeading = heading(body, L.sub, L.itemsTop, TEXT.items)
    local lines = {}
    for i = 1, LM.MAX_ITEMS do
        local fs = body:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        fs:SetPoint("TOPLEFT", L.sub, L.itemsTop - 2 - i * L.itemRow)
        fs:SetWidth(L.subW)
        fs:SetJustifyH("LEFT")
        fs:SetWordWrap(false)
        lines[i] = fs
    end
    refreshers[#refreshers + 1] = function()
        local s = LM.current
        if not s then
            status:SetText(TEXT.none)
            for _, fs in ipairs(lines) do
                fs:SetText("")
            end
            return
        end
        local crt, answers = 0, 0
        for _, p in pairs(s.players) do
            if p.crt then
                crt = crt + 1
            end
        end
        for i in ipairs(s.items) do
            answers = answers + s:Answered(i)
        end
        status:SetText(string.format(TEXT.running, s.test and TEXT.testTag or "", #s.items, crt, #s.order, answers))
        for i, fs in ipairs(lines) do
            local it = s.items[i]
            if it then
                local _, link = C_Item.GetItemInfo(it.itemString or "")
                local state = TEXT.open
                if it.award then
                    local r = s:Response(it.award.response)
                    state = string.format(TEXT.awarded, Ambiguate(it.award.name, "short"), r and r.label or it.award.response)
                end
                fs:SetText((link or it.itemString) .. "  |cffaaaaaa" .. state .. "|r")
            else
                fs:SetText("")
            end
        end
    end
end

local function buildMaster(f, ctx)
    local refreshers = ctx.refreshers
    T.masterHeading = ctx.heading(f, L.col, -8, TEXT.master, TEXT.masterHelp)
    -- everything but the heading and the buttons, greyed together without loot authority
    local body = CreateFrame("Frame", nil, f)
    body:SetAllPoints()
    T.body = body
    buildLooting(f, body, refreshers)
    buildGrid(f, refreshers)
    buildSession(body, ctx.heading, refreshers)
    buildHeld(body, ctx.heading, refreshers)
    T.addHeading = ctx.heading(body, L.sub, L.addTop, TEXT.add)
    -- the slot's line: the column, less the slot, its gap and the line's (?)
    local lineW = L.subW - 36 - 8 - (UI.HELP_SIZE or 20) - (UI.HELP_GAP or 4)
    T.addSlot = LM.BuildAddItem(body, L.sub, L.addSlotTop, lineW, { allowed = canLoot, refused = TEXT.noAuthority })
    refreshers[#refreshers + 1] = function()
        body:SetAlpha(canLoot() and 1 or L.dim)
    end
end

-- Builds Tonight on its tab frame f. ctx: heading(frame, x, y, text, help) (Page.lua's, with its (?)), and
-- refreshers, the page's list of refresh functions.
function LM.BuildTonight(f, ctx)
    buildCard(f, ctx.refreshers)
    buildMaster(f, ctx)
end
