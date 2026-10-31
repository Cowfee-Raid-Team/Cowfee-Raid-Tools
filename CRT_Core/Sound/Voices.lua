local ADDON, CRT = ...

-- The voice packs shipped with the addon: recorded clips of raid calls and numbers, in
-- CRT_Media/Media/Sounds/<folder>/<word>.mp3. This file is their one list: every clip is a crt: sound
-- (Sound.BUNDLED, crt:<folder>-<word>, such as crt:Xavier-Soak), listed in every sound dropdown under its
-- voice's name, and the speech path (Sound:Speak in Sound/Engine.lua) asks ClipFor which clip says a text.
--
-- The voice that speaks is CRTDB.sound.voice (Quality of Life > Sounds): a voice's key, or "tts" for the
-- game's text to speech only. A text is said with a clip when the whole text is one of the voice's words
-- (Sound.WordKey: case, spaces, hyphens and trailing punctuation don't matter, so "Run out!" is Run-Out); any
-- other text, and a word that voice has no clip for, is read by text to speech. A count says "3", "2", "1",
-- so it uses the number clips, one a second. 5seconds321 is a sound of its own, said only for that text: the
-- count never uses it, because its numbers aren't known to fall on the count's seconds.
--
-- A new voice: its folder of clips named by word, and one VOICES entry, with lacks for any word it has no
-- clip for. A new word: its clip in every voice's folder (or the word in lacks), and one VOICE_WORDS line.
-- run_voices.js checks the list against the files on disk.

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

-- The voices, in the order the lists show them. lacks: words this voice has no clip for.
Sound.VOICES = {
    { key = "xavier", label = "Xavier (male)", folder = "Xavier" },
    { key = "lola", label = "Lola (female)", folder = "Lola", lacks = { "Void", "West", "Yellow" } },
}

local TEXT = {
    tts = "Game text to speech",
    countdown = "5 seconds, 3 2 1",
}

-- A text as a clip's word is matched: lower case, without spaces or hyphens, without punctuation at the
-- end. Nil for anything that isn't a plain string.
function Sound.WordKey(text)
    if type(text) ~= "string" then
        return nil
    end
    local key = text:lower():gsub("[%s%-]", ""):gsub("%p+$", "")
    return key ~= "" and key or nil
end

-- A word as the sound lists show it: DropPool is "Drop pool", Run-Out is "Run out".
local function wordLabel(word)
    if word == "5seconds321" then
        return TEXT.countdown
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
            voice.clips[Sound.WordKey(word)] = "crt:" .. name
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

-- The crt: reference of the clip that says the whole text in a voice (the one in use by default), or nil:
-- the text is read by text to speech. A secret text is never looked at.
function Sound:ClipFor(text, key)
    if issecretvalue and issecretvalue(text) then
        return nil
    end
    local voice = byKey[self:VoiceKey(key)]
    local word = voice and Sound.WordKey(text)
    return word and voice.clips[word] or nil
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
