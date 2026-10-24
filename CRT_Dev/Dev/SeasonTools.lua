local ADDON, CRT = ...

-- DEVELOPER ONLY. /crt dev seasons: the season packs (CRT_Data/Seasons/<season>/), which of them load, and
-- purging a season's saved data. See the vault note "Cowfee Raid Tools - Boss Library Design".
--   Load      Current season only (the default) or All seasons, saved in CRTDB.dev.seasons.load.
--             Changing it reloads the interface, since the library fills the features at load.
--   Purge     Deletes the saved data of one season's bosses, those registered in its pack: recorded
--             Timeline pulls and row settings, reminders and phase triggers, pace plans and switches,
--             and marker display switches and drafts. Tattlebot's history, the Late Tracker and raid
--             notes are never touched, and a boss with saved data but no boss file is never purged.
--   IDs       /crt dev seasons ids (or the Encounter IDs button): each loaded boss's encounterID and name
--             against the Timeline's saved pulls (CRTDB.timeline.bosses, keyed by the ID the game gave,
--             with its name): confirmed, mismatched or never pulled, one line per boss in route order,
--             then any saved boss with no boss file. Printed, and shown in a Copy box to paste to Claude.
--
-- This file never ships: its .toc line is inside the do-not-package block.

local UI = CRT.UI
local Bosses = CRT.Bosses

local Tools = {}
CRT.SeasonTools = Tools

local win
local rows = {}

local LOADS = {
    { key = "current", label = "Current season only" },
    { key = "all", label = "All seasons" },
}

local function dev()
    CRT.db.dev = CRT.db.dev or {}
    CRT.db.dev.seasons = CRT.db.dev.seasons or {}
    return CRT.db.dev.seasons
end

-- The saved tables keyed by encounter ID that a purge clears, with a label for the confirmation.
local function stores()
    local db = CRT.db
    return {
        { label = "recorded Timeline pulls", t = db.timeline and db.timeline.bosses },
        { label = "Timeline row settings", t = db.timeline and db.timeline.rows },
        { label = "reminders", t = db.alerts and db.alerts.reminders },
        { label = "phase triggers", t = db.alerts and db.alerts.phases },
        { label = "own pace plans", t = db.pace and db.pace.own },
        { label = "shared pace plans", t = db.pace and db.pace.shared },
        { label = "pace plan choices", t = db.pace and db.pace.use },
        { label = "pace switches", t = db.pace and db.pace.disabled },
        { label = "marker display switches", t = db.markers and db.markers.disabled },
        { label = "marker display drafts", t = db.dev and db.dev.markerDisplays },
    }
end

