// CRT_Core/UI/Panel.lua's UI:SkinCheckButton: the Modern checkbox (a walnut box with a white tick when
// ticked, roast with a mocha edge when not) over a UICheckButtonTemplate stand-in, the look switch,
// SkinTree finding checkboxes on a page and in a window, and CRT.MOCHA's walnut colours from Core.lua.
// Usage: node run_checkbox.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local panelSrc, controlsSrc, mochaSrc = ...
local unpack = unpack or table.unpack -- the harness runs Lua 5.3
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function near(c, want) return c ~= nil and math.abs(c[1] - want[1]) < 0.003 and math.abs(c[2] - want[2]) < 0.003 and math.abs(c[3] - want[3]) < 0.003 end
local function hex(h) return { tonumber(h:sub(1, 2), 16) / 255, tonumber(h:sub(3, 4), 16) / 255, tonumber(h:sub(5, 6), 16) / 255 } end

-- a texture that remembers its colour, alpha and whether it shows
local function texture(owner, layer)
  local t = { shown = true, alpha = 1, layer = layer }
  local m = {
    SetColorTexture = function(self, r, g, b, a) self.rgb = { r, g, b } self.a = a or 1 end,
    SetVertexColor = function(self, r, g, b, a) self.rgb = { r, g, b } self.a = a or 1 end,
    SetTexture = function(self, file) self.file = file end,
    SetAlpha = function(self, a) self.alpha = a end,
    Show = function(self) self.shown = true end, Hide = function(self) self.shown = false end,
    SetShown = function(self, v) self.shown = v and true or false end, IsShown = function(self) return self.shown end,
    -- as a font string
    SetText = function(self, text) self.text = text end,
    SetTextColor = function(self, r, g, b) self.rgb = { r, g, b } end,
    GetFont = function() return "f", 14, "" end,
    GetUnboundedStringWidth = function(self) return #(self.text or "") * 7 end,
  }
  if owner then owner.textures[#owner.textures + 1] = t end
  return setmetatable(t, { __index = function(_, k) return m[k] or function() end end })
end
-- a stand-in frame; a CheckButton made from UICheckButtonTemplate has the template's five textures
local function frame(kind, parent, template)
  local f = { kind = kind, children = {}, textures = {}, scripts = {}, shown = true, enabled = true, checked = false }
  local m = {
    GetObjectType = function(self) return self.kind end,
    GetChildren = function(self) return unpack(self.children) end,
    GetRegions = function(self) return unpack(self.textures) end,
    CreateTexture = function(self, _, layer) return texture(self, layer) end,
    CreateFontString = function() return texture(nil) end,
    SetScript = function(self, k, fn) self.scripts[k] = fn end,
    GetScript = function(self, k) return self.scripts[k] end,
    HookScript = function(self, k, fn) local old = self.scripts[k] self.scripts[k] = function(...) if old then old(...) end fn(...) end end,
    Show = function(self) self.shown = true if self.scripts.OnShow then self.scripts.OnShow(self) end end,
    Hide = function(self) self.shown = false end,
    IsShown = function(self) return self.shown end,
    SetTextColor = function(self, r, g, b) self.textRGB = { r, g, b } end,
  }
  if kind == "CheckButton" then
    m.SetChecked = function(self, on) self.checked = on and true or false end
    m.GetChecked = function(self) return self.checked end
    m.SetEnabled = function(self, on) self.enabled = on and true or false end
    m.Enable = function(self) self.enabled = true end
    m.Disable = function(self) self.enabled = false end
    m.IsEnabled = function(self) return self.enabled end
    -- the game toggles the tick, then runs OnClick and PostClick
    m.Click = function(self) if not self.enabled then return end self.checked = not self.checked
      if self.scripts.OnClick then self.scripts.OnClick(self, "LeftButton") end
      if self.scripts.PostClick then self.scripts.PostClick(self, "LeftButton") end end
    local art = {}
    if template == "UICheckButtonTemplate" then
      for _, key in ipairs({ "Normal", "Pushed", "Highlight", "Checked", "DisabledChecked" }) do art[key] = texture(nil) end
      f.Text = texture(nil)
    elseif template == "UIRadioButtonTemplate" then
      for _, key in ipairs({ "Normal", "Highlight", "Checked" }) do art[key] = texture(nil) end
    end
    f.art = art
    for _, key in ipairs({ "Normal", "Pushed", "Highlight", "Checked", "DisabledChecked", "Disabled" }) do
      m["Get" .. key .. "Texture"] = function() return art[key] end
    end
  end
  if template == "BasicFrameTemplateWithInset" then f.CloseButton = frame("Button", nil) end
  -- other methods do nothing; the keys SkinTree reads to spot a template are only there when set
  local fields = { Left = true, Middle = true, Right = true, Background = true, Arrow = true, SetupMenu = true, Inset = true }
  setmetatable(f, { __index = function(_, k) return m[k] or (type(k) == "string" and not fields[k] and k:find("^%u") and function() end) or nil end })
  if parent and parent.children then parent.children[#parent.children + 1] = f end
  return f
end
CreateFrame = function(kind, name, parent, template) return frame(kind, parent, template) end
-- the game's slider, which a Modern slider hides
MinimalSliderWithSteppersMixin = { Label = { Left = 1, Right = 2 }, Event = { OnValueChanged = 1, OnInteractStart = 2, OnInteractEnd = 3 } }
CreateMinimalSliderFormatter = function(_, fn) return fn end
-- hooksecurefunc(table, name, hook): the hook runs after the method
hooksecurefunc = function(t, name, hook)
  local old = t[name]
  rawset(t, name, function(...) local r = { old(...) } hook(...) return unpack(r) end)
end

local CRT = { db = { ui = { modern = false, layers = {} } } }
assert(load(mochaSrc, "Core.lua (CRT.MOCHA)"))(CRT)
assert(load(panelSrc, "Panel.lua"))("CowfeeRaidTools", CRT)
assert(load(controlsSrc, "Controls.lua"))("CowfeeRaidTools", CRT)
local UI = CRT.UI
local M = CRT.MOCHA
local function look(modern)
  CRT.db.ui.modern = modern
  for _, c in ipairs(UI.skinned) do c.crtSkin(modern) end
end

-- CRT.MOCHA's walnut colours, shared by the slider knob and the checkbox
check(near(M.walnut, hex("4a3424")), "MOCHA.walnut is #4a3424")
check(near(M.walnutEdge, hex("1a120c")), "MOCHA.walnutEdge is #1a120c")
check(near(M.walnutShine, hex("7a5a3e")), "MOCHA.walnutShine is #7a5a3e")
check(near(M.walnutText, { 1, 1, 1 }), "MOCHA.walnutText is white")
check(near(M.tick, { 1, 1, 1 }), "MOCHA.tick is white")
print("ok checkbox: the walnut colours are in CRT.MOCHA")

-- A checkbox skinned in Classic keeps the game's art and draws nothing of its own.
local page = frame("Frame", nil)
local cb = CreateFrame("CheckButton", nil, page, "UICheckButtonTemplate")
check(type(UI.SkinCheckButton) == "function", "UI:SkinCheckButton exists")
if not UI.SkinCheckButton then print(passes .. " passed, " .. fails .. " failed") error("no SkinCheckButton") end
local before = #UI.skinned
UI:SkinCheckButton(cb)
check(#UI.skinned == before + 1 and UI.skinned[#UI.skinned] == cb, "the checkbox follows the look button (UI.skinned)")
UI:SkinCheckButton(cb)
check(#UI.skinned == before + 1, "skinning twice adds it once")
local s = cb.crtCheck
check(s ~= nil, "the skin's parts are kept on cb.crtCheck")
local function artAlpha() local a = {} for k, t in pairs(cb.art) do a[#a + 1] = t.alpha end return a end
local function allArt(v) for _, t in pairs(cb.art) do if t.alpha ~= v then return false end end return true end
local function anyShown(list) for _, t in ipairs(list) do if t.shown then return true end end return false end
check(allArt(1), "Classic: the template's art shows")
check(not anyShown(s.textures), "Classic: the Modern box is hidden")

-- Modern, unticked: the art is hidden; a roast box with a mocha edge, no tick, no highlight.
look(true)
check(allArt(0), "Modern: every piece of the template's art is hidden")
check(s.box.edge.corners[1].shown and s.box.face.fills[1].shown, "Modern: the box shows")
check(near(s.box.face.fills[1].rgb, M.roast) and near(s.box.face.corners[1].rgb, M.roast), "unticked: a roast fill")
check(near(s.box.edge.fills[1].rgb, M.mocha), "unticked: a mocha edge")
check(not s.tick.shown and not s.shine.shown, "unticked: no tick, no highlight")
-- 16 px with corners of about 4 px
check(s.size == 16 and s.radius == 4, "a 16 px box with 4 px corners")

-- SetChecked from a page's refresh: walnut, a dark edge, the top highlight and a white tick.
cb:SetChecked(true)
check(near(s.box.face.fills[1].rgb, M.walnut), "ticked: a walnut fill")
check(near(s.box.edge.fills[1].rgb, M.walnutEdge), "ticked: a dark walnut edge")
check(s.shine.shown and near(s.shine.rgb, M.walnutShine), "ticked: a soft highlight inside the top edge")
check(s.tick.shown and near(s.tick.rgb, M.tick), "ticked: a MOCHA.tick (white) tick")
check(type(s.tick.file) == "string" and s.tick.file:find("CRT_Media\\\\Media\\\\Check$") ~= nil, "the tick is CRT_Media/Media/Check.tga: " .. tostring(s.tick.file))
cb:SetChecked(false)
check(not s.tick.shown and near(s.box.face.fills[1].rgb, M.roast), "unticked again by SetChecked")

-- A click toggles it, and the page's own OnClick still runs.
local saved
cb:SetScript("OnClick", function(self) saved = self:GetChecked() end)
cb:Click()
check(saved == true and s.tick.shown, "a click ticks it and the page's OnClick saves it")
cb:Click()
check(saved == false and not s.tick.shown, "a second click unticks it")

-- Hover brightens the edge; leaving puts it back.
cb.scripts.OnEnter(cb)
check(near(s.box.edge.fills[1].rgb, M.caramel), "hover: a caramel edge")
cb.scripts.OnLeave(cb)
check(near(s.box.edge.fills[1].rgb, M.mocha), "leave: the mocha edge again")

-- Disabled: the box at about 40%, ticked or not; enabled again, solid.
cb:SetChecked(true)
cb:SetEnabled(false)
check(s.box.face.fills[1].a == 0.4 and s.tick.a == 0.4, "disabled: the box and tick at 40%")
cb.scripts.OnEnter(cb)
check(near(s.box.edge.fills[1].rgb, M.walnutEdge), "hover on a disabled box leaves its edge alone")
cb.scripts.OnLeave(cb)
cb:Click()
check(cb:GetChecked() == true, "a disabled box ignores clicks")
cb:Enable()
check(s.box.face.fills[1].a == 1 and s.tick.a == 1, "enabled again: solid")
cb:Disable()
check(s.box.edge.fills[1].a == 0.4, "Disable() fades it too")
cb:Enable()
print("ok checkbox: unticked, ticked, hover and disabled")

-- Back to Classic, live: the game's art again and the box hidden; a tick set in Classic shows in Modern.
look(false)
check(allArt(1) and not anyShown(s.textures), "Classic again: the game's art, no box")
cb:SetChecked(false)
look(true)
check(not s.tick.shown and near(s.box.face.fills[1].rgb, M.roast), "back to Modern: the state set in Classic")
print("ok checkbox: the look button switches it live")

-- SkinTree: a page's checkboxes are skinned, nested ones too; a radio button is left alone.
local page2 = frame("Frame", nil)
local row = frame("Frame", page2)
local c1 = CreateFrame("CheckButton", nil, page2, "UICheckButtonTemplate")
local c2 = CreateFrame("CheckButton", nil, row, "UICheckButtonTemplate")
local radio = CreateFrame("CheckButton", nil, page2, "UIRadioButtonTemplate")
UI:SkinTree(page2)
check(c1.crtSkin and c1.crtCheck and c2.crtSkin and c2.crtCheck, "SkinTree skins a page's checkboxes, nested ones too")
check(radio.crtSkin == nil, "SkinTree leaves a radio button alone")
check(c1.art.Normal.alpha == 0, "a checkbox SkinTree finds in Modern is Modern at once")

-- A window (UI:StyleWindow) skins its checkboxes, and ones added before it shows.
local win = CreateFrame("Frame", nil, nil, "BasicFrameTemplateWithInset")
UI:StyleWindow(win)
local wc = CreateFrame("CheckButton", nil, win, "UICheckButtonTemplate")
win:Show()
check(wc.crtCheck ~= nil and wc.art.Checked.alpha == 0, "a window's checkbox is skinned when it shows")
print("ok checkbox: SkinTree finds checkboxes on a page and in a window")

-- The Modern slider knob: bevelled walnut with white text.
local value = 5
local slider = UI.Slider(frame("Frame", nil), "Count", { min = 1, max = 10, get = function() return value end, set = function(v) value = v end })
local k = slider.modern
check(k ~= nil, "a slider made in Modern has its knob")
check(near(k.face.fills[1].rgb, M.walnut) and near(k.face.corners[1].rgb, M.walnut), "the knob is walnut")
check(near(k.edge.fills[1].rgb, M.walnutEdge), "the knob has a dark walnut edge")
check(k.shine ~= nil and near(k.shine.rgb, M.walnutShine), "the knob has a soft highlight inside its top edge")
check(near(k.text.rgb, M.walnutText), "the knob's value is MOCHA.walnutText (white)")
check(near(k.edit.textRGB, M.walnutText), "the number box's text is MOCHA.walnutText")
print("ok checkbox: the slider knob is bevelled walnut with white text")

-- UI.PaintShape(shape, key, alpha): a MOCHA key at an alpha
local shape = UI.RoundRect(frame("Frame", nil), {}, "ARTWORK", 0, 4, 0)
UI.PaintShape(shape, "walnut", 0.4)
check(near(shape.fills[1].rgb, M.walnut) and shape.fills[1].a == 0.4 and shape.corners[1].a == 0.4, "PaintShape takes an alpha")
UI.PaintShape(shape, "walnut")
check(shape.fills[1].a == 1, "PaintShape without an alpha is solid")

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error(fails .. " checkbox checks failed") end
`;
const root = process.argv[2];
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
// CRT.MOCHA's table from Core.lua, run on its own (the rest of Core.lua needs the game)
const core = read('CRT_Core/Core.lua');
const mocha = core.match(/CRT\.MOCHA = \{[\s\S]*?\n\}/);
if (!mocha) { console.error('LUA ERROR: CRT.MOCHA not found in Core.lua'); process.exit(1); }
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(read('CRT_Core/UI/Panel.lua')));
lua.lua_pushstring(L, to_luastring(read('CRT_Core/UI/Controls.lua')));
lua.lua_pushstring(L, to_luastring('local CRT = ...\n' + mocha[0]));
if (lua.lua_pcall(L, 3, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
