local ADDON, CRT = ...

-- DEVELOPER ONLY for now. The Modules page: the module switches (CRT_Core/Modules.lua) as a list, under a
-- "Core" and an "Optional" heading. Each row has the module's name on the left (greyed when its switch is off),
-- its (?) (what turns off and what keeps working, the registry's help) and a round power button on the right.
-- Core's power button is disabled: Core is always on. Clicking a power button flips the switch (saved at once,
-- Modules:Set) and asks "<Module> will be turned off after a reload. Reload now?" (Reload / Later); in combat it
-- only says to reload after combat. While a saved switch differs from what this session runs, "Reload to apply."
-- shows at the top of the page.
-- The page is hidden like the Development page: /crt modules shows and opens it, and closing the main window
-- hides it again. This file never ships: its .toc line is inside the do-not-package block, and so is
-- /crt modules in Slash.lua. A release build has no page, so its off message names none (Modules:OffText).

local UI = CRT.UI
local M = CRT.Modules

local TEXT = {
    title = "Modules",
    hint = "Turn off the parts of the addon you don't use, to keep it light. A change takes effect after a reload.\n\nThe switches are saved per profile. Export settings only never shares them.",
    core = "Core",
    optional = "Optional",
    pending = "Reload to apply.",
    turnOff = "Turn %s off",
    turnOn = "Turn %s on",
    alwaysOn = "Core is always on.",
    ask = "%s will be turned %s after a reload. Reload now?",
    askCombat = "%s will be turned %s after a reload. Reload after combat.",
    off = "off",
    on = "on",
    reload = "Reload",
    later = "Later",
    ok = "OK",
    combat = "Can't reload during combat. Reload after combat.",
    offPage = "%s is turned off. Turn it on in Modules (/crt modules).",
}

-- Numbers, in px
local L = {
    left = 8,
    top = -44,      -- the Core heading, under the title
    headingH = 22,  -- a heading and the space under it
    groupGap = 12,  -- between Core's row and the Optional heading
    rowW = 340,
    rowH = 28,
    power = 22,     -- the power button
    icon = 16,      -- the symbol inside it
    statusGap = 40, -- from the title to Reload to apply., clear of the title's (?)
}

local MEDIA = CRT.MEDIA or ("Interface\\AddOns\\" .. ADDON .. "\\CRT_Media\\Media\\")
-- the power symbol: a 64 x 64 white shape on alpha, in CRT_Dev (never packaged) until the page ships, when it
-- moves to CRT_Media/Media beside Check.tga
local POWER = "Interface\\AddOns\\" .. ADDON .. "\\CRT_Dev\\Media\\Power"
local DISC = MEDIA .. "Disc"
local RING = MEDIA .. "RingThin"
local POPUP, POPUP_COMBAT = "CRT_MODULES_RELOAD", "CRT_MODULES_RELOAD_COMBAT"

local page
local rows = {}
local status

local P = { rows = rows, TEXT = TEXT }
CRT.ModulesPage = P

local function inCombat()
    return InCombatLockdown and InCombatLockdown() and true or false
end

-- True while a saved switch differs from what this session runs.
local function pending()
    for _, def in ipairs(M:List()) do
        if M:Saved(def.key) ~= M:IsOn(def.key) then
            return true
        end
    end
    return false
end
P.Pending = pending

-- What the power button's tooltip says.
function P.PowerTip(key)
    if key == M.CORE then
        return TEXT.alwaysOn
    end
    local def = M:Get(key)
    return (M:Saved(key) and TEXT.turnOff or TEXT.turnOn):format(def and def.label or key)
end

-- The power button: a round surface with an edge, the symbol in the text colour when on and muted when
-- off, an accent glow under the mouse.
local function paintPower(b, on)
    UI.Tint(b.icon, "SetVertexColor", on and "text" or "muted")
end

local function powerButton(parent, key)
    local b = CreateFrame("Button", nil, parent)
    b:SetSize(L.power, L.power)
    b.face = b:CreateTexture(nil, "BACKGROUND")
    b.face:SetTexture(DISC)
    b.face:SetAllPoints()
    UI.Tint(b.face, "SetVertexColor", "surface")
    b.edge = b:CreateTexture(nil, "BORDER")
    b.edge:SetTexture(RING)
    b.edge:SetAllPoints()
    UI.Tint(b.edge, "SetVertexColor", "border")
    b.glow = b:CreateTexture(nil, "HIGHLIGHT")
    b.glow:SetTexture(DISC)
    b.glow:SetAllPoints()
    UI.Tint(b.glow, "SetVertexColor", "accent", 0.35)
    b.icon = b:CreateTexture(nil, "ARTWORK")
    b.icon:SetTexture(POWER)
    b.icon:SetSize(L.icon, L.icon)
    b.icon:SetPoint("CENTER")
    b:SetMotionScriptsWhileDisabled(true)
    b:SetScript("OnEnter", function(self)
        UI.TooltipOwner(GameTooltip, self, "ANCHOR_RIGHT")
        GameTooltip:SetText(P.PowerTip(key), 1, 1, 1)
        GameTooltip:Show()
    end)
    b:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    return b
