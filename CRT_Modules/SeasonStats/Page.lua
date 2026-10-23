local ADDON, CRT = ...

-- The Season Stats page (Modules > Season Stats): a Season dropdown (the boss library's season packs, the current
-- one first) and a Difficulty dropdown (the Timeline's groups); four cards (bosses killed of the season's route,
-- pulls, raid nights, time in pulls); the table of the route's bosses in route order (sortable, back to route order
-- on a third click); and the reflection for the boss picked in the table: its longest pull each night as bars,
-- the furthest phase, the spells that killed most, deaths per pull, and Tattlebot's avoidable damage per night.
-- The counters are SeasonStats/Data.lua's. No settings, so no tabs. Laid out for the page area
-- (UI.PAGE_W x UI.PAGE_H); layout numbers in L, wording in TEXT. S.view keeps the parts, for the harness
-- (CRT_Dev/Tests/run_seasonstats.js).

local S = CRT.SeasonStats
local UI = CRT.UI

local L = {
    left = 8, headTop = -8, filterTop = -2, seasonX = 190, seasonLabelW = 50, seasonW = 200, groupX = 470,
    groupLabelW = 64, groupW = 130,
    cardsTop = -44, cardH = 54, cardGap = 10, cardPad = 10,
    tableTop = -114, tableW = 604, headH = 22, row = 20, rows = 20,
    reflX = 630, reflW = 388, bodyTop = -26, line = 16, bars = 8, barsTop = -18, dateW = 70, barX = 74, barW = 200, barH = 10,
    causes = 3, avoid = 4,
}

-- The table's columns: key, x, w; each title is TEXT.columns[key].
local COLS = {
    { key = "name", x = 0, w = 184 },
    { key = "pulls", x = 190, w = 50 },
    { key = "wipes", x = 244, w = 50 },
    { key = "kills", x = 298, w = 44 },
    { key = "toKill", x = 346, w = 96 },
    { key = "best", x = 446, w = 62 },
    { key = "first", x = 512, w = 90 },
}

local TEXT = {
    title = "Season Stats",
    columns = { name = "Boss", pulls = "Pulls", wipes = "Wipes", kills = "Kills", toKill = "To first kill", best = "Best kill", first = "First kill" },
    help = "Your raid's season, boss by boss: pulls, wipes and kills on the difficulty you pick.\n\n"
        .. "Every pull the Timeline saves counts, so keep Record on in the Timeline's settings.\n\n"
        .. "Pulls from before Season Stats are filled in once from the Timeline's saved pulls. It keeps only the newest of them, so older pulls count as wipes with no length.\n\n"
        .. "Raid nights are the Late Tracker's nights between the season's first and last pull. Click a boss to see how its pulls went.",
    season = "Season", difficulty = "Difficulty",
    killed = "Bosses killed", pulls = "Pulls", nights = "Raid nights", time = "Time in pulls",
    nightsTip = "Nights the Late Tracker saved between this season's first and last pull.",
    pullNights = "%d nights had pulls on this difficulty.",
    untimed = "%d early pulls have no saved length, so they aren't in this time.",
    noPulls = "No pulls on this difficulty yet.",
    inProgress = "in progress", none = "-",
    rowTime = "Time in pulls: %s", rowKills = "Kill time: %s", rowClick = "Click to see how its pulls went.",
    reflection = "Reflection", reflectionOf = "Reflection: %s",
    reflectionHelp = "How a boss went, night by night.\n\n"
        .. "The game hides a boss's health from addons during an encounter, so the longest pull and the furthest phase stand in for how close you got.\n\n"
        .. "The phase is the one the alerts reached in the pull. Pulls from before Season Stats have none.\n\n"
        .. "Avoidable damage is Tattlebot's: its tracked mechanics, and the game's avoidable damage when that is on in Tattlebot's settings.",
    pick = "Click a boss in the table to see how its pulls went.",
    bossEmpty = "No pulls on this boss on %s yet.",
    longest = "Longest pull each night",
    barValue = "%s, %s",
    furthest = "Furthest phase: %s, first on %s.",
    noPhase = "Furthest phase: not known.",
    causes = "Most deaths from",
    cause = "%s: %d",
    noCauses = "No deaths with a known spell.",
    trendBoth = "Deaths a pull: %s in the last %d, %s in the %d before.",
    trendOne = "Deaths a pull: %s in the last %d.",
    avoid = "Avoidable damage a pull (Tattlebot)",
    avoidLine = "%s: %s a pull (%d %s)",
    noAvoid = "Tattlebot has no pulls on this boss on this difficulty.",
    pull = "pull", pullsWord = "pulls",
}

