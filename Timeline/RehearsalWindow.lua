local ADDON, CRT = ...

-- Timeline Rehearsal: the window that plays a boss fight out on the Rehearsal clock (Rehearsal.lua).
-- A separate pop-up, movable by its title, that stays open while the Timeline is closed. Top to
-- bottom: the title "Rehearsal · <boss>" with its close button; the boss panel (the name, a health
-- bar draining evenly from 100% at the pull to 0% at the fight's length, and the percentage); the
-- cast bar (the cast showing now, its icon and name, filling over Rehearsal.CAST seconds); Next up
-- (the next 3 casts with their times); the strip (STRIP_SPAN seconds of the fight's casts in their
-- type colors scrolling under a fixed "now" line a third of the way across, with the phase lines and
-- their labels; a click jumps there); and the controls (Play/Pause, Restart, Speed, Preview as and
-- the clock). An OnUpdate redraws from the clock while it plays. At the fight's length the clock
-- stops and the window says "Rehearsal over".
-- The window only drives its own clock. The alerts engine is hooked on from outside: set
-- RehearsalWindow.onPlay(), onPause(), onSeek(t), onClose() and onAs(as) and they are called when
-- that happens. timeline.rehearsal keeps the position, the speed and Preview as (nil is you, "*"
-- everyone); the clock and the source aren't saved.

local Rehearsal = CRT.TimelineRehearsal
local RehearsalWindow = {}
CRT.TimelineRehearsalWindow = RehearsalWindow

local W, PAD = 360, 12
local INNER = W - PAD * 2
local H = 312
local BAR_H = 16
local CAST_H = 20
local CAST_W = INNER - CAST_H - 4
local NEXT_N = 3
local NEXT_H = 18
local STRIP_H = 56
local STRIP_LABEL_H = 14 -- the phase labels' row at the top of the strip
local MARK_W = 3
local ICON = "Interface\\Icons\\INV_Misc_QuestionMark"
local SPEEDS = { 1, 2, 4 }

RehearsalWindow.STRIP_W = INNER
RehearsalWindow.BAR_W = INNER
RehearsalWindow.CAST_W = CAST_W

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
    asHelp = "Whose alerts the rehearsal fires. Me: exactly yours. Everyone: every line, with who it's for.",
    stripHelp = "The next stretch of the fight in the rows' type colors, the line being now. Click it to jump there.",
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
    f.next = {}
    for i = 1, NEXT_N do
        local y = -120 - (i - 1) * NEXT_H
        local line = {}
        line.icon = f:CreateTexture(nil, "ARTWORK")
        line.icon:SetPoint("TOPLEFT", f, "TOPLEFT", PAD, y)
        line.icon:SetSize(16, 16)
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
    strip:SetPoint("TOPLEFT", f, "TOPLEFT", PAD, -178)
    strip:SetSize(INNER, STRIP_H)
    strip:EnableMouse(true)
    local bg = strip:CreateTexture(nil, "BACKGROUND")
    bg:SetAllPoints()
    bg:SetColorTexture(0, 0, 0, 0.35)
    strip.marks, strip.phaseLines, strip.phaseLabels = {}, {}, {}
    strip.nowLine = strip:CreateTexture(nil, "OVERLAY")
    strip.nowLine:SetPoint("TOPLEFT", strip, "TOPLEFT", math.floor(INNER / 3) - 1, 0)
    strip.nowLine:SetSize(2, STRIP_H)
    strip.nowLine:SetColorTexture(mocha("cream", 0.9))
    strip:SetScript("OnMouseUp", function(s, mouse)
        if mouse and mouse ~= "LeftButton" then
            return
        end
        local x = GetCursorPosition() / (s:GetEffectiveScale() or 1) - (s:GetLeft() or 0)
        RehearsalWindow:SeekStrip(x)
    end)
    f.strip = strip
    -- the (?) sits in the strip's top right corner, over its label row, so it stays clear of Next up
    local help = CRT.UI.Help(strip, "Strip", TEXT.stripHelp)
    help:SetPoint("TOPRIGHT", strip, "TOPRIGHT", 0, 0)
end

local function buildControls(f)
    local UI = CRT.UI
    f.play = button(f, TEXT.play, 70)
    f.play:SetPoint("TOPLEFT", f, "TOPLEFT", PAD, -244)
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
    f.speed:SetPoint("TOPLEFT", f, "TOPLEFT", PAD, -270)
    -- Preview as holds you and Everyone; the players of the raid groups join it with the alerts engine.
    f.as = UI.Dropdown(f, TEXT.as, {
        options = { { key = "me", label = TEXT.me }, { key = "*", label = TEXT.everyone } },
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
    -- closing (the X, Escape or Close) stops the rehearsal
    f:SetScript("OnHide", function()
        if self.clock then
            self.clock:Pause()
        end
        self.playing = false
        hook("onClose")
    end)
    f:SetScript("OnUpdate", function()
        if self.playing then
            self:Redraw()
        end
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
function RehearsalWindow:Open(source)
    source = source or {}
    local f = self:Frame()
    if self.clock then
        self.clock:Pause()
    end
    local Journal = CRT.TimelineJournal
    local rows = Journal and Journal:Rows(source.encounterID) or {}
    local lanes, _, extra = CRT.TimelineLanes.Build(source.base, rows, CRT.Timeline:Settings(), source.encounterID, nil, source.group, source.order)
    self.source = source
    self.model = Rehearsal.Build(lanes, extra)
    self.clock = Rehearsal.NewClock()
    self.clock:SetLength(self.model.length)
    self.clock:SetSpeed(savedSpeed())
    local boss = source.bossName or TEXT.boss
    CRT.UI.SetFrameTitle(f, TEXT.title .. boss)
    f.bossName:SetText(boss)
    f.difficulty:SetText(source.difficultyName or "")
    f.speed.refresh()
    f.as.refresh()
    applyPosition(f)
    f:Show()
    self:Redraw()
end

function RehearsalWindow:Close()
    if self.frame and self.frame:IsShown() then
        self.frame:Hide()
    end
end

function RehearsalWindow:IsOpen()
    return self.frame and self.frame:IsShown() and true or false
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
            tex:SetSize(MARK_W, STRIP_H - STRIP_LABEL_H - 8)
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
            label:SetText(ph.label or "")
            label:SetTextColor(mocha("latte"))
            label:Show()
        end
    end
    for i = p + 1, #strip.phaseLines do
        strip.phaseLines[i]:Hide()
        strip.phaseLabels[i]:Hide()
    end
    strip.shownPhases = p
end

-- Everything from the clock.
function RehearsalWindow:Redraw()
    local f, model, clock = self.frame, self.model, self.clock
    if not (f and model and clock) then
        return
    end
    local now = clock:Now()
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

    -- Next up
    local list = Rehearsal.NextUp(model, now, NEXT_N)
    for i, line in ipairs(f.next) do
        local c = list[i]
        if c then
            line.icon:SetTexture(c.icon or ICON)
            line.icon:Show()
            line.name:SetText(c.name or "")
            line.time:SetText(fmt(c.t))
        else
            line.icon:Hide()
            line.name:SetText("")
            line.time:SetText("")
        end
    end

    self:DrawStrip(now)

    f.play:SetText(playing and TEXT.pause or TEXT.play)
    f.clockText:SetText(fmt(now) .. " / " .. fmt(length))
    self.playing = playing
end
