local ADDON, CRT = ...

-- What's new (WhatsNew.lua): one entry per release, newest first, written at release time beside CHANGELOG.md's
-- entry. lines: at most 5 one-line items, each under 60 characters, written for players; more: how many smaller
-- changes the changelog has beyond them ("and N smaller fixes"). Never name another addon except an integration.
-- CRT_Dev/Tests/run_whatsnew.js checks every entry.
CRT.WhatsNewData = {
    {
        version = "1.2.0",
        lines = {
            "Assign tab: soaks and sides with timers",
            "Interrupts: kick numbers over a boss's adds",
            "Drag kickers in the note's Kick order",
            "Addon check: who runs CRT and which version",
            "Mech Alerts: save an alert into the raid note",
        },
        more = 5,
    },
    {
        version = "1.1.5",
        lines = {
            "Pick tonight's team: Team, Pug or your own",
            "Raid leaders push the team to the whole raid",
            "New raid group popup: Loot Master and team",
            "Season Stats: filter pulls by team",
            "Remove a team and its stats, after two warnings",
        },
        more = 0,
    },
    {
        version = "1.1.4",
        lines = {
            "Placement: move, centre and anchor every element",
            "Select Anchor: click your unit frame to anchor to it",
            "Share Mech Alerts and special alerts as a code",
            "Impact ticks and fill-up bars on any mechanic",
            "My Loot card and /crt loot open your roll window",
        },
        more = 11,
    },
    {
        version = "1.1.3",
        lines = {
            "Season Stats: kills, wipes and repair costs per boss",
            "Healer CDs view in the Timeline pop-out",
            "Drag the Timeline's time bar to zoom in",
            "Hover any ability for its Journal notes",
            "Raid note History: compare and restore",
        },
        more = 8,
    },
    {
        version = "1.1.2",
        lines = {
            "Requests: ask the raid who needs a rune or a flask",
            "Export settings only: share your setup with raiders",
            "Invite missing players from Raid Groups or Late Tracker",
            "Loot Master: add items from your bags, safer trades",
            "Markers: marker macros and a freeform marker canvas",
        },
        more = 18,
    },
}
