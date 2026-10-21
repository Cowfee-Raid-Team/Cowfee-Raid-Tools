local ADDON, CRT = ...

-- The raid leader's Boss loot window: the boss rolls CRT handled (LootMaster/BossLoot.lua), one row each,
-- so the leader picks what goes into the loot session. Alex, 2026-10-20: "shows me the loot about to start
-- a session. This would make sure it's not starting on wrong items and gives the control to the raid
-- lead." It opens by itself on the first boss roll of a list. A pop-out made by UI.Window: drag it, resize
-- it from the corner, Reset puts it back; its place is kept in CRTDB lootmaster.bossLoot.
-- Each row: a checkbox (in the next session; pre-ticked by the loot filter), the item's icon, link and
-- detail (slot and item level, or why the filter left it out), and its state on the right: rolling
-- (honey), won (matcha), won by someone else or nobody (muted), or can't roll (red). Footer: the counts,
-- Clear, and Start session (only the ticked items you have won; it waits while a ticked one still rolls).

local LM = CRT.LootMaster
local UI = CRT.UI
local BL = LM.BossLoot

local L = { width = 620, height = 340, minWidth = 480, minHeight = 220, rowH = 40, footerH = 28, statusW = 230 }

local TEXT = {
    title = "Boss loot",
    help = "The boss items CRT rolled on for you. Tick the ones to give out and press Start session; nothing starts by itself. Start waits while a ticked item is still rolling. Items someone else won can't be ticked, and red means CRT couldn't roll on it. The list empties when you leave the instance, turn CRT Looting off, or 10 minutes after the kill.",
    counts = "%d of %d items ticked · %d still rolling",
    session = " · a loot session is running",
    clear = "Clear",
    start = "Start session",
    rolling = "Rolling… you rolled %s",
    won = "Won · you rolled %s",
    lost = "Won by %s",
    nowinner = "Nobody won it: everyone passed",
    cant = "Can't roll: %s. Tell the raid.",
    notFilter = "Not in your loot filter: %s",
    ilvl = "Item level %d",
}

-- The loot filter's reasons, as the detail line says them (LM.PassesFilter's why).
local FILTER_WHY = {
    source = "boss loot is off",
    quality = "below the lowest quality",
    ilvl = "below the lowest item level",
    kind = "its kind is off",
}

-- The muted state's Classic color; Modern takes the theme's note. Won and can't roll are the theme's good
-- and bad; rolling is the accent in Modern and the game's gold (the heading) in Classic.
local CLASSIC = { muted = "9d9d9d" }

local win, list, footer

local function settings()
    return CRT.db.lootmaster.bossLoot
end

local function hexOf(key, classic)
    if not UI:IsModern() then
        return classic
    end
    local c = CRT.MOCHA[key]
    return string.format("%02x%02x%02x", math.floor(c[1] * 255 + 0.5), math.floor(c[2] * 255 + 0.5), math.floor(c[3] * 255 + 0.5))
end

local function colored(hex, text)
    return "|cff" .. hex .. text .. "|r"
end

-- The state on the right of a row.
function LM.BossLootStatus(r)
    local roll = LM.AutoPass.ROLL_NAME[r.rollType or 0] or ""
    if r.status == "won" then
        return UI.GoodText(TEXT.won:format(roll))
    elseif r.status == "lost" then
        return colored(hexOf("note", CLASSIC.muted), TEXT.lost:format(Ambiguate(r.winner or "?", "short")))
    elseif r.status == "nowinner" then
        return colored(hexOf("note", CLASSIC.muted), TEXT.nowinner)
    elseif r.status == "cant" then
        return UI.BadText(TEXT.cant:format(r.reason or "?"))
    end
    return UI.ColorText(TEXT.rolling:format(roll), UI:IsModern() and "caramel" or "heading")
end

