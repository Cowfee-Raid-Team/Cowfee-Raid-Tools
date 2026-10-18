local ADDON, CRT = ...

-- Other raid addons a CRT note can be sent to, besides CRT's own sharing (Notes/Comm.lua). Each target
-- is one file in Integrations/ that registers itself here with the same interface:
--   key, label                short key ("nsrt") and the name shown in menus ("Northern Sky")
--   help                      one paragraph on what sending to it does, for the (?) tooltip
--   IsAvailable()             ok, reason: its addon is loaded and has what sending needs
--   CanSend()                 ok, reason: whether a send may go right now
--   Format(record)            text, meta: a CRT note record ({ raw, name, encounterID, difficulty })
--                             as that addon's note text; meta is { encounterID, name }
--   Send(text, meta, done)    sends; done(ok, message) is called once the last message is out
--   Clear(done)               clears the group's note in that addon
--   Current()                 optional: the note that addon holds now on this client
--   OnReceived(fn)            optional: calls fn(text) whenever that addon's note changes here
--   Samples                   optional: { { label, raw } } for /crt dev <key> samples
-- Targets:Share sends through one of them and reports, and the arrival through OnReceived, in chat.
-- Share Notes' Send to dropdown and the /crt dev <key> commands both use it.

local Targets = { list = {}, byKey = {} }
CRT.NoteTargets = Targets

local CONFIRM_WINDOW = 30 -- seconds after the last message goes out to wait for the note to arrive here

function Targets:Register(target)
    self.list[#self.list + 1] = target
    self.byKey[target.key] = target
end

function Targets:Get(key)
    return self.byKey[key]
end

-- In the order they registered (the .toc order).
function Targets:List()
    return self.list
end

-- Shared checks ---------------------------------------------------------------------------------

function Targets.AddonLoaded(name)
    return C_AddOns and C_AddOns.IsAddOnLoaded and C_AddOns.IsAddOnLoaded(name) and true or false
end

-- "leader", "assistant" (raids only: a party has no assistants) or nil.
function Targets.Rank()
    if UnitIsGroupLeader("player") then
        return "leader"
    elseif IsInRaid() and UnitIsGroupAssistant("player") then
        return "assistant"
    end
    return nil
end

function Targets.ChatLocked()
    return C_ChatInfo and C_ChatInfo.InChatMessagingLockdown and C_ChatInfo.InChatMessagingLockdown() and true
        or false
end

-- The checks every target makes before its own: combat, a group, chat lockdown. Returns a reason or nil.
function Targets.Blocked()
    if InCombatLockdown() then
        return "you are in combat."
    elseif not IsInGroup() then
        return "you are not in a group."
    elseif Targets.ChatLocked() then
        return "addon messages are locked down right now (an encounter or a Mythic+ run)."
    end
    return nil
end

-- A note line's "key:value;key:value;" pairs, in order, as { key, value } with the key as written.
function Targets.Fields(line)
    local out = {}
    for part in line:gmatch("[^;]+") do
        local key, value = part:match("^%s*([^:]-)%s*:(.*)$")
        if key and key ~= "" then
            out[#out + 1] = { key = key, value = strtrim(value) }
        end
    end
    return out
end

-- A few lines of a note, for chat.
function Targets.Preview(text)
    if type(text) ~= "string" or strtrim(text) == "" then
        return "(empty)"
    end
    local lines, count = {}, 0
    for line in (text .. "\n"):gmatch("(.-)\r?\n") do
        count = count + 1
        if count <= 3 then
            lines[#lines + 1] = "    " .. line
        end
    end
    local more = count > 3 and ("\n    ... " .. (count - 3) .. " more lines") or ""
    return format("%d characters, %d lines:\n%s%s", #text, count, table.concat(lines, "\n"), more)
end

-- Sending and confirming ------------------------------------------------------------------------

local pending = {} -- key -> { text, token } of the last send, until it arrives here or times out

local function say(target, msg)
    CRT:Print(target.label .. ": " .. msg)
end

local function same(a, b)
    return type(a) == "string" and type(b) == "string" and strtrim(a) == strtrim(b)
end

local function received(target, text)
    local p = pending[target.key]
    if p and same(text, p.text) then
        pending[target.key] = nil
        say(target, strtrim(p.text) == "" and "cleared on your client too." or "arrived: your copy is the text sent.")
    end
end

-- After the last message is out, wait for the note to come back to this client through the target's
-- own addon (a sender receives its own group messages); say so if it never matches.
local function watch(target, text)
    local token = {}
    pending[target.key] = { text = text, token = token }
    if not target.OnReceived then
        return
    end
    C_Timer.After(CONFIRM_WINDOW, function()
        local p = pending[target.key]
        if p and p.token == token then
            pending[target.key] = nil
            local now = target.Current and target.Current()
            say(target, format("no matching note arrived on your client in %d seconds. It holds %s", CONFIRM_WINDOW,
                Targets.Preview(now)))
        end
    end)
end

local function go(target, text, label, sendFn)
    local ok, why = target.IsAvailable()
    if ok then
        ok, why = target.CanSend()
    end
    if not ok then
        say(target, "not sent: " .. why)
        return false
    end
    sendFn(function(sent, message)
        if sent then
            say(target, label .. " " .. message)
            watch(target, text)
        else
            say(target, "not sent: " .. message)
        end
    end)
    return true
end

-- Sends a CRT note record to one target, or clears that target's note when the record is nil or empty.
-- Returns true when it started sending (the chat says how it went).
function Targets:Share(key, record)
    local target = self:Get(key)
    if not target then
        return false
    end
    if not record or strtrim(record.raw or "") == "" then
        return self:Clear(key)
    end
    local text, meta = target.Format(record)
    if strtrim(text) == "" then
        say(target, "not sent: the note has nothing " .. target.label .. " can show.")
        return false
    end
    return go(target, text, "'" .. (record.name or "Note") .. "'", function(done)
        target.Send(text, meta, done)
    end)
end

function Targets:Clear(key)
    local target = self:Get(key)
    if not target then
        return false
    end
    return go(target, "", "Clear", function(done)
        target.Clear(done)
    end)
end

-- Each target's arrival hook, once every addon has loaded.
local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:SetScript("OnEvent", function()
    for _, target in ipairs(Targets.list) do
        if target.OnReceived and target.IsAvailable() then
            pcall(target.OnReceived, function(text)
                received(target, text)
            end)
        end
    end
end)
