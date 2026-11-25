local ADDON, CRT = ...

-- The translation table. Every file keeps its on-screen wording in its own TEXT table, in English, next to the
-- code that draws it, and passes that table through CRT.Locale once, when the file loads:
--     local TEXT = CRT.Locale("Notes.Page", { title = "Notes", ... })
-- The first argument is the file's namespace: its module and file name ("Notes.Page"; "UI.Panel" for
-- CRT_Core/UI/Panel.lua, "Core.Profiles" for a file straight in CRT_Core, "Dev.BossDebug" for CRT_Dev/Dev). Every
-- namespace is used by one file only (the "locale" test group checks).
--
-- A translation is a locale file that overrides keys; it never changes the English. A future CRT_Locales/deDE.lua:
--     local ADDON, CRT = ...
--     CRT.LOCALE.deDE = {
--         ["Notes.Page"] = { title = "Notizen" },
--     }
-- The .toc lists such files right after CRT_Core/Locale.lua, before every file with a TEXT table, since each
-- TEXT table reads its overrides once, as its file loads. A key the locale file leaves out stays English; a key
-- English doesn't have is ignored; an override of another type than the English value (a string for a list) is
-- ignored, so a key in English never reads nil. A key whose English value is a table (an option list such as
-- { "intro", { "Name", "text" } }) is replaced whole, never merged.
--
-- Format strings: a translation keeps every %s and %d of the English, in the same order, since the code passes
-- the values in that order. A TEXT table with keys that format two or more values (names, items, a count and a
-- word), whose order a language may want changed, says so in a comment above it; such a key gets reworked (to
-- values a translation can reorder) before it is translated.
--
-- With no overrides for the client's language and namespace, CRT.Locale returns the English table itself: no
-- copy, no metatable, nothing more to read in hot paths. With overrides it returns a plain copy with the
-- overrides in place. A file that writes into its TEXT table later writes into that table either way.
-- Game API: GetLocale (the client's language code, "enUS", "deDE"; English (GB) clients return "enUS").

CRT.LOCALE = CRT.LOCALE or {}

-- The client's language code, or nil when the game gives none (guarded: harnesses and odd clients).
local function clientLocale()
    if type(GetLocale) ~= "function" then
        return nil
    end
    local ok, code = pcall(GetLocale)
    if ok and type(code) == "string" then
        return code
    end
    return nil
end

-- The TEXT table for namespace ns: english itself when the client's language has no overrides for ns, otherwise
-- a copy of english with each override of the same type in place.
function CRT.Locale(ns, english)
    local code = clientLocale()
    local all = CRT.LOCALE
    local lang = code and type(all) == "table" and all[code]
    local over = type(lang) == "table" and lang[ns]
    if type(over) ~= "table" or next(over) == nil then
        return english
    end
    local text = {}
    for key, value in pairs(english) do
        local said = over[key]
        if said ~= nil and type(said) == type(value) then
            text[key] = said
        else
            text[key] = value
        end
    end
    return text
end
