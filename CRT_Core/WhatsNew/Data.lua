local ADDON, CRT = ...

-- What's new (WhatsNew.lua): one entry per release, newest first, written at release time beside CHANGELOG.md's
-- entry. lines: at most 5 one-line items, each under 60 characters, written for players; more: how many smaller
-- changes the changelog has beyond them ("and N smaller fixes"). Never name another addon except an integration.
-- CRT_Dev/Tests/run_whatsnew.js checks every entry.
CRT.WhatsNewData = {
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
