local ADDON, CRT = ...

-- Placement: the one helper every movable CRT element is placed, dragged, nudged, reset and anchored by (the
-- alert areas, the note callout, the break timer, low health, the marker display, consumables, debuffs, pace and
-- the ready check window). The Placement panel, the selection outline and the drag guides are drawn by
-- UI/PlacementPanel.lua; Select Anchor's overlay, hit test, outline and name tag are UI/PlacementSelect.lua's.
--
-- Saved data: each element keeps its place as store().position = { point, relativePoint, x, y, anchor }, the same
-- table as before this helper, with one optional field: anchor, the key of the CRT element it is anchored to (none
-- means the screen). An anchored element is held by SetPoint on its anchor's frame, so it follows when that one
-- moves (a drag, a nudge, a reset). Anchoring to a hidden element still places it there: a hidden frame keeps its
-- points and size. A saved anchor that can't be used (that element is gone, or anchoring would loop) puts the
-- element at its default on the screen, and keeps the saved place for when it can be used again.
--
-- Any frame on screen with a global name can be an anchor too (a unit frame, whichever addon made it): anchor is
-- then "frame:<name>", found by that name (_G[name]), and the place also keeps screenX, screenY, where it sits on
-- the screen while that frame isn't loaded. A frame made later (another addon loading late, or making its frames at
-- PLAYER_LOGIN or PLAYER_ENTERING_WORLD) is looked for again on those events and a few short timers (P.MAX_RETRIES
-- in all); one that never comes leaves the element at that spot, the anchor kept. Refused: the screen and the world
-- (UIParent, WorldFrame, a frame as big as the screen), the game's forbidden and anchor-restricted frames
-- (nameplates), CRT's own frames, a frame anchored back to this element through the points it reports, and, for an
-- element whose frame is protected, a frame that isn't (anchoring a protected frame to another makes that one
-- protected too: ScriptRegion:IsProtected on warcraft.wiki.gg). An element anchored to a frame (or anchored to one
-- that is) is never placed again in combat: that waits for PLAYER_REGEN_ENABLED. Its own size, showing and hiding
-- are untouched by this: the game's restrictions go from a protected frame to its parents and the frames it is
-- anchored to, never to the frames anchored to it.
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
--   el:FrameProblem(frame) -> nil, or why it can't anchor to that frame; P.AnchorToName(el, name) -> ok, message
--   P.ResolveFocus(region) -> frame, name, own: the nearest frame with a global name up from a region (the one under
--                the cursor), or own when it is part of CRT
--   el:AnchorProblem(key) -> nil, or why it can't anchor to that element or frame (CanAnchorTo is its nil)
--   Select Anchor: el:StartPick() (P.picking), then P.PickTarget(P.UnderCursor()) names what is under the cursor
--                and a left click, Enter or Space (P.OnKey -> P.PickChoose) anchors to it. The overlay that takes
--                the click, so it never reaches the frame under it, and the hit test are UI/PlacementSelect.lua's.
--                P.message holds what the last choice or typed name was refused with, for the panel
--   UI.Placement.Select(el) / Deselect()   the selected element (gold outline) takes the arrow keys
-- Nothing moves and no key is taken in combat: a drag, the gear, the keys and Reset refuse, and combat starting drops
-- the selection and puts a dragged element back at its saved place. Nothing is selected, dragged or given the keys
-- unless it is being placed (el:Editable: its drag box on screen in Previews or its page's own preview), and its
-- drag box hiding lets go of it and closes its panel.

local UI = CRT.UI
local P = { list = {}, byKey = {}, queued = {} } -- queued: elements waiting for combat to end to be placed
UI.Placement = P

P.SNAP = 6 -- a drag snaps to a guide this near (UIParent pixels)
P.FRAME = "frame:" -- an anchor on a frame by its global name
P.RETRY_DELAYS = { 1, 3, 10 } -- seconds after PLAYER_LOGIN or PLAYER_ENTERING_WORLD a missing frame is looked for again
P.MAX_RETRIES = 6 -- timers in a session, at most
P.MAX_WALK = 200 -- frames read at most when following points or parents
P.NUDGE, P.NUDGE_BIG = 1, 10 -- an arrow key, and Shift with it
P.GEAR_TEXTURE = "Interface\\WorldMap\\Gear_64Grey"
P.GEAR_SIZE, P.GEAR_GAP = 16, 4 -- the gear, and its gap from Reset

local TEXT = {
    combat = "Can't move that in combat.",
    placement = "Placement",
    settings = "Settings",
    gearTip = "Placement and settings",
    noName = "That frame has no name, so it can't be anchored to.",
    missing = "No frame is called %s.",
    notLoaded = "Anchored to %s, which isn't loaded.",
    cantUse = "Anchored to %s, which can't be used now.",
    fullScreen = "That frame fills the screen, so it can't be anchored to.",
    forbidden = "The game doesn't let addons anchor to that frame.",
    own = "That is part of CRT. Pick CRT's elements from the Anchor to list.",
    nowhere = "That frame isn't on screen, so it can't be anchored to.",
    loop = "That frame is anchored to this one, so it would go round in a loop.",
    spread = "This one is protected by the game, so it can only anchor to a protected frame, such as a unit frame.",
    fixed = "This one always sits on the screen.",
    notTarget = "That element can't be anchored to.",
    nothing = "Nothing to anchor to there.",
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
P.inCombat = inCombat

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

-- Frames on screen, by name ------------------------------------------------------------------------

-- The frame's global name in a "frame:<name>" anchor, or nil (an element's key, or the screen).
function P.FrameName(key)
    return type(key) == "string" and key:match("^frame:([%w_]+)$") or nil
end

function P.FrameKey(name)
    return P.FRAME .. name
end

local function call(f, method, ...)
    local fn = type(f) == "table" and f[method]
    if type(fn) ~= "function" then
        return nil
    end
    local ok, a, b = pcall(fn, f, ...)
    if not ok then
        return nil
    end
    return a, b
end
P.call = call -- f's method called safely: its first two returns, or nil when it has none or errors

-- Whether a value the game gave is true; a hidden (secret) value is never compared.
local function flag(v)
    if issecretvalue and issecretvalue(v) then
        return false
    end
    return v == true
end
P.flag = flag

-- The frame called name, or nil: a widget held by that global, which addons may touch.
function P.LookupFrame(name)
    if type(name) ~= "string" or not name:find("^[%w_]+$") then
        return nil
    end
    local f = _G[name]
    if type(f) ~= "table" then
        return nil
    end
    local ok, widget = pcall(function()
        return type(f.SetPoint) == "function" and type(f.GetCenter) == "function"
    end)
    return (ok and widget) and f or nil
end

-- A region's global name when that global is this region, else nil.
local function globalName(r)
    local name = call(r, "GetName")
    if type(name) ~= "string" or (issecretvalue and issecretvalue(name)) or name == "" then
        return nil
    end
    return _G[name] == r and name or nil
end

-- The element whose frame or drag box r is, or nil.
local function elementOf(r)
    for _, el in ipairs(P.list) do
        if r == el.frame or r == el.handle then
            return el
        end
    end
    return nil
end

-- CRT's own frames: every element's frame and drag box, and anything named for the addon (CowfeeRaidTools..., such
-- as the Placement panel, or CRT..., such as the looting prompt).
local function ownFrame(r)
    if elementOf(r) then
        return true
    end
    local name = globalName(r)
    return name ~= nil and (name:find("^CowfeeRaidTools") ~= nil or name:find("^CRT") ~= nil)
end

-- The element a region is part of (its frame, its drag box, or anything on them), or nil.
function P.ElementOf(r)
    local n = 0
    while r and n < P.MAX_WALK do
        if flag(call(r, "IsForbidden")) then
            return nil
        end
        local el = elementOf(r)
        if el then
            return el
        end
        r, n = call(r, "GetParent"), n + 1
    end
    return nil
end

-- Whether a region is part of CRT: it, or one of its parents, is CRT's own.
function P.IsOwn(r)
    local n = 0
    while r and n < P.MAX_WALK do
        if flag(call(r, "IsForbidden")) then
            return false
        end
        if ownFrame(r) then
            return true
        end
        r, n = call(r, "GetParent"), n + 1
    end
    return false
end

-- The nearest frame with a global name up from region (itself or a parent), and that name; the screen and the world
-- end the search with none. own: it is part of CRT, which its own clicks handle.
function P.ResolveFocus(region)
    if region == nil or flag(call(region, "IsForbidden")) then
        return nil, nil, false
    end
    if P.IsOwn(region) then
        return nil, nil, true
    end
    local r, n = region, 0
    while r and r ~= UIParent and r ~= WorldFrame and n < P.MAX_WALK do
        local name = globalName(r)
        if name then
            return r, name, false
        end
        r, n = call(r, "GetParent"), n + 1
    end
    return nil, nil, false
end

-- Whether following the points from frame (the frames each of its points is on, and theirs) reaches target.
function P.FrameReaches(from, target)
    if not (from and target) then
        return false
    end
    local seen, queue, n = {}, { from }, 0
    while #queue > 0 and n < P.MAX_WALK do
        local f = table.remove(queue)
        n = n + 1
        if f == target then
            return true
        end
        if not seen[f] then
            seen[f] = true
            local count = num(call(f, "GetNumPoints")) or 0
            for i = 1, math.min(count, 8) do
                local ok, _, rel = pcall(f.GetPoint, f, i)
                if ok and not (issecretvalue and issecretvalue(rel)) and type(rel) == "table" and not seen[rel] then
                    queue[#queue + 1] = rel
                end
            end
        end
    end
    return false
end

local function isProtected(f)
    return flag(call(f, "IsProtected"))
end

-- Why it can't anchor to that frame, or nil when it can.
function El:FrameProblem(f)
    if self.spec.canAnchor == false then
        return TEXT.fixed
    end
    if not f then
        return TEXT.noName
    end
    if f == UIParent or f == WorldFrame then
        return TEXT.fullScreen
    end
    if flag(call(f, "IsForbidden")) or flag(call(f, "IsAnchoringRestricted")) then
        return TEXT.forbidden
    end
    if P.IsOwn(f) then
        return TEXT.own
    end
    local _, _, w, h = P.Rect(f)
    if not w then
        return TEXT.nowhere
    end
    local _, _, sw, sh = P.Rect(UIParent)
    if sw and w >= sw - 1 and h >= sh - 1 then
        return TEXT.fullScreen
    end
    if self.frame and P.FrameReaches(f, self.frame) then
        return TEXT.loop
    end
    if self.frame and isProtected(self.frame) and not isProtected(f) then
        return TEXT.spread
    end
    return nil
end

-- Whether anchoring to key would come back round to this element through the anchors saved along the way, or
-- through the points of the frames on the way.
function El:WouldLoop(key)
    local seen = {}
    while key do
        if key == self.key or seen[key] then
            return true
        end
        seen[key] = true
        local name = P.FrameName(key)
        if name then
            return self.frame ~= nil and P.FrameReaches(P.LookupFrame(name), self.frame)
        end
        local other = P.byKey[key]
        if other and other.frame and self.frame and other.frame ~= self.frame and P.FrameReaches(other.frame, self.frame) then
            return true
        end
        key = other and other:AnchorKey()
    end
    return false
end

-- Why it can't be anchored to that element or frame, or nil when it can (nil key: the screen, always). A protected
-- frame may only anchor to a protected one, CRT's elements too: else it would make that one protected in combat.
function El:AnchorProblem(key)
    if key == nil then
        return nil
    end
    if self.spec.canAnchor == false then
        return TEXT.fixed
    end
    local name = P.FrameName(key)
    if name then
        local f = P.LookupFrame(name)
        if not f then
            return string.format(TEXT.missing, name)
        end
        return self:FrameProblem(f)
    end
    local other = P.byKey[key]
    if not other or other == self or other.spec.target == false or not (other.frame or other.spec.build) then
        return TEXT.notTarget
    end
    if self:WouldLoop(key) then
        return TEXT.loop
    end
    -- an element not made yet can't say whether it is protected: refused until it is
    if self.frame and isProtected(self.frame) and not (other.frame and isProtected(other.frame)) then
        return TEXT.spread
    end
    return nil
end

function El:CanAnchorTo(key)
    return self:AnchorProblem(key) == nil
end

-- Whether it is anchored to a frame on screen, itself or through the elements it is anchored to.
function El:External()
    local key, seen = self:AnchorKey(), {}
    while key and not seen[key] do
        if P.FrameName(key) then
            return true
        end
        seen[key] = true
        local other = P.byKey[key]
        key = other and other:AnchorKey()
    end
    return false
end

-- The saved anchor when it can be used, else nil (the screen). A frame the game refused to anchor to this session
-- (self.refused) can't be.
function El:LiveAnchor()
    local key = self:AnchorKey()
    if key and self.refused and P.FrameName(key) == self.refused then
        return nil
    end
    if key and self:CanAnchorTo(key) and self:AnchorFrame(key) then
        return key
    end
    return nil
end

-- The frame of the element with that key, made first when it hasn't been (spec.build), or the frame on screen a
-- "frame:<name>" key names.
function El:AnchorFrame(key)
    local name = P.FrameName(key)
    if name then
        return P.LookupFrame(name)
    end
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

-- A place saved at another point, turned into its own point at the same spot (spec.keepPoint), its anchor and the
-- spot it keeps on the screen kept too.
local function holdAt(p, point, w, h)
    local fx, fy = fraction(p.point)
    local cx, cy = fraction(point)
    local dx, dy = (cx - fx) * w, (cy - fy) * h
    local sx, sy = num(p.screenX), num(p.screenY)
    return { point = point, relativePoint = p.relativePoint or p.point, x = (tonumber(p.x) or 0) + dx, y = (tonumber(p.y) or 0) + dy,
        anchor = p.anchor, screenX = sx and sx + dx, screenY = sy and sy + dy }
end

-- Where it is saved (on its anchor, or the screen), else its default. The place for a spec.place element.
function El:ApplySaved()
    local f = self.frame
    if not f then
        return
    end
    -- on a frame on screen (or on an element that is): never placed in combat, it waits for combat to end
    if inCombat() and self:External() then
        P.queued[self] = true
        return
    end
    P.queued[self] = nil
    local p, s = self:Saved()
    local rel = UIParent
    self.waiting = nil
    if p and p.anchor ~= nil then
        local key = self:LiveAnchor()
        rel = key and self:AnchorFrame(key)
        if not rel then
            p, rel = self:Missing(p), UIParent
        end
    end
    local saved = p ~= nil and p == (s and s.position)
    if saved and rel ~= UIParent then
        p = self:FollowCorner(p, s, rel)
    end
    p = p or self:Default()
    if self.spec.keepPoint and p.point ~= self:Point() then
        local w, h = 0, 0
        if self.spec.size then
            w, h = self.spec.size()
        else
            w, h = num(f:GetWidth()) or 0, num(f:GetHeight()) or 0
        end
        local held = holdAt(p, self:Point(), w, h)
        if saved and s then
            s.position = held
        elseif s and s.position and p ~= s.position then
            -- the spot kept for a frame that isn't loaded: kept at the new point too
            s.position = holdAt(s.position, self:Point(), w, h)
        end
        p = held
    end
    f:ClearAllPoints()
    local ok = pcall(f.SetPoint, f, p.point or "CENTER", rel, p.relativePoint or p.point or "CENTER", p.x or 0, p.y or 0)
    if not ok then
        -- the game refused that anchor (an anchor family it keeps apart): noted for this session, and the screen,
        -- the anchor kept
        self.refused = P.FrameName(s and s.position and s.position.anchor)
        p = self:Missing(s and s.position) or self:Default()
        f:ClearAllPoints()
        f:SetPoint(p.point or "CENTER", UIParent, p.relativePoint or p.point or "CENTER", p.x or 0, p.y or 0)
    end
end

-- Where it goes while its saved anchor can't be used: for a frame on screen, the spot it kept on the screen (else its
-- default), and a frame not loaded yet, or not given a place yet, is looked for again; for an element, its default
-- (nil).
function El:Missing(p)
    local name = p and P.FrameName(p.anchor)
    if not name then
        return nil
    end
    local f = P.LookupFrame(name)
    if name ~= self.refused and (not f or self:FrameProblem(f) == TEXT.nowhere) then
        self.waiting = name
        P.Retry(false)
    end
    local x, y = num(p.screenX), num(p.screenY)
    if not (x and y) then
        return nil
    end
    return { point = p.point or self:Point(), relativePoint = self.spec.relativePoint or p.point or self:Point(), x = x, y = y }
end

-- An anchored place saved from the anchor's corner before that one changed corner (the debuff panel's Grow): the
-- same spot, measured from the anchor's corner now, and saved so. A frame on screen keeps the corner it was saved on.
function El:FollowCorner(p, s, rel)
    local anchorEl = P.byKey[p.anchor]
    if not anchorEl then
        return p
    end
    local want = anchorEl:Point()
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
-- On a frame on screen it is held by its own point from that frame's same point, and the place keeps where it is on
-- the screen too (screenX, screenY). One whose frame isn't loaded moves on the screen, its anchor kept.
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
    local screenPoint = self.spec.relativePoint or point
    local relPoint = screenPoint
    if key then
        relPoint = P.byKey[key] and P.byKey[key]:Point() or point
    end
    local ax, ay, aw, ah = P.Rect(rel)
    local ux, uy, uw, uh = P.Rect(UIParent)
    if not (ax and ux) then
        return false
    end
    local rx, ry = pointAt(ax, ay, aw, ah, relPoint)
    local px, py = pointAt(cx, cy, w, h, point)
    local k = scaleOf(UIParent) / scaleOf(f)
    local x, y = round((px - rx) * k), round((py - ry) * k)
    f:ClearAllPoints()
    if not pcall(f.SetPoint, f, point, rel, relPoint, x, y) then
        -- the game refused that anchor: noted for this session, and placed where it can go
        self.refused = P.FrameName(key) or self.refused
        self:Apply()
        return false
    end
    if save then
        local old, s = self:Saved()
        if s then
            local srx, sry = pointAt(ux, uy, uw, uh, screenPoint)
            local sx, sy = round((px - srx) * k), round((py - sry) * k)
            if key and P.FrameName(key) then
                s.position = { point = point, relativePoint = relPoint, x = x, y = y, anchor = key, screenX = sx, screenY = sy }
            elseif not key and old and P.FrameName(old.anchor) then
                s.position = { point = point, relativePoint = old.relativePoint, x = old.x, y = old.y, anchor = old.anchor, screenX = sx,
                    screenY = sy }
            else
                s.position = { point = point, relativePoint = relPoint, x = x, y = y, anchor = key }
            end
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
    if key ~= nil and P.FrameName(key) == self.refused then
        self.refused = nil -- chosen again: tried again
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

