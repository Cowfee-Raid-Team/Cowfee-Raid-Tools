local ADDON, CRT = ...

-- The Debuffs tab of the Quality of Life page (a page of its own before 0.17.2): settings for the
-- debuff panel. The panel is moved with "Preview debuffs" on the tab, which previews only
-- this panel, or with "Previews" in the corner of the main window, which previews them all.
-- QoL/Page.lua builds it into its tab through CRT.DebuffsPage.Build.

local Debuffs = CRT.Debuffs
local UI = CRT.UI

local page, enabledCheck, sizeEdit, countEdit, durationEdit, dispelCheck, dispelSizeEdit, slotsCheck, previewButton
local refresh

local PREVIEW_LABEL, STOP_LABEL = "Preview debuffs", "Stop preview"
local look = {} -- the Look section's controls, each with refresh(on)

local function makeButton(parent, label, width, height)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontNormal)
    b:SetHighlightFontObject(CRTFontHighlight)
    b:SetDisabledFontObject(CRTFontDisable)
    b:SetSize(width, height or 26)
    b:SetText(label)
    return b
end

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
    previewButton:SetText(CRT.DebuffPanel:IsPreviewing() and STOP_LABEL or PREVIEW_LABEL)
    usable(dispelCheck, on)
    usable(slotsCheck, on)
    for _, control in ipairs(look) do
        control.refresh(on)
    end
end

local function build(pf)
    page = pf

    local title = pf:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    title:SetPoint("TOPLEFT", 8, -8)
    title:SetText("Debuff panel")

    UI.HelpRight(title, "The debuff panel", "A movable row of the debuffs enemies put on you, shortest first, in and out of combat. Press Preview debuffs to see it with samples and drag it into place. The game fills the row itself, so it works in combat. Your own debuffs, long ones, and lockouts such as Exhaustion are left out.")

    -- Only this panel's preview, not every panel's. It ends when the tab closes, unless Previews is on.
    previewButton = makeButton(pf, PREVIEW_LABEL, 120, 22)
    local labelWidth = 0
    local text = previewButton:GetFontString()
    if text then
        for _, label in ipairs({ PREVIEW_LABEL, STOP_LABEL }) do
            text:SetText(label)
            labelWidth = math.max(labelWidth, text:GetStringWidth() or 0)
        end
    end
    if labelWidth > 0 then
        previewButton:SetWidth(math.ceil(labelWidth) + 24)
    end
    previewButton:SetText(PREVIEW_LABEL)
    previewButton:SetPoint("LEFT", help, "RIGHT", 12, 0)
    previewButton:SetScript("OnClick", function()
        local panel = CRT.DebuffPanel
        if not panel:IsPreviewing() and InCombatLockdown() then
            CRT:Print("Previews can't be turned on during combat.")
            return
        end
        panel:ShowPreview(not panel:IsPreviewing())
    end)
    CRT.DebuffPanel.onPreviewChange = function(on)
        previewButton:SetText(on and STOP_LABEL or PREVIEW_LABEL)
    end
    pf:SetScript("OnHide", function()
        if CRT.DebuffPanel:IsPreviewing() and not UI.previewing then
            CRT.DebuffPanel:ShowPreview(false)
        end
    end)

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

    pf:SetScript("OnShow", refresh)
    Debuffs:OnChange(refresh)
end

CRT.DebuffsPage = { Build = build }
