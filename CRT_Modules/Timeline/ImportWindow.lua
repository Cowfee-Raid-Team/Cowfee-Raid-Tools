local ADDON, CRT = ...

-- The Import reminders window, opened by the Timeline's Import reminders button (Timeline/Page.lua): a box to
-- paste an export in, then a list with one row per boss (its difficulty, a "N for you" and a "N for others" pill),
-- which opens (a click; open at once when the paste has one boss) on every line of it: yours first, ticked; then
-- the lines for others, one group per kind of tag ("For another spec (3)"), each group and line with a tick box,
-- unticked; then the lines that couldn't be read, with no tick box. Each line shows its time, its text and who it is
-- for. Under the list: Tick every line, for everyone (ticks every line that reads; unticked, only yours again),
-- Replace, the status line, Import N (the ticked lines) and Close.
-- The reading, the ticks and the writing are CRT.TimelineImport's (Timeline/ImportReminders.lua); this file only
-- draws. The rows are worked out once per paste (and when a boss opens or closes) into state.rows, and a fixed pool of
-- frames (L.pool) paints the ones in view as the list scrolls. Imported reminders are your own, on the Personal notes
-- row; a line imported for someone else alerts you too (import.forOther). Import is refused during combat. The
-- window's place is kept in timeline.importWindow, and the Replace tick in timeline.importReplace (on by default).

local UI = CRT.UI

local W = {}
CRT.TimelineImportWindow = W

