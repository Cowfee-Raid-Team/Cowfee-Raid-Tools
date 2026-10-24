local ADDON, CRT = ...

-- TEST DATA, never shipped. A frozen copy of the Sszorak boss file as it was on 2026-10-24, for the tests in
-- CRT_Dev/Tests (the .toc never lists this folder). The shipped file, CRT_Data/Seasons/<pack>/Sszorak.lua, can change
-- without touching this one, and nothing here needs to match the game: the tests check the engine, not the boss.

CRT.Bosses:Register({
    encounterID = 3420,
    name = "Sszorak",
    season = "sample",
    -- The marker display (Markers/Display.lua), exported from /crt dev markers on 2026-10-21.
    markers = { name = "Marker display", slots = 4, layout = "row", iconSize = 52, number = true, names = true, clearGap = 10, clearFull = 0, clearPhase = true, hidden = "fill" },
    references = {
        [[
Boss: Sszorak
Difficulty: Mythic
Length: 6:32
Encounter: 3420
Mutilate (type raid): 0:08+19, 0:55+19, 2:15+19, 3:02+19, 4:22+19, 5:09+19
Ravage (type soak): 0:08, 0:55, 2:15, 3:02, 4:22, 5:09
Tempest (type generic): 0:12, 0:59, 2:19, 3:06, 4:26, 5:13
Venomous Surge (type generic): 0:29, 1:17, 2:36, 3:23, 4:43, 5:30
Virulence (type raid): 0:27, 1:16, 2:32, 3:22, 4:39, 5:29
Raging Crosswinds (type generic): 0:39, 1:26, 2:46, 3:33, 4:53, 5:40
Dig In (type generic): 1:40+27, 3:47+27, 5:54+27
# The bar lengths are estimates from the screenshot's axis. The planner's green bar covers both the
# Mutilate and Ravage rows; it is on Mutilate here until Alex says whose it is.
# Left out, cut off at the end of the screenshot: the last Mutilate and Ravage (about 6:30).
# Raging Crosswinds is greyed out in the planner.
# Missing: Serpent's Fury (type mythic), its cast times aren't known yet.
]],
    },
})
