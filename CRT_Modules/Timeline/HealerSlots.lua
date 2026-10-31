local ADDON, CRT = ...

-- Timeline: healer slots on Healer CDs (Timeline/HealerView.lua draws them). A slot is a healer the raid doesn't have
-- yet, planned by spec: "+ Add healer" under the healer rows picks one of the healer specs (Notes/SpecWords.lua) and
-- adds a slot with the next free number of that spec. Each slot is a healer's block: a name row ("Resto Druid", or
-- "Resto Druid 1 · Leafy" once a player is assigned) and one row per major cooldown of that spec (HealerView.Majors,
-- that spec's only). A cast planned on a slot is a raid note line tagged with its player's name, or while it has none,
-- with its spec word: "RestoDruid", numbered ("RestoDruid2") when the boss has more than one slot of that spec. The
-- numbers stay as given: removing slot 1 of 2 leaves slot 2. When a spec gets its second slot, the first one's lines
-- with the plain word are written with its number ("RestoDruid1"), so they never come to mean every Resto Druid. A
-- right-click on a slot's name row: Assign player, Change spec, Clear player, Remove slot, and its rows. Assigning
-- rewrites the slot's lines from its word to the name, Clear back (every line naming its player for its class's listed
-- cooldowns, planned before the assignment too); Change spec keeps the lines whose cooldown the new spec has, asks
-- before the rest leave the note, and takes the player off for a spec of another class; Remove asks before its lines
-- leave the note (a line naming others too keeps them, without the slot). Each change is made only in the notes the
-- view shows (View:ShownNoteIds), never another difficulty's. Only the raid leader or an assistant changes the raid
-- note (Notes:CanEditRaid); for anyone else the slots are their own, the note stays as it is, and a cast on an open
-- slot is one of their reminders.
-- Saved on this computer per boss (every difficulty), declared for the dev season purge:
--   CRTDB.timeline.healerSlots[encounterID] = { { spec = SpecializationID, n = number, player = "Name-Realm" or nil } }
-- A spec word in the boss's note with no slot here (a note planned on another computer) shows as a slot too, and is
-- kept here once it is changed (Slots.Ensure).

local Slots = {}
CRT.TimelineHealerSlots = Slots

local TEXT = {
    addHealer = "+ Add healer",
    addTitle = "Add healer",
    addHelp = "Plan a healer you don't have yet, by spec. Their casts name the spec in the raid note until you assign a "
        .. "player.\n\nRight-click a slot's name to assign a player, change its spec or remove it.",
    open = "Open slot, nobody in the raid",
    pick = "Pick a player: %d %s in the raid",
    assign = "Assign player",
    typeName = "Type a name...",
    typePrompt = "Who plays %s?",
    onSlot = "%s (%s)",
    noneOfSpec = "No %s in the raid",
    specUnknown = "Spec not known",
    changeSpec = "Change spec",
    clear = "Clear player",
    remove = "Remove slot",
    rows = "Rows",
    removeAsk = "Remove %s? %s",
    removeButton = "Remove",
    changeAsk = "Change %s to %s? %s",
    changeButton = "Change",
    castOne = "Its 1 planned cast leaves the raid note.",
    castMany = "Its %d planned casts leave the raid note.",
    -- an assigned slot's casts are every one naming its player for these cooldowns, planned before too
    castOneFor = "1 planned cast leaves the raid note: every cast of these cooldowns that names %s.",
    castManyFor = "%d planned casts leave the raid note: every cast of these cooldowns that names %s.",
    slotTip = "A healer slot for this boss.",
    slotTipMenu = "Right-click to assign a player, change the spec or remove the slot.",
}
Slots.TEXT = TEXT

local DOT = " \194\183 "
local NAME_POPUP = "CRT_HEALER_SLOT_NAME"
local BORDER_W = 1
local DASH, DASH_GAP = 4, 3

if CRT.Bosses and CRT.Bosses.DeclareField then
    CRT.Bosses:DeclareField("healer slots", "timeline", "healerSlots")
end

local function Specs()
    return CRT.NoteSpecs
end

-- The boss's saved slots, made when create is set; nil when there are none.
local function store(encounterID, create)
    local t = CRT.db and CRT.db.timeline
    if type(t) ~= "table" or type(encounterID) ~= "number" then
        return nil
    end
    if type(t.healerSlots) ~= "table" then
        if not create then
            return nil
        end
        t.healerSlots = {}
    end
    local list = t.healerSlots[encounterID]
    if type(list) ~= "table" then
        if not create then
            return nil
        end
        list = {}
        t.healerSlots[encounterID] = list
    end
    return list