local TEXT = {
    title = "Import reminders",
    help = "Paste a %s export in the box. The list shows each boss in it, with how many lines are for you and how many are for others. Click a boss to see its lines.\n\nYour lines are ticked. Tick any line for someone else to import it too: it alerts you like your own, and its flag says who it was for. Lines that couldn't be read can't be imported.\n\nImported lines become your own reminders on the Personal notes row, never raid note lines.",
    paste = "Paste an export in the box.",
    nothing = "Nothing in it to import.",
    noneTicked = "No line is ticked.",
    replace = "Replace what I imported before for these bosses",
    replaceHelp = {
        { "On", "the reminders you imported before for each boss and difficulty in the box are deleted first, then these are added. Your other reminders stay." },
        { "Off", "these are added to what you have. A reminder you already have (the same time and text) is not added twice." },
    },
    tickAll = "Tick every line, for everyone",
    tickAllHelp = {
        { "On", "every line that can be read is ticked, for you or for someone else. A line for someone else alerts you too." },
        { "Off", "only your own lines are ticked again." },
        "A group box ticks or unticks all its lines. Click a line or a group anywhere to tick it.",
    },
    import = "Import %d",
    close = "Close",
    forYou = "%d for you",
    forOthers = "%d for others",
    notInSeason = "not in this season",
    noBoss = "No boss line found.",
    imported = "Imported %d.",
    removed = "Replaced %d.",
    dupes = "%d you already had.",
    leftOut = "%d skipped.",
    failed = "%d could not be saved.",
    groups = { nh = "Normal/Heroic", mythic = "Mythic" },
    -- a boss row's toggle, as the Timeline's own (View.lua's Ignored rows)
    open = "v",
    closed = ">",
}
W.TEXT = TEXT

local L = {
    width = 520, height = 520,
    pasteH = 150, listH = 190, rowH = 22,
    checkSize = 22, lineCheck = 18, statusH = 30, buttonH = 22, buttonGap = 6, gap = 6,
    indent = 18,  -- each level in: a boss's lines, then a group's
    whoW = 120,   -- who a line is for, at its right
    pillPad = 6, pillH = 16,
}
L.pool = math.ceil(L.listH / L.rowH) + 1 -- the row frames: the ones in view and one more
W.L = L

local win
-- plan: what the box reads as; lines: each boss's lines as listed (Import.Lines), by boss; open: the bosses opened, by
-- index; rows: every row of the list, top down; all: Tick every line, for everyone; result: a finished import's
-- status line { text, colour }, kept until the next tick or paste
local state = { plan = nil, lines = {}, open = {}, rows = {}, all = false, result = nil }

local function settings()
    return CRT.Timeline:Settings()
end

local function replaceOn()
    return settings().importReplace ~= false
end

local function contentW()
    return L.width - 2 * (UI.WINDOW_DEFAULTS and UI.WINDOW_DEFAULTS.inset or 8)
end

local function setStatus(text, color)
    win.status:SetText(color and UI.ColorText(text, color) or text)
end

-- The status line from where things stand: a finished import's result (until the next tick or paste), else what is
-- missing (no paste, no boss, no line, nothing ticked), else nothing.
local function paintStatus()
    if state.result then
        setStatus(state.result[1], state.result[2])
        return
    end
    local plan = state.plan
    local any = false
    for _, p in ipairs(plan and plan.bosses or {}) do
        any = any or #p.lines > 0
    end
    if not plan then
        setStatus(TEXT.paste)
    elseif #plan.bosses == 0 then
        setStatus(TEXT.noBoss, "bad")
    elseif not any then
        setStatus(TEXT.nothing, "warn")
    elseif plan.count == 0 then
        setStatus(TEXT.noneTicked, "warn")
    else
        setStatus("")
    end
end

-- The rows ----------------------------------------------------------------------------------------------------

-- Every row of the list, top down: a boss, and when it is open its lines (Import.Lines), each row
-- { type = "boss" | "line" | "group" | "unreadHead" | "unread", depth, p, index, line, group, label }.
local function buildRows()
    local rows = {}
    for i, p in ipairs(state.plan and state.plan.bosses or {}) do
        rows[#rows + 1] = { type = "boss", p = p, index = i, depth = 0 }
        local g = state.lines[i]
        if state.open[i] and g then
            for _, l in ipairs(g.mine) do
                rows[#rows + 1] = { type = "line", line = l, depth = 1 }
            end
            for _, grp in ipairs(g.groups) do
                rows[#rows + 1] = { type = "group", group = grp, depth = 1 }
                for _, l in ipairs(grp.lines) do
                    rows[#rows + 1] = { type = "line", line = l, depth = 2 }
                end
            end
            if #g.unread > 0 then
                rows[#rows + 1] = { type = "unreadHead", label = g.unreadLabel, depth = 1 }
                for _, l in ipairs(g.unread) do
                    rows[#rows + 1] = { type = "unread", line = l, depth = 2 }
                end
            end
        end
    end
    state.rows = rows
end

-- How many of a boss's lines are for others (those that read).
local function othersOf(g)
    local n = 0
    for _, grp in ipairs(g and g.groups or {}) do
        n = n + #grp.lines
    end
    return n
end

-- One boss's name: "Ula'tek · Normal/Heroic", with "not in this season" for a boss the season doesn't have, or the
-- reason it can't be imported.
local function bossName(p)
    local parts = { p.name or tostring(p.encounterID or "?") }
    if p.group then
        parts[#parts + 1] = TEXT.groups[p.group]
    elseif p.difficulty and p.difficulty ~= "" then
        parts[#parts + 1] = p.difficulty
    end
    local text = table.concat(parts, " \194\183 ")
    if p.reason then
        text = text .. " " .. UI.ColorText("(" .. p.reason .. ")", "bad")
    elseif not p.known then
        text = text .. " " .. UI.ColorText("(" .. TEXT.notInSeason .. ")", "muted")
    end
    return text
end

-- A pill: its words in the key's colour on a faint fill of it, as wide as the words.
local function paintPill(pill, text, key)
    pill.label:SetText(text)
    pill.label:SetTextColor(UI.Color(key))
    pill.bg:SetColorTexture(UI.Color(key, 0.18))
    local w = tonumber(pill.label:GetStringWidth() or 0) or 0
    pill:SetWidth(math.ceil(w) + 2 * L.pillPad)
    pill:Show()
end

local paint -- below: the rows in view, again

local function makePill(row)
    local pill = CreateFrame("Frame", nil, row)
    pill:SetHeight(L.pillH)
    pill.bg = pill:CreateTexture(nil, "BACKGROUND")
    pill.bg:SetAllPoints()
    pill.label = pill:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    pill.label:SetPoint("CENTER")
    pill:Hide()
    return pill
end

-- A click on a row's tick box: its line, or every line of its group; then the count and the rows again.
local function tickClicked(check)
    local m = check:GetParent() and check:GetParent().model
    if not (m and state.plan) then
        return
    end
    local on = check:GetChecked() and true or false
    if m.type == "line" then
        CRT.TimelineImport.Tick(state.plan, m.line, on)
    elseif m.type == "group" then
        CRT.TimelineImport.TickGroup(state.plan, m.group, on)
    end
    state.result = nil
    paint()
end

-- A click on a boss row opens or closes it; on a line or group row, anywhere on it, ticks or unticks it.
local function rowClicked(row)
    local m = row.model
    if m and m.type == "boss" then
        state.open[m.index] = not state.open[m.index]
        buildRows()
        paint()
    elseif m and (m.type == "line" or m.type == "group") then
        row.check:SetChecked(not row.check:GetChecked())
        tickClicked(row.check)
    end
end

-- A line's tooltip: its full text, time, who it is for (yours) or why it isn't yours, and the line as pasted; a line
-- that couldn't be read: why, and the line.
local function rowEnter(row)
    local m = row.model
    if not (m and (m.type == "line" or m.type == "unread") and GameTooltip and UI.TooltipOwner) then
        return
    end
    local l = m.line
    local r, g, b = UI.Color("muted")
    UI.TooltipOwner(GameTooltip, row, "ANCHOR_RIGHT")
    if m.type == "line" then
        GameTooltip:SetText(tostring(l.reminder.text or ""), 1, 1, 1, 1, true)
        GameTooltip:AddLine(CRT.TimelineImport.ShowTime(l.ph, l.time), r, g, b)
        GameTooltip:AddLine(l.mine and (l.who or "") or (l.reason or ""), 1, 1, 1, true)
    else
        GameTooltip:SetText(tostring(l.reason or ""), 1, 1, 1, 1, true)
    end
    GameTooltip:AddLine(tostring(l.line or ""), r, g, b, true)
    GameTooltip:Show()
end

local function makeRow(list, k)
    local row = CreateFrame("Button", nil, list.child)
    row:SetHeight(L.rowH)
    local hl = row:CreateTexture(nil, "HIGHLIGHT")
    hl:SetAllPoints()
    hl:SetColorTexture(1, 1, 1, 0.06) -- not a theme colour: the faint white hover every CRT list row has
    row.arrow = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    row.arrow:SetPoint("LEFT", 4, 0)
    row.check = CreateFrame("CheckButton", nil, row, "UICheckButtonTemplate")
    row.check:SetSize(L.lineCheck, L.lineCheck)
    UI:SkinCheckButton(row.check)
    row.check:SetScript("OnClick", tickClicked)
    row.who = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    row.who:SetPoint("RIGHT", -4, 0)
    row.who:SetWidth(L.whoW)
    row.who:SetJustifyH("RIGHT")
    row.who:SetWordWrap(false)
    row.pillOther = makePill(row)
    row.pillOther:SetPoint("RIGHT", -4, 0)
    row.pillMine = makePill(row)
    row.pillMine:SetPoint("RIGHT", row.pillOther, "LEFT", -4, 0)
    row.name = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    row.name:SetJustifyH("LEFT")
    row.name:SetWordWrap(false)
    row:SetScript("OnClick", rowClicked)
    row:SetScript("OnEnter", rowEnter)
    row:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    list.rows[k] = row
    return row
end

-- Draws one row frame for its row (state.rows): a boss's toggle, name and pills; a line's tick, time and text and who;
-- a group's tick and label; the Couldn't read heading and its lines, with no tick.
local function drawRow(row, m)
    local x = 4 + m.depth * L.indent
    row.arrow:SetShown(m.type == "boss")
    row.check:SetShown(m.type == "line" or m.type == "group")
    row.pillMine:Hide()
    row.pillOther:Hide()
    row.who:SetText("")
    row.name:ClearAllPoints()
    if m.type == "line" or m.type == "group" then
        row.check:ClearAllPoints()
        row.check:SetPoint("LEFT", x, 0)
        row.name:SetPoint("LEFT", row.check, "RIGHT", 2, 0)
    else
        row.name:SetPoint("LEFT", m.type == "boss" and 20 or x, 0)
    end
    if m.type == "boss" then
        row.name:SetPoint("RIGHT", row.pillMine, "LEFT", -L.pillPad, 0) -- a long name stops at the pills
    else
        row.name:SetPoint("RIGHT", row, "RIGHT", -(L.whoW + 8), 0) -- clear of who it is for
    end
    if m.type == "boss" then
        row.arrow:SetText(state.open[m.index] and TEXT.open or TEXT.closed)
        row.name:SetText(bossName(m.p))
        local g = state.lines[m.index]
        paintPill(row.pillOther, TEXT.forOthers:format(othersOf(g)), "warn")
        paintPill(row.pillMine, TEXT.forYou:format(g and #g.mine or 0), "good")
    elseif m.type == "line" then
        local l = m.line
        row.check:SetChecked(l.ticked and true or false)
        row.name:SetText(CRT.TimelineImport.ShowTime(l.ph, l.time) .. "  " .. tostring(l.reminder.text or ""))
        row.who:SetText(l.mine and (l.who or "") or UI.ColorText(l.who or "", "muted"))
    elseif m.type == "group" then
        -- ticked only when all its lines are: with some ticked it draws unticked, and a click ticks them all
        row.check:SetChecked(CRT.TimelineImport.GroupTicked(m.group) == true)
        row.name:SetText(UI.ColorText(m.group.label, "warn"))
    elseif m.type == "unreadHead" then
        row.name:SetText(UI.ColorText(m.label, "bad"))
    else
        row.name:SetText(UI.ColorText(tostring(m.line.reason) .. ": " .. tostring(m.line.line), "muted"))
    end
end

local function paintButton()
    local b = win.importBtn
    local n = state.plan and state.plan.count or 0
    b:SetText(TEXT.import:format(n))
    local fs = b:GetFontString()
    b:SetWidth(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0))
    b:SetEnabled(n > 0)
end

-- The rows in view, from where the list is scrolled to: pool frame k shows row first + k, at that row's place.
paint = function()
    local list = win.list
    local scrolled = list.scroll.GetVerticalScroll and list.scroll:GetVerticalScroll()
    local first = math.max(0, math.floor((tonumber(scrolled or 0) or 0) / L.rowH))
    for k = 1, L.pool do
        local m = state.rows[first + k]
        local row = list.rows[k] or (m and makeRow(list, k))
        if row then
            row.model = m
            if m then
                row:ClearAllPoints()
                row:SetPoint("TOPLEFT", list.child, "TOPLEFT", 0, -(first + k - 1) * L.rowH)
                row:SetPoint("RIGHT", list.child, "RIGHT", 0, 0)
                drawRow(row, m)
                row:Show()
            else
                row:Hide()
            end
        end
    end
    list.child:SetHeight(math.max(1, #state.rows * L.rowH))
    paintButton()
    paintStatus()
end

-- Reads the box again: a new plan, its lines listed, a single boss opened, Tick every line kept, the status line from
-- the new plan (paintStatus).
local function readBox()
    local text = win.paste.edit:GetText() or ""
    local Import = CRT.TimelineImport
    state.lines, state.open, state.result = {}, {}, nil
    if text:match("^%s*$") then
        state.plan = nil
    else
        state.plan = Import.Plan(Import.Parse(text), Import.Me())
        for i, p in ipairs(state.plan.bosses) do
            state.lines[i] = Import.Lines(p)
        end
        state.open[1] = #state.plan.bosses == 1 or nil
        if state.all then
            Import.TickAll(state.plan, true)
        end
    end
    buildRows()
    -- a new paste starts at the top of its list
    if win.list.scroll.SetVerticalScroll then
        win.list.scroll:SetVerticalScroll(0)
    end
    paint()
end

-- The line under the list after an import: what was imported and replaced, then the lines left unticked.
local function resultLine(res)
    local skipped = 0
    for _, p in ipairs(state.plan and state.plan.bosses or {}) do
        for _, l in ipairs(p.lines or {}) do
            if not (l.ticked and l.reminder) then
                skipped = skipped + 1
            end
        end
    end
    local parts = { TEXT.imported:format(res.added) }
    if res.removed > 0 then
        parts[#parts + 1] = TEXT.removed:format(res.removed)
    end
    if res.duplicates > 0 then
        parts[#parts + 1] = TEXT.dupes:format(res.duplicates)
    end
    if skipped > 0 then
        parts[#parts + 1] = TEXT.leftOut:format(skipped)
    end
    if res.failed > 0 then
        parts[#parts + 1] = TEXT.failed:format(res.failed)
    end
    return table.concat(parts, " "), (res.failed > 0 and "warn") or "good"
end

local function doImport()
    if not (state.plan and state.plan.count > 0) then
        return
    end
    local res, err = CRT.TimelineImport.Apply(state.plan, { replace = replaceOn() })
    if not res then
        state.result = { err, "bad" }
    else
        -- the Timeline draws your reminders again on the alerts' change event, which Apply fires once
        state.result = { resultLine(res) }
    end
    -- shown until the next tick or paste
    paintStatus()
end

-- Building ------------------------------------------------------------------------------------------------

local function buildPaste(c)
    local box = UI.CodeBox(c, "CowfeeRaidToolsTimelineImportPaste", contentW(), function()
        readBox()
    end)
    box:SetPoint("TOPLEFT", 0, 0)
    box:SetPoint("TOPRIGHT", 0, 0)
    box:SetHeight(L.pasteH)
    return box
end

local function buildList(c)
    local list = UI.ScrollBox(c, "CowfeeRaidToolsTimelineImportList", contentW())
    list.child = CreateFrame("Frame", nil, list.scroll)
    list.child:SetSize(list.innerW, 1)
    list.scroll:SetScrollChild(list.child)
    list.rows = {}
    -- the template's own scroll handling moves the list; the rows in view are painted after it
    list.scroll:HookScript("OnVerticalScroll", function()
        paint()
    end)
    local top = L.pasteH + L.gap
    list:SetPoint("TOPLEFT", 0, -top)
    list:SetPoint("TOPRIGHT", 0, -top)
    list:SetHeight(L.listH)
    return list
end

-- A tick box under the list (the shared check box), its label beside it and a (?) after the label.
local function makeTick(c, top, label, help, onClick)
    local cb = CreateFrame("CheckButton", nil, c, "UICheckButtonTemplate")
    cb:SetSize(L.checkSize, L.checkSize)
    cb:SetPoint("TOPLEFT", 0, -top)
    UI:SkinCheckButton(cb)
    cb.Label = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    cb.Label:SetPoint("LEFT", cb, "RIGHT", 2, 0)
    cb.Label:SetJustifyH("LEFT")
    cb.Label:SetText(label)
    cb:SetScript("OnClick", onClick)
    UI.HelpRight(cb.Label, label, help)
    return cb
end

local function buildTicks(c)
    local top = L.pasteH + L.gap + L.listH + L.gap
    win.all = makeTick(c, top, TEXT.tickAll, TEXT.tickAllHelp, function(self)
        state.all = self:GetChecked() and true or false
        if state.plan then
            CRT.TimelineImport.TickAll(state.plan, state.all)
        end
        state.result = nil
        paint()
    end)
    win.replace = makeTick(c, top + L.checkSize + L.gap, TEXT.replace, TEXT.replaceHelp, function(self)
        settings().importReplace = self:GetChecked() and true or false
    end)
end

local function build()
    win = UI.Window("CowfeeRaidToolsTimelineImport", { kind = "dialog", title = TEXT.title, layer = "popups",
        width = L.width, height = L.height,
        saved = function()
            local s = settings()
            s.importWindow = type(s.importWindow) == "table" and s.importWindow or {}
            return s.importWindow
        end })
    win.strip:SetHelp(TEXT.title, TEXT.help:format(CRT.TimelineImport.FORMAT_NAME))
    local c = win.content
    win.paste = buildPaste(c)
    win.list = buildList(c)
    buildTicks(c)
    win.status = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    win.status:SetPoint("TOPLEFT", 4, -(L.pasteH + L.gap + L.listH + L.gap + 2 * (L.checkSize + L.gap)))
    win.status:SetPoint("RIGHT", c, "RIGHT", -4, 0)
    win.status:SetHeight(L.statusH)
    win.status:SetJustifyH("LEFT")
    win.status:SetJustifyV("TOP")
    win.status:SetWordWrap(true)
    win.closeBtn = UI.PanelButton(c, TEXT.close, L.buttonH, function()
        win:Hide()
    end)
    win.closeBtn:SetPoint("BOTTOMRIGHT", 0, 0)
    win.importBtn = UI.PanelButton(c, TEXT.import:format(0), L.buttonH, doImport)
    win.importBtn:SetPoint("RIGHT", win.closeBtn, "LEFT", -L.buttonGap, 0)
    -- a theme switch: the rows' colours again
    win.refresh = function()
        paint()
    end
    return win
end

-- Opens the window, its box empty and ready to paste in, Tick every line off.
function W.Open()
    if not win then
        build()
    end
    state.all = false
    win.all:SetChecked(false)
    win.paste.edit:SetText("")
    win.replace:SetChecked(replaceOn())
    win:Show()
    readBox()
    win.paste.edit:SetFocus()
    return win
end

-- For tests: the window once built, every row of its list, and a repaint (as a scroll makes).
function W.Window()
    return win
end

function W.Rows()
    return state.rows
end

function W.Paint()
    paint()
end
