# Fantrax League Roaster

A free, zero-cost web app that pulls data from a public Fantrax fantasy football (soccer) league and generates a stats-based season report — standings breakdown, weekly drama, squad analysis, draft day verdicts, and transfer activity.

No API keys. No backend. No running costs.

## What it does

Paste a public Fantrax league URL, click **Roast My League**, and get a report covering:

- **Standings** — where everyone sits, with honest commentary on the top and bottom
- **Weekly drama** — best and worst scores across all played gameweeks, biggest wins, narrowest margins, longest streaks
- **Squad report** — each team's star player, liability, and who they should have sold a long time ago
- **Draft day** — first overall pick outcomes, round 1 summary
- **Transfer activity** — who was busiest in the market and who barely touched their squad
- **Season awards** — most consistent, boom-or-bust, best/worst single week

The report is aware of where the season currently sits (gameweek X of 38), so it works at any point in the season, not just at the end.

## Requirements

Your Fantrax league must be set to **public** in the league settings. Private leagues cannot be accessed.

## Tech stack

- React 18 + Vite
- Pure JavaScript template-based report generation (no AI, no paid APIs)
- Fantrax data fetched via server-side proxy (bypasses Cloudflare)
- PWA — installable on mobile and desktop

## Running locally

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. The Vite dev server proxies all Fantrax API calls server-side.

## Deploying for free

### Vercel (recommended)

1. Push to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → Import your repo
3. Vercel auto-detects Vite — no config changes needed
4. Deploy

The `vercel.json` in this repo configures the Fantrax proxy automatically. Every push to `main` redeploys.

### Netlify

Same process — `netlify.toml` is included. Connect your repo at [netlify.com](https://netlify.com), it builds and deploys automatically.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server (includes Fantrax proxy) |
| `npm run build` | Production build |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |
| `npm run format` | Run Prettier |

## Project structure

```
src/
├── pages/
│   └── Home.jsx          # Main UI — input, progress, report display
├── services/
│   ├── fantrax.js        # All Fantrax API calls + data processing
│   └── roastGenerator.js # Template-based report generation
└── styles/
    └── global.css        # Dark theme
```
