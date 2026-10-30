local ADDON, CRT = ...

-- One assignment block's editor (Notes/Assign.lua's model), shared by the Mech Alerts Assign tab (Notes/AssignTab.lua)
-- and the note editor's Add assignment (Notes/EditorWindow.lua), so both offer the same: the block's Name, its Times
-- (the mechanic's casts, read only, or typed), then its rows, each with its label, the text its timer lines show, an
-- "N lines" tag (its tooltip lists them), On (the casts it is on: all, some, or rotate across the rotate rows), x to
-- remove it, and a box of chips (its players and tag words) that takes drops from the palette (Notes/Palette.lua) and
-- from the other rows; + Row and Quick fill (click a row, then the palette's chips) under them. A host keeps the block
-- and writes it; the editor only edits it and calls changed(kind) after each change:
--   Block.Build(parent, opts)   opts: x, y, width, height (the column), nameWidth (optional), state (the host's palette state: its drag
--                               makes the chips), names = { rows } (a global name), block() (the block, or nil),
--                               times() (the casts as { { ph, t } }, and whether they are typed), timesText() (the
--                               typed times as text), changed(kind) ("name", "times" or "rows"), readOnly()
--   ui:Refresh()                everything from the block
--   Block.DragOpts(ui)          the palette drag's handlers for this editor's rows (Palette.Drag)
-- Typing saves after a short pause, on Enter, or when the box lets go.

local UI = CRT.UI
local Assign = CRT.NoteAssign
local Palette = CRT.NotePalette

local Block = {}
CRT.NoteAssignBlock = Block

-- Every word of the block editor, in one place. Keep the keys, change the text in quotes, save, /reload.
local TEXT = {
    name = "Name",
    times = "Times",
    timesHelp = "The casts of this mechanic on the boss's ability timeline, for the difficulty on show. Each row gets a timer line on the casts it is on. Change the times on the Timeline: the lines follow.",
    typedHelp = "Type the times: the phase, then minutes:seconds from the start of that phase, as in P1 0:30, 1:15; P2 0:20. No phase means phase 1. Leave it empty for no timers: then only the heading and the rows go in the note.",
    noTimes = "No timers: only the heading and the rows go in the note.",
    on = "On",
    allCasts = "All casts",
    rotate = "Rotate across the rows",
    casts = "Casts",
    cast = "Cast %d (%s)",
    addRow = "+ Row",
    removeRow = "Remove this row",
    quickFill = "Quick fill",
    helpTitle = "Assignment",
    help = "Drag a player, role, group or class from the right onto a row to add it. Drag a name from one row to another to move it. Click x on a name to remove it.\n\nEach row has its label and the text its timer lines show (empty: the label). On picks the casts it is on: all of them, the ones you tick, or Rotate across the rows: the rows set to Rotate take the casts in turn.\n\nQuick fill: click a row, then click names on the right to add them to it.\n\nEach row with players gets one timer line per cast it is on, for those players, so their countdowns show. The tag beside a row says how many.",
    tagOne = "1 line",
    tag = "%d lines",
    tagTip = "Timer lines of %s",
    drop = "Drop players here",
}
Block.TEXT = TEXT

local L = {
    rowH = 22, -- a name, times or row line
    labelW = 44, -- Name and Times
    gap = 6,
    rowLabelW = 84, rowTextW = 130,
    onLabelW = 18, onW = 104, onGap = 5, -- UI.Dropdown's gap between its label and the dropdown
    removeW = 20,
    zonePad = 3, rowGap = 6,
    footerH = 24, statusH = 14,
    typingPause = 0.5, -- seconds after the last key before typing saves
}
Block.L = L

local BACKDROP = Palette.BACKDROP

local function setBox(edit, text)
    text = text or ""
    if edit:GetText() ~= text and not edit:HasFocus() then
        edit.filling = true
        edit:SetText(text)
        edit.filling = false
    end
end

local function makeEdit(parent, width, onType)
    local e = CreateFrame("EditBox", nil, parent, "InputBoxTemplate")
    e:SetAutoFocus(false)
    e.filling = false -- set while the editor fills it, so its own text is never taken as typing
    UI:SkinEditBox(e)
    e:SetFontObject(CRTFontHighlight)
    e:SetSize(width, L.rowH - 2)
    e:SetScript("OnTextChanged", function(self, user)
        if user and not self.filling then
            onType(self:GetText() or "")
        end
    end)
    e:SetScript("OnEnterPressed", function(self)
        self:ClearFocus()
    end)
    e:SetScript("OnEscapePressed", function(self)
        self:ClearFocus()
    end)
    return e
end

-- "P1 0:36"
local function castText(e)
    local t = math.max(0, e.t)
    return string.format("P%s %d:%02d", tostring(e.ph), math.floor(t / 60), math.floor(t % 60))
end

local Editor = {}
Editor.__index = Editor

-- Typing ------------------------------------------------------------------------------------------------------------

-- A box was typed in: kind is changed once the typing pauses, on Enter, or when the box lets go.
function Editor:Typed(kind)
    self.pending = kind
    self.gen = (self.gen or 0) + 1
    local gen = self.gen
    C_Timer.After(L.typingPause, function()
        if gen == self.gen then
            self:Flush()
        end
    end)
end

-- Saves typing that waits, if any.
function Editor:Flush()
    local kind = self.pending
    self.pending = nil
    if kind then
        self.opts.changed(kind)
    end
end

-- Rows ----------------------------------------------------------------------------------------------------------------

function Editor:Row(r)
    local block = self.opts.block()
    return block and block.rows[r]
end

local function tagEnter(tag)
    local ui = tag.ui
    local row = ui:Row(tag.index)
    local list = ui.lines and ui.lines[tag.index]
    if not (row and list and GameTooltip and UI.TooltipOwner) then
        return
    end
    UI.TooltipOwner(GameTooltip, tag, "ANCHOR_RIGHT")
    GameTooltip:SetText(string.format(TEXT.tagTip, Assign.CleanLabel(row.label, tag.index)), 1, 1, 1)
    for _, e in ipairs(list) do
        GameTooltip:AddLine(castText(e) .. "  " .. table.concat(row.tokens, ", ") .. "  " .. e.text, 0.85, 0.85, 0.85)
    end
    GameTooltip:Show()
end

local function hideTip()
    if GameTooltip then
        GameTooltip:Hide()
    end
end

-- On: the casts row r is on. All casts and Rotate are choices; each cast is a tick (a list).
function Editor:CastsDropdown(f)
    local ui = self
    local function row()
        return ui:Row(f.index)
    end
    local function changed()
        ui.opts.changed("rows")
    end
    return UI.Dropdown(f, TEXT.on, {
        labelWidth = L.onLabelW, width = L.onW, maxHeight = 300,
        enabledIf = function()
            local times = ui.opts.times()
            return #(times or {}) > 0 and not ui.opts.readOnly()
        end,
        options = function()
            local out = { { key = Assign.ALL, label = TEXT.allCasts }, { key = Assign.ROTATE, label = TEXT.rotate } }
            local list = Assign.SortTimes((ui.opts.times()))
            if #list > 0 then
                out[#out + 1] = { title = true, label = TEXT.casts }
            end
            for c, e in ipairs(list) do
                out[#out + 1] = { key = c, label = string.format(TEXT.cast, c, castText(e)), checkbox = true }
            end
            return out
        end,
        get = function()
            local r = row()
            return r and (type(r.casts) == "table" and "list" or r.casts) or Assign.ALL
        end,
        set = function(key)
            local r = row()
            if r and r.casts ~= key then
                r.casts = key
                changed()
            end
        end,
        checked = function(c)
            local r = row()
            if not (r and type(r.casts) == "table") then
                return false
            end
            for _, n in ipairs(r.casts) do
                if n == c then
                    return true
                end
            end
            return false
        end,
        toggle = function(c)
            local r = row()
            if not r then
                return
            end
            local list, found = {}, false
            for _, n in ipairs(type(r.casts) == "table" and r.casts or {}) do
                if n == c then
                    found = true
                else
                    list[#list + 1] = n
                end
            end
            if not found then
                list[#list + 1] = c
            end
            table.sort(list)
            r.casts = #list > 0 and list or Assign.ALL
            changed()
        end,
    })
end

function Editor:RowFrame(r)
    local f = self.rowFrames[r]
    if f then
        return f
    end
    local ui = self
    f = CreateFrame("Frame", nil, self.child)
    f.chips = {}
    f.labelEdit = makeEdit(f, L.rowLabelW, function(text)
        local row = ui:Row(f.index)
        if row then
            row.label = text
            ui:Typed("rows")
        end
    end)
    f.labelEdit:SetPoint("TOPLEFT", 6, -1)
    f.textEdit = makeEdit(f, L.rowTextW, function(text)
        local row = ui:Row(f.index)
        if row then
            row.text = text
            ui:Typed("rows")
        end
    end)
    f.textEdit:SetPoint("TOPLEFT", 6 + L.rowLabelW + L.gap + 4, -1)
    for _, e in ipairs({ f.labelEdit, f.textEdit }) do
        e:SetScript("OnEditFocusLost", function()
            ui:Flush()
        end)
    end
    f.tag = CreateFrame("Button", nil, f)
    f.tag.ui = self
    f.tag.text = f.tag:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    f.tag.text:SetPoint("LEFT", 0, 0)
    UI.Tint(f.tag.text, "SetTextColor", "accent")
    f.tag:SetScript("OnEnter", tagEnter)
    f.tag:SetScript("OnLeave", hideTip)
    f.casts = self:CastsDropdown(f)
    -- x: the shared panel button, as wide as its label
    f.remove = UI.PanelButton(f, "x", L.rowH - 2, function()
        local block = ui.opts.block()
        if block and not ui.opts.readOnly() and Assign.RemoveRow(block, f.index) then
            ui.selected = nil
            ui.opts.changed("rows")
        end
    end)
    f.remove:SetScript("OnEnter", function(self)
        if GameTooltip and UI.TooltipOwner then
            UI.TooltipOwner(GameTooltip, self, "ANCHOR_RIGHT")
            GameTooltip:SetText(TEXT.removeRow, 1, 1, 1)
            GameTooltip:Show()
        end
    end)
    f.remove:SetScript("OnLeave", hideTip)
    -- the drop zone: the row's chips, a box that takes drops (and, with Quick fill on, a click selects the row)
    f.zone = CreateFrame("Button", nil, f, "BackdropTemplate")
    f.zone:SetBackdrop(BACKDROP)
    f.zone:SetPoint("TOPLEFT", 4, -(L.rowH + 2))
    f.zone:SetScript("OnMouseDown", function()
        if ui.quickFill then
            ui.selected = f.index
            ui:Refresh()
        end
    end)
    f.empty = f.zone:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    f.empty:SetPoint("LEFT", 6, 0)
    f.empty:SetText(TEXT.drop)
    self.rowFrames[r] = f
    return f
end

-- Draws row r into its frame, width wide; returns its height.
function Editor:DrawRow(f, r, row, width, readOnly)
    f.index = r
    setBox(f.labelEdit, row.label)
    setBox(f.textEdit, row.text)
    local timed = #(self.opts.times() or {}) > 0
    f.labelEdit:SetEnabled(not readOnly)
    f.textEdit:SetEnabled(timed and not readOnly) -- no timers: no text to show
    -- right to left: x, On, the tag
    f.remove:ClearAllPoints()
    f.remove:SetPoint("TOPRIGHT", -2, -1)
    f.remove:SetShown(#self.opts.block().rows > 1)
    f.remove:SetEnabled(not readOnly)
    f.casts:ClearAllPoints()
    f.casts:SetPoint("RIGHT", f, "TOPRIGHT", -((f.remove:GetWidth() or L.removeW) + L.gap + 2), -(L.rowH / 2))
    f.casts.refresh()
    local list = self.lines[r] or {}
    f.tag.index = r
    if #list > 0 then
        f.tag.text:SetText(#list == 1 and TEXT.tagOne or string.format(TEXT.tag, #list))
        f.tag:SetSize(math.ceil(f.tag.text:GetStringWidth() or 0) + 2, L.rowH - 4)
        f.tag:ClearAllPoints()
        f.tag:SetPoint("TOPLEFT", 6 + L.rowLabelW + L.gap + 4 + L.rowTextW + L.gap + 4, -4)
        f.tag:Show()
    else
        f.tag:Hide()
    end
    -- the chips
    local zoneW = width - 8
    local chips, widths = {}, {}
    local classOf = Palette.ClassLookup()
    for k, name in ipairs(row.tokens) do
        local chip = f.chips[k] or Palette.MakeChip(f.zone, self.opts.state.drag)
        f.chips[k] = chip
        local class = Palette.PlayerClass(name, classOf) or CRT.NoteParser.ClassOf(name)
        widths[k] = Palette.FillChip(chip, { label = name, class = class, token = name }, { row = r, index = k }, not readOnly,
            false)
        chips[k] = chip
    end
    for k = #row.tokens + 1, #f.chips do
        f.chips[k]:Hide()
    end
    local h = math.max(Palette.L.chipH, Palette.Flow(chips, widths, L.zonePad, zoneW - L.zonePad, L.zonePad)) + 2 * L.zonePad
    f.empty:SetShown(#row.tokens == 0)
    f.zone:SetSize(zoneW, h)
    local selected = self.selected == r
    f.zone:SetBackdropColor(UI.Color("background", 0.5))
    f.zone.baseBorder = selected and "heading" or "border"
    f.zone:SetBackdropBorderColor(UI.Color(f.zone.baseBorder, selected and 1 or 0.6))
    return L.rowH + 2 + h + L.rowGap
end

-- Drawing ---------------------------------------------------------------------------------------------------------------

function Editor:Refresh()
    local o = self.opts
    local block = o.block()
    self.content:SetShown(block ~= nil)
    if not block then
        return
    end
    if self.state.press and self.state.drag then
        self.state.drag:Cancel() -- its chip may be filled with another name
    end
    local readOnly = o.readOnly() and true or false
    setBox(self.nameEdit, block.name)
    self.nameEdit:SetEnabled(not readOnly)
    local times, typed = o.times()
    times = times or {}
    self.timesText:SetShown(not typed)
    self.timesHelp:SetShown(not typed)
    self.timesEdit:SetShown(typed and true or false)
    self.typedHelp:SetShown(typed and true or false)
    if typed then
        setBox(self.timesEdit, o.timesText and o.timesText() or "")
        self.timesEdit:SetEnabled(not readOnly)
    else
        local parts = {}
        for i, e in ipairs(Assign.SortTimes(times)) do
            parts[i] = castText(e)
        end
        self.timesText:SetText(#parts > 0 and table.concat(parts, " · ") or TEXT.noTimes)
    end
    if self.selected and not block.rows[self.selected] then
        self.selected = nil
    end
    self.lines = Assign.RowLines(block, times)
    local width = self.rowsWidth
    local y = 0
    for r, row in ipairs(block.rows) do
        local f = self:RowFrame(r)
        local h = self:DrawRow(f, r, row, width, readOnly)
        f:ClearAllPoints()
        f:SetPoint("TOPLEFT", 0, -y)
        f:SetSize(width, h)
        f:Show()
        y = y + h
    end
    for r = #block.rows + 1, #self.rowFrames do
        self.rowFrames[r]:Hide()
    end
    self.child:SetHeight(math.max(1, y))
    self.addRow:SetEnabled(not readOnly and #block.rows < Assign.MAX_ROWS)
    self.quick:SetEnabled(not readOnly)
    self.quick:SetChecked(self.quickFill and true or false)
end

-- The row under the mouse, or nil (outside the rows' scroll area there is none).
function Editor:Target()
    if not (self.scroll:IsShown() and self.scroll:IsMouseOver()) then
        return nil
    end
    for r, f in ipairs(self.rowFrames) do
        if f:IsShown() and f:IsMouseOver() then
            return r
        end
    end
    return nil
end

function Editor:Highlight(target)
    for r, f in ipairs(self.rowFrames) do
        if f:IsShown() then
            local key = (r == target) and "accent" or f.zone.baseBorder or "border"
            f.zone:SetBackdropBorderColor(UI.Color(key, (key == "border") and 0.6 or 1))
        end
    end
end

-- Building ------------------------------------------------------------------------------------------------------------

function Block.Build(parent, opts)
    local ui = setmetatable({ opts = opts, state = opts.state, rowFrames = {}, lines = {} }, Editor)
    local c = CreateFrame("Frame", nil, parent)
    c:SetPoint("TOPLEFT", opts.x, opts.y)
    c:SetSize(opts.width, opts.height)
    ui.content = c
    -- Name
    local nameLabel = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    nameLabel:SetPoint("TOPLEFT", 0, -4)
    nameLabel:SetText(TEXT.name)
    ui.nameEdit = makeEdit(c, opts.nameWidth or (opts.width - L.labelW - 8), function(text)
        local block = opts.block()
        if block then
            block.name = text
            ui:Typed("name")
        end
    end)
    ui.nameEdit:SetPoint("TOPLEFT", L.labelW + 4, 0)
    -- Times: the casts, read only, or typed
    local timesY = -(L.rowH + 4)
    local timesLabel = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    timesLabel:SetPoint("TOPLEFT", 0, timesY - 4)
    timesLabel:SetText(TEXT.times)
    ui.timesText = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    ui.timesText:SetPoint("TOPLEFT", L.labelW + 4, timesY - 4)
    ui.timesText:SetWidth(opts.width - L.labelW - 4 - UI.HELP_GAP - UI.HELP_SIZE - 6)
    ui.timesText:SetJustifyH("LEFT")
    ui.timesText:SetWordWrap(false)
    ui.timesHelp = UI.HelpRight(ui.timesText, TEXT.times, TEXT.timesHelp)
    ui.timesEdit = makeEdit(c, opts.width - L.labelW - 8 - UI.HELP_GAP - UI.HELP_SIZE - 6, function()
        ui:Typed("times")
    end)
    ui.timesEdit:SetPoint("TOPLEFT", L.labelW + 4, timesY)
    ui.typedHelp = UI.HelpRight(ui.timesEdit, TEXT.times, TEXT.typedHelp)
    for _, e in ipairs({ ui.nameEdit, ui.timesEdit }) do
        e:SetScript("OnEditFocusLost", function()
            ui:Flush()
        end)
    end
    -- the rows, scrolled
    local top = 2 * (L.rowH + 4) + 2
    local bottom = L.footerH + L.statusH + 6
    local scroll = CreateFrame("ScrollFrame", opts.names and opts.names.rows, c, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(scroll.ScrollBar)
    scroll:SetPoint("TOPLEFT", 0, -top)
    scroll:SetPoint("BOTTOMRIGHT", -UI.ScrollGutter(), bottom)
    ui.rowsWidth = opts.width - UI.ScrollGutter()
    ui.child = CreateFrame("Frame", nil, scroll)
    ui.child:SetSize(ui.rowsWidth, 1)
    scroll:SetScrollChild(ui.child)
    ui.scroll = scroll
    -- the status line (the host's), then + Row and Quick fill
    ui.status = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    ui.status:SetPoint("BOTTOMLEFT", 0, L.footerH + 4)
    ui.status:SetWidth(opts.width)
    ui.status:SetJustifyH("LEFT")
    ui.status:SetWordWrap(false)
    ui.addRow = UI.PanelButton(c, TEXT.addRow, L.footerH - 2, function()
        local block = opts.block()
        if block and not opts.readOnly() and Assign.AddRow(block) then
            opts.changed("rows")
        end
    end)
    ui.addRow:SetPoint("BOTTOMLEFT", 0, 0)
    local quick = CreateFrame("CheckButton", nil, c, "UICheckButtonTemplate")
    quick:SetSize(24, 24)
    quick:SetPoint("LEFT", ui.addRow, "RIGHT", 10, 0)
    UI:SkinCheckButton(quick)
    quick:SetScript("OnClick", function(self)
        ui.quickFill = self:GetChecked() and true or false
        if not ui.quickFill then
            ui.selected = nil
        end
        ui:Refresh()
    end)
    ui.quick = quick
    local quickText = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    quickText:SetPoint("LEFT", quick, "RIGHT", 2, 0)
    quickText:SetText(TEXT.quickFill)
    ui.quickText = quickText
    ui.help = UI.HelpRight(quickText, TEXT.helpTitle, TEXT.help)
    return ui
end

-- The palette drag's handlers for this editor's rows (Palette.Drag): a palette chip dropped on a row adds it, a row's
-- chip dropped on another row moves it, a click with Quick fill on adds to the row selected (or selects a row's).
function Block.DragOpts(ui)
    local o = ui.opts
    return {
        readOnly = o.readOnly,
        begin = function(source)
            local block = o.block()
            if not block or o.readOnly() then
                return false
            end
            if source.row then
                local row = block.rows[source.row]
                return row ~= nil and row.tokens[source.index] ~= nil
            end
            return CRT.NoteEditModel.ValidToken(source.token)
        end,
        target = function()
            return ui:Target()
        end,
        highlight = function(target)
            ui:Highlight(target)
        end,
        cancel = function() end,
        drop = function(source, target)
            local block = o.block()
            local ok = false
            if block and target then
                if source.row then
                    ok = Assign.MoveToken(block, source.row, source.index, target)
                else
                    ok = Assign.AddToken(block, target, source.token)
                end
            end
            if ok then
                o.changed("rows")
            else
                ui:Refresh() -- drawn again, so a refused drop leaves nothing half shown
            end
        end,
        click = function(source)
            local block = o.block()
            if not block then
                return
            end
            if source.token then
                if ui.quickFill and ui.selected and Assign.AddToken(block, ui.selected, source.token) then
                    o.changed("rows")
                end
            elseif ui.quickFill then
                ui.selected = source.row
                ui:Refresh()
            end
        end,
        remove = function(chip)
            local s = chip.source
            local block = o.block()
            if s and s.row and block and not o.readOnly() and Assign.RemoveToken(block, s.row, s.index) then
                o.changed("rows")
            end
        end,
    }
end
