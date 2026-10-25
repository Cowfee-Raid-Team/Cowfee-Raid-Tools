local ADDON, CRT = ...

-- This season's Gear Checker rules, read through CRT.Bosses:GearChecks(). Slots are inventory slot IDs
-- (CRT.Gear.SLOTS); true is every slot.
--   enchant            the slots that take a permanent enchant this season (Midnight's enchanting formulas
--                      have helm, shoulder, chest, boot, ring and weapon enchants on warcraft.wiki.gg, read
--                      2026-10-20, and tailoring's spellthreads enchant legs)
--   enchantWeaponOnly  of those, the slots that need one only when the item there is a weapon (an off-hand
--                      shield or held item takes none)
--   sockets            the slots where an empty socket counts as a missing gem; every slot, since the
--                      item's own socket count decides
--   checks             this season's own checks, each a filter chip on the page and an issue on its cells:
--     { key, label, help, kind, ids, severity, slots, require }
--       kind      itemIds       an equipped item is one of ids
--                 bonusIds      an item carries one of ids as a bonus ID
--                 enchantIds    the enchant on a slot is not one of ids (no enchant is the enchant rule's)
--                 missingBonus  an item carries none of ids as a bonus ID (an upgrade track, say)
--       severity  bad (red), low (orange) or info (blue); bad when left out
--       slots     the slots it looks at; every slot when left out
--       require   itemIds and bonusIds only: fewer than this many matching items is the issue, instead of
--                 each match
--   rank1Enchants      { [enchant ID] = name }: the enchants of the lower rank, which the Extra filter Low rank
--                      enchants shows ("rank 1 enchant: <name>"); an enchant not listed is never shown, and
--                      without the list the filter has no chip
-- A check with no ids does nothing and has no chip, so a check can be written before its IDs are known.
-- The season's temporary checks go when the season does: delete their entries, never the rules above.

CRT.Bosses:SeasonData("midnight-s2", "gearChecks", {
    enchant = { 1, 3, 5, 7, 8, 11, 12, 16, 17 },
    enchantWeaponOnly = { 17 },
    sockets = true,
    -- Midnight's rank 1 enchants, from the game's SpellItemEnchantment table (build 12.1.7.70493, read
    -- 2026-10-24 through wago.tools/db2/SpellItemEnchantment; the rank is the Tier1/Tier2 quality tag in the
    -- name). Each one's rank 2 is its ID + 1. The hands' Battle Arts (8727-8730) have no ranks, so none here.
    rank1Enchants = {
        -- head
        [7958] = "Hex of Leeching",
        [7960] = "Empowered Hex of Leeching",
        [7988] = "Blessing of Speed",
        [7990] = "Empowered Blessing of Speed",
        [8014] = "Rune of Avoidance",
        [8016] = "Empowered Rune of Avoidance",
        -- shoulders
        [7970] = "Flight of the Eagle",
        [7972] = "Akil'zon's Swiftness",
        [7998] = "Nature's Grace",
        [8000] = "Amirdrassil's Grace",
        [8028] = "Thalassian Recovery",
        [8030] = "Silvermoon's Mending",
        -- chest
        [7956] = "Mark of Nalorakk",
        [7984] = "Mark of the Rootwarden",
        [7986] = "Mark of the Worldsoul",
        [8012] = "Mark of the Magister",
        -- legs
        [7934] = "Sunfire Silk Spellthread",
        [7936] = "Arcanoweave Spellthread",
        [7938] = "Bright Linen Spellthread",
        [8158] = "Forest Hunter's Armor Kit",
        [8160] = "Thalassian Scout Armor Kit",
        [8162] = "Blood Knight's Armor Kit",
        -- feet
        [7962] = "Lynx's Dexterity",
        [7992] = "Shaladrassil's Roots",
        [8018] = "Farstrider's Hunt",
        -- rings
        [7964] = "Amani Mastery",
        [7966] = "Eyes of the Eagle",
        [7968] = "Zul'jin's Mastery",
        [7994] = "Nature's Wrath",
        [7996] = "Nature's Fury",
        [8020] = "Thalassian Haste",
        [8022] = "Thalassian Versatility",
        [8024] = "Silvermoon's Alacrity",
        [8026] = "Silvermoon's Tenacity",
        -- weapons
        [7978] = "Strength of Halazzi",
        [7980] = "Jan'alai's Precision",
        [7982] = "Berserker's Rage",
        [8006] = "Worldsoul Cradle",
        [8008] = "Worldsoul Aegis",
        [8010] = "Worldsoul Tenacity",
        [8036] = "Flames of the Sin'dorei",
        [8038] = "Acuity of the Ren'dorei",
        [8040] = "Arcane Mastery",
        [8688] = "Rite of the Hash'ey",
        [8612] = "Smuggler's Lynxeye", -- a scope
        [8614] = "Farstrider's Hawkeye", -- a scope
    },
    checks = {
        {
            key = "venomcursed",
            label = "Venomcursed",
            help = "Shows who wears a Venomcursed item. Click it to see only those items.",
            kind = "itemIds",
            severity = "info",
            ids = {
                -- TODO ids: ask Alex or /crt dev gear
                -- (/crt dev gear prints each item's ID and bonus IDs; then check kind, severity and help fit)
            },
        },
        {
            key = "voidcore",
            label = "Voidcores",
            help = "Shows who has a voidcore in their gear. Click it to see only those items.",
            kind = "itemIds", -- change to bonusIds if a voidcore shows as a bonus ID on the item
            severity = "info",
            ids = {
                -- TODO ids: ask Alex or /crt dev gear
                -- (/crt dev gear prints each item's ID and bonus IDs; then check kind, severity and help fit)
            },
        },
    },
})
