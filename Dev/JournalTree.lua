local ADDON, CRT = ...

-- DEVELOPER ONLY. /crt dev journaltree [journalEncounterID]: a boss's Encounter Journal sections, one line
-- each in the order the Journal walks them, to paste back when an export splits a boss wrong. Without an ID
-- it is the boss open in the Journal window. Each line: depth (indent), section ID, header type, title,
-- spell ID, the icon flags as tag words, "hidden" when the Journal leaves it out for its picked difficulty,
-- and "stage" when Journal.FromJournalEncounter takes it as one. Opens in the copy window.
-- This file never ships: its .toc line is inside the do-not-package block.

local Tree = {}
CRT.JournalTree = Tree

function Tree:Show(arg)
    local id = tonumber(arg) or (EncounterJournal and EncounterJournal.encounterID)
    if not id then
        CRT:Print("Journal tree: open a boss in the Journal, or give its Journal encounter ID.")
        return
    end
    if InCombatLockdown() then
        CRT:Print("Journal tree: not in combat.")
        return
    end
    local ok, name, _, _, root, _, _, dungeonID = pcall(EJ_GetEncounterInfo, id)
    if not ok or not name then
        CRT:Print("Journal tree: no Journal encounter " .. tostring(id) .. ".")
        return
    end
    local Journal = CRT.TimelineJournal
    local lines = {
        string.format("%s (Journal %d, encounter %s, difficulty %s)", name, id, tostring(dungeonID),
            tostring(EJ_GetDifficulty and EJ_GetDifficulty())),
        "depth  section  headerType  title  [spell]  {tags}  hidden  stage",
    }
    local visited = {}
    local function walk(sid, depth)
        while sid and sid ~= 0 and not visited[sid] do
            visited[sid] = true
            local okInfo, info = pcall(C_EncounterJournal.GetSectionInfo, sid)
            if not okInfo or type(info) ~= "table" then
                return
            end
            local tags = Journal.SectionTags and Journal.SectionTags(sid) or {}
            local stage = Journal.IsStage and Journal.IsStage(info) and "  stage" or ""
            lines[#lines + 1] = string.format("%s%d  %d  h%d  %s%s%s%s%s", string.rep("  ", depth - 1), depth, sid,
                info.headerType or -1, info.title or "?",
                (info.spellID and info.spellID > 0) and ("  [" .. info.spellID .. "]") or "",
                #tags > 0 and ("  {" .. table.concat(tags, " ") .. "}") or "",
                info.filteredByDifficulty and "  hidden" or "", stage)
            walk(info.firstChildSectionID, depth + 1)
            sid = info.siblingSectionID
        end
    end
    walk(root, 1)
    CRT.ConsumablesTools:ShowText("Journal tree: " .. name .. " (Ctrl+C to copy)", table.concat(lines, "\n"))
end
