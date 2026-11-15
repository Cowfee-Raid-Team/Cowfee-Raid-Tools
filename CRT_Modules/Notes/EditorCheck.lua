local ADDON, CRT = ...

-- The note editor's note check (Notes/EditorWindow.lua; the checking is Notes/Check.lua's, #1288). A banner over the
-- rows, under the Link banner and Add assignment's, while the note has any of:
--   Double callouts   a player gets two callouts at once; Remove old lines takes out the typed lines an Assign block
--                     replaced, after a confirmation; the (?) and the confirmation list every one of them, alike
--                     lines in one group ("Sixz: Grab {cross} purple orb, 6 lines (P1 0:07 to 3:40)")
--   Stale lines       (#1294) lines for players at a block's cast in none of its rows' words that follow no row;
--                     Remove stale lines takes them out, after a confirmation that lists them, grouped the same way
--   Lines for players no group row lists   a warning only
-- one line each with its count, a (?) that lists them, and its button; Not now hides the banner until the text
-- changes. The buttons change the session only (Editor.ApplyText): Save keeps the change. A block cast with no
-- lines is no warning (Alex, 2026-11-15: removing a cast's lines means no one is called then). Not for a note you can't
-- change, nor while Add assignment is open. Short of room (EditorWindow's banner budget) it shows one line, its
-- counts, with one (?) for everything and its buttons under it.
--   EC.Build(left)                              makes the banner, hidden
--   EC.RefreshBanner(width, top, short, hide)   the banner's height (0 hidden), under the other banners; short: the
--                                               one-line form; hide: hidden for want of room
--   EC.GroupList(lines)                         lines (line numbers) as a confirmation lists them: alike lines in one
--                                               group, "Lulu: Grab side green orb, 6 lines (P1 0:07 to 3:40)"

local UI = CRT.UI
local Check = CRT.NoteCheck
local Editor = CRT.NoteEditor
local W = Editor.state

local EC = {}
CRT.NoteEditorCheck = EC

-- Every word of the banner, in one place. Keep the keys, change the text in quotes, save, /reload.
local TEXT = {
    title = "Note check",
    doublesOne = "1 double callout: a player gets two callouts at once.",
    doubles = "%d double callouts: a player gets two callouts at once.",
    oldOne = "1 old line that an Assign block replaced.",
    old = "%d old lines that an Assign block replaced.",
    staleOne = "1 stale line: at a block's cast, in none of its rows' words.",
    stale = "%d stale lines: at a block's cast, in none of its rows' words.",
    staleTitle = "Stale lines",
    staleHelp = "These lines are for players at one of an Assign block's casts, but their words fit none of the block's rows and they follow no other row. They are likely left over from before the block. Remove stale lines takes them out. It asks first. Save keeps the change.",
    removeStale = "Remove stale lines",
    removeStaleConfirmOne = "Take 1 stale line out of the note?\n%s",
    removeStaleConfirm = "Take %d stale lines out of the note?\n%s",
    removedStaleOne = "Removed 1 stale line.",
    removedStale = "Removed %d stale lines.",
    orphansOne = "1 line for a player no group row lists.",
    orphans = "%d lines for players no group row lists.",
    short = "Note check: %s.",
    shortDoubles = "%d double",
    shortOld = "%d old",
    shortStale = "%d stale",
    shortOrphans = "%d no row",
    remove = "Remove old lines",
    later = "Not now",
    doublesTitle = "Double callouts",
    oldList = "Remove old lines takes out these lines. An Assign block replaced them: each is in a block row's words and follows no other row. It asks first. Save keeps the change.",
    noOld = "No line here is one a block replaced. Change or remove one of them by hand.",
    orphansTitle = "Lines for players no group row lists",
    orphansHelp = "No group row, Assign block or kick list names these players. Check the names, or add a row for them.",
    more = "And %d more.",
    group = "%s: %s, %d lines (%s to %s)",
    groupOne = "%s: %s, 1 line (%s)",
    moreGroups = "And %d more groups, %d lines.",
    removeConfirmOne = "Take 1 old line out of the note? An Assign block replaced it:\n%s",
    removeConfirm = "Take %d old lines out of the note? An Assign block replaced them:\n%s",
    removeButton = "Remove",
    removedOne = "Removed 1 old line.",
    removed = "Removed %d old lines.",
}
EC.TEXT = TEXT

local BACKDROP = { bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 }
local L = { pad = 6, gap = 4, buttonH = 22, buttonGap = 6, below = 6, maxList = 10, maxGroups = 25, lineGap = 4 }

-- The last check, by note, text and saved links, so a redraw doesn't run it again; and Not now's note and text.
local S = { result = nil, sig = nil, dismissed = nil }
EC.state = S

local function noteKey()
    return W.source and (W.source.personal and "personal" or W.source.id)
end

local function readOnly()
    return W.session == nil or W.session.readOnly
end

-- What the check depends on besides the text: the note's saved links (Link saves a new list of them).
local function linksSig(saved)
    local n = 0
    for _, link in ipairs(saved) do
        n = n + #(link.sigs or {})
    end
    return #saved == 0 and "0" or (tostring(saved) .. "#" .. n)
end

-- The note check of the session's text (cached while the note, its text and its saved links are the same).
local function result()
    local s = W.session
    local saved = CRT.NoteLinks.Saved(noteKey())
    local sig = tostring(noteKey()) .. "\1" .. linksSig(saved) .. "\1" .. s:Text()
    if not (S.result and S.sig == sig) then
        S.result, S.sig = Check.Run(s, saved), sig
    end
    return S.result
end

-- "P1 0:07"
local function clock(ph, t)
    t = math.max(0, t or 0)
    return string.format("P%s %d:%02d", ("%.10g"):format(ph or 1), math.floor(t / 60), math.floor(t % 60))
end

local function marked(text)
    return CRT.MarkerText and CRT.MarkerText(text) or text
end

-- A timed line's text as the tooltips show it, its raid markers drawn.
local function lineText(i)
    local row = W.session and W.session.rows[i]
    local t = row and row.timer
    return t and marked(t.text or "") or ""
end

-- A timed line as a list shows it: "P1 0:07 Lulu: Grab side green orb".
local function lineItem(i)
    local row = W.session and W.session.rows[i]
    local t = row and row.timer
    if not t then
        return ""
    end
    return clock(t.ph, t.time) .. " " .. table.concat(W.session:TimerNames(i), " ") .. ": " .. lineText(i)
end

-- The first maxList items of a list as lines, then "And N more."
local function capped(items)
    local out = {}
    for k, item in ipairs(items) do
        if k > L.maxList then
            out[#out + 1] = string.format(TEXT.more, #items - L.maxList)
            break
        end
        out[#out + 1] = item
    end
    return table.concat(out, "\n")
end

-- Every line in `list` (line numbers: those Remove old lines takes, or any the editor deletes), alike lines (the same
-- players and text, Check.Groups) in one group with how many and when: "Sixz: Grab {cross} purple orb, 6 lines (P1
-- 0:07 to 3:40)". Past maxGroups groups, the rest as a count of groups and lines, so no line is ever left out silently.
local function groupList(list)
    local groups = W.session and Check.Groups(W.session, list) or {}
    local out, rest, restLines = {}, 0, 0
    for k, g in ipairs(groups) do
        g.text = marked(g.text)
        if k > L.maxGroups then
            rest, restLines = rest + 1, restLines + g.n
        elseif g.n == 1 then
            out[#out + 1] = string.format(TEXT.groupOne, g.who, g.text, clock(g.first.ph, g.first.time))
        else
            local last = clock(g.last.ph, g.last.time)
            if (g.last.ph or 1) == (g.first.ph or 1) then
                last = last:gsub("^P%S+ ", "")
            end
            out[#out + 1] = string.format(TEXT.group, g.who, g.text, g.n, clock(g.first.ph, g.first.time), last)
        end
    end
    if rest > 0 then
        out[#out + 1] = string.format(TEXT.moreGroups, rest, restLines)
    end
    return table.concat(out, "\n")
end
EC.GroupList = groupList

-- The (?) texts, read when the tooltip opens.
local function doublesTip()
    local r = S.result
    if not r then
        return ""
    end
    local items = {}
    for _, d in ipairs(r.doubles) do
        local texts = {}
        for _, i in ipairs(d.lines) do
            texts[#texts + 1] = lineText(i)
        end
        items[#items + 1] = clock(d.ph, d.t) .. " " .. d.name .. ": " .. table.concat(texts, ", ")
    end
    local tip = {}
    if #items > 0 then
        tip[#tip + 1] = capped(items)
    end
    if #r.old > 0 then
        tip[#tip + 1] = TEXT.oldList
        tip[#tip + 1] = groupList(r.old)
    else
        tip[#tip + 1] = TEXT.noOld
    end
    return tip
end

local function staleTip()
    local r = S.result
    if not r then
        return ""
    end
    return { TEXT.staleHelp, groupList(r.stale) }
end

local function orphansTip()
    local r = S.result
    if not r then
        return ""
    end
    local items = {}
    for _, i in ipairs(r.orphans) do
        items[#items + 1] = lineItem(i)
    end
    return { capped(items), TEXT.orphansHelp }
end

-- The short form's one (?): every kind's list.
local function allTip()
    local r = S.result
    local out = {}
    if r and (#r.doubles > 0 or #r.old > 0) then
        out[#out + 1] = { TEXT.doublesTitle, "" }
        for _, part in ipairs(doublesTip()) do
            out[#out + 1] = part
        end
    end
    if r and #r.stale > 0 then
        out[#out + 1] = { TEXT.staleTitle, "" }
        for _, part in ipairs(staleTip()) do
            out[#out + 1] = part
        end
    end
    if r and #r.orphans > 0 then
        out[#out + 1] = { TEXT.orphansTitle, "" }
        for _, part in ipairs(orphansTip()) do
            out[#out + 1] = part
        end
    end
    return out
end

-- The buttons ----------------------------------------------------------------------------------------------------

-- Remove old lines (kind "old") and Remove stale lines (kind "stale"): the check run again on the text now, then asked
-- first with every line listed; nothing changes unless the text is still the same at Accept (Check.RemoveLines).
local KINDS = {
    old = { confirmOne = "removeConfirmOne", confirm = "removeConfirm", doneOne = "removedOne", done = "removed" },
    stale = { confirmOne = "removeStaleConfirmOne", confirm = "removeStaleConfirm", doneOne = "removedStaleOne", done = "removedStale" },
}

local function removeKind(kind)
    local s = W.session
    if not s or readOnly() then
        return
    end
    local k = KINDS[kind]
    local text = s:Text()
    local r = Check.Run(text, CRT.NoteLinks.Saved(noteKey()))
    local list = r[kind]
    local n = #list
    if n == 0 then
        return
    end
    local function go()
        -- the note may have changed meanwhile: only the same text
        if not (W.session and not readOnly() and W.session:Text() == text) then
            return
        end
        Editor.ApplyText(Check.RemoveLines(text, list))
        W.notice = UI.GoodText(n == 1 and TEXT[k.doneOne] or string.format(TEXT[k.done], n))
        Editor.Refresh()
    end
    if not StaticPopup_ShowCustomGenericConfirmation then
        go()
        return
    end
    local listed = groupList(list)
    UI.LiftOver(UI.ShownPopup(StaticPopup_ShowCustomGenericConfirmation({
        text = n == 1 and string.format(TEXT[k.confirmOne], listed) or string.format(TEXT[k.confirm], n, listed),
        acceptText = TEXT.removeButton,
        cancelText = CANCEL,
        callback = go,
    }), "GENERIC_CONFIRMATION"))
end

local function removeClick()
    removeKind("old")
end

local function removeStaleClick()
    removeKind("stale")
end

local function laterClick()
    if W.session then
        S.dismissed = { key = noteKey(), text = W.session:Text() }
        Editor.Refresh()
    end
end

-- The banner -----------------------------------------------------------------------------------------------------

-- A button labelled and sized from its label.
local function label(button, text)
    button:SetText(text)
    local fs = button.GetFontString and button:GetFontString()
    button:SetWidth(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0))
end

-- One kind's line: its text, the (?) right of it and its button (or none) at the banner's right.
local function kindLine(b, title, tip, onClick, buttonText)
    local k = {}
    k.text = b:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    k.text:SetJustifyH("LEFT")
    UI.Tint(k.text, "SetTextColor", "text")
    k.help = UI.HelpRight(k.text, title, tip)
    if onClick then
        k.button = UI.PanelButton(b, buttonText, L.buttonH, onClick)
        label(k.button, buttonText)
    end
    return k
end

function EC.Build(left)
    local b = CreateFrame("Frame", nil, left, "BackdropTemplate")
    b:SetBackdrop(BACKDROP)
    UI.Tint(b, "SetBackdropColor", "surface", 0.9)
    UI.Tint(b, "SetBackdropBorderColor", "border")
    b.title = b:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    b.title:SetJustifyH("LEFT")
    UI.Tint(b.title, "SetTextColor", "heading")
    b.title:SetText(TEXT.title)
    b.later = UI.PanelButton(b, TEXT.later, L.buttonH, laterClick)
    label(b.later, TEXT.later)
    b.doubles = kindLine(b, TEXT.doublesTitle, doublesTip, removeClick, TEXT.remove)
    b.stale = kindLine(b, TEXT.staleTitle, staleTip, removeStaleClick, TEXT.removeStale)
    b.orphans = kindLine(b, TEXT.orphansTitle, orphansTip)
    -- the short form: one line of counts, one (?) for all of it
    b.short = b:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    b.short:SetJustifyH("LEFT")
    UI.Tint(b.short, "SetTextColor", "text")
    b.shortHelp = UI.HelpRight(b.short, TEXT.title, allTip)
    b:Hide()
    S.banner = b
end

local function hideKind(k)
    k.text:Hide()
    k.help:Hide()
    if k.button then
        k.button:Hide()
    end
end

-- Places a kind's line at y with its text (nil: hidden) and whether its button shows; the next line's y.
local function placeKind(b, k, y, text, buttonOn, inner)
    if not text then
        hideKind(k)
        return y
    end
    local bw = 0
    if k.button then
        k.button:SetShown(buttonOn)
        if buttonOn then
            k.button:ClearAllPoints()
            k.button:SetPoint("TOPRIGHT", -L.pad, -y)
            bw = (k.button:GetWidth() or 0) + L.buttonGap
        end
    end
    k.text:ClearAllPoints()
    k.text:SetPoint("TOPLEFT", L.pad, -(y + 4))
    k.text:SetWidth(math.max(60, inner - bw - UI.HELP_GAP - UI.HELP_SIZE - L.buttonGap))
    k.text:SetText(marked(UI.WarnText("!") .. " " .. text))
    k.text:Show()
    k.help:Show()
    local h = math.ceil(k.text:GetStringHeight() or 12) + 8
    return y + math.max(h, buttonOn and L.buttonH or 0) + L.lineGap
end

local function counted(n, one, many)
    if n == 0 then
        return nil
    end
    return n == 1 and one or string.format(many, n)
end

-- The full form: the title and Not now, then a line per kind. The banner's height.
local function drawFull(b, r, inner)
    b.short:Hide()
    b.shortHelp:Hide()
    b.title:Show()
    local y = L.pad
    b.title:ClearAllPoints()
    b.title:SetPoint("TOPLEFT", L.pad, -(y + 4))
    b.later:ClearAllPoints()
    b.later:SetPoint("TOPRIGHT", -L.pad, -y)
    y = y + L.buttonH + L.gap
    local doubles = counted(#r.doubles, TEXT.doublesOne, TEXT.doubles) or counted(#r.old, TEXT.oldOne, TEXT.old)
    y = placeKind(b, b.doubles, y, doubles, #r.old > 0, inner)
    y = placeKind(b, b.stale, y, counted(#r.stale, TEXT.staleOne, TEXT.stale), true, inner)
    y = placeKind(b, b.orphans, y, counted(#r.orphans, TEXT.orphansOne, TEXT.orphans), false, inner)
    return y - L.lineGap + L.pad
end

-- The short form: one line of counts with its (?) and Not now, the buttons under it when there are any.
local function drawShort(b, r, inner)
    b.title:Hide()
    hideKind(b.doubles)
    hideKind(b.stale)
    hideKind(b.orphans)
    local parts = {}
    for _, e in ipairs({ { #r.doubles, TEXT.shortDoubles }, { #r.old, TEXT.shortOld }, { #r.stale, TEXT.shortStale },
        { #r.orphans, TEXT.shortOrphans } }) do
        if e[1] > 0 then
            parts[#parts + 1] = string.format(e[2], e[1])
        end
    end
    local y = L.pad
    b.later:ClearAllPoints()
    b.later:SetPoint("TOPRIGHT", -L.pad, -y)
    b.short:ClearAllPoints()
    b.short:SetPoint("TOPLEFT", L.pad, -(y + 4))
    b.short:SetWidth(math.max(60, inner - (b.later:GetWidth() or 0) - UI.HELP_GAP - UI.HELP_SIZE - 2 * L.buttonGap))
    b.short:SetWordWrap(false)
    b.short:SetText(UI.WarnText("!") .. " " .. string.format(TEXT.short, table.concat(parts, ", ")))
    b.short:Show()
    b.shortHelp:Show()
    y = y + L.buttonH
    -- the buttons in one row under it, left to right
    local x = L.pad
    for _, e in ipairs({ { b.doubles.button, #r.old > 0 }, { b.stale.button, #r.stale > 0 } }) do
        local button, on = e[1], e[2]
        button:SetShown(on)
        if on then
            button:ClearAllPoints()
            button:SetPoint("TOPLEFT", x, -(y + L.gap))
            x = x + (button:GetWidth() or 0) + L.buttonGap
        end
    end
    if x > L.pad then
        y = y + L.gap + L.buttonH
    end
    return y + L.pad
end

function EC.RefreshBanner(width, top, short, hide)
    local b = S.banner
    local s = W.session
    if not b then
        return 0
    end
    if not s or s.readOnly or W.assignOn or hide then
        b:Hide()
        return 0
    end
    local r = result()
    local d = S.dismissed
    if Check.Clean(r) or (d and d.key == noteKey() and d.text == s:Text()) then
        b:Hide()
        return 0
    end
    local inner = width - 2 * L.pad
    b:ClearAllPoints()
    b:SetPoint("TOPLEFT", 0, -(top or 0))
    b:SetWidth(width)
    local y = short and drawShort(b, r, inner) or drawFull(b, r, inner)
    b:SetHeight(y)
    b:Show()
    return y + L.below
end
