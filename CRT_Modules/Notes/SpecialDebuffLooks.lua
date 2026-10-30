local ADDON, CRT = ...

-- A debuff list's Looks tab on Mech Alerts' Special panel (Notes/SpecialAlerts.lua shows it in place of an alert's
-- Looks while a debuffList entry is selected; Alerts/DebuffList.lua keeps the choices). From the top:
--   Sides (?)          a row per side, as many as the entry has: its name, its raid groups typed in a box ("1, 3",
--                      1 to 8, saved on Enter or when the box lets go), Default (that side's groups and colours back to
--                      the boss file's), and two swatches, With it and Without it, on the game's colour picker
--   Show every player (?)   off lists only the players with the debuff; greyed and on once the game was seen hiding
--                      who has it (the secret tier: rows can't be filtered)
--   Sort by role       tanks, healers, damage, then name; off, by name
--   Bar height, Bar width   UI.Slider, saved when the bar is let go
--   Preview <label>    UI.PreviewButton on the display's key (Alerts/DebuffListView.lua), one per entry
--   the notice         "The game hides this debuff from addons, so the list can't fill in." once a pull or /crt dev
--                      aura saw it private or unreadable; else a typed groups box's problem
-- Test is the panel's own, at the bottom right. Sound and speech, When, Who and Shield bar are hidden for a debuff list;
-- Markers stays, greyed as for every special alert.

local UI = CRT.UI

-- Every word on this tab, in one place. Keep the keys, change the text in quotes, save, /reload.
local TEXT = {
    sides = "Sides",
    sidesHelp = "Each side lists the players of its raid groups. Type the groups as numbers 1 to 8, such as 1, 3. With it and Without it are the bar's colours. Default puts back the boss file's groups and colours for that side.",
    withIt = "With it",
    withoutIt = "Without it",
    default = "Default",
    showAll = "Show every player",
    showAllHelp = "Lists every player of a side, with or without the debuff. Off, only the players with it show.",
    showAllForced = "The game hides who has this debuff, so the list can't pick them out. Every player of a side shows, coloured with it or without it, so this stays on.",
    sortByRole = "Sort by role",
    sortHelp = "Tanks first, then healers, then damage, each by name. Off, by name only.",
    barHeight = "Bar height",
    barWidth = "Bar width",
    pixels = "%d px",
    preview = "Preview %s",
    previewTip = "Shows the list with sample names, so you can drag it into place.",
}

local L = {
    ROW_H = 28, -- a side's row
    HEAD_H = 22, -- the Sides heading
    LABEL_W = 90, -- a side's name
    EDIT_W = 70, EDIT_H = 20,
    GAP = 8,
    SWATCH_W = 36, SWATCH_H = 16,
    SWATCH_LABEL_W = 70,
    CHECK = 24, CHECK_LABEL_W = 160,
    SLIDER_LABEL = 90, SLIDER_W = 150,
    BUTTON_H = 22,
}

local M = { TEXT = TEXT, L = L }
CRT.NoteDebuffLooks = M

local function DL()
    return CRT.AlertDebuffList
end

local function width(fs)
    local w = fs.GetUnboundedStringWidth and fs:GetUnboundedStringWidth() or fs:GetStringWidth()
    return math.ceil(tonumber(w) or 0)
end

-- Builds the tab into parent. host: { x (the left inset), y (the top), current = fn -> entry, enc }. Returns the tab:
-- frame, sides (each row's parts), showAll, sortByRole, height, width, notice, previews (by key), and Refresh().
function M.Build(parent, host)
    local t = { sides = {}, previews = {}, host = host }
    local f = CreateFrame("Frame", nil, parent)
    f:SetPoint("TOPLEFT", parent, "TOPLEFT", 0, 0)
    f:SetPoint("BOTTOMRIGHT", parent, "BOTTOMRIGHT", 0, 0)
    t.frame = f
    local x = host.x

    local function current()
        local entry, enc = host.current()
        return entry, enc
    end

    local function set(field, value, side, which)
        local entry, enc = current()
        if entry then
            t.problem = nil
            DL():SetLook(enc, entry, field, value, side, which)
            t.Refresh()
        end
    end

    t.heading = f:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    t.heading:SetPoint("TOPLEFT", x, host.y)
    t.heading:SetText(TEXT.sides)
    t.headingHelp = UI.HelpRight(t.heading, TEXT.sides, TEXT.sidesHelp)

    -- one side's row, made the first time a list has that many sides
    local function sideRow(i)
        local r = t.sides[i]
        if r then
            return r
        end
        r = {}
        r.label = f:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
        r.label:SetWidth(L.LABEL_W)
        r.label:SetJustifyH("LEFT")
        r.label:SetWordWrap(false)
        r.edit = CreateFrame("EditBox", nil, f, "InputBoxTemplate")
        r.edit:SetAutoFocus(false)
        r.edit:SetFontObject(CRTFontEdit)
        r.edit:SetSize(L.EDIT_W, L.EDIT_H)
        local function save(self)
            local entry = current()
            local side = r.side
            if not (entry and side) then
                return
            end
            local list, why = DL().ParseGroups(self:GetText())
            if list then
                set("groups", list, side.key)
            else
                t.problem = why
                self:SetText(DL().GroupsText(side.groups))
                t.PaintNotice()
            end
        end
        r.edit:SetScript("OnEnterPressed", function(self)
            self:ClearFocus()
        end)
        r.edit:SetScript("OnEditFocusLost", save)
        r.edit:SetScript("OnEscapePressed", function(self)
            self:SetText(r.side and DL().GroupsText(r.side.groups) or "")
            self:ClearFocus()
        end)
        r.default = UI.PanelButton(f, TEXT.default, L.BUTTON_H, function()
            local entry, enc = current()
            if entry and r.side then
                t.problem = nil
                DL():SetLook(enc, entry, "groups", nil, r.side.key)
                DL():SetLook(enc, entry, "color", nil, r.side.key, "on")
                DL():SetLook(enc, entry, "color", nil, r.side.key, "off")
                t.Refresh()
            end
        end)
        r.swatches = {}
        for _, which in ipairs({ "on", "off" }) do
            local name = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
            name:SetText(which == "on" and TEXT.withIt or TEXT.withoutIt)
            name:SetWidth(L.SWATCH_LABEL_W)
            name:SetJustifyH("RIGHT")
            local b = CreateFrame("Button", nil, f, "BackdropTemplate")
            b:SetSize(L.SWATCH_W, L.SWATCH_H)
            if b.SetBackdrop then
                b:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
                b:SetBackdropBorderColor(0, 0, 0, 1) -- the swatch's edge: not a theme colour
            end
            b:SetScript("OnClick", function()
                local look = r.look
                if look and r.side then
                    local before = look.colors[r.side.key][which]
                    UI.PickColor(before, function(c)
                        set("color", c, r.side.key, which)
                    end)
                end
            end)
            r.swatches[which] = { label = name, button = b }
        end
        t.sides[i] = r
        return r
    end
    t.SideRow = sideRow

    local function check(label, onClick)
        local c = CreateFrame("CheckButton", nil, f, "UICheckButtonTemplate")
        c:SetSize(L.CHECK, L.CHECK)
        local fs = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        fs:SetPoint("LEFT", c, "RIGHT", 2, 0)
        fs:SetJustifyH("LEFT")
        fs:SetText(label)
        fs:SetWidth(math.min(L.CHECK_LABEL_W, width(fs) + 4))
        c.label = fs
        c:SetScript("OnClick", function(self)
            onClick(self:GetChecked() and true or false)
        end)
        return c
    end
    t.showAll = check(TEXT.showAll, function(on)
        set("showAll", on)
    end)
    t.showAllHelp = UI.HelpRight(t.showAll.label, TEXT.showAll, function()
        local entry = current()
        if entry and DL():ForcedShowAll(entry.spellID) then
            return TEXT.showAllHelp .. "\n\n" .. TEXT.showAllForced
        end
        return TEXT.showAllHelp
    end)
    t.sortByRole = check(TEXT.sortByRole, function(on)
        set("sortByRole", on)
    end)
    t.sortHelp = UI.HelpRight(t.sortByRole.label, TEXT.sortByRole, TEXT.sortHelp)

    local function slider(label, field, rangeKey)
        local range = CRT.AlertSpecial.BAR_RANGE[rangeKey]
        local s = UI.Slider(f, label, {
            min = range.min, max = range.max, step = 1, labelWidth = L.SLIDER_LABEL, width = L.SLIDER_W,
            onRelease = true,
            format = function(v)
                return string.format(TEXT.pixels, math.floor(v + 0.5))
            end,
            get = function()
                local entry, enc = current()
                return entry and DL():Look(enc, entry)[field] or range.default
            end,
            set = function(v)
                set(field, v)
            end,
        })
        return s
    end
    t.height = slider(TEXT.barHeight, "barHeight", "height")
    t.width = slider(TEXT.barWidth, "barWidth", "width")

    t.notice = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    t.notice:SetJustifyH("LEFT")
    t.notice:SetWordWrap(false)
    t.notice:SetWidth(host.width)

    -- The entry's Preview button, made once per entry (its key and label are its own).
    local function previewFor(entry, enc)
        local View = CRT.AlertDebuffListView
        local key = View.Key(enc, entry.key)
        local b = t.previews[key]
        if not b then
            View:Register()
            b = UI.PreviewButton(f, string.format(TEXT.preview, entry.label), { key }, { tooltip = TEXT.previewTip, height = L.BUTTON_H })
            t.previews[key] = b
        end
        return b, key
    end

    function t.PaintNotice()
        local entry = current()
        local hidden = entry and DL():Notice(entry.spellID)
        if t.problem then
            t.notice:SetText(UI.BadText(t.problem))
        elseif hidden then
            t.notice:SetText(UI.WarnText(hidden))
        else
            t.notice:SetText("")
        end
    end

    -- Draws the tab for the selected entry: a row per side, the rest under them.
    function t.Refresh()
        local entry, enc = current()
        if not entry then
            return
        end
        local look = DL():Look(enc, entry)
        local y = host.y - L.HEAD_H
        for i, side in ipairs(look.sides) do
            local r = sideRow(i)
            r.side, r.look = side, look
            r.label:ClearAllPoints()
            r.label:SetPoint("TOPLEFT", x, y - 4)
            r.label:SetText(side.label)
            r.edit:ClearAllPoints()
            r.edit:SetPoint("TOPLEFT", x + L.LABEL_W + 6, y)
            if not (r.edit.HasFocus and r.edit:HasFocus()) then
                r.edit:SetText(DL().GroupsText(side.groups))
            end
            r.default:ClearAllPoints()
            r.default:SetPoint("LEFT", r.edit, "RIGHT", L.GAP, 0)
            local saved = DL():Store(enc, entry.key)
            local own = side.own or (saved and type(saved.colors) == "table" and saved.colors[side.key] ~= nil)
            r.default:SetEnabled(own and true or false)
            local sx = x + L.LABEL_W + 6 + L.EDIT_W + L.GAP + r.default:GetWidth() + L.GAP
            for k, which in ipairs({ "on", "off" }) do
                local sw = r.swatches[which]
                sw.label:ClearAllPoints()
                sw.label:SetPoint("TOPLEFT", sx + (k - 1) * (L.SWATCH_LABEL_W + L.SWATCH_W + L.GAP * 2), y - 4)
                sw.button:ClearAllPoints()
                sw.button:SetPoint("LEFT", sw.label, "RIGHT", L.GAP, 0)
                local c = look.colors[side.key][which]
                if sw.button.SetBackdropColor then
                    sw.button:SetBackdropColor(c[1], c[2], c[3], 1)
                end
            end
            for _, part in ipairs({ r.label, r.edit, r.default, r.swatches.on.label, r.swatches.on.button, r.swatches.off.label, r.swatches.off.button }) do
                part:Show()
            end
            y = y - L.ROW_H
        end
        for i = #look.sides + 1, #t.sides do
            local r = t.sides[i]
            for _, part in ipairs({ r.label, r.edit, r.default, r.swatches.on.label, r.swatches.on.button, r.swatches.off.label, r.swatches.off.button }) do
                part:Hide()
            end
        end
        y = y - 4
        -- Show every player: greyed and on while the game hides who has it (the rows can't be filtered)
        local forced = DL():ForcedShowAll(entry.spellID)
        t.showAll:ClearAllPoints()
        t.showAll:SetPoint("TOPLEFT", x - 4, y)
        t.showAll:SetChecked(forced or look.showAll)
        t.showAll:SetEnabled(not forced)
        t.showAll.label:SetAlpha(forced and 0.5 or 1)
        t.sortByRole:ClearAllPoints()
        t.sortByRole:SetPoint("TOPLEFT", x - 4, y - 26)
        t.sortByRole:SetChecked(look.sortByRole)
        t.height:ClearAllPoints()
        t.height:SetPoint("TOPLEFT", x, y - 58)
        t.height.refresh()
        t.width:ClearAllPoints()
        t.width:SetPoint("TOPLEFT", x, y - 86)
        t.width.refresh()
        local shownKey
        local b, key = previewFor(entry, enc)
        b:ClearAllPoints()
        b:SetPoint("TOPLEFT", x, y - 120)
        b.refresh()
        shownKey = key
        for k, other in pairs(t.previews) do
            other:SetShown(k == shownKey)
        end
        t.notice:ClearAllPoints()
        t.notice:SetPoint("TOPLEFT", x, y - 152)
        t.PaintNotice()
    end

    return t
end
