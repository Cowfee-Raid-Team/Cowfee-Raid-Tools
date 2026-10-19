local ADDON, CRT = ...

-- Kith'ix. Everything the addon ships about this boss, read by Bosses/Registry.lua.
--
-- encounterID 3513 comes from the boss's Warcraft Logs rankings link (boss=3513), not from a pull
--             yet.
-- references  The Mythic reference timeline, in the Timeline's text format (see Timeline/Database.lua
--             for the format), transcribed from two planner screenshots on 2026-10-19. The rows have
--             no types yet: Alex sets them in game with the Reference types tool on the Development
--             page, and its export replaces this block.

CRT.Bosses:Register({
    encounterID = 3513,
    name = "Kith'ix",
    season = "midnight-s1",
    references = {
        [[
Boss: Kith'ix
Difficulty: Mythic
Length: 7:00
Encounter: 3513
Phase: P2 4:15
Voidswarm: 0:05+6, 1:54+6, 3:43+6
Voidweave: 0:12+24, 2:01+24, 3:50+24
Digestive Juices: 0:13+20, 2:02+20, 3:51+20
Venom Roar: 0:19, 0:35, 0:51, 1:08, 2:08, 2:24, 2:40, 2:57, 3:57, 4:13
Dark Devastation (lead 3): 0:23, 0:43, 1:06, 2:12, 2:32, 2:55, 4:01
Extinguish (lead 6): 0:37, 1:19, 2:26, 3:08
Unspeakable Horrors (lead 4): 0:43+8, 1:30+8, 2:32+8, 3:19+8
Nightfall (lead 2): 0:42, 2:31
Suffocating Darkness (lead 5): 0:57+44, 2:46+44
Abyssal Grasp: 1:02, 1:29, 2:51, 3:18
Divine Radiance: 1:41, 3:30
Last Light: 4:15
Eightfold Eclipse (lead 4): 4:17, 4:25, 4:34, 4:42, 4:51, 5:00, 5:08, 5:17, 5:26, 5:34, 5:43, 5:52, 6:00, 6:09
Null Gate: 4:19+5, 4:27+5, 4:35+5, 4:43+5, 4:51+5, 4:59+5, 5:07+5, 5:15+5, 5:23+5, 5:31+5, 5:39+5, 5:47+5, 5:55+5, 6:03+5, 6:11+5
Negation (lead 2): 4:28+12, 4:43+12, 4:58+12, 5:13+12, 5:28+12, 5:43+12, 5:58+12, 6:13+12
# Estimates: every bar (+N) and lead is read off the axis. The first Eightfold Eclipse is two overlapping icons near 4:16-4:17, written once.
# The planner's phase lines have no labels: P2 at about 4:15 is where the abilities change; a second red line at about 6:15 is left out.
]],
    },
})
