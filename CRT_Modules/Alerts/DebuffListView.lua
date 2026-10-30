local ADDON, CRT = ...

-- The debuff list display (Alerts/DebuffList.lua finds who has the debuff): one frame per debuffList entry of a loaded
-- boss, made at PLAYER_LOGIN. Each is a placement element (UI.Placement.Define, key View.Key) and a preview
-- (UI:RegisterPreview, the same key, "debufflist-<encounterID>-<key>"): the Looks tab's Preview <label> and Raid Notes
-- > Alert Settings' Preview alerts show it with sample names and its drag box; Test shows the samples for a few seconds.
--
-- On screen: a column per side, side by side, each with its heading ("Left: groups 1, 3") and one bar per player in
-- the side's colours (data from the boss file, or yours): a bright bar has the debuff, a dim one doesn't. Your own bar
-- has an edge in the theme's heading colour (the game's gold in Default: Blizzard). The font is CRT's. Nothing shows
-- when there is no row (nobody has it and Show every player is off, or the game hides the debuff).
--
-- When it runs: the entry ticked (Alert me), its boss engaged (ENCOUNTER_START to ENCOUNTER_END) on a difficulty it is
-- for, and you in a group. UNIT_AURA and GROUP_ROSTER_UPDATE are registered only while a list of the engaged boss is
-- ticked and for this difficulty (wanted), checked again on every look or alert change, so ticking or unticking one
-- mid-pull starts or stops them. A /reload mid-pull picks the pull up again (alerts.debuffPull and
-- C_InstanceEncounter.IsEncounterInProgress). Work once, draw often: the roster
-- is read again only after GROUP_ROSTER_UPDATE, a unit's aura only after its UNIT_AURA (every unit when the event's
-- unit is hidden), and all of it at most once a frame (one OnUpdate that removes itself).
-- Game calls (warcraft.wiki.gg, read 2026-10-30): ENCOUNTER_START (encounterID, encounterName, difficultyID,
-- groupSize), ENCOUNTER_END, UNIT_AURA (unitTarget, updateInfo; fully secret while auras are secret, 12.1.0),
-- GROUP_ROSTER_UPDATE, Region:SetVertexColorFromBoolean(value, colorIfTrue, colorIfFalse) (12.0.0, AllowedWhenTainted)
-- with CreateColor(r, g, b, a) (Blizzard_SharedXMLBase/Color.lua, live), C_Timer.NewTimer.

local View = { displays = {}, order = {} }
CRT.AlertDebuffListView = View

local UI = CRT.UI
local DL = CRT.AlertDebuffList

-- Every word on screen, in one place. Keep the keys, change the text in quotes, save, /reload.
local TEXT = {
    title = "%s list",
    drag = "%s: drag to move",
    sample = "Player %d",
}
View.TEXT = TEXT

local L = {
    HEAD_H = 18, -- a side's heading over its bars
    COL_GAP = 12, -- between two sides
    ROW_GAP = 2, -- between two bars
    NAME_PAD = 6, -- the name's inset in its bar
    EDGE = 2, -- your bar's edge
    SAMPLES = 3, -- sample players per side in Preview and Test
    TEST_SECONDS = 10,
    DEFAULT_X = -460, DEFAULT_Y = 200, -- its top left, from the screen's middle, until it is moved
}
View.L = L

local WHITE = "Interface\\Buttons\\WHITE8X8"

local function Special()
    return CRT.AlertSpecial
end

local isSecret = DL.IsSecret

function View.Key(enc, key)
    return "debufflist-" .. tostring(enc) .. "-" .. tostring(key)
end

-- Every display's preview key, in the order they were made (Raid Notes > Alert Settings' Preview alerts takes them).
function View.PreviewKeys()
    local out = {}
    for i, k in ipairs(View.order) do
        out[i] = k
    end
    return out
end

-- The pull --------------------------------------------------------------------------------------------

