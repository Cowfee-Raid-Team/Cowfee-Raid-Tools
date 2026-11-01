local ADDON, CRT = ...

-- The conflict rules for alerts: which entries show, which merge into one line, and what is due now.
-- Pure functions with no game calls, so the engine, speech queue and bars all share one set of rules.
-- An entry is { block, id, at, spellID, text, icon, color, priority, hold, warn, glow, sound,
--               outputs = { alert, bar, speech, text, icon, circle, timeline }, speech = { { at, text } } },
-- with `at` the GetTime() it is due.
-- A line is an entry plus `members`, the original entries it stands for. Blocks never compete with
-- each other: duplicates and grouping only apply inside one block listed in `groupBlocks`.

local Rules = {}
CRT.AlertRules = Rules

Rules.DUPLICATE = 2        -- same spell (or text) within this many seconds shows once
Rules.GROUP = 1.5          -- entries this close to the first of a run share one line
Rules.SPEECH_BEHIND = 1.5  -- a queued line this late makes the queue drop its lowest priority
Rules.SPEECH_TIMEOUT = 4   -- seconds a line may play before the next starts without a finished event
Rules.TICK_TAIL = 1        -- seconds a special alert's bar with ticks only runs past its last one (a reminder's ends at the cast)

local LATE = 1  -- a speech item whose entry passed more than this many seconds ago is skipped, not spoken

local LEVEL = { high = 3, normal = 2, low = 1 }

-- rank: 3 your reminder, 2 your note line, 1 raid-wide. level: "high", "normal" or "low".
function Rules.Priority(rank, level)
    return rank * 10 + (LEVEL[level] or 2)
end

-- Earlier first, then higher priority first. Ties keep input order (index passed in as `seq`).
local function before(a, b)
    if a.at ~= b.at then return a.at < b.at end
    if (a.priority or 0) ~= (b.priority or 0) then return (a.priority or 0) > (b.priority or 0) end
    return a.seq < b.seq
end

local function sorted(list)
    local out = {}
    for i, e in ipairs(list) do out[i] = { entry = e, at = e.at, priority = e.priority, seq = i } end
    table.sort(out, before)
    for i, w in ipairs(out) do out[i] = w.entry end
    return out
end

-- Same spell, or the same text when an entry has no spell.
local function dupKey(e)
    if type(e.spellID) == "number" and e.spellID > 0 then return "s" .. e.spellID end
    return "t" .. tostring(e.text)
end

local OUTPUTS = { "alert", "bar", "speech", "text", "icon", "circle", "timeline" }

-- A line standing for one entry, copied so the input is never changed.
local function newLine(e)
    local line = {}
    for k, v in pairs(e) do line[k] = v end
    line.outputs = {}
    for _, k in ipairs(OUTPUTS) do line.outputs[k] = e.outputs and e.outputs[k] end
    line.speech = {}
    for i, s in ipairs(e.speech or {}) do line.speech[i] = s end
    line.members = { e }
    return line
end

