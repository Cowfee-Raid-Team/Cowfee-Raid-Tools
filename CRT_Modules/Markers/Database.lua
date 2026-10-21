local ADDON, CRT = ...

-- The marker displays that ship with the addon, one per boss encounter at most, keyed by the
-- encounter ID. Each is made in the dev editor (/crt dev markers, Dev/MarkerEditor.lua) and its
-- Export written into the boss file, so everyone with the addon gets the same display.
--
--   name       what the display is called, shown on its drag bar and the Reminders tab
--   slots      how many messages it shows, 1 to 8, in the order they are sent
--   layout     "row" (left to right), "column" (top to bottom), "grid" (rows of four) or "free"
--              (each slot at its own place on a canvas, below)
--   shape      free only: the faint outline behind the slots, "square" (default), "circle" or "none"
--   canvas     free only: the canvas's width and height in pixels, 80 to 400 (default 220)
--   places     free only: each slot's place, { { x, y }, ... } in slot order, as fractions of the
--              canvas from its top left (0 to 1), so the icon and canvas sizes keep the layout. A slot
--              without one sits on the ring (circle) or in an even grid
--   iconSize   the marker's size in pixels
--   number     true to show the slot number above each marker
--   names      true to show who sent it under each marker
--   clearGap   seconds after the last message before it clears, 0 for never
--   clearFull  seconds after the last slot fills before it clears, 0 for never
--   clearPhase true to clear when a new phase starts (Alerts/Engine.lua)
--   hidden     when the game hides chat text (in a raid, and during a boss fight): "fill" (the
--              default) to fill a slot for any message, or "ignore" to leave hidden messages out
-- It always clears when the pull starts and when it ends, kill or wipe.
--
-- Raiders send the markers with macros such as /raid {rt3} (or {diamond}), one per marker. A
-- readable message fills a slot only when it holds a marker code.

-- They ship in each boss's file in the season packs (field markers), and Bosses/Registry.lua puts
-- the loaded seasons' displays here.

CRT.MarkerDisplayDB = {
    displays = {},
}
