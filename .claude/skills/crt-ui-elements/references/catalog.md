# CRT UI element catalog

The rules (Kinds) and the places that don't follow them yet (Review queue). Line numbers are from `main` on 2026-10-19, so check the file before you trust them.

## The looks

Every element is checked in each look. Alex, 2026-10-19: "I think we can remove the minimalistic black". So there are two looks, Classic and Modern, switched by a "UI: Classic / UI: Modern" header button in the main window's title bar (job 20261019-ui-two-looks; until it merges, the looks are set on General Settings (UI/Panel.lua:244-252, `UI:IsModern`, `UI:ApplyStyle`)):

- **Classic:** `CRTDB.ui.modern` off and the style "game". The window template's own art. The main `/crt` window's title bar is the reference: a thin dark bar, the title small, gold and centred, the version on the left, red game buttons (Previews) and the red game X.
- **Minimal (being removed):** `modern` off and `style = "minimal"`. Its column below goes when job 20261019-ui-two-looks merges; don't design for it.
- **Modern:** `modern` on. Coffee colours (`CRT.MOCHA`): an espresso background, caramel lines, flat controls.

Alex, 2026-10-19: "we need to validate both the classic UI, minimalist UI, and the modern UI elements to keep the same style theme across even as we add new features." A pop-out window must look like the main `/crt` window in the same look. A blank cell below means the look still has to be checked.

## Kinds

| Kind | Helper | Classic | Minimal | Modern | Use for | Ruling |
|---|---|---|---|---|---|---|
| Window title strip | `UI.Window` → `UI.TitleStrip` (UI/Window.lua:139, :189) | Must match the main window's title bar (see above). **Today it doesn't** (queue) | Must match the main window's minimal strip | Espresso strip, caramel line under it | Every pop-out window's header | Alex, 2026-10-19: Loot Master's Classic headers "don't match the original panel headers" |
| Header button | `UI.HeaderButton(parent, label, onClick)` (UI/Panel.lua, being added by job 20261019-lm-popup-buttons); `UI.ResetButton` has the same look with "Reset" | The game's red button, like the main window's Previews; an icon on the button stays | Reset look | 16 high, width from the label (min 44), black 0.6 fill, grey 1 px edge, CRTFontButtonSmall, white 0.15 highlight | Buttons in a title strip or header bar: Reset, All Loot Rolls, End session | Alex, 2026-10-19: "use the Reset button as the template for this lootmaster header button format"; for Classic, "use the red game classic, however it should still contain the lootmaster icons or anything that we've deemed icons on buttons" |
| Panel button | `UI.PanelButton(parent, label, height, onClick)` (UI/Panel.lua:584), or a UIPanelButtonTemplate on a `/crt` page (skinned by `UI:SkinTree`) | The game's red button, label inside the end caps | | Flat, through `UI:SkinButton` | Actions in a page or a window body: Show, Add, Defaults, Test, Export | Alex, 2026-10-19: hand-made windows' buttons follow the Modern template; Classic keeps the game look |
| Answer button | Loot Master's own (LootMaster/Popup.lua:116, BackdropTemplate) | Coloured by the response | The same | The same | Only the raider popup's response buttons | Built this way on purpose (2026-10-18); not a general button |
| Close button | `UIPanelCloseButton` + `UI:SkinCloseButton` (UI/Panel.lua:517), or the one `UI.Window` makes | The game's red X, like the main window | | Flat X | Every window and item panel | Existing |
| Help | `UI.Help(parent, title, text)` (UI/Panel.lua:768) | Blue "(?)" with a tooltip | The same | The same | Every explanation. No grey paragraphs on a page | Alex (memory crt-ui-help-icons) |
| Dropdown | `UI.Dropdown` (UI/Controls.lua:53), skinned by `UI:SkinDropdown` | The game's dropdown | | Flat | Any choice from a list, never a button that cycles through values | Alex (memory crt-ui-controls) |
| Slider | `UI.Slider` (UI/Controls.lua:208) | Edit Mode style | The same | The same | Numbers in a range | Alex (memory crt-ui-controls) |
| Edit box | A page's `editBox` + `UI:SkinEditBox` (UI/Panel.lua:490); `UI.PopupEditBox` in popups | InputBoxTemplate art | | Flat, the same height as a dropdown beside it, grey placeholder | Typed text | Factory review, 2026-10-19 (the Loot authority Add row) |
| Checkbox | Each page's local `check` (no shared helper yet) | The game's checkbox | The same | The same | On/off settings | Existing; a shared helper is a candidate |
| Tab | `UI:RegisterTab`, `UI:StyleTab`, `UI:SetTabSelected` (UI/Panel.lua:726-757) | The game's tabs | | Mocha tabs | Only on pages with interactive parts; Settings last; none on a settings-only page | Alex (memory crt-ui-tabs) |
| Badge | `strip:SetBadge(text, note, colors)` on `UI.TitleStrip` (UI/Window.lua) | Orange TEST; neutral (gold on dark) for information such as the boss name | The same | The same | One short state next to a window's title | Alex, 2026-10-19: the boss name sits where TEST is |
| Window | `UI.Window(name, { kind = dialog / popout / overlay })` (UI/Window.lua:189), styled by `UI:StyleWindow` | Template art like the main window | Flat black, grey border | Espresso | Every movable window | Alex (memory crt-shared-window-helper) |
| Colour swatch | `UI.PickColor` (UI/Controls.lua:398) | | | | Picking a colour | Existing |
| Sortable column headers | `UI.SortHeaders` (UI/Controls.lua:439) | | | | Table headers that sort | Existing |

