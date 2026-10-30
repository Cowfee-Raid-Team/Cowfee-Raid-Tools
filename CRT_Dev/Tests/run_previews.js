// CRT_Core/UI/Panel.lua's previews by key: UI:SetPreview, UI:SetPreviewGroup, UI:SetPreviews, the title bar's label and
// click (UI:TogglePreviews), the helpers (alertwindow, placement) that follow any or none, combat, UI:OnPreviewChange and
// UI.PreviewButton. Then each page's preview buttons: they exist, on PreviewButton, with the right keys.
// Usage: node run_previews.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local panelSrc, themesSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end

local function mock()
  local o = { shown = true }
  local methods = {
    CreateTexture = function() return mock() end,
    CreateFontString = function() return mock() end,
    SetText = function(self, t) self.text = t end,
    GetText = function(self) return rawget(self, "text") end,
    GetStringWidth = function(self) local t = rawget(self, "text") return #(type(t) == "string" and t or "") * 6 end,
    SetSize = function(self, w, h) self.w, self.h = w, h end,
    SetWidth = function(self, w) self.w = w end,
    GetWidth = function(self) return rawget(self, "w") end,
    SetScript = function(self, k, fn) local t = rawget(self, "scripts") or {} rawset(self, "scripts", t) t[k] = fn end,
    GetScript = function(self, k) local t = rawget(self, "scripts") return t and t[k] end,
  }
  return setmetatable(o, { __index = function(_, k) return methods[k] or (type(k) == "string" and k:find("^%u") and function() end) or nil end })
end
CreateFrame = function(kind, name, parent, template)
  local f = mock()
  if template == "UIPanelButtonTemplate" then
    f.label = mock()
    f.Left = false -- no end caps: UI:SkinButton leaves it alone
    f.SetText = function(self, t) self.label.text = t end
    f.GetText = function(self) return self.label.text end
    f.GetFontString = function(self) return self.label end
  end
  return f
end
local combat = false
InCombatLockdown = function() return combat end
local printed = {}
GameTooltip = mock()

