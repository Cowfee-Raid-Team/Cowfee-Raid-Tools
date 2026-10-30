// The real previews for harnesses with a stubbed CRT.UI: previewsLua(where) returns Lua code that defines
// CRT_PREVIEWS(CRT, UI). It runs the code of CRT_Core/UI/Panel.lua between its [previews] and [/previews] markers onto UI:
// UI:RegisterPreview, UI:SetPreview, UI:SetPreviewGroup, UI:SetPreviews, UI:TogglePreviews, UI:IsPreviewing,
// UI:AnyPreview, UI:OnPreviewChange, UI:GroupPreviewing and UI.PreviewButton (which needs the harness's UI.PanelButton,
// and UI.PanelButtonWidth, UI.TooltipOwner and UI.Color when used). run_previews.js tests that code itself.
// Usage, in a harness: const previewsLua = require('./previews_stub'); put previewsLua(where) before the Lua source, then
// call CRT_PREVIEWS(CRT, CRT.UI) before loading the module files. where is the addon folder, a file in it, or a list of
// files (the harness's arguments).
const fs = require('fs');
const path = require('path');

function findRoot(where) {
  for (const p of [].concat(where)) {
    let d = path.resolve(p);
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(d, 'CRT_Core', 'UI', 'Panel.lua'))) return d;
      d = path.dirname(d);
    }
  }
  throw new Error('previews_stub: no CRT_Core/UI/Panel.lua above ' + [].concat(where).join(', '));
}

module.exports = function previewsLua(where) {
  const panel = fs.readFileSync(path.join(findRoot(where), 'CRT_Core/UI/Panel.lua'), 'utf8');
  const start = panel.indexOf('-- [previews]');
  const end = panel.indexOf('-- [/previews]');
  if (start < 0 || end < start) throw new Error('previews_stub: the [previews] markers are missing from Panel.lua');
  const block = panel.slice(panel.indexOf('\n', start) + 1, end);
  if (block.includes(']====]')) throw new Error('previews_stub: the block holds the long-string closer');
  return `
function CRT_PREVIEWS(CRT, UI)
  assert(load("local UI, CRT = ... " .. [====[${block}]====], "Panel.lua previews"))(UI, CRT)
end
`;
};
