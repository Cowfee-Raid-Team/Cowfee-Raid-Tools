local ADDON, CRT = ...

-- What UI/Placement.lua draws: the Placement panel a movable element's gear opens, the outline around the selected
-- element with its x, y at its top left, and the dashed guides a drag snaps to.
--
-- The panel (UI.Window, a dialog next to the element): X and Y (its centre's distance from its anchor's centre;
-- Enter applies, the up and down arrows step 1, Shift 10), Centre horizontally and Centre vertically, Anchor to
-- (Screen, another CRT element, or the frame on screen it is anchored to; a choice that would loop is greyed out)
-- with Pick on screen, Frame name (a frame's name typed in, Enter or Anchor), a line for picking and one for what
-- was refused or an anchor that isn't loaded, then Reset and Done.
--
-- Picking: a click on another element's box anchors to it (UI/Placement.lua's P.Click); a click anywhere else is
-- heard through GLOBAL_MOUSE_DOWN, and the frame under the cursor (GetMouseFoci) is resolved to the nearest frame with
-- a global name (P.ResolveFocus), whose name a tag at the cursor shows while hovering.

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
    picking = "Click another element's box, or any frame. Esc cancels.",
    frameName = "Frame name",
    useFrame = "Anchor",
    frameHelp = "Type the name of a frame on screen, such as PlayerFrame, then press Enter.\n\n"
        .. "Pick on screen shows the name of the frame under the cursor.",
    reset = "Reset",
    done = "Done",
    help = "X and Y are how far its centre is from the centre of what it is anchored to, in pixels.\n\n"
        .. "Click its box to select it: the arrow keys move it 1 pixel, Shift and an arrow 10. Esc lets go.\n\n"
        .. "Dragging snaps to the dashed lines within 6 pixels. Hold Shift while dragging to place it freely.",
    anchorHelp = "It keeps its distance from that element or frame and moves with it.\n\n"
        .. "Greyed out: that element is anchored to this one, so it would go round in a loop.\n\n"
        .. "A frame from another addon that loads late is found when it loads. Until then this stays where it was.",
    fixedHelp = "This one holds the game's own buttons, so it always sits on the screen.",
}
P.PANEL_TEXT = TEXT

local L = {
    width = 380, height = 262,
    box = 56, boxH = 20, labelW = 14, gap = 6, -- X and Y
    rowY = { -6, -38, -72, -104, -136, -156 }, -- the boxes, the centre buttons, Anchor to, Frame name, picking, status
    tag = 16, tagPad = 8, tagOffset = 16, -- the name tag at the cursor while picking
    hoverSeconds = 0.05, -- how often the tag reads the frame under the cursor
    button = 22,
    dropLabel = 64, drop = 150,
    side = 12, -- the panel's gap from the element
    outline = 2, outlineOut = 3, -- the selection outline's thickness, and how far outside the element
    dash = 8, dashGap = 6, -- the guides
}
P.PANEL_LAYOUT = L

