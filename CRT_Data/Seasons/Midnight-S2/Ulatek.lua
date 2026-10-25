local ADDON, CRT = ...

-- Ula'tek. Everything the addon ships about this boss, read by Bosses/Registry.lua.
--
-- encounterID 3492 comes from the boss's Warcraft Logs rankings link (boss=3492), not from a pull
--             yet; /crt dev seasons ids checks it against the saved pulls.
-- references  The Mythic reference timeline, in the Timeline's text format (see Timeline/Database.lua
--             for the format), transcribed from a planner screenshot on 2026-10-17 (the vault note
--             "Cowfee Raid Tools - Boss Reference Transcriptions"). The rows have no types yet: Alex
--             sets them in game with the Logged Timeline Ref tool on the Development page, and its export
--             replaces this block.
-- special     The boss's special alerts on Raid Notes > Mech Alerts > Special (the format is at the top of
--             Alerts/Special.lua). Each one but Pre-Pot names a row of the ability timeline (when.row), so its
--             times are that row's casts and move when the reference changes; Pre-Pot is 15 s before the pull,
--             from the game's pull timer only. Four are on until a player changes them (Caustic Waves, Mother's
--             Wrath for tanks, Rage of the Shackled, Circling Prey); the rest are off until ticked. The (?)
--             sentences come from the boss's Encounter Journal text; Slithering Gestation and Submerge are not
--             in it, so theirs only say what the row is. There is no tank-buster type, so Mother's Wrath has
--             the generic one. None has a difficulty: each follows the ability timeline of the run's group.
--             Still needs Alex:
--               - a Heroic ability timeline (from his screenshot): until then Normal and Heroic get no times;
--               - phase lines and phase triggers, once his /crt dev probe log confirms the phase events. Until
--                 then every cast counts from the pull, so a phase that starts early or late is not corrected.
--             CRT_Dev/Tests/run_season_special.js checks every entry reads and every row is on the reference.

