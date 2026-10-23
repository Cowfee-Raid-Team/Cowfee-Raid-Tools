local ADDON, CRT = ...

-- The raider's popup for an ask (Requests/Data.lua): "<asker> asks: need one?", the item with its tooltip,
-- and Need one / No thanks. A small UI.Window dialog on the popups layer, made the first time an ask comes.
-- It shows the oldest ask waiting for your answer (one per asker), closes on your answer or when the asker
-- closes the request, and shows the next one if another asker is waiting. Closing it with its X or Escape
-- drops the ask and sends nothing, so the asker sees No answer. Its place is kept until a /reload only.

local R = CRT.Requests
local UI = CRT.UI

local TEXT = {
    title = "Request",
    asks = "%s asks: need one?",
    need = "Need one",
    no = "No thanks",
}

local L = { w = 300, h = 132, icon = 32, gap = 8, button = 24, askTop = -2, itemTop = -24 }

local frame
local place = {} -- the window's place, in memory only
local hiding = false -- the popup hides itself: not a dismissal

local function build()
    frame = UI.Window("CowfeeRaidToolsRequestPopup", {
        kind = "dialog", title = TEXT.title, width = L.w, height = L.h,
        saved = function()
            return place
        end,
    })
    local c = frame.content
    local ask = c:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    ask:SetPoint("TOPLEFT", 0, L.askTop)
    ask:SetWidth(L.w - 2 * L.gap - 8)
    ask:SetJustifyH("LEFT")
    ask:SetWordWrap(false)
    local item = CreateFrame("Button", nil, c)
    item:SetSize(L.icon, L.icon)
    item:SetPoint("TOPLEFT", 0, L.itemTop)
    local icon = item:CreateTexture(nil, "ARTWORK")
    icon:SetAllPoints()
    item:SetScript("OnEnter", function(self)
        local inc = frame.inc
        if inc and GameTooltip then
            UI.TooltipOwner(GameTooltip, self, "ANCHOR_RIGHT")
            pcall(GameTooltip.SetHyperlink, GameTooltip, R.LinkOf(inc.itemString) or inc.itemString)
            GameTooltip:Show()
        end
    end)
    item:SetScript("OnLeave", function()
        if GameTooltip then
            GameTooltip:Hide()
        end
    end)
    local link = c:CreateFontString(nil, "OVERLAY", "CRTFontHighlight")
    link:SetPoint("LEFT", item, "RIGHT", L.gap, 0)
    link:SetWidth(L.w - L.icon - 3 * L.gap - 8)
    link:SetJustifyH("LEFT")
    link:SetWordWrap(false)
    local function answer(need)
        local inc = frame.inc
        if inc then
            R:Answer(inc.from, need)
        end
    end
    local needB = UI.PanelButton(c, TEXT.need, L.button, function()
        answer(true)
    end)
    needB:SetPoint("BOTTOMLEFT", 0, 0)
    local noB = UI.PanelButton(c, TEXT.no, L.button, function()
        answer(false)
    end)
    noB:SetPoint("LEFT", needB, "RIGHT", L.gap, 0)
    frame:HookScript("OnHide", function()
        local inc = frame.inc
        frame.inc = nil
        if inc and not hiding then
            R:Dismiss(inc.from) -- the X or Escape: no answer
        end
    end)
    frame.ask, frame.item, frame.icon, frame.link = ask, item, icon, link
end

local function refresh()
    local inc = R:Waiting()
    if not inc then
        if frame and frame:IsShown() then
            hiding = true
            frame:Hide()
            hiding = false
        end
        return
    end
    if not frame then
        build()
    end
    frame.inc = inc
    frame.ask:SetText(TEXT.asks:format(Ambiguate(inc.from, "short")))
    frame.link:SetText(R.LinkOf(inc.itemString) or inc.itemString)
    local ok, _, _, _, _, tex = pcall(C_Item.GetItemInfoInstant, inc.itemString)
    frame.icon:SetTexture(ok and tex or nil)
    if not frame:IsShown() then
        frame:Show()
    end
end

R:OnChange(function(what)
    if what ~= "open" and what ~= "answers" then
        refresh()
    end
end)
