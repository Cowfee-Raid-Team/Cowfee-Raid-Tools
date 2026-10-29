local ADDON, CRT = ...

-- Interrupts: the numbers above the adds' nameplates (CRT.InterruptPlates). Started while the anchor is armed (a
-- matching pull, or Test on trash), stopped when it disarms; stopped, no event is registered. Two ways to number:
--
-- An untimed setup (no timing) numbers by raid marker: a plate whose marker (GetRaidTargetIndex on its token) is a
-- group's marker shows that group's kick number. It shows 1 until the add's first cast; the first cast keeps 1, and
-- each cast start after it moves it on by one, 1 again after the group's last slot. So the number is the kicker of the
-- cast in progress, and it stays until the next cast starts. Only casts of the setup's spell count, when the cast can
-- be read: its spell ID (the event's) against the setup's spell ID, else its name (UnitCastingInfo) against the
-- setup's spell name; when what would be compared is secret or missing, or the setup names no spell, every cast start
-- on the marked plate counts. The count is the group's (its marked add's), not the plate's, so a plate that leaves the
-- screen and comes back, or a new add given the marker, carries on the rotation. The markers are read again on each
-- plate added and on RAID_TARGET_UPDATE (every plate token on screen). A marker that is secret, can't be read or is no
-- group's shows nothing, never a wrong number. OnTurn listeners hear each group's new number (the reminder).
--
-- A timed setup numbers a plate at its first cast start while it is on screen, by Lattice.Number from Anchor:For: only that
-- moment is read, since the add's name, GUID and spells are secret in a raid fight. A plate that cast once keeps
-- what it got (a number, or none); a re-cast is ignored. A plate is a candidate when the unit exists, is not a
-- player, can be attacked and has a level of 0 or more (a boss reads -1); a secret answer counts as no.
--
-- A plate that leaves the screen loses its token, and its GUID can't be read to know it again. So when a numbered
-- plate is removed, its number is parked on every unit handle still pointing at it (target, focus, each raid or
-- party member's target), and a plate that comes back takes the number of the first handle that points at it. A
-- handle whose owner retargets is cleared. UnitIsUnit can raise or return a secret in combat, so it is in pcall
-- and only a plain true counts.
--
-- Each box is a fixed square (plates.size) anchored above the plate frame from C_NamePlate.GetNamePlateForUnit
-- (plates.offset up), on UIParent so it never scales with the plate (a plate that refuses anchors from another frame
-- tree takes it as its child instead: Plates.Attach), the number in the game's font at plates.font, outlined. Your own
-- pair is drawn in your colours (plates.mineBox, mineText), the others in plates.box and text, shown only with Show
-- every number (plates.all). Boxes come from one pool, so a long fight makes no new frames after the first wave.
--
-- Game calls (warcraft.wiki.gg and Blizzard's 12.1.5 UI source, read 2026-10-28): UnitCastingInfo(unit) -> name first
-- (SecretWhenUnitSpellCastRestricted; read 2026-10-29), GetRaidTargetIndex(unit) -> 1 to 8
-- or nil (SecretReturns; arbitrary for a unit that doesn't exist, so UnitExists first; read 2026-10-29), RAID_TARGET_UPDATE
-- (no payload: a marker set or cleared), C_NamePlate.GetNamePlateForUnit(unit)
-- -> the plate frame, NAME_PLATE_UNIT_ADDED and NAME_PLATE_UNIT_REMOVED (unitToken, "nameplateN"),
-- UNIT_SPELLCAST_START (unitTarget; the game's own nameplate cast bars listen to it for nameplate tokens),
-- PLAYER_TARGET_CHANGED, PLAYER_FOCUS_CHANGED, UNIT_TARGET (unitTarget), UnitIsUnit (RequiresComparableUnitTokens,
-- SecretWhenUnitComparisonRestricted), UnitExists, UnitIsPlayer, UnitCanAttack, UnitLevel (-1 for a boss),
-- IsInRaid, GetNumGroupMembers, GetNumSubgroupMembers, STANDARD_TEXT_FONT, ScriptRegion:IsAnchoringRestricted (a SetPoint
-- across frame trees to such a region raises).

local Plates = { boxes = {}, numbers = {}, castListeners = {}, turnListeners = {}, rawListeners = {} }
CRT.InterruptPlates = Plates

local Interrupts = CRT.Interrupts
local Anchor = CRT.InterruptAnchor
local Lattice = CRT.InterruptLattice
local Setup = CRT.InterruptSetup
local readable = CRT.Comm.Readable
local isSecret = CRT.Comm.IsSecret

local EVENTS = { "NAME_PLATE_UNIT_ADDED", "NAME_PLATE_UNIT_REMOVED", "UNIT_SPELLCAST_START", "PLAYER_TARGET_CHANGED",
    "PLAYER_FOCUS_CHANGED", "UNIT_TARGET", "RAID_TARGET_UPDATE" }
local MAX_PLATES = 40 -- nameplate1 to nameplate40, looked over for markers
local BORDER = 1

local pool = {} -- boxes not in use
local seen = {} -- plates that cast once this time on screen: token -> true
local parked = {} -- unit handle -> the number of the add it pointed at when its plate went
local myNumber, myGroup -- your kick number and group (its index) in the run, or nil
local turns = {} -- an untimed setup's groups: index -> { n = the number on its add, started = its first cast seen }
local groupOf = {} -- an untimed setup's numbered plates: token -> the group's index
local frame = CreateFrame("Frame")

local function settings()
    return Interrupts:Settings().plates
end

-- fn(unit, castTime, anchor, number, why, group) at a candidate plate's cast: the first for a timed setup, each for
-- an untimed one (group is the group's index then, why set when there is no number).
function Plates:OnCast(fn)
    self.castListeners[#self.castListeners + 1] = fn
end

-- fn(group, number) when an untimed setup's group moves to its next number (the reminder).
function Plates:OnTurn(fn)
    self.turnListeners[#self.turnListeners + 1] = fn
end

-- fn(unit, ...) at every UNIT_SPELLCAST_START while armed, before anything is read: the event's own arguments, any
-- of them maybe secret (the kick probe checks which).
function Plates:OnRawCast(fn)
    self.rawListeners[#self.rawListeners + 1] = fn
end

local function untimed()
    return Anchor.def ~= nil and Anchor.def.timing == nil
end

local function isPlate(unit)
    return readable(unit) and type(unit) == "string" and unit:match("^nameplate%d+$") ~= nil
end

-- A game call's answer, or nil when it raises or the answer is secret.
local function ask(fn, ...)
    if type(fn) ~= "function" then
        return nil
    end
    local ok, v = pcall(fn, ...)
    if ok and readable(v) then
        return v
    end
    return nil
end

function Plates.SameUnit(a, b)
    return ask(UnitIsUnit, a, b) == true
end

-- An add: exists, not a player, can be attacked, level 0 or more. Any secret answer is a no.
function Plates.Candidate(unit)
    if ask(UnitExists, unit) ~= true or ask(UnitCanAttack, "player", unit) ~= true then
        return false
    end
    -- not a player: a plain false or nil, never a secret or an error
    local ok, player = pcall(UnitIsPlayer, unit)
    if not ok or isSecret(player) or player then
        return false
    end
    local level = ask(UnitLevel, unit)
    return type(level) == "number" and level >= 0
end

-- target, focus, then each group member's target: one list, filled again each time, from tokens made once.
local RAID_TARGETS, PARTY_TARGETS = {}, {}
for i = 1, 40 do
    RAID_TARGETS[i] = "raid" .. i .. "target"
end
for i = 1, 4 do
    PARTY_TARGETS[i] = "party" .. i .. "target"
end
local handleList = {}
local function handles()
    wipe(handleList)
    handleList[1], handleList[2] = "target", "focus"
    local tokens, n = PARTY_TARGETS, GetNumSubgroupMembers and GetNumSubgroupMembers() or 0
    if IsInRaid() then
        tokens, n = RAID_TARGETS, GetNumGroupMembers()
    end
    for i = 1, math.min(n, #tokens) do
        handleList[#handleList + 1] = tokens[i]
    end
    return handleList
end

-- Boxes -----------------------------------------------------------------------------------------------------------

local function edge(f, a, b, horizontal)
    local t = f:CreateTexture(nil, "BORDER")
    t:SetPoint(a)
    t:SetPoint(b)
    if horizontal then
        t:SetHeight(BORDER)
    else
        t:SetWidth(BORDER)
    end
    t:SetColorTexture(0, 0, 0, 1) -- the outline: not a theme colour
    return t
end

local function newBox()
    local f = CreateFrame("Frame", nil, UIParent)
    f.bg = f:CreateTexture(nil, "BACKGROUND")
    f.bg:SetAllPoints()
    f.edges = { edge(f, "TOPLEFT", "TOPRIGHT", true), edge(f, "BOTTOMLEFT", "BOTTOMRIGHT", true),
        edge(f, "TOPLEFT", "BOTTOMLEFT"), edge(f, "TOPRIGHT", "BOTTOMRIGHT") }
    f.text = f:CreateFontString(nil, "OVERLAY")
    f.text:SetPoint("CENTER")
    f:EnableMouse(false)
    f:Hide()
    return f
end
Plates.NewBox = newBox

-- Paints a box for number n: size, number, colours. anchor is the plate frame, or nil for a box placed elsewhere.
function Plates.Style(f, n, mine)
    local s = settings()
    f:SetSize(s.size, s.size)
    f.text:SetFont(STANDARD_TEXT_FONT, s.font, "OUTLINE")
    f.text:SetText(tostring(n))
    local box, text = mine and s.mineBox or s.box, mine and s.mineText or s.text
    f.bg:SetColorTexture(box[1], box[2], box[3], box[4] or 1)
    f.text:SetTextColor(text[1], text[2], text[3], text[4] or 1)
end

local unplaced = {} -- numbered plates not drawn yet: token -> failed tries, drawn again on the next plate event
Plates.MAX_RETRIES = 10 -- tries after the first before a box that won't attach is left (until the next Refresh)
local retrySet = false
local RETRY = 0.2 -- seconds before a box whose plate frame read nil is tried again
local retry

local function draw(unit)
    local n = Plates.numbers[unit]
    local f = Plates.boxes[unit]
    if not n then
        return
    end
    if not f then
        f = table.remove(pool) or newBox()
        Plates.boxes[unit] = f
    end
    local mine = myNumber ~= nil and n == myNumber and (groupOf[unit] == nil or groupOf[unit] == myGroup)
    Plates.Style(f, n, mine)
    local plate = ask(C_NamePlate and C_NamePlate.GetNamePlateForUnit, unit)
    local placed = plate ~= nil and Plates.Attach(f, plate)
    f:SetShown(placed and settings().on and (mine or settings().all) and true or false)
    if placed then
        unplaced[unit] = nil
        return
    end
    local tries = (unplaced[unit] or 0) + 1
    if tries > Plates.MAX_RETRIES then
        unplaced[unit] = nil -- given up: it never attaches
        return
    end
    unplaced[unit] = tries
    if not retrySet and C_Timer then
        retrySet = true
        C_Timer.After(RETRY, retry)
    end
end

-- The boxes whose plate frame wasn't there yet, tried again.
retry = function()
    retrySet = false
    if not Anchor.armed then
        return
    end
    for unit in pairs(unplaced) do
        if Plates.numbers[unit] then
            draw(unit)
        else
            unplaced[unit] = nil
        end
    end
end

-- Puts a box above a plate frame. A box lives on UIParent, so the plate's scale never reaches it; a plate that
-- refuses anchors from another frame tree (ScriptRegion:IsAnchoringRestricted: SetPoint across trees then raises)
-- takes the box as its child instead, where it scales with the plate. False when neither works.
function Plates.Attach(f, plate)
    local offset = settings().offset
    local restricted = false
    if plate.IsAnchoringRestricted then
        local ok, r = pcall(plate.IsAnchoringRestricted, plate)
        restricted = not ok or isSecret(r) or r == true
    end
    local parent = restricted and plate or UIParent
    if f:GetParent() ~= parent and not pcall(f.SetParent, f, parent) then
        return false
    end
    f:ClearAllPoints()
    return pcall(f.SetPoint, f, "BOTTOM", plate, "TOP", 0, offset) and true or false
end

local function release(unit)
    local f = Plates.boxes[unit]
    if f then
        f:Hide()
        f:ClearAllPoints()
        Plates.boxes[unit] = nil
        unplaced[unit] = nil
        pool[#pool + 1] = f
    end
end

function Plates:NumberOf(unit)
    return self.numbers[unit]
end

function Plates:Refresh()
    myNumber, myGroup = nil, nil
    if Anchor.key then
        local n, _, g = Interrupts:Mine(Anchor.key)
        myNumber, myGroup = n, g
    end
    for unit in pairs(self.boxes) do
        draw(unit)
    end
end

-- Raid markers (an untimed setup) ----------------------------------------------------------------------------------

-- The group (index) whose marker a plate has, or nil: the marker read through pcall and the secret check.
function Plates.GroupOf(unit)
    if ask(UnitExists, unit) ~= true then
        return nil
    end
    local marker = ask(GetRaidTargetIndex, unit)
    if type(marker) ~= "number" then
        return nil
    end
    return (Setup.GroupOfMarker(Anchor.def, marker))
end

local function turnOf(g)
    return turns[g] and turns[g].n or 1
end

local function clearPlate(unit)
    Plates.numbers[unit], groupOf[unit] = nil, nil
    release(unit)
end

-- A plate shows its marker's group's number, or nothing.
local function markShow(unit)
    local g = Plates.GroupOf(unit)
    if not g then
        if Plates.numbers[unit] then
            clearPlate(unit)
        end
        return nil
    end
    Plates.numbers[unit], groupOf[unit] = turnOf(g), g
    draw(unit)
    return g
end

local PLATE_TOKENS = {}
for i = 1, MAX_PLATES do
    PLATE_TOKENS[i] = "nameplate" .. i
end

-- Every plate on screen, its marker read again (a marker set or cleared, the run starting).
local function rescan()
    for _, unit in ipairs(PLATE_TOKENS) do
        if ask(UnitExists, unit) == true then
            markShow(unit)
        elseif Plates.numbers[unit] then
            clearPlate(unit)
        end
    end
end

-- Whether a cast is of the setup's spell: compared only when readable; anything secret or missing counts.
function Plates.SameSpell(def, unit, spellID)
    local want = def and def.spell
    if not (want and (want.spellID or want.name)) then
        return true
    end
    if want.spellID and readable(spellID) and type(spellID) == "number" then
        return spellID == want.spellID
    end
    if want.name then
        local ok, name = pcall(UnitCastingInfo, unit)
        if ok and readable(name) and type(name) == "string" and name ~= "" then
            return name:lower() == want.name:lower()
        end
    end
    return true
end

local function onMarkedCast(unit, spellID)
    local t = GetTime()
    if not Plates.Candidate(unit) then
        for _, fn in ipairs(Plates.castListeners) do
            pcall(fn, unit, t, nil, nil, "not an add")
        end
        return
    end
    local g = Plates.GroupOf(unit)
    if not g then
        if Plates.numbers[unit] then
            clearPlate(unit)
        end
        for _, fn in ipairs(Plates.castListeners) do
            pcall(fn, unit, t, nil, nil, "no group's marker")
        end
        return
    end
    if not Plates.SameSpell(Anchor.def, unit, spellID) then
        for _, fn in ipairs(Plates.castListeners) do
            pcall(fn, unit, t, nil, nil, "another spell")
        end
        return
    end
    local turn = turns[g] or { n = 1 }
    turns[g] = turn
    if turn.started then
        turn.n = turn.n % Anchor.def.groups[g].slots + 1
    end
    turn.started = true
    -- the group's number moves on every plate showing it (one add has the marker, but a stale plate may still read it)
    for other, og in pairs(groupOf) do
        if og == g and other ~= unit then
            Plates.numbers[other] = turn.n
            draw(other)
        end
    end
    Plates.numbers[unit], groupOf[unit] = turn.n, g
    draw(unit)
    for _, fn in ipairs(Plates.castListeners) do
        pcall(fn, unit, t, nil, turn.n, nil, g)
    end
    for _, fn in ipairs(Plates.turnListeners) do
        pcall(fn, g, turn.n)
    end
end

-- The number a group's add shows now (an untimed setup), for the tests and the probe.
function Plates:TurnOf(g)
    return turnOf(g)
end

-- Events ----------------------------------------------------------------------------------------------------------

local function onCast(unit)
    if not isPlate(unit) or seen[unit] then
        return
    end
    seen[unit] = true
    local t = GetTime()
    if not Plates.Candidate(unit) then
        for _, fn in ipairs(Plates.castListeners) do
            pcall(fn, unit, t, nil, nil, "not an add")
        end
        return
    end
    local at, n
    if Anchor.mode == "test" then
        n, at = Anchor:TestNumber(t) -- trash: by cast order
    else
        at = Anchor:For(t) -- a pull: by when the first cast lands on the boss's lattice
        n = at and Lattice.Number(Anchor.def.timing, at, t) or nil
    end
    for _, fn in ipairs(Plates.castListeners) do
        pcall(fn, unit, t, at, n)
    end
    if n then
        Plates.numbers[unit] = n
        draw(unit)
    end
end

local function onRemoved(unit)
    local n = Plates.numbers[unit]
    if n then
        for _, h in ipairs(handles()) do
            if Plates.SameUnit(h, unit) then
                parked[h] = n
            end
        end
    end
    Plates.numbers[unit], seen[unit] = nil, nil
    release(unit)
end

local function onAdded(unit)
    Plates.numbers[unit], seen[unit] = nil, nil
    release(unit)
    for _, h in ipairs(handles()) do
        local n = parked[h]
        if n and Plates.SameUnit(h, unit) then
            parked[h] = nil
            Plates.numbers[unit], seen[unit] = n, true
            draw(unit)
            return
        end
    end
end

function Plates.HandleEvent(event, unit, ...)
    if not Anchor.armed then
        return
    end
    if event == "UNIT_SPELLCAST_START" then
        for _, fn in ipairs(Plates.rawListeners) do
            pcall(fn, unit, ...)
        end
        if untimed() then
            if isPlate(unit) then
                local _, spellID = ...
                onMarkedCast(unit, spellID)
            end
        else
            onCast(unit)
        end
    elseif event == "RAID_TARGET_UPDATE" then
        if untimed() then
            rescan()
        end
    elseif event == "NAME_PLATE_UNIT_ADDED" then
        if isPlate(unit) then
            if untimed() then
                clearPlate(unit)
                markShow(unit)
            else
                onAdded(unit)
            end
        end
        if next(unplaced) then
            retry()
        end
    elseif event == "NAME_PLATE_UNIT_REMOVED" then
        if isPlate(unit) then
            if untimed() then
                clearPlate(unit)
            else
                onRemoved(unit)
            end
        end
    elseif event == "PLAYER_TARGET_CHANGED" then
        parked.target = nil
    elseif event == "PLAYER_FOCUS_CHANGED" then
        parked.focus = nil
    elseif event == "UNIT_TARGET" then
        if readable(unit) and type(unit) == "string" then
            parked[unit .. "target"] = nil
        end
    end
end

frame:SetScript("OnEvent", function(_, event, ...)
    Plates.HandleEvent(event, ...)
end)

function Plates:Start()
    for _, e in ipairs(EVENTS) do
        frame:RegisterEvent(e)
    end
    self:Refresh()
    if untimed() then
        rescan()
    end
end

function Plates:Stop()
    for _, e in ipairs(EVENTS) do
        frame:UnregisterEvent(e)
    end
    for unit in pairs(self.boxes) do
        release(unit)
    end
    wipe(self.numbers)
    wipe(seen)
    wipe(parked)
    wipe(unplaced)
    wipe(turns)
    wipe(groupOf)
end

Anchor:OnArm(function(on)
    Plates:Stop()
    if on then
        Plates:Start()
    end
end)

Interrupts:OnChange(function(what)
    if Anchor.armed and (what == "list" or what == "settings") then
        Plates:Refresh()
    end
    -- the Previews sample follows the Settings tab live
    if Plates.preview and Plates.preview:IsShown() then
        Plates:Preview(true)
    end
end)

-- Previews: one sample box of your number at the screen's centre, to see the size and colours.
function Plates:Preview(on)
    local id = Anchor.key
    if not id then
        local first = Interrupts:Bosses()[1]
        id = first and first.key
    end
    if not self.preview then
        self.preview = newBox()
    end
    local f = self.preview
    if not (on and Interrupts:Enabled() and id) then
        f:Hide()
        return
    end
    local n = Interrupts:Mine(id)
    self.Style(f, n or 1, true)
    f:ClearAllPoints()
    f:SetPoint("BOTTOM", UIParent, "CENTER", 0, settings().offset)
    f:Show()
end

if CRT.UI and CRT.UI.RegisterPreview then
    CRT.UI:RegisterPreview("interrupts-box", function(on)
        Plates:Preview(on)
    end)
end
