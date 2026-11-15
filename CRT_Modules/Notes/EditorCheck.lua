local ADDON, CRT = ...

-- The note editor's note check (Notes/EditorWindow.lua; the checking is Notes/Check.lua's, #1288). A banner over the
-- rows, under the Link banner and Add assignment's, while the note has any of:
--   Double callouts   a player gets two callouts at once; Remove old lines takes out the typed lines an Assign block
--                     replaced, after a confirmation
--   Missing casts     a block has typed casts no row has a line for; Add missing casts writes them
--   Lines for players no group row lists   a warning only
-- one line each with its count, a (?) that lists them, and its button; Not now hides the banner until the text
-- changes. Both buttons change the session only (Editor.ApplyText): Save keeps the change. Not for a note you can't
-- change, nor while Add assignment is open.
--   EC.Build(left)                  makes the banner, hidden
--   EC.RefreshBanner(width, top)    the banner's height (0 hidden), under the other banners

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
    missingOne = "1 missing cast: a block has a cast with no lines.",
    missing = "%d missing casts: blocks have casts with no lines.",
    orphansOne = "1 line for a player no group row lists.",
    orphans = "%d lines for players no group row lists.",
    remove = "Remove old lines",
    add = "Add missing casts",
    later = "Not now",
    doublesTitle = "Double callouts",
    doublesHelpOne = "Remove old lines takes out the typed line that an Assign block replaced. It asks first. Save keeps the change.",
    doublesHelp = "Remove old lines takes out %d typed lines that an Assign block replaced: a line that gives a block's player a second callout, and a line at a block's cast, in its words, that follows no row. It asks first. Save keeps the change.",
    noOld = "No line here is one a block replaced. Change or remove one of them by hand.",
    missingTitle = "Missing casts",
    missingHelp = "Add missing casts writes the block's lines for these casts. Every row that is on a list of casts gets them. Save keeps the change.",
    orphansTitle = "Lines for players no group row lists",
    orphansHelp = "No group row, Assign block or kick list names these players. Check the names, or add a row for them.",
    cast = "%s: cast %d (%s)",
    more = "And %d more.",
    planned = "its line for this cast is missing",
    removeConfirmOne = "Take 1 old line out of the note? An Assign block replaced it.",
    removeConfirm = "Take %d old lines out of the note? An Assign block replaced them.",
    removeButton = "Remove",
    removedOne = "Removed 1 old line.",
    removed = "Removed %d old lines.",
    added = "Added the missing casts.",
}
EC.TEXT = TEXT

local BACKDROP = { bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 }
local L = { pad = 6, gap = 4, buttonH = 22, buttonGap = 6, below = 6, maxList = 10, lineGap = 4 }

-- The last check, by note and text, so a redraw doesn't run it again; and Not now's note and text.
local S = { result = nil, key = nil, text = nil, dismissed = nil }
EC.state = S

local function noteKey()
    return W.source and (W.source.personal and "personal" or W.source.id)
end

local function readOnly()
    return W.session == nil or W.session.readOnly
end

-- The note check of the session's text (cached while the text is the same).
local function result()
    local s = W.session
    local text = s:Text()
    if not (S.result and S.key == noteKey() and S.text == text) then
        S.result = Check.Run(s, CRT.NoteLinks.Saved(noteKey()))
        S.key, S.text = noteKey(), text
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

-- The first maxList items of a list as tooltip lines, then "And N more."
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
        if d.planned then
            texts[#texts + 1] = TEXT.planned
        end
        items[#items + 1] = clock(d.ph, d.t) .. " " .. d.name .. ": " .. table.concat(texts, ", ")
    end
    local tip = { capped(items) }
    tip[#tip + 1] = #r.old == 1 and TEXT.doublesHelpOne or #r.old > 1 and string.format(TEXT.doublesHelp, #r.old) or TEXT.noOld
    return tip
end

local function missingTip()
    local r = S.result
    if not r then
        return ""
    end
    local items = {}
    for _, miss in ipairs(r.missing) do
        for k, c in ipairs(miss.casts) do
            local e = miss.times[k]
            items[#items + 1] = string.format(TEXT.cast, marked(miss.name), c, clock(e.ph, e.t))
        end
    end
    return { capped(items), TEXT.missingHelp }
end

local function orphansTip()
    local r = S.result
    if not r then
        return ""
    end
    local items = {}
    for _, i in ipairs(r.orphans) do
        local row = W.session.rows[i]
        local t = row and row.timer
        if t then
            items[#items + 1] = clock(t.ph, t.time) .. " " .. table.concat(W.session:TimerNames(i), " ") .. ": " .. lineText(i)
        end
    end
    return { capped(items), TEXT.orphansHelp }
end

-- The buttons ----------------------------------------------------------------------------------------------------

local function removeClick()
    local s = W.session
    if not s or readOnly() then
        return
    end
    local text = s:Text()
    local r = Check.Run(text, CRT.NoteLinks.Saved(noteKey()))
    local n = #r.old
    if n == 0 then
        return
    end
    local function go()
        -- the note may have changed meanwhile: only the same text
        if not (W.session and not readOnly() and W.session:Text() == text) then
            return
        end
        Editor.ApplyText(Check.RemoveOld(text, r))
        W.notice = UI.GoodText(n == 1 and TEXT.removedOne or string.format(TEXT.removed, n))
        Editor.Refresh()
    end
    if not StaticPopup_ShowCustomGenericConfirmation then
        go()
        return
    end
    UI.LiftOver(UI.ShownPopup(StaticPopup_ShowCustomGenericConfirmation({
        text = n == 1 and TEXT.removeConfirmOne or string.format(TEXT.removeConfirm, n),
        acceptText = TEXT.removeButton,
        cancelText = CANCEL,
        callback = go,
    }), "GENERIC_CONFIRMATION"))
end

local function addClick()
    local s = W.session
    if not s or readOnly() then
        return
    end
    local text = s:Text()
    local out = Check.AddMissing(text)
    if out ~= text then
        Editor.ApplyText(out)
        W.notice = UI.GoodText(TEXT.added)
    end
    Editor.Refresh()
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
    b.missing = kindLine(b, TEXT.missingTitle, missingTip, addClick, TEXT.add)
    b.orphans = kindLine(b, TEXT.orphansTitle, orphansTip)
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

function EC.RefreshBanner(width, top)
    local b = S.banner
    local s = W.session
    if not b then
        return 0
    end
    if not s or s.readOnly or W.assignOn then
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
    local y = L.pad
    b.title:ClearAllPoints()
    b.title:SetPoint("TOPLEFT", L.pad, -(y + 4))
    b.later:ClearAllPoints()
    b.later:SetPoint("TOPRIGHT", -L.pad, -y)
    y = y + L.buttonH + L.gap
    local doubles = counted(#r.doubles, TEXT.doublesOne, TEXT.doubles) or counted(#r.old, TEXT.oldOne, TEXT.old)
    y = placeKind(b, b.doubles, y, doubles, #r.old > 0, inner)
    local gone = 0
    for _, miss in ipairs(r.missing) do
        gone = gone + #miss.casts
    end
    y = placeKind(b, b.missing, y, counted(gone, TEXT.missingOne, TEXT.missing), true, inner)
    y = placeKind(b, b.orphans, y, counted(#r.orphans, TEXT.orphansOne, TEXT.orphans), false, inner)
    y = y - L.lineGap + L.pad
    b:SetHeight(y)
    b:Show()
    return y + L.below
end
