local ADDON, CRT = ...

-- The team dialogs (CRT.TeamDialogs), shared by General Settings > Appearance > Team raids and the new raid group popup
-- (TeamPopup.lua): one UI.Window dialog on the popups layer, in one of two modes. Remove team asks once through the
-- shared confirm instead (UI.Confirm, CRT_Core/UI/Confirm.lua): 'Delete the team "<name>"?', its Season Stats pulls
-- going too, [Delete team] [Cancel]; accepted, it calls Team:RemoveTeam.
--   add      Add team: a name box, [Add] [Cancel]. The name goes through Team:AddTeam (TeamList.lua); a refused one
--            shows why in red under the box. Added, done(name) runs, so the caller picks it.
--   merge    Merge teams: "Merge [Before teams while it has pulls, your saved teams]" and "into [Pug and your saved
--            teams but the one above]",
--            the summary under them (rebuilt on every pick), [Merge] [Cancel]. Merge calls Team:Merge
--            (TeamList.lua), prints what moved and runs done(summary).
-- D.win, D.mode, D.edit, D.ok, D.cancel, D.fromDrop and D.intoDrop are kept for the tests.

local UI = CRT.UI
local Team = CRT.Team

local D = {}
CRT.TeamDialogs = D

local L = { width = 380, height = 156, mergeH = 196, editW = 220, editH = 20, buttonH = 22, buttonMinW = 80, gap = 12, bottom = 6,
    pad = 12, labelW = 60, dropW = 240, rowH = 30 }

-- Some keys below format two or more values (%s, %d) in a fixed order: a translation keeps that order (see Locale.lua).
local TEXT = CRT.Locale("UI.TeamDialogs", {
    addTitle = "Add team",
    addLabel = "Team name",
    add = "Add",
    removeAsk = "Delete the team \"%s\"?",
    removeDetail = "Its Season Stats (%s) go too. This can't be undone.",
    remove = "Delete team",
    cancel = "Cancel",
    pull = "%d pull", pulls = "%d pulls",
    mergeTitle = "Merge teams",
    mergeFrom = "Merge",
    mergeInto = "into",
    merge = "Merge",
    mergeAsk = "%s's %s, Tattlebot pulls and raid nights move into %s, and %s leaves your list. This can't be undone.",
    mergeAskBefore = "The %s from before teams, with their Tattlebot pulls and raid nights, move into %s. This can't be undone.",
    merged = "Merged %s into %s (%s).",
})
D.TEXT = TEXT

local function pullsText(n)
    return (n == 1 and TEXT.pull or TEXT.pulls):format(n)
end
D.PullsText = pullsText

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
    D.ok = UI.PanelButton(c, TEXT.add, L.buttonH, function()
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

-- A team as the dialog names it: Team is Before teams (its counts from before your own teams).
local function nameOf(n)
    return n == Team.TEAM and Team.LIST_TEXT.before or n
end
D.NameOf = nameOf

-- Merge's entries: Before teams while it has pulls, then your saved teams (Team:MergeSources).
function D.FromOptions()
    local out = {}
    for _, n in ipairs(Team:MergeSources()) do
        out[#out + 1] = { key = n, label = nameOf(n) }
    end
    return out
end

-- The teams a merge can go into: Pug and your saved teams, but the one being merged.
local function intoTeams()
    local out = { Team.PUG }
    for _, n in ipairs(Team:Saved()) do
        if n ~= D.from then
            out[#out + 1] = n
        end
    end
    return out
end

function D.IntoOptions()
    local out = {}
    for _, n in ipairs(intoTeams()) do
        out[#out + 1] = { key = n, label = n }
    end
    return out
end

-- into when it can't stay: your first other saved team, else Pug.
local function defaultInto()
    local list = intoTeams()
    return list[2] or list[1]
end

-- The summary under the two rows, and Merge enabled only for a pair Team:CanMerge takes.
local function mergeSummary()
    if not (D.from and D.into) then
        D.message:SetText("")
        return
    end
    local pulls = pullsText(Team:TeamPulls(D.from))
    if D.from == Team.TEAM then
        D.message:SetText(TEXT.mergeAskBefore:format(pulls, D.into))
    else
        D.message:SetText(TEXT.mergeAsk:format(D.from, pulls, D.into, D.from))
    end
end

function D.PickFrom(key)
    D.from = Team:Find(key) or D.from
    if D.into == D.from then
        D.into = defaultInto()
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

-- The OK button: in merge, enabled only for a pair Team:CanMerge takes.
function D.Refresh()
    if D.mode == "merge" then
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

-- Remove team: asks once (UI.Confirm), naming the team and its Season Stats pulls; done() runs once it is removed.
-- False when the team can't be removed (Team, Pug) or nothing could ask.
function D.AskRemove(name, done)
    if not Team:CanRemove(name) then
        return false
    end
    local team = Team:Find(name)
    return UI.Confirm({ text = TEXT.removeAsk:format(team), detail = TEXT.removeDetail:format(pullsText(Team:TeamPulls(team))),
        accept = TEXT.remove, danger = true, onAccept = function()
            if Team:RemoveTeam(team) and done then
                done()
            end
        end })
end

-- Merge teams: from and into start on the ones given (else the first source, Before teams or your first saved
-- team, into your first other saved team, else Pug); done(summary) runs once merged. Nothing opens with nothing to
-- merge from.
function D.AskMerge(from, into, done)
    local sources = Team:MergeSources()
    if #sources == 0 then
        return
    end
    D.done, D.name = done, nil
    D.from = Team:Find(from)
    local listed = false
    for _, n in ipairs(sources) do
        listed = listed or n == D.from
    end
    if not listed then
        D.from = sources[1]
    end
    D.into = Team:Find(into)
    if not D.into or D.into == D.from or D.into == Team.TEAM or D.into == Team.State().extra then
        D.into = defaultInto()
    end
    open("merge", TEXT.mergeTitle, nil, TEXT.merge, false)
    mergeSummary()
    D.fromDrop.refresh()
    D.intoDrop.refresh()
    D.Refresh()
end

-- Merges from into into and prints what moved, for the dialog and the look-alike prompt (TeamLookAlike.lua); the
-- settings page and Season Stats refresh through Team:OnMerge and Season Stats' own change. Returns the summary, or
-- nil when Team:Merge refused.
function D.MergePair(from, into)
    local summary = Team:Merge(from, into)
    if not summary then
        return nil
    end
    CRT:Print(TEXT.merged:format(nameOf(summary.from), summary.into, pullsText(summary.pulls or 0)))
    return summary
end

-- Merges the pair picked.
function D.Merge()
    return D.MergePair(D.from, D.into)
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
