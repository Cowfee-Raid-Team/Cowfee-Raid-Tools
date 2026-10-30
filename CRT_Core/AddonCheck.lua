local ADDON, CRT = ...

-- The addon check (CRT.AddonCheck): who in the group runs Cowfee Raid Tools, which version, and which of its
-- optional modules each of them has switched on, so a raid leader can see before a pull who will actually get a
-- shared note, pace plan or kick list. General Settings > Addon check (UI/SettingsPage.lua) shows it; the
-- Interrupts page's Who has it panel reads the same answers through Status and sends nothing of its own.
--
-- Modules: each optional part of CRT registers its own column from its own file, in load order, with
--   CRT.AddonCheck:Register({ key = "pace", label = "Pace", order = 40, on = function() return ... end })
-- key is the field name on the wire (lower-case letters only, never changed once released), label the column
-- heading, order the column's place (lower first), on() whether the player has the module switched on now.
-- A registration from a test harness that loads a module file alone is skipped by the module (CRT.AddonCheck
-- is nil there).
--
-- Messages, under the prefix CRTCheck1 on the group channel (RAID, PARTY or INSTANCE_CHAT), "<kind>|<version>|..."
-- with AddonCheck.VERSION as the message version:
--   Q|<version>|<ask id>                                the ask: tell me your version and modules
--   R|<version>|<ask id>|<addon version>|<key>:<1 or 0>,…  the answer, e.g. "R|1|7|1.1.5|notes:1,callout:1,pace:0"
-- Answers go to the group, not back to the asker, so one check fills every CRT's table in the raid (a raider's
-- Interrupts page shows everyone's version without a check of its own) and every CRT learns from any check. A
-- key a reader doesn't know is ignored; a key a sender doesn't send reads as nil ("—", a CRT too old for that
-- module). A later minor version adds fields after the modules; a higher major version is left alone.
-- A CRT answers only in a group, at most once per REPLY_WINDOW (asks in between get the one answer at its end),
-- never its own ask, and not in combat (answered when combat ends). Sends wait a second on the game's throttle
-- and hold during an encounter's message lockdown (LOCKDOWN_RETRY), as Gear Checker's do; anything else drops the
-- message with one chat line. Addon messages are blocked during a boss encounter, so check before the pull.
--
-- Answers are kept in memory only, by the sender's folded name (Team.Key: "name-realm" in lower case), dropped for
-- members who leave the group and cleared when you leave it. An ask is answered within WINDOW seconds or not at
-- all: a member without an answer after that is "No CRT". Your own row never waits: it reads your own switches.
--
-- Older CRTs: a CRT from before this file never answers the ask, but every CRT speaks the hello (Team.lua, prefix
-- CRTHello), which carries its addon version. So in a raid group a check also asks for hellos, through Team's own
-- send path and rules (Team.Request(true): the hello as it always was, with A), and a member with no answer to the
-- ask takes the version of their last hello (Team:VersionOf), with no modules (helloOnly). The hello's answers
-- come after Team's DEBOUNCE on both sides, so after such a check a member with neither answer is No CRT only
-- after HELLO_WINDOW seconds. Outside a raid group there are no hellos, and WINDOW stands.
--
-- Game calls (warcraft.wiki.gg, read 2026-10-28): C_ChatInfo.RegisterAddonMessagePrefix,
-- C_ChatInfo.SendAddonMessage(prefix, message, chatType) -> Enum.SendAddonMessageResult (255 bytes a message, 16 for
-- the prefix), CHAT_MSG_ADDON (prefix, text, channel, sender), GetRaidRosterInfo (name, rank, subgroup, level,
-- class, classFile, zone, online), UnitFullName, UnitClass, UnitIsConnected, GetNumGroupMembers,
-- GetNumSubgroupMembers, IsInGroup, IsInRaid, InCombatLockdown, PLAYER_REGEN_ENABLED, GROUP_ROSTER_UPDATE,
-- C_Timer.After, GetTime.

local Check = { modules = {}, byKey = {}, replies = {}, listeners = {} }
CRT.AddonCheck = Check