end

-- The boss's saved slots that read: { spec, n, player }, in the order added.
function Slots.List(encounterID)
    local out = {}
    local S = Specs()
    for _, s in ipairs(store(encounterID, false) or {}) do
        if type(s) == "table" and S and S.ByID(s.spec) and type(s.n) == "number" then
            out[#out + 1] = s
        end
    end
    return out
end

-- In a view's list of slots (ForView's) ------------------------------------------------------------------

function Slots.Count(list, spec)
    local n = 0
    for _, s in ipairs(list) do
        if s.spec == spec then
            n = n + 1
        end
    end
    return n
end

-- The smallest number no slot of spec has (other than skip).
local function nextFree(list, spec, skip)
    local used = {}
    for _, s in ipairs(list) do
        if s.spec == spec and s ~= skip then
            used[s.n] = true
        end
    end
    local n = 1
    while used[n] do
        n = n + 1
    end
    return n
end

-- The slot a spec word names: slot n of spec, or with no number the lowest-numbered slot of spec; nil when none.
function Slots.ForWord(list, spec, n)
    local best
    for _, s in ipairs(list) do
        if s.spec == spec then
            if n ~= nil and s.n == n then
                return s
            end
            if n == nil and (best == nil or s.n < best.n) then
                best = s
            end
        end
    end
    return best
end

-- The word a slot's lines are written with, and its label: numbered when the boss has more than one slot of its spec.
function Slots.Word(s, list)
    return Specs().Word(s.spec, Slots.Count(list, s.spec) > 1 and s.n or nil)
end

function Slots.Label(s, list)
    return Specs().Label(s.spec, Slots.Count(list, s.spec) > 1 and s.n or nil)
end

local function personal(noteID)
    local record = CRT.Notes and CRT.Notes:Get(noteID)
    return record and record.personal and true or false
end

