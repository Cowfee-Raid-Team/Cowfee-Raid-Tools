local ADDON, CRT = ...

-- The alert editor: one popout window for every alert, a line of the boss's raid note or one of your
-- own reminders. It opens from a double-click on the Timeline and from the Timeline's chips, edits a
-- draft (Alerts/Draft.lua), and saves it through Draft.SaveNote as a note line (Notes:AddLine or
-- ReplaceLine, through Parser.FormatLine) or through Draft.SaveMine as a reminder (CRT.AlertReminders).
-- Switching Save as on a saved alert moves it: the new place is written first, then the old one
-- removed. A note line is only ever written back over the raw line it was opened from, so a note
-- changed elsewhere (a new share) is never overwritten blind.
-- Test runs the draft as it stands on screen without saving anything: its items go to a block of their
-- own ("minetest") that gives them out only to a run started with reason "test". A note line's item is
-- the note block's own (CRT.NoteEngine.ItemFor) and stays a "note" item, so the note's switches apply.
-- When the Timeline's Rehearsal window can open (CRT.TimelineRehearsalWindow:OpenAt), Test opens it
-- instead, with the draft's items added and its saved version left out (Alerts:Start's opts.extra and
-- opts.replaces). The quick test above is the fallback: no window, the window refusing (its reason
-- printed), or no fight time. Either way a test plays only around the alert's first cast: from TEST_BEFORE
-- seconds before it shows to TEST_AFTER seconds after it is done (testWindow). The window's run carries the
-- Test button's tag (opts.tag), so that button reads Stop and Stop closes the window (BindTest, StopTest).
-- Export shows the draft as a note line in a copy box.
-- Under the header (Save as, For, Difficulty, Saves to) the settings sit on the subtabs the Mech Alerts panel has
-- (Alerts/SubTabs.lua): When (Relative to and Time, or the casts; Show from, Linger), Looks (Show as, Text, Icon,
-- Color), Sound and speech (Sound, Speak at, Also) and Shield bar. The buttons and the message line stay under them.
-- Shield bar (its tab; greyed while Bar is off) makes the alert's bar a shield bar (Alerts/Absorb.lua): the shared
-- section of Alerts/ShieldSection.lua (Shield on, Seconds to break, Any time it goes up, Last pull with its Use buttons),
-- in its wide layout, on the draft's shield, saved as a reminder's absorb or a note line's shield:.
-- Only the raid leader or an assistant changes the raid note (CRT.Notes:CanEditRaid): for anyone else
-- Save as Raid note is greyed out, a new alert set to it opens as Only me, a note line opens read-only
-- (ctx.readOnly: nothing can be changed, no Save or Delete) with Export and Copy to my reminders, which
-- turns the draft into a new reminder of your own. Every raid note write asks CanEditRaid again.
-- Save as saved alert keeps the draft's setup, without its time, as a saved alert (CRT.AlertSaved), and
-- Open takes prefill.saved to start from one. EditSaved opens a saved alert itself: no Save as saved alert,
-- Export, Relative to, Time or Difficulty; Save overwrites it (keeping the name its chip gave it, and
-- making nothing once it was deleted), and Test plays it as phase 1, NO_TIME seconds in.

local TEXT = {
    title = "Alert",
    saveAs = "Save as",
    asNote = "Raid note",
    asMine = "Only me",
    forLabel = "For",
    everyone = "Everyone",
    noOne = "No one (timers window only)",
    me = "Me",
    tanks = "Tanks",
    healers = "Healers",
    damage = "Damage",
    melee = "Melee",
    ranged = "Ranged",
    group = "Group %d",
    difficulty = "Difficulty",
    groupNH = "Normal/Heroic", -- your own alert's two choices
    groupMythic = "Mythic",
    any = "Any", -- a raid note line's: the boss's note with no difficulty
    normal = PLAYER_DIFFICULTY1 or "Normal",
    heroic = PLAYER_DIFFICULTY2 or "Heroic",
    mythic = PLAYER_DIFFICULTY6 or "Mythic",
    savesTo = "Saves to: %s",
    newNote = "a new note for this boss",
    noteName = "%s (%s)",
    relativeTo = "Relative to",
    pull = "Pull",
    phase = "Phase %s",
    time = "Time",
    timeHelpTitle = "Time",
    timeHelp = "Minutes:seconds or plain seconds, from the pull or from the start of the phase in "
        .. "Relative to: 1:30 or 90.\n\nA reminder with several times keeps them all until you change "
        .. "Relative to or Time.",
    showFrom = "Duration",
    showFromHelp = "How long before the specified time this alert should start showing up",
    linger = "Linger",
    seconds = "%d s",
    icon = "Icon",
    iconSpell = "Spell",
    iconID = "Icon ID",
    iconHelpTitle = "Icon",
    iconHelp = "Spell: type the spell's ID. The alert shows its icon and, with no text, its name.\n\n"
        .. "Icon ID: type an icon's file ID to show that icon instead.\n\n"
        .. "Or type a spell name (3 letters or more) to search this boss's abilities and your own "
        .. "spells (a close spelling works too), then click one or press Enter for the top match.",
    text = "Text",
    color = "Color",
    colorDefault = "Default",
    showAs = "Show as",
    callout = "Note callout/assignments",
    showText = "Critical alerts text",
    showIcon = "Icon",
    bar = "Bar",
    circle = "Circle",
    timeline = "Alert timeline",
    also = "Also",
    speak = "Speak the text",
    count = "Count down 3 2 1",
    glow = "Glow at 0",
    sound = "Sound",
    none = "None",
    speakAt = "Speak at",
    onShow = "On show",
    atZero = "At 0",
    fromPrefix = "From ",
    timesPrefix = "Times: ",
    castsPrefix = "Casts: ",
    castsHelpTitle = "Casts",
    castsHelp = "This alert follows its ability's casts on the ability timeline, so it has no time of its own.\n\n"
        .. "On the Timeline, drag a flag to move that cast's alert, delete it to turn that cast off, or "
        .. "Alt+drag a flag next to it to turn it back on.",
    noTimes = "No times",
    delete = "Delete",
    deleteConfirm = "Delete this alert?",
    export = "Export",
    exportTitle = "Alert as a note line",
    test = "Test",
    stop = "Stop",
    save = "Save",
    saveAsSaved = "Save As Template",
    savedNamePrompt = "Name this template:",
    savedAccept = ACCEPT or "Accept",
    savedTitle = "Template: %s",
    savedTitleNew = "New template",
    savedMade = "Template \"%s\" saved.",
    deleteSavedConfirm = "Delete this template?",
    savedFailed = "The template could not be saved.",
    savedGone = "This template was deleted, so there is nothing to save it to. Cancel to close.",
    cancel = CANCEL or "Cancel",
    testInPull = "Test is off during a pull.",
    testTrigger = "Nothing to test: this alert starts in phase %s, which waits for its trigger.",
    testBlock = "Alert test",
    noRehearsal = "%s Running the quick test instead.",
    reopen = "You can change the raid note now. Close this line and open it again to edit it.",
    noteLineTitle = "Raid note line",
    copyToMine = "Copy to my reminders",
}

local Alerts = CRT.Alerts
local Reminders = CRT.AlertReminders
local Draft = CRT.AlertDraft
local DTEXT = Draft.TEXT
local UI = CRT.UI

local Editor = {}
CRT.AlertEditor = Editor

local TEST_BLOCK = "minetest"
-- A test plays only around the alert: from TEST_BEFORE seconds before it first shows (0: right at its Show from,
-- or its bar's own start, so the alert is on screen the moment Test is clicked) to TEST_AFTER seconds after it is done (its bar's end, then its Linger).
local TEST_BEFORE = 0
local TEST_AFTER = 5
local NO_TIME = 10 -- a saved alert or a special alert has no time of its own: a test plays it this far into phase 1
local ANY = "any"    -- a raid note line's difficulty dropdown key for its note with no difficulty (saved as nil)
local NO_SOUND = Draft.NO_SOUND
local FRAME_NAME = "CowfeeRaidToolsAlertEditor"
local EXPORT_NAME = "CowfeeRaidToolsAlertExport"
local WIDTH, HEIGHT = 600, 360
-- Under the header (Save as, For, Difficulty and the Saves to line): the subtabs (Alerts/SubTabs.lua, shared with the
-- Mech Alerts panel) with a rule under them, then the open tab's rows from CONTENT_Y (C below)
local TABS_Y, RULE_Y, C = -82, -106, -116
local SHOW_KEYS = Draft.SHOW_KEYS
local LEFT = 16
local MENU_MAX_HEIGHT = 400 -- the For and Sound menus scroll past this (a full raid is taller than the screen)
local FIELD_X = 91 -- where the boxes and checkboxes of the labelled rows start
local SHOW_CHECK_W = 26 -- a Show as box and the gap before its label
local SHOW_GAP = 10     -- between one Show as label and the next box
local SHOW_ROW = 26     -- between Show as's two rows
local SAVED_SHIFT = 34 -- a saved alert has no Relative to / Time row: Show from and Linger move up by this
local BOTTOM, BUTTON_H, MESSAGE_GAP = 14, 24, 8 -- the buttons above the window's bottom edge; the message above them
local EXPORT_CHROME = 56 -- the copy window above and below its text box
local EXPORT_PAD, EXPORT_MIN_TEXT, EXPORT_MAX_TEXT = 6, 16, 180
local EXPORT_WIDTH = WIDTH - 88 -- the text box
local EXPORT_TEXT_WIDTH = EXPORT_WIDTH - 2 * EXPORT_PAD
local PREVIEW_INSET = 16 -- the editor Previews opens sits this far into the screen's bottom right corner
local SPEAK_AT_X, SPEAK_AT_LABEL, SPEAK_AT_W = 316, 56, 104 -- Speak at, beside Sound and its Play button under the Also row
local ID_WIDTH = 140 -- the Spell / Icon ID box, wide enough for a spell name being looked up
local ID_SHIFT = ID_WIDTH - 80 -- the (?), preview and name sit this much right of where an 80 px box put them

local POPUP_NAME = "COWFEE_RAID_TOOLS_SAVED_ALERT_NAME"