local panel -- the window, made the first time it opens
local shown -- the element it shows
local message -- what was last refused (a typed name, a frame picked), until the next change

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
    local status = message or shown:AnchorStatus()
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
    message = not ok and why or nil
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

    f.anchorRow = UI.Dropdown(c, TEXT.anchor, {
        labelWidth = L.dropLabel, width = L.drop,
        options = anchorOptions,
        get = anchorChoice,
        set = function(key)
            if shown then
                message = nil
                shown:SetAnchor(key ~= "screen" and key or nil)
                refresh()
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

    -- Frame name: a frame's global name typed in, anchored to on Enter or Anchor
    local nameLabel = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    nameLabel:SetPoint("TOPLEFT", c, "TOPLEFT", 0, L.rowY[4] - 4)
    nameLabel:SetText(TEXT.frameName)
    f.frameBox = CreateFrame("EditBox", nil, c, "InputBoxTemplate")
    f.frameBox:SetSize(L.drop, L.boxH)
    f.frameBox:SetPoint("TOPLEFT", c, "TOPLEFT", L.dropLabel + L.gap, L.rowY[4])
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
    f.picking:SetPoint("TOPLEFT", c, "TOPLEFT", 0, L.rowY[5])
    f.picking:SetText(TEXT.picking)
    UI.Tint(f.picking, "SetTextColor", "heading")
    f.picking:Hide()

    -- what was refused, or an anchor that can't be used now
    f.status = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    f.status:SetPoint("TOPLEFT", c, "TOPLEFT", 0, L.rowY[6])
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
    shown, message = el, nil
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

-- Picking any frame on screen ------------------------------------------------------------------------

local tag -- the name of the frame under the cursor, while picking
local hoverWait = 0

local function makeTag()
    tag = CreateFrame("Frame", nil, UIParent, "BackdropTemplate")
    tag:SetFrameStrata("TOOLTIP")
    tag:EnableMouse(false) -- never the frame under the cursor itself
    tag:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8" })
    UI.Tint(tag, "SetBackdropColor", "surface", 0.9)
    tag.text = tag:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    tag.text:SetPoint("CENTER")
    UI.Tint(tag.text, "SetTextColor", "heading")
    tag:Hide()
    P.pickTag = tag
end

-- The frame whose OnUpdate reads the frame under the cursor, set only while picking.
local hover = CreateFrame("Frame")
local function hoverStep(_, dt)
    hoverWait = hoverWait + (dt or 0)
    if hoverWait >= L.hoverSeconds then
        hoverWait = 0
        P.PickHover()
    end
end

-- The region under the cursor: the topmost the game reports.
local function underCursor()
    if not GetMouseFoci then
        return nil
    end
    local ok, foci = pcall(GetMouseFoci)
    return ok and type(foci) == "table" and foci[1] or nil
end

-- While picking, the tag at the cursor names the frame under it, or says it has none; over CRT's own it goes.
function P.PickHover()
    if not P.picking or (InCombatLockdown and InCombatLockdown()) then
        if tag then
            tag:Hide()
        end
        return
    end
    if not tag then
        makeTag()
    end
    local _, name, own = P.ResolveFocus(underCursor())
    local x, y = GetCursorPosition()
    local s = UIParent:GetEffectiveScale()
    x, y = P.num(x), P.num(y)
    s = P.num(s) or 1
    if own or not (x and y) or s <= 0 then
        tag:Hide()
        return
    end
    tag.text:SetText(name or P.TEXT.noName)
    tag:SetSize((P.num(tag.text:GetStringWidth()) or 0) + L.tagPad, L.tag)
    tag:ClearAllPoints()
    tag:SetPoint("BOTTOMLEFT", UIParent, "BOTTOMLEFT", x / s + L.tagOffset, y / s + L.tagOffset)
    tag:Show()
end

-- A left mouse button going down while picking: the frame under the cursor is anchored to, or the panel says why
-- not. A press on CRT's own (an element's box, this panel) is left to its own click.
local function mouseDown(button)
    local el = P.picking
    if button ~= "LeftButton" or not el or (InCombatLockdown and InCombatLockdown()) then
        return
    end
    local f, name, own = P.ResolveFocus(underCursor())
    if own then
        return
    end
    local ok, why
    if f then
        ok, why = P.AnchorToName(el, name)
    else
        ok, why = false, P.TEXT.noName
    end
    if ok then
        P.picking = nil
        message = nil
    else
        message = why
    end
    P.OnChanged(el)
end

local clicks = CreateFrame("Frame")
if clicks.RegisterEvent then
    clicks:RegisterEvent("GLOBAL_MOUSE_DOWN")
end
clicks:SetScript("OnEvent", function(_, _, button)
    mouseDown(button)
end)

-- Every change to an element: the outline and the panel follow; the name tag shows only while picking.
function P.OnChanged()
    drawOutline()
    refresh()
    if P.picking then
        hover:SetScript("OnUpdate", hoverStep)
    else
        hover:SetScript("OnUpdate", nil)
        if tag then
            tag:Hide()
        end
    end
end
