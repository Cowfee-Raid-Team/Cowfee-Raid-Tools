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
-- A check with no ids does nothing and has no chip, so a check can be written before its IDs are known.
-- The season's temporary checks go when the season does: delete their entries, never the rules above.

CRT.Bosses:SeasonData("midnight-s1", "gearChecks", {
    enchant = { 1, 3, 5, 7, 8, 11, 12, 16, 17 },
    enchantWeaponOnly = { 17 },
    sockets = true,
    checks = {
        {
            key = "venomcursed",
            label = "Venomcursed",
            help = "Shows who wears a Venomcursed item. Click it to see only those items.",
            kind = "itemIds",
            severity = "info",
            ids = {
                -- TODO ids: ask Alex or /crt dev probe
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
                -- TODO ids: ask Alex or /crt dev probe
                -- (/crt dev gear prints each item's ID and bonus IDs; then check kind, severity and help fit)
            },
        },
    },
})
