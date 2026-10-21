// The theme for harnesses that load a page or window with a stubbed CRT.UI: themeLua(root) returns Lua code that
// defines CRT_THEME(CRT, UI). It loads CRT_Core/Themes.lua into CRT (keeping any colours the harness set on CRT.MOCHA)
// and puts the colour helpers from CRT_Core/UI/Panel.lua on UI, with the same results: UI.Color, UI.Hex,
// UI.ColorText, UI.GoodText, UI.BadText, UI.HeadingText, UI.Tint, UI.ThemedText and UI:OnTheme. UI.SwitchTheme(key)
// stands in for UI:SetTheme: it refills CRT.MOCHA and repaints tinted parts, themed texts and the hooks, so a harness
// can check a module follows a live switch. run_themes.js tests the real helpers.
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

module.exports = function themeLua(where) {
  const src = fs.readFileSync(path.join(findRoot(where), 'CRT_Core/Themes.lua'), 'utf8');
  if (src.includes(']====]')) throw new Error('theme_stub: Themes.lua holds the long-string closer');
  return `
function CRT_THEME(CRT, UI)
  local own = CRT.MOCHA
  assert(load([====[${src}]====], "Themes.lua"))("CowfeeRaidTools", CRT)
  for k, v in pairs(own or {}) do
    local m = CRT.MOCHA[k]
    if m then m[1], m[2], m[3] = v[1], v[2], v[3] else CRT.MOCHA[k] = v end
  end
  local tinted, texts, hooks = {}, {}, {}
  function UI.Color(key, alpha)
    local c = CRT.MOCHA[key] or CRT.MOCHA.cream
    return c[1], c[2], c[3], alpha or 1
  end
  function UI.Hex(key)
    local c = CRT.MOCHA[key] or CRT.MOCHA.cream
    return string.format("%02x%02x%02x", math.floor(c[1] * 255 + 0.5), math.floor(c[2] * 255 + 0.5), math.floor(c[3] * 255 + 0.5))
  end
  function UI.ColorText(text, key) return "|cff" .. UI.Hex(key) .. text .. "|r" end
  function UI.GoodText(text) return UI.ColorText(text, "matcha") end
  function UI.BadText(text) return UI.ColorText(text, "bad") end
  function UI.HeadingText(text) return UI.ColorText(text, "heading") end
  local function paint(region, method, t)
    local c = CRT.MOCHA[t.key]
    if c and region[method] then region[method](region, c[1], c[2], c[3], t.alpha or 1) end
  end
  function UI.Tint(region, method, key, alpha)
    tinted[region] = tinted[region] or {}
    local t = { key = key, alpha = alpha }
    tinted[region][method] = t
    paint(region, method, t)
  end
  function UI.ThemedText(fs, build) texts[fs] = build fs:SetText(build()) end
  function UI.OnTheme(_, fn) hooks[#hooks + 1] = fn end
  function UI.SwitchTheme(key)
    CRT:UseTheme(key)
    CRT.db = CRT.db or {}
    CRT.db.ui = CRT.db.ui or {}
    CRT.db.ui.theme, CRT.db.ui.modern = key, CRT:ThemeInfo(key).modern
    for region, list in pairs(tinted) do for method, t in pairs(list) do paint(region, method, t) end end
    for fs, build in pairs(texts) do fs:SetText(build()) end
    for _, fn in ipairs(hooks) do fn() end
  end
end
`;
};
