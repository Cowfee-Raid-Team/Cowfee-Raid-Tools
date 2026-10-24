local ADDON, CRT = ...

-- Nymrissa Wavecaller. Everything the addon ships about this boss, read by Bosses/Registry.lua.
--
-- encounterID 3379 comes from the boss's Warcraft Logs rankings link (boss=3379), not from a pull
--             yet.
-- references  The Mythic reference timeline, in the Timeline's text format (see Timeline/Database.lua
--             for the format), transcribed from a planner screenshot on 2026-10-19. The rows have no
--             types yet: Alex sets them in game with the Logged Timeline Ref tool on the Development page,
--             and its export replaces this block.

CRT.Bosses:Register({
    encounterID = 3379,
    name = "Nymrissa Wavecaller",
    season = "midnight-s2",
    references = {
        [[
Boss: Nymrissa Wavecaller
Difficulty: Mythic
Length: 9:10
Encounter: 3379
Abyssal Rain: 0:10, 0:43, 1:27, 2:33, 3:17, 4:23, 5:07, 6:13, 6:57, 8:03, 8:47
Water Jet: 0:30, 0:52, 1:13, 1:35, 2:20, 2:42, 3:04, 3:26, 4:10, 4:32, 4:54, 5:16, 6:00, 6:22, 6:44, 7:06, 7:50, 8:12, 8:34, 8:56
Chilling Frost: 0:38, 1:22, 2:28, 3:12, 4:18, 5:02, 6:08, 6:52, 7:58, 8:42
Frost Orb: 0:44+20, 1:28+20, 2:34+20, 3:18+20, 4:24+20, 5:08+20, 6:14+20, 6:58+20, 8:04+20, 8:48+20
Swirling Whirlpools (lead 3): 1:50, 3:41, 5:31, 7:21
Pop!: 1:59, 3:50, 5:40, 7:30
Murloc Wave: 0:24, 1:08, 2:15, 2:59, 4:05, 4:49, 5:55, 6:39
# Estimates: Frost Orb's +20 bars and Swirling Whirlpools' lead 3 are read off the axis. The planner shows no phase lines and no Murloc Wave after 6:39.
]],
    },
})
