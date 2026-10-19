local ADDON, CRT = ...

-- The column of item tabs both loot windows share (the looter's and the raider window): each tab is the
-- item's icon with, beside it, who it was given to (in their class colour) or "Open" with "3/5 answered":
-- the answers in of the raiders with CRT, orange when the time ran out with answers missing. Click picks
-- the item; the looter window also uses right-click (its menu) and double-click (trade the item to its
-- winner).
--   local tabs = LM.ItemTabs(parent, opts)
--   opts: onSelect(index), onRightClick(tab), onDoubleClick(index), doubleClickHint (tooltip line)
--   tabs:Update(items, current, count(index) -> answered, expected, late (Session:AnswerCount),
--               classOf(name) -> class file)

local LM = CRT.LootMaster

local L = { width = 146, height = 40, gap = 6, icon = 36 }
LM.TAB_COLUMN = L.width

local TEXT = { given = "Given to", open = "Open", answered = "%d/%d answered" }
local COUNT_COLOR = { 0.85, 0.85, 0.85 }
LM.TAB_LATE_COLOR = { 1, 0.54, 0.25 } -- the count when someone ran out of time

local function classColor(file)
    return file and (C_ClassColor and C_ClassColor.GetClassColor(file) or RAID_CLASS_COLORS[file]) or nil
end

function LM.ItemTabs(parent, opts)
    local self = { tabs = {}, items = nil }

    local function tab(i)
        local t = self.tabs[i]
        if t then
            return t
        end
        t = CreateFrame("Button", nil, parent)
        t:SetSize(L.width, L.height)
        t:SetPoint("TOPLEFT", 0, -(i - 1) * (L.height + L.gap))
        t.sel = t:CreateTexture(nil, "BACKGROUND")
        t.sel:SetAllPoints()
        t.sel:SetColorTexture(0.78, 0.56, 0.36, 0.12)
        local hl = t:CreateTexture(nil, "HIGHLIGHT")
        hl:SetAllPoints()
        hl:SetColorTexture(1, 1, 1, 0.05)
        t.frame = CreateFrame("Frame", nil, t, "BackdropTemplate")
        t.frame:SetSize(L.icon + 4, L.icon + 4)
        t.frame:SetPoint("LEFT", 0, 0)
        t.frame:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 2 })
        t.frame:SetBackdropColor(0, 0, 0, 0.6)
        t.icon = t.frame:CreateTexture(nil, "ARTWORK")
        t.icon:SetPoint("TOPLEFT", 2, -2)
        t.icon:SetPoint("BOTTOMRIGHT", -2, 2)
        t.label = t:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        t.label:SetPoint("TOPLEFT", t.frame, "TOPRIGHT", 6, -3)
        t.label:SetTextColor(0.6, 0.55, 0.5)
        t.name = t:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
        t.name:SetPoint("TOPLEFT", t.label, "BOTTOMLEFT", 0, -2)
        t.name:SetPoint("RIGHT", -2, 0)
        t.name:SetJustifyH("LEFT")
        t.name:SetWordWrap(false)
        t:RegisterForClicks("LeftButtonUp", "RightButtonUp")
        t:SetScript("OnClick", function(b, button)
            if button == "RightButton" then
                if opts.onRightClick then
                    opts.onRightClick(b)
                end
            elseif opts.onSelect then
                opts.onSelect(b.index)
            end
        end)
        if opts.onDoubleClick then
            t:SetScript("OnDoubleClick", function(b, button)
                if button ~= "RightButton" then
                    opts.onDoubleClick(b.index)
                end
            end)
        end
        t:SetScript("OnEnter", function(b)
            local it = self.items and self.items[b.index]
            if it then
                GameTooltip:SetOwner(b, "ANCHOR_RIGHT")
                pcall(GameTooltip.SetHyperlink, GameTooltip, it.itemString)
                if it.award and opts.doubleClickHint then
                    GameTooltip:AddLine(" ")
                    GameTooltip:AddLine(opts.doubleClickHint, 0.5, 0.8, 1, true)
                end
                GameTooltip:Show()
            end
        end)
        t:SetScript("OnLeave", function()
            GameTooltip:Hide()
        end)
        self.tabs[i] = t
        return t
    end

    function self:Update(items, current, count, classOf)
        self.items = items
        local n = 0
        for i, it in ipairs(items or {}) do
            n = i
            local t = tab(i)
            t.index = i
            t.icon:SetTexture(C_Item.GetItemIconByID(it.itemString or "") or 134400)
            local on = i == current
            t.sel:SetShown(on)
            t.frame:SetBackdropBorderColor(on and 0.78 or 0.3, on and 0.56 or 0.24, on and 0.36 or 0.19, 1)
            if it.award then
                local c = classColor(classOf and classOf(it.award.name))
                t.label:SetText(TEXT.given)
                t.name:SetText(Ambiguate(it.award.name, "short"))
                t.name:SetTextColor(c and c.r or 0.95, c and c.g or 0.9, c and c.b or 0.84)
            else
                t.label:SetText(TEXT.open)
                local x, y, late
                if count then
                    x, y, late = count(i)
                end
                x, y = x or 0, y or 0
                t.name:SetText(string.format(TEXT.answered, x, y))
                local c = (late and x < y) and LM.TAB_LATE_COLOR or COUNT_COLOR
                t.name:SetTextColor(c[1], c[2], c[3])
            end
            t:Show()
        end
        for i = n + 1, #self.tabs do
            self.tabs[i]:Hide()
        end
    end

    return self
end

-- A UIPanelButtonTemplate button for the loot windows (End session, Everyone's answers, Show): as wide as
-- its label plus the template's end caps (LM.PanelButtonWidth), skinned like every panel button
-- (UI:SkinButton: flat in Modern, the template's art in Classic, switched with the look).
function LM.PanelButton(parent, label, height, onClick)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetText(label)
    local fs = b:GetFontString()
    b:SetSize(LM.PanelButtonWidth(fs and fs:GetStringWidth() or 0), height)
    b:SetScript("OnClick", onClick)
    CRT.UI:SkinButton(b)
    return b
end
