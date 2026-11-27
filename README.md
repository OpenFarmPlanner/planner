# OpenFarmPlanner

OpenFarmPlanner is a free, open-source crop planner for market gardens and
community-supported agriculture (CSA) farms. Plan what to grow, where it goes,
and when to sow, plant, and harvest.

[Website](https://openfarmplanner.org/) · [Live Demo](https://openfarmplanner.org/demo) · [Documentation](docs/index.md)

[![CI](https://github.com/OpenFarmPlanner/planner/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/OpenFarmPlanner/planner/actions/workflows/ci.yml)

## Why OpenFarmPlanner?

The project grew out of practical CSA experience. You can edit crops, areas, and
planting plans directly in spreadsheet-like tables. A change to a planting
plan updates the calendar, seed demand, and yield forecast automatically. The
community-maintained crop library gives you a starting point for spacing, growing
time, and yield estimates, and you can share what you learn on your farm.

OpenFarmPlanner is free to use and developed under the AGPL. Development and
hosting are intended to be funded by voluntary donations. You own the farm data
you enter. The service is ad-free and does not sell farm data.

## Main Features

- **Plan crops.** See bed occupancy and overlaps in the cultivation calendar,
  lay out growing areas graphically, plan rotations, copy plans between seasons,
  and track perennials across years.
- **Manage crops and seed.** Choose varieties from the crop library or keep your
  own, calculate seed needs and compare suppliers, see companion planting
  information, and record pest or disease losses.
- **Track and evaluate.** Turn sowing, planting, and harvest dates into tasks,
  record actual dates, compare yield forecasts with harvest records, and add
  notes and photos to planting plans.
- **Work together.** Invite teammates into shared projects, restore supported
  records from history or trash, and import and export crop data with
  spreadsheets. Use the app on desktop or mobile in seven languages.

## Getting Started

The hosted app is ready to use. Explore a temporary example project without an
account, or register to keep your own projects. [Try the demo](https://openfarmplanner.org/demo) · [Register](https://openfarmplanner.org/register) · [Sign in](https://openfarmplanner.org/login)

## Architecture and Tech Stack

- **Backend (`backend/`).** Django 5.2 and Django REST Framework on Python with
  PDM. Local development defaults to SQLite. PostgreSQL is supported.
- **Frontend (`frontend/`).** React 19, TypeScript, Vite, and Material UI. The
  interface calls the backend via `/api/`.

See the [architecture overview](docs/architecture-overview.md) for project
scoping, the data model, and frontend and backend responsibilities.

## Quick Start (Local Development)

Install Git, Python 3.12+, [PDM](https://pdm-project.org/), Node.js 22+, and npm 10+.
Clone `https://github.com/OpenFarmPlanner/planner.git` and run the following commands
from the repository root. To match production, install Python 3.13.18 and run
`pdm use 3.13.18` from `backend/` before `pdm install`.

### Backend

```bash
cd backend
cp .env.example .env
```

For local HTTP development, replace these values in `backend/.env`.

```dotenv
DEBUG=True
SESSION_COOKIE_SECURE=False
CSRF_COOKIE_SECURE=False
URL_PREFIX=
```

Then run from `backend/`:

```bash
pdm install
pdm run migrate
pdm run runserver
```

The API runs at `http://localhost:8000/api/`. Local account activation emails
appear in the backend terminal.

### Frontend

From the repository root in a second terminal:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173/`. Vite proxies `/api/` to Django. For testing on a
phone on the same network, stop both servers and run `scripts/dev-lan.sh` from
the repository root. It starts both servers and prints the LAN URLs. Keep
`VITE_API_BASE_URL` unset to use the proxy. [Frontend setup](frontend/README.md#setup)

## Development & Testing

Run commands from the named directory.

| Directory | What to run | Coverage |
| --- | --- | --- |
| `backend/` | `pdm run test` | Backend tests |
| `frontend/` | `npm run test` | Frontend unit and integration tests |
| `frontend/` | `npm run test:e2e` | Playwright against the production build served by `vite preview` |
| Repository root | `./scripts/quality.sh` | Shared lint, complexity, and test checks with reports in `reports/latest/` |

The [production-build E2E workflow](.github/workflows/e2e.yml) checks pull requests
against `main`. [Playwright setup](frontend/e2e/README.md) · [Testing and CI](docs/testing-and-ci.md) · [Quality baseline](docs/quality-baseline.md)

## Documentation

- [Technical documentation index](docs/index.md)
- [Backend guide](backend/README.md) and [frontend guide](frontend/README.md)
- [Contribution guide](CONTRIBUTING.md), [changelog](CHANGELOG.md), and [GitHub releases](https://github.com/OpenFarmPlanner/planner/releases)
- [Repository agent rules](AGENTS.md) and [agent tooling setup](docs/agent-skills.md#github-cli-setup)

## Deployment / Operations

Infrastructure and deployment guides live in the separate [ops repository](https://github.com/OpenFarmPlanner/ops),
which requires operator access. Application-side requirements are documented in
[backend deployment checks](backend/README.md#deployment-checks) and the
[release guide](docs/releases.md).

## Privacy and Usage Analytics

OpenFarmPlanner uses internal usage statistics to improve the product. The
superuser-only dashboard shows aggregate statistics and a project-level table.
The system uses daily project counts and stores internal account IDs, project
IDs, and UTC dates to count distinct active users. The statistics exclude page
visits, clicks, navigation history, and record contents. Daily platform activity
expires after 90 days. Crop-library operation counters have a 30-day window.
[Technical analytics details](docs/usage-analytics.md) · [Public privacy policy](https://openfarmplanner.org/en/privacy)

## Contributing

We welcome code, translations, growing knowledge, and feedback from people
using the planner.

- Read the [contribution guide](CONTRIBUTING.md) before opening a PR. For a larger change, open an issue to agree on scope first.
- Use [GitHub Issues](https://github.com/OpenFarmPlanner/planner/issues) for bugs and [GitHub Discussions](https://github.com/OpenFarmPlanner/planner/discussions) for ideas, questions, and feedback you can share publicly.
- Help translate the interface through the [frontend internationalization guide](frontend/README.md#internationalization), or contribute growing data through the [public crop library](https://openfarmplanner.org/en#kulturbibliothek).
- For private support, contact [info@openfarmplanner.org](mailto:info@openfarmplanner.org).

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See [LICENSE](LICENSE).

### Third-party code

`frontend/src/gantt-chart/` is vendored from [react-modern-gantt](https://github.com/MikaStiebitz/React-Modern-Gantt) by Mika Stiebitz, MIT License. The original license text and copyright notice are preserved at [frontend/src/gantt-chart/LICENSE](frontend/src/gantt-chart/LICENSE); see [frontend/src/gantt-chart/README.md](frontend/src/gantt-chart/README.md) for provenance details.

### Logo

The OpenFarmPlanner logo (`frontend/public/favicon.png` and the PWA icons derived from it) is not covered by the AGPL-3.0: © 2026 Martin Stipsitz, all rights reserved, and the license grants no trademark rights to it. Forks and modified versions must replace it. See [TRADEMARKS.md](TRADEMARKS.md) for what is allowed and for earlier versions.
