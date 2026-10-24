local ADDON, CRT = ...

-- This season's game IDs: the lists that change with the game rather than with a boss, kept in one file so a season
-- or a patch updates one place. Each part is read through its own accessor:
--   consumables  Bosses:Consumables()  the ready check row and your bar (format: Consumables/Database.lua)
--   cooldowns    Bosses:Cooldowns()    the Timeline's Cooldowns row and Healer CDs (format: Alerts/CooldownData.lua)
--   raidBuffs    Bosses:RaidBuffs()    the ready check's raid buffs (format: above Report.BUFFS in ReadyCheck/Report.lua)
-- Never guess an ID and never take one from Wowhead. Confirm the consumables with /crt consumables check in the game.
--
-- Consumables: the Midnight item IDs were taken on 2026-10-14 from the item links on Method's "List of all Midnight
-- consumables, enchants and gems" guide (https://www.method.gg/guides/list-of-all-midnight-consumables-enchants-and-gems),
-- written 2026-09-06 for patch 12.1. It listed no buff IDs, and the augment rune had no link, so the rune's IDs came
-- from the game instead. /crt consumables scan prints your buffs and bag consumables as lines to paste here.
--
-- Cooldowns: last checked 12.1.5. The major entries' spell IDs, cooldowns and specs were checked on warcraft.wiki.gg on
-- 2026-10-24 (Tranquility's retail ID is not listed there; 740 is its long-standing ID). Also on 2026-10-24, from
-- warcraft.wiki.gg: Holy Word: Salvation (265202) and Rapture (47536) were taken out (removed in 11.1.0), Emerald
-- Communion (370960) was taken out (a Preservation PvP talent since 12.0.0), and Evangelism is 472433 (was 246287).
-- The other entries were written from memory and are not yet confirmed. Check this list on every patch pass: an ID
-- the game deleted outright has no name and is skipped at runtime, but a removed or reworked talent may keep its name
-- and go on showing, so only the check catches it.
--
-- Raid buffs: the retail spell IDs linked from each Warcraft Wiki page, read 2026-10-14.

-- Healer specs (SpecializationID, warcraft.wiki.gg/wiki/SpecializationID)
local HOLY_PALADIN, DISC_PRIEST, HOLY_PRIEST, RESTO_SHAMAN = 65, 256, 257, 264
local RESTO_DRUID, MISTWEAVER, PRESERVATION = 105, 270, 1468

CRT.Bosses:SeasonData("midnight-s2", "gameIDs", {
    consumables = {
        expansion = "Midnight",
        updated = "2026-10-14",
        -- The food buffs the ready check and your bar look for, whatever was eaten. Buffs with "Well Fed"
        -- anywhere in their name count too, on an English client.
        foodBuffs = {
            -- Both from Alex on 2026-10-14: Hearty Well Fed from the game tooltip, and Well Fed, which may be
            -- the shared buff behind every Well Fed food, from a screenshot of its spell page.
            { buff = 456410, name = "Well Fed" },
            { buff = 1233724, name = "Hearty Well Fed" },
        },
        categories = {
            food = {
                -- Feasts
                { item = 255845, name = "Silvermoon Parade" }, -- main stat
                { item = 255846, name = "Harandar Celebration" }, -- main stat
                { item = 275264, name = "Amani Cornucopia" },
                { item = 275265, name = "Loa's Gathering" },
                { item = 275266, name = "Feast of Knowledge" },
                { item = 242272, name = "Quel'dorei Medley" },
                { item = 242273, name = "Blooming Feast" },
                -- Primary stat
                { item = 255847, name = "Impossibly Royal Roast" },
                { item = 242275, name = "Royal Roast" },
                { item = 242288, name = "Twilight Angler's Medley" },
                { item = 242289, name = "Spellfire Filet" },
                { item = 242303, name = "Mana-Infused Stew" },
                { item = 242302, name = "Bloom Skewers" },
                -- Highest secondary stat
                { item = 255848, name = "Flora Frenzy" },
                { item = 242274, name = "Champion's Bento" },
                { item = 275260, name = "Puffer Plate" },
                { item = 275261, name = "Sweet-And-Sour Skewers" },
                { item = 275258, name = "Venom-Spiced Cutlets" },
                -- One secondary stat
                { item = 242285, name = "Warped Wise Wings" }, -- mastery
                { item = 242281, name = "Glitter Skewers" }, -- mastery
                { item = 242284, name = "Void-Kissed Fish Rolls" }, -- versatility
                { item = 242280, name = "Buttered Root Crab" }, -- versatility
                { item = 242276, name = "Braised Blood Hunter" }, -- versatility
                { item = 242294, name = "Felberry Figs" }, -- versatility
                { item = 242283, name = "Sun-Seared Lumifin" }, -- critical strike
                { item = 242287, name = "Arcano Cutlets" }, -- critical strike
                { item = 242278, name = "Tasty Smoked Tetra" }, -- critical strike
                { item = 242282, name = "Null and Void Plate" }, -- haste
                { item = 242286, name = "Fel-Kissed Filet" }, -- haste
                { item = 242277, name = "Crimson Calamari" }, -- haste
                -- Two secondary stats
                { item = 242293, name = "Sunwell Delight" }, -- versatility, haste
                { item = 242295, name = "Hearthflame Supper" }, -- critical strike, haste
                { item = 242291, name = "Fried Bloomtail" }, -- mastery, versatility
                { item = 242292, name = "Eversong Pudding" }, -- mastery, critical strike
                { item = 242296, name = "Bloodthistle-Wrapped Cutlets" }, -- mastery, haste
                { item = 242290, name = "Wise Tails" }, -- critical strike, versatility
                { item = 242304, name = "Spiced Biscuits" }, -- critical strike, versatility
                { item = 242305, name = "Silvermoon Standard" }, -- mastery, versatility
                { item = 242307, name = "Quick Sandwich" }, -- versatility, haste
                { item = 242308, name = "Portable Snack" }, -- critical strike, haste
                { item = 242306, name = "Forager's Medley" }, -- mastery, critical strike
                { item = 242309, name = "Farstrider Rations" }, -- mastery, haste
            },
            flask = {
                { item = 241324, name = "Flask of the Blood Knights" }, -- haste
                { item = 241326, name = "Flask of the Shattered Sun" }, -- critical strike
                { item = 241322, name = "Flask of the Magisters" }, -- mastery
                { item = 241321, name = "Flask of Thalassian Resistance" }, -- versatility
            },
            potion = {
                { item = 241308, name = "Light's Potential" }, -- primary stat, 30 seconds
                { item = 241292, name = "Draught of Rampant Abandon" }, -- primary stat, 30 seconds
                { item = 241288, name = "Potion of Recklessness" }, -- highest secondary stat
                { item = 241296, name = "Potion of Zealotry" }, -- holy damage
                { item = 271887, name = "Liquid Luster" }, -- stacking versatility
                { item = 271890, name = "Alluring Nostrum" }, -- shadow damage
            },
            weapon = {
                { item = 243734, name = "Thalassian Phoenix Oil" }, -- critical strike, haste
                { item = 243738, name = "Smuggler's Enchanted Edge" }, -- arcane damage
                { item = 243736, name = "Oil of Dawn" }, -- absorb shield
                { item = 237371, name = "Refulgent Whetstone" }, -- bladed weapons
                { item = 237369, name = "Refulgent Weightstone" }, -- blunt weapons
                { item = 257750, name = "Laced Zoomshots" }, -- hunter ammo
                { item = 257752, name = "Weighted Boomshots" }, -- hunter ammo
            },
            rune = {
                -- Item ID and buff ID from Alex in the game on 2026-10-14. The buff is named "Void-Touched",
                -- without "Augment", so it is matched by its ID, not by the English name fallback.
                { item = 259085, buff = 1264426, name = "Void-Touched Augment Rune" },
            },
        },
    },

    cooldowns = {
        { class = "DRUID", spellID = 740, kind = "healer", cd = 180, major = true, spec = RESTO_DRUID }, -- Tranquility
        { class = "DRUID", spellID = 33891, kind = "healer", cd = 180, major = true, spec = RESTO_DRUID }, -- Incarnation: Tree of Life
        { class = "DRUID", spellID = 391528, kind = "healer", cd = 120, major = true, spec = RESTO_DRUID }, -- Convoke the Spirits
        { class = "DRUID", spellID = 197721, kind = "healer", cd = 90 }, -- Flourish
        { class = "EVOKER", spellID = 363534, kind = "healer", cd = 240, major = true, spec = PRESERVATION }, -- Rewind
        { class = "EVOKER", spellID = 359816, kind = "healer", cd = 120, major = true, spec = PRESERVATION }, -- Dream Flight
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
        { class = "PRIEST", spellID = 200183, kind = "healer", cd = 180, major = true, spec = HOLY_PRIEST }, -- Apotheosis
        { class = "PRIEST", spellID = 62618, kind = "healer", cd = 180, major = true, spec = DISC_PRIEST }, -- Power Word: Barrier
        { class = "PRIEST", spellID = 421453, kind = "healer", cd = 240, major = true, spec = DISC_PRIEST }, -- Ultimate Penitence
        { class = "PRIEST", spellID = 472433, kind = "healer", cd = 90 }, -- Evangelism (warcraft.wiki.gg, 2026-10-24)
        { class = "PRIEST", spellID = 33206, kind = "healer", cd = 180 }, -- Pain Suppression
        { class = "PRIEST", spellID = 47788, kind = "healer", cd = 180 }, -- Guardian Spirit
        { class = "SHAMAN", spellID = 108280, kind = "healer", cd = 180, major = true, spec = RESTO_SHAMAN }, -- Healing Tide Totem
        { class = "SHAMAN", spellID = 98008, kind = "healer", cd = 180, major = true, spec = RESTO_SHAMAN }, -- Spirit Link Totem
        { class = "SHAMAN", spellID = 114052, kind = "healer", cd = 180, major = true, spec = RESTO_SHAMAN }, -- Ascendance
        { class = "WARRIOR", spellID = 97462, kind = "raid", cd = 180 }, -- Rallying Cry
        { class = "DEMONHUNTER", spellID = 196718, kind = "raid", cd = 300 }, -- Darkness
        { class = "DEATHKNIGHT", spellID = 51052, kind = "raid", cd = 120 }, -- Anti-Magic Zone
        { class = "DRUID", spellID = 106898, kind = "raid", cd = 120 }, -- Stampeding Roar
    },

    raidBuffs = {
        { key = "intellect", spell = 1459, class = "MAGE", label = "Arcane Intellect", short = "Int" },
        { key = "stamina", spell = 21562, class = "PRIEST", label = "Power Word: Fortitude", short = "Stam" },
        { key = "attack", spell = 6673, class = "WARRIOR", label = "Battle Shout", short = "AP" },
        { key = "versatility", spell = 1126, class = "DRUID", label = "Mark of the Wild", short = "Vers" },
        { key = "mastery", spell = 462854, class = "SHAMAN", label = "Skyfury", short = "Mast" },
        { key = "movement", spell = 364342, class = "EVOKER", label = "Blessing of the Bronze", short = "Move" },
    },
})
