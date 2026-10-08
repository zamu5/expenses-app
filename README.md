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

## Categories that are not monthly

A category marked "Every month" is in every month's plan. Turn that off for things like insurance
or holidays: they only appear in the months you add them to, from **Plan month**. The × next to a
category in the plan takes it out of that month only.

## Who paid, and who owes whom

Every expense records who paid and who it was for: shared 50/50, or only one of you. From that the
app keeps a running balance across all months ("Adriana owes Sergio $40"), shown at the top of the
Month tab. Tap it to see where the number comes from and to record a payment that settles it.
Budgets still count the full amount of every expense, whoever paid.

The math is in `src/domain/split.ts`. The two names are `PEOPLE` in `src/config.ts`.

## Income

Money you receive (salary, a refund) is logged with **+ Add income** on the Month tab. It is not
an expense: it raises the month's current, planned and projected balances.

## Accounts and planned expenses

The Accounts tab shows everything in one place: each account in its own currency, the expenses you
are planning for but have not put in a month (counted as negative), and a total in your home
currency. Nothing is predefined; you add, rename and delete accounts yourself.

- Mark one account as the **Budget account**: its balance is not typed, it follows the current
  balance of the month selected in the app.
- Other balances are typed in by hand, and so are exchange rates ("1 CAD = how many COP?").
  A currency without a rate is shown but left out of the total.

The math is in `src/domain/accounts.ts`.

## Changing the home currency

Edit `CURRENCY` in `src/config.ts` (for example `'EUR'` or `'COP'`). The budget is in this currency
and the Accounts total is converted to it.
