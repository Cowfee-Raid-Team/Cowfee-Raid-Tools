local ADDON, CRT = ...

-- One maker for CRT's windows, so their look and behaviour change in one place:
--   UI.Window(name, opts) returns a frame styled like the main window (UI:StyleWindow), on a window
--   layer, clamped to the screen, dragged by its title from where the mouse is (StartMoving(true)),
--   closed by Escape, with its place (and size, for a pop-out) kept in a table you pass.
-- opts:
--   kind       "dialog" (fixed size), "popout" (resizable, with a grip and a Reset button) or "overlay"
--              (no frame art; its own panels drag it with f:StartDrag() and f:StopDrag())
--   title      the title text
--   width, height, minWidth, minHeight   sizes (the minimums only matter for a pop-out)
--   layer      a UI layer key (default "popups")
--   saved      function returning the table that keeps point, x, y (and width, height)
--   escape     false keeps Escape from closing it
-- The frame gets f.content (the area under the title), f:Place() (puts it where it was saved) and
-- f.strip, its title bar (UI.TitleStrip): f.strip:SetTitle(text), f.strip:SetBadge("TEST", note), or
-- f.strip:SetBadge(name, nil, UI.TITLE_STRIP.neutral) for a plain badge such as a boss's name.
-- UI.ContextMenu(owner, fill) opens the game's context menu above every window.
-- Windows made by hand before this helper existed are moved onto it one at a time (see the skill's
-- Known debt); new windows use it from the start.

local UI = CRT.UI

local DEFAULTS = {
    template = "BasicFrameTemplateWithInset",
    layer = "popups",
    width = 640,
    height = 420,
    minWidth = 360,
    minHeight = 220,
    titleHeight = 26, -- the title strip, above f.content
    inset = 8, -- f.content's margin from the edges
    grip = "Interface\\ChatFrame\\UI-ChatIM-SizeGrabber",
    gripSize = 16,
}
UI.WINDOW_DEFAULTS = DEFAULTS

local function savedOf(opts)
    return opts.saved and opts.saved() or nil
end

local function save(f, opts)
    local s = savedOf(opts)
    local left, top = f:GetLeft(), f:GetTop()
    if not (s and left and top) then
        return
    end
    s.point, s.x, s.y = "TOPLEFT", left, top - (UIParent:GetHeight() or 0)
    if opts.kind == "popout" then
        s.width = math.floor(f:GetWidth() + 0.5)
        s.height = math.floor(f:GetHeight() + 0.5)
    end
end

