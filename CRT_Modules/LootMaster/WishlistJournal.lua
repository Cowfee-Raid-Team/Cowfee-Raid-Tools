local ADDON, CRT = ...

-- Wishlists and the game's own windows (the list itself: LootMaster/Wishlist.lua):
--   The Encounter Journal's loot rows get a right-click menu: Add to wishlist > Big upgrade / Small upgrade / Off
--     spec (your rank ticked), and Remove from wishlist. The Journal is load-on-demand (Blizzard_EncounterJournal),
--     so this waits for its ADDON_LOADED. Its loot rows are EncounterItemTemplate buttons (EncounterJournalItemMixin:
--     itemID, link, encounterID), made by the ScrollBox EncounterJournal.encounter.info.LootContainer.ScrollBox. The
--     template registers LeftButtonUp and RightButtonUp; its OnClick does HandleModifiedItemClick (Shift-click links,
--     Ctrl-click previews) or EncounterJournal_Loot_OnClick, which opens the item's boss when another boss (or the
--     instance's whole loot) is shown. Checked in Gethe/wow-ui-source live, Mainline/Blizzard_EncounterJournal.lua and
--     .xml, 2026-11-11. Nothing of the game's is replaced: each row gets an OnMouseUp hook once (HookScript), added
--     from the ScrollBox's initialized-frame callback (ScrollUtil.AddInitializedFrameCallback, Blizzard_SharedXML
--     Scroll/ScrollUtil.lua), else from a hooksecurefunc on EncounterJournalItemMixin.Init. The menu opens a frame
--     later, after the game's own click, so a right-click on the instance's whole loot still opens that item's boss
--     as it always did, and the menu then opens over it.
--   Item tooltips get "Wishlist: Big upgrade" in the rank's colour (TooltipDataProcessor.AddTooltipPostCall for
--     Enum.TooltipDataType.Item; the data's id, else its hyperlink). A secret item ID gets no line.
--   The Journal's loot for one boss, for the My wishlist window (W.BossLoot). The Journal lists loot for its
--     selected instance and boss only (EJ_SelectInstance, EJ_SelectEncounter, EJ_SetLootFilter, EJ_GetNumLoot,
--     C_EncounterJournal.GetLootInfoByIndex, C_EncounterJournal.GetSlotFilter / ResetSlotFilter / SetSlotFilter:
--     warcraft.wiki.gg and the Journal's own code). So each read selects the boss, reads its item IDs at once, and
--     puts back in the same frame the Journal's tier, difficulty, class and slot filters and, once its window has
--     loaded, the instance and boss it shows (EncounterJournal.instanceID and .encounterID); the Journal redraws only
--     on its own events, which come later and see its own choice again. The difficulty is never changed on purpose
--     (an item's ID is the same on every difficulty). The newest Journal tier's raids (EJ_GetNumTiers, EJ_SelectTier)
--     are searched for the season's bosses; a boss not found is searched again after SEARCH_AGAIN seconds. What is read is kept for the login; names and icons
--     that weren't loaded yet arrive through the item's own load callback (Item:ContinueOnItemLoad).

local LM = CRT.LootMaster
local UI = CRT.UI
local W = LM.Wishlist

W.TEXT.add = "Add to wishlist"
W.TEXT.remove = "Remove from wishlist"
W.TEXT.menuTitle = "Wishlist"

local function secret(v)
    return issecretvalue ~= nil and issecretvalue(v) or false
end

-- The tooltip line ---------------------------------------------------------------------------------------

-- The line for an item tooltip's data: text, r, g, b; nil when the item isn't on your list or can't be read.
function W.TooltipLine(data)
    if type(data) ~= "table" or secret(data) then
        return nil
    end
    local id = data.id
    if secret(id) then
        return nil
    end
    if type(id) ~= "number" then
        local link = data.hyperlink
        if secret(link) then
            return nil
        end
        id = W.ItemID(link)
    end
    local rank = id and W.Rank(id)
    if not rank then
        return nil
    end
    local r, g, b = 1, 1, 1
    if UI and UI.Color then
        r, g, b = UI.Color(W.RANK_COLOR[rank])
    end
    return string.format(W.TEXT.tooltip, W.Label(rank)), r, g, b
end

function W.OnTooltip(tooltip, data)
    local text, r, g, b = W.TooltipLine(data)
    if text and tooltip and tooltip.AddLine then
        tooltip:AddLine(text, r, g, b)
    end
end

if TooltipDataProcessor and TooltipDataProcessor.AddTooltipPostCall and Enum and Enum.TooltipDataType
    and Enum.TooltipDataType.Item ~= nil then
    TooltipDataProcessor.AddTooltipPostCall(Enum.TooltipDataType.Item, function(tooltip, data)
        local ok, err = pcall(W.OnTooltip, tooltip, data)
        if not ok and geterrorhandler then
            geterrorhandler()(err)
        end
    end)
end

-- The Encounter Journal's right-click menu ---------------------------------------------------------------

-- The menu for one item: Add to wishlist with the ranks (yours ticked), and Remove when it is on your list.
function W.OpenMenu(owner, item)
    local id = W.ItemID(item)
    if not id then
        return nil
    end
    return UI.ContextMenu(owner, function(root)
        local name = C_Item and C_Item.GetItemInfo and C_Item.GetItemInfo(id)
        root:CreateTitle(type(name) == "string" and name or W.TEXT.menuTitle)
        local sub = root:CreateButton(W.TEXT.add)
        for _, rank in ipairs(W.RANKS) do
            sub:CreateRadio(W.Label(rank), function(r)
                return W.Rank(id) == r
            end, function(r)
                W.Set(id, r)
            end, rank)
        end
        if W.Rank(id) then
            root:CreateButton(W.TEXT.remove, function()
                W.Remove(id)
            end)
        end
    end)
end

local hooked = setmetatable({}, { __mode = "k" }) -- loot rows already hooked

-- A loot row's right-click: the item it shows now, the menu a frame later (after the game's own click).
local function onMouseUp(row, button)
    if button ~= "RightButton" or (IsModifiedClick and IsModifiedClick()) then
        return -- a modified click is the game's (links, previews)
    end
    local id = W.ItemID(row.itemID) or W.ItemID(row.link)
    if not id then
        return
    end
    local owner = EncounterJournal or row
    C_Timer.After(0, function()
        W.OpenMenu(owner, id)
    end)
end

-- Hooks a frame the loot list made, once; its headers (no slot text) are left alone.
local function hookRow(frame)
    if type(frame) ~= "table" or hooked[frame] or not frame.HookScript or frame.slot == nil then
        return
    end
    hooked[frame] = true
    frame:HookScript("OnMouseUp", onMouseUp)
end
W.HookJournalRow = hookRow

local installed = false

local function install()
    if installed then
        return
    end
    local info = EncounterJournal and EncounterJournal.encounter and EncounterJournal.encounter.info
    local box = info and info.LootContainer and info.LootContainer.ScrollBox
    if box and ScrollUtil and ScrollUtil.AddInitializedFrameCallback then
        installed = true
        ScrollUtil.AddInitializedFrameCallback(box, function(_, frame)
            hookRow(frame)
        end, W, false)
        if box.ForEachFrame then
            pcall(box.ForEachFrame, box, hookRow) -- rows made before (the Journal opened by another addon first)
        end
    elseif hooksecurefunc and EncounterJournalItemMixin and EncounterJournalItemMixin.Init then
        installed = true
        hooksecurefunc(EncounterJournalItemMixin, "Init", hookRow)
    end
end
W.InstallJournal = install

-- The Journal's loot for a boss ---------------------------------------------------------------------------

local where = {} -- [dungeonEncounterID] = { instance = Journal instance, journal = Journal encounter }, as found
local searchedAt = {} -- [dungeonEncounterID] = GetTime() of a search that didn't find it (searched again after SEARCH_AGAIN)
local SEARCH_AGAIN = 30
local lootCache = {} -- ["encounterID:classOnly"] = the items read
local tries = {} -- reads that found nothing, by the same key
local LOOT_TRIES = 2 -- reads that may find nothing (the Journal's data still coming) before a boss counts as having none
local loadingIDs = {} -- items asked of the game

local function call(fn, ...)
    if type(fn) ~= "function" then
        return false
    end
    return pcall(fn, ...)
end

-- The Journal's own choices, to put back after a read: its tier and difficulty (EJ_GetCurrentTier, EJ_GetDifficulty),
-- its class and slot filters, and, once the Journal window has loaded, the instance and boss it shows
-- (EncounterJournal.instanceID and .encounterID, which EncounterJournal_DisplayInstance and _DisplayEncounter set;
-- encounterID is nil on an instance's overview). Before it has loaded nothing shows, so there is no instance to keep.
local function journalState()
    local CEJ = C_EncounterJournal or {}
    local st = {}
    local ok, v = call(EJ_GetCurrentTier)
    st.tier = ok and tonumber(v) or nil
    ok, v = call(EJ_GetDifficulty)
    st.difficulty = ok and tonumber(v) or nil
    local okF, class, spec = call(EJ_GetLootFilter)
    if okF then
        st.class, st.spec = class or 0, spec or 0
    end
    local okS, slot = call(CEJ.GetSlotFilter)
    if okS then
        st.slot = slot
    end
    local EJ = EncounterJournal
    if type(EJ) == "table" then
        st.instance, st.encounter = EJ.instanceID, EJ.encounterID
    end
    return st
end

local function restoreJournal(st)
    local CEJ = C_EncounterJournal or {}
    if st.class then
        call(EJ_SetLootFilter, st.class, st.spec)
    end
    if st.slot ~= nil then
        call(CEJ.SetSlotFilter, st.slot)
    end
    local ok, tier = call(EJ_GetCurrentTier)
    if st.tier and not (ok and tier == st.tier) then
        call(EJ_SelectTier, st.tier)
    end
    if st.instance then
        call(EJ_SelectInstance, st.instance)
    end
    if st.encounter then
        call(EJ_SelectEncounter, st.encounter)
    end
    local okD, difficulty = call(EJ_GetDifficulty)
    if st.difficulty and not (okD and difficulty == st.difficulty) then
        call(EJ_SetDifficulty, st.difficulty)
    end
end

-- The raids of the Journal's newest tier (EJ_GetNumTiers, selected for the search), by dungeon encounter ID
-- (EJ_GetEncounterInfo's seventh return), added to where. The caller puts the Journal's choices back.
local function findBosses()
    local okN, n = call(EJ_GetNumTiers)
    if okN and tonumber(n) and tonumber(n) > 0 then
        call(EJ_SelectTier, tonumber(n))
    end
    for i = 1, 30 do
        local ok, instanceID = call(EJ_GetInstanceByIndex, i, true)
        if not (ok and instanceID) then
            break
        end
        call(EJ_SelectInstance, instanceID)
        for j = 1, 30 do
            local ok2, _, _, journalID = call(EJ_GetEncounterInfoByIndex, j)
            if not (ok2 and journalID) then
                break
            end
            local ok3, _, _, _, _, _, _, dungeonEncounterID = call(EJ_GetEncounterInfo, journalID)
            if ok3 and tonumber(dungeonEncounterID) then
                where[tonumber(dungeonEncounterID)] = { instance = instanceID, journal = journalID }
            end
        end
    end
end

-- An item's slot as the game words it (the INVTYPE_ global for its equip slot), or "".
local function slotText(id)
    local ok, _, _, _, equipLoc = call(C_Item and C_Item.GetItemInfoInstant, id)
    local text = ok and type(equipLoc) == "string" and equipLoc ~= "" and _G[equipLoc]
    return type(text) == "string" and text or ""
end

-- Fills a row's name, link, icon and quality from the game (nil fields when not loaded yet).
function W.FillItem(row)
    local ok, name, link, quality = call(C_Item and C_Item.GetItemInfo, row.id)
    if ok and type(name) == "string" then
        row.name, row.link, row.quality = name, link, quality
    end
    if not row.icon then
        local okI, icon = call(C_Item and C_Item.GetItemIconByID, row.id)
        row.icon = okI and icon or nil
    end
    if not row.slot or row.slot == "" then
        row.slot = slotText(row.id)
    end
    return row.name ~= nil
end

-- Asks the game for an item's data; LM:Fire("wishlist", "loot") once it is there.
local function whenLoaded(id)
    if loadingIDs[id] or not (Item and Item.CreateFromItemID) then
        return
    end
    loadingIDs[id] = true
    local ok, item = pcall(Item.CreateFromItemID, Item, id)
    if ok and item and item.ContinueOnItemLoad then
        item:ContinueOnItemLoad(function()
            loadingIDs[id] = nil
            LM:Fire("wishlist", "loot")
        end)
    end
end

-- Reads one boss's loot: { { id, name, link, icon, quality, slot } } in the Journal's order (each item once), or nil
-- when the Journal gives none yet. The caller puts the Journal's choices back.
local function readLoot(at, classOnly)
    local CEJ = C_EncounterJournal or {}
    call(EJ_SelectInstance, at.instance)
    call(EJ_SelectEncounter, at.journal)
    local classID = 0
    if classOnly then
        local _, _, id = UnitClass("player")
        classID = type(id) == "number" and id or 0
    end
    call(EJ_SetLootFilter, classID, 0)
    call(CEJ.ResetSlotFilter)
    local items, seen = {}, {}
    local okN, n = call(EJ_GetNumLoot)
    for i = 1, (okN and tonumber(n) or 0) do
        local ok, info = call(CEJ.GetLootInfoByIndex, i)
        local id = ok and type(info) == "table" and W.ItemID(info.itemID)
        if id and not seen[id] then
            seen[id] = true
            items[#items + 1] = { id = id, name = info.name, link = info.link, icon = info.icon,
                quality = info.itemQuality, slot = type(info.slot) == "string" and info.slot or nil }
        end
    end
    return #items > 0 and items or nil
end

-- Finds the boss if needed and reads its loot, with the Journal's choices put back in the same frame. Returns the
-- items (nil: none yet), or nil, "missing".
local function lookUp(encounterID, classOnly)
    local st = journalState()
    local ok, result, why = pcall(function()
        if not where[encounterID] then
            local last = searchedAt[encounterID]
            if last and GetTime() - last < SEARCH_AGAIN then
                return nil, "missing"
            end
            findBosses()
            if not where[encounterID] then
                searchedAt[encounterID] = GetTime() -- searched again later, not kept missing for the login
                return nil, "missing"
            end
        end
        return readLoot(where[encounterID], classOnly)
    end)
    restoreJournal(st)
    if not ok then
        if geterrorhandler then
            geterrorhandler()(result)
        end
        return nil, "missing"
    end
    return result, why
end

-- One boss's loot (a dungeon encounter ID) for the window: items, or nil and why ("journal": no Journal here,
-- "missing": the boss isn't in the Journal's newest tier, "loading": the Journal hasn't got its loot yet).
-- Kept per boss and class filter for the login; an item still loading fires LM:Fire("wishlist", "loot") later.
function W.BossLoot(encounterID, classOnly)
    if not (EJ_SelectInstance and EJ_SelectEncounter and EJ_GetNumLoot and C_EncounterJournal
        and C_EncounterJournal.GetLootInfoByIndex) then
        return nil, "journal"
    end
    local key = tostring(encounterID) .. ":" .. (classOnly and 1 or 0)
    local kept = lootCache[key]
    if not kept then
        local items, why = lookUp(encounterID, classOnly)
        if why == "missing" then
            return nil, "missing"
        end
        if not items then
            tries[key] = (tries[key] or 0) + 1
            if tries[key] <= LOOT_TRIES then
                W.WaitForJournal()
                return nil, "loading"
            end
            items = {} -- still none after the Journal's data came: the boss has none for you
        end
        kept = items
        lootCache[key] = kept
    end
    for _, row in ipairs(kept) do
        if not W.FillItem(row) then
            whenLoaded(row.id)
        end
    end
    return kept
end

-- The Journal's loot data arriving (EJ_LOOT_DATA_RECIEVED, the game's spelling) after a read that got none: the
-- window asks again.
local lootEvents = CreateFrame("Frame")
function W.WaitForJournal()
    lootEvents:RegisterEvent("EJ_LOOT_DATA_RECIEVED")
end

-- Forgets what was read (for tests, and a new tier).
function W.ForgetLoot()
    where, searchedAt, lootCache, tries, loadingIDs = {}, {}, {}, {}, {}
end

local events = CreateFrame("Frame")
events:RegisterEvent("ADDON_LOADED")
events:SetScript("OnEvent", function(self, _, name)
    if name == "Blizzard_EncounterJournal" then
        install()
        self:UnregisterEvent("ADDON_LOADED")
    end
end)
lootEvents:SetScript("OnEvent", function(self)
    self:UnregisterEvent("EJ_LOOT_DATA_RECIEVED")
    LM:Fire("wishlist", "loot")
end)
-- already loaded (another addon opened it first)
if C_AddOns and C_AddOns.IsAddOnLoaded and C_AddOns.IsAddOnLoaded("Blizzard_EncounterJournal") then
    install()
end
