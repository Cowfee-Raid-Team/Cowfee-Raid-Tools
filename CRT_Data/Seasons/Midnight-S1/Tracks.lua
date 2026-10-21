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

CRT.Bosses:SeasonData("midnight-s1", "tracks", {
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
        -- TODO ids: ask Alex or /crt dev probe
        -- (/crt dev gear prints each item's bonus IDs and the track this map gives it; wear or inspect one item
        -- per track and rank, and the bonus ID that changes with the rank is the one; never guess)
    },
})
