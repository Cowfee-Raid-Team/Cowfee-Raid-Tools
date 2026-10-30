local ADDON, CRT = ...

-- The Mech Alerts panel's Assign tab (Notes/Reminders.lua builds it into its Assign subtab, Alerts/SubTabs.lua; the
-- panel only, never the pop-out alert editor): assignments for the selected mechanic, such as soaks or sides, written
-- into the boss's raid note for the difficulty on show. Left, the block editor (Notes/AssignBlock.lua): Name (the
-- mechanic's name by default), Assignment (which of the mechanic's blocks, with its (?)), Times (the mechanic's casts on
-- the ability timeline, read only; typed for your own reminder or a mechanic with no casts), the rows, + Row and Quick
-- fill, the note's status, and + Assignment (another block on the same mechanic) and Remove. Right, the note editor's
-- own palette (Notes/Palette.lua), 218 wide.
-- The note is the one source: a mechanic's blocks are the ones whose heading names it (Assign.BlocksFor: for:, its
-- MechNote.Key), read whenever another mechanic, difficulty or ability timeline is shown; nothing is saved anywhere
-- else, and no reminder is made. Every change writes the block back at once (Assign.Write, into the note the pull of
-- that difficulty reads, Notes:WriteTarget), refused with the reason on the panel's red line: you may not change the
-- raid note, combat or a boss encounter (Notes.Busy), the pull reads another difficulty's note, or the name is
-- another block's or list's in that note (Assign.KeyTaken). A block's lines follow the ability timeline on their own
-- (written again when its casts moved) only when Read found both its heading and its lines, Times from shows the
-- boss's default ability timeline, and never mid-pull. Raid note alert lines of the same mechanic stay beside them.
--   Tab.Build(frame, host)   host: x, y, width, height (the tab's area in frame), current() (the panel's mechanic:
--                            enc, item, name, bossName, ref, group, defaultTimeline), notice(message) (the panel's red
--                            line)
--   tab.Refresh(), tab.Leave(), Tab.HasNames()

local UI = CRT.UI
local Assign = CRT.NoteAssign
local Palette = CRT.NotePalette
local Model = CRT.NoteEditModel

local Tab = {}
CRT.NoteAssignTab = Tab

-- Every word on the tab, in one place. Keep the keys, change the text in quotes, save, /reload.
local TEXT = {
    pick = "Assignment",
    pickHelp = "This mechanic's assignments in the raid note: pick the one to change. + Assignment adds another, such as a second set of soaks. Each has its own name in the note.",
    addBlock = "+ Assignment",
    removeBlock = "Remove",
    removeConfirm = "Take the assignment '%s' out of the raid note?",
    inNote = "In the raid note for %s (%s): %s.",
    rowsOnly = "In the raid note for %s (%s): the heading and its rows.",
    oneLine = "1 timer line",
    manyLines = "%d timer lines",
    notYet = "Not in the raid note yet. Any change writes it there.",
    badTimes = "The times don't read: %s",
    pending = "Make a change on another tab first, so this reminder is saved.",
}
Tab.TEXT = TEXT

local L = {
    colW = 484, paletteW = 218, -- the approved mock-up's columns
    pickLabelW = 70, pickW = 120, -- the block picker, right of Name, then its (?)
    buttonH = 22, buttonGap = 6,
}
Tab.L = L

-- The tab's state: the mechanic shown (sig, c), its blocks (each with key: the note's marker, nil before the first
-- write), the one on show, and the palette's (P).
local S = { blocks = {}, index = 1 }
local P = { picked = {} }
local host, ui

local function current()
    return host and host.current() or {}
end

local function difficultyOf(c)
    return CRT.MechNote.NoteDifficulty(c.ref, c.group)
end

-- The note the lines go to (MechNote.FindNote, Notes:WriteTarget), its id, and when there is none because the pull
-- reads another difficulty's note, the reason.
local function noteRecord(c)
    if not c.enc then
        return nil
    end
    local id, why = CRT.MechNote.FindNote(c.enc, difficultyOf(c))
    return id and CRT.Notes:Get(id), id, why
end

local function block()
    return S.blocks[S.index]
end

-- The mechanic's key (MechNote.Key: its spell, else its name), which its blocks' headings name.
local function mechOf(c)
    return CRT.MechNote.Key(c.item and c.item.spellID, c.name)
end

