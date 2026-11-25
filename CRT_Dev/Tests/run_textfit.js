// Text fits at 22 pt (UX rules 7 and 9, job 20261125-ux-text-fit). The whole addon, every file the .toc lists, loaded
// in a stand-in client whose frames work out where they sit from their anchors and sizes (as run_layoutcheck.js does)
// and whose font strings measure their text from their font's size: a character is TEXT_K (NARROW_K in Arial Narrow)
// times the size wide. Then
// the main window opens and every page is built, every tab on it clicked, at the smallest (8) and largest (22) text
// size in Classic (Default: Blizzard) and Modern (Beanworks: Cowfee). On every page:
//   - every text button and tab is at least as wide as its label plus FIT_PAD,
//   - no two text buttons overlap,
//   - nothing runs past the page's right edge (UI.PAGE_W).
// And: no CRT font (CRTFont*) is under 10 pt at the smallest text size; UI.CapFontSize lives next to the font code.
// Usage: node run_textfit.js <addon folder> [page key ...]   (page keys: only those pages, for work in progress)
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');

const root = process.argv[2];
if (!root) { console.error('usage: node run_textfit.js <addon folder> [page ...]'); process.exit(2); }
const onlyPages = process.argv.slice(3);

// The .toc's files in order (a dev build), the season pack's Season.xml expanded.
function tocFiles() {
  const out = [];
  for (const raw of fs.readFileSync(path.join(root, 'CowfeeRaidTools.toc'), 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const rel = line.replace(/\\/g, '/');
    if (rel.endsWith('.xml')) {
      const dir = path.posix.dirname(rel);
      const xml = fs.readFileSync(path.join(root, rel), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
      for (const m of xml.matchAll(/<Script\s+file="([^"]+)"/g)) out.push(dir + '/' + m[1].replace(/\\/g, '/'));
    } else if (fs.existsSync(path.join(root, rel))) {
      out.push(rel);
    }
  }
  return out;
}

const harness = String.raw`
local files, sources, onlyPages = ...
local unpack = unpack or table.unpack
local errors = {}
local function report(where, err) errors[#errors + 1] = where .. ": " .. tostring(err) end
local TEXT_K = 0.55 -- a character's width, in points of its font's size: the game's font (Friz Quadrata)
local NARROW_K = 0.46 -- the same in Arial Narrow, the Modern look's font (General Settings > Font on its default)
local FIT_PAD = 8   -- a text button is at least its label plus this wide (4 each side: the least a tight UI.Toggle2 keeps)
local TEXT_ROW_SLACK = 4 -- how far a button may reach up or down into a line of text beside it (see scan)

-- Anything not stubbed is a "thing": callable, indexable, 0 in arithmetic, so a file reading a game table loads.
local thing
thing = setmetatable({}, {
  __index = function(_, k) if type(k) == "string" then return thing end return nil end,
  __newindex = function() end, __call = function() return thing end,
  __add = function() return 0 end, __sub = function() return 0 end, __mul = function() return 0 end,
  __div = function() return 0 end, __mod = function() return 0 end, __unm = function() return 0 end,
  __concat = function(a, b) return (a == thing and "" or tostring(a)) .. (b == thing and "" or tostring(b)) end,
  __lt = function() return false end, __le = function() return false end, __len = function() return 0 end,
  __tostring = function() return "" end,
})

local env
local frames = {} -- every frame made, in order: { frame, file }
local loadingFile = "?"
local timers = {}

-- Fonts ----------------------------------------------------------------------------------------------------
local FontMeta = {}
local function fontObject(size, path, flags)
  return setmetatable({ isFont = true, size = size or 12, path = path or "Fonts\\FRIZQT__.TTF", flags = flags or "", color = { 1, 1, 1 } }, FontMeta)
end
local F = {}
function F:GetFont() return self.path, self.size, self.flags end
function F:SetFont(p, s, fl) self.path, self.size, self.flags = p or self.path, s or self.size, fl or "" end
function F:CopyFontObject(src) if type(src) == "string" then src = env[src] end if type(src) == "table" and src.isFont then self.path, self.size, self.flags = src.path, src.size, src.flags self.color = { unpack(src.color) } end end
function F:GetTextColor() return self.color[1], self.color[2], self.color[3], 1 end
function F:SetTextColor(r, g, b) self.color = { r, g, b } end
FontMeta.__index = function(_, k) if F[k] then return F[k] end if type(k) == "string" and k:match("^%u") then return function() end end end
local function resolveFont(f) if type(f) == "string" then f = env[f] end if type(f) == "table" and rawget(f, "isFont") then return f end return nil end

-- Frames ---------------------------------------------------------------------------------------------------
local M = {}
local POINTS = { TOPLEFT = true, TOP = true, TOPRIGHT = true, LEFT = true, CENTER = true, RIGHT = true, BOTTOMLEFT = true, BOTTOM = true, BOTTOMRIGHT = true }
local NUMERIC = { Width = true, Height = true, Alpha = true, FrameLevel = true, NumLines = true, Value = true, ID = true,
  VerticalScroll = true, HorizontalScroll = true, VerticalScrollRange = true, HorizontalScrollRange = true, Cursor = true,
  NumPoints = true, LineHeight = true, Spacing = true, NumRegions = true, NumChildren = true, MaxLines = true }
local VERBS = {}
for v in ("Set Get Enable Disable Register Unregister Clear Start Stop Lock Unlock Raise Lower Play Add Remove Hook Generate Override "
  .. "Update Refresh Scroll Init Release Close Open Toggle Insert Highlight Unhighlight Click Reset Apply Adjust Cursor Focus Show Hide "
  .. "Fade Flash Rotate Mark Select Move Free Acquire Append Flush Invalidate Rebuild Layout Mark Sort Fire Run Cancel Resize Lift Paint Setup Destroy Begin End Finish Wipe Save Load Request Build Attach Detach Expand Collapse Notify Send"):gmatch("%a+") do VERBS[v] = true end
local FrameMeta = { __index = function(t, k)
  local m = M[k]
  if m then return m end
  if type(k) ~= "string" then return nil end
  local what = k:match("^Get(.+)$")
  if what and NUMERIC[what] then return function() return 0 end end
  if what and what:match("Texture$") then return function(self) local key = "tex:" .. what local tx = rawget(self, key) if not tx then tx = M.CreateTexture(self) rawset(self, key, tx) end return tx end end
  if k:match("^Is") or k:match("^Has") or k:match("^Can") or k:match("^Does") then return function() return false end end
  -- a method by its verb; any other capitalised key is a template's part this stand-in hasn't made (nil)
  local verb = k:match("^%u%l+")
  if verb and VERBS[verb] then return function() return nil end end
  return nil
end }
local function new(kind, parent, isRegion, name)
  local o = { _kind = kind, _parent = parent, _points = {}, _shown = true, _scale = 1, _children = {}, _regions = {}, _scripts = {}, _events = {}, _name = name }
  setmetatable(o, FrameMeta)
  if type(parent) == "table" and rawget(parent, "_children") then table.insert(isRegion and parent._regions or parent._children, o) end
  return o
end
function M:GetParent() return self._parent end
function M:SetParent(p)
  local old = self._parent
  if old and rawget(old, "_children") then for i, c in ipairs(old._children) do if c == self then table.remove(old._children, i) break end end end
  self._parent = p
  if p and rawget(p, "_children") then table.insert(p._children, self) end
end
function M:GetName() return self._name end
function M:GetObjectType() return self._kind end
function M:IsObjectType(k) return self._kind == k end
function M:GetChildren() return unpack(self._children) end
function M:GetRegions() return unpack(self._regions) end
function M:GetNumChildren() return #self._children end
function M:GetNumRegions() return #self._regions end
function M:CreateFontString(name, layer, template)
  local fsx = new("FontString", self, true, name)
  fsx._font = template
  if name then env[name] = fsx end
  return fsx
end
function M:CreateTexture() return new("Texture", self, true) end
function M:CreateMaskTexture() return new("MaskTexture", self, true) end
function M:CreateLine() return new("Line", self, true) end
function M:CreateAnimationGroup() return new("AnimationGroup", nil) end
function M:CreateAnimation() return new("Animation", nil) end
function M:SetScale(s) self._scale = s or 1 end
function M:GetScale() return self._scale end
function M:GetEffectiveScale() return self._scale * (self._parent and self._parent.GetEffectiveScale and self._parent:GetEffectiveScale() or 1) end
function M:Show() local was = self:IsVisible() self._shown = true if not was and self:IsVisible() then local fn = self._scripts.OnShow if fn then local ok, e = pcall(fn, self) if not ok then report("OnShow", e) end end end end
function M:Hide() local was = self:IsVisible() self._shown = false if was then local fn = self._scripts.OnHide if fn then pcall(fn, self) end end end
function M:SetShown(on) if on then self:Show() else self:Hide() end end
function M:IsShown() return self._shown end
function M:IsVisible() if not self._shown then return false end local p = self._parent if p and p.IsVisible then return p:IsVisible() end return true end
function M:SetScript(n, fn) self._scripts[n] = fn end
function M:GetScript(n) return self._scripts[n] end
function M:HookScript(n, fn) local old = self._scripts[n] self._scripts[n] = function(...) if old then old(...) end return fn(...) end end
function M:HasScript() return true end
function M:RegisterEvent(e) self._events[e] = true return true end
function M:RegisterUnitEvent(e) self._events[e] = true return true end
function M:UnregisterEvent(e) self._events[e] = nil end
function M:UnregisterAllEvents() self._events = {} end
function M:IsEventRegistered(e) return self._events[e] == true end
function M:SetEnabled(on) self._enabled = on and true or false end
function M:Enable() self._enabled = true end
function M:Disable() self._enabled = false end
function M:IsEnabled() return self._enabled ~= false end
function M:SetChecked(v) self._checked = v and true or false end
function M:GetChecked() return self._checked == true end
function M:SetClipsChildren(on) self._clips = on and true or false end
function M:DoesClipChildren() return self._clips or false end
function M:SetScrollChild(c) self._scrollChild = c c._scrollParent = self end
function M:GetScrollChild() return self._scrollChild end
function M:GetFrameLevel() return 1 end
function M:GetFrameStrata() return "MEDIUM" end
function M:IsMouseOver() return false end
function M:SetSize(w, h) self._w, self._h = w, h end
function M:SetWidth(w) self._w = w end
function M:SetHeight(h) self._h = h end
function M:ClearAllPoints() self._points = {} end
function M:GetNumPoints() return #self._points end
function M:GetPoint(i) local p = self._points[i or 1] if p then return p.point, p.rel, p.relPoint, p.x, p.y end end
function M:SetPoint(point, a, b, c, d)
  local rel, relPoint, x, y
  if type(a) == "table" then rel = a if type(b) == "string" then relPoint, x, y = b, c, d else relPoint, x, y = point, b, c end
  elseif type(a) == "string" and POINTS[a] then rel, relPoint, x, y = self._parent, a, b, c
  elseif type(a) == "string" then rel = env[a] if type(b) == "string" then relPoint, x, y = b, c, d else relPoint, x, y = point, b, c end
  else rel, relPoint, x, y = self._parent, point, a, b end
  for i, p in ipairs(self._points) do if p.point == point then table.remove(self._points, i) break end end
  table.insert(self._points, { point = point, rel = rel, relPoint = relPoint or point, x = tonumber(x) or 0, y = tonumber(y) or 0 })
end
function M:SetAllPoints(rel)
  self._points = {}
  self:SetPoint("TOPLEFT", rel or self._parent, "TOPLEFT", 0, 0)
  self:SetPoint("BOTTOMRIGHT", rel or self._parent, "BOTTOMRIGHT", 0, 0)
end
function M:GetBackdrop() return self._backdrop end
function M:SetBackdrop(b) self._backdrop = b end

-- Text: a font string measures its text from its font's size; a button keeps its label in one.
local function plain(s)
  s = tostring(s or "")
  s = s:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("|T.-|t", "WW"):gsub("|A.-|a", "WW"):gsub("|n", "\n"):gsub("||", "|")
  return s
end
function M:FontSize()
  if self._ownSize then return self._ownSize end
  local f = resolveFont(self._font)
  return f and f.size or 12
end
function M:SetFontObject(o) self._font = o self._ownSize = nil end
function M:GetFontObject() return resolveFont(self._font) end
function M:SetFont(p, s) self._ownSize = s self._ownPath = p return true end
function M:GetFont() local f = resolveFont(self._font) return self._ownPath or (f and f.path) or "Fonts\\FRIZQT__.TTF", self:FontSize(), f and f.flags or "" end
function M:RawWidth()
  local widest = 0
  local path = self:GetFont()
  local k = tostring(path):upper():find("ARIALN", 1, true) and NARROW_K or TEXT_K
  for line in (plain(self._text) .. "\n"):gmatch("(.-)\n") do widest = math.max(widest, #line * self:FontSize() * k) end
  return widest
end
function M:SetText(t)
  self._text = t
  if self._kind ~= "FontString" and self._kind ~= "EditBox" then
    local fsx = self:GetFontString(true)
    if fsx then fsx._text = t end
  end
end
function M:SetFormattedText(fmt, ...) self:SetText(string.format(fmt, ...)) end
function M:GetText() return self._text end
function M:GetFontString(make)
  local fsx = rawget(self, "_fs")
  if not fsx and make then
    fsx = new("FontString", self, true)
    fsx._font = rawget(self, "_normalFont") or "GameFontNormal"
    fsx:SetPoint("CENTER")
    rawset(self, "_fs", fsx)
  end
  return fsx
end
function M:SetFontString(fsx) rawset(self, "_fs", fsx) end
function M:SetNormalFontObject(o) rawset(self, "_normalFont", o) local fsx = rawget(self, "_fs") if fsx then fsx._font = o fsx._ownSize = nil end end
function M:GetNormalFontObject() return resolveFont(rawget(self, "_normalFont")) end
function M:GetStringWidth()
  if self._kind ~= "FontString" then return 0 end
  local w = self:RawWidth()
  if self._w and self._w > 0 and self._wrap ~= false then return math.min(w, self._w) end
  return w
end
function M:GetUnboundedStringWidth() return self:RawWidth() end
function M:GetStringHeight()
  local n = 0
  local k = self:FontSize() * ((tostring(self:GetFont()):upper():find("ARIALN", 1, true)) and NARROW_K or TEXT_K)
  for line in (plain(self._text) .. "\n"):gmatch("(.-)\n") do
    local lines = 1
    if self._w and self._w > 0 and self._wrap ~= false then lines = math.max(1, math.ceil(#line * k / self._w)) end
    n = n + lines
  end
  return n * self:FontSize()
end
function M:GetLineHeight() return self:FontSize() end
function M:SetWordWrap(on) self._wrap = on end
function M:GetTextWidth() local fsx = rawget(self, "_fs") return fsx and fsx:GetStringWidth() or 0 end

-- Where a frame sits, in screen units, worked out from its anchors (run_layoutcheck.js's way).
local function hOf(p) return p:find("LEFT") and 0 or (p:find("RIGHT") and 1 or 0.5) end
local function vOf(p) return p:find("BOTTOM") and 0 or (p:find("TOP") and 1 or 0.5) end
local depth = 0
local function rect(o)
  if o._fixed then return o._fixed end
  local pts = o._points
  if #pts == 0 then
    -- a scroll child sits at its scroll frame's top left
    if o._scrollParent then
      local r = rect(o._scrollParent)
      if not r then return nil end
      local s = o:GetEffectiveScale()
      return { l = r.l, r = r.l + (o._w or 0) * s, t = r.t, b = r.t - (o._h or 0) * s }
    end
    return nil
  end
  depth = depth + 1
  if depth > 60 then depth = depth - 1 return nil end
  local s = o:GetEffectiveScale()
  local width = o._w and o._w > 0 and o._w * s or nil
  local height = o._h and o._h > 0 and o._h * s or nil
  if o._kind == "FontString" then
    width = width or o:GetStringWidth() * s
    height = height or ((o._text and o._text ~= "") and o:GetStringHeight() * s or 0)
  end
  local xs, ys = {}, {}
  for _, p in ipairs(pts) do
    local r = p.rel and p.rel ~= o and type(p.rel) == "table" and rawget(p.rel, "_points") and rect(p.rel)
    if r then
      xs[#xs + 1] = { h = hOf(p.point), at = r.l + hOf(p.relPoint) * (r.r - r.l) + p.x * s }
      ys[#ys + 1] = { v = vOf(p.point), at = r.b + vOf(p.relPoint) * (r.t - r.b) + p.y * s }
    end
  end
  depth = depth - 1
  local function solve(list, key, size)
    if #list == 0 then return nil end
    local a = list[1]
    for i = 2, #list do
      local b = list[i]
      if b[key] ~= a[key] then
        local lo, hi = a, b
        if lo[key] > hi[key] then lo, hi = hi, lo end
        local span = (hi.at - lo.at) / (hi[key] - lo[key])
        local start = lo.at - lo[key] * span
        return start, start + span
      end
    end
    size = size or 0
    local start = a.at - a[key] * size
    return start, start + size
  end
  local l, r = solve(xs, "h", width)
  local b, t = solve(ys, "v", height)
  if not (l and b) then return nil end
  return { l = l, r = r, t = t, b = b }
end
local function edge(o, k) local r = rect(o) return r and r[k] / o:GetEffectiveScale() end
function M:GetLeft() return edge(self, "l") end
function M:GetRight() return edge(self, "r") end
function M:GetTop() return edge(self, "t") end
function M:GetBottom() return edge(self, "b") end
function M:GetCenter() local r = rect(self) if r then local s = self:GetEffectiveScale() return (r.l + r.r) / 2 / s, (r.t + r.b) / 2 / s end end
function M:GetRect() local r = rect(self) if r then local s = self:GetEffectiveScale() return r.l / s, r.b / s, (r.r - r.l) / s, (r.t - r.b) / s end end
function M:GetWidth()
  if self._kind == "FontString" and not (self._w and self._w > 0) then return self:GetStringWidth() end
  local r = #self._points > 1 and rect(self)
  if r then return (r.r - r.l) / self:GetEffectiveScale() end
  return self._w or 0
end
function M:GetHeight()
  if self._kind == "FontString" and not (self._h and self._h > 0) then return self:GetStringHeight() end
  local r = #self._points > 1 and rect(self)
  if r then return (r.t - r.b) / self:GetEffectiveScale() end
  return self._h or 0
end
function M:GetSize() return self:GetWidth(), self:GetHeight() end

local function newFrame(kind, name, parent, template)
  if type(parent) == "string" then parent = env[parent] end
  local f = new(kind or "Frame", parent or env.UIParent, false, name)
  frames[#frames + 1] = { frame = f, file = loadingFile }
  if name then env[name] = f end
  template = template or ""
  if template:find("UIPanelButtonTemplate") or template:find("InputBoxTemplate") then
    for _, k in ipairs({ "Left", "Middle", "Right" }) do f[k] = new("Texture", f, true) end
  end
  if template:find("UIPanelButtonTemplate") then
    f._normalFont = "GameFontNormal"
    f:GetFontString(true)
    f.Text = f._fs
  end
  if template:find("ScrollFrameTemplate") then
    local bar = new("Slider", f, false)
    bar.ScrollUpButton, bar.ScrollDownButton, bar.ThumbTexture = new("Button", bar), new("Button", bar), new("Texture", bar, true)
    f.ScrollBar = bar
  end
  if template:find("BasicFrameTemplate") then
    f.CloseButton = new("Button", f) f.CloseButton:SetSize(24, 24) f.CloseButton:SetPoint("TOPRIGHT", 0, 0)
    f.TitleText = new("FontString", f, true) f.TitleText._font = "GameFontNormal"
    f.Inset = new("Frame", f)
    f.TitleBg = new("Texture", f, true)
  end
  if template:find("CheckButtonTemplate") or template:find("RadioButtonTemplate") then
    f.Text = new("FontString", f, true) f.Text._font = "GameFontNormalSmall" f.text = f.Text
  end
  if template:find("UIPanelCloseButton") then f:SetSize(24, 24) end
  return f
end

local stubs = {}
stubs.CreateFrame = newFrame
stubs.CreateFont = function(name) local o = fontObject(12) if name then env[name] = o end return o end
stubs.CreateColor = function(r, g, b, a) return { r = r, g = g, b = b, a = a, GetRGB = function(c) return c.r, c.g, c.b end, GetRGBA = function(c) return c.r, c.g, c.b, c.a end } end
stubs.UIParent = new("Frame", nil, false, "UIParent")
stubs.UIParent._fixed = { l = 0, r = 1920, t = 1080, b = 0 }
stubs.WorldFrame = new("Frame", nil, false, "WorldFrame")
stubs.Minimap = new("Frame", stubs.UIParent, false, "Minimap")
stubs.GameTooltip = new("GameTooltip", stubs.UIParent, false, "GameTooltip")
stubs.ItemRefTooltip = new("GameTooltip", stubs.UIParent, false, "ItemRefTooltip")
-- the game's fonts at their own sizes (Blizzard's FontStyles)
stubs.GameFontNormal = fontObject(12) stubs.GameFontHighlight = fontObject(12) stubs.GameFontDisable = fontObject(12)
stubs.GameFontNormalSmall = fontObject(10) stubs.GameFontHighlightSmall = fontObject(10) stubs.GameFontDisableSmall = fontObject(10)
stubs.GameFontNormalLarge = fontObject(16) stubs.GameFontHighlightLarge = fontObject(16) stubs.GameFontNormalHuge = fontObject(20)
stubs.ChatFontNormal = fontObject(14, "Fonts\\ARIALN.TTF") stubs.GameFontHighlightMedium = fontObject(14) stubs.NumberFontNormal = fontObject(14)
stubs.GameFontNormalMed3 = fontObject(14) stubs.GameFontWhite = fontObject(12) stubs.GameFontRed = fontObject(12) stubs.GameFontGreen = fontObject(12)
stubs.SystemFont_Shadow_Med1 = fontObject(12) stubs.Game15Font_o1 = fontObject(15) stubs.GameFontNormalOutline = fontObject(12)
stubs.UISpecialFrames = {}
stubs.SlashCmdList = {}
stubs.StaticPopupDialogs = {}
stubs.RAID_CLASS_COLORS = setmetatable({}, { __index = function() return { r = 1, g = 1, b = 1, colorStr = "ffffffff" } end })
stubs.issecretvalue = function() return false end
stubs.InCombatLockdown = function() return false end
stubs.IsEncounterInProgress = function() return false end
stubs.IsInGroup = function() return false end
stubs.IsInRaid = function() return false end
stubs.IsInInstance = function() return false, "none" end
stubs.GetInstanceInfo = function() return "Somewhere", "none", 0, "", 0, 0, false, 0 end
stubs.UnitIsGroupLeader = function() return false end
stubs.UnitIsGroupAssistant = function() return false end
stubs.UnitName = function(u) if u == "player" then return "Me", nil end return nil end
stubs.UnitFullName = function(u) if u == "player" then return "Me", "Realm" end return nil end
stubs.GetRealmName = function() return "Realm" end
stubs.GetNormalizedRealmName = function() return "Realm" end
stubs.UnitClass = function() return "Warrior", "WARRIOR", 1 end
stubs.UnitGUID = function() return "Player-1-0001" end
stubs.UnitExists = function(u) return u == "player" end
stubs.UnitLevel = function() return 80 end
stubs.UnitGroupRolesAssigned = function() return "NONE" end
stubs.GetNumGroupMembers = function() return 0 end
stubs.GetNumSubgroupMembers = function() return 0 end
stubs.GetSpecialization = function() return nil end
stubs.GetTime = function() return 1000 end
stubs.GetServerTime = function() return 1800000000 end
stubs.GetLocale = function() return "enUS" end
stubs.GetBuildInfo = function() return "12.0.5", "1", "Oct 1 2026", 120005 end
stubs.GetCVar = function() return nil end
stubs.GetCVarBool = function() return false end
stubs.GetNumMacros = function() return 0, 0 end
stubs.GetMacroInfo = function() return nil end
stubs.GetScreenWidth = function() return 1920 end
stubs.GetScreenHeight = function() return 1080 end
stubs.time = function(t) return os.time(t) end
stubs.date = os.date
stubs.debugprofilestop = function() return 0 end
stubs.strtrim = function(s) return ((s or ""):gsub("^%s+", ""):gsub("%s+$", "")) end
stubs.strsplit = function(sep, s, n) local out = {} for part in ((s or "") .. sep):gmatch("(.-)" .. sep:gsub("%p", "%%%0")) do out[#out + 1] = part end return unpack(out) end
stubs.strjoin = function(sep, ...) return table.concat({ ... }, sep) end
stubs.strlower, stubs.strupper, stubs.strlen, stubs.strsub, stubs.strfind = string.lower, string.upper, string.len, string.sub, string.find
stubs.strmatch, stubs.strrep, stubs.strbyte, stubs.strchar, stubs.gsub, stubs.format = string.match, string.rep, string.byte, string.char, string.gsub, string.format
stubs.tinsert, stubs.tremove, stubs.tconcat, stubs.sort = table.insert, table.remove, table.concat, table.sort
stubs.wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
stubs.tContains = function(t, v) for _, x in ipairs(t) do if x == v then return true end end return false end
stubs.CopyTable = function(t) local o = {} for k, v in pairs(t) do o[k] = v end return o end
stubs.floor, stubs.ceil, stubs.abs, stubs.max, stubs.min, stubs.sqrt = math.floor, math.ceil, math.abs, math.max, math.min, math.sqrt
stubs.mod = math.fmod
stubs.Ambiguate = function(name) return (name or ""):gsub("%-.*$", "") end
stubs.hooksecurefunc = function(t, name, fn)
  if type(t) == "string" then name, fn, t = t, name, env end
  local old = t[name]
  if type(old) == "function" then rawset(t, name, function(...) local r = { old(...) } fn(...) return unpack(r) end) end
end
stubs.geterrorhandler = function() return function(err) report("error handler", err) end end
stubs.seterrorhandler = function() end
stubs.securecallfunction = function(fn, ...) return fn(...) end
stubs.print = function() end
stubs.C_Timer = {
  After = function(_, fn) timers[#timers + 1] = fn end,
  NewTimer = function(_, fn) timers[#timers + 1] = fn return { Cancel = function() end, IsCancelled = function() return false end } end,
  NewTicker = function() return { Cancel = function() end, IsCancelled = function() return false end } end,
}
stubs.C_ChatInfo = { RegisterAddonMessagePrefix = function() return true end, IsAddonMessagePrefixRegistered = function() return true end,
  SendAddonMessage = function() return 0 end, InChatMessagingLockdown = function() return false end }
stubs.C_AddOns = { GetAddOnMetadata = function(_, field) if field == "Version" then return "1.4.9" end return nil end,
  IsAddOnLoaded = function() return false end, GetAddOnEnableState = function() return 0 end }
stubs.Enum = setmetatable({}, { __index = function() return setmetatable({}, { __index = function() return 0 end }) end })
local missing = { C_EncodingUtil = true, LibStub = true, CRTDB = true, CRTDBChar = true, CRTLootDB = true, BigWigsLoader = true, DBM = true,
  NSAPI = true, VMRT = true, RCLootCouncil = true, WeakAuras = true, C_EncounterTimeline = true, C_DamageMeter = true, Settings = true, SettingsPanel = true }
env = setmetatable({}, { __index = function(_, k)
  if missing[k] then return nil end
  local v = stubs[k]
  if v ~= nil then return v end
  v = _G[k]
  if v ~= nil then return v end
  return thing
end })
env._G = env

-- Load the addon -------------------------------------------------------------------------------------------
local CRT = {}
for i, file in ipairs(files) do
  loadingFile = file
  local fn, err = load(sources[i], "@" .. file, "t", env)
  if not fn then report(file, err) else
    local ok, e = pcall(fn, "CowfeeRaidTools", CRT)
    if not ok then report(file .. " (load)", e) end
  end
end
loadingFile = "(events)"
env.CRTDB = {}
local function fire(event, ...)
  for _, rec in ipairs(frames) do
    local f = rec.frame
    if f._events[event] and f._scripts.OnEvent then
      local ok, e = pcall(f._scripts.OnEvent, f, event, ...)
      if not ok then report(rec.file .. " " .. event, e) end
    end
  end
end
local function runTimers()
  for _ = 1, 5 do
    local list = timers
    timers = {}
    for _, fn in ipairs(list) do local ok, e = pcall(fn) if not ok then report("timer", e) end end
    if #timers == 0 then break end
  end
end
fire("ADDON_LOADED", "CowfeeRaidTools")
fire("PLAYER_LOGIN")
fire("PLAYER_ENTERING_WORLD", true, false)
runTimers()

-- Checks ---------------------------------------------------------------------------------------------------
local fails, passes = 0, 0
DEBUG_SCAN = os.getenv and os.getenv('TEXTFIT_DEBUG')
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
for _, e in ipairs(errors) do check(false, "a Lua error loading the addon: " .. e) end
local UI = CRT.UI
check(UI ~= nil and type(UI.CapFontSize) == "function", "UI.CapFontSize is there")

-- the shared fonts at a text size, in a look
local function setLook(theme, size)
  CRT.db.ui.fontSize = size
  UI:SetTheme(theme)
  CRT:ApplyFonts()
  runTimers()
end

-- 1. The 10 pt floor: every CRT font at the smallest text size, both looks.
for _, theme in ipairs({ "blizzard", "cowfee" }) do
  setLook(theme, 8)
  local seen, low = 0, {}
  for name, o in pairs(env) do
    if type(name) == "string" and name:match("^CRTFont") and type(o) == "table" and rawget(o, "isFont") then
      seen = seen + 1
      if o.size < 10 then low[#low + 1] = name .. " " .. o.size end
    end
  end
  table.sort(low)
  check(seen >= 15, theme .. ": the shared fonts are found (" .. seen .. ")")
  check(#low == 0, theme .. ", text size 8: no CRT font under 10 pt: " .. table.concat(low, ", "))
  print((#low == 0 and "ok" or "FAIL") .. " " .. theme .. " at text size 8: CRTFontNormal " .. env.CRTFontNormal.size .. ", CRTFontSmall " .. env.CRTFontSmall.size .. ", CRTFontDisableTiny " .. env.CRTFontDisableTiny.size .. ", CRTFontButtonSmall " .. env.CRTFontButtonSmall.size .. ", CRTFontLarge " .. env.CRTFontLarge.size)
end
-- and UI.CapFontSize sits with the font code, not in StatusMark.lua
do
  local home
  for i, file in ipairs(files) do
    if sources[i]:find("function UI.CapFontSize", 1, true) then home = (home and (home .. ", ") or "") .. file end
  end
  check(home == "CRT_Core/UI/Fonts.lua", "UI.CapFontSize is made in CRT_Core/UI/Fonts.lua, next to the fonts' text-size code, and nowhere else: " .. tostring(home))
end

-- 2. Every page at text size 8 and 22, both looks.
local PAGE_KEYS = {}
if #onlyPages > 0 then PAGE_KEYS = onlyPages else
  for _, key in ipairs(UI.order) do PAGE_KEYS[#PAGE_KEYS + 1] = key end
end
if CRT.Interrupts and CRT.Interrupts.SetEnabled then pcall(CRT.Interrupts.SetEnabled, CRT.Interrupts, true) end
local tabSet = {}
local function isTab(b) for _, t in ipairs(UI.tabs or {}) do if t == b then return true end end return false end

-- a text button: a Button (not a check box) with a label, or a registered tab; its label's font string
local function labelOf(b)
  if b._kind ~= "Button" then return nil end
  local fsx = rawget(b, "_fs")
  if fsx and fsx._text and plain(fsx._text):match("%S") then return fsx end
  local t = rawget(b, "text")
  if type(t) == "table" and t._kind == "FontString" and isTab(b) and t._text and plain(t._text):match("%S") and t._shown ~= false then return t end
  return nil
end
local function inScroll(o)
  local p = o._parent
  while p do
    if p._kind == "ScrollFrame" or rawget(p, "_scrollParent") or p._clips then return true end
    p = p._parent
  end
  return false
end
local function collect(f, out)
  for _, c in ipairs(f._children) do
    if c._shown then
      if labelOf(c) then out[#out + 1] = c end
      collect(c, out)
    end
  end
  return out
end
local function describe(b) local fsx = labelOf(b) return '"' .. plain(fsx and fsx._text or "?") .. '"' end
-- the other parts a text button must not run into: a box (a frame with a backdrop), an edit box, a scroll area, a
-- dropdown, a slider or a check box, shown, with a place and a size, that is not the button's own parent or child
local SOLID = { EditBox = true, ScrollFrame = true, CheckButton = true, Slider = true, DropdownButton = true }
-- a (?) icon (UI.Help: b.crtHelp) and a line of text (a font string with text, not a button's own label) count too
local function solids(f, out)
  if not labelOf(f) then
    for _, r in ipairs(f._regions) do
      if r._kind == "FontString" and r._shown and r._text and plain(r._text):match("%S") and not inScroll(r) then out[#out + 1] = r end
    end
  end
  for _, c in ipairs(f._children) do
    if c._shown then
      if (SOLID[c._kind] or rawget(c, "_backdrop") or rawget(c, "crtHelp")) and not labelOf(c) and not inScroll(c) then out[#out + 1] = c end
      if c._kind ~= "ScrollFrame" then solids(c, out) end
    end
  end
  return out
end
local function related(a, b)
  local p = a
  while p do if p == b then return true end p = p._parent end
  p = b
  while p do if p == a then return true end p = p._parent end
  return false
end
local function what(o)
  if o._kind == "FontString" then return 'text "' .. plain(o._text):sub(1, 40) .. '"' end
  return (rawget(o, "crtHelp") and "(?) icon") or (o._kind .. (rawget(o, "_backdrop") and " box" or ""))
end

local function scan(pf, where)
  local bad = 0
  local pr = rect(pf)
  local list = collect(pf, {})
  local placed = {}
  for _, b in ipairs(list) do
    local fsx = labelOf(b)
    local need = fsx:RawWidth() + FIT_PAD
    local w = b:GetWidth()
    -- a label wrapped to its button's width (UI.FitButton's room) needs that width, and its lines' height
    if fsx._w and fsx._w > 0 and fsx._wrap ~= false then
      need = math.min(need, fsx._w + FIT_PAD)
      if b:GetHeight() + 0.5 < fsx:GetStringHeight() then bad = bad + 1 check(false, where .. ": " .. describe(b) .. " is " .. math.floor(b:GetHeight()) .. " high, its wrapped label needs " .. math.ceil(fsx:GetStringHeight())) end
    end
    if w + 0.5 < need then bad = bad + 1 check(false, where .. ": " .. describe(b) .. " is " .. math.floor(w) .. " wide, its label needs " .. math.ceil(need)) end
    local r = rect(b)
    if r and not inScroll(b) then
      local s = b:GetEffectiveScale()
      if pr and r.r > pr.r + 0.5 then bad = bad + 1 check(false, where .. ": " .. describe(b) .. " runs " .. math.ceil(r.r - pr.r) .. " past the page's right edge") end
      if pr and r.b < pr.b - 0.5 then bad = bad + 1 check(false, where .. ": " .. describe(b) .. " runs " .. math.ceil(pr.b - r.b) .. " past the page's bottom edge") end
      placed[#placed + 1] = { b = b, r = r }
    end
  end
  for i = 1, #placed do
    for j = i + 1, #placed do
      local a, c = placed[i].r, placed[j].r
      local ox = math.min(a.r, c.r) - math.max(a.l, c.l)
      local oy = math.min(a.t, c.t) - math.max(a.b, c.b)
      if ox > 0.5 and oy > 0.5 then bad = bad + 1 check(false, where .. ": " .. describe(placed[i].b) .. " and " .. describe(placed[j].b) .. " overlap by " .. math.ceil(ox) .. " x " .. math.ceil(oy)) end
    end
  end
  for _, o in ipairs(solids(pf, {})) do
    local r = rect(o)
    if r and r.r - r.l > 1 and r.t - r.b > 1 then
      for _, pb in ipairs(placed) do
        if not related(pb.b, o) then
          local a = pb.r
          local ox = math.min(a.r, r.r) - math.max(a.l, r.l)
          local oy = math.min(a.t, r.t) - math.max(a.b, r.b)
          -- a line of text counts when the button reaches into it on its own row: a row of text a few points taller
          -- than its row's spacing at 22 pt (a page title over its tabs) is a matter of row heights, not of widths
          local slack = o._kind == "FontString" and TEXT_ROW_SLACK or 0.5
          if ox > 0.5 and oy > slack then bad = bad + 1 check(false, where .. ": " .. describe(pb.b) .. " runs into a " .. what(o) .. " by " .. math.ceil(ox) .. " x " .. math.ceil(oy)) end
        end
      end
    end
  end
  if bad == 0 then passes = passes + 1 end
  if DEBUG_SCAN then print("scan " .. where .. ": " .. #list .. " buttons, " .. #placed .. " placed, page " .. tostring(pr and (pr.l .. "," .. pr.t))) end
  return #list
end

-- the page's tabs and the tabs they open: each clicked once, then the page scanned
local function visitPage(key, where)
  local page = UI.pages[key]
  if not page or page.hidden then return end
  local ok, e = pcall(UI.Show, UI, key)
  runTimers()
  if not ok then check(false, where .. " " .. key .. ": opening the page: " .. tostring(e)) return end
  local pf = page.frame
  if not pf then check(false, where .. " " .. key .. ": no page frame") return end
  local clicked = {}
  local total = scan(pf, where .. " " .. page.title)
  for _ = 1, 4 do
    local more = false
    for _, t in ipairs(UI.tabs) do
      if not clicked[t] and t:IsVisible() and t._scripts.OnClick then
        local p = t._parent
        local mine = false
        while p do if p == pf then mine = true break end p = p._parent end
        if mine then
          clicked[t] = true
          more = true
          local okc, ec = pcall(t._scripts.OnClick, t, "LeftButton")
          runTimers()
          if not okc then check(false, where .. " " .. page.title .. ": clicking the tab " .. describe(t) .. ": " .. tostring(ec)) end
          total = total + scan(pf, where .. " " .. page.title .. " > " .. plain(t.text and t.text._text or "?"))
        end
      end
    end
    if not more then break end
  end
  return total
end

local looks = { { "blizzard", 8 }, { "blizzard", 22 }, { "cowfee", 22 }, { "cowfee", 8 } }
for _, look in ipairs(looks) do
  setLook(look[1], look[2])
  local where = (look[1] == "blizzard" and "Classic" or "Modern") .. " " .. look[2] .. " pt:"
  local before = fails
  local buttons = 0
  for _, key in ipairs(PAGE_KEYS) do buttons = buttons + (visitPage(key, where) or 0) end
  if fails == before then print("ok " .. where .. " every page's text buttons fit, none overlap, none past the right edge (" .. buttons .. " checked)") end
end
for i = 1, #errors do if not errors[i]:find("^done") then end end

print(passes .. " passed, " .. fails .. " failed")
TEXTFIT_FAILS = fails
`;

const files = tocFiles();
const sources = files.map(f => fs.readFileSync(path.join(root, f), 'utf8'));
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const list of [files, sources, onlyPages]) {
  lua.lua_createtable(L, list.length, 0);
  list.forEach((s, i) => { lua.lua_pushstring(L, to_luastring(s)); lua.lua_rawseti(L, -2, i + 1); });
}
if (lua.lua_pcall(L, 3, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_getglobal(L, to_luastring('TEXTFIT_FAILS'));
process.exit(lua.lua_tonumber(L, -1) > 0 ? 1 : 0);
