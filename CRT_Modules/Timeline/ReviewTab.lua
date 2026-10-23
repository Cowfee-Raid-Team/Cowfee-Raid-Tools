local ADDON, CRT = ...

-- The Timeline page's Review tab controls: the Difficulty and Boss dropdowns, the read-only label of the
-- ability timeline shown (no Pull dropdown: the pulls are picked on Recent pulls), the Order dropdown,
-- the recording and overlay checkboxes, the zoom slider, the Recent pulls list and the timeline view
-- itself. The page builds it with Build(parent, ctx) and gets back { view, holder, recent, emptyLabel,
-- unnamedHelp, shownLabel, controls }, the controls being everything it must call refresh() on. The
-- page keeps the choices (difficulty, boss, the pull picked); ctx gives this file group(), boss() and
-- the setters selectGroup(key), selectBoss(key), selectOrder(key), togglePull(pullID) and
-- movePhase(index, seconds), plus bossOptions, orderOptions, order(), hasOrder(), shownLabel(),
-- hasPull(), pullLabel, showingReference() and groups (the label of each difficulty group).

local Timeline = CRT.Timeline
local View = CRT.TimelineView
local ReferencePage = CRT.TimelineReferencePage
local UI = CRT.UI

-- The span sliders show minutes and seconds (View.Format), so a typed number is minutes.
local function toMinutes(seconds)
    return seconds / 60
end

local function fromMinutes(minutes)
    return minutes * 60
end

local ReviewTab = {}
CRT.TimelineReviewTab = ReviewTab

local RECENT_W = 150
ReviewTab.RECENT_W = RECENT_W

local EMPTY_ALL = "No boss pulls recorded yet"

local function settings()
    return Timeline:Settings()
end

