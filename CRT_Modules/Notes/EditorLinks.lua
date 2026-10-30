local ADDON, CRT = ...

-- The note editor's timer links (Notes/EditorWindow.lua; the matching is Notes/Links.lua's). Timer lines that list
-- the same players as an assignment line follow it: change the line's names and they change too. Here:
--   the Link banner over the rows, when timer lines repeat a row's players and aren't linked yet: a line per row
--   ("6 lines match Left"), a line per near-miss ("6 lines are close to Center but list Notkvr, who isn't in that
--   row"), and Link N, the one obvious fix ("Add Notkvr to Center and link all 18") and Not now (hidden for this
--   note until its text changes). Not for a note you can't change.
--   a tag right of a row's label, "6 lines", when timer lines follow it; its tooltip lists them
--   a timer line that follows a row says so on hover: "Follows Left (Ravenous Feast and Tainted Blood Groups)"
--   the rewrite: a change to a row's names writes them on every timer line that followed it (EL.Edit)
-- Called by the editor:
--   EL.Build(left)          makes the banner at the top of the rows' side
--   EL.Clear(f)             a row frame redrawn: no tag, no hover, until LabelTag or TimerRow set them again
--   EL.Tag(f)               a row frame's tag, or nil
--   EL.Refresh(width)       works the links out for the session (W.match) and draws the banner; its height, 0 hidden
--   EL.LabelTag(f, i, x)    row i's tag at x right of its label; the width it takes, 0 for none
--   EL.TimerRow(f, i)       a timer row's hover
--   EL.Edit(fn)             runs fn, a change to the session's names that returns whether it changed anything, and
--                           then writes the new names on the timer lines that followed each changed row

local Links = CRT.NoteLinks
local Notes = CRT.Notes
local UI = CRT.UI
local Editor = CRT.NoteEditor
local W = Editor.state

local EL = {}
CRT.NoteEditorLinks = EL

local TEXT = {
    titleOne = "1 timer line lists the same players as a group row. Link it so it follows the row?",
    title = "%d timer lines list the same players as a group row. Link them so they follow the row?",
    nearTitleOne = "1 timer line is close to a group row.",
    nearTitle = "%d timer lines are close to a group row.",
    matchOne = "1 line matches %s",
    match = "%d lines match %s",
    nearOne = "1 line is close to %s but %s",
    near = "%d lines are close to %s but %s",
    savedOne = "1 linked line no longer matches %s: it %s",
    saved = "%d linked lines no longer match %s: they %s",
    -- what a near-miss lists that its row doesn't, or leaves out; one: the verb for one line
    extraOne = "lists %s, who isn't in that row",
    extraOneMany = "lists %s, who aren't in that row",
    extra = "list %s, who isn't in that row",
    extraMany = "list %s, who aren't in that row",
    missingOne = "leaves out %s, who is in that row",
    missingOneMany = "leaves out %s, who are in that row",
    missing = "leave out %s, who is in that row",
    missingMany = "leave out %s, who are in that row",
    bothOne = "lists %s and leaves out %s",
    both = "list %s and leave out %s",
    andName = "%s and %s",
    more = "%s and %d more",
    moreGroups = "And %d more.",
    link = "Link %d",
    fix = "Add %s to %s and link all %d",
    later = "Not now",
    tagOne = "1 line",
    tag = "%d lines",
    tagTip = "Timer lines that follow %s",
    follows = "Follows %s (%s)",
    followsPlain = "Follows %s",
    spell = "Spell %s",
    helpTitle = "Timer lines that follow a row",
    help = "A timer line that lists the same players as an assignment line follows it. Change the names on that "
        .. "line, here in the editor, and its timer lines get the same names, so the countdowns go to the right "
        .. "players.\n\nLink remembers which lines follow which row, so a line that later lists other players "
        .. "shows here instead of changing by surprise.\n\nThe note itself keeps plain names, so everyone gets "
        .. "their countdowns as before, on any version.",
}

