local ADDON, CRT = ...

-- The Interrupts page's players (Interrupts/Page.lua builds it through Page.BuildPalette): the panel on the right of
-- Assignments, "In your group" (the Addon check's roster), then each Raid Groups layout's players, as the note editor's
-- chips (Notes/Palette.lua: Palette.DrawSections), class coloured with their class icons. A chip dragged onto a group's
-- row fills its next slot (Interrupts/PageGrid.lua takes the drop).
--
-- The group and the layouts are worked out once and kept (Page.Cache) until the group changes (GROUP_ROSTER_UPDATE), a
-- Raid Groups layout changes (Groups:OnChange), combat or a pull ends (PLAYER_REGEN_ENABLED, ENCOUNTER_END: a name read
-- as secret can be read again) or another boss is shown (Page.ClearCache); a group read with a name or class unreadable
-- is read again on the next draw. The page, its rows, the palette and Who has it all read the same copy. Page.counts
-- counts the work, for the harness and /crt dev kicks perf.
-- The layouts read the note editor's sources (Notes/EditModel.lua: Model.Sources for the layouts in order, Model.Roster
-- for each one's players).

local UI = CRT.UI
local Interrupts = CRT.Interrupts
local Palette = CRT.NotePalette
local Page = CRT.InterruptsPage

local TEXT = {
    players = "Players",
    playersHelp = "Drag a player onto a group's row to give them its next kick. Drag a name along its row to change the order, or onto another group's row to move it there. Click x on a name to take it off.\n\nIn a group, only the raid leader and assistants can change the list. Solo, the list is yours to test with.",
    fromGroup = "In your group",
    fromLayout = "Raid Groups: %s",
}
Page.PaletteText = TEXT

local LAYOUT = {
    headY = -8, scrollTop = -32, bottom = 8,
}
Page.PaletteLayout = LAYOUT

local L = Page.LAYOUT

Page.counts = { roster = 0, layouts = 0, refresh = 0, note = 0 }
local cache -- { roster, byName, layouts }, or nil until asked again

-- A player's class: the one Raid Groups stored for the name, else the shared class lookup the notes use.
local function classOf(name)
    local stored = CRT.db and CRT.db.classCache
    if type(stored) == "table" then
        local class = stored[name:lower()] or stored[Interrupts.CleanName(name):lower()]
        if class then
            return class
        end
    end
    local lookup = Palette.ClassLookup()
    return lookup and lookup(name) or nil
end

-- How many the group has, or nil when the game can't say.
local function groupSize()
    local ok, n
    if IsInRaid and IsInRaid() then
        ok, n = pcall(GetNumGroupMembers)
    elseif IsInGroup and IsInGroup() then
        ok, n = pcall(GetNumSubgroupMembers)
        n = ok and type(n) == "number" and n + 1 or n
    else
        return 1
    end
    return ok and CRT.Comm.Readable(n) and type(n) == "number" and n or nil
end

-- The group: { { name (no realm), class, row (the Addon check's) } }, sorted by name; and whether it is whole (every
-- member's name and class readable). The Addon check leaves out a name it can't read (a secret one) and a class it
-- can't read is nil: such a group is used, never kept.
local function readRoster()
    Page.counts.roster = Page.counts.roster + 1
    local rows = CRT.AddonCheck and CRT.AddonCheck:Roster() or {}
    local out, whole = {}, true
    for _, row in ipairs(rows) do
        out[#out + 1] = { name = Interrupts.CleanName(row.name), class = row.class, row = row }
        if not row.class then
            whole = false
        end
    end
    local size = groupSize()
    if size == nil or #rows < size then
        whole = false
    end
    table.sort(out, function(a, b)
        return a.name:lower() < b.name:lower()
    end)
    return out, whole
end

-- The Raid Groups layouts with their players: { { label, entries = { { name, class } } } }.
local function readLayouts()
    local Model, Groups = CRT.NoteEditModel, CRT.Groups
    if not (Model and Model.Sources and Groups and Groups.Presets and Groups.Find) then
        return {}
    end
    Page.counts.layouts = Page.counts.layouts + 1
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

-- The group and the layouts, worked out the first time they are asked for after a change. A group read while a name
-- or class was unreadable is marked dirty: it serves the draw it was read for, and the next draw reads it again
-- (Page.DropDirty).
function Page.Cache()
    if not cache then
        local roster, whole = readRoster()
        local byName = {}
        for _, m in ipairs(roster) do
            byName[m.name:lower()] = m
        end
        cache = { roster = roster, byName = byName, layouts = readLayouts(), dirty = not whole }
    end
    return cache
end

-- Before each draw of the page: a dirty group is read again.
function Page.DropDirty()
    if cache and cache.dirty then
        cache = nil
    end
end

function Page.ClearCache()
    cache = nil
end

function Page.Roster()
    return Page.Cache().roster
end

-- The group member with a name (case left out), or nil.
function Page.MemberOf(name)
    if type(name) ~= "string" or name == "" then
        return nil
    end
    return Page.Cache().byName[name:lower()]
end

-- The class a chip's name is coloured in: the group's, else the stored or shared class lookup.
function Page.ClassOf(name)
    local m = Page.MemberOf(name)
    if m then
        return m.class
    end
    return (type(name) == "string" and name ~= "") and classOf(name) or nil
end

-- The palette's sections: your group, then each layout, each name once in its section.
function Page.PaletteSections()
    local out = {}
    local function source(entry)
        return { name = entry.name }
    end
    local function section(title, members)
        local entries, seen = {}, {}
        for _, m in ipairs(members) do
            if m.name ~= "" and not seen[m.name:lower()] then
                seen[m.name:lower()] = true
                entries[#entries + 1] = { label = m.name, token = m.name, class = m.class, name = m.name }
            end
        end
        if #entries > 0 then
            out[#out + 1] = { title = title, entries = entries, icon = true, source = source }
        end
    end
    local c = Page.Cache()
    section(TEXT.fromGroup, c.roster)
    for _, layout in ipairs(c.layouts) do
        section(string.format(TEXT.fromLayout, layout.label), layout.entries)
    end
    return out
end

local drawn -- the cache the palette was last drawn from

local function draw(force)
    local state = Page.dragState
    if not (state and state.paletteChild) then
        return
    end
    local c = Page.Cache()
    if c == drawn and not force then
        return
    end
    drawn = c
    Palette.DrawSections(state, Page.PaletteSections(), Palette.InnerWidth(L.rightW))
end
Page.DrawPalette = draw

function Page.BuildPalette(f)
    local state = Page.dragState
    local head = Page.Label(f, TEXT.players, "CRTFontNormal")
    head:SetPoint("TOPLEFT", L.rightX, LAYOUT.headY)
    Page.paletteHelp = UI.HelpRight(head, TEXT.players, TEXT.playersHelp)
    Page.paletteHead = head
    local scroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsKickPalette", f, "UIPanelScrollFrameTemplate")
    if UI.SkinScrollBar and scroll.ScrollBar then
        UI:SkinScrollBar(scroll.ScrollBar)
    end
    local height = UI.PAGE_H + L.contentY + LAYOUT.scrollTop - LAYOUT.bottom
    scroll:SetPoint("TOPLEFT", L.rightX, LAYOUT.scrollTop)
    scroll:SetSize(L.rightW - UI.ScrollGutter(), height)
    state.paletteChild = CreateFrame("Frame", nil, scroll)
    state.paletteChild:SetSize(L.rightW - UI.ScrollGutter(), 1)
    scroll:SetScrollChild(state.paletteChild)
    state.paletteScroll = scroll
    Page.paletteScroll = scroll
    -- drawn again only when the cache was worked out again
    Page.AddControl({ refresh = function()
        draw(false)
    end })
    -- the group or a layout changed: worked out again on the next refresh
    -- out of combat and after a pull, the names and classes that were secret can be read again
    local events = CreateFrame("Frame")
    for _, e in ipairs({ "GROUP_ROSTER_UPDATE", "PLAYER_REGEN_ENABLED", "ENCOUNTER_END" }) do
        events:RegisterEvent(e)
    end
    events:SetScript("OnEvent", function()
        Page.ClearCache()
    end)
    if CRT.Groups and CRT.Groups.OnChange then
        CRT.Groups:OnChange(function()
            Page.ClearCache()
            Page.Refresh()
        end)
    end
end