function ReviewTab.Build(f, ctx)
    local tab = { controls = {} }
    local controls = tab.controls

    -- A checkbox with its text on the right. get() is the setting, set(on) saves it.
    local function checkbox(x, y, text, get, set)
        local cb = CreateFrame("CheckButton", nil, f, "UICheckButtonTemplate")
        cb:SetSize(24, 24)
        cb:SetPoint("TOPLEFT", f, "TOPLEFT", x - 4, y)
        cb.Label = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        cb.Label:SetPoint("LEFT", cb, "RIGHT", 2, 0)
        cb.Label:SetJustifyH("LEFT")
        cb.Label:SetText(text)
        cb:SetScript("OnClick", function(self)
            set(self:GetChecked() and true or false)
        end)
        cb.refresh = function()
            cb:SetChecked(get() and true or false)
        end
        controls[#controls + 1] = cb
        return cb
    end

    local function place(row, x, y)
        row:SetPoint("TOPLEFT", f, "TOPLEFT", x, y)
        controls[#controls + 1] = row
        return row
    end

    -- Difficulty first: it decides what the Boss list and Recent pulls hold.
    local difficulty = place(UI.Dropdown(f, "Difficulty", {
        options = {
            { key = "nh", label = ctx.groups.nh },
            { key = "mythic", label = ctx.groups.mythic },
        },
        labelWidth = 52,
        width = 110,
        get = ctx.group,
        set = ctx.selectGroup,
    }), 8, -4)
    UI.HelpRight(difficulty, "Difficulty", "Normal and Heroic share one schedule, so they are one view; Mythic is the other. The boss list, pulls and ability timelines show only the difficulty picked here. Mythic-only rows never show on Normal/Heroic.")
    place(UI.Dropdown(f, "Boss", {
        options = ctx.bossOptions,
        labelWidth = 40,
        width = 160,
        get = ctx.boss,
        set = ctx.selectBoss,
    }), 200, -4)
    -- The ability timeline shown (Timeline:ReferenceFor picks it; the Advanced tab's In use picks
    -- another): read-only, where a Pull dropdown once was. The pulls are picked on Recent pulls.
    local LABEL_X, LABEL_MAX = 412, 220
    local shown = f:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    shown:SetPoint("TOPLEFT", f, "TOPLEFT", LABEL_X, -9)
    shown:SetWidth(LABEL_MAX)
    shown:SetJustifyH("LEFT")
    shown:SetWordWrap(false)
    controls[#controls + 1] = shown -- its refresh is set below, with Order's place
    tab.shownLabel = shown

    -- The unnamed casts of a recorded pull, after the label; a boss with an ability timeline has none
    tab.unnamedHelp = UI.HelpRight(shown, "Unnamed casts", function()
        local text = "Some boss casts come from the game without a readable spell, so they are drawn in the \"Boss casts (unnamed)\" row with only their time."
        if tab.view and tab.view:CastCount() == 0 and ctx.hasPull() and not ctx.showingReference() then
            text = text .. "\n\nThis pull has no casts at all. The game's Boss Timeline option may be off; check it in the game's options."
        end
        return text
    end)

    -- How far the label's text reaches, (?) included when it shows: where Order starts.
    local function labelEnd()
        local w = shown.GetStringWidth and shown:GetStringWidth() or nil
        w = math.min(LABEL_MAX, type(w) == "number" and w > 0 and w or LABEL_MAX)
        local help = tab.unnamedHelp and tab.unnamedHelp:IsShown()
        return LABEL_X + w + (help and (UI.HELP_GAP + UI.HELP_SIZE) or 0) + 16
    end

    -- Order: shown only for an ability timeline with an Order line. It sits right after the label (and the
    -- (?)) when the frame is wide enough (the main panel's page, UI.PAGE_W, is), else on the third row after
    -- Time visible, clear of the second row's (?) icons and of Share note at the right.
    local order = UI.Dropdown(f, "Order", {
        options = ctx.orderOptions,
        labelWidth = 40,
        width = 140,
        get = ctx.order,
        set = ctx.selectOrder,
    })
    local orderHelp = UI.HelpRight(order, "Order", "The order your raid takes this boss's parts in, such as which turtle empowers first. Each part's abilities move to the time it now has. The choice is kept for this boss and difficulty.")
    -- docked: after Time visible (its label, bar and value end near 300)
    local ORDER_W, NARROW_X, NARROW_Y = 40 + 5 + 140, 320, -64
    ReviewTab.ORDER_W = ORDER_W
    local function placeOrder()
        local x = labelEnd()
        local wide = (f:GetWidth() or 0) >= x + ORDER_W + UI.HELP_GAP + UI.HELP_SIZE + 8
        order:ClearAllPoints()
        order:SetPoint("TOPLEFT", f, "TOPLEFT", wide and x or NARROW_X, wide and -4 or NARROW_Y)
        local on = ctx.hasOrder()
        order:SetShown(on)
        orderHelp:SetShown(on)
    end
    tab.placeOrder = placeOrder
    -- the label and its (?) first, then Order beside them
    shown.refresh = function()
        shown:SetText(ctx.shownLabel() or "")
        tab.unnamedHelp:SetShown(not ctx.showingReference() and ctx.hasPull())
    end
    local orderRefresh = order.refresh
    order.refresh = function()
        placeOrder()
        orderRefresh()
    end
    controls[#controls + 1] = order
    if f.HookScript then
        f:HookScript("OnSizeChanged", placeOrder)
    end

    checkbox(8, -38, "Record every pull", function()
        return settings().record
    end, function(on)
        Timeline:Set("record", on)
    end)
    local overlay = checkbox(220, -38, "Deaths from recent pulls", function()
        return settings().overlayOn
    end, function(on)
        Timeline:Set("overlayOn", on)
    end)
    overlay.Label:SetWidth(170)
    UI.HelpRight(overlay.Label, "Deaths from recent pulls", "With no pull picked on the right, draws the deaths of this boss's recent pulls on the ability timeline, faded by how old they are, so deaths that repeat stand out. Pick a pull on the right to see only that pull's deaths; click it again to go back to all of them. How many pulls it covers is on the Settings tab.")

    -- Zoom: the mouse wheel writes span without telling the page, so refresh re-reads it here.
    place(UI.Slider(f, "Time visible", {
        min = 60, max = 600, step = 30, format = View.Format, toDisplay = toMinutes, fromDisplay = fromMinutes,
        labelWidth = 80, width = 160,
        get = function()
            return settings().span
        end,
        set = function(value)
            Timeline:Set("span", value)
            tab.view:SetSpan(value)
        end,
    }), 8, -64)

    tab.recent = ReferencePage.Recent(f, RECENT_W, ctx.pullLabel, ctx.togglePull)

    tab.holder = CreateFrame("Frame", nil, f)
    tab.holder:SetPoint("TOPLEFT", f, "TOPLEFT", 8, -96)
    tab.holder:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -8, 8)
    tab.view = View.Create(tab.holder)
    tab.view.onPhaseMoved = ctx.movePhase
    tab.emptyLabel = tab.holder:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    tab.emptyLabel:SetPoint("CENTER", tab.holder, "CENTER")
    tab.emptyLabel:SetText(EMPTY_ALL)
    return tab
end
