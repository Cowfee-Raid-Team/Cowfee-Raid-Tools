local ADDON, CRT = ...

-- Assignment highlights: on by default, switched on Raid Notes > Notes Settings > Highlights (Highlights/Settings.lua) or
-- General Settings > Modules. In the note windows ticked there (the assignments window by default; the timers and
-- personal note windows once ticked: Notes/Window.lua) a line that names you or your raid group gets a band behind it
-- in the theme's accent, and the name or group word in the accent colour. When a new version of the same note changes
-- your part, the line glows for a few seconds with a tag saying what changed: Added, Removed or Moved
-- (Highlights/Changes.lua).
-- This file reads who you are and which words name you:
--   H:Spans(line)          the word starts in a line of free text to paint, or nil when the line is not about you
--   H:TagSpans(tags)       the same for a timer's tags (by index)
--   H.Paint(word)          a word in the accent colour
--   H.TimerKey, H.TimerId, H.LineId, H.IdCounter, H.NoteKey   what a line says, and which line it is across versions
-- Only plain string work on the note's text: your name is read once, out of a fight, and your group from the raid
-- roster; a value the game hides is never compared, and then nothing matches. Settings: CRTDB.highlights (Core.lua).

local H = {}
CRT.NoteHighlights = H

local GROUP_SECONDS = 5        -- how long your raid group is kept, past a roster change

local MAX_GROUP = 8
local WORD = "()([%w\128-\255]+)()"

local function readable(v)
    return not (issecretvalue and issecretvalue(v))
end

function H.Settings()
    return CRT.db.highlights
end

-- The module's switch, and whether any line can be marked at all.
function H:Enabled()
    return CRT.db ~= nil and CRT.db.highlights ~= nil and CRT.db.highlights.enabled == true
end

-- The one switch, for Raid Notes > Notes Settings > Highlights and General Settings > Modules alike: both read
-- highlights.enabled when they show, so they stay in step.
function H:SetEnabled(on)
    CRT.db.highlights.enabled = on and true or false
    self:Changed()
end

function H:Active()
    local s = self:Enabled() and H.Settings()
    return s and (s.name or s.group) and true or false
end

function H:GlowOn()
    return self:Active() and H.Settings().glow and true or false
end

-- Whether one note window shows highlights: "assignments", "timers" or "personal" (highlights.windows), while the
-- module is on. "preview": the module's own preview, which shows its bands whatever the window ticks are.
function H:WindowOn(key)
    if not self:Active() then
        return false
    end
    if key == "preview" then
        return true
    end
    local windows = H.Settings().windows
    return type(windows) == "table" and windows[key] == true
end

-- Your name in lower case, without its realm: read once it can be (out of a fight it always can), then kept.
local myName
function H:MyName()
    if myName then
        return myName
    end
    local ok, name = pcall(UnitName, "player")
    if ok and readable(name) and type(name) == "string" and name ~= "" then
        myName = name:lower():gsub("%-.*$", "")
    end
    return myName
end

-- Your raid group, 1 to 8, from the raid roster; nil outside a raid. Your raid index comes from UnitInRaid (the
-- roster's slots can have gaps), else from a walk of the raid units. A read that fails in a raid (a hidden value
-- mid-fight) keeps the last group known; with none known, no group matches.
local groupCache, groupAt
local function rosterGroup(index)
    local _, _, subgroup = GetRaidRosterInfo(index)
    if readable(subgroup) and type(subgroup) == "number" and subgroup >= 1 and subgroup <= MAX_GROUP then
        return subgroup
    end
    return nil
end

