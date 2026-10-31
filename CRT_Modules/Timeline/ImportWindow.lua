local ADDON, CRT = ...

-- The Import reminders window, opened by the Timeline's Import reminders button (Timeline/Page.lua): a box to
-- paste an export in, a preview with one row per boss (its difficulty, how many reminders it would import and
-- how many lines it skips, each skipped line and why in the row's tooltip), a Replace tick box and Import N.
-- The reading and writing are CRT.TimelineImport's (Timeline/ImportReminders.lua); this file only draws.
-- Imported reminders are your own, on the Personal notes row; Import is refused during combat. The window's
-- place is kept in timeline.importWindow, and the Replace tick in timeline.importReplace (on by default).

local UI = CRT.UI

local W = {}
CRT.TimelineImportWindow = W

local TEXT = {
    title = "Import reminders",
    help = "Paste a %s export in the box. The list shows each boss in it: how many reminders it gives you and how many lines it skips. Hover a boss to see why a line is skipped.\n\nOnly lines for everyone and for your class are imported. They become your own reminders on the Personal notes row, never raid note lines.",
    paste = "Paste an export in the box.",
    nothing = "Nothing in it to import.",
    replace = "Replace what I imported before for these bosses",
    replaceHelp = "On: the reminders you imported before for each boss and difficulty in the box are deleted first, then these are added. Your other reminders stay.\n\nOff: these are added to what you have. A reminder you already have (the same time and text) is not added twice.",
    import = "Import %d",
    close = "Close",
    toImport = "%d to import",
    skipped = "%d skipped",
    notInSeason = "not in this season",
    skippedTitle = "Skipped lines",
    more = "and %d more",
    noBoss = "No boss line found.",
    imported = "Imported %d.",
    removed = "Replaced %d.",
    dupes = "%d you already had.",
    leftOut = "%d skipped.",
    failed = "%d could not be saved.",
    groups = { nh = "Normal/Heroic", mythic = "Mythic" },
}
W.TEXT = TEXT

local L = {
    width = 520, height = 520,
    pasteH = 150, listH = 190, rowH = 22,
    checkSize = 22, statusH = 30, buttonH = 22, buttonGap = 6, gap = 6,
    countW = 170,
    tipLines = 15, -- skipped lines listed in a row's tooltip, then "and N more"
}
W.L = L

local win
local state = { plan = nil }

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

-- The preview -----------------------------------------------------------------------------------------------

local function rowTip(row)
    local p = row.boss
    if not (p and GameTooltip and UI.TooltipOwner) then
        return
    end
    UI.TooltipOwner(GameTooltip, row, "ANCHOR_RIGHT")
    GameTooltip:SetText(p.name or tostring(p.encounterID or "?"), 1, 1, 1, 1, true)
    if p.reason then
        GameTooltip:AddLine(p.reason, 1, 0.5, 0.4, true)
    elseif not p.known then
        GameTooltip:AddLine(TEXT.notInSeason, 0.85, 0.85, 0.85, true)
    end
    if #p.skipped > 0 then
        GameTooltip:AddLine(TEXT.skippedTitle, 1, 0.82, 0, true)
        for i, s in ipairs(p.skipped) do
            if i > L.tipLines then
                GameTooltip:AddLine(TEXT.more:format(#p.skipped - L.tipLines), 0.85, 0.85, 0.85, true)
                break
            end
            GameTooltip:AddLine(s.reason .. ": " .. s.line, 0.85, 0.85, 0.85, true)
        end
    end
    GameTooltip:Show()
end

local function makeRow(list, i)
    local row = CreateFrame("Button", nil, list.child)
    row:SetHeight(L.rowH)
    local hl = row:CreateTexture(nil, "HIGHLIGHT")
    hl:SetAllPoints()
    hl:SetColorTexture(1, 1, 1, 0.06)
    row.count = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    row.count:SetPoint("RIGHT", -4, 0)
    row.count:SetWidth(L.countW)
    row.count:SetJustifyH("RIGHT")
    row.count:SetWordWrap(false)
    row.name = row:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    row.name:SetPoint("LEFT", 4, 0)
    row.name:SetPoint("RIGHT", row.count, "LEFT", -L.gap, 0)
    row.name:SetJustifyH("LEFT")
    row.name:SetWordWrap(false)
    row:SetScript("OnEnter", rowTip)
    row:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    list.rows[i] = row
    return row
end

-- One boss's row: "Ula'tek · Normal/Heroic" (with "not in this season" for a boss the season doesn't have), then
-- "16 to import · 2 skipped" at the right, the skipped part in the warn colour.
local function bossLine(p)
    local name = p.name or tostring(p.encounterID or "?")
    local parts = { name }
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
    local count = TEXT.toImport:format(#p.reminders)
    if #p.skipped > 0 then
        count = count .. " \194\183 " .. UI.ColorText(TEXT.skipped:format(#p.skipped), "warn")
    end
    return text, count
end

local function fillList()
    local list = win.list
    local bosses = state.plan and state.plan.bosses or {}
    for i, p in ipairs(bosses) do
        local row = list.rows[i] or makeRow(list, i)
        row.boss = p
        row:ClearAllPoints()
        row:SetPoint("TOPLEFT", list.child, "TOPLEFT", 0, -(i - 1) * L.rowH)
        row:SetPoint("RIGHT", list.child, "RIGHT", 0, 0)
        local name, count = bossLine(p)
        row.name:SetText(name)
        row.count:SetText(count)
        row:Show()
    end
    for i = #bosses + 1, #list.rows do
        list.rows[i].boss = nil
        list.rows[i]:Hide()
    end
    list.child:SetHeight(math.max(1, #bosses * L.rowH))
end

local function paintButton()
    local b = win.importBtn
    local n = state.plan and state.plan.count or 0
    b:SetText(TEXT.import:format(n))
    local fs = b:GetFontString()
    b:SetWidth(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0))
    b:SetEnabled(n > 0)
end

-- Reads the box again. status (optional) is the line to keep showing, such as what was just imported.
local function readBox(status, color)
    local text = win.paste.edit:GetText() or ""
    local Import = CRT.TimelineImport
    if text:match("^%s*$") then
        state.plan = nil
    else
        state.plan = Import.Plan(Import.Parse(text), Import.PlayerClassID())
    end
    fillList()
    paintButton()
    if status then
        setStatus(status, color)
    elseif not state.plan then
        setStatus(TEXT.paste)
    elseif #state.plan.bosses == 0 then
        setStatus(TEXT.noBoss, "bad")
    elseif state.plan.count == 0 then
        setStatus(TEXT.nothing, "warn")
    else
        setStatus("")
    end
end

-- The line under the list after an import: what was imported and replaced, then what was left out.
local function resultLine(res)
    local skipped = 0
    for _, p in ipairs(state.plan and state.plan.bosses or {}) do
        skipped = skipped + #p.skipped
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
        setStatus(err, "bad")
        return
    end
    local line, color = resultLine(res)
    -- the Timeline draws your reminders again on the alerts' change event, which Apply fires once
    setStatus(line, color)
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
    local top = L.pasteH + L.gap
    list:SetPoint("TOPLEFT", 0, -top)
    list:SetPoint("TOPRIGHT", 0, -top)
    list:SetHeight(L.listH)
    return list
end

local function buildReplace(c)
    local top = L.pasteH + L.gap + L.listH + L.gap
    local cb = CreateFrame("CheckButton", nil, c, "UICheckButtonTemplate")
    cb:SetSize(L.checkSize, L.checkSize)
    cb:SetPoint("TOPLEFT", 0, -top)
    UI:SkinCheckButton(cb)
    cb.Label = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    cb.Label:SetPoint("LEFT", cb, "RIGHT", 2, 0)
    cb.Label:SetJustifyH("LEFT")
    cb.Label:SetText(TEXT.replace)
    cb:SetScript("OnClick", function(self)
        settings().importReplace = self:GetChecked() and true or false
    end)
    UI.HelpRight(cb.Label, TEXT.replace, TEXT.replaceHelp)
    return cb
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
    win.replace = buildReplace(c)
    win.status = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    win.status:SetPoint("TOPLEFT", 4, -(L.pasteH + L.gap + L.listH + L.gap + L.checkSize + L.gap))
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
        fillList()
        paintButton()
    end
    return win
end

-- Opens the window, its box empty and ready to paste in.
function W.Open()
    if not win then
        build()
    end
    win.paste.edit:SetText("")
    win.replace:SetChecked(replaceOn())
    win:Show()
    readBox()
    win.paste.edit:SetFocus()
    return win
end

-- For tests: the window once built.
function W.Window()
    return win
end
