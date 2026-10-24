local ADDON, CRT = ...

-- Timeline: the Healer CDs view, the pop-out's other layout (the Abilities | Healer CDs toggle on its title
-- strip, Timeline/Page.lua). The timeline view (Timeline/View.lua) draws it in place of the Abilities layout
-- while view:SetMode("healers"), with the same axis, zoom, scroll, drag-zoom and Fit. Top to bottom:
--   the ability rows  every row the Abilities layout shows, as it shows them (lanes, colours, types, phase
--                     lines, deaths, a picked pull's end line), and its Notes row with the lines no healer row
--                     takes; not its Personal notes row
--   each healer       a row with their name in class colour and their spec, then one row per major cooldown
--                     (the cooldown list's major entries for their spec, else for their class), then one per
--                     other listed cooldown the raid note gives them
--   the panel rows    your moved casts' bar and the raid lead's proposed changes (Timeline/HealerPanel.lua)
-- The healers are the roster's players (Alerts/Roster.lua: the active Raid Groups layout, else the group)
-- whose role is healer: a role set by hand (Groups.HandRole) wins, else the game's role in the group; a
-- player whose role is unknown is left out. Anyone the raid note gives a listed cooldown gets rows too.
-- Your own spec is the game's; nobody else's is known, so they get every major cooldown of their class.
-- The casts are the raid note's cooldown lines for the boss and difficulty shown (the view's
-- NoteAndReminderMarks, which places its flags), each on the row of its player and spell, with a band for
-- the cooldown after it; a cast inside the cooldown of the one before it on its row gets a red edge.
-- The raid leader and assistants drag any cast to move its note line (the view's flag move, so Undo works).
-- Anyone else drags only their own casts, and only for themselves: the new time is kept on this computer
-- (Notes/Shifts.lua, HV.MovePersonal), your alerts use it, and the raid note stays as it is. A moved cast
-- draws at your time, with the raid's time as a dashed ghost and "2:51 to 3:05" beside it. Other players'
-- casts don't move for them; their name rows say locked. A double-click on a cooldown row places one there
-- for that player (the view's PlaceCooldownAt, by the raid leader and assistant rules).
-- Built once per refresh (data, zoom, or a roster or role change: HV.Watch); scrolling only moves the track.

local HV = {}
CRT.TimelineHealerView = HV

local TEXT = {
    hint = "Drag a cast to move it \194\183 double-click a row to add a cast \194\183 red edge: cast while still on cooldown",
    -- for someone who may not change the raid note
    hintOwn = "Drag your own casts to move them for yourself \194\183 red edge: cast while still on cooldown",
    noHealers = "No healers found. Right-click a name on Raid Groups and pick Set role > Healer.",
    classUnknown = "Class unknown until they are seen in a group once.",
    notLead = "Only the raid leader or an assistant can place a cooldown for another player.",
    healer = "Healer",
    healerHand = "Healer (set on Raid Groups)",
    assigned = "Has cooldowns in the raid note",
    cooldown = "Cooldown %d:%02d",
    addCast = "Double-click this row to add a cast.",
    yours = "yours",
    locked = "locked",
    ownTip = "Your casts: drag one to move it for you. Your alerts use your time; the raid note stays as it is.",
    lockedTip = "Only %s, the raid leader or an assistant can move these.",
    lockedCast = "Only %s can move this, for themselves. The raid leader or an assistant can move it in the raid note.",
    ownCast = "Yours: drag it to move it for you.",
    raidTime = "Raid note time: %s",
    moved = "%s to %s", -- a moved cast's label: the raid's time, then yours
}
HV.TEXT = TEXT

local DOT = " \194\183 "
local BAND_ALPHA = 0.22 -- a cooldown's band after its cast, in its player's class colour (accent when unknown)
HV.INDENT = 16 -- how far a cooldown row's icon and name sit right of its healer's name row
local NAME_TINT, SPELL_TINT = 0.16, 0.12 -- a healer's block background alpha: the name row, the cooldown rows
local BAND_INSET = 4 -- the band's gap from its row's top and bottom
local BAND_LINE_W = 1 -- the line where the cooldown is up again
local SAME_MOMENT = 0.05 -- seconds: two casts this close are the same moment, not too soon
local GHOST_W, GHOST_ALPHA = 18, 0.25 -- a moved cast's ghost at the raid's time: a faint square where its icon was
local GHOST_DASH, GHOST_GAP = 4, 3 -- and a dashed pole down its row
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

-- The season's class cooldowns (CRT.Bosses:Cooldowns(), from its GameIDs.lua), or none.
local function list()
    local B = CRT.Bosses
    return (B and B:Cooldowns()) or {}
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

-- A class's colour as { r, g, b, alpha } for a healer's block, or nil for a class the game doesn't know.
-- These are the game's class colours, not theme colours: a class reads the same in every theme.
local function classTint(class, alpha)
    local c = usable(class) and RAID_CLASS_COLORS and RAID_CLASS_COLORS[class]
    return c and { c.r, c.g, c.b, alpha } or nil
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

local function tooltipOwner(owner)
    CRT.UI.TooltipOwner(GameTooltip, owner, "ANCHOR_RIGHT", nil, nil, "timeline")
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
        if who.marker == TEXT.yours then
            GameTooltip:AddLine(TEXT.ownTip, 0.85, 0.85, 0.85, true)
        elseif who.marker == TEXT.locked then
            GameTooltip:AddLine(string.format(TEXT.lockedTip, p.name), 0.85, 0.85, 0.85, true)
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

-- Whether you may change the raid note now (Notes:CanEditRaid: the raid leader or an assistant).
local function canEditRaid()
    local Notes = CRT.Notes
    return Notes and Notes.CanEditRaid and Notes:CanEditRaid() and true or false
end

-- Whether a note line is in one of your personal notes (yours to edit, never a raid note line).
local function personalNote(m)
    local record = CRT.Notes and CRT.Notes:Get(m.noteID)
    return record and record.personal and true or false
end

-- Who may move a raid note cast on Healer CDs: on your own rows it is yours (hvOwn: a drag keeps your own
-- time, HV.MovePersonal, unless you may change the raid note), drawn at your time when you moved it (moved,
-- with raidT the raid's time for its ghost); on anyone else's it is locked unless you may change the raid
-- note. Each gets its tooltip lines (tipLines, Timeline/View.lua's flag tooltip).
local function claim(view, r, c, lead, length)
    if c.kind ~= "note" or personalNote(c) then
        return
    end
    if not r.player.me then
        if not lead then
            c.hvLocked = true
            c.tipLines = { string.format(TEXT.lockedCast, r.player.name) }
        end
        return
    end
    c.hvOwn = true
    if not lead then
        c.tipLines = { TEXT.ownCast }
    end
    local Shifts, Reminders = CRT.NoteShifts, CRT.AlertReminders
    local s = Shifts and Shifts:Find(c.noteID, c.line)
    if s and s.raw ~= c.expected then
        s = nil
    end
    local t = s and Reminders.AbsoluteTime(view.pull and view.pull.reference, s.ph, s.t)
    if t then
        t = t + (c.shiftDelta or 0)
        if t >= 0 and t <= length then
            c.raidT, c.moved = c.t, s
            c.t, c.ph, c.time = t, s.ph, s.t
            c.tipLines = c.tipLines or {}
            c.tipLines[#c.tipLines + 1] = string.format(TEXT.raidTime, CRT.TimelineView.Format(c.raidT))
        end
    end
end

-- The view's lanes and flags for Healer CDs, from lanes (the ability rows, as the view built them for the
-- Abilities layout) and the boss's note lines and reminders up to length seconds. Returns the lanes (the
-- ability rows, then each player's header and cooldown rows, then the panel rows) and the marks drawn as
-- flags: a note line once on each row it is for (row set, cd its spell's length, tooSoon when cast inside the
-- cooldown of the one before it on its row); a line for a boss ability on its ability row, as Abilities draws
-- it. Lines for no listed cooldown or no player and no ability row are not drawn. Your own reminders go on your
-- own rows. view.hvNoteIds is the raid notes whose lines are drawn, for the panel.
function HV.Build(view, lanes, length)
    lanes = lanes or {}
    -- a copy for the marks to find their ability rows in (it may get a Notes row added, never drawn here)
    local rowsFor = {}
    for i, lane in ipairs(lanes) do
        rowsFor[i] = lane
    end
    local marks = view:NoteAndReminderMarks(rowsFor, length)
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
    -- the Notes row the Abilities layout adds for lines with no ability row, when it got one
    local notesRow = rowsFor[#lanes + 1] and rowsFor[#lanes + 1].kind == "notes" and #lanes + 1 or nil
    local shown, noteIds, seenNote, onNotes = {}, {}, {}, {}
    local function put(m, r)
        local c = copy(m)
        r.casts[#r.casts + 1] = c
        shown[#shown + 1] = c
        c.hvLane = r
    end
    for _, m in ipairs(marks) do
        local e = HV.Listed(m.spellID)
        if m.kind == "note" and m.noteID ~= nil and not seenNote[m.noteID] and not personalNote(m) then
            seenNote[m.noteID] = true
            noteIds[#noteIds + 1] = m.noteID
        end
        if not e and m.kind == "note" and m.row and m.row <= #lanes then
            shown[#shown + 1] = m -- a line for a boss ability: on its row, as Abilities draws it
        elseif not e and m.kind == "note" and notesRow and m.row == notesRow then
            onNotes[#onNotes + 1] = m
        elseif e and m.kind == "note" then
            local seen, placed = {}, false
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
                        placed = true
                    end
                end
            end
            if not placed and notesRow and m.row == notesRow then
                onNotes[#onNotes + 1] = m -- a cooldown line for no player: on the Notes row, as Abilities draws it
            end
        elseif e and m.kind == "mine" then
            local who = me and byKey[me]
            local r = who and who.bySpell[e.spellID]
            if r then
                put(m, r)
            end
        end
    end
    -- the ability rows as the Abilities layout shows them, then the healers
    local out = {}
    for _, lane in ipairs(lanes) do
        out[#out + 1] = lane
    end
    -- the Notes row, under the ability rows as in Abilities, with the lines no healer row took
    if #onNotes > 0 then
        out[#out + 1] = rowsFor[notesRow]
        for _, m in ipairs(onNotes) do
            m.row = #out
            shown[#shown + 1] = m
        end
    end
    local abilities = #out
    local lead = canEditRaid()
    for _, who in ipairs(people) do
        if #who.rows > 0 or who.unknownClass then
            local p = who.p
            local spec = specName(p.spec)
            -- yours or locked, for someone who may not change the raid note
            who.marker = not lead and (p.me and TEXT.yours or TEXT.locked) or nil
            local label = p.name .. (spec and (DOT .. spec) or "") .. (who.marker and (DOT .. who.marker) or "")
            out[#out + 1] = { key = "healers:" .. p.key:lower(), kind = "healer", label = label, class = who.class,
                marks = {}, tip = headerTip(who), note = #who.rows == 0 and TEXT.classUnknown or nil,
                tint = classTint(who.class, NAME_TINT) }
            for _, r in ipairs(who.rows) do
                r.indent, r.tint = HV.INDENT, classTint(who.class, SPELL_TINT) -- the view draws both
                out[#out + 1] = r
                r.row = #out
            end
        end
    end
    -- each row's casts (at your own time where you moved one) by time: a cast inside the cooldown of the one
    -- before it is too soon
    for _, who in ipairs(people) do
        for _, r in ipairs(who.rows) do
            for _, c in ipairs(r.casts) do
                claim(view, r, c, lead, length)
            end
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
    view.hvEmpty = #out == abilities
    view.hvNoteIds = noteIds
    local Panel = CRT.TimelineHealerPanel
    if Panel then
        Panel.Rows(view, out)
    end
    return out, shown
end

-- A dragged cast of yours let go at phase ph, seconds in, by someone who may not change the raid note: your
-- own time for that line (Notes/Shifts.lua), or back to the raid's when dropped on it. False when the line
-- changed since it was drawn.
function HV.MovePersonal(view, m, ph, seconds)
    local Notes, Shifts = CRT.Notes, CRT.NoteShifts
    local timer, raw = Notes:TimerAt(m.noteID, m.line)
    if not (Shifts and timer and m.expected ~= nil and raw == m.expected) then
        return false
    end
    if ph == timer.ph and seconds == timer.time then
        Shifts:Clear(m.noteID, m.line)
        return true
    end
    return Shifts:Set(m.noteID, m.line, ph, seconds, timer.spellId)
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

local function moveLabel(view, n)
    view.hvMoveLabels = view.hvMoveLabels or {}
    local fs = view.hvMoveLabels[n]
    if not fs then
        fs = view.hvBandFrame:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        view.hvMoveLabels[n] = fs
    end
    fs:Show()
    return fs
end

-- The ghosts of your moved casts at the raid's time (a faint square and a dashed pole on the cast's row), each
-- with "2:51 to 3:05" right of the later of the two. n: the band textures used so far; returns the new count
-- and the labels used.
local function drawMoved(view, n, x, length)
    local View = CRT.TimelineView
    local rowH, labels = View.ROW_H, 0
    local r, g, b = rgba("accent")
    for _, m in ipairs(view.marks or {}) do
        if m.moved and m.raidT and m.row then
            local gx, top = x(m.raidT), -(m.row - 1) * rowH
            n = n + 1
            local square = bandTexture(view, n)
            square:SetColorTexture(r, g, b, GHOST_ALPHA)
            square:ClearAllPoints()
            square:SetPoint("TOPLEFT", view.track, "TOPLEFT", gx - GHOST_W / 2, top - 1)
            square:SetSize(GHOST_W, GHOST_W)
            for y = 3, rowH - 3 - GHOST_DASH, GHOST_DASH + GHOST_GAP do
                n = n + 1
                local dash = bandTexture(view, n)
                dash:SetColorTexture(r, g, b, 1)
                dash:ClearAllPoints()
                dash:SetPoint("TOPLEFT", view.track, "TOPLEFT", gx - 1, top - y)
                dash:SetSize(2, GHOST_DASH)
            end
            labels = labels + 1
            local fs = moveLabel(view, labels)
            fs:SetTextColor(rgba("label"))
            fs:SetText(string.format(TEXT.moved, View.Format(m.raidT), View.Format(math.min(length, m.t))))
            fs:ClearAllPoints()
            fs:SetPoint("LEFT", view.track, "TOPLEFT", math.max(gx, x(m.t)) + GHOST_W / 2 + 4, top - rowH / 2)
        end
    end
    return n, labels
end

-- The cooldown bands of the shown casts (from each cast to when its cooldown is up, cut at the timeline's
-- end), your moved casts' ghosts, the panel rows (Timeline/HealerPanel.lua) and the hint line under the rows.
-- Hides them all outside Healer CDs.
function HV.Draw(view, length)
    local on = view.mode == "healers" and view.pull ~= nil
    local n, labels = 0, 0
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
        local ar, ag, ab = rgba("accent")
        for _, m in ipairs(view.marks or {}) do
            if m.hvLane and m.cd and m.row then
                -- the band is in its player's class colour, so each block reads as one colour
                local tint = m.hvLane.tint
                local r, g, b = ar, ag, ab
                if tint then
                    r, g, b = tint[1], tint[2], tint[3]
                end
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
        n, labels = drawMoved(view, n, x, length)
        view.unknownText:SetText(view.hvEmpty and TEXT.noHealers or (canEditRaid() and TEXT.hint or TEXT.hintOwn))
    end
    for i = n + 1, #(view.hvBands or {}) do
        view.hvBands[i]:Hide()
    end
    for i = labels + 1, #(view.hvMoveLabels or {}) do
        view.hvMoveLabels[i]:Hide()
    end
    local Panel = CRT.TimelineHealerPanel
    if Panel then
        Panel.Draw(view, on)
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
-- says why. True when the click was this view's (a cooldown, a player's or a panel row).
function HV.DoubleClick(view, t, lane)
    if not lane then
        return false
    end
    if lane.kind == "healer" or lane.kind == "hvpanel" then
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
