local ADDON, CRT = ...

-- End session asks first (Alex, 2026-10-22: "Can we also add a confirmation to the end session? 'Are you
-- sure you want to end all loot session?'"; the mockup approved: "End all ends everything"). Every End
-- session (Loot Master > Tonight, the Master Loot Window, /crt loot end) calls LM:AskEnd. With a session running
-- or boss loot waiting for its turn (LootMaster/BossLoot.lua's BL.waiting), the game's generic confirm
-- dialog asks, lifted over CRT's windows (UI.LiftOver), with what is still open: the running session's
-- items not given out yet and the waiting items. End all (LM:EndAll) sends the real waiting items back to
-- Held boss loot, unticked (BL:ReturnWaiting; the orchestrator's default, 2026-10-22, Alex can veto),
-- drops the waiting TEST items, ends the running session and clears the TEST rows; Cancel changes
-- nothing. With nothing running and nothing waiting there is no dialog: End session only clears the TEST
-- rows, as before.
-- The dialog: StaticPopup_ShowCustomGenericConfirmation (text, acceptText, cancelText, callback, showAlert),
-- Blizzard_StaticPopup/StaticPopup.lua in Blizzard's UI source (checked 2026-10-22). Its text goes
-- through SetFormattedText, so it holds no "%".

local LM = CRT.LootMaster
local UI = CRT.UI

local TEXT = {
    ask = "Are you sure you want to end all loot sessions?",
    deciding = "%d %s still being decided",
    waiting = "%d %s waiting to start", -- TEST items: they end too
    back = "%d %s waiting and %s back to Held boss loot", -- real items
    item = "item is", items = "items are", more = "more is", mores = "more are", goes = "goes", go = "go",
    endAll = "End all",
    cancel = "Cancel",
}

-- What End all would end: the running session's items not given out yet, the real items waiting for their
-- turn (they go back to the list) and the waiting TEST items. All 0 with a session running whose items are
-- all given out.
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
    local back, tests = 0, 0
    if BL then
        back, tests = BL:WaitingKinds()
    end
    return deciding, back, tests
end

-- The dialog's second line, e.g. "3 items are still being decided, and 4 more are waiting and go back to
-- Held boss loot.", leaving out a part that is 0; nil when all are.
function LM.EndDetail(deciding, back, tests)
    back, tests = back or 0, tests or 0
    local parts = {}
    local function noun(n)
        if #parts > 0 then
            return n == 1 and TEXT.more or TEXT.mores
        end
        return n == 1 and TEXT.item or TEXT.items
    end
    if deciding > 0 then
        parts[#parts + 1] = TEXT.deciding:format(deciding, noun(deciding))
    end
    if tests > 0 then
        parts[#parts + 1] = TEXT.waiting:format(tests, noun(tests))
    end
    if back > 0 then
        parts[#parts + 1] = TEXT.back:format(back, noun(back), back == 1 and TEXT.goes or TEXT.go)
    end
    if #parts == 0 then
        return nil
    elseif #parts == 1 then
        return parts[1] .. "."
    end
    return table.concat(parts, ", ", 1, #parts - 1) .. ", and " .. parts[#parts] .. "."
end

-- Ends everything: the items waiting for their turn first (real ones back to the list, unticked, so the
-- session's end starts none of them), then the running session, then the TEST rows.
function LM:EndAll()
    local BL = self.BossLoot
    if BL then
        BL:ReturnWaiting()
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
