local ADDON, CRT = ...

-- The note History window: a stored raid note's earlier versions (Notes:History, Notes/Data.lua), opened
-- from History on Raid Notes > Notes and in the pop-out editor's title bar.
--   CRT.NoteHistory.Open(id)   shows the note's versions: the text now first, then up to five earlier ones,
--                              newest first, each with when, how and who, and its line count.
-- Compare shows a line diff (Notes/Diff.lua) of a version against the text now: lines the same muted,
-- removed lines "- " in the bad colour, added lines "+ " in the good colour, with a count of each.
-- Restore asks first, then puts the version back as the note's text (Notes:Restore): the text now is kept
-- as a "restored" entry, so restoring that entry undoes it. Only your copy changes until you share it.

local UI = CRT.UI
local Notes = CRT.Notes
local Diff = CRT.NoteDiff

local TEXT = {
    title = "History: %s",
    helpTitle = "History",
    help = "The note's last 5 earlier versions, newest first. Each row is the note as it was just before a change: when it changed, how, and who changed it.\n\nCompare shows what changed between that version and the note now: + lines were added since, - lines were removed.\n\nRestore puts that version back as the note's text. The text now is kept here first, so you can restore it again to undo. Only your copy changes: click Share to raid to send it.\n\nHistory stays on this computer. It is never shared or exported.",
    when = "When",
    how = "How",
    lines = "Lines",
    now = "Now",
    current = "The note as it is now",
    edited = "Edited by %s",
    lineEdits = "Lines changed by %s",
    imported = "Imported by %s",
    received = "Received from %s",
    restored = "Restored by %s",
    restoredFrom = "Restored by %s (the version from %s)",
    someone = "someone",
    compare = "Compare",
    restore = "Restore",
    compareTip = "Shows what changed between this version and the note now.",
    restoreTip = "Puts this version back as the note's text. The text now is kept in History, so you can undo it.",
    pick = "Click Compare on a version to see what changed since.",
    summary = "The version from %s against now: %d added, %d removed",
    same = "The version from %s is the same as the note now.",
    confirm = "Restore the version of %s from %s?\n\nThe text now is kept in History, so you can undo this. Nothing is shared until you click Share to raid.",
    confirmButton = "Restore this version",
    cancel = CANCEL or "Cancel",
    done = "Restored the version of %s from %s. Click Share to raid to send it.",
    failed = "That version couldn't be restored. The note may have changed or been deleted.",
}

-- Sizes, in the window's content area (UI.Window: 8 in from the sides, under the title strip).
local L = {
    width = 640, height = 480,
    headerH = 18, rowH = 26, rowGap = 2,
    whenX = 4, whenW = 120,
    howX = 130, howW = 290,
    linesX = 424, linesW = 44,
    buttonH = 22, buttonGap = 6,
    compareGap = 10, summaryH = 18,
}
local ROWS = 1 + (Notes.HISTORY_MAX or 5) -- the note now, then its earlier versions

local H = { rows = {} }
CRT.NoteHistory = H

local function when(at)
    return at and date("%Y-%m-%d %H:%M", at) or "?"
end

-- How a version changed, and who: "Received from Rixxy".
local function howText(entry)
    local who = Notes.ShortName(entry.who) or TEXT.someone
    if entry.how == "restored" then
        return entry.from and string.format(TEXT.restoredFrom, who, when(entry.from)) or string.format(TEXT.restored, who)
    elseif entry.how == "received" then
        return string.format(TEXT.received, who)
    elseif entry.how == "imported" then
        return string.format(TEXT.imported, who)
    elseif entry.lines then
        return string.format(TEXT.lineEdits, who)
    end
    return string.format(TEXT.edited, who)
end
H.HowText = howText

local function lineCount(text)
    return #Diff.Split(text)
end

-- Note text shown as it is written: a "|" would start the game's colour and link codes.
local function plain(text)
    return (text:gsub("|", "||"))
end

-- The diff of a version against now, as one coloured text.
function H.DiffText(oldText, newText)
    local lines, added, removed = Diff.Lines(oldText, newText)
    local out = {}
    for i, line in ipairs(lines) do
        local t = plain(line.text)
        if line.op == "add" then
            out[i] = UI.GoodText("+ " .. t)
        elseif line.op == "remove" then
            out[i] = UI.BadText("- " .. t)
        else
            out[i] = UI.ColorText("  " .. t, "muted")
        end
    end
    return table.concat(out, "\n"), added, removed
end

