local ADDON, CRT = ...

-- Shared settings controls in the style of the game's Edit Mode panels: a label on the left and the
-- control on its right, in a row 32 pixels high. They use the same game templates as
-- Blizzard_EditMode's EditModeSettingDropdownTemplate and EditModeSettingSliderTemplate:
--   UI.Dropdown  WowStyle1DropdownTemplate, a dropdown with a radio list of choices
--   UI.Slider    MinimalSliderWithSteppersTemplate, a bar with < and > steppers and the value on
--                its right, in the Classic look; in Modern, an accent track and a knob that
--                shows the value and takes a typed number
-- A setting with a few fixed choices is always a dropdown, never a button that cycles through them.

local UI = CRT.UI

local ROW_H = 32
local LABEL_W = 140
local GAP = 5
local VALUE_W = 44 -- room for the slider's value, which the template draws to the right of the bar

-- The row and its label. The label's own color is kept, so greying out can put it back.
local function makeRow(parent, text, labelWidth)
    local row = CreateFrame("Frame", nil, parent)
    row:SetHeight(ROW_H)
    row.Label = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    row.Label:SetPoint("LEFT")
    row.Label:SetWidth(labelWidth or LABEL_W)
    row.Label:SetJustifyH("LEFT")
    row.Label:SetWordWrap(false)
    row.Label:SetText(text)
    row.labelColor = { row.Label:GetTextColor() }
    return row
end

local function greyLabel(row, on)
    if on then
        row.Label:SetTextColor(row.labelColor[1], row.labelColor[2], row.labelColor[3])
    else
        row.Label:SetTextColor(0.5, 0.5, 0.5)
    end
end

-- A dropdown. opts:
--   options    { { key, label }, ... }, or a function returning that list when the menu opens. An
--              option with disabled = true is shown greyed out and can't be picked, and one with
--              title = true is a heading in the open list (such as a raid over its bosses). An
--              option's tooltip, when it has one, shows while the mouse is over it in the open list.
--   get()      the selected key
--   set(key)   called when a choice is picked
--   width, labelWidth, enabledIf() (greys the row out while it returns false)
--   maxHeight  optional: the open menu scrolls past this many pixels, for a long list
--   decorate(button, option)  optional: adds to each item in the open menu, such as a Play button.
--                             It may return the item's width and height. Anything it attaches with
--                             button:AttachFrame or AttachFontString is removed when the menu closes.
-- Returns the row, with row.refresh() to call when the setting may have changed.
function UI.Dropdown(parent, text, opts)
    local labelWidth, width = opts.labelWidth or LABEL_W, opts.width or 200
    local row = makeRow(parent, text, labelWidth)
    row:SetWidth(labelWidth + GAP + width)

    local dropdown = CreateFrame("DropdownButton", nil, row, "WowStyle1DropdownTemplate")
    dropdown:SetWidth(width)
    dropdown:SetPoint("LEFT", row.Label, "RIGHT", GAP, 0)
    -- The template's text (GameFontHighlight), in the addon's font at the same size.
    if type(dropdown.Text) == "table" then
        dropdown.Text:SetFontObject(CRTFontStandardHighlight)
    end
    dropdown:SetupMenu(function(_, root)
        if UI.MenuOnTop then
            UI.MenuOnTop(root) -- submenus too (UI/Window.lua)
        end
        if opts.maxHeight and root.SetScrollMode then
            root:SetScrollMode(opts.maxHeight)
        end
        local list = type(opts.options) == "function" and opts.options() or opts.options
        for _, option in ipairs(list) do
            if option.title then
                root:CreateTitle(option.label)
            else
                local radio = root:CreateRadio(option.label, function(key)
                    return opts.get() == key
                end, function(key)
                    opts.set(key)
                end, option.key)
                if option.disabled and radio and radio.SetEnabled then
                    radio:SetEnabled(false)
                end
                if option.tooltip and radio and radio.SetTooltip then
                    radio:SetTooltip(function(tooltip)
                        GameTooltip_SetTitle(tooltip, option.label)
                        GameTooltip_AddNormalLine(tooltip, option.tooltip)
                    end)
                end
                if opts.decorate then
                    radio:AddInitializer(function(button)
                        return opts.decorate(button, option)
                    end)
                end
            end
        end
    end)
    row.Dropdown = dropdown
    UI:SkinDropdown(dropdown)
    -- The game opens a dropdown's list on the FULLSCREEN_DIALOG layer, the same as the alert editor,
    -- which raises itself over it. So the open list goes up to the TOOLTIP layer, above every window.
    if dropdown.RegisterCallback and DropdownButtonMixin and DropdownButtonMixin.Event then
        -- A callback with an owner is called with the owner first, then the event's own arguments.
        dropdown:RegisterCallback(DropdownButtonMixin.Event.OnMenuOpen, function(_, button)
            local menu = (button or dropdown).menu
            if menu and menu.SetFrameStrata then
                pcall(menu.SetFrameStrata, menu, "TOOLTIP")
                pcall(menu.Raise, menu)
            end
        end, row)
    end

    row.refresh = function()
        -- Rebuilds the menu, which also updates the text shown on the closed dropdown.
        dropdown:GenerateMenu()
        if opts.enabledIf then
            local on = opts.enabledIf() and true or false
            dropdown:SetEnabled(on)
            greyLabel(row, on)
        end
    end
    return row
end

