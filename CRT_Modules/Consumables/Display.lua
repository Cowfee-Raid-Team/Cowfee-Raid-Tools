local ADDON, CRT = ...

-- The row of consumable icons shown on a ready check. A missing or expiring consumable
-- gets marching ants around its icon. Food, flask, weapon and rune icons are clickable and use the
-- first listed item in your bags. The potion icon only shows a count and is never used from the row. The icons are drawn by Consumables/Bar.lua, shared with the
-- bar on the Consumables tab.
--
-- Every icon is a secure button, so the icon order can change without making new frames. That
-- makes the buttons and their parent frame protected: in combat the row cannot be shown,
-- hidden or moved and a click action cannot change, so those wait for PLAYER_REGEN_ENABLED.
-- The row is built at login, out of combat, because secure buttons should be created there.
--
-- While the game's ready check window is up the row docks under it, so the two read as one panel, and
-- it goes away when that window does. The window is ReadyCheckListenerFrame, the part with Ready and
-- Not Ready, inside ReadyCheckFrame (Blizzard_FrameXML/Mainline/ReadyCheck.xml). The game hides it for
-- the player who started the check, so that player's row sits at its own saved place. The row is never
-- anchored or parented to the game's window: the row holds secure buttons, and anchoring a protected
-- frame to another frame makes that frame implicitly protected. Instead, out of combat, the row reads
-- where the window is and anchors to UIParent at that spot, again each refresh so it follows. The
-- window's OnHide is post-hooked, never replaced. Close shows only for the raid leader.

local Consumables = CRT.Consumables
local Ants = CRT.Ants
local Bar = CRT.ConsumablesBar
local Display = {}
CRT.ConsumablesDisplay = Display

local REFRESH_SECONDS = 0.5
local PREVIEW_SECONDS = 20
local DOCK_GAP = 4 -- pixels between the game's ready check window and the docked row

local frame, handle, closeBar
local slots = {}
local place
local shownUntil -- time at which a ready check or preview row hides by itself, nil for no limit
local sawGameWindow -- true once the game's ready check window has been seen on screen
local elapsed = 0
local pendingHide -- a hide that was blocked by combat

-- The game's ready check window when it is on screen, else nil. IsVisible is false while
-- ReadyCheckFrame, its parent, is hidden, and for the player who started the check.
local function gameWindow()
    local window = _G.ReadyCheckListenerFrame
    if window and window.IsVisible and window:IsVisible() then
        return window
    end
end

-- Its saved place, drag, nudge and reset are the shared helper's (UI/Placement.lua), held by its top. It holds
-- secure buttons, so it is never anchored to another element and nothing is anchored to it (either would make
-- another frame protected); place() below docks it or puts it at its saved place.
local placement = CRT.UI.Placement.Define("consumables", {
    title = "Consumables bar",
    store = function()
        return Consumables:PositionStore()
    end,
    default = { point = "TOP", relativePoint = "TOP", x = 0, y = -200 },
    point = "TOP",
    canAnchor = false,
    target = false,
    protected = true,
    place = function()
        place()
    end,
})

-- Whether you lead the group, read when the group or its leader changes and when the row shows,
-- rather than on every refresh. A value the game hides is never compared, and counts as not leading.
local leading = false
local function readLeader()
    local ok, leader = pcall(UnitIsGroupLeader, "player")
    if not ok or (issecretvalue and issecretvalue(leader)) then
        leading = false
    else
        leading = leader and true or false
    end
end

-- Where the bottom middle of the game's window is, in the row's own units, or nil when the game
-- gives no usable position. Positions are in each frame's effective scale, so they are converted.
local function windowBottom(window)
    local okC, cx = pcall(window.GetCenter, window)
    local okB, bottom = pcall(window.GetBottom, window)
    local okS, scale = pcall(window.GetEffectiveScale, window)
    if not (okC and okB and okS) or type(cx) ~= "number" or type(bottom) ~= "number" or type(scale) ~= "number" then
        return nil
    end
    if issecretvalue and (issecretvalue(cx) or issecretvalue(bottom) or issecretvalue(scale)) then
        return nil
    end
    local own = frame:GetEffectiveScale()
    if type(own) ~= "number" or own <= 0 then
        return nil
    end
    local ratio = scale / own
    return cx * ratio, bottom * ratio