-- The game opens a menu on FULLSCREEN_DIALOG (Blizzard_Menu's AcquireMenu), and every submenu too,
-- whatever the root is on: the same layer as the popups windows, which come in front of it. UI.MenuOnTop
-- puts every level of a menu on TOOLTIP as it opens (the root description's AddMenuAcquiredCallback runs
-- for the root and each submenu). The game sets a menu's strata again each time it is acquired, so
-- nothing has to be put back. Every context menu and dropdown list in the addon goes through it:
-- UI.ContextMenu here, UI.Dropdown in UI/Controls.lua.
local MENU_STRATA = "TOOLTIP"
function UI.MenuOnTop(root)
    if root and root.AddMenuAcquiredCallback then
        root:AddMenuAcquiredCallback(function(menu)
            if menu and menu.SetFrameStrata then
                pcall(menu.SetFrameStrata, menu, MENU_STRATA)
            end
        end)
    end
end

-- A context menu opened at an anchor, the way the game's dropdown buttons open theirs
-- (DropdownButtonMixin:OpenMenu in Blizzard_Menu): a root description with the context menu's look,
-- filled by the generator, opened by the menu manager at AnchorUtil.CreateAnchor(...). nil when any of
-- those is missing or fails, so the caller can fall back.
local function openAnchored(owner, generator, anchor)
    if not (Menu and Menu.GetManager and Menu.PopulateDescription and MenuUtil.CreateRootMenuDescription
        and MenuVariants and MenuVariants.GetDefaultContextMenuMixin and AnchorUtil and AnchorUtil.CreateAnchor) then
        return nil
    end
    local ok, menu = pcall(function()
        local desc = MenuUtil.CreateRootMenuDescription(MenuVariants.GetDefaultContextMenuMixin())
        Menu.PopulateDescription(generator, owner, desc)
        local at = AnchorUtil.CreateAnchor(anchor[1], anchor[2], anchor[3], anchor[4] or 0, anchor[5] or 0)
        return Menu.GetManager():OpenMenu(owner, desc, at)
    end)
    return ok and menu or nil
end

-- anchor, when given, is { point, relativeTo, relativePoint, x, y }: the menu opens there instead of at
-- the mouse (the title bar's theme menu sits under its button). Without the game's anchored route it
-- opens at the mouse and is moved there.
function UI.ContextMenu(owner, fill, anchor)
    if not (MenuUtil and MenuUtil.CreateContextMenu) then
        return nil
    end
    local function generator(_, root)
        UI.MenuOnTop(root)
        fill(root)
    end
    local anchored = anchor and openAnchored(owner, generator, anchor)
    local menu = anchored or MenuUtil.CreateContextMenu(owner, generator)
    if menu and anchor and not anchored and menu.ClearAllPoints then
        pcall(function()
            menu:ClearAllPoints()
            menu:SetPoint(anchor[1], anchor[2], anchor[3], anchor[4] or 0, anchor[5] or 0)
        end)
    end
    if menu and menu.SetFrameStrata then
        if not menu.crtMenuStrata then
            menu.crtMenuStrata = menu:GetFrameStrata()
            menu:HookScript("OnHide", function(m)
                if m.crtMenuStrata then
                    m:SetFrameStrata(m.crtMenuStrata)
                    m.crtMenuStrata = nil
                end
            end)
        end
        menu:SetFrameStrata(MENU_STRATA)
        menu:Raise()
    end
    return menu
end

-- An overlay: no frame art, moved by dragging anything that calls f:StartDrag() / f:StopDrag(), its place
-- kept like a window's. Used for groups of small panels, such as the raider loot popup.
local function overlay(name, opts)
    local f = CreateFrame("Frame", name, UIParent)
    UI:RegisterLayer(opts.layer or DEFAULTS.layer, f)
    f:SetClampedToScreen(true)
    f:SetMovable(true)
    f:SetSize(opts.width or DEFAULTS.width, opts.height or DEFAULTS.height)
    function f:StartDrag()
        self:StartMoving(true)
    end
    function f:StopDrag()
        self:StopMovingOrSizing()
        save(self, opts)
    end
    function f:Place()
        local s = savedOf(opts)
        self:ClearAllPoints()
        if s and s.point then
            self:SetPoint("TOPLEFT", UIParent, "TOPLEFT", s.x or 0, s.y or 0)
        else
            self:SetPoint("TOP", 0, -140)
        end
    end
    f.content = f
    f:Place()
    f:Hide()
    return f
end

-- The title bar, in each look (UI:IsModern), re-styled when the look changes (it is in UI.skinned):
--   Classic  the main window's title bar. The window template (BasicFrameTemplate, Blizzard_UIPanelTemplates)
--            draws the dark title tile and the red X; the title is its TitleText's font (GameFontNormal,
--            in that font's own gold) where the template puts it, centred; the badge sits at the left
--            end, where the main window shows its version. A strip with no window template under it
--            (opts.framed false, such as the raider popup's) draws the template's title tile itself.
--   Modern   the theme's strip (stripTop to stripBottom), lighter than the window, a caramel line under
--            it, the title in larger bold cream text on the left with the badge after it.
-- UI.TitleStrip(parent, height, opts): opts.framed when parent is a BasicFrameTemplate window (UI.Window).
-- strip:SetTitle(text), strip:SetBadge(text or nil, note, colors): colors is { bg, edge, text }; without
-- it the badge is the orange TEST one. STRIP.neutral is the window's gold text on a dark badge. A note
-- shows with or without a badge. Its colours and Classic places are in STRIP. A colour written as a
-- string is a CRT.MOCHA key, so it follows the theme (UI.StripColor reads either kind).
local STRIP = {
    top = "stripTop", bottom = "stripBottom", line = "caramel",
    badgeBg = { 0.35, 0.16, 0.06 }, badgeEdge = { 0.63, 0.34, 0.12 }, badgeText = { 1, 0.81, 0.6 },
    title = "cream", note = "note",
    neutral = { bg = "espresso", edge = "edge", text = "latte" },
    modernFont = "CRTFontLarge",
    -- Classic, from BasicFrameTemplate: TitleText inherits GameFontNormal, anchored TOP x -6, y -4;
    -- TitleBg is the _UI-Frame-TitleTileBg atlas, tiled across
    classicFont = "GameFontNormal", classicBar = "_UI-Frame-TitleTileBg",
    classicTitleX = -6, classicTitleY = -4,
    classicBadgeX = 9, -- the main window's version is 10 from the window's edge; the strip starts 1 in
    framedBadgeY = 2, -- the template's title tile is above the strip's middle
    gap = 8,
}
STRIP.warning = { bg = STRIP.badgeBg, edge = STRIP.badgeEdge, text = STRIP.badgeText }
UI.TITLE_STRIP = STRIP

-- A STRIP color as r, g, b: a CRT.MOCHA key (the theme in use) or { r, g, b }. A key the palette
-- lacks gives grey.
function UI.StripColor(c)
    if type(c) == "string" then
        c = CRT.MOCHA and CRT.MOCHA[c]
    end
    if type(c) ~= "table" then
        return 0.5, 0.5, 0.5
    end
    return c[1], c[2], c[3]
end
local stripColor = UI.StripColor

-- The strip's own colors, painted again when the theme changes; the badge keeps the colors it was
-- given, so a theme color (STRIP.neutral) follows too.
local function paintStrip(s)
    local tr, tg, tb = stripColor(STRIP.top)
    local br, bgr, bb = stripColor(STRIP.bottom)
    s.bg:SetColorTexture(1, 1, 1, 1)
    local ok = pcall(s.bg.SetGradient, s.bg, "VERTICAL", CreateColor(br, bgr, bb, 1), CreateColor(tr, tg, tb, 1))
    if not ok then
        s.bg:SetColorTexture(tr, tg, tb, 1)
    end
    local lr, lg, lb = stripColor(STRIP.line)
    s.line:SetColorTexture(lr, lg, lb, 1)
    s.note:SetTextColor(stripColor(STRIP.note))
    local c = s.badgeColors
    if c then
        local r, g, b = stripColor(c.bg)
        s.badge:SetBackdropColor(r, g, b, 1)
        r, g, b = stripColor(c.edge)
        s.badge:SetBackdropBorderColor(r, g, b, 1)
        s.badge.text:SetTextColor(stripColor(c.text))
    end
end

local function shownWidth(r, pad)
    if not r:IsShown() then
        return 0
    end
    return (r.GetWidth and r:GetWidth() or 0) + pad
end

-- Places the title, badge and note for the look. In Classic the title is centred unless the badge and
-- note reach it; then it follows them.
local function layoutStrip(s)
    local title, badge, note = s.title, s.badge, s.note
    title:ClearAllPoints()
    badge:ClearAllPoints()
    note:ClearAllPoints()
    if UI:IsModern() then
        title:SetPoint("LEFT", s, "LEFT", 10, 1)
        badge:SetPoint("LEFT", title, "RIGHT", STRIP.gap, 0)
        note:SetPoint("LEFT", badge:IsShown() and badge or title, "RIGHT", STRIP.gap, 0)
        return
    end
    local y = s.framed and STRIP.framedBadgeY or 0
    badge:SetPoint("LEFT", s, "LEFT", STRIP.classicBadgeX, y)
    if badge:IsShown() then
        note:SetPoint("LEFT", badge, "RIGHT", STRIP.gap, 0)
    else
        note:SetPoint("LEFT", s, "LEFT", STRIP.classicBadgeX, y)
    end
    local noteW = (note:IsShown() and (note:GetText() or "") ~= "") and (note:GetStringWidth() or 0) + STRIP.gap or 0
    local leftEnd = STRIP.classicBadgeX + shownWidth(badge, STRIP.gap) + noteW
    local width = s:GetWidth() or 0
    local titleW = title:GetStringWidth() or 0
    -- a strip not sized yet is laid out again when it is (OnSizeChanged)
    if width > 0 and (width - titleW) / 2 + (s.framed and STRIP.classicTitleX or 0) < leftEnd then
        title:SetPoint("LEFT", noteW > 0 and note or badge, "RIGHT", STRIP.gap, 0)
    elseif s.framed then
        title:SetPoint("TOP", s.window, "TOP", STRIP.classicTitleX, STRIP.classicTitleY)
    else
        title:SetPoint("CENTER", s, "CENTER", 0, 0)
    end
end

local function styleStrip(s)
    local modern = UI:IsModern()
    s.bg:SetShown(modern)
    s.line:SetShown(modern)
    s.bar:SetShown(not modern and not s.framed)
    paintStrip(s)
    local font = _G[modern and STRIP.modernFont or STRIP.classicFont]
    if font then
        s.title:SetFontObject(font)
    end
    if modern then
        s.title:SetTextColor(stripColor(STRIP.title))
    elseif font and font.GetTextColor then
        -- the font's own colour, set again because Modern set its own on this font string
        s.title:SetTextColor(font:GetTextColor())
    end
    layoutStrip(s)
    -- what the window keeps in the strip that moves with the look (UI.Window's Reset)
    if s.onStyle then
        s.onStyle(modern)
    end
end

function UI.TitleStrip(parent, height, opts)
    local s = CreateFrame("Frame", nil, parent)
    s.framed = opts and opts.framed and true or false
    s.window = parent
    s:SetHeight(height or 24)
    local bg = s:CreateTexture(nil, "BACKGROUND")
    bg:SetAllPoints()
    s.bg = bg -- painted by paintStrip
    -- Classic, with no window template under it: the template's title tile
    local bar = s:CreateTexture(nil, "BACKGROUND")
    bar:SetAllPoints()
    bar:SetAtlas(STRIP.classicBar)
    if bar.SetHorizTile then
        pcall(bar.SetHorizTile, bar, true)
    end
    s.bar = bar
    local line = s:CreateTexture(nil, "BORDER")
    line:SetHeight(2)
    line:SetPoint("BOTTOMLEFT")
    line:SetPoint("BOTTOMRIGHT")
    s.line = line
    s.title = s:CreateFontString(nil, "OVERLAY", STRIP.modernFont)
    s.badge = CreateFrame("Frame", nil, s, "BackdropTemplate")
    s.badge:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    s.badge.text = s.badge:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    s.badge.text:SetPoint("CENTER")
    s.note = s:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    s.badge:Hide()
    s.note:Hide()
    s.badgeColors = false -- the colors SetBadge was given, painted again by paintStrip
    function s:SetTitle(text)
        self.title:SetText(text or "")
        layoutStrip(self)
    end
    function s:SetBadge(text, note, colors)
        if text and text ~= "" then
            self.badgeColors = colors or STRIP.warning
            paintStrip(self)
            self.badge.text:SetText(text)
            self.badge:SetSize(self.badge.text:GetStringWidth() + 12, 16)
            self.badge:Show()
        else
            self.badge:Hide()
        end
        self.note:SetText(note or "")
        self.note:SetShown(note ~= nil and note ~= "")
        layoutStrip(self)
    end
    -- the centred Classic title moves aside when the window narrows
    s:SetScript("OnSizeChanged", layoutStrip)
    s.crtSkin = function()
        styleStrip(s)
    end
    UI.skinned[#UI.skinned + 1] = s
    styleStrip(s)
    return s
end

function UI.Window(name, opts)
    opts = opts or {}
    if opts.kind == "overlay" then
        return overlay(name, opts)
    end
    local popout = opts.kind == "popout"
    local f = CreateFrame("Frame", name, UIParent, DEFAULTS.template)
    UI:StyleWindow(f)
    UI:RegisterLayer(opts.layer or DEFAULTS.layer, f)
    UI.SetFrameTitle(f, "")
    -- the title bar, over the template's own title area; the close button stays on top of it
    local strip = UI.TitleStrip(f, DEFAULTS.titleHeight - 2, { framed = true })
    strip:SetPoint("TOPLEFT", 1, -1)
    strip:SetPoint("TOPRIGHT", -1, -1)
    strip:SetFrameLevel(f:GetFrameLevel() + 2)
    strip:SetTitle(opts.title or "")
    f.strip = strip
    if f.CloseButton then
        f.CloseButton:SetFrameLevel(strip:GetFrameLevel() + 3)
    end
    f:SetClampedToScreen(true)
    f:SetMovable(true)
    f:EnableMouse(true)
    f:RegisterForDrag("LeftButton")
    f:SetScript("OnDragStart", function(self)
        self:StartMoving(true)
    end)
    f:SetScript("OnDragStop", function(self)
        self:StopMovingOrSizing()
        save(self, opts)
    end)
    if opts.escape ~= false and name then
        tinsert(UISpecialFrames, name)
    end

    local w, h = opts.width or DEFAULTS.width, opts.height or DEFAULTS.height
    local minW, minH = opts.minWidth or DEFAULTS.minWidth, opts.minHeight or DEFAULTS.minHeight

    function f:Place()
        local s = savedOf(opts)
        self:ClearAllPoints()
        if s and s.point then
            self:SetPoint("TOPLEFT", UIParent, "TOPLEFT", s.x or 0, s.y or 0)
        else
            self:SetPoint("CENTER")
        end
        if popout and s and s.width then
            self:SetSize(math.max(minW, s.width), math.max(minH, s.height or h))
        else
            self:SetSize(w, h)
        end
    end

    if popout then
        f:SetResizable(true)
        if f.SetResizeBounds then
            f:SetResizeBounds(minW, minH)
        end
        local grip = CreateFrame("Button", nil, f)
        grip:SetSize(DEFAULTS.gripSize, DEFAULTS.gripSize)
        grip:SetPoint("BOTTOMRIGHT", -2, 2)
        grip:SetNormalTexture(DEFAULTS.grip .. "-Up")
        grip:SetHighlightTexture(DEFAULTS.grip .. "-Highlight")
        grip:SetPushedTexture(DEFAULTS.grip .. "-Down")
        grip:SetScript("OnMouseDown", function()
            f:StartSizing("BOTTOMRIGHT")
        end)
        grip:SetScript("OnMouseUp", function()
            f:StopMovingOrSizing()
            save(f, opts)
        end)
        f.grip = grip
        local reset = UI.ResetButton(strip, function()
            local s = savedOf(opts)
            if s then
                s.point, s.x, s.y, s.width, s.height = nil, nil, nil, nil, nil
            end
            f:Place()
        end)
        -- beside the close button; in Classic 1 higher, like the main window's Previews, so it sits
        -- inside the template's title tile
        strip.onStyle = function(modern)
            reset:ClearAllPoints()
            if f.CloseButton then
                reset:SetPoint("RIGHT", f.CloseButton, "LEFT", -4, modern and 0 or 1)
            else
                reset:SetPoint("TOPRIGHT", -30, modern and -4 or -3)
            end
        end
        strip.onStyle(UI:IsModern())
        f.reset = reset
    end

    local content = CreateFrame("Frame", nil, f)
    content:SetPoint("TOPLEFT", DEFAULTS.inset, -(DEFAULTS.titleHeight + 4))
    content:SetPoint("BOTTOMRIGHT", -DEFAULTS.inset, DEFAULTS.inset + (popout and DEFAULTS.gripSize or 0))
    f.content = content

    f:Place()
    f:Hide()
    return f
end
