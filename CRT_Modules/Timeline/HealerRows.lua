local ADDON, CRT = ...

-- Timeline: which spell rows each player has on Healer CDs (Timeline/HealerView.lua builds them), and the menu
-- that picks them: a right-click on a player's name row or one of their spell rows in the label column
-- (View:LabelMenu). A player's rows can be any cooldown of their class in the season's list and any spell the
-- raid note gives them alone. By default a healer shows their spec's major cooldowns, and anyone shows every
-- spell the raid note gives them. Your picks are kept on this computer, per player:
--   CRTDB.timeline.healerRows[player key in lower case][spellID] = true (shown, though not by default)
--                                                                 or false (hidden, though shown by default)
-- A spell not there is as by default. A view setting for anyone, lead or not: never shared in a profile, and not
-- kept per boss (never declared to the season purge). A hidden row's casts stay in the note and its alerts;
-- Healer CDs just doesn't draw them.

local Rows = {}
CRT.TimelineHealerRows = Rows

local TEXT = {
    reset = "Reset to defaults",
}
Rows.TEXT = TEXT

local ICON = "|T%s:14:14:0:0:64:64:4:60:4:60|t %s" -- a menu line's spell icon, its border trimmed, then the name

-- The saved picks, made when create is set; nil when there are none.
local function store(create)
    local t = CRT.db and CRT.db.timeline
    if type(t) ~= "table" then
        return nil
    end
    if type(t.healerRows) ~= "table" then
        if not create then
            return nil
        end
        t.healerRows = {}
    end
    return t.healerRows
end

-- Whether player key's row for spellID shows: your pick, else default.
function Rows.Shown(key, spellID, default)
    local all = store(false)
    local mine = all and all[key]
    if type(mine) == "table" and type(mine[spellID]) == "boolean" then
        return mine[spellID]
    end
    return default and true or false
end

-- Shows or hides player key's row for spellID; a pick that is its default is not kept.
function Rows.Set(key, spellID, shown, default)
    local all = store(true)
    if not all then
        return
    end
    local mine = all[key]
    if shown == (default and true or false) then
        if type(mine) == "table" then
            mine[spellID] = nil
            if next(mine) == nil then
                all[key] = nil
            end
        end
        return
    end
    if type(mine) ~= "table" then
        mine = {}
        all[key] = mine
    end
    mine[spellID] = shown and true or false
end

-- Forgets player key's picks: their rows are the defaults again.
function Rows.Reset(key)
    local all = store(false)
    if all then
        all[key] = nil
    end
end

-- The menu for a player's rows at owner: their name, a checkbox per spell that can be a row (info.options in
-- order, each { spellID, label, icon, default }), then Reset to defaults. changed() runs after each pick.
-- False when the game's menus aren't there.
function Rows.Menu(owner, info, changed)
    local View = CRT.TimelineView
    if not (info and View and View.OpenMenu and MenuUtil and MenuUtil.CreateContextMenu) then
        return false
    end
    local key = info.key
    View.OpenMenu(owner, function(root)
        root:CreateTitle(info.name)
        for _, o in ipairs(info.options) do
            local text = o.icon and string.format(ICON, tostring(o.icon), o.label) or o.label
            root:CreateCheckbox(text, function()
                return Rows.Shown(key, o.spellID, o.default)
            end, function()
                Rows.Set(key, o.spellID, not Rows.Shown(key, o.spellID, o.default), o.default)
                changed()
            end)
        end
        root:CreateDivider()
        root:CreateButton(TEXT.reset, function()
            Rows.Reset(key)
            changed()
        end)
    end)
    return true
end
