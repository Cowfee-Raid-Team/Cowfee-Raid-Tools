local ADDON, CRT = ...

-- The Debuffs tab of the Quality of Life page (a page of its own before 0.17.2): settings for the
-- debuff panel. The panel is moved with "Preview debuffs" on the tab (UI.PreviewButton), which previews only
-- this panel, or with "Previews" in the corner of the main window, which previews them all.
-- QoL/Page.lua builds it into its tab through CRT.DebuffsPage.Build. Under the settings, Ignore.lua
-- builds the Ignore these debuffs section.

local Debuffs = CRT.Debuffs
local UI = CRT.UI

local page, enabledCheck, sizeEdit, countEdit, durationEdit, dispelCheck, dispelSizeEdit, slotsCheck
local refresh

local look = {} -- the Look section's controls, each with refresh(on)
local PREVIEW_GAP = 12 -- Preview debuffs, this far right of the title's (?)

-- The wording of the preview button and the tooltip settings.
local TEXT = {
    preview = "Preview debuffs",
    previewTip = "Shows the debuff panel with sample debuffs so you can drag it into place and see each Look change. Other previews stay as they are.",
    tooltips = "Show tooltips on hover",
    tooltipsHelp = "Hover a debuff on the panel to see its tooltip. It is the game's own tooltip, so it works in combat too.\n\n"
        .. "On, the icons take the mouse when you hover them. Off, the panel stays click-through, as before.\n\n"
        .. "Tooltip position picks where it opens: next to the icon, on a spot around it, or at the cursor. "
        .. "Game's tooltip spot can't be used here, so the tooltip opens next to the icon.\n\n"
        .. "The boss debuff slots (the second row) are drawn by the game, which decides their tooltips. "
        .. "A change made in combat or in a boss encounter applies when it ends. "
        .. "An icon the game first makes during an encounter keeps the game's own hover and placement until the encounter ends.",
    tooltipPicker = "The icon",
}

local function makeCheck(pf, label, yOffset, onClick, x)
    local check = CreateFrame("CheckButton", nil, pf, "UICheckButtonTemplate")
    check:SetSize(26, 26)
    check:SetPoint("TOPLEFT", x or 4, yOffset)
    local text = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    text:SetPoint("LEFT", check, "RIGHT", 2, 0)
    text:SetText(label)
    check:SetScript("OnClick", function(self)
        onClick(self:GetChecked())
    end)
    check.label = text
    return check
end

-- Greys a box or a number out, with its label, while the setting it depends on is off.
local function usable(control, on)
    control:SetEnabled(on)
    local c = on and 1 or 0.5
    control.label:SetTextColor(c, c, c)
    if control.SetTextColor then
        control:SetTextColor(c, c, c)
    end
end

-- The Look settings sit in a right-hand column, beside the panel settings (the page is UI.PAGE_W wide;
-- the widest row on the left, the boss debuff slots checkbox, wraps at LEFT_TEXT_W).
local LOOK_X = 440
local LEFT_TEXT_W = 390
-- The Ignore these debuffs section starts under both columns; the tooltip row, last in the Look column,
-- sits clear of its lists. The Tooltip position dropdown (with its spot picker beside it) goes right of
-- the box's label and (?), at TOOLTIP_POS_X or further; when a big font leaves no room on the page, it
-- goes under the box instead, at TOOLTIP_UNDER_X, clear of the Spell ID row's Add button.
local IGNORE_Y = -246
local TOOLTIP_Y = -228
local TOOLTIP_POS_X = 630
local TOOLTIP_UNDER_X, TOOLTIP_UNDER_Y = 480, -256
local TOOLTIP_LABEL_W, TOOLTIP_DROP_W = 100, 140
local TOOLTIP_GAP = 12

