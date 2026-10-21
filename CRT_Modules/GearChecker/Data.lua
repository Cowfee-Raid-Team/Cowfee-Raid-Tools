local ADDON, CRT = ...

-- Gear Checker: every group member's equipped gear, with missing enchants, empty sockets and low items.
-- This file has the rules and the rows, no frames. Gear comes only from CRT.Gear: yours from Gear:MineAll,
-- everyone else's from what Comm.lua (their CRT's reply) or Inspect.lua (the game's inspect) handed to
-- Gear:Remember. Which slots take an enchant, where sockets count and the season's own checks are season
-- data (the season pack's GearChecks.lua), read through CRT.Bosses:GearChecks(); the upgrade tracks and
-- the bonus IDs that set them are the pack's Tracks.lua, read through CRT.Bosses:Tracks(). Nothing here
-- names a slot rule, a track or a season item.
--
--   GC:Rules()                   the season's rules as sets by slot, and its usable checks
--   GC:SeasonChecks(), GC:Filters(), GC:FilterKey(saved)   the season checks; the chips' filters, a check's last
--   GC.CheckTrips(check, piece, parts), GC.TopCheck(findings)   one check on one piece; a cell's tag
--   GC:Tracks(), GC.TrackOf(parts), GC:BelowTrack(), GC:BelowChoices()   the season's upgrade tracks; a
--                                piece's track and rank from its bonus IDs; the Below chip's track and choices
--   GC.TrackTag, GC.TrackWords, GC.TrackColor, GC.TrackCounts(row), GC.TrackText(row, colored, keep)   a
--                                track as "H4", "Hero 4/6", its colour; a row's pieces per track;
--                                the Tracks column ("3M 3H")
--   GC.CheckSlot(slot, piece, rules, avg)   one slot's findings: missing enchant, empty sockets, low
--   GC:Roster()                  the group: { name, unit, class, me }, you first
--   GC:Row(member), GC:Rows(filter)   a member's checked gear; the rows a filter shows
--   GC.PartsOf(piece)            Gear.Parts of a piece, nil when it is known only by its ID
--   GC.CellShows(findings, filter, row)   whether a filter draws a slot's cell (issue filters: only problem cells)
--   GC.SlotLine, GC.WhisperLines, GC.RaidLines, GC.ChatBoxText   a row's issues as chat text
--   GC.IssueLines(row), GC.NoteLines(row)   the issues badge's tooltip: a line per issue, red or orange; and
--                                its Not an issue part (info checks, items below the Below track)
--
-- Info checks (severity info) and items below the Below track are to know, not to fix: they never count in
-- Issues, never show under Only issues and never go to chat.
--   GC.SendTargets(row), GC.Send(row, target)   where a row's issues can go (the menu), and sending them
--   GC.Say(lines, chatType, target)   sends lines to chat, only from a click; prints what can't go
--   GC.ToChatBox(text), GC.OpenChat(text)   text into the chat box, to edit and send
--   GC:OnChange(fn), GC:Fire()   the page redraws when gear arrives
--
-- Game calls (warcraft.wiki.gg and Blizzard's UI source, live, read 2026-10-20 and 2026-10-21): UnitFullName,
-- UnitClass, UnitIsUnit, IsInRaid, GetNumGroupMembers, GetNumSubgroupMembers; C_Item.GetItemInfo(item) (its
-- second return is the link, once the item is loaded) and C_Item.RequestLoadItemDataByID;
-- C_ChatInfo.SendChatMessage(message, chatType, languageID, target), else the global SendChatMessage (SAY and
-- YELL need a hardware event in the open world, CHANNEL always), and C_ChatInfo.InChatMessagingLockdown;
-- IsInInstance; IsInGuild, C_GuildInfo.CanSpeakInGuildChat, GetGuildInfo("player") (rank index from 0) and
-- C_GuildInfo.GuildControlGetRankFlags(rankOrder from 1) (index 4, Officerchat Speak); ChatFrameUtil.OpenChat,
-- .GetActiveWindow and .InsertLink (the older ChatFrame_OpenChat, ChatEdit_GetActiveWindow and
-- ChatEdit_InsertLink as fallbacks); the chat box reads a leading "/s " as Say when Enter sends it
-- (ChatFrameEditBox's SendText parses it). Each in pcall; secret values are never compared.

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
    low = "%d item levels under average",
    require = "%s: %d of %d worn", -- a season check's label, how many are worn, how many it needs
    rowLine = "[%s] %s", -- name, a row's issue
    rowWhisper = "Gear check: %s", -- a row's issue
    line = "[%s] %s %s %s - %s", -- name, slot, item link, item level, what is wrong
    whisper = "Gear check: %s %s %s - %s", -- slot, item link, item level, what is wrong
    more = "(+%d more)",
    locked = "Chat is locked during the boss encounter.",
    notSent = "Gear Checker (only you see this): %s",
    item = "[item %d]",
    trackRank = "%s %d/%d", -- a track's label, the rank, the track's last rank
    trackRankOnly = "%s %d",
    below = "Below %s", -- the Below chip, with the picked track's label
    belowHelp = "Shows who wears an item below the track you pick. Click it to see only those items, and click its arrow to pick the track.",
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

-- Season checks: the season's own gear checks (its gearChecks.checks), each { key, label, help, kind, ids,
-- severity, slots, require }. The engine knows only the kinds, never a season's items:
--   itemIds       an equipped item is one of ids
--   bonusIds      an item carries one of ids as a bonus ID (Gear.Parts)
--   enchantIds    a slot's enchant is not one of ids (a slot with no enchant is the enchant rule's issue)
--   missingBonus  an item carries none of ids as a bonus ID (needs the item string, so an ID-only piece
--                 is never flagged)
-- severity is bad (the default), low or info (to know, not to fix: never an issue, only its own chip and a
-- Not an issue line); slots defaults to every slot. require (itemIds and bonusIds):
-- fewer than that many matching slots is one issue on the row, instead of an issue per match.
GC.CHECK_KINDS = { itemIds = true, bonusIds = true, enchantIds = true, missingBonus = true }
GC.COUNTING_KINDS = { itemIds = true, bonusIds = true } -- the kinds require works with
GC.SEVERITY = { bad = 3, low = 2, info = 1 } -- the most severe one tags a cell
GC.CHECK_FILTER = "check:" -- a check's filter key is this and its key

-- The usable checks of a season's list: a known kind, a key (each once) and at least one ID. A check written
-- with no IDs yet is left out, so it has no filter chip until its IDs are filled in.
local function checkList(list)
    local out, seen = {}, {}
    for _, c in ipairs(type(list) == "table" and list or {}) do
        local ids = {}
        for _, id in ipairs(type(c) == "table" and type(c.ids) == "table" and c.ids or {}) do
            if type(id) == "number" then
                ids[id] = true
            end
        end
        if type(c) == "table" and type(c.key) == "string" and not seen[c.key] and GC.CHECK_KINDS[c.kind] and next(ids) then
            seen[c.key] = true
            local need = GC.COUNTING_KINDS[c.kind] and tonumber(c.require) or nil
            out[#out + 1] = {
                key = c.key, label = type(c.label) == "string" and c.label or c.key, help = c.help, kind = c.kind, ids = ids,
                severity = GC.SEVERITY[c.severity] and c.severity or "bad",
                slots = slotSet(c.slots == nil and true or c.slots),
                require = need and need >= 1 and math.floor(need) or nil,
            }
        end
    end
    return out
end

-- The season's rules: { enchant = { [slot] = true }, weaponOnly = { [slot] = true }, sockets = { [slot] =
-- true }, checks = { season check, ... } }. A season with none checks nothing but item levels.
function GC:Rules()
    local src = CRT.Bosses and CRT.Bosses.GearChecks and CRT.Bosses:GearChecks() or nil
    if self.rulesOf ~= src or not self.rules then
        local def = type(src) == "table" and src or {}
        self.rules = { enchant = slotSet(def.enchant), weaponOnly = slotSet(def.enchantWeaponOnly), sockets = slotSet(def.sockets),
            checks = checkList(def.checks) }
        self.rulesOf = src -- worked out again only when the season's table changes
    end
    self.rules.tracks = self:Tracks() -- its own topic, so read each time (cached by GC:Tracks)
    return self.rules
