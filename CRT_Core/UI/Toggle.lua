local ADDON, CRT = ...

-- UI.Toggle2: a two-part toggle, such as Mech Alerts' Mechanics | Special and the Timeline pop-out's
-- Abilities | Healer CDs. Two tab-styled halves side by side (UI:RegisterTab styles them in every look), each
-- as wide as its label plus padding, never under a minimum; the caller places them and lights one.
--   local t = UI.Toggle2(parent, { { key, label }, { key, label } }, onPick, opts)
--     onPick(key) runs on a click; opts: pad (each side of a label, 10), minW (60), gap (between the halves, 4),
--     h (the height, 18), font ("CRTFontSmall")
--   t.buttons[1], t.buttons[2]  the halves (b.key, b.text)
--   t:Size(room)          sizes both from their labels; when room (the width for both and the gap) is too small,
--                         both shrink in proportion and their labels are cut. Measured on each call, so a changed
--                         text size or label is followed. Returns the width used.
--   t:PlaceLeft(x, y)     the first half's top left at x, y in the parent, the second after it
--   t:PlaceRight(rel, x)  the second half's right edge x from rel's left edge, the first before it
--   t:Select(key, skin)   lights the half with that key: skin true through UI:SetTabSelected (which also skins the
--                         parent; for a real change of view), else only restyled (UI:StyleTab)

local UI = CRT.UI

local DEFAULTS = { pad = 10, minW = 60, gap = 4, h = 18, font = "CRTFontSmall" }
local BACKDROP = { bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 }

local function textWidth(fs)
    local w = fs.GetUnboundedStringWidth and fs:GetUnboundedStringWidth() or fs:GetStringWidth()
    return math.ceil(tonumber(w) or 0)
end

local Toggle = {}
Toggle.__index = Toggle

function UI.Toggle2(parent, halves, onPick, opts)
    local o = {}
    for k, v in pairs(DEFAULTS) do
        o[k] = (opts and opts[k] ~= nil) and opts[k] or v
    end
    local t = setmetatable({ buttons = {}, opts = o }, Toggle)
    for i, half in ipairs(halves) do
        local b = CreateFrame("Button", nil, parent, "BackdropTemplate")
        if b.SetBackdrop then
            b:SetBackdrop(BACKDROP)
        end
        b.sel = b:CreateTexture(nil, "ARTWORK")
        b.sel:SetAllPoints()
        b.sel:SetColorTexture(UI.Color("heading", 0.18)) -- UI:RegisterTab styles it from here on
        b.text = b:CreateFontString(nil, "OVERLAY", o.font)
        b.text:SetPoint("CENTER")
        b.text:SetText(half.label)
        b.key = half.key
        b:SetScript("OnClick", function()
            onPick(half.key)
        end)
        UI:RegisterTab(b)
        t.buttons[i] = b
    end
    return t
end

function Toggle:Size(room)
    local o, want, total = self.opts, {}, 0
    for i, b in ipairs(self.buttons) do
        want[i] = math.max(o.minW, textWidth(b.text) + 2 * o.pad)
        total = total + want[i]
    end
    local gaps = o.gap * (#self.buttons - 1)
    local scale = (room and total + gaps > room) and math.max(0, room - gaps) / total or 1
    local used = gaps
    for i, b in ipairs(self.buttons) do
        local w = math.floor(want[i] * scale)
        b:SetSize(w, o.h)
        b.text:SetWidth(math.max(1, w - 2 * o.pad))
        b.text:SetWordWrap(false)
        b.w = w
        used = used + w
    end
    return used
end

function Toggle:PlaceLeft(x, y)
    for _, b in ipairs(self.buttons) do
        b:ClearAllPoints()
        b:SetPoint("TOPLEFT", x, y)
        x = x + (b.w or b:GetWidth() or 0) + self.opts.gap
    end
end

function Toggle:PlaceRight(rel, x)
    local after
    for i = #self.buttons, 1, -1 do
        local b = self.buttons[i]
        b:ClearAllPoints()
        if after then
            b:SetPoint("RIGHT", after, "LEFT", -self.opts.gap, 0)
        else
            b:SetPoint("RIGHT", rel, "LEFT", x, 0)
        end
        after = b
    end
end

function Toggle:Select(key, skin)
    for _, b in ipairs(self.buttons) do
        local on = b.key == key
        if skin or not UI.StyleTab then
            UI:SetTabSelected(b, on)
        else
            UI:StyleTab(b, on)
        end
    end
end
