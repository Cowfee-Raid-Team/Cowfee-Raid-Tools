local ADDON, CRT = ...

-- Timeline: your own order of the healers and their spell rows on Healer CDs (Timeline/HealerView.lua builds the
-- rows in it). A left-drag on a healer's name row in the label column (a roster player, an open slot or an assigned
-- one) moves their whole block: the name row and its spell rows. A left-drag on a spell row's label moves that spell
-- among its healer's spell rows only. While one is held its rows dim, and an accent line shows where it lands: between
-- blocks for a healer, never inside one; inside its block for a spell. Letting go saves the order and draws again;
-- letting go off the list, Esc, or combat cancels it. A click that moves less than DRAG_PX does nothing new. The
-- + Add healer row stays under the healers (it is not a block). Right-click menus are as they were. Anyone may order
-- their own view; the raid leader or an assistant sends theirs with a pushed note (Timeline/HealerOrderShare.lua).
-- Saved on this computer:
--   CRTDB.timeline.healerOrder[encounterID] = { healer key, ... }   per boss, declared for the dev season purge
--   CRTDB.timeline.healerSpellOrder[key] = { spellID, ... }          per healer, on every boss (long term)
-- A healer key is the player's key in lower case ("name-realm"), or an open slot's "slot:<spec>:<n>"; a spell order's
-- key is the player's, or "spec:<SpecializationID>" for an open slot. A healer or spell not in a saved order comes
-- after the ordered ones, in the order Healer CDs gives them (so a new healer lands at the bottom); the keys of players
-- who left are kept.
-- Game calls (warcraft.wiki.gg, read 2026-10-31): IsMouseButtonDown(button), Frame:EnableKeyboard,
-- Frame:SetPropagateKeyboardInput (not in combat; a drag never starts in combat), OnKeyDown(self, key),
-- ScriptRegion:IsMouseOver, InCombatLockdown.

local Order = {}
CRT.TimelineHealerOrder = Order

local DRAG_PX = 4 -- pixels the cursor moves before a press is a drag
local DIM_ALPHA = 0.4 -- a held block's labels
local LINE_H = 2 -- the drop line
local GRIP_W, GRIP_GAP = 8, 3 -- the grip a draggable label shows on hover: three short lines

if CRT.Bosses and CRT.Bosses.DeclareField then
    CRT.Bosses:DeclareField("healer order", "timeline", "healerOrder")
end

-- The saved data -----------------------------------------------------------------------------------------

local function area(field, create)
    local t = CRT.db and CRT.db.timeline
    if type(t) ~= "table" then
        return nil
    end
    if type(t[field]) ~= "table" then
        if not create then
            return nil
        end
        t[field] = {}
    end
    return t[field]
end

-- The boss's saved healer order, or nil.
function Order.Healers(encounterID)
    local all = area("healerOrder", false)
    local list = all and type(encounterID) == "number" and all[encounterID]
    return type(list) == "table" and list or nil
end

-- A healer's saved spell order, or nil.
function Order.Spells(key)
    local all = area("healerSpellOrder", false)
    local list = all and type(key) == "string" and all[key]
    return type(list) == "table" and list or nil
end

