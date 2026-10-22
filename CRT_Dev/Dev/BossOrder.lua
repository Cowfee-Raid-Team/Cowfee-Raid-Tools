local ADDON, CRT = ...

-- DEVELOPER ONLY. Boss order (Development page, /crt dev bosses): the raid progression route of the
-- current season, the order every boss list in the addon follows (CRT.Bosses:Route). Each raid is a
-- heading with its name, its bosses under it; up and down move a boss, across raid headings too. Every
-- change applies at once on this computer (CRTDB.dev.bossRoute[season]) and boss lists redraw.
--   New raid           adds an empty raid at the end, to move bosses into
--   Add boss           on a raid's heading: a boss from the Encounter Journal's raids, or one typed as
--                      its encounter ID and name (a boss the Journal doesn't list yet). It is written
--                      { id, name } in the route, a boss with no file of its own (Bosses:Stub)
--   Reset to shipped   drops this computer's order; the season's Season.lua order applies again
--   Export             the raids table to paste into the season's Season.lua, which is what ships
-- This file never ships: its .toc line is inside the do-not-package block.

local Order = {}
CRT.BossOrder = Order

local UI = CRT.UI
local Bosses = CRT.Bosses

local ROW_H = 26
local WIN_W = 470
local ADD_POPUP = "COWFEERAIDTOOLS_BOSSORDER_ADD"
local TOP = 64

local win, seasonKey
local raids -- the working route: { { key, name, bosses = { encounterID or { id, name }, ... } } }
local rowPool = {}

local function devRoutes()
    CRT.db.dev = CRT.db.dev or {}
    CRT.db.dev.bossRoute = CRT.db.dev.bossRoute or {}
    return CRT.db.dev.bossRoute
end

-- The route as it applies now (shipped, or this computer's), as plain IDs, every boss placed.
local function load()
    seasonKey = Bosses:Current() and Bosses:Current().key
    raids = {}
    if not seasonKey then
        return
    end
    for _, group in ipairs(Bosses:Route(seasonKey)) do
        local raid = { key = group.raid.key, name = group.raid.name, bosses = {} }
        for _, def in ipairs(group.bosses) do
            raid.bosses[#raid.bosses + 1] = def.stub and { id = def.encounterID, name = def.name } or def.encounterID
        end
        raids[#raids + 1] = raid
    end
end

local function save()
    devRoutes()[seasonKey] = raids
    Bosses:FireRoute()
end

local refresh

local function move(gi, bi, dir)
    local list = raids[gi].bosses
    local id = list[bi]
    if dir < 0 then
        if bi > 1 then
            list[bi], list[bi - 1] = list[bi - 1], list[bi]
        elseif gi > 1 then
            table.remove(list, bi)
            table.insert(raids[gi - 1].bosses, id)
        end
    else
        if bi < #list then
            list[bi], list[bi + 1] = list[bi + 1], list[bi]
        elseif gi < #raids then
            table.remove(list, bi)
            table.insert(raids[gi + 1].bosses, 1, id)
        end
    end
    save()
    refresh()
end

local function exportText()
    local lines = { "    raids = {" }
    for _, raid in ipairs(raids) do
        lines[#lines + 1] = "        {"
        lines[#lines + 1] = string.format("            key = %q,", raid.key)
        lines[#lines + 1] = string.format("            name = %q,", raid.name)
        lines[#lines + 1] = "            bosses = {"
        for _, entry in ipairs(raid.bosses) do
            local id = Bosses.EntryID(entry)
            local def = Bosses:Get(id)
            if def and not def.stub then
                lines[#lines + 1] = string.format("                %d, -- %s", id, def.name)
            else
                -- no boss file yet: the name ships in the route
                lines[#lines + 1] = string.format("                { id = %d, name = %q },", id, def and def.name or (type(entry) == "table" and entry.name) or "?")
            end
        end
        lines[#lines + 1] = "            },"
        lines[#lines + 1] = "        },"
    end
    lines[#lines + 1] = "    },"
    return table.concat(lines, "\n")
end

-- Whether a boss is in the route already, in any raid.
local function placed(id)
    for _, raid in ipairs(raids) do
        for _, entry in ipairs(raid.bosses) do
            if Bosses.EntryID(entry) == id then
                return true
            end
        end
    end
    return false
end

local function addBoss(gi, id, name)
    id = tonumber(id)
    name = name and strtrim(name) or ""
    if not (raids[gi] and id and name ~= "") then
        return
    end
    if placed(id) then
        CRT:Print(string.format("Boss order: %s (%d) is in the route already.", name, id))
        return
    end
    local def = Bosses:Get(id)
    table.insert(raids[gi].bosses, (def and not def.stub) and id or { id = id, name = name })
    save()
    refresh()
end

-- The Encounter Journal's raids of the tier it shows, each with its bosses: { { name, bosses = { { id,
-- name } } } }, the IDs being dungeon encounter IDs (EJ_GetEncounterInfo's seventh return, as
-- Timeline/Journal.lua reads them). The Journal's selected instance is put back afterwards.
local function journalRaids()
    local out = {}
    if InCombatLockdown() or not (EJ_GetInstanceByIndex and EJ_SelectInstance and EJ_GetEncounterInfoByIndex and EJ_GetEncounterInfo) then
        return out
    end
    local previous
    if EJ_GetCurrentInstance then
        local ok, id = pcall(EJ_GetCurrentInstance)
        previous = ok and id or nil
    end
    for i = 1, 30 do
        local ok, instanceID, instanceName = pcall(EJ_GetInstanceByIndex, i, true)
        if not (ok and instanceID) then
            break
        end
        pcall(EJ_SelectInstance, instanceID)
        local raid = { name = type(instanceName) == "string" and instanceName or ("Raid " .. i), bosses = {} }
        for j = 1, 30 do
            local ok2, _, _, journalID = pcall(EJ_GetEncounterInfoByIndex, j)
            if not (ok2 and journalID) then
                break
            end
            local ok3, name, _, _, _, _, _, dungeonEncounterID = pcall(EJ_GetEncounterInfo, journalID)
            if ok3 and type(name) == "string" and tonumber(dungeonEncounterID) then
                raid.bosses[#raid.bosses + 1] = { id = tonumber(dungeonEncounterID), name = name }
            end
        end
        out[#out + 1] = raid
    end
    if previous and previous ~= 0 then
        pcall(EJ_SelectInstance, previous)
    end
    return out
end

-- Asks for a boss the Journal doesn't list: "3501, Boss Name".
local function askBoss(gi)
    if not StaticPopupDialogs[ADD_POPUP] then
        local function accept(edit)
            local text = edit and strtrim(edit:GetText() or "") or ""
            local id, name = text:match("^(%d+)%s*[,;]?%s*(.-)$")
            if not (id and name and name ~= "") then
                CRT:Print("Boss order: type the encounter ID, a comma, then the name, as in 3501, New Boss.")
                return
            end
            addBoss(StaticPopupDialogs[ADD_POPUP].gi, id, name)
        end
        StaticPopupDialogs[ADD_POPUP] = {
            text = "A boss's dungeon encounter ID and name, as in 3501, New Boss (the ID ENCOUNTER_START reports, or a Warcraft Logs boss= number):",
            button1 = ACCEPT or "Accept",
            button2 = CANCEL or "Cancel",
            hasEditBox = true,
            maxLetters = 80,
            timeout = 0,
            whileDead = true,
            hideOnEscape = true,
            preferredIndex = 3,
            OnAccept = function(dialog)
                accept(CRT.UI.PopupEditBox(dialog))
            end,
            EditBoxOnEnterPressed = function(edit)
                accept(edit)
                StaticPopup_Hide(ADD_POPUP)
            end,
            EditBoxOnEscapePressed = function()
                StaticPopup_Hide(ADD_POPUP)
            end,
        }
    end
    StaticPopupDialogs[ADD_POPUP].gi = gi
    StaticPopup_Show(ADD_POPUP)
end

-- Add boss on a raid heading: the Journal's raids, each a submenu of its bosses (one already in the
-- route is greyed), then Type an ID for one it doesn't list.
local function addMenu(owner, gi)
    if not (MenuUtil and MenuUtil.CreateContextMenu) then
        askBoss(gi)
        return
    end
    local journal = journalRaids()
    UI.ContextMenu(owner, function(root)
        root:CreateTitle("Add a boss to " .. (raids[gi] and raids[gi].name or "this raid"))
        if #journal == 0 then
            root:CreateTitle(InCombatLockdown() and "The Journal isn't read in combat" or "No raids in the Journal's tier")
        end
        for _, jr in ipairs(journal) do
            local sub = root:CreateButton(jr.name)
            for _, b in ipairs(jr.bosses) do
                local item = sub:CreateButton(b.name, function()
                    addBoss(gi, b.id, b.name)
                end)
                if placed(b.id) then
                    item:SetEnabled(false)
                end
            end
        end
        root:CreateDivider()
        root:CreateButton("Type an encounter ID and name...", function()
            askBoss(gi)
        end)
    end)
end

local function smallButton(parent, text, width)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontButtonSmall)
    b:SetHighlightFontObject(CRTFontButtonSmallHighlight)
    b:SetDisabledFontObject(CRTFontButtonSmallDisable)
    b:SetSize(width, 20)
    b:SetText(text)
    return b
end

-- One row: a raid heading ("Raid:", an editable name, Add boss, Remove when empty) or a boss (its name,
-- up and down).
local function getRow(i)
    local r = rowPool[i]
    if r then
        return r
    end
    r = CreateFrame("Frame", nil, win)
    r:SetSize(WIN_W - 28, ROW_H)
    r:SetPoint("TOPLEFT", 14, -TOP - (i - 1) * ROW_H)
    r.raidLabel = r:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    r.raidLabel:SetPoint("LEFT", 0, 0)
    r.raidLabel:SetText("Raid:")
    r.nameEdit = CreateFrame("EditBox", nil, r, "InputBoxTemplate")
    r.nameEdit:SetSize(200, 20)
    r.nameEdit:SetPoint("LEFT", r.raidLabel, "RIGHT", 10, 0)
    r.nameEdit:SetAutoFocus(false)
    r.nameEdit:SetFontObject(CRTFontEdit)
    r.nameEdit:SetScript("OnEnterPressed", r.nameEdit.ClearFocus)
    r.nameEdit:SetScript("OnEditFocusLost", function(self)
        local raid = raids[r.gi]
        local text = strtrim(self:GetText() or "")
        if raid and text ~= "" and text ~= raid.name then
            raid.name = text
            save()
        end
        refresh()
    end)
    r.add = smallButton(r, "Add boss", 80)
    r.add:SetPoint("LEFT", r.nameEdit, "RIGHT", 8, 0)
    r.add:SetScript("OnClick", function(self)
        addMenu(self, r.gi)
    end)
    r.remove = smallButton(r, "Remove", 70)
    r.remove:SetPoint("LEFT", r.add, "RIGHT", 6, 0)
    r.remove:SetScript("OnClick", function()
        if raids[r.gi] and #raids[r.gi].bosses == 0 then
            table.remove(raids, r.gi)
            save()
            refresh()
        end
    end)
    r.boss = r:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    r.boss:SetPoint("LEFT", 28, 0)
    r.boss:SetWidth(260)
    r.boss:SetJustifyH("LEFT")
    r.boss:SetWordWrap(false)
    r.up = smallButton(r, "Up", 44)
    r.up:SetPoint("RIGHT", -52, 0)
    r.up:SetScript("OnClick", function()
        move(r.gi, r.bi, -1)
    end)
    r.down = smallButton(r, "Down", 48)
    r.down:SetPoint("RIGHT", 0, 0)
    r.down:SetScript("OnClick", function()
        move(r.gi, r.bi, 1)
    end)
    UI:SkinTree(r)
    rowPool[i] = r
    return r
end

refresh = function()
    if not win then
        return
    end
    local i = 0
    for gi, raid in ipairs(raids) do
        i = i + 1
        local r = getRow(i)
        r.gi, r.bi = gi, nil
        r.raidLabel:Show()
        r.nameEdit:Show()
        r.add:Show()
        if not r.nameEdit:HasFocus() then
            r.nameEdit:SetText(raid.name or "")
        end
        r.remove:SetShown(#raid.bosses == 0)
        r.boss:Hide()
        r.up:Hide()
        r.down:Hide()
        r:Show()
        for bi, entry in ipairs(raid.bosses) do
            i = i + 1
            local b = getRow(i)
            b.gi, b.bi = gi, bi
            b.raidLabel:Hide()
            b.nameEdit:Hide()
            b.add:Hide()
            b.remove:Hide()
            local id = Bosses.EntryID(entry)
            local def = Bosses:Get(id)
            local name = def and def.name or (type(entry) == "table" and entry.name) or tostring(id)
            -- a boss with no file of its own yet (added here, or named in Season.lua) is marked new
            b.boss:SetText(string.format("%d. %s", bi, name) .. ((not def or def.stub) and "  |cff8a8a8a(no boss file)|r" or ""))
            b.boss:Show()
            b.up:Show()
            b.down:Show()
            b.up:SetEnabled(bi > 1 or gi > 1)
            b.down:SetEnabled(bi < #raid.bosses or gi < #raids)
            b:Show()
        end
    end
    for j = i + 1, #rowPool do
        rowPool[j]:Hide()
    end
    local _, custom = Bosses:Raids(seasonKey)
    win.status:SetText(custom and "Your order (this computer only). Export it into Season.lua to ship it." or "The shipped order, from Season.lua.")
    win:SetHeight(TOP + math.max(i, 1) * ROW_H + 70)
end

local function build()
    win = CreateFrame("Frame", "CowfeeRaidToolsBossOrder", UIParent, "BasicFrameTemplateWithInset")
    UI:StyleWindow(win)
    win:SetSize(WIN_W, 400)
    win:SetPoint("CENTER")
    UI:RegisterLayer("popups", win)
    win:SetMovable(true)
    win:EnableMouse(true)
    win:RegisterForDrag("LeftButton")
    win:SetScript("OnDragStart", function(self) self:StartMoving(true) end)
    win:SetScript("OnDragStop", win.StopMovingOrSizing)
    win:SetClampedToScreen(true)
    tinsert(UISpecialFrames, "CowfeeRaidToolsBossOrder")
    UI.SetFrameTitle(win, "Boss order (dev)")

    local season = win:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    season:SetPoint("TOPLEFT", 16, -34)
    win.season = season
    UI.HelpRight(season, "Boss order", "The raid progression route: the order every boss list in the addon shows, grouped by raid. Up and Down move a boss, into the raid before or after at the ends. Type a raid's name to rename it; an empty raid can be removed.\n\nAdd boss, on a raid's heading, adds a boss from the Encounter Journal's raids (the tier the Journal shows), or one you type as its encounter ID and name, for a boss the Journal doesn't list yet. A boss added this way has no boss file: it ships as { id, name } in Season.lua, and gets a file once it has an ability timeline.\n\nChanges apply at once, on this computer only. Export gives the raids table for the season's Season.lua, which is what ships. Reset to shipped goes back to Season.lua's order.")

    win.status = win:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    win.status:SetPoint("BOTTOMLEFT", 16, 40)
    win.status:SetWidth(WIN_W - 32)
    win.status:SetJustifyH("LEFT")

    local newRaid = smallButton(win, "New raid", 90)
    newRaid:SetPoint("BOTTOMLEFT", 14, 12)
    newRaid:SetScript("OnClick", function()
        raids[#raids + 1] = { key = seasonKey .. "-raid" .. (#raids + 1), name = "New raid", bosses = {} }
        save()
        refresh()
    end)
    local reset = smallButton(win, "Reset to shipped", 130)
    reset:SetPoint("LEFT", newRaid, "RIGHT", 6, 0)
    reset:SetScript("OnClick", function()
        devRoutes()[seasonKey] = nil
        Bosses:FireRoute()
        load()
        refresh()
    end)
    local export = smallButton(win, "Export", 90)
    export:SetPoint("LEFT", reset, "RIGHT", 6, 0)
    export:SetScript("OnClick", function()
        CRT.ConsumablesTools:ShowText("Boss order for Season.lua (Ctrl+C to copy, paste to Claude)", exportText())
    end)
    UI:SkinTree(win)
end

function Order:Toggle()
    if not win then
        build()
    end
    if win:IsShown() then
        win:Hide()
        return
    end
    load()
    if not seasonKey then
        CRT:Print("Boss order: no season pack is loaded.")
        return
    end
    win.season:SetText(Bosses:Current().name)
    win:Show()
    refresh()
end
