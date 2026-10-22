local ADDON, CRT = ...

-- Where the addon's tooltips open. Every tooltip CRT places goes through UI.TooltipOwner, never a
-- tooltip's own SetOwner (the suite's "tooltips through UI.TooltipOwner" lint):
--   UI.TooltipOwner(tooltip, owner, anchor, x, y, flag)
-- General Settings > Appearance > Tooltip position (CRTDB.ui.tooltipAnchor) picks where:
--   "owner"  Next to what you hover: tooltip:SetOwner(owner, anchor, x, y), the spot each tooltip asks
--            for (the default)
--   "game"   Game's tooltip spot: GameTooltip_SetDefaultAnchor(tooltip, owner) (Blizzard_SharedXML/
--            SharedTooltipTemplates.lua), where the game opens its own tooltips; the player or a UI addon
--            may have moved it. Without that function, or if it fails, the tooltip opens next to the owner.
-- flag overrides the setting for the tooltips that must stay where they are:
--   UI.TOOLTIP_KEEP  always the anchor given:
--     Loot/Page.lua history rows and LootMaster/Window.lua answer rows: ANCHOR_CURSOR, they follow the
--       cursor on purpose
--     LootMaster/Tabs.lua item tabs: Loot Master's own item tooltip setting places them
--     Timeline/JournalExport.lua: its button sits on the game's Encounter Journal, so its tooltip stays by it
--   UI.TOOLTIP_GAME  always the game's spot: LootMaster/Tabs.lua when its own setting says so
-- Not here at all: drag ghosts show no tooltip, dropdown and menu entries (element:SetTooltip) are
-- placed by the game's menu code, and item comparisons are drawn by the game.

local UI = CRT.UI

UI.TOOLTIP_KEEP = "keep"
UI.TOOLTIP_GAME = "game"
UI.TOOLTIP_POSITIONS = {
    { key = "owner", label = "Next to what you hover" },
    { key = "game", label = "Game's tooltip spot" },
}

-- "owner" or "game"; anything else saved reads as the default, "owner".
function UI.TooltipPosition()
    local ui = CRT.db and CRT.db.ui
    return (ui and ui.tooltipAnchor == "game") and "game" or "owner"
end

-- Returns "game" when the game's spot placed it, else "owner".
function UI.TooltipOwner(tooltip, owner, anchor, x, y, flag)
    local game = flag == UI.TOOLTIP_GAME or (flag ~= UI.TOOLTIP_KEEP and UI.TooltipPosition() == "game")
    if game and type(GameTooltip_SetDefaultAnchor) == "function" and pcall(GameTooltip_SetDefaultAnchor, tooltip, owner) then
        return "game"
    end
    if x or y then
        tooltip:SetOwner(owner, anchor or "ANCHOR_RIGHT", x or 0, y or 0)
    else
        tooltip:SetOwner(owner, anchor or "ANCHOR_RIGHT")
    end
    return "owner"
end
