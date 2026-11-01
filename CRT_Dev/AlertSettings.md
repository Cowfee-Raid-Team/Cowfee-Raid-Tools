# Alert settings

Every setting an alert can have, made from `CRT.AlertFields.LIST` (`CRT_Modules/Alerts/Fields.lua`). Don't edit the table by hand: print it with `node CRT_Dev/Tests/run_alert_settings.js <addon folder> table` and paste it over the one below. The `alert settings` test group fails while the two differ. The how-to (how the engine uses each, the order of speech, adding a setting) is the `crt-alert-settings` skill.

- **Lives in:** Reminder (your own alert), Template (`Alerts/Saved.lua`), Note line (a raid note's timed line, `Notes/Parse.lua`), Share code (`Alerts/Share.lua`).
- **Note line:** the field a timed line carries it in; none means a line can't. Every field is CRT's own: the integration sends leave them out.
- An older CRT skips a note line field it doesn't know and keeps it when it writes the line back. `countfrom:`, `ttsbefore:` and `say:` (#1243) are checked against Parse.lua at every tag from v1.0.0 on (`run_alerts_notewrite.js`).

| Key | Tab | Meaning | Range | Default | Lives in | Note line |
|---|---|---|---|---|---|---|
| `warn` | When | Seconds before the time the alert starts to show. | 1 to 60, step 1 | 5 | Reminder, Template, Note line, Share code | `warn:N` |
| `linger` | When | Seconds the alert stays after 0. | 0 to 10, step 1 | 0 | Reminder, Template, Note line, Share code | `linger:N` |
| `show` | Looks | Where it shows: the note callout, Critical alerts text, Icon, Bar, Circle, Alert timeline. |  | alert, bar | Reminder, Template, Note line, Share code | `show:alert,text,icon,bar,circle,timeline` |
| `text` | Looks | What it shows (and says, without Say instead). |  | the spell's name | Reminder, Template, Note line, Share code | `text:words` |
| `iconID` | Looks | The spell, or an icon's file ID in its place. |  | the spell's icon | Reminder, Template, Note line, Share code | `spellid:N, icon:N` |
| `color` | Looks | Its colour; your own alert's needs Use custom colours. |  | the area's colour | Reminder, Template, Note line, Share code | `colors:r g b a` |
| `ticksText` | Looks | Seconds into the bar when each hit lands (Mech Alerts only). |  | none | Reminder, Note line, Share code | `ticks:2,4` |
| `fill` | Looks | The bar fills up instead of emptying (Mech Alerts only). |  | empties | Reminder, Note line, Share code | `fill:up` |
| `countTo` | Looks | The bar's number counts to each hit (Mech Alerts only). |  | the cast | Reminder, Note line, Share code | `countto:impact` |
| `sound` | Sound and speech | A sound played at 0. |  | none | Reminder, Template, Note line, Share code | `sound:name` |
| `auraSound` | Sound and speech | The sound also plays when the spell's debuff lands on you. |  | false | Reminder, Share code | none |
| `speak` | Sound and speech | Reads the text out. |  | true | Reminder, Template, Note line, Share code | `tts:1` |
| `speakText` | Sound and speech | Words said in place of the text. |  | empty | Reminder, Template, Note line, Share code | `say:words` |
| `count` | Sound and speech | Counts down to 0. |  | false | Reminder, Template, Note line, Share code | `count:1` |
| `countFrom` | Sound and speech | The number the count starts from. | 3 to 10, step 1 | 3 | Reminder, Template, Note line, Share code | `countfrom:N` |
| `speakAt` | Sound and speech | When the text is said: On show, At 0 or Before 0. |  | On show | Reminder, Template, Note line, Share code | `ttsat:0 (At 0), ttsbefore:N (Before 0)` |
| `speakBefore` | Sound and speech | Before 0's seconds before the time. | 0.5 to 10, step 0.5 | 3 | Reminder, Template, Note line, Share code | `ttsbefore:N` |
| `glow` | Sound and speech | The alert glows at 0. |  | false | Reminder, Template, Note line, Share code | `glow:1` |
| `shield` | Shield bar | The bar shows a boss's absorb shield (Alerts/Absorb.lua). |  | off | Reminder, Template, Note line, Share code | `shield:boss2,15,any` |
