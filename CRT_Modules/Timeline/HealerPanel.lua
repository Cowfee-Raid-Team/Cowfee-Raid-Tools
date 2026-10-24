local ADDON, CRT = ...

-- Timeline: the panel rows under the healers on Healer CDs (Timeline/HealerView.lua builds the rows, this file
-- fills them). Each is a row of the view's lanes (kind "hvpanel"), so it scrolls with them, with a frame over
-- the whole row (name column and track) that takes the clicks:
--   your moved casts  "You moved N casts from the raid note." with Reset mine and Send to raid lead, when you
--                     moved any of the shown notes' casts (Notes/Shifts.lua); hidden at none
--   proposed changes  for the raid leader and assistants: "Proposed changes (N)" with the auto-accept check
--                     box, then one row per change a healer sent (Notes/Proposals.lua), the first MAX_ROWS of
--                     them (so only that many frames are ever made): who, the spell and both times, with
--                     Accept, Decline and Show on Timeline. A change whose line changed since is stale: it says
--                     so and can't be accepted. A shared assignment (a line naming several players) says that
--                     accepting moves everyone's timer on it, with the names in its tooltip.
-- Built with the view's rows (Rows, once per refresh); Draw places the frames, made once and reused.

local Panel = {}
CRT.TimelineHealerPanel = Panel

local TEXT = {
    moved = "You moved %d cast%s from the raid note.",
    movedTitle = "Your moved casts",
    movedHelp = "Your alerts use your times; the raid note is unchanged.\n\nReset mine puts every cast back at the raid "
        .. "note's time. Send to raid lead sends your times to the raid leader and assistants, who can accept them into "
        .. "the raid note.",
    reset = "Reset mine",
    send = "Send to raid lead",
    proposed = "Proposed changes (%d)",
    proposedMore = "Proposed changes (%d, the first %d shown)",
    autoAccept = "Accept healers' cooldown changes automatically",
    autoTitle = "Proposed changes",
    autoHelp = "Healers can move their own cooldowns on Healer CDs and send them to you. Accept writes the new time "
        .. "into the raid note; then share the note as usual. Decline drops it; nothing is sent back.\n\n"
        .. "With the box ticked, a change from a group member about their own line is accepted at once. A change "
        .. "to a line you changed since always waits.",
    proposal = "%s \194\183 %s %s to %s",
    stale = " \194\183 changed since",
    staleTip = "That line of the raid note changed since this was sent, so it can't be accepted.",
    shared = " \194\183 Shared assignment (%d players): accepting moves everyone's timer on this line",
    sharedTitle = "Shared assignment",
    accept = "Accept",
    decline = "Decline",
    show = "Show on Timeline",
}
Panel.TEXT = TEXT

local BUTTON_H = 20
local MAX_ROWS = 8 -- proposal rows shown at once (and frames made); the rest come up as these are answered
Panel.MAX_ROWS = MAX_ROWS
local BUTTON_GAP = 4
local PAD = 8

local function rowH()
    return CRT.TimelineView.ROW_H
end

-- Rows -------------------------------------------------------------------------------------------------

