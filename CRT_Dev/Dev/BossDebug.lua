local ADDON, CRT = ...

-- DEVELOPER ONLY. Boss debug: one switch that logs every boss pull, one log per boss, ready to copy.
-- While on, ENCOUNTER_START opens the boss's record and ENCOUNTER_END closes it (kill or wipe when the
-- success flag is readable); the latest pull on a boss replaces the one before. The clear, absorb and
-- timeline probes (Dev/ClearProbe.lua, AbsorbProbe.lua, TimelineProbe.lua) follow the switch without
-- their own being on, and write the lines they log today into the record's sections through Append.
-- Nothing is printed or shown during a pull. The Development page's Boss debug section
-- (Dev/BossDebugPanel.lua) lists one row per boss with Copy; /crt dev bossdebug on|off|show [boss].
--
-- Saved in CRTDB.dev.bossDebug: on, and bosses[encounterID] = { encounterID, name, difficultyID,
-- difficultyName, startedAt and endedAt (time()), length (seconds), result ("kill", "wipe" or nil),
-- lines[section] = { line, ... }, counts[section] = { n, secret }, kept, dropped, capped["section kind"] = n
-- (lines a probe's own cap per kind left out, counted in dropped too) }.
--
-- Values from the game go through the secret check before they are compared or stored; the probes pass
-- finished strings and a count of the secret values in each.
--
-- This file never ships: its .toc line is inside the do-not-package block.

local BossDebug = {}
CRT.BossDebug = BossDebug

BossDebug.MAX_LINES = 6000 -- per record, every section together
BossDebug.SECTIONS = { "clear", "absorb", "timeline" } -- the order the text lists them in

local TEXT = {
    copyTitle = "Boss debug: %s (Ctrl+C to copy, paste to Claude)",
    on = "Boss debug on: every boss pull is logged, one log per boss. /crt dev bossdebug show lists them.",
    off = "Boss debug off. The logs are kept.",
    none = "Boss debug has no logs yet.",
    noLog = "Boss debug has no log for \"%s\". /crt dev bossdebug show lists them.",
    status = "Boss debug is %s, with %d boss logs. /crt dev bossdebug on, off, show, or show <boss>.",
    listHead = "Boss debug logs (/crt dev bossdebug show <boss> to copy one):",
    legend = "<secret> or secret is a value the game hid; nil or missing is one that wasn't there. Each line starts with its seconds from the pull.",
    nothing = "(nothing logged)",
}

local frame
local current -- the record lines go to: the last pull opened this session, until the next one
local openedAt -- GetTime() when it opened
local listeners = {}

local function store()
    CRT.db.dev = CRT.db.dev or {}
    local s = CRT.db.dev.bossDebug
    if not s then
        s = { on = false, bosses = {} }
        CRT.db.dev.bossDebug = s
    end
    s.bosses = s.bosses or {}
    return s
end

local function isSecret(v)
    if not issecretvalue then
        return false
    end
    local ok, secret = pcall(issecretvalue, v)
    return not ok or secret and true or false
end

local function readable(v)
    return not isSecret(v) and v ~= nil
end

local function fire()
    for _, fn in ipairs(listeners) do
        pcall(fn)
    end
end

-- fn() runs after any change: a pull opened or closed, the switch, Clear.
function BossDebug:OnChange(fn)
    listeners[#listeners + 1] = fn
end

function BossDebug:IsOn()
    return CRT.db ~= nil and store().on == true
end

local function probes()
    return { CRT.ClearProbe, CRT.AbsorbProbe, CRT.TimelineProbe }
end

local function listen(on)
    if not frame then
        return
    end
    if on then
        frame:RegisterEvent("ENCOUNTER_START")
        frame:RegisterEvent("ENCOUNTER_END")
    else
        frame:UnregisterEvent("ENCOUNTER_START")
        frame:UnregisterEvent("ENCOUNTER_END")
    end
    for _, probe in ipairs(probes()) do
        if probe and probe.Follow then
            probe:Follow(on)
        end
    end
end

function BossDebug:SetOn(on)
    store().on = on and true or false
    if not on then
        current = nil
    end
    listen(on)
    fire()
end

-- Opens the pull's record. Boss debug's own frame and each following probe call it at ENCOUNTER_START,
-- since the game gives no order between frames: the first call opens it, the rest of the same pull (the
-- same moment and boss) find it open.
function BossDebug:Open(encounterID, name, difficultyID)
    if not CRT.db or not store().on then
        return
    end
    local now = GetTime()
    if not readable(encounterID) or type(encounterID) ~= "number" then
        current, openedAt = nil, now -- a pull that can't be keyed: its lines go nowhere
        return
    end
    if current and openedAt == now and current.encounterID == encounterID then
        return
    end
    local diff = readable(difficultyID) and type(difficultyID) == "number" and difficultyID or nil
    local diffName
    if diff and GetDifficultyInfo then
        local ok, n = pcall(GetDifficultyInfo, diff)
        diffName = ok and readable(n) and type(n) == "string" and n or nil
    end
    local rec = { encounterID = encounterID, name = readable(name) and type(name) == "string" and name or nil,
        difficultyID = diff, difficultyName = diffName, startedAt = time(), lines = {}, counts = {}, kept = 0, dropped = 0 }
    store().bosses[encounterID] = rec
    current, openedAt = rec, now
    fire()
end

-- Closes the open record at ENCOUNTER_END. Lines may still come after it (the timeline probe's reads
-- once combat ends); they go to the same record until the next pull opens.
function BossDebug:Close(encounterID, success)
    if not current or current.endedAt or not readable(encounterID) or encounterID ~= current.encounterID then
        return
    end
    current.endedAt = time()
    current.length = GetTime() - openedAt
    if readable(success) and type(success) == "number" then
        current.result = success == 1 and "kill" or "wipe"
    end
    fire()
end

-- Seconds since the open record's pull started, or nil when no record takes lines.
function BossDebug:Seconds()
    if not current then
        return nil
    end
    return GetTime() - openedAt
end

-- One finished line for a section of the open record. secrets: how many values in it the game hid
-- (counted from "<secret>" in the line when not given). Past MAX_LINES a line is only counted, unless
-- always: a kind the probe keeps past the cap under a cap of its own. Returns a handle for Update, or nil
-- when the line was not kept.
function BossDebug:Append(section, line, secrets, always)
    if not current or not CRT.db or not store().on or type(line) ~= "string" then
        return nil
    end
    if not secrets then
        secrets = 0
        for _ in line:gmatch("<secret>") do
            secrets = secrets + 1
        end
    end
    local c = current.counts[section]
    if not c then
        c = { n = 0, secret = 0 }
        current.counts[section] = c
    end
    c.n = c.n + 1
    c.secret = c.secret + secrets
    if current.kept >= self.MAX_LINES and not always then
        current.dropped = current.dropped + 1
        return nil
    end
    current.kept = current.kept + 1
    local list = current.lines[section]
    if not list then
        list = {}
        current.lines[section] = list
    end
    list[#list + 1] = line
    return { list = list, index = #list }
end

-- A line a probe left out past its own cap for one kind: counted, not kept.
function BossDebug:Capped(section, kind, secrets)
    if not current or not CRT.db or not store().on then
        return
    end
    local c = current.counts[section]
    if not c then
        c = { n = 0, secret = 0 }
        current.counts[section] = c
    end
    c.n = c.n + 1
    c.secret = c.secret + (secrets or 0)
    current.dropped = current.dropped + 1
    current.capped = current.capped or {}
    local key = section .. " " .. tostring(kind)
    current.capped[key] = (current.capped[key] or 0) + 1
end

-- Writes a kept line again, such as a running count on it.
function BossDebug:Update(handle, line)
    if handle and handle.list and handle.list[handle.index] and type(line) == "string" then
        handle.list[handle.index] = line
    end
end

function BossDebug:Record(encounterID)
    if not CRT.db then
        return nil
    end
    return store().bosses[encounterID]
end

-- Every record: the route's bosses in route order, then any other, newest first.
function BossDebug:List()
    local out, placed = {}, {}
    if not CRT.db then
        return out
    end
    local bosses = store().bosses
    if CRT.Bosses and CRT.Bosses.RouteList then
        for _, def in ipairs(CRT.Bosses:RouteList()) do
            local rec = bosses[def.encounterID]
            if rec and not placed[def.encounterID] then
                placed[def.encounterID] = true
                out[#out + 1] = rec
            end
        end
    end
    local rest = {}
    for id, rec in pairs(bosses) do
        if not placed[id] then
            rest[#rest + 1] = rec
        end
    end
    table.sort(rest, function(a, b)
        return (a.startedAt or 0) > (b.startedAt or 0)
    end)
    for _, rec in ipairs(rest) do
        out[#out + 1] = rec
    end
    return out
end

local function bossName(rec)
    local def = CRT.Bosses and CRT.Bosses.Get and CRT.Bosses:Get(rec.encounterID)
    return rec.name or (def and def.name) or ("Encounter " .. tostring(rec.encounterID))
end

local function clock(seconds)
    seconds = math.floor(seconds or 0)
    return string.format("%d:%02d", math.floor(seconds / 60), seconds % 60)
end

local function outcome(rec)
    if not rec.endedAt then
        return "not ended"
    end
    return (rec.result or "ended") .. " " .. clock(rec.length)
end

local function secretTotal(rec)
    local n = 0
    for _, c in pairs(rec.counts) do
        n = n + (c.secret or 0)
    end
    return n
end

-- A row's two lines: "Boss, Difficulty" and "10-25 21:03, kill 4:12, 1234 lines, 56 secret".
function BossDebug:RowText(rec)
    local title = bossName(rec) .. (rec.difficultyName and (", " .. rec.difficultyName) or "")
    local when = date and rec.startedAt and date("%m-%d %H:%M", rec.startedAt) or "?"
    local info = string.format("%s, %s, %d lines, %d secret", when, outcome(rec), rec.kept or 0, secretTotal(rec))
    return title, info
end

-- The whole log of a boss: a header, then each section's lines. Nil when the boss has none.
function BossDebug:Text(encounterID)
    local rec = self:Record(encounterID)
    if not rec then
        return nil
    end
    local diff = rec.difficultyName and string.format("%s (difficulty %s)", rec.difficultyName, tostring(rec.difficultyID))
        or ("difficulty " .. tostring(rec.difficultyID or "?"))
    local when = date and rec.startedAt and date("%Y-%m-%d %H:%M", rec.startedAt) or "?"
    local result = rec.endedAt and ((rec.result or "ended") .. ", " .. clock(rec.length)) or "not ended"
    local secrets = {}
    for _, s in ipairs(self.SECTIONS) do
        local c = rec.counts[s]
        secrets[#secrets + 1] = s .. " " .. (c and c.secret or 0)
    end
    local out = {
        string.format("Boss debug: %s, encounter %s", bossName(rec), tostring(rec.encounterID)),
        string.format("%s, pulled %s, %s", diff, when, result),
        string.format("Lines: %d kept, %d dropped. Secret values: %s.", rec.kept or 0, rec.dropped or 0, table.concat(secrets, ", ")),
    }
    if rec.capped and next(rec.capped) then
        local keys, parts = {}, {}
        for key in pairs(rec.capped) do
            keys[#keys + 1] = key
        end
        table.sort(keys)
        for _, key in ipairs(keys) do
            parts[#parts + 1] = key .. " " .. rec.capped[key]
        end
        out[#out + 1] = "Capped by kind: " .. table.concat(parts, ", ") .. " (lines a probe left out past its cap for that kind)."
    end
    out[#out + 1] = TEXT.legend
    for _, s in ipairs(self.SECTIONS) do
        out[#out + 1] = ""
        out[#out + 1] = "== " .. s .. " =="
        local list = rec.lines[s]
        if list and #list > 0 then
            for _, line in ipairs(list) do
                out[#out + 1] = line
            end
        else
            out[#out + 1] = TEXT.nothing
        end
    end
    if (rec.dropped or 0) > 0 then
        out[#out + 1] = ""
        out[#out + 1] = string.format("... %d more lines dropped (a log keeps %d)", rec.dropped, self.MAX_LINES)
    end
    return table.concat(out, "\n")
end

-- Opens a boss's log in the copy window the probes use. Returns false when the boss has none.
function BossDebug:Copy(encounterID)
    local text = self:Text(encounterID)
    if not text then
        return false
    end
    CRT.ConsumablesTools:ShowText(string.format(TEXT.copyTitle, bossName(self:Record(encounterID))), text)
    return true
end

-- Empties every log; the switch stays as it is.
function BossDebug:Clear()
    store().bosses = {}
    current = nil
    fire()
end

-- A boss by encounter ID or name: the name without case, spaces or punctuation, whole first, then part.
local function squash(s)
    return (tostring(s):lower():gsub("[^%w]", ""))
end

function BossDebug:Find(query)
    local id = tonumber(query)
    if id then
        return self:Record(id)
    end
    local want = squash(query)
    if want == "" then
        return nil
    end
    local list = self:List()
    for _, rec in ipairs(list) do
        if squash(bossName(rec)) == want then
            return rec
        end
    end
    for _, rec in ipairs(list) do
        if squash(bossName(rec)):find(want, 1, true) then
            return rec
        end
    end
end

-- Handles "dev bossdebug [on|off|show [boss]]". Returns false for any other command.
function BossDebug:Command(msg)
    local rest = msg:match("^dev%s+bossdebug%s*$") and "" or msg:match("^dev%s+bossdebug%s+(.-)%s*$")
    if not rest then
        return false
    end
    if rest == "on" or rest == "off" then
        self:SetOn(rest == "on")
        CRT:Print(rest == "on" and TEXT.on or TEXT.off)
    elseif rest == "show" then
        local list = self:List()
        if #list == 0 then
            CRT:Print(TEXT.none)
        else
            CRT:Print(TEXT.listHead)
            for _, rec in ipairs(list) do
                local title, info = self:RowText(rec)
                CRT:Print(string.format("  %s (%s): %s", title, tostring(rec.encounterID), info))
            end
        end
    elseif rest:match("^show%s+") then
        local query = rest:match("^show%s+(.+)$")
        local rec = self:Find(query)
        if not (rec and self:Copy(rec.encounterID)) then
            CRT:Print(string.format(TEXT.noLog, query))
        end
    else
        CRT:Print(string.format(TEXT.status, self:IsOn() and "on" or "off", #self:List()))
    end
    return true
end

function BossDebug.HandleEvent(event, ...)
    if event == "PLAYER_LOGIN" then
        -- On stays on through a /reload.
        if CRT.db and CRT.db.dev and CRT.db.dev.bossDebug and CRT.db.dev.bossDebug.on then
            listen(true)
        end
        return
    end
    if not CRT.db or not store().on then
        return
    end
    local a1, a2, a3, _, a5 = ...
    if event == "ENCOUNTER_START" then
        BossDebug:Open(a1, a2, a3)
    elseif event == "ENCOUNTER_END" then
        BossDebug:Close(a1, a5)
    end
end

frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:SetScript("OnEvent", function(_, event, ...)
    BossDebug.HandleEvent(event, ...)
end)