local function join(line, e)
    line.text = tostring(line.text) .. " + " .. tostring(e.text)
    line.priority = math.max(line.priority or 0, e.priority or 0)
    line.warn = math.max(line.warn or 0, e.warn or 0)
    line.hold = math.max(line.hold or 0, e.hold or 0)
    if e.outputs then
        for _, k in ipairs(OUTPUTS) do
            if e.outputs[k] then line.outputs[k] = true end
        end
    end
    if e.glow then line.glow = true end
    for _, s in ipairs(e.speech or {}) do line.speech[#line.speech + 1] = s end
    line.members[#line.members + 1] = e
end

-- Entries into lines. groupBlocks[block] true means that block drops duplicates and merges close entries.
function Rules.Lines(entries, groupBlocks)
    local lines, kept, runs = {}, {}, {}
    for _, e in ipairs(sorted(entries)) do
        local block = e.block
        if not (groupBlocks and groupBlocks[block]) then
            lines[#lines + 1] = newLine(e)
        else
            local list = kept[block]
            if not list then list = {}; kept[block] = list end
            local key, dup = dupKey(e), false
            for _, k in ipairs(list) do
                if k.key == key and e.at - k.at <= Rules.DUPLICATE then dup = true; break end
            end
            if not dup then
                list[#list + 1] = { key = key, at = e.at }
                local run = runs[block]
                if run and e.at - run.at <= Rules.GROUP then
                    join(run.line, e)
                else
                    local line = newLine(e)
                    lines[#lines + 1] = line
                    runs[block] = { at = e.at, line = line }
                end
            end
        end
    end
    return sorted(lines)
end

-- The line the on-screen alert shows: inside its warn and hold window, soonest first.
function Rules.Alert(lines, now)
    local best, bestGap
    for _, line in ipairs(lines) do
        if line.outputs and line.outputs.alert and now >= line.at - (line.warn or 0)
            and now < line.at + (line.hold or 0) then
            local gap = line.at - now
            if not bestGap or gap < bestGap then best, bestGap = line, gap end
        end
    end
    return best
end

-- Bar lines due within `ahead` seconds, soonest first, at most `cap`. Second value: how many were left out.
function Rules.Bars(lines, now, ahead, cap)
    local list = {}
    for _, line in ipairs(lines) do
        if line.outputs and line.outputs.bar and line.at - now <= ahead and now < line.at + (line.hold or 0) then
            list[#list + 1] = line
        end
    end
    list = sorted(list)
    local out = {}
    for i = 1, math.min(cap, #list) do out[i] = list[i] end
    return out, #list - #out
end

-- The countdown every display shows, one rule for all: the time left rounded up, so it reads 0 the moment the time
-- passes 0, never before. That is when the sound cue plays (Alerts/Speech.lua schedules it for that moment) and a
-- bar's fill runs out. Tenths under `tenthsUnder` seconds (default 10; 0 for whole seconds only), whole seconds
-- from there and once the tenths would read the threshold itself. Nil once the time is up: each display shows its
-- own NOW or 0.0. ZERO_EPSILON is the one tolerance for the frame clock's rounding: within it of 0 a display
-- draws 0 and a scheduled cue plays (Alerts/Speech.lua). A probe may set Rules.zeroShown(display, line,
-- remaining, at), told whenever a display named by `display` draws a line's zero; `at` is the moment it counted
-- to when that isn't line.at (a bar counting to an impact).
Rules.ZERO_EPSILON = 0.005
local TENTHS_UNDER = 10

function Rules.Countdown(remaining, tenthsUnder, display, line, at)
    if type(remaining) ~= "number" or remaining <= Rules.ZERO_EPSILON then
        if display and line and Rules.zeroShown then
            pcall(Rules.zeroShown, display, line, remaining, at)
        end
        return nil
    end
    local left = remaining - Rules.ZERO_EPSILON
    local under = type(tenthsUnder) == "number" and tenthsUnder or TENTHS_UNDER
    if under > 0 then
        local tenths = math.ceil(left * 10) / 10
        if tenths < under then
            return string.format("%.1f", tenths)
        end
    end
    return tostring(math.ceil(left))
end

-- Lines for the text, icon, circle and timeline areas: those with `output` on, from `warn` seconds before they are
-- due until `hold` seconds after, soonest first, at most `cap`. Second value: how many were left out.
function Rules.Area(lines, now, output, cap)
    local list = {}
    for _, line in ipairs(lines) do
        if line.outputs and line.outputs[output] and now >= line.at - (line.warn or 0)
            and now < line.at + (line.hold or 0) then
            list[#list + 1] = line
        end
    end
    list = sorted(list)
    local out = {}
    for i = 1, math.min(cap, #list) do out[i] = list[i] end
    return out, #list - #out
end

-- The spoken parts of one alert as { { offset, text } }, offset in seconds before it is due, in the order they are
-- said: `speak` says the text at `warn` seconds (On show), at 0 when `atZero` (Speak at: At 0), or at opts.before
-- seconds (Speak at: Before 0); `count` says the numbers from opts.countFrom (3 without) down to 1, each at its own
-- second. With Count down on, the text comes after the count, due at 0 (On show and At 0 alike, Alex 2026-11-01); the
-- speech queue says it the moment "1" ends. It is marked afterCount, which only readers such as the tests use. Before 0 keeps its early text: inside the
-- count, the numbers up to the text's second are left out (only those a full second after it are said), so the text
-- never lands on a number and the numbers after it stay on time. opts is optional.
function Rules.SpeechItems(text, warn, speak, count, atZero, opts)
    local out = {}
    local from = opts and type(opts.countFrom) == "number" and opts.countFrom or 3
    local before = opts and type(opts.before) == "number" and opts.before or nil
    if speak and (before or not count) then
        out[1] = { offset = before or (atZero and 0) or warn, text = text }
    end
    if count then
        -- the text at Before 0: only the numbers a full second after it
        local top = (speak and before) and math.min(from, before - 1) or from
        for n = from, 1, -1 do
            if n <= top then
                out[#out + 1] = { offset = n, text = tostring(n) }
            end
        end
        if speak and not before then
            out[#out + 1] = { offset = 0, text = text, afterCount = true }
        end
    end
    return out
end

-- Speech items that have come due and were not spoken yet, oldest first. `spoken` is the caller's table
-- of keys, "<member id>#<index in that member's speech>", so a merged line changing members keeps its keys.
-- Only members with their own speech output on contribute. Every item returned or skipped as too late is
-- marked, so it is considered once. An item is skipped when its entry passed more than a second ago.
function Rules.SpeechDue(lines, now, spoken)
    local items = {}
    for _, line in ipairs(lines) do
        for _, member in ipairs(line.members or { line }) do
            if member.outputs and member.outputs.speech then
                for i, s in ipairs(member.speech or {}) do
                    local key = tostring(member.id) .. "#" .. i
                    if s.at <= now and not spoken[key] then
                        spoken[key] = true
                        -- Late is measured against the entry, as the note always did: a line whose speech
                        -- time passed before the pull is still read out while the line itself is ahead.
                        if now - (member.at or s.at) <= LATE then
                            items[#items + 1] = { key = key, at = s.at, text = s.text, afterCount = s.afterCount, own = member.ownSpeech,
                                priority = member.priority or line.priority, block = member.block or line.block, seq = #items + 1 }
                        end
                    end
                end
            end
        end
    end
    table.sort(items, function(a, b)
        if a.at ~= b.at then return a.at < b.at end
        return a.seq < b.seq
    end)
    for _, it in ipairs(items) do it.seq = nil end
    return items
end

-- The earliest speech item after now that was not spoken yet, as its time and text, or nil. The speech queue wakes
-- for it between its ticks, so every line is said at its own time, not at the next tick. skip(member), when given,
-- leaves out the members it is true for (the speech queue's: a line Read them out keeps quiet).
function Rules.NextSpeech(lines, now, spoken, skip)
    local best, text
    for _, line in ipairs(lines) do
        for _, member in ipairs(line.members or { line }) do
            if member.outputs and member.outputs.speech and not (skip and skip(member)) then
                for i, s in ipairs(member.speech or {}) do
                    if s.at > now and not spoken[tostring(member.id) .. "#" .. i] and (not best or s.at < best) then
                        best, text = s.at, s.text
                    end
                end
            end
        end
    end
    return best, text
end

-- Drops the lowest-priority item (earliest of equals) while the head of the queue is too far behind.
function Rules.Behind(queue, now)
    while #queue > 1 and now - queue[1].at > Rules.SPEECH_BEHIND do
        local worst = 1
        for i = 2, #queue do
            if (queue[i].priority or 0) < (queue[worst].priority or 0) then worst = i end
        end
        table.remove(queue, worst)
    end
    return queue
end
