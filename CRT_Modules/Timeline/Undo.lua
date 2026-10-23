local ADDON, CRT = ...

-- Undo on the Timeline: Ctrl+Z puts back what the last change on the Timeline changed, and Ctrl+Y (or
-- Ctrl+Shift+Z) does it again. Timeline/View.lua takes the keys while a timeline shows.
--
-- It doesn't follow each action. It keeps a copy of everything the Timeline can change, item by item:
-- each note (CRT.db.notes.list[id]: the raid and personal notes), each boss's own reminders
-- (CRT.db.alerts.reminders[encounterID]) and each of your references, with its moved phase lines
-- (timeline.references, by id). It watches their owners' change events (Notes, Alerts, Timeline), and
-- when items differ from the copy while a timeline shows, a step with those items before and after goes
-- on the undo list. So every way of changing them from the Timeline is covered, the editor's saves and
-- dropped cooldowns too, and undo puts back only the items that step changed. Changes in one frame join
-- one step, so an action that writes two places undoes at once.
-- An item changed while no timeline shows (on the Raid Notes page), or by a note received from the raid
-- (Quietly), is dropped from the steps instead: Ctrl+Z never overwrites a later change made elsewhere,
-- and never puts back someone else's note. Settings (zoom, the chosen order, filters) are not undone.

local Undo = { past = {}, future = {}, frames = {} }
CRT.TimelineUndo = Undo

local MAX = 30 -- steps kept

local TEXT = {
    undone = "Undone (%d more to undo).",
    redone = "Redone (%d more to redo).",
    nothing = "Nothing to undo.",
    nothingRedo = "Nothing to redo.",
}

local GROUPS = { "notes", "reminders", "references" }

local last -- the copy of every item as it was after the last change seen: { notes = {}, ... }
local restoring = false -- putting items back: their own change events are not new changes
local quiet = 0 -- inside Quietly
local pushedAt -- GetTime() of the newest step, so changes in one frame join it

local function copy(v)
    if type(v) ~= "table" then
        return v
    end
    local out = {}
    for k, x in pairs(v) do
        out[k] = copy(x)
    end
    return out
end

local function same(a, b)
    if type(a) ~= "table" or type(b) ~= "table" then
        return a == b
    end
    for k, x in pairs(a) do
        if not same(x, b[k]) then
            return false
        end
    end
    for k in pairs(b) do
        if a[k] == nil then
            return false
        end
    end
    return true
end

-- The live tables, each found (and made) where its owner keeps it.
local function live()
    local db = CRT.db
    if not db then
        return nil
    end
    db.notes = db.notes or {}
    db.notes.list = db.notes.list or {}
    db.alerts = db.alerts or {}
    db.alerts.reminders = db.alerts.reminders or {}
    local tl = CRT.Timeline and CRT.Timeline:Settings()
    if tl then
        tl.references = tl.references or {}
    end
    return { notes = db.notes.list, reminders = db.alerts.reminders, references = tl and tl.references }
end

-- Every item, copied, keyed the way it is put back: references by their id.
local function capture()
    local t = live()
    if not t then
        return nil
    end
    local refs = {}
    for _, r in ipairs(t.references or {}) do
        if r.id ~= nil then
            refs[r.id] = copy(r)
        end
    end
    return { notes = copy(t.notes), reminders = copy(t.reminders), references = refs }
end

