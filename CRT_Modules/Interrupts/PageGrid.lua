local ADDON, CRT = ...

-- The Interrupts page's kick list (Interrupts/Page.lua builds it through Page.BuildGrid): one column per group of the
-- setup shown, headed by the group's raid marker, its label and how many of its slots are filled ("3/4"), over one
-- ordered row of chips, the note editor's chips (Notes/Palette.lua). A chip is a kick: its number, then the name in
-- class colour; your own is outlined; its x (UI.PanelButton) takes it off. Players are dragged in from the palette on
-- the right (Interrupts/PagePalette.lua), along a row to change the order, or onto another group's row to move there;
-- a row takes at most its group's slots, so a drop on a full row is refused. "Add name" at a row's end takes a typed
-- name. The order is the kick order and empty slots close up; every change is saved slot by slot (Interrupts:SetName).
-- In a group, the rows are read-only for anyone who can't edit (Page.CanEdit): no drag, no x, no Add name.
-- As many columns side by side as fit, then the next band below; past LAYOUT.gridMaxH the list scrolls. The rows and
-- their chips are pooled per group, made the first time a setup needs them and reused for every other:
-- Page.rows[g] = { head, zone, add, hint, chips = { ... } }.

local UI = CRT.UI
local Interrupts = CRT.Interrupts
local Setup = CRT.InterruptSetup
local Palette = CRT.NotePalette
local Page = CRT.InterruptsPage

local TEXT = {
    count = "%d/%d",
    remove = "x",
    removeHelp = "Take %s off",
    add = "Add name",
}
Page.GridText = TEXT

-- The chips' row, inside each group's column (the grid's own places are Page.LAYOUT's).
local LAYOUT = {
    zonePad = 4, -- the row's edge to its chips
    colGap = 10, -- between two columns' rows
    addW = 90, -- the Add name field
}
Page.GridLayout = LAYOUT

local L = Page.LAYOUT
local PL = Palette.L
local child, scroll
Page.rows = {}

-- The moves -----------------------------------------------------------------------------------------------------------

