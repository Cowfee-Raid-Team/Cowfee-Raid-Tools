local ADDON, CRT = ...

-- The raider popup: every item of the session you were sent, with the gear you wear in that slot, the
-- response buttons and a note. A button sends your answer to the looter and does a real /roll (not for
-- Pass); the looter can ask you to answer again or to roll again. A test session says TEST in the title.
-- The window is made by UI.Window; its place is kept in CRTDB lootmaster.popup.

local LM = CRT.LootMaster
local UI = CRT.UI

local L = {
    width = 470,
    itemH = 96, -- one item's block
    top = 6,
    bottom = 10,
    icon = 36,
    button = { w = 68, h = 22, gap = 4 },
}

local TEXT = {
    title = "Loot",
    titleTest = "Loot — TEST (nothing is passed or traded)",
    help = "Pick an answer for each item. Your pick goes to the raid leader, who gives the item out, and every button except Pass also does a /roll that everyone can see. You can change your answer until the leader gives the item out.",
    have = "You have: ",
    nothing = "You have nothing in that slot",
    sent = "Sent %s",
    rolled = "  ·  you rolled %d",
    rollAgain = "Roll again",
    askedRoll = "The leader asked you to roll again",
    awarded = "Given to %s (%s)",
    notePlaceholder = "Note to the leader (optional)",
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

-- The window -----------------------------------------------------------------------------------------

local win
local blocks = {}

local function settings()
    return CRT.db.lootmaster.popup
end

local function colorButton(parent, r)
    local b = CreateFrame("Button", nil, parent, "BackdropTemplate")
    b:SetSize(L.button.w, L.button.h)
    b:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    b:SetBackdropColor(r.color[1], r.color[2], r.color[3], 0.9)
    b:SetBackdropBorderColor(0, 0, 0, 1)
    b.text = b:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    b.text:SetPoint("CENTER")
    b.text:SetTextColor(0, 0, 0)
    b.text:SetText(r.label)
    b:SetHighlightTexture("Interface\\Buttons\\WHITE8X8")
    b:GetHighlightTexture():SetVertexColor(1, 1, 1, 0.25)
    b.response = r.key
    return b
end

local loading = {} -- item IDs asked of the game once each

local function itemText(it)
    local name, link = C_Item.GetItemInfo(it.itemString or "")
    if not name then
        local id = tonumber((it.itemString or ""):match("item:(%d+)"))
        if id and not loading[id] then
            loading[id] = true
            Item:CreateFromItemID(id):ContinueOnItemLoad(function()
                LM:Fire("incoming")
            end)
        end
        return "item " .. tostring(id)
    end
    return link
end

local function gearText(itemString)
    local gear = LM:MyGear(itemString)
    if #gear == 0 then
        return TEXT.nothing
    end
    local parts = {}
    for _, g in ipairs(gear) do
        local icon = C_Item.GetItemIconByID(g.id)
        parts[#parts + 1] = (icon and ("|T" .. icon .. ":14:14|t ") or "") .. (g.ilvl or "?")
    end
    return TEXT.have .. table.concat(parts, "   ")
end

local function block(i)
    local b = blocks[i]
    if b then
        return b
    end
    b = CreateFrame("Frame", nil, win.content)
    b:SetSize(L.width - 20, L.itemH)
    b:SetPoint("TOPLEFT", 0, -L.top - (i - 1) * L.itemH)
    b.icon = b:CreateTexture(nil, "ARTWORK")
    b.icon:SetSize(L.icon, L.icon)
    b.icon:SetPoint("TOPLEFT", 2, -2)
    b.name = b:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    b.name:SetPoint("TOPLEFT", b.icon, "TOPRIGHT", 8, 0)
    b.name:SetPoint("RIGHT", -50, 0)
    b.name:SetJustifyH("LEFT")
    b.name:SetWordWrap(false)
    b.ilvl = b:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    b.ilvl:SetPoint("TOPRIGHT", -4, -2)
    b.ilvl:SetTextColor(0.12, 1, 0)
    b.gear = b:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    b.gear:SetPoint("TOPLEFT", b.name, "BOTTOMLEFT", 0, -4)
    b.gear:SetTextColor(0.7, 0.7, 0.7)
    local hover = CreateFrame("Frame", nil, b)
    hover:SetAllPoints(b.icon)
    hover:SetScript("OnEnter", function(self)
        if b.itemString then
            GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
            pcall(GameTooltip.SetHyperlink, GameTooltip, b.itemString)
            GameTooltip:Show()
        end
    end)
    hover:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    b.buttons = {}
    for k, r in ipairs(LM.RESPONSES) do
        local btn = colorButton(b, r)
        btn:SetPoint("TOPLEFT", 2 + (k - 1) * (L.button.w + L.button.gap), -L.icon - 8)
        btn:SetScript("OnClick", function()
            LM:Answer(b.index, r.key, strtrim(b.note:GetText() or ""))
        end)
        b.buttons[k] = btn
    end
    b.note = CreateFrame("EditBox", nil, b, "InputBoxTemplate")
    b.note:SetAutoFocus(false)
    b.note:SetFontObject(CRTFontHighlightSmall or CRTFontHighlight)
    b.note:SetSize(230, 20)
    b.note:SetPoint("TOPLEFT", 8, -L.icon - 8 - L.button.h - 6)
    b.note:SetMaxLetters(120)
    b.note:SetScript("OnEscapePressed", function(self)
        self:ClearFocus()
    end)
    b.status = b:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    b.status:SetPoint("LEFT", b.note, "RIGHT", 10, 0)
    b.status:SetPoint("RIGHT", -4, 0)
    b.status:SetJustifyH("LEFT")
    b.status:SetWordWrap(false)
    b.reroll = CreateFrame("Button", nil, b, "UIPanelButtonTemplate")
    b.reroll:SetSize(96, 22)
    b.reroll:SetPoint("LEFT", b.note, "RIGHT", 10, 0)
    b.reroll:SetText(TEXT.rollAgain)
    b.reroll:SetScript("OnClick", function()
        LM:RollFor(b.index)
        local inc = LM.incoming
        local mine = inc and inc.mine[b.index]
        if mine then
            mine.reroll = nil
        end
        LM:Fire("incoming")
    end)
    local line = b:CreateTexture(nil, "ARTWORK")
    line:SetColorTexture(0.35, 0.35, 0.35, 0.6)
    line:SetHeight(1)
    line:SetPoint("BOTTOMLEFT", 0, 2)
    line:SetPoint("BOTTOMRIGHT", 0, 2)
    blocks[i] = b
    return b
end

local function fill(b, i, it, mine)
    b.index, b.itemString = i, it.itemString
    b.icon:SetTexture(C_Item.GetItemIconByID(it.itemString or "") or 134400)
    b.name:SetText(itemText(it))
    b.ilvl:SetText(it.ilvl or "")
    b.gear:SetText(gearText(it.itemString))
    local award = it.award
    for _, btn in ipairs(b.buttons) do
        btn:SetEnabled(award == nil)
        btn:SetAlpha(award and 0.4 or ((mine and mine.response and mine.response ~= btn.response) and 0.55 or 1))
    end
    b.reroll:SetShown(mine and mine.reroll and not award or false)
    if award then
        local r = LM:Response(award.response)
        b.status:SetText(string.format(TEXT.awarded, Ambiguate(award.name, "short"), r and r.label or award.response))
    elseif mine and mine.reroll then
        b.status:SetText("")
    elseif mine and mine.response then
        local r = LM:Response(mine.response)
        b.status:SetText(string.format(TEXT.sent, r and r.label or mine.response) .. (mine.roll and string.format(TEXT.rolled, mine.roll) or ""))
    else
        b.status:SetText("")
    end
    b.note:SetShown(not (mine and mine.reroll))
    b:Show()
end

local function build()
    if win then
        return
    end
    win = UI.Window("CowfeeRaidToolsLootPopup", {
        kind = "dialog", title = TEXT.title, width = L.width, height = 200, saved = settings,
    })
    win.help = UI.Help(win, "Loot", TEXT.help)
    win.help:SetPoint("TOPLEFT", 6, -4)
end

local function refresh()
    local inc = LM.incoming
    if not inc then
        if win then
            win:Hide()
        end
        return
    end
    build()
    UI.SetFrameTitle(win, inc.test and TEXT.titleTest or TEXT.title)
    local n = 0
    for i = 1, LM.MAX_ITEMS do
        local it = inc.items[i]
        if it then
            n = n + 1
            local b = block(n)
            fill(b, i, it, inc.mine[i])
        end
    end
    for k = n + 1, #blocks do
        blocks[k]:Hide()
    end
    win:SetHeight(UI.WINDOW_DEFAULTS.titleHeight + 4 + L.top + n * L.itemH + L.bottom + UI.WINDOW_DEFAULTS.inset)
end

LM:OnChange(function(what, how)
    if what ~= "incoming" then
        return
    end
    if how == "ended" then
        if win then
            win:Hide()
        end
        return
    end
    refresh()
    if how == "shown" and win and LM.incoming then
        win:Show()
    end
end)

function LM:ShowPopup()
    refresh()
    if win and self.incoming then
        win:Show()
    end
end