-- A dropdown for one look setting, in the Edit Mode style (UI/Controls.lua). getter and setter, when
-- given, read and save it through Debuffs (such as Debuffs.Grow and Debuffs.SetGrow) instead of Get
-- and Set.
local function lookDropdown(pf, yOffset, text, field, choices, getter, setter)
    local row = UI.Dropdown(pf, text, {
        options = choices,
        labelWidth = 80,
        width = 150,
        get = function()
            if getter then
                return getter(Debuffs)
            end
            return Debuffs:Get(field)
        end,
        set = function(key)
            if setter then
                setter(Debuffs, key)
            else
                Debuffs:Set(field, key)
            end
        end,
        enabledIf = function()
            return Debuffs:Enabled()
        end,
    })
    row:SetPoint("TOPLEFT", LOOK_X, yOffset)
    look[#look + 1] = row
    return row
end

-- A small box for a nudge in pixels, which can be negative.
local function nudgeBox(pf, anchor, label, field)
    local text = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    text:SetPoint("LEFT", anchor, "RIGHT", 14, 0)
    text:SetText(label)
    local edit = CreateFrame("EditBox", nil, pf, "InputBoxTemplate")
    UI:SkinEditBox(edit)
    edit:SetAutoFocus(false)
    edit:SetFontObject(CRTFontHighlight)
    edit:SetMaxLetters(3)
    edit:SetSize(36, 20)
    edit:SetPoint("LEFT", text, "RIGHT", 8, 0)
    edit:SetScript("OnEnterPressed", function(self)
        self:ClearFocus()
    end)
    edit:SetScript("OnEscapePressed", function(self)
        self:SetText(tostring(Debuffs:Get(field)))
        self:ClearFocus()
    end)
    edit:SetScript("OnEditFocusLost", function(self)
        Debuffs:SetNudge(field, self:GetText())
        self:SetText(tostring(Debuffs:Get(field)))
    end)
    edit.label = text
    edit.refresh = function(on)
        if not edit:HasFocus() then
            edit:SetText(tostring(Debuffs:Get(field)))
        end
        usable(edit, on and Debuffs:TimerAnchor() ~= nil)
    end
    look[#look + 1] = edit
    return edit
end

-- setter, when given, saves the box through Debuffs (such as Debuffs.SetDispelGlow) instead of Set.
local function lookCheck(pf, label, yOffset, field, x, dependsOn, setter)
    local check = makeCheck(pf, label, yOffset, function(checked)
        if setter then
            setter(Debuffs, checked)
        else
            Debuffs:Set(field, checked and true or false)
        end
    end, x)
    check.refresh = function(on)
        check:SetChecked(Debuffs:Get(field) and true or false)
        usable(check, on and (not dependsOn or Debuffs:Get(dependsOn) and true or false))
    end
    look[#look + 1] = check
    return check
end

-- Places the Tooltip position row from the box's label as drawn: right of the label, its (?) and a gap,
-- at TOOLTIP_POS_X or further, or under the box when that would run past the page's right edge.
local function placeTooltipRow(check, row)
    local text = check.label:GetStringWidth() or 0
    local labelLeft = LOOK_X - 4 + 26 + 2 -- makeCheck: the box, then its label 2 px right of it
    local x = math.max(TOOLTIP_POS_X, math.ceil(labelLeft + text + UI.HELP_GAP + UI.HELP_SIZE + TOOLTIP_GAP))
    local width = TOOLTIP_LABEL_W + 5 + TOOLTIP_DROP_W + UI.SPOT_PICKER_GAP + UI.SPOT_PICKER_W
    row:ClearAllPoints()
    if x + width <= UI.PAGE_W then
        row:SetPoint("TOPLEFT", x, TOOLTIP_Y)
    else
        row:SetPoint("TOPLEFT", TOOLTIP_UNDER_X, TOOLTIP_UNDER_Y)
    end
end

refresh = function()
    if not page or not page:IsShown() then
        return
    end
    enabledCheck:SetChecked(Debuffs:Enabled())
    dispelCheck:SetChecked(Debuffs:DispelIcon())
    slotsCheck:SetChecked(Debuffs:PrivateSlots())
    local on = Debuffs:Enabled() and true or false
    sizeEdit.refresh()
    countEdit.refresh()
    durationEdit.refresh()
    dispelSizeEdit.refresh()
    usable(dispelCheck, on)
    usable(slotsCheck, on)
    for _, control in ipairs(look) do
        control.refresh(on)
    end
    CRT.DebuffsIgnore.Refresh()
end

local function build(pf)
    page = pf

    local title = pf:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    title:SetPoint("TOPLEFT", 8, -8)
    title:SetText("Debuff panel")

    local help = UI.HelpRight(title, "The debuff panel", "A movable row of the debuffs enemies put on you, shortest first, in and out of combat. Press Preview debuffs to see it with samples and drag it into place. The game fills the row itself, so it works in combat. Your own debuffs, long ones, and lockouts such as Exhaustion are left out.")

    -- Only this panel's preview, not every panel's. Like every section's, it stays on until stopped, the
    -- title bar's Previews turns everything off, or the main window closes.
    local previewButton = UI.PreviewButton(pf, TEXT.preview, { "debuffs" }, { tooltip = TEXT.previewTip })
    previewButton:SetPoint("LEFT", help, "RIGHT", PREVIEW_GAP, 0)

    enabledCheck = makeCheck(pf, "Show the debuff panel", -30, function(checked)
        Debuffs:SetEnabled(checked)
    end)

    local function panelOn()
        return Debuffs:Enabled()
    end
    sizeEdit = UI.Slider(pf, "Icon size", { min = Debuffs.MIN_SIZE, max = Debuffs.MAX_SIZE, step = 2, labelWidth = 130, width = 200, enabledIf = panelOn, get = function()
        return Debuffs:Size()
    end, set = function(value)
        Debuffs:SetSize(value)
    end })
    sizeEdit:SetPoint("TOPLEFT", 8, -56)
    countEdit = UI.Slider(pf, "How many to show", { min = 1, max = 8, labelWidth = 130, width = 200, enabledIf = panelOn, get = function()
        return Debuffs:MaxCount()
    end, set = function(value)
        Debuffs:SetMaxCount(value)
    end })
    countEdit:SetPoint("TOPLEFT", 8, -84)

    durationEdit = UI.Slider(pf, "Hide debuffs longer than", { min = 0, max = 600, step = 30, labelWidth = 130, width = 200, enabledIf = panelOn,
        format = function(v)
            if v == 0 then
                return "Off"
            end
            return v % 60 == 0 and format("%d min", v / 60) or format("%d:%02d", math.floor(v / 60), v % 60)
        end,
        -- typed in minutes, as shown (4.5 is 4:30)
        toDisplay = function(v)
            return v / 60
        end,
        fromDisplay = function(n)
            return n * 60
        end,
        get = function()
            return Debuffs:MaxDuration()
        end,
        set = function(value)
            Debuffs:SetMaxDuration(value)
        end,
    })
    durationEdit:SetPoint("TOPLEFT", 8, -112)
    UI.HelpRight(durationEdit, "Hide debuffs longer than", "Debuffs longer than this are left out, so long ones don't fill the panel. Debuffs with no end time are left out too. Off shows every length. Boss mechanics are short, so 5 minutes keeps them all.")

    dispelCheck = makeCheck(pf, "Show the dispel type icon on each debuff", -146, function(checked)
        Debuffs:SetDispelIcon(checked)
    end)
    -- Indented under its box, with the bar lined up with the sliders above.
    dispelSizeEdit = UI.Slider(pf, "Dispel icon size", { min = Debuffs.MIN_DISPEL_SCALE * 100, max = Debuffs.MAX_DISPEL_SCALE * 100, step = 5,
        labelWidth = 110, width = 200,
        enabledIf = function()
            return Debuffs:Enabled() and Debuffs:DispelIcon()
        end,
        format = function(v)
            return format("%d%%", v)
        end,
        get = function()
            return math.floor(Debuffs:DispelIconScale() * 100 + 0.5)
        end,
        set = function(value)
            Debuffs:SetDispelIconScale(value / 100)
        end,
    })
    dispelSizeEdit:SetPoint("TOPLEFT", 28, -172)
    slotsCheck = makeCheck(pf, "Also use the game's boss debuff slots, in a second row", -206, function(checked)
        Debuffs:SetPrivateSlots(checked)
    end)
    slotsCheck.label:SetWidth(LEFT_TEXT_W - 30)
    slotsCheck.label:SetJustifyH("LEFT")
    UI.HelpRight(slotsCheck.label, "Boss debuff slots", "A fallback for boss debuffs the game hides from addons: the game draws them itself in a second row under the panel. Only the swipe, timer, dispel icon and border size apply there. Off by default.")

    -- The look of the boss debuff icons. Preview debuffs shows the changes as you make them.
    local lookTitle = pf:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    lookTitle:SetPoint("TOPLEFT", LOOK_X, -8)
    lookTitle:SetText("Look")
    UI.HelpRight(lookTitle, "Look", "Each debuff has a dark frame, a yellow countdown and its stacks; a debuff you can dispel gets a frame in its dispel colour.\n\nTimer: the countdown on the icon or beside it. Swipe numbers puts the game's countdown on the swipe instead.\n\nSwipe: a dark shade grows over the icon as it runs out; Bright edge lights its edge.\n\nBorder size: the frame's width; 0 has none.\n\nGrow: which end of the drag bar the row fills from, Left to right or Right to left.\n\nPress Preview debuffs to see each change.")

    local timer = lookDropdown(pf, -26, "Timer", "timerPosition", Debuffs.TIMER_POSITIONS)
    local nudgeX = nudgeBox(pf, timer, "Nudge X", "timerX")
    nudgeBox(pf, nudgeX, "Y", "timerY")
    lookCheck(pf, "Swipe animation as the debuff runs out", -60, "swipe", LOOK_X - 4)
    lookCheck(pf, "Bright edge on the swipe", -84, "swipeEdge", LOOK_X + 20, "swipe")
    local border = UI.Slider(pf, "Border size", { min = 0, max = 6, step = 0.5, labelWidth = 80, width = 200, enabledIf = panelOn,
        format = function(v)
            return format("%g", v)
        end,
        get = function()
            return Debuffs:Get("borderScale") or 1
        end,
        set = function(v)
            Debuffs:Set("borderScale", v)
        end,
    })
    border:SetPoint("TOPLEFT", LOOK_X, -112)
    look[#look + 1] = border
    local spacing = UI.Slider(pf, "Spacing", { min = Debuffs.MIN_SPACING, max = Debuffs.MAX_SPACING, labelWidth = 80, width = 200, enabledIf = panelOn,
        format = function(v)
            return format("%d px", v)
        end,
        get = function()
            return Debuffs:Spacing()
        end,
        set = function(v)
            Debuffs:SetSpacing(v)
        end,
    })
    spacing:SetPoint("TOPLEFT", LOOK_X, -140)
    look[#look + 1] = spacing
    UI.HelpRight(spacing, "Spacing", "The gap between two debuffs' borders. The border's width is added on top, so borders never overlap; at 0 they touch. The glow adds no space.")
    lookDropdown(pf, -168, "Grow", "grow", Debuffs.GROW_DIRECTIONS, Debuffs.Grow, Debuffs.SetGrow)
    local glow = lookCheck(pf, "Glow on dispellable debuffs", -204, "dispelGlow", LOOK_X - 4, nil, Debuffs.SetDispelGlow)
    UI.HelpRight(glow.label, "Glow on dispellable debuffs", "A dispellable debuff always gets a frame in its colour: Magic blue, Poison green, Curse purple, Disease brown, Bleed in the game's bleed colour. The glow adds a soft light in the same colour around that frame. Both need a border size above 0.")

    -- Tooltips on hover (Panel.lua), and where they open: the panel's own Tooltip position (UI/Tooltip.lua).
    local tips = lookCheck(pf, TEXT.tooltips, TOOLTIP_Y, "tooltips", LOOK_X - 4, nil, Debuffs.SetTooltips)
    UI.HelpRight(tips.label, TEXT.tooltips, TEXT.tooltipsHelp)
    local position = UI.TooltipPositionSetting(pf, "debuffs", { labelWidth = TOOLTIP_LABEL_W, width = TOOLTIP_DROP_W, beside = true,
        pickerLabel = TEXT.tooltipPicker,
        enabledIf = function()
            return Debuffs:Enabled() and Debuffs:Tooltips()
        end })
    placeTooltipRow(tips, position.row)
    look[#look + 1] = { refresh = function()
        placeTooltipRow(tips, position.row) -- the font may have changed since
        position.refresh()
    end }

    -- Your own and the built-in ignored debuffs, under both columns (Ignore.lua).
    CRT.DebuffsIgnore.Build(pf, IGNORE_Y)

    pf:SetScript("OnShow", refresh)
    Debuffs:OnChange(refresh)
end

CRT.DebuffsPage = { Build = build }
