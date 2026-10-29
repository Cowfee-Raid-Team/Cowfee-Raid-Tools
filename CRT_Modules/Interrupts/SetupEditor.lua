local ADDON, CRT = ...

-- Interrupts: Edit setup (CRT.InterruptSetupEditor), the window the Interrupts page's Edit setup button opens. A
-- player makes their own kick setup for any boss and difficulty, with no code: the spell (its name, and its spell ID
-- when known), and the groups, each a label, a raid marker (or none) and 1 to Setup.MAX_SLOTS kick slots; + Group adds
-- one (up to Setup.MAX_GROUPS), Remove takes one out. Your own setups have no timing: their numbers follow each marked
-- add's casts, so every group has a raid marker (a new group takes the first one free; picking another group's marker
-- swaps the two). Save keeps it in CRTDB.interrupts.setups[encounterID][difficultyID] (Interrupts:SetCustom), where it
-- is used in place of the shipped setup for that boss and difficulty; Back to the shipped setup drops it
-- (Interrupts:DropCustom), and is Delete my setup for a boss and difficulty with no shipped setup. A boss whose shipped
-- setup is timed (its numbers come from when the adds first cast) is shown read-only, as shipped (no markers made up for
-- it): every field greyed and Save greyed with why, so its lattice is never lost. It opens on the setup shown on the page (yours or the shipped one, as a start), or a blank
-- one for a boss and difficulty with none. A group keeps its key when its label changes, so the names on the list
-- stay with it; a new group's key is made from its label (Setup.KeyFor).
-- The kick list, the raid note's block and a share work the same for your own setup as for a shipped one (a share
-- carries the setup's shape). A developer's build adds Export (CRT_Dev/Dev/KickSetupExport.lua: Editor:AddDevButton).

local UI = CRT.UI
local Interrupts = CRT.Interrupts
local Setup = CRT.InterruptSetup

local Editor = { devButtons = {} }
CRT.InterruptSetupEditor = Editor

local TEXT = {
    title = "Kick setup",
    help = "Your own kick setup for a boss and difficulty. Each group kicks the add with its raid marker, in turn: its number moves on with each of that add's casts. So every group needs its own raid marker, and someone marks the adds, by hand or with a marker macro.\n\nYours is used in place of the setup CRT ships, until you go back to it. The kick list, the raid note and Share to raid work the same. A boss whose numbers come from timing can't be changed here.",
    boss = "Boss",
    difficulty = "Difficulty",
    spell = "Spell",
    spellID = "Spell ID",
    spellHelp = "The spell the groups kick, for How the numbers are worked out. The spell ID is optional: the Journal shows it, or a pull's /crt dev kicks log.",
    groups = "Groups",
    groupsHelp = "One group per add. Its label heads its column on the kick list and shows in the reminder. Its raid marker is how its add is found: numbers only show on the add with that marker, so each group needs one of its own. Picking another group's marker swaps the two.",
    marker = "Raid marker",
    slots = "Kickers",
    addGroup = "+ Group",
    remove = "Remove",
    save = "Save",
    shipped = "Back to the shipped setup",
    delete = "Delete my setup",
    deleted = "Deleted your kick setup for %s.",
    close = "Close",
    saved = "Saved your kick setup for %s.",
    dropped = "Back to the shipped kick setup for %s.",
    newGroup = "Group %d",
    noBoss = "Pick a boss first.",
}
Editor.TEXT = TEXT

local DIFFICULTIES = { { key = 16, label = "Mythic" }, { key = 15, label = "Heroic" }, { key = 14, label = "Normal" } }

local LAYOUT = {
    width = 600, height = 470,
    labelW = 70, bossW = 250, diffX = 370, diffLabelW = 70, diffW = 120,
    spellY = -44, spellW = 200, idX = 320, idLabelW = 60, idW = 90, fieldH = 22,
    groupsY = -80, rowsY = -104, rowH = 34, labelEditW = 150, markerX = 160, markerW = 130, slotsX = 300,
    slotsLabelW = 56, slotsW = 110, removeX = 520,
    buttonH = 22, gap = 6,
}
Editor.LAYOUT = LAYOUT
local L = LAYOUT

local win
local draft -- { boss, difficulty, spellName, spellID, label, groups = { { key, label, marker, slots } } }
local rows = {}
local controls = {}

local function copyGroups(groups)
    local out = {}
    for i, g in ipairs(groups or {}) do
        out[i] = { key = g.key, label = g.label, marker = g.marker, slots = g.slots }
    end
    return out
end