-- Returns inRaid, group (nil when it can't be read).
local function readGroup()
    if not (IsInRaid and IsInRaid()) then
        return false, nil
    end
    local index = UnitInRaid and UnitInRaid("player")
    if readable(index) and type(index) == "number" and index >= 1 then
        return true, rosterGroup(index)
    end
    for i = 1, GetNumGroupMembers() do
        if UnitIsUnit("raid" .. i, "player") then
            return true, rosterGroup(i)
        end
    end
    return true, nil
end

function H:MyGroup()
    if not (groupAt and GetTime() - groupAt < GROUP_SECONDS) then
        local ok, inRaid, g = pcall(readGroup)
        if ok and not inRaid then
            groupCache = nil
        elseif ok and g then
            groupCache = g
        end -- a failed read in a raid keeps the last group
        groupAt = GetTime()
    end
    return groupCache
end

-- The group the preview's sample note names and matches: yours, or group 1 out of a raid. Only the sample uses it.
function H:SampleGroup()
    return self:MyGroup() or 1
end

function H:ResetGroup()
    groupAt = nil
end

-- The group number a word (and the word after it) names: "G3", "Grp3" or "Group3", or "G", "Grp" or "Group" then
-- "3" (Parse.lua's GROUP_WORDS, as the timers' tags read them). Returns the number and how many words it used.
local function groupOf(word, nextWord)
    local words = CRT.NoteParser and CRT.NoteParser.GROUP_WORDS
    if not words then
        return nil
    end
    local lower = word:lower()
    local prefix, number = lower:match("^(%a+)(%d)$")
    if prefix and words[prefix] then
        return tonumber(number), 1
    end
    if words[lower] and nextWord and nextWord:match("^%d$") then
        return tonumber(nextWord), 2
    end
    return nil
end
H.GroupOf = groupOf

local function inBraces(line, start, stop)
    local codes = CRT.MarkerCodes
    return codes and codes.InBraces and codes.InBraces(line, start, stop) or false
end

-- The words of a line of free text to paint: { [start] = true } for each word that is your name or a word of your
-- group ("Group 3" paints both), by the word's start in the line, as Window.lua's textLine reads words. Nil when
-- nothing in the line is about you, or the module is off. sampleGroup: the preview's sample (SampleGroup) in place
-- of your group.
function H:Spans(line, sampleGroup)
    if not self:Active() or type(line) ~= "string" or line == "" then
        return nil
    end
    local s = H.Settings()
    local name = s.name and self:MyName() or nil
    local group = s.group and (sampleGroup or self:MyGroup()) or nil
    if not name and not group then
        return nil
    end
    local words = {}
    for start, word, stop in line:gmatch(WORD) do
        if not inBraces(line, start, stop) then
            words[#words + 1] = { start = start, word = word, stop = stop }
        end
    end
    local spans
    local i = 1
    while i <= #words do
        local w = words[i]
        local nextW = words[i + 1]
        -- "Group 3": the number is the next word only when just spaces stand between them
        local nextWord = nextW and line:sub(w.stop, nextW.start - 1):match("^%s+$") and nextW.word or nil
        local used = 1
        if name and w.word:lower() == name then
            spans = spans or {}
            spans[w.start] = true
        elseif group then
            local number, n = groupOf(w.word, nextWord)
            if number then
                used = n
                if number == group then
                    spans = spans or {}
                    spans[w.start] = true
                    if n == 2 then
                        spans[nextW.start] = true
                    end
                end
            end
        end
        i = i + used
    end
    return spans
end

-- The same for a timer's tags: { [index] = true } for each tag to paint. A tag may carry a realm.
function H:TagSpans(tags)
    if not self:Active() or type(tags) ~= "table" or #tags == 0 then
        return nil
    end
    local s = H.Settings()
    local name = s.name and self:MyName() or nil
    local group = s.group and self:MyGroup() or nil
    if not name and not group then
        return nil
    end
    local spans
    local i = 1
    while i <= #tags do
        local tag = tostring(tags[i])
        local used = 1
        if name and tag:lower():gsub("%-.*$", "") == name then
            spans = spans or {}
            spans[i] = true
        elseif group then
            local number, n = groupOf(tag, tags[i + 1] and tostring(tags[i + 1]) or nil)
            if number then
                used = n
                if number == group then
                    spans = spans or {}
                    for k = i, i + n - 1 do
                        spans[k] = true
                    end
                end
            end
        end
        i = i + used
    end
    return spans
end

-- A timer's content for the glow: what it says, when and for whom, never how it is drawn.
function H.TimerKey(item)
    return table.concat({ tostring(item.ph or 1), tostring(item.time or 0), tostring(item.spellId or item.text or ""),
        table.concat(item.tags or {}, " ") }, ":")
end

-- A line's identity across two versions of a note, so a change can say what happened to you: a timer by its phase,
-- time and spell or text (its names left out); an assignment line by its label, the words before its colon, in lower
-- case ("Soak 1"); any other line by its words without the names in it (yours and every name in the class cache, the
-- names the windows colour) and its group words, so other names changing in it never make it another line. A name
-- the addon has never seen stays in, so changing one can still read as Moved: a known limit. Two lines of the same
-- identity are told apart by IdCounter.
function H.TimerId(item)
    return table.concat({ tostring(item.ph or 1), tostring(item.time or 0), tostring(item.spellId or item.text or "") }, ":")
end

-- Short names the addon knows, lower case: the class cache (CRT.db.classCache), made again only when it changes.
local known, knownFrom, knownVersion = {}, nil, nil
local function knownNames()
    local cache = CRT.db and CRT.db.classCache or {}
    local G = CRT.Groups
    local version = G and G.classVersion or 0
    if cache ~= knownFrom or version ~= knownVersion then
        known, knownFrom, knownVersion = {}, cache, version
        for key in pairs(cache) do
            local short = tostring(key):match("^[^-]+")
            if short then
                known[short:lower()] = true
            end
        end
    end
    return known
end

function H.LineId(line)
    local label = line:match("^%s*([^:]-)%s*:")
    if label and label ~= "" then
        return "label:" .. label:lower()
    end
    local words = {}
    for word in line:gmatch("[%w\128-\255]+") do
        words[#words + 1] = word
    end
    local names, me = knownNames(), H:MyName()
    local kept, i = {}, 1
    while i <= #words do
        local lower = words[i]:lower()
        local _, used = groupOf(words[i], words[i + 1])
        if used then
            i = i + used
        else
            if lower ~= me and not names[lower] then
                kept[#kept + 1] = lower
            end
            i = i + 1
        end
    end
    return "text:" .. table.concat(kept, " ")
end

-- Numbers repeats of an identity in note order: "label:soak 1#1", "label:soak 1#2".
function H.IdCounter()
    local seen = {}
    return function(base)
        local n = (seen[base] or 0) + 1
        seen[base] = n
        return base .. "#" .. n
    end
end

function H.Paint(word)
    return CRT.UI.ColorText(word, "accent")
end

-- Which note a window shows, for the glow: the boss and difficulty, so a note shared again for the same boss counts
-- as the same note even when it arrives as a new record; else the record itself.
function H.NoteKey(record)
    if type(record) ~= "table" then
        return nil
    end
    if record.encounterID then
        return "boss:" .. tostring(record.encounterID) .. ":" .. tostring(record.difficulty or "")
    end
    return record
end

-- The preview ---------------------------------------------------------------------------------------------------
-- "Preview highlights" (Settings.lua) shows the assignments window with a sample note that names you and your group
-- (group 1 out of a raid), its lines marked, and one of each change: a line you were added to, a line you moved to,
-- and a ghost of a line you were taken off (Changes.lua's preview).

local SAMPLE = {
    "Sample assignments",
    "Soak 1: %s Gadios",
    "Soak 2: Djaztech Teronhorefnd",
    "",
    "Kick order",
    "Kicks G%d: Rixxy Cheoeqar",
    "Group %d: stack left",
}
-- Which sample line shows which change, and the line the ghost stood under.
local SAMPLE_KINDS = { [2] = "added", [6] = "moved" }
local SAMPLE_GHOST = { text = "Soak 3: %s Rixxy", after = 3 }

local function fill(line, name, group)
    if line:find("%s", 1, true) then
        return string.format(line, name)
    elseif line:find("%d", 1, true) then
        return string.format(line, group)
    end
    return line
end

-- The sample's lines; also H.sample = { kinds = { [line id] = change }, ghost = { text, after = line id } }.
function H.SampleLines()
    local name = UnitName and UnitName("player")
    if not (readable(name) and type(name) == "string" and name ~= "") then
        name = "You"
    end
    local group = H:SampleGroup()
    local out, ids, nextId = {}, {}, H.IdCounter()
    for i, line in ipairs(SAMPLE) do
        out[i] = fill(line, name, group)
        ids[i] = out[i] ~= "" and nextId(H.LineId(out[i])) or nil
    end
    local kinds = {}
    for i, kind in pairs(SAMPLE_KINDS) do
        kinds[ids[i]] = kind
    end
    H.sample = { kinds = kinds, ghost = { text = fill(SAMPLE_GHOST.text, name, group), after = ids[SAMPLE_GHOST.after] } }
    return out
end

H.PREVIEW_KEY = "note-highlights"
CRT.UI:RegisterPreview(H.PREVIEW_KEY, function(on)
    H.previewing = on and true or nil
    if CRT.NoteWindow and CRT.NoteWindow.PreviewHighlights then
        CRT.NoteWindow:PreviewHighlights(on)
    end
end)

-- Redraws the note windows after a setting changed.
function H:Changed()
    if CRT.NoteWindow and CRT.NoteWindow.Changed then
        CRT.NoteWindow:Changed()
    end
end

-- Your group changes with the roster: read it again then, not GROUP_SECONDS later.
local events = CreateFrame("Frame")
events:RegisterEvent("GROUP_ROSTER_UPDATE")
events:SetScript("OnEvent", function()
    H:ResetGroup()
end)
