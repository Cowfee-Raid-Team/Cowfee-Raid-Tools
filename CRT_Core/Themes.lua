local ADDON, CRT = ...

-- The themes, picked from the main window's title bar (UI:SetTheme in UI/Panel.lua). Each has a palette
-- in CRT.THEMES with every key in CRT.THEME_KEYS. CRT.PALETTE is the theme in use: CRT:UseTheme copies the
-- picked palette into CRT.PALETTE's own color tables, so every CRT.PALETTE.x read, and a table kept from one,
-- shows the new colors. Saved as CRTDB.ui.theme; CRTDB.ui.modern stays in step (false for "blizzard"),
-- so UI:IsModern() keeps working.
--   blizzard  Default: Blizzard, the game's own art (Classic). Its palette is the colors from before
--             themes, for the few things that read CRT.PALETTE in either look, so Classic stays as it was;
--             heading, good, warn and bad are the game's gold, green, orange and red text.
--   midnight  Blackout: Midnight, Modern in black and greys with a white accent.
--   nitro     Blackout: Nitro, Modern in blue-black with a blue accent.
--   cowfee    Beanworks: Cowfee, Modern in coffee colors; the Modern theme old saved data loads as.
-- menuBar draws a 2 px accent bar on the left of the selected menu page.
-- scrollBar names the theme's scroll bar look in UI.SCROLL_BAR_LOOKS (UI/ScrollBar.lua): "rail",
-- "framed" or "rounded"; without one, scroll bars keep the game's art.
-- CRT_Dev/StyleGuide.md has every theme's values side by side, the helpers, and the colours that are not
-- the theme's; a new theme fills one column there and one palette here.

-- The menu's entries, in this order.
CRT.THEME_LIST = {
    { key = "blizzard", name = "Default: Blizzard", modern = false },
    { key = "midnight", name = "Blackout: Midnight", modern = true, menuBar = true, scrollBar = "rail" },
    { key = "nitro", name = "Blackout: Nitro", modern = true, menuBar = true, scrollBar = "framed" },
    { key = "cowfee", name = "Beanworks: Cowfee", modern = true, scrollBar = "rounded" },
}
CRT.THEME_CLASSIC = "blizzard"
CRT.THEME_MODERN = "cowfee" -- old saved data with the Modern look on

