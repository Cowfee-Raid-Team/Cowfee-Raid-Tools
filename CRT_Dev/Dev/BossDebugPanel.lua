local ADDON, CRT = ...

-- DEVELOPER ONLY. The Development page's Boss debug section (Dev/DevPage.lua calls Panel.Build): the
-- "Log every boss pull" checkbox, Clear logs, and one row per boss that has a log (Dev/BossDebug.lua), in
-- route order: the boss and difficulty, then the time, kill or wipe and its length, lines and secret
-- values, and Copy, which opens the log in the copy window. Rows are pooled and filled again on
-- BossDebug:OnChange while the page shows, and when it opens.
--
-- This file never ships: its .toc line is inside the do-not-package block.

local UI = CRT.UI
local BossDebug = CRT.BossDebug

local Panel = {}
CRT.BossDebugPanel = Panel

-- Every number the section is placed with, in px, from the section's top left.
local L = {
    width = 330, -- the page's middle column
    checkY = -18, -- the checkbox row under the heading
    rowsY = -50, -- the first row
    rowH = 26, -- a row: two lines of small text
    infoY = -13, -- the second line in a row
    copyH = 20,
}
Panel.MAX_ROWS = 10
Panel.HEIGHT = -L.rowsY + Panel.MAX_ROWS * L.rowH -- 310: what the page leaves for the section

local TEXT = {
    heading = "Boss debug",
    check = "Log every boss pull",
    help = "While on, every boss pull records its phase events, boss casts, deaths and shield reads in one log per boss. A new pull on the same boss replaces the old log. Nothing ships; nothing shows during the pull.",
    clear = "Clear logs",
    confirm = "Clear every boss debug log? Boss debug stays on or off as it is.",
    cancel = "Cancel",
    copy = "Copy",
    empty = "No boss logs yet.",
    more = "%d more: /crt dev bossdebug show lists them all.",
}

local function confirmClear()
    if not StaticPopup_ShowCustomGenericConfirmation then
        return
    end
    UI.LiftOver(UI.ShownPopup(StaticPopup_ShowCustomGenericConfirmation({
        text = TEXT.confirm,
        acceptText = TEXT.clear,
        cancelText = TEXT.cancel,
        showAlert = true,
        callback = function()
            BossDebug:Clear()
        end,
    }), "GENERIC_CONFIRMATION"))
end

local function makeRow(pf, x, y, i)
    local row = CreateFrame("Frame", nil, pf)
    row:SetSize(L.width, L.rowH)
    row:SetPoint("TOPLEFT", x, y + L.rowsY - (i - 1) * L.rowH)
    row.copy = UI.PanelButton(row, TEXT.copy, L.copyH, function()
        if row.encounterID then
            BossDebug:Copy(row.encounterID)
        end
    end)
    row.copy:SetPoint("RIGHT", row, "RIGHT", 0, 0)
    local textW = L.width - (row.copy:GetWidth() or 0) - 8
    row.title = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    row.title:SetPoint("TOPLEFT", 0, 0)
    row.info = row:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    row.info:SetPoint("TOPLEFT", 0, L.infoY)
    for _, fs in ipairs({ row.title, row.info }) do
        fs:SetWidth(textW)
        fs:SetJustifyH("LEFT")
        fs:SetWordWrap(false)
    end
    return row
end

-- Builds the section at x, y on the page frame pf. Returns { check, clear, rows, refresh }.
function Panel.Build(pf, x, y)
    local sec = { rows = {} }

    local heading = pf:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    heading:SetPoint("TOPLEFT", x, y)
    heading:SetText(TEXT.heading)

    local check = CreateFrame("CheckButton", nil, pf, "UICheckButtonTemplate")
    check:SetSize(24, 24)
    check:SetPoint("TOPLEFT", x - 3, y + L.checkY)
    check.label = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    check.label:SetPoint("LEFT", check, "RIGHT", 2, 0)
    check.label:SetText(TEXT.check)
    UI.HelpRight(check.label, TEXT.check, TEXT.help)
    check:SetScript("OnClick", function(self)
        BossDebug:SetOn(self:GetChecked() and true or false)
    end)
    sec.check = check

    sec.clear = UI.PanelButton(pf, TEXT.clear, 22, confirmClear)
    sec.clear:SetPoint("TOPRIGHT", pf, "TOPLEFT", x + L.width, y + L.checkY - 1)

    local empty = pf:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    empty:SetPoint("TOPLEFT", x, y + L.rowsY)
    empty:SetText(TEXT.empty)
    local more = pf:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    more:SetPoint("TOPLEFT", x, y + L.rowsY - (Panel.MAX_ROWS - 1) * L.rowH)

    function sec.refresh()
        check:SetChecked(BossDebug:IsOn())
        local list = BossDebug:List()
        local count = #list > Panel.MAX_ROWS and Panel.MAX_ROWS - 1 or #list
        for i = 1, count do
            local row = sec.rows[i]
            if not row then
                row = makeRow(pf, x, y, i)
                sec.rows[i] = row
            end
            local title, info = BossDebug:RowText(list[i])
            row.encounterID = list[i].encounterID
            row.title:SetText(title)
            row.info:SetText(info)
            row:Show()
        end
        for i = count + 1, #sec.rows do
            sec.rows[i].encounterID = nil
            sec.rows[i]:Hide()
        end
        empty:SetShown(#list == 0)
        more:SetShown(#list > count)
        more:SetText(string.format(TEXT.more, #list - count))
    end

    BossDebug:OnChange(function()
        if check:IsVisible() then
            sec.refresh()
        end
    end)
    return sec
end
