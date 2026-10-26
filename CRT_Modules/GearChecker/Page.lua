local ADDON, CRT = ...

-- The Gear Checker page: one row per group member with their name (class colour), average item level, an
-- issues count, the Tracks column (pieces per upgrade track, "3M 3H") and a cell per gear slot (all 16 fit
-- the page, so nothing scrolls sideways): the item's icon in its quality's border, its item level, its
-- track and rank at the top left ("H4", in the track's colour), gem diamonds down the right edge (filled, or
-- empty with a red edge), a season check's square at the bottom right and, on a slot that takes an
-- enchant, a dot at the bottom left (green, or red when missing). A missing enchant or gem outlines the
-- cell red, a low item orange. Filter chips pick who shows, and on an issue filter each row draws only the
-- cells with that issue (GC.CellShows), the rest empty; the Below chip does the same for items under a
-- track picked from its arrow's menu (CRTDB.gearChecker.belowTrack). The Extra filters button after the
-- chips opens a small window (UI.Window dialog) of check boxes: each ticked one adds its chip (GC:ExtraChecks).
-- Refresh reads your own gear again, asks
-- the group's CRTs and inspects the rest (Comm.lua, Inspect.lua), and says how many have CRT; opening the
-- page reads your own gear again too. Hover a cell for the exact item,
-- or the issues badge for the list of issues and, under Not an issue, the info checks and items below the
-- track; shift-click an item with an issue to put it in
-- the chat box; right-click a row to send its issues to a channel or a whisper, put them in the chat box or
-- inspect. Pop out moves the whole page into a window of its own (UI.Window "popout", its place and
-- size in CRTDB.gearChecker.popout), as the Timeline's does; closing it puts it back.
-- The rows are worked out once per change (GC:Rows) and a scroll only repaints the visible ones.
--
-- Game calls (warcraft.wiki.gg and Blizzard's UI source, live, read 2026-10-20): ChatFrameUtil.GetActiveWindow,
-- .InsertLink(text) and .OpenChat(text) (12.0; the older ChatEdit_GetActiveWindow, ChatEdit_InsertLink and
-- ChatFrame_OpenChat stay as fallbacks, aliases in Blizzard_DeprecatedChatInfo); InspectUnit(unit) (the game's
-- inspect window, Blizzard_InspectUI_Bootstrap); IsShiftKeyDown; C_ClassColor.GetClassColor, else
-- RAID_CLASS_COLORS; C_Item.GetItemQualityByID(itemInfo) and its colour from Gear.QualityColor (ColorManager, else
-- ITEM_QUALITY_COLORS), redrawn on ITEM_DATA_LOAD_RESULT (itemID, success); C_Item.GetItemInfoInstant (the
-- icon); TextureBase:SetRotation(radians); the WowScrollBoxList, MinimalScrollBar and
-- ScrollUtil.InitScrollBoxListWithScrollBar as Loot History uses them. Read 2026-10-24: UICheckButtonTemplate
-- and InputBoxTemplate (EditBox:SetNumeric, SetMaxLetters, OnEditFocusLost) as other pages use them; Frame:Raise.

local UI = CRT.UI
local GC = CRT.GearChecker
local Gear = CRT.Gear

local TEXT = {
    title = "Gear Checker",
    help = "Shows everyone's gear and what to fix: red for a missing enchant or gem, orange for an item %d or more item levels under their average, and a small square for a season check or an extra filter (blue is just to know). A tag like H4 is the item's upgrade track and rank. Pick a filter to see only those items, and right-click a player to send them their issues. Extra filters adds more filters.",
    refresh = "Refresh (%d/%d have CRT)",
    popOut = "Pop out",
    dock = "Dock",
    docked = "The Gear Checker is in its own window.",
    bringBack = "Bring it back",
    name = "Name",
    ilvl = "iLvl",
    issues = "Issues",
    tracks = "Tracks",
    tracksTip = "Tracks: %s", -- each track's count and name, highest first
    notAnIssue = "Not an issue",
    belowMenu = "List items below",
    notSeen = "not seen yet",
    notSeenWhy = { range = "not seen yet (out of range)", offline = "not seen yet (offline)", cannot = "not seen yet (can't inspect)" },
    shiftClick = "Shift-click to put this in the chat box.",
    sendTo = "Send issues to",
    channel = { RAID = "Raid", PARTY = "Party", INSTANCE_CHAT = "Instance", GUILD = "Guild", OFFICER = "Officer", SAY = "Say" },
    whisper = "Whisper %s",
    sayWorld = "Out in the world, the game only lets you say this yourself. It goes into the chat box: press Enter to send it.",
    noIssues = "No issues",
    noIssuesToSend = "No issues to send.",
    tipNotSeen = "Not seen yet",
    chatBox = "Put in chat box",
    inspect = "Inspect %s",
    empty = "Nothing here",
    count = "%d shown",
    extra = "Extra filters",
}

-- Sizes in pixels. A row is NAME + ILVL + ISSUES + TRACKS + 16 cells; with the scroll bar it fits UI.PAGE_W
-- and the pop-out at its smallest (popMinW).
local L = {
    chipH = 24, chipPad = 12, chipGap = 4, buttonH = 24,
    chipsW = 600, -- chips run to here, then on to another row (Refresh and Pop out sit to the right)
    chipArrow = 12, chipArrowH = 8, -- the Below chip's arrow, at its right
    headY = -34, listY = -52, -- with one row of chips; each more row moves them down chipH + chipGap
    tag = 7, -- a season check's square at the icon's bottom right
    trackX = -3, trackY = 2, -- the track tag's top left, from the icon's (a little out to the left)
    trackMaxW = 24, -- the tag's widest: it ends left of the gem column (L.icon - 1 - the diamond's half width)
    nameW = 98, ilvlW = 40, issuesW = 40, tracksW = 64, cellW = 47, rowH = 46,
    icon = 30, edge = 2, gem = 7, gemInner = 5, gemGap = 1, dot = 8, badgeW = 26, badgeH = 16,
    barGap = UI.SCROLL_GAP, barW = 8, -- the gap before the bar: the shared scroll bar gap
    popW = 1040, popH = 560, popMinW = 1024, popMinH = 300,
    helpW = 24, -- room kept right of the Extra filters button for the page's (?)
    extraW = 280, extraH = 160, extraRowH = 28, extraCheck = 24, extraEditW = 48, extraEditH = 20, -- the Extra filters window
}
L.cellsX = L.nameW + L.ilvlW + L.issuesW + L.tracksW -- where the first cell starts
L.rowW = L.cellsX + #Gear.SLOTS * L.cellW
GC.PAGE_LAYOUT = L

