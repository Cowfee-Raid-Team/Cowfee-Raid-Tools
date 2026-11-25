local ADDON, CRT = ...

-- Go to a setting: a link that opens a page for one setting draws a box around that setting as it lands, so the
-- player sees which one it meant (#1311: Start here's What's on links, the Welcome's steps; later the (?) paths and
-- the greyed reasons).
--   UI:RegisterSpot(page, key, target)  a page names one of its controls when it makes it: target is the control (a
--                                        check box, whose .label or .Label is drawn right of it, or a dropdown or
--                                        slider row), or a function that first brings it on screen (such as picking
--                                        an area in a list) and returns it, and optionally its label
--   UI:FindSpot(page, key)              -> the control and its label, or nil when the page hasn't made it
--   UI:GoToSpot(page, key)              spotlights it once its page is open; -> the control, or nil (no box) when it
--                                        isn't there
--   UI.Spotlight(frame, opts)           the box around frame; opts.label, a font string right of it the box reaches
--                                        to the end of the text of
--   UI.ClearSpotlight()                 takes the box away
-- The box: a SPOT.edge px outline in the theme's accent colour, SPOT.pad px outside the control and its label's text,
-- above them, letting clicks through. It pulses gently (one pulse every SPOT.period seconds, under one a second: no
-- fast flashing) and fades out by SPOT.seconds. It goes early on any mouse click and when its page hides (it is a
-- child of the control's parent). A control that isn't visible gets no box.
-- In a scroll frame the control is scrolled into view first, and the box is a child of the scroll frame's parent
-- (above the scroll frame, so the scroll frame never clips it), kept inside the scroll frame's edges; it goes when
-- the list scrolls (the wheel, or any other scroll than the one that brought the control into view).
-- Game calls (warcraft.wiki.gg, read 2026-11-25): GLOBAL_MOUSE_DOWN (button), fired on every mouse button press;
-- ScrollFrame:GetScrollChild, GetVerticalScroll, GetVerticalScrollRange, SetVerticalScroll; Region:GetTop, GetBottom.

local UI = CRT.UI

-- pad: the gap around the control; edge: the outline's width; seconds: how long it shows; period: one pulse, in
-- seconds; fade: the last seconds, fading out; low: the alpha at the bottom of a pulse; level: frame levels above the
-- control; view: room kept above a control scrolled into view
local SPOT = { pad = 4, edge = 2, seconds = 3, period = 1.5, fade = 0.6, low = 0.35, level = 30, view = 8 }
UI.SPOTLIGHT = SPOT

local spots = {}
UI.spots = spots

-- the box's state: box, target, label, t (seconds shown)
local S = {}
UI.spotlight = S

function UI:RegisterSpot(page, key, target)
    spots[page] = spots[page] or {}
    spots[page][key] = target
end

-- A check box's label: the font string beside it (the helpers keep it as .label, the Timeline's as .Label).
local function labelOf(frame)
    if not (frame.GetObjectType and frame:GetObjectType() == "CheckButton") then
        return nil
    end
    local label = rawget(frame, "label") or rawget(frame, "Label")
    if type(label) == "table" and label.GetStringWidth then
        return label
    end
    return nil
end

function UI:FindSpot(page, key)
    local target = spots[page] and spots[page][key]
    local label
    if type(target) == "function" then
        local ok, frame, own = pcall(target)
        if not ok then
            return nil
        end
        target, label = frame, own
    end
    if type(target) ~= "table" then
        return nil
    end
    return target, label or labelOf(target)
end

-- The box's alpha t seconds in: from 1 down to SPOT.low and back each SPOT.period, fading to 0 over the last
-- SPOT.fade seconds; 0 once SPOT.seconds have gone.
function UI.SpotlightAlpha(t)
    if t >= SPOT.seconds then
        return 0
    end
    local a = SPOT.low + (1 - SPOT.low) * (0.5 + 0.5 * math.cos(2 * math.pi * t / SPOT.period))
    local left = SPOT.seconds - t
    if left < SPOT.fade then
        a = a * left / SPOT.fade
    end
    return a
