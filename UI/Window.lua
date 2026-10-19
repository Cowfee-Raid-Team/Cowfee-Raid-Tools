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
-- The frame gets f.content (the area under the title) and f:Place() (puts it where it was saved).
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

function UI.Window(name, opts)
    opts = opts or {}
    if opts.kind == "overlay" then
        return overlay(name, opts)
    end
    local popout = opts.kind == "popout"
    local f = CreateFrame("Frame", name, UIParent, DEFAULTS.template)
    UI:StyleWindow(f)
    UI:RegisterLayer(opts.layer or DEFAULTS.layer, f)
    UI.SetFrameTitle(f, opts.title or "")
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
        local reset = UI.ResetButton(f, function()
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