end

local function showTooltip(self)
    local def = Consumables:Def(self.key)
    CRT.UI.TooltipOwner(GameTooltip, self, "ANCHOR_TOP")
    if self.useItem then
        GameTooltip:SetText(self.useItem.name, 1, 1, 1)
        GameTooltip:AddLine("Click to use (" .. self.useItem.count .. " in your bags)", 0.6, 0.9, 0.6)
        if self.key == "weapon" then
            GameTooltip:AddLine("Shift-click for the off hand", 0.7, 0.7, 0.7)
        end
    else
        GameTooltip:SetText(def and def.label or "", 1, 1, 1)
        if def and def.clickable then
            GameTooltip:AddLine("None of the listed items are in your bags.", 0.9, 0.4, 0.4)
        elseif def and def.key == "potion" then
            GameTooltip:AddLine("Shows how many you have. Not used from here.", 0.7, 0.7, 0.7)
        end
    end
    Bar.AddStatusLines(self.status)
    GameTooltip:Show()
end

local function build()
    if frame then
        return frame
    end
    local count = #Consumables.CATEGORIES
    frame = CreateFrame("Frame", "CowfeeRaidToolsReadyCheckRow", UIParent, "BackdropTemplate")
    frame:SetSize(Bar.Size(count))
    CRT.UI:RegisterLayer("bar", frame)
    frame:SetBackdrop(Bar.BACKDROP)
    CRT.UI:RegisterThemed(frame, { bg = { 0, 0, 0, 0.45 }, border = { 0.2, 0.8, 0.9 } })
    frame:SetClampedToScreen(true)
    frame:Hide()

    -- A drag handle above the row, shown during a preview so the row can be moved.
    handle = CreateFrame("Frame", nil, frame, "BackdropTemplate")
    handle:SetHeight(20)
    handle:SetBackdrop(Bar.BACKDROP)
    CRT.UI:RegisterThemed(handle, { bg = { 0.1, 0.3, 0.35, 0.9 }, border = { 0.2, 0.8, 0.9 } })
    local handleText = handle:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    handleText:SetPoint("CENTER")
    handleText:SetText("Consumables: drag to move")
    local reset = CRT.UI.ResetButton(handle, function()
        Display:ResetPosition()
    end)
    reset:SetPoint("RIGHT", -2, 0)
    CRT.UI.Placement.FitHandle(handle, frame, handleText)
    handle:Hide()

    -- A Close bar under the row, the row's width, for when you're done looking before the check ends.
    -- Only the raid leader gets it: everyone else's row goes with the game's window. Hidden during
    -- previews, which have their own drag bar and Reset. It hangs below the row, so without it the
    -- row has no empty space.
    closeBar = CreateFrame("Button", nil, frame, "BackdropTemplate")
    closeBar:SetHeight(20)
    closeBar:SetPoint("TOPLEFT", frame, "BOTTOMLEFT", 0, -2)
    closeBar:SetPoint("TOPRIGHT", frame, "BOTTOMRIGHT", 0, -2)
    closeBar:SetBackdrop(Bar.BACKDROP)
    CRT.UI:RegisterThemed(closeBar, { bg = { 0, 0, 0, 0.6 }, border = { 0.2, 0.8, 0.9 } })
    local closeText = closeBar:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    closeText:SetPoint("CENTER")
    closeText:SetText("Close")
    closeBar:SetHighlightTexture("Interface\\Buttons\\WHITE8X8")
    local closeHighlight = closeBar:GetHighlightTexture()
    if closeHighlight then
        closeHighlight:SetVertexColor(1, 1, 1, 0.12)
    end
    closeBar:SetScript("OnClick", function()
        Display:Hide()
    end)

    for index = 1, count do
        local slot = Bar.CreateSlot(frame, index, true)
        slot:SetScript("OnEnter", showTooltip)
        slot:SetScript("OnLeave", function()
            GameTooltip:Hide()
        end)
        slots[index] = slot
    end

    frame:SetScript("OnUpdate", function(_, dt)
        -- The ants move every frame, and the statuses refresh twice a second.
        for _, slot in ipairs(slots) do
            Ants:Update(slot, dt)
        end
        elapsed = elapsed + dt
        if elapsed < REFRESH_SECONDS then
            return
        end
        elapsed = 0
        Display:Refresh()
    end)

    -- Go the moment the game's window does (you answered, or the check ended), not at the next refresh.
    -- A post-hook: the game's own OnHide still runs, and nothing on its frame is changed.
    local rc = _G.ReadyCheckFrame
    if rc and rc.HookScript then
        pcall(rc.HookScript, rc, "OnHide", function()
            if frame:IsShown() then
                Display:Refresh()
            end
        end)
    end
    placement:Attach(frame, handle, { reset = reset })
    return frame
