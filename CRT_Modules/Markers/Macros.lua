local ADDON, CRT = ...

-- The Marker calls macro set (CRT.Macros, Core/Macros.lua): one macro per raid marker, "CRT Star" to "CRT Skull",
-- each sending its marker code to raid chat, where the Marker display reads it (Markers/Display.lua).
-- /raid is a chat command, which takes no macro conditionals, so it can't fall back to /party (Blizzard's
-- ChatFrameBase parses conditionals only for the secure commands). The icons are the game's raid target icons,
-- Interface\TargetingFrame\UI-RaidTargetingIcon_1 to _8, file IDs 137001 to 137008.

local NAMES = { "Star", "Circle", "Diamond", "Triangle", "Moon", "Square", "Cross", "Skull" }
local FIRST_ICON = 137001

local macros = {}
for i, name in ipairs(NAMES) do
    macros[i] = { name = "CRT " .. name, icon = FIRST_ICON + i - 1, body = "/raid {rt" .. i .. "}" }
end

CRT.Macros:Register({ key = "markers", label = "Marker calls", macros = macros })
