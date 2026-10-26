local ADDON, CRT = ...

-- The raider window: what everyone answered and rolled for each item, read only. It is the session you
-- were sent (LM.incoming) and its copy of everyone's answers (inc.view), in the same order the looter
-- sees (the answer's weight, then the roll; Raider Score is never shown to raiders). Nothing here
-- changes anything: no menus, no awards. Open it from the popup's title bar or /crt loot answers, or
-- with your popup from My Loot (Loot Master > Tonight's card) and /crt loot (LM:OpenMyLoot, below); it
-- stays until the session ends. A pop-out made by UI.Window; its place is kept in CRTDB
-- lootmaster.answers. The /crt loot word is registered here, on the raider's side.

local LM = CRT.LootMaster
local UI = CRT.UI

local L = {
    width = 820, height = 380, minWidth = 640, minHeight = 260,
    left = LM.TAB_COLUMN + 14, headerH = 50, rowH = 22,
    headingH = 20, -- the column headings, above the rows
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
    help = "What everyone answered for each item and the roll drawn for them, in the looter's order. Only the looter gives items out; this window changes nothing.",
    choosing = "Choosing...",
    loading = "Loading...",
    timeout = "No answer",
    nocrt = "No CRT",
    auto = "auto",
    itemLevel = "Item level %d",
    given = "Given to %s",
    pastNote = "last session, read only",
    noneYet = "No loot session yet tonight.",
}

local ROLE_TEXT = { T = "Tank", H = "Heal", D = "DPS", N = "" }

local win, list, header, tabs
local ticker -- refreshes the window while it is shown
local refresh
local REFRESH_SECONDS = 1
local current = 1

-- The last session you were sent, kept after it ends (this login only, not saved), so My Loot, /crt loot
-- and this window can still show its items and results. past: the window was opened with no session
-- running, so it shows that one (or says there was none).
local last
local past = false

LM:OnChange(function(what)
    if what == "incoming" and LM.incoming then
        last = LM.incoming
        past = false
    end
end)

-- The session the window shows: the running one, else (opened with none) the last one.
local function shownSession()
    return LM.incoming or (past and last) or nil
end

local function settings()
    return CRT.db.lootmaster.answers
end

local function classColor(file)
    return file and (C_ClassColor and C_ClassColor.GetClassColor(file) or RAID_CLASS_COLORS[file]) or nil
end

local function answerText(r, view)
    if r.state == "nocrt" then
        return UI.WarnText(TEXT.nocrt)
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
            row.gear[i] = LM.GearIcon(row, COLS[6].x + (i - 1) * 20)
        end
        row.diff = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        row.diff:SetPoint("LEFT", COLS[6].x + 44, 0)
        row.me = row:CreateTexture(nil, "BACKGROUND")
        row.me:SetAllPoints()
    end
    local inc = shownSession()
    local cc = classColor(r.class)
    row.cols.name:SetText(Ambiguate(r.name, "short"))
    row.cols.name:SetTextColor(cc and cc.r or 0.85, cc and cc.g or 0.85, cc and cc.b or 0.85)
    row.cols.role:SetText(ROLE_TEXT[r.role or "N"] or "")
    row.cols.response:SetText(inc and answerText(r, inc.view) or "")
    row.cols.roll:SetText(r.roll and tostring(r.roll) or "")
    row.cols.ilvl:SetText(r.ilvl and string.format("%.0f", r.ilvl) or "")
    local item = inc and inc.items[current]
    for i, t in ipairs(row.gear) do
        LM.SetGear(t, r.gear[i], r.name == LM:Me() and item and item.itemString or nil)
    end
    if r.diff then
        row.diff:SetText(r.diff > 0 and UI.GoodText("+" .. r.diff) or (r.diff < 0 and UI.BadText(r.diff) or "0"))
    else
        row.diff:SetText("")
    end
    local accent = CRT.PALETTE.accent -- your own row, in the theme's accent
    row.me:SetColorTexture(accent[1], accent[2], accent[3], 0.16)
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
        window = win,
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
    UI.HelpRight(header.name, TEXT.title, TEXT.help)
    -- the headings and the rows clip at the same edge when the window is narrow (LM.ListArea)
    local area = LM.ListArea(c, L.left, -L.headerH - 4)
    for _, col in ipairs(COLS) do
        local h = area:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
        h:SetPoint("TOPLEFT", col.x, 0)
        h:SetText(col.title)
    end
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

-- With no session this login: the window empty, its header saying so.
local function showNone()
    win.strip:SetTitle(TEXT.title)
    win.strip:SetBadge(nil, TEXT.pastNote)
    tabs:Update({}, 1)
    header.icon:Hide()
    header.name:SetText(TEXT.noneYet)
    header.info:SetText("")
    list:SetDataProvider(CreateDataProvider({}))
end

refresh = function() -- declared above, for the ticker
    if not (win and win:IsShown()) then
        return
    end
    local inc = shownSession()
    if not (inc and inc.view) then
        showNone()
        return
    end
    header.icon:Show()
    local view = inc.view
    if not inc.items[current] then
        current = 1
    end
    win.strip:SetTitle(TEXT.title)
    -- TEST for a test, else the boss you saw killed just before (LM:RecentBoss); the note shows either way
    -- (the last session's note once it no longer runs)
    local note = inc == LM.incoming and TEXT.note or TEXT.pastNote
    win.strip:SetBadge(inc.test and TEXT.test or inc.boss, note, not inc.test and UI.TITLE_STRIP.neutral or nil)
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
-- a new theme repaints the rows and the tabs
UI:OnTheme(refresh)

-- With no session running it shows the last one, read only, or says there was none this login.
function LM:ShowAnswers()
    past = not (self.incoming and self.incoming.view)
    build()
    win:Show()
    refresh()
end

-- My Loot (Loot Master > Tonight's card, LootMaster/Tonight.lua, and /crt loot) ------------------------------

-- Whether an item of the session you were sent still waits for your answer: not given out, not answered
-- (an auto answer counts as one), and its time to answer not run out (as the popup counts it).
local function waiting(inc, index)
    local it = inc.items[index]
    local mine = inc.mine[index]
    if not it or it.award or (mine and mine.response) then
        return false
    end
    return (inc.seconds or 60) - (GetTime() - (it.shownAt or GetTime())) > 0
end

-- What My Loot shows: the number of items waiting for your answer, and the items to show (their item
-- strings): the waiting ones, or with none waiting the session's (or the last one's) items, which the card
-- dims (old true).
function LM.MyLoot()
    local inc = LM.incoming or last
    local count, items = 0, {}
    if not inc then
        return 0, items, false
    end
    if LM.incoming then
        for i = 1, LM.MAX_ITEMS do
            if waiting(inc, i) then
                count = count + 1
                items[#items + 1] = inc.items[i].itemString
            end
        end
    end
    if count > 0 then
        return count, items, false
    end
    for i = 1, LM.MAX_ITEMS do
        if inc.items[i] then
            items[#items + 1] = inc.items[i].itemString
        end
    end
    return 0, items, true
end

-- Your loot popup (Popup.lua) and All Loot Rolls together: the My Loot card and /crt loot. With no session
-- running, the last one this login, read only: its items and results in the popup (rows, no buttons) and in
-- All Loot Rolls; with none this login, All Loot Rolls empty, saying so. Returns whether one was running.
function LM:OpenMyLoot()
    if self.incoming and self.incoming.view then
        self:ShowPopup()
        self:ShowAnswers()
        return true
    end
    if last and self.ShowLastPopup then
        self:ShowLastPopup(last)
    end
    self:ShowAnswers()
    return false
end

-- /crt loot: your loot; /crt loot <word> is the leader's (LM:Command, LootMaster/Test.lua) (CRT_Core/Slash.lua's
-- registry).
if CRT.Slash then
    CRT.Slash:Register("loot", {
        run = function(rest, msg)
            if rest == "" then
                LM:OpenMyLoot()
                return true
            end
            return LM.Command ~= nil and LM:Command(msg)
        end,
        help = {
            "[/crt loot] - open your loot popup and All Loot Rolls",
            "[/crt loot test] - try Loot Master with sample items: the Master Loot Window for you, the popup for everyone with CRT ([window], [popup], [end])",
            "[/crt loot settings] - open the Loot Master page ([boss] opens Boss loot)",
        },
    })
end
