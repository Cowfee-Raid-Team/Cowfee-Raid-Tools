local ADDON, CRT = ...

-- The scrolling boxes the import and export windows share, so their look changes in one place:
--   UI.ScrollBox(parent, name, width)              a 1 px bordered box (the background at 0.6, the border edge) with a
--                                                  UIPanelScrollFrameTemplate inside it, its bar skinned (UI:SkinScrollBar)
--                                                  and the gutter on the right. box.scroll is the scroll frame, box.innerW
--                                                  the width a scroll child gets. The caller sets the child (a list's rows).
--   UI.CodeBox(parent, name, width, onUserText)   a ScrollBox holding a multi-line edit box (box.edit) for a code or a
--                                                  pasted export: Escape lets go of the keyboard, a click anywhere in the
--                                                  box puts the cursor in it, and onUserText(edit) runs when the player
--                                                  types or pastes (never when code sets the text).
-- width is the box's own width (the window's content width); place and size the box as any frame.
-- Used by Notes/AlertShareWindows.lua (Mech Alerts' Export and Import) and Timeline/ImportWindow.lua.

local UI = CRT.UI

local PAD = 6 -- the scroll frame's inset from the box's edge
UI.SCROLL_BOX_PAD = PAD

function UI.ScrollBox(parent, name, width)
    local box = CreateFrame("Frame", nil, parent, "BackdropTemplate")
    box:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    UI.Tint(box, "SetBackdropColor", "background", 0.6)
    UI.Tint(box, "SetBackdropBorderColor", "border")
    local scroll = CreateFrame("ScrollFrame", name, box, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(scroll.ScrollBar)
    scroll:SetPoint("TOPLEFT", PAD, -PAD)
    scroll:SetPoint("BOTTOMRIGHT", -(4 + UI.ScrollGutter()), PAD)
    box.scroll = scroll
    box.innerW = width - 2 * PAD - 4 - UI.ScrollGutter()
    return box
end

function UI.CodeBox(parent, name, width, onUserText)
    local box = UI.ScrollBox(parent, name, width)
    local edit = CreateFrame("EditBox", nil, box.scroll)
    edit:SetMultiLine(true)
    edit:SetAutoFocus(false)
    edit:SetFontObject(_G.CRTFontEditSmall or CRTFontEdit)
    edit:SetWidth(box.innerW)
    edit:SetScript("OnEscapePressed", edit.ClearFocus)
    edit:SetScript("OnTextChanged", function(self, user)
        if user and onUserText then
            onUserText(self)
        end
    end)
    box.scroll:SetScrollChild(edit)
    box:EnableMouse(true)
    box:SetScript("OnMouseDown", function()
        edit:SetFocus()
    end)
    box.edit = edit
    return box
end
