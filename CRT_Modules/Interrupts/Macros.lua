local ADDON, CRT = ...

-- The Target markers macro set (CRT.Macros, Core/Macros.lua), shown on Interrupts > Macros (Interrupts/Page.lua): one
-- macro per raid marker, "CRT Mk Star" to "CRT Mk Skull", each putting its marker on the mob under the mouse, else on
-- the target, so a group's kick add can be marked fast. Names keep to the game's 16 characters ("CRT Mk Triangle" is
-- the longest, 15); the icon says which marker.
-- /tm takes macro conditionals: Blizzard's Blizzard_ChatFrameBase/Shared/SlashCommands.lua (Gethe/wow-ui-source,
-- live, read 2026-11-14) runs SLASH_COMMAND.TARGET_MARKER's text through SecureCmdOptionParse and uses "target" when
-- no unit is given, so [@mouseover,exists,nodead] marks the mouseover and the empty [] falls back to the target. The
-- icons are the game's raid target icons, Interface\TargetingFrame\UI-RaidTargetingIcon_1 to _8, file IDs 137001 to
-- 137008.

local NAMES = { "Star", "Circle", "Diamond", "Triangle", "Moon", "Square", "Cross", "Skull" }
local FIRST_ICON = 137001

local macros = {}
for i, name in ipairs(NAMES) do
    macros[i] = { name = "CRT Mk " .. name, icon = FIRST_ICON + i - 1, body = "/tm [@mouseover,exists,nodead][] " .. i }
end

CRT.Macros:Register({ key = "targetMarks", label = "Target markers", macros = macros })
