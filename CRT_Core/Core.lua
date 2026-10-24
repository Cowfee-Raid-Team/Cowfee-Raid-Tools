local ADDON, CRT = ...

_G.CRT = CRT
CRT.name = ADDON
-- The shipped textures' folder (CRT_Media/Media), for every file that loads one.
CRT.MEDIA = "Interface\\AddOns\\" .. ADDON .. "\\CRT_Media\\Media\\"
CRT.version = (C_AddOns and C_AddOns.GetAddOnMetadata and C_AddOns.GetAddOnMetadata(ADDON, "Version")) or "dev"

local defaults = {
    window = { point = "CENTER", x = 0, y = 0, scale = 100 }, -- the main panel; scale is a percent, 50 to 200
    -- The General Settings page. font is "default" (the game's own) or a name from CRT.FONTS, outline is
    -- "", "OUTLINE" or "THICKOUTLINE", fontSize the body text size in points (set the first time from
    -- textSize, the percent used before 0.17.2). bgAlpha is the main window's opacity in percent (30 to
    -- 100). An old profile may still hold style, a window style choice that is no longer read. layers holds a
    -- frame strata for each kind of window moved off its default (UI.LAYERS in UI/Panel.lua).
    -- soundChannel is the game sound channel every sound the addon plays goes through (CRT:PlaySound).
    -- theme is the look picked from the title bar (UI:SetTheme in UI/Panel.lua, CRT.THEME_LIST in Themes.lua);
    -- modern is kept in step with it: off for "blizzard" (Classic), on for the others. Data from before themes
    -- has no theme: CRT:ResolveTheme gives it one from modern before these defaults are filled in.
    -- hideRealms leaves realm names out of the Late Tracker and Tattlebot, on screen, in chat and in exports.
    -- tooltipMode is where the addon's tooltips open: "spot" next to what you hover, on tooltipSpot ("auto",
    -- each tooltip on its own side, or a key of UI.TOOLTIP_SPOTS), "game" the game's tooltip spot, "cursor"
    -- following the cursor (UI.TooltipOwner in UI/Tooltip.lua). They replaced tooltipAnchor, which is read
    -- once on load (below) and kept.
    ui = { font = "default", outline = "", textSize = 100, bgAlpha = 100, layers = {}, soundChannel = "Master", hideRealms = false, modern = false, theme = "blizzard", tooltipMode = "spot", tooltipSpot = "auto" },
    lastPage = "groups",
    -- The minimap button (UI/Minimap.lua): angle is its place around the minimap, in degrees.
    minimap = { hide = false, angle = 225 },
    classCache = {},
    roleCache = {},
    -- The macros the addon made in General Macros (Macros.lua): owned[setKey][name] = { body } for each one, so
    -- only those are ever edited or removed. Shared by every profile, like the game's macro list (Profiles.lua).
    -- Those it made in a character's macros are kept the same way in CRTDBChar.macros.owned.
    macros = { owned = {} },
    groups = {
        -- active is the id of the layout the raid runs with (Groups:Active), which the Late Tracker
        -- expects; selected is the layout being edited.
        presets = {},
        nextId = 1,
        keepChanges = true,
        source = "raid",
        working = {},
    },
    -- The consumables list ships in Consumables/Database.lua. Players choose the order
    -- (categoryOrder is the icon order, itemOrder[category] is which item is used first) and
    -- may add their own items. An older "categories" key from version 0.2.0 may remain in
    -- saved data and is ignored.
    consumables = {
        enabled = true,
        notStarter = false, -- true hides your bar on a ready check you started yourself
        lowMinutes = 10,
        categoryOrder = {},
        itemOrder = {},
        extra = {}, -- the player's own additions, { { item, name }, ... } per category
        learned = {}, -- buffs worked out from use, itemId -> spellId
        -- position = { point, relativePoint, x, y } is added when the bar is moved. Without it the
        -- bar sits above the ready check dialog.
    },
    -- The Ready Check page: the raid report of everyone's consumables and raid buffs. output is
    -- "self", "raid" or "officer". food is "any" or "best". flaskWarn is minutes, 0 for off.
    readycheck = {
        tab = "window",
        auto = true,
        onPull = false,
        output = "self",
        raidsOnly = true,
        notLFR = true,
        include = { food = true, flask = true, rune = true, vantus = false, buffs = true },
        buffLock = true, -- grey out your Ready button until everyone has your class's raid buff
        fadeOnPull = true, -- fade out your bar and the ready check window when a pull timer starts
        earlyPull = true, -- report who entered combat first when it happens before a pull timer ends
        earlyPullOutput = "self", -- where that report goes: "self", "raid" or "officer"
        food = "any", -- before 0.13.2: "best" counted only the best food. Ignored now.
        flaskWarn = 5,
        lowFlask = true,
        -- The ready check window. columns[key] shows that column, order is their left-to-right order.
        -- position is added when it is moved.
        window = {
            enabled = true,
            leadOnly = true, -- only open it for the raid leader and assistants
            seconds = 30,
            scale = 100, -- percent
            groupBuffsOnly = true, -- raid buff columns only for buffs your group can give
            order = {}, -- column keys left to right, filled in when a column is moved
            sort = "group", -- players by "group", "role" or "name"
            classBars = true, -- a class colored bar behind each player's row
            columns = {
                food = true, flask = true, rune = true, vantus = false,
                intellect = true, stamina = true, attack = true, versatility = true, mastery = true, movement = true,
                durability = true,
                weapon = true, -- weapon oil or stone, for players running the addon (0.13.2)
            },
        },
    },
    -- The debuff panel, shown in and out of combat while it is on. Every player has their own copy of
    -- these in their own saved variables, so nothing here is shared between players. position is
    -- added when it is moved. A new default reaches new players only: a saved value is never changed.
    debuffs = {
        enabled = true,
        size = 44, -- icon size in pixels
        maxCount = 4, -- how many to show at once
        dispelIcon = false, -- show the dispel type icon on each debuff
        dispelIconScale = 0.35, -- that icon's size, as a fraction of the debuff icon (0.2 to 1)
        maxDuration = 300, -- leave out debuffs longer than this many seconds; 0 shows every length
        privateSlots = false, -- also the game's boss debuff slots, as a second row (a fallback)
        -- The look: a dark frame, a big yellow countdown on the icon and outlined stacks (fonts,
        -- colors and sizes in CRT_Modules/Debuffs/Panel.lua's LOOK table).
        swipe = true, -- the muted dark swipe that grows over the icon as the debuff runs out
        swipeEdge = false, -- the bright line on the swipe's edge; off by default since 20261020-debuffs-swipe (a saved true stays)
        -- The timer: center (big, on the icon), below, above, left or right (smaller, beside it),
        -- numbers (the game's countdown numbers on the swipe instead) or hidden. A countdownNumbers
        -- key saved before 0.13.1 may remain and is ignored.
        timerPosition = "center",
        timerX = 0, -- nudges the timer text, in pixels
        timerY = 0,
        borderScale = 2, -- the frame is the icon plus 5 x this many pixels (half on each side), 0 to 6
        spacing = 4, -- pixels between two icons' borders, 0 to 20; the border's own width is added to it
        grow = "right", -- the row grows "right" (left to right) or "left" (right to left, from the panel's right end)
        dispelBorder = false, -- unused since the frame always takes the dispel color (20261020-debuffs-look); kept, as saved data only grows
        dispelGlow = false, -- a soft glow in the dispel color around a dispellable debuff's frame
        tooltips = false, -- the game's tooltip on hovering a debuff; off keeps the panel click-through
        -- Where those tooltips open (the "debuffs" area, UI/Tooltip.lua): "general" follows General Settings
        tooltipMode = "general",
        tooltipSpot = "auto",
        ignored = {}, -- your own debuffs to leave out, { [spellID] = true }, beside the built-in Debuffs.EXCLUDED_SPELLS
    },
    -- Raid notes. list[id] holds each imported or received note. window and alert hold the
    -- note window and personal alert settings, with position added when they are moved.
    notes = {
        list = {},
        nextId = 1,
        history = {}, -- each note's last 5 earlier texts, by note id (Notes/Data.lua); never shared or exported
        showOutsideRaid = false, -- true also shows the three note windows outside a raid instance
        trustedOnly = true, -- only accept shared notes from the raid leader or assistants
        shareTarget = "crt", -- Share's Send to: "crt", a note target's key (Integrations/), or "all"
        -- keepEmpty keeps a window up, blank at its own transparency, while it has nothing to show, so a
        -- note being cleared or shared doesn't make it vanish (Notes/Window.lua).
        window = { -- the timers
            shown = true,
            locked = true,
            keepEmpty = true,
            hidePassed = true,
            onlyMe = false, -- show only your lines: your name, role, raid group, everyone, or no tag
            fontSize = 14,
            alpha = 100, -- percent
            bgAlpha = 50, -- percent
            width = 420,
            height = 300,
            font = "Friz Quadrata",
        },
        assignments = { -- the note's text that is not a timer
            shown = true,
            locked = true,
            keepEmpty = true,
            fontSize = 14,
            alpha = 100,
            bgAlpha = 50,
            width = 360,
            height = 240,
            font = "Friz Quadrata",
        },
        personal = { -- your own personal note
            shown = true,
            locked = true,
            keepEmpty = true,
            fontSize = 14,
            alpha = 100,
            bgAlpha = 50,
            width = 300,
            height = 180,
            font = "Friz Quadrata",
        },
        personalText = "",
        editor = {}, -- the pop-out note editor's place and size once moved (Notes/EditorWindow.lua, UI.Window)
        -- The note callout (Notes/Alert.lua; "Note callout/assignments" on screen), set on Raid Notes > Alert
        -- Settings > Configuration. tts is also the switch for all speech (Alerts/Speech.lua).
        alert = {
            enabled = true,
            seconds = 10, -- show your note lines this many seconds early
            tts = true,
            ttsSeconds = 3, -- read it out at this many seconds left
            ttsVolume = 100,
            ttsRate = 0, -- -10 to 10, the game's speech rate
            iconPosition = "left", -- the spell icon: left, right, above or below the text
            font = "default", -- a CRT:FontList name, or "default": the addon's own font
            fontSize = 20,
            outline = "", -- "", "OUTLINE" or "THICKOUTLINE"
            align = "CENTER", -- the two lines: LEFT, CENTER or RIGHT
        },
    },
    -- Quality of Life options. lowHealth is the experimental low-health alert: threshold is the health
    -- percent at or under which the banner shows. position is added when the banner is moved.
    qol = {
        -- sound turns on the game's own low-health pulse (QoL/LowHealthSound.lua), soundVolume is its
        -- volume, and caaSaved holds the game settings it changed, to put back when it is turned off.
        -- soundChoice is "pulse" (the game's own) or a key of LowHealthSound.CHOICES, soundChannel is
        -- "game" (the game's own output) or a sound channel from CRT.SOUND_CHANNELS.
        -- soundOnce plays the sound one time, in full, each time your health drops under the threshold
        -- (off: it repeats). customSounds lists file names in the addon's Sounds folder that the player
        -- added. A soundLength key from a 0.14.0 test build may remain and is ignored.
        lowHealth = { enabled = false, threshold = 35, sound = false, soundVolume = 100, soundChoice = "pulse", soundChannel = "game", soundOnce = true, customSounds = {} },
        -- The break timer (QoL/BreakTimer.lua): endsAt (a time() value), total seconds and who started it
        -- while a break runs; position once the window is moved.
        breakTimer = {
            formats = {}, -- Also send to: format key -> false when unticked (Integrations/Breaks.lua)
            bridge = false, -- the raid leader's CRT passes a break on in the formats it didn't come in
        },
    },
    -- Loot History's settings (the records are in CRTLootDB, Loot/Store.lua): minQuality (3 rare, 4 epic,
    -- 5 legendary), dungeons (record dungeon bosses too), keepMonths (0 keeps everything), rcEnrich
    -- (match RCLootCouncil's awards, read only).
    loot = {
        minQuality = 4,
        dungeons = false,
        keepMonths = 12,
        rcEnrich = true,
        -- Tooltip position on the Loot History page (UI/Tooltip.lua): "general" (General Settings'), "spot",
        -- "game" or "cursor", and its own spot; personal. They replaced tooltipPosition, read once (below).
        tooltipMode = "general",
        tooltipSpot = "auto",
    },
    -- Loot Master (LootMaster/): window and popup, where the looter window and the raider popup were
    -- last placed (UI.Window keeps point, x, y, and the window's width and height); responseSeconds,
    -- how long raiders have to answer; score, the Raider Score weights (LootMaster/Score.lua);
    -- awardMessage (%i item, %p player, %r roll type or response, %v roll), awardChannel (RAID,
    -- RAID_WARNING, PARTY, GUILD, OFFICER, CHANNEL:<name>, SELF or NONE) and noRoll (what %v says
    -- without a roll). The response buttons are saved in lootmaster.responses only once edited, so they
    -- are not a default here (copyDefaults would refill a deleted button).
    lootmaster = {
        window = {},
        popup = {},
        answers = {}, -- the raider window's place and size
        bossLoot = {}, -- the leader's Boss loot window's place and size
        lootingPrompt = {}, -- the place of the leader's "Use CRT Looting in this instance?" (its on state is per character, CRTDBChar.lootmaster.looting)
        responseSeconds = 60,
        score = { show = true, late = 5, per10 = 1, noShow = 15, recover = 5, weeks = 8 },
        awardMessage = "%i awarded to %p for %r with a %v roll.",
        awardChannel = "RAID",
        noRoll = "-",
        -- Tooltip position for every Loot Master tooltip: "general" (General Settings'), "spot", "game" or
        -- "cursor" (UI/Tooltip.lua), and its own spot; itemTooltip, the item tabs': "area" (the same), a side
        -- of the window or "game" (LM.TOOLTIP_ANCHORS). All personal, not synced. itemTooltip replaced
        -- tooltipAnchor, and tooltipMode tooltipPosition; each old field is read once on load (below) and kept.
        tooltipMode = "general",
        tooltipSpot = "auto",
        itemTooltip = "area",
        showAllItems = false, -- this raider sees every item anyway
        enableInParty = false, -- CRT Looting also in a party group, not only a raid (LootMaster/Looting.lua)
        authority = { leader = true, names = {} }, -- who may run loot (the raid leader's list is the one raiders trust)
        sort = {}, -- the looter list's and Raider Score's chosen column and direction
        -- the loot filter: which items open a session (LootMaster/Filter.lua): where it dropped, the lowest
        -- quality (4 Epic) and item level (0 any), and the kinds of items
        filter = {
            boss = true, trash = false, quality = 4, ilvl = 0,
            kinds = { bop = true, tier = true, boe = false, wue = false, toy = false, mount = false, cosmetic = false, other = false },
        },
    },
    -- Gear Checker (GearChecker/): filter, the chip picked on the page (all, issues, gems, enchants,
    -- check:<key>, below); belowTrack, the upgrade track the Below chip lists items under (a key of the
    -- season's Tracks.lua; one the season doesn't have falls back to the season's default); popout, the
    -- pop-out window's place and size once moved (UI.Window keeps point, x, y, width, height).
    gearChecker = {
        filter = "all",
        belowTrack = "hero",
        popout = {},
    },
    -- The sound engine (Sound/Engine.lua): custom, your own sound file names typed on Quality of Life >
    -- Sounds (the companion addon CowfeeRaidTools_Media lists more in its Sounds.lua).
    sound = {
        custom = {},
    },
    -- The late tracker. days[wday] is true for raid days (1 is Sunday, as date() counts them), and
    -- hour and minute are the start on this computer's clock. Who is expected is the active Raid
    -- Groups layout (Groups:Active); layoutId, its old pick, is read once to set that. current is the
    -- running night, history the finished ones.
    late = {
        days = {},
        hour = 20,
        minute = 0,
        grace = 0, -- minutes after the start before someone counts as late
        history = {},
        nextId = 1,
        lastAuto = "", -- the day the schedule last started (or skipped) a night
    },
    -- Tattlebot. After each boss pull it reads the game's damage meter for the spells in
    -- Tattlebot/Database.lua. current is tonight, { id, startedAt, lastAt, pulls }, and each pull has
    -- players[key] = { class, spells = { [spellID] = damage } }. history holds the finished nights.
    -- output is "self", "raid" or "officer". maxPlayers is no longer used: chat posts list every
    -- player, on more lines when needed. Each pull keeps every spell's damage (pull.all), and the
    -- reports pick out the tracked ones.
    -- onlyTeam: Only record team raids (Team.lua); each night and pull is stamped team, and data from before counts
    -- as team raids.
    tattle = {
        enabled = true,
        raidsOnly = true,
        onlyTeam = true,
        avoidable = false, -- also count what the game's meter marks as avoidable damage
        autoPost = false, -- post each pull's report when it is read (to chat only for the raid leader)
        output = "self",
        maxPlayers = 10,
        custom = {}, -- the player's own tracked spells, [spellID] = mechanic name ("" for the spell's name)
        season = "Season 1", -- the season new nights are filed under, for the History filter
        history = {},
        nextId = 1,
    },
    -- Timeline. Boss pulls recorded for the Timeline page (Timeline/Data.lua). bosses[encounterID] =
    -- { name, pulls = { newest last }, counts = { nh = N, mythic = N } }, and each pull has the boss casts
    -- and the deaths in seconds from the pull start, its id (the store's key, unique across bosses) and its
    -- number (its count on its boss and difficulty group from 1, shown as "Pull N"; counts holds the last
    -- number given per group). rows[encounterID] holds the player's hidden and added spell rows.
    timeline = {
        record = true,
        minPull = 15, -- seconds; shorter pulls are not kept
        keep = 10, -- pulls kept per boss per difficulty
        bosses = {},
        rows = {}, -- [encounterID] = { hidden = { [spellID] = true }, custom = { spellID, ... } }
        span = 300, -- seconds visible
        grid = "auto", -- seconds between axis labels, or "auto" by the zoom (View.Ticks)
        iconSize = 22,
        deathRows = "combined", -- or "player"
        roles = { TANK = true, HEALER = true, DAMAGER = true },
        firstDeaths = 0, -- show only the first N deaths, 0 for all
        overlay = 3, -- how many pulls the death overlay covers
        overlayOn = false, -- draw the deaths of recent pulls over the shown one
        hideEmpty = false, -- hide rows that have no casts in the shown pull
        -- Tooltip position for every Timeline tooltip, docked or popped out: "general" (General Settings'),
        -- "spot", "game" or "cursor" (UI/Tooltip.lua), and its own spot; personal.
        tooltipMode = "general",
        tooltipSpot = "auto",
        -- The pop-out window (Timeline/Page.lua): its size, and its position once it is moved.
        popout = { width = 1200, height = 600 },
        references = {}, -- the player's own reference timelines, { id, text, saved } (saved: time() of the last change, optional; Timeline/Reference.lua)
        nextRef = 1,
        nextId = 1,
        -- the ability timeline In use per boss and difficulty, picked on the Advanced tab:
        -- [encounterID] = { nh = key, mythic = key } (Timeline:ChosenReference; none: the group's first, yours first)
        reviewRefs = {},
    },
    -- The team raid check (Team.lua): threshold is the share of the raid's online members that must run CRT for a
    -- team raid, 0.5 to 1 (General Settings shows it as 50% to 100%). A setting: shared in Export settings only.
    team = { threshold = 0.75 },
    -- Season Stats (SeasonStats/Data.lua): the raid's own counters per boss and difficulty group, counted from each
    -- pull the Timeline saves. bosses[encounterID] = { name, nh = counters, mythic = counters }; filled is true once
    -- they were filled from the Timeline's saved pulls. Data only: never in Export settings only. boss[group] counts team
    -- raids and boss.all[group] every raid; scoped is true once the counters from before were copied into all (they
    -- count as both), and show is the page's Show, "team" or "all".
    seasonStats = {
        filled = false,
        scoped = false,
        show = "team",
        bosses = {},
    },
    -- Alerts. Reminders, phase events and bar settings for the alerts engine (Alerts/Engine.lua).
    -- reminders are the player's own timed reminders, phases the phase events they set up, overrides
    -- their changes to shared packs, and nextId numbers them. The bars window position is added when moved.
    -- areas are the icon, text, circle and timeline areas' settings (Alerts/Areas.lua); position is added when moved.
    -- Marker displays (Markers/Display.lua): disabled[encounterID] is true for a boss whose display
    -- you turned off on the Reminders tab; position is added when the window is moved.
    markers = { disabled = {} },
    -- Pace (Pace/): own[encounterID] is your own plan, used in place of the shipped one;
    -- disabled[encounterID] turns a boss's pace window off; shown turns the window off everywhere;
    -- shared[encounterID] is the raid's plan, shared by the raid leader or an assistant (Pace/Comm.lua),
    -- and use[encounterID] = "own" uses your own plan in place of it.
    pace = { disabled = {}, own = {}, shared = {}, use = {}, shown = true },
    alerts = {
        bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20, spacing = 4, border = "none", font = "Friz Quadrata", fontSize = 13,
            barColor = { 0.44, 0.31, 0.22, 1 }, bgColor = { 0, 0, 0, 0.6 }, textColor = { 0.95, 0.90, 0.84, 1 }, showType = true }, -- saved, the player's to change: not a theme colour
        areas = {
            icons = { shown = true, cap = 5, size = 44, font = "Friz Quadrata", fontSize = 20, outline = "OUTLINE", grow = "down", showText = true, fade = true },
            texts = { shown = true, cap = 3, font = "Friz Quadrata", fontSize = 36, outline = "THICKOUTLINE", grow = "down", align = "CENTER" },
            circles = { shown = true, cap = 3, size = 64, thickness = "medium", ringColor = { 1, 1, 1, 0.9 }, font = "Friz Quadrata", fontSize = 16, grow = "right" },
            -- the timeline (Alerts/TimelineArea.lua): ticks is a list of seconds as text ("3,5"), so an empty list
            -- stays empty; lineColor is added only when picked (the theme's accent until then). gameMode
            -- ("standalone", "add" or "replace") and gameAlsoHere are the game's boss timeline (Alerts/GameTimeline.lua)
            timeline = { shown = true, cap = 5, direction = "down", side = "right", length = 300, seconds = 10, size = 32, thickness = 2,
                showNames = true, showCountdown = true, tenths = 0, badges = true, ticks = "5", nowEffect = "flash", nowText = "NOW!",
                nowTime = 1, stack = true, font = "Friz Quadrata", fontSize = 14,
                gameMode = "standalone", gameAlsoHere = false },
        },
        -- Where the player's own note lines without show: also display (the note callout, Bar and speech
        -- keep their own switches); off until chosen.
        noteLines = { text = false, icon = false, circle = false, timeline = false },
        -- Use custom colours (Raid Notes > Alerts): off, every alert is in its ability type's colour and your own
        -- colours (the areas', your reminders') stay saved but unused. A raid note's colour always shows.
        customColors = false,
        speechNotice = false, -- the one-time "your note lines are now read out" line has been shown
        reminders = {},
        phases = {},
        overrides = {},
        nextId = 1,
        -- Saved alerts (Alerts/Saved.lua): one alert's setup without its time, numbered by nextSavedId.
        saved = {},
        nextSavedId = 1,
        -- The Timeline's Cooldowns row (Alerts/Cooldowns.lua): which cooldowns it lists.
        cooldownFilter = "mine",
    },
    -- The settings as they were before the last settings-only import (Profiles:ApplySettings in Profiles.lua):
    -- { from, saved, values = { [path] = value }, unset = { [path] = true } }, empty when there is none.
    -- Each profile keeps its own. Undo last import puts it back and empties it.
    importBackup = {},
    -- What's new (WhatsNew/WhatsNew.lua): show is Show after updates; seen, the last version whose window was
    -- closed (or that had nothing to show), is saved only once known, so it has no default; window is the
    -- window's place once moved. Account-wide (Profiles.lua's SHARED), never in Export settings only.
    whatsNew = { show = true, window = {} },
}

-- Profiles.lua reads these to know which keys a profile holds and to start a profile afresh.
CRT.defaults = defaults

local function copyDefaults(src, dst)
    for k, v in pairs(src) do
        if type(v) == "table" then
            if type(dst[k]) ~= "table" then
                dst[k] = {}
            end
            copyDefaults(v, dst[k])
        elseif dst[k] == nil then
            dst[k] = v
        end
    end
end

-- The fonts the addon offers: on the General Settings page for all its text, and for each note window.
-- These four ship with the game. CRT:FontList adds the fonts other addons share through
-- LibSharedMedia-3.0, when one of them has loaded it. Cowfee Raid Tools does not ship the library.
CRT.FONTS = {
    { name = "Friz Quadrata", path = "Fonts\\FRIZQT__.TTF" },
    { name = "Arial Narrow", path = "Fonts\\ARIALN.TTF" },
    { name = "Morpheus", path = "Fonts\\MORPHEUS.TTF" },
    { name = "Skurri", path = "Fonts\\SKURRI.TTF" },
}

-- LibSharedMedia-3.0, if another addon loaded it. Its documented calls are List(mediatype) and
-- Fetch(mediatype, key, noDefault), with the media type "font".
local function sharedMedia()
    if not LibStub then
        return nil
    end
    local ok, lib = pcall(LibStub.GetLibrary, LibStub, "LibSharedMedia-3.0", true)
    return ok and lib or nil
end

local function samePath(path)
    return ((path or ""):lower():gsub("/", "\\"))
end

-- Every font to choose from: { name, path, shared }. The game's four first, then the shared ones in
-- LibSharedMedia's sorted order, leaving out any that is the same file as one already listed.
function CRT:FontList()
    local out, seen, names = {}, {}, {}
    for _, font in ipairs(self.FONTS) do
        out[#out + 1] = { name = font.name, path = font.path }
        seen[samePath(font.path)] = true
        names[font.name] = true
    end
    local lib = sharedMedia()
    if lib then
        local ok, list = pcall(lib.List, lib, "font")
        if ok and type(list) == "table" then
            for _, name in ipairs(list) do
                local okPath, path = pcall(lib.Fetch, lib, "font", name, true)
                if okPath and type(path) == "string" and not seen[samePath(path)] and not names[name] then
                    out[#out + 1] = { name = name, path = path, shared = true }
                    seen[samePath(path)] = true
                    names[name] = true
                end
            end
        end
    end
    return out
end

-- The file for a font name, or nil for "default" or a shared font that is no longer loaded.
function CRT:FontPath(name)
    if not name or name == "default" then
        return nil
    end
    for _, font in ipairs(self:FontList()) do
        if font.name == name then
            return font.path
        end
    end
    return nil
end

-- The Modern colours are CRT.PALETTE, the theme in use (Themes.lua). UI/Panel.lua paints the windows with
-- them and CRT:ApplyFonts colours the text.
-- The Modern look's font, when the font setting is the default.
CRT.MODERN_FONT = "Fonts\\ARIALN.TTF"

-- Shared font objects: Blizzard's fonts scaled up so every label, button and list is easier to read.
-- Every text the addon draws uses one of these, so CRT:ApplyFonts changes all of it at once.
CRT.FONT_SCALE = 1.2
local fonts = {} -- { object, path, size, flags }: each font object and the game font it started as

-- minSize, when given, is the smallest it is ever drawn, whatever the text size setting (a small font that
-- must stay readable). outline, when given ("OUTLINE"), replaces the source's flags: an outlined font keeps
-- its outline unless the General Settings outline picks another.
local function makeFont(name, source, scale, minSize, outline)
    local font = CreateFont(name)
    font:CopyFontObject(source)
    local path, size, flags = font:GetFont()
    flags = outline or flags
    size = math.max(minSize or 0, math.floor(size * (scale or CRT.FONT_SCALE) + 0.5))
    -- SetFont's third argument is no longer optional (12.0.5), so pass "" when there are no flags.
    font:SetFont(path, size, flags or "")
    local r, g, b = font:GetTextColor()
    fonts[#fonts + 1] = { object = font, path = path, size = size, flags = flags or "", color = { r, g, b }, min = minSize }
    return font
end

-- Applies the General Settings page's font, outline and text size to every shared font. Text drawn
-- with them changes straight away.
function CRT:ApplyFonts()
    local s = self.db and self.db.ui
    if not s then
        return
    end
    -- Text size is fontSize, the body text size in points (8 to 22); headings and small text keep
    -- their sizes relative to it. Before 0.17.2 it was textSize, a percent, which becomes the nearest
    -- point size the first time.
    if not s.fontSize then
        s.fontSize = math.max(8, math.min(22, math.floor(self.BODY_SIZE * (s.textSize or 100) / 100 + 0.5)))
    end
    local factor = s.fontSize / self.BODY_SIZE
    local modern = s.modern
    -- Arial Narrow is drawn smaller than the game's font at the same size, so Modern sizes it up a step.
    local modernDefault = modern and not self:FontPath(s.font)
    for _, f in ipairs(fonts) do
        local path = self:FontPath(s.font) or (modern and self.MODERN_FONT) or f.path
        local flags = s.outline or ""
        if flags == "" then
            flags = f.flags
        end
        local size = f.size * factor * (modernDefault and 1.1 or 1)
        f.object:SetFont(path, math.max(f.min or 0, math.floor(size + 0.5)), flags)
        -- Modern: the game's gold text turns the label colour and its white text the text colour; grey stays grey.
        local r, g, b = f.color[1], f.color[2], f.color[3]
        if modern and r and r > 0.9 then
            local c = (g > 0.9 and b > 0.9) and self.PALETTE.text or (b < 0.2 and self.PALETTE.label) or nil
            if c then
                r, g, b = c[1], c[2], c[3]
            end
        end
        if r then
            f.object:SetTextColor(r, g, b)
        end
    end
    -- The note windows keep their own font objects, so they redraw with the new font and outline.
    if self.Notes and self.Notes.Fire and self.ready then
        self.Notes:Fire()
    end
    -- Skinned controls size themselves from their text (header buttons), so they measure again.
    local UI = self.UI
    if UI and UI.skinned then
        local modern = UI:IsModern()
        for _, control in ipairs(UI.skinned) do
            control.crtSkin(modern)
        end
    end
end

-- Sets the font for everything the addon draws, the note windows included, from the General Settings
-- page after its confirmation box. Each note window can still be given its own font afterwards.
function CRT:SetAddonFont(name)
    self.db.ui.font = name
    local notes = self.db.notes
    for _, key in ipairs({ "window", "assignments", "personal" }) do
        if type(notes[key]) == "table" then
            notes[key].font = name
        end
    end
    self:ApplyFonts()
end

makeFont("CRTFontNormal", GameFontNormal)
-- The body text size in points at the default text size: the game's normal font scaled up.
CRT.BODY_SIZE = fonts[1].size
makeFont("CRTFontHighlight", GameFontHighlight)
makeFont("CRTFontDisable", GameFontDisable)
makeFont("CRTFontSmall", GameFontHighlightSmall)
makeFont("CRTFontDisableSmall", GameFontDisableSmall)
-- a step under the small text, for fine print such as the Raid Notes note's details
makeFont("CRTFontDisableTiny", GameFontDisableSmall, CRT.FONT_SCALE * 0.85)
makeFont("CRTFontLarge", GameFontNormalLarge)
-- the large font outlined, for text drawn over a coloured bar in any theme (the break timer)
makeFont("CRTFontLargeOutline", GameFontNormalLarge, nil, nil, "OUTLINE")
-- The game's own sizes, unscaled, for the small title-bar and page buttons, the standard buttons,
-- the dropdown and slider text, and the edit boxes. They follow the General Settings font too.
makeFont("CRTFontButtonSmall", GameFontNormalSmall, 1)
makeFont("CRTFontButtonSmallHighlight", GameFontHighlightSmall, 1)
makeFont("CRTFontButtonSmallDisable", GameFontDisableSmall, 1)
makeFont("CRTFontStandard", GameFontNormal, 1)
makeFont("CRTFontStandardHighlight", GameFontHighlight, 1)
makeFont("CRTFontStandardDisable", GameFontDisable, 1)
makeFont("CRTFontEdit", ChatFontNormal, 1)
-- the raid note's text: smaller, so more of a note line fits without wrapping, but never under 10 points
makeFont("CRTFontEditSmall", ChatFontNormal, 0.8, 10)

-- The game's sound channels a sound can play through, for the General Settings page.
CRT.SOUND_CHANNELS = {
    { key = "Master", label = "Master" },
    { key = "SFX", label = "Sound effects" },
    { key = "Dialog", label = "Dialog" },
    { key = "Ambience", label = "Ambience" },
    { key = "Music", label = "Music" },
    { key = "Talking Head", label = "Talking head" },
}

-- Plays a sound kit through the channel chosen on the General Settings page, through the sound engine
-- (Sound/Engine.lua). Kept for older callers; new code calls CRT.Sound:Play. Returns the handle.
function CRT:PlaySound(kit)
    if CRT.Sound then
        return (CRT.Sound:Play("kit:" .. tostring(kit)))
    end
    local channel = (self.db and self.db.ui and self.db.ui.soundChannel) or "Master"
    local ok, willPlay, handle = pcall(PlaySound, kit, channel)
    if ok and willPlay then
        return handle
    end
    return nil
end

function CRT:Print(msg)
    print("|cffc8a050Cowfee Raid Tools|r: " .. tostring(msg))
end

-- Before the defaults, once: Tooltip position moved to tooltipMode and tooltipSpot (UI/Tooltip.lua). General
-- Settings' old ui.tooltipAnchor: "game" stays the game's spot, anything else is next to what you hover on
-- the default spot, auto (each tooltip on its own side, as before). An area's old tooltipPosition (Loot
-- History in loot, Loot Master in lootmaster): "owner" becomes "spot", "general", "game" and "cursor" stay.
-- The old fields are kept as they were, and never read again once the new one is saved.
function CRT.ReadOldTooltipSettings(db)
    local ui = db.ui
    if type(ui) == "table" and ui.tooltipMode == nil and type(ui.tooltipAnchor) == "string" then
        ui.tooltipMode = ui.tooltipAnchor == "game" and "game" or "spot"
    end
    local area = { owner = "spot", general = "general", game = "game", cursor = "cursor" }
    for _, key in ipairs({ "loot", "lootmaster" }) do
        local t = db[key]
        if type(t) == "table" and t.tooltipMode == nil and area[t.tooltipPosition] then
            t.tooltipMode = area[t.tooltipPosition]
        end
    end
end

-- The note callout's size and outline are new settings (notes.alert.fontSize, outline); before them it was drawn
-- in the addon's large font. A save from before, one with a notes.alert but no fontSize, keeps that look, once:
-- CalloutNeedsLook(db), read before the defaults fill in 20, says so, and SeedCalloutLook(db), after
-- CRT:ApplyFonts has sized the large font to the text size, copies its size and General Settings' outline. A new
-- install takes the defaults.
local CALLOUT_OUTLINES = { [""] = true, OUTLINE = true, THICKOUTLINE = true }
local CALLOUT_MIN, CALLOUT_MAX = 10, 60 -- Notes/Alert.lua's Size range

function CRT.CalloutNeedsLook(db)
    local notes = db.notes
    return type(notes) == "table" and type(notes.alert) == "table" and notes.alert.fontSize == nil
end

function CRT.SeedCalloutLook(db)
    local alert = db.notes.alert
    local _, size = CRTFontLarge:GetFont()
    alert.fontSize = math.max(CALLOUT_MIN, math.min(CALLOUT_MAX, math.floor((tonumber(size) or 20) + 0.5)))
    local outline = type(db.ui) == "table" and db.ui.outline
    alert.outline = CALLOUT_OUTLINES[outline] and outline or ""
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("ADDON_LOADED")
frame:SetScript("OnEvent", function(self, event, arg1)
    if event == "ADDON_LOADED" and arg1 == ADDON then
        -- no saved data before this login: a fresh install (What's new records the version and shows nothing)
        CRT.freshInstall = CRTDB == nil
        CRTDB = CRTDB or {}
        -- Puts this character's profile on top of CRTDB before anything reads it.
        CRT.Profiles:Load()
        -- before the defaults, so data from before themes keeps its look
        if type(CRTDB.ui) == "table" then
            CRT:ResolveTheme(CRTDB.ui)
        end
        -- before the defaults, once: the Loot Master item tabs' tooltip setting moved from tooltipAnchor to
        -- itemTooltip. Left, the old default, becomes "area" (Loot Master's Tooltip position: on auto, the
        -- default, next to the icon on the window's outer side, as before); Default tooltip becomes
        -- "game"; the other sides stay. The old field is kept as it was.
        local lm = CRTDB.lootmaster
        if type(lm) == "table" and lm.itemTooltip == nil and type(lm.tooltipAnchor) == "string" then
            local old = lm.tooltipAnchor
            lm.itemTooltip = (old == "left" and "area") or (old == "default" and "game") or old
        end
        CRT.ReadOldTooltipSettings(CRTDB)
        local seedCallout = CRT.CalloutNeedsLook(CRTDB) -- before the defaults fill in its size
        copyDefaults(defaults, CRTDB)
        CRT:UseTheme(CRT:ResolveTheme(CRTDB.ui))
        -- once: the old default of axis labels every 30 seconds becomes Auto, which follows the zoom
        local tl = CRTDB.timeline
        if tl and not tl.gridAutoOnce then
            tl.gridAutoOnce = true
            if tl.grid == 30 then
                tl.grid = "auto"
            end
        end
        CRT.db = CRTDB
        CRT:ApplyFonts()
        if seedCallout then
            CRT.SeedCalloutLook(CRTDB) -- the large font is at the text size now
        end
        self:UnregisterEvent("ADDON_LOADED")
        self:RegisterEvent("PLAYER_LOGIN")
    elseif event == "PLAYER_LOGIN" then
        -- Every addon has loaded by now, so a font shared through LibSharedMedia can be found.
        CRT.ready = true
        CRT:ApplyFonts()
    end
end)
