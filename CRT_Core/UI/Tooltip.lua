local ADDON, CRT = ...

-- Where the addon's tooltips open. Every tooltip CRT places goes through UI.TooltipOwner, never a
-- tooltip's own SetOwner (the suite's "tooltips through UI.TooltipOwner" lint):
--   UI.TooltipOwner(tooltip, owner, anchor, x, y, how)
-- General Settings > Appearance > Tooltip position picks how (CRTDB.ui.tooltipMode):
--   "spot"   Next to what you hover (the default), on CRTDB.ui.tooltipSpot: "auto" (the default), each
--            tooltip on its own side, the anchor and offsets its caller asks for; or a spot picked in the
--            spot picker under the dropdown (a key of UI.TOOLTIP_SPOTS below), outside the edge of the CRT
--            window you hover in (UI.TooltipOutside), or on what you hover when that is in no CRT window
--   "game"   Game's tooltip spot: GameTooltip_SetDefaultAnchor(tooltip, owner) (Blizzard_SharedXML/
--            SharedTooltipTemplates.lua), where the game opens its own tooltips; the player or a UI addon
--            may have moved it. Without that function, or if it fails, the tooltip opens on the spot.
--   "cursor" Follow the cursor: tooltip:SetOwner(owner, "ANCHOR_CURSOR")
-- On a picked spot, the anchor and offsets a caller passes are not used: the spot is where the player wants it.
-- Core.lua reads the old setting (ui.tooltipAnchor: "owner", "game") into tooltipMode once.
-- how, when given, is an area or a flag.
-- An area (a key of UI.TOOLTIP_AREAS) has its own Tooltip position and spot on its page's Settings tab,
-- saved in its own table (tooltipMode, tooltipSpot); "general", the default, is General Settings' choice:
--   loothistory  every tooltip on the Loot History page (Loot/Page.lua), in CRTDB.loot
--   lootmaster   every Loot Master tooltip (LootMaster/: the page, both loot windows, the popup, the item
--                tabs, Boss loot), in CRTDB.lootmaster. The item tabs have a second choice,
--                lootmaster.itemTooltip: "Same as above" is this area, a side of the window or the game's
--                spot use the flags below, and a side of the window UI.TooltipOutside.
--   timeline     every Timeline tooltip on the Review tab, docked or popped out (Timeline/View.lua: the
--                cells, lanes, reminders and saved alerts), in CRTDB.timeline
-- Core.lua reads an area's old tooltipPosition ("general", "owner", "game", "cursor") into tooltipMode once.
-- A flag overrides every setting for the tooltips that must stay where they are:
--   UI.TOOLTIP_KEEP  always the anchor given:
--     Timeline/JournalExport.lua: its button sits on the game's Encounter Journal, so its tooltip stays by it
--   UI.TOOLTIP_GAME  always the game's spot: LootMaster/Tabs.lua item tabs on the game's spot
-- Not here at all: drag ghosts show no tooltip, dropdown and menu entries (element:SetTooltip) are
-- placed by the game's menu code, and item comparisons are drawn by the game.

local UI = CRT.UI

UI.TOOLTIP_KEEP = "keep"
UI.TOOLTIP_GAME = "game"

-- The spot picker's twelve spots (UI.SpotPicker in UI/Controls.lua), in the order it lists them, and how
-- each places the tooltip. window is its place outside the CRT window that holds what you hover (the main
-- window, a pop-out, any UI.Window: UI.WindowOf in UI/Panel.lua), for UI.TooltipOutside: point is the
-- tooltip's, rel the window's, dx, dy the gap. The corners and the middles of the sides sit flush with
-- that corner or the middle of that edge, the upper and lower parts of a side flush with its top or bottom,
-- like the Loot Master item tabs' sides of the window (LM.TOOLTIP_ANCHORS). Something in no CRT window
-- (the minimap button) is placed against itself instead: anchor is a GameTooltip:SetOwner anchor; per
-- warcraft.wiki.gg (API GameTooltip:SetOwner) each is the SetPoint written beside it, so the corners are
-- the tooltip off the owner's corner. The game has no anchor for the middle of a side, nor for its upper
-- and lower parts, so those set the owner with ANCHOR_NONE and point the tooltip themselves: point is the
-- tooltip's, rel the owner's. Besides these, a spot setting may be "auto" (UI.TOOLTIP_SPOT_AUTO, the default):
-- no spot picked, so each tooltip opens on the side its caller asks for, next to what you hover, as before
-- the picker.
local GAP = 4 -- from the window's edge, as the item tabs' sides
local function outside(point, rel, dx, dy)
    return { point = point, rel = rel, dx = dx, dy = dy }
