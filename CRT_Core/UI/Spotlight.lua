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
-- child of the control's parent). A control in a scroll frame is scrolled into view first.
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

-- Places the box around the control and its label's text (UI.ControlExtent, as a greyed control's cover).
local function fit()
    local box, frame = S.box, S.target
    local w, h = UI.ControlExtent(frame, S.label)
    box:ClearAllPoints()
    box:SetPoint("LEFT", frame, "LEFT", -SPOT.pad, 0)
    box:SetSize(w + 2 * SPOT.pad, h + 2 * SPOT.pad)
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
    scroll:SetVerticalScroll(math.max(0, math.min(range, from - SPOT.view)))
end

function UI.ClearSpotlight()
    local box = S.box
    S.target, S.label = nil, nil
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
    if type(frame) ~= "table" then
        return nil
    end
    opts = opts or {}
    S.box = S.box or makeBox()
    local box = S.box
    box:SetParent(frame.GetParent and frame:GetParent() or UIParent)
    if frame.GetFrameLevel then
        box:SetFrameLevel((frame:GetFrameLevel() or 0) + SPOT.level)
    end
    S.target, S.label, S.t = frame, opts.label, 0
    scrollTo(frame)
    fit()
    paint(UI.SpotlightAlpha(0))
    box:Show()
    box:RegisterEvent("GLOBAL_MOUSE_DOWN")
    -- measured again on the next frame, once the page that just opened is laid out
    if C_Timer and C_Timer.After then
        C_Timer.After(0, function()
            if S.target == frame then
                scrollTo(frame)
                fit()
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
    UI.Spotlight(frame, { label = label })
    return frame, label
end
