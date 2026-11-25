local ADDON, CRT = ...

-- DEVELOPER ONLY. /crt dev mem [seconds] (default 15, 1 to 120): what in CRT makes Lua garbage, measured in game
-- (#1315). For the given seconds it wraps CRT's own frames' scripts (Probe.KINDS: OnUpdate, OnEvent, OnShow, OnHide,
-- OnClick, OnEnter and the other mouse, value, size and text scripts), CRT.UI's Show, Hide and Toggle (a page's build
-- and show), and the C_Timer callbacks CRT schedules, reads collectgarbage("count") before and after each call, then prints the 10 that made the most KB,
-- with their call counts, and the total. Everything it wrapped is put back when it ends; a wrapper still in place
-- (a script CRT hooked on top of it meanwhile) only passes the call on. No effect when it isn't running.
--   CRT's frames: those named CowfeeRaidTools..., and every frame the game says CRT's files made
--   (ScriptRegion:GetSourceLocation, which needs the enableSourceLocationLookup CVar on, read at creation: the
--   probe says so when it is off; /console enableSourceLocationLookup 1, then /reload). Protected frames are left
--   alone (setting a script on one would taint it).
--   CRT's timers: C_Timer.After, NewTimer and NewTicker are wrapped while it runs, and a call from a CRT file (by
--   debugstack) has its callback measured under the line that scheduled it. Timers and tickers made before the
--   probe started aren't measured. While it runs, the game's own C_Timer calls go through the wrapper too, so it
--   never starts in combat.
-- It also prints how often each note window rebuilt and why (CRT.NoteWindow.rebuilds), and how much of CRT's memory
-- growth it saw. Scripts set on frames made while it runs aren't wrapped; the show that made them is.
-- A call's KB is what the Lua heap grew by during it, less what the measured calls inside it made (a menu click's
-- page change, a page change's first build of the page and the dev layout editor each on their own line): a garbage
-- collector step in the middle reads as 0. KB inside a call can be the game's or another addon's (a hook on what CRT
-- called): after the run it measures the game's tooltip hide alone, which every OnLeave that hides the tooltip pays.
-- Game calls (warcraft.wiki.gg, read 2026-11-25): EnumerateFrames([frame]) (every non-forbidden frame),
-- ScriptRegion:GetSourceLocation() ("path\to\file.lua:10", "UnknownFile" with the CVar off), Frame:GetScript,
-- Frame:SetScript, ScriptRegion:IsProtected, Frame:GetName, collectgarbage("count") (KB of Lua memory in use),
-- debugstack(start, count1, count2), C_Timer.After/NewTimer/NewTicker, InCombatLockdown(),
-- UpdateAddOnMemoryUsage(), GetAddOnMemoryUsage(name) (KB, cached by UpdateAddOnMemoryUsage),
-- C_CVar.GetCVar(name), GameTooltip:IsShown/SetText/Show/Hide.

-- Each call counts only its own KB: what a measured call inside it made (a page's build inside a menu click, the dev
-- layout editor inside a page change) is on that one's line instead, so no KB is counted twice (round 3).
local Probe = { DEFAULT = 15, MAX = 120, TOP = 10, KINDS = { "OnUpdate", "OnEvent", "OnShow", "OnHide", "OnClick",
    "OnEnter", "OnLeave", "OnMouseDown", "OnMouseUp", "OnMouseWheel", "OnValueChanged", "OnSizeChanged", "OnTextChanged",
    "OnEditFocusGained", "OnEditFocusLost", "OnDragStart", "OnDragStop" },
    -- CRT's own functions measured too: the main window's opening, a page change apart from the page's first build
    -- (one line per page: one-time cost), and the developer build's layout editor run after each page change
    FUNCTIONS = { { "UI", "Show" }, { "UI", "Hide" }, { "UI", "Toggle" },
        { "UI", "SelectPage", label = "UI:SelectPage (page change, not the first build)" },
        { "UI", "BuildPage", byPage = true },
        { "Dev", "ApplyAll", label = "Dev:ApplyAll (dev layout editor, after a page change)" } } }
CRT.MemProbe = Probe

-- inner: the KB the measured calls nested in the one running made
local P = { running = false, stats = {}, wrapped = {}, keys = {}, inner = 0 }
Probe.state = P

local function heapKB()
    return collectgarbage("count")
end

