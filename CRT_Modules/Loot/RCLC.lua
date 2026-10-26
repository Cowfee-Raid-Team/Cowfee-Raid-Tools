local ADDON, CRT = ...

-- RCLootCouncil, read only: when it is loaded, its saved awards are read into Loot History. An award that
-- matches a recorded item (same winner and item ID, within MATCH_SECONDS) is kept in Loot.rc[record]; one
-- that matches nothing (given before Loot History existed, or recorded on another computer) goes in
-- RC.unmatched, newest first, so the History list can show it as a row of its own. Nothing is ever
-- written to RCLootCouncil's data, and nothing here is saved: a scan reads it fresh, at login, a little
-- after new loot, and with Re-scan. This file is meant to go once Loot Master handles loot itself.
--
-- RCLootCouncil's saved data, VERSION-SENSITIVE. Learned from the saved data itself (never from its code),
-- 768 awards read on 2026-10-18. If an update moves it, the WIRE block and read() are the places to fix:
--   RCLootCouncilLootDB.factionrealm["<Faction> - <Realm>"][winner "Name-Realm"] = { entry, ... }
--   entry: lootWon (item link), date ("YYYY/MM/DD"; older versions "DD/MM/YY"), time ("HH:MM:SS"),
--          response (text), responseID (a number, or "PL", "BONUSROLL"), color ({ r, g, b, a }), class,
--          boss, instance ("Name-Difficulty"), mapID, difficultyID, groupSize, iClass, iSubClass, id, owner,
--          isAwardReason, votes, typeCode, roll, note, ilvl, itemReplaced1, itemReplaced2, tierToken,
--          sessionResponses = { ["Name-Realm"] = { response (a number like responseID, or text), roll,
--          ilvl, class } } (every candidate for that item)
-- A candidate's response is only a number; its name and colour are learned from the awards that carry the
-- same typeCode and responseID (RC:ResponseName).

local Loot = CRT.Loot
local R = Loot.R
local RC = { report = nil, unmatched = {} }
CRT.LootRCLC = RC

local WIRE = {
    addon = "RCLootCouncil",
    savedVariable = "RCLootCouncilLootDB",
    datePattern = "^(%d+)/(%d+)/(%d+)$", -- YYYY/MM/DD, or DD/MM/YY in older data
    timePattern = "^(%d+):(%d+):?(%d*)$",
    replaced = { "itemReplaced1", "itemReplaced2" },
    defaultType = "default",
}
local MATCH_SECONDS = 4 * 3600 -- an award is often given a while after the drop

local names = {} -- "typeCode:responseID" -> { text, color }, learned in each scan

-- A time() from an award's date and time, or nil when either can't be read.
function RC.ParseTime(dateText, timeText)
    local a, b, c = tostring(dateText or ""):match(WIRE.datePattern)
    local hh, mm, ss = tostring(timeText or ""):match(WIRE.timePattern)
    if not (a and hh) then
        return nil
    end
    local y, m, d
    if #a == 4 then
        y, m, d = tonumber(a), tonumber(b), tonumber(c)
    else
        d, m, y = tonumber(a), tonumber(b), tonumber(c)
        if y < 100 then
            y = y + 2000
        end
    end
    hh, mm, ss = tonumber(hh), tonumber(mm), tonumber(ss) or 0
    if m < 1 or m > 12 or d < 1 or d > 31 or hh > 23 or mm > 59 or ss > 59 then
        return nil
    end
    return time({ year = y, month = m, day = d, hour = hh, min = mm, sec = ss })
end

local function colorOf(c)
    if type(c) ~= "table" then
        return nil
    end
    return { tonumber(c[1]) or 1, tonumber(c[2]) or 1, tonumber(c[3]) or 1 }
end

local function typeOf(entry)
    return entry.typeCode and tostring(entry.typeCode) or WIRE.defaultType
end

-- The name and colour of a response number, as the awards with that number named it.
function RC:ResponseName(typeCode, id)
    if type(id) ~= "number" then
        return tostring(id or "?"), nil
    end
    local n = names[tostring(typeCode or WIRE.defaultType) .. ":" .. id] or names[WIRE.defaultType .. ":" .. id]
    if n then
        return n.text, n.color
    end
    return "Response " .. id, nil
end

function RC:Available()
    return C_AddOns and C_AddOns.IsAddOnLoaded and C_AddOns.IsAddOnLoaded(WIRE.addon) and type(_G[WIRE.savedVariable]) == "table"
end

local function awards()
    local data = _G[WIRE.savedVariable]
    local key = (UnitFactionGroup("player") or "") .. " - " .. (GetRealmName() or "")
    return type(data) == "table" and type(data.factionrealm) == "table" and data.factionrealm[key] or nil, key
end

-- Every award: fn(winner, entry).
local function eachAward(list, fn)
    for winner, entries in pairs(list) do
        if type(entries) == "table" then
            for _, entry in ipairs(entries) do
                if type(entry) == "table" then
                    fn(tostring(winner), entry)
                end
            end
        end
    end
end

local function learnNames(list)
    wipe(names)
    eachAward(list, function(_, entry)
        if type(entry.responseID) == "number" and entry.response then
            local key = typeOf(entry) .. ":" .. entry.responseID
            if not names[key] then
                names[key] = { text = tostring(entry.response), color = colorOf(entry.color) }
            end
        end
    end)
end

