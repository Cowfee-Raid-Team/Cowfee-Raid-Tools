local ADDON, CRT = ...

-- What UI/Placement.lua draws: the Placement panel a movable element's gear opens, the outline around the selected
-- element with its x, y at its top left, and the dashed guides a drag snaps to.
--
-- The panel (UI.Window, a dialog next to the element): X and Y (its centre's distance from its anchor's centre;
-- Enter applies, the up and down arrows step 1, Shift 10), Centre horizontally and Centre vertically, Anchor to
-- (Screen or another CRT element; a choice that would loop is greyed out) with Pick on screen, then Reset and Done.

local UI = CRT.UI
local P = UI.Placement

local TEXT = {
    title = "Placement: %s",
    x = "X",
    y = "Y",
    centreH = "Centre horizontally",
    centreV = "Centre vertically",
    anchor = "Anchor to",
    screen = "Screen",
    pick = "Pick on screen",
    picking = "Click another element's box. Esc cancels.",
    reset = "Reset",
    done = "Done",
    help = "X and Y are how far its centre is from the centre of what it is anchored to, in pixels.\n\n"
        .. "Click its box to select it: the arrow keys move it 1 pixel, Shift and an arrow 10. Esc lets go.\n\n"
        .. "Dragging snaps to the dashed lines within 6 pixels. Hold Shift while dragging to place it freely.",
    anchorHelp = "It keeps its distance from that element and moves with it.\n\n"
        .. "Greyed out: that element is anchored to this one, so it would go round in a loop.",
    fixedHelp = "This one holds the game's own buttons, so it always sits on the screen.",
}
P.PANEL_TEXT = TEXT

local L = {
    width = 380, height = 206,
    box = 56, boxH = 20, labelW = 14, gap = 6, -- X and Y
    rowY = { -6, -38, -72, -108 }, -- the boxes, the centre buttons, Anchor to, the picking line
    button = 22,
    dropLabel = 64, drop = 150,
    side = 12, -- the panel's gap from the element
    outline = 2, outlineOut = 3, -- the selection outline's thickness, and how far outside the element
    dash = 8, dashGap = 6, -- the guides
}
P.PANEL_LAYOUT = L

local panel -- the window, made the first time it opens
local shown -- the element it shows

-- The outline and its x, y ----------------------------------------------------------------------

local outline

local function makeOutline()
    outline = CreateFrame("Frame", nil, UIParent)
    outline:SetFrameStrata("TOOLTIP")
    outline:EnableMouse(false)
    local function edge(from, to, width, height)
        local t = outline:CreateTexture(nil, "OVERLAY")
        UI.Tint(t, "SetColorTexture", "heading")
        t:SetPoint(from)
        t:SetPoint(to)
        if width then
            t:SetWidth(width)
        else
            t:SetHeight(height)
        end
    end
    edge("TOPLEFT", "TOPRIGHT", nil, L.outline)
    edge("BOTTOMLEFT", "BOTTOMRIGHT", nil, L.outline)
    edge("TOPLEFT", "BOTTOMLEFT", L.outline)
    edge("TOPRIGHT", "BOTTOMRIGHT", L.outline)
    local tag = CreateFrame("Frame", nil, outline, "BackdropTemplate")
    tag:SetPoint("TOPRIGHT", outline, "TOPLEFT", -4, 0)
    tag:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8" })
    UI.Tint(tag, "SetBackdropColor", "surface", 0.85)
    tag.text = tag:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    tag.text:SetPoint("CENTER")
    UI.Tint(tag.text, "SetTextColor", "heading")
    outline.tag = tag
    outline:Hide()
end

-- The outline goes round the selected element (or the one being dragged), with its x, y at its top left.
local function drawOutline()
    local el = P.Dragging() or P.selected
    if not (el and el.frame) then
        if outline then
            outline:Hide()
        end
        return
    end
    if not outline then
        makeOutline()
    end
    outline:ClearAllPoints()
    outline:SetPoint("TOPLEFT", el.frame, "TOPLEFT", -L.outlineOut, L.outlineOut)
    outline:SetPoint("BOTTOMRIGHT", el.frame, "BOTTOMRIGHT", L.outlineOut, -L.outlineOut)
    local x, y = el:Offset()
    outline.tag.text:SetText(x and (x .. ", " .. y) or "")
    outline.tag:SetSize((outline.tag.text:GetStringWidth() or 0) + 8, 16)
    outline:Show()
    P.outline = outline
end

-- The guides ----------------------------------------------------------------------------------

local guides = {} -- [n] = a dashed line, made when first needed

local function guide(n)
    local g = guides[n]
    if not g then
        g = CreateFrame("Frame", nil, UIParent)
        g:SetFrameStrata("TOOLTIP")
        g:EnableMouse(false)
        g.dashes = {}
        guides[n] = g
    end
    return g
end