end
UI.TOOLTIP_SPOTS = {
    { key = "topleft", label = "Top left", anchor = "ANCHOR_LEFT", window = outside("BOTTOMLEFT", "TOPLEFT", 0, GAP) }, -- BOTTOMRIGHT on the owner's TOPLEFT
    { key = "top", label = "Top", anchor = "ANCHOR_TOP", window = outside("BOTTOM", "TOP", 0, GAP) }, -- BOTTOM on TOP
    { key = "topright", label = "Top right", anchor = "ANCHOR_RIGHT", window = outside("BOTTOMRIGHT", "TOPRIGHT", 0, GAP) }, -- BOTTOMLEFT on TOPRIGHT
    { key = "leftupper", label = "Left, upper", point = "BOTTOMRIGHT", rel = "LEFT", window = outside("TOPRIGHT", "TOPLEFT", -GAP, 0) },
    { key = "left", label = "Left", point = "RIGHT", rel = "LEFT", window = outside("RIGHT", "LEFT", -GAP, 0) },
    { key = "leftlower", label = "Left, lower", point = "TOPRIGHT", rel = "LEFT", window = outside("BOTTOMRIGHT", "BOTTOMLEFT", -GAP, 0) },
    { key = "rightupper", label = "Right, upper", point = "BOTTOMLEFT", rel = "RIGHT", window = outside("TOPLEFT", "TOPRIGHT", GAP, 0) },
    { key = "right", label = "Right", point = "LEFT", rel = "RIGHT", window = outside("LEFT", "RIGHT", GAP, 0) },
    { key = "rightlower", label = "Right, lower", point = "TOPLEFT", rel = "RIGHT", window = outside("BOTTOMLEFT", "BOTTOMRIGHT", GAP, 0) },
    { key = "bottomleft", label = "Bottom left", anchor = "ANCHOR_BOTTOMLEFT", window = outside("TOPLEFT", "BOTTOMLEFT", 0, -GAP) }, -- TOPRIGHT on BOTTOMLEFT
    { key = "bottom", label = "Bottom", anchor = "ANCHOR_BOTTOM", window = outside("TOP", "BOTTOM", 0, -GAP) }, -- TOP on BOTTOM
    { key = "bottomright", label = "Bottom right", anchor = "ANCHOR_BOTTOMRIGHT", window = outside("TOPRIGHT", "BOTTOMRIGHT", 0, -GAP) }, -- TOPLEFT on BOTTOMRIGHT
}
UI.TOOLTIP_SPOT_AUTO = "auto"
UI.TOOLTIP_SPOT_DEFAULT = UI.TOOLTIP_SPOT_AUTO
local SPOT = {}
for _, s in ipairs(UI.TOOLTIP_SPOTS) do
    SPOT[s.key] = s
end

-- General Settings' choices, for its dropdown.
UI.TOOLTIP_POSITIONS = {
    { key = "spot", label = "Next to what you hover" },
    { key = "game", label = "Game's tooltip spot" },
    { key = "cursor", label = "Follow the cursor" },
}
-- An area's choices, for the dropdown on its Settings tab.
UI.TOOLTIP_AREA_POSITIONS = {
    { key = "general", label = "Use the general setting" },
    { key = "spot", label = "Next to what you hover" },
    { key = "game", label = "Game's tooltip spot" },
    { key = "cursor", label = "Follow the cursor" },
}
-- The areas with their own Tooltip position: the CRTDB table each saves tooltipMode and tooltipSpot in
-- (defaults in Core.lua).
UI.TOOLTIP_AREAS = {
    loothistory = { table = "loot" },
    lootmaster = { table = "lootmaster" },
    timeline = { table = "timeline" },
}

local MODE = { spot = true, game = true, cursor = true }
local TEXT = {
    position = "Tooltip position",
    window = "The window",
    auto = "Each on its own side",
}