-- One call's own garbage on its stat (nothing when a collector step shrank the heap).
local function record(key, kb)
    local st = P.stats[key]
    if not st then
        st = { calls = 0, kb = 0 }
        P.stats[key] = st
    end
    st.calls = st.calls + 1
    if kb > 0 then
        st.kb = st.kb + kb
    end
end

-- Calls fn(...) and records under key what it made, less what the measured calls inside it made.
local function run(key, fn, ...)
    local before, outer = heapKB(), P.inner
    P.inner = 0
    fn(...)
    local grew = heapKB() - before
    if grew < 0 then
        grew = 0
    end
    local own = grew - P.inner
    P.inner = outer + grew
    record(key, own)
end

-- "CRT_Modules/Notes/Window.lua:1437" from a path or a stack line naming a CRT file, else nil.
function Probe.CrtPlace(text)
    if type(text) ~= "string" then
        return nil
    end
    local file, line = text:match("AddOns[/\\]" .. ADDON .. "[/\\]([^\"%]:]-%.lua)\"?%]?:(%d+)")
    if not file then
        return nil
    end
    return (file:gsub("\\", "/")) .. ":" .. line
end

local function sourceOf(frame)
    if not frame.GetSourceLocation then
        return nil
    end
    local ok, place = pcall(frame.GetSourceLocation, frame)
    return ok and place or nil
end

-- The frame's label when it is CRT's, else nil.
local function crtLabel(frame)
    local okName, name = pcall(frame.GetName, frame)
    name = okName and type(name) == "string" and name or nil
    local place = Probe.CrtPlace(sourceOf(frame))
    if place then
        return name and (name .. " (" .. place .. ")") or place
    end
    if name and name:find("^" .. ADDON) then
        return name
    end
    return nil
end

local function isProtected(frame)
    local ok, protected = pcall(frame.IsProtected, frame)
    return ok and protected and true or false
end

-- The stat key for an event on a frame, made once per frame and event.
local function eventKey(label, event)
    local byEvent = P.keys[label]
    if not byEvent then
        byEvent = {}
        P.keys[label] = byEvent
    end
    local key = byEvent[event]
    if not key then
        key = "OnEvent " .. tostring(event) .. "  " .. label
        byEvent[event] = key
    end
    return key
end