-- A dashed line across the screen, vertical at x or horizontal at y (UIParent units from its bottom left), in a
-- palette colour. Drawn again only when it changed.
local function drawLine(n, vertical, at, length, key, alpha)
    local g = guide(n)
    local drawnKey = (vertical and "v" or "h") .. math.floor(at + 0.5) .. ":" .. math.floor(length) .. ":" .. key
    if g.drawnKey ~= drawnKey then
        g.drawnKey = drawnKey
        g:ClearAllPoints()
        if vertical then
            g:SetSize(1, length)
            g:SetPoint("BOTTOM", UIParent, "BOTTOMLEFT", at, 0)
        else
            g:SetSize(length, 1)
            g:SetPoint("LEFT", UIParent, "BOTTOMLEFT", 0, at)
        end
        local step = L.dash + L.dashGap
        local count = math.ceil(length / step)
        for i = 1, count do
            local t = g.dashes[i]
            if not t then
                t = g:CreateTexture(nil, "OVERLAY")
                g.dashes[i] = t
            end
            t:ClearAllPoints()
            if vertical then
                t:SetSize(1, L.dash)
                t:SetPoint("BOTTOM", g, "BOTTOM", 0, (i - 1) * step)
            else
                t:SetSize(L.dash, 1)
                t:SetPoint("LEFT", g, "LEFT", (i - 1) * step, 0)
            end
            t:SetColorTexture(UI.Color(key, alpha))
            t:Show()
        end
        for i = count + 1, #g.dashes do
            g.dashes[i]:Hide()
        end
    end
    g:Show()
end

function P.HideGuides()
    for _, g in ipairs(guides) do
        g:Hide()
    end
    drawOutline()
end

-- While a drag goes: every guide of el, the one it snapped to (gx, gy) in the heading colour, the rest faint.
function P.DrawGuides(el, gx, gy)
    local ux, uy, sw, sh = P.Rect(UIParent)
    if not (ux and sw > 0) then
        return
    end
    local left, bottom = ux - sw / 2, uy - sh / 2
    local xs, ys = el:Guides()
    local n = 0
    for _, x in ipairs(xs) do
        n = n + 1
        drawLine(n, true, x - left, sh, x == gx and "heading" or "accent", x == gx and 1 or 0.45)
    end
    for _, y in ipairs(ys) do
        n = n + 1
        drawLine(n, false, y - bottom, sw, y == gy and "heading" or "accent", y == gy and 1 or 0.45)
    end
    for i = n + 1, #guides do
        guides[i]:Hide()
    end
    drawOutline()
end

-- The panel -----------------------------------------------------------------------------------

local function editBox(parent, label, x, y)
    local text = parent:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    text:SetPoint("TOPLEFT", parent, "TOPLEFT", x, y - 4)
    text:SetText(label)
    local e = CreateFrame("EditBox", nil, parent, "InputBoxTemplate")
    e:SetSize(L.box, L.boxH)
    e:SetPoint("TOPLEFT", parent, "TOPLEFT", x + L.labelW + L.gap, y)
    e:SetAutoFocus(false)
    e:SetMaxLetters(6)
    UI:SkinEditBox(e)
    return e
end

-- The boxes and the list show the element's place again (a box being typed in is left alone).
local function refresh()
    local f = panel
    if not (f and shown and f:IsShown()) then
        return
    end
    local x, y = shown:Offset()
    for box, v in pairs({ [f.xBox] = x, [f.yBox] = y }) do
        if not box:HasFocus() then
            box:SetText(v and tostring(v) or "")
        end
    end
    f.anchorRow.refresh()
    f.picking:SetShown(P.picking == shown)
    local fixed = shown.spec.canAnchor == false
    f.pick:SetEnabled(not fixed)
end

-- Applies what the boxes say; a box that isn't a number goes back to the element's place.
local function applyBoxes()
    local x, y = tonumber(panel.xBox:GetText()), tonumber(panel.yBox:GetText())
    if shown and x and y then
        shown:SetOffset(x, y)
    end
    panel.xBox:ClearFocus()
    panel.yBox:ClearFocus()
    refresh()
end

