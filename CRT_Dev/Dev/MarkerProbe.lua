local ADDON, CRT = ...

-- DEVELOPER ONLY. /crt dev markerprobe opens a window that answers one question in the game: can a raid
-- marker be drawn from a group chat message the game hid (a secret string) without reading it? The idea:
-- join the hidden text onto the marker file path and hand the result to a texture, so "1" draws the
-- star and any other text points at no file and draws nothing.
--
-- The window lists the last 8 messages from the marker display's chat events (Markers/Display.lua),
-- plus /say for a solo test, newest on top. Each row shows the channel, "hidden: yes/no/unknown" from
-- issecretvalue(text), the sender and the text as the game gave them (set straight on a font string),
-- and three tries, each in pcall, with "set ok" or "refused (the game's error)":
--   A  Probe.PATH .. text, then Texture:SetTexture (and what it returned, when that is readable)
--   B  string.format("%s%s", Probe.PATH, text), then SetTexture
--   C  Probe.ATLAS .. text, then Texture:SetAtlas; skipped when the game has no such atlas. The group
--      manager's marker atlases run the other way (GM-raidMarker1 is the skull, 8 the star).
-- No secret value is read, compared or tested here: only issecretvalue and the pcall-wrapped setters
-- touch one. Copy puts the rows in a window as text, with a hidden value as <hidden>.
--
-- Checked 2026-10-23 on warcraft.wiki.gg (Secret values) and in Blizzard's 12.1.5 (70529) UI source:
--   joining (..) and string.format with secret strings are allowed in tainted code; the docs don't say
--     the result is secret, but it is expected to be.
--   Texture:SetTexture(textureAsset) and Texture:SetAtlas(atlas) are SecretArguments = "AllowedWhenTainted"
--     (SimpleTextureBaseAPIDocumentation.lua), with no secret aspect, so a texture given a secret is
--     marked as holding secret values. SetTexture returns success (bool).
--   the marker files are Interface\TargetingFrame\UI-RaidTargetingIcon_1 to _8 (ChatFrameConstants.lua);
--     the atlases GM-raidMarker1 to 8 (Blizzard_CompactRaidFrameManager.lua: "GM-raidMarker"..(9 - index)).
--   C_Texture.GetAtlasInfo(atlas) (TextureUtilsDocumentation.lua) tells whether the atlas exists.
--
-- Nothing is saved. This file never ships: its .toc line is inside the do-not-package block.

local Probe = {}
CRT.MarkerProbe = Probe

local UI = CRT.UI

Probe.MAX_ROWS = 8
Probe.PATH = "Interface\\TargetingFrame\\UI-RaidTargetingIcon_"
Probe.ATLAS = "GM-raidMarker"
Probe.EVENTS = {
    "CHAT_MSG_RAID", "CHAT_MSG_RAID_LEADER", "CHAT_MSG_PARTY", "CHAT_MSG_PARTY_LEADER",
    "CHAT_MSG_INSTANCE_CHAT", "CHAT_MSG_INSTANCE_CHAT_LEADER", "CHAT_MSG_SAY",
}
Probe.TEXT = {
    title = "Marker probe (dev)",
    help = "Type /raid 1 \226\128\166 /raid 8 and some normal chat. Hidden = the game hid the text. A star means the path trick drew it.\n\n"
        .. "A joins the text onto the marker file path and sets it on a texture. B builds the same path with string.format. "
        .. "C joins the text onto the marker atlas name. Its numbers run the other way: 1 draws the skull, 8 the star.\n\n"
        .. "Each try says set ok, or refused with the game's error. Copy puts the rows in a window to send.",
    hidden = { [true] = "hidden: yes", [false] = "hidden: no" },
    hiddenUnknown = "hidden: unknown",
    ok = "set ok",
    okReturned = "set ok, returned %s",
    okHidden = "set ok, answer hidden",
    refused = "refused (%s)",
    join = "join: ",
    hiddenError = "an error the game hid",
    skipped = "skipped: no marker atlas",
    clear = "Clear",
    copy = "Copy",
    copyTitle = "Marker probe rows (Ctrl+C to copy, paste to Claude)",
    copyEmpty = "The marker probe has no rows yet.",
    hiddenValue = "<hidden>",
    heads = { { 0, "Channel" }, { 90, "From" }, { 194, "Text" }, { 288, "A: path" }, { 406, "B: format" }, { 524, "C: atlas" } },
}
local TEXT = Probe.TEXT

