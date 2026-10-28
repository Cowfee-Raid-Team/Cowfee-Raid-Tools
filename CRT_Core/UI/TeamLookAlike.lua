local ADDON, CRT = ...

-- The look-alike prompt (CRT.TeamLookAlike): two saved teams whose names differ only in case, spaces or
-- punctuation (Team:LookAlikes, TeamList.lua) are one team saved twice, usually a raid leader's push of another
-- spelling from before names matched that way. A few seconds after you log in, out of combat, a small UI.Window
-- on the popups layer asks about one pair at a time, the first listed as the one kept:
--   "Same team?"  "<loser> looks like <winner>. Merge <loser> (N pulls) into <winner>?"  [Merge] [Keep apart]
-- Merge runs Team:Merge and asks about the next pair. Keep apart saves the pair in CRTDB.team.keepApart (its key is
-- both names in lower case, "winner|loser"; a | is never in a team's name), so it is never asked again, and asks
-- about the next. Closing it with X asks nothing more until the next login. Never in combat (it waits for combat's
-- end), never while the new raid group popup or a team dialog shows (it waits until they close), never about a pair
-- Team:CanMerge refuses (a raid leader's push locks either team).
-- P.win, P.message, P.merge, P.keep and P.pair are kept for the tests.

local UI = CRT.UI
local Team = CRT.Team

local P = { WAIT = 5, RETRY = 5 }
CRT.TeamLookAlike = P

local L = { width = 360, height = 130, buttonH = 22, buttonMinW = 90, gap = 12, bottom = 6, pad = 12 }

local TEXT = {
    title = "Same team?",
    ask = "%s looks like %s. Merge %s (%s) into %s?",
    merge = "Merge",
    keep = "Keep apart",
    merged = "Merged %s into %s (%s).",
    pull = "%d pull", pulls = "%d pulls",
}
P.TEXT = TEXT

local function pullsText(n)
    return (n == 1 and TEXT.pull or TEXT.pulls):format(n)
end

local function keepApart()
    local s = CRT.db and CRT.db.team
    if not s then
        return {}
    end
    if type(s.keepApart) ~= "table" then
        s.keepApart = {}
    end
    return s.keepApart
end

-- The key a kept-apart pair is saved under.
function P.PairKey(winner, loser)
    return tostring(winner):lower() .. "|" .. tostring(loser):lower()
end

-- The next pair to ask about, winner and loser, or nil: the first look-alike not kept apart that can be merged now.
function P.Next()
    local kept = keepApart()
    for _, group in ipairs(Team:LookAlikes()) do
        local winner = group[1]
        for i = 2, #group do
            local loser = group[i]
            if not kept[P.PairKey(winner, loser)] and Team:CanMerge(loser, winner) then
                return winner, loser
            end
        end
    end
    return nil
end

local dismissed = false -- closed with X: nothing more this session
local answered = false -- a button closed it, not X

local function build()
    local win = UI.Window("CowfeeRaidToolsTeamLookAlike", { kind = "dialog", title = TEXT.title, width = L.width, height = L.height })
    P.win = win
    local c = win.content
    P.message = c:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    P.message:SetPoint("TOPLEFT", L.pad, -L.pad)
    P.message:SetPoint("TOPRIGHT", -L.pad, -L.pad)
    P.message:SetJustifyH("LEFT")
    P.merge = UI.PanelButton(c, TEXT.merge, L.buttonH, function()
        P.Merge()
    end)
    P.keep = UI.PanelButton(c, TEXT.keep, L.buttonH, function()
        P.KeepApart()
    end)
    -- both as wide as the wider label needs
    local w = L.buttonMinW
    for _, b in ipairs({ P.merge, P.keep }) do
        local fs = b:GetFontString()
        w = math.max(w, UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0))
    end
    P.merge:SetWidth(w)
    P.keep:SetWidth(w)
    P.merge:SetPoint("BOTTOMRIGHT", c, "BOTTOM", -L.gap / 2, L.bottom)
    P.keep:SetPoint("BOTTOMLEFT", c, "BOTTOM", L.gap / 2, L.bottom)
    win:HookScript("OnHide", function()
        if not answered then
            dismissed = true
        end
        answered = false
    end)
end

function P.IsShown()
    return P.win ~= nil and P.win:IsShown()
end

local function show(winner, loser)
    if not P.win then
        build()
    end
    P.pair = { winner = winner, loser = loser }
    P.message:SetText(TEXT.ask:format(loser, winner, loser, pullsText(Team:TeamPulls(loser)), winner))
    P.win:Show()
    P.win:Raise()
end

local function close()
    answered = true
    if P.win then
        P.win:Hide()
    end
    answered = false
    P.pair = nil
end

local driver = CreateFrame("Frame")
local waitingCombat, retrying = false, false

-- Something else asks first: the new raid group popup or a team dialog.
local function busy()
    local popup, dialogs = CRT.TeamPopup, CRT.TeamDialogs
    return (popup and popup.IsShown and popup.IsShown()) or (dialogs and dialogs.win and dialogs.win:IsShown()) or false
end

-- Asks about the next pair now if there is one: in combat it waits for combat's end, behind another team window it
-- tries again RETRY seconds later.
function P.Try()
    if dismissed or P.IsShown() then
        return
    end
    local winner, loser = P.Next()
    if not winner then
        return
    end
    if InCombatLockdown() then
        if not waitingCombat then
            waitingCombat = true
            driver:RegisterEvent("PLAYER_REGEN_ENABLED")
        end
        return
    end
    if busy() then
        if not retrying then
            retrying = true
            C_Timer.After(P.RETRY, function()
                retrying = false
                P.Try()
            end)
        end
        return
    end
    show(winner, loser)
end

-- Merge: the pair merges (the loser into the first listed), then the next pair is asked about.
function P.Merge()
    local pair = P.pair
    close()
    if not pair then
        return
    end
    local summary = Team:Merge(pair.loser, pair.winner)
    if summary then
        CRT:Print(TEXT.merged:format(summary.from, summary.into, pullsText(summary.pulls or 0)))
    end
    P.Try()
end

-- Keep apart: never asked about this pair again; then the next pair.
function P.KeepApart()
    local pair = P.pair
    close()
    if pair then
        keepApart()[P.PairKey(pair.winner, pair.loser)] = true
    end
    P.Try()
end

local loggedIn = false

local function onEvent(_, event)
    if event == "PLAYER_ENTERING_WORLD" then
        -- once a session, a few seconds after the first loading screen
        if not loggedIn then
            loggedIn = true
            C_Timer.After(P.WAIT, P.Try)
        end
    elseif event == "PLAYER_REGEN_ENABLED" then
        driver:UnregisterEvent("PLAYER_REGEN_ENABLED")
        waitingCombat = false
        P.Try()
    end
end
P.HandleEvent = function(event)
    onEvent(driver, event)
end

driver:RegisterEvent("PLAYER_ENTERING_WORLD")
driver:SetScript("OnEvent", onEvent)
