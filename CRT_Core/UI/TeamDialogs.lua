local ADDON, CRT = ...

-- The team dialogs (CRT.TeamDialogs), shared by General Settings > Team raids and the new raid group popup
-- (TeamPopup.lua): one UI.Window dialog on the popups layer, in one of three modes.
--   add      Add team: a name box, [Add] [Cancel]. The name goes through Team:AddTeam (TeamList.lua); a refused one
--            shows why in red under the box. Added, done(name) runs, so the caller picks it.
--   remove   the first warning: "Remove <name>? Season Stats for <name> (N pulls) will be deleted too."
--            [Remove] [Cancel]. Remove goes on to confirm.
--   confirm  the second: "This can't be undone. Type the team name to delete it and its N pulls." A box,
--            [Delete for good] (only while the box holds the name, any case) [Cancel]. It calls Team:RemoveTeam.
--   merge    Merge teams: "Merge [your saved teams]" and "into [Team, Pug and your saved teams but the one above]",
--            the summary under them (rebuilt on every pick), [Merge] [Cancel]. Merge calls Team:Merge
--            (TeamList.lua), prints what moved and runs done(summary).
-- D.win, D.mode, D.edit, D.ok, D.cancel, D.fromDrop and D.intoDrop are kept for the tests.

local UI = CRT.UI
local Team = CRT.Team

local D = {}
CRT.TeamDialogs = D

local L = { width = 380, height = 156, mergeH = 196, editW = 220, editH = 20, buttonH = 22, buttonMinW = 80, gap = 12, bottom = 6,
    pad = 12, labelW = 60, dropW = 240, rowH = 30 }

local TEXT = {
    addTitle = "Add team",
    addLabel = "Team name",
    add = "Add",
    removeTitle = "Remove team",
    remove = "Remove",
    removeAsk = "Remove %s? Season Stats for %s (%s) will be deleted too.",
    confirm = "Delete for good",
    confirmAsk = "This can't be undone. Type the team name to delete it and its %s.",
    cancel = "Cancel",
    pull = "%d pull", pulls = "%d pulls",
    mergeTitle = "Merge teams",
    mergeFrom = "Merge",
    mergeInto = "into",
    merge = "Merge",
    mergeAsk = "%s's %s, Tattlebot pulls and raid nights move into %s, and %s leaves your list. This can't be undone.",
    merged = "Merged %s into %s (%s).",
}
D.TEXT = TEXT

local function pullsText(n)
    return (n == 1 and TEXT.pull or TEXT.pulls):format(n)
end

-- Whether the typed text is the team's name (trimmed, any case).
function D.Matches(typed, name)
    if type(typed) ~= "string" or type(name) ~= "string" then
        return false
    end
    return typed:gsub("^%s+", ""):gsub("%s+$", ""):lower() == name:lower()
end

local function build()
    local win = UI.Window("CowfeeRaidToolsTeamDialog", { kind = "dialog", title = TEXT.addTitle, width = L.width, height = L.height })
    local c = win.content
    D.win = win
    D.message = c:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    D.message:SetPoint("TOPLEFT", L.pad, -L.pad)
    D.message:SetPoint("TOPRIGHT", -L.pad, -L.pad)
    D.message:SetJustifyH("LEFT")
    D.edit = CreateFrame("EditBox", nil, c, "InputBoxTemplate")
    D.edit:SetSize(L.editW, L.editH)
    D.edit:SetPoint("TOP", 0, -56)
    D.edit:SetAutoFocus(false)
    D.edit:SetFontObject(CRTFontEdit)
    D.edit:SetMaxLetters(Team.MAX_NAME + 8) -- room for spaces trimmed off; Clean refuses a longer name
    UI:SkinEditBox(D.edit)
    D.error = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    D.error:SetPoint("TOP", D.edit, "BOTTOM", 0, -4)
    D.error:SetWidth(L.width - 2 * L.pad)
    D.ok = UI.PanelButton(c, TEXT.confirm, L.buttonH, function()
        D.Accept()
    end)
    D.cancel = UI.PanelButton(c, TEXT.cancel, L.buttonH, function()
        win:Hide()
    end)
    D.ok:SetPoint("BOTTOMRIGHT", c, "BOTTOM", -L.gap / 2, L.bottom)
    D.cancel:SetPoint("BOTTOMLEFT", c, "BOTTOM", L.gap / 2, L.bottom)
    D.edit:SetScript("OnTextChanged", function()
        D.Refresh()
    end)
    D.edit:SetScript("OnEnterPressed", function()
        if D.ok:IsEnabled() then
            D.Accept()
        end
    end)
    D.edit:SetScript("OnEscapePressed", function()
        win:Hide()
    end)
    -- the merge rows, shown only in merge mode
    D.fromDrop = UI.Dropdown(c, TEXT.mergeFrom, {
        labelWidth = L.labelW,
        width = L.dropW,
        options = D.FromOptions,
        get = function()
            return D.from
        end,
        set = D.PickFrom,
    })
    D.fromDrop:SetPoint("TOPLEFT", L.pad, -L.pad)
    D.intoDrop = UI.Dropdown(c, TEXT.mergeInto, {
        labelWidth = L.labelW,
        width = L.dropW,
        options = D.IntoOptions,
        get = function()
            return D.into
        end,
        set = D.PickInto,
    })
    D.intoDrop:SetPoint("TOPLEFT", L.pad, -L.pad - L.rowH)
end

-- Merge teams ---------------------------------------------------------------------------------------------------

-- Your saved teams, the ones a merge can take from (Team:Saved).
local function savedTeams()
    return Team:Saved()
end

