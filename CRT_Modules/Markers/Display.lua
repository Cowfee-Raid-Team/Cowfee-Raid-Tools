local ADDON, CRT = ...

-- Marker displays: a small window that shows raid markers in the order raiders send them in group
-- chat, each with who sent it, for a boss mechanic where players call out a marker with a macro such
-- as /raid {rt3}. The display for a boss is set in Markers/Database.lua (or, while it is being made,
-- in the dev editor, CRTDB.dev.markerDisplays), and each player can turn it off per boss on the Raid
-- Notes Reminders tab (CRTDB.markers.disabled[encounterID]).
--
-- A readable message fills a slot only when it holds a raid marker code ({rt1} to {rt8}, or a name
-- such as {skull}, any case), and the slot shows only its marker icons, not the rest of the text.
-- The codes are the game's own: ICON_TAG_LIST in Blizzard's ChatFrameConstants.lua, with the English
-- names from warcraft.wiki.gg's Raid target icons page when that table is missing.
--
-- Inside a raid, and during a boss fight, the game hides chat text and sender names from addons
-- (they arrive as secret values). The addon can't read, search or compare them, and no game function
-- answers "does this hidden text hold a marker" with a readable value (checked 2026-10-21 in the live
-- API documentation: C_ChatInfo, C_StringUtil, C_Intl, C_Secrets). So a hidden message's marker codes
-- are turned into icons by C_ChatInfo.ReplaceIconAndGroupExpressions, which accepts the hidden text,
-- and the result, typos and all, is put on screen as it is. The display's hidden setting decides
-- whether hidden messages fill slots at all: "fill" (the default) or "ignore". One try first:
-- C_Intl.CompareStrings accepts hidden text, and if it ever answers readably whether the icon
-- replacement changed the message, that answer decides instead. Its documentation doesn't say whether
-- the answer is hidden too, so a hidden or refused answer just leaves it to the setting.
-- Outside raids names are shown short and in class color.
--
-- It always clears when a pull starts and when it ends (kill or wipe), and as the display says: after
-- a gap with no messages, a while after the last slot fills, or when a new phase starts.

local Markers = {}
CRT.MarkerDisplay = Markers

local UI = CRT.UI

local CHAT_EVENTS = {
    "CHAT_MSG_RAID", "CHAT_MSG_RAID_LEADER", "CHAT_MSG_PARTY", "CHAT_MSG_PARTY_LEADER",
    "CHAT_MSG_INSTANCE_CHAT", "CHAT_MSG_INSTANCE_CHAT_LEADER",
}

local DEFAULT = { name = "Marker display", slots = 4, layout = "row", iconSize = 40, number = true, names = true, clearGap = 10, clearFull = 0, clearPhase = false, hidden = "fill" }
local SAMPLE = { "{rt1}", "{rt6}", "{rt8}", "{rt7}", "{rt2}", "{rt3}", "{rt4}", "{rt5}" }
-- The marker names in English, by marker number, for when the game's ICON_TAG_LIST is missing.
local ICON_NAMES = { star = 1, circle = 2, diamond = 3, triangle = 4, moon = 5, square = 6, cross = 7, x = 7, skull = 8 }
local IDENTICAL = 4 -- Enum.CollationStrength.Identical (IntlSharedTypesDocumentation.lua), if Enum lacks it

local frame, handle, title
local slots = {}
local active -- the display in use: a copy of its settings, with encounterID; nil when none
local testing = false -- a test from the dev editor, which also listens to /say
local previewOn = false
local filled = 0
local token = 0 -- bumped by every message and clear, so an old clear timer does nothing
local lastPhase

local function db()
    return CRT.db.markers
end

-- The secret test comes first: comparing a secret value, even with nil, is not allowed.
local function readable(v)
    if issecretvalue and issecretvalue(v) then
        return false
    end
    return v ~= nil
end

-- Every marker code the game turns into an icon, lower case without braces, to its marker number.
local function markerTags()
    local tags = {}
    for i = 1, 8 do
        tags["rt" .. i] = i
    end
    local game = type(ICON_TAG_LIST) == "table" and ICON_TAG_LIST or ICON_NAMES
    for tag, i in pairs(game) do
        if type(tag) == "string" and type(i) == "number" and i >= 1 and i <= 8 then
            tags[(tag:lower():gsub("[{}]", ""))] = i
        end
    end
    return tags