end

-- Not while it is dragged, so it is never put back under the cursor.
function place()
    if InCombatLockdown() or not frame or CRT.UI.Placement.Dragging() == placement then
        return
    end
    local window = not Display.preview and gameWindow()
    if window then
        sawGameWindow = true
    end
    -- Docked under the game's window, centred, a small gap. Anchored to UIParent at the window's
    -- spot, never to the window itself; each refresh places it again, so it follows the window.
    local x, bottom
    if window then
        x, bottom = windowBottom(window)
    end
    if x then
        frame:ClearAllPoints()
        frame:SetPoint("TOP", UIParent, "BOTTOMLEFT", x, bottom - DOCK_GAP)
    else
        -- where the player put it, else near the top of the screen
        placement:ApplySaved()
    end
end

-- Points a clickable icon at the item a click should use, and clears it for the others.
-- Not allowed in combat.
local function updateClickAction(slot, clickable)
    if InCombatLockdown() then
        return
    end
    local item = clickable and Consumables:NextItem(slot.key) or nil
    slot.useItem = item
    -- Used by item ID, not by name: every quality rank of a consumable has the same name, and /use
    -- with a name could take a lower rank than the one picked.
    local use = item and ("item:" .. item.id)
    local signature = item and (slot.key .. ":" .. use) or "none"
    if slot.appliedSignature == signature then
        return
    end
    slot.appliedSignature = signature

    if not item then
        slot:SetAttribute("type", nil)
        slot:SetAttribute("macrotext", nil)
        slot:SetAttribute("shift-type1", nil)
        slot:SetAttribute("shift-macrotext1", nil)
    elseif slot.key == "weapon" then
        -- Use the oil or stone, then apply it to the main hand. Shift-click uses the off hand.
        slot:SetAttribute("type", "macro")
        slot:SetAttribute("macrotext", "/use " .. use .. "\n/use " .. (INVSLOT_MAINHAND or 16))
        slot:SetAttribute("shift-type1", "macro")
        slot:SetAttribute("shift-macrotext1", "/use " .. use .. "\n/use " .. (INVSLOT_OFFHAND or 17))
    else
        slot:SetAttribute("type", "macro")
        slot:SetAttribute("macrotext", "/use " .. use)
    end
end

-- Hiding is blocked in combat on a frame with protected children, so it waits.
local function hideFrame()
    if not frame then
        return
    end
    if InCombatLockdown() then
        pendingHide = true
        return
    end
    pendingHide = false
    frame:Hide()
end

function Display:Refresh()
    if not frame or not frame:IsShown() then
        return
    end

    -- Hide when the check has timed out, or when the game's window was shown and has gone,
    -- which means you answered it or the check ended.
    if gameWindow() then
        sawGameWindow = true
    elseif sawGameWindow and not self.preview then
        return self:Hide()
    end
    if shownUntil and GetTime() >= shownUntil then
        return self:Hide()
    end
    place()
    -- A plain button, not a secure one, so it can change in combat too.
    closeBar:SetShown(not self.preview and leading)

    Consumables:RefreshBags()
    for index, key in ipairs(Consumables:Order()) do
        local slot = slots[index]
        local def = Consumables:Def(key)
        slot.key = key
        Bar.Apply(slot, Consumables:Status(key))
        updateClickAction(slot, def and def.clickable)
    end
end

