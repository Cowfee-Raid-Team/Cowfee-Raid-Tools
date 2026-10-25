local ADDON, CRT = ...

-- DEVELOPER ONLY. /crt dev alerts: a boss's alerts out of this CRT and into another, or out to ship.
--   Export code                 a !CRT:alerts:1: code (Alerts/Share.lua) to paste into another CRT's Import: your
--                               special alert choices with the boss files' entries, and your Mech Alerts
--   Export for shipping (Lua)   the boss's special alerts and your Mech Alerts as Lua in the boss file's format,
--                               to paste to Claude, who ships them in the boss file's special list by hand
--   Import                      reads the code pasted in the box (the summary line says what it holds and how
--                               much is new, replaces yours or is the same as yours), then writes it into your
--                               saved Mech Alerts, the same store the panel uses
-- Boss picks one boss (route order, CRT.Bosses:Options) or all bosses; What picks Special alerts, My Mech Alerts
-- or both. A Mech Alert becomes a special alert entry with its spell (or its typed times), Show from, Show as,
-- impact ticks, bar end and fill; what an entry can't hold is named in a comment on it.
-- This file never ships: its .toc line is inside the do-not-package block.

local UI = CRT.UI

local Dev = {}
CRT.AlertExportDev = Dev

local TEXT = {
    title = "Alert export (dev)",
    helpTitle = "Alert export",
    help = "Export code: a code to paste into another CRT. It holds the boss's special alerts (your choices, and the boss file's entries) and your Mech Alerts.\n\n"
        .. "Export for shipping (Lua): the same alerts as Lua in the boss file's format. Paste it to Claude, who ships it in the boss file.\n\n"
        .. "Import: paste a code in the box. The line above it says what it holds. Import writes it into your Mech Alerts. A special alert definition this CRT doesn't ship loads until the next /reload.",
    boss = "Boss",
    what = "What",
    allBosses = "All bosses",
    whatHelp = "Special alerts: the boss's scripted alerts and your choices for them. My Mech Alerts: your own alerts on the boss's abilities.",
    exportCode = "Export code",
    exportLua = "Export for shipping (Lua)",
    import = "Import",
    paste = "Paste a code in the box, then click Import.",
    exported = "Code for %s: %d parts. Ctrl+C to copy it.",
    luaDone = "Lua for %s. Ctrl+C to copy it and paste it to Claude.",
    nothing = "Nothing to export there.",
    nothingNew = "Nothing new to import: it is all the same as yours.",
    imported = "Imported %d. %s",
    header = "-- Special alerts for %s (encounter %d, season %s), exported %s with /crt dev alerts.",
    headerPaste = "-- Paste the entries into the boss file's special list (CRT_Data/Seasons/<season>/<Boss>.lua). The format is",
    headerFormat = "-- at the top of CRT_Modules/Alerts/Special.lua. An entry made from a Mech Alert could ship as a reference reminder instead.",
    fromMine = "-- from your Mech Alert %q",
    notCarried = "-- not carried over: %s",
    leftOut = "-- left out: your Mech Alert %q has no spell, row or times to place it",
    lost = { count = "the count down", speakAt = "speaking at 0", sound = "its sound", glow = "the glow", color = "its colour",
        linger = "Linger", moved = "its moved and turned-off casts", priority = "its priority", icon = "its own icon" },
}
Dev.TEXT = TEXT

local WHAT = {
    { key = "both", label = "Special alerts + my Mech Alerts" },
    { key = "special", label = "Special alerts" },
    { key = "reminders", label = "My Mech Alerts" },
}
local ALL = "all"

-- Lua writing ----------------------------------------------------------------------------------------------

-- The entry fields in the order Alerts/Special.lua documents them, and the order inside its tables.
local ORDER = { "key", "label", "help", "type", "difficulty", "default", "when", "lead", "icon", "iconFile", "who", "text", "show", "markers",
    "ticks", "barTo", "bar", "fill", "covers" }
