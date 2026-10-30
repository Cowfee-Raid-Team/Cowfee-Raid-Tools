local ADDON, CRT = ...

-- Who has it: a pop-out window (UI.Window, its place and size kept in CRTDB.interrupts.whoWindow), opened by the
-- Interrupts page's "Who has it (N of M)" button beside Share to raid. Each player on the kick list in use once, with
-- the Addon check's answer (General Settings), and Check now to ask the group again. It reads the Addon check only
-- while it is shown; the button's counts come from the Addon check's answers kept, through the page's cached group
-- (Interrupts/PagePalette.lua: Page.MemberOf).

local UI = CRT.UI
local Interrupts = CRT.Interrupts
local Page = CRT.InterruptsPage

local TEXT = {
    title = "Who has it",
    button = "Who has it (%d of %d)",
    buttonNone = "Who has it",
    help = "Each player on the kick list once, and whether their CRT has Interrupts on, from the Addon check on General Settings. Green: on. Orange: an older CRT, or Interrupts off. Red: no CRT.",
    more = "and %d more",
    check = "Check now",
    noNames = "No names on the list yet.",
    notHere = "not in your group",
    you = "you, v%s",
    on = "v%s",
    off = "Interrupts off",
    tooOld = "v%s, no Interrupts",
    older = "older CRT v%s",
    none = "No CRT",
    waiting = "asking...",
    offline = "offline",
}
Page.WhoTextTable = TEXT

local LAYOUT = {
    width = 380, height = 380, minWidth = 300, minHeight = 200,
    top = -30, -- the first row, under Check now
    rowH = 18, stateW = 150, buttonH = 22, maxRows = 40,
}
Page.WhoLayout = LAYOUT

local Who = {}
Page.Who = Who
local win

-- A player's Addon check answer, in its colour; on: whether it counts as having Interrupts.
local function standing(name)
    local m = Page.MemberOf(name)
    if not (m and CRT.AddonCheck) then
        return UI.ColorText(TEXT.notHere, "muted"), false
    end
    local state, version, modules = CRT.AddonCheck:Status(m.row, m.row.online)
    version = tostring(version or "?")
    local on = modules and modules.interrupts
    if state == "you" or state == "same" or state == "newer" then
        if on == true then
            return UI.GoodText(string.format(state == "you" and TEXT.you or TEXT.on, version)), true
        end
        return UI.WarnText(on == false and TEXT.off or string.format(TEXT.tooOld, version)), false
    elseif state == "older" then
        return UI.WarnText(string.format(TEXT.older, version)), false
    elseif state == "none" then
        return UI.BadText(TEXT.none), false
    elseif state == "offline" then
        return UI.ColorText(TEXT.offline, "muted"), false
    end
    return UI.ColorText(TEXT.waiting, "muted"), false
end
Page.WhoText = function(name)
    return (standing(name))
end

