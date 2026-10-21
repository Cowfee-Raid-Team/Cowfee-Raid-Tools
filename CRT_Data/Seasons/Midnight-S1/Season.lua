local ADDON, CRT = ...

-- Midnight Season 2: one file per boss in this folder, each a CRT.Bosses:Register call (see
-- Bosses/Registry.lua for the fields). A new season gets a folder of its own, its own Season.lua with
-- current = true, and this one's current set to false.

CRT.Bosses:Season({
    key = "midnight-s1",
    name = "Midnight Season 2",
    expansion = "Midnight",
    order = 1,
    current = true,
    -- The raid progression route: the raids in order, each with its bosses in order. Every boss list
    -- in the addon follows it (CRT.Bosses:Route). Set it with Boss order on the Development page, then
    -- paste its Export here. The progression order is Alex's, from 2026-10-17; every boss is in one
    -- raid group until the raids are split out.
    raids = {
        {
            key = "midnight-s1",
            name = "Midnight Season 2",
            bosses = {
                3470, -- Nek'zali the Soulcoiler
                3497, -- The Lost Explorers
                3445, -- Entombed Sentinels
                3455, -- Vashnik the Malignant
                3420, -- Sszorak
                3421, -- The Twin Fangs
                3429, -- The Coiled Altar
                3492, -- Ula'tek
            },
        },
    },
    -- The Gear Checker's rules for this season (read through CRT.Bosses:GearChecks()), by inventory slot
    -- (CRT.Gear.SLOTS). enchant: the slots that take a permanent enchant this season (Midnight's
    -- enchanting formulas have helm, shoulder, chest, boot, ring and weapon enchants on warcraft.wiki.gg,
    -- read 2026-10-20, and tailoring's spellthreads enchant legs). enchantWeaponOnly: of those, the slots
    -- that need one only when the item there is a weapon (an off-hand shield or held item takes none).
    -- sockets: the slots where an empty socket counts as a missing gem; true is every slot, since the
    -- item's own socket count decides.
    gearChecks = {
        enchant = { 1, 3, 5, 7, 8, 11, 12, 16, 17 },
        enchantWeaponOnly = { 17 },
        sockets = true,
    },
})