-- Anchors it to the frame on screen called name (typed, or picked). Returns ok, and why not when it can't.
function P.AnchorToName(el, name)
    if inCombat() then
        P.Refuse()
        return false, TEXT.combat
    end
    name = type(name) == "string" and name:match("^%s*(.-)%s*$") or ""
    local f = P.LookupFrame(name)
    if not f then
        return false, string.format(TEXT.missing, name)
    end
    local problem = el:FrameProblem(f)
    if problem then
        return false, problem
    end
    if not el:SetAnchor(P.FrameKey(name)) then
        return false, el.refused == name and TEXT.forbidden or TEXT.nowhere
    end
    return true
end

-- What the panel says of its saved anchor when it can't be used now, or nil.
function El:AnchorStatus()
    local name = P.FrameName(self:AnchorKey())
    if not name or self:LiveAnchor() then
        return nil
    end
    local loaded = P.LookupFrame(name) and self:FrameProblem(P.LookupFrame(name)) ~= TEXT.nowhere
    return string.format((loaded or name == self.refused) and TEXT.cantUse or TEXT.notLoaded, name)
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
-- Escape stops selecting an anchor or drops the selection, Enter or Space while selecting anchors to what is under
-- the cursor;
-- any other key goes on to the game. Returns whether it took the key.
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
    elseif (key == "ENTER" or key == "SPACE") and P.picking then
        P.PickChoose()
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