for _, col in ipairs(COLS) do
    col.title = TEXT.columns[col.key]
end

local view -- the parts, once built
local state = { boss = nil, sortKey = nil, sortDir = 1 } -- season and group are set when the page is built

local function text(parent, font, x, y, width)
    local fs = parent:CreateFontString(nil, "OVERLAY", font or "CRTFontSmall")
    fs:SetPoint("TOPLEFT", x, y)
    if width then
        fs:SetWidth(width)
        fs:SetWordWrap(false)
    end
    fs:SetJustifyH("LEFT")
    return fs
end

local function spellName(id)
    if C_Spell and C_Spell.GetSpellName then
        local ok, name = pcall(C_Spell.GetSpellName, id)
        if ok and type(name) == "string" and name ~= "" then
            return name
        end
    end
    return "Spell " .. tostring(id)
end

local function short(n)
    local Tattle = CRT.Tattle
    if Tattle and Tattle.Short then
        return Tattle.Short(n)
    end
    return tostring(math.floor(n + 0.5))
end

local function groupLabel(group)
    for _, o in ipairs(S.GroupOptions()) do
        if o.key == group then
            return o.label
        end
    end
    return group
end

-- Tooltips ----------------------------------------------------------------------------------------------------------

local function showTip(owner, lines)
    UI.TooltipOwner(GameTooltip, owner, "ANCHOR_RIGHT")
    GameTooltip:SetText(lines[1])
    for i = 2, #lines do
        GameTooltip:AddLine(lines[i], 1, 1, 1, true)
    end
    GameTooltip:Show()
end

local function hideTip()
    GameTooltip:Hide()
end

-- Cards -------------------------------------------------------------------------------------------------------------

local function makeCard(f, i, label)
    local w = (UI.PAGE_W - 2 * L.left - 3 * L.cardGap) / 4
    local card = CreateFrame("Frame", nil, f, "BackdropTemplate")
    card:SetPoint("TOPLEFT", L.left + (i - 1) * (w + L.cardGap), L.cardsTop)
    card:SetSize(w, L.cardH)
    card:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    UI.Tint(card, "SetBackdropColor", "surface", 0.9)
    UI.Tint(card, "SetBackdropBorderColor", "border")
    card.value = text(card, "CRTFontLarge", L.cardPad, -8, w - 2 * L.cardPad)
    card.label = text(card, "CRTFontSmall", L.cardPad, -32, w - 2 * L.cardPad)
    card.label:SetText(label)
    card:EnableMouse(true)
    card:SetScript("OnEnter", function(self)
        if self.tip then
            showTip(self, self.tip)
        end
    end)
    card:SetScript("OnLeave", hideTip)
    return card
end

local function refreshCards(card)
    local c = view.cards
    c.killed.value:SetText(string.format("%d / %d", card.killed, card.bosses))
    c.pulls.value:SetText(tostring(card.pulls))
    c.nights.value:SetText(tostring(card.nights))
    c.nights.tip = { TEXT.nights, TEXT.nightsTip, TEXT.pullNights:format(card.pullNights) }
    c.time.value:SetText(S.Hours(card.pullTime))
    c.time.tip = card.untimed > 0 and { TEXT.time, TEXT.untimed:format(card.untimed) } or nil
end

-- The table ---------------------------------------------------------------------------------------------------------

local SORT = {
    name = function(r) return r.name:lower() end,
    pulls = function(r) return r.pulls end,
    wipes = function(r) return r.wipes end,
    kills = function(r) return r.kills end,
    toKill = function(r) return r.firstKillPull end,
    best = function(r) return r.bestKill end,
    first = function(r) return r.firstKillAt end,
}

