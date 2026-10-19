local ADDON, CRT = ...

-- Loot Master's data, with no frames: the response buttons, a loot session, the rows the looter sees and
-- the message format. Design: decisions/2026-10-18 Cowfee Raid Tools Loot Master.md in the vault.
--
-- A session is one boss's items (or a test's sample items), run by the raid leader, the looter:
--   items     { itemString, link, ilvl, award = { name, response } }
--   players   by full name: { name, crt (nil until known, then true or false), class, role,
--             answers[itemIndex] = { response, note, roll, gear = { { id, ilvl } }, ilvl, state, asked } }
-- An answer's state: waiting (has CRT, no answer yet), answered, reroll (asked to roll again), timeout
-- (no answer in RESPONSE_SECONDS), nocrt (never said hello). A raider's roll is the first one seen for that
-- item; a later one never replaces it, so nobody rolls again for a better number unless asked.
--
-- Messages (prefix CRTLoot1, fields split by "|", see Wire): the looter sends S (session), I (item),
-- Q (show the popup again), X (roll again), A (award), E (end); raiders send K (hello), R (answer), L (roll).

local LM = { listeners = {} }
CRT.LootMaster = LM

LM.PREFIX = "CRTLoot1"
LM.VERSION = "0.24.0"
LM.RESPONSE_SECONDS = 60 -- how long raiders have to answer
LM.HELLO_SECONDS = 5 -- after this, raiders who never said hello have no CRT
LM.MAX_ITEMS = 8

-- The default buttons, in the order raiders see them; weight sorts the looter's list (higher first).
LM.RESPONSES = {
    { key = "bis", label = "BiS", color = { 0.24, 0.86, 0.35 }, weight = 100 },
    { key = "up", label = "Upgrade", color = { 0.56, 0.82, 0.31 }, weight = 80 },
    { key = "minor", label = "Minor", color = { 0.90, 0.82, 0.29 }, weight = 50 },
    { key = "os", label = "Offspec", color = { 0.90, 0.60, 0.24 }, weight = 30 },
    { key = "tmog", label = "Transmog", color = { 0.71, 0.55, 0.91 }, weight = 10 },
    { key = "pass", label = "Pass", color = { 0.54, 0.54, 0.54 }, weight = 0 },
}
local byKey = {}
for _, r in ipairs(LM.RESPONSES) do
    byKey[r.key] = r
end

function LM:Response(key)
    return byKey[key]
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
        items = {}, players = {}, order = {},
    }, Session)
    for i, it in ipairs(opts.items or {}) do
        if i > LM.MAX_ITEMS then
            break
        end
        s.items[i] = { itemString = it.itemString, link = it.link, ilvl = it.ilvl }
    end
    return s
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
    if not self.items[index] or not byKey[fields.response] then
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

-- Answers not in after RESPONSE_SECONDS become timeouts. Returns true when anything changed.
function Session:Tick()
    local now, changed = GetTime(), false
    for _, p in pairs(self.players) do
        if p.crt then
            for index in ipairs(self.items) do
                local a = answer(p, index)
                if not a.response and a.state ~= "timeout" and now - (a.asked or self.started) > LM.RESPONSE_SECONDS then
                    a.state = "timeout"
                    changed = true
                end
            end
        end
    end
    return changed
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
    local r = a and a.response and byKey[a.response]
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
