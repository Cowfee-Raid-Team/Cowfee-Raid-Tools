local ADDON, CRT = ...

-- The Debuffs tab's "Ignore these debuffs" section, under the panel settings (Page.lua builds it): a
-- spell ID box that shows the game's name and icon for what you type, with Add; your own list with
-- Remove (Debuffs:AddIgnored, Debuffs:RemoveIgnored); and the built-in list (Debuffs.EXCLUDED_SPELLS),
-- greyed. Every change goes through Debuffs, which refreshes the panel at once and this section with it.
-- A spell the game won't let addons hide on you (Debuffs.CanHide) can still be added, and is marked.

local Debuffs = CRT.Debuffs
local UI = CRT.UI

local Ignore = {}
CRT.DebuffsIgnore = Ignore

-- QoL/Page.lua's tab frames start this far under the page's top, so the tab is UI.PAGE_H less this
-- tall (the debuffs suite checks the two agree).
Ignore.TAB_TOP = 66
local ROW_H = 22
local ICON = 18
local LIST_W = 400
local BUILT_IN_X = 440 -- Page.lua's LOOK_X: the right column
local BOTTOM_GAP = 6

local TEXT = {
    title = "Ignore these debuffs",
    help = "Debuffs on these lists don't show on the debuff panel.\n\nType a spell ID and press Add, or right-click a debuff on the panel out of combat.\n\nThe game only lets addons hide some debuffs on you, such as Exhaustion and other lockouts. For any other it says so, and the debuff still shows. Hide debuffs longer than can still leave out a long one.\n\nThe game's boss debuff slots (the second row) can't be filtered at all.",
    spellID = "Spell ID",
    add = "Add",
    remove = "Remove",
    noSpell = "No spell with that ID",
    yours = "Yours",
    builtIn = "Built in (always ignored)",
    none = "None yet.",
    more = "and %d more",
    canHide = "Add hides it on the panel.",
    cantHide = "The game won't let addons hide this one on you, so it still shows.",
    stillShows = "still shows",
    added = "Added %s.",
}
Ignore.TEXT = TEXT

local view = {}
Ignore.view = view
local status = { text = "", key = nil } -- the line under the box, and its palette colour

local function makeButton(parent, text)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontNormal)
    b:SetHighlightFontObject(CRTFontHighlight)
    b:SetDisabledFontObject(CRTFontDisable)
    b:SetText(text)
    local fs = b:GetFontString()
    local w = fs and fs:GetStringWidth() or 0
    b:SetSize(math.max(40, math.ceil(w) + 24), 22)
    return b
end

local function setStatus(text, key)
    status.text, status.key = text or "", key
    UI.ThemedText(view.status, function()
        if status.key then
            return UI.ColorText(status.text, status.key)
        end
        return status.text
    end)
end

-- The game's name and icon for what is typed, and whether Add will hide it.
local function preview()
    local text = view.edit:GetText() or ""
    local id = Debuffs.SpellID(text)
    local name, icon = Debuffs.SpellInfo(id)
    view.icon:SetTexture(icon or nil)
    view.icon:SetShown(icon ~= nil)
    if not id then
        view.name:SetText("")
        setStatus("")
    elseif not name then
        view.name:SetText(UI.BadText(TEXT.noSpell))
        setStatus("")
    else
        view.name:SetText(name)
        if Debuffs.CanHide(id) == false then
            setStatus(TEXT.cantHide, "warn")
        else
            setStatus(TEXT.canHide)
        end
    end
end

local function add()
    local id, err = Debuffs:AddIgnored(view.edit:GetText())
    if id then
        view.edit:SetText("")
        view.edit:ClearFocus()
        preview()
        setStatus(format(TEXT.added, Debuffs.SpellInfo(id) or id))
    else
        setStatus(err, "bad")
    end
end

