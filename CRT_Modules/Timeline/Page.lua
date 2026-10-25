local ADDON, CRT = ...

-- The Timeline page, with three tabs: Review (Timeline/ReviewTab.lua: pick a boss, see its ability
-- timeline drawn by the timeline view and its recorded pulls on the right), Advanced
-- (Timeline/ReferencePage.lua: paste, edit and delete ability timelines) and Settings
-- (Timeline/SettingsTab.lua: the view, which rows to show, the deaths, and recording). Every control
-- writes through Timeline:Set or the Journal's setters, and the page redraws when either tells it
-- something changed. The boss list is the boss library's bosses in the raid route (CRT.Bosses:Options),
-- headed by raid, so a boss can be opened before its first pull; a boss outside the library is not
-- listed. The Difficulty dropdown picks Normal/Heroic or Mythic, and every list shows only that group.
-- The ability timeline shown is the boss's one for the group as Timeline:ReferenceFor picks it (the
-- picker the alerts and the Rehearsal use too; the Advanced tab's In use changes it), named in a
-- read-only label. Clicking a pull on Recent pulls lays it over the ability timeline (its deaths, its
-- casts as ticks, its end line); clicking it again clears it. That pick is kept per boss and
-- difficulty until a reload or the pull is deleted, never saved. A boss with no ability timeline
-- shows the picked pull itself, else its newest. The difficulty and boss shown are saved in
-- timeline.lastView, so the page opens on them again, after a reload too.

local Timeline = CRT.Timeline
local View = CRT.TimelineView
local Reference = CRT.TimelineReference
local ReferencePage = CRT.TimelineReferencePage
local ReviewTab = CRT.TimelineReviewTab
local SettingsTab = CRT.TimelineSettingsTab
local UI = CRT.UI

local RECENT_W = ReviewTab.RECENT_W
local DOT = " \194\183 "
local EMPTY_BOSS = "No pulls recorded for this boss yet"
local EMPTY_ALL = "No boss pulls recorded yet"

local TEXT = {
    shareNote = "Share note",
    shareHelp = "Sends this boss's raid note to everyone in the group with the addon, with every line added or moved here, and makes it everyone's active note. Only the raid leader or an assistant can send it; anyone else just sets their own active note. Notes can't be sent during a boss fight.",
    noNote = "This boss has no encounter ID yet, so no raid note can be made for it.",
    made = "Made a raid note for %s. It is on Raid Notes.",
    phaseCopy = "Moved the phase line in an ability timeline of your own (shipped ability timelines never change). It is listed as yours.",
    rehearse = "Rehearse",
    advancedBlurb = "An ability timeline is a boss's planned cast times, typed or pasted as text on the left. The Review tab draws it, alerts take their times from it, and the Rehearsal plays it. Right-click a Journal ability on the right to give it a row, a type, your own name, or a Mech Alert.",
    play = "Play",
    pause = "Pause",
    playHelp = "Plays the rehearsal with a gold line moving across the timeline, so you can watch the whole fight and its cooldowns from above while the Rehearsal window shows it as you would see it.",
    rehearseHelp = "Plays this fight out in a window of its own, a stand-in boss frame and cast bar, with your real alerts firing on time. It can't start in combat and stops if combat begins; nothing is sent to the group. /crt timeline rehearse does the same.",
    noRehearse = "Nothing to rehearse: pick a boss with an ability timeline or a pull on the Timeline's Review tab.",
    noAbilities = "No ability timeline",
    yours = "yours",
    abilities = "Abilities",
    healers = "Healer CDs",
    viewHelp = "Abilities shows the boss's ability timeline. Healer CDs shows the same ability rows, then each healer with one row per major healing cooldown.\n\n"
        .. "The healers are the players on the active Raid Groups layout whose role is healer: the role you set there (right-click a name, Set role), else the game's role. Anyone the raid note gives a cooldown gets rows too.\n\n"
        .. "The casts are the raid note's cooldown lines. The raid leader or an assistant drags one to move it in the raid note, or double-clicks a row to add one. Anyone else drags only their own casts: the new time is only yours, for your own alerts, and Send to raid lead proposes it. Only this window has Healer CDs; the docked timeline always shows the abilities.",
}

local GRAY = { 0.35, 0.35, 0.35 }
local BACKDROP = {
    bgFile = "Interface\\Buttons\\WHITE8X8",
    edgeFile = "Interface\\Buttons\\WHITE8X8",
    edgeSize = 1,
}

local GROUPS = Timeline.GROUP_NAMES

local ADVANCED_BLURB_H = 54 -- the blurb over the reference editor on the Advanced tab

local TABS = {
    { key = "review", label = "Review" },
    { key = "settings", label = "Settings" },
    { key = "references", label = "Advanced" }, -- the reference editor and the Journal abilities
}

