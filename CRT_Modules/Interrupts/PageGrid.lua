local ADDON, CRT = ...

-- The Interrupts page's kick list (Interrupts/Page.lua builds it through Page.BuildGrid): one row per group of the
-- setup shown, the note editor's group rows (Notes/Palette.lua: Palette.MakeRow and the Row helpers). A row's label is
-- the group's raid marker, its label and how many of its slots are filled ("3/4"); then its chips, one per kick: the
-- kick number, then the name in class colour, your own outlined, x to take it off. Players are dragged in from the
-- palette on the right (Interrupts/PagePalette.lua), along a row to change the order (a chip dropped on another takes
-- its place), or onto another group's row to move there; a row takes at most its group's slots, so a drop on a full
-- row is refused. "Add name" at a row's end takes a typed name. The order is the kick order and empty slots close up;
-- every change is saved slot by slot (Interrupts:SetName). In a group, the rows are read-only for anyone who can't
-- edit (Page.CanEdit): no drag, no x, no Add name. Past LAYOUT.gridMaxH the rows scroll. The rows are pooled per
-- group, made the first time a setup needs them: Page.rows[g] (row.add, row.hint: its Add name field).

local UI = CRT.UI
local Interrupts = CRT.Interrupts
local Setup = CRT.InterruptSetup
local Palette = CRT.NotePalette
local Page = CRT.InterruptsPage

local TEXT = {
    count = "%d/%d",
    add = "Add name",
}
Page.GridText = TEXT

local LAYOUT = {
    rowGap = 4, -- between two rows
    addW = 90, -- the Add name field
    chipsY = 2, -- the chips' top inside the row
}
Page.GridLayout = LAYOUT

local L = Page.LAYOUT
local PL = Palette.L
local child, scroll
Page.rows = {}

-- The moves -----------------------------------------------------------------------------------------------------------

local function copy(list)
    local out = {}
    for k, v in ipairs(list) do
        out[k] = v
    end
    return out
end

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
-- is { name } from the palette or { g, k } a row's chip; target { g, at } (at: the chip dropped on, which the name
-- takes the place of; nil for the row's end). Returns the groups it changed (g -> their new names), or nil when it is
-- refused (a full row, or a name it has) or changes nothing.
function Page.MoveKick(names, slots, source, target)
    local tg = target and target.g
    if not (tg and names[tg]) then
        return nil
    end
    local into = copy(names[tg])
    local name, from = source.name, nil
    if source.g then
        from = names[source.g] and copy(names[source.g])
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
    -- a name the row has already (case and realm left out, as the note editor's rows do) is refused
    local key = Interrupts.CleanName(name):lower()
    for _, other in ipairs(into) do
        if Interrupts.CleanName(other):lower() == key then
            return nil
        end
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
    if not Page.CanEdit() then
        return false
    end
    local names, slots = rowsNow()
    return names and save(Page.MoveKick(names, slots, source, target)) or false
end

-- Takes a group's kick k off its row.
function Page.RemoveKick(g, k)
    local names = rowsNow()
    if not (Page.CanEdit() and names and names[g] and names[g][k]) then
        return false
    end
    local row = copy(names[g])
    table.remove(row, k)
    return save({ [g] = row })
end

-- The drag ------------------------------------------------------------------------------------------------------------

-- The row (and the chip in it) under the mouse: { g, at }, or nil.
local function target()
    local g, k = Palette.RowUnderMouse(scroll, Page.rows, function()
        return true
    end)
    return g and { g = g, at = k } or nil
end
Page.KickTarget = target

local function highlight(t)
    for g, row in ipairs(Page.rows) do
        if row:IsShown() then
            Palette.HighlightRow(row, t ~= nil and t.g == g)
        end
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
        remove = function(chip)
            local src = chip.source
            if src and src.g then
                Page.RemoveKick(src.g, src.k)
            end
        end,
        cancel = function() end,
    }
end

-- The rows ------------------------------------------------------------------------------------------------------------

local function makeAdd(row, g)
    local edit = CreateFrame("EditBox", nil, row, "InputBoxTemplate")
    edit:SetSize(LAYOUT.addW, PL.chipH)
    edit:SetAutoFocus(false)
    edit:SetFontObject(CRTFontEdit)
    edit:SetMaxLetters(48)
    UI:SkinEditBox(edit)
    local hint = edit:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    hint:SetPoint("LEFT", 4, 0)
    hint:SetText(TEXT.add)
    hint:SetTextColor(UI.Color("muted"))
    edit:SetScript("OnEditFocusGained", function()
        hint:Hide()
    end)
    edit:SetScript("OnEditFocusLost", function(self)
        hint:SetShown((self:GetText() or "") == "")
    end)
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
    row.add, row.hint = edit, hint
end

local function rowOf(g)
    local row = Page.rows[g]
    if not row then
        row = Palette.MakeRow(child)
        makeAdd(row, g)
        Page.rows[g] = row
    end
    return row
end

local function myName()
    local me = UnitName and UnitName("player")
    return type(me) == "string" and me:lower() or nil
end

-- Fills row g with its names (kick order), width wide; returns the row's height.
local function fillRow(def, g, names, width, editable)
    local row = rowOf(g)
    local grp = def.groups[g]
    local icon = Setup.MarkerIcon(grp.marker, 16)
    local count = UI.ColorText(string.format(TEXT.count, #names, grp.slots), #names >= grp.slots and "good" or "muted")
    local w = Palette.RowLabel(row, (icon ~= "" and (icon .. " " .. grp.label) or grp.label) .. "  " .. count, width)
    local me = myName()
    local entries = {}
    for k, name in ipairs(names) do
        entries[k] = { label = UI.ColorText(tostring(k), "heading") .. " " .. name, token = name, class = Page.ClassOf(name),
            source = { g = g, k = k }, removable = editable, selected = me ~= nil and name:lower() == me }
    end
    local addShown = editable and #names < grp.slots
    row.add:SetShown(addShown)
    if addShown and not row.add:HasFocus() then
        row.hint:SetShown((row.add:GetText() or "") == "")
    end
    local extra = addShown and { frame = row.add, width = LAYOUT.addW } or nil
    local h = Palette.RowChips(row, Page.dragState.drag, entries, Palette.RowChipsX(w), width - PL.rowPad, LAYOUT.chipsY, extra)
    Palette.PaintRow(row, editable, false)
    return h + 2 * LAYOUT.chipsY
end

-- The kick list in the shape of the setup shown: the pooled rows it has, the rest hidden.
local function refreshGrid()
    local key = Page.Boss()
    local def = key and Interrupts:Def(key)
    local own = def and Interrupts:Own(key)
    local groups = def and #def.groups or 0
    for g = groups + 1, #Page.rows do
        Page.rows[g]:Hide()
    end
    local editable = Page.CanEdit()
    local y = 0
    for g = 1, groups do
        local row = rowOf(g)
        local h = fillRow(def, g, Page.RowNames(own[g]), L.gridW, editable)
        row:ClearAllPoints()
        row:SetPoint("TOPLEFT", 0, -y)
        row:SetSize(L.gridW, h)
        row:Show()
        y = y + h + LAYOUT.rowGap
    end
    local contentH = groups > 0 and (y - LAYOUT.rowGap) or 0
    local height = math.min(contentH, L.gridMaxH)
    child:SetHeight(math.max(contentH, 1))
    scroll:SetHeight(math.max(height, 1))
    Page.gridHeight, Page.gridContentH = height, contentH
    Page.PlaceBelow(math.max(height, PL.chipH))
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