-- Whether you may restore into this note: your own (personal) note always; a shared one as Save text
-- changes allows (Notes:CanEditRaid). Returns ok and the reason when not.
local function canRestore(record)
    if record and record.personal then
        return true
    end
    return Notes:CanEditRaid()
end

local function showTip(owner, title, text)
    UI.TooltipOwner(GameTooltip, owner, "ANCHOR_TOP")
    GameTooltip:SetText(title, 1, 1, 1)
    if text and text ~= "" then
        GameTooltip:AddLine(text, 0.85, 0.85, 0.85, true)
    end
    GameTooltip:Show()
end

local function hideTip()
    GameTooltip:Hide()
end

-- Drawing --------------------------------------------------------------------------------------------------

function H.Refresh()
    local win = H.window
    if not (win and win:IsShown()) then
        return
    end
    local record = Notes:Get(H.id)
    if not record then
        win:Hide()
        return
    end
    local name = (record.name or "?") .. (record.difficulty and (" (" .. record.difficulty .. ")") or "")
    win.strip:SetTitle(string.format(TEXT.title, name))
    local entries = Notes:History(H.id)
    local allowed, why = canRestore(record)
    -- the compared version, found again by its entry: a restore adds a row above it
    local compared
    for i, entry in ipairs(entries) do
        if entry == H.compared then
            compared = i
        end
    end
    if not compared then
        H.compared = nil
    end
    for i = 1, ROWS do
        local row = H.rows[i]
        local entry = i > 1 and entries[i - 1] or nil
        if i == 1 then
            row.when:SetText(TEXT.now)
            row.how:SetText(TEXT.current)
            row.lines:SetText(tostring(lineCount(record.raw)))
            row.compare:Hide()
            row.restore:Hide()
            row:Show()
        elseif entry then
            row.entry = entry
            row.index = i - 1
            row.when:SetText(when(entry.at))
            row.how:SetText(howText(entry))
            row.lines:SetText(tostring(lineCount(entry.text)))
            row.compare:Show()
            row.restore:Show()
            row.restore:SetEnabled(allowed and entry.text ~= record.raw and true or false)
            row.restore.why = (not allowed) and why or nil
            row.sel:SetShown(entry == H.compared)
            row:Show()
        else
            row.entry, row.index = nil, nil
            row:Hide()
        end
    end
    H.DrawCompare(record)
end

-- The compared version against the note now, or a line saying how to pick one.
function H.DrawCompare(record)
    local entry = H.compared
    if not entry then
        H.summary:SetText(TEXT.pick)
        H.diff:SetText("")
    else
        local text, added, removed = H.DiffText(entry.text, record.raw or "")
        if added == 0 and removed == 0 then
            H.summary:SetText(string.format(TEXT.same, when(entry.at)))
        else
            H.summary:SetText(string.format(TEXT.summary, when(entry.at), added, removed))
        end
        H.diff:SetText(text)
    end
    H.diffChild:SetHeight(math.max(1, (H.diff:GetStringHeight() or 0) + 4))
end

-- Asks, then restores a version.
function H.AskRestore(index)
    local record = Notes:Get(H.id)
    local entry = Notes:History(H.id)[index]
    if not (record and entry) or not canRestore(record) then
        return
    end
    local id, version = H.id, when(entry.at)
    local function restore()
        -- the same version still there, and still yours to change
        if Notes:History(id)[index] ~= entry or not canRestore(Notes:Get(id)) or not Notes:Restore(id, index) then
            CRT:Print(TEXT.failed)
            return
        end
        CRT:Print(string.format(TEXT.done, record.name or "the note", version))
    end
    if not StaticPopup_ShowCustomGenericConfirmation then
        return
    end
    UI.LiftOver(UI.ShownPopup(StaticPopup_ShowCustomGenericConfirmation({
        text = string.format(TEXT.confirm, record.name or "the note", version),
        acceptText = TEXT.confirmButton,
        cancelText = TEXT.cancel,
        showAlert = true,
        callback = restore,
    }), "GENERIC_CONFIRMATION"))
end

-- Building -------------------------------------------------------------------------------------------------

