local ADDON, CRT = ...

-- The Requests page (Modules > Requests): the item slot (the shared UI.ItemDropSlot, UI/ItemSlot.lua) with how
-- many you have, Ask the raid and Close request, the status line, and the list of answers in two columns of
-- ROWS (a raid of 40 fits without scrolling): Player, Answer, Given and a Trade 1 button for each player who
-- needs one (Done once given; greyed when you have none left). The data and messages are Requests/Data.lua.
-- No settings, so no tabs. Laid out for the page area (UI.PAGE_W x UI.PAGE_H); layout numbers in L, wording in
-- TEXT. R.view keeps the parts, for the harness (CRT_Dev/Tests/run_requests.js).

local R = CRT.Requests
local LM = CRT.LootMaster
local UI = CRT.UI

local L = {
    left = 8, headTop = -8, slotTop = -36, slotW = 560, buttonsTop = -90, button = 24, buttonGap = 6,
    statusTop = -124, listTop = -150, row = 19, rows = 20, colW = 500, colGap = 16,
    name = 0, nameW = 150, answer = 156, answerW = 100, given = 262, givenW = 44, trade = 312, tradeH = 18,
}

local TEXT = {
    title = "Requests",
    help = "Ask everyone in the group who needs an item: a Vantus Rune, a flask, a feast, anything you can trade.\n\n"
        .. "Drag the item from your bags onto the slot, or shift-click it, then press Ask the raid. Raiders with CRT get a popup with Need one and No thanks. Raiders without CRT show as No answer.\n\n"
        .. "Trade 1 opens a trade with that player and puts one in it. You both still press Trade. Given counts it once the trade completes.\n\n"
        .. "Only the raid leader or an assist can ask. Out of a group you can try it on yourself. Nothing is saved: a /reload closes the request.",
    slot = "Item: drag it from your bags here, or shift-click it.",
    slotHelpTitle = "Item",
    slotHelp = "Any item you can still trade. Shift-click on a stack opens the game's split instead, so drag stacks.",
    have = "%s. You have %d.",
    refused = "%s can't be asked for: %s.",
    that = "That item",
    notInBags = "it isn't in your bags",
    ask = "Ask the raid",
    close = "Close request",
    none = "No open request.",
    notLead = "Only the raid leader or an assist can ask.",
    player = "Player", answer = "Answer", given = "Given",
    needs = "Needs one", no = "No thanks", noAnswer = "No answer",
    trade = "Trade 1", done = "Done",
}

local view -- the parts, once built
local chosen -- the item for the next ask: its link

local function skin(frame, alpha)
    frame:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    frame:SetBackdropColor(0, 0, 0, alpha or 0.5)
    frame:SetBackdropBorderColor(0.35, 0.35, 0.35, 1)
end

local function text(parent, font, x, y, width)
    local fs = parent:CreateFontString(nil, "OVERLAY", font or "CRTFontSmall")
    fs:SetPoint("TOPLEFT", x, y)
    if width then
        fs:SetWidth(width)
        fs:SetWordWrap(false)
    end
    fs:SetJustifyH("LEFT")
    return fs
end

-- A button as wide as the longer of its labels.
local function fitButton(b, labels)
    local w = 0
    for _, label in ipairs(labels) do
        b:SetText(label)
        local fs = b:GetFontString()
        w = math.max(w, fs and fs:GetStringWidth() or 0)
    end
    b:SetWidth(UI.PanelButtonWidth(w))
end

-- The item in the bag slot, picked for the next ask, when you can still trade it.
local function pick(bag, slot)
    local ok, link, why = LM.BagTradeState(bag, slot)
    if not ok then
        view.slot.Say(TEXT.refused:format(link or TEXT.that, why), false)
        return
    end
    chosen = link
    view.haveLine = nil -- say how many again, over any refusal
    view.slot.ShowItem(link)
    view.refresh()
end

local function dropped(bag, slot, link)
    if not bag then
        view.slot.Say(TEXT.refused:format(link or TEXT.that, TEXT.notInBags), false)
        return
    end
    pick(bag, slot)
end

local ANSWER = {
    [R.NEED] = { TEXT.needs, "good" },
    [R.NO] = { TEXT.no, "muted" },
}

local function paintRow(row, r, have)
    row.who = r.name
    row.name:SetText(Ambiguate(r.name, "short"))
    local a = ANSWER[r.answer] or { TEXT.noAnswer, "muted" }
    row.answer:SetText(UI.ColorText(a[1], a[2]))
    row.given:SetText(tostring(r.given))
    local needs = r.answer == R.NEED
    row.trade:SetShown(needs)
    if needs then
        local given = r.given > 0
        row.trade:SetText(given and TEXT.done or TEXT.trade)
        row.trade:SetEnabled(not given and have > 0)
    end
    for _, part in ipairs({ row.name, row.answer, row.given }) do
        part:Show()
    end
