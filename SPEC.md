# Dodgers 2026 NLDS Roster Prediction Game — Spec

A small web game for a group of friends: each person predicts the Dodgers'
26-man NLDS roster from the 40-man roster. After the real roster is announced,
entries are scored and ranked.

## 1. Stack & hosting

- **Front end:** single-page vanilla HTML / JS / CSS. No frameworks, no build step.
- **Back end:** minimal PHP (target PHP 8.x, must also run on 7.4) as a JSON API.
- **Storage:** one JSON file, read/written under an exclusive `flock()` so two
  simultaneous submissions can't clobber each other. (SQLite is overkill for a
  few dozen entries; the storage layer is isolated in one PHP file so it could be
  swapped later.)
- **Hosting:** Namecheap shared hosting via cPanel. Deploy = upload files.
- **Repo:** `github.com/cvoros/dodgers-roster` (public).
- **Not in search engines.** The game shares a domain with a company website
  (qxnllc.com/baseball), so nothing in its folder may be indexed: an
  `.htaccess` sends `X-Robots-Tag: noindex, nofollow` for every file, the
  API also sends it from PHP, and both HTML pages carry
  `<meta name="robots" content="noindex, nofollow">`. The site-root
  robots.txt belongs to the company site and is not touched.

## 2. Secrets & data — never committed

| File | Committed? | Purpose |
|---|---|---|
| `api/config.example.php` | yes | Template with placeholder values |
| `api/config.php` | **no** (gitignored) | Real admin key, lock time, data path |
| `data/` (entries JSON, roster cache) | **no** (gitignored) | All player/entry data |

- `config.php` holds: `ADMIN_KEY` (long random string), `LOCK_AT`
  (e.g. `'2026-10-04 10:00'`), `TIMEZONE` (`'America/Denver'`), `DATA_DIR`.
- `DATA_DIR` should point **outside `public_html`** when possible. If it must
  live under the web root, the repo ships a `data/.htaccess` that denies all
  web access (the `.htaccess` itself is the only committed file in `data/`).

## 3. Player pool

- Fetched from the MLB Stats API, Dodgers team id **119**, 40-man roster:
  `https://statsapi.mlb.com/api/v1/teams/119/roster?rosterType=40Man&hydrate=person`
- Fetched **through a PHP proxy** (`api/roster.php`) that caches the response
  in `DATA_DIR` for ~15 minutes. Reasons: no dependence on MLB's CORS headers,
  fewer calls to MLB, and the server needs the same list to validate
  submissions. If MLB is unreachable, the proxy serves the last cached copy.
- Each player is normalized to:
  `{ id, name, group: "P" | "POS", pos, throws, bats }`
- **Display format**
  - Pitchers: `Tyler Glasnow RHP` / `Alex Vesia LHP` (from `pitchHand`).
  - Position players: `Freddie Freeman 1B, L` — primary position abbreviation,
    then bats `L` / `R` / `S`.
- **Grouping:** primary position `P` → Pitchers; everything else → Position
  Players. **Two-way players (`TWP`, i.e. Shohei Ohtani)** go in Position
  Players, displayed `Shohei Ohtani TWP, L`. The admin picker uses the same
  rule, so pitcher counts mean the same thing on both sides.
- Lists are sorted alphabetically by last name within each group.
- Non-active players (e.g. "Injured 60-Day", "Reassigned to Minors") carry a
  small status tag in the pool. It's shown for information only, and they can
  still be picked.

## 4. Player flow (`index.html`)