-- Select Anchor: until a frame is chosen or it is cancelled, a left click (on UI/PlacementSelect.lua's overlay),
-- Enter or Space anchors the selecting one to the frame under the cursor (P.PickChoose). Refused in combat.
function El:StartPick()
    if inCombat() then
        return P.Refuse()
    end
    P.Select(self)
    P.picking, P.message, P.messageFor = self, nil, nil
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

-- A left click on an element's box: while selecting an anchor, it becomes the anchor (when it can); else it is
-- selected. (While selecting, the overlay takes the clicks, and P.PickChoose finds the element under it.)
function P.Click(el)
    if inCombat() or not el:Editable() then
        return
    end
    local picking = P.picking
    if picking then
        if el ~= picking then
            P.message = picking:AnchorProblem(el.key)
            if not P.message then
                P.picking = nil
                picking:SetAnchor(el.key)
            end
        end
        changed(picking)
        return
    end
    P.Select(el)
end

-- What is under the cursor while picking, for the name tag and for Enter: "element" and the element (another
-- element's box), "frame", the frame and its name, or "own" (CRT's own, the picking element itself), "noname" (a
-- frame with no named parent), "forbidden" (the game's), "nothing" (the world, the screen, or nothing at all).
function P.PickTarget(region)
    if region == nil or region == UIParent or region == WorldFrame then
        return "nothing"
    end
    if flag(call(region, "IsForbidden")) then
        return "forbidden"
    end
    local el = P.ElementOf(region)
    if el then
        return el ~= P.picking and "element" or "own", el
    end
    local f, name, own = P.ResolveFocus(region)
    if own then
        return "own"
    end
    if f then
        return "frame", f, name
    end
    return "noname"
end

local PICK_REFUSED = { noname = "noName", forbidden = "forbidden", nothing = "nothing", own = "own" }

-- A left click on the overlay, Enter or Space while selecting: anchors to what is under the cursor
-- (UI/PlacementSelect.lua's P.UnderCursor), or says why not (P.message, P.messageFor what it was about) and goes on
-- selecting.
function P.PickChoose()
    local el = P.picking
    if not el or inCombat() then
        return false
    end
    local kind, what, name = P.PickTarget(P.UnderCursor and P.UnderCursor())
    local ok, why = false, TEXT[PICK_REFUSED[kind] or "nothing"]
    if kind == "element" then
        why = el:AnchorProblem(what.key)
        ok = why == nil and el:SetAnchor(what.key)
        why = why or (not ok and TEXT.nowhere) or nil
    elseif kind == "frame" then
        ok, why = P.AnchorToName(el, name)
    end
    if ok then
        P.picking, P.message, P.messageFor = nil, nil, nil
    else
        P.message, P.messageFor = why or TEXT.nothing, what
    end
    changed(el)
    return ok
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

-- Frames not loaded yet, looked for again -----------------------------------------------------------
-- El:Missing asks for a timer; PLAYER_LOGIN and PLAYER_ENTERING_WORLD look at once and start the delays over. At most
-- P.MAX_RETRIES timers in a session: a frame that never comes leaves its element where it is, the anchor kept.

local retry = { step = 1, pending = false, used = 0 }

local function anyWaiting()
    for _, el in ipairs(P.list) do
        if el.waiting and el.frame then
            return true
        end
    end
    return false
end

-- now: every element waiting for its frame is placed again first (in combat that waits too).
function P.Retry(now)
    if now then
        for _, el in ipairs(P.list) do
            if el.waiting and el.frame then
                el:Apply()
            end
        end
    end
    local delay = P.RETRY_DELAYS[retry.step]
    if retry.pending or not delay or retry.used >= P.MAX_RETRIES or not anyWaiting() then
        return
    end
    if not (C_Timer and C_Timer.After) then
        return
    end
    retry.pending, retry.step, retry.used = true, retry.step + 1, retry.used + 1
    C_Timer.After(delay, function()
        retry.pending = false
        P.Retry(true)
    end)
end

-- Combat ending places every element that waited for it.
local function placeQueued()
    local list = {}
    for el in pairs(P.queued) do
        list[#list + 1] = el
    end
    for _, el in ipairs(list) do
        P.queued[el] = nil
        if el.frame then
            el:Apply()
        end
    end
end

local events = CreateFrame("Frame")
if events.RegisterEvent then
    events:RegisterEvent("PLAYER_REGEN_DISABLED")
    events:RegisterEvent("PLAYER_REGEN_ENABLED")
    events:RegisterEvent("PLAYER_LOGIN")
    events:RegisterEvent("PLAYER_ENTERING_WORLD")
end
events:SetScript("OnEvent", function(_, event)
    if event == "PLAYER_REGEN_ENABLED" then
        placeQueued()
    elseif event == "PLAYER_LOGIN" or event == "PLAYER_ENTERING_WORLD" then
        retry.step = 1
        P.Retry(true)
    else
        stopAll()
    end
end)

if UI.RegisterPreview then
    UI:RegisterPreview("placement", function(on)
        if not on then
            stopAll()
        end
    end)
end