-- The mechanic's casts (the ability timeline's, for the group on show), and whether its times are typed instead: your
-- own reminder, or a mechanic with no casts. Typed: the reminder's own times as a default.
local function castsOf(c)
    local Reminders = CRT.AlertReminders
    local item = c.item
    if not (Reminders and c.enc and item) then
        return {}, true, {}
    end
    local probe = item.r and CRT.AlertDraft.copy(item.r) or { spellID = item.spellID, text = c.name, boss = c.bossName }
    local ok, found, source = pcall(Reminders.Times, Reminders, c.enc, probe, c.ref, c.group)
    if not ok then
        geterrorhandler()(found)
        return {}, true, {}
    end
    if item.ability and source == "reference" and #found > 0 then
        return found, false
    end
    return {}, true, source == "typed" and found or {}
end

-- The times a block's lines go on: the casts, or its typed times.
local function timesOf(b)
    if S.typed then
        return b and b.times or {}
    end
    return S.casts or {}
end

local function itemSig(c)
    local item = c.item
    local id = item and (item.pending and "new" or item.ability and ("a:" .. tostring(item.spellID or item.ability.name))
        or ("r:" .. tostring(item.id)))
    return table.concat({ tostring(c.enc), tostring(id), tostring(c.group), difficultyOf(c), tostring(c.ref) }, "|")
end