end

-- The raid markers in a readable message, in order, as marker numbers: "go {star} {X}" is { 1, 7 }.
function Markers.FindMarkers(text)
    local found, tags = {}, markerTags()
    for code in text:gmatch("{([^{}]*)}") do
        local i = tags[code:lower()]
        if i then
            found[#found + 1] = i
        end
    end
    return found
end

-- The game's icon replacement, or the text as it is when it refuses.
local function withIcons(text, noGroups)
    local api = C_ChatInfo and C_ChatInfo.ReplaceIconAndGroupExpressions
    if api then
        local ok, out = pcall(api, text, false, noGroups)
        if ok and out then
            return out
        end
    end
    return text
end

-- Whether a hidden message holds a marker: true or false when the game answers readably that the icon
-- replacement changed it, nil when it can't tell (the usual case).
local function hiddenHasMarker(text)
    local compare = C_Intl and C_Intl.CompareStrings
    if not compare then
        return nil
    end
    local strength = Enum and Enum.CollationStrength and Enum.CollationStrength.Identical or IDENTICAL
    local ok, result = pcall(compare, text, withIcons(text, true), strength)
    if not ok or not readable(result) or type(result) ~= "number" then
        return nil
    end
    return result ~= 0
end

-- What a message puts in its slot, or nil when it fills none.
local function slotText(text, hidden)
    if readable(text) then
        if type(text) ~= "string" then
            return nil
        end
        local codes = {}
        for _, i in ipairs(Markers.FindMarkers(text)) do
            codes[#codes + 1] = "{rt" .. i .. "}"
        end
        return #codes > 0 and withIcons(table.concat(codes, " ")) or nil
    end
    local has = hiddenHasMarker(text)
    if has == false or (has == nil and hidden == "ignore") then
        return nil
    end
    return withIcons(text)
end

-- Every display: the shipped ones, with any made in the dev editor over them.
function Markers:Displays()
    local out = {}
    for id, def in pairs(CRT.MarkerDisplayDB.displays) do
        out[id] = def
    end
    local dev = CRT.db.dev and CRT.db.dev.markerDisplays
    for id, def in pairs(dev or {}) do
        out[id] = def
    end
    return out
end

function Markers:For(encounterID)
    return encounterID and self:Displays()[encounterID] or nil
end

function Markers:Enabled(encounterID)
    return not db().disabled[encounterID]
end

function Markers:SetEnabled(encounterID, on)
    db().disabled[encounterID] = (not on) and true or nil
end

local function settings(def)
    local s = {}
    for k, v in pairs(DEFAULT) do
        s[k] = v
    end
    for k, v in pairs(def or {}) do
        s[k] = v
    end
    s.slots = math.max(1, math.min(8, math.floor(s.slots or 4)))
    return s
end

-- The window -------------------------------------------------------------------------------------

local function savePosition()
    local point, _, relativePoint, x, y = frame:GetPoint()
    db().position = { point = point, relativePoint = relativePoint, x = x, y = y }
end

local function applyPosition()
    local p = db().position
    frame:ClearAllPoints()
    if p then
        frame:SetPoint(p.point, UIParent, p.relativePoint or p.point, p.x, p.y)
    else
        frame:SetPoint("CENTER", UIParent, "CENTER", 0, 160)
    end
end

function Markers:ResetPosition()
    db().position = nil
    if frame then
        applyPosition()
    end
end

local function build()
    if frame then
        return
    end
    frame = CreateFrame("Frame", "CowfeeRaidToolsMarkerDisplay", UIParent, "BackdropTemplate")
    frame:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 2 })
    UI:RegisterThemed(frame, { bg = { 0.1, 0.1, 0.1, 0.85 }, border = { 0.2, 0.6, 0.85 } })
    UI:RegisterLayer("alert", frame)
    frame:SetClampedToScreen(true)
    frame:SetMovable(true)

    handle = CreateFrame("Frame", nil, frame, "BackdropTemplate")
    handle:SetHeight(20)
    handle:SetPoint("BOTTOMLEFT", frame, "TOPLEFT", 0, 2)
    handle:SetPoint("BOTTOMRIGHT", frame, "TOPRIGHT", 0, 2)
    handle:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    UI:RegisterThemed(handle, { bg = { 0.1, 0.25, 0.35, 0.9 }, border = { 0.2, 0.6, 0.85 } })
    handle:EnableMouse(true)
    handle:RegisterForDrag("LeftButton")
    title = handle:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    title:SetPoint("LEFT", 6, 0)
    title:SetJustifyH("LEFT")
    title:SetWordWrap(false)
    handle:SetScript("OnDragStart", function()
        frame:StartMoving(true)
    end)
    handle:SetScript("OnDragStop", function()
        frame:StopMovingOrSizing()
        savePosition()
    end)
    local reset = UI.ResetButton(handle, function()
        Markers:ResetPosition()
    end)
    reset:SetPoint("RIGHT", -2, 0)
    title:SetPoint("RIGHT", reset, "LEFT", -4, 0)
    handle:Hide()

    -- The marker's font: its height is the icon size, since a chat icon is drawn at the text's height.
    frame.iconFont = CreateFont("CRTMarkerIconFont")
    frame.iconFont:CopyFontObject(GameFontHighlight)

    applyPosition()
    frame:Hide()
