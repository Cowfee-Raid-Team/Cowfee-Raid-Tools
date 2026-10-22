local ADDON, CRT = ...

-- The raid leader's Boss loot list, with no frames (the window is LootMaster/BossLootWindow.lua). Alex,
-- 2026-10-20: "all loot is held for rolls until the raid lead clicks 'start session'". One row per boss
-- roll the leader's CRT handled (LootMaster/Rolls.lua), in the order they started:
--   rollID, link, itemString, ilvl, at (GetTime), expires (GetTime when it leaves the list: below)
--   pass, why      the loot filter's word (LM:FilterLoot as boss loot): passed, else why not
--   ticked         in the next session; pre-ticked when it passed the filter
--   status         "rolling" (CRT rolled rollType), "won" (you won it), "lost" (winner won it),
--                  "nowinner" (everyone passed) or "cant" (CRT couldn't roll: reason)
--   received       true for an item the game gave you with no roll (rollID is then CRT's own, below 0)
-- Only a won row can go into a session. Start session (BL:Start) starts LM:Start with the ticked rows you
-- have won, LM.MAX_ITEMS a session, the rest after it ends. It waits while a ticked row is still rolling:
-- untick a row to leave it out. Nothing starts a session on its own. Alex, 2026-10-21: Start session should
-- work "in all cases": a test session still running is ended first, and a real one keeps going while
-- these wait their turn; either way the Loot Master window shows.
--
-- Loot for the whole raid (Alex, 2026-10-21: "keep items for the whole raid ... expiring on each item's
-- 2-hour trade timer, and warn me before items run out"). The game lets you trade an item you looted to
-- players who were also eligible to loot it for 2 hours. So a won row stays until LM.TRADE_SECONDS after
-- you got it (the result, or the receive event), counted by CRT's clock, not read from the item: the
-- game's own timer started a moment earlier, so the row leaves a little before the trade really closes.
-- LM.TRADE_WARN before that, chat warns once per item and the row's time left turns to a warning.
-- Rows still rolling, won by someone else or nobody, or CRT couldn't roll, leave LM.BOSS_SECONDS after
-- their kill as before. Items waiting behind a running session (BL.waiting) are dropped one by one when
-- their own time runs out.
-- The list and the waiting items are kept per character in CRTDBChar.lootmaster.bossLootList, each row's
-- time left as a clock time, so a /reload, a logout, leaving the instance or CRT Looting turning off keep
-- them; they come back at login with their rollIDs renumbered as CRT's own (the game's start again).
-- Only Clear and the times above empty it. Changes fire LM:Fire("bossloot", what): "open" (the first row
-- of a new list, or a kept list at login: the window shows), "changed" or "cleared".
--
-- Who won, from the game (checked 2026-10-20):
--   LOOT_HISTORY_UPDATE_DROP (encounterID, lootListID): https://warcraft.wiki.gg/wiki/LOOT_HISTORY_UPDATE_DROP;
--     the drop is read with C_LootHistory.GetSortedInfoForDrop(encounterID, lootListID):
--     https://warcraft.wiki.gg/wiki/API_C_LootHistory.GetSortedInfoForDrop (itemHyperlink, winner with
--     playerName and isSelf, allPassed). The main source, as Loot History's (Loot/Capture.lua).
--   ENCOUNTER_LOOT_RECEIVED (encounterID, itemID, itemLink, quantity, playerName, classFileName):
--     https://warcraft.wiki.gg/wiki/ENCOUNTER_LOOT_RECEIVED. A second word on who got it.
-- A result is matched to the oldest row still rolling from the same boss (the kill's encounterID) with
-- the same item string, else the same item ID. Each history drop sets a row once, and the two sources
-- count against each other per boss and item, so a drop both report sets one row only.
-- A winner that can't be read (a secret value, a failing call) leaves the row rolling.
--
-- Received loot (Alex, 2026-10-21: old raids never started a session). A raid the game runs with no
-- loot rolls (an old raid on Legacy Loot) hands each item straight to a player, and only
-- ENCOUNTER_LOOT_RECEIVED tells. While CRT Looting is on and you lead it, an item it says you received
-- after a kill with no roll goes on the list as won, so Start session can give it out, when it is in your
-- loot filter (one outside it is yours to keep, and isn't listed). A kill the game
-- rolled on (BL:SawRoll, from LootMaster/Rolls.lua) never adds one, so a rolled drop isn't listed twice.
-- Other players' items are theirs: only what is in your bags can be given out. Whether the game lets you
-- trade it is the game's rule; the trade says so.
--
-- Test boss kills (Alex, 2026-10-22: "clicking test multiple times to indicate multiple boss kills and
-- then end session closes out all loot during that session"). Loot Master > Tonight's Test boss kill
-- (LM:TestBossKill, LootMaster/Test.lua) adds sample items through BL:AddReceived, as a kill with no roll
-- does, flagged test: each row is won, ticked, has r.test and its kill's boss label (r.boss). A TEST row
-- leaves LM.BOSS_SECONDS after its kill, has no trade time, is never kept for a /reload and doesn't open
-- the window. It never goes into a real session: Start session with both kinds ticked starts the real
-- ones only and says so; one with only TEST rows starts a test session (LM:Start's test). When a test
-- session started from them ends and no TEST items wait for their turn, the TEST rows go (BL:ClearTests;
-- End session clears them too).
--
-- Items from your bags (Alex, 2026-10-22: "drag and drop and also shift-click from bags to add to a session
-- list just in case someone messes it up later"). Loot Master > Tonight's Add item (LootMaster/AddItem.lua)
-- puts an item you can still trade on the list through BL:AddFromBags: a real row, won, ticked, r.bags
-- ("from your bags"), leaving when the trade time the game shows for it is over. An item that isn't bound
-- has no trade time (r.untimed): it gets its own end, LM.TRADE_SECONDS after it was added, kept like any
-- other row's, and no trade warning.
--
-- End all (LootMaster/EndAll.lua) sends the real items waiting behind a session back to the list,
-- unticked (BL:ReturnWaiting); waiting TEST items are dropped.

local LM = CRT.LootMaster
local BL = { rows = {}, waiting = {} }
LM.BossLoot = BL

local TEXT = {
    cleared = "Loot Master cleared the boss loot list: %s.",
    dropped = "Loot Master dropped the waiting boss loot: %s.",
    testEnded = "Loot Master ended the test session to start this one.",
    queued = "Loot Master: %d %s will start when the running session ends.",
    expired = "Loot Master: %d won %s left the boss loot list: the game's 2 hours to trade %s are over.",
    expiredUnbound = "Loot Master: %d unbound %s left the boss loot list: %s time on the list is over.",
    tooOld = "the game's 2 hours to trade it are over",
    warn = "Loot Master: %s can be traded for about %d more minutes. Start a session soon or it can't be given out.",
    realOnly = "Loot Master started the real items only. TEST items never go into a real session; they stay in the list.",
}

local function secret(v)
    return issecretvalue and issecretvalue(v) or false
end

local function readable(...)
    for i = 1, select("#", ...) do
        if secret((select(i, ...))) then
            return false
        end
    end
    return true
end

-- The link's item string, its empty tail dropped so a message stays small.
function LM.LinkItemString(link)
    local s = type(link) == "string" and link:match("|H(item:[^|]+)|h")
    return s and (s:gsub(":+$", "")) or nil
end

local function itemID(s)
    return tonumber(tostring(s or ""):match("item:(%d+)"))
end

-- Results already applied: each drop once ({ ["<encounterID>:<lootListID>"] = true }), and per item string
-- how many rows a result has set, and how many results each source has given, so the loot history and
-- the receive event for the same drop count once.
local applied, fromSource = {}, { history = {}, received = {} }
local rolledKill -- the kill (its time) the game last started a roll after, while you led CRT Looting
local nextOwn = 0 -- received rows' rollIDs: -1, -2, … so they never meet the game's

LM.TRADE_SECONDS = 7200 -- the game's time to trade a looted item to others who could loot it
LM.TRADE_WARN = 900 -- chat warns this long before a won item's trade time runs out

-- Keeps the list and the waiting items for a /reload: each time left as a clock time (time()). TEST rows
-- and waiting TEST items are left out, so a /reload drops them.
local function store()
    CRTDBChar = type(CRTDBChar) == "table" and CRTDBChar or {}
    CRTDBChar.lootmaster = type(CRTDBChar.lootmaster) == "table" and CRTDBChar.lootmaster or {}
    local now, wall = GetTime(), time()
    local rows, waiting = {}, {}
    for _, r in ipairs(BL.rows) do
        if not r.test then
            local c = {}
            for k, v in pairs(r) do
                c[k] = v
            end
            c.at, c.expires, c.endsAt = nil, nil, r.expires and (wall + math.floor(r.expires - now + 0.5)) or nil
            rows[#rows + 1] = c
        end
    end
    for _, w in ipairs(BL.waiting) do
        if not w.test then
            local items = {}
            for _, it in ipairs(w.items) do
                items[#items + 1] = { itemString = it.itemString, link = it.link, ilvl = it.ilvl, untimed = it.untimed, bags = it.bags,
                    endsAt = it.expires and (wall + math.floor(it.expires - now + 0.5)) or nil }
            end
            waiting[#waiting + 1] = { items = items }
        end
    end
    if #rows == 0 and #waiting == 0 then
        CRTDBChar.lootmaster.bossLootList = nil
        return
    end
    CRTDBChar.lootmaster.bossLootList = { rows = rows, waiting = waiting, boss = BL.boss, difficulty = BL.difficulty }
end

-- Whether the list has a real (not TEST) row.
local function hasReal()
    for _, r in ipairs(BL.rows) do
        if not r.test then
            return true
        end
    end
    return false
end

local function changed(what)
    if not hasReal() then -- TEST rows have no badge and no results
        BL.boss, BL.difficulty = nil, nil -- the badge follows the next kill's rows
        applied, fromSource = {}, { history = {}, received = {} }
    end
    store()
    LM:Fire("bossloot", what or "changed")
end

-- Expiry ---------------------------------------------------------------------------------------------

local expire -- set below

-- The chat lines for won rows that left: those with a trade time, and unbound ones (no trade time).
local function sayGone(won, unbound)
    if won > 0 then
        CRT:Print(TEXT.expired:format(won, won == 1 and "item" or "items", won == 1 and "it" or "them"))
    end
    if unbound > 0 then
        CRT:Print(TEXT.expiredUnbound:format(unbound, unbound == 1 and "item" or "items", unbound == 1 and "its" or "their"))
    end
end

-- Seconds left to trade a won row, or nil for any other row (a TEST row and an untimed row have no trade
-- time).
function BL.TradeLeft(r)
    if r.status ~= "won" or not r.expires or r.test or r.untimed then
        return nil
    end
    return math.max(0, r.expires - GetTime())
end

-- Chat warns once per won row when its trade time is nearly over.
local function warn()
    for _, r in ipairs(BL.rows) do
        local left = BL.TradeLeft(r)
        if left and left > 0 and left <= LM.TRADE_WARN + 1 and not r.warned then
            r.warned = true
            CRT:Print(TEXT.warn:format(r.link, math.max(1, math.floor(left / 60 + 0.5))))
            changed()
        end
    end
end

-- The row's clocks: when it leaves, and the warning before that for a won row.
local function schedule(r)
    if not r.expires then
        return
    end
    local now = GetTime()
    C_Timer.After(math.max(0, r.expires - now) + 0.05, expire)
    if r.status == "won" and not r.warned and not r.test and not r.untimed then
        C_Timer.After(math.max(0, r.expires - LM.TRADE_WARN - now), warn)
    end
end

-- A row is yours now: it stays until its trade time is over (a TEST row: LM.BOSS_SECONDS, as set by BL:Add).
-- seconds: the trade time left, when the game showed it (an item from your bags), else LM.TRADE_SECONDS.
local function own(r, seconds)
    r.status, r.winner, r.warned = "won", nil, nil
    if not r.test then
        r.expires = GetTime() + ((not r.untimed and seconds) or LM.TRADE_SECONDS) -- untimed: its own end
    end
    schedule(r)
end

expire = function()
    local now, kept, n, won, unbound = GetTime(), {}, #BL.rows, 0, 0
    for _, r in ipairs(BL.rows) do
        if not (r.expires and now >= r.expires) then
            kept[#kept + 1] = r
        elseif r.status == "won" and not r.test and r.untimed then
            unbound = unbound + 1
        elseif r.status == "won" and not r.test then
            won = won + 1
        end
    end
    if #kept ~= n then
        BL.rows = kept
        sayGone(won, unbound)
        changed(#kept == 0 and "cleared" or "changed")
    end
end

-- Rows -----------------------------------------------------------------------------------------------

function BL:Rows()
    return self.rows
end

function BL:Row(rollID)
    for _, r in ipairs(self.rows) do
        if r.rollID == rollID then
            return r
        end
    end
    return nil
end

-- A boss roll the leader's CRT handled. fields: status ("rolling" or "cant"), rollType, reason, and test
-- for a test boss kill's row; bags and tradeSeconds for an item from your bags. kill: LM:LastKill(), or a
-- test kill (nil for an item from your bags). Returns the row, or nil without a link (the caller says so
-- in chat).
function BL:Add(rollID, link, fields, kill)
    local s = LM.LinkItemString(link)
    if not s or self:Row(rollID) then
        return nil
    end
    local test = fields.test and true or nil
    local first = not test and not hasReal() -- a real list's first row opens the window
    if not test and not fields.bags then -- an item from your bags is no kill's: the badge stays
        -- the badge shows the newest real kill's boss
        self.boss = kill and kill.name or self.boss
        local ok, _, _, _, difficultyName = pcall(GetInstanceInfo)
        self.difficulty = (ok and type(difficultyName) == "string" and not secret(difficultyName)) and difficultyName or nil
    end
    -- an item from your bags is the leader's own choice: the loot filter isn't asked (no skip, no chat line)
    local pass, why = true, nil
    if not fields.bags then
        pass, why = LM:FilterLoot(s, "boss", link)
    end
    local okL, ilvl = pcall(C_Item.GetDetailedItemLevelInfo, link)
    local age = (kill and type(kill.at) == "number") and math.max(0, time() - kill.at) or 0
    local r = {
        rollID = rollID, link = link, itemString = s, ilvl = (okL and type(ilvl) == "number" and not secret(ilvl)) and ilvl or nil,
        at = GetTime(), expires = GetTime() + math.max(0, LM.BOSS_SECONDS - age), pass = pass and true or false, why = why,
        status = fields.status, rollType = fields.rollType, reason = fields.reason, received = fields.received, bags = fields.bags,
        untimed = fields.untimed,
        encounterID = kill and kill.encounterID or nil,
        boss = kill and kill.name or nil, killAt = kill and kill.at or nil, test = test,
    }
    r.ticked = (r.pass or test or r.bags) and r.status ~= "cant" -- TEST and bag rows: ticked even outside the filter
    self.rows[#self.rows + 1] = r
    if r.status == "won" then
        own(r, fields.tradeSeconds)
    else
        schedule(r)
    end
    changed(first and "open" or "changed")
    return r
end

-- The game started a roll after this kill (LM:LastKill()): items received from it came from rolls.
function BL:SawRoll(kill)
    rolledKill = kill and kill.at or rolledKill
end

-- An item the game gave you after kill with no roll: a won row, or nil (no link, or already listed).
-- test: a test boss kill's sample item (LM:TestBossKill), a TEST row.
function BL:AddReceived(link, kill, test)
    nextOwn = nextOwn - 1
    if test then
        return self:Add(nextOwn, link, { status = "won", test = true }, kill)
    end
    return self:Add(nextOwn, link, { status = "won", received = true }, kill)
end

-- An item from your bags (Loot Master > Tonight's Add item): a won, ticked real row marked "from your bags",
-- leaving after seconds (the trade time the game shows for it; nil: LM.TRADE_SECONDS). untimed: an item
-- that isn't bound, with no trade time (it leaves with the other rows).
function BL:AddFromBags(link, seconds, untimed)
    nextOwn = nextOwn - 1
    return self:Add(nextOwn, link, { status = "won", bags = true, tradeSeconds = seconds, untimed = untimed and true or nil })
end

-- Whether the list has a TEST row.
function BL:HasTests()
    for _, r in ipairs(self.rows) do
        if r.test then
            return true
        end
    end
    return false
end

-- How many kills the rows came from (each kill's boss and time once; a row kept from before rows had
-- them, by its encounterID, or not counted when it has neither), and how many rows.
function BL:Held()
    local kills, n = {}, 0
    for _, r in ipairs(self.rows) do
        local key
        if r.boss or r.killAt then
            key = "kill:" .. tostring(r.boss) .. ":" .. tostring(r.killAt)
        elseif r.encounterID then
            key = "encounter:" .. tostring(r.encounterID)
        end
        if key and not kills[key] then
            kills[key], n = true, n + 1
        end
    end
    return n, #self.rows
end

-- The rows Start session would send now: the ticked won real rows, or with none, the ticked won TEST
-- rows (TEST rows never mix with real ones). Returns them and whether they are TEST rows, and whether
-- TEST rows were ticked beside real ones.
local function toStart()
    local real, tests = {}, {}
    for _, r in ipairs(BL.rows) do
        if r.ticked and r.status == "won" then
            local list = r.test and tests or real
            list[#list + 1] = r
        end
    end
    if #real > 0 then
        return real, false, #tests > 0
    end
    return tests, true, false
end

-- How many items Start session would send now (Loot Master > Tonight's Start session (N)).
function BL:StartCount()
    return #(toStart())
end

-- Whether a row can be ticked: only one that is yours or may still be.
function BL.Tickable(r)
    return r.status == "rolling" or r.status == "won"
end

function BL:SetTicked(rollID, on)
    local r = self:Row(rollID)
    if r and BL.Tickable(r) then
        r.ticked = on and true or false
        changed()
    end
end

-- ticked, rows, ticked rows still rolling, ticked rows won.
function BL:Counts()
    local ticked, rolling, won = 0, 0, 0
    for _, r in ipairs(self.rows) do
        if r.ticked then
            ticked = ticked + 1
            if r.status == "rolling" then
                rolling = rolling + 1
            elseif r.status == "won" then
                won = won + 1
            end
        end
    end
    return ticked, #self.rows, rolling, won
end

-- Whether Start session can run now: true, or false and why ("rolling", "none"). A running session
-- doesn't stop it (BL:Start); BL:Busy says one is.
function BL:CanStart()
    local _, _, rolling, won = self:Counts()
    if rolling > 0 then
        return false, "rolling"
    elseif won == 0 then
        return false, "none"
    end
    return true
end

-- Whether a real loot session is running or boss loot waits for one: Start session queues behind it.
function BL:Busy()
    return (LM.current and not LM.current.test) or #self.waiting > 0
end

local startNext
startNext = function()
    if LM.current or #BL.waiting == 0 then
        return
    end
    local w = table.remove(BL.waiting, 1)
    local items, now = {}, GetTime()
    for _, it in ipairs(w.items) do
        if (it.expires or now + 1) > now then
            items[#items + 1] = it
        elseif not w.test then -- a TEST item's 10 minutes are over: dropped without a word
            CRT:Print(TEXT.dropped:format(it.link .. ": " .. TEXT.tooOld))
        end
    end
    if #items == 0 then
        changed()
        return startNext()
    end
    w.items = items
    local send = {}
    for _, it in ipairs(items) do
        send[#send + 1] = { itemString = it.itemString, link = it.link, ilvl = it.ilvl }
    end
    local s = LM:Start(send, w.test)
    if not s then
        table.insert(BL.waiting, 1, w) -- LM:Start said why; tried again when a session ends
    elseif w.test then
        s.fromHeld = true -- started from held TEST rows: its end clears them
    end
    changed()
end

-- Start session: the ticked rows you have won, LM.MAX_ITEMS a session. A running test is ended first; a
-- running real session keeps going and these all wait for it. They leave the list once the first session
-- has started or they are waiting; when LM:Start refuses (it says why), they stay. The Loot Master window
-- shows either way. Returns the number of items sent, or false and why (BL:CanStart's, or "failed").
-- TEST rows never mix with real ones: with both ticked only the real ones start, and chat says so; with
-- only TEST rows ticked it is a test session (sessions and waiting items carry test).
local starting = false -- while Start ends a running test, so that end doesn't clear the TEST rows

function BL:Start()
    local ok, why = self:CanStart()
    if not ok then
        return false, why
    end
    local picked, test, mixed = toStart()
    local going = {}
    for _, r in ipairs(picked) do
        going[r] = true
    end
    local items, kept = {}, {}
    for _, r in ipairs(self.rows) do
        if going[r] then
            items[#items + 1] = { itemString = r.itemString, link = r.link, ilvl = r.ilvl, expires = r.expires, untimed = r.untimed, bags = r.bags, row = r }
        else
            kept[#kept + 1] = r
        end
    end
    if mixed then
        CRT:Print(TEXT.realOnly)
    end
    local chunks = {}
    for i = 1, #items, LM.MAX_ITEMS do
        local chunk = {}
        for j = i, math.min(#items, i + LM.MAX_ITEMS - 1) do
            chunk[#chunk + 1] = items[j]
        end
        chunks[#chunks + 1] = { items = chunk, test = test or nil }
    end
    if self:Busy() then
        self.rows = kept
        for _, c in ipairs(chunks) do
            self.waiting[#self.waiting + 1] = c
        end
        CRT:Print(TEXT.queued:format(#items, #items == 1 and "item" or "items"))
        startNext() -- boss loot left waiting by a refused start goes now, when nothing runs
        changed()
        if LM.current then
            LM:ShowWindow()
        end
        return #items
    end
    if LM.current and LM.current.test then
        starting = true
        LM:End()
        starting = false
        CRT:Print(TEXT.testEnded)
    end
    local send = {}
    for _, it in ipairs(chunks[1].items) do
        send[#send + 1] = { itemString = it.itemString, link = it.link, ilvl = it.ilvl }
    end
    local s = LM:Start(send, test)
    if not s then
        changed()
        return false, "failed"
    end
    if test then
        s.fromHeld = true -- started from held TEST rows: its end clears them
    end
    self.rows = kept
    for i = 2, #chunks do
        self.waiting[#self.waiting + 1] = chunks[i]
    end
    changed()
    return #items
end

-- Empties the list (why: words for chat, or nil for the Clear button) and drops the waiting sessions.
function BL:Clear(why)
    local had = #self.rows > 0 or #self.waiting > 0
    self.rows, self.waiting = {}, {}
    if had then
        if why then
            CRT:Print(TEXT.cleared:format(why))
        end
        changed("cleared")
    end
end

-- How many items wait behind the running session, in all the waiting chunks.
function BL:WaitingCount()
    local n = 0
    for _, w in ipairs(self.waiting) do
        n = n + #w.items
    end
    return n
end

-- How many real and TEST items wait behind the running session.
function BL:WaitingKinds()
    local real, tests = 0, 0
    for _, w in ipairs(self.waiting) do
        if w.test then
            tests = tests + #w.items
        else
            real = real + #w.items
        end
    end
    return real, tests
end

-- End all (LootMaster/EndAll.lua): the real items waiting behind the running session go back to the list,
-- unticked, each with the time it had left (one whose time is over is dropped); waiting TEST items are
-- dropped. Returns how many went back.
function BL:ReturnWaiting()
    if #self.waiting == 0 then
        return 0
    end
    local now, back = GetTime(), 0
    for _, w in ipairs(self.waiting) do
        for _, it in ipairs(w.test and {} or w.items) do
            if it.expires and it.expires > now then
                local r = it.row
                if not r then -- kept through a /reload: rebuilt as a won row
                    nextOwn = nextOwn - 1
                    r = { rollID = nextOwn, link = it.link, itemString = it.itemString, ilvl = it.ilvl, pass = true, status = "won",
                        bags = it.bags, untimed = it.untimed, received = not it.bags or nil, at = now }
                end
                r.expires = it.expires
                r.ticked = false
                self.rows[#self.rows + 1] = r
                schedule(r)
                back = back + 1
            end
        end
    end
    self.waiting = {}
    changed()
    return back
end

-- Removes the TEST rows and the TEST items waiting for their turn; real rows stay.
function BL:ClearTests()
    local rows, waiting = {}, {}
    for _, r in ipairs(self.rows) do
        if not r.test then
            rows[#rows + 1] = r
        end
    end
    for _, w in ipairs(self.waiting) do
        if not w.test then
            waiting[#waiting + 1] = w
        end
    end
    if #rows ~= #self.rows or #waiting ~= #self.waiting then
        self.rows, self.waiting = rows, waiting
        changed(#rows == 0 and "cleared" or "changed")
    end
end

local function testsWaiting()
    for _, w in ipairs(BL.waiting) do
        if w.test then
            return true
        end
    end
    return false
end

-- Results --------------------------------------------------------------------------------------------

-- The oldest row still rolling for this item from this boss (encounterID; nil matches any): the same
-- item string first, else the same item ID.
local function rowFor(link, encounterID)
    local s = LM.LinkItemString(link)
    local id = itemID(s)
    local byID
    for _, r in ipairs(BL.rows) do
        if r.status == "rolling" and (encounterID == nil or r.encounterID == nil or r.encounterID == encounterID) then
            if s and r.itemString == s then
                return r
            end
            if not byID and id and itemID(r.itemString) == id then
                byID = r
            end
        end
    end
    return byID
end

-- A roll's result from source ("history" or "received"): who won (full or short name), whether it was
-- you, or nobody (everyone passed). Each source's nth result for a boss's item is the nth drop of it, so
-- a drop both sources report sets one row only. Returns true when a row changed.
function BL:Result(link, winner, isSelf, allPassed, encounterID, source)
    local r = rowFor(link, encounterID)
    if not r then
        return false
    end
    if not (isSelf == true or allPassed == true or (type(winner) == "string" and winner ~= "")) then
        return false
    end
    local key = tostring(r.encounterID or encounterID or "?") .. ":" .. tostring(itemID(r.itemString))
    local seen = fromSource[source or "history"] or fromSource.history
    seen[key] = (seen[key] or 0) + 1
    if seen[key] <= (applied[key] or 0) then
        return false -- the other source has told this drop already
    end
    applied[key] = (applied[key] or 0) + 1
    if isSelf == true then
        own(r)
    elseif allPassed == true then
        r.status, r.ticked = "nowinner", false
    else
        r.status, r.winner, r.ticked = "lost", winner, false
    end
    changed()
    return true
end

local drops = {} -- the history's drops that set a row: { ["<encounterID>:<lootListID>"] = true }

local function fromHistory(encounterID, lootListID)
    if not readable(encounterID, lootListID) or #BL.rows == 0 or not (C_LootHistory and C_LootHistory.GetSortedInfoForDrop) then
        return
    end
    local drop = tostring(encounterID) .. ":" .. tostring(lootListID)
    if drops[drop] then
        return -- its winner is in already; later updates of the same drop change nothing
    end
    local ok, info = pcall(C_LootHistory.GetSortedInfoForDrop, encounterID, lootListID)
    if not ok or type(info) ~= "table" or not readable(info.itemHyperlink, info.allPassed) then
        return
    end
    local w = type(info.winner) == "table" and info.winner or nil
    local set = false
    if w and readable(w.playerName, w.isSelf) then
        set = BL:Result(info.itemHyperlink, w.playerName, w.isSelf == true, false, encounterID, "history")
    elseif info.allPassed == true then
        set = BL:Result(info.itemHyperlink, nil, false, true, encounterID, "history")
    end
    if set or (w and readable(w.playerName)) or info.allPassed == true then
        drops[drop] = true
    end
end

-- An item the game gave you with no roll, after a kill here while you lead CRT Looting.
local function receivedDirect(link, encounterID)
    local kill = LM:LastKill()
    if not kill or rolledKill == kill.at or not LM:LootingOn() or not LM.InstanceKey() or kill.instance ~= LM.InstanceKey() then
        return
    end
    if kill.encounterID and encounterID and kill.encounterID ~= encounterID then
        return
    end
    local s = LM.LinkItemString(link)
    if not s or not LM:FilterLoot(s, "boss", link) then
        return
    end
    BL:AddReceived(link, kill)
end

local function received(encounterID, _, link, _, playerName)
    if not readable(encounterID, link, playerName) or type(playerName) ~= "string" or type(link) ~= "string" then
        return
    end
    local me = LM:Me()
    local full = LM.FullName(playerName)
    local isSelf = full ~= nil and full == me
    local enc = type(encounterID) == "number" and encounterID or nil
    if #BL.rows > 0 and BL:Result(link, playerName, isSelf, false, enc, "received") then
        return
    end
    if isSelf then
        receivedDirect(link, enc)
    end
end

-- Emptying -------------------------------------------------------------------------------------------

-- A test session's end clears the TEST rows, unless TEST items wait to start next (or Start session ended
-- it to start another). Only a session started from held TEST rows: an instant test (/crt loot test)
-- leaves them; Loot Master > Tonight's End session clears them itself.
LM:OnChange(function(what, s)
    if what == "ended" then
        if type(s) == "table" and s.test and s.fromHeld and not starting and not testsWaiting() then
            BL:ClearTests()
        end
        startNext()
    end
end)

-- At login: the kept list back, each row with the time it had left (rows whose time is over are dropped,
-- won ones said in chat), its rollID CRT's own.
function BL:Load()
    local kept = CRTDBChar and type(CRTDBChar.lootmaster) == "table" and CRTDBChar.lootmaster.bossLootList
    if type(kept) ~= "table" then
        return
    end
    local now, wall, gone, unbound = GetTime(), time(), 0, 0
    self.rows, self.waiting = {}, {}
    for _, c in ipairs(type(kept.rows) == "table" and kept.rows or {}) do
        local left = type(c.endsAt) == "number" and c.endsAt - wall or 0
        if left > 0 and type(c.link) == "string" and not c.test then -- TEST rows are never kept
            nextOwn = nextOwn - 1
            c.rollID, c.at, c.expires, c.endsAt = nextOwn, now, now + left, nil
            self.rows[#self.rows + 1] = c
            schedule(c)
        elseif c.status == "won" and not c.test and c.untimed then
            unbound = unbound + 1
        elseif c.status == "won" and not c.test then
            gone = gone + 1
        end
    end
    for _, w in ipairs(type(kept.waiting) == "table" and kept.waiting or {}) do
        local items = {}
        for _, it in ipairs(type(w.items) == "table" and w.items or {}) do
            local left = type(it.endsAt) == "number" and it.endsAt - wall or 0
            if left > 0 then
                items[#items + 1] = { itemString = it.itemString, link = it.link, ilvl = it.ilvl, expires = now + left, untimed = it.untimed, bags = it.bags }
            elseif it.untimed then
                unbound = unbound + 1
            else
                gone = gone + 1
            end
        end
        if #items > 0 then
            self.waiting[#self.waiting + 1] = { items = items }
        end
    end
    self.boss, self.difficulty = kept.boss, kept.difficulty
    sayGone(gone, unbound)
    warn()
    changed(#self.rows > 0 and "open" or "changed")
    startNext()
end

local events = CreateFrame("Frame")
for _, e in ipairs({ "PLAYER_LOGIN", "ENCOUNTER_LOOT_RECEIVED" }) do
    events:RegisterEvent(e)
end
pcall(events.RegisterEvent, events, "LOOT_HISTORY_UPDATE_DROP")
events:SetScript("OnEvent", function(_, event, ...)
    if event == "LOOT_HISTORY_UPDATE_DROP" then
        fromHistory(...)
    elseif event == "ENCOUNTER_LOOT_RECEIVED" then
        received(...)
    elseif event == "PLAYER_LOGIN" then
        BL:Load()
    end
end)