end

local function number(region, method)
    local f = region and region[method]
    local ok, v = false, nil
    if f then
        ok, v = pcall(f, region)
    end
    return ok and tonumber(v) or nil
end

local function paint(a)
    local r, g, b = UI.Color("accent")
    for _, e in ipairs(S.box.edges) do
        e:SetColorTexture(r, g, b, a)
    end
end

-- Places the box around the control and its label's text (UI.ControlExtent, as a greyed control's cover). In a
-- scroll frame, the box is cut to the scroll frame's edges, placed from both frames' edges once they are laid out;
-- before that (no edges yet, or a scroll frame of no size), anchored on the control with no room to its left, until the
-- next frame's fit. Returns false when the
-- control is outside the scroll frame's view (no box to draw).
local function fit()
    local box, frame, scroll = S.box, S.target, S.scroll
    local w, h = UI.ControlExtent(frame, S.label)
    local pad = SPOT.pad
    box:ClearAllPoints()
    if not scroll then
        box:SetPoint("LEFT", frame, "LEFT", -pad, 0)
        box:SetSize(w + 2 * pad, h + 2 * pad)
        return true
    end
    local fl, ft, fb = number(frame, "GetLeft"), number(frame, "GetTop"), number(frame, "GetBottom")
    local sl, sr = number(scroll, "GetLeft"), number(scroll, "GetRight")
    local st, sb = number(scroll, "GetTop"), number(scroll, "GetBottom")
    -- not laid out yet (no edges, or none apart)
    if not (fl and ft and fb and sl and sr and st and sb) or sr <= sl or st <= sb then
        box:SetPoint("LEFT", frame, "LEFT", 0, 0)
        box:SetSize(w + pad, h)
        return true
    end
    local mid = (ft + fb) / 2
    local left, right = math.max(sl, fl - pad), math.min(sr, fl + w + pad)
    local top, bottom = math.min(st, mid + h / 2 + pad), math.max(sb, mid - h / 2 - pad)
    if right <= left or top <= bottom then
        return false
    end
    box:SetPoint("TOPLEFT", scroll, "TOPLEFT", left - sl, top - st)
    box:SetSize(right - left, top - bottom)
    return true
end

local function scrollFrameOf(frame)
    local p = frame.GetParent and frame:GetParent()
    for _ = 1, 20 do
        if type(p) ~= "table" then
            return nil
        end
        if p.GetObjectType and p:GetObjectType() == "ScrollFrame" then
            return p
        end
        p = p.GetParent and p:GetParent()
    end
    return nil
end

-- Scrolls a control in a scroll frame into view, when it is out of it.
local function scrollTo(frame)
    local scroll = scrollFrameOf(frame)
    local child = scroll and scroll.GetScrollChild and scroll:GetScrollChild()
    local top, bottom, childTop = number(frame, "GetTop"), number(frame, "GetBottom"), number(child, "GetTop")
    local view = number(scroll, "GetHeight")
    if not (top and bottom and childTop and view) then
        return
    end
    local from, to = childTop - top, childTop - bottom -- the control's top and bottom, down the scroll child
    local now = number(scroll, "GetVerticalScroll") or 0
    if from - SPOT.view >= now and to + SPOT.view <= now + view then
        return
    end
    local range = number(scroll, "GetVerticalScrollRange") or 0
    local at = math.max(0, math.min(range, from - SPOT.view))
    S.scrollAt = at -- its own scroll never takes the box away (watchScroll)
    scroll:SetVerticalScroll(at)
end

-- The list scrolling takes the box away: the wheel, or a scroll to anywhere but where the spotlight put it (S.scrollAt).
-- Hooked once per scroll frame.
local watched = setmetatable({}, { __mode = "k" })
local function watchScroll(scroll)
    if watched[scroll] or not scroll.HookScript then
        return
    end
    watched[scroll] = true
    scroll:HookScript("OnVerticalScroll", function(self, offset)
        if S.scroll == self and S.target and (tonumber(offset) or number(self, "GetVerticalScroll")) ~= S.scrollAt then
            UI.ClearSpotlight()
        end
    end)
    if scroll.GetScript and scroll:GetScript("OnMouseWheel") then
        scroll:HookScript("OnMouseWheel", function(self)
            if S.scroll == self then
                UI.ClearSpotlight()
            end
        end)
    end
