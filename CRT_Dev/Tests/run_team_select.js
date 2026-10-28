// Tonight's team (CRT_Core/Team.lua, CRT_Core/TeamList.lua, CRT_Core/UI/TeamDialogs.lua, CRT_Core/UI/TeamPopup.lua):
// several CRTs in one raid, each its own copy of the files and its own CRTDBChar, every message handed to every
// other one. The dropdown's entries and default; adding (trimmed, 1 to 24 characters, no |, duplicates refused in
// any case); removing in two steps, deleting only that team's data; the raid leader's push (T|1|<name>) taken only
// from the current leader, the lock and its lifting (leaving the group, the lead moving), a joiner getting the push;
// the new raid group popup once per group (not after a /reload, not in combat, not after a push, closed by one), the
// leader's variant with Use Loot Master? and Save and push, and Add team… inside the popup.
// Usage: node run_team_select.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local teamSrc, listSrc, dialogsSrc, popupSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end
issecretvalue = function(v) return v == "SECRET" end
LE_PARTY_CATEGORY_HOME, LE_PARTY_CATEGORY_INSTANCE = 1, 2
Enum = { SendAddonMessageResult = { Success = 0, AddonMessageThrottle = 3, ChannelThrottle = 8, AddOnMessageLockdown = 11 } }
local CLOCK = 1000
GetTime = function() return CLOCK end
time = function() return 1790000000 + CLOCK end
CRTFontEdit = {}

-- the clients: each its own CRT, frames and CRTDBChar; ME is the one acting now
local ME
local clients, order = {}, {}
setmetatable(_G, {
  __index = function(_, k) if k == "CRTDBChar" then local c = clients[ME] return c and c.char end end,
  __newindex = function(t, k, v) if k == "CRTDBChar" then clients[ME].char = v else rawset(t, k, v) end end,
})
local raid = {} -- { name, realm, online }
local shape = "solo"
local leader -- the raid leader's name
local secretLead = false
local function inGroup(name) for _, m in ipairs(raid) do if m.name == name then return m end end end
UnitName = function(u) if u == "player" then return ME end end
GetNormalizedRealmName = function() return "Sargeras" end
IsInRaid = function() return inGroup(ME) ~= nil and shape == "raid" end
IsInGroup = function(cat)
  if not inGroup(ME) or shape == "solo" then return false end
  if cat == LE_PARTY_CATEGORY_INSTANCE then return false end
  return true
end
GetRaidRosterInfo = function(i)
  if not IsInRaid() then return nil end
  local m = raid[i]
  if not m then return nil end
  return m.name, m.name == leader and 2 or 0, 1, 90, "Paladin", "PALADIN", "Zone", m.online and 1 or nil
end
UnitIsGroupLeader = function(unit)
  if secretLead then return "SECRET" end
  if unit == "player" then return IsInRaid() and leader == ME end
  local i = tonumber(tostring(unit):match("^raid(%d+)$"))
  return i ~= nil and raid[i] ~= nil and raid[i].name == leader
end
GetInstanceInfo = function() return "Raid One", "raid", 16 end
InCombatLockdown = function() return clients[ME].combat == true end

