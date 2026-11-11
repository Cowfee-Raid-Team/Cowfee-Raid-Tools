local ADDON, CRT = ...

-- Assignment highlights: an optional module (off until the player ticks Use assignment highlights on its page,
-- Highlights/Page.lua). In the raid note windows (Notes/Window.lua: the timers window and the assignments window)
-- a line that names you or your raid group gets a band behind it in the theme's accent, and the name or group
-- word in the accent colour. When a new note changes a line with you in it, that line glows for a few seconds
-- with a small "changed" tag.
--   H:Spans(line)          the word starts in a line of free text to paint, or nil when the line is not about you
--   H:TagSpans(tags)       the same for a timer's tags (by index)
--   H.Paint(word)          a word in the accent colour
--   H.PlaceRow(w, row, fits), H.HideRow(row)   a window row's band and glow (Window.lua's layoutRows, drawLines)
--   H.AfterDraw(w, lines, version), H.Forget(w) the glow on change, after each rebuild of a window's lines
-- Only plain string work on the note's text: your name is read once, out of a fight, and your group from the raid
-- roster; a value the game hides is never compared, and then nothing matches. Settings: CRTDB.highlights (Core.lua).

local H = {}
CRT.NoteHighlights = H

local TEXT = {
    changed = "changed",
}
H.TEXT = TEXT

-- The look: the band's alpha (as the Version list's selected row), the glow's, and how the glow pulses.
local BAND_ALPHA = 0.18
local GLOW_ALPHA = 0.45
local GLOW_PULSES = 3          -- pulses in one glow
local PULSE_SECONDS = 0.5      -- each half of a pulse: GLOW_PULSES * 2 * PULSE_SECONDS = 3 s in all
local TAG_FADE = 1             -- the "changed" tag fades out over the glow's last second
local BAND_PAD = 2             -- how far the band reaches past the line's text
local GROUP_SECONDS = 5        -- how long your raid group is kept, past a roster change
H.BAND_ALPHA, H.GLOW_ALPHA = BAND_ALPHA, GLOW_ALPHA
H.GLOW_SECONDS = GLOW_PULSES * 2 * PULSE_SECONDS

local MAX_GROUP = 8
local WORD = "()([%w\128-\255]+)()"

local function readable(v)
    return not (issecretvalue and issecretvalue(v))
end

function H.Settings()
    return CRT.db.highlights
end

-- The module's switch, and whether any line can be marked at all.
function H:Enabled()
    return CRT.db ~= nil and CRT.db.highlights ~= nil and CRT.db.highlights.enabled == true
end

function H:Active()
    local s = self:Enabled() and H.Settings()
    return s and (s.name or s.group) and true or false
end

function H:GlowOn()
    return self:Active() and H.Settings().glow and true or false
end

-- Your name in lower case, without its realm: read once it can be (out of a fight it always can), then kept.
local myName
function H:MyName()
    if myName then
        return myName
    end
    local ok, name = pcall(UnitName, "player")
    if ok and readable(name) and type(name) == "string" and name ~= "" then
        myName = name:lower():gsub("%-.*$", "")
    end
    return myName
end

-- Your raid group, 1 to 8, from the raid roster; nil outside a raid or when the roster can't be read. A preview
-- with no raid uses group 1, so its sample shows a group line.
local groupCache, groupAt
local function readGroup()
    if not (IsInRaid and IsInRaid()) then
        return nil
    end
    for i = 1, GetNumGroupMembers() do
        if UnitIsUnit("raid" .. i, "player") then
            local _, _, subgroup = GetRaidRosterInfo(i)
            if readable(subgroup) and type(subgroup) == "number" and subgroup >= 1 and subgroup <= MAX_GROUP then
                return subgroup
            end
            return nil
        end
    end
    return nil
end

function H:MyGroup()
    if not (groupAt and GetTime() - groupAt < GROUP_SECONDS) then
        local ok, g = pcall(readGroup)
        groupCache, groupAt = ok and g or nil, GetTime()
    end
    if not groupCache and self.previewing then
        return 1
    end
    return groupCache
end

function H:ResetGroup()
    groupAt = nil
end

-- The group number a word (and the word after it) names: "G3", "Grp3" or "Group3", or "G", "Grp" or "Group" then
-- "3" (Parse.lua's GROUP_WORDS, as the timers' tags read them). Returns the number and how many words it used.
local function groupOf(word, nextWord)
    local words = CRT.NoteParser and CRT.NoteParser.GROUP_WORDS
    if not words then
        return nil
    end
    local lower = word:lower()
    local prefix, number = lower:match("^(%a+)(%d)$")
    if prefix and words[prefix] then
        return tonumber(number), 1
    end
    if words[lower] and nextWord and nextWord:match("^%d$") then
        return tonumber(nextWord), 2
    end
    return nil
end
H.GroupOf = groupOf

local function inBraces(line, start, stop)
    local codes = CRT.MarkerCodes
    return codes and codes.InBraces and codes.InBraces(line, start, stop) or false
end

