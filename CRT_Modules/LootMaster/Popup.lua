local ADDON, CRT = ...

-- The raider popup: one small panel per item of the session you were sent, stacked with a gap, each with
-- the gear you wear in that slot, the response buttons and a note. A button sends your answer to the
-- looter, whose CRT draws a roll for it; the panel then fades, so you can see it is answered, and
-- you can still change your mind. Each panel's background is its timer: the lighter part shrinks as the
-- answer time runs out, and the panel closes itself at the end. Close it sooner with its X or a
-- right-click. The looter can show a panel again or ask you to roll again, which restarts its timer.
-- An item your CRT answered for you (Comm.lua's CheckSpecs) has no panel unless Show me items I can't use is
-- on: it gets a short row instead (icon, name, item level, "Transmog (auto)", or who it was given to), under
-- the line saying why, until the session ends (past the answer time). So the popup opens on every session, even one where
-- nothing needs a choice (Alex, 2026-10-25: "make sure the loot window always shows"). Its X takes a row away.
-- In Default: Blizzard each panel looks like the game's group-loot roll frame and the whole popup sits in
-- the main window's frame, sized to what shows; the other themes draw it flat in their colours.
-- The panels hang from one overlay (UI.Window kind "overlay"): drag any panel to move them all; the
-- place is kept in CRTDB lootmaster.popup. Sizes and the gap are in L, for the dev layout tools later.

local LM = CRT.LootMaster
local UI = CRT.UI

-- Each panel is laid out like the game's group-loot roll frame: the item icon in its slot at the top left,
-- the name in a dark name plate beside it, the detail line under the plate, the X at the top right, then
-- the answer buttons and Notes along the bottom.
local L = {
    width = 520, -- 8 answers of 12 letters (LM.LABEL_MAX), each with an icon, fit in two rows
    panelH = 116, -- the Notes row clear of the border ring at the bottom
    gap = 4, -- between panels
    headerH = 26, -- the title bar above the panels
    headerClose = 22, -- the title bar's X
    autoH = 22, -- the line saying which items were answered for you
    autoRowH = 24, -- a row per item answered for you, under that line
    autoIcon = 20,
    autoIlvlW = 90, -- the row's item level, before its answer at the right
    autoStateW = 170,
    -- Default: Blizzard: one window frame around the title bar, the auto line and the items, which sit in
    -- its inset (BasicFrameTemplateWithInset's is 4 in from the left, 6 from the right, 4 above the bottom)
    insetLeft = 4,
    insetRight = 6,
    frameBottom = 6, -- under the last item

    pad = 12, -- the buttons, Notes and detail line clear of the border ring
    stoneInset = 4, -- the stone and the timer, inside the border (the game draws it about 4.5 px outside)
    icon = 36,
    iconInset = 12, -- the icon's top left, inside the roll frame's border
    slot = 44, -- the slot border around the icon (the roll frame draws 42 around a 34 icon)
    plateGap = 10, -- icon to name plate
    plateH = 24,
    plateCap = 12, -- the name plate's end pieces (16 by 32 in the game's art, drawn at the plate's height)
    plateRight = 40, -- room for the X right of the plate, clear of the border ring
    close = 24, -- the X (the roll frame draws its 32)
    namePad = 8, -- the name inside the plate
    detailGap = 4, -- plate to the detail line
    buttonsTop = 58, -- the first row of answer buttons, from the panel's top
    borderCorner = 20, -- the roll frame border's corners, kept unstretched
    showButtonH = 22, -- the Show button on the auto line, as tall as the answer buttons
    button = { h = 22, gap = 4, minGap = 2, rowGap = 4 }, -- widths come from each label (LM.ButtonWidth)
    noteW = 190,
    fadeAlpha = 0.55, -- an answered panel
    timerAlpha = 0.07, -- the lighter part of the background, the time left
}

-- The game's roll-frame art (Blizzard_UIPanels_Game/Mainline/GroupLootFrame.xml, live): the border and
-- the item name plate are parts of one texture, cut out by texture coordinates; the slot border is an
-- atlas per item quality (Blizzard_Colors ColorConstants.lua LOOT_BORDER_BY_QUALITY). Shown in Default:
-- Blizzard only; the other themes draw the panel flat in their own colours.
local ART = {
    file = UI.LOOT_TOAST, -- LootToast, 1024 by 256; every piece is cut by UI.LootToastPiece
    texW = 1024,
    texH = 256,
    -- (its stone background is the shared UI.Stone, the tiled marble)
    border = { 0.00097656, 0.28027344, 0.43750000, 0.73437500 }, -- GroupLootFrameTemplate's Border
    -- the roll frame's X: its PassButton (LootRollButtonTemplate, 32 by 32)
    closeUp = "lootroll-toast-icon-pass-up",
    closeHighlight = "lootroll-toast-icon-pass-highlight",
    closeDown = "lootroll-toast-icon-pass-down",
    plateLeft = { 0.79101563, 0.80664063, 0.57421875, 0.69921875 }, -- MasterLooterFrame's NameBorderLeft
    plateMid = { 0.75, 0.764648438, 0.80859375, 0.93359375 }, -- NameBorderMid
    plateRight = { 0.73242188, 0.74804688, 0.80859375, 0.93359375 }, -- NameBorderRight
    slotDefault = "loottoast-itemborder-green", -- the roll frame's own default, for an unknown quality
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
    autoState = "%s (auto)", -- an answered-for-you row's answer
    given = "Given to %s",
    itemLevel = "Item level %d",
    -- why an item was answered for you, by the reason your CRT found (LM.CantUse)
    autoWhy = {
        spec = "Your specs can't use this", classes = "This is for other classes",
        armor = "Not your armor type", weapon = "Your class can't use this weapon type",
    },
    help = "Pick an answer for each item. It goes to the looter, who gives the item out; every answer gets a roll from 1 to 100, drawn by the looter's CRT and shown in everyone's loot window (no /roll in chat). You can change your answer until the time runs out. An item you can't use is answered for you and shows as a short row. Close an item with its X or a right-click; drag any item to move them all.",
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

-- The gear you wear where this item goes: { { slot, id, itemString, link, ilvl } }, lowest item level
-- first. The gear engine reads it (CRT_Core/Gear.lua).
function LM:MyGear(itemString)
    return CRT.Gear:ForItem(itemString)
end

-- Panels -----------------------------------------------------------------------------------------------

local anchor, chrome, header, autoLine
local panels = {} -- by item index
local autoRows = {} -- the answered-for-you rows, by item index
local loading = {} -- item IDs asked of the game once each

local function settings()
    return CRT.db.lootmaster.popup
end

local function colors()
    if UI:IsModern() then
        return CRT.PALETTE.background, CRT.PALETTE.border
    end
    return { 0.05, 0.05, 0.05 }, { 0.3, 0.3, 0.3 }
end

-- The item's quality (Uncommon until the game has the item, as the roll frame does), its colour and its
-- slot border atlas, through the game's ColorManager when it is there.
local UNCOMMON = Enum and Enum.ItemQuality and Enum.ItemQuality.Uncommon or 2

local function qualityOf(itemString)
    local ok, _, _, q = pcall(C_Item.GetItemInfo, itemString or "")
    return ok and type(q) == "number" and q or UNCOMMON
end

local function qualityColor(q)
    local ok, c = pcall(function()
        return ColorManager and ColorManager.GetColorDataForItemQuality and ColorManager.GetColorDataForItemQuality(q)
    end)
    c = ok and c or (ITEM_QUALITY_COLORS and ITEM_QUALITY_COLORS[q])
    if type(c) == "table" and c.r then
        return c.r, c.g, c.b
    end
    return 1, 1, 1
end

local function slotAtlas(q)
    local ok, atlas = pcall(function()
        return ColorManager and ColorManager.GetAtlasDataForLootBorderItemQuality and ColorManager.GetAtlasDataForLootBorderItemQuality(q)
    end)
    atlas = ok and atlas or (LOOT_BORDER_BY_QUALITY and LOOT_BORDER_BY_QUALITY[q])
    return type(atlas) == "string" and atlas or ART.slotDefault
end

-- a part of LootToast cut out by its coordinates, the same way as the stone (CRT_Core/UI/Panel.lua)
local artPiece = UI.LootToastPiece

-- The roll frame's border as eight pieces around the panel: the corners keep their size, the edges
-- stretch, so the art holds its shape on a panel wider and taller than the game's frame.
local function rollBorder(p)
    local b, c = ART.border, L.borderCorner
    local cu, cv = c / ART.texW, c / ART.texH
    local u0, u1, v0, v1 = b[1], b[2], b[3], b[4]
    local pieces = {
        { "TOPLEFT", { u0, u0 + cu, v0, v0 + cv } },
        { "TOPRIGHT", { u1 - cu, u1, v0, v0 + cv } },
        { "BOTTOMLEFT", { u0, u0 + cu, v1 - cv, v1 } },
        { "BOTTOMRIGHT", { u1 - cu, u1, v1 - cv, v1 } },
        { "TOP", { u0 + cu, u1 - cu, v0, v0 + cv } },
        { "BOTTOM", { u0 + cu, u1 - cu, v1 - cv, v1 } },
        { "LEFT", { u0, u0 + cu, v0 + cv, v1 - cv } },
        { "RIGHT", { u1 - cu, u1, v0 + cv, v1 - cv } },
    }
    local out = {}
    for i, piece in ipairs(pieces) do
        local t = artPiece(p, "BORDER", piece[2])
        local where = piece[1]
        if i <= 4 then
            t:SetSize(c, c)
            t:SetPoint(where)
        elseif where == "TOP" or where == "BOTTOM" then
            t:SetHeight(c)
            t:SetPoint(where .. "LEFT", c, 0)
            t:SetPoint(where .. "RIGHT", -c, 0)
        else
            t:SetWidth(c)
            t:SetPoint("TOP" .. where, 0, -c)
            t:SetPoint("BOTTOM" .. where, 0, c)
        end
        out[i] = t
    end
    return out
end

-- The item slot and the name plate: the game's art in Default: Blizzard, flat parts in the theme's
-- colours elsewhere. Built once per panel; paintArt switches them with the theme.
local function itemArt(p)
    p.slot = p:CreateTexture(nil, "OVERLAY")
    p.slot:SetSize(L.slot, L.slot)
    p.slot:SetPoint("CENTER", p.icon)
    p.slotFlat = CreateFrame("Frame", nil, p, "BackdropTemplate")
    p.slotFlat:SetPoint("TOPLEFT", p.icon, -1, 1)
    p.slotFlat:SetPoint("BOTTOMRIGHT", p.icon, 1, -1)
    p.slotFlat:SetBackdrop({ edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })

    local left = artPiece(p, "ARTWORK", ART.plateLeft)
    left:SetSize(L.plateCap, L.plateH)
    left:SetPoint("TOPLEFT", p.icon, "TOPRIGHT", L.plateGap, 0)
    local right = artPiece(p, "ARTWORK", ART.plateRight)
    right:SetSize(L.plateCap, L.plateH)
    right:SetPoint("TOPRIGHT", -L.plateRight, -L.iconInset)
    local mid = artPiece(p, "ARTWORK", ART.plateMid)
    mid:SetPoint("TOPLEFT", left, "TOPRIGHT")
    mid:SetPoint("BOTTOMRIGHT", right, "BOTTOMLEFT")
    p.plate = { left, mid, right }
    p.plateFlat = p:CreateTexture(nil, "ARTWORK")
    p.plateFlat:SetPoint("TOPLEFT", left)
    p.plateFlat:SetPoint("BOTTOMRIGHT", right)
    UI.Tint(p.plateFlat, "SetColorTexture", "surface", 1)
end

local function paintArt(p, itemString)
    local classic = not UI:IsModern()
    local q = qualityOf(itemString)
    local r, g, b = qualityColor(q)
    for _, t in ipairs(p.rollBorder) do
        t:SetShown(classic)
        t:SetVertexColor(r, g, b) -- as the roll frame colours its border
    end
    for _, t in ipairs(p.plate) do
        t:SetShown(classic)
    end
    p.slot:SetAtlas(slotAtlas(q))
    p.slot:SetShown(classic)
    p.stone:SetShown(classic)
    local inset = classic and L.stoneInset or 1
    if p.timerInset ~= inset then
        p.timerInset = inset
        p.timer:ClearAllPoints()
        p.timer:SetPoint("TOPLEFT", inset, -inset)
        p.timer:SetPoint("BOTTOMLEFT", inset, inset)
    end
    p.plateFlat:SetShown(not classic)
    p.slotFlat:SetShown(not classic)
    p.slotFlat:SetBackdropBorderColor(r, g, b, 1)
    local bg, edge = colors()
    -- Default: Blizzard: the stone and the border art take the flat fill's and edge's place
    p:SetBackdropColor(bg[1], bg[2], bg[3], classic and 0 or 0.92)
    p:SetBackdropBorderColor(edge[1], edge[2], edge[3], classic and 0 or 1)
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

-- Junk is the Miscellaneous class's Junk subclass (15 and 0 if the game has no names for them)
local MISC_CLASS = Enum and Enum.ItemClass and Enum.ItemClass.Miscellaneous or 15
local JUNK_SUBCLASS = Enum and Enum.ItemMiscellaneousSubclass and Enum.ItemMiscellaneousSubclass.Junk or 0

-- "318 · Hands, Leather · You have: [icon] 334"
local function detailText(it)
    local _, _, subType, equipLoc, _, classID, subClassID = C_Item.GetItemInfoInstant(it.itemString or "")
    local parts = {}
    if it.ilvl then
        parts[#parts + 1] = "|cff1eff00" .. it.ilvl .. "|r" -- the item level in the game's item green: not a theme colour
    end
    -- an item with no slot (INVTYPE_NON_EQUIP_IGNORE has an empty name) shows its subtype alone, if useful
    local slot = equipLoc and equipLoc ~= "" and _G[equipLoc]
    if slot == "" then
        slot = nil
    end
    local sub = subType and subType ~= "" and subType ~= MISCELLANEOUS and not (classID == MISC_CLASS and subClassID == JUNK_SUBCLASS) and subType or nil
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
        mine.dismissed = mine.auto or nil -- an answered-for-you item gets no row either
    end
    LM:Fire("incoming")
end

-- Closes every item at once (the title bar's X), the answered-for-you rows too; Show again on the
-- looter's side brings them back.
function LM:ClosePopup()
    local inc = LM.incoming
    if inc then
        for i = 1, LM.MAX_ITEMS do
            if inc.items[i] then
                inc.mine[i] = inc.mine[i] or {}
                inc.mine[i].closed = true
                inc.mine[i].dismissed = true
            end
        end
    end
    LM:Fire("incoming")
end

local function panel(index)
    local p = panels[index]
    if p then
        return p
    end
    p = CreateFrame("Frame", nil, anchor, "BackdropTemplate")
    p:SetFrameLevel(chrome:GetFrameLevel() + 2) -- over the window frame
    p:SetSize(L.width, L.panelH)
    p:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    -- Default: Blizzard: the roll frame's stone, the timer lighter over it
    p.stone = UI.Stone(p, "BACKGROUND", 0, L.stoneInset)
    -- placed by paintArt: on the stone in Default: Blizzard, inside the 1 px edge elsewhere
    p.timer = p:CreateTexture(nil, "BACKGROUND", nil, 2)
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

    p.rollBorder = rollBorder(p)
    p.icon = p:CreateTexture(nil, "ARTWORK")
    p.icon:SetSize(L.icon, L.icon)
    p.icon:SetPoint("TOPLEFT", L.iconInset, -L.iconInset)
    itemArt(p)
    local hover = CreateFrame("Frame", nil, p)
    hover:SetAllPoints(p.icon)
    hover:SetScript("OnEnter", function(self)
        UI.TooltipOwner(GameTooltip, self, "ANCHOR_RIGHT", nil, nil, "lootmaster")
        pcall(GameTooltip.SetHyperlink, GameTooltip, p.itemString)
        GameTooltip:Show()
    end)
    hover:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)

    -- the roll frame's X (its Pass button's art) in Default: Blizzard; the flat X elsewhere (SkinCloseButton)
    p.close = CreateFrame("Button", nil, p)
    p.close:SetNormalAtlas(ART.closeUp)
    p.close:SetHighlightAtlas(ART.closeHighlight, "ADD")
    p.close:SetPushedAtlas(ART.closeDown)
    p.close:SetSize(L.close, L.close)
    -- level with the name plate, inside the border
    p.close:SetPoint("TOPRIGHT", -(L.plateRight - L.close) / 2, -(L.iconInset + (L.plateH - L.close) / 2))
    UI:SkinCloseButton(p.close)
    p.close:SetScript("OnClick", function()
        closePanel(p.index)
    end)
    -- the name in the plate; under it the detail line, the time left at its right end
    p.name = p:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    p.name:SetPoint("LEFT", p.plate[1], "LEFT", L.namePad, 0)
    p.name:SetPoint("RIGHT", p.plate[3], "RIGHT", -L.namePad, 0)
    p.name:SetJustifyH("LEFT")
    p.name:SetWordWrap(false)
    p.time = p:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    p.time:SetPoint("TOPRIGHT", -L.pad - 4, -(L.iconInset + L.plateH + L.detailGap))
    p.time:SetTextColor(0.8, 0.8, 0.8)
    p.detail = p:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    p.detail:SetPoint("TOPLEFT", p.plate[1], "BOTTOMLEFT", 0, -L.detailGap)
    p.detail:SetPoint("RIGHT", p.time, "LEFT", -8, 0)
    p.detail:SetJustifyH("LEFT")
    p.detail:SetWordWrap(false)
    p.detail:SetTextColor(0.75, 0.75, 0.75)

    p.buttons = {}

    local rowY = -(L.buttonsTop + L.button.h + 8)
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
    local top = -L.buttonsTop
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
    paintArt(p, it.itemString)
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

-- The answered-for-you items with no panel: each gets a row, for the whole session (past the answer
-- time), so you see who got each one.
local function autoItems(inc)
    local out = {}
    for i = 1, LM.MAX_ITEMS do
        local it, mine = inc.items[i], inc.mine[i]
        if it and mine and mine.auto and mine.closed and not mine.dismissed then
            out[#out + 1] = i
        end
    end
    return out
end

-- Whether the popup has anything to show: a panel or an answered-for-you row.
local function anything(inc)
    return #openItems(inc) > 0 or #autoItems(inc) > 0
end

-- A row for an item answered for you: its icon, name and item level, and its answer or who got it.
local function autoRow(index)
    local r = autoRows[index]
    if r then
        return r
    end
    r = CreateFrame("Frame", nil, anchor, "BackdropTemplate")
    r.autoRow = true
    r:SetFrameLevel(chrome:GetFrameLevel() + 2)
    r:SetSize(L.width, L.autoRowH)
    r:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8" })
    r:SetBackdropColor(0, 0, 0, 0.6)
    r.icon = r:CreateTexture(nil, "ARTWORK")
    r.icon:SetSize(L.autoIcon, L.autoIcon)
    r.icon:SetPoint("LEFT", L.pad, 0)
    r.state = r:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    r.state:SetPoint("RIGHT", -L.pad, 0)
    r.state:SetWidth(L.autoStateW)
    r.state:SetJustifyH("RIGHT")
    r.state:SetWordWrap(false)
    r.state:SetTextColor(0.8, 0.75, 0.65)
    r.ilvl = r:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    r.ilvl:SetPoint("RIGHT", r.state, "LEFT", -8, 0)
    r.ilvl:SetWidth(L.autoIlvlW)
    r.ilvl:SetJustifyH("LEFT")
    r.ilvl:SetTextColor(0.75, 0.75, 0.75)
    r.name = r:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    r.name:SetPoint("LEFT", r.icon, "RIGHT", 8, 0)
    r.name:SetPoint("RIGHT", r.ilvl, "LEFT", -8, 0)
    r.name:SetJustifyH("LEFT")
    r.name:SetWordWrap(false)
    r:EnableMouse(true)
    r:SetScript("OnEnter", function(self)
        UI.TooltipOwner(GameTooltip, self, "ANCHOR_RIGHT", nil, nil, "lootmaster")
        pcall(GameTooltip.SetHyperlink, GameTooltip, self.itemString)
        GameTooltip:Show()
    end)
    r:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    r:RegisterForDrag("LeftButton")
    r:SetScript("OnDragStart", function()
        anchor:StartDrag()
    end)
    r:SetScript("OnDragStop", function()
        anchor:StopDrag()
    end)
    autoRows[index] = r
    return r
end

local function fillAutoRow(r, index, it, mine, inc)
    r.index, r.itemString = index, it.itemString
    r.icon:SetTexture(C_Item.GetItemIconByID(it.itemString or "") or 134400)
    r.name:SetText(itemText(it))
    r.ilvl:SetText(it.ilvl and string.format(TEXT.itemLevel, it.ilvl) or "")
    local resp = LM.ResponseOf(inc.byKey, mine.response)
    if it.award then
        r.state:SetText(string.format(TEXT.given, Ambiguate(it.award.name, "short")))
    else
        r.state:SetText(string.format(TEXT.autoState, resp and resp.label or mine.response))
    end
end

local function build()
    if anchor then
        return
    end
    anchor = UI.Window("CowfeeRaidToolsLootPopup", { kind = "overlay", width = L.width, height = 40, saved = settings })
    -- Default: Blizzard: the whole popup sits in the main window's frame art (the window template, kept
    -- as UI:StyleWindow keeps it), sized to what shows (refresh); the other themes hide it and keep their
    -- flat strip. Its own X is hidden: the title bar has one X for every theme (header.close).
    chrome = CreateFrame("Frame", nil, anchor, UI.WINDOW_DEFAULTS.template)
    -- solid whatever General Settings' Background opacity says: it shows over the game mid-raid
    UI:StyleWindow(chrome, { opaque = true })
    chrome:SetPoint("TOPLEFT")
    if chrome.CloseButton then
        chrome.CloseButton:Hide()
    end
    chrome:EnableMouse(true)
    chrome:RegisterForDrag("LeftButton")
    chrome:SetScript("OnDragStart", function()
        anchor:StartDrag()
    end)
    chrome:SetScript("OnDragStop", function()
        anchor:StopDrag()
    end)
    -- framed: in Default: Blizzard the template draws the title tile and the title sits where it does
    -- on the main window
    header = UI.TitleStrip(anchor, L.headerH, { framed = true, opaque = true })
    header:SetFrameLevel(chrome:GetFrameLevel() + 2)
    header:EnableMouse(true)
    header:RegisterForDrag("LeftButton")
    header:SetScript("OnDragStart", function()
        anchor:StartDrag()
    end)
    header:SetScript("OnDragStop", function()
        anchor:StopDrag()
    end)
    -- the title bar, right to left: the X (closes every item) and All Loot Rolls, on the bar's centre
    -- line; the (i) follows the title
    header.close = CreateFrame("Button", nil, header, "UIPanelCloseButton")
    header.close:SetSize(L.headerClose, L.headerClose)
    header.close:SetPoint("RIGHT", -2, 0)
    header.close:SetScript("OnClick", function()
        LM:ClosePopup()
    end)
    UI:SkinCloseButton(header.close)
    -- everyone's answers and rolls, read only (LootMaster/RaiderWindow.lua)
    header.answers = UI.HeaderButton(header, TEXT.answers, function()
        LM:ShowAnswers()
    end)
    header.answers:SetPoint("RIGHT", header.close, "LEFT", -4, 0)
    header:SetHelp(TEXT.title, TEXT.help) -- strip.help, right of the title (UI/Window.lua)
    -- "N items you can't use were answered Transmog for you. Show": shown only when there are any
    autoLine = CreateFrame("Frame", nil, anchor, "BackdropTemplate")
    autoLine:SetFrameLevel(chrome:GetFrameLevel() + 2)
    autoLine:SetHeight(L.autoH)
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
                p.timer:SetWidth(math.max(0.01, (L.width - 2 * (p.timerInset or 1)) * math.max(0, left) / (inc.seconds or 60)))
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
    local classic = not UI:IsModern()
    -- Default: Blizzard: one window frame around everything, the title bar inside its border as on
    -- UI.Window and the auto line and items inside its inset; the other themes: flat, full width
    local x = classic and L.insetLeft or 0
    local outerW = L.width + (classic and (L.insetLeft + L.insetRight) or 0)
    anchor:SetWidth(outerW)
    header:ClearAllPoints()
    header:SetPoint("TOPLEFT", classic and 1 or 0, classic and -1 or 0)
    header:SetSize(outerW - (classic and 2 or 0), L.headerH - (classic and 2 or 0))
    local y = L.headerH + L.gap -- panels can be taller when their buttons wrap, so they stack by height
    local autoList = autoItems(inc)
    local auto = #autoList
    autoLine:SetShown(auto > 0)
    local rowShown = {}
    if auto > 0 then
        local r = LM.ResponseOf(inc.byKey, inc.mine[autoList[1]].response)
        autoLine.text:SetText(string.format(auto == 1 and TEXT.autoOne or TEXT.autoMany, auto, r and r.label or "Transmog"))
        autoLine:ClearAllPoints()
        autoLine:SetPoint("TOPLEFT", x, -y)
        autoLine:SetWidth(L.width)
        y = y + L.autoH + L.gap
        for _, index in ipairs(autoList) do
            local row = autoRow(index)
            fillAutoRow(row, index, inc.items[index], inc.mine[index], inc)
            row:ClearAllPoints()
            row:SetPoint("TOPLEFT", x, -y)
            y = y + L.autoRowH + L.gap
            row:Show()
            rowShown[index] = true
        end
    end
    for index, row in pairs(autoRows) do
        if not rowShown[index] then
            row:Hide()
        end
    end
    for _, index in ipairs(open) do
        local p = panel(index)
        fill(p, index, inc.items[index], inc.mine[index], inc)
        p:ClearAllPoints()
        p:SetPoint("TOPLEFT", x, -y)
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
    -- the frame ends just under the last thing shown, so it grows and shrinks with the items
    local outerH = y - L.gap + (classic and L.frameBottom or 0)
    chrome:SetShown(classic)
    chrome:SetSize(outerW, outerH)
    anchor:SetHeight(outerH)
    if #open == 0 and auto == 0 then
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
    -- every session opens it, also one where everything was answered for you (its rows show)
    if how == "shown" and anchor and LM.incoming and anything(LM.incoming) then
        anchor:Show()
    end
end)

-- a new theme repaints the open panels
UI:OnTheme(refresh)

-- /crt loot popup: every item that still has time, closed ones too.
function LM:ShowPopup()
    local inc = self.incoming
    if not inc then
        CRT:Print("Loot Master: you have no loot to answer.")
        return
    end
    for _, mine in pairs(inc.mine) do
        mine.closed, mine.dismissed = nil, nil
    end
    refresh()
    if anchor and #openItems(inc) > 0 then
        anchor:Show()
    else
        CRT:Print("Loot Master: the time to answer has run out.")
    end
end
