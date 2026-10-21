local ADDON, CRT = ...

-- The Mech Alerts tab of the Raid Notes page (Notes/Page.lua builds it into its tab): pick a boss, and
-- on the left see its Encounter Journal abilities, then your own reminders that are not tied to an
-- ability, each with a tick that turns its reminder on or off. On the right, one panel shows the selected
-- row's alert, and every change there saves it at once (the first change on an ability makes its
-- reminder). The draft and its save are Alerts/Draft.lua's, the name lookup of the Icon box is
-- Alerts/SpellLookup.lua's, and Test and Save as template go through Alerts/Editor.lua, all shared with
-- the pop-out editor. The reminders and their times are in Alerts/Reminders.lua. This tab only reads
-- them when it is built, after login.

local UI = CRT.UI

-- Every word on this tab, in one place so the wording is easy to change. Keep the keys, change the
-- text in quotes, save, and /reload.
local TEXT = {
    title = "Mech Alerts",
    help = "On the left: the boss's abilities from the Encounter Journal, then your own reminders. Tick an ability to get a reminder for it, with the times from its ability timeline; untick it to turn it off. A dot means the timeline has times for it. Click a row to edit its alert on the right; changes save at once. Your own reminder adds one not tied to an ability.",
    boss = "Boss",
    difficulty = "Difficulty",
    any = "Any",
    timesFrom = "Times from",
    timesFromHelpTitle = "Times from",
    timesFromHelp = "Which of the boss's ability timelines the times are read from. A reminder with a difficulty of its own, or times you typed, keeps those.",
    none = "None on the timeline",
    ownReminder = "Your own reminder",
    unnamed = "Reminder",

    alertMe = "Alert me",
    saveAs = "Save as",
    asNote = "Raid note",
    asMine = "Only me",
    raidNoteHelp = "Raid note lines have one time each: make them on the Timeline.",
    triggers = "Triggers",
    triggersHelp = "Show from: how many seconds before each time the alert shows. Linger: how long it stays after 0. The times come from the boss's ability timeline, counted from the start of each phase.",
    showFrom = "Show from",
    linger = "Linger",
    seconds = "%d s",
    noTimes = "No times on the ability timeline for this mechanic.",
    times = "Times",
    timesHelp = "This alert has no times on the ability timeline, so type its own: the phase, then minutes:seconds from the start of that phase, as in P1 0:30, 1:15; P2 0:20. No phase means phase 1. Saved when you press Enter or leave the box.",
    badTimes = "The times don't read: %s",
    showOnTimeline = "Show on the Timeline",
    notOnTimeline = "That mechanic isn't on the Timeline for this boss yet.",
    showAs = "Show as",
    showAsHelp = "Where the alert shows: the Next spell alert, the alert areas (Text, Icon, Bar, Circle, Alert timeline), and whether it is read out. Alert Settings sets how each area looks.",
    nextSpell = "Next spell alert",
    showText = "Text",
    showIcon = "Icon",
    bar = "Bar",
    circle = "Circle",
    timeline = "Alert timeline",
    also = "Also",
    speak = "Speak the text",
    count = "Count down 3 2 1",
    glow = "Glow at 0",
    speakAt = "Speak at",
    onShow = "On show",
    atZero = "At 0",
    look = "Look and sound",
    text = "Text",
    icon = "Icon",
    iconSpell = "Spell",
    iconID = "Icon ID",
    iconHelp = "Spell: the spell's ID; the alert shows its icon and, with no text, its name. Icon ID: an icon's file ID instead. Or type a spell name (3 letters or more) to search this boss's abilities and your spells; a close spelling works too.",
    color = "Color",
    colorDefault = "Default",
    sound = "Sound",
    soundNone = "None",
    auraSound = "Also when it lands on me",
    auraSoundHelp = "Plays the sound whenever this ability's debuff lands on you, even in combat; the game plays it itself, so it works for hidden boss debuffs. It needs the alert's spell and a sound. If a game sound stays silent, pick a file.",
    test = "Test",
    template = "Save as template",
    delete = "Delete",
    deleteConfirm = "Delete reminder '%s'?",
    noTest = "Nothing to test: this alert has no times.",

    noType = "No type yet. Set one on the Timeline's Advanced tab: click the ability, then Set type.",

    markerTitle = "Marker display",
    markerShow = "Show the marker display: %s",
    markerHelp = "This boss has a marker display: a small window showing the raid markers raiders send with macros such as /raid {rt3}, in order, with who sent each. Untick it to turn it off for this boss. Move the window with Previews.",
}

-- Layout, from the page's width (UI.PAGE_W) and the tab's height (CRT.NotesPage.TAB_H, under the Raid
-- Notes tabs; Notes/Page.lua loads after this file, so the heights are worked out when the tab is built).
local L = {} -- every layout number below, in one table: Lua 5.1 allows a function at most 60 outer locals
L.PAD = 8
L.TOP_Y = -6 -- the boss, difficulty and reference dropdowns, beside the title
L.BOSS_X, L.BOSS_LABEL, L.BOSS_W = 130, 34, 190
L.DIFF_X, L.DIFF_LABEL, L.DIFF_W = 371, 58, 110
L.FROM_X, L.FROM_LABEL = 556, 66
L.HELP_ROOM = 30 -- a (?) and its gap
L.DROP_GAP = 5 -- UI/Controls.lua: between a row's label and its control
L.FROM_W = UI.PAGE_W - L.FROM_X - L.FROM_LABEL - L.DROP_GAP - L.HELP_ROOM - L.PAD
L.LIST_TOP = -44
L.LIST_W = 250
L.ROW_H = 24
L.OWN_H = 24
L.OWN_GAP = 6
-- L.LIST_H, L.MAX_ROWS, L.PANEL_H: from the tab's height, set in build
L.ROW_X = 2
L.THUMB_W = 3 -- the list's scroll bar, a thin thumb THUMB_INSET in from its right edge
L.THUMB_INSET = 1
-- the rows end the scroll gutter (UI/ScrollBar.lua) short of the thumb's outer edge, so no row runs under it
L.ROW_W = L.LIST_W - L.ROW_X - UI.ScrollGutter(L.THUMB_W + L.THUMB_INSET)
L.NAME_X = 50
L.DOT_SIZE = 6
L.NAME_W = L.ROW_W - L.NAME_X - L.DOT_SIZE - 12
L.PANEL_GAP = 12
L.PANEL_X = L.PAD + L.LIST_W + L.PANEL_GAP
L.PANEL_W = UI.PAGE_W - L.PAD - L.PANEL_X
L.INSET = 12
L.HEADER_ICON = 28
L.SAVE_LABEL, L.SAVE_W = 50, 104
L.CHECK_SIZE = 24
L.CHECK_LABEL_W = 96
L.CHECK_W = L.CHECK_SIZE + 2 + L.CHECK_LABEL_W -- a checkbox and its label
L.SAVE_X = L.PANEL_W - L.INSET - L.HELP_ROOM - (L.SAVE_LABEL + L.DROP_GAP + L.SAVE_W)
L.ALERT_X = L.SAVE_X - L.CHECK_W - 8
L.TITLE_W = L.ALERT_X - (L.INSET + L.HEADER_ICON + 8) - 10
L.SLIDER_VALUE = 44 -- UI/Controls.lua: a slider's value beside its bar
L.SHOW_LABEL, L.LINGER_LABEL, L.SLIDER_W = 70, 50, 150
L.SHOW_MIN, L.SHOW_MAX, L.SHOW_DEFAULT = 1, 60, 5 -- Show from, seconds
L.LINGER_MIN, L.LINGER_MAX = 0, 10 -- Linger, seconds
L.SLIDER_GAP = 20 -- between Show from and Linger
-- The panel's rows, from its top: the header, Triggers and its rows
L.ICON_Y, L.NAME_Y, L.ALERT_Y, L.SAVE_Y, L.SAVE_HELP_Y = -10, -16, -12, -8, -16
L.TRIGGERS_Y, L.SLIDERS_Y, L.TIMES_Y, L.TIMES_BOX_Y, L.TIMELINE_Y = -50, -66, -104, -100, -124
L.TIMELINE_W, L.TEMPLATE_W, L.TEST_W, L.DEFAULT_W = 170, 140, 80, 80
L.BUTTON_GAP = 8
L.DELETE_W = 80
-- Delete, Test and Save as template, bottom right
L.BUTTONS_W = L.TEMPLATE_W + L.BUTTON_GAP + L.TEST_W + L.BUTTON_GAP + L.DELETE_W + L.BUTTON_GAP
L.BOTTOM_Y = 10 -- the bottom row's buttons above the panel's bottom edge
L.MENU_MAX_H = 400 -- the Sound menu scrolls past this
L.COL_Y = -162
L.COL_GAP = 22
L.COL_W = math.floor((L.PANEL_W - 2 * L.INSET - L.COL_GAP) / 2)
L.COL2_X = L.INSET + L.COL_W + L.COL_GAP
L.CHECK_STEP = 130 -- between the checkboxes of a row
L.CHECK_STEP_NARROW = 100 -- the third checkbox of a row, after a short label
L.LABEL_W = 50
L.ICON_DROP_W = 90
L.ID_X = L.COL2_X + L.LABEL_W + L.DROP_GAP + L.ICON_DROP_W + 8
L.ID_W = L.COL2_X + L.COL_W - L.ID_X - L.HELP_ROOM
L.SOUND_W = 160
L.SPEAK_AT_LABEL, L.SPEAK_AT_W = 56, 104 -- Speak at, beside Glow under Count down
L.BUTTON_H = 22
L.TYPING_PAUSE = 0.5 -- seconds after the last key before a typed box saves
local ANY = "any"