-- A group's names in kick order, empty slots closed up.
function Page.RowNames(column)
    local out = {}
    for _, name in ipairs(column or {}) do
        if name ~= "" then
            out[#out + 1] = name
        end
    end
    return out
end

-- A drop on the rows. names[g] are the groups' names in order (Page.RowNames), slots[g] how many each takes; source
-- is { name } from the palette or { g, k } a row's chip; target { g, at } (at: the chip dropped on, nil for the
-- row's end). Returns the groups it changed (g -> their new names), or nil when it is refused or changes nothing.
function Page.MoveKick(names, slots, source, target)
    local tg = target and target.g
    if not (tg and names[tg]) then
        return nil
    end
    local into = { unpack(names[tg]) }
    local name, from = source.name, nil
    if source.g then
        from = names[source.g] and { unpack(names[source.g]) }
        name = from and from[source.k]
        if not name then
            return nil
        end
        if source.g == tg then
            from = nil
            if target.at == source.k or (not target.at and source.k == #into) then
                return nil
            end
            table.remove(into, source.k)
        end
    end
    if type(name) ~= "string" or name == "" or #into >= (slots[tg] or 0) then
        return nil -- the row is full
    end
    local at = target.at and math.min(target.at, #into + 1) or (#into + 1)
    table.insert(into, at, name)
    local out = { [tg] = into }
    if from then
        table.remove(from, source.k)
        out[source.g] = from
    end
    return out
end

-- Saves the changed groups' names into your own list, slot by slot, the rest of each row emptied.
local function save(changed)
    local key = Page.Boss()
    local def = key and Interrupts:Def(key)
    if not (def and changed) then
        return false
    end
    for g, names in pairs(changed) do
        local grp = def.groups[g]
        for s = 1, grp and grp.slots or 0 do
            Interrupts:SetName(key, g, s, names[s] or "")
        end
    end
    return true
end

local function rowsNow()
    local key = Page.Boss()
    local def = key and Interrupts:Def(key)
    local own = def and Interrupts:Own(key)
    if not own then
        return nil
    end
    local names, slots = {}, {}
    for g, grp in ipairs(def.groups) do
        names[g], slots[g] = Page.RowNames(own[g]), grp.slots
    end
    return names, slots
end

-- Drops a source on a target; true when it was saved.
function Page.DropKick(source, target)
    local names, slots = rowsNow()
    return names and save(Page.MoveKick(names, slots, source, target)) or false
end

-- Takes a group's kick k off its row.
function Page.RemoveKick(g, k)
    local names = rowsNow()
    if not (names and names[g] and names[g][k]) then
        return false
    end
    local row = { unpack(names[g]) }
    table.remove(row, k)
    return save({ [g] = row })
end

-- The drag ------------------------------------------------------------------------------------------------------------

-- The row (and the chip in it) under the mouse: { g, at }, or nil.
local function target()
    if not (scroll and scroll:IsShown() and scroll:IsMouseOver()) then
        return nil
    end
    for g, row in pairs(Page.rows) do
        if row.zone:IsShown() and row.zone:IsMouseOver() then
            for k, chip in ipairs(row.chips) do
                if chip:IsShown() and chip:IsMouseOver() then
                    return { g = g, at = k }
                end
            end
            return { g = g }
        end
    end
    return nil
end
Page.KickTarget = target

local function highlight(t)
    for g, row in pairs(Page.rows) do
        row.zone:SetBackdropBorderColor(UI.Color((t and t.g == g) and "accent" or "border"))
    end
end

local function dragOpts()
    return {
        readOnly = function()
            return not (Page.Boss() and Page.CanEdit())
        end,
        begin = function(source)
            return Page.Boss() ~= nil and Page.CanEdit() and (source.name ~= nil or source.g ~= nil)
        end,
        target = target,
        highlight = highlight,
        drop = function(source, t)
            highlight(nil)
            if not Page.DropKick(source, t) then
                Page.Refresh() -- drawn again, so a refused drop leaves nothing half shown
            end
        end,
        click = function() end,
        remove = function() end,
        cancel = function() end,
    }
end

-- The rows ------------------------------------------------------------------------------------------------------------

local function makeAdd(zone, g)
    local edit = CreateFrame("EditBox", nil, zone, "InputBoxTemplate")
    edit:SetSize(LAYOUT.addW, PL.chipH)
    edit:SetAutoFocus(false)
    edit:SetFontObject(CRTFontEdit)
    edit:SetMaxLetters(48)
    UI:SkinEditBox(edit)
    local hint = edit:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    hint:SetPoint("LEFT", 4, 0)
    hint:SetText(TEXT.add)
    hint:SetTextColor(UI.Color("muted"))
    local function showHint(self)
        hint:SetShown((self:GetText() or "") == "" and not self:HasFocus())
    end
    edit:SetScript("OnEditFocusGained", function()
        hint:Hide()
    end)
    edit:SetScript("OnEditFocusLost", showHint)
    edit:SetScript("OnEnterPressed", function(self)
        local name = strtrim(self:GetText() or "")
        self:SetText("")
        self:ClearFocus()
        if name ~= "" then
            Page.DropKick({ name = Interrupts.CleanName(name) }, { g = g })
        end
    end)
    edit:SetScript("OnEscapePressed", function(self)
        self:SetText("")
        self:ClearFocus()
    end)
    return edit, hint
end

local function rowOf(g)
    local row = Page.rows[g]
    if row then
        return row
    end
    local zone = CreateFrame("Frame", nil, child, "BackdropTemplate")
    zone:SetBackdrop(Palette.BACKDROP)
    UI.Tint(zone, "SetBackdropColor", "surface", 0.4)
    zone:SetBackdropBorderColor(UI.Color("border"))
    row = { head = Page.Label(child, "", "CRTFontNormal"), zone = zone, chips = {} }
    row.add, row.hint = makeAdd(zone, g)
    Page.rows[g] = row
    return row
end

-- A chip of row g: the note editor's chip, with its own x.
local function chipOf(row, g, k)
    local chip = row.chips[k]
    if chip then
        return chip
    end
    chip = Palette.MakeChip(row.zone, Page.dragState.drag)
    chip.kickX = UI.PanelButton(chip, TEXT.remove, PL.chipH, function(self)
        local c = self:GetParent()
        if c.slot then
            Page.RemoveKick(c.slot.g, c.slot.k)
        end
    end)
    chip.kickX:SetPoint("RIGHT", 0, 0)
    row.chips[k] = chip
    return chip
end

local function myName()
    local me = UnitName and UnitName("player")
    return type(me) == "string" and me:lower() or nil
end

-- Fills row g with names (kick order) and lays its chips out; returns the row's height.
local function fillRow(def, g, names, width, editable)
    local row = rowOf(g)
    local grp = def.groups[g]
    local icon = Setup.MarkerIcon(grp.marker, 16)
    local count = UI.ColorText(string.format(TEXT.count, #names, grp.slots), #names >= grp.slots and "good" or "muted")
    row.head:SetText((icon ~= "" and (icon .. " " .. grp.label) or grp.label) .. "  " .. count)
    local me = myName()
    local list, widths = {}, {}
    for k, name in ipairs(names) do
        local chip = chipOf(row, g, k)
        local label = UI.ColorText(tostring(k), "heading") .. " " .. name
        local w = Palette.FillChip(chip, { label = label, class = Page.ClassOf(name) }, { g = g, k = k }, false, false)
        chip.slot, chip.name = { g = g, k = k }, name
        chip.kickX:SetShown(editable)
        if editable then
            w = w + chip.kickX:GetWidth()
            chip:SetWidth(w)
        end
        Palette.PaintChip(chip, me ~= nil and name:lower() == me)
        chip.mine = me ~= nil and name:lower() == me
        list[#list + 1], widths[#widths + 1] = chip, w
    end
    for k = #names + 1, #row.chips do
        row.chips[k]:Hide()
        row.chips[k].slot = nil
    end
    local addShown = editable and #names < grp.slots
    row.add:SetShown(addShown)
    if addShown then
        list[#list + 1], widths[#widths + 1] = row.add, LAYOUT.addW
        if not row.add:HasFocus() then
            row.hint:SetShown((row.add:GetText() or "") == "")
        end
    end
    local used = Palette.Flow(list, widths, LAYOUT.zonePad, width - LAYOUT.zonePad, LAYOUT.zonePad)
    return math.max(used, PL.chipH) + 2 * LAYOUT.zonePad
end

-- How many columns sit side by side.
function Page.GridColumns()
    return math.max(1, math.floor(L.gridW / L.colW))
end

-- The kick list in the shape of the setup shown: the pooled rows it has, the rest hidden.
local function refreshGrid()
    local key = Page.Boss()
    local def = key and Interrupts:Def(key)
    local own = def and Interrupts:Own(key)
    local groups = def and #def.groups or 0
    for g, row in pairs(Page.rows) do
        if g > groups then
            row.head:Hide()
            row.zone:Hide()
        end
    end
    local cols, editable = Page.GridColumns(), Page.CanEdit()
    local zoneW = L.colW - LAYOUT.colGap
    local heights = {}
    for g = 1, groups do
        heights[g] = fillRow(def, g, Page.RowNames(own[g]), zoneW, editable)
    end
    -- each band as tall as its tallest row
    local y = 0
    for first = 1, groups, cols do
        local bandH = 0
        for g = first, math.min(groups, first + cols - 1) do
            bandH = math.max(bandH, heights[g])
        end
        for g = first, math.min(groups, first + cols - 1) do
            local row, x = Page.rows[g], ((g - 1) % cols) * L.colW
            row.head:ClearAllPoints()
            row.head:SetPoint("TOPLEFT", x, -y)
            row.head:Show()
            row.zone:ClearAllPoints()
            row.zone:SetPoint("TOPLEFT", x, -y - L.headH)
            row.zone:SetSize(zoneW, heights[g])
            row.zone:Show()
        end
        y = y + L.headH + bandH + L.bandGap
    end
    highlight(nil)
    local contentH = groups > 0 and (y - L.bandGap) or 0
    local height = math.min(contentH, L.gridMaxH)
    child:SetHeight(math.max(contentH, 1))
    scroll:SetHeight(math.max(height, 1))
    Page.gridHeight, Page.gridContentH = height, contentH
    Page.PlaceBelow(math.max(height, L.headH))
end
Page.RefreshGrid = refreshGrid

function Page.BuildGrid(f)
    scroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsKickListScroll", f, "UIPanelScrollFrameTemplate")
    if UI.SkinScrollBar and scroll.ScrollBar then
        UI:SkinScrollBar(scroll.ScrollBar)
    end
    scroll:SetPoint("TOPLEFT", L.leftX, L.gridY)
    scroll:SetSize(L.gridW, L.gridMaxH)
    child = CreateFrame("Frame", nil, scroll)
    child:SetSize(L.gridW, 1)
    scroll:SetScrollChild(child)
    Page.gridScroll, Page.gridChild = scroll, child
    -- one drag for the rows' chips and the palette's (Interrupts/PagePalette.lua)
    Page.dragState = { paletteChips = {}, headings = {} }
    Palette.Drag(Page.dragState, dragOpts())
    f:HookScript("OnHide", function()
        Page.dragState.drag:Cancel()
    end)
    Page.AddControl({ refresh = refreshGrid })
end