local L = { pad = 6, gap = 4, buttonH = 22, buttonGap = 6, maxGroups = 5, tagGap = 6, tagH = 14, below = 6 }
local BACKDROP = { bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 }
local READY = "|TInterface\\RaidFrame\\ReadyCheck-Ready:12:12|t "

-- By row frame (the editor reuses its frames for any kind of line): its tag, the row a timer line follows, and
-- whether its hover is set.
local tags, follows, hovers = {}, {}, {}

-- The saved links' key: the note's id, or "personal" for the personal note.
local function noteKey()
    local src = W.source
    if not src then
        return nil
    end
    return src.personal and "personal" or src.id
end

-- "Abu", "Abu and Cheo", "Abu, Cheo and Rixxy", "Abu, Cheo, Rixxy and 2 more".
local function nameList(names)
    local n = #names
    if n <= 1 then
        return names[1] or ""
    end
    if n > 3 then
        return string.format(TEXT.more, table.concat(names, ", ", 1, 3), n - 3)
    end
    return string.format(TEXT.andName, table.concat(names, ", ", 1, n - 1), names[n])
end

-- What a near-miss's lines list or leave out, with the verb for one line or several.
local function diffText(g, one)
    local extra, missing = g.extra or {}, g.missing or {}
    if #extra > 0 and #missing > 0 then
        return string.format(one and TEXT.bothOne or TEXT.both, nameList(extra), nameList(missing))
    elseif #extra > 0 then
        local key = (one and "extraOne" or "extra") .. (#extra > 1 and "Many" or "")
        return string.format(TEXT[key], nameList(extra))
    end
    local key = (one and "missingOne" or "missing") .. (#missing > 1 and "Many" or "")
    return string.format(TEXT[key], nameList(missing))
end

local function groupText(g, exact)
    local n = #g.lines
    if exact then
        return READY .. (n == 1 and string.format(TEXT.matchOne, g.row.label) or string.format(TEXT.match, n, g.row.label))
    end
    local one = n == 1
    local text
    if g.saved then
        text = one and string.format(TEXT.savedOne, g.row.label, diffText(g, true))
            or string.format(TEXT.saved, n, g.row.label, diffText(g, false))
    else
        text = one and string.format(TEXT.nearOne, g.row.label, diffText(g, true))
            or string.format(TEXT.near, n, g.row.label, diffText(g, false))
    end
    return UI.WarnText("!") .. " " .. text
end

local function titleText(sum)
    if sum.exactCount > 0 then
        return sum.total == 1 and TEXT.titleOne or string.format(TEXT.title, sum.total)
    end
    return sum.total == 1 and TEXT.nearTitleOne or string.format(TEXT.nearTitle, sum.total)
end

-- The indices of the lines in a match's exact list, and with its near-misses too.
local function indices(m, withNear)
    local out = {}
    for _, e in ipairs(m.exact) do
        out[#out + 1] = e.line.index
    end
    if withNear then
        for _, e in ipairs(m.near) do
            out[#out + 1] = e.line.index
        end
    end
    return out
end

-- The banner ---------------------------------------------------------------------------------------------------

local function linkClick()
    local s, m = W.session, W.match
    if s and m and not s.readOnly then
        Links.Link(noteKey(), s, indices(m, false))
        Editor.Refresh()
    end
end

local function fixClick()
    local s, m, sum = W.session, W.match, W.linkSummary
    local fix = sum and sum.fix
    if not (s and m and fix) or s.readOnly then
        return
    end
    local all = indices(m, true)
    EL.Edit(function()
        local any = false
        for _, name in ipairs(fix.add) do
            if s:Add(fix.row.index, name) then
                any = true
            end
        end
        return any
    end)
    Links.Link(noteKey(), s, all)
    Editor.Refresh()
end

local function laterClick()
    local s = W.session
    if s then
        Links.Dismiss(noteKey(), s:Text())
        Editor.Refresh()
    end
end

function EL.Build(left)
    local b = CreateFrame("Frame", nil, left, "BackdropTemplate")
    b:SetBackdrop(BACKDROP)
    UI.Tint(b, "SetBackdropColor", "surface", 0.9)
    UI.Tint(b, "SetBackdropBorderColor", "border")
    b:SetPoint("TOPLEFT", 0, 0)
    b:SetPoint("TOPRIGHT", 0, 0)
    b.title = b:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    b.title:SetJustifyH("LEFT")
    UI.Tint(b.title, "SetTextColor", "heading")
    b.lines = {}
    b.link = UI.PanelButton(b, string.format(TEXT.link, 0), L.buttonH, linkClick)
    b.fix = UI.PanelButton(b, TEXT.later, L.buttonH, fixClick)
    b.later = UI.PanelButton(b, TEXT.later, L.buttonH, laterClick)
    UI.HelpRight(b.later, TEXT.helpTitle, TEXT.help)
    b:Hide()
    W.banner = b
end

local function bannerLine(b, n)
    local fs = b.lines[n]
    if not fs then
        fs = b:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        fs:SetJustifyH("LEFT")
        UI.Tint(fs, "SetTextColor", "text")
        b.lines[n] = fs
    end
    return fs
end

-- A button labelled and sized from its label.
local function label(button, text)
    button:SetText(text)
    local fs = button.GetFontString and button:GetFontString()
    button:SetWidth(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0))
end

local function drawBanner(sum, width)
    local b = W.banner
    local inner = width - 2 * L.pad
    local y = L.pad
    b.title:ClearAllPoints()
    b.title:SetPoint("TOPLEFT", L.pad, -y)
    b.title:SetWidth(inner)
    b.title:SetText(titleText(sum))
    y = y + math.ceil(b.title:GetStringHeight() or 14) + L.gap
    local texts = {}
    for _, g in ipairs(sum.exact) do
        texts[#texts + 1] = groupText(g, true)
    end
    for _, g in ipairs(sum.near) do
        texts[#texts + 1] = groupText(g, false)
    end
    if #texts > L.maxGroups then
        local rest = #texts - (L.maxGroups - 1)
        for k = #texts, L.maxGroups, -1 do
            texts[k] = nil
        end
        texts[L.maxGroups] = string.format(TEXT.moreGroups, rest)
    end
    for n, text in ipairs(texts) do
        local fs = bannerLine(b, n)
        fs:ClearAllPoints()
        fs:SetPoint("TOPLEFT", L.pad, -y)
        fs:SetWidth(inner)
        fs:SetText(CRT.MarkerText(text))
        fs:Show()
        y = y + math.ceil(fs:GetStringHeight() or 12) + 2
    end
    for n = #texts + 1, #b.lines do
        b.lines[n]:Hide()
    end
    y = y + L.gap
    -- the buttons, left to right, wrapping when the next doesn't fit (room kept for the (?) after Not now)
    local shown = {}
    b.link:SetShown(sum.exactCount > 0)
    if sum.exactCount > 0 then
        label(b.link, string.format(TEXT.link, sum.exactCount))
        shown[#shown + 1] = b.link
    end
    b.fix:SetShown(sum.fix ~= nil)
    if sum.fix then
        label(b.fix, string.format(TEXT.fix, nameList(sum.fix.add), sum.fix.row.label, sum.total))
        shown[#shown + 1] = b.fix
    end
    label(b.later, TEXT.later)
    b.later:Show()
    shown[#shown + 1] = b.later
    local x, room = L.pad, inner - 24
    for _, button in ipairs(shown) do
        local w = button:GetWidth() or 80
        if x > L.pad and x + w > L.pad + room then
            x, y = L.pad, y + L.buttonH + L.gap
        end
        button:ClearAllPoints()
        button:SetPoint("TOPLEFT", x, -y)
        x = x + w + L.buttonGap
    end
    y = y + L.buttonH + L.pad
    b:SetHeight(y)
    b:Show()
    return y
end

function EL.Refresh(width)
    local s = W.session
    W.match, W.linkSummary = nil, nil
    if not s then
        if W.banner then
            W.banner:Hide()
        end
        return 0
    end
    W.match = Links.Match(Links.Rows(s), Links.Lines(s), Links.Saved(noteKey()))
    W.linkSummary = Links.Summary(W.match)
    local sum = W.linkSummary
    if not W.banner or s.readOnly or sum.total == 0 or Links.Dismissed(noteKey(), s:Text()) then
        if W.banner then
            W.banner:Hide()
        end
        return 0
    end
    return drawBanner(sum, width or 400) + L.below
end

-- Row tags and hover ---------------------------------------------------------------------------------------------

local function hideTip()
    if GameTooltip then
        GameTooltip:Hide()
    end
end

-- A timer line as the tag's tooltip lists it: "1:01 P1  Soak First, Knock Left".
local function lineText(line)
    local t = line.timer
    local text = t.text
    if not text or text == "" then
        local info = t.spellId and Notes.SpellInfo and Notes:SpellInfo(t.spellId)
        text = info and info.name or (t.spellId and string.format(TEXT.spell, tostring(t.spellId))) or ""
    end
    return (line.time or "") .. " P" .. (line.ph or "1") .. "  " .. CRT.MarkerText(text)
end

local function tagEnter(self)
    local list = W.match and W.match.byRow[self.index]
    local row = W.session and W.session.rows[self.index]
    if not (list and row and GameTooltip and UI.TooltipOwner) then
        return
    end
    UI.TooltipOwner(GameTooltip, self, "ANCHOR_RIGHT")
    GameTooltip:SetText(CRT.MarkerText(string.format(TEXT.tagTip, row.label or "")), 1, 1, 1)
    for _, line in ipairs(list) do
        GameTooltip:AddLine(lineText(line), 0.85, 0.85, 0.85)
    end
    GameTooltip:Show()
end

function EL.Clear(f)
    follows[f] = nil
    if tags[f] then
        tags[f]:Hide()
    end
end

function EL.Tag(f)
    return tags[f]
end

function EL.LabelTag(f, i, x)
    local list = W.match and W.match.byRow[i]
    if not (list and #list > 0) then
        if tags[f] then
            tags[f]:Hide()
        end
        return 0
    end
    local tag = tags[f]
    if not tag then
        tag = CreateFrame("Button", nil, f)
        tag.text = tag:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        tag.text:SetPoint("LEFT", 0, 0)
        UI.Tint(tag.text, "SetTextColor", "accent")
        tag:SetScript("OnEnter", tagEnter)
        tag:SetScript("OnLeave", hideTip)
        tags[f] = tag
    end
    tag.index = i
    tag.text:SetText(#list == 1 and TEXT.tagOne or string.format(TEXT.tag, #list))
    local w = math.ceil(tag.text:GetStringWidth() or 0) + 2
    tag:SetSize(w, L.tagH)
    tag:ClearAllPoints()
    tag:SetPoint("TOPLEFT", x, -3)
    tag:Show()
    return w + L.tagGap
end

local function rowEnter(self)
    local row = follows[self]
    if not (row and GameTooltip and UI.TooltipOwner) then
        return
    end
    UI.TooltipOwner(GameTooltip, self, "ANCHOR_RIGHT")
    if row.block ~= "" then
        GameTooltip:SetText(CRT.MarkerText(string.format(TEXT.follows, row.label, row.block)), 1, 1, 1)
    else
        GameTooltip:SetText(CRT.MarkerText(string.format(TEXT.followsPlain, row.label)), 1, 1, 1)
    end
    GameTooltip:Show()
end

function EL.TimerRow(f, i)
    local follow = W.match and W.match.follow[i]
    follows[f] = follow and follow.row or nil
    if not follows[f] then
        return
    end
    -- hover only: a timer row takes no clicks or drops
    if f.SetMouseMotionEnabled then
        f:SetMouseMotionEnabled(true)
    end
    if not hovers[f] then
        f:SetScript("OnEnter", rowEnter)
        f:SetScript("OnLeave", hideTip)
        hovers[f] = true
    end
end

-- The rewrite ---------------------------------------------------------------------------------------------------

function EL.Edit(fn)
    local s = W.session
    if not s or s.readOnly then
        return fn()
    end
    local snap = Links.Snapshot(s, Links.Saved(noteKey()))
    local changed = fn()
    if changed then
        Links.Apply(s, snap)
    end
    return changed
end
