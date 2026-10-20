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
-- Messages (prefix LM.PREFIX, fields split by "|", see Wire): the looter sends S (session), I (item),
-- B (a response button), Q (show the popup again), X (roll again), A (award), E (end); raiders send K
-- (hello), R (answer), L (roll).

local LM = { listeners = {} }
CRT.LootMaster = LM

LM.PREFIX = "CRTLootRemaster" -- since 0.25 (0.24 was CRTLoot1). A new protocol gets a new word, never a number: a prefix is 16 characters at most
LM.VERSION = "0.29.0"
-- The oldest leader's CRT a raider's auto-pass gate trusts (LootMaster/AutoPass.lua): 0.29.0 is the first
-- whose leader rolls Need, Greed or Transmog (LootMaster/Rolls.lua), so no raider passes for a leader who
-- doesn't roll.
LM.LOOTING_SINCE = "0.29.0"
LM.LOOTING_AWAY = 600 -- seconds the raid leader may be out of the instance (a wipe) before CRT Looting turns off
LM.FILTER_SYNC_SINCE = "0.28.0" -- a receiver from this version on takes the loot filter in a sync (LootMaster/Sync.lua)
LM.AUTO_TMOG_SINCE = "0.26.0" -- a looter from this version on accepts the built-in Transmog (LM.TRANSMOG)
LM.HELLO_SECONDS = 5 -- after this, raiders who never said hello have no CRT
LM.READY_SECONDS = 10 -- a raider who said hello but never got everything is sent the session again, once
LM.RESTORE_HOURS = 3 -- a saved session older than this is not restored after a /reload
LM.BOSS_SECONDS = 600 -- a session started this soon after a boss kill shows the boss's name
LM.MAX_ITEMS = 8
LM.MAX_RESPONSES = 8
LM.LABEL_MAX = 16 -- letters in a button's label
LM.WEIGHT_MAX = 100

-- The icons a response button can show: Blizzard's group loot icons, each seen in game with
-- /crt dev loot probe icons on 2026-10-18 (files from the loot frames, the transmog one an atlas from
-- retail's GroupLootFrame.xml). A response stores the key.
LM.ICONS = {
    { key = "need", label = "Need", file = "Interface\\Buttons\\UI-GroupLoot-Dice-Up" },
    { key = "greed", label = "Greed", file = "Interface\\Buttons\\UI-GroupLoot-Coin-Up" },
    { key = "transmog", label = "Transmog", atlas = "lootroll-toast-icon-transmog-up" },
    { key = "de", label = "Disenchant", file = "Interface\\Buttons\\UI-GroupLoot-DE-Up" },
    { key = "pass", label = "Pass", file = "Interface\\Buttons\\UI-GroupLoot-Pass-Up" },
}
local iconByKey = {}
for _, ic in ipairs(LM.ICONS) do
    iconByKey[ic.key] = ic
    iconByKey[ic.label:lower()] = ic
end

-- The icon for a key (or its label, any case), or nil.
function LM.Icon(key)
    return type(key) == "string" and iconByKey[key:lower()] or nil
end

-- Shows an icon on a texture (a file or an atlas); hides the texture for no icon.
function LM.SetIconTexture(texture, key)
    local ic = LM.Icon(key)
    if ic and ic.atlas then
        texture:SetAtlas(ic.atlas)
    else
        texture:SetTexture(ic and ic.file or nil)
    end
    texture:SetShown(ic ~= nil)
end

-- The icon as text markup, for menus and labels.
function LM.IconMarkup(key, size)
    local ic = LM.Icon(key)
    size = size or 16
    if not ic then
        return ""
    elseif ic.atlas then
        return string.format("|A:%s:%d:%d|a", ic.atlas, size, size)
    end
    return string.format("|T%s:%d:%d|t", ic.file, size, size)
end

-- The default buttons, in the order raiders see them; weight sorts the looter's list (higher first).
-- icon (optional): a key of LM.ICONS, shown at the left of the button. Pass is always last, can't
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

-- The built-in Transmog: the answer a raider's CRT gives for an item they can't use, when the looter's set has
-- no Transmog of its own. Every session accepts it, sorts it by this weight and shows it in the looter window,
-- but it is not a raider button. Weight 1: below any button weighted above 0, above a weight-0 Pass.
LM.TRANSMOG = { key = "tmog", label = "Transmog", color = { 0.71, 0.55, 0.91 }, weight = 1, icon = "transmog", builtin = true }

-- Whether a response is a Transmog: the tmog key, or the label Transmog in any case. The transmog icon
-- alone doesn't count (a looter may put it on Offspec).
function LM.IsTransmog(r)
    return type(r) == "table" and (r.key == "tmog" or (type(r.label) == "string" and r.label:lower() == "transmog"))
end

-- The key an item you can't use is answered with: the set's tmog, else the set's own Transmog (such as the
-- last button relabelled), else the built-in Transmog. Never Pass, and never a second Transmog.
function LM.AutoKey(responses)
    local own
    for _, r in ipairs(type(responses) == "table" and responses or {}) do
        if r.key == "tmog" then
            return "tmog"
        end
        own = own or (LM.IsTransmog(r) and r.key) or nil
    end
    return own or LM.TRANSMOG.key