local WHITE = { 1, 1, 1 }
local GREY = { 0.5, 0.5, 0.5 }
local TIMES_GREY = { 0.55, 0.5, 0.45 }
-- the selected row: the colour of a selected tab (UI:StyleTab), Classic and Modern
local SEL_CLASSIC_ALPHA = 0.18 -- over the heading colour (the game's gold)
local SEL_MODERN_ALPHA = 0.95
-- a name in its ability type's colour: mixed this far toward GREY when its reminder is off, and toward WHITE on
-- the selected row, so it reads on the highlight in every theme
local TYPE_DIM, TYPE_LIFT = 0.5, 0.5

local function lower(s)
    return tostring(s or ""):lower()
end

local function copy(t)
    local out = {}
    for k, v in pairs(t) do
        out[k] = v
    end
    return out
end

-- The bosses the tabs can pick, in the raid route order the boss library keeps (CRT.Bosses:Options,
-- the one ordered source every boss list reads; set on the Development page, shipped in Season.lua).
-- Bosses outside the library are not listed. { { key = encounterID, name, label } }, headings left
-- out. Shared with the Phases tab and Pace.
local function bossList()
    local list = {}
    local Bosses = CRT.Bosses
    for _, o in ipairs(Bosses and Bosses.Options and Bosses:Options() or {}) do
        if not o.title and type(o.key) == "number" then
            list[#list + 1] = { key = o.key, name = o.label, label = o.label }
        end
    end
    return list
end

local function bossName(list, key)
    for _, b in ipairs(list) do
        if b.key == key then
            return b.name
        end
    end
end

-- The tab -----------------------------------------------------------------------------------------

local selected, viewDiff
local tab, rows, items, offset, list, thumb, bossDrop, diffDrop, fromDrop, ownButton, markerCheck
local panel = {}
local listening = false
-- Per boss, for the session: the key of the last selected row, and whether a new reminder of your own
-- waits for its first change.
local picked, pendingOwn = {}, {}
-- The panel's alert: the row's key and item, the boss, and the draft with where it came from (ctx).
local cur = {}
local notice -- the last save's problem, shown in red until a change saves
local saving = false -- a save of the panel's own is firing the change listeners
local filling = false -- the panel is setting its own boxes
local followID -- after a save, the row holding this reminder becomes the selected one
local reveal = false -- scroll the selected row into view on the next refresh
local lookupFrom -- the spell when the Icon box took the focus
local typed = false -- a box was typed in and is not saved yet
local typedGen = 0 -- counts typing and loads, so only the last pause saves

-- Read once per change, never on a scroll or a click: the bosses, each boss's references, and the list
-- with each row's name, icon and times. A reminder change drops the list; a reference change (the
-- Timeline's listeners), showing the tab or Refresh drop everything.
local data = { refs = {} }
local listCache -- { enc, diff, pending, items }

local function listChanged()
    listCache = nil
end

local function allChanged()
    data, listCache = { refs = {} }, nil
end

local function bosses()
    if not data.bosses then
        data.bosses = bossList()
    end
    return data.bosses
end

local function pickBoss(bosses)
    if not selected or not bossName(bosses, selected) then
        local _, record = CRT.Notes:Active()
        local active = record and record.encounterID
        selected = (active and bossName(bosses, active) and active) or (bosses[1] and bosses[1].key) or nil
        viewDiff = nil
    end
    return selected, selected and bossName(bosses, selected)
end

-- The ability rows of the boss from the Journal, then the reminders that match none of them, then a
-- new reminder of your own waiting for its first change.
local function buildItems(enc)
    local Reminders = CRT.AlertReminders
    local out = {}
    if not enc then
        return out
    end
    local journal = {}
    if CRT.TimelineJournal then
        local ok, res = pcall(CRT.TimelineJournal.Rows, CRT.TimelineJournal, enc)
        if ok and type(res) == "table" then
            journal = res
        end
    end
    local saved = Reminders:List(enc)
    local used = {}
    for _, jrow in ipairs(journal) do
        local item = { ability = jrow, spellID = jrow.spellID }
        for _, e in ipairs(saved) do
            if not used[e.id] and e.r.spellID == jrow.spellID then
                used[e.id] = true
                item.id, item.r = e.id, e.r
                break
            end
        end
        out[#out + 1] = item
    end
    for _, e in ipairs(saved) do
        if not used[e.id] then
            out[#out + 1] = { id = e.id, r = e.r, spellID = e.r.spellID }
        end
    end
    if pendingOwn[enc] then
        out[#out + 1] = { pending = true }
    end
    return out
end

-- A row's key, kept per boss: an ability by its spell, a reminder of your own by its id.
local function itemKey(item)
    if item.pending then
        return "new"
    elseif item.ability then
        return "a:" .. tostring(item.spellID or item.ability.name)
    end
    return "r:" .. tostring(item.id)
end

local function itemName(item)
    if item.r and type(item.r.text) == "string" and item.r.text ~= "" then
        return item.r.text
    end
    if item.ability then
        return CRT.AlertReminders.SpellName(item.spellID) or item.ability.name or TEXT.unnamed
    end
    return CRT.AlertReminders.SpellName(item.spellID) or TEXT.unnamed
end

local function spellTexture(id)
    if type(id) == "number" and id > 0 and C_Spell and C_Spell.GetSpellTexture then
        local ok, tex = pcall(C_Spell.GetSpellTexture, id)
        if ok and tex ~= nil and (not (CRT.Timeline and CRT.Timeline.readable) or CRT.Timeline.readable(tex)) then
            return tex
        end
    end
end

local function itemIcon(item)
    if item.ability and item.ability.icon then
        return item.ability.icon
    end
    return spellTexture(item.spellID)
end

-- What a reminder's times read as for the difficulty on show: the text and whether there are any.
local function timesFor(enc, r)
    local Reminders = CRT.AlertReminders
    if not r.difficulty then
        r.difficulty = viewDiff
    end
    local found, source, err = Reminders:Times(enc, r)
    if #found > 0 then
        return Reminders.FormatTimes(found), true
    end
    if source == "typed" and err then
        return err, false
    end
    return nil, false
end

-- The boss's rows for the difficulty on show, each with what the list and the panel show of it: label,
-- iconTex, timesRaw (its times as text, or a typed error), has (it has times) and refHas (the reference
-- has times for it, leaving out times it typed itself). Built once per change (see listChanged).
local function itemsFor(enc, name)
    local c = listCache
    local pending = enc and pendingOwn[enc] or false
    if c and c.enc == enc and c.diff == viewDiff and c.pending == pending then
        return c.items
    end
    local list = buildItems(enc)
    -- each row's ability types, main first, found as its alerts' colour is (Alerts/Colors.lua)
    local typesOf = CRT.AlertColors and CRT.AlertColors.Types(enc, name, viewDiff)
    for _, item in ipairs(list) do
        if item.pending then
            item.label, item.has, item.refHas = TEXT.unnamed, false, false
        else
            item.label = itemName(item)
            item.types = typesOf and typesOf(item.spellID, item.label) or nil
            item.iconTex = itemIcon(item)
            -- the game had not loaded the spell yet: asked again when the row is painted
            item.unloaded = item.spellID ~= nil and (item.label == TEXT.unnamed or item.iconTex == nil) or nil
            local r = item.r and copy(item.r) or { spellID = item.spellID, text = item.label }
            r.boss = r.boss or name
            item.timesRaw, item.has = timesFor(enc, r)
            if item.r and item.r.times then
                r.times = nil
                item.refHas = select(2, timesFor(enc, r))
            else
                item.refHas = item.has
            end
        end
    end
    listCache = { enc = enc, diff = viewDiff, pending = pending, items = list }
    return list
end

-- The references of the boss on show, yours first.
local function bossRefs()
    local Ref = CRT.TimelineReference
    if not (Ref and selected) then
        return {}
    end
    if not data.refs[selected] then
        data.refs[selected] = Ref:ForBoss(selected, bossName(bosses(), selected))
    end
    return data.refs[selected]
end

local function shownReference()
    local refs = bossRefs()
    if viewDiff then
        for _, entry in ipairs(refs) do
            if entry.ref.difficulty and lower(entry.ref.difficulty) == lower(viewDiff) then
                return entry
            end
        end
    end
    return refs[1]
end

-- The panel ---------------------------------------------------------------------------------------

local function draftName()
    local d = cur.draft
    if not d then
        return ""
    end
    local text = CRT.AlertDraft.trim(d.text)
    if text ~= "" then
        return text
    end
    return (d.spellID and CRT.AlertReminders.SpellName(d.spellID)) or (cur.item and not cur.item.pending and itemName(cur.item)) or TEXT.unnamed
end

local function draftIcon()
    local d = cur.draft
    if not d then
        return nil
    end
    if d.iconType == "id" and CRT.AlertDraft.validID(d.iconID) then
        return d.iconID
    end
    if d.spellID then
        return spellTexture(d.spellID)
    end
    return cur.item and not cur.item.pending and itemIcon(cur.item) or nil
end

local function setBox(edit, text, force)
    text = text or ""
    if edit:GetText() ~= text and (force or not edit:HasFocus()) then
        filling = true
        edit:SetText(text)
        filling = false
    end
end

local function idText(d)
    local id = d.iconType == "id" and d.iconID or d.spellID
    return id and tostring(id) or ""
end

-- Everything on the panel from the draft, except a box being typed in.
local function drawPanel()
    if not panel.frame then
        return
    end
    local d = cur.draft
    panel.content:SetShown(d ~= nil)
    -- Delete only for a reminder of your own (a row not from the Journal), never for a boss's ability
    local item = cur.item
    panel.deleteBtn:SetShown(d ~= nil and item ~= nil and not item.ability and (item.id ~= nil or item.pending == true))
    if not d then
        panel.name:SetText("")
        return
    end
    local icon = draftIcon()
    panel.icon:SetTexture(icon)
    panel.icon:SetShown(icon ~= nil)
    panel.name:SetText(draftName())
    panel.alertMe:SetChecked(cur.item and cur.item.r ~= nil and cur.item.r.enabled ~= false)
    for _, row in ipairs(panel.rows) do
        row.refresh()
    end
    for key, check in pairs(panel.checks) do
        check:SetChecked(d.show[key] and true or false)
    end
    panel.also.speak:SetChecked(d.speak and true or false)
    panel.also.count:SetChecked(d.count and true or false)
    panel.also.glow:SetChecked(d.glow and true or false)
    local auraOK = d.spellID ~= nil and CRT.Sound.Normalize(d.sound) ~= nil and CRT.SoundAuras:Available()
    panel.auraSound:SetChecked(d.auraSound and true or false)
    panel.auraSound:SetEnabled(auraOK and true or false)
    panel.auraSound.label:SetTextColor(auraOK and 1 or 0.5, auraOK and 1 or 0.5, auraOK and 1 or 0.5)
    local c = d.color or WHITE
    panel.colorSwatch.tex:SetColorTexture(c[1], c[2], c[3], 1)
    -- your reminder's colour is greyed and unused without Use custom colours (Raid Notes > Alerts); it stays saved
    local colourOn = CRT.Alerts:CustomColors()
    panel.colorSwatch:SetEnabled(colourOn)
    panel.colorDefault:SetEnabled(colourOn)
    panel.colorSwatch:SetAlpha(colourOn and 1 or 0.4)
    panel.colorLabel:SetAlpha(colourOn and 1 or 0.5)
    -- the selected row's times, as the list read them; typed times over the reference stay read only
    local text = item and item.timesRaw
    panel.times:SetText(text and text:gsub("; ", " · ") or TEXT.noTimes)
    local own = not (item and item.refHas)
    panel.times:SetShown(not own)
    panel.timesLabel:SetShown(own)
    panel.timesEdit:SetShown(own)
    panel.timesHelp:SetShown(own)
    if own then
        setBox(panel.timesEdit, d.keptTimes)
    end
    panel.message:SetText(notice and UI.BadText(notice) or "")
end

local saveTyped

-- Loads the selected row into the panel. A row already on show keeps its draft, unless its reminder was
-- made or changed elsewhere (a tick, the pop-out editor).
local function loadPanel(item, enc, name)
    if not item then
        -- nothing to show (a boss with no abilities yet): typing is saved, the boxes empty
        saveTyped(true)
        for _, edit in ipairs({ panel.textEdit, panel.timesEdit, panel.idEdit }) do
            edit:ClearFocus()
            setBox(edit, "", true)
        end
        cur = {}
        return
    end
    local key = itemKey(item)
    local Draft = CRT.AlertDraft
    local same = cur.key == key and cur.enc == enc
    if not same then
        -- typing belongs to the row it was typed on: saved there before the boxes change hands
        saveTyped(true)
        for _, edit in ipairs({ panel.textEdit, panel.timesEdit, panel.idEdit }) do
            edit:ClearFocus()
        end
    end
    cur.item, cur.bossName = item, name
    if same and typed and item.id and cur.ctx and cur.ctx.id ~= item.id then
        -- made while typing (a tick): the next save writes to it, never a second one
        cur.ctx.id, cur.ctx.reminder = item.id, Draft.copy(item.r)
    end
    local deleted = not item.r and cur.ctx and cur.ctx.id -- its reminder was deleted elsewhere
    if same and ((not item.r and not deleted) or typed) then
        return -- no saved reminder to read again, or typing not saved yet
    end
    if item.r then
        cur.ctx = { encounterID = enc, id = item.id, reminder = Draft.copy(item.r) }
        cur.draft = Draft.ForReminder(item.r)
        cur.draft.boss = cur.draft.boss or name
    elseif item.pending then
        -- a change in the panel never turns a reminder on: one it makes starts off, like its tick
        cur.ctx = { encounterID = enc, reminder = { enabled = false } }
        cur.draft = Draft.New()
        cur.draft.boss = name
    else
        cur.ctx = { encounterID = enc, reminder = { enabled = false } }
        cur.draft = Draft.ForSpell(item.spellID, itemName(item), name)
    end
    if not same then
        notice = nil
        typedGen = typedGen + 1
        if panel.lookupCtl then
            panel.lookupCtl:Hide()
        end
    end
    cur.key, cur.enc = key, enc
    setBox(panel.textEdit, cur.draft.text, not same)
    setBox(panel.idEdit, idText(cur.draft), not same)
    setBox(panel.timesEdit, cur.draft.keptTimes, not same)
end

-- The selected row's index in the list: the one holding a reminder just saved, the boss's last one,
-- else the first.
local function selectedIndex(enc)
    if not enc then
        return nil
    end
    if followID then
        for _, item in ipairs(items) do
            if item.id == followID then
                picked[enc] = itemKey(item)
            end
        end
        followID = nil
        reveal = true
    end
    local index
    for i, item in ipairs(items) do
        if itemKey(item) == picked[enc] then
            index = i
        end
    end
    if not index and items[1] then
        index = 1
        picked[enc] = itemKey(items[1])
    end
    return index
end

local function mix(c, to, t)
    return c[1] + (to[1] - c[1]) * t, c[2] + (to[2] - c[2]) * t, c[3] + (to[3] - c[3]) * t
end

-- A row name's colour: its main ability type's (Timeline/Reference.lua ABILITY_TYPES), dimmed when its reminder
-- is off and lifted on the selected row; with no known type the theme's text colour, or GREY when off.
local function nameColor(item, on, isSelected)
    local Colors = CRT.AlertColors
    local c = item.types and item.types[1] and Colors and Colors.KnownTypeColor(item.types[1])
    if not c then
        c = on and CRT.PALETTE.text or GREY
        return c[1], c[2], c[3]
    end
    if not on then
        c = { mix(c, GREY, TYPE_DIM) }
    end
    if isSelected then
        return mix(c, WHITE, TYPE_LIFT)
    end
    return c[1], c[2], c[3]
end

-- Hovering a row's name: the name, then each of its ability types in its colour, the main one first.
local function typeTip(owner, item)
    if not (item and not item.pending and GameTooltip) then
        return
    end
    GameTooltip:SetOwner(owner, "ANCHOR_RIGHT")
    GameTooltip:SetText(item.label or TEXT.unnamed, 1, 1, 1)
    local Reference = CRT.TimelineReference
    local any = false
    for _, key in ipairs(item.types or {}) do
        local line, c = Reference.TypeLine(key)
        if line then
            GameTooltip:AddLine(line, c[1], c[2], c[3], true)
            any = true
        end
    end
    if not any then
        GameTooltip:AddLine(TEXT.noType, 1, 1, 1, true)
    end
    GameTooltip:Show()
end

-- The visible rows from the list as it is: text, icons and colours only, no lookups. A scroll is only this.
local function paint(index)
    local maxOffset = math.max(0, #items - L.MAX_ROWS)
    offset = offset or 0
    if reveal and index then
        if index <= offset then
            offset = index - 1
        elseif index > offset + L.MAX_ROWS then
            offset = index - L.MAX_ROWS
        end
    end
    reveal = false
    offset = math.max(0, math.min(offset, maxOffset))
    local h = CRT.PALETTE.heading
    local selColor = { h[1], h[2], h[3], SEL_CLASSIC_ALPHA }
    if UI:IsModern() then
        local m = CRT.PALETTE.selected
        selColor = { m[1], m[2], m[3], SEL_MODERN_ALPHA }
    end
    for i, row in ipairs(rows) do
        local item = items[offset + i]
        if item then
            if item.unloaded then
                -- a spell name or icon loaded late: only these two are asked again, nothing else
                item.label, item.iconTex = itemName(item), itemIcon(item)
                item.unloaded = (item.label == TEXT.unnamed or item.iconTex == nil) or nil
            end
            local on = item.r ~= nil and item.r.enabled ~= false
            row.item = item
            row.icon:SetTexture(item.iconTex)
            row.icon:SetShown(item.iconTex ~= nil)
            row.name:SetText(item.label)
            row.name:SetTextColor(nameColor(item, on, offset + i == index))
            row.check:SetChecked(on)
            row.dot:SetShown(item.has)
            row.sel:SetColorTexture(selColor[1], selColor[2], selColor[3], selColor[4])
            row.sel:SetShown(offset + i == index)
            row.frame:Show()
        else
            row.item = nil
            row.frame:Hide()
        end
    end
    -- the scroll position, as a thin bar at the list's right edge
    if maxOffset > 0 then
        local h = math.max(12, math.floor(L.LIST_H * L.MAX_ROWS / #items))
        thumb:SetHeight(h)
        thumb:ClearAllPoints()
        thumb:SetPoint("TOPRIGHT", list, "TOPRIGHT", -L.THUMB_INSET, -math.floor((L.LIST_H - h) * offset / maxOffset))
        thumb:Show()
    else
        thumb:Hide()
    end
end

local function refresh(keepDraft)
    if not tab then
        return
    end
    local enc, name = pickBoss(bosses())
    items = itemsFor(enc, name)
    local index = selectedIndex(enc)
    paint(index)
    for _, d in ipairs({ bossDrop, diffDrop, fromDrop }) do
        d.refresh()
    end
    if markerCheck then
        markerCheck.refresh()
    end
    if saving then
        return -- the panel's own save: it redraws once the save is done
    end
    if not keepDraft then
        loadPanel(index and items[index], enc, name)
    else
        cur.item = index and items[index] or cur.item
    end
    drawPanel()
end

local function scrollBy(n)
    if not (tab and items) then
        return
    end
    offset = (offset or 0) + n
    paint(selectedIndex(pickBoss(bosses())))
end

local commit

-- Saves what was typed, if anything waits (Enter, leaving the box, a pause, another row or boss picked,
-- a tick, the tab hiding). `quiet`: a refresh is already loading the next row, so the save moves nothing.
saveTyped = function(quiet)
    if typed and cur.draft then
        commit(quiet)
    end
    typed = false
end

-- A box was typed in: it saves once the typing pauses, not on every key.
local function typing()
    typed = true
    typedGen = typedGen + 1
    local gen = typedGen
    C_Timer.After(L.TYPING_PAUSE, function()
        if gen == typedGen then
            saveTyped()
        end
    end)
end

-- A click on a row: the list is repainted and the panel loads it, with nothing read again.
local function selectItem(item)
    saveTyped()
    local enc, name = pickBoss(bosses())
    if not (enc and item and items) then
        return
    end
    picked[enc] = itemKey(item)
    local index = selectedIndex(enc)
    paint(index)
    loadPanel(index and items[index], enc, name)
    drawPanel()
end

-- Saves the panel's draft as its row's reminder, or shows why it can't be. The first change on an
-- ability or a new reminder of your own makes the reminder.
commit = function(quiet)
    local d, ctx = cur.draft, cur.ctx
    typed = false -- the whole draft is saved, typing included
    if not d then
        return false
    end
    local Draft = CRT.AlertDraft
    local problem
    if d.keptTimes then
        local found, err = CRT.AlertReminders.ParseTimes(d.keptTimes)
        if not found then
            problem = string.format(TEXT.badTimes, tostring(err))
        end
    end
    problem = problem or Draft.Problem(ctx, d)
    if problem then
        notice = problem
        drawPanel()
        return false
    end
    saving = true
    local ok, id, err = pcall(Draft.SaveMine, ctx, d)
    saving = false
    if not ok then
        geterrorhandler()(id)
        return false
    end
    if not id then
        notice = err
        drawPanel()
        return false
    end
    notice = nil
    ctx.id = id
    ctx.reminder = Draft.copy(CRT.AlertReminders:Get(ctx.encounterID, id))
    pendingOwn[ctx.encounterID] = nil -- saved: the new row is a reminder now, never left behind empty
    if quiet then
        return true
    end
    followID = id
    refresh(true)
    local enc = ctx.encounterID
    cur.key = picked[enc]
    return true
end

-- A field changed: `fn` edits the draft, then it is saved.
local function change(fn)
    return function(...)
        if not cur.draft then
            return
        end
        fn(...)
        commit()
    end
end

-- The tick on a row (and Alert me for the selected row): on makes or turns on its reminder, off turns
-- it off and keeps it. The selected row's new reminder is the panel's alert as it stands.
local function setEnabled(item, on)
    local enc, name = pickBoss(bosses())
    if not (item and enc) then
        return
    end
    -- typing waiting on this row is saved first; if that made its reminder, the tick is for that one
    local wasSelected = itemKey(item) == cur.key
    saveTyped()
    if wasSelected and not item.id and cur.ctx and cur.ctx.id then
        item = { id = cur.ctx.id }
    end
    local Reminders = CRT.AlertReminders
    local Draft = CRT.AlertDraft
    if item.id then
        local r = Reminders:Get(enc, item.id)
        if r then
            r.enabled = on
            if cur.ctx and cur.ctx.id == item.id and cur.ctx.reminder then
                cur.ctx.reminder.enabled = on -- the panel's next save keeps the tick
            end
            Reminders:Save(enc, item.id, r)
        end
    elseif on then
        if itemKey(item) == cur.key and cur.draft and not Draft.Problem(cur.ctx, cur.draft) then
            local r = Draft.BuildReminder(cur.ctx, cur.draft)
            r.enabled = true
            pendingOwn[enc] = nil
            followID = Reminders:Save(enc, nil, r)
            refresh()
        else
            if item.pending then
                pendingOwn[enc] = nil -- the new row is made now: listed once, and still selected
            end
            local id = Reminders:Save(enc, nil, { spellID = item.spellID, boss = name, text = itemName(item), enabled = true })
            if wasSelected then
                followID = id
                refresh()
            end
        end
    else
        refresh()
    end
end

local function onTick(row)
    setEnabled(row.item, row.check:GetChecked() and true or false)
end

local function showOnTimeline()
    local T = CRT.Timeline
    if not (cur.draft and cur.enc and T and T.ShowRow) then
        return
    end
    local name = draftName()
    local spell = CRT.AlertDraft.validID(cur.draft.spellID) or name
    local ok, found = pcall(T.ShowRow, T, cur.enc, spell, name)
    if not ok then
        geterrorhandler()(found)
    elseif not found then
        CRT:Print(TEXT.notOnTimeline)
    end
end

-- The game's color picker on the draft's color; Cancel puts the old one back.
local function pickColor()
    if not (cur.draft and ColorPickerFrame) or not CRT.Alerts:CustomColors() then
        return
    end
    local target = cur.draft -- a picker left open never writes into the next alert
    local before = cur.draft.color and CRT.AlertDraft.copy(cur.draft.color)
    UI.PickColor(cur.draft.color or WHITE, function(c)
        if cur.draft == target then
            target.color = { c[1], c[2], c[3], 1 }
            commit()
        end
    end, { cancel = function()
        if cur.draft == target then
            target.color = before
            commit()
        end
    end })
end

local function makeButton(parent, label, width, height)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontNormal)
    b:SetHighlightFontObject(CRTFontHighlight)
    b:SetDisabledFontObject(CRTFontDisable)
    b:SetSize(width, height or L.BUTTON_H)
    b:SetText(label)
    return b
end

local function makeCheck(parent, label, x, y, onClick)
    local check = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
    check:SetSize(L.CHECK_SIZE, L.CHECK_SIZE)
    check:SetPoint("TOPLEFT", x, y)
    local text = parent:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    text:SetPoint("LEFT", check, "RIGHT", 2, 0)
    text:SetWidth(L.CHECK_LABEL_W)
    text:SetJustifyH("LEFT")
    text:SetWordWrap(false)
    text:SetText(label)
    check.label = text
    check:SetScript("OnClick", function(self)
        onClick(self:GetChecked() and true or false)
    end)
    return check
end

local function heading(parent, label, x, y, helpText)
    local fs = parent:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    fs:SetPoint("TOPLEFT", x, y)
    fs:SetText(label)
    if helpText then
        UI.Help(parent, label, helpText):SetPoint("LEFT", fs, "RIGHT", 6, 0)
    end
    return fs
end

local function label(parent, text, x, y)
    local fs = parent:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    fs:SetPoint("TOPLEFT", x, y)
    fs:SetWidth(L.LABEL_W)
    fs:SetJustifyH("LEFT")
    fs:SetText(text)
    return fs
end

-- A one-line box of a fixed width: long text scrolls sideways inside it.
local function makeEdit(parent, x, y, width, onChange)
    local edit = CreateFrame("EditBox", nil, parent, "InputBoxTemplate")
    edit:SetAutoFocus(false)
    edit:SetMultiLine(false)
    edit:SetFontObject(CRTFontEdit)
    edit:SetSize(width, 20)
    edit:SetPoint("TOPLEFT", x, y)
    edit:SetScript("OnTextChanged", function(self)
        if not filling then
            onChange(self:GetText())
        end
    end)
    edit:SetScript("OnEnterPressed", function(self)
        saveTyped()
        self:ClearFocus()
    end)
    edit:SetScript("OnEditFocusLost", function()
        saveTyped()
    end)
    edit:SetScript("OnEscapePressed", function(self)
        self:ClearFocus()
    end)
    return edit
end

local function makeRow(parent, i)
    local frame = CreateFrame("Button", nil, parent)
    frame:SetSize(L.ROW_W, L.ROW_H - 2)
    frame:SetPoint("TOPLEFT", L.ROW_X, -2 - (i - 1) * L.ROW_H)
    local row = { frame = frame }
    row.sel = frame:CreateTexture(nil, "BACKGROUND")
    row.sel:SetAllPoints()
    row.sel:Hide()
    local hl = frame:CreateTexture(nil, "HIGHLIGHT")
    hl:SetAllPoints()
    hl:SetColorTexture(1, 1, 1, 0.06)
    row.check = CreateFrame("CheckButton", nil, frame, "UICheckButtonTemplate")
    row.check:SetSize(22, 22)
    row.check:SetPoint("LEFT", 2, 0)
    row.check:SetScript("OnClick", function()
        onTick(row)
    end)
    row.icon = frame:CreateTexture(nil, "ARTWORK")
    row.icon:SetSize(18, 18)
    row.icon:SetPoint("LEFT", 28, 0)
    row.icon:SetTexCoord(0.07, 0.93, 0.07, 0.93)
    row.name = frame:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    row.name:SetPoint("LEFT", L.NAME_X, 0)
    row.name:SetWidth(L.NAME_W)
    row.name:SetJustifyH("LEFT")
    row.name:SetWordWrap(false)
    row.dot = frame:CreateTexture(nil, "OVERLAY")
    row.dot:SetSize(L.DOT_SIZE, L.DOT_SIZE)
    row.dot:SetPoint("RIGHT", -8, 0)
    UI.Tint(row.dot, "SetColorTexture", "accent", 1)
    if row.dot.SetMask then
        row.dot:SetMask("Interface\\CharacterFrame\\TempPortraitAlphaMask") -- round
    end
    -- a click on the row, outside the tick, selects it
    frame:SetScript("OnClick", function()
        selectItem(row.item)
    end)
    frame:SetScript("OnEnter", function(self)
        typeTip(self, row.item)
    end)
    frame:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    return row
end

local function backdrop(f, alpha)
    if f.SetBackdrop then
        f:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
        local function paint()
            local bg, edge = CRT.PALETTE.background, CRT.PALETTE.border
            f:SetBackdropColor(bg[1] * 0.8, bg[2] * 0.8, bg[3] * 0.8, alpha)
            f:SetBackdropBorderColor(edge[1], edge[2], edge[3], 1)
        end
        paint()
        UI:OnTheme(paint) -- a darker background, so UI.Tint can't keep it
    end
end

local function buildPanel(f)
    local Draft = CRT.AlertDraft
    local frame = CreateFrame("Frame", nil, f, "BackdropTemplate")
    frame:SetSize(L.PANEL_W, L.PANEL_H)
    frame:SetPoint("TOPLEFT", L.PANEL_X, L.LIST_TOP)
    backdrop(frame, 0.6)
    panel.frame = frame
    local p = CreateFrame("Frame", nil, frame)
    p:SetPoint("TOPLEFT", frame, "TOPLEFT", 0, 0)
    p:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", 0, 0)
    panel.content = p
    panel.rows = {}
    local function row(r)
        panel.rows[#panel.rows + 1] = r
        return r
    end

    -- Header: the icon and name, Alert me, Save as
    panel.icon = p:CreateTexture(nil, "ARTWORK")
    panel.icon:SetSize(L.HEADER_ICON, L.HEADER_ICON)
    panel.icon:SetPoint("TOPLEFT", L.INSET, L.ICON_Y)
    panel.icon:SetTexCoord(0.07, 0.93, 0.07, 0.93)
    panel.name = p:CreateFontString(nil, "OVERLAY", "CRTFontLarge")
    panel.name:SetPoint("TOPLEFT", L.INSET + L.HEADER_ICON + 8, L.NAME_Y)
    panel.name:SetWidth(L.TITLE_W)
    panel.name:SetJustifyH("LEFT")
    panel.name:SetWordWrap(false)
    panel.alertMe = makeCheck(p, TEXT.alertMe, L.ALERT_X, L.ALERT_Y, function(on)
        setEnabled(cur.item, on)
    end)
    -- Raid note is greyed out here: a mechanic has several times, a note line one
    panel.saveAs = row(UI.Dropdown(p, TEXT.saveAs, {
        labelWidth = L.SAVE_LABEL, width = L.SAVE_W,
        options = function()
            return { { key = "note", label = TEXT.asNote, disabled = true }, { key = "mine", label = TEXT.asMine } }
        end,
        get = function() return "mine" end,
        set = function() drawPanel() end,
    }))
    panel.saveAs:SetPoint("TOPLEFT", L.SAVE_X, L.SAVE_Y)
    panel.saveAsHelp = UI.Help(p, TEXT.asNote, TEXT.raidNoteHelp)
    panel.saveAsHelp:SetPoint("TOPLEFT", L.SAVE_X + L.SAVE_LABEL + L.DROP_GAP + L.SAVE_W + 2, L.SAVE_HELP_Y)

    -- Triggers: Show from, Linger, the times (read only) and Show on the Timeline
    heading(p, TEXT.triggers, L.INSET, L.TRIGGERS_Y, TEXT.triggersHelp)
    local function seconds(v)
        return string.format(TEXT.seconds, v)
    end
    panel.showFrom = row(UI.Slider(p, TEXT.showFrom, {
        min = L.SHOW_MIN, max = L.SHOW_MAX, step = 1, labelWidth = L.SHOW_LABEL, width = L.SLIDER_W, format = seconds,
        onRelease = true, -- saved when the bar is let go, not on every step of a drag
        get = function() return cur.draft and cur.draft.warn or L.SHOW_DEFAULT end,
        set = change(function(v) cur.draft.warn = v end),
    }))
    panel.showFrom:SetPoint("TOPLEFT", L.INSET, L.SLIDERS_Y)
    panel.linger = row(UI.Slider(p, TEXT.linger, {
        min = L.LINGER_MIN, max = L.LINGER_MAX, step = 1, labelWidth = L.LINGER_LABEL, width = L.SLIDER_W, format = seconds,
        onRelease = true,
        get = function() return cur.draft and cur.draft.linger or L.LINGER_MIN end,
        set = change(function(v) cur.draft.linger = v end),
    }))
    panel.linger:SetPoint("TOPLEFT", L.INSET + L.SHOW_LABEL + L.DROP_GAP + L.SLIDER_W + L.SLIDER_VALUE + L.SLIDER_GAP, L.SLIDERS_Y)
    panel.times = p:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    panel.times:SetPoint("TOPLEFT", L.INSET, L.TIMES_Y)
    panel.times:SetWidth(L.PANEL_W - 2 * L.INSET)
    panel.times:SetJustifyH("LEFT")
    panel.times:SetWordWrap(false)
    panel.times:SetTextColor(TIMES_GREY[1], TIMES_GREY[2], TIMES_GREY[3])
    -- in its place, for an alert the reference has no times for: its own typed times
    panel.timesLabel = label(p, TEXT.times, L.INSET, L.TIMES_Y)
    panel.timesEdit = makeEdit(p, L.INSET + L.LABEL_W + 4, L.TIMES_BOX_Y, L.PANEL_W - 2 * L.INSET - L.LABEL_W - 4 - L.HELP_ROOM, function(text)
        if not cur.draft then
            return
        end
        local times = Draft.trim(text) ~= "" and text or nil
        if times ~= cur.draft.keptTimes then
            cur.draft.keptTimes = times
            typing()
        end
    end)
    panel.timesHelp = UI.Help(p, TEXT.times, TEXT.timesHelp)
    panel.timesHelp:SetPoint("LEFT", panel.timesEdit, "RIGHT", 2, 0)
    panel.timelineBtn = makeButton(p, TEXT.showOnTimeline, L.TIMELINE_W)
    panel.timelineBtn:SetPoint("TOPLEFT", L.INSET, L.TIMELINE_Y)
    panel.timelineBtn:SetScript("OnClick", showOnTimeline)

    -- Left column: Show as, Also
    heading(p, TEXT.showAs, L.INSET, L.COL_Y, TEXT.showAsHelp)
    panel.checks = {}
    for _, spec in ipairs({ { "alert", TEXT.nextSpell, 0, 1 }, { "text", TEXT.showText, 1, 1 }, { "icon", TEXT.showIcon, 2, 1 },
        { "bar", TEXT.bar, 0, 2 }, { "circle", TEXT.circle, 1, 2 }, { "timeline", TEXT.timeline, 2, 2 } }) do
        local key = spec[1]
        local x = L.INSET - 4 + spec[3] * (spec[3] == 2 and L.CHECK_STEP_NARROW or L.CHECK_STEP)
        panel.checks[key] = makeCheck(p, spec[2], x, L.COL_Y - 20 - (spec[4] - 1) * 26, change(function(on)
            cur.draft.show[key] = on
        end))
    end
    heading(p, TEXT.also, L.INSET, L.COL_Y - 78)
    panel.also = {
        speak = makeCheck(p, TEXT.speak, L.INSET - 4, L.COL_Y - 98, change(function(on) cur.draft.speak = on end)),
        count = makeCheck(p, TEXT.count, L.INSET - 4 + L.CHECK_STEP, L.COL_Y - 98, change(function(on) cur.draft.count = on end)),
        glow = makeCheck(p, TEXT.glow, L.INSET - 4, L.COL_Y - 124, change(function(on) cur.draft.glow = on end)),
    }
    -- Speak at: when Speak the text says it, On show or At 0; greyed while Speak the text is off
    panel.speakAt = row(UI.Dropdown(p, TEXT.speakAt, {
        labelWidth = L.SPEAK_AT_LABEL, width = L.SPEAK_AT_W,
        enabledIf = function() return cur.draft ~= nil and cur.draft.speak and true or false end,
        options = Draft.SpeakAtOptions(TEXT.onShow, TEXT.atZero),
        get = function() return Draft.SpeakAtKey(cur.draft) end,
        set = change(function(v) Draft.SetSpeakAt(cur.draft, v) end),
    }))
    panel.speakAt:SetPoint("TOPLEFT", L.INSET + L.CHECK_STEP, L.COL_Y - 124) -- in line with Glow at 0

    -- Right column: Look and sound
    heading(p, TEXT.look, L.COL2_X, L.COL_Y)
    label(p, TEXT.text, L.COL2_X, L.COL_Y - 26)
    panel.textEdit = makeEdit(p, L.COL2_X + L.LABEL_W + 4, L.COL_Y - 22, L.COL_W - L.LABEL_W - 8, function(text)
        if cur.draft and text ~= cur.draft.text then
            cur.draft.text = text
            typing()
        end
    end)
    panel.iconType = row(UI.Dropdown(p, TEXT.icon, {
        labelWidth = L.LABEL_W, width = L.ICON_DROP_W,
        options = { { key = "spell", label = TEXT.iconSpell }, { key = "id", label = TEXT.iconID } },
        get = function() return cur.draft and cur.draft.iconType or "spell" end,
        set = change(function(v)
            cur.draft.iconType = v
            filling = true
            panel.idEdit:SetText(idText(cur.draft))
            filling = false
        end),
    }))
    panel.iconType:SetPoint("TOPLEFT", L.COL2_X, L.COL_Y - 46)
    panel.idEdit = makeEdit(p, L.ID_X, L.COL_Y - 52, L.ID_W, function(text)
        if not cur.draft or panel.lookupCtl:Text(text) then
            return -- letters look a name up and change nothing
        end
        local before = idText(cur.draft)
        Draft.SetID(cur.draft, tonumber(Draft.trim(text)))
        if idText(cur.draft) ~= before then
            typing()
        end
    end)
    panel.idEdit:SetScript("OnEditFocusGained", function()
        lookupFrom = cur.draft and Draft.validID(cur.draft.spellID)
    end)
    UI.Help(p, TEXT.icon, TEXT.iconHelp):SetPoint("LEFT", panel.idEdit, "RIGHT", 2, 0)
    panel.lookupCtl = CRT.AlertSpellLookup.Attach(panel.idEdit, {
        encounterID = function() return cur.enc end,
        boss = function() return cur.draft and cur.draft.boss end,
        enabled = function() return cur.draft ~= nil end,
        levelFrame = p,
        alignRight = true,
        onCommit = function() saveTyped() end,
        onPick = function(m)
            if not cur.draft then
                return
            end
            local id, text = Draft.ApplyPick(cur.draft, m, lookupFrom)
            lookupFrom = nil
            filling = true
            if text then
                panel.textEdit:SetText(text)
            end
            if id then
                panel.idEdit:SetText(tostring(id))
            end
            filling = false
            commit()
        end,
        -- closed without a pick: letters left in the box give way to the alert's ID again
        onClose = function()
            if cur.draft and Draft.trim(panel.idEdit:GetText()):find("%a") then
                filling = true
                panel.idEdit:SetText(idText(cur.draft))
                filling = false
            end
        end,
    })
    panel.lookup = panel.lookupCtl.list
    panel.colorLabel = label(p, TEXT.color, L.COL2_X, L.COL_Y - 86)
    panel.colorSwatch = CreateFrame("Button", nil, p)
    panel.colorSwatch:SetSize(20, 20)
    panel.colorSwatch:SetPoint("TOPLEFT", L.COL2_X + L.LABEL_W + 4, L.COL_Y - 82)
    local edge = panel.colorSwatch:CreateTexture(nil, "BACKGROUND")
    edge:SetAllPoints()
    edge:SetColorTexture(0.5, 0.5, 0.5, 1)
    panel.colorSwatch.tex = panel.colorSwatch:CreateTexture(nil, "ARTWORK")
    panel.colorSwatch.tex:SetPoint("TOPLEFT", 1, -1)
    panel.colorSwatch.tex:SetPoint("BOTTOMRIGHT", -1, 1)
    panel.colorSwatch:SetScript("OnClick", pickColor)
    panel.colorDefault = makeButton(p, TEXT.colorDefault, L.DEFAULT_W)
    panel.colorDefault:SetPoint("TOPLEFT", L.COL2_X + L.LABEL_W + 32, L.COL_Y - 81)
    panel.colorDefault:SetScript("OnClick", change(function()
        if CRT.Alerts:CustomColors() then
            cur.draft.color = nil
        end
    end))
    panel.sound = row(UI.SoundDropdown(p, TEXT.sound, {
        labelWidth = L.LABEL_W, width = L.SOUND_W, maxHeight = L.MENU_MAX_H, playButton = true,
        options = function() return Draft.SoundOptions(TEXT.soundNone) end,
        get = function() return cur.draft and Draft.SoundKey(cur.draft.sound) or Draft.NO_SOUND end,
        set = change(function(v) cur.draft.sound = v ~= Draft.NO_SOUND and v or nil end),
    }))
    panel.sound:SetPoint("TOPLEFT", L.COL2_X, L.COL_Y - 106)
    -- Under Sound: the same sound as an aura sound when the spell lands on you (Sound/Auras.lua).
    panel.auraSound = makeCheck(p, TEXT.auraSound, L.COL2_X - 4, L.COL_Y - 134, change(function(on)
        cur.draft.auraSound = on
    end))
    panel.auraSound.label:SetWidth(L.COL_W - L.CHECK_SIZE - 30)
    UI.Help(p, TEXT.auraSound, TEXT.auraSoundHelp):SetPoint("LEFT", panel.auraSound.label, "RIGHT", 2, 0)

    -- A save's problem, in red
    panel.message = p:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    panel.message:SetPoint("TOPLEFT", L.INSET, L.COL_Y - 162)
    panel.message:SetWidth(L.PANEL_W - 2 * L.INSET)
    panel.message:SetJustifyH("LEFT")

    -- Bottom right: Test, Save as template
    panel.templateBtn = makeButton(p, TEXT.template, L.TEMPLATE_W)
    panel.templateBtn:SetPoint("BOTTOMRIGHT", -L.INSET, L.BOTTOM_Y)
    panel.templateBtn:SetScript("OnClick", function()
        if not cur.draft then
            return
        end
        local ok, err = CRT.AlertEditor:AskTemplateName(cur.ctx, cur.draft, function(message)
            notice = message
            drawPanel()
        end)
        if not ok and err then
            notice = err
            drawPanel()
        end
    end)
    -- Delete: a reminder of your own, after a confirmation; a new one not saved yet is just dropped. The
    -- row after it (else before it) is selected next. Shown by drawPanel only for your own reminders.
    panel.deleteBtn = makeButton(p, TEXT.delete, L.DELETE_W)
    panel.deleteBtn:SetPoint("BOTTOMRIGHT", -L.INSET - L.TEMPLATE_W - L.BUTTON_GAP - L.TEST_W - L.BUTTON_GAP, L.BOTTOM_Y)
    panel.deleteBtn:SetScript("OnClick", function()
        local item = cur.item
        local enc = pickBoss(bosses())
        if not (item and enc and items) or item.ability then
            return
        end
        local function forget()
            -- typing waiting to save would bring the reminder back
            typed = false
            typedGen = typedGen + 1
            notice = nil
            local nextKey
            for i, other in ipairs(items) do
                if other == item then
                    local neighbour = items[i + 1] or items[i - 1]
                    nextKey = neighbour and itemKey(neighbour) or nil
                end
            end
            picked[enc] = nextKey
            reveal = true
        end
        if item.pending then
            forget()
            pendingOwn[enc] = nil
            refresh()
            return
        end
        local id = item.id
        UI.LiftOver(UI.ShownPopup(StaticPopup_ShowCustomGenericConfirmation({
            text = string.format(TEXT.deleteConfirm, itemName(item)),
            acceptText = TEXT.delete,
            cancelText = CANCEL,
            showAlert = true,
            callback = function()
                local saved = CRT.AlertReminders:Get(enc, id)
                if not saved or saved.spellID ~= (item.r and item.r.spellID) then
                    return -- changed or gone since the click
                end
                forget()
                CRT.AlertReminders:Delete(enc, id) -- fires the alerts change, which redraws the tab
            end,
        }), "GENERIC_CONFIRMATION"))
    end)

    panel.testBtn = makeButton(p, TEXT.test, L.TEST_W)
    panel.testBtn:SetPoint("BOTTOMRIGHT", -L.INSET - L.TEMPLATE_W - L.BUTTON_GAP, L.BOTTOM_Y)
    panel.testBtn:SetScript("OnClick", function()
        -- typing still waiting is saved first, so the test (and the Rehearsal's saved copy) has it
        saveTyped()
        if not cur.draft then
            return
        end
        local ok, err = CRT.AlertEditor:TestDraft(cur.ctx, cur.draft)
        if not ok then
            notice = err or TEXT.noTest
            drawPanel()
        end
    end)
    return frame
end

local function build(f)
    tab = f
    local tabH = CRT.NotesPage.TAB_H
    L.LIST_H = tabH + L.LIST_TOP - L.PAD - L.OWN_H - L.OWN_GAP
    L.MAX_ROWS = math.floor((L.LIST_H - 4) / L.ROW_H)
    L.PANEL_H = tabH + L.LIST_TOP - L.PAD
    selected, viewDiff, offset = nil, nil, 0
    cur, notice, picked, pendingOwn = {}, nil, {}, {}
    allChanged()

    local title = f:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    title:SetPoint("TOPLEFT", L.PAD, -14)
    title:SetText(TEXT.title)
    UI.Help(f, TEXT.title, TEXT.help):SetPoint("LEFT", title, "RIGHT", 6, 0)

    bossDrop = UI.Dropdown(f, TEXT.boss, {
        labelWidth = L.BOSS_LABEL,
        width = L.BOSS_W,
        options = function()
            local Bosses = CRT.Bosses
            return Bosses and Bosses.Options and Bosses:Options() or {}
        end,
        get = function()
            return (pickBoss(bosses()))
        end,
        set = function(key)
            if type(key) ~= "number" then
                return -- a raid heading is not a boss
            end
            saveTyped()
            selected, viewDiff, offset = key, nil, 0
            reveal = true
            refresh()
        end,
    })
    bossDrop:SetPoint("TOPLEFT", L.BOSS_X, L.TOP_Y)

    diffDrop = UI.Dropdown(f, TEXT.difficulty, {
        labelWidth = L.DIFF_LABEL,
        width = L.DIFF_W,
        options = function()
            local out = { { key = ANY, label = TEXT.any } }
            local seen = {}
            for _, entry in ipairs(bossRefs()) do
                local d = entry.ref.difficulty
                if type(d) == "string" and d ~= "" and not seen[lower(d)] then
                    seen[lower(d)] = true
                    out[#out + 1] = { key = d, label = d }
                end
            end
            return out
        end,
        get = function()
            return viewDiff or ANY
        end,
        set = function(key)
            viewDiff = key ~= ANY and key or nil
            refresh()
        end,
    })
    diffDrop:SetPoint("TOPLEFT", L.DIFF_X, L.TOP_Y)

    fromDrop = UI.Dropdown(f, TEXT.timesFrom, {
        labelWidth = L.FROM_LABEL,
        width = L.FROM_W,
        options = function()
            local out = {}
            for _, entry in ipairs(bossRefs()) do
                out[#out + 1] = { key = entry.key, label = CRT.TimelineReference.Label(entry.ref) }
            end
            return out
        end,
        get = function()
            local entry = shownReference()
            return entry and entry.key
        end,
        set = function(key)
            for _, entry in ipairs(bossRefs()) do
                if entry.key == key then
                    local d = entry.ref.difficulty
                    viewDiff = (type(d) == "string" and d ~= "") and d or nil
                end
            end
            refresh()
        end,
    })
    fromDrop:SetPoint("TOPLEFT", L.FROM_X, L.TOP_Y)
    UI.Help(f, TEXT.timesFromHelpTitle, TEXT.timesFromHelp):SetPoint("LEFT", fromDrop, "RIGHT", 6, 0)

    -- Left: the list, scrolled with the mouse wheel
    list = CreateFrame("Frame", nil, f, "BackdropTemplate")
    list:SetSize(L.LIST_W, L.LIST_H)
    list:SetPoint("TOPLEFT", L.PAD, L.LIST_TOP)
    backdrop(list, 0.8)
    f.list = list
    rows = {}
    for i = 1, L.MAX_ROWS do
        rows[i] = makeRow(list, i)
    end
    f.rows = rows
    thumb = list:CreateTexture(nil, "OVERLAY")
    thumb:SetWidth(L.THUMB_W)
    UI.Tint(thumb, "SetColorTexture", "accent", 0.7)
    thumb:Hide()
    f.thumb = thumb
    list:EnableMouseWheel(true)
    list:SetScript("OnMouseWheel", function(_, delta)
        scrollBy(delta > 0 and -1 or 1)
    end)
    f.scroll = scrollBy

    ownButton = makeButton(f, TEXT.ownReminder, L.LIST_W, L.OWN_H)
    ownButton:SetPoint("TOPLEFT", L.PAD, L.LIST_TOP - L.LIST_H - L.OWN_GAP)
    ownButton:SetScript("OnClick", function()
        saveTyped()
        local enc = pickBoss(bosses())
        if enc then
            pendingOwn[enc] = true
            picked[enc] = "new"
            reveal = true
            refresh()
        end
    end)
    f.ownButton = ownButton

    -- Right: the selected row's alert
    buildPanel(f)
    f.panel = panel

    -- The boss's marker display (Markers/Display.lua), when it has one: each player's on/off. It sits
    -- at the bottom left of the panel.
    local p = panel.frame
    markerCheck = CreateFrame("CheckButton", nil, p, "UICheckButtonTemplate")
    markerCheck:SetSize(L.CHECK_SIZE, L.CHECK_SIZE)
    markerCheck:SetPoint("BOTTOMLEFT", L.INSET - 4, L.BOTTOM_Y - 1)
    local markerText = p:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    markerText:SetPoint("LEFT", markerCheck, "RIGHT", 2, 0)
    markerText:SetWidth(L.PANEL_W - L.INSET - L.CHECK_SIZE - 2 - L.HELP_ROOM - L.BUTTONS_W - L.INSET)
    markerText:SetJustifyH("LEFT")
    markerText:SetWordWrap(false)
    local markerHelp = UI.Help(p, TEXT.markerTitle, TEXT.markerHelp)
    markerHelp:SetPoint("LEFT", markerText, "RIGHT", 4, 0)
    markerCheck:SetScript("OnClick", function(self)
        local enc = pickBoss(bosses())
        if enc then
            CRT.MarkerDisplay:SetEnabled(enc, self:GetChecked() and true or false)
        end
    end)
    markerCheck.refresh = function()
        local enc = pickBoss(bosses())
        local def = enc and CRT.MarkerDisplay and CRT.MarkerDisplay:For(enc)
        markerCheck:SetShown(def ~= nil)
        markerText:SetShown(def ~= nil)
        markerHelp:SetShown(def ~= nil)
        if def then
            markerText:SetText(string.format(TEXT.markerShow, def.name or TEXT.markerTitle))
            markerCheck:SetChecked(CRT.MarkerDisplay:Enabled(enc))
        end
    end

    f:SetScript("OnShow", function()
        allChanged() -- anything may have changed while it was hidden
        refresh()
    end)
    -- closed or another tab picked: typing waiting is saved, and the boxes let go
    f:SetScript("OnHide", function()
        saveTyped()
        for _, edit in ipairs({ panel.textEdit, panel.timesEdit, panel.idEdit }) do
            edit:ClearFocus()
        end
    end)
    if not listening then
        listening = true
        CRT.Alerts:OnChange(function()
            listChanged()
            if tab and tab:IsShown() then
                refresh()
            end
        end)
        -- the active note changed: its boss leads the list
        if CRT.Notes and CRT.Notes.OnChange then
            CRT.Notes:OnChange(function()
                data.bosses = nil
                if tab and tab:IsShown() then
                    refresh()
                end
            end)
        end
        -- a spell's name and icon arrived: the rows still waiting for one are painted again
        local loader = CreateFrame("Frame")
        loader:RegisterEvent("SPELL_DATA_LOAD_RESULT")
        loader:SetScript("OnEvent", function()
            if tab and tab:IsShown() and items then
                for _, item in ipairs(items) do
                    if item.unloaded then
                        paint(selectedIndex(pickBoss(bosses())))
                        return
                    end
                end
            end
        end)
        -- the boss route changed (the Development page's Boss order): the list is read again
        if CRT.Bosses and CRT.Bosses.OnRouteChange then
            CRT.Bosses:OnRouteChange(function()
                allChanged()
                if tab and tab:IsShown() then
                    refresh()
                end
            end)
        end
        -- a reference added, changed or deleted: the bosses, references and times are read again
        if CRT.Timeline and CRT.Timeline.OnChange then
            CRT.Timeline:OnChange(function()
                allChanged()
                if tab and tab:IsShown() then
                    refresh()
                end
            end)
        end
    end
    refresh()
end

CRT.NoteReminders = {
    Build = build,
    -- Opens the Mech Alerts tab on a boss with one of its Journal abilities selected (by spell ID), as
    -- the Timeline's Journal list does with Make a Mech Alert.
    Open = function(encounterID, spellID)
        if encounterID == nil then
            return
        end
        if saveTyped then
            saveTyped() -- typing waiting to save belongs to the row it was typed on
        end
        selected, viewDiff = encounterID, nil
        if spellID then
            picked[encounterID] = "a:" .. tostring(spellID)
            reveal = true
        end
        CRT.NotesPage.Open("reminders")
        refresh()
    end,
    Refresh = function()
        allChanged()
        refresh()
    end,
    BossList = bossList,
}
