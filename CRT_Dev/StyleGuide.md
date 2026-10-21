# CRT theme style guide

The one reference for CRT's colour themes: what each colour is for, every theme's values, which helper to use, what never follows the theme, and how to add a theme. A new theme is one new column in the table below and one new palette in `CRT_Core/Themes.lua`; no other code changes.

Source of truth for the values: `CRT.THEMES` in `CRT_Core/Themes.lua`. If this file and the code disagree, the code wins and this file is fixed. `CRT_Dev/Tests/run_themes.js` checks every theme has every key and pins the main values; `run_palette.js` checks every key the code names is a palette key.

## The roles

Every theme fills every key in `CRT.THEME_KEYS`. Each key is named for what it colours. One line each:

| Key | What it colours |
|---|---|
| background | the window background |
| surface | menu blocks, fields, buttons, list rows, an unticked checkbox |
| border | borders, the empty part of a slider's track, a scroll bar's rail, the alert bars' Border |
| selected | the selected page and tab, an unticked checkbox's edge |
| accent | lines, a slider's filled track, hover edges, the Modern help ring, scroll bar thumbs, the alert timeline's line and its tick marks |
| label | button text and labels (the game's gold font takes this colour in a Modern theme) |
| heading | headings, section titles, highlights, a selected row's tint (`UI.HeadingText`) |
| text | body text (the game's white font takes this colour in a Modern theme) |
| good | good: synced, answered, on, ready, in bags (`UI.GoodText`) |
| warn | in between: running low, worn, arrived late, a middling score, No CRT (`UI.WarnText`) |
| bad | bad: missing, late, failed, can't, not here (`UI.BadText`) |
| knob | a slider's knob, a ticked checkbox, the rounded scroll bar's thumb |
| knobBorder | the knob's and the rounded scroll bar thumb's 1 px edge |
| knobShine | the soft highlight inside the knob's and ticked box's top edge |
| knobText | the knob's value and number box |
| check | a ticked checkbox's tick |
| checkBorder | a ticked checkbox's edge |
| titleTop, titleBottom | a window title strip's gradient, top and bottom |
| muted | quiet text: the small note beside a window's title, a roll someone else won |

The four status keys mean the same thing on every page and overlay: heading for titles, good for good, warn for in between, bad for bad. Pick by meaning, never by the colour a theme happens to give.

## The values

Hex per theme, in menu order. "Game" means Default: Blizzard reads the game's own colour (fallback in brackets).

| Key | Default: Blizzard | Blackout: Midnight | Blackout: Nitro | Beanworks: Cowfee |
|---|---|---|---|---|
| background | 1C1410 | 050505 | 06080A | 17110E |
| surface | 2A1F19 | 121212 | 11151A | 2B1E17 |
| border | 4D3C30 | 2E2E2E | 28313B | 5A4231 |
| selected | 704F38 | 2A2A2A | 1E2A36 | 8C4F2B |
| accent | C78F5C | E6E6E6 | 7FB3D9 | E2A14B |
| label | DEBA8F | BDBDBD | A9BBCB | D9B48A |
| heading | game `NORMAL_FONT_COLOR` (FFD100) | BDBDBD | A9BBCB | D9B48A |
| text | F2E6D6 | F2F2F2 | EEF2F5 | F4EBDD |
| good | game `GREEN_FONT_COLOR` (19FF19) | 7FBF7F | 8FCFA0 | 8FA876 |
| warn | game `ORANGE_FONT_COLOR` (FF8040) | E6B450 | F0C060 | F2C14E |
| bad | game `RED_FONT_COLOR` (FF2020) | E06C6C | FF7F6B | C8553D |
| knob | 4A3424 | 1E1E1E | 18202A | 4A3424 |
| knobBorder | 1A120C | 000000 | 000000 | 1A120C |
| knobShine | 7A5A3E | 3A3A3A | 34414F | 7A5A3E |
| knobText | FFFFFF | F2F2F2 | EEF2F5 | FFFFFF |
| check | FFFFFF | E6E6E6 | 7FB3D9 | FFFFFF |
| checkBorder | 1A120C | E6E6E6 | 7FB3D9 | 1A120C |
| titleTop | 5A3F2C | 1C1C1C | 1A2430 | 5A3F2C |
| titleBottom | 3A2A1F | 0E0E0E | 0E1319 | 3A2A1F |
| muted | CCB599 | 9E9E9E | 8A9DB0 | CCB599 |

Default: Blizzard is the Classic look: the game's art draws the windows, so most of its column is only read by the few surfaces that use `CRT.PALETTE` in both looks. Those values are the colours from before themes and never change. Its heading, good, warn and bad are the game's own text colours.

## The helpers

All in `CRT_Core/UI/Panel.lua`, side by side. Nothing outside `Themes.lua` writes a hex or RGB copy of a theme colour.

| Helper | Use it for |
|---|---|
| `UI.HeadingText`, `UI.GoodText`, `UI.WarnText`, `UI.BadText` (text) | a heading, good, warn or bad text written into a string |
| `UI.ColorText(text, key)`, `UI.Hex(key)` | any key as `|cff` markup, or its "rrggbb" |
| `UI.Color(key, alpha)` | r, g, b, a for `SetTextColor`, `SetVertexColor`, `SetColorTexture` or a backdrop, read when drawing |
| `UI.Tint(region, setter, key, alpha)` | a part coloured once when it is made; it repaints on every switch |
| `UI.ThemedText(fontString, build)` | a text built once from the helpers (a label like AHEAD); `build()` runs again after every switch; `nil` stops it |
| `UI:OnTheme(fn)` | a surface that redraws itself and can be on screen during a switch |
| `local C = CRT.PALETTE.key` | a colour table kept in a local; `CRT.PALETTE`'s tables are refilled in place, so it follows |

Rules:
- Pages refresh on a switch (their OnShow), so text a page's refresh writes with the helpers follows by itself.
- Overlays (note windows, alerts, your bar, the ready check window, warnings) don't: each needs a `UI.Tint`, a `UI.ThemedText` or an `UI:OnTheme` hook. `run_themes.js` checks they have one.
- An `UI:OnTheme` hook only recolours CRT's own textures and font strings. It never re-anchors, shows, hides or re-wires a secure or game-owned frame, since a theme can change in combat.
- Borders on overlays follow the theme too: the alert bars' Border is the `border` key (`UI.Tint`), never a fixed black.
- A tab's `.sel` texture: colour it once with `UI.Color("heading", 0.18)`, never `UI.Tint`, because `UI:StyleTab` restyles it.
- Skinned game templates (buttons, checkboxes, edit boxes, dropdowns, scroll bars) follow through `UI.skinned`.

## Not a theme colour

These stay the same in every theme. A hard-coded one that looks like a status or theme colour says `not a theme colour` on its line, so the colour lints (`run_all.sh`) let it through.

| What | Colour | Why |
|---|---|---|
| Tooltip lines (`GameTooltip`) | the game's gold and white | the game's own frame keeps the game's text colours |
| Class colours | `C_ClassColor`, `RAID_CLASS_COLORS` | players know their class by it |
| Dispel types | the game's dispel colours | they mean a dispel type |
| Item quality and upgrade tracks | `Gear.QualityColor`, `GC.TrackColor`; the popup's item level green 1EFF00 | the game's item colours |
| The debuff panel's countdown | yellow FFD100 (1, 0.82, 0) | must read on any icon in any theme |
| Tattlebot damage numbers | orange FF8060 | Alex, 2026-10-21: not part of the style guide |
| Loot Master's looting line, "Synced to" line and all-answered count | plain in Default: Blizzard, good in a Modern theme, as before themes | Alex, 2026-10-21: excluded from colour changes |
| Gear Checker's info blue and gem blue | 4DA6FF, 8CCCFF | a season check to know about; a filled socket |
| Ability types (Timeline rows, Mech Alerts names, every alert) | `Reference.ABILITY_TYPES`, see below | each colour means a kind of ability |
| The alert timeline's icons and NOW effects | the alert's colour (as on the bars: its ability type's, a raid note line's own, yours with Use custom colours on) for an icon's edge and name, the Ring burst and the Text pop; white for the countdown, the Flash and fade, and the edge in the last 3 seconds | the type says what is coming; white reads on any icon. Its line and ticks are the theme's accent (a Line colour you pick only with Use custom colours on) |
| Chat prints | the addon's print colours | chat, not the window |
| Loot Master response buttons | the raid leader's response set | see below |
| Colours a player picks (alert areas, alerts, reminders, ability timeline rows) | saved data, used only with Use custom colours on | see below |
| A raid note line's colour (`colors:`) | the raid leader's | their shared choice: always shown |

Response buttons: a raider's popup and All Loot Rolls window colour the buttons from the session the looter sends (Comm.lua's B part), never from the raider's own saved set. A raider's own set is used only for sessions they run, and Sync Master Loot replaces it with the raid leader's.

## Ability type colours: fixed, not per theme

The Timeline's ability types colour the ability timeline's rows, the ability names in the Mech Alerts list and every alert: bars, circles, icons, texts, the alert timeline and the Next spell alert (which keeps the heading colour when the type is unknown). They are the same in every theme, since each colour means a kind of ability.

The types live in one table, `Reference.ABILITY_TYPES` at the top of `CRT_Modules/Timeline/Reference.lua`: each type's key, label, colour (rrggbb), one-line description and the Journal icons that mean it, in menu order. Its comment says how to add, reword, recolour, rename or remove a type. Every reader (`Reference.TYPES`, `TYPE_ORDER`, `TAG_TYPES`, the legend, the Set type menu, `Alerts/Colors.lua`, the Mech Alerts list, the Journal export) builds from it, so this guide keeps no copy of the colours. The "ability types" test checks the table and fails if another file writes a type's colour. The vault's timeline-reference skill points to the same table.

An alert with no known type is drawn in the theme's accent, read when it draws, so it follows a theme switch. In the Mech Alerts list an ability with no known type keeps the text colour. How an alert's type is found: `CRT_Modules/Alerts/Colors.lua`.

**Custom colours.** A colour the player picks is used only with Use custom colours on (Raid Notes > Alerts, `alerts.customColors`, off by default): the Bars' Bar colour, Background and Text colour, the Circles' Ring colour, the alert timeline's Line colour, a reminder's or a template's colour, and an ability timeline row's `color rrggbb`. Off, those rows are greyed out (`enabledIf`) and the colours are ignored but stay saved. A raid note line's own colour is the raid leader's shared choice and always shows, as do the Loot Master response colours (see above).

## Looks that aren't colours

| Theme | Window | Scroll bars | Menu |
|---|---|---|---|
| Default: Blizzard | the game's art (`BasicFrameTemplateWithInset`), the game's buttons, checkboxes and dropdowns | the game's art | no bar |
| Blackout: Midnight | flat, background, skinned controls, rounded checkboxes | `rail`: a thin border rail, accent thumb | 2 px accent bar left of the selected page |
| Blackout: Nitro | flat, as Midnight | `framed`: surface track, border, accent thumb and ticks | 2 px accent bar |
| Beanworks: Cowfee | flat, as Midnight | `rounded`: surface track, knob thumb with its shine | no bar |

Set in `CRT.THEME_LIST`: `modern`, `menuBar` and `scrollBar` (the looks and their sizes are `UI.SCROLL_BAR_LOOKS` in `CRT_Core/UI/ScrollBar.lua`). A Modern theme also uses Arial Narrow at 110% when the font setting is Default, and turns the game's gold font the label colour and white font the text colour (`CRT:ApplyFonts`).

## Adding a theme

1. Pick the colours with Alex (the crt-theme skill has the mockup). Start from the closest theme's column.
2. Fill a new column above: every key. Light accents on a dark theme get an accent check and checkBorder; a warm brown knob can keep a white tick.
3. Check contrast: `node .claude/skills/crt-theme/scripts/contrast.mjs <palette.json>` (or with no file, every theme in Themes.lua). Every pair must meet its target, warn included, on background and on surface.
4. Make warn its own colour: not the heading, good, bad or accent colour, so it reads as a status.
5. Add the palette to `CRT.THEMES` (each key as `hex("RRGGBB")`) and its entry to `CRT.THEME_LIST` where Alex wants it in the menu, with `name` ("Family: Name"), `modern = true`, a `scrollBar` look and `menuBar` if it has one.
6. Add the theme to `run_themes.js`'s palette and order checks, and to the table here. Run `bash CRT_Dev/Tests/test.sh "themes"`.

A new kind of surface that no key fits gets a new key: in `CRT.THEME_KEYS` and its comment, in every theme (Default: Blizzard gets the colour the surface had before, so Classic doesn't change), here, and in the tests.
