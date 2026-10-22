// CRT_Core/UI/Panel.lua's UI.Help: in Classic the game's gold "i" (MainHelpPlateButton's three textures,
// scaled), in Modern an accent ring that fills accent under the mouse with a background-coloured "i"; the look
// switch swaps them live, a theme switch repaints the Modern colours, the tooltip is unchanged and the
// hit box is the same size in both looks.
// Usage: node run_help.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local panelSrc, mochaSrc, tooltipSrc = ...
local unpack = unpack or table.unpack -- the harness runs Lua 5.3
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function near(c, want) return c ~= nil and want ~= nil and math.abs(c[1] - want[1]) < 0.003 and math.abs(c[2] - want[2]) < 0.003 and math.abs(c[3] - want[3]) < 0.003 end

-- a texture or font string that remembers what it was given
local function region(owner, layer)
  local t = { shown = true, alpha = 1, layer = layer }
  local m = {
    SetColorTexture = function(self, r, g, b, a) self.rgb = { r, g, b } self.a = a or 1 end,
    SetVertexColor = function(self, r, g, b, a) self.rgb = { r, g, b } self.a = a or 1 end,
    SetTexture = function(self, file) self.file = file end,
    SetBlendMode = function(self, mode) self.blend = mode end,
    SetSize = function(self, w, h) self.w, self.h = w, h end,
    SetPoint = function(self, p, rel, rp, x, y) self.point = { p, rel, rp, x, y } end,
    SetAlpha = function(self, a) self.alpha = a end,
    Show = function(self) self.shown = true end, Hide = function(self) self.shown = false end,
    SetShown = function(self, v) self.shown = v and true or false end, IsShown = function(self) return self.shown end,
    SetText = function(self, text) self.text = text end,
    GetText = function(self) return rawget(self, "text") end,
    SetFont = function(self, file, size, flags) self.font = { file, size, flags } end,
    SetTextColor = function(self, r, g, b) self.textRGB = { r, g, b } end,
    -- a font string's text is 7 px a character, and its box fits the text unless given a width
    GetObjectType = function(self) return rawget(self, "kind") or "Texture" end,
    GetParent = function(self) return self.owner end,
    GetStringWidth = function(self) return #(rawget(self, "text") or "") * 7 end,
    SetWidth = function(self, w) self.boxW = w end,
    GetWidth = function(self) return rawget(self, "boxW") or #(rawget(self, "text") or "") * 7 end,
    SetJustifyH = function(self, j) self.justify = j end,
    GetJustifyH = function(self) return rawget(self, "justify") or "CENTER" end,
    ClearAllPoints = function(self) self.point = nil end,
  }
  t.owner = owner
  if owner then owner.regions[#owner.regions + 1] = t end
  return setmetatable(t, { __index = function(_, k) return m[k] or function() end end })
end
local function frame(kind, parent)
  local f = { kind = kind, children = {}, regions = {}, scripts = {}, shown = true, parent = parent }
  local m = {
    GetObjectType = function(self) return self.kind end,
    GetChildren = function(self) return unpack(self.children) end,
    CreateTexture = function(self, _, layer) return region(self, layer) end,
    CreateFontString = function(self, _, layer) local fs = region(self, layer) fs.kind = "FontString" return fs end,
    SetPoint = function(self, p, rel, rp, x, y) self.point = { p, rel, rp, x, y } end,
    ClearAllPoints = function(self) self.point = nil end,
    GetParent = function(self) return self.parent end,
    SetSize = function(self, w, h) self.w, self.h = w, h end,
    GetSize = function(self) return self.w, self.h end,
    SetScript = function(self, k, fn) self.scripts[k] = fn end,
    GetScript = function(self, k) return self.scripts[k] end,
    Show = function(self) self.shown = true end, Hide = function(self) self.shown = false end,
    IsShown = function(self) return self.shown end,
  }
  setmetatable(f, { __index = function(_, k) return m[k] or (type(k) == "string" and k:find("^%u") and function() end) or nil end })
  if parent and parent.children then parent.children[#parent.children + 1] = f end
  return f
end
CreateFrame = function(kind, name, parent) return frame(kind, parent) end
hooksecurefunc = function(t, name, hook)
  local old = t[name]
  rawset(t, name, function(...) old(...) hook(...) end)
end
local tip = { lines = {} }
GameTooltip = {
  SetOwner = function(self, owner, anchor) self.owner, self.anchor = owner, anchor self.lines = {} end,
  SetText = function(self, text) self.title = text end,
  AddLine = function(self, text, r, g, b, wrap) self.lines[#self.lines + 1] = text end,
  Show = function(self) self.shown = true end, Hide = function(self) self.shown = false end,
}

local CRT = { db = { ui = { modern = false, theme = "blizzard", layers = {} } } }
assert(load(mochaSrc, "Themes.lua"))("CowfeeRaidTools", CRT)
CRT:UseTheme("cowfee")
assert(load(panelSrc, "Panel.lua"))("CowfeeRaidTools", CRT)
assert(load(tooltipSrc, "Tooltip.lua"))("CowfeeRaidTools", CRT)
local UI = CRT.UI
local M = CRT.PALETTE
local function look(modern)
  CRT.db.ui.modern = modern
  for _, c in ipairs(UI.skinned) do c.crtSkin(modern) end
end

-- Classic: the Appearances tab's "i" (Blizzard_HelpPlate.xml, MainHelpPlateButton), scaled to the hit box
local page = frame("Frame", nil)
local before = #UI.skinned
local b = UI.Help(page, "Title", "First paragraph.\\n\\nSecond paragraph.")
local h = b.crtHelp
check(h ~= nil, "the parts are kept on b.crtHelp")
if not h then print(passes .. " passed, " .. fails .. " failed") error("no crtHelp") end
check(#UI.skinned == before + 1 and UI.skinned[#UI.skinned] == b, "the icon follows the look switch (UI.skinned)")
check(b.w == 20 and b.h == 20 and UI.HELP_SIZE == 20, "a 20 px hit box: " .. tostring(b.w) .. "x" .. tostring(b.h))
check(h.i.file == "Interface\\\\common\\\\help-i", "Classic: the \\"i\\" is Interface\\\\common\\\\help-i: " .. tostring(h.i.file))
check(h.ring.file == "Interface\\\\Minimap\\\\MiniMap-TrackingBorder", "Classic: the ring is MiniMap-TrackingBorder: " .. tostring(h.ring.file))
check(h.glow.file == "Interface\\\\Minimap\\\\UI-Minimap-ZoomButton-Highlight", "Classic: the glow is UI-Minimap-ZoomButton-Highlight: " .. tostring(h.glow.file))
check(h.glow.layer == "HIGHLIGHT" and h.glow.blend == "ADD", "the glow shows under the mouse, added on")
check(h.i.w == 23 and h.ring.w == 32 and h.glow.w == 23, "the template's sizes (46, 64, 46) at half")
check(h.ring.point[4] == 6 and h.ring.point[5] == -6.5, "the ring keeps the template's +12/-13 offset, scaled")
check(h.glow.point[4] == -0.5 and h.glow.point[5] == 0.5, "the glow keeps the template's -1/+1 offset, scaled")
check(h.i.shown and h.ring.shown and h.glow.alpha == 1, "Classic: the gold \\"i\\", its ring and glow show")
check(not h.circle.shown and not h.fill.shown and not h.letter.shown, "Classic: the Modern ring is hidden")
print("ok help: Classic is the game's gold \\"i\\"")

-- the tooltip is unchanged: the title, then one line per paragraph
b.scripts.OnEnter(b)
check(GameTooltip.owner == b and GameTooltip.anchor == "ANCHOR_RIGHT" and GameTooltip.title == "Title", "the tooltip has the title, beside the icon")
check(#GameTooltip.lines == 2 and GameTooltip.lines[2] == "Second paragraph.", "one tooltip line per paragraph")
b.scripts.OnLeave(b)
check(not GameTooltip.shown, "leaving hides the tooltip")
local n = 0
local live = UI.Help(page, "Live", function() n = n + 1 return "Count " .. n end)
live.scripts.OnEnter(live)
live.scripts.OnLeave(live)
live.scripts.OnEnter(live)
check(GameTooltip.lines[1] == "Count 2", "a function's text is read each time")
live.scripts.OnLeave(live)
print("ok help: the tooltip is unchanged")

-- Tooltip position (CRT_Core/UI/Tooltip.lua; run_tooltip_spots.js tests every spot, mode and area): a (?)
-- opens on its own side (ANCHOR_RIGHT) by default, on a picked spot when there is one; on the game's tooltip spot (GameTooltip_SetDefaultAnchor,
-- which sets the owner with ANCHOR_NONE and places it) when picked
local defaults = {}
GameTooltip_SetDefaultAnchor = function(t, owner) defaults[#defaults + 1] = { t, owner } t:SetOwner(owner, "ANCHOR_NONE") end
check(UI.TooltipPosition() == "spot", "Tooltip position: next to what you hover when nothing is saved")
b.scripts.OnEnter(b)
check(#defaults == 0 and GameTooltip.owner == b and GameTooltip.anchor == "ANCHOR_RIGHT", "a (?) on auto, the default: its own side, right of the icon")
b.scripts.OnLeave(b)
CRT.db.ui.tooltipMode, CRT.db.ui.tooltipSpot = "spot", "bottom"
b.scripts.OnEnter(b)
check(#defaults == 0 and GameTooltip.anchor == "ANCHOR_BOTTOM", "a (?) on the Bottom spot: under the icon")
b.scripts.OnLeave(b)
CRT.db.ui.tooltipMode = "game"
b.scripts.OnEnter(b)
check(#defaults == 1 and defaults[1][1] == GameTooltip and defaults[1][2] == b, "a (?) on the game's tooltip spot: GameTooltip_SetDefaultAnchor(GameTooltip, icon)")
check(GameTooltip.anchor == "ANCHOR_NONE" and GameTooltip.title == "Title", "the game's spot: placed by the game, the same text")
b.scripts.OnLeave(b)
GameTooltip_SetDefaultAnchor = nil
CRT.db.ui.tooltipMode, CRT.db.ui.tooltipSpot = nil, nil
print("ok help: the (?) follows Tooltip position")

-- Modern: an accent ring round an accent "i", the same hit box
look(true)
check(not h.i.shown and not h.ring.shown and h.glow.alpha == 0, "Modern: the gold \\"i\\", ring and glow are hidden")
check(h.circle.shown and h.letter.shown and not h.fill.shown, "Modern: the ring and its \\"i\\" show, unfilled")
check(type(h.circle.file) == "string" and h.circle.file:find("CRT_Media\\\\Media\\\\Ring") ~= nil, "the ring is a CRT ring texture: " .. tostring(h.circle.file))
check(type(h.fill.file) == "string" and h.fill.file:find("CRT_Media\\\\Media\\\\Disc$") ~= nil, "the fill is CRT_Media/Media/Disc.tga: " .. tostring(h.fill.file))
check(h.circle.w == 16 and h.fill.w == 16, "a 16 px ring")
check(near(h.circle.rgb, M.accent) and near(h.letter.textRGB, M.accent), "an accent ring and \\"i\\"")
check(h.letter.text == "i" and h.letter.font ~= nil, "the \\"i\\" has its own font")
check(b.w == 20 and b.h == 20, "the hit box is unchanged by the look")
b.scripts.OnEnter(b)
check(h.fill.shown and near(h.fill.rgb, M.accent), "hover: it fills accent")
check(near(h.letter.textRGB, M.background), "hover: the \\"i\\" turns background")
b.scripts.OnLeave(b)
check(not h.fill.shown and near(h.letter.textRGB, M.accent), "leave: the ring again")
print("ok help: Modern is an accent ring that fills on hover")

-- a theme switch repaints the Modern colours
local cowfee = { M.accent[1], M.accent[2], M.accent[3] }
CRT:UseTheme("nitro")
check(not near(CRT.PALETTE.accent, cowfee), "the test themes have different accents")
UI:RepaintTheme()
check(near(h.circle.rgb, CRT.PALETTE.accent) and near(h.letter.textRGB, CRT.PALETTE.accent), "another theme: its accent")
b.scripts.OnEnter(b)
check(near(h.fill.rgb, CRT.PALETTE.accent) and near(h.letter.textRGB, CRT.PALETTE.background), "another theme: its hover colours")
b.scripts.OnLeave(b)
CRT:UseTheme("cowfee")
UI:RepaintTheme()

-- back to Classic, live
look(false)
check(h.i.shown and h.ring.shown and h.glow.alpha == 1 and not h.circle.shown and not h.letter.shown, "Classic again: the gold \\"i\\"")
b.scripts.OnEnter(b)
check(not h.fill.shown, "Classic hover: no accent fill")
b.scripts.OnLeave(b)
-- one made in Modern is Modern at once
look(true)
local m2 = UI.Help(page, "Made in Modern", "x")
check(m2.crtHelp.circle.shown and not m2.crtHelp.i.shown, "an icon made in Modern is Modern at once")
print("ok help: the look switch swaps them live")
look(false)

-- UI.HelpRight: the (?) sits UI.HELP_GAP right of what it explains, centred on it
local G = UI.HELP_GAP
check(type(UI.HelpRight) == "function" and type(G) == "number" and G > 0, "UI.HelpRight and a named gap, UI.HELP_GAP")
if type(UI.HelpRight) ~= "function" then print(passes .. " passed, " .. fails .. " failed") error("no UI.HelpRight") end
local function at(b, p, rel, rp, x) local q = b.point return q ~= nil and q[1] == p and q[2] == rel and q[3] == rp and math.abs((q[4] or 0) - x) < 0.01 and (q[5] or 0) == 0 end
local function where(b) local q = b.point or {} return tostring(q[1]) .. " " .. tostring(q[3]) .. " " .. tostring(q[4]) .. " " .. tostring(q[5]) end
-- a frame (a control, or a whole Edit Mode row): its right edge
local row = frame("Frame", page)
local hr = UI.HelpRight(row, "Row", "x")
check(at(hr, "LEFT", row, "RIGHT", G), "a frame: LEFT on its RIGHT, HELP_GAP across: " .. where(hr))
check(hr.parent == page, "by default the icon's parent is the target's parent")
check(hr.crtHelpTarget == row and not hr.crtHelpText, "the icon keeps its target")
check(hr.crtHelp ~= nil and UI.skinned[#UI.skinned] == hr, "it is a UI.Help icon, following the look")
local other = frame("Frame", nil)
check(UI.HelpRight(row, "Row", "x", { parent = other }).parent == other, "opts.parent sets the parent")
-- a font string: the right edge of its text, not of its box
local heading = page:CreateFontString(nil, "OVERLAY")
heading:SetText("Heading")
local hh = UI.HelpRight(heading, "Heading", "x")
check(hh.parent == page and hh.crtHelpText == heading, "a font string: the icon follows its text")
check(at(hh, "LEFT", heading, "CENTER", 49 / 2 + G), "a centred font string that fits its text: just after the text: " .. where(hh))
local label = page:CreateFontString(nil, "OVERLAY")
label:SetJustifyH("LEFT")
label:SetWidth(140)
label:SetText("Label")
local hl = UI.HelpRight(label, "Label", "x")
check(at(hl, "LEFT", label, "LEFT", 35 + G), "a left-justified label in a 140 px box: after its text, not after the box: " .. where(hl))
label:SetText("A longer label")
check(at(hl, "LEFT", label, "LEFT", 98 + G), "new text moves the icon: " .. where(hl))
label:SetText("A label much longer than its own box is")
check(at(hl, "LEFT", label, "LEFT", 140 + G), "text wider than the box: after the box: " .. where(hl))
local right = page:CreateFontString(nil, "OVERLAY")
right:SetJustifyH("RIGHT")
right:SetWidth(200)
right:SetText("Right")
local hrt = UI.HelpRight(right, "Right", "x")
check(at(hrt, "LEFT", right, "RIGHT", G), "a right-justified font string: its right edge: " .. where(hrt))
label:SetText("Label")
hl.point = nil
hl.scripts.OnShow(hl)
check(at(hl, "LEFT", label, "LEFT", 35 + G), "showing the icon places it again")
-- a check button: after its label's text
local box = frame("CheckButton", page)
box.label = box:CreateFontString(nil, "OVERLAY")
box.label:SetJustifyH("LEFT")
box.label:SetText("Tick me")
local hc = UI.HelpRight(box, "Tick", "x")
check(hc.crtHelpTarget == box and hc.crtHelpText == box.label and hc.parent == page, "a check button: the icon follows its label, beside the box")
check(at(hc, "LEFT", box.label, "LEFT", 49 + G), "a check button: after its label's text: " .. where(hc))
local tmpl = frame("CheckButton", page)
tmpl.Text = tmpl:CreateFontString(nil, "OVERLAY")
tmpl.Text:SetText("Template")
check(UI.HelpRight(tmpl, "Template", "x").crtHelpText == tmpl.Text, "a UICheckButtonTemplate's .Text is its label")
local emptyText = frame("CheckButton", page)
emptyText.Text = emptyText:CreateFontString(nil, "OVERLAY")
check(at(UI.HelpRight(emptyText, "Empty", "x"), "LEFT", emptyText, "RIGHT", G), "a template's empty .Text (the page drew its own label elsewhere) is not followed")
local direct = UI.HelpRight(box.label, "Label", "x")
check(direct.parent == page, "a check box's label as the target: the icon is beside the check box, not inside it")
box.label:SetText("Tick me, longer")
check(at(direct, "LEFT", box.label, "LEFT", 105 + G) and at(hc, "LEFT", box.label, "LEFT", 105 + G), "both icons on one label follow its new text")
local bare = frame("CheckButton", page)
check(at(UI.HelpRight(bare, "Bare", "x"), "LEFT", bare, "RIGHT", G), "a check button with no label: its right edge")
print("ok help: UI.HelpRight places the icon right of a frame, a font string's text and a check box's label")

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error(fails .. " help checks failed") end
`;
const root = process.argv[2];
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// node run_help.js <addon folder> lint: every (?) in the addon is placed by UI.HelpRight, so none can
// drift left of, or far from, what it explains. It fails on
//   - UI.Help named outside CRT_Core/UI/Panel.lua, which defines both;
//   - a UI.HelpRight icon anchored again: chained (UI.HelpRight(...):SetPoint), or through the name it
//     was kept in (x = UI.HelpRight(...) ... x:SetPoint), in the same file;
//   - an icon kept in a table field (tab.unnamedHelp = UI.HelpRight(...)) and anchored again in any
//     file, through that field (t.unnamedHelp:SetPoint) or, in a file that reads the field, a local of
//     the same name (unnamedHelp:SetPoint).
// Not followed: an icon passed to a function or into a table under another name. Following values
// across files needs a Lua parser and data flow, too costly for a lint; the review catches those.
// ALLOW lists a place that truly needs its own anchor: [file, the function it is in, the line's text,
// the reason]. The function is the nearest "function name(" above the line.
const ALLOW = [
  // The Timeline's Personal notes lane: its (?) follows whichever row that lane is on as the rows
  // scroll, and stays inside the 166 px name column, so a long name never puts it over the track.
  ['CRT_Modules/Timeline/View.lua', 'Methods:DrawPersonalHelp', 'h:ClearAllPoints()', 'the personal lane (?) moves with its row'],
  ['CRT_Modules/Timeline/View.lua', 'Methods:DrawPersonalHelp', 'h:SetPoint("LEFT", l, "LEFT", math.min(NAME_X + w + gap', 'the personal lane (?) stays in the name column'],
  // The Marker editor's win.help is its Help text edit box, not a (?); the title strip's (?) is strip.help.
  ['CRT_Dev/Dev/MarkerEditor.lua', null, 'win.help:SetPoint(', 'win.help is an edit box'],
];

// the code with its comments blanked out (strings kept), so a comment can name UI.Help
function luaCode(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1); i = j + 1;
    } else if (src.startsWith('--', i)) {
      const long = src.slice(i + 2).match(/^\[(=*)\[/);
      const end = long ? src.indexOf(']' + long[1] + ']', i) + long[1].length + 2 : src.indexOf('\n', i);
      const stop = end < i ? src.length : end;
      out += src.slice(i, stop).replace(/[^\n]/g, ' '); i = stop;
    } else { out += c; i++; }
  }
  return out;
}
// the index just after the ) that closes the ( at open
function closing(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") { i++; while (i < s.length && s[i] !== c) i += s[i] === '\\' ? 2 : 1; continue; }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i + 1;
  }
  return s.length;
}
const REANCHOR = '\\s*:\\s*(SetPoint|ClearAllPoints|SetAllPoints)\\b';
const escape = (s) => s.replace(/[.[\]]/g, (c) => '\\' + c);

// sources: { [file]: text }. Returns { bad, calls }.
function lintSources(sources, allow) {
  const bad = [];
  let calls = 0;
  const parsed = {};
  for (const rel of Object.keys(sources)) {
    const raw = sources[rel];
    const src = luaCode(raw);
    const lines = raw.split('\n');
    const lineOf = (i) => src.slice(0, i).split('\n').length;
    const fnAt = (i) => { let name = null; for (const m of src.slice(0, i).matchAll(/function\s+([\w.:]+)\s*\(/g)) name = m[1]; return name; };
    const report = (i, what) => {
      const text = lines[lineOf(i) - 1].trim();
      if (allow.some(([f, fn, t]) => f === rel && (fn === null || fn === fnAt(i)) && text.includes(t))) return;
      bad.push(rel + ':' + lineOf(i) + ': ' + what + ': ' + text.slice(0, 140));
    };
    parsed[rel] = { src, report };
  }
  const fields = new Set(); // icons kept in a table field: the field's name
  for (const rel of Object.keys(parsed)) {
    const { src, report } = parsed[rel];
    if (rel !== 'CRT_Core/UI/Panel.lua') {
      for (const m of src.matchAll(/\bUI\.Help\b(?![\w])/g)) report(m.index, 'UI.Help outside Panel.lua (use UI.HelpRight)');
    }
    for (const m of src.matchAll(/\bUI\.HelpRight\s*\(/g)) {
      calls++;
      const after = closing(src, m.index + m[0].length - 1);
      if (new RegExp('^' + REANCHOR).test(src.slice(after))) report(m.index, 'a UI.HelpRight icon anchored again');
      const kept = src.slice(0, m.index).match(/([A-Za-z_][\w.]*(?:\[[^\]\n]+\])?)\s*=\s*(?:CRT\.)?$/);
      if (!kept) continue;
      for (const k of src.matchAll(new RegExp('(?<![\\w.])' + escape(kept[1]) + REANCHOR, 'g'))) {
        report(k.index, kept[1] + ' (a UI.HelpRight icon) anchored again');
      }
      const field = kept[1].match(/[.:](\w+)$/);
      if (field) fields.add(field[1]);
    }
  }
  for (const field of fields) {
    for (const rel of Object.keys(parsed)) {
      const { src, report } = parsed[rel];
      // through the field anywhere; through a bare local of its name only in a file that reads the field
      const readsField = new RegExp('[\\w\\]]\\.' + field + '(?![\\w])').test(src);
      const owner = readsField ? '(?:[\\w]+(?:\\[[^\\]\\n]+\\])?\\.)*' : '(?:[\\w]+(?:\\[[^\\]\\n]+\\])?\\.)+';
      for (const k of src.matchAll(new RegExp('(?<![\\w.])' + owner + field + REANCHOR, 'g'))) {
        report(k.index, field + ' (a UI.HelpRight icon kept in a table field) anchored again');
      }
    }
  }
  return { bad, calls };
}

if (process.argv[3] === 'lint') {
  // the lint on itself first: each rule catches what it should, and an allow entry holds only in its function
  const fixture = {
    'A.lua': [
      'local function build(f)',
      '    tab.unnamedHelp = UI.HelpRight(f, "T", "x")',
      '    local h = UI.HelpRight(f, "T", "x")',
      '    h:SetPoint("LEFT")',
      'end',
      'function Methods:Draw()',
      '    h:ClearAllPoints()',
      'end',
    ].join('\n'),
    'B.lua': [
      'local unnamedHelp = tab.unnamedHelp',
      'unnamedHelp:SetPoint("TOPLEFT", 1, 2)',
      'other.tab.unnamedHelp:ClearAllPoints()',
      'UI.HelpRight(f, "T", "x"):SetPoint("LEFT")',
      'local b = UI.Help(f, "T", "x") -- UI.Help in a comment is fine',
    ].join('\n'),
  };
  const fixAllow = [['A.lua', 'Methods:Draw', 'h:ClearAllPoints()', 'test']];
  const got = lintSources(fixture, fixAllow).bad.map((b) => b.split(': ').slice(0, 2).join(': ')); // file:line: what
  const want = ['A.lua:4: h (a UI.HelpRight icon) anchored again', 'B.lua:5: UI.Help outside Panel.lua (use UI.HelpRight)',
    'B.lua:4: a UI.HelpRight icon anchored again', 'B.lua:2: unnamedHelp (a UI.HelpRight icon kept in a table field) anchored again',
    'B.lua:3: unnamedHelp (a UI.HelpRight icon kept in a table field) anchored again'];
  const missing = want.filter((w) => !got.includes(w));
  const extra = got.filter((g) => !want.includes(g));
  // the allow entry is tied to its function: the same line elsewhere still fails
  const elsewhere = lintSources({ 'A.lua': 'local h = UI.HelpRight(f, "T", "x")\nfunction other()\n    h:ClearAllPoints()\nend' }, fixAllow).bad;
  if (missing.length || extra.length || elsewhere.length !== 1) {
    console.log('FAIL the lint on its own fixture: missing ' + JSON.stringify(missing) + ', extra ' + JSON.stringify(extra) + ', outside its function ' + elsewhere.length);
    process.exit(1);
  }
  console.log('ok the lint catches each kind of drift, and an allow entry holds only in its function');

  const sources = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['.git', '.claude', 'node_modules'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      const rel = path.relative(root, p).split(path.sep).join('/');
      if (rel === 'CRT_Dev/Tests') continue;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.lua')) sources[rel] = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    }
  };
  walk(root);
  const { bad, calls } = lintSources(sources, ALLOW);
  if (calls === 0) bad.push('no UI.HelpRight calls found: is the scan looking in the right folder?');
  if (bad.length) { console.log('FAIL a (?) placed outside UI.HelpRight:'); for (const b of bad) console.log(b); process.exit(1); }
  console.log(calls + ' UI.HelpRight calls, every (?) placed by the helper');
  console.log('all passed');
  process.exit(0);
}

// The areas reach their tooltips: every tooltip on the Loot History page passes "loothistory" and every Loot
// Master tooltip "lootmaster" to UI.TooltipOwner (or to Gear.ShowTooltip, which passes it on). Only the item
// tabs' own placements (a side of the window, the game's spot) use a flag; the Encounter Journal button keeps
// UI.TOOLTIP_KEEP.
{
  const bad = [];
  const scan = (rel, area, flagsOk) => {
    const lines = read(rel).split(/\r?\n/);
    let calls = 0;
    lines.forEach((line, i) => {
      if (!/TooltipOwner\(|Gear\.ShowTooltip\(/.test(line) || /^\s*--/.test(line)) return;
      calls++;
      const flagged = /TOOLTIP_KEEP|TOOLTIP_GAME/.test(line);
      if (flagged ? !flagsOk : !line.includes('"' + area + '"')) bad.push(rel + ':' + (i + 1) + ': ' + line.trim());
    });
    return calls;
  };
  if (scan('CRT_Modules/Loot/Page.lua', 'loothistory', false) === 0) bad.push('CRT_Modules/Loot/Page.lua: no tooltip found');
  const lmDir = path.join(root, 'CRT_Modules/LootMaster');
  let lmCalls = 0;
  for (const f of fs.readdirSync(lmDir)) if (f.endsWith('.lua')) lmCalls += scan('CRT_Modules/LootMaster/' + f, 'lootmaster', f === 'Tabs.lua');
  if (lmCalls < 6) bad.push('CRT_Modules/LootMaster: only ' + lmCalls + ' tooltips found');
  if (!/TooltipOwner\([^\n]*TOOLTIP_KEEP/.test(read('CRT_Modules/Timeline/JournalExport.lua'))) bad.push('CRT_Modules/Timeline/JournalExport.lua: the Encounter Journal button no longer keeps its anchor');
  if (bad.length) { console.log('FAIL a tooltip that does not follow its area:'); for (const b of bad) console.log(b); process.exitCode = 1; }
  else console.log('ok help: Loot History and Loot Master tooltips pass their area');
}

if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(read('CRT_Core/UI/Panel.lua')));
lua.lua_pushstring(L, to_luastring(read('CRT_Core/Themes.lua')));
lua.lua_pushstring(L, to_luastring(read('CRT_Core/UI/Tooltip.lua')));
if (lua.lua_pcall(L, 3, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
