local ADDON, CRT = ...

-- Season data for the Timeline's Cooldowns row (read by Alerts/Cooldowns.lua): healer cooldowns and
-- raid defensives as { class, spellID, kind, cd }, where kind is "healer" (a healer's cooldown) or "raid"
-- (a raid defensive), and cd is the cooldown length in seconds (the Timeline's cooldown bands). The names
-- beside the IDs are for the reader only; the row shows the game's own name.
-- major = true marks a healer spec's major healing cooldown, the rows of the Timeline pop-out's Healer CDs
-- view (Timeline/HealerView.lua); spec is the healer spec it belongs to (a SpecializationID, or a list of
-- them). A healer whose spec isn't known gets every major cooldown of their class.
-- Last checked: 12.1.5. The major entries' spell IDs, cooldowns and specs were checked on warcraft.wiki.gg on
-- 2026-10-24 (Tranquility's retail ID is not listed there; 740 is its long-standing ID). The other entries
-- were written from memory and are not yet confirmed.
-- Check this list on every patch pass. An ID the game deleted outright has no name and is skipped at
-- runtime, but a removed or reworked talent may keep its name and go on showing, so only the check
-- catches it.

-- Healer specs (SpecializationID, warcraft.wiki.gg/wiki/SpecializationID)
local HOLY_PALADIN, DISC_PRIEST, HOLY_PRIEST, RESTO_SHAMAN = 65, 256, 257, 264
local RESTO_DRUID, MISTWEAVER, PRESERVATION = 105, 270, 1468

CRT.AlertCooldownData = {
    { class = "DRUID", spellID = 740, kind = "healer", cd = 180, major = true, spec = RESTO_DRUID }, -- Tranquility
    { class = "DRUID", spellID = 33891, kind = "healer", cd = 180, major = true, spec = RESTO_DRUID }, -- Incarnation: Tree of Life
    { class = "DRUID", spellID = 391528, kind = "healer", cd = 120, major = true, spec = RESTO_DRUID }, -- Convoke the Spirits
    { class = "DRUID", spellID = 197721, kind = "healer", cd = 90 }, -- Flourish
    { class = "EVOKER", spellID = 363534, kind = "healer", cd = 240, major = true, spec = PRESERVATION }, -- Rewind
    { class = "EVOKER", spellID = 359816, kind = "healer", cd = 120, major = true, spec = PRESERVATION }, -- Dream Flight
    { class = "EVOKER", spellID = 370960, kind = "healer", cd = 180 }, -- Emerald Communion (a PvP talent since 12.0.0)
    { class = "EVOKER", spellID = 370537, kind = "healer", cd = 90 }, -- Stasis
    { class = "EVOKER", spellID = 374227, kind = "raid", cd = 120 }, -- Zephyr
    { class = "MONK", spellID = 115310, kind = "healer", cd = 180, major = true, spec = MISTWEAVER }, -- Revival
    { class = "MONK", spellID = 388615, kind = "healer", cd = 180, major = true, spec = MISTWEAVER }, -- Restoral
    { class = "MONK", spellID = 322118, kind = "healer", cd = 120, major = true, spec = MISTWEAVER }, -- Invoke Yu'lon, the Jade Serpent
    { class = "MONK", spellID = 325197, kind = "healer", cd = 120, major = true, spec = MISTWEAVER }, -- Invoke Chi-Ji, the Red Crane
    { class = "MONK", spellID = 116849, kind = "healer", cd = 120 }, -- Life Cocoon
    { class = "PALADIN", spellID = 31821, kind = "healer", cd = 180, major = true, spec = HOLY_PALADIN }, -- Aura Mastery
    { class = "PALADIN", spellID = 31884, kind = "healer", cd = 120, major = true, spec = HOLY_PALADIN }, -- Avenging Wrath
    { class = "PALADIN", spellID = 216331, kind = "healer", cd = 60, major = true, spec = HOLY_PALADIN }, -- Avenging Crusader
    { class = "PALADIN", spellID = 375576, kind = "healer", cd = 60 }, -- Divine Toll
    { class = "PALADIN", spellID = 6940, kind = "healer", cd = 120 }, -- Blessing of Sacrifice
    { class = "PRIEST", spellID = 64843, kind = "healer", cd = 180, major = true, spec = HOLY_PRIEST }, -- Divine Hymn
    { class = "PRIEST", spellID = 265202, kind = "healer", cd = 720 }, -- Holy Word: Salvation
    { class = "PRIEST", spellID = 200183, kind = "healer", cd = 180, major = true, spec = HOLY_PRIEST }, -- Apotheosis
    { class = "PRIEST", spellID = 62618, kind = "healer", cd = 180, major = true, spec = DISC_PRIEST }, -- Power Word: Barrier
    { class = "PRIEST", spellID = 421453, kind = "healer", cd = 240, major = true, spec = DISC_PRIEST }, -- Ultimate Penitence
    { class = "PRIEST", spellID = 47536, kind = "healer", cd = 90 }, -- Rapture
    { class = "PRIEST", spellID = 246287, kind = "healer", cd = 90 }, -- Evangelism
    { class = "PRIEST", spellID = 33206, kind = "healer", cd = 180 }, -- Pain Suppression
    { class = "PRIEST", spellID = 47788, kind = "healer", cd = 180 }, -- Guardian Spirit
    { class = "SHAMAN", spellID = 108280, kind = "healer", cd = 180, major = true, spec = RESTO_SHAMAN }, -- Healing Tide Totem
    { class = "SHAMAN", spellID = 98008, kind = "healer", cd = 180, major = true, spec = RESTO_SHAMAN }, -- Spirit Link Totem
    { class = "SHAMAN", spellID = 114052, kind = "healer", cd = 180, major = true, spec = RESTO_SHAMAN }, -- Ascendance
    { class = "WARRIOR", spellID = 97462, kind = "raid", cd = 180 }, -- Rallying Cry
    { class = "DEMONHUNTER", spellID = 196718, kind = "raid", cd = 300 }, -- Darkness
    { class = "DEATHKNIGHT", spellID = 51052, kind = "raid", cd = 120 }, -- Anti-Magic Zone
    { class = "DRUID", spellID = 106898, kind = "raid", cd = 120 }, -- Stampeding Roar
}
