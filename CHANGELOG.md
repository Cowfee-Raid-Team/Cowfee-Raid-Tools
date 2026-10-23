# Changelog

## 1.1.2 beta 2 (2026-10-23)

- **Requests** (new page under Modules): ask the raid who needs an item, like a Vantus rune or a flask. Raiders answer with a popup, and Trade 1 hands one to each player who needs one.
- **Loot Master:**
  - End session asks before ending everything; real items still waiting go back to the Held boss loot list.
  - Add item from your bags: drag or shift-click any item you can still trade onto the Tonight tab, one copy per drag.
  - Flasks, potions and other items you don't wear are open to every raider.
  - Trades put in exactly one copy and never leave an item on your cursor.
- **Tooltips:**
  - Click where tooltips open, on a picker around the window, or let each open on its own side (the default).
  - A picked spot sits outside the edge of the window you're in, or of a popped-out page.
  - Loot History, Loot Master (with its item tabs) and the Timeline can each have their own setting.
- **Raid Notes:** the Timers window no longer stutters on large notes during a pull.
- **Menu:** spacing tightened so every page fits.

## 1.1.2 beta 1 (2026-10-22)

- **Menu:** the side menu is in four groups with headers: General, Raid Admin, Bosses and Modules.
- **Help icons:** every (?) sits just right of what it explains, on every page.
- **Tooltip position** (General Settings > Appearance): show CRT tooltips next to what you hover, or at the game's own tooltip spot.
- **Profiles:** Export settings only, for sharing your setup with raiders: no notes, layouts or history, and nothing personal like chat output. Import shows what will change first, keeps a backup, and has Undo.
- **Invites:** Invite missing on Raid Groups, and click a player who isn't here on the Late Tracker to invite them. Each player moves into their group when they join, after combat if needed.
- **Loot Master:**
  - Test boss kill holds test loot on the Tonight tab like a real kill; Start session gives it out.
  - CRT Looting stays on through a /reload.
  - The Boss loot list is kept for the whole raid, with each item's 2-hour trade time.
  - Items outside the raid leader's loot filter get a normal roll.
- **Mech Alerts:** alerts are saved for Normal/Heroic or Mythic. Old "Any" alerts now show in both.
- **Raid Notes:**
  - The note editor can pick its players from the group, the invite list or a Raid Groups layout.
  - "Demon Hunter" and "Death Knight" are one class everywhere.
  - An assignment line naming your class counts as yours.
  - The note windows no longer show outside a raid by default.
- **Markers:** marker macros on Raid Notes (make, update, drag to your bars), a freeform marker canvas, and marker displays for Sszorak and Nek'zali.
- **Timeline:** Export Abilities works for raids older than Warlords of Draenor.
- **Your own sounds** now play only from the CowfeeRaidTools_Media companion addon.
- **Fixes:** the Raid Groups name picker opens in front, and the ready check consumables bar draws on top.

## 1.1.1 (2026-10-21)

- **Gear Checker** (new page): every raider's gear, gems, enchants and upgrade tracks, with filters, issue tooltips and a right-click to send issues to chat. Pop it out into its own window.
- **Alert timeline** (new alert area): icons slide down a line to a NOW effect, with many look options. Standalone by default, or add your alerts to the game's boss timeline, or replace it.
- **Alerts:** every alert takes its ability's type colour (custom colours behind a checkbox), bars name the type, and bars get spacing and border settings.
- **One source for boss timers:** Mech Alerts, the Timeline, rehearsals and alerts all use the same casts. Mech Alerts lists the timeline's abilities in their type colours.
- **Rehearsal:** one continuous countdown from Next up to the cast bar, with up to three cast bars.
- **Raid Notes:** notes show rendered with class-coloured names and spell icons (click to edit the raw text), and a pop-out editor to drag names onto assignment lines and the invite list.
- **Loot Master:** the raider popup looks like the game's loot roll frame; the gear column shows your full equipped items.
- **Debuffs:** shown everywhere, a new icon look, a muted swipe, and grow left or right.
- **Ready Check:** your bar sits under the game's ready check window; Close for the raid leader only.
- **Themes:** one heading, good, warning and bad colour per theme, themed scroll bars and a menu divider.

## 1.1.0 (2026-10-20)

- CRT Looting passes for real: while it's on, raiders' boss rolls are passed as soon as the loot window shows, and chat says what happened.
- The raid leader's CRT rolls Need (or Greed or Transmog) and a Boss loot window lists each item and who won it; tick the items and click Start session.
- Loot Master: choose where item tooltips open (Item tooltip on the Settings tab).
- The Timeline pop-out uses the game's window art in Default: Blizzard, and the clicked window comes to the front.

## 1.0.0 (2026-10-20)

The first full release. Everything Cowfee Raid Tools does:

- **Raid Groups:** save raid layouts of 8 groups, edit them, import a layout or a pasted list of names, and move the live raid into one with a click.
- **Ready Check:** your own consumables bar on every ready check, a raid report of food, flasks, runes and raid buffs, and a leader window with every player's answer, consumables, buffs and durability.
- **Debuffs:** a movable panel for the boss debuffs on you in combat, with dispel-coloured borders and glow, a preview, and size and spacing settings.
- **Raid Notes:** boss notes with timers from the pull, shared by the raid leader; timer, assignment and personal note windows; your own reminders; alerts as icons, texts, bars and circles with text to speech; a show outside of raid setting.
- **Timeline:** every raid boss pull saved and drawn as a timeline with deaths; reference ability timelines with phases (Nek'zali, Nymrissa Wavecaller and Kith'ix on Mythic); a rehearsal mode that plays your alerts without pulling.
- **Pace:** where each boss's health should be through the fight, with AHEAD or BEHIND in the pull, and plans the leader can share.
- **Late Tracker:** raid days and a start time, a clock for anyone missing, and a history of every night.
- **Tattlebot:** who took damage from avoidable boss mechanics, per pull and per night, posted to chat or exported for Discord.
- **Loot History:** boss loot recorded, matched to RCLootCouncil's awards, listed and exported.
- **Loot Master:** raider popups with your response buttons, a looter window with sortable columns and Raider Score, automatic Transmog answers for items a raider can't use, Sync Master Loot for officers, a loot filter, and CRT Looting on or off for the raid.
- **Quality of Life:** a low-health banner.
- **Looks:** four themes from the title bar (Default: Blizzard, Blackout: Midnight, Blackout: Nitro and Beanworks: Cowfee), with modern sliders, checkboxes and help icons.
- **General Settings:** window scale and opacity, fonts and text size, window layers, sound channel, minimap button and profiles.