end

local function slot(i)
    local s = slots[i]
    if s then
        return s
    end
    s = CreateFrame("Frame", nil, frame)
    s.number = s:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    s.number:SetPoint("TOP", 0, -4)
    s.icon = s:CreateFontString(nil, "OVERLAY")
    s.icon:SetFontObject(frame.iconFont)
    s.icon:SetWordWrap(false)
    s.name = s:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    s.name:SetWordWrap(false)
    slots[i] = s
    return s
end

-- Lays the slots out for a display: number above the marker, the sender's name below it.
local function layout(s)
    local size = math.max(16, math.min(96, s.iconSize))
    local font = CRT:FontPath(CRT.db.ui.font) or "Fonts\\FRIZQT__.TTF"
    frame.iconFont:SetFont(font, size, "")
    local cellW = math.max(size + 12, s.names and 80 or 0)
    local numberH = s.number and 18 or 0
    local nameH = s.names and 16 or 0
    local cellH = numberH + size + nameH + 12
    local perRow = (s.layout == "column" and 1) or (s.layout == "grid" and 4) or s.slots
    for i = 1, 8 do
        local c = slot(i)
        if i <= s.slots then
            local col, row = (i - 1) % perRow, math.floor((i - 1) / perRow)
            c:ClearAllPoints()
            c:SetSize(cellW, cellH)
            c:SetPoint("TOPLEFT", frame, "TOPLEFT", 6 + col * cellW, -4 - row * cellH)
            c.number:SetShown(s.number)
            c.number:SetText(tostring(i))
            c.icon:ClearAllPoints()
            c.icon:SetPoint("TOP", 0, -4 - numberH)
            c.icon:SetWidth(cellW - 4)
            c.name:ClearAllPoints()
            c.name:SetPoint("TOP", c.icon, "BOTTOM", 0, -2)
            c.name:SetWidth(cellW - 4)
            c.name:SetShown(s.names)
            c:Show()
        else
            c:Hide()
        end
    end
    local cols = math.min(perRow, s.slots)
    local rows = math.ceil(s.slots / perRow)
    frame:SetSize(12 + cols * cellW, 8 + rows * cellH)
    title:SetText(s.name or DEFAULT.name)
end

local function clearSlots()
    filled = 0
    for _, c in ipairs(slots) do
        c.icon:SetText("")
        c.name:SetText("")
        c.shownText, c.sender = nil, nil
    end
end

-- What the filled slots hold, { { text, sender } }, as it was put on screen (secret values stay
-- secret). For the dev editor and tests.
function Markers:Filled()
    local out = {}
    for i = 1, filled do
        out[i] = { text = slots[i].shownText, sender = slots[i].sender }
    end
    return out
end

function Markers:Active()
    return active
end

-- Hides and empties the display; it stays armed for the rest of the pull.
function Markers:Clear()
    token = token + 1
    if frame then
        clearSlots()
        if not previewOn then
            frame:Hide()
        end
    end
end

local function clearAfter(seconds)
    if not seconds or seconds <= 0 then
        return
    end
    local mine = token
    C_Timer.After(seconds, function()
        if mine == token then
            Markers:Clear()
        end
    end)