local function wrapScript(frame, kind, label)
    local okGet, original = pcall(frame.GetScript, frame, kind)
    if not (okGet and type(original) == "function") then
        return false
    end
    local wrapper
    if kind == "OnEvent" then
        wrapper = function(self, event, ...)
            if not P.running then
                return original(self, event, ...)
            end
            run(eventKey(label, event), original, self, event, ...)
        end
    else
        local key = kind .. "  " .. label
        wrapper = function(...)
            if not P.running then
                return original(...)
            end
            run(key, original, ...)
        end
    end
    if not pcall(frame.SetScript, frame, kind, wrapper) then
        return false
    end
    P.wrapped[#P.wrapped + 1] = { frame = frame, kind = kind, original = original, wrapper = wrapper }
    return true
end

-- A timer callback measured under the CRT line that scheduled it; a call from anywhere else passes through as it is.
local function measured(fn)
    if not P.running or type(fn) ~= "function" then
        return fn
    end
    local place = Probe.CrtPlace(debugstack and debugstack(3, 1, 0))
    if not place then
        return fn
    end
    local key = "timer  " .. place
    return function(...)
        if not P.running then
            return fn(...)
        end
        run(key, fn, ...)
    end
end

local function wrapTimers()
    local T = C_Timer
    if type(T) ~= "table" then
        return
    end
    local after, newTimer, newTicker = T.After, T.NewTimer, T.NewTicker
    P.timers = { After = after, NewTimer = newTimer, NewTicker = newTicker }
    if after then
        T.After = function(seconds, fn)
            return after(seconds, measured(fn))
        end
    end
    if newTimer then
        T.NewTimer = function(seconds, fn)
            return newTimer(seconds, measured(fn))
        end
    end
    if newTicker then
        T.NewTicker = function(seconds, fn, iterations)
            return newTicker(seconds, measured(fn), iterations)
        end
    end
end

-- CRT's own functions (Probe.FUNCTIONS): each call measured under its name, put back after.
local function wrapFunctions()
    P.functions = {}
    for _, spec in ipairs(Probe.FUNCTIONS) do
        local owner = CRT[spec[1]]
        local original = type(owner) == "table" and rawget(owner, spec[2])
        if type(original) == "function" then
            local key = spec.label or (spec[1] .. ":" .. spec[2])
            local byPage = {}
            local wrapper = function(...)
                if not P.running then
                    return original(...)
                end
                local k = key
                if spec.byPage then
                    -- UI:BuildPage(page): a line per page, its name made once
                    local page = select(2, ...)
                    local pageKey = type(page) == "table" and tostring(page.key) or "?"
                    k = byPage[pageKey]
                    if not k then
                        k = "UI:BuildPage " .. pageKey .. " (first build, once)"
                        byPage[pageKey] = k
                    end
                end
                run(k, original, ...)
            end
            owner[spec[2]] = wrapper
            P.functions[#P.functions + 1] = { owner = owner, name = spec[2], original = original, wrapper = wrapper }
        end
    end
end

local function restoreFunctions()
    for _, w in ipairs(P.functions or {}) do
        if w.owner[w.name] == w.wrapper then
            w.owner[w.name] = w.original
        end
    end
    P.functions = nil
end

-- The note windows' rebuild counts by cause, copied (CRT.NoteWindow.rebuilds: { key = { cause = n } }).
local function rebuildCounts()
    local R = CRT.NoteWindow and CRT.NoteWindow.rebuilds
    if type(R) ~= "table" then
        return nil
    end
    local out = {}
    for key, causes in pairs(R) do
        out[key] = {}
        for cause, n in pairs(causes) do
            out[key][cause] = n
        end
    end
    return out
end

local function restoreTimers()
    local saved = P.timers
    if saved and type(C_Timer) == "table" then
        for k, fn in pairs(saved) do
            C_Timer[k] = fn
        end
    end
    P.timers = nil
end

-- Puts back every script still the probe's own; one CRT set or hooked meanwhile stays (its wrapper passes through).
local function restoreScripts()
    for _, w in ipairs(P.wrapped) do
        local ok, now = pcall(w.frame.GetScript, w.frame, w.kind)
        if ok and now == w.wrapper then
            pcall(w.frame.SetScript, w.frame, w.kind, w.original)
        end
    end
    P.wrapped = {}
end

local function addonKB()
    if not (UpdateAddOnMemoryUsage and GetAddOnMemoryUsage) then
        return nil
    end
    local ok = pcall(UpdateAddOnMemoryUsage)
    local okKB, kb = pcall(GetAddOnMemoryUsage, ADDON)
    return ok and okKB and tonumber(kb) or nil
end

-- The stats as a list, the most KB first: { key, calls, kb }; and the total KB and calls.
function Probe.Top()
    local list, kb, calls = {}, 0, 0
    for key, st in pairs(P.stats) do
        list[#list + 1] = { key = key, calls = st.calls, kb = st.kb }
        kb, calls = kb + st.kb, calls + st.calls
    end
    table.sort(list, function(a, b)
        if a.kb ~= b.kb then
            return a.kb > b.kb
        end
        return a.key < b.key
    end)
    return list, kb, calls
end

function Probe:Report()
    local list, kb, calls = Probe.Top()
    local seconds = P.seconds or 0
    CRT:Print(string.format("Memory probe, %d s: CRT's scripts and timers made %.1f KB in %d calls (%.1f KB a second).",
        seconds, kb, calls, seconds > 0 and kb / seconds or 0))
    for i = 1, math.min(Probe.TOP, #list) do
        local e = list[i]
        print(string.format("  %2d. %8.1f KB  %6d calls  %s", i, e.kb, e.calls, e.key))
    end
    if #list == 0 then
        print("  Nothing of CRT's ran.")
    end
    if P.startAddonKB and P.endAddonKB then
        print(string.format("  CRT's memory: %.0f KB -> %.0f KB (%.0f KB more; the probe saw %.0f KB of garbage made). The whole Lua heap: %.0f KB -> %.0f KB.",
            P.startAddonKB, P.endAddonKB, P.endAddonKB - P.startAddonKB, kb, P.startHeap or 0, P.endHeap or 0))
    end
    local from, to = P.rebuildsFrom, P.rebuildsTo
    if from and to then
        local parts = {}
        for _, key in ipairs({ "window", "assignments", "personal" }) do
            local causes = {}
            for cause, n in pairs(to[key] or {}) do
                local d = n - ((from[key] or {})[cause] or 0)
                if d > 0 then
                    causes[#causes + 1] = cause .. " " .. d
                end
            end
            table.sort(causes)
            parts[#parts + 1] = key .. ": " .. (#causes > 0 and table.concat(causes, ", ") or "none")
        end
        print("  Note window rebuilds by cause: " .. table.concat(parts, "; ") .. ".")
    end
    if P.tooltipHideKB then
        print(string.format("  Hiding the game's tooltip alone makes %.1f KB (the game's and other addons' tooltip code); an OnLeave that hides it counts that too.", P.tooltipHideKB))
    end
end

-- What hiding the game's tooltip makes by itself, the game's code and every addon hooked on the tooltip: a CRT OnLeave
-- that only hides it (the menu buttons') counts this too. Measured after the run, a few times, only while the tooltip
-- isn't showing (it is shown with no text and hidden in the same frame, never drawn); nil when it can't be.
local TOOLTIP_TRIES = 3
function Probe.TooltipHideKB()
    local tip = GameTooltip
    if not (tip and tip.Hide and tip.Show and tip.IsShown and CRT.UI and CRT.UI.TooltipOwner) or tip:IsShown() then
        return nil
    end
    local kb = 0
    for _ = 1, TOOLTIP_TRIES do
        CRT.UI.TooltipOwner(tip, UIParent, "ANCHOR_NONE", nil, nil, CRT.UI.TOOLTIP_KEEP)
        tip:SetText(" ")
        tip:Show()
        local before = heapKB()
        tip:Hide()
        local grew = heapKB() - before
        kb = kb + (grew > 0 and grew or 0)
    end
    return kb / TOOLTIP_TRIES
end

function Probe:Stop()
    if not P.running then
        return
    end
    P.running = false
    P.endHeap, P.endAddonKB = heapKB(), addonKB()
    P.rebuildsTo = rebuildCounts()
    restoreTimers()
    restoreFunctions()
    restoreScripts()
    local ok, kb = pcall(Probe.TooltipHideKB)
    P.tooltipHideKB = ok and kb or nil
    self:Report()
end

function Probe:Start(seconds)
    if P.running then
        CRT:Print("The memory probe is already running.")
        return false
    end
    if InCombatLockdown and InCombatLockdown() then
        CRT:Print("The memory probe doesn't run in combat. Try again after it.")
        return false
    end
    seconds = math.max(1, math.min(Probe.MAX, math.floor(tonumber(seconds) or Probe.DEFAULT)))
    P.stats, P.keys, P.wrapped, P.seconds, P.inner, P.tooltipHideKB = {}, {}, {}, seconds, 0, nil
    local frames, named = 0, 0
    local f = EnumerateFrames and EnumerateFrames()
    local located = false
    while f do
        if not located and sourceOf(f) and sourceOf(f) ~= "UnknownFile" then
            located = true
        end
        local label = crtLabel(f)
        if label and not isProtected(f) then
            local any = false
            for _, kind in ipairs(Probe.KINDS) do
                any = wrapScript(f, kind, label) or any
            end
            if any then
                frames = frames + 1
                if not label:find(":%d+") then
                    named = named + 1
                end
            end
        end
        f = EnumerateFrames(f)
    end
    -- the end is scheduled before the timers are wrapped, so it is never one of the probe's own measurements
    C_Timer.After(seconds, function()
        Probe:Stop()
    end)
    P.startHeap, P.startAddonKB, P.rebuildsFrom = heapKB(), addonKB(), rebuildCounts()
    wrapTimers()
    wrapFunctions()
    P.running = true
    CRT:Print(string.format("Memory probe on for %d s: %d of CRT's frames with scripts, and the timers CRT starts.", seconds, frames))
    if not located then
        CRT:Print("Only CRT's named frames were found (" .. named .. "). For all of them: /console enableSourceLocationLookup 1, then /reload.")
    end
    return true
end

-- Handles "dev mem" and "dev mem <seconds>". Returns false for any other command.
function Probe:Command(msg)
    local rest = msg:match("^dev%s+mem%s*$") and "" or msg:match("^dev%s+mem%s+(%S+)%s*$")
    if not rest then
        return false
    end
    if rest ~= "" and not tonumber(rest) then
        CRT:Print("Usage: /crt dev mem [seconds], 1 to " .. Probe.MAX .. " (default " .. Probe.DEFAULT .. ").")
        return true
    end
    self:Start(rest ~= "" and tonumber(rest) or Probe.DEFAULT)
    return true
end