-- A row: icon, name and spell ID, with a tooltip saying whether the game hides it. Remove on your own
-- rows; the built-in ones are greyed.
local function makeRow(parent, removable)
    local row = CreateFrame("Frame", nil, parent)
    row:SetHeight(ROW_H)
    row.icon = row:CreateTexture(nil, "ARTWORK")
    row.icon:SetSize(ICON, ICON)
    row.icon:SetPoint("LEFT", 2, 0)
    row.icon:SetTexCoord(0.07, 0.93, 0.07, 0.93)
    row.name = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    row.name:SetPoint("LEFT", row.icon, "RIGHT", 6, 0)
    row.name:SetJustifyH("LEFT")
    row.name:SetWordWrap(false)
    if removable then
        row.remove = makeButton(row, TEXT.remove)
        row.remove:SetHeight(18)
        row.remove:SetPoint("RIGHT", -2, 0)
        row.remove:SetScript("OnClick", function()
            Debuffs:RemoveIgnored(row.id)
        end)
        row.name:SetPoint("RIGHT", row.remove, "LEFT", -6, 0)
    else
        row.name:SetPoint("RIGHT", -2, 0)
    end
    row:SetScript("OnEnter", function(self)
        UI.TooltipOwner(GameTooltip, self, "ANCHOR_RIGHT")
        GameTooltip:SetText(self.title or "", 1, 1, 1)
        GameTooltip:AddLine(format("%s %d", TEXT.spellID, self.id or 0), 0.85, 0.85, 0.85)
        if self.cantHide then
            GameTooltip:AddLine(TEXT.cantHide, 0.85, 0.85, 0.85, true)
        end
        GameTooltip:Show()
    end)
    row:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    return row
end

local function fillRow(row, id, greyed)
    local name, icon = Debuffs.SpellInfo(id)
    name = name or ("Spell " .. id)
    local cantHide = Debuffs.CanHide(id) == false
    row.id, row.title, row.cantHide = id, name, cantHide
    row.icon:SetTexture(icon or "Interface\\Icons\\INV_Misc_QuestionMark")
    row.icon:SetDesaturated(greyed and true or false)
    row.icon:SetAlpha(greyed and 0.6 or 1)
    local text = format("%s  |cff999999%d|r", name, id)
    if cantHide and not greyed then
        text = text .. "  " .. UI.WarnText(TEXT.stillShows)
    end
    row.name:SetText(text)
    local c = greyed and 0.5 or 1
    row.name:SetTextColor(c, c, c)
    row:Show()
end

