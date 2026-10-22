local ADDON, CRT = ...

-- The Late Tracker page, with three tabs: Tonight (the live list of who is missing, with a running
-- clock, and Start raid now and End raid), History (past nights with totals and the Discord export)
-- and Settings (raid days, start time, grace and the expected roster).

local Late = CRT.Late
local Groups = CRT.Groups
local UI = CRT.UI

local ROW_H = 22
local LIST_W = 250
local TOTALS = "totals"

local GRAY = { 0.35, 0.35, 0.35 }
local BACKDROP = {
    bgFile = "Interface\\Buttons\\WHITE8X8",
    edgeFile = "Interface\\Buttons\\WHITE8X8",
    edgeSize = 1,
}
-- Monday first on the page. The numbers are date()'s weekdays, where 1 is Sunday.
local DAYS = {
    { wday = 2, label = "Mon" }, { wday = 3, label = "Tue" }, { wday = 4, label = "Wed" },
    { wday = 5, label = "Thu" }, { wday = 6, label = "Fri" }, { wday = 7, label = "Sat" },
    { wday = 1, label = "Sun" },
}
local HOW = { schedule = "from the schedule", button = "by Start raid now" }
local ENDED = {
    disband = "the group disbanded",
    button = "End raid was pressed",
    timeout = "it ran 8 hours",
    offline = "you logged in after the group had gone",
}

local page, tonightText, tonightChild, detailText, detailChild, listChild, statusText
local startButton, endButton, layoutButton, deleteButton, editButton
local rows, controls = {}, {}
local selected = TOTALS
local refresh

local function skin(frame, alpha)
    frame:SetBackdrop(BACKDROP)
    frame:SetBackdropColor(0, 0, 0, alpha or 0.5)
    frame:SetBackdropBorderColor(GRAY[1], GRAY[2], GRAY[3], 1)
end

local function makeButton(parent, label, width, height)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontNormal)
    b:SetHighlightFontObject(CRTFontHighlight)
    b:SetDisabledFontObject(CRTFontDisable)
    b:SetSize(width, height or 24)
    b:SetText(label)
    return b
end

local function tooltip(frame, title, body)
    frame:SetScript("OnEnter", function(self)
        GameTooltip:SetOwner(self, "ANCHOR_TOP")
        GameTooltip:SetText(title, 1, 1, 1)
        GameTooltip:AddLine(body, 0.8, 0.8, 0.8, true)
        GameTooltip:Show()
    end)
    frame:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
end

-- Text -------------------------------------------------------------------

local function clock(t)
    return date("%H:%M", t)
end

local function day(t)
    return date("%a %d %b", t)
end

local function minutes(seconds)
    local m = math.floor(seconds / 60 + 0.5)
    if m >= 60 then
        return format("%d h %02d min", math.floor(m / 60), m % 60)
    end
    return m .. " min"
end

local function running(seconds)
    seconds = math.floor(seconds)
    local h, m, s = math.floor(seconds / 3600), math.floor(seconds / 60) % 60, seconds % 60
    if h > 0 then
        return format("%d:%02d:%02d", h, m, s)
    end
    return format("%d:%02d", m, s)
end

local function name(key)
    local r, g, b = Groups.ClassColor(key)
    return format("|cff%02x%02x%02x%s|r", math.floor(r * 255), math.floor(g * 255), math.floor(b * 255), Groups.ReportName(key))
end