end

local function hideRow(row)
    row.who = nil
    for _, part in ipairs({ row.name, row.answer, row.given, row.trade }) do
        part:Hide()
    end
end

local function refresh()
    if not view then
        return
    end
    local open = R.open
    local item = chosen or (open and open.link)
    -- written when the item or the count changes, so a refusal stays until then
    local have = item and TEXT.have:format(item, R.Have(R.ItemString(item)))
    if have and have ~= view.haveLine then
        view.haveLine = have
        view.slot.Say(have)
    end
    local canAsk = R:CanAsk()
    view.ask:SetEnabled(canAsk and item ~= nil)
    view.close:SetEnabled(open ~= nil)
    local rows = open and R:Rows() or {}
    if open then
        view.status:SetText(R.StatusText(GetTime() - open.askedAt, R.Counts(rows)))
    else
        view.status:SetText(canAsk and TEXT.none or TEXT.notLead)
    end
    local left = open and R.Have(open.itemString) or 0
    for i, row in ipairs(view.rows) do
        if rows[i] then
            paintRow(row, rows[i], left)
        else
            hideRow(row)
        end
    end
end

local function buildRow(f, i)
    local col = math.floor((i - 1) / L.rows)
    local x = L.left + col * (L.colW + L.colGap)
    local y = L.listTop - 18 - ((i - 1) % L.rows) * L.row
    local row = {
        name = text(f, "CRTFontSmall", x + L.name, y - 3, L.nameW),
        answer = text(f, "CRTFontSmall", x + L.answer, y - 3, L.answerW),
        given = text(f, "CRTFontSmall", x + L.given, y - 3, L.givenW),
    }
    row.trade = UI.PanelButton(f, TEXT.trade, L.tradeH, function()
        if row.who then
            R:Trade(row.who)
        end
    end)
    fitButton(row.trade, { TEXT.trade, TEXT.done })
    row.trade:SetText(TEXT.trade)
    row.trade:SetPoint("TOPLEFT", x + L.trade, y)
    hideRow(row)
    return row
end

local function build(f)
    view = { rows = {} }
    R.view = view
    local head = text(f, "CRTFontNormal", L.left, L.headTop)
    head:SetText(TEXT.title)
    UI.HelpRight(head, TEXT.title, TEXT.help)
    view.slot = UI.ItemDropSlot(f, L.left, L.slotTop, L.slotW, {
        skin = skin, label = TEXT.slot, helpTitle = TEXT.slotHelpTitle, help = TEXT.slotHelp,
        onDrop = dropped, onPick = pick,
    })
    view.ask = UI.PanelButton(f, TEXT.ask, L.button, function()
        if chosen then
            R:Ask(chosen)
        end
    end)
    view.ask:SetPoint("TOPLEFT", L.left, L.buttonsTop)
    view.close = UI.PanelButton(f, TEXT.close, L.button, function()
        R:Close()
    end)
    view.close:SetPoint("LEFT", view.ask, "RIGHT", L.buttonGap, 0)
    view.status = text(f, "CRTFontSmall", L.left, L.statusTop, UI.PAGE_W - 2 * L.left)
    for col = 0, 1 do
        local x = L.left + col * (L.colW + L.colGap)
        for _, h in ipairs({ { TEXT.player, L.name, L.nameW }, { TEXT.answer, L.answer, L.answerW }, { TEXT.given, L.given, L.givenW } }) do
            local fs = text(f, "CRTFontSmall", x + h[2], L.listTop, h[3])
            fs:SetText(UI.HeadingText(h[1]))
        end
    end
    for i = 1, 2 * L.rows do
        view.rows[i] = buildRow(f, i)
    end
    view.refresh = refresh
    -- the "Asked 0:42 ago" clock, while the page shows
    local ticker
    f:SetScript("OnShow", function()
        refresh()
        if ticker then
            ticker:Cancel()
        end
        ticker = C_Timer.NewTicker(1, refresh)
    end)
    f:SetScript("OnHide", function()
        if ticker then
            ticker:Cancel()
            ticker = nil
        end
    end)
    refresh()
end

R:OnChange(function(what)
    if what == "open" and R.open then
        chosen = R.open.link or chosen
    end
    refresh()
end)

-- the bag counts change as you trade
local events = CreateFrame("Frame")
events:RegisterEvent("BAG_UPDATE_DELAYED")
events:SetScript("OnEvent", function()
    if view and view.status:IsVisible() then
        refresh()
    end
end)

UI:RegisterPage("requests", TEXT.title, build)
