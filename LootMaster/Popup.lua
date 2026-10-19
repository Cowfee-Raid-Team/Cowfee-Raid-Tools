local ADDON, CRT = ...

-- The raider popup: one small panel per item of the session you were sent, stacked with a gap, each with
-- the gear you wear in that slot, the response buttons and a note. A button sends your answer to the
-- looter and does a real /roll (not for Pass); the panel then fades, so you can see it is answered, and
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
    rollIcon = 18, -- the roll-type mark beside an item's name
    pad = 8,
    icon = 36,
    button = { w = 70, h = 22, gap = 4, icon = 14 },
    noteW = 190,
    fadeAlpha = 0.55, -- an answered panel
    timerAlpha = 0.07, -- the lighter part of the background, the time left
}

local TEXT = {
    title = "Loot",
    test = "TEST",
    testNote = "nothing is passed or traded",
    rolledAs = "Rolled as %s",
    help = "Pick an answer for each item. Your pick goes to the raid leader, who gives the item out, and every button except Pass also does a /roll that everyone can see. You can change your answer until the time runs out.\n\nThe lighter part of each item's background is the time left. Close an item with its X or a right-click; drag any item to move them all.",
    have = "You have: ",
    nothing = "nothing in that slot",
    sent = "Sent %s",
    rolled = "  ·  rolled %d",
    rollAgain = "Roll again",
    awarded = "Given to %s (%s)",
    notes = "Notes:",
    timeLeft = "Time left: %d",
}

-- What you bring to an answer ---------------------------------------------------------------------

local ROLE_LETTER = { TANK = "T", HEALER = "H", DAMAGER = "D" }

function LM:MyRole()
    local role = UnitGroupRolesAssigned and UnitGroupRolesAssigned("player")
    if not ROLE_LETTER[role] and GetSpecialization and GetSpecializationRole then
        local ok, r = pcall(GetSpecializationRole, GetSpecialization() or 0)
        role = ok and r or role
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

