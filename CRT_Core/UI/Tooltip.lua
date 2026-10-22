local ADDON, CRT = ...

-- Where the addon's tooltips open. Every tooltip CRT places goes through UI.TooltipOwner, never a
-- tooltip's own SetOwner (the suite's "tooltips through UI.TooltipOwner" lint):
--   UI.TooltipOwner(tooltip, owner, anchor, x, y, how)
-- General Settings > Appearance > Tooltip position (CRTDB.ui.tooltipAnchor) picks where:
--   "owner"  Next to what you hover: tooltip:SetOwner(owner, anchor, x, y), the spot each tooltip asks
--            for (the default)
--   "game"   Game's tooltip spot: GameTooltip_SetDefaultAnchor(tooltip, owner) (Blizzard_SharedXML/
--            SharedTooltipTemplates.lua), where the game opens its own tooltips; the player or a UI addon
--            may have moved it. Without that function, or if it fails, the tooltip opens next to the owner.
-- how, when given, is an area or a flag.
-- An area (a key of UI.TOOLTIP_AREAS) has its own Tooltip position on its page's Settings tab, saved in
-- its own table; "general", the default, is General Settings' choice, and it adds:
--   "cursor" Follow the cursor: tooltip:SetOwner(owner, "ANCHOR_CURSOR")
--   loothistory  every tooltip on the Loot History page (Loot/Page.lua), in loot.tooltipPosition
--   lootmaster   every Loot Master tooltip (LootMaster/: the page, both loot windows, the popup, the item
--                tabs, Boss loot), in lootmaster.tooltipPosition. The item tabs have a second choice,
--                lootmaster.itemTooltip: "Same as above" is this area, a side of the window or the game's
--                spot use the flags below.
-- A flag overrides every setting for the tooltips that must stay where they are:
--   UI.TOOLTIP_KEEP  always the anchor given:
--     LootMaster/Tabs.lua item tabs on a side of the window: placed by hand next to the window
--     Timeline/JournalExport.lua: its button sits on the game's Encounter Journal, so its tooltip stays by it
--   UI.TOOLTIP_GAME  always the game's spot: LootMaster/Tabs.lua item tabs on the game's spot
-- Not here at all: drag ghosts show no tooltip, dropdown and menu entries (element:SetTooltip) are
-- placed by the game's menu code, and item comparisons are drawn by the game.

local UI = CRT.UI

UI.TOOLTIP_KEEP = "keep"
UI.TOOLTIP_GAME = "game"
UI.TOOLTIP_POSITIONS = {
    { key = "owner", label = "Next to what you hover" },
    { key = "game", label = "Game's tooltip spot" },
}
-- An area's choices, for the dropdown on its Settings tab.
UI.TOOLTIP_AREA_POSITIONS = {
    { key = "general", label = "Use the general setting" },
    { key = "owner", label = "Next to what you hover" },
    { key = "game", label = "Game's tooltip spot" },
    { key = "cursor", label = "Follow the cursor" },
}
-- The areas with their own Tooltip position: where each saves it, CRTDB[table][key] (defaults in Core.lua).
UI.TOOLTIP_AREAS = {
    loothistory = { table = "loot", key = "tooltipPosition" },
    lootmaster = { table = "lootmaster", key = "tooltipPosition" },
}

local AREA_CHOICE = { owner = true, game = true, cursor = true }

-- An area's saved choice: "general" (also for anything unknown), "owner", "game" or "cursor".
function UI.TooltipAreaChoice(area)
    local where = UI.TOOLTIP_AREAS[area]
    local saved = where and CRT.db and CRT.db[where.table]
    local v = type(saved) == "table" and saved[where.key] or nil
    return AREA_CHOICE[v] and v or "general"
end

-- Where a tooltip opens: "owner" or "game" from General Settings (anything else saved reads as the
-- default, "owner"); for an area, its own choice ("cursor" too) unless that is "general".
function UI.TooltipPosition(area)
    local choice = area and UI.TooltipAreaChoice(area) or "general"
    if choice ~= "general" then
        return choice
    end
    local ui = CRT.db and CRT.db.ui
    return (ui and ui.tooltipAnchor == "game") and "game" or "owner"
end

-- Returns "game" when the game's spot placed it, "cursor" when it follows the cursor, else "owner".
function UI.TooltipOwner(tooltip, owner, anchor, x, y, how)
    local flag = (how == UI.TOOLTIP_KEEP or how == UI.TOOLTIP_GAME) and how or nil
    local where = flag and "owner" or UI.TooltipPosition(how)
    local game = flag == UI.TOOLTIP_GAME or where == "game"
    if game and type(GameTooltip_SetDefaultAnchor) == "function" and pcall(GameTooltip_SetDefaultAnchor, tooltip, owner) then
        return "game"
    end
    if where == "cursor" then
        tooltip:SetOwner(owner, "ANCHOR_CURSOR")
        return "cursor"
    end
    if x or y then
        tooltip:SetOwner(owner, anchor or "ANCHOR_RIGHT", x or 0, y or 0)
    else
        tooltip:SetOwner(owner, anchor or "ANCHOR_RIGHT")
    end
    return "owner"
end
