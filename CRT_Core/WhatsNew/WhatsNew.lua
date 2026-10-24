local ADDON, CRT = ...

-- What's new: a small window, once after an update, with the new version's few lines from WhatsNew/Data.lua.
--   When  the installed version (the .toc's ## Version:, CRT.version in Core.lua) is newer than CRTDB.whatsNew.seen
--         and Data.lua has entries after seen up to it. About 5 s after the first PLAYER_ENTERING_WORLD of the
--         session; never in combat, an encounter, a loading screen or a cinematic: it waits for that to end (the
--         end events, and a slow re-check in case one is missed), and never drops.
--   seen  set when the window closes (Got it, X or Escape), so a /reload before then shows it again. A fresh
--         install (no CRTDB before this login: CRT.freshInstall) records the version and shows nothing. A player
--         upgrading into this feature (no seen yet) sees only the installed version's entry. With nothing to show,
--         or Show after updates off (CRTDB.whatsNew.show), the version is recorded straight away.
--   Many  skipped versions: their lines newest first, at most 5, the rest counted into "and N smaller fixes".
-- /crt whatsnew (Slash.lua) opens it any time: the installed version's entry, or the newest one.
-- whatsNew is account-wide (Profiles.lua's SHARED) and never in Export settings only: a personal preference.

local WN = {}
CRT.WhatsNew = WN
local UI = CRT.UI

local TEXT = {
    title = "What's new in %s",
    bullet = "•",
    more = "and %d smaller fixes",
    moreOne = "and 1 smaller fix",
    show = "Show after updates",
    gotIt = "Got it",
    none = "No notes for this version.",
}
WN.TEXT = TEXT

-- delay: seconds after entering the world; retry: after a blocking state ends; poll: the slow re-check while blocked
local L = {
    width = 360, maxLines = 5, delay = 5, retry = 2, poll = 10,
    top = 4, indent = 12, rowGap = 4, moreGap = 4, footerGap = 12, button = 24, check = 24, checkGap = 2,
}
WN.LAYOUT = L

-- A version as its numbers and its pre-release rank: "1.1.3-beta2" is { 1, 1, 3 }, 2002. nil for a release, which
-- comes after every pre-release of the same numbers. alpha before beta before rc; any other word ranks as beta.
local PRE = { alpha = 1, a = 1, beta = 2, b = 2, rc = 3 }

local function parse(v)
    if type(v) ~= "string" then
        return nil
    end
    local nums, rest = v:match("^%s*[vV]?(%d[%d%.]*)(.*)$")
    if not nums then
        return nil
    end
    local parts = {}
    for n in nums:gmatch("%d+") do
        parts[#parts + 1] = tonumber(n)
    end
    local word = rest:lower():match("(%a+)")
    local pre
    if word then
        pre = (PRE[word] or PRE.beta) * 1000 + (tonumber(rest:match("(%d+)")) or 0)
    end
    return parts, pre
end

-- -1, 0 or 1 as a is before, the same as or after b; nil when either isn't a version (such as "dev").
function WN.Compare(a, b)
    local pa, ra = parse(a)
    local pb, rb = parse(b)
    if not (pa and pb) then
        return nil
    end
    for i = 1, math.max(#pa, #pb) do
        local x, y = pa[i] or 0, pb[i] or 0
        if x ~= y then
            return x < y and -1 or 1
        end
    end
    if ra == rb then
        return 0
    end
    if ra == nil then
        return 1
    end
    if rb == nil then
        return -1
    end
    return ra < rb and -1 or 1
end
local compare = WN.Compare

-- The entries newest first, leaving out any whose version isn't one.
local function sorted(data)
    local list = {}
    for _, e in ipairs(type(data) == "table" and data or {}) do
        if type(e) == "table" and compare(e.version, e.version) then
            list[#list + 1] = e
        end
    end
    table.sort(list, function(a, b)
        return compare(a.version, b.version) == 1
    end)
    return list
end

-- What to show: { version (the newest), lines (at most 5), more } from the entries after seen up to installed,
-- or nil. No seen (or one that isn't a version): only installed's own entry.
function WN.Collect(installed, seen, data)
    if not compare(installed, installed) then
        return nil
    end
    local hasSeen = compare(seen, seen) ~= nil
    local set = { lines = {}, more = 0 }
    for _, e in ipairs(sorted(data)) do
        local upTo = compare(e.version, installed) <= 0
        local take = upTo and (hasSeen and compare(e.version, seen) == 1 or (not hasSeen and compare(e.version, installed) == 0))
        if take then
            set.version = set.version or e.version
            for _, line in ipairs(type(e.lines) == "table" and e.lines or {}) do
                if #set.lines < L.maxLines then
                    set.lines[#set.lines + 1] = line
                else
                    set.more = set.more + 1
                end
            end
            set.more = set.more + (tonumber(e.more) or 0)
        end
    end
    return set.version and set or nil
end

local function db()
    return CRT.db and CRT.db.whatsNew
end

-- The installed version is now seen (never moved back).
local function markSeen()
    local d = db()
    local installed = CRT.version
    if d and compare(installed, installed) and (compare(installed, d.seen) or 1) > 0 then
        d.seen = installed
    end
end

-- On entering the world: what to show after this update, or nil, recording the version when there is nothing.
function WN.Due()
    local d = db()
    local installed = CRT.version
    if not d or not compare(installed, installed) then
        return nil
    end
    if CRT.freshInstall and d.seen == nil then
        d.seen = installed
        return nil
    end
    if d.seen ~= nil and (compare(installed, d.seen) or 1) <= 0 then
        return nil
    end
    local set = d.show ~= false and WN.Collect(installed, d.seen, CRT.WhatsNewData) or nil
    if not set then
        markSeen()
    end
    return set
end

-- The window ------------------------------------------------------------------------------------------------------

local view = { lines = {}, dots = {} }
WN.view = view
-- pending: the set waiting to open after login; waiting: a try found it blocked, so an event that ends a blocking
-- state tries again (before that, the login delay runs untouched); events: the frame below, listening while pending
local state = { pending = nil, waiting = false, token = 0, encounter = false, loading = false, events = nil }
WN.state = state

local function row(i, c)
    if not view.lines[i] then
        local dot = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        dot:SetText(TEXT.bullet)
        local fs = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        fs:SetJustifyH("LEFT")
        fs:SetWordWrap(true)
        view.dots[i], view.lines[i] = dot, fs
    end
    return view.lines[i], view.dots[i]
end

local function build()
    local win = UI.Window("CRTWhatsNew", {
        kind = "dialog", title = "", width = L.width, height = 160,
        saved = function()
            local d = db()
            return d and d.window
        end,
    })
    local c = win.content
    local more = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    more:SetJustifyH("LEFT")
    UI.Tint(more, "SetTextColor", "muted")
    local check = CreateFrame("CheckButton", nil, c, "UICheckButtonTemplate")
    check:SetSize(L.check, L.check)
    check:SetPoint("BOTTOMLEFT", -2, 0)
    UI:SkinCheckButton(check)
    check:SetScript("OnClick", function(self)
        local d = db()
        if d then
            d.show = self:GetChecked() and true or false
        end
    end)
    local checkText = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    checkText:SetPoint("LEFT", check, "RIGHT", L.checkGap, 0)
    checkText:SetText(TEXT.show)
    -- the label clicks the box too: the box's hit area reaches over it (sized again in fill, as fonts change)
    view.labelHit = function()
        check:SetHitRectInsets(0, -(L.checkGap + math.ceil(checkText:GetStringWidth() or 0)), 0, 0)
    end
    local got = UI.PanelButton(c, TEXT.gotIt, L.button, function()
        win:Hide()
    end)
    got:SetPoint("BOTTOMRIGHT", 0, 0)
    -- closed any way (Got it, X, Escape): this version is seen
    -- (the whole interface hiding, Alt+Z or a cinematic, hides it too while it is still shown: not a close)
    win:HookScript("OnHide", function(self)
        if view.open and not self:IsShown() then
            view.open = false
            markSeen()
        end
    end)
    view.win, view.more, view.check, view.checkText, view.got = win, more, check, checkText, got
end

-- Fills the window with set and sizes it to fit: the lines from the top, the footer at the bottom.
local function fill(set)
    local win, c = view.win, view.win.content
    local D = UI.WINDOW_DEFAULTS
    local width = L.width - 2 * D.inset - L.indent
    win.strip:SetTitle(TEXT.title:format(set.version))
    local y = L.top
    for i, text in ipairs(set.lines) do
        local fs, dot = row(i, c)
        fs:SetWidth(width)
        fs:SetText(text)
        fs:ClearAllPoints()
        fs:SetPoint("TOPLEFT", c, "TOPLEFT", L.indent, -y)
        dot:ClearAllPoints()
        dot:SetPoint("TOPLEFT", c, "TOPLEFT", 0, -y)
        fs:Show()
        dot:Show()
        y = y + (fs:GetStringHeight() or 14) + L.rowGap
    end
    for i = #set.lines + 1, #view.lines do
        view.lines[i]:Hide()
        view.dots[i]:Hide()
    end
    local more = view.more
    if set.more > 0 then
        more:SetWidth(width + L.indent)
        more:SetText(set.more == 1 and TEXT.moreOne or TEXT.more:format(set.more))
        more:ClearAllPoints()
        more:SetPoint("TOPLEFT", c, "TOPLEFT", 0, -(y + L.moreGap - L.rowGap))
        more:Show()
        y = y + L.moreGap - L.rowGap + (more:GetStringHeight() or 14) + L.rowGap
    else
        more:Hide()
    end
    local d = db()
    view.check:SetChecked(not d or d.show ~= false)
    view.labelHit()
    win:SetSize(L.width, math.ceil(D.titleHeight + 4 + y - L.rowGap + L.footerGap + L.button + D.inset))
end

-- Opens the window with set (from WN.Collect).
function WN.Open(set)
    if not view.win then
        build()
    end
    fill(set)
    view.open = true
    -- open now, by hand or after login: nothing waits any more
    state.pending, state.waiting = nil, false
    if state.events then
        state.events:UnregisterAllEvents()
    end
    if not view.win:IsShown() then
        view.win:Show()
    end
    view.win:Raise()
end

-- /crt whatsnew: the installed version's entry, or the newest one, whatever Show after updates says.
function WN:ShowNow()
    local list = sorted(CRT.WhatsNewData)
    local pick = list[1]
    for _, e in ipairs(list) do
        if compare(e.version, CRT.version) == 0 then
            pick = e
        end
    end
    local set = pick and WN.Collect(pick.version, nil, { pick })
    if not set then
        CRT:Print(TEXT.none)
        return
    end
    WN.Open(set)
end

-- When it may open --------------------------------------------------------------------------------------------------

local function encounterOn()
    if state.encounter then
        return true
    end
    local fn = (C_InstanceEncounter and C_InstanceEncounter.IsEncounterInProgress) or IsEncounterInProgress
    if fn then
        local ok, on = pcall(fn)
        return ok and on == true
    end
    return false
end

local function cinematicOn()
    for _, fn in ipairs({ InCinematic or false, IsInCinematicScene or false }) do
        if fn then
            local ok, on = pcall(fn)
            if ok and on == true then
                return true
            end
        end
    end
    for _, f in ipairs({ MovieFrame or false, CinematicFrame or false }) do
        if f and f.IsShown and f:IsShown() then
            return true
        end
    end
    return false
end

local function blocked()
    return (InCombatLockdown and InCombatLockdown()) or encounterOn() or state.loading or cinematicOn()
end

local try

-- Tries again in seconds; a later call replaces an earlier one.
local function schedule(seconds)
    state.token = state.token + 1
    local token = state.token
    C_Timer.After(seconds, function()
        if token == state.token then
            try()
        end
    end)
end

try = function()
    if not state.pending then
        return
    end
    if blocked() then
        state.waiting = true
        schedule(L.poll)
        return
    end
    WN.Open(state.pending)
end

-- the events that end a blocking state: try again shortly after
local RELEASE = { PLAYER_REGEN_ENABLED = true, ENCOUNTER_END = true, LOADING_SCREEN_DISABLED = true, CINEMATIC_STOP = true, STOP_MOVIE = true }

local events = CreateFrame("Frame")
state.events = events
for _, e in ipairs({ "PLAYER_ENTERING_WORLD", "PLAYER_REGEN_ENABLED", "ENCOUNTER_START", "ENCOUNTER_END",
    "LOADING_SCREEN_ENABLED", "LOADING_SCREEN_DISABLED", "CINEMATIC_STOP", "STOP_MOVIE" }) do
    events:RegisterEvent(e)
end
events:SetScript("OnEvent", function(self, event)
    if event == "PLAYER_ENTERING_WORLD" then
        self:UnregisterEvent("PLAYER_ENTERING_WORLD")
        state.pending = WN.Due()
        if state.pending then
            schedule(L.delay)
        else
            self:UnregisterAllEvents() -- nothing to show this session
        end
        return
    end
    if event == "ENCOUNTER_START" then
        state.encounter = true
    elseif event == "ENCOUNTER_END" then
        state.encounter = false
    elseif event == "LOADING_SCREEN_ENABLED" then
        state.loading = true
    elseif event == "LOADING_SCREEN_DISABLED" then
        state.loading = false
    end
    if RELEASE[event] and state.pending and state.waiting then
        schedule(L.retry)
    end
end)
