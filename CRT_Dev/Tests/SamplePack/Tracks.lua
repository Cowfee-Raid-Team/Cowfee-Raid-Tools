local ADDON, CRT = ...

-- TEST DATA, never shipped. A frozen copy of the Tracks.lua topic file as it was on 2026-10-24, for the tests in
-- CRT_Dev/Tests (the .toc never lists this folder). The format is explained in the shipped file,
-- CRT_Data/Seasons/<pack>/Tracks.lua, which can change without touching this one.

CRT.Bosses:SeasonData("sample", "tracks", {
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
        -- TODO ids: ask Alex or /crt dev gear
        -- (/crt dev gear prints each item's bonus IDs and the track this map gives it; wear or inspect one item
        -- per track and rank, and the bonus ID that changes with the rank is the one; never guess)
    },
})