-- What each palette key colors (each key is named for what it colours; CRT_Dev/StyleGuide.md has the values):
--   background   the window background
--   surface      menu blocks, fields and buttons
--   border       borders, the empty part of a slider's track
--   selected     the selected page and tab, an unticked checkbox's edge
--   accent       lines, a slider's filled track, hover edges
--   label        button text and labels (the game's gold font, in a Modern theme)
--   heading      headings and section titles (UI.HeadingText); the game's gold in Default: Blizzard
--   text         body text (the game's white text)
--   good         good states: synced, answered, on, ready (UI.GoodText)
--   warn         in-between states: running low, worn, arrived late, a middling score (UI.WarnText)
--   bad          bad states: late, failed, missing, can't (UI.BadText)
--   knob         a slider's knob and a ticked checkbox
--   knobBorder   the knob's 1 px edge
--   knobShine    the soft highlight inside the knob's and ticked box's top edge
--   knobText     the knob's value and number box
--   check        a ticked checkbox's tick
--   checkBorder  a ticked checkbox's edge
--   titleTop, titleBottom   a window title bar's gradient (UI.TitleStrip)
--   muted        quiet text: the small note beside a window's title, a roll someone else won
--   outline      a dark edge that must stand out on any fill: the alert bars' Border; the theme's darkest colour
CRT.THEME_KEYS = { "background", "surface", "border", "selected", "accent", "label", "heading", "text", "good",
    "warn", "bad", "knob", "knobBorder", "knobShine", "knobText", "check", "checkBorder", "titleTop", "titleBottom", "muted",
    "outline" }

local function hex(h)
    return { tonumber(h:sub(1, 2), 16) / 255, tonumber(h:sub(3, 4), 16) / 255, tonumber(h:sub(5, 6), 16) / 255 }
end

-- One of the game's text colours (a ColorMixin global such as GREEN_FONT_COLOR), or the fallback when the
-- global is missing or can't be read.
local function gameColor(name, fallback)
    local c = _G[name]
    if type(c) == "table" and type(c.GetRGB) == "function" then
        local ok, r, g, b = pcall(c.GetRGB, c)
        if ok and type(r) == "number" and type(g) == "number" and type(b) == "number" then
            return { r, g, b }
        end
    end
    return fallback
end

CRT.THEMES = {
    -- the colors from before themes, as they were written then
    blizzard = {
        background = { 0.11, 0.078, 0.063 },
        surface = { 0.165, 0.122, 0.098 },
        border = { 0.30, 0.235, 0.188 },
        selected = { 0.44, 0.31, 0.22 },
        accent = { 0.78, 0.56, 0.36 },
        label = { 0.87, 0.73, 0.56 },
        heading = gameColor("NORMAL_FONT_COLOR", { 1, 0.82, 0 }), -- the game's gold
        text = { 0.95, 0.90, 0.84 },
        good = gameColor("GREEN_FONT_COLOR", hex("19FF19")), -- the game's green
        warn = gameColor("ORANGE_FONT_COLOR", hex("FF8040")), -- the game's orange
        bad = gameColor("RED_FONT_COLOR", hex("FF2020")), -- the game's red
        knob = hex("4A3424"),
        knobBorder = hex("1A120C"),
        knobShine = hex("7A5A3E"),
        knobText = { 1, 1, 1 },
        check = { 1, 1, 1 },
        checkBorder = hex("1A120C"),
        titleTop = { 0.353, 0.247, 0.173 },
        titleBottom = { 0.227, 0.165, 0.122 },
        muted = { 0.80, 0.71, 0.60 },
        outline = hex("1A120C"),
    },
    midnight = {
        background = hex("050505"),
        surface = hex("121212"),
        border = hex("2E2E2E"),
        selected = hex("2A2A2A"),
        accent = hex("E6E6E6"),
        label = hex("BDBDBD"),
        heading = hex("BDBDBD"),
        text = hex("F2F2F2"),
        good = hex("7FBF7F"),
        warn = hex("E6B450"),
        bad = hex("E06C6C"),
        knob = hex("1E1E1E"),
        knobBorder = hex("000000"),
        knobShine = hex("3A3A3A"),
        knobText = hex("F2F2F2"),
        check = hex("E6E6E6"), -- the accent
        checkBorder = hex("E6E6E6"),
        titleTop = hex("1C1C1C"),
        titleBottom = hex("0E0E0E"),
        muted = hex("9E9E9E"),
        outline = hex("000000"),
    },
    nitro = {
        background = hex("06080A"),
        surface = hex("11151A"),
        border = hex("28313B"),
        selected = hex("1E2A36"),
        accent = hex("7FB3D9"),
        label = hex("A9BBCB"),
        heading = hex("A9BBCB"),
        text = hex("EEF2F5"),
        good = hex("8FCFA0"),
        warn = hex("F0C060"),
        bad = hex("FF7F6B"),
        knob = hex("18202A"),
        knobBorder = hex("000000"),
        knobShine = hex("34414F"),
        knobText = hex("EEF2F5"),
        check = hex("7FB3D9"), -- the accent
        checkBorder = hex("7FB3D9"),
        titleTop = hex("1A2430"),
        titleBottom = hex("0E1319"),
        muted = hex("8A9DB0"),
        outline = hex("000000"),
    },
    cowfee = {
        background = hex("17110E"), -- Cold Brew
        surface = hex("2B1E17"), -- Dark Roast
        border = hex("5A4231"), -- Walnut
        selected = hex("8C4F2B"), -- Cinnamon
        accent = hex("E2A14B"), -- Honey
        label = hex("D9B48A"), -- Hazelnut
        heading = hex("D9B48A"), -- Hazelnut
        text = hex("F4EBDD"), -- Cream
        good = hex("8FA876"), -- Matcha
        warn = hex("F2C14E"),
        bad = hex("C8553D"),
        knob = hex("4A3424"),
        knobBorder = hex("1A120C"),
        knobShine = hex("7A5A3E"),
        knobText = { 1, 1, 1 },
        check = { 1, 1, 1 },
        checkBorder = hex("1A120C"),
        titleTop = { 0.353, 0.247, 0.173 },
        titleBottom = { 0.227, 0.165, 0.122 },
        muted = { 0.80, 0.71, 0.60 },
        outline = hex("17110E"), -- Cold Brew, the background
    },
}

-- The theme in use, { r, g, b } per key. Its tables are never replaced, only refilled.
CRT.PALETTE = {}
for _, key in ipairs(CRT.THEME_KEYS) do
    CRT.PALETTE[key] = { 0, 0, 0 }
end

-- The THEME_LIST entry for a key, or nil.
function CRT:ThemeInfo(key)
    for _, info in ipairs(self.THEME_LIST) do
        if info.key == key then
            return info
        end
    end
    return nil
end

-- Settles ui.theme from saved data: a known theme stays; otherwise the Modern look on means Beanworks:
-- Cowfee and off means Default: Blizzard. ui.modern is then set to match. Returns the theme's key.
function CRT:ResolveTheme(ui)
    if not self:ThemeInfo(ui.theme) then
        ui.theme = ui.modern and self.THEME_MODERN or self.THEME_CLASSIC
    end
    ui.modern = self:ThemeInfo(ui.theme).modern
    return ui.theme
end

-- Copies a theme's palette into CRT.PALETTE and remembers it as CRT.theme (its THEME_LIST entry). It
-- doesn't save or redraw anything: UI:SetTheme does that.
function CRT:UseTheme(key)
    local info = self:ThemeInfo(key) or self:ThemeInfo(self.THEME_CLASSIC)
    local palette = self.THEMES[info.key]
    for _, k in ipairs(self.THEME_KEYS) do
        local from, to = palette[k], self.PALETTE[k]
        to[1], to[2], to[3] = from[1], from[2], from[3]
    end
    self.theme = info
    return info
end

CRT:UseTheme(CRT.THEME_CLASSIC)