Check.PREFIX = "CRTCheck1"
Check.VERSION = 1
Check.WINDOW = 3 -- seconds after an ask: a member with no answer by then is No CRT
Check.HELLO_WINDOW = 6 -- the same, after an ask that also asked for hellos (Team's debounce, theirs, delivery)
Check.ASK_GAP = 5 -- seconds between two asks of your own
Check.STALE = 30 -- seconds: opening the tab asks again when the last ask is older
Check.REPLY_WINDOW = 5 -- seconds: a CRT answers at most once in this time
Check.MAX_VERSION_TEXT = 24
Check.MAX_RAID = 40

local RESULT = Enum and Enum.SendAddonMessageResult or {}
local SUCCESS = RESULT.Success or 0
local THROTTLED = RESULT.AddonMessageThrottle or 3
local CHANNEL_THROTTLED = RESULT.ChannelThrottle or 8
local LOCKDOWN = RESULT.AddOnMessageLockdown or 11
local LOCKDOWN_RETRY = 10 -- seconds between tries while messages are held

if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then
    C_ChatInfo.RegisterAddonMessagePrefix(Check.PREFIX)
end

-- False for a secret value, which can't be read or compared.
local function readable(v)
    if issecretvalue then
        local ok, secret = pcall(issecretvalue, v)
        if not ok or secret then
            return false
        end
    end
    return true
end

local function now()
    return GetTime and GetTime() or 0
end

local function fire(what)
    for _, fn in ipairs(Check.listeners) do
        -- a listener failing must never stop the check
        local ok, err = pcall(fn, what)
        if not ok and geterrorhandler then
            geterrorhandler()(err)
        end
    end
end

-- Names -----------------------------------------------------------------------------------------------------------

-- "Name" or "Name-Realm" as one key, "name-realm", as Team.Key folds it (Team.lua loads first; the copy here keeps
-- a harness that loads this file alone working). Nil for a secret or empty name.
local function fold(name)
    if not readable(name) or type(name) ~= "string" or name == "" then
        return nil
    end
    local base, realm = name:match("^([^%-]+)%-(.+)$")
    if not base then
        base = name
        realm = GetNormalizedRealmName and GetNormalizedRealmName() or ""
        if not readable(realm) or type(realm) ~= "string" then
            realm = ""
        end
    end
    return base:lower() .. "-" .. realm:lower():gsub("[%s%-]", "")
end

function Check.Key(name)
    if CRT.Team and CRT.Team.Key then
        return CRT.Team.Key(name)
    end
    return fold(name)
end

local function me()
    local ok, name = pcall(UnitName, "player")
    return ok and Check.Key(name) or nil
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

-- Modules ---------------------------------------------------------------------------------------------------------

function Check:Register(def)
    if type(def) ~= "table" or type(def.key) ~= "string" or not def.key:match("^%l+$") or type(def.on) ~= "function" then
        error("AddonCheck:Register needs a key of lower-case letters and an on function")
    end
    if self.byKey[def.key] then
        error("AddonCheck: the module " .. def.key .. " is registered twice")
    end
    local m = { key = def.key, label = def.label or def.key, order = def.order or 1000, on = def.on }
    self.byKey[m.key] = m
    self.modules[#self.modules + 1] = m
    table.sort(self.modules, function(a, b)
        if a.order ~= b.order then
            return a.order < b.order
        end
        return a.key < b.key
    end)
end

-- The registered modules, in column order.
function Check:Modules()
    return self.modules
end

-- Your own switches now: key -> true or false. A module whose on() fails counts as off.
function Check:Mine()
    local out = {}
    for _, m in ipairs(self.modules) do
        local ok, on = pcall(m.on)
        out[m.key] = ok and on == true
    end
    return out
end

-- Versions --------------------------------------------------------------------------------------------------------

-- The addon version as the hello sends it: no | or control characters, at most MAX_VERSION_TEXT.
function Check.VersionText()
    return (tostring(CRT.version or "dev"):gsub("[|%c]", ""):sub(1, Check.MAX_VERSION_TEXT))
end

-- The numbers of a version's leading "1.1.5" part, and the text after it ("beta 2", or "").
local function versionParts(text)
    local head = text:match("^%s*([%d%.]+)") or ""
    local numbers = {}
    for n in head:gmatch("%d+") do
        numbers[#numbers + 1] = tonumber(n)
    end
    local tail = text:sub(#(text:match("^%s*[%d%.]*") or "") + 1):gsub("^%s+", ""):gsub("%s+$", "")
    return numbers, tail
end

local function compareNumbers(na, nb)
    for i = 1, math.max(#na, #nb) do
        local x, y = na[i] or 0, nb[i] or 0
        if x ~= y then
            return x < y and -1 or 1
        end
    end
    return 0
end

-- -1 when a is older than b, 1 when newer, 0 when the same. The numbers of each version's leading part are
-- compared in turn ("1.1.5" is 1, 1, 5; a missing number counts as 0); with the same numbers, a version with
-- text after them is older than one without ("1.1.2 beta 2" is older than "1.1.2"), and two such texts compare
-- by their own numbers. A version with no leading numbers at all ("dev") compares the same as anything, so a
-- developer copy is never flagged.
function Check.CompareVersions(a, b)
    local na, ta = versionParts(tostring(a or ""))
    local nb, tb = versionParts(tostring(b or ""))
    if #na == 0 or #nb == 0 then
        return 0
    end
    local c = compareNumbers(na, nb)
    if c ~= 0 then
        return c
    end
    if (ta == "") ~= (tb == "") then
        return ta == "" and 1 or -1
    end
    if ta == "" then
        return 0
    end
    local xa, xb = {}, {}
    for n in ta:gmatch("%d+") do
        xa[#xa + 1] = tonumber(n)
    end
    for n in tb:gmatch("%d+") do
        xb[#xb + 1] = tonumber(n)
    end
    return compareNumbers(xa, xb)
end

-- The wire ---------------------------------------------------------------------------------------------------------

function Check.EncodeAsk(id)
    return "Q|" .. Check.VERSION .. "|" .. string.format("%d", id)
end

-- flags: key -> true or false, written in the registered modules' order (keys not registered are left out).
function Check.EncodeReply(id, version, flags)
    local parts = {}
    for _, m in ipairs(Check.modules) do
        if flags[m.key] ~= nil then
            parts[#parts + 1] = m.key .. ":" .. (flags[m.key] and "1" or "0")
        end
    end
    version = (tostring(version or ""):gsub("[|%c]", "")):sub(1, Check.MAX_VERSION_TEXT)
    return "R|" .. Check.VERSION .. "|" .. string.format("%d", id) .. "|" .. version .. "|" .. table.concat(parts, ",")
end

-- "Q", id for an ask; "R", id, addon version, flags (key -> true or false, unknown keys kept) for an answer;
-- nil for anything this CRT doesn't read: a secret or oversized text, another kind, a higher major version.
function Check.Decode(text)
    if not readable(text) or type(text) ~= "string" or #text > 255 then
        return nil
    end
    local kind, version, rest = text:match("^([QR])|(%d+%.?%d*)|(.*)$")
    version = tonumber(version)
    if not kind or not version or version < 1 or math.floor(version) > Check.VERSION then
        return nil
    end
    if kind == "Q" then
        local id = tonumber(rest:match("^(%d+)$") or rest:match("^(%d+)|"))
        if not id then
            return nil
        end
        return "Q", id
    end
    local id, addon, flagText = rest:match("^(%d+)|([^|]*)|([^|]*)")
    id = tonumber(id)
    if not id then
        return nil
    end
    local flags = {}
    for key, on in (flagText .. ","):gmatch("(%l+):([01]),") do
        flags[key] = on == "1"
    end
    return "R", id, addon, flags
end

-- Sending ---------------------------------------------------------------------------------------------------------

local queue, sending, held = {}, false, false
local warned = {}

local pump
local function resume()
    if held then
        held = false
        pump()
    end
end

pump = function()
    while queue[1] do
        local ch = channel()
        if not ch then
            wipe(queue) -- left the group: no one to send to
            break
        end
        local ok, result = pcall(C_ChatInfo.SendAddonMessage, Check.PREFIX, queue[1], ch)
        if ok and (result == THROTTLED or result == CHANNEL_THROTTLED) then
            C_Timer.After(1, pump)
            return
        elseif ok and result == LOCKDOWN then
            if not held then
                held = true
                C_Timer.After(LOCKDOWN_RETRY, resume)
            end
            return
        elseif not ok or not (result == nil or result == true or result == SUCCESS) then
            local key = tostring(ok and result or "error")
            if not warned[key] then
                warned[key] = true
                CRT:Print("Addon check: a message could not be sent (" .. key .. ").")
            end
        end
        table.remove(queue, 1)
    end
    sending = false
end

local function send(text)
    if not channel() then
        return false
    end
    queue[#queue + 1] = text
    if not sending and not held then
        sending = true
        pump()
    end
    return true
end

-- True while the game holds addon messages (an encounter's lockdown).
local function chatLocked()
    if C_ChatInfo and C_ChatInfo.InChatMessagingLockdown then
        local ok, locked = pcall(C_ChatInfo.InChatMessagingLockdown)
        return ok and readable(locked) and locked == true
    end
    return held
end

-- Answering --------------------------------------------------------------------------------------------------------

local lastReply, replyWaiting, combatWaiting = nil, false, false
local pendingAsk = 0 -- the id of the newest ask waiting for an answer

local function reply()
    if not channel() then
        return
    end
    if InCombatLockdown() then
        combatWaiting = true -- answered when combat ends
        return
    end
    local wait = lastReply and (lastReply + Check.REPLY_WINDOW - now()) or 0
    if wait > 0 then
        if not replyWaiting then
            replyWaiting = true
            C_Timer.After(wait, function()
                replyWaiting = false
                reply()
            end)
        end
        return
    end
    lastReply = now()
    send(Check.EncodeReply(pendingAsk, Check.VersionText(), Check:Mine()))
end

-- Asking ------------------------------------------------------------------------------------------------------------

local asked = nil -- { at, id, wait } of your last ask, nil before the first or after leaving the group
local nextAsk = 0

-- Asks for hellos too, through Team's send path, when Team can send (a raid group). True when asked.
local function askHellos()
    local Team = CRT.Team
    if not (Team and Team.Request and Team.CanSend and Team.CanSend()) then
        return false
    end
    local ok = pcall(Team.Request, true)
    return ok
end

-- Seconds after the last ask before a member with no answer is No CRT.
local function window()
    return asked and asked.wait or Check.WINDOW
end

-- Whether a check can go now: true, or false and why ("group": not in a group, "lockdown": an encounter's
-- message lockdown, "gap": asked less than ASK_GAP ago).
function Check:CanCheck()
    if not channel() then
        return false, "group"
    end
    if chatLocked() then
        return false, "lockdown"
    end
    if asked and now() - asked.at < self.ASK_GAP then
        return false, "gap"
    end
    return true
end

-- Asks the group. Returns true when the ask was queued, else false and the reason CanCheck gives.
function Check:Check()
    local ok, why = self:CanCheck()
    if not ok then
        return false, why
    end
    nextAsk = nextAsk + 1
    asked = { at = now(), id = nextAsk, wait = self.WINDOW }
    send(Check.EncodeAsk(nextAsk))
    if askHellos() then
        asked.wait = math.max(self.WINDOW, self.HELLO_WINDOW)
    end
    fire("ask")
    local id = nextAsk
    -- the window closes: members with no answer turn to No CRT
    C_Timer.After(asked.wait, function()
        if asked and asked.id == id then
            fire("window")
        end
    end)
    return true
end

-- Asks again only when there was no ask, or the last one is STALE seconds old (the tab's open).
function Check:MaybeCheck()
    if asked and now() - asked.at < self.STALE then
        return false
    end
    return (self:Check())
end

-- When the last ask went, in GetTime seconds, or nil.
function Check:AskedAt()
    return asked and asked.at or nil
end

-- Receiving --------------------------------------------------------------------------------------------------------

function Check:Receive(text, sender)
    local key = self.Key(sender)
    if not key then
        return
    end
    local kind, id, addon, flags = self.Decode(text)
    if not kind then
        return
    end
    if kind == "Q" then
        if key == me() then
            return -- your own ask: your row reads your own switches
        end
        pendingAsk = id
        reply()
        return
    end
    if key == me() then
        return
    end
    self.replies[key] = { version = addon, modules = flags, at = now() }
    fire("reply")
end

-- The roster ---------------------------------------------------------------------------------------------------------

-- The group as rows: { key, name (your own realm left off, another realm kept, as Raid Groups shows names), full
-- (the name as the game gave it, for a whisper), class (file name), online, me, subgroup }, you first, then roster
-- order. Solo, only you.
function Check:Roster()
    local out, mine = {}, me()
    local function add(name, classFile, online, subgroup)
        local key = self.Key(name)
        if not key then
            return
        end
        local full = name
        if Ambiguate then
            name = Ambiguate(name, "none")
        end
        local row = { key = key, name = name, full = full, class = readable(classFile) and classFile or nil, online = online and true or false, me = key == mine, subgroup = subgroup or 1 }
        if row.me then
            table.insert(out, 1, row)
        else
            out[#out + 1] = row
        end
    end
    if IsInRaid() then
        for i = 1, math.min(GetNumGroupMembers(), self.MAX_RAID) do
            local name, _, subgroup, _, _, classFile, _, online = GetRaidRosterInfo(i)
            if readable(name) and type(name) == "string" then
                add(name, classFile, readable(online) and online, readable(subgroup) and subgroup or 1)
            end
        end
    else
        local units = { "player" }
        if IsInGroup() then
            for i = 1, GetNumSubgroupMembers() do
                units[#units + 1] = "party" .. i
            end
        end
        for _, unit in ipairs(units) do
            local name, realm = UnitFullName(unit)
            if readable(name) and type(name) == "string" then
                if readable(realm) and type(realm) == "string" and realm ~= "" then
                    name = name .. "-" .. realm
                end
                local _, classFile = UnitClass(unit)
                local online = unit == "player" or (UnitIsConnected and UnitIsConnected(unit)) or false
                add(name, classFile, online, 1)
            end
        end
    end
    return out
end

-- The addon version of a member's last hello (Team.lua), or nil.
local function helloVersion(key)
    local Team = CRT.Team
    if not (Team and Team.VersionOf) then
        return nil
    end
    local ok, version = pcall(Team.VersionOf, Team, key)
    return ok and type(version) == "string" and version ~= "" and version or nil
end

-- A member's standing: state, version, modules (key -> true or false, nil for a module their CRT doesn't report),
-- helloOnly (true when the version came from a hello: a CRT too old to answer the ask, which reports no modules).
--   "you"      yourself: your version and your own switches, never waited for
--   "same"     the same version as yours; "newer" a later one; "older" an earlier one
--   "waiting"  no answer yet, inside the window after the last ask (or before any ask)
--   "none"     no answer to the ask and no hello within the window: No CRT
--   "offline"  the member is offline (when the row says so), never asked
function Check:Status(name, online)
    local key = type(name) == "table" and name.key or self.Key(name)
    if not key then
        return "waiting"
    end
    if key == me() then
        return "you", self.VersionText(), self:Mine()
    end
    if online == false then
        return "offline"
    end
    local r = self.replies[key]
    local version, modules, helloOnly
    if r then
        version, modules = r.version, r.modules
    else
        version = helloVersion(key)
        helloOnly = version ~= nil or nil
    end
    if version then
        local c = self.CompareVersions(version, self.VersionText())
        return (c < 0 and "older") or (c > 0 and "newer") or "same", version, modules, helloOnly
    end
    if asked and now() - asked.at >= window() then
        return "none"
    end
    return "waiting"
end

-- The roster with each row's state, version, modules and helloOnly filled in.
function Check:Rows()
    local rows = self:Roster()
    for _, row in ipairs(rows) do
        row.state, row.version, row.modules, row.helloOnly = self:Status(row, row.online)
    end
    return rows
end

-- The rows that pass the tab's filters. module is a registered key or nil (any); show is "all", "nocrt" (no
-- answer), "older", "on" or "off" (the module on or off; off includes a CRT too old to report it). on and off
-- need a module; without one they show everyone.
function Check.Filter(rows, module, show)
    local out = {}
    for _, row in ipairs(rows) do
        local keep = true
        if show == "nocrt" then
            keep = row.state == "none"
        elseif show == "older" then
            keep = row.state == "older"
        elseif (show == "on" or show == "off") and module then
            local has = row.modules and row.modules[module] == true
            local answered = row.state == "you" or row.state == "same" or row.state == "older" or row.state == "newer"
            keep = answered and ((show == "on") == has)
        end
        if keep then
            out[#out + 1] = row
        end
    end
    return out
end

-- How many rows are in each state: { total, same, older, newer, none, waiting, offline }; you count as same.
function Check.Counts(rows)
    local c = { total = #rows, same = 0, older = 0, newer = 0, none = 0, waiting = 0, offline = 0 }
    for _, row in ipairs(rows) do
        local s = row.state == "you" and "same" or row.state
        if c[s] then
            c[s] = c[s] + 1
        end
    end
    return c
end

function Check:OnChange(fn)
    self.listeners[#self.listeners + 1] = fn
end

-- Announcing ----------------------------------------------------------------------------------------------------------

-- Announce posts who is missing CRT or on an older version where Announce to says (only you, the group channel,
-- a raid warning or officer chat; CRTDB.addonCheck.announceTo, never in Export settings only), through the raid
-- report's output (ReadyCheck/Report.lua, which prefixes "[CRT] " and splits long lines, as Tattlebot's posts
-- go); a click on a No CRT or older row whispers that player. Names follow Leave realm names out
-- (Groups.ReportName). Nothing posts by itself.

Check.URL = "https://www.curseforge.com/wow/addons/cowfee-raid-tools"
Check.TEXT = {
    missing = "Missing Cowfee Raid Tools: %s.",
    older = "Older version: %s.",
    get = "Get it: %s",
    everyone = "Everyone in the %s runs Cowfee Raid Tools %s.",
    raid = "raid",
    party = "party",
    whisperMissing = "[CRT] You're missing Cowfee Raid Tools, which the %s uses for its notes, alerts and plans. Get it: %s",
    whisperOlder = "[CRT] Your Cowfee Raid Tools is %s; the %s is on %s. Update it: %s",
    notSent = "Addon check: the whisper to %s could not be sent.",
    helloOnly = "This version can't report its modules. Modules show once they update.",
}

local function reportName(row)
    if CRT.Groups and CRT.Groups.ReportName then
        return CRT.Groups.ReportName(row.full or row.name)
    end
    return row.name
end

local function groupWord()
    return IsInRaid() and Check.TEXT.raid or Check.TEXT.party
end

-- The lines Announce posts, from rows (Rows()): the missing names and the older ones with their version, then the
-- link on a line of its own; or one line that everyone runs it. Offline and waiting members are left out.
function Check.AnnounceLines(rows, version)
    local missing, older = {}, {}
    for _, row in ipairs(rows) do
        if row.state == "none" then
            missing[#missing + 1] = reportName(row)
        elseif row.state == "older" then
            older[#older + 1] = reportName(row) .. " (" .. tostring(row.version) .. ")"
        end
    end
    if #missing == 0 and #older == 0 then
        return { Check.TEXT.everyone:format(groupWord(), tostring(version or Check.VersionText())) }
    end
    local parts = {}
    if #missing > 0 then
        parts[#parts + 1] = Check.TEXT.missing:format(table.concat(missing, ", "))
    end
    if #older > 0 then
        parts[#parts + 1] = Check.TEXT.older:format(table.concat(older, ", "))
    end
    return { table.concat(parts, " "), Check.TEXT.get:format(Check.URL) }
end

-- Where Announce posts (CRTDB.addonCheck.announceTo), the raid report's outputs plus a raid warning: the keys
-- ReadyCheck/Report.lua's Output takes.
Check.OUTPUTS = {
    { key = "self", label = "Only me" },
    { key = "raid", label = "Raid chat" },
    { key = "warning", label = "Raid warning" },
    { key = "officer", label = "Officer chat" },
}

function Check:AnnounceTo()
    local s = CRT.db and CRT.db.addonCheck
    local key = s and s.announceTo
    for _, o in ipairs(self.OUTPUTS) do
        if o.key == key then
            return key
        end
    end
    return "raid"
end

function Check:SetAnnounceTo(key)
    if CRT.db and CRT.db.addonCheck then
        CRT.db.addonCheck.announceTo = key
    end
end

-- Whether Announce can post now: true, or false and why ("group": not in a group, "check": no check has run, or
-- its window is still open, so an answer may still come, "lead": a raid warning needs the raid leader or an
-- assistant in a raid, "officer": you can't speak in officer chat).
function Check:CanAnnounce()
    if not channel() then
        return false, "group"
    end
    if not asked or now() - asked.at < window() then
        return false, "check"
    end
    local to = self:AnnounceTo()
    if to == "warning" and CRT.RaidReport and CRT.RaidReport.CanWarn and not CRT.RaidReport.CanWarn() then
        return false, "lead"
    end
    if to == "officer" and CRT.GearChecker and CRT.GearChecker.CanOfficer and not CRT.GearChecker.CanOfficer() then
        return false, "officer"
    end
    return true
end

-- Posts the announcement where Announce to says. Returns the lines, or nil and why not.
function Check:Announce()
    local ok, why = self:CanAnnounce()
    if not ok then
        return nil, why
    end
    local lines = self.AnnounceLines(self:Rows())
    if CRT.RaidReport and CRT.RaidReport.Output then
        CRT.RaidReport:Output(lines, self:AnnounceTo())
    else
        for _, line in ipairs(lines) do
            CRT:Print(line)
        end
    end
    return lines
end

-- The whisper for a No CRT or older row, or nil for any other.
function Check.WhisperText(row, version)
    version = tostring(version or Check.VersionText())
    if row.state == "none" then
        return Check.TEXT.whisperMissing:format(groupWord(), Check.URL)
    elseif row.state == "older" then
        return Check.TEXT.whisperOlder:format(tostring(row.version), groupWord(), version, Check.URL)
    end
    return nil
end

-- Whispers the row's player (a chat whisper takes Name-Realm with no space in the realm). Returns true when sent.
function Check:Whisper(row)
    local text = self.WhisperText(row)
    local send = (C_ChatInfo and C_ChatInfo.SendChatMessage) or SendChatMessage
    if not text or not send or type(row.full) ~= "string" then
        return false
    end
    local target = (row.full:gsub("%s", ""))
    local ok = pcall(send, text, "WHISPER", nil, target)
    if not ok then
        CRT:Print(Check.TEXT.notSent:format(row.name))
    end
    return ok
end

-- Events ---------------------------------------------------------------------------------------------------------------

-- Drops answers from members no longer in the group; out of a group, everything, the last ask too.
local function prune()
    if not channel() then
        wipe(Check.replies)
        asked = nil
        wipe(queue)
        sending, held = false, false
        fire("roster")
        return
    end
    local keep = {}
    for _, row in ipairs(Check:Roster()) do
        keep[row.key] = true
    end
    for key in pairs(Check.replies) do
        if not keep[key] then
            Check.replies[key] = nil
        end
    end
    fire("roster")
end

function Check:OnEvent(event, prefix, text, _, sender)
    if event == "CHAT_MSG_ADDON" then
        if prefix == self.PREFIX then
            self:Receive(text, sender)
        end
    elseif event == "GROUP_ROSTER_UPDATE" or event == "GROUP_LEFT" then
        prune()
    elseif event == "PLAYER_REGEN_ENABLED" then
        if combatWaiting then
            combatWaiting = false
            reply()
        end
    end
end

local events = CreateFrame("Frame")
events:RegisterEvent("CHAT_MSG_ADDON")
events:RegisterEvent("GROUP_ROSTER_UPDATE")
events:RegisterEvent("GROUP_LEFT")
events:RegisterEvent("PLAYER_REGEN_ENABLED")
events:SetScript("OnEvent", function(_, ...)
    Check:OnEvent(...)
end)