-- Missing, low and enchanted in the theme's bad, warn and good colours (CRT.PALETTE's tables, refilled on a
-- theme switch; the page redraws when shown). The rest are data colours, the same in every theme.
local COLORS = {
    bad = CRT.PALETTE.bad,
    low = CRT.PALETTE.warn, -- an item well under the player's average
    good = CRT.PALETTE.good,
    info = { 0.3, 0.65, 1 }, -- a season check to know about, not to fix: not a theme colour
    gem = { 0.55, 0.8, 1 }, -- a filled socket: not a theme colour
    socket = { 0.08, 0.08, 0.08 },
    emptyCell = { 0, 0, 0, 0.35 },
}

local DISC = (CRT.MEDIA or ("Interface\\AddOns\\" .. ADDON .. "\\CRT_Media\\Media\\")) .. "Disc" -- the fallback is for test harnesses without Core.lua
local WHITE = "Interface\\Buttons\\WHITE8X8"

-- The page's state, one table so the file stays far under Lua 5.1's upvalue limit.
local P = { rows = {}, chips = {}, chipOf = {}, headers = {}, colHeads = {}, refreshedOnce = false, popped = false }
GC.Page = P

-- Colours by look -------------------------------------------------------------------------------------------

-- A text colour: headings in the theme's heading colour (the game's gold in Default: Blizzard); other
-- text the theme's text colour in Modern, white in Default: Blizzard.
local function textColor(kind)
    if kind == "heading" then
        local r, g, b = UI.Color("heading")
        return r, g, b
    end
    if UI:IsModern() then
        local r, g, b = UI.Color("text")
        return r, g, b
    end
    return 1, 1, 1
end

local function rowColor(odd)
    if UI:IsModern() then
        local c = CRT.PALETTE.surface
        return c[1], c[2], c[3], odd and 0.85 or 0.55
    end
    return 0, 0, 0, odd and 0.35 or 0.2
end

local function classColor(class)
    local c = class and ((C_ClassColor and C_ClassColor.GetClassColor(class)) or (RAID_CLASS_COLORS and RAID_CLASS_COLORS[class]))
    if type(c) == "table" and c.r then
        return c.r, c.g, c.b
    end
    return textColor("text")
end

local UNCOMMON = Enum and Enum.ItemQuality and Enum.ItemQuality.Uncommon or 2

local function secret(v)
    return issecretvalue and issecretvalue(v) or false
end

-- The quality's colour; Uncommon until the game has loaded the item (ITEM_DATA_LOAD_RESULT redraws it).
-- The game's item quality colour, the same in every theme: not a theme colour.
local function qualityColor(piece)
    local q
    if C_Item and C_Item.GetItemQualityByID then
        local ok, v = pcall(C_Item.GetItemQualityByID, piece.itemString or piece.link or piece.id)
        q = ok and not secret(v) and type(v) == "number" and v or nil
    end
    local r, g, b = Gear.QualityColor(q or UNCOMMON)
    if r then
        return r, g, b
    end
    return 1, 1, 1
end

local function iconOf(piece)
    if not (C_Item and C_Item.GetItemInfoInstant) then
        return nil
    end
    local ok, _, _, _, _, icon = pcall(C_Item.GetItemInfoInstant, piece.itemString or piece.link or piece.id)
    return ok and icon or nil
end

-- Chat ---------------------------------------------------------------------------------------------------------

-- Text into the chat box (GC.ToChatBox), for the player to edit and send.
P.ToChatBox = GC.ToChatBox

local function shortName(name)
    return Ambiguate and Ambiguate(name or "", "short") or name
end

-- A menu entry's tooltip, when the game's menu has them.
local function menuTooltip(description, text)
    if description and description.SetTooltip and GameTooltip_AddNormalLine then
        description:SetTooltip(function(tooltip)
            GameTooltip_AddNormalLine(tooltip, text)
        end)
    end
end

local function targetLabel(t, who)
    if t.chatType == "WHISPER" then
        return string.format(TEXT.whisper, who)
    end
    return TEXT.channel[t.chatType] or t.chatType
end