end

-- A response by key from a set's byKey, or the built-in Transmog for "tmog".
function LM.ResponseOf(byKey, key)
    local r = type(byKey) == "table" and byKey[key] or nil
    if not r and key == LM.TRANSMOG.key then
        return LM.TRANSMOG
    end
    return r
end

-- Whether a version ("0.26.0") is this one or newer; an unknown or unreadable version is older.
function LM.VersionAtLeast(version, min)
    local function parts(v)
        local out = {}
        for n in tostring(v or ""):gmatch("%d+") do
            out[#out + 1] = tonumber(n)
        end
        return out
    end
    local a, b = parts(version), parts(min)
    if #a == 0 then
        return false
    end
    for i = 1, math.max(#a, #b) do
        local x, y = a[i] or 0, b[i] or 0
        if x ~= y then
            return x > y
        end
    end
    return true
end

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
            local ic = LM.Icon(c.icon) -- only known icons; an old typed path or name is matched or dropped
            c.icon = ic and ic.key or nil
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

-- The award message: %i item, %p player, %r the winner's answer, %v roll (or the "no roll" text).
LM.AWARD_DEFAULT = "%i awarded to %p for %r with a %v roll."
LM.NO_ROLL_CHOICES = { "-", "0", "no" }

-- Where an item's tooltip opens (Settings tab, a personal choice that is not synced), in the order the
-- dropdown lists them. point is the tooltip's corner, rel the window's; dx, dy the gap in pixels; level
-- puts the tooltip level with the hovered icon (the sides only). "default" has no point: the game's own
-- tooltip position.
LM.TOOLTIP_ANCHOR_DEFAULT = "left"
LM.TOOLTIP_ANCHORS = {
    { key = "left", label = "Left", point = "TOPRIGHT", rel = "TOPLEFT", dx = -4, dy = 0, level = true },
    { key = "right", label = "Right", point = "TOPLEFT", rel = "TOPRIGHT", dx = 4, dy = 0, level = true },
    { key = "bottomleft", label = "Bottom left", point = "TOPLEFT", rel = "BOTTOMLEFT", dx = 0, dy = -4 },
    { key = "bottomright", label = "Bottom right", point = "TOPRIGHT", rel = "BOTTOMRIGHT", dx = 0, dy = -4 },
    { key = "topleft", label = "Top left", point = "BOTTOMLEFT", rel = "TOPLEFT", dx = 0, dy = 4 },
    { key = "topright", label = "Top right", point = "BOTTOMRIGHT", rel = "TOPRIGHT", dx = 0, dy = 4 },
    { key = "topcenter", label = "Top center", point = "BOTTOM", rel = "TOP", dx = 0, dy = 4 },
    { key = "bottomcenter", label = "Bottom center", point = "TOP", rel = "BOTTOM", dx = 0, dy = -4 },
    { key = "default", label = "Default tooltip" },
}

-- The chosen anchor's row; a missing or unknown saved value is Left.
function LM:TooltipAnchor()
    local want = self:Settings().tooltipAnchor
    for _, a in ipairs(LM.TOOLTIP_ANCHORS) do
        if a.key == want then
            return a
        end
    end
    return LM.TOOLTIP_ANCHORS[1]
end

LM.AWARD_MAX = 200 -- letters in the award message
LM.AWARD_CHANNELS = { "RAID", "RAID_WARNING", "PARTY", "GUILD", "OFFICER", "SELF", "NONE" } -- besides CHANNEL: and COMMUNITY:
LM.AUTHORITY_MAX = 6 -- named players with loot authority

-- The Settings tab's number settings: { min, max, step }. The sliders use them, and a synced value is
-- clamped to them (LootMaster/Sync.lua).
LM.LIMITS = {
    responseSeconds = { 20, 180, 5 },
    late = { 0, 30, 1 }, per10 = { 0, 10, 1 }, noShow = { 0, 50, 1 }, recover = { 0, 20, 1 }, weeks = { 1, 26, 1 },
    filterIlvl = { 0, 500, 1 }, -- the Loot filter tab's lowest item level; 0 is any (LootMaster/Filter.lua)
}
LM.SCORE_WEIGHTS = { "late", "per10", "noShow", "recover", "weeks" } -- the Raider Score weights, in order

-- A number setting made safe: a number (else fallback, else the minimum), on a step, within its limits.
function LM.Clamp(key, v, fallback)
    local lim = LM.LIMITS[key]
    v = tonumber(v)
    if not v or v ~= v then
        v = tonumber(fallback) or lim[1]
    end
    v = math.max(lim[1], math.min(lim[2], v))
    return math.max(lim[1], math.min(lim[2], lim[1] + math.floor((v - lim[1]) / lim[3] + 0.5) * lim[3]))
end

-- At most n letters of a UTF-8 text (a letter may be several bytes).
local function cutLetters(text, n)
    local letters = 0
    for i = 1, #text do
        local b = text:byte(i)
        if b < 0x80 or b >= 0xC0 then
            letters = letters + 1
            if letters > n then
                return text:sub(1, i - 1)
            end
        end
    end
    return text
end

-- The award message made safe: trimmed, at most AWARD_MAX letters, the default when empty.
function LM.CleanAwardMessage(text)
    text = cutLetters((tostring(text or ""):gsub("^%s+", ""):gsub("%s+$", "")), LM.AWARD_MAX)
    return text ~= "" and text or LM.AWARD_DEFAULT
end

-- Send to made safe: a chat type of AWARD_CHANNELS, CHANNEL:<name> or COMMUNITY:<club>:<stream>; else Raid.
function LM.CleanAwardChannel(v)
    v = tostring(v or "")
    for _, k in ipairs(LM.AWARD_CHANNELS) do
        if v == k then
            return v
        end
    end
    if v:match("^CHANNEL:[^:]+$") or v:match("^COMMUNITY:[^:]+:[^:]+$") then
        return v
    end
    return "RAID"
end

function LM.CleanNoRoll(v)
    for _, k in ipairs(LM.NO_ROLL_CHOICES) do
        if v == k then
            return v
        end
    end
    return LM.NO_ROLL_CHOICES[1]
end

-- fields: item, player, response, roll, noRoll. Pure, for tests.
function LM.FormatAward(template, f)
    local values = {
        i = f.item or "?",
        p = f.player or "?",
        r = f.response or "?",
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

-- A response of this session's set, or the built-in Transmog.
function Session:Response(key)
    return LM.ResponseOf(self.byKey, key)
end

-- What the looter can give an item for: every response of the set, and the built-in Transmog (before the
-- last button) when the set has no Transmog of its own.
function Session:AwardResponses()
    local out = {}
    for _, r in ipairs(self.responses) do
        out[#out + 1] = r
    end
    if not self.byKey[self:AutoResponse()] then
        table.insert(out, math.max(1, #out), LM.TRANSMOG)
    end
    return out
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

-- The raider got every item and button: their clock starts now, not when the looter started.
function Session:Ready(name)
    local p = self:Player(name)
    p.crt = true
    if p.ready then
        return false
    end
    p.ready = true
    for index in ipairs(self.items) do
        local a = p.answers[index]
        if not a then
            p.answers[index] = { asked = GetTime() }
        elseif not a.response then
            a.asked, a.state = GetTime(), nil
        end
    end
    return true
end

-- Raiders who said hello but never became ready.
function Session:NotReady()
    local out = {}
    for _, name in ipairs(self.order) do
        local p = self.players[name]
        if p.crt and not p.ready then
            out[#out + 1] = name
        end
    end
    return out
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

-- Items a raider's specs can't use ---------------------------------------------------------------------
-- Each raider's own CRT decides, never the looter's: C_Item.GetItemSpecInfo only knows the calling
-- player's class. The item is answered for them only when it is loaded and the game gives a non-empty
-- list of specs that holds none of theirs. Anything else (not loaded, nil, not a table, empty, odd values,
-- your specs unknown) shows the item as normal: it fails open, never closed.
-- specs: what C_Item.GetItemSpecInfo returned; mine: { [specID] = true } for your class's specs.
function LM.SpecVerdict(specs, mine, loaded)
    if not loaded or type(specs) ~= "table" or #specs == 0 or type(mine) ~= "table" or next(mine) == nil then
        return "show"
    end
    for _, id in ipairs(specs) do
        if type(id) ~= "number" or mine[id] then
            return "show"
        end
    end
    return "auto", "nospec"
end

-- Class limits, also judged on the raider's own client, also failing open:
--   armor  an armor piece in an armor-typed slot that isn't your class's armor type (Alex: leather for a
--          warrior counts). The slots are the eight Blizzard's auction house files by armor type
--          (Blizzard_AuctionData.lua; the back slot is not one of them). The class armor types are from the
--          wiki's Armor page, read 2026-10-18; confirm each class in game with /crt dev loot probe spec,
--          and check them each expansion (references/season-update.md).
--   classes  a "Classes: ..." line (ITEM_CLASSES_ALLOWED) on the item's tooltip data that doesn't name
--          your class, such as a tier token for other classes. Read in the background, never by hover.
--   weapon  a weapon whose tooltip data shows its weapon type in red on the slot line (the line's right
--          text, as on the item tooltip: "Sword" in red for a druid), and that text is the item's own weapon
--          type. The game's subtype name is longer ("One-Handed Swords" for "Sword"), so the tooltip's text
--          counts when it is the subtype or a part of it, in any case. Known misses, both shown as normal
--          (failing open): a staff ("Staff" is not part of "Staves"), and languages whose letters
--          string.lower doesn't fold (non-Latin scripts), where a case difference stops the match.
LM.ITEM_CLASS_WEAPON = 2 -- Enum.ItemClass.Weapon
-- The game's red text (RED_FONT_COLOR, about 1 / 0.1 / 0.1): a colour within tolerance of this on each part.
LM.RED_TEXT = { r = 1, g = 0.12, b = 0.12, tolerance = 0.15 }
LM.ARMOR = { CLOTH = 1, LEATHER = 2, MAIL = 3, PLATE = 4 } -- Enum.ItemArmorSubclass values
LM.ITEM_CLASS_ARMOR = 4 -- Enum.ItemClass.Armor
LM.CLASS_ARMOR = {
    PRIEST = 1, MAGE = 1, WARLOCK = 1,
    ROGUE = 2, DRUID = 2, MONK = 2, DEMONHUNTER = 2,
    HUNTER = 3, SHAMAN = 3, EVOKER = 3,
    WARRIOR = 4, PALADIN = 4, DEATHKNIGHT = 4,
}
LM.ARMOR_SLOTS = {
    INVTYPE_HEAD = true, INVTYPE_SHOULDER = true, INVTYPE_CHEST = true, INVTYPE_ROBE = true,
    INVTYPE_WAIST = true, INVTYPE_LEGS = true, INVTYPE_FEET = true, INVTYPE_WRIST = true, INVTYPE_HAND = true,
}

-- The class names on a "Classes: ..." line (format is the game's ITEM_CLASSES_ALLOWED), or nil.
function LM.ParseClassesLine(text, format)
    if type(text) ~= "string" or type(format) ~= "string" then
        return nil
    end
    local pattern = "^" .. format:gsub("[%(%)%.%-%+%*%?%[%]%^%$]", "%%%0"):gsub("%%s", "(.+)") .. "$"
    local list = text:match(pattern)
    if not list then
        return nil
    end
    local out = {}
    for name in (list .. ","):gmatch("%s*(.-)%s*,") do
        if name ~= "" then
            out[#out + 1] = name
        end
    end
    return out
end

-- Whether a colour (r, g, b fields or a list of three) is the game's red text. Anything else is not red.
function LM.IsRed(c)
    if type(c) ~= "table" then
        return false
    end
    local want, tol = LM.RED_TEXT, LM.RED_TEXT.tolerance
    local r, g, b = c.r or c[1], c.g or c[2], c.b or c[3]
    if type(r) ~= "number" or type(g) ~= "number" or type(b) ~= "number" then
        return false
    end
    return math.abs(r - want.r) <= tol and math.abs(g - want.g) <= tol and math.abs(b - want.b) <= tol
end

-- Whether the tooltip's weapon type text is the item's own weapon type (its subtype name, or a part of it).
-- Misses (shown as normal): Staff vs Staves, and a case difference string.lower can't fold (non-Latin).
function LM.WeaponTypeMatches(text, subType)
    if type(text) ~= "string" or type(subType) ~= "string" or text == "" or subType == "" then
        return false
    end
    return text == subType or subType:lower():find(text:lower(), 1, true) ~= nil
end

-- f: loaded, itemClass, subClass, subType, equipLoc (from C_Item.GetItemInfoInstant), myClass (class file),
-- myClassNames ({ [name] = true }: your class's localized names, male and female, as some languages
-- differ), knownClassNames (every class's names, the same way), classes (the names on a "Classes:" line),
-- slotText and slotColor (the right side of the tooltip's slot line; a colour as LM.IsRed reads it).
-- Returns "auto" with a reason ("classes", "armor" or "weapon"), or "show".
function LM.ClassVerdict(f)
    if not (f and f.loaded) then
        return "show"
    end
    if type(f.classes) == "table" and #f.classes > 0 then
        if type(f.myClassNames) ~= "table" or next(f.myClassNames) == nil
            or type(f.knownClassNames) ~= "table" or next(f.knownClassNames) == nil then
            return "show" -- your own names unknown: can't tell
        end
        for _, name in ipairs(f.classes) do
            if f.myClassNames[name] or not f.knownClassNames[name] then
                return "show" -- your class is named, or a name isn't a class we know: show
            end
        end
        return "auto", "classes"
    end
    local mine = LM.CLASS_ARMOR[f.myClass]
    if f.itemClass == LM.ITEM_CLASS_ARMOR and LM.ARMOR_SLOTS[f.equipLoc] and mine
        and f.subClass and f.subClass >= LM.ARMOR.CLOTH and f.subClass <= LM.ARMOR.PLATE and f.subClass ~= mine then
        return "auto", "armor"
    end
    if f.itemClass == LM.ITEM_CLASS_WEAPON and LM.IsRed(f.slotColor) and LM.WeaponTypeMatches(f.slotText, f.subType) then
        return "auto", "weapon"
    end
    return "show"
end

-- The answer given for an item a raider can't use: always a Transmog (LM.AutoKey).
function Session:AutoResponse()
    return LM.AutoKey(self.responses)
end

-- fields: response, note, role, class, ilvl, gear ({ { id, ilvl } }), auto (answered by the raider's
-- CRT because their specs can't use it) and autoSpecs (the spec IDs the game listed)
function Session:Answer(name, index, fields)
    if not self.items[index] or not self:Response(fields.response) then
        return false
    end
    local p = self:Player(name)
    p.crt = true
    p.class = fields.class or p.class
    p.role = fields.role or p.role
    local a = answer(p, index)
    a.response, a.note, a.ilvl, a.gear = fields.response, fields.note, fields.ilvl, fields.gear or {}
    a.auto, a.autoSpecs = fields.auto and true or nil, fields.auto and fields.autoSpecs or nil
    a.autoWhy, a.autoDetail = fields.auto and (fields.autoWhy or "spec") or nil, fields.auto and fields.autoDetail or nil
    a.state = "answered"
    return true
end

-- Rolls are silent: the looter's CRT draws them (Comm.lua) and sends them to everyone. A raider's roll is
-- set once per item; force (the looter's Roll again) replaces it.
function Session:SetRoll(name, index, roll, force)
    local p = self.players[name]
    local a = p and p.answers[index]
    if not (a and a.response and roll) then
        return false
    end
    if a.roll and not force then
        return false
    end
    a.roll = roll
    return true
end

-- Whether a raider's answer needs a roll: every answer does, the last button and an automatic one too, so
-- no answer is left without a number. The answer's weight still sorts first.
function Session:NeedsRoll(name, index)
    local p = self.players[name]
    local a = p and p.answers[index]
    return (a and a.response) and true or false
end

-- The looter may roll again for an answer that has a roll.
function Session:CanReroll(name, index)
    local p = self.players[name]
    local a = p and p.answers[index]
    return (p and p.crt and self:NeedsRoll(name, index) and a.roll ~= nil) and true or false
end

-- Showing the popup again is for a raider with CRT who hasn't answered this item (it never opened, or
-- ran out of time); an answer is never wiped by it.
function Session:CanResend(name, index)
    local p = self.players[name]
    local a = p and p.answers[index]
    return (p and p.crt ~= false and not (a and a.response)) and true or false
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
        if p.crt and p.ready then
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

-- Response buttons on the raider popup: each is as wide as its label (measured in the game's font),
-- plus its icon and padding, never narrower than BUTTON_MIN_W.
LM.BUTTON_PAD = 6 -- each side
LM.BUTTON_ICON = 14
LM.BUTTON_ICON_GAP = 3
LM.BUTTON_MIN_W = 40

function LM.ButtonWidth(labelWidth, hasIcon)
    local w = math.ceil(labelWidth or 0) + 2 * LM.BUTTON_PAD
    if hasIcon then
        w = w + LM.BUTTON_ICON + LM.BUTTON_ICON_GAP
    end
    return math.max(LM.BUTTON_MIN_W, w)
end

-- Lays buttons of these widths out in rows no wider than maxW: one row with `gap` when it fits, else one
-- row with `minGap`, else as many rows as needed with `gap`. Returns { { x, row } } and the row count.
function LM.ButtonLayout(widths, maxW, gap, minGap)
    local total = 0
    for _, w in ipairs(widths) do
        total = total + w
    end
    local n = #widths
    local one = function(g)
        return total + g * math.max(0, n - 1) <= maxW
    end
    local out = {}
    if one(gap) or one(minGap) then
        local g = one(gap) and gap or minGap
        local x = 0
        for i, w in ipairs(widths) do
            out[i] = { x = x, row = 1 }
            x = x + w + g
        end
        return out, (n > 0) and 1 or 0
    end
    local x, row = 0, 1
    for i, w in ipairs(widths) do
        if x > 0 and x + w > maxW then
            x, row = 0, row + 1
        end
        out[i] = { x = x, row = row }
        x = x + w + gap
    end
    return out, row
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

-- A session saved in CRTDBChar (plain tables) made a session again after a /reload. Every clock starts
-- again from now, so nobody loses time to the reload.
function LM.Revive(t)
    if type(t) ~= "table" or type(t.items) ~= "table" or type(t.players) ~= "table" then
        return nil
    end
    local s = setmetatable(t, Session)
    s.byKey = {}
    for _, r in ipairs(s.responses or {}) do
        s.byKey[r.key] = r
    end
    local now = GetTime()
    s.started = now
    for _, p in pairs(s.players) do
        for _, a in pairs(p.answers) do
            if not a.response then
                a.asked, a.state = now, nil
            end
        end
    end
    return s
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

-- The item tabs' count: answers in, raiders with CRT (raiders without it can never answer), and whether
-- the time ran out with answers missing (a timeout the looter's Tick marked, or the same rule on a copy
-- that never ticks: ready, no answer, asked longer ago than the session's seconds), or someone said hello
-- but still hasn't got the session READY_SECONDS after it started.
function Session:AnswerCount(index)
    local answered, expected, late = 0, 0, false
    local now = GetTime()
    for _, p in pairs(self.players) do
        local a = p.answers[index]
        local has = (a and a.response) and true or false
        if has then
            answered = answered + 1
        end
        if p.crt then
            expected = expected + 1
            if not has then
                if (a and a.state == "timeout") or (p.ready and now - ((a and a.asked) or self.started) > self.seconds) then
                    late = true
                elseif not p.ready and now - self.started > LM.READY_SECONDS then
                    late = true
                end
            end
        end
    end
    return answered, expected, late
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
    if p.crt and not p.ready and not (a and a.response) then
        return "loading"
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
    local r = a and a.response and self:Response(a.response)
    return {
        name = name, class = p.class, role = p.role, crt = p.crt, state = stateOf(p, a),
        response = a and a.response, weight = r and r.weight or (p.crt == false and -2 or -1),
        note = a and a.note, roll = a and a.roll, ilvl = a and a.ilvl, gear = a and a.gear or {},
        auto = a and a.auto, autoSpecs = a and a.autoSpecs, autoWhy = a and a.autoWhy, autoDetail = a and a.autoDetail,
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
-- becomes "/"); the last field, the note, is cut to fit. Lists (the buttons, the items) are packed
-- with Wire.Pack, several entries a message, and never cut.
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

-- Packs entries (each a list of fields) into as few messages as fit: "<kind>|<id>|e1;e2;...", the fields
-- of an entry joined by ",". Fields lose any , ; or | (labels are cleaned before). An entry too long for
-- a message on its own is left out and returned in the second list, so the caller can say so.
function Wire.Pack(kind, id, entries)
    local messages, tooLong = {}, {}
    local head = kind .. "|" .. tostring(id) .. "|"
    local current = nil
    for _, e in ipairs(entries) do
        local parts = {}
        for i, v in ipairs(e) do
            parts[i] = (tostring(v == nil and "" or v):gsub("[,;|]", " "))
        end
        local text = table.concat(parts, ",")
        if #head + #text > MAX_MESSAGE then
            tooLong[#tooLong + 1] = e
        elseif current and #current + 1 + #text <= MAX_MESSAGE then
            current = current .. ";" .. text
        else
            if current then
                messages[#messages + 1] = current
            end
            current = head .. text
        end
    end
    if current then
        messages[#messages + 1] = current
    end
    return messages, tooLong
end

-- The entries of a packed field: { { field, field, ... }, ... }.
function Wire.Unpack(field)
    local out = {}
    for entry in (tostring(field or "") .. ";"):gmatch("(.-);") do
        if entry ~= "" then
            local fields = {}
            for f in (entry .. ","):gmatch("(.-),") do
                fields[#fields + 1] = f
            end
            out[#out + 1] = fields
        end
    end
    return out
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
