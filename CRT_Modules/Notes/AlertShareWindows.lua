local ADDON, CRT = ...

-- The players' Export and Import windows of Mech Alerts (the Export and Import buttons under the Mechanics
-- list, Notes/Reminders.lua): your Mech Alerts and your special alert choices as a !CRT:alerts:1: code to paste
-- to a friend, and a friend's code back into yours. Every part of the work is CRT.AlertShare's
-- (Alerts/Share.lua): Parts lists what to tick, Export writes the ticked ones, Read compares a code with what
-- you have (new, replaces yours, same as yours), Apply writes the ticked ones. This file only draws.
--   Export   a boss (or all bosses, in route order), a list of your alerts to tick (all ticked to start), and
--            the code of the ticked ones in a box, selected for Ctrl+C. It changes as you tick.
--   Import   a box to paste in; once the code reads, "From <name> · <boss> · <difficulty>" and every alert in
--            it with a tick and a tag: new and replaces yours ticked, same as yours not. Import N writes the
--            ticked ones (never during combat: Apply refuses and the error line says so).
-- A player's Import reads no special alert definitions (Read with defs = false): only choices on the special
-- alerts this CRT ships. Nothing is sent over chat.

local UI = CRT.UI

local W = {}
CRT.NoteAlertShare = W

local TEXT = {
    exportTitle = "Export Mech Alerts",
    exportHelp = "Pick a boss, then tick the alerts to share: your Mech Alerts and your special alert choices. The box at the bottom holds the code of the ticked ones, selected: press Ctrl+C to copy it. Your friend pastes it in Import on Mech Alerts. Nothing is sent over chat.",
    importTitle = "Import Mech Alerts",
    importHelp = "Paste a code from Export in the box. The list shows each alert in it.\n\nNew: you don't have it.\nReplaces yours: your alert for the same ability (or the same text) on that boss and difficulty is changed to this one.\nSame as yours: nothing would change.\n\nTick the ones you want, then Import.",
    boss = "Boss",
    allBosses = "All bosses",
    mechAlert = "Mech Alert",
    specialAlert = "Special alert",
    exported = "%d ticked. Press Ctrl+C to copy the code.",
    noneTicked = "Nothing ticked.",
    paste = "Paste a code in the box.",
    import = "Import %d",
    cancel = "Cancel",
    tags = { new = "new", replace = "replaces yours", same = "same as yours" },
    imported = "Imported %d.",
    nothingChanged = "Nothing changed: it is all the same as yours.",
    leftOut = "%d left out: not valid.",
    anyDifficulty = "Any difficulty",
}
W.TEXT = TEXT

-- the tag colours: new is good, replaces yours a warning, same as yours quiet
local TAG_COLORS = { new = "good", replace = "warn", same = "muted" }
local ALL = "all"

local L = {
    exportW = 460, exportH = 470,
    importW = 460, importH = 490,
    labelW = 40, dropW = 260,
    listTop = 34, exportListH = 210, importListH = 230,
    rowH = 22, headH = 20, checkSize = 22,
    nameX = 26, tagW = 104, tagGap = 6,
    statusH = 30, buttonH = 22, buttonGap = 6,
    pasteH = 64, fromH = 18,
    boxPad = 6,
}
W.L = L

local function trim(s)
    return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

local function contentW(width)
    return width - 2 * (UI.WINDOW_DEFAULTS and UI.WINDOW_DEFAULTS.inset or 8)
end

-- A 1 px bordered box on the window's background, as the catalog's read-only scrolling text box.
local function borderedBox(parent)
    local box = CreateFrame("Frame", nil, parent, "BackdropTemplate")
    box:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    UI.Tint(box, "SetBackdropColor", "background", 0.6)
    UI.Tint(box, "SetBackdropBorderColor", "border")
    return box
end

