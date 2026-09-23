# CLAUDE.md — dodgers-roster

NLDS roster prediction game for Chris's friends. **SPEC.md is the source of
truth for behavior** — read it before changing anything, and update it in the
same commit when behavior changes.

## Stack rules

- **Vanilla only.** Plain HTML, CSS, and JavaScript (ES2020, no modules
  bundler, no npm, no frameworks, no CDN libraries). PHP with no Composer
  packages. If something seems to need a library, ask first.
- PHP must run on **7.4 and 8.x** (Namecheap shared hosting). Avoid 8-only
  syntax (`match`, named args, nullsafe `?->`, constructor promotion).
- Front end talks to the back end only through the JSON endpoints in `api/`.

## Layout

```
index.html          player page
admin.html          admin page (secret key in ?key=)
css/style.css
js/common.js        shared: API helpers, player formatting, picker component
js/app.js           player flow
js/admin.js         admin flow
api/lib.php         config loading, JSON responses, storage (flock), validation, scoring
api/*.php           one small file per endpoint
api/config.example.php   committed template
api/config.php      REAL secrets — gitignored, never commit
data/               runtime data — gitignored except data/.htaccess
```

## Code style

- **Comment heavily.** Chris reads this code to learn from it. Every file gets
  a header comment saying what it's for. Every function gets a comment saying
  what it does and why; non-obvious lines get inline comments. Explain the
  *why* (e.g. "flock so two submits can't interleave"), not just the what.
- Descriptive names over short ones. `const`/`let`, never `var`.
- 2-space indent in JS/CSS/HTML, 4-space in PHP.
- Mobile first: test layouts at 375px wide; tap targets ≥ 44px.
- All user-visible strings are plain text via `textContent` — never inject
  user-supplied names with `innerHTML`.

## Security / data rules (non-negotiable)

- Never commit `api/config.php`, anything in `data/` except `data/.htaccess`,
  or any real entries/player data. Check `git status` before every commit.
- Server never trusts the client: recompute pitcher counts, re-check the lock
  time, re-validate player ids on every submit.
- Admin endpoints compare the key with `hash_equals`.
- Before lock, no endpoint may return another player's picks.

## Git workflow

- **`main`** = what's deployed / deployable. **`develop`** = integration branch.
- Do work on `develop` (or a short `feature/…` branch off it, merged back into
  `develop`). Merge `develop` → `main` only for a release Chris has OK'd, and
  tag it (`v0.1.0`, …).
- Small commits, imperative subject line ("Add name uniqueness check").
- Reference issues with **`See #N`** / **`Refs #N`** — never `Fixes`/`Closes`/
  `Resolves` (those auto-close; closing is Chris's call).
- Don't push without being asked.

## CHANGELOG.md

- Keep a Changelog format (`## [Unreleased]`, then `### Added / Changed /
  Fixed / Removed`).
- Every user-visible change adds a line under `[Unreleased]` in the same
  commit. On release, rename `[Unreleased]` to the version + date.

## Testing

- No test framework. Verify by running `php -S localhost:8000` from the repo
  root and exercising the flow in the browser (desktop and 375px mobile
  width), plus `php -l` on every changed PHP file.
- On Chris's Windows machine PHP 8.3 comes from winget and has no php.ini:
  use the `php-dev` config in `.claude/launch.json`, which enables
  curl/openssl/mbstring and points curl at Git's CA bundle. Never turn off
  SSL verification in code to work around this.
- `php -S` handles one request at a time on Windows and ignores `.htaccess`,
  so concurrency and data-folder protection can only really be checked on the
  host.
- To test the lock, temporarily set `LOCK_AT` in your local `config.php` to a
  past time — never change `config.example.php` for this.
