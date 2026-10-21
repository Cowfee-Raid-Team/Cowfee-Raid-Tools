// The theme for harnesses that load a page or window with a stubbed CRT.UI: themeLua(where) returns Lua code that
// defines CRT_THEME(CRT, UI). It loads CRT_Core/Themes.lua into CRT (keeping any colours the harness set on CRT.PALETTE)
// and the real colour helpers from CRT_Core/UI/Panel.lua (the code between its [theme helpers] and [/theme helpers]
// markers) onto UI: UI.Color, UI.Hex, UI.ColorText, UI.GoodText, UI.WarnText, UI.BadText, UI.HeadingText and UI.ThemedText. UI.Tint
// and UI:OnTheme are small stand-ins with the same behaviour. UI.SwitchTheme(key) stands in for UI:SetTheme: it refills
// CRT.PALETTE and repaints tinted parts, themed texts and the hooks, so a harness can check a module follows a live switch.
// run_themes.js tests the real UI:SetTheme.
// Usage, in a harness: const themeLua = require('./theme_stub'); put themeLua(where) before the Lua source, then call
// CRT_THEME(CRT, CRT.UI) before loading the module files. where is the addon folder, a file in it, or a list of files
// (the harness's arguments): the folder holding CRT_Core/Themes.lua is found from them.
const fs = require('fs');
const path = require('path');

function findRoot(where) {
  for (const p of [].concat(where)) {
    let d = path.resolve(p);
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(d, 'CRT_Core', 'Themes.lua'))) return d;
      d = path.dirname(d);
    }
  }
  throw new Error('theme_stub: no CRT_Core/Themes.lua above ' + [].concat(where).join(', '));
}

// The helper block of CRT_Core/UI/Panel.lua, between its markers.
function helperBlock(root) {
  const panel = fs.readFileSync(path.join(root, 'CRT_Core/UI/Panel.lua'), 'utf8');
  const start = panel.indexOf('-- [theme helpers]');
  const end = panel.indexOf('-- [/theme helpers]');
  if (start < 0 || end < start) throw new Error('theme_stub: the [theme helpers] markers are missing from Panel.lua');
  return panel.slice(panel.indexOf('\n', start) + 1, end);
}

module.exports = function themeLua(where) {
  const root = findRoot(where);
  const src = fs.readFileSync(path.join(root, 'CRT_Core/Themes.lua'), 'utf8');
  const helpers = helperBlock(root);
  for (const s of [src, helpers]) if (s.includes(']====]')) throw new Error('theme_stub: a source holds the long-string closer');
  return `
function CRT_THEME(CRT, UI)
  UI = UI or {} -- a harness with no CRT.UI yet takes the palette only
  local own = CRT.PALETTE
  assert(load([====[${src}]====], "Themes.lua"))("CowfeeRaidTools", CRT)
  for k, v in pairs(own or {}) do
    local m = CRT.PALETTE[k]
    if m then m[1], m[2], m[3] = v[1], v[2], v[3] else CRT.PALETTE[k] = v end
  end
  local tinted, hooks = {}, {}
  local themedTexts = {}
  -- Panel.lua's helpers, run with its upvalues: UI, CRT and themedTexts
  assert(load("local UI, CRT, themedTexts = ... " .. [====[${helpers}]====], "Panel.lua theme helpers"))(UI, CRT, themedTexts)
  local function paint(region, method, t)
    local c = CRT.PALETTE[t.key]
    if c and region[method] then region[method](region, c[1], c[2], c[3], t.alpha or 1) end
  end
  function UI.Tint(region, method, key, alpha)
    tinted[region] = tinted[region] or {}
    local t = { key = key, alpha = alpha }
    tinted[region][method] = t
    paint(region, method, t)
  end
  function UI.OnTheme(_, fn) hooks[#hooks + 1] = fn end
  function UI.SwitchTheme(key)
    CRT:UseTheme(key)
    CRT.db = CRT.db or {}
    CRT.db.ui = CRT.db.ui or {}
    CRT.db.ui.theme, CRT.db.ui.modern = key, CRT:ThemeInfo(key).modern
    for region, list in pairs(tinted) do for method, t in pairs(list) do paint(region, method, t) end end
    for fs, build in pairs(themedTexts) do fs:SetText(build()) end
    for _, fn in ipairs(hooks) do fn() end
  end
end
`;
};