local timers = {}
C_Timer = { After = function(s, fn) timers[#timers + 1] = { at = CLOCK + s, fn = fn, who = ME } end }
local function advance(s)
  local target = CLOCK + s
  while true do
    table.sort(timers, function(a, b) return a.at < b.at end)
    local t = timers[1]
    if not t or t.at > target then break end
    table.remove(timers, 1)
    CLOCK = t.at
    local was = ME ME = t.who
    if clients[ME].loaded then t.fn() end
    ME = was
  end
  CLOCK = target
end

local sent = {}
C_ChatInfo = {
  RegisterAddonMessagePrefix = function() return true end,
  InChatMessagingLockdown = function() return false end,
  SendAddonMessage = function(prefix, text, channel)
    sent[#sent + 1] = { from = ME, prefix = prefix, text = text, channel = channel }
    local from = ME
    for _, name in ipairs(order) do
      local c = clients[name]
      if name ~= from and inGroup(name) and c.loaded then
        local was = ME ME = name
        c.Team.HandleEvent("CHAT_MSG_ADDON", prefix, text, channel, from .. "-Sargeras")
        ME = was
      end
    end
    return 0
  end,
}

-- frames: any method is a no-op unless known
local function mock(kind)
  local o = { kind = kind, events = {}, shown = true, pts = {} }
  return setmetatable(o, { __index = function(t, k)
    if k == "RegisterEvent" then return function(self, e) self.events[e] = true end end
    if k == "UnregisterEvent" then return function(self, e) self.events[e] = nil end end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "Show" then return function(self) self.shown = true end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) self.shown = on and true or false end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return rawget(self, "text") end end
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabled", on and true or false) end end
    if k == "IsEnabled" then return function(self) return rawget(self, "enabled") ~= false end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "ClearAllPoints" then return function(self) self.pts = {} end end
    if k == "GetStringWidth" then return function(self) return #(rawget(self, "text") or "") * 7 end end
    if k == "CreateFontString" then return function() return mock("FontString") end end
    if k == "GetFontString" then return function(self) local fs = mock("FontString") fs.text = rawget(self, "text") return fs end end
    return function() end
  end })
end
CreateFrame = function(kind)
  local f = mock(kind)
  if ME and clients[ME] then table.insert(clients[ME].frames, f) end
  return f
end

-- the UI helpers the dialogs and the popup use, standing in: each records what it was given
local function makeUI(c)
  local UI = {}
  UI.windows = {}
  function UI.Window(name, opts)
    local w = mock("Frame")
    w.name, w.opts, w.shown = name, opts, false
    w.content = mock("Frame")
    w.strip = { title = opts.title, SetTitle = function(self, t) self.title = t end, SetHelp = function() return mock("Button") end }
    UI.windows[name] = w
    return w
  end
  function UI.Dropdown(_, text, opts)
    local row = mock("Frame")
    row.text, row.opts = text, opts
    row.refresh = function() end
    c.dropdowns[#c.dropdowns + 1] = row
    return row
  end
  function UI.PanelButton(_, label, _, onClick)
    local b = mock("Button")
    b.text, b.OnClick = label, onClick
    return b
  end
  function UI.PanelButtonWidth(w) return w + 20 end
  function UI.Toggle2(_, halves, onPick)
    local t = { buttons = {} }
    for i, h in ipairs(halves) do
      local b = mock("Button") b.key = h.key b.OnClick = function() onPick(h.key) end
      t.buttons[i] = b
    end
    function t:Size() return 0 end
    function t:PlaceLeft() end
    function t:Select(key) self.selected = key end
    return t
  end
  function UI.HelpRight() return mock("Button") end
  function UI:SkinEditBox(e) e.skinned = true end
  function UI.BadText(s) return "|cffff0000" .. s .. "|r" end
  return UI
end

local function loadFiles(c)
  local was = ME ME = c.name
  c.frames, c.dropdowns = {}, {}
  c.CRT.UI = makeUI(c)
  assert(load(teamSrc, "Team.lua"))("CowfeeRaidTools", c.CRT)
  assert(load(listSrc, "TeamList.lua"))("CowfeeRaidTools", c.CRT)
  assert(load(dialogsSrc, "TeamDialogs.lua"))("CowfeeRaidTools", c.CRT)
  assert(load(popupSrc, "TeamPopup.lua"))("CowfeeRaidTools", c.CRT)
  ME = was
  c.Team, c.Popup, c.Dialogs = c.CRT.Team, c.CRT.TeamPopup, c.CRT.TeamDialogs
  c.loaded = true
end
local function newClient(name)
  local c = { name = name, CRT = { db = { team = { threshold = 0.75, list = {}, popup = {} } }, version = "1.2.0" } }
  function c.CRT:Print() end
  -- Loot Master's answer from the popup, recorded
  c.plans = {}
  c.asks = 0
  c.CRT.LootMaster = { PlanLooting = function(_, on) c.plans[#c.plans + 1] = on end, MaybeAskLooting = function() c.asks = c.asks + 1 end }
  clients[name] = c
  order[#order + 1] = name
  loadFiles(c)
  return c
end
local function on(name, event, ...) local was = ME ME = name clients[name].Team.HandleEvent(event, ...) ME = was end
local function as(name, fn) local was = ME ME = name local r = { fn(clients[name]) } ME = was return table.unpack(r) end
local function rosterAll() for _, name in ipairs(order) do if inGroup(name) and clients[name].loaded then on(name, "GROUP_ROSTER_UPDATE") end end end
local function join(name) raid[#raid + 1] = { name = name, online = true } rosterAll() end
local function leave(name)
  for i, m in ipairs(raid) do if m.name == name then table.remove(raid, i) break end end
  rosterAll()
  if clients[name] then on(name, "GROUP_ROSTER_UPDATE") end
end
local function labels(opts) local out = {} for _, o in ipairs(opts) do out[#out + 1] = o.label end return table.concat(out, ", ") end
local function popupShown(name) return as(name, function(c) return c.Popup.IsShown() end) end
local function lastFrom(name) for i = #sent, 1, -1 do if sent[i].from == name then return sent[i].text end end end

-- 1. The list --------------------------------------------------------------------------------------------------------
local S = newClient("Solex")
local T = S.Team
ME = "Solex"
eq(labels(T:Options()), "Pug, Add team\\226\\128\\166", "the dropdown: Pug, then Add team… (never the built-in Team)")
eq(T:Options()[2].key, T.ADD_KEY, "Add team… has its own key")
eq(T:Tonight(), "Pug", "nothing saved: tonight is Pug")
eq(T:AddTeam("  Cowfee Mythic  "), "Cowfee Mythic", "a name is trimmed and added")
eq(labels(T:Options()), "Pug, Cowfee Mythic, Add team\\226\\128\\166", "your teams come after Pug, before Add team…")
local function refused(name, why, what) local n, w = T:AddTeam(name) check(n == nil and type(w) == "string" and w:find(why, 1, true) ~= nil, what .. " (" .. tostring(w) .. ")") end
refused("cowfee mythic", "already a team named Cowfee Mythic", "a duplicate in another case is refused")
refused("TEAM", "can't be a team name", "Team is reserved: no team can be called Team")
refused("pug", "already a team named Pug", "nor Pug")
refused(string.rep("x", 25), "at most 24", "25 characters are too many")
refused("a|b", "|", "a | is refused (it would break the push)")
refused("   ", "Type a name", "an empty name is refused")
refused("SECRET", "Type a name", "a secret value is never read")
eq(T:AddTeam(string.rep("y", 24)), string.rep("y", 24), "24 characters are fine")
eq(#S.CRT.db.team.list, 2, "saved in CRTDB.team.list")
check(T:SetTonight("cowfee MYTHIC"), "a team is picked in any case")
eq(T:Tonight(), "Cowfee Mythic", "and saved with its own case")
eq(T:IsTeam(), false, "solo: never a team raid")
eq(CRTDBChar.team.tonight, "Cowfee Mythic", "tonight's team is per character, in CRTDBChar.team")

-- Add team… through the dialog
do
  local D = S.Dialogs
  local added
  D.AskName(function(name) added = name end)
  eq(D.mode, "add", "Add team… opens the name box")
  check(D.win.shown and D.edit.shown, "shown, with its box")
  check(D.edit.skinned, "the box is skinned like every CRT edit box")
  D.edit:SetText("Cowfee Mythic") D.Accept()
  check(added == nil and D.win.shown and tostring(D.error.text):find("already a team", 1, true) ~= nil, "a duplicate shows why in red and stays open")
  D.edit:SetText(" Night Crew ") D.Accept()
  eq(added, "Night Crew", "Add saves the team and hands it back")
  check(not D.win.shown, "and closes")
end

-- Remove: two steps, then only that team's data goes
do
  local D = S.Dialogs
  local deleted = {}
  T:OnTeamData({ count = function(name) return ({ ["Cowfee Mythic"] = 12, ["Night Crew"] = 1 })[name] or 0 end,
    delete = function(name) deleted[#deleted + 1] = name end })
  eq(T:TeamPulls("Cowfee Mythic"), 12, "the pulls saved under a team")
  check(not T:CanRemove("Team") and not T:CanRemove("Pug"), "Team and Pug can't be removed")
  D.AskRemove("Team")
  check(not D.win.shown or D.mode ~= "remove", "no warning for a built-in team")
  D.AskRemove("Night Crew")
  eq(D.message.text, "Remove Night Crew? Season Stats for Night Crew (1 pull) will be deleted too.", "one pull: the singular")
  D.cancel.OnClick()
  check(not D.win.shown and T:Find("Night Crew") == "Night Crew", "Cancel at the first step removes nothing")
  D.AskRemove("cowfee mythic")
  eq(D.mode, "remove", "the first warning")
  eq(D.message.text, "Remove Cowfee Mythic? Season Stats for Cowfee Mythic (12 pulls) will be deleted too.", "it names the team and its pulls")
  eq(D.ok.text, "Remove", "[Remove]")
  D.Accept()
  eq(D.mode, "confirm", "Remove leads to the second warning")
  eq(D.message.text, "This can't be undone. Type the team name to delete it and its 12 pulls.", "which asks for the name")
  eq(D.ok.text, "Delete for good", "[Delete for good]")
  eq(D.ok:IsEnabled(), false, "greyed until the name is typed")
  D.edit:SetText("Cowfee") D.edit.OnTextChanged(D.edit)
  eq(D.ok:IsEnabled(), false, "part of the name isn't enough")
  D.Accept()
  check(T:Find("Cowfee Mythic") ~= nil and #deleted == 0, "Accept with the wrong name does nothing")
  D.edit:SetText(" cowfee mythic ") D.edit.OnTextChanged(D.edit)
  eq(D.ok:IsEnabled(), true, "the name in any case enables it")
  local done = false
  D.done = function() done = true end
  D.Accept()
  check(done and not D.win.shown, "deleted, the dialog closes")
  eq(T:Find("Cowfee Mythic"), nil, "the team is gone from the list")
  eq(table.concat(deleted, ","), "Cowfee Mythic", "only that team's data is deleted")
  eq(T:Tonight(), "Pug", "tonight was that team: back to Pug")
  eq(labels(T:Options()), "Pug, " .. string.rep("y", 24) .. ", Night Crew, Add team\\226\\128\\166", "the others stay")
  T:RemoveTeam(string.rep("y", 24))
end
-- a stamp of a removed team reads as Team
eq(T.Resolve("Cowfee Mythic"), "Team", "a removed team's name reads as Team")
eq(T.Resolve(nil), "Team", "no name reads as Team")
eq(T.Resolve("night crew"), "Night Crew", "a listed name reads as itself")
-- All is the Season Stats filter's: never a team's name
refused("all", "can't be a team name", "All is reserved, in any case")
refused(" ALL ", "can't be a team name", "even with spaces")
-- a removed team you had pushed is never sent again
eq(T:AddTeam("Temp"), "Temp", "a team to remove")
CRTDBChar.team.pushed = "Temp"
T:RemoveTeam("Temp")
eq(CRTDBChar.team.pushed, nil, "removing the team you pushed forgets the push")

-- the push's wire format
eq(T.EncodeTeam("Night Crew"), "T|1|Night Crew", "the push: T|1|<name>")
eq(T.DecodeTeam("T|1|Night Crew"), "Night Crew", "read back")
eq(T.DecodeTeam("T|1.2|Night Crew|later"), "Night Crew", "a later minor version's fields are skipped")
eq(T.DecodeTeam("T|2|Night Crew"), nil, "a higher major version is left alone")
eq(T.DecodeTeam("T|1|" .. string.rep("z", 25)), nil, "a name too long is dropped")
eq(T.DecodeTeam("T|1|"), nil, "no name is dropped")
eq(T.DecodeTeam("SECRET"), nil, "a secret text is never read")
eq(T.Decode("T|1|Night Crew"), nil, "a push is no hello")
-- a CRT from before the push (v1.1.4's Decode matches H only) drops it
do
  local old = assert(load([[
local Team = { VERSION = 1 }
return function(text)
    local version = text:match("^H|(%d+%.?%d*)|([^|]*)(.*)$")
    return tonumber(version)
end]]))()
  eq(old("T|1|Night Crew"), nil, "v1.1.4's hello parser reads no hello in a push")
end

-- 2. A raid forms: the leader's popup ----------------------------------------------------------------------------
-- Solex picked Night Crew before forming the raid: the new group keeps it
T:SetTonight("Night Crew")
shape = "raid"
leader = "Solex"
join("Solex")
check(T:GroupKey() ~= nil, "a raid group: a group key")
eq(T:Tonight(), "Night Crew", "a team picked before the group is kept")
check(not popupShown("Solex"), "the popup waits a moment")
advance(3)
check(popupShown("Solex"), "then the leader is asked")
local P = S.Popup
eq(P.win.strip.title, "New raid group", "the leader's popup: New raid group")
check(P.lootLabel.shown and P.toggle.buttons[1].shown, "with Use Loot Master? [Yes] [No]")
eq(P.save.text, "Save and push to raid", "and Save and push to raid")
eq(P.state.pick, "Night Crew", "the dropdown starts on tonight's team")
eq(P.state.loot, nil, "and Use Loot Master? with neither answer picked")
eq(P.toggle.selected, nil, "neither half lit")
check(P.AsksLoot(), "while it shows, Loot Master's own instance question waits")
eq(labels(P.drop.opts.options()), labels(T:Options()), "the popup's dropdown is the same list as General Settings, Add team… last")
-- Add team… in the popup: the new team is created, saved and picked there
P.drop.opts.set(T.ADD_KEY)
eq(S.Dialogs.mode, "add", "Add team… in the popup opens the name box")
S.Dialogs.edit:SetText("Raid Alpha") S.Dialogs.Accept()
eq(P.state.pick, "Raid Alpha", "the new team is picked in the popup")
eq(T:Find("raid alpha"), "Raid Alpha", "and saved to the list")
eq(T:Tonight(), "Night Crew", "tonight changes only on Save")
P.toggle.buttons[1].OnClick()
eq(P.state.loot, true, "Yes picked")
check(T:Asked(), "asked once in this group")

-- 3. Raiders: one waits for its popup when the leader hasn't pushed yet -------------------------------------------
local B = newClient("Bell")
join("Bell")
advance(5)
check(not popupShown("Bell"), "a raider's popup waits a few seconds")
advance(6)
check(popupShown("Bell"), "then asks Which team is this raid?")
eq(B.Popup.win.strip.title, "Which team is this raid?", "the raider's title")
check(not B.Popup.lootLabel.shown, "no Loot Master question for a raider")
eq(B.Popup.save.text, "Save", "[Save] [Later]")
eq(as("Bell", function(c) return c.Team:Tonight() end), "Pug", "a raider with no pick starts on Pug")
-- the leader saves and pushes: the raider's open popup closes
local before = #sent
as("Solex", function() P.save.OnClick() end)
eq(T:Tonight(), "Raid Alpha", "Save sets tonight's team")
eq(S.plans[1], true, "and answers Use Loot Master? Yes (CRT Looting on for this raid)")
check(not popupShown("Solex"), "the popup closes")
advance(3)
eq(lastFrom("Solex"), "T|1|Raid Alpha", "the push goes to the raid")
eq(sent[#sent].channel, "RAID", "on the raid channel")
eq(as("Bell", function(c) return c.Team:Tonight() end), "Raid Alpha", "the raider takes the leader's team")
eq(as("Bell", function(c) return c.Team:Find("Raid Alpha") end), "Raid Alpha", "and adds it to its own list")
eq(as("Bell", function(c) return c.Team:LockedBy() end), "Solex", "locked: set by the raid leader")
check(not popupShown("Bell"), "the raider's popup closed when the push came")
check(not as("Bell", function(c) return c.Team:SetTonight("Pug") end), "a raider can't change a pushed team")
check(not as("Bell", function(c) return c.Team:CanRemove("Raid Alpha") end), "nor remove it")
check(not as("Bell", function(c) return c.Team.CanPush() end), "a raider can't push")
eq(T.StatusLine(), "Now: Raid Alpha pushed to 1 CRT user.", "the leader's status line")
eq(as("Bell", function(c) return c.Team.StatusLine() end), "Now: Raid Alpha.", "a raider's status line")

-- 4. A joiner after the push gets it, and isn't asked -------------------------------------------------------------
local M = newClient("Moo")
join("Moo")
advance(30)
eq(as("Moo", function(c) return c.Team:Tonight() end), "Raid Alpha", "the leader sends the team again to a joiner's hello")
eq(as("Moo", function(c) return c.Team:LockedBy() end), "Solex", "locked for the joiner too")
check(not popupShown("Moo"), "the joiner is never asked")
eq(T.StatusLine(), "Now: Raid Alpha pushed to 2 CRT users.", "the count follows")
-- the leader moves off the pushed team: a joiner doesn't get the old one, and the status line says so
as("Solex", function() T:SetTonight("Night Crew") end)
eq(S.char.team.pushed, nil, "a new pick forgets the push")
eq(T.StatusLine(), "Now: Night Crew.", "the status line no longer says pushed")
newClient("Dot")
join("Dot")
advance(30)
eq(as("Dot", function(c) return c.Team:LockedBy() end), nil, "a joiner gets no stale push")
eq(as("Dot", function(c) return c.Team:Tonight() end), "Pug", "and keeps its own team")
as("Solex", function() T:SetTonight("Raid Alpha") T:Push() end)
advance(3)
eq(as("Dot", function(c) return c.Team:Tonight() end), "Raid Alpha", "Push to raid again sends the new one")
leave("Dot")

-- 5. A push from anyone else is refused -----------------------------------------------------------------------------
on("Moo", "CHAT_MSG_ADDON", "CRTHello", "T|1|Hacked", "RAID", "Bell-Sargeras")
eq(as("Moo", function(c) return c.Team:Tonight() end), "Raid Alpha", "a push from a raider who isn't the leader is refused")
eq(as("Moo", function(c) return c.Team:Find("Hacked") end), nil, "and adds nothing")
on("Moo", "CHAT_MSG_ADDON", "CRTHello", "T|1|Hacked", "RAID", "Stranger-Sargeras")
on("Moo", "CHAT_MSG_ADDON", "CRTHello", "T|1|Hacked", "RAID", "SECRET")
on("Moo", "CHAT_MSG_ADDON", "CRTHello", "T|1|Hacked", "PARTY", "Solex-Sargeras")
eq(as("Moo", function(c) return c.Team:Tonight() end), "Raid Alpha", "nor from a stranger, a secret name or another channel")
secretLead = true
on("Moo", "CHAT_MSG_ADDON", "CRTHello", "T|1|Hacked", "RAID", "Solex-Sargeras")
secretLead = false
eq(as("Moo", function(c) return c.Team:Tonight() end), "Raid Alpha", "a secret leader answer refuses the push")
on("Moo", "CHAT_MSG_ADDON", "CRTHello", "T|1|all", "RAID", "Solex-Sargeras")
eq(as("Moo", function(c) return c.Team:Tonight() end), "Raid Alpha", "a push of the reserved name All is refused, even from the leader")
eq(as("Moo", function(c) return c.Team:Find("all") end), nil, "and adds nothing")

-- 6. A /reload in the same group: still locked, no new group, no popup ----------------------------------------------
local keyBefore = as("Moo", function(c) return c.Team:GroupKey() end)
M.loaded = false
loadFiles(M)
on("Moo", "PLAYER_ENTERING_WORLD", false, true)
advance(30)
eq(as("Moo", function(c) return c.Team:GroupKey() end), keyBefore, "a /reload keeps the group")
eq(as("Moo", function(c) return c.Team:LockedBy() end), "Solex", "and the lock")
check(not popupShown("Moo"), "and asks nothing")

-- 7. The lead moves: the lock lifts and the team stays; the new leader's push locks again -------------------------
leader = "Bell"
for _, name in ipairs({ "Solex", "Bell", "Moo" }) do on(name, "PARTY_LEADER_CHANGED") end
eq(as("Moo", function(c) return c.Team:LockedBy() end), nil, "the leader who pushed no longer leads: unlocked")
eq(as("Bell", function(c) return c.Team:Snapshot().lead end), true, "the snapshot says who leads, so Push to raid follows")
eq(as("Solex", function(c) return c.Team:Snapshot().lead end), false, "and who no longer does")
eq(as("Moo", function(c) return c.Team:Tonight() end), "Raid Alpha", "the team is kept")
check(as("Bell", function(c) return c.Team.CanPush() end), "the new leader can push")
as("Bell", function(c) c.Team:SetTonight("Pug") c.Team:Push() end)
advance(3)
eq(as("Moo", function(c) return c.Team:Tonight() end), "Pug", "the new leader's push is taken")
eq(as("Moo", function(c) return c.Team:LockedBy() end), "Bell", "locked by the new leader")
eq(as("Moo", function(c) return c.Team:IsTeam() end), false, "Pug: not a team raid")
eq(lastFrom("Solex") ~= nil and T.CanPush(), false, "the old leader can't push any more")

-- 8. Leaving the group: unlocked, and Remove works ---------------------------------------------------------------
leave("Moo")
eq(as("Moo", function(c) return c.Team:LockedBy() end), nil, "out of the group: unlocked")
eq(as("Moo", function(c) return c.Team:Tonight() end), "Pug", "the team is kept")
check(as("Moo", function(c) return c.Team:CanRemove("Raid Alpha") end), "a pushed team can be removed after leaving")
check(as("Moo", function(c) return c.Team:SetTonight("Raid Alpha") end), "and changed")
eq(as("Moo", function(c) return c.Team:GroupKey() end), nil, "no group key out of a group")

-- 9. A group with no push: the raider is asked once; Later keeps Team; a /reload doesn't ask again ---------------
leave("Bell") leave("Solex")
raid = {}
leader = "Solex"
join("Solex")
advance(3)
as("Solex", function() S.Popup.later.OnClick() end)
check(not popupShown("Solex"), "Later closes the leader's popup")
eq(#S.plans, 1, "Later answers nothing about Loot Master")
join("Moo")
eq(as("Moo", function(c) return c.Team:Tonight() end), "Raid Alpha", "picked outside the group: kept for the new one")
advance(12)
check(popupShown("Moo"), "a raider in a group with no push is asked")
as("Moo", function() M.Popup.Later() end)
eq(as("Moo", function(c) return c.Team:Tonight() end), "Raid Alpha", "Later keeps the team")
advance(60)
check(not popupShown("Moo"), "and isn't asked again")
M.loaded = false
loadFiles(M)
on("Moo", "PLAYER_ENTERING_WORLD", false, true)
advance(60)
check(not popupShown("Moo"), "nor after a /reload in the same group")
-- the raider's Save sets its team; no push, nothing for Loot Master
leave("Moo")
check(not as("Moo", function(c) return c.Team:SetTonight("Team") end), "the built-in Team can't be picked")
-- a new group starts on the team you had last, whether picked in or out of a group
as("Moo", function() CRTDBChar.team.picked = nil end)
join("Moo")
eq(as("Moo", function(c) return c.Team:Tonight() end), "Raid Alpha", "a new group starts on the team you had last")
advance(12)
check(popupShown("Moo"), "a new group asks again")
as("Moo", function() M.Popup.drop.opts.set("Pug") M.Popup.save.OnClick() end)
eq(as("Moo", function(c) return c.Team:Tonight() end), "Pug", "the raider's Save sets the team")
eq(#M.plans, 0, "a raider answers nothing about Loot Master")

-- 10. In combat the popup waits for combat's end --------------------------------------------------------------------
leave("Moo")
as("Moo", function() CRTDBChar.team.picked = nil end)
M.combat = true
join("Moo")
advance(12)
check(not popupShown("Moo"), "in combat: no popup")
M.combat = false
for _, f in ipairs(M.frames) do if f.events.PLAYER_REGEN_ENABLED and rawget(f, "OnEvent") then local was = ME ME = "Moo" f.OnEvent(f, "PLAYER_REGEN_ENABLED") ME = was end end
check(popupShown("Moo"), "shown when combat ends")
as("Moo", function() M.Popup.Later() end)

-- 11. A fresh login out of the group waits for it before leaving the saved group -----------------------------------
local savedKey = as("Moo", function(c) return c.Team:GroupKey() end)
M.loaded = false
local inRaid = raid
raid = {} -- the group isn't known yet at the first loading screen
loadFiles(M)
on("Moo", "PLAYER_ENTERING_WORLD", true, false)
eq(M.char.team.groupKey, savedKey, "a fresh login out of a group keeps the saved group a moment")
on("Moo", "GROUP_ROSTER_UPDATE")
eq(M.char.team.groupKey, savedKey, "a roster event out of a raid group doesn't give it up early")
raid = inRaid
on("Moo", "GROUP_ROSTER_UPDATE")
eq(as("Moo", function(c) return c.Team:GroupKey() end), savedKey, "the group comes: the same group, not a new one")
advance(60)
check(not popupShown("Moo"), "and no popup")
leave("Moo")
eq(M.char.team.groupKey, nil, "leaving clears it")

-- 11b. The leader's popup with no Loot Master answer: Save leaves the plan unset ---------------------------------
as("Solex", function()
  local before, asks = #S.plans, S.asks
  S.Popup.Show(true)
  check(S.Popup.AsksLoot(), "the leader's popup asks Use Loot Master?")
  S.Popup.Save()
  eq(#S.plans, before, "Save with no answer leaves Loot Master's plan unset")
  eq(S.asks, asks + 1, "and closing lets Loot Master ask its own instance question")
  check(not S.Popup.AsksLoot(), "no longer asking")
end)

-- 11c. A full list: 20 teams; a pushed new team is used tonight but not saved ---------------------------------------
do
  local F = newClient("Full")
  as("Full", function(c)
    for i = 1, 20 do eq(c.Team:AddTeam("Team " .. i) ~= nil, true, "team " .. i .. " added") end
    local n, why = c.Team:AddTeam("One More")
    check(n == nil and tostring(why):find("20 teams", 1, true) ~= nil, "a 21st team is refused (" .. tostring(why) .. ")")
  end)
  as("Solex", function() T:AddTeam("Brand New") T:SetTonight("Brand New") T:Push() end)
  join("Full")
  advance(30)
  as("Full", function(c)
    eq(c.Team:Tonight(), "Brand New", "a full list: the pushed team is still tonight's")
    eq(#c.CRT.db.team.list, 20, "but isn't saved")
    eq(c.Team:LockedBy(), "Solex", "and is locked")
    local opts = c.Team:Options()
    eq(opts[#opts - 1].label, "Brand New", "it shows in the dropdown")
    check(not c.Team:CanRemove("Brand New"), "and can't be removed: it was never saved")
  end)
  leave("Full")
  as("Full", function(c) eq(c.Team:Tonight(), "Pug", "after leaving, the unsaved team is gone: Pug") end)
end

-- 12. The files ------------------------------------------------------------------------------------------------------
for _, src in ipairs({ teamSrc, listSrc, dialogsSrc, popupSrc }) do
  check(not src:find('"OnUpdate"', 1, true), "no OnUpdate")
  for _, name in ipairs({ "Midnight", "Season 1" }) do check(not src:find(name, 1, true), "no season fact: " .. name) end
end
check(popupSrc:find("UI.Window(", 1, true) ~= nil, "the popup is a UI.Window (on the popups layer, through UI:RegisterLayer)")
check(dialogsSrc:find("UI.Window(", 1, true) ~= nil, "so are the dialogs")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Core/Team.lua', 'CRT_Core/TeamList.lua', 'CRT_Core/UI/TeamDialogs.lua', 'CRT_Core/UI/TeamPopup.lua'];
for (const f of files) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