-- Adds the panel rows to out, the view's lanes: the moved casts' bar, then the proposals for the shown boss
-- (for someone who may change the raid note).
function Panel.Rows(view, out)
    local Shifts, P, Notes = CRT.NoteShifts, CRT.NoteProposals, CRT.Notes
    local function add(panel, p)
        out[#out + 1] = { key = "healers:panel:" .. (#out + 1), kind = "hvpanel", panel = panel, p = p, label = "", marks = {} }
    end
    view.hvMoved = Shifts and Shifts:Count(view.hvNoteIds) or 0
    if view.hvMoved > 0 then
        add("bar")
    end
    local list = {}
    if P and Notes and Notes:CanEditRaid() then
        P:Check()
        list = P:ForEncounter(view:EncounterNumber())
    end
    view.hvProposals = #list
    if #list > 0 then
        add("head")
        for i = 1, math.min(#list, MAX_ROWS) do
            add("proposal", list[i])
        end
    end
end

-- Actions ----------------------------------------------------------------------------------------------

function Panel.ResetMine(view)
    local Shifts = CRT.NoteShifts
    if Shifts then
        Shifts:ClearNotes(view.hvNoteIds)
    end
end

function Panel.Send(view)
    local P = CRT.NoteProposals
    return P and P:Send(view.hvNoteIds) or 0
end

-- Selects a proposal's cast on the timeline (its line in your note) and scrolls to it.
function Panel.Show(view, p)
    local P = CRT.NoteProposals
    local id, line = P:Locate(p)
    for _, m in ipairs(id and view.marks or {}) do
        if m.noteID == id and m.line == line then
            view:Select(m)
            local length = math.max(1, view.extra and view.extra.length or 0)
            view:ScrollTo(CRT.TimelineView.TimeToX(m.t, length, view.trackW) - view:VisibleWidth() / 3)
            local vs = view.vscroll
            if vs and vs.SetVerticalScroll then
                local range = vs.GetVerticalScrollRange and vs:GetVerticalScrollRange() or 0
                vs:SetVerticalScroll(math.max(0, math.min(range, (m.row - 3) * rowH())))
            end
            return true
        end
    end
    return false
end

-- Frames -------------------------------------------------------------------------------------------------

local function tint(region, method, key, alpha)
    local UI = CRT.UI
    if UI and UI.Tint then
        UI.Tint(region, method, key, alpha)
    else
        local c = CRT.PALETTE[key] or { 1, 1, 1 }
        region[method](region, c[1], c[2], c[3], alpha or 1)
    end
end

-- A row frame over the lanes: a background in the surface colour, a line of text and buttons at the right.
local function rowFrame(view)
    local f = CreateFrame("Frame", nil, view.body)
    f:SetHeight(rowH())
    f:EnableMouse(true) -- the clicks are the row's, never the track's under it
    f.bg = f:CreateTexture(nil, "BACKGROUND")
    f.bg:SetAllPoints()
    tint(f.bg, "SetColorTexture", "surface", 0.97)
    f.text = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    f.text:SetPoint("LEFT", f, "LEFT", PAD, 0)
    f.text:SetJustifyH("LEFT")
    if f.text.SetWordWrap then
        f.text:SetWordWrap(false)
    end
    tint(f.text, "SetTextColor", "text")
    f.buttons = {}
    return f
end

-- Buttons right to left from the row's right end, each as wide as its label.
local function addButtons(f, defs)
    local UI = CRT.UI
    local right = nil
    for i = #defs, 1, -1 do
        local d = defs[i]
        local b = UI.PanelButton(f, d.label, BUTTON_H, d.click)
        if right then
            b:SetPoint("RIGHT", right, "LEFT", -BUTTON_GAP, 0)
        else
            b:SetPoint("RIGHT", f, "RIGHT", -PAD, 0)
        end
        right = b
        f.buttons[d.key] = b
    end
    f.leftButton = right
end

local function barFrame(view)
    if view.hvBar then
        return view.hvBar
    end
    local f = rowFrame(view)
    addButtons(f, {
        { key = "reset", label = TEXT.reset, click = function()
            Panel.ResetMine(view)
        end },
        { key = "send", label = TEXT.send, click = function()
            Panel.Send(view)
        end },
    })
    CRT.UI.HelpRight(f.text, TEXT.movedTitle, TEXT.movedHelp, { parent = f })
    view.hvBar = f
    return f
end

local function headFrame(view)
    if view.hvHead then
        return view.hvHead
    end
    local f = rowFrame(view)
    tint(f.text, "SetTextColor", "heading")
    local cb = CreateFrame("CheckButton", nil, f, "UICheckButtonTemplate")
    cb:SetSize(22, 22)
    cb.Label = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    cb.Label:SetText(TEXT.autoAccept)
    cb.Label:SetPoint("RIGHT", f, "RIGHT", -(PAD + CRT.UI.HELP_SIZE + CRT.UI.HELP_GAP), 0)
    cb:SetPoint("RIGHT", cb.Label, "LEFT", -2, 0)
    cb:SetScript("OnClick", function(self)
        CRT.NoteProposals.SetAutoAccept(self:GetChecked() and true or false)
    end)
    if CRT.UI.SkinCheckButton then
        CRT.UI:SkinCheckButton(cb)
    end
    CRT.UI.HelpRight(cb.Label, TEXT.autoTitle, TEXT.autoHelp, { parent = f })
    f.auto = cb
    view.hvHead = f
    return f
end

local function proposalFrame(view, n)
    view.hvProps = view.hvProps or {}
    local f = view.hvProps[n]
    if f then
        return f
    end
    f = rowFrame(view)
    addButtons(f, {
        { key = "accept", label = TEXT.accept, click = function()
            CRT.NoteProposals:Accept(f.p)
        end },
        { key = "decline", label = TEXT.decline, click = function()
            CRT.NoteProposals:Decline(f.p)
        end },
        { key = "show", label = TEXT.show, click = function()
            Panel.Show(view, f.p)
        end },
    })
    -- a stale change says why on its Accept button
    -- a shared assignment's row names its players in its tooltip
    f:SetScript("OnEnter", function(row)
        local p = row.p
        if p and p.shared and not p.stale then
            CRT.UI.TooltipOwner(GameTooltip, row, "ANCHOR_RIGHT", nil, nil, "timeline")
            GameTooltip:SetText(TEXT.sharedTitle, 1, 1, 1)
            GameTooltip:AddLine(table.concat(p.players or {}, ", "), 0.85, 0.85, 0.85, true)
            GameTooltip:Show()
        end
    end)
    f:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    -- hooked, so the button's own hover (its skin) stays; a disabled button still shows it
    local accept = f.buttons.accept
    if accept.SetMotionScriptsWhileDisabled then
        accept:SetMotionScriptsWhileDisabled(true)
    end
    accept:HookScript("OnEnter", function(b)
        if f.p and f.p.stale then
            CRT.UI.TooltipOwner(GameTooltip, b, "ANCHOR_RIGHT", nil, nil, "timeline")
            GameTooltip:SetText(TEXT.staleTip, 1, 1, 1, 1, true)
            GameTooltip:Show()
        end
    end)
    accept:HookScript("OnLeave", function()
        if f.p and f.p.stale then
            GameTooltip:Hide()
        end
    end)
    view.hvProps[n] = f
    return f
end

-- A proposal's line: "Rixxy · Rewind 2:51 to 3:05", the times on the shown timeline's clock when it has them.
function Panel.ProposalText(view, p)
    local P, Reminders, View = CRT.NoteProposals, CRT.AlertReminders, CRT.TimelineView
    local ref = view.pull and view.pull.reference
    local function at(ph, t)
        local abs = Reminders and Reminders.AbsoluteTime(ref, ph, t)
        return abs and View.Format(abs) or P.FormatTime(ph, t)
    end
    local text = string.format(TEXT.proposal, p.short, P.SpellLabel(p.spellID), at(p.oldPh, p.oldT), at(p.newPh, p.newT))
    local note = (p.stale and TEXT.stale) or (p.shared and string.format(TEXT.shared, #(p.players or {}))) or nil
    if note then
        text = text .. (CRT.UI.WarnText and CRT.UI.WarnText(note) or note)
    end
    return text
end

local function place(view, f, i)
    f:ClearAllPoints()
    f:SetPoint("TOPLEFT", view.body, "TOPLEFT", 0, -(i - 1) * rowH())
    f:SetPoint("TOPRIGHT", view.body, "TOPRIGHT", 0, -(i - 1) * rowH())
    f:SetFrameLevel((view.track:GetFrameLevel() or 0) + 20) -- over the flags (8 above the track) and the bands
    f:Show()
end

-- Shows each panel row's frame at its row, filled in; hides the rest. on: the view shows Healer CDs.
function Panel.Draw(view, on)
    local bar, head, props = false, false, 0
    for i, lane in ipairs(on and view.lanes or {}) do
        if lane.kind == "hvpanel" then
            local f
            if lane.panel == "bar" then
                f, bar = barFrame(view), true
                local n = view.hvMoved or 0
                f.text:SetText(string.format(TEXT.moved, n, n == 1 and "" or "s"))
            elseif lane.panel == "head" then
                f, head = headFrame(view), true
                local n = view.hvProposals or 0
                f.text:SetText(n > MAX_ROWS and string.format(TEXT.proposedMore, n, MAX_ROWS) or string.format(TEXT.proposed, n))
                f.auto:SetChecked(CRT.NoteProposals.AutoAccept())
            else
                props = props + 1
                f = proposalFrame(view, props)
                f.p = lane.p
                f.text:SetText(Panel.ProposalText(view, lane.p))
                f.buttons.accept:SetEnabled(not lane.p.stale)
                f.buttons.show:SetEnabled(not lane.p.stale)
            end
            if f.leftButton then
                f.text:SetPoint("RIGHT", f.leftButton, "LEFT", -(PAD + CRT.UI.HELP_SIZE + CRT.UI.HELP_GAP), 0)
            end
            place(view, f, i)
        end
    end
    if view.hvBar and not bar then
        view.hvBar:Hide()
    end
    if view.hvHead and not head then
        view.hvHead:Hide()
    end
    for i = props + 1, #(view.hvProps or {}) do
        view.hvProps[i]:Hide()
    end
end
