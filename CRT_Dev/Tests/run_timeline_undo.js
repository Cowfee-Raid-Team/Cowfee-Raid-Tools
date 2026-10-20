// Timeline/Undo.lua: Ctrl+Z puts back the notes, reminders and references as they were before the last
// change made while a timeline shows; Ctrl+Y redoes. Stubs for the three owners' change events.
// Usage: node run_timeline_undo.js <addon folder>
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = String.raw`
local src = ...
local now = 100
function GetTime() return now end
local printed = {}
local function owner()
  local o = { listeners = {} }
  function o:OnChange(fn) self.listeners[#self.listeners + 1] = fn end
  function o:Fire() for _, fn in ipairs(self.listeners) do fn() end end
  return o
end
local tl = { references = { { id = 1, text = "Boss: A\nPhase: P2 3:00" } } }
local CRT = { db = { notes = { list = { [1] = { raw = "note one", name = "A" } } }, alerts = { reminders = {} } } }
CRT.Notes, CRT.Alerts, CRT.Timeline = owner(), owner(), owner()
function CRT.Timeline:Settings() return tl end
function CRT:Print(m) printed[#printed + 1] = m end
assert(load(src, "Undo.lua"))("CowfeeRaidTools", CRT)
local U = CRT.TimelineUndo
local fails = 0
local function check(name, ok) print((ok and "ok " or "FAIL ") .. name) if not ok then fails = fails + 1 end end
local frame = { visible = true, IsVisible = function(self) return self.visible end }
U:Watch(frame)
local notes = CRT.db.notes.list

-- a note edit on the timeline, then Ctrl+Z
notes[1].raw = "note one, moved"
CRT.Notes:Fire()
check("a change goes on the list", #U.past == 1)
local listBefore = CRT.db.notes.list
check("undo", U:Undo() == true and notes[1].raw == "note one")
check("the owner's table is kept, not replaced", CRT.db.notes.list == listBefore)
check("redo", U:Redo() == true and notes[1].raw == "note one, moved")
U:Undo()

-- two writes in one frame (a dropped cooldown: the note, then a reminder) undo in one step
now = 101
notes[1].raw = "with a cooldown line"
CRT.Notes:Fire()
CRT.db.alerts.reminders[3001] = { [1] = { text = "Mine" } }
CRT.Alerts:Fire()
check("one frame, one step", #U.past == 1)
U:Undo()
check("both put back", notes[1].raw == "note one" and CRT.db.alerts.reminders[3001] == nil)

-- a phase line moved on a reference
now = 102
tl.references[1].text = "Boss: A\nPhase: P2 2:50 (planned 3:00)"
CRT.Timeline:Fire()
now = 103
notes[2] = { raw = "a new note", name = "B" }
CRT.Notes:Fire()
check("two changes, two steps", #U.past == 2)
U:Undo()
check("the newest first: the new note gone", notes[2] == nil and tl.references[1].text:find("2:50"))
U:Undo()
check("then the phase line back", tl.references[1].text == "Boss: A\nPhase: P2 3:00")
check("nothing left says so", U:Undo() == false and printed[#printed] == "Nothing to undo.")

-- an event with no data change (a setting) records nothing; a new change empties redo
now = 104
CRT.Timeline:Fire()
check("no change, nothing recorded", #U.past == 0 and #U.future == 2)
notes[1].raw = "fresh"
CRT.Notes:Fire()
check("a new change clears redo", #U.future == 0 and #U.past == 1)

-- with no timeline on screen: not recorded; an item changed there drops out of the steps, so Ctrl+Z
-- never overwrites it, while other items' steps stay
frame.visible = false
now = 105
CRT.db.alerts.reminders[3002] = { [1] = { text = "From Mech Alerts" } }
CRT.Alerts:Fire()
check("hidden: not recorded", #U.past == 1)
frame.visible = true
U:Undo()
check("undo puts back only the step's own items", notes[1].raw == "note one" and CRT.db.alerts.reminders[3002] ~= nil)
U:Redo()
frame.visible = false
now = 106
notes[1].raw = "edited on the Raid Notes page"
CRT.Notes:Fire()
frame.visible = true
check("the same item edited elsewhere: its step is dropped", #U.past == 0 and #U.future == 0)
check("and nothing overwrites that edit", U:Undo() == false and notes[1].raw == "edited on the Raid Notes page")

-- a note received from the raid is never undone
U.past, U.future = {}, {}
now = 110
U:Quietly(function() notes[1].raw = "the leader's note" CRT.Notes:Fire() end)
check("received: not recorded", #U.past == 0)
now = 111
notes[1].raw = "the leader's note, my edit"
CRT.Notes:Fire()
U:Undo()
check("undo stops at the received note", notes[1].raw == "the leader's note")

-- a deleted reference comes back in its place in the list
U.past, U.future = {}, {}
tl.references[2] = { id = 2, text = "Boss: B" }
tl.references[3] = { id = 3, text = "Boss: C" }
now = 120 CRT.Timeline:Fire()
U.past = {}
now = 121
table.remove(tl.references, 2)
CRT.Timeline:Fire()
U:Undo()
check("a deleted reference back between its neighbours", #tl.references == 3 and tl.references[2].id == 2 and tl.references[3].id == 3)

-- at most 30 kept
U.past = {}
for i = 1, 35 do now = 200 + i notes[1].raw = "v" .. i CRT.Notes:Fire() end
check("30 kept", #U.past == 30)
print(fails == 0 and "all passed" or (fails .. " failed"))
if fails > 0 then error(fails .. " failed", 0) end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[2] + '/Timeline/Undo.lua', 'utf8')));
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
