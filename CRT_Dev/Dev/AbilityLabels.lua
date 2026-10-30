local ADDON, CRT = ...

-- DEVELOPER ONLY. /crt dev labels: the Ability labels window, to ship your own ability labels (the right-click
-- Type, Name, Row and icons of an ability, Timeline:SetAbility) in the boss files, many bosses at a time. A pop-out
-- (UI.Window: its place and size kept in CRTDB.dev.labelsWindow) with a tick box per boss of the route, under its
-- raid's heading, "Ula'tek (16)" for 16 labels of yours; a boss with none is greyed out. All and None tick them.
--   Export        one Lua block per ticked boss in the boss-file format (abilities = { ... }, Registry.lua's header),
--                 under a comment naming the boss, its encounter ID and the day, in the copyable text window. Each
--                 block is the boss file's labels with yours laid over them, so it replaces the boss's field whole.
--   Clear my labels for ticked bosses   asks first, listing each label of yours that the boss file doesn't
--                 have yet, then drops yours (Timeline:ClearAbilities), so you see what raiders see.
-- Which bosses are ticked lasts the session. This file never ships: its .toc line is inside the do-not-package block.

local Labels = {}
CRT.AbilityLabelsDev = Labels

local UI = CRT.UI

local TEXT = {
    title = "Ability labels (dev)",
    help = "Each boss with how many ability labels you set: the right-click Type, Name, Row and icons of an ability.\n\nExport writes a block per ticked boss to paste to Claude, who ships it in the boss's file. Players then see the labels too.\n\nOnce they ship, Clear my labels drops yours, so you see what raiders see.",
    all = "All",
    none = "None",
    export = "Export",
    clear = "Clear my labels for ticked bosses",
    count = "%s (%d)",
    exportTitle = "Ability labels for the boss files (Ctrl+C to copy, paste to Claude)",
    header = "-- %s (encounter %d): ability labels, exported %s",
    noneTicked = "Tick a boss with labels first.",
    clearAsk = "Clear your ability labels for %s?",
    oneBoss = "1 boss",
    bosses = "%d bosses",
    differ = "These aren't in the boss file yet and will be lost:",
    more = "and %d more",
    clearAccept = "Clear",
    cleared = "Cleared your ability labels for %s.",
    noBosses = "No bosses are loaded.",
    spell = "spell %d",
}
Labels.TEXT = TEXT

local LAYOUT = {
    width = 380, height = 460, minWidth = 320, minHeight = 260,
    top = -30, -- the list, under All and None
    bottom = 34, -- room for Export and Clear
    rowH = 24, check = 22, labelX = 24, scrollBar = 24, buttonH = 22, gap = 6,
    listed = 12, -- labels named in Clear's question; the rest are counted
}

local FIELDS = { "type", "name", "row", "tags" }

local ticked = {} -- encounterID = true: the ticked bosses, this session only

-- Data -----------------------------------------------------------------------------------------------

-- How many labels of yours a boss has.
function Labels.Count(encounterID)
    local n = 0
    for _ in pairs(CRT.Timeline:OwnAbilities(encounterID) or {}) do
        n = n + 1
    end
    return n
end

-- The route's raids and bosses (Bosses:Options): { key, label, title } per raid heading, { key, label, count } per boss.
function Labels.Rows()
    local out = {}
    for _, o in ipairs(CRT.Bosses:Options()) do
        out[#out + 1] = { key = o.key, label = o.label, title = o.title, count = not o.title and Labels.Count(o.key) or nil }
    end
    return out
end

function Labels.IsTicked(encounterID)
    return ticked[encounterID] == true
end

-- Only a boss with labels of yours can be ticked.
function Labels.SetTicked(encounterID, on)
    ticked[encounterID] = (on and Labels.Count(encounterID) > 0) or nil
end

function Labels.All()
    for _, row in ipairs(Labels.Rows()) do
        if not row.title then
            Labels.SetTicked(row.key, true)
        end
    end
end

function Labels.None()
    wipe(ticked)
end

-- The ticked bosses, in route order.
function Labels.Ticked()
    local out = {}
    for _, row in ipairs(Labels.Rows()) do
        if not row.title and ticked[row.key] then
            out[#out + 1] = row.key
        end
    end
    return out
end

-- One label as Lua: { type = "raid", name = "Adds", row = true, tags = { "tank", "magic" } }.
function Labels.EntryText(label)
    local parts = {}
    if label.type then
        parts[#parts + 1] = string.format("type = %q", label.type)
    end
    if label.name then
        parts[#parts + 1] = string.format("name = %q", label.name)
    end
    if label.row then
        parts[#parts + 1] = "row = true"
    end
    if type(label.tags) == "table" then
        local tags = {}
        for i, tag in ipairs(label.tags) do
            tags[i] = string.format("%q", tag)
        end
        parts[#parts + 1] = #tags > 0 and ("tags = { " .. table.concat(tags, ", ") .. " }") or "tags = {}"
    end
    return "{ " .. table.concat(parts, ", ") .. " }"
end

local function sortedIDs(list)
    local ids = {}
    for spellID in pairs(list) do
        ids[#ids + 1] = spellID
    end
    table.sort(ids)
    return ids
end

-- A boss's block for its boss file: the boss file's labels with yours over them, as one abilities field, indented
-- to sit inside its Bosses:Register({ ... }). day: the date in its comment.
function Labels.Block(encounterID, day)
    local def = CRT.Bosses:Get(encounterID)
    local list = CRT.Timeline:Labels(encounterID)
    local lines = {
        "    " .. string.format(TEXT.header, def and def.name or "?", encounterID, day),
        "    abilities = {",
    }
    for _, spellID in ipairs(sortedIDs(list)) do
        lines[#lines + 1] = string.format("        [%d] = %s,", spellID, Labels.EntryText(list[spellID]))
    end
    lines[#lines + 1] = "    },"
    return table.concat(lines, "\n")
end

-- The blocks of the bosses given, in that order, a blank line between them.
function Labels.Export(ids, day)
    local blocks = {}
    for _, id in ipairs(ids) do
        blocks[#blocks + 1] = Labels.Block(id, day)
    end
    return table.concat(blocks, "\n\n")
end

local function same(a, b)
    if type(a) == "table" and type(b) == "table" then
        if #a ~= #b then
            return false
        end
        for i = 1, #a do
            if a[i] ~= b[i] then
                return false
            end
        end
        return true
    end
    return a == b
end

-- Whether your label for an ability says anything the boss file's doesn't.
local function differs(own, shipped)
    for _, field in ipairs(FIELDS) do
        if own[field] ~= nil and not (shipped and same(own[field], shipped[field])) then
            return true
        end
    end
    return false
end

local function abilityName(spellID, own, shipped)
    local name = own.name or (shipped and shipped.name)
    if not name and C_Spell and C_Spell.GetSpellName then
        local ok, n = pcall(C_Spell.GetSpellName, spellID)
        name = ok and type(n) == "string" and n ~= "" and n or nil
    end
    return name or string.format(TEXT.spell, spellID)
end

-- Your labels on the bosses given that the boss file doesn't have yet, one line each: "Ula'tek: Adds (1287198)".
function Labels.Differences(ids)
    local out = {}
    for _, id in ipairs(ids) do
        local def = CRT.Bosses:Get(id)
        local own = CRT.Timeline:OwnAbilities(id) or {}
        local shipped = CRT.Bosses:Abilities(id) or {}
        for _, spellID in ipairs(sortedIDs(own)) do
            if differs(own[spellID], shipped[spellID]) then
                out[#out + 1] = string.format("%s: %s (%d)", def and def.name or "?", abilityName(spellID, own[spellID], shipped[spellID]), spellID)
            end
        end
    end
    return out
end

-- Drops your labels on the bosses given, and unticks them.
function Labels.Clear(ids)
    for _, id in ipairs(ids) do
        CRT.Timeline:ClearAbilities(id)
        ticked[id] = nil
    end
end

local function bossCount(n)
    return n == 1 and TEXT.oneBoss or string.format(TEXT.bosses, n)
end

-- Clear's question: the bosses, then the labels that would be lost, at most LAYOUT.listed of them by name.
function Labels.ClearQuestion(ids)
    local lines = { string.format(TEXT.clearAsk, bossCount(#ids)) }
    local lost = Labels.Differences(ids)
    if #lost > 0 then
        lines[#lines + 1] = ""
        lines[#lines + 1] = TEXT.differ
        for i = 1, math.min(#lost, LAYOUT.listed) do
            lines[#lines + 1] = lost[i]
        end
        if #lost > LAYOUT.listed then
            lines[#lines + 1] = string.format(TEXT.more, #lost - LAYOUT.listed)
        end
    end
    return table.concat(lines, "\n")
end

-- The window -----------------------------------------------------------------------------------------

local win

local function saved()
    CRT.db.dev = CRT.db.dev or {}
    CRT.db.dev.labelsWindow = CRT.db.dev.labelsWindow or {}
    return CRT.db.dev.labelsWindow
end

local refresh

local function lineAt(i)
    local l = win.lines[i]
    if l then
        return l
    end
    l = CreateFrame("Frame", nil, win.list)
    l:SetHeight(LAYOUT.rowH)
    l:SetPoint("TOPLEFT", 0, -(i - 1) * LAYOUT.rowH)
    l:SetPoint("TOPRIGHT", 0, -(i - 1) * LAYOUT.rowH)
    l.check = CreateFrame("CheckButton", nil, l, "UICheckButtonTemplate")
    l.check:SetSize(LAYOUT.check, LAYOUT.check)
    l.check:SetPoint("LEFT", 0, 0)
    UI:SkinCheckButton(l.check)
    l.check:SetScript("OnClick", function(self)
        Labels.SetTicked(l.key, self:GetChecked())
        refresh()
    end)
    l.label = l:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    l.label:SetJustifyH("LEFT")
    l.label:SetWordWrap(false)
    win.lines[i] = l
    return l
end

local function showLine(l, row)
    l.key = row.key
    l.label:ClearAllPoints()
    if row.title then
        l.check:Hide()
        l.label:SetPoint("LEFT", 0, 0)
        l.label:SetText(UI.HeadingText(row.label))
    else
        local has = row.count > 0
        l.check:Show()
        l.check:SetEnabled(has)
        l.check:SetChecked(has and Labels.IsTicked(row.key))
        l.label:SetPoint("LEFT", LAYOUT.labelX, 0)
        local text = string.format(TEXT.count, row.label, row.count)
        l.label:SetText(has and text or UI.ColorText(text, "muted"))
    end
    l:Show()
end

refresh = function()
    if not (win and win:IsShown()) then
        return
    end
    local rows = Labels.Rows()
    for i, row in ipairs(rows) do
        showLine(lineAt(i), row)
    end
    for i = #rows + 1, #win.lines do
        win.lines[i]:Hide()
    end
    win.empty:SetShown(#rows == 0)
    win.list:SetHeight(math.max(#rows, 1) * LAYOUT.rowH)
    local any = #Labels.Ticked() > 0
    win.export:SetEnabled(any)
    win.clear:SetEnabled(any)
end
Labels.Refresh = function()
    refresh()
end

local function onExport()
    local ids = Labels.Ticked()
    if #ids == 0 then
        CRT:Print(TEXT.noneTicked)
        return
    end
    CRT.ConsumablesTools:ShowText(TEXT.exportTitle, Labels.Export(ids, date("%Y-%m-%d")))
end

local function onClear()
    local ids = Labels.Ticked()
    if #ids == 0 then
        CRT:Print(TEXT.noneTicked)
        return
    end
    UI.LiftOver(UI.ShownPopup(StaticPopup_ShowCustomGenericConfirmation({
        text = "%s",
        text_arg1 = Labels.ClearQuestion(ids),
        acceptText = TEXT.clearAccept,
        cancelText = CANCEL,
        showAlert = true,
        callback = function()
            Labels.Clear(ids)
            CRT:Print(string.format(TEXT.cleared, bossCount(#ids)))
            refresh()
        end,
    }), "GENERIC_CONFIRMATION"))
end

local function buildList(c)
    local scroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsAbilityLabelsScroll", c, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(scroll.ScrollBar)
    scroll:SetPoint("TOPLEFT", 0, LAYOUT.top)
    scroll:SetPoint("BOTTOMRIGHT", -LAYOUT.scrollBar, LAYOUT.bottom)
    win.list = CreateFrame("Frame", nil, scroll)
    win.list:SetSize(LAYOUT.width - 2 * LAYOUT.scrollBar, LAYOUT.rowH)
    scroll:SetScrollChild(win.list)
    scroll:SetScript("OnSizeChanged", function(_, width)
        win.list:SetWidth(width)
    end)
    win.empty = c:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    win.empty:SetPoint("TOPLEFT", 0, LAYOUT.top - 4)
    win.empty:SetText(TEXT.noBosses)
end

local function build()
    win = UI.Window("CowfeeRaidToolsAbilityLabels", { kind = "popout", title = TEXT.title, saved = saved,
        width = LAYOUT.width, height = LAYOUT.height, minWidth = LAYOUT.minWidth, minHeight = LAYOUT.minHeight })
    win.strip:SetHelp(TEXT.title, TEXT.help)
    win.lines = {}
    local c = win.content
    win.all = UI.PanelButton(c, TEXT.all, LAYOUT.buttonH, function()
        Labels.All()
        refresh()
    end)
    win.all:SetPoint("TOPLEFT", 0, 0)
    win.none = UI.PanelButton(c, TEXT.none, LAYOUT.buttonH, function()
        Labels.None()
        refresh()
    end)
    win.none:SetPoint("LEFT", win.all, "RIGHT", LAYOUT.gap, 0)
    buildList(c)
    win.export = UI.PanelButton(c, TEXT.export, LAYOUT.buttonH, onExport)
    win.export:SetPoint("BOTTOMLEFT", 0, 0)
    win.clear = UI.PanelButton(c, TEXT.clear, LAYOUT.buttonH, onClear)
    win.clear:SetPoint("LEFT", win.export, "RIGHT", LAYOUT.gap, 0)
    win:HookScript("OnShow", refresh)
    CRT.Timeline:OnChange(refresh)
    Labels.window = win
    return win
end

function Labels.Toggle()
    if not win then
        build()
    end
    win:SetShown(not win:IsShown())
end

-- /crt dev labels (CRT_Core/Slash.lua's do-not-package block).
function Labels:Command(msg)
    if msg == "dev labels" then
        Labels.Toggle()
        return true
    end
    return false
end