1. **Name.** Player enters a display name. Names are trimmed, internal
   whitespace collapsed, 1–30 chars. Uniqueness is **case-insensitive**
   ("chris" collides with "Chris"). Availability is checked when they press
   Continue, and checked again atomically on final submit (so two people racing
   for the same name can't both win). Duplicates are rejected with a clear
   message.
2. **Instructions + scoring rules** shown at the top of the picker (short).
3. **Picker.**
   - Left: player pool, two sections — Pitchers / Position Players.
   - Right: 26 slots split into a Pitchers group and a Position Players group,
     with a live count like **"14 P / 12 POS · 26 / 26"**. The split is free —
     the player decides how many pitchers — only the total is capped at 26.
   - Tap a pool player → moves into the next open slot of their group (and is
     greyed out / hidden in the pool). Tap a filled slot → removes it and the
     player returns to the pool. When 26 are picked, pool taps are ignored with
     a brief "roster full" hint.
   - **Mobile:** below ~700px wide the layout stacks — roster summary is a
     sticky bar at the top (count + expandable slot list), pool below. Tap
     targets ≥ 44px. No drag-and-drop, no hover-dependent UI.
   - In-progress picks are saved to `localStorage` so an accidental refresh
     doesn't wipe them (convenience only — nothing is final until submitted).
4. **Tie-breaker.** A number box above the picker: **"Total runs in Game 1
   (both teams)"**, a whole number 0–99. Required. The current guess is echoed
   in the sticky roster bar and saved with the draft.
5. **Play Ball.** Button disabled until exactly 26 are picked. If the runs
   guess is missing or invalid, pressing it highlights and scrolls to the runs
   box with a message instead of opening the modal. Otherwise it opens a
   confirm modal listing the runs guess and the full roster (both groups), with the question
   **"Are you sure this is your final roster?"** — buttons *Go back* / *Lock it in*.
6. **Submit.** Server validates, stores, and responds. Picks are **final** —
   there is no edit or delete for players. The page then shows "You're in"
   with their roster.
7. **Lock.** At `LOCK_AT` (Mountain Time) the server rejects all new
   submissions and name checks. The page shows a countdown before lock and a
   "Submissions are closed" state after.
8. **Visibility.**
   - Before lock: only the **number** of entries (and optionally the names) is
     public. Nobody's picks are visible, including via the API.
   - After lock: anyone can view every entry's full roster.
   - After the admin enters the actual roster: the public page also shows the
     scoreboard (same as admin's).

## 5. Server-side validation (submit)

Reject with a specific error unless all hold:
- Now is before `LOCK_AT` (server clock, `TIMEZONE`).
- Name valid and not already taken (case-insensitive), checked under the lock.
- Exactly 26 player ids, no duplicates, every id on the current (cached) 40-man.
- `runsGuess` is a whole number 0–99 (JSON number or digit string; anything
  else, including `true`, is rejected).
- Pitcher count is **recomputed server-side** from the ids; the client's value
  is never trusted. It's stored for display only — it is not a tie-breaker.

Stored entry:
```json
{
  "name": "Chris",
  "submittedAt": "2026-10-03T19:42:11.123456-06:00",
  "pitcherCount": 13,
  "runsGuess": 8,
  "picks": [ { "id": 660271, "name": "Shohei Ohtani", "group": "POS", "label": "Shohei Ohtani TWP, L" } ]
}
```
Name/label are snapshotted so entries still render if a player later leaves the
40-man. `submittedAt` uses microseconds so ordering ties are practically
impossible.

## 6. Scoring

- **1 point** per picked player who is on the actual 26-man roster (match by
  MLB player id). Max 26.
- **Tie-breaker 1:** smallest `|runsGuess − actual Game 1 total runs|`
  (over or under doesn't matter).
- **Tie-breaker 2:** earliest `submittedAt`.
- The roster is announced before Game 1 is played, so for a while the
  scoreboard exists without the runs result. Until the admin enters it,
  tie-breaker 1 is skipped (ties rank by earliest entry) and the page says the
  tie-breaker is still to come; the heading reads "Standings", then "Final
  standings" once the runs are in.
- Scores are computed on read, never stored, so correcting the actual roster
  or the runs re-scores everyone automatically.

## 7. Admin (`admin.html?key=…`)

- The "secret URL" is `admin.html?key=<ADMIN_KEY>`. The HTML page itself is
  public but useless; every admin API call sends the key in an
  `X-Admin-Key` header and the server compares with `hash_equals`. Wrong key →
  403 and the page shows nothing.
- **Enter actual roster** using the same picker component as players (26
  total). Can be saved/overwritten at any time; saving triggers a confirm.
- **Optional: "Pull from MLB"** button fetches
  `teams/119/roster?rosterType=active` and pre-fills the picker. The admin must
  still review and press Save — MLB's "active" list may not reflect the
  postseason roster the moment it's announced.
- **Game 1 total runs:** number box (0–99) with Save and Clear. Entered after
  Game 1 ends; can be corrected or cleared at any time.
- **Scoreboard** once an actual roster exists: ranked list (rank, name, score,
  runs guess and how far off it was, submitted time). Each row expands to show hits
  (✓) and misses (✗) for their picks, plus the actual players nobody/they
  missed.
- **Entry management:** admin can delete an entry (test entries, a friend who
  typo'd their name). Players cannot.
- Admin view shows all entries at any time, including before lock.

## 8. API (all JSON, under `api/`)

| Method & path | Auth | Purpose |
|---|---|---|
| `GET roster.php` | — | Normalized 40-man pool (cached proxy) |
| `GET state.php` | — | `{ now, lockAt, locked, entryCount, names[], hasActual, hasGame1Runs }` |
| `GET check-name.php?name=` | — | `{ available: bool }` (before lock only) |
| `POST submit.php` | — | `{ name, playerIds[], runsGuess }` → stored entry or error |
| `GET entries.php` | — | 403 before lock; all entries after lock, plus `game1Runs`; includes scoreboard if actual roster exists |
| `GET admin.php?action=…` / `POST admin.php` | key | `overview`, `pullActive`, `saveActual`, `saveGame1Runs`, `deleteEntry` |

Errors: HTTP 4xx with `{ "error": "human-readable message" }`.

## 9. Non-goals

- No accounts, passwords, or email.
- No editing of submitted entries.
- No live scoring during the series — the roster is known once, before Game 1.
- No framework, bundler, or npm dependencies.

## 10. Decisions & open items

- Entrant **names** are public before lock (picks are not).
- The scoreboard is **public** once the lock has passed and the actual roster is entered.
- **Lock date/time (MT): TBD.** Set `LOCK_AT` in `config.php`. While `LOCK_AT`
  is empty, submissions stay open and the page says "Lock time to be announced".
