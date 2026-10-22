// Loads CRT_Core/Core.lua, CRT_Core/Themes.lua, CRT_Core/UI/Panel.lua, CRT_Core/UI/Controls.lua (stubbed templates), CRT_Core/UI/SettingsPage.lua and
// CRT_Modules/Notes/Alert.lua on mock frames, then changes fonts, layers and style, and lays the alert out on
// each side.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local coreSrc, panelSrc, controlsSrc, pageSrc, alertSrc, profilesSrc, themesSrc, macrosSrc, windowSrc, tooltipSrc = ...
-- FAIL lines are counted, and the count printed last, so a failure shows past the runner's tail
local failCount, rawPrint = 0, print
print = function(s, ...) if type(s) == "string" and s:find("^FAIL ") then failCount = failCount + 1 end rawPrint(s, ...) end
CLOSE = "Close" DELETE = "Delete"
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
local frames = {}
local combat = false
local function mock(kind)
  local m = { kind = kind, shown = true, pts = {}, regions = {} }
  frames[#frames + 1] = m
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" then return function(self, _, _, font)
      local fsx = mock("FontString") rawset(fsx, "font", font) rawset(fsx, "text", "") table.insert(self.regions, fsx) return fsx end end
    if k == "CreateTexture" then return function(self) local tx = mock("Texture") table.insert(self.regions, tx) return tx end end
    if k == "GetRegions" then return function(self) return table.unpack(self.regions) end end
    if k == "GetObjectType" then return function(self) return self.kind end end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "Show" then return function(self) self.shown = true end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) self.shown = on and true or false end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "SetFrameStrata" then return function(self, s) rawset(self, "strata", s) end end
    if k == "IsProtected" then return function(self) return rawget(self, "protected") or false end end
    if k == "SetAlpha" then return function(self, a) rawset(self, "alpha", a) end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "SetWidth" then return function(self, w) rawset(self, "w", w) end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "ClearAllPoints" then return function(self) self.pts = {} end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetStringWidth" then return function(self) return #(rawget(self, "text") or "") * 8 end end
    if k == "GetFont" then return function() return "f", 20, "" end end
    if k == "GetCenter" then return function() return 500, 400 end end
    if k == "SetColorTexture" then return function(self, r, g, b, a) rawset(self, "color", { r, g, b, a }) end end
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabled", on and true or false) end end
    if k == "GetText" then return function(self) return rawget(self, "text") end end
    if k == "GetFrameLevel" then return function() return 1 end end
    if k == "SetChecked" then return function(self, on) rawset(self, "checked", on and true or false) end end
    if k == "GetChecked" then return function(self) return rawget(self, "checked") or false end end
    return function() end end })
end
function CreateFrame(kind, name, parent, template) local f = mock(kind) rawset(f, "parent", parent) rawset(f, "frameName", name) if template == "BasicFrameTemplateWithInset" then f:CreateTexture() f:CreateTexture() if name == "CowfeeRaidToolsProfileText" then rawset(f, "CloseButton", mock("Button")) end end
  if template == "UIPanelScrollFrameTemplate" then rawset(f, "ScrollBar", mock("Slider")) end return f end
