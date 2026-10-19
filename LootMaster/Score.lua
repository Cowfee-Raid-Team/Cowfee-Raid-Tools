local ADDON, CRT = ...

-- Raider Score, from the Late Tracker's saved nights (CRTDB late.history, read through CRT.Late), so there
-- is no tracking of its own. Everyone starts at 100. In each night of the last `weeks` weeks where a player
-- was expected, a no-show costs `noShow`, and a late arrival `late` plus `per10` for every full ten minutes.
-- Each penalty shrinks by `recover` a week after its night, down to nothing. Settings are in CRTDB
-- lootmaster.score (the Settings tab). A player with no night in the window has no score (nil).
-- The scores are worked out once and kept until the Late Tracker or a setting changes (ScoreChanged).
-- Sharing nights between officers comes later; for now the score is from your own Late Tracker.

local LM = CRT.LootMaster

local WEEK = 7 * 86400
local START = 100

local cache -- lowercased name -> { name, score, nights, late, never, lastMiss }

local function cfg()
    return LM:Settings().score or {}
end

local function compute()
    local c = cfg()
    local out = {}
    local Late = CRT.Late
    local history = Late and Late.History and Late:History() or {}
    local now = time()
    local from = now - (tonumber(c.weeks) or 8) * WEEK
    for _, night in ipairs(history) do
        if night.startedAt and night.startedAt >= from then
            local weeksSince = math.max(0, (now - night.startedAt) / WEEK)
            for _, p in ipairs(night.players or {}) do
                local key = p.key and p.key:lower()
                if key then
                    local t = out[key]
                    if not t then
                        t = { name = p.key, penalty = 0, nights = 0, late = 0, never = 0 }
                        out[key] = t
                    end
                    t.nights = t.nights + 1
                    local penalty = 0
                    if p.never then
                        penalty = tonumber(c.noShow) or 0
                        t.never = t.never + 1
                    elseif Late.IsLate(night, p) then
                        local minutes = Late.Seconds(night, p) / 60
                        penalty = (tonumber(c.late) or 0) + (tonumber(c.per10) or 0) * math.floor(minutes / 10)
                        t.late = t.late + 1
                    end
                    if penalty > 0 then
                        t.penalty = t.penalty + math.max(0, penalty - (tonumber(c.recover) or 0) * math.floor(weeksSince))
                        t.lastMiss = math.max(t.lastMiss or 0, night.startedAt)
                    end
                end
            end
        end
    end
    for _, t in pairs(out) do
        t.score = math.max(0, math.floor(START - t.penalty + 0.5))
    end
    return out
end

local function scores()
    if not cache then
        cache = compute()
    end
    return cache
end

function LM.ScoreChanged()
    cache = nil
    if LM.Fire then
        LM:Fire("scores")
    end
end

-- A player's score, or nil (no nights in the window, or the score is turned off).
function LM.Score(name)
    if not cfg().show or type(name) ~= "string" then
        return nil
    end
    local t = scores()[name:lower()]
    return t and t.score or nil
end

function LM.ScoreDetails(name)
    return type(name) == "string" and scores()[name:lower()] or nil
end

-- Every scored player, lowest score first, for the Raider Score tab.
function LM.ScoreList()
    local list = {}
    for _, t in pairs(scores()) do
        list[#list + 1] = t
    end
    table.sort(list, function(a, b)
        if a.score ~= b.score then
            return a.score < b.score
        end
        return a.name:lower() < b.name:lower()
    end)
    return list
end

if CRT.Late and CRT.Late.OnChange then
    CRT.Late:OnChange(LM.ScoreChanged)
end