-- Merge's entries: your saved teams.
function D.FromOptions()
    local out = {}
    for _, n in ipairs(savedTeams()) do
        out[#out + 1] = { key = n, label = n }
    end
    return out
end

-- into's entries: Team, Pug and your saved teams, but the one being merged.
function D.IntoOptions()
    local out = { { key = Team.TEAM, label = Team.TEAM }, { key = Team.PUG, label = Team.PUG } }
    for _, n in ipairs(savedTeams()) do
        if n ~= D.from then
            out[#out + 1] = { key = n, label = n }
        end
    end
    return out
end

-- The summary under the two rows, and Merge enabled only for a pair Team:CanMerge takes.
local function mergeSummary()
    if not (D.from and D.into) then
        D.message:SetText("")
        return
    end
    D.message:SetText(TEXT.mergeAsk:format(D.from, pullsText(Team:TeamPulls(D.from)), D.into, D.from))
end

function D.PickFrom(key)
    D.from = Team:Find(key) or D.from
    if D.into == D.from then
        D.into = Team.TEAM
    end
    mergeSummary()
    D.fromDrop.refresh()
    D.intoDrop.refresh()
    D.Refresh()
end

function D.PickInto(key)
    D.into = Team:Find(key) or D.into
    mergeSummary()
    D.intoDrop.refresh()
    D.Refresh()
end

-- Sizes a button from its label (both as wide as the wider needs).
local function label(okText)
    D.ok:SetText(okText)
    local w = L.buttonMinW
    for _, b in ipairs({ D.ok, D.cancel }) do
        local fs = b:GetFontString()
        w = math.max(w, UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0))
    end
    D.ok:SetWidth(w)
    D.cancel:SetWidth(w)
end

-- The OK button follows the box: in confirm, enabled only while it holds the team's name.
function D.Refresh()
    if D.mode == "confirm" then
        D.ok:SetEnabled(D.Matches(D.edit:GetText() or "", D.name))
    elseif D.mode == "merge" then
        D.ok:SetEnabled(Team:CanMerge(D.from, D.into) ~= nil)
    else
        D.ok:SetEnabled(true)
    end
end

local function open(mode, title, message, okText, withBox)
    if not D.win then
        build()
    end
    D.mode = mode
    local merging = mode == "merge"
    D.win.strip:SetTitle(title)
    D.win:SetHeight(merging and L.mergeH or L.height)
    D.fromDrop:SetShown(merging)
    D.intoDrop:SetShown(merging)
    -- the message sits under the merge rows, else at the top
    local top = merging and -L.pad - 2 * L.rowH - 4 or -L.pad
    D.message:ClearAllPoints()
    D.message:SetPoint("TOPLEFT", L.pad, top)
    D.message:SetPoint("TOPRIGHT", -L.pad, top)
    D.message:SetText(message or "")
    D.edit:SetText("")
    D.edit:SetShown(withBox)
    D.error:SetText("")
    label(okText)
    D.Refresh()
    D.win:Show()
    D.win:Raise()
    if withBox then
        D.edit:SetFocus()
    end
end

-- Add team: done(name) runs once it is added.
function D.AskName(done)
    D.done, D.name = done, nil
    open("add", TEXT.addTitle, TEXT.addLabel, TEXT.add, true)
end

-- Remove team: the first warning, then the typed confirm; done() runs once it is removed.
function D.AskRemove(name, done)
    if not Team:CanRemove(name) then
        return
    end
    D.done, D.name = done, Team:Find(name)
    local pulls = pullsText(Team:TeamPulls(D.name))
    open("remove", TEXT.removeTitle, TEXT.removeAsk:format(D.name, D.name, pulls), TEXT.remove, false)
end

-- Merge teams: from and into start on the ones given (else your first saved team, into Team); done(summary) runs
-- once merged. Nothing opens with no saved team.
function D.AskMerge(from, into, done)
    local saved = savedTeams()
    if #saved == 0 then
        return
    end
    D.done, D.name = done, nil
    D.from = Team:Find(from)
    if not D.from or Team.BuiltIn(D.from) or D.from == Team.State().extra then
        D.from = saved[1]
    end
    D.into = Team:Find(into)
    if not D.into or D.into == D.from or D.into == Team.State().extra then
        D.into = Team.TEAM
    end
    open("merge", TEXT.mergeTitle, nil, TEXT.merge, false)
    mergeSummary()
    D.fromDrop.refresh()
    D.intoDrop.refresh()
    D.Refresh()
end

-- Merges the pair picked; prints what moved. Returns the summary, or nil when Team:Merge refused.
function D.Merge()
    local summary = Team:Merge(D.from, D.into)
    if not summary then
        return nil
    end
    CRT:Print(TEXT.merged:format(summary.from, summary.into, pullsText(summary.pulls or 0)))
    return summary
end

function D.Accept()
    if D.mode == "add" then
        local name, why = Team:AddTeam(D.edit:GetText())
        if not name then
            D.error:SetText(UI.BadText(why))
            return
        end
        D.win:Hide()
        if D.done then
            D.done(name)
        end
    elseif D.mode == "remove" then
        open("confirm", TEXT.removeTitle, TEXT.confirmAsk:format(pullsText(Team:TeamPulls(D.name))), TEXT.confirm, true)
    elseif D.mode == "confirm" then
        if not D.Matches(D.edit:GetText() or "", D.name) then
            return
        end
        D.win:Hide()
        if Team:RemoveTeam(D.name) and D.done then
            D.done()
        end
    elseif D.mode == "merge" then
        local summary = D.Merge()
        if not summary then
            D.Refresh()
            return
        end
        D.win:Hide()
        if D.done then
            D.done(summary)
        end
    end
end
