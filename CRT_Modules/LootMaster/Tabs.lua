local ADDON, CRT = ...

-- The column of item tabs both loot windows share (the looter's and the raider window): each tab is the
-- item's icon with, beside it, who it was given to (in their class colour) or "Open" with "3/5 answered":
-- the answers in of the raiders with CRT, orange when the time ran out with answers missing. Click picks
-- the item; the looter window also uses right-click (its menu) and double-click (trade the item to its
-- winner).
--   local tabs = LM.ItemTabs(parent, opts)
--   opts: onSelect(index), onRightClick(tab), onDoubleClick(index), doubleClickHint (tooltip line),
--         window (the frame a tooltip on a side of the window sits by; the parent if not given)
--   tabs:Update(items, current, count(index) -> answered, expected, late (Session:AnswerCount),
--               classOf(name) -> class file)
-- Also here, for both windows: LM.ListArea (the clipped headings and rows) and LM.GearIcon / LM.SetGear.

local LM = CRT.LootMaster

local L = { width = 146, height = 40, gap = 6, icon = 36 }
LM.TAB_COLUMN = L.width

local TEXT = { given = "Given to", open = "Open", answered = "%d/%d answered" }
local COUNT_COLOR = { 0.85, 0.85, 0.85 }
LM.TAB_LATE_COLOR = { 1, 0.54, 0.25 } -- the count when someone ran out of time

local function classColor(file)
    return file and (C_ClassColor and C_ClassColor.GetClassColor(file) or RAID_CLASS_COLORS[file]) or nil
end

-- The list area of a loot window (both windows): the column headings and the rows in one frame that clips
-- its children (Frame:SetClipsChildren). The columns keep their x; a window made narrower than them cuts
-- headings and cells off at the same edge, so they stay lined up. It ends rightGap from the parent's right
-- edge, so the scroll bar beside it is never cut off.
--   local area = LM.ListArea(parent, x, y, rightGap)
LM.LIST_SCROLL_GAP = 20 -- room right of the list for the scroll bar
function LM.ListArea(parent, x, y, rightGap)
    local area = CreateFrame("Frame", nil, parent)
    area:SetPoint("TOPLEFT", x, y)
    area:SetPoint("BOTTOMRIGHT", -(rightGap or LM.LIST_SCROLL_GAP), 0)
    area:SetClipsChildren(true)
    return area
end

-- The gear icons of a loot window row (both windows). The texture sits under a small button that shows the
-- item's tooltip and hands its clicks to the row, so picking a row and its menu work over the icon too.
--   local t = LM.GearIcon(row, x)       -- the icon; t.hit is the button over it
--   LM.SetGear(t, g, ownItemString)     -- g = { id, ilvl, itemString } or nil; ownItemString only on your own row
-- The tooltip is the gear engine's (CRT.Gear.ShowTooltip): the exact item once the raider's G part brought
-- its item string, else the item by its ID; both with an "Equipped at item level" line. On your own row your
-- real equipped piece is used.

function LM.GearIcon(row, x)
    local t = row:CreateTexture(nil, "OVERLAY")
    t:SetSize(16, 16)
    t:SetPoint("LEFT", x, 0)
    local b = CreateFrame("Button", nil, row)
    b:SetSize(16, 16)
    b:SetPoint("LEFT", x, 0)
    b:RegisterForClicks("LeftButtonUp", "RightButtonUp")
    b:SetScript("OnClick", function(_, button)
        local click = row:GetScript("OnClick")
        if click then
            click(row, button)
        end
    end)
    b:SetScript("OnEnter", function(self)
        local g = self.gear
        if not g or not g.id then
            return
        end
        local piece = g
        if self.own and not g.itemString then
            for _, m in ipairs(LM:MyGear(self.own)) do
                if m.id == g.id and (piece == g or math.floor((m.ilvl or 0) + 0.5) == g.ilvl) then
                    piece = m
                end
            end
        end
        CRT.Gear.ShowTooltip(self, piece, "ANCHOR_RIGHT", "lootmaster")
    end)
    b:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    t.hit = b
    return t
end

function LM.SetGear(t, g, own)
    local icon = g and g.id and C_Item.GetItemIconByID(g.id)
    t:SetTexture(icon)
    t:SetShown(icon ~= nil)
    t.hit.gear = icon and g or false
    t.hit.own = own or false
    t.hit:SetShown(icon ~= nil)
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
        local hl = t:CreateTexture(nil, "HIGHLIGHT")
        hl:SetAllPoints()
        hl:SetColorTexture(1, 1, 1, 0.05)
        -- a button, so the icon alone shows the tooltip and still hands its clicks to the tab
        t.frame = CreateFrame("Button", nil, t, "BackdropTemplate")
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
        -- the icon passes its clicks on, so a click anywhere on the tab acts the same
        t.frame:RegisterForClicks("LeftButtonUp", "RightButtonUp")
        t.frame:SetScript("OnClick", function(_, button)
            t:GetScript("OnClick")(t, button)
        end)
        if opts.onDoubleClick then
            t.frame:SetScript("OnDoubleClick", function(_, button)
                t:GetScript("OnDoubleClick")(t, button)
            end)
        end
        -- the tooltip opens where the Settings tab's Item tabs says: by default like every Loot Master tooltip
        -- (Loot Master's Tooltip position, on the spot picked for it or General Settings'); a side of the
        -- window or the game's spot whatever the Tooltip positions say (the flags in UI/Tooltip.lua)
        t.frame:SetScript("OnEnter", function(icon)
            local it = self.items and self.items[t.index]
            if it then
                local win = opts.window or parent
                local a = LM:TooltipAnchor()
                if a.game then
                    CRT.UI.TooltipOwner(GameTooltip, icon, "ANCHOR_LEFT", nil, nil, CRT.UI.TOOLTIP_GAME)
                elseif not a.point then
                    CRT.UI.TooltipOwner(GameTooltip, icon, "ANCHOR_LEFT", nil, nil, "lootmaster")
                else
                    CRT.UI.TooltipOwner(GameTooltip, icon, "ANCHOR_NONE", nil, nil, CRT.UI.TOOLTIP_KEEP)
                    local dy = a.dy
                    if a.level then
                        local top, winTop = icon:GetTop(), win:GetTop()
                        dy = (top and winTop) and (top - winTop) or 0
                    end
                    GameTooltip:SetPoint(a.point, win, a.rel, a.dx, dy)
                end
                pcall(GameTooltip.SetHyperlink, GameTooltip, it.itemString)
                if it.award and opts.doubleClickHint then
                    GameTooltip:AddLine(" ")
                    GameTooltip:AddLine(opts.doubleClickHint, 0.5, 0.8, 1, true)
                end
                GameTooltip:Show()
            end
        end)
        t.frame:SetScript("OnLeave", function()
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
            local accent = CRT.PALETTE.accent -- the picked item, in the theme's accent
            t.sel:SetColorTexture(accent[1], accent[2], accent[3], 0.12)
            t.sel:SetShown(on)
            local border = on and accent or CRT.PALETTE.border -- the picked item's in the accent
            t.frame:SetBackdropBorderColor(border[1], border[2], border[3], 1)
            if it.award then
                local c = classColor(classOf and classOf(it.award.name))
                t.label:SetText(TEXT.given)
                t.name:SetText(Ambiguate(it.award.name, "short"))
                local text = CRT.PALETTE.text -- no class known
                t.name:SetTextColor(c and c.r or text[1], c and c.g or text[2], c and c.b or text[3])
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
