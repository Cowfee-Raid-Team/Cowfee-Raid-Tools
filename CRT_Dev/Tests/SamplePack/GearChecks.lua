local ADDON, CRT = ...

-- TEST DATA, never shipped. A frozen copy of the GearChecks.lua topic file as it was on 2026-10-24, for the tests in
-- CRT_Dev/Tests (the .toc never lists this folder). The format is explained in the shipped file,
-- CRT_Data/Seasons/<pack>/GearChecks.lua, which can change without touching this one.

CRT.Bosses:SeasonData("sample", "gearChecks", {
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