-- Saves the boss's healer order (nil or empty forgets it).
function Order.SetHealers(encounterID, keys)
    if type(encounterID) ~= "number" then
        return
    end
    local all = area("healerOrder", keys ~= nil and #keys > 0)
    if all then
        all[encounterID] = (keys and #keys > 0) and keys or nil
    end
end

-- Saves a healer's spell order (nil or empty forgets it).
function Order.SetSpells(key, ids)
    if type(key) ~= "string" then
        return
    end
    local all = area("healerSpellOrder", ids ~= nil and #ids > 0)
    if all then
        all[key] = (ids and #ids > 0) and ids or nil
    end
end

-- Ordering ----------------------------------------------------------------------------------------------

-- items in saved's order (keyOf(item) its key), the rest after them in the order they came. A new list.
function Order.Sort(items, saved, keyOf)
    local rank = {}
    for i, k in ipairs(type(saved) == "table" and saved or {}) do
        if rank[k] == nil then
            rank[k] = i
        end
    end
    local tagged = {}
    for i, it in ipairs(items) do
        tagged[i] = { it = it, i = i, r = rank[keyOf(it)] }
    end
    table.sort(tagged, function(a, b)
        if a.r and b.r and a.r ~= b.r then
            return a.r < b.r
        end
        if (a.r ~= nil) ~= (b.r ~= nil) then
            return a.r ~= nil
        end
        return a.i < b.i
    end)
    local out = {}
    for i, t in ipairs(tagged) do
        out[i] = t.it
    end
    return out
end

local function healerKey(who)
    return who.key
end

local function spellOf(r)
    return r.spellID
end

-- The key a healer's spell order is kept by (HealerView's who: key, slot): an open slot's spec, else the player's.
function Order.SpellKey(who)
    local s = who.slot
    if s and not s.player and type(s.spec) == "number" then
        return "spec:" .. s.spec
    end
    return who.key
end

-- HealerView's healers (its whos) in the boss's saved order, each one's spell rows (who.rows) in theirs.
function Order.Apply(encounterID, people)
    for _, who in ipairs(people) do
        who.rows = Order.Sort(who.rows, Order.Spells(Order.SpellKey(who)), spellOf)
    end
    return Order.Sort(people, Order.Healers(encounterID), healerKey)
end

-- The shown order with the saved keys not shown now after it (players who left keep their place at the end).
local function merged(shown, saved)
    local out, seen = {}, {}
    for _, k in ipairs(shown) do
        if not seen[k] then
            seen[k] = true
            out[#out + 1] = k
        end
    end
    for _, k in ipairs(type(saved) == "table" and saved or {}) do
        if not seen[k] then
            seen[k] = true
            out[#out + 1] = k
        end
    end
    return out
end

-- The view's healer blocks, top to bottom: { order (the lanes' hvOrder: key, spellKey), first, last, spells = { row,
-- ... } }, from the lanes HealerView built (a name row, then its spell rows).
function Order.Blocks(view)
    local blocks, cur = {}, nil
    for i, lane in ipairs(view.lanes or {}) do
        local o = lane.hvOrder
        if o and lane.kind == "healer" then
            cur = { order = o, first = i, last = i, spells = {} }
            blocks[#blocks + 1] = cur
        elseif o and lane.kind == "healercd" and cur and cur.order == o then
            cur.last = i
            cur.spells[#cur.spells + 1] = i
        else
            cur = nil
        end
    end
    return blocks
end

-- Dragging ----------------------------------------------------------------------------------------------
-- view.hvDrag while a press on a draggable label is held: { kind = "healer" or "spell", block (its index in blocks),
-- blocks, row (a spell's lane index), y0, started, gap }. gap is where it lands: before item gap of its list (blocks,
-- or the block's spell rows), one past the last for after it.

local function rowTop(view, row)
    return view:RowTop(row)
end

-- Where y (pixels down the track) lands among items (each { top, bottom }): the first whose middle is below y.
local function gapAt(items, y)
    for i, it in ipairs(items) do
        if y < (it.top + it.bottom) / 2 then
            return i
        end
    end
    return #items + 1
end

-- The drag's list of items: the blocks' or its block's spell rows, each { top, bottom }.
local function items(view, d)
    local out = {}
    if d.kind == "healer" then
        for i, b in ipairs(d.blocks) do
            out[i] = { top = rowTop(view, b.first), bottom = rowTop(view, b.last + 1) }
        end
    else
        for i, row in ipairs(d.blocks[d.block].spells) do
            out[i] = { top = rowTop(view, row), bottom = rowTop(view, row + 1) }
        end
    end
    return out
end

-- The rows a drag holds (dimmed while it moves).
local function heldRows(d)
    if d.kind == "spell" then
        return d.row, d.row
    end
    local b = d.blocks[d.block]
    return b.first, b.last
end

local function dim(view, d, alpha)
    local first, last = heldRows(d)
    for i = first, last do
        local l = view.labels and view.labels[i]
        if l then
            l:SetAlpha(alpha)
        end
    end
end

-- The frame that draws the drop line and hears Esc while a drag is held, made once per view.
local function dragFrame(view)
    local f = view.hvDragFrame
    if f then
        return f
    end
    f = CreateFrame("Frame", nil, view.body)
    f:SetAllPoints(view.body)
    f.line = f:CreateTexture(nil, "OVERLAY")
    f.line:SetHeight(LINE_H)
    f:SetScript("OnUpdate", function()
        Order.Update(view)
    end)
    f:SetScript("OnKeyDown", function(self, key)
        local esc = key == "ESCAPE"
        if not (InCombatLockdown and InCombatLockdown()) then
            pcall(self.SetPropagateKeyboardInput, self, not esc)
        end
        if esc then
            Order.Cancel(view)
        end
    end)
    f:Hide()
    view.hvDragFrame = f
    return f
end

local function finish(view)
    local d = view.hvDrag
    view.hvDrag = nil
    if d and d.started then
        dim(view, d, 1)
    end
    local f = view.hvDragFrame
    if f then
        f.line:Hide()
        if f.EnableKeyboard and not (InCombatLockdown and InCombatLockdown()) then
            pcall(f.EnableKeyboard, f, false)
        end
        f:Hide()
    end
    return d
end

-- A left press on label l's lane: a drag may start (in Healer CDs, out of combat, on a healer's name row on a boss
-- with an encounter number, or on a spell row). True when one may.
function Order.Press(view, lane, y)
    if view.mode ~= "healers" or not (lane and lane.hvOrder) or (InCombatLockdown and InCombatLockdown()) then
        return false
    end
    local blocks = Order.Blocks(view)
    local block, row
    for i, b in ipairs(blocks) do
        if b.order == lane.hvOrder then
            block = i
        end
    end
    if not block then
        return false
    end
    local kind = lane.kind == "healer" and "healer" or "spell"
    if kind == "healer" and not view:EncounterNumber() then
        return false
    end
    if kind == "spell" then
        for _, r in ipairs(blocks[block].spells) do
            if view.lanes[r] == lane then
                row = r
            end
        end
        if not row then
            return false
        end
    end
    finish(view)
    view.hvDrag = { kind = kind, block = block, blocks = blocks, row = row, y0 = y, started = false }
    local f = dragFrame(view)
    f:SetFrameLevel((view.track and view.track:GetFrameLevel() or 0) + 25)
    f:Show()
    if f.EnableKeyboard then
        -- other keys go on to the game; only Esc is taken, while a drag is held
        local ok = pcall(f.SetPropagateKeyboardInput, f, true)
        if ok then
            pcall(f.EnableKeyboard, f, true)
        end
    end
    return true
end

-- The cursor at y (pixels down the track) while a press is held: past DRAG_PX it is a drag, and the drop line shows
-- where it lands.
function Order.Move(view, y)
    local d = view.hvDrag
    if not (d and type(y) == "number") then
        return
    end
    if not d.started then
        if math.abs(y - d.y0) < DRAG_PX then
            return
        end
        d.started = true
        dim(view, d, DIM_ALPHA)
    end
    local list = items(view, d)
    d.gap = gapAt(list, y)
    local f = dragFrame(view)
    local at = d.gap <= #list and list[d.gap].top or list[#list].bottom
    local c = CRT.PALETTE and CRT.PALETTE.accent or { 1, 0.5, 0.1 }
    f.line:SetColorTexture(c[1], c[2], c[3], 1)
    f.line:ClearAllPoints()
    f.line:SetPoint("TOPLEFT", view.body, "TOPLEFT", 0, -at + LINE_H / 2)
    f.line:SetPoint("TOPRIGHT", view.body, "TOPRIGHT", 0, -at + LINE_H / 2)
    f.line:Show()
end

-- list with item from moved to before gap (one past the end: last).
local function moved(list, from, gap)
    local out = {}
    for i, v in ipairs(list) do
        out[i] = v
    end
    local it = table.remove(out, from)
    local to = gap > from and gap - 1 or gap
    table.insert(out, math.min(to, #out + 1), it)
    return out
end

-- Lets go of the drag: over the list, the order it shows is saved and the view drawn again; anywhere else, or a press
-- that never moved, nothing changes. True when an order was saved.
function Order.Release(view)
    local d = view.hvDrag
    if not d then
        return false
    end
    local over = view.vscroll and view.vscroll.IsMouseOver and view.vscroll:IsMouseOver()
    finish(view)
    if not (d.started and d.gap and over) then
        return false
    end
    local from = d.kind == "healer" and d.block or nil
    if d.kind == "spell" then
        for i, r in ipairs(d.blocks[d.block].spells) do
            if r == d.row then
                from = i
            end
        end
    end
    if not from or d.gap == from or d.gap == from + 1 then
        return false -- dropped where it was
    end
    if d.kind == "healer" then
        local keys = {}
        for i, b in ipairs(d.blocks) do
            keys[i] = b.order.key
        end
        local encounterID = view:EncounterNumber()
        Order.SetHealers(encounterID, merged(moved(keys, from, d.gap), Order.Healers(encounterID)))
    else
        local b = d.blocks[d.block]
        local ids = {}
        for i, row in ipairs(b.spells) do
            ids[i] = view.lanes[row].spellID
        end
        local key = b.order.spellKey
        Order.SetSpells(key, merged(moved(ids, from, d.gap), Order.Spells(key)))
    end
    view:Refresh()
    return true
end

-- Esc, combat or a new draw: the drag is dropped, nothing changes.
function Order.Cancel(view)
    finish(view)
end

-- Each frame while a press is held: combat cancels it, a mouse button let go elsewhere lets go, else the cursor moves.
function Order.Update(view)
    if not view.hvDrag then
        finish(view)
        return
    end
    if InCombatLockdown and InCombatLockdown() then
        Order.Cancel(view)
        return
    end
    if IsMouseButtonDown and not IsMouseButtonDown("LeftButton") then
        Order.Release(view)
        return
    end
    local _, y = view:CursorOnTrack()
    Order.Move(view, y)
end

-- The labels ---------------------------------------------------------------------------------------------

local function grip(l)
    local had = rawget(l, "hvGrip") -- the label frame's own field (rawget: a frame's other keys are its methods)
    if had then
        return had
    end
    local g = {}
    local c = CRT.PALETTE and CRT.PALETTE.label or { 0.8, 0.8, 0.8 }
    for i = 1, 3 do
        local tex = l:CreateTexture(nil, "OVERLAY")
        tex:SetColorTexture(c[1], c[2], c[3], 0.8)
        tex:SetSize(GRIP_W, 1)
        tex:SetPoint("RIGHT", l, "RIGHT", -3, (i - 2) * GRIP_GAP)
        tex:Hide()
        g[i] = tex
    end
    l.hvGrip = g
    return g
end

local function showGrip(l, on)
    for _, tex in ipairs(grip(l)) do
        tex:SetShown(on)
    end
end

-- Gives each of the view's labels its drag: a left press and release, and the grip on hover over a draggable row.
-- Each label once; the lane it shows is read at the press (labels are reused as the view draws).
function Order.Hook(view)
    for _, l in ipairs(view.labels or {}) do
        if not rawget(l, "hvOrderHooked") then
            l.hvOrderHooked = true
            grip(l)
            l:SetScript("OnMouseDown", function(b, button)
                if button == "LeftButton" then
                    local _, y = view:CursorOnTrack()
                    Order.Press(view, b.lane, y)
                end
            end)
            l:SetScript("OnMouseUp", function(_, button)
                if button == "LeftButton" and view.hvDrag then
                    Order.Release(view)
                end
            end)
            l:HookScript("OnEnter", function(b)
                showGrip(b, view.mode == "healers" and b.lane and b.lane.hvOrder ~= nil or false)
            end)
            l:HookScript("OnLeave", function(b)
                showGrip(b, false)
            end)
        end
    end
end
