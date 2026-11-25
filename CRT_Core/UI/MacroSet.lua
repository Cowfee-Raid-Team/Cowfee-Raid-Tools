local ADDON, CRT = ...

-- UI.MacroSet(parent, setKey, opts): the "Your macros" block for one macro set of CRT.Macros (Core/Macros.lua), the
-- same on every page that shows one (Raid Notes > Marker macros, Markers/MacrosTab.lua; Interrupts > Macros,
-- Interrupts/Page.lua).
--   Heading      opts.heading with its (?) opts.help
--   Icons        one per macro, with its name, body and state. A click toggles: a macro not made yet is made
--                (Macros:Create(set, name)), one of ours is removed (Macros:Remove(set, name)), after asking when it
--                sits on an action bar (Macros:OnActionBar); one the player edited, or their own with our name, is
--                never touched. A click while the cursor holds something (a drag) does nothing. A made one drags to
--                an action bar (Macros:Pickup)
--   Buttons      Generate all macros (makes the rest, and rewrites ours a newer version changed), Remove macros
--                (only ours, after asking), and the status line; greyed in combat
-- opts: x, y (the heading's top left in parent, default 8, -8), width (default the page's width less 2 * x),
-- heading, help, and two hooks for a page's own use of a click:
--   onClick(entry) runs first on a click; returning true means the page handled it (the block then does nothing)
--   tip(entry) returns a tooltip line in place of the block's own, or nil
-- An entry is Macros:Status's: { def = { name, icon, body }, state, perCharacter, outdated }.
-- Returns a control: refresh(), and its parts (cells, generate, remove, status, heading) for tests.

local UI = CRT.UI

-- Every word of the block, in one place so the wording is easy to change.
local TEXT = {
    generate = "Generate all macros",
    remove = "Remove macros",
    removeAsk = "Remove the %s macros the addon made? Macros you edited or renamed stay.",
    combat = "Not in combat: the game doesn't let addons change macros during a fight.",
    none = "None made yet.",
    made = "Made",
    here = " (this character)",
    outdated = "Out of date",
    changed = "Changed by you",
    conflict = "Blocked by your own",
    missing = "Not made",
    tipMissing = "Not made yet. Click to make this macro.",
    tipGeneral = "In General Macros, for all your characters.",
    tipCharacter = "In this character's macros.",
    tipOurs = "Click to remove this macro.",
    tipDrag = "Drag it to an action bar.",
    tipOnBar = "It's on your action bars.",
    removeOneAsk = "Remove %s? It's on your action bars, and making it again won't put it back there.",
    tipChanged = "You edited this macro, so the addon leaves it as it is.",
    tipConflict = "You have your own macro with this name, so the addon doesn't make one.",
}

-- Every place and size, from the heading's top left.
local ICON = 36
local ICONS_Y = -24 -- the icons' top, under the heading
local BUTTONS_GAP = 62 -- from the icons' bottom to the buttons at the default text size: the name, body and state lines
local LINE_GAPS = 4 + 2 + 2 + 8 -- above each of the three lines and under the last
local BUTTON_H = 24

-- The buttons' top: under the three lines at the text size now (a line is its font's size plus 3).
local function buttonsY()
    local font, size = _G.CRTFontSmall, nil -- Core.lua's; a harness without it takes the default size
    if font and font.GetFont then
        size = select(2, font:GetFont())
    end
    return ICONS_Y - ICON - math.max(BUTTONS_GAP, LINE_GAPS + 3 * ((tonumber(size) or 12) + 3))
end

-- UI.PanelButton (Panel.lua: the template, skinned), in the page's font as the tab's buttons were, and as wide as
-- its label in that font.
local function makeButton(parent, label)
    local b = UI.PanelButton(parent, label, BUTTON_H)
    b:SetNormalFontObject(CRTFontNormal)
    b:SetHighlightFontObject(CRTFontHighlight)
    b:SetDisabledFontObject(CRTFontDisable)
    UI.FitButton(b) -- measured again in the new font
    return b
end

-- A macro's state, in words and colour, from its Status entry.
local function stateText(e)
    if e.state == "ours" then
        local where = e.perCharacter and TEXT.here or ""
        if e.outdated then
            return UI.WarnText(TEXT.outdated .. where)
        end
        return UI.GoodText(TEXT.made .. where)
    elseif e.state == "changed" then
        return UI.WarnText(TEXT.changed)
    elseif e.state == "conflict" then
        return UI.BadText(TEXT.conflict)
    end
    return TEXT.missing