local engaged -- { enc, group } from ENCOUNTER_START to ENCOUNTER_END
local roster, rosterDirty = {}, true
local states = {} -- spellID -> unit -> { state, raw }, read once per UNIT_AURA
local private = {} -- spellID -> DL.IsPrivate's answer, asked once a pull
local failed = {} -- spellID -> true when the bars refused the game's secret this pull: nothing usable

local function groupOf(difficultyID)
    local T = CRT.Timeline
    if T and T.DifficultyGroup then
        return T.DifficultyGroup(difficultyID)
    end
    return difficultyID == 16 and "mythic" or "nh"
end

local function inGroup()
    local ok, v = pcall(IsInGroup)
    return ok and not isSecret(v) and v == true
end

-- Whether a display runs for real now (Preview and Test aside).
local function active(d, entry)
    if not (engaged and engaged.enc == d.enc) then
        return false
    end
    if entry.difficulty ~= nil and entry.difficulty ~= engaged.group then
        return false
    end
    return Special():Choices(d.enc, entry).on and inGroup()
end

-- A cached reader of one debuff's unit states.
local function reader(spellID)
    states[spellID] = states[spellID] or {}
    local cache = states[spellID]
    return function(unit)
        local st = cache[unit]
        if not st then
            local state, raw = DL.ReadUnit(unit, spellID)
            st = { state = state, raw = raw }
            cache[unit] = st
        end
        return st.state, st.raw
    end
end

-- The sample list for Preview and Test: SAMPLES players a side, numbered across the sides, every other one with the
-- debuff; the first is you.
function View.Sample(look)
    local view = { tier = "readable", any = true, showAll = true, sides = {} }
    local n = 0
    for i, side in ipairs(look.sides) do
        local rows = {}
        for j = 1, L.SAMPLES do
            n = n + 1
            rows[j] = { name = string.format(TEXT.sample, n), unit = "sample" .. n, role = "NONE", isMe = i == 1 and j == 1,
                state = j % 2 == 1 and "on" or "off" }
        end
        view.sides[i] = { key = side.key, label = side.label, groups = side.groups, rows = rows }
    end
    return view
end

-- Drawing ------------------------------------------------------------------------------------------

