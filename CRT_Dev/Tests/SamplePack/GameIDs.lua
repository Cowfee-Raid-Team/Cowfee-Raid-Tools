local ADDON, CRT = ...

-- TEST DATA, never shipped. A frozen copy of the GameIDs.lua topic file as it was on 2026-10-24 (after the four
-- cooldown fixes of that day), trimmed to a few consumables per category, for the tests in CRT_Dev/Tests (the
-- .toc never lists this folder). The formats are explained in the module files (Consumables/Database.lua,
-- Alerts/CooldownData.lua, ReadyCheck/Report.lua); the shipped file, CRT_Data/Seasons/<pack>/GameIDs.lua, can
-- change without touching this one.

local HOLY_PALADIN, DISC_PRIEST, HOLY_PRIEST, RESTO_SHAMAN = 65, 256, 257, 264
local RESTO_DRUID, MISTWEAVER, PRESERVATION = 105, 270, 1468

CRT.Bosses:SeasonData("sample", "gameIDs", {
    consumables = {
        expansion = "Sample",
        updated = "2026-10-24",
        foodBuffs = {
            { buff = 456410, name = "Well Fed" },
            { buff = 1233724, name = "Hearty Well Fed" },
        },
        categories = {
            food = {
                { item = 255845, name = "Silvermoon Parade" },
                { item = 242275, name = "Royal Roast" },
            },
            flask = {
                { item = 241324, name = "Flask of the Blood Knights" },
                { item = 241326, name = "Flask of the Shattered Sun" },
            },
            potion = {
                { item = 241308, name = "Light's Potential" },
            },
            weapon = {
                { item = 243734, name = "Thalassian Phoenix Oil" },
            },
            rune = {
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
        { class = "PRIEST", spellID = 472433, kind = "healer", cd = 90 }, -- Evangelism
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
