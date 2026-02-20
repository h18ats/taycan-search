# Porsche Taycan Turbo S Finder

A daily-refreshing web dashboard that tracks Porsche Taycan Turbo S listings on [Porsche Finder](https://finder.porsche.com), monitoring price changes, new listings, and removed/sold cars.

## Search Criteria

- **Model:** Taycan Turbo S
- **Max Price:** £60,000
- **Year:** 2020–2023
- **Battery:** Performance Battery Plus
- **Equipment:** Sport Chrono, Panoramic Roof, Privacy Glass, Burmester Sound, 4+1 Seats, Leather

## Setup

```bash
# Install dependencies
npm install

# Install Playwright browser
npx playwright install chromium

# First run: opens a visible browser to bypass Vercel security
node scraper.js --headed

# Start the dashboard
node server.js
# Visit http://localhost:3000
```

## Daily Auto-Refresh

A launchd job runs the scraper daily at 8am. To set it up manually:

```bash
# Load the daily scrape job
cp com.porsche-finder.scrape.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.porsche-finder.scrape.plist
```

## How It Works

1. **Scraper** (`scraper.js`) — Uses Playwright to load the Porsche Finder page, extract listing data from the DOM, and store it in SQLite
2. **Server** (`server.js`) — Express server with a REST API and static dashboard
3. **Dashboard** (`static/index.html`) — Dark-themed Porsche-styled UI showing active listings, removed/sold cars, and scrape history

### Session Management

The first scrape must run in headed mode (`--headed`) to pass Vercel's bot protection. The browser session is saved to `storage-state.json` for subsequent headless runs. If the session expires, re-run with `--headed`.

## Tech Stack

- Node.js + Express
- Playwright (with stealth plugin)
- SQLite (better-sqlite3)
- Vanilla HTML/CSS/JS frontend