-- Everyone who answered for the item, best response first (lower numbers are RCLootCouncil's earlier
-- buttons), then the highest roll; text responses such as PASS after the numbered ones.
local function candidates(entry)
    local out = {}
    if type(entry.sessionResponses) ~= "table" then
        return out
    end
    for name, r in pairs(entry.sessionResponses) do
        if type(r) == "table" then
            local text, color = RC:ResponseName(typeOf(entry), r.response)
            out[#out + 1] = {
                name = tostring(name), responseID = r.response, response = text, color = color,
                roll = tonumber(r.roll), ilvl = tonumber(r.ilvl), class = r.class and tostring(r.class) or nil,
            }
        end
    end
    table.sort(out, function(a, b)
        local an, bn = type(a.responseID) == "number", type(b.responseID) == "number"
        if an ~= bn then
            return an
        end
        if an and a.responseID ~= b.responseID then
            return a.responseID < b.responseID
        end
        if (a.roll or -1) ~= (b.roll or -1) then
            return (a.roll or -1) > (b.roll or -1)
        end
        return a.name < b.name
    end)
    return out
end

-- One award, read into CRT's own shape.
local function read(winner, entry)
    local replaced = {}
    for _, field in ipairs(WIRE.replaced) do
        if type(entry[field]) == "string" and entry[field] ~= "" then
            replaced[#replaced + 1] = entry[field]
        end
    end
    local link = type(entry.lootWon) == "string" and entry.lootWon or nil
    return {
        winner = winner,
        link = link,
        itemString = link and link:match("item:[%-%d:]+") or nil,
        itemID = link and tonumber(link:match("item:(%d+)")) or nil,
        time = RC.ParseTime(entry.date, entry.time),
        response = entry.response and tostring(entry.response) or nil,
        responseID = entry.responseID,
        color = colorOf(entry.color),
        note = entry.note and tostring(entry.note) or nil,
        votes = tonumber(entry.votes),
        roll = tonumber(entry.roll),
        ilvl = tonumber(entry.ilvl),
        class = entry.class and tostring(entry.class) or nil,
        boss = entry.boss and tostring(entry.boss) or nil,
        instance = entry.instance and tostring(entry.instance) or nil,
        mapID = tonumber(entry.mapID),
        difficultyID = tonumber(entry.difficultyID),
        groupSize = tonumber(entry.groupSize),
        owner = entry.owner and tostring(entry.owner) or nil,
        typeCode = typeOf(entry),
        isAwardReason = entry.isAwardReason and true or false,
        tierToken = entry.tierToken and true or false,
        replaced = replaced,
        candidates = candidates(entry),
    }
end

-- Reads RCLootCouncil's awards and matches them to records. Returns a report table.
function RC:Scan()
    wipe(Loot.rc)
    wipe(self.unmatched)
    local report = { available = self:Available(), awards = 0, matched = 0, unmatched = 0, records = Loot:Count() }
    self.report = report
    if not report.available or not Loot:Settings().rcEnrich then
        report.off = not Loot:Settings().rcEnrich
        Loot:Fire("reset")
        return report
    end
    local list, key = awards()
    report.realmKey = key
    if type(list) ~= "table" then
        Loot:Fire("reset")
        return report
    end
    learnNames(list)
    -- the records, by winner and item, to look up each award
    local index = {}
    Loot:Each(function(rec)
        local player = Loot:Name("players", rec[R.PLAYER])
        local itemID = Loot.ItemID(rec[R.ITEM])
        if player and itemID then
            local k = player:lower() .. "#" .. itemID
            index[k] = index[k] or {}
            table.insert(index[k], rec)
        end
    end)
    eachAward(list, function(winner, entry)
        report.awards = report.awards + 1
        local award = read(winner, entry)
        local best, bestGap
        for _, rec in ipairs(award.itemID and award.time and index[winner:lower() .. "#" .. award.itemID] or {}) do
            local gap = math.abs(rec[R.TIME] - award.time)
            if gap <= MATCH_SECONDS and not Loot.rc[rec] and (not bestGap or gap < bestGap) then
                best, bestGap = rec, gap
            end
        end
        if best then
            Loot.rc[best] = award
            report.matched = report.matched + 1
        else
            self.unmatched[#self.unmatched + 1] = award
            report.unmatched = report.unmatched + 1
        end
    end)
    -- newest first, like the records; an award whose date can't be read goes last
    table.sort(self.unmatched, function(a, b)
        if (a.time ~= nil) ~= (b.time ~= nil) then
            return a.time ~= nil
        end
        if a.time and a.time ~= b.time then
            return a.time > b.time
        end
        return a.winner < b.winner
    end)
    Loot:Fire("reset")
    return report
end

function RC:ReportText()
    local r = self.report or self:Scan()
    if r.off then
        return "RCLootCouncil is off (Loot History > Settings)."
    end
    if not r.available then
        return "RCLootCouncil is not loaded, or has no saved awards."
    end
    return string.format("RCLootCouncil (%s): %d awards, %d matched to recorded items, %d shown on their own; %d records.",
        tostring(r.realmKey), r.awards, r.matched, r.unmatched, r.records)
end

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_LOGIN")
events:SetScript("OnEvent", function()
    -- after every addon's saved data is loaded
    C_Timer.After(2, function()
        RC:Scan()
    end)
end)

-- A new record may match an award RCLootCouncil gives later; a scan a little after it catches that.
local pendingScan = false
Loot:OnChange(function(what)
    if what == "added" and not pendingScan and RC:Available() and Loot:Settings().rcEnrich then
        pendingScan = true
        C_Timer.After(60, function()
            pendingScan = false
            RC:Scan()
        end)
    end
end)
