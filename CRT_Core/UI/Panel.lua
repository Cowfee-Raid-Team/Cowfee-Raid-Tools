local ADDON, CRT = ...

local UI = { pages = {}, order = {} }
CRT.UI = UI

-- The main window: wide and short, so pages lay out in columns (1200 x 600 since 0.19.0; it was 860 x
-- 762). A page gets the area right of the menu: PAGE_W x PAGE_H. Pages size their columns from these,
-- never from numbers of their own, and /crt dev layout reports anything placed outside them.
local FRAME_W, FRAME_H = 1200, 600
local MENU_W = 150
UI.PAGE_W = FRAME_W - 8 - MENU_W - 8 - 8 -- 1026: the menu's left margin, the menu, the gap, the right margin
UI.PAGE_H = FRAME_H - 32 - 8 -- 560: under the title bar, above the bottom margin

-- Pages register themselves; the panel builds each one lazily the first time it is shown.
function UI:RegisterPage(key, title, builder)
    self.pages[key] = { key = key, title = title, builder = builder }
    self.order[#self.order + 1] = key
end

-- A hidden page has no menu button and can't be opened, such as the Development page until /crt dev.
-- closeHides hides it again whenever the main window closes.
function UI:SetPageHidden(key, hidden, closeHides)
    local page = self.pages[key]
    if not page then
        return
    end
    page.hidden = hidden and true or false
    if closeHides ~= nil then
        page.closeHides = closeHides and true or false
    end
    if self.frame then
        self:LayoutMenu()
    end
end

-- Previews: the panels that appear on their own, such as the ready check bar and the debuff panel,
-- register here. "Previews" in the corner of the main panel shows them all so they can be
-- dragged into place, and hides them again. setFn(on) shows or hides one panel's preview.
UI.previews = {}
UI.previewing = false

function UI:RegisterPreview(key, setFn)
    self.previews[key] = setFn
end

function UI:SetPreviews(on)
    on = on and true or false
    if on and InCombatLockdown() then
        CRT:Print("Previews can't be turned on during combat.")
        return
    end
    self.previewing = on
    for key, setFn in pairs(self.previews) do
        local ok, err = pcall(setFn, on)
        if not ok then
            CRT:Print("Preview '" .. key .. "' failed: " .. tostring(err))
        end
    end
    if self.previewButton then
        self.previewButton:SetText(on and "Previews: ON" or "Previews")
    end
end

function UI:TogglePreviews()
    self:SetPreviews(not self.previewing)
end

-- The panel's size as a percent, 50 to 200. SetScale scales everything in it, text included.
UI.MIN_SCALE, UI.MAX_SCALE = 50, 200

function UI:Scale()
    return math.max(self.MIN_SCALE, math.min(self.MAX_SCALE, math.floor((CRT.db.window.scale or 100) + 0.5)))
end

-- Sets the panel's size. onScale, when set, is told so a page can show the new value.
function UI:SetScale(percent)
    CRT.db.window.scale = math.max(self.MIN_SCALE, math.min(self.MAX_SCALE, math.floor(percent + 0.5)))
    if self.frame then
        self.frame:SetScale(self:Scale() / 100)
    end
    if self.onScale then
        self.onScale()
    end
end

-- Layers -----------------------------------------------------------------------------------------
-- Each kind of window registers its frames with RegisterLayer, which draws them in the frame strata
-- chosen on the General Settings page, or in the window's default. The choice is saved per kind in
-- CRTDB.ui.layers, and only while it differs from the default.

UI.STRATA = {
    { key = "BACKGROUND", label = "Background" },
    { key = "LOW", label = "Low" },
    { key = "MEDIUM", label = "Medium" },
    { key = "HIGH", label = "High" },
    { key = "DIALOG", label = "Dialog" },
    { key = "FULLSCREEN", label = "Fullscreen" },
    { key = "FULLSCREEN_DIALOG", label = "Fullscreen dialog" },
    { key = "TOOLTIP", label = "Tooltip" },
}

UI.LAYERS = {
    { key = "panel", label = "Main window", default = "HIGH" },
    { key = "notes", label = "Note windows", default = "MEDIUM" },
    { key = "alert", label = "Note callout/assignments", default = "HIGH" },
    { key = "alertbars", label = "Alert bars", default = "HIGH" },
    { key = "alerticons", label = "Alert icons", default = "HIGH" },
    { key = "alerttexts", label = "Critical alerts text", default = "HIGH" },
    { key = "alertcircles", label = "Alert circles", default = "HIGH" },
    { key = "alerttimeline", label = "Alert timeline", default = "HIGH" },
    { key = "readycheck", label = "Ready check window", default = "HIGH" },
    -- the game's Ready Check window's own layer, so the row above it is never under another panel
    { key = "bar", label = "Your consumables bar", default = "DIALOG" },
    { key = "debuffs", label = "Debuff panel", default = "HIGH" },
    { key = "lowhealth", label = "Low-health banner", default = "DIALOG" },
    -- At most Fullscreen: the alert editor and the game's dropdown lists sit above it, on Fullscreen
    -- dialog and Tooltip, so editing from the Timeline window always shows on top.
    { key = "timeline", label = "Timeline window", default = "HIGH", max = "FULLSCREEN" },
    -- The windows that open over the others: the dev tools, the text, import and roster windows.
    { key = "popups", label = "Pop-up windows", default = "FULLSCREEN_DIALOG" },
}

local layerDefaults, layerFrames = {}, {}
for _, layer in ipairs(UI.LAYERS) do
    layerDefaults[layer.key] = layer.default
    layerFrames[layer.key] = {}
end
local layersWaiting = false -- a change blocked by combat, applied when combat ends

local strataRank, layerMax = {}, {}
for i, s in ipairs(UI.STRATA) do
    strataRank[s.key] = i
end
for _, layer in ipairs(UI.LAYERS) do
    layerMax[layer.key] = layer.max
end

function UI:Layer(key)
    local saved = CRT.db and CRT.db.ui and CRT.db.ui.layers[key]
    local strata = saved or layerDefaults[key] or "MEDIUM"
    -- a layer with a highest allowed strata never goes above it, a choice saved before included
    local max = layerMax[key]
    if max and (strataRank[strata] or 0) > (strataRank[max] or 0) then
        strata = max
    end
    return strata
end

-- The strata a layer can be set to: every one, or up to its highest allowed.
function UI:LayerChoices(key)
    local max = layerMax[key]
    if not max then
        return self.STRATA
    end
    local out = {}
    for _, s in ipairs(self.STRATA) do
        if strataRank[s.key] <= strataRank[max] then
            out[#out + 1] = s
        end
    end
    return out
end

-- A protected frame (one holding secure buttons) can't change strata in combat, so that waits.
local function applyLayer(key)
    for _, frame in ipairs(layerFrames[key]) do
        if InCombatLockdown() and frame:IsProtected() then
            layersWaiting = true
        else
            frame:SetFrameStrata(UI:Layer(key))
        end
    end
end

function UI:RegisterLayer(key, frame)
    local list = layerFrames[key]
    list[#list + 1] = frame
    frame:SetFrameStrata(self:Layer(key))
    -- a pop-up comes in front of the other pop-ups when clicked
    if key == "popups" then
        frame:SetToplevel(true)
    elseif key == "panel" or key == "timeline" then
        -- the main window and the Timeline window come to the front, children and all, when clicked
        -- or shown, so their frame levels never interleave
        -- (Raise is a protected function: it can't run in combat on a frame holding secure buttons)
        pcall(frame.SetToplevel, frame, true)
        frame:HookScript("OnShow", function(self)
            if not (InCombatLockdown() and self:IsProtected()) then
                self:Raise()
            end
        end)
    end
end

function UI:SetLayer(key, strata)
    CRT.db.ui.layers[key] = (strata ~= layerDefaults[key]) and strata or nil
    applyLayer(key)
    if layersWaiting then
        CRT:Print("That window can't change layer during combat. It will change when combat ends.")
    end
end

-- The groups General Settings shows, each setting the layer of several windows at once. The
-- Development page (/crt dev) still lists every window on its own.
UI.LAYER_GROUPS = {
    { key = "panel", label = "Main window", layers = { "panel" } },
    { key = "notes", label = "Note windows", layers = { "notes" } },
    { key = "timeline", label = "Timeline window", layers = { "timeline" } },
    { key = "alerts", label = "Alerts", layers = { "alert", "alertbars", "alerticons", "alerttexts", "alertcircles", "alerttimeline", "lowhealth" } },
    { key = "raid", label = "Raid windows", layers = { "readycheck", "bar", "debuffs" } },
    { key = "popups", label = "Pop-up windows", layers = { "popups" } },
}

-- The layer every window of a group is in, or "mixed" when they differ.
function UI:GroupLayer(group)
    local common
    for _, key in ipairs(group.layers) do
        local strata = self:Layer(key)
        if common and strata ~= common then
            return "mixed"
        end
        common = strata
    end
    return common
end

-- The layers a group can be set to: up to the lowest highest-allowed layer of its windows.
function UI:GroupLayerChoices(group)
    local choices
    for _, key in ipairs(group.layers) do
        local list = self:LayerChoices(key)
        if not choices or #list < #choices then
            choices = list
        end
    end
    return choices or self.STRATA
end

function UI:SetGroupLayer(group, strata)
    for _, key in ipairs(group.layers) do
        self:SetLayer(key, strata)
    end
end

local layerEvents = CreateFrame("Frame")
layerEvents:RegisterEvent("PLAYER_REGEN_ENABLED")
layerEvents:SetScript("OnEvent", function()
    if layersWaiting then
        layersWaiting = false
        for _, layer in ipairs(UI.LAYERS) do
            applyLayer(layer.key)
        end
    end
end)

-- Window style ------------------------------------------------------------------------------------
-- Two looks, in four themes picked from the theme button in the main window's title bar (CRTDB.ui.theme,
-- UI:SetTheme; the themes and their palettes are in Themes.lua):
--   Classic  Default: Blizzard. The window template's own art, the game's red buttons and dropdowns,
--            the menu's groups (UI.MENU_GROUPS) under the game's Settings-menu header bars
--   Modern   every other theme, in its palette (CRT.PALETTE): a background-coloured window with accent lines under
--            the title and beside the menu, the menu in grouped blocks under small labels with the
--            selected page in the selected colour (and an accent bar on its left in a theme with menuBar), selected page
--            tabs, flat dropdowns and buttons, and Arial Narrow text unless another font is picked
--            (CRT:ApplyFonts)
-- UI:IsModern() is whether the theme is a Modern one (CRTDB.ui.modern, kept in step with the theme).
-- bgAlpha fades whichever background is showing, never the text or buttons (UI:ApplyOpacity, below).

local function rgba(key, alpha)
    local c = CRT.PALETTE[key]
    return c[1], c[2], c[3], alpha or 1
end

-- Window opacity ----------------------------------------------------------------------------------
-- CRTDB.ui.bgAlpha, General Settings' Opacity slider, in percent (30 to 100; its default is in Core.lua), is the
-- alpha of every CRT window's background: the main window (UI:Create) and every UI:StyleWindow window, so
-- every UI.Window dialog and pop-out. 100 is solid in both looks and every theme. What shows of the game
-- world through a window is 1 - bgAlpha / 100 (the background's coverage), however many layers it has:
--   Modern   one layer in each place. The flat background starts under the title row (TITLE_ROW), so it
--            never lies under it; the title row is the flat title, or a UI.Window's title strip
--            (Window.lua) with the flat title under it drawn at 0.
--   Classic  the template's tiled art over a solid background-colour layer (f.crtSolid; the art alone lets
--            the world show through). Layers that lie on top of each other split the coverage: a layer at
--            share e is drawn at 1 - (1 - a)^e and the shares in each place add up to 1, so the stack covers
--            exactly a (CLASSIC_SHARE). This counts the art as solid where it draws, so it is exact for the
--            layers we draw; the game's art adds a little of its own where its texture is see-through.
-- The window frame itself, its border, edges, accent line, text, buttons and tints are never faded. The
-- overlays with their own transparency (note windows, alerts, bars, raid windows) keep their own settings,
-- and a window styled opaque (UI:StyleWindow(f, { opaque = true }), the raider loot popup) stays solid.
UI.MIN_OPACITY, UI.MAX_OPACITY = 30, 100

-- the background's alpha, 0.3 to 1; with nothing saved, Core.lua's default
function UI:Opacity()
    local default = CRT.defaults and CRT.defaults.ui and CRT.defaults.ui.bgAlpha
    local v = tonumber(CRT.db and CRT.db.ui and CRT.db.ui.bgAlpha) or tonumber(default) or self.MAX_OPACITY
    return math.max(self.MIN_OPACITY, math.min(self.MAX_OPACITY, v)) / 100
end

-- The Modern title row's height from the window's top: the flat background starts under it.
UI.TITLE_ROW = 24

-- BasicFrameTemplateWithInset's background textures, by parentKey (Blizzard_UIPanelTemplates/Mainline/
-- UIPanelTemplates.xml, live): BasicFrameTemplate's Bg (the tiled rock, under the whole body), TitleBg
-- (the title) and TopTileStreaks (shading under the title), and the inset's InsetBg (the tiled marble, over
-- Bg; Inset.Bg where the inset is a frame of its own). Each with its share of the coverage; the solid layer
-- (solid) is under all of them. In the page area: solid + Bg + InsetBg = 1/4 + 1/4 + 1/2. In the title:
-- solid + TitleBg = 1/4 + 3/4. TopTileStreaks only shades and takes no share (drawn at 0 below 100%).
-- The border pieces are not listed and stay solid.
local CLASSIC_SHARE = { solid = 1 / 4, Bg = 1 / 4, InsetBg = 1 / 2, TitleBg = 3 / 4, TopTileStreaks = 0 }
UI.CLASSIC_SHARE = CLASSIC_SHARE -- for the harnesses
local CLASSIC_ART = { "Bg", "TitleBg", "TopTileStreaks", "InsetBg" }
-- the solid layer covers what the template's Bg and TitleBg cover, under its metal border
local SOLID_INSET = { left = 2, top = 1, right = 2, bottom = 2 }

-- A layer's alpha for its share e of coverage a. Share 0 is a layer that only shows when solid.
local function shareAlpha(a, e)
    if a >= 1 then
        return 1
    end
    if e <= 0 then
        return 0
    end
    return 1 - (1 - a) ^ e
end
UI.ShareAlpha = shareAlpha

-- The solid background-colour layer under a window's Classic art, made once.
local function solidLayer(f)
    if not rawget(f, "crtSolid") then
        local t = f:CreateTexture(nil, "BACKGROUND", nil, -8)
        t:SetPoint("TOPLEFT", SOLID_INSET.left, -SOLID_INSET.top)
        t:SetPoint("BOTTOMRIGHT", -SOLID_INSET.right, SOLID_INSET.bottom)
        f.crtSolid = t
    end
    return f.crtSolid
end

-- The opacity a window is drawn at: the slider's, or solid for a window styled opaque.
local function windowOpacity(f)
    return rawget(f, "crtOpaque") and 1 or UI:Opacity()
end

-- Paints one window's background: bg and title are its flat background and title row (title at 0 under a
-- UI.Window's title strip, which draws the row itself).
local function paintOpacity(f, bg, title, modern)
    local a = windowOpacity(f)
    bg:SetColorTexture(rgba("background", a))
    title:SetColorTexture(rgba("background", rawget(f, "crtTitled") and 0 or a))
    local solid = solidLayer(f)
    solid:SetShown(not modern)
    solid:SetColorTexture(rgba("background", shareAlpha(a, CLASSIC_SHARE.solid)))
    for _, key in ipairs(CLASSIC_ART) do
        local t = rawget(f, key)
        if type(t) == "table" and t.SetAlpha then
            t:SetAlpha(shareAlpha(a, CLASSIC_SHARE[key]))
        end
    end
    -- the inset, a frame of its own on some clients, has its own background in InsetBg's place
    local inset = rawget(f, "Inset")
    local insetBg = type(inset) == "table" and rawget(inset, "Bg")
    if type(insetBg) == "table" and insetBg.SetAlpha then
        insetBg:SetAlpha(shareAlpha(a, CLASSIC_SHARE.InsetBg))
    end
end

-- Paints the main window's background (UI:ApplyStyle, UI:ApplyOpacity).
local function paintMainOpacity(f)
    paintOpacity(f, f.flatBg, f.flatTitle, UI:IsModern())
end

-- Paints every window's background at the slider's opacity, live, for the slider: the main window, every
-- styled window and each window's title strip (a skinned part with crtOpacity, UI.TitleStrip). A theme
-- change paints them through UI:ApplyStyle instead.
function UI:ApplyOpacity()
    local modern = self:IsModern()
    local f = self.frame
    if f then
        paintMainOpacity(f)
    end
    for _, window in ipairs(self.windows) do
        paintOpacity(window, window.crtBg, window.crtTitle, modern)
    end
    for _, control in ipairs(self.skinned) do
        if type(rawget(control, "crtOpacity")) == "function" then
            control.crtOpacity()
        end
    end
end

-- The menu's groups, top to bottom, each under its header: its label, then its page keys in order. This is
-- the one place the menu's order is set. A page not listed joins the last group.
local TEXT = {
    general = "General",
    raidAdmin = "Raid Admin",
    bosses = "Bosses",
    modules = "Modules",
}
-- The title bar's version text: "v1.1.2", or "v1.1.2 build#004" in a developer copy with CRT.BUILD.
function UI.VersionText()
    local text = "v" .. tostring(CRT.version)
    if type(CRT.BUILD) == "number" then
        text = text .. string.format(" build#%03d", CRT.BUILD)
    end
    return text
end

UI.MENU_GROUPS = {
    { label = TEXT.general, "settings", "qol" },
    { label = TEXT.bosses, "timeline", "notes", "pace" },
    { label = TEXT.raidAdmin, "readycheck", "groups", "gearcheck", "late" },
    { label = TEXT.modules, "lootmaster", "loot", "requests", "seasonstats", "tattle" },
}

function UI:IsModern()
    return CRT.db and CRT.db.ui and CRT.db.ui.modern and true or false
end

-- The theme in use, a key from CRT.THEME_LIST.
function UI:Theme()
    local ui = CRT.db and CRT.db.ui
    return ui and CRT:ThemeInfo(ui.theme) and ui.theme or (self:IsModern() and CRT.THEME_MODERN or CRT.THEME_CLASSIC)
end

-- Repainting on a theme change. A part colored from CRT.PALETTE once, when it is made, is colored with
-- UI.Tint(region, method, key, alpha) instead: method is the setter ("SetColorTexture", "SetTextColor",
-- "SetVertexColor", "SetBackdropColor" or "SetBackdropBorderColor"), key a CRT.PALETTE key. A region keeps
-- one entry per setter. UI:SetTheme paints every tinted part again. A surface that reads CRT.PALETTE when
-- it draws registers UI:OnTheme(fn) and redraws there.
local tinted = setmetatable({}, { __mode = "k" })
local themedTexts = setmetatable({}, { __mode = "k" }) -- UI.ThemedText: font string -> its text builder
local themeHooks = {}

local function paintTint(region, method, t)
    local c = CRT.PALETTE[t.key]
    if c and region[method] then
        region[method](region, c[1], c[2], c[3], t.alpha or 1)
    end
end

function UI.Tint(region, method, key, alpha)
    local list = tinted[region]
    if not list then
        list = {}
        tinted[region] = list
    end
    local t = { key = key, alpha = alpha }
    list[method] = t
    paintTint(region, method, t)
end

function UI:OnTheme(fn)
    themeHooks[#themeHooks + 1] = fn
end

-- Runs after a theme change: the tinted parts, the OnTheme hooks, then the page in view and every open
-- window with a refresh function are refreshed (a page's OnShow script is its refresh), so text colored
-- when it is written (UI.GoodText) follows too. A failing hook never stops the others.
function UI:RepaintTheme()
    for region, list in pairs(tinted) do
        for method, t in pairs(list) do
            paintTint(region, method, t)
        end
    end
    for fs, build in pairs(themedTexts) do
        local ok, text = pcall(build)
        if ok then
            fs:SetText(text)
        end
    end
    for _, fn in ipairs(themeHooks) do
        local ok, err = pcall(fn)
        if not ok and geterrorhandler then
            geterrorhandler()(err)
        end
    end
    local page = self.frame and self.frame:IsShown() and CRT.db.lastPage and self.pages[CRT.db.lastPage]
    local onShow = page and page.frame and page.frame:IsShown() and page.frame:GetScript("OnShow")
    if onShow then
        pcall(onShow, page.frame)
    end
    for _, w in ipairs(self.windows) do
        if type(w.refresh) == "function" and w:IsShown() then
            pcall(w.refresh, w)
        end
    end
end

-- Switches the theme live: saves it (and ui.modern with it), fills CRT.PALETTE with its palette, then
-- redraws the fonts, every window and control, the theme button's label and everything that follows
-- the theme (UI:RepaintTheme).
function UI:SetTheme(key)
    local ui = CRT.db.ui
    ui.theme = key
    CRT:UseTheme(CRT:ResolveTheme(ui))
    CRT:ApplyFonts()
    self:ApplyStyle()
    self:RepaintTheme()
end

-- A compatibility shim for callers from before themes, which only knew on and off: on keeps a Modern
-- theme in use or takes Beanworks: Cowfee; off is Default: Blizzard.
function UI:SetModern(on)
    if on then
        self:SetTheme(self:IsModern() and self:Theme() or CRT.THEME_MODERN)
    else
        self:SetTheme(CRT.THEME_CLASSIC)
    end
end

-- The theme's name, for the theme button's label.
function UI:ThemeName()
    local info = CRT:ThemeInfo(self:Theme())
    return info and info.name or ""
end

-- The title bar's theme menu: one entry per theme, in CRT.THEME_LIST's order, the one in use ticked.
function UI:FillThemeMenu(root)
    for _, info in ipairs(CRT.THEME_LIST) do
        root:CreateRadio(info.name, function()
            return UI:Theme() == info.key
        end, function()
            UI:SetTheme(info.key)
        end)
    end
end

-- The theme's colours by palette key, for code that colours a part itself. Every theme has its own
-- heading, good, warn and bad colour; Default: Blizzard's are the game's gold, green, orange and
-- red. CRT_Dev/StyleGuide.md says which to use where.
--   UI.Color(key, alpha)    r, g, b, a for SetTextColor, SetVertexColor or SetColorTexture
--   UI.Hex(key)             "rrggbb" for |cff markup
--   UI.ColorText(text, key) the text in that colour
--   UI.GoodText(text)       good states: synced, answered, on, ready
--   UI.WarnText(text)       in-between states: running low, worn, arrived late, a middling score
--   UI.BadText(text)        bad states: late, failed, missing, can't
--   UI.HeadingText(text)    a heading or section title written in a string
-- A part coloured once, when it is made, follows a switch through UI.Tint (one colour) or UI.ThemedText
-- (a text built from these helpers).
-- [theme helpers] CRT_Dev/Tests/theme_stub.js loads the code from here to [/theme helpers] into harnesses.
function UI.Color(key, alpha)
    local c = CRT.PALETTE[key] or CRT.PALETTE.text
    return c[1], c[2], c[3], alpha or 1
end

function UI.Hex(key)
    local c = CRT.PALETTE[key] or CRT.PALETTE.text
    return string.format("%02x%02x%02x", math.floor(c[1] * 255 + 0.5), math.floor(c[2] * 255 + 0.5), math.floor(c[3] * 255 + 0.5))
end

function UI.ColorText(text, key)
    return "|cff" .. UI.Hex(key) .. text .. "|r"
end

function UI.GoodText(text)
    return UI.ColorText(text, "good")
end

function UI.WarnText(text)
    return UI.ColorText(text, "warn")
end

function UI.BadText(text)
    return UI.ColorText(text, "bad")
end

function UI.HeadingText(text)
    return UI.ColorText(text, "heading")
end

-- Sets a font string's text to build() now and again after every theme switch, for a text written once
-- with colour markup from the helpers above. UI.ThemedText(fs, nil) stops that and leaves the text as it is.
function UI.ThemedText(fs, build)
    themedTexts[fs] = build
    if build then
        fs:SetText(build())
    end
end
-- [/theme helpers]

-- Backdrop frames outside the main window that follow the look: your bar, its drag and Close bars,
-- and the ready check window. Each keeps its Classic colours; in Modern its background turns the theme's background
-- (keeping its own opacity) and its outline the accent.
UI.themed = {}

function UI:ApplyThemed(f)
    local c = f.crtClassic
    if self:IsModern() then
        local bg, edge = CRT.PALETTE.background, CRT.PALETTE.accent
        f:SetBackdropColor(bg[1], bg[2], bg[3], c.bg[4])
        f:SetBackdropBorderColor(edge[1], edge[2], edge[3], 1)
    else
        f:SetBackdropColor(c.bg[1], c.bg[2], c.bg[3], c.bg[4])
        f:SetBackdropBorderColor(c.border[1], c.border[2], c.border[3], 1)
    end
end

-- classic = { bg = { r, g, b, a }, border = { r, g, b } }, the frame's colours in the Classic look.
function UI:RegisterThemed(f, classic)
    f.crtClassic = classic
    self.themed[#self.themed + 1] = f
    self:ApplyThemed(f)
end

-- The game's grey stone: the tiled marble behind the main window's inset (BasicFrameTemplateWithInset's
-- InsetBg in Blizzard_UIPanelTemplates/Mainline/UIPanelTemplates.xml, live: horizTile and vertTile). It
-- tiles at its own size, so any frame gets it unstretched. (The roll frame's own background, a 277 by 67
-- part of LootToast, blurred when stretched and showed its baked-in name box.) For Default: Blizzard
-- surfaces drawn like the roll frame (the raider loot popup's items, the Timeline's chips).
-- UI.Stone(frame, layer, sublevel, inset) returns the texture, covering the frame less inset on each side
-- (default 0), on layer (default "BACKGROUND") and sublevel (default 0); show or hide it with the look.
-- The roll frame's border sits about 4.5 px outside its background, so a frame with that border insets
-- the stone by about 4.
-- UI.LootToastPiece(frame, layer, coords, sublevel) is a part of the roll frame's LootToast texture
-- (UI.LOOT_TOAST), cut out by texture coordinates and unanchored.
UI.LOOT_TOAST = "Interface\\LootFrame\\LootToast"
UI.STONE = { file = "Interface\\FrameGeneral\\UI-Background-Marble" }

function UI.LootToastPiece(frame, layer, coords, sublevel)
    local t = frame:CreateTexture(nil, layer or "BACKGROUND", nil, sublevel or 0)
    t:SetTexture(UI.LOOT_TOAST)
    t:SetTexCoord(coords[1], coords[2], coords[3], coords[4])
    return t
end

function UI.Stone(frame, layer, sublevel, inset)
    local t = frame:CreateTexture(nil, layer or "BACKGROUND", nil, sublevel or 0)
    t:SetTexture(UI.STONE.file, "REPEAT", "REPEAT")
    t:SetHorizTile(true)
    t:SetVertTile(true)
    inset = inset or 0
    t:SetPoint("TOPLEFT", inset, -inset)
    t:SetPoint("BOTTOMRIGHT", -inset, inset)
    return t
end

-- Floating windows: a window of its own made from BasicFrameTemplateWithInset, such as the alert
-- editor, its export box, the dev tools and the text and import dialogs. Classic shows the template's
-- own art; Modern a flat background with a border, an accent line under the title and
-- the plain X.
-- Call StyleWindow right after CreateFrame, before adding anything, so only the template's own
-- textures count as its art. Its buttons and dropdowns are skinned now and each time it shows.
-- opts.titled: a title strip of its own (UI.Window) draws the title row, so the flat title under it is drawn
-- at 0. opts.opaque keeps it solid whatever the Opacity slider says (a window over the game mid-raid, the raider
-- loot popup).
UI.windows = {}

-- CRT's windows, for the one lookup of the window something sits in: the main window (UI:Create), every
-- floating window on UIParent (UI:StyleWindow, so every UI.Window dialog and pop-out) and UI.Window's
-- overlays.
-- UI.WindowOf(region) walks a frame's (or font string's) parents up to the first of them; nil when it is in
-- none, such as the minimap button. UI/Tooltip.lua places a picked tooltip spot outside that window.
local crtWindows = {}
local WINDOW_DEPTH = 100 -- parents walked at most

function UI.AddWindow(f)
    if f then
        crtWindows[f] = true
    end
    return f
end

function UI.WindowOf(region)
    local f = region
    for _ = 1, WINDOW_DEPTH do
        if type(f) ~= "table" then
            return nil
        end
        if crtWindows[f] then
            return f
        end
        f = type(f.GetParent) == "function" and f:GetParent() or nil
    end
    return nil
end

function UI:ApplyWindow(f)
    local modern = self:IsModern()
    for _, texture in ipairs(f.crtArt) do
        texture:SetShown(not modern)
    end
    f.crtBg:SetShown(modern)
    f.crtTitle:SetShown(modern)
    paintOpacity(f, f.crtBg, f.crtTitle, modern)
    for _, edge in ipairs(f.crtEdges) do
        edge:SetShown(modern)
        edge:SetColorTexture(rgba("border"))
    end
    f.crtTitleLine:SetShown(modern)
    f.crtTitleLine:SetColorTexture(rgba("accent"))
    -- the template's inset (its own frame on some clients) is part of the Classic art
    if type(f.Inset) == "table" and f.Inset.SetShown then
        f.Inset:SetShown(not modern)
    end
end

function UI:StyleWindow(f, opts)
    if f.crtArt then
        return
    end
    f.crtArt = {}
    f.crtOpaque = opts and opts.opaque and true or false
    f.crtTitled = opts and opts.titled and true or false
    for _, region in ipairs({ f:GetRegions() }) do
        if region:GetObjectType() == "Texture" then
            f.crtArt[#f.crtArt + 1] = region
        end
    end
    f.crtBg = f:CreateTexture(nil, "BACKGROUND", nil, -8)
    -- under the title row, so the title row is one layer (Window opacity, above)
    f.crtBg:SetPoint("TOPLEFT", 0, -UI.TITLE_ROW)
    f.crtBg:SetPoint("BOTTOMRIGHT")
    -- the title strip, as on the main window
    f.crtTitle = f:CreateTexture(nil, "BACKGROUND", nil, -7)
    f.crtTitle:SetPoint("TOPLEFT", 1, -1)
    f.crtTitle:SetPoint("TOPRIGHT", -1, -1)
    f.crtTitle:SetHeight(23)
    f.crtEdges = {}
    for _, side in ipairs({ { "TOPLEFT", "TOPRIGHT", true }, { "BOTTOMLEFT", "BOTTOMRIGHT", true }, { "TOPLEFT", "BOTTOMLEFT", false }, { "TOPRIGHT", "BOTTOMRIGHT", false } }) do
        local edge = f:CreateTexture(nil, "BORDER")
        edge:SetPoint(side[1])
        edge:SetPoint(side[2])
        if side[3] then
            edge:SetHeight(1)
        else
            edge:SetWidth(1)
        end
        f.crtEdges[#f.crtEdges + 1] = edge
    end
    f.crtTitleLine = f:CreateTexture(nil, "BORDER")
    f.crtTitleLine:SetPoint("TOPLEFT", 1, -24)
    f.crtTitleLine:SetPoint("TOPRIGHT", -1, -24)
    f.crtTitleLine:SetHeight(1)
    self:SkinCloseButton(f.CloseButton)
    self.windows[#self.windows + 1] = f
    -- a window of its own, on the screen; not a styled frame inside another window (the raider popup's
    -- frame art), so what is in it is in that window
    if f:GetParent() == UIParent then
        UI.AddWindow(f)
    end
    f:HookScript("OnShow", function()
        UI:SkinTree(f)
    end)
    self:ApplyWindow(f)
    self:SkinTree(f)
end

-- The vertical divider between the menu and the page area, in the 8 px gap between them.
-- Sizes in px; colours are { r, g, b, a }, or a CRT.PALETTE key. Default: Blizzard draws a dark gold-brown
-- line like the game's frame trim with a darker shadow beside it; the Modern themes draw one thin line
-- in their edge colour.
local DIVIDER = {
    left = 2, -- px from the menu's right edge to the line's left
    classic = { width = 2, color = { 0.45, 0.33, 0.12, 1 }, shadowWidth = 1, shadow = { 0.05, 0.03, 0.01, 0.9 } },
    modern = { width = 1, key = "border" },
}

function UI:StyleDivider(alpha)
    local f = self.frame
    local d = f and f.divider
    if not d then
        return
    end
    local modern = self:IsModern()
    local look = modern and DIVIDER.modern or DIVIDER.classic
    d.line:SetWidth(look.width)
    if look.key then
        d.line:SetColorTexture(rgba(look.key, alpha))
    else
        local c = look.color
        d.line:SetColorTexture(c[1], c[2], c[3], c[4] * alpha)
    end
    d.shadow:SetShown(not modern)
    if not modern then
        local c = look.shadow
        d.shadow:SetWidth(look.shadowWidth)
        d.shadow:SetColorTexture(c[1], c[2], c[3], c[4] * alpha)
    end
end

function UI:ApplyStyle()
    for _, themed in ipairs(self.themed) do
        self:ApplyThemed(themed)
    end
    for _, window in ipairs(self.windows) do
        self:ApplyWindow(window)
    end
    -- the theme button's label; the skinned controls below size it
    if self.lookButton then
        self.lookButton:SetText(self:ThemeName())
    end
    local f = self.frame
    if not f then
        for _, control in ipairs(self.skinned) do
            control.crtSkin(self:IsModern())
        end
        return
    end
    local modern = self:IsModern()
    -- the template's art at full alpha; paintMainOpacity below fades its background pieces only
    local alpha = 1
    for _, texture in ipairs(f.art) do
        texture:SetShown(not modern)
        texture:SetAlpha(alpha)
    end
    for _, texture in ipairs(f.flat) do
        texture:SetShown(modern)
    end
    -- Opacity (bgAlpha) is the background's coverage; the window itself, its text and its buttons are
    -- never faded. The other windows were painted by UI:ApplyWindow above, their strips by their crtSkin.
    paintMainOpacity(f)
    for _, edge in ipairs(f.flatEdges) do
        edge:SetColorTexture(rgba("border", alpha))
    end
    f.titleLine:SetColorTexture(rgba("accent", alpha))
    f.titleLine:SetShown(modern)
    self:StyleDivider(alpha)
    self:LayoutMenu()
    self:StyleMinimizeButton()
    for _, b in ipairs(self.tabs) do
        self:StyleTab(b, b.selected)
    end
    for _, control in ipairs(self.skinned) do
        control.crtSkin(modern)
    end
end

-- Flat controls for the Modern look. Each control gets its own flat background, a 1-pixel border and
-- (for a dropdown) a small arrow, shown in Modern, while the game's art is faded out; Classic puts
-- the game's art back. UI.skinned lists every control so ApplyStyle can switch them.
UI.skinned = {}

local function flatSkin(frame, inset)
    inset = inset or 0
    local bg = frame:CreateTexture(nil, "BACKGROUND", nil, -6)
    bg:SetPoint("TOPLEFT", inset, -inset)
    bg:SetPoint("BOTTOMRIGHT", -inset, inset)
    local edges = {}
    for _, side in ipairs({ { "TOPLEFT", "TOPRIGHT", true }, { "BOTTOMLEFT", "BOTTOMRIGHT", true }, { "TOPLEFT", "BOTTOMLEFT", false }, { "TOPRIGHT", "BOTTOMRIGHT", false } }) do
        local e = frame:CreateTexture(nil, "BORDER", nil, -6)
        e:SetPoint(side[1], bg, side[1])
        e:SetPoint(side[2], bg, side[2])
        if side[3] then
            e:SetHeight(1)
        else
            e:SetWidth(1)
        end
        edges[#edges + 1] = e
    end
    return bg, edges
end

local function setFlat(bg, edges, shown, fill)
    bg:SetShown(shown)
    bg:SetColorTexture(rgba(fill or "surface"))
    for _, e in ipairs(edges) do
        e:SetShown(shown)
        e:SetColorTexture(rgba("border"))
    end
end

-- A WowStyle1DropdownTemplate dropdown (UI.Dropdown makes them).
function UI:SkinDropdown(d)
    if d.crtSkin or not (d.Background and d.Arrow) then
        return
    end
    local bg, edges = flatSkin(d, 0)
    local arrow = d:CreateTexture(nil, "OVERLAY")
    arrow:SetAtlas("auctionhouse-ui-dropdown-arrow-down")
    arrow:SetSize(12, 8)
    arrow:SetPoint("RIGHT", -7, 0)
    d.crtSkin = function(modern)
        d.Background:SetAlpha(modern and 0 or 1)
        d.Arrow:SetAlpha(modern and 0 or 1)
        setFlat(bg, edges, modern)
        arrow:SetShown(modern)
        arrow:SetVertexColor(rgba("accent"))
    end
    self.skinned[#self.skinned + 1] = d
    d.crtSkin(self:IsModern())
end

-- An InputBoxTemplate edit box: flat like a dropdown in Modern, the template's Left, Middle and Right art
-- in Classic. The flat box starts 5 pixels left of the frame, where the template's art starts, so the
-- text keeps a little room either way.
local EDIT_ART_OUT = 5

function UI:SkinEditBox(e)
    if type(e) ~= "table" or e.crtSkin then
        return
    end
    local bg, edges = flatSkin(e, 0)
    bg:ClearAllPoints()
    bg:SetPoint("TOPLEFT", -EDIT_ART_OUT, 0)
    bg:SetPoint("BOTTOMRIGHT", 0, 0)
    local art = {}
    for _, key in ipairs({ "Left", "Middle", "Right" }) do
        if type(e[key]) == "table" and e[key].SetAlpha then
            art[#art + 1] = e[key]
        end
    end
    e.crtSkin = function(modern)
        for _, t in ipairs(art) do
            t:SetAlpha(modern and 0 or 1)
        end
        setFlat(bg, edges, modern)
    end
    self.skinned[#self.skinned + 1] = e
    e.crtSkin(self:IsModern())
end

-- A UIPanelButtonTemplate button: its Left, Middle and Right art and its red highlight.
-- A close button (UIPanelCloseButton, or the window template's own): in Modern, a plain X in place
-- of the game's red and gold button art, the text colour, turning the accent on hover.
function UI:SkinCloseButton(b)
    if type(b) ~= "table" or b.crtSkin then
        return
    end
    local x = b:CreateFontString(nil, "OVERLAY")
    x:SetFont("Fonts\\ARIALN.TTF", 18, "")
    x:SetPoint("CENTER", 0, 1)
    x:SetText("X")
    local hover = false
    local function color()
        x:SetTextColor(rgba(hover and "accent" or "text"))
    end
    b:HookScript("OnEnter", function()
        hover = true
        color()
    end)
    b:HookScript("OnLeave", function()
        hover = false
        color()
    end)
    b.crtSkin = function(modern)
        for _, get in ipairs({ "GetNormalTexture", "GetPushedTexture", "GetHighlightTexture", "GetDisabledTexture" }) do
            local texture = b[get] and b[get](b)
            if texture then
                texture:SetAlpha(modern and 0 or 1)
            end
        end
        x:SetShown(modern)
        color()
    end
    self.skinned[#self.skinned + 1] = b
    b.crtSkin(self:IsModern())
end

function UI:SkinButton(b)
    if b.crtSkin or not (b.Left and b.Middle and b.Right) then
        return
    end
    local bg, edges = flatSkin(b, 1)
    local hover = b:CreateTexture(nil, "HIGHLIGHT")
    hover:SetAllPoints(bg)
    hover:SetColorTexture(1, 1, 1, 0.08)
    local highlight = b:GetHighlightTexture()
    b.crtSkin = function(modern)
        for _, art in ipairs({ b.Left, b.Middle, b.Right }) do
            art:SetAlpha(modern and 0 or 1)
        end
        if highlight then
            highlight:SetAlpha(modern and 0 or 1)
        end
        hover:SetAlpha(modern and 1 or 0)
        setFlat(bg, edges, modern)
    end
    self.skinned[#self.skinned + 1] = b
    b.crtSkin(self:IsModern())
end

-- A UIPanelButtonTemplate button made outside a panel page (where SkinTree doesn't reach), such as in a
-- window: as wide as its label plus room for the template's end caps (its highlight is inset 12 on each
-- side), so the label fits in Classic and Modern, and skinned by UI:SkinButton, so it follows the look.
UI.PANEL_BUTTON_PAD = 14 -- each side
UI.PANEL_BUTTON_MIN_W = 40

function UI.PanelButtonWidth(labelWidth)
    return math.max(UI.PANEL_BUTTON_MIN_W, math.ceil(labelWidth or 0) + 2 * UI.PANEL_BUTTON_PAD)
end

function UI.PanelButton(parent, label, height, onClick)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetText(label)
    local fs = b:GetFontString()
    b:SetSize(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0), height)
    b:SetScript("OnClick", onClick)
    UI:SkinButton(b)
    return b
end

-- A UICheckButtonTemplate checkbox. Modern hides the template's art and draws a CHECK_SIZE box with
-- rounded corners (UI.RoundRect) in its centre: unticked, a surface fill with a selected edge; ticked, the
-- slider knob's bevelled look in the knob colour (a checkBorder edge, a soft line inside the top edge) with a tick
-- (CRT_Media/Media/Check.tga) in the theme's check color. The edge turns the accent under the mouse; a
-- disabled box is faded to CHECK_OFF_ALPHA. Classic shows the template's art again. The page's label and click are untouched.
-- The box follows SetChecked, clicks, SetEnabled / Enable / Disable and the mouse through hooks, so
-- pages call nothing new. cb.crtCheck keeps the parts.
local CHECK_SIZE, CHECK_R, CHECK_TICK = 16, 4, 12
local CHECK_OFF_ALPHA = 0.4
local CHECK_ART = { "GetNormalTexture", "GetPushedTexture", "GetHighlightTexture", "GetCheckedTexture",
    "GetDisabledCheckedTexture", "GetDisabledTexture" }
local TICK = (CRT.MEDIA or ("Interface\\AddOns\\" .. ADDON .. "\\CRT_Media\\Media\\")) .. "Check" -- the fallback is for test harnesses without Core.lua

local function paintCheck(cb)
    local s = cb.crtCheck
    local on = cb:GetChecked() and true or false
    local enabled = cb:IsEnabled() and true or false
    local alpha = enabled and 1 or CHECK_OFF_ALPHA
    for _, t in ipairs(s.textures) do
        t:SetShown(s.modern)
    end
    s.shine:SetShown(s.modern and on)
    s.tick:SetShown(s.modern and on)
    if not s.modern then
        return
    end
    -- only a box that can be clicked lights up under the mouse
    UI.PaintShape(s.box.edge, (s.hover and enabled) and "accent" or (on and "checkBorder" or "selected"), alpha)
    UI.PaintShape(s.box.face, on and "knob" or "surface", alpha)
    s.shine:SetColorTexture(rgba("knobShine", alpha))
    s.tick:SetVertexColor(rgba("check", alpha))
end

function UI:SkinCheckButton(cb)
    if type(cb) ~= "table" or cb.crtSkin then
        return
    end
    -- the box's area, a hidden texture the shapes are drawn over
    local area = cb:CreateTexture(nil, "BACKGROUND")
    area:SetSize(CHECK_SIZE, CHECK_SIZE)
    area:SetPoint("CENTER")
    area:Hide()
    local s = { size = CHECK_SIZE, radius = CHECK_R, modern = false, hover = false, textures = {} }
    s.box = { edge = UI.RoundRect(cb, area, "ARTWORK", 0, CHECK_R, 0), face = UI.RoundRect(cb, area, "ARTWORK", 1, CHECK_R - 1, 1) }
    s.shine = cb:CreateTexture(nil, "ARTWORK", nil, 2)
    s.shine:SetPoint("TOPLEFT", area, "TOPLEFT", CHECK_R, -1)
    s.shine:SetPoint("TOPRIGHT", area, "TOPRIGHT", -CHECK_R, -1)
    s.shine:SetHeight(1)
    s.tick = cb:CreateTexture(nil, "OVERLAY")
    s.tick:SetTexture(TICK)
    s.tick:SetSize(CHECK_TICK, CHECK_TICK)
    s.tick:SetPoint("CENTER", area, "CENTER")
    for _, shape in ipairs({ s.box.edge, s.box.face }) do
        for _, list in ipairs({ shape.corners, shape.fills }) do
            for _, t in ipairs(list) do
                s.textures[#s.textures + 1] = t
            end
        end
    end
    cb.crtCheck = s

    local function paint()
        paintCheck(cb)
    end
    for _, method in ipairs({ "SetChecked", "SetEnabled", "Enable", "Disable" }) do
        hooksecurefunc(cb, method, paint)
    end
    cb:HookScript("PostClick", paint)
    cb:HookScript("OnShow", paint)
    cb:HookScript("OnEnter", function()
        s.hover = true
        paint()
    end)
    cb:HookScript("OnLeave", function()
        s.hover = false
        paint()
    end)

    cb.crtSkin = function(modern)
        s.modern = modern and true or false
        for _, get in ipairs(CHECK_ART) do
            local texture = cb[get] and cb[get](cb)
            if texture then
                texture:SetAlpha(modern and 0 or 1)
            end
        end
        paint()
    end
    self.skinned[#self.skinned + 1] = cb
    cb.crtSkin(self:IsModern())
end

-- Skins every panel button, dropdown and checkbox under a frame. Pages call nothing themselves: the
-- panel runs this when a page is built or shown, and when a page tab changes, so controls made later
-- are caught too. A checkbox has the template's pushed and disabled-checked art, which a radio button
-- (UIRadioButtonTemplate) has not, so radio buttons keep the game's look.
function UI:SkinTree(frame)
    for _, child in ipairs({ frame:GetChildren() }) do
        if not child.crtSkin then
            if child.Left and child.Middle and child.Right and child:GetObjectType() == "Button" then
                self:SkinButton(child)
            elseif child.Background and child.Arrow and child.SetupMenu then
                self:SkinDropdown(child)
            elseif child.GetObjectType and child:GetObjectType() == "CheckButton" and child:GetPushedTexture()
                and child:GetDisabledCheckedTexture() then
                self:SkinCheckButton(child)
            end
        end
        self:SkinTree(child)
    end
end

-- The menu: the groups of UI.MENU_GROUPS, each under its header, placed for both looks by one function
-- (UI.MenuLayout). Default: Blizzard draws each header as the game's Settings-menu category bar with its
-- pages as gold entries under it; a Modern theme draws a small muted label over each group's box. When the
-- groups are taller than the menu, the menu scrolls with the theme's scroll bar.
-- Every number the menu is placed with, in px:
--   row, rowGap   a page's button and the space under it
--   groupGap      between one group's last page and the next group's header
--   classic       headerGap: between the header bar and its first page; textX: a page's label from the
--                 left; labelX: the header's label from the left; art: the header's atlas. The game's
--                 Settings panel gives its headers Options_CategoryHeader_1 to _3 in turn, at the atlas's
--                 size, 199 x 144 (Gethe/wow-ui-source live, Blizzard_Settings_Shared/Blizzard_CategoryList.lua,
--                 SettingsCategoryListHeaderMixin:Init). The bar is the art's top 32 px; under it two faint
--                 lines run down the sides, behind the entries. The menu scales the art to its own width and
--                 clips it to the bar, so the lines never cross a page, its highlight or the divider.
--   modern        header: the label's line over each box; pad: inside the box, above the first page and
--                 below the last; boxRight: the box ends this far from the right; buttonLeft, buttonRight: a
--                 page's button inside the box; labelX: the label from the left
-- Tightened for 14 pages (Development included) to fit the 560 px page height in Classic, whose header bars
-- are taller than Modern's labels (job 20261022-requests).
UI.MENU_LAYOUT = {
    row = 30,
    rowGap = 1,
    classic = {
        groupGap = 6,
        headerGap = 1,
        textX = 10,
        labelX = 10,
        art = { atlas = "Options_CategoryHeader_", count = 3, w = 199, h = 144, bar = 32 },
    },
    modern = {
        groupGap = 8,
        header = 16,
        pad = 2,
        boxRight = 6,
        buttonLeft = 2,
        buttonRight = 8,
        labelX = 4,
    },
}
local MENU_BAR_W = 2 -- the selected page's accent bar on its left, in a theme with menuBar

-- The groups the menu shows, as { label, keys }: the pages in UI.MENU_GROUPS's order, a page not listed in
-- the last group, hidden pages left out, and a group with no page to show left out.
local function menuGroups()
    local groups, placed = {}, {}
    for _, group in ipairs(UI.MENU_GROUPS) do
        local keys = {}
        for _, key in ipairs(group) do
            if UI.pages[key] then
                keys[#keys + 1] = key
                placed[key] = true
            end
        end
        groups[#groups + 1] = { label = group.label, keys = keys }
    end
    for _, key in ipairs(UI.order) do
        if not placed[key] and groups[#groups] then
            table.insert(groups[#groups].keys, key)
        end
    end
    local shown = {}
    for _, group in ipairs(groups) do
        for i = #group.keys, 1, -1 do
            if UI.pages[group.keys[i]].hidden then
                table.remove(group.keys, i)
            end
        end
        if #group.keys > 0 then
            shown[#shown + 1] = group
        end
    end
    return shown
end
UI.MenuGroups = menuGroups

-- Where everything in the menu goes, in either look, for groups (menuGroups) in a menu width x height.
-- y is down from the menu's top, so 0 or less. Returns
--   width    the room the groups have: the menu's width, less the scroll bar's when it scrolls
--   height   the groups' whole height
--   scroll   true when that is more than the menu's height
--   headers  { label, y, h, art }: art is the header's atlas in Classic, nil in Modern
--   boxes    { y, h, right } in Modern: each group's box, right its inset from the right
--   pages    { key, y, left, right }: each page's button, left and right its insets from the edges
function UI.MenuLayout(groups, modern, width, height)
    local L = UI.MENU_LAYOUT
    local look = modern and L.modern or L.classic
    local step = L.row + L.rowGap
    local function place(w)
        local out = { width = w, headers = {}, boxes = {}, pages = {} }
        local y = 0
        for i, group in ipairs(groups) do
            if i > 1 then
                y = y - look.groupGap
            end
            local h, art, left, right = look.header, nil, 0, 0
            if not modern then
                local a = look.art
                h = math.floor(w * a.bar / a.w + 0.5)
                art = a.atlas .. ((i - 1) % a.count + 1)
            end
            out.headers[#out.headers + 1] = { label = group.label, y = y, h = h, art = art }
            y = y - h
            if modern then
                -- pad above the first page's button and below the last one's (its rowGap is inside the box)
                out.boxes[#out.boxes + 1] = { y = y, h = 2 * look.pad + #group.keys * step - L.rowGap, right = look.boxRight }
                y = y - look.pad
                left, right = look.buttonLeft, look.buttonRight
            else
                y = y - look.headerGap
            end
            for _, key in ipairs(group.keys) do
                out.pages[#out.pages + 1] = { key = key, y = y, left = left, right = right }
                y = y - step
            end
            if modern then
                y = y + L.rowGap - look.pad -- the box ends pad under the last button
            end
        end
        out.height = -y
        return out
    end
    local out = place(width)
    if math.floor(out.height - height) > 0 then
        out = place(width - UI.ScrollGutter())
        out.scroll = true
    end
    return out
end

-- The menu's frames, top left in the main window beside the page area: a scroll frame filling it and the
-- frame it scrolls (menu.inner), which holds the headers, the Modern boxes and the page buttons. The
-- scroll bar shows only while the groups don't fit: scrollBarHideable makes the template's
-- ScrollFrame_OnScrollRangeChanged hide it at no range (Blizzard_SharedXML/SecureScrollTemplates.lua).
function UI:CreateMenu(f)
    local menu = CreateFrame("Frame", nil, f)
    menu:SetPoint("TOPLEFT", f, "TOPLEFT", 8, -32)
    menu:SetPoint("BOTTOMLEFT", f, "BOTTOMLEFT", 8, 8)
    menu:SetWidth(MENU_W)
    menu.blocks, menu.headers = {}, {}
    local scroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsMenuScroll", menu, "UIPanelScrollFrameTemplate")
    if UI.SkinScrollBar then
        UI:SkinScrollBar(scroll.ScrollBar)
    end
    scroll:SetPoint("TOPLEFT")
    scroll:SetPoint("BOTTOMRIGHT")
    scroll.scrollBarHideable = true
    if scroll.ScrollBar then
        scroll.ScrollBar:Hide()
    end
    local inner = CreateFrame("Frame", nil, scroll)
    inner:SetSize(MENU_W, 1)
    scroll:SetScrollChild(inner)
    menu.scroll, menu.inner = scroll, inner
    return menu
end

-- A group's header, made the first time: a frame that clips to the header's height, with the art and the
-- label on a child, so Classic's whole atlas shows only its bar.
local function menuHeader(menu, i)
    local h = menu.headers[i]
    if h then
        return h
    end
    h = CreateFrame("Frame", nil, menu.inner)
    h:SetClipsChildren(true)
    h.face = CreateFrame("Frame", nil, h)
    h.face:SetPoint("TOPLEFT")
    h.art = h.face:CreateTexture(nil, "ARTWORK")
    h.art:SetPoint("TOPLEFT")
    h.label = h.face:CreateFontString(nil, "OVERLAY", "CRTFontHighlight")
    h.label:SetJustifyH("LEFT")
    menu.headers[i] = h
    return h
end

function UI:LayoutMenu()
    local f = self.frame
    if not f then
        return
    end
    local menu, modern = f.menu, self:IsModern()
    local look = modern and UI.MENU_LAYOUT.modern or UI.MENU_LAYOUT.classic
    local lay = UI.MenuLayout(menuGroups(), modern, MENU_W, UI.PAGE_H)
    menu.layout = lay
    local inner, scroll = menu.inner, menu.scroll
    inner:SetSize(lay.width, math.max(1, lay.height))
    scroll:ClearAllPoints()
    scroll:SetPoint("TOPLEFT")
    scroll:SetPoint("BOTTOMRIGHT", lay.width - MENU_W, 0)
    -- the wheel scrolls the menu only while it scrolls, so Ctrl + wheel over it still sizes the window
    scroll:EnableMouseWheel(lay.scroll and true or false)
    if not lay.scroll then
        scroll:SetVerticalScroll(0)
    end
    for _, h in ipairs(menu.headers) do
        h:Hide()
    end
    for _, bg in ipairs(menu.blocks) do
        bg:Hide()
    end
    for i, item in ipairs(lay.headers) do
        local h = menuHeader(menu, i)
        h:ClearAllPoints()
        h:SetPoint("TOPLEFT", inner, "TOPLEFT", 0, item.y)
        h:SetSize(lay.width, item.h)
        h.art:SetShown(item.art ~= nil)
        h.label:ClearAllPoints()
        h.label:SetPoint("LEFT", h, "LEFT", look.labelX, 0)
        if item.art then
            local artH = lay.width * look.art.h / look.art.w
            h.art:SetAtlas(item.art)
            h.art:SetSize(lay.width, artH)
            h.face:SetSize(lay.width, artH)
            h.label:SetFontObject("CRTFontHighlight")
            h.label:SetTextColor(1, 1, 1)
        else
            h.face:SetSize(lay.width, item.h)
            h.label:SetFontObject("CRTFontSmall")
            h.label:SetTextColor(rgba("muted"))
        end
        h.label:SetText(item.label)
        h:Show()
    end
    for i, box in ipairs(lay.boxes) do
        local bg = menu.blocks[i]
        if not bg then
            bg = inner:CreateTexture(nil, "BACKGROUND", nil, -1)
            menu.blocks[i] = bg
        end
        bg:SetColorTexture(rgba("surface", 0.95))
        bg:ClearAllPoints()
        bg:SetPoint("TOPLEFT", inner, "TOPLEFT", 0, box.y)
        bg:SetPoint("TOPRIGHT", inner, "TOPRIGHT", -box.right, box.y)
        bg:SetHeight(box.h)
        bg:Show()
    end
    for _, p in ipairs(lay.pages) do
        local b = self.pages[p.key].button
        b:ClearAllPoints()
        b:SetPoint("TOPLEFT", inner, "TOPLEFT", p.left, p.y)
        b:SetPoint("TOPRIGHT", inner, "TOPRIGHT", -p.right, p.y)
        b.text:ClearAllPoints()
        if modern then
            b.text:SetPoint("CENTER")
        else
            b.text:SetPoint("LEFT", look.textX, 0)
        end
    end
    for _, page in pairs(self.pages) do
        if page.button then
            page.button:SetShown(not page.hidden)
            self:StyleMenuButton(page.button, page.button.selected)
        end
    end
end

function UI:StyleMenuButton(b, selected)
    b.selected = selected and true or false
    b.sel:SetShown(b.selected)
    local theme = CRT.theme
    b.bar:SetShown(b.selected and self:IsModern() and theme and theme.menuBar and true or false)
    b.bar:SetColorTexture(rgba("accent"))
    if self:IsModern() then
        b.sel:SetColorTexture(rgba("selected", 0.95))
        if b.selected then
            b.text:SetTextColor(rgba("text"))
        else
            b.text:SetTextColor(rgba("label"))
        end
    else
        b.sel:SetColorTexture(1, 0.82, 0, 0.18)
        if b.selected then
            b.text:SetTextColor(1, 0.82, 0)
        else
            b.text:SetTextColor(0.85, 0.85, 0.85)
        end
    end
end

-- Page tabs. A page registers each tab button (a BackdropTemplate button with .sel and .text) when it
-- makes it, and calls SetTabSelected when its tab changes, so the tabs follow the look.
UI.tabs = {}

function UI:RegisterTab(b)
    self.tabs[#self.tabs + 1] = b
    self:StyleTab(b, false)
end

function UI:StyleTab(b, selected)
    b.selected = selected and true or false
    b.sel:SetShown(b.selected)
    local modern = self:IsModern()
    if modern then
        b.sel:SetColorTexture(rgba("selected", 0.95))
        b.text:SetTextColor(rgba(b.selected and "text" or "label"))
    else
        b.sel:SetColorTexture(1, 0.82, 0, 0.18)
        if b.selected then
            b.text:SetTextColor(1, 0.82, 0)
        else
            b.text:SetTextColor(0.75, 0.75, 0.75)
        end
    end
    if b.SetBackdropBorderColor then
        if modern then
            b:SetBackdropColor(rgba("surface", 0.95))
            b:SetBackdropBorderColor(rgba("border"))
        else
            b:SetBackdropColor(0, 0, 0, 0.4)
            b:SetBackdropBorderColor(0.35, 0.35, 0.35, 1)
        end
    end
end

function UI:SetTabSelected(b, selected)
    self:StyleTab(b, selected)
    -- A tab's content may be built only now, so its buttons are skinned here.
    if selected and b:GetParent() then
        self:SkinTree(b:GetParent())
    end
end

-- A small help icon that shows an explanation as a tooltip, used for every bit of extra context so the
-- pages stay compact. text is a string, with paragraphs split on blank lines, or a function returning
-- one, for text that changes (title may be a function too). Pages make it with UI.HelpRight (below), which places it.
-- Classic draws the game's gold "i" from the Appearances tab (MainHelpPlateButton in
-- Blizzard_HelpPlate.xml: the "i", the ring and the additive hover glow) at HELP_SCALE, keeping the
-- template's offsets, without inheriting its 64 px frame or its pulse. Modern draws a thin accent ring
-- (CRT_Media/Media/RingMedium.tga) round an accent "i"; under the mouse it fills with the accent
-- (CRT_Media/Media/Disc.tga) and the "i" turns the background colour. Its colours are UI.Tint keys, so a theme
-- switch repaints them. The hit box is HELP_SIZE in both looks; b.crtHelp keeps the parts.
UI.HELP_SIZE = 20
local HELP_SCALE = 0.5 -- of the template's sizes: its visible ring is about 40 px across
local HELP_MODERN = 16 -- the Modern ring, across
local HELP_FONT, HELP_FONT_SIZE = "Fonts\\FRIZQT__.TTF", 11 -- a serif "i"
local HELP_MEDIA = CRT.MEDIA or ("Interface\\AddOns\\" .. ADDON .. "\\CRT_Media\\Media\\") -- the fallback is for test harnesses without Core.lua
UI.HELP_TEXTURES = {
    i = "Interface\\common\\help-i",
    ring = "Interface\\Minimap\\MiniMap-TrackingBorder",
    glow = "Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight",
    modernRing = HELP_MEDIA .. "RingMedium",
    modernFill = HELP_MEDIA .. "Disc",
}

local function paintHelp(b)
    local h = b.crtHelp
    local modern = h.modern
    h.i:SetShown(not modern)
    h.ring:SetShown(not modern)
    h.glow:SetAlpha(modern and 0 or 1)
    h.circle:SetShown(modern)
    h.fill:SetShown(modern and h.hover)
    h.letter:SetShown(modern)
    UI.Tint(h.letter, "SetTextColor", (modern and h.hover) and "background" or "accent")
end

local function helpTexture(b, layer, file, size, x, y)
    local t = b:CreateTexture(nil, layer)
    t:SetTexture(file)
    t:SetSize(size, size)
    t:SetPoint("CENTER", b, "CENTER", x or 0, y or 0)
    return t
end

function UI.Help(parent, title, text)
    local b = CreateFrame("Button", nil, parent)
    b:SetSize(UI.HELP_SIZE, UI.HELP_SIZE)
    local T, s = UI.HELP_TEXTURES, HELP_SCALE
    local h = { modern = false, hover = false }
    -- Classic: the template's three textures and offsets, scaled
    h.i = helpTexture(b, "BACKGROUND", T.i, 46 * s)
    h.ring = helpTexture(b, "BORDER", T.ring, 64 * s, 12 * s, -13 * s)
    h.glow = helpTexture(b, "HIGHLIGHT", T.glow, 46 * s, -1 * s, 1 * s)
    h.glow:SetBlendMode("ADD")
    -- Modern: the fill under the ring, then the "i"
    h.fill = helpTexture(b, "BACKGROUND", T.modernFill, HELP_MODERN)
    h.circle = helpTexture(b, "BORDER", T.modernRing, HELP_MODERN)
    UI.Tint(h.fill, "SetVertexColor", "accent")
    UI.Tint(h.circle, "SetVertexColor", "accent")
    h.letter = b:CreateFontString(nil, "OVERLAY")
    h.letter:SetFont(HELP_FONT, HELP_FONT_SIZE, "")
    h.letter:SetPoint("CENTER", b, "CENTER", 0, 0)
    h.letter:SetText("i")
    b.crtHelp = h
    b.crtSkin = function(modern)
        h.modern = modern and true or false
        paintHelp(b)
    end
    UI.skinned[#UI.skinned + 1] = b
    b.crtSkin(UI:IsModern())
    b:SetScript("OnEnter", function(self)
        h.hover = true
        paintHelp(self)
        -- right of the (?), whatever Tooltip position says (UI/Tooltip.lua's UI.TOOLTIP_KEEP)
        UI.TooltipOwner(GameTooltip, self, "ANCHOR_RIGHT", nil, nil, UI.TOOLTIP_KEEP)
        GameTooltip:SetText(type(title) == "function" and title() or title, 1, 1, 1)
        local body = type(text) == "function" and text() or text or ""
        for paragraph in (body .. "\n\n"):gmatch("(.-)\n\n") do
            if paragraph ~= "" then
                GameTooltip:AddLine(paragraph, 0.85, 0.85, 0.85, true)
            end
        end
        GameTooltip:Show()
    end)
    b:SetScript("OnLeave", function(self)
        h.hover = false
        paintHelp(self)
        GameTooltip:Hide()
    end)
    return b
end

-- Every (?) sits just right of the thing it explains, UI.HELP_GAP from it and centred on it:
-- UI.HelpRight(target, title, text, opts) makes the icon (UI.Help) and places it. Pages call this,
-- never UI.Help with their own SetPoint (the suite's "help icons sit right" lint). The target is
--   a frame         a heading bar, a control, or a whole Edit Mode style row (UI.Dropdown, UI.Slider:
--                   the row's right edge is the control's), so the icon is right of the control
--   a FontString    a heading or a label: the icon follows its text's right edge, whatever its
--                   justification, and moves when the text changes or the icon shows
--   a CheckButton   with a label (.label, or the template's .Text): the icon follows the label's text
-- opts.parent is the icon's parent (by default the target's own, or a check box's own for its label). The icon keeps the target as
-- b.crtHelpTarget and the font string it follows, if any, as b.crtHelpText.
UI.HELP_GAP = 4

local function objectType(o)
    return type(o) == "table" and o.GetObjectType and o:GetObjectType() or nil
end

local function helpText(target)
    local kind = objectType(target)
    if kind == "FontString" then
        return target
    end
    if kind == "CheckButton" then
        -- a page's own label, or the template's .Text when the page wrote its label there
        local label = target.label
        if label == nil and objectType(target.Text) == "FontString" and (target.Text:GetText() or "") ~= "" then
            label = target.Text
        end
        if objectType(label) == "FontString" then
            return label
        end
    end
    return nil
end

local function placeHelp(b)
    local fs, gap = b.crtHelpText, UI.HELP_GAP
    b:ClearAllPoints()
    if not fs then
        b:SetPoint("LEFT", b.crtHelpTarget, "RIGHT", gap, 0)
        return
    end
    -- the text's width, inside the box when the box is narrower (a clipped label). A label sized by two
    -- anchors (LEFT and RIGHT) has no width until its first layout, so GetWidth is 0 while the page is
    -- built and the full text width is used; the icon's OnShow places it again once the box has its
    -- width, so a clipped label's (?) then sits at the box's edge.
    local w = fs:GetStringWidth() or 0
    local box = fs:GetWidth() or 0
    if box > 0 and box < w then
        w = box
    end
    local justify = fs:GetJustifyH()
    if justify == "RIGHT" then
        b:SetPoint("LEFT", fs, "RIGHT", gap, 0)
    elseif justify == "LEFT" then
        b:SetPoint("LEFT", fs, "LEFT", w + gap, 0)
    else
        -- CENTER, the game's default: also a box that fits its text
        b:SetPoint("LEFT", fs, "CENTER", w / 2 + gap, 0)
    end
end

function UI.HelpRight(target, title, text, opts)
    opts = opts or {}
    local parent = opts.parent or target:GetParent()
    -- a check box's label: the icon sits beside the check box, not inside it
    if not opts.parent and objectType(parent) == "CheckButton" and parent.GetParent then
        parent = parent:GetParent()
    end
    local b = UI.Help(parent, title, text)
    b.crtHelpTarget = target
    b.crtHelpText = helpText(target) or false
    local fs = b.crtHelpText
    if fs and hooksecurefunc then
        local function follow()
            placeHelp(b)
        end
        -- new text, or a new font (the look switch changes some), changes the text's width
        for _, method in ipairs({ "SetText", "SetFormattedText", "SetFontObject", "SetJustifyH" }) do
            if fs[method] then
                hooksecurefunc(fs, method, follow)
            end
        end
        -- a font can load after the page is built, which changes the text's width
        b:SetScript("OnShow", follow)
    end
    placeHelp(b)
    return b
end

-- A small button for a window's header bar. In the Modern look it is the Reset button's look:
-- dark fill, grey edge, small text. In the Classic look it is the game's red panel button, like
-- Previews. Its width comes from the label (plus the icon, if any) and padding, never under
-- UI.HEADER_BUTTON_MIN_W; its height is UI.HEADER_BUTTON_H unless opts.flatH / opts.classicH say
-- otherwise. b:SetLabel(text) changes the label, and the width with it. opts: icon (a texture path, or { atlas = name }; shown left of the label in every look; an
-- unknown value shows nothing), tipTitle and tipText (a tooltip). It sits above its parent's own parts,
-- so a bar can hold it.
UI.HEADER_BUTTON_H = 20
UI.HEADER_BUTTON_MIN_W = 44
UI.HEADER_BUTTON_PAD = 8 -- each side, Modern; Classic uses PANEL_BUTTON_PAD for the end caps
UI.HEADER_BUTTON_ICON = 12
UI.HEADER_BUTTON_ICON_GAP = 3
-- Reset on a window's drag handle stays small, so the handle's 1 px border shows (Previews is 18 high)
UI.RESET_BUTTON_H = 16
UI.RESET_BUTTON_CLASSIC_H = 18

local function headerButtonWidth(labelW, flat)
    return math.max(UI.HEADER_BUTTON_MIN_W, math.ceil(labelW) + 2 * (flat and UI.HEADER_BUTTON_PAD or UI.PANEL_BUTTON_PAD))
end

-- The widest a Reset button gets (Classic), for a handle that must leave room for it whatever the look.
local resetMeasure
function UI.ResetButtonWidth()
    if not resetMeasure then
        resetMeasure = UIParent:CreateFontString(nil, "OVERLAY", "CRTFontButtonSmall")
        resetMeasure:Hide()
    end
    resetMeasure:SetText("Reset")
    return headerButtonWidth(resetMeasure:GetStringWidth(), false)
end

function UI.HeaderButton(parent, label, onClick, opts)
    opts = opts or {}
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetFrameLevel((parent:GetFrameLevel() or 1) + 5)
    if _G.CRTFontButtonSmall then
        b:SetNormalFontObject(_G.CRTFontButtonSmall)
        b:SetHighlightFontObject(_G.CRTFontButtonSmallHighlight or _G.CRTFontButtonSmall)
        b:SetDisabledFontObject(_G.CRTFontButtonSmallDisable or _G.CRTFontButtonSmall)
    end
    b:SetText(label)
    local fs = b:GetFontString()
    -- the icon, left of the label
    local icon
    local iconKind = type(opts.icon)
    if iconKind == "string" or (iconKind == "table" and type(opts.icon.atlas) == "string") then
        icon = b:CreateTexture(nil, "OVERLAY")
        icon:SetSize(UI.HEADER_BUTTON_ICON, UI.HEADER_BUTTON_ICON)
        if iconKind == "table" then
            icon:SetAtlas(opts.icon.atlas)
        else
            icon:SetTexture(opts.icon)
        end
        icon:Show()
    end
    b.icon = icon
    local bg, edges = flatSkin(b, 0)
    local highlight = b:GetHighlightTexture()
    local hover = b:CreateTexture(nil, "HIGHLIGHT")
    hover:SetAllPoints(bg)
    hover:SetColorTexture(1, 1, 1, 0.15)
    b.crtSkin = function()
        local flat = UI:IsModern()
        -- measured each time, so a new label or font size gets its width
        local labelW = fs and fs:GetStringWidth() or 0
        if icon then
            labelW = labelW + UI.HEADER_BUTTON_ICON + UI.HEADER_BUTTON_ICON_GAP
        end
        local pad = flat and UI.HEADER_BUTTON_PAD or UI.PANEL_BUTTON_PAD
        for _, art in ipairs({ b.Left, b.Middle, b.Right }) do
            if type(art) == "table" then
                art:SetAlpha(flat and 0 or 1)
            end
        end
        if highlight then
            highlight:SetAlpha(flat and 0 or 1)
        end
        hover:SetAlpha(flat and 1 or 0)
        bg:SetShown(flat)
        bg:SetColorTexture(0, 0, 0, 0.6)
        for _, e in ipairs(edges) do
            e:SetShown(flat)
            e:SetColorTexture(0.6, 0.6, 0.6, 1)
        end
        b:SetSize(headerButtonWidth(labelW, flat), (flat and opts.flatH or opts.classicH) or UI.HEADER_BUTTON_H)
        if icon and fs then
            icon:ClearAllPoints()
            icon:SetPoint("LEFT", pad, 0)
            fs:ClearAllPoints()
            fs:SetPoint("LEFT", icon, "RIGHT", UI.HEADER_BUTTON_ICON_GAP, 0)
        end
    end
    UI.skinned[#UI.skinned + 1] = b
    b.crtSkin() -- the current look at once, for a button made before the main window exists
    function b:SetLabel(text)
        self:SetText(text)
        self.crtSkin()
    end
    b:SetScript("OnClick", function()
        onClick()
    end)
    if opts.tipTitle then
        b:SetScript("OnEnter", function(self)
            UI.TooltipOwner(GameTooltip, self, "ANCHOR_TOP")
            GameTooltip:SetText(opts.tipTitle, 1, 1, 1)
            if opts.tipText then
                GameTooltip:AddLine(opts.tipText, 0.85, 0.85, 0.85, true)
            end
            GameTooltip:Show()
        end)
        b:SetScript("OnLeave", function()
            GameTooltip:Hide()
        end)
    end
    return b
end

-- A small "Reset" button for the header bar of a window you can drag. It puts the window back where
-- it starts, and is shown with the bar (or by the window, during Previews). onClick does the reset.
function UI.ResetButton(parent, onClick)
    return UI.HeaderButton(parent, "Reset", onClick, {
        flatH = UI.RESET_BUTTON_H, classicH = UI.RESET_BUTTON_CLASSIC_H,
        tipTitle = "Reset position", tipText = "Puts this window back where it starts.",
    })
end

-- Fades a frame out over seconds, then calls done (which hides it). Showing it again should call
-- UI.CancelFade first, which stops a fade and puts the frame back to full opacity.
local fades = {}

function UI.FadeOut(frame, seconds, done)
    local driver = fades[frame]
    if not driver then
        driver = CreateFrame("Frame")
        fades[frame] = driver
    end
    local start, elapsed = frame:GetAlpha() or 1, 0
    driver:SetScript("OnUpdate", function(self, dt)
        elapsed = elapsed + dt
        if elapsed >= seconds then
            self:SetScript("OnUpdate", nil)
            frame:SetAlpha(0)
            done()
            return
        end
        frame:SetAlpha(start * (1 - elapsed / seconds))
    end)
end

function UI.CancelFade(frame)
    local driver = fades[frame]
    if driver then
        driver:SetScript("OnUpdate", nil)
    end
    frame:SetAlpha(1)
end

function UI.SetFrameTitle(frame, text)
    if frame.SetTitle then
        frame:SetTitle(text)
    elseif frame.TitleText then
        frame.TitleText:SetText(text)
    elseif frame.TitleContainer and frame.TitleContainer.TitleText then
        frame.TitleContainer.TitleText:SetText(text)
    end
end

-- Game popups over our windows ---------------------------------------------------------------------

-- Lifts a game dialog (its strata is below the alert editor's) over our windows, putting its strata
-- back when it hides. The hook is added once per frame; each lift saves the strata to restore.
function UI.LiftOver(dialog)
    if not (dialog and dialog.SetFrameStrata) then
        return
    end
    if not dialog.crtLifted then
        dialog.crtLifted = dialog:GetFrameStrata()
        dialog:SetFrameStrata("FULLSCREEN_DIALOG")
        if not dialog.crtHooked then
            dialog.crtHooked = true
            dialog:HookScript("OnHide", function(d)
                if d.crtLifted then
                    d:SetFrameStrata(d.crtLifted)
                    d.crtLifted = nil
                end
            end)
        end
    end
    dialog:Raise()
end

-- The popup the game just showed: the frame the show call returned, else the one StaticPopup_Visible
-- names for `name` (the popup's key; "GENERIC_CONFIRMATION" for StaticPopup_ShowCustomGenericConfirmation),
-- else the first visible StaticPopup. Nil when none is shown.
function UI.ShownPopup(ret, name)
    if type(ret) == "table" then
        return ret
    end
    local frameName = name and StaticPopup_Visible and StaticPopup_Visible(name)
    local named = frameName and _G[frameName]
    if type(named) == "table" then
        return named
    end
    for i = 1, 4 do
        local p = _G["StaticPopup" .. i]
        if p and p:IsShown() then
            return p
        end
    end
    return nil
end

-- A popup's edit box, by whichever name this client gives it.
function UI.PopupEditBox(dialog)
    if not dialog then
        return nil
    end
    return dialog.GetEditBox and dialog:GetEditBox() or dialog.EditBox or dialog.editBox
end

-- The theme button, left of Minimize (UI.lookButton): its label is the theme in use, and a click opens
-- the theme menu (UI:FillThemeMenu) under it. 18 high, like Previews, to fit inside the title bar.
-- ApplyStyle keeps the label.
function UI:MakeThemeButton(parent)
    local lb
    lb = UI.HeaderButton(parent, self:ThemeName(), function()
        UI.ContextMenu(lb, function(root)
            UI:FillThemeMenu(root)
        end, { "TOPRIGHT", lb, "BOTTOMRIGHT", 0, -2 })
    end, {
        flatH = 18, classicH = 18,
        tipTitle = "Theme", tipText = "Pick the theme: Default: Blizzard is the game's own look; the others are flat, in their own colors.",
    })
    self.lookButton = lb
    return lb
end

local function createMenuButton(parent, page, index)
    local b = CreateFrame("Button", nil, parent)
    b:SetHeight(UI.MENU_LAYOUT.row) -- placed by UI:LayoutMenu

    b.sel = b:CreateTexture(nil, "BACKGROUND")
    b.sel:SetAllPoints()
    b.sel:SetColorTexture(1, 0.82, 0, 0.18)
    b.sel:Hide()

    -- the blackouts' accent bar on the selected page's left (UI:StyleMenuButton)
    b.bar = b:CreateTexture(nil, "ARTWORK")
    b.bar:SetPoint("TOPLEFT")
    b.bar:SetPoint("BOTTOMLEFT")
    b.bar:SetWidth(MENU_BAR_W)
    b.bar:Hide()

    b.hl = b:CreateTexture(nil, "HIGHLIGHT")
    b.hl:SetAllPoints()
    b.hl:SetColorTexture(1, 1, 1, 0.08)

    b.text = b:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    b.text:SetPoint("LEFT", 10, 0)
    b.text:SetText(page.title)

    b:SetScript("OnClick", function()
        UI:SelectPage(page.key)
    end)
    return b
end

function UI:Create()
    if self.frame then
        return self.frame
    end

    local f = CreateFrame("Frame", "CowfeeRaidToolsFrame", UIParent, "BasicFrameTemplateWithInset")
    f:SetSize(FRAME_W, FRAME_H)
    UI:RegisterLayer("panel", f)
    UI.AddWindow(f)

    -- The template's art, for the General Settings page's style and opacity: every texture it made.
    f.art = {}
    for _, region in ipairs({ f:GetRegions() }) do
        if region:GetObjectType() == "Texture" then
            f.art[#f.art + 1] = region
        end
    end
    -- The Modern look's window: a flat background, its own title strip and a thin border.
    -- the background starts under the title row, so the title row is one layer (Window opacity)
    f.flatBg = f:CreateTexture(nil, "BACKGROUND", nil, -8)
    f.flatBg:SetPoint("TOPLEFT", 0, -UI.TITLE_ROW)
    f.flatBg:SetPoint("BOTTOMRIGHT")
    f.flatTitle = f:CreateTexture(nil, "BACKGROUND", nil, -7)
    f.flatTitle:SetPoint("TOPLEFT", 1, -1)
    f.flatTitle:SetPoint("TOPRIGHT", -1, -1)
    f.flatTitle:SetHeight(23)
    f.flatEdges = {}
    for _, side in ipairs({ { "TOPLEFT", "TOPRIGHT", true }, { "BOTTOMLEFT", "BOTTOMRIGHT", true }, { "TOPLEFT", "BOTTOMLEFT", false }, { "TOPRIGHT", "BOTTOMRIGHT", false } }) do
        local edge = f:CreateTexture(nil, "BORDER")
        edge:SetPoint(side[1])
        edge:SetPoint(side[2])
        if side[3] then
            edge:SetHeight(1)
        else
            edge:SetWidth(1)
        end
        f.flatEdges[#f.flatEdges + 1] = edge
    end
    -- The Modern look's teal line under the title.
    f.titleLine = f:CreateTexture(nil, "BORDER")
    f.titleLine:SetPoint("TOPLEFT", 1, -24)
    f.titleLine:SetPoint("TOPRIGHT", -1, -24)
    f.titleLine:SetHeight(1)
    f.flat = { f.flatBg, f.flatTitle }
    for _, edge in ipairs(f.flatEdges) do
        f.flat[#f.flat + 1] = edge
    end
    f:SetClampedToScreen(true)
    f:SetMovable(true)
    f:EnableMouse(true)
    f:RegisterForDrag("LeftButton")
    -- StartMoving(true) moves from where the mouse is now. Without it the game moves from a press
    -- point it remembers, which can be an old one (it went stale after using the Timeline pop-out),
    -- and the window jumped by the distance between the two. Every movable window does the same.
    f:SetScript("OnDragStart", function(self) self:StartMoving(true) end)
    f:SetScript("OnDragStop", function(self)
        self:StopMovingOrSizing()
        UI:SaveWindowPosition()
        -- A drag while the alerts have parked the window (Alerts/Areas.lua) is the player's own choice.
        if UI.windowParked then
            UI.windowParked = "dragged"
        end
    end)
    UI.SetFrameTitle(f, "Cowfee Raid Tools")
    -- The addon's version, from the .toc, in the top left of the title bar. A developer copy adds its internal
    -- build number (CRT.BUILD, from CRT_Dev/Dev/Build.lua, never shipped): "v1.1.2 build#004".
    f.version = f:CreateFontString(nil, "OVERLAY", "CRTFontButtonSmall")
    f.version:SetPoint("TOPLEFT", 10, -6)
    f.version:SetTextColor(0.6, 0.6, 0.6)
    f.version:SetText(UI.VersionText())
    tinsert(UISpecialFrames, "CowfeeRaidToolsFrame")

    -- Closing the panel also turns the previews off, so nothing is left floating on screen.
    f:SetScript("OnHide", function()
        UI:SetPreviews(false)
        for key, page in pairs(UI.pages) do
            if page.closeHides and not page.hidden then
                UI:SetPageHidden(key, true)
            end
        end
    end)

    -- "Previews", in the title bar beside the close button. It uses the game's small size, not the
    -- addon's scaled one, and is 18 high and 1 pixel above centre, so it fits inside the title bar.
    local pb = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
    pb:SetNormalFontObject(CRTFontButtonSmall)
    pb:SetHighlightFontObject(CRTFontButtonSmallHighlight)
    pb:SetDisabledFontObject(CRTFontButtonSmallDisable)
    pb:SetSize(96, 18)
    -- Beside the close button, centred on it, so it sits inside the title bar.
    if f.CloseButton then
        pb:SetPoint("RIGHT", f.CloseButton, "LEFT", -2, 1)
    else
        pb:SetPoint("TOPRIGHT", f, "TOPRIGHT", -30, -2)
    end
    pb:SetText("Previews")
    pb:SetScript("OnClick", function()
        UI:TogglePreviews()
    end)
    pb:SetScript("OnEnter", function(self)
        UI.TooltipOwner(GameTooltip, self, "ANCHOR_BOTTOM")
        GameTooltip:SetText("Previews", 1, 1, 1)
        GameTooltip:AddLine("Shows every movable window with sample content, so you can drag them into place. Closing this window turns the previews off.", 0.8, 0.8, 0.8, true)
        GameTooltip:Show()
    end)
    pb:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    UI.previewButton = pb

    -- Minimize, like a desktop window: the button left of Previews, or a double-click on the title
    -- bar, shrinks the window to its title bar; the same again, /crt or opening a page restores it.
    local mb = CreateFrame("Button", nil, f, "BackdropTemplate")
    mb:SetSize(20, 18)
    mb:SetPoint("RIGHT", pb, "LEFT", -4, 0)
    mb:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    -- A line for minimize, a small square for restore, drawn with plain textures.
    mb.line = mb:CreateTexture(nil, "OVERLAY")
    mb.line:SetSize(10, 2)
    mb.line:SetPoint("BOTTOM", 0, 4)
    mb.square = {}
    for _, side in ipairs({ { "TOPLEFT", "TOPRIGHT", true }, { "BOTTOMLEFT", "BOTTOMRIGHT", true }, { "TOPLEFT", "BOTTOMLEFT", false }, { "TOPRIGHT", "BOTTOMRIGHT", false } }) do
        local e = mb:CreateTexture(nil, "OVERLAY")
        e:SetPoint(side[1], mb, "CENTER", side[1]:find("LEFT") and -4 or 4, side[1]:find("TOP") and 4 or -4)
        e:SetPoint(side[2], mb, "CENTER", side[2]:find("LEFT") and -4 or 4, side[2]:find("TOP") and 4 or -4)
        if side[3] then
            e:SetHeight(side[1]:find("TOP") and 2 or 1)
        else
            e:SetWidth(1)
        end
        mb.square[#mb.square + 1] = e
    end
    mb:SetScript("OnClick", function()
        UI:SetMinimized(not UI.minimized)
    end)
    mb:SetScript("OnEnter", function(self)
        self.hover = true
        UI:StyleMinimizeButton()
        UI.TooltipOwner(GameTooltip, self, "ANCHOR_BOTTOM")
        GameTooltip:SetText(UI.minimized and "Restore" or "Minimize", 1, 1, 1)
        GameTooltip:AddLine("Double-clicking the title bar does the same.", 0.85, 0.85, 0.85, true)
        GameTooltip:Show()
    end)
    mb:SetScript("OnLeave", function(self)
        self.hover = false
        UI:StyleMinimizeButton()
        GameTooltip:Hide()
    end)
    f.minimizeButton = mb

    local lb = UI:MakeThemeButton(f)
    lb:SetPoint("RIGHT", mb, "LEFT", -4, 0)

    -- The title bar: drag it to move the window, double-click it to minimize or restore.
    local titleBar = CreateFrame("Button", nil, f)
    titleBar:SetPoint("TOPLEFT", f, "TOPLEFT", 0, 0)
    titleBar:SetPoint("RIGHT", lb, "LEFT", -4, 0)
    titleBar:SetHeight(24)
    titleBar:RegisterForClicks("LeftButtonUp")
    titleBar:RegisterForDrag("LeftButton")
    titleBar:SetScript("OnDragStart", function()
        f:GetScript("OnDragStart")(f)
    end)
    titleBar:SetScript("OnDragStop", function()
        f:GetScript("OnDragStop")(f)
    end)
    titleBar:SetScript("OnDoubleClick", function()
        UI:SetMinimized(not UI.minimized)
    end)

    f:SetScale(UI:Scale() / 100)
    UI:ApplyWindowPosition(f)

    -- Ctrl + mouse wheel over the panel changes its size in steps of 5 percent.
    f:EnableMouseWheel(true)
    f:SetScript("OnMouseWheel", function(_, delta)
        if IsControlKeyDown() then
            UI:SetScale(UI:Scale() + delta * 5)
        end
    end)

    local menu = UI:CreateMenu(f)
    f.menu = menu
    -- The divider in the gap right of the menu: the line, then (Default: Blizzard) its shadow beside it.
    -- Both stay inside the 8 px gap and follow the menu's height (UI:StyleDivider sizes and colours them).
    local line = f:CreateTexture(nil, "BORDER")
    line:SetPoint("TOPLEFT", menu, "TOPRIGHT", DIVIDER.left, 0)
    line:SetPoint("BOTTOMLEFT", menu, "BOTTOMRIGHT", DIVIDER.left, 0)
    local shadow = f:CreateTexture(nil, "BORDER")
    shadow:SetPoint("TOPLEFT", line, "TOPRIGHT", 0, 0)
    shadow:SetPoint("BOTTOMLEFT", line, "BOTTOMRIGHT", 0, 0)
    f.divider = { line = line, shadow = shadow }

    local content = CreateFrame("Frame", nil, f)
    content:SetPoint("TOPLEFT", menu, "TOPRIGHT", 8, 0)
    content:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -8, 8)
    f.content = content

    for i, key in ipairs(self.order) do
        local page = self.pages[key]
        page.button = createMenuButton(menu.inner, page, i)
    end

    self.frame = f
    self:SkinCloseButton(f.CloseButton)
    self:SkinTree(f)
    self:ApplyStyle()
    f:Hide()
    return f
end

function UI:BuildPage(page)
    local pf = CreateFrame("Frame", nil, self.frame.content)
    pf:SetAllPoints()
    pf:Hide()
    page.frame = pf
    page.builder(pf)
    self:SkinTree(pf)
end

function UI:SelectPage(key)
    local page = self.pages[key]
    if not page or page.hidden then
        page = self.pages[self.order[1]]
    end
    if not page then
        return
    end
    if not page.frame then
        self:BuildPage(page)
    end
    for _, p in pairs(self.pages) do
        local selected = (p == page)
        if p.frame then
            p.frame:SetShown(selected)
        end
        if p.button then
            self:StyleMenuButton(p.button, selected)
        end
    end
    CRT.db.lastPage = page.key
end

-- Minimize -------------------------------------------------------------------------------------
-- Minimized, the window keeps only its title bar (the version, the title, minimize, Previews and
-- close). Its top-left corner stays where it is, so it shrinks upwards to the bar and grows back
-- down. It isn't saved: the window always opens full size after a /reload.

local TITLE_H = 26

function UI:StyleMinimizeButton()
    local mb = self.frame and self.frame.minimizeButton
    if not mb then
        return
    end
    local modern = self:IsModern()
    local r, g, b
    if modern then
        local c = CRT.PALETTE[mb.hover and "accent" or "text"]
        r, g, b = c[1], c[2], c[3]
        mb:SetBackdropColor(0, 0, 0, 0)
        mb:SetBackdropBorderColor(0, 0, 0, 0)
    else
        r, g, b = 1, 0.82, 0
        if not mb.hover then
            r, g, b = 0.9, 0.9, 0.9
        end
        mb:SetBackdropColor(0.1, 0.1, 0.1, 0.9)
        mb:SetBackdropBorderColor(0.4, 0.4, 0.4, 1)
    end
    mb.line:SetColorTexture(r, g, b, 1)
    mb.line:SetShown(not self.minimized)
    for _, e in ipairs(mb.square) do
        e:SetColorTexture(r, g, b, 1)
        e:SetShown(self.minimized and true or false)
    end
end

function UI:SetMinimized(on)
    local f = self.frame
    if not f then
        return
    end
    on = on and true or false
    if on == (self.minimized or false) then
        return
    end
    -- Pin the top-left corner first, so the window shrinks and grows from the top, and save that
    -- anchor, so anything that puts the window back (ApplyWindowPosition) puts it here.
    local left, top = f:GetLeft(), f:GetTop()
    if left and top then
        f:ClearAllPoints()
        f:SetPoint("TOPLEFT", UIParent, "BOTTOMLEFT", left, top)
        self:SaveWindowPosition()
    end
    self.minimized = on
    f:SetHeight(on and TITLE_H or FRAME_H)
    f.menu:SetShown(not on)
    f.content:SetShown(not on)
    if type(f.Inset) == "table" then
        f.Inset:SetShown(not on)
    end
    self:StyleMinimizeButton()
end

-- Saves where the main window is: its anchor point, the point of the screen it is measured from, and
-- the offsets. All four are needed: a drag or a minimize can leave the window anchored from a
-- different point of the screen than its own (TOPLEFT from the screen's BOTTOMLEFT), and putting it
-- back as if both were the same made it jump.
function UI:SaveWindowPosition()
    local f = self.frame
    if not f then
        return
    end
    local point, _, relativePoint, x, y = f:GetPoint()
    if point then
        local w = CRT.db.window
        w.point, w.relativePoint, w.x, w.y = point, relativePoint or point, x, y
    end
end

-- Puts the window (the main one, unless a frame is given) at its saved place (CRT.db.window).
function UI:ApplyWindowPosition(f)
    f = f or self.frame
    local w = CRT.db.window
    if f then
        f:ClearAllPoints()
        f:SetPoint(w.point, UIParent, w.relativePoint or w.point, w.x, w.y)
    end
end

function UI:Show(key)
    local f = self:Create()
    self:SetMinimized(false)
    self:SelectPage(key or CRT.db.lastPage)
    f:Show()
end

-- /crt: opens the window, restores it when it is minimized, and closes it when it is open.
function UI:Toggle()
    if self.frame and self.frame:IsShown() and not self.minimized then
        self.frame:Hide()
    else
        self:Show()
    end
end
