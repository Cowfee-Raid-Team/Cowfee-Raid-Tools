local ADDON, CRT = ...

-- DEVELOPER ONLY. The Logged Timeline Ref window (Development page): set each ability's types on an
-- ability timeline with dropdowns, instead of writing (type ...) by hand. Pick an ability timeline, then
-- for each ability a Main type (which colors the row) and any other types (Also, shown as dots). The
-- abilities scroll in a fixed-size window.
--   Save as my copy     writes the text as your own copy (or updates it), so the Timeline shows the
--                       colors straight away; your copy is listed before the shipped one
--   Export              the text, to paste to Claude and ship in the boss's file
--   Delete my copy      drops your copy, so the shipped one shows again
--   Manage ability timelines   every ability timeline of the picked boss: delete your copies (one or all), and
--                       mark shipped ones for removal (hidden on this computer at once, Keep undoes it);
--                       Export removals and /crt dev removed list the marks for Claude to delete from
--                       the boss files (Reference:SetRemoved in Timeline/Reference.lua)
-- Only the (type ...) option of each ability line changes; times, bars, leads, spell IDs, colors and
-- comments are kept. This file never ships: its .toc line is inside the do-not-package block.

local Editor = {}
CRT.ReferenceTypes = Editor

local UI = CRT.UI
local Reference = CRT.TimelineReference

local WIDTH, HEIGHT = 600, 480 -- about 10 ability rows show; the rest scroll
local ROW_H = 30
local LIST_TOP = 90 -- where the ability list starts, from the window's top
local LIST_BOTTOM = 64 -- room under the list for the status line and the buttons
local HEADERS = { boss = true, difficulty = true, length = true, encounter = true, phase = true, order = true }

local win, manage
local entryKey -- the reference being edited
local baseText -- its text when loaded
local rows = {} -- { name, main, also = { [type] = true } } per ability, in text order
local widgets = {} -- one row of controls per ability

local function trim(s)
    return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

-- The ability lines of reference text, the same lines Reference.Parse reads as abilities.
local function isAbility(line)
    line = trim((line:gsub("\r", "")))
    if line == "" or line:sub(1, 1) == "#" then
        return false
    end
    local key = line:match("^(%a+)%s*:")
    return not (key and HEADERS[key:lower()])
end

-- Where the times start: the first ':' outside round and square brackets (a lead can be 0:07).
local function timesColon(line)
    local depth = 0
    for i = 1, #line do
        local c = line:sub(i, i)
        if c == "(" or c == "[" then
            depth = depth + 1
        elseif c == ")" or c == "]" then
            depth = math.max(0, depth - 1)
        elseif c == ":" and depth == 0 then
            return i
        end
    end
end

