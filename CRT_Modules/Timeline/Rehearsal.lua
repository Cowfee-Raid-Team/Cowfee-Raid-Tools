local ADDON, CRT = ...

-- Timeline Rehearsal: the clock and the model the rehearsal window draws from. No frames here.
-- The clock turns the game's clock (GetTime) into fight seconds: it can play at 1x, 2x or 4x, pause,
-- jump, and it holds at the fight's length. The model is the fight laid out as a list of casts
-- (from the reference and spell lanes only, in time order) and phases. A cast's lane field is the
-- lane table itself. Its color is the lane's color or nil (the window then uses the type color).

local Rehearsal = {}
CRT.TimelineRehearsal = Rehearsal

Rehearsal.CAST = 5         -- seconds a fake cast bar shows, ending on the cast's time
Rehearsal.STRIP_SPAN = 40  -- seconds the strip shows, "now" a third of the way across

local Clock = {}
Clock.__index = Clock

-- Fight seconds now. Past the length it holds there and stops playing.
function Clock:Now()
    if self.playing then
        local t = self.base + (GetTime() - self.anchor) * self.speed
        if self.length > 0 and t >= self.length then
            self.base, self.playing = self.length, false
            return self.length
        end
        return t
    end
    return self.base
end

-- Re-anchors at the current fight time, so a change of play state or speed never moves it.
local function settle(self)
    self.base = self:Now()
    self.anchor = GetTime()
end

function Clock:Play()
    settle(self)
    if self.length > 0 and self.base >= self.length then return end
    self.playing = true
end

function Clock:Pause()
    settle(self)
    self.playing = false
end

function Clock:Playing()
    self:Now() -- stops at the length
    return self.playing
end

function Clock:Seek(t)
    t = tonumber(t) or 0
    if t < 0 then t = 0 end
    if self.length > 0 and t > self.length then t = self.length end
    self.base = t
    self.anchor = GetTime()
end

function Clock:SetSpeed(s)
    settle(self)
    s = tonumber(s)
    if s and s > 0 then self.speed = s end
end

function Clock:Speed() return self.speed end

function Clock:SetLength(len)
    settle(self)
    self.length = tonumber(len) or 0
    if self.length > 0 and self.base > self.length then self.base = self.length end
end

function Rehearsal.NewClock()
    return setmetatable({ base = 0, anchor = 0, playing = false, speed = 1, length = 0 }, Clock)
end

-- The model from Lanes.Build's lanes and extra: { casts, phases, length }.
function Rehearsal.Build(lanes, extra)
    local casts, phases = {}, {}
    for _, lane in ipairs(lanes or {}) do
        if lane.kind == "reference" or lane.kind == "spell" then
            for _, mark in ipairs(lane.marks or {}) do
                if type(mark.t) == "number" then
                    casts[#casts + 1] = { t = mark.t, name = lane.label, icon = lane.icon, color = lane.color, lane = lane }
                end
            end
        end
    end
    -- table.sort is not stable, so ties keep lane order through the index
    local order = {}
    for i, c in ipairs(casts) do order[c] = i end
    table.sort(casts, function(a, b)
        if a.t ~= b.t then return a.t < b.t end
        return order[a] < order[b]
    end)
    for _, ph in ipairs(extra and extra.phases or {}) do
        if type(ph.t) == "number" then phases[#phases + 1] = { t = ph.t, label = ph.label, title = ph.title } end
    end
    local porder = {}
    for i, p in ipairs(phases) do porder[p] = i end
    table.sort(phases, function(a, b)
        if a.t ~= b.t then return a.t < b.t end
        return porder[a] < porder[b]
    end)
    local length = extra and tonumber(extra.length) or 0
    if length <= 0 then length = casts[#casts] and casts[#casts].t or 0 end
    return { casts = casts, phases = phases, length = length }
end

-- The cast bar at time t: of the casts showing (each shows for CAST seconds, ending on its time),
-- the one that ends first.
function Rehearsal.CastAt(model, t)
    local CAST = Rehearsal.CAST
    for _, c in ipairs(model.casts) do
        if c.t - CAST > t then break end
        if t < c.t then
            return { cast = c, progress = (t - (c.t - CAST)) / CAST, remaining = c.t - t }
        end
    end
    return nil
end

-- The next n casts at or after t, in time order, leaving out skip (the cast the cast bar shows).
function Rehearsal.NextUp(model, t, n, skip)
    local out = {}
    for _, c in ipairs(model.casts) do
        if #out >= n then break end
        if c.t >= t and c ~= skip then out[#out + 1] = c end
    end
    return out
end

-- The phases at or before t, in order.
function Rehearsal.PhasesUpTo(model, t)
    local out = {}
    for _, p in ipairs(model.phases) do
        if p.t <= t then out[#out + 1] = p end
    end
    return out
end
