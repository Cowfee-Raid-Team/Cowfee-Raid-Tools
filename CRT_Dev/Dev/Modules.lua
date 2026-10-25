local ADDON, CRT = ...

-- DEVELOPER ONLY. The module switches (CRT_Core/Modules.lua) from chat, until the Modules page has them. This file
-- never ships: its .toc line is inside the do-not-package block.
--   /crt dev modules                  each module, whether it runs now and what its switch says
--   /crt dev modules <key> on|off     sets one switch; it takes effect after a /reload

local Dev = {}
CRT.ModulesDev = Dev

local TEXT = {
    line = "%s (%s): %s",
    on = "on",
    off = "off",
    afterReload = "%s after a /reload",
    set = "%s will be %s after a /reload.",
    same = "%s is already %s.",
    unknown = "No module '%s'. The modules are: %s.",
    usage = "Use /crt dev modules <key> on or off.",
}
Dev.TEXT = TEXT

local function word(on)
    return on and TEXT.on or TEXT.off
end

local function keys()
    local out = {}
    for _, def in ipairs(CRT.Modules:List()) do
        out[#out + 1] = def.key
    end
    return table.concat(out, ", ")
end

function Dev:List()
    local M = CRT.Modules
    for _, def in ipairs(M:List()) do
        local now, saved = M:IsOn(def.key), M:Saved(def.key)
        local state = now == saved and word(now) or TEXT.afterReload:format(word(saved))
        CRT:Print(TEXT.line:format(def.label, def.key, state))
    end
end

-- Handles "dev modules ...". True when it was one.
function Dev:Command(msg)
    if msg ~= "dev modules" and not msg:match("^dev modules%s") then
        return false
    end
    local M = CRT.Modules
    if not M then
        return true
    end
    local key, state = msg:match("^dev modules%s+(%S+)%s*(%S*)$")
    if not key then
        self:List()
        return true
    end
    local def = M:Get(key)
    if not def then
        CRT:Print(TEXT.unknown:format(key, keys()))
        return true
    end
    if state ~= "on" and state ~= "off" then
        CRT:Print(TEXT.usage)
        return true
    end
    local on = state == "on"
    if M:Saved(key) == on and M:IsOn(key) == on then
        CRT:Print(TEXT.same:format(def.label, word(on)))
        M:Set(key, on)
        return true
    end
    M:Set(key, on)
    CRT:Print(TEXT.set:format(def.label, word(on)))
    return true
end
