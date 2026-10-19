local ADDON, CRT = ...

-- Shared settings controls in the style of the game's Edit Mode panels: a label on the left and the
-- control on its right, in a row 32 pixels high. They use the same game templates as
-- Blizzard_EditMode's EditModeSettingDropdownTemplate and EditModeSettingSliderTemplate:
--   UI.Dropdown  WowStyle1DropdownTemplate, a dropdown with a radio list of choices
--   UI.Slider    MinimalSliderWithSteppersTemplate, a bar with < and > steppers and the value on
--                its right
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
-- files go, as row.help, for the caller to anchor. opts.playButton true adds a small Play button after the
-- closed dropdown, as row.play, that plays the chosen sound once (nothing else: no alert, bar or speech).
UI.SOUND_PLAY_W, UI.SOUND_PLAY_GAP = 44, 6
UI.SOUND_HELP = "Game sounds, sounds other addons share (through LibSharedMedia), and your own files.\n\nYour own .ogg or .mp3 files go in the CowfeeRaidTools_Media companion addon's Sounds folder: Quality of Life > Sounds says how to set it up, and has a Test button for each file.\n\nPlay in the open list plays a sound on your sound channel (General Settings)."

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
    if opts.help then
        row.help = UI.Help(parent, text ~= "" and text or "Sound", UI.SOUND_HELP)
    end
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
    return row
end

-- A slider. opts:
--   min, max, step (default 1)
--   get(), set(value)   value is always a whole step
--   format(value)       the text beside the bar, by default the number
--   onRelease           true to call set only when the mouse lets go of the bar, for a slider that
--                       resizes the window it sits in. The steppers still apply each click.
--   width, labelWidth, enabledIf()
-- Returns the row, with row.refresh().
function UI.Slider(parent, text, opts)
    local labelWidth, width = opts.labelWidth or LABEL_W, opts.width or 200
    local low, high, step = opts.min, opts.max, opts.step or 1
    local row = makeRow(parent, text, labelWidth)
    row:SetWidth(labelWidth + GAP + width + VALUE_W)

    local function snap(value)
        return math.floor((value - low) / step + 0.5) * step + low
    end
    local format = opts.format or tostring

    local slider = CreateFrame("Frame", nil, row, "MinimalSliderWithSteppersTemplate")
    slider:SetSize(width, ROW_H)
    slider:SetPoint("LEFT", row.Label, "RIGHT", GAP, 0)
    local Label, Event = MinimalSliderWithSteppersMixin.Label, MinimalSliderWithSteppersMixin.Event
    local formatters = {
        [Label.Right] = CreateMinimalSliderFormatter(Label.Right, function(value)
            return format(snap(value))
        end),
    }
    slider:Init(opts.get() or low, low, high, (high - low) / step, formatters)
    -- The value beside the bar (GameFontNormal in the template), in the addon's font.
    if type(slider.RightText) == "table" then
        slider.RightText:SetFontObject(CRTFontStandard)
    end
    row.Slider = slider

    -- updating: the value is being set from the saved setting, so it is not saved back.
    -- dragging and pending: with onRelease, the value waits until the mouse lets go.
    local updating, dragging, pending = false, false, nil
    slider:RegisterCallback(Event.OnValueChanged, function(_, value)
        if updating then
            return
        end
        value = snap(value)
        if opts.onRelease and dragging then
            pending = value
            return
        end
        opts.set(value)
    end, row)
    slider:RegisterCallback(Event.OnInteractStart, function()
        dragging = true
    end, row)
    slider:RegisterCallback(Event.OnInteractEnd, function()
        dragging = false
        if pending ~= nil then
            local value = pending
            pending = nil
            opts.set(value)
        end
    end, row)

    row.refresh = function()
        if not dragging then
            updating = true
            slider:SetValue(opts.get() or low)
            updating = false
        end
        if opts.enabledIf then
            local on = opts.enabledIf() and true or false
            slider:SetEnabled(on)
            greyLabel(row, on)
        end
    end
    return row
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
-- Returns { refresh = function }, which redraws the arrows.
function UI.SortHeaders(parent, cols, opts)
    local x0, y = opts.x or 0, opts.y or 0
    local buttons = {}
    local function refresh()
        local key, dir = opts.get()
        for _, b in ipairs(buttons) do
            local on = b.col.key == key
            b.arrow:SetText(on and (dir < 0 and "v" or "^") or "")
            b.text:SetTextColor(on and 1 or 0.87, on and 0.95 or 0.73, on and 0.85 or 0.56)
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
        b.arrow:SetTextColor(0.78, 0.56, 0.36)
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
