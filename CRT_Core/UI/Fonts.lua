local ADDON, CRT = ...

-- Text size in the UI: what follows General Settings > Text size after the shared fonts change (CRT:ApplyFonts in
-- Core.lua, which also keeps every shared font at CRT.FONT_FLOOR or more). UX rules 7 and 9: text fits at every text
-- size, and none is under 10 pt.
--   UI:RefitText()       called by CRT:ApplyFonts: every button sized from its label (UI.FitButton) and every tab
--                        (UI:FitTab) measures again, every row of them (UI.Flow) is placed again, every (?) beside
--                        a line of text (UI.HelpRight) follows the text, then each UI:OnFonts function runs. Once more
--                        on the next frame, for text the game measures late.
--   UI:OnFonts(fn)       (CRT_Core/UI/Panel.lua, with UI.FitButton) fn() after the fonts changed and the fitted
--                        controls measured again: a page with a layout of its own places it again here.
--   UI.CapFontSize(fs, font, low, high)
--                        draws a font string in a font object's face and outline at its size held between low and
--                        high points. For small labels on a fixed-size icon (the consumables bar's corner labels, the
--                        Gear Checker's track tag), which must not grow into a mark at a large text size (UX rule 7
--                        allows 10 to 12 pt there, a timer up to 14). Cheap to call on every refresh: it sets the font
--                        only when the font object changed. A capped string keeps the size it was given and stops
--                        following the font object (a text size change) until it is capped again: a caller on a
--                        surface that never refreshes must call it again from UI:OnFonts. After SetFontObject on the
--                        string, clear fs.crtCapPath so the next call sets the size again.

local UI = CRT.UI
-- UI.fitted, UI.flows and UI.fontListeners, which refit walks, are made in CRT_Core/UI/Panel.lua's [text fit] block.

local function refit()
    for _, b in ipairs(UI.fitted) do
        UI.FitButton(b)
    end
    for _, b in ipairs(UI.tabs or {}) do
        UI:FitTab(b)
    end
    for _, flow in ipairs(UI.flows) do
        flow:Layout()
    end
    -- a (?) beside a line of text follows the text's new width (UI.HelpRight)
    for _, b in ipairs(UI.helpFollowers or {}) do
        UI.PlaceHelp(b)
    end
    for _, fn in ipairs(UI.fontListeners) do
        fn()
    end
end

function UI:RefitText()
    refit()
    if C_Timer and C_Timer.After then
        C_Timer.After(0, refit)
    end
end

function UI.CapFontSize(fs, font, low, high)
    if not (font and font.GetFont and fs.SetFont) then
        return
    end
    local path, size, flags = font:GetFont()
    if not (path and size) then
        return
    end
    if fs.crtCapPath == path and fs.crtCapFrom == size and fs.crtCapFlags == flags then
        return
    end
    fs.crtCapPath, fs.crtCapFrom, fs.crtCapFlags = path, size, flags
    fs:SetFont(path, math.max(low, math.min(high, size)), flags or "")
end