-- The detail under the link: slot and item level, or why the loot filter left it out.
function LM.BossLootDetail(r)
    if not r.pass then
        return TEXT.notFilter:format(FILTER_WHY[r.why] or tostring(r.why or "?"))
    end
    local ok, _, _, _, equipLoc = pcall(C_Item.GetItemInfoInstant, r.link)
    local slot = ok and type(equipLoc) == "string" and equipLoc ~= "" and _G[equipLoc] or nil
    local parts = {}
    if type(slot) == "string" then
        parts[#parts + 1] = slot
    end
    if r.ilvl then
        parts[#parts + 1] = TEXT.ilvl:format(r.ilvl)
    end
    return table.concat(parts, " · ")
end

local function initRow(row, r)
    if not row.check then
        row.check = CreateFrame("CheckButton", nil, row, "UICheckButtonTemplate")
        row.check:SetSize(24, 24)
        row.check:SetPoint("LEFT", 2, 0)
        UI:SkinCheckButton(row.check)
        row.check:SetScript("OnClick", function(self)
            local d = row.data
            if d then
                BL:SetTicked(d.rollID, self:GetChecked())
            end
        end)
        row.icon = row:CreateTexture(nil, "ARTWORK")
        row.icon:SetSize(32, 32)
        row.icon:SetPoint("LEFT", 32, 0)
        row.status = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        row.status:SetPoint("RIGHT", -6, 0)
        row.status:SetWidth(L.statusW)
        row.status:SetJustifyH("RIGHT")
        row.name = row:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
        row.name:SetPoint("TOPLEFT", row.icon, "TOPRIGHT", 8, -1)
        row.name:SetPoint("RIGHT", row.status, "LEFT", -8, 0)
        row.name:SetJustifyH("LEFT")
        row.name:SetWordWrap(false)
        row.detail = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        row.detail:SetPoint("BOTTOMLEFT", row.icon, "BOTTOMRIGHT", 8, 1)
        row.detail:SetPoint("RIGHT", row.status, "LEFT", -8, 0)
        row.detail:SetJustifyH("LEFT")
        row.detail:SetWordWrap(false)
        UI.Tint(row.detail, "SetTextColor", "note") -- muted, and follows the theme
        local hl = row:CreateTexture(nil, "HIGHLIGHT")
        hl:SetAllPoints()
        hl:SetColorTexture(1, 1, 1, 0.06)
        row:SetScript("OnEnter", function(self)
            if self.data and self.data.link then
                GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
                GameTooltip:SetHyperlink(self.data.link)
                GameTooltip:Show()
            end
        end)
        row:SetScript("OnLeave", function()
            GameTooltip:Hide()
        end)
    end
    row.data = r
    row.check:SetChecked(r.ticked and true or false)
    row.check:SetEnabled(BL.Tickable(r))
    local okI, _, _, _, _, icon = pcall(C_Item.GetItemInfoInstant, r.link)
    row.icon:SetTexture(okI and icon or 134400)
    row.icon:SetDesaturated(not BL.Tickable(r))
    row.name:SetText(r.link)
    row.detail:SetText(LM.BossLootDetail(r))
    row.status:SetText(LM.BossLootStatus(r))
end

local function refresh()
    if not win then
        return
    end
    local badge = BL.boss and (BL.difficulty and (BL.boss .. " · " .. BL.difficulty) or BL.boss) or nil
    win.strip:SetBadge(badge, nil, badge and UI.TITLE_STRIP.neutral or nil)
    list:SetDataProvider(CreateDataProvider(BL:Rows()), ScrollBoxConstants and ScrollBoxConstants.RetainScrollPosition)
    local ticked, total, rolling = BL:Counts()
    local ok, why = BL:CanStart()
    footer.counts:SetText(TEXT.counts:format(ticked, total, rolling) .. (why == "session" and TEXT.session or ""))
    footer.start:SetEnabled(ok and true or false)
    footer.clear:SetEnabled(total > 0)
end

local function build()
    if win then
        return
    end
    win = UI.Window("CowfeeRaidToolsBossLoot", {
        kind = "popout", title = TEXT.title, width = L.width, height = L.height,
        minWidth = L.minWidth, minHeight = L.minHeight, saved = settings,
    })
    win.refresh = refresh -- a theme change repaints the states (UI:RepaintTheme)
    local c = win.content
    footer = CreateFrame("Frame", nil, c)
    footer:SetPoint("BOTTOMLEFT", 0, 0)
    footer:SetPoint("BOTTOMRIGHT", 0, 0)
    footer:SetHeight(L.footerH)
    footer.start = UI.PanelButton(footer, TEXT.start, 22, function()
        BL:Start()
    end)
    footer.start:SetPoint("RIGHT", 0, 0)
    footer.clear = UI.PanelButton(footer, TEXT.clear, 22, function()
        BL:Clear()
    end)
    footer.clear:SetPoint("RIGHT", footer.start, "LEFT", -8, 0)
    footer.counts = footer:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    footer.counts:SetPoint("LEFT", 4, 0)
    footer.help = UI.Help(footer, TEXT.title, TEXT.help)
    footer.help:SetPoint("LEFT", footer.counts, "RIGHT", 6, 0)
    local box = CreateFrame("Frame", nil, c, "WowScrollBoxList")
    box:SetPoint("TOPLEFT", 0, 0)
    box:SetPoint("BOTTOMRIGHT", -20, L.footerH + 6)
    local bar = CreateFrame("EventFrame", nil, c, "MinimalScrollBar")
    UI:SkinScrollBar(bar)
    bar:SetPoint("TOPLEFT", box, "TOPRIGHT", 6, 0)
    bar:SetPoint("BOTTOMLEFT", box, "BOTTOMRIGHT", 6, 0)
    local v = CreateScrollBoxListLinearView()
    v:SetElementExtent(L.rowH)
    v:SetElementInitializer("Button", initRow)
    ScrollUtil.InitScrollBoxListWithScrollBar(box, bar, v)
    list = box
end

LM:OnChange(function(what, sub)
    if what == "bossloot" then
        if sub == "open" then
            build()
            refresh()
            win:Show()
        elseif win then
            refresh()
        end
    elseif (what == "started" or what == "ended") and win then
        refresh() -- Start session waits for a running session
    end
end)

-- /crt loot boss: the window again.
function LM:ShowBossLoot()
    build()
    refresh()
    win:Show()
end
