local ADDON, CRT = ...

-- The Interrupts page, after Pace in the menu, shown only while Enable Interrupts is on (General Settings). Two tabs:
--   Assignments  the boss and difficulty (every kick setup, Interrupts:Bosses) with Edit setup beside it (your own
--                setup, Interrupts/SetupEditor.lua), the status bar (which list is in use and your kick), the Kick
--                list heading (its (?) is how the numbers are worked out: the setup, read-only), the kick rows
--                (Interrupts/PageGrid.lua: a row of chips per group, scrolling when they don't fit), Clear list, Use
--                the raid's list, Share to raid, Who has it (N of M) (Interrupts/WhoWindow.lua, a pop-out), Test on
--                trash, Preview reminder and Write to the raid note (Interrupts/NoteBlock.lua); on the right, the
--                players to drag onto the rows (Interrupts/PagePalette.lua)
--   Settings     the numbers above the nameplates, the reminder and sharing
-- Opening a boss reads its raid note's kick block into the raid's list (NoteBlock.ReadInto), again only once the boss
-- or the note's text changed. The rows edit your own list, and are read-only in a group for anyone who can't share.
-- Work once, draw often: Page.Refresh marks the page to be drawn and draws it once on the next frame, however many
-- changes asked for it; showing the page draws it once at once; the group and the Raid Groups layouts are worked out
-- once until they change (Page.Cache). While the page is open it follows the group (GROUP_ROSTER_UPDATE,
-- PARTY_LEADER_CHANGED) and the enemy nameplates switch (CVAR_UPDATE). Page.perf, when a dev probe sets it, is told how
-- long each show and each refresh took (debugprofilestop). Game calls (warcraft.wiki.gg, read 2026-10-28/29):
-- GetCVar("nameplateShowEnemies"), GetDifficultyInfo(difficultyID) -> name, CVAR_UPDATE (cvarName, value),
-- GROUP_ROSTER_UPDATE, PARTY_LEADER_CHANGED, C_Timer.After(seconds, fn), debugprofilestop() -> milliseconds.

local UI = CRT.UI
local Interrupts = CRT.Interrupts
local Anchor = CRT.InterruptAnchor
local KickComm = CRT.InterruptComm
local Setup = CRT.InterruptSetup

local Page = { tabs = {}, swatches = {} }
CRT.InterruptsPage = Page

local TEXT = {
    title = "Interrupts",
    help = "Kick numbers above a boss's adds, a reminder before your own kick, and the raid leader's kick list.\n\nSome bosses number their adds by timing: the game hides every add's name and spells in a raid fight, so an add is known by when its first cast starts. Others number by raid marker: each group kicks the add with its marker, in turn.\n\nNumbers only show for adds whose nameplate is on your screen.",
    assignments = "Assignments",
    settings = "Settings",
    boss = "Boss",
    bossHelp = "Every boss and difficulty with a kick setup: the one CRT ships, or your own.",
    editSetup = "Edit setup",
    editSetupHelp = "Make your own kick setup for any boss and difficulty: the spell, the groups, their raid markers and how many kick each. Yours is used in place of the one CRT ships, until you go back to it.",
    custom = "your setup",
    noBoss = "No boss with kick numbers is loaded.",
    nameplatesOff = "Enemy nameplates are off (Interface > Nameplates), so no numbers can show.",
    statusNone = "No kick list for this boss yet.",
    statusOwn = "Your own kick list is in use.",
    statusRaid = "The raid's kick list from %s is in use.",
    yourKick = "Your kick: %s #%d %s.",
    notOn = "You are not on it.",
    kick = "%s #%d",
    list = "Kick list",
    clear = "Clear list",
    clearAsk = "Empty every name on your own kick list for %s?",
    useRaid = "Use the raid's list",
    useRaidAsk = "Copy the raid's kick list from %s over your own list for %s?",
    share = "Share to raid",
    shareHelp = "Sends your list to everyone in the group with CRT and Interrupts on. Only the raid leader or an assistant can share, with every slot filled, before the pull. A shared list sets each raider's number at once.",
    write = "Write to the raid note",
    writeHelp = "Puts your list in the raid note this boss's pull reads on this difficulty, as an intstart block: one line per group, the names in kick order. Press it again after you change the list.\n\nOpening a boss reads the block back as the raid's list, when every line has all of its group's names (or none).",
    writeDone = "Wrote the kick list into the raid note \"%s\".",
    writeEmpty = "The kick list is empty, so the raid note \"%s\" has no kick block now.",
    writeNothing = "The kick list is empty: nothing to write.",
    test = "Test on trash",
    testHelp = "Tries the boss shown on trash. By timing: any pack is numbered by the order its mobs start casting, the first two 1, the next two 2, and so on. By raid marker: mark a mob with a group's marker, and its number moves on with each cast. Turns off when you change zone.",
    preview = "Preview reminder",
    how = "How the numbers are worked out",
    howHelp = "The boss's kick setup. A setup by timing is as CRT ships it: if a hotfix moves the adds, numbers stop showing or land on the wrong adds until CRT is updated.",
    howSpell = "Kicks: %s.",
    howNoSpell = "Kicks: the spell isn't named.",
    howMarker = "Each group kicks the add with its raid marker, in turn.",
    howTurn = "The number on the add is whose kick its cast is, then the next on each cast.",
    howGroup = "%s%s: %d to kick.",
    howNoMarker = "%s: %d to kick, no raid marker.",
    howPairs = "Each number is %d adds in a row.",
    howAnchor = "A wave starts at cast %d of every %d from %s.",
    howFirst = "Add 1 casts %s s after it, then one every %s s.",
    howTolerance = "A cast more than %s s off its beat is not an add.",
    howAdds = "%d adds a wave, %d to a number.",
    howWindow = "A cast over %d s after the wave's start is not in it.",
    howFallback = "Without a cast count, waves start at %s.",
    plates = "Numbers above nameplates",
    platesHelp = "The box above each add's nameplate. Your kick is in your colours; the other numbers show only with Show every number.",
    platesOn = "Show numbers in the pull",
    all = "Show every number",
    allHelp = "Shows the other kicks' numbers too, in the other colours.",
    size = "Box size",
    font = "Number size",
    offset = "Height above the plate",
    yours = "Your kick",
    others = "Other kicks",
    box = "Box",
    number = "Number",
    reminder = "Reminder",
    reminderHelp = "Your interrupt's icon with your kick. By timing, it counts down the last 5 seconds before your pair's first cast. By raid marker, it says Your kick next when your add's cast is yours. Move it with Previews.",
    reminderOn = "Count down before my kick",
    sound = "Sound",
    reminderSize = "Size",
    sharing = "Sharing",
    sharingHelp = "Ticked, a kick list the raid leader or an assistant shares replaces the raid's list here and sets your number. Your own list is never changed.",
    accept = "Accept kick lists from the leader and assistants",
    ok = "OK",
    cancel = "Cancel",
    confirm = "Interrupts",
    slashOff = "Interrupts is switched off. Tick Enable Interrupts on General Settings first.",
    soundNone = "None",
}
Page.TEXT = TEXT

-- Every place and size on the page, from the page's top left (UI.PAGE_W x UI.PAGE_H); the tab frames start at contentY.
local LAYOUT = {
    tabY = -36, contentY = -66, tabW = 160, tabH = 26, tabGap = 4,
    leftX = 8, rightX = 630,
    bossY = -8, bossLabelW = 40, bossW = 300, editGap = 34,
    statusY = -46, statusH = 28,
    -- the Kick list heading, then its rows (Interrupts/PageGrid.lua): a row per group, scrolling past gridMaxH
    listY = -86, gridY = -110, gridMaxH = 280,
    buttonGap = 16, buttonH = 22, buttonSpace = 6, testGap = 38, previewX = 284,
    howLines = 6, -- the most lines How the numbers are worked out lists
    -- the right column: the players (Interrupts/PagePalette.lua)
    -- the Settings tab
    setX2 = 520, setLabelW = 150, setControlW = 160, swatchW = 36, swatchH = 18, swatchLabelW = 100, swatchStep = 100,
    platesY = { head = -8, on = -28, all = -52, size = -80, font = -114, offset = -148, yours = -192, others = -222 },
    reminderY = { head = -8, on = -28, sound = -56, size = -92, sharing = -144, accept = -164 },
    reminderLabelW = 80, soundW = 200,
    checkSize = 24, checkInset = 4,
    greyAlpha = 0.4, -- a greyed swatch, as a disabled checkbox fades
}
LAYOUT.rightW = UI.PAGE_W - LAYOUT.rightX - 8
LAYOUT.statusW = LAYOUT.rightX - LAYOUT.leftX - 22
LAYOUT.gridW = LAYOUT.rightX - LAYOUT.leftX - 22 - UI.ScrollGutter()
Page.LAYOUT = LAYOUT
local L = LAYOUT
local TAB_Y, CONTENT_Y = L.tabY, L.contentY

local page
local selected -- the boss shown
local controls = {}
local refresh

local function settings()
    return Interrupts:Settings()
end

-- The setup shown: its key ("encounterID:difficultyID").
local function boss()
    local list = Interrupts:Bosses()
    for _, b in ipairs(list) do
        if b.key == selected then
            return selected
        end
    end
    selected = list[1] and list[1].key or nil
    return selected
end
Page.Boss = boss

-- What a boss's kick block is read from: the key, the note's id and its text. The block is read again only when this
-- changed since the last read.
local function noteSignature(key)
    local Block, Notes = CRT.InterruptNote, CRT.Notes
    local ok, id = pcall(Block.NoteOf, key)
    local record = ok and id and Notes and Notes.Get and Notes:Get(id)
    return key .. "\0" .. tostring(ok and id or "") .. "\0" .. tostring(record and record.raw or "")
end

-- The raid note's kick block read into the raid's list; a block that doesn't fit says so once.
local noFitSaid = {}
local lastRead
local function readNote(key)
    if not (key and CRT.InterruptNote) then
        return
    end
    local sig = noteSignature(key)
    if sig == lastRead then
        return
    end
    lastRead = sig
    Page.counts.note = Page.counts.note + 1
    local ok, _, why = pcall(CRT.InterruptNote.ReadInto, key)
    if ok and why and not noFitSaid[why] then
        noFitSaid[why] = true
        CRT:Print(why)
    end
end
Page.ReadNote = readNote

-- Shows a setup, its raid note's kick block read in first.
local function choose(key)
    selected = key
    Page.ClearCache()
    readNote(key)
    refresh()
end
Page.Choose = function(key)
    choose(key)
end

local function label(parent, text, font)
    local fs = parent:CreateFontString(nil, "OVERLAY", font or "CRTFontSmall")
    fs:SetJustifyH("LEFT")
    fs:SetText(text)
    return fs
end
Page.Label = label

-- A button as wide as its label.
local function button(parent, text, onClick)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontButtonSmall)
    b:SetHighlightFontObject(CRTFontButtonSmallHighlight)
    b:SetDisabledFontObject(CRTFontButtonSmallDisable)
    b:SetText(text)
    local fs = b:GetFontString()
    b:SetSize(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0), L.buttonH)
    b:SetScript("OnClick", onClick)
    return b
