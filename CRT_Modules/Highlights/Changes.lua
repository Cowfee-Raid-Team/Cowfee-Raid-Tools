local ADDON, CRT = ...

-- Assignment highlights in the note windows' rows (Highlights/Data.lua reads who you are): the band behind a line
-- about you, and what a new version of the same note changed for you.
--   H.Room(w), H.PlaceRow(w, row, fits), H.HideRow(row)   a row's band, glow and tag (Window.lua's drawLines, layoutRows)
--   H.Full(noteKey, entries)                              a window's whole note: every line's identity, mark and text
--   H.BeforeDraw(w, lines, version, full) -> lines        works out the changes, and adds the ghosts of lines gone
--   H.AfterDraw(w)                                        starts the glows of the changed rows
--   H.Forget(w)                                           the window hid: its next draw is a first display
-- The changes, between the previous and the new version of the same note (same boss and difficulty, Data.lua's
-- NoteKey), by line identity (Data.lua's LineId, TimerId):
--   Added    a line names you now and didn't before                       tag in the theme's good colour
--   Removed  a line named you and no longer does; a line that is gone      tag in the theme's bad colour
--            shows as a muted ghost row for the glow's length
--   Moved    you came off one line and onto another in the same change:    tag in the theme's warn colour
--            the new line says Moved, and the pair says nothing else
-- A line you are still on whose other names changed is no change to your assignment: no glow. Lines coming into view
-- (a phase start, a wipe, Show only me) are in the whole note already, so they never glow either.
-- Sizes follow the text (the catalog's "Rows that hold text"): each row's text has its height from its own string at
-- the window's font and size (Window.lua's layoutRows), and the band and glow are anchored to that text's top and
-- bottom, so they cover exactly the text at any font size, wrapped lines included; the tag sits on the first line.

local H = CRT.NoteHighlights

local TEXT = {
    added = "Added",
    removed = "Removed",
    moved = "Moved",
}
H.TEXT = TEXT
-- Each change's tag colour, a theme key (CRT_Dev/StyleGuide.md): good, bad, and warn for in between.
local TAG_COLOR = { added = "good", removed = "bad", moved = "warn" }
H.TAG_COLOR = TAG_COLOR

-- The look: the band's alpha (as the Version list's selected row), the glow's, and how the glow pulses.
local BAND_ALPHA = 0.18
local GLOW_ALPHA = 0.45
local GLOW_PULSES = 3          -- pulses in one glow
local PULSE_SECONDS = 0.5      -- each half of a pulse: GLOW_PULSES * 2 * PULSE_SECONDS = 3 s in all
local TAG_FADE = 1             -- the tag fades out over the glow's last second
local BAND_PAD = 2             -- how far the band reaches past the line's text, left and right (never up or down)
local TAG_GAP = 6              -- between the line's text and its tag
H.BAND_ALPHA, H.GLOW_ALPHA, H.BAND_PAD = BAND_ALPHA, GLOW_ALPHA, BAND_PAD
H.GLOW_SECONDS = GLOW_PULSES * 2 * PULSE_SECONDS

-- Rows ------------------------------------------------------------------------------------------------------------

-- The size of the tags' font, so the room below follows the addon's text size.
local function tagFontSize()
    local font = _G.CRTFontSmall
    if type(font) == "table" and font.GetFont then
        local _, size = font:GetFont()
        return size or 0
    end
    return 0
end

-- The room a marked row keeps at its end for a tag: the widest tag and a gap; 0 while glows are off. Measured on a
-- font string of the tags' font, again when that font's size changes.
function H.Room(w)
    if not H:GlowOn() then
        return 0
    end
    local size = tagFontSize()
    if not w.hlRoom or w.hlRoomSize ~= size then
        local measure = w.hlMeasure
        if not measure then
            measure = w.frame:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
            measure:Hide()
            w.hlMeasure = measure
        end
        local widest = 0
        for _, word in pairs(TEXT) do
            measure:SetText(word)
            widest = math.max(widest, measure:GetStringWidth() or 0)
        end
        w.hlRoom, w.hlRoomSize = math.ceil(widest) + TAG_GAP, size
    end
    return w.hlRoom
end

