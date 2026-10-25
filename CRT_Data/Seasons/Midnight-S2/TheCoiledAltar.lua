local ADDON, CRT = ...

-- The Coiled Altar. Everything the addon ships about this boss, read by Bosses/Registry.lua.
--
-- encounterID 3429 comes from the boss's Warcraft Logs rankings link (boss=3429), not from a pull
--             yet; /crt dev seasons ids checks it against the saved pulls.
-- references  The Mythic reference timeline, in the Timeline's text format (see Timeline/Database.lua
--             for the format), transcribed from a planner screenshot on 2026-10-17 (the vault note
--             "Cowfee Raid Tools - Boss Reference Transcriptions"). The rows have no types yet: Alex
--             sets them in game with the Logged Timeline Ref tool on the Development page, and its export
--             replaces this block.
-- special     The boss's special alerts on Raid Notes > Mech Alerts > Special (the format is at the top of
--             Alerts/Special.lua). Each one names a row of the ability timeline (when.row), so its times are that
--             row's casts and move when the reference changes. A row that runs through several phases (Venom
--             Rupture, Dreadmarch, Spiritcackle, Gloombomb, Eternal Nightfall) has one alert; the engine puts each
--             cast in its phase. Sever, Soul Sever and Blighted Sever each have two: a Frontal for everyone and a
--             Taunt swap for tanks (off until ticked). Both play, since only your own reminders step aside for a
--             special alert. On until a player changes them: the three Frontals, the two Soaks, Mind controls,
--             Debuffs and Shield; the rest are off until ticked. The (?) sentences come from the boss's Encounter
--             Journal text. The Soaks (Guillotine, Grim Guillotine) are for everyone: the Journal says the axe
--             hits a random player and is split among those within 9 yards. Gloombomb has the spread type: marked
--             players explode on everyone within 15 yards, and the Journal shows no dispel icon on it.
--             The reference has phase lines (P2 at 2:55, P2.5 at 6:22, P3 at 7:00), so every cast after 2:55 is
--             a phase 2 or 3 item. It has no phase triggers yet, so in a pull those alerts wait for Next phase.
--             Every alert has difficulty = "mythic": the only ability timeline is Mythic's, and a Normal or Heroic
--             run with none of its own would read Mythic's times. On Normal and Heroic none is listed.
--             Still needs Alex:
--               - phase triggers, once his /crt dev probe pull confirms the phase events: until then phase 2 and 3
--                 alerts wait for Next phase;
--               - a Heroic ability timeline (from his screenshot): until then Normal and Heroic get no alerts.
--             CRT_Dev/Tests/run_season_special.js checks every entry reads and every row is on the reference.

