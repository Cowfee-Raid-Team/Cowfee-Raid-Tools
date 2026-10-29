local ADDON, CRT = ...

-- The Interrupts page's kick list (Interrupts/Page.lua builds it through Page.BuildGrid): one column per group of the
-- setup shown, headed by the group's raid marker and label, a Kick #N row per slot with a name field and a picker. As
-- many columns side by side as fit, then the next band of columns below; past LAYOUT.gridMaxH the list scrolls. The
-- fields are pooled per place (group g, slot s), made the first time a setup needs them and reused for every other.
-- Page.fields[g][s], Page.slotLabels[g][s] and Page.pickers[g][s] are the pool, Page.headings[g] the headings.
--
-- A slot's picker lists "In your group" (the Addon check's roster), then each Raid Groups layout's players, the
-- layouts as the note editor's Players from lists them (Notes/EditModel.lua: Model.Sources for the layouts in order,
-- Model.Roster for each one's players), class coloured; a name typed in the field works as well.

local UI = CRT.UI
local Interrupts = CRT.Interrupts
local Setup = CRT.InterruptSetup
local Page = CRT.InterruptsPage

local TEXT = {
    kick = "%s #%d",
    fromGroup = "In your group",
    fromLayout = "Raid Groups: %s",
    none = "-",
}
Page.GridText = TEXT

local L = Page.LAYOUT
local child, scroll

local function colorByte(v)
    return math.floor(v * 255 + 0.5)
end

local function colored(name, class)
    local r, g, b = Page.ClassColor(class)
    return string.format("|cff%02x%02x%02x%s|r", colorByte(r), colorByte(g), colorByte(b), name)
end

-- A player's class: the one Raid Groups stored for the name, else the shared class lookup the notes use.
local function classOf(name)
    local cache = CRT.db and CRT.db.classCache
    if type(cache) == "table" then
        local class = cache[name:lower()] or cache[Interrupts.CleanName(name):lower()]
        if class then
            return class
        end
    end
    local Render = CRT.NoteRender
    local lookup = Render and Render.SharedLookup and Render.SharedLookup()
    return lookup and lookup(name) or nil
end