-- The saved table for General Settings (area nil) or an area; nil before the saved data loads, or for an
-- unknown area.
local function saved(area)
    local db = CRT.db
    if not db then
        return nil
    end
    if area == nil then
        return type(db.ui) == "table" and db.ui or nil
    end
    local where = UI.TOOLTIP_AREAS[area]
    local t = where and db[where.table]
    return type(t) == "table" and t or nil
end

-- What is picked in the dropdown: for General Settings (area nil) "spot", "game" or "cursor", anything
-- else saved reading as "spot"; for an area also "general", its default and what anything unknown reads as.
function UI.TooltipChoice(area)
    local t = saved(area)
    local v = t and t.tooltipMode
    if MODE[v] then
        return v
    end
    return area and "general" or "spot"
end

-- The spot saved for General Settings (area nil) or an area, whatever its mode: a key of UI.TOOLTIP_SPOTS,
-- or "auto" (also for anything unset or unknown).
function UI.TooltipChosenSpot(area)
    local t = saved(area)
    local v = t and t.tooltipSpot
    return SPOT[v] and v or UI.TOOLTIP_SPOT_AUTO
end

-- Saving a dropdown choice, and a picked spot (which also turns spots on, "Next to what you hover").
function UI.SetTooltipChoice(area, choice)
    local t = saved(area)
    if t and (MODE[choice] or (area and choice == "general")) then
        t.tooltipMode = choice
    end
end

function UI.SetTooltipSpot(area, key)
    local t = saved(area)
    if t and (SPOT[key] or key == UI.TOOLTIP_SPOT_AUTO) then
        t.tooltipSpot = key
        t.tooltipMode = "spot"
    end
end

-- How a tooltip opens: "spot", "game" or "cursor". An area on "general" (or an unknown area) follows
-- General Settings.
function UI.TooltipPosition(area)
    local choice = area and UI.TooltipChoice(area) or "general"
    if choice ~= "general" then
        return choice
    end
    return UI.TooltipChoice(nil)
end

-- The spot a tooltip opens on ("auto" or a key of UI.TOOLTIP_SPOTS): the area's own while the area is on
-- "spot", else General Settings'.
function UI.TooltipSpot(area)
    if area and UI.TooltipChoice(area) == "spot" then
        return UI.TooltipChosenSpot(area)
    end
    return UI.TooltipChosenSpot(nil)
end

