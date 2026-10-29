local ADDON, CRT = ...

-- /crt. Core's own words are below; a module registers its own (CRT.Slash:Register, in its own files), so
-- each word lives beside the code it runs. Developer words stay in the do-not-package block.
local Slash = { words = {}, order = {} }
CRT.Slash = Slash

-- word: the first word typed, in lower case. def:
--   run      run(rest, msg, raw): rest is what follows the word (lower case), msg the whole command (lower
--            case), raw as typed. Returns false when it doesn't know rest, for "Unknown command".
--   help     the lines /crt help lists for it; each part typed as a command is in square brackets
--            ("[/crt late start], [end] - ..."), shown in the help's command colour
--   top      true: listed at the top of /crt help, right under /crt itself (a page most players open first);
--            the others come after Core's notes lines, in the order they registered
function Slash:Register(word, def)
    if not self.words[word] then
        self.order[#self.order + 1] = word
    end
    self.words[word] = def
end

-- Runs a registered word. True when the command was handled.
function Slash:Run(msg, raw)
    local word, rest = msg:match("^(%S+)%s*(.-)$")
    local def = word and self.words[word]
    if not def then
        return false
    end
    return def.run(rest, msg, raw) ~= false
end

local function printLines(lines)
    for _, line in ipairs(lines or {}) do
        print("  " .. line:gsub("%[(.-)%]", "|cffffd100%1|r"))
    end
end

-- The help lines of the registered words with top == top.
local function printWords(top)
    for _, word in ipairs(Slash.order) do
        local def = Slash.words[word]
        if (def.top == true) == top then
            printLines(def.help)
        end
    end
end

local function printHelp()
    CRT:Print("v" .. CRT.version .. " commands:")
    print("  |cffffd100/crt|r - open or close the main panel")
    printWords(true)
    print("  |cffffd100/crt readycheck|r - open the Ready Check page (|cffffd100/crt consumables|r opens its Your bar tab)")
    print("  |cffffd100/crt check|r - open the ready check window for your group, open until you right-click it")
    print("  |cffffd100/crt check food|r, |cffffd100flask|r, |cffffd100rune|r, |cffffd100vantus|r, |cffffd100buffs|r or |cffffd100all|r - check the group, add |cffffd100chat|r to post it")
    print("  |cffffd100/crt rc|r - preview your ready check bar")
    print("  |cffffd100/crt debuffs|r - open the Debuffs tab on Quality of Life")
    print("  |cffffd100/crt notes|r - open the Raid Notes page (|cffffd100/crt notes settings|r opens its Notes Settings tab)")
    print("  |cffffd100/crt reminders|r - open the Mech Alerts tab of Raid Notes")
    print("  |cffffd100/crt note test|r, |cffffd100next|r, |cffffd100stop|r - start the active note now, start the next phase, stop")
    printWords(false)
    print("  |cffffd100/crt break 10|r - a 10 minute break timer (any minutes, 0 cancels); from a raid leader or assistant it reaches the whole raid")
    print("  |cffffd100/crt qol|r - open the Quality of Life page (low health and debuffs)")
    print("  |cffffd100/crt settings|r - open General Settings: window, fonts, sound, minimap button, layers, profiles")
    print("  |cffffd100/crt team|r - tonight's team, as on General Settings > Team raids")
    print("  |cffffd100/crt minimap|r - show or hide the minimap button")
    print("  |cffffd100/crt lowhp off|r, |cffffd100on|r, |cffffd100info|r, |cffffd100stop|r - turn the experimental low-health alert off or on, print its diagnostics, or stop any sound it is playing")
    print("  |cffffd100/crt perf|r - this addon's CPU use since the last /reload, from the game's profiler")
    print("  |cffffd100/crt previews|r - toggle the panel previews, same as the button in the main window")
    print("  |cffffd100/crt consumables scan|r - list your buffs and bag consumables, for updating the list")
    print("  |cffffd100/crt consumables check|r - test every ID in the built-in consumables list")
    print("  |cffffd100/crt whatsnew|r - what's new in this version")
    print("  |cffffd100/crt help|r - show this list")
end

SLASH_COWFEERAIDTOOLS1 = "/crt"
SlashCmdList["COWFEERAIDTOOLS"] = function(msg)
    local raw = strtrim(msg or "")
    msg = raw:lower()
    if Slash:Run(msg, raw) then
        return
    end
    if msg == "" then
        CRT.UI:Toggle()
    elseif msg == "readycheck" or msg == "ready" then
        CRT.ReadyCheckPage.Open("window")
    elseif msg == "consumables" then
        CRT.ReadyCheckPage.Open("bar")
    elseif msg == "check" then
        CRT.ReadyCheckWindow:Show(nil, false, true)
    elseif msg:match("^check") then
        local what, chat = msg:match("^check%s*(%a*)%s*(%a*)$")
        local keys = {}
        for _, check in ipairs(CRT.RaidReport.CHECKS) do
            if what == "all" or what == check.key or (what == "buff" and check.key == "buffs") then
                keys[#keys + 1] = check.key
            end
        end
        if #keys == 0 then
            CRT:Print("Use /crt check food, flask, rune, vantus, buffs or all, and add chat to post it.")
        else
            CRT.RaidReport:Check(keys, chat == "chat")
        end
    elseif msg == "consumables scan" then
        CRT.ConsumablesTools:Scan()
    elseif msg == "consumables check" then
        CRT.ConsumablesTools:Check()
    elseif msg == "debuffs" then
        CRT.QoLPage.Open("debuffs")
    elseif msg == "notes" then
        CRT.NotesPage.Open("notes")
    elseif msg == "reminders" then
        CRT.NotesPage.Open("reminders")
    elseif msg == "notes settings" then
        CRT.NotesPage.Open("settings")
    elseif msg == "note test" then
        local id = CRT.Notes:Active()
        if id then
            CRT.NoteEngine:Start(CRT.Notes:Parsed(id), "test")
        else
            CRT:Print("No note is in use. Pick one on the Raid Notes page.")
        end
    elseif msg == "note next" then
        local ph = CRT.NoteEngine:NextPhase()
        CRT:Print(ph and ("Phase " .. ph .. " started.") or "No phase left to start, or nothing is running.")
    elseif msg == "note stop" then
        CRT.NoteEngine:Stop()
    elseif msg == "lowhp stop" then
        CRT.LowHealthSound:StopAll()
        CRT:Print("Stopped every low-health sound the addon was playing.")
    elseif msg == "lowhp info" then
        CRT.LowHealth:Info()
    elseif msg == "lowhp off" or msg == "lowhp on" then
        CRT.LowHealth:SetEnabled(msg == "lowhp on")
        CRT:Print("Low-health alert " .. (msg == "lowhp on" and "on." or "off."))
    --@do-not-package@
    elseif msg == "dev debuffs" then
        CRT.DebuffPanel:ShowInfo()
    elseif msg == "dev journaltree" or msg:match("^dev journaltree%s") then
        if CRT.JournalTree then
            CRT.JournalTree:Show(msg:match("^dev journaltree%s+(%d+)"))
        end
    elseif msg == "dev bosses" then
        if CRT.BossOrder then
            CRT.BossOrder:Toggle()
        end
    elseif msg == "dev seasons" then
        if CRT.SeasonTools then
            CRT.SeasonTools:Toggle()
        end
    elseif msg == "dev seasons ids" then
        if CRT.SeasonTools then
            CRT.SeasonTools:Ids()
        end
    elseif msg == "dev seasons clearstats" or msg:match("^dev seasons clearstats%s") then
        -- one season's Season Stats counters, asked first (Dev/SeasonTools.lua)
        if CRT.SeasonTools then
            CRT.SeasonTools:ConfirmClearStats(msg:match("^dev seasons clearstats%s+(%S+)"))
        end
    elseif msg == "dev markers" then
        if CRT.MarkerEditor then
            CRT.MarkerEditor:Toggle()
        end
    elseif msg == "dev hidden" then
        if CRT.ReferenceTypes then
            CRT.ReferenceTypes:PrintHidden()
        end
    elseif msg == "dev mechhidden" then
        if CRT.ReferenceTypes then
            CRT.ReferenceTypes:PrintMechHidden()
        end
    elseif msg == "dev removed" then
        if CRT.ReferenceTypes then
            CRT.ReferenceTypes:PrintRemoved()
        end
    elseif msg == "dev types" then
        if CRT.ReferenceTypes then
            CRT.ReferenceTypes:Toggle()
        end
    elseif msg == "dev winlog" then
        if CRT.WindowLog then
            CRT.WindowLog:Toggle()
        end
    elseif msg == "dev late" then
        if CRT.LateTest then
            CRT.LateTest:Toggle()
        end
    elseif CRT.NoteTargetsDev and CRT.NoteTargetsDev:Command(msg) then
        -- dev nsrt, dev mrt and dev all: the note targets (Dev/NoteTargets.lua)
    elseif CRT.LootDev and CRT.LootDev:Command(msg, raw) then
        -- dev loot: fake records, stats, the RCLootCouncil match report (Dev/Loot.lua)
    elseif CRT.SoundDev and CRT.SoundDev:Command(msg, raw) then
        -- dev sound: play any sound reference, list them (Dev/Sound.lua)
    elseif CRT.GearProbe and CRT.GearProbe:Command(msg, raw) then
        -- dev gear: your items' (or a seen player's) item, enchant, gem and bonus IDs (Dev/GearProbe.lua)
    elseif CRT.BreaksDev and CRT.BreaksDev:Command(msg) then
        -- dev break: the break timer's other-addon formats (Dev/Breaks.lua)
    elseif CRT.GameTimelineProbe and CRT.GameTimelineProbe:Command(msg) then
        -- dev gametimeline: add one event to the game's boss timeline and print the result (Dev/GameTimelineProbe.lua)
    elseif CRT.ClearProbe and CRT.ClearProbe:Command(msg) then
        -- dev clearprobe on, off, show: log a pull's possible reset moments for a marker display (Dev/ClearProbe.lua)
    elseif CRT.KickProbe and CRT.KickProbe:Command(msg) then
        -- dev kicks on, off, show: log each nameplate cast's offset from its wave anchor in a pull (Dev/KickProbe.lua)
    elseif CRT.AbsorbProbe and CRT.AbsorbProbe:Command(msg) then
        -- dev absorbprobe on, off, show: log whether a boss's absorb shield is readable in a pull (Dev/AbsorbProbe.lua)
    elseif CRT.ShieldBarDev and CRT.ShieldBarDev:Command(msg) then
        -- dev shieldbar (off): the shield bar on your own absorb, against a dummy (Dev/ShieldBarDev.lua)
    elseif CRT.BossDebug and CRT.BossDebug:Command(msg) then
        -- dev bossdebug on, off, show [boss], emotes [boss]: log every boss pull, one log per boss, to copy;
        -- emotes copies only its boss emotes and yells, with phase triggers (Dev/BossDebug.lua, BossEmotes.lua)
    elseif CRT.MarkerProbe and CRT.MarkerProbe:Command(msg) then
        -- dev markerprobe: try drawing a raid marker from hidden chat text (Dev/MarkerProbe.lua)
    elseif CRT.SpecialSampleDev and CRT.SpecialSampleDev:Command(msg) then
        -- dev special (off): a sample special alert on the boss Mech Alerts shows, never saved (Dev/SpecialSample.lua)
    elseif CRT.AlertExportDev and CRT.AlertExportDev:Command(msg) then
        -- dev alerts: export a boss's alerts as a code or as Lua to ship, and import a code (Dev/AlertExport.lua)
    elseif msg == "dev layout" then
        if CRT.LayoutCheck then
            CRT.LayoutCheck:Run()
        end
    elseif msg == "dev stamp" then
        if CRT.WindowLog then
            CRT.WindowLog:Stamp()
        end
    elseif msg == "dev reset" then
        if CRT.Dev then
            CRT.Dev:ResetAllPositions()
        end
    elseif msg == "dev clear" then
        if CRT.Dev then
            CRT.Dev:ClearAll()
        end
    elseif msg == "dev probe show" or msg == "dev probe" then
        if CRT.TimelineProbe then
            if msg == "dev probe" then
                CRT.TimelineProbe:Arm()
            else
                CRT.TimelineProbe:Show()
            end
        else
            CRT:Print("The timeline probe is not loaded.")
        end
    elseif msg == "dev whatsnew" then
        -- forget the version seen, so the next /reload shows What's new as after an update, every entry combined
        CRT.db.whatsNew.seen = "0"
        CRT:Print("What's new will show about 5 seconds after your next /reload.")
    elseif msg == "dev edit" then
        if CRT.Dev then
            CRT.Dev:Toggle()
        end
    elseif msg == "dev" then
        if CRT.UI.pages.dev then
            CRT.UI:SetPageHidden("dev", false)
            CRT.UI:Show("dev")
        else
            CRT:Print("The Development page is not loaded.")
        end
    --@end-do-not-package@
    elseif msg == "break" or msg:match("^break%s") then
        CRT.BreakTimer:Command(msg:match("^break%s+(%S+)"))
    elseif msg == "qol" then
        CRT.UI:Show("qol")
    elseif msg == "settings" then
        CRT.UI:Show("settings")
    elseif msg == "team" then
        -- the same status line as General Settings > Team raids (Team.lua)
        CRT:Print(CRT.Team.StatusLine())
    elseif msg == "minimap" then
        local hide = not CRT.db.minimap.hide
        CRT.MinimapButton:SetHidden(hide)
        CRT:Print(hide and "Minimap button hidden. Type /crt minimap to show it again." or "Minimap button shown.")
    elseif msg == "perf" then
        CRT.Perf:Report()
    elseif msg == "previews" then
        CRT.UI:TogglePreviews()
    elseif msg == "rc" then
        CRT.ConsumablesDisplay:Preview()
    elseif msg == "whatsnew" or msg == "whats new" or msg == "what's new" then
        CRT.WhatsNew:ShowNow()
    elseif msg == "help" or msg == "?" then
        printHelp()
    else
        CRT:Print("Unknown command '" .. msg .. "'. Type /crt help for the list.")
    end
end
