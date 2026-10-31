local ADDON, CRT = ...

-- The voice packs shipped with the addon: recorded clips of raid calls and numbers, in
-- CRT_Media/Media/Sounds/<folder>/<word>.mp3. This file is their one list: every clip is a crt: sound
-- (Sound.BUNDLED, crt:<folder>-<word>, such as crt:Xavier-Soak), listed in every sound dropdown under its
-- voice's name, and the speech path (Sound:Speak in Sound/Engine.lua) asks ClipFor which clip says a text and
-- how long it is.
--
-- The voice that speaks is CRTDB.sound.voice (Quality of Life > Sounds): a voice's key, or "tts" for the
-- game's text to speech only. A text is said with a clip when the whole text is one of the voice's words
-- (Sound.WordKey: case, spaces and punctuation don't matter, so "Run out!" is Run-Out); any other text, and a
-- word that voice has no clip for, is read by text to speech. A count says its numbers one a second, so it
-- uses the number clips (a number with no clip, such as 10, is read out). 5seconds321 is a sound of its own,
-- said only for that text: a count never uses it, because its numbers aren't known to fall on the seconds.
-- A clip plays on the sound channel at that channel's volume: the game takes no volume for a file.
--
-- A new voice: its folder of clips named by word, and one VOICES entry, with lacks for any word it has no
-- clip for and seconds, each clip's length. A new word: its clip in every voice's folder (or the word in
-- lacks), one VOICE_WORDS line and its seconds. run_voices.js checks the list and every length against the
-- mp3 files on disk.

local Sound = CRT.Sound

Sound.DEFAULT_VOICE = "xavier"
Sound.TTS_VOICE = "tts"

-- Every word with a clip, as the file is named.
Sound.VOICE_WORDS = {
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "5seconds321",
    "Adds", "Beam", "Blue", "Bomb", "Boss", "Bouncer", "Break", "Charge", "Cleaner", "Clear", "Collect",
    "Debuff", "Dispel", "Done", "DropPool", "East", "Entertainer", "Feather", "Fire", "Fixate", "Frost",
    "Fung", "Gate", "Green", "HealAbsorb", "Hide", "Interrupt", "Left", "Light", "Linked", "Macro",
    "MindControl", "Moon", "Move", "Next", "North", "Obelisk", "Orange", "Orb", "Purple", "Ranged", "Red",
    "Right", "Root", "Run-Out", "Rune", "Safe", "Server", "Shroom", "Skull", "Soak", "South", "Spread",
    "Stack", "Suck", "Targeted", "Void", "West", "Yellow",
}

-- A word's label in the sound lists when splitting its name isn't enough (DropPool reads "Drop pool" by itself).
Sound.VOICE_LABELS = {
    ["5seconds321"] = "5 seconds, 3 2 1",
}

-- The voices, in the order the lists show them. lacks: words this voice has no clip for. seconds: each clip's
-- length, from its mp3 frames (run_voices.js reads them again from the files).
Sound.VOICES = {
    {
        key = "xavier", label = "Xavier (male)", folder = "Xavier",
        seconds = {
            ["0"] = 1.10, ["1"] = 1.02, ["2"] = 1.02, ["3"] = 1.10, ["4"] = 1.10, ["5"] = 1.10, ["6"] = 1.10,
            ["7"] = 1.10, ["8"] = 0.94, ["9"] = 1.10, ["5seconds321"] = 4.78, Adds = 1.10, Beam = 1.10, Blue = 1.10,
            Bomb = 1.10, Boss = 1.10, Bouncer = 1.18, Break = 1.02, Charge = 1.25, Cleaner = 1.18, Clear = 1.10,
            Collect = 1.10, Debuff = 1.33, Dispel = 1.25, Done = 1.02, DropPool = 1.52, East = 1.02,
            Entertainer = 1.59, Feather = 1.10, Fire = 1.10, Fixate = 1.25, Frost = 1.25, Fung = 1.18, Gate = 1.02,
            Green = 1.10, HealAbsorb = 1.99, Hide = 1.10, Interrupt = 1.18, Left = 1.10, Light = 1.10, Linked = 1.10,
            Macro = 1.18, MindControl = 1.75, Moon = 1.10, Move = 1.10, Next = 1.10, North = 1.10, Obelisk = 1.33,
            Orange = 1.10, Orb = 1.10, Purple = 1.02, Ranged = 1.25, Red = 1.10, Right = 1.02, Root = 1.10,
            ["Run-Out"] = 1.33, Rune = 1.18, Safe = 1.10, Server = 1.10, Shroom = 1.33, Skull = 1.25, Soak = 1.18,
            South = 1.10, Spread = 1.18, Stack = 1.10, Suck = 1.18, Targeted = 1.10, Void = 1.10, West = 1.10,
            Yellow = 1.10,
        },
    },
    {
        key = "lola", label = "Lola (female)", folder = "Lola", lacks = { "Void", "West", "Yellow" },
        seconds = {
            ["0"] = 0.94, ["1"] = 0.94, ["2"] = 0.71, ["3"] = 1.02, ["4"] = 1.02, ["5"] = 0.94, ["6"] = 0.86,
            ["7"] = 0.94, ["8"] = 0.78, ["9"] = 0.86, ["5seconds321"] = 4.23, Adds = 1.02, Beam = 1.02, Blue = 1.02,
            Bomb = 0.86, Boss = 0.86, Bouncer = 1.02, Break = 0.86, Charge = 0.94, Cleaner = 0.94, Clear = 0.86,
            Collect = 1.02, Debuff = 1.02, Dispel = 1.02, Done = 1.02, DropPool = 1.25, East = 1.02,
            Entertainer = 1.33, Feather = 0.94, Fire = 1.10, Fixate = 1.10, Frost = 1.02, Fung = 0.94, Gate = 0.86,
            Green = 1.10, HealAbsorb = 1.75, Hide = 0.94, Interrupt = 1.10, Left = 1.10, Light = 0.94, Linked = 0.94,
            Macro = 0.86, MindControl = 1.33, Moon = 0.86, Move = 0.94, Next = 0.86, North = 0.86, Obelisk = 1.10,
            Orange = 0.94, Orb = 0.94, Purple = 0.94, Ranged = 1.02, Red = 0.86, Right = 0.86, Root = 1.02,
            ["Run-Out"] = 1.59, Rune = 1.02, Safe = 0.94, Server = 0.94, Shroom = 1.02, Skull = 1.02, Soak = 1.02,
            South = 0.94, Spread = 1.10, Stack = 0.94, Suck = 0.94, Targeted = 1.02,
        },
    },
}

local TEXT = {
    tts = "Game text to speech",
    lacks = "%s has no %s, so those use text to speech.",
    lacksOne = "%s has no %s, so that uses text to speech.",
    listAnd = "%s and %s",
    noVolume = "Clips play on your sound channel (General Settings) at that channel's volume: the game takes no volume for them.",
}

-- A text as a clip's word is matched: lower case, without spaces or punctuation. Nil for anything that isn't
-- a plain string.
function Sound.WordKey(text)
    if type(text) ~= "string" then
        return nil
    end
    local key = text:lower():gsub("[%s%p]", "")
    return key ~= "" and key or nil
end

-- A word as the sound lists show it: DropPool is "Drop pool", Run-Out is "Run out".
local function wordLabel(word)
    if Sound.VOICE_LABELS[word] then
        return Sound.VOICE_LABELS[word]
    end
    local spaced = word:gsub("%-", " "):gsub("(%l)(%u)", "%1 %2")
    return spaced:sub(1, 1) .. spaced:sub(2):lower()
end

local byKey = {}
for _, voice in ipairs(Sound.VOICES) do
    byKey[voice.key] = voice
    local lacks = {}
    for _, w in ipairs(voice.lacks or {}) do
        lacks[w] = true
    end
    voice.words, voice.clips = {}, {}
    for _, word in ipairs(Sound.VOICE_WORDS) do
        if not lacks[word] then
            local name = voice.folder .. "-" .. word
            voice.words[#voice.words + 1] = word
            voice.clips[Sound.WordKey(word)] = { ref = "crt:" .. name, seconds = voice.seconds[word] }
            Sound.BUNDLED[#Sound.BUNDLED + 1] = { name = name, file = voice.folder .. "\\" .. word .. ".mp3",
                label = wordLabel(word), group = voice.folder }
        end
    end
end

local function saved()
    local s = CRT.db and CRT.db.sound
    return s and s.voice
end

-- The voice in use: the saved one, or Xavier for none or one this version doesn't have. "tts" stays "tts".
function Sound:VoiceKey(key)
    key = key or saved()
    if key == Sound.TTS_VOICE or byKey[key] then
        return key
    end
    return Sound.DEFAULT_VOICE
end

-- The crt: reference of the clip that says the whole text in a voice (the one in use by default) and its
-- length in seconds, or nil: the text is read by text to speech. A secret text is never looked at.
function Sound:ClipFor(text, key)
    if issecretvalue and issecretvalue(text) then
        return nil
    end
    local voice = byKey[self:VoiceKey(key)]
    local word = voice and Sound.WordKey(text)
    local clip = word and voice.clips[word]
    if not clip then
        return nil
    end
    return clip.ref, clip.seconds
end

-- The Voice dropdown's choices: each voice, then the game's text to speech.
function Sound:VoiceChoices()
    local out = {}
    for _, voice in ipairs(Sound.VOICES) do
        out[#out + 1] = { key = voice.key, label = voice.label }
    end
    out[#out + 1] = { key = Sound.TTS_VOICE, label = TEXT.tts }
    return out
end

local function listed(items)
    if #items < 2 then
        return items[1] or ""
    end
    return string.format(TEXT.listAnd, table.concat(items, ", ", 1, #items - 1), items[#items])
end

-- For the (?) texts, read from the table each time: the voices' names ("Xavier and Lola"), a line per voice
-- that lacks words ("Lola has no Void, West or Yellow, ..."), and that clips take no volume.
function Sound:VoiceNames()
    local names = {}
    for _, voice in ipairs(Sound.VOICES) do
        names[#names + 1] = voice.folder
    end
    return listed(names)
end

function Sound:VoiceLacks()
    local lines = {}
    for _, voice in ipairs(Sound.VOICES) do
        local lacks = voice.lacks or {}
        if #lacks > 0 then
            local words = #lacks < 2 and lacks[1]
                or (table.concat(lacks, ", ", 1, #lacks - 1) .. " or " .. lacks[#lacks])
            lines[#lines + 1] = string.format(#lacks < 2 and TEXT.lacksOne or TEXT.lacks, voice.folder, words)
        end
    end
    return table.concat(lines, "\n\n")
end

Sound.VOICE_NO_VOLUME = TEXT.noVolume