-- The slots a view of the boss draws: the saved ones, then one per spec word of the shown raid note lines (marks) that
-- no slot covers. Each is { spec, n, player, saved = the saved slot or nil }, fresh for each build.
function Slots.ForView(encounterID, marks)
    local out = {}
    for _, s in ipairs(Slots.List(encounterID)) do
        out[#out + 1] = { spec = s.spec, n = s.n, player = s.player, saved = s }
    end
    local S = Specs()
    for _, m in ipairs(S and marks or {}) do
        if m.kind == "note" and not personal(m.noteID) then
            for _, tag in ipairs(m.tags or {}) do
                local e, n = S.ReadTag(tag)
                if e and not Slots.ForWord(out, e.spec, n) then
                    out[#out + 1] = { spec = e.spec, n = n or nextFree(out, e.spec) }
                end
            end
        end
    end
    return out
end

-- The view's slot a note line's tag word names (a spec word), or nil.
function Slots.ForTag(list, tag)
    local S = Specs()
    local e, n
    if S then
        e, n = S.ReadTag(tag)
    end
    return e and Slots.ForWord(list, e.spec, n) or nil
end

-- Keeps slot s for the boss (a slot from the note's words is saved now); returns the saved slot.
function Slots.Ensure(encounterID, s)
    if s.saved then
        return s.saved
    end
    local list = store(encounterID, true)
    if not list then
        return nil
    end
    local saved = { spec = s.spec, n = s.n, player = s.player }
    list[#list + 1] = saved
    s.saved = saved
    return saved
end

-- The player a slot names on Healer CDs: { key, name, tag (what a cast's line is tagged with), class, role, spec, me,
-- slot }, and the keys it is found by (lower case: the player's key and name, or the slot's own key). players: the
-- view's roster (HealerView.Players).
function Slots.Person(s, list, players)
    local e = Specs().ByID(s.spec)
    if s.player then
        local key = s.player:lower()
        local found
        for _, p in ipairs(players or {}) do
            if p.key:lower() == key then
                found = p
            end
        end
        local Groups = CRT.Groups
        local name = found and found.name or (Groups and Groups.Display and Groups.Display(s.player)) or s.player
        return { key = s.player, name = name, tag = name, class = e.class, role = "HEALER", spec = s.spec,
            me = found and found.me or nil, slot = s }, { key, name:lower() }
    end
    local key = "slot:" .. s.spec .. ":" .. s.n
    return { key = key, name = Slots.Label(s, list), tag = Slots.Word(s, list), class = e.class, role = "HEALER",
        spec = s.spec, slot = s }, { key }
end

-- A slot's name row: its label ("Resto Druid 1 · Leafy" once assigned), and while it has no player the hint on its
-- row: the one player of its spec when the boss has one slot of it, "Open slot, nobody in the raid", or "Pick a
-- player: 2 Resto Druids in the raid" (warn) when it is not clear who. { label, note, warn }
function Slots.Header(s, list, name)
    local S = Specs()
    local label = Slots.Label(s, list)
    if s.player then
        return { label = label .. DOT .. name }
    end
    local players = S.Players(s.spec)
    if #players == 0 then
        return { label = label, note = TEXT.open }
    end
    if #players == 1 and Slots.Count(list, s.spec) == 1 then
        return { label = label, note = players[1].name }
    end
    local e = S.ByID(s.spec)
    return { label = label, note = string.format(TEXT.pick, #players, e.label .. (#players == 1 and "" or "s")), warn = true }
end

-- A slot's name row tooltip lines.
function Slots.TipLines()
    return { TEXT.slotTip, TEXT.slotTipMenu }
end

-- The slot's lines ---------------------------------------------------------------------------------------
-- Every change to the raid note is made in the notes the view shows (ctx.notes: the shared note each shown difficulty
-- runs, as the view draws them, View:ShownNoteIds), never in another difficulty's note, an older copy or another
-- guild's. ctx = { encounterID, notes = { note ids }, list = the view's slots (ForView) }: Slots.Context(view).

local function canEditRaid()
    local Notes = CRT.Notes
    return Notes and Notes.CanEditRaid and Notes:CanEditRaid() and true or false
end

-- The context of a view's slot changes.
function Slots.Context(view)
    local ids = {}
    for _, id in ipairs(view.ShownNoteIds and view:ShownNoteIds() or {}) do
        if not personal(id) then
            ids[#ids + 1] = id
        end
    end
    return { encounterID = view:EncounterNumber(), notes = ids, list = view.hvSlots or {} }
end

local function sameName(tag, key)
    local Groups = CRT.Groups
    local full = Groups and Groups.Normalize and Groups.Normalize(tag) or tag
    return type(full) == "string" and full:lower() == key:lower()
end

-- Which tag of timer t makes it slot s's line (its index), or nil: a spec word that names s, or s's player's name on
-- a listed cooldown of s's class (every line naming them for those cooldowns, planned before they were assigned too).
local function slotTag(s, list, t)
    local S = Specs()
    for i, tag in ipairs(t.tags or {}) do
        local e, n = S.ReadTag(tag)
        if e then
            if e.spec == s.spec and Slots.ForWord(list, e.spec, n) == s then
                return i
            end
        elseif s.player and sameName(tag, s.player) then
            local HV = CRT.TimelineHealerView
            local listed = HV and HV.Listed(t.spellId)
            if listed and listed.class == S.ByID(s.spec).class then
                return i
            end
        end
    end
    return nil
end

-- Calls each(timer, tagIndex) for every line of slot s in ctx's notes, and writes back what it returns: a new tag
-- list, false to take the line out, nil to leave it. One change per note. Returns how many lines it matched.
-- write false: only counts them.
local function eachLine(ctx, s, each, write)
    local Notes, Parser = CRT.Notes, CRT.NoteParser
    local matched = 0
    for _, id in ipairs(ctx.notes or {}) do
        local record, parsed = Notes:Get(id), Notes:Parsed(id)
        local pieces = record and Notes.SplitPieces(record.raw or "") or {}
        local drop, touched = {}, false
        for _, t in ipairs(record and parsed and parsed.timers or {}) do
            local i = slotTag(s, ctx.list, t)
            local piece = i and pieces[t.line]
            if piece then
                matched = matched + 1
                local tags = each and each(t, i)
                if tags == false then
                    drop[t.line], touched = true, true
                elseif tags then
                    local line = Parser.ReplaceField(piece.text, "tag", table.concat(tags, " "))
                    if line and line ~= piece.text then
                        piece.text, touched = line, true
                    end
                end
            end
        end
        if touched and write ~= false then
            local out = {}
            for n, piece in ipairs(pieces) do
                if not drop[n] then
                    out[#out + 1] = piece.text .. piece.eol
                end
            end
            Notes:UpdateRaw(id, table.concat(out), "edited", { lines = true })
        end
    end
    return matched
end

-- How many lines in ctx's notes are slot s's.
function Slots.CastCount(ctx, s)
    return eachLine(ctx, s, nil, false)
end

local function withTag(word)
    return function(t, i)
        local tags = {}
        for k, v in ipairs(t.tags) do
            tags[k] = v
        end
        tags[i] = word
        return tags
    end
end

-- A line leaving with its slot: out of the note, or when its tag names others too (tag:RestoDruid Bob), only the
-- slot's word leaves it.
local function leave(t, i)
    if #t.tags <= 1 then
        return false
    end
    local tags = {}
    for k, v in ipairs(t.tags) do
        if k ~= i then
            tags[#tags + 1] = v
        end
    end
    return tags
end

-- When spec goes from one slot to two, the one it had has its lines' plain word ("RestoDruid", every Resto Druid)
-- written with its number ("RestoDruid1"), so they keep meaning that slot. For someone who may change the raid note.
local function numberTheOther(ctx, spec)
    if not canEditRaid() or Slots.Count(ctx.list, spec) ~= 1 then
        return
    end
    local S = Specs()
    local other = Slots.ForWord(ctx.list, spec, nil)
    local word = S.Word(spec, other.n)
    eachLine(ctx, other, function(t, i)
        local e, n = S.ReadTag(t.tags[i])
        if e and n == nil then
            return withTag(word)(t, i)
        end
        return nil
    end)
end

-- Adds a slot of spec with the next free number among ctx's slots; returns it.
function Slots.Add(ctx, spec)
    local all = store(ctx.encounterID, true)
    if not (all and Specs() and Specs().ByID(spec)) then
        return nil
    end
    numberTheOther(ctx, spec)
    local s = { spec = spec, n = nextFree(ctx.list, spec) }
    all[#all + 1] = s
    return s
end

-- Assigns player name ("Name" or "Name-Realm") to slot s: its lines (by its word, or by the player it had) name them.
function Slots.Assign(ctx, s, name)
    local Groups = CRT.Groups
    local key = Groups and Groups.Normalize and Groups.Normalize(name) or name
    if type(key) ~= "string" or key == "" then
        return false
    end
    if canEditRaid() then
        eachLine(ctx, s, withTag(Groups and Groups.Display and Groups.Display(key) or key))
    end
    local saved = Slots.Ensure(ctx.encounterID, s) or {}
    saved.player, s.player = key, key
    return true
end

-- Takes slot s's player off: every line naming them for its class's listed cooldowns is written with its spec word.
function Slots.Clear(ctx, s)
    if not s.player then
        return false
    end
    if canEditRaid() then
        eachLine(ctx, s, withTag(Slots.Word(s, ctx.list)))
    end
    local saved = Slots.Ensure(ctx.encounterID, s) or {}
    saved.player, s.player = nil, nil
    return true
end

-- Gives slot s spec instead, with that spec's next free number; a spec of another class takes its player off. Its
-- lines for a cooldown the new spec has stay (by the new word while it has no player); the others leave (leave). With
-- any to leave and no confirmed, nothing changes and "ask" comes back with how many. Returns true when changed.
function Slots.ChangeSpec(ctx, s, spec, confirmed)
    local S, HV = Specs(), CRT.TimelineHealerView
    local e = S.ByID(spec)
    if not e or spec == s.spec then
        return false
    end
    local keep = {}
    for _, m in ipairs(HV and HV.Majors(e.class, spec, true) or {}) do
        keep[m.spellID] = true
    end
    local lead = canEditRaid()
    if lead then
        local lost = 0
        eachLine(ctx, s, function(t)
            if not keep[t.spellId] then
                lost = lost + 1
            end
        end, false)
        if lost > 0 and not confirmed then
            return "ask", lost
        end
    end
    local player = e.class == S.ByID(s.spec).class and s.player or nil
    local n = nextFree(ctx.list, spec, s)
    if lead then
        numberTheOther(ctx, spec)
        local word = S.Word(spec, (Slots.Count(ctx.list, spec) + 1 > 1) and n or nil)
        local name = player and CRT.Groups and CRT.Groups.Display and CRT.Groups.Display(player) or player
        eachLine(ctx, s, function(t, i)
            if not keep[t.spellId] then
                return leave(t, i)
            end
            return withTag(name or word)(t, i)
        end)
    end
    local saved = Slots.Ensure(ctx.encounterID, s) or {}
    saved.spec, saved.n, saved.player = spec, n, player
    s.spec, s.n, s.player = spec, n, player
    return true
end

-- Removes slot s. With lines in the raid note (for someone who may change it) and no confirmed, nothing changes and
-- "ask" comes back with how many; confirmed, its lines leave the note with it (leave). Other slots keep their numbers.
function Slots.Remove(ctx, s, confirmed)
    local encounterID = ctx.encounterID
    if canEditRaid() then
        local count = Slots.CastCount(ctx, s)
        if count > 0 and not confirmed then
            return "ask", count
        end
        if count > 0 then
            eachLine(ctx, s, leave)
        end
    end
    local saved = s.saved
    local all = store(encounterID, false)
    for i = #(all or {}), 1, -1 do
        if all[i] == saved then
            table.remove(all, i)
        end
    end
    if all and #all == 0 then
        CRT.db.timeline.healerSlots[encounterID] = nil
    end
    return true
end

-- Menus and questions ----------------------------------------------------------------------------------------

local function classColored(text, class)
    local c = class and RAID_CLASS_COLORS and RAID_CLASS_COLORS[class]
    if type(c) ~= "table" then
        return text
    end
    local hex = c.colorStr
    if type(hex) ~= "string" or #hex ~= 8 then
        local function byte(v)
            return math.floor((tonumber(v) or 1) * 255 + 0.5)
        end
        hex = string.format("ff%02x%02x%02x", byte(c.r), byte(c.g), byte(c.b))
    end
    return "|c" .. hex .. text .. "|r"
end

-- What leaves the raid note with n casts of slot s (named: its player's name, when it has one).
local function casts(n, named)
    if named then
        return n == 1 and string.format(TEXT.castOneFor, named) or string.format(TEXT.castManyFor, n, named)
    end
    return n == 1 and TEXT.castOne or string.format(TEXT.castMany, n)
end

-- Asks text with button and Cancel, then runs go; without the game's popup, runs go.
local function ask(text, button, go)
    local UI = CRT.UI
    if not StaticPopup_ShowCustomGenericConfirmation then
        go()
        return
    end
    local ret = StaticPopup_ShowCustomGenericConfirmation({ text = text, acceptText = button, cancelText = CANCEL,
        showAlert = true, callback = go })
    if UI and UI.LiftOver and UI.ShownPopup then
        UI.LiftOver(UI.ShownPopup(ret, "GENERIC_CONFIRMATION"))
    end
end
Slots.Ask = ask

-- Asks for a name (prompt), then done(name) with what was typed.
local function askName(prompt, done)
    if not (StaticPopupDialogs and StaticPopup_Show) then
        return
    end
    if not StaticPopupDialogs[NAME_POPUP] then
        local function accept(edit, data)
            local name = edit and strtrim(edit:GetText() or "") or ""
            if data and data.done and name ~= "" then
                data.done(name)
            end
        end
        StaticPopupDialogs[NAME_POPUP] = {
            text = "%s",
            button1 = ACCEPT or "Accept",
            button2 = CANCEL or "Cancel",
            hasEditBox = true,
            maxLetters = 48,
            timeout = 0,
            whileDead = true,
            hideOnEscape = true,
            preferredIndex = 3,
            OnShow = function(dialog)
                local edit = CRT.UI.PopupEditBox(dialog)
                if edit then
                    edit:SetText("")
                end
            end,
            OnAccept = function(dialog, data)
                accept(CRT.UI.PopupEditBox(dialog), data)
            end,
            EditBoxOnEnterPressed = function(edit, data)
                local parent = edit:GetParent()
                accept(edit, data or (parent and parent.data))
                StaticPopup_Hide(NAME_POPUP)
            end,
            EditBoxOnEscapePressed = function()
                StaticPopup_Hide(NAME_POPUP)
            end,
        }
    end
    local ret = StaticPopup_Show(NAME_POPUP, prompt, nil, { done = done })
    local UI = CRT.UI
    if UI and UI.LiftOver and UI.ShownPopup then
        UI.LiftOver(UI.ShownPopup(ret, NAME_POPUP))
    end
end
Slots.AskName = askName

local function openMenu(owner, fill)
    local View = CRT.TimelineView
    if not (View and View.OpenMenu and MenuUtil and MenuUtil.CreateContextMenu) then
        return false
    end
    View.OpenMenu(owner, fill)
    return true
end

-- The + Add healer menu at owner: the healer specs, each in its class colour.
function Slots.AddMenu(view, owner)
    local encounterID = view:EncounterNumber()
    if not encounterID then
        return false
    end
    return openMenu(owner, function(root)
        root:CreateTitle(TEXT.addTitle)
        for _, e in ipairs(Specs().List()) do
            root:CreateButton(classColored(e.label, e.class), function()
                Slots.Add(Slots.Context(view), e.spec)
                view:Refresh()
            end)
        end
    end)
end

-- Who may take slot s (the Assign player submenu): the roster's players of its spec, then the roster's players of its
-- class whose spec isn't known. Each { key, name, class, on = the label of the other slot they have, or nil }.
local function candidates(s, list)
    local S, Groups, Roster = Specs(), CRT.Groups, CRT.AlertRoster
    local e = S.ByID(s.spec)
    local onSlot = {}
    for _, other in ipairs(list) do
        if other ~= s and other.player then
            onSlot[other.player:lower()] = Slots.Label(other, list)
        end
    end
    local ofSpec, unknown, seen = {}, {}, {}
    for _, p in ipairs(S.Players(s.spec)) do
        seen[p.key:lower()] = true
        ofSpec[#ofSpec + 1] = { key = p.key, name = p.name, class = p.class, on = onSlot[p.key:lower()] }
    end
    local ok, roster = false, nil
    if Roster and Roster.Players then
        ok, roster = pcall(Roster.Players, Roster)
    end
    for _, p in ipairs(ok and roster or {}) do
        local spec = Groups and Groups.CachedSpec and Groups.CachedSpec(p.key)
        if not seen[p.key:lower()] and p.class == e.class and spec == nil then
            unknown[#unknown + 1] = { key = p.key, name = p.name, class = p.class, on = onSlot[p.key:lower()] }
        end
    end
    return ofSpec, unknown
end

local function playerButton(menu, p, pick)
    local text = classColored(p.name, p.class)
    if p.on then
        text = string.format(TEXT.onSlot, p.name, p.on)
    end
    local b = menu:CreateButton(text, function()
        pick(p.key)
    end)
    if p.on and b and b.SetEnabled then
        b:SetEnabled(false)
    end
end

-- Runs action (a Slots function's call), asking first when it says "ask" (question: its "%s" the casts that leave,
-- named for the slot's player when it has one); the view drawn again after.
local function act(view, call, question, button, named)
    local result, count = call(false)
    if result == "ask" then
        ask(string.format(question, casts(count, named)), button, function()
            call(true)
            view:Refresh()
        end)
        return
    end
    view:Refresh()
end

-- A right-click on a slot's name row (lane.hvSlot): its menu. True when it was one.
function Slots.HeaderMenu(view, owner, lane)
    local s = lane and lane.hvSlot
    local encounterID = view:EncounterNumber()
    if not (s and encounterID) then
        return false
    end
    local ctx = Slots.Context(view)
    local list = ctx.list
    local S = Specs()
    local label = Slots.Label(s, list)
    local named = s.player and s.who and s.who.p and s.who.p.name or nil
    local function assign(name)
        Slots.Assign(ctx, s, name)
        view:Refresh()
    end
    return openMenu(owner, function(root)
        root:CreateTitle(label)
        local sub = root:CreateButton(TEXT.assign)
        local ofSpec, unknown = candidates(s, list)
        local e = S.ByID(s.spec)
        if #ofSpec == 0 then
            local none = sub:CreateButton(string.format(TEXT.noneOfSpec, e.label))
            if none and none.SetEnabled then
                none:SetEnabled(false)
            end
        end
        for _, p in ipairs(ofSpec) do
            playerButton(sub, p, assign)
        end
        if #unknown > 0 then
            sub:CreateDivider()
            sub:CreateTitle(TEXT.specUnknown)
            for _, p in ipairs(unknown) do
                playerButton(sub, p, assign)
            end
        end
        sub:CreateDivider()
        sub:CreateButton(TEXT.typeName, function()
            askName(string.format(TEXT.typePrompt, label), assign)
        end)
        local change = root:CreateButton(TEXT.changeSpec)
        for _, other in ipairs(S.List()) do
            local b = change:CreateButton(classColored(other.label, other.class), function()
                act(view, function(confirmed)
                    return Slots.ChangeSpec(ctx, s, other.spec, confirmed)
                end, string.format(TEXT.changeAsk, label, other.label, "%s"), TEXT.changeButton, named)
            end)
            if other.spec == s.spec and b and b.SetEnabled then
                b:SetEnabled(false)
            end
        end
        local clear = root:CreateButton(TEXT.clear, function()
            Slots.Clear(ctx, s)
            view:Refresh()
        end)
        if not s.player and clear and clear.SetEnabled then
            clear:SetEnabled(false)
        end
        root:CreateButton(TEXT.remove, function()
            act(view, function(confirmed)
                return Slots.Remove(ctx, s, confirmed)
            end, string.format(TEXT.removeAsk, label, "%s"), TEXT.removeButton, named)
        end)
        local Rows = CRT.TimelineHealerRows
        if Rows and Rows.Fill and lane.hvMenu and #lane.hvMenu.options > 0 then
            root:CreateDivider()
            local rows = root:CreateButton(TEXT.rows)
            Rows.Fill(rows, lane.hvMenu, function()
                view:Refresh()
            end)
        end
    end)
end

-- The slots' name rows' borders in the label column, in their class colour: solid with a player, dashed without.
-- Made once per label and reused; hidden on every other row.
local function border(l)
    local had = rawget(l, "hvBorder") -- the label frame's own field (rawget: a frame's other keys are its methods)
    if had then
        return had
    end
    local b = { solid = {}, dashes = {} }
    for i = 1, 4 do
        b.solid[i] = l:CreateTexture(nil, "OVERLAY")
    end
    l.hvBorder = b
    return b
end

local function dash(l, b, n)
    local tex = b.dashes[n]
    if not tex then
        tex = l:CreateTexture(nil, "OVERLAY")
        b.dashes[n] = tex
    end
    tex:Show()
    return tex
end

local function edge(tex, l, x, y, w, h, c)
    tex:SetColorTexture(c[1], c[2], c[3], 0.9)
    tex:ClearAllPoints()
    tex:SetPoint("TOPLEFT", l, "TOPLEFT", x, y)
    tex:SetSize(w, h)
    tex:Show()
end

function Slots.DrawBorders(view, on)
    local View = CRT.TimelineView
    local w, h = View.LABEL_W - 4, View.ROW_H
    for i, l in ipairs(view.labels or {}) do
        local lane = on and view.lanes and view.lanes[i]
        local slot = lane and lane.kind == "healer" and lane.hvSlot
        local c = slot and RAID_CLASS_COLORS and RAID_CLASS_COLORS[lane.class]
        local b = (slot or rawget(l, "hvBorder")) and border(l)
        local used = 0
        if slot then
            c = c and { c.r, c.g, c.b } or { 1, 1, 1 }
            if slot.player then
                edge(b.solid[1], l, 0, 0, w, BORDER_W, c)
                edge(b.solid[2], l, 0, -(h - BORDER_W), w, BORDER_W, c)
                edge(b.solid[3], l, 0, 0, BORDER_W, h, c)
                edge(b.solid[4], l, w - BORDER_W, 0, BORDER_W, h, c)
            else
                for x = 0, w - DASH, DASH + DASH_GAP do
                    used = used + 1
                    edge(dash(l, b, used), l, x, 0, DASH, BORDER_W, c)
                    used = used + 1
                    edge(dash(l, b, used), l, x, -(h - BORDER_W), DASH, BORDER_W, c)
                end
                for y = 0, h - DASH, DASH + DASH_GAP do
                    used = used + 1
                    edge(dash(l, b, used), l, 0, -y, BORDER_W, DASH, c)
                    used = used + 1
                    edge(dash(l, b, used), l, w - BORDER_W, -y, BORDER_W, DASH, c)
                end
            end
        end
        if b then
            for k = 1, 4 do
                if not (slot and slot.player) then
                    b.solid[k]:Hide()
                end
            end
            for k = used + 1, #b.dashes do
                b.dashes[k]:Hide()
            end
        end
    end
end
