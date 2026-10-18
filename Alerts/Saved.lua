local ADDON, CRT = ...

-- Saved alerts: one alert's setup without its time, kept to place on any boss's Timeline or to open in
-- the alert editor. Stored in CRT.db.alerts.saved[id] (ids from nextSavedId) as
--   { name, saveAs, tags, spellID, iconID, text, color, outputs = { alert, text, icon, bar, circle, speech },
--     speech, sound, glow, warn, linger }
-- where `tags` are the words of the editor's For choice, `saveAs` is "note" or "mine", and `speech` is
-- "text", "textcount" or "count" as a reminder keeps it. The time, phase, boss and difficulty of the alert
-- a saved alert was made from are never kept. A saved alert's name defaults to its text, else its spell's
-- name. Every change tells the alerts windows (CRT.Alerts:Fire) and this store's own listeners.
-- A saved alert may also have `pin`, a number: pinned ones are listed first, lowest pin first.
--
-- Starter templates: STARTERS are added to your saved alerts once each (alerts.starters[key] = true), as
-- your own, so they can be changed, renamed or deleted like any other, and a deleted one never comes
-- back. One with `pin` is pinned; when you already have a template of that name, yours is pinned instead
-- of a copy being added.

local TEXT = {
    unnamed = "Template",
}

local Alerts = CRT.Alerts

local Saved = {}
CRT.AlertSaved = Saved

local OUTPUT_KEYS = { "alert", "text", "icon", "bar", "circle", "speech" }
local listeners = {}

-- Each: key (never reused), the fields Saved:Save takes, and pin for the ones listed first. Defaults as a
-- new template: only you, shown 5 seconds before, as the next spell alert and a bar, the text read out.
local STARTER_SHOW = { alert = true, bar = true, speech = true }
local STARTERS = {
    { key = "healthstone", pin = 1, name = "Healthstone", text = "Healthstone", iconID = 538745 },
    { key = "gate", name = "Gate", text = "Gate", iconID = 607512 },
}
Saved.STARTERS = STARTERS

local function trim(s)
    return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

local function readable(v)
    local T = CRT.Timeline
    if T and T.readable then
        return T.readable(v)
    end
    return true
end

local function copy(v)
    if type(v) ~= "table" then
        return v
    end
    local out = {}
    for k, x in pairs(v) do
        out[k] = copy(x)
    end
    return out
end

local function validID(v)
    return readable(v) and type(v) == "number" and v > 0 and v or nil
end

local function store(create)
    local db = Alerts:Settings()
    if not db then
        return nil
    end
    if create and type(db.saved) ~= "table" then
        db.saved = {}
    end
    return db.saved
end

local seeding = false -- adding the starters, inside List: no change event while a list is being drawn

local function changed()
    if seeding then
        return
    end
    Alerts:Fire()
    for _, fn in ipairs(listeners) do
        local ok, err = pcall(fn)
        if not ok and geterrorhandler then
            geterrorhandler()(err)
        end
    end
end