-- Each player on a list once, in the order they first appear (group order, then kick order), case left out.
function Page.WhoNames(list)
    local names, seen = {}, {}
    for _, col in ipairs(list or {}) do
        for _, name in ipairs(col) do
            if name ~= "" and not seen[name:lower()] then
                seen[name:lower()] = true
                names[#names + 1] = name
            end
        end
    end
    return names
end

local function listNames()
    local key = Page.Boss()
    return Page.WhoNames(key and Interrupts:List(key))
end

-- How many on the list in use have Interrupts on, and how many are on it.
function Who.Counts()
    local names = listNames()
    local on = 0
    for _, name in ipairs(names) do
        if select(2, standing(name)) then
            on = on + 1
        end
    end
    return on, #names
end

function Who.ButtonText()
    local on, total = Who.Counts()
    return total > 0 and string.format(TEXT.button, on, total) or TEXT.buttonNone
end

-- The rows that fit the window's height, made as they are needed.
local function rowsThatFit()
    local h = win.content:GetHeight() or 0
    local n = math.floor((h + LAYOUT.top) / LAYOUT.rowH)
    return math.max(1, math.min(LAYOUT.maxRows, n > 0 and n or 1))
end

local function rowAt(i)
    local row = win.rows[i]
    if not row then
        local c = win.content
        row = { name = Page.Label(c, ""), state = Page.Label(c, "") }
        local y = LAYOUT.top - (i - 1) * LAYOUT.rowH
        row.name:SetPoint("TOPLEFT", 0, y)
        row.name:SetPoint("TOPRIGHT", -LAYOUT.stateW, y)
        row.name:SetWordWrap(false)
        row.state:SetPoint("TOPRIGHT", 0, y)
        row.state:SetWidth(LAYOUT.stateW)
        row.state:SetJustifyH("RIGHT")
        row.state:SetWordWrap(false)
        win.rows[i] = row
    end
    return row
end

-- Fills the rows: only while the window shows.
function Who.Refresh()
    if not (win and win:IsShown()) then
        return
    end
    local names = listNames()
    local rows = rowsThatFit()
    for i = 1, rows do
        local row, name = rowAt(i), names[i]
        if i == rows and #names > rows then
            -- the last row says how many more there are
            row.name:SetText(UI.ColorText(string.format(TEXT.more, #names - rows + 1), "muted"))
            row.state:SetText("")
        elseif i == 1 and not name then
            row.name:SetText(UI.ColorText(TEXT.noNames, "muted"))
            row.state:SetText("")
        else
            row.name:SetText(name or "")
            row.name:SetTextColor(Page.ClassColor(name and Page.ClassOf(name)))
            row.state:SetText(name and (standing(name)) or "")
        end
        row.name:Show()
        row.state:Show()
    end
    for i = rows + 1, #win.rows do
        win.rows[i].name:Hide()
        win.rows[i].state:Hide()
    end
end

local function saved()
    local s = Interrupts:Settings()
    if type(s.whoWindow) ~= "table" then
        s.whoWindow = {}
    end
    return s.whoWindow
end

local function build()
    win = UI.Window("CowfeeRaidToolsKickWho", { kind = "popout", title = TEXT.title, saved = saved,
        width = LAYOUT.width, height = LAYOUT.height, minWidth = LAYOUT.minWidth, minHeight = LAYOUT.minHeight })
    win.strip:SetHelp(TEXT.title, TEXT.help)
    win.rows = {}
    win.check = UI.PanelButton(win.content, TEXT.check, LAYOUT.buttonH, function()
        if CRT.AddonCheck then
            CRT.AddonCheck:Check()
        end
    end)
    win.check:SetPoint("TOPRIGHT", 0, 0)
    -- filled once as it opens and once as its size changes (the grip, Reset); hooked, not set: the shared window
    -- keeps its own scripts
    win:HookScript("OnShow", Who.Refresh)
    win:HookScript("OnSizeChanged", Who.Refresh)
    Who.window = win
    return win
end

function Who.Open()
    if not win then
        build()
    end
    win:Show() -- its OnShow fills it
end

function Who.Toggle()
    if win and win:IsShown() then
        win:Hide()
    else
        Who.Open()
    end
end

function Who.IsShown()
    return win ~= nil and win:IsShown()
end

-- The button beside Share to raid, placed by the page (Page.whoButton); its counts follow the Addon check.
function Who.BuildButton(parent)
    local b = Page.Button(parent, TEXT.buttonNone, Who.Toggle)
    b.refresh = function()
        b:SetText(Who.ButtonText())
        local fs = b:GetFontString()
        b:SetWidth(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0))
    end
    Page.AddControl(b)
    if CRT.AddonCheck then
        CRT.AddonCheck:OnChange(function()
            if parent:IsVisible() then
                b.refresh()
            end
            Who.Refresh()
        end)
    end
    Interrupts:OnChange(Who.Refresh)
    return b
end