-- Reads the mechanic's blocks from the note (a new one, not written yet, when it has none). Every write goes to the
-- mechanic they were read for (S.c), so typing saved as another row is picked still lands on its own.
local function load(c)
    S.sig, S.c = itemSig(c), c
    S.blocks, S.index = {}, 1
    local casts, typed, own = castsOf(c)
    S.casts, S.typed = casts, typed
    local record = noteRecord(c)
    local raw = record and record.raw or ""
    for _, key in ipairs(Assign.BlocksFor(raw, mechOf(c))) do
        local b = Assign.Read(raw, key, (not typed) and casts or nil)
        if b then
            if not typed then
                b.times = nil -- the mechanic's casts now
            end
            S.blocks[#S.blocks + 1] = b
        end
    end
    if #S.blocks == 0 then
        local b = Assign.NewBlock(Assign.FreeName(raw, c.name))
        b.spellID = c.item and c.item.spellID
        if typed and own and #own > 0 then
            b.times = Assign.SortTimes(own)
        end
        S.blocks[1] = b
    end
end

local function linesOf(c, b, key)
    return Assign.Lines(b, timesOf(b), { key = key, spellID = c.item and c.item.spellID, mech = mechOf(c) })
end

-- Whether a block's lines in the note are what it would write now (the ability timeline may have moved a cast). How
-- its names are written never counts (Assign.NameForm): an older block's "Abu-Sargeras, Cheo" stays as it is.
local function inStep(c, b, raw)
    return Assign.NameForm(Assign.Replace(raw, b.key, linesOf(c, b, b.key), b.key)) == Assign.NameForm(raw)
end

-- Writes a block into the note. False, with the reason on the panel's line, when it can't be: nothing written, and
-- the block read again from the note.
local function write(c, b)
    local allowed, why = CRT.MechNote.CanWrite(c.enc, difficultyOf(c))
    local key = Assign.Key(b.name)
    if allowed then
        S.writing = true
        local ok, id, refused = pcall(Assign.Write, c.enc, difficultyOf(c), c.bossName, key, linesOf(c, b, key), b.key)
        S.writing = false
        if not ok then
            geterrorhandler()(id)
            return false
        end
        allowed, why = id ~= nil, refused
    end
    if not allowed then
        host.notice(why)
        S.sig = nil
        return false
    end
    b.key = key
    host.notice(nil)
    return true
end

-- The block editor changed the block: typed times read, then written.
local function changed(kind)
    local c = S.c or current()
    local b = block()
    if not (b and c.enc) then
        return
    end
    if kind == "times" then
        local text = CRT.AlertDraft.trim(ui.timesEdit:GetText())
        if text == "" then
            b.times = nil
        else
            local list, err = CRT.AlertReminders.ParseTimes(text)
            if not list then
                host.notice(string.format(TEXT.badTimes, tostring(err)))
                return
            end
            b.times = Assign.SortTimes(list)
        end
    end
    write(c, b)
    Tab.Refresh()
end

-- The status line: how many timer lines the note has, or why they don't run.
local function drawStatus(c)
    local b = block()
    local text = ""
    local record, _, why = noteRecord(c)
    local difficulty = difficultyOf(c)
    if c.item and c.item.pending then
        text = UI.WarnText(TEXT.pending)
    elseif why then
        text = UI.WarnText(why) -- the pull reads another difficulty's note: what to do first
    elseif not (b and b.key and record) then
        text = UI.WarnText(TEXT.notYet)
    else
        local n = Assign.CountIn(record.raw or "", b.key)
        if n == 0 then
            text = UI.GoodText(string.format(TEXT.rowsOnly, tostring(c.bossName), difficulty))
        else
            local lines = n == 1 and TEXT.oneLine or string.format(TEXT.manyLines, n)
            text = UI.GoodText(string.format(TEXT.inNote, tostring(c.bossName), difficulty, lines))
        end
    end
    ui.status:SetText(text)
end

-- Whether you may change the blocks now: you may change the raid note (writes ask MechNote.CanWrite again).
local function readOnly()
    local c = current()
    if not c.enc or (c.item and c.item.pending) then
        return true
    end
    return not CRT.AlertDraft.CanEditRaid()
end

-- The palette ---------------------------------------------------------------------------------------------------------

local function inviteNames()
    local record = noteRecord(current())
    return record and Model.New(record.raw or ""):InviteNames() or {}
end

local function linkedLayout()
    local record = noteRecord(current())
    local id = record and record.presetId
    return Palette.FindLayout(id) and id or nil
end

local function drawPalette()
    local from = P.playersFrom
    if not Palette.ValidSource(from) then
        from = Model.DefaultSource(linkedLayout(), IsInGroup and IsInGroup() or false)
        P.playersFrom = from
    end
    local classOf = from ~= Model.SOURCE_GROUP and Palette.ClassLookup() or nil
    Palette.Draw(P, Palette.Roster(from, inviteNames, classOf), Palette.InnerWidth(L.paletteW))
end

-- The tab ------------------------------------------------------------------------------------------------------------

-- The lines follow the ability timeline: a block written again when its casts moved, only when its heading and its
-- lines are both in the note, Times from shows the boss's default ability timeline, and never mid-pull.
local function follow(c)
    local record = noteRecord(c)
    if not (record and not S.typed and c.defaultTimeline ~= false and CRT.MechNote.CanWrite(c.enc, difficultyOf(c))) then
        return
    end
    local shown = S.index
    for i, b in ipairs(S.blocks) do
        if b.key and b.hasHeading and b.hasLines and not inStep(c, b, record.raw or "") then
            S.index = i
            write(c, b)
            record = noteRecord(c) or record
        end
    end
    S.index = shown
end

function Tab.Refresh()
    if not (ui and host) or S.writing then
        return
    end
    local c = current()
    if itemSig(c) ~= S.sig then
        ui:Flush()
        load(c)
        follow(c)
    end
    ui:Refresh()
    drawStatus(S.c or c)
    S.pick.refresh()
    local ro = readOnly()
    S.remove:SetEnabled(not ro and block() ~= nil and block().key ~= nil)
    S.add:SetEnabled(not ro)
    if P.from then
        P.from.refresh()
    end
end

-- Leaving the tab (another subtab, row or boss): typing is saved.
function Tab.Leave()
    if ui then
        ui:Flush()
    end
    if P.drag then
        P.drag:Cancel()
    end
end

-- Whether the mechanic on show has a block in the note with someone in it (the tab's dot).
function Tab.HasNames()
    for _, b in ipairs(S.blocks) do
        if b.key and Assign.HasNames(b) then
            return true
        end
    end
    return false
end

-- + Assignment: another block on the same mechanic, named after it with the next free number, written at once.
local function addBlock()
    local c = S.c or current()
    if readOnly() then
        return
    end
    ui:Flush()
    local record = noteRecord(c)
    local raw = record and record.raw or ""
    for _, b in ipairs(S.blocks) do
        if not b.key then
            raw = raw .. "\n" .. table.concat(linesOf(c, b, Assign.Key(b.name)), "\n") -- a block not written yet holds its name
        end
    end
    local b = Assign.NewBlock(Assign.FreeName(raw, Assign.CleanName(c.name) .. " 2"))
    b.spellID = c.item and c.item.spellID
    S.blocks[#S.blocks + 1] = b
    S.index = #S.blocks
    if not write(c, b) then
        table.remove(S.blocks)
        S.index = 1
    end
    Tab.Refresh()
end

-- Remove: the block on show taken out of the note, after a confirmation.
local function removeBlock()
    local c = S.c or current()
    local b = block()
    if not (b and b.key) or readOnly() then
        return
    end
    local function go()
        local allowed, why = CRT.MechNote.CanWrite(c.enc, difficultyOf(c))
        if allowed then
            S.writing = true
            local ok, err = pcall(Assign.Write, c.enc, difficultyOf(c), c.bossName, b.key, {})
            S.writing = false
            if not ok then
                geterrorhandler()(err)
                return
            end
        else
            host.notice(why)
            return
        end
        S.sig = nil
        Tab.Refresh()
    end
    if StaticPopup_ShowCustomGenericConfirmation then
        UI.LiftOver(UI.ShownPopup(StaticPopup_ShowCustomGenericConfirmation({
            text = string.format(TEXT.removeConfirm, Assign.CleanName(b.name)),
            acceptText = TEXT.removeBlock,
            cancelText = CANCEL,
            showAlert = true,
            callback = go,
        }), "GENERIC_CONFIRMATION"))
    else
        go()
    end
end

function Tab.Build(frame, h)
    host = h
    S, P = { blocks = {}, index = 1 }, { picked = {} } -- a new tab: its own state and palette
    local BL = CRT.NoteAssignBlock.L
    ui = CRT.NoteAssignBlock.Build(frame, {
        x = h.x, y = h.y, width = L.colW, height = h.height,
        nameWidth = L.colW - BL.labelW - 8 - (L.pickLabelW + 5 + L.pickW) - UI.HELP_GAP - UI.HELP_SIZE - 12,
        state = P,
        names = { rows = "CowfeeRaidToolsAssignRows" },
        block = block,
        times = function()
            return timesOf(block()), S.typed
        end,
        timesText = function()
            local b = block()
            return (b and b.times) and CRT.AlertReminders.FormatTimes(b.times) or ""
        end,
        changed = changed,
        readOnly = readOnly,
    })
    -- the block picker, right of Name, with its (?)
    S.pick = UI.Dropdown(ui.content, TEXT.pick, {
        labelWidth = L.pickLabelW, width = L.pickW,
        options = function()
            local out = {}
            for i, b in ipairs(S.blocks) do
                out[i] = { key = i, label = Assign.CleanName(b.name) }
            end
            return out
        end,
        get = function()
            return S.index
        end,
        set = function(i)
            if S.blocks[i] and i ~= S.index then
                ui:Flush()
                S.index = i
                Tab.Refresh()
            end
        end,
    })
    S.pick:SetPoint("TOPRIGHT", ui.content, "TOPRIGHT", -(UI.HELP_GAP + UI.HELP_SIZE + 6), 5)
    S.pickHelp = UI.HelpRight(S.pick, TEXT.pick, TEXT.pickHelp)
    -- + Assignment and Remove, bottom right of the column
    S.remove = UI.PanelButton(ui.content, TEXT.removeBlock, L.buttonH, removeBlock)
    S.remove:SetPoint("BOTTOMRIGHT", 0, 0)
    S.add = UI.PanelButton(ui.content, TEXT.addBlock, L.buttonH, addBlock)
    S.add:SetPoint("RIGHT", S.remove, "LEFT", -L.buttonGap, 0)
    -- the palette, right
    Palette.Drag(P, CRT.NoteAssignBlock.DragOpts(ui))
    local right = Palette.Build(frame, P, {
        width = L.paletteW,
        names = { search = "CowfeeRaidToolsAssignSearch", scroll = "CowfeeRaidToolsAssignPalette" },
        onSearch = drawPalette,
        choices = function()
            return Palette.Choices(linkedLayout(), noteRecord(current()) == nil)
        end,
        get = function()
            return P.playersFrom
        end,
        set = function(key)
            P.playersFrom = key
            drawPalette()
            P.from.refresh()
        end,
    })
    right:SetPoint("TOPLEFT", frame, "TOPLEFT", h.x + h.width - L.paletteW, h.y)
    right:SetHeight(h.height)
    S.right = right
    frame:HookScript("OnShow", function()
        drawPalette()
        Tab.Refresh()
    end)
    frame:HookScript("OnHide", Tab.Leave)
    -- the group or a layout changed: the palette's players
    if CRT.Groups and CRT.Groups.OnChange then
        CRT.Groups:OnChange(function()
            if frame:IsVisible() then
                drawPalette()
            end
        end)
    end
    local events = CreateFrame("Frame", nil, frame)
    events:RegisterEvent("GROUP_ROSTER_UPDATE")
    events:SetScript("OnEvent", function()
        if frame:IsVisible() then
            drawPalette()
            Tab.Refresh() -- a promotion unlocks it, a demotion locks it
        end
    end)
    Tab.ui, Tab.state, Tab.palette = ui, S, P
    return Tab
end
