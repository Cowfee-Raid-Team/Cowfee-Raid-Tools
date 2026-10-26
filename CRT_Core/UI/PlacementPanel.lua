local ADDON, CRT = ...

-- What UI/Placement.lua draws: the Placement panel a movable element's gear opens, the outline around the selected
-- element with its x, y at its top left, and the dashed guides a drag snaps to.
--
-- The panel (UI.Window, a dialog next to the element): X and Y (its centre's distance from its anchor's centre;
-- Enter applies, the up and down arrows step 1, Shift 10), Centre horizontally and Centre vertically, Select Anchor
-- (the main anchor control: larger, first), Anchor to (Screen, another CRT element, or the frame on screen it is
-- anchored to; a choice that would loop is greyed out), Frame name (a frame's name typed in, Enter or Anchor: the
-- fallback for a frame behind another), a line while selecting and one for what was refused or an anchor that isn't
-- loaded, then Reset and Done.
--
-- Selecting (Select Anchor) is UI/PlacementSelect.lua's: the dimming overlay that takes the clicks, the outline and
-- the name at the cursor. P.OnChanged here tells it of every change (P.SelectSync).

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
    pick = "Select Anchor",
    picking = "Click a frame to anchor to it. Right-click or Esc cancels.",
    pickHelp = "Click Select Anchor, then click any frame on screen, such as your unit frame, to anchor to it.\n\n"
        .. "The screen dims and the frame under the cursor is outlined, with its name at the cursor. "
        .. "Your click only selects it: you don't target, cast or press anything. Enter or Space select too.\n\n"
        .. "Right-click or Esc cancels. It can't be used in combat.",
    frameName = "Frame name",
    useFrame = "Anchor",
    frameHelp = "Type the name of a frame, such as PlayerFrame, then press Enter.\n\n"
        .. "Use this for a frame Select Anchor can't reach, such as one behind another window.",
    reset = "Reset",
    done = "Done",
    help = "X and Y are how far its centre is from the centre of what it is anchored to, in pixels.\n\n"
        .. "Click its box to select it: the arrow keys move it 1 pixel, Shift and an arrow 10. Esc lets go.\n\n"
        .. "Dragging snaps to the dashed lines within 6 pixels. Hold Shift while dragging to place it freely.",
    anchorHelp = "It keeps its distance from that element or frame and moves with it.\n\n"
        .. "Greyed out: that element is anchored to this one, so it would go round in a loop, or this one is "
        .. "protected by the game and that one isn't.\n\n"
        .. "A frame from another addon that loads late is found when it loads. Until then this stays where it was.",
    fixedHelp = "This one holds the game's own buttons, so it always sits on the screen.",
}
P.PANEL_TEXT = TEXT