-- The row's right-click menu (UI.ContextMenu lifts it above every window, submenus too): Send issues to
-- (GC.SendTargets, each sent through GC.Say), Put in chat box, Inspect. With no issues the first two are greyed.
function P.OpenMenu(owner, row)
    UI.ContextMenu(owner, function(root)
        local who = shortName(row.name)
        root:CreateTitle(who)
        local lines = GC.RaidLines(row)
        local send = root:CreateButton(TEXT.sendTo)
        for _, t in ipairs(GC.SendTargets(row)) do
            local entry = send:CreateButton(targetLabel(t, who), function()
                GC.Send(row, t)
            end)
            if GC.NeedsHardware(t.chatType) then
                menuTooltip(entry, TEXT.sayWorld)
            end
        end
        send:SetEnabled(#lines > 0)
        if #lines == 0 then
            menuTooltip(send, TEXT.noIssuesToSend)
        end
        local b = root:CreateButton(TEXT.chatBox, function()
            P.ToChatBox(GC.ChatBoxText(row))
        end)
        b:SetEnabled(#lines > 0)
        root:CreateDivider()
        b = root:CreateButton(string.format(TEXT.inspect, who), function()
            if InspectUnit and row.unit and not InCombatLockdown() then
                pcall(InspectUnit, row.unit)
            end
        end)
        b:SetEnabled(row.unit ~= nil and not row.me and not InCombatLockdown())
    end)
end

-- Cells ----------------------------------------------------------------------------------------------------------

-- Four lines round a region, thick px, on owner; returned as a list to colour together.
local function outline(owner, region, thick, layer, sublevel)
    local out = {}
    for _, side in ipairs({ { "TOPLEFT", "TOPRIGHT", true }, { "BOTTOMLEFT", "BOTTOMRIGHT", true }, { "TOPLEFT", "BOTTOMLEFT", false }, { "TOPRIGHT", "BOTTOMRIGHT", false } }) do
        local t = owner:CreateTexture(nil, layer, nil, sublevel)
        local dx = side[3] and 0 or (side[1]:find("LEFT") and -thick or thick)
        local dy = side[3] and (side[1]:find("TOP") and thick or -thick) or 0
        t:SetPoint(side[1], region, side[1], dx, dy)
        t:SetPoint(side[2], region, side[2], dx, dy)
        if side[3] then
            t:SetHeight(thick)
        else
            t:SetWidth(thick)
        end
        out[#out + 1] = t
    end
    return out
end

local function paintLines(lines, r, g, b, a)
    for _, t in ipairs(lines) do
        t:SetColorTexture(r, g, b, a or 1)
    end
end

local function showLines(lines, on)
    for _, t in ipairs(lines) do
        t:SetShown(on)
    end
end

local function diamond(owner, size, layer, sublevel)
    local t = owner:CreateTexture(nil, layer, nil, sublevel)
    t:SetTexture(WHITE)
    t:SetSize(size, size)
    t:SetRotation(math.pi / 4)
    return t
end

-- The colour of a slot's worst issue: red for a missing enchant or gem, orange for a low item, a season
-- check's own (GC.SEVERITY orders them; an info check is no issue).
local function findingColor(r)
    local worst = (r.missingEnchant or r.emptySockets > 0) and "bad" or (r.low and "low") or nil
    for _, c in ipairs(r.checks or {}) do
        if not GC.IsNote(c) and (not worst or GC.SEVERITY[c.severity] > GC.SEVERITY[worst]) then
            worst = c.severity
        end
    end
    return COLORS[worst or "bad"] or COLORS.bad
end

-- An empty slot with an issue (Empty slot): the slot's name, the issue in its colour, the shift-click hint.
local function emptyEnter(cell, r)
    local problems = GC.Problems(r)
    if not (problems and GameTooltip) then
        return
    end
    local slot = Gear.Slot(r.slot)
    UI.TooltipOwner(GameTooltip, cell, "ANCHOR_RIGHT")
    GameTooltip:SetText(slot and slot.name or "", textColor("heading"))
    local c = findingColor(r)
    GameTooltip:AddLine(problems, c[1], c[2], c[3], true)
    GameTooltip:AddLine(TEXT.shiftClick, 0.6, 0.6, 0.6, true)
    GameTooltip:Show()
end

-- The item's tooltip, then its issues in their colour (and the shift-click hint), then its info checks in blue.
local function cellEnter(cell)
    local r = cell.result
    if r and r.empty then
        emptyEnter(cell, r)
        return
    end
    if not (r and r.piece) then
        return
    end
    Gear.ShowTooltip(cell, r.piece)
    if not GameTooltip then
        return
    end
    local problems, notes = GC.Problems(r), GC.Notes(r)
    if problems then
        local c = findingColor(r)
        GameTooltip:AddLine(problems, c[1], c[2], c[3], true)
    end
    if notes then
        GameTooltip:AddLine(notes, COLORS.info[1], COLORS.info[2], COLORS.info[3], true)
    end
    if problems then
        GameTooltip:AddLine(TEXT.shiftClick, 0.6, 0.6, 0.6, true)
    end
    if problems or notes then
        GameTooltip:Show()
    end
end

local function cellLeave()
    if GameTooltip then
        GameTooltip:Hide()
    end
end

local function cellClick(cell, button)
    local row, r = cell.row, cell.result
    if not row then
        return
    end
    if button == "RightButton" then
        P.OpenMenu(cell, row)
    elseif IsShiftKeyDown and IsShiftKeyDown() and r then
        P.ToChatBox(GC.SlotLine(row, r))
    end
end

local function makeCell(rowFrame, i)
    local c = CreateFrame("Button", nil, rowFrame)
    c:SetSize(L.cellW, L.rowH)
    c:SetPoint("LEFT", rowFrame, "LEFT", L.cellsX + (i - 1) * L.cellW, 0)
    c:RegisterForClicks("LeftButtonUp", "RightButtonUp")
    c.slot = Gear.SLOTS[i].id
    c.back = c:CreateTexture(nil, "BACKGROUND", nil, 1)
    c.back:SetSize(L.icon, L.icon)
    c.back:SetPoint("TOP", 0, -3)
    c.icon = c:CreateTexture(nil, "ARTWORK")
    c.icon:SetAllPoints(c.back)
    c.quality = outline(c, c.back, 1, "BORDER", 1)
    c.flag = outline(c, c.back, L.edge, "OVERLAY", 1) -- red (missing) or orange (low), over the quality
    c.ilvl = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    c.ilvl:SetPoint("TOP", c.back, "BOTTOM", 0, -1)
    c.dot = c:CreateTexture(nil, "OVERLAY", nil, 3) -- the enchant dot, bottom left (the track tag has the top left)
    c.dot:SetTexture(DISC)
    c.dot:SetSize(L.dot, L.dot)
    c.dot:SetPoint("CENTER", c.back, "BOTTOMLEFT", 1, 1)
    -- the upgrade track and rank ("H4"), in the track's colour, over a dark backing so it reads on any icon
    c.trackBack = c:CreateTexture(nil, "OVERLAY", nil, 6)
    c.trackTag = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    c.trackTag:SetDrawLayer("OVERLAY", 7) -- above its backing
    c.trackTag:SetPoint("TOPLEFT", c.back, "TOPLEFT", L.trackX, L.trackY)
    c.trackTag:SetWidth(L.trackMaxW) -- a larger font cuts the text short instead of reaching the gems
    c.trackTag:SetJustifyH("LEFT")
    c.trackTag:SetWordWrap(false)
    c.trackBack:SetPoint("TOPLEFT", c.trackTag, "TOPLEFT", -1, 1)
    c.trackBack:SetPoint("BOTTOMLEFT", c.trackTag, "BOTTOMLEFT", -1, -1)
    c.gems = {}
    for g = 1, 3 do
        local edge = diamond(c, L.gem, "OVERLAY", 4)
        local fill = diamond(c, L.gemInner, "OVERLAY", 5)
        -- one column down the right edge, so the track tag at the top left never meets them
        edge:SetPoint("CENTER", c.back, "TOPRIGHT", -1, -1 - (g - 1) * (L.gem + L.gemGap))
        fill:SetPoint("CENTER", edge, "CENTER")
        c.gems[g] = { edge = edge, fill = fill }
    end
    c.tag = c:CreateTexture(nil, "OVERLAY", nil, 6) -- a season check, in its severity's colour
    c.tag:SetSize(L.tag, L.tag)
    c.tag:SetPoint("CENTER", c.back, "BOTTOMRIGHT", -1, 1)
    c:SetScript("OnEnter", cellEnter)
    c:SetScript("OnLeave", cellLeave)
    c:SetScript("OnClick", cellClick)
    return c
end

-- One slot of a row, painted from its findings. A cell the filter doesn't draw (GC.CellShows) is painted as an
-- empty slot, so the columns stay under their headings; it has no tooltip, but a right-click is still the row's.
local function paintCell(c, row, r, shown)
    if not shown then
        r = nil
    end
    c.row, c.result = row, r
    local piece = r and r.piece
    local e = COLORS.emptyCell
    c.back:SetColorTexture(e[1], e[2], e[3], e[4])
    c.icon:SetShown(piece ~= nil)
    showLines(c.quality, piece ~= nil)
    if piece then
        c.icon:SetTexture(iconOf(piece))
        paintLines(c.quality, qualityColor(piece))
    end
    c.ilvl:SetText(piece and piece.ilvl and tostring(piece.ilvl) or "")
    c.ilvl:SetTextColor(textColor("text"))
    local missing = r and (r.missingEnchant or r.emptySockets > 0)
    local flag = missing and COLORS.bad or (r and r.low and COLORS.low) or nil
    showLines(c.flag, flag ~= nil)
    if flag then
        paintLines(c.flag, flag[1], flag[2], flag[3])
    end
    local dot = piece and r.needsEnchant and not r.unknown and (r.missingEnchant and COLORS.bad or COLORS.good) or nil
    c.dot:SetShown(dot ~= nil)
    if dot then
        c.dot:SetVertexColor(dot[1], dot[2], dot[3], 1)
    end
    local track = piece and r.track or nil
    c.trackTag:SetShown(track ~= nil)
    c.trackBack:SetShown(track ~= nil)
    c.trackTag:SetText(track and GC.TrackTag(track) or "")
    if track then
        c.trackTag:SetTextColor(GC.TrackColor(track.track))
        c.trackBack:SetColorTexture(0, 0, 0, 0.7)
        c.trackBack:SetWidth(math.min(c.trackTag:GetStringWidth() or 0, L.trackMaxW) + 2) -- as wide as the text
    end
    local top = r and GC.TopCheck(r) -- an empty slot's own check (Empty slot) too
    c.tag:SetShown(top ~= nil)
    if top then
        local t = COLORS[top.severity] or COLORS.bad
        c.tag:SetColorTexture(t[1], t[2], t[3], 1)
    end
    local sockets = piece and math.min(3, r.sockets or 0) or 0
    for g, d in ipairs(c.gems) do
        -- the sockets from the right: filled ones first, then the empty ones
        local shown = g <= sockets
        d.edge:SetShown(shown)
        d.fill:SetShown(shown)
        if shown then
            local filled = g <= r.gems
            if filled then
                d.edge:SetVertexColor(0, 0, 0, 1)
                d.fill:SetVertexColor(COLORS.gem[1], COLORS.gem[2], COLORS.gem[3], 1)
            else
                d.edge:SetVertexColor(COLORS.bad[1], COLORS.bad[2], COLORS.bad[3], 1)
                d.fill:SetVertexColor(COLORS.socket[1], COLORS.socket[2], COLORS.socket[3], 1)
            end
        end
    end
    c:SetShown(row.seen)
end

-- Rows -------------------------------------------------------------------------------------------------------

local function rowClick(frame, button)
    if button == "RightButton" and frame.data then
        P.OpenMenu(frame, frame.data)
    end
end

-- The issues badge's tooltip: the player's name in their class colour, then a line per issue (red for a
-- missing enchant or gem, orange for a low item, a season check in its severity's colour), or No issues,
-- or Not seen yet. Then, under Not an issue, the info checks (blue) and the items below the Below chip's
-- track (in the track's colour).
local function badgeEnter(hit)
    local row = hit:GetParent().data
    if not (row and GameTooltip) then
        return
    end
    UI.TooltipOwner(GameTooltip, hit, "ANCHOR_RIGHT")
    GameTooltip:SetText(shortName(row.name), classColor(row.class))
    local lines = GC.IssueLines(row)
    if not lines then
        GameTooltip:AddLine(TEXT.tipNotSeen, 0.6, 0.6, 0.6)
    elseif #lines == 0 then
        GameTooltip:AddLine(TEXT.noIssues, COLORS.good[1], COLORS.good[2], COLORS.good[3])
    end
    for _, line in ipairs(lines or {}) do
        local c = COLORS[line.kind] or COLORS.bad
        GameTooltip:AddLine(line.text, c[1], c[2], c[3])
    end
    local trackLine
    local counts = row.seen and GC.TrackCounts(row) or {}
    if #counts > 0 then
        local parts = {}
        for _, p in ipairs(counts) do
            parts[#parts + 1] = GC.InTrackColor(p.track, p.n .. " " .. p.track.label)
        end
        trackLine = string.format(TEXT.tracksTip, table.concat(parts, ", "))
    end
    local notes = GC.NoteLines(row) or {}
    if #notes > 0 then
        GameTooltip:AddLine(TEXT.notAnIssue, textColor("heading"))
    end
    for _, line in ipairs(notes) do
        if line.track then
            GameTooltip:AddLine(line.text, GC.TrackColor(line.track))
        else
            local c = COLORS[line.kind] or COLORS.info
            GameTooltip:AddLine(line.text, c[1], c[2], c[3])
        end
    end
    if trackLine then
        GameTooltip:AddLine(trackLine, textColor("heading"))
    end
    GameTooltip:Show()
end

local function badgeClick(hit, button)
    rowClick(hit:GetParent(), button)
end

local function buildRow(f)
    f:RegisterForClicks("RightButtonUp")
    f:SetScript("OnClick", rowClick)
    f.bg = f:CreateTexture(nil, "BACKGROUND")
    f.bg:SetAllPoints()
    f.name = f:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    f.name:SetPoint("LEFT", 6, 0)
    f.name:SetWidth(L.nameW - 8)
    f.name:SetJustifyH("LEFT")
    f.name:SetWordWrap(false)
    f.ilvl = f:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    f.ilvl:SetPoint("LEFT", L.nameW, 0)
    f.ilvl:SetWidth(L.ilvlW)
    f.badge = f:CreateTexture(nil, "ARTWORK")
    f.badge:SetSize(L.badgeW, L.badgeH)
    f.badge:SetPoint("LEFT", L.nameW + L.ilvlW + (L.issuesW - L.badgeW) / 2, 0)
    f.issues = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    f.issues:SetPoint("CENTER", f.badge, "CENTER")
    -- the badge's hover area, the badge's size; a right-click there is the row's
    f.badgeHit = CreateFrame("Button", nil, f)
    f.badgeHit:SetSize(L.badgeW, L.badgeH)
    f.badgeHit:SetPoint("CENTER", f.badge, "CENTER")
    f.badgeHit:RegisterForClicks("RightButtonUp")
    f.badgeHit:SetScript("OnEnter", badgeEnter)
    f.badgeHit:SetScript("OnLeave", cellLeave)
    f.badgeHit:SetScript("OnClick", badgeClick)
    -- the Tracks column: pieces per track, highest first, each in its track's colour
    f.tracks = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    f.tracks:SetPoint("LEFT", L.nameW + L.ilvlW + L.issuesW, 0)
    f.tracks:SetWidth(L.tracksW)
    f.tracks:SetWordWrap(false)
    f.notSeen = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    f.notSeen:SetPoint("LEFT", L.nameW + L.ilvlW + L.issuesW + 8, 0)
    f.cells = {}
    for i = 1, #Gear.SLOTS do
        f.cells[i] = makeCell(f, i)
    end
end

-- The Tracks column's text: every track's count when it fits, else the highest that fit and a "+" (the
-- badge's tooltip has them all). Measured on the plain text, then shown in the tracks' colours.
local function textWidth(fs)
    return (fs.GetUnboundedStringWidth and fs:GetUnboundedStringWidth()) or fs:GetStringWidth() or 0
end

function P.SetTracks(fs, row)
    if not row.seen then
        fs:SetText("")
        return
    end
    local keep = #GC.TrackCounts(row)
    while keep > 1 do
        fs:SetText(GC.TrackText(row, false, keep))
        if textWidth(fs) <= L.tracksW then
            break
        end
        keep = keep - 1
    end
    fs:SetText(GC.TrackText(row, true, keep))
end

function P.InitRow(f, row)
    if not f.cells then
        buildRow(f)
    end
    f.data = row
    local index = row.index or 1
    f.bg:SetColorTexture(rowColor(index % 2 == 1))
    f.name:SetText(shortName(row.name))
    f.name:SetTextColor(classColor(row.class))
    f.ilvl:SetText(row.avg and string.format("%.1f", row.avg) or "")
    f.ilvl:SetTextColor(textColor("text"))
    f.badge:SetShown(row.seen)
    f.issues:SetShown(row.seen)
    if row.seen then
        local c = row.issues > 0 and COLORS.bad or COLORS.good
        f.badge:SetColorTexture(c[1], c[2], c[3], 0.85)
        f.issues:SetText(tostring(row.issues))
        f.issues:SetTextColor(1, 1, 1)
    end
    P.SetTracks(f.tracks, row)
    local why = not row.seen and GC.Inspect and GC.Inspect.skipped[row.name]
    f.notSeen:SetText(row.seen and "" or (why and TEXT.notSeenWhy[why] or TEXT.notSeen))
    f.notSeen:SetTextColor(0.6, 0.6, 0.6)
    local filter = P.filter or "all"
    for i, s in ipairs(Gear.SLOTS) do
        local r = row.slots[s.id]
        paintCell(f.cells[i], row, r, GC.CellShows(r, filter, row))
    end
end

-- The page ------------------------------------------------------------------------------------------------------

local function settings()
    return GC:Settings()
end

-- The Below chip's label for the track picked now ("Below Hero").
local function belowLabel()
    local t = GC:BelowTrack()
    return string.format(GC.TEXT.below, t and t.label or "")
end

local function sizeButton(b)
    local fs = b:GetFontString()
    b:SetWidth(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0))
end

local function paintHeaders()
    for _, h in ipairs(P.headers) do
        h:SetTextColor(textColor("heading"))
    end
    P.countText:SetTextColor(textColor("text"))
    for _, chip in ipairs(P.chips) do
        UI:StyleTab(chip, chip.key == P.filter)
        if chip.below then
            chip.label = belowLabel()
            chip.text:SetText(chip.label)
            chip.arrow.icon:SetVertexColor(textColor("text"))
        end
    end
    if P.extraButton then
        UI:StyleTab(P.extraButton, P.extraWindow ~= nil and P.extraWindow:IsShown()) -- looks picked while its window is open
    end
end

-- Works out the rows (once per change) and hands them to the list; only while the page or the pop-out shows.
function P.Refresh()
    if not P.body then
        return
    end
    if not P.body:IsVisible() then
        P.dirty = true
        return
    end
    P.dirty = false
    P.LayChips() -- only when the chips changed (an extra filter ticked, a new level)
    local filter = GC:FilterKey(settings().filter or "all") -- a check the season no longer has: Everyone
    P.filter = filter -- the rows' cells are drawn for it (P.InitRow)
    local rows = GC:Rows(filter)
    for i, row in ipairs(rows) do
        row.index = i
    end
    P.rows = rows
    P.shownIds = {}
    for _, row in ipairs(rows) do
        for _, piece in ipairs(row.pieces) do
            if piece.id then
                P.shownIds[piece.id] = true
            end
        end
    end
    P.box:SetDataProvider(CreateDataProvider(rows), ScrollBoxConstants and ScrollBoxConstants.RetainScrollPosition)
    P.countText:SetText(#rows > 0 and string.format(TEXT.count, #rows) or TEXT.empty)
    local n, m = GC.Comm:Count(GC:Roster())
    P.refreshButton:SetText(string.format(TEXT.refresh, n, m))
    sizeButton(P.refreshButton)
    paintHeaders()
end

-- The page or the pop-out opening: your own slots read again first (an enchant or a gem put on since
-- changes a link with no event of its own), then the rows.
function P.Open()
    Gear:Refresh()
    P.Refresh()
end

local function selectFilter(key)
    settings().filter = key
    P.Refresh()
end

-- A season check's chip shows its help on hover.
local function chipEnter(b)
    if b.help and GameTooltip then
        UI.TooltipOwner(GameTooltip, b, "ANCHOR_BOTTOM")
        GameTooltip:SetText(b.label)
        GameTooltip:AddLine(b.help, 1, 1, 1, true)
        GameTooltip:Show()
    end
end

-- The Below chip's menu (UI.ContextMenu, above every window): a choice per track but the lowest, the saved
-- one picked. A pick is saved (CRTDB.gearChecker.belowTrack) and turns the Below filter on.
function P.OpenBelowMenu(owner)
    UI.ContextMenu(owner, function(root)
        root:CreateTitle(TEXT.belowMenu)
        for _, t in ipairs(GC:BelowChoices()) do
            root:CreateRadio(t.label, function(key)
                local below = GC:BelowTrack()
                return below ~= nil and below.key == key
            end, function(key)
                settings().belowTrack = key
                selectFilter(GC.BELOW)
            end, t.key)
        end
    end)
end

-- The Below chip: wide enough for its longest label, with an arrow at its right that opens its menu (so
-- does a right-click on the chip); a left-click turns the filter on.
local function makeBelowParts(b)
    local widest = 0
    for _, t in ipairs(GC:BelowChoices()) do
        b.text:SetText(string.format(GC.TEXT.below, t.label))
        widest = math.max(widest, math.ceil(b.text:GetStringWidth() or 0))
    end
    b.text:SetText(belowLabel())
    b.text:ClearAllPoints()
    b.text:SetPoint("CENTER", -L.chipArrow / 2, 0)
    b:SetSize(widest + 2 * L.chipPad + L.chipArrow, L.chipH)
    b.below = true
    b:RegisterForClicks("LeftButtonUp", "RightButtonUp")
    local arrow = CreateFrame("Button", nil, b)
    arrow:SetSize(L.chipArrow + L.chipPad / 2, L.chipH)
    arrow:SetPoint("RIGHT", b, "RIGHT", 0, 0)
    arrow.icon = arrow:CreateTexture(nil, "OVERLAY")
    arrow.icon:SetAtlas("auctionhouse-ui-dropdown-arrow-down")
    arrow.icon:SetSize(L.chipArrow, L.chipArrowH)
    arrow.icon:SetPoint("CENTER", -2, 0)
    arrow:SetScript("OnClick", function()
        P.OpenBelowMenu(arrow)
    end)
    arrow:SetScript("OnEnter", function()
        chipEnter(b)
    end)
    arrow:SetScript("OnLeave", cellLeave)
    b.arrow = arrow
end

local function makeChip(parent, filter)
    local b = CreateFrame("Button", nil, parent, "BackdropTemplate")
    b:SetBackdrop({ bgFile = WHITE, edgeFile = WHITE, edgeSize = 1 })
    b.sel = b:CreateTexture(nil, "ARTWORK")
    b.sel:SetAllPoints()
    b.text = b:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    b.text:SetPoint("CENTER")
    b.text:SetText(filter.label)
    b:SetSize(math.ceil(b.text:GetStringWidth() or 0) + 2 * L.chipPad, L.chipH)
    b.key, b.label, b.help = filter.key, filter.label, filter.help
    if filter.below then
        makeBelowParts(b)
    end
    b:SetScript("OnClick", function(_, button)
        if b.below and button == "RightButton" then
            P.OpenBelowMenu(b)
        else
            selectFilter(filter.key)
        end
    end)
    b:SetScript("OnEnter", chipEnter)
    b:SetScript("OnLeave", cellLeave)
    UI:RegisterTab(b)
    return b
end

-- A filter's chip, made once per key and kept; a chip whose label changed (Item level below's level) is
-- given the new label and resized to it. The Below chip keeps its own size (its widest track).
local function chipFor(body, filter)
    local chip = P.chipOf[filter.key]
    if not chip then
        chip = makeChip(body, filter)
        P.chipOf[filter.key] = chip
    elseif not chip.below and chip.label ~= filter.label then
        chip.label = filter.label
        chip.text:SetText(filter.label)
        chip:SetSize(math.ceil(chip.text:GetStringWidth() or 0) + 2 * L.chipPad, L.chipH)
    end
    return chip
end

-- The chips (GC:Filters: the four, the ticked extra filters, one per season check, Below), then the Extra
-- filters button and its (?), from the left on as many rows as they need to stay left of L.chipsW; the
-- headings and the list move down with the rows. Laid out again only when the filters change.
function P.LayChips()
    local filters = GC:Filters()
    local sig = {}
    for i, f in ipairs(filters) do
        sig[i] = f.key .. "=" .. f.label
    end
    sig = table.concat(sig, "\n")
    if sig == P.chipsSig then
        return
    end
    P.chipsSig = sig
    for _, chip in ipairs(P.chips) do
        chip:Hide()
    end
    P.chips = {}
    local x, y = 0, 0
    local function place(b, room)
        if x > 0 and x + b:GetWidth() + room > L.chipsW then
            x, y = 0, y - (L.chipH + L.chipGap)
        end
        b:ClearAllPoints()
        b:SetPoint("TOPLEFT", x, y)
        b:Show()
        x = x + b:GetWidth() + L.chipGap
    end
    for _, filter in ipairs(filters) do
        local chip = chipFor(P.body, filter)
        place(chip, 0)
        P.chips[#P.chips + 1] = chip
    end
    place(P.extraButton, L.helpW) -- with room for the (?) right of it
    P.chipsDown = y
    for _, h in ipairs(P.colHeads) do
        h:ClearAllPoints()
        h:SetPoint("TOPLEFT", h.x0, L.headY + y)
    end
    if P.box then
        P.box:ClearAllPoints()
        P.box:SetPoint("TOPLEFT", 0, L.listY + y)
        P.box:SetPoint("BOTTOMLEFT", 0, 0)
    end
end

-- The Extra filters window -----------------------------------------------------------------------------------

-- A check box per extra filter (GC.EXTRA_FILTERS), each with its (?); Item level below has a number box for
-- its level. A tick or a level is saved (GC:SetExtra) and the page redrawn, its chips with it.
local function extraNumber(parent, anchor)
    local edit = CreateFrame("EditBox", nil, parent, "InputBoxTemplate")
    edit:SetAutoFocus(false)
    edit:SetFontObject(CRTFontHighlight)
    edit:SetNumeric(true)
    edit:SetMaxLetters(4)
    edit:SetSize(L.extraEditW, L.extraEditH)
    edit:SetPoint("LEFT", anchor, "RIGHT", 10, 0)
    edit:SetText(tostring(GC:MinIlvl()))
    edit:SetScript("OnEnterPressed", function(self)
        self:ClearFocus()
    end)
    edit:SetScript("OnEscapePressed", function(self)
        self:SetText(tostring(GC:MinIlvl()))
        self:ClearFocus()
    end)
    edit:SetScript("OnEditFocusLost", function(self)
        GC:SetExtra("minIlvl", tonumber(self:GetText()) or 0)
        self:SetText(tostring(GC:MinIlvl()))
        P.Refresh()
    end)
    return edit
end

local function buildExtra()
    local win = UI.Window("CowfeeRaidToolsGearCheckerExtra", {
        kind = "dialog", title = TEXT.extra, layer = "popups", width = L.extraW, height = L.extraH,
    })
    P.extraWindow = win
    P.extraChecks = {}
    local c = win.content
    for i, f in ipairs(GC.EXTRA_FILTERS) do
        local cb = CreateFrame("CheckButton", nil, c, "UICheckButtonTemplate")
        cb:SetSize(L.extraCheck, L.extraCheck)
        cb:SetPoint("TOPLEFT", 0, -(i - 1) * L.extraRowH)
        local name = f.option or f.label
        cb.label = c:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
        cb.label:SetPoint("LEFT", cb, "RIGHT", 2, 0)
        cb.label:SetText(name)
        cb.key = f.key
        -- the saved tick decides, not the box's own state, so the two can't drift apart
        cb:SetScript("OnClick", function(self)
            GC:SetExtra(f.key, not GC:ExtraOn(f.key))
            self:SetChecked(GC:ExtraOn(f.key))
            P.Refresh()
        end)
        local helpOn = cb
        if f.number then
            P.minIlvlEdit = extraNumber(c, cb.label)
            helpOn = P.minIlvlEdit
        end
        UI.HelpRight(helpOn, name, f.help)
        P.extraChecks[i] = cb
    end
    win:HookScript("OnShow", paintHeaders)
    win:HookScript("OnHide", paintHeaders)
    UI:SkinTree(win)
end

-- Opens the window under the button, its boxes showing what is saved, or closes it.
function P.ToggleExtra()
    if not P.extraWindow then
        buildExtra()
    end
    local win = P.extraWindow
    if win:IsShown() then
        win:Hide()
        return
    end
    for _, cb in ipairs(P.extraChecks) do
        cb:SetChecked(GC:ExtraOn(cb.key))
        cb.label:SetTextColor(textColor("text"))
    end
    P.minIlvlEdit:SetText(tostring(GC:MinIlvl()))
    win:SetScale(UI:Scale() / 100)
    win:ClearAllPoints()
    win:SetPoint("TOPLEFT", P.extraButton, "BOTTOMLEFT", 0, -4)
    win:Show()
    pcall(win.Raise, win) -- over the pop-out, which is on the same layer
    UI:SkinTree(win)
end

local function buildBody(body)
    -- the Extra filters button: a chip's look, after the chips (P.LayChips places it)
    P.extraButton = makeChip(body, { key = "extraFilters", label = TEXT.extra })
    P.extraButton:SetScript("OnClick", function()
        P.ToggleExtra()
    end)
    UI.HelpRight(P.extraButton, TEXT.title, string.format(TEXT.help, GC.LOW_ILVL))

    P.popButton = UI.PanelButton(body, TEXT.popOut, L.buttonH, function()
        P.TogglePopout()
    end)
    P.popButton:SetPoint("TOPRIGHT", body, "TOPRIGHT", 0, 0)
    P.refreshButton = UI.PanelButton(body, string.format(TEXT.refresh, 1, 1), L.buttonH, function()
        GC:Refresh()
    end)
    P.refreshButton:SetPoint("RIGHT", P.popButton, "LEFT", -6, 0)
    P.countText = body:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    P.countText:SetPoint("RIGHT", P.refreshButton, "LEFT", -10, 0)

    -- the column headings, over the list's columns
    local function heading(text, x0, w, justify)
        local h = body:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        h.x0 = x0 -- P.LayChips puts it under the chips' rows
        h:SetWidth(w)
        h:SetJustifyH(justify or "CENTER")
        h:SetWordWrap(false)
        h:SetText(text)
        P.headers[#P.headers + 1] = h
        P.colHeads[#P.colHeads + 1] = h
        return h
    end
    heading(TEXT.name, 6, L.nameW - 6, "LEFT")
    heading(TEXT.ilvl, L.nameW, L.ilvlW)
    heading(TEXT.issues, L.nameW + L.ilvlW, L.issuesW)
    heading(TEXT.tracks, L.nameW + L.ilvlW + L.issuesW, L.tracksW)
    for i, s in ipairs(Gear.SLOTS) do
        heading(s.name, L.cellsX + (i - 1) * L.cellW, L.cellW)
    end

    local box = CreateFrame("Frame", nil, body, "WowScrollBoxList")
    box:SetWidth(L.rowW) -- placed by P.LayChips, under the chips' rows
    local bar = CreateFrame("EventFrame", nil, body, "MinimalScrollBar")
    UI:SkinScrollBar(bar)
    bar:SetPoint("TOPLEFT", box, "TOPRIGHT", UI.SCROLL_GAP, 0)
    bar:SetPoint("BOTTOMLEFT", box, "BOTTOMRIGHT", UI.SCROLL_GAP, 0)
    local view = CreateScrollBoxListLinearView()
    view:SetElementExtent(L.rowH)
    view:SetElementInitializer("Button", P.InitRow)
    ScrollUtil.InitScrollBoxListWithScrollBar(box, bar, view)
    P.box, P.bar = box, bar
    P.LayChips()
end

-- The pop-out window ------------------------------------------------------------------------------------------

local function popSettings()
    local s = settings()
    s.popout = s.popout or {}
    return s.popout
end

local function buildPopout()
    if P.window then
        return
    end
    P.window = UI.Window("CowfeeRaidToolsGearCheckerWindow", {
        kind = "popout", title = TEXT.title, layer = "popups", saved = popSettings,
        width = L.popW, height = L.popH, minWidth = L.popMinW, minHeight = L.popMinH,
    })
    P.window.refresh = P.Refresh
    -- closing the window, however it closes (its X, Escape or Dock), puts the page back
    P.window:SetScript("OnHide", function()
        if P.popped then
            P.Dock()
        end
    end)
    P.window:HookScript("OnShow", P.Refresh) -- hooked: the window's own OnShow (UI.Window, UI:StyleWindow) stays
end

function P.Dock()
    P.popped = false
    P.body:SetParent(P.page)
    P.body:ClearAllPoints()
    P.body:SetPoint("TOPLEFT", 8, -8)
    P.body:SetPoint("BOTTOMRIGHT", -8, 8)
    P.body:Show()
    P.dockedNote:Hide()
    P.popButton:SetText(TEXT.popOut)
    sizeButton(P.popButton)
    if P.window and P.window:IsShown() then
        P.window:Hide()
    end
    P.Refresh()
end

function P.PopOut()
    buildPopout()
    P.popped = true
    P.window:SetScale(UI:Scale() / 100)
    P.window:Place()
    P.body:SetParent(P.window.content)
    P.body:ClearAllPoints()
    P.body:SetAllPoints(P.window.content)
    P.body:Show()
    P.dockedNote:Show()
    P.popButton:SetText(TEXT.dock)
    sizeButton(P.popButton)
    P.window:Show()
    UI:SkinTree(P.window)
    P.Open()
end

function P.TogglePopout()
    if P.popped then
        P.Dock()
    else
        P.PopOut()
    end
end

-- /crt gear pop: the page in its own window, built first if the main window never showed it.
function GC.Popout()
    if not P.body then
        UI:Show("gearcheck")
    end
    if P.body and not P.popped then
        P.PopOut()
    end
end

local function build(page)
    P.page = page
    local body = CreateFrame("Frame", nil, page)
    body:SetPoint("TOPLEFT", 8, -8)
    body:SetPoint("BOTTOMRIGHT", -8, 8)
    P.body = body
    buildBody(body)
    body:SetScript("OnShow", function()
        if P.dirty then
            P.Refresh()
        end
    end)

    -- shown on the page while the pop-out holds the rest
    local note = CreateFrame("Frame", nil, page)
    note:SetAllPoints()
    note:Hide()
    local text = note:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    text:SetPoint("TOPLEFT", 8, -12)
    text:SetText(TEXT.docked)
    P.headers[#P.headers + 1] = text
    local back = UI.PanelButton(note, TEXT.bringBack, L.buttonH, function()
        P.Dock()
    end)
    back:SetPoint("LEFT", text, "RIGHT", 10, 0)
    P.dockedNote = note

    page:SetScript("OnShow", function()
        if not P.refreshedOnce then
            P.refreshedOnce = true
            GC:Refresh() -- the first time the page shows: ask the group and inspect the rest
        end
        P.Open()
    end)
    -- leaving the page closes the Extra filters window (kept built); while the page is popped out its
    -- button lives in the pop-out, so the window stays
    page:HookScript("OnHide", function()
        if P.extraWindow and not P.popped then
            P.extraWindow:Hide()
        end
    end)
    GC:OnChange(P.Refresh)
    UI:OnTheme(P.Refresh)
    P.Refresh()
end

-- An item shown on the page has loaded (its quality, and so its border colour, comes only then): one
-- redraw a moment later for all the items that load together.
P.LOAD_REDRAW = 0.2 -- seconds

function P.OnEvent(event, itemID)
    if event ~= "ITEM_DATA_LOAD_RESULT" or secret(itemID) or not (P.shownIds and P.shownIds[itemID]) or P.redrawWaiting then
        return
    end
    P.redrawWaiting = true
    C_Timer.After(P.LOAD_REDRAW, function()
        P.redrawWaiting = false
        P.Refresh()
    end)
end

if CreateFrame then
    local events = CreateFrame("Frame")
    events:RegisterEvent("ITEM_DATA_LOAD_RESULT")
    events:SetScript("OnEvent", function(_, event, itemID)
        P.OnEvent(event, itemID)
    end)
end

UI:RegisterPage("gearcheck", TEXT.title, build)

-- /crt gear, gear pop (CRT_Core/Slash.lua's registry)
if CRT.Slash then
    CRT.Slash:Register("gear", {
        run = function(rest)
            if rest == "" then
                UI:Show("gearcheck")
            elseif rest == "pop" then
                GC.Popout()
            else
                return false
            end
        end,
        help = { "[/crt gear] - open the Gear Checker: everyone's gear, gems and enchants ([/crt gear pop] opens it in its own window)" },
    })
end
