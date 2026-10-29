local ADDON, CRT = ...

-- The note editor's palette and chips, shared by the note editor (Notes/EditorWindow.lua) and the Mech Alerts Assign
-- tab (Notes/AssignTab.lua), so both look and work the same: Search, Players from (the current group, a note's invite
-- list or a saved Raid Groups layout), the players with their class icons and colours, then General, Groups and
-- Classes, each a chip; a drag of a chip onto a row, x to remove a row's chip. The sections and the sources are
-- Notes/EditModel.lua's (Model.Palette, Model.Sources, Model.Roster); this file draws them. A host keeps its own state
-- table, which these fill:
--   Palette.Build(parent, state, opts)  the right-hand side: state.search, state.from, state.paletteChild,
--                                       state.paletteScroll. opts: width, names = { search, scroll } (global names),
--                                       choices(), get(), set(key) for Players from, onSearch() (redraw)
--   Palette.Draw(state, roster, width)  the chips for the roster (Palette.Roster), under state.query
--   Palette.Drag(state, opts)           a drag of chips: state.driver, state.ghost, state.press. opts: readOnly(),
--                                       begin(source), target() (the row under the mouse, or nil), highlight(target),
--                                       drop(source, target), click(source, chip), remove(chip), cancel()
--   Palette.MakeChip(parent, drag), Palette.FillChip(b, entry, source, removable, icon), Palette.Flow(...)
--   Palette.Roster(from, inviteNames, classOf), Palette.Choices(linkedId, noInvite), Palette.ValidSource(from, ...)
-- A drag is the mouse's own: OnMouseDown on a chip, a driver frame's OnUpdate that starts it past a few pixels and
-- moves the ghost, OnMouseUp to drop it on the row under the mouse; Escape cancels it.

local UI = CRT.UI
local Model = CRT.NoteEditModel

local Palette = {}
CRT.NotePalette = Palette

local TEXT = {
    search = "Search",
    playersFrom = "Players from",
    sections = { players = "Players", general = "General", groups = "Groups", classes = "Classes" },
}
Palette.TEXT = TEXT

local L = {
    searchH = 22, fromH = 32, fromLabelW = 78,
    fromGap = 5, -- UI.Dropdown's gap between its label and the dropdown (UI/Controls.lua)
    chipH = 18, chipGap = 4, chipPad = 6, iconW = 16, removeW = 14, headingH = 20, sectionGap = 8,
    dragStart = 4, -- pixels the mouse moves with the button down before a press becomes a drag
}
Palette.L = L

local BACKDROP = { bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 }
Palette.BACKDROP = BACKDROP

-- The class colour of a chip, or nil. Not a theme colour: the game's class colours.
function Palette.ClassRGB(class)
    local c = class and RAID_CLASS_COLORS and RAID_CLASS_COLORS[class]
    if c then
        return c.r, c.g, c.b
    end
    return nil
end

-- Chips ------------------------------------------------------------------------------------------------------------

function Palette.PaintChip(b, selected)
    b:SetBackdropColor(UI.Color("surface", 0.95))
    b:SetBackdropBorderColor(UI.Color(selected and "heading" or "border"))
    local r, g, bl = Palette.ClassRGB(b.class)
    if r then
        b.text:SetTextColor(r, g, bl) -- not a theme colour: the class colour
    else
        b.text:SetTextColor(UI.Color("text"))
    end
    b.remove.text:SetTextColor(UI.Color("muted"))
end

-- A chip whose mouse goes to a drag (Palette.Drag): a press, a drag, a click, x.
function Palette.MakeChip(parent, drag)
    local b = CreateFrame("Button", nil, parent, "BackdropTemplate")
    b:SetBackdrop(BACKDROP)
    b:SetHeight(L.chipH)
    b.icon = b:CreateTexture(nil, "ARTWORK")
    b.icon:SetSize(L.chipH - 4, L.chipH - 4)
    b.icon:SetPoint("LEFT", 2, 0)
    b.text = b:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    b.text:SetWordWrap(false)
    b.remove = CreateFrame("Button", nil, b)
    b.remove:SetSize(L.removeW, L.chipH)
    b.remove:SetPoint("RIGHT", 0, 0)
    b.remove.text = b.remove:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    b.remove.text:SetPoint("CENTER", 0, 1)
    b.remove.text:SetText("x")
    b.remove:SetScript("OnClick", function()
        drag:Remove(b)
    end)
    b:EnableMouse(true)
    b:SetScript("OnMouseDown", function(self, button)
        drag:Down(self, button)
    end)
    b:SetScript("OnMouseUp", function(self, button)
        drag:Up(self, button)
    end)
    return b