local L = {
    width = 380, height = 296,
    box = 56, boxH = 20, labelW = 14, gap = 6, -- X and Y
    -- the boxes, the centre buttons, Select Anchor, Anchor to, Frame name, the selecting line, status
    rowY = { -6, -38, -70, -106, -138, -170, -190 },
    button = 22, mainButton = 26, -- Select Anchor is the larger
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
    f.useFrame:SetEnabled(not fixed)
    pcall(f.frameBox.SetEnabled, f.frameBox, not fixed)
    local status = P.message or shown:AnchorStatus()
    f.status:SetText(status or "")
    f.status:SetShown(status ~= nil)
end

-- The name typed in the Frame name box: anchored to, or the reason it can't be.
local function useTypedName()
    local f = panel
    if not (f and shown) then
        return
    end
    local ok, why = P.AnchorToName(shown, f.frameBox:GetText())
    P.message = not ok and why or nil
    f.frameBox:ClearFocus()
    if ok then
        f.frameBox:SetText("")
    end
    refresh()
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
    -- the frame on screen it is anchored to, loaded or not
    local name = shown and P.FrameName(shown:AnchorKey())
    if name then
        out[#out + 1] = { key = P.FrameKey(name), label = name }
    end
    return out
end

-- The chosen anchor: a frame on screen while it is saved (loaded or not), else the element it is held by, or Screen.
local function anchorChoice()
    if not shown then
        return "screen"
    end
    local key = shown:AnchorKey()
    if P.FrameName(key) then
        return key
    end
    return shown:LiveAnchor() or "screen"
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

    -- Select Anchor: the main way to anchor, above the list and the typed name
    f.pick = UI.PanelButton(c, TEXT.pick, L.mainButton, function()
        if shown then
            shown:StartPick()
        end
    end)
    f.pick:SetPoint("TOPLEFT", c, "TOPLEFT", 0, L.rowY[3])
    f.pickHelp = UI.HelpRight(f.pick, TEXT.pick, function()
        return shown and shown.spec.canAnchor == false and TEXT.fixedHelp or TEXT.pickHelp
    end, { parent = c })

    f.anchorRow = UI.Dropdown(c, TEXT.anchor, {
        labelWidth = L.dropLabel, width = L.drop,
        options = anchorOptions,
        get = anchorChoice,
        set = function(key)
            if shown then
                P.message = nil
                if P.picking == shown then
                    P.picking = nil -- a choice from the list ends selecting
                end
                shown:SetAnchor(key ~= "screen" and key or nil)
                refresh()
            end
        end,
        enabledIf = function()
            return shown ~= nil and shown.spec.canAnchor ~= false
        end,
    })
    f.anchorRow:SetPoint("TOPLEFT", c, "TOPLEFT", 0, L.rowY[4])
    -- the (?) after the list: why a choice is greyed out, or why this one has none
    f.anchorHelp = UI.HelpRight(f.anchorRow, TEXT.anchor, function()
        return shown and shown.spec.canAnchor == false and TEXT.fixedHelp or TEXT.anchorHelp
    end, { parent = c })

    -- Frame name: a frame's global name typed in, anchored to on Enter or Anchor
    local nameLabel = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    nameLabel:SetPoint("TOPLEFT", c, "TOPLEFT", 0, L.rowY[5] - 4)
    nameLabel:SetText(TEXT.frameName)
    f.frameBox = CreateFrame("EditBox", nil, c, "InputBoxTemplate")
    f.frameBox:SetSize(L.drop, L.boxH)
    f.frameBox:SetPoint("TOPLEFT", c, "TOPLEFT", L.dropLabel + L.gap, L.rowY[5])
    f.frameBox:SetAutoFocus(false)
    f.frameBox:SetMaxLetters(60)
    UI:SkinEditBox(f.frameBox)
    f.frameBox:SetScript("OnEnterPressed", useTypedName)
    f.frameBox:SetScript("OnEscapePressed", function(b)
        b:ClearFocus()
    end)
    f.useFrame = UI.PanelButton(c, TEXT.useFrame, L.button, useTypedName)
    f.useFrame:SetPoint("LEFT", f.frameBox, "RIGHT", L.gap, 0)
    f.frameHelp = UI.HelpRight(f.useFrame, TEXT.frameName, TEXT.frameHelp, { parent = c })

    f.picking = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    f.picking:SetPoint("TOPLEFT", c, "TOPLEFT", 0, L.rowY[6])
    f.picking:SetText(TEXT.picking)
    UI.Tint(f.picking, "SetTextColor", "heading")
    f.picking:Hide()

    -- what was refused, or an anchor that can't be used now
    f.status = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    f.status:SetPoint("TOPLEFT", c, "TOPLEFT", 0, L.rowY[7])
    f.status:SetPoint("RIGHT", c, "RIGHT", 0, 0)
    f.status:SetJustifyH("LEFT")
    UI.Tint(f.status, "SetTextColor", "bad")
    f.status:Hide()

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
    shown, P.message = el, nil
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

-- Every change to an element: the outline and the panel follow, and Select Anchor's overlay shows only while
-- selecting.
function P.OnChanged()
    drawOutline()
    refresh()
    if P.SelectSync then
        P.SelectSync()
    end
end
