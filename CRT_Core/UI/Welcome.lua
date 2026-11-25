local ADDON, CRT = ...

-- The first run (the UX rules: a new player is told CRT is there and where to begin).
--   Chat line  on the login of a fresh install (no CRTDB before it: CRT.freshInstall in Core.lua), one line in
--              CRT's print colour: /crt to open, /crt help for the commands. A fresh install happens once per
--              account, so the line never shows again.
--   Welcome    a small dialog (UI.Window) over the main window: one sentence on what CRT is, then I'm a raider
--              | I lead or assist (UI.Toggle2, neither lit at first), each showing three next steps, a row each
--              with a button that goes there; Got it closes it. The first time the main window opens after a
--              fresh install it opens by itself (CRTDB.welcome.pending, set by Core.lua on a fresh install and
--              cleared when it closes), so a player upgrading never sees it on their own. Start here's Welcome
--              button and /crt welcome open it any time.
-- welcome is account-wide (Profiles.lua's SHARED) and never in Export settings only, like whatsNew.

local W = {}
CRT.Welcome = W
local UI = CRT.UI

local TEXT = CRT.Locale("UI.Welcome", {
    ready = "Ready. Type |cffffd100/crt|r to open it, or |cffffd100/crt help|r for the commands.",
    title = "Welcome to Cowfee Raid Tools",
    intro = "Cowfee Raid Tools helps your raid with boss alerts, raid notes, ready checks and raid layouts.",
    raider = "I'm a raider",
    leader = "I lead or assist",
    pick = "Pick one to see where to start.",
    gotIt = "Got it",
})
W.TEXT = TEXT

-- The next steps for each choice: the step's text, its button's label and where the button goes; spot, for a step
-- that names one setting, the page and key it is registered under (UI:RegisterSpot), spotlighted once there.
local STEPS = {
    raider = {
        -- label() is the button's text while it follows a state; it reads like the title bar's Previews button
        { text = "Place your windows where you want them.", button = "Previews", go = function()
            UI:Show()
            UI:TogglePreviews()
        end, label = function()
            return UI:AnyPreview() and "Previews: ON" or "Previews"
        end },
        { text = "Pick the voice that reads your alerts out.", button = "Alert settings", go = function()
            CRT.NotesPage.Open("alerts")
        end, spot = { "notes", "voice" } },
        { text = "See what's on, and switch off what you don't need.", button = "What's on", go = function()
            UI:Show("start")
        end },
    },
    leader = {
        { text = "Build a raid layout for your groups.", button = "Raid Groups", go = function()
            UI:Show("groups")
        end },
        { text = "Set up the ready check.", button = "Ready Check", go = function()
            UI:Show("readycheck")
        end },
        { text = "Write a note for the next boss.", button = "Raid Notes", go = function()
            CRT.NotesPage.Open("notes")
        end },
    },
}
W.STEPS = STEPS

-- Every number the window is placed with, in px: its width; the gaps under the intro, the choice and between
-- steps; a step's number column and the gap before its button; the choice's and the buttons' heights.
local L = {
    width = 460, top = 4, introGap = 12, choiceGap = 12, stepGap = 8, number = 18, buttonGap = 10,
    choiceH = 24, button = 22, footerGap = 14, aside = 12,
}
W.LAYOUT = L

local function db()
    return CRT.db and CRT.db.welcome
end

local view = { steps = {} }
W.view = view

-- A frame's edges on screen (its own units times its effective scale), or nil before it is laid out.
local function screenRect(f)
    if type(f) ~= "table" or not f.GetLeft then
        return nil
    end
    local l, r, t, b = f:GetLeft(), f:GetRight(), f:GetTop(), f:GetBottom()
    if not (tonumber(l) and tonumber(r) and tonumber(t) and tonumber(b)) then
        return nil
    end
    local s = tonumber(f.GetEffectiveScale and f:GetEffectiveScale()) or 1
    return { l = l * s, r = r * s, t = t * s, b = b * s, s = s }
end

local function overlaps(a, b)
    return a.l < b.r and b.l < a.r and a.b < b.t and b.b < a.t
end

-- A step's spotlighted setting under the Welcome (the voice step's Voice row on Alert settings): the Welcome moves
-- beside the main window, right of it or else left, kept on screen, so the box shows. Returns whether it moved.
local function moveAside(target)
    local win = view.win
    local w, c, m, screen = screenRect(win), screenRect(target), screenRect(UI.frame), screenRect(UIParent)
    if not (w and c and m and screen) or not overlaps(w, c) then
        return false
    end
    local width, height = w.r - w.l, w.t - w.b
    local x = m.r + L.aside
    if x + width > screen.r then
        x = m.l - L.aside - width
    end
    x = math.max(screen.l, math.min(x, screen.r - width))
    local top = math.max(screen.b + height, math.min(w.t, screen.t))
    win:ClearAllPoints()
    win:SetPoint("TOPLEFT", UIParent, "BOTTOMLEFT", x / w.s, top / w.s)
    return true
end
W.MoveAside = moveAside

-- One step row: its number, its text and its button, made the first time it is needed.
local function stepRow(i, c)
    local r = view.steps[i]
    if not r then
        r = {}
        r.number = c:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
        r.number:SetJustifyH("LEFT")
        r.text = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        r.text:SetJustifyH("LEFT")
        r.text:SetWordWrap(true)
        r.button = UI.PanelButton(c, "", L.button, function()
            if r.go then
                r.go()
            end
            if r.spot and UI.GoToSpot then
                local target = UI:GoToSpot(r.spot[1], r.spot[2])
                if target then
                    -- now, and again on the next frame once the page that just opened is laid out
                    moveAside(target)
                    if C_Timer and C_Timer.After then
                        C_Timer.After(0, function()
                            if UI.spotlight and UI.spotlight.target == target then
                                moveAside(target)
                            end
                        end)
                    end
                end
            end
        end)
        view.steps[i] = r
    end
    return r