end

-- The block's own tooltip line for an entry; one of ours says whether it is on an action bar (Macros:OnActionBar).
local function tipLine(set, e)
    if e.state == "missing" then
        return TEXT.tipMissing
    elseif e.state == "ours" then
        local bar = CRT.Macros:OnActionBar(set, e.def.name) and TEXT.tipOnBar or TEXT.tipDrag
        return (e.perCharacter and TEXT.tipCharacter or TEXT.tipGeneral) .. " " .. TEXT.tipOurs .. " " .. bar
    elseif e.state == "changed" then
        return TEXT.tipChanged
    end
    return TEXT.tipConflict
end

local function cellTooltip(block, cell)
    local e = cell.entry
    if not e then
        return
    end
    UI.TooltipOwner(GameTooltip, cell.button, "ANCHOR_TOP")
    GameTooltip:SetText(e.def.name, 1, 1, 1)
    GameTooltip:AddLine(e.def.body, 0.85, 0.85, 0.85)
    local own = block.opts.tip and block.opts.tip(e)
    GameTooltip:AddLine(own or tipLine(block.set, e), 0.85, 0.85, 0.85, true)
    if not own and (e.state == "missing" or e.state == "ours") and CRT.Macros:InCombat() then
        GameTooltip:AddLine(TEXT.combat, 1, 0.55, 0.1, true)
    end
    GameTooltip:Show()
end

-- Runs an engine action on the set, says what it did, and draws the block again.
local function run(block, action, name)
    local ok, message = CRT.Macros[action](CRT.Macros, block.set, name)
    if message then
        CRT:Print(message)
    end
    block.refresh()
    return ok
end

-- The game's confirm popup over CRT's windows, as Remove macros asks: accept runs onAccept.
local function ask(text, arg, acceptText, onAccept)
    UI.LiftOver(UI.ShownPopup(StaticPopup_ShowCustomGenericConfirmation({
        text = text,
        text_arg1 = arg,
        acceptText = acceptText,
        cancelText = CANCEL,
        showAlert = true,
        callback = onAccept,
    }), "GENERIC_CONFIRMATION"))
end

-- Removes one of ours: at once, or after asking when it sits on an action bar (removing it empties that slot).
local function removeOne(block, name)
    if not CRT.Macros:InCombat() and CRT.Macros:OnActionBar(block.set, name) then
        ask(TEXT.removeOneAsk, name, TEXT.remove, function()
            run(block, "Remove", name)
        end)
        return
    end
    run(block, "Remove", name)
end

-- What the cursor holds (GetCursorInfo -> its kind, or nil when empty; warcraft.wiki.gg), nil when it can't be read.
local function cursorBusy()
    if not GetCursorInfo then
        return false
    end
    local ok, kind = pcall(GetCursorInfo)
    return ok and kind ~= nil
end

-- A click: the page's hook first, then make a missing one or remove one of ours. A drag that ends on the same icon
-- arrives as a click with the macro still on the cursor: that is never a toggle.
local function click(block, cell)
    local e = cell.entry
    if not e or cursorBusy() then
        return
    end
    if block.opts.onClick and block.opts.onClick(e) then
        return
    end
    if e.state == "missing" then
        run(block, "Create", e.def.name)
    elseif e.state == "ours" then
        removeOne(block, e.def.name)
    end
end

local function makeCell(block, parent, i)
    local x = block.x + (i - 1) * block.cellW
    local cell = {}
    local b = CreateFrame("Button", nil, parent)
    b:SetSize(ICON, ICON)
    b:SetPoint("TOP", parent, "TOPLEFT", x + block.cellW / 2, block.y + ICONS_Y)
    b.icon = b:CreateTexture(nil, "ARTWORK")
    b.icon:SetAllPoints()
    b:SetHighlightTexture("Interface\\Buttons\\ButtonHilight-Square", "ADD")
    b.check = b:CreateTexture(nil, "OVERLAY")
    b.check:SetSize(16, 16)
    b.check:SetPoint("BOTTOMRIGHT", 4, -4)
    b.check:SetTexture("Interface\\RaidFrame\\ReadyCheck-Ready")
    cell.button = b
    local function line(anchor, gap, muted)
        local fs = parent:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        fs:SetPoint("TOP", anchor, "BOTTOM", 0, gap)
        fs:SetWidth(block.cellW - 6)
        fs:SetWordWrap(false)
        if muted then
            UI.Tint(fs, "SetTextColor", "muted")
        end
        return fs
    end
    cell.name = line(b, -4)
    cell.body = line(cell.name, -2, true)
    cell.state = line(cell.body, -2)
    b:SetScript("OnClick", function()
        click(block, cell)
    end)
    -- a made macro drags onto an action bar: the game's cursor carries it, as from its own macro window
    b:RegisterForDrag("LeftButton")
    b:SetScript("OnDragStart", function()
        local e = cell.entry
        if not e then
            return
        end
        GameTooltip:Hide()
        local _, message = CRT.Macros:Pickup(block.set, e.def.name)
        if message then
            CRT:Print(message)
        end
    end)
    b:SetScript("OnEnter", function()
        cellTooltip(block, cell)
    end)
    b:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    return cell
