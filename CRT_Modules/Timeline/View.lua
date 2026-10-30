local ADDON, CRT = ...

-- Timeline: the canvas that draws one saved pull. Each lane is a row: the deaths first (one row,
-- or one per player), then the boss's ability rows with their casts, then "Boss casts (unnamed)"
-- for casts whose spell could not be read or has no row. A fixed column on the left holds the
-- lane names; the track to its right scrolls sideways under a time axis and up and down with the
-- lane names. The mouse wheel over the track zooms around the cursor (with Shift it scrolls the
-- lanes), dragging the track or its bar scrolls it, and hovering shows the time under the cursor.
-- A left drag along the time axis or on the track selects a range and zooms to it;
-- view:Fit() and a right-click on the axis show the whole fight again (see "Zooming to a range").
-- Icons come from a pool and are reused on every refresh, since frames cannot be deleted. With the
-- overlay on, deaths from the pulls before the shown one are drawn faded by how old they are. Deaths of
-- one pull that would overlap share one icon with their count, listed together in its tooltip.
-- A reference timeline is drawn the same way, plus its phase lines and labels, a bar behind each
-- cast that lasts a while, a thin line before each cast that has a lead time, and the row names in
-- their own colors. A pull laid over a reference adds its deaths, a row of small ticks for its
-- casts and a line where it ended. Bars, lines and ticks come from pools like the icons.
-- The page builds one with View.Create(parent) and hands it a pull or { reference = ref }, and an
-- optional pull to lay over it, with view:SetData.
-- Two left clicks on the track (not on an icon or a marker) drop a new alert there: the editor opens
-- with the row's spell and the clicked time as phase + seconds. Every saved note line and reminder of
-- the boss is drawn as a small flag on its spell's row, or on a "Notes" row added at the bottom for
-- the ones with no row; a double-click on a flag opens it in the editor.
-- Along the bottom, a strip holds a chip for each template (CRT.AlertSaved) and a "+" chip that makes
-- one. Dragging a chip onto the track opens the editor on a new alert from it at that time (taking the
-- spell of a cast icon it is dropped on); right-clicking a chip edits, renames or deletes it. Under it a
-- Cooldowns row lists healer cooldowns and raid defensives (CRT.AlertCooldowns, filtered by its
-- dropdown): dragged the same way, one is saved at once as an alert of your own with its spell (shown as
-- text and read out, Alerts/Draft.lua's cooldown defaults), or for a raid leader or assistant after a menu
-- of who it is for (a Raid note line for a player, or for no one yet); a double-click on its flag edits it.
-- Right-clicked, it can be saved as a template; the cooldowns themselves never change. A single click on
-- a flag selects it (outlined; a click on empty track or Escape clears it): its spell's cooldown shows as
-- two see-through bands on its row, the cooldown before the cast and after it, red where another cast of
-- the spell for the same target falls inside. The bands also follow a dragged flag, and a dragged chip
-- with a spell on the lane under the cursor, and the drag's label says when the drop would be too soon
-- (Cooldowns:Length gives the length; with none there are no bands). Each group's
-- chips wrap onto rows, up to 3 shown (fewer when the lanes
-- would get under 3 rows); the wheel scrolls the rest. A right click on the track that doesn't move
-- opens a menu there: New alert here, or Place a template or a cooldown.
-- view:SetMode("healers") (the pop-out's Healer CDs toggle) draws Timeline/HealerView.lua's layout: the
-- ability rows as they are, then each healer with one row per major cooldown, the raid note's cooldown lines
-- on them as icons in line with their cooldown bands; the axis, zoom, scrolling, flag drag and Undo are this
-- view's. A non-lead's drag of their own cast there keeps their own time (HealerView.MovePersonal). A click on
-- an empty spot of a cooldown row places its cooldown there (HealerView.Click), with its shadow shown while
-- hovering (HealerView.Hover, from OnUpdate). SetMode(nil) goes back.

local View = {}
CRT.TimelineView = View

local LABEL_W = 166 -- the lane name column, with a mechanic's show tick at its left
local NAME_X = 42 -- where a lane's name starts in its label, after the tick and the icon
local ROW_H = 30
View.ROW_H = ROW_H -- every lane's height, for Timeline/HealerView.lua's bands
local AXIS_H = 20
local PHASE_ROW_H = 12 -- each row of phase labels above the time labels
local PHASE_ROWS = 2 -- phase labels stagger over at most this many rows
local BAR_H = 10 -- the sideways scroll bar
local UNKNOWN_H = 16 -- the "Time unknown" line under the lanes
local SCROLLBAR_W = 24 -- room for the lanes' up and down scroll bar
local MIN_SPAN, MAX_SPAN = 60, 600
local ZOOM = 1.25
local TICK_GAP = 40 -- the fewest pixels between two axis labels
local DEATH_RED = { 0.89, 0.29, 0.29 } -- also the phase lines
local END_LINE_W = 3 -- the line where an overlaid pull ended, in the kill or wipe colour
local LEAD_GREEN = { 0.72, 0.88, 0.72 }
local DUR_H = 18 -- the height of a duration bar
local BAR_ALPHA = 0.45
local TINT_ALPHA = 0.08 -- a reference row's background, in its type's color
local DOT = "Interface\\CHARACTERFRAME\\TempPortraitAlphaMask" -- a white circle, colored per type
local DOT_SIZE = 8
local MAX_DOTS = 3
local TAG_SIZE = 14 -- the Journal's icons at the right of a row's name (Reference.TAGS atlases)
local MAX_TAGS = 4
local TICK_W, TICK_H = 3, 10 -- one cast of an overlaid pull
local SKULL = "Interface\\TargetingFrame\\UI-TargetingFrame-Skull"
-- A death's round icon (View.DeathLook): a ring in its class colour around the face, masked round. The class
-- icons are the game's round ones (Blizzard_SharedXML/PortraitFrame.lua's SetPortraitToClassIcon: this file
-- with CLASS_ICON_TCOORDS from SharedConstants.lua); a spec icon is cut in a little so its square frame
-- doesn't show at the edge. One table, to spare the file's locals.
local DEATH_ICON = {
    classes = "Interface\\TargetingFrame\\UI-Classes-Circles",
    ring = 2, -- pixels of class colour around the face
    crop = { 0.08, 0.92, 0.08, 0.92 },
    full = { 0, 1, 0, 1 },
}
local UNNAMED_ICON = "Interface\\Icons\\INV_Misc_QuestionMark"
local NOTES_ICON = "Interface\\Icons\\INV_Misc_Note_01"
local PERSONAL_ICON = "Interface\\Icons\\INV_Misc_Note_02"
local FLAG_W, FLAG_HEAD = 12, 14 -- a marker's flag, drawn on a pole as tall as the row less 6 px
local FLAG_BTN_W = 20 -- the clickable marker: a square at the row top, the flag centred in it
local DOUBLE_TIME, DOUBLE_DIST = 0.3, 6 -- two clicks on the track this close make a double-click
local MOVE_DIST = 4 -- a flag held and moved less than this many pixels is a click, not a drag
local STRIP_ROW = 26 -- one row of the strip under the scroll bar: the templates, then the cooldowns
local STRIP_H = STRIP_ROW * 2 -- the strip at one row per group; it grows with the rows shown (view.stripH)
local STRIP_MAX_ROWS = 3 -- the most rows of chips a group shows; the wheel scrolls the rest
local STRIP_MIN_LANES = 3 -- lane rows that always stay in view: the groups show fewer rows first
local STRIP_IND_W, STRIP_IND_GAP = 3, 3 -- the bar at a group's right end showing its rows in view
local CHIP_H, CHIP_ICON, CHIP_EDGE, CHIP_GAP = 20, 16, 3, 4
local CHIP_NAME_MAX = 160 -- a longer name is cut short on its chip
local PLUS_W = 22
local MENU_DIST, MENU_TIME = 6, 0.3 -- a right click that moves less and lets go sooner opens the menu
local DASH, DASH_GAP = 6, 4 -- the dashed line where a dragged chip would land
local RENAME_POPUP = "COWFEE_RAID_TOOLS_SAVED_ALERT_RENAME"
local CD_DROP_W = 120 -- the Cooldowns row's filter dropdown
local ASSIGN_MENU_MAX_H = 400 -- the "Anyone else" submenu scrolls past this height
local SELECT_COLOR = { 0xF3 / 255, 0xEC / 255, 0xE0 / 255 } -- the selected flag's outline: foamy off-white F3ECE0
local SELECT_W = 2 -- the selected flag's outline width
local BAND_ALPHA = 0.25 -- a cooldown band: the flag's edge colour, this see-through
local BAND_RED_ALPHA = 0.45 -- the part of a band where another cast of the spell for the same target falls
local BAND_LINE_W = 1 -- the line at a band's far end, where the cooldown is up again
local BAND_INSET = 2 -- a band's gap from its row's top and bottom
local BAND_LABEL_PAD = 3 -- the length label's room inside the after band
local SAME_MOMENT = 0.05 -- seconds: another cast this close to the selected one is the same moment, not too soon
-- a band's red, for Timeline/HealerView.lua's bands of every cast
View.BAND_RED = { DEATH_RED[1], DEATH_RED[2], DEATH_RED[3], BAND_RED_ALPHA }
View.RELAYOUT_GAP = 0.1 -- seconds: while the view's size keeps changing (a drag of the pop-out's grip), it lays out this often
View.LABEL_W = LABEL_W -- for the window log (CRT_Dev/Dev/WindowLog.lua)
local SELECT_INNER = { 0.10, 0.07, 0.05 } -- a dark inner border under the outline, so it shows on any flag colour
local SELECT_INNER_W = 1
local REVIEW_LANES = { recentDeaths = true } -- this view draws Deaths from recent pulls on an ability timeline too
-- drag to zoom, in one table to spare the file's locals (Lua 5.1 allows 200 in a chunk):
local ZOOM_SEL = {
    bandAlpha = 0.18, -- the band over the lanes, in the heading colour; its edges are solid
    minPx = 2, minSec = 1, -- a selected range narrower than either is ignored
    edgeStep = 12, -- the most pixels a frame the track scrolls while a selection is past its edge
}

local TEXT = {
    notes = "Notes",
    personal = "Personal notes",
    ignoredHead = "Ignored mechanics (%d)",
    showTip = "Untick to hide this mechanic on your timeline. It moves to Ignored mechanics at the bottom; tick it there to bring it back. Only your view changes: its alerts still fire, and no note changes.",
    personalHelp = "Your personal reminders (Save as: Only me). These are only yours: they stay on your PC and are "
        .. "never shared with the raid.\n\nDouble-click this row, or drop a template on it, to make one. Drag one "
        .. "to change its time; Alt+drag adds a time.",
    view = "View",
    everyone = "Everyone",
    noOne = "No one (timers window only)",
    onlyMe = "Only me",
    raidNote = "Raid note",
    raidNoteOf = "Raid note (%s)",
    deathsHere = "%d deaths",
    yourReminder = "Your reminder",
    reminder = "Reminder",
    spell = "Spell %d",
    needPull = "Reminders need the boss pulled once, or its ability timeline to have an Encounter line.",
    moveTo = "Move to %s",
    addTime = "Alt \194\183 add a time %s",
    moveRefused = "That alert changed since you grabbed it; nothing was moved.",
    savedAlerts = "Templates",
    savedHelp = "Your templates: an alert's setup without its time. Drag one onto the timeline to make an "
        .. "alert there (dropped on a boss spell's icon it takes that spell). Right-click one to edit, rename or "
        .. "delete it; + makes a new one. \"Save As Template\" in the alert editor makes one too.\n\n"
        .. "Right-click the timeline (without dragging) for New alert here, or Place a template at that time.",
    newSaved = "New template",
    savedHint = "Drag onto the timeline to place it. Right-click to edit, rename or delete.",
    shows = "Shows: %s",
    showsNothing = "Shows nothing",
    readOut = "read out",
    outputs = { alert = "Note callout/assignments", text = "Critical alerts text", icon = "Icon", bar = "Bar", circle = "Circle", timeline = "Alert timeline" },
    raidNoteFor = "Raid note for %s",
    placeAt = "Place at %s",
    edit = "Edit",
    rename = "Rename",
    delete = DELETE or "Delete",
    cancel = CANCEL or "Cancel",
    accept = ACCEPT or "Accept",
    renamePrompt = "Rename this template:",
    deleteConfirm = "Delete the template \"%s\"?",
    newHere = "New alert here",
    place = "Place",
    noSaved = "No templates yet",
    unnamed = "Template",
    noMenu = "This game version has no right-click menus for this.",
    deleteRefused = "That alert changed since you opened its menu; nothing was deleted.",
    deleteNote = "Delete this raid note line?\n\n%s",
    deleteTime = "Delete this time of \"%s\"? Its other times stay.",
    deleteReminder = "Delete your reminder \"%s\"?",
    cooldowns = "Cooldowns",
    cooldownsHelp = "Healer cooldowns and raid defensives. Drag one onto the timeline to place an alert with its "
        .. "spell there at once (your own, Only me), shown as text and read out. A raid leader or assistant "
        .. "picks who it is for: a player of its class, anyone else on the Raid Groups layout, no one yet, or "
        .. "just you. Double-click its flag to change it. Right-click one to save it as a template.\n\n"
        .. "The dropdown picks which ones are listed: your class (healer cooldowns when your class has none), "
        .. "all of them, the healer cooldowns, the raid defensives, or one class.",
    cooldownHint = "Drag onto the timeline to place an alert",
    saveTemplate = "Save as template",
    noCooldowns = "No cooldowns",
    assignClass = "%s", -- the title over a dropped cooldown's class players: the class's name
    noClass = "No %s on this roster",
    unassigned = "Leave unassigned",
    anyoneElse = "Anyone else",
    justMe = "Just me",
    -- the chat line after a cooldown is placed: its name, the time, and who it is for
    placedFor = "%s placed at %s for %s.",
    placedMine = "%s placed at %s for you.",
    placedNone = "%s placed at %s unassigned.",
    placeFailed = "%s was not placed: %s",
    placeFailedWhy = "it could not be saved.", -- the reason in placeFailed when none is given
    bandLength = "%d:%02d", -- a cooldown band's length, minutes and seconds, inside the after band
    tooSoon = " \194\183 too soon", -- added to a drag's label when another cast of the spell is inside its bands
    zoomRange = "%s - %s (%s)", -- the drag-to-zoom band's label: from, to, and how long
    kill = "Kill %s", -- the end line's tag on the axis: how the overlaid pull ended, and when
    wipe = "Wipe %s",
    ended = "End %s", -- a pull with no saved result
}

local function settings()
    return CRT.Timeline:Settings()
end

local function rgba(key, alpha)
    local c = CRT.PALETTE[key] or CRT.PALETTE.text or { 1, 1, 1 } -- a palette without the key (an old theme) draws white
    return c[1], c[2], c[3], alpha or 1
end

-- Colors a part made once (method "SetColorTexture", "SetTextColor" or "SetVertexColor") from the theme,
-- and again when the theme changes (UI.Tint). What is drawn on each Refresh reads rgba() instead.
local function themed(region, method, key, alpha)
    local UI = CRT.UI
    if UI and UI.Tint then
        UI.Tint(region, method, key, alpha)
    else
        region[method](region, rgba(key, alpha))
    end
end

local function clampSpan(seconds)
    seconds = tonumber(seconds) or 300
    return math.max(MIN_SPAN, math.min(MAX_SPAN, math.floor(seconds + 0.5)))
end

-- Pure helpers -------------------------------------------------------------------------------------

-- Auto's steps, finest first: the first at least AUTO_GAP pixels apart at the zoom is used, so zoomed all
-- the way in (60 seconds across the track) it labels every 5 seconds, and zoomed out every minute.
local AUTO_STEPS = { 5, 10, 15, 30, 60, 120 }
local AUTO_GAP = 80

-- The seconds to label on an axis, from 0 to span: with grid "auto" (or none) the first of AUTO_STEPS at
-- least AUTO_GAP pixels apart; with a number of seconds, multiples of it, the step doubled until
-- neighbors are at least TICK_GAP pixels apart at this width.
function View.Ticks(span, grid, width)
    local list = {}
    if not span or span <= 0 or not width or width <= 0 then
        return list
    end
    local perSecond = width / span
    local step
    if type(grid) == "number" and grid > 0 then
        step = grid
        while step * perSecond < TICK_GAP do
            step = step * 2
        end
    else
        for _, s in ipairs(AUTO_STEPS) do
            step = s
            if s * perSecond >= AUTO_GAP then
                break
            end
        end
    end
    local s = 0
    while s <= span do
        list[#list + 1] = s
        s = s + step
    end
    return list
end

function View.TimeToX(t, span, width)
    -- t * width / span rather than t / span * width, so whole seconds land on whole pixels
    return t * width / span
end

-- The reverse of TimeToX: the time at x pixels.
function View.XToTime(x, span, width)
    return x * span / width
end

-- t to the nearest tenth of a second.
local function tenth(t)
    return math.floor(t * 10 + 0.5) / 10
end

function View.Format(t)
    t = math.max(0, math.floor(t or 0))
    return string.format("%d:%02d", math.floor(t / 60), t % 60)
end

-- The lanes come from Timeline/Lanes.lua; the old name stays so the callers and tests keep working.
View.Lanes = CRT.TimelineLanes.Build

-- Tooltips -----------------------------------------------------------------------------------------

local function hideTip()
    GameTooltip:Hide()
end

local function spellName(spellID)
    if type(spellID) == "number" and spellID > 0 then
        local ok, name = pcall(C_Spell.GetSpellName, spellID)
        if ok and type(name) == "string" then
            return name
        end
    end
end

-- The difficulty group a view's Journal text is read at: the view's own, else its pull's difficulty's.
local function viewGroup(view)
    if not view then
        return nil
    end
    if view.group then
        return view.group
    end
    local pull = view.pull
    local d = pull and pull.difficultyID
    return type(d) == "number" and CRT.Timeline.DifficultyGroup and CRT.Timeline.DifficultyGroup(d) or nil
end

-- A boss ability's tooltip through the shared one (CRT.AbilityTip): its spell, the lines given (about the
-- hovered cast), its Journal text, its types and Journal icons.
local function abilityTip(owner, lane, spellID, lines)
    local view = owner.view
    CRT.AbilityTip:Show(GameTooltip, owner, "timeline", {
        encounterID = view and view:EncounterNumber() or nil,
        group = viewGroup(view),
        spellID = spellID,
        name = lane.label,
        sectionID = lane.sectionID,
        types = lane.types,
        tags = lane.tags,
        lines = lines,
    })
end