-- Places tooltip outside win, a window's edge, owned by owner (what you hover). side is a spot's window
-- place (UI.TOOLTIP_SPOTS) or a Loot Master item-tab side (LM.TOOLTIP_ANCHORS): point (the tooltip's), rel
-- (the window's), dx, dy, and level, which puts the tooltip's top level with owner's instead of dy. The
-- one placement for both, so the two always sit the same.
-- The game's item comparisons (ShoppingTooltip1/2) are not moved here: per Gethe/wow-ui-source live,
-- TooltipComparisonManager:AnchorShoppingTooltips (Blizzard_SharedXMLGame/Tooltip/TooltipComparisonManager.lua)
-- puts them beside the item tooltip itself, left or right of it; with ANCHOR_NONE it takes the side of the
-- tooltip with more room on the screen, so a tooltip left of a window in the left half of the screen can
-- show its comparison to its right, over the window. That is the game's code and left as it is.
function UI.TooltipOutside(tooltip, owner, win, side)
    tooltip:SetOwner(owner, "ANCHOR_NONE")
    tooltip:ClearAllPoints()
    local dy = side.dy or 0
    if side.level then
        local top, winTop = owner:GetTop(), win:GetTop()
        dy = (top and winTop) and (top - winTop) or 0
    end
    tooltip:SetPoint(side.point, win, side.rel, side.dx or 0, dy)
end

-- Places tooltip on a spot: outside the CRT window owner is in, else on owner itself. On "auto", the
-- anchor and offsets the caller asked for, next to owner. Nothing is clamped here: every CRT tooltip is
-- GameTooltip, which its SharedTooltipTemplate keeps on the screen (clampedToScreen="true",
-- Blizzard_SharedXML/SharedTooltipTemplates.xml).
local function placeOnSpot(tooltip, owner, key, anchor, x, y)
    local s = SPOT[key]
    -- UI.WindowOf is UI/Panel.lua's; a test harness may load this file without it
    local win = s and UI.WindowOf and UI.WindowOf(owner)
    if not s then
        if x or y then
            tooltip:SetOwner(owner, anchor or "ANCHOR_RIGHT", x or 0, y or 0)
        else
            tooltip:SetOwner(owner, anchor or "ANCHOR_RIGHT")
        end
    elseif win then
        UI.TooltipOutside(tooltip, owner, win, s.window)
    elseif s.anchor then
        tooltip:SetOwner(owner, s.anchor)
    else
        tooltip:SetOwner(owner, "ANCHOR_NONE")
        tooltip:ClearAllPoints()
        tooltip:SetPoint(s.point, owner, s.rel, 0, 0)
    end
end

-- Returns "game" when the game's spot placed it, "cursor" when it follows the cursor, "spot" on a spot (a
-- picked spot, outside the window, or auto), and "owner" for a flag that kept the anchor given.
function UI.TooltipOwner(tooltip, owner, anchor, x, y, how)
    local flag = (how == UI.TOOLTIP_KEEP or how == UI.TOOLTIP_GAME) and how or nil
    local mode = flag == UI.TOOLTIP_GAME and "game" or (not flag and UI.TooltipPosition(how)) or nil
    if mode == "game" and type(GameTooltip_SetDefaultAnchor) == "function" and pcall(GameTooltip_SetDefaultAnchor, tooltip, owner) then
        return "game"
    end
    if flag then
        if x or y then
            tooltip:SetOwner(owner, anchor or "ANCHOR_RIGHT", x or 0, y or 0)
        else
            tooltip:SetOwner(owner, anchor or "ANCHOR_RIGHT")
        end
        return "owner"
    end
    if mode == "cursor" then
        tooltip:SetOwner(owner, "ANCHOR_CURSOR")
        return "cursor"
    end
    placeOnSpot(tooltip, owner, UI.TooltipSpot(how), anchor, x, y)
    return "spot"
end

-- The Tooltip position dropdown and its spot picker under it, for General Settings (area nil) or an
-- area's Settings tab. The picker is greyed unless the dropdown is on Next to what you hover; picking a
-- spot turns that on, and clicking the lit spot again goes back to auto (no spot lit, "Each on its own
-- side"); on a greyed picker, a click on the lit spot picks it. While an area is on Use the general
-- setting, its picker shows General Settings' spot, the one in use. opts: labelWidth, width (the
-- dropdown's), beside (the picker right of the dropdown, for a page with no room under it). Place the
-- dropdown with group.row:SetPoint; the picker follows it. Returns group = { row, picker, refresh }.
function UI.TooltipPositionSetting(parent, area, opts)
    opts = opts or {}
    local labelWidth = opts.labelWidth or 140
    local group = {}
    group.row = UI.Dropdown(parent, TEXT.position, {
        labelWidth = labelWidth,
        width = opts.width,
        options = area and UI.TOOLTIP_AREA_POSITIONS or UI.TOOLTIP_POSITIONS,
        get = function()
            return UI.TooltipChoice(area)
        end,
        set = function(v)
            UI.SetTooltipChoice(area, v)
            group.picker.refresh()
        end,
    })
    group.picker = UI.SpotPicker(parent, {
        label = TEXT.window,
        emptyLabel = TEXT.auto,
        clear = UI.TOOLTIP_SPOT_AUTO,
        area = area,
        get = function()
            if area and UI.TooltipChoice(area) == "general" then
                return UI.TooltipChosenSpot(nil)
            end
            return UI.TooltipChosenSpot(area)
        end,
        set = function(key)
            UI.SetTooltipSpot(area, key)
            group.row.refresh()
        end,
        enabledIf = function()
            return UI.TooltipChoice(area) == "spot"
        end,
    })
    if opts.beside then
        group.picker:SetPoint("LEFT", group.row, "RIGHT", UI.SPOT_PICKER_GAP, 0)
    else
        -- under the dropdown itself, past its label (UI.Dropdown's 5 px gap)
        group.picker:SetPoint("TOPLEFT", group.row, "BOTTOMLEFT", labelWidth + 5, -2)
    end
    group.refresh = function()
        group.row.refresh()
        group.picker.refresh()
    end
    return group
end
