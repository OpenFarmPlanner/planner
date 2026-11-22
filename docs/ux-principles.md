# Product UX principles

This document records **product behavior decisions**, not visual tokens or component APIs. For appearance and layout, see [Design System](design-system.md); for implementation and i18n rules, see [CLAUDE.md](../CLAUDE.md) and [i18n](i18n.md).

These principles apply when drafting/reviewing issues and implementing user-facing features. **An explicit, confirmed owner decision or issue acceptance criterion takes precedence.** If a principle appears to conflict with a confirmed requirement, do not silently change the product; document the conflict and request a specific decision. Heuristics are not unconditional rules.

## Product principles

1. **Minimize unnecessary decisions and clicks.** Prefer a safe, useful default over a setting or modal that merely asks the user to restate an existing preference. Do not invent configuration switches “just in case.” When an action is reversible and unambiguous, avoid an extra confirmation step; use the app's existing undo/feedback pattern where appropriate. Do confirm destructive, irreversible or high-impact changes.

2. **Use the active UI language for UI-owned workflows.** Labels, help, generated filenames and language-dependent UI output should follow the current UI language. **Do not introduce a language picker into ordinary culture publishing, import or export flows by default.** This does *not* mean erasing translated content, choosing the language of arbitrary third-party source files, or suppressing a needed per-translation editor. When source language is genuinely ambiguous and affects data correctness, use existing data semantics or document a specific need for an explicit choice. Preserve confirmed format contracts; JSON exports can contain multilingual data independently of the UI language.

3. **Progressive disclosure, not hidden essentials.** Show only relevant read-only information, but make all editable fields discoverable when editing. Avoid global “Show all fields” / “Alle Angaben anzeigen” switches unless an established, validated workflow genuinely needs one. Put rarely used actions into contextual menus or secondary sections; keep the primary action obvious. Do not hide errors, destructive consequences or requirements behind tooltips. Short supporting explanations belong in contextual information controls (the established info icon), not large paragraphs.

4. **Reuse existing concepts and controls.** Before adding a new dialog, toolbar, view or selector, inspect the closest comparable workflow and shared components. Align labels, ordering, defaults, validation and results across project cultures, public library, growing areas and planting plans. Do not introduce a second way of configuring the same preference without an explicit reason.

5. **Respect spreadsheet-like interactions.** In editable grids, single click selects/focuses a cell; double click edits where applicable; keyboard navigation must keep working. Open details from the established row menu or clear explicit navigation elements, not by converting ordinary cells into surprising links. Keep advanced fields in optional columns or detail views instead of expanding every row by default.

6. **Make outcomes clear and recoverable.** After an action, indicate success/failure where the user is looking. Prefer actionable errors, sensible preserved selections, undo when safe, and transparent previews for bulk actions. Do not silently overwrite user data, change sync links, map uncertain imports or merge incomparable quantities. Show consequences where a decision matters.

7. **Design for both phone and desktop, plus keyboard and touch.** Preserve intentional differences. Never rely exclusively on hover; provide tap/focus access to useful explanations. Check overflow, long translations, menus and reachable controls at the repository's required breakpoints. Favor responsive patterns already implemented.

8. **Keep all seven languages consistent.** All new or revised UI strings must cover de, en, fr, es, it, pt-PT and nl, matching the current i18n resources and glossary. An issue that mentions only an older subset of locales does not override the project-wide rule. Ensure copy is short and domain-specific, not developer jargon.

9. **Keep complexity proportional to user benefit.** Every new field, preference, menu, toggle and confirmation needs a concrete user scenario. Prefer defaults and optional advanced capability over comprehensive upfront configuration. Accessibility, data integrity and informed consent take precedence over shaving off clicks.

## Preserve space for primary content

Give controls space and prominence in proportion to their importance and frequency of use. Before adding a persistent row, panel, toolbar, card, large button or explanation, look for room in an existing structure. Vertical space above tables, lists and calendars is especially valuable because extra controls can push records below the fold.

For occasional settings such as a table's date display mode, consider a useful default and a compact selector alongside Search, Filter or Columns. Use an established contextual menu when users can still find the action easily. Keep primary actions visible and allow controls to wrap or use an extra row when the viewport, readable translations or accessible touch and keyboard targets need the space.

## Tooltip roles

- **Explanatory help.** Use a brief, optional explanation for genuinely non-obvious behavior, such as how a sowing date is derived. Put longer explanations in the existing page help opened from the question mark beside the page title. Where appropriate, delay the explanatory tooltip by about 600 ms on pointer entry to avoid triggering it as the pointer passes over the control. Keep the explanation usable on keyboard focus and touch.
- **Action identification.** Give icon-only controls a concise hover and focus label when their action needs clarification, and give each control an accessible name. A text button's visible label generally provides the action name on its own. Keep shortcut reminders in the existing keyboard-shortcuts help.
- **Data previews.** Keep previews that reveal record details, such as planting dates and plan information in the Crop Calendar. Preserve their responsive hover behavior and make the same details available with keyboard focus and touch.

Put essential warnings, requirements, errors and reasons an action is unavailable in the visible UI or behind an explicit control that supports keyboard and touch. Use the active UI language for tooltip text and accessible names. Keep explanatory tooltip availability independent of account age and feature use. Use one shared behavior across accounts and revisit a personal opt-out only if targeted cleanup leaves demonstrable overload.

## UX issue preflight

When creating or revising a user-facing issue, review the **whole flow** rather than only the requested component:

- Identify the user's goal and the shortest safe happy path. Count added choices, dialogs, confirmations and steps; justify each.
- Compare with the current application and adjacent issues/epics. Check prerequisites, shared patterns, ownership and explicit owner decisions. Inspect current code or screenshots when the existing behavior matters; do not assume a described UI exists.
- Check defaults, use of UI language, import/export round trips, consistency of labels/actions, empty and error states, undo and data preservation.
- Check mobile/touch/keyboard behavior, multilingual text lengths and accessibility. Consider new-user discoverability **and** efficient repeat use.
- Specify the minimum necessary acceptance criteria and relevant tests. Avoid deciding domain ambiguities through a generic UX rule.

**Review outcomes:** `Pass` (already coherent), `Refine` (precise, low-risk issue edit with rationale), or `Needs owner decision` (specific alternatives and trade-offs). Don't add a vague `needs-decision` for normal implementation judgment.

## Backlog audit and queue safety

For a batch audit, read open issues **and their parent epics**, compare with each other and the shipped UI, then check duplicates, contradictions, unjustified controls, missing defaults and cross-screen drift. Prioritize items that will be implemented soon. Record an issue-numbered finding, evidence, proposed change and scope impact for each finding. Update not-yet-started issues only when the intended behavior is already established; otherwise propose alternatives for the owner.

Do **not** change the ordered Work Queue (#1058), check off the owner's manual acceptance, broaden a live implementation PR, merge, deploy or bypass review gates as part of a UX audit. If an issue is already being implemented, coordinate the finding instead of rewriting its contract mid-flight. Keep editorial changes to backlog issues separate from code implementation.

## External heuristics

- Nielsen Norman Group: [Ten usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) (feedback, consistency, prevention, recognition, minimalism, user control).
- Nielsen Norman Group: [Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) (advanced functions when needed, without losing discoverability).
