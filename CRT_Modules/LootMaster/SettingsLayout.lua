local ADDON, CRT = ...

-- Loot Master > Settings, third column (Raider Score, Order equal answers by, Loot authority, CRT Looting) as
-- plain numbers, so a test can check that nothing overlaps and that everything stays on the page. Page.lua
-- places its controls from these. A rectangle is { x, y, w, h }: x from the column's left edge, y down from the
-- top of the tab (negative), as SetPoint "TOPLEFT" takes it.
--   LM.SettingsLayout.Column3(pageW, p)   the column's width, its rectangles by name and where CRT Looting starts
--      p: sliderLabel, sliderW (the Raider Score sliders), authorityRows, tabH (the tab's height)
--   LM.SettingsLayout.DropdownWidth(labels)  a dropdown wide enough for its longest label
--   LM.TIE_CHOICES                        the Order equal answers by choices

local LM = CRT.LootMaster
local S = {}
LM.SettingsLayout = S

-- The game font is not measured here (the test has no fonts): a generous width per character, and the room a
-- dropdown's arrow and padding take.
S.CHAR_W = 7
S.DROPDOWN_PAD = 40
S.COL3_X = 724
S.RIGHT_MARGIN = 8

S.ROW_H = 32 -- a slider's or dropdown's row (UI.CONTROL_ROW_H)
S.CHECK_H = 24
S.HEAD_H = 16
S.SMALL_H = 12
S.AUTHORITY_ROW_H = 18
S.GAP = 4

LM.TIE_CHOICES = {
    { key = "wish", label = "Wishlist, then Raider Score" },
    { key = "score", label = "Raider Score, then wishlist" },
    { key = "wishonly", label = "Wishlist only" },
    { key = "scoreonly", label = "Raider Score only" },
}

function S.TextW(text)
    return #text * S.CHAR_W
end

function S.DropdownWidth(labels)
    local widest = 0
    for _, l in ipairs(labels) do
        widest = math.max(widest, S.TextW(l.label or l))
    end
    return widest + S.DROPDOWN_PAD
end

function S.Column3(pageW, p)
    local w = pageW - S.COL3_X - S.RIGHT_MARGIN
    local r = {}
    local function rect(name, x, y, rw, h)
        r[name] = { x = x, y = y, w = rw, h = h }
    end
    -- Raider Score: its heading and (?), "Show the Score column" beside them, then five slider rows
    rect("scoreHead", 0, -8, S.TextW("Raider Score") + 20, S.HEAD_H)
    local checkX = r.scoreHead.w + 6
    rect("showCheck", checkX, -4, S.CHECK_H + 2 + S.TextW("Show the Score column"), S.CHECK_H)
    local y = -32
    for i = 1, 5 do
        rect("slider" .. i, 0, y, p.sliderLabel + 5 + p.sliderW + 44, S.ROW_H)
        y = y - S.ROW_H
    end
    -- Order equal answers by: its heading and (?), then the dropdown on a line of its own, wide enough for the
    -- longest choice. The dropdown row starts 5 left of the column (its empty label and gap), so the box lines up.
    rect("tieHead", 0, y, S.TextW("Order equal answers by") + 20, S.HEAD_H)
    y = y - S.HEAD_H
    local pick = S.DropdownWidth(LM.TIE_CHOICES)
    rect("tieRow", 0, y, 5 + pick, S.ROW_H)
    y = y - S.ROW_H
    -- Loot authority: heading, the leader tick, its label, the names, the Add row under the last name
    local ay = y - S.GAP
    rect("authHead", 0, ay, S.TextW("Loot authority") + 20, S.HEAD_H)
    rect("authCheck", -2, ay - 18, S.CHECK_H + 2 + S.TextW("The raid leader"), S.CHECK_H)
    rect("authAlso", 0, ay - 46, S.TextW("Also these players:"), S.SMALL_H)
    for i = 1, p.authorityRows do
        rect("authName" .. i, 8, ay - 60 - (i - 1) * S.AUTHORITY_ROW_H, 260, S.AUTHORITY_ROW_H)
    end
    local addY = ay - 60 - p.authorityRows * S.AUTHORITY_ROW_H - 2
    rect("authAdd", 0, addY, w, S.ROW_H)
    -- CRT Looting
    local top = addY - S.ROW_H - S.GAP
    rect("lootHead", 0, top, S.TextW("CRT Looting") + 20, S.HEAD_H)
    rect("lootCheck", -2, top - 20, S.CHECK_H + 2 + S.TextW("Enable in party"), S.CHECK_H)
    return { w = w, rects = r, lootingTop = top, tiePick = pick, authorityTop = ay, tabH = p.tabH }
end
