local ADDON, CRT = ...

-- Raid marker codes in text: {rt1} to {rt8} and the names the game's chat takes ({star}, {skull}, {X} and the
-- rest, any case), one list for every part of the addon that reads them.
--   CRT.MarkerText(text, size)          the text with each marker code drawn as its icon, unknown codes as written
--   CRT.MarkerCodes.Number(code)        a code without braces ("cross", "RT7") to its marker number, or nil
--   CRT.MarkerCodes.Icon(n, size)       marker n's icon as text, "" for no marker
--   CRT.MarkerCodes.InBraces(s, a, b)   whether s:sub(a, b - 1) is a marker code with braces round it, so a
--                                       line's name colouring leaves the code alone
-- The icons are the addon's own |T escape, not the game's chat replacement: size 0 (the default) draws an icon as
-- tall as the line's font (warcraft.wiki.gg, UI escape sequences), so it follows each display's text, and nothing
-- depends on chat rules. Only text shown on screen goes through it: raw note text, edit boxes, chat posts, the
-- note sent to another addon and speech keep the codes as written.

local Codes = {}
CRT.MarkerCodes = Codes

-- The game's raid target icons (ICON_LIST in Blizzard's ChatFrameConstants.lua).
local ICON = "|TInterface\\TargetingFrame\\UI-RaidTargetingIcon_%d:%d|t"
-- The marker names in English, by marker number (warcraft.wiki.gg, Raid target icons). Always read, so a note
-- written on an English client shows its icons on any client; the game's own list (ICON_TAG_LIST) adds the
-- client's names.
local ICON_NAMES = { star = 1, circle = 2, diamond = 3, triangle = 4, moon = 5, square = 6, cross = 7, x = 7, skull = 8 }

local function secret(v)
    return issecretvalue and issecretvalue(v) or false
end

-- Every code, lower case without braces, to its marker number; made again only when the game's list changes.
local tags, tagsFrom
local function allTags()
    local game = type(ICON_TAG_LIST) == "table" and ICON_TAG_LIST or false
    if tags and tagsFrom == game then
        return tags
    end
    local out = {}
    for i = 1, 8 do
        out["rt" .. i] = i
    end
    for name, i in pairs(ICON_NAMES) do
        out[name] = i
    end
    for tag, i in pairs(game or {}) do
        if type(tag) == "string" and type(i) == "number" and i >= 1 and i <= 8 then
            out[(tag:lower():gsub("[{}]", ""))] = i
        end
    end
    tags, tagsFrom = out, game
    return out
end

function Codes.Number(code)
    if type(code) ~= "string" then
        return nil
    end
    return allTags()[code:lower()]
end

function Codes.Icon(n, size)
    if type(n) ~= "number" or n ~= math.floor(n) or n < 1 or n > 8 then
        return ""
    end
    return string.format(ICON, n, tonumber(size) or 0)
end

function Codes.InBraces(s, a, b)
    return s:sub(a - 1, a - 1) == "{" and s:sub(b, b) == "}" and Codes.Number(s:sub(a, b - 1)) ~= nil
end

-- A secret or non-text value is passed back as it is: nothing is read from it.
function CRT.MarkerText(text, size)
    if secret(text) or type(text) ~= "string" or not text:find("{", 1, true) then
        return text
    end
    return (text:gsub("{([^{}]*)}", function(code)
        local n = Codes.Number(code)
        if n then
            return Codes.Icon(n, size)
        end
    end))
end
