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
-- f.strip, its title bar (UI.TitleStrip): f.strip:SetTitle(text), f.strip:SetBadge("TEST", note).
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

-- A context menu (MenuUtil.CreateContextMenu) opened from a window on the popups layer shows behind it;
-- this lifts the menu above every window until it closes, then puts its strata back.
local MENU_STRATA = "TOOLTIP"
function UI.ContextMenu(owner, fill)
    if not (MenuUtil and MenuUtil.CreateContextMenu) then
        return nil
    end
    local menu = MenuUtil.CreateContextMenu(owner, function(_, root)
        fill(root)
    end)
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

-- The title bar: a mocha strip lighter than the window, a caramel line under it, the title in larger
-- bold text, and an optional badge (such as TEST) with a short note. strip:SetTitle(text),
-- strip:SetBadge(text or nil, note). Its colours are in STRIP.
local STRIP = {
    top = { 0.353, 0.247, 0.173 }, bottom = { 0.227, 0.165, 0.122 }, line = { 0.78, 0.56, 0.36 },
    badgeBg = { 0.35, 0.16, 0.06 }, badgeEdge = { 0.63, 0.34, 0.12 }, badgeText = { 1, 0.81, 0.6 },
    title = { 0.95, 0.90, 0.84 }, note = { 0.80, 0.71, 0.60 },
}
UI.TITLE_STRIP = STRIP

function UI.TitleStrip(parent, height)
    local s = CreateFrame("Frame", nil, parent)
    s:SetHeight(height or 24)
    local bg = s:CreateTexture(nil, "BACKGROUND")
    bg:SetAllPoints()
    bg:SetColorTexture(1, 1, 1, 1)
    local ok = pcall(bg.SetGradient, bg, "VERTICAL", CreateColor(STRIP.bottom[1], STRIP.bottom[2], STRIP.bottom[3], 1),
        CreateColor(STRIP.top[1], STRIP.top[2], STRIP.top[3], 1))
    if not ok then
        bg:SetColorTexture(STRIP.top[1], STRIP.top[2], STRIP.top[3], 1)
    end
    local line = s:CreateTexture(nil, "BORDER")
    line:SetColorTexture(STRIP.line[1], STRIP.line[2], STRIP.line[3], 1)
    line:SetHeight(2)
    line:SetPoint("BOTTOMLEFT")
    line:SetPoint("BOTTOMRIGHT")
    s.title = s:CreateFontString(nil, "OVERLAY", "CRTFontLarge")
    s.title:SetPoint("LEFT", 10, 1)
    s.title:SetTextColor(STRIP.title[1], STRIP.title[2], STRIP.title[3])
    s.badge = CreateFrame("Frame", nil, s, "BackdropTemplate")
    s.badge:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    s.badge:SetBackdropColor(STRIP.badgeBg[1], STRIP.badgeBg[2], STRIP.badgeBg[3], 1)
    s.badge:SetBackdropBorderColor(STRIP.badgeEdge[1], STRIP.badgeEdge[2], STRIP.badgeEdge[3], 1)
    s.badge:SetPoint("LEFT", s.title, "RIGHT", 8, 0)
    s.badge.text = s.badge:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    s.badge.text:SetPoint("CENTER")
    s.badge.text:SetTextColor(STRIP.badgeText[1], STRIP.badgeText[2], STRIP.badgeText[3])
    s.note = s:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    s.note:SetPoint("LEFT", s.badge, "RIGHT", 8, 0)
    s.note:SetTextColor(STRIP.note[1], STRIP.note[2], STRIP.note[3])
    s.badge:Hide()
    function s:SetTitle(text)
        self.title:SetText(text or "")
    end
    function s:SetBadge(text, note)
        if text and text ~= "" then
            self.badge.text:SetText(text)
            self.badge:SetSize(self.badge.text:GetStringWidth() + 12, 16)
            self.badge:Show()
            self.note:SetText(note or "")
            self.note:Show()
        else
            self.badge:Hide()
            self.note:Hide()
        end
    end
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
    local strip = UI.TitleStrip(f, DEFAULTS.titleHeight - 2)
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
        if f.CloseButton then
            reset:SetPoint("RIGHT", f.CloseButton, "LEFT", -4, 0)
        else
            reset:SetPoint("TOPRIGHT", -30, -4)
        end
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
