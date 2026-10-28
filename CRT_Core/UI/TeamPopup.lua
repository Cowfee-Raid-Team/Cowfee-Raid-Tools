local ADDON, CRT = ...

-- The new raid group popup (CRT.TeamPopup): once per new raid group (Team:OnNewGroup, Team.lua), out of combat, it
-- asks which team the raid is. A UI.Window dialog on the popups layer; its place is kept in CRTDB.team.popup.
--   Raid leader  "New raid group": Use Loot Master? [Yes] [No] (UI.Toggle2, neither lit at first; Yes turns CRT
--                Looting on for this raid, now in a raid instance or when you enter one: LM:PlanLooting in
--                LootMaster/Looting.lua; No leaves it off and isn't asked again there; no answer leaves Loot Master's own
--                question for the instance, which waits while this popup shows), Which team? (the same dropdown as General Settings,
--                Add team… included), [Save and push to raid] [Later]. Save sets tonight's team and pushes it.
--   Raider       "Which team is this raid?" with the dropdown, [Save] [Later]. It waits ASK_WAIT seconds after
--                joining, and isn't shown when the leader's push came first; a push while it shows closes it.
-- Later keeps tonight's team as it is (Team, unless you picked one before the group) and doesn't ask again in this
-- group; nor does a /reload in it (Team:Asked, saved per character).

local UI = CRT.UI
local Team = CRT.Team

local P = { ASK_WAIT = 10, LEAD_WAIT = 2 }
CRT.TeamPopup = P

local L = { width = 400, height = 196, raiderH = 140, labelW = 130, dropW = 200, toggleW = 160, buttonH = 24, gap = 12, bottom = 6,
    pad = 14, rowH = 32 }

local TEXT = {
    leaderTitle = "New raid group",
    raiderTitle = "Which team is this raid?",
    loot = "Use Loot Master?",
    yes = "Yes", no = "No",
    team = "Which team?",
    savePush = "Save and push to raid",
    save = "Save",
    later = "Later",
    help = "Which team tonight's raid is. Season Stats keeps each team's pulls apart; Tattlebot and the Late Tracker count any team but Pug as a team raid.\n\nLater keeps Team and doesn't ask again in this group. You can change it on General Settings > Team raids.",
    leaderHelp = "Use Loot Master? Yes turns CRT Looting on for this raid, as Loot Master > Tonight's Turn on does: now if you are in the raid instance, else when you enter it. No leaves it off.\n\nSave and push to raid sets the team for everyone in the raid with CRT. They can't change it until they leave the group.",
}
P.TEXT = TEXT

-- What the popup holds until Save: the team picked and the Loot Master answer (nil: none yet).
local state = { pick = Team.TEAM, loot = nil, leader = false }
P.state = state

local function selectLoot()
    if P.toggle then
        P.toggle:Select(state.loot == true and "yes" or state.loot == false and "no" or nil)
    end
end

local function refresh()
    if P.drop then
        P.drop.refresh()
    end
    selectLoot()
end
P.Refresh = refresh

-- The team dropdown: the same entries as General Settings; Add team… opens the name box, and the new team is
-- picked here once added (and saved to your list).
function P.Pick(key)
    if key == Team.ADD_KEY then
        CRT.TeamDialogs.AskName(function(name)
            state.pick = name
            refresh()
        end)
        return
    end
    state.pick = Team:Find(key) or state.pick
    refresh()
end

local function build()
    local win = UI.Window("CowfeeRaidToolsTeamPopup", {
        kind = "dialog", title = TEXT.raiderTitle, width = L.width, height = L.height,
        saved = function()
            return CRT.db and CRT.db.team and CRT.db.team.popup
        end,
    })
    P.win = win
    local c = win.content
    P.help = win.strip:SetHelp(TEXT.raiderTitle, TEXT.help)
    -- the leader's row: Use Loot Master? [Yes] [No]
    P.lootLabel = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    P.lootLabel:SetPoint("TOPLEFT", L.pad, -L.pad - 8)
    P.lootLabel:SetWidth(L.labelW)
    P.lootLabel:SetJustifyH("LEFT")
    P.lootLabel:SetText(TEXT.loot)
    P.lootHelp = UI.HelpRight(P.lootLabel, TEXT.loot, TEXT.leaderHelp)
    P.toggle = UI.Toggle2(c, { { key = "yes", label = TEXT.yes }, { key = "no", label = TEXT.no } }, function(key)
        state.loot = key == "yes"
        selectLoot()
    end)
    P.toggle:Size(L.toggleW)
    -- the team row
    P.drop = UI.Dropdown(c, TEXT.team, {
        labelWidth = L.labelW,
        width = L.dropW,
        options = function()
            return Team:Options()
        end,
        get = function()
            return state.pick
        end,
        set = P.Pick,
    })
    P.save = UI.PanelButton(c, TEXT.savePush, L.buttonH, function()
        P.Save()
    end)
    P.later = UI.PanelButton(c, TEXT.later, L.buttonH, function()
        P.Later()
    end)
    P.save:SetPoint("BOTTOMRIGHT", c, "BOTTOM", -L.gap / 2, L.bottom)
    P.later:SetPoint("BOTTOMLEFT", c, "BOTTOM", L.gap / 2, L.bottom)