-- What a purge of the season would delete: { { label, count } }, and the total.
function Tools:PurgeCounts(seasonKey)
    local ids = {}
    for _, def in ipairs(Bosses:List(seasonKey)) do
        ids[#ids + 1] = def.encounterID
    end
    local out, total = {}, 0
    for _, store in ipairs(stores()) do
        local n = 0
        if type(store.t) == "table" then
            for _, id in ipairs(ids) do
                if store.t[id] ~= nil then
                    n = n + 1
                end
            end
        end
        if n > 0 then
            out[#out + 1] = { label = store.label, count = n }
            total = total + n
        end
    end
    return out, total, #ids
end

function Tools:Purge(seasonKey)
    local n = 0
    for _, def in ipairs(Bosses:List(seasonKey)) do
        for _, store in ipairs(stores()) do
            if type(store.t) == "table" and store.t[def.encounterID] ~= nil then
                store.t[def.encounterID] = nil
                n = n + 1
            end
        end
    end
    return n
end

-- The encounter ID check ---------------------------------------------------------------------

-- A boss name to compare: lower case, letters and digits only, so "Nek'zali" matches "Nek’zali".
local function nameKey(name)
    return type(name) == "string" and name:lower():gsub("[^%w]", "") or nil
end

local function pullCount(saved)
    local n = type(saved.pulls) == "table" and #saved.pulls or 0
    return n .. " saved pull" .. (n == 1 and "" or "s")
end

-- One line per loaded boss, in route order, then one per saved boss with no boss file; and the counts
-- { confirmed, mismatched, never }.
function Tools:IdsReport()
    local saved = {}
    local tl = CRT.db.timeline
    for id, boss in pairs(type(tl) == "table" and type(tl.bosses) == "table" and tl.bosses or {}) do
        if type(id) == "number" and type(boss) == "table" then
            saved[id] = boss
        end
    end
    local byName = {}
    for id, boss in pairs(saved) do
        local key = nameKey(boss.name)
        if key and (not byName[key] or id < byName[key]) then
            byName[key] = id
        end
    end
    local lines, counts, used = {}, { confirmed = 0, mismatched = 0, never = 0 }, {}
    for _, def in ipairs(Bosses:RouteList()) do
        local id, key = def.encounterID, nameKey(def.name)
        local own, other = saved[id], byName[key]
        local head = string.format("%s (%d): ", def.name, id)
        if own and nameKey(own.name) == key then
            counts.confirmed = counts.confirmed + 1
            lines[#lines + 1] = head .. "confirmed (" .. pullCount(own) .. ")"
        elseif other and other ~= id then
            counts.mismatched = counts.mismatched + 1
            used[other] = true
            lines[#lines + 1] = head .. "mismatched, the game pulled it as " .. other .. " (" .. pullCount(saved[other]) .. ")"
        elseif own then
            counts.mismatched = counts.mismatched + 1
            lines[#lines + 1] = head .. "mismatched, the saved pull with this ID is named " .. tostring(own.name)
        else
            counts.never = counts.never + 1
            lines[#lines + 1] = head .. "never pulled"
        end
    end
    local extra = {}
    for id in pairs(saved) do
        if not used[id] and not Bosses:Get(id) then
            extra[#extra + 1] = id
        end
    end
    table.sort(extra)
    for _, id in ipairs(extra) do
        local n = type(saved[id].pulls) == "table" and #saved[id].pulls or 0
        lines[#lines + 1] = string.format("%s (%d): saved pulls (%d), no boss file", tostring(saved[id].name or "?"), id, n)
    end
    return lines, counts
end

function Tools:Ids()
    local lines, c = self:IdsReport()
    local head = string.format("Encounter ID check: %d confirmed, %d mismatched, %d never pulled.", c.confirmed, c.mismatched, c.never)
    CRT:Print(head)
    for _, line in ipairs(lines) do
        CRT:Print("  " .. line)
    end
    CRT.ConsumablesTools:ShowText("Encounter ID check (Ctrl+C to copy, paste to Claude)", head .. "\n" .. table.concat(lines, "\n"))
end

local function confirmPurge(def)
    local counts, total, bosses = Tools:PurgeCounts(def.key)
    if total == 0 then
        CRT:Print("Nothing saved for the " .. bosses .. " boss" .. (bosses == 1 and "" or "es") .. " of " .. (def.name or def.key) .. ".")
        return
    end
    local parts = {}
    for _, c in ipairs(counts) do
        parts[#parts + 1] = c.count .. " " .. c.label
    end
    StaticPopup_ShowCustomGenericConfirmation({
        text = "Purge %s? This deletes, for its bosses: " .. table.concat(parts, ", ") .. ".\n\nTattlebot's history, the Late Tracker and raid notes are kept. This can't be undone.",
        text_arg1 = def.name or def.key,
        acceptText = "Purge",
        cancelText = CANCEL,
        showAlert = true,
        callback = function()
            local n = Tools:Purge(def.key)
            CRT:Print("Purged " .. n .. " saved entr" .. (n == 1 and "y" or "ies") .. " for " .. (def.name or def.key) .. ". /reload to see it everywhere.")
            Tools:Refresh()
        end,
    })
end

local function button(parent, text, width)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontButtonSmall)
    b:SetHighlightFontObject(CRTFontButtonSmallHighlight)
    b:SetHeight(20)
    b:SetText(text)
    local fs = b:GetFontString()
    b:SetWidth(width or math.ceil((fs and fs:GetStringWidth() or 60) + 24))
    return b
end

function Tools:Refresh()
    if not win or not win:IsShown() then
        return
    end
    win.load.refresh()
    for i, def in ipairs(Bosses:Seasons()) do
        local r = rows[i]
        if not r then
            r = CreateFrame("Frame", nil, win)
            r:SetSize(400, 24)
            r:SetPoint("TOPLEFT", 14, -86 - (i - 1) * 26)
            r.text = r:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
            r.text:SetPoint("LEFT", 0, 0)
            r.text:SetWidth(280)
            r.text:SetJustifyH("LEFT")
            r.purge = button(r, "Purge", 80)
            r.purge:SetPoint("RIGHT", 0, 0)
            UI:SkinTree(r)
            rows[i] = r
        end
        local _, total, bosses = Tools:PurgeCounts(def.key)
        r.text:SetText(string.format("%s%s: %d boss%s, %d saved", def.name or def.key, def.current and " (current)" or "", bosses, bosses == 1 and "" or "es", total))
        r.purge:SetScript("OnClick", function()
            confirmPurge(def)
        end)
        r:Show()
    end
end

local function build()
    win = CreateFrame("Frame", "CowfeeRaidToolsSeasonTools", UIParent, "BasicFrameTemplateWithInset")
    UI:StyleWindow(win)
    win:SetSize(430, 300)
    win:SetPoint("CENTER")
    UI:RegisterLayer("popups", win)
    win:SetMovable(true)
    win:EnableMouse(true)
    win:RegisterForDrag("LeftButton")
    win:SetScript("OnDragStart", function(self) self:StartMoving(true) end)
    win:SetScript("OnDragStop", win.StopMovingOrSizing)
    tinsert(UISpecialFrames, "CowfeeRaidToolsSeasonTools")
    UI.SetFrameTitle(win, "Season packs (dev)")

    win.load = UI.Dropdown(win, "Load", { options = LOADS, labelWidth = 60, width = 220,
        get = function()
            return Bosses:LoadMode()
        end,
        set = function(key)
            if key == Bosses:LoadMode() then
                return
            end
            dev().load = key ~= "current" and key or nil
            StaticPopup_ShowCustomGenericConfirmation({
                text = "Load %s? Your interface reloads.",
                text_arg1 = key == "all" and "all seasons" or "the current season only",
                acceptText = "Reload",
                cancelText = CANCEL,
                callback = ReloadUI,
            })
        end })
    win.load:SetPoint("TOPLEFT", 14, -32)
    local note = win:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    note:SetPoint("TOPLEFT", 16, -66)
    note:SetText("Seasons, their bosses, and what is saved for them:")
    local ids = button(win, "Encounter IDs")
    ids:SetPoint("BOTTOMLEFT", 14, 12)
    ids:SetScript("OnClick", function()
        Tools:Ids()
    end)
    UI.HelpRight(ids, "Encounter IDs", "Checks each boss's encounter ID against the Timeline's saved pulls: confirmed, mismatched or never pulled. The same as /crt dev seasons ids. Copy the text and paste it to Claude.")
    win:SetScript("OnShow", function()
        Tools:Refresh()
    end)
    UI:SkinTree(win)
end

function Tools:Toggle()
    if not win then
        build()
    end
    win:SetShown(not win:IsShown())
    self:Refresh()
end