local function sortedPlayers(night, now)
    local list = {}
    for _, p in ipairs(night.players) do
        list[#list + 1] = p
    end
    table.sort(list, function(a, b)
        local sa, sb = Late.Seconds(night, a, now), Late.Seconds(night, b, now)
        if sa ~= sb then
            return sa > sb
        end
        return a.key:lower() < b.key:lower()
    end)
    return list
end

local function onTimeLine(names)
    if #names == 0 then
        return nil
    end
    return UI.GoodText("On time (" .. #names .. "):") .. " " .. table.concat(names, ", ")
end

local function tonightLines(night, now)
    local lines = {
        format("Started %s %s, expected roster \"%s\". Running %s.", clock(night.startedAt), HOW[night.how] or "", night.layout or "?", running(now - night.startedAt)),
    }
    if (night.grace or 0) > 0 then
        lines[#lines + 1] = "Grace: " .. night.grace .. " min."
    end
    local missing, late, onTime = {}, {}, {}
    for _, p in ipairs(sortedPlayers(night, now)) do
        if not p.joinedAt then
            missing[#missing + 1] = format("  %s  %s", name(p.key), UI.BadText(running(Late.Seconds(night, p, now))))
        elseif Late.IsLate(night, p) then
            late[#late + 1] = format("  %s  joined %s, %s late", name(p.key), clock(p.joinedAt), minutes(Late.Seconds(night, p)))
        else
            onTime[#onTime + 1] = name(p.key)
        end
    end
    lines[#lines + 1] = ""
    lines[#lines + 1] = UI.BadText("Not here yet (" .. #missing .. "):")
    for _, l in ipairs(missing) do
        lines[#lines + 1] = l
    end
    if #late > 0 then
        lines[#lines + 1] = ""
        lines[#lines + 1] = UI.WarnText("Arrived late (" .. #late .. "):")
        for _, l in ipairs(late) do
            lines[#lines + 1] = l
        end
    end
    -- Who is here on time shows in the grid above, as a ready check.
    return table.concat(lines, "\n")
end

local function nightLines(night)
    local lines = {
        format("%s, started %s %s.", day(night.startedAt), clock(night.startedAt), HOW[night.how] or ""),
        format("Expected roster \"%s\". Ended %s, when %s.", night.layout or "?", clock(night.endedAt), ENDED[night.endReason] or "it ended"),
    }
    if (night.grace or 0) > 0 then
        lines[#lines + 1] = "Grace: " .. night.grace .. " min."
    end
    local late, onTime = {}, {}
    for _, p in ipairs(sortedPlayers(night)) do
        local status = Late.Status(night, p)
        if status ~= "ontime" then
            if status == "noshow" then
                late[#late + 1] = format("  %s  %s, %s until the end", name(p.key), UI.BadText("no-show"), minutes(Late.Seconds(night, p)))
            else
                late[#late + 1] = format("  %s  joined %s, %s late", name(p.key), clock(p.joinedAt), minutes(Late.Seconds(night, p)))
            end
        else
            onTime[#onTime + 1] = name(p.key)
        end
    end
    lines[#lines + 1] = ""
    lines[#lines + 1] = UI.WarnText("Late (" .. #late .. "):")
    for _, l in ipairs(late) do
        lines[#lines + 1] = l
    end
    if #late == 0 then
        lines[#lines + 1] = "  Nobody. Everyone was on time."
    end
    local ok = onTimeLine(onTime)
    if ok then
        lines[#lines + 1] = ""
        lines[#lines + 1] = ok
    end
    return table.concat(lines, "\n")
end

local function setText(fs, child, s)
    fs:SetText(s)
    child:SetHeight(fs:GetStringHeight() + 8)
end

-- Discord export ----------------------------------------------------------------------------
-- Plain text for pasting into Discord: a bold title, then a code block so the columns line up in
-- Discord's fixed-width font. No color codes and no pipe characters, which the game's text box treats
-- as escape codes. Discord's message limit is 2000 characters, so a full 40-player list may need two
-- pastes.

local function pad(s, width)
    s = tostring(s)
    if #s >= width then
        return s:sub(1, width - 1) .. " "
    end
    return s .. string.rep(" ", width - #s)
end

local function plain(key)
    return Groups.ReportName(key)
end

local function totalsExport()
    local history = Late:History()
    if #history == 0 then
        return "No finished raid nights yet."
    end
    local first, last = history[1].startedAt, history[1].startedAt
    for _, night in ipairs(history) do
        first, last = math.min(first, night.startedAt), math.max(last, night.startedAt)
    end
    local lines = {
        format("**Late tracker totals**: %d nights, %s to %s", #history, day(first), day(last)),
        "```",
        pad("Player", 26) .. pad("Late", 9) .. pad("Time late", 13) .. "No-Show",
    }
    for _, t in ipairs(Late:Totals()) do
        lines[#lines + 1] = pad(plain(t.key), 26) .. pad(t.late .. " of " .. t.nights, 9) .. pad(t.late > 0 and minutes(t.seconds) or "-", 13) .. (t.never > 0 and t.never or "-")
    end
    lines[#lines + 1] = "```"
    return table.concat(lines, "\n")
end

local function nightExport(night)
    local lines = {
        format("**Raid night %s**, start %s, roster \"%s\", ended %s when %s", day(night.startedAt), clock(night.startedAt), night.layout or "?", clock(night.endedAt), ENDED[night.endReason] or "it ended"),
    }
    local late, onTime = {}, {}
    for _, p in ipairs(sortedPlayers(night)) do
        if Late.Status(night, p) ~= "ontime" then
            late[#late + 1] = p
        else
            onTime[#onTime + 1] = plain(p.key)
        end
    end
    if #late > 0 then
        lines[#lines + 1] = "```"
        lines[#lines + 1] = pad("Player", 26) .. pad("Joined", 10) .. "Late"
        for _, p in ipairs(late) do
            lines[#lines + 1] = pad(plain(p.key), 26) .. pad(Late.Status(night, p) == "noshow" and "no-show" or clock(p.joinedAt), 10) .. minutes(Late.Seconds(night, p))
        end
        lines[#lines + 1] = "```"
    else
        lines[#lines + 1] = "Nobody was late."
    end
    if #onTime > 0 then
        lines[#lines + 1] = "On time: " .. table.concat(onTime, ", ")
    end
    return table.concat(lines, "\n")
end

-- Opens the copy window with what is selected in History: the totals or one night.
local function export()
    local text, title
    if selected == TOTALS then
        text, title = totalsExport(), "Late tracker totals for Discord (Ctrl+C to copy)"
    else
        local night = Late:Find(selected)
        if not night then
            return
        end
        text, title = nightExport(night), "Raid night for Discord (Ctrl+C to copy)"
    end
    CRT.ConsumablesTools:ShowText(title, text)
end

-- Totals table rows: four text columns per row, made as needed under the intro line.
local TOTAL_ROW_H = 18
local totalRows = {}

local function totalRow(i)
    local row = totalRows[i]
    if row then
        return row
    end
    row = {}
    for _, key in ipairs({ "name", "late", "time", "never" }) do
        local fs = detailChild:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        fs:SetWordWrap(false)
        row[key] = fs
    end
    totalRows[i] = row
    return row
end

local function hideTotals()
    for _, row in pairs(totalRows) do
        for _, fs in pairs(row) do
            fs:Hide()
        end
    end
end

local function place(fs, x, y, width, justify, text)
    fs:ClearAllPoints()
    fs:SetPoint("TOPLEFT", x, y)
    fs:SetWidth(width)
    fs:SetJustifyH(justify)
    fs:SetText(text)
    fs:Show()
end

-- The totals as a table: player, nights late out of nights expected, total time late, and nights
-- they never joined (no-shows), or a line saying there are no nights yet.
local function showTotals()
    hideTotals()
    local history = Late:History()
    if #history == 0 then
        setText(detailText, detailChild, "No finished raid nights yet. Each night is added here when it ends.")
        return
    end
    setText(detailText, detailChild, format("All %d saved nights, most often late first.", #history))
    local w = detailChild:GetWidth()
    if not w or w < 200 then
        w = 370
    end
    local list = Late:Totals()
    -- The player's name takes 40% of the width, and the three numbers share the rest evenly, each
    -- centred under its heading, so the columns spread out as the box grows.
    local nameW = math.floor(w * 0.4)
    local colW = math.floor((w - nameW - 4) / 3)
    local function col(k)
        return nameW + 4 + (k - 1) * colW
    end
    for i = 0, #list do
        local row = totalRow(i + 1)
        local y = -24 - i * TOTAL_ROW_H
        if i == 0 then
            place(row.name, 2, y, nameW - 2, "LEFT", "|cff999999Player|r")
            place(row.late, col(1), y, colW, "CENTER", "|cff999999Late|r")
            place(row.time, col(2), y, colW, "CENTER", "|cff999999Time late|r")
            place(row.never, col(3), y, colW, "CENTER", "|cff999999No-Show|r")
        else
            local t = list[i]
            place(row.name, 2, y, nameW - 2, "LEFT", name(t.key))
            place(row.late, col(1), y, colW, "CENTER", t.late .. " of " .. t.nights)
            place(row.time, col(2), y, colW, "CENTER", t.late > 0 and minutes(t.seconds) or "-")
            place(row.never, col(3), y, colW, "CENTER", t.never > 0 and UI.BadText(t.never) or "-")
        end
    end
    detailChild:SetHeight(24 + (#list + 1) * TOTAL_ROW_H + 8)
end

-- Scrolling text boxes ---------------------------------------------------

local function textBox(pf, scrollName)
    local box = CreateFrame("Frame", nil, pf, "BackdropTemplate")
    skin(box, 0.4)
    local scroll = CreateFrame("ScrollFrame", scrollName, box, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(scroll.ScrollBar)
    scroll:SetPoint("TOPLEFT", 6, -6)
    scroll:SetPoint("BOTTOMRIGHT", -28, 6)
    local child = CreateFrame("Frame", nil, scroll)
    child:SetSize(1, 1)
    scroll:SetScrollChild(child)
    local text = child:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    text:SetPoint("TOPLEFT", 2, -2)
    text:SetJustifyH("LEFT")
    text:SetJustifyV("TOP")
    scroll:SetScript("OnSizeChanged", function(self, w)
        child:SetWidth(w)
        text:SetWidth(w - 6)
    end)
    return box, text, child
end

-- Settings controls ------------------------------------------------------

local function makeNumber(pf, anchor, x, letters, getter, setter, low, high)
    local edit = CreateFrame("EditBox", nil, pf, "InputBoxTemplate")
    edit:SetAutoFocus(false)
    edit:SetFontObject(CRTFontHighlight)
    edit:SetNumeric(true)
    edit:SetMaxLetters(letters)
    edit:SetSize(letters * 12 + 14, 20)
    edit:SetPoint("LEFT", anchor, "RIGHT", x, 0)
    edit:SetScript("OnEnterPressed", function(self)
        self:ClearFocus()
    end)
    edit:SetScript("OnEscapePressed", function(self)
        self:SetText(tostring(getter()))
        self:ClearFocus()
    end)
    edit:SetScript("OnEditFocusLost", function(self)
        local value = tonumber(self:GetText())
        if value then
            setter(math.max(low, math.min(high, math.floor(value))))
        end
        self.refresh()
    end)
    edit.refresh = function()
        if not edit:HasFocus() then
            local value = getter()
            edit:SetText(letters == 2 and format("%02d", value) or tostring(value))
        end
    end
    controls[#controls + 1] = edit
    return edit
end

local function label(pf, text, font)
    local fs = pf:CreateFontString(nil, "OVERLAY", font or "CRTFontNormal")
    fs:SetText(text)
    return fs
end

-- The choices for the expected roster: None, then every saved Raid Groups layout.
local NONE = "none"
local function rosterOptions()
    local out = { { key = NONE, label = "None picked" } }
    for _, p in ipairs(Groups:Presets()) do
        out[#out + 1] = { key = p.id, label = p.name }
    end
    return out
end

-- The active Raid Groups layout's id, or NONE when there is none.
local function rosterKey()
    return Groups:Active() or NONE
end

-- History list -----------------------------------------------------------

local function getRow(i)
    local row = rows[i]
    if row then
        return row
    end
    row = CreateFrame("Button", nil, listChild)
    row:SetHeight(ROW_H)
    row:SetPoint("TOPLEFT", 0, -(i - 1) * ROW_H)
    row:SetPoint("RIGHT", listChild, "RIGHT", 0, 0)
    row.sel = row:CreateTexture(nil, "BACKGROUND")
    row.sel:SetAllPoints()
    UI.Tint(row.sel, "SetColorTexture", "heading", 0.18)
    row.hl = row:CreateTexture(nil, "HIGHLIGHT")
    row.hl:SetAllPoints()
    row.hl:SetColorTexture(1, 1, 1, 0.08)
    row.text = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    row.text:SetPoint("LEFT", 6, 0)
    row.text:SetPoint("RIGHT", -4, 0)
    row.text:SetJustifyH("LEFT")
    row.text:SetWordWrap(false)
    row:SetScript("OnClick", function(self)
        selected = self.value
        refresh()
    end)
    rows[i] = row
    return row
end

local function refreshList()
    local history = Late:History()
    if selected ~= TOTALS and not Late:Find(selected) then
        selected = TOTALS
    end
    local entries = { { value = TOTALS, text = UI.HeadingText("Totals (all nights)") } }
    for i = #history, 1, -1 do
        local night = history[i]
        local count = 0
        for _, p in ipairs(night.players) do
            if Late.Status(night, p) ~= "ontime" then
                count = count + 1
            end
        end
        entries[#entries + 1] = { value = night.id, text = format("%s %s  (%d late)", day(night.startedAt), clock(night.startedAt), count) }
    end
    for i, entry in ipairs(entries) do
        local row = getRow(i)
        row.value = entry.value
        row.text:SetText(entry.text)
        row.sel:SetShown(entry.value == selected)
        row:Show()
    end
    for i = #entries + 1, #rows do
        rows[i]:Hide()
    end
    listChild:SetHeight(#entries * ROW_H)
end

-- Tonight's grid -----------------------------------------------------------
-- The expected roster as its 8 groups (UI.SlotGrid, the same grid as Raid Groups), each player with a
-- ready check icon: ready once they are in your group, a ? while they are not. A late arrival shows how
-- late on the right, and someone not here yet their running time. Players added by hand fill the empty
-- slots after the layout's. Clicking a ? invites that player; right-clicking it can also count them as
-- here on time (Late:SetOnTime).

local READY_ICON = "Interface\\RaidFrame\\ReadyCheck-Ready"
local WAITING_ICON = "Interface\\RaidFrame\\ReadyCheck-Waiting"
local GRID_RIGHT_W = 110 -- room for "invited 1:20  1:04:30" or "moved to 3  +12 min"
local tonightGrid

-- A sample night shown instead of the real one, set by /crt dev late (Dev/LateTest.lua). Display only:
-- it is never saved, and the buttons still act on the real night.
local previewNight

-- Invites (Groups/Invite.lua): clicking a row that isn't here invites that player by the Name-Realm in the
-- expected roster, and they move to its group when they join. Invite all not here does everyone.
local INVITE_TEXT = {
    all = "Invite all not here (%d)",
    allBody = "Invites everyone on tonight's list who isn't in your group. Each one moves to their group in the expected roster when they join, if it has a free spot.",
    click = "Click to invite %s. They move to group %d when they join.",
    clickFree = "Click to invite %s.",
    onTimeHint = "Right-click to count them as here on time, such as for someone on another character or excused.",
    invite = "Invite %s",
    onTime = "Count as here on time",
}
local inviteAllButton, inviteStatus

-- The expected roster's slots, which give each player their group.
local function expectedSlots()
    local preset = Groups:Find(Groups:Active())
    return preset and preset.slots
end

local function expectedName()
    local night = Late:Current()
    local preset = Groups:Find(Groups:Active())
    return (night and night.layout) or (preset and preset.name)
end

-- Who isn't here: tonight's players who haven't joined (with no night running, the expected roster) and
-- aren't in your group now, in list order.
local function notHere()
    local lookup = Groups.MakeLookup(Groups:ReadRoster())
    local night = Late:Current()
    local out = {}
    if night then
        for _, p in ipairs(night.players) do
            if not p.joinedAt and not lookup(p.key) then
                out[#out + 1] = p.key
            end
        end
    else
        for _, key in ipairs(Groups:ActiveNames()) do
            if not lookup(key) then
                out[#out + 1] = key
            end
        end
    end
    return out
end

-- A grid row's player who can be invited: not here yet, and not the sample night.
local function invitable(p)
    if not p or previewNight or p.joinedAt then
        return false
    end
    return not Groups.MakeLookup(Groups:ReadRoster())(p.key)
end

local function invite(keys)
    CRT.Invite:Send(keys, expectedSlots(), expectedName())
end

-- The invite's state on a row (invited 1:20, declined, moved to 3), before the late time, if any.
local function withInvite(p, late, now)
    local entry = CRT.Invite:Entry(p.key)
    local state = entry and not (entry.state == "joined" and not entry.stayed) and CRT.Invite:StateText(p.key, now)
    if state and late ~= "" then
        return state .. "  " .. late
    end
    return state or late
end

local function refreshInvites()
    if not inviteAllButton then
        return
    end
    local n = #notHere()
    inviteAllButton:SetText(format(INVITE_TEXT.all, n))
    local fs = inviteAllButton:GetFontString()
    inviteAllButton:SetWidth(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0))
    inviteAllButton:SetEnabled((CRT.Invite.CanInvite() and n > 0) and true or false)
    inviteStatus:SetText(CRT.Invite:Summary())
end

-- A row's right-click menu: invite them, or count them as here on time (for a running night).
local function openRowMenu(slot)
    local p = slot.player
    if not invitable(p) then
        return
    end
    UI.ContextMenu(slot, function(root)
        root:CreateTitle(Groups.ReportName(p.key))
        local canInvite, why = CRT.Invite.CanInvite()
        local b = root:CreateButton(format(INVITE_TEXT.invite, p.key), function()
            invite({ p.key })
        end)
        b:SetEnabled(canInvite and true or false)
        if not canInvite and b.SetTooltip and GameTooltip_AddNormalLine then
            b:SetTooltip(function(tooltip)
                GameTooltip_AddNormalLine(tooltip, why)
            end)
        end
        if not p.idle then
            root:CreateButton(INVITE_TEXT.onTime, function()
                Late:SetOnTime(p.key)
            end)
        end
    end)
end

-- The player at each grid slot: the layout's slots, then players added by hand in the empty ones.
-- Without a running night, the layout's names with no status.
local function gridPlayers(night)
    local preset = CRT.Groups:Find(CRT.Groups:Active())
    local bySlot, placed = {}, {}
    local byKey = {}
    if night then
        for _, p in ipairs(night.players) do
            byKey[p.key:lower()] = p
        end
    end
    for i = 1, CRT.Groups.NUM_SLOTS do
        local key = preset and preset.slots[i]
        if key and key ~= "" then
            if not night then
                bySlot[i] = { key = key, idle = true }
            elseif byKey[key:lower()] and not placed[key:lower()] then
                bySlot[i] = byKey[key:lower()]
                placed[key:lower()] = true
            end
        end
    end
    if night then
        local free = 1
        for _, p in ipairs(night.players) do
            if not placed[p.key:lower()] then
                while bySlot[free] and free <= CRT.Groups.NUM_SLOTS do
                    free = free + 1
                end
                if free > CRT.Groups.NUM_SLOTS then
                    break
                end
                bySlot[free] = p
                placed[p.key:lower()] = true
            end
        end
    end
    return bySlot
end

local function paintGrid(night, now)
    if not tonightGrid then
        return
    end
    local bySlot = gridPlayers(night)
    for i, b in ipairs(tonightGrid.slots) do
        local p = bySlot[i]
        b.player = p
        if not p then
            b.text:SetText("")
            b.icon:Hide()
            b.right:SetText("")
        else
            b.text:SetText(Groups.ReportName(p.key))
            if p.idle then
                b.text:SetTextColor(0.6, 0.6, 0.6)
                b.icon:Hide()
                b.right:SetText(withInvite(p, "", now))
            elseif p.joinedAt then
                b.text:SetTextColor(Groups.ClassColor(p.key))
                b.icon:SetTexture(READY_ICON)
                b.icon:Show()
                if Late.IsLate(night, p) then
                    b.right:SetText(withInvite(p, UI.WarnText("+" .. minutes(Late.Seconds(night, p))), now))
                else
                    b.right:SetText(withInvite(p, "", now))
                end
            else
                b.text:SetTextColor(0.6, 0.6, 0.6)
                b.icon:SetTexture(WAITING_ICON)
                b.icon:Show()
                b.right:SetText(withInvite(p, UI.BadText(running(Late.Seconds(night, p, now))), now))
            end
        end
        UI.FitText(b.text)
    end
end

-- Refresh ----------------------------------------------------------------

local function refreshTonight()
    local night = previewNight or Late:Current()
    local now = time()
    paintGrid(night, now)
    refreshInvites()
    if previewNight then
        setText(tonightText, tonightChild, "|cff5aa9ffSample night from /crt dev late (not saved; type it again to go back).|r\n" .. tonightLines(night, now))
    elseif night then
        setText(tonightText, tonightChild, tonightLines(night, now))
        startButton:SetText("Restart from now")
        endButton:Enable()
        editButton:Enable()
    else
        local nextStart = Late:NextScheduled(now)
        local s = "No raid night is running."
        if nextStart then
            s = s .. format(" Next scheduled start: %s %s.", day(nextStart), clock(nextStart))
        else
            s = s .. " No raid days are ticked, so only Start raid now starts one."
        end
        setText(tonightText, tonightChild, s)
        startButton:SetText("Start raid now")
        endButton:Disable()
        editButton:Disable()
    end
end

refresh = function()
    if not page or not page:IsShown() then
        return
    end
    for _, control in ipairs(controls) do
        control.refresh()
    end
    refreshTonight()
    refreshList()
    if selected == TOTALS then
        showTotals()
        deleteButton:Hide()
    else
        hideTotals()
        setText(detailText, detailChild, nightLines(Late:Find(selected)))
        deleteButton:Show()
    end
end


-- Edit roster: change tonight's list while the night runs -------------------------------------

local editor

local function editorFont(b)
    b:SetNormalFontObject(CRTFontStandard)
    b:SetHighlightFontObject(CRTFontStandardHighlight)
    b:SetDisabledFontObject(CRTFontStandardDisable)
end

local function statusText(night, p, now)
    if not p.joinedAt then
        return UI.BadText("not here " .. running(Late.Seconds(night, p, now)))
    elseif Late.IsLate(night, p) then
        return UI.WarnText(minutes(Late.Seconds(night, p)) .. " late")
    end
    return UI.GoodText("on time")
end

-- Group members who are not on tonight's list, for the Add dropdown.
local function groupNotListed()
    local night = Late:Current()
    local out = {}
    if not night then
        return out
    end
    local listed = {}
    for _, p in ipairs(night.players) do
        listed[#listed + 1] = { key = p.key }
    end
    local lookup = Groups.MakeLookup(listed)
    for _, entry in ipairs(Groups:ReadRoster()) do
        if not lookup(entry.key) then
            out[#out + 1] = { key = entry.key, label = Groups.Display(entry.key) }
        end
    end
    table.sort(out, function(a, b)
        return a.label:lower() < b.label:lower()
    end)
    return out
end

local function refreshEditor()
    if not editor or not editor:IsShown() then
        return
    end
    local night = Late:Current()
    if not night then
        editor:Hide()
        return
    end
    local now = time()
    local list = sortedPlayers(night, now)
    for i, p in ipairs(list) do
        local row = editor.rows[i]
        if not row then
            row = CreateFrame("Frame", nil, editor.child)
            row:SetHeight(ROW_H)
            row:SetPoint("TOPLEFT", editor.child, "TOPLEFT", 0, -(i - 1) * ROW_H)
            row:SetPoint("TOPRIGHT", editor.child, "TOPRIGHT", 0, -(i - 1) * ROW_H)
            row.name = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
            row.name:SetPoint("LEFT", 4, 0)
            row.name:SetWidth(150)
            row.name:SetJustifyH("LEFT")
            row.name:SetWordWrap(false)
            row.status = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
            row.status:SetPoint("LEFT", 158, 0)
            row.status:SetWidth(90)
            row.status:SetJustifyH("LEFT")
            row.remove = makeButton(row, "Remove", 66, 20)
            editorFont(row.remove)
            row.remove:SetPoint("RIGHT", -2, 0)
            row.remove:SetScript("OnClick", function(self)
                Late:RemovePlayer(self:GetParent().key)
            end)
            row.onTime = makeButton(row, "On time", 66, 20)
            editorFont(row.onTime)
            row.onTime:SetPoint("RIGHT", row.remove, "LEFT", -4, 0)
            row.onTime:SetScript("OnClick", function(self)
                Late:SetOnTime(self:GetParent().key)
            end)
            editor.rows[i] = row
            UI:SkinTree(row)
        end
        row.key = p.key
        row.name:SetText(name(p.key))
        row.status:SetText(statusText(night, p, now))
        row.onTime:SetShown(not p.joinedAt or Late.IsLate(night, p))
        row:Show()
    end
    for i = #list + 1, #editor.rows do
        editor.rows[i]:Hide()
    end
    editor.child:SetHeight(math.max(1, #list * ROW_H))
    editor.count:SetText(format("Tonight's list (%d)", #list))
    editor.addGroup.refresh()
end

local function addTyped()
    local ok, reason = Late:AddPlayer(strtrim(editor.edit:GetText() or ""))
    if ok then
        editor.edit:SetText("")
        editor.edit:ClearFocus()
    elseif reason then
        CRT:Print(reason)
    end
end

local function getEditor()
    if editor then
        return editor
    end
    local d = CreateFrame("Frame", "CowfeeRaidToolsLateRoster", UIParent, "BasicFrameTemplateWithInset")
    UI:StyleWindow(d)
    d:SetSize(440, 480)
    d:SetPoint("CENTER")
    UI:RegisterLayer("popups", d)
    d:SetClampedToScreen(true)
    d:SetMovable(true)
    d:EnableMouse(true)
    d:RegisterForDrag("LeftButton")
    d:SetScript("OnDragStart", function(self) self:StartMoving(true) end)
    d:SetScript("OnDragStop", d.StopMovingOrSizing)
    tinsert(UISpecialFrames, "CowfeeRaidToolsLateRoster")
    UI.SetFrameTitle(d, "Edit tonight's roster")
    editor = d

    d.addGroup = UI.Dropdown(d, "Add from group", {
        options = groupNotListed,
        labelWidth = 110,
        width = 200,
        get = function()
            return nil
        end,
        set = function(key)
            local ok, reason = Late:AddPlayer(key)
            if not ok and reason then
                CRT:Print(reason)
            end
        end,
        enabledIf = function()
            return #groupNotListed() > 0
        end,
    })
    d.addGroup:SetPoint("TOPLEFT", 14, -30)
    if d.addGroup.Dropdown.SetDefaultText then
        d.addGroup.Dropdown:SetDefaultText("Pick a player")
    end
    UI.HelpRight(d.addGroup, "Edit tonight's roster", "Changes tonight's list only; the expected roster on Raid Groups stays as it is. Add from group: someone who should count tonight (press On time if they were here from the start). On time: counts a player as here from the start. Remove: takes them off tonight's list.")

    local sync = makeButton(d, "Update from layout", 150, 22)
    editorFont(sync)
    sync:SetPoint("TOPRIGHT", d, "TOPRIGHT", -16, -100)
    sync:SetScript("OnClick", function()
        local added, removed = Late:SyncLayout()
        if added then
            CRT:Print(format("Tonight's list updated from the expected roster: %d added, %d taken off. The clock keeps running.", added, removed))
        else
            CRT:Print(removed)
        end
    end)
    tooltip(sync, "Update from layout", "Makes tonight's list match the expected roster as saved now, without restarting the clock. New names in your group count as on time; names gone from the layout are taken off unless you added them here.")

    local typed = label(d, "Or type a name")
    typed:SetPoint("TOPLEFT", 16, -72)
    d.edit = CreateFrame("EditBox", nil, d, "InputBoxTemplate")
    d.edit:SetSize(150, 20)
    d.edit:SetPoint("LEFT", typed, "RIGHT", 18, 0)
    d.edit:SetAutoFocus(false)
    d.edit:SetFontObject(CRTFontEdit)
    d.edit:SetScript("OnEnterPressed", addTyped)
    d.edit:SetScript("OnEscapePressed", d.edit.ClearFocus)
    local add = makeButton(d, "Add", 60, 22)
    editorFont(add)
    add:SetPoint("LEFT", d.edit, "RIGHT", 6, 0)
    add:SetScript("OnClick", addTyped)

    d.count = label(d, "Tonight's list")
    d.count:SetPoint("TOPLEFT", 16, -104)
    local box = CreateFrame("Frame", nil, d, "BackdropTemplate")
    box:SetPoint("TOPLEFT", 12, -122)
    box:SetPoint("BOTTOMRIGHT", -12, 12)
    skin(box, 0.4)
    local scroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsLateRosterScroll", box, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(scroll.ScrollBar)
    scroll:SetPoint("TOPLEFT", 4, -4)
    scroll:SetPoint("BOTTOMRIGHT", -26, 4)
    d.child = CreateFrame("Frame", nil, scroll)
    d.child:SetSize(380, 1)
    scroll:SetScrollChild(d.child)
    d.rows = {}

    d:SetScript("OnShow", refreshEditor)
    -- The clocks of players not here yet keep counting while it is open.
    local elapsed = 0
    d:SetScript("OnUpdate", function(_, dt)
        elapsed = elapsed + dt
        if elapsed >= 1 then
            elapsed = 0
            refreshEditor()
        end
    end)
    Late:OnChange(refreshEditor)
    UI:SkinTree(d)
    d:Hide()
    return d
end

-- Build ------------------------------------------------------------------

-- Tabs: Tonight (the live list, Start raid now and End raid), History (past nights, totals and the
-- Discord export) and Settings (raid days, start time, grace and the expected roster). All three are
-- built with the page, so refresh can fill them all.
local TABS = {
    { key = "tonight", label = "Tonight" },
    { key = "history", label = "History" },
    { key = "settings", label = "Settings" },
}
local tabButtons, tabFrames = {}, {}
local currentTab = "tonight"

local function selectTab(key)
    if not tabFrames[key] then
        key = "tonight"
    end
    currentTab = key
    for _, tab in ipairs(TABS) do
        local on = tab.key == key
        tabFrames[tab.key]:SetShown(on)
        UI:SetTabSelected(tabButtons[tab.key], on)
    end
end

-- The three buttons use the game's standard button font, a little smaller than the addon's.
local function standardFont(b)
    b:SetNormalFontObject(CRTFontStandard)
    b:SetHighlightFontObject(CRTFontStandardHighlight)
    b:SetDisabledFontObject(CRTFontStandardDisable)
end

local function buildTonight(f)
    startButton = makeButton(f, "Start raid now", 140)
    standardFont(startButton)
    startButton:SetPoint("TOPLEFT", 8, -8)
    startButton:SetScript("OnClick", function()
        local restarting = Late:Current() ~= nil
        if Late:Start("button", time()) then
            CRT:Print(restarting and "Raid night restarted from now." or "Raid night started.")
        end
    end)
    tooltip(startButton, "Start raid now", "Starts tonight's clock now, for when invites go out. On a raid day it replaces the scheduled start. While a night is running, it restarts from now and the running night isn't saved.")

    endButton = makeButton(f, "End raid", 100)
    standardFont(endButton)
    endButton:SetPoint("LEFT", startButton, "RIGHT", 4, 0)
    endButton:SetScript("OnClick", function()
        Late:End("button", time())
    end)
    tooltip(endButton, "End raid", "Ends tonight and saves it to the history. Anyone who never joined is recorded with the time until now. A disbanded group ends the night on its own.")

    editButton = makeButton(f, "Edit roster", 120)
    standardFont(editButton)
    editButton:SetPoint("LEFT", endButton, "RIGHT", 4, 0)
    editButton:SetScript("OnClick", function()
        local d = getEditor()
        d:SetShown(not d:IsShown())
    end)
    tooltip(editButton, "Edit roster", "Change tonight's list while the raid runs: add someone, count a player as on time, or take someone off. Only tonight changes, not the expected roster.")

    inviteAllButton = makeButton(f, format(INVITE_TEXT.all, 0), 160)
    standardFont(inviteAllButton)
    inviteAllButton:SetPoint("LEFT", editButton, "RIGHT", 4, 0)
    inviteAllButton:SetScript("OnClick", function()
        invite(notHere())
    end)
    if inviteAllButton.SetMotionScriptsWhileDisabled then
        inviteAllButton:SetMotionScriptsWhileDisabled(true) -- the tooltip says why while it is greyed
    end
    inviteAllButton:SetScript("OnEnter", function(self)
        local ok, why = CRT.Invite.CanInvite()
        GameTooltip:SetOwner(self, "ANCHOR_TOP")
        GameTooltip:SetText(self:GetText(), 1, 1, 1)
        GameTooltip:AddLine(ok and INVITE_TEXT.allBody or why, 0.8, 0.8, 0.8, true)
        GameTooltip:Show()
    end)
    inviteAllButton:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    inviteStatus = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    inviteStatus:SetPoint("LEFT", inviteAllButton, "RIGHT", 10, 0)
    inviteStatus:SetPoint("RIGHT", f, "RIGHT", -8, 0)
    inviteStatus:SetHeight(34)
    inviteStatus:SetJustifyH("LEFT")
    inviteStatus:SetJustifyV("MIDDLE")
    inviteStatus:SetWordWrap(true)
    inviteStatus:SetMaxLines(2) -- fits beside the buttons, above the grid
    CRT.Invite:OnChange(function()
        if page and page:IsShown() then
            refreshTonight()
        end
    end)

    -- The expected roster as a grid, then who is missing and who came late in a wide box under it.
    local GRID_TOP = -44
    tonightGrid = UI.SlotGrid(f, { cols = 4, x = 8, top = GRID_TOP, width = UI.PAGE_W - 16, rightW = GRID_RIGHT_W, skin = skin })
    for _, b in ipairs(tonightGrid.slots) do
        b:RegisterForClicks("LeftButtonUp", "RightButtonUp")
        b:SetScript("OnEnter", function(self)
            local p = self.player
            local canInvite = invitable(p)
            if not p or (p.idle and not canInvite) then
                return
            end
            GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
            GameTooltip:SetText(Groups.ReportName(p.key), 1, 1, 1)
            if p.joinedAt then
                GameTooltip:AddLine("In the group since " .. clock(p.joinedAt) .. ".", 0.8, 0.8, 0.8, true)
            elseif canInvite then
                local ok, why = CRT.Invite.CanInvite()
                local group = CRT.Invite.GroupOf(expectedSlots(), p.key)
                local line = (not ok and why) or (group and format(INVITE_TEXT.click, p.key, group)) or format(INVITE_TEXT.clickFree, p.key)
                GameTooltip:AddLine(line, 0.8, 0.8, 0.8, true)
                if not p.idle then
                    GameTooltip:AddLine(INVITE_TEXT.onTimeHint, 0.8, 0.8, 0.8, true)
                end
            end
            GameTooltip:Show()
        end)
        b:SetScript("OnLeave", function()
            GameTooltip:Hide()
        end)
        b:SetScript("OnClick", function(self, button)
            if button == "RightButton" then
                openRowMenu(self)
            elseif invitable(self.player) and CRT.Invite.CanInvite() then
                invite({ self.player.key })
            end
        end)
    end
    local tonightBox
    tonightBox, tonightText, tonightChild = textBox(f, "CowfeeRaidToolsLateTonightScroll")
    tonightBox:SetPoint("TOPLEFT", 8, GRID_TOP - 2 * tonightGrid.blockH - 6)
    tonightBox:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -8, 8)
end

local function buildHistory(f)
    local listBox = CreateFrame("Frame", nil, f, "BackdropTemplate")
    listBox:SetPoint("TOPLEFT", 8, -8)
    listBox:SetPoint("BOTTOMLEFT", 8, 8)
    listBox:SetWidth(LIST_W)
    skin(listBox, 0.4)
    local listScroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsLateListScroll", listBox, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(listScroll.ScrollBar)
    listScroll:SetPoint("TOPLEFT", 4, -4)
    listScroll:SetPoint("BOTTOMRIGHT", -26, 4)
    listChild = CreateFrame("Frame", nil, listScroll)
    listChild:SetSize(LIST_W - 32, 1)
    listScroll:SetScrollChild(listChild)

    local detailBox
    detailBox, detailText, detailChild = textBox(f, "CowfeeRaidToolsLateDetailScroll")
    detailBox:SetPoint("TOPLEFT", listBox, "TOPRIGHT", 8, 0)
    detailBox:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -8, 38)

    local exportButton = makeButton(f, "Export for Discord", 190)
    exportButton:SetPoint("BOTTOMLEFT", detailBox, "BOTTOMLEFT", 0, -30)
    exportButton:SetScript("OnClick", export)
    tooltip(exportButton, "Export for Discord", "Opens the selected totals or night as text, already selected. Press Ctrl+C and paste it into Discord; the columns line up in a code block.")

    deleteButton = makeButton(f, "Delete this night", 190)
    deleteButton:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -8, 8)
    local armToken = 0
    deleteButton:SetScript("OnClick", function(self)
        if selected == TOTALS then
            return
        end
        if not self.armed then
            self.armed = true
            armToken = armToken + 1
            local token = armToken
            self:SetText("Click again to delete")
            C_Timer.After(3, function()
                if token == armToken then
                    self.armed = false
                    self:SetText("Delete this night")
                end
            end)
            return
        end
        armToken = armToken + 1
        self.armed = false
        self:SetText("Delete this night")
        Late:Delete(selected)
    end)
end

local function buildSettings(f)
    -- Raid days.
    local daysLabel = label(f, "Raid days")
    daysLabel:SetPoint("TOPLEFT", 8, -12)
    for i, d in ipairs(DAYS) do
        local check = CreateFrame("CheckButton", nil, f, "UICheckButtonTemplate")
        check:SetSize(24, 24)
        check:SetPoint("TOPLEFT", 110 + (i - 1) * 64, -7)
        local text = label(f, d.label, "CRTFontSmall")
        text:SetPoint("LEFT", check, "RIGHT", 0, 0)
        check:SetScript("OnClick", function(self)
            Late:SetDay(d.wday, self:GetChecked() and true or false)
        end)
        check.refresh = function()
            check:SetChecked(Late:Settings().days[d.wday] and true or false)
        end
        controls[#controls + 1] = check
    end

    -- Start time and grace.
    local timeLabel = label(f, "Start time")
    timeLabel:SetPoint("TOPLEFT", 8, -40)
    local hour = makeNumber(f, timeLabel, 18, 2, function()
        return Late:Settings().hour
    end, function(v)
        Late:Set("hour", v)
    end, 0, 23)
    local colon = label(f, ":")
    colon:SetPoint("LEFT", hour, "RIGHT", 2, 0)
    local minute = makeNumber(f, colon, 8, 2, function()
        return Late:Settings().minute
    end, function(v)
        Late:Set("minute", v)
    end, 0, 59)
    UI.HelpRight(minute, "Start time", "24-hour time, on this computer's clock.\n\nOnly the schedule uses it, so it greys out while no raid day is ticked. Start raid now does not need it.")
    -- The start time is only used by the schedule, so it greys out while no raid day is ticked.
    controls[#controls + 1] = {
        refresh = function()
            local on = next(Late:Settings().days) ~= nil
            local c = on and 1 or 0.5
            for _, edit in ipairs({ hour, minute }) do
                edit:SetEnabled(on)
                edit:SetTextColor(c, c, c)
            end
            if on then
                timeLabel:SetTextColor(UI.Color("heading"))
                colon:SetTextColor(UI.Color("heading"))
            else
                timeLabel:SetTextColor(0.5, 0.5, 0.5)
                colon:SetTextColor(0.5, 0.5, 0.5)
            end
        end,
    }
    local graceLabel = label(f, "Grace minutes")
    graceLabel:SetPoint("TOPLEFT", 440, -40)
    makeNumber(f, graceLabel, 12, 2, function()
        return Late:Settings().grace
    end, function(v)
        Late:Set("grace", v)
    end, 0, 60)

    -- Expected roster.
    layoutButton = UI.Dropdown(f, "Expected roster", {
        options = rosterOptions,
        labelWidth = 100,
        width = 200,
        get = rosterKey,
        set = function(key)
            Groups:SetActive(key ~= NONE and key or nil)
        end,
    })
    layoutButton:SetPoint("TOPLEFT", 8, -62)
    controls[#controls + 1] = layoutButton
    UI.HelpRight(layoutButton, "Expected roster", "The active Raid Groups layout: who should be there, in their groups (Make active on Raid Groups). During a raid night, tonight's list follows it when you change or switch layouts, with everyone's clock kept.")
end

local function build(pf)
    page = pf

    local title = label(pf, "Late Tracker", "CRTFontLarge")
    title:SetPoint("TOPLEFT", 8, -8)
    UI.HelpRight(title, "The Late Tracker", "On the Settings tab, tick your raid days and start time and pick the Raid Groups layout of who should be there. At the start time, anyone in it who isn't in your group is late until they join. Tonight shows the night as it happens; History keeps every night, with an export for Discord.")

    for i, tab in ipairs(TABS) do
        local b = CreateFrame("Button", nil, pf, "BackdropTemplate")
        b:SetSize(160, 26)
        b:SetPoint("TOPLEFT", 8 + (i - 1) * 164, -36)
        skin(b, 0.4)
        b.sel = b:CreateTexture(nil, "ARTWORK")
        b.sel:SetAllPoints()
        b.sel:SetColorTexture(UI.Color("heading", 0.18)) -- UI:RegisterTab styles it from here on
        b.text = b:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
        b.text:SetPoint("CENTER")
        b.text:SetText(tab.label)
        b:SetScript("OnClick", function()
            selectTab(tab.key)
        end)
        tabButtons[tab.key] = b
        UI:RegisterTab(b)

        local f = CreateFrame("Frame", nil, pf)
        f:SetPoint("TOPLEFT", 0, -66)
        f:SetPoint("BOTTOMRIGHT", 0, 0)
        f:Hide()
        tabFrames[tab.key] = f
    end
    local line = pf:CreateTexture(nil, "ARTWORK")
    line:SetColorTexture(0.35, 0.35, 0.35, 1)
    line:SetHeight(1)
    line:SetPoint("TOPLEFT", 8, -62)
    line:SetPoint("TOPRIGHT", -8, -62)

    buildTonight(tabFrames.tonight)
    buildHistory(tabFrames.history)
    buildSettings(tabFrames.settings)

    -- The running clocks update once a second while the page is open.
    local elapsed = 0
    pf:SetScript("OnUpdate", function(_, dt)
        elapsed = elapsed + dt
        if elapsed >= 1 then
            elapsed = 0
            if Late:Current() or previewNight then
                refreshTonight()
            end
        end
    end)
    pf:SetScript("OnShow", function()
        selectTab(currentTab)
        refresh()
    end)
    Late:OnChange(refresh)
    Groups:OnChange(refresh)
end

UI:RegisterPage("late", "Late Tracker", build)

-- For /crt late export: the totals, ready to paste into Discord.
CRT.LatePage = {
    -- For /crt dev late: shows night (or the real one again, for nil) on the Tonight tab.
    Preview = function(night)
        previewNight = night
        UI:Show("late")
        selectTab("tonight")
        refresh()
    end,
    ExportTotals = function()
        CRT.ConsumablesTools:ShowText("Late tracker totals for Discord (Ctrl+C to copy)", totalsExport())
    end,
}
