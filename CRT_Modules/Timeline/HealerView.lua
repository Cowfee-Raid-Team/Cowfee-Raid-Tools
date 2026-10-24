local ADDON, CRT = ...

-- Timeline: the Healer CDs view, the pop-out's other layout (the Abilities | Healer CDs toggle on its title
-- strip, Timeline/Page.lua). The timeline view (Timeline/View.lua) draws it in place of the ability rows
-- while view:SetMode("healers"), with the same axis, zoom, scroll, drag-zoom and Fit. Top to bottom:
--   Raid damage   the casts of the ability timeline's raid damage rows (type raid), icons only, on one row
--   each healer   a row with their name in class colour and their spec, then one row per major cooldown
--                 (the cooldown list's major entries for their spec, else for their class), then one per
--                 other listed cooldown the raid note gives them
-- The healers are the roster's players (Alerts/Roster.lua: the active Raid Groups layout, else the group)
-- whose role is healer: a role set by hand (Groups.HandRole) wins, else the game's role in the group; a
-- player whose role is unknown is left out. Anyone the raid note gives a listed cooldown gets rows too.
-- Your own spec is the game's; nobody else's is known, so they get every major cooldown of their class.
-- The casts are the raid note's cooldown lines for the boss and difficulty shown (the view's
-- NoteAndReminderMarks, which places its flags), each on the row of its player and spell, with a band for
-- the cooldown after it; a cast inside the cooldown of the one before it on its row gets a red edge.
-- Dragging a cast moves its note line (the view's flag move, so Undo works); a double-click on a cooldown
-- row places one there for that player (the view's PlaceCooldownAt, by the raid leader and assistant rules).
-- Built once per refresh (data, zoom, or a roster or role change: HV.Watch); scrolling only moves the track.

local HV = {}
CRT.TimelineHealerView = HV

local TEXT = {
    raid = "Raid damage",
    raidTip = "Raid-wide damage from the ability timeline: its rows of type Raid damage.",
    hint = "Drag a cast to move it \194\183 double-click a row to add a cast \194\183 red edge: cast while still on cooldown",
    noHealers = "No healers found. Right-click a name on Raid Groups and pick Set role > Healer.",
    classUnknown = "Class unknown until they are seen in a group once.",
    notLead = "Only the raid leader or an assistant can place a cooldown for another player.",
    healer = "Healer",
    healerHand = "Healer (set on Raid Groups)",
    assigned = "Has cooldowns in the raid note",
    cooldown = "Cooldown %d:%02d",
    addCast = "Double-click this row to add a cast.",
}
HV.TEXT = TEXT

local DOT = " \194\183 "
local BAND_ALPHA = 0.22 -- a cooldown's band after its cast, in the accent colour
local BAND_INSET = 4 -- the band's gap from its row's top and bottom
local BAND_LINE_W = 1 -- the line where the cooldown is up again
local SAME_MOMENT = 0.05 -- seconds: two casts this close are the same moment, not too soon
local UNNAMED_ICON = "Interface\\Icons\\INV_Misc_QuestionMark"
local GROUP_WORD = { "^g%d+$", "^group%d+$" } -- tag words that name a raid group, not a player

local function readable(v)
    local T = CRT.Timeline
    if T and T.readable then
        return T.readable(v)
    end
    return true
end

local function usable(v)
    return v ~= nil and readable(v) and type(v) == "string" and v ~= ""
end

local function list()
    local C = CRT.AlertCooldowns
    return (C and C.LIST) or CRT.AlertCooldownData or {}
end

local function spellName(id)
    local Reminders = CRT.AlertReminders
    local name = Reminders and Reminders.SpellName and Reminders.SpellName(id)
    if usable(name) then
        return name
    end
    if C_Spell and C_Spell.GetSpellName then
        local ok, n = pcall(C_Spell.GetSpellName, id)
        if ok and usable(n) then
            return n
        end
    end
    return nil
end

local function spellIcon(id)
    if not (C_Spell and C_Spell.GetSpellTexture and type(id) == "number" and id > 0) then
        return nil
    end
    local ok, tex = pcall(C_Spell.GetSpellTexture, id)
    if ok and tex ~= nil and readable(tex) and (type(tex) == "number" or type(tex) == "string") then
        return tex
    end
    return nil
end

local function rgba(key, alpha)
    local c = CRT.PALETTE and CRT.PALETTE[key] or { 1, 1, 1 }
    return c[1], c[2], c[3], alpha or 1
end

-- The cooldown data ---------------------------------------------------------------------------------

local function hasSpec(e, spec)
    if type(e.spec) == "table" then
        for _, s in ipairs(e.spec) do
            if s == spec then
                return true
            end
        end
        return false
    end
    return e.spec == spec
end

-- The major healing cooldowns of a class, in list order: those of spec (a SpecializationID) when given and
-- the class has some for it, else all of the class's.
function HV.Majors(class, spec)
    local out = {}
    for _, e in ipairs(list()) do
        if e.major and e.class == class and (spec == nil or hasSpec(e, spec)) then
            out[#out + 1] = e
        end
    end
    if spec ~= nil and #out == 0 then
        return HV.Majors(class, nil)
    end
    return out
end

-- The cooldown list's entry for spellID, or nil.
function HV.Listed(spellID)
    if type(spellID) ~= "number" then
        return nil
    end
    for _, e in ipairs(list()) do
        if e.spellID == spellID then
            return e
        end
    end
    return nil
end

local function lengthOf(e)
    if type(e.cd) == "number" and e.cd > 0 then
        return e.cd
    end
    local C = CRT.AlertCooldowns
    local ok, n = false, nil
    if C and C.Length then
        ok, n = pcall(C.Length, C, e.spellID)
    end
    return ok and type(n) == "number" and n > 0 and n or nil
end

-- The players -----------------------------------------------------------------------------------------

-- Your SpecializationID, when the game gives one.
local function playerSpec()
    local info = C_SpecializationInfo
    local getSpec = (info and info.GetSpecialization) or GetSpecialization
    local getInfo = (info and info.GetSpecializationInfo) or GetSpecializationInfo
    if not (getSpec and getInfo) then
        return nil
    end
    local ok, index = pcall(getSpec)
    if not (ok and readable(index) and type(index) == "number") then
        return nil
    end
    local ok2, id = pcall(getInfo, index)
    if ok2 and readable(id) and type(id) == "number" then
        return id
    end
    return nil
end

-- A spec's name as the game gives it, or nil.
local function specName(spec)
    if type(spec) ~= "number" or not GetSpecializationInfoByID then
        return nil
    end
    local ok, _, name = pcall(GetSpecializationInfoByID, spec)
    return ok and usable(name) and name or nil
end

-- Your own key ("Name-Realm", lower case), or nil.
local function selfKey()
    local Groups = CRT.Groups
    if not (Groups and Groups.Normalize and UnitName) then
        return nil
    end
    local ok, name = pcall(UnitName, "player")
    if not (ok and usable(name)) then
        return nil
    end
    local key = Groups.Normalize(name)
    return key ~= "" and key:lower() or nil
end

-- The roster's players (AlertRoster:Players) with their role: { key, name, class, role, hand, spec, me }.
-- role is the role set by hand, else the game's role while they are in the group, else nil; hand says it
-- was set by hand. spec is known for you only.
function HV.Players()
    local Roster, Groups = CRT.AlertRoster, CRT.Groups
    local live = {}
    if Groups and Groups.ReadRoster then
        local ok, got = pcall(Groups.ReadRoster, Groups)
        if ok and type(got) == "table" then
            live = got
        end
    end
    -- the live group read once, for the roster and the roles
    local players = Roster and Roster:Players(live) or {}
    local lookup = Groups and Groups.MakeLookup and Groups.MakeLookup(live)
    local me = selfKey()
    local out = {}
    for _, p in ipairs(players) do
        local entry = lookup and lookup(p.key)
        local hand = Groups and Groups.HandRole and Groups.HandRole(p.key) or nil
        local game = entry and usable(entry.role) and entry.role or nil
        local q = { key = p.key, name = p.name, class = p.class, role = hand or game, hand = hand ~= nil }
        if me and p.key:lower() == me then
            q.me, q.spec = true, playerSpec()
        end
        out[#out + 1] = q
    end
    return out
end

-- tag -> the roster player it names (by name, key, or a name without its realm when only one has it).
local function nameIndex(players)
    local byName, byBase = {}, {}
    for _, p in ipairs(players) do
        local key = p.key:lower()
        byName[key] = p
        byName[p.name:lower()] = p
        local base = key:match("^[^-]+") or key
        if byBase[base] == nil then
            byBase[base] = p
        else
            byBase[base] = false
        end
    end
    return function(tag)
        local l = tag:lower()
        return byName[l] or byBase[l:match("^[^-]+") or l] or nil
    end
end

-- The class names as tag words (the list's tokens and the game's names, spaces taken out, lower case).
local function classWords()
    local words = {}
    for _, e in ipairs(list()) do
        words[e.class:lower()] = true
    end
    local names = LOCALIZED_CLASS_NAMES_MALE
    if type(names) == "table" then
        for token, name in pairs(names) do
            words[tostring(token):lower()] = true
            if usable(name) then
                words[(name:gsub("%s+", "")):lower()] = true
            end
        end
    end
    return words
end

-- Whether a note line's tag word can be a player's name: not a role or raid word, a class, or a group.
local function nameWord(tag, classes)
    if not usable(tag) or not tag:match("^[%a\128-\255]") then
        return false
    end
    local l = tag:lower()
    local Parser = CRT.NoteParser
    if (Parser and Parser.TAG_WORDS and Parser.TAG_WORDS[l]) or classes[l] then
        return false
    end
    for _, pattern in ipairs(GROUP_WORD) do
        if l:match(pattern) then
            return false
        end
    end
    return true
end

-- The lanes ------------------------------------------------------------------------------------------

local function hasType(types, key)
    for _, t in ipairs(types or {}) do
        if t == key then
            return true
        end
    end
    return false
end

local function tooltipOwner(owner)
    CRT.UI.TooltipOwner(GameTooltip, owner, "ANCHOR_RIGHT", nil, nil, "timeline")
end

local function raidTip(l)
    tooltipOwner(l)
    GameTooltip:SetText(TEXT.raid, 1, 1, 1)
    GameTooltip:AddLine(TEXT.raidTip, 0.85, 0.85, 0.85, true)
    GameTooltip:Show()
end

-- The Raid damage row: every cast of the ability rows of type raid, by time. Each keeps its own row
-- (source) for its tooltip and its icon.
local function raidLane(lanes)
    local marks = {}
    for _, lane in ipairs(lanes or {}) do
        if (lane.kind == "reference" or lane.kind == "spell") and hasType(lane.types, "raid") then
            local icon = lane.icon or spellIcon(lane.spellID) or UNNAMED_ICON
            for _, m in ipairs(lane.marks or {}) do
                if type(m.t) == "number" then
                    marks[#marks + 1] = { t = m.t, dur = m.dur, spellID = m.spellID or lane.spellID, icon = icon, source = lane, age = m.age }
                end
            end
        end
    end
    table.sort(marks, function(a, b)
        return a.t < b.t
    end)
    local Reference = CRT.TimelineReference
    local raid = Reference and Reference.TYPES and Reference.TYPES.raid
    return { key = "healers:raid", kind = "raid", label = TEXT.raid, color = raid and raid.color, marks = marks, tip = raidTip }
end

local function headerTip(who)
    return function(l)
        local p = who.p
        tooltipOwner(l)
        GameTooltip:SetText(p.name, CRT.Groups.ClassColor(p.key, who.class))
        local line = p.role == "HEALER" and (p.hand and TEXT.healerHand or TEXT.healer) or TEXT.assigned
        GameTooltip:AddLine(line, 0.85, 0.85, 0.85, true)
        if #who.rows == 0 then
            GameTooltip:AddLine(TEXT.classUnknown, 0.85, 0.85, 0.85, true)
        end
        GameTooltip:Show()
    end
end

local function cooldownTip(r)
    return function(l)
        local lines = {}
        if r.cd then
            local secs = math.floor(r.cd + 0.5)
            lines[1] = { string.format(TEXT.cooldown, math.floor(secs / 60), secs % 60), 1, 1, 1 }
        end
        lines[#lines + 1] = { TEXT.addCast, 0.85, 0.85, 0.85 }
        CRT.AbilityTip:Show(GameTooltip, l, "timeline", { spellID = r.spellID, name = r.label, lines = lines })
    end
end

local function copy(m)
    local c = {}
    for k, v in pairs(m) do
        c[k] = v
    end
    return c
end

-- The view's lanes and flags for Healer CDs, from lanes (the ability timeline's, as the view built them)
-- and the boss's note lines and reminders up to length seconds. Returns the lanes (Raid damage, then each
-- player's header and cooldown rows) and the marks drawn as flags: a note line once on each row it is for
-- (row set, cd its spell's length, tooSoon when cast inside the cooldown of the one before it on its row).
-- Lines for no listed cooldown or no player are not drawn. Your own reminders go on your own rows.
function HV.Build(view, lanes, length)
    local marks = view:NoteAndReminderMarks({}, length)
    local players = HV.Players()
    local find, classes = nameIndex(players), classWords()
    local people, byKey, me = {}, {}, nil
    local function person(p, class)
        local k = p.key:lower()
        local who = byKey[k]
        if not who then
            who = { p = p, class = p.class or class, rows = {}, bySpell = {} }
            byKey[k] = who
            people[#people + 1] = who
        end
        return who
    end
    local function row(who, e)
        local r = who.bySpell[e.spellID]
        if not r then
            local name = spellName(e.spellID)
            if not name then
                return nil -- a spell the game no longer knows
            end
            r = { key = "healers:" .. who.p.key:lower() .. ":" .. e.spellID, kind = "healercd", label = name,
                icon = spellIcon(e.spellID) or UNNAMED_ICON, spellID = e.spellID, player = who.p, entry = e,
                cd = lengthOf(e), marks = {}, casts = {} }
            r.tip = cooldownTip(r)
            who.bySpell[e.spellID] = r
            who.rows[#who.rows + 1] = r
        end
        return r
    end
    for _, p in ipairs(players) do
        if p.me then
            me = p.key:lower()
        end
        if p.role == "HEALER" then
            local who = person(p)
            if usable(p.class) then
                for _, e in ipairs(HV.Majors(p.class, p.spec)) do
                    row(who, e)
                end
            else
                who.unknownClass = true -- set as healer by hand, never seen in a group: their name row and a hint
            end
        end
    end
    local shown = {}
    local function put(m, r)
        local c = copy(m)
        r.casts[#r.casts + 1] = c
        shown[#shown + 1] = c
        c.hvLane = r
    end
    for _, m in ipairs(marks) do
        local e = HV.Listed(m.spellID)
        if e and m.kind == "note" then
            local seen = {}
            for _, tag in ipairs(m.tags or {}) do
                local p = usable(tag) and find(tag) or nil
                if not p and nameWord(tag, classes) then
                    p = { key = tag, name = tag } -- named in the note, not on the roster
                end
                if p and not seen[p.key:lower()] then
                    seen[p.key:lower()] = true
                    local r = row(person(p, e.class), e)
                    if r then
                        put(m, r)
                    end
                end
            end
        elseif e and m.kind == "mine" then
            local who = me and byKey[me]
            local r = who and who.bySpell[e.spellID]
            if r then
                put(m, r)
            end
        end
    end
    local out = { raidLane(lanes) }
    for _, who in ipairs(people) do
        if #who.rows > 0 or who.unknownClass then
            local p = who.p
            local spec = specName(p.spec)
            out[#out + 1] = { key = "healers:" .. p.key:lower(), kind = "healer", label = p.name .. (spec and (DOT .. spec) or ""),
                class = who.class, marks = {}, tip = headerTip(who), note = #who.rows == 0 and TEXT.classUnknown or nil }
            for _, r in ipairs(who.rows) do
                out[#out + 1] = r
                r.row = #out
            end
        end
    end
    -- each row's casts by time: a cast inside the cooldown of the one before it is too soon
    for _, who in ipairs(people) do
        for _, r in ipairs(who.rows) do
            table.sort(r.casts, function(a, b)
                return a.t < b.t
            end)
            local prev
            for _, c in ipairs(r.casts) do
                c.row, c.cd, c.tooSoon = r.row, r.cd, nil
                local gap = prev and c.t - prev.t
                if gap and r.cd and gap > SAME_MOMENT and gap < r.cd then
                    c.tooSoon = true
                end
                prev = c
            end
        end
    end
    view.hvEmpty = #out == 1
    return out, shown
end

-- Drawing --------------------------------------------------------------------------------------------

local function bandTexture(view, n)
    local pool = view.hvBands
    local tex = pool[n]
    if not tex then
        tex = view.hvBandFrame:CreateTexture(nil, "ARTWORK")
        pool[n] = tex
    end
    tex:Show()
    return tex
end

-- The cooldown bands of the shown casts (from each cast to when its cooldown is up, cut at the timeline's
-- end) and the hint line under the rows. Hides the bands outside Healer CDs.
function HV.Draw(view, length)
    local on = view.mode == "healers" and view.pull ~= nil
    local n = 0
    if on then
        if not view.hvBandFrame then
            local bf = CreateFrame("Frame", nil, view.track)
            bf:SetAllPoints(view.track)
            view.hvBandFrame, view.hvBands = bf, {}
        end
        -- under the flags (DrawMarks puts them 8 above the track) and the selection's bands (7)
        view.hvBandFrame:SetFrameLevel((view.track:GetFrameLevel() or 0) + 6)
        local View = CRT.TimelineView
        local rowH, trackW = View.ROW_H, view.trackW
        length = math.max(1, length or 1)
        local function x(t)
            return View.TimeToX(math.max(0, math.min(length, t)), length, trackW)
        end
        local r, g, b = rgba("accent")
        for _, m in ipairs(view.marks or {}) do
            if m.hvLane and m.cd and m.row then
                local x0, x1 = x(m.t), x(m.t + m.cd)
                local top = -(m.row - 1) * rowH - BAND_INSET
                if x1 - x0 > 0 then
                    n = n + 1
                    local band = bandTexture(view, n)
                    band:SetColorTexture(r, g, b, BAND_ALPHA)
                    band:ClearAllPoints()
                    band:SetPoint("TOPLEFT", view.track, "TOPLEFT", x0, top)
                    band:SetSize(x1 - x0, rowH - 2 * BAND_INSET)
                    if m.t + m.cd <= length then
                        n = n + 1
                        local line = bandTexture(view, n)
                        line:SetColorTexture(r, g, b, 1)
                        line:ClearAllPoints()
                        line:SetPoint("TOPLEFT", view.track, "TOPLEFT", x1 - BAND_LINE_W, top)
                        line:SetSize(BAND_LINE_W, rowH - 2 * BAND_INSET)
                    end
                end
            end
        end
        view.unknownText:SetText(view.hvEmpty and TEXT.noHealers or TEXT.hint)
    end
    for i = n + 1, #(view.hvBands or {}) do
        view.hvBands[i]:Hide()
    end
    -- a row's muted note on the track, at its start (a healer whose class isn't known yet)
    local notes, rowH = 0, CRT.TimelineView.ROW_H
    for i, lane in ipairs(on and view.lanes or {}) do
        if lane.note then
            notes = notes + 1
            view.hvNotes = view.hvNotes or {}
            local fs = view.hvNotes[notes]
            if not fs then
                fs = view.hvBandFrame:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
                view.hvNotes[notes] = fs
            end
            fs:SetTextColor(rgba(CRT.PALETTE and CRT.PALETTE.muted and "muted" or "label"))
            fs:SetText(lane.note)
            fs:ClearAllPoints()
            fs:SetPoint("LEFT", view.track, "TOPLEFT", 6, -(i - 1) * rowH - rowH / 2)
            fs:Show()
        end
    end
    for i = notes + 1, #(view.hvNotes or {}) do
        view.hvNotes[i]:Hide()
    end
end

-- Redrawing on a roster or role change ------------------------------------------------------------
-- A view in Healer CDs (view:SetMode watches it) is drawn again when a role is set by hand (Groups:OnChange)
-- or the group or its roles change (GROUP_ROSTER_UPDATE, PLAYER_ROLES_ASSIGNED), once per burst of changes
-- (REDRAW_DELAY), and only while it shows Healer CDs.
local REDRAW_DELAY = 0.2
local watched = setmetatable({}, { __mode = "k" })
local pending, hooked = false, false

local function redraw()
    pending = false
    for v in pairs(watched) do
        if v.mode == "healers" and v.pull and v.frame and v.frame:IsVisible() then
            local ok, err = pcall(v.Refresh, v)
            if not ok and geterrorhandler then
                geterrorhandler()(err)
            end
        end
    end
end

function HV.Changed()
    if pending then
        return
    end
    pending = true
    if C_Timer and C_Timer.After then
        C_Timer.After(REDRAW_DELAY, redraw)
    else
        redraw()
    end
end

function HV.Watch(view)
    watched[view] = true
    if hooked then
        return
    end
    hooked = true
    if CRT.Groups and CRT.Groups.OnChange then
        CRT.Groups:OnChange(HV.Changed)
    end
    local events = CreateFrame("Frame")
    events:RegisterEvent("GROUP_ROSTER_UPDATE")
    events:RegisterEvent("PLAYER_ROLES_ASSIGNED")
    events:SetScript("OnEvent", HV.Changed)
    HV.events = events
end

-- A double-click on a row of Healer CDs at t seconds: on a cooldown row, that cooldown is placed at once for
-- its player (a raid note line) by someone who may change the raid note. Anyone else places it only on their
-- own row, as one of their reminders (Only me); on another player's row nothing is placed and a chat line
-- says why. True when the click was this view's (a cooldown or a player's row).
function HV.DoubleClick(view, t, lane)
    if not lane then
        return false
    end
    if lane.kind == "healer" then
        return true
    end
    if lane.kind ~= "healercd" then
        return false
    end
    local e = { spellID = lane.spellID, name = lane.label, class = lane.entry and lane.entry.class }
    local Notes = CRT.Notes
    local raid = Notes and Notes.CanEditRaid and Notes:CanEditRaid()
    if raid then
        view:PlaceCooldownAt(t, e, lane.player.name)
    elseif lane.player.me then
        view:PlaceCooldownAt(t, e) -- your own row: one of your reminders, as a dropped cooldown
    else
        CRT:Print(TEXT.notLead)
    end
    return true
end
