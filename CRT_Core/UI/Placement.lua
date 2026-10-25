local ADDON, CRT = ...

-- Placement: the one helper every movable CRT element is placed, dragged, nudged, reset and anchored by (the
-- alert areas, the note callout, the break timer, low health, the marker display, consumables, debuffs, pace and
-- the ready check window). The Placement panel, the selection outline and the drag guides are drawn by
-- UI/PlacementPanel.lua.
--
-- Saved data: each element keeps its place as store().position = { point, relativePoint, x, y, anchor }, the same
-- table as before this helper, with one optional field: anchor, the key of the CRT element it is anchored to (none
-- means the screen). An anchored element is held by SetPoint on its anchor's frame, so it follows when that one
-- moves (a drag, a nudge, a reset). Anchoring to a hidden element still places it there: a hidden frame keeps its
-- points and size. A saved anchor that can't be used (that element is gone, or anchoring would loop) puts the
-- element at its default on the screen, and keeps the saved place for when it can be used again.
--
--   UI.Placement.Define(key, spec) -> el, at load time, once per element. key is saved (as another element's
--   anchor), so it never changes. spec:
--     title       its name in the Anchor to list and on the Placement panel
--     store()     the table its position is saved in, as store().position
--     default     { point, relativePoint, x, y } on the screen until it is moved, or a function returning one
--     point       the point it is held by when it is saved (default "CENTER"), or a function returning it: the
--                 point that stays put when it changes size
--     relativePoint  the screen's point it is saved from when on the screen (default its own point)
--     build()     optional: makes its frame, so another element can anchor to it before it has shown
--     settings()  optional: opens its settings (the gear's Settings)
--     editing()   optional, for an element that is its own drag box: whether it is being placed now (its Previews
--                 flag). Without it, an element is being placed while its drag box is on screen
--     place()     optional: places it itself (consumables docks under the game's window); it calls
--                 el:ApplySaved() when it goes where it is saved
--     canAnchor   false: it always sits on the screen (it holds the game's protected buttons)
--     target      false: nothing can be anchored to it
--     protected   true: in combat its frame may not move, so a reset waits until it is placed again
--     keepPoint   true: a place saved at another point is turned into its own point, at the same spot (debuffs)
--   el:Attach(frame, handle, opts)  when its frame is made: handle (the frame itself when nil) drags it; opts.reset
--                is its Reset button (the gear goes left of it), opts.gear a gear button it already has
--   UI.Placement.FitHandle(handle, frame, title, y)  a drag box over the frame's top (y above it), as wide as the
--                frame but never too narrow for its title, the gear and Reset; fitted again when the frame resizes
--   el:Apply()   puts it where it is saved, or at its default
--   el:Reset()   back to its default on the screen; the elements anchored to it follow
--   el:Offset() / el:SetOffset(x, y)  its centre's distance from its anchor's centre, in whole pixels
--   el:Nudge(dx, dy), el:CentreH(), el:CentreV(), el:SetAnchor(key or nil), el:CanAnchorTo(key)
--   UI.Placement.Select(el) / Deselect()   the selected element (gold outline) takes the arrow keys
-- Nothing moves and no key is taken in combat: a drag, the gear, the keys and Reset refuse, and combat starting drops
-- the selection and puts a dragged element back at its saved place. Nothing is selected, dragged or given the keys
-- unless it is being placed (el:Editable: its drag box on screen in Previews or its page's own preview), and its
-- drag box hiding lets go of it and closes its panel.

local UI = CRT.UI
local P = { list = {}, byKey = {} }
UI.Placement = P

P.SNAP = 6 -- a drag snaps to a guide this near (UIParent pixels)
P.NUDGE, P.NUDGE_BIG = 1, 10 -- an arrow key, and Shift with it
P.GEAR_TEXTURE = "Interface\\WorldMap\\Gear_64Grey"
P.GEAR_SIZE, P.GEAR_GAP = 16, 4 -- the gear, and its gap from Reset

local TEXT = {
    combat = "Can't move that in combat.",
    placement = "Placement",
    settings = "Settings",
    gearTip = "Placement and settings",
}
P.TEXT = TEXT

local DEFAULT = { point = "CENTER", relativePoint = "CENTER", x = 0, y = 0 }
local ARROWS = { UP = { 0, 1 }, DOWN = { 0, -1 }, LEFT = { -1, 0 }, RIGHT = { 1, 0 } }

local El = {}
El.__index = El
P.El = El

-- Numbers ------------------------------------------------------------------------------------

-- A number that can be used, or nil (a value the game hides, NaN, or not a number).
local function num(v)
    if type(v) ~= "number" or (issecretvalue and issecretvalue(v)) or v ~= v then
        return nil
    end
    return v
end
P.num = num

local function round(v)
    return math.floor(v + 0.5)
end

local function report(err)
    if geterrorhandler then
        geterrorhandler()(err)
    end
end

local function inCombat()
    return InCombatLockdown and InCombatLockdown() and true or false
end

local function scaleOf(f)
    local ok, s = pcall(f.GetEffectiveScale, f)
    s = ok and num(s)
    return (s and s > 0) and s or 1
end

-- A frame's centre and size in UIParent's units, or nil when the game gives nothing readable.
function P.Rect(f)
    if not f then
        return nil
    end
    local okC, cx, cy = pcall(f.GetCenter, f)
    cx, cy = okC and num(cx), okC and num(cy)
    if not (cx and cy) then
        return nil
    end
    local okW, w = pcall(f.GetWidth, f)
    local okH, h = pcall(f.GetHeight, f)
    w, h = okW and num(w) or 0, okH and num(h) or 0
    local k = scaleOf(f) / scaleOf(UIParent)
    return cx * k, cy * k, w * k, h * k
end

-- How far a point is across and up a frame, from its centre, as fractions of its width and height.
local function fraction(point)
    point = type(point) == "string" and point or "CENTER"
    local fx = point:find("LEFT") and -0.5 or point:find("RIGHT") and 0.5 or 0
    local fy = point:find("BOTTOM") and -0.5 or point:find("TOP") and 0.5 or 0
    return fx, fy
end
P.fraction = fraction

local function pointAt(cx, cy, w, h, point)
    local fx, fy = fraction(point)
    return cx + fx * w, cy + fy * h
end

-- A centre kept so a w by h box stays on the screen (UIParent). An unreadable screen keeps it as it is.
function P.Clamp(cx, cy, w, h)
    local ux, uy, sw, sh = P.Rect(UIParent)
    if not (ux and sw > 0 and sh > 0) then
        return cx, cy
    end
    local function keep(c, centre, screen, size)
        if size >= screen then
            return centre
        end
        return math.max(centre - screen / 2 + size / 2, math.min(centre + screen / 2 - size / 2, c))
    end
    return keep(cx, ux, sw, w), keep(cy, uy, sh, h)
end

-- Refusing in combat ---------------------------------------------------------------------------

-- The red line at the top of the screen, as the game says it won't do something now.
function P.Refuse()
    local r, g, b = 1, 0.1, 0.1
    if UI.Color then
        r, g, b = UI.Color("bad")
    end
    if UIErrorsFrame and UIErrorsFrame.AddMessage then
        UIErrorsFrame:AddMessage(TEXT.combat, r, g, b)
    elseif CRT.Print then
        CRT:Print(TEXT.combat)
    end
    return false
end

-- The panel, outline and guides (UI/PlacementPanel.lua) hear of every change through these.
local function changed(el)
    if P.OnChanged then
        P.OnChanged(el)
    end
end

-- Defining an element ---------------------------------------------------------------------------

function P.Define(key, spec)
    local el = P.byKey[key]
    if el then
        el.spec, el.title = spec, spec.title or key
        return el
    end
    el = setmetatable({ key = key, spec = spec, title = spec.title or key }, El)
    P.byKey[key] = el
    P.list[#P.list + 1] = el
    return el
end

function P.Find(key)
    return P.byKey[key]
end

-- The saved position (or nil) and the table it is kept in.
function El:Saved()
    local s = self.spec.store and self.spec.store()
    return s and s.position or nil, s
end

function El:Default()
    local d = self.spec.default
    if type(d) == "function" then
        d = d()
    end
    return d or DEFAULT
end

function El:Point()
    local p = self.spec.point
    if type(p) == "function" then
        p = p()
    end
    return type(p) == "string" and p or "CENTER"
end

-- The saved anchor's key, usable or not; nil for the screen.
function El:AnchorKey()
    local p = self:Saved()
    return p and type(p.anchor) == "string" and p.anchor or nil
end

-- Whether anchoring to key would come back round to this element through the anchors saved along the way.
function El:WouldLoop(key)
    local seen = {}
    while key do
        if key == self.key or seen[key] then
            return true
        end
        seen[key] = true
        local other = P.byKey[key]
        key = other and other:AnchorKey()
    end
    return false
end

-- Whether it may be anchored to that element (nil: the screen, always).
function El:CanAnchorTo(key)
    if key == nil then
        return true
    end
    local other = P.byKey[key]
    if not other or other == self or self.spec.canAnchor == false or other.spec.target == false then
        return false
    end
    if not (other.frame or other.spec.build) then
        return false
    end
    return not self:WouldLoop(key)
end

-- The saved anchor when it can be used, else nil (the screen).
function El:LiveAnchor()
    local key = self:AnchorKey()
    if key and self:CanAnchorTo(key) and self:AnchorFrame(key) then
        return key
    end
    return nil
end

-- The frame of the element with that key, made first when it hasn't been (spec.build).
function El:AnchorFrame(key)
    local other = key and P.byKey[key]
    if not other then
        return nil
    end
    if not other.frame and other.spec.build and not other.building then
        other.building = true
        local ok, err = pcall(other.spec.build)
        other.building = nil
        if not ok then
            report(err)
        end
    end
    return other.frame
end

-- Placing -------------------------------------------------------------------------------------

-- A place saved at another point, turned into its own point at the same spot on the screen (spec.keepPoint).
local function holdAt(p, point, w, h)
    local fx, fy = fraction(p.point)
    local cx, cy = fraction(point)
    return { point = point, relativePoint = p.relativePoint or p.point, x = (tonumber(p.x) or 0) + (cx - fx) * w,
        y = (tonumber(p.y) or 0) + (cy - fy) * h }
end

-- Where it is saved (on its anchor, or the screen), else its default. The place for a spec.place element.
function El:ApplySaved()
    local f = self.frame
    if not f then
        return
    end
    local p, s = self:Saved()
    local rel = UIParent
    if p and p.anchor ~= nil then
        local key = self:LiveAnchor()
        rel = key and self:AnchorFrame(key)
        if not rel then
            p, rel = nil, UIParent
        end
    end
    local saved = p ~= nil
    if saved and rel ~= UIParent then
        p = self:FollowCorner(p, s, rel)
    end
    p = p or self:Default()
    if self.spec.keepPoint and rel == UIParent and p.point ~= self:Point() then
        local w, h = 0, 0
        if self.spec.size then
            w, h = self.spec.size()
        else
            w, h = num(f:GetWidth()) or 0, num(f:GetHeight()) or 0
        end
        p = holdAt(p, self:Point(), w, h)
        if saved and s then
            s.position = p
        end
    end
    f:ClearAllPoints()
    f:SetPoint(p.point or "CENTER", rel, p.relativePoint or p.point or "CENTER", p.x or 0, p.y or 0)
end

-- An anchored place saved from the anchor's corner before that one changed corner (the debuff panel's Grow): the
-- same spot, measured from the anchor's corner now, and saved so.
function El:FollowCorner(p, s, rel)
    local want = P.byKey[p.anchor]:Point()
    if p.relativePoint == want then
        return p
    end
    local _, _, aw, ah = P.Rect(rel)
    if not aw then
        return p
    end
    local ox, oy = fraction(p.relativePoint)
    local nx, ny = fraction(want)
    local k = scaleOf(UIParent) / scaleOf(self.frame)
    p = { point = p.point, relativePoint = want, x = round((p.x or 0) + (ox - nx) * aw * k), y = round((p.y or 0) + (oy - ny) * ah * k),
        anchor = p.anchor }
    s.position = p
    return p
end

function El:Apply()
    if self.spec.place then
        return self.spec.place(self)
    end
    return self:ApplySaved()
end

-- The elements anchored to this one are placed again (once its frame exists, or after a change to its anchor).
function El:ApplyDependents()
    for _, other in ipairs(P.list) do
        if other ~= self and other.frame and other:AnchorKey() == self.key then
            other:Apply()
        end
    end
end

-- Moves its centre to cx, cy (UIParent units), kept on the screen, held by its point from its anchor's (or the
-- screen's) point, in whole pixels of its own scale. save writes the place. False when the game gives no size.
function El:MoveCenterTo(cx, cy, save)
    local f = self.frame
    local _, _, w, h = P.Rect(f)
    if not w then
        return false
    end
    cx, cy = P.Clamp(cx, cy, w, h)
    local key = self:LiveAnchor()
    local rel = key and self:AnchorFrame(key) or UIParent
    if rel == UIParent then
        key = nil
    end
    local point = self:Point()
    local relPoint = key and P.byKey[key]:Point() or self.spec.relativePoint or point
    local ax, ay, aw, ah = P.Rect(rel)
    if not ax then
        return false
    end
    local rx, ry = pointAt(ax, ay, aw, ah, relPoint)
    local px, py = pointAt(cx, cy, w, h, point)
    local k = scaleOf(UIParent) / scaleOf(f)
    local x, y = round((px - rx) * k), round((py - ry) * k)
    f:ClearAllPoints()
    f:SetPoint(point, rel, relPoint, x, y)
    if save then
        local _, s = self:Saved()
        if s then
            s.position = { point = point, relativePoint = relPoint, x = x, y = y, anchor = key }
        end
    end
    changed(self)
    return true
end

-- The centre of what it is anchored to (its anchor element, or the screen), in UIParent units.
function El:AnchorCenter()
    local key = self:LiveAnchor()
    local rel = key and self:AnchorFrame(key) or UIParent
    local ax, ay = P.Rect(rel)
    return ax, ay
end

-- Its centre's distance from its anchor's centre, in whole pixels, or nil.
function El:Offset()
    local cx, cy = P.Rect(self.frame)
    local ax, ay = self:AnchorCenter()
    if not (cx and ax) then
        return nil
    end
    return round(cx - ax), round(cy - ay)
end

-- Its centre from the screen's centre, for code that only needs which side it is on.
function El:ScreenOffset()
    local cx, cy = P.Rect(self.frame)
    local ux, uy = P.Rect(UIParent)
    if not (cx and ux) then
        return nil
    end
    return cx - ux, cy - uy
end

function El:SetOffset(x, y)
    if inCombat() then
        return P.Refuse()
    end
    x, y = num(x), num(y)
    local ax, ay = self:AnchorCenter()
    if not (x and y and ax) then
        return false
    end
    return self:MoveCenterTo(ax + round(x), ay + round(y), true)
end

function El:Nudge(dx, dy)
    if inCombat() then
        return P.Refuse()
    end
    local cx, cy = P.Rect(self.frame)
    if not cx then
        return false
    end
    return self:MoveCenterTo(cx + dx, cy + dy, true)
end

function El:CentreH()
    local _, y = self:Offset()
    return y ~= nil and self:SetOffset(0, y)
end

function El:CentreV()
    local x = self:Offset()
    return x ~= nil and self:SetOffset(x, 0)
end

-- Anchors it to another element (nil: the screen), where it is now on the screen, so only the offset changes.
function El:SetAnchor(key)
    if inCombat() then
        return P.Refuse()
    end
    if key ~= nil and not self:CanAnchorTo(key) then
        return false
    end
    local _, s = self:Saved()
    if not (s and self.frame) then
        return false
    end
    -- both places must be readable, or the offsets would be measured from nowhere and it would jump: then nothing
    -- changes
    local cx, cy = P.Rect(self.frame)
    if not cx or (key ~= nil and not P.Rect(self:AnchorFrame(key))) then
        return false
    end
    local old = s.position
    local p = old or self:Default()
    s.position = { point = p.point, relativePoint = p.relativePoint, x = p.x, y = p.y, anchor = key }
    if not self:MoveCenterTo(cx, cy, true) then
        s.position = old
        self:Apply()
        return false
    end
    changed(self)
    return true
end

-- Back to its default on the screen, its anchor cleared. The elements anchored to it follow it there.
function El:Reset()
    if inCombat() then
        return P.Refuse()
    end
    local _, s = self:Saved()
    if s then
        s.position = nil
    end
    if self.frame then
        self:Apply()
    end
    changed(self)
    return true
end

-- Whether it is being placed now: its drag box on screen, in Previews (or its page's own preview, spec.editing).
function El:Editable()
    local h = self.handle
    if not (h and h.IsVisible and h:IsVisible()) then
        return false
    end
    if self.spec.editing then
        return self.spec.editing() and true or false
    end
    return h ~= self.frame
end

-- Snapping -----------------------------------------------------------------------------------

-- The guides a drag snaps to, in UIParent units: the screen's centre lines, and when it is anchored, its anchor's
-- centre lines and edges. xs are vertical lines, ys horizontal ones.
function El:Guides()
    local xs, ys = {}, {}
    local ux, uy = P.Rect(UIParent)
    if ux then
        xs[1], ys[1] = ux, uy
    end
    local key = self:LiveAnchor()
    local ax, ay, aw, ah = P.Rect(key and self:AnchorFrame(key))
    if ax then
        xs[#xs + 1], xs[#xs + 2], xs[#xs + 3] = ax, ax - aw / 2, ax + aw / 2
        ys[#ys + 1], ys[#ys + 2], ys[#ys + 3] = ay, ay - ah / 2, ay + ah / 2
    end
    return xs, ys
end

-- c moved onto the nearest line within P.SNAP of its centre or either edge (half from the centre), and the line.
local function snapOne(c, half, lines)
    local best, at
    for _, line in ipairs(lines) do
        for _, edge in ipairs({ 0, -half, half }) do
            local d = line - (c + edge)
            if math.abs(d) <= P.SNAP and (best == nil or math.abs(d) < math.abs(best)) then
                best, at = d, line
            end
        end
    end
    if best then
        return c + best, at
    end
    return c, nil
end

-- A centre snapped to the guides, and the vertical and horizontal guide it snapped to (or nil).
function El:Snap(cx, cy)
    local _, _, w, h = P.Rect(self.frame)
    local xs, ys = self:Guides()
    local gx, gy
    cx, gx = snapOne(cx, (w or 0) / 2, xs)
    cy, gy = snapOne(cy, (h or 0) / 2, ys)
    return cx, cy, gx, gy
end

-- Dragging -----------------------------------------------------------------------------------
-- The helper moves the frame itself, every frame from the cursor, rather than letting the game move it: the frame
-- stays on its anchor while it moves, and it can snap as it goes.

local drag -- { el, dx, dy } while a drag goes
local driver -- the frame whose OnUpdate moves the dragged element

local function cursor()
    if not GetCursorPosition then
        return nil
    end
    local x, y = GetCursorPosition()
    x, y = num(x), num(y)
    if not (x and y) then
        return nil
    end
    local s = scaleOf(UIParent)
    return x / s, y / s
end

-- One step of a drag: the centre under the cursor, snapped unless Shift is down. final saves it.
function P.DragStep(final)
    local d = drag
    if not d then
        return false
    end
    if inCombat() then
        P.CancelDrag()
        return false
    end
    local mx, my = cursor()
    if not mx then
        return false
    end
    local cx, cy, gx, gy = mx + d.dx, my + d.dy, nil, nil
    if not (IsShiftKeyDown and IsShiftKeyDown()) then
        cx, cy, gx, gy = d.el:Snap(cx, cy)
    end
    local moved = d.el:MoveCenterTo(cx, cy, final)
    if P.DrawGuides then
        P.DrawGuides(d.el, gx, gy)
    end
    return moved
end

function P.StopDrag()
    drag = nil
    if driver then
        driver:SetScript("OnUpdate", nil)
    end
    if P.HideGuides then
        P.HideGuides()
    end
end

-- A drag cut short (combat): it goes back to its saved place, unless its frame may not move now.
function P.CancelDrag()
    local d = drag
    P.StopDrag()
    if d and not (d.el.spec.protected and inCombat()) then
        d.el:Apply()
    end
end

function P.Dragging()
    return drag and drag.el or nil
end

function El:BeginDrag()
    if P.picking or not self.frame or not self:Editable() then
        return
    end
    if inCombat() then
        P.Refuse()
        return
    end
    P.Select(self)
    local cx, cy = P.Rect(self.frame)
    local mx, my = cursor()
    if not (cx and mx) then
        return
    end
    drag = { el = self, dx = cx - mx, dy = cy - my }
    driver = driver or CreateFrame("Frame")
    driver:SetScript("OnUpdate", function()
        P.DragStep(false)
    end)
    P.DragStep(false)
end

-- The drag ends where it is, saved. A stop with no drag started here (the game's own) saves it where it is.
function El:EndDrag()
    if P.picking or not self.frame or inCombat() then
        P.StopDrag()
        return
    end
    local mine = drag and drag.el == self
    local moved = mine and P.DragStep(true)
    P.StopDrag()
    if not moved and (mine or self:Editable()) then
        local cx, cy = P.Rect(self.frame)
        if cx then
            self:MoveCenterTo(cx, cy, true)
        end
    end
end

-- Selecting and the keys ----------------------------------------------------------------------

local keys -- shown while an element is selected, to take its arrow keys

local function keyFrame()
    if keys then
        return keys
    end
    keys = CreateFrame("Frame", "CowfeeRaidToolsPlacementKeys", UIParent)
    keys:SetSize(1, 1)
    keys:SetPoint("TOPLEFT")
    keys:SetFrameStrata("DIALOG")
    keys:Hide()
    keys:SetScript("OnKeyDown", function(_, key)
        P.OnKey(key)
    end)
    -- An arrow it took is let through again once released, so no key stays taken.
    keys:SetScript("OnKeyUp", function(k)
        if not inCombat() then
            pcall(k.SetPropagateKeyboardInput, k, true)
        end
    end)
    return keys
end

-- Takes the keyboard (passing on every key but the arrows and Escape) while on, out of combat only. Off hides the
-- frame, which works in combat too, so no key is ever kept from the game.
function P.Keys(on)
    local k = keyFrame()
    if on and not inCombat() then
        pcall(k.EnableKeyboard, k, true)
        pcall(k.SetPropagateKeyboardInput, k, true)
        k:Show()
        return
    end
    k:Hide()
    if not inCombat() then
        pcall(k.SetPropagateKeyboardInput, k, true)
        pcall(k.EnableKeyboard, k, false)
    end
end

-- A key while an element is selected: an arrow moves it P.NUDGE (Shift: P.NUDGE_BIG) and is kept from the game,
-- Escape stops picking or drops the selection; any other key goes on to the game. Returns whether it took the key.
function P.OnKey(key)
    if inCombat() then
        return false
    end
    if P.selected and not P.selected:Editable() then
        P.Deselect()
    end
    local took = false
    local arrow = ARROWS[key]
    if arrow and P.selected then
        local step = (IsShiftKeyDown and IsShiftKeyDown()) and P.NUDGE_BIG or P.NUDGE
        P.selected:Nudge(arrow[1] * step, arrow[2] * step)
        took = true
    elseif key == "ESCAPE" and (P.selected or P.picking) then
        P.Escape()
        took = true
    end
    if keys then
        pcall(keys.SetPropagateKeyboardInput, keys, not took)
    end
    return took
end

-- Selecting another element while the panel is open moves the panel to it.
function P.Select(el)
    if inCombat() or not el or not el:Editable() then
        return
    end
    local open = P.PanelShows and P.PanelShows()
    if open and open ~= el and not P.picking and P.OpenPanel then
        P.OpenPanel(el)
        return
    end
    P.selected = el
    P.Keys(true)
    changed(el)
end

function P.Deselect()
    local was = P.selected
    P.selected, P.picking = nil, nil
    P.Keys(false)
    changed(was)
end

-- Picking an anchor on screen: the next click on another element's box anchors the picking one to it.
function El:StartPick()
    if inCombat() then
        return P.Refuse()
    end
    P.Select(self)
    P.picking = self
    changed(self)
    return true
end

function P.Escape()
    if P.picking then
        local el = P.picking
        P.picking = nil
        changed(el)
        return
    end
    P.Deselect()
    if P.ClosePanel then
        P.ClosePanel()
    end
end

-- A left click on an element's box: while picking, it becomes the anchor (when it can); else it is selected.
function P.Click(el)
    if inCombat() or not el:Editable() then
        return
    end
    local picking = P.picking
    if picking then
        if el ~= picking and picking:CanAnchorTo(el.key) then
            P.picking = nil
            picking:SetAnchor(el.key)
        end
        changed(picking)
        return
    end
    P.Select(el)
end

-- The gear ------------------------------------------------------------------------------------

local function makeGear(handle, reset)
    local gear = CreateFrame("Button", nil, handle)
    gear:SetSize(P.GEAR_SIZE, P.GEAR_SIZE)
    if reset then
        gear:SetPoint("RIGHT", reset, "LEFT", -P.GEAR_GAP, 0)
    else
        gear:SetPoint("RIGHT", handle, "RIGHT", -2, 0)
    end
    gear:SetFrameLevel((handle:GetFrameLevel() or 1) + 5)
    gear:SetNormalTexture(P.GEAR_TEXTURE)
    gear:SetHighlightTexture(P.GEAR_TEXTURE)
    gear:SetScript("OnEnter", function(b)
        if UI.TooltipOwner then
            UI.TooltipOwner(GameTooltip, b, "ANCHOR_TOP")
            GameTooltip:SetText(TEXT.gearTip, 1, 1, 1)
            GameTooltip:Show()
        end
    end)
    gear:SetScript("OnLeave", function()
        if GameTooltip then
            GameTooltip:Hide()
        end
    end)
    return gear
end

-- The gear's menu: Placement, and Settings when it has some. Refused in combat.
function El:OpenMenu(owner)
    if inCombat() then
        return P.Refuse()
    end
    local settings = self.spec.settings
    local function placement()
        if P.OpenPanel then
            P.OpenPanel(self)
        end
    end
    if not UI.ContextMenu then
        placement()
        return true
    end
    UI.ContextMenu(owner, function(root)
        root:CreateButton(TEXT.placement, placement)
        if settings then
            root:CreateButton(TEXT.settings, function()
                settings()
            end)
        end
    end)
    return true
end

-- A drag box's width ----------------------------------------------------------------------------

local function textWidth(fs)
    -- the words' full width, else the width as drawn
    for _, method in ipairs({ "GetUnboundedStringWidth", "GetStringWidth" }) do
        local ok, w = pcall(fs[method], fs)
        w = ok and num(w)
        if w then
            return w
        end
    end
    return 0
end

function P.FitHandle(handle, frame, title, y)
    handle.crtFit = { frame = frame, title = title, y = y or 2 }
    local function fit()
        local f = handle.crtFit
        local reset = UI.ResetButtonWidth and UI.ResetButtonWidth() or 44
        -- room on both sides, so a centred title clears the gear and Reset too
        local need = math.ceil(textWidth(f.title) + 2 * (6 + P.GEAR_SIZE + P.GEAR_GAP + reset + 2))
        handle:ClearAllPoints()
        handle:SetPoint("BOTTOMLEFT", f.frame, "TOPLEFT", 0, f.y)
        handle:SetWidth(math.max(num(f.frame:GetWidth()) or 0, need))
    end
    if not handle.crtFitHooked and frame.HookScript then
        handle.crtFitHooked = true
        frame:HookScript("OnSizeChanged", fit)
    end
    fit()
end

-- Attaching a frame ----------------------------------------------------------------------------

-- Wires the frame and its drag box, adds the gear, places it, and places again the elements anchored to it.
-- Returns the gear.
function El:Attach(frame, handle, opts)
    opts = opts or {}
    handle = handle or frame
    self.frame, self.handle = frame, handle
    handle:EnableMouse(true)
    handle:RegisterForDrag("LeftButton")
    handle:SetScript("OnDragStart", function()
        self:BeginDrag()
    end)
    handle:SetScript("OnDragStop", function()
        self:EndDrag()
    end)
    local function click(_, button)
        if button == nil or button == "LeftButton" then
            P.Click(self)
        end
    end
    -- its drag box going (Previews or its page's preview off, the window closing) lets go of it
    local function hidden()
        if P.Dragging() == self then
            P.CancelDrag()
        end
        if P.PanelShows and P.PanelShows() == self and P.ClosePanel then
            P.ClosePanel()
        end
        if P.selected == self or P.picking == self then
            P.Deselect()
        end
    end
    if handle.HookScript then
        handle:HookScript("OnMouseUp", click)
        handle:HookScript("OnHide", hidden)
    else
        handle:SetScript("OnMouseUp", click)
        handle:SetScript("OnHide", hidden)
    end
    local gear = opts.gear or makeGear(handle, opts.reset)
    gear:SetScript("OnClick", function(b)
        self:OpenMenu(b)
    end)
    self.gear = gear
    self:Apply()
    self:ApplyDependents()
    return gear
end

-- Every element defined, with a frame or not, in the order they were defined.
function P.Elements()
    local out = {}
    for _, el in ipairs(P.list) do
        out[#out + 1] = el
    end
    return out
end

-- Combat drops the drag, the selection and the panel; Previews off do too.
local function stopAll()
    P.CancelDrag()
    P.Deselect()
    if P.ClosePanel then
        P.ClosePanel()
    end
end
P.StopAll = stopAll

local events = CreateFrame("Frame")
if events.RegisterEvent then
    events:RegisterEvent("PLAYER_REGEN_DISABLED")
end
events:SetScript("OnEvent", stopAll)

if UI.RegisterPreview then
    UI:RegisterPreview("placement", function(on)
        if not on then
            stopAll()
        end
    end)
end