local page, view, emptyLabel, unnamedHelp
local reviewFrame, holder, recent, refTab, settingsTab
local shareButton, shareHelp
local rehearseButton, playButton
local tabButtons, tabFrames = {}, {}
local controls = {} -- the Review tab's controls, which refresh() redraws
local currentTab = "review"
local selectedBoss
local selectedGroup = "nh" -- "nh" or "mythic": which difficulty the page shows
local picks = { nh = {}, mythic = {} } -- per group, boss -> the pull id picked on Recent pulls; not saved
local shownBoss, shownKey, shownBase, shownOverlay, shownGroup
local bossList -- { { key, name, label } } for the dropdown and name lookups, rebuilt on each refresh
local refsByBoss = {} -- boss key -> its references, { { key, ref, own, text } }, rebuilt with bossList
local refresh

local function settings()
    return Timeline:Settings()
end

local function skin(frame, alpha)
    frame:SetBackdrop(BACKDROP)
    frame:SetBackdropColor(0, 0, 0, alpha or 0.5)
    frame:SetBackdropBorderColor(GRAY[1], GRAY[2], GRAY[3], 1)
end

local function label(parent, text, font)
    local fs = parent:CreateFontString(nil, "OVERLAY", font or "CRTFontNormal")
    fs:SetText(text)
    return fs
end

local function button(parent, text, width)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontButtonSmall)
    b:SetHighlightFontObject(CRTFontButtonSmallHighlight)
    b:SetDisabledFontObject(CRTFontButtonSmallDisable)
    b:SetSize(width, 20)
    b:SetText(text)
    return b
end

-- The bosses ------------------------------------------------------------------------------------