-- The sound dropdown every page uses: the sound engine's choices (Sound/Engine.lua), each with a Play
-- button in the open menu. opts as UI.Dropdown, plus none (a label for a "no sound" choice, key "none")
-- and filesOnly; options defaults to the engine's list. opts.help true adds the (?) on where your own
-- files go, as row.help, right of the dropdown (or of its Play button). opts.playButton true adds a small Play button after the
-- closed dropdown, as row.play, that plays the chosen sound once (nothing else: no alert, bar or speech).
UI.SOUND_PLAY_W, UI.SOUND_PLAY_GAP = 44, 6
UI.SOUND_HELP = "Game sounds, sounds shared by other addons, and your own files.\n\nYour own .ogg or .mp3 files go in the CowfeeRaidTools_Media addon's Sounds folder: Quality of Life > Sounds shows how, with a Test button for each file.\n\nPlay in the list plays the sound on your sound channel (General Settings)."

function UI.SoundDropdown(parent, text, opts)
    local o = {}
    for k, v in pairs(opts) do
        o[k] = v
    end
    o.options = opts.options or function()
        return CRT.Sound:Choices({ none = opts.none, filesOnly = opts.filesOnly })
    end
    o.decorate = function(button, option)
        if option.key == "none" then
            return nil
        end
        local hit = button:AttachFrame("Button")
        hit:SetSize(36, 18)
        hit:SetPoint("RIGHT", -4, 0)
        hit:EnableMouse(true)
        local label = button:AttachFontString()
        label:SetFontObject(CRTFontButtonSmall)
        label:SetPoint("CENTER", hit, "CENTER")
        label:SetText("|cff80c0ffPlay|r")
        hit:SetScript("OnClick", function()
            local handle, info = CRT.Sound:Play(option.key)
            if not handle then
                CRT:Print("That sound didn't play: " .. tostring(info) .. ".")
            end
        end)
        if button.fontString then
            button.fontString:SetPoint("RIGHT", hit, "LEFT", -6, 0)
        end
        local textWidth = button.fontString and button.fontString:GetUnboundedStringWidth() or 120
        return textWidth + 70, 20
    end
    local row = UI.Dropdown(parent, text, o)
    if opts.playButton then
        local play = CreateFrame("Button", nil, row, "UIPanelButtonTemplate")
        play:SetSize(UI.SOUND_PLAY_W, 20)
        play:SetPoint("LEFT", row.Dropdown, "RIGHT", UI.SOUND_PLAY_GAP, 0)
        play:SetText("Play")
        if play.GetFontString and play:GetFontString() then
            play:GetFontString():SetFontObject(CRTFontButtonSmall)
        end
        play:SetScript("OnClick", function()
            local key = opts.get()
            if key == nil or key == "none" then
                return
            end
            local handle, info = CRT.Sound:Play(key)
            if not handle then
                CRT:Print("That sound didn't play: " .. tostring(info) .. ".")
            end
        end)
        row.play = play
        local refresh = row.refresh
        row.refresh = function()
            refresh()
            local key = opts.get()
            local on = not (opts.enabledIf and not opts.enabledIf()) and key ~= nil and key ~= "none"
            play:SetEnabled(on and true or false)
        end
    end
    if opts.help then
        -- after the closed dropdown, or after its Play button
        row.help = UI.HelpRight(row.play or row, text ~= "" and text or "Sound", UI.SOUND_HELP, { parent = parent })
    end
    return row
end

-- The Modern slider. In the Modern look (UI:IsModern) a slider is a border-coloured track, accent up to the
-- knob's centre, and a bevelled knob (a dark edge, a soft line inside its top edge) that shows
-- the value in white: drag the knob or click the track; click the
-- knob without dragging (under KNOB_CLICK pixels) to type a number; the mouse wheel, and the arrow
-- keys while typing, move one step. There are no < > buttons. The game's slider stays for the Classic
-- look, and the look button switches between the two live (UI.skinned).
-- Rounded corners: UI.RoundRect, below.
local DISC = (CRT.MEDIA or ("Interface\\AddOns\\" .. ADDON .. "\\CRT_Media\\Media\\")) .. "Disc" -- the fallback is for test harnesses without Core.lua
local TRACK_H, TRACK_R = 4, 2
local KNOB_H, KNOB_R, KNOB_MIN_W, KNOB_PAD = 22, 5, 38, 14
local KNOB_TEXT_PAD = 8 -- the knob is at least this much taller than its font
local KNOB_CLICK = 3 -- a knob that moved less than this was clicked, not dragged
local NUDGE_DELAY = 0.4 -- an onRelease slider saves a wheel or arrow nudge this long after the last one

local QUARTERS = {
    -- point, texture coordinates (left, right, top, bottom), which way the inset goes
    { "TOPLEFT", 0, 0.5, 0, 0.5, 1, -1 },
    { "TOPRIGHT", 0.5, 1, 0, 0.5, -1, -1 },
    { "BOTTOMLEFT", 0, 0.5, 0.5, 1, 1, 1 },
    { "BOTTOMRIGHT", 0.5, 1, 0.5, 1, -1, 1 },
}