end

-- Lays the popup out for the leader or a raider.
local function layout(leader)
    local win = P.win
    win.strip:SetTitle(leader and TEXT.leaderTitle or TEXT.raiderTitle)
    win:SetHeight(leader and L.height or L.raiderH)
    P.lootLabel:SetShown(leader)
    if P.lootHelp then
        P.lootHelp:SetShown(leader)
    end
    for _, b in ipairs(P.toggle.buttons) do
        b:SetShown(leader)
    end
    P.toggle:PlaceLeft(L.pad + L.labelW + 5, -L.pad - 6)
    P.drop:ClearAllPoints()
    P.drop:SetPoint("TOPLEFT", L.pad, leader and -L.pad - L.rowH - 8 or -L.pad)
    P.save:SetText(leader and TEXT.savePush or TEXT.save)
    local fs = P.save:GetFontString()
    P.save:SetWidth(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0))
end

-- Shows the popup, the leader's or the raider's.
function P.Show(leader)
    if not P.win then
        build()
    end
    state.leader = leader and true or false
    state.pick = Team:Tonight()
    state.loot = nil
    layout(state.leader)
    refresh()
    P.win:Show()
    P.win:Raise()
end

function P.IsShown()
    return P.win ~= nil and P.win:IsShown()
end

-- Whether the leader's popup shows, asking Use Loot Master? (Loot Master's own instance question waits).
function P.AsksLoot()
    return P.IsShown() and state.leader == true
end

-- Closing the leader's popup lets Loot Master ask its instance question, if it is still wanted.
function P.Hide()
    local leader = P.IsShown() and state.leader
    if P.win then
        P.win:Hide()
    end
    local LM = CRT.LootMaster
    if leader and LM and LM.MaybeAskLooting then
        LM.MaybeAskLooting()
    end
end

-- Save: tonight's team; the leader also pushes it and answers Use Loot Master?
function P.Save()
    Team:SetTonight(state.pick)
    if state.leader then
        Team:Push()
        local LM = CRT.LootMaster
        if state.loot ~= nil and LM and LM.PlanLooting then
            LM:PlanLooting(state.loot)
        end
    end
    P.Hide()
end

-- Later: nothing changes, and the popup isn't shown again in this group.
function P.Later()
    P.Hide()
end

-- When to ask --------------------------------------------------------------------------------------------------

local driver = CreateFrame("Frame")
local waitingCombat = false

-- Shows the popup now if it is still wanted: in the raid group it was asked for, not asked yet, not set by the
-- raid leader's push; in combat it waits for combat's end.
function P.Try()
    if not Team.InRaidGroup() or Team:Asked() or Team:IsLocked() then
        return
    end
    if InCombatLockdown() then
        waitingCombat = true
        driver:RegisterEvent("PLAYER_REGEN_ENABLED")
        return
    end
    Team:MarkAsked()
    P.Show(Team.AmLeader())
end

-- A new raid group: the leader is asked as soon as the roster settles, a raider after ASK_WAIT seconds (the
-- leader's push may come first).
function P.Schedule()
    C_Timer.After(Team.AmLeader() and P.LEAD_WAIT or P.ASK_WAIT, P.Try)
end

driver:SetScript("OnEvent", function(_, event)
    if event == "PLAYER_REGEN_ENABLED" then
        driver:UnregisterEvent("PLAYER_REGEN_ENABLED")
        if waitingCombat then
            waitingCombat = false
            P.Try()
        end
    end
end)

Team:OnNewGroup(P.Schedule)
-- a raider's popup closes when the leader's push arrives, or when the group is left
Team:OnRecount(function(s)
    if P.IsShown() and ((not state.leader and Team:IsLocked()) or not s.raid) then
        P.Hide()
    end
end)
