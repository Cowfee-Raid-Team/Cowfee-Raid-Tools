local ADDON, CRT = ...

-- Loot Master wishlists: each raider keeps a ranked list of the items they want (Alex, 2026-11-11, Issue #1263),
-- and the loot master and raid assists see it in their loot windows when an item drops. No frames here: the list,
-- its message and who keeps what. The Encounter Journal's right-click menu and the item tooltip line are in
-- LootMaster/WishlistJournal.lua, the My wishlist window in LootMaster/WishlistWindow.lua, the Wishlist column in
-- LootMaster/Window.lua (the Master Loot Window) and RaiderWindow.lua (All Loot Rolls, for assists).
--
-- Your list is saved per character, CRTDBChar.lootmaster.wishlist = { [itemID] = { rank, at = time() } }. Only the
-- item ID is the key: a Journal link carries the difficulty's bonus IDs, and wanting an item means any difficulty.
-- Ranks, best first: big (Big upgrade), small (Small upgrade), off (Off spec).
--
-- Message, on LM.PREFIX (Comm.lua's channel and queue): an older CRT drops a kind it doesn't know.
--   X|<stamp>:<part>/<parts>|<itemID>,<b|s|o>;...   your whole list, packed (Wire.Pack), in as many parts as it takes;
--                                                   a list with no items is one part with no entries (cleared)
--   X|?                                             the loot master (or a leader or assist) asks for everyone's list
-- You send your list a few seconds after it changes (SEND_DELAY, so several clicks go as one), when you join a
-- group, and when someone who may keep lists asks (the loot master asks at each session start, and after a /reload
-- in a group). Never during a boss encounter: it waits for ENCOUNTER_END (or, held by the chat lockdown alone, is tried
-- again every HELD_RETRY seconds). Out of a group nothing is sent, and a message from outside your group is ignored.
-- Only the loot master (LM:CanLoot), the group leader and raid assists keep the lists they hear (W.Sees), in
-- memory for this login (W.lists): a /reload asks again.
--
-- Saved copies and the guild (Alex, 2026-11-11, Issue #1269): guild officers (W.Officer) keep lists too, and every
-- keeper (W.Keeps) saves a copy of each list heard, account-wide (LootMaster/WishlistSaved.lua; the Wishlists tab is
-- LootMaster/WishlistTab.lua). The stamp is now the time your list last changed (CRTDBChar.lootmaster.wishlistAt, in
-- hex), so a newer list wins over an older copy. The same X messages also go on the GUILD channel (LM.SendGuild):
-- your list a few seconds after a change and once LOGIN_DELAY (plus up to LOGIN_JITTER) seconds after login, and in
-- answer to an X|? heard on GUILD (after up to ASK_JITTER seconds, at most once every GUILD_ANSWER_SECONDS). Every
-- raider with a list answers: the ask carries no stamps (the message format is unchanged). An officer asks the guild
-- LOGIN_ASK_DELAY seconds after login, at most once every GUILD_ASK_SECONDS (lootmaster.wishlistsAsked). Never during
-- a boss encounter, never out of a guild. A list heard on GUILD is from a guild member (the game sends GUILD to the
-- guild only), so the group check is for RAID, PARTY and INSTANCE_CHAT only.

local LM = CRT.LootMaster
local Wire = LM.Wire

local W = {}
LM.Wishlist = W

W.RANKS = { "big", "small", "off" } -- best first
W.RANK_ORDER = { big = 3, small = 2, off = 1 } -- the roll windows' tiebreak: higher first
W.RANK_COLOR = { big = "good", small = "warn", off = "muted" } -- theme keys (CRT_Dev/StyleGuide.md)
W.DEFAULT_RANK = "big" -- a tick in the My wishlist window
local TO_WIRE = { big = "b", small = "s", off = "o" }
local FROM_WIRE = { b = "big", s = "small", o = "off" }

W.MAX = 200 -- items on one list (yours, and one heard); a few messages at most
W.MAX_PARTS = 20 -- parts of one list a receiver takes
W.SEND_DELAY = 3 -- seconds after a change before your list goes
W.ASK_SECONDS = 10 -- at most one ask this often
W.HELD_RETRY = 10 -- seconds between tries while the chat lockdown holds messages with no encounter seen (as Comm.lua)
W.LOGIN_DELAY = 30 -- seconds after login before your list goes to the guild
W.LOGIN_JITTER = 60 -- plus up to this many, so a guild logging in at once doesn't send together
W.ASK_JITTER = 5 -- an answer to a guild ask waits up to this many seconds
W.GUILD_ANSWER_SECONDS = 60 -- at most one answer to a guild ask this often
W.LOGIN_ASK_DELAY = 20 -- seconds after login before an officer asks the guild (the guild's data is in by then)
W.GUILD_ASK_SECONDS = 600 -- an officer asks the guild at most this often, across logins

W.TEXT = {
    big = "Big upgrade",
    small = "Small upgrade",
    off = "Off spec",
    notListed = "Not listed",
    notWanted = "Not wanted",
    tooltip = "Wishlist: %s",
    sent = "Sent to the loot master.",
    held = "Will send after the fight.",
    sending = "Sending...",
    solo = "Sends when you join a group.",
    guild = "Sent to your guild's officers.",
    column = "Wishlist",
}
local TEXT = W.TEXT

local function secret(v)
    return issecretvalue ~= nil and issecretvalue(v) or false
end

-- Your list --------------------------------------------------------------------------------------------

-- Your character's list, made when missing.
function W.Store()
    CRTDBChar = type(CRTDBChar) == "table" and CRTDBChar or {}
    local lm = CRTDBChar.lootmaster
    if type(lm) ~= "table" then
        lm = {}
        CRTDBChar.lootmaster = lm
    end
    if type(lm.wishlist) ~= "table" then
        lm.wishlist = {}
    end
    return lm.wishlist
end

-- When your list last changed, the stamp its messages carry: CRTDBChar.lootmaster.wishlistAt, else (a list from
-- before it was kept) its newest item's time, else 0.
function W.Stamp()
    W.Store()
    local lm = CRTDBChar.lootmaster
    if type(lm.wishlistAt) == "number" then
        return lm.wishlistAt
    end
    local at = 0
    for _, e in pairs(lm.wishlist) do
        if type(e) == "table" and type(e.at) == "number" and e.at > at then
            at = e.at
        end
    end
    return at
end

-- A change's new stamp: now, and always past the last one, so two changes in one second still count as newer.
local function restamp()
    local now = time()
    local last = W.Stamp()
    CRTDBChar.lootmaster.wishlistAt = (now > last) and now or (last + 1)
end

-- Whether you have a list to tell the guild about: items on it, or a list you emptied.
function W.HasList()
    return W.Count() > 0 or W.Stamp() > 0
end

-- An item's ID from an item ID, an item string or a link; nil when it doesn't read or is secret.
function W.ItemID(item)
    if item == nil or secret(item) then
        return nil
    end
    local id
    if type(item) == "number" then
        id = item
    elseif type(item) == "string" then
        id = tonumber(item:match("item:(%d+)") or item:match("^%s*(%d+)%s*$"))
    end
    if id and id > 0 and id == math.floor(id) then
        return id
    end
    return nil
end

function W.IsRank(rank)
    return rank ~= nil and W.RANK_ORDER[rank] ~= nil
end

-- Your rank for an item, or nil.
function W.Rank(item)
    local id = W.ItemID(item)
    local e = id and W.Store()[id]
    if type(e) == "table" and W.IsRank(e.rank) then
        return e.rank
    end
    return nil
end

function W.Count()
    local n = 0
    for _, e in pairs(W.Store()) do
        if type(e) == "table" and W.IsRank(e.rank) then
            n = n + 1
        end
    end
    return n
end

-- Your list as { { id, rank, at } }, best rank first, then by item ID.
function W.Items()
    local out = {}
    for id, e in pairs(W.Store()) do
        if type(id) == "number" and type(e) == "table" and W.IsRank(e.rank) then
            out[#out + 1] = { id = id, rank = e.rank, at = e.at }
        end
    end
    table.sort(out, function(a, b)
        if a.rank ~= b.rank then
            return W.RANK_ORDER[a.rank] > W.RANK_ORDER[b.rank]
        end
        return a.id < b.id
    end)
    return out
end

local changed -- set below: a change is told to every window and sent

-- Puts an item on your list at a rank (nil takes it off). Returns whether anything changed. A full list takes
-- no new item.
function W.Set(item, rank)
    local id = W.ItemID(item)
    if not id or (rank ~= nil and not W.IsRank(rank)) then
        return false
    end
    local store = W.Store()
    local before = W.Rank(id)
    if before == rank then
        return false
    end
    if rank == nil then
        store[id] = nil
    else
        if not before and W.Count() >= W.MAX then
            return false
        end
        store[id] = { rank = rank, at = time() }
    end
    changed()
    return true
end

function W.Remove(item)
    return W.Set(item, nil)
end

function W.Label(rank)
    return rank and TEXT[rank] or TEXT.notListed
end

-- A rank as coloured text for a window: its rank's theme colour, or "Not listed" muted.
function W.Cell(rank)
    local UI = CRT.UI
    local text, key = W.Label(rank), W.IsRank(rank) and W.RANK_COLOR[rank] or "muted"
    if UI and UI.ColorText then
        return UI.ColorText(text, key)
    end
    return text
end

-- The message ------------------------------------------------------------------------------------------

local HEAD_PAD = ":00/00" -- the part numbers' place, the same width as the real ones

-- Your list (or items, { { id, rank } }) as X messages for stamp, each 255 bytes or less.
function W.Encode(stamp, items)
    items = items or W.Items()
    local entries = {}
    for _, it in ipairs(items) do
        if TO_WIRE[it.rank] and #entries < W.MAX then
            entries[#entries + 1] = { it.id, TO_WIRE[it.rank] }
        end
    end
    local head = tostring(stamp) .. HEAD_PAD
    local messages = Wire.Pack("X", head, entries)
    if #messages == 0 then
        messages = { "X|" .. head .. "|" }
    end
    local skip = #("X|" .. head) + 1
    for i, text in ipairs(messages) do
        messages[i] = "X|" .. tostring(stamp) .. string.format(":%02d/%02d", i, #messages) .. text:sub(skip)
    end
    return messages
end

-- One part's head: stamp, part, parts; nil when it doesn't read.
function W.ParseHead(field)
    local stamp, i, n = tostring(field or ""):match("^(%x+):(%d+)/(%d+)$")
    i, n = tonumber(i), tonumber(n)
    if not stamp or not i or not n or n < 1 or n > W.MAX_PARTS or i < 1 or i > n then
        return nil
    end
    return stamp, i, n
end

-- The items of a list's parts joined: { [itemID] = rank }. Entries that don't read are left out.
function W.Decode(parts)
    local items, n = {}, 0
    for _, field in ipairs(parts) do
        for _, e in ipairs(Wire.Unpack(field)) do
            local id, rank = W.ItemID(tonumber(e[1])), FROM_WIRE[e[2] or ""]
            if id and rank and not items[id] and n < W.MAX then
                items[id] = rank
                n = n + 1
            end
        end
    end
    return items
end

-- Who keeps lists ----------------------------------------------------------------------------------------

local function isTrue(v)
    return not secret(v) and v == true
end

-- Whether a group member (a unit) leads the group or is a raid assist.
local function leads(unit)
    if not unit then
        return false
    end
    return isTrue(UnitIsGroupLeader(unit)) or (IsInRaid() and UnitIsGroupAssistant ~= nil and isTrue(UnitIsGroupAssistant(unit)))
end

-- Whether you keep the lists you hear: the loot master, the group leader or a raid assist.
function W.Sees()
    if LM:CanLoot() then
        return true
    end
    return IsInGroup() and leads("player") or false
end

-- Whether you are in a guild (IsInGuild). Unreadable is no.
local function inGuild()
    if IsInGuild == nil then
        return false
    end
    local v = IsInGuild()
    return not secret(v) and v and true or false
end
W.InGuild = inGuild

-- Whether you are a guild officer: your rank may edit officer notes (C_GuildInfo.CanEditOfficerNote, warcraft.wiki.gg
-- and Blizzard's GuildInfoDocumentation, read 2026-11-11). Viewing officer notes (CanViewOfficerNote) is often given
-- to more ranks, so editing is the officer's mark. Unreadable or secret is no.
function W.Officer()
    if not inGuild() then
        return false
    end
    local fn = C_GuildInfo and C_GuildInfo.CanEditOfficerNote
    if type(fn) ~= "function" then
        return false
    end
    local ok, can = pcall(fn)
    return ok and isTrue(can)
end

-- Whether you keep (and save) the lists you hear: a guild officer, the loot master, the group leader or a raid assist.
function W.Keeps()
    return W.Officer() or W.Sees()
end

-- Whether a player may ask for everyone's list: one who may run loot, the leader or an assist.
local function mayAsk(name)
    return LM.Allowed(name) or leads(LM.UnitOf(name))
end

-- The lists heard: { [Name-Realm] = { items = { [itemID] = rank }, at } } (this login only).
W.lists = {}

-- A player's rank for an item: yours from your own list, another's from the list they sent; nil when none.
function W.RankFor(name, item)
    if name == nil then
        return nil
    end
    if name == LM:Me() then
        return W.Rank(item)
    end
    local id, list = W.ItemID(item), W.lists[name]
    if not id then
        return nil
    end
    if list then
        return list.items[id]
    end
    -- not heard this login: the saved copy (LootMaster/WishlistSaved.lua), when you keep one
    local saved = W.SavedList and W.SavedList(name)
    return saved and saved.items[id] or nil
end

function W.Order(rank)
    return rank and W.RANK_ORDER[rank] or 0
end

-- Receiving ----------------------------------------------------------------------------------------------

local partsIn = {} -- [sender] = { stamp, n, parts = { [i] = field } }

local ask -- set below
local queue -- set below
local answerGuild -- set below

-- channel: the message's chat type (CHAT_MSG_ADDON's third argument); GUILD comes from a guild member.
LM.Handle("X", function(f, sender, channel)
    if not sender then
        return
    end
    local guild = channel == "GUILD"
    if sender ~= LM:Me() and not guild and not LM.UnitOf(sender) then
        return -- not in your group
    end
    if f[1] == "?" then
        if sender == LM:Me() then
            return
        elseif guild then
            answerGuild()
        elseif mayAsk(sender) then
            queue(true)
        end
        return
    end
    local sees = W.Sees() and not guild -- the group's lists, for the roll windows
    if not (sees or W.Keeps()) then
        partsIn[sender] = nil
        return -- only officers, the loot master, the leader and assists keep lists
    end
    local stamp, i, n = W.ParseHead(f[1])
    if not stamp then
        return
    end
    local key = (guild and "g:" or "") .. sender -- a list may come on both channels at once
    local p = partsIn[key]
    if not p or p.stamp ~= stamp or p.n ~= n then
        p = { stamp = stamp, n = n, parts = {} }
        partsIn[key] = p
    end
    p.parts[i] = f[2] or ""
    for k = 1, n do
        if not p.parts[k] then
            return
        end
    end
    partsIn[key] = nil
    local items = W.Decode(p.parts)
    if sees then
        W.lists[sender] = { items = items, at = time() }
    end
    if sender ~= LM:Me() and W.Keep then
        W.Keep(sender, items, tonumber(stamp, 16)) -- saved, when newer than the copy kept
    end
    LM:Fire("wishlist", sender)
end)

-- Sending ------------------------------------------------------------------------------------------------

local pending, timerSet, inEncounter = false, false, false
local guildPending, guildTimer = false, false -- your list waits to go to the guild; its timer is set
local lastSentCount -- how many items your last list sent had (nil before the first)
local lastAsk, askPending = nil, false
local lastGuildAnswer -- GetTime() of your last answer to a guild ask
W.status = "solo" -- "solo", "sending", "held", "sent" or "guild", for the window's line

-- A random wait of up to max seconds, so a guild's answers spread out (math.random; a test sets its own).
function W.Jitter(max)
    return math.random() * max
end

local function stampText()
    return string.format("%x", W.Stamp())
end

local function held()
    return inEncounter or LM.ChatLocked()
end

-- Whether a boss encounter runs now (C_InstanceEncounter.IsEncounterInProgress, as Alerts/DebuffListView.lua reads
-- it), for a /reload or a loading screen in the middle of one. Unreadable or secret is no.
local function encounterRuns()
    local fn = C_InstanceEncounter and C_InstanceEncounter.IsEncounterInProgress
    if type(fn) ~= "function" then
        return false
    end
    local ok, on = pcall(fn)
    return ok and not secret(on) and on == true
end

local retrying = false
local sendNow -- set below
local askHeld -- set below
local sendGuild -- set below

-- While messages are held with no ENCOUNTER_END to wait for (the chat lockdown alone), tried again every HELD_RETRY.
local function retryHeld()
    if retrying then
        return
    end
    retrying = true
    C_Timer.After(W.HELD_RETRY, function()
        retrying = false
        if pending and not timerSet then
            sendNow(pending == "force")
        end
        if askPending then
            askHeld()
        end
        if guildPending and not guildTimer then
            sendGuild()
        end
    end)
end

-- Out of a group: the line says what the guild got, or that your list waits for a group.
local function idle()
    if not (inGuild() and (guildPending or W.status == "guild")) then
        W.status = "solo"
    end
end

sendNow = function(force)
    timerSet = false
    if not pending then
        return
    end
    if not IsInGroup() then
        pending = false
        idle()
        LM:Fire("wishlist")
        return
    end
    if held() then
        W.status = "held" -- sent at ENCOUNTER_END, or tried again while only the lockdown holds it
        if not inEncounter then
            retryHeld()
        end
        LM:Fire("wishlist")
        return
    end
    pending = false
    local items = W.Items()
    if #items == 0 and not force and (lastSentCount or 0) == 0 then
        W.status = "sent" -- nothing to say: an empty list was never sent anything else
        LM:Fire("wishlist")
        return
    end
    for _, text in ipairs(W.Encode(stampText(), items)) do
        LM.SendText(text)
    end
    lastSentCount = #items
    W.status = "sent"
    LM:Fire("wishlist")
end

-- Your list goes SEND_DELAY seconds from now (more changes meanwhile go with it), or after the encounter.
-- force: sent even when empty (an ask: the asker learns you have none).
queue = function(force)
    if force then
        pending = "force"
    elseif pending ~= "force" then
        pending = true
    end
    if not IsInGroup() then
        pending = false
        idle()
        return
    end
    W.status = held() and "held" or "sending"
    if timerSet then
        return
    end
    timerSet = true
    C_Timer.After(W.SEND_DELAY, function()
        sendNow(pending == "force")
    end)
end
W.Queue = queue

-- Your list to the guild (LM.SendGuild), when it waits to go: never out of a guild, held during an encounter.
sendGuild = function()
    if not guildPending then
        return
    end
    if not inGuild() then
        guildPending = false
        idle()
        return
    end
    if held() then
        if not IsInGroup() then
            W.status = "held"
            LM:Fire("wishlist")
        end
        if not inEncounter then
            retryHeld()
        end
        return
    end
    guildPending = false
    for _, text in ipairs(W.Encode(stampText())) do
        LM.SendGuild(text)
    end
    if not IsInGroup() then
        W.status = "guild"
        LM:Fire("wishlist")
    end
end

-- Your list goes to the guild delay seconds from now (SEND_DELAY when not given); a send already waiting takes it.
local function queueGuild(delay)
    if not inGuild() then
        guildPending = false
        return
    end
    guildPending = true
    if not IsInGroup() then
        W.status = held() and "held" or "sending"
    end
    if guildTimer then
        return
    end
    guildTimer = true
    C_Timer.After(delay or W.SEND_DELAY, function()
        guildTimer = false
        sendGuild()
    end)
end
W.QueueGuild = queueGuild

-- An ask heard on GUILD: your list goes after a short random wait, if you have one, at most once a minute.
answerGuild = function()
    if not (inGuild() and W.HasList()) then
        return
    end
    if lastGuildAnswer and GetTime() - lastGuildAnswer < W.GUILD_ANSWER_SECONDS then
        return
    end
    lastGuildAnswer = GetTime()
    queueGuild(W.Jitter(W.ASK_JITTER))
end

-- Asks the group for everyone's list (the loot master at a session start; a leader or assist after a /reload),
-- at most once every ASK_SECONDS; during an encounter it waits for its end.
ask = function()
    if not (IsInGroup() and W.Sees()) then
        return false
    end
    if held() then
        askPending = true
        if not inEncounter then
            retryHeld()
        end
        return false
    end
    if lastAsk and GetTime() - lastAsk < W.ASK_SECONDS then
        return false
    end
    lastAsk, askPending = GetTime(), false
    LM.SendText(Wire.Encode("X", { "?" }))
    return true
end
W.Ask = ask
askHeld = function()
    ask()
end

-- An officer asks the guild for everyone's newer list: at most once every GUILD_ASK_SECONDS, kept across logins
-- (lootmaster.wishlistsAsked). During an encounter it is tried again after HELD_RETRY seconds.
function W.AskGuild()
    if not (inGuild() and W.Officer()) then
        return false
    end
    if held() then
        C_Timer.After(W.HELD_RETRY, W.AskGuild)
        return false
    end
    local set = LM:Settings()
    local last = tonumber(set.wishlistsAsked) or 0
    if last > 0 and time() - last < W.GUILD_ASK_SECONDS then
        return false
    end
    set.wishlistsAsked = time()
    LM.SendGuild(Wire.Encode("X", { "?" }))
    return true
end

changed = function()
    restamp()
    LM:Fire("wishlist")
    queue(false)
    queueGuild()
end

-- The window's status line.
function W.StatusText()
    return TEXT[W.status] or TEXT.solo
end

-- Whether your list waits to go (for tests).
function W.Pending()
    return pending and true or false
end

-- Whether your list waits to go to the guild (for tests).
function W.GuildPending()
    return guildPending
end

-- Events -------------------------------------------------------------------------------------------------

LM:OnChange(function(what)
    if what == "started" then
        ask() -- a session starts (or comes back after a /reload): everyone sends their list
    end
end)

local wasInGroup = false
local events = CreateFrame("Frame")
for _, e in ipairs({ "ENCOUNTER_START", "ENCOUNTER_END", "GROUP_ROSTER_UPDATE", "PLAYER_LOGIN", "PLAYER_ENTERING_WORLD" }) do
    events:RegisterEvent(e)
end
events:SetScript("OnEvent", function(_, event)
    if event == "ENCOUNTER_START" then
        inEncounter = true
        if pending then
            W.status = "held"
            LM:Fire("wishlist")
        end
    elseif event == "ENCOUNTER_END" then
        inEncounter = false
        if pending then
            queue(pending == "force")
        end
        if askPending then
            ask()
        end
        if guildPending then
            queueGuild()
        end
    elseif event == "GROUP_ROSTER_UPDATE" then
        local now = IsInGroup() and true or false
        if now and not wasInGroup then
            if W.Count() > 0 then
                queue(false) -- joined a group: your list goes
            end
            ask() -- a leader or assist who joins asks
        elseif not now then
            W.lists, partsIn = {}, {}
            lastSentCount = nil
            W.status = "solo"
            LM:Fire("wishlist")
        end
        wasInGroup = now
    elseif event == "PLAYER_ENTERING_WORLD" then
        -- a /reload or loading screen: no ENCOUNTER_END may come for an encounter left behind
        inEncounter = encounterRuns()
        if not inEncounter and (pending or askPending or guildPending) then
            retryHeld()
        end
    elseif event == "PLAYER_LOGIN" then
        wasInGroup = IsInGroup() and true or false
        if wasInGroup then
            C_Timer.After(W.SEND_DELAY, function()
                ask() -- a /reload in a group: lists heard before are gone, so ask again
            end)
        end
        -- your list to the guild once, a while after login (spread out), and an officer asks the guild
        C_Timer.After(W.LOGIN_DELAY + W.Jitter(W.LOGIN_JITTER), function()
            if W.HasList() then
                queueGuild(0)
            end
        end)
        C_Timer.After(W.LOGIN_ASK_DELAY, W.AskGuild)
    end
end)

-- /crt wishlist (CRT_Core/Slash.lua's registry); the window is LootMaster/WishlistWindow.lua.
if CRT.Slash then
    CRT.Slash:Register("wishlist", {
        run = function()
            if LM.ShowWishlist then
                LM:ShowWishlist()
            end
            return true
        end,
        help = { "[/crt wishlist] - open your loot wishlist: the items you want, ranked, for the loot master" },
    })
end
