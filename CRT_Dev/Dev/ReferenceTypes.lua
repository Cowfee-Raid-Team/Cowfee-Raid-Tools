local ADDON, CRT = ...

-- DEVELOPER ONLY. The Manage ability timelines window (Development page, Boss data tab): every ability timeline
-- of the boss picked, yours and shipped.
--   Delete                    one of your copies; Delete all my copies, every copy of yours for the boss. The
--                             shipped ones stay.
--   Remove from addon / Keep  marks a shipped one for removal (hidden on this computer at once, Keep undoes it);
--                             Export removals and /crt dev removed list the marks for Claude to delete from the
--                             boss files (Reference:SetRemoved in Timeline/Reference.lua). Showing the window
--                             clears marks whose blocks are already gone.
-- An ability's types are not set here: they are its ability label, set from the right-click menu of the ability
-- (Type, Also, icons; Timeline/ReferencePage.lua's AbilityMenu) and exported with Export labels
-- (Dev/AbilityLabels.lua). The file also prints /crt dev hidden and /crt dev mechhidden. It never ships: its .toc
-- line is inside the do-not-package block.

local Editor = {}
CRT.ReferenceTypes = Editor

local UI = CRT.UI
local Reference = CRT.TimelineReference

-- Every number the window is placed with, in px.
local LAYOUT = {
    width = 470, height = 380,
    x = 14, -- the left inset
    pickY = -34, -- the Boss picker, under the title
    pickLabel = 40, pickW = 220,
    listTop = -66, listBottom = 46, -- the scrolling list, between the picker and the buttons
    scrollBar = 32, -- room at the right for the scroll bar
    noneY = -70, -- "No ability timelines" in place of the list
    lineH = 28, -- one ability timeline
    buttonH = 22, buttonMinW = 60, buttonPad = 24, gap = 6, textGap = 8,
    bottom = 14, -- the buttons, from the bottom
}

local TEXT = {
    title = "Manage ability timelines (dev)",
    boss = "Boss",
    help = "Every ability timeline of this boss, yours and shipped.\n\nDelete removes one of your copies; Delete all my copies removes every copy of yours for this boss. The shipped ones stay.\n\nThe game can't change the addon's files, so a shipped one is removed in two steps. Remove from addon hides it on this computer at once and marks it for removal; Keep undoes that. Export removals (or /crt dev removed) lists the marks: paste them to Claude, who deletes those blocks from the boss files. Opening this window clears marks whose blocks are already gone.\n\nA marked one also leaves the alerts and notes on this computer, as a preview of the deletion.\n\nAn ability's types are set by right-clicking it on the Timeline.",
    none = "No ability timelines for this boss.",
}

local win

-- A button as wide as its label.
local function button(parent, text)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontButtonSmall)
    b:SetHighlightFontObject(CRTFontButtonSmallHighlight)
    b:SetDisabledFontObject(CRTFontButtonSmallDisable)
    b:SetHeight(LAYOUT.buttonH)
    function b:SetLabel(label)
        self:SetText(label)
        local fs = self:GetFontString()
        self:SetWidth(math.max(LAYOUT.buttonMinW, math.ceil((fs and fs:GetStringWidth() or 80) + LAYOUT.buttonPad)))
    end
    b:SetLabel(text)
    return b
end

-- midnight-s2 -> Midnight-S2: each part of a season key capitalized, as its folder is named.
local function seasonFolder(key)
    return (key:gsub("(%w)(%w*)", function(first, rest)
        return first:upper() .. rest
    end))
end