## Review queue

| Where | Look | What's wrong | Status | From |
|---|---|---|---|---|
| UI/Window.lua `UI.TitleStrip` (every `UI.Window`: Loot Master looter window, popup, raider window, Logged Timeline Ref, rehearsal, dev windows) | Classic, Minimal | A brown band with a large white title, whatever the look. In Classic it must match the main window's thin gold-title bar with the red game X; in Minimal, the main window's flat strip | open: job queued | Alex screenshot, 2026-10-19 |
| LootMaster/Popup.lua:386 "All Loot Rolls" | all | A thin panel button; must be a header button | job 20261019-lm-popup-buttons | Alex screenshot, 2026-10-19 |
| LootMaster/Window.lua "End session" | all | A panel button in the header; must be a header button | job 20261019-lm-popup-buttons | Alex screenshot, 2026-10-19 |
| LootMaster/Popup.lua:398 "Show" | all | 18 high, under the answer buttons' 22 | job 20261019-lm-popup-buttons | Alex screenshot, 2026-10-19 |
| Hand-made UIPanelButtonTemplate in windows with no skin call: Consumables/Tools.lua:75, Dev/LayoutEditor.lua:390, Notes/Phases.lua:154, Notes/Reminders.lua:837 | Modern | Red game buttons in the Modern look | open | scan, 2026-10-19 |
| Hand-made in windows with some skin calls: Alerts/Editor.lua:856, Dev/BossOrder.lua:241, Dev/MarkerEditor.lua:119, Dev/ReferenceTypes.lua:250, Dev/SeasonTools.lua:113 | Modern | Check every button there goes through SkinButton | open | scan, 2026-10-19 |
| Hand-made InputBoxTemplate edit boxes in windows: Alerts/Editor.lua:895, Dev/BossOrder.lua:263, Dev/MarkerEditor.lua:158, Notes/Phases.lua:223, Notes/Reminders.lua:884, LootMaster/Popup.lua:256 (the Notes box) | Modern | Not flat like `UI:SkinEditBox` | open | scan, 2026-10-19 |
| Every page's local `check` | all | One checkbox helper per page | open, candidate for a shared `UI.Check` | catalog, 2026-10-19 |