local function scrollIn(box, name)
    local scroll = CreateFrame("ScrollFrame", name, box, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(scroll.ScrollBar)
    scroll:SetPoint("TOPLEFT", L.boxPad, -L.boxPad)
    scroll:SetPoint("BOTTOMRIGHT", -(4 + UI.ScrollGutter()), L.boxPad)
    return scroll
end

-- A code box: a bordered box with a multi-line edit box that scrolls. onUserText(edit) runs when the player
-- types or pastes.
local function codeBox(parent, name, width, onUserText)
    local box = borderedBox(parent)
    local scroll = scrollIn(box, name)
    local edit = CreateFrame("EditBox", nil, scroll)
    edit:SetMultiLine(true)
    edit:SetAutoFocus(false)
    edit:SetFontObject(_G.CRTFontEditSmall or CRTFontEdit)
    edit:SetWidth(width - 2 * L.boxPad - 4 - UI.ScrollGutter())
    edit:SetScript("OnEscapePressed", edit.ClearFocus)
    edit:SetScript("OnTextChanged", function(self, user)
        if user then
            onUserText(self)
        end
    end)
    scroll:SetScrollChild(edit)
    -- a click anywhere in the box puts the cursor in it
    box:EnableMouse(true)
    box:SetScript("OnMouseDown", function()
        edit:SetFocus()
    end)
    box.edit = edit
    return box
end

-- The list --------------------------------------------------------------------------------------------
-- A bordered box that scrolls, of rows made as they are needed: a heading (a boss's name, when the list has
-- several bosses) or an alert with a tick, its name (cut short with "...", the whole name in its tooltip) and
-- a tag on the right.

local function rowTip(row)
    local e = row.entry
    if not (e and not e.heading and GameTooltip and UI.TooltipOwner) then
        return
    end
    UI.TooltipOwner(GameTooltip, row, "ANCHOR_RIGHT")
    GameTooltip:SetText(e.label or "", 1, 1, 1, 1, true)
    for _, line in ipairs(e.tip or {}) do
        GameTooltip:AddLine(line, 0.85, 0.85, 0.85, true)
    end
    GameTooltip:Show()
end

local function makeRow(list, i)
    local row = CreateFrame("Button", nil, list.child)
    row:SetHeight(L.rowH)
    row:SetPoint("LEFT", 0, 0)
    row:SetPoint("RIGHT", 0, 0)
    local hl = row:CreateTexture(nil, "HIGHLIGHT")
    hl:SetAllPoints()
    hl:SetColorTexture(1, 1, 1, 0.06)
    row.check = CreateFrame("CheckButton", nil, row, "UICheckButtonTemplate")
    row.check:SetSize(L.checkSize, L.checkSize)
    row.check:SetPoint("LEFT", 2, 0)
    UI:SkinCheckButton(row.check)
    row.check:SetScript("OnClick", function(self)
        list.onTick(row.entry, self:GetChecked() and true or false)
    end)
    row.check:SetScript("OnEnter", function()
        rowTip(row)
    end)
    row.check:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    row.name = row:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    row.name:SetJustifyH("LEFT")
    row.name:SetWordWrap(false)
    row.tag = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    row.tag:SetPoint("RIGHT", -4, 0)
    row.tag:SetWidth(L.tagW)
    row.tag:SetJustifyH("RIGHT")
    row.tag:SetWordWrap(false)
    -- a click on the row, outside the tick, ticks it too
    row:SetScript("OnClick", function()
        if row.entry and not row.entry.heading then
            row.check:SetChecked(not row.check:GetChecked())
            list.onTick(row.entry, row.check:GetChecked() and true or false)
        end
    end)
    row:SetScript("OnEnter", rowTip)
    row:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    list.rows[i] = row
    return row
end

-- entries: { { heading = text } or { label, tag, tagColor, checked, tip = { line, ... } } }.
local function fillList(list, entries)
    list.entries = entries
    local y = 0
    for i, e in ipairs(entries) do
        local row = list.rows[i] or makeRow(list, i)
        row.entry = e
        row:ClearAllPoints()
        row:SetPoint("TOPLEFT", list.child, "TOPLEFT", 0, -y)
        row:SetPoint("RIGHT", list.child, "RIGHT", 0, 0)
        row.name:ClearAllPoints()
        if e.heading then
            row:SetHeight(L.headH)
            row.check:Hide()
            row.tag:Hide()
            row.name:SetPoint("LEFT", 4, 0)
            row.name:SetPoint("RIGHT", -4, 0)
            row.name:SetText(UI.HeadingText(e.heading))
            y = y + L.headH
        else
            row:SetHeight(L.rowH)
            row.check:Show()
            row.check:SetChecked(e.checked and true or false)
            row.tag:Show()
            row.tag:SetText(e.tag and UI.ColorText(e.tag, e.tagColor or "muted") or "")
            row.name:SetPoint("LEFT", L.nameX, 0)
            row.name:SetPoint("RIGHT", row.tag, "LEFT", -L.tagGap, 0)
            row.name:SetText(e.label or "")
            y = y + L.rowH
        end
        row:Show()
    end
    for i = #entries + 1, #list.rows do
        list.rows[i].entry = nil
        list.rows[i]:Hide()
    end
    list.child:SetHeight(math.max(1, y))
end

local function makeList(parent, name, width, onTick)
    local box = borderedBox(parent)
    local scroll = scrollIn(box, name)
    local child = CreateFrame("Frame", nil, scroll)
    child:SetSize(width - 2 * L.boxPad - 4 - UI.ScrollGutter(), 1)
    scroll:SetScrollChild(child)
    box.scroll, box.child, box.rows, box.entries, box.onTick = scroll, child, {}, {}, onTick
    return box
end

local function groupText(group)
    return CRT.AlertShare.TEXT.groups[group] or TEXT.anyDifficulty
end

local function kindText(kind)
    return kind == "special" and TEXT.specialAlert or TEXT.mechAlert
end

-- Entries for parts (AS:Parts or Read's items), a boss heading over each boss's when there are several.
local function entriesFor(parts, several, build)
    local out, last = {}, nil
    for _, p in ipairs(parts) do
        if several and p.enc ~= last then
            out[#out + 1] = { heading = CRT.AlertShare.BossName(p.enc) }
            last = p.enc
        end
        local e = build(p)
        e.label = e.label or p.label
        e.tip = { CRT.AlertShare.BossName(p.enc), groupText(p.group), kindText(p.kind) }
        out[#out + 1] = e
    end
    return out
end

local function setStatus(fs, text, color)
    fs:SetText(color and UI.ColorText(text, color) or text)
end

-- Export ------------------------------------------------------------------------------------------------

local ex = { boss = nil, ticks = {} }

local function exportOpts()
    return { bosses = ex.boss ~= ALL and { ex.boss } or nil, special = true, reminders = true }
end

local function ticked(part)
    return ex.ticks[part.id] ~= false
end

-- The code of the ticked parts, selected in the box; or the reason there is none.
local function writeCode()
    local win = ex.win
    local opts = exportOpts()
    opts.pick = ticked
    local code, n = CRT.AlertShare:Export(opts)
    local edit = win.code.edit
    ex.text = code or ""
    edit:SetText(ex.text)
    if not code then
        local nothing = #ex.parts > 0 and TEXT.noneTicked or n
        setStatus(win.status, nothing or TEXT.noneTicked, "bad")
        return
    end
    edit:SetFocus()
    edit:HighlightText()
    setStatus(win.status, TEXT.exported:format(n))
end

local function paintExport()
    ex.parts = CRT.AlertShare:Parts(exportOpts())
    local several = ex.boss == ALL
    fillList(ex.win.list, entriesFor(ex.parts, several, function(p)
        return { part = p, checked = ticked(p), tag = kindText(p.kind), tagColor = "muted" }
    end))
    writeCode()
end

local function bossOptions()
    local out = { { key = ALL, label = TEXT.allBosses } }
    local Bosses = CRT.Bosses
    for _, o in ipairs(Bosses and Bosses.Options and Bosses:Options() or {}) do
        out[#out + 1] = o
    end
    return out
end

local function buildExport()
    local win = UI.Window("CowfeeRaidToolsAlertShareExport", { kind = "dialog", title = TEXT.exportTitle, width = L.exportW, height = L.exportH })
    win.strip:SetHelp(TEXT.exportTitle, TEXT.exportHelp)
    ex.win = win
    local c = win.content
    local width = contentW(L.exportW)
    win.boss = UI.Dropdown(c, TEXT.boss, { options = bossOptions, labelWidth = L.labelW, width = L.dropW,
        get = function()
            return ex.boss
        end,
        set = function(key)
            if key == ALL or type(key) == "number" then
                ex.boss = key
                paintExport()
            end
        end })
    win.boss:SetPoint("TOPLEFT", 4, -4)
    win.list = makeList(c, "CowfeeRaidToolsAlertShareExportList", width, function(entry, on)
        ex.ticks[entry.part.id] = on
        entry.checked = on
        writeCode()
    end)
    win.list:SetPoint("TOPLEFT", 0, -L.listTop)
    win.list:SetPoint("TOPRIGHT", 0, -L.listTop)
    win.list:SetHeight(L.exportListH)
    win.status = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    win.status:SetPoint("TOPLEFT", 4, -(L.listTop + L.exportListH + 6))
    win.status:SetPoint("RIGHT", c, "RIGHT", -4, 0)
    win.status:SetHeight(L.statusH)
    win.status:SetJustifyH("LEFT")
    win.status:SetJustifyV("TOP")
    win.status:SetWordWrap(true)
    -- the code is read-only: typing in the box puts the code back
    win.code = codeBox(c, "CowfeeRaidToolsAlertShareExportCode", width, function(edit)
        edit:SetText(ex.text or "")
        edit:HighlightText()
    end)
    win.code:SetPoint("TOPLEFT", 0, -(L.listTop + L.exportListH + 6 + L.statusH + 4))
    win.code:SetPoint("BOTTOMRIGHT", 0, 0)
    win.refresh = function()
        win.boss.refresh()
        paintExport()
    end
    return win
end

-- Opens Export on a boss (the one Mech Alerts shows; nil keeps the last one). Ticks stay for the session.
function W.OpenExport(enc)
    local win = ex.win or buildExport()
    ex.boss = (type(enc) == "number" and enc) or ex.boss or ALL
    win:Show()
    win.refresh()
    return win
end

-- Import ------------------------------------------------------------------------------------------------

local im = { info = nil, ticks = {} }

local function importCount()
    local n = 0
    for _, it in ipairs(im.info and im.info.items or {}) do
        if im.ticks[it] then
            n = n + 1
        end
    end
    return n
end

local function paintButton()
    local b = im.win.importBtn
    local n = importCount()
    b:SetText(TEXT.import:format(n))
    local fs = b:GetFontString()
    b:SetWidth(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0))
    b:SetEnabled(n > 0)
end

local function paintImport()
    local win, info = im.win, im.info
    win.from:SetText(info and CRT.AlertShare.FromLine(info) or "")
    local items = info and info.items or {}
    fillList(win.list, entriesFor(items, info and #info.bosses > 1, function(it)
        return { item = it, checked = im.ticks[it] and true or false, tag = TEXT.tags[it.status], tagColor = TAG_COLORS[it.status] }
    end))
    paintButton()
end

-- Reads the box. status (optional) is the line to show once it reads, instead of the left-out count.
local function readBox(status, color)
    local win = im.win
    local text = win.paste.edit:GetText() or ""
    im.info, im.ticks = nil, {}
    if trim(text) == "" then
        setStatus(win.status, TEXT.paste)
        paintImport()
        return
    end
    local info, err = CRT.AlertShare:Read(text, { defs = false })
    if not info then
        setStatus(win.status, err, "bad")
        paintImport()
        return
    end
    im.info = info
    for _, it in ipairs(info.items) do
        -- same as yours starts unticked: importing it changes nothing
        im.ticks[it] = it.status == "new" or it.status == "replace"
    end
    if status then
        setStatus(win.status, status, color)
    elseif info.dropped > 0 then
        setStatus(win.status, TEXT.leftOut:format(info.dropped), "warn")
    else
        setStatus(win.status, "")
    end
    paintImport()
end

local function doImport()
    local info = im.info
    if not info then
        return
    end
    local n, err = CRT.AlertShare:Apply(info, function(item)
        return im.ticks[item]
    end)
    if not n then
        -- during combat: Apply refuses, the error line says so and the ticks stay
        setStatus(im.win.status, err, "bad")
        return
    end
    -- read again: what was imported is the same as yours now
    if n > 0 then
        readBox(TEXT.imported:format(n), "good")
    else
        setStatus(im.win.status, TEXT.nothingChanged)
    end
end

local function buildImport()
    local win = UI.Window("CowfeeRaidToolsAlertShareImport", { kind = "dialog", title = TEXT.importTitle, width = L.importW, height = L.importH })
    win.strip:SetHelp(TEXT.importTitle, TEXT.importHelp)
    im.win = win
    local c = win.content
    local width = contentW(L.importW)
    win.paste = codeBox(c, "CowfeeRaidToolsAlertShareImportCode", width, function()
        readBox()
    end)
    win.paste:SetPoint("TOPLEFT", 0, 0)
    win.paste:SetPoint("TOPRIGHT", 0, 0)
    win.paste:SetHeight(L.pasteH)
    win.from = c:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    win.from:SetPoint("TOPLEFT", 4, -(L.pasteH + 6))
    win.from:SetPoint("RIGHT", c, "RIGHT", -4, 0)
    win.from:SetHeight(L.fromH)
    win.from:SetJustifyH("LEFT")
    win.from:SetWordWrap(false)
    local listTop = L.pasteH + 6 + L.fromH + 4
    win.list = makeList(c, "CowfeeRaidToolsAlertShareImportList", width, function(entry, on)
        im.ticks[entry.item] = on
        entry.checked = on
        paintButton()
    end)
    win.list:SetPoint("TOPLEFT", 0, -listTop)
    win.list:SetPoint("TOPRIGHT", 0, -listTop)
    win.list:SetHeight(L.importListH)
    win.status = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    win.status:SetPoint("TOPLEFT", 4, -(listTop + L.importListH + 6))
    win.status:SetPoint("RIGHT", c, "RIGHT", -4, 0)
    win.status:SetHeight(L.statusH)
    win.status:SetJustifyH("LEFT")
    win.status:SetJustifyV("TOP")
    win.status:SetWordWrap(true)
    win.cancelBtn = UI.PanelButton(c, TEXT.cancel, L.buttonH, function()
        win:Hide()
    end)
    win.cancelBtn:SetPoint("BOTTOMRIGHT", 0, 0)
    win.importBtn = UI.PanelButton(c, TEXT.import:format(0), L.buttonH, doImport)
    win.importBtn:SetPoint("RIGHT", win.cancelBtn, "LEFT", -L.buttonGap, 0)
    -- a theme switch: the tags' colours again
    win.refresh = paintImport
    return win
end

-- Opens Import, its box empty and ready to paste in.
function W.OpenImport()
    local win = im.win or buildImport()
    win.paste.edit:SetText("")
    win:Show()
    readBox()
    win.paste.edit:SetFocus()
    return win
end

-- For tests: the windows once built.
function W.Windows()
    return ex.win, im.win
end
