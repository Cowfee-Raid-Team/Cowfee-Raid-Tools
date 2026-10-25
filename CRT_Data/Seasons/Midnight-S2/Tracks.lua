local ADDON, CRT = ...

-- This season's upgrade tracks, read through CRT.Bosses:Tracks(). The Gear Checker tags each item with its
-- track and rank (H4), counts them per player and lists who wears an item below a picked track.
--   list     the tracks, lowest first: { key, label, letter, quality, color }
--              key      unique; the saved Below choice is a key (CRTDB.gearChecker.belowTrack)
--              letter   the cell's tag and the Tracks column ("H4", "3H")
--              quality  the game's item quality whose colour the track takes (Enum.ItemQuality: 0 Poor,
--                       1 Common, 2 Uncommon, 3 Rare, 4 Epic, 5 Legendary); the colour comes from the game
--              color    { r, g, b }, a track's own colour where no item quality colour fits
--   default  the track Below picks when the saved one isn't in this list
--   bonus    [bonus ID] = { track = key, rank, max }: the bonus ID that puts an item on a track at a rank
--            ("Hero 4/6" is { track = "hero", rank = 4, max = 6 }). An item with none of them shows no track.
-- The track names are the ones warcraft.wiki.gg's Item upgrade page lists since Dragonflight Season 2 (read
-- 2026-10-21). Until the bonus map has IDs the page shows no tracks and has no Below chip.

CRT.Bosses:SeasonData("midnight-s2", "tracks", {
    default = "hero",
    list = {
        { key = "explorer", label = "Explorer", letter = "E", quality = 0 },
        { key = "adventurer", label = "Adventurer", letter = "A", quality = 1 },
        { key = "veteran", label = "Veteran", letter = "V", quality = 2 },
        { key = "champion", label = "Champion", letter = "C", quality = 3 },
        { key = "hero", label = "Hero", letter = "H", quality = 4 },
        { key = "myth", label = "Myth", letter = "M", quality = 5 },
    },
    bonus = {
        -- From Alex's /crt dev gear and the items' tooltips, 2026-10-24. Each is the one 128xx bonus ID the
        -- items differ by; only ranks seen on a real item are listed (never guessed from the pattern).
        [12843] = { track = "hero", rank = 3, max = 6 }, -- Leggings of the Galeforce Viper (159329), ilvl 311
        [12846] = { track = "hero", rank = 6, max = 6 }, -- neck 273781, chest 271531, hands 159312, ring 272149, all ilvl 321 and fully upgraded (Alex, 2026-10-24: "all my gear is capped except" the legs)
        [12853] = { track = "myth", rank = 5, max = 6 }, -- head 271528, ilvl 331
        [12854] = { track = "myth", rank = 6, max = 6 }, -- Enigmatic Dreamwatcher's Plumage (271526), ilvl 334
        -- TODO ids: the other ranks and tracks (/crt dev gear on more items, with their tooltips' Upgrade Level)
    },
})
