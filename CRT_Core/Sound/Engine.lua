local ADDON, CRT = ...

-- The sound engine: every sound the addon plays or speaks goes through CRT.Sound.
--
-- A sound is named by a reference string:
--   kit:<NAME or id>   a game sound kit (SOUNDKIT name, such as kit:RAID_WARNING, or its number)
--   lsm:<name>         a sound another addon shares through LibSharedMedia-3.0 (the library isn't shipped)
--   crt:<name>         a sound shipped with the addon (none yet: Sound.BUNDLED)
--   file:<name>        your own .ogg or .mp3 file, in the CowfeeRaidTools_Media companion addon's Sounds
--                      folder (or, from before it, this addon's own CRT_Media\Sounds folder)
--   tts:<text>         text to speech
-- Older saved values (a bare kit name such as RAID_WARNING, "none") are read through Sound.Normalize.
--
-- Play(ref, opts) returns the game's handle (nil when it didn't play), Stop(handle) stops it,
-- Speak(text, opts) reads text out, PlayOrSpeak(ref, text) speaks the text when the sound didn't play,
-- and Choices(opts) is the list every sound dropdown shows: game sounds, the addon's own, shared, yours.
-- Sounds play on the General Settings channel unless opts.channel says otherwise.
--
-- Your own files: the game can't list a folder, so a file is known by name, from the companion addon's
-- manifest (CowfeeRaidTools_Media_Sounds in its Sounds.lua) or typed on Quality of Life > Sounds
-- (CRTDB.sound.custom). Each is also registered in LibSharedMedia as "CRT: <name>" when another addon
-- has loaded it, so other addons can use them too.
--
-- Aura sounds (AddAuraSound) are in Sound/Auras.lua.

local Sound = {}
CRT.Sound = Sound

Sound.MEDIA_ADDON = "CowfeeRaidTools_Media"
Sound.MEDIA_FOLDER = "Interface\\AddOns\\CowfeeRaidTools_Media\\Sounds\\"
-- The addon's own Sounds folder, from before the companion addon, now in CRT_Media.
Sound.LEGACY_FOLDER = "Interface\\AddOns\\" .. ADDON .. "\\CRT_Media\\Sounds\\"
-- the fallback is for test harnesses without Core.lua
Sound.BUNDLED_FOLDER = (CRT.MEDIA or ("Interface\\AddOns\\" .. ADDON .. "\\CRT_Media\\Media\\")) .. "Sounds\\"
Sound.LSM_PREFIX = "CRT: "

-- The game sounds to choose from, by SOUNDKIT name (checked in the game's SoundKitConstants, with the
-- number there as a fallback). A name this client doesn't have, and has no number for, is left out.
Sound.KITS = {
    { name = "RAID_WARNING", label = "Raid warning", id = 8959 },
    { name = "READY_CHECK", label = "Ready check", id = 8960 },
    { name = "RAID_BOSS_EMOTE_WARNING", label = "Boss emote warning", id = 12197 },
    { name = "UI_RAID_BOSS_WHISPER_WARNING", label = "Boss whisper warning", id = 37666 },
    { name = "ALARM_CLOCK_WARNING_3", label = "Alarm clock", id = 12889 },
    { name = "PVP_THROUGH_QUEUE", label = "Queue pop", id = 8459 },
    { name = "TELL_MESSAGE", label = "Whisper", id = 3081 },
    { name = "UI_BNET_TOAST", label = "Toast" },
    { name = "IG_PLAYER_INVITE", label = "Invite" },
    { name = "MAP_PING", label = "Map ping" },
    { name = "IG_QUEST_LIST_OPEN", label = "Quest list" },
    { name = "IG_MAINMENU_OPTION_CHECKBOX_ON", label = "Checkbox" },
}
local kitByName = {}
for _, k in ipairs(Sound.KITS) do
    kitByName[k.name] = k
end

-- Sounds shipped with the addon, as { name, file, label } under BUNDLED_FOLDER. None yet: only audio
-- made for the addon or licensed for it may go here.
Sound.BUNDLED = {}

local function isSecret(value)
    return issecretvalue and issecretvalue(value) or false
end

local function trim(s)
    return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

local function settings()
    return CRT.db and CRT.db.sound
end

local function sharedMedia()
    if not LibStub then
        return nil
    end
    local ok, lib = pcall(LibStub.GetLibrary, LibStub, "LibSharedMedia-3.0", true)
    return ok and lib or nil
end

-- References ------------------------------------------------------------------------------------

local KINDS = { kit = true, lsm = true, crt = true, file = true, tts = true }

-- Any saved sound value as a reference, or nil for no sound. A bare game sound name (how alerts and
-- note lines saved them before) or number becomes kit:.
function Sound.Normalize(value)
    if type(value) == "number" then
        return "kit:" .. value
    end
    if type(value) ~= "string" or isSecret(value) then
        return nil
    end
    value = trim(value)
    if value == "" or value:lower() == "none" then
        return nil
    end
    local kind = value:match("^(%a+):")
    if kind and KINDS[kind:lower()] then
        return kind:lower() .. value:sub(#kind + 1)
    end
    if kitByName[value:upper()] or (SOUNDKIT and SOUNDKIT[value:upper()]) then
        return "kit:" .. value:upper()
    end
    if tonumber(value) then
        return "kit:" .. value
    end
    return nil
end

-- A reference as short as other addons and older versions read it: a game sound by its bare name, as
-- note lines have always written it. Anything else as it is.
function Sound.Compact(ref)
    ref = Sound.Normalize(ref)
    local kit = ref and ref:match("^kit:(.+)$")
    return kit or ref
end

local function kitID(name)
    local n = tonumber(name)
    if n then
        return n
    end
    name = name:upper()
    return (SOUNDKIT and SOUNDKIT[name]) or (kitByName[name] and kitByName[name].id) or nil
end

-- Every custom file name: the companion addon's manifest, then the typed ones, each once.
function Sound:CustomFiles()
    local out, seen = {}, {}
    local function add(name, source)
        if type(name) == "string" and name ~= "" and not seen[name:lower()] then
            seen[name:lower()] = true
            out[#out + 1] = { name = name, source = source }
        end
    end
    local manifest = _G.CowfeeRaidTools_Media_Sounds
    if type(manifest) == "table" then
        for _, name in ipairs(manifest) do
            add(name, "manifest")
        end
    end
    local s = settings()
    for _, name in ipairs(s and s.custom or {}) do
        add(name, "typed")
    end
    return out
end

-- What a reference plays: { kind = "kit", id }, { kind = "file", paths = { tried in order } } or
-- { kind = "tts", text }, or nil when it names nothing playable here.
function Sound:Resolve(ref)
    ref = Sound.Normalize(ref)
    if not ref then
        return nil
    end
    local kind, rest = ref:match("^(%a+):(.*)$")
    if kind == "kit" then
        local id = kitID(rest)
        return id and { kind = "kit", id = id } or nil
    elseif kind == "lsm" then
        local lib = sharedMedia()
        if lib then
            local ok, path = pcall(lib.Fetch, lib, "sound", rest, true)
            if ok and path then
                return { kind = "file", paths = { path } }
            end
        end
        return nil
    elseif kind == "crt" then
        for _, b in ipairs(Sound.BUNDLED) do
            if b.name == rest then
                return { kind = "file", paths = { Sound.BUNDLED_FOLDER .. b.file } }
            end
        end
        return nil
    elseif kind == "file" then
        if rest == "" or rest:find("[/\\]") then
            return nil
        end
        return { kind = "file", paths = { Sound.MEDIA_FOLDER .. rest, Sound.LEGACY_FOLDER .. rest } }
    elseif kind == "tts" then
        return { kind = "tts", text = rest }
    end
    return nil
end

-- Playing -------------------------------------------------------------------------------------

function Sound:Channel(opts)
    return (opts and opts.channel) or (CRT.db and CRT.db.ui and CRT.db.ui.soundChannel) or "Master"
end

-- Plays a reference. opts: channel, volume (0 to 1, game sounds only). Returns the handle, or nil when
-- the game didn't play it (a missing file, a muted channel), and what was tried.
function Sound:Play(ref, opts)
    local source = self:Resolve(ref)
    if not source then
        return nil, "nothing to play for " .. tostring(ref)
    end
    local channel = self:Channel(opts)
    if source.kind == "kit" then
        if opts and opts.volume and C_Sound and C_Sound.PlaySoundWithOptions then
            local ok, played, handle = pcall(C_Sound.PlaySoundWithOptions,
                { soundKitID = source.id, uiSoundSubType = channel, volumeOverride = opts.volume })
            if ok and played and handle then
                return handle, "game sound " .. source.id
            end
        end
        local ok, played, handle = pcall(PlaySound, source.id, channel)
        if ok and played then
            return handle or true, "game sound " .. source.id
        end
        return nil, "game sound " .. source.id .. " didn't play on " .. channel
    elseif source.kind == "file" then
        for _, path in ipairs(source.paths) do
            local ok, played, handle = pcall(PlaySoundFile, path, channel)
            if ok and played then
                return handle or true, path
            end
        end
        return nil, "not found: " .. table.concat(source.paths, " or ")
    elseif source.kind == "tts" then
        local spoke = self:Speak(source.text, opts)
        return spoke and "tts" or nil, "text to speech"
    end
    return nil, "unknown"
end

function Sound:Stop(handle)
    if type(handle) == "number" then
        pcall(StopSound, handle)
    elseif handle == "tts" then
        self:StopSpeaking()
    end
end

-- Speaking ------------------------------------------------------------------------------------

local voiceCache -- the voice ID to use, or false when there is none

local function validVoice(id)
    if not (C_VoiceChat and C_VoiceChat.GetTtsVoices) then
        return id
    end
    local ok, voices = pcall(C_VoiceChat.GetTtsVoices)
    if not ok or type(voices) ~= "table" then
        return id
    end
    for _, v in ipairs(voices) do
        if v.voiceID == id then
            return id
        end
    end
    return voices[1] and voices[1].voiceID or nil
end

-- The voice: the game's chosen standard voice, checked against the installed voices once.
function Sound:Voice()
    if voiceCache == nil then
        local id
        if C_TTSSettings and C_TTSSettings.GetVoiceOptionID then
            local voiceType = (Enum and Enum.TtsVoiceType and Enum.TtsVoiceType.Standard) or 0
            local ok, v = pcall(C_TTSSettings.GetVoiceOptionID, voiceType)
            if ok and type(v) == "number" then
                id = v
            end
        end
        voiceCache = validVoice(id or 0) or false
    end
    return voiceCache or nil
end

-- Reads text out. opts: rate (-10 to 10), volume (0 to 100). A secret text is passed on as it is: the
-- game's speech takes it. Returns true when the game took it, false and why when not.
function Sound:Speak(text, opts)
    if not (C_VoiceChat and C_VoiceChat.SpeakText) then
        return false, "Text to speech isn't available on this client."
    end
    if not isSecret(text) and (type(text) ~= "string" or text == "") then
        return false, "Nothing to say."
    end
    local voice = self:Voice()
    if not voice then
        return false, "No text to speech voice is installed. Check the game's Text to Speech settings."
    end
    local rate = opts and opts.rate
    if rate == nil and C_TTSSettings and C_TTSSettings.GetSpeechRate then
        local ok, r = pcall(C_TTSSettings.GetSpeechRate)
        rate = ok and r or 0
    end
    local volume = opts and opts.volume or 100
    local ok, err = pcall(C_VoiceChat.SpeakText, voice, text, rate or 0, volume, false)
    if not ok then
        voiceCache = nil -- the voice may have gone; look again next time
        return false, "Text to speech failed: " .. tostring(err)
    end
    return true
end

function Sound:StopSpeaking()
    if C_VoiceChat and C_VoiceChat.StopSpeakingText then
        pcall(C_VoiceChat.StopSpeakingText)
    end
end

-- Plays ref, and if it didn't play (no ref, a missing file), speaks text instead. A secret text goes
-- straight to speech. Returns the handle, or "tts".
function Sound:PlayOrSpeak(ref, text, opts)
    if isSecret(text) then
        return self:Speak(text, opts) and "tts" or nil
    end
    local handle = ref and self:Play(ref, opts) or nil
    if handle then
        return handle
    end
    if type(text) == "string" and text ~= "" then
        return self:Speak(text, opts) and "tts" or nil
    end
    return nil
end

-- Choices -------------------------------------------------------------------------------------

-- The list a sound dropdown shows, as { key = reference, label }: opts.none (a label) adds a "no sound"
-- choice first with key "none"; then game sounds, the addon's own, shared ones and your files.
-- opts.filesOnly leaves out game sounds (for aura sounds, which play files). Read each time a menu opens.
function Sound:Choices(opts)
    local out = {}
    if opts and opts.none then
        out[#out + 1] = { key = "none", label = opts.none }
    end
    if not (opts and opts.filesOnly) then
        for _, k in ipairs(Sound.KITS) do
            if kitID(k.name) then
                out[#out + 1] = { key = "kit:" .. k.name, label = k.label }
            end
        end
    end
    for _, b in ipairs(Sound.BUNDLED) do
        out[#out + 1] = { key = "crt:" .. b.name, label = b.label or b.name }
    end
    local lib = sharedMedia()
    if lib then
        local ok, list = pcall(lib.List, lib, "sound")
        if ok and type(list) == "table" then
            for _, name in ipairs(list) do
                -- the addon's own files are listed as yours below, not again as shared
                if name ~= "None" and name:sub(1, #Sound.LSM_PREFIX) ~= Sound.LSM_PREFIX then
                    out[#out + 1] = { key = "lsm:" .. name, label = name .. " (shared)" }
                end
            end
        end
    end
    for _, f in ipairs(self:CustomFiles()) do
        out[#out + 1] = { key = "file:" .. f.name, label = f.name .. " (yours)" }
    end
    return out
end

-- The label a reference shows with, for chat and lists.
function Sound:Label(ref)
    ref = Sound.Normalize(ref)
    if not ref then
        return "none"
    end
    for _, c in ipairs(self:Choices()) do
        if c.key == ref then
            return c.label
        end
    end
    return ref
end

-- Your files ----------------------------------------------------------------------------------

-- Adds a file by name. Returns ok, message.
function Sound:AddCustom(name)
    name = trim(name or "")
    if name == "" then
        return false, "Type the file's name, such as airhorn.ogg."
    end
    if name:find("[/\\]") then
        return false, "Just the file name, without a folder."
    end
    if not (name:lower():find("%.ogg$") or name:lower():find("%.mp3$")) then
        return false, "The game plays .ogg and .mp3 files."
    end
    for _, f in ipairs(self:CustomFiles()) do
        if f.name:lower() == name:lower() then
            return false, name .. " is already in the list."
        end
    end
    local list = settings().custom
    list[#list + 1] = name
    self:RegisterShared()
    return true, "Added " .. name .. "."
end

-- Removes a typed name. A name from the companion addon's manifest is removed by editing Sounds.lua.
function Sound:RemoveCustom(name)
    local list = settings().custom
    for i, existing in ipairs(list) do
        if existing == name then
            table.remove(list, i)
            return true
        end
    end
    return false
end

-- Plays a file once to see whether the game finds it. Returns played (true or false) and a message.
function Sound:TestFile(name)
    local handle, info = self:Play("file:" .. name)
    if handle then
        return true, name .. ": played (" .. tostring(info) .. ")."
    end
    return false, name .. ": not found. Put it in Interface\\AddOns\\" .. Sound.MEDIA_ADDON .. "\\Sounds, then restart the game if a /reload doesn't find it."
end

-- Registers your files (and the addon's own sounds) in LibSharedMedia, when another addon loaded it.
function Sound:RegisterShared()
    local lib = sharedMedia()
    if not lib then
        return
    end
    for _, f in ipairs(self:CustomFiles()) do
        pcall(lib.Register, lib, "sound", Sound.LSM_PREFIX .. f.name, Sound.MEDIA_FOLDER .. f.name)
    end
    for _, b in ipairs(Sound.BUNDLED) do
        pcall(lib.Register, lib, "sound", Sound.LSM_PREFIX .. b.name, Sound.BUNDLED_FOLDER .. b.file)
    end
end

-- Saved values from before the engine, moved once: the low-health page's own file list.
local function migrate()
    local s = settings()
    local old = CRT.db.qol and CRT.db.qol.lowHealth
    if old and type(old.customSounds) == "table" and #old.customSounds > 0 then
        for _, name in ipairs(old.customSounds) do
            local known = false
            for _, existing in ipairs(s.custom) do
                if existing:lower() == name:lower() then
                    known = true
                end
            end
            if not known then
                s.custom[#s.custom + 1] = name
            end
        end
        old.customSounds = {}
    end
    if old and old.soundChoice and old.soundChoice ~= "pulse" then
        old.soundChoice = Sound.Normalize(old.soundChoice) or "pulse"
    end
end

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_LOGIN")
events:SetScript("OnEvent", function()
    migrate()
    Sound:RegisterShared()
end)