local frame, exportFrame
-- ctx: where the draft came from. { encounterID, id (a reminder) and reminder (its saved copy), or
-- noteID, line, expected (the raw line), timer, noteDifficulty, untagged and readOnly (opened by someone
-- who can't change the raid note) for a note line; or, for a
-- saved alert itself, savedMode, savedID (nil for a new one) and savedName }
local ctx
-- draft: the fields on screen. { saveAs, tag, difficulty, ph, timeText, timeTouched, keptTimes, spellID,
-- iconType, iconID, text, color, show = { alert, text, icon, bar, circle }, speak, count, glow, sound,
-- warn, linger, boss, baseDifficulty (a reminder's own), difficultyTouched }
local draft
local notice -- the message from the last Save, Test or Delete, shown until the draft changes
local testItems
local testOwner -- the Test button whose click is starting a quick test (BindTest), stamped on that run as its tag
local inCorner -- Previews put the editor in the corner, so closing it puts it back
local previewDraft -- the empty draft Previews opened, so Previews only ever closes that one

-- The draft itself and how it becomes a reminder are in Alerts/Draft.lua, shared with the Mech Alerts
-- panel; the name lookup of the Spell / Icon ID box is Alerts/SpellLookup.lua.
local trim, copy, readable = Draft.trim, Draft.copy, Draft.readable
local validID, parseTime, words = Draft.validID, Draft.parseTime, Draft.words
local canEditRaid = Draft.CanEditRaid

local function lower(s)
    return trim(s):lower()
end

-- The reason Raid note is greyed out, from CRT.Notes:CanEditRaid (empty when you may change it).
local function notAdminReason()
    local _, why = canEditRaid()
    return why or ""
end

-- A raid note line opened by someone who can't change it: shown, never edited.
local function readOnly()
    return ctx ~= nil and ctx.readOnly == true
end

local function editable()
    return not readOnly()
end

-- The Color row: a raid note line's colour is the raid leader's and always shows; your own alert's (Only me, as
-- a reminder or a template) only with Use custom colours on (Alerts:CustomColors), so it is greyed without.
local function colourEditable()
    return (draft ~= nil and draft.saveAs == "note") or CRT.Alerts:CustomColors()
end

-- "m:ss" for whole seconds; a note line's time with a fraction stays plain seconds.
local function clock(t, exact)
    if exact and t ~= math.floor(t) then
        return (("%.10g"):format(t))
    end
    t = math.floor(t + 0.5)
    return string.format("%d:%02d", math.floor(t / 60), t % 60)
end

local function spellInfo(id)
    id = validID(id)
    if not id then
        return nil, nil
    end
    local name = Reminders.SpellName(id)
    local icon
    if C_Spell and C_Spell.GetSpellTexture then
        local ok, tex = pcall(C_Spell.GetSpellTexture, id)
        if ok and readable(tex) and tex ~= nil then
            icon = tex
        end
    end
    return name, icon
end

-- The draft as reminder text fields, for Reminders:Times.
local function timesProbe()
    return Draft.TimesProbe(draft)
end

-- The time the box shows for times kept from Stage 1: the first of the lowest phase.
local function firstTime(list)
    local ph, t
    for _, e in ipairs(list) do
        if not ph or e.ph < ph or (e.ph == ph and e.t < t) then
            ph, t = e.ph, e.t
        end
    end
    return ph, t
end

local function keepsTimes()
    return Draft.KeepsTimes(ctx, draft)
end

local function timeError(strict)
    return Draft.TimeError(ctx, draft, strict)
end

local function anyOutput()
    return Draft.AnyOutput(draft)
end

-- The draft as note lines, and the note one is saved to, are Alerts/Draft.lua's (shared with a cooldown
-- placed from the Timeline).

-- The fields of the raw line the editor opened that FormatLine doesn't write, kept on the end of the line.
local function keptFields()
    return Draft.KeptFields(ctx)
end

-- The times of a reminder moving here (keepsTimes), or nil.
local function keptTimeList()
    return Draft.KeptTimeList(ctx, draft)
end

-- The draft as note line timers: one per time of a reminder moving here (keepsTimes), else one.
local function noteTimers()
    return Draft.NoteTimers(ctx, draft)
end

local function buildReminder()
    return Draft.BuildReminder(ctx, draft)
end

-- Choices -----------------------------------------------------------------------------------------

local function playerName()
    local name = UnitName and UnitName("player")
    if readable(name) and type(name) == "string" and name ~= "" then
        return name
    end
    return nil
end

-- The names of your raid or party, without you, in name order.
local function roster()
    local out = {}
    local raid = IsInRaid and IsInRaid()
    local n = GetNumGroupMembers and GetNumGroupMembers() or 0
    for i = 1, raid and n or (n - 1) do
        local name, realm = UnitName((raid and "raid" or "party") .. i)
        if readable(name) and type(name) == "string" and name ~= "" then
            if readable(realm) and type(realm) == "string" and realm ~= "" then
                name = name .. "-" .. realm
            end
            out[#out + 1] = name
        end
    end
    table.sort(out)
    return out
end

-- The game's classes: { file, name } with file the class file name ("DEATHKNIGHT"), which is what a
-- note line's tag carries, so it matches on every client whatever its language.
local function classes()
    local out = {}
    for i = 1, GetNumClasses and GetNumClasses() or 0 do
        local name, file = GetClassInfo(i)
        if readable(name) and readable(file) and type(name) == "string" and name ~= ""
            and type(file) == "string" and file ~= "" then
            out[#out + 1] = { file = file, name = name }
        end
    end
    return out
end

-- A tag that is one class name in any spelling ("Demon Hunter", "DEMONHUNTER", Notes/Parse.lua's class
-- words), as the class file name; any other tag as it is.
local function classTag(tag)
    return CRT.NoteParser.ClassOf(tag) or tag
end

-- Who a note line is for, as its tag: everyone, you, a role, a class, a group or a name; and the line's
-- own tag when none of those is it. A line with no tag alerts no one (it only shows in the timers
-- window), so it has a choice of its own.
local function forOptions()
    local out, seen = {}, {}
    local function add(key, label)
        if not seen[key:lower()] then
            seen[key:lower()] = true
            out[#out + 1] = { key = key, label = label }
        end
    end
    add("everyone", TEXT.everyone)
    local me = playerName()
    if me then
        add(me, TEXT.me)
    end
    add("tank", TEXT.tanks)
    add("healer", TEXT.healers)
    add("dps", TEXT.damage)
    add("melee", TEXT.melee)
    add("ranged", TEXT.ranged)
    for _, c in ipairs(classes()) do
        add(c.file, c.name)
    end
    for g = 1, 8 do
        add("G" .. g, string.format(TEXT.group, g))
    end
    for _, name in ipairs(roster()) do
        add(name, name)
    end
    if draft and (draft.tag == "" or (ctx and ctx.untagged)) then
        add("", TEXT.noOne)
    end
    if draft and draft.tag ~= "" then
        add(draft.tag, draft.tag)
    end
    return out
end

-- Your own alert (Only me, or a template): Normal/Heroic and Mythic, the Timeline's two groups. A raid
-- note line, which goes to one of the boss's notes: "Any" first, the boss's reference difficulties, the
-- raid difficulties, and the draft's own.
local function difficultyOptions()
    if not (draft and draft.saveAs == "note") then
        return Draft.GroupOptions(TEXT.groupNH, TEXT.groupMythic)
    end
    local out = { { key = ANY, label = TEXT.any } }
    local seen = {}
    local function add(d)
        if type(d) == "string" and trim(d) ~= "" and not seen[lower(d)] then
            seen[lower(d)] = true
            out[#out + 1] = { key = d, label = d }
        end
    end
    local Ref = CRT.TimelineReference
    if Ref and ctx then
        for _, entry in ipairs(Ref:ForBoss(ctx.encounterID, draft and draft.boss)) do
            add(entry.ref.difficulty)
        end
    end
    add(TEXT.normal)
    add(TEXT.heroic)
    add(TEXT.mythic)
    add(draft and draft.difficulty)
    return out
end

-- The note a raid note line saved now goes to (Draft.TargetNote). Nil: a new note is made.
local function targetNote()
    return Draft.TargetNote(ctx, draft)
end

-- The Difficulty a new raid note line starts on (Draft.DefaultDifficulty): that of the note the pull you
-- are in would read, or, outside a raid, of the boss's only note. Nil (Any) when there is no such note.
local function defaultDifficulty()
    return Draft.DefaultDifficulty(ctx and ctx.encounterID)
end

-- Save as changed, or the editor opened: a draft whose difficulty you haven't picked takes the raid
-- note's default as a note line, and its own (a reminder's Difficulty text, if any) otherwise. Only me
-- keeps its difficulty group in draft.group, untouched here.
local function applyDefaultDifficulty()
    if draft.difficultyTouched or (ctx and ctx.noteID) or draft.baseDifficulty ~= nil then
        return
    end
    draft.difficulty = draft.saveAs == "note" and defaultDifficulty() or nil
end

-- Pull, then a Phase N for every later phase the boss has, and the draft's own.
local function phaseOptions()
    local list = { 1 }
    local seen = { [1] = true }
    local ok, phases = pcall(Alerts.PhasesFor, Alerts, { encounterID = ctx and ctx.encounterID })
    for _, ph in ipairs(ok and type(phases) == "table" and phases or {}) do
        if type(ph) == "number" and not seen[ph] then
            seen[ph] = true
            list[#list + 1] = ph
        end
    end
    if draft and type(draft.ph) == "number" and not seen[draft.ph] then
        list[#list + 1] = draft.ph
    end
    table.sort(list)
    local out = {}
    for _, ph in ipairs(list) do
        out[#out + 1] = { key = ph, label = ph == 1 and TEXT.pull or string.format(TEXT.phase, tostring(ph)) }
    end
    return out
end

local function soundOptions()
    return Draft.SoundOptions(TEXT.none)
end

-- Showing the draft -------------------------------------------------------------------------------

-- The difficulty group the previews read the ability timeline for (Draft.PreviewGroup).
local function previewGroup()
    return Draft.PreviewGroup(draft)
end

-- An alert on a boss ability's casts, as Mech Alerts lists them: each with its shift, and "(off)" for a
-- cast turned off. The saved reminder's shifts and off ride on the draft's probe.
local function castsLine()
    local probe = timesProbe()
    local saved = ctx and ctx.reminder
    if saved then
        probe.shifts, probe.off = saved.shifts, saved.off
    end
    local list = Reminders.AllCasts(ctx and ctx.encounterID, probe, nil, previewGroup())
    return #list > 0 and Reminders.FormatCasts(list) or TEXT.noTimes
end

-- Where the times come from while a reminder's own are kept (also when it moves to the raid note).
local function sourceLine()
    if not keepsTimes() then
        return ""
    end
    local list, source = Reminders:Times(ctx and ctx.encounterID, timesProbe(), nil, previewGroup())
    if source == "typed" then
        return TEXT.timesPrefix .. draft.keptTimes
    elseif source == "reference" and #list > 0 then
        local ref = Reminders.ReferenceFor(ctx and ctx.encounterID, timesProbe(), previewGroup())
        if ref then
            return TEXT.fromPrefix .. CRT.TimelineReference.Label(ref)
        end
    end
    return TEXT.noTimes
end

-- The note a raid note line saves to, by name and difficulty.
local function savesToLine()
    if draft.saveAs ~= "note" or not (ctx and type(ctx.encounterID) == "number") then
        return ""
    end
    local record = CRT.Notes:Get(targetNote())
    if not record then
        return string.format(TEXT.savesTo, TEXT.newNote)
    end
    local name = record.name or ""
    if record.difficulty then
        name = string.format(TEXT.noteName, name, record.difficulty)
    end
    return string.format(TEXT.savesTo, name)
end

-- The Color row: a raid note line's colour is the raid leader's; yours (Only me) is greyed and unused without Use
-- custom colours, and kept as saved.
local function colourRow()
    if not (frame and draft) then
        return
    end
    local colourOn = not readOnly() and colourEditable()
    frame.colorSwatch:SetEnabled(colourOn)
    frame.colorDefault:SetEnabled(colourOn)
    frame.colorSwatch:SetAlpha(colourOn and 1 or 0.4)
    frame.colorLabel:SetAlpha(colourOn and 1 or 0.5)
end

-- Use custom colours ticked or unticked (Raid Notes > Alerts fires the alerts' change) greys the open editor's row.
CRT.Alerts:OnChange(function()
    if frame and frame:IsShown() then
        colourRow()
    end
end)

-- Everything on the window from the draft, except the boxes being typed in. `rows` also redraws the
-- dropdowns and sliders (on open and when one of them is set), so typing never rebuilds their menus.
local function refresh(rows)
    if not (frame and draft) then
        return
    end
    local savedMode = ctx ~= nil and ctx.savedMode == true
    -- a raid note line opened read-only, by someone promoted since: editable as for any leader
    if ctx ~= nil and ctx.readOnly and canEditRaid() then
        ctx.readOnly = nil
        UI.SetFrameTitle(frame, TEXT.title)
        rows = true
    end
    frame.forRow:SetShown(draft.saveAs == "note")
    -- an alert on a boss ability (Only me) follows its casts: its casts in place of Relative to and Time
    local casts = not savedMode and Draft.FollowsCasts(ctx, draft)
    frame.relativeRow:SetShown(not savedMode and not casts)
    frame.difficultyRow:SetShown(not savedMode)
    frame.timeLabel:SetShown(not savedMode and not casts)
    frame.timeEdit:SetShown(not savedMode and not casts)
    frame.timeHelp:SetShown(not savedMode and not casts)
    frame.castsText:SetShown(casts)
    frame.castsHelp:SetShown(casts)
    frame.castsText:SetText(casts and (TEXT.castsPrefix .. castsLine()) or "")
    local locked = readOnly()
    frame.saveSavedBtn:SetShown(not savedMode and not locked)
    frame.exportBtn:SetShown(not savedMode) -- a saved alert has no time to write a note line with
    frame.saveBtn:SetShown(not locked)
    frame.copyBtn:SetShown(locked)
    -- a copy needs a boss to be saved for
    frame.copyBtn:SetEnabled(locked and type(ctx.encounterID) == "number")
    -- why Raid note is greyed out (a saved alert may keep Raid note: it changes no note by itself)
    frame.saveAsHelp:SetShown(not savedMode and not canEditRaid())
    for _, el in ipairs({ frame.textEdit, frame.timeEdit, frame.idEdit }) do
        el:SetEnabled(not locked)
    end
    colourRow()
    if locked then
        frame.lookupCtl:Hide()
    end
    for _, k in ipairs(SHOW_KEYS) do
        frame.checks[k]:SetEnabled(not locked)
    end
    for _, check in pairs(frame.also) do
        check:SetEnabled(not locked)
    end
    if rows then
        for _, row in ipairs(frame.rows) do
            row.refresh()
        end
    end
    local name, icon = spellInfo(draft.spellID)
    if draft.iconType == "id" then
        icon = validID(draft.iconID)
    end
    frame.iconPreview:SetTexture(icon)
    frame.iconPreview:SetShown(icon ~= nil)
    frame.spellName:SetText(name or "")
    for _, k in ipairs(SHOW_KEYS) do
        frame.checks[k]:SetChecked(draft.show[k] and true or false)
    end
    frame.also.speak:SetChecked(draft.speak and true or false)
    frame.also.count:SetChecked(draft.count and true or false)
    frame.also.glow:SetChecked(draft.glow and true or false)
    frame.shield.Refresh() -- its dropdown and slider are among frame.rows, redrawn above
    frame.tabs:Paint(draft) -- each tab's dot: something on it is on
    local c = draft.color or { 1, 1, 1 }
    frame.colorSwatch.tex:SetColorTexture(c[1], c[2], c[3], 1)
    frame.sourceText:SetText(casts and "" or sourceLine())
    frame.savesText:SetText(savesToLine())
    local message = timeError(false) or notice
    if message then
        frame.messageText:SetText(UI.BadText(message))
    elseif Draft.TimelineOnlyNote(draft) then
        -- a warning, not an error: it still saves
        frame.messageText:SetText(UI.WarnText(Draft.TEXT.timelineOnly))
    else
        frame.messageText:SetText("")
    end
    frame.deleteBtn:SetShown(not locked and ctx ~= nil and (ctx.id ~= nil or ctx.noteID ~= nil or ctx.savedID ~= nil))
end

-- A field changed: any message about the last Save is out of date.
local function changed(rows)
    notice = nil
    refresh(rows)
end

local function fail(message)
    notice = message
    refresh()
    return false
end

-- Spell lookup --------------------------------------------------------------------------------------
-- The Spell / Icon ID box takes a name too (CRT.AlertSpellLookup): a pick puts the spell (or, in Icon ID
-- mode, its icon) in the box. Letters never change the draft by themselves.

local lookupFrom -- the spell when the box took the focus: text naming it is refilled by a pick

local function hideLookup()
    if frame and frame.lookupCtl then
        frame.lookupCtl:Hide()
    end
end

-- The list closed without a pick: letters left in the box give way to the alert's ID again.
local function putIDBack()
    if not (draft and frame) or readOnly() or not trim(frame.idEdit:GetText()):find("%a") then
        return
    end
    local id = draft.iconType == "id" and draft.iconID or draft.spellID
    frame.idEdit:SetText(tostring(id or ""))
end

-- A match picked: the spell (or its icon) goes in the draft and the box, and text that was empty or only
-- named the previous spell becomes the new spell's name. Typed text stays.
local function pickMatch(m)
    if not (draft and m) or readOnly() then
        return
    end
    local id, text = Draft.ApplyPick(draft, m, lookupFrom)
    lookupFrom = nil
    if text then
        frame.textEdit:SetText(text)
    end
    if id then
        frame.idEdit:SetText(tostring(id))
    end
    changed()
end

-- The box's text changed: letters look a name up (leaving the draft alone), a number is the ID.
local function idTextChanged(text)
    if not draft then
        return
    end
    if frame.lookupCtl:Text(text) then
        return
    end
    Draft.SetID(draft, tonumber(trim(text)))
    changed()
end

-- Saving and testing ------------------------------------------------------------------------------

local function applyPosition()
    frame:ClearAllPoints()
    frame:SetPoint("CENTER", UIParent, "CENTER", 0, 0)
end

-- Back to the centre if Previews had put the editor in the corner.
local function leaveCorner()
    if inCorner then
        inCorner = false
        applyPosition()
    end
end

-- The editor's window (nil until first opened), for a drag on the Timeline released over it.
function Editor:Frame()
    return frame
end

function Editor:Close()
    if frame then
        frame:Hide()
        leaveCorner()
    end
    if exportFrame then
        exportFrame:Hide()
    end
    ctx, draft, notice = nil, nil, nil
end

-- Saving a note line is Alerts/Draft.lua's (Draft.SaveNote, shared with a cooldown placed from the
-- Timeline): the window closes on success and shows the message otherwise.
local function saveNote()
    local ok, err = Draft.SaveNote(ctx, draft)
    if not ok then
        return fail(err)
    end
    Editor:Close()
    return true
end

local function saveMine()
    local ok, err = Draft.SaveMine(ctx, draft)
    if not ok then
        return fail(err)
    end
    Editor:Close()
    return true
end

-- The draft as a saved alert's fields (CRT.AlertSaved:Save keeps only the ones a saved alert has). No
-- name: Save keeps the stored one, so a rename on its chip while the editor is open stays.
local function savedFields()
    local r = buildReminder()
    r.saveAs = draft.saveAs
    r.tags = words(draft.tag)
    return r
end

-- Saving a saved alert itself: overwrites it, or makes it for a new one. One deleted while it was open
-- (from its chip) is not made again.
local function saveSaved()
    local Saved = CRT.AlertSaved
    if ctx.savedID and not (Saved and Saved:Get(ctx.savedID)) then
        return fail(TEXT.savedGone)
    end
    if not (Saved and Saved:Save(ctx.savedID, savedFields())) then
        return fail(TEXT.savedFailed)
    end
    Editor:Close()
    return true
end

-- Saves the draft and closes. A time that does not read, nothing ticked, or a note line changed
-- elsewhere leaves the window open with the message shown.
function Editor:Save()
    if not (ctx and draft) then
        return false
    end
    if ctx.readOnly then
        -- promoted since it opened, before anything redrew it
        local allowed, why = canEditRaid()
        return fail(allowed and TEXT.reopen or why)
    end
    local err = timeError(true)
    if err then
        return fail(err)
    end
    if not anyOutput() then
        return fail(DTEXT.nothing)
    end
    if ctx.savedMode then
        return saveSaved()
    end
    if draft.saveAs == "note" then
        return saveNote()
    end
    return saveMine()
end

-- The draft's test items: a note line's through the note block's own builder (block "note"), a
-- reminder's through Reminders:Items (ids "mine:test:n"). Returns items, the lowest phase and its first
-- time, or nil when a reminder has no times. A saved alert has no time: NO_TIME seconds into phase 1.
-- Only the editor's own draft is ever a raid note line (noteTimers reads it). group and ref (optional) are
-- the difficulty group and the ability timeline the Rehearsal plays, so the test reads its casts.
local function testItemsFor(c, d, group, ref)
    local items, list = {}, {}
    if d.saveAs == "note" then
        for i, t in ipairs(noteTimers()) do
            if c.savedMode then
                t.ph, t.time = 1, NO_TIME
            end
            local item = CRT.NoteEngine.ItemFor(t, i, true)
            item.id = "note:test:" .. i
            item.block = "note"
            items[i] = item
            list[i] = { ph = t.ph, t = t.time }
        end
    else
        local r = Draft.BuildReminder(c, d)
        if c.savedMode then
            r.times = Reminders.FormatTimes({ { ph = 1, t = NO_TIME } })
        end
        list = Reminders:Times(c.encounterID, r, ref, group)
        if #list == 0 then
            return nil
        end
        items = Reminders:Items(c.encounterID, "test", r, group, ref)
    end
    local lowest, first = firstTime(list)
    return items, lowest, first
end

-- What the Rehearsal shows as "Testing: <name>": the draft's text, else its spell's name.
local function testLabel(d)
    if trim(d.text) ~= "" then
        return trim(d.text)
    end
    return Reminders.SpellName(validID(d.spellID)) or TEXT.testBlock
end

-- The saved version of the tested alert, which the Rehearsal leaves out (Alerts:Start's opts.replaces). A reminder
-- saved as Raid note plays through its note lines, not as your own (Notes/MechNote.lua): those lines, by their marker,
-- so the test plays once and never beside one of them.
local function savedIdentity(c)
    if c.id ~= nil then
        local M = CRT.MechNote
        local n = M and type(c.encounterID) == "number" and M.InNote(Reminders:Get(c.encounterID, c.id))
        if n then
            return { block = "note", mech = n.key }
        end
        return { block = "mine", id = c.id }
    elseif c.noteID ~= nil and c.line ~= nil then
        return { block = "note", noteID = c.noteID, line = c.line }
    end
    return nil
end

-- Seconds before an item's time that it first shows: its Show from, or its bar's own start when earlier.
local function itemLead(it)
    local lead = (type(it.warn) == "number" and it.warn > 0) and it.warn or 0
    if type(it.barStart) == "number" and -it.barStart > lead then
        lead = -it.barStart
    end
    return lead
end

-- Seconds after an item's time that it is done: its bar's end (its own barEnd, which a reminder's ticked bar sets
-- at the cast; else, for a special alert's ticks only, Rules.TICK_TAIL past its last impact unless its bar ends at
-- the cast; a shield bar's absorb.length, as a Test starts it at the cast, Alerts/Absorb.lua), then its Linger (hold),
-- which the bar keeps after its end.
local function itemTail(it)
    local finish = type(it.barEnd) == "number" and it.barEnd or 0
    if type(it.absorb) == "table" and type(it.absorb.length) == "number" then
        finish = math.max(finish, it.absorb.length)
    end
    if type(it.barEnd) ~= "number" and type(it.ticks) == "table" and it.barTo ~= "cast" then
        local last
        for _, tk in ipairs(it.ticks) do
            local v = type(tk) == "table" and (tk.t or tk.at or tk[1]) or tk
            if type(v) == "number" and (not last or v > last) then
                last = v
            end
        end
        if last then
            finish = last + CRT.AlertRules.TICK_TAIL
        end
    end
    return math.max(0, finish) + (type(it.hold) == "number" and it.hold or 0)
end

-- What a test plays around the first cast (phase lowest, `first` seconds in): it starts `before` seconds
-- ahead of that cast (TEST_BEFORE before the alert shows) and ends `after` seconds past it (TEST_AFTER after
-- the alert is done). Later casts are left out.
local function testWindow(items, lowest, first)
    local lead, tail = 0, 0
    for _, it in ipairs(items) do
        local t = tonumber(it.time)
        if (it.ph == nil or it.ph == lowest) and t and math.abs(t - first) < 0.01 then
            lead = math.max(lead, itemLead(it))
            tail = math.max(tail, itemTail(it))
        end
    end
    return lead + TEST_BEFORE, tail + TEST_AFTER
end

-- Opens the Rehearsal on the boss TEST_BEFORE seconds before the draft first shows (testWindow) at its
-- first fight second, playing the fight with the draft as it stands on screen in place of its saved
-- version, and ending the test TEST_AFTER seconds after that cast's alert is done (the window's stopAt),
-- so a test shows just that alert and a little either side. True when it opened; false (the quick test
-- runs instead) when the window is missing or can't open, or the draft has no fight time or boss. A
-- reason from the window is printed once.
local function rehearse(c, d)
    local W = CRT.TimelineRehearsalWindow
    if not (W and W.OpenAt) or c.savedMode or type(c.encounterID) ~= "number" then
        return false
    end
    local first, difficulty, ref, group = Draft.FirstFightTime(c, d)
    if not first then
        return false
    end
    local items, lowest, phaseFirst = testItemsFor(c, d, group, ref)
    if not items or #items == 0 then
        return false
    end
    for _, it in ipairs(items) do
        it.block = it.block or TEST_BLOCK
    end
    -- OpenAt itself stops a quick test still going; a real pull never gets here (runTest)
    local before, after = testWindow(items, lowest, phaseFirst)
    local ok, why = W:OpenAt(c.encounterID, difficulty, first - before, {
        group = group,
        testing = testLabel(d),
        stopAt = first + after,
        tag = testOwner, -- which Test button opened it (BindTest): that button then reads Stop
        alerts = { extra = items, replaces = savedIdentity(c) },
    })
    if ok then
        return true
    end
    if type(why) == "string" and why ~= "" then
        CRT:Print(string.format(TEXT.noRehearsal, why))
    end
    return false
end

-- The quick test: a "test" run of only these items (ids "mine:test:", "note:test:" or "special:test:"),
-- starting TEST_BEFORE seconds before the first of them shows (phase lowest, `first` seconds in; testWindow).
-- True, or false and the message when that phase waits for an event. The run stops by itself TEST_AFTER
-- seconds after that first one is done (never a newer run: it checks the run is still this one).
local function quickTest(encounterID, items, lowest, first)
    local before, after = testWindow(items, lowest, first)
    testItems = items
    Alerts:Start(encounterID, nil, "test", {
        blocks = { [TEST_BLOCK] = true },
        filter = function(_, item)
            local id = type(item.id) == "string" and item.id or ""
            return (id:find("^mine:test:") or id:find("^note:test:") or id:find("^special:test:")) ~= nil
        end,
        firstAt = GetTime() + before - first,
        tag = testOwner or "quick", -- which Test button started it (BindTest)
    })
    testItems = nil
    -- A lowest phase with an event trigger waits for its event, so the test would show nothing.
    if Alerts.running and Alerts.run and Alerts.run.reason == "test" and not Alerts:PhaseStart(lowest) then
        Alerts:Stop()
        return false, string.format(TEXT.testTrigger, tostring(lowest))
    end
    local run = Alerts.running and Alerts.run
    if run and run.reason == "test" and C_Timer and C_Timer.After then
        C_Timer.After(before + after, function()
            if Alerts.running and Alerts.run == run then
                Alerts:Stop()
            end
        end)
    end
    return true
end

-- Tests a draft: in the Rehearsal when it can open (rehearse), else alone as a quick test around its
-- first time (quickTest). Saves nothing. True, or false and the message (none when the
-- draft simply has no times).
local function runTest(c, d)
    -- A real pull is never cut short by a test.
    if Alerts.running and Alerts.run and Alerts.run.reason == "encounter" then
        return false, TEXT.testInPull
    end
    local err = Draft.Problem(c, d)
    if err then
        return false, err
    end
    if rehearse(c, d) then
        return true
    end
    local items, lowest, first = testItemsFor(c, d, Draft.PreviewGroup(d))
    if not items then
        return false
    end
    return quickTest(c.encounterID or 0, items, lowest, first)
end

-- Tests the draft on screen.
function Editor:Test()
    if not (ctx and (ctx.encounterID or ctx.savedMode) and draft) then
        return false
    end
    local ok, err = runTest(ctx, draft)
    if not ok then
        if err then
            return fail(err)
        end
        refresh()
        return false
    end
    return true
end

-- Tests an Only me draft from elsewhere (the Mech Alerts panel) the same way: ctx is { encounterID, id,
-- reminder }. True, or false and the message.
function Editor:TestDraft(c, d)
    if not (c and c.encounterID and d) or d.saveAs == "note" then
        return false
    end
    return runTest(c, d)
end

-- Tests one alert item that isn't a draft (a special alert, Alerts/Special.lua) the same quick way: it
-- plays alone, as phase 1 NO_TIME seconds in, with TEST_BEFORE seconds before it shows. Never during a pull.
-- True, or false and the message.
function Editor:TestItem(encounterID, item)
    if Alerts.running and Alerts.run and Alerts.run.reason == "encounter" then
        return false, TEXT.testInPull
    end
    if type(item) ~= "table" then
        return false
    end
    local it = {}
    for k, v in pairs(item) do
        it[k] = v
    end
    it.id = "special:test:" .. tostring(item.special or 1)
    it.ph, it.time = 1, NO_TIME
    return quickTest(type(encounterID) == "number" and encounterID or 0, { it }, 1, NO_TIME)
end

-- The Test buttons ---------------------------------------------------------------------------------
-- The editor's Test, the Mechanics panel's and the Special panel's all go through BindTest, so they behave alike:
-- the button reads Stop while the test it started is running, and a click then ends that run at once (its
-- alert, bar and speech go with it). The test is the quick test (reason "test") or, when Test opened the Rehearsal,
-- that window's run (reason "rehearsal"; Stop then closes the window). Either run is told apart by the tag the
-- button put on it, so a pull, a countdown, a Rehearsal the player opened, the Notes tab's own test and another
-- button's test are never stopped by it.
-- The label follows the engine (Alerts:OnChange), including the run ending on its own after the alert played.

local bound = setmetatable({}, { __mode = "k" }) -- [button] = owner

-- Whether the engine is running the test that owner's button started, and its reason.
local function ownTest(owner)
    local run = Alerts.running and Alerts.run
    if type(run) == "table" and type(owner) == "string" and run.tag == owner
        and (run.reason == "test" or run.reason == "rehearsal") then
        return true, run.reason
    end
    return false
end

local function paintTests()
    for btn, owner in pairs(bound) do
        btn:SetText(ownTest(owner) and TEXT.stop or TEXT.test)
    end
end

-- Ends the test owner's button started. True when it did; false (and nothing stops) for any other run. A test that
-- opened the Rehearsal ends by closing the window, which stops its run (the window's own close path).
function Editor:StopTest(owner)
    local own, reason = ownTest(owner)
    if not own then
        return false
    end
    local W = CRT.TimelineRehearsalWindow
    if reason == "rehearsal" and W and W.Close then
        W:Close()
    end
    if ownTest(owner) then
        Alerts:Stop()
    end
    paintTests()
    return true
end

-- Makes btn a Test button for owner (a short name, one per place): Test runs start() (which starts the test through
-- Editor:Test, TestDraft or TestItem and handles its own message), Stop ends the test. btn keeps its size and place.
function Editor:BindTest(btn, owner, start)
    bound[btn] = owner
    btn:SetScript("OnClick", function()
        if Editor:StopTest(owner) then
            return
        end
        testOwner = owner
        local ok, err = pcall(start)
        testOwner = nil
        paintTests()
        if not ok then
            error(err, 0)
        end
    end)
    btn:SetText(ownTest(owner) and TEXT.stop or TEXT.test)
end

Alerts:OnChange(paintTests)

-- The draft's items, given out once and only to a test run. A note line's item keeps block "note".
Alerts:RegisterBlock(TEST_BLOCK, { label = TEXT.testBlock, group = true, keepBlock = true, Entries = function(run)
    if not (run and run.reason == "test" and testItems) then
        return {}
    end
    return testItems
end })

-- The window ------------------------------------------------------------------------------------

local function makeButton(parent, label, width)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontNormal)
    b:SetHighlightFontObject(CRTFontHighlight)
    b:SetDisabledFontObject(CRTFontDisable)
    b:SetSize(width, 24)
    b:SetText(label)
    return b
end

local function lay(el, x, y)
    el:SetPoint("TOPLEFT", x, y)
    return el
end

-- The rows under the Relative to / Time row on the When tab (Show from and Linger), so a saved alert's editor, which
-- has no time, can close the gap.
local shifted = {}

local function applyLayout(savedMode)
    local d = savedMode and SAVED_SHIFT or 0
    for _, p in ipairs(shifted) do
        p[1]:ClearAllPoints()
        p[1]:SetPoint("TOPLEFT", p[2], p[3] + d)
    end
end

local function makeLabel(parent, label, x, y)
    local fs = parent:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    lay(fs, x, y)
    fs:SetText(label)
    return fs
end

-- onChange(text, userInput): userInput is false when the editor itself set the text.
local function makeEdit(parent, x, y, width, onChange)
    local edit = CreateFrame("EditBox", nil, parent, "InputBoxTemplate")
    edit:SetAutoFocus(false)
    edit:SetFontObject(CRTFontEdit)
    edit:SetSize(width, 20)
    lay(edit, x, y)
    edit:SetScript("OnTextChanged", function(self, userInput)
        if readOnly() then
            return -- the box is disabled, and a read-only draft is filled before its boxes are
        end
        onChange(self:GetText(), userInput)
    end)
    edit:SetScript("OnEnterPressed", function(self)
        self:ClearFocus()
    end)
    edit:SetScript("OnEscapePressed", function(self)
        self:ClearFocus()
    end)
    return edit
end

local function makeCheck(parent, label, x, y, onClick)
    local check = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
    check:SetSize(24, 24)
    lay(check, x, y)
    local text = parent:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    text:SetPoint("LEFT", check, "RIGHT", 2, 0)
    text:SetText(label)
    check.label = text
    check:SetScript("OnClick", function(self)
        onClick(self:GetChecked() and true or false)
    end)
    return check
end

-- A setter for a dropdown, slider or checkbox: edits the draft (when there is one) and redraws. A
-- read-only draft is only redrawn, which puts the control back.
local function setter(fn)
    return function(v)
        if draft then
            if readOnly() then
                refresh(true)
                return
            end
            fn(v)
            changed(true)
        end
    end
end

function Editor:ResetPosition()
    if frame then
        applyPosition()
    end
end

-- The box Export opens: the note line, selected, to copy with Ctrl+C. Typing in it puts the line back.
local function buildExport()
    if exportFrame then
        return
    end
    local x = CreateFrame("Frame", EXPORT_NAME, UIParent, "BasicFrameTemplateWithInset")
    UI:StyleWindow(x)
    exportFrame = x
    x:SetSize(WIDTH - 40, EXPORT_CHROME + EXPORT_MIN_TEXT + 2 * EXPORT_PAD)
    x:SetPoint("CENTER", frame, "CENTER", 0, 0)
    x:SetClampedToScreen(true)
    x:EnableMouse(true)
    -- above every window, not on the "panel" layer (that one follows the main window's strata)
    x:SetFrameStrata("FULLSCREEN_DIALOG")
    UI.SetFrameTitle(x, TEXT.exportTitle)
    tinsert(UISpecialFrames, EXPORT_NAME)
    x.text = ""
    -- A plain multi-line box on its own backdrop (the line template's art is one row tall), inside a
    -- scroll frame for text taller than the window has room for. Its height follows the measured text.
    local box = CreateFrame("Frame", nil, x, "BackdropTemplate")
    x.box = box
    box:SetPoint("TOPLEFT", LEFT + 4, -40)
    box:SetWidth(EXPORT_WIDTH)
    box:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    UI.Tint(box, "SetBackdropColor", "surface", 0.95)
    UI.Tint(box, "SetBackdropBorderColor", "accent", 1)
    local scroll = CreateFrame("ScrollFrame", nil, box)
    x.scroll = scroll
    scroll:SetPoint("TOPLEFT", EXPORT_PAD, -EXPORT_PAD)
    scroll:SetWidth(EXPORT_TEXT_WIDTH)
    local edit = CreateFrame("EditBox", nil, scroll)
    x.edit = edit
    edit:SetMultiLine(true)
    edit:SetAutoFocus(false)
    edit:SetFontObject(CRTFontEdit)
    edit:SetWidth(EXPORT_TEXT_WIDTH)
    scroll:SetScrollChild(edit)
    scroll:EnableMouseWheel(true)
    scroll:SetScript("OnMouseWheel", function(self, delta)
        local top = math.max(0, edit:GetHeight() - self:GetHeight())
        self:SetVerticalScroll(math.max(0, math.min(top, (self:GetVerticalScroll() or 0) - delta * 14)))
    end)
    -- the same font and width, hidden, to measure what the text needs
    x.measure = x:CreateFontString(nil, "OVERLAY")
    x.measure:SetFontObject(CRTFontEdit)
    x.measure:SetWidth(EXPORT_TEXT_WIDTH)
    -- wraps anywhere, like the edit box (a long line has no spaces to break at)
    x.measure:SetNonSpaceWrap(true)
    x.measure:Hide()
    edit:SetScript("OnTextChanged", function(self, userInput)
        if userInput then
            self:SetText(x.text)
            self:HighlightText()
        end
    end)
    x.edit:SetScript("OnEscapePressed", function()
        x:Hide()
    end)
    x.edit:SetScript("OnEditFocusGained", function(self)
        x:Raise() -- over the editor when clicked, without being toplevel itself
        self:HighlightText()
    end)
    UI:SkinTree(x)
    x:Hide()
end

-- Shows the draft as note lines in the copy box, one per time as Save writes them. Saves nothing.
-- Returns the text.
function Editor:Export()
    if not (frame and draft) then
        return nil
    end
    -- a note line needs a time that reads, as Save does
    local err = timeError(true) or (not ctx.savedMode and not keptTimeList() and parseTime(draft.timeText) == nil
        and DTEXT.noTime or nil)
    if err then
        fail(err)
        return nil
    end
    buildExport()
    local extra, lines = keptFields(), {}
    for i, t in ipairs(noteTimers()) do
        lines[i] = CRT.NoteParser.FormatLine(t) .. extra
    end
    local line = table.concat(lines, "\n")
    -- the box is as tall as the text wraps to, up to what the window has room for, then it scrolls
    exportFrame.measure:SetText(line)
    local textHeight = math.max(EXPORT_MIN_TEXT, math.ceil(exportFrame.measure:GetStringHeight() or 0))
    local shown = math.min(textHeight, EXPORT_MAX_TEXT)
    exportFrame.edit:SetHeight(textHeight)
    exportFrame.scroll:SetHeight(shown)
    exportFrame.scroll:SetVerticalScroll(0)
    exportFrame.box:SetHeight(shown + EXPORT_PAD * 2)
    exportFrame:SetHeight(EXPORT_CHROME + shown + EXPORT_PAD * 2)
    exportFrame.text = line
    exportFrame.edit:SetText(line)
    exportFrame:Show()
    exportFrame:Raise()
    exportFrame.edit:SetFocus()
    exportFrame.edit:HighlightText()
    return line
end

local function confirm(info)
    UI.LiftOver(UI.ShownPopup(StaticPopup_ShowCustomGenericConfirmation(info), "GENERIC_CONFIRMATION"))
end

-- The name popup of Save as saved alert: an edit box with the default name in it. data = { fields, default }.
local function acceptName(edit, data)
    local fields = data and data.fields
    if not (edit and fields and CRT.AlertSaved) then
        return
    end
    fields.name = trim(edit:GetText())
    local id = CRT.AlertSaved:Save(nil, fields)
    if not id then
        if data.onFail then
            data.onFail(TEXT.savedFailed)
        end
        return
    end
    local s = CRT.AlertSaved:Get(id)
    if s and CRT.Print then
        CRT:Print(string.format(TEXT.savedMade, s.name))
    end
end

local function ensureNamePopup()
    if not StaticPopupDialogs then
        return false
    end
    if StaticPopupDialogs[POPUP_NAME] then
        return true
    end
    StaticPopupDialogs[POPUP_NAME] = {
        text = TEXT.savedNamePrompt,
        button1 = TEXT.savedAccept,
        button2 = TEXT.cancel,
        hasEditBox = true,
        maxLetters = 64,
        timeout = 0,
        whileDead = true,
        hideOnEscape = true,
        preferredIndex = 3,
        OnShow = function(self, data)
            local edit = UI.PopupEditBox(self)
            if edit then
                edit:SetText(data and data.default or "")
                edit:HighlightText()
            end
        end,
        OnAccept = function(self, data)
            acceptName(UI.PopupEditBox(self), data)
        end,
        -- the game passes the dialog's data; the box's parent is only a fallback (layouts change)
        EditBoxOnEnterPressed = function(edit, data)
            local parent = edit:GetParent()
            acceptName(edit, data or (parent and parent.data))
            StaticPopup_Hide(POPUP_NAME)
        end,
        EditBoxOnEscapePressed = function()
            StaticPopup_Hide(POPUP_NAME)
        end,
    }
    return true
end

-- Asks for a name for a saved alert's fields, over every window; Accept makes it (an empty name takes
-- the default), Cancel makes nothing. onFail(message) hears when it could not be saved.
local function askName(fields, onFail)
    if not (CRT.AlertSaved and ensureNamePopup()) then
        return
    end
    fields.name = nil
    local data = { fields = fields, default = CRT.AlertSaved.DefaultName(fields), onFail = onFail }
    -- already asking: the open popup is reused, taking the alert as it is now
    local openName = StaticPopup_Visible and StaticPopup_Visible(POPUP_NAME)
    local open = openName and _G[openName]
    if open and open.IsShown and open:IsShown() then
        open.data = data
        UI.LiftOver(open)
        return
    end
    UI.LiftOver(UI.ShownPopup(StaticPopup_Show(POPUP_NAME, nil, nil, data), POPUP_NAME))
end

-- Save as saved alert on the editor: the draft as it is now.
local function askSavedName()
    if not (draft and CRT.AlertSaved and ensureNamePopup()) then
        return
    end
    if not anyOutput() then
        return fail(DTEXT.nothing)
    end
    askName(savedFields(), function(message)
        if draft then
            fail(message)
        end
    end)
end

-- Save as template for an Only me draft from elsewhere (the Mech Alerts panel), by the same name popup.
-- False and the message when the draft shows nothing.
function Editor:AskTemplateName(c, d, onFail)
    if not Draft.AnyOutput(d) then
        return false, DTEXT.nothing
    end
    local fields = Draft.BuildReminder(c, d)
    fields.saveAs = d.saveAs
    fields.tags = words(d.tag)
    askName(fields, onFail)
    return true
end

-- The game's color picker on the draft's color; Cancel puts the old one back.
local function pickColor()
    if not (draft and ColorPickerFrame) or readOnly() or not colourEditable() then
        return
    end
    -- the alert open now: a picker left open never writes into the next one
    local target = draft
    local before = copy(draft.color)
    UI.PickColor(draft.color or { 1, 1, 1, 1 }, function(c)
        if draft and draft == target then
            draft.color = { c[1], c[2], c[3], 1 }
            changed()
        end
    end, { cancel = function()
        if draft and draft == target then
            draft.color = copy(before)
            changed()
        end
    end })
    -- the picker is DIALOG strata, below the editor: lift it over until it hides
    UI.LiftOver(ColorPickerFrame)
end

-- Speak at: when Speak the text says the text, On show or At 0 (the alert's time). Greyed while Speak the
-- text is off, and on a read-only note line. Its own function: build is near Lua 5.1's 60 upvalue limit.
local function speakAtRow(p, row)
    return row(UI.Dropdown(p, TEXT.speakAt, {
        labelWidth = SPEAK_AT_LABEL, width = SPEAK_AT_W,
        enabledIf = function() return editable() and draft ~= nil and draft.speak and true or false end,
        options = Draft.SpeakAtOptions(TEXT.onShow, TEXT.atZero),
        get = function() return Draft.SpeakAtKey(draft) end,
        set = setter(function(v) Draft.SetSpeakAt(draft, v) end),
    }), SPEAK_AT_X, C)
end

-- The Show as boxes placed by their labels' width (Draft.FlowShowAs), inside the window at any text size.
-- Run on build and on every open, so a text size changed since then is measured again.
local function placeShowAs(f)
    local rows = {}
    for r, keys in ipairs(Draft.SHOW_ROWS) do
        rows[r] = {}
        for i, key in ipairs(keys) do
            rows[r][i] = f.checks[key]
        end
    end
    Draft.FlowShowAs(rows, FIELD_X, WIDTH - LEFT, SHOW_CHECK_W, SHOW_GAP, function(check, x)
        check:ClearAllPoints()
        check:SetPoint("TOPLEFT", x, check.rowY)
    end)
end

-- The Shield bar tab: Alerts/ShieldSection.lua's wide layout on the draft's shield, from the top of the tab.
local function shieldRows(f, p)
    f.shield = CRT.AlertShieldSection.Build(p, {
        layout = "wide", x = LEFT, y = C, width = WIDTH - 2 * LEFT,
        register = function(r) f.rows[#f.rows + 1] = r end,
        get = function() return draft and draft.shield end,
        set = function(field, value) setter(function() draft.shield[field] = value end)() end,
        barOn = function() return draft ~= nil and draft.show.bar and true or false end,
        editable = editable,
        -- a raid note line on the boss's note with no difficulty (Any) plays everywhere: Any time adds nothing
        anyApplies = function() return not (draft and draft.saveAs == "note" and draft.difficulty == nil) end,
        encounterID = function() return ctx and ctx.encounterID end,
    })
end

-- The Sound and speech tab: Sound with its Play button and Speak at beside it, then Also: Speak the text, Count down
-- 3 2 1 and Glow at 0. Its own function: build is near Lua 5.1's 60 upvalue limit.
local function soundRows(f, p, row)
    row(UI.SoundDropdown(p, TEXT.sound, {
        labelWidth = 70, width = 160, maxHeight = MENU_MAX_HEIGHT, enabledIf = editable, playButton = true,
        options = soundOptions,
        get = function() return draft and Draft.SoundKey(draft.sound) or NO_SOUND end,
        set = setter(function(v) draft.sound = v ~= NO_SOUND and v or nil end),
    }), LEFT, C)
    f.speakAt = speakAtRow(p, row)
    local alsoY = C - 34
    makeLabel(p, TEXT.also, LEFT, alsoY - 6)
    f.also = {
        speak = makeCheck(p, TEXT.speak, FIELD_X, alsoY, setter(function(on) draft.speak = on end)),
        count = makeCheck(p, TEXT.count, 226, alsoY, setter(function(on) draft.count = on end)),
        glow = makeCheck(p, TEXT.glow, 386, alsoY, setter(function(on) draft.glow = on end)),
    }
end

-- The Looks tab, top: Show as in two rows. Its own function: build is near Lua 5.1's 60 upvalue limit.
local function showAsRows(f, p)
    makeLabel(p, TEXT.showAs, LEFT, C - 6)
    local labels = { alert = TEXT.callout, text = TEXT.showText, icon = TEXT.showIcon, bar = TEXT.bar, circle = TEXT.circle,
        timeline = TEXT.timeline }
    f.checks = {}
    for r, keys in ipairs(Draft.SHOW_ROWS) do
        for _, key in ipairs(keys) do
            local y = C - (r - 1) * SHOW_ROW
            local check = makeCheck(p, labels[key], FIELD_X, y, setter(function(on) draft.show[key] = on end))
            check.rowY = y -- its row, which placeShowAs moves it along
            f.checks[key] = check
        end
    end
    placeShowAs(f)
end

-- The Looks tab, under Show as: Text, Icon and Color. Its own function: build is near Lua 5.1's 60 upvalue limit.
local function lookRows(f, p, row)
    -- Text
    makeLabel(p, TEXT.text, LEFT, C - 64)
    f.textEdit = makeEdit(p, FIELD_X + 4, C - 60, WIDTH - FIELD_X - LEFT - 8, function(text)
        if draft then
            draft.text = text
            changed()
        end
    end)

    -- Icon: Spell or Icon ID, the ID box and a preview
    row(UI.Dropdown(p, TEXT.icon, {
        labelWidth = 70, width = 110, enabledIf = editable,
        options = { { key = "spell", label = TEXT.iconSpell }, { key = "id", label = TEXT.iconID } },
        get = function() return draft and draft.iconType or "spell" end,
        set = function(v)
            if draft and readOnly() then
                refresh(true)
            elseif draft then
                draft.iconType = v
                local id = v == "id" and draft.iconID or draft.spellID
                f.idEdit:SetText(id and tostring(id) or "")
                changed(true)
            end
        end,
    }), LEFT, C - 86)
    f.idEdit = makeEdit(p, 212, C - 92, ID_WIDTH, idTextChanged)
    f.idEdit:SetScript("OnEditFocusGained", function()
        lookupFrom = draft and validID(draft.spellID)
    end)
    UI.HelpRight(f.idEdit, TEXT.iconHelpTitle, TEXT.iconHelp)
    f.iconPreview = p:CreateTexture(nil, "ARTWORK")
    f.iconPreview:SetSize(24, 24)
    lay(f.iconPreview, 326 + ID_SHIFT, C - 90)
    f.iconPreview:SetTexCoord(0.07, 0.93, 0.07, 0.93)
    f.spellName = p:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    lay(f.spellName, 358 + ID_SHIFT, C - 96)
    f.spellName:SetWidth(WIDTH - 358 - ID_SHIFT - LEFT)
    -- the match list of a name lookup, under the box and over the rows below it
    f.lookupCtl = CRT.AlertSpellLookup.Attach(f.idEdit, {
        encounterID = function() return ctx and ctx.encounterID end,
        boss = function() return draft and draft.boss end,
        enabled = function() return draft ~= nil and editable() end,
        onPick = pickMatch,
        onClose = putIDBack,
        -- over the window (its strata), not the tab; another tab picked closes it (buildTabs)
        levelFrame = f,
    })
    f.lookup = f.lookupCtl.list
    f.spellName:SetJustifyH("LEFT")
    f.spellName:SetWordWrap(false)

    -- Color: a swatch that opens the game's color picker, and Default for none
    f.colorLabel = makeLabel(p, TEXT.color, LEFT, C - 128)
    f.colorSwatch = CreateFrame("Button", nil, p)
    f.colorSwatch:SetSize(20, 20)
    lay(f.colorSwatch, FIELD_X, C - 124)
    f.colorSwatch.edge = f.colorSwatch:CreateTexture(nil, "BACKGROUND")
    f.colorSwatch.edge:SetAllPoints()
    f.colorSwatch.edge:SetColorTexture(0.5, 0.5, 0.5, 1)
    f.colorSwatch.tex = f.colorSwatch:CreateTexture(nil, "ARTWORK")
    f.colorSwatch.tex:SetPoint("TOPLEFT", 1, -1)
    f.colorSwatch.tex:SetPoint("BOTTOMRIGHT", -1, 1)
    f.colorSwatch:SetScript("OnClick", pickColor)
    f.colorDefault = makeButton(p, TEXT.colorDefault, 80)
    lay(f.colorDefault, FIELD_X + 28, C - 122)
    f.colorDefault:SetScript("OnClick", function()
        if draft and not readOnly() and colourEditable() then
            draft.color = nil
            changed()
        end
    end)
end

-- The When tab: Relative to and Time (or, for an alert on a boss ability, its casts), then Show from and Linger, which
-- move up for a saved alert (applyLayout). Its own function: build is near Lua 5.1's 60 upvalue limit.
local function whenRows(f, p, row)
    f.relativeRow = row(UI.Dropdown(p, TEXT.relativeTo, {
        labelWidth = 70, width = 120, enabledIf = editable,
        options = phaseOptions,
        get = function() return draft and draft.ph or 1 end,
        set = setter(function(v)
            draft.ph = v
            draft.timeTouched = true
        end),
    }), LEFT, C)
    f.timeLabel = makeLabel(p, TEXT.time, 226, C - 10)
    f.timeEdit = makeEdit(p, 264, C - 6, 64, function(text, userInput)
        if draft then
            draft.timeText = text
            if userInput then
                draft.timeTouched = true
            end
            changed()
        end
    end)
    f.timeHelp = UI.HelpRight(f.timeEdit, TEXT.timeHelpTitle, TEXT.timeHelp)
    f.sourceText = p:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    f.sourceText:SetPoint("TOPLEFT", 360, C - 10)
    f.sourceText:SetWidth(WIDTH - 360 - LEFT)
    f.sourceText:SetJustifyH("LEFT")
    f.sourceText:SetWordWrap(false)
    -- in their place for an alert on a boss ability (Draft.FollowsCasts): its casts, read only
    f.castsText = p:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    lay(f.castsText, LEFT, C - 10)
    f.castsText:SetWidth(WIDTH - 2 * LEFT - 24)
    f.castsText:SetJustifyH("LEFT")
    f.castsText:SetWordWrap(false)
    f.castsHelp = UI.HelpRight(f.castsText, TEXT.castsHelpTitle, TEXT.castsHelp)

    -- Show from, Linger
    local y = C - SAVED_SHIFT
    local showFrom = row(UI.Slider(p, TEXT.showFrom, {
        min = 1, max = 60, step = 1, labelWidth = 70, width = 150, enabledIf = editable,
        tipTitle = TEXT.showFrom, tipText = TEXT.showFromHelp,
        format = function(v) return string.format(TEXT.seconds, v) end,
        get = function() return draft and draft.warn or 5 end,
        set = setter(function(v) draft.warn = v end),
    }), LEFT, y)
    local linger = row(UI.Slider(p, TEXT.linger, {
        min = 0, max = 10, step = 1, labelWidth = 50, width = 150, enabledIf = editable,
        format = function(v) return string.format(TEXT.seconds, v) end,
        get = function() return draft and draft.linger or 0 end,
        set = setter(function(v) draft.linger = v end),
    }), 306, y)
    shifted[1], shifted[2] = { showFrom, LEFT, y }, { linger, 306, y }
    f.showFrom, f.linger = showFrom, linger
end

-- Another subtab picked: the spell lookup's list closes and the Text, Time and Icon ID boxes let go (each box already
-- wrote the draft as it was typed), so no hidden box keeps the keyboard.
local function leaveTab()
    hideLookup()
    for _, edit in ipairs({ frame.textEdit, frame.timeEdit, frame.idEdit }) do
        edit:ClearFocus()
    end
end

-- The subtabs under the header (Alerts/SubTabs.lua, the Mech Alerts panel's), each tab's rows built into its own frame.
local function buildTabs(f, row)
    f.tabs = CRT.AlertSubTabs.Build(f, { owner = "editor", x = LEFT, y = TABS_Y,
        rule = { y = RULE_Y, left = LEFT, right = LEFT }, onPick = leaveTab })
    local tf = f.tabs.frames
    whenRows(f, tf.when, row)
    showAsRows(f, tf.looks)
    lookRows(f, tf.looks, row)
    soundRows(f, tf.sound, row)
    shieldRows(f, tf.shield)
end

local function build()
    if frame then
        return
    end
    local f = CreateFrame("Frame", FRAME_NAME, UIParent, "BasicFrameTemplateWithInset")
    UI:StyleWindow(f)
    frame = f
    f:SetSize(WIDTH, HEIGHT)
    f:SetClampedToScreen(true)
    f:SetMovable(true)
    f:EnableMouse(true)
    f:RegisterForDrag("LeftButton")
    f:SetScript("OnDragStart", function(self) self:StartMoving(true) end)
    f:SetScript("OnDragStop", function(self)
        self:StopMovingOrSizing()
        inCorner = false -- dragged: it keeps the spot it was put in
    end)
    -- above every window, the Timeline pop-out included; not on the "panel" layer, which follows the
    -- main window's strata
    f:SetFrameStrata("FULLSCREEN_DIALOG")
    f:SetToplevel(true)
    -- Previews never touch an alert being edited: on opens an empty editor only when none is open,
    -- and off closes only the one Previews opened.
    -- The one Previews opens sits in the bottom right corner, clear of the alert areas it shows with.
    UI:RegisterPreview("alerteditor", function(on)
        local open = draft ~= nil and frame:IsShown()
        if on then
            if not open then
                Editor:Open(nil, nil)
                previewDraft = draft
                f:ClearAllPoints()
                f:SetPoint("BOTTOMRIGHT", UIParent, "BOTTOMRIGHT", -PREVIEW_INSET, PREVIEW_INSET)
                inCorner = true
            end
        else
            if open and draft == previewDraft then
                Editor:Close()
            end
            previewDraft = nil
        end
    end)
    UI.SetFrameTitle(f, TEXT.title)
    tinsert(UISpecialFrames, FRAME_NAME)
    applyPosition()
    UI.ResetButton(f, function()
        Editor:ResetPosition()
    end):SetPoint("TOPRIGHT", -28, -4)
    f:SetScript("OnHide", function()
        -- closed any way (Escape, Save, Close, Previews off): the next Open starts at the centre
        leaveCorner()
        hideLookup()
        if exportFrame then
            exportFrame:Hide()
        end
    end)
    f.rows = {}
    local function row(r, x, y)
        lay(r, x, y)
        f.rows[#f.rows + 1] = r
        return r
    end

    -- Save as, For, Difficulty
    -- Raid note is greyed out for anyone who can't change the raid note, with a (?) saying why
    local saveAsRow = row(UI.Dropdown(f, TEXT.saveAs, {
        -- 52 + 5 + 104, then its (?) (UI.HelpRight): it ends 4 before For at 205
        labelWidth = 52, width = 104, enabledIf = editable,
        options = function()
            local locked = not (ctx and ctx.savedMode) and not canEditRaid()
            return { { key = "note", label = TEXT.asNote, disabled = locked or nil }, { key = "mine", label = TEXT.asMine } }
        end,
        get = function() return draft and draft.saveAs or "mine" end,
        set = function(v)
            if not draft then
                return
            end
            if readOnly() then
                refresh(true)
                return
            end
            if v == "note" and not ctx.savedMode then
                local allowed, why = canEditRaid()
                if not allowed then
                    return fail(why)
                end
            end
            draft.saveAs = v
            applyDefaultDifficulty()
            changed(true)
        end,
    }), LEFT, -30)
    f.saveAsHelp = UI.HelpRight(saveAsRow, TEXT.asNote, notAdminReason)
    f.forRow = row(UI.Dropdown(f, TEXT.forLabel, {
        labelWidth = 30, width = 160, maxHeight = MENU_MAX_HEIGHT, enabledIf = editable,
        options = forOptions,
        get = function() return draft and draft.tag or "" end,
        set = setter(function(v) draft.tag = v end),
    }), 205, -30)
    f.difficultyRow = row(UI.Dropdown(f, TEXT.difficulty, {
        labelWidth = 60, width = 114, enabledIf = editable,
        options = difficultyOptions,
        get = function()
            if not (draft and draft.saveAs == "note") then
                return Draft.Group(draft)
            end
            return draft.difficulty or ANY
        end,
        set = setter(function(v)
            if draft.saveAs ~= "note" then
                Draft.SetGroup(draft, v) -- saved for that group only
                return
            end
            draft.difficulty = v ~= ANY and v or nil
            draft.difficultyTouched = true
        end),
    }), 405, -30)
    -- Saves to: the note a raid note line goes to, under For and Difficulty
    f.savesText = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    f.savesText:SetPoint("TOPRIGHT", -LEFT, -62)
    f.savesText:SetWidth(WIDTH - 205 - LEFT)
    f.savesText:SetJustifyH("RIGHT")
    f.savesText:SetWordWrap(false)

    -- Under the header: When, Looks, Sound and speech and Shield bar (Alerts/SubTabs.lua)
    buildTabs(f, row)

    -- A save's or test's problem, on every tab: above the buttons (a long one wraps upwards)
    f.messageText = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    f.messageText:SetPoint("BOTTOMLEFT", LEFT, BOTTOM + BUTTON_H + MESSAGE_GAP)
    f.messageText:SetWidth(WIDTH - 2 * LEFT)
    f.messageText:SetJustifyH("LEFT")

    -- Buttons
    f.deleteBtn = makeButton(f, TEXT.delete, 80)
    f.deleteBtn:SetPoint("BOTTOMLEFT", LEFT, 14)
    f.deleteBtn:SetScript("OnClick", function()
        if not (ctx and (ctx.id or ctx.noteID or ctx.savedID)) then
            return
        end
        local from = ctx
        confirm({
            text = from.savedMode and TEXT.deleteSavedConfirm or TEXT.deleteConfirm,
            acceptText = TEXT.delete,
            cancelText = TEXT.cancel,
            showAlert = true,
            callback = function()
                if from.savedMode then
                    if CRT.AlertSaved then
                        CRT.AlertSaved:Delete(from.savedID)
                    end
                elseif from.noteID then
                    local allowed, why = canEditRaid()
                    if not allowed or from.readOnly then
                        local message = why or TEXT.reopen
                        if ctx == from then
                            fail(message)
                        elseif CRT.Print then
                            CRT:Print(message)
                        end
                        return
                    end
                    if not CRT.Notes:RemoveLine(from.noteID, from.line, from.expected) then
                        if ctx == from then
                            fail(DTEXT.stale)
                        end
                        return
                    end
                else
                    Reminders:Delete(from.encounterID, from.id)
                end
                if ctx == from then
                    Editor:Close()
                end
            end,
        })
    end)
    f.exportBtn = makeButton(f, TEXT.export, 80)
    f.exportBtn:SetPoint("BOTTOMLEFT", LEFT + 88, 14)
    f.exportBtn:SetScript("OnClick", function()
        Editor:Export()
    end)
    f.saveSavedBtn = makeButton(f, TEXT.saveAsSaved, 134)
    f.saveSavedBtn:SetPoint("BOTTOMLEFT", LEFT + 176, 14)
    f.saveSavedBtn:SetScript("OnClick", askSavedName)
    -- in its place on a read-only raid note line
    f.copyBtn = makeButton(f, TEXT.copyToMine, 134)
    f.copyBtn:SetPoint("BOTTOMLEFT", LEFT + 176, 14)
    f.copyBtn:SetScript("OnClick", function()
        Editor:CopyToMine()
    end)
    f.copyBtn:Hide()
    f.saveBtn = makeButton(f, TEXT.save, 80)
    f.saveBtn:SetPoint("BOTTOMRIGHT", -LEFT, 14)
    f.saveBtn:SetScript("OnClick", function()
        Editor:Save()
    end)
    f.cancelBtn = makeButton(f, TEXT.cancel, 80)
    f.cancelBtn:SetPoint("BOTTOMRIGHT", -LEFT - 88, 14)
    f.cancelBtn:SetScript("OnClick", function()
        Editor:Close()
    end)
    f.testBtn = makeButton(f, TEXT.test, 80)
    f.testBtn:SetPoint("BOTTOMRIGHT", -LEFT - 176, 14)
    Editor:BindTest(f.testBtn, "editor", function()
        Editor:Test()
    end)
    UI:SkinTree(f)
    f:Hide()
end

-- Opening -------------------------------------------------------------------------------------------

local newDraft = Draft.New

-- What a new alert starts with, as a template's fields (Alerts/Draft.lua keeps the one copy).
Editor.NewDefaults = Draft.NewDefaults

local function fromReminder(r)
    Draft.FromReminder(draft, r)
end

-- A saved alert into the draft: a reminder's fields, and its For choice and Save as.
local function fromSaved(s)
    fromReminder(s)
    if s.tags then
        draft.tag = table.concat(s.tags, " ")
    end
    draft.saveAs = s.saveAs == "note" and "note" or "mine"
end

-- The window's title: Alert, or the saved alert's name (New saved alert for a new one).
local function setTitle()
    local title = TEXT.title
    if ctx.readOnly then
        title = TEXT.noteLineTitle
    elseif ctx.savedMode then
        title = ctx.savedName and string.format(TEXT.savedTitle, ctx.savedName) or TEXT.savedTitleNew
    end
    UI.SetFrameTitle(frame, title)
end

-- A saved alert changed somewhere (its chip renamed or deleted it): the one open here shows its new
-- name, or says it is gone (Save then makes nothing).
local function savedChanged()
    if not (frame and frame:IsShown() and ctx and ctx.savedMode and ctx.savedID) then
        return
    end
    local s = CRT.AlertSaved and CRT.AlertSaved:Get(ctx.savedID)
    if s then
        ctx.savedName = s.name
        setTitle()
    else
        fail(TEXT.savedGone)
    end
end

-- Saved.lua loads after this file: the editor starts listening the first time it opens a saved alert.
local listening = false
local function listenToSaved()
    if not listening and CRT.AlertSaved then
        listening = true
        CRT.AlertSaved:OnChange(savedChanged)
    end
end

-- Fills the boxes from the draft and shows the window on top.
local function show()
    notice = nil
    CRT.AlertSpellLookup.Forget() -- the spellbook is read again, on the first lookup of this open
    lookupFrom = nil
    hideLookup()
    setTitle()
    placeShowAs(frame) -- measured again: the text size may have changed since the last open
    applyLayout(ctx.savedMode == true)
    if not ctx.savedMode and not draft.timeTouched then
        local ph, t = firstTime((Reminders:Times(ctx.encounterID, timesProbe(), nil, previewGroup())))
        if ph then
            draft.ph, draft.timeText = ph, clock(t, true)
        end
    end
    frame.textEdit:SetText(draft.text or "")
    frame.timeEdit:SetText(draft.timeText)
    local id = draft.iconType == "id" and draft.iconID or draft.spellID
    frame.idEdit:SetText(id and tostring(id) or "")
    -- Setting the boxes runs their change handlers, which read them back; the draft is already right.
    refresh(true)
    paintTests() -- Test or Stop, as the engine stands now
    frame:Show()
    -- Above the Timeline pop-out and any other window it opened from.
    frame:Raise()
end

-- Opens the editor for a boss: one of your reminders (id), or a new alert. prefill is { spellID, text,
-- times, boss, ph, time, saveAs, tag, speakAt, group } from a spell, a Timeline row or a click on the
-- Timeline: time is seconds into phase ph, saveAs "note" or "mine", tag the For of a note line ("" for No
-- one), speakAt "zero" for Speak at: At 0, group the difficulty group Only me starts on (the Timeline
-- view's). A new alert from a spell is named after it.
function Editor:Open(encounterID, id, prefill)
    build()
    ctx = { encounterID = encounterID }
    draft = newDraft()
    local saved = id and Reminders:Get(encounterID, id)
    local savedAlert = prefill and prefill.saved and CRT.AlertSaved and CRT.AlertSaved:Get(prefill.saved)
    if saved then
        ctx.id = id
        ctx.reminder = copy(saved)
        fromReminder(saved)
        -- one still on any difficulty saves the group the dropdown shows (Save splits it, so the other
        -- group keeps it as it was)
        draft.group = draft.group or Draft.Group(draft)
    else
        prefill = prefill or {}
        if savedAlert then
            fromSaved(savedAlert)
            -- a spell dropped on an icon replaces the saved alert's own, and its icon with it; text that
            -- only named its own spell (or none) becomes the new spell's name, typed text stays
            local dropped = validID(prefill.spellID)
            if dropped and dropped ~= savedAlert.spellID then
                draft.iconID, draft.iconType = nil, "spell"
                local own = validID(savedAlert.spellID)
                local ownName = own and Reminders.SpellName(own)
                local text = trim(draft.text)
                if text == "" or (ownName and text == trim(ownName)) then
                    draft.text = Reminders.SpellName(dropped) or ""
                end
            end
        end
        draft.spellID = validID(prefill.spellID) or (savedAlert and draft.spellID) or nil
        if type(prefill.text) == "string" and trim(prefill.text) ~= "" then
            draft.text = prefill.text
        elseif trim(draft.text) == "" then
            draft.text = (spellInfo(draft.spellID)) or ""
        end
        -- the caller's Save as wins over a saved alert's own (the Personal notes row asks for Only me)
        if prefill.saveAs == "note" or prefill.saveAs == "mine" then
            draft.saveAs = prefill.saveAs
        end
        if prefill.speakAt == "zero" then
            draft.speakAt = "zero"
        end
        Draft.SetGroup(draft, prefill.group)
        Draft.ApplyFor(ctx, draft, prefill.tag) -- For: a player's name, or "" for No one
        if type(prefill.time) == "number" then
            draft.ph = type(prefill.ph) == "number" and prefill.ph or 1
            draft.timeText = clock(prefill.time, true) -- a click on the Timeline gives tenths
            draft.timeTouched = true
        elseif type(prefill.times) == "string" and trim(prefill.times) ~= "" then
            draft.keptTimes = prefill.times
        end
    end
    if prefill and prefill.boss and not draft.boss then
        draft.boss = prefill.boss
    end
    -- a new alert set to Raid note (a Timeline click, a saved alert) is your own when you can't change it
    if draft.saveAs == "note" and not canEditRaid() then
        draft.saveAs = "mine"
    end
    -- a reminder's own difficulty stays; a new one as a note line starts where the pull would read it
    draft.baseDifficulty = draft.difficulty
    applyDefaultDifficulty()
    show()
end

-- Opens a saved alert itself (nil for a new one): Save overwrites it. False when there is no such one.
function Editor:EditSaved(id)
    local Saved = CRT.AlertSaved
    local s = id and Saved and Saved:Get(id)
    if id and not s then
        return false
    end
    listenToSaved()
    build()
    ctx = { savedMode = true, savedID = id, savedName = s and s.name }
    draft = newDraft()
    if s then
        fromSaved(s)
    end
    show()
    return true
end

-- Opens a line of a raid note (its line number in the note). False when that line isn't a timed line.
-- A line without show: opens as it shows today: the note callout and a bar, read out.
function Editor:OpenNote(noteID, lineNumber)
    local Notes = CRT.Notes
    local record = Notes and Notes:Get(noteID)
    local timer, raw
    if record then
        timer, raw = Notes:TimerAt(noteID, lineNumber)
    end
    if not timer then
        return false
    end
    build()
    ctx = { encounterID = record.encounterID, noteID = noteID, line = lineNumber, expected = raw,
        timer = copy(timer), noteDifficulty = record.difficulty }
    draft = newDraft()
    draft.saveAs = "note"
    draft.boss = record.name
    draft.difficulty = record.difficulty
    -- a tag that is one class (one word or "Demon Hunter") reads back as its class choice; no tag as No one
    draft.tag = classTag(table.concat(timer.tags or {}, " "))
    ctx.untagged = draft.tag == ""
    draft.ph = timer.ph or 1
    draft.timeText = clock(timer.time or 0, true)
    draft.timeTouched = true
    draft.spellID = validID(timer.spellId)
    draft.text = timer.text or ""
    draft.color = copy(timer.color)
    -- kept even on a line with no show: field, which the engine also speaks at 0
    draft.speakAt = timer.speakAt == "zero" and "zero" or nil
    if timer.show then
        for _, k in ipairs(SHOW_KEYS) do
            draft.show[k] = timer.show[k] and true or false
        end
        draft.speak, draft.count = timer.tts and true or false, timer.count and true or false
        draft.glow = timer.glow and true or false
        draft.sound = timer.sound
        draft.linger = timer.linger or 0
        draft.iconID = validID(timer.iconID)
        draft.iconType = draft.iconID and "id" or "spell"
    end
    Draft.SetShieldFrom(draft, timer.absorb) -- shield:
    -- ticks:, fill: and countto: (a Mech Alert's bar): no boxes here, kept so a save writes them back
    draft.ticksText = Draft.TicksText(timer.ticks)
    draft.fill = timer.fill == "up" and "up" or nil
    draft.countTo = timer.countTo == "impact" and "impact" or nil
    local s = Notes:Alert() or {}
    draft.warn = timer.warn or s.seconds or 10
    -- someone who can't change the raid note only sees it, and may copy it to their reminders
    if not canEditRaid() then
        ctx.readOnly = true
    end
    show()
    return true
end

-- Copy to my reminders, on a read-only raid note line: the draft becomes a new reminder of your own with
-- the line's fields (spell, text, colour, displays, speech, sound, glow, Show from, Linger, icon) and
-- its time as "P<ph> <time>", for the difficulty group of the line's note. Nothing is saved until Save.
-- False when not read-only.
function Editor:CopyToMine()
    if not (ctx and draft and ctx.readOnly and type(ctx.encounterID) == "number") then
        return false
    end
    local t = parseTime(draft.timeText)
    ctx = { encounterID = ctx.encounterID }
    draft.group = Draft.Group(draft) -- the note's group, read while it is still a note line
    draft.saveAs = "mine"
    draft.tag = "everyone"
    draft.difficulty, draft.baseDifficulty, draft.difficultyTouched = nil, nil, nil
    draft.keptTimes = t and Reminders.FormatTimes({ { ph = draft.ph or 1, t = t } }) or nil
    draft.timeTouched = false
    show()
    return true
end
