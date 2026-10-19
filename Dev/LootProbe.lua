local ADDON, CRT = ...

-- DEVELOPER ONLY. In-game probes for Loot Master: they answer, in the game, the questions the design rests
-- on (decisions/2026-10-18 Cowfee Raid Tools Loot Master.md, "Proven in game before building on it"). This
-- file never ships: its .toc line is inside the do-not-package block. Everything it sees is printed and
-- also kept in CRTLootDB.probe (the last MAX_LOG lines), so the results can be read after a /reload.
--   /crt dev loot probe on | off      watch loot rolls, roll results in chat, trades and blocked actions
--   /crt dev loot probe method        the group's loot method, as the game reports it
--   /crt dev loot probe pass          arm: the NEXT loot roll that starts is passed from the event, once
--   /crt dev loot probe roll          /roll 1-100 and show how CRT reads the result from chat
--   /crt dev loot probe bags          list bag items that are still tradeable, with the timer line
--   /crt dev loot probe trade <itemID>  open a trade with your target, then place that item in it
--   /crt dev loot probe icons         show the roll-type icon candidates (Need, Greed, Disenchant, Pass)
--   /crt dev loot probe log           print the saved log; "clear" empties it
-- Nothing here passes, rolls or trades unless you type the command for it; "pass" passes one roll only.

local Probe = { watching = false, armed = false, tradeItem = nil }
CRT.LootProbe = Probe

local MAX_LOG = 300
local CLOSE_WAIT = 3 -- seconds a passed roll's frame gets to close itself