local WIDTH, ROW_H, LIST_TOP = 668, 40, 54
local HEIGHT = LIST_TOP + Probe.MAX_ROWS * ROW_H + 44
local TRIES = { { key = "a", x = 288 }, { key = "b", x = 406 }, { key = "c", x = 524 } }
local ICON = 24

Probe.rows = {} -- row frames, newest message first; made as needed, then reused
Probe.entries = {} -- what each shown row says, as text for Copy, newest first

local win, listener

-- true or false from issecretvalue, nil when it can't say.
local function isSecret(v)
    if type(issecretvalue) ~= "function" then
        return nil
    end
    local ok, secret = pcall(issecretvalue, v)
    if not ok then
        return nil
    end
    return secret and true or false
end

-- A pcall's error as short text, without the file and line.
local function errText(e)
    if isSecret(e) then
        return TEXT.hiddenError
    end
    local ok, s = pcall(function()
        return (tostring(e):gsub("^.-%.lua:%d+: ", ""))
    end)
    return ok and isSecret(s) == false and s or TEXT.hiddenError
end

local function setResult(ok, ret, hasReturn)
    if not ok then
        return TEXT.refused:format(errText(ret))
    end
    if not hasReturn then
        return TEXT.ok
    end
    if isSecret(ret) ~= false then
        return TEXT.okHidden
    end
    return TEXT.okReturned:format(tostring(ret))
end

local function hasAtlas()
    if not (C_Texture and C_Texture.GetAtlasInfo) then
        return false
    end
    local ok, info = pcall(C_Texture.GetAtlasInfo, Probe.ATLAS .. "1")
    return ok and info ~= nil
end

-- The texture path or atlas name for a try, joined in pcall: ok, value or error.
local function join(key, text)
    if key == "b" then
        return pcall(string.format, "%s%s", Probe.PATH, text)
    end
    local head = key == "c" and Probe.ATLAS or Probe.PATH
    return pcall(function()
        return head .. text
    end)
end

-- One try on a row's texture; returns its result line.
local function try(slot, key, text)
    local icon = slot.icon
    pcall(icon.SetTexture, icon, nil) -- the last message's marker goes first
    local result
    if key == "c" and not hasAtlas() then
        result = TEXT.skipped
    else
        local joined, value = join(key, text)
        if not joined then
            result = TEXT.refused:format(TEXT.join .. errText(value))
        elseif key == "c" then
            local ok, err = pcall(icon.SetAtlas, icon, value)
            result = setResult(ok, err, false)
        else
            local ok, ret = pcall(icon.SetTexture, icon, value)
            result = setResult(ok, ret, true)
        end
    end
    slot.result:SetText(result)
    return result
end

local function label(parent, x, y, width, font)
    local fs = parent:CreateFontString(nil, "OVERLAY", font or "CRTFontSmall")
    fs:SetPoint("TOPLEFT", x, y)
    fs:SetWidth(width)
    fs:SetJustifyH("LEFT")
    fs:SetJustifyV("TOP")
    return fs
end

local function newRow()
    local r = CreateFrame("Frame", nil, win)
    r:SetSize(WIDTH - 28, ROW_H)
    r.channel = label(r, 0, 0, 86)
    r.hidden = label(r, 0, -14, 86, "CRTFontDisableSmall")
    r.sender = label(r, 90, 0, 100)
    r.sender:SetHeight(ROW_H - 4)
    r.message = label(r, 194, 0, 90)
    r.message:SetHeight(ROW_H - 4)
    r.tries = {}
    for _, t in ipairs(TRIES) do
        local icon = r:CreateTexture(nil, "ARTWORK")
        icon:SetSize(ICON, ICON)
        icon:SetPoint("TOPLEFT", t.x, 0)
        local result = label(r, t.x + ICON + 4, 0, 118 - ICON - 8)
        result:SetHeight(ROW_H - 4)
        result:SetWordWrap(true)
        r.tries[t.key] = { icon = icon, result = result }
    end
    return r
end

