# In-App Notifications

A small, deliberately generic system: one model, one self-scoped API, one
topbar bell. It exists because moderation decisions happen asynchronously —
a user proposes a crop species, closes the app, and a moderator decides hours
later. Without a notification, the outcome is only discoverable by chance.

## Why the stored text is English

`Notification.message` holds an **English** sentence, and the app UI never
renders it. This is not an oversight:

- CLAUDE.md requires API responses to stay English, while the UI must be
  German through i18n resources. A German sentence baked into the row would
  violate both halves — an English UI would show German, and the API would
  ship German.
- The language a notification should read in is the language of whoever is
  looking at it *now*, not the language in effect when it was created.

So the row carries `notification_type` plus a `context` dict, and the frontend
builds the sentence from `notifications:messages.<type>` with `context` as the
interpolation values (`frontend/src/notifications/notificationDisplay.ts`).
`message` remains for the Django admin, logs, and any non-UI API consumer, and
doubles as the fallback if an unknown type ever reaches an older client — a
raw enum value must never surface at the user.

Adding a notification kind is therefore a `TYPE_CHOICES` entry plus two
translation keys, no serializer change. Django still generates a migration for
the `choices` metadata change, but it alters no column and is instant to
apply.

## Model

`backend/notifications/models.py`

| Field | Purpose |
|---|---|
| `recipient` | The user the notification belongs to. Cascade-deleted with the account. |
| `notification_type` | Extensible `choices` field; the key the UI translates. |
| `message` | English fallback (admin/API only). |
| `context` | JSON interpolation values, e.g. `{"name": "Kürbis"}`. |
| `target_type` / `target_id` | Loose reference to the affected object. Deliberately not a `GenericForeignKey`: the target may be gone by the time it is read, and a dangling row should degrade to "no link", not to a broken query. |
| `is_read` | Per-notification, set only by an explicit click. |
| `created_at` | Ordering key (newest first). |

Routes are resolved on the frontend, not stored: the backend has no business
knowing what `/app/crop-library?cropId=…` means.

## API

`/api/notifications/` — list plus mark-read, both strictly scoped to
`request.user`. There is **no create endpoint**; notifications are produced
server-side through `notifications.services.create_notification`.

- `GET /api/notifications/` — paginated, newest first, with `unread_count`
  folded into the same payload. The bell needs both numbers on every app load,
  and one request beats two. `?is_read=false` narrows the rows (what the
  dropdowns request); `unread_count` deliberately stays account-wide, so the
  badge never disagrees with the list it sits on.
- `POST /api/notifications/<id>/read/` — marks exactly one as read. Someone
  else's id 404s (it is filtered out of the queryset, not merely rejected).

## Producers

All but one producer live in `crops.services`:

- `notify_species_proposal_reviewed(species)`, called from
  `CropSpeciesViewSet.approve()`/`reject()`. Tells the *proposer* the outcome.
  Does nothing for species nobody proposed (seeded/admin rows) or for a status
  that is not a review outcome, so the call sites stay unconditional. Links to
  the proposer's own published variety under that species when one exists —
  that variety is what the decision actually affects — and falls back to the
  species itself otherwise (`target_type` `public_crop` / `crop_species`).
- `notify_moderators_of_species_proposal(species)`, called from
  `CropSpeciesViewSet.create()`. Tells every *public-library moderator*
  (`crops.permissions.public_library_moderator_users()`) that a new proposal
  is waiting.
- `notify_admins_of_moderator_request(moderator_request)`, called from
  `PublicLibraryModeratorRequestViewSet.create()`. Tells every *public-library
  admin* (`crops.permissions.public_library_admin_users()`) — not every
  moderator, since only admins can review these requests.

Two further producers are the exception, and live next to the code that raises
the situation rather than in `crops.services`:

- `farm.services.public_crops._notify_relink_request_cancelled()`, reached
  whenever a parked "Kulturart korrigieren" correction
  (`PublicCropSpeciesRelinkRequest`, see
  [crop-library-architecture.md §9](./crop-library-architecture.md)) is
  cancelled instead of applied — the proposed target species was rejected, the
  entry is no longer published, or another entry claimed the same
  species+variety identity while the proposal was in review. Tells the
  *requesting moderator*, because the dialog told them the entry would be
  relinked automatically on approval and nothing else ever surfaces a resolved
  request. A correction the same moderator deliberately superseded with a newer
  one is not a broken promise and is not notified.

- `farm.services.public_crops.notify_project_of_crop_species_reassignment()`,
  called from the same correction when it moves the owner's private Kultur
  group onto the corrected species. Inheritance in this project is live and
  project-local — a Sorte resolves its unset fields through the general Kultur
  of its `(project, crop_species)` group — so the move can land the group on a
  *different* general Kultur the project already keeps for that species, and
  the Sorte's effective values change without anybody in the project touching
  anything. Tells *every member* of that project (not only its admins: the
  values are what everyone plans with), one notification per affected crop,
  `target_type` `crop`. Only rows whose effective values actually moved are
  reported, so a pure mapping correction stays silent, and a value the Sorte
  sets itself never appears — an existing local override is not news.
  `context.changed_fields` carries `{field, old_value, new_value}`, the same
  diff shape the public-update preview renders, so the frontend reuses
  `formatPublicCropFieldChanges()` and the crop library's field labels instead
  of a second formatter.

