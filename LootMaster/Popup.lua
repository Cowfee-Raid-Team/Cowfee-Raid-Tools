local ADDON, CRT = ...

-- The raider popup: one small panel per item of the session you were sent, stacked with a gap, each with
-- the gear you wear in that slot, the response buttons and a note. A button sends your answer to the
-- looter, whose CRT draws a roll for it; the panel then fades, so you can see it is answered, and
-- you can still change your mind. Each panel's background is its timer: the lighter part shrinks as the
-- answer time runs out, and the panel closes itself at the end. Close it sooner with its X or a
-- right-click. The looter can show a panel again or ask you to roll again, which restarts its timer.
-- The panels hang from one overlay (UI.Window kind "overlay"): drag any panel to move them all; the
-- place is kept in CRTDB lootmaster.popup. Sizes and the gap are in L, for the dev layout tools later.

local LM = CRT.LootMaster
local UI = CRT.UI

local L = {
    width = 480,
    panelH = 104,
    gap = 4, -- between panels
    headerH = 26, -- the title bar above the panels
    autoH = 22, -- the line saying which items were answered for you
    pad = 8,
    icon = 36,
    showButtonH = 22, -- the Show button on the auto line, as tall as the answer buttons
    button = { h = 22, gap = 4, minGap = 2, rowGap = 4 }, -- widths come from each label (LM.ButtonWidth)
    noteW = 190,
    fadeAlpha = 0.55, -- an answered panel
    timerAlpha = 0.07, -- the lighter part of the background, the time left
}

local TEXT = {
    title = "Loot",
    test = "TEST",
    testNote = "nothing is passed",
    autoOne = "%d item you can't use was answered %s for you.",
    autoMany = "%d items you can't use were answered %s for you.",
    showAuto = "Show",
    answers = "All Loot Rolls",
    autoAnswered = "%s: answered %s for you",
    -- why an item was answered for you, by the reason your CRT found (LM.CantUse)
    autoWhy = {
        spec = "Your specs can't use this", classes = "This is for other classes",
        armor = "Not your armor type", weapon = "Your class can't use this weapon type",
    },
    help = "Pick an answer for each item. Your pick goes to the looter, who gives the item out; every answer gets a roll from 1 to 100, drawn by the looter's CRT and shown in everyone's loot window (no /roll in chat). You can change your answer until the time runs out.\n\nThe lighter part of each item's background is the time left. Close an item with its X or a right-click; drag any item to move them all.",
    have = "You have: ",
    nothing = "nothing in that slot",
    sent = "Sent %s",
    rolled = "  ·  rolled %d",
    awarded = "Given to %s (%s)",
    notes = "Notes:",
    timeLeft = "Time left: %d",
}

-- What you bring to an answer ---------------------------------------------------------------------

local ROLE_LETTER = { TANK = "T", HEALER = "H", DAMAGER = "D" }

-- Your role as a letter. The group role can be a secret value in combat (answering while trash is
-- pulled), so anything unreadable falls back to your spec's role, then to "N".
local function readable(v)
    return not (issecretvalue and issecretvalue(v))
end

function LM:MyRole()
    local ok, role = pcall(UnitGroupRolesAssigned or function() end, "player")
    role = (ok and readable(role)) and role or nil
    if not ROLE_LETTER[role] and GetSpecialization and GetSpecializationRole then
        local ok2, r = pcall(GetSpecializationRole, GetSpecialization() or 0)
        role = (ok2 and readable(r)) and r or role
    end
    return ROLE_LETTER[role] or "N"
end

function LM:MyItemLevel()
    local _, equipped = GetAverageItemLevel()
    return equipped and string.format("%.1f", equipped) or ""
end

