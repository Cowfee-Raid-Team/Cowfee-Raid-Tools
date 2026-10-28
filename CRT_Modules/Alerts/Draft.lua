local ADDON, CRT = ...

-- The alert draft: the fields an alert is edited as, and how a draft becomes one of your reminders. No
-- frames here, so the pop-out editor (Alerts/Editor.lua) and the Mech Alerts panel (Notes/Reminders.lua)
-- share one copy of it.
--   ctx    where the draft came from: { encounterID, id (a reminder) and reminder (its saved copy) },
--          and for the editor also a note line (noteID, line, expected) or a saved alert (savedMode)
--   draft  { saveAs, tag, group, difficulty, ph, timeText, timeTouched, keptTimes, spellID, iconType, iconID,
--          text, color, show = { alert, text, icon, bar, circle, timeline }, speak, speakAt, count, glow, sound,
--          warn, linger, boss, baseDifficulty, difficultyTouched, ticksText, fill, shield }
--          speakAt is nil (Speak at: On show) or "zero" (At 0), as a reminder keeps it
--          ticksText is the Impact ticks box as typed ("2, 4": seconds into the bar, Draft.ParseTicks), fill
--          "up" (Bar fills up) or nil (it empties), as a reminder keeps them (Alerts/Bars.lua draws them; Only me: a
--          note line has no such fields). An older reminder's barTo stays saved as it was and is never read
--          group is the difficulty group Only me saves for ("nh" or "mythic", Draft.Group); difficulty
--          the raid note's Difficulty a note line goes to, or an older reminder's Difficulty text
--          shield is the Shield bar section { on, unit, length, anyDifficulty }: kept while it is unticked, so a
--          tick puts back what was picked; saved (Draft.Absorb) as a reminder's absorb and a note line's shield:
-- Every function takes ctx and the draft it works on; none keeps either.
-- A cooldown dropped on the Timeline (or placed from its menu) is saved at once, without the editor:
-- Draft.PlaceCooldown, with Draft.CooldownDefaults (the one place those are set). A note line, from the
-- editor or a drop, is written by Draft.SaveNote.

local Reminders = CRT.AlertReminders

local Draft = {}
CRT.AlertDraft = Draft

-- The messages a check or a save can give. Keep the keys, change the text in quotes.
local TEXT = {
    keptBad = "The saved times don't read (%s). Type a time to replace them.",
    nothing = "Tick a Show as box, Speak the text or Count down: a sound alone shows nothing.",
    noTime = "Type a time.",
    badTime = "bad time '%s'",
    noEncounter = "Pick a boss first: this alert has no boss to be saved for.",
    saveFailed = "The reminder could not be saved.",
    stale = "This note line was changed elsewhere, such as by a new share. Close the editor and open it again.",
    noBoss = "This boss has no encounter ID, so it can't have a raid note line.",
    noteFailed = "The note line could not be saved.",
    timelineOnly = "Only the Alert timeline shows this line. Raiders on an older CRT won't see it.",
    badTicks = "The impact ticks don't read: %s.",
    tickWord = "'%s' isn't a number of seconds",
    tickBefore = "%s is under 0, and ticks are seconds into the bar",
    -- a tick that reads but is past the bar (Show from long): it still saves, and fits a longer Show from
    tickPast = "%s is past the %s s bar and won't show",
    ticksPast = "%s are past the %s s bar and won't show",
}
Draft.TEXT = TEXT

local SHOW_KEYS = { "alert", "text", "icon", "bar", "circle", "timeline" }
Draft.SHOW_KEYS = SHOW_KEYS
local DEFAULT_WARN = 5

-- The Shield bar section's choices: the boss units it offers and what a new alert starts with (Alerts/Absorb.lua).
Draft.SHIELD_UNITS = { "boss1", "boss2", "boss3", "boss4", "boss5" }
Draft.SHIELD_MIN, Draft.SHIELD_MAX, Draft.SHIELD_LENGTH = 3, 60, 15 -- Seconds to break

-- A cooldown placed from the Timeline's Cooldowns row: shown as Text only and read out at its time
-- (Speak at: At 0), from this many seconds ahead, gone at once (Linger), in the default colour.
-- Draft.CooldownDefaults gives them.
local COOLDOWN_WARN = 5
local COOLDOWN_LINGER = 0

function Draft.trim(s)
    return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end
local trim = Draft.trim

function Draft.copy(v)
    if type(v) ~= "table" then
        return v
    end
    local out = {}
    for k, x in pairs(v) do
        out[k] = Draft.copy(x)
    end
    return out
end
local copy = Draft.copy

function Draft.readable(v)
    local T = CRT.Timeline
    if T and T.readable then
        return T.readable(v)
    end
    return true
end

function Draft.validID(v)
    return type(v) == "number" and v > 0 and v or nil
end
local validID = Draft.validID

-- The time rule of Reminders.ParseTimes ("1:30" or "90"), plus plain seconds with a fraction.
function Draft.parseTime(text)
    text = trim(text)
    local t = CRT.TimelineReference.ParseTime(text)
    if not t and text:match("^%d+%.%d+$") then
        t = tonumber(text)
    end
    return t
