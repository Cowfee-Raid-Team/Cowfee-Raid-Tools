local ADDON, CRT = ...

-- The question the raid leader gets on entering a raid instance (LootMaster/Looting.lua decides when):
-- "Use CRT Looting in this instance?" [Yes] [No]. A dialog made by UI.Window, so it follows the look
-- (Classic or Modern) like every CRT window; its place is kept in CRTDB lootmaster.lootingPrompt. Closing
-- it without an answer leaves CRT Looting off and sends nothing.

local LM = CRT.LootMaster
local UI = CRT.UI

local L = { width = 360, height = 112, buttonH = 24, buttonMinW = 80, gap = 12, bottom = 6, top = -14 }

local TEXT = {
    title = "CRT Looting",
    question = "Use CRT Looting in this instance?",
    help = "Yes turns CRT Looting on for everyone in the raid with CRT: for 10 minutes after each boss kill their CRT passes the loot rolls (trash too) and yours rolls Need, so you get the items to give out. Only items in your loot filter: everything else is a normal roll for everyone. It stays on through a wipe, a /reload and a log out tonight, until you turn it off on Loot Master > Tonight. It also turns off if you enter another instance, stay out of this one for over 10 minutes, or stop being the raid leader. Raiders can't change it.",
    yes = "Yes",
    no = "No",
}

local win

local function build()
    win = UI.Window("CRTLootingPrompt", {
        kind = "dialog", title = TEXT.title, width = L.width, height = L.height,
        saved = function()
            return CRT.db and CRT.db.lootmaster and CRT.db.lootmaster.lootingPrompt
        end,
    })
    local c = win.content
    local q = c:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    q:SetPoint("TOP", -10, L.top)
    q:SetText(TEXT.question)
    UI.HelpRight(q, TEXT.title, TEXT.help)
    -- in a boss encounter's chat lockdown the answer can't be sent: red error text, and the question stays
    local function answer(on, why)
        if select(2, LM:ChooseLooting(on, why)) ~= "locked" then
            win:Hide()
        end
    end
    local yes = UI.PanelButton(c, TEXT.yes, L.buttonH, function()
        answer(true)
    end)
    local no = UI.PanelButton(c, TEXT.no, L.buttonH, function()
        answer(false, "no")
    end)
    local w = math.max(L.buttonMinW, yes:GetWidth(), no:GetWidth()) -- both as wide as the wider label needs
    yes:SetWidth(w)
    no:SetWidth(w)
    yes:SetPoint("BOTTOMRIGHT", c, "BOTTOM", -L.gap / 2, L.bottom)
    no:SetPoint("BOTTOMLEFT", c, "BOTTOM", L.gap / 2, L.bottom)
end

function LM.AskLooting()
    if not win then
        build()
    end
    win:Show()
    win:Raise()
end

function LM.HideLootingPrompt()
    if win then
        win:Hide()
    end
end