end

local function buildButtons(block, parent)
    local generate = makeButton(parent, TEXT.generate)
    generate:SetPoint("TOPLEFT", block.x, block.y + buttonsY())
    generate:SetScript("OnClick", function()
        run(block, "Create")
        local st = CRT.Macros:Status(block.set)
        if st and st.outdated > 0 then
            run(block, "Update")
        end
    end)
    local remove = makeButton(parent, TEXT.remove)
    remove:SetPoint("LEFT", generate, "RIGHT", 6, 0)
    remove:SetScript("OnClick", function()
        local st = CRT.Macros:Status(block.set)
        ask(TEXT.removeAsk, st and st.label or block.set, TEXT.remove, function()
            run(block, "Remove")
        end)
    end)
    local status = parent:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    status:SetPoint("LEFT", remove, "RIGHT", 12, 0)
    status:SetPoint("RIGHT", parent, "RIGHT", -8, 0)
    status:SetJustifyH("LEFT")
    status:SetWordWrap(false)
    block.generate, block.remove, block.status = generate, remove, status
end

local function refresh(block)
    local Macros = CRT.Macros
    local st = Macros:Status(block.set)
    local free = not Macros:InCombat()
    block.generate:SetEnabled(free)
    block.remove:SetEnabled(free)
    if not st then
        block.status:SetText("")
        return
    end
    local text = Macros:StatusText(block.set)
    if #st.changed > 0 or #st.conflicts > 0 or st.outdated > 0 then
        text = UI.WarnText(text)
    elseif st.created == st.total then
        text = UI.GoodText(text)
    end
    block.status:SetText(text == "none" and TEXT.none or text)
    for i, cell in ipairs(block.cells) do
        local e = st.entries[i]
        cell.entry = e
        cell.button:SetShown(e ~= nil)
        if e then
            cell.button.icon:SetTexture(e.def.icon)
            -- a macro of that name is in the list (ours, edited, or the player's own): a check, and its state
            cell.button.icon:SetDesaturated(e.state == "missing")
            cell.button.check:SetShown(e.state ~= "missing")
            cell.name:SetText(e.def.name)
            cell.body:SetText(e.def.body)
            cell.state:SetText(stateText(e))
        else
            cell.name:SetText("")
            cell.body:SetText("")
            cell.state:SetText("")
        end
    end
end

function UI.MacroSet(parent, setKey, opts)
    opts = opts or {}
    local x = opts.x or 8
    local block = { set = setKey, opts = opts, x = x, y = opts.y or -8, cells = {} }
    -- a cell per macro, eight across for a marker set; a bigger set fits the same width, so its cells are narrower
    local st = CRT.Macros:Status(setKey)
    local count = math.max(st and st.total or 0, 8)
    block.cellW = math.floor((opts.width or (UI.PAGE_W - 2 * x)) / count)
    local heading = parent:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    heading:SetPoint("TOPLEFT", block.x, block.y)
    heading:SetText(opts.heading or "")
    if opts.help then
        UI.HelpRight(heading, opts.heading or "", opts.help)
    end
    block.heading = heading
    for i = 1, count do
        block.cells[i] = makeCell(block, parent, i)
    end
    buildButtons(block, parent)
    -- a text size change: the buttons move under the taller (or shorter) lines
    UI:OnFonts(function()
        block.generate:SetPoint("TOPLEFT", block.x, block.y + buttonsY())
    end)
    block.refresh = function()
        refresh(block)
    end
    return block
end