end
local parseTime = Draft.parseTime

function Draft.words(s)
    local out = {}
    for word in tostring(s or ""):gmatch("%S+") do
        out[#out + 1] = word
    end
    return out
end

-- Whether you may change the raid note now, and the reason when not. Asked again at every write, so
-- a promotion or demotion while an alert is open counts.
function Draft.CanEditRaid()
    local Notes = CRT.Notes
    if not (Notes and Notes.CanEditRaid) then
        return false
    end
    local ok, why = Notes:CanEditRaid()
    if ok then
        return true
    end
    return false, why
end

-- Making drafts -------------------------------------------------------------------------------------

-- A new alert's draft: Only me, for everyone, the note callout and a bar, read out, 5 s ahead.
function Draft.New()
    return { saveAs = "mine", tag = "everyone", ph = 1, timeText = "", timeTouched = false, iconType = "spell",
        text = "", show = { alert = true, bar = true }, speak = true, count = false, glow = false,
        warn = DEFAULT_WARN, linger = 0, shield = Draft.NewShield() }
end

-- The Shield bar section of a new alert: off, on boss1, 15 seconds, also on a difficulty with no times.
function Draft.NewShield()
    return { on = false, unit = Draft.SHIELD_UNITS[1], length = Draft.SHIELD_LENGTH, anyDifficulty = true }
end

-- A saved absorb (a reminder's, a template's or a note line's) into the draft's Shield bar section: ticked with its
-- values, or the new alert's when there is none.
function Draft.SetShieldFrom(draft, absorb)
    local a = Reminders.AbsorbOf(absorb)
    draft.shield = Draft.NewShield()
    if a then
        draft.shield.on, draft.shield.unit, draft.shield.length, draft.shield.anyDifficulty = true, a.unit, a.length, a.anyDifficulty
    end
end

-- The draft's shield bar as it is saved, { unit, length, anyDifficulty }, or nil while Shield bar is unticked.
function Draft.Absorb(draft)
    local s = draft and draft.shield
    if not (type(s) == "table" and s.on) then
        return nil
    end
    return Reminders.AbsorbOf({ unit = s.unit, length = s.length, anyDifficulty = s.anyDifficulty and true or false })
end

-- The Shield on choices, Boss 1 to Boss 5, in the caller's words (label "Boss %d"), and the draft's own unit after
-- them when it is another (boss6 to boss8, saved elsewhere), so opening an alert never changes it.
function Draft.ShieldUnitOptions(label, draft)
    local out = {}
    for i, unit in ipairs(Draft.SHIELD_UNITS) do
        out[i] = { key = unit, label = string.format(label, i) }
    end
    local own = draft and draft.shield and draft.shield.unit
    local n = type(own) == "string" and tonumber(own:match("^boss(%d)$"))
    if n and n > #Draft.SHIELD_UNITS then
        out[#out + 1] = { key = own, label = string.format(label, n) }
    end
    return out
end

-- A draft's Show as boxes and Read out choices as a reminder's outputs and speech (nil when neither
-- read out choice is ticked).
function Draft.Outputs(d)
    local outputs = {}
    for _, k in ipairs(SHOW_KEYS) do
        outputs[k] = d.show[k] and true or false
    end
    outputs.speech = (d.speak or d.count) and true or false
    local speech
    if d.speak and d.count then
        speech = "textcount"
    elseif d.speak then
        speech = "text"
    elseif d.count then
        speech = "count"
    end
    return outputs, speech
end

-- What a new alert starts with, as a template's fields (CRT.AlertSaved:Save): its Save as, For, outputs,
-- speech and warning time. A fresh table each call, from the same draft a new alert opens with.
function Draft.NewDefaults()
    local d = Draft.New()
    local outputs, speech = Draft.Outputs(d)
    return { saveAs = d.saveAs, tags = d.tag, outputs = outputs, speech = speech, warn = d.warn,
        speakAt = d.speakAt }
end

-- The Speak at choices: On show (key "show", saved as nil) and At 0 ("zero"), in the caller's words.
function Draft.SpeakAtOptions(onShow, atZero)
    return { { key = "show", label = onShow }, { key = "zero", label = atZero } }
end

-- Speak at as its dropdown's key, and a key back into the draft.
function Draft.SpeakAtKey(draft)
    return draft and draft.speakAt == "zero" and "zero" or "show"
end
function Draft.SetSpeakAt(draft, key)
    draft.speakAt = key == "zero" and "zero" or nil
end

-- The Show as boxes, in the rows the alert editor and Mech Alerts lay them out in: the two long names, then
-- the four short ones.
Draft.SHOW_ROWS = { { "alert", "text" }, { "icon", "bar", "circle", "timeline" } }

-- Lays Show as boxes out by their labels' width: rows is a list of rows of checks (each with check.label, a
-- font string beside it), each row from x0, a box boxW wide (with the gap before its label), then its label,
-- then gap. A row whose words don't fit before `right` (a large text size) has its labels narrowed in
-- proportion, cut with "...", so nothing passes the edge. place(check, x, rowIndex) puts each box. Measured
-- each time it runs, so call it again when the text size may have changed.
function Draft.FlowShowAs(rows, x0, right, boxW, gap, place)
    for r, checks in ipairs(rows) do
        local words, total = {}, 0
        for i, check in ipairs(checks) do
            local fs = check.label
            local w = fs.GetUnboundedStringWidth and fs:GetUnboundedStringWidth() or fs:GetStringWidth()
            words[i] = math.ceil(tonumber(w) or 0)
            total = total + words[i]
        end
        local room = right - x0 - #checks * boxW - (#checks - 1) * gap
        local scale = (total > room and total > 0) and math.max(0, room) / total or 1
        local x = x0
        for i, check in ipairs(checks) do
            local w = math.floor(words[i] * scale)
            check.label:SetWordWrap(false)
            check.label:SetWidth(w)
            place(check, x, r)
            x = x + boxW + w + gap
        end
    end
end

-- The Impact ticks box: seconds into the bar, separated by commas ("2, 4"), each a plain number of 0 or
-- more. Returns them in order, each once ({} for an empty box), or nil and what doesn't read.
function Draft.ParseTicks(text)
    local out, seen = {}, {}
    for piece in (tostring(text or "") .. ","):gmatch("([^,]*),") do
        local word = trim(piece)
        if word ~= "" then
            local t = (word:match("^%d+%.?%d*$") or word:match("^%.%d+$")) and tonumber(word) or nil
            if not t then
                local below = word:match("^%-%d*%.?%d+$") and tonumber(word)
                return nil, below and string.format(TEXT.tickBefore, word) or string.format(TEXT.tickWord, word)
            end
            if not seen[t] then
                seen[t] = true
                out[#out + 1] = t
            end
        end
    end
    table.sort(out)
    return out
end

-- Ticks as the box shows them ("1.5, 3.5"), or nil for none.
function Draft.TicksText(list)
    if type(list) ~= "table" or #list == 0 then
        return nil
    end
    local parts = {}
    for i, t in ipairs(list) do
        parts[i] = ("%g"):format(t)
    end
    return table.concat(parts, ", ")
end

-- The draft's ticks, or nil for none or a box that doesn't read (Draft.Problem says why).
function Draft.Ticks(draft)
    local list = Draft.ParseTicks(draft and draft.ticksText)
    return list and #list > 0 and list or nil
end

-- What the panel says of ticks that read but are past the bar: a reminder's bar is Show from long (Reminders.BarTicks),
-- so "6 is past the 5 s bar and won't show". Nil when every tick fits, the box doesn't read, or Bar is off.
function Draft.TicksPast(draft)
    if not (draft and draft.show and draft.show.bar) then
        return nil
    end
    local warn = type(draft.warn) == "number" and draft.warn or DEFAULT_WARN
    local _, off = Reminders.BarTicks(Draft.Ticks(draft), warn)
    if not off then
        return nil
    end
    local words = Draft.TicksText(off)
    return string.format(#off > 1 and TEXT.ticksPast or TEXT.tickPast, words, ("%g"):format(warn))
end

-- The Count down to choices, in the caller's words.
function Draft.CountOptions(cast, impact)
    return { { key = "cast", label = cast }, { key = "impact", label = impact } }
end

-- The Bar fill choices, in the caller's words.
function Draft.FillOptions(up, down)
    return { { key = "up", label = up }, { key = "down", label = down } }
end

-- A saved reminder into the draft. Its times text is kept until Relative to or Time is touched.
function Draft.FromReminder(draft, r)
    draft.spellID, draft.boss, draft.difficulty = r.spellID, r.boss, r.difficulty
    draft.group = Reminders.GroupOf(r) -- nil for an older reminder on any difficulty: Draft.Group's default
    draft.text = r.text or ""
    draft.keptTimes = r.times
    local o = r.outputs or {}
    for _, k in ipairs(SHOW_KEYS) do
        draft.show[k] = o[k] and true or false
    end
    local speaks = o.speech ~= false
    local mode = r.speech or "text"
    draft.speak = speaks and mode ~= "count"
    draft.count = speaks and (mode == "textcount" or mode == "count")
    draft.speakAt = r.speakAt == "zero" and "zero" or nil
    draft.glow = r.glow and true or false
    draft.sound = r.sound
    draft.auraSound = r.auraSound and true or false -- also play the sound when the spell lands on you
    draft.warn = r.warn or DEFAULT_WARN
    draft.linger = type(r.linger) == "number" and r.linger or 0
    draft.iconID = validID(r.iconID)
    draft.iconType = draft.iconID and "id" or "spell"
    draft.color = copy(r.color)
    draft.ticksText = Reminders.TickList and Draft.TicksText(Reminders.TickList(r.ticks)) or nil
    draft.fill = r.fill == "up" and "up" or nil
    draft.countTo = r.countTo == "impact" and "impact" or nil
    Draft.SetShieldFrom(draft, r.absorb)
end

-- A new draft from a saved reminder.
function Draft.ForReminder(r)
    local d = Draft.New()
    Draft.FromReminder(d, r)
    d.baseDifficulty = d.difficulty
    return d
end

-- A new draft for a spell of a boss: named after the spell unless text is given.
function Draft.ForSpell(spellID, text, boss)
    local d = Draft.New()
    d.spellID = validID(spellID)
    if type(text) == "string" and trim(text) ~= "" then
        d.text = text
    else
        d.text = (d.spellID and Reminders.SpellName(d.spellID)) or ""
    end
    d.boss = boss
    return d
end

-- A For chosen before the draft opens (a cooldown assigned on the Timeline): a player's name as the note
-- line's tag, or "" for no one (the line then only shows in the timers window, and keeps that choice).
function Draft.ApplyFor(ctx, draft, tag)
    if type(tag) ~= "string" then
        return
    end
    draft.tag = trim(tag)
    if draft.tag == "" and ctx then
        ctx.untagged = true
    end
end

-- What a placed cooldown starts with, as draft fields: Show as Text only, Speak the text at 0 (at the
-- cast), no count, glow or sound, Show from COOLDOWN_WARN, Linger COOLDOWN_LINGER, the default colour,
-- the spell's own icon. A fresh table each call. Not the editor's new-alert defaults (Draft.New): a
-- cooldown has its own. No sound and the default colour are nil, which a table can't hold:
-- Draft.ForCooldown clears them.
function Draft.CooldownDefaults()
    return { show = { alert = false, text = true, icon = false, bar = false, circle = false, timeline = false }, speak = true,
        speakAt = "zero", count = false, glow = false, warn = COOLDOWN_WARN, linger = COOLDOWN_LINGER,
        iconType = "spell" }
end

-- A new draft for a cooldown: its spell, named after the spell unless text is given, with the cooldown
-- defaults; Only me, for everyone, until the caller says otherwise.
function Draft.ForCooldown(spellID, text, boss)
    local d = Draft.ForSpell(spellID, text, boss)
    for k, v in pairs(Draft.CooldownDefaults()) do
        d[k] = v
    end
    d.sound, d.color, d.iconID = nil, nil, nil
    return d
end

-- The cooldown defaults as a template's fields (CRT.AlertSaved:Save), for Save as template on a cooldown:
-- Only me, for everyone, Text, read out at 0.
function Draft.CooldownTemplate()
    local d = Draft.ForCooldown(nil, nil, nil)
    local outputs, speech = Draft.Outputs(d)
    return { saveAs = d.saveAs, tags = d.tag, outputs = outputs, speech = speech, warn = d.warn,
        linger = d.linger, glow = d.glow or nil, sound = d.sound, color = copy(d.color), speakAt = d.speakAt }
end

-- Checks ----------------------------------------------------------------------------------------------

-- The draft as reminder text fields, for Reminders:Times.
function Draft.TimesProbe(draft)
    return { times = draft.keptTimes, spellID = draft.spellID, text = draft.text, boss = draft.boss,
        difficulty = draft.difficulty, group = Draft.Group(draft) }
end

-- Whether the draft still uses a saved reminder's own times: one being kept, or one moving to the raid
-- note with Relative to and Time untouched (it then becomes one note line per time).
function Draft.KeepsTimes(ctx, draft)
    if ctx and ctx.savedMode then
        return false
    end
    return not draft.timeTouched and (draft.saveAs == "mine" or (ctx ~= nil and ctx.id ~= nil))
end

-- The message for a time that does not read; `strict` (Save and Test) also asks a note line for one.
-- A reminder's kept times text is checked while Relative to and Time are untouched.
function Draft.TimeError(ctx, draft, strict)
    if ctx and ctx.savedMode then
        return nil -- a saved alert has no time
    end
    if Draft.KeepsTimes(ctx, draft) and draft.keptTimes then
        local list, err = Reminders.ParseTimes(draft.keptTimes)
        if not list then
            return string.format(TEXT.keptBad, tostring(err))
        end
        return nil
    end
    local text = trim(draft.timeText)
    if text == "" then
        return (strict and draft.saveAs == "note") and TEXT.noTime or nil
    end
    if not parseTime(text) then
        return string.format(TEXT.badTime, text)
    end
    return nil
end

-- Whether the draft is a raid note line whose only display is the alert timeline (show:timeline). A CRT from
-- before the alert timeline reads that show: list as empty, so raiders still on one see nothing of the line.
function Draft.TimelineOnlyNote(draft)
    if not (draft and draft.saveAs == "note" and draft.show and draft.show.timeline) then
        return false
    end
    for _, k in ipairs(SHOW_KEYS) do
        if k ~= "timeline" and draft.show[k] then
            return false
        end
    end
    return true
end

-- Whether the draft shows or says anything.
function Draft.AnyOutput(draft)
    for _, k in ipairs(SHOW_KEYS) do
        if draft.show[k] then
            return true
        end
    end
    return draft.speak or draft.count
end

-- The first problem that stops the draft being saved, or nil.
function Draft.Problem(ctx, draft)
    local err = Draft.TimeError(ctx, draft, true)
    if err then
        return err
    end
    if not Draft.AnyOutput(draft) then
        return TEXT.nothing
    end
    local ticks, why = Draft.ParseTicks(draft.ticksText)
    if not ticks then
        return string.format(TEXT.badTicks, why)
    end
    return nil
end

-- As a reminder ---------------------------------------------------------------------------------------

-- The reminder's times text: the one it was saved with until Relative to or Time is touched.
local function reminderTimes(draft)
    if not draft.timeTouched then
        return draft.keptTimes
    end
    local t = parseTime(draft.timeText)
    if not t then
        return nil
    end
    return Reminders.FormatTimes({ { ph = draft.ph or 1, t = t } })
end

-- The draft as a reminder, laid over the saved one so its other fields (priority, enabled) stay.
function Draft.BuildReminder(ctx, draft)
    local r = copy(ctx and ctx.reminder or {})
    r.boss = draft.boss
    r.spellID = validID(draft.spellID)
    r.text = trim(draft.text)
    r.difficulty = draft.difficulty
    -- the group picked (Reminders:Save drops a Difficulty text of another group); an older reminder on any
    -- difficulty stays so until a group is picked for it, which splits it (Reminders.SplitOne)
    if draft.group or not (ctx and ctx.id) then
        r.group = Draft.Group(draft)
    end
    r.times = reminderTimes(draft)
    r.outputs = r.outputs or {}
    local outputs, speech = Draft.Outputs(draft)
    for k, on in pairs(outputs) do
        r.outputs[k] = on
    end
    if speech then
        r.speech = speech
    end
    r.speakAt = draft.speakAt == "zero" and "zero" or nil
    r.warn = draft.warn
    r.linger = draft.linger > 0 and draft.linger or nil
    r.sound = draft.sound
    r.auraSound = draft.auraSound or nil
    r.glow = draft.glow or nil
    r.iconID = draft.iconType == "id" and validID(draft.iconID) or nil
    r.color = copy(draft.color)
    -- the bar's impact ticks and how it fills; the defaults (no ticks, it empties) are saved as nothing, so a
    -- reminder that never set them gains no fields. An older barTo is left as it was saved (never read)
    r.ticks = Draft.Ticks(draft)
    r.fill = draft.fill == "up" and "up" or nil
    r.countTo = draft.countTo == "impact" and "impact" or nil -- the default (to the cast) is saved as nothing
    r.absorb = Draft.Absorb(draft) -- a shield bar (Alerts/Absorb.lua); unticked, none
    return r
end

-- Whether the note line is still the one the draft was opened from.
function Draft.LineUnchanged(ctx)
    local _, raw = CRT.Notes:TimerAt(ctx.noteID, ctx.line)
    return raw ~= nil and raw == ctx.expected
end

-- Saves the draft as one of your reminders (ctx.id, or a new one). A note line moving to your
-- reminders is taken out of the raid note. Returns the reminder's id, or false and the message.
function Draft.SaveMine(ctx, draft)
    local encounterID = ctx.encounterID
    if encounterID == nil then
        return false, TEXT.noEncounter
    end
    if ctx.noteID then
        local allowed, why = Draft.CanEditRaid()
        if not allowed then
            return false, why
        end
        if not Draft.LineUnchanged(ctx) then
            return false, TEXT.stale
        end
    end
    -- the group the editor's casts line showed, so typed times land on that row (Reminders:Save)
    local id = Reminders:Save(encounterID, ctx.id, Draft.BuildReminder(ctx, draft), Draft.PreviewGroup(draft))
    if not id then
        return false, TEXT.saveFailed
    end
    if ctx.noteID then
        CRT.Notes:RemoveLine(ctx.noteID, ctx.line, ctx.expected)
    end
    return id
end

-- As a raid note line ----------------------------------------------------------------------------------

-- Text fit for a note line: no ";" (it ends a field) and no line ends.
function Draft.clean(s)
    return trim((tostring(s or ""):gsub(";", ""):gsub("[\r\n]+", " ")))
end
local clean = Draft.clean

-- The draft as a note line's timer (Parser.FormatLine writes it). A line keeps its dur:.
function Draft.NoteTimer(ctx, draft)
    local base = ctx and ctx.timer or {}
    local spellID = validID(draft.spellID)
    local text = clean(draft.text)
    local show = {}
    for _, k in ipairs(SHOW_KEYS) do
        show[k] = draft.show[k] or nil
    end
    return {
        time = parseTime(draft.timeText) or 0,
        ph = draft.ph or 1,
        tags = Draft.words(draft.tag),
        spellId = spellID,
        kind = spellID and "spell" or "text",
        text = text ~= "" and text or nil,
        dur = base.dur,
        color = copy(draft.color),
        show = show,
        tts = draft.speak or nil,
        -- ttsat:0 only with the text read out: a line without it speaks when it shows
        speakAt = (draft.speak and draft.speakAt == "zero") and "zero" or nil,
        count = draft.count or nil,
        sound = CRT.Sound.Compact(draft.sound), -- a game sound by its bare name, as older versions read it
        glow = draft.glow or nil,
        warn = draft.warn,
        linger = draft.linger > 0 and draft.linger or nil,
        iconID = draft.iconType == "id" and validID(draft.iconID) or nil,
        absorb = Draft.Absorb(draft), -- shield:, which a CRT from before it ignores
    }
end

-- The fields of the raw line the draft was opened from that FormatLine doesn't write (such as
-- DisplayType:), kept on the end of the line written back.
function Draft.KeptFields(ctx)
    return ctx and ctx.expected and CRT.NoteParser.UnknownFields(ctx.expected) or ""
end

local GROUPS = { nh = true, mythic = true }

-- The difficulty group of the draft ("nh" or "mythic"): as Only me, the group picked (draft.group); as a
-- raid note line, its note's Difficulty's (draft.difficulty). Else the other of the two, else the raid you
-- are in (by its difficulty ID, the same on every client language), else Normal/Heroic. The one group a
-- reminder from the draft is saved for and its previews read an ability timeline for.
function Draft.Group(draft)
    local T = CRT.Timeline
    local picked = draft and GROUPS[draft.group] and draft.group or nil
    if picked and draft.saveAs ~= "note" then
        return picked
    end
    if draft and type(draft.difficulty) == "string" and trim(draft.difficulty) ~= "" and T and T.GroupFor then
        return T:GroupFor(trim(draft.difficulty))
    end
    return picked or (T and T.GroupOf and T:GroupOf(Draft.CurrentDifficultyID(), nil)) or "nh"
end

-- The difficulty choices of your own alert, in the caller's words: Normal/Heroic, then Mythic.
function Draft.GroupOptions(normalHeroic, mythic)
    return { { key = "nh", label = normalHeroic }, { key = "mythic", label = mythic } }
end

-- A difficulty group picked for the draft. A Difficulty text of the other group goes with it.
function Draft.SetGroup(draft, group)
    if not (draft and GROUPS[group]) then
        return
    end
    draft.group = group
    local T = CRT.Timeline
    if type(draft.difficulty) == "string" and T and T.GroupFor and T:GroupFor(trim(draft.difficulty)) ~= group then
        draft.difficulty = nil
    end
end

-- The difficulty group the editor's previews read an ability timeline for, as the Rehearsal its Test
-- opens would (Draft.Group); nil without the Timeline.
function Draft.PreviewGroup(draft)
    local T = CRT.Timeline
    if not (T and T.GroupOf) then
        return nil
    end
    return Draft.Group(draft)
end

-- Whether the draft, as Only me, is an alert on a boss ability that follows its casts (no Time of its own).
function Draft.FollowsCasts(ctx, draft)
    if not (ctx and draft) or ctx.savedMode or draft.saveAs ~= "mine" or not Reminders.FollowsCasts then
        return false
    end
    return Reminders.FollowsCasts(ctx.encounterID, Draft.TimesProbe(draft), nil, Draft.PreviewGroup(draft))
end

-- The times of a reminder moving to the raid note (Draft.KeepsTimes), or nil.
function Draft.KeptTimeList(ctx, draft)
    if Draft.KeepsTimes(ctx, draft) then
        local list = Reminders:Times(ctx.encounterID, Draft.TimesProbe(draft), nil, Draft.PreviewGroup(draft))
        if #list > 0 then
            return list
        end
    end
    return nil
end

-- The draft as note line timers: one per time of a reminder moving here (KeepsTimes), else one.
function Draft.NoteTimers(ctx, draft)
    local base = Draft.NoteTimer(ctx, draft)
    local list = Draft.KeptTimeList(ctx, draft)
    if list then
        local out = {}
        for i, e in ipairs(list) do
            local t = copy(base)
            t.ph, t.time = e.ph, e.t
            out[i] = t
        end
        return out
    end
    return { base }
end

local function lower(s)
    return trim(s):lower()
end

-- The chosen order's shift for a boss and group (CRT.Timeline:OrderShift), or nil.
local function orderShift(encounterID, group)
    local T = CRT.Timeline
    if not (T and T.OrderShift) then
        return nil
    end
    local ok, shift = pcall(T.OrderShift, T, encounterID, group)
    return ok and type(shift) == "function" and shift or nil
end

-- The tested alert's first fight second (seconds from the pull) and the difficulty to open the Rehearsal
-- on, worked out on the fight the window plays: CRT.Timeline:RehearsalSourceFor for the draft's
-- difficulty (else the raid you are in; neither is the Normal/Heroic group). A reminder that follows the
-- reference reads that source's reference, and a later phase is placed through it
-- (Reminders.AbsoluteTime); a recorded pull has no reference, so only phase 1 times are placed. A phase 1
-- time of a part row moves with the raid's chosen order (CRT.Timeline:OrderShift) and is left out when
-- it falls past its new window. The earliest time left wins. Nil for a saved alert (no time), no boss, no
-- source, or no time that can be placed.
function Draft.FirstFightTime(ctx, draft)
    local T = CRT.Timeline
    if not (ctx and type(ctx.encounterID) == "number") or ctx.savedMode or not draft
        or not (T and T.RehearsalSourceFor and T.GroupFor) then
        return nil
    end
    local enc = ctx.encounterID
    local difficulty = draft.difficulty or Draft.CurrentDifficulty()
    local group = Draft.PreviewGroup(draft) or T:GroupFor(difficulty)
    local ok, source = pcall(T.RehearsalSourceFor, T, enc, group)
    if not (ok and type(source) == "table" and type(source.base) == "table") then
        return nil
    end
    local ref = source.base.reference
    difficulty = difficulty or source.difficultyName
    local list, spellID, text = {}, validID(draft.spellID), trim(draft.text)
    if draft.saveAs == "note" then
        for i, t in ipairs(Draft.NoteTimers(ctx, draft)) do
            list[i] = { ph = t.ph, t = t.time }
        end
    else
        local r = Draft.BuildReminder(ctx, draft)
        list = Reminders:Times(enc, r, ref)
        text = r.text ~= "" and r.text or Reminders.SpellName(spellID) or text
    end
    local shift = orderShift(enc, group)
    local first
    for _, e in ipairs(list) do
        local s
        if e.ph == 1 then
            s = e.t
            if shift then
                local okShift, moved = pcall(shift, spellID, text, s)
                if okShift and (moved == false or type(moved) == "number") then
                    s = moved or nil
                end
            end
        elseif ref then
            s = Reminders.AbsoluteTime(ref, e.ph, e.t)
        end
        if s and (not first or s < first) then
            first = s
        end
    end
    -- the group and the reference the window plays, so the test's items read the same casts
    return first, difficulty, ref, group
end

-- The raid difficulty's ID you are in now (DifficultyID), or nil outside a raid or when it can't be read.
function Draft.CurrentDifficultyID()
    if not GetInstanceInfo then
        return nil
    end
    local ok, _, kind, difficultyID = pcall(GetInstanceInfo)
    if ok and Draft.readable(kind) and kind == "raid" and Draft.readable(difficultyID) and type(difficultyID) == "number" then
        return difficultyID
    end
    return nil
end

-- The raid difficulty you are in now, by the name a pull there gets (GetDifficultyInfo, as the engine
-- names it on ENCOUNTER_START), or nil outside a raid.
function Draft.CurrentDifficulty()
    if not GetInstanceInfo then
        return nil
    end
    local ok, _, kind, difficultyID, name = pcall(GetInstanceInfo)
    if not (ok and Draft.readable(kind) and kind == "raid") then
        return nil
    end
    if GetDifficultyInfo and Draft.readable(difficultyID) and type(difficultyID) == "number" then
        local okName, n = pcall(GetDifficultyInfo, difficultyID)
        if okName and Draft.readable(n) and type(n) == "string" and trim(n) ~= "" then
            return n
        end
    end
    if Draft.readable(name) and type(name) == "string" and trim(name) ~= "" then
        return name
    end
    return nil
end

-- The Difficulty a new raid note line starts on: that of the note the pull you are in would read, or,
-- outside a raid, of the boss's only note. Nil (Any) when there is no such note.
function Draft.DefaultDifficulty(encounterID)
    if type(encounterID) ~= "number" then
        return nil
    end
    local Notes = CRT.Notes
    local current = Draft.CurrentDifficulty()
    local id
    if current then
        id = Notes:FindForEncounter(encounterID, current)
    else
        for _, e in ipairs(Notes:List()) do
            if e.record.encounterID == encounterID then
                if id then
                    return nil
                end
                id = e.id
            end
        end
    end
    local record = id and Notes:Get(id)
    return record and record.difficulty or nil
end

-- The note a raid note line saved now goes to: the line's own note while its difficulty is unchanged,
-- else the one a pull of that difficulty reads (Notes:AddLine writes there). Nil: a new note is made.
function Draft.TargetNote(ctx, draft)
    if not (ctx and type(ctx.encounterID) == "number") then
        return nil
    end
    local difficulty = draft.difficulty and trim(draft.difficulty) or nil
    if ctx.noteID and lower(ctx.noteDifficulty) == lower(difficulty) then
        return ctx.noteID
    end
    return CRT.Notes:FindForEncounter(ctx.encounterID, difficulty)
end

-- Saves the draft as raid note lines: over the line it was opened from (ctx.noteID, line, expected)
-- while it stays in that note, else as new lines in the note the pull reads (a new note for the boss
-- when it has none), taking the old line or reminder (ctx.id) away once they are written. The raid
-- note is asked again here, and a line changed elsewhere is never overwritten. True, or false and the
-- message.
function Draft.SaveNote(ctx, draft)
    local allowed, why = Draft.CanEditRaid()
    if not allowed then
        return false, why
    end
    local encounterID = ctx.encounterID
    if type(encounterID) ~= "number" then
        return false, TEXT.noBoss
    end
    local Notes = CRT.Notes
    local extra = Draft.KeptFields(ctx)
    local lines = {}
    for i, t in ipairs(Draft.NoteTimers(ctx, draft)) do
        lines[i] = CRT.NoteParser.FormatLine(t) .. extra
    end
    local difficulty = draft.difficulty and trim(draft.difficulty) or nil
    if ctx.noteID then
        if not Draft.LineUnchanged(ctx) then
            return false, TEXT.stale
        end
        -- still going to its own note: the line is replaced where it is
        if Draft.TargetNote(ctx, draft) == ctx.noteID then
            if not Notes:ReplaceLine(ctx.noteID, ctx.line, lines[1], ctx.expected) then
                return false, TEXT.stale
            end
            return true
        end
    end
    -- a new line, or lines moving here from a reminder (one per time) or from another note. If one
    -- can't be written, the ones written are taken out again and the old alert stays as it was.
    local written = {}
    for _, line in ipairs(lines) do
        local id, n = Notes:AddLine(encounterID, difficulty, draft.boss, line)
        if not id then
            for i = #written, 1, -1 do
                Notes:RemoveLine(written[i].id, written[i].n, written[i].line)
            end
            return false, TEXT.noteFailed
        end
        written[#written + 1] = { id = id, n = n, line = line }
    end
    if ctx.noteID then
        Notes:RemoveLine(ctx.noteID, ctx.line, ctx.expected)
    elseif ctx.id then
        Reminders:Delete(encounterID, ctx.id)
    end
    return true
end

-- Placing a cooldown ------------------------------------------------------------------------------------

-- Saves cooldown spellID (named text, or the spell's name) for boss encounterID at once, at ph and
-- seconds into it, with the cooldown defaults. tag nil: one of your reminders (Only me); a name: a raid
-- note line for that player; "": a raid note line for no one. group (optional) is the difficulty group
-- Only me saves it for (the Timeline view's). A true value (the reminder's id for Only me), or false and
-- the message.
function Draft.PlaceCooldown(encounterID, spellID, text, boss, ph, seconds, tag, group)
    local ctx = { encounterID = encounterID }
    local draft = Draft.ForCooldown(spellID, text, boss)
    Draft.SetGroup(draft, group)
    draft.ph = type(ph) == "number" and ph or 1
    draft.timeText = ("%.10g"):format(type(seconds) == "number" and math.max(0, seconds) or 0)
    draft.timeTouched = true
    if type(tag) ~= "string" then
        return Draft.SaveMine(ctx, draft)
    end
    draft.saveAs = "note"
    Draft.ApplyFor(ctx, draft, tag)
    draft.difficulty = Draft.DefaultDifficulty(encounterID)
    return Draft.SaveNote(ctx, draft)
end

-- The Sound choices: None (key Draft.NO_SOUND, saved as no sound), then every sound the engine offers
-- (Sound/Engine.lua), keyed by reference. Draft.SoundKey reads a saved value (an old bare game sound
-- name too) as the key the menu shows.
Draft.NO_SOUND = "none"
function Draft.SoundOptions(noneLabel)
    return CRT.Sound:Choices({ none = noneLabel })
end

function Draft.SoundKey(value)
    return CRT.Sound.Normalize(value) or Draft.NO_SOUND
end

-- The spell box --------------------------------------------------------------------------------------

-- A number typed in the Spell / Icon ID box: the spell, or in Icon ID mode the icon.
function Draft.SetID(draft, id)
    id = validID(id)
    if draft.iconType == "id" then
        draft.iconID = id
    else
        draft.spellID = id
    end
end

-- The icon a pick in Icon ID mode takes: the source's, else the game's when it reads as a number.
local function matchIcon(m)
    if type(m.icon) == "number" and m.icon > 0 then
        return m.icon
    end
    if C_Spell and C_Spell.GetSpellTexture then
        local ok, tex = pcall(C_Spell.GetSpellTexture, m.spellID)
        if ok and Draft.readable(tex) then
            return validID(tex)
        end
    end
end

-- A spell picked from a name lookup (CRT.AlertSpellLookup): the spell (or its icon) goes in the draft,
-- and text that was empty or only named the spell before (`before`) becomes the new spell's name; typed
-- text stays. Returns the ID for the box (nil when an icon could not be read) and the new text, if any.
function Draft.ApplyPick(draft, m, before)
    before = validID(before) or validID(draft.spellID)
    local beforeName = before and Reminders.SpellName(before)
    local text = trim(draft.text)
    local id, newText
    if draft.iconType == "id" then
        id = matchIcon(m)
        if id then
            draft.iconID = id
        end
    else
        id = m.spellID
        draft.spellID = id
    end
    -- an icon alone leaves the text: it still names the alert's spell
    if draft.iconType ~= "id" and (text == "" or (beforeName and text == trim(beforeName))) then
        draft.text = m.name
        newText = m.name
    end
    return id, newText
end
