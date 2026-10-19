---
name: crt-ui-elements
description: The Cowfee Raid Tools UI element catalog. It lists each kind of control (window title strips, header buttons, panel buttons, close buttons, (?) help, dropdowns, sliders, edit boxes, checkboxes, tabs, badges, windows), the one shared helper that builds it, its look in the Classic, Minimal and Modern looks, and a review queue of places that don't match yet. Use it whenever Alex sends a screenshot saying a CRT button, box, header or window "doesn't match", "isn't consistent", "isn't following the modern UI" or "should look like X". Also use it when a factory job adds or reshapes any CRT UI: the spec and the reviewer check new controls against it. And use it when Alex asks to review, audit or list the addon's UI elements, even if Alex doesn't say "catalog".
---

# CRT UI elements

CRT should look like one addon. Each kind of control has one shared helper and one look, so a fix happens in one place and every window follows it. This skill holds the list (`references/catalog.md`) and the routine for keeping it true.

The addon is `C:\Program Files (x86)\World of Warcraft\_retail_\Interface\AddOns\CowfeeRaidTools`. The helpers live in `UI/Panel.lua`, `UI/Controls.lua` and `UI/Window.lua`. Code changes go through the factory (`.claude/skills/factory/SKILL.md`), never straight onto `main`.

## The catalog

`references/catalog.md` has two parts:

- **Kinds:** one row per kind of control. Each row gives the helper to use, the look in Modern and Classic, where it's meant to be used, and Alex's ruling with its date. A row is the rule: new code uses that helper, and anything else is a finding.
- **Review queue:** places in the code that don't match their row yet. Each one gives the file and line, what's wrong, its status (`open`, `job <id>`, `fixed <commit>`, or `accepted` with Alex's reason), and where it came from (a screenshot, a review or a scan).

Read the catalog before answering any UI consistency question, so the answer comes from Alex's rulings, not from guesses.

## When Alex flags an element

Alex usually sends a screenshot and a line such as "these 2 aren't following our modern UI" or "use the Reset button as the template".

1. Name the element and find its code: grep the on-screen label, then find the CreateFrame or helper call.
2. Look up its kind in the catalog.
   - **The kind exists and the code doesn't use its helper:** add it to the review queue as `open`.
   - **Alex is changing the rule** (for example "header buttons look like Reset"): update the kind's row with Alex's words and today's date. Then add every place the new rule affects to the queue, not just the one in the screenshot. Run `scripts/scan.sh` to find them.
   - **A new kind:** add a row. The look comes from Alex. If Alex hasn't said, ask once, and show the closest existing kind as the default.
3. Fix it as a factory job: small if it's one place, a feature if a helper changes or many places do. The job file links the catalog rows. When the job merges, set each queue item to `fixed <commit>`.
4. Tell Alex which rows changed and what's still open, in a short list.

## When a job adds or reshapes UI

- **The spec:** names the catalog kind and helper for every new control. A control with no kind gets a row approved with the mockup before building.
- **The builder:** uses the helper and doesn't hand-make a button, box or window that has one.
- **All three looks:** every new or changed control is checked in Classic, Minimal and Modern (see the catalog's "The three looks"). A pop-out must look like the main `/crt` window in the same look.
- **The reviewer:** flags a hand-made control whose kind has a helper as a Must fix, and a control with no catalog row as Needs-Alex.

## Keeping it true

- After a job that adds a helper or changes a look, update the row in the same session. The helper name, file and line must match the code: open the file to check them, never from memory.
- `scripts/scan.sh` lists the button, close button and edit box templates used outside the helpers, and the helper calls, by file. Run it when you audit, and compare it with the review queue: a new hand-made control is a new queue item.
- Page controls inside the main `/crt` window are skinned by `UI:SkinTree` when the page is built. Pop-out windows and overlays aren't, which is where most mismatches come from. Check those first.
- Related rules live in memory: (?) help icons for explanations, tabs only on pages with interactive parts and Settings last, dropdowns not cycling buttons, and one window helper (`UI.Window`). The catalog repeats them as rows, so they're in one place.