local function log(fmt, ...)
    local line = date("%H:%M:%S ") .. string.format(fmt, ...)
    print("|cff80c0ff[loot probe]|r " .. line)
    CRTLootDB.probe = CRTLootDB.probe or {}
    local l = CRTLootDB.probe
    l[#l + 1] = line
    while #l > MAX_LOG do
        table.remove(l, 1)
    end
end

local function str(v)
    if v == nil then
        return "nil"
    end
    return tostring(v)
end

-- Loot rolls ---------------------------------------------------------------------------------------

local function describeRoll(rollID)
    local ok, texture, name, count, quality, bop, canNeed, canGreed, canDE, rNeed, rGreed, rDE, deSkill, canTmog =
        pcall(GetLootRollItemInfo, rollID)
    if not ok then
        return "GetLootRollItemInfo failed: " .. str(texture)
    end
    local link = GetLootRollItemLink and GetLootRollItemLink(rollID)
    return string.format("%s q%s bop=%s need=%s(%s) greed=%s(%s) de=%s(%s) tmog=%s", str(link or name), str(quality),
        str(bop), str(canNeed), str(rNeed), str(canGreed), str(rGreed), str(canDE), str(rDE), str(canTmog))
end

local function where()
    local name, instanceType, difficultyID = GetInstanceInfo()
    return string.format("%s (%s, difficulty %s), raid=%s", str(name), str(instanceType), str(difficultyID), str(IsInRaid()))
end

local function passNow(rollID)
    Probe.armed = false
    local ok, err = pcall(RollOnLoot, rollID, 0)
    log("PASS sent from the event for roll %s: ok=%s %s", str(rollID), str(ok), ok and "" or str(err))
    local passedAt = GetTime()
    Probe.waitingClose = { rollID = rollID, at = passedAt }
    C_Timer.After(CLOSE_WAIT, function()
        local w = Probe.waitingClose
        if w and w.rollID == rollID then
            Probe.waitingClose = nil
            log("NO CANCEL_LOOT_ROLL for roll %s within %d s; Blizzard's frame shown: %s", str(rollID), CLOSE_WAIT,
                str(GroupLootContainer and GroupLootContainer:IsShown()))
        end
    end)
end

-- Trades -------------------------------------------------------------------------------------------

local function findInBags(itemID)
    for bag = 0, NUM_BAG_SLOTS or 4 do
        for slot = 1, C_Container.GetContainerNumSlots(bag) or 0 do
            local info = C_Container.GetContainerItemInfo(bag, slot)
            if info and info.itemID == itemID then
                return bag, slot, info.hyperlink
            end
        end
    end
    return nil
end

-- The tooltip line that says how long an item can still be traded, or nil.
local function tradeLine(bag, slot)
    local ok, data = pcall(C_TooltipInfo.GetBagItem, bag, slot)
    if not ok or type(data) ~= "table" or type(data.lines) ~= "table" then
        return nil
    end
    local pattern = BIND_TRADE_TIME_REMAINING and BIND_TRADE_TIME_REMAINING:gsub("%%s", ".+"):gsub("[%(%)]", "%%%0") or nil
    for _, line in ipairs(data.lines) do
        local text = line.leftText
        if type(text) == "string" and ((pattern and text:find(pattern)) or text:lower():find("trade")) then
            return text
        end
    end
    return nil
end

local function placeItem()
    local id = Probe.tradeItem
    if not id then
        return
    end
    local bag, slot, link = findInBags(id)
    if not bag then
        log("TRADE: item %s is not in your bags", str(id))
        return
    end
    ClearCursor()
    local ok1, e1 = pcall(C_Container.PickupContainerItem, bag, slot)
    local ok2, e2 = pcall(ClickTradeButton, 1)
    C_Timer.After(0.3, function()
        log("TRADE: placed %s from bag %d slot %d: pickup ok=%s %s, click ok=%s %s; trade slot 1 now %s", str(link), bag, slot,
            str(ok1), ok1 and "" or str(e1), str(ok2), ok2 and "" or str(e2), str(GetTradePlayerItemLink(1)))
    end)
end

-- Roll results in chat -----------------------------------------------------------------------------

-- RANDOM_ROLL_RESULT is the game's own "%s rolls %d (%d-%d)", so this follows the client's language.
local rollPattern
local function readRoll(text)
    if not rollPattern then
        local f = RANDOM_ROLL_RESULT or "%s rolls %d (%d-%d)"
        rollPattern = "^" .. f:gsub("[%(%)%.%-%+%*%?%[%]%^%$]", "%%%0"):gsub("%%s", "(.+)"):gsub("%%d", "(%%d+)") .. "$"
    end
    local who, roll, low, high = text:match(rollPattern)
    return who, tonumber(roll), tonumber(low), tonumber(high)
end
Probe.ReadRoll = readRoll

-- Events -------------------------------------------------------------------------------------------

local EVENTS = {
    "START_LOOT_ROLL", "CANCEL_LOOT_ROLL", "CANCEL_ALL_LOOT_ROLLS", "CONFIRM_LOOT_ROLL", "LOOT_ROLLS_COMPLETE",
    "LOOT_ITEM_ROLL_WON", "MAIN_SPEC_NEED_ROLL", "LOOT_HISTORY_UPDATE_DROP", "ENCOUNTER_LOOT_RECEIVED",
    "BONUS_ROLL_STARTED", "BONUS_ROLL_RESULT", -- does bonus loot also come as ENCOUNTER_LOOT_RECEIVED?
    "CHAT_MSG_SYSTEM", "TRADE_SHOW", "TRADE_CLOSED", "TRADE_ACCEPT_UPDATE", "TRADE_PLAYER_ITEM_CHANGED",
    "TRADE_REQUEST_CANCEL", "UI_INFO_MESSAGE", "UI_ERROR_MESSAGE", "END_BOUND_TRADEABLE",
    "ADDON_ACTION_BLOCKED", "ADDON_ACTION_FORBIDDEN",
}

local frame = CreateFrame("Frame")
frame:SetScript("OnEvent", function(_, event, ...)
    local a1, a2, a3 = ...
    if event == "START_LOOT_ROLL" then
        log("START_LOOT_ROLL roll=%s time=%s handle=%s in %s: %s", str(a1), str(a2), str(a3), where(), describeRoll(a1))
        if Probe.armed then
            passNow(a1)
        end
    elseif event == "CANCEL_LOOT_ROLL" then
        local w = Probe.waitingClose
        if w and w.rollID == a1 then
            Probe.waitingClose = nil
            log("CANCEL_LOOT_ROLL roll=%s, %.2f s after the pass: the frame closed itself", str(a1), GetTime() - w.at)
        else
            log("CANCEL_LOOT_ROLL roll=%s", str(a1))
        end
    elseif event == "CHAT_MSG_SYSTEM" then
        local who, roll, low, high = readRoll(a1 or "")
        if who then
            log("ROLL read from chat: %s rolled %d (%d-%d)", who, roll, low, high)
        end
    elseif event == "TRADE_SHOW" then
        log("TRADE_SHOW with %s", str(GetUnitName("NPC", true)))
        placeItem()
    elseif event == "TRADE_CLOSED" then
        log("TRADE_CLOSED; slot 1 was %s", str(GetTradePlayerItemLink(1)))
    elseif event == "UI_INFO_MESSAGE" or event == "UI_ERROR_MESSAGE" then
        log("%s %s %s", event, str(a1), str(a2))
    elseif event == "ADDON_ACTION_BLOCKED" or event == "ADDON_ACTION_FORBIDDEN" then
        log("%s %s %s", event, str(a1), str(a2))
    else
        log("%s %s %s %s", event, str(a1), str(a2), str(a3))
    end
end)

function Probe:Watch(on)
    self.watching = on
    for _, e in ipairs(EVENTS) do
        if on then
            pcall(frame.RegisterEvent, frame, e)
        else
            frame:UnregisterEvent(e)
        end
    end
    if not on then
        self.armed = false
    end
    log("watching %s", on and "ON" or "OFF")
end

-- The roll-type icon candidates side by side, to see which exist in this client. Files are from the
-- Classic loot frames (Dice, Coin, Pass) and Classic LootHistory.lua (DE); atlases from retail's
-- GroupLootFrame.xml and LootHistory.lua (Gethe/wow-ui-source, read 2026-10-18). A missing file shows as
-- green, a missing atlas as nothing; each is also printed with what the game reports.
local ICONS = {
    { file = "Interface\\Buttons\\UI-GroupLoot-Dice-Up", label = "Dice (file)" },
    { file = "Interface\\Buttons\\UI-GroupLoot-Coin-Up", label = "Coin (file)" },
    { file = "Interface\\Buttons\\UI-GroupLoot-DE-Up", label = "DE (file)" },
    { file = "Interface\\Buttons\\UI-GroupLoot-Pass-Up", label = "Pass (file)" },
    { atlas = "lootroll-toast-icon-need-up", label = "need" },
    { atlas = "lootroll-toast-icon-greed-up", label = "greed" },
    { atlas = "lootroll-toast-icon-transmog-up", label = "transmog" },
    { atlas = "lootroll-toast-icon-pass-up", label = "pass" },
    { atlas = "lootroll-icon-need", label = "icon-need" },
    { atlas = "lootroll-icon-greed", label = "icon-greed" },
    { atlas = "lootroll-icon-transmog", label = "icon-tmog" },
    { atlas = "lootroll-icon-pass", label = "icon-pass" },
}

function Probe:ShowIcons()
    local f = self.iconFrame
    if not f then
        f = CreateFrame("Frame", nil, UIParent, "BackdropTemplate")
        f:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
        f:SetBackdropColor(0, 0, 0, 0.9)
        f:SetBackdropBorderColor(0.5, 0.5, 0.5, 1)
        f:SetSize(16 + 6 * 76, 2 * 70 + 30)
        f:SetPoint("CENTER")
        f:SetFrameStrata("DIALOG")
        f:EnableMouse(true)
        f:SetScript("OnMouseDown", f.Hide)
        local title = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
        title:SetPoint("TOP", 0, -6)
        title:SetText("Roll-type icon candidates (click to close)")
        for i, ic in ipairs(ICONS) do
            local col, row = (i - 1) % 6, math.floor((i - 1) / 6)
            local t = f:CreateTexture(nil, "ARTWORK")
            t:SetSize(36, 36)
            t:SetPoint("TOPLEFT", 8 + col * 76 + 20, -28 - row * 70)
            local how, result
            if ic.atlas then
                local okInfo, info = pcall(function()
                    return C_Texture.GetAtlasInfo(ic.atlas)
                end)
                how, result = "GetAtlasInfo", okInfo and (info ~= nil) or ("error " .. tostring(info))
                t:SetAtlas(ic.atlas)
            else
                how, result = "SetTexture returned", t:SetTexture(ic.file)
            end
            local fs = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
            fs:SetPoint("TOP", t, "BOTTOM", 0, -2)
            fs:SetText(ic.label)
            log("icon %s: %s %s", ic.atlas or ic.file, how, str(result))
        end
        self.iconFrame = f
    end
    f:Show()
end

function Probe:Command(rest)
    local verb, arg = (rest or ""):match("^(%S*)%s*(.-)$")
    verb = (verb or ""):lower()
    if verb == "on" or verb == "off" then
        self:Watch(verb == "on")
    elseif verb == "method" then
        local ok, method, mlParty, mlRaid = pcall(C_PartyInfo.GetLootMethod)
        local names = {}
        for k, v in pairs(Enum.LootMethod or {}) do
            names[v] = k
        end
        log("loot method: %s (%s), master looter party=%s raid=%s, in %s", str(method), str(names[method]), str(mlParty), str(mlRaid), where())
        if not ok then
            log("GetLootMethod failed: %s", str(method))
        end
    elseif verb == "pass" then
        if not self.watching then
            self:Watch(true)
        end
        self.armed = not self.armed
        log(self.armed and "ARMED: the next loot roll that starts will be PASSED for you, once" or "disarmed")
    elseif verb == "roll" then
        if not self.watching then
            self:Watch(true)
        end
        RandomRoll(1, 100)
    elseif verb == "bags" then
        local n = 0
        for bag = 0, NUM_BAG_SLOTS or 4 do
            for slot = 1, C_Container.GetContainerNumSlots(bag) or 0 do
                local line = tradeLine(bag, slot)
                if line then
                    n = n + 1
                    local info = C_Container.GetContainerItemInfo(bag, slot)
                    log("tradeable: %s (bag %d slot %d, id %s): %s", str(info and info.hyperlink), bag, slot, str(info and info.itemID), line)
                end
            end
        end
        log("%d tradeable items in your bags", n)
    elseif verb == "trade" then
        local id = tonumber(arg)
        if not id then
            log("Use /crt dev loot probe trade <itemID>, with a player targeted")
            return
        end
        if not self.watching then
            self:Watch(true)
        end
        self.tradeItem = id
        local ok, err = pcall(InitiateTrade, "target")
        log("InitiateTrade(target %s): ok=%s %s; when the window opens, item %d is placed", str(GetUnitName("target", true)), str(ok), ok and "" or str(err), id)
    elseif verb == "icons" then
        self:ShowIcons()
    elseif verb == "log" then
        for _, line in ipairs(CRTLootDB.probe or {}) do
            print(line)
        end
    elseif verb == "clear" then
        CRTLootDB.probe = {}
        print("Loot probe log cleared.")
    else
        print("Loot probes: /crt dev loot probe on | off | method | pass | roll | bags | trade <itemID> | log | clear")
    end
end