-- One ability line with its type option replaced by types (a list, main first; empty for none).
local function setLineTypes(line, types)
    local cr = line:sub(-1) == "\r" and "\r" or ""
    line = cr == "" and line or line:sub(1, -2)
    local at = timesColon(line)
    if not at then
        return line .. cr
    end
    local head, times = line:sub(1, at - 1), line:sub(at)
    local indent = head:match("^(%s*)")
    local name = trim(head:match("^%s*([^%[%(]+)") or "")
    local spell = head:match("%[[^%]]*%]")
    local opts = {}
    if #types > 0 then
        opts[1] = "type " .. table.concat(types, " ")
    end
    for group in head:gmatch("%((.-)%)") do
        for opt in (group .. ","):gmatch("([^,]*),") do
            opt = trim(opt)
            if opt ~= "" and not opt:lower():match("^type%s") then
                opts[#opts + 1] = opt
            end
        end
    end
    local out = indent .. name
    if spell then
        out = out .. " " .. spell
    end
    if #opts > 0 then
        out = out .. " (" .. table.concat(opts, ", ") .. ")"
    end
    return out .. times .. cr
end

-- The text with every ability line's types set from list (one entry per ability, in text order).
function Editor.ApplyTypes(text, list)
    local out, i = {}, 0
    for raw in (text .. "\n"):gmatch("([^\n]*)\n") do
        if isAbility(raw) then
            i = i + 1
            raw = setLineTypes(raw, list[i] or {})
        end
        out[#out + 1] = raw
    end
    return table.concat(out, "\n")
end

local function typesOf(row)
    local list = {}
    if row.main then
        list[1] = row.main
    end
    for _, key in ipairs(Reference.TYPE_ORDER) do
        if row.also[key] and key ~= row.main then
            list[#list + 1] = key
        end
    end
    return list
end

local function currentText()
    if not baseText then
        return nil
    end
    local list = {}
    for i, row in ipairs(rows) do
        list[i] = typesOf(row)
    end
    return Editor.ApplyTypes(baseText, list)
end

local function load(key)
    entryKey, baseText = key, nil
    wipe(rows)
    local entry = key and Reference:Find(key)
    if not entry then
        return
    end
    baseText = entry.text
    for _, r in ipairs(entry.ref.rows) do
        local row = { name = r.name, also = {} }
        for i, t in ipairs(r.types or {}) do
            if i == 1 then
                row.main = t
            else
                row.also[t] = true
            end
        end
        rows[#rows + 1] = row
    end
end


local function referenceOptions()
    local list = {}
    for _, entry in ipairs(Reference:List()) do
        local ref = entry.ref
        list[#list + 1] = {
            key = entry.key,
            label = ref.boss .. (ref.difficulty and (" \194\183 " .. ref.difficulty) or "") .. (entry.own and " (your copy)" or " (shipped)"),
        }
    end
    return list
end

-- Loads the first ability timeline when the one shown is gone (deleted, or marked for removal).
local function loadFirstIfGone()
    if entryKey and Reference:Find(entryKey) then
        return
    end
    local list = referenceOptions()
    load(list[1] and list[1].key or nil)
end

local MAIN_OPTIONS = { { key = "none", label = "None" } }
for _, key in ipairs(Reference.TYPE_ORDER) do
    MAIN_OPTIONS[#MAIN_OPTIONS + 1] = { key = key, label = "|cff" .. Reference.TYPES[key].hex .. key .. "|r" }
end

local function colored(key)
    return "|cff" .. Reference.TYPES[key].hex .. key .. "|r"
end

local refresh

-- One ability's controls, in the scrolling list: its name (in its main type's color) with the Main
-- dropdown, and Also. Made once per index and reused, so any number of abilities works.
local function widgetRow(i)
    if widgets[i] then
        return widgets[i]
    end
    local list = win.list
    local w = {}
    w.main = UI.Dropdown(list, "", {
        options = MAIN_OPTIONS,
        labelWidth = 170,
        width = 110,
        get = function()
            return rows[i] and rows[i].main or "none"
        end,
        set = function(key)
            if rows[i] then
                rows[i].main = key ~= "none" and key or nil
                rows[i].also[key] = nil
                refresh()
            end
        end,
    })
    w.main:SetPoint("TOPLEFT", list, "TOPLEFT", 0, -(i - 1) * ROW_H)
    w.also = CreateFrame("DropdownButton", nil, list, "WowStyle1DropdownTemplate")
    w.also:SetWidth(110)
    w.also:SetPoint("LEFT", w.main, "RIGHT", 10, 0)
    w.also:SetupMenu(function(_, root)
        UI.MenuOnTop(root)
        for _, key in ipairs(Reference.TYPE_ORDER) do
            if not (rows[i] and rows[i].main == key) then
                root:CreateCheckbox(colored(key), function()
                    return rows[i] and rows[i].also[key] or false
                end, function()
                    if rows[i] then
                        rows[i].also[key] = not rows[i].also[key] or nil
                        refresh()
                    end
                end, key)
            end
        end
    end)
    UI:SkinDropdown(w.also)
    w.alsoText = list:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    w.alsoText:SetPoint("LEFT", w.also, "RIGHT", 8, 0)
    w.alsoText:SetWidth(110)
    w.alsoText:SetJustifyH("LEFT")
    w.alsoText:SetWordWrap(false)
    widgets[i] = w
    return w
end

-- A button as wide as its label.
local function button(parent, text)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontButtonSmall)
    b:SetHighlightFontObject(CRTFontButtonSmallHighlight)
    b:SetDisabledFontObject(CRTFontButtonSmallDisable)
    b:SetHeight(22)
    function b:SetLabel(label)
        self:SetText(label)
        local fs = self:GetFontString()
        self:SetWidth(math.max(60, math.ceil((fs and fs:GetStringWidth() or 80) + 24)))
    end
    b:SetLabel(text)
    return b
end

-- Back to the top of the list (a different ability timeline was picked).
local function scrollTop()
    local scroll = win and win.scroll
    if not scroll then
        return
    end
    if scroll.ScrollBar then
        scroll.ScrollBar:SetValue(0)
    end
    scroll:SetVerticalScroll(0)
end

local function refreshRows()
    for i = 1, math.max(#rows, #widgets) do
        local row = rows[i]
        if row then
            local w = widgetRow(i)
            w.main.Label:SetText(row.name)
            local c = row.main and Reference.TYPES[row.main].color
            if c then
                w.main.Label:SetTextColor(c[1], c[2], c[3])
            else
                w.main.Label:SetTextColor(1, 1, 1)
            end
            w.main.refresh()
            w.also:GenerateMenu()
            local extra = {}
            for _, key in ipairs(typesOf(row)) do
                if key ~= row.main then
                    extra[#extra + 1] = colored(key)
                end
            end
            w.alsoText:SetText(#extra > 0 and ("+ " .. table.concat(extra, ", ")) or "")
            w.main:Show()
            w.also:Show()
            w.alsoText:Show()
        elseif widgets[i] then
            widgets[i].main:Hide()
            widgets[i].also:Hide()
            widgets[i].alsoText:Hide()
        end
    end
    win.list:SetHeight(math.max(#rows, 1) * ROW_H)
end

refresh = function()
    if not win then
        return
    end
    win.pick.refresh()
    refreshRows()
    local entry = entryKey and Reference:Find(entryKey)
    win.delete:SetEnabled(entry and entry.own or false)
    win.manage:SetEnabled(entry ~= nil)
    win.status:SetText(not entry and "Pick an ability timeline." or entry.own and "Your copy: the Timeline shows it before the shipped one." or "The shipped ability timeline. Save as my copy to see the colors on the Timeline.")
    if manage and manage:IsShown() then
        manage.refresh()
    end
end

-- The encounter ID of a reference's boss: its Encounter line, else the boss file of the same name.
local function bossID(ref)
    return Reference.BossID(ref.encounterID, ref.boss)
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
        CRT:Print("No shipped ability timelines are marked for removal. Mark them in Logged Timeline Ref > Manage ability timelines.")
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

-- After a delete or a mark: a new ability timeline loads if the shown one is gone, from the top.
local function afterChange()
    local before = entryKey
    loadFirstIfGone()
    refresh()
    if entryKey ~= before then
        scrollTop()
    end
end

-- Manage ability timelines --------------------------------------------------------------------------
-- A panel beside the window with every ability timeline of the picked boss, yours and shipped.

local MANAGE_W, MANAGE_H, LINE_H = 470, 340, 28

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

local function lineAction(entry)
    if entry.own then
        confirm("Delete your %s copy?", entry.ref.difficulty or entry.ref.boss, "Delete", function()
            Reference:Delete(entry.key)
            CRT:Print("Deleted your copy of the " .. entry.ref.boss .. " ability timeline.")
            afterChange()
        end)
    elseif entry.removed then
        Reference:SetRemoved(entry, false)
        CRT:Print("Kept the shipped " .. entry.ref.boss .. " ability timeline; it shows again.")
        afterChange()
    else
        Reference:SetRemoved(entry, true)
        CRT:Print("Marked the shipped " .. entry.ref.boss .. " ability timeline for removal; it's hidden on this computer. Export removals lists it for Claude.")
        afterChange()
    end
end

local function manageLine(i)
    local l = manage.lines[i]
    if l then
        return l
    end
    l = CreateFrame("Frame", nil, manage.list)
    l:SetSize(MANAGE_W - 50, LINE_H)
    l:SetPoint("TOPLEFT", manage.list, "TOPLEFT", 0, -(i - 1) * LINE_H)
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
    manage.lines[i] = l
    return l
end

local function refreshManage()
    local boss = manage.boss
    local entries = boss and Reference:ForBoss(boss.id, boss.name, true) or {}
    manage.heading:SetText(boss and boss.name or "No boss picked")
    local own = 0
    for i, entry in ipairs(entries) do
        local l = manageLine(i)
        l.entry = entry
        l.action:SetLabel(entry.own and "Delete" or entry.removed and "Keep" or "Remove from addon")
        l.text:SetWidth(l:GetWidth() - l.action:GetWidth() - 8)
        l.text:SetText(entryLabel(entry))
        l:Show()
        if entry.own then
            own = own + 1
        end
    end
    for i = #entries + 1, #manage.lines do
        manage.lines[i].entry = nil
        manage.lines[i]:Hide()
    end
    manage.list:SetHeight(math.max(#entries, 1) * LINE_H)
    manage.none:SetShown(#entries == 0)
    manage.own = own
    manage.deleteAll:SetEnabled(own > 0)
end

local function buildManage()
    manage = UI.Window("CowfeeRaidToolsReferenceManage", { kind = "dialog", title = "Manage ability timelines", width = MANAGE_W, height = MANAGE_H })
    manage:SetToplevel(true)
    manage.lines = {}
    manage.refresh = refreshManage

    manage.heading = manage:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    manage.heading:SetPoint("TOPLEFT", 14, -34)
    UI.HelpRight(manage.heading, "Manage ability timelines", "Every ability timeline of this boss, yours and shipped.\n\nDelete removes one of your copies; Delete all my copies removes every copy of yours for this boss. The shipped ones stay.\n\nThe game can't change the addon's files, so a shipped one is removed in two steps. Remove from addon hides it on this computer at once and marks it for removal; Keep undoes that. Export removals (or /crt dev removed) lists the marks: paste them to Claude, who deletes those blocks from the boss files. Opening this panel clears marks whose blocks are already gone.\n\nA marked one also leaves the alerts and notes on this computer, as a preview of the deletion.")

    local scroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsReferenceManageScroll", manage, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(scroll.ScrollBar)
    scroll:SetPoint("TOPLEFT", 14, -60)
    scroll:SetPoint("BOTTOMRIGHT", -32, 46)
    manage.list = CreateFrame("Frame", nil, scroll)
    manage.list:SetSize(MANAGE_W - 50, 1)
    scroll:SetScrollChild(manage.list)
    manage.none = manage:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    manage.none:SetPoint("TOPLEFT", 14, -64)
    manage.none:SetText("No ability timelines for this boss.")

    manage.deleteAll = button(manage, "Delete all my copies")
    manage.deleteAll:SetPoint("BOTTOMLEFT", 14, 14)
    manage.deleteAll:SetScript("OnClick", function()
        local boss, n = manage.boss, manage.own or 0
        if not boss or n == 0 then
            return
        end
        confirm("Delete %s?", n == 1 and ("your copy of " .. boss.name) or (n .. " copies of " .. boss.name), "Delete all", function()
            local count = Reference:DeleteOwn(boss.id, boss.name)
            CRT:Print(string.format("Deleted %d of your copies of %s; the shipped ability timelines stay.", count, boss.name))
            afterChange()
        end)
    end)
    local export = button(manage, "Export removals")
    export:SetPoint("LEFT", manage.deleteAll, "RIGHT", 6, 0)
    export:SetScript("OnClick", exportRemovals)
    manage:HookScript("OnShow", refreshManage)
end

-- Opens the panel for the boss of the picked ability timeline, beside the window.
local function openManage()
    local entry = entryKey and Reference:Find(entryKey)
    if not entry then
        CRT:Print("Pick an ability timeline first.")
        return
    end
    if not manage then
        buildManage()
    end
    manage.boss = { id = bossID(entry.ref), name = entry.ref.boss }
    local pruned = Reference:PruneRemoved()
    if pruned > 0 then
        CRT:Print(string.format("Cleared %d removal mark%s: those ability timelines are already gone from the boss files.", pruned, pruned == 1 and "" or "s"))
    end
    manage:ClearAllPoints()
    manage:SetPoint("TOPLEFT", win, "TOPRIGHT", 4, 0)
    manage:Show()
    manage:Raise()
    refreshManage()
end

local function onSave()
    local entry = entryKey and Reference:Find(entryKey)
    local text = currentText()
    if not entry or not text then
        CRT:Print("Pick an ability timeline first.")
        return
    end
    local ok, errors
    if entry.own then
        ok, errors = Reference:Update(entryKey, text)
    else
        ok, errors = Reference:Add(text)
        if ok then
            entryKey = ok
        end
    end
    if not ok then
        CRT:Print("Couldn't save: " .. table.concat(errors or {}, "; "))
        return
    end
    baseText = text
    CRT:Print("Saved your copy of the " .. (entry.ref.boss or "boss") .. " ability timeline.")
    refresh()
end

local function buildButtons()
    local save = button(win, "Save as my copy")
    save:SetPoint("BOTTOMLEFT", 14, 14)
    save:SetScript("OnClick", onSave)
    local export = button(win, "Export")
    export:SetPoint("LEFT", save, "RIGHT", 6, 0)
    export:SetScript("OnClick", function()
        local text = currentText()
        if not text then
            CRT:Print("Pick an ability timeline first.")
            return
        end
        CRT.ConsumablesTools:ShowText("Ability timeline with types (Ctrl+C to copy, paste to Claude)", text)
    end)
    win.delete = button(win, "Delete my copy")
    win.delete:SetPoint("LEFT", export, "RIGHT", 6, 0)
    win.delete:SetScript("OnClick", function()
        local entry = entryKey and Reference:Find(entryKey)
        if entry and entry.own then
            Reference:Delete(entryKey)
            CRT:Print("Deleted your copy; the shipped ability timeline shows again.")
            afterChange()
        end
    end)
    win.manage = button(win, "Manage ability timelines\226\128\166")
    win.manage:SetPoint("LEFT", win.delete, "RIGHT", 6, 0)
    win.manage:SetScript("OnClick", openManage)
end

local function build()
    local height = math.min(HEIGHT, math.floor((UIParent:GetHeight() or HEIGHT) - 40))
    win = UI.Window("CowfeeRaidToolsReferenceTypes", { kind = "dialog", title = "Logged Timeline Ref (dev)", width = WIDTH, height = height })
    win:SetToplevel(true)

    win.pick = UI.Dropdown(win, "Reference", {
        options = referenceOptions,
        labelWidth = 70,
        width = 320,
        get = function()
            return entryKey
        end,
        set = function(key)
            load(key)
            local entry = manage and manage:IsShown() and Reference:Find(key)
            if entry then
                manage.boss = { id = bossID(entry.ref), name = entry.ref.boss }
            end
            refresh()
            scrollTop()
        end,
    })
    win.pick:SetPoint("TOPLEFT", 14, -34)
    UI.HelpRight(win.pick, "Logged Timeline Ref", "Main colors the ability's row on the Timeline; Also adds a dot per type, and the tooltip lists them all. No type is a plain white row.\n\nSave as my copy to see it on the Timeline, then Export and paste the text to Claude, who ships it in the boss's file.\n\nManage ability timelines lists every ability timeline of this boss: delete your copies, or mark a shipped one for removal.\n\n" .. Reference.Legend())

    local head = win:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    head:SetPoint("TOPLEFT", 14, -72)
    head:SetText("Ability")
    local headMain = win:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    headMain:SetPoint("TOPLEFT", 189, -72)
    headMain:SetText("Main type")
    local headAlso = win:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    headAlso:SetPoint("TOPLEFT", 309, -72)
    headAlso:SetText("Also")

    -- Only the abilities scroll; the picker, headers, status line and buttons stay put.
    win.scroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsReferenceTypesScroll", win, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(win.scroll.ScrollBar)
    win.scroll:SetPoint("TOPLEFT", 14, -LIST_TOP)
    win.scroll:SetPoint("BOTTOMRIGHT", -32, LIST_BOTTOM)
    win.list = CreateFrame("Frame", nil, win.scroll)
    win.list:SetSize(WIDTH - 46, ROW_H)
    win.scroll:SetScrollChild(win.list)

    win.status = win:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    win.status:SetPoint("BOTTOMLEFT", 14, 44)
    win.status:SetWidth(WIDTH - 28)
    win.status:SetJustifyH("LEFT")

    buildButtons()
    win:HookScript("OnShow", refresh)
    win:HookScript("OnHide", function()
        if manage then
            manage:Hide()
        end
    end)
    UI:SkinTree(win)
end

function Editor:Toggle()
    if not win then
        build()
        local list = referenceOptions()
        load(list[1] and list[1].key or nil)
    end
    win:SetShown(not win:IsShown())
    refresh()
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
