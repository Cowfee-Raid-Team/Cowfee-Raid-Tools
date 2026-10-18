local ADDON, CRT = ...

-- RCLootCouncil, read only: when it is loaded, its own saved awards add the council's response, colour,
-- note and votes to the matching Loot History records. Nothing is ever written to its data, and the
-- matches are kept only for the session (Loot.rc[record]), so a re-scan always reads it fresh.
--
-- RCLootCouncil's saved data, VERSION-SENSITIVE (read from RCLootCouncil's history format; if an update
-- moves it, this block is the one place to fix):
--   RCLootCouncilLootDB.factionrealm["<Faction> - <Realm>"][winner "Name-Realm"] = { entry, ... }
--   entry: lootWon (an item link), date ("dd/mm/yy"), time ("HH:MM:SS"), response, color ({ r, g, b }),
--          note, votes
-- A record matches an award with the same winner and item ID within MATCH_SECONDS of each other.

local Loot = CRT.Loot
local R = Loot.R
local RC = { report = nil }
CRT.LootRCLC = RC

local WIRE = {
    addon = "RCLootCouncil",
    savedVariable = "RCLootCouncilLootDB",
    datePattern = "^(%d+)/(%d+)/(%d+)$", -- day/month/two-digit year
    timePattern = "^(%d+):(%d+):?(%d*)$",
}
local MATCH_SECONDS = 4 * 3600 -- an award is often given a while after the drop

local function awardTime(entry)
    local d, m, y = tostring(entry.date or ""):match(WIRE.datePattern)
    local hh, mm, ss = tostring(entry.time or ""):match(WIRE.timePattern)
    if not (d and hh) then
        return nil
    end
    y = tonumber(y)
    if y < 100 then
        y = y + 2000
    end
    return time({ year = y, month = tonumber(m), day = tonumber(d), hour = tonumber(hh), min = tonumber(mm),
        sec = tonumber(ss) or 0 })
end

function RC:Available()
    return C_AddOns and C_AddOns.IsAddOnLoaded and C_AddOns.IsAddOnLoaded(WIRE.addon) and type(_G[WIRE.savedVariable]) == "table"
end

local function awards()
    local data = _G[WIRE.savedVariable]
    local key = (UnitFactionGroup("player") or "") .. " - " .. (GetRealmName() or "")
    return type(data) == "table" and type(data.factionrealm) == "table" and data.factionrealm[key] or nil, key
end

-- Reads RCLootCouncil's awards and matches them to records. Returns a report table.
function RC:Scan()
    wipe(Loot.rc)
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
    for winner, entries in pairs(list) do
        if type(entries) == "table" then
            for _, entry in ipairs(entries) do
                if type(entry) == "table" then
                    report.awards = report.awards + 1
                    local itemID = tonumber(tostring(entry.lootWon or ""):match("item:(%d+)"))
                    local at = awardTime(entry)
                    local best, bestGap
                    for _, rec in ipairs(itemID and at and index[tostring(winner):lower() .. "#" .. itemID] or {}) do
                        local gap = math.abs(rec[R.TIME] - at)
                        if gap <= MATCH_SECONDS and not Loot.rc[rec] and (not bestGap or gap < bestGap) then
                            best, bestGap = rec, gap
                        end
                    end
                    if best then
                        local c = type(entry.color) == "table" and entry.color or nil
                        Loot.rc[best] = {
                            response = entry.response and tostring(entry.response) or nil,
                            color = c and { tonumber(c[1]) or 1, tonumber(c[2]) or 1, tonumber(c[3]) or 1 } or nil,
                            note = entry.note and tostring(entry.note) or nil,
                            votes = tonumber(entry.votes),
                        }
                        report.matched = report.matched + 1
                    else
                        report.unmatched = report.unmatched + 1
                    end
                end
            end
        end
    end
    Loot:Fire("reset")
    return report
end

function RC:ReportText()
    local r = self.report or self:Scan()
    if r.off then
        return "RCLootCouncil matching is off (Loot History > Settings)."
    end
    if not r.available then
        return "RCLootCouncil is not loaded, or has no saved awards."
    end
    return string.format("RCLootCouncil (%s): %d awards, %d matched to records, %d not matched; %d records.",
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
