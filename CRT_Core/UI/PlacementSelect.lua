local ADDON, CRT = ...

-- Select Anchor (the Placement panel's main anchor control): while el:StartPick runs, the screen dims under a
-- click-catching overlay, the frame under the cursor gets an accent outline and its name in a tag at the cursor, a
-- left click selects it (P.PickChoose), a right click or Escape cancels (P.Escape), and Enter or Space select too.
--
-- The overlay is a full-screen frame in the TOOLTIP strata with the mouse on, so a click goes to it and never to
-- the frame under it: no target, no click-cast, no button pressed. It acts on the button's release (OnMouseUp), so
-- the press and the release both land on it. Being the topmost mouse frame, it is what the game reports under the
-- cursor (GetMouseFoci), so the frame under it is found by a hit test instead: EnumerateFrames goes through every
-- frame once when selecting starts (and again, for frames shown since, once the cursor stops after a move, at most
-- every L.refreshSeconds), keeping the visible ones that take the mouse (motion or clicks, as the game's own mouse
-- focus does); then each hover only asks those IsMouseOver (and the parents that clip them: a row scrolled out of
-- its list is cut off) and takes the topmost: higher strata, then higher frame level, then a child over its parent,
-- then the one made later. The answer is kept until the cursor moves; the list is let go when selecting stops.
--
-- Combat: el:StartPick refuses, combat starting cancels (Placement.lua's PLAYER_REGEN_DISABLED), and the overlay
-- also cancels itself on its next frame in combat. The outline and tag are placed from the target's rect on
-- UIParent, never anchored to the target, so they never touch another addon's or the game's frames.

local UI = CRT.UI
local P = UI.Placement

local L = {
    strata = "TOOLTIP", level = 9000, -- the overlay; the outline and the tag sit just above it
    dim = 0.3, -- the overlay's dimming
    box = 2, boxOut = 2, -- the outline's thickness, and how far outside the frame
    tag = 16, tagPad = 8, tagOffset = 16, -- the name tag at the cursor
    hoverSeconds = 0.05, -- how often the tag reads the frame under the cursor
    refreshSeconds = 1, -- the list of frames that take the mouse is read again at most this often,
    stillSeconds = 0.3, -- and only once the cursor has stopped this long after moving
    maxFrames = 200000, -- frames read at most in one pass
}
P.SELECT_LAYOUT = L

-- Lowest to highest (Frame Strata on warcraft.wiki.gg).
local STRATA_RANK = {
    WORLD = 1, BACKGROUND = 2, LOW = 3, MEDIUM = 4, HIGH = 5, DIALOG = 6, FULLSCREEN = 7, FULLSCREEN_DIALOG = 8,
    TOOLTIP = 9,
}

local num, call, yes, inCombat = P.num, P.call, P.flag, P.inCombat -- Placement.lua's
local overlay, box, tag
local mine = {} -- the frames made here, never found by the hit test
local hoverWait = 0

local function now()
    return GetTime and num(GetTime()) or 0
end

-- The hit test ------------------------------------------------------------------------------------

local hits = { list = nil, at = 0 } -- the frames that take the mouse, and when they were read
local last = {} -- the last answer, with the cursor it was for, and when the cursor last moved (last.moved)

local function strataRank(f)
    local s = call(f, "GetFrameStrata")
    if type(s) ~= "string" or (issecretvalue and issecretvalue(s)) then
        return 0
    end
    return STRATA_RANK[s] or 0
end

-- The parents of f that clip their children (Frame:DoesClipChildren): f only shows inside all of them. Nil for none.
local function clippers(f)
    local out
    local r, n = call(f, "GetParent"), 0
    while r and r ~= UIParent and n < P.MAX_WALK do
        if yes(call(r, "DoesClipChildren")) then
            out = out or {}
            out[#out + 1] = r
        end
        r, n = call(r, "GetParent"), n + 1
    end
    return out
end

-- Every visible frame (EnumerateFrames gives none of the forbidden ones) that takes the mouse, in the order made.
local function collect()
    local list = {}
    if not EnumerateFrames then
        return list
    end
    local ok, f = pcall(EnumerateFrames)
    local n = 0
    while ok and f and n < L.maxFrames do
        n = n + 1
        -- most frames are hidden, so that is asked first
        if yes(call(f, "IsVisible")) and not mine[f] and not yes(call(f, "IsForbidden"))
            and (yes(call(f, "IsMouseMotionEnabled")) or yes(call(f, "IsMouseClickEnabled"))) then
            list[#list + 1] = { frame = f, rank = strataRank(f), level = num(call(f, "GetFrameLevel")) or 0, order = n,
                clips = clippers(f) }
        end
        ok, f = pcall(EnumerateFrames, f)
    end
    return list
end

-- Whether f is inside parent (a child, or deeper).
local function inside(f, parent)
    local r, n = call(f, "GetParent"), 0
    while r and n < P.MAX_WALK do
        if r == parent then
            return true
        end
        r, n = call(r, "GetParent"), n + 1
    end
    return false
end

-- Whether a is drawn over b.
local function over(a, b)
    if a.rank ~= b.rank then
        return a.rank > b.rank
    end
    if a.level ~= b.level then
        return a.level > b.level
    end
    if inside(a.frame, b.frame) then
        return true
    end
    if inside(b.frame, a.frame) then
        return false
    end
    return a.order > b.order
end

-- Whether the cursor is over c's frame where it shows: inside every parent that clips it (a row scrolled out of
-- its list is cut off there).
local function hit(c)
    if not (yes(call(c.frame, "IsVisible")) and yes(call(c.frame, "IsMouseOver"))) then
        return false
    end
    for _, r in ipairs(c.clips or {}) do
        if not yes(call(r, "IsMouseOver")) then
            return false
        end
    end
    return true
end

-- The topmost frame under the cursor that takes the mouse, the overlay left out; nil when there is none. The frames
-- are read when there is no list yet (P.UnderCursor reads them again).
function P.HitTest()
    if not hits.list then
        hits.list, hits.at = collect(), now()
    end
    local best
    for _, c in ipairs(hits.list) do
        if (not best or over(c, best)) and hit(c) then
            best = c
        end
    end
    return best and best.frame or nil
end

-- The frame under the cursor while selecting, kept until the cursor moves. The frames are read again (for frames
-- shown since) only once the cursor has stopped for L.stillSeconds after a move, and at most every
-- L.refreshSeconds, so a sweep across the screen never reads them.
function P.UnderCursor()
    local x, y = GetCursorPosition()
    x, y = num(x), num(y)
    local t = now()
    local moved = last.x ~= x or last.y ~= y
    if moved then
        last.moved = t
    end
    local settled = last.moved and last.moved > hits.at and t - last.moved >= L.stillSeconds
    if hits.list and settled and t - hits.at >= L.refreshSeconds then
        hits.list, hits.at = collect(), t
        moved = true
    end
    if hits.list and not moved and last.at == hits.at then
        return last.frame
    end
    local f = P.HitTest()
    last.x, last.y, last.at, last.frame = x, y, hits.at, f
    return f
end

-- Lets go of the frames read: they are read again on the next hover (selecting starts or stops, or a test changed
-- them).
function P.ForgetHits()
    hits.list, hits.at = nil, 0
    last = {}
end

-- How many frames the hit test holds now (0 when it holds none).
function P.HeldHits()
    return hits.list and #hits.list or 0
end

-- The overlay, the outline and the tag ------------------------------------------------------------------

local function makeOverlay()
    overlay = CreateFrame("Frame", nil, UIParent)
    overlay:SetAllPoints(UIParent)
    overlay:SetFrameStrata(L.strata)
    overlay:SetFrameLevel(L.level)
    overlay:EnableMouse(true) -- takes every click, so none reaches the frame under it
    overlay.dim = overlay:CreateTexture(nil, "BACKGROUND")
    overlay.dim:SetAllPoints(overlay)
    UI.Tint(overlay.dim, "SetColorTexture", "background", L.dim)
    overlay:SetScript("OnMouseUp", function(_, button)
        P.SelectClick(button)
    end)
    overlay:SetScript("OnUpdate", function(_, dt)
        if inCombat() or not P.picking then
            if P.picking then
                P.Escape()
            else
                P.SelectSync()
            end
            return
        end
        hoverWait = hoverWait + (dt or 0)
        if hoverWait >= L.hoverSeconds then
            hoverWait = 0
            P.PickHover()
        end
    end)
    overlay:Hide()
    mine[overlay] = true
    P.pickOverlay = overlay
end

local function makeBox()
    box = CreateFrame("Frame", nil, UIParent)
    box:SetFrameStrata(L.strata)
    box:SetFrameLevel(L.level + 10)
    box:EnableMouse(false)
    local function edge(from, to, width, height)
        local t = box:CreateTexture(nil, "OVERLAY")
        UI.Tint(t, "SetColorTexture", "accent")
        t:SetPoint(from)
        t:SetPoint(to)
        if width then
            t:SetWidth(width)
        else
            t:SetHeight(height)
        end
    end
    edge("TOPLEFT", "TOPRIGHT", nil, L.box)
    edge("BOTTOMLEFT", "BOTTOMRIGHT", nil, L.box)
    edge("TOPLEFT", "BOTTOMLEFT", L.box)
    edge("TOPRIGHT", "BOTTOMRIGHT", L.box)
    box:Hide()
    mine[box] = true
    P.pickBox = box
end

local function makeTag()
    tag = CreateFrame("Frame", nil, UIParent, "BackdropTemplate")
    tag:SetFrameStrata(L.strata)
    tag:SetFrameLevel(L.level + 20)
    tag:EnableMouse(false)
    tag:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8" })
    UI.Tint(tag, "SetBackdropColor", "surface", 0.9)
    tag.text = tag:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    tag.text:SetPoint("CENTER")
    UI.Tint(tag.text, "SetTextColor", "heading")
    tag:Hide()
    mine[tag] = true
    P.pickTag = tag
end

local function hideMarks()
    if box then
        box:Hide()
    end
    if tag then
        tag:Hide()
    end
end

-- The outline round f, from its rect on UIParent (never anchored to f itself).
local function outline(f)
    local cx, cy, w, h = P.Rect(f)
    if not (cx and w and w > 0 and h > 0) then
        box:Hide()
        return
    end
    box:ClearAllPoints()
    box:SetPoint("CENTER", UIParent, "BOTTOMLEFT", cx, cy)
    box:SetSize(w + 2 * L.boxOut, h + 2 * L.boxOut)
    box:Show()
end

-- What the tag says for each kind of thing under the cursor (P.PickTarget); over CRT's own it hides.
local TAG_TEXT = { noname = "noName", nothing = "nothing", forbidden = "forbidden" }

-- While selecting: the outline round what a click would anchor to, and the tag at the cursor with its name (a
-- frame's name, another element's title), why there is nothing to anchor to there, or why a click on it was refused.
function P.PickHover()
    if not P.picking or inCombat() then
        hideMarks()
        return
    end
    if not tag then
        makeTag()
        makeBox()
    end
    local kind, what, name = P.PickTarget(P.UnderCursor())
    local x, y = GetCursorPosition()
    local s = UIParent:GetEffectiveScale()
    x, y, s = num(x), num(y), num(s) or 1
    if kind == "own" or not (x and y) or s <= 0 then
        hideMarks()
        return
    end
    local target = kind == "frame" and what or kind == "element" and what.frame or nil
    if target then
        outline(target)
    else
        box:Hide()
    end
    local text = kind == "frame" and name or kind == "element" and what.title or P.TEXT[TAG_TEXT[kind] or "nothing"]
    if P.message and what ~= nil and P.messageFor == what then
        text = P.message
    end
    tag.text:SetText(text)
    tag:SetSize((num(tag.text:GetStringWidth()) or 0) + L.tagPad, L.tag)
    tag:ClearAllPoints()
    tag:SetPoint("BOTTOMLEFT", UIParent, "BOTTOMLEFT", x / s + L.tagOffset, y / s + L.tagOffset)
    tag:Show()
end

-- A click on the overlay: the left button selects what is under the cursor, the right one cancels; any other is
-- only kept from the game.
function P.SelectClick(button)
    if not P.picking or inCombat() then
        return
    end
    if button == "LeftButton" then
        P.PickChoose()
    elseif button == "RightButton" then
        P.Escape()
    end
end

-- Every change (PlacementPanel.lua's P.OnChanged): the overlay shows while selecting, out of combat only.
function P.SelectSync()
    if P.picking and not inCombat() then
        if not overlay then
            makeOverlay()
        end
        if not overlay:IsShown() then
            P.ForgetHits()
            hoverWait = 0
            overlay:Show()
        end
        P.PickHover()
        return
    end
    if overlay then
        overlay:Hide()
    end
    hideMarks()
    P.ForgetHits()
end