local anchor, header
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
-- when it has one.
local function responseButton(parent, r)
    local b = CreateFrame("Button", nil, parent, "BackdropTemplate")
    b:SetSize(L.button.w, L.button.h)
    b:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    local c = r.color
    b:SetBackdropColor(c[1] * 0.3, c[2] * 0.3, c[3] * 0.3, 0.95)
    b:SetBackdropBorderColor(c[1] * 0.8, c[2] * 0.8, c[3] * 0.8, 1)
    b.text = b:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    b.text:SetTextColor(math.min(1, c[1] * 0.5 + 0.5), math.min(1, c[2] * 0.5 + 0.5), math.min(1, c[3] * 0.5 + 0.5))
    b.text:SetText(r.label)
    if LM.Icon(r.icon) then
        local t = b:CreateTexture(nil, "OVERLAY")
        t:SetSize(L.button.icon, L.button.icon)
        t:SetPoint("LEFT", 4, 0)
        LM.SetIconTexture(t, r.icon)
        b.text:SetPoint("LEFT", t, "RIGHT", 3, 0)
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
    local _, _, subType, equipLoc = C_Item.GetItemInfoInstant(it.itemString or "")
    local parts = {}
    if it.ilvl then
        parts[#parts + 1] = "|cff1eff00" .. it.ilvl .. "|r"
    end
    local slot = equipLoc and equipLoc ~= "" and _G[equipLoc]
    if slot then
        parts[#parts + 1] = (subType and subType ~= "" and subType ~= MISCELLANEOUS) and (slot .. ", " .. subType) or slot
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
    p.rollType = p:CreateTexture(nil, "ARTWORK")
    p.rollType:SetSize(L.rollIcon, L.rollIcon)
    p.rollType:SetPoint("TOPLEFT", p.icon, "TOPRIGHT", 6, 1)
    p.rollTypeHover = CreateFrame("Frame", nil, p)
    p.rollTypeHover:SetAllPoints(p.rollType)
    p.rollTypeHover:SetScript("OnEnter", function(self)
        if self.label then
            GameTooltip:SetOwner(self, "ANCHOR_TOP")
            GameTooltip:SetText(string.format(TEXT.rolledAs, self.label), 1, 1, 1)
            GameTooltip:Show()
        end
    end)
    p.rollTypeHover:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
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
    p.reroll = CreateFrame("Button", nil, p, "UIPanelButtonTemplate")
    p.reroll:SetSize(96, 22)
    p.reroll:SetPoint("LEFT", p.note, "RIGHT", 10, 0)
    p.reroll:SetText(TEXT.rollAgain)
    p.reroll:SetScript("OnClick", function()
        local inc = LM.incoming
        local mine = inc and inc.mine[p.index]
        if mine then
            mine.reroll = nil
        end
        LM:RollFor(p.index)
        LM:Fire("incoming")
    end)
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
    for k, r in ipairs(responses) do
        local b = responseButton(p, r)
        b:SetPoint("TOPLEFT", L.pad + (k - 1) * (L.button.w + L.button.gap), -(L.pad + L.icon + 6))
        b:SetScript("OnClick", function()
            LM:Answer(p.index, r.key, strtrim(p.note:GetText() or ""))
        end)
        p.buttons[k] = b
    end
end

local function fill(p, index, it, mine, inc)
    p.index, p.itemString = index, it.itemString
    setButtons(p, inc.responses)
    local bg, edge = colors()
    p:SetBackdropColor(bg[1], bg[2], bg[3], 0.92)
    p:SetBackdropBorderColor(edge[1], edge[2], edge[3], 1)
    p.icon:SetTexture(C_Item.GetItemIconByID(it.itemString or "") or 134400)
    local rt = it.rollType and LM:RollType(it.rollType)
    p.rollType:SetTexture(rt and rt.icon or nil)
    p.rollType:SetShown(rt ~= nil)
    p.rollTypeHover.label = rt and rt.label or nil
    p.name:ClearAllPoints()
    if rt then
        p.name:SetPoint("TOPLEFT", p.rollType, "TOPRIGHT", 4, -1)
    else
        p.name:SetPoint("TOPLEFT", p.icon, "TOPRIGHT", 8, 0)
    end
    p.name:SetPoint("RIGHT", p.time, "LEFT", -8, 0)
    p.name:SetText(itemText(it))
    -- the detail line reads your gear: worked out when the item changes, not on every timer tick
    if p.detailFor ~= it then
        p.detailFor = it
        p.detail:SetText(detailText(it))
    end
    local award = it.award
    for _, b in ipairs(p.buttons) do
        b:SetEnabled(award == nil)
        local picked = mine and mine.response == b.response
        b:SetAlpha((award or (mine and mine.response and not picked)) and 0.5 or 1)
    end
    local rerolling = mine and mine.reroll and not award
    p.reroll:SetShown(rerolling and true or false)
    p.status:SetShown(not rerolling)
    if award then
        local r = inc.byKey[award.response]
        p.status:SetText(string.format(TEXT.awarded, Ambiguate(award.name, "short"), r and r.label or award.response))
    elseif mine and mine.response then
        local r = inc.byKey[mine.response]
        p.status:SetText(string.format(TEXT.sent, r and r.label or mine.response) .. (mine.roll and string.format(TEXT.rolled, mine.roll) or ""))
    else
        p.status:SetText("")
    end
    -- answered: faded, but still there to change your mind until the time runs out
    p:SetAlpha((mine and mine.response and not rerolling) and L.fadeAlpha or 1)
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
    header:SetBadge(inc.test and TEXT.test or nil, TEXT.testNote)
    local open = openItems(inc)
    local shown = {}
    for k, index in ipairs(open) do
        local p = panel(index)
        p:ClearAllPoints()
        p:SetPoint("TOPLEFT", 0, -(L.headerH + L.gap + (k - 1) * (L.panelH + L.gap)))
        fill(p, index, inc.items[index], inc.mine[index], inc)
        p.time:SetText(string.format(TEXT.timeLeft, math.ceil(timeLeft(inc.items[index], inc))))
        p:Show()
        shown[index] = true
    end
    for index, p in pairs(panels) do
        if not shown[index] then
            p:Hide()
        end
    end
    anchor:SetHeight(L.headerH + L.gap + math.max(1, #open) * (L.panelH + L.gap))
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