-- The Raid Groups layouts with their players: { { label, entries = { { name, class } } } }, through the note editor's
-- sources (Model.Sources, Model.Roster).
local function layouts()
    local Model, Groups = CRT.NoteEditModel, CRT.Groups
    if not (Model and Model.Sources and Groups and Groups.Presets and Groups.Find) then
        return {}
    end
    local ok, presets = pcall(Groups.Presets, Groups)
    local out = {}
    for _, source in ipairs(Model.Sources(ok and type(presets) == "table" and presets or {}, nil, true)) do
        if source.key ~= Model.SOURCE_GROUP then
            local preset = Groups:Find(source.key)
            local entries = {}
            for _, e in ipairs(Model.Roster(type(preset) == "table" and preset.slots or {}, classOf)) do
                entries[#entries + 1] = { name = Interrupts.CleanName(e.key), class = e.class }
            end
            if #entries > 0 then
                out[#out + 1] = { label = source.label, entries = entries }
            end
        end
    end
    return out
end

-- The picker's choices: an empty one, your group, then each layout, each name once in its section.
function Page.PickerOptions()
    local out = { { key = "", label = TEXT.none } }
    local function section(title, entries)
        if #entries == 0 then
            return
        end
        out[#out + 1] = { key = "title:" .. title, label = title, title = true }
        local seen = {}
        for _, e in ipairs(entries) do
            if e.name ~= "" and not seen[e.name:lower()] then
                seen[e.name:lower()] = true
                out[#out + 1] = { key = e.name, label = colored(e.name, e.class) }
            end
        end
    end
    section(TEXT.fromGroup, Page.Roster())
    for _, layout in ipairs(layouts()) do
        section(string.format(TEXT.fromLayout, layout.label), layout.entries)
    end
    return out
end

-- One slot of the pool, at group g and slot s: its Kick #N label, its name field and its picker.
local function buildSlot(g, s)
    local num = Page.Label(child, "")
    num:SetWidth(L.labelW)
    local edit = CreateFrame("EditBox", nil, child, "InputBoxTemplate")
    edit:SetSize(L.editW, L.fieldH)
    edit:SetAutoFocus(false)
    edit:SetFontObject(CRTFontEdit)
    edit:SetMaxLetters(48)
    UI:SkinEditBox(edit)
    local function save(self)
        if Page.Boss() then
            Interrupts:SetName(Page.Boss(), g, s, self:GetText())
        end
    end
    edit:SetScript("OnEnterPressed", function(self)
        self:ClearFocus()
        save(self)
    end)
    edit:SetScript("OnEditFocusLost", save)
    edit:SetScript("OnEscapePressed", function(self)
        self:ClearFocus()
    end)
    local pick = UI.Dropdown(child, "", { labelWidth = 0, width = L.pickW, maxHeight = L.pickMenuH,
        options = Page.PickerOptions,
        get = function()
            local own = Page.Boss() and Interrupts:Own(Page.Boss())
            return own and own[g] and own[g][s] or ""
        end,
        set = function(name)
            if Page.Boss() then
                Interrupts:SetName(Page.Boss(), g, s, name)
            end
        end,
        enabledIf = Page.CanEdit })
    Page.fields[g] = Page.fields[g] or {}
    Page.slotLabels[g] = Page.slotLabels[g] or {}
    Page.pickers[g] = Page.pickers[g] or {}
    Page.fields[g][s], Page.slotLabels[g][s], Page.pickers[g][s] = edit, num, pick
end

local function heading(g)
    local head = Page.headings[g]
    if not head then
        head = Page.Label(child, "", "CRTFontNormal")
        Page.headings[g] = head
    end
    return head
end

-- Places and fills one slot for the setup shown.
local function showSlot(def, own, g, s, x, y, group, editable)
    if not (Page.fields[g] and Page.fields[g][s]) then
        buildSlot(g, s)
    end
    local num, edit, pick = Page.slotLabels[g][s], Page.fields[g][s], Page.pickers[g][s]
    local top = y - L.headH - (s - 1) * L.rowH
    num:ClearAllPoints()
    num:SetPoint("TOPLEFT", x, top - 4)
    edit:ClearAllPoints()
    edit:SetPoint("TOPLEFT", x + L.editX, top)
    pick:ClearAllPoints()
    pick:SetPoint("TOPLEFT", x + L.pickX, top + L.pickDY)
    num:SetText(string.format(TEXT.kick, def.label, s))
    local name = own[g][s] or ""
    if not edit:HasFocus() then
        edit:SetText(name)
    end
    local m = Page.MemberOf(name, group)
    edit:SetTextColor(Page.ClassColor(m and m.class))
    edit:SetEnabled(editable)
    pick.refresh()
    num:Show()
    edit:Show()
    pick:Show()
end

-- How many columns sit side by side.
function Page.GridColumns()
    return math.max(1, math.floor(L.gridW / L.colW))
end

-- The kick list in the shape of the setup shown: the pooled fields it has, the rest hidden.
local function refreshGrid()
    local key = Page.Boss()
    local def = key and Interrupts:Def(key)
    local own = def and Interrupts:Own(key)
    local groups = def and #def.groups or 0
    -- everything hidden first, then what the setup has shown again
    for g, head in pairs(Page.headings) do
        head:SetShown(false)
    end
    for g, col in pairs(Page.fields) do
        for s, edit in pairs(col) do
            edit:Hide()
            Page.slotLabels[g][s]:Hide()
            Page.pickers[g][s]:Hide()
        end
    end
    local cols = Page.GridColumns()
    local bandH = L.headH + (def and Setup.MaxSlots(def) or 0) * L.rowH + L.bandGap
    local group, editable = Page.Roster(), Page.CanEdit()
    for g = 1, groups do
        local grp = def.groups[g]
        local x, y = ((g - 1) % cols) * L.colW, -math.floor((g - 1) / cols) * bandH
        local head = heading(g)
        head:ClearAllPoints()
        head:SetPoint("TOPLEFT", x, y)
        local icon = Setup.MarkerIcon(grp.marker, 16)
        head:SetText(icon ~= "" and (icon .. " " .. grp.label) or grp.label)
        head:Show()
        for s = 1, grp.slots do
            showSlot(def, own, g, s, x, y, group, editable)
        end
    end
    if Page.gridHelp then
        Page.gridHelp:SetShown(groups > 0) -- its (?) goes with the first heading
    end
    local contentH = groups > 0 and (math.ceil(groups / cols) * bandH - L.bandGap) or 0
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
    -- the first heading carries the list's (?)
    Page.gridHelp = UI.HelpRight(heading(1), Page.TEXT.title, Page.TEXT.gridHelp)
    Page.AddControl({ refresh = refreshGrid })
end