-- The gear you wear where this item goes: { { id, ilvl, link } }, lowest item level first.
function LM:MyGear(itemString)
    local out = {}
    local _, _, _, equipLoc = C_Item.GetItemInfoInstant(itemString or "")
    for _, slot in ipairs(LM.SLOTS[equipLoc] or {}) do
        local link = GetInventoryItemLink("player", slot)
        if link then
            local ilvl = C_Item.GetDetailedItemLevelInfo(link)
            out[#out + 1] = { id = GetInventoryItemID("player", slot), ilvl = ilvl, link = link }
        end
    end
    table.sort(out, function(a, b)
        return (a.ilvl or 0) < (b.ilvl or 0)
    end)
    return out
end

-- Panels -----------------------------------------------------------------------------------------------

local anchor, header, autoLine
local panels = {} -- by item index
local loading = {} -- item IDs asked of the game once each

local function settings()
    return CRT.db.lootmaster.popup
end

local function colors()
    if UI:IsModern() then
        return CRT.MOCHA.espresso, CRT.MOCHA.edge
    end
    return { 0.05, 0.05, 0.05 }, { 0.3, 0.3, 0.3 }
end

-- A response button: a dark fill in the response's colour, its edge and text brighter, and its icon
-- when it has one. Its width comes from the label as the game draws it (LM.ButtonWidth), so a long
-- label or an icon never spills over the edge.
local function responseButton(parent, r)
    local b = CreateFrame("Button", nil, parent, "BackdropTemplate")
    b:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    local c = r.color
    b:SetBackdropColor(c[1] * 0.3, c[2] * 0.3, c[3] * 0.3, 0.95)
    b:SetBackdropBorderColor(c[1] * 0.8, c[2] * 0.8, c[3] * 0.8, 1)
    b.text = b:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    b.text:SetTextColor(math.min(1, c[1] * 0.5 + 0.5), math.min(1, c[2] * 0.5 + 0.5), math.min(1, c[3] * 0.5 + 0.5))
    b.text:SetText(r.label)
    b.text:SetWordWrap(false)
    local hasIcon = LM.Icon(r.icon) ~= nil
    b:SetSize(LM.ButtonWidth(b.text:GetStringWidth(), hasIcon), L.button.h)
    if hasIcon then
        local t = b:CreateTexture(nil, "OVERLAY")
        t:SetSize(LM.BUTTON_ICON, LM.BUTTON_ICON)
        t:SetPoint("LEFT", LM.BUTTON_PAD, 0)
        LM.SetIconTexture(t, r.icon)
        b.text:SetPoint("LEFT", t, "RIGHT", LM.BUTTON_ICON_GAP, 0)
    else
        b.text:SetPoint("CENTER")
    end
    b:SetHighlightTexture("Interface\\Buttons\\WHITE8X8")
    b:GetHighlightTexture():SetVertexColor(1, 1, 1, 0.12)
    b.response = r.key
    return b
end

local function itemText(it)
    local name, link = C_Item.GetItemInfo(it.itemString or "")
    if name then
        return link
    end
    local id = tonumber((it.itemString or ""):match("item:(%d+)"))
    if id and not loading[id] then
        loading[id] = true
        Item:CreateFromItemID(id):ContinueOnItemLoad(function()
            LM:Fire("incoming")
        end)
    end
    return "item " .. tostring(id)
end

-- "318 · Hands, Leather · You have: [icon] 334"
local function detailText(it)
    local _, _, subType, equipLoc, _, classID, subClassID = C_Item.GetItemInfoInstant(it.itemString or "")
    local parts = {}
    if it.ilvl then
        parts[#parts + 1] = "|cff1eff00" .. it.ilvl .. "|r"
    end
    -- junk is Miscellaneous class 15, subclass 0 (Enum.ItemMiscellaneousSubclass.Junk)
    -- an item with no slot (INVTYPE_NON_EQUIP_IGNORE has an empty name) shows its subtype alone, if useful
    local slot = equipLoc and equipLoc ~= "" and _G[equipLoc]
    if slot == "" then
        slot = nil
    end
    local sub = subType and subType ~= "" and subType ~= MISCELLANEOUS and not (classID == 15 and subClassID == 0) and subType or nil
    if slot then
        parts[#parts + 1] = sub and (slot .. ", " .. sub) or slot
    elseif sub then
        parts[#parts + 1] = sub
    end
    if not slot then
        return table.concat(parts, "  ·  ")
    end
    local gear = LM:MyGear(it.itemString)
    local have = {}
    for _, g in ipairs(gear) do
        local icon = C_Item.GetItemIconByID(g.id)
        have[#have + 1] = (icon and ("|T" .. icon .. ":14:14|t ") or "") .. (g.ilvl or "?")
    end
    parts[#parts + 1] = TEXT.have .. (#have > 0 and table.concat(have, "  ") or TEXT.nothing)
    return table.concat(parts, "  ·  ")
end

LM.DetailText = detailText

local function closePanel(index)
    local inc = LM.incoming
    if inc then
        local mine = inc.mine[index] or {}
        inc.mine[index] = mine
        mine.closed = true
    end
    LM:Fire("incoming")
end

local function panel(index)
    local p = panels[index]
    if p then
        return p
    end
    p = CreateFrame("Frame", nil, anchor, "BackdropTemplate")
    p:SetSize(L.width, L.panelH)
    p:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    p.timer = p:CreateTexture(nil, "BACKGROUND", nil, 2)
    p.timer:SetPoint("TOPLEFT", 1, -1)
    p.timer:SetPoint("BOTTOMLEFT", 1, 1)
    p.timer:SetColorTexture(1, 1, 1, L.timerAlpha)
    p:EnableMouse(true)
    p:RegisterForDrag("LeftButton")
    p:SetScript("OnDragStart", function()
        anchor:StartDrag()
    end)
    p:SetScript("OnDragStop", function()
        anchor:StopDrag()
    end)
    p:SetScript("OnMouseUp", function(self, button)
        if button == "RightButton" then
            closePanel(self.index)
        end
    end)

    p.icon = p:CreateTexture(nil, "ARTWORK")
    p.icon:SetSize(L.icon, L.icon)
    p.icon:SetPoint("TOPLEFT", L.pad, -L.pad)
    local hover = CreateFrame("Frame", nil, p)
    hover:SetAllPoints(p.icon)
    hover:SetScript("OnEnter", function(self)
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
        pcall(GameTooltip.SetHyperlink, GameTooltip, p.itemString)
        GameTooltip:Show()
    end)
    hover:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)

    p.close = CreateFrame("Button", nil, p, "UIPanelCloseButton")
    p.close:SetSize(20, 20)
    p.close:SetPoint("TOPRIGHT", -2, -2)
    UI:SkinCloseButton(p.close)
    p.close:SetScript("OnClick", function()
        closePanel(p.index)
    end)
    p.time = p:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    p.time:SetPoint("RIGHT", p.close, "LEFT", -4, 0)
    p.time:SetTextColor(0.8, 0.8, 0.8)
    p.name = p:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    p.name:SetPoint("TOPLEFT", p.icon, "TOPRIGHT", 8, 0)
    p.name:SetPoint("RIGHT", p.time, "LEFT", -8, 0)
    p.name:SetJustifyH("LEFT")
    p.name:SetWordWrap(false)
    p.detail = p:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    p.detail:SetPoint("TOPLEFT", p.name, "BOTTOMLEFT", 0, -4)
    p.detail:SetPoint("RIGHT", -L.pad, 0)
    p.detail:SetJustifyH("LEFT")
    p.detail:SetWordWrap(false)
    p.detail:SetTextColor(0.75, 0.75, 0.75)

    p.buttons = {}

    local rowY = -(L.pad + L.icon + 6 + L.button.h + 8)
    p.notesLabel = p:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    p.notesLabel:SetPoint("TOPLEFT", L.pad, rowY - 3)
    p.notesLabel:SetText(TEXT.notes)
    p.note = CreateFrame("EditBox", nil, p, "InputBoxTemplate")
    p.note:SetAutoFocus(false)
    p.note:SetFontObject(CRTFontHighlight)
    p.note:SetSize(L.noteW, 20)
    p.note:SetPoint("LEFT", p.notesLabel, "RIGHT", 10, 0)
    p.note:SetMaxLetters(120)
    p.note:SetScript("OnEscapePressed", function(self)
        self:ClearFocus()
    end)
    p.note:SetScript("OnEnterPressed", function(self)
        self:ClearFocus()
    end)
    p.status = p:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    p.status:SetPoint("LEFT", p.note, "RIGHT", 10, 0)
    p.status:SetPoint("RIGHT", -L.pad, 0)
    p.status:SetJustifyH("LEFT")
    p.status:SetWordWrap(false)
    panels[index] = p
    return p
end

-- The session's buttons (the leader's set), made again only when the set changes.
local function setButtons(p, responses)
    if p.buttonsFor == responses then
        return
    end
    p.buttonsFor = responses
    for _, b in ipairs(p.buttons) do
        b:Hide()
        b:SetParent(nil)
    end
    wipe(p.buttons)
    local widths = {}
    for k, r in ipairs(responses) do
        local b = responseButton(p, r)
        b:SetScript("OnClick", function()
            LM:Answer(p.index, r.key, strtrim(p.note:GetText() or ""))
        end)
        p.buttons[k] = b
        widths[k] = b:GetWidth()
    end
    -- one row with a gap, a tighter gap, or more rows: never overlapping, never past the panel's edge
    local pos, rows = LM.ButtonLayout(widths, L.width - 2 * L.pad, L.button.gap, L.button.minGap)
    local top = -(L.pad + L.icon + 6)
    for k, b in ipairs(p.buttons) do
        b:SetPoint("TOPLEFT", L.pad + pos[k].x, top - (pos[k].row - 1) * (L.button.h + L.button.rowGap))
    end
    -- the Notes line and the panel move down for each extra row
    local extra = (math.max(1, rows) - 1) * (L.button.h + L.button.rowGap)
    p.notesLabel:ClearAllPoints()
    p.notesLabel:SetPoint("TOPLEFT", L.pad, top - L.button.h - 8 - extra - 3)
    p:SetHeight(L.panelH + extra)
end

local function fill(p, index, it, mine, inc)
    p.index, p.itemString = index, it.itemString
    setButtons(p, inc.responses)
    local bg, edge = colors()
    p:SetBackdropColor(bg[1], bg[2], bg[3], 0.92)
    p:SetBackdropBorderColor(edge[1], edge[2], edge[3], 1)
    p.icon:SetTexture(C_Item.GetItemIconByID(it.itemString or "") or 134400)
    p.name:SetText(itemText(it))
    -- the detail line reads your gear: worked out when the item changes, not on every timer tick
    if p.detailFor ~= it then
        p.detailFor = it
        p.detail:SetText(detailText(it))
    end
    local award = it.award
    for _, b in ipairs(p.buttons) do
        b:SetEnabled(award == nil and not (mine and mine.auto))
        local picked = mine and mine.response == b.response
        b:SetAlpha((award or (mine and mine.response and not picked)) and 0.5 or 1)
    end
    if award then
        local r = LM.ResponseOf(inc.byKey, award.response)
        p.status:SetText(string.format(TEXT.awarded, Ambiguate(award.name, "short"), r and r.label or award.response))
    elseif mine and mine.auto then
        local r = LM.ResponseOf(inc.byKey, mine.response)
        p.status:SetText(string.format(TEXT.autoAnswered, TEXT.autoWhy[mine.autoWhy] or TEXT.autoWhy.spec, r and r.label or mine.response))
    elseif mine and mine.response then
        local r = LM.ResponseOf(inc.byKey, mine.response)
        p.status:SetText(string.format(TEXT.sent, r and r.label or mine.response) .. (mine.roll and string.format(TEXT.rolled, mine.roll) or ""))
    else
        p.status:SetText("")
    end
    -- answered: faded, but still there to change your mind until the time runs out
    p:SetAlpha((mine and mine.response) and L.fadeAlpha or 1)
end

local function timeLeft(it, inc)
    return (inc.seconds or 60) - (GetTime() - (it.shownAt or GetTime()))
end

-- Panels still open: not closed, not timed out. Timed-out panels are closed here.
local function openItems(inc)
    local out = {}
    for i = 1, LM.MAX_ITEMS do
        local it = inc.items[i]
        local mine = inc.mine[i]
        if it and not (mine and mine.closed) then
            if timeLeft(it, inc) <= 0 then
                inc.mine[i] = mine or {}
                inc.mine[i].closed = true
            else
                out[#out + 1] = i
            end
        end
    end
    return out
end

local function build()
    if anchor then
        return
    end
    anchor = UI.Window("CowfeeRaidToolsLootPopup", { kind = "overlay", width = L.width, height = 40, saved = settings })
    header = UI.TitleStrip(anchor, L.headerH)
    header:SetPoint("TOPLEFT")
    header:SetWidth(L.width)
    header:EnableMouse(true)
    header:RegisterForDrag("LeftButton")
    header:SetScript("OnDragStart", function()
        anchor:StartDrag()
    end)
    header:SetScript("OnDragStop", function()
        anchor:StopDrag()
    end)
    header.help = UI.Help(header, TEXT.title, TEXT.help)
    header.help:SetPoint("RIGHT", -6, 0)
    -- everyone's answers and rolls, read only (LootMaster/RaiderWindow.lua)
    header.answers = UI.HeaderButton(header, TEXT.answers, function()
        LM:ShowAnswers()
    end)
    header.answers:SetPoint("RIGHT", header.help, "LEFT", -6, 0)
    -- "N items you can't use were answered Transmog for you. Show": shown only when there are any
    autoLine = CreateFrame("Frame", nil, anchor, "BackdropTemplate")
    autoLine:SetSize(L.width, L.autoH)
    autoLine:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8" })
    autoLine:SetBackdropColor(0, 0, 0, 0.75)
    autoLine.text = autoLine:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    autoLine.text:SetPoint("LEFT", L.pad, 0)
    autoLine.text:SetTextColor(0.8, 0.75, 0.65)
    autoLine.show = UI.PanelButton(autoLine, TEXT.showAuto, L.showButtonH, function()
        LM:ShowAutoItems()
    end)
    autoLine.show:SetPoint("LEFT", autoLine.text, "RIGHT", 8, 0)
    autoLine:Hide()
    -- the timers: each open panel's background and time left, once a second is plenty for the text
    local elapsed = 0
    anchor:SetScript("OnUpdate", function(_, dt)
        local inc = LM.incoming
        if not inc then
            return
        end
        for _, p in pairs(panels) do
            if p:IsShown() and inc.items[p.index] then
                local left = timeLeft(inc.items[p.index], inc)
                p.timer:SetWidth(math.max(0.01, (L.width - 2) * math.max(0, left) / (inc.seconds or 60)))
            end
        end
        elapsed = elapsed + dt
        if elapsed >= 1 then
            elapsed = 0
            LM:Fire("incoming")
        end
    end)
end

local function refresh()
    local inc = LM.incoming
    if not inc then
        if anchor then
            anchor:Hide()
        end
        return
    end
    build()
    header:SetTitle(TEXT.title)
    -- TEST for a test, else the boss you saw killed just before (LM:RecentBoss)
    if inc.test then
        header:SetBadge(TEXT.test, TEXT.testNote)
    else
        header:SetBadge(inc.boss, nil, UI.TITLE_STRIP.neutral)
    end
    local open = openItems(inc)
    local shown = {}
    local y = L.headerH + L.gap -- panels can be taller when their buttons wrap, so they stack by height
    local auto, autoKey = 0, nil
    for _, mine in pairs(inc.mine) do
        if mine.auto and mine.closed then
            auto, autoKey = auto + 1, mine.response
        end
    end
    autoLine:SetShown(auto > 0)
    if auto > 0 then
        local r = LM.ResponseOf(inc.byKey, autoKey)
        autoLine.text:SetText(string.format(auto == 1 and TEXT.autoOne or TEXT.autoMany, auto, r and r.label or "Transmog"))
        autoLine:ClearAllPoints()
        autoLine:SetPoint("TOPLEFT", 0, -y)
        y = y + L.autoH + L.gap
    end
    for _, index in ipairs(open) do
        local p = panel(index)
        fill(p, index, inc.items[index], inc.mine[index], inc)
        p:ClearAllPoints()
        p:SetPoint("TOPLEFT", 0, -y)
        y = y + p:GetHeight() + L.gap
        p.time:SetText(string.format(TEXT.timeLeft, math.ceil(timeLeft(inc.items[index], inc))))
        p:Show()
        shown[index] = true
    end
    for index, p in pairs(panels) do
        if not shown[index] then
            p:Hide()
        end
    end
    anchor:SetHeight(math.max(y, L.headerH + L.gap + L.panelH))
    if #open == 0 then
        anchor:Hide()
    end
end

LM:OnChange(function(what, how)
    if what ~= "incoming" then
        return
    end
    if how == "ended" then
        if anchor then
            anchor:Hide()
        end
        return
    end
    refresh()
    if how == "shown" and anchor and LM.incoming and #openItems(LM.incoming) > 0 then
        anchor:Show()
    end
end)

-- /crt loot popup: every item that still has time, closed ones too.
function LM:ShowPopup()
    local inc = self.incoming
    if not inc then
        CRT:Print("Loot Master: you have no loot to answer.")
        return
    end
    for _, mine in pairs(inc.mine) do
        mine.closed = nil
    end
    refresh()
    if anchor and #openItems(inc) > 0 then
        anchor:Show()
    else
        CRT:Print("Loot Master: the time to answer has run out.")
    end
end