end

-- A chat message while a display is armed: a marker fills the next slot (see the top of the file).
local function onMessage(text, sender)
    if not active or filled >= active.slots then
        return
    end
    local shown = slotText(text, active.hidden)
    if not shown then -- a test, not a comparison: shown may be secret
        return
    end
    build()
    filled = filled + 1
    token = token + 1
    local c = slot(filled)
    -- The text may be secret; putting it on screen is allowed, and pcall keeps a refusal harmless.
    pcall(c.icon.SetText, c.icon, shown)
    c.shownText, c.sender = shown, sender
    if readable(sender) and type(sender) == "string" then
        local short = Ambiguate(sender, "short")
        c.name:SetText(short)
        local key = CRT.Groups and CRT.Groups.Normalize(sender)
        if key and CRT.Groups.ClassColor then
            c.name:SetTextColor(CRT.Groups.ClassColor(key))
        end
    else
        pcall(c.name.SetText, c.name, sender or "")
        c.name:SetTextColor(1, 1, 1)
    end
    if not frame:IsShown() then
        layout(active)
        frame:Show()
    end
    clearAfter(active.clearGap)
    if filled >= active.slots then
        clearAfter(active.clearFull)
    end
end

-- Arms a display for the pull. def is a display's settings; nil disarms.
function Markers:Arm(encounterID, def, test)
    self:Clear()
    lastPhase = nil
    testing = test and true or false
    if not def then
        active = nil
        return
    end
    build()
    active = settings(def)
    active.encounterID = encounterID
    layout(active)
end

-- The dev editor's Test: arms a display outside a pull, also listening to /say, until stopped.
function Markers:Test(def)
    if def then
        self:Arm(nil, def, true)
        CRT:Print("Marker display test: send markers in /say, party or raid chat, such as {rt3}. Stop it in the dev editor.")
    else
        self:Arm(nil, nil)
        CRT:Print("Marker display test stopped.")
    end
end

function Markers:Testing()
    return testing
end

-- Previews: the window with sample markers, to place it.
UI:RegisterPreview("markers", function(on)
    previewOn = on and true or false
    build()
    handle:SetShown(previewOn)
    if previewOn then
        local s = active or settings(nil)
        layout(s)
        clearSlots()
        local api = C_ChatInfo and C_ChatInfo.ReplaceIconAndGroupExpressions
        for i = 1, s.slots do
            local c = slot(i)
            c.icon:SetText(api and api(SAMPLE[i]) or SAMPLE[i])
            c.name:SetText(UnitName("player") or "Name")
            c.name:SetTextColor(1, 1, 1)
        end
        frame:Show()
    else
        clearSlots()
        if filled == 0 then
            frame:Hide()
        end
    end
end)

local events = CreateFrame("Frame")
events:RegisterEvent("ENCOUNTER_START")
events:RegisterEvent("ENCOUNTER_END")
events:RegisterEvent("CHAT_MSG_SAY")
for _, e in ipairs(CHAT_EVENTS) do
    events:RegisterEvent(e)
end
events:SetScript("OnEvent", function(_, event, a1, a2)
    if not CRT.db then
        return
    end
    if event == "ENCOUNTER_START" then
        -- A new pull: always starts empty, armed with this boss's display when it has one turned on.
        local id = readable(a1) and a1 or nil
        local def = Markers:For(id)
        Markers:Arm(id, (def and Markers:Enabled(id)) and def or nil)
    elseif event == "ENCOUNTER_END" then
        -- Kill or wipe: always cleared.
        Markers:Arm(nil, nil)
    elseif event == "CHAT_MSG_SAY" then
        if testing then
            onMessage(a1, a2)
        end
    else
        onMessage(a1, a2)
    end
end)

-- A new phase clears it, for a display that says so.
local function watchPhases()
    if not CRT.Alerts then
        return
    end
    CRT.Alerts:OnChange(function()
        if not active or not active.clearPhase then
            return
        end
        local ph = CRT.Alerts:CurrentPhase()
        if ph ~= lastPhase then
            if lastPhase ~= nil then
                Markers:Clear()
            end
            lastPhase = ph
        end
    end)
end

local login = CreateFrame("Frame")
login:RegisterEvent("PLAYER_LOGIN")
login:SetScript("OnEvent", watchPhases)
