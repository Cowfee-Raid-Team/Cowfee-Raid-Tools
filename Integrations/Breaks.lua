local ADDON, CRT = ...

-- Break timers in other addons' formats, so a break started in one reaches raiders running another.
-- QoL/BreakTimer.lua owns the break itself; this file only speaks the formats:
--   nsrt      Northern Sky Raid Tools (/ns break), through NSRT's transport (Integrations/NSRT.lua)
--   bigwigs   BigWigs, which MRT's Timers page also sends
--   dbm       Deadly Boss Mods, which MRT's Timers page also sends
-- MRT has no break timer of its own: its Timers page sends the BigWigs and DBM messages, so it is
-- covered by those two. None of these addons has a public call for this, and nothing of theirs is
-- loaded or changed: the BigWigs and DBM messages are plain addon messages, and NSRT's go through its
-- own AceComm copy.

local Breaks = {}
CRT.BreakFormats = Breaks

local NSRT = CRT.NSRT
local Targets = CRT.NoteTargets

-- The formats, VERSION-SENSITIVE. Worked out against NorthernSkyRaidTools 12.1.31, and BigWigs and DBM
-- as MRT 5335 sends them. If an update of one of them stops breaks arriving, this block is the one
-- place to fix.
--   NSRT     NSRT message (see Integrations/NSRT.lua) with event BREAK, args <unit>, <seconds>,
--            <end server time>, <total seconds>; <seconds> 0 (args <unit>, 0) cancels. Receivers take
--            it from the leader or an assistant. A raider who reloads sends SYNC_REQUEST (args <unit>);
--            the leader answers with SYNC as an NSRT whisper: <unit>, <their unit>, <end server time>,
--            <total>, which they take only from the leader and only with more than 5 seconds left.
--   BigWigs  "P^Break^<seconds>" under prefix "BigWigs"
--   DBM      "<Name>-<Realm without spaces or dashes>\t<version>\tBT\t<seconds>" under prefix "D5"
--   Cancelling with 0 seconds in BigWigs and DBM is not confirmed yet.
local WIRE = {
    nsrtAddon = "NorthernSkyRaidTools",
    nsrtBreak = "NSI_BREAK_TIMER",
    nsrtSyncRequest = "NSI_BREAK_TIMER_SYNC_REQUEST",
    nsrtSync = "NSI_BREAK_TIMER_SYNC",
    nsrtSyncMin = 5,
    bigwigsPrefix = "BigWigs",
    bigwigsBreak = "^P%^Break%^(%d+)",
    bigwigsSend = "P^Break^%d",
    dbmPrefix = "D5",
    dbmVersion = "1",
    dbmBreak = "BT",
}

-- Labels and the addons whose loading counts as "installed here". BigWigs and DBM messages are sent
-- even when neither is installed here, since raiders may run them.
Breaks.FORMATS = {
    { key = "nsrt", label = "Northern Sky", addons = { WIRE.nsrtAddon }, needsAddon = true },
    { key = "bigwigs", label = "BigWigs", addons = { "BigWigs", "BigWigs_Core" } },
    { key = "dbm", label = "DBM", addons = { "DBM-Core" } },
}
local LABEL = { crt = "CRT" }
for _, f in ipairs(Breaks.FORMATS) do
    LABEL[f.key] = f.label
end

function Breaks.Label(key)
    return LABEL[key] or key
end

local function installed(f)
    for _, name in ipairs(f.addons) do
        if Targets.AddonLoaded(name) then
            return true
        end
    end
    return false
end

-- ok, and a note: why it can't send (NSRT not loaded), or that it isn't installed here.
function Breaks.Available(f)
    if installed(f) then
        if f.key == "nsrt" and not NSRT.IsAvailable() then
            return false, select(2, NSRT.IsAvailable())
        end
        return true
    end
    if f.needsAddon then
        return false, f.label .. " is not loaded."
    end
    return true, "not installed here; sent for raiders who run it"
end

local function settings()
    return CRT.db.qol.breakTimer
end

-- Whether Also send to has this format ticked (a format with no saved choice is on).
function Breaks.Enabled(key)
    return settings().formats[key] ~= false
end

function Breaks.SetEnabled(key, on)
    settings().formats[key] = on and true or false
end

local function channel()
    if IsInGroup(LE_PARTY_CATEGORY_INSTANCE) then
        return "INSTANCE_CHAT"
    elseif IsInRaid() then
        return "RAID"
    elseif IsInGroup() then
        return "PARTY"
    end
    return nil
end

local function addonMessage(prefix, message)
    local ok, result = pcall(C_ChatInfo.SendAddonMessage, prefix, message, channel())
    return ok and (result == nil or result == true or result == 0 or
        (Enum.SendAddonMessageResult and result == Enum.SendAddonMessageResult.Success))
end

local function dbmName()
    return UnitName("player") .. "-" .. (GetRealmName() or ""):gsub("[%s%-]+", "")
end

-- Sending -------------------------------------------------------------------------------------