-- A band or glow over exactly the row's text: from its first cell's top (a timer's time cell, level with the text)
-- to the text's bottom, and across to the window's width.
local function anchor(region, row)
    local first = (row.line and row.line.t ~= nil) and row.time or row.text
    region:ClearAllPoints()
    region:SetPoint("TOPLEFT", first, "TOPLEFT", -BAND_PAD, 0)
    region:SetPoint("BOTTOMRIGHT", row.text, "BOTTOMRIGHT", BAND_PAD + (row.hlRoom or 0), 0)
end

-- The tag beside the text's first line, centred on it at the window's font size.
local function placeTag(w, row)
    row.tag:ClearAllPoints()
    row.tag:SetPoint("LEFT", row.text, "TOPRIGHT", TAG_GAP, -(w.lineH or 14) / 2)
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
    -- done: the line keeps no room for a tag, and a ghost goes (the windows redraw)
    anim:SetScript("OnFinished", function()
        glow:Hide()
        local line = row.line
        if line then
            line.hlTag = nil
            if line.hlGhost then
                line.hlDone = true
            end
        end
        H:Changed()
    end)

    local tag = frame:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
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

-- After Window.lua placed a row: its band while its line is marked and the row fits; a glow follows the row, and
-- stops when the row no longer fits or the module is off.
function H.PlaceRow(w, row, fits)
    local on = fits and row.line and row.line.hl and true or false
    if on and not row.band then
        row.band = w.frame:CreateTexture(nil, "ARTWORK", nil, 1)
        CRT.UI.Tint(row.band, "SetColorTexture", "accent", BAND_ALPHA)
    end
    if row.band then
        row.band:SetShown(on)
        if on then
            anchor(row.band, row)
        end
    end
    if row.glow then
        if fits and H:Active() then
            anchor(row.glow, row)
            placeTag(w, row)
        else
            stopGlow(row)
        end
    end
end

-- A row put away for reuse (its line is gone).
function H.HideRow(row)
    if row.band then
        row.band:Hide()
    end
    stopGlow(row)
end

-- Starts a row's glow with its tag for a change ("added", "removed" or "moved"), again from the start when it was
-- already glowing.
function H.Glow(w, row, kind)
    if not row.glow then
        makeGlow(w, row)
    end
    kind = TEXT[kind] and kind or "moved"
    row.tag:SetText(TEXT[kind])
    CRT.UI.Tint(row.tag, "SetTextColor", TAG_COLOR[kind])
    row.glowKind = kind
    anchor(row.glow, row)
    placeTag(w, row)
    row.glowAnim:Stop()
    row.tagAnim:Stop()
    row.glow:Show()
    row.tag:SetAlpha(1)
    row.tag:Show()
    row.glowAnim:Play()
    row.tagAnim:Play()
end

-- Changes ---------------------------------------------------------------------------------------------------------

-- A window's whole note: entries in note order, each { id, marked, text, raw } (text: how a ghost of it reads; raw:
-- what it says, for telling a new version from a redraw). Returns { note, order, lines = { [id] = entry }, sig }, or
-- nil while the module is off.
function H.Full(noteKey, entries)
    if not H:Active() or noteKey == nil then
        return nil
    end
    local order, lines, raws = {}, {}, {}
    for _, e in ipairs(entries) do
        if e.id and not lines[e.id] then
            order[#order + 1] = e.id
            lines[e.id] = e
            raws[#raws + 1] = e.raw or ""
        end
    end
    return { note = noteKey, order = order, lines = lines, sig = table.concat(raws, "\n") }
end

-- A line's text as a ghost: its colours taken out, in the theme's muted colour.
function H.Muted(text)
    local plain = tostring(text or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")
    return CRT.UI.ColorText(plain, "muted")
end

local function mark(w, line, kind)
    line.hlTag = kind
    w.hlPending[#w.hlPending + 1] = line
end

-- A ghost of a line gone, under the shown line it stood under (after: that line's identity, nil for the top).
local function addGhost(w, text, after)
    local line = { x = H.Muted(text), hlGhost = true, hlTag = "removed" }
    line.hlId = "ghost:" .. tostring(line)
    w.hlGhosts = w.hlGhosts or {}
    table.insert(w.hlGhosts, { line = line, after = after, untilT = GetTime() + H.GLOW_SECONDS })
    w.hlPending[#w.hlPending + 1] = line
end

-- Added, Removed and Moved between two versions of the same note (see the top).
local function diff(w, shown, prev, full)
    local added, removed = {}, {}
    for _, id in ipairs(full.order) do
        local p = prev.lines[id]
        if full.lines[id].marked and not (p and p.marked) then
            added[#added + 1] = id
        end
    end
    for i, id in ipairs(prev.order) do
        local n = full.lines[id]
        if prev.lines[id].marked and not (n and n.marked) then
            removed[#removed + 1] = i
        end
    end
    -- each line you came off pairs with a line you went onto, in note order: Moved
    local moved = math.min(#added, #removed)
    for i, id in ipairs(added) do
        if shown[id] then
            mark(w, shown[id], i <= moved and "moved" or "added")
        end
    end
    for i = moved + 1, #removed do
        local index = removed[i]
        local id = prev.order[index]
        if shown[id] then
            mark(w, shown[id], "removed")
        else
            -- gone, or no longer shown: a ghost under the nearest line before it that is still shown
            local after
            for j = index - 1, 1, -1 do
                if shown[prev.order[j]] then
                    after = prev.order[j]
                    break
                end
            end
            addGhost(w, prev.lines[id].text, after)
        end
    end
end

-- The preview's first draw: one of each change on the sample (Data.lua's H.sample).
local function preview(w, shown)
    local sample = H.sample
    if not sample then
        return
    end
    for id, kind in pairs(sample.kinds) do
        if shown[id] then
            mark(w, shown[id], kind)
        end
    end
    addGhost(w, sample.ghost.text, sample.ghost.after)
end

-- The lines with the ghosts still glowing placed among them; the lines themselves when there are none.
local function withGhosts(w, lines)
    local ghosts = w.hlGhosts
    if not ghosts then
        return lines
    end
    local now = GetTime()
    for i = #ghosts, 1, -1 do
        if ghosts[i].line.hlDone or now >= ghosts[i].untilT then
            table.remove(ghosts, i)
        end
    end
    if #ghosts == 0 then
        w.hlGhosts = nil
        return lines
    end
    local out, placed = {}, {}
    for _, g in ipairs(ghosts) do
        if g.after == nil then
            out[#out + 1] = g.line
            placed[g] = true
        end
    end
    for _, line in ipairs(lines) do
        out[#out + 1] = line
        if line.hlId then
            for _, g in ipairs(ghosts) do
                if not placed[g] and g.after == line.hlId then
                    out[#out + 1] = g.line
                    placed[g] = true
                end
            end
        end
    end
    for _, g in ipairs(ghosts) do
        if not placed[g] then
            out[#out + 1] = g.line
        end
    end
    return out
end

-- Before a window draws (version: Window.lua's content count; full: its whole note, or nil): after a rebuild, works
-- out what changed for you since the version of the same note it drew before, marks the changed lines and adds the
-- ghosts. Only a new version of the note counts: a redraw of the same text (a theme, a roster or role change, Show
-- only me, a phase) never does. Returns the lines to draw.
function H.BeforeDraw(w, lines, version, full)
    if not H:Active() or not full then
        H.Forget(w)
        return lines
    end
    if w.hlVersion ~= version or w.hlForce then
        w.hlVersion = version
        local prev, force = w.hlFull, w.hlForce
        w.hlForce = nil
        w.hlPending = {}
        if H:GlowOn() and (force or (prev and prev.note == full.note and prev.sig ~= full.sig)) then
            local shown = {}
            for _, line in ipairs(lines) do
                if line.hlId then
                    shown[line.hlId] = line
                end
            end
            if force then
                preview(w, shown)
            else
                diff(w, shown, prev, full)
            end
        end
        w.hlFull = #full.order > 0 and full or nil
    end
    return withGhosts(w, lines)
end

-- After the window drew: the changed rows glow, each with its change's tag.
function H.AfterDraw(w)
    local pending = w.hlPending
    if not pending then
        return
    end
    w.hlPending = nil
    for _, line in ipairs(pending) do
        local row = w.bound and w.bound[line]
        if row and row.text:IsShown() then
            H.Glow(w, row, line.hlTag)
        else
            line.hlTag = nil -- not on screen: it keeps no room for a tag
        end
    end
end

-- The window hid, or a preview ended: its next draw is a first display again, and any ghost goes.
function H.Forget(w)
    w.hlFull, w.hlVersion, w.hlForce, w.hlPending, w.hlGhosts = nil, nil, nil, nil, nil
end