function Ignore.Refresh()
    if not view.edit then
        return
    end
    -- yours, in the scrolling list
    local ids = Debuffs:IgnoredList()
    for i, id in ipairs(ids) do
        local row = view.rows[i]
        if not row then
            row = makeRow(view.child, true)
            row:SetPoint("TOPLEFT", 0, -(i - 1) * ROW_H)
            row:SetPoint("RIGHT", view.child, "RIGHT", 0, 0)
            view.rows[i] = row
        end
        fillRow(row, id, false)
    end
    for i = #ids + 1, #view.rows do
        view.rows[i]:Hide()
    end
    view.child:SetSize(LIST_W - UI.ScrollGutter(), math.max(1, #ids * ROW_H))
    view.none:SetShown(#ids == 0)
    -- built in: as many rows as fit, the last one "and N more" when they don't all fit
    local built = Debuffs:BuiltInList()
    local fit = #view.builtInRows
    local shown = #built > fit and fit - 1 or #built
    for i, row in ipairs(view.builtInRows) do
        if i <= shown then
            fillRow(row, built[i], true)
        else
            row:Hide()
        end
    end
    view.more.rest = {}
    for i = shown + 1, #built do
        view.more.rest[#view.more.rest + 1] = built[i]
    end
    view.more:SetShown(#view.more.rest > 0)
    view.moreText:SetText(format(TEXT.more, #view.more.rest))
end

-- Builds the section from y = top down to the bottom of the tab.
function Ignore.Build(pf, top)
    local title = pf:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    title:SetPoint("TOPLEFT", 8, top)
    title:SetText(TEXT.title)
    view.title = title
    view.help = UI.HelpRight(title, TEXT.title, TEXT.help)

    -- Spell ID [box] [icon] name   Add
    local y = top - 26
    local idLabel = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    idLabel:SetPoint("TOPLEFT", 10, y - 4)
    idLabel:SetText(TEXT.spellID)
    local edit = CreateFrame("EditBox", nil, pf, "InputBoxTemplate")
    edit:SetAutoFocus(false)
    edit:SetFontObject(CRTFontHighlight)
    edit:SetNumeric(true)
    edit:SetMaxLetters(10)
    edit:SetSize(90, 20)
    edit:SetPoint("LEFT", idLabel, "RIGHT", 10, 0)
    edit:SetScript("OnTextChanged", preview)
    edit:SetScript("OnEnterPressed", add)
    edit:SetScript("OnEscapePressed", function(self)
        self:ClearFocus()
    end)
    view.edit = edit
    local icon = pf:CreateTexture(nil, "ARTWORK")
    icon:SetSize(20, 20)
    icon:SetPoint("LEFT", edit, "RIGHT", 8, 0)
    icon:SetTexCoord(0.07, 0.93, 0.07, 0.93)
    icon:Hide()
    view.icon = icon
    local name = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    name:SetPoint("LEFT", icon, "RIGHT", 6, 0)
    name:SetWidth(220)
    name:SetJustifyH("LEFT")
    name:SetWordWrap(false)
    view.name = name
    local addButton = makeButton(pf, TEXT.add)
    addButton:SetPoint("LEFT", name, "RIGHT", 8, 0)
    addButton:SetScript("OnClick", add)
    view.add = addButton

    local statusLine = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    statusLine:SetPoint("TOPLEFT", 10, y - 26)
    statusLine:SetWidth(BUILT_IN_X + LIST_W - 10)
    statusLine:SetJustifyH("LEFT")
    view.status = statusLine
    setStatus("")

    -- the two lists, side by side, down to the bottom of the tab
    local headY = y - 48
    local listTop = headY - 18
    local bottom = -(UI.PAGE_H - Ignore.TAB_TOP) + BOTTOM_GAP
    local listH = listTop - bottom
    for _, h in ipairs({ { 8, TEXT.yours }, { BUILT_IN_X, TEXT.builtIn } }) do
        local head = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        head:SetPoint("TOPLEFT", h[1], headY)
        UI.ThemedText(head, function()
            return UI.HeadingText(h[2])
        end)
    end

    local box = CreateFrame("Frame", nil, pf)
    box:SetPoint("TOPLEFT", 8, listTop)
    box:SetSize(LIST_W, listH)
    view.yoursBox = box
    local scroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsDebuffIgnoreScroll", box, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(scroll.ScrollBar)
    scroll:SetPoint("TOPLEFT", 0, 0)
    scroll:SetPoint("BOTTOMRIGHT", -UI.ScrollGutter(), 0)
    local child = CreateFrame("Frame", nil, scroll)
    child:SetSize(LIST_W - UI.ScrollGutter(), 1)
    scroll:SetScrollChild(child)
    view.scroll, view.child, view.rows = scroll, child, {}
    local none = box:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    none:SetPoint("TOPLEFT", 4, -4)
    none:SetText(TEXT.none)
    none:SetTextColor(0.6, 0.6, 0.6)
    view.none = none

    local builtBox = CreateFrame("Frame", nil, pf)
    builtBox:SetPoint("TOPLEFT", BUILT_IN_X, listTop)
    builtBox:SetSize(LIST_W, listH)
    view.builtInBox = builtBox
    view.builtInRows = {}
    for i = 1, math.max(1, math.floor(listH / ROW_H)) do
        local row = makeRow(builtBox, false)
        row:SetPoint("TOPLEFT", 0, -(i - 1) * ROW_H)
        row:SetPoint("RIGHT", builtBox, "RIGHT", 0, 0)
        row:Hide()
        view.builtInRows[i] = row
    end
    -- "and N more", over the last row, with the rest in its tooltip
    local more = CreateFrame("Frame", nil, builtBox)
    more:SetHeight(ROW_H)
    more:SetPoint("TOPLEFT", 0, -(#view.builtInRows - 1) * ROW_H)
    more:SetPoint("RIGHT", builtBox, "RIGHT", 0, 0)
    local moreText = more:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    moreText:SetPoint("LEFT", 2 + ICON + 6, 0)
    moreText:SetTextColor(0.5, 0.5, 0.5)
    more:SetScript("OnEnter", function(self)
        UI.TooltipOwner(GameTooltip, self, "ANCHOR_RIGHT")
        GameTooltip:SetText(TEXT.builtIn, 1, 1, 1)
        for _, id in ipairs(self.rest or {}) do
            GameTooltip:AddLine(format("%s  %d", Debuffs.SpellInfo(id) or ("Spell " .. id), id), 0.85, 0.85, 0.85)
        end
        GameTooltip:Show()
    end)
    more:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    more:Hide()
    view.more, view.moreText = more, moreText

    Ignore.Refresh()
end