-- Sends one format. seconds 0 cancels; total is the break's full length (for NSRT's bar). Returns ok.
local SEND = {
    nsrt = function(seconds, total)
        local ok, message
        if seconds > 0 then
            ok, message = pcall(NSRT.Encode, WIRE.nsrtBreak, seconds, GetServerTime() + seconds, total or seconds)
        else
            ok, message = pcall(NSRT.Encode, WIRE.nsrtBreak, 0)
        end
        if not ok then
            return false
        end
        NSRT.SendRaw(message, false)
        return true
    end,
    bigwigs = function(seconds)
        return addonMessage(WIRE.bigwigsPrefix, WIRE.bigwigsSend:format(seconds))
    end,
    dbm = function(seconds)
        return addonMessage(WIRE.dbmPrefix,
            dbmName() .. "\t" .. WIRE.dbmVersion .. "\t" .. WIRE.dbmBreak .. "\t" .. seconds)
    end,
}

-- Sends a break (seconds 0: a cancel) in every ticked, available format, except those in skip (a set of
-- keys). Returns the labels sent and the labels that failed, or nil and a reason when nothing could go.
function Breaks:SendAll(seconds, total, skip)
    if not channel() then
        return nil, "not in a group"
    elseif Targets.ChatLocked() then
        return nil, "addon messages are locked down right now"
    end
    local sent, failed = {}, {}
    for _, f in ipairs(self.FORMATS) do
        if Breaks.Enabled(f.key) and Breaks.Available(f) and not (skip and skip[f.key]) then
            local ok = SEND[f.key](seconds, total)
            if ok then
                sent[#sent + 1] = f.label
            else
                failed[#failed + 1] = f.label
            end
        end
    end
    return sent, failed
end

-- Receiving -----------------------------------------------------------------------------------

local handler -- fn(source, sender, seconds): set by the break timer

function Breaks:OnReceive(fn)
    handler = fn
end

local function isSelf(name)
    return name == UnitName("player")
end

-- A break from the leader or an assistant (never yourself), in seconds left; 0 cancels.
local function deliver(source, sender, seconds)
    if not handler or type(sender) ~= "string" then
        return
    end
    local short = Ambiguate(sender, "none")
    if isSelf(short) or not (UnitIsGroupLeader(short) or UnitIsGroupAssistant(short)) then
        return
    end
    handler(source, sender, math.max(0, math.floor(seconds + 0.5)))
end

-- The answer to an NSRT raider's sync request: only the leader, only with a break of more than 5
-- seconds left. remaining() and total() come from the break timer.
local function answerSync(unit, remaining, total)
    if type(unit) ~= "string" or not UnitExists(unit) or UnitIsUnit(unit, "player")
        or not UnitIsGroupLeader("player") or not Breaks.Enabled("nsrt") or Targets.ChatLocked() then
        return
    end
    local left = remaining and remaining()
    if not left or left <= WIRE.nsrtSyncMin then
        return
    end
    local ok, message = pcall(NSRT.Encode, WIRE.nsrtSync, unit, GetServerTime() + left, total() or left)
    if ok then
        NSRT.SendRaw(message, true)
    end
end

local syncSource -- { remaining = fn, total = fn }, from the break timer

function Breaks:AnswerSyncWith(remaining, total)
    syncSource = { remaining = remaining, total = total }
end

local function onNSRT(payload, sender, whisper)
    if whisper then
        return -- syncs are for an NSRT that reloaded; CRT keeps its own break over a /reload
    end
    local args = payload.args
    if payload.event == WIRE.nsrtBreak then
        local seconds, endServer = tonumber(args[2]), tonumber(args[3])
        if seconds and seconds > 0 and endServer then
            seconds = endServer - GetServerTime()
            if seconds <= 0 then
                return
            end
        end
        if seconds then
            deliver("nsrt", sender, seconds)
        end
    elseif payload.event == WIRE.nsrtSyncRequest and syncSource then
        answerSync(args[1], syncSource.remaining, syncSource.total)
    end
end

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_LOGIN")
events:RegisterEvent("CHAT_MSG_ADDON")
events:SetScript("OnEvent", function(_, event, prefix, message, _, sender)
    if event == "PLAYER_LOGIN" then
        NSRT.Listen(onNSRT)
        return
    end
    if type(message) ~= "string" or type(sender) ~= "string" then
        return
    end
    if issecretvalue and (issecretvalue(message) or issecretvalue(sender) or issecretvalue(prefix)) then
        return
    end
    if prefix == WIRE.bigwigsPrefix then
        local seconds = tonumber(message:match(WIRE.bigwigsBreak))
        if seconds then
            deliver("bigwigs", sender, seconds)
        end
    elseif prefix == WIRE.dbmPrefix then
        local _, _, command, seconds = strsplit("\t", message)
        if command == WIRE.dbmBreak and tonumber(seconds) then
            deliver("dbm", sender, tonumber(seconds))
        end
    end
end)

if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then
    C_ChatInfo.RegisterAddonMessagePrefix(WIRE.bigwigsPrefix)
    C_ChatInfo.RegisterAddonMessagePrefix(WIRE.dbmPrefix)
end
