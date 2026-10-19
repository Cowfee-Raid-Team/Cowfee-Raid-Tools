local ADDON, CRT = ...

-- Loot Master's data, with no frames: the response buttons, a loot session, the rows the looter sees and
-- the message format. Design: decisions/2026-10-18 Cowfee Raid Tools Loot Master.md in the vault.
--
-- A session is one boss's items (or a test's sample items), run by the raid leader, the looter:
--   items     { itemString, link, ilvl, award = { name, response } }
--   players   by full name: { name, crt (nil until known, then true or false), class, role,
--             answers[itemIndex] = { response, note, roll, gear = { { id, ilvl } }, ilvl, state, asked } }
-- An answer's state: waiting (has CRT, no answer yet), answered, reroll (asked to roll again), timeout
-- (no answer in the session's seconds), nocrt (never said hello). A raider's roll is the first one seen for that
-- item; a later one never replaces it, so nobody rolls again for a better number unless asked.
--
-- Messages (prefix CRTLoot1, fields split by "|", see Wire): the looter sends S (session), I (item),
-- B (a response button), Q (show the popup again), X (roll again), A (award), E (end); raiders send K
-- (hello), R (answer), L (roll).

local LM = { listeners = {} }
CRT.LootMaster = LM

LM.PREFIX = "CRTLoot1"
LM.VERSION = "0.24.0"
LM.HELLO_SECONDS = 5 -- after this, raiders who never said hello have no CRT
LM.MAX_ITEMS = 8
LM.MAX_RESPONSES = 8
LM.LABEL_MAX = 16 -- letters in a button's label
LM.WEIGHT_MAX = 100

-- The default buttons, in the order raiders see them; weight sorts the looter's list (higher first).
-- icon (optional): a texture path or file ID shown at the left of the button. Pass is always last, can't
-- be removed, and weighs 0. Your own set is saved in CRTDB lootmaster.responses only once you change it
-- (Settings tab), so a default can still change in a later version for everyone who never edited it.
LM.DEFAULT_RESPONSES = {
    { key = "bis", label = "BiS", color = { 0.24, 0.86, 0.35 }, weight = 100 },
    { key = "up", label = "Upgrade", color = { 0.56, 0.82, 0.31 }, weight = 80 },
    { key = "minor", label = "Minor", color = { 0.90, 0.82, 0.29 }, weight = 50 },
    { key = "os", label = "Offspec", color = { 0.90, 0.60, 0.24 }, weight = 30 },
    { key = "tmog", label = "Transmog", color = { 0.71, 0.55, 0.91 }, weight = 10 },
    { key = "pass", label = "Pass", color = { 0.54, 0.54, 0.54 }, weight = 0 },
}

function LM:Settings()
    return CRT.db.lootmaster
end

-- How long raiders have to answer, in seconds (Settings tab).
function LM:ResponseSeconds()
    return tonumber(self:Settings().responseSeconds) or 60
end

local function copyResponse(r)
    return {
        key = r.key, label = r.label, weight = r.weight, icon = r.icon,
        color = { r.color and r.color[1] or 1, r.color and r.color[2] or 1, r.color and r.color[3] or 1 },
    }
end

-- A response set made safe: known fields only, at most MAX_RESPONSES, one Pass, last, weighing 0.
function LM.CleanResponses(list)
    local out, seen, pass = {}, {}, nil
    for _, r in ipairs(type(list) == "table" and list or {}) do
        if type(r) == "table" and type(r.key) == "string" and r.key ~= "" and not seen[r.key] then
            seen[r.key] = true
            local c = copyResponse(r)
            c.label = tostring(c.label or c.key):sub(1, LM.LABEL_MAX)
            c.weight = math.max(0, math.min(LM.WEIGHT_MAX, math.floor(tonumber(c.weight) or 0)))
            if c.key == "pass" then
                c.weight = 0
                pass = c
            elseif #out < LM.MAX_RESPONSES - 1 then
                out[#out + 1] = c
            end
        end
    end
    out[#out + 1] = pass or copyResponse(LM.DEFAULT_RESPONSES[#LM.DEFAULT_RESPONSES])
    return out
end

-- Your response set: the saved one, or the defaults.
function LM:Responses()
    local saved = self:Settings().responses
    if type(saved) == "table" and #saved > 0 then
        return LM.CleanResponses(saved)
    end
    return LM.CleanResponses(LM.DEFAULT_RESPONSES)
end

function LM:SaveResponses(list)
    self:Settings().responses = LM.CleanResponses(list)
    self:Fire("responses")
end

function LM:ResetResponses()
    self:Settings().responses = nil
    self:Fire("responses")
end

-- Adds a response before Pass, with a key no other response uses. Returns its key, or nil when full.
function LM:AddResponse()
    local list = self:Responses()
    if #list >= LM.MAX_RESPONSES then
        return nil
    end
    local used = {}
    for _, r in ipairs(list) do
        used[r.key] = true
    end
    local n = 1
    while used["r" .. n] do
        n = n + 1
    end
    local key = "r" .. n
    table.insert(list, #list, { key = key, label = "New", color = { 0.6, 0.6, 0.6 }, weight = 20 })
    self:SaveResponses(list)
    return key
end

function LM:RemoveResponse(key)
    if key == "pass" then
        return false
    end
    local list = self:Responses()
    for i, r in ipairs(list) do
        if r.key == key then
            table.remove(list, i)
            self:SaveResponses(list)
            return true
        end
    end
    return false
end

-- Moves a response up (-1) or down (1); Pass stays last.
function LM:MoveResponse(key, dir)
    local list = self:Responses()
    for i, r in ipairs(list) do
        if r.key == key and key ~= "pass" then
            local j = i + dir
            if j >= 1 and j < #list then
                list[i], list[j] = list[j], list[i]
                self:SaveResponses(list)
                return true
            end
            return false
        end
    end
    return false
end

-- fields: label, color, weight, icon (an empty icon removes it).
function LM:UpdateResponse(key, fields)
    local list = self:Responses()
    for _, r in ipairs(list) do
        if r.key == key then
            for k, v in pairs(fields) do
                r[k] = v
            end
            if r.icon == "" then
                r.icon = nil
            end
            self:SaveResponses(list)
            return true
        end
    end
    return false
end

-- What an item is rolled as, set by the looter per item. It shows on the item's tab and the raider's
-- panel, and is %r in the award message (else the winner's response is). The textures are Blizzard's
-- group loot icons, seen in game with /crt dev loot probe icons on 2026-10-18.
LM.ROLL_TYPES = {
    { key = "need", label = "Need", icon = "Interface\\Buttons\\UI-GroupLoot-Dice-Up" },
    { key = "greed", label = "Greed", icon = "Interface\\Buttons\\UI-GroupLoot-Coin-Up" },
    { key = "de", label = "Disenchant", icon = "Interface\\Buttons\\UI-GroupLoot-DE-Up" },
}
local rollTypes = {}
for _, t in ipairs(LM.ROLL_TYPES) do
    rollTypes[t.key] = t
end

function LM:RollType(key)
    return rollTypes[key]
end

-- The award message: %i item, %p player, %r roll type or response, %v roll (or the "no roll" text).
LM.AWARD_DEFAULT = "%i awarded to %p for %r with a %v roll."
LM.NO_ROLL_CHOICES = { "-", "0", "no" }

-- fields: item, player, rollType, response, roll, noRoll. Pure, for tests.
function LM.FormatAward(template, f)
    local values = {
        i = f.item or "?",
        p = f.player or "?",
        r = f.rollType or f.response or "?",
        v = f.roll and tostring(f.roll) or (f.noRoll or "-"),
    }
    return (tostring(template or LM.AWARD_DEFAULT):gsub("%%(%a)", function(k)
        return values[k] or ("%" .. k)
    end))
end

-- A response of your set, by key (the looter's own set; a session uses the set it was started with).
function LM:Response(key)
    for _, r in ipairs(self:Responses()) do
        if r.key == key then
            return r
        end
    end
    return nil
end

function LM:OnChange(fn)
    self.listeners[#self.listeners + 1] = fn
end

function LM:Fire(what, ...)
    for _, fn in ipairs(self.listeners) do
        local ok, err = pcall(fn, what, ...)
        if not ok and geterrorhandler then
            geterrorhandler()(err)
        end
    end
end

-- Where each kind of gear is worn, for the raider's "what I have" (C_Item.GetItemInfoInstant's equip
-- location). Rings, trinkets and one-handers compare against both slots.
LM.SLOTS = {
    INVTYPE_HEAD = { 1 }, INVTYPE_NECK = { 2 }, INVTYPE_SHOULDER = { 3 }, INVTYPE_CHEST = { 5 },
    INVTYPE_ROBE = { 5 }, INVTYPE_WAIST = { 6 }, INVTYPE_LEGS = { 7 }, INVTYPE_FEET = { 8 },
    INVTYPE_WRIST = { 9 }, INVTYPE_HAND = { 10 }, INVTYPE_FINGER = { 11, 12 }, INVTYPE_TRINKET = { 13, 14 },
    INVTYPE_CLOAK = { 15 }, INVTYPE_WEAPON = { 16, 17 }, INVTYPE_2HWEAPON = { 16 },
    INVTYPE_WEAPONMAINHAND = { 16 }, INVTYPE_WEAPONOFFHAND = { 17 }, INVTYPE_HOLDABLE = { 17 },
    INVTYPE_SHIELD = { 17 }, INVTYPE_RANGED = { 16 }, INVTYPE_RANGEDRIGHT = { 16 },
}

-- The session ---------------------------------------------------------------------------------------

local Session = {}
Session.__index = Session
LM.Session = Session

-- opts: id, test, leader, items ({ itemString, link, ilvl })
function Session.New(opts)
    local s = setmetatable({
        id = opts.id, test = opts.test and true or false, leader = opts.leader, started = GetTime(),
        items = {}, players = {}, order = {}, seconds = opts.seconds or LM:ResponseSeconds(),
        responses = LM.CleanResponses(opts.responses or LM:Responses()), byKey = {},
    }, Session)
    for _, r in ipairs(s.responses) do
        s.byKey[r.key] = r
    end
    for i, it in ipairs(opts.items or {}) do
        if i > LM.MAX_ITEMS then
            break
        end
        s.items[i] = { itemString = it.itemString, link = it.link, ilvl = it.ilvl }
    end
    return s
end

-- A response of this session's set.
function Session:Response(key)
    return self.byKey[key]
end

function Session:Player(name)
    local p = self.players[name]
    if not p then
        p = { name = name, answers = {} }
        self.players[name] = p
        self.order[#self.order + 1] = name
    end
    return p
end

-- Everyone in the group when the session starts.
function Session:Expect(names)
    for _, n in ipairs(names) do
        self:Player(n)
    end
end

function Session:Ack(name, version)
    local p = self:Player(name)
    p.crt, p.version = true, version
end

-- After HELLO_SECONDS: everyone who never said hello has no CRT.
function Session:MarkNoCRT()
    for _, p in pairs(self.players) do
        if p.crt == nil then
            p.crt = false
        end
    end
end

local function answer(p, index)
    local a = p.answers[index]
    if not a then
        a = { asked = GetTime() }
        p.answers[index] = a
    end
    return a
end

-- fields: response, note, role, class, ilvl, gear ({ { id, ilvl } })
function Session:Answer(name, index, fields)
    if not self.items[index] or not self.byKey[fields.response] then
        return false
    end
    local p = self:Player(name)
    p.crt = true
    p.class = fields.class or p.class
    p.role = fields.role or p.role
    local a = answer(p, index)
    a.response, a.note, a.ilvl, a.gear = fields.response, fields.note, fields.ilvl, fields.gear or {}
    a.state = "answered"
    return true
end

-- The first roll seen counts; a later one only when the looter asked for it.
function Session:Roll(name, index, roll)
    local p = self.players[name]
    local a = p and p.answers[index]
    if not a or not roll then
        return false
    end
    if a.roll and a.state ~= "reroll" then
        return false
    end
    a.roll = roll
    if a.state == "reroll" then
        a.state = a.response and "answered" or "waiting"
    end
    return true
end

function Session:CanReroll(name, index)
    local p = self.players[name]
    local a = p and p.answers[index]
    return (p and p.crt and a and a.response and a.response ~= "pass" and a.roll == nil and a.state ~= "reroll") and true or false
end

function Session:CanResend(name)
    local p = self.players[name]
    return (p and p.crt ~= false) and true or false
end

function Session:AskReroll(name, index)
    if not self:CanReroll(name, index) then
        return false
    end
    self.players[name].answers[index].state = "reroll"
    return true
end

-- Wipes an answer so the raider can pick again (a re-sent popup does this too).
function Session:Clear(name, index)
    local p = self.players[name]
    if not p then
        return
    end
    p.answers[index] = { asked = GetTime(), state = p.crt and "waiting" or nil }
end

-- Answers not in after the session's seconds become timeouts. Returns true when anything changed.
function Session:Tick()
    local now, changed = GetTime(), false
    for _, p in pairs(self.players) do
        if p.crt then
            for index in ipairs(self.items) do
                local a = answer(p, index)
                if not a.response and a.state ~= "timeout" and now - (a.asked or self.started) > self.seconds then
                    a.state = "timeout"
                    changed = true
                end
            end
        end
    end
    return changed
end

function Session:SetRollType(index, key)
    local item = self.items[index]
    if item then
        item.rollType = rollTypes[key] and key or nil
    end
end

-- The columns the looter can sort by, and the value each sorts on.
LM.SORT_VALUES = {
    name = function(r) return r.name:lower() end,
    role = function(r) return r.role or "" end,
    response = function(r) return r.weight end,
    ilvl = function(r) return r.ilvl end,
    gear = function(r) return r.diff end,
    note = function(r) return r.note and r.note:lower() end,
    roll = function(r) return r.roll end,
    score = function(r) return r.score end,
}

-- Sorts rows by one column (dir 1 low to high, -1 high to low); rows without a value go last, and ties
-- keep the order they came in (Rows' default order).
function LM.SortRows(rows, key, dir)
    local value = LM.SORT_VALUES[key]
    if not value then
        return rows
    end
    local pos = {}
    for i, r in ipairs(rows) do
        pos[r] = i
    end
    table.sort(rows, function(a, b)
        local x, y = value(a), value(b)
        if x == nil or y == nil then
            if (x == nil) ~= (y == nil) then
                return y == nil
            end
            return pos[a] < pos[b]
        end
        if x ~= y then
            if dir < 0 then
                return x > y
            end
            return x < y
        end
        return pos[a] < pos[b]
    end)
    return rows
end

function Session:Award(index, name, response)
    local item = self.items[index]
    if item then
        item.award = { name = name, response = response }
    end
end

function Session:Answered(index)
    local n = 0
    for _, p in pairs(self.players) do
        if p.answers[index] and p.answers[index].response then
            n = n + 1
        end
    end
    return n
end

-- Raiders with CRT who have not answered this item.
function Session:Missing(index)
    local out = {}
    for _, name in ipairs(self.order) do
        local p = self.players[name]
        local a = p.answers[index]
        if p.crt and not (a and a.response) then
            out[#out + 1] = name
        end
    end
    return out
end

local function stateOf(p, a)
    if p.crt == false then
        return "nocrt"
    end
    if a and a.state then
        return a.state
    end
    return "waiting"
end

-- One row for a player and item.
function Session:Row(name, index)
    local p = self.players[name]
    if not p then
        return nil
    end
    local a = p.answers[index]
    local item = self.items[index]
    local low
    for _, g in ipairs(a and a.gear or {}) do
        if g.ilvl and (not low or g.ilvl < low) then
            low = g.ilvl
        end
    end
    local r = a and a.response and self.byKey[a.response]
    return {
        name = name, class = p.class, role = p.role, crt = p.crt, state = stateOf(p, a),
        response = a and a.response, weight = r and r.weight or (p.crt == false and -2 or -1),
        note = a and a.note, roll = a and a.roll, ilvl = a and a.ilvl, gear = a and a.gear or {},
        diff = (item and item.ilvl and low) and (item.ilvl - low) or nil,
    }
end

-- Every player's row for an item: response weight, then Raider Score (score(name), higher first), then
-- roll, then name.
function Session:Rows(index, score)
    local rows = {}
    for _, name in ipairs(self.order) do
        local r = self:Row(name, index)
        r.score = score and score(name) or nil
        rows[#rows + 1] = r
    end
    table.sort(rows, function(a, b)
        if a.weight ~= b.weight then
            return a.weight > b.weight
        end
        if (a.score or 0) ~= (b.score or 0) then
            return (a.score or 0) > (b.score or 0)
        end
        if (a.roll or -1) ~= (b.roll or -1) then
            return (a.roll or -1) > (b.roll or -1)
        end
        return a.name < b.name
    end)
    return rows
end

-- The message format ---------------------------------------------------------------------------------

-- "<kind>|<field>|<field>..." in one addon message (255 bytes at most). A field never carries "|" (it
-- becomes "/"); the last field, the note, is cut to fit.
local Wire = {}
LM.Wire = Wire
local MAX_MESSAGE = 255

function Wire.Encode(kind, fields)
    local parts = { kind }
    for i, v in ipairs(fields) do
        parts[i + 1] = tostring(v == nil and "" or v):gsub("|", "/")
    end
    local msg = table.concat(parts, "|")
    if #msg > MAX_MESSAGE then
        local last = parts[#parts]
        parts[#parts] = last:sub(1, math.max(0, #last - (#msg - MAX_MESSAGE)))
        msg = table.concat(parts, "|")
    end
    return msg
end

function Wire.Decode(msg)
    if type(msg) ~= "string" then
        return nil
    end
    local kind, rest = msg:match("^(%u)|(.*)$")
    if not kind then
        return nil
    end
    local fields = {}
    for f in (rest .. "|"):gmatch("(.-)|") do
        fields[#fields + 1] = f
    end
    return kind, fields
end

-- A colour as six hex digits, and back.
function Wire.Color(c)
    return string.format("%02x%02x%02x", math.floor((c[1] or 1) * 255 + 0.5), math.floor((c[2] or 1) * 255 + 0.5),
        math.floor((c[3] or 1) * 255 + 0.5))
end

function Wire.ParseColor(text)
    local r, g, b = tostring(text or ""):match("^(%x%x)(%x%x)(%x%x)$")
    if not r then
        return { 1, 1, 1 }
    end
    return { tonumber(r, 16) / 255, tonumber(g, 16) / 255, tonumber(b, 16) / 255 }
end

-- "id:ilvl" for a piece of gear.
function Wire.GearText(g)
    return g and g.id and (g.id .. ":" .. math.floor((g.ilvl or 0) + 0.5)) or ""
end

function Wire.Gear(text)
    local id, ilvl = tostring(text or ""):match("^(%d+):(%d+)$")
    if not id then
        return nil
    end
    return { id = tonumber(id), ilvl = tonumber(ilvl) }
end
