// The placement helper for harnesses that load a movable element's module with a stubbed CRT.UI: placementLua(where)
// returns Lua code that defines CRT_PLACEMENT(CRT, UI). It loads the real CRT_Core/UI/Placement.lua onto UI (by default
// CRT.UI), so the module's UI.Placement.Define and el:Attach run as in the game. The panel (PlacementPanel.lua) is left
// out: run_placement.js tests it. where is the addon folder, a file in it, or a list of files (the harness's arguments).
// Usage, in a harness: const placementLua = require('./placement_stub'); put placementLua(where) before the Lua source,
// then call CRT_PLACEMENT(CRT) after CRT.UI is made and before the module files load.
const fs = require('fs');
const path = require('path');

function findRoot(where) {
  for (const p of [].concat(where)) {
    let d = path.resolve(p);
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(d, 'CRT_Core', 'UI', 'Placement.lua'))) return d;
      d = path.dirname(d);
    }
  }
  throw new Error('placement_stub: no CRT_Core/UI/Placement.lua above ' + [].concat(where).join(', '));
}

module.exports = function placementLua(where) {
  const src = fs.readFileSync(path.join(findRoot(where), 'CRT_Core/UI/Placement.lua'), 'utf8');
  if (src.includes(']====]')) throw new Error('placement_stub: Placement.lua holds the long-string closer');
  return `
function CRT_PLACEMENT(CRT, UI)
  UI = UI or CRT.UI
  local real = CRT.UI
  CRT.UI = UI
  assert(load([====[${src}]====], "Placement"))("CowfeeRaidTools", CRT)
  CRT.UI = real
  return UI.Placement
end
`;
};
