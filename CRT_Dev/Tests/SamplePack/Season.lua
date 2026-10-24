local ADDON, CRT = ...

-- TEST DATA, never shipped. The sample season pack the tests load in place of the shipped season, so a change to
-- a shipped boss file never breaks a test and a test never reads shipped data. Same shape as a real pack
-- (CRT_Data/Seasons/<pack>/Season.lua, see CRT_Data/Bosses/Registry.lua): a season with a raid route, and the
-- boss files beside it, frozen copies of two shipped bosses as they were on 2026-10-24. The route's other IDs
-- have no file here, so they stay out of every list unless a test registers them.

CRT.Bosses:Season({
    key = "sample",
    name = "Sample Season",
    expansion = "Sample",
    order = 1,
    current = true,
    raids = {
        {
            key = "sample",
            name = "Sample Raid",
            bosses = {
                3470, -- Nek'zali the Soulcoiler (NekzaliTheSoulcoiler.lua)
                3497, -- The Lost Explorers
                3445, -- Entombed Sentinels
                3455, -- Vashnik the Malignant
                3420, -- Sszorak (Sszorak.lua)
                3421, -- The Twin Fangs
                3429, -- The Coiled Altar
                3492, -- Ula'tek
            },
        },
    },
})