local function layout()
    for i, r in ipairs(Probe.rows) do
        r:ClearAllPoints()
        r:SetPoint("TOPLEFT", 14, -(LIST_TOP + (i - 1) * ROW_H))
    end
end

-- A row for a new message, on top: a new frame until there are MAX_ROWS, then the bottom one.
local function takeRow()
    local r
    if #Probe.rows < Probe.MAX_ROWS then
        r = newRow()
    else
        r = table.remove(Probe.rows)
    end
    table.insert(Probe.rows, 1, r)
    layout()
    r:Show()
    return r
end

-- A value for Copy: as it came when the game didn't hide it, else <hidden>.
local function plain(v)
    if isSecret(v) == false and v ~= nil then
        return tostring(v)
    end
    return TEXT.hiddenValue
end

function Probe.HandleEvent(event, text, sender)
    if not win then
        return
    end
    local r = takeRow()
    local channel = (event:gsub("^CHAT_MSG_", "")):lower()
    local hidden = isSecret(text)
    r.channel:SetText(channel)
    local hiddenText = hidden == nil and TEXT.hiddenUnknown or TEXT.hidden[hidden]
    r.hidden:SetText(hiddenText)
    pcall(r.sender.SetText, r.sender, sender)
    pcall(r.message.SetText, r.message, text)
    local entry = { channel, hiddenText, plain(sender), plain(text) }
    for _, t in ipairs(TRIES) do
        entry[#entry + 1] = t.key:upper() .. ": " .. try(r.tries[t.key], t.key, text)
    end
    table.insert(Probe.entries, 1, table.concat(entry, " | "))
    Probe.entries[Probe.MAX_ROWS + 1] = nil
end

function Probe:Clear()
    for _, r in ipairs(self.rows) do
        r:Hide()
    end
    self.entries = {}
end

function Probe:Copy()
    if #self.entries == 0 then
        CRT:Print(TEXT.copyEmpty)
        return
    end
    CRT.ConsumablesTools:ShowText(TEXT.copyTitle, "channel | hidden | from | text | A | B | C\n" .. table.concat(self.entries, "\n"))
end

local function listen(on)
    if not listener then
        listener = CreateFrame("Frame")
        listener:SetScript("OnEvent", function(_, event, ...)
            Probe.HandleEvent(event, ...)
        end)
    end
    listener:UnregisterAllEvents()
    if on then
        for _, e in ipairs(Probe.EVENTS) do
            listener:RegisterEvent(e)
        end
    end
end

local function button(parent, text)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontButtonSmall)
    b:SetHighlightFontObject(CRTFontButtonSmallHighlight)
    b:SetDisabledFontObject(CRTFontButtonSmallDisable)
    b:SetHeight(22)
    b:SetText(text)
    local fs = b:GetFontString()
    b:SetWidth(math.max(60, math.ceil((fs and fs:GetStringWidth() or 40) + 24)))
    return b
end

local function build()
    win = UI.Window("CowfeeRaidToolsMarkerProbe", { kind = "dialog", title = TEXT.title, width = WIDTH, height = HEIGHT })
    win:SetToplevel(true)
    win.strip:SetHelp("Marker probe", TEXT.help)
    Probe.window = win
    for _, h in ipairs(TEXT.heads) do
        label(win, 14 + h[1], -34, 110, "CRTFontDisableSmall"):SetText(h[2])
    end
    local clear = button(win, TEXT.clear)
    clear:SetPoint("BOTTOMLEFT", 14, 12)
    clear:SetScript("OnClick", function()
        Probe:Clear()
    end)
    local copy = button(win, TEXT.copy)
    copy:SetPoint("LEFT", clear, "RIGHT", 6, 0)
    copy:SetScript("OnClick", function()
        Probe:Copy()
    end)
    win:HookScript("OnShow", function()
        listen(true)
    end)
    win:HookScript("OnHide", function()
        listen(false)
    end)
    UI:SkinTree(win)
end

function Probe:Toggle()
    if not win then
        build()
    end
    if win:IsShown() then
        win:Hide()
    else
        win:Show()
    end
end

-- Handles "dev markerprobe". Returns false for any other command.
function Probe:Command(msg)
    if not msg:match("^dev%s+markerprobe%s*$") then
        return false
    end
    self:Toggle()
    return true
end
