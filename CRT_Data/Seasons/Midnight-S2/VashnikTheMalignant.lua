local ADDON, CRT = ...

-- Vashnik the Malignant. Everything the addon ships about this boss, read by Bosses/Registry.lua.
--
-- encounterID 3455 comes from the boss's Warcraft Logs rankings link (boss=3455), not from a pull
--             yet; /crt dev seasons ids checks it against the saved pulls.
-- references  The Mythic reference timeline, in the Timeline's text format (see Timeline/Database.lua
--             for the format), transcribed from a planner screenshot on 2026-10-17 (the vault note
--             "Cowfee Raid Tools - Boss Reference Transcriptions"). The rows have no types yet: Alex
--             sets them in game with the Logged Timeline Ref tool on the Development page, and its export
--             replaces this block.

CRT.Bosses:Register({
    encounterID = 3455,
    name = "Vashnik the Malignant",
    season = "midnight-s2",
    references = {
        [[
Boss: Vashnik the Malignant
Difficulty: Mythic
Length: 8:20
Encounter: 3455
Toxic Vapor: 0:02+498
Dripping Fangs: 0:10, 0:39, 1:06, 1:34, 2:03, 2:30, 2:58, 3:27, 3:54, 4:22, 4:51, 5:18, 5:46, 6:15, 6:42, 7:10, 7:39, 8:06
Imbibe (lead 6): 0:24, 1:48, 3:12, 4:36, 6:00, 7:24, 8:03
Conflagrating Expulsion: 0:24, 1:48, 3:12, 4:36, 6:00, 7:24, 8:03
Gloom Expulsion: 0:24, 1:48, 3:12, 4:36, 6:00, 7:24, 8:03
Burning Presence: 0:27+20, 1:51+20, 3:15+20, 4:39+20, 6:03+20, 7:27+20, 8:06
Caustic Surge: 0:53, 2:17, 3:41, 5:05, 6:29, 7:53
Malignant Catalyst (lead 8): 0:35, 1:14, 1:59, 2:38, 3:23, 4:02, 4:47, 5:26, 6:11, 6:50, 7:35
Exploding Infection: 0:42, 1:41, 2:06, 3:05, 3:30, 4:29, 4:54, 5:53, 6:18, 7:17, 7:42
Caustic Explosion: 0:42, 1:41, 2:06, 3:05, 3:30, 4:29, 4:54, 5:53, 6:18, 7:17, 7:42
Stygian Infection: 0:42, 1:41, 2:06, 3:05, 3:30, 4:29, 4:54, 5:53, 6:18, 7:17, 7:42
Plague Froth: 0:13, 0:54, 1:30, 2:18, 2:54, 3:42, 4:18, 5:06, 5:42, 6:30, 7:06, 7:54
# Left out, labels overlapped: Imbibe, both Expulsions and Burning Presence each have two more casts between 7:24 and 8:03 (read as 7:4x and 7:5x).
# Left out: Caustic Surge's first two casts in each group of three (about 10 seconds apart, before 0:53, 2:17, 3:41, 5:05, 6:29 and 7:53).
# Left out: the last Malignant Catalyst, at 8:1x, cut off at the edge.
]],
        [[
Boss: Vashnik the Malignant
Difficulty: Heroic
Length: 10:50
Encounter: 3455
Toxic Vapor: 0:02+648
Dripping Fangs: 0:10, 0:39, 1:06, 1:34, 2:03, 2:30, 2:58, 3:27, 3:54, 4:22, 4:51, 5:18, 5:46, 6:15, 6:42, 7:10, 7:39, 8:06, 8:34, 9:03, 9:30, 9:58, 10:27
Imbibe (lead 6): 0:24, 1:48, 3:12, 4:36, 6:00, 7:24, 8:48, 10:12
Conflagrating Expulsion: 0:24, 1:48, 3:12, 4:36, 6:00, 7:24, 8:48, 10:12
Gloom Expulsion: 0:24, 1:48, 3:12, 4:36, 6:00, 7:24, 8:48, 10:12
Burning Presence: 0:27+30, 1:51+30, 3:15+30, 4:39+30, 6:03+30, 7:27+30, 8:51+30, 10:15+30
Caustic Surge: 0:47, 1:00, 2:11, 2:24, 3:35, 3:48, 4:59, 5:12, 6:23, 6:36, 7:47, 8:00, 9:11, 9:24, 10:35
Malignant Catalyst (lead 8): 0:35, 1:14, 1:59, 2:38, 3:23, 4:02, 4:47, 5:26, 6:11, 6:50, 7:35, 8:14, 8:59, 9:38, 10:23
Exploding Infection: 0:42, 1:34, 2:06, 2:58, 3:30, 4:22, 4:54, 5:46, 6:18, 7:10, 7:42, 8:34, 9:06, 9:58, 10:30
Caustic Explosion: 0:42, 1:34, 2:06, 2:58, 3:30, 4:22, 4:54, 5:46, 6:18, 7:10, 7:42, 8:34, 9:06, 9:58, 10:30
Stygian Infection: 0:42, 1:34, 2:06, 2:58, 3:30, 4:22, 4:54, 5:46, 6:18, 7:10, 7:42, 8:34, 9:06, 9:58, 10:30
Plague Froth: 0:13, 0:54, 1:27, 2:18, 2:51, 3:42, 4:15, 5:06, 5:39, 6:30, 7:03, 7:54, 8:27, 9:18, 9:51
# Estimates: Burning Presence's +30 bars. Caustic Surge's first cast in each pair has a cut label (0:4x, 2:1x ...), read off the axis as 13 s before the second.
# Left out, cut off at the edge: the last Plague Froth (10:4x) and Caustic Surge (10:48).
]],
    },
})
