# JoeTest

A React Progressive Web App (PWA) — installable on mobile and desktop from the browser.

## Tech Stack

- React 18 + Vite
- PWA (installable, offline-ready)
- ESLint + Prettier

## Getting Started

```bash
npm install
npm run dev
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run lint` | Run ESLint |
| `npm run format` | Run Prettier |

## Project Structure

```
src/
├── assets/         # Images, fonts, static files
├── components/     # Reusable UI components
│   └── common/     # Shared primitives (Button, Input, etc.)
├── hooks/          # Custom React hooks
├── pages/          # Page-level components (one per route)
├── services/       # API calls and external integrations
├── store/          # Global state (context or Redux)
├── styles/         # Global CSS and theme variables
└── utils/          # Pure helper functions
```

## PWA / Mobile

This app includes a Web App Manifest and service worker, making it installable on Android and iOS via the browser's "Add to Home Screen" prompt.
