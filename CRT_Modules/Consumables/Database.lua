local ADDON, CRT = ...

-- The consumables the ready check row knows about. The list ships with the addon in each season pack's
-- GameIDs.lua (CRT_Data/Seasons/<pack>/GameIDs.lua, part consumables), read through CRT.Bosses:Consumables(),
-- so players do not configure it. Update it each expansion or tier, then run `/crt consumables check` in the
-- game to confirm every ID is real. This file keeps the format and the empty list a season without one gets.
--
-- The list: { expansion = "Midnight", updated = "YYYY-MM-DD", foodBuffs = { ... }, categories = { food, flask,
-- potion, weapon, rune } }. expansion and updated are shown by `/crt consumables check` and the Your bar tab.
--
-- Entry formats, one per consumable, listed most preferred first:
--   food, flask, rune:  { item = <item ID>, buff = <buff spell ID>, name = "optional label" }
--   potion, weapon:     { item = <item ID>, name = "optional label" }
--
-- item  The item ID you use, as `/crt consumables scan` prints it.
-- buff  The spell ID of the buff it gives you. If left out, the item's use spell is tried, which
--       works for many flasks and runes but usually not for food.
-- name  Only a label for people reading the file. The game's own name is shown in the addon.
-- Food needs no buff: every food gives the same kind of buff, so food is checked against foodBuffs
-- ({ buff = <spell ID>, name }). The food list only says which food a click on your bar eats, first one
-- in your bags first.
-- low   Optional, flask only: true for a lower quality flask, which the raid report can flag.
--
-- Players can reorder which item is used first and the order of the icons, but not edit this list.
-- To find IDs, buff up in the game and run `/crt consumables scan`, which prints your buffs and
-- the consumables in your bags as lines you can paste into GameIDs.lua.

CRT.ConsumablesDB = {
    foodBuffs = {},
    categories = {},
}