-- The words of a line of free text to paint: { [start] = true } for each word that is your name or a word of your
-- group ("Group 3" paints both), by the word's start in the line, as Window.lua's textLine reads words. Nil when
-- nothing in the line is about you, or the module is off.
function H:Spans(line)
    if not self:Active() or type(line) ~= "string" or line == "" then
        return nil
    end
    local s = H.Settings()
    local name = s.name and self:MyName() or nil
    local group = s.group and self:MyGroup() or nil
    if not name and not group then
        return nil
    end
    local words = {}
    for start, word, stop in line:gmatch(WORD) do
        if not inBraces(line, start, stop) then
            words[#words + 1] = { start = start, word = word, stop = stop }
        end
    end
    local spans
    local i = 1
    while i <= #words do
        local w = words[i]
        local nextW = words[i + 1]
        -- "Group 3": the number is the next word only when just spaces stand between them
        local nextWord = nextW and line:sub(w.stop, nextW.start - 1):match("^%s+$") and nextW.word or nil
        local used = 1
        if name and w.word:lower() == name then
            spans = spans or {}
            spans[w.start] = true
        elseif group then
            local number, n = groupOf(w.word, nextWord)
            if number then
                used = n
                if number == group then
                    spans = spans or {}
                    spans[w.start] = true
                    if n == 2 then
                        spans[nextW.start] = true
                    end
                end
            end
        end
        i = i + used
    end
    return spans
end

-- The same for a timer's tags: { [index] = true } for each tag to paint. A tag may carry a realm.
function H:TagSpans(tags)
    if not self:Active() or type(tags) ~= "table" or #tags == 0 then
        return nil
    end
    local s = H.Settings()
    local name = s.name and self:MyName() or nil
    local group = s.group and self:MyGroup() or nil
    if not name and not group then
        return nil
    end
    local spans
    local i = 1
    while i <= #tags do
        local tag = tostring(tags[i])
        local used = 1
        if name and tag:lower():gsub("%-.*$", "") == name then
            spans = spans or {}
            spans[i] = true
        elseif group then
            local number, n = groupOf(tag, tags[i + 1] and tostring(tags[i + 1]) or nil)
            if number then
                used = n
                if number == group then
                    spans = spans or {}
                    for k = i, i + n - 1 do
                        spans[k] = true
                    end
                end
            end
        end
        i = i + used
    end
    return spans
end

-- A timer line's key for the glow: what it says and when, never how it is drawn.
function H.TimerKey(item)
    return table.concat({ tostring(item.ph or 1), tostring(item.time or 0), tostring(item.spellId or item.text or ""),
        table.concat(item.tags or {}, " ") }, ":")
end

function H.Paint(word)
    return CRT.UI.ColorText(word, "accent")
end

-- Window rows -------------------------------------------------------------------------------------------------
-- A marked row gets a band (accent at BAND_ALPHA) behind its text, from its first cell to the window's width; a
-- glowing row also gets a brighter layer that pulses (an AnimationGroup, no per-frame code) and the "changed" tag
-- at the line's end, in the theme's warn colour, fading with the last pulse. All made the first time a row needs
-- them and kept with the row. Both layers sit on ARTWORK above the window's "note updated" stamp, under the text.

local function anchor(region, row)
    local first = (row.line and row.line.t ~= nil) and row.time or row.text
    region:ClearAllPoints()
    region:SetPoint("TOPLEFT", first, "TOPLEFT", -BAND_PAD, BAND_PAD)
    region:SetPoint("BOTTOMRIGHT", row.text, "BOTTOMRIGHT", BAND_PAD, -BAND_PAD)
end

local function stopGlow(row)
    if row.glowAnim then
        row.glowAnim:Stop()
        row.tagAnim:Stop()
        row.glow:Hide()
        row.tag:Hide()
    end
end

local function makeGlow(w, row)
    local frame = w.frame
    local glow = frame:CreateTexture(nil, "ARTWORK", nil, 2)
    CRT.UI.Tint(glow, "SetColorTexture", "accent", GLOW_ALPHA)
    glow:SetAlpha(0)
    glow:Hide()
    local anim = glow:CreateAnimationGroup()
    for p = 1, GLOW_PULSES do
        local up = anim:CreateAnimation("Alpha")
        up:SetFromAlpha(0)
        up:SetToAlpha(1)
        up:SetDuration(PULSE_SECONDS)
        up:SetOrder(p * 2 - 1)
        local down = anim:CreateAnimation("Alpha")
        down:SetFromAlpha(1)
        down:SetToAlpha(0)
        down:SetDuration(PULSE_SECONDS)
        down:SetOrder(p * 2)
    end
    anim:SetScript("OnFinished", function()
        glow:Hide()
    end)

    local tag = frame:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    tag:SetText(TEXT.changed)
    CRT.UI.Tint(tag, "SetTextColor", "warn")
    tag:Hide()
    local tagAnim = tag:CreateAnimationGroup()
    local fade = tagAnim:CreateAnimation("Alpha")
    fade:SetFromAlpha(1)
    fade:SetToAlpha(0)
    fade:SetStartDelay(H.GLOW_SECONDS - TAG_FADE)
    fade:SetDuration(TAG_FADE)
    tagAnim:SetScript("OnFinished", function()
        tag:Hide()
    end)
    row.glow, row.glowAnim, row.tag, row.tagAnim = glow, anim, tag, tagAnim
end

-- After Window.lua placed a row: its band shown while its line is marked and the row fits; a glow stops with it.
function H.PlaceRow(w, row, fits)
    local on = fits and row.line and row.line.hl and true or false
    if on and not row.band then
        row.band = w.frame:CreateTexture(nil, "ARTWORK", nil, 1)
        CRT.UI.Tint(row.band, "SetColorTexture", "accent", BAND_ALPHA)
    end
    if not row.band then
        return
    end
    row.band:SetShown(on)
    if on then
        anchor(row.band, row)
        if row.glow then
            anchor(row.glow, row)
            row.tag:ClearAllPoints()
            row.tag:SetPoint("TOPRIGHT", row.text, "TOPRIGHT", 0, 0)
        end
    else
        stopGlow(row)
    end
end

-- A row put away for reuse (its line is gone).
function H.HideRow(row)
    if row.band then
        row.band:Hide()
    end
    stopGlow(row)
end

-- Starts a row's glow and its tag (again from the start when it was already glowing).
function H.Glow(w, row)
    if not row.glow then
        makeGlow(w, row)
    end
    anchor(row.glow, row)
    row.tag:ClearAllPoints()
    row.tag:SetPoint("TOPRIGHT", row.text, "TOPRIGHT", 0, 0)
    row.glowAnim:Stop()
    row.tagAnim:Stop()
    row.glow:Show()
    row.tag:SetAlpha(1)
    row.tag:Show()
    row.glowAnim:Play()
    row.tagAnim:Play()
end

-- The glow on change. After a window rebuilt its lines (version: Window.lua's content count), each marked line
-- whose key the window did not show before glows. The keys shown are kept per window; with none kept (the window
-- just opened, after /reload, or it showed nothing) the draw only keeps them, so nothing glows. A preview's first
-- draw (w.hlForce) glows every marked line, to show what a glow looks like.
function H.AfterDraw(w, lines, version)
    if not H:Active() then
        w.hlSeen, w.hlVersion, w.hlForce = nil, nil, nil
        return
    end
    if w.hlVersion == version and not w.hlForce then
        return
    end
    w.hlVersion = version
    local seen, any = {}, false
    for _, line in ipairs(lines) do
        if line.hlKey then
            seen[line.hlKey] = true
            any = true
        end
    end
    local prev, force = w.hlSeen, w.hlForce
    w.hlForce = nil
    if (prev or force) and H:GlowOn() then
        for _, line in ipairs(lines) do
            if line.hl and line.hlKey and (force or not prev[line.hlKey]) then
                local row = w.bound and w.bound[line]
                if row and row.text:IsShown() then
                    H.Glow(w, row)
                end
            end
        end
    end
    w.hlSeen = any and seen or nil
end

-- The window hid: its next draw is a first display again.
function H.Forget(w)
    w.hlSeen, w.hlVersion = nil, nil
end

-- The preview ---------------------------------------------------------------------------------------------------
-- "Preview highlights" (Page.lua) shows the assignments window with a sample note that names you and your group
-- (group 1 out of a raid), its lines marked, and the line with your name glowing once.

local SAMPLE = {
    "Sample assignments",
    "Soak 1: %s Gadios",
    "Soak 2: Djaztech Teronhorefnd",
    "",
    "Kick order",
    "Kicks G%d: Rixxy Cheoeqar",
    "Group %d: stack left",
}

function H.SampleLines()
    local name = UnitName and UnitName("player")
    if not (readable(name) and type(name) == "string" and name ~= "") then
        name = "You"
    end
    local group = H:MyGroup() or 1
    local out = {}
    for i, line in ipairs(SAMPLE) do
        if line:find("%s", 1, true) then
            out[i] = string.format(line, name)
        elseif line:find("%d", 1, true) then
            out[i] = string.format(line, group)
        else
            out[i] = line
        end
    end
    return out
end

H.PREVIEW_KEY = "note-highlights"
CRT.UI:RegisterPreview(H.PREVIEW_KEY, function(on)
    H.previewing = on and true or nil
    if CRT.NoteWindow and CRT.NoteWindow.PreviewHighlights then
        CRT.NoteWindow:PreviewHighlights(on)
    end
end)

-- Redraws the note windows after a setting changed.
function H:Changed()
    if CRT.NoteWindow and CRT.NoteWindow.Changed then
        CRT.NoteWindow:Changed()
    end
end

-- Your group changes with the roster: read it again then, not GROUP_SECONDS later.
local events = CreateFrame("Frame")
events:RegisterEvent("GROUP_ROSTER_UPDATE")
events:SetScript("OnEvent", function()
    H:ResetGroup()
end)