local function makeRow(c, i)
    local row = CreateFrame("Frame", nil, c)
    row:SetHeight(L.rowH)
    row:SetPoint("TOPLEFT", 0, -(L.headerH + (i - 1) * (L.rowH + L.rowGap)))
    row:SetPoint("RIGHT", c, "RIGHT", 0, 0)
    row.sel = row:CreateTexture(nil, "BACKGROUND")
    row.sel:SetAllPoints()
    UI.Tint(row.sel, "SetColorTexture", "accent", 0.18)
    row.sel:Hide()
    local function cell(x, w, font)
        local fs = row:CreateFontString(nil, "OVERLAY", font or "CRTFontSmall")
        fs:SetPoint("LEFT", x, 0)
        fs:SetWidth(w)
        fs:SetJustifyH("LEFT")
        fs:SetWordWrap(false)
        return fs
    end
    row.when = cell(L.whenX, L.whenW)
    row.how = cell(L.howX, L.howW)
    row.lines = cell(L.linesX, L.linesW)
    row.restore = UI.PanelButton(row, TEXT.restore, L.buttonH, function(self)
        H.AskRestore(self:GetParent().index)
    end)
    row.restore:SetPoint("RIGHT", 0, 0)
    row.restore:SetMotionScriptsWhileDisabled(true)
    row.restore:SetScript("OnEnter", function(self)
        showTip(self, TEXT.restore, self.why and UI.BadText(self.why) or TEXT.restoreTip)
    end)
    row.restore:SetScript("OnLeave", hideTip)
    row.compare = UI.PanelButton(row, TEXT.compare, L.buttonH, function(self)
        local entry = self:GetParent().entry
        H.compared = (H.compared ~= entry) and entry or nil
        H.Refresh()
    end)
    row.compare:SetPoint("RIGHT", row.restore, "LEFT", -L.buttonGap, 0)
    row.compare:SetScript("OnEnter", function(self)
        showTip(self, TEXT.compare, TEXT.compareTip)
    end)
    row.compare:SetScript("OnLeave", hideTip)
    return row
end

local function build()
    local win = UI.Window("CowfeeRaidToolsNoteHistory", {
        kind = "dialog", title = TEXT.helpTitle, layer = "popups", width = L.width, height = L.height,
    })
    H.window = win
    win.strip:SetHelp(TEXT.helpTitle, TEXT.help)
    local c = win.content
    -- the column headings
    for _, col in ipairs({ { TEXT.when, L.whenX }, { TEXT.how, L.howX }, { TEXT.lines, L.linesX } }) do
        local fs = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        fs:SetPoint("TOPLEFT", col[2], -2)
        fs:SetText(col[1])
        UI.Tint(fs, "SetTextColor", "heading")
    end
    for i = 1, ROWS do
        H.rows[i] = makeRow(c, i)
    end
    -- Compare: the summary line, then the diff, scrolled
    local top = L.headerH + ROWS * (L.rowH + L.rowGap) + L.compareGap
    H.summary = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    H.summary:SetPoint("TOPLEFT", 4, -top)
    H.summary:SetPoint("RIGHT", c, "RIGHT", -4, 0)
    H.summary:SetJustifyH("LEFT")
    H.summary:SetWordWrap(false)
    local box = CreateFrame("Frame", nil, c, "BackdropTemplate")
    box:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    UI.Tint(box, "SetBackdropColor", "background", 0.6)
    UI.Tint(box, "SetBackdropBorderColor", "border")
    box:SetPoint("TOPLEFT", 0, -(top + L.summaryH))
    box:SetPoint("BOTTOMRIGHT", 0, 0)
    local scroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsNoteHistoryDiff", box, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(scroll.ScrollBar)
    scroll:SetPoint("TOPLEFT", 6, -6)
    scroll:SetPoint("BOTTOMRIGHT", -(4 + UI.ScrollGutter()), 6)
    local childW = L.width - 2 * (UI.WINDOW_DEFAULTS and UI.WINDOW_DEFAULTS.inset or 8) - 10 - UI.ScrollGutter()
    H.diffChild = CreateFrame("Frame", nil, scroll)
    H.diffChild:SetSize(childW, 1)
    scroll:SetScrollChild(H.diffChild)
    H.diff = H.diffChild:CreateFontString(nil, "OVERLAY", _G.CRTFontEditSmall and "CRTFontEditSmall" or "CRTFontSmall")
    H.diff:SetPoint("TOPLEFT", 2, -2)
    H.diff:SetWidth(childW - 4)
    H.diff:SetJustifyH("LEFT")
    H.diffScroll = scroll
    win:SetScript("OnShow", H.Refresh)
    Notes:OnChange(H.Refresh)
    UI:OnTheme(H.Refresh) -- the diff's colours are written into its text
end

-- Opens the window on a stored note (its id). Returns true when it opened.
function H.Open(id)
    if not Notes:Get(id) then
        return false
    end
    if not H.window then
        build()
    end
    if H.id ~= id then
        H.compared = nil
    end
    H.id = id
    if H.window:IsShown() then
        H.Refresh()
    else
        H.window:Show()
    end
    if H.window.Raise then
        H.window:Raise()
    end
    return true
end
