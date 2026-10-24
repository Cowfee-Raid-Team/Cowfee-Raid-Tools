local ADDON, CRT = ...

-- The class cooldowns of the Timeline's Cooldowns row (read by Alerts/Cooldowns.lua) and its Healer CDs view
-- (Timeline/HealerView.lua). The list ships in each season pack's GameIDs.lua (CRT_Data/Seasons/<pack>/GameIDs.lua,
-- part cooldowns), read through CRT.Bosses:Cooldowns(); its sources and "last checked" line are there. This file
-- keeps the format and the empty list a season without one gets.
--
-- Entries are healer cooldowns and raid defensives as { class, spellID, kind, cd }, where kind is "healer" (a
-- healer's cooldown) or "raid" (a raid defensive), and cd is the cooldown length in seconds (the Timeline's
-- cooldown bands). The names beside the IDs are for the reader only; the row shows the game's own name.
-- major = true marks a healer spec's major healing cooldown, the rows of the Timeline pop-out's Healer CDs
-- view; spec is the healer spec it belongs to (a SpecializationID, warcraft.wiki.gg/wiki/SpecializationID, or a
-- list of them). A healer whose spec isn't known gets every major cooldown of their class.
-- Check the list on every patch pass. An ID the game deleted outright has no name and is skipped at runtime,
-- but a removed or reworked talent may keep its name and go on showing, so only the check catches it.

CRT.AlertCooldownData = {}