end

function UI.ClearSpotlight()
    local box = S.box
    S.target, S.label, S.scroll = nil, nil, nil
    if box and not S.clearing then
        S.clearing = true
        box:UnregisterEvent("GLOBAL_MOUSE_DOWN")
        box:Hide()
        S.clearing = false
    end
end

local function step(dt)
    if not S.target then
        return
    end
    S.t = S.t + (dt or 0)
    local a = UI.SpotlightAlpha(S.t)
    if a <= 0 then
        UI.ClearSpotlight()
        return
    end
    paint(a)
end

local function makeBox()
    local box = CreateFrame("Frame")
    box:Hide()
    box:EnableMouse(false)
    local e = {}
    for i = 1, 4 do
        e[i] = box:CreateTexture(nil, "OVERLAY")
    end
    -- top, bottom, left, right
    e[1]:SetPoint("TOPLEFT")
    e[1]:SetPoint("TOPRIGHT")
    e[1]:SetHeight(SPOT.edge)
    e[2]:SetPoint("BOTTOMLEFT")
    e[2]:SetPoint("BOTTOMRIGHT")
    e[2]:SetHeight(SPOT.edge)
    e[3]:SetPoint("TOPLEFT")
    e[3]:SetPoint("BOTTOMLEFT")
    e[3]:SetWidth(SPOT.edge)
    e[4]:SetPoint("TOPRIGHT")
    e[4]:SetPoint("BOTTOMRIGHT")
    e[4]:SetWidth(SPOT.edge)
    box.edges = e
    box:SetScript("OnUpdate", function(_, dt)
        step(dt)
    end)
    -- its page hid (the box is a child of the control's parent), or it was taken away
    box:SetScript("OnHide", function()
        UI.ClearSpotlight()
    end)
    box:SetScript("OnEvent", function(_, event)
        if event == "GLOBAL_MOUSE_DOWN" then
            UI.ClearSpotlight()
        end
    end)
    return box
end

function UI.Spotlight(frame, opts)
    UI.ClearSpotlight()
    if type(frame) ~= "table" or (frame.IsVisible and not frame:IsVisible()) then
        return nil
    end
    opts = opts or {}
    S.box = S.box or makeBox()
    local box = S.box
    local scroll = scrollFrameOf(frame)
    local owner = scroll or frame
    box:SetParent(owner.GetParent and owner:GetParent() or UIParent)
    if frame.GetFrameLevel then
        local level = frame:GetFrameLevel() or 0
        if scroll and scroll.GetFrameLevel then
            level = math.max(level, scroll:GetFrameLevel() or 0)
        end
        box:SetFrameLevel(level + SPOT.level)
    end
    S.target, S.label, S.scroll, S.t = frame, opts.label, scroll, 0
    if scroll then
        scrollTo(frame)
        S.scrollAt = number(scroll, "GetVerticalScroll")
        watchScroll(scroll)
    end
    if not fit() then
        UI.ClearSpotlight()
        return nil
    end
    paint(UI.SpotlightAlpha(0))
    box:Show()
    box:RegisterEvent("GLOBAL_MOUSE_DOWN")
    -- measured again on the next frame, once the page that just opened is laid out
    if C_Timer and C_Timer.After then
        C_Timer.After(0, function()
            if S.target == frame then
                if S.scroll then
                    scrollTo(frame)
                    S.scrollAt = number(S.scroll, "GetVerticalScroll")
                end
                if not fit() then
                    UI.ClearSpotlight()
                end
            end
        end)
    end
    return box
end

function UI:GoToSpot(page, key)
    local frame, label = self:FindSpot(page, key)
    if not frame then
        return nil
    end
    if not UI.Spotlight(frame, { label = label }) then
        return nil
    end
    return frame, label
end