-- The items that differ between two captures: { { group, key }, ... }.
local function diff(a, b)
    local out = {}
    for _, g in ipairs(GROUPS) do
        local seen = {}
        for k, v in pairs(a[g]) do
            seen[k] = true
            if not same(v, b[g][k]) then
                out[#out + 1] = { g, k }
            end
        end
        for k in pairs(b[g]) do
            if not seen[k] then
                out[#out + 1] = { g, k }
            end
        end
    end
    return out
end

local function find(step, g, k)
    for _, item in ipairs(step) do
        if item.g == g and item.k == k then
            return item
        end
    end
end

-- Drops an item from every step (it changed elsewhere), and the steps left empty.
local function forget(g, k)
    for _, list in ipairs({ Undo.past, Undo.future }) do
        for i = #list, 1, -1 do
            local step = list[i]
            for j = #step, 1, -1 do
                if step[j].g == g and step[j].k == k then
                    table.remove(step, j)
                end
            end
            if #step == 0 then
                table.remove(list, i)
            end
        end
    end
end

-- A change event from the notes, the alerts or the Timeline.
local function changed()
    if restoring then
        return
    end
    local now = capture()
    if not now then
        return
    end
    if not last then
        last = now
        return
    end
    local items = diff(last, now)
    if #items == 0 then
        return
    end
    local mine = quiet == 0
    if mine then
        mine = false
        for _, f in ipairs(Undo.frames) do
            mine = mine or (f.IsVisible and f:IsVisible()) or false
        end
    end
    if mine then
        local t = GetTime()
        local step = Undo.past[#Undo.past]
        if pushedAt ~= t or not step then
            step = {}
            Undo.past[#Undo.past + 1] = step
            if #Undo.past > MAX then
                table.remove(Undo.past, 1)
            end
            pushedAt = t
        end
        for _, gk in ipairs(items) do
            local g, k = gk[1], gk[2]
            local item = find(step, g, k)
            if not item then
                item = { g = g, k = k, before = copy(last[g][k]) }
                step[#step + 1] = item
            end
            item.after = copy(now[g][k])
        end
        Undo.future = {}
    else
        for _, gk in ipairs(items) do
            forget(gk[1], gk[2])
        end
    end
    last = now
end
Undo.Changed = changed

-- Puts each item of a step back as it was before (or after, for a redo).
local function apply(step, side)
    local t = live()
    if not t then
        return
    end
    restoring = true
    local refsMoved = false
    for _, item in ipairs(step) do
        local v = copy(item[side])
        if item.g == "references" then
            local list = t.references or {}
            for i = #list, 1, -1 do
                if list[i].id == item.k then
                    table.remove(list, i)
                end
            end
            if v ~= nil then
                list[#list + 1] = v
            end
            refsMoved = true
        else
            -- a note's text written over is kept in its history, like a line changed on the Timeline
            if item.g == "notes" and type(v) == "table" and CRT.Notes and CRT.Notes.RememberRaw then
                pcall(CRT.Notes.RememberRaw, CRT.Notes, item.k, v.raw, "edited", { lines = true })
            end
            t[item.g][item.k] = v
        end
    end
    if refsMoved and t.references then
        -- ids only grow, so their order is the order they were added in
        table.sort(t.references, function(a, b)
            return (a.id or 0) < (b.id or 0)
        end)
    end
    -- each owner's change event, so every page and window redraws (and caches read again)
    for _, fire in ipairs({
        function() CRT.Notes:Fire() end,
        function() CRT.Alerts:Fire() end,
        function() CRT.Timeline:Fire() end,
    }) do
        pcall(fire)
    end
    restoring = false
    last = capture()
    pushedAt = nil
end

function Undo:Undo()
    changed() -- anything not yet seen is a step first
    local step = table.remove(self.past)
    if not step then
        CRT:Print(TEXT.nothing)
        return false
    end
    apply(step, "before")
    self.future[#self.future + 1] = step
    CRT:Print(string.format(TEXT.undone, #self.past))
    return true
end

function Undo:Redo()
    local step = table.remove(self.future)
    if not step then
        CRT:Print(TEXT.nothingRedo)
        return false
    end
    apply(step, "after")
    self.past[#self.past + 1] = step
    CRT:Print(string.format(TEXT.redone, #self.future))
    return true
end

-- Runs fn with its changes taken as changes made elsewhere, never undone (a note received from the raid).
function Undo:Quietly(fn, ...)
    quiet = quiet + 1
    local ok, err = pcall(fn, ...)
    changed()
    quiet = quiet - 1
    if not ok then
        error(err, 0)
    end
end

-- A timeline's frame: changes count while it shows. The first one takes the starting copy, so the
-- first change after login can be undone too.
function Undo:Watch(frame)
    self.frames[#self.frames + 1] = frame
    if not last then
        last = capture()
    end
end

if CRT.Notes and CRT.Notes.OnChange then
    CRT.Notes:OnChange(changed)
end
if CRT.Alerts and CRT.Alerts.OnChange then
    CRT.Alerts:OnChange(changed)
end
if CRT.Timeline and CRT.Timeline.OnChange then
    CRT.Timeline:OnChange(changed)
end
