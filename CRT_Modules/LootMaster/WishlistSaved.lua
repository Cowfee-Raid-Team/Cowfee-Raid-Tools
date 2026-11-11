local ADDON, CRT = ...

-- Saved copies of raiders' wishlists (Alex, 2026-11-11, Issue #1269). A keeper (W.Keeps: a guild officer, the loot
-- master, the group leader or a raid assist) saves every list heard, on the group or the guild channel
-- (LootMaster/Wishlist.lua hands each one to W.Keep), so an officer can weigh bosses for the team between raids.
-- Saved account-wide, shared by your characters, in CRTDB lootmaster.wishlists:
--   [Name-Realm] = { items = { [itemID] = "big" | "small" | "off" }, at = <the raider's stamp: when their list last
--                    changed>, got = <time() it arrived>, class = <class file, when known> }
-- A newer stamp replaces the copy; an older or equal one is ignored. At most MAX raiders are kept: past that, the
-- copy that arrived longest ago goes. Forget (one raider) and Forget all (asks first) clear them. Nothing here
-- draws: the Wishlists tab is LootMaster/WishlistTab.lua, its numbers LootMaster/WishlistViews.lua.

local LM = CRT.LootMaster
local UI = CRT.UI
local W = LM.Wishlist

W.SAVED_MAX = 200 -- raiders kept at most

local TEXT = {
    forgetAll = "Forget every raider's saved wishlist?",
    forget = "Forget all",
    cancel = "Cancel",
}

local function secret(v)
    return issecretvalue ~= nil and issecretvalue(v) or false
end

-- The saved copies, made when missing.
function W.Saved()
    local set = LM:Settings()
    if type(set.wishlists) ~= "table" then
        set.wishlists = {}
    end
    return set.wishlists
end

-- A saved copy that reads: { items, at, got, class }, or nil.
function W.SavedList(name)
    local e = type(name) == "string" and W.Saved()[name]
    if type(e) == "table" and type(e.items) == "table" then
        return e
    end
    return nil
end

-- A player's class file: from their group unit, else the class cache Raid Groups keeps (CRTDB classCache); nil
-- when unknown or secret.
function W.ClassOf(name)
    local unit = LM.UnitOf and LM.UnitOf(name)
    if unit and UnitClass then
        local _, class = UnitClass(unit)
        if class and not secret(class) then
            return class
        end
    end
    local cache = CRT.db and CRT.db.classCache
    local class = type(cache) == "table" and type(name) == "string" and cache[name:lower()] or nil
    return type(class) == "string" and class or nil
end

-- Drops the copies that arrived longest ago, past SAVED_MAX.
local function trim(store)
    local names = {}
    for name, e in pairs(store) do
        names[#names + 1] = { name = name, got = type(e) == "table" and tonumber(e.got) or 0 }
    end
    if #names <= W.SAVED_MAX then
        return
    end
    table.sort(names, function(a, b)
        if a.got ~= b.got then
            return a.got < b.got
        end
        return a.name < b.name
    end)
    for i = 1, #names - W.SAVED_MAX do
        store[names[i].name] = nil
    end
end

-- Saves a raider's list (items { [itemID] = rank }) with their stamp at, unless the copy kept is as new or newer.
-- Returns whether it was saved.
function W.Keep(name, items, at)
    if type(name) ~= "string" or name == "" or type(items) ~= "table" or type(at) ~= "number" then
        return false
    end
    local store = W.Saved()
    local old = W.SavedList(name)
    if old and type(old.at) == "number" and at <= old.at then
        return false
    end
    local copy = {}
    for id, rank in pairs(items) do
        if type(id) == "number" and W.IsRank(rank) then
            copy[id] = rank
        end
    end
    store[name] = { items = copy, at = at, got = time(), class = W.ClassOf(name) or (old and old.class) or nil }
    trim(store)
    LM:Fire("wishlists", name)
    return true
end

function W.Forget(name)
    local store = W.Saved()
    if store[name] == nil then
        return false
    end
    store[name] = nil
    LM:Fire("wishlists", name)
    return true
end

function W.ForgetAll()
    local set = LM:Settings()
    set.wishlists = {}
    LM:Fire("wishlists")
end

-- Forget all asks first: the game's generic confirm dialog (StaticPopup_ShowCustomGenericConfirmation, as
-- LootMaster/EndAll.lua uses it), lifted over CRT's windows. No dialog, nothing forgotten.
function W.AskForgetAll()
    if not StaticPopup_ShowCustomGenericConfirmation then
        return
    end
    UI.LiftOver(UI.ShownPopup(StaticPopup_ShowCustomGenericConfirmation({
        text = TEXT.forgetAll, acceptText = TEXT.forget, cancelText = TEXT.cancel, showAlert = true,
        callback = function()
            W.ForgetAll()
        end,
    }), "GENERIC_CONFIRMATION"))
end