-- A rounded rectangle drawn by owner's textures over anchor (a frame or a texture), inset pixels in
-- from its edges, with corners of the given radius: a quarter of CRT_Media/Media/Disc.tga in each corner
-- and plain colour between them. height, when given and no more than two radii (a pill-ended bar), leaves
-- out the side pieces, which would have no height. Colour it with UI.PaintShape.
function UI.RoundRect(owner, anchor, layer, sublevel, radius, inset, height)
    inset = inset or 0
    local shape = { corners = {}, fills = {} }
    for _, q in ipairs(QUARTERS) do
        local t = owner:CreateTexture(nil, layer, nil, sublevel)
        t:SetTexture(DISC)
        t:SetTexCoord(q[2], q[3], q[4], q[5])
        t:SetSize(radius, radius)
        t:SetPoint(q[1], anchor, q[1], q[6] * inset, q[7] * inset)
        shape.corners[#shape.corners + 1] = t
    end
    local edge = inset + radius
    -- the middle, full height between the corner columns, and each side between its two corners
    local middle = owner:CreateTexture(nil, layer, nil, sublevel)
    middle:SetPoint("TOPLEFT", anchor, "TOPLEFT", edge, -inset)
    middle:SetPoint("BOTTOMRIGHT", anchor, "BOTTOMRIGHT", -edge, inset)
    shape.fills[1] = middle
    if not height or height - 2 * inset > 2 * radius then
        local left = owner:CreateTexture(nil, layer, nil, sublevel)
        left:SetPoint("TOPLEFT", anchor, "TOPLEFT", inset, -edge)
        left:SetPoint("BOTTOMRIGHT", anchor, "BOTTOMLEFT", edge, edge)
        local right = owner:CreateTexture(nil, layer, nil, sublevel)
        right:SetPoint("TOPRIGHT", anchor, "TOPRIGHT", -inset, -edge)
        right:SetPoint("BOTTOMLEFT", anchor, "BOTTOMRIGHT", -edge, edge)
        shape.fills[2], shape.fills[3] = left, right
    end
    return shape
end

-- Colours a UI.RoundRect shape: color is a CRT.PALETTE key ("knob") or { r, g, b [, a] }; alpha, when
-- given, is used in place of the colour's own (a faded, disabled control).
function UI.PaintShape(shape, color, alpha)
    local c = type(color) == "table" and color or CRT.PALETTE[color]
    local a = alpha or c[4] or 1
    for _, t in ipairs(shape.corners) do
        t:SetVertexColor(c[1], c[2], c[3], a)
    end
    for _, t in ipairs(shape.fills) do
        t:SetColorTexture(c[1], c[2], c[3], a)
    end
end

-- The number in the box you type into: no format, no trailing zeros ("45", "2.5").
local function plainNumber(v)
    if v == math.floor(v) then
        return string.format("%d", v)
    end
    local s = string.format("%.2f", v):gsub("0+$", ""):gsub("%.$", "")
    return s
end

-- A typed number, in the unit the knob shows: "4.5" (or "4,5"), "45%", or minutes and seconds
-- ("4:30" is 4.5). nil when it isn't a number.
local function readTyped(text)
    text = (text or ""):gsub(",", ".")
    local minutes, secs = text:match("^%s*(%d+):(%d%d?)%s*$")
    if minutes then
        return tonumber(minutes) + tonumber(secs) / 60
    end
    return tonumber((text:gsub("[^%d%.%-]", "")))
end

-- The knob's look and position for s.current. s is the slider's state (UI.Slider). The knob keeps
-- the widest text it has shown, so it never grows in the middle of a drag.
local function drawKnob(m, s)
    local text = s.format(s.current)
    m.text:SetText(text)
    local white = CRT.PALETTE.knobText
    m.text:SetTextColor(white[1], white[2], white[3])
    m.widest = math.max(m.widest or 0, m.text:GetUnboundedStringWidth() or 0)
    local knobW = math.min(m.trackW, math.max(KNOB_MIN_W, math.ceil(m.widest) + KNOB_PAD))
    local span = s.high - s.low
    local frac = span > 0 and (s.current - s.low) / span or 0
    frac = math.max(0, math.min(1, frac))
    local left = frac * (m.trackW - knobW)
    m.knob:SetWidth(knobW)
    m.knob:ClearAllPoints()
    m.knob:SetPoint("LEFT", m.track, "LEFT", left, 0)
    m.knobW, m.left = knobW, left
    m.fillW = left + knobW / 2
    m.fillArea:SetWidth(m.fillW)
end

-- Colours, and the knob's size again, after a look or font change: as wide as the widest of the
-- values at the two ends, so it keeps its size while it moves, and tall enough for the font.
local function restyleKnob(m, s)
    UI.PaintShape(m.empty, "border")
    UI.PaintShape(m.filled, "accent")
    UI.PaintShape(m.edge, "knobBorder")
    UI.PaintShape(m.face, "knob")
    local shine = CRT.PALETTE.knobShine
    m.shine:SetColorTexture(shine[1], shine[2], shine[3])
    local white = CRT.PALETTE.knobText
    m.edit:SetTextColor(white[1], white[2], white[3])
    local _, fontHeight = m.text:GetFont()
    m.knobH = math.max(KNOB_H, math.ceil(tonumber(fontHeight) or 0) + KNOB_TEXT_PAD)
    m.knob:SetHeight(m.knobH)
    local widest = 0
    for _, v in ipairs({ s.low, s.high }) do
        m.text:SetText(s.format(v))
        widest = math.max(widest, m.text:GetUnboundedStringWidth() or 0)
    end
    m.widest = widest
    drawKnob(m, s)
end

-- The cursor's x across the track, in the track's own units.
local function cursorX(m)
    local x = GetCursorPosition()
    local scale = m.track:GetEffectiveScale() or 1
    return x / scale - (m.track:GetLeft() or 0)
end

-- Mouse and keyboard on the Modern slider.
local function wireModern(m, s)
    local track, knob, edit = m.track, m.knob, m.edit

    local function follow(x)
        local usable = m.trackW - m.knobW
        local frac = usable > 0 and (x - m.grab - m.knobW / 2) / usable or 0
        s.commit(s.low + math.max(0, math.min(1, frac)) * (s.high - s.low))
    end
    local function stopDrag()
        track:SetScript("OnUpdate", nil)
        if s.dragging then
            s.dragging = false
            s.release()
        end
    end
    local function onUpdate()
        -- the button may have come up outside the slider
        if not IsMouseButtonDown("LeftButton") then
            stopDrag()
            return
        end
        local x = cursorX(m)
        if not m.moved and math.abs(x - m.startX) >= KNOB_CLICK then
            m.moved = true
        end
        if m.moved then
            follow(x)
        end
    end
    -- grab: how far right of the knob's centre the mouse went down. moved: a click on the track moves
    -- the knob at once; one on the knob waits until it has moved KNOB_CLICK pixels.
    local function startDrag(grab, moved)
        s.dragging = true
        m.grab, m.moved, m.startX = grab, moved, cursorX(m)
        if moved then
            follow(m.startX)
        end
        track:SetScript("OnUpdate", onUpdate)
    end

    local function closeEdit(apply)
        if not m.editing then
            return
        end
        m.editing = false
        local typed = readTyped(edit:GetText())
        edit:Hide()
        m.text:Show()
        edit:ClearFocus()
        if apply and typed then
            s.commit(s.fromDisplay(typed))
        end
        -- Enter applies at once, arrow nudges included, even on an onRelease slider
        if apply and not s.dragging then
            s.release()
        end
    end
    local function openEdit()
        m.editing = true
        edit:SetText(plainNumber(s.toDisplay(s.current)))
        m.text:Hide()
        edit:Show()
        edit:SetFocus()
        edit:HighlightText()
    end
    m.closeEdit = closeEdit

    -- Ctrl + wheel is the window's scale (UI/Panel.lua): it goes to the first frame above the slider
    -- with a wheel handler, as it would without the slider there.
    local function wheel(self, delta)
        if IsControlKeyDown and IsControlKeyDown() then
            local parent = track:GetParent()
            while parent do
                local handler = parent:GetScript("OnMouseWheel")
                if handler then
                    handler(parent, delta)
                    return
                end
                parent = parent:GetParent()
            end
            return
        end
        if s.enabled and not s.dragging then
            s.commit(s.current + (delta > 0 and 1 or -1) * s.step, true)
        end
    end
    for _, f in ipairs({ track, knob }) do
        f:EnableMouse(true)
        f:EnableMouseWheel(true)
        f:SetScript("OnMouseWheel", wheel)
    end
    track:SetScript("OnMouseDown", function(_, button)
        if button == "LeftButton" and s.enabled then
            closeEdit(true)
            startDrag(0, true)
        end
    end)
    track:SetScript("OnMouseUp", stopDrag)
    track:SetScript("OnHide", stopDrag)
    knob:SetScript("OnMouseDown", function(_, button)
        if button == "LeftButton" and s.enabled and not m.editing then
            startDrag(cursorX(m) - (m.left + m.knobW / 2), false)
        end
    end)
    knob:SetScript("OnMouseUp", function()
        local clicked = s.dragging and not m.moved
        stopDrag()
        if clicked then
            openEdit()
        end
    end)

    edit:SetScript("OnEnterPressed", function()
        closeEdit(true)
    end)
    edit:SetScript("OnEscapePressed", function()
        closeEdit(false)
    end)
    edit:SetScript("OnEditFocusLost", function()
        closeEdit(true)
    end)
    edit:SetScript("OnArrowPressed", function(_, key)
        local delta = (key == "UP" or key == "RIGHT") and 1 or (key == "DOWN" or key == "LEFT") and -1 or nil
        if not delta then
            return
        end
        local typed = readTyped(edit:GetText())
        s.commit((typed and s.clamp(s.fromDisplay(typed)) or s.current) + delta * s.step, true)
        edit:SetText(plainNumber(s.toDisplay(s.current)))
        edit:HighlightText()
    end)
end

-- Builds the Modern slider over the row's bar and value text, the first time the Modern look shows.
local function buildModern(row, s)
    local m = { trackW = s.width + VALUE_W }
    local track = CreateFrame("Frame", nil, row)
    track:SetSize(m.trackW, ROW_H)
    track:SetPoint("LEFT", row.Label, "RIGHT", GAP, 0)
    m.track = track
    -- the bar, and the part of it up to the knob's centre: hidden textures the shapes are drawn over
    local barArea = track:CreateTexture(nil, "BACKGROUND")
    barArea:SetPoint("LEFT")
    barArea:SetPoint("RIGHT")
    barArea:SetHeight(TRACK_H)
    barArea:Hide()
    m.fillArea = track:CreateTexture(nil, "BACKGROUND")
    m.fillArea:SetPoint("LEFT", barArea, "LEFT")
    m.fillArea:SetHeight(TRACK_H)
    m.fillArea:Hide()
    m.empty = UI.RoundRect(track, barArea, "BACKGROUND", 0, TRACK_R, 0, TRACK_H)
    m.filled = UI.RoundRect(track, m.fillArea, "BACKGROUND", 1, TRACK_R, 0, TRACK_H)

    local knob = CreateFrame("Button", nil, track)
    knob:SetHeight(KNOB_H)
    m.knob = knob
    -- a 1 px dark edge: the edge shape, the knob one 1 px inside it, and a 1 px line just inside the
    -- top edge, between the corners
    m.edge = UI.RoundRect(knob, knob, "BACKGROUND", 0, KNOB_R, 0)
    m.face = UI.RoundRect(knob, knob, "BACKGROUND", 1, KNOB_R - 1, 1)
    m.shine = knob:CreateTexture(nil, "BACKGROUND", nil, 2)
    m.shine:SetPoint("TOPLEFT", knob, "TOPLEFT", KNOB_R, -1)
    m.shine:SetPoint("TOPRIGHT", knob, "TOPRIGHT", -KNOB_R, -1)
    m.shine:SetHeight(1)
    m.text = knob:CreateFontString(nil, "OVERLAY", "CRTFontStandard")
    m.text:SetPoint("CENTER", 0, 0)
    m.text:SetWordWrap(false)

    local edit = CreateFrame("EditBox", nil, knob)
    edit:SetPoint("TOPLEFT", 3, -2)
    edit:SetPoint("BOTTOMRIGHT", -3, 2)
    edit:SetAutoFocus(false)
    if CRTFontStandard then
        edit:SetFontObject(CRTFontStandard)
    end
    edit:SetJustifyH("CENTER")
    edit:SetMaxLetters(10)
    edit:Hide()
    m.edit = edit

    wireModern(m, s)
    return m
end

-- A slider. opts:
--   min, max, step (default 1)
--   get(), set(value)   value is always a whole step
--   format(value)       the text beside the bar (on the knob in Modern), by default the number
--   onRelease           true to call set only when the mouse lets go of the bar, for a slider that
--                       resizes the window it sits in. The steppers (Classic) and a typed number
--                       (Modern, on Enter) apply at once; in Modern the wheel and the arrow keys
--                       apply NUDGE_DELAY seconds after the last nudge.
--   toDisplay(value), fromDisplay(number)   optional, for a format in another unit (seconds shown
--                       as minutes): the number box in Modern opens with toDisplay(value), and a
--                       typed number goes through fromDisplay before it is kept in range on a step
--   width, labelWidth, enabledIf()
-- Returns the row, with row.refresh(). row.Slider is the game's slider (Classic), row.modern the
-- track and knob (built the first time the Modern look shows).
function UI.Slider(parent, text, opts)
    local labelWidth, width = opts.labelWidth or LABEL_W, opts.width or 200
    local low, high, step = opts.min, opts.max, opts.step or 1
    local row = makeRow(parent, text, labelWidth)
    row:SetWidth(labelWidth + GAP + width + VALUE_W)

    -- updating: the value is being set from the saved setting, so it is not saved back.
    -- dragging and pending: with onRelease, the value waits until the mouse lets go.
    -- current: the value the Modern knob shows.
    local s = { low = low, high = high, step = step, width = width, format = opts.format or tostring, enabled = true,
        updating = false, dragging = false, pending = nil, current = opts.get() or low }
    local function same(v)
        return v
    end
    s.toDisplay, s.fromDisplay = opts.toDisplay or same, opts.fromDisplay or same
    local function snap(value)
        return math.floor((value - low) / step + 0.5) * step + low
    end
    s.clamp = function(value)
        return math.max(low, math.min(high, snap(value)))
    end

    local slider = CreateFrame("Frame", nil, row, "MinimalSliderWithSteppersTemplate")
    slider:SetSize(width, ROW_H)
    slider:SetPoint("LEFT", row.Label, "RIGHT", GAP, 0)
    local Label, Event = MinimalSliderWithSteppersMixin.Label, MinimalSliderWithSteppersMixin.Event
    local formatters = {
        [Label.Right] = CreateMinimalSliderFormatter(Label.Right, function(value)
            return s.format(snap(value))
        end),
    }
    slider:Init(opts.get() or low, low, high, (high - low) / step, formatters)
    -- The value beside the bar (GameFontNormal in the template), in the addon's font.
    if type(slider.RightText) == "table" then
        slider.RightText:SetFontObject(CRTFontStandard)
    end
    row.Slider = slider

    slider:RegisterCallback(Event.OnValueChanged, function(_, value)
        if s.updating then
            return
        end
        value = snap(value)
        if opts.onRelease and s.dragging then
            s.pending = value
            return
        end
        opts.set(value)
    end, row)
    slider:RegisterCallback(Event.OnInteractStart, function()
        s.dragging = true
    end, row)
    s.release = function()
        s.dragging = false
        if s.pending ~= nil then
            local value = s.pending
            s.pending = nil
            opts.set(value)
        end
    end
    slider:RegisterCallback(Event.OnInteractEnd, s.release, row)

    -- A value from the Modern slider: kept in range on a whole step, shown on the knob, and saved.
    -- With onRelease, a drag saves when the mouse lets go, and a nudge (wheel, arrow key) NUDGE_DELAY
    -- seconds after the last one, so turning the wheel doesn't rescale the window at every notch.
    s.nudges = 0
    s.commit = function(value, nudge)
        value = s.clamp(value)
        if value == s.current then
            return
        end
        s.current = value
        if s.modern then
            drawKnob(s.modern, s)
        end
        if opts.onRelease and (s.dragging or nudge) then
            s.pending = value
            if not s.dragging then
                s.nudges = s.nudges + 1
                local nudges = s.nudges
                C_Timer.After(NUDGE_DELAY, function()
                    if nudges == s.nudges and not s.dragging then
                        s.release()
                    end
                end)
            end
            return
        end
        s.pending = nil
        opts.set(value)
    end

    -- Classic shows the game's slider, Modern the track and knob; each picks up the current value.
    row.crtSkin = function(modern)
        if modern and not s.modern then
            s.modern = buildModern(row, s)
            row.modern = s.modern
        end
        local m = s.modern
        if not m then
            return
        end
        slider:SetShown(not modern)
        m.track:SetShown(modern)
        if modern then
            if not s.dragging and s.pending == nil then
                s.current = opts.get() or low
            end
            restyleKnob(m, s)
        else
            m.closeEdit(false)
            s.updating = true
            slider:SetValue(opts.get() or low)
            s.updating = false
        end
    end

    row.refresh = function()
        if not s.dragging then
            s.updating = true
            slider:SetValue(opts.get() or low)
            s.updating = false
            -- a nudge waiting to be saved stays on the knob
            if s.pending == nil then
                s.current = opts.get() or low
            end
        end
        if opts.enabledIf then
            local on = opts.enabledIf() and true or false
            slider:SetEnabled(on)
            greyLabel(row, on)
            s.enabled = on
        end
        local m = s.modern
        if m then
            m.track:SetAlpha(s.enabled and 1 or 0.5)
            -- a greyed slider lets the wheel through to the page under it
            m.track:EnableMouseWheel(s.enabled)
            m.knob:EnableMouseWheel(s.enabled)
            if not s.enabled then
                m.closeEdit(false)
            end
            drawKnob(m, s)
        end
    end

    if UI.skinned then
        UI.skinned[#UI.skinned + 1] = row
    end
    row.crtSkin(UI.IsModern and UI:IsModern() or false)
    return row
end

-- A spot picker: a box standing for something (what you hover, a window) with twelve small square spots
-- around it, three on each side, as in UI.TOOLTIP_SPOTS (UI/Tooltip.lua). The chosen spot is filled with
-- the theme's accent (the game's gold in Default: Blizzard); the others are dark squares that light up
-- under the mouse, and each names itself in a tooltip. opts:
--   get()        the chosen spot's key (nil for none)
--   set(key)     called when a spot is clicked
--   label        the text in the box, such as "What you hover"
--   spots        optional: the keys to show (the rest are hidden); all twelve by default
--   enabledIf()  optional: greys the picker while it returns false. A greyed picker still takes a click,
--                since picking a spot is how the setting that owns it turns spots on
--   area         optional: the tooltip area its own tooltips follow (UI.TooltipOwner)
-- The picker is UI.SPOT_PICKER_W x UI.SPOT_PICKER_H. Returns the frame, with picker.refresh() and
-- picker.spots[key] (each spot's button).
local SPOT_SIZE, SPOT_PAD = 10, 3 -- a spot, and the gap between the spots and the box
local SPOT_BOX_W, SPOT_BOX_H = 96, 34
UI.SPOT_PICKER_W = SPOT_BOX_W + 2 * (SPOT_SIZE + SPOT_PAD)
UI.SPOT_PICKER_H = SPOT_BOX_H + 2 * (SPOT_SIZE + SPOT_PAD)
UI.SPOT_PICKER_GAP = 12 -- from a control beside it

-- Each spot's top left corner in the picker: the top and bottom rows at the corners and the middle, the
-- sides' three spots along the box's height (the upper one level with its top, the lower with its bottom).
local function spotPlaces()
    local W, H, S = UI.SPOT_PICKER_W, UI.SPOT_PICKER_H, SPOT_SIZE
    local top, mid = SPOT_SIZE + SPOT_PAD, (W - S) / 2
    local sideY = { upper = -top, middle = -(H - S) / 2, lower = -(H - top - S) }
    return {
        topleft = { 0, 0 }, top = { mid, 0 }, topright = { W - S, 0 },
        leftupper = { 0, sideY.upper }, left = { 0, sideY.middle }, leftlower = { 0, sideY.lower },
        rightupper = { W - S, sideY.upper }, right = { W - S, sideY.middle }, rightlower = { W - S, sideY.lower },
        bottomleft = { 0, -(H - S) }, bottom = { mid, -(H - S) }, bottomright = { W - S, -(H - S) },
    }
end

-- The picker's colours, from the theme each time it is drawn: the chosen spot in the accent (heading, the
-- game's gold, in Classic), the others and the box dark with an edge.
local function paintSpotPicker(p)
    local P = CRT.PALETTE
    local on = p.enabled
    local chosen = p.opts.get()
    local pick = UI:IsModern() and P.accent or P.heading
    for key, b in pairs(p.spots) do
        local fill = key == chosen and pick or P.surface
        b.fill:SetColorTexture(fill[1], fill[2], fill[3], 1)
        b.edge:SetColorTexture(P.border[1], P.border[2], P.border[3], 1)
    end
    p.boxEdge:SetColorTexture(P.border[1], P.border[2], P.border[3], 1)
    p.boxFill:SetColorTexture(P.background[1], P.background[2], P.background[3], 0.6)
    if on then
        p.text:SetTextColor(P.text[1], P.text[2], P.text[3])
    else
        p.text:SetTextColor(0.5, 0.5, 0.5)
    end
    p:SetAlpha(on and 1 or 0.5)
end

-- A dark square with a 1 px edge: edge under, fill inset over it.
local function edgedSquare(f)
    local edge = f:CreateTexture(nil, "BACKGROUND")
    edge:SetAllPoints()
    local fill = f:CreateTexture(nil, "ARTWORK")
    fill:SetPoint("TOPLEFT", 1, -1)
    fill:SetPoint("BOTTOMRIGHT", -1, 1)
    return edge, fill
end

function UI.SpotPicker(parent, opts)
    local p = CreateFrame("Frame", nil, parent)
    p:SetSize(UI.SPOT_PICKER_W, UI.SPOT_PICKER_H)
    p.opts, p.spots, p.enabled = opts, {}, true
    local box = CreateFrame("Frame", nil, p)
    box:SetSize(SPOT_BOX_W, SPOT_BOX_H)
    box:SetPoint("TOPLEFT", SPOT_SIZE + SPOT_PAD, -(SPOT_SIZE + SPOT_PAD))
    p.box = box
    p.boxEdge, p.boxFill = edgedSquare(box)
    p.text = box:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    p.text:SetPoint("CENTER")
    p.text:SetWidth(SPOT_BOX_W - 6)
    p.text:SetJustifyH("CENTER")
    p.text:SetText(opts.label or "")

    local shown
    if opts.spots then
        shown = {}
        for _, key in ipairs(opts.spots) do
            shown[key] = true
        end
    end
    local places = spotPlaces()
    for _, s in ipairs(UI.TOOLTIP_SPOTS or {}) do
        local b = CreateFrame("Button", nil, p)
        b:SetSize(SPOT_SIZE, SPOT_SIZE)
        b:SetPoint("TOPLEFT", places[s.key][1], places[s.key][2])
        b.key, b.label = s.key, s.label
        b.edge, b.fill = edgedSquare(b)
        local hl = b:CreateTexture(nil, "HIGHLIGHT")
        hl:SetPoint("TOPLEFT", 1, -1)
        hl:SetPoint("BOTTOMRIGHT", -1, 1)
        hl:SetColorTexture(1, 1, 1, 0.35)
        b.highlight = hl
        b:SetScript("OnClick", function()
            opts.set(s.key)
            p.refresh()
        end)
        b:SetScript("OnEnter", function(self)
            UI.TooltipOwner(GameTooltip, self, "ANCHOR_RIGHT", nil, nil, opts.area)
            GameTooltip:SetText(s.label, 1, 1, 1)
            GameTooltip:Show()
        end)
        b:SetScript("OnLeave", function()
            GameTooltip:Hide()
        end)
        b:SetShown(not shown or shown[s.key] == true)
        p.spots[s.key] = b
    end

    p.refresh = function()
        p.enabled = not opts.enabledIf or (opts.enabledIf() and true or false)
        paintSpotPicker(p)
    end
    -- a look or theme switch repaints it (UI:ApplyStyle runs every crtSkin)
    p.crtSkin = function()
        paintSpotPicker(p)
    end
    if UI.skinned then
        UI.skinned[#UI.skinned + 1] = p
    end
    p.refresh()
    return p
end

-- Text that must stay inside a box it doesn't wrap in, such as a name in a Raid Groups slot.
-- UI.ClipText(parent, font) makes a clipping frame and a one-line font string inside it; anchor the
-- frame (frame.clip) where the text goes. UI.FitText(fs) then fits the text: up to FIT_STEPS points
-- smaller than its font object, and if it is still too long, it stays clipped at the edge and slides
-- sideways while the mouse is over hoverFrame, so the whole text can be read, then slides back.
local FIT_STEPS = 2
local SLIDE_SPEED = 40 -- pixels a second
local SLIDE_PAUSE = 0.6 -- seconds at each end

function UI.ClipText(parent, font, hoverFrame)
    local clip = CreateFrame("Frame", nil, parent)
    clip:SetClipsChildren(true)
    local fs = clip:CreateFontString(nil, "OVERLAY", font)
    fs:SetPoint("LEFT", clip, "LEFT", 0, 0)
    fs:SetWordWrap(false)
    fs:SetJustifyH("LEFT")
    fs.clip = clip
    -- kept here: once FitText sets a size on fs, its own font object is not a reliable base
    fs.fontObject = _G[font]
    fs.slide, fs.over, fs.wait = 0, 0, 0
    hoverFrame = hoverFrame or parent
    -- Hover is read each frame, not hooked: the owner may set its own OnEnter and OnLeave later,
    -- which would replace a hook.
    clip:SetScript("OnUpdate", function(_, dt)
        if fs.over <= 0 then
            return
        end
        local hover = hoverFrame:IsMouseOver() and true or false
        if hover ~= fs.hover then
            fs.hover, fs.wait = hover, hover and SLIDE_PAUSE or 0
        end
        local target = hover and fs.over or 0
        if fs.slide == target then
            return
        end
        if fs.wait > 0 then
            fs.wait = fs.wait - dt
            return
        end
        local step = SLIDE_SPEED * dt
        fs.slide = fs.slide < target and math.min(target, fs.slide + step) or math.max(target, fs.slide - step)
        fs:SetPoint("LEFT", clip, "LEFT", -fs.slide, 0)
    end)
    return fs
end

-- Call after every SetText (and after a font change): shrinks the text to fit its clip frame, up to
-- FIT_STEPS points, and notes how far it still overruns for the hover slide.
function UI.FitText(fs)
    local path, size, flags
    if fs.fontObject then
        -- not "a and a:GetFont()": an and keeps only the first of GetFont's values
        path, size, flags = fs.fontObject:GetFont()
    end
    local width = fs.clip:GetWidth() or 0
    if path and size then
        for step = 0, FIT_STEPS do
            fs:SetFont(path, size - step, flags or "")
            if (fs:GetUnboundedStringWidth() or 0) <= width then
                break
            end
        end
    end
    fs.over = math.max(0, math.ceil((fs:GetUnboundedStringWidth() or 0) - width))
    fs.slide = 0
    fs:SetPoint("LEFT", fs.clip, "LEFT", 0, 0)
end

-- The raid's 8 groups as a grid of 5-slot columns, as on Raid Groups and the Late Tracker's Tonight
-- tab. opts: cols (groups across), x and top (where the grid starts in parent), width (the whole grid),
-- colGap, rightW (room for a short text on the right of each slot, 0 for none) and skin(button).
-- Returns { slots = { 40 buttons, by index }, labels = { 8 }, slotW, blockH }. Each slot has .index,
-- .icon (a 16 x 16 texture on the left, hidden), .text (UI.ClipText: call UI.FitText after SetText) and
-- .right (when rightW > 0). The owner adds its own scripts.
local SLOT_H, SLOT_GAP, GROUP_LABEL_H = 22, 1, 20

function UI.SlotGrid(parent, opts)
    local cols, colGap, rightW = opts.cols or 4, opts.colGap or 10, opts.rightW or 0
    local slotW = math.floor((opts.width - (cols - 1) * colGap) / cols)
    local blockH = GROUP_LABEL_H + 5 * (SLOT_H + SLOT_GAP) + 8
    local grid = { slots = {}, labels = {}, slotW = slotW, blockH = blockH }
    for g = 1, 8 do
        local col, row = (g - 1) % cols, math.floor((g - 1) / cols)
        local x = (opts.x or 8) + col * (slotW + colGap)
        local y = opts.top - row * blockH
        local label = parent:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
        label:SetPoint("TOPLEFT", parent, "TOPLEFT", x, y)
        label:SetText("Group " .. g)
        grid.labels[g] = label
        for pos = 0, 4 do
            local b = CreateFrame("Button", nil, parent, "BackdropTemplate")
            b:SetSize(slotW, SLOT_H)
            b:SetPoint("TOPLEFT", parent, "TOPLEFT", x, y - GROUP_LABEL_H - pos * (SLOT_H + SLOT_GAP))
            if opts.skin then
                opts.skin(b)
            end
            b.index = (g - 1) * 5 + pos + 1
            b.icon = b:CreateTexture(nil, "OVERLAY")
            b.icon:SetSize(16, 16)
            b.icon:SetPoint("LEFT", 4, 0)
            b.icon:Hide()
            -- the name never leaves the slot: it shrinks up to two sizes, then slides on hover
            b.text = UI.ClipText(b, "CRTFontSmall")
            b.text.clip:SetPoint("LEFT", 25, 0)
            b.text.clip:SetPoint("RIGHT", -(6 + rightW), 0)
            b.text.clip:SetHeight(SLOT_H)
            if rightW > 0 then
                b.right = b:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
                b.right:SetPoint("RIGHT", -6, 0)
                b.right:SetWidth(rightW)
                b.right:SetJustifyH("RIGHT")
                b.right:SetWordWrap(false)
            end
            grid.slots[b.index] = b
        end
    end
    return grid
end

-- Opens the game's colour picker on color ({ r, g, b [, a] }). set(newColor) is called as the colour
-- changes, and with the starting colour again on Cancel. opts.hasOpacity shows the opacity slider.
-- Alerts/Areas.lua has its own copy from before this helper; it can move onto it.
function UI.PickColor(color, set, opts)
    if not ColorPickerFrame then
        return
    end
    opts = opts or {}
    local before = { color[1] or 1, color[2] or 1, color[3] or 1, color[4] or 1 }
    local function apply()
        local r, g, b = ColorPickerFrame:GetColorRGB()
        local a = (opts.hasOpacity and ColorPickerFrame.GetColorAlpha) and ColorPickerFrame:GetColorAlpha() or before[4]
        set({ r, g, b, a })
    end
    local function cancel()
        if opts.cancel then
            opts.cancel() -- the caller puts back what it had (an alert's colour may be none)
        else
            set({ before[1], before[2], before[3], before[4] })
        end
    end
    if ColorPickerFrame.SetupColorPickerAndShow then
        ColorPickerFrame:SetupColorPickerAndShow({
            r = before[1], g = before[2], b = before[3], opacity = before[4], hasOpacity = opts.hasOpacity and true or false,
            swatchFunc = apply, opacityFunc = apply, cancelFunc = cancel,
        })
    else
        ColorPickerFrame.hasOpacity = opts.hasOpacity and true or false
        ColorPickerFrame.opacity = 1 - before[4] -- the older picker counts transparency
        ColorPickerFrame.previousValues = { before[1], before[2], before[3], before[4] }
        ColorPickerFrame.func = apply
        ColorPickerFrame.opacityFunc = apply
        ColorPickerFrame.cancelFunc = cancel
        ColorPickerFrame:SetColorRGB(before[1], before[2], before[3])
        ColorPickerFrame:Hide()
        ColorPickerFrame:Show()
    end
end

-- Column headings you click to sort a list: once low to high (^), again high to low (v), and with
-- opts.backToDefault a third click goes back to the list's own order. cols: { { key, x, w, title } };
-- the headings sit at opts.x (default 0) + col.x, opts.y. A column with sortable = false is plain.
-- opts.get() returns key, dir (dir 1 or -1, key nil for the default order); opts.set(key, dir).
-- Returns { refresh = function }, which redraws the arrows. The headings are the label colour and the sorted one
-- light cream, with an accent arrow (CRT.PALETTE, read on each refresh so they follow the theme).
function UI.SortHeaders(parent, cols, opts)
    local x0, y = opts.x or 0, opts.y or 0
    local buttons = {}
    local function refresh()
        local key, dir = opts.get()
        for _, b in ipairs(buttons) do
            local on = b.col.key == key
            b.arrow:SetText(on and (dir < 0 and "v" or "^") or "")
            local accent, label = CRT.PALETTE.accent, CRT.PALETTE.label
            b.arrow:SetTextColor(accent[1], accent[2], accent[3])
            if on then
                b.text:SetTextColor(1, 0.95, 0.85)
            else
                b.text:SetTextColor(label[1], label[2], label[3])
            end
        end
    end
    for _, col in ipairs(cols) do
        local b = CreateFrame("Button", nil, parent)
        b.col = col
        b:SetPoint("TOPLEFT", x0 + col.x, y)
        b:SetSize(col.w, 18)
        b.text = b:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
        b.text:SetPoint("LEFT")
        b.text:SetText(col.title)
        b.arrow = b:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        b.arrow:SetPoint("LEFT", b.text, "RIGHT", 3, 0)
        if col.sortable ~= false then
            local hl = b:CreateTexture(nil, "HIGHLIGHT")
            hl:SetAllPoints()
            hl:SetColorTexture(1, 1, 1, 0.06)
            b:SetScript("OnClick", function()
                local key, dir = opts.get()
                if key ~= col.key then
                    opts.set(col.key, 1)
                elseif dir > 0 then
                    opts.set(col.key, -1)
                elseif opts.backToDefault then
                    opts.set(nil, 1)
                else
                    opts.set(col.key, 1)
                end
                refresh()
            end)
        end
        buttons[#buttons + 1] = b
    end
    refresh()
    return { refresh = refresh }
end