CRT.Bosses:Register({
    encounterID = 3492,
    name = "Ula'tek",
    season = "midnight-s2",
    references = {
        [[
Boss: Ula'tek
Difficulty: Mythic
Length: 10:15
Encounter: 3492
Necrotic Vapors: 0:00+615
Call of the Serpent: 0:04, 1:15, 5:23, 6:21, 6:51, 8:29
Toxic Incubation (lead 6): 0:15+15, 1:24+15, 7:23+15
Mother's Wrath: 0:26, 1:36, 6:27, 7:52, 9:00
Mephitic Thrash: 0:48, 1:46
Caustic Waves (lead 6): 0:56, 1:52, 7:06, 8:01, 8:51, 9:35
Submerge: 1:19, 7:22, 8:14, 9:14
Rage of the Shackled (lead 6): 2:25+20, 4:54+20, 9:43+20
Venomous Heart: 2:25+20, 4:54+20, 9:43+20
Writhing Gestation: 3:04, 4:12
Blight Vein: 3:33
Slithering Gestation: 6:22, 6:52, 8:30
Serpent's Bite: 6:42, 7:46, 9:30
Volatile Purge: 7:01, 8:06, 9:49
Circling Prey (lead 6): 7:20, 8:11, 9:12
Fester Burst: 0:39, 1:14, 1:48, 2:23, 7:45, 8:19
# Left out, labels overlapped: Spectral Coils (three groups, near 0:4x, 2:1x and 6:2x), Shadow Molt (near 2:5x or 3:50), Grasping Fangs (near 3:1x), Acidic Expulsion (near 8:40), a second Necrotic Vapors cast near 2:51, and a second Blight Vein cast near 3:2x.
# Left out, cut off at the edge: Circling Prey's last cast near 10:1x.
# The phases: Stage 1 at 0:00, Stage 2 at about 2:24, Int at about 4:56 and Stage 3 at about 6:00.
]],
    },
    special = {
        {
            key = "waves",
            label = "Caustic Waves",
            help = "Waves of venom cross the platform. They hit on impact and keep hurting anyone in their path for 10 seconds.",
            type = "dodge",
            default = true,
            when = { row = "Caustic Waves" },
            lead = 6,
            who = { mode = "everyone" },
            text = "Waves",
            show = { callout = true, bar = true, speech = true },
        },
        {
            key = "mothersWrath",
            label = "Mother's Wrath",
            help = "Ula'tek knocks back her target and bites them, leaving stacking Stone Venom and a slow. If her target is out of reach, every player is hit.",
            type = "generic", -- there is no tank-buster type
            default = true,
            when = { row = "Mother's Wrath" },
            lead = 8,
            who = { mode = "roles", roles = { "tank" } },
            text = "Hit + Knock",
            show = { callout = true, bar = true, speech = true },
        },
        {
            key = "damageAmp",
            label = "Rage of the Shackled",
            help = "Ula'tek rages for 20 seconds: raid damage every 5 seconds and falling debris. Flying into the rage exposes her Venomous Heart.",
            type = "raid",
            default = true,
            when = { row = "Rage of the Shackled" },
            lead = 15,
            who = { mode = "everyone" },
            text = "Damage amp",
            show = { callout = true, bar = true, speech = true },
            -- the bar runs the 20 s the row's casts last (+20 on the reference)
            bar = { length = 20 },
        },
        {
            key = "platformBreak",
            label = "Circling Prey",
            help = "Ula'tek destroys part of the platform, hitting and knocking back players within 13 yards.",
            type = "dodge",
            default = true,
            when = { row = "Circling Prey" },
            lead = 6,
            who = { mode = "everyone" },
            text = "Platform break",
            show = { callout = true, bar = true, speech = true },
        },
        {
            key = "debuffs",
            label = "Serpent's Bite",
            help = "Fangs hit random players and keep pumping venom every second. The poison turns them into a Calcified Corpse unless it is leeched within 15 seconds.",
            type = "heavydot", -- the Journal shows no dispel icon on it: the poison is leeched, not dispelled
            when = { row = "Serpent's Bite" },
            lead = 6,
            who = { mode = "everyone" },
            text = "Debuffs",
            show = { callout = true, bar = true, speech = false },
        },
        {
            key = "eggs",
            label = "Toxic Incubation",
            help = "A spectral Ula'tek sends a cascade toward the Toxic Blightscale. Each impact sets off Caustic Waves.",
            type = "generic",
            when = { row = "Toxic Incubation" },
            lead = 6,
            who = { mode = "everyone" },
            text = "Eggs",
            show = { callout = true, bar = true, speech = false },
        },
        {
            key = "adds",
            label = "Slithering Gestation",
            help = "Adds come, on each cast of this row of the ability timeline.",
            type = "generic",
            when = { row = "Slithering Gestation" },
            lead = 6,
            who = { mode = "everyone" },
            text = "Adds",
            show = { callout = true, bar = true, speech = true },
        },
        {
            key = "sweep",
            label = "Mephitic Thrash",
            help = "Ula'tek's tail sweeps the ground, knocking back players within 35 yards and leaving damage every 2 seconds for 20 seconds.",
            type = "dodge",
            when = { row = "Mephitic Thrash" },
            lead = 5,
            who = { mode = "everyone" },
            text = "Sweep",
            show = { callout = true, bar = true, speech = false },
        },
        {
            key = "submerge",
            label = "Submerge",
            help = "Ula'tek submerges, on each cast of this row of the ability timeline.",
            type = "generic",
            when = { row = "Submerge" },
            lead = 5,
            who = { mode = "everyone" },
            text = "Submerge",
            show = { callout = true, bar = true, speech = false },
        },
        {
            key = "prePot",
            label = "Pre-Pot",
            help = "Drink your potion before the pull. It plays only from the game's pull timer, 15 seconds before the pull.",
            type = "generic",
            -- no icon: no potion texture file ID could be confirmed from Blizzard's UI source or the wiki
            when = { times = "P1 -0:15" },
            lead = 8,
            who = { mode = "everyone" },
            text = "Pre-Pot",
            show = { callout = true, bar = false, speech = true },
        },
    },
})