-- The game's encoding API, standing in: the serialized table is kept and handed back.
local encoded = {}
C_EncodingUtil = { SerializeCBOR = function(t) encoded[#encoded + 1] = t return "cbor" .. #encoded end, CompressString = function(s) return s end, EncodeBase64 = function(s) return s end,
  DecodeBase64 = function(s) return s end, DecompressString = function(s) return s end,
  DeserializeCBOR = function(s) local t = encoded[tonumber(s:match("^cbor(%d+)$") or "")] if not t then error("bad") end return t end }
reloads = 0
function ReloadUI() reloads = reloads + 1 end
function UnitName() return "Solex" end
CreateColor = function(r, g, b, a) return { r = r, g = g, b = b, a = a } end
date, time = os.date, os.time
UIParent = mock("UIParent") UISpecialFrames = {}
function tinsert(t, v) table.insert(t, v) end
format = string.format
InCombatLockdown = function() return combat end
GetTime = function() return 0 end
C_AddOns = {}
-- Font objects: record SetFont.
local fontObjects = {}
local function fontObject(path, size, flags)
  local o = { path = path, size = size, flags = flags }
  function o:CopyFontObject(src) self.path, self.size, self.flags = src.path, src.size, src.flags end
  function o:GetFont() return self.path, self.size, self.flags end
  function o:SetFont(p, s, f) self.path, self.size, self.flags = p, s, f end
  o.color = { 1, 0.82, 0 }
  function o:GetTextColor() return self.color[1], self.color[2], self.color[3] end
  function o:SetTextColor(r, g, b) self.color = { r, g, b } end
  return o
end
GameFontNormal = fontObject("Fonts\\\\FRIZQT__.TTF", 12, "") GameFontHighlight = GameFontNormal GameFontDisable = GameFontNormal
GameFontHighlightSmall = fontObject("Fonts\\\\FRIZQT__.TTF", 10, "") GameFontDisableSmall = GameFontHighlightSmall
GameFontNormalLarge = fontObject("Fonts\\\\FRIZQT__.TTF", 16, "")
GameFontNormalSmall = fontObject("Fonts/FRIZQT__.TTF", 10, "") ChatFontNormal = fontObject("Fonts/ARIALN.TTF", 14, "")
CANCEL = "Cancel"
local popup
function StaticPopup_ShowCustomGenericConfirmation(data) popup = data end
-- A LibSharedMedia stand-in with one font of its own and one that is the same file as a game font.
local lsm = { List = function() return { "Arial Narrow", "Expressway" } end, Fetch = function(_, _, name) return ({ ["Arial Narrow"] = "Fonts/ARIALN.TTF", Expressway = "Interface/AddOns/SharedMedia/Expressway.ttf" })[name] end }
LibStub = { GetLibrary = function(_, name) if name == "LibSharedMedia-3.0" then return lsm end end }
function CreateFont(name) local o = fontObject() fontObjects[name] = o _G[name] = o return o end
local CRT = {}
assert(load(coreSrc, "CRT_Core/Core.lua"))("CowfeeRaidTools", CRT)
assert(load(themesSrc, "CRT_Core/Themes.lua"))("CowfeeRaidTools", CRT)
assert(load(profilesSrc, "CRT_Core/Profiles.lua"))("CowfeeRaidTools", CRT)
-- the shipped textures' folder, set once in Core.lua
if CRT.MEDIA == "Interface\\\\AddOns\\\\CowfeeRaidTools\\\\CRT_Media\\\\Media\\\\" then print("ok CRT.MEDIA") else print("FAIL CRT.MEDIA: " .. tostring(CRT.MEDIA)) end
-- ADDON_LOADED, with data saved before themes: the Modern look on and no theme loads as Beanworks: Cowfee.
CRTDB = { ui = { modern = true } }
for _, f in ipairs(frames) do if rawget(f, "OnEvent") then f.OnEvent(f, "ADDON_LOADED", "CowfeeRaidTools") end end
do
  local ui, want, same = CRT.db.ui, CRT.THEMES.cowfee, true
  for _, k in ipairs(CRT.THEME_KEYS) do
    local a, b = CRT.PALETTE[k], want[k]
    if math.abs(a[1] - b[1]) > 0.001 or math.abs(a[2] - b[2]) > 0.001 or math.abs(a[3] - b[3]) > 0.001 then same = false end
  end
  if ui.theme == "cowfee" and ui.modern == true and same then print("ok old Modern data loads as cowfee, CRT.PALETTE its palette")
  else print("FAIL old Modern data: theme " .. tostring(ui.theme) .. ", modern " .. tostring(ui.modern) .. ", palette " .. tostring(same)) end
end
-- the rest starts from a fresh install in Classic
CRT.db.ui.theme, CRT.db.ui.modern = "blizzard", false
CRT:UseTheme("blizzard")
CRT:ApplyFonts()
if CRT.db.ui.theme ~= "blizzard" then print("FAIL back to Classic") end
local function fontLine(name) local o = fontObjects[name] return name .. " " .. o.path .. " " .. o.size .. " '" .. o.flags .. "'" end
print("loaded: " .. fontLine("CRTFontNormal") .. ", ui.font " .. CRT.db.ui.font)
CRT.db.ui.font = "Arial Narrow" CRT.db.ui.outline = "OUTLINE" CRT.db.ui.textSize = 125 CRT:ApplyFonts()
print("Arial, outline, 125%: " .. fontLine("CRTFontNormal") .. "; " .. fontLine("CRTFontLarge"))
CRT.db.ui.font = "default" CRT.db.ui.outline = "" CRT.db.ui.textSize = 100 CRT:ApplyFonts()
print("back to default: " .. fontLine("CRTFontNormal"))

assert(load(panelSrc, "Panel.lua"))("CowfeeRaidTools", CRT)
assert(load(tooltipSrc, "CRT_Core/UI/Tooltip.lua"))("CowfeeRaidTools", CRT)
local UI = CRT.UI
-- Controls with simple stand-ins, so the page can build.
MinimalSliderWithSteppersMixin = { Label = { Right = 2 }, Event = {} }
function CreateMinimalSliderFormatter(_, fn) return fn end
assert(load(controlsSrc, "Controls.lua"))("CowfeeRaidTools", CRT)
assert(load(windowSrc, "CRT_Core/UI/Window.lua"))("CowfeeRaidTools", CRT)
CRT.Notes = { Alert = function() return CRT.db.notes.alert end, SpellInfo = function() return { icon = 1, name = "Avenging Wrath" } end }
CRT.NoteEngine = { running = false }
-- CRT_Modules/Notes/Alert.lua's preview reads CRT.Alerts.running (set by CRT_Modules/Alerts/Engine.lua in the game)
CRT.Alerts = CRT.Alerts or { running = false }
-- The macro engine, with a one-macro set and a small stand-in for the game's macro list.
local gameMacros = {}
function GetNumMacros() return #gameMacros, 0 end
function GetMacroInfo(i) local m = gameMacros[i] if m then return m.name, m.icon, m.body end end
function CreateMacro(name, icon, body) if combat then error("blocked") end gameMacros[#gameMacros + 1] = { name = name, icon = icon, body = body } return #gameMacros end
function DeleteMacro(i) if combat then error("blocked") end table.remove(gameMacros, i) end
function EditMacro(i, _, _, body) if combat then error("blocked") end gameMacros[i].body = body return i end
assert(load(macrosSrc, "CRT_Core/Macros.lua"))("CowfeeRaidTools", CRT)
if not (CRT.db.macros and type(CRT.db.macros.owned) == "table") then print("FAIL CRTDB.macros.owned has a default") end
CRT.Macros:Register({ key = "test", label = "Test calls", macros = { { name = "CRT Test", icon = 134400, body = "/say test" } } })
assert(load(pageSrc, "SettingsPage.lua"))("CowfeeRaidTools", CRT)
UI:RegisterPage("devtest", "Development", function() end)
UI:SetPageHidden("devtest", true, true)
assert(load(alertSrc, "Alert.lua"))("CowfeeRaidTools", CRT)

-- Layers. Header buttons made by UI:Create are remembered, for the look toggle's check.
headerMade = {}
local realHeaderButton = UI.HeaderButton
UI.HeaderButton = function(p, label, fn, opts) local b = realHeaderButton(p, label, fn, opts) headerMade[b] = label return b end
local f = UI:Create()
UI.HeaderButton = realHeaderButton
print("main window layer " .. tostring(f.strata) .. ", art textures " .. #f.art)
local bar = mock("Frame") rawset(bar, "protected", true)
UI:RegisterLayer("bar", bar)
UI:SetLayer("panel", "DIALOG")
print("panel -> Dialog: " .. f.strata .. ", saved " .. tostring(CRT.db.ui.layers.panel))
UI:SetLayer("panel", "HIGH")
print("panel back to default: saved " .. tostring(CRT.db.ui.layers.panel))
combat = true UI:SetLayer("bar", "LOW")
print("bar in combat: " .. tostring(bar.strata) .. " (waits)")
combat = false
for _, fr in ipairs(frames) do if rawget(fr, "OnEvent") and fr ~= frames[1] then fr.OnEvent(fr, "PLAYER_REGEN_ENABLED") end end
print("after combat: " .. tostring(bar.strata))

-- Two looks only: a profile saved with the old style "minimal" is the Classic look, with the game's art.
CRT.db.ui.style = "minimal" CRT.db.ui.bgAlpha = 50 UI:ApplyStyle()
if not f.art[1].shown or f.flatBg.shown or UI:IsModern() then print("FAIL a saved style 'minimal' must load as Classic (art shown " .. tostring(f.art[1].shown) .. ", flat shown " .. tostring(f.flatBg.shown) .. ")") end
if UI.IsFlat then print("FAIL UI:IsFlat is gone: only Classic and Modern are left") end
print("old minimal 50%: art shown " .. tostring(f.art[1].shown) .. ", art alpha " .. tostring(f.art[1].alpha) .. ", flat shown " .. tostring(f.flatBg.shown))

-- The theme button in the title bar: a header button whose label is the theme; a click opens the theme
-- menu (UI.ContextMenu, from Window.lua, stood in for here) and a pick switches it live, fonts and all.
do
  local lb = UI.lookButton
  local menu
  UI.ContextMenu = function(owner, fill, anchor)
    local root = { radios = {} }
    function root:CreateRadio(text, isSelected, setSelected) self.radios[#self.radios + 1] = { text = text, pick = setSelected } end
    fill(root)
    menu = { owner = owner, root = root, anchor = anchor }
  end
  local function pick(name)
    menu = nil
    lb.OnClick(lb)
    for _, r in ipairs(menu and menu.root.radios or {}) do if r.text == name then r.pick() return end end
    print("FAIL the theme menu has no " .. name)
  end
  if not lb then
    print("FAIL no theme button in the title bar")
  else
    if not headerMade[lb] then print("FAIL the theme button is not a UI.HeaderButton") end
    if lb.text ~= "Default: Blizzard" then print("FAIL theme label in Classic: " .. tostring(lb.text)) end
    local before = fontObjects.CRTFontNormal.path
    pick("Beanworks: Cowfee")
    if not (menu and menu.owner == lb and menu.anchor and menu.anchor[2] == lb) then print("FAIL the theme menu opens under the button") end
    if not CRT.db.ui.modern or CRT.db.ui.theme ~= "cowfee" then print("FAIL picking Beanworks: Cowfee turns Modern on") end
    if lb.text ~= "Beanworks: Cowfee" then print("FAIL theme label in Modern: " .. tostring(lb.text)) end
    if not f.titleLine.shown or f.art[1].shown then print("FAIL a pick applies the Modern look at once") end
    if fontObjects.CRTFontNormal.path == before then print("FAIL a pick applies the Modern fonts at once") end
    pick("Default: Blizzard")
    if CRT.db.ui.modern or lb.text ~= "Default: Blizzard" or f.titleLine.shown or not f.art[1].shown then print("FAIL picking Default: Blizzard goes back to Classic") end
    if fontObjects.CRTFontNormal.path ~= before then print("FAIL Default: Blizzard puts the Classic fonts back") end
    -- a theme set another way (a profile switch) shows on the button with the next ApplyStyle
    CRT.db.ui.theme = "nitro" CRT.db.ui.modern = true UI:ApplyStyle()
    if lb.text ~= "Blackout: Nitro" then print("FAIL theme label follows ApplyStyle") end
    CRT.db.ui.theme = "blizzard" CRT.db.ui.modern = false CRT:ApplyFonts() UI:ApplyStyle()
    print("theme button: " .. lb.text)
    -- the toggle is sized once per ApplyStyle, and again after a font change (its label's width moves)
    local realSkin, skins = lb.crtSkin, 0
    lb.crtSkin = function(...) skins = skins + 1 return realSkin(...) end
    UI:ApplyStyle()
    if skins ~= 1 then print("FAIL ApplyStyle sizes the toggle once (got " .. skins .. ")") end
    skins = 0 CRT.db.ui.outline = "OUTLINE" CRT:ApplyFonts()
    if skins < 1 then print("FAIL a font change re-sizes the header buttons") end
    CRT.db.ui.outline = "" CRT:ApplyFonts()
    lb.crtSkin = realSkin
  end
end

-- Settings page builds, with the dropdown options captured by label.
local dropdowns = {}
local realDropdown = UI.Dropdown
UI.Dropdown = function(p, text, opts) dropdowns[text] = opts return realDropdown(p, text, opts) end
UI:SelectPage("settings")
if dropdowns["Style"] then print("FAIL General Settings still has the Style dropdown") end
for _, fr in ipairs(frames) do
  local t = rawget(fr, "text")
  if type(t) == "string" and t:find("Modern look", 1, true) then print("FAIL General Settings still has the Modern look checkbox") end
end
local names = {} for _, o in ipairs(dropdowns["Font"].options()) do names[#names + 1] = o.label end
print("font choices: " .. table.concat(names, ", "))
CRT.Notes.Fire = function() print("  note windows redraw") end
CRT.ready = true
CRT.db.notes.window.font = "Morpheus"
dropdowns["Font"].set("Expressway")
print("picked Expressway: popup '" .. string.format(popup.text, popup.text_arg1) .. "', button " .. popup.acceptText .. ", font still " .. CRT.db.ui.font)
popup.callback()
print("accepted: ui.font " .. CRT.db.ui.font .. ", note windows " .. CRT.db.notes.window.font .. " / " .. CRT.db.notes.assignments.font .. " / " .. CRT.db.notes.personal.font)
print("  " .. fontLine("CRTFontNormal") .. "; " .. fontLine("CRTFontEdit") .. "; " .. fontLine("CRTFontButtonSmall"))
popup = nil dropdowns["Font"].set("Expressway")
print("same font again: popup " .. tostring(popup))
print("settings page built: " .. tostring(UI.pages.settings.frame ~= nil) .. ", title " .. UI.pages.settings.title .. ", profile " .. CRT.Profiles:Current() .. ", minimap " .. tostring(CRT.db.minimap.angle))
-- every (?) on the page is UI.HelpRight's: HELP_GAP right of its target, or of its text's right edge
do
  local helps, titled = 0, false
  for _, f in ipairs(frames) do
    if rawget(f, "crtHelp") then
      helps = helps + 1
      local t, fs, p = rawget(f, "crtHelpTarget"), rawget(f, "crtHelpText"), f.pts[#f.pts]
      local ok = t ~= nil and p ~= nil and p[1] == "LEFT" and p[5] == 0
      if ok and fs then
        ok = p[2] == fs and p[3] == "CENTER" and p[4] == fs:GetStringWidth() / 2 + UI.HELP_GAP
      elseif ok then
        ok = p[2] == t and p[3] == "RIGHT" and p[4] == UI.HELP_GAP
      end
      if not ok then print("FAIL settings: a (?) not just right of what it explains: " .. tostring(t and rawget(t, "text"))) end
      if fs and rawget(fs, "text") == "General Settings" then titled = true end
    end
  end
  if helps == 0 or not titled then print("FAIL settings: no (?) right of the General Settings title") end
  print("settings page: " .. helps .. " (?) icons, each just right of what it explains")
end
-- Tooltip position: a dropdown on Appearance, next to what you hover by default, saved in ui.tooltipAnchor
do
  local d = dropdowns["Tooltip position"]
  if not d then print("FAIL General Settings has a Tooltip position dropdown") else
    local o = type(d.options) == "function" and d.options() or d.options
    local labels = {} for _, x in ipairs(o) do labels[#labels + 1] = x.key .. "=" .. x.label end
    if table.concat(labels, ",") ~= "owner=Next to what you hover,game=Game's tooltip spot" then print("FAIL Tooltip position choices: " .. table.concat(labels, ",")) end
    if CRT.defaults.ui.tooltipAnchor ~= "owner" then print("FAIL Core.lua's default for ui.tooltipAnchor is owner: " .. tostring(CRT.defaults.ui.tooltipAnchor)) end
    if d.get() ~= "owner" then print("FAIL Tooltip position starts on Next to what you hover: " .. tostring(d.get())) end
    d.set("game")
    if CRT.db.ui.tooltipAnchor ~= "game" or d.get() ~= "game" or UI.TooltipPosition() ~= "game" then print("FAIL picking Game's tooltip spot saves it") end
    d.set("owner")
    if CRT.db.ui.tooltipAnchor ~= "owner" or UI.TooltipPosition() ~= "owner" then print("FAIL picking Next to what you hover saves it") end
    local helped = false
    for _, fr in ipairs(frames) do
      local t = rawget(fr, "crtHelpText")
      if rawget(fr, "crtHelp") and t and rawget(t, "text") == "Tooltips" then helped = true end
    end
    if not helped then print("FAIL the Tooltips heading has a (?)") end
    print("tooltip position: " .. table.concat(labels, ", "))
  end
end
local opts = {} for _, o in ipairs(dropdowns["Use profile"].options()) do opts[#opts + 1] = o.label end
print("use profile choices: " .. table.concat(opts, ", ") .. "; copy from enabled " .. tostring(dropdowns["Copy from"].enabledIf()))

-- The tabs: Appearance and Profiles. The macros moved to Raid Notes > Marker macros (Markers/MacrosTab.lua).
do
  local function textOf(fr) local t = rawget(fr, "text") return type(t) == "string" and t or "" end
  local function findText(want, kind) for _, fr in ipairs(frames) do if (not kind or fr.kind == kind) and textOf(fr) == want then return fr end end end
  local tabLabels = {}
  for _, fr in ipairs(frames) do
    local t = textOf(fr)
    if fr.kind == "FontString" and rawget(fr, "font") == "CRTFontNormal" and (t == "Appearance" or t == "Macros" or t == "Profiles") then tabLabels[#tabLabels + 1] = t end
  end
  -- the tab labels are made first; the tabs' own headings come after
  tabLabels = { tabLabels[1], tabLabels[2] }
  if table.concat(tabLabels, ",") ~= "Appearance,Profiles" then print("FAIL General Settings tabs are Appearance, Profiles (got " .. table.concat(tabLabels, ",") .. ")") end
  if findText("Test calls", "FontString") or findText("Create macros", "Button") then print("FAIL General Settings has no macro rows any more") end
  print("macros tab gone")

  -- Profiles: Export settings only, the import preview, Keep my window positions, Undo last import.
  local function button(want, parent)
    for _, fr in ipairs(frames) do if fr.kind == "Button" and textOf(fr) == want and (not parent or rawget(fr, "parent") == parent) then return fr end end
  end
  UI.SkinScrollBar = UI.SkinScrollBar or function() end -- CRT_Core/UI/ScrollBar.lua isn't loaded here
  local exportShare, undo = button("Export settings only"), button("Undo last import")
  if not (exportShare and undo) then print("FAIL the Profiles tab has Export settings only and Undo last import buttons") else
    UI.pages.settings.frame.OnShow()
    if rawget(undo, "enabled") ~= false then print("FAIL Undo last import is greyed with no backup") end
    exportShare.OnClick(exportShare)
    local d
    for _, fr in ipairs(frames) do if rawget(fr, "frameName") == "CowfeeRaidToolsProfileText" then d = fr end end
    local text = d and d.edit:GetText() or ""
    if not (d and d.shown and text:find("^# Cowfee Raid Tools settings\\n# From: Solex, ") and text:find("\\nCRTS1:cbor%d+$")) then print("FAIL Export settings only shows the header and the string: " .. text) end
    if not (d and button("Select all", d) and findText("Ctrl+C to copy. Settings and window positions only.", "FontString")) then print("FAIL the export has Select all and the copy hint") end
    if d and not (d.strip and rawget(d, "frameName") == "CowfeeRaidToolsProfileText") then print("FAIL the profile window is made by UI.Window") end
    if d then
      d.edit:SetText("typed over") d.edit.OnTextChanged(d.edit, true)
      if d.edit:GetText() ~= text then print("FAIL the export box is read-only") end
    end
    -- The raider's own setting differs, and the import shows it.
    CRT.db.debuffs.size = 60
    local imp = button("Import", UI.pages.settings.frame) or button("Import")
    for _, fr in ipairs(frames) do if fr.kind == "Button" and textOf(fr) == "Import" and rawget(fr, "parent") ~= d then imp = fr end end
    imp.OnClick(imp)
    local ok = button("Import", d)
    d.edit:SetText(text) d.edit.OnTextChanged(d.edit, true)
    local preview = d.preview and d.preview.text or ""
    if not (preview:find("From Solex, 1 setting differs from yours:", 1, true) and preview:find("Debuffs > size: 60 -> 44", 1, true)) then print("FAIL the import preview lists what differs: " .. preview) end
    if not (d.keep and d.keep.shown and rawget(ok, "enabled") ~= false) then print("FAIL a settings string shows Keep my window positions and can be imported") end
    if not (d.keep.refresh and d.keep.label and d.keep.label.shown) then print("FAIL Keep my window positions is the page's checkbox, its label shown with it") end
    d.keep:SetChecked(true) d.keep.OnClick(d.keep)
    if d.state.keep ~= true then print("FAIL ticking Keep my window positions is kept for the import") end
    d.keep:SetChecked(false) d.keep.OnClick(d.keep)
    popup = nil
    ok.OnClick(ok)
    if not (popup and string.format(popup.text, popup.text_arg1):find("Solex", 1, true)) then print("FAIL Import asks first") end
    if CRT.db.debuffs.size ~= 60 or reloads ~= 0 then print("FAIL nothing changes before the confirm") end
    popup.callback()
    if CRT.db.debuffs.size ~= 44 or reloads ~= 1 then print("FAIL the confirmed import applies and reloads") end
    UI.pages.settings.frame.OnShow()
    if rawget(undo, "enabled") ~= true then print("FAIL Undo last import is enabled with a backup") end
    undo.OnClick(undo)
    popup.callback()
    if CRT.db.debuffs.size ~= 60 or reloads ~= 2 then print("FAIL Undo puts the old setting back and reloads") end
    -- A damaged string: red text, no import.
    d.edit:SetText("CRTS1:cbor999") d.edit.OnTextChanged(d.edit, true)
    preview = d.preview.text or ""
    if not (preview:find("|cff" .. UI.Hex("bad"), 1, true) and preview:find("damaged", 1, true) and rawget(ok, "enabled") == false) then print("FAIL a damaged string shows red text and can't be imported: " .. preview) end
    -- A full profile string: a short summary and the name box.
    d.edit:SetText(CRT.Profiles:Export()) d.edit.OnTextChanged(d.edit, true)
    if not ((d.preview.text or ""):find("whole profile", 1, true) and d.name.shown and not d.keep.shown) then print("FAIL a full string shows its summary and the name box: " .. tostring(d.preview.text)) end
    if d.keep.shown or d.keep.label.shown then print("FAIL a full string hides Keep my window positions and its label") end
    -- a saved value with a wrong shape is left out of the export, and the export says so
    CRT.db.debuffs.maxCount = "four"
    exportShare.OnClick(exportShare)
    if not (findText("Ctrl+C to copy. Settings and window positions only. |cff" .. UI.Hex("warn") .. "1 saved setting had a wrong value and is left out.|r", "FontString")) then print("FAIL the export counts the values it left out") end
    CRT.db.debuffs.maxCount = 4
    CRT.db.debuffs.size = 44
    print("profiles tab: export settings only, preview, import and undo checked")
  end
end

-- Modern look.
if k == nil then end
local pb = UI.pages.settings.button
local tab = mock("Button") rawset(tab, "sel", mock("Texture")) rawset(tab, "text", mock("FontString"))
UI:RegisterTab(tab)
CRT.db.ui.modern = true UI:ApplyStyle()
print("modern: art shown " .. tostring(f.art[1].shown) .. ", flat " .. tostring(f.flatBg.shown) .. ", title line " .. tostring(f.titleLine.shown) .. ", divider " .. tostring(f.divider.line.shown) .. ", menu block " .. tostring(f.menu.blocks[1] and f.menu.blocks[1].shown) .. ", button text at " .. tostring(pb.text.pts[1][1]) .. ", tab teal " .. tostring(tab.sel.color[2] > tab.sel.color[1]))
print("modern font: " .. fontLine("CRTFontNormal") .. ", color " .. string.format("%.2f %.2f %.2f", CRT.db.ui.modern and 0 or 0, 0, 0))
CRT.db.ui.font = "default" CRT:ApplyFonts() print("modern default font: " .. fontLine("CRTFontNormal")) CRT.db.ui.font = "Expressway"
CRT:ApplyFonts() print("after ApplyFonts in modern: " .. fontLine("CRTFontNormal") .. string.format(", color %.2f %.2f %.2f", fontObjects.CRTFontNormal.color[1], fontObjects.CRTFontNormal.color[2], fontObjects.CRTFontNormal.color[3]))
CRT.db.ui.modern = false CRT:ApplyFonts() UI:ApplyStyle()
print("classic font: " .. fontLine("CRTFontNormal") .. string.format(", color %.2f %.2f %.2f", fontObjects.CRTFontNormal.color[1], fontObjects.CRTFontNormal.color[2], fontObjects.CRTFontNormal.color[3]))
print("classic: title line " .. tostring(f.titleLine.shown) .. ", menu block " .. tostring(f.menu.blocks[1].shown) .. ", button text at " .. tostring(pb.text.pts[1][1]) .. ", tab gold " .. tostring(tab.sel.color[1] == 1))
-- The divider between the menu and the page area: one line, in the gap, full menu height, repainted per theme.
do
  local d = f.divider
  local function near(c, want) return c and math.abs(c[1] - want[1]) < 0.003 and math.abs(c[2] - want[2]) < 0.003 and math.abs(c[3] - want[3]) < 0.003 end
  if not (d and d.line and d.shadow) then print("FAIL the main window has no divider") else
    local p1, p2 = d.line.pts[1], d.line.pts[2]
    if not (p1 and p2 and p1[1] == "TOPLEFT" and p1[2] == f.menu and p1[3] == "TOPRIGHT" and p2[1] == "BOTTOMLEFT" and p2[2] == f.menu and p2[3] == "BOTTOMRIGHT" and p1[4] >= 0 and p1[5] == 0 and p2[5] == 0) then
      print("FAIL the divider hugs the menu's right edge for its full height") end
    local cp = f.content.pts[1]
    if not (cp and cp[2] == f.menu and cp[4] > p1[4] + 3) then print("FAIL the divider (with its shadow) fits in the gap before the page") end
    CRT.db.ui.theme, CRT.db.ui.modern = "blizzard", false UI:ApplyStyle()
    local c = d.line.color
    if not (d.line.w == 2 and d.line.shown ~= false and c and c[1] > c[3] and c[1] < 0.7 and d.shadow.shown and d.shadow.w == 1 and d.shadow.color[1] < c[1]) then print("FAIL Default: Blizzard divider is a 2 px gold-brown line with a darker 1 px shadow") end
    for _, key in ipairs({ "midnight", "nitro", "cowfee" }) do
      CRT.db.ui.theme, CRT.db.ui.modern = key, true CRT:UseTheme(key) UI:ApplyStyle()
      if not (d.line.w == 1 and not d.shadow.shown and near(d.line.color, CRT.THEMES[key].border)) then print("FAIL " .. key .. " divider is 1 px in the edge colour") end
    end
    CRT.db.ui.theme, CRT.db.ui.modern = "blizzard", false CRT:UseTheme("blizzard") UI:ApplyStyle()
    if d.line.w ~= 2 then print("FAIL the divider repaints back to Blizzard") end
    print("divider checked")
  end
end
-- Minimize: this check was removed on the alerts branch before main gained UI:SetMinimized (2026-10-15);
-- the minimize session should restore it here.
-- Fade out over 2 seconds.
do
  local target = mock("Frame") rawset(target, "alpha", 1)
  rawset(target, "GetAlpha", function(self) return rawget(self, "alpha") end)
  local done = false
  local before = #frames
  UI.FadeOut(target, 2, function() done = true end)
  local driver = frames[#frames]
  driver.OnUpdate(driver, 1)
  local mid = target.alpha
  driver.OnUpdate(driver, 1.1)
  print(string.format("fade: half way alpha %.2f, done %s, end alpha %s", mid, tostring(done), tostring(target.alpha)))
  UI.CancelFade(target)
  print("shown again: alpha " .. tostring(target.alpha))
end
-- Themed backdrops outside the main window.
do
  local f2 = mock("Frame")
  rawset(f2, "SetBackdropBorderColor", function(self, r, g, b) rawset(self, "border", { r, g, b }) end)
  rawset(f2, "SetBackdropColor", function(self, r, g, b, a) rawset(self, "bg", { r, g, b, a }) end)
  UI:RegisterThemed(f2, { bg = { 0, 0, 0, 0.45 }, border = { 0.2, 0.8, 0.9 } })
  local classic = string.format("%.2f %.2f %.2f", f2.border[1], f2.border[2], f2.border[3])
  CRT.db.ui.modern = true UI:ApplyStyle()
  print(string.format("themed: classic border %s, modern border %.2f %.2f %.2f, bg alpha kept %.2f", classic, f2.border[1], f2.border[2], f2.border[3], f2.bg[4]))
  CRT.db.ui.modern = false UI:ApplyStyle()
end
-- Text size in points, and the opacity of the whole window.
CRT.db.ui.fontSize = 18 CRT:ApplyFonts()
print("18 pt: " .. fontLine("CRTFontNormal") .. "; " .. fontLine("CRTFontLarge") .. "; " .. fontLine("CRTFontSmall"))
CRT.db.ui.fontSize = 14 CRT:ApplyFonts()
CRT.db.ui.bgAlpha = 10 UI:ApplyStyle() print("opacity 10 saved: window alpha " .. tostring(f.alpha) .. " (clamped to 0.3)")
CRT.db.ui.bgAlpha = 100 UI:ApplyStyle()
local migrated = { ui = { textSize = 105 } }
-- A hidden page: no menu button until shown, then hidden again when the window closes.
do
  local b = UI.pages.devtest.button
  UI:LayoutMenu()
  print("hidden page: button shown " .. tostring(b.shown))
  UI:SelectPage("devtest") print("  opening it falls back to: " .. CRT.db.lastPage)
  UI:SetPageHidden("devtest", false) UI:SelectPage("devtest")
  print("  after /crt dev: button shown " .. tostring(b.shown) .. ", open page " .. CRT.db.lastPage)
  f.OnHide()
  print("  window closed: button shown " .. tostring(b.shown) .. ", hidden " .. tostring(UI.pages.devtest.hidden))
end
-- The saved window position keeps its relative point, and puts the window back from it.
do
  local pts = {}
  rawset(f, "GetPoint", function() return "TOPLEFT", UIParent, "BOTTOMLEFT", 300, 900 end)
  rawset(f, "SetPoint", function(self, ...) pts = { ... } end)
  UI:SaveWindowPosition()
  UI:ApplyWindowPosition()
  print("saved " .. CRT.db.window.point .. " from " .. CRT.db.window.relativePoint .. ", put back " .. tostring(pts[1]) .. " from " .. tostring(pts[3]) .. " " .. tostring(pts[4]) .. "," .. tostring(pts[5]))
end
-- The Timeline window's layer stops at Fullscreen.
CRT.db.ui.layers.timeline = "TOOLTIP"
local tl = {} for _, c in ipairs(UI:LayerChoices("timeline")) do tl[#tl + 1] = c.key end
print("timeline layer saved as Tooltip is used as " .. UI:Layer("timeline") .. "; choices " .. table.concat(tl, " "))
-- Alert layout on each side. Fonts are 20 high, so the icon is 20 + 2 + 20 = 42.
for _, fr in ipairs(frames) do if rawget(fr, "OnEvent") then pcall(fr.OnEvent, fr, "PLAYER_LOGIN") end end
UI.previews.alert(true)
local alertFrame
for _, fr in ipairs(frames) do if fr.kind == "Frame" and rawget(fr, "w") == 42 + 8 + 14 * 8 then alertFrame = fr end end
for _, side in ipairs({ "left", "right", "above", "below" }) do
  CRT.db.notes.alert.iconPosition = side
  CRT.NoteAlert:Refresh()
  -- Find the icon (a 42 x 42 texture) and the frame's size.
  local icon, size
  for _, fr in ipairs(frames) do
    if fr.kind == "Texture" and rawget(fr, "w") == 42 and rawget(fr, "h") == 42 and fr.pts[1] then icon = fr end
  end
  for _, fr in ipairs(frames) do if rawget(fr, "strata") and fr.kind == "Frame" and rawget(fr, "w") and fr ~= f and fr ~= bar then size = fr.w .. "x" .. fr.h end end
  print(side .. ": icon at " .. tostring(icon and icon.pts[1][1]) .. ", alert " .. tostring(size))
end
if failCount > 0 then print(failCount .. " failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
for (const p of ['CRT_Core/Core.lua', 'CRT_Core/UI/Panel.lua', 'CRT_Core/UI/Controls.lua', 'CRT_Core/UI/SettingsPage.lua', 'CRT_Modules/Notes/Alert.lua', 'CRT_Core/Profiles.lua', 'CRT_Core/Themes.lua', 'CRT_Core/Macros.lua', 'CRT_Core/UI/Window.lua', 'CRT_Core/UI/Tooltip.lua']) lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/' + p, 'utf8')));
if (lua.lua_pcall(L, 10, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
