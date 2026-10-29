local ADDON, CRT = ...

-- Interrupts: the numbers above the adds' nameplates (CRT.InterruptPlates). Started while the anchor is armed (a
-- matching pull, or Test on trash), stopped when it disarms; stopped, no event is registered.
-- A plate is numbered at its first cast start while it is on screen, by Lattice.Number from Anchor:For: only that
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
-- Game calls (warcraft.wiki.gg and Blizzard's 12.1.5 UI source, read 2026-10-28): C_NamePlate.GetNamePlateForUnit(unit)
-- -> the plate frame, NAME_PLATE_UNIT_ADDED and NAME_PLATE_UNIT_REMOVED (unitToken, "nameplateN"),
-- UNIT_SPELLCAST_START (unitTarget; the game's own nameplate cast bars listen to it for nameplate tokens),
-- PLAYER_TARGET_CHANGED, PLAYER_FOCUS_CHANGED, UNIT_TARGET (unitTarget), UnitIsUnit (RequiresComparableUnitTokens,
-- SecretWhenUnitComparisonRestricted), UnitExists, UnitIsPlayer, UnitCanAttack, UnitLevel (-1 for a boss),
-- IsInRaid, GetNumGroupMembers, GetNumSubgroupMembers, STANDARD_TEXT_FONT, ScriptRegion:IsAnchoringRestricted (a SetPoint
-- across frame trees to such a region raises).

local Plates = { boxes = {}, numbers = {}, castListeners = {} }
CRT.InterruptPlates = Plates

local Interrupts = CRT.Interrupts
local Anchor = CRT.InterruptAnchor
local Lattice = CRT.InterruptLattice
local readable = CRT.Comm.Readable
local isSecret = CRT.Comm.IsSecret

local EVENTS = { "NAME_PLATE_UNIT_ADDED", "NAME_PLATE_UNIT_REMOVED", "UNIT_SPELLCAST_START", "PLAYER_TARGET_CHANGED",
    "PLAYER_FOCUS_CHANGED", "UNIT_TARGET" }
local BORDER = 1

local pool = {} -- boxes not in use
local seen = {} -- plates that cast once this time on screen: token -> true
local parked = {} -- unit handle -> the number of the add it pointed at when its plate went
local myNumber -- your kick number in the run, or nil
local frame = CreateFrame("Frame")

local function settings()
    return Interrupts:Settings().plates
end

function Plates:OnCast(fn)
    self.castListeners[#self.castListeners + 1] = fn
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

local unplaced = {} -- numbered plates whose frame read nil: token -> true, drawn again on the next plate event
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
    local mine = myNumber ~= nil and n == myNumber
    Plates.Style(f, n, mine)
    local plate = ask(C_NamePlate and C_NamePlate.GetNamePlateForUnit, unit)
    local placed = plate ~= nil and Plates.Attach(f, plate)
    f:SetShown(placed and settings().on and (mine or settings().all) and true or false)
    unplaced[unit] = (not placed) or nil
    if not placed and not retrySet and C_Timer then
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
    myNumber = Anchor.encounterID and (Interrupts:Mine(Anchor.encounterID)) or nil
    for unit in pairs(self.boxes) do
        draw(unit)
    end
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
        n = at and Lattice.Number(Anchor.def, at, t) or nil
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

function Plates.HandleEvent(event, unit)
    if not Anchor.armed then
        return
    end
    if event == "UNIT_SPELLCAST_START" then
        onCast(unit)
    elseif event == "NAME_PLATE_UNIT_ADDED" then
        if isPlate(unit) then
            onAdded(unit)
        end
        if next(unplaced) then
            retry()
        end
    elseif event == "NAME_PLATE_UNIT_REMOVED" then
        if isPlate(unit) then
            onRemoved(unit)
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

frame:SetScript("OnEvent", function(_, event, unit)
    Plates.HandleEvent(event, unit)
end)

function Plates:Start()
    for _, e in ipairs(EVENTS) do
        frame:RegisterEvent(e)
    end
    self:Refresh()
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
    local id = Anchor.encounterID
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