local CRT = { db = { ui = { modern = false, layers = {} } } }
function CRT:Print(msg) printed[#printed + 1] = msg end
assert(load(themesSrc, "Themes.lua"))("CowfeeRaidTools", CRT)
assert(load(panelSrc, "Panel.lua"))("CowfeeRaidTools", CRT)
local UI = CRT.UI
UI.TooltipOwner = function() end

-- every key records its calls
local calls = {}
local state = {}
for _, key in ipairs({ "alert", "alertbars", "alerticons", "pace", "debuffs", "alertwindow", "placement" }) do
  calls[key] = {}
  UI:RegisterPreview(key, function(on)
    calls[key][#calls[key] + 1] = on
    state[key] = on
  end)
end
local function reset() for k in pairs(calls) do calls[k] = {} end end
UI.previewButton = CreateFrame("Button", nil, nil, "UIPanelButtonTemplate")
UI.previewButton:SetText("Previews")

-- 1. one key calls only its own setFn
UI:SetPreview("alertbars", true)
eq(#calls.alertbars, 1, "SetPreview calls the key's setFn once")
eq(calls.alertbars[1], true, "with on")
eq(#calls.alerticons + #calls.alert + #calls.pace + #calls.debuffs, 0, "and no other display's")
check(UI:IsPreviewing("alertbars") and not UI:IsPreviewing("alerticons"), "IsPreviewing follows the key")
check(UI:AnyPreview() == true, "AnyPreview is true with one key on")
eq(UI.previewButton:GetText(), "Previews: ON", "the title bar reads Previews: ON while any key is on")

-- 2. the helpers start with the first display and stop with the last
eq(calls.alertwindow[1], true, "alertwindow starts with the first display")
eq(calls.placement[1], true, "placement starts with the first display")
reset()
UI:SetPreviewGroup({ "pace" }, true)
eq(#calls.placement + #calls.alertwindow, 0, "a second display leaves the helpers alone")

-- 3. groups add up, and turning one off leaves the other
UI:SetPreviewGroup({ "alert", "alertbars", "alerticons" }, true)
check(UI:IsPreviewing("pace") and UI:IsPreviewing("alerticons"), "groups add up")
check(UI:GroupPreviewing({ "alert", "alertbars", "alerticons" }), "a group is on when all its keys are")
check(not UI:GroupPreviewing({ "alert", "debuffs" }), "a group with one key off is off")
reset()
UI:SetPreviewGroup({ "alert", "alertbars", "alerticons" }, false)
check(not UI:IsPreviewing("alertbars") and UI:IsPreviewing("pace"), "turning off one group leaves the other")
eq(#calls.pace, 0, "and never calls the other's setFn")
eq(#calls.placement, 0, "placement keeps running while pace previews")
eq(UI.previewButton:GetText(), "Previews: ON", "still ON")
reset()
UI:SetPreview("pace", false)
eq(calls.placement[1], false, "placement stops with the last display")
eq(calls.alertwindow[1], false, "alertwindow stops with the last display")
check(not UI:AnyPreview(), "AnyPreview is false with none on")
eq(UI.previewButton:GetText(), "Previews", "the title bar reads Previews with none on")

-- 4. the helpers never count as a display
UI:SetPreview("placement", true)
check(not UI:AnyPreview() and not UI:IsPreviewing("placement"), "a helper key is not a section")

-- 5. the title bar's click: everything on with none on, everything off with any on
reset()
UI:TogglePreviews()
for _, key in ipairs({ "alert", "alertbars", "alerticons", "pace", "debuffs" }) do
  check(UI:IsPreviewing(key) and state[key] == true, "Previews with none on turns on " .. key)
end
check(state.placement == true and state.alertwindow == true, "and the helpers")
UI:SetPreview("pace", false)
UI:TogglePreviews()
for _, key in ipairs({ "alert", "alertbars", "alerticons", "pace", "debuffs" }) do
  check(not UI:IsPreviewing(key) and state[key] == false, "Previews with some on turns off " .. key)
end
check(state.placement == false, "and stops placement")

-- 6. closing the main window: SetPreviews(false) hides every display and runs the helpers off, even with none on
reset()
UI:SetPreviews(false)
eq(calls.placement[1], false, "SetPreviews(false) stops placement even with nothing on")
eq(calls.debuffs[1], false, "and tells every display off")
local src = panelSrc
check(src:find('SetScript%("OnHide", function%(%)%s*UI:SetPreviews%(false%)') ~= nil, "the main window's OnHide calls UI:SetPreviews(false)")

-- 7. combat refuses on, and allows off
UI:SetPreview("debuffs", true)
combat = true
reset()
printed = {}
UI:SetPreview("pace", true)
check(not UI:IsPreviewing("pace") and #calls.pace == 0, "combat refuses a preview")
check(#printed == 1, "and says so")
UI:TogglePreviews()
check(not UI:IsPreviewing("debuffs"), "off still works in combat")
combat = false

-- 8. OnPreviewChange and PreviewButton
local heard = 0
UI:OnPreviewChange(function() heard = heard + 1 end)
UI:SetPreview("pace", true)
eq(heard, 1, "OnPreviewChange hears a change")
UI:SetPreview("pace", false)
local b = UI.PreviewButton(UIParent, "Preview alerts", { "alert", "alertbars" }, { tooltip = "Shows the alerts." })
eq(b:GetText(), "Preview alerts", "PreviewButton shows its label while off")
check(b:GetWidth() >= UI.PanelButtonWidth(#"Preview alerts" * 6) and b:GetWidth() >= UI.PanelButtonWidth(#"Stop preview" * 6),
  "PreviewButton is as wide as its longer label")
b:GetScript("OnClick")(b)
check(UI:IsPreviewing("alert") and UI:IsPreviewing("alertbars") and not UI:IsPreviewing("pace"), "a click turns on its keys only")
eq(b:GetText(), "Stop preview", "it reads Stop preview while on")
UI:SetPreview("alertbars", false)
eq(b:GetText(), "Preview alerts", "it follows OnPreviewChange: one key off, the group is off")
b:GetScript("OnClick")(b)
check(UI:GroupPreviewing({ "alert", "alertbars" }), "a click on a part-on group turns all on")
UI:TogglePreviews()
eq(b:GetText(), "Preview alerts", "the title bar's off resets it")
local single = UI.PreviewButton(UIParent, "Preview pace window", "pace")
single:GetScript("OnClick")(single)
check(UI:IsPreviewing("pace"), "a button can take one key")
single:GetScript("OnClick")(single)
check(not UI:IsPreviewing("pace"), "and turns it off again")

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error(fails .. " preview checks failed") end
`;
const root = process.argv[2];
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let bad = 0;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(read('CRT_Core/UI/Panel.lua')));
lua.lua_pushstring(L, to_luastring(read('CRT_Core/Themes.lua')));
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); bad++; }

// Each page's preview buttons, read from its source: built by UI.PreviewButton with these keys, and no page makes its own
// preview toggle. [file, label key in its TEXT table or literal, keys]
const pages = [
  ['CRT_Modules/Notes/AlertsTab.lua', ['"alert"', '"alerttexts"', '"alertbars"', '"alerticons"', '"alertcircles"', '"alerttimeline"']],
  ['CRT_Modules/Notes/Settings.lua', ['"note-timers"', '"note-assignments"', '"note-personal"']],
  ['CRT_Modules/Markers/MacrosTab.lua', ['"markers"']],
  ['CRT_Modules/ReadyCheck/Page.lua', ['"readycheckwindow"', '"consumables"']],
  ['CRT_Modules/Consumables/Page.lua', ['"consumables"']],
  ['CRT_Modules/Interrupts/Page.lua', ['"interrupts-box"', '"interrupts-reminder"']],
  ['CRT_Modules/Pace/Page.lua', ['"pace"']],
  ['CRT_Modules/QoL/Page.lua', ['"lowhealth"', '"break"']],
  ['CRT_Modules/Debuffs/Page.lua', ['"debuffs"']],
];
for (const [file, keys] of pages) {
  const src = read(file);
  if (!/UI\.PreviewButton\(/.test(src)) { console.log('FAIL ' + file + ' has no UI.PreviewButton'); bad++; continue; }
  for (const k of keys) {
    if (!src.includes(k)) { console.log('FAIL ' + file + ' never names the preview key ' + k); bad++; }
  }
}
// the alert editor is its own window: it stays out of the alert group (its code, comments left out)
if (/"alerteditor"/.test(read('CRT_Modules/Notes/AlertsTab.lua').replace(/--.*$/gm, ''))) { console.log('FAIL the alert group names alerteditor'); bad++; }
// no page sets the whole switch: pages own their buttons, the core owns the state
for (const file of pages.map((p) => p[0])) {
  if (/UI:SetPreviews\(true\)/.test(read(file))) { console.log('FAIL ' + file + ' turns on every preview'); bad++; }
}
if (bad > 0) { console.log(bad + ' failed'); process.exit(1); }
console.log('page buttons all passed');