function Display:Hide()
    -- A preview kept on from the main panel stays until it is turned off there.
    if self.persistent then
        return
    end
    shownUntil = nil
    self.preview = false
    hideFrame()
end

local function show(seconds, preview)
    if not Consumables:Enabled() and not preview then
        return
    end
    if InCombatLockdown() then
        -- The row holds protected buttons, so it cannot be shown in combat.
        if preview then
            CRT:Print("The row can't be shown while you are in combat.")
        end
        return
    end
    build()
    CRT.UI.CancelFade(frame)
    pendingHide = false
    Display.preview = preview
    sawGameWindow = false
    shownUntil = seconds and (GetTime() + seconds) or nil
    handle:SetShown(preview and true or false)
    readLeader()
    closeBar:SetShown(not preview and leading)
    place()
    frame:Show()
    elapsed = REFRESH_SECONDS
    Display:Refresh()
end

-- Shows the row for a few seconds without a real ready check, for testing.
function Display:Preview()
    show(PREVIEW_SECONDS, true)
    if frame and frame:IsShown() then
        CRT:Print("Showing the consumables row for " .. PREVIEW_SECONDS .. " seconds.")
    end
end

-- Keeps the row on screen, with its drag handle, until it is turned off: the "consumables" preview key, which
-- the main window's Previews, Ready Check's Preview ready check and Your bar's Preview your bar turn on.
function Display:SetPreview(on)
    if on then
        show(nil, true)
        self.persistent = frame and frame:IsShown() or false
    else
        self.persistent = false
        if handle then
            handle:Hide()
        end
        self:Hide()
    end
end

-- Moves the row back to its default place, for when the game shows you no ready check window.
function Display:ResetPosition()
    placement:Reset()
end

-- A theme switch repaints the bar: the ants and the running-low and none-left numbers take the theme's
-- colours (Bar.Apply).
CRT.UI:OnTheme(function()
    Display:Refresh()
end)

CRT.UI:RegisterPreview("consumables", function(on)
    Display:SetPreview(on)
end)

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_LOGIN")
events:RegisterEvent("PLAYER_REGEN_ENABLED")
events:RegisterEvent("READY_CHECK")
events:RegisterEvent("READY_CHECK_FINISHED")
events:RegisterEvent("START_PLAYER_COUNTDOWN")
events:RegisterEvent("GROUP_ROSTER_UPDATE")
events:RegisterEvent("PARTY_LEADER_CHANGED")
-- True when the ready check was started by you. The name can come with a realm, or be hidden from
-- addons, in which case it does not count as yours.
local function startedByMe(initiator)
    if type(initiator) ~= "string" or (issecretvalue and issecretvalue(initiator)) then
        return false
    end
    return Ambiguate(initiator, "none") == UnitName("player")
end

events:SetScript("OnEvent", function(_, event, initiator, timeLeft)
    if event == "PLAYER_LOGIN" then
        readLeader()
        -- Create the secure buttons now, out of combat.
        if not InCombatLockdown() then
            build()
        end
    elseif event == "GROUP_ROSTER_UPDATE" or event == "PARTY_LEADER_CHANGED" then
        -- Only the leader's cache changes here; the Close button follows at the next refresh.
        readLeader()
    elseif event == "PLAYER_REGEN_ENABLED" then
        if pendingHide then
            hideFrame()
        elseif frame and frame:IsShown() then
            Display:Refresh()
        end
    elseif event == "START_PLAYER_COUNTDOWN" then
        -- A pull timer started: the bar fades out over 2 seconds (Ready Check settings).
        if frame and frame:IsShown() and not Display.persistent and CRT.db.readycheck.fadeOnPull then
            CRT.UI.FadeOut(frame, 2, function()
                Display:Hide()
            end)
        end
    elseif event == "READY_CHECK" then
        if Consumables:NotStarter() and startedByMe(initiator) then
            return
        end
        local seconds = type(timeLeft) == "number" and timeLeft or 30
        show(seconds + 1, false)
        -- Blizzard's dialog may not be on screen yet when this event arrives, so place it again shortly.
        C_Timer.After(0.3, function()
            if frame and frame:IsShown() then
                place()
            end
        end)
    else
        Display:Hide()
    end
end)
