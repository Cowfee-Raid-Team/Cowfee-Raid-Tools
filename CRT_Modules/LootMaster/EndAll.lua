local ADDON, CRT = ...

-- End session asks first (Alex, 2026-10-22: "Can we also add a confirmation to the end session? 'Are you
-- sure you want to end all loot session?'"; the mockup approved: "End all ends everything"). Every End
-- session (Loot Master > Tonight, the looter window, /crt loot end) calls LM:AskEnd. With a session running
-- or boss loot waiting for its turn (LootMaster/BossLoot.lua's BL.waiting), the game's generic confirm
-- dialog asks, lifted over CRT's windows (UI.LiftOver), with what is still open: the running session's
-- items not given out yet and the waiting items. End all (LM:EndAll) drops the waiting items, ends the
-- running session and clears the TEST rows; Cancel changes nothing. With nothing running and nothing
-- waiting there is no dialog: End session only clears the TEST rows, as before.
-- The dialog: StaticPopup_ShowCustomGenericConfirmation (text, acceptText, cancelText, callback, showAlert),
-- Blizzard_StaticPopup/StaticPopup.lua in Blizzard's UI source (checked 2026-10-22). Its text goes
-- through SetFormattedText, so it holds no "%".

local LM = CRT.LootMaster
local UI = CRT.UI

local TEXT = {
    ask = "Are you sure you want to end all loot sessions?",
    deciding = "%d %s still being decided",
    waiting = "%d %s waiting to start",
    waitingMore = "%d more %s waiting to start",
    item = "item is", items = "items are",
    endAll = "End all",
    cancel = "Cancel",
}

-- What End all would end: the running session's items not given out yet, and the items waiting for their
-- turn. Both 0 with a session running whose items are all given out.
function LM:EndCounts()
    local deciding = 0
    local s = self.current
    if s then
        for _, it in ipairs(s.items) do
            if not it.award then
                deciding = deciding + 1
            end
        end
    end
    local BL = self.BossLoot
    return deciding, BL and BL:WaitingCount() or 0
end

-- The dialog's second line: "3 items are still being decided, and 4 more are waiting to start.", leaving out
-- a part that is 0; nil when both are.
function LM.EndDetail(deciding, waiting)
    local function plural(n)
        return n == 1 and TEXT.item or TEXT.items
    end
    local parts = {}
    if deciding > 0 then
        parts[#parts + 1] = TEXT.deciding:format(deciding, plural(deciding))
    end
    if waiting > 0 then
        if deciding > 0 then
            parts[#parts + 1] = TEXT.waitingMore:format(waiting, waiting == 1 and "is" or "are")
        else
            parts[#parts + 1] = TEXT.waiting:format(waiting, plural(waiting))
        end
    end
    if #parts == 0 then
        return nil
    end
    return table.concat(parts, ", and ") .. "."
end

-- Ends everything: the items waiting for their turn first (so the session's end starts none of them), then
-- the running session, then the TEST rows.
function LM:EndAll()
    local BL = self.BossLoot
    if BL then
        BL:DropWaiting()
    end
    self:End()
    if not self.current and BL then
        BL:ClearTests()
    end
end

-- End session: asks first when a session runs or items wait; otherwise clears the TEST rows.
function LM:AskEnd()
    local BL = self.BossLoot
    local waitingAny = BL and #BL.waiting > 0
    if not self.current and not waitingAny then
        if BL then
            BL:ClearTests()
        end
        return
    end
    local detail = LM.EndDetail(self:EndCounts())
    local text = detail and (TEXT.ask .. "\n\n" .. detail) or TEXT.ask
    if not StaticPopup_ShowCustomGenericConfirmation then
        return -- no dialog to ask with: nothing ends without the click
    end
    UI.LiftOver(UI.ShownPopup(StaticPopup_ShowCustomGenericConfirmation({
        text = text, acceptText = TEXT.endAll, cancelText = TEXT.cancel, showAlert = true,
        callback = function()
            LM:EndAll()
        end,
    }), "GENERIC_CONFIRMATION"))
end