-- rows sorted by the chosen column; a row with no value (no kill yet) last either way; route order breaks ties
local function sorted(rows)
    local by = state.sortKey and SORT[state.sortKey]
    if not by then
        return rows
    end
    for i, r in ipairs(rows) do
        r.route = i
    end
    local out = {}
    for i, r in ipairs(rows) do
        out[i] = r
    end
    table.sort(out, function(a, b)
        local x, y = by(a), by(b)
        if x == nil or y == nil or x == y then
            if (x == nil) ~= (y == nil) then
                return y == nil
            end
            return a.route < b.route
        end
        if state.sortDir < 0 then
            return x > y
        end
        return x < y
    end)
    return out
end

local function paintRow(row, r)
    row.encounterID = r.encounterID
    row.data = r
    row.name:SetText(r.name)
    row.pulls:SetText(tostring(r.pulls))
    row.wipes:SetText(tostring(r.wipes))
    row.kills:SetText(r.kills > 0 and UI.GoodText(tostring(r.kills)) or tostring(r.kills))
    if r.kills > 0 then
        row.toKill:SetText(tostring(r.firstKillPull))
    else
        row.toKill:SetText(r.pulls > 0 and UI.WarnText(TEXT.inProgress) or TEXT.none)
    end
    row.best:SetText(r.bestKill and S.Clock(r.bestKill) or TEXT.none)
    row.first:SetText(r.firstKillAt and date("%Y-%m-%d", r.firstKillAt) or TEXT.none)
    row.sel:SetShown(state.boss == r.encounterID)
    row:Show()
end