end

-- The season's usable checks, in its order.
function GC:SeasonChecks()
    return self:Rules().checks
end

-- The filters in chip order: GC.FILTERS, then one per season check { key = "check:<key>", label, help, check }.
function GC:Filters()
    local out = {}
    for _, f in ipairs(GC.FILTERS) do
        out[#out + 1] = f
    end
    for _, c in ipairs(self:SeasonChecks()) do
        out[#out + 1] = { key = GC.CHECK_FILTER .. c.key, label = c.label, help = c.help, check = c }
    end
    local below = self:Tracks().usable and self:BelowTrack()
    if below then
        out[#out + 1] = { key = GC.BELOW, label = string.format(GC.TEXT.below, below.label), help = GC.TEXT.belowHelp, below = true }
    end
    return out
end

-- A saved filter that still exists, else "all" (a check the season no longer has).
function GC:FilterKey(key)
    for _, f in ipairs(self:Filters()) do
        if f.key == key then
            return key
        end
    end
    return "all"
end

-- Whether a season check trips on a piece (parts: Gear.Parts of it, nil for an ID-only piece). For a
-- counting check with require, a trip is a match to count, not an issue.
function GC.CheckTrips(c, piece, parts)
    if c.kind == "itemIds" then
        local id = parts and parts.id or (type(piece) == "table" and piece.id)
        return id ~= nil and c.ids[id] == true
    elseif not parts then
        return false
    elseif c.kind == "bonusIds" or c.kind == "missingBonus" then
        local carries = false
        for _, id in ipairs(parts.bonusIds or {}) do
            carries = carries or c.ids[id] == true
        end
        return carries == (c.kind == "bonusIds")
    elseif c.kind == "enchantIds" then
        return parts.enchant ~= nil and not c.ids[parts.enchant]
    end
    return false
end

-- The most severe season check on a slot's findings (its cell's tag), or nil.
function GC.TopCheck(r)
    local top
    for _, c in ipairs(type(r) == "table" and r.checks or {}) do
        if not top or GC.SEVERITY[c.severity] > GC.SEVERITY[top.severity] then
            top = c
        end
    end
    return top
end

-- Whether a season check is only to know about (info): never an issue.
function GC.IsNote(c)
    return c.severity == "info"
end

-- Upgrade tracks ----------------------------------------------------------------------------------------------

GC.BELOW = "below" -- the Below <track> chip's filter key

-- The season's tracks (its tracks topic), checked: { list = { track, ... } lowest first, each { key, label,
-- letter, quality, color, order }; byKey; bonus = { [bonus ID] = { track, rank, max } }; default (a key);
-- usable, true once a bonus ID is known; source, the season's own table }. A track with no key, or a bonus ID
-- on a track the list doesn't have, is left out. A season with none has an empty list.
function GC:Tracks()
    local src = CRT.Bosses and CRT.Bosses.Tracks and CRT.Bosses:Tracks() or nil
    if self.tracksOf ~= src or not self.tracks then
        local def = type(src) == "table" and src or {}
        local out = { list = {}, byKey = {}, bonus = {}, usable = false, source = def, default = def.default }
        for _, t in ipairs(type(def.list) == "table" and def.list or {}) do
            if type(t) == "table" and type(t.key) == "string" and not out.byKey[t.key] then
                local track = { key = t.key, label = type(t.label) == "string" and t.label or t.key,
                    letter = type(t.letter) == "string" and t.letter or t.key:sub(1, 1):upper(),
                    quality = tonumber(t.quality), color = type(t.color) == "table" and t.color or nil }
                out.list[#out.list + 1] = track
                track.order = #out.list
                out.byKey[t.key] = track
            end
        end
        for id, b in pairs(type(def.bonus) == "table" and def.bonus or {}) do
            local track = type(id) == "number" and type(b) == "table" and out.byKey[b.track]
            local rank = track and tonumber(b.rank)
            if rank then
                out.bonus[id] = { track = track, rank = math.floor(rank), max = tonumber(b.max) and math.floor(tonumber(b.max)) or nil }
                out.usable = true
            end
        end
        self.tracks, self.tracksOf = out, src -- worked out again only when the season's table changes
    end
    return self.tracks
end

-- A piece's track from its bonus IDs (parts: Gear.Parts of it): { track, rank, max }, or nil when none of its
-- bonus IDs is on the season's map, or the piece is known only by its ID (parts nil). Never from tooltip
-- text, which is in the client's language.
function GC.TrackOf(parts, tracks)
    if not parts then
        return nil
    end
    tracks = tracks or GC:Tracks()
    for _, id in ipairs(parts.bonusIds or {}) do
        if tracks.bonus[id] then
            return tracks.bonus[id]
        end
    end
    return nil
end

-- A cell's tag: the track's letter and the rank ("H4").
function GC.TrackTag(info)
    return info.track.letter .. info.rank
end

-- A track in words: "Champion 4/6" (or "Champion 4" when the map gives no last rank).
function GC.TrackWords(info)
    if info.max then
        return string.format(GC.TEXT.trackRank, info.track.label, info.rank, info.max)
    end
    return string.format(GC.TEXT.trackRankOnly, info.track.label, info.rank)
end

-- A track's colour: the game's colour for its item quality (Gear.QualityColor), else its own colour, else
-- white. The same in every theme: not a theme colour.
function GC.TrackColor(track)
    local r, g, b = Gear.QualityColor(type(track) == "table" and track.quality or nil)
    if r then
        return r, g, b
    end
    local own = type(track) == "table" and track.color
    if type(own) == "table" and own[1] then
        return own[1], own[2], own[3]
    end
    return 1, 1, 1
end

-- The track the Below chip lists items under: the saved one (CRTDB.gearChecker.belowTrack), else the
-- season's default, else its highest; nil with no tracks.
function GC:BelowTrack()
    local t = self:Tracks()
    local s = self:Settings()
    return (s and t.byKey[s.belowTrack]) or t.byKey[t.default] or t.list[#t.list]
end

-- The tracks the Below chip's menu offers: all but the lowest (nothing is below it).
function GC:BelowChoices()
    local out = {}
    for i, t in ipairs(self:Tracks().list) do
        if i > 1 then
            out[#out + 1] = t
        end
    end
    return out
end

-- A row's pieces per track, highest track first: { { track, n }, ... }, only the tracks it wears.
function GC.TrackCounts(row)
    local list, out = GC:Tracks().list, {}
    for i = #list, 1, -1 do
        local t = list[i]
        local n = row.trackCounts and row.trackCounts[t.key] or 0
        if n > 0 then
            out[#out + 1] = { track = t, n = n }
        end
    end
    return out
end

-- Text in a track's colour.
function GC.InTrackColor(track, text)
    local r, g, b = GC.TrackColor(track)
    return string.format("|cff%02x%02x%02x%s|r", math.floor(r * 255 + 0.5), math.floor(g * 255 + 0.5), math.floor(b * 255 + 0.5), text)
end

GC.TRACK_MORE = "+" -- after the Tracks column's counts when the lowest tracks didn't fit

-- A row's Tracks column: how many pieces on each track, highest first ("3M 3H"); "" with none known.
-- colored wraps each in its track's colour; keep (optional) shows only the highest that many, then a "+".
function GC.TrackText(row, colored, keep)
    local out = {}
    local counts = GC.TrackCounts(row)
    for i, p in ipairs(counts) do
        if keep and i > keep then
            out[#out + 1] = GC.TRACK_MORE
            break
        end
        local text = p.n .. p.track.letter
        out[#out + 1] = colored and GC.InTrackColor(p.track, text) or text
    end
    return table.concat(out, " ")
end

-- What a piece's item string holds (Gear.Parts), or nil when it is known only by its ID: no item string, or
-- a bare "item:<id>" (a piece too long for a message goes as one, Comm.SetMessages). A real item string
-- always carries more fields (its link level at least), so a bare one says nothing about enchant, gems or
-- bonus IDs.
function GC.PartsOf(piece)
    local s = type(piece) == "table" and (piece.itemString or piece.link)
    local own = Gear.ItemString(s)
    if not own or own:match("^item:%d+$") then
        return nil
    end
    return Gear.Parts(own)
end

-- One slot's findings for a piece (nil for an empty slot), given the rules and the player's average item
-- level: { slot, piece, empty, unknown, needsEnchant, missingEnchant, sockets, gems, emptySockets, low,
-- checks, matched, track, issues }. checks: the season checks tripped here, each an issue but an info one;
-- matched: [key] = true for a counting check's match (GC:Row counts those); track: its upgrade track
-- (GC.TrackOf). A piece known only by its ID (unknown, GC.PartsOf) can't show an enchant, gems or bonus IDs,
-- so it is never flagged for them and has no track; a socket count the game can't give is no finding.
function GC.CheckSlot(slot, piece, rules, avg)
    local r = { slot = slot, piece = piece, issues = 0, gems = 0, sockets = 0, emptySockets = 0, checks = {}, matched = {} }
    if type(piece) ~= "table" then
        r.empty = true
        return r
    end
    local parts = GC.PartsOf(piece)
    r.unknown = parts == nil
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
        r.under = math.floor(avg - ilvl) -- whole item levels under the average
        r.issues = r.issues + 1
    end
    for _, c in ipairs(rules.checks or {}) do
        if c.slots[slot] and GC.CheckTrips(c, piece, parts) then
            if c.require then
                r.matched[c.key] = true
            else
                r.checks[#r.checks + 1] = c
                r.issues = r.issues + (GC.IsNote(c) and 0 or 1)
            end
        end
    end
    r.track = GC.TrackOf(parts, rules.tracks)
    return r
end

-- A slot's missing enchant and gems in words ("missing enchant, missing 2 gems"), or nil.
local function missingWords(r)
    local words = {}
    if r.missingEnchant then
        words[#words + 1] = GC.TEXT.missingEnchant
    end
    if r.emptySockets == 1 then
        words[#words + 1] = GC.TEXT.missingGem
    elseif r.emptySockets > 1 then
        words[#words + 1] = string.format(GC.TEXT.missingGems, r.emptySockets)
    end
    return #words > 0 and table.concat(words, ", ") or nil
end

local function lowWords(r)
    return r.low and string.format(GC.TEXT.low, r.under or GC.LOW_ILVL) or nil
end

-- The season checks tripped on a slot, by their labels ("Venomcursed"), or nil: the issues, or with notes
-- true the info ones.
local function checkWords(r, notes)
    local words = {}
    for _, c in ipairs(r.checks or {}) do
        if GC.IsNote(c) == (notes == true) then
            words[#words + 1] = c.label
        end
    end
    return #words > 0 and table.concat(words, ", ") or nil
end

-- The info checks on a slot, in words ("Venomcursed"), or nil: to know, never in chat.
function GC.Notes(r)
    return checkWords(r, true)
end

-- What is wrong with a slot, in words ("missing enchant, 14 item levels under average, Wrong enchant"), or
-- nil. Info checks are not in it (GC.Notes).
function GC.Problems(r)
    local words = {}
    for _, w in ipairs({ missingWords(r) or false, lowWords(r) or false, checkWords(r) or false }) do
        if w then
            words[#words + 1] = w
        end
    end
    return #words > 0 and table.concat(words, ", ") or nil
end

-- A row's issue that belongs to no slot (a counting check short of its require), in words: "Pair: 1 of 2 worn".
function GC.RowProblem(f)
    return string.format(GC.TEXT.require, f.check.label, f.have, f.need)
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
-- issues, missingGems, missingEnchants, checkHits = { [check key] = hits }, rowFindings = { { check, have,
-- need } } (a counting check short of its require), trackCounts = { [track key] = pieces }, below (pieces
-- under the Below chip's track, each slot's findings marked below) }. seen is false for a player whose whole set hasn't arrived yet:
-- only a Gear Checker reply or an inspect is a whole set (GC.WHOLE_SETS); other features remember a few
-- pieces (Loot Master's answers), which would read as empty slots, so those rows wait for a Refresh.
GC.WHOLE_SETS = { [GC.SOURCE_REPLY] = true, [GC.SOURCE_INSPECT] = true }

function GC:Row(m)
    local at, source = Gear:When(m.name)
    local whole = m.me or (source ~= nil and GC.WHOLE_SETS[source] == true)
    local pieces = m.me and Gear:MineAll() or (whole and Gear:OfAll(m.name)) or {}
    local row = { name = m.name, unit = m.unit, class = m.class, me = m.me, at = whole and at or nil,
        source = m.me and "mine" or source, pieces = pieces, slots = {}, issues = 0, missingGems = 0, missingEnchants = 0,
        checkHits = {}, rowFindings = {} }
    row.seen = whole and true or false
    row.avg = Gear.AverageLevel(pieces)
    local by = {}
    for _, p in ipairs(pieces) do
        by[p.slot] = p
        if p.id and not p.link and C_Item and C_Item.RequestLoadItemDataByID then
            pcall(C_Item.RequestLoadItemDataByID, p.id) -- so its link is ready for chat
        end
    end
    local rules = self:Rules()
    local below = rules.tracks.usable and self:BelowTrack() or nil
    row.trackCounts, row.below = {}, 0
    for _, s in ipairs(Gear.SLOTS) do
        local r = self.CheckSlot(s.id, by[s.id], rules, row.avg)
        row.slots[s.id] = r
        row.issues = row.issues + r.issues
        row.missingGems = row.missingGems + r.emptySockets
        row.missingEnchants = row.missingEnchants + (r.missingEnchant and 1 or 0)
        for _, c in ipairs(r.checks) do
            row.checkHits[c.key] = (row.checkHits[c.key] or 0) + 1
        end
        if r.track then
            local key = r.track.track.key
            row.trackCounts[key] = (row.trackCounts[key] or 0) + 1
            if below and r.track.track.order < below.order then
                r.below = true -- under the Below chip's track: to know, not an issue
                row.below = row.below + 1
            end
        end
    end
    if row.seen then
        for _, c in ipairs(rules.checks) do
            if c.require then
                -- a bonus ID check can't read an ID-only piece, so it may hold one: never a shortfall for it
                local have, maybe = 0, 0
                for _, s in ipairs(Gear.SLOTS) do
                    local sr = row.slots[s.id]
                    have = have + (sr.matched[c.key] and 1 or 0)
                    maybe = maybe + ((c.kind == "bonusIds" and c.slots[s.id] and sr.unknown) and 1 or 0)
                end
                if have + maybe < c.require then
                    row.rowFindings[#row.rowFindings + 1] = { check = c, have = have, need = c.require }
                    row.checkHits[c.key] = (row.checkHits[c.key] or 0) + 1
                    row.issues = row.issues + (GC.IsNote(c) and 0 or 1)
                end
            end
        end
    end
    return row
end

-- Whether a filter (GC:Filters) shows a row. A player not seen yet shows only under Everyone.
function GC.Passes(row, filter)
    local check = type(filter) == "string" and filter:sub(1, #GC.CHECK_FILTER) == GC.CHECK_FILTER and filter:sub(#GC.CHECK_FILTER + 1)
    if check then
        return (row.checkHits[check] or 0) > 0
    elseif filter == "issues" then
        return row.issues > 0
    elseif filter == "gems" then
        return row.missingGems > 0
    elseif filter == "enchants" then
        return row.missingEnchants > 0
    elseif filter == GC.BELOW then
        return (row.below or 0) > 0
    end
    return true
end

-- Whether a filter draws a slot's cell: every cell under Everyone; under the others only the cells with that
-- kind of issue (Only issues: any, low items and season checks too), so a row shows just what to fix. Under
-- a counting check's filter its matching items are drawn too, and under Only issues when the row (row,
-- optional) is short of that check, so a row short of them shows what it has. The rest are drawn empty.
function GC.CellShows(r, filter, row)
    if filter == nil or filter == "all" then
        return true
    end
    if type(r) ~= "table" or r.empty then
        return false
    end
    local check = filter:sub(1, #GC.CHECK_FILTER) == GC.CHECK_FILTER and filter:sub(#GC.CHECK_FILTER + 1)
    if check then
        for _, c in ipairs(r.checks or {}) do
            if c.key == check then
                return true
            end
        end
        return r.matched ~= nil and r.matched[check] == true
    elseif filter == "issues" then
        if r.issues > 0 then
            return true
        end
        -- a row short of a counting check's require: its matching items show what it has
        for _, f in ipairs(type(row) == "table" and row.rowFindings or {}) do
            if not GC.IsNote(f.check) and r.matched and r.matched[f.check.key] then
                return true
            end
        end
        return false
    elseif filter == "gems" then
        return r.emptySockets > 0
    elseif filter == "enchants" then
        return r.missingEnchant == true
    elseif filter == GC.BELOW then
        return r.below == true
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

-- Adds a line per row issue (GC.RowProblem) to a list of lines, each written with fmt. An info check's is
-- no issue, so it never goes to chat.
local function addRowLines(out, row, fmt, name)
    for _, f in ipairs(row.rowFindings or {}) do
        if GC.IsNote(f.check) then
            -- to know, not to send
        elseif name then
            out[#out + 1] = string.format(fmt, name, GC.RowProblem(f))
        else
            out[#out + 1] = string.format(fmt, GC.RowProblem(f))
        end
    end
    return out
end

-- The lines whispered to the player: one per slot with an issue, then the row's own.
function GC.WhisperLines(row)
    local out = eachIssue(row, function(r, problems)
        return string.format(GC.TEXT.whisper, slotName(r.slot), GC.ItemLink(r.piece), tostring(r.piece.ilvl or "?"), problems)
    end)
    return addRowLines(out, row, GC.TEXT.rowWhisper)
end

-- The lines posted to raid chat: the shift-click line of each slot with an issue, then the row's own.
function GC.RaidLines(row)
    local out = eachIssue(row, function(r)
        return GC.SlotLine(row, r)
    end)
    return addRowLines(out, row, GC.TEXT.rowLine, shortName(row.name))
end

-- A slot's line start in the badge's tooltip: "Head [item] 285 - ".
local function lineHead(r)
    return string.format("%s %s %s - ", slotName(r.slot), GC.ItemLink(r.piece), tostring(r.piece.ilvl or "?"))
end

-- The issues badge's tooltip: { text, kind } per issue, "Head [item] 285 - missing enchant" ("bad", red),
-- "... - 14 item levels under average" ("low", orange), "... - Wrong enchant" (the season check's severity,
-- bad or low); a slot with several has a line of each. Then the row's own ("Pair: 1 of 2 worn"). {} with no
-- issue, nil for a player not seen yet. Info checks are in GC.NoteLines.
function GC.IssueLines(row)
    if not row.seen then
        return nil
    end
    local out = {}
    for _, s in ipairs(Gear.SLOTS) do
        local r = row.slots[s.id]
        if r and r.piece then
            local head = lineHead(r)
            local missing, low = missingWords(r), lowWords(r)
            if missing then
                out[#out + 1] = { text = head .. missing, kind = "bad" }
            end
            if low then
                out[#out + 1] = { text = head .. low, kind = "low" }
            end
            for _, c in ipairs(r.checks or {}) do
                if not GC.IsNote(c) then
                    out[#out + 1] = { text = head .. c.label, kind = c.severity }
                end
            end
        end
    end
    for _, f in ipairs(row.rowFindings or {}) do
        if not GC.IsNote(f.check) then
            out[#out + 1] = { text = GC.RowProblem(f), kind = f.check.severity }
        end
    end
    return out
end

-- The badge tooltip's Not an issue part: { text, kind, track } per thing to know. An info check on a slot
-- ("Head [item] 285 - Venomcursed", kind "info"), an item under the Below chip's track ("Hands [item] 280 -
-- Champion 4/6", kind "track", in its track's colour), then the row's own info checks. {} with none, nil for
-- a player not seen yet.
function GC.NoteLines(row)
    if not row.seen then
        return nil
    end
    local out = {}
    for _, s in ipairs(Gear.SLOTS) do
        local r = row.slots[s.id]
        if r and r.piece then
            for _, c in ipairs(r.checks or {}) do
                if GC.IsNote(c) then
                    out[#out + 1] = { text = lineHead(r) .. c.label, kind = c.severity }
                end
            end
            if r.below and r.track then
                out[#out + 1] = { text = lineHead(r) .. GC.TrackWords(r.track), kind = "track", track = r.track.track }
            end
        end
    end
    for _, f in ipairs(row.rowFindings or {}) do
        if GC.IsNote(f.check) then
            out[#out + 1] = { text = GC.RowProblem(f), kind = f.check.severity }
        end
    end
    return out
end

GC.CHAT_MAX = 255 -- bytes a chat message may hold

-- Lines joined into one message of max bytes or less (GC.CHAT_MAX by default): as many as fit, then how
-- many were left out.
function GC.JoinLines(lines, max)
    max = max or GC.CHAT_MAX
    local text = ""
    for i, line in ipairs(lines) do
        local candidate = text == "" and line or (text .. " " .. line)
        local tail = i < #lines and (" " .. string.format(GC.TEXT.more, #lines - i)) or ""
        if #candidate + #tail > max and text ~= "" then
            return text .. " " .. string.format(GC.TEXT.more, #lines - i + 1)
        end
        text = candidate
    end
    return text
end

-- One line for the chat box, to edit before sending: the slot lines joined.
function GC.ChatBoxText(row)
    return GC.JoinLines(GC.RaidLines(row))
end

-- The chat box ------------------------------------------------------------------------------------------------

-- Text into a new chat box, for the player to edit and send.
function GC.OpenChat(text)
    local open = (ChatFrameUtil and ChatFrameUtil.OpenChat) or ChatFrame_OpenChat
    return open and pcall(open, text) or false
end

-- Text into the chat box: into the one being typed in, else a new one opened with it (as the game's own
-- ChatFrameUtil.LinkItem does).
function GC.ToChatBox(text)
    if not text or text == "" then
        return false
    end
    local util = ChatFrameUtil
    local getActive = (util and util.GetActiveWindow) or ChatEdit_GetActiveWindow
    local insert = (util and util.InsertLink) or ChatEdit_InsertLink
    local okA, active = pcall(getActive or function() end)
    if okA and active and insert then
        return pcall(insert, text)
    end
    return GC.OpenChat(text)
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

GC.CHAT_GAP = 0.4 -- seconds between two lines of one whisper or post, so a long list isn't one burst

-- A line within GC.CHAT_MAX bytes: as it is when it fits; else with each item link turned into its plain
-- [name]; else cut at the limit (any pipe left at the cut is dropped, so no escape code is cut in half).
function GC.CapLine(line)
    if #line <= GC.CHAT_MAX then
        return line
    end
    local plain = (line:gsub("|c%x%x%x%x%x%x%x%x|H.-|h(%[.-%])|h|r", "%1"))
    if #plain <= GC.CHAT_MAX then
        return plain
    end
    return (plain:sub(1, GC.CHAT_MAX):gsub("|+$", ""))
end

local function sendLine(line, chatType, target)
    local send = (C_ChatInfo and C_ChatInfo.SendChatMessage) or SendChatMessage
    if chatLocked() then
        showError(GC.TEXT.locked)
        CRT:Print(string.format(GC.TEXT.notSent, line))
        return false
    end
    local ok = send and pcall(send, line, chatType, nil, target)
    if not ok then
        CRT:Print(string.format(GC.TEXT.notSent, line))
    end
    return ok and true or false
end

-- Chat types the game sends only from a key press or click: Say and Yell in the open world, a channel
-- everywhere (the SendChatMessage page's HW column). "Open world" is anything but these instances; a housing
-- neighborhood or house, or a place the game won't say, counts as the world.
GC.HARDWARE = { SAY = "world", YELL = "world", CHANNEL = "always" }
GC.FREE_INSTANCES = { party = true, raid = true, pvp = true, arena = true, scenario = true }
GC.SLASH = { SAY = SLASH_SAY1 or "/s", YELL = SLASH_YELL1 or "/y" } -- the game's own, in the client's language

function GC.NeedsHardware(chatType)
    local rule = GC.HARDWARE[chatType]
    if rule == "always" then
        return true
    elseif rule ~= "world" then
        return false
    end
    if not IsInInstance then
        return true
    end
    local ok, inside, kind = pcall(IsInInstance)
    if not ok or secret(inside) or secret(kind) then
        return true
    end
    return not (inside and GC.FREE_INSTANCES[kind] == true)
end

-- Returns how many lines went or are on their way (the first goes now, the rest CHAT_GAP apart). No lines
-- send nothing. A chat type that needs a key press here can't take the spaced lines (only the first would
-- come from the click), so every line goes, joined, into a new chat box after its slash command, for the
-- player to send with Enter: then it returns 0, "chatbox".
function GC.Say(lines, chatType, target)
    if #lines == 0 then
        return 0
    end
    if GC.NeedsHardware(chatType) then
        local slash = GC.SLASH[chatType]
        local prefix = slash and (slash .. " ") or ""
        GC.OpenChat(prefix .. GC.JoinLines(lines, GC.CHAT_MAX - #prefix))
        return 0, "chatbox"
    end
    if chatLocked() then
        showError(GC.TEXT.locked)
        for _, line in ipairs(lines) do
            CRT:Print(string.format(GC.TEXT.notSent, line))
        end
        return 0
    end
    local n = 0
    for i, line in ipairs(lines) do
        line = GC.CapLine(line)
        if i == 1 then
            n = n + (sendLine(line, chatType, target) and 1 or 0)
        else
            C_Timer.After((i - 1) * GC.CHAT_GAP, function()
                sendLine(line, chatType, target)
            end)
            n = n + 1
        end
    end
    return n
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

-- Whether you can speak in guild chat: in a guild, and your rank may. Anything unreadable is no.
function GC.CanGuild()
    if not (IsInGuild and IsInGuild() and C_GuildInfo and C_GuildInfo.CanSpeakInGuildChat) then
        return false
    end
    local ok, can = pcall(C_GuildInfo.CanSpeakInGuildChat)
    return ok and can == true
end

-- Whether you can speak in officer chat: your rank's Officerchat Speak flag (index 4 of
-- C_GuildInfo.GuildControlGetRankFlags, whose ranks count from 1; GetGuildInfo's index counts from 0).
-- Anything unreadable is no.
GC.OFFICER_SPEAK = 4

function GC.CanOfficer()
    if not (IsInGuild and IsInGuild() and GetGuildInfo and C_GuildInfo and C_GuildInfo.GuildControlGetRankFlags) then
        return false
    end
    local okR, _, _, rank = pcall(GetGuildInfo, "player")
    if not okR or secret(rank) or type(rank) ~= "number" then
        return false
    end
    local ok, flags = pcall(C_GuildInfo.GuildControlGetRankFlags, rank + 1)
    return ok and type(flags) == "table" and flags[GC.OFFICER_SPEAK] == true
end

-- Where a row's issues can go, in the menu's order: the group channel (in a group), Guild and Officer (when
-- you may speak there), a whisper to the player (not on your own row), Say. Each { chatType, target }.
function GC.SendTargets(row)
    local out = {}
    local group = GC.GroupChat()
    if group then
        out[#out + 1] = { chatType = group }
    end
    if GC.CanGuild() then
        out[#out + 1] = { chatType = "GUILD" }
    end
    if GC.CanOfficer() then
        out[#out + 1] = { chatType = "OFFICER" }
    end
    if not row.me then
        out[#out + 1] = { chatType = "WHISPER", target = row.name }
    end
    out[#out + 1] = { chatType = "SAY" }
    return out
end

-- Sends a row's issues to a target (GC.SendTargets) through GC.Say: the player's own lines in a whisper,
-- the named lines anywhere else.
function GC.Send(row, t)
    local lines = t.chatType == "WHISPER" and GC.WhisperLines(row) or GC.RaidLines(row)
    return GC.Say(lines, t.chatType, t.target)
end
