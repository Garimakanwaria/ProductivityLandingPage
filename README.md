# FocusFlow

A personal focus-session tracker. Start a timed session on one task, log when you get pulled away, and review how much focused time you actually put in each day.

It's a static site: plain HTML, CSS, and JavaScript with no build step and no backend. Your data stays in your browser.

## Features

- **Focus timer:** 25, 50, or 90 minutes, or any custom length from 1 to 240. Pause and resume, and it keeps counting correctly after a page reload.
- **Stay-away list:** a visible reminder of the apps and sites you're avoiding during a session.
- **Distraction logging:** "I'm tempted" logs a distraction on demand. Switching to another tab during a running session logs one automatically.
- **Commitment lock:** during a session the start controls are hidden, and ending early asks for confirmation and saves the session as stopped.
- **Insights:** today's focus time and goal progress, a daily goal you set, a finishing streak, your completion rate, a 7-day chart, and your top tasks.
- **History:** every session, grouped by day, with focus time, distractions, and status. Delete any entry.
- **Backups:** export everything as JSON and import it on another device or browser. Re-importing the same file doesn't create duplicates.

## Run it locally

ES modules don't load from `file://`, so serve the folder over HTTP:

```bash
cd focusflow
python3 -m http.server 8080
```

Then open http://localhost:8080.

## Run the tests

Requires Node 18 or newer. No dependencies to install.

```bash
npm test
```

The tests cover session timing (pauses, early stops, completion), streaks, analytics, corrupted-storage recovery, and backup validation.

## Deploy to GitHub Pages

1. Create an empty repository on GitHub, for example `focusflow`. Public or private both work. Private repos need a GitHub plan that supports Pages.
2. Push this folder:

   ```bash
   cd focusflow
   git init
   git add .
   git commit -m "FocusFlow v1"
   git branch -M main
   git remote add origin https://github.com/<your-username>/focusflow.git
   git push -u origin main
   ```

3. On GitHub, go to **Settings → Pages**. Under **Build and deployment**, set **Source** to *Deploy from a branch*, choose branch `main`, folder `/ (root)`, and save.
4. After a minute or two the app is live at `https://<your-username>.github.io/focusflow/`.

Updating the app later: commit and push to `main`, and Pages redeploys automatically.

## Where your data lives

All sessions and settings are stored in the browser's `localStorage`, scoped to the exact address you use. That has two consequences:

- Data on `localhost` and data on your GitHub Pages address are separate. To move data between them, export a backup and import it.
- Clearing site data or browser storage erases the sessions. Export a backup regularly from **Settings → Export backup**.

Nothing is sent to a server. There are no accounts, analytics, or tracking.

## Limits, stated plainly

- **A web page can't block other apps or websites.** The stay-away list is a reminder, and the tab-switch detection is a logged signal, not a block. For real blocking, use your phone's Focus mode or a site-blocking extension or app alongside FocusFlow.
- **Timers rely on the page running.** Times are calculated from timestamps, so a closed tab doesn't lose progress. If the session ends while the app is closed, it's logged the next time you open it.
- **Browser audio:** the end-of-session chime may be blocked by some browsers until you interact with the page.

## Project structure

```
index.html          App shell and all four views
css/styles.css      Styles, mobile-first
js/logic.js         Pure session and analytics functions (no DOM)
js/storage.js       Save, load, validation, backup import/merge
js/app.js           UI wiring
tests/              Unit tests for the logic and storage modules
favicon.svg
package.json        Test script; marks the project as ES modules
```
