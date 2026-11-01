local ADDON, CRT = ...

-- The sound effects shipped with the addon, in CRT_Media/Media/Sounds/<folder>/<name>.mp3. This file is their one
-- list: every effect is a crt: sound (Sound.BUNDLED, crt:<folder>-<name>, such as crt:Devices-AirHorn), listed in every
-- sound dropdown under its category's heading, after the voices (Sound/Voices.lua loads first) and before Game sounds.
-- They are sounds, never speech: the voices' words come only from Sound.VOICES, so no text is ever said with one.
-- Two names are in two categories (StovePipe in Short and Devices, SynthHigh in Short and Instruments): different
-- files, told apart by their folder.
--
-- A new effect: its mp3 in its category's folder and one line here. A new category: its folder and one EFFECTS
-- entry, in the order the lists show them. run_sound_effects.js checks the list against the files on disk.

local Sound = CRT.Sound

-- The categories, in list order. files: { name (the file's, without .mp3), label (as the lists show it) }.
Sound.EFFECTS = {
    {
        key = "short", label = "Short", folder = "Short",
        files = {
            { "BellStrike", "Bell strike" }, { "BellTree", "Bell tree" }, { "BigPot", "Big pot" },
            { "Blades", "Blades" }, { "CoffeeMug", "Coffee mug" }, { "CowBell", "Cowbell" },
            { "FingerSnap", "Finger snap" }, { "Guitar", "Guitar" }, { "Kalimba", "Kalimba" },
            { "MetalBladeDrop", "Metal blade drop" }, { "MetalBladeOnRod", "Metal blade on rod" },
            { "MetalImpact", "Metal impact" }, { "MiniWoodXylophone", "Mini wood xylophone" },
            { "PaperCup", "Paper cup" }, { "SheetMetal", "Sheet metal" }, { "StovePipe", "Stove pipe" },
            { "StovePipeBlade", "Stove pipe blade" }, { "SwordShing", "Sword shing" },
            { "SynthBleep", "Synth bleep" }, { "SynthBlurp", "Synth blurp" }, { "SynthError", "Synth error" },
            { "SynthHigh", "Synth high" }, { "Triangle", "Triangle" }, { "WaterDrop", "Water drop" },
            { "WineBottle", "Wine bottle" }, { "WoodXylophone", "Wood xylophone" },
        },
    },
    {
        key = "impacts", label = "Impacts", folder = "Impacts",
        files = {
            { "AnvilStrike", "Anvil strike" }, { "BubbleSmash", "Bubble smash" }, { "LowThud", "Low thud" },
            { "MetalClanks", "Metal clanks" }, { "MetalRattle", "Metal rattle" }, { "MetalScrape", "Metal scrape" },
            { "MetalWarble", "Metal warble" }, { "PopClick", "Pop click" }, { "StrangeClang", "Strange clang" },
            { "SwordScrape", "Sword scrape" },
        },
    },
    {
        key = "instruments", label = "Instruments", folder = "Instruments",
        files = {
            { "BellRing", "Bell ring" }, { "BellTrill", "Bell trill" }, { "Brass", "Brass" },
            { "ChimeAscending", "Chime ascending" }, { "GuitarChug", "Guitar chug" },
            { "GuitarPinch", "Guitar pinch" }, { "PitchPipeDistressed", "Pitch pipe distressed" },
            { "PitchPipeNote", "Pitch pipe note" }, { "SynthBig", "Synth big" }, { "SynthBuzz", "Synth buzz" },
            { "SynthHigh", "Synth high" }, { "Warhorn", "War horn" },
        },
    },
    {
        key = "devices", label = "Devices", folder = "Devices",
        files = {
            { "AirHorn", "Air horn" }, { "BikeHorn", "Bike horn" }, { "BoatHorn", "Boat horn" },
            { "CashRegister", "Cash register" }, { "JackpotBell", "Jackpot bell" },
            { "JackpotCoins", "Jackpot coins" }, { "JackpotFail", "Jackpot fail" },
            { "RotaryPhoneDial", "Rotary phone dial" }, { "RotaryPhoneRing", "Rotary phone ring" },
            { "StovePipe", "Stove pipe" }, { "TrashcanLid", "Trash can lid" },
        },
    },
}

local TEXT = {
    listAnd = "%s and %s",
}

-- For the sound dropdowns' (?) (UI.SoundHelp), read from the table each time: the categories' names in list order,
-- "Short, Impacts, Instruments and Devices".
function Sound:EffectNames()
    local names = {}
    for _, cat in ipairs(Sound.EFFECTS) do
        names[#names + 1] = cat.label
    end
    if #names < 2 then
        return names[1] or ""
    end
    return string.format(TEXT.listAnd, table.concat(names, ", ", 1, #names - 1), names[#names])
end

-- Each effect as a crt: sound, under its category's heading.
for _, cat in ipairs(Sound.EFFECTS) do
    for i, f in ipairs(cat.files) do
        local entry = { name = f[1], label = f[2] }
        cat.files[i] = entry
        Sound.BUNDLED[#Sound.BUNDLED + 1] = { name = cat.folder .. "-" .. entry.name,
            file = cat.folder .. "\\" .. entry.name .. ".mp3", label = entry.label, group = cat.label }
    end
end