-- A new group: the first raid marker no group has, Skull first.
local function blankGroup(n, groups)
    local taken = {}
    for _, g in ipairs(groups or {}) do
        if g.marker then
            taken[g.marker] = true
        end
    end
    local marker
    for m = #Setup.MARKERS, 1, -1 do
        if not taken[m] then
            marker = m
            break
        end
    end
    return { label = string.format(TEXT.newGroup, n), marker = marker, slots = 4 }
end

-- A draft from the setup in use for a key, or a blank one for a boss and difficulty with none.
function Editor.DraftFor(key)
    local id, diff = Interrupts.SplitKey(key)
    local def = key and Interrupts:Def(key)
    if def then
        id, diff = Interrupts.SplitKey((Interrupts:Resolve(key)))
    end
    local d = { boss = id, difficulty = diff or 16, label = def and def.label or Setup.LABEL, groups = def and copyGroups(def.groups) or { blankGroup(1) } }
    d.spellName = def and def.spell and def.spell.name or ""
    d.spellID = def and def.spell and def.spell.spellID or nil
    return d
end

-- The draft as a setup for Interrupts:SetCustom: every group with a key (a new one's from its label).
function Editor.ToRaw(d)
    local taken = {}
    for _, g in ipairs(d.groups) do
        if g.key then
            taken[g.key] = true
        end
    end
    local groups = {}
    for i, g in ipairs(d.groups) do
        local key = g.key
        if not key then
            key = Setup.KeyFor(g.label, taken)
            taken[key] = true
        end
        groups[i] = { key = key, label = Setup.CleanLabel(g.label), marker = g.marker, slots = g.slots }
    end
    local name = type(d.spellName) == "string" and d.spellName:match("^%s*(.-)%s*$") or ""
    local spell = name ~= "" and { name = name, spellID = d.spellID } or (d.spellID and { spellID = d.spellID }) or nil
    return { label = d.label, spell = spell, groups = groups }
end

function Editor.Key(d)
    return d and d.boss and d.difficulty and Interrupts.Key(d.boss, d.difficulty) or nil
end

-- Why the draft can't be saved, or nil: no boss, or a shipped setup that is timed.
function Editor.Blocked(d)
    local key = Editor.Key(d)
    if not key then
        return TEXT.noBoss
    end
    local ship = Interrupts:ShippedDef(key)
    if ship and ship.timing then
        return Interrupts.TEXT.timed
    end
    return nil
end

-- Saves the draft: true, or false and why not.
function Editor:Save()
    local key = Editor.Key(draft)
    if not key then
        return false, TEXT.noBoss
    end
    local ok, why = Interrupts:SetCustom(key, Editor.ToRaw(draft))
    if not ok then
        return false, why
    end
    -- the saved groups' keys stay with the draft
    draft.groups = copyGroups(Interrupts:Def(key).groups)
    CRT:Print(string.format(TEXT.saved, Interrupts:BossName(key)))
    if CRT.InterruptsPage and CRT.InterruptsPage.Choose then
        CRT.InterruptsPage.Choose(key)
    end
    return true
end

function Editor:BackToShipped()
    local key = Editor.Key(draft)
    if key and Interrupts:IsCustom(key) then
        local shipped = Interrupts:ShippedDef(key) ~= nil
        Interrupts:DropCustom(key)
        CRT:Print(string.format(shipped and TEXT.dropped or TEXT.deleted, Interrupts:BossName(key)))
        draft = Editor.DraftFor(key)
        self:Refresh()
    end
end

function Editor:AddGroup()
    if draft and #draft.groups < Setup.MAX_GROUPS then
        draft.groups[#draft.groups + 1] = blankGroup(#draft.groups + 1, draft.groups)
        self:Refresh()
    end
end

function Editor:RemoveGroup(i)
    if draft and #draft.groups > 1 and draft.groups[i] then
        table.remove(draft.groups, i)
        self:Refresh()
    end
end

function Editor.Draft()
    return draft
end

-- Whether the draft can be changed: not a boss whose shipped setup is timed.
function Editor.Editable()
    local key = Editor.Key(draft)
    local ship = key and Interrupts:ShippedDef(key)
    return not (ship and ship.timing)
end

-- A developer's button at the bottom left (Export): { label, onClick(editor) }. Added before or after the window is made.
function Editor:AddDevButton(label, onClick)
    self.devButtons[#self.devButtons + 1] = { label = label, onClick = onClick }
    if win then
        self:BuildDevButtons()
    end
end

-- The window ------------------------------------------------------------------------------------------------------------

local function button(parent, text, onClick)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontButtonSmall)
    b:SetHighlightFontObject(CRTFontButtonSmallHighlight)
    b:SetDisabledFontObject(CRTFontButtonSmallDisable)
    b:SetText(text)
    local fs = b:GetFontString()
    b:SetSize(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0), L.buttonH)
    b:SetScript("OnClick", onClick)
    return b
end

local function label(parent, text, font)
    local fs = parent:CreateFontString(nil, "OVERLAY", font or "CRTFontSmall")
    fs:SetJustifyH("LEFT")
    fs:SetText(text)
    return fs
end

local function editBox(parent, w, numeric, onChange)
    local e = CreateFrame("EditBox", nil, parent, "InputBoxTemplate")
    e:SetSize(w, L.fieldH)
    e:SetAutoFocus(false)
    e:SetFontObject(CRTFontEdit)
    e:SetMaxLetters(numeric and 9 or 40)
    if numeric and e.SetNumeric then
        e:SetNumeric(true)
    end
    UI:SkinEditBox(e)
    -- every typed change goes into the draft, so Save takes a field still being typed in
    e:SetScript("OnTextChanged", function(self, userInput)
        if userInput then
            onChange(self:GetText())
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

local function markerOptions()
    local out = {}
    for i = #Setup.MARKERS, 1, -1 do
        out[#out + 1] = { key = i, label = Setup.MarkerIcon(i, 14) .. " " .. Setup.MARKERS[i] }
    end
    return out
end
Editor.MarkerOptions = markerOptions

local function buildRow(i)
    local c = win.content
    local y = L.rowsY - (i - 1) * L.rowH
    local row = {}
    row.label = editBox(c, L.labelEditW, false, function(text)
        local g = draft and draft.groups[i]
        if g and Setup.CleanLabel(text) ~= "" then
            g.label = Setup.CleanLabel(text)
        end
    end)
    row.label:SetPoint("TOPLEFT", 4, y)
    row.marker = UI.Dropdown(c, "", { labelWidth = 0, width = L.markerW, options = markerOptions, enabledIf = Editor.Editable,
        get = function()
            local g = draft and draft.groups[i]
            return g and g.marker
        end,
        set = function(m)
            local g = draft and draft.groups[i]
            if g then
                -- a marker is one group's: another group with it takes this one's in exchange
                for _, other in ipairs(draft.groups) do
                    if other ~= g and other.marker == m then
                        other.marker = g.marker
                    end
                end
                g.marker = m
                Editor:Refresh()
            end
        end })
    row.marker:SetPoint("TOPLEFT", L.markerX, y + 5)
    row.slots = UI.Slider(c, TEXT.slots, { min = 1, max = Setup.MAX_SLOTS, labelWidth = L.slotsLabelW, width = L.slotsW,
        enabledIf = Editor.Editable,
        get = function()
            local g = draft and draft.groups[i]
            return g and g.slots or 1
        end,
        set = function(v)
            local g = draft and draft.groups[i]
            if g then
                g.slots = v
            end
        end })
    row.slots:SetPoint("TOPLEFT", L.slotsX, y + 5)
    row.remove = button(c, TEXT.remove, function()
        Editor:RemoveGroup(i)
    end)
    row.remove:SetPoint("TOPLEFT", L.removeX, y)
    rows[i] = row
end

function Editor:BuildDevButtons()
    local x = 0
    for i, def in ipairs(self.devButtons) do
        if not def.button then
            def.button = button(win.content, def.label, function()
                def.onClick(Editor)
            end)
        end
        def.button:ClearAllPoints()
        def.button:SetPoint("BOTTOMLEFT", x, 0)
        x = x + def.button:GetWidth() + L.gap
    end
end

local function build()
    win = UI.Window("CowfeeRaidToolsKickSetup", { kind = "dialog", title = TEXT.title, width = L.width, height = L.height })
    Editor.window = win
    local c = win.content
    local bossRow = UI.Dropdown(c, TEXT.boss, { labelWidth = L.labelW, width = L.bossW, maxHeight = 400,
        options = function()
            return CRT.Bosses:Options()
        end,
        get = function()
            return draft and draft.boss
        end,
        set = function(id)
            local key = Interrupts.Key(id, draft and draft.difficulty or 16)
            draft = Editor.DraftFor(key)
            draft.boss = id
            Editor:Refresh()
        end })
    bossRow:SetPoint("TOPLEFT", 0, 0)
    controls[#controls + 1] = bossRow
    UI.HelpRight(bossRow, TEXT.title, TEXT.help)
    local diffRow = UI.Dropdown(c, TEXT.difficulty, { labelWidth = L.diffLabelW, width = L.diffW, options = DIFFICULTIES,
        get = function()
            return draft and draft.difficulty
        end,
        set = function(d)
            local id = draft and draft.boss
            draft = Editor.DraftFor(id and Interrupts.Key(id, d))
            draft.boss, draft.difficulty = id, d
            Editor:Refresh()
        end })
    diffRow:SetPoint("TOPLEFT", L.diffX, 0)
    controls[#controls + 1] = diffRow
    local spellLabel = label(c, TEXT.spell)
    spellLabel:SetPoint("TOPLEFT", 4, L.spellY - 4)
    Editor.spellName = editBox(c, L.spellW, false, function(text)
        if draft then
            draft.spellName = text
        end
    end)
    Editor.spellName:SetPoint("TOPLEFT", L.labelW + 5, L.spellY)
    local idLabel = label(c, TEXT.spellID)
    idLabel:SetPoint("TOPLEFT", L.idX, L.spellY - 4)
    Editor.spellID = editBox(c, L.idW, true, function(text)
        if draft then
            local n = tonumber(text)
            draft.spellID = (n and n >= 1 and n == math.floor(n)) and n or nil
        end
    end)
    Editor.spellID:SetPoint("TOPLEFT", L.idX + L.idLabelW, L.spellY)
    UI.HelpRight(Editor.spellID, TEXT.spell, TEXT.spellHelp)
    local groupsHead = label(c, TEXT.groups, "CRTFontNormal")
    groupsHead:SetPoint("TOPLEFT", 4, L.groupsY)
    UI.HelpRight(groupsHead, TEXT.groups, TEXT.groupsHelp)
    for i = 1, Setup.MAX_GROUPS do
        buildRow(i)
    end
    Editor.addGroup = button(c, TEXT.addGroup, function()
        Editor:AddGroup()
    end)
    Editor.close = button(c, TEXT.close, function()
        win:Hide()
    end)
    Editor.close:SetPoint("BOTTOMRIGHT", 0, 0)
    Editor.save = button(c, TEXT.save, function()
        local ok, why = Editor:Save()
        if not ok then
            CRT:Print(why)
        end
    end)
    Editor.save:SetPoint("RIGHT", Editor.close, "LEFT", -L.gap, 0)
    -- a greyed Save says why on hover
    if Editor.save.SetMotionScriptsWhileDisabled then
        Editor.save:SetMotionScriptsWhileDisabled(true)
    end
    Editor.save:SetScript("OnEnter", function(self)
        if self.crtReason then
            UI.TooltipOwner(GameTooltip, self, "ANCHOR_TOP")
            GameTooltip:SetText(TEXT.save, 1, 1, 1)
            GameTooltip:AddLine(self.crtReason, 0.85, 0.85, 0.85, true)
            GameTooltip:Show()
        end
    end)
    Editor.save:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    Editor.shipped = button(c, TEXT.shipped, function()
        Editor:BackToShipped()
    end)
    Editor.shipped:SetPoint("RIGHT", Editor.save, "LEFT", -L.gap, 0)
    Editor:BuildDevButtons()
end

function Editor:Refresh()
    if not (win and draft) then
        return
    end
    for _, c in ipairs(controls) do
        c.refresh()
    end
    if not self.spellName:HasFocus() then
        self.spellName:SetText(draft.spellName or "")
    end
    if not self.spellID:HasFocus() then
        self.spellID:SetText(draft.spellID and tostring(draft.spellID) or "")
    end
    local n = #draft.groups
    local editable = Editor.Editable()
    self.spellName:SetEnabled(editable)
    self.spellID:SetEnabled(editable)
    for i, row in ipairs(rows) do
        local on = i <= n
        local g = draft.groups[i]
        row.label:SetShown(on)
        row.marker:SetShown(on)
        row.slots:SetShown(on)
        row.remove:SetShown(on)
        if on then
            if not row.label:HasFocus() then
                row.label:SetText(g.label)
            end
            row.label:SetEnabled(editable)
            row.marker.refresh()
            row.slots.refresh()
            row.remove:SetEnabled(editable and n > 1)
        end
    end
    self.addGroup:ClearAllPoints()
    self.addGroup:SetPoint("TOPLEFT", 4, L.rowsY - n * L.rowH)
    self.addGroup:SetEnabled(editable and n < Setup.MAX_GROUPS)
    local key = Editor.Key(draft)
    local blocked = Editor.Blocked(draft)
    self.save:SetEnabled(blocked == nil)
    self.save.crtReason = blocked
    -- Back to the shipped setup, or Delete my setup when there is none to go back to
    local shipped = key ~= nil and Interrupts:ShippedDef(key) ~= nil
    self.shipped:SetText(shipped and TEXT.shipped or TEXT.delete)
    local fs = self.shipped:GetFontString()
    self.shipped:SetWidth(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0))
    self.shipped:SetEnabled(key ~= nil and Interrupts:IsCustom(key))
end

-- Opens the editor on a setup key (the page's), or a blank draft.
function Editor:Open(key)
    if not win then
        build()
    end
    draft = Editor.DraftFor(key)
    win:Show()
    self:Refresh()
end