end
Page.Button = button

-- A label in the theme's text colour, or its muted colour while what it names is greyed out.
local function greyLabel(fs, on)
    fs:SetTextColor(UI.Color(on and "text" or "muted"))
end

-- enabledIf, when given, greys the box and its label while it returns false (the switch it depends on is off).
local function checkbox(parent, x, y, text, get, set, enabledIf)
    local cb = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
    cb:SetSize(L.checkSize, L.checkSize)
    cb:SetPoint("TOPLEFT", x, y)
    cb.label = label(parent, text)
    cb.label:SetPoint("LEFT", cb, "RIGHT", 2, 0)
    cb:SetScript("OnClick", function(self)
        set(self:GetChecked() and true or false)
    end)
    cb.refresh = function()
        cb:SetChecked(get() and true or false)
        if enabledIf then
            local on = enabledIf() and true or false
            cb:SetEnabled(on)
            greyLabel(cb.label, on)
        end
    end
    controls[#controls + 1] = cb
    return cb
end

local function add(row, x, y)
    row:SetPoint("TOPLEFT", x, y)
    controls[#controls + 1] = row
    return row
end

-- Another file's part of the page, refreshed with the rest (PageGrid.lua).
function Page.AddControl(c)
    controls[#controls + 1] = c
end

local function changed()
    Interrupts:Fire("settings")
    refresh()
end

-- The status bar ------------------------------------------------------------------------------------------------

-- C_CVar.GetCVar (warcraft.wiki.gg: the namespaced call since 8.1.5; the global is FrameXML's wrapper of it).
local function nameplatesOff()
    local get = (C_CVar and C_CVar.GetCVar) or GetCVar
    if not get then
        return false
    end
    local ok, v = pcall(get, "nameplateShowEnemies")
    return ok and CRT.Comm.Readable(v) and v == "0"
end

-- The status bar's text and kind ("good", "warn" or "neutral") for a boss.
function Page.Status(encounterID)
    if nameplatesOff() then
        return TEXT.nameplatesOff, "warn"
    end
    if not encounterID then
        return TEXT.noBoss, "neutral"
    end
    local _, source = Interrupts:List(encounterID)
    if not source then
        return TEXT.statusNone, "neutral"
    end
    local def = Interrupts:Def(encounterID)
    local n, group = Interrupts:Mine(encounterID)
    local kick = n and string.format(TEXT.yourKick, def.label, n, group or "") or TEXT.notOn
    if source == "raid" then
        local shared = Interrupts:Shared(encounterID)
        return string.format(TEXT.statusRaid, shared and shared.from or "?") .. " " .. kick, n and "good" or "warn"
    end
    return TEXT.statusOwn .. " " .. kick, "warn"
end

-- The name colours (the group itself is Page.Cache's, Interrupts/PagePalette.lua) -----------------------------------

local function classColor(class)
    local c = class and RAID_CLASS_COLORS and RAID_CLASS_COLORS[class]
    if c then
        return c.r, c.g, c.b
    end
    return 1, 1, 1
end
Page.ClassColor = classColor

local function canEdit()
    return not CRT.Comm.Channel() or CRT.Comm.IsLeaderOrAssist("player")
end
Page.CanEdit = canEdit

-- A confirm dialog: one window, made the first time.
local dialog
local function confirm(text, onAccept)
    if not dialog then
        dialog = UI.Window("CowfeeRaidToolsKickConfirm", { kind = "dialog", title = TEXT.confirm, width = 420, height = 150 })
        dialog.msg = label(dialog.content, "", "CRTFontNormal")
        dialog.msg:SetPoint("TOPLEFT", 8, -8)
        dialog.msg:SetPoint("TOPRIGHT", -8, -8)
        dialog.ok = button(dialog.content, TEXT.ok, function()
            dialog:Hide()
            if dialog.onAccept then
                dialog.onAccept()
            end
        end)
        dialog.ok:SetPoint("BOTTOMRIGHT", dialog.content, "BOTTOM", -4, 4)
        dialog.cancel = button(dialog.content, TEXT.cancel, function()
            dialog:Hide()
        end)
        dialog.cancel:SetPoint("BOTTOMLEFT", dialog.content, "BOTTOM", 4, 4)
    end
    dialog.msg:SetText(text)
    dialog.onAccept = onAccept
    dialog:Show()
end
Page.Confirm = confirm

-- Assignments ------------------------------------------------------------------------------------------------------

local function difficultyName(id)
    if GetDifficultyInfo then
        local ok, name = pcall(GetDifficultyInfo, id)
        if ok and CRT.Comm.Readable(name) and type(name) == "string" and name ~= "" then
            return name
        end
    end
    return "difficulty " .. tostring(id)
end

local function bossOptions()
    local out = {}
    for _, b in ipairs(Interrupts:Bosses()) do
        local text = b.label .. " \194\183 " .. difficultyName(b.difficulty)
        if Interrupts:IsCustom(b.key) then
            text = text .. " (" .. TEXT.custom .. ")"
        end
        out[#out + 1] = { key = b.key, label = text }
    end
    return out
end
Page.BossOptions = bossOptions
Page.DifficultyName = difficultyName

local function buildStatus(f)
    local bar = CreateFrame("Frame", nil, f, "BackdropTemplate")
    bar:SetPoint("TOPLEFT", L.leftX, L.statusY)
    bar:SetSize(L.statusW, L.statusH)
    bar:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    UI.Tint(bar, "SetBackdropColor", "surface", 0.6)
    UI.Tint(bar, "SetBackdropBorderColor", "border")
    local text = label(bar, "")
    text:SetPoint("LEFT", 8, 0)
    text:SetWidth(L.statusW - 16)
    text:SetWordWrap(false)
    Page.status = text
    controls[#controls + 1] = { refresh = function()
        local s, kind = Page.Status(boss())
        Page.statusKind = kind
        text:SetText(kind == "good" and UI.GoodText(s) or kind == "warn" and UI.WarnText(s) or s)
    end }
end

-- The rows under the kick list follow its height (the grid's viewport, PageGrid.lua): Clear list (Use the raid's list,
-- Share and Who has it follow it), Test on trash and Preview reminder (Write to the raid note follows it).
function Page.PlaceBelow(height)
    local y = L.gridY - height - L.buttonGap
    if Page.clear then
        Page.clear:ClearAllPoints()
        Page.clear:SetPoint("TOPLEFT", L.leftX, y)
    end
    if Page.test then
        Page.test:ClearAllPoints()
        Page.test:SetPoint("TOPLEFT", L.leftX - L.checkInset, y - L.testGap)
        Page.preview:ClearAllPoints()
        Page.preview:SetPoint("TOPLEFT", L.leftX + L.previewX, y - L.testGap)
    end
end

-- The tooltip of a button says why it is greyed: b.crtReason. A disabled button gets no OnEnter unless told to.
local function reasonTip(b, title)
    if b.SetMotionScriptsWhileDisabled then
        b:SetMotionScriptsWhileDisabled(true)
    end
    b:SetScript("OnEnter", function(self)
        UI.TooltipOwner(GameTooltip, self, "ANCHOR_TOP")
        GameTooltip:SetText(title, 1, 1, 1)
        if self.crtReason then
            GameTooltip:AddLine(self.crtReason, 0.85, 0.85, 0.85, true)
        end
        GameTooltip:Show()
    end)
    b:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
end

local function buildButtons(f)
    local clear = button(f, TEXT.clear, function()
        local id = boss()
        if id then
            confirm(string.format(TEXT.clearAsk, Interrupts:BossName(id)), function()
                Interrupts:Clear(id)
            end)
        end
    end)
    local useRaid = button(f, TEXT.useRaid, function()
        local id = boss()
        local shared = id and Interrupts:Shared(id)
        if shared then
            confirm(string.format(TEXT.useRaidAsk, shared.from or "?", Interrupts:BossName(id)), function()
                Interrupts:CopyRaids(id)
            end)
        end
    end)
    useRaid:SetPoint("LEFT", clear, "RIGHT", L.buttonSpace, 0)
    local share = button(f, TEXT.share, function()
        if boss() then
            KickComm:Share(boss())
        end
    end)
    share:SetPoint("LEFT", useRaid, "RIGHT", L.buttonSpace, 0)
    reasonTip(share, TEXT.share)
    local shareHelp = UI.HelpRight(share, TEXT.share, TEXT.shareHelp)
    -- Who has it (N of M), beside Share: opens its pop-out (Interrupts/WhoWindow.lua)
    local who = Page.Who.BuildButton(f)
    who:SetPoint("LEFT", shareHelp or share, "RIGHT", L.buttonSpace, 0)
    Page.whoButton = who
    local write = button(f, TEXT.write, function()
        local id = boss()
        if not (id and CRT.InterruptNote) then
            return
        end
        local ok, noteID, emptied, noteName = CRT.InterruptNote.Write(id)
        if not ok then
            CRT:Print(noteID) -- why not
        elseif not noteID then
            CRT:Print(TEXT.writeNothing)
        else
            CRT:Print(string.format(emptied and TEXT.writeEmpty or TEXT.writeDone, tostring(noteName)))
        end
    end)
    reasonTip(write, TEXT.write)
    UI.HelpRight(write, TEXT.write, TEXT.writeHelp)
    Page.share, Page.clear, Page.useRaid, Page.write = share, clear, useRaid, write
    controls[#controls + 1] = { refresh = function()
        local id = boss()
        local ok, why = false, TEXT.noBoss
        if id then
            ok, why = KickComm:CanShare(id)
        end
        share:SetEnabled(ok and true or false)
        share.crtReason = (not ok) and why or nil
        clear:SetEnabled(id ~= nil and canEdit())
        useRaid:SetEnabled(id ~= nil and Interrupts:Shared(id) ~= nil)
        local wok, wwhy = id ~= nil and CRT.InterruptNote ~= nil, TEXT.noBoss
        if wok and CRT.Notes and CRT.Notes.CanEditRaid then
            wok, wwhy = CRT.Notes:CanEditRaid()
            if wok and CRT.Notes.Busy() then
                wok, wwhy = false, CRT.InterruptNote.TEXT.busy
            end
        end
        write:SetEnabled(wok and true or false)
        write.crtReason = (not wok) and wwhy or nil
    end }
end

local function seconds(v)
    return (string.format("%.1f", v):gsub("%.0$", ""))
end

local function clock(t)
    return string.format("%d:%02d", math.floor(t / 60), math.floor(t % 60))
end

-- A setup, as lines for How the numbers are worked out (at most L.howLines).
function Page.HowLines(def)
    if not def then
        return {}
    end
    local t = def.timing
    if not t then
        local out = { def.spell and def.spell.name and string.format(TEXT.howSpell, def.spell.name) or TEXT.howNoSpell, TEXT.howMarker, TEXT.howTurn }
        for _, g in ipairs(def.groups) do
            if #out >= L.howLines then
                break
            end
            out[#out + 1] = g.marker and string.format(TEXT.howGroup, Setup.MarkerIcon(g.marker, 14) .. " ", g.label, g.slots)
                or string.format(TEXT.howNoMarker, g.label, g.slots)
        end
        return out
    end
    local times = {}
    for _, at in ipairs(t.anchor.times) do
        times[#times + 1] = clock(at)
    end
    return {
        string.format(TEXT.howAnchor, t.anchor.ordinal, t.anchor.cycle, t.anchor.unit),
        string.format(TEXT.howFirst, seconds(t.firstCast), seconds(t.spacing)),
        string.format(TEXT.howTolerance, seconds(t.tolerance)),
        string.format(TEXT.howAdds, t.adds, t.perNumber),
        string.format(TEXT.howWindow, t.window),
        string.format(TEXT.howFallback, table.concat(times, ", ")),
    }
end

-- How the numbers are worked out, for the setup shown: the (?) on the Kick list heading.
function Page.HowText()
    local lines = Page.HowLines(boss() and Interrupts:Def(boss()))
    if #lines == 0 then
        return TEXT.howHelp
    end
    return TEXT.howHelp .. "\n\n" .. table.concat(lines, "\n")
end

-- The Kick list heading over the rows, its (?) how the numbers are worked out.
local function buildListHeading(f)
    local head = label(f, TEXT.list, "CRTFontNormal")
    head:SetPoint("TOPLEFT", L.leftX, L.listY)
    Page.listHead = head
    Page.howHelp = UI.HelpRight(head, TEXT.how, Page.HowText)
end

local function buildAssignments(f)
    local bossRow = UI.Dropdown(f, TEXT.boss, { options = bossOptions, labelWidth = L.bossLabelW, width = L.bossW,
        get = function()
            return boss()
        end,
        set = function(id)
            choose(id)
        end })
    add(bossRow, L.leftX, L.bossY)
    Page.bossRow = bossRow
    -- the setup's own note (why only that difficulty), from its season-pack file
    local bossHelp = UI.HelpRight(bossRow, TEXT.boss, function()
        local def = boss() and Interrupts:Def(boss())
        local note = def and type(def.note) == "string" and def.note or nil
        return note and (TEXT.bossHelp .. "\n\n" .. note) or TEXT.bossHelp
    end)
    local edit = button(f, TEXT.editSetup, function()
        if CRT.InterruptSetupEditor then
            CRT.InterruptSetupEditor:Open(boss())
        end
    end)
    edit:SetPoint("TOPLEFT", L.leftX + L.bossLabelW + 5 + L.bossW + L.editGap, L.bossY - 5)
    UI.HelpRight(edit, TEXT.editSetup, TEXT.editSetupHelp)
    Page.editSetup, Page.bossHelp = edit, bossHelp
    buildStatus(f)
    buildButtons(f)
    local test = checkbox(f, L.leftX - L.checkInset, 0, TEXT.test, function()
        return settings().test
    end, function(on)
        settings().test = on
        if on then
            Anchor:StartTest(boss())
        else
            Anchor:StopTest()
        end
        refresh()
    end)
    UI.HelpRight(test, TEXT.test, TEXT.testHelp)
    Page.test = test
    Page.preview = button(f, TEXT.preview, function()
        CRT.InterruptReminder:Preview()
    end)
    -- Write to the raid note after Preview reminder: the row above is full with Who has it
    Page.write:SetPoint("LEFT", Page.preview, "RIGHT", L.buttonSpace, 0)
    buildListHeading(f)
    -- the grid last among the left column's refreshes, so it places the rows under it once they exist
    Page.BuildGrid(f)
    Page.PlaceBelow(L.gridMaxH)
    Page.BuildPalette(f)
end

-- Settings -----------------------------------------------------------------------------------------------------------

local function heading(f, x, y, text, help)
    local fs = label(f, text, "CRTFontNormal")
    fs:SetPoint("TOPLEFT", x, y)
    UI.HelpRight(fs, text, help)
    return fs
end

local function plates()
    return settings().plates
end

local function reminder()
    return settings().reminder
end

local function platesOn()
    return plates().on
end

local function reminderOn()
    return reminder().on
end

-- A colour swatch for one of the player's box colours (saved RGBA, not a theme colour).
local function swatch(f, x, y, text, key)
    local name = label(f, text)
    name:SetPoint("TOPLEFT", x, y - 2)
    local b = CreateFrame("Button", nil, f, "BackdropTemplate")
    b:SetSize(L.swatchW, L.swatchH)
    b:SetPoint("LEFT", name, "RIGHT", 6, 0)
    b:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    b:SetBackdropBorderColor(0, 0, 0, 1) -- the swatch's edge: not a theme colour
    b.refresh = function()
        local c = plates()[key]
        local on = platesOn() and true or false
        b:SetBackdropColor(c[1], c[2], c[3], c[4] or 1)
        b:SetEnabled(on)
        b:SetAlpha(on and 1 or L.greyAlpha)
        greyLabel(name, on)
    end
    Page.swatches[#Page.swatches + 1] = { button = b, label = name }
    b:SetScript("OnClick", function()
        UI.PickColor(plates()[key], function(c)
            plates()[key] = c
            changed()
        end, { hasOpacity = true })
    end)
    controls[#controls + 1] = b
    return b
end

local function slider(f, x, y, text, holder, key, low, high, labelW, enabledIf)
    return add(UI.Slider(f, text, { min = low, max = high, labelWidth = labelW or L.setLabelW, width = L.setControlW,
        enabledIf = enabledIf,
        get = function()
            return holder()[key]
        end,
        set = function(v)
            holder()[key] = v
            changed()
        end }), x, y)
end

local function swatchRow(f, y, text, boxKey, textKey)
    local name = label(f, text, "CRTFontNormal")
    name:SetPoint("TOPLEFT", L.leftX, y)
    name:SetWidth(L.swatchLabelW)
    swatch(f, L.leftX + L.swatchLabelW + 4, y, TEXT.box, boxKey)
    swatch(f, L.leftX + L.swatchLabelW + 4 + L.swatchStep, y, TEXT.number, textKey)
end

local function buildPlatesSettings(f)
    local Y, x = L.platesY, L.leftX
    heading(f, x, Y.head, TEXT.plates, TEXT.platesHelp)
    checkbox(f, x - L.checkInset, Y.on, TEXT.platesOn, platesOn, function(on)
        plates().on = on
        changed()
    end)
    local all = checkbox(f, x - L.checkInset, Y.all, TEXT.all, function()
        return plates().all
    end, function(on)
        plates().all = on
        changed()
    end, platesOn)
    UI.HelpRight(all, TEXT.all, TEXT.allHelp)
    Page.allCheck = all
    slider(f, x, Y.size, TEXT.size, plates, "size", 10, 100, nil, platesOn)
    slider(f, x, Y.font, TEXT.font, plates, "font", 8, 60, nil, platesOn)
    slider(f, x, Y.offset, TEXT.offset, plates, "offset", -100, 100, nil, platesOn)
    swatchRow(f, Y.yours, TEXT.yours, "mineBox", "mineText")
    swatchRow(f, Y.others, TEXT.others, "box", "text")
end

local function buildReminderSettings(f)
    local Y, x = L.reminderY, L.setX2
    heading(f, x, Y.head, TEXT.reminder, TEXT.reminderHelp)
    checkbox(f, x - L.checkInset, Y.on, TEXT.reminderOn, reminderOn, function(on)
        reminder().on = on
        changed()
    end)
    add(UI.SoundDropdown(f, TEXT.sound, { none = TEXT.soundNone, labelWidth = L.reminderLabelW, width = L.soundW, playButton = true,
        help = true, enabledIf = reminderOn,
        get = function()
            return reminder().sound
        end,
        set = function(key)
            reminder().sound = key
            changed()
        end }), x, Y.sound)
    slider(f, x, Y.size, TEXT.reminderSize, reminder, "size", 16, 128, L.reminderLabelW, reminderOn)
    heading(f, x, Y.sharing, TEXT.sharing, TEXT.sharingHelp)
    checkbox(f, x - L.checkInset, Y.accept, TEXT.accept, function()
        return settings().accept
    end, function(on)
        settings().accept = on
        refresh()
    end)
end

local function buildSettings(f)
    buildPlatesSettings(f)
    buildReminderSettings(f)
end

-- The page -------------------------------------------------------------------------------------------------------------

local TABS = { { key = "assignments", label = TEXT.assignments }, { key = "settings", label = TEXT.settings } }

local function showTab(key)
    for _, tab in ipairs(TABS) do
        local on = tab.key == key
        Page.tabs[tab.key].frame:SetShown(on)
        UI:SetTabSelected(Page.tabs[tab.key].button, on)
    end
    Page.tab = key
end

local function selectTab(key)
    showTab(key)
    refresh()
end
Page.SelectTab = selectTab

-- The milliseconds since an earlier now(), for Page.perf; nil while no probe listens.
local function now()
    return Page.perf and debugprofilestop and debugprofilestop() or nil
end

local function tell(what, since)
    if since and Page.perf then
        pcall(Page.perf, what, debugprofilestop() - since)
    end
end

-- Draws the page once, now: every control's refresh.
local dirty, queued = false, false
local function draw()
    dirty = false
    if not page or not page:IsShown() then
        return
    end
    local t0 = now()
    Page.counts.refresh = Page.counts.refresh + 1
    for _, c in ipairs(controls) do
        c.refresh()
    end
    tell("refresh", t0)
end
Page.RefreshNow = draw

local function nextFrame()
    queued = false
    if dirty then
        draw()
    end
end

-- Marks the page to be drawn: once, on the next frame, however many changes ask before then.
refresh = function()
    if not page or not page:IsShown() then
        return
    end
    dirty = true
    if not queued then
        queued = true
        C_Timer.After(0, nextFrame)
    end
end
Page.Refresh = function()
    refresh()
end

local function makeTab(pf, i, tab)
    local b = CreateFrame("Button", nil, pf, "BackdropTemplate")
    b:SetSize(L.tabW, L.tabH)
    b:SetPoint("TOPLEFT", L.leftX + (i - 1) * (L.tabW + L.tabGap), TAB_Y)
    b:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    b.sel = b:CreateTexture(nil, "ARTWORK")
    b.sel:SetAllPoints()
    b.sel:SetColorTexture(UI.Color("heading", 0.18)) -- UI:RegisterTab styles it from here on
    b.text = b:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    b.text:SetPoint("CENTER")
    b.text:SetText(tab.label)
    b:SetScript("OnClick", function()
        selectTab(tab.key)
    end)
    UI:RegisterTab(b)
    local f = CreateFrame("Frame", nil, pf)
    f:SetPoint("TOPLEFT", 0, CONTENT_Y)
    f:SetPoint("BOTTOMRIGHT", 0, 0)
    f:Hide()
    Page.tabs[tab.key] = { button = b, frame = f, label = tab.label }
    return f
end

local function build(pf)
    page = pf
    local title = label(pf, TEXT.title, "CRTFontLarge")
    title:SetPoint("TOPLEFT", 8, -8)
    UI.HelpRight(title, TEXT.title, TEXT.help)
    buildAssignments(makeTab(pf, 1, TABS[1]))
    buildSettings(makeTab(pf, 2, TABS[2]))
    local line = pf:CreateTexture(nil, "ARTWORK")
    UI.Tint(line, "SetColorTexture", "border")
    line:SetHeight(1)
    line:SetPoint("TOPLEFT", 8, CONTENT_Y + 4)
    line:SetPoint("TOPRIGHT", -8, CONTENT_Y + 4)

    -- while the page is open: the group (names, who may edit and share) and the nameplates switch
    local watch = CreateFrame("Frame")
    watch:SetScript("OnEvent", function(_, event, cvar)
        if event == "CVAR_UPDATE" and cvar ~= "nameplateShowEnemies" then
            return
        end
        refresh()
    end)
    -- shown: the note read when it changed, then the page drawn once, at once (whatever asked for a refresh on the way)
    pf:SetScript("OnShow", function()
        local t0 = now()
        for _, e in ipairs({ "GROUP_ROSTER_UPDATE", "PARTY_LEADER_CHANGED", "CVAR_UPDATE" }) do
            watch:RegisterEvent(e)
        end
        if CRT.AddonCheck then
            CRT.AddonCheck:MaybeCheck()
        end
        readNote(boss())
        showTab(Page.tab or "assignments")
        draw()
        tell("show", t0)
    end)
    pf:SetScript("OnHide", function()
        watch:UnregisterAllEvents()
        if dialog then
            dialog:Hide()
        end
    end)
    Interrupts:OnChange(refresh)
    -- the Addon check's answers change only Who has it (Interrupts/WhoWindow.lua), never the whole page
    CRT.Bosses:OnRouteChange(refresh)
    if pf:IsShown() then
        pf:GetScript("OnShow")(pf)
    end
end

UI:RegisterPage("interrupts", TEXT.title, build)
-- hidden until Enable Interrupts is on: Data.lua shows it at login from the saved switch, and on every change
UI:SetPageHidden("interrupts", true)

-- /crt interrupts (CRT_Core/Slash.lua's registry)
if CRT.Slash then
    CRT.Slash:Register("interrupts", {
        run = function(rest)
            if rest ~= "" then
                return false
            end
            if not Interrupts:Enabled() then
                CRT:Print(TEXT.slashOff)
                UI:Show("settings")
                return
            end
            UI:Show("interrupts")
        end,
        help = { "[/crt interrupts] - kick numbers above the adds and the kick list" },
    })
end
