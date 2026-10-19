# Keyboard Shortcut Audit (Frontend)

Date: 2026-05-05
Scope: `frontend/src`

> **This is a dated audit, not a live shortcut inventory.** Its
> recommendation in §4/§5 *was* implemented — main-page navigation is
> `Ctrl+Shift+ArrowUp`/`ArrowDown` today — and several other bindings have
> changed since (the sidebar toggle is `Ctrl+B`, not `Alt+B`; the command
> palette answers to `Ctrl+K` *and* `Alt+K`; `?` opens the shortcuts help;
> version history is `Alt+V`). The table below is kept because the
> consistency and conflict analysis in §2–§4 is still the reasoning behind the
> current scheme.
>
> For what is actually bound right now, there are two sources and both are
> generated, not hand-maintained: `frontend/src/commands/commands.ts` for
> global commands, and the in-app `?` dialog, which builds itself from the
> live command and region registries. See
> [keyboard-architecture.md](./keyboard-architecture.md) for the model behind
> them. Deliberately not duplicated into a table here — that is exactly what
> went stale.

## 1) Existing shortcuts (implemented, as of 2026-05-05)

| Shortcut | Action | Location in code |
|---|---|---|
| `Alt+K` | Open command palette | `commands/commands.ts` (`openPalette`), `commands/CommandProvider.tsx`, shown in dialogs in `App.tsx` and `pages/Crops.tsx` |
| `Alt+H` | Open shortcuts/help commands dialog | `commands/commands.ts` (`openShortcuts`), `commands/CommandProvider.tsx`, shown in `App.tsx` |
| `Ctrl+Shift+ArrowRight` | Navigate to next main page | `commands/commands.ts` (`navigation.nextPage`) → `App.tsx` (`navigateRelativePage`) |
| `Ctrl+Shift+ArrowLeft` | Navigate to previous main page | `commands/commands.ts` (`navigation.previousPage`) → `App.tsx` (`navigateRelativePage`) |
| `Alt+Shift+P` | Open project settings | `commands/commands.ts` |
| `Alt+Shift+M` | Open project members | `commands/commands.ts` |
| `Alt+1..9` | Switch project by index | `commands/commands.ts` |
| `Alt+Shift+A` | Open account settings | `commands/commands.ts` |
| `Alt+Shift+V` | Open version history | `commands/commands.ts` |
| `Alt+Shift+L` | Logout | `commands/commands.ts` |
| `?` | Open global help dialog | `App.tsx` (`handleHelpShortcut`) |
| `Alt+B` | Toggle desktop sidebar collapse | `App.tsx` (`handleSidebarShortcut`) |
| `Alt+G` | Toggle Areas view (table/graphical) | `pages/FieldsBedsPage.tsx` (command + keydown listener) |
| `Alt+E` | Calendar edit mode toggle | `pages/GanttChart.tsx` command registration |
| `Alt+Shift+N` | New row/item in hierarchy/plans | `pages/FieldsBedsHierarchy.tsx`, `pages/PlantingPlans.tsx` |
| `Alt+E` | Edit selected item | `pages/FieldsBedsHierarchy.tsx`, `pages/PlantingPlans.tsx`, UI labels in `pages/Crops.tsx` |
| `Alt+Shift+D` | Delete selected item | `pages/FieldsBedsHierarchy.tsx`, `pages/PlantingPlans.tsx`, UI labels in `pages/Crops.tsx` |
| `Ctrl+D` / `⌘D` | Duplicate the active bed row (only while the Anbauflächen table is active and no cell is edited; the browser's bookmark shortcut stays untouched otherwise) | `components/hierarchy/hooks/useHierarchyKeyboard.ts` → `pages/FieldsBedsHierarchy.tsx` |
| `Alt+P` | Create planting plan from crop context | UI in `pages/Crops.tsx` |
| `Alt+J` / `Alt+Shift+J` / `Alt+I` | Export current/all crops; import JSON | `pages/Crops.tsx` |
| `Alt+U` / `Alt+R` / `Alt+A` | AI complete / re-research / complete all crops | `pages/Crops.tsx` |
| `Ctrl+Enter` / `Cmd+Enter` | Save notes drawer | `components/data-grid/NotesDrawer.tsx` |
| `Ctrl+S` / `Cmd+S` | Save grid row while editing | `components/data-grid/DataGrid.tsx` |
| `Esc` | Close dialogs / cancel edit in many places | `CommandPalette.tsx`, `App.tsx`, `pages/Crops.tsx`, several dialogs/components |

---

## 2) Consistency review

### What is already consistent
- Most app-level commands use **Alt-based shortcuts** (`Alt+...`, `Alt+Shift+...`).
- Global command system (`commands/commands.ts`) is centralized and generally coherent.
- Many handlers correctly avoid firing while typing (`isTypingInEditableElement` or similar checks).

### Inconsistencies found
1. **Main-page navigation uses `Ctrl+Shift+ArrowLeft/Right`**, while most other app shortcuts are Alt-based.
2. Some shortcuts are only shown in UI labels but not always uniformly wired through command specs (especially in `Crops`).
3. Mixed semantic direction: app navigation is now vertical sidebar, but current next/previous uses horizontal arrows.

---

## 3) Conflict review

### Higher-risk conflicts
- `Ctrl+Shift+ArrowLeft/Right`
  - Commonly used in text editors/inputs for word selection and caret movement semantics.
  - Even with typing guards, this is cognitively associated with text operations, not app navigation.

### Medium-risk conflicts
- `Alt+<letter>` combinations can clash on some keyboard layouts (especially international layouts and browser/OS accelerators), but current project already standardizes heavily on Alt.

### Lower-risk / expected
- `Ctrl+S` and `Ctrl+Enter` are context-local and expected in editing UIs.

---

## 4) Evaluation of navigation shortcut (`Ctrl+Shift+←/→` vs `↑/↓`)

### Finding
Given a **vertical sidebar**, `Previous/Next` mapped to **Up/Down** is more semantically aligned than Left/Right.

### Recommendation
Replace:
- `Ctrl+Shift+ArrowLeft` → previous page
- `Ctrl+Shift+ArrowRight` → next page

With:
- `Ctrl+Shift+ArrowUp` → previous page
- `Ctrl+Shift+ArrowDown` → next page

### Why
- Matches vertical navigation mental model.
- Reduces confusion with horizontal movement semantics.
- Better consistency with sidebar orientation.

### Additional optional improvement
Consider unifying to Alt-based pattern in a follow-up (e.g. `Alt+Shift+ArrowUp/Down`) **only after validation across OS/browser**.

---

## 5) Recommended replacement set (minimal-risk)

1. Keep current global command architecture.
2. Change only main nav keys:
   - `Ctrl+Shift+ArrowUp` / `Ctrl+Shift+ArrowDown`
3. Keep existing `Alt+K`, `Alt+H`, `Alt+B`, and page-specific Alt shortcuts unchanged for now.
4. Ensure every global/page handler continues to ignore editable targets (`input`, `textarea`, `select`, `contenteditable`).

---

## 6) Final recommended shortcut scheme

### Global (stable)
- `Alt+K`: Command palette
- `Alt+H`: Shortcut/help dialog
- `?`: Global help dialog
- `Alt+B`: Sidebar collapse toggle (desktop)

### Main navigation
- **Recommended**: `Ctrl+Shift+ArrowUp` / `Ctrl+Shift+ArrowDown`

### Page actions
- Keep current Alt family (`Alt+E`, `Alt+Shift+N`, `Alt+Shift+D`, `Alt+G`, etc.)
- Document them in one centralized help source (command palette + shortcuts dialog)

---

## 7) Suggested next step (no code changes in this task)

- Implement only the navigation key remap in `commands/commands.ts` and any UI hint strings.
- Keep handlers and guards unchanged otherwise.
- Then run tests for `useKeyboardNavigation` and command-related suites.
