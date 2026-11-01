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
        key = "xavier", label = "Male01", folder = "Xavier",
        seconds = {
            ["0"] = 0.73, ["1"] = 0.76, ["2"] = 0.71, ["3"] = 0.76, ["4"] = 0.73, ["5"] = 0.81, ["6"] = 0.81,
            ["7"] = 0.81, ["8"] = 0.63, ["9"] = 0.78, ["5seconds321"] = 4.75, Adds = 1.07, Beam = 0.91, Blue = 0.86,
            Bomb = 1.07, Boss = 1.07, Bouncer = 1.15, Break = 0.99, Charge = 1.23, Cleaner = 1.04, Clear = 0.89,
            Collect = 0.99, Debuff = 1.18, Dispel = 1.23, Done = 0.99, DropPool = 1.33, East = 0.91,
            Entertainer = 1.38, Feather = 1.04, Fire = 1.07, Fixate = 1.23, Frost = 0.97, Fung = 0.99, Gate = 0.91,
            Green = 1.07, HealAbsorb = 1.75, Hide = 0.97, Interrupt = 1.15, Left = 0.91, Light = 0.91, Linked = 0.91,
            Macro = 1.12, MindControl = 1.52, Moon = 0.97, Move = 0.97, Next = 1.04, North = 0.94, Obelisk = 1.28,
            Orange = 1.02, Orb = 1.07, Purple = 0.99, Ranged = 1.23, Red = 0.91, Right = 0.89, Root = 0.97,
            ["Run-Out"] = 1.12, Rune = 1.07, Safe = 0.91, Server = 0.97, Shroom = 1.10, Skull = 1.07, Soak = 1.02,
            South = 1.02, Spread = 1.07, Stack = 0.99, Suck = 0.91, Targeted = 1.07, Void = 1.07, West = 0.99,
            Yellow = 1.07,
        },
    },
    {
        key = "lola", label = "Female01", folder = "Lola",
        seconds = {
            ["0"] = 0.57, ["1"] = 0.50, ["2"] = 0.55, ["3"] = 0.73, ["4"] = 0.57, ["5"] = 0.63, ["6"] = 0.57,
            ["7"] = 0.57, ["8"] = 0.52, ["9"] = 0.55, ["5seconds321"] = 4.08, Adds = 0.71, Beam = 0.71, Blue = 0.71,
            Bomb = 0.71, Boss = 0.73, Bouncer = 0.86, Break = 0.73, Charge = 0.89, Cleaner = 0.78, Clear = 0.71,
            Collect = 0.76, Debuff = 0.91, Dispel = 0.86, Done = 0.73, DropPool = 1.10, East = 0.73,
            Entertainer = 1.15, Feather = 0.78, Fire = 0.81, Fixate = 0.97, Frost = 0.81, Fung = 0.78, Gate = 0.73,
            Green = 1.07, HealAbsorb = 1.54, Hide = 0.78, Interrupt = 0.99, Left = 0.73, Light = 0.76, Linked = 0.76,
            Macro = 0.63, MindControl = 1.20, Moon = 0.71, Move = 0.76, Next = 0.71, North = 0.71, Obelisk = 0.94,
            Orange = 0.73, Orb = 0.73, Purple = 0.71, Ranged = 0.94, Red = 0.71, Right = 0.68, Root = 0.71,
            ["Run-Out"] = 1.02, Rune = 0.68, Safe = 0.81, Server = 0.78, Shroom = 0.86, Skull = 0.78, Soak = 0.81,
            South = 0.78, Spread = 0.84, Stack = 0.84, Suck = 0.76, Targeted = 0.89, Void = 0.81, West = 0.73,
            Yellow = 0.68,
        },
    },
}

local TEXT = {
    tts = "Game text to speech",
    lacks = "%s has no %s, so those use text to speech.",
    lacksOne = "%s has no %s, so that uses text to speech.",
    listAnd = "%s and %s",
    listOr = "%s or %s",
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
                label = wordLabel(word), group = voice.label, groupId = voice.key }
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

-- A count from `from` down to 1 in a voice (the one in use by default) as its number clips back to back:
-- { clips = { { ref, seconds }, ... }, seconds = the whole phrase }, or nil when the voice is text to speech or has
-- no clip for one of the numbers (10): then the count is read out.
function Sound:CountPlan(from, key)
    local voice = byKey[self:VoiceKey(key)]
    if not voice or type(from) ~= "number" then
        return nil
    end
    local clips, total = {}, 0
    for n = from, 1, -1 do
        local clip = voice.clips[tostring(n)]
        if not (clip and clip.seconds) then
            return nil
        end
        clips[#clips + 1] = clip
        total = total + clip.seconds
    end
    return { clips = clips, seconds = total }
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

-- For the (?) texts, read from the table each time: the voices' names as shown ("Male01 and Female01"), a line per
-- voice that lacks words ("Female01 has no Void, West or Yellow, ..."; none does now), and that clips take no volume.
function Sound:VoiceNames()
    local names = {}
    for _, voice in ipairs(Sound.VOICES) do
        names[#names + 1] = voice.label
    end
    return listed(names)
end

function Sound:VoiceLacks()
    local lines = {}
    for _, voice in ipairs(Sound.VOICES) do
        local lacks = voice.lacks or {}
        if #lacks > 0 then
            local words = #lacks < 2 and lacks[1]
                or string.format(TEXT.listOr, table.concat(lacks, ", ", 1, #lacks - 1), lacks[#lacks])
            lines[#lines + 1] = string.format(#lacks < 2 and TEXT.lacksOne or TEXT.lacks, voice.label, words)
        end
    end
    return table.concat(lines, "\n\n")
end

Sound.VOICE_NO_VOLUME = TEXT.noVolume