local SUB_ORDER = {
    when = { "row", "spellID", "times" },
    who = { "mode", "roles", "rotation", "note" },
    show = { "callout", "bar", "text", "icon", "circle", "timeline", "speech" },
    markers = { "marks" },
    bar = { "start", "length", "ticks" },
}
local KEYWORDS = {}
for w in ("and break do else elseif end false for function if in local nil not or repeat return then true until while"):gmatch("%a+") do
    KEYWORDS[w] = true
end

local function trim(s)
    return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

local function num(v)
    if v % 1 == 0 and math.abs(v) < 2 ^ 31 then
        return string.format("%d", v)
    end
    return string.format("%.10g", v)
end

local function str(v)
    return (string.format("%q", v):gsub("\\\n", "\\n"))
end

local function isList(t)
    local n = 0
    for _ in pairs(t) do
        n = n + 1
    end
    return n == #t
end

-- The table's keys: order's first, then the rest sorted.
local function orderedKeys(t, order)
    local out, seen = {}, {}
    for _, k in ipairs(order or {}) do
        if t[k] ~= nil then
            out[#out + 1] = k
            seen[k] = true
        end
    end
    local rest = {}
    for k in pairs(t) do
        if not seen[k] then
            rest[#rest + 1] = k
        end
    end
    table.sort(rest, function(a, b)
        return tostring(a) < tostring(b)
    end)
    for _, k in ipairs(rest) do
        out[#out + 1] = k
    end
    return out
end

local value

local function keyText(k)
    if type(k) == "string" and k:find("^[%a_][%w_]*$") and not KEYWORDS[k] then
        return k
    end
    return "[" .. value(k) .. "]"
end

-- A value as Lua source on one line.
function value(v, order)
    local t = type(v)
    if t == "string" then
        return str(v)
    elseif t == "number" then
        return num(v)
    elseif t == "boolean" then
        return tostring(v)
    elseif t ~= "table" then
        return "nil"
    end
    if next(v) == nil then
        return "{}"
    end
    local parts = {}
    if isList(v) then
        for i, x in ipairs(v) do
            parts[i] = value(x)
        end
    else
        for _, k in ipairs(orderedKeys(v, order)) do
            parts[#parts + 1] = keyText(k) .. " = " .. value(v[k], SUB_ORDER[k])
        end
    end
    return "{ " .. table.concat(parts, ", ") .. " }"
end
Dev.Value = value

-- One entry, a field a line, with its comment lines first.
local function entryText(def, comments)
    local lines = {}
    for _, c in ipairs(comments or {}) do
        lines[#lines + 1] = "    " .. c
    end
    lines[#lines + 1] = "    {"
    for _, k in ipairs(orderedKeys(def, ORDER)) do
        lines[#lines + 1] = "        " .. keyText(k) .. " = " .. value(def[k], SUB_ORDER[k]) .. ","
    end
    lines[#lines + 1] = "    },"
    return table.concat(lines, "\n")
end

-- A key from a label: "Ravenous Feast" -> "ravenousFeast", one per boss.
local function keyFor(label, used)
    local words = {}
    for w in tostring(label):gmatch("%w+") do
        words[#words + 1] = w
    end
    local key = "alert"
    if #words > 0 then
        key = words[1]:lower()
        for i = 2, #words do
            key = key .. words[i]:sub(1, 1):upper() .. words[i]:sub(2):lower()
        end
        if key:find("^%d") then
            key = "alert" .. key
        end
    end
    local out, n = key, 1
    while used[out] do
        n = n + 1
        out = key .. n
    end
    used[out] = true
    return out
end

local function followsCasts(enc, r)
    local Reminders = CRT.AlertReminders
    local ok, yes = pcall(Reminders.FollowsCasts, enc, r)
    return ok and yes or false
end

-- What a special alert entry can't hold of a reminder, as words.
local function lostParts(r)
    local out = {}
    local L = TEXT.lost
    if r.speech == "textcount" or r.speech == "count" then
        out[#out + 1] = L.count
    end
    if r.speakAt == "zero" then
        out[#out + 1] = L.speakAt
    end
    for _, k in ipairs({ "sound", "glow", "color", "iconID" }) do
        if r[k] ~= nil and r[k] ~= false then
            out[#out + 1] = k == "iconID" and L.icon or L[k]
        end
    end
    if type(r.linger) == "number" and r.linger > 0 then
        out[#out + 1] = L.linger
    end
    if r.priority and r.priority ~= "normal" then
        out[#out + 1] = L.priority
    end
    if (type(r.shifts) == "table" and next(r.shifts)) or (type(r.off) == "table" and next(r.off)) then
        out[#out + 1] = L.moved
    end
    return out
end

local SHOW_FROM = { callout = "alert", bar = "bar", text = "text", icon = "icon", circle = "circle", timeline = "timeline", speech = "speech" }
local ON_BY_DEFAULT = { alert = true, bar = true, speech = true } -- Reminders:Save's defaults for a missing output

-- One of your reminders as a special alert entry, or nil when it has nothing to place it on. Returns the entry
-- and its comment lines.
function Dev.ReminderDef(enc, r, used)
    local Reminders = CRT.AlertReminders
    local spell = type(r.spellID) == "number" and r.spellID > 0 and r.spellID or nil
    local label = trim(r.text) ~= "" and trim(r.text) or (spell and Reminders.SpellName(spell)) or (spell and ("Spell " .. spell)) or "Alert"
    local typed = type(r.times) == "string" and trim(r.times) ~= ""
    local follows = followsCasts(enc, r)
    local when
    if typed and not follows then
        when = { times = trim(r.times) }
    elseif spell then
        when = { spellID = spell }
    elseif follows then
        when = { row = trim(r.text) }
    else
        return nil, { TEXT.leftOut:format(label) }
    end
    local o = type(r.outputs) == "table" and r.outputs or {}
    local show = {}
    for word, k in pairs(SHOW_FROM) do
        local on = o[k]
        if on == nil then
            on = ON_BY_DEFAULT[k] or false
        end
        show[word] = on and true or false
    end
    local ticks = Reminders.TickList(r.ticks)
    local def = {
        key = keyFor(label, used),
        label = label,
        difficulty = Reminders.GroupOf(r),
        when = when,
        lead = (type(r.warn) == "number" and r.warn ~= 5) and r.warn or nil,
        show = show,
        ticks = ticks,
        barTo = (ticks and r.barTo == "cast") and "cast" or nil,
        -- a special alert's bar fills up unless it says down; a reminder's empties unless it says up
        fill = r.fill ~= "up" and "down" or nil,
    }
    local comments = { TEXT.fromMine:format(label) }
    local lost = lostParts(r)
    if #lost > 0 then
        comments[#comments + 1] = TEXT.notCarried:format(table.concat(lost, ", "))
    end
    return def, comments
end

-- The Lua for one boss: a header comment naming the boss, its encounter ID, season and the date, then the
-- special list. opts: special (the boss file's entries, the dev sample's too), reminders (your Mech Alerts).
-- Nil when there is nothing.
function Dev.LuaFor(enc, opts)
    opts = opts or {}
    local AS, Reminders = CRT.AlertShare, CRT.AlertReminders
    local blocks, used = {}, {}
    if opts.special then
        for _, d in ipairs(AS.RawDefs(enc)) do
            used[d.key] = true
            blocks[#blocks + 1] = entryText(d)
        end
    end
    if opts.reminders then
        for _, e in ipairs(Reminders:List(enc)) do
            local def, comments = Dev.ReminderDef(enc, e.r, used)
            if def then
                blocks[#blocks + 1] = entryText(def, comments)
            else
                blocks[#blocks + 1] = "    " .. comments[1]
            end
        end
    end
    if #blocks == 0 then
        return nil
    end
    local boss = CRT.Bosses and CRT.Bosses:Get(enc)
    local header = TEXT.header:format(boss and boss.name or ("encounter " .. enc), enc, boss and boss.season or "?", date("%Y-%m-%d"))
    return header .. "\n" .. TEXT.headerPaste .. "\n" .. TEXT.headerFormat .. "\nspecial = {\n" .. table.concat(blocks, "\n") .. "\n},"
end

-- The same for every boss with something, one block each.
function Dev.LuaForAll(opts)
    local out = {}
    for _, enc in ipairs(CRT.AlertShare.BossList({})) do
        local text = Dev.LuaFor(enc, opts)
        if text then
            out[#out + 1] = text
        end
    end
    return #out > 0 and table.concat(out, "\n\n") or nil
end

-- The window -----------------------------------------------------------------------------------------------

local L = {
    width = 660, height = 480,
    labelW = 60, dropW = 280, rowGap = 32,
    buttonH = 22, buttonGap = 6,
    statusH = 30,
}

local win
local state = { boss = nil, what = "both", info = nil }

local function bossOptions()
    local out = { { key = ALL, label = TEXT.allBosses } }
    for _, o in ipairs(CRT.Bosses:Options()) do
        out[#out + 1] = o.title and o or { key = o.key, label = o.label .. " (" .. o.key .. ")" }
    end
    return out
end

local function exportOpts()
    local special, reminders = state.what ~= "reminders", state.what ~= "special"
    return { bosses = state.boss ~= ALL and { state.boss } or nil, special = special, reminders = reminders, defs = special }
end

local function where()
    if state.boss == ALL then
        return TEXT.allBosses
    end
    return CRT.AlertShare.BossName(state.boss)
end

local function setStatus(text, bad)
    win.status:SetText(bad and UI.BadText(text) or text)
end

local function showText(text)
    win.edit:SetText(text)
    win.edit:SetFocus()
    win.edit:HighlightText()
end

-- Reads what is in the box, and says what it holds.
local function readBox()
    local text = win.edit:GetText() or ""
    state.info = nil
    if trim(text) == "" then
        setStatus(TEXT.paste)
        return
    end
    local info, err = CRT.AlertShare:Read(text)
    if not info then
        setStatus(err, true)
        return
    end
    state.info = info
    setStatus(CRT.AlertShare.Summary(info))
end

local function exportCode()
    local code, n = CRT.AlertShare:Export(exportOpts())
    if not code then
        state.info = nil
        win.edit:SetText("")
        setStatus(n or TEXT.nothing, true)
        return
    end
    showText(code)
    state.info = nil
    setStatus(TEXT.exported:format(where(), n))
end

local function exportLua()
    local opts = exportOpts()
    local text
    if state.boss == ALL then
        text = Dev.LuaForAll(opts)
    else
        text = Dev.LuaFor(state.boss, opts)
    end
    state.info = nil
    if not text then
        win.edit:SetText("")
        setStatus(TEXT.nothing, true)
        return
    end
    showText(text)
    setStatus(TEXT.luaDone:format(where()))
end

local function import()
    readBox()
    local info = state.info
    if not info then
        return
    end
    if info.counts.new + info.counts.replace == 0 then
        setStatus(TEXT.nothingNew)
        return
    end
    local n, err = CRT.AlertShare:Apply(info)
    if not n then
        setStatus(err, true)
        return
    end
    local again = CRT.AlertShare:Read(win.edit:GetText() or "")
    state.info = again
    setStatus(TEXT.imported:format(n, again and CRT.AlertShare.Summary(again) or ""))
end

-- The box: the catalog's read-only scrolling text box (a 1 px bordered box, a skinned UIPanelScrollFrameTemplate
-- and the scroll gutter), holding an edit box so a code can be selected to copy and pasted to import.
local function buildBox(c, top)
    local box = CreateFrame("Frame", nil, c, "BackdropTemplate")
    box:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    UI.Tint(box, "SetBackdropColor", "background", 0.6)
    UI.Tint(box, "SetBackdropBorderColor", "border")
    box:SetPoint("TOPLEFT", 0, -top)
    box:SetPoint("BOTTOMRIGHT", 0, 0)
    local scroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsAlertExportScroll", box, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(scroll.ScrollBar)
    scroll:SetPoint("TOPLEFT", 6, -6)
    scroll:SetPoint("BOTTOMRIGHT", -(4 + UI.ScrollGutter()), 6)
    local childW = L.width - 2 * (UI.WINDOW_DEFAULTS and UI.WINDOW_DEFAULTS.inset or 8) - 10 - UI.ScrollGutter()
    local edit = CreateFrame("EditBox", nil, scroll)
    edit:SetMultiLine(true)
    edit:SetAutoFocus(false)
    edit:SetFontObject(_G.CRTFontEditSmall or CRTFontEdit)
    edit:SetWidth(childW)
    edit:SetScript("OnEscapePressed", edit.ClearFocus)
    edit:SetScript("OnTextChanged", function(_, user)
        if user then
            readBox()
        end
    end)
    scroll:SetScrollChild(edit)
    -- a click anywhere in the box puts the cursor in it
    box:EnableMouse(true)
    box:SetScript("OnMouseDown", function()
        edit:SetFocus()
    end)
    win.edit = edit
end

local function build()
    win = UI.Window("CowfeeRaidToolsAlertExport", { kind = "dialog", title = TEXT.title, width = L.width, height = L.height })
    win.strip:SetHelp(TEXT.helpTitle, TEXT.help)
    local c = win.content
    local rows = {}
    local bossRow = UI.Dropdown(c, TEXT.boss, { options = bossOptions, labelWidth = L.labelW, width = L.dropW,
        get = function()
            return state.boss
        end,
        set = function(key)
            state.boss = key
        end })
    bossRow:SetPoint("TOPLEFT", 4, -4)
    rows[#rows + 1] = bossRow
    local whatRow = UI.Dropdown(c, TEXT.what, { options = WHAT, labelWidth = L.labelW, width = L.dropW,
        get = function()
            return state.what
        end,
        set = function(key)
            state.what = key
        end })
    whatRow:SetPoint("TOPLEFT", 4, -4 - L.rowGap)
    UI.HelpRight(whatRow, TEXT.what, TEXT.whatHelp)
    rows[#rows + 1] = whatRow
    local buttonsY = -4 - 2 * L.rowGap - 4
    local code = UI.PanelButton(c, TEXT.exportCode, L.buttonH, exportCode)
    code:SetPoint("TOPLEFT", 4, buttonsY)
    local lua = UI.PanelButton(c, TEXT.exportLua, L.buttonH, exportLua)
    lua:SetPoint("LEFT", code, "RIGHT", L.buttonGap, 0)
    local imp = UI.PanelButton(c, TEXT.import, L.buttonH, import)
    imp:SetPoint("LEFT", lua, "RIGHT", L.buttonGap, 0)
    win.status = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    win.status:SetPoint("TOPLEFT", 4, buttonsY - L.buttonH - 8)
    win.status:SetPoint("RIGHT", c, "RIGHT", -4, 0)
    win.status:SetHeight(L.statusH)
    win.status:SetJustifyH("LEFT")
    win.status:SetJustifyV("TOP")
    win.status:SetWordWrap(true)
    buildBox(c, -(buttonsY - L.buttonH - 8 - L.statusH - 4))
    win:HookScript("OnShow", function()
        for _, r in ipairs(rows) do
            if r.refresh then
                r.refresh()
            end
        end
    end)
end

function Dev:Toggle()
    if not win then
        build()
        state.boss = CRT.Bosses.FirstKey(CRT.Bosses:Options()) or ALL
        setStatus(TEXT.paste)
    end
    if win:IsShown() then
        win:Hide()
    else
        win:Show()
    end
end

-- Handles "dev alerts". Returns false for any other command.
function Dev:Command(msg)
    if not msg:match("^dev%s+alerts%s*$") then
        return false
    end
    self:Toggle()
    return true
end