-- The boss library's bosses in the raid route (CRT.Bosses:Options: a heading per raid, then its
-- bosses, never re-sorted here): { { key, name, label } }, the label being the name with the pull
-- count on the shown difficulty, and a heading { key = "raid:...", label, title = true }. A boss that
-- is not in the library is not listed, even with saved pulls (they stay saved). Each reference goes
-- to the boss Reference:BossKey gives it; one for a boss that is not listed is left out too.
local function buildBossList()
    local list, bosses = {}, {}
    refsByBoss = {}
    local counts = {}
    for _, boss in ipairs(Timeline:Bosses(selectedGroup)) do
        counts[boss.encounterID] = boss.count
    end
    for _, option in ipairs(CRT.Bosses:Options()) do
        if option.title then
            list[#list + 1] = option
        else
            local count = counts[option.key] or 0
            local entry = { key = option.key, name = option.label, label = count > 0 and (option.label .. " (" .. count .. ")") or option.label }
            list[#list + 1] = entry
            bosses[#bosses + 1] = entry
        end
    end
    for _, entry in ipairs(Reference:ForGroup(Reference:List(), selectedGroup)) do
        local key = Reference:BossKey(entry, bosses)
        if type(key) == "number" then
            refsByBoss[key] = refsByBoss[key] or {}
            table.insert(refsByBoss[key], entry)
        end
    end
    return list
end

local function bossOptions()
    bossList = bossList or buildBossList()
    return bossList
end

-- The references of the selected boss, yours first.
local function bossRefs()
    bossOptions()
    return selectedBoss and refsByBoss[selectedBoss] or {}
end

-- The name of the selected boss, from the saved pulls or this raid's list.
local function bossName()
    if not selectedBoss then
        return nil
    end
    for _, option in ipairs(bossOptions()) do
        if option.key == selectedBoss then
            return option.name
        end
    end
end

-- The ability timeline shown for the selected boss and difficulty: the one picker (Timeline:ReferenceFor),
-- from the boss's references as the boss list sorts them. Nil when the boss has none for the group.
local function shownRef()
    local refs = bossRefs()
    if not (selectedBoss and refs[1]) then
        return nil
    end
    return Timeline:ReferenceFor(selectedBoss, selectedGroup, bossName(), nil, refs)
end

local function showingReference()
    return shownRef() ~= nil
end

-- The game's name for a difficultyID ("Mythic", "Heroic"), or nil when the game gives none.
local function gameDifficultyName(difficultyID)
    if type(difficultyID) == "number" and GetDifficultyInfo then
        local ok, name = pcall(GetDifficultyInfo, difficultyID)
        if ok and type(name) == "string" and name ~= "" then
            return name
        end
    end
    return nil
end

-- The game's name for a pull's difficulty, else the name of its group.
local function difficultyName(pull)
    return gameDifficultyName(pull.difficultyID) or GROUPS[Timeline.DifficultyGroup(pull.difficultyID)]
end

local function pullLabel(pull)
    return "Pull " .. tostring(Timeline.PullNumber(pull)) .. DOT .. View.Format(pull.length or 0) .. DOT .. (pull.kill and "kill" or "wipe") .. DOT .. difficultyName(pull)
end

-- A pull belongs to the shown difficulty group.
local function inGroup(pull)
    return Timeline.DifficultyGroup(pull.difficultyID) == selectedGroup
end

-- The pull picked on Recent pulls for the selected boss and difficulty, or nil.
local function pickedPull()
    local id = selectedBoss and picks[selectedGroup][selectedBoss]
    local pull = id and Timeline:Pull(selectedBoss, id)
    return pull and inGroup(pull) and pull or nil
end

-- With no ability timeline, the recorded pull drawn: the one picked, else the boss's newest.
local function shownPull()
    if not selectedBoss or showingReference() then
        return nil
    end
    return pickedPull() or Timeline:Pulls(selectedBoss, selectedGroup)[1]
end

-- What is drawn, by key: the ability timeline's ("ship:1", "own:2"), else the recorded pull's id.
local function shownKeyNow()
    local entry = shownRef()
    if entry then
        return entry.key
    end
    local pull = shownPull()
    return pull and pull.id or nil
end

-- The pull lit on Recent pulls: the one laid over the ability timeline, or the recorded pull drawn.
local function litPull()
    if showingReference() then
        return pickedPull()
    end
    return shownPull()
end

-- The read-only label in place of a Pull dropdown: the ability timeline shown ("Abilities · Mythic ·
-- 9:48 · yours"), else that there is none (and the pull drawn instead).
local function shownLabel()
    if not selectedBoss then
        return ""
    end
    local entry = shownRef()
    if entry then
        return Reference.Label(entry.ref) .. (entry.own and (DOT .. TEXT.yours) or "")
    end
    local pull = shownPull()
    return TEXT.noAbilities .. (pull and (DOT .. "Pull " .. tostring(Timeline.PullNumber(pull))) or "")
end

-- Keeps the selection valid: a boss that is still listed (else the route's first), and each picked
-- pull that still exists in its group (a deleted or trimmed one is dropped).
local function fixSelection()
    local options = bossOptions()
    local found = false
    for _, option in ipairs(options) do
        if not option.title and option.key == selectedBoss then
            found = true
        end
    end
    if not found then
        selectedBoss = CRT.Bosses.FirstKey(options)
    end
    for group, list in pairs(picks) do
        for boss, id in pairs(list) do
            local pull = Timeline:Pull(boss, id)
            if not pull or Timeline.DifficultyGroup(pull.difficultyID) ~= group then
                list[boss] = nil
            end
        end
    end
end

-- The Review tab -------------------------------------------------------------------------------

-- The shown reference, when it has an Order line, and the boss its chosen order is saved under.
local function orderedRef()
    local entry = shownRef()
    if entry and entry.ref.order then
        return entry.ref, entry.ref.encounterID or selectedBoss
    end
end

-- The chosen order of the shown reference's parts (a list), or nil with no Order line.
local function chosenOrder()
    local ref, boss = orderedRef()
    return ref and Reference.ResolveOrder(ref, Timeline:Order(boss, selectedGroup))
end

local function orderOptions()
    local list = {}
    local ref = orderedRef()
    for i, parts in ipairs(ref and Reference.Orders(ref) or {}) do
        local key = Reference.OrderKey(parts)
        list[#list + 1] = { key = key, label = key .. (i == 1 and " (as written)" or "") }
    end
    return list
end

local function updateView()
    local entry = shownRef()
    local base, sig, overlay
    if entry then
        base = { reference = entry.ref }
        sig = entry.text -- each refresh parses afresh, so the text tells if it changed
        overlay = pickedPull()
    else
        base = shownPull()
        sig = base
    end
    local key = entry and entry.key or (base and base.id)
    view:SetOrder(chosenOrder())
    if sig ~= shownBase or key ~= shownKey or selectedBoss ~= shownBoss or overlay ~= shownOverlay or selectedGroup ~= shownGroup then
        shownBase, shownKey, shownBoss, shownOverlay, shownGroup = sig, key, selectedBoss, overlay, selectedGroup
        view:SetData(base, selectedBoss, overlay, bossName(), selectedGroup)
    else
        view:Refresh()
    end
    emptyLabel:SetText(selectedBoss and EMPTY_BOSS or EMPTY_ALL)
    emptyLabel:SetShown(base == nil)
    -- the Recent pulls list takes the right edge whenever the boss has pulls on this difficulty
    local pulls = selectedBoss and Timeline:Pulls(selectedBoss, selectedGroup) or {}
    holder:SetPoint("BOTTOMRIGHT", reviewFrame, "BOTTOMRIGHT", pulls[1] and -(RECENT_W + 16) or -8, 8)
    local lit = litPull()
    recent:Update(pulls, lit and lit.id, pulls[1] ~= nil)
end

-- A click on Recent pulls: picks that pull, or clears it when it is the one lit; another switches.
local function togglePull(pullID)
    if not selectedBoss then
        return
    end
    local lit = litPull()
    picks[selectedGroup][selectedBoss] = not (lit and lit.id == pullID) and pullID or nil
    refresh()
end

local function buildReview(f)
    reviewFrame = f
    local tab = ReviewTab.Build(f, {
        groups = GROUPS,
        group = function()
            return selectedGroup
        end,
        boss = function()
            return selectedBoss
        end,
        -- Switching difficulty repairs the selection; each difficulty keeps its own picked pulls.
        selectGroup = function(key)
            selectedGroup, bossList = key, nil
            fixSelection()
            refresh()
        end,
        selectBoss = function(key)
            selectedBoss = key
            fixSelection()
            refresh()
        end,
        togglePull = togglePull,
        -- A phase line moved (or put back) on the timeline is written into the shown ability timeline. A
        -- shipped one is never changed: the move makes one of your own, which is then shown (and picked
        -- In use when another was picked there).
        movePhase = function(index, seconds)
            local entry = shownRef()
            if not entry then
                return
            end
            local key, copied = Reference:MovePhase(entry.key, index, seconds)
            if key and copied then
                if Timeline:ChosenReference(selectedBoss, selectedGroup) then
                    Timeline:SetChosenReference(selectedBoss, selectedGroup, Reference.ChoiceKey(Reference:Find(key)))
                end
                CRT:Print(TEXT.phaseCopy)
            end
            refresh()
        end,
        -- the raid's order of the shown reference's parts, kept per boss and difficulty
        order = function()
            local parts = chosenOrder()
            return parts and Reference.OrderKey(parts)
        end,
        hasOrder = function()
            return orderedRef() ~= nil
        end,
        selectOrder = function(key)
            local ref, boss = orderedRef()
            if ref then
                -- the written order is kept as no choice, so a changed reference starts from it again
                Timeline:SetOrder(boss, selectedGroup, key ~= Reference.OrderKey(ref.order.parts) and key or nil)
            end
        end,
        orderOptions = orderOptions,
        bossOptions = bossOptions,
        shownLabel = shownLabel,
        hasPull = function()
            return shownPull() ~= nil
        end,
        pullLabel = pullLabel,
        showingReference = showingReference,
    })
    view, holder, recent, emptyLabel, unnamedHelp, controls = tab.view, tab.holder, tab.recent, tab.emptyLabel, tab.unnamedHelp, tab.controls
end

-- The pop-out window -----------------------------------------------------------------------------
-- Pop out moves the whole Review tab (the boss and pull choices, the zoom and the view) into a
-- window of its own that can be dragged to any size, for a wider view than the main panel allows.
-- The Review tab then shows a note and a button to bring it back, and closing the window (its X,
-- Escape or Dock) puts it back. Its size and position are saved in timeline.popout. Its title strip holds
-- the Abilities | Healer CDs toggle (timeline.popView): Healer CDs draws the view's healer layout
-- (Timeline/HealerView.lua) in this window only, and docking always goes back to the abilities.

local MIN_W, MIN_H = 760, 360
local popWin, popButton, dockedNote
local popped = false
local returnPage -- the page Show on the Timeline came from, shown again when the pop-out is closed
-- the Abilities | Healer CDs toggle on the pop-out's title strip (UI.Toggle2); its (?) and a gap before Reset
local TOGGLE_HELP_GAP = 8
local toggle
local abilitiesNow = false -- Show on the Timeline: Abilities for this opening, the saved choice untouched

local function popSettings()
    local s = settings()
    s.popout = s.popout or { width = 1200, height = 600 }
    return s.popout
end

local dock

-- The pop-out's view: "abilities" (the default) or "healers" (Healer CDs), kept in timeline.popView.
local function popView()
    return settings().popView == "healers" and "healers" or "abilities"
end

-- The view the pop-out shows now: Healer CDs only while popped out, and not while Show on the Timeline
-- has it on Abilities.
local function shownPopView()
    if not popped or abilitiesNow then
        return "abilities"
    end
    return popView()
end

-- Lights the toggle's half and draws the view in it. later: the caller redraws the view next, so SetMode
-- doesn't. skin: a real change of view (UI:SetTabSelected), else only restyled.
local function applyPopView(later, skin)
    local key = shownPopView()
    if toggle then
        toggle:Select(key, skin)
    end
    if view and view.SetMode then
        view:SetMode(key == "healers" and "healers" or nil, later)
    end
end

local function setPopView(key)
    abilitiesNow = false
    settings().popView = key == "healers" and "healers" or "abilities"
    applyPopView(false, true)
end

-- Each half as wide as its label (measured again each time the window opens, for a changed text size),
-- right to left from the (?) before Reset.
local function layToggle()
    toggle:Size()
    toggle:PlaceRight(popWin.reset, -(TOGGLE_HELP_GAP + UI.HELP_GAP + UI.HELP_SIZE))
end

local function buildToggle()
    local strip = popWin.strip
    toggle = UI.Toggle2(strip, { { key = "abilities", label = TEXT.abilities }, { key = "healers", label = TEXT.healers } }, setPopView)
    UI.HelpRight(toggle.buttons[2], TEXT.healers, TEXT.viewHelp, { parent = strip })
    layToggle()
end

-- The window is a UI.Window pop-out: the game's window art in Default: Blizzard and the theme in the
-- Modern themes (UI:StyleWindow, restyled on a theme change), the shared title strip with Reset and
-- the close X, the resize grip, Escape to close, and its place and size kept in timeline.popout. A
-- place saved before the window used the helper (any point, with its relativePoint) loads as it was.
local function buildPopout()
    if popWin then
        return
    end
    popWin = UI.Window("CowfeeRaidToolsTimelineWindow", {
        kind = "popout", title = "Timeline", layer = "timeline", saved = popSettings,
        width = 1200, height = 600, minWidth = MIN_W, minHeight = MIN_H,
    })
    buildToggle()

    -- Closing the window, however it closes, puts the Review tab back, and ends a Show on the
    -- Timeline's light. Opened by Show on the Timeline, the main window goes back to the page it
    -- came from (Raid Notes on its Mech Alerts tab); the Dock button stays on the Timeline.
    popWin:SetScript("OnHide", function()
        if view then
            view:ClearHighlight()
        end
        local back = returnPage
        returnPage = nil
        if popped then
            dock()
        end
        if back then
            UI:SelectPage(back)
        end
    end)
    popWin:Hide()
end

-- Puts the Review tab back on the page.
dock = function()
    popped = false
    abilitiesNow = false
    applyPopView(true) -- docked: always the abilities; refresh() below redraws
    reviewFrame:SetParent(tabFrames.review)
    reviewFrame:ClearAllPoints()
    reviewFrame:SetAllPoints(tabFrames.review)
    reviewFrame:Show()
    dockedNote:Hide()
    popButton:SetText("Pop out")
    if popWin and popWin:IsShown() then
        popWin:Hide()
    end
    refresh()
end

-- Moves the Review tab into the pop-out window.
local function popOut()
    buildPopout()
    popped = true
    popWin:SetScale(UI:Scale() / 100)
    popWin:Place()
    reviewFrame:SetParent(popWin.content)
    reviewFrame:ClearAllPoints()
    reviewFrame:SetAllPoints(popWin.content)
    reviewFrame:Show()
    dockedNote:Show()
    popButton:SetText("Dock")
    popWin:Show()
    UI:SkinTree(popWin)
    layToggle()
    applyPopView(true, true)
    refresh()
end

local function togglePopout()
    returnPage = nil
    if popped then
        dock()
    else
        popOut()
    end
end

-- The difficulty name of what is shown: a reference's Difficulty line, or a recorded pull's
-- difficulty as the game names it ("Mythic", "Heroic"). Nil when neither says.
local function shownDifficulty()
    local base = view and view.pull
    if not base then
        return nil
    end
    if base.reference then
        return base.reference.difficulty
    end
    return gameDifficultyName(base.difficultyID)
end

-- The shown boss's encounter ID, or nil when no boss with a known ID is shown.
local function shownEncounter()
    return view and view.EncounterNumber and view:EncounterNumber() or nil
end

-- Shown whenever a boss with a known encounter ID is on the timeline: Share note makes or finds its
-- raid note, so it works before the boss has a note, and solo (the note then only becomes yours).
local function updateShare()
    if shareButton then
        local on = shownEncounter() ~= nil and CRT.Notes ~= nil and CRT.NoteComm ~= nil
        shareButton:SetShown(on)
        shareHelp:SetShown(on)
    end
end

-- Share note: the note a pull of the shown boss and difficulty reads (Notes:NoteFor, the same note
-- the timeline's lines are written to), made with its header when the boss has no note at all, then
-- shared as Share to raid does. Sharing makes it the active note, so Raid Notes shows it.
local function shareNote()
    local encounterID = shownEncounter()
    if not encounterID then
        -- no boss: Share sends the Empty note (Notes/Comm.lua)
        CRT.NoteComm:Share(nil)
        return
    end
    local id, made = CRT.Notes:NoteFor(encounterID, shownDifficulty(), bossName())
    if not id then
        CRT:Print(TEXT.noNote)
        return
    end
    if made then
        local record = CRT.Notes:Get(id)
        CRT:Print(string.format(TEXT.made, (record and record.name) or "the boss"))
    end
    CRT.NoteComm:Share(id)
end

-- Rehearse ---------------------------------------------------------------------------------------
-- The Rehearse button opens the Rehearsal window (Timeline/RehearsalWindow.lua) on what the Review tab
-- shows. It is greyed out with nothing shown, in combat, during a boss encounter and while the alerts
-- run a real pull (CRT.TimelineRehearsalRun.Blocked), and /crt timeline rehearse follows the same rules.

-- The difficulty and boss last shown (timeline.lastView). Its pull field (what a Pull dropdown once
-- picked; still written, as the key of what was drawn) is not read: the ability timeline comes from
-- Timeline:ReferenceFor.
local function loadLastView()
    local last = settings().lastView
    if type(last) == "table" then
        selectedGroup = (last.group == "mythic") and "mythic" or "nh"
        selectedBoss = last.boss
    end
end

local lastViewRead = false

-- What the Review tab shows, as the Rehearsal window takes it: { base, encounterID, boss, pull, group,
-- order, bossName, difficultyName }, or nil when nothing is shown: the ability timeline (never a pull
-- laid over it), else the recorded pull drawn; pull is its key (shownKeyNow). Built the way refresh() builds the view;
-- before the page was first opened, from the last view saved. The difficulty name is a recorded
-- pull's own (as the game names it) or a reference's Difficulty line, else the group's: Mythic, or Heroic for Normal/Heroic.
function Timeline:RehearsalSource()
    if not page then
        if not lastViewRead then
            lastViewRead = true
            loadLastView()
        end
        bossList = buildBossList()
        fixSelection()
    end
    local base, pull
    local entry = shownRef()
    if entry then
        base = { reference = entry.ref }
    else
        pull = shownPull()
        base = pull
    end
    if not base then
        return nil
    end
    local encounterID = selectedBoss
    if type(encounterID) ~= "number" and CRT.TimelineJournal then
        encounterID = CRT.TimelineJournal:ResolveID(encounterID, base.reference) or encounterID
    end
    return {
        base = base,
        encounterID = encounterID,
        boss = selectedBoss,
        pull = shownKeyNow(),
        group = selectedGroup,
        order = chosenOrder(),
        bossName = bossName(),
        difficultyName = (base.reference and base.reference.difficulty) or (pull and gameDifficultyName(pull.difficultyID)) or (selectedGroup == "mythic" and "Mythic" or "Heroic"),
    }
end

-- What the Review tab would show for a boss on a difficulty group ("mythic" or "nh"), as the Rehearsal
-- window takes it (see RehearsalSource): the boss's ability timeline for that group (Timeline:ReferenceFor,
-- as the Review tab shows it), else its newest pull of that group; nil when it has neither. For the alerts'
-- Test buttons (RehearsalWindow:OpenAt); the page's own selection is left alone.
function Timeline:RehearsalSourceFor(encounterID, group)
    group = group == "mythic" and "mythic" or "nh"
    local name
    for _, option in ipairs(CRT.Bosses:Options()) do
        if not option.title and option.key == encounterID then
            name = option.label
        end
    end
    local base, pull
    -- the one picker the alerts use too (Timeline:ReferenceFor)
    local entry = Timeline:ReferenceFor(encounterID, group, name)
    if entry then
        base = { reference = entry.ref }
    end
    if not base then
        pull = Timeline:Pulls(encounterID, group)[1]
        base = pull
    end
    if not base then
        return nil
    end
    local ref = base.reference
    return {
        base = base,
        encounterID = encounterID,
        boss = encounterID,
        pull = pull and pull.id,
        group = group,
        order = ref and ref.order and Reference.ResolveOrder(ref, Timeline:Order(ref.encounterID or encounterID, group)) or nil,
        bossName = name,
        difficultyName = (ref and ref.difficulty) or (pull and gameDifficultyName(pull.difficultyID)) or (group == "mythic" and "Mythic" or "Heroic"),
    }
end

-- Opens the Rehearsal window on the shown fight, or prints why it can't. True when it opened.
function Timeline:Rehearse()
    local source = self:RehearsalSource()
    if not source then
        CRT:Print(TEXT.noRehearse)
        return false
    end
    local why = CRT.TimelineRehearsalRun.Blocked()
    if why then
        CRT:Print(why)
        return false
    end
    CRT.TimelineRehearsalWindow:Open(source)
    return true
end

local function updateRehearse()
    if rehearseButton then
        local can = Timeline:RehearsalSource() ~= nil and not CRT.TimelineRehearsalRun.Blocked()
        rehearseButton:SetEnabled(can)
        playButton:SetEnabled(can)
    end
end

-- Play on the Review tab and the playhead. One fight plays at a time, on the Rehearsal window's clock:
-- Play here opens that window on the shown fight when it isn't open on it, then plays or pauses it,
-- and the window's own Play does the same. While the window is open on the fight shown here (the
-- same boss, difficulty and ability timeline or pull), the view draws the playhead at the window's time.

-- The open rehearsal, when it is of the fight shown here.
local function shownRehearsal()
    local RW = CRT.TimelineRehearsalWindow
    local src = RW and RW:IsOpen() and RW:Source()
    if src and src.boss == selectedBoss and src.pull == shownKeyNow() and src.group == selectedGroup then
        return RW
    end
end

local function playClicked()
    local RW = shownRehearsal()
    if RW then
        RW:TogglePlay()
    elseif Timeline:Rehearse() then
        CRT.TimelineRehearsalWindow:Play()
    end
end

-- Each frame while the Review tab shows: the playhead and the button's Play or Pause.
local function followRehearsal()
    local RW = shownRehearsal()
    if RW then
        view:SetPlayhead(RW:ShownTime(), RW:Playing())
    elseif view.playT then
        view:SetPlayhead(nil)
    end
    local text = (RW and RW:Playing()) and TEXT.pause or TEXT.play
    if playButton:GetText() ~= text then
        playButton:SetText(text)
    end
end

-- The Pop out button on the Review tab, and the note left on the tab while it is popped out.
-- Right to left: Pop out, Rehearse and Play, each with its (?) just after it (UI.HelpRight), so each
-- button stands HELP_ROOM left of the next one, and Pop out's (?) ends at the frame's right inset.
local function buildPopControls()
    local HELP_ROOM = UI.HELP_GAP + UI.HELP_SIZE + 6 -- a (?) after a button, then the gap to the next
    popButton = button(reviewFrame, "Pop out", 90)
    popButton:SetPoint("TOPRIGHT", reviewFrame, "TOPRIGHT", -8 - UI.HELP_GAP - UI.HELP_SIZE, -38)
    popButton:SetScript("OnClick", togglePopout)
    UI.HelpRight(popButton, "Pop out", "Moves the timeline into a window of its own that you can drag and resize. Dock, the window's X or Escape puts it back.")

    -- Rehearse: see Timeline:Rehearse above.
    rehearseButton = button(reviewFrame, TEXT.rehearse, 90)
    rehearseButton:SetPoint("RIGHT", popButton, "LEFT", -HELP_ROOM, 0)
    rehearseButton:SetScript("OnClick", function()
        Timeline:Rehearse()
    end)
    UI.HelpRight(rehearseButton, TEXT.rehearse, TEXT.rehearseHelp)

    -- Play: see playClicked above.
    playButton = button(reviewFrame, TEXT.play, 70)
    playButton:SetPoint("RIGHT", rehearseButton, "LEFT", -HELP_ROOM, 0)
    playButton:SetScript("OnClick", playClicked)
    UI.HelpRight(playButton, TEXT.play, TEXT.playHelp)
    reviewFrame:SetScript("OnUpdate", followRehearsal)

    -- Share note: see shareNote above.
    shareButton = button(reviewFrame, TEXT.shareNote, 90)
    shareButton:SetPoint("TOPRIGHT", reviewFrame, "TOPRIGHT", -8 - UI.HELP_GAP - UI.HELP_SIZE, -66)
    shareButton:SetScript("OnClick", shareNote)
    shareHelp = UI.HelpRight(shareButton, TEXT.shareNote, TEXT.shareHelp)
    shareButton:Hide()
    shareHelp:Hide()

    dockedNote = CreateFrame("Frame", nil, tabFrames.review)
    dockedNote:SetAllPoints(tabFrames.review)
    local text = label(dockedNote, "The timeline is in its own window.", "CRTFontNormal")
    text:SetPoint("CENTER", 0, 20)
    local back = button(dockedNote, "Bring it back", 130)
    back:SetPoint("TOP", text, "BOTTOM", 0, -12)
    back:SetScript("OnClick", dock)
    dockedNote:Hide()
end

-- /crt timeline pop: opens the Timeline page and pops the Review tab out.
function CRT.TimelinePopout()
    UI:Show("timeline")
    if not popped then
        popOut()
    end
end

-- "Show on the Timeline": opens the pop-out on a boss (by encounter ID) with its ability timeline, or
-- else its newest pull, and lights the row of a spell there: spell is a spellID or an ability's name, and
-- name (optional) is tried when no row has that spellID. The boss is
-- looked for on the shown difficulty first, then on the other one. Returns true when the row is
-- shown, false when the boss or the row is not.
local function bossKeyFor(encounterID)
    for _, option in ipairs(bossOptions()) do
        local refs = refsByBoss[option.key] or {}
        local match = option.key == encounterID
        for _, entry in ipairs(refs) do
            match = match or entry.ref.encounterID == encounterID
        end
        -- listed with something to show on this difficulty: a reference or a pull
        if match and (refs[1] or (type(option.key) == "number" and Timeline:Pulls(option.key, selectedGroup)[1])) then
            return option.key
        end
    end
end

function Timeline:ShowRow(encounterID, spell, name)
    if not (popped and popWin:IsShown()) and CRT.db.lastPage ~= "timeline" then
        returnPage = CRT.db.lastPage
    end
    -- an ability's row is on Abilities: for this opening only, decided before the window draws
    abilitiesNow = true
    if popped then
        applyPopView(true, true)
    end
    CRT.TimelinePopout()
    local key, before = nil, selectedGroup
    for _, group in ipairs({ before, before == "nh" and "mythic" or "nh" }) do
        selectedGroup, bossList = group, nil
        key = bossKeyFor(encounterID)
        if key then
            break
        end
    end
    if not key then
        selectedGroup, bossList = before, nil
        refresh()
        return false
    end
    selectedBoss = key
    refresh()
    if not view then
        return false
    end
    local spellID = type(spell) == "number" and spell or nil
    return view:Highlight(spellID, type(spell) == "string" and spell or name)
end

-- The page -------------------------------------------------------------------------------------

refresh = function()
    if not page or not (page:IsShown() or (popped and popWin:IsShown())) then
        return
    end
    bossList = buildBossList()
    fixSelection()
    -- what is shown is kept, so the page (and a reload) opens on it again
    settings().lastView = { group = selectedGroup, boss = selectedBoss, pull = shownKeyNow() }
    for _, control in ipairs(controls) do
        control.refresh()
    end
    updateView()
    updateShare()
    updateRehearse()
    settingsTab:Refresh()
    refTab:Refresh()
end

local function selectTab(key)
    if not tabFrames[key] then
        key = "review"
    end
    currentTab = key
    for _, tab in ipairs(TABS) do
        local on = tab.key == key
        tabFrames[tab.key]:SetShown(on)
        UI:SetTabSelected(tabButtons[tab.key], on)
    end
    if key == "review" then
        refresh() -- the hidden view did not redraw while the Settings tab was open
    end
end

-- Opens the Timeline on its Advanced tab with text in the reference box, ready to fill in and Save (the
-- Encounter Journal's Export Abilities, Timeline/JournalExport.lua).
function Timeline:OpenReferenceText(text)
    UI:Show("timeline")
    selectTab("references")
    if refTab then
        refTab:Fill(text)
    end
end

-- Saves text as one of your references at once and opens it on the Advanced tab, the boss and difficulty
-- it names picked (the Journal's Send to Timeline). Text that doesn't read yet goes in the box with what
-- is wrong. Returns the new reference's key, or nil.
function Timeline:SaveReferenceText(text)
    local key = Reference:Add(text)
    local ref = key and Reference.Parse(text)
    if not ref then
        self:OpenReferenceText(text)
        return nil
    end
    if type(ref.encounterID) == "number" then
        selectedBoss = ref.encounterID
    end
    local diff = (ref.difficulty or ""):lower()
    selectedGroup = diff == "mythic" and "mythic" or "nh"
    bossList = nil
    UI:Show("timeline")
    selectTab("references")
    if refTab then
        refTab:Fill(text, key)
    end
    refresh()
    return key
end

local function build(pf)
    page = pf

    local title = label(pf, "Timeline", "CRTFontLarge")
    title:SetPoint("TOPLEFT", 8, -8)
    UI.HelpRight(title, "The Timeline", "Every raid boss pull is saved on its own: the boss's casts and players' deaths. Pick a boss on the Review tab to see its ability timeline, and click a pull under Recent pulls to see that pull's deaths on it; scroll the wheel to move through the rows (or along the time when they all fit), Shift + wheel or right-drag to move along the time, and Ctrl + wheel to zoom. Drag along the time axis or across the track to zoom to that stretch; Fit, or right-click the axis, shows the whole fight again.\n\nAn ability timeline is the boss's planned timeline; paste your own on the Advanced tab, and pick which one shows there.\n\nThe red lines are phase changes: Shift-drag one to move it, right-click a moved line to put it back.\n\nA row's colour says what the ability is (a dot for each extra type):\n" .. CRT.TimelineReference.Legend())

    for i, tab in ipairs(TABS) do
        local b = CreateFrame("Button", nil, pf, "BackdropTemplate")
        b:SetSize(160, 26)
        b:SetPoint("TOPLEFT", 8 + (i - 1) * 164, -36)
        skin(b, 0.4)
        b.sel = b:CreateTexture(nil, "ARTWORK")
        b.sel:SetAllPoints()
        b.sel:SetColorTexture(UI.Color("heading", 0.18)) -- UI:RegisterTab styles it from here on
        b.text = b:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
        b.text:SetPoint("CENTER")
        b.text:SetText(tab.label)
        b:SetScript("OnClick", function()
            selectTab(tab.key)
        end)
        tabButtons[tab.key] = b
        UI:RegisterTab(b)

        local f = CreateFrame("Frame", nil, pf)
        f:SetPoint("TOPLEFT", 0, -66)
        f:SetPoint("BOTTOMRIGHT", 0, 0)
        f:Hide()
        tabFrames[tab.key] = f
    end
    local line = pf:CreateTexture(nil, "ARTWORK")
    line:SetColorTexture(0.35, 0.35, 0.35, 1)
    line:SetHeight(1)
    line:SetPoint("TOPLEFT", 8, -62)
    line:SetPoint("TOPRIGHT", -8, -62)

    -- The Review tab's content sits in a frame of its own, so Pop out can move it to its window.
    local review = CreateFrame("Frame", nil, tabFrames.review)
    review:SetAllPoints(tabFrames.review)
    buildReview(review)
    buildPopControls()
    -- Advanced: what a reference is, in a few lines over the editor, as it is easy to miss what it does
    local blurb = tabFrames.references:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    blurb:SetPoint("TOPLEFT", 8, -8)
    blurb:SetPoint("TOPRIGHT", -8, -8)
    blurb:SetJustifyH("LEFT")
    blurb:SetSpacing(2)
    blurb:SetTextColor(0.85, 0.78, 0.67)
    blurb:SetText(TEXT.advancedBlurb)
    local refHost = CreateFrame("Frame", nil, tabFrames.references)
    refHost:SetPoint("TOPLEFT", 0, -ADVANCED_BLURB_H)
    refHost:SetPoint("BOTTOMRIGHT", 0, 0)
    refTab = ReferencePage.Build(refHost, {
        selectedBoss = function()
            return selectedBoss
        end,
        bossName = bossName,
        difficulty = function()
            return selectedGroup
        end,
        references = bossRefs,
        refresh = function()
            refresh()
        end,
    })
    settingsTab = SettingsTab.Build(tabFrames.settings, {
        selectedBoss = function()
            return selectedBoss
        end,
        bossName = bossName,
        showingReference = showingReference,
        shownReference = function()
            return shownRef()
        end,
        refresh = function()
            refresh()
        end,
    })

    -- open on the difficulty and boss last shown; fixSelection falls back when the boss is gone
    loadLastView()
    lastViewRead = true

    pf:SetScript("OnShow", function()
        selectTab(currentTab)
        refresh()
    end)
    Timeline:OnChange(refresh)
    CRT.Bosses:OnRouteChange(refresh) -- the raid route, the boss list's order
    if CRT.Notes and CRT.Notes.OnChange then
        CRT.Notes:OnChange(refresh) -- a note shared, edited or deleted
    end
    -- Rehearse greys out as combat or an encounter starts, and while the alerts run a real pull
    CRT.TimelineRehearsalRun.OnChange(updateRehearse)
    if CRT.Alerts and CRT.Alerts.OnChange then
        CRT.Alerts:OnChange(updateRehearse)
    end
end

UI:RegisterPage("timeline", "Timeline", build)