local function rowTip(row)
    local r = row.data
    if not r then
        return
    end
    local lines = { r.name, TEXT.rowTime:format(S.Hours(r.pullTime)) }
    if r.counters and r.counters.killTime > 0 then
        lines[#lines + 1] = TEXT.rowKills:format(S.Hours(r.counters.killTime))
    end
    lines[#lines + 1] = TEXT.rowClick
    showTip(row, lines)
end

local function buildRow(f, i)
    local row = CreateFrame("Button", nil, f)
    row:SetPoint("TOPLEFT", L.left, L.tableTop - L.headH - (i - 1) * L.row)
    row:SetSize(L.tableW, L.row - 2)
    local hl = row:CreateTexture(nil, "HIGHLIGHT")
    hl:SetAllPoints()
    hl:SetColorTexture(1, 1, 1, 0.06)
    row.sel = row:CreateTexture(nil, "BACKGROUND")
    row.sel:SetAllPoints()
    UI.Tint(row.sel, "SetColorTexture", "selected", 0.5)
    for _, col in ipairs(COLS) do
        row[col.key] = text(row, "CRTFontSmall", col.x, -3, col.w - 4)
    end
    row:SetScript("OnClick", function(self)
        state.boss = self.encounterID
        view.refresh()
    end)
    row:SetScript("OnEnter", rowTip)
    row:SetScript("OnLeave", hideTip)
    row:Hide()
    return row
end

local function refreshTable(rows, card)
    rows = sorted(rows)
    for i = 1, math.min(#rows, L.rows) do
        view.rows[i] = view.rows[i] or buildRow(view.page, i)
        paintRow(view.rows[i], rows[i])
    end
    for i = #rows + 1, #view.rows do
        view.rows[i].data = nil
        view.rows[i]:Hide()
    end
    -- under the rows, which show the route's bosses with zeros
    view.empty:ClearAllPoints()
    view.empty:SetPoint("TOPLEFT", L.left, L.tableTop - L.headH - math.min(#rows, L.rows) * L.row - 4)
    view.empty:SetShown(card.pulls == 0)
    view.sort.refresh()
end

-- The reflection ------------------------------------------------------------------------------------------------------

local function buildBars(body)
    local bars = {}
    for i = 1, L.bars do
        local bar = CreateFrame("Frame", nil, body)
        bar:SetPoint("TOPLEFT", 0, L.barsTop - (i - 1) * L.line)
        bar:SetSize(L.reflW, L.line)
        bar.date = text(bar, "CRTFontSmall", 0, 0, L.dateW)
        bar.track = bar:CreateTexture(nil, "BACKGROUND")
        bar.track:SetPoint("TOPLEFT", L.barX, -3)
        bar.track:SetSize(L.barW, L.barH)
        UI.Tint(bar.track, "SetColorTexture", "border", 0.6)
        bar.fill = bar:CreateTexture(nil, "ARTWORK")
        bar.fill:SetPoint("TOPLEFT", L.barX, -3)
        bar.fill:SetSize(1, L.barH)
        UI.Tint(bar.fill, "SetColorTexture", "accent")
        bar.value = text(bar, "CRTFontSmall", L.barX + L.barW + 6, 0, L.reflW - L.barX - L.barW - 6)
        bars[i] = bar
    end
    return bars
end

local function buildReflection(f)
    local refl = CreateFrame("Frame", nil, f)
    refl:SetPoint("TOPLEFT", L.reflX, L.tableTop)
    refl:SetSize(L.reflW, UI.PAGE_H + L.tableTop - 8)
    refl.title = text(refl, "CRTFontNormal", 0, 0)
    refl.title:SetText(TEXT.reflection)
    UI.HelpRight(refl.title, TEXT.reflection, TEXT.reflectionHelp)
    refl.hint = text(refl, "CRTFontSmall", 0, L.bodyTop, L.reflW)
    refl.hint:SetText(TEXT.pick)
    refl.empty = text(refl, "CRTFontSmall", 0, L.bodyTop, L.reflW)
    local body = CreateFrame("Frame", nil, refl)
    body:SetPoint("TOPLEFT", 0, L.bodyTop)
    body:SetSize(L.reflW, UI.PAGE_H + L.tableTop + L.bodyTop - 8)
    refl.body = body
    text(body, "CRTFontSmall", 0, 0, L.reflW):SetText(UI.HeadingText(TEXT.longest))
    refl.bars = buildBars(body)
    local y = L.barsTop - L.bars * L.line - 6
    refl.furthest = text(body, "CRTFontSmall", 0, y, L.reflW)
    y = y - 26
    text(body, "CRTFontSmall", 0, y, L.reflW):SetText(UI.HeadingText(TEXT.causes))
    refl.causes = {}
    for i = 1, L.causes do
        refl.causes[i] = text(body, "CRTFontSmall", 0, y - i * L.line - 2, L.reflW)
    end
    y = y - (L.causes + 1) * L.line - 8
    refl.trend = text(body, "CRTFontSmall", 0, y, L.reflW)
    y = y - 26
    text(body, "CRTFontSmall", 0, y, L.reflW):SetText(UI.HeadingText(TEXT.avoid))
    refl.avoid = {}
    for i = 1, L.avoid do
        refl.avoid[i] = text(body, "CRTFontSmall", 0, y - i * L.line - 2, L.reflW)
    end
    refl.avoidHint = text(body, "CRTFontSmall", 0, y - L.line - 2, L.reflW)
    refl.avoidHint:SetText(TEXT.noAvoid)
    return refl
end

local function paintBars(r)
    for i, bar in ipairs(view.refl.bars) do
        local night = r.nights[#r.nights - i + 1] -- newest first
        bar:SetShown(night ~= nil)
        if night then
            bar.date:SetText(night.key)
            bar.fill:SetWidth(math.max(1, r.longest > 0 and L.barW * night.longest / r.longest or 1))
            local clock = S.Clock(night.longest)
            bar.value:SetText(night.phase and TEXT.barValue:format(clock, S.PhaseText(night.phase)) or clock)
        end
    end
end

local function trendText(r)
    if not r.recent then
        return ""
    end
    local recent = string.format("%.1f", r.recent)
    if not r.before then
        return TEXT.trendOne:format(recent, r.recentN)
    end
    if r.recent < r.before then
        recent = UI.GoodText(recent)
    elseif r.recent > r.before then
        recent = UI.BadText(recent)
    end
    return TEXT.trendBoth:format(recent, r.recentN, string.format("%.1f", r.before), r.beforeN)
end

local function paintAvoid(trend)
    local refl = view.refl
    refl.avoidHint:SetShown(trend == nil)
    for i, line in ipairs(refl.avoid) do
        local night = trend and trend[i]
        line:SetShown(night ~= nil)
        if night then
            line:SetText(TEXT.avoidLine:format(night.key, short(night.perPull), night.pulls, night.pulls == 1 and TEXT.pull or TEXT.pullsWord))
        end
    end
end

local function refreshReflection(rows)
    local refl = view.refl
    local row
    for _, r in ipairs(rows) do
        if r.encounterID == state.boss then
            row = r
        end
    end
    if not row then
        state.boss = nil
    end
    refl.title:SetText(row and TEXT.reflectionOf:format(row.name) or TEXT.reflection)
    refl.hint:SetShown(row == nil)
    refl.empty:SetShown(row ~= nil and row.counters == nil)
    refl.empty:SetText(TEXT.bossEmpty:format(groupLabel(state.group)))
    refl.body:SetShown(row ~= nil and row.counters ~= nil)
    if not (row and row.counters) then
        return
    end
    local r = S.Reflection(row.counters, L.bars)
    paintBars(r)
    refl.furthest:SetText(r.furthest and TEXT.furthest:format(S.PhaseText(r.furthest.phase), r.furthest.key) or TEXT.noPhase)
    for i, line in ipairs(refl.causes) do
        local cause = r.causes[i]
        line:SetShown(cause ~= nil or i == 1)
        line:SetText(cause and TEXT.cause:format(spellName(cause.spellID), cause.count) or TEXT.noCauses)
    end
    refl.trend:SetText(trendText(r))
    paintAvoid(S:AvoidableTrend(row.encounterID, state.group, L.avoid))
end

-- The page ----------------------------------------------------------------------------------------------------------

local function refresh()
    if not view then
        return
    end
    local card, rows = S:Cards(state.season, state.group)
    refreshCards(card)
    refreshTable(rows, card)
    refreshReflection(rows)
    view.season.refresh()
    view.group.refresh()
end

local function buildHeader(f)
    local head = text(f, "CRTFontNormal", L.left, L.headTop)
    head:SetText(TEXT.title)
    UI.HelpRight(head, TEXT.title, TEXT.help)
    view.season = UI.Dropdown(f, TEXT.season, {
        options = S.SeasonOptions,
        labelWidth = L.seasonLabelW,
        width = L.seasonW,
        get = function()
            return state.season
        end,
        set = function(key)
            state.season, state.boss = key, nil
            refresh()
        end,
    })
    view.season:SetPoint("TOPLEFT", L.seasonX, L.filterTop)
    view.group = UI.Dropdown(f, TEXT.difficulty, {
        options = S.GroupOptions,
        labelWidth = L.groupLabelW,
        width = L.groupW,
        get = function()
            return state.group
        end,
        set = function(key)
            state.group = key
            refresh()
        end,
    })
    view.group:SetPoint("TOPLEFT", L.groupX, L.filterTop)
end

local function build(f)
    view = { rows = {}, page = f }
    S.view = view
    local first = S.SeasonOptions()[1]
    state.season = first and first.key or nil
    state.group = S:DefaultGroup(state.season)
    buildHeader(f)
    view.cards = {
        killed = makeCard(f, 1, TEXT.killed),
        pulls = makeCard(f, 2, TEXT.pulls),
        nights = makeCard(f, 3, TEXT.nights),
        time = makeCard(f, 4, TEXT.time),
    }
    view.sort = UI.SortHeaders(f, COLS, {
        x = L.left, y = L.tableTop, backToDefault = true,
        get = function()
            return state.sortKey, state.sortDir
        end,
        set = function(key, dir)
            state.sortKey, state.sortDir = key, dir
            refresh()
        end,
    })
    view.empty = text(f, "CRTFontSmall", L.left, L.tableTop - L.headH - 3, L.tableW)
    view.empty:SetText(TEXT.noPulls)
    view.refl = buildReflection(f)
    view.refresh = refresh
    f:SetScript("OnShow", refresh)
    refresh()
end

-- a new pull, the fill or a profile's counters: redraw while the page shows
S:OnChange(function()
    if view and view.page:IsVisible() then
        refresh()
    end
end)

UI:RegisterPage("seasonstats", TEXT.title, build)
