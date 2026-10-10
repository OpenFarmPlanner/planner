# Real-time updates

## Architecture

The Django ASGI application serves normal HTTP through Django and WebSockets
through Channels. Session cookies are resolved by `AuthMiddlewareStack`, and
`AllowedHostsOriginValidator` rejects unexpected browser origins. A consumer
authorizes its resource before joining a resource-specific channel group.

The first producers are Public Crop Library discussions and in-app
notifications. Django model signals publish only after the database
transaction commits. Each WebSocket message is an invalidation, not a
serialized model: the React client refetches authoritative data from the
existing REST API. This keeps permissions and serialization centralized in REST
and gives later domains the same pattern: an authorized consumer, a narrowly
scoped group, and a typed invalidation.

## Endpoint and event

The endpoint is:

```text
/<URL_PREFIX>/ws/public-crops/<public_crop_id>/discussions/
```

User notifications use:

```text
/<URL_PREFIX>/ws/notifications/
```

`URL_PREFIX` is omitted when empty. The browser derives `ws://` or `wss://`
from the page protocol and uses Vite's base path, so subpath deployments such
as `/openfarmplanner/` work without a separate endpoint setting.

Discussion changes produce:

```json
{
  "type": "discussion.updated",
  "public_crop_id": 123,
  "discussion_id": 456
}
```

Notification changes produce:

```json
{
  "type": "notifications.updated",
  "notification_id": 789
}
```

A bulk "mark all as read" sends the same event once, with
`"notification_id": null`, because it touched several rows at once.

Clients may send `{"type":"ping"}` and receive `{"type":"pong"}`. The
frontend sends this heartbeat every 30 seconds while connected.

## Authorization and isolation

WebSocket access requires an authenticated Django session. The discussion
consumer also verifies that the requested Public Crop Library entry is
published and visible under the same species visibility rule as REST before
accepting. It joins only that entry's group, so updates for another entry
cannot be delivered through the connection.

The notification consumer accepts no path user id. It derives the group from
the authenticated session user, so a browser can subscribe only to its own
notification invalidations.

Future project-scoped consumers must additionally resolve the requested
project/resource and verify `ProjectMembership` before joining; a
client-supplied project ID alone is never authorization.

## Frontend resilience and REST fallback

The reusable `useWebSocket` hook maintains at most one socket per mounted
subscription. It reconnects after close with exponential backoff from 1 to 30
seconds, ignores malformed messages, sends a conservative heartbeat, and
cleans up sockets and timers on path changes/unmount. While disconnected it
polls the owner-provided REST fallback every 60 seconds; healthy sockets
disable that poll. Consequently a missing WebSocket service never blocks
normal REST use.

## Local development

No Redis installation is needed. With `CHANNEL_REDIS_URL` unset, Channels uses
its in-memory layer. This supports a single application process and automated
tests only.

`daphne` sits at the top of `INSTALLED_APPS`, so `manage.py runserver` (used by
`scripts/dev-lan.sh`) runs Daphne and serves the `/ws/` endpoints directly - no
separate ASGI process is needed for manual socket testing.

The frontend opens the socket on the page's own origin. The Vite dev server
proxies `/ws` (with WebSocket upgrades, alongside `/api`) to the backend, so the
connection stays same-origin and the session cookie is always sent - including
over the LAN and regardless of whether the page was opened as `localhost` or
`127.0.0.1`. Set `VITE_WS_BASE_URL` only for the production preview build, which
has no proxy and must reach the ASGI backend directly.

## Redis-backed channel layer

Multi-process environments must set:

```text
CHANNEL_REDIS_URL=redis://[username:password@]host:port/database
```

The URL is passed to `channels_redis`; no host, port, socket path, or credential
is committed. Use `rediss://` when the Redis service requires TLS.

## Uberspace deployment

Staging and production run normal HTTP and WebSockets as two separate
processes, not one shared ASGI process: Gunicorn (WSGI) serves `/api`,
`/admin`, and agent login, while Daphne serves `/ws` from
`config.asgi:application`. The Uberspace web backend routes each path to its
own process accordingly. Redis is configured through `CHANNEL_REDIS_URL`.
Host-level details (ports, Supervisor program names, Redis setup) live in the
sibling `ops` repository and are not duplicated here. Application changes in
this repository should keep the endpoint paths and `CHANNEL_REDIS_URL`
setting above stable unless the matching ops configuration is updated in the
same release.
