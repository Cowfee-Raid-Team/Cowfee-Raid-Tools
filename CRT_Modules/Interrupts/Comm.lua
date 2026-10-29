local ADDON, CRT = ...

-- Interrupts: sharing the kick list (CRT.InterruptComm). Only the raid leader or an assistant can share, and a list
-- is only taken from one. Share sends your own list for a boss (the page's fields); a received one is saved as the
-- raid's list for that boss (Interrupts:ReceiveShared) and put in use, your own left as it is, and your number and
-- side follow at once, with one chat line. Lists are taken only while Enable Interrupts and Accept kick lists are
-- both on. Addon messages are blocked during a boss encounter, so share before the pull.
--
-- One message under the prefix CRTKick1, through the shared send queue (CRT_Core/Comm.lua):
--   L|<version>|<encounterID>|<hash>|<name>,<name>,...
-- names in group order, then slot order, an empty slot an empty field; hash is CRT.Comm.Fingerprint of the names, so
-- a list that arrives damaged is dropped. version is VERSION; a later minor version only adds fields after the names,
-- a higher major version is skipped. Ten names fit one 255 byte message; a longer list is refused with a reason.
--
-- Game calls (warcraft.wiki.gg, read 2026-10-28): C_ChatInfo.RegisterAddonMessagePrefix, CHAT_MSG_ADDON (prefix,
-- text, channel, sender), Ambiguate(name, "none"), UnitName, UnitIsGroupLeader, UnitIsGroupAssistant,
-- C_InstanceEncounter.IsEncounterInProgress (the global IsEncounterInProgress on older clients).

local Interrupts = CRT.Interrupts
local Shared = CRT.Comm
local KickComm = {}
CRT.InterruptComm = KickComm

KickComm.PREFIX = "CRTKick1"
KickComm.VERSION = 1
KickComm.MAX_BYTES = 255

local TEXT = {
    what = "the kick list",
    group = "You need to be in a group to share the kick list.",
    lead = "Only the raid leader or an assistant can share the kick list.",
    slots = "Fill all %d slots first.",
    fight = "The kick list can't be shared during a boss fight. Share it before the pull.",
    noBoss = "This boss has no kick numbers.",
    badName = "A name holds a comma or a bar.",
    tooLong = "The list is too long to send; shorten the names.",
    shared = "Shared the kick list for %s with the group.",
    got = "%s shared the kick list for %s. Your kick: #%d %s.",
    notOn = "%s shared the kick list for %s. You are not on it.",
    damaged = "A kick list from %s arrived damaged. Ask them to share it again.",
}
KickComm.TEXT = TEXT

if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then
    C_ChatInfo.RegisterAddonMessagePrefix(KickComm.PREFIX)
end

local function inEncounter()
    local fn = (C_InstanceEncounter and C_InstanceEncounter.IsEncounterInProgress) or IsEncounterInProgress
    if not fn then
        return false
    end
    local ok, on = pcall(fn)
    -- a secret or failed answer counts as in a fight: never send into the lockdown
    return not ok or not Shared.Readable(on) or on == true
end

-- The message for a boss's list, or nil and why not.
function KickComm.Encode(encounterID, def, list)
    if not def then
        return nil, TEXT.noBoss
    end
    local names = {}
    for g = 1, #def.groups do
        for s = 1, def.slots do
            local name = type(list[g]) == "table" and list[g][s] or ""
            name = type(name) == "string" and name or ""
            if name:find("[,|]") then
                return nil, TEXT.badName
            end
            names[#names + 1] = name
        end
    end
    local body = table.concat(names, ",")
    local msg = string.format("L|%d|%d|%s|%s", KickComm.VERSION, encounterID, Shared.Fingerprint(body), body)
    if #msg > KickComm.MAX_BYTES then
        return nil, TEXT.tooLong
    end
    return msg
end

-- The boss and its list from a message, or nil for anything this CRT doesn't read. def is the boss's block, or a
-- function from encounter ID to block.
function KickComm.Decode(message, def)
    if type(message) ~= "string" or #message > KickComm.MAX_BYTES then
        return nil
    end
    local version, id, hash, body = message:match("^L|([%d%.]+)|(%d+)|(%x+)|([^|]*)")
    local major = tonumber(version and version:match("^(%d+)"))
    id = tonumber(id)
    if not (major and id and major <= KickComm.VERSION) or Shared.Fingerprint(body) ~= hash then
        return nil
    end
    if type(def) == "function" then
        def = def(id)
    end
    if not def then
        return nil
    end
    local names = {}
    for name in (body .. ","):gmatch("([^,]*),") do
        names[#names + 1] = name
    end
    if #names ~= #def.groups * def.slots then
        return nil
    end
    local list, i = {}, 0
    for g = 1, #def.groups do
        list[g] = {}
        for s = 1, def.slots do
            i = i + 1
            list[g][s] = names[i]
        end
    end
    return id, list
end

-- Whether you can share this boss's list now: true, or false and why.
function KickComm:CanShare(encounterID)
    if not Shared.Channel() then
        return false, TEXT.group
    end
    if not Shared.IsLeaderOrAssist("player") then
        return false, TEXT.lead
    end
    local def = Interrupts:Def(encounterID)
    if not def then
        return false, TEXT.noBoss
    end
    if not Interrupts:Complete(encounterID, Interrupts:Own(encounterID)) then
        return false, string.format(TEXT.slots, #def.groups * def.slots)
    end
    if inEncounter() then
        return false, TEXT.fight
    end
    return true
end

-- Shares your own list for a boss. Returns true when it was sent (or waits on the game's throttle).
function KickComm:Share(encounterID)
    local ok, why = self:CanShare(encounterID)
    if not ok then
        CRT:Print(why)
        return false
    end
    local msg, err = self.Encode(encounterID, Interrupts:Def(encounterID), Interrupts:Own(encounterID))
    if not msg then
        CRT:Print(err)
        return false
    end
    if not Shared:Send(self.PREFIX, { msg }, TEXT.what) then
        return false
    end
    CRT:Print(string.format(TEXT.shared, Interrupts:BossName(encounterID)))
    return true
end

function KickComm:Receive(message, sender)
    local short = Ambiguate(sender, "none")
    local okMe, me = pcall(UnitName, "player")
    if okMe and Shared.Readable(me) and short == me then
        return
    end
    if not Shared.IsLeaderOrAssist(short) then
        return
    end
    local id, list = self.Decode(message, function(encounterID)
        return Interrupts:Def(encounterID)
    end)
    if not id then
        if message:find("^L|1|") then
            CRT:Print(string.format(TEXT.damaged, short))
        end
        return
    end
    if not (Interrupts:Enabled() and Interrupts:Settings().accept) then
        return
    end
    Interrupts:ReceiveShared(id, list, short)
    local n, group = Interrupts:Mine(id)
    local boss = Interrupts:BossName(id)
    if n then
        CRT:Print(string.format(TEXT.got, short, boss, n, group or ""))
    else
        CRT:Print(string.format(TEXT.notOn, short, boss))
    end
end

-- Listening only while the module is on: off, a shared list is never even read.
local events = CreateFrame("Frame")
events:SetScript("OnEvent", function(_, event, prefix, message, _, sender)
    if event == "PLAYER_LOGIN" then
        KickComm.Listen()
        return
    end
    -- secrets first: nothing is compared or matched before
    if not (Shared.Readable(prefix) and Shared.Readable(message) and Shared.Readable(sender)) then
        return
    end
    if prefix ~= KickComm.PREFIX or type(message) ~= "string" or type(sender) ~= "string" then
        return
    end
    KickComm:Receive(message, sender)
end)
events:RegisterEvent("PLAYER_LOGIN")

function KickComm.Listen()
    if Interrupts:Enabled() then
        events:RegisterEvent("CHAT_MSG_ADDON")
    else
        events:UnregisterEvent("CHAT_MSG_ADDON")
    end
end

Interrupts:OnChange(function(what)
    if what == "enabled" then
        KickComm.Listen()
    end
end)
if CRT.db then
    KickComm.Listen()
end