The two moderation-queue producers both use
`target_type = Notification.TARGET_PUBLIC_LIBRARY_MODERATION`,
which the frontend resolves to `/app/public-library-moderation` — the
moderation queue has no per-item detail route, so every notification of this
kind opens the same page.

`create_notification` skips missing and inactive recipients, so producers do
not each re-implement that check.

## Real-time invalidation

Signed-in clients can subscribe to:

```text
/<URL_PREFIX>/ws/notifications/
```

The consumer accepts only authenticated Django sessions and joins a group
derived from `request.user.id`, never from a client-supplied id. When a
`Notification` row is created, updated, or deleted, a post-commit signal emits:

```json
{
  "type": "notifications.updated",
  "notification_id": 123
}
```

The event is an invalidation only. The frontend reloads `/api/notifications/`
after receiving it, so list ordering, unread counts, localization inputs, and
target links remain controlled by the existing REST serializer and permission
boundary.

## Frontend

`frontend/src/notifications/`

- `NotificationBell.tsx` — the **full topbar** only: an icon with an unread
  `Badge` (no badge at zero, which is MUI's default for `badgeContent={0}`)
  and a `Menu` of the unread entries plus a link to the full history.
- `useNotificationMenuItems.tsx` — the same entries as items of the **compact
  topbar's** "Mehr" (⋮) menu, with the unread `Badge` moved onto that menu's
  own button. The compact topbar has no room for another icon: adding a
  standalone bell collapsed the page title to a single letter at 375px on
  action-heavy pages (Anbauflächen), which is what made the responsive
  screenshot baseline fail. Collapsing a secondary action into that menu is
  the pattern the topbar already uses elsewhere.
  It is a hook returning an array, not a component, because MUI's `Menu` reads
  its direct children for keyboard navigation. `RootLayout` calls it and hands
  the result to `GlobalMenu` as `notificationItems`, so `GlobalMenu` itself
  needs neither router nor data-fetching context — it renders what it is
  given.
- `RootLayout` owns one `useNotifications` controller and feeds both entry
  points, so the list is fetched once regardless of breakpoint.
- `useNotifications.ts` — loads on mount, again on every dropdown open, and
  after `notifications.updated` WebSocket invalidations. While the socket is
  unavailable it falls back to the shared low-frequency polling behaviour. It
  asks the backend for **unread** rows only (see below). Mark-read is applied
  optimistically so the badge reacts immediately.
- `NotificationItemContent.tsx` — the message + relative time of one row,
  shared by all three surfaces so unread emphasis and timestamp formatting
  cannot drift apart. `showUnreadDot` is off in the dropdowns (every row there
  is unread, so a dot per row says nothing) and on in the history list, which
  mixes both states.
- `pages/NotificationHistoryPage.tsx` + `useNotificationHistory.ts` — the full
  archive at `/app/notifications`, read and unread alike, paged 20 at a time
  through the same list endpoint. The page is account-scoped, so it is listed
  in `PROJECT_INDEPENDENT_APP_ROUTES` (`navigation/mainNavigation.ts`).
- `notificationDisplay.ts` — type + context → localized text,
  target → in-app route, and `NOTIFICATION_HISTORY_ROUTE` as the one place the
  history path is written down.

**The dropdowns show unread entries only**, filtered by the backend rather
than out of a page of the full history: the badge counts the whole account, so
a client-side filter would show an empty dropdown next to a non-zero badge as
soon as no unread row sits on the newest page. They are the "what is new"
surface; everything already seen lives on the history page, which both of them
link to unconditionally (also when nothing is unread, where the list is
replaced by a plain "keine neuen Benachrichtigungen" hint rather than an alarm
or an empty section). That is what keeps the dropdown short enough to stay a
glance instead of a page.

**Marking read has one owner.** The history page holds its own paginated list
but does *not* call the mark-read endpoint itself: it reuses
`useNotificationSelection` with the topbar's controller, handed down through
`RootLayoutOutletContext.notifications`, so clicking a row there moves the
bell's badge too. `markRead` therefore takes the notification rather than its
id — the row may be on a page the controller never loaded, and only the row
itself knows whether it was still unread. Since that copy can be *stale* (the
history page fetched it before the same row was read in the dropdown), the
controller also remembers the ids it already handled: replaying one is a
no-op, never a second badge decrement or a second POST. The outlet context is
optional like everywhere else in the app; without it the page marks rows read
directly, and only the badge — which then does not exist — is missed.

Two further behaviours are load-bearing and easy to "fix" wrongly:

- **Opening the dropdown marks nothing as read.** Only clicking one entry
  does — on the history page exactly as in the dropdowns. A bulk "seen" on
  open would silently bury a decision the user glanced past.
- **`GlobalMenu` renders its `Menu` as `variant="menu"`.** MUI's default
  (`selectedMenu`) hands the initial focus to the *selected* item — the active
  language, far down the list — and focusing it scrolls the menu there, so the
  dropdown opened showing its bottom instead of its first section.
- **Relative timestamps use `Intl.RelativeTimeFormat` with
  `numeric: 'always'`** (`frontend/src/utils/relativeTime.ts`), not translated
  strings. Wording, plural rules and word order differ per language and the
  platform already knows them. `'always'` rather than `'auto'` keeps the count
  visible ("vor 2 Tagen" instead of "vorgestern"), which is what a list mixing
  several ages needs; sub-minute ages fall back to `'auto'` so they read
  "jetzt" instead of "vor 0 Sekunden".