end

-- Fills a chip: entry { label, class }, source (what a drag carries), removable (a row's chip that can be removed),
-- icon (a player's or class's class icon). Returns its width.
function Palette.FillChip(b, entry, source, removable, icon)
    b.source, b.class, b.token = source, entry.class, entry.token
    b.text:SetText(entry.label)
    local left = L.chipPad
    b.icon:Hide()
    if icon and entry.class and GetClassAtlas then
        local ok, atlas = pcall(GetClassAtlas, entry.class)
        if ok and type(atlas) == "string" and pcall(b.icon.SetAtlas, b.icon, atlas) then
            b.icon:Show()
            left = L.iconW + 2
        end
    end
    b.text:ClearAllPoints()
    b.text:SetPoint("LEFT", left, 0)
    b.remove:SetShown(removable)
    local w = left + math.ceil(b.text:GetStringWidth() or 0) + (removable and L.removeW or L.chipPad)
    b:SetWidth(w)
    Palette.PaintChip(b)
    b:Show()
    return w
end

-- Lays chips out left to right from x0, wrapping at width, from y0 down. Returns the height used.
function Palette.Flow(chips, widths, x0, width, y0)
    local x, y = x0, y0
    for k, chip in ipairs(chips) do
        local w = widths[k]
        if x > x0 and x + w > width then
            x, y = x0, y + L.chipH + L.chipGap
        end
        chip:ClearAllPoints()
        chip:SetPoint("TOPLEFT", x, -y)
        x = x + w + L.chipGap
    end
    return (#chips > 0) and (y - y0 + L.chipH) or 0
end

-- Where the players come from --------------------------------------------------------------------------------------

-- The live group out of combat (where its names may be secret, nothing): Groups:ReadRoster.
function Palette.LiveRoster()
    local Groups = CRT.Groups
    if (InCombatLockdown and InCombatLockdown()) or not (Groups and Groups.ReadRoster) then
        return {}
    end
    local ok, list = pcall(Groups.ReadRoster, Groups)
    return ok and type(list) == "table" and list or {}
end

-- A saved Raid Groups layout by its id (Groups:Find), or nil.
function Palette.FindLayout(id)
    local Groups = CRT.Groups
    if id == nil or not (Groups and Groups.Find) then
        return nil
    end
    local preset = Groups:Find(id)
    return type(preset) == "table" and preset or nil
end

-- The choices of the Players from dropdown (Model.Sources): linkedId the note's linked layout (listed first), noInvite
-- when there is no invite list to offer.
function Palette.Choices(linkedId, noInvite)
    local Groups = CRT.Groups
    local ok, layouts = false, nil
    if Groups and Groups.Presets then
        ok, layouts = pcall(Groups.Presets, Groups)
    end
    return Model.Sources(ok and type(layouts) == "table" and layouts or {}, linkedId, noInvite)
end

-- Whether a source can still be listed: the group, the invite list (unless noInvite), or a layout that still exists.
function Palette.ValidSource(from, noInvite)
    if from == Model.SOURCE_GROUP then
        return true
    elseif from == Model.SOURCE_INVITE then
        return not noInvite
    end
    return from ~= nil and Palette.FindLayout(from) ~= nil
end

-- A player's class: the one stored for that name (Raid Groups keeps it), else classOf (the shared class lookup Render
-- uses).
function Palette.PlayerClass(name, classOf)
    local cache = CRT.db and CRT.db.classCache
    local Groups = CRT.Groups
    if cache then
        local class = cache[name:lower()]
        if not class and Groups and Groups.Normalize then
            local ok, key = pcall(Groups.Normalize, name)
            class = ok and type(key) == "string" and cache[key:lower()] or nil
        end
        if class then
            return class
        end
    end
    return classOf and classOf(name) or nil
end

-- A player's last role seen (Groups.CachedRole), for the role order.
function Palette.PlayerRole(name)
    local Groups = CRT.Groups
    if not (Groups and Groups.CachedRole) then
        return nil
    end
    local role = Groups.CachedRole(name)
    if not role and Groups.Normalize then
        local ok, key = pcall(Groups.Normalize, name)
        role = ok and type(key) == "string" and Groups.CachedRole(key) or nil
    end
    return role
end

-- The shared class lookup (Notes/Render.lua), memoised there until the names it knows change.
function Palette.ClassLookup()
    return CRT.NoteRender and CRT.NoteRender.SharedLookup and CRT.NoteRender.SharedLookup() or nil
end

-- The palette's players from a source: the group, the invite list (inviteNames()) or a layout.
function Palette.Roster(from, inviteNames, classOf)
    from = from or Model.SOURCE_GROUP
    if from == Model.SOURCE_GROUP then
        return Palette.LiveRoster()
    end
    local function class(name)
        return Palette.PlayerClass(name, classOf)
    end
    if from == Model.SOURCE_INVITE then
        return Model.Roster(inviteNames and inviteNames() or {}, class, Palette.PlayerRole)
    end
    local preset = Palette.FindLayout(from)
    return Model.Roster(preset and preset.slots or {}, class, Palette.PlayerRole)
end

-- The palette ----------------------------------------------------------------------------------------------------

local function heading(state, n)
    local h = state.headings[n]
    if not h then
        h = state.paletteChild:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
        state.headings[n] = h
    end
    return h
end

-- The chips for a roster (Model.Palette's sections, under state.query), width wide.
function Palette.Draw(state, roster, width)
    if state.press and state.drag then
        state.drag:Cancel() -- its chip is about to be filled with another entry
    end
    local sections = Model.Palette(roster, state.query)
    local used, y = 0, 0
    for n, section in ipairs(sections) do
        local h = heading(state, n)
        h:ClearAllPoints()
        h:SetPoint("TOPLEFT", 2, -y)
        h:SetText(TEXT.sections[section.key])
        h:SetTextColor(UI.Color("heading"))
        h:Show()
        y = y + L.headingH
        local list, widths = {}, {}
        for _, entry in ipairs(section.entries) do
            used = used + 1
            local chip = state.paletteChips[used] or Palette.MakeChip(state.paletteChild, state.drag)
            state.paletteChips[used] = chip
            local icon = section.key == "players" or section.key == "classes"
            widths[#widths + 1] = Palette.FillChip(chip, entry, { token = entry.token, kind = section.kind }, false, icon)
            list[#list + 1] = chip
        end
        y = y + Palette.Flow(list, widths, 2, width, y) + L.sectionGap
    end
    for k = used + 1, #state.paletteChips do
        state.paletteChips[k]:Hide()
    end
    state.paletteChild:SetHeight(math.max(1, y))
end

-- Search, Players from and the chips' scroll area, in a frame `width` wide filling parent's height (opts.top and
-- opts.bottom: its insets). Returns that frame.
function Palette.Build(parent, state, opts)
    state.paletteChips, state.headings = state.paletteChips or {}, state.headings or {}
    local width = opts.width
    local names = opts.names or {}
    local right = CreateFrame("Frame", nil, parent)
    right:SetWidth(width)
    local label = right:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    label:SetPoint("TOPLEFT", 2, -4)
    label:SetText(TEXT.search)
    local search = CreateFrame("EditBox", names.search, right, "InputBoxTemplate")
    search:SetAutoFocus(false)
    UI:SkinEditBox(search)
    search:SetFontObject(CRTFontHighlight)
    search:SetHeight(L.searchH)
    search:SetPoint("LEFT", label, "RIGHT", 10, 0)
    search:SetPoint("RIGHT", right, "RIGHT", -4, 0)
    search:SetScript("OnTextChanged", function(self, user)
        if user then
            state.query = strtrim(self:GetText() or "")
            opts.onSearch()
        end
    end)
    search:SetScript("OnEscapePressed", function(self)
        self:ClearFocus()
    end)
    state.search = search
    -- Players from: the group, the note's invite list or a saved Raid Groups layout
    local from = UI.Dropdown(right, TEXT.playersFrom, {
        labelWidth = L.fromLabelW, width = width - L.fromLabelW - L.fromGap - 4,
        options = opts.choices,
        get = opts.get,
        set = opts.set,
    })
    from:SetPoint("TOPLEFT", 2, -(L.searchH + 6))
    state.from = from
    local scroll = CreateFrame("ScrollFrame", names.scroll, right, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(scroll.ScrollBar)
    scroll:SetPoint("TOPLEFT", 0, -(L.searchH + 6 + L.fromH + 2))
    scroll:SetPoint("BOTTOMRIGHT", -UI.ScrollGutter(), 0)
    state.paletteChild = CreateFrame("Frame", nil, scroll)
    state.paletteChild:SetSize(width - UI.ScrollGutter(), 1)
    scroll:SetScrollChild(state.paletteChild)
    state.paletteScroll = scroll
    return right
end

-- The chips' width inside a palette `width` wide.
function Palette.InnerWidth(width)
    return (width - UI.ScrollGutter()) - 4
end

-- Drag and drop ----------------------------------------------------------------------------------------------------

local Drag = {}
Drag.__index = Drag

local function cursor()
    local x, y = GetCursorPosition()
    local scale = UIParent:GetEffectiveScale() or 1
    return x / scale, y / scale
end

-- The keys while dragging, for Escape: out of combat only, where letting the other keys through can be changed.
function Drag:CatchKeys(on)
    local state = self.state
    local d = state.driver
    if on and not (InCombatLockdown and InCombatLockdown()) then
        if d.SetPropagateKeyboardInput then
            pcall(d.SetPropagateKeyboardInput, d, true)
        end
        d:EnableKeyboard(true)
        state.keys = true
    elseif state.keys then
        d:EnableKeyboard(false)
        state.keys = false
    end
end

function Drag:EndPress()
    local state = self.state
    state.press = nil
    if state.ghost then
        state.ghost:Hide()
    end
    if state.driver then
        self:CatchKeys(false)
        state.driver:Hide()
    end
end

-- Ends a press or a drag with no drop.
function Drag:Cancel()
    if not self.state.press then
        return
    end
    self.opts.cancel()
    self:EndPress()
    self.opts.highlight(nil)
end

function Drag:Update()
    local state = self.state
    local p = state.press
    if not p then
        state.driver:Hide()
        return
    end
    -- the button let go where the chip never heard it (its frame hidden or redrawn): the press ends, no drop
    if IsMouseButtonDown and not IsMouseButtonDown("LeftButton") then
        self:Cancel()
        return
    end
    local x, y = cursor()
    if not p.dragging then
        if math.abs(x - p.x) + math.abs(y - p.y) < L.dragStart then
            return
        end
        if not self.opts.begin(p.source) then
            self:EndPress()
            return
        end
        p.dragging = true
        local g = state.ghost
        g.text:SetText(p.chip.text:GetText() or "")
        g:SetWidth(math.ceil(g.text:GetStringWidth() or 0) + 2 * L.chipPad)
        local r, gr, b = Palette.ClassRGB(p.chip.class)
        if r then
            g.text:SetTextColor(r, gr, b) -- not a theme colour: the class colour
        else
            g.text:SetTextColor(UI.Color("text"))
        end
        g:Show()
        self:CatchKeys(true)
    end
    state.ghost:ClearAllPoints()
    state.ghost:SetPoint("CENTER", UIParent, "BOTTOMLEFT", x, y)
    self.opts.highlight(self.opts.target())
end

function Drag:Down(chip, button)
    if button ~= "LeftButton" or self.opts.readOnly() or not chip.source then
        return
    end
    local x, y = cursor()
    self.state.press = { chip = chip, source = chip.source, x = x, y = y }
    self.state.driver:Show()
end

function Drag:Up(chip)
    local p = self.state.press
    if not p or p.chip ~= chip then
        return
    end
    self:EndPress()
    if p.dragging then
        self.opts.drop(p.source, self.opts.target())
    else
        self.opts.click(p.source, chip)
    end
end

function Drag:Remove(chip)
    self.opts.remove(chip)
end

-- A drag for the chips of one host (state: its own table; the driver, ghost and press go in it).
function Palette.Drag(state, opts)
    local self = setmetatable({ state = state, opts = opts }, Drag)
    state.drag = self
    state.driver = CreateFrame("Frame", nil, UIParent)
    state.driver:SetSize(1, 1)
    state.driver:Hide()
    state.driver:SetScript("OnUpdate", function()
        self:Update()
    end)
    state.driver:SetScript("OnKeyDown", function(d, key)
        local escape = key == "ESCAPE"
        if d.SetPropagateKeyboardInput and not (InCombatLockdown and InCombatLockdown()) then
            pcall(d.SetPropagateKeyboardInput, d, not escape)
        end
        if escape then
            self:Cancel()
        end
    end)
    local g = CreateFrame("Frame", nil, UIParent, "BackdropTemplate")
    g:SetBackdrop(BACKDROP)
    g:SetFrameStrata("TOOLTIP")
    g:SetHeight(L.chipH)
    g.text = g:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    g.text:SetPoint("LEFT", L.chipPad, 0)
    UI.Tint(g, "SetBackdropColor", "surface", 0.95)
    UI.Tint(g, "SetBackdropBorderColor", "accent")
    g:Hide()
    state.ghost = g
    return self
end
