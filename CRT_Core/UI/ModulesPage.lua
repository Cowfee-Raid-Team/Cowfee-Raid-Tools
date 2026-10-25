local ADDON, CRT = ...

-- The Modules page (Core, always there; settings only, so no tabs): a box per module of the registry
-- (CRT_Core/Modules.lua), Core first, ticked and greyed. A box saves CRTDB.modules at once (Modules:Set); a
-- switch takes effect after a /reload, so while any saved switch differs from what this session runs the page
-- shows "Takes effect after a reload." and a Reload to apply button (ReloadUI), disabled in combat. /crt modules
-- opens it (Slash.lua).

local UI = CRT.UI

local TEXT = {
    title = "Modules",
    hint = "Turn off the parts of the addon you don't use, to keep it light. A change takes effect after a reload.\n\nThe switches are saved per profile. Export settings only never shares them.",
    reload = "Reload to apply",
    pending = "Takes effect after a reload.",
    reloadTip = "Reloads your interface, so the modules start or stop as ticked.",
    combat = "Can't reload during combat.",
}

local TOP = -44 -- the first row, under the title
local ROW_H = 28
local LABEL_GAP = 2 -- from a box to its label
local STATUS_GAP = 8 -- from the button to the status line

local page
local rows = {}
local reload, status
local inCombat = false -- from the combat events: InCombatLockdown is still false while PLAYER_REGEN_DISABLED runs

local P = { rows = rows }
CRT.ModulesPage = P

local function combat()
    return inCombat or (InCombatLockdown and InCombatLockdown() and true) or false
end

-- True while a saved switch differs from what this session runs.
local function pending()
    local M = CRT.Modules
    for _, def in ipairs(M:List()) do
        if M:Saved(def.key) ~= M:IsOn(def.key) then
            return true
        end
    end
    return false
end

function P.ReloadTip()
    return combat() and TEXT.combat or TEXT.reloadTip
end

function P.Refresh()
    if not page then
        return
    end
    local M = CRT.Modules
    for _, row in ipairs(rows) do
        row.check:SetChecked(row.key == M.CORE or M:Saved(row.key))
    end
    local show = pending()
    reload:SetShown(show)
    status:SetShown(show)
    reload:SetEnabled(not combat())
end

local function makeRow(pf, i, key, label, help)
    local cb = CreateFrame("CheckButton", nil, pf, "UICheckButtonTemplate")
    cb:SetSize(24, 24)
    cb:SetPoint("TOPLEFT", 6, TOP - (i - 1) * ROW_H)
    cb.label = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    cb.label:SetPoint("LEFT", cb, "RIGHT", LABEL_GAP, 0)
    cb.label:SetText(label)
    local row = { key = key, check = cb, label = cb.label, helpText = help }
    row.help = UI.HelpRight(cb, label, help)
    if key == CRT.Modules.CORE then
        cb:SetChecked(true)
        cb:Disable()
        UI.Tint(cb.label, "SetTextColor", "muted")
    else
        UI.Tint(cb.label, "SetTextColor", "text")
        cb:SetScript("OnClick", function(self)
            CRT.Modules:Set(key, self:GetChecked() and true or false)
            P.Refresh()
        end)
    end
    rows[#rows + 1] = row
    return row
end

local function build(pf)
    page = pf
    local M = CRT.Modules

    local title = pf:CreateFontString(nil, "OVERLAY", "CRTFontLarge")
    title:SetPoint("TOPLEFT", 8, -8)
    title:SetText(TEXT.title)
    UI.HelpRight(title, TEXT.title, TEXT.hint)

    makeRow(pf, 1, M.CORE, M.CORE_INFO.label, M.CORE_INFO.help)
    for _, def in ipairs(M:List()) do
        makeRow(pf, #rows + 1, def.key, def.label, def.help)
    end

    reload = UI.PanelButton(pf, TEXT.reload, 22, function()
        if not combat() then
            ReloadUI()
        end
    end)
    reload:SetPoint("TOPLEFT", 8, TOP - #rows * ROW_H - 12)
    reload:SetMotionScriptsWhileDisabled(true)
    reload:SetScript("OnEnter", function(self)
        UI.TooltipOwner(GameTooltip, self, "ANCHOR_RIGHT")
        GameTooltip:SetText(TEXT.reload, 1, 1, 1)
        GameTooltip:AddLine(P.ReloadTip(), 0.85, 0.85, 0.85, true)
        GameTooltip:Show()
    end)
    reload:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    P.reload = reload

    status = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    status:SetPoint("LEFT", reload, "RIGHT", STATUS_GAP, 0)
    status:SetText(TEXT.pending)
    UI.Tint(status, "SetTextColor", "warn")
    P.status = status

    pf:SetScript("OnShow", P.Refresh)
    P.Refresh()
end

UI:RegisterPage("modules", TEXT.title, build)

-- The button follows combat while the page shows.
local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_REGEN_DISABLED")
events:RegisterEvent("PLAYER_REGEN_ENABLED")
events:SetScript("OnEvent", function(_, event)
    inCombat = event == "PLAYER_REGEN_DISABLED"
    if page and page:IsShown() then
        P.Refresh()
    end
end)

function P.Open()
    UI:Show("modules")
end
