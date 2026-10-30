local ADDON, CRT = ...

-- The alert settings' subtabs: one strip for the Mech Alerts panel (Notes/Reminders.lua), its Special panel
-- (Notes/SpecialAlerts.lua) and the pop-out alert editor (Alerts/Editor.lua), so all show the same tabs, in the same
-- order, with the same dots. Under the host's header:
--   When              Show from, Linger and the alert's times (Special: the When line, Duration)
--   Who               the special alert's roles or rotation, the Special panel only
--   Looks             Show as, Text, Icon, Color, and the bar's rows
--   Sound and speech  Sound, Also when it lands on me, Speak the text, Speak at, Count down 3 2 1, Glow at 0
--   Shield bar        the Shield bar section (Alerts/ShieldSection.lua)
--   Assign            the mechanic's assignment blocks in the raid note (Notes/AssignTab.lua), the Mech Alerts panel only
--   Markers           the special alert's marks and Mark the players, the Special panel only
-- The strip is laid out from SubTabs.LIST, in order: a new tab is one more entry there (key, label, width, and on for
-- its dot), and every host gets it. Each tab has a frame over the whole host frame; the host builds that tab's
-- controls into it, at the host's own coordinates, so only the open tab's controls show. A tab's label carries a
-- small dot while something on it is on (its entry's on(draft)). The buttons are the pages' tab buttons
-- (UI:RegisterTab, UI:SetTabSelected), so they follow the look. The tab picked last stays for the session, per host
-- (opts.owner); it is never saved.

local UI = CRT.UI

local SubTabs = {}
CRT.AlertSubTabs = SubTabs

-- Every word of the strip, in one place. Keep the keys, change the text in quotes, save, /reload.
local TEXT = {
    when = "When",
    who = "Who",
    looks = "Looks",
    sound = "Sound and speech",
    shield = "Shield bar",
    assign = "Assign",
    markers = "Markers",
}
SubTabs.TEXT = TEXT

local L = {
    H = 24, -- a tab's height
    GAP = 4, -- between two tabs
    PAD = 10, -- each side of a label: a tab is never narrower than its label and this
    DOT = 6, DOT_GAP = 4, -- the dot after a label
}
SubTabs.L = L

local BACKDROP = { bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 }

local function Draft()
    return CRT.AlertDraft
end

-- Whether the draft shows anywhere: a Show as box ticked.
local function anyShown(d)
    for _, k in ipairs(Draft().SHOW_KEYS) do
        if d.show and d.show[k] then
            return true
        end
    end
    return false
end

-- Whether the draft makes a sound or says anything: a sound picked, Also when it lands on me, Speak the text, Count
-- down 3 2 1 or Glow at 0.
local function anySound(d)
    return (d.sound ~= nil and d.sound ~= Draft().NO_SOUND) or d.auraSound or d.speak or d.count or d.glow or false
end

-- The tabs, in order. width: the approved mock-up's, widened for a label that needs more; widthBy (optional): a host's
-- own width, by owner (the Special panel's six tabs are narrower, to fit its 724 px). on(draft): its dot; When has none
-- (Show from always has a value). The Special panel paints with its alert's choices in a draft's shape
-- (Notes/SpecialAlerts.lua's TabState), with whoPicks and marked for its own two tabs. hosts (optional): the hosts that
-- get the tab, by owner, such as { mechanics = true } for a tab only the Mech Alerts panel has room for (the editor's
-- strip is 600 px); none: every host.
local SPECIAL_W = 108
SubTabs.LIST = {
    { key = "when", label = TEXT.when, width = 118, widthBy = { special = SPECIAL_W } },
    -- its dot: a rotation, a roles list or the raid note's line picks players (not Everyone)
    { key = "who", label = TEXT.who, width = SPECIAL_W, hosts = { special = true },
        on = function(d) return d.whoPicks == true end },
    { key = "looks", label = TEXT.looks, width = 118, widthBy = { special = SPECIAL_W }, on = anyShown },
    { key = "sound", label = TEXT.sound, width = 150, on = anySound },
    { key = "shield", label = TEXT.shield, width = 118, widthBy = { special = SPECIAL_W },
        on = function(d) return Draft().Absorb(d) ~= nil end },
    -- its dot: the mechanic has an assignment with players in the raid note
    { key = "assign", label = TEXT.assign, width = 118, hosts = { mechanics = true },
        on = function() return CRT.NoteAssignTab ~= nil and CRT.NoteAssignTab.HasNames() end },
    -- its dot: the alert has marks and Mark the players is on
    { key = "markers", label = TEXT.markers, width = SPECIAL_W, hosts = { special = true },
        on = function(d) return d.marked == true end },
}

-- The tab each host picked last, for the session: [owner] = key.
local picked = {}

local function textWidth(fs)
    local w = fs.GetUnboundedStringWidth and fs:GetUnboundedStringWidth() or fs:GetStringWidth()
    return math.ceil(tonumber(w) or 0)
end

local Strip = {}
Strip.__index = Strip

-- Builds the strip into parent. opts:
--   owner  the host's name ("mechanics", "special", "editor"): the session keeps the tab it picked last
--   x, y   the first tab's top left in parent
--   rule   { y, left, right }: a line under the tabs, from left to parent's width - right (optional)
--   maxW   the room for the tabs: past it, they narrow to their labels (optional)
--   list   the tabs (default SubTabs.LIST)
--   onPick function(key) after a click changed the tab (optional)
-- Returns the strip: keys (in order), buttons[key], frames[key] (each over the whole parent), rule, and Select, Current,
-- Paint and Layout.
function SubTabs.Build(parent, o)
    local s = setmetatable({ keys = {}, buttons = {}, frames = {}, entries = {}, opts = o }, Strip)
    for _, entry in ipairs(o.list or SubTabs.LIST) do
        if not entry.hosts or entry.hosts[o.owner] then
            SubTabs.AddTab(s, parent, entry)
        end
    end
    if o.rule then
        s.rule = parent:CreateTexture(nil, "ARTWORK")
        s.rule:SetHeight(1)
        s.rule:SetPoint("TOPLEFT", o.rule.left, o.rule.y)
        s.rule:SetPoint("TOPRIGHT", -o.rule.right, o.rule.y)
        UI.Tint(s.rule, "SetColorTexture", "border", 1)
    end
    s:Layout()
    s:Select(picked[o.owner])
    return s
end

-- One tab of the strip: its button (label, dot) and its frame over the whole parent.
function SubTabs.AddTab(s, parent, entry)
    local o = s.opts
    local key = entry.key
    s.keys[#s.keys + 1] = key
    s.entries[key] = entry
    local b = CreateFrame("Button", nil, parent, "BackdropTemplate")
    if b.SetBackdrop then
        b:SetBackdrop(BACKDROP)
    end
    b.sel = b:CreateTexture(nil, "ARTWORK")
    b.sel:SetAllPoints()
    b.text = b:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    b.text:SetPoint("CENTER")
    b.text:SetText(entry.label)
    b.key = key
    b.dot = b:CreateTexture(nil, "OVERLAY")
    b.dot:SetSize(L.DOT, L.DOT)
    b.dot:SetPoint("LEFT", b.text, "RIGHT", L.DOT_GAP, 0)
    UI.Tint(b.dot, "SetColorTexture", "accent", 1)
    if b.dot.SetMask then
        b.dot:SetMask("Interface\\CharacterFrame\\TempPortraitAlphaMask") -- round, as the Mech Alerts list's dots
    end
    b.dot:Hide()
    b:SetScript("OnClick", function()
        local changed = s.current ~= key
        s:Select(key)
        if changed and o.onPick then
            o.onPick(key)
        end
    end)
    UI:RegisterTab(b)
    s.buttons[key] = b
    local f = CreateFrame("Frame", nil, parent)
    f:SetPoint("TOPLEFT", parent, "TOPLEFT", 0, 0)
    f:SetPoint("BOTTOMRIGHT", parent, "BOTTOMRIGHT", 0, 0)
    f:Hide()
    s.frames[key] = f
end

-- Each tab's width: its entry's (the host's own, widthBy[owner], when it has one), or its label (and dot) and padding
-- when wider. With opts.maxW and the tabs past it (a large text size), the tabs wider than their label give the room
-- back, each in proportion to what it has spare, never under its label. When the labels alone don't fit maxW, the
-- strip still runs past it: a label is never cut. The Special panel's six fit 724 at the largest text size offered
-- (run_mechalerts.js checks it); a host adding tabs must check that again.
local function widths(s)
    local owner, out, need, spare = s.opts.owner, {}, {}, 0
    local total = (#s.keys - 1) * L.GAP
    for i, key in ipairs(s.keys) do
        local b, entry = s.buttons[key], s.entries[key]
        need[i] = textWidth(b.text) + 2 * L.PAD + (entry.on and (L.DOT_GAP + L.DOT) or 0)
        out[i] = math.max((entry.widthBy and entry.widthBy[owner]) or entry.width or 0, need[i])
        total = total + out[i]
        spare = spare + out[i] - need[i]
    end
    local over = s.opts.maxW and total - s.opts.maxW or 0
    if over > 0 and spare > 0 then
        local share = math.min(1, over / spare)
        for i = 1, #out do
            out[i] = math.max(need[i], out[i] - math.ceil((out[i] - need[i]) * share))
        end
    end
    return out
end

-- Sizes and places the tabs from x, y (widths above). Measured on every call, so a changed text size is followed.
function Strip:Layout()
    local x = self.opts.x
    local w = widths(self)
    for i, key in ipairs(self.keys) do
        local b = self.buttons[key]
        b:SetSize(w[i], L.H)
        b:ClearAllPoints()
        b:SetPoint("TOPLEFT", x, self.opts.y)
        b.w = w[i]
        x = x + w[i] + L.GAP
    end
    return x - L.GAP - self.opts.x
end

-- Opens a tab (an unknown key: the first): its frame shows, the others hide, and the session remembers it. The
-- buttons are restyled only when the tab changes (UI:SetTabSelected also skins the parent).
function Strip:Select(key)
    if not self.entries[key] then
        key = self.keys[1]
    end
    picked[self.opts.owner] = key
    if self.current == key then
        return key
    end
    self.current = key
    for _, k in ipairs(self.keys) do
        self.frames[k]:SetShown(k == key)
    end
    for _, k in ipairs(self.keys) do
        UI:SetTabSelected(self.buttons[k], k == key)
    end
    return key
end

function Strip:Current()
    return self.current
end

-- Each tab's dot from the draft (nil: no dots), and the tabs sized again.
function Strip:Paint(draft)
    for _, key in ipairs(self.keys) do
        local on = self.entries[key].on
        self.buttons[key].dot:SetShown(draft ~= nil and on ~= nil and on(draft) and true or false)
    end
    self:Layout()
end

-- The tab a host picked last this session (tests, and a host built again).
function SubTabs.Picked(owner)
    return picked[owner]
end
