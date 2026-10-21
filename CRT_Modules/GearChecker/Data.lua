local ADDON, CRT = ...

-- Gear Checker: every group member's equipped gear, with missing enchants, empty sockets and low items.
-- This file has the rules and the rows, no frames. Gear comes only from CRT.Gear: yours from Gear:MineAll,
-- everyone else's from what Comm.lua (their CRT's reply) or Inspect.lua (the game's inspect) handed to
-- Gear:Remember. Which slots take an enchant and where sockets count are season data (the season's
-- Season.lua, gearChecks), read through CRT.Bosses:GearChecks(); nothing here names a slot rule.
--
--   GC:Rules()                   the season's rules as sets by slot
--   GC.CheckSlot(slot, piece, rules, avg)   one slot's findings: missing enchant, empty sockets, low
--   GC:Roster()                  the group: { name, unit, class, me }, you first
--   GC:Row(member), GC:Rows(filter)   a member's checked gear; the rows a filter shows
--   GC.SlotLine, GC.WhisperLines, GC.RaidLines, GC.ChatBoxText   a row's issues as chat text
--   GC.Say(lines, chatType, target)   sends lines to chat, only from a click; prints what can't go
--   GC:OnChange(fn), GC:Fire()   the page redraws when gear arrives
--
-- Game calls (warcraft.wiki.gg and Blizzard's UI source, live, read 2026-10-20): UnitFullName, UnitClass,
-- UnitIsUnit, IsInRaid, GetNumGroupMembers, GetNumSubgroupMembers; C_Item.GetItemInfo(item) (its second
-- return is the link, once the item is loaded) and C_Item.RequestLoadItemDataByID; C_ChatInfo.SendChatMessage
-- (message, chatType, languageID, target), else the global SendChatMessage, and
-- C_ChatInfo.InChatMessagingLockdown. Each in pcall; secret values are never compared.

local Gear = CRT.Gear
local GC = { listeners = {} }
CRT.GearChecker = GC

GC.LOW_ILVL = 12 -- an item this many item levels or more under the player's average is low
GC.SOURCE_REPLY, GC.SOURCE_INSPECT = "gearcheck", "inspect" -- how a player's gear reached Gear:Remember

GC.FILTERS = {
    { key = "all", label = "Everyone" },
    { key = "issues", label = "Only issues" },
    { key = "gems", label = "Missing gems" },
    { key = "enchants", label = "Missing enchants" },
}

GC.TEXT = {
    missingEnchant = "missing enchant",
    missingGem = "missing gem",
    missingGems = "missing %d gems",
    low = "low item level",
    line = "[%s] %s %s %s - %s", -- name, slot, item link, item level, what is wrong
    whisper = "Gear check: %s %s %s - %s", -- slot, item link, item level, what is wrong
    more = "(+%d more)",
    locked = "Chat is locked during the boss encounter.",
    notSent = "Gear Checker (only you see this): %s",
    item = "[item %d]",
}

local function secret(v)
    return issecretvalue and issecretvalue(v) or false
end

function GC:Settings()
    return CRT.db.gearChecker
end

-- Change listeners --------------------------------------------------------------------------------------

function GC:OnChange(fn)
    self.listeners[#self.listeners + 1] = fn
end

function GC:Fire(what)
    for _, fn in ipairs(self.listeners) do
        local ok, err = pcall(fn, what)
        if not ok and geterrorhandler then
            geterrorhandler()(err)
        end
    end
end

if Gear and Gear.OnChange then
    Gear:OnChange(function()
        GC:Fire("mine")
    end)
end

-- The rules -----------------------------------------------------------------------------------------------

-- A season's slot list as a set; true is every slot.
local function slotSet(list)
    local out = {}
    if list == true then
        for _, s in ipairs(Gear.SLOTS) do
            out[s.id] = true
        end
    elseif type(list) == "table" then
        for _, id in ipairs(list) do
            if Gear.Slot(id) then
                out[id] = true
            end
        end
    end
    return out
end

-- The season's rules: { enchant = { [slot] = true }, weaponOnly = { [slot] = true }, sockets = { [slot] =
-- true } }. A season with none checks nothing but item levels.
function GC:Rules()
    local src = CRT.Bosses and CRT.Bosses.GearChecks and CRT.Bosses:GearChecks() or nil
    if self.rulesOf ~= src or not self.rules then
        local def = type(src) == "table" and src or {}
        self.rules = { enchant = slotSet(def.enchant), weaponOnly = slotSet(def.enchantWeaponOnly), sockets = slotSet(def.sockets) }
        self.rulesOf = src -- worked out again only when the season's table changes
    end
    return self.rules
end

-- One slot's findings for a piece (nil for an empty slot), given the rules and the player's average item
-- level: { slot, piece, empty, needsEnchant, missingEnchant, sockets, gems, emptySockets, low, issues }.
-- A piece known only by its ID (no item string) can't show an enchant or gems, so it is never flagged for
-- them; a socket count the game can't give is no finding.
function GC.CheckSlot(slot, piece, rules, avg)
    local r = { slot = slot, piece = piece, issues = 0, gems = 0, sockets = 0, emptySockets = 0 }
    if type(piece) ~= "table" then
        r.empty = true
        return r
    end
    local parts = Gear.Parts(piece.itemString or piece.link)
    if rules.enchant[slot] and (not rules.weaponOnly[slot] or Gear.IsWeapon(Gear.EquipLoc(piece))) then
        r.needsEnchant = true
        if parts and not parts.enchant then
            r.missingEnchant = true
            r.issues = r.issues + 1
        end
    end
    if parts then
        r.gems = parts.gemCount
        if rules.sockets[slot] then
            local n = Gear.Sockets(piece.itemString or piece.link)
            if n then
                r.sockets = math.max(n, r.gems)
                r.emptySockets = math.max(0, n - r.gems)
                r.issues = r.issues + r.emptySockets
            end
        end
    end
    local ilvl = type(piece.ilvl) == "number" and not secret(piece.ilvl) and piece.ilvl or nil
    if ilvl and avg and ilvl <= avg - GC.LOW_ILVL then
        r.low = true
        r.issues = r.issues + 1
    end
    return r
end

-- What is wrong with a slot, in words ("missing enchant, missing 2 gems"), or nil.
function GC.Problems(r)
    local words = {}
    if r.missingEnchant then
        words[#words + 1] = GC.TEXT.missingEnchant
    end
    if r.emptySockets == 1 then
        words[#words + 1] = GC.TEXT.missingGem
    elseif r.emptySockets > 1 then
        words[#words + 1] = string.format(GC.TEXT.missingGems, r.emptySockets)
    end
    if r.low then
        words[#words + 1] = GC.TEXT.low
    end
    return #words > 0 and table.concat(words, ", ") or nil
end

-- The group ------------------------------------------------------------------------------------------------

local function fullName(unit)
    local ok, name, realm = pcall(UnitFullName, unit)
    if not ok or secret(name) or type(name) ~= "string" or name == "" then
        return nil
    end
    if secret(realm) or type(realm) ~= "string" or realm == "" then
        realm = GetNormalizedRealmName and GetNormalizedRealmName() or ""
    end
    return realm ~= "" and (name .. "-" .. realm) or name
end
GC.FullName = fullName

local function classOf(unit)
    local ok, _, file = pcall(UnitClass, unit)
    if ok and not secret(file) and type(file) == "string" then
        return file
    end
    return nil
end

local function isMe(unit)
    if unit == "player" then
        return true
    end
    local ok, same = pcall(UnitIsUnit, unit, "player")
    return ok and same == true
end

-- Everyone in the group, you first, then in the group's order: { name (full Name-Realm), unit, class, me }.
-- Out of a group, only you.
function GC:Roster()
    local me = { name = fullName("player"), unit = "player", class = classOf("player"), me = true }
    local out = { me }
    local units = {}
    if IsInRaid() then
        for i = 1, GetNumGroupMembers() do
            units[#units + 1] = "raid" .. i
        end
    elseif IsInGroup() then
        for i = 1, GetNumSubgroupMembers() do
            units[#units + 1] = "party" .. i
        end
    end
    for _, unit in ipairs(units) do
        local name = fullName(unit)
        if name and not isMe(unit) and name ~= me.name then
            out[#out + 1] = { name = name, unit = unit, class = classOf(unit) }
        end
    end
    return out
end

-- The unit token of a group member by full name, or nil.
function GC:UnitOf(name)
    for _, m in ipairs(self:Roster()) do
        if m.name == name then
            return m.unit
        end
    end
    return nil
end

-- Rows -------------------------------------------------------------------------------------------------------

-- A member's row: { name, unit, class, me, seen, source, at, avg, pieces, slots = { [slot] = findings },
-- issues, missingGems, missingEnchants }. seen is false for a player whose gear hasn't arrived yet.
function GC:Row(m)
    local pieces = m.me and Gear:MineAll() or Gear:OfAll(m.name)
    local at, source = Gear:When(m.name)
    local row = { name = m.name, unit = m.unit, class = m.class, me = m.me, at = at, source = m.me and "mine" or source,
        pieces = pieces, slots = {}, issues = 0, missingGems = 0, missingEnchants = 0 }
    row.seen = m.me and true or at ~= nil
    row.avg = Gear.AverageLevel(pieces)
    local by = {}
    for _, p in ipairs(pieces) do
        by[p.slot] = p
        if p.id and not p.link and C_Item and C_Item.RequestLoadItemDataByID then
            pcall(C_Item.RequestLoadItemDataByID, p.id) -- so its link is ready for chat
        end
    end
    local rules = self:Rules()
    for _, s in ipairs(Gear.SLOTS) do
        local r = self.CheckSlot(s.id, by[s.id], rules, row.avg)
        row.slots[s.id] = r
        row.issues = row.issues + r.issues
        row.missingGems = row.missingGems + r.emptySockets
        row.missingEnchants = row.missingEnchants + (r.missingEnchant and 1 or 0)
    end
    return row
end

-- Whether a filter (GC.FILTERS) shows a row. A player not seen yet shows only under Everyone.
function GC.Passes(row, filter)
    if filter == "issues" then
        return row.issues > 0
    elseif filter == "gems" then
        return row.missingGems > 0
    elseif filter == "enchants" then
        return row.missingEnchants > 0
    end
    return true
end

function GC:Rows(filter)
    local out = {}
    for _, m in ipairs(self:Roster()) do
        local row = self:Row(m)
        if self.Passes(row, filter) then
            out[#out + 1] = row
        end
    end
    return out
end

-- Chat text ----------------------------------------------------------------------------------------------------

-- A piece's chat link: its own link (yours), the game's link for its item string once loaded, else
-- "[item <id>]".
function GC.ItemLink(piece)
    if type(piece.link) == "string" and not secret(piece.link) then
        return piece.link
    end
    if piece.itemString and C_Item and C_Item.GetItemInfo then
        local ok, _, link = pcall(C_Item.GetItemInfo, piece.itemString)
        if ok and type(link) == "string" and not secret(link) then
            return link
        end
    end
    return string.format(GC.TEXT.item, piece.id or 0)
end

local function shortName(name)
    if Ambiguate then
        return Ambiguate(name or "", "short")
    end
    return (tostring(name or ""):gsub("%-.*$", ""))
end

local function slotName(slot)
    local s = Gear.Slot(slot)
    return s and s.name or tostring(slot)
end

-- The shift-click text for one slot: "[Name] Head [item] 285 - missing enchant", or nil when it has no issue.
function GC.SlotLine(row, r)
    local problems = GC.Problems(r)
    if not (problems and r.piece) then
        return nil
    end
    return string.format(GC.TEXT.line, shortName(row.name), slotName(r.slot), GC.ItemLink(r.piece), tostring(r.piece.ilvl or "?"), problems)
end

local function eachIssue(row, fn)
    local out = {}
    for _, s in ipairs(Gear.SLOTS) do
        local r = row.slots[s.id]
        local problems = r and r.piece and GC.Problems(r)
        if problems then
            out[#out + 1] = fn(r, problems)
        end
    end
    return out
end

-- The lines whispered to the player: one per slot with an issue.
function GC.WhisperLines(row)
    return eachIssue(row, function(r, problems)
        return string.format(GC.TEXT.whisper, slotName(r.slot), GC.ItemLink(r.piece), tostring(r.piece.ilvl or "?"), problems)
    end)
end

-- The lines posted to raid chat: the shift-click line of each slot with an issue.
function GC.RaidLines(row)
    return eachIssue(row, function(r)
        return GC.SlotLine(row, r)
    end)
end

GC.CHAT_MAX = 255 -- bytes a chat message may hold

-- One line for the chat box, to edit before sending: the slot lines joined, as many as fit in a message,
-- then how many were left out.
function GC.ChatBoxText(row)
    local lines = GC.RaidLines(row)
    local text = ""
    for i, line in ipairs(lines) do
        local candidate = text == "" and line or (text .. " " .. line)
        local tail = i < #lines and (" " .. string.format(GC.TEXT.more, #lines - i)) or ""
        if #candidate + #tail > GC.CHAT_MAX and text ~= "" then
            return text .. " " .. string.format(GC.TEXT.more, #lines - i + 1)
        end
        text = candidate
    end
    return text
end

-- Chat ------------------------------------------------------------------------------------------------------------

-- Lines to a chat type (and a whisper's target), only ever from a click. While the game holds chat (a boss
-- encounter's lockdown) or a send fails, the lines are shown to you instead, with red error text.
local function chatLocked()
    if C_ChatInfo and C_ChatInfo.InChatMessagingLockdown then
        local ok, locked = pcall(C_ChatInfo.InChatMessagingLockdown)
        return ok and locked == true
    end
    return false
end

local function showError(text)
    if UIErrorsFrame and UIErrorsFrame.AddMessage then
        pcall(UIErrorsFrame.AddMessage, UIErrorsFrame, text, 1, 0.1, 0.1)
    end
end

function GC.Say(lines, chatType, target)
    local send = (C_ChatInfo and C_ChatInfo.SendChatMessage) or SendChatMessage
    local locked = chatLocked()
    if locked then
        showError(GC.TEXT.locked)
    end
    local sent = 0
    for _, line in ipairs(lines) do
        local ok = not locked and send and pcall(send, line, chatType, nil, target)
        if ok then
            sent = sent + 1
        else
            CRT:Print(string.format(GC.TEXT.notSent, line))
        end
    end
    return sent
end

-- The group channel for chat posts, or nil out of a group.
function GC.GroupChat()
    if IsInGroup(LE_PARTY_CATEGORY_INSTANCE) then
        return "INSTANCE_CHAT"
    elseif IsInRaid() then
        return "RAID"
    elseif IsInGroup() then
        return "PARTY"
    end
    return nil
end