-- The boss file a boss's references ship in. The registry doesn't keep each boss's source file, so this
-- is a guess from the naming rule: the boss's name in title case without spaces or apostrophes, in its
-- season's folder ("CRT_Data/Seasons/Midnight-S2/Kithix.lua") when the registry knows the boss, else
-- the file name alone.
function Editor.BossFile(name, encounterID)
    local def = encounterID and CRT.Bosses and CRT.Bosses.Get and CRT.Bosses:Get(encounterID)
    if def and type(def.name) == "string" then
        name = def.name
    end
    local out = {}
    for word in tostring(name or "?"):gmatch("%S+") do
        word = word:gsub("[^%w]", "")
        out[#out + 1] = word:sub(1, 1):upper() .. word:sub(2)
    end
    local file = table.concat(out) .. ".lua"
    if def and type(def.season) == "string" then
        return "CRT_Data/Seasons/" .. seasonFolder(def.season) .. "/" .. file
    end
    return file
end

-- One line of the removals export:
-- "CRT_Data/Seasons/Midnight-S2/Kithix.lua; encounter 3513; Mythic; Boss: Kith'ix / Difficulty: Mythic / Length: 7:00",
-- ending "; already gone" when no shipped block has that header any more (Claude deleted it).
function Editor.RemovalLine(mark)
    local id = Reference.BossID(mark.encounterID, mark.boss)
    return string.format("%s; encounter %s; %s; %s%s", Editor.BossFile(mark.boss, id), id and tostring(id) or "?", mark.difficulty or "any difficulty", mark.header or "", mark.gone and "; already gone" or "")
end

-- Every shipped reference marked for removal on this computer, one line each, by boss.
function Editor.RemovalLines()
    local lines = {}
    for _, mark in ipairs(Reference:Removed()) do
        lines[#lines + 1] = Editor.RemovalLine(mark)
    end
    return lines
end

local function exportRemovals()
    local lines = Editor.RemovalLines()
    if #lines == 0 then
        CRT:Print("No shipped ability timelines are marked for removal.")
        return
    end
    CRT.ConsumablesTools:ShowText("Marked for removal (Ctrl+C to copy, paste to Claude)", table.concat(lines, "\n"))
end

-- /crt dev removed: the same lines, in chat.
function Editor:PrintRemoved()
    local lines = Editor.RemovalLines()
    if #lines == 0 then
        CRT:Print("No shipped ability timelines are marked for removal. Mark them in Development > Boss data > Manage ability timelines.")
        return
    end
    CRT:Print("Marked for removal (paste to Claude):")
    for _, line in ipairs(lines) do
        CRT:Print(line)
    end
end

local function confirm(text, arg, acceptText, accept)
    UI.LiftOver(UI.ShownPopup(StaticPopup_ShowCustomGenericConfirmation({
        text = text,
        text_arg1 = arg,
        acceptText = acceptText,
        cancelText = CANCEL,
        showAlert = true,
        callback = accept,
    }), "GENERIC_CONFIRMATION"))
end

-- The boss's name as the boss file has it.
local function bossName(id)
    local def = CRT.Bosses and CRT.Bosses.Get and CRT.Bosses:Get(id)
    return def and def.name or tostring(id)
end

-- The boss file's bosses under their raid (Bosses:Options).
local function bossOptions()
    return CRT.Bosses and CRT.Bosses.Options and CRT.Bosses:Options() or {}
end

-- Every ability timeline of a boss (encounter ID), yours and shipped, marked ones too.
local function entriesOf(id)
    return id and Reference:ForBoss(id, bossName(id), true) or {}
end

-- The boss the window opens on: the Timeline's shown one, else the first with ability timelines, else the first.
local function firstBoss()
    local T = CRT.Timeline
    local ok, s = pcall(T.Settings, T)
    local shown = ok and type(s) == "table" and type(s.lastView) == "table" and s.lastView.boss
    local first
    for _, o in ipairs(bossOptions()) do
        if not o.title then
            if o.key == shown then
                return shown
            end
            first = first or o.key
        end
    end
    for _, o in ipairs(bossOptions()) do
        if not o.title and entriesOf(o.key)[1] then
            return o.key
        end
    end
    return first
end

local function entryLabel(entry)
    local parts = { entry.ref.difficulty or "Any difficulty", entry.own and "your copy" or "shipped" }
    if entry.saved and date then
        parts[#parts + 1] = "saved " .. date("%Y-%m-%d", entry.saved)
    end
    if entry.removed then
        parts[#parts + 1] = "|cffff6060marked for removal|r"
    end
    return table.concat(parts, " \194\183 ")
end

local refresh

local function lineAction(entry)
    if entry.own then
        confirm("Delete your %s copy?", entry.ref.difficulty or entry.ref.boss, "Delete", function()
            Reference:Delete(entry.key)
            CRT:Print("Deleted your copy of the " .. entry.ref.boss .. " ability timeline.")
            refresh()
        end)
    elseif entry.removed then
        Reference:SetRemoved(entry, false)
        CRT:Print("Kept the shipped " .. entry.ref.boss .. " ability timeline; it shows again.")
        refresh()
    else
        Reference:SetRemoved(entry, true)
        CRT:Print("Marked the shipped " .. entry.ref.boss .. " ability timeline for removal; it's hidden on this computer. Export removals lists it for Claude.")
        refresh()
    end
end

local function lineAt(i)
    local l = win.lines[i]
    if l then
        return l
    end
    l = CreateFrame("Frame", nil, win.list)
    l:SetSize(LAYOUT.width - 2 * LAYOUT.x - LAYOUT.scrollBar, LAYOUT.lineH)
    l:SetPoint("TOPLEFT", win.list, "TOPLEFT", 0, -(i - 1) * LAYOUT.lineH)
    l.text = l:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    l.text:SetPoint("LEFT", 0, 0)
    l.text:SetJustifyH("LEFT")
    l.text:SetWordWrap(false)
    l.action = button(l, "Delete")
    l.action:SetPoint("RIGHT", 0, 0)
    l.action:SetScript("OnClick", function()
        if l.entry then
            lineAction(l.entry)
        end
    end)
    win.lines[i] = l
    return l
end

refresh = function()
    if not (win and win:IsShown()) then
        return
    end
    win.pick.refresh()
    local entries = entriesOf(win.boss)
    local own = 0
    for i, entry in ipairs(entries) do
        local l = lineAt(i)
        l.entry = entry
        l.action:SetLabel(entry.own and "Delete" or entry.removed and "Keep" or "Remove from addon")
        l.text:SetWidth(l:GetWidth() - l.action:GetWidth() - LAYOUT.textGap)
        l.text:SetText(entryLabel(entry))
        l:Show()
        if entry.own then
            own = own + 1
        end
    end
    for i = #entries + 1, #win.lines do
        win.lines[i].entry = nil
        win.lines[i]:Hide()
    end
    win.list:SetHeight(math.max(#entries, 1) * LAYOUT.lineH)
    win.none:SetShown(#entries == 0)
    win.own = own
    win.deleteAll:SetEnabled(own > 0)
end

local function deleteAll()
    local id, n = win.boss, win.own or 0
    if not id or n == 0 then
        return
    end
    local name = bossName(id)
    confirm("Delete %s?", n == 1 and ("your copy of " .. name) or (n .. " copies of " .. name), "Delete all", function()
        local count = Reference:DeleteOwn(id, name)
        CRT:Print(string.format("Deleted %d of your copies of %s; the shipped ability timelines stay.", count, name))
        refresh()
    end)
end

-- Clears the marks whose blocks are already gone, and says how many.
local function prune()
    local pruned = Reference:PruneRemoved()
    if pruned > 0 then
        CRT:Print(string.format("Cleared %d removal mark%s: those ability timelines are already gone from the boss files.", pruned, pruned == 1 and "" or "s"))
    end
end

local function build()
    win = UI.Window("CowfeeRaidToolsReferenceManage", { kind = "dialog", title = TEXT.title, width = LAYOUT.width, height = LAYOUT.height })
    win:SetToplevel(true)
    win.lines = {}
    win.boss = firstBoss()

    win.pick = UI.Dropdown(win, TEXT.boss, {
        options = bossOptions,
        labelWidth = LAYOUT.pickLabel,
        width = LAYOUT.pickW,
        get = function()
            return win.boss
        end,
        set = function(key)
            win.boss = key
            refresh()
        end,
    })
    win.pick:SetPoint("TOPLEFT", LAYOUT.x, LAYOUT.pickY)
    UI.HelpRight(win.pick, TEXT.title, TEXT.help)

    local scroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsReferenceManageScroll", win, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(scroll.ScrollBar)
    scroll:SetPoint("TOPLEFT", LAYOUT.x, LAYOUT.listTop)
    scroll:SetPoint("BOTTOMRIGHT", -LAYOUT.scrollBar, LAYOUT.listBottom)
    win.list = CreateFrame("Frame", nil, scroll)
    win.list:SetSize(LAYOUT.width - 2 * LAYOUT.x - LAYOUT.scrollBar, 1)
    scroll:SetScrollChild(win.list)
    win.none = win:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    win.none:SetPoint("TOPLEFT", LAYOUT.x, LAYOUT.noneY)
    win.none:SetText(TEXT.none)

    win.deleteAll = button(win, "Delete all my copies")
    win.deleteAll:SetPoint("BOTTOMLEFT", LAYOUT.x, LAYOUT.bottom)
    win.deleteAll:SetScript("OnClick", deleteAll)
    local export = button(win, "Export removals")
    export:SetPoint("LEFT", win.deleteAll, "RIGHT", LAYOUT.gap, 0)
    export:SetScript("OnClick", exportRemovals)
    win:HookScript("OnShow", function()
        prune()
        refresh()
    end)
    UI:SkinTree(win)
end

-- The Development page's Manage ability timelines button.
function Editor:Toggle()
    if not win then
        build()
    end
    win:SetShown(not win:IsShown())
end

-- Each boss's list of hidden names as it should ship (namesOf(id)), as the line to paste into its boss
-- file (field = { ... },), for every boss this computer changed (CRTDB.dev[store]); none tells how.
local function printHiddenList(store, field, namesOf, none)
    local all = CRT.db.dev and CRT.db.dev[store]
    if not (all and next(all)) then
        CRT:Print(none)
        return
    end
    for boss in pairs(all) do
        local id = tonumber(boss) or boss
        local def = CRT.Bosses:Get(id)
        local names = {}
        for _, name in ipairs(namesOf(id)) do
            names[#names + 1] = string.format("%q", name)
        end
        CRT:Print(string.format("%s (%s): %s = { %s },", def and def.name or "?", tostring(boss), field, table.concat(names, ", ")))
    end
end

-- /crt dev hidden: each boss's abilities hidden from the timeline (Timeline:HiddenNames).
function Editor:PrintHidden()
    printHiddenList("hiddenAbilities", "hidden", function(id)
        return CRT.Timeline:HiddenNames(id)
    end, "No hidden abilities changed on this computer. Right-click a row's name on the Timeline with /crt dev open.")
end

-- /crt dev mechhidden: each boss's abilities hidden from the Mech Alerts list (Timeline:MechHiddenNames).
function Editor:PrintMechHidden()
    printHiddenList("mechHidden", "mechHidden", function(id)
        return CRT.Timeline:MechHiddenNames(id)
    end, "No abilities hidden from Mech Alerts on this computer. Right-click a row on Raid Notes > Mech Alerts with /crt dev open.")
end