local function newBar(d)
    local b = CreateFrame("Frame", nil, d.frame)
    b.fill = b:CreateTexture(nil, "BACKGROUND")
    b.fill:SetAllPoints()
    b.fill:SetColorTexture(1, 1, 1, 1) -- white, coloured by SetVertexColor (not a theme colour: the side's colour tints it)
    b.name = b:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    b.name:SetPoint("LEFT", L.NAME_PAD, 0)
    b.name:SetPoint("RIGHT", -L.NAME_PAD, 0)
    b.name:SetJustifyH("LEFT")
    b.name:SetWordWrap(false)
    UI.Tint(b.name, "SetTextColor", "text")
    b.edge = CreateFrame("Frame", nil, b, "BackdropTemplate")
    b.edge:SetAllPoints()
    if b.edge.SetBackdrop then
        b.edge:SetBackdrop({ edgeFile = WHITE, edgeSize = L.EDGE })
    end
    UI.Tint(b.edge, "SetBackdropBorderColor", "heading")
    b.edge:Hide()
    return b
end

local function bar(d, s, j)
    d.bars[s] = d.bars[s] or {}
    local b = d.bars[s][j]
    if not b then
        b = newBar(d)
        d.bars[s][j] = b
    end
    return b
end

local function heading(d, s)
    local h = d.heads[s]
    if not h then
        h = d.frame:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        h:SetJustifyH("LEFT")
        h:SetWordWrap(false)
        UI.Tint(h, "SetTextColor", "heading")
        d.heads[s] = h
    end
    return h
end

local function color(c)
    return CreateColor(c[1], c[2], c[3], 1)
end

-- Colours one bar: on or off from a readable state; a secret straight into SetVertexColorFromBoolean, never tested.
-- Returns false when the game refused it.
function View.Paint(b, row, colors)
    if row.state == "secret" then
        if not (b.fill.SetVertexColorFromBoolean and CreateColor) then
            return false
        end
        return (pcall(b.fill.SetVertexColorFromBoolean, b.fill, row.raw, color(colors.on), color(colors.off)))
    end
    local c = row.state == "on" and colors.on or colors.off
    b.fill:SetVertexColor(c[1], c[2], c[3], 1)
    return true
end

-- Draws a view (DL.Build's shape, or View.Sample) in the look's sizes. Returns false when a bar refused a secret.
local function draw(d, view, look)
    local x, rows, ok = 0, 1, true
    local w, h = look.barWidth, look.barHeight
    for s, side in ipairs(view.sides) do
        local head = heading(d, s)
        head:ClearAllPoints()
        head:SetPoint("TOPLEFT", x, 0)
        head:SetWidth(w)
        head:SetText(DL.Heading(side))
        head:Show()
        local colors = look.colors[side.key]
        for j, row in ipairs(side.rows) do
            local b = bar(d, s, j)
            b:ClearAllPoints()
            b:SetPoint("TOPLEFT", x, -(L.HEAD_H + (j - 1) * (h + L.ROW_GAP)))
            b:SetSize(w, h)
            ok = View.Paint(b, row, colors) and ok
            b.name:SetText(row.name)
            b.edge:SetShown(row.isMe and true or false)
            b:Show()
        end
        for j = #side.rows + 1, #(d.bars[s] or {}) do
            d.bars[s][j]:Hide()
        end
        rows = math.max(rows, #side.rows)
        x = x + w + L.COL_GAP
    end
    for s = #view.sides + 1, math.max(#d.heads, #d.bars) do
        if d.heads[s] then
            d.heads[s]:Hide()
        end
        for _, b in ipairs(d.bars[s] or {}) do
            b:Hide()
        end
    end
    d.frame:SetSize(math.max(w, x - L.COL_GAP), L.HEAD_H + rows * (h + L.ROW_GAP))
    return ok
end
View.Draw = draw

-- Whether a view has any row to show.
local function anyRow(view)
    for _, side in ipairs(view.sides) do
        if #side.rows > 0 then
            return true
        end
    end
    return false
end

-- The display -----------------------------------------------------------------------------------------

local function build(d)
    if d.frame then
        return
    end
    View.serial = (View.serial or 0) + 1
    local f = UI.Window("CowfeeRaidToolsDebuffList" .. View.serial, { kind = "overlay", layer = "alertbars", width = 200, height = 60 })
    d.frame, d.heads, d.bars = f, {}, {}
    local handle = CreateFrame("Frame", nil, f, "BackdropTemplate")
    handle:SetHeight(20)
    if handle.SetBackdrop then
        handle:SetBackdrop({ bgFile = WHITE, edgeFile = WHITE, edgeSize = 1 })
    end
    -- the drag box's Classic colours, as the other drag boxes (Interrupts/Reminder.lua)
    UI:RegisterThemed(handle, { bg = { 0.3, 0.25, 0.05, 0.9 }, border = { 0.78, 0.63, 0.31 } })
    local text = handle:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    text:SetPoint("LEFT", 6, 0)
    text:SetText(string.format(TEXT.drag, d.label))
    local reset = UI.ResetButton(handle, function()
        d.placement:Reset()
    end)
    reset:SetPoint("RIGHT", -2, 0)
    UI.Placement.FitHandle(handle, f, text)
    handle:Hide()
    d.handle = handle
    d.placement:Attach(f, handle, { reset = reset })
end

-- Shows what a display should now: Preview or Test samples, the live list, or nothing.
function View:Update(d)
    local S = Special()
    local entry = S and S:Get(d.enc, d.key)
    if not (entry and S.IsDebuffList(entry)) then
        if d.frame then
            d.frame:Hide()
        end
        return
    end
    local look = DL:Look(d.enc, entry)
    if d.previewing or d.testing then
        build(d)
        draw(d, View.Sample(look), look)
        d.handle:SetShown(d.previewing and true or false)
        d.frame:Show()
        return
    end
    if d.handle then
        d.handle:Hide()
    end
    local spellID = entry.spellID
    local view = active(d, entry) and not failed[spellID]
        and DL.Build(look, spellID, roster, reader(spellID), private[spellID], DL:Confirmed(d.enc, spellID))
    if view and (view.tier ~= "readable" or view.any) then
        DL:SetSeen(d.enc, spellID, view.tier, view.any) -- readable only once someone was seen with it
    end
    if not (view and anyRow(view)) then
        if d.frame then
            d.frame:Hide()
        end
        return
    end
    build(d)
    if not draw(d, view, look) then
        -- the game gave a secret the bars can't take: nothing usable, so nothing is shown this pull
        failed[spellID] = true
        DL:SetSeen(d.enc, spellID, "unreadable")
        d.frame:Hide()
        return
    end
    d.frame:Show()
end

local function make(enc, entry)
    local key = View.Key(enc, entry.key)
    local d = { enc = enc, key = entry.key, label = entry.label, previewKey = key }
    d.placement = UI.Placement.Define(key, {
        title = string.format(TEXT.title, entry.label),
        store = function()
            return DL:Store(enc, entry.key, true)
        end,
        -- held by its top left: it grows down and right as players come
        default = { point = "TOPLEFT", relativePoint = "CENTER", x = L.DEFAULT_X, y = L.DEFAULT_Y },
        point = "TOPLEFT",
        build = function()
            build(d)
        end,
    })
    View.displays[key] = d
    View.order[#View.order + 1] = key
    UI:RegisterPreview(key, function(on)
        d.previewing = on and true or false
        View:Update(d)
    end)
    return d
end

-- Makes a display for every debuff list of the loaded bosses (again: only the new ones).
function View:Register()
    local B = CRT.Bosses
    if not (B and B.List) then
        return
    end
    for _, def in ipairs(B:List()) do
        for _, entry in ipairs(DL.Entries(def.encounterID)) do
            if not self.displays[View.Key(def.encounterID, entry.key)] then
                make(def.encounterID, entry)
            end
        end
    end
end

function View:UpdateAll()
    for _, k in ipairs(self.order) do
        self:Update(self.displays[k])
    end
end

-- Test: the samples for TEST_SECONDS, without the drag box. A second Test while it shows stops it. Returns whether it
-- now shows.
function View:Test(enc, entry)
    self:Register()
    local d = self.displays[View.Key(enc, entry.key)]
    if not d then
        return false
    end
    if d.timer then
        d.timer:Cancel()
        d.timer = nil
    end
    d.testing = not d.testing
    if d.testing then
        d.timer = C_Timer.NewTimer(L.TEST_SECONDS, function()
            d.timer, d.testing = nil, false
            View:Update(d)
        end)
    end
    self:Update(d)
    return d.testing
end

function View:Testing(enc, key)
    local d = self.displays[View.Key(enc, key)]
    return d ~= nil and d.testing == true
end

-- Events ------------------------------------------------------------------------------------------------

local events = CreateFrame("Frame")
local dirty = {} -- unit -> true: read its auras again
local allDirty = false
local DURING = { "UNIT_AURA", "GROUP_ROSTER_UPDATE" }

local function flush()
    events:SetScript("OnUpdate", nil)
    if rosterDirty then
        roster = DL.Roster()
        rosterDirty = false
        allDirty = true
    end
    for _, cache in pairs(states) do
        if allDirty then
            for unit in pairs(cache) do
                cache[unit] = nil
            end
        else
            for unit in pairs(dirty) do
                cache[unit] = nil
            end
        end
    end
    dirty, allDirty = {}, false
    View:UpdateAll()
end
View.Flush = flush

-- One redraw on the next frame, however many events come before it.
local function schedule()
    events:SetScript("OnUpdate", flush)
end
View.Schedule = schedule

local function groupUnit(unit)
    return unit == "player" or unit:match("^raid%d+$") ~= nil or unit:match("^party%d$") ~= nil
end

-- Whether a boss has a debuff list: only then does a pull of it count.
local function hasList(enc)
    for _, k in ipairs(View.order) do
        if View.displays[k].enc == enc then
            return true
        end
    end
    return false
end

-- Whether some debuff list of the engaged boss is ticked and for this difficulty: only then are UNIT_AURA and
-- GROUP_ROSTER_UPDATE registered.
local function wanted()
    if not engaged then
        return false
    end
    local S = Special()
    for _, entry in ipairs(DL.Entries(engaged.enc)) do
        if (entry.difficulty == nil or entry.difficulty == engaged.group) and S:Choices(engaged.enc, entry).on then
            return true
        end
    end
    return false
end

local listening = false

-- Registers the pull's events while wanted() and drops them when not, then redraws. Starting afresh reads the roster
-- and every unit again, since nothing was heard meanwhile.
local function relisten()
    local want = wanted()
    if want ~= listening then
        listening = want
        for _, e in ipairs(DURING) do
            if want then
                events:RegisterEvent(e)
            else
                events:UnregisterEvent(e)
            end
        end
        if want then
            states, dirty, rosterDirty = {}, {}, true
        end
    end
    schedule()
end
View.Relisten = relisten

-- The pull being followed, kept through a /reload (alerts.debuffPull = { encounterID, difficultyID }), so a reload
-- mid-pull picks it up again while C_InstanceEncounter.IsEncounterInProgress says the encounter still runs.
local function pullStore()
    local s = CRT.db and CRT.db.alerts
    if type(s) ~= "table" then
        return nil
    end
    s.debuffPull = type(s.debuffPull) == "table" and s.debuffPull or {}
    return s.debuffPull
end

local function engage(enc, difficultyID)
    engaged = { enc = enc, group = groupOf(difficultyID) }
    states, private, failed, dirty = {}, {}, {}, {}
    for _, entry in ipairs(DL.Entries(enc)) do
        private[entry.spellID] = DL.IsPrivate(entry.spellID)
    end
    rosterDirty = true
    local p = pullStore()
    if p then
        p.encounterID, p.difficultyID = enc, difficultyID
    end
    relisten()
end

local function encounterRuns()
    local fn = C_InstanceEncounter and C_InstanceEncounter.IsEncounterInProgress
    if type(fn) ~= "function" then
        return false
    end
    local ok, on = pcall(fn)
    return ok and not isSecret(on) and on == true
end

function View.HandleEvent(event, a1, a2, a3)
    if event == "PLAYER_LOGIN" then
        View:Register()
        local p = CRT.db and pullStore()
        if p and type(p.encounterID) == "number" and hasList(p.encounterID) and encounterRuns() then
            engage(p.encounterID, p.difficultyID) -- a /reload mid-pull
        elseif p then
            p.encounterID, p.difficultyID = nil, nil
        end
        return
    end
    if not CRT.db then
        return
    end
    if event == "ENCOUNTER_START" then
        if isSecret(a1) or type(a1) ~= "number" or not hasList(a1) then
            return
        end
        engage(a1, not isSecret(a3) and type(a3) == "number" and a3 or nil)
    elseif event == "ENCOUNTER_END" then
        if engaged then
            engaged = nil
            local p = pullStore()
            if p then
                p.encounterID, p.difficultyID = nil, nil
            end
            relisten()
        end
    elseif event == "GROUP_ROSTER_UPDATE" then
        rosterDirty = true
        schedule()
    elseif event == "UNIT_AURA" then
        if isSecret(a1) then
            allDirty = true -- the event's unit is hidden: any of the group's could have changed
        elseif type(a1) == "string" and groupUnit(a1) then
            dirty[a1] = true
        else
            return
        end
        schedule()
    end
end

events:RegisterEvent("PLAYER_LOGIN")
events:RegisterEvent("ENCOUNTER_START")
events:RegisterEvent("ENCOUNTER_END")
events:SetScript("OnEvent", function(_, event, ...)
    View.HandleEvent(event, ...)
end)

-- A look changed, an entry was ticked or unticked (mid-pull too): listen or stop, and redraw on the next frame.
DL:OnChange(relisten)
if CRT.Alerts and CRT.Alerts.OnChange then
    CRT.Alerts:OnChange(relisten)
end
