local ADDON, CRT = ...

-- Timeline Rehearsal: the window that plays a boss fight out on the Rehearsal clock (Rehearsal.lua).
-- A separate pop-up, movable by its title, that stays open while the Timeline is closed. Top to
-- bottom: the title "Rehearsal · <boss>" with its close button; the boss panel (the name, a health
-- bar draining evenly from 100% at the pull to 0% at the fight's length, and the percentage); the
-- cast bar (the cast showing now, its icon and name, filling over its last Rehearsal.CAST seconds); Next up
-- (the next 3 casts counting down to them, leaving out the one in the cast bar); the strip (STRIP_SPAN seconds of the fight's casts in their
-- type colors scrolling under a fixed "now" line a third of the way across, the time over that line,
-- the phase lines and their labels, and a faint line every 30 seconds labelled along the bottom; a
-- click jumps there, and dragging with either button scrubs, the clock jumping once on release); and the controls (Play/Pause, Restart, Speed, Preview as and
-- the clock). An OnUpdate redraws from the clock while it plays. At the fight's length the clock
-- stops and the window says "Rehearsal over".
-- The window only drives its own clock. The alerts engine is hooked on through
-- RehearsalWindow.onPlay(), onPause(), onSeek(t), onClose(), onAs(as) and onTick(now) (each frame
-- while it plays), which are called when that happens; RehearsalRun at the end of this file sets
-- them. timeline.rehearsal keeps the position, the speed and Preview as (nil is you, "*" everyone, or
-- a player's name); the clock and the source aren't saved.

local Rehearsal = CRT.TimelineRehearsal
local RehearsalWindow = {}
CRT.TimelineRehearsalWindow = RehearsalWindow

local W, PAD = 360, 12
local INNER = W - PAD * 2
local H = 338
local BAR_H = 16
local CAST_H = 20
local CAST_W = INNER - CAST_H - 4
local NEXT_N = 3
local NEXT_H = 18
local NEXT_COUNT = 10 -- seconds before a cast its Next up line counts down in tenths and fills its bar,
-- full when the cast moves into the cast bar Rehearsal.CAST seconds before it
local NEXT_BAR_W = INNER - 20
local STRIP_H = 68
local STRIP_LABEL_H = 14 -- the phase labels' row at the top of the strip
local STRIP_TICK_H = 12 -- the 30-second labels' row at the bottom of the strip
local STRIP_TOP = -192 -- under the time shown over the now line
local TICK = 30 -- seconds between the strip's time lines
local DRAG_MIN = 3 -- pixels a press moves before it is a drag, not a click
local MARK_W = 3
local ICON = "Interface\\Icons\\INV_Misc_QuestionMark"
local SPEEDS = { 1, 2, 4 }

RehearsalWindow.STRIP_W = INNER
RehearsalWindow.TICK = TICK
RehearsalWindow.BAR_W = INNER
RehearsalWindow.CAST_W = CAST_W
RehearsalWindow.NEXT_COUNT = NEXT_COUNT
RehearsalWindow.NEXT_BAR_W = NEXT_BAR_W

local TEXT = {
    title = "Rehearsal \194\183 ",
    boss = "Boss",
    over = "Rehearsal over",
    play = "Play",
    pause = "Pause",
    restart = "Restart",
    nextUp = "Next up",
    speed = "Speed",
    as = "Preview as",
    me = "Me",
    everyone = "Everyone",
    asHelp = "Whose alerts the rehearsal fires. Me: exactly yours. Everyone: every line, with who it's for. A player: what they would get. The players are the selected Raid Groups page's, or your group's when that page is empty.",
    stripHelp = "The next stretch of the fight in the rows' type colors, the line being now, with a line every 30 seconds. Click it to jump there, or drag it with either mouse button to scrub through the fight.",
    inCombat = "Rehearsal can't start in combat.",
    inEncounter = "Rehearsal can't start during a boss encounter.",
    running = "Rehearsal can't start while the alerts are running a pull or a test.",
    testing = "Testing: ",
    noSource = "Rehearsal has no ability timeline or recorded pull for this boss.",
}

local function mocha(key, alpha)
    local c = CRT.MOCHA[key]
    return c[1], c[2], c[3], alpha or 1
end

-- timeline.rehearsal, made when first needed.
local function saved()
    local db = CRT.Timeline:Settings()
    db.rehearsal = db.rehearsal or {}
    return db.rehearsal
end

local function savedSpeed()
    local s = saved().speed
    for _, v in ipairs(SPEEDS) do
        if v == s then
            return s
        end
    end
    return 1
end

-- "1:05"
local function fmt(t)
    t = math.max(0, math.floor(t or 0))
    return string.format("%d:%02d", math.floor(t / 60), t % 60)
end
RehearsalWindow.Format = fmt

local function hook(name, ...)
    local fn = RehearsalWindow[name]
    if fn then
        fn(...)
    end
end

-- A cast's color: its lane's, else the type color of the lane's first type (as the Timeline view
-- colors a reference row), else caramel (the view's color for a row without one).
local function castColor(cast)
    if cast.color then
        return cast.color
    end
    local lane = cast.lane
    local key = lane and lane.types and lane.types[1]
    local Reference = CRT.TimelineReference
    local t = key and Reference and Reference.TYPES and Reference.TYPES[key]
    if t then
        return t.color
    end
    return CRT.MOCHA.caramel
end
RehearsalWindow.CastColor = castColor

local function fontString(parent, font)
    return parent:CreateFontString(nil, "OVERLAY", font)
end

local function button(parent, text, width)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontButtonSmall)
    b:SetHighlightFontObject(CRTFontButtonSmallHighlight)
    b:SetDisabledFontObject(CRTFontButtonSmallDisable)
    b:SetSize(width, 20)
    b:SetText(text)
    return b
end

-- The i-th texture of a pool, made when first needed.
local function pooled(pool, i, parent, layer)
    local tex = pool[i]
    if not tex then
        tex = parent:CreateTexture(nil, layer)
        pool[i] = tex
    end
    return tex
end

local function pooledLabel(pool, i, parent)
    local fs = pool[i]
    if not fs then
        fs = fontString(parent, "CRTFontSmall")
        pool[i] = fs
    end
    return fs
end

-- Saved as TOPLEFT from the screen's TOPLEFT, so it goes back where it was whatever point the drag
-- left it anchored from.
local function savePosition(f)
    local left, top = f:GetLeft(), f:GetTop()
    if not (left and top) then
        return
    end
    local s = saved()
    s.point, s.x, s.y = "TOPLEFT", left, top - (UIParent:GetHeight() or 0)
end

local function applyPosition(f)
    local s = saved()
    f:ClearAllPoints()
    if s.point then
        f:SetPoint(s.point, UIParent, s.point, s.x or 0, s.y or 0)
    else
        f:SetPoint("CENTER", UIParent, "CENTER", 0, 120)
    end
end

local function buildBoss(f)
    f.bossName = fontString(f, "CRTFontNormal")
    f.bossName:SetPoint("TOPLEFT", f, "TOPLEFT", PAD, -32)
    f.bossName:SetPoint("RIGHT", f, "RIGHT", -PAD - 110, 0)
    f.bossName:SetJustifyH("LEFT")
    f.bossName:SetWordWrap(false)
    f.difficulty = fontString(f, "CRTFontSmall")
    f.difficulty:SetPoint("TOPRIGHT", f, "TOPRIGHT", -PAD, -34)
    f.difficulty:SetJustifyH("RIGHT")

    f.healthBg = f:CreateTexture(nil, "BORDER")
    f.healthBg:SetPoint("TOPLEFT", f, "TOPLEFT", PAD, -52)
    f.healthBg:SetSize(INNER, BAR_H)
    f.healthBg:SetColorTexture(0, 0, 0, 0.5)
    f.healthFill = f:CreateTexture(nil, "ARTWORK")
    f.healthFill:SetPoint("TOPLEFT", f.healthBg, "TOPLEFT", 0, 0)
    f.healthFill:SetHeight(BAR_H)
    f.healthFill:SetColorTexture(0.75, 0.16, 0.14, 0.9)
    f.healthText = fontString(f, "CRTFontSmall")
    f.healthText:SetPoint("CENTER", f.healthBg, "CENTER", 0, 0)
end

local function buildCast(f)
    f.castIcon = f:CreateTexture(nil, "ARTWORK")
    f.castIcon:SetPoint("TOPLEFT", f, "TOPLEFT", PAD, -76)
    f.castIcon:SetSize(CAST_H, CAST_H)
    f.castBg = f:CreateTexture(nil, "BORDER")
    f.castBg:SetPoint("TOPLEFT", f, "TOPLEFT", PAD + CAST_H + 4, -76)
    f.castBg:SetSize(CAST_W, CAST_H)
    f.castBg:SetColorTexture(0, 0, 0, 0.5)
    f.castFill = f:CreateTexture(nil, "ARTWORK")
    f.castFill:SetPoint("TOPLEFT", f.castBg, "TOPLEFT", 0, 0)
    f.castFill:SetHeight(CAST_H)
    f.castName = fontString(f, "CRTFontSmall")
    f.castName:SetPoint("LEFT", f.castBg, "LEFT", 4, 0)
    f.castName:SetPoint("RIGHT", f.castBg, "RIGHT", -40, 0)
    f.castName:SetJustifyH("LEFT")
    f.castName:SetWordWrap(false)
    f.castTime = fontString(f, "CRTFontSmall")
    f.castTime:SetPoint("RIGHT", f.castBg, "RIGHT", -4, 0)
    f.over = fontString(f, "CRTFontNormal")
    f.over:SetPoint("CENTER", f.castBg, "CENTER", -(CAST_H + 4) / 2, 0)
    f.over:SetText(TEXT.over)
    f.over:Hide()
end

local function buildNext(f)
    local head = fontString(f, "CRTFontSmall")
    head:SetPoint("TOPLEFT", f, "TOPLEFT", PAD, -104)
    head:SetText(TEXT.nextUp)
    head:SetTextColor(mocha("latte"))
    -- "Testing: <alert>" on the right of the heading while a Test button's rehearsal plays
    f.testing = fontString(f, "CRTFontSmall")
    f.testing:SetPoint("TOPRIGHT", f, "TOPRIGHT", -PAD, -104)
    f.testing:SetPoint("LEFT", head, "RIGHT", 30, 0)
    f.testing:SetJustifyH("RIGHT")
    f.testing:SetWordWrap(false)
    f.testing:SetTextColor(mocha("caramel"))
    f.nextHead = head
    f.next = {}
    for i = 1, NEXT_N do
        local y = -120 - (i - 1) * NEXT_H
        local line = {}
        line.icon = f:CreateTexture(nil, "ARTWORK")
        line.icon:SetPoint("TOPLEFT", f, "TOPLEFT", PAD, y)
        line.icon:SetSize(16, 16)
        -- behind the name: fills in the cast's color over the last NEXT_COUNT seconds before it
        line.bar = f:CreateTexture(nil, "BORDER")
        line.bar:SetPoint("TOPLEFT", f, "TOPLEFT", PAD + 20, y)
        line.bar:SetHeight(16)
        line.bar:Hide()
        line.name = fontString(f, "CRTFontSmall")
        line.name:SetPoint("LEFT", line.icon, "RIGHT", 6, 0)
        line.name:SetPoint("RIGHT", f, "RIGHT", -PAD - 50, 0)
        line.name:SetJustifyH("LEFT")
        line.name:SetWordWrap(false)
        line.time = fontString(f, "CRTFontSmall")
        line.time:SetPoint("RIGHT", f, "RIGHT", -PAD, 0)
        line.time:SetPoint("TOP", line.icon, "TOP", 0, -2)
        line.time:SetJustifyH("RIGHT")
        f.next[i] = line
    end
end

local function buildStrip(f)
    local strip = CreateFrame("Frame", nil, f)
    strip:SetPoint("TOPLEFT", f, "TOPLEFT", PAD, STRIP_TOP)
    strip:SetSize(INNER, STRIP_H)
    strip:EnableMouse(true)
    -- a phase label entering at the right edge is cut there, not drawn over the window's border
    strip:SetClipsChildren(true)
    local bg = strip:CreateTexture(nil, "BACKGROUND")
    bg:SetAllPoints()
    bg:SetColorTexture(0, 0, 0, 0.35)
    strip.marks, strip.phaseLines, strip.phaseLabels, strip.ticks, strip.tickLabels = {}, {}, {}, {}, {}
    strip.nowLine = strip:CreateTexture(nil, "OVERLAY")
    strip.nowLine:SetPoint("TOPLEFT", strip, "TOPLEFT", math.floor(INNER / 3) - 1, 0)
    strip.nowLine:SetSize(2, STRIP_H)
    strip.nowLine:SetColorTexture(mocha("cream", 0.9))
    -- the time over the now line, outside the strip so it isn't clipped
    strip.nowText = fontString(f, "CRTFontSmall")
    strip.nowText:SetPoint("BOTTOM", strip, "TOPLEFT", math.floor(INNER / 3), 2)
    -- A press with either button starts a drag; one that never moves DRAG_MIN pixels is a click,
    -- which jumps there with the left button and does nothing with the right.
    local function cursorX(s)
        return GetCursorPosition() / (s:GetEffectiveScale() or 1) - (s:GetLeft() or 0)
    end
    strip:SetScript("OnMouseDown", function(s, mouse)
        if mouse ~= "LeftButton" and mouse ~= "RightButton" then
            return
        end
        RehearsalWindow:DragStart(cursorX(s))
        s:SetScript("OnUpdate", function(self)
            RehearsalWindow:DragTo(cursorX(self))
        end)
    end)
    strip:SetScript("OnMouseUp", function(s, mouse)
        s:SetScript("OnUpdate", nil)
        RehearsalWindow:DragEnd(cursorX(s), not mouse or mouse == "LeftButton")
    end)
    f.strip = strip
    -- the (?) sits beside the Next up heading, outside the strip, so no phase label slides under it
    local help = CRT.UI.Help(f, "Strip", TEXT.stripHelp)
    help:SetPoint("LEFT", f.nextHead, "RIGHT", 2, 0)
end

-- Preview as: Me, Everyone, then the players CRT.AlertRoster gives (the selected Raid Groups page's,
-- or the group's when that page is empty), read each time the menu opens. A saved name that is not
-- on the roster now still shows at the end, so the choice is never lost or shown blank.
local function asOptions()
    local list = { { key = "me", label = TEXT.me }, { key = "*", label = TEXT.everyone } }
    local seen = {}
    local Roster = CRT.AlertRoster
    for _, p in ipairs(Roster and Roster:Players() or {}) do
        if type(p.name) == "string" and not seen[p.name] then
            seen[p.name] = true
            list[#list + 1] = { key = p.name, label = p.name }
        end
    end
    local as = saved().as
    if type(as) == "string" and as ~= "*" and not seen[as] then
        list[#list + 1] = { key = as, label = as }
    end
    return list
end

local function buildControls(f)
    local UI = CRT.UI
    f.play = button(f, TEXT.play, 70)
    f.play:SetPoint("TOPLEFT", f, "TOPLEFT", PAD, -270)
    f.play:SetScript("OnClick", function()
        RehearsalWindow:TogglePlay()
    end)
    f.restart = button(f, TEXT.restart, 70)
    f.restart:SetPoint("LEFT", f.play, "RIGHT", 6, 0)
    f.restart:SetScript("OnClick", function()
        RehearsalWindow:Restart()
    end)
    f.clockText = fontString(f, "CRTFontHighlight")
    f.clockText:SetPoint("RIGHT", f, "RIGHT", -PAD, 0)
    f.clockText:SetPoint("TOP", f.play, "TOP", 0, -3)
    f.clockText:SetJustifyH("RIGHT")

    local speedOptions = {}
    for _, v in ipairs(SPEEDS) do
        speedOptions[#speedOptions + 1] = { key = v, label = v .. "x" }
    end
    f.speed = UI.Dropdown(f, TEXT.speed, {
        options = speedOptions,
        labelWidth = 40,
        width = 64,
        get = savedSpeed,
        set = function(key)
            RehearsalWindow:SetSpeed(key)
        end,
    })
    f.speed:SetPoint("TOPLEFT", f, "TOPLEFT", PAD, -296)
    f.as = UI.Dropdown(f, TEXT.as, {
        options = asOptions,
        labelWidth = 70,
        width = 110,
        get = function()
            return saved().as or "me"
        end,
        set = function(key)
            RehearsalWindow:SetAs(key ~= "me" and key or nil)
        end,
    })
    f.as:SetPoint("LEFT", f.speed, "RIGHT", 10, 0)
    local help = UI.Help(f, TEXT.as, TEXT.asHelp)
    help:SetPoint("LEFT", f.as, "RIGHT", 0, 0)
end

-- The window, made once.
function RehearsalWindow:Frame()
    if self.frame then
        return self.frame
    end
    local UI = CRT.UI
    local f = CreateFrame("Frame", "CowfeeRaidToolsRehearsalWindow", UIParent, "BasicFrameTemplateWithInset")
    UI:StyleWindow(f)
    f:SetSize(W, H)
    UI:RegisterLayer("popups", f)
    f:SetClampedToScreen(true)
    f:SetMovable(true)
    f:EnableMouse(true)
    f:RegisterForDrag("LeftButton")
    f:SetScript("OnDragStart", function(s)
        s:StartMoving(true)
    end)
    f:SetScript("OnDragStop", function(s)
        s:StopMovingOrSizing()
        savePosition(s)
    end)
    -- closing (the X, Escape or Close) stops the rehearsal. OnHide also fires when the whole UI hides
    -- (Alt+Z, a cinematic) with the window still shown; that is not a close.
    f:SetScript("OnHide", function(s)
        if s:IsShown() then
            return
        end
        self:Closed()
    end)
    -- onTick runs every frame while the window is open, paused too, so the engine sees a pause at once
    f:SetScript("OnUpdate", function()
        -- a Test's stopAt: the clock pauses there once (the run goes on), and Play carries on past it
        local stop, clock = self.stopAt, self.clock
        if stop and clock and clock:Playing() and clock:Now() >= stop then
            self.stopAt = nil
            clock:Seek(stop)
            self:Pause()
        end
        if self.playing then
            self:Redraw()
        end
        hook("onTick", self:Now())
    end)
    tinsert(UISpecialFrames, "CowfeeRaidToolsRehearsalWindow")
    f:Hide()
    buildBoss(f)
    buildCast(f)
    buildNext(f)
    buildStrip(f)
    buildControls(f)
    self.frame = f
    return f
end

-- Opens the window on source = { base, encounterID, group, order, bossName, difficultyName }: the
-- reference or pull the Review tab shows, laid out the way the Timeline lays it out, paused at 0:00.
-- Opened again while open, the old fight ends first (its rehearsal run stops), so nothing keeps
-- playing against the new one.
function RehearsalWindow:Open(source)
    source = source or {}
    local f = self:Frame()
    if self.open then
        self:Closed()
    end
    if self.clock then
        self.clock:Pause()
    end
    local Journal = CRT.TimelineJournal
    local rows = Journal and Journal:Rows(source.encounterID) or {}
    local lanes, _, extra = CRT.TimelineLanes.Build(source.base, rows, CRT.Timeline:Settings(), source.encounterID, nil, source.group, source.order)
    -- your labels and ignored mechanics, as the timeline shows them
    if CRT.Timeline.ApplyAbilities then
        lanes = CRT.Timeline:ApplyAbilities(lanes, source.encounterID, rows)
    end
    if CRT.Timeline.WithoutHidden then
        lanes = CRT.Timeline:WithoutHidden(lanes, source.encounterID)
    end
    lanes = CRT.Timeline:WithoutIgnored(lanes, source.encounterID)
    self.source = source
    self.stopAt = nil
    self.model = Rehearsal.Build(lanes, extra)
    self.clock = Rehearsal.NewClock()
    self.clock:SetLength(self.model.length)
    self.clock:SetSpeed(savedSpeed())
    local boss = source.bossName or TEXT.boss
    CRT.UI.SetFrameTitle(f, TEXT.title .. boss)
    f.bossName:SetText(boss)
    f.difficulty:SetText(source.difficultyName or "")
    f.testing:SetText(source.testing and (TEXT.testing .. source.testing) or "")
    f.speed.refresh()
    f.as.refresh()
    applyPosition(f)
    self.open = true
    f:Show()
    self:Redraw()
end

-- The fight ends: the clock stops and onClose is told, once per Open.
function RehearsalWindow:Closed()
    if not self.open then
        return
    end
    self.open = false
    if self.clock then
        self.clock:Pause()
    end
    self.playing = false
    hook("onClose")
end

-- Hiding a window the hidden UI already hides fires no OnHide, so the close is finished here too.
function RehearsalWindow:Close()
    if self.frame and self.frame:IsShown() then
        self.frame:Hide()
    end
    self:Closed()
end

function RehearsalWindow:IsOpen()
    return self.frame and self.frame:IsShown() and true or false
end

-- What the window shows now: the time under a drag while one scrubs, else the clock's. The Timeline's
-- playhead follows this, so it moves with the strip.
function RehearsalWindow:ShownTime()
    local d = self.drag
    if d and d.moved then
        return d.at
    end
    return self.clock and self.clock:Now() or 0
end

function RehearsalWindow:Playing()
    return self.clock and self.clock:Playing() or false
end

-- The source it was opened on (see Open), or nil.
function RehearsalWindow:Source()
    return self.open and self.source or nil
end

-- What the alerts engine reads: the clock (fight seconds), the speed and Preview as.
function RehearsalWindow:Now()
    return self.clock and self.clock:Now() or 0
end

function RehearsalWindow:Speed()
    return self.clock and self.clock:Speed() or savedSpeed()
end

function RehearsalWindow:As()
    return saved().as
end

function RehearsalWindow:Play()
    -- nothing to play (no casts and no length) would run the clock forever
    if not self.clock or (self.model.length or 0) <= 0 then
        return
    end
    self.clock:Play()
    if self.clock:Playing() then
        hook("onPlay")
    end
    self:Redraw()
end

function RehearsalWindow:Pause()
    if not self.clock then
        return
    end
    local was = self.clock:Playing()
    self.clock:Pause()
    if was then
        hook("onPause")
    end
    self:Redraw()
end

function RehearsalWindow:TogglePlay()
    if self.clock and self.clock:Playing() then
        self:Pause()
    else
        self:Play()
    end
end

-- Back to 0:00, paused.
function RehearsalWindow:Restart()
    if not self.clock then
        return
    end
    local was = self.clock:Playing()
    self.stopAt = nil
    self.clock:Seek(0)
    self.clock:Pause()
    if was then
        hook("onPause")
    end
    hook("onSeek", 0)
    self:Redraw()
end

function RehearsalWindow:Seek(t)
    if not self.clock then
        return
    end
    self.stopAt = nil
    self.clock:Seek(t)
    hook("onSeek", self.clock:Now())
    self:Redraw()
end

-- The time under x pixels from the strip's left edge.
function RehearsalWindow:StripTime(x)
    local span = Rehearsal.STRIP_SPAN
    return self:Now() - span / 3 + (x or 0) / INNER * span
end

function RehearsalWindow:SeekStrip(x)
    self:Seek(self:StripTime(x))
end

-- Scrubbing the strip. While a drag moves, only the window shows the time under it (drag.at): the
-- clock stands still, so no alert or phase fires on the way. On release the clock jumps there once
-- (Seek, which restarts the alerts run there) and plays on if it was playing. x is from the strip's
-- left edge; dragging left goes forward, as if pulling the fight along.
function RehearsalWindow:DragStart(x)
    if not self.clock then
        return
    end
    local playing = self.clock:Playing()
    if playing then
        self:Pause()
    end
    local now = self.clock:Now()
    self.drag = { x = x, t = now, at = now, resume = playing, moved = false }
end

function RehearsalWindow:DragTo(x)
    local d = self.drag
    if not d then
        return
    end
    local dx = x - d.x
    if not d.moved and math.abs(dx) < DRAG_MIN then
        return
    end
    d.moved = true
    local t = d.t - dx / INNER * Rehearsal.STRIP_SPAN
    d.at = math.max(0, math.min(self.model.length or 0, t))
    self:Redraw()
end

-- click: the press was the left button, so one that didn't move jumps to the time under it.
function RehearsalWindow:DragEnd(x, click)
    local d = self.drag
    self.drag = nil
    if d and d.moved then
        self:Seek(d.at)
    elseif click then
        self:SeekStrip(x)
    end
    if d and d.resume then
        self:Play()
    elseif d then
        self:Redraw()
    end
end

function RehearsalWindow:SetSpeed(s)
    saved().speed = s
    if self.clock then
        self.clock:SetSpeed(s)
    end
    if self.frame then
        self.frame.speed.refresh()
    end
end

function RehearsalWindow:SetAs(as)
    saved().as = as
    if self.frame then
        self.frame.as.refresh()
    end
    hook("onAs", as)
end

-- The strip at now: the casts within it as ticks in their colors, and the phase lines with labels.
function RehearsalWindow:DrawStrip(now)
    local strip, model = self.frame.strip, self.model
    local span = Rehearsal.STRIP_SPAN
    local left = now - span / 3
    local n = 0
    for _, c in ipairs(model.casts) do
        if c.t > left + span then
            break
        end
        if c.t >= left then
            n = n + 1
            local tex = pooled(strip.marks, n, strip, "ARTWORK")
            local col = castColor(c)
            tex:SetColorTexture(col[1], col[2], col[3], 1)
            tex:ClearAllPoints()
            tex:SetPoint("TOPLEFT", strip, "TOPLEFT", (c.t - left) / span * INNER - MARK_W / 2, -STRIP_LABEL_H - 4)
            tex:SetSize(MARK_W, STRIP_H - STRIP_LABEL_H - STRIP_TICK_H - 8)
            tex.t = c.t
            tex:Show()
        end
    end
    for i = n + 1, #strip.marks do
        strip.marks[i]:Hide()
    end
    strip.shownMarks = n
    local p = 0
    for _, ph in ipairs(model.phases) do
        if ph.t >= left and ph.t <= left + span then
            p = p + 1
            local x = (ph.t - left) / span * INNER
            local line = pooled(strip.phaseLines, p, strip, "BORDER")
            line:SetColorTexture(mocha("caramel", 0.7))
            line:ClearAllPoints()
            line:SetPoint("TOPLEFT", strip, "TOPLEFT", x, 0)
            line:SetSize(1, STRIP_H)
            line.t = ph.t
            line:Show()
            local label = pooledLabel(strip.phaseLabels, p, strip)
            label:ClearAllPoints()
            label:SetPoint("TOPLEFT", strip, "TOPLEFT", x + 3, -1)
            label:SetText(ph.title or ph.label or "") -- the stage's name when it has one
            label:SetTextColor(mocha("latte"))
            label:Show()
        end
    end
    for i = p + 1, #strip.phaseLines do
        strip.phaseLines[i]:Hide()
        strip.phaseLabels[i]:Hide()
    end
    strip.shownPhases = p
    -- a faint line every TICK seconds, its time along the bottom
    local k = 0
    for t = math.max(0, math.ceil(left / TICK)) * TICK, left + span, TICK do
        k = k + 1
        local x = (t - left) / span * INNER
        local line = pooled(strip.ticks, k, strip, "BORDER")
        line:SetColorTexture(mocha("cream", 0.15))
        line:ClearAllPoints()
        line:SetPoint("TOPLEFT", strip, "TOPLEFT", x, -STRIP_LABEL_H)
        line:SetSize(1, STRIP_H - STRIP_LABEL_H)
        line.t = t
        line:Show()
        local label = pooledLabel(strip.tickLabels, k, strip)
        label:ClearAllPoints()
        label:SetPoint("BOTTOMLEFT", strip, "TOPLEFT", x + 3, -STRIP_H + 1)
        label:SetText(fmt(t))
        label:SetTextColor(mocha("latte"))
        label:Show()
    end
    for i = k + 1, #strip.ticks do
        strip.ticks[i]:Hide()
        strip.tickLabels[i]:Hide()
    end
    strip.shownTicks = k
    strip.nowText:SetText(fmt(now))
end

-- Everything from the clock.
function RehearsalWindow:Redraw()
    local f, model, clock = self.frame, self.model, self.clock
    if not (f and model and clock) then
        return
    end
    -- while a drag scrubs, the time under it; the clock waits for the release
    local now = self.drag and self.drag.moved and self.drag.at or clock:Now()
    local length = model.length or 0
    local playing = clock:Playing()

    -- the boss panel: an even drain from 100% at the pull to 0% at the length
    local frac = length > 0 and math.max(0, math.min(1, 1 - now / length)) or 1
    f.healthFill:SetWidth(math.max(1, INNER * frac))
    f.healthFill:SetShown(frac > 0)
    f.healthText:SetText(string.format("%d%%", math.floor(frac * 100 + 0.5)))

    -- the cast bar, or "Rehearsal over" at the length
    local over = length > 0 and now >= length
    f.over:SetShown(over)
    local shown = not over and Rehearsal.CastAt(model, now)
    if shown then
        local c = shown.cast
        local col = castColor(c)
        f.castIcon:SetTexture(c.icon or ICON)
        f.castIcon:Show()
        f.castName:SetText(c.name or "")
        f.castTime:SetText(string.format("%.1f", shown.remaining))
        f.castFill:SetColorTexture(col[1], col[2], col[3], 0.85)
        f.castFill:SetWidth(math.max(1, CAST_W * shown.progress))
        f.castFill:Show()
    else
        f.castIcon:Hide()
        f.castName:SetText("")
        f.castTime:SetText("")
        f.castFill:Hide()
    end

    -- Next up, without the cast the cast bar shows
    local list = Rehearsal.NextUp(model, now, NEXT_N, shown and shown.cast)
    local fillSpan = NEXT_COUNT - Rehearsal.CAST
    for i, line in ipairs(f.next) do
        local c = list[i]
        if c then
            line.icon:SetTexture(c.icon or ICON)
            line.icon:Show()
            line.name:SetText(c.name or "")
            -- counts down to the cast: m:ss, then tenths with a filling bar over the last NEXT_COUNT seconds
            local left = math.max(0, c.t - now)
            if left < NEXT_COUNT then
                local col = castColor(c)
                line.time:SetText(string.format("%.1f", left))
                line.bar:SetColorTexture(col[1], col[2], col[3], 0.45)
                local fill = math.max(0, math.min(1, (NEXT_COUNT - left) / fillSpan))
                line.bar:SetWidth(math.max(1, NEXT_BAR_W * fill))
                line.bar:Show()
            else
                line.time:SetText(fmt(left))
                line.bar:Hide()
            end
        else
            line.icon:Hide()
            line.name:SetText("")
            line.time:SetText("")
            line.bar:Hide()
        end
    end

    self:DrawStrip(now)

    f.play:SetText(playing and TEXT.pause or TEXT.play)
    f.clockText:SetText(fmt(now) .. " / " .. fmt(length))
    self.playing = playing
end

-- The alerts engine ------------------------------------------------------------------------------
-- RehearsalRun ties the window to the alerts engine's rehearsal run (Alerts/Engine.lua):
--   Play starts a run on the window's clock, Alerts:Start(encounterID, difficultyName, "rehearsal",
--   { clock, speed, as }), then starts every phase whose line is at or before the clock. Played
--   again after a pause, the run is still going and the clock simply runs on.
--   Pause leaves the run going, with the clock standing still.
--   A jump, Restart or a new Preview as stops the run quietly and starts it again at the clock's
--   time (once a run was started; before the first Play there is none to restart).
--   While it plays, each phase line the clock passes starts its phase at that line's time. The
--   phase is the number in the line's label (Reminders.PhaseNumber); a line with no number, and
--   phase 1, which the engine starts at the pull, start nothing.
--   Closing the window stops a rehearsal run, never a real one, and Play never replaces a real run.
--   Combat or a boss encounter starting closes the window. Blocked() says why Rehearse can't open now
--   (combat, a boss encounter, or the alerts running a real pull or a test), and OnChange(fn) is told
--   when combat or an encounter starts or ends, so the Rehearse button can grey out.

local Run = { started = false, last = nil, listeners = {} }
CRT.TimelineRehearsalRun = Run

-- Set by the events: InCombatLockdown() is still false inside PLAYER_REGEN_DISABLED, and the order of
-- this file's ENCOUNTER_START against the game's own must not matter.
local inCombat, inEncounter = false, false

-- A run that is not a rehearsal (an encounter, a test) is going.
local function realRun(Alerts)
    return Alerts.running and not Alerts:IsRehearsal()
end

-- Starts the phase of every line after `from` (nil: from the pull) up to `to`, in time order.
local function startPhases(Alerts, from, to)
    local Reminders = CRT.AlertReminders
    local model = RehearsalWindow.model
    for _, p in ipairs(model and model.phases or {}) do
        if p.t <= to and (from == nil or p.t > from) then
            local ph = Reminders and Reminders.PhaseNumber(p.label)
            if ph and ph ~= 1 then
                Alerts:StartPhase(ph, "rehearsal", Alerts:TimeAt(p.t))
            end
        end
    end
    Run.last = to
end

local function startRun(Alerts)
    local W = RehearsalWindow
    local source = W.source or {}
    local opts = {
        clock = function()
            return W:Now()
        end,
        speed = function()
            return W:Speed()
        end,
        as = W:As(),
    }
    -- a Test button's extra opts (the tested alert as it stands, what it replaces) ride on every start
    for k, v in pairs(source.alerts or {}) do
        if opts[k] == nil and k ~= "as" then
            opts[k] = v
        end
    end
    Alerts:Start(source.encounterID, source.difficultyName, "rehearsal", opts)
    Run.started = true
    startPhases(Alerts, nil, W:Now())
end

function Run.Play()
    local Alerts = CRT.Alerts
    if not Alerts or Alerts:IsRehearsal() or realRun(Alerts) then
        return
    end
    startRun(Alerts)
end

-- A jump, Restart or a new Preview as: the run starts again at the clock's time.
function Run.Restart()
    local Alerts = CRT.Alerts
    if not Alerts or realRun(Alerts) or not (Run.started or Alerts:IsRehearsal()) then
        return
    end
    Alerts:Stop(true)
    startRun(Alerts)
end

-- Each frame while the window is open: the engine's RehearsalTick (pause and speed reach the icon
-- swipes within a frame), then the phase lines the clock has passed.
function Run.Tick(now)
    local Alerts = CRT.Alerts
    if not (Alerts and Alerts:IsRehearsal()) then
        return
    end
    if Alerts.RehearsalTick then
        Alerts:RehearsalTick()
    end
    if Run.last and now > Run.last then
        startPhases(Alerts, Run.last, now)
    end
end

function Run.Close()
    local Alerts = CRT.Alerts
    if Alerts and Alerts:IsRehearsal() then
        Alerts:Stop()
    end
    Run.started, Run.last = false, nil
end

-- Why Rehearse can't open now, or nil when it can.
function Run.Blocked()
    if inCombat or (InCombatLockdown and InCombatLockdown()) then
        return TEXT.inCombat
    end
    if inEncounter or (IsEncounterInProgress and IsEncounterInProgress()) then
        return TEXT.inEncounter
    end
    local Alerts = CRT.Alerts
    if Alerts and realRun(Alerts) then
        return TEXT.running
    end
    return nil
end

function Run.OnChange(fn)
    Run.listeners[#Run.listeners + 1] = fn
end

-- For the alerts' Test buttons: opens the rehearsal of a boss on a difficulty (what the Review tab
-- would show for it: its reference for that difficulty group, else its newest pull), seeks to fight
-- second t (0 at the earliest) and plays, pausing once at fight second opts.stopAt when given (a jump,
-- Restart or a plain Rehearse clears it). opts.testing labels the window "Testing: <testing>";
-- opts.alerts is copied into Alerts:Start's opts on every start (a jump or Restart keeps it). It
-- replaces whatever the window had open, and a quick test run (never a real pull). True, or false and
-- the reason to print.
function RehearsalWindow:OpenAt(encounterID, difficultyName, t, opts)
    opts = opts or {}
    local why = Run.Blocked()
    local Alerts = CRT.Alerts
    if why == TEXT.running and Alerts.run and Alerts.run.reason == "test" then
        Alerts:Stop(true)
        why = Run.Blocked()
    end
    if why then
        return false, why
    end
    -- the group as the engine's order shift picks it; no difficulty from the caller keeps the source's
    local group = CRT.Timeline:GroupFor(difficultyName)
    local source = CRT.Timeline.RehearsalSourceFor and CRT.Timeline:RehearsalSourceFor(encounterID, group)
    if not source then
        return false, TEXT.noSource
    end
    source.encounterID, source.difficultyName = encounterID, difficultyName or source.difficultyName
    source.testing, source.alerts = opts.testing, opts.alerts
    self:Open(source)
    self:Seek(math.max(0, tonumber(t) or 0))
    self.stopAt = tonumber(opts.stopAt)
    self:Play()
    return true
end

-- Sets the window's hooks to the engine (done once here; the harness sets them again).
function Run.Install()
    RehearsalWindow.onPlay = Run.Play
    RehearsalWindow.onSeek = Run.Restart
    RehearsalWindow.onAs = Run.Restart
    RehearsalWindow.onTick = Run.Tick
    RehearsalWindow.onClose = Run.Close
end
Run.Install()

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_REGEN_DISABLED")
events:RegisterEvent("PLAYER_REGEN_ENABLED")
events:RegisterEvent("ENCOUNTER_START")
events:RegisterEvent("ENCOUNTER_END")
events:RegisterEvent("PLAYER_ENTERING_WORLD")
events:SetScript("OnEvent", function(_, event)
    if event == "PLAYER_REGEN_DISABLED" then
        inCombat = true
    elseif event == "PLAYER_REGEN_ENABLED" then
        inCombat = false
    elseif event == "ENCOUNTER_START" then
        inEncounter = true
    elseif event == "ENCOUNTER_END" then
        inEncounter = false
    elseif event == "PLAYER_ENTERING_WORLD" then
        -- a missed ENCOUNTER_END or REGEN_ENABLED must not leave Rehearse blocked
        inCombat, inEncounter = false, false
    end
    if event == "PLAYER_REGEN_DISABLED" or event == "ENCOUNTER_START" then
        -- a real fight wins: the window closes, which stops only a rehearsal run
        RehearsalWindow:Close()
        Run.Close()
    end
    for _, fn in ipairs(Run.listeners) do
        fn()
    end
end)