local function iconEnter(b)
    -- a mark drawn on another row than its own names its own (mark.source)
    local mark = b.mark
    local lane = mark.source or b.lane
    if lane.kind == "reference" then
        local lines = { { "Planned at " .. View.Format(mark.t), 1, 1, 1 } }
        if type(mark.dur) == "number" and mark.dur > 0 then
            lines[#lines + 1] = { string.format("Lasts %ds", mark.dur), 0.85, 0.85, 0.85 }
        end
        if type(lane.lead) == "number" and lane.lead > 0 then
            lines[#lines + 1] = { string.format("Cast starts %ds before", lane.lead), 0.85, 0.85, 0.85 }
        end
        abilityTip(b, lane, lane.spellID, lines)
        return
    elseif not mark.death and lane.kind ~= "unnamed" then
        abilityTip(b, lane, mark.spellID, { { "Cast at " .. View.Format(mark.t), 1, 1, 1 } })
        return
    end
    CRT.UI.TooltipOwner(GameTooltip, b, "ANCHOR_RIGHT", nil, nil, "timeline")
    local stacked = mark.deaths and #mark.deaths > 1 and mark.deaths
    if stacked then
        -- deaths sharing one icon (View.StackDeaths): each on its own line, its name in its class colour
        GameTooltip:SetText(string.format(TEXT.deathsHere, #stacked), 1, 1, 1)
        for _, d in ipairs(stacked) do
            local killer = spellName(d.spellID)
            local r, g, bl = CRT.Groups.ClassColor(d.name, d.class)
            GameTooltip:AddDoubleLine(View.DeathName(d), View.Format(d.t) .. ", " .. (killer and ("Killed by " .. killer) or "Killing blow unknown"),
                r, g, bl, 0.85, 0.85, 0.85)
        end
        if (mark.overlay or settings().overlayOn) and mark.pull and mark.pull.id then
            GameTooltip:AddLine("Pull " .. tostring(CRT.Timeline.PullNumber(mark.pull)), 0.85, 0.85, 0.85)
        end
    elseif mark.death then
        local d = mark.death
        GameTooltip:SetText(d.name or "Unknown", CRT.Groups.ClassColor(d.name, d.class))
        local who = View.DeathWho(d) -- "Holy Paladin", or the class alone
        if who then
            GameTooltip:AddLine(who, CRT.Groups.ClassColor(d.name, d.class))
        end
        GameTooltip:AddLine(type(d.t) == "number" and ("Died at " .. View.Format(d.t)) or "time unknown", 1, 1, 1)
        local killer = spellName(d.spellID)
        GameTooltip:AddLine(killer and ("Killed by " .. killer) or "Killing blow unknown", 0.85, 0.85, 0.85)
        -- a pull laid over a reference always says which it is; the age overlay only when it is on
        if (mark.overlay or settings().overlayOn) and mark.pull and mark.pull.id then
            GameTooltip:AddLine("Pull " .. tostring(CRT.Timeline.PullNumber(mark.pull)), 0.85, 0.85, 0.85)
        end
    else
        GameTooltip:SetText("Boss cast (unnamed)", 1, 1, 1)
        GameTooltip:AddLine("Cast at " .. View.Format(mark.t), 0.85, 0.85, 0.85)
        if type(mark.dur) == "number" and mark.dur > 0 then
            GameTooltip:AddLine(string.format("Duration %.1fs", mark.dur), 0.85, 0.85, 0.85)
        end
    end
    GameTooltip:Show()
end

-- The game's class names by tag word: the class file name ("DEATHKNIGHT", as the editor writes it)
-- and the name with its spaces taken out, lower-cased. Made once the game lists the classes.
local classNames
local function className(word)
    local names = classNames
    if not names then
        names = {}
        for i = 1, GetNumClasses and GetNumClasses() or 0 do
            local name, file = GetClassInfo(i)
            if CRT.Timeline.readable(name) and type(name) == "string" and name ~= "" then
                names[(name:gsub("%s+", "")):lower()] = name
                if CRT.Timeline.readable(file) and type(file) == "string" then
                    names[file:lower()] = name
                end
            end
        end
        if next(names) then
            classNames = names
        end
    end
    return names[word:lower()] or word
end

-- Death icons ----------------------------------------------------------------------------------------------

-- A saved spec's name, icon and localized class name (CRT.Groups.SpecInfo), or nil.
local function specOf(d)
    local Groups = CRT.Groups
    if not (d and type(d.spec) == "number" and Groups and Groups.SpecInfo) then
        return nil
    end
    local ok, name, icon, _, class = pcall(Groups.SpecInfo, d.spec)
    if ok then
        return name, icon, class
    end
    return nil
end

-- How a death mark is drawn: { texture, coords (nil for the whole texture), skull (true for the skull), ring =
-- { r, g, b } }. One death: the icon of the spec it saved, else the meter's spec icon it saved, else its class's
-- round icon, else the skull, in a ring of its class colour. Several sharing one mark: the skull in the death red.
-- Only what the death saved: a player may have changed spec since, so the spec cache is not asked here.
function View.DeathLook(mark)
    local d = mark and mark.death
    if not d or (mark.deaths and #mark.deaths > 1) then
        return { texture = SKULL, skull = true, ring = { DEATH_RED[1], DEATH_RED[2], DEATH_RED[3] } }
    end
    local r, g, b = CRT.Groups.ClassColor(d.name, d.class)
    local look = { ring = { r, g, b } }
    local _, icon = specOf(d)
    icon = icon or d.specIcon
    local coords = type(CLASS_ICON_TCOORDS) == "table" and type(d.class) == "string" and CLASS_ICON_TCOORDS[d.class:upper()]
    if icon then
        look.texture = icon
    elseif type(coords) == "table" and #coords == 4 then
        look.texture, look.coords = DEATH_ICON.classes, coords
    else
        look.texture, look.skull = SKULL, true
    end
    return look
end

-- "Holy Paladin" for a death that saved its spec, "Paladin" for one with only its class, else nil.
function View.DeathWho(d)
    local spec, _, class = specOf(d)
    if not class and type(d.class) == "string" then
        local name = className(d.class)
        class = name ~= d.class and name or nil
    end
    if spec and class then
        return spec .. " " .. class
    end
    return spec or class
end

-- A death's name in a stack's tooltip, with its saved spec: "Healy (Holy)".
function View.DeathName(d)
    local spec = specOf(d)
    local name = d.name or "Unknown"
    return spec and (name .. " (" .. spec .. ")") or name
end

-- An icon button's round parts for a death, hidden until one is drawn: the ring, a dark disc and the face,
-- masked round with the game's circle mask (Texture:AddMaskTexture with a MaskTexture of TempPortraitAlphaMask,
-- as Blizzard's own CircleMask templates do). Made once with the button.
function View.MakeDeathParts(b)
    b.ring = b:CreateTexture(nil, "BACKGROUND", nil, 1)
    b.ring:SetAllPoints()
    b.ring:SetTexture(DOT)
    b.disc = b:CreateTexture(nil, "BORDER")
    b.disc:SetPoint("TOPLEFT", DEATH_ICON.ring, -DEATH_ICON.ring)
    b.disc:SetPoint("BOTTOMRIGHT", -DEATH_ICON.ring, DEATH_ICON.ring)
    b.disc:SetTexture(DOT)
    b.disc:SetVertexColor(0, 0, 0)
    b.face = b:CreateTexture(nil, "ARTWORK", nil, 1)
    b.face:SetAllPoints(b.disc)
    local mask = b.CreateMaskTexture and b:CreateMaskTexture()
    if mask and b.face.AddMaskTexture then
        mask:SetTexture(DOT, "CLAMPTOBLACKADDITIVE", "CLAMPTOBLACKADDITIVE")
        mask:SetAllPoints(b.face)
        b.face:AddMaskTexture(mask)
    end
    b.ring:Hide()
    b.disc:Hide()
    b.face:Hide()
end

-- Draws a death mark on an icon button (View.DeathLook), the square parts hidden.
function View.DrawDeath(b, mark)
    local look = View.DeathLook(mark)
    b.bg:Hide()
    b.tex:Hide()
    b.ring:SetVertexColor(look.ring[1], look.ring[2], look.ring[3])
    b.face:SetTexture(look.texture)
    local c = look.coords or (look.skull and DEATH_ICON.full) or DEATH_ICON.crop
    b.face:SetTexCoord(c[1], c[2], c[3], c[4])
    b.ring:Show()
    b.disc:Show()
    b.face:Show()
end

-- Back to the square look of a boss cast on a button that drew a death before.
function View.DrawSquare(b)
    b.ring:Hide()
    b.disc:Hide()
    b.face:Hide()
    b.bg:Show()
    b.tex:Show()
end

-- A marker: the alert's text, who it is for, its phase and time, and where it is saved.
local function flagEnter(f)
    local m = f.mark
    CRT.UI.TooltipOwner(GameTooltip, f, "ANCHOR_RIGHT", nil, nil, "timeline")
    GameTooltip:SetText(m.text, 1, 0.82, 0)
    local who = TEXT.onlyMe
    if not m.mine then
        local words = {}
        for i, tag in ipairs(m.tags or {}) do
            words[i] = tag:lower() == "everyone" and TEXT.everyone or className(tag)
        end
        who = #words > 0 and table.concat(words, " ") or TEXT.noOne
    end
    GameTooltip:AddLine(who, 1, 1, 1)
    GameTooltip:AddLine(CRT.AlertReminders.FormatTimes({ { ph = m.ph, t = m.time } }), 0.85, 0.85, 0.85)
    local source = TEXT.yourReminder
    if not m.mine then
        source = m.difficulty and string.format(TEXT.raidNoteOf, m.difficulty) or TEXT.raidNote
    end
    GameTooltip:AddLine(source, 0.85, 0.85, 0.85)
    -- Healer CDs' own lines: whose cast it is and who may move it, your time against the raid's
    for _, line in ipairs(m.tipLines or {}) do
        GameTooltip:AddLine(line, 0.85, 0.85, 0.85, true)
    end
    GameTooltip:Show()
end

-- A boss ability's row name: the shared ability tooltip. The other rows (deaths, unnamed casts, notes) have none.
local ABILITY_LANES = { spell = true, reference = true, journal = true }

local function labelEnter(l)
    local lane = l.lane
    if lane and ABILITY_LANES[lane.kind] then
        abilityTip(l, lane, lane.spellID)
    elseif lane and lane.tip then
        lane.tip(l) -- a Healer CDs row's own tooltip
    end
end

-- The view ------------------------------------------------------------------------------------------

local Methods = {}
Methods.__index = Methods
local count = 0

-- Takes item n of a pool, making it with make() the first time, and shows it.
local function pooled(list, n, make)
    local item = list[n]
    if not item then
        item = make()
        list[n] = item
    end
    item:Show()
    return item
end

local function hideFrom(list, n)
    for i = n, #list do
        list[i]:Hide()
    end
end

-- The cursor's x in pixels from the left edge of frame.
local function cursorX(frame)
    local x = GetCursorPosition()
    return x / frame:GetEffectiveScale() - (frame:GetLeft() or 0)
end

function View.Create(parent)
    count = count + 1
    local view = setmetatable({
        icons = {}, labels = {}, lines = {}, ticks = {}, texts = {}, lanes = {}, unknown = {}, trackW = 1,
        bars = {}, leads = {}, phaseLines = {}, phaseTexts = {}, pullTicks = {}, extra = { phases = {}, length = 0 },
        flags = {}, marks = {}, chips = {}, dashes = {}, cdChips = {}, stripH = STRIP_H,
    }, Methods)
    local f = CreateFrame("Frame", nil, parent)
    f:SetAllPoints(parent)
    view.frame = f
    if CRT.TimelineUndo then
        CRT.TimelineUndo:Watch(f) -- changes made while this view shows can be undone
    end

    -- the time under the cursor, in the empty corner above the lane names
    view.hover = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    view.hover:SetPoint("TOPLEFT", f, "TOPLEFT", 4, -4)
    themed(view.hover, "SetTextColor", "label")

    -- the axis: a scroll frame that follows the track's sideways scroll
    local axisScroll = CreateFrame("ScrollFrame", nil, f)
    axisScroll:SetPoint("TOPLEFT", f, "TOPLEFT", LABEL_W, 0)
    axisScroll:SetPoint("TOPRIGHT", f, "TOPRIGHT", -SCROLLBAR_W, 0)
    axisScroll:SetHeight(AXIS_H)
    local axis = CreateFrame("Frame", nil, axisScroll)
    axis:SetSize(1, AXIS_H)
    axisScroll:SetScrollChild(axis)
    view.axisScroll, view.axis = axisScroll, axis
    local base = f:CreateTexture(nil, "ARTWORK")
    base:SetPoint("BOTTOMLEFT", axisScroll, "BOTTOMLEFT")
    base:SetPoint("BOTTOMRIGHT", axisScroll, "BOTTOMRIGHT")
    base:SetHeight(1)
    themed(base, "SetColorTexture", "accent")
    -- a left drag along the axis selects a range to zoom to; a right-click shows the whole fight
    axisScroll:EnableMouse(true)
    axisScroll:SetScript("OnMouseDown", function(_, button)
        view:AxisMouseDown(button)
    end)
    axisScroll:SetScript("OnMouseUp", function(_, button)
        view:AxisMouseUp(button)
    end)

    view.unknownText = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    -- placed above the strip by PlaceStrip, as are the scroll bar and the lanes
    view.unknownText:SetPoint("BOTTOMLEFT", f, "BOTTOMLEFT", 4, view.stripH + 2)
    view.unknownText:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -4, view.stripH + 2)
    view.unknownText:SetJustifyH("LEFT")

    view:BuildStrip()

    -- the sideways scroll bar under the track
    local bar = CreateFrame("Slider", nil, f)
    bar:SetOrientation("HORIZONTAL")
    bar:SetPoint("BOTTOMLEFT", f, "BOTTOMLEFT", LABEL_W, view.stripH + UNKNOWN_H + 2)
    bar:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -SCROLLBAR_W, view.stripH + UNKNOWN_H + 2)
    bar:SetHeight(BAR_H)
    local barBg = bar:CreateTexture(nil, "BACKGROUND")
    barBg:SetAllPoints()
    themed(barBg, "SetColorTexture", "surface")
    bar:SetThumbTexture("Interface\\Buttons\\WHITE8X8")
    local thumb = bar:GetThumbTexture()
    if thumb then
        themed(thumb, "SetVertexColor", "accent")
        thumb:SetSize(40, BAR_H)
    end
    bar:SetMinMaxValues(0, 0)
    bar:SetValue(0)
    bar:SetScript("OnValueChanged", function(_, value)
        if not view.syncing then
            view:ScrollTo(value)
        end
    end)
    view.bar = bar

    -- the lanes: an up and down scroll frame holding the name column and the sideways track
    local vscroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsTimelineView" .. count, f, "UIPanelScrollFrameTemplate")
    if CRT.UI and CRT.UI.SkinScrollBar then
        CRT.UI:SkinScrollBar(vscroll.ScrollBar)
    end
    vscroll:SetPoint("TOPLEFT", f, "TOPLEFT", 0, -AXIS_H)
    vscroll:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -SCROLLBAR_W, view.stripH + UNKNOWN_H + BAR_H + 4)
    local body = CreateFrame("Frame", nil, vscroll)
    body:SetSize(1, 1)
    vscroll:SetScrollChild(body)
    view.vscroll, view.body = vscroll, body

    local hscroll = CreateFrame("ScrollFrame", nil, body)
    hscroll:SetPoint("TOPLEFT", body, "TOPLEFT", LABEL_W, 0)
    hscroll:SetPoint("BOTTOMRIGHT", body, "BOTTOMRIGHT")
    local track = CreateFrame("Frame", nil, hscroll)
    track:SetSize(1, 1)
    hscroll:SetScrollChild(track)
    view.hscroll, view.track = hscroll, track
    view.cursorLine = track:CreateTexture(nil, "OVERLAY")
    view.cursorLine:SetWidth(1)
    themed(view.cursorLine, "SetColorTexture", "text", 0.5)
    view.cursorLine:Hide()

    hscroll:EnableMouse(true)
    hscroll:EnableMouseWheel(true)
    hscroll:SetScript("OnMouseWheel", function(_, delta)
        view:Wheel(delta)
    end)
    hscroll:SetScript("OnMouseDown", function(_, button)
        if view:PhaseMouseDown(button) then
            return -- Shift + drag moves a phase line; a right press on a moved one may reset it
        end
        view.zoomEnded = nil -- a mark no release took is stale by the next press
        if view:StartZoomSelect(button, "track") then
            return -- a left drag selects a range to zoom to (a left click without moving is still a click)
        end
        view:StartDrag(button)
        view:RightDown(button)
    end)
    hscroll:SetScript("OnMouseUp", function(_, button)
        if view:PhaseMouseUp(button) then
            return
        end
        if view:FinishZoomSelect(button) or view:ZoomEndedRelease(button) then
            view.clickAt = nil -- the release ended a selection, so it never counts toward a double-click
            return
        end
        view:RightUp(button) -- before StopDrag: a menu click puts back the few pixels it scrolled
        view:StopDrag()
        view:TrackClick(button)
    end)
    f:SetScript("OnUpdate", function()
        view:OnUpdate()
    end)
    f:SetScript("OnSizeChanged", function()
        view:SizeChanged()
    end)
    f:SetScript("OnHide", function()
        view:StopDrag()
        view:DropZoomSelect()
        view:CancelMove()
        view:CancelChipMove()
        view.rightAt = nil
        view:ClearSelection()
        view:CatchKeys(false)
    end)
    -- the keys (Escape, Ctrl+Z and Ctrl+Y): taken on show, and once combat ends when it showed during it
    f:SetScript("OnShow", function()
        view:CatchKeys(true)
    end)
    if f.RegisterEvent then
        f:RegisterEvent("PLAYER_REGEN_ENABLED")
        f:RegisterEvent("PLAYER_REGEN_DISABLED")
    end
    -- Combat starting lets go of the keyboard (allowed on this plain frame in combat), so a kept key's
    -- "don't pass on" can never hold the game's keys for the fight; it is taken back when combat ends.
    f:SetScript("OnEvent", function(_, event)
        if event == "PLAYER_REGEN_ENABLED" then
            view:CatchKeys(f:IsShown())
        elseif event == "PLAYER_REGEN_DISABLED" then
            view:CatchKeys(false)
        end
    end)
    -- the markers follow the notes and the reminders; only a shown view redraws
    -- a failing redraw must never break the note or reminder save that fired it
    local function changed()
        if f:IsVisible() then
            local ok, err = pcall(view.Refresh, view)
            if not ok and geterrorhandler then
                geterrorhandler()(err)
            end
        end
    end
    if CRT.Notes and CRT.Notes.OnChange then
        CRT.Notes:OnChange(changed)
    end
    if CRT.Alerts and CRT.Alerts.OnChange then
        CRT.Alerts:OnChange(changed)
    end
    -- a new theme: the parts made once repaint themselves (themed); a shown view draws the rest again
    if CRT.UI and CRT.UI.OnTheme then
        CRT.UI:OnTheme(function()
            changed()
            if f:IsVisible() then
                view:DrawStrip()
            end
        end)
    end
    -- the strip follows the saved alerts
    if CRT.AlertSaved and CRT.AlertSaved.OnChange then
        CRT.AlertSaved:OnChange(function()
            if f:IsVisible() then
                view:DrawStrip()
            end
        end)
    end
    return view
end

-- base is a recorded pull or { reference = ref }; overlay is a pull laid over a reference.
function Methods:SetData(base, encounterID, overlay, bossName, group)
    self.pull, self.encounterID, self.overlay, self.bossName, self.group = base, encounterID, overlay, bossName, group
    self.highlight = nil -- a lit row belongs to what was shown
    self:Refresh()
    self:ScrollTo(0)
end

-- Lights the row of a spell (by its ID, else by the row's name) in a foamy off-white and scrolls it
-- into the middle of the view, for "Show on the Timeline". Returns true when such a row is shown.
-- The light stays until other data is shown or ClearHighlight (the page calls it when the pop-out
-- closes); a second Highlight moves it to the new row.
local HIGHLIGHT = { 0.96, 0.94, 0.86 }
function Methods:Highlight(spellID, name)
    self.highlight = { spellID = spellID, name = type(name) == "string" and name:lower() or nil }
    self:Refresh()
    local row = self.highlightRow
    if not row then
        return false
    end
    local v = self.vscroll
    if v.UpdateScrollChildRect then
        v:UpdateScrollChildRect()
    end
    local range = v:GetVerticalScrollRange() or 0
    local top = (row - 1) * ROW_H - ((v:GetHeight() or 0) - ROW_H) / 2
    v:SetVerticalScroll(math.max(0, math.min(range, top)))
    return true
end

function Methods:ClearHighlight()
    if self.highlight then
        self.highlight = nil
        self:Refresh()
    end
end

-- The lit row's band over the labels and the track, or nothing.
function Methods:DrawHighlight(lanes)
    local want = self.highlight
    self.highlightRow = nil
    if want then
        for i, lane in ipairs(lanes) do
            local id = lane.spellID
            if (want.spellID and want.spellID ~= 0 and id == want.spellID)
                or (want.name and type(lane.label) == "string" and lane.label:lower() == want.name) then
                self.highlightRow = i
                break
            end
        end
    end
    if not self.highlightRow then
        if self.highlightTex then
            self.highlightTex:Hide()
        end
        return
    end
    if not self.highlightTex then
        self.highlightTex = self.body:CreateTexture(nil, "ARTWORK")
    end
    local tex, y = self.highlightTex, -(self.highlightRow - 1) * ROW_H
    tex:SetColorTexture(HIGHLIGHT[1], HIGHLIGHT[2], HIGHLIGHT[3], 0.22)
    tex:ClearAllPoints()
    tex:SetPoint("TOPLEFT", self.body, "TOPLEFT", 0, y)
    tex:SetPoint("BOTTOMRIGHT", self.body, "TOPRIGHT", 0, y - ROW_H)
    tex:Show()
end

-- The chosen order of the shown reference's parts (a list of part names), or nil for the order the
-- reference was written in. Takes effect on the next Refresh or SetData.
function Methods:SetOrder(order)
    self.order = order
end

-- The phases, length and end line of what is shown, from the last refresh.
function Methods:Extra()
    return self.extra
end

function Methods:SetSpan(seconds)
    settings().span = clampSpan(seconds)
    self:Refresh()
end

function Methods:CastCount()
    local n = 0
    for _, cast in ipairs((self.pull and self.pull.casts) or {}) do
        if type(cast.t) == "number" then -- the lanes skip casts without a time, so the count does too
            n = n + 1
        end
    end
    return n
end

-- The width of the track's window, in pixels.
function Methods:VisibleWidth()
    return math.max(1, self.axisScroll:GetWidth() or 1)
end

function Methods:ScrollTo(x)
    local most = math.max(0, self.trackW - self:VisibleWidth())
    x = math.max(0, math.min(most, x or 0))
    self.hscroll:SetHorizontalScroll(x)
    self.axisScroll:SetHorizontalScroll(x)
    self.syncing = true
    self.bar:SetMinMaxValues(0, most)
    self.bar:SetValue(x)
    self.syncing = false
end

-- Zooms in (delta above 0) or out by ZOOM, keeping the time under the cursor where it is.
function Methods:Zoom(delta)
    local width = self:VisibleWidth()
    local span = clampSpan(settings().span)
    local cx = cursorX(self.hscroll)
    local t = (self.hscroll:GetHorizontalScroll() + cx) * span / width
    self:SetSpan(delta > 0 and span / ZOOM or span * ZOOM)
    self:ScrollTo(t * width / clampSpan(settings().span) - cx)
end

-- The mouse wheel over the track (Abilities and Healer CDs alike): it scrolls the rows, or along the time
-- when every row fits; Shift + wheel moves along the time; Ctrl + wheel zooms around the cursor.
function Methods:Wheel(delta)
    if IsControlKeyDown and IsControlKeyDown() then
        return self:Zoom(delta)
    end
    local rows = self.vscroll and (self.vscroll:GetVerticalScrollRange() or 0) or 0
    if not (IsShiftKeyDown and IsShiftKeyDown()) and rows > 0 then
        return self:ScrollLanes(delta)
    end
    self:ScrollTo(self.hscroll:GetHorizontalScroll() - delta * self:VisibleWidth() / 8)
end

function Methods:ScrollLanes(delta)
    local v = self.vscroll
    local top = math.max(0, math.min(v:GetVerticalScrollRange() or 0, (v:GetVerticalScroll() or 0) - delta * ROW_H))
    if v.ScrollBar then
        v.ScrollBar:SetValue(top)
    else
        v:SetVerticalScroll(top)
    end
end

-- After the rows or the lanes' window change size (a taller window has less to scroll): the up and down
-- scroll stays inside its new range, through the scroll bar when there is one so its thumb follows.
function Methods:ClampLanes()
    local v = self.vscroll
    if v.UpdateScrollChildRect then
        v:UpdateScrollChildRect()
    end
    local range = math.max(0, v:GetVerticalScrollRange() or 0)
    if (v:GetVerticalScroll() or 0) <= range then
        return
    end
    if type(v.ScrollBar) == "table" and v.ScrollBar.SetValue then
        v.ScrollBar:SetValue(range)
    end
    v:SetVerticalScroll(range)
end

-- Holding the right mouse button and moving scrolls the timeline sideways. The left button is
-- left free for clicking on the timeline.
function Methods:StartDrag(button)
    if button ~= "RightButton" then
        return
    end
    self.dragX = GetCursorPosition() / self.hscroll:GetEffectiveScale()
    self.dragFrom = self.hscroll:GetHorizontalScroll()
end

function Methods:StopDrag()
    self.dragX = nil
end

function Methods:OnUpdate()
    if self.move then
        self:UpdateMove()
    end
    if self.chipMove then
        self:UpdateChipMove()
    end
    if self.dragX then
        if IsMouseButtonDown("RightButton") then
            local x = GetCursorPosition() / self.hscroll:GetEffectiveScale()
            self:ScrollTo(self.dragFrom - (x - self.dragX))
        else
            self.dragX = nil
        end
    end
    local over = self.pull and self.hscroll:IsMouseOver()
    if over then
        local cx = cursorX(self.hscroll)
        local x = self.hscroll:GetHorizontalScroll() + cx
        self.hover:SetText(View.Format(x * clampSpan(settings().span) / self:VisibleWidth()))
        self.cursorLine:ClearAllPoints()
        self.cursorLine:SetPoint("TOPLEFT", self.track, "TOPLEFT", x, 0)
        self.cursorLine:SetPoint("BOTTOMLEFT", self.track, "BOTTOMLEFT", x, 0)
        self.cursorLine:Show()
    elseif self.cursorLine:IsShown() then
        self.hover:SetText("")
        self.cursorLine:Hide()
    end
    if self.phaseDrag then
        self:UpdatePhaseDrag() -- after the hover time, so its own label wins while a line drags
    end
    if self.zoomSel then
        self:UpdateZoomSelect()
    end
    -- Healer CDs: the shadow of the cast a click on a cooldown row would place (Timeline/HealerView.lua)
    if self.mode == "healers" and CRT.TimelineHealerView then
        CRT.TimelineHealerView.Hover(self, over)
    end
end

-- Moving phase lines --------------------------------------------------------------------------------
-- With a reference shown, Shift + left-drag on a red phase line moves it, and a right-click on a moved
-- line puts it back where it was planned. While it drags, the shown reference's phase time changes and
-- the timeline redraws (casts follow their phase, and an earlier phase's casts past the line hide); on
-- release view.onPhaseMoved(index, seconds) saves it into the reference (Timeline/Page.lua).

local PHASE_GRAB = 4 -- pixels either side of a phase line that pick it up
local PHASE_GAP = 5 -- seconds a phase line keeps from its neighbours and from the pull

-- The time under the cursor on the track, in seconds.
function Methods:CursorSeconds()
    local x = self.hscroll:GetHorizontalScroll() + cursorX(self.hscroll)
    return x * clampSpan(settings().span) / self:VisibleWidth()
end

-- The index (into the shown reference's phases) of the phase line under the cursor, or nil.
function Methods:PhaseNear()
    local ref = self.pull and self.pull.reference
    if not (ref and ref.phases and self.trackW and self.trackW > 0) then
        return nil
    end
    local length = math.max(1, self.extra and self.extra.length or 0)
    local x = self.hscroll:GetHorizontalScroll() + cursorX(self.hscroll)
    for i, phase in ipairs(ref.phases) do
        if type(phase.t) == "number" and phase.t > 0
            and math.abs(View.TimeToX(phase.t, length, self.trackW) - x) <= PHASE_GRAB then
            return i
        end
    end
    return nil
end

-- A press on the track. True when it belongs to a phase line (and the track does nothing else with it).
function Methods:PhaseMouseDown(button)
    local i = self:PhaseNear()
    if not i then
        return false
    end
    local phase = self.pull.reference.phases[i]
    if button == "LeftButton" and IsShiftKeyDown() then
        -- the drag moves the line on a copy of the phases: parsed references are shared (Reference
        -- caches them by text) and must never change; the move is written into the text at the end
        local ref, copy = self.pull.reference, {}
        for k, v in pairs(ref) do
            copy[k] = v
        end
        copy.phases = {}
        for j, p in ipairs(ref.phases) do
            copy.phases[j] = { t = p.t, planned = p.planned, label = p.label }
        end
        self.pull = { reference = copy }
        self.phaseDrag = { index = i, from = phase.t }
        return true
    end
    if button == "RightButton" and phase.planned and phase.planned ~= phase.t then
        local x, y = GetCursorPosition()
        self.phaseReset = { index = i, x = x, y = y, at = GetTime() }
        return true
    end
    return false
end

-- A release on the track. True when it ended a phase drag or a reset click.
function Methods:PhaseMouseUp(button)
    if self.phaseDrag and button == "LeftButton" then
        self:FinishPhaseDrag()
        return true
    end
    local r = self.phaseReset
    if r and button == "RightButton" then
        self.phaseReset = nil
        local scale = self.hscroll:GetEffectiveScale()
        local x, y = GetCursorPosition()
        local phase = self.pull and self.pull.reference and self.pull.reference.phases[r.index]
        if phase and math.abs(x - r.x) / scale < MENU_DIST and math.abs(y - r.y) / scale < MENU_DIST
            and GetTime() - r.at <= MENU_TIME then
            if self.onPhaseMoved then
                self.onPhaseMoved(r.index, phase.planned)
            end
        end
        return true
    end
    return false
end

-- Moves the dragged line to the cursor, kept PHASE_GAP seconds from its neighbours and the pull.
function Methods:UpdatePhaseDrag()
    local drag = self.phaseDrag
    local ref = self.pull and self.pull.reference
    local phase = ref and ref.phases and ref.phases[drag.index]
    if not phase then
        self.phaseDrag = nil
        return
    end
    if not IsMouseButtonDown("LeftButton") then
        self:FinishPhaseDrag()
        return
    end
    local prev = ref.phases[drag.index - 1]
    local nextPhase = ref.phases[drag.index + 1]
    local low = (prev and prev.t or 0) + PHASE_GAP
    local high = nextPhase and (nextPhase.t - PHASE_GAP) or math.max(low, (self.extra and self.extra.length or 0) - PHASE_GAP)
    local t = math.floor(self:CursorSeconds() + 0.5)
    t = math.max(low, math.min(high, t))
    if t ~= phase.t then
        phase.t = t
        self:Refresh()
    end
    local masked = self.extra and self.extra.masked or 0
    self.hover:SetText(string.format("%s%s (planned %s)%s", phase.label and (phase.label .. ": ") or "", View.Format(t),
        View.Format(phase.planned or t), masked > 0 and string.format(", %d hidden", masked) or ""))
end

-- Lets go of the dragged line and saves where it ended.
function Methods:FinishPhaseDrag()
    local drag = self.phaseDrag
    self.phaseDrag = nil
    local ref = self.pull and self.pull.reference
    local phase = ref and ref.phases and ref.phases[drag.index]
    if phase and phase.t ~= drag.from and self.onPhaseMoved then
        self.onPhaseMoved(drag.index, phase.t)
    else
        self:Refresh()
    end
end

-- Zooming to a range ----------------------------------------------------------------------------------
-- A left drag along the time axis or on the track (a cast icon included) selects a
-- range: once the cursor has moved MOVE_DIST pixels a see-through band in the heading colour covers the
-- lanes from the press to the cursor, with its times on a tag on the axis, and the track scrolls along
-- when the cursor passes its edge. Letting go zooms so the range fills the track: the span becomes its
-- length (kept to MIN_SPAN..MAX_SPAN; a shorter range gets MIN_SPAN centred on it) and the range starts
-- at the left edge. A range under ZOOM_SEL.minPx pixels or ZOOM_SEL.minSec seconds is ignored, and Escape
-- cancels one. Fit, and a right-click on the axis, show the whole fight again. Each zoom here calls
-- view.onSpan(span) when a page has set it, for a control that shows the span. The band's parts are made
-- once and only moved while a selection runs.

-- The track's x under the cursor, kept on the track.
function Methods:TrackXAtCursor()
    local x = self.hscroll:GetHorizontalScroll() + cursorX(self.hscroll)
    return math.max(0, math.min(self.trackW or 1, x))
end

-- A left press on the axis or the track: remembers where. True when it starts a selection.
function Methods:StartZoomSelect(button, source)
    if button ~= "LeftButton" or not self.pull or self.zoomSel or self.phaseDrag or self.move or self.chipMove then
        return false
    end
    self.zoomSel = { x0 = GetCursorPosition() / self.hscroll:GetEffectiveScale(), from = self:TrackXAtCursor(), source = source }
    return true
end

-- Each frame while a selection's button is held: start it past MOVE_DIST, scroll at the edges, draw the band.
function Methods:UpdateZoomSelect()
    local sel = self.zoomSel
    if not IsMouseButtonDown("LeftButton") then
        self:FinishZoomSelect("LeftButton", true) -- let go before the release reached the view
        return
    end
    if sel.cancelled then
        return
    end
    if not sel.started then
        if math.abs(GetCursorPosition() / self.hscroll:GetEffectiveScale() - sel.x0) < MOVE_DIST then
            return
        end
        sel.started = true
    end
    local cx, shown = cursorX(self.hscroll), self:VisibleWidth()
    local past = cx < 0 and cx or (cx > shown and cx - shown or 0)
    if past ~= 0 then
        self:ScrollTo(self.hscroll:GetHorizontalScroll() + math.max(-ZOOM_SEL.edgeStep, math.min(ZOOM_SEL.edgeStep, past)))
    end
    sel.to = self:TrackXAtCursor()
    self:DrawZoomBand(sel.from, sel.to)
end

-- The band's parts, made the first time: the see-through fill and its two edges on the track, and the
-- tag with the range's times on the axis.
function Methods:ZoomBand()
    local band = self.zoomBand
    if band then
        return band
    end
    band = {}
    band.fill = self.track:CreateTexture(nil, "OVERLAY")
    themed(band.fill, "SetColorTexture", "heading", ZOOM_SEL.bandAlpha)
    band.left = self.track:CreateTexture(nil, "OVERLAY")
    themed(band.left, "SetColorTexture", "heading")
    band.right = self.track:CreateTexture(nil, "OVERLAY")
    themed(band.right, "SetColorTexture", "heading")
    local tag = CreateFrame("Frame", nil, self.axis)
    tag:SetFrameLevel((self.axis:GetFrameLevel() or 0) + 6)
    tag:SetHeight(14)
    tag.bg = tag:CreateTexture(nil, "BACKGROUND")
    tag.bg:SetAllPoints()
    themed(tag.bg, "SetColorTexture", "surface", 0.95)
    tag.text = tag:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    tag.text:SetPoint("CENTER")
    themed(tag.text, "SetTextColor", "heading")
    band.tag = tag
    self.zoomBand = band
    return band
end

-- A line on the track at x, as tall as the track.
function Methods:BandLine(tex, x, w)
    tex:ClearAllPoints()
    tex:SetPoint("TOPLEFT", self.track, "TOPLEFT", x, 0)
    tex:SetPoint("BOTTOMLEFT", self.track, "BOTTOMLEFT", x, 0)
    tex:SetWidth(w)
    tex:Show()
end

-- The band from track x a to b (either way round), and its times on the tag, kept inside the axis shown.
function Methods:DrawZoomBand(a, b)
    local band = self:ZoomBand()
    local left, right = math.min(a, b), math.max(a, b)
    self:BandLine(band.fill, left, math.max(1, right - left))
    self:BandLine(band.left, left, 1)
    self:BandLine(band.right, math.max(left, right - 1), 1)
    local length = math.max(1, self.drawLength or 1)
    local t1, t2 = View.XToTime(left, length, self.trackW), View.XToTime(right, length, self.trackW)
    local tag = band.tag
    tag.text:SetText(string.format(TEXT.zoomRange, View.Format(t1), View.Format(t2), View.Format(t2 - t1)))
    local w = (tag.text.GetStringWidth and tag.text:GetStringWidth() or 90) + 8
    tag:SetWidth(w)
    local from = self.hscroll:GetHorizontalScroll()
    local x = math.max(from + w / 2, math.min(from + self:VisibleWidth() - w / 2, (left + right) / 2))
    tag:ClearAllPoints()
    tag:SetPoint("BOTTOM", self.axis, "BOTTOMLEFT", x, 2)
    tag:Show()
end

function Methods:HideZoomBand()
    local band = self.zoomBand
    if band then
        band.fill:Hide()
        band.left:Hide()
        band.right:Hide()
        band.tag:Hide()
    end
end

-- Escape while a selection runs: the band goes; the button's release then does nothing.
function Methods:CancelZoomSelect()
    local sel = self.zoomSel
    if sel then
        sel.cancelled = true
        self:HideZoomBand()
    end
end

-- Forgets a selection at once (the view hid).
function Methods:DropZoomSelect()
    self.zoomSel = nil
    self:HideZoomBand()
end

-- The left button let go: zooms to the selected range. True when the release belonged to a selection
-- (started or cancelled); a press that never moved returns false, so the track takes it as a click.
-- Ended from OnUpdate (early) for a selection begun on the track, it leaves view.zoomEnded so the
-- track's own release, still to come, is taken as the selection's too (ZoomEndedRelease).
function Methods:FinishZoomSelect(button, early)
    local sel = self.zoomSel
    if button ~= "LeftButton" or not sel then
        return false
    end
    self:DropZoomSelect()
    local owned = sel.cancelled or (sel.started and sel.to ~= nil)
    if owned and early and sel.source == "track" then
        self.zoomEnded = true
    end
    if sel.cancelled then
        return true
    end
    if not owned then
        return false
    end
    local left, right = math.min(sel.from, sel.to), math.max(sel.from, sel.to)
    local length = math.max(1, self.drawLength or 1)
    local t1, t2 = View.XToTime(left, length, self.trackW), View.XToTime(right, length, self.trackW)
    if right - left >= ZOOM_SEL.minPx and t2 - t1 >= ZOOM_SEL.minSec then
        self:ZoomRange(t1, t2)
    end
    return true
end

-- The track's left release: true (and forgotten) when it belongs to a selection OnUpdate already ended.
function Methods:ZoomEndedRelease(button)
    if button ~= "LeftButton" or not self.zoomEnded then
        return false
    end
    self.zoomEnded = nil
    return true
end

-- Zooms so seconds t1 to t2 fill the track, from its left edge; a range under MIN_SPAN is centred.
function Methods:ZoomRange(t1, t2)
    local span = clampSpan(t2 - t1)
    local start = t1
    if t2 - t1 < span then
        start = (t1 + t2) / 2 - span / 2
    end
    self:SetSpan(span)
    span = clampSpan(settings().span)
    self:ScrollTo(math.max(0, start) * self:VisibleWidth() / span)
    if self.onSpan then
        self.onSpan(span)
    end
end

-- Zooms out to the whole fight (the pull's or the ability timeline's length, at most MAX_SPAN across)
-- and scrolls to its start.
function Methods:Fit()
    if not self.pull then
        return
    end
    self:SetSpan(math.max(1, self.extra and self.extra.length or 0))
    self:ScrollTo(0)
    if self.onSpan then
        self.onSpan(clampSpan(settings().span))
    end
end

-- The axis: a left press may start a selection; a right press is remembered so its release can tell a
-- click (Fit) from a drag.
function Methods:AxisMouseDown(button)
    if button == "LeftButton" then
        self:StartZoomSelect(button, "axis")
    elseif button == "RightButton" then
        local x, y = GetCursorPosition()
        self.axisRight = { x = x, y = y, at = GetTime() }
    end
end

function Methods:AxisMouseUp(button)
    if button == "LeftButton" then
        self:FinishZoomSelect(button)
        return
    end
    local r = self.axisRight
    self.axisRight = nil
    if button ~= "RightButton" or not r then
        return
    end
    local scale = self.hscroll:GetEffectiveScale()
    local x, y = GetCursorPosition()
    if math.abs(x - r.x) / scale < MENU_DIST and math.abs(y - r.y) / scale < MENU_DIST and GetTime() - r.at <= MENU_TIME then
        self:Fit()
    end
end

-- One icon button from the pool, set up for a mark on a lane.
function Methods:Icon(n)
    return pooled(self.icons, n, function()
        local b = CreateFrame("Button", nil, self.track)
        b.view = self -- for its tooltip's boss and difficulty
        b:EnableMouse(true)
        b.bg = b:CreateTexture(nil, "BACKGROUND")
        b.bg:SetAllPoints()
        b.tex = b:CreateTexture(nil, "ARTWORK")
        b.tex:SetPoint("TOPLEFT", 1, -1)
        b.tex:SetPoint("BOTTOMRIGHT", -1, 1)
        View.MakeDeathParts(b) -- a death's round look, in place of bg and tex
        -- how many deaths share the icon (View.StackDeaths), at its bottom right; empty for one
        b.count = b:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        b.count:SetPoint("BOTTOMRIGHT", 1, -1)
        b.count:SetShadowColor(0, 0, 0, 1)
        b.count:SetShadowOffset(1, -1)
        b:SetScript("OnEnter", iconEnter)
        b:SetScript("OnLeave", hideTip)
        b:SetScript("OnMouseDown", function(_, button)
            self.clickAt = nil -- a click here is the icon's, so it never pairs with one on the track
            if self:StartZoomSelect(button, "icon") then
                return -- a left drag selects a range to zoom to, as on the track
            end
            self:StartDrag(button)
            self:RightDown(button)
        end)
        b:SetScript("OnMouseUp", function(_, button)
            if self:FinishZoomSelect(button) then
                return
            end
            self:RightUp(button)
            self:StopDrag()
        end)
        b:SetScript("OnDoubleClick", function()
            self:IconDoubleClick(b)
        end)
        return b
    end)
end

-- The boss's encounter ID as a number: a boss shown under a reference's name uses the reference's
-- Encounter line, or the boss the Journal finds by that name. Nil when neither is known.
function Methods:EncounterNumber()
    local encounterID = self.encounterID
    if type(encounterID) ~= "number" and CRT.TimelineJournal and CRT.TimelineJournal.ResolveID then
        encounterID = CRT.TimelineJournal:ResolveID(encounterID, self.pull and self.pull.reference)
    end
    return type(encounterID) == "number" and encounterID or nil
end

-- Opens the editor on a new alert t seconds from the pull, as phase + seconds through the shown
-- reference's phase lines (on a recorded pull, phase 1 from the pull), saved as your own by default.
-- Reminders are keyed by encounter ID, so a boss with none asks to be pulled once first.
-- The raid's chosen order on this boss (Timeline:OrderShift): shift moves a part's line to where its
-- part now is, unshift is the reverse (once the Timeline offers it). Both nil when nothing moves.
function Methods:OrderShifts()
    local encounterID = self:EncounterNumber()
    local Timeline = CRT.Timeline
    if not (encounterID and Timeline and Timeline.OrderShift) then
        return nil
    end
    local ok, shift, unshift = pcall(Timeline.OrderShift, Timeline, encounterID, self.group)
    if not ok then
        return nil
    end
    return type(shift) == "function" and shift or nil, type(unshift) == "function" and unshift or nil
end

-- Where a reminder's times are read on this view (Reminders:Times): the ability timeline shown, unless the
-- reminder is for another difficulty group than the shown one's, or an older one's Difficulty text isn't
-- the shown one's, and the view's difficulty group. Every read and write of a reminder's times here goes
-- through it, so a flag sits on the cast drawn under it.
function Methods:ReminderSource(r)
    local ref = self.pull and self.pull.reference
    local Reminders, Reference = CRT.AlertReminders, CRT.TimelineReference
    local group = r and Reminders and Reminders.GroupOf and Reminders.GroupOf(r)
    if ref and group and Reference and Reference.Group and Reference.Group(ref) ~= group then
        ref = nil
    end
    if ref and r and r.difficulty then
        local mine, shown = tostring(r.difficulty):lower(), tostring(ref.difficulty or ""):lower()
        if mine ~= shown then
            ref = nil
        end
    end
    return ref, self.group
end

-- Whether a note or reminder of difficulty d (a Difficulty line's text, nil for any) shows on this view,
-- as the alerts' difficulty check runs it in a pull: any difficulty does, and one of its own only on a
-- view of its difficulty group (a view with no group shows everything).
function Methods:ShowsDifficulty(d)
    if not (self.group and type(d) == "string" and d ~= "") then
        return true
    end
    return CRT.Timeline:GroupFor(d) == self.group
end

-- Whether a reminder of yours shows on this view: one for the view's difficulty group (Reminders.GroupOf,
-- as the alerts' check runs it in a pull), or an older one on any difficulty; a view with no group shows
-- everything.
function Methods:ShowsReminder(r)
    local Reminders = CRT.AlertReminders
    local group = Reminders and Reminders.GroupOf and Reminders.GroupOf(r)
    return not (self.group and group) or group == self.group
end

function Methods:ReminderTimes(encounterID, r)
    local ref, group = self:ReminderSource(r)
    return CRT.AlertReminders:Times(encounterID, r, ref, group)
end

-- A time on screen as the note or reminder stores it: the chosen order moves a part's lines, so a time
-- picked on a moved cast is put back where the written order has it.
function Methods:WrittenTime(spellID, text, t)
    local _, unshift = self:OrderShifts()
    if not unshift then
        return t
    end
    local ok, w = pcall(unshift, spellID, text, t)
    return ok and type(w) == "number" and w or t
end

-- Opens the editor on a new alert at t, your own (Only me); given tag (a player's name, or "" for no
-- one) a Raid note with For set to it.
function Methods:OpenAt(t, spellID, text, tag)
    self:ClearSelection() -- the editor opens: Escape is its to close, not the selection's
    local encounterID = self:EncounterNumber()
    if not encounterID then
        CRT:Print(TEXT.needPull)
        return
    end
    t = self:WrittenTime(spellID, text, t)
    local ph, seconds = CRT.AlertReminders.PhaseAt(self.pull and self.pull.reference, tenth(t))
    CRT.AlertEditor:Open(encounterID, nil, {
        spellID = spellID,
        text = text or (spellID and CRT.AlertReminders.SpellName(spellID)) or nil,
        ph = ph,
        time = tenth(seconds),
        boss = self.bossName,
        saveAs = tag ~= nil and "note" or "mine",
        tag = tag,
        group = self.group, -- your own alert starts on the view's difficulty group
    })
end

-- Whether an icon's mark is a boss cast (not a death) with a time.
local function castIcon(lane, mark)
    if not (lane and mark and type(mark.t) == "number") or mark.death then
        return false
    end
    lane = mark.source or lane -- a Healer CDs Raid damage icon: its own ability row
    return lane.kind == "reference" or lane.kind == "spell" or lane.kind == "unnamed"
end

-- A cast icon's spell: the lane's, else the cast's own (an unnamed lane holds casts the Journal doesn't
-- list). Nil when neither is known.
local function castSpell(lane, mark)
    local readable = CRT.Timeline.readable
    lane = mark.source or lane
    if readable(lane.spellID) and type(lane.spellID) == "number" and lane.spellID > 0 then
        return lane.spellID
    end
    if readable(mark.spellID) and type(mark.spellID) == "number" and mark.spellID > 0 then
        return mark.spellID
    end
    return nil
end

-- Double-click on a cast icon opens the editor for that boss with the spell and the time filled in.
-- Deaths and the overlaid pull's ticks do nothing.
function Methods:IconDoubleClick(b)
    -- the click's mouse-down started a drag; undo it so the view stays where it was
    if self.dragX then
        self:ScrollTo(self.dragFrom)
        self:StopDrag()
    end
    local lane, mark = b.lane, b.mark
    if not castIcon(lane, mark) then
        return
    end
    local spellID = castSpell(lane, mark)
    local text = spellID and CRT.AlertReminders.SpellName(spellID) or nil
    -- a reference row with no spell (or an unreadable name) is named after the row
    if not text and lane.kind == "reference" and type(lane.label) == "string" and lane.label ~= "" then
        text = lane.label
    end
    self:OpenAt(mark.t, spellID, text)
end

-- A left click on the track itself (icons and markers take their own clicks). The second of two
-- within DOUBLE_TIME seconds and DOUBLE_DIST pixels is a double-click; a single click does nothing, except
-- on an empty spot of a Healer CDs cooldown row, where it places that row's cooldown (HealerView.Click) and
-- its double-click's second click does nothing more.
-- A drag that scrolled the track since the first click (the mouse-up ending it comes here too) means
-- the next click starts over, so a drag and a quick click never open the editor.
function Methods:TrackClick(button)
    local scroll = self.hscroll:GetHorizontalScroll()
    if self.clickAt and scroll ~= self.clickScroll then
        self.clickAt = nil
    end
    if button ~= "LeftButton" or not self.pull then
        return
    end
    self:ClearSelection() -- a left click on empty track
    local scale = self.hscroll:GetEffectiveScale()
    local x, y = GetCursorPosition()
    x, y = x / scale, y / scale
    local now = GetTime()
    if self.clickAt and now - self.clickAt <= DOUBLE_TIME
        and math.abs(x - self.clickX) <= DOUBLE_DIST and math.abs(y - self.clickY) <= DOUBLE_DIST then
        self.clickAt = nil
        if not self.clickPlaced then
            self:TrackDoubleClick()
        end
    else
        self.clickAt, self.clickX, self.clickY, self.clickScroll = now, x, y, scroll
        local HealerView = self.mode == "healers" and CRT.TimelineHealerView
        self.clickPlaced = HealerView and HealerView.Click(self) or false
    end
end

-- Drops a new alert at the cursor: the time only, on every row. Only a double-click on a boss spell
-- icon (IconDoubleClick) fills in that spell.
function Methods:TrackDoubleClick()
    local length = math.max(1, self.extra.length or 0)
    local x = self.hscroll:GetHorizontalScroll() + cursorX(self.hscroll)
    local t = math.max(0, math.min(length, View.XToTime(x, length, self.trackW)))
    -- Healer CDs: a cooldown row places that cooldown for its player (Timeline/HealerView.lua)
    local HealerView = self.mode == "healers" and CRT.TimelineHealerView
    if HealerView then
        local _, y = self:CursorOnTrack()
        if HealerView.DoubleClick(self, tenth(t), self:LaneAtY(y)) then
            return
        end
    end
    self:OpenAt(t)
end

-- The layout drawn: nil for the ability rows, "healers" for Healer CDs (Timeline/HealerView.lua). The page
-- sets it for the pop-out only. later: the caller redraws the view next, so this doesn't.
function Methods:SetMode(mode, later)
    mode = mode == "healers" and "healers" or nil
    if mode ~= self.mode then
        self.mode = mode
        self.selected = nil -- a flag of the other layout; DrawSelection drops it on the next draw
        if mode and CRT.TimelineHealerView then
            CRT.TimelineHealerView.Watch(self) -- redrawn when the roster or a role changes
        end
        if not later then
            self:Refresh()
        end
    end
end

function Methods:Mode()
    return self.mode
end

-- Markers -------------------------------------------------------------------------------------------

local function lowerTrim(s)
    return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", "")):lower()
end

-- The lane of an ability row for a marker: by spell, else by the row's name; nil for none.
local function rowFor(lanes, spellID, text)
    local want = type(spellID) == "number" and spellID > 0 and spellID or nil
    local name = type(text) == "string" and lowerTrim(text) or ""
    for i, lane in ipairs(lanes) do
        if (lane.kind == "reference" or lane.kind == "spell") and want and lane.spellID == want then
            return i
        end
    end
    if name ~= "" then
        for i, lane in ipairs(lanes) do
            if (lane.kind == "reference" or lane.kind == "spell") and lowerTrim(lane.label) == name then
                return i
            end
        end
    end
    return nil
end

-- The boss's saved alerts that have a time on what is shown: every timed line of its raid notes (each
-- difficulty's note) and every time of your reminders, except those at or after a later phase's line
-- (Reminders.PhaseCut, the phase mask). On a recorded pull only phase 1 can be placed.
-- Each gets the lane it goes on: a note line its spell's row, else a Notes lane added at the bottom of
-- lanes; your reminders only the Personal notes lane, added last whenever a boss is shown (with or
-- without reminders). Returns { { t, ph, time, row, text, tags, kind, encounterID, ... } }: a
-- reminder's mark (kind "mine") also holds id and index (which of its times), a note line's (kind
-- "note") noteID, line, difficulty and expected (the raw line as drawn).
function Methods:Marks(lanes, length)
    local out = self:NoteAndReminderMarks(lanes, length)
    if self.pull then
        lanes[#lanes + 1] = { key = "personal", label = TEXT.personal, icon = PERSONAL_ICON, kind = "personal", marks = {} }
        for _, m in ipairs(out) do
            if m.kind == "mine" then
                m.row = #lanes
            end
        end
    end
    return out
end

function Methods:NoteAndReminderMarks(lanes, length)
    local out = {}
    local Reminders = CRT.AlertReminders
    local encounterID = self.pull and Reminders and self:EncounterNumber()
    if not encounterID then
        return out
    end
    local ref = self.pull.reference
    local shift = self:OrderShifts()
    local function add(m, spellID, text, iconID)
        m.spellID, m.iconID = spellID, iconID
        m.t = Reminders.AbsoluteTime(ref, m.ph, m.time)
        -- the raid's chosen order: a phase 1 line for one part's spell sits where that part now is
        -- (shiftDelta, so a drag puts it back in the written order); past its new window it is hidden
        if shift and m.ph == 1 and m.t then
            local ok, t2 = pcall(shift, spellID, text, m.t)
            if ok and t2 == false then
                return
            elseif ok and type(t2) == "number" then
                m.shiftDelta = t2 - m.t
                m.t = t2
            end
        end
        if not (m.t and m.t >= 0 and m.t <= length) then
            return
        end
        -- the phase mask: hidden once a later phase line comes first (kept in the note or reminder)
        local cut = Reminders.PhaseCut(ref, m.ph)
        if cut and m.t >= cut then
            return
        end
        m.text = (type(text) == "string" and text ~= "" and text) or Reminders.SpellName(spellID)
            or (type(spellID) == "number" and string.format(TEXT.spell, spellID)) or TEXT.reminder
        -- a reminder's row is the Personal notes lane, set once it is added
        m.row = m.kind == "note" and rowFor(lanes, spellID, text) or nil
        out[#out + 1] = m
    end
    -- the notes that run: for each difficulty, the shared note in use (one of the guilds' notes), and
    -- your personal notes, which always run beside it
    local Notes = CRT.Notes
    local runs = {}
    if Notes and Notes.List then
        for _, n in ipairs(Notes:List()) do
            local r = n.record
            if r.encounterID == encounterID then
                runs[n.id] = r.personal or Notes:FindForEncounter(encounterID, r.difficulty) == n.id
            end
        end
    end
    if Notes and Notes.List then
        for _, n in ipairs(Notes:List()) do
            if n.record.encounterID == encounterID and runs[n.id] and self:ShowsDifficulty(n.record.difficulty) then
                local note = Notes:Parsed(n.id)
                local rawLines = Notes:RawLines(n.id) -- the lines as drawn, so a move can tell one has changed
                for _, timer in ipairs(note and note.timers or {}) do
                    local raw = rawLines[timer.line]
                    add({ ph = timer.ph, time = timer.time, tags = timer.tags, noteID = n.id, line = timer.line,
                        difficulty = n.record.difficulty, kind = "note", expected = raw, encounterID = encounterID },
                        timer.spellId, timer.text, timer.iconID)
                end
            end
        end
    end
    for _, e in ipairs(Reminders:List(encounterID)) do
        -- a reminder turned off (its tick on Mech Alerts) doesn't fire, so it isn't drawn either
        -- nor one of another difficulty group than the view's, nor one saved as Raid note (its note lines are drawn)
        if e.r.enabled ~= false and not (Reminders.InNote and Reminders.InNote(e.r)) and self:ShowsReminder(e.r) then
            for index, at in ipairs((self:ReminderTimes(encounterID, e.r))) do
                add({ ph = at.ph, time = at.t, mine = true, encounterID = encounterID, id = e.id, index = index,
                    kind = "mine" }, e.r.spellID, e.r.text, e.r.iconID)
            end
        end
    end
    local notesRow
    for _, m in ipairs(out) do
        if m.kind == "note" and not m.row then
            if not notesRow then
                lanes[#lanes + 1] = { key = "notes", label = TEXT.notes, icon = NOTES_ICON, kind = "notes", marks = {} }
                notesRow = #lanes
            end
            m.row = notesRow
        end
    end
    return out
end

-- One marker from the pool: a pole with a flag at its top. Only a square around the flag is the
-- button; the pole below it is a plain texture, so the lower part of the row still reaches an icon.
function Methods:Flag(n)
    return pooled(self.flags, n, function()
        local f = CreateFrame("Button", nil, self.track)
        f:SetSize(FLAG_BTN_W, FLAG_BTN_W)
        f:EnableMouse(true)
        local inset = (FLAG_BTN_W - FLAG_W) / 2
        f.pole = f:CreateTexture(nil, "ARTWORK")
        f.pole:SetPoint("TOPLEFT", f, "TOPLEFT", inset, -3)
        f.pole:SetSize(2, ROW_H - 6)
        f.head = f:CreateTexture(nil, "ARTWORK")
        f.head:SetPoint("TOPLEFT", f, "TOPLEFT", inset, -3)
        f.head:SetSize(FLAG_W, FLAG_HEAD)
        -- An alert with a spell (or an icon) shows that icon in place of the flag, in an edge of the
        -- flag's color (raid note or your reminder). The pole stays below it, marking the time.
        f.edge = f:CreateTexture(nil, "ARTWORK", nil, 1)
        f.edge:SetAllPoints(f)
        f.icon = f:CreateTexture(nil, "ARTWORK", nil, 2)
        f.icon:SetPoint("TOPLEFT", f, "TOPLEFT", 1, -1)
        f.icon:SetSize(FLAG_BTN_W - 2, FLAG_BTN_W - 2)
        f.icon:SetTexCoord(0.08, 0.92, 0.08, 0.92)
        f.edge:Hide()
        f.icon:Hide()
        -- the outline of the selected flag: four thin sides around the button, shown by DrawSelection
        f.sel = {}
        for i, side in ipairs({ { "TOPLEFT", "TOPRIGHT" }, { "BOTTOMLEFT", "BOTTOMRIGHT" }, { "TOPLEFT", "BOTTOMLEFT" },
            { "TOPRIGHT", "BOTTOMRIGHT" } }) do
            local tex = f:CreateTexture(nil, "OVERLAY")
            tex:SetColorTexture(SELECT_COLOR[1], SELECT_COLOR[2], SELECT_COLOR[3], 1)
            tex:SetPoint(side[1], f, side[1])
            tex:SetPoint(side[2], f, side[2])
            if i <= 2 then
                tex:SetHeight(SELECT_W)
            else
                tex:SetWidth(SELECT_W)
            end
            tex:Hide()
            f.sel[i] = tex
        end
        -- inside it a thin dark border, so the outline shows on a text-coloured flag as well as an accent one
        f.selIn = {}
        local w = SELECT_W
        for i, side in ipairs({ { "TOPLEFT", "TOPRIGHT", 0, -w }, { "BOTTOMLEFT", "BOTTOMRIGHT", 0, w },
            { "TOPLEFT", "BOTTOMLEFT", w, 0 }, { "TOPRIGHT", "BOTTOMRIGHT", -w, 0 } }) do
            local tex = f:CreateTexture(nil, "OVERLAY", nil, -1)
            tex:SetColorTexture(SELECT_INNER[1], SELECT_INNER[2], SELECT_INNER[3], 1)
            tex:SetPoint(side[1], f, side[1], side[3], side[4])
            tex:SetPoint(side[2], f, side[2], side[3], side[4])
            if i <= 2 then
                tex:SetHeight(SELECT_INNER_W)
            else
                tex:SetWidth(SELECT_INNER_W)
            end
            tex:Hide()
            f.selIn[i] = tex
        end
        f:SetHighlightTexture("Interface\\Buttons\\WHITE8X8", "ADD")
        f:GetHighlightTexture():SetVertexColor(1, 1, 1, 0.15)
        f:SetScript("OnEnter", function(btn)
            self:FlagHighlight(btn)
            flagEnter(btn)
        end)
        f:SetScript("OnLeave", hideTip)
        f:SetScript("OnMouseDown", function(_, button)
            self.clickAt = nil
            if button == "LeftButton" then
                -- any flag, changeable or not, can be selected: remember the press to tell a click
                self.flagPress = { mark = f.mark, x0 = GetCursorPosition() / self.hscroll:GetEffectiveScale() }
                self:StartMove(f)
            else
                self:StartDrag(button)
                self:RightDown(button)
            end
        end)
        f:SetScript("OnMouseUp", function(_, button)
            if button == "LeftButton" then
                -- a press and release under MOVE_DIST pixels, not ending a double-click, selects the flag
                local press = self.flagPress
                self.flagPress = nil
                local x = GetCursorPosition() / self.hscroll:GetEffectiveScale()
                local click = press and math.abs(x - press.x0) < MOVE_DIST
                self:FinishMove()
                if click then
                    self:Select(press.mark)
                end
            else
                self:RightUp(button, f)
                self:StopDrag()
            end
        end)
        f:SetScript("OnDoubleClick", function()
            self.flagPress = nil
            self:FlagDoubleClick(f)
        end)
        return f
    end)
end

-- Opens a marker's note line or reminder in the editor.
function Methods:FlagDoubleClick(f)
    self:ClearSelection() -- the editor opens: Escape is its to close, not the selection's
    self:CancelMove()
    if self.dragX then
        self:ScrollTo(self.dragFrom)
        self:StopDrag()
    end
    self:EditMark(f.mark)
end

function Methods:EditMark(m)
    if not m then
        return
    end
    if m.noteID then
        CRT.AlertEditor:OpenNote(m.noteID, m.line)
    else
        CRT.AlertEditor:Open(m.encounterID, m.id)
    end
end

-- Moving a flag ------------------------------------------------------------------------------------

-- Whether you may change the raid note right now (CRT.Notes:CanEditRaid: the raid leader or an
-- assistant), and the reason when not. Asked at each action, never kept, so a promotion counts at once.
local function canEditRaid()
    local Notes = CRT.Notes
    if not (Notes and Notes.CanEditRaid) then
        return false
    end
    return Notes:CanEditRaid()
end

-- Whether a marker can be moved, Alt+dragged or deleted by you: your reminders always, a raid note
-- line only when you may change the raid note, or (only moved, for you) your own cast on Healer CDs.
local function canChange(m)
    return m ~= nil and (m.kind ~= "note" or m.hvOwn or (canEditRaid()))
end

-- No hover highlight on a flag you can't change (a raid note line, for anyone else); its tooltip
-- stays. Set at each draw and each hover, so a promotion counts without a redraw.
function Methods:FlagHighlight(f)
    local hl = f.GetHighlightTexture and f:GetHighlightTexture()
    if hl then
        hl:SetAlpha(canChange(f.mark) and 1 or 0)
    end
end

-- m:ss, with tenths when there are some.
local function clock(t)
    t = tenth(t)
    local m = math.floor(t / 60)
    if t == math.floor(t) then
        return string.format("%d:%02d", m, t % 60)
    end
    return string.format("%d:%04.1f", m, t - m * 60)
end

-- The cursor's screen x in the track's scale.
local function cursorScreenX(self)
    return GetCursorPosition() / self.hscroll:GetEffectiveScale()
end

-- A ghost of the flag that follows the cursor while it is dragged, with a label saying what releasing does.
function Methods:Ghost()
    local g = self.ghost
    if not g then
        g = CreateFrame("Frame", nil, self.track)
        g:SetSize(FLAG_BTN_W, FLAG_BTN_W)
        local inset = (FLAG_BTN_W - FLAG_W) / 2
        g.pole = g:CreateTexture(nil, "ARTWORK")
        g.pole:SetPoint("TOPLEFT", g, "TOPLEFT", inset, -3)
        g.pole:SetSize(2, ROW_H - 6)
        g.head = g:CreateTexture(nil, "ARTWORK")
        g.head:SetPoint("TOPLEFT", g, "TOPLEFT", inset, -3)
        g.head:SetSize(FLAG_W, FLAG_HEAD)
        g.labelBg = g:CreateTexture(nil, "BACKGROUND")
        themed(g.labelBg, "SetColorTexture", "surface", 0.85)
        g.label = g:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        g.labelBg:SetPoint("TOPLEFT", g.label, "TOPLEFT", -3, 2)
        g.labelBg:SetPoint("BOTTOMRIGHT", g.label, "BOTTOMRIGHT", 3, -2)
        g:Hide()
        self.ghost = g
    end
    return g
end

-- A left button pressed on a flag: remember where, so the release can tell a click from a drag. A raid
-- note line you may not change starts nothing (no ghost, no write); its double-click still opens it.
function Methods:StartMove(f)
    if f.mark and canChange(f.mark) then
        -- a copy of the mark: a redraw during the drag can hand this flag to another alert
        local m = {}
        for k, v in pairs(f.mark) do
            m[k] = v
        end
        self.move = { f = f, m = m, x0 = cursorScreenX(self), scroll0 = self.hscroll:GetHorizontalScroll(),
            others = self:OtherCasts(m) }
    end
end

-- The time the dragged flag would land on: where it was plus how far the cursor has moved along the
-- track, to a tenth and within the view.
function Methods:MoveTarget(mv)
    local length = math.max(1, self.extra.length or 0)
    local dx = (cursorScreenX(self) + self.hscroll:GetHorizontalScroll()) - (mv.x0 + mv.scroll0)
    local t = mv.m.t + dx * length / math.max(1, self.trackW)
    return tenth(math.max(0, math.min(length, t)))
end

function Methods:CancelMove()
    local had = self.move ~= nil
    self.move = nil
    if self.ghost then
        self.ghost:Hide()
    end
    if had then
        self:DrawSelection() -- the drag's bands go; the selected flag's come back
    end
end

-- While a flag is held: once moved MOVE_DIST pixels the ghost and its label follow the cursor. Alt is
-- read live here, as the release reads it.
function Methods:UpdateMove()
    local mv = self.move
    if not mv then
        self:CancelMove()
        return
    end
    if not IsMouseButtonDown("LeftButton") then
        self:FinishMove() -- the release went elsewhere
        return
    end
    if not mv.moved and math.abs(cursorScreenX(self) - mv.x0) < MOVE_DIST then
        return
    end
    mv.moved = true
    local m = mv.m
    local t = self:MoveTarget(mv)
    local g = self:Ghost()
    -- a Healer CDs cooldown cast's ghost is a square where its icon would sit (DrawMarks), a flag's a flag
    local HealerView = m.hvLane ~= nil and CRT.TimelineHealerView
    local gw = HealerView and HealerView.CastW() or FLAG_BTN_W
    local xt = View.TimeToX(t, math.max(1, self.extra.length or 0), self.trackW)
    local x = HealerView and (xt - gw / 2) or (xt - 1 - (FLAG_BTN_W - FLAG_W) / 2)
    local key = m.mine and "text" or "accent"
    g.head:SetColorTexture(rgba(key, 0.6))
    g.pole:SetColorTexture(rgba(key, 0.6))
    g:SetSize(gw, gw)
    g.pole:SetShown(not HealerView)
    g.head:ClearAllPoints()
    if HealerView then
        g.head:SetAllPoints(g)
    else
        g.head:SetPoint("TOPLEFT", g, "TOPLEFT", (FLAG_BTN_W - FLAG_W) / 2, -3)
        g.head:SetSize(FLAG_W, FLAG_HEAD)
    end
    g:ClearAllPoints()
    g:SetPoint("TOPLEFT", self.track, "TOPLEFT", x, -(m.row - 1) * ROW_H - (HealerView and (ROW_H - gw) / 2 or 0))
    g:SetFrameLevel((mv.f:GetFrameLevel() or 0) + 1)
    -- the cooldown bands at the ghost, on its row; Alt keeps the grabbed time, so it counts as another cast
    local alt = IsAltKeyDown()
    local soon = self:DrawBands(self:BandSpec(m, t, m.row, mv.others, alt and m.t or nil))
    -- Healer CDs' own bands of the grabbed cast go while it moves (Alt leaves it where it is)
    self:OwnBands(not alt and View.BandKey(m) or nil)
    g.label:SetText(string.format(alt and TEXT.addTime or TEXT.moveTo, clock(t)) .. (soon and TEXT.tooSoon or ""))
    -- the label stays inside the visible part of the track: above the flag (beside it on row 1,
    -- where nothing is above), slid sideways as far as it needs
    local w = g.label:GetStringWidth() or 0
    local left = self.hscroll:GetHorizontalScroll()
    local right = left + self:VisibleWidth()
    local lx, ly = x + gw / 2 - w / 2, -(m.row - 1) * ROW_H + 4
    local anchor = "BOTTOMLEFT"
    if m.row == 1 then
        lx, ly, anchor = x + gw, -FLAG_HEAD, "BOTTOMLEFT"
        if lx + w > right - 3 then
            lx = x - w - 4
        end
    end
    lx = math.max(left + 3, math.min(lx, right - w - 3))
    g.label:ClearAllPoints()
    g.label:SetPoint(anchor, self.track, "TOPLEFT", lx, ly)
    g:Show()
end

-- Moves a note line to phase ph, t seconds in, or (add) writes the same line again there, in the same
-- note. Fields the parser doesn't know stay on the line. False when the line is no longer the one drawn.
local function writeNote(m, ph, t, add)
    return CRT.Notes:MoveLine(m.noteID, m.line, ph, t, m.expected, add)
end

-- Whether the cursor is over the track's window: inside the track and inside the shown part of the lanes
-- (the track runs on under the window when the lanes scroll up and down, behind the strip).
local function overTrack(self)
    local scale = self.hscroll:GetEffectiveScale()
    local x, y = GetCursorPosition()
    x, y = x / scale, y / scale
    local left, top = self.hscroll:GetLeft() or 0, self.hscroll:GetTop() or 0
    local vtop = self.vscroll:GetTop() or top
    return x >= left and x <= left + self.hscroll:GetWidth() and y <= top and y >= top - self.hscroll:GetHeight()
        and y <= vtop and y >= vtop - (self.vscroll:GetHeight() or 0)
end

-- Whether the cursor is over the open alert editor, which sits above the track: a drag let go there was
-- aimed at the editor, not the track.
local function overEditor()
    local E = CRT.AlertEditor
    local f = E and E.Frame and E:Frame()
    return f ~= nil and f:IsShown() and MouseIsOver ~= nil and MouseIsOver(f) and true or false
end

-- The left button let go of a flag. Under MOVE_DIST pixels it was a click. Otherwise Alt at this moment
-- decides: held adds a time, else the alert moves. A release off the track, or over the open alert
-- editor, cancels the drag. A refused write (the alert is no longer what was grabbed) says so and leaves
-- the flag be.
function Methods:FinishMove()
    local mv = self.move
    self:CancelMove()
    if not mv or math.abs(cursorScreenX(self) - mv.x0) < MOVE_DIST or not overTrack(self) or overEditor() then
        return
    end
    local m = mv.m
    local t = self:MoveTarget(mv)
    local add = IsAltKeyDown() and true or false
    if t == m.t then
        return
    end
    local shown, selected = t, self:IsSelected(m)
    t = t - (m.shiftDelta or 0) -- back to the written order
    local Reminders = CRT.AlertReminders
    local ph, seconds = Reminders.PhaseAt(self.pull and self.pull.reference, t)
    seconds = tenth(seconds)
    local ok
    if m.kind == "mine" then
        -- still the time that was grabbed?
        local r = Reminders:Get(m.encounterID, m.id)
        local cur = r and self:ReminderTimes(m.encounterID, r)[m.index]
        if not (cur and cur.ph == m.ph and cur.t == m.time) then
            CRT:Print(TEXT.moveRefused)
            return
        end
        local ref, group = self:ReminderSource(r)
        if add then
            ok = Reminders:AddTime(m.encounterID, m.id, ph, seconds, ref, group)
        else
            ok = Reminders:SetTime(m.encounterID, m.id, m.index, ph, seconds, ref, group)
        end
    elseif m.kind == "note" then
        -- asked again at the release: you may have lost the right since the grab
        local allowed, why = canEditRaid()
        -- Alt adds a raid note line, which only a lead may do: refused below with the reason
        if not allowed and m.hvOwn and not add and CRT.TimelineHealerView then
            ok = CRT.TimelineHealerView.MovePersonal(self, m, ph, seconds) -- your own time, the raid note untouched
        elseif not allowed then
            CRT:Print(why or TEXT.moveRefused)
            return
        else
            ok = writeNote(m, ph, seconds, add)
        end
    end
    if not ok then
        CRT:Print(TEXT.moveRefused)
    elseif selected and m.kind == "mine" then
        -- the selection follows the moved or added time: its index may change, so it is found by its time.
        -- A note line keeps its line when moved; one Alt adds goes on a new line, and the selection stays
        -- on the line it was copied from.
        self:SelectReminderAt(m, shown)
    end
end

-- Saved alerts: the strip, dropping a chip, and the right-click menus -------------------------------

local function readable(v)
    return CRT.Timeline.readable(v)
end

-- The cursor on the track: x from the track's left end (scroll included) and y down from its top.
local function cursorOnTrack(self)
    local scale = self.hscroll:GetEffectiveScale()
    local x, y = GetCursorPosition()
    x, y = x / scale, y / scale
    return self.hscroll:GetHorizontalScroll() + x - (self.hscroll:GetLeft() or 0), (self.hscroll:GetTop() or 0) - y
end

function Methods:CursorOnTrack()
    return cursorOnTrack(self)
end

-- The time at x on the track, within the view and to a tenth.
function Methods:TimeAtX(x)
    local length = math.max(1, self.extra.length or 0)
    return tenth(math.max(0, math.min(length, View.XToTime(x, length, self.trackW))))
end

-- The spell of the boss cast icon at x, y on the track (as cursorOnTrack gives them), else nil. Deaths and
-- icons without a spell give none.
function Methods:IconSpellAt(x, y)
    local length = math.max(1, self.extra.length or 0)
    for _, b in ipairs(self.icons) do
        if b:IsShown() and castIcon(b.lane, b.mark) then
            local row
            for i, lane in ipairs(self.lanes) do
                if lane == b.lane then
                    row = i
                    break
                end
            end
            local half = (b:GetWidth() or 0) / 2
            if row and math.abs(x - View.TimeToX(b.mark.t, length, self.trackW)) <= half
                and math.abs(y - ((row - 1) * ROW_H + ROW_H / 2)) <= half then
                local spellID = castSpell(b.lane, b.mark)
                if spellID then
                    return spellID
                end
            end
        end
    end
    return nil
end

-- The lane at y down from the track's top (as cursorOnTrack gives it), else nil (the empty space below).
function Methods:LaneAtY(y)
    local row = y and y >= 0 and math.floor(y / ROW_H) + 1 or nil
    return row and self.lanes[row] or nil
end

-- The drop rule for a template saved as saveAs ("note" or "mine") dropped on lane: whether it is saved as
-- your own. Always on the Personal notes lane, and for a Raid note by someone who may not change the raid
-- note (asked now). PlaceSaved and the bands of a held chip both go by it.
local function savedDropMine(lane, saveAs)
    return (lane ~= nil and lane.kind == "personal") or saveAs ~= "note" or not canEditRaid()
end

-- Opens the editor on a new alert from saved alert id at t seconds from the pull (phase + seconds as
-- OpenAt gives them), with spellID (a cast icon's) in place of its own when given. Placed on the
-- Personal notes lane (lane), or as a Raid note by someone who may not change the raid note (asked
-- now), it is saved as your own.
function Methods:PlaceSaved(id, t, spellID, lane)
    local Saved = CRT.AlertSaved
    local encounterID = self:EncounterNumber()
    if not encounterID then
        CRT:Print(TEXT.needPull)
        return
    end
    if not Saved then
        return
    end
    local saved = Saved.Get and Saved:Get(id)
    t = self:WrittenTime(spellID or (saved and saved.spellID), saved and saved.text, t)
    local ph, seconds = CRT.AlertReminders.PhaseAt(self.pull and self.pull.reference, tenth(t))
    local prefill = Saved:Prefill(id, encounterID, ph, tenth(seconds), spellID, self.bossName)
    if prefill then
        if savedDropMine(lane, prefill.saveAs) then
            prefill.saveAs = "mine"
        end
        prefill.group = prefill.group or self.group
        CRT.AlertEditor:Open(encounterID, nil, prefill)
    end
end

-- A context menu built by fill(root), above every window and the pop-out, submenus too (UI.ContextMenu,
-- UI/Window.lua); straight from the game's menu when UI/Window.lua isn't loaded (the test harnesses).
function View.OpenMenu(owner, fill)
    local ui = CRT.UI
    local open = type(ui) == "table" and rawget(ui, "ContextMenu")
    if open then
        return open(owner, fill)
    end
    return MenuUtil.CreateContextMenu(owner, function(_, root)
        fill(root)
    end)
end

-- A context menu at the cursor, built by build(root) with the game's menu; without one, a chat line.
local function contextMenu(owner, build)
    if MenuUtil and MenuUtil.CreateContextMenu then
        View.OpenMenu(owner, build)
    else
        CRT:Print(TEXT.noMenu)
    end
end

-- Assigning a cooldown -----------------------------------------------------------------------------

-- Whether a cooldown placed on lane is offered to the roster: only by someone who may change the raid
-- note (asked now), and never on the Personal notes lane, where it is always your own.
local function assigns(lane)
    if lane and lane.kind == "personal" then
        return false
    end
    return canEditRaid() and true or false
end

-- The drop rule for a cooldown dropped on lane: whether it is saved at once as your own (no one to assign
-- it, no encounter number, or no game menus) rather than through the menu of who it is for. PlaceCooldown
-- and the bands of a held chip both go by it.
local function cooldownDropMine(view, lane)
    return not (view:EncounterNumber() and assigns(lane) and MenuUtil and MenuUtil.CreateContextMenu)
end

-- A name as a menu line in its class's colour, or as it is when the class is unknown.
local function classColored(name, class)
    local c = class and RAID_CLASS_COLORS and RAID_CLASS_COLORS[class]
    if type(c) ~= "table" then
        return name
    end
    local hex = c.colorStr
    if type(hex) ~= "string" or #hex ~= 8 then
        local function byte(v)
            return math.floor((tonumber(v) or 1) * 255 + 0.5)
        end
        hex = string.format("ff%02x%02x%02x", byte(c.r), byte(c.g), byte(c.b))
    end
    return "|c" .. hex .. name .. "|r"
end

-- Who a cooldown can be given to: the names of the active Raid Groups layout (CRT.Groups:ActiveNames),
-- else the live group. { { key, name, class } } in name order: name as the editor's For shows it (no
-- realm on your own), class from the live group, else the class cache, else nil.
function Methods:AssignRoster()
    -- one roster for the assign menu and the Rehearsal's Preview as (Alerts/Roster.lua)
    local Roster = CRT.AlertRoster
    return Roster and Roster:Players() or {}
end

-- Saves cooldown e (as CRT.AlertCooldowns:List gives it) at t seconds from the pull at once, with the
-- cooldown defaults (Alerts/Draft.lua): for tag, a player's name (a raid note line for them), "" (a line
-- for no one), or nil (one of your reminders, Only me). The time goes back through WrittenTime for the
-- chosen order. A chat line says it was placed, or why not; the editor never opens.
function Methods:PlaceCooldownAt(t, e, tag)
    local encounterID = self:EncounterNumber()
    if not encounterID then
        CRT:Print(TEXT.needPull)
        return false
    end
    local Draft = CRT.AlertDraft
    local name = e and (e.name or (e.spellID and (CRT.AlertReminders.SpellName(e.spellID)
        or string.format(TEXT.spell, e.spellID)))) or TEXT.reminder
    if not (Draft and e and e.spellID) then
        CRT:Print(string.format(TEXT.placeFailed, name, TEXT.placeFailedWhy))
        return false
    end
    local at = clock(t)
    local written = self:WrittenTime(e.spellID, e.name, t)
    local ph, seconds = CRT.AlertReminders.PhaseAt(self.pull and self.pull.reference, tenth(written))
    local called, ok, err = pcall(Draft.PlaceCooldown, encounterID, e.spellID, e.name, self.bossName, ph,
        tenth(seconds), tag, self.group)
    if not called then
        ok, err = false, tostring(ok)
    end
    if not ok then
        local why = err ~= nil and tostring(err) or ""
        CRT:Print(string.format(TEXT.placeFailed, name, why ~= "" and why or TEXT.placeFailedWhy))
        return false
    end
    if tag == nil then
        CRT:Print(string.format(TEXT.placedMine, name, at))
    elseif tag == "" then
        CRT:Print(string.format(TEXT.placedNone, name, at))
    else
        CRT:Print(string.format(TEXT.placedFor, name, at, tag))
    end
    return true
end

-- Fills root (the drop's menu, or a cooldown's Place submenu) with who cooldown e can be given at t: under
-- its class's name that class's players, or a greyed line saying there are none and Leave unassigned (a
-- Raid note line for no one); then Anyone else, the rest of the roster; then Just me (your own). Each
-- choice places it at once (PlaceCooldownAt). With nobody on the roster: Leave unassigned and Just me.
-- roster is AssignRoster's, read here when nil.
function Methods:AssignMenu(root, e, t, roster)
    roster = roster or self:AssignRoster()
    local ofClass, others = {}, {}
    for _, p in ipairs(roster) do
        if p.class and p.class == e.class then
            ofClass[#ofClass + 1] = p
        else
            others[#others + 1] = p
        end
    end
    local function forPlayer(menu, p)
        menu:CreateButton(classColored(p.name, p.class), function()
            self:PlaceCooldownAt(t, e, p.name)
        end)
    end
    if #roster > 0 and type(e.class) == "string" then
        local Cooldowns = CRT.AlertCooldowns
        local className = Cooldowns and Cooldowns.ClassName(e.class) or e.class
        root:CreateTitle(string.format(TEXT.assignClass, className))
        for _, p in ipairs(ofClass) do
            forPlayer(root, p)
        end
        if #ofClass == 0 then
            local none = root:CreateButton(string.format(TEXT.noClass, className))
            if none and none.SetEnabled then
                none:SetEnabled(false)
            end
        end
    end
    if #ofClass == 0 then
        root:CreateButton(TEXT.unassigned, function()
            self:PlaceCooldownAt(t, e, "")
        end)
    end
    if #others > 0 then
        root:CreateDivider()
        local sub = root:CreateButton(TEXT.anyoneElse)
        if sub.SetScrollMode then
            sub:SetScrollMode(ASSIGN_MENU_MAX_H)
        end
        for _, p in ipairs(others) do
            forPlayer(sub, p)
        end
    end
    root:CreateDivider()
    root:CreateButton(TEXT.justMe, function()
        self:PlaceCooldownAt(t, e)
    end)
end

-- Places cooldown e (as CRT.AlertCooldowns:List gives it) at t seconds from the pull, dropped on lane.
-- Someone who may change the raid note gets a menu at the cursor of who it is for (AssignMenu); anyone
-- else, and anyone on the Personal notes lane, has it saved at once as an alert of their own
-- (PlaceCooldownAt, Only me).
function Methods:PlaceCooldown(e, t, lane)
    if not (e and e.spellID) then
        return
    end
    -- without the game's menus too: saved at once as your own
    if cooldownDropMine(self, lane) then
        self:PlaceCooldownAt(t, e)
        return
    end
    contextMenu(self.hscroll, function(root)
        self:AssignMenu(root, e, t)
    end)
end

-- The Rename popup: an edit box with the saved alert's name. data = { id, name }. The popup helpers
-- (lifting it over the alert editor, finding it, its edit box) are CRT.UI's.
local function acceptRename(edit, data)
    if edit and data and CRT.AlertSaved then
        CRT.AlertSaved:Rename(data.id, edit:GetText())
    end
end

local function ensureRenamePopup()
    if not StaticPopupDialogs then
        return false
    end
    if not StaticPopupDialogs[RENAME_POPUP] then
        StaticPopupDialogs[RENAME_POPUP] = {
            text = TEXT.renamePrompt,
            button1 = TEXT.accept,
            button2 = TEXT.cancel,
            hasEditBox = true,
            maxLetters = 64,
            timeout = 0,
            whileDead = true,
            hideOnEscape = true,
            preferredIndex = 3,
            OnShow = function(dialog, data)
                local edit = CRT.UI.PopupEditBox(dialog)
                if edit then
                    edit:SetText(data and data.name or "")
                    edit:HighlightText()
                end
            end,
            OnAccept = function(dialog, data)
                acceptRename(CRT.UI.PopupEditBox(dialog), data)
            end,
            -- the game passes the dialog's data; the box's parent is only a fallback (layouts change)
            EditBoxOnEnterPressed = function(edit, data)
                local parent = edit:GetParent()
                acceptRename(edit, data or (parent and parent.data))
                StaticPopup_Hide(RENAME_POPUP)
            end,
            EditBoxOnEscapePressed = function()
                StaticPopup_Hide(RENAME_POPUP)
            end,
        }
    end
    return true
end

local function askRename(id)
    local s = CRT.AlertSaved and CRT.AlertSaved:Get(id)
    if s and ensureRenamePopup() then
        local UI = CRT.UI
        UI.LiftOver(UI.ShownPopup(StaticPopup_Show(RENAME_POPUP, nil, nil, { id = id, name = s.name }), RENAME_POPUP))
    end
end

local function askDelete(id)
    local s = CRT.AlertSaved and CRT.AlertSaved:Get(id)
    if not (s and StaticPopup_ShowCustomGenericConfirmation) then
        return
    end
    local UI = CRT.UI
    UI.LiftOver(UI.ShownPopup(StaticPopup_ShowCustomGenericConfirmation({
        text = string.format(TEXT.deleteConfirm, tostring(s.name or "")),
        acceptText = TEXT.delete,
        cancelText = TEXT.cancel,
        showAlert = true,
        callback = function()
            CRT.AlertSaved:Delete(id)
        end,
    }), "GENERIC_CONFIRMATION"))
end

-- Delete on a marker's menu, after a confirm. A reminder with several times loses only this time; one
-- with a single time is deleted whole; a raid note line is removed if it is still the line drawn. A
-- change since the menu opened is refused, with a chat line.
local function deleteMark(self, m)
    local ok
    if m.noteID then
        local allowed, why = canEditRaid()
        if not allowed then
            CRT:Print(why or TEXT.deleteRefused)
            return
        end
        ok = CRT.Notes:RemoveLine(m.noteID, m.line, m.expected)
    else
        local Reminders = CRT.AlertReminders
        local r = Reminders:Get(m.encounterID, m.id)
        local times = r and self:ReminderTimes(m.encounterID, r)
        local cur = times and times[m.index]
        if cur and cur.ph == m.ph and cur.t == m.time then
            if #times > 1 then
                local ref, group = self:ReminderSource(r)
                ok = Reminders:RemoveTime(m.encounterID, m.id, m.index, ref, group)
            else
                Reminders:Delete(m.encounterID, m.id)
                ok = true
            end
        end
    end
    if not ok then
        CRT:Print(TEXT.deleteRefused)
        self:Refresh()
    end
end

local function askDeleteMark(self, m)
    if not StaticPopup_ShowCustomGenericConfirmation then
        return
    end
    local question
    if m.noteID then
        question = string.format(TEXT.deleteNote, tostring(m.text or ""))
    else
        local r = CRT.AlertReminders:Get(m.encounterID, m.id)
        local times = r and self:ReminderTimes(m.encounterID, r)
        question = string.format(times and #times > 1 and TEXT.deleteTime or TEXT.deleteReminder, tostring(m.text or ""))
    end
    local UI = CRT.UI
    UI.LiftOver(UI.ShownPopup(StaticPopup_ShowCustomGenericConfirmation({
        text = question,
        acceptText = TEXT.delete,
        cancelText = TEXT.cancel,
        showAlert = true,
        callback = function()
            deleteMark(self, m)
        end,
    }), "GENERIC_CONFIRMATION"))
end

-- A chip's icon: its icon ID, else its spell's icon; nil when there is none or it can't be read.
local function chipIcon(s)
    local id = s.iconID
    if readable(id) and type(id) == "number" and id > 0 then
        return id
    end
    id = s.spellID
    if readable(id) and type(id) == "number" and id > 0 and C_Spell and C_Spell.GetSpellTexture then
        local ok, tex = pcall(C_Spell.GetSpellTexture, id)
        if ok and tex ~= nil and readable(tex) then
            return tex
        end
    end
    return nil
end

-- A chip's edge color: the template's color, else the accent.
local function chipColor(s)
    local c = s.color
    if type(c) == "table" and readable(c[1]) and type(c[1]) == "number" and type(c[2]) == "number"
        and type(c[3]) == "number" then
        return c[1], c[2], c[3], 1
    end
    return rgba("accent")
end

-- A font string's width as its text would draw: a width set earlier caps GetStringWidth.
local function textWidth(fs)
    local w = fs.GetUnboundedStringWidth and fs:GetUnboundedStringWidth()
    if type(w) ~= "number" then
        w = fs:GetStringWidth()
    end
    return type(w) == "number" and w or 0
end

-- A template's hover: its name and text, how it shows, who it is for.
local function chipEnter(c)
    local s = CRT.AlertSaved and CRT.AlertSaved:Get(c.savedID)
    if not s then
        return
    end
    CRT.UI.TooltipOwner(GameTooltip, c, "ANCHOR_TOP", nil, nil, "timeline")
    GameTooltip:SetText(s.name or TEXT.unnamed, 1, 0.82, 0)
    if type(s.text) == "string" and s.text ~= "" and s.text ~= s.name then
        GameTooltip:AddLine(s.text, 1, 1, 1)
    end
    local shows = {}
    for _, k in ipairs({ "alert", "text", "icon", "bar", "circle", "timeline" }) do
        if s.outputs and s.outputs[k] then
            shows[#shows + 1] = TEXT.outputs[k]
        end
    end
    if s.outputs and s.outputs.speech then
        shows[#shows + 1] = TEXT.readOut
    end
    GameTooltip:AddLine(#shows > 0 and string.format(TEXT.shows, table.concat(shows, ", ")) or TEXT.showsNothing,
        0.85, 0.85, 0.85)
    if s.saveAs == "note" then
        local words = {}
        for i, tag in ipairs(s.tags or {}) do
            words[i] = tag:lower() == "everyone" and TEXT.everyone or className(tag)
        end
        GameTooltip:AddLine(string.format(TEXT.raidNoteFor, #words > 0 and table.concat(words, " ") or TEXT.noOne),
            0.85, 0.85, 0.85)
    else
        GameTooltip:AddLine(TEXT.onlyMe, 0.85, 0.85, 0.85)
    end
    GameTooltip:AddLine(TEXT.savedHint, 0.6, 0.6, 0.6, true)
    GameTooltip:Show()
end

-- A cooldown's hover: the game's name for its spell, its class, and what dragging it does.
local function cooldownEnter(c)
    local e = c.cooldown
    if not e then
        return
    end
    local Cooldowns = CRT.AlertCooldowns
    CRT.UI.TooltipOwner(GameTooltip, c, "ANCHOR_TOP", nil, nil, "timeline")
    GameTooltip:SetText(e.name, 1, 0.82, 0)
    GameTooltip:AddLine(Cooldowns and Cooldowns.ClassName(e.class) or e.class, 1, 1, 1)
    GameTooltip:AddLine(TEXT.cooldownHint, 0.6, 0.6, 0.6, true)
    GameTooltip:Show()
end

-- A faint light over a button while the mouse is on it (the HIGHLIGHT layer shows only then).
local function hoverLight(b)
    local hl = b:CreateTexture(nil, "HIGHLIGHT")
    hl:SetAllPoints()
    hl:SetColorTexture(1, 1, 1, 0.12)
end

-- A chip's two backgrounds: the roll frame's grey stone (UI.Stone) for Default: Blizzard and a flat one
-- in the theme's surface for the others; chipLook shows the one the theme uses.
local function chipBackground(c)
    local UI = CRT.UI
    c.stone = UI and UI.Stone and UI.Stone(c, "BACKGROUND", 0) or false
    c.bg = c:CreateTexture(nil, "BACKGROUND", nil, 1)
    c.bg:SetAllPoints()
    themed(c.bg, "SetColorTexture", "surface", 0.9)
end

-- Shows a chip's (or the + chip's) background for the theme in use: the stone in Default: Blizzard, else
-- the flat one. Run on each fill and each redraw, so a theme switch shows at once.
local function chipLook(c)
    local UI = CRT.UI
    local stone = c.stone and not (UI and UI.IsModern and UI:IsModern())
    if c.stone then
        c.stone:SetShown(stone)
    end
    c.bg:SetShown(not stone)
end

-- The chip parts: a background, the colored left edge, the icon and the name (shadowed, to read on
-- the stone).
local function chipParts(c)
    chipBackground(c)
    c.edge = c:CreateTexture(nil, "ARTWORK")
    c.edge:SetPoint("TOPLEFT", c, "TOPLEFT", 0, 0)
    c.edge:SetPoint("BOTTOMLEFT", c, "BOTTOMLEFT", 0, 0)
    c.edge:SetWidth(CHIP_EDGE)
    c.icon = c:CreateTexture(nil, "ARTWORK")
    c.icon:SetSize(CHIP_ICON, CHIP_ICON)
    c.icon:SetPoint("LEFT", c, "LEFT", CHIP_EDGE + 4, 0)
    c.name = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    c.name:SetJustifyH("LEFT")
    c.name:SetWordWrap(false)
    c.name:SetShadowColor(0, 0, 0, 1)
    c.name:SetShadowOffset(1, -1)
    themed(c.name, "SetTextColor", "text")
end

-- Paints a chip (or the ghost): its name, the icon tex untinted, or with none the Personal notes icon
-- tinted by tint ({ r, g, b }); the edge in edge ({ r, g, b, a }). Returns its width.
local function paintChip(c, name, tex, tint, edge)
    chipLook(c)
    if tex then
        c.icon:SetTexture(tex)
        c.icon:SetVertexColor(1, 1, 1)
    else
        c.icon:SetTexture(PERSONAL_ICON)
        c.icon:SetVertexColor(tint[1], tint[2], tint[3])
    end
    c.icon:Show()
    local x = CHIP_EDGE + 4 + CHIP_ICON + 4
    c.edge:SetColorTexture(edge[1], edge[2], edge[3], edge[4] or 1)
    c.name:SetText(name)
    local w = math.ceil(math.min(CHIP_NAME_MAX, textWidth(c.name)))
    c.name:SetWidth(w)
    c.name:ClearAllPoints()
    c.name:SetPoint("LEFT", c, "LEFT", x, 0)
    local width = x + w + 6
    c:SetSize(width, CHIP_H)
    return width
end

-- Fills a chip (or the ghost) for template s; returns its width. Without an icon it shows the note icon
-- in the template's color.
local function fillChip(c, s)
    local color = { chipColor(s) }
    return paintChip(c, s.name or TEXT.unnamed, chipIcon(s), color, color)
end

-- Fills a chip (or the ghost) for cooldown e (as CRT.AlertCooldowns:List gives it); returns its width.
local function fillCooldownChip(c, e)
    local tex = e.icon
    if not (tex ~= nil and readable(tex) and (type(tex) == "number" or type(tex) == "string")) then
        tex = nil
    end
    return paintChip(c, e.name, tex, { rgba("accent") }, { rgba("label", 0.6) })
end

-- The strip along the bottom: two groups of chips. The templates: their label (with help) and the
-- chips in a scroll frame, wrapping onto rows. Under them the cooldowns: a label (with help), the
-- filter dropdown and their chips, wrapping the same way. Each group shows up to STRIP_MAX_ROWS rows
-- (LayoutStrip); the wheel over it scrolls the rest, a thin bar at its right end showing where.
function Methods:BuildStrip()
    local f = self.frame
    local strip = CreateFrame("Frame", nil, f)
    strip:SetPoint("BOTTOMLEFT", f, "BOTTOMLEFT", 0, 2)
    strip:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -SCROLLBAR_W, 2)
    strip:SetHeight(self.stripH)
    local line = strip:CreateTexture(nil, "ARTWORK")
    line:SetPoint("TOPLEFT", strip, "TOPLEFT", 0, 0)
    line:SetPoint("TOPRIGHT", strip, "TOPRIGHT", 0, 0)
    line:SetHeight(1)
    themed(line, "SetColorTexture", "accent", 0.4)
    strip.label = strip:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    strip.label:SetPoint("LEFT", strip, "TOPLEFT", 4, -STRIP_ROW / 2)
    themed(strip.label, "SetTextColor", "label")
    strip.label:SetText(TEXT.savedAlerts)
    if CRT.UI and CRT.UI.HelpRight then
        CRT.UI.HelpRight(strip.label, TEXT.savedAlerts, TEXT.savedHelp)
    end
    strip:Hide()
    self.strip = strip

    local function chipScroll()
        local scroll = CreateFrame("ScrollFrame", nil, strip)
        local row = CreateFrame("Frame", nil, scroll)
        row:SetSize(1, CHIP_H)
        scroll:SetScrollChild(row)
        scroll:EnableMouseWheel(true)
        return scroll, row
    end
    -- the bar at a group's right end: a faint track as tall as the group, the thumb its rows in view;
    -- on the strip, so the scroll frame does not clip it
    local function rowsBar(scroll)
        local track = strip:CreateTexture(nil, "OVERLAY")
        track:SetWidth(STRIP_IND_W)
        track:SetPoint("TOPRIGHT", scroll, "TOPRIGHT", 0, 0)
        themed(track, "SetColorTexture", "label", 0.15)
        track:Hide()
        local thumb = strip:CreateTexture(nil, "OVERLAY")
        thumb:SetWidth(STRIP_IND_W)
        thumb:SetPoint("TOPRIGHT", scroll, "TOPRIGHT", 0, 0)
        themed(thumb, "SetColorTexture", "accent")
        thumb:Hide()
        return { track = track, thumb = thumb }
    end
    local scroll, row = chipScroll()
    scroll:SetPoint("TOPLEFT", strip, "TOPLEFT", LABEL_W, -3)
    scroll:SetPoint("BOTTOMRIGHT", strip, "TOPRIGHT", 0, -STRIP_ROW + 3)
    scroll:SetScript("OnMouseWheel", function(_, delta)
        self:ScrollStripRows("chip", delta)
    end)
    self.chipScroll, self.chipRow = scroll, row
    self.chipBar = rowsBar(scroll)

    -- the Cooldowns row: label, (?), the filter dropdown, then the chips
    local cdLabel = strip:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    cdLabel:SetPoint("LEFT", strip, "TOPLEFT", 4, -STRIP_ROW - STRIP_ROW / 2)
    themed(cdLabel, "SetTextColor", "label")
    cdLabel:SetText(TEXT.cooldowns)
    self.cdLabel = cdLabel
    local after = cdLabel
    if CRT.UI and CRT.UI.HelpRight then
        after = CRT.UI.HelpRight(cdLabel, TEXT.cooldowns, TEXT.cooldownsHelp)
    end
    local Cooldowns = CRT.AlertCooldowns
    if Cooldowns and CRT.UI and CRT.UI.Dropdown then
        local drop = CRT.UI.Dropdown(strip, "", {
            labelWidth = 1,
            width = CD_DROP_W,
            maxHeight = 300,
            options = function()
                return Cooldowns:Filters()
            end,
            get = function()
                return Cooldowns:Filter()
            end,
            set = function(key)
                Cooldowns:SetFilter(key)
                self.cdFirst = 0 -- a new list starts at its first row
                self:DrawCooldowns()
            end,
        })
        drop:SetHeight(STRIP_ROW)
        drop:SetPoint("LEFT", after, "RIGHT", 0, 0)
        self.cdFilter = drop
        after = drop.Dropdown or drop
    end
    -- the chips start just after the dropdown (else the (?), else the label), whatever their widths, and
    -- run to the strip's right end, under the templates' rows (LayoutStrip moves them as those change)
    local cdScroll, cdRow = chipScroll()
    cdScroll:SetPoint("LEFT", after, "RIGHT", 6, 0)
    cdScroll:SetPoint("RIGHT", strip, "TOPRIGHT", 0, -STRIP_ROW - STRIP_ROW / 2)
    cdScroll:SetHeight(CHIP_H)
    cdScroll:SetScript("OnMouseWheel", function(_, delta)
        self:ScrollStripRows("cd", delta)
    end)
    self.cdScroll, self.cdRow, self.cdAfter = cdScroll, cdRow, after
    self.cdBar = rowsBar(cdScroll)
    self.cdEmpty = cdRow:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    self.cdEmpty:SetPoint("LEFT", cdRow, "TOPLEFT", 4, -CHIP_H / 2)
    themed(self.cdEmpty, "SetTextColor", "label", 0.7)
    self.cdEmpty:SetText(TEXT.noCooldowns)
    self.cdEmpty:Hide()

    local plus = CreateFrame("Button", nil, row)
    plus:SetSize(PLUS_W, CHIP_H)
    chipBackground(plus)
    plus.text = plus:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    plus.text:SetPoint("CENTER", plus, "CENTER", 0, 0)
    plus.text:SetText("+")
    themed(plus.text, "SetTextColor", "accent")
    hoverLight(plus)
    plus:SetScript("OnEnter", function(b)
        CRT.UI.TooltipOwner(GameTooltip, b, "ANCHOR_TOP", nil, nil, "timeline")
        GameTooltip:SetText(TEXT.newSaved, 1, 0.82, 0)
        GameTooltip:Show()
    end)
    plus:SetScript("OnLeave", hideTip)
    plus:SetScript("OnClick", function()
        if CRT.AlertEditor then
            CRT.AlertEditor:EditSaved(nil)
        end
    end)
    self.plus = plus
end

-- The height of n rows of chips: a chip, then STRIP_ROW more per row.
local function rowsHeight(n)
    return n * STRIP_ROW - (STRIP_ROW - CHIP_H)
end

-- The width a group's chips wrap within: its scroll frame, less room for the bar at its right end.
-- Not laid out yet (no width), everything goes on one row until the next redraw.
local function wrapWidth(scroll)
    local w = scroll:GetWidth() or 0
    if w <= 0 then
        return math.huge
    end
    return w - STRIP_IND_W - STRIP_IND_GAP
end

-- A group laid out before its scroll frame had a width (the first draw of a new window) went on one
-- row: wrap it again on the next frame, once, when the size is known.
function Methods:RewrapSoon()
    if self.rewrapPending or not (C_Timer and C_Timer.After) then
        return
    end
    self.rewrapPending = true
    C_Timer.After(0, function()
        self.rewrapPending = false
        if self.strip and self.strip:IsShown() then
            self:DrawStrip()
        end
    end)
end

-- Places chips left to right on row (a group's scroll child), starting a new row whenever the next
-- would pass width. The returned function places frame f of width w and returns its row number.
local function flow(row, width)
    local x, n = 0, 1
    return function(f, w)
        if x > 0 and x + w > width then
            x, n = 0, n + 1
        end
        f:ClearAllPoints()
        f:SetPoint("TOPLEFT", row, "TOPLEFT", x, -(n - 1) * STRIP_ROW)
        x = x + w + CHIP_GAP
        return n
    end
end

-- Shows a group's rows from first (0 based) and its bar: only when it has more rows than shown, the
-- thumb's share and place those of the rows in view.
local function showRows(scroll, bar, first, shown, rows)
    if scroll.UpdateScrollChildRect then
        scroll:UpdateScrollChildRect()
    end
    scroll:SetVerticalScroll(first * STRIP_ROW)
    local more = rows > shown
    bar.track:SetShown(more)
    bar.thumb:SetShown(more)
    if more then
        local h = rowsHeight(shown)
        bar.track:SetHeight(h)
        bar.thumb:SetHeight(h * shown / rows)
        bar.thumb:SetPoint("TOPRIGHT", scroll, "TOPRIGHT", 0, -h * first / rows)
    end
end

local function clampRow(first, rows, shown)
    return math.max(0, math.min(rows - shown, first or 0))
end

-- The wheel over a group ("chip" the templates, "cd" the cooldowns): one row per notch, within its rows.
function Methods:ScrollStripRows(group, delta)
    local key = group == "cd" and "cd" or "chip"
    local rows, shown = self[key .. "Rows"] or 1, self[key .. "Shown"] or 1
    local first = clampRow((self[key .. "First"] or 0) + (delta > 0 and -1 or 1), rows, shown)
    self[key .. "First"] = first
    showRows(self[key .. "Scroll"], self[key .. "Bar"], first, shown, rows)
end

-- Puts Time unknown, the scroll bar and the bottom of the lanes above the strip at its current height.
function Methods:PlaceStrip()
    local f, h = self.frame, self.stripH
    self.strip:SetHeight(h)
    self.unknownText:SetPoint("BOTTOMLEFT", f, "BOTTOMLEFT", 4, h + 2)
    self.unknownText:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -4, h + 2)
    self.bar:SetPoint("BOTTOMLEFT", f, "BOTTOMLEFT", LABEL_W, h + UNKNOWN_H + 2)
    self.bar:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -SCROLLBAR_W, h + UNKNOWN_H + 2)
    self.vscroll:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -SCROLLBAR_W, h + UNKNOWN_H + BAR_H + 4)
    -- the lanes' window changed height: the track still reaches its bottom
    local area = math.max(math.max(1, #self.lanes * ROW_H), self.vscroll:GetHeight() or 0)
    self.body:SetSize(math.max(1, self.vscroll:GetWidth() or 1), area)
    self.track:SetSize(self.trackW, area)
    if self.hscroll.UpdateScrollChildRect then
        self.hscroll:UpdateScrollChildRect()
    end
end

-- Sizes the two groups to their rows, up to STRIP_MAX_ROWS each, and the strip to the sum. The lanes
-- keep STRIP_MIN_LANES rows in view: without room, the group with more rows shown gives one up first
-- (each keeps one), so it scrolls instead.
function Methods:LayoutStrip()
    local tRows, cRows = self.chipRows or 1, self.cdRows or 1
    local t, c = math.min(STRIP_MAX_ROWS, tRows), math.min(STRIP_MAX_ROWS, cRows)
    local room = (self.frame:GetHeight() or 0) - (self.axisH or AXIS_H) - UNKNOWN_H - BAR_H - 4
        - STRIP_MIN_LANES * ROW_H
    local most = math.max(2, math.floor(room / STRIP_ROW))
    while t + c > most do
        if t >= c and t > 1 then
            t = t - 1
        else
            c = c - 1
        end
    end
    self.chipShown, self.cdShown = t, c
    self.chipFirst = clampRow(self.chipFirst, tRows, t)
    self.cdFirst = clampRow(self.cdFirst, cRows, c)
    -- the templates from the top; the cooldowns under them, their label on their first row and their
    -- chips centred in their rows (the left edge follows the dropdown, level with the same middle)
    self.chipScroll:SetPoint("BOTTOMRIGHT", self.strip, "TOPRIGHT", 0, -t * STRIP_ROW + 3)
    local top = -t * STRIP_ROW
    self.cdLabel:SetPoint("LEFT", self.strip, "TOPLEFT", 4, top - STRIP_ROW / 2)
    self.cdScroll:SetPoint("LEFT", self.cdAfter, "RIGHT", 6, -(c - 1) * STRIP_ROW / 2)
    self.cdScroll:SetPoint("RIGHT", self.strip, "TOPRIGHT", 0, top - c * STRIP_ROW / 2)
    self.cdScroll:SetHeight(rowsHeight(c))
    showRows(self.chipScroll, self.chipBar, self.chipFirst, t, tRows)
    showRows(self.cdScroll, self.cdBar, self.cdFirst, c, cRows)
    local h = (t + c) * STRIP_ROW
    if h ~= self.stripH then
        self.stripH = h
        self:PlaceStrip()
    end
end

-- A chip from pool list on row: left-drag places it, a right click opens its menu. kind is "saved" (a
-- template) or "cooldown"; enter is its hover.
function Methods:MakeChip(list, n, row, kind, enter)
    return pooled(list, n, function()
        local c = CreateFrame("Button", nil, row)
        c.chipKind = kind
        c:EnableMouse(true)
        chipParts(c)
        hoverLight(c)
        c:SetScript("OnEnter", enter)
        c:SetScript("OnLeave", hideTip)
        c:SetScript("OnMouseDown", function(_, button)
            if button == "LeftButton" then
                self:StartChipMove(c)
            end
        end)
        c:SetScript("OnMouseUp", function(_, button)
            if button == "LeftButton" then
                self:FinishChipMove()
            elseif button == "RightButton" then
                self:ChipMenu(c)
            end
        end)
        return c
    end)
end

-- One template chip from the pool.
function Methods:Chip(n)
    return self:MakeChip(self.chips, n, self.chipRow, "saved", chipEnter)
end

-- One cooldown chip from the pool.
function Methods:CooldownChip(n)
    return self:MakeChip(self.cdChips, n, self.cdRow, "cooldown", cooldownEnter)
end

-- Draws a chip for each template, by name, then the + chip, and the Cooldowns row. Hidden while no boss
-- is shown.
function Methods:DrawStrip()
    local shown = self.pull ~= nil and self.encounterID ~= nil
    self.strip:SetShown(shown)
    if not shown then
        self:CancelChipMove()
        return
    end
    local list = CRT.AlertSaved and CRT.AlertSaved:List() or {}
    local width = wrapWidth(self.chipScroll)
    if width == math.huge then
        self:RewrapSoon()
    end
    local put = flow(self.chipRow, width)
    for n, e in ipairs(list) do
        local c = self:Chip(n)
        c.savedID = e.id
        put(c, fillChip(c, e.s))
    end
    hideFrom(self.chips, #list + 1)
    chipLook(self.plus)
    self.chipRows = put(self.plus, PLUS_W) -- the + chip last
    self.chipRow:SetSize(width < math.huge and width or 1, rowsHeight(self.chipRows))
    self:DrawCooldowns()
end

-- The cooldowns the row lists now (its filter), in list order.
function Methods:CooldownList()
    local Cooldowns = CRT.AlertCooldowns
    return Cooldowns and Cooldowns:List(Cooldowns:Filter()) or {}
end

-- Draws the Cooldowns group: a chip for each cooldown of the chosen filter, then lays out the strip.
function Methods:DrawCooldowns()
    if self.cdFilter and self.cdFilter.refresh then
        self.cdFilter.refresh()
    end
    local list = self:CooldownList()
    local width = wrapWidth(self.cdScroll)
    if width == math.huge then
        self:RewrapSoon()
    end
    local put = flow(self.cdRow, width)
    local rows = 1
    for n, e in ipairs(list) do
        local c = self:CooldownChip(n)
        c.cooldown = e
        rows = put(c, fillCooldownChip(c, e))
    end
    hideFrom(self.cdChips, #list + 1)
    self.cdEmpty:SetShown(#list == 0)
    self.cdRows = rows
    self.cdRow:SetSize(width < math.huge and width or 1, rowsHeight(rows))
    self:LayoutStrip()
end

-- Cooldown bands ------------------------------------------------------------------------------------
-- A single click on a flag selects it; the selected flag's spell cooldown shows as two see-through bands on
-- its row: "before" from t - cd to t and "after" from t to t + cd, with a thin line at each far end (up
-- again) and the length inside the after band. Where another cast of the same spell for the same target
-- falls inside, the stretch from it to the selected cast is red. A dragged flag or chip shows its own bands
-- the same way. Healer CDs draws every cast's bands by itself (Timeline/HealerView.lua); the selected or
-- dragged cast's are hidden there while these show (OwnBands). Display only: nothing here is saved.

-- A mark's identity, kept across redraws: a note line's noteID and line, a reminder's id and which time.
local function markKey(m)
    if not m then
        return nil
    end
    if m.kind == "note" and m.noteID ~= nil then
        return "note:" .. tostring(m.noteID) .. ":" .. tostring(m.line)
    elseif m.kind == "mine" and m.id ~= nil then
        return "mine:" .. tostring(m.encounterID) .. ":" .. tostring(m.id) .. ":" .. tostring(m.index)
    end
    return nil
end

-- A drawn cast's identity on its row (a note line for two players is drawn on both their rows), for
-- Timeline/HealerView.lua's bands of every cast; nil for a mark with no identity.
function View.BandKey(m, row)
    local key = markKey(m)
    return key and (key .. "@" .. tostring(row or m.row)) or nil
end

-- The words of a tags list (or a tags text) as one text, to tell the same target.
local function tagsText(tags)
    if type(tags) == "table" then
        return table.concat(tags, " ")
    end
    return type(tags) == "string" and tags or ""
end

-- Whether mark o is a cast of b's spell for b's target: a line of the same note (so the same difficulty)
-- with the same tag: text, or another time of your personal reminders. A chip not yet in a note (no
-- noteID) is compared with the lines of every note.
local function sameTarget(o, b)
    if o.kind ~= b.kind or o.spellID == nil or o.spellID ~= b.spellID then
        return false
    end
    if o.kind == "mine" then
        return true
    end
    return (b.noteID == nil or o.noteID == b.noteID) and tagsText(o.tags) == tagsText(b.tags)
end

-- spellID's cooldown length in seconds (Alerts/Cooldowns.lua's Length), else nil.
local function cdLength(spellID)
    if not (readable(spellID) and type(spellID) == "number" and spellID > 0) then
        return nil
    end
    local C = CRT.AlertCooldowns
    if not (C and C.Length) then
        return nil
    end
    local ok, n = pcall(C.Length, C, spellID)
    if ok and type(n) == "number" and n > 0 then
        return n
    end
    return nil
end

-- The times of the other casts of mark m's spell for its target on what is drawn, m itself left out (a
-- mark not yet drawn, such as a held chip's, has nothing to leave out). A drag works them out once.
function Methods:OtherCasts(m)
    local own = markKey(m)
    local others = {}
    for _, o in ipairs(self.marks or {}) do
        if (own == nil or markKey(o) ~= own) and sameTarget(o, m) and type(o.t) == "number" then
            others[#others + 1] = o.t
        end
    end
    return others
end

-- What the bands of mark m are drawn from: its time t on row (its own when nil), its spell and colour,
-- and others, the other casts' times (OtherCasts when nil). extra is one more cast's time: the grabbed one
-- while Alt adds a time and leaves it there.
function Methods:BandSpec(m, t, row, others, extra)
    return { t = t or m.t, row = row or m.row, spellID = m.spellID, key = m.mine and "text" or "accent",
        others = others or self:OtherCasts(m), extra = extra }
end

-- The bands of the chip held in cm at t, x, y on the track (as cursorOnTrack gives them): on the lane under
-- the cursor, with the spell it would place (a template's own, or a cast icon's it is dropped on). Who it
-- is for decides what counts as another cast: your reminders when it is saved as your own, the note lines
-- with its tags for a template saved as a raid note. A cooldown a raid leader is about to assign has no
-- target yet, so only its bands show. Nil with no lane there.
function Methods:ChipBands(cm, t, x, y)
    local lane = self:LaneAtY(y)
    if not lane then
        return nil
    end
    local row = math.floor(y / ROW_H) + 1
    local mark, known
    if cm.kind == "cooldown" then
        local mine = cooldownDropMine(self, lane)
        mark, known = { kind = "mine", mine = mine, spellID = cm.cooldown and cm.cooldown.spellID }, mine
    else
        local s = CRT.AlertSaved and CRT.AlertSaved:Get(cm.id)
        if not s then
            return nil
        end
        -- the cast icon under the cursor, looked up again only when the row or the whole pixel changes
        local at = row .. ":" .. math.floor(x + 0.5)
        if cm.iconAt ~= at then
            cm.iconAt, cm.iconSpell = at, self:IconSpellAt(x, y)
        end
        local mine = savedDropMine(lane, s.saveAs)
        mark = { kind = mine and "mine" or "note", mine = mine, spellID = cm.iconSpell or s.spellID, tags = s.tags }
        known = true
    end
    -- the other casts, worked out again only when the lane, the spell or who it is for changes
    local key = row .. "|" .. mark.kind .. "|" .. tostring(mark.spellID) .. "|" .. tagsText(mark.tags) .. "|"
        .. tostring(known)
    if cm.othersKey ~= key then
        cm.othersKey, cm.others = key, known and self:OtherCasts(mark) or {}
    end
    return self:BandSpec(mark, t, row, cm.others)
end

-- The bands' frame over the track, a level under the flags (DrawMarks puts them 8 above the track), with
-- the length label.
function Methods:BandFrame()
    local bf = self.bandFrame
    if not bf then
        bf = CreateFrame("Frame", nil, self.track)
        bf:SetAllPoints(self.track)
        bf.label = bf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        themed(bf.label, "SetTextColor", "text")
        bf.label:Hide()
        self.bandFrame, self.bandLabel, self.bandTex = bf, bf.label, {}
    end
    bf:SetFrameLevel((self.track:GetFrameLevel() or 0) + 7)
    return bf
end

-- Draws the bands of spec (BandSpec's), or hides them all with none. Clamped to the timeline's length;
-- nothing when the spell's length is unknown. Returns true when another cast is inside them (too soon),
-- then whether any were drawn.
function Methods:DrawBands(spec)
    local n, soon, labelShown = 0, false, false
    local cd = spec and self.pull and spec.row and cdLength(spec.spellID)
    if cd then
        local bf = self:BandFrame()
        local length = math.max(1, self.extra.length or 0)
        local trackW = self.trackW
        local function x(t)
            return View.TimeToX(math.max(0, math.min(length, t)), length, trackW)
        end
        local top, h = -(spec.row - 1) * ROW_H - BAND_INSET, ROW_H - 2 * BAND_INSET
        local function put(x0, x1, r, g, b, a, sub)
            if x1 - x0 <= 0 then
                return
            end
            n = n + 1
            local tex = pooled(self.bandTex, n, function()
                return bf:CreateTexture(nil, "ARTWORK")
            end)
            tex:SetDrawLayer("ARTWORK", sub)
            tex:SetColorTexture(r, g, b, a)
            tex:ClearAllPoints()
            tex:SetPoint("TOPLEFT", self.track, "TOPLEFT", x0, top)
            tex:SetSize(x1 - x0, h)
        end
        local t = spec.t
        local lo, hi = t - cd, t + cd
        local r, g, b = rgba(spec.key)
        put(x(lo), x(t), r, g, b, BAND_ALPHA, 0)
        put(x(t), x(hi), r, g, b, BAND_ALPHA, 0)
        -- the farthest other cast inside each band: red from it to the selected cast
        -- a cast at the selected cast's own time is the same moment, so it is left out
        local redLo, redHi
        local function inside(c)
            if type(c) == "number" and c > lo and c < hi and math.abs(c - t) > SAME_MOMENT then
                soon = true
                if c < t then
                    redLo = math.min(redLo or t, c)
                else
                    redHi = math.max(redHi or t, c)
                end
            end
        end
        for _, c in ipairs(spec.others or {}) do
            inside(c)
        end
        inside(spec.extra)
        if redLo then
            put(x(redLo), x(t), DEATH_RED[1], DEATH_RED[2], DEATH_RED[3], BAND_RED_ALPHA, 1)
        end
        if redHi then
            put(x(t), x(redHi), DEATH_RED[1], DEATH_RED[2], DEATH_RED[3], BAND_RED_ALPHA, 1)
        end
        -- up again: a line at each far end that is inside the timeline
        if lo >= 0 then
            put(x(lo), x(lo) + BAND_LINE_W, r, g, b, 1, 2)
        end
        if hi <= length then
            put(x(hi) - BAND_LINE_W, x(hi), r, g, b, 1, 2)
        end
        local label = self.bandLabel
        local secs = math.floor(cd + 0.5)
        label:SetText(string.format(TEXT.bandLength, math.floor(secs / 60), secs % 60))
        if textWidth(label) + 2 * BAND_LABEL_PAD <= x(hi) - x(t) then
            label:ClearAllPoints()
            label:SetPoint("LEFT", self.track, "TOPLEFT", x(t) + BAND_LABEL_PAD, top - h / 2)
            label:Show()
            labelShown = true
        end
    end
    hideFrom(self.bandTex or {}, n + 1)
    if self.bandLabel and not labelShown then
        self.bandLabel:Hide()
    end
    return soon, cd and true or false
end

-- The selected flag's mark on what is drawn now, else nil.
function Methods:SelectedMark()
    local want = self.selected
    if want == nil then
        return nil
    end
    for _, m in ipairs(self.marks or {}) do
        if markKey(m) == want then
            return m
        end
    end
    return nil
end

-- Healer CDs draws every cast's bands (Timeline/HealerView.lua); the cast whose bands this view draws
-- itself (key: View.BandKey's, or nil for none) has its own hidden there, so they never draw twice.
function Methods:OwnBands(key)
    local HV = CRT.TimelineHealerView
    if HV and HV.HideBands then
        HV.HideBands(self, key)
    end
end

-- Outlines the selected flag and draws its bands (not while a drag draws its own). A selection whose alert
-- is no longer drawn is dropped.
function Methods:DrawSelection()
    local m = self:SelectedMark()
    if not m and self.selected ~= nil then
        self.selected = nil
    end
    for _, f in ipairs(self.flags) do
        local on = m ~= nil and f:IsShown() and f.mark == m
        for _, side in ipairs(f.sel or {}) do
            side:SetShown(on)
        end
        for _, side in ipairs(f.selIn or {}) do
            side:SetShown(on)
        end
    end
    if not ((self.move and self.move.moved) or (self.chipMove and self.chipMove.moved)) then
        local _, drawn = self:DrawBands(m and self:BandSpec(m))
        self:OwnBands(drawn and View.BandKey(m) or nil)
    end
end

-- Whether mark m (or a copy of it) is the selected one.
function Methods:IsSelected(m)
    return self.selected ~= nil and markKey(m) == self.selected
end

-- Selects the time of reminder m (by its encounter and id) drawn at shown seconds, when there is one.
function Methods:SelectReminderAt(m, shown)
    for _, o in ipairs(self.marks or {}) do
        if o.kind == "mine" and o.encounterID == m.encounterID and o.id == m.id and type(o.t) == "number"
            and math.abs(o.t - shown) <= SAME_MOMENT then
            self:Select(o)
            return
        end
    end
end

-- Selects mark m's flag (the only one selected).
function Methods:Select(m)
    self.selected = markKey(m)
    self:DrawSelection()
end

function Methods:ClearSelection()
    if self.selected == nil then
        return
    end
    self.selected = nil
    self:DrawSelection()
end

-- While the view shows it takes the keys, for Escape (clearing a selection) and Ctrl+Z and Ctrl+Y; every other
-- key goes on to the game. Never taken in combat, where letting keys through can't be changed.
function Methods:CatchKeys(on)
    local f = self.frame
    if not (f and f.EnableKeyboard) then
        return
    end
    if on then
        if self.keysOn or (InCombatLockdown and InCombatLockdown()) then
            return
        end
        if not self.keysHooked then
            self.keysHooked = true
            f:SetScript("OnKeyDown", function(_, key)
                self:KeyDown(key)
            end)
        end
        if f.SetPropagateKeyboardInput then
            f:SetPropagateKeyboardInput(true)
        end
        f:EnableKeyboard(true)
        self.keysOn = true
    elseif self.keysOn then
        f:EnableKeyboard(false)
        self.keysOn = false
    end
end

-- Whether a window Escape closes (UISpecialFrames) is shown, other than the one holding the view.
local function escapeWindowShown(view)
    local list = UISpecialFrames
    if type(list) ~= "table" then
        return false
    end
    for _, name in ipairs(list) do
        local w = type(name) == "string" and _G[name] or nil
        if type(w) == "table" and w.IsShown and w:IsShown() then
            local holds, p = false, view.frame
            while p do
                if p == w then
                    holds = true
                    break
                end
                p = p.GetParent and p:GetParent() or nil
            end
            if not holds then
                return true
            end
        end
    end
    return false
end

-- Escape cancels a drag-to-zoom selection that is being drawn, else clears the selected flag, and stops
-- there, unless a window Escape closes is shown (the alert editor): then it goes on to close it. Ctrl+Z
-- undoes the last change and Ctrl+Y or Ctrl+Shift+Z redoes it (Timeline/Undo.lua). Any other key passes through.
function Methods:KeyDown(key)
    local zs = self.zoomSel
    local zooming = key == "ESCAPE" and zs ~= nil and zs.started and not zs.cancelled
    local escape = key == "ESCAPE" and (self.selected ~= nil or zooming)
    local keep = escape and not escapeWindowShown(self)
    local ctrl = IsControlKeyDown and IsControlKeyDown()
    local undo = ctrl and key == "Z" and not (IsShiftKeyDown and IsShiftKeyDown())
    local redo = ctrl and (key == "Y" or (key == "Z" and not undo))
    local Undo = CRT.TimelineUndo
    if Undo and (undo or redo) then
        keep = true
    end
    local f = self.frame
    if f.SetPropagateKeyboardInput and not (InCombatLockdown and InCombatLockdown()) then
        f:SetPropagateKeyboardInput(not keep)
        -- a kept key passes keys on again at once (next frame), not only at the next key press
        if keep and C_Timer and C_Timer.After then
            C_Timer.After(0, function()
                if not (InCombatLockdown and InCombatLockdown()) then
                    f:SetPropagateKeyboardInput(true)
                end
            end)
        end
    end
    if zooming then
        self:CancelZoomSelect()
    elseif escape then
        self:ClearSelection()
    end
    if Undo and undo then
        Undo:Undo()
    elseif Undo and redo then
        Undo:Redo()
    end
end

-- The ghost chip that follows the cursor while a chip is dragged; above everything, taking no clicks.
function Methods:ChipGhost()
    local g = self.chipGhost
    if not g then
        g = CreateFrame("Frame", nil, UIParent)
        g:SetFrameStrata("TOOLTIP")
        chipParts(g)
        g:SetAlpha(0.85)
        g:Hide()
        self.chipGhost = g
    end
    return g
end

-- The dashed line on the track where a dragged chip would land, with its time beside it.
function Methods:DropLine()
    local d = self.dropLine
    if not d then
        d = CreateFrame("Frame", nil, self.track)
        d:SetWidth(2)
        d.labelBg = d:CreateTexture(nil, "BACKGROUND")
        themed(d.labelBg, "SetColorTexture", "surface", 0.85)
        d.label = d:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        d.labelBg:SetPoint("TOPLEFT", d.label, "TOPLEFT", -3, 2)
        d.labelBg:SetPoint("BOTTOMRIGHT", d.label, "BOTTOMRIGHT", 3, -2)
        d:Hide()
        self.dropLine = d
    end
    return d
end

-- Shows the dashed line at time t, its label at the cursor's height (y down from the track's top), kept
-- inside the visible part of the track. soon: the label says the drop would be too soon.
function Methods:DrawDropLine(t, y, soon)
    local d = self:DropLine()
    local length = math.max(1, self.extra.length or 0)
    local x = View.TimeToX(t, length, self.trackW)
    local height = math.max(1, self.track:GetHeight() or 1)
    d:ClearAllPoints()
    d:SetPoint("TOP", self.track, "TOPLEFT", x, 0)
    d:SetHeight(height)
    d:SetFrameLevel((self.track:GetFrameLevel() or 0) + 10)
    local n = math.ceil(height / (DASH + DASH_GAP))
    for i = 1, n do
        local dash = pooled(self.dashes, i, function()
            local tex = d:CreateTexture(nil, "OVERLAY")
            themed(tex, "SetColorTexture", "text", 0.85)
            tex:SetSize(2, DASH)
            return tex
        end)
        dash:ClearAllPoints()
        dash:SetPoint("TOP", d, "TOP", 0, -(i - 1) * (DASH + DASH_GAP))
    end
    hideFrom(self.dashes, n + 1)
    d.label:SetText(string.format(TEXT.placeAt, clock(t)) .. (soon and TEXT.tooSoon or ""))
    local w = d.label:GetStringWidth() or 0
    local left = self.hscroll:GetHorizontalScroll()
    local right = left + self:VisibleWidth()
    local lx = x + 4
    if lx + w > right - 3 then
        lx = x - w - 4
    end
    lx = math.max(left + 3, math.min(lx, right - w - 3))
    d.label:ClearAllPoints()
    d.label:SetPoint("BOTTOMLEFT", self.track, "TOPLEFT", lx, math.min(-FLAG_HEAD, -y + 6))
    d:Show()
end

-- A left button pressed on a chip: remember where, so the release can tell a click from a drag. A
-- template chip carries kind "saved" and its id; a cooldown chip kind "cooldown" and its cooldown.
function Methods:StartChipMove(c)
    local x, y = GetCursorPosition()
    if c.chipKind == "saved" and c.savedID then
        self.chipMove = { kind = "saved", id = c.savedID, chip = c, x0 = x, y0 = y }
    elseif c.chipKind == "cooldown" and c.cooldown then
        self.chipMove = { kind = "cooldown", cooldown = c.cooldown, chip = c, x0 = x, y0 = y }
    end
end

function Methods:CancelChipMove()
    local had = self.chipMove ~= nil
    self.chipMove = nil
    if self.chipGhost then
        self.chipGhost:Hide()
    end
    if self.dropLine then
        self.dropLine:Hide()
    end
    if had then
        self:DrawSelection() -- the drag's bands go; the selected flag's come back
    end
end

local function chipMoved(cm)
    local x, y = GetCursorPosition()
    return cm.moved or math.abs(x - cm.x0) >= MOVE_DIST or math.abs(y - cm.y0) >= MOVE_DIST
end

-- Fills the ghost for the chip held in cm, by its kind.
local function fillGhost(g, cm)
    if cm.kind == "cooldown" then
        fillCooldownChip(g, cm.cooldown)
    else
        local s = CRT.AlertSaved and CRT.AlertSaved:Get(cm.id)
        if s then
            fillChip(g, s)
        end
    end
end

-- While a chip is held: once moved MOVE_DIST pixels a ghost of it follows the cursor, and over the track
-- the dashed line shows where it would land.
function Methods:UpdateChipMove()
    local cm = self.chipMove
    if not IsMouseButtonDown("LeftButton") then
        self:FinishChipMove() -- the release went elsewhere
        return
    end
    if not chipMoved(cm) then
        return
    end
    local g = self:ChipGhost()
    if not cm.moved then
        -- filled once, as the drag starts; after that it only follows the cursor
        cm.moved = true
        fillGhost(g, cm)
    end
    local scale = UIParent:GetEffectiveScale() or 1
    local x, y = GetCursorPosition()
    g:ClearAllPoints()
    g:SetPoint("CENTER", UIParent, "BOTTOMLEFT", x / scale, y / scale)
    g:Show()
    if self.pull and overTrack(self) and not overEditor() then
        local tx, ty = cursorOnTrack(self)
        local t = self:TimeAtX(tx)
        local soon = self:DrawBands(self:ChipBands(cm, t, tx, ty))
        self:DrawDropLine(t, ty, soon)
    else
        self:DrawBands(nil)
        if self.dropLine then
            self.dropLine:Hide()
        end
    end
end

-- The left button let go of a chip. Not moved, it was a click and does nothing; released over the track,
-- the template or cooldown is placed there; anywhere else (or over the open alert editor), nothing.
function Methods:FinishChipMove()
    local cm = self.chipMove
    self:CancelChipMove()
    if not (cm and chipMoved(cm) and self.pull and overTrack(self)) or overEditor() then
        return
    end
    local x, y = cursorOnTrack(self)
    if cm.kind == "cooldown" then
        self:PlaceCooldown(cm.cooldown, self:TimeAtX(x), self:LaneAtY(y))
    else
        self:PlaceSaved(cm.id, self:TimeAtX(x), self:IconSpellAt(x, y), self:LaneAtY(y))
    end
end

-- Makes a new template from cooldown e: its name, spell and text, with the cooldown defaults a drop saves
-- with (Alerts/Draft.lua's Draft.CooldownTemplate: Text, read out). The cooldown itself is never changed.
function Methods:SaveCooldown(e)
    local Saved = CRT.AlertSaved
    if not (Saved and e) then
        return nil
    end
    local Draft = CRT.AlertDraft
    local fields = Draft and Draft.CooldownTemplate and Draft.CooldownTemplate() or {}
    fields.name, fields.spellID, fields.text = e.name, e.spellID, e.name
    return Saved:Save(nil, fields)
end

-- A chip's menu. A template: Edit, Rename, Delete. A cooldown: Save as template.
function Methods:ChipMenu(c)
    if c.chipKind == "cooldown" then
        local e = c.cooldown
        contextMenu(c, function(root)
            root:CreateTitle(e.name)
            root:CreateButton(TEXT.saveTemplate, function()
                self:SaveCooldown(e)
            end)
        end)
        return
    end
    local id = c.savedID
    local s = id and CRT.AlertSaved and CRT.AlertSaved:Get(id)
    if not s then
        return
    end
    contextMenu(c, function(root)
        root:CreateTitle(s.name or TEXT.unnamed)
        root:CreateButton(TEXT.edit, function()
            CRT.AlertEditor:EditSaved(id)
        end)
        root:CreateButton(TEXT.rename, function()
            askRename(id)
        end)
        root:CreateButton(TEXT.delete, function()
            askDelete(id)
        end)
    end)
end

-- The right button pressed on the track (or an icon or a flag on it): remember where and when, so its
-- release can tell a click (the menu) from a drag (which scrolls).
function Methods:RightDown(button)
    if button ~= "RightButton" then
        return
    end
    local x, y = GetCursorPosition()
    local tx, ty = cursorOnTrack(self)
    self.rightAt = { x = x, y = y, at = GetTime(), scroll = self.hscroll:GetHorizontalScroll(), tx = tx, ty = ty }
end

-- The right button let go: moved under MENU_DIST pixels and within MENU_TIME seconds, the press was a
-- click and opens the menu where it went down, putting back what it scrolled.
function Methods:RightUp(button, flag)
    if button ~= "RightButton" then
        return
    end
    local r = self.rightAt
    self.rightAt = nil
    if not (r and self.pull) then
        return
    end
    local scale = self.hscroll:GetEffectiveScale()
    local x, y = GetCursorPosition()
    if math.abs(x - r.x) / scale >= MENU_DIST or math.abs(y - r.y) / scale >= MENU_DIST or GetTime() - r.at > MENU_TIME then
        return
    end
    self:ScrollTo(r.scroll)
    if flag and flag.mark then
        self:FlagMenu(flag.mark, flag)
    else
        self:TrackMenu(r.tx, r.ty)
    end
end

-- A marker's menu: its text and time as the title, Edit (the double-click) and Delete. Alt+drag is the
-- way to add a time, so there is no Copy. A raid note line you may not change has View in place of
-- Edit (the editor opens it read-only) and no Delete.
function Methods:FlagMenu(m, owner)
    local title = tostring(m.text or "")
    title = title .. " \194\183 " .. CRT.AlertReminders.FormatTimes({ { ph = m.ph, t = m.time } })
    -- your own cast on Healer CDs moves for you only: its line is still the raid's to edit or delete
    local changeable = canChange(m) and not (m.hvOwn and not canEditRaid())
    contextMenu(owner, function(root)
        root:CreateTitle(title)
        root:CreateButton(changeable and TEXT.edit or TEXT.view, function()
            self:EditMark(m)
        end)
        if changeable then
            root:CreateButton(TEXT.delete, function()
                askDeleteMark(self, m)
            end)
        end
    end)
end

-- The track's menu at x, y on the track: its time and row as the title, New alert here (the double-click;
-- on a cast icon with that icon's spell), and Place, each template at that time (with the spell of a
-- cast icon there), then a Cooldowns submenu with the Cooldowns row's cooldowns.
function Methods:TrackMenu(x, y)
    local t = self:TimeAtX(x)
    local lane = self:LaneAtY(y)
    local title = clock(t)
    if lane and readable(lane.label) and type(lane.label) == "string" and lane.label ~= "" then
        title = title .. " \194\183 " .. lane.label
    end
    local spellID = self:IconSpellAt(x, y)
    contextMenu(self.hscroll, function(root)
        root:CreateTitle(title)
        root:CreateButton(TEXT.newHere, function()
            self:OpenAt(t, spellID)
        end)
        local place = root:CreateButton(TEXT.place)
        local list = CRT.AlertSaved and CRT.AlertSaved:List() or {}
        if #list == 0 then
            place:CreateTitle(TEXT.noSaved)
        end
        for _, e in ipairs(list) do
            place:CreateButton(e.s.name or TEXT.unnamed, function()
                self:PlaceSaved(e.id, t, spellID, lane)
            end)
        end
        -- the cooldowns the Cooldowns row lists now, placed as a drop there would be: each a submenu of
        -- who it is for when a drop would ask, else a button
        local cooldowns = place:CreateButton(TEXT.cooldowns)
        local cds = self:CooldownList()
        if #cds == 0 then
            cooldowns:CreateTitle(TEXT.noCooldowns)
        end
        local assigning = assigns(lane) and self:EncounterNumber() ~= nil
        local roster = assigning and #cds > 0 and self:AssignRoster() -- read once for every cooldown
        for _, e in ipairs(cds) do
            if assigning then
                self:AssignMenu(cooldowns:CreateButton(e.name), e, t, roster)
            else
                cooldowns:CreateButton(e.name, function()
                    self:PlaceCooldown(e, t, lane)
                end)
            end
        end
    end)
end

-- Draws the markers above the icons: raid note lines in the accent, your reminders in the text colour. A button
-- sits a level above every cast icon, so a flag over an icon is the one clicked. A cast on a Healer CDs
-- cooldown row (m.hvLane) is its icon alone, centred on its time in the middle of its row between its bands
-- (HealerView.CastW() square, no pole); every other marker is a flag at its row's top.
function Methods:DrawMarks(length)
    local level = (self.track:GetFrameLevel() or 0) + 8
    local HealerView = CRT.TimelineHealerView
    for n, m in ipairs(self.marks) do
        local f = self:Flag(n)
        f.mark = m
        self:FlagHighlight(f)
        f:ClearAllPoints()
        local x = View.TimeToX(m.t, length, self.trackW)
        local inline = m.hvLane ~= nil and HealerView ~= nil
        local w = inline and HealerView.CastW() or FLAG_BTN_W
        f:SetSize(w, w)
        f.icon:SetSize(w - 2, w - 2)
        f.pole:SetShown(not inline)
        if inline then
            f:SetPoint("CENTER", self.track, "TOPLEFT", x, -(m.row - 1) * ROW_H - ROW_H / 2)
        else
            f:SetPoint("TOPLEFT", self.track, "TOPLEFT", x - 1 - (FLAG_BTN_W - FLAG_W) / 2, -(m.row - 1) * ROW_H)
        end
        f:SetFrameLevel(level)
        local key = m.mine and "text" or "accent"
        f.pole:SetColorTexture(rgba(key))
        f.head:SetColorTexture(rgba(key))
        local icon = chipIcon(m) or (inline and m.hvLane.icon) or nil
        f.icon:SetTexture(icon)
        f.edge:SetColorTexture(rgba(key))
        if m.tooSoon then
            -- Healer CDs: cast while its cooldown from the cast before is still running, in the theme's bad colour
            local bad = CRT.PALETTE.bad or DEATH_RED
            f.edge:SetColorTexture(bad[1], bad[2], bad[3], 1)
            f.head:SetColorTexture(bad[1], bad[2], bad[3], 1)
        end
        f.icon:SetShown(icon ~= nil)
        f.edge:SetShown(icon ~= nil)
        f.head:SetShown(icon == nil)
    end
    hideFrom(self.flags, #self.marks + 1)
end

function Methods:Label(n)
    return pooled(self.labels, n, function()
        local l = CreateFrame("Button", nil, self.body)
        l.view = self -- for its tooltip's boss and difficulty
        l:SetSize(LABEL_W - 4, ROW_H)
        l.stripe = self.body:CreateTexture(nil, "BACKGROUND")
        l.stripe:SetColorTexture(rgba("text", 0.04))
        -- a boss mechanic's show tick: unticked, it goes to Ignored mechanics (Timeline:SetIgnored)
        l.check = CreateFrame("CheckButton", nil, l, "UICheckButtonTemplate")
        l.check:SetSize(18, 18)
        l.check:SetPoint("LEFT", l, "LEFT", 0, 0)
        l.check:SetScript("OnClick", function(b)
            if l.lane then
                CRT.Timeline:SetIgnored(self.encounterID, CRT.Timeline.IgnoreName(l.lane), not b:GetChecked())
            end
        end)
        l.check:SetScript("OnEnter", function(b)
            CRT.UI.TooltipOwner(GameTooltip, b, "ANCHOR_RIGHT", nil, nil, "timeline")
            GameTooltip:SetText(TEXT.showTip, 1, 1, 1, 1, true)
            GameTooltip:Show()
        end)
        l.check:SetScript("OnLeave", hideTip)
        -- labels are pooled as the view draws, after the page is skinned
        local UI = CRT.UI
        if UI and UI.SkinCheckButton then
            UI:SkinCheckButton(l.check)
        end
        l.icon = l:CreateTexture(nil, "ARTWORK")
        l.icon:SetSize(18, 18)
        l.icon:SetPoint("LEFT", l, "LEFT", 20, 0)
        l.text = l:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        l.text:SetPoint("LEFT", l, "LEFT", NAME_X, 0)
        l.text:SetPoint("RIGHT", l, "RIGHT", -2, 0)
        l.text:SetJustifyH("LEFT")
        l.text:SetWordWrap(false)
        -- the Journal's icons at the right end of the label, then one dot per extra type left of them
        -- (placed in Refresh, as how many icons a row has moves the dots)
        l.tagIcons = {}
        for t = 1, MAX_TAGS do
            local icon = l:CreateTexture(nil, "OVERLAY")
            icon:SetSize(TAG_SIZE, TAG_SIZE)
            icon:SetPoint("RIGHT", l, "RIGHT", -3 - (t - 1) * (TAG_SIZE + 1), 0)
            icon:Hide()
            l.tagIcons[t] = icon
        end
        l.dots = {}
        for d = 1, MAX_DOTS do
            local dot = l:CreateTexture(nil, "OVERLAY")
            dot:SetTexture(DOT)
            dot:SetSize(DOT_SIZE, DOT_SIZE)
            dot:SetPoint("RIGHT", l, "RIGHT", -4 - (d - 1) * (DOT_SIZE + 3), 0)
            dot:Hide()
            l.dots[d] = dot
        end
        l:SetScript("OnEnter", labelEnter)
        l:SetScript("OnLeave", hideTip)
        l:RegisterForClicks("RightButtonUp")
        l:SetScript("OnClick", function(b, button)
            if button == "RightButton" then
                self:LabelMenu(b)
            end
        end)
        return l
    end)
end

-- Developer builds with /crt dev open: right-click a boss mechanic's name for the Advanced tab's menu
-- (its type, tags, name, a row of its own, a Mech Alert) and Hide from the timeline, which ships.
-- Players get no menu here; the Advanced tab is theirs. On Healer CDs, a player's name or spell row opens the
-- menu that shows or hides their rows, for anyone (HealerView.LabelMenu).
function Methods:LabelMenu(l)
    local lane, Timeline, Menu = l.lane, CRT.Timeline, CRT.TimelineAbilityMenu
    local Healers = CRT.TimelineHealerView
    if self.mode == "healers" and Healers and Healers.LabelMenu(self, l, lane) then
        return
    end
    if not (lane and self.encounterID and Timeline.DevMode() and Timeline.Ignorable(lane) and Menu
        and MenuUtil and MenuUtil.CreateContextMenu) then
        return
    end
    local name = Timeline.IgnoreName(lane)
    View.OpenMenu(l, function(root)
        Menu.Fill(root, self.encounterID, { name = name, spellID = lane.spellID, tags = lane.tags }, name)
    end)
end

-- Ignored mechanics, under the lanes: a header row that opens and closes the list (saved as
-- timeline.ignoredOpen), then each ignored mechanic greyed with its tick off, and nothing on the track.
-- Returns how many lane labels it used after the first `after`.
function Methods:DrawIgnored(after, rows)
    local head = self.ignoredHead
    if rows == 0 then
        if head then
            head:Hide()
        end
        return 0
    end
    local s = settings()
    if not head then
        head = CreateFrame("Button", nil, self.body)
        head:SetSize(LABEL_W - 4, ROW_H)
        head.arrow = head:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        head.arrow:SetPoint("LEFT", head, "LEFT", 4, 0)
        head.text = head:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        head.text:SetPoint("LEFT", head, "LEFT", 20, 0)
        themed(head.text, "SetTextColor", "label")
        head.line = self.body:CreateTexture(nil, "ARTWORK")
        head.line:SetHeight(1)
        themed(head.line, "SetColorTexture", "accent", 0.6)
        head:SetScript("OnClick", function()
            CRT.Timeline:Set("ignoredOpen", not settings().ignoredOpen)
        end)
        self.ignoredHead = head
    end
    local y = -after * ROW_H
    head:ClearAllPoints()
    head:SetPoint("TOPLEFT", self.body, "TOPLEFT", 2, y)
    head.line:ClearAllPoints()
    head.line:SetPoint("TOPLEFT", self.body, "TOPLEFT", 0, y)
    head.line:SetPoint("TOPRIGHT", self.body, "TOPRIGHT", 0, y)
    head.arrow:SetText(s.ignoredOpen and "v" or ">")
    head.text:SetText(string.format(TEXT.ignoredHead, #self.ignoredLanes))
    head:Show()
    if not s.ignoredOpen then
        return 0
    end
    for i, lane in ipairs(self.ignoredLanes) do
        local ly = y - i * ROW_H
        local l = self:Label(after + i)
        l.lane = lane
        l:ClearAllPoints()
        l:SetPoint("TOPLEFT", self.body, "TOPLEFT", 2, ly)
        l.stripe:SetPoint("TOPLEFT", self.body, "TOPLEFT", 0, ly)
        l.stripe:SetPoint("BOTTOMRIGHT", self.body, "TOPRIGHT", 0, ly - ROW_H)
        l.stripe:SetColorTexture(rgba("text", 0.02))
        l.stripe:Show()
        for d = 1, MAX_DOTS do
            l.dots[d]:Hide()
        end
        for t = 1, MAX_TAGS do
            l.tagIcons[t]:Hide()
        end
        l.check:Show()
        l.check:SetChecked(false)
        l.icon:SetTexture(lane.icon)
        l.icon:SetDesaturated(true)
        l.icon:SetAlpha(0.6)
        l.text:SetPoint("RIGHT", l, "RIGHT", -2, 0)
        l.text:SetText(lane.label or "")
        l.text:SetTextColor(rgba("label"))
        l:Show()
    end
    return #self.ignoredLanes
end

-- The (?) on the Personal notes lane's label, just after its name: these are only yours and stay on
-- your PC. Hidden when no boss is shown.
function Methods:DrawPersonalHelp(lanes)
    local row
    for i, lane in ipairs(lanes) do
        if lane.kind == "personal" then
            row = i
        end
    end
    local l = row and self.labels[row]
    local h = self.personalHelp
    if not h then
        if not (l and CRT.UI and CRT.UI.HelpRight) then
            return
        end
        h = CRT.UI.HelpRight(l, TEXT.personal, TEXT.personalHelp, { parent = self.body })
        self.personalHelp = h
    end
    if not l then
        h:Hide()
        return
    end
    -- Its own place, not UI.HelpRight's (allowed in the "help icons sit right" lint): the lane moves
    -- as the rows scroll, and the (?) stays inside the label column, so a long name never puts it
    -- over the track. Its name's own width (a width set by the label's anchors caps GetStringWidth).
    local w = textWidth(l.text)
    local gap = CRT.UI.HELP_GAP or 4
    h:ClearAllPoints()
    -- the name starts NAME_X in (after the tick and the icon)
    h:SetPoint("LEFT", l, "LEFT", math.min(NAME_X + w + gap, LABEL_W - 4 - 24), 0)
    h:SetFrameLevel((l:GetFrameLevel() or 0) + 2)
    h:Show()
end

-- Draws the axis labels and grid lines across the whole track.
function Methods:DrawAxis(length, height)
    local n = 0
    for _, sec in ipairs(View.Ticks(length, settings().grid, self.trackW)) do
        n = n + 1
        local x = View.TimeToX(sec, length, self.trackW)
        local line = pooled(self.lines, n, function()
            local tex = self.track:CreateTexture(nil, "BACKGROUND")
            tex:SetWidth(1)
            themed(tex, "SetColorTexture", "accent", 0.25)
            return tex
        end)
        line:SetPoint("TOPLEFT", self.track, "TOPLEFT", x, 0)
        line:SetHeight(height)
        local tick = pooled(self.ticks, n, function()
            local tex = self.axis:CreateTexture(nil, "ARTWORK")
            tex:SetSize(1, 5)
            themed(tex, "SetColorTexture", "accent")
            return tex
        end)
        tick:SetPoint("BOTTOMLEFT", self.axis, "BOTTOMLEFT", x, 0)
        local text = pooled(self.texts, n, function()
            local fs = self.axis:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
            themed(fs, "SetTextColor", "label")
            return fs
        end)
        text:SetPoint("BOTTOMLEFT", self.axis, "BOTTOMLEFT", x + 3, 4)
        text:SetText(View.Format(sec))
    end
    hideFrom(self.lines, n + 1)
    hideFrom(self.ticks, n + 1)
    hideFrom(self.texts, n + 1)
end

-- A texture on the track from one of the pools, made in this layer and color the first time.
function Methods:Tex(list, n, layer, r, g, b, a)
    return pooled(list, n, function()
        local tex = self.track:CreateTexture(nil, layer)
        tex:SetColorTexture(r, g, b, a)
        return tex
    end)
end

-- Draws a 2 px red line over all the lanes for each phase, with its label on the axis just right
-- of it, above the time labels. The implied first phase at 0:00 gets no line. Returns how many rows
-- of labels it used (0 to PHASE_ROWS), which the axis makes room for.
function Methods:DrawPhases(phases, length, height)
    local n, rows, rowEnds = 0, 0, {}
    for i, phase in ipairs(phases or {}) do
        if type(phase.t) == "number" and phase.t > 0 and phase.t <= length then
            n = n + 1
            local x = View.TimeToX(phase.t, length, self.trackW)
            local line = self:Tex(self.phaseLines, n, "ARTWORK", DEATH_RED[1], DEATH_RED[2], DEATH_RED[3], 1)
            -- the line being dragged is the theme's heading colour, the others red (set every draw, since lines are pooled)
            local dragging = self.phaseDrag and (self.pull and self.pull.reference and self.pull.reference.phases[self.phaseDrag.index]) == phase
            if dragging then
                line:SetColorTexture(rgba("heading"))
            else
                line:SetColorTexture(DEATH_RED[1], DEATH_RED[2], DEATH_RED[3], 1)
            end
            line:ClearAllPoints()
            line:SetPoint("TOPLEFT", self.track, "TOPLEFT", x - 1, 0)
            line:SetSize(2, height)
            local text = pooled(self.phaseTexts, n, function()
                local fs = self.axis:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
                themed(fs, "SetTextColor", "label")
                return fs
            end)
            -- the part a chosen order put in this phase is added to the drawn label only: the alerts
            -- read a phase's number from phase.label, which stays as written
            local part = self.extra and self.extra.parts and self.extra.parts[i]
            -- a phase with its stage's name shows that ("Intermission: Ritual of Awakening"); its number
            -- (P1.5) stays in the reference text for the alerts
            local label = phase.title or phase.label
            if part then
                label = label and (label .. " \194\183 " .. part) or part
            end
            text:SetText(label or "")
            -- labels go in the first row they fit in without touching the one before, so close phase
            -- lines stagger; a third that fits nowhere goes back to the first row
            local row = 0
            if label then
                local w = text.GetStringWidth and text:GetStringWidth() or #label * 6
                while row < PHASE_ROWS and (rowEnds[row] or -math.huge) > x do
                    row = row + 1
                end
                if row == PHASE_ROWS then
                    row = 0
                end
                rowEnds[row] = x + 3 + w + 6
                rows = math.max(rows, row + 1)
            end
            text:ClearAllPoints()
            text:SetPoint("TOPLEFT", self.axis, "TOPLEFT", x + 3, -1 - row * PHASE_ROW_H)
        end
    end
    hideFrom(self.phaseLines, n + 1)
    hideFrom(self.phaseTexts, n + 1)
    return rows
end

-- Draws the line where the overlaid pull ended, or hides it when there is none: 3 px across every row, in
-- the theme's good colour for a kill, its bad colour for a wipe and its accent for a pull with no saved result
-- (self.extra.endResult), with a "Kill 4:12", "Wipe 4:12" or "End 4:12" tag at the bottom of the time axis,
-- painted through themed() so a theme switch repaints them. Both layouts draw it (Abilities and Healer CDs).
function Methods:DrawEndLine(t, length, height)
    if type(t) ~= "number" then
        if self.endLine then
            self.endLine:Hide()
            self.endTag:Hide()
        end
        return
    end
    if not self.endLine then
        self.endLine = self.track:CreateTexture(nil, "OVERLAY")
        local tag = CreateFrame("Frame", nil, self.axis)
        tag:SetFrameLevel((self.axis:GetFrameLevel() or 0) + 4)
        tag:SetHeight(14)
        tag.bg = tag:CreateTexture(nil, "BACKGROUND")
        tag.bg:SetAllPoints()
        themed(tag.bg, "SetColorTexture", "surface", 0.95)
        tag.text = tag:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        tag.text:SetPoint("CENTER")
        self.endTag = tag
    end
    local result = self.extra and self.extra.endResult
    local key = (result == "kill" and "good") or (result == "wipe" and "bad") or "accent"
    if not CRT.PALETTE[key] then
        key = "accent" -- a palette without the status colours (every theme has them)
    end
    local x = View.TimeToX(math.min(t, length), length, self.trackW)
    themed(self.endLine, "SetColorTexture", key)
    self.endLine:ClearAllPoints()
    self.endLine:SetPoint("TOPLEFT", self.track, "TOPLEFT", x - END_LINE_W / 2, 0)
    self.endLine:SetSize(END_LINE_W, height)
    self.endLine:Show()
    local tag = self.endTag
    themed(tag.text, "SetTextColor", key)
    tag.text:SetText(string.format((result == "kill" and TEXT.kill) or (result == "wipe" and TEXT.wipe) or TEXT.ended, View.Format(t)))
    tag:SetWidth((tag.text.GetStringWidth and tag.text:GetStringWidth() or 40) + 8)
    tag:ClearAllPoints()
    tag:SetPoint("BOTTOM", self.axis, "BOTTOMLEFT", x, 2)
    tag:Show()
end

-- A reference lane's bars (as long as each cast lasts) and lead lines (from the cast's start to
-- its icon), drawn behind the icons. Returns the new counts of bars and lead lines used.
function Methods:DrawPlan(lane, mid, length, bars, leads)
    local c = lane.color
    for _, mark in ipairs(lane.marks) do
        local x = View.TimeToX(mark.t, length, self.trackW)
        if type(mark.dur) == "number" and mark.dur > 0 and mark.t < length then
            bars = bars + 1
            local bar = self:Tex(self.bars, bars, "BORDER", 1, 1, 1, 1)
            if c then
                bar:SetColorTexture(c[1], c[2], c[3], BAR_ALPHA)
            else
                bar:SetColorTexture(rgba("accent", BAR_ALPHA))
            end
            bar:ClearAllPoints()
            bar:SetSize(math.max(1, View.TimeToX(math.min(mark.t + mark.dur, length), length, self.trackW) - x), DUR_H)
            bar:SetPoint("LEFT", self.track, "TOPLEFT", x, mid)
        end
        if type(lane.lead) == "number" and lane.lead > 0 and mark.t > 0 then
            leads = leads + 1
            local line = self:Tex(self.leads, leads, "BORDER", LEAD_GREEN[1], LEAD_GREEN[2], LEAD_GREEN[3], 1)
            local from = View.TimeToX(math.max(0, mark.t - lane.lead), length, self.trackW)
            line:ClearAllPoints()
            line:SetSize(math.max(1, x - from), 1)
            line:SetPoint("LEFT", self.track, "TOPLEFT", from, mid)
        end
    end
    return bars, leads
end

-- An overlaid pull's casts: small accent bars with no tooltip, since their spells are unknown.
-- Returns the new count of ticks used.
function Methods:DrawTicks(lane, mid, length, ticks)
    for _, mark in ipairs(lane.marks) do
        ticks = ticks + 1
        local tick = self:Tex(self.pullTicks, ticks, "ARTWORK", rgba("accent"))
        tick:ClearAllPoints()
        tick:SetSize(TICK_W, TICK_H)
        tick:SetPoint("CENTER", self.track, "TOPLEFT", View.TimeToX(mark.t, length, self.trackW), mid)
    end
    return ticks
end

-- The rows and marks of what is shown: the lanes, the deaths of unknown time, the ignored rows, the phases and
-- length, and the notes' and reminders' marks (collected before the lanes are drawn, since they may add the Notes
-- lane; Healer CDs adds its own rows under the ability rows, the cooldown lines on them). view.built says what
-- they were built for, so a relayout of the same data in the same layout (Refresh(true)) keeps them.
function Methods:BuildLanes()
    local s = settings()
    local pull = self.pull
    local extra
    if pull then
        local rows = CRT.TimelineJournal:Rows(self.encounterID)
        -- with your labels for Journal abilities (rows, types, names), without the hidden abilities, and
        -- your ignored mechanics apart, drawn only in their own list under the lanes (DrawIgnored)
        self.lanes, self.unknown, extra, self.ignoredLanes = CRT.TimelineLanes.AsShown(pull, rows, s, self.encounterID, self.overlay, self.group, self.order, REVIEW_LANES)
    else
        self.lanes, self.unknown, self.ignoredLanes = {}, {}, {}
    end
    self.extra = extra or { phases = {}, length = 0 }
    local length = pull and math.max(1, self.extra.length or 0) or 1
    local HealerView = pull and self.mode == "healers" and CRT.TimelineHealerView
    if HealerView then
        self.lanes, self.marks = HealerView.Build(self, self.lanes, length)
    else
        self.marks = self:Marks(self.lanes, length)
    end
    self.built = { pull = pull, mode = self.mode }
end

-- A size change (the pop-out's grip, the main window's) lays the view out again at most every View.RELAYOUT_GAP
-- seconds while the changes go on, and once after the last one: a drag of the grip never draws every frame, and
-- each layout runs once the game has sized every part (the lanes' window, the axis). A layout keeps the rows and
-- marks already built (Refresh(true)); only their sizes and places follow the new width and height.
function Methods:SizeChanged()
    if not (C_Timer and C_Timer.After and GetTime) then
        return self:Refresh(true)
    end
    if self.relayoutPending then
        return -- the layout waiting reads the size it has then
    end
    self.relayoutPending = true
    local wait = self.relayoutAt and math.max(0, self.relayoutAt + View.RELAYOUT_GAP - GetTime()) or 0
    C_Timer.After(wait, function()
        self.relayoutPending = false
        self.relayoutAt = GetTime()
        self:Refresh(true)
    end)
end

-- The view's height that shows every row with nothing to scroll up and down: the axis, the rows (and the
-- ignored list's), the scroll bar, Time unknown and the strip, as last drawn. The pop-out grows to it on
-- Healer CDs (Timeline/Page.lua).
function Methods:ContentHeight()
    local rows = #(self.lanes or {}) + (self.ignoredRows or 0)
    return (self.axisH or AXIS_H) + rows * ROW_H + self.stripH + UNKNOWN_H + BAR_H + 4
end

-- A deaths row's marks as drawn at this zoom: the deaths of one pull (one age) that would overlap, the next
-- closer than an icon's width (size, in pixels) to the first, share one mark, at the first's time, with every
-- death in time order in its deaths. Each pull keeps its own marks, so an older pull's stay apart, faded under
-- the shown one's. A death alone keeps its mark. The marks come back in the order the ages came in.
function View.StackDeaths(marks, length, trackW, size)
    local ages, byAge = {}, {}
    for i, mark in ipairs(marks) do
        local age = mark.age or 0
        if not byAge[age] then
            byAge[age] = {}
            ages[#ages + 1] = age
        end
        local list = byAge[age]
        list[#list + 1] = { mark = mark, i = i }
    end
    local out = {}
    for _, age in ipairs(ages) do
        local list = byAge[age]
        table.sort(list, function(a, b)
            if a.mark.t ~= b.mark.t then
                return a.mark.t < b.mark.t
            end
            return a.i < b.i
        end)
        local group, groupX
        for _, entry in ipairs(list) do
            local mark = entry.mark
            local x = View.TimeToX(mark.t, length, trackW)
            if group and group.death and mark.death and x - groupX < size then
                if not group.deaths then
                    local first = group
                    group = { t = first.t, spellID = first.spellID, death = first.death, deaths = { first.death }, age = first.age,
                        pull = first.pull, overlay = first.overlay, source = first.source }
                    out[#out] = group
                end
                group.deaths[#group.deaths + 1] = mark.death
            else
                group, groupX = mark, x
                out[#out + 1] = mark
            end
        end
    end
    return out
end

-- Draws what is shown. relayout: only the size changed, so the rows and marks built last are kept when they
-- were built for the same pull and layout (BuildLanes).
function Methods:Refresh(relayout)
    local s = settings()
    local pull = self.pull
    local built = self.built
    if not (relayout and built and built.pull == pull and built.mode == self.mode) then
        self:BuildLanes()
    end
    local lanes = self.lanes
    local width = self:VisibleWidth()
    local length = pull and math.max(1, self.extra.length or 0) or 1
    self.trackW = pull and math.max(1, length * width / clampSpan(s.span)) or 1
    local height = math.max(1, #lanes * ROW_H)
    local ignoredRows = #self.ignoredLanes > 0 and (1 + (s.ignoredOpen and #self.ignoredLanes or 0)) or 0
    self.ignoredRows = ignoredRows
    -- the track reaches at least the bottom of the window, so the empty space under the lanes takes
    -- a double-click too; when the lanes fit there is still nothing to scroll up and down
    local area = math.max(height + ignoredRows * ROW_H, self.vscroll:GetHeight() or 0)
    self.body:SetSize(math.max(1, self.vscroll:GetWidth() or 1), area)
    self.track:SetSize(self.trackW, area)
    self.axis:SetSize(self.trackW, self.axisH or AXIS_H)
    if self.hscroll.UpdateScrollChildRect then
        self.hscroll:UpdateScrollChildRect() -- so a zoom scroll right after is not cut to the old range
    end
    if pull then
        self:DrawAxis(length, height)
    else
        hideFrom(self.lines, 1)
        hideFrom(self.ticks, 1)
        hideFrom(self.texts, 1)
    end
    local phaseRows = self:DrawPhases(pull and self.extra.phases, length, height)
    -- the axis grows by a row for each row of phase labels, so they never cover the time labels
    local axisH = AXIS_H + phaseRows * PHASE_ROW_H
    if axisH ~= (self.axisH or AXIS_H) then
        self.axisH = axisH
        self.axisScroll:SetHeight(axisH)
        self.axis:SetSize(self.trackW, axisH)
        self.vscroll:SetPoint("TOPLEFT", self.vscroll:GetParent(), "TOPLEFT", 0, -axisH)
    end
    self:DrawEndLine(pull and self.extra.endLine, length, height)

    local size = s.iconSize or 22
    local used, bars, leads, ticks = 0, 0, 0, 0
    for i, lane in ipairs(lanes) do
        local y = -(i - 1) * ROW_H
        local l = self:Label(i)
        l.lane = lane
        l.check:SetShown(CRT.Timeline.Ignorable(lane))
        l.check:SetChecked(true)
        l.icon:SetDesaturated(false)
        l.icon:SetAlpha(1)
        l:SetPoint("TOPLEFT", self.body, "TOPLEFT", 2, y)
        l.stripe:SetPoint("TOPLEFT", self.body, "TOPLEFT", 0, y)
        l.stripe:SetPoint("BOTTOMRIGHT", self.body, "TOPRIGHT", 0, y - ROW_H)
        -- a reference row is tinted faintly in its type's color; other rows keep the alternate stripe
        local tint = lane.kind == "reference" and lane.color
        if lane.tint then -- a healer's block (Healer CDs), in the game's class colour with its own alpha
            l.stripe:SetColorTexture(lane.tint[1], lane.tint[2], lane.tint[3], lane.tint[4])
            tint = true
        elseif tint then
            l.stripe:SetColorTexture(tint[1], tint[2], tint[3], TINT_ALPHA)
        else
            l.stripe:SetColorTexture(rgba("text", 0.04))
        end
        l.stripe:SetShown(tint and true or i % 2 == 0)
        -- the extra types (after the first, which colors the row) as dots: types 2 up to MAX_DOTS + 1 in reading order, the leftmost dot being type 2
        local extras = lane.kind == "reference" and lane.types or {}
        local dotCount = math.min(MAX_DOTS, math.max(0, #extras - 1))
        local Reference = CRT.TimelineReference
        for d = 1, MAX_DOTS do
            local key = extras[dotCount - d + 2]
            local t = d <= dotCount and key and Reference and Reference.TYPES[key]
            if t then
                l.dots[d]:SetVertexColor(t.color[1], t.color[2], t.color[3])
                l.dots[d]:Show()
            else
                l.dots[d]:Hide()
            end
        end
        -- the Journal's icons, right to left in the Journal's order read from the right end
        local TAGS = Reference and Reference.TAGS
        local tagCount = 0
        for _, key in ipairs(lane.tags or {}) do
            local t = TAGS and TAGS[key]
            if t and tagCount < MAX_TAGS then
                tagCount = tagCount + 1
                local icon = l.tagIcons[tagCount]
                icon:SetAtlas(t.atlas)
                icon:Show()
            end
        end
        for t = tagCount + 1, MAX_TAGS do
            l.tagIcons[t]:Hide()
        end
        local tagW = tagCount > 0 and (tagCount * (TAG_SIZE + 1) + 3) or 0
        for d = 1, MAX_DOTS do
            l.dots[d]:ClearAllPoints()
            l.dots[d]:SetPoint("RIGHT", l, "RIGHT", -4 - tagW - (d - 1) * (DOT_SIZE + 3), 0)
        end
        l.text:SetPoint("RIGHT", l, "RIGHT", -2 - tagW - dotCount * (DOT_SIZE + 3), 0)
        local indent = lane.indent or 0 -- a healer's cooldown rows sit under their name row
        l.icon:SetPoint("LEFT", l, "LEFT", 20 + indent, 0)
        -- a healer's name row has no tick or icon: its name starts at the label's left edge, and the rows
        -- under it are indented from there
        l.text:SetPoint("LEFT", l, "LEFT", lane.kind == "healer" and 4 or (NAME_X + indent), 0)
        l.icon:SetTexture(lane.icon)
        l.text:SetText(lane.label or "")
        if lane.class then
            l.text:SetTextColor(CRT.Groups.ClassColor(lane.label, lane.class))
        elseif lane.color then
            l.text:SetTextColor(lane.color[1], lane.color[2], lane.color[3])
        elseif lane.kind == "ticks" then
            l.text:SetTextColor(rgba("label"))
        else
            l.text:SetTextColor(rgba("text"))
        end
        local mid = y - ROW_H / 2
        if lane.kind == "reference" then
            bars, leads = self:DrawPlan(lane, mid, length, bars, leads)
        end
        if lane.kind == "ticks" then
            ticks = self:DrawTicks(lane, mid, length, ticks)
        end
        -- older marks first, so the shown pull's deaths are drawn on top; ticks have no icons. Deaths of one
        -- pull that would overlap share one icon, so what it shows and its tooltip name the same deaths.
        local marks = lane.kind == "deaths" and View.StackDeaths(lane.marks, length, self.trackW, size) or lane.marks
        for m = #marks, lane.kind == "ticks" and #marks + 1 or 1, -1 do
            local mark = marks[m]
            used = used + 1
            local b = self:Icon(used)
            b.mark, b.lane = mark, lane
            b:SetSize(size, size)
            b:ClearAllPoints()
            b:SetPoint("CENTER", self.track, "TOPLEFT", View.TimeToX(mark.t, length, self.trackW), y - ROW_H / 2)
            b:SetFrameLevel((self.track:GetFrameLevel() or 0) + 5 - math.min(mark.age or 0, 4))
            local several = mark.deaths and #mark.deaths > 1
            b.count:SetText(several and tostring(#mark.deaths) or "")
            if mark.death then
                -- round: the spec or class icon in its class colour; several deaths have no one class, so the
                -- skull in the neutral death red, with their count
                View.DrawDeath(b, mark)
            else
                View.DrawSquare(b)
                local icon = mark.icon or lane.icon
                if lane.kind == "spell" and not icon then
                    local ok, tex = pcall(C_Spell.GetSpellTexture, mark.spellID)
                    icon = ok and tex or UNNAMED_ICON
                end
                b.tex:SetTexture(icon)
                b.bg:SetColorTexture(0, 0, 0)
            end
            -- earlier pulls fade by age; the floor keeps a fifth pull back visible
            b:SetAlpha(math.max(0.1, 1 - 0.25 * (mark.age or 0)))
        end
    end
    hideFrom(self.labels, #lanes + self:DrawIgnored(#lanes, ignoredRows) + 1)
    for i = #lanes + 1, #self.labels do
        self.labels[i].stripe:Hide()
    end
    self:DrawPersonalHelp(lanes)
    hideFrom(self.icons, used + 1)
    hideFrom(self.bars, bars + 1)
    hideFrom(self.leads, leads + 1)
    hideFrom(self.pullTicks, ticks + 1)

    local names = {}
    for _, death in ipairs(self.unknown) do
        names[#names + 1] = death.name or "Unknown"
    end
    self.unknownText:SetText(#names > 0 and ("Time unknown: " .. table.concat(names, ", ")) or "")
    self:DrawHighlight(lanes)
    self:DrawMarks(length)
    if CRT.TimelineHealerView then
        CRT.TimelineHealerView.Draw(self, length) -- Healer CDs' cooldown bands and hint, or none
    end
    self:DrawSelection()
    self:DrawStrip()
    self:ScrollTo(self.hscroll:GetHorizontalScroll())
    self:ClampLanes()
    self.drawLength, self.drawHeight = length, height
    self:DrawPlayhead()
end

-- The rehearsal's playhead -------------------------------------------------------------------------
-- While a rehearsal of the shown fight is open (Timeline/Page.lua), a gold line crosses the lanes at
-- its time, with the time on a tag at the bottom of the axis. Following (while it plays), the track
-- scrolls whenever the line leaves the view, putting it a third of the way across again.

-- t is the rehearsal's time, or nil to hide the line.
function Methods:SetPlayhead(t, follow)
    self.playT = type(t) == "number" and t or nil
    self.playFollow = follow and true or false
    self:DrawPlayhead()
end

function Methods:DrawPlayhead()
    local t = self.playT
    if not (t and self.pull and self.drawLength) then
        if self.playLine then
            self.playLine:Hide()
            self.playTag:Hide()
        end
        return
    end
    if not self.playLine then
        self.playLine = self.track:CreateTexture(nil, "OVERLAY")
        themed(self.playLine, "SetColorTexture", "heading", 0.9)
        local tag = CreateFrame("Frame", nil, self.axis)
        tag:SetFrameLevel((self.axis:GetFrameLevel() or 0) + 5)
        tag:SetHeight(14)
        tag.bg = tag:CreateTexture(nil, "BACKGROUND")
        tag.bg:SetAllPoints()
        themed(tag.bg, "SetColorTexture", "surface", 0.95)
        tag.text = tag:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        tag.text:SetPoint("CENTER")
        themed(tag.text, "SetTextColor", "heading")
        self.playTag = tag
    end
    local length = self.drawLength
    local x = View.TimeToX(math.max(0, math.min(t, length)), length, self.trackW)
    self.playLine:ClearAllPoints()
    self.playLine:SetPoint("TOPLEFT", self.track, "TOPLEFT", x - 1, 0)
    self.playLine:SetSize(2, self.drawHeight or 1)
    self.playLine:Show()
    local tag = self.playTag
    tag.text:SetText(View.Format(t))
    tag:SetWidth((tag.text.GetStringWidth and tag.text:GetStringWidth() or 30) + 8)
    tag:ClearAllPoints()
    tag:SetPoint("BOTTOM", self.axis, "BOTTOMLEFT", x, 2)
    tag:Show()
    if self.playFollow then
        local shown = self:VisibleWidth()
        local from = self.hscroll:GetHorizontalScroll() or 0
        if x < from or x > from + shown - 8 then
            self:ScrollTo(x - shown / 3)
        end
    end
end