CRT.Bosses:Register({
    encounterID = 3429,
    name = "The Coiled Altar",
    season = "midnight-s2",
    references = {
        [[
Boss: The Coiled Altar
Difficulty: Mythic
Length: 11:17
Encounter: 3429
Phase: P2 2:55
Phase: P2.5 6:22
Phase: P3 7:00
Coalesced Venom: 0:07+168, 7:06+251
Fangs of the Coiled Altar: 0:00, 1:24, 2:49
Toxic Deluge: 0:01, 0:44, 1:26, 2:09, 2:52, 7:02, 7:43, 8:43, 9:24, 10:24
Axegrinder: 0:13, 1:38
Sever: 0:22, 0:39, 0:59, 1:16, 1:47, 2:04, 2:24, 2:41
Venom Rupture: 0:22, 0:39, 0:59, 1:16, 1:47, 2:04, 2:24, 2:41, 7:35, 8:06, 8:39, 9:16, 9:47, 10:19
Venomfang: 0:29, 1:04, 1:54, 2:29
Guillotine: 0:47, 2:12
Dreadful Presence: 2:55+206
Dreadmarch: 3:02, 3:39, 4:27, 5:04, 5:52, 7:56, 9:33, 10:21
Spiritcackle: 3:08, 3:41, 4:33, 5:06, 5:58, 8:02, 9:38
Gloombomb: 3:15, 3:52, 4:40, 5:17, 6:05, 7:26, 8:10, 8:48, 9:52
Retaliatory Malice: 3:12, 3:45, 4:37, 5:10, 6:02
Soul Sever: 3:33, 4:04, 4:58, 5:29
Eternal Nightfall: 4:05+15, 5:30+15, 7:37+15, 9:14+15
Suffocating Darkness: 4:07, 5:32, 7:39, 9:16
Ghastly Regeneration: 6:22
Spirit Erasure: 6:27+20
Defilement of the Coiled Altar: 7:00, 8:42, 10:24
Grim Guillotine (lead 6): 7:21, 8:26, 10:06
Blighted Sever: 7:35, 8:06, 8:39, 9:16, 9:47, 10:19
]],
    },
    special = {
        {
            key = "frontalP1",
            label = "Sever",
            help = "Zul'jan cleaves his primary target, hitting every player in a frontal cone and destroying any Coalesced Venom in it.",
            type = "dodge",
            default = true,
            difficulty = "mythic",
            when = { row = "Sever" },
            lead = 6,
            who = { mode = "everyone" },
            text = "Frontal",
            show = { callout = true, bar = true, speech = true },
        },
        {
            key = "frontalP2",
            label = "Soul Sever",
            help = "Malacrass blasts his primary target with shadow, hitting every player in a frontal cone and destroying any Manifestation of Dread in it.",
            type = "dodge",
            default = true,
            difficulty = "mythic",
            when = { row = "Soul Sever" },
            lead = 6,
            who = { mode = "everyone" },
            text = "Frontal",
            show = { callout = true, bar = true, speech = true },
        },
        {
            key = "frontalP3",
            label = "Blighted Sever",
            help = "Zul'jan cleaves his primary target, hitting every player in a frontal cone and destroying any Coalesced Venom or Manifestation of Dread in it.",
            type = "dodge",
            default = true,
            difficulty = "mythic",
            when = { row = "Blighted Sever" },
            lead = 6,
            who = { mode = "everyone" },
            text = "Frontal",
            show = { callout = true, bar = true, speech = true },
        },
        {
            key = "tauntP1",
            label = "Sever taunt swap",
            help = "Sever makes the players it hits take 200% more damage from Sever for 30 seconds.",
            type = "generic",
            difficulty = "mythic",
            when = { row = "Sever" },
            lead = 4,
            who = { mode = "roles", roles = { "tank" } },
            text = "Taunt swap",
            show = { callout = true, bar = false, speech = true },
        },
        {
            key = "tauntP2",
            label = "Soul Sever taunt swap",
            help = "Soul Sever makes the players it hits take 200% more damage from Soul Sever and shadow damage every 2 seconds, for 36 seconds.",
            type = "generic",
            difficulty = "mythic",
            when = { row = "Soul Sever" },
            lead = 4,
            who = { mode = "roles", roles = { "tank" } },
            text = "Taunt swap",
            show = { callout = true, bar = false, speech = true },
        },
        {
            key = "tauntP3",
            label = "Blighted Sever taunt swap",
            help = "Blighted Sever makes the players it hits take 200% more damage from Blighted Sever for 30 seconds.",
            type = "generic",
            difficulty = "mythic",
            when = { row = "Blighted Sever" },
            lead = 4,
            who = { mode = "roles", roles = { "tank" } },
            text = "Taunt swap",
            show = { callout = true, bar = false, speech = true },
        },
        {
            key = "soakP1",
            label = "Guillotine",
            help = "Zul'jan throws an axe at a random player, split among the players within 9 yards; if fewer than five are hit, everyone takes the hit.",
            type = "soak",
            default = true,
            difficulty = "mythic",
            when = { row = "Guillotine" },
            lead = 8,
            who = { mode = "everyone" },
            text = "Soak",
            show = { callout = true, bar = true, speech = true },
        },
        {
            key = "soakP3",
            label = "Grim Guillotine",
            help = "Zul'jan throws an axe at a random player, split among the players within 9 yards; if fewer than five are hit, everyone takes the hit.",
            type = "soak",
            default = true,
            difficulty = "mythic",
            when = { row = "Grim Guillotine" },
            lead = 8,
            who = { mode = "everyone" },
            text = "Soak",
            show = { callout = true, bar = true, speech = true },
        },
        {
            key = "orbDeadline",
            label = "Venom Rupture",
            help = "A destroyed Coalesced Venom globule explodes, hitting every player.",
            type = "generic",
            difficulty = "mythic",
            when = { row = "Venom Rupture" },
            lead = 10,
            who = { mode = "everyone" },
            text = "Orb deadline",
            show = { callout = true, bar = true, speech = false },
        },
        {
            key = "mindControls",
            label = "Dreadmarch",
            help = "Malacrass possesses players and walks them to the edge of the arena to jump off; when one jumps or loses the absorb shield, two Manifestations of Dread appear.",
            type = "generic",
            default = true,
            difficulty = "mythic",
            when = { row = "Dreadmarch" },
            lead = 6,
            who = { mode = "everyone" },
            text = "Mind controls",
            show = { callout = true, bar = true, speech = true },
        },
        {
            key = "debuffs",
            label = "Gloombomb",
            help = "Malacrass marks players for 5 seconds, then they explode, hitting every player within 15 yards.",
            type = "spread", -- marked players explode on everyone within 15 yards; the Journal shows no dispel icon
            default = true,
            difficulty = "mythic",
            when = { row = "Gloombomb" },
            lead = 6,
            who = { mode = "roles", roles = { "dps", "healer" } },
            text = "Debuffs",
            show = { callout = true, bar = true, speech = false },
        },
        {
            key = "shield",
            label = "Eternal Nightfall",
            help = "Malacrass shields himself in a Veil of Twilight before a blast that hits every player and then every second; the cast can be interrupted once the shield breaks.",
            type = "raid",
            default = true,
            difficulty = "mythic",
            when = { row = "Eternal Nightfall" },
            lead = 6,
            who = { mode = "everyone" },
            text = "Shield",
            show = { callout = true, bar = true, speech = true },
            -- the bar runs the 15 s the row's casts last (+15 on the reference)
            bar = { length = 15 },
        },
        {
            key = "ghosts",
            label = "Spiritcackle",
            help = "Malacrass calls up a Spiteful Soulcoiler, whose Wail of Terror fears every player for 5 seconds unless it is interrupted.",
            type = "generic",
            difficulty = "mythic",
            when = { row = "Spiritcackle" },
            lead = 6,
            who = { mode = "everyone" },
            text = "Ghosts (interrupt)",
            show = { callout = true, bar = true, speech = false },
        },
    },
})
