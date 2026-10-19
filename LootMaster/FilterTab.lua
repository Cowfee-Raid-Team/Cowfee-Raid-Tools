local ADDON, CRT = ...

-- The Loot Master page's Loot filter tab (LootMaster/Page.lua): which items open a loot session. Two
-- columns: where it dropped, the lowest quality and item level on the left; the kinds of items and Defaults
-- on the right. The rules are in LootMaster/Filter.lua.
--   LM.BuildFilterTab(f, kit)   kit: the page's heading(f, x, y, text, help), check(f, x, y, text, get, set)
--                               and refreshers (a list the page runs on every refresh)

local LM = CRT.LootMaster
local UI = CRT.UI

local L = {
    col1 = 8, col2 = 430,
    check = 26, -- one checkbox row
    dropW = 180, sliderLabel = 70, sliderW = 200,
}

local TEXT = {
    where = "Where it dropped",
    whereHelp = "Boss loot is what a boss drops. Trash loot is what any other enemy in the instance drops.\n\nAn item opens a loot session only when it passes every part of this filter: where it dropped, its quality, its item level and its kind. The filter is the Loot Master's own; Loot History keeps its own lowest quality.\n\n/crt loot test picks sample items that pass it. Sync Master Loot sends it with your other settings.",
    boss = "Boss loot", trash = "Trash loot",
    quality = "Quality",
    qualityHelp = "The lowest quality that opens a session.",
    qualityChoice = "%s and up",
    qualities = { [2] = "Uncommon", [3] = "Rare", [4] = "Epic", [5] = "Legendary" },
    ilvl = "Item level",
    ilvlHelp = "The lowest item level that opens a session. Any lets every item level through.",
    atLeast = "At least",
    any = "Any",
    kinds = "Kinds of items",
    kindsHelp = "Tick the kinds of items that open a session. Each item counts as one kind, checked in this order: a toy; a mount or pet; a cosmetic; a tier token or set piece; then gear by how it binds (on pickup, on equip, or warbound until equipped). Anything else, such as recipes, reagents and warbound gear, is in the last box.\n\nWhen the game can't tell CRT what an item is, CRT leaves it out and says so in chat.",
    kindLabels = {
        bop = "Gear that binds on pickup",
        tier = "Tier tokens and set pieces",
        boe = "Bind on equip gear",
        wue = "Warbound until equipped",
        toy = "Toys",
        mount = "Mounts and pets",
        cosmetic = "Cosmetics (appearance only)",
        other = "Recipes, reagents and other items",
    },
    defaults = "Defaults",
}
LM.FILTER_TEXT = TEXT -- for tests

-- Changes one part of your filter and saves it.
local function change(fn)
    local filter = LM:Filter()
    fn(filter)
    LM:SetFilter(filter)
end

function LM.BuildFilterTab(f, kit)
    local refreshers = kit.refreshers
    kit.heading(f, L.col1, -8, TEXT.where, TEXT.whereHelp)
    kit.check(f, L.col1 - 2, -30, TEXT.boss, function()
        return LM:Filter().boss
    end, function(on)
        change(function(t) t.boss = on end)
    end)
    kit.check(f, L.col1 - 2, -30 - L.check, TEXT.trash, function()
        return LM:Filter().trash
    end, function(on)
        change(function(t) t.trash = on end)
    end)

    kit.heading(f, L.col1, -100, TEXT.quality, TEXT.qualityHelp)
    local quality = UI.Dropdown(f, "", {
        labelWidth = 0, width = L.dropW,
        options = function()
            local out = {}
            for _, q in ipairs(LM.FILTER_QUALITIES) do
                local label = TEXT.qualityChoice:format(TEXT.qualities[q] or tostring(q))
                -- in the quality's colour (C_Item.GetItemQualityColor: r, g, b, each 0 to 1)
                local ok, r, g, b = pcall(C_Item.GetItemQualityColor, q)
                if ok and type(r) == "number" and type(g) == "number" and type(b) == "number" then
                    label = string.format("|cff%02x%02x%02x%s|r", math.floor(r * 255 + 0.5), math.floor(g * 255 + 0.5),
                        math.floor(b * 255 + 0.5), label)
                end
                out[#out + 1] = { key = q, label = label }
            end
            return out
        end,
        get = function()
            return LM:Filter().quality
        end,
        set = function(q)
            change(function(t) t.quality = q end)
        end,
    })
    quality:SetPoint("TOPLEFT", L.col1, -122)
    refreshers[#refreshers + 1] = quality.refresh

    kit.heading(f, L.col1, -170, TEXT.ilvl, TEXT.ilvlHelp)
    local lim = LM.LIMITS.filterIlvl
    local ilvl = UI.Slider(f, TEXT.atLeast, {
        min = lim[1], max = lim[2], step = lim[3], labelWidth = L.sliderLabel, width = L.sliderW,
        format = function(v)
            return v == 0 and TEXT.any or tostring(v)
        end,
        get = function()
            return LM:Filter().ilvl
        end,
        set = function(v)
            change(function(t) t.ilvl = v end)
        end,
    })
    ilvl:SetPoint("TOPLEFT", L.col1, -192)
    refreshers[#refreshers + 1] = ilvl.refresh

    kit.heading(f, L.col2, -8, TEXT.kinds, TEXT.kindsHelp)
    local y = -30
    for _, key in ipairs(LM.FILTER_KINDS) do
        kit.check(f, L.col2 - 2, y, TEXT.kindLabels[key] or key, function()
            return LM:Filter().kinds[key]
        end, function(on)
            change(function(t) t.kinds[key] = on end)
        end)
        y = y - L.check
    end
    local defaults = UI.PanelButton(f, TEXT.defaults, 24, function()
        LM:SetFilter(LM.FilterDefaults())
    end)
    defaults:SetPoint("TOPLEFT", L.col2 + 4, y - 10)
end