end

local fill

local function build()
    local win = UI.Window("CRTWelcome", {
        kind = "dialog", title = TEXT.title, width = L.width, height = 200,
        saved = function()
            local d = db()
            return d and d.window
        end,
    })
    local c = win.content
    view.intro = c:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    view.intro:SetJustifyH("LEFT")
    view.intro:SetWordWrap(true)
    view.intro:SetText(TEXT.intro)
    view.choice = UI.Toggle2(c, { { key = "raider", label = TEXT.raider }, { key = "leader", label = TEXT.leader } }, function(key)
        view.picked = key
        fill()
    end, { h = L.choiceH, font = "CRTFontNormal" })
    view.pick = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    view.pick:SetJustifyH("LEFT")
    view.pick:SetText(TEXT.pick)
    view.got = UI.PanelButton(c, TEXT.gotIt, L.button, function()
        win:Hide()
    end)
    view.got:SetPoint("BOTTOMRIGHT", 0, 0)
    -- closed any way (Got it, X, Escape): it no longer opens by itself
    win:HookScript("OnHide", function(self)
        if not self:IsShown() then
            local d = db()
            if d then
                d.pending = false
            end
        end
    end)
    view.win = win
    -- previews turned on or off anywhere (title bar, /crt previews, the main window closing): the button's label
    -- follows, and the row is placed again for its new width
    UI:OnPreviewChange(function()
        if win:IsShown() and view.picked then
            fill()
        end
    end)
end

local function textHeight(fs)
    return math.ceil(fs:GetStringHeight() or 0)
end

-- Places everything from the top and sizes the window to fit, for the choice picked (none at first).
fill = function()
    local win, c = view.win, view.win.content
    local D = UI.WINDOW_DEFAULTS
    local inner = L.width - 2 * D.inset
    local y = L.top
    view.intro:SetWidth(inner)
    view.intro:ClearAllPoints()
    view.intro:SetPoint("TOPLEFT", c, "TOPLEFT", 0, -y)
    y = y + textHeight(view.intro) + L.introGap
    view.choice:Size(inner)
    view.choice:PlaceLeft(0, -y)
    view.choice:Select(view.picked)
    y = y + L.choiceH + L.choiceGap
    local steps = STEPS[view.picked]
    view.pick:SetShown(steps == nil)
    if not steps then
        view.pick:ClearAllPoints()
        view.pick:SetPoint("TOPLEFT", c, "TOPLEFT", 0, -y)
        y = y + textHeight(view.pick) + L.stepGap
    end
    for i, step in ipairs(steps or {}) do
        local r = stepRow(i, c)
        r.go, r.spot = step.go, step.spot
        r.number:SetText(i .. ".")
        r.button:SetText(step.label and step.label() or step.button)
        local fs = r.button:GetFontString()
        r.button:SetWidth(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0))
        r.text:SetWidth(math.max(1, inner - L.number - L.buttonGap - r.button:GetWidth()))
        r.text:SetText(step.text)
        local h = math.max(L.button, textHeight(r.text))
        r.number:ClearAllPoints()
        r.number:SetPoint("TOPLEFT", c, "TOPLEFT", 0, -(y + (h - textHeight(r.number)) / 2))
        r.text:ClearAllPoints()
        r.text:SetPoint("TOPLEFT", c, "TOPLEFT", L.number, -(y + (h - textHeight(r.text)) / 2))
        r.button:ClearAllPoints()
        r.button:SetPoint("TOPRIGHT", c, "TOPRIGHT", 0, -(y + (h - L.button) / 2))
        for _, part in ipairs({ r.number, r.text, r.button }) do
            part:Show()
        end
        r.top, r.h = y, h
        y = y + h + L.stepGap
    end
    for i = #(steps or {}) + 1, #view.steps do
        local r = view.steps[i]
        r.number:Hide()
        r.text:Hide()
        r.button:Hide()
    end
    view.height = math.ceil(D.titleHeight + 4 + y - L.stepGap + L.footerGap + L.button + D.inset)
    win:SetSize(L.width, view.height)
end
W.Fill = function()
    fill()
end

-- Opens the Welcome (Start here's button, /crt welcome), with neither choice picked.
function W:Open()
    if not view.win then
        build()
    end
    view.picked = nil
    fill()
    if not view.win:IsShown() then
        view.win:Show()
    end
    view.win:Raise()
end

-- The main window just opened (UI:Show): the first time after a fresh install, the Welcome opens over it.
function W:FirstOpen()
    local d = db()
    if d and d.pending == true and not (view.win and view.win:IsShown()) then
        self:Open()
    end
end

-- /crt welcome
if CRT.Slash then
    CRT.Slash:Register("welcome", {
        run = function(rest)
            if rest ~= "" then
                return false
            end
            W:Open()
        end,
        help = { "[/crt welcome] - the Welcome: where to start as a raider or as a leader" },
        top = true,
    })
end

-- The chat line, on the login of a fresh install.
local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_LOGIN")
events:SetScript("OnEvent", function(self, event)
    if event ~= "PLAYER_LOGIN" then
        return
    end
    self:UnregisterEvent("PLAYER_LOGIN")
    if CRT.freshInstall then
        CRT:Print(TEXT.ready)
    end
end)