-- fn is called after every change to the saved alerts.
function Saved:OnChange(fn)
    listeners[#listeners + 1] = fn
end

-- The name a saved alert gets when none is typed: its text, else its spell's name.
function Saved.DefaultName(s)
    local text = trim(s and s.text)
    if text ~= "" then
        return text
    end
    local id = validID(s and s.spellID)
    local name = id and CRT.AlertReminders and CRT.AlertReminders.SpellName(id)
    if name and trim(name) ~= "" then
        return name
    end
    return TEXT.unnamed
end

function Saved:Get(id)
    local all = store()
    return all and all[id] or nil
end

local addStarters -- below Saved:Save, which it uses

-- { { id, s } }: the pinned ones first (lowest pin first), then by name (any case), then oldest first.
function Saved:List()
    addStarters()
    local out = {}
    for id, s in pairs(store() or {}) do
        out[#out + 1] = { id = id, s = s }
    end
    table.sort(out, function(a, b)
        local pa, pb = tonumber(a.s.pin), tonumber(b.s.pin)
        if pa ~= pb then
            if pa and pb then
                return pa < pb
            end
            return pa ~= nil
        end
        local x, y = tostring(a.s.name or ""):lower(), tostring(b.s.name or ""):lower()
        if x ~= y then
            return x < y
        end
        return a.id < b.id
    end)
    return out
end

-- The words of a tags list, or of a text.
local function tagList(v)
    local out = {}
    if type(v) == "string" then
        for word in v:gmatch("%S+") do
            out[#out + 1] = word
        end
    elseif type(v) == "table" then
        for _, word in ipairs(v) do
            if type(word) == "string" and trim(word) ~= "" then
                out[#out + 1] = trim(word)
            end
        end
    end
    return out
end

-- Saves a copy of the setup in `fields` (only a saved alert's own fields are kept: not the time, phase,
-- encounter, boss or difficulty). id nil makes a new saved alert; an id that exists is overwritten, and
-- keeps its name when `fields` has none. Returns the id.
function Saved:Save(id, fields)
    local all = store(true)
    local db = Alerts:Settings()
    if not (all and db and type(fields) == "table") then
        return nil
    end
    local s = {
        saveAs = fields.saveAs == "note" and "note" or "mine",
        tags = tagList(fields.tags),
        spellID = validID(fields.spellID),
        iconID = validID(fields.iconID),
        text = trim(fields.text),
        color = copy(fields.color),
        speech = fields.speech,
        sound = fields.sound,
        glow = fields.glow and true or nil,
        warn = type(fields.warn) == "number" and fields.warn or 5,
        linger = type(fields.linger) == "number" and fields.linger > 0 and fields.linger or nil,
        outputs = {},
    }
    for _, k in ipairs(OUTPUT_KEYS) do
        s.outputs[k] = fields.outputs and fields.outputs[k] and true or false
    end
    local name = trim(fields.name)
    if name == "" and id and all[id] then
        name = all[id].name
    end
    s.name = (name and name ~= "") and name or Saved.DefaultName(s)
    s.pin = tonumber(fields.pin) or (id and all[id] and all[id].pin) or nil
    if not id then
        id = db.nextSavedId or 1
    end
    if id >= (db.nextSavedId or 1) then
        db.nextSavedId = id + 1
    end
    all[id] = s
    changed()
    return id
end

-- Adds each starter not added before (see the top of this file).
addStarters = function()
    local db = Alerts:Settings()
    local all = store(true)
    if not (db and all) then
        return
    end
    db.starters = db.starters or {}
    for _, st in ipairs(STARTERS) do
        if not db.starters[st.key] then
            db.starters[st.key] = true
            local mine
            for _, s in pairs(all) do
                if tostring(s.name or ""):lower() == st.name:lower() then
                    mine = s
                end
            end
            if mine then
                mine.pin = mine.pin or st.pin
            else
                seeding = true
                pcall(Saved.Save, Saved, nil, { name = st.name, text = st.text, iconID = st.iconID, saveAs = "mine",
                    outputs = STARTER_SHOW, speech = "text", warn = 5, pin = st.pin })
                seeding = false
            end
        end
    end
end

-- False when there is no such saved alert. An empty name takes the default.
function Saved:Rename(id, name)
    local s = self:Get(id)
    if not s then
        return false
    end
    name = trim(name)
    s.name = name ~= "" and name or Saved.DefaultName(s)
    changed()
    return true
end

function Saved:Delete(id)
    local all = store()
    if all and all[id] ~= nil then
        all[id] = nil
        changed()
    end
end

-- The prefill for Editor:Open on a boss: every saved field, at phase ph and time (seconds into it) when
-- given. A spell dropped on an icon wins over the saved alert's own. Nil when there is no such saved alert.
function Saved:Prefill(id, encounterID, ph, time, spellID, boss)
    local s = self:Get(id)
    if not s then
        return nil
    end
    return {
        saved = id,
        spellID = validID(spellID) or s.spellID,
        saveAs = s.saveAs,
        ph = ph,
        time = time,
        boss = boss,
    }
end