-- Up and down in a box step its number, Shift by 10, and apply it.
local function stepBox(box, key)
    if key ~= "UP" and key ~= "DOWN" then
        return
    end
    local x, y
    if shown then
        x, y = shown:Offset()
    end
    if not x then
        return
    end
    local step = (IsShiftKeyDown and IsShiftKeyDown()) and P.NUDGE_BIG or P.NUDGE
    step = key == "UP" and step or -step
    -- only this box steps, from its own number (else the element's); the other box's half-typed text is left alone
    local own = tonumber(box:GetText())
    if box == panel.xBox then
        x = (own or x) + step
    else
        y = (own or y) + step
    end
    shown:SetOffset(x, y)
    box:SetText(tostring(box == panel.xBox and x or y))
end

local function wireBox(box)
    box:SetScript("OnEnterPressed", applyBoxes)
    box:SetScript("OnEscapePressed", function(b)
        b:ClearFocus()
        refresh()
    end)
    box:SetScript("OnEditFocusLost", refresh)
    box:SetScript("OnKeyDown", stepBox)
end

-- The Anchor to list: the screen, then every other element by name; one that can't be used is greyed out.
local function anchorOptions()
    local out = { { key = "screen", label = TEXT.screen } }
    local others = {}
    for _, el in ipairs(P.Elements()) do
        if shown and el ~= shown and el.spec.target ~= false and (el.frame or el.spec.build) then
            others[#others + 1] = el
        end
    end
    table.sort(others, function(a, b)
        return a.title < b.title
    end)
    for _, el in ipairs(others) do
        out[#out + 1] = { key = el.key, label = el.title, disabled = not shown:CanAnchorTo(el.key) }
    end
    return out
end

local function build()
    local f = UI.Window("CowfeeRaidToolsPlacement", { kind = "dialog", title = "", width = L.width, height = L.height })
    f.strip:SetHelp(P.TEXT.placement, TEXT.help)
    local c = f.content
    f.xBox = editBox(c, TEXT.x, 0, L.rowY[1])
    f.yBox = editBox(c, TEXT.y, L.labelW + L.gap + L.box + L.gap * 3, L.rowY[1])
    wireBox(f.xBox)
    wireBox(f.yBox)

    f.centreH = UI.PanelButton(c, TEXT.centreH, L.button, function()
        if shown then
            shown:CentreH()
        end
    end)
    f.centreH:SetPoint("TOPLEFT", c, "TOPLEFT", 0, L.rowY[2])
    f.centreV = UI.PanelButton(c, TEXT.centreV, L.button, function()
        if shown then
            shown:CentreV()
        end
    end)
    f.centreV:SetPoint("LEFT", f.centreH, "RIGHT", L.gap, 0)

    f.anchorRow = UI.Dropdown(c, TEXT.anchor, {
        labelWidth = L.dropLabel, width = L.drop,
        options = anchorOptions,
        get = function()
            return shown and shown:LiveAnchor() or "screen"
        end,
        set = function(key)
            if shown then
                shown:SetAnchor(key ~= "screen" and key or nil)
            end
        end,
        enabledIf = function()
            return shown ~= nil and shown.spec.canAnchor ~= false
        end,
    })
    f.anchorRow:SetPoint("TOPLEFT", c, "TOPLEFT", 0, L.rowY[3])
    f.pick = UI.PanelButton(c, TEXT.pick, L.button, function()
        if shown then
            shown:StartPick()
        end
    end)
    f.pick:SetPoint("LEFT", f.anchorRow, "RIGHT", L.gap, 0)
    -- the (?) after the row's last control: why a choice is greyed out, or why this one has none
    f.anchorHelp = UI.HelpRight(f.pick, TEXT.anchor, function()
        return shown and shown.spec.canAnchor == false and TEXT.fixedHelp or TEXT.anchorHelp
    end, { parent = c })

    f.picking = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    f.picking:SetPoint("TOPLEFT", c, "TOPLEFT", 0, L.rowY[4])
    f.picking:SetText(TEXT.picking)
    UI.Tint(f.picking, "SetTextColor", "heading")
    f.picking:Hide()

    f.done = UI.PanelButton(c, TEXT.done, L.button, function()
        P.ClosePanel()
        P.Deselect()
    end)
    f.done:SetPoint("BOTTOMRIGHT", c, "BOTTOMRIGHT", 0, 0)
    f.reset = UI.PanelButton(c, TEXT.reset, L.button, function()
        if shown then
            shown:Reset()
        end
    end)
    f.reset:SetPoint("RIGHT", f.done, "LEFT", -L.gap, 0)

    -- closing it (Done, its X, Escape) lets go of the element and its keys
    f:SetScript("OnHide", function()
        shown = nil
        P.Deselect()
    end)
    f.refresh = refresh
    return f
end

-- Opens the panel on an element, beside it on the side with more room. Refused in combat.
function P.OpenPanel(el)
    if InCombatLockdown and InCombatLockdown() then
        return P.Refuse()
    end
    if not (el and el.frame and el:Editable()) then
        return false
    end
    panel = panel or build()
    shown = el
    P.Select(el)
    panel.strip:SetTitle(string.format(TEXT.title, el.title))
    local dx = el:ScreenOffset()
    panel:ClearAllPoints()
    if dx and dx > 0 then
        panel:SetPoint("RIGHT", el.frame, "LEFT", -L.side, 0)
    else
        panel:SetPoint("LEFT", el.frame, "RIGHT", L.side, 0)
    end
    panel:Show()
    refresh()
    return true
end

function P.ClosePanel()
    if panel and panel:IsShown() then
        panel:Hide()
    end
    shown = nil
end

function P.PanelShows()
    return panel and panel:IsShown() and shown or nil
end

function P.Panel()
    return panel
end

-- Every change to an element: the outline and the panel follow.
function P.OnChanged()
    drawOutline()
    refresh()
end
