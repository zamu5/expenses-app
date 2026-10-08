# Expenses

A monthly budgeting app for iPhone. Set the money you start the month with, a budget per
category, log expenses, and see your current balance, the planned end-of-month balance and a
projection based on how fast you are actually spending.

Built with React Native + Expo (TypeScript). All data stays on the phone in SQLite. No backend.

## Run it on your iPhone

You need Node.js 20+ on your computer and the **Expo Go** app from the App Store on your iPhone.

```bash
npm install
npx expo start
```

Scan the QR code with the iPhone camera. The app opens in Expo Go and reloads every time you
save a file. Phone and computer must be on the same Wi-Fi (or run `npx expo start --tunnel`).

## Run it in Docker

Needs Docker Desktop. The container runs the Expo dev server with your source folder mounted,
so edits on your machine reload in the app.

```bash
docker compose up --build     # start; add -d to run it in the background
docker compose down           # stop
```

Then open http://localhost:8081 in a browser for the web version.

To open it from a phone on the same Wi-Fi, start it with this machine's LAN IP so the QR code
points at it:

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=$(ipconfig getifaddr en0) docker compose up
```

After changing dependencies in `package.json`, rebuild with fresh modules:
`docker compose down -v && docker compose up --build`.

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests: budget math, money parsing, dates, and the database layer against real SQLite |
| `npm run typecheck` | TypeScript type check (run `npx expo start` once first so Expo generates its type files) |
| `npm run web` | Runs the app in a browser for quick checks; the iPhone is the real target |

## How the code is organised

```
src/
  app/                    Screens. Expo Router turns each file into a route.
    (tabs)/               The three tabs: Month (index), Expenses, Categories
    category/[id].tsx     One category in the selected month
    expense.tsx           Add / edit an expense (modal)
    plan.tsx              Starting balance + budgets for a month (modal)
    category-edit.tsx     Add / edit / archive a category (modal)
  domain/                 Pure TypeScript: budget math, money, dates. No React, no database.
  db/
    migrations.ts         Schema, versioned with PRAGMA user_version
    repositories/         The only code that runs SQL
    events.ts             Tells screens to refresh after any write
  hooks/                  useDbQuery, useMonthSummary
  store/ui.ts             Zustand store: the selected month
  components/             Shared UI pieces
  config.ts               Currency setting
```

Rules that keep it healthy:

- **Money is integer cents.** `12.34` is stored as `1234`. Never do arithmetic with floats.
- **Screens never run SQL.** They call repositories through `useDbQuery`.
- **Budget math stays pure.** `src/domain/budget.ts` takes plain values and returns plain values,
  so it is fully unit tested.
- **Schema changes are new migrations.** Never edit a migration that has shipped; append one.

## Changing the currency

Edit `CURRENCY` in `src/config.ts` (for example `'EUR'` or `'COP'`).