end

function P.Refresh()
    if not page then
        return
    end
    for _, row in ipairs(rows) do
        local on = M:Saved(row.key)
        UI.Tint(row.label, "SetTextColor", on and "text" or "muted")
        paintPower(row.power, on)
    end
    status:SetShown(pending())
end

local function ensurePopups()
    if StaticPopupDialogs[POPUP] then
        return
    end
    StaticPopupDialogs[POPUP] = {
        text = TEXT.ask,
        button1 = TEXT.reload,
        button2 = TEXT.later,
        timeout = 0,
        whileDead = true,
        hideOnEscape = true,
        preferredIndex = 3,
        -- combat can start while it is open
        OnAccept = function()
            if inCombat() then
                CRT:Print(TEXT.combat)
            else
                ReloadUI()
            end
        end,
    }
    StaticPopupDialogs[POPUP_COMBAT] = {
        text = TEXT.askCombat,
        button1 = TEXT.ok,
        timeout = 0,
        whileDead = true,
        hideOnEscape = true,
        preferredIndex = 3,
    }
end

-- Flips a module's switch, saved at once, and asks to reload. Later keeps it saved.
function P.Toggle(key)
    local def = M:Get(key)
    if not def or key == M.CORE then
        return
    end
    local on = not M:Saved(key)
    M:Set(key, on)
    P.Refresh()
    ensurePopups()
    local name = inCombat() and POPUP_COMBAT or POPUP
    UI.LiftOver(UI.ShownPopup(StaticPopup_Show(name, def.label, on and TEXT.on or TEXT.off), name))
end

local function heading(pf, y, text)
    local fs = pf:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    fs:SetPoint("TOPLEFT", L.left, y)
    fs:SetText(text)
    UI.Tint(fs, "SetTextColor", "heading")
    return fs
end

local function makeRow(pf, y, key, label, help)
    local f = CreateFrame("Frame", nil, pf)
    f:SetSize(L.rowW, L.rowH)
    f:SetPoint("TOPLEFT", L.left, y)
    local line = f:CreateTexture(nil, "BACKGROUND")
    line:SetHeight(1)
    line:SetPoint("BOTTOMLEFT")
    line:SetPoint("BOTTOMRIGHT")
    UI.Tint(line, "SetColorTexture", "border", 0.5)
    local name = f:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    name:SetPoint("LEFT", 4, 0)
    name:SetJustifyH("LEFT")
    name:SetText(label)
    local power = powerButton(f, key)
    power:SetPoint("RIGHT", -4, 0)
    if key == M.CORE then
        power:Disable()
        power:SetAlpha(0.6)
    else
        power:SetScript("OnClick", function()
            P.Toggle(key)
        end)
    end
    local row = { key = key, frame = f, label = name, power = power, helpText = help }
    row.help = UI.HelpRight(name, label, help)
    rows[#rows + 1] = row
    return row
end

local function build(pf)
    page = pf
    local title = pf:CreateFontString(nil, "OVERLAY", "CRTFontLarge")
    title:SetPoint("TOPLEFT", L.left, -8)
    title:SetText(TEXT.title)
    UI.HelpRight(title, TEXT.title, TEXT.hint)

    status = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    status:SetPoint("LEFT", title, "RIGHT", L.statusGap, 0)
    status:SetText(TEXT.pending)
    UI.Tint(status, "SetTextColor", "warn")
    P.status = status

    local y = L.top
    heading(pf, y, TEXT.core)
    y = y - L.headingH
    makeRow(pf, y, M.CORE, M.CORE_INFO.label, M.CORE_INFO.help)
    y = y - L.rowH - L.groupGap
    heading(pf, y, TEXT.optional)
    y = y - L.headingH
    for _, def in ipairs(M:List()) do
        makeRow(pf, y, def.key, def.label, def.help)
        y = y - L.rowH
    end

    pf:SetScript("OnShow", P.Refresh)
    P.Refresh()
end

UI:RegisterPage("modules", TEXT.title, build)
UI:SetPageHidden("modules", true, true)

-- /crt modules (Slash.lua's do-not-package block)
function P.Open()
    UI:SetPageHidden("modules", false)
    UI:Show("modules")
end

-- With the page here, the off message says where to turn a module on.
M.pageText = TEXT.offPage
