# dodgers-roster

A small game for friends: predict the Dodgers' 2026 NLDS 26-man roster from
the 40-man roster. Picks lock at a set time. After that, everyone's picks are
revealed and scored against the real roster. https://qxnllc.com/baseball

- Player page: `index.html`
- Admin page: `admin.html?key=<ADMIN_KEY>`
- Behavior: see [SPEC.md](SPEC.md). Conventions: see [CLAUDE.md](CLAUDE.md).

Vanilla HTML/CSS/JS front end, a small PHP JSON API in `api/`, and data kept
in one JSON file. No build step and no dependencies.

## Run locally

Requires PHP 7.4+ with the `curl` (or `openssl`) extension.

```bash
cp api/config.example.php api/config.php   # then edit ADMIN_KEY / LOCK_AT
php -S localhost:8000
```

Open http://localhost:8000. On Windows, a bare PHP install has no CA
certificates, so HTTPS calls to MLB fail. Pass one in with
`-d curl.cainfo="C:/Program Files/Git/mingw64/etc/ssl/certs/ca-bundle.crt"`
(on this machine, `.claude/launch.json` has the full command).

Note: `php -S` ignores `.htaccess`, so `data/` is only protected on the real
Apache host.

## Deploy to Namecheap (cPanel)

1. **Check the PHP version.** In cPanel → *Select PHP Version*, use 8.x (7.4
   minimum), with the `curl` and `mbstring` extensions ticked.
2. **Upload the site files** with File Manager or FTP to a folder under
   `public_html`, e.g. `public_html/nlds/`: `index.html`, `admin.html`,
   `css/`, `js/`, `img/`, `api/`, and the hidden `.htaccess` (keeps the game out of
   search engines). Upload `data/.htaccess` too if you keep the data folder
   inside the site.
3. **Create the real config.** Copy `api/config.example.php` to
   `api/config.php` on the server and set:
   - `ADMIN_KEY`: a long random string. Bookmark
     `https://yoursite/nlds/admin.html?key=THAT_STRING`.
   - `LOCK_AT`: e.g. `'2026-10-04 10:00'` (Mountain Time). Leave it `''`
     until the time is known.
   - `DATA_DIR`: preferably a folder **outside** `public_html`, e.g.
     `'/home/<cpanel-user>/nlds-data'`. It's created automatically.
4. **Make sure the data folder is writable** by PHP. The usual cPanel
   permissions (755 folders, 644 files) are fine when PHP runs as your user.
5. **Smoke test:**
   - `api/state.php` returns JSON.
   - The home page loads the roster.
   - If `DATA_DIR` is inside `public_html`, `data/store.json` must return 403.
   - The admin link shows the admin page.

## Git

`main` is what's deployed and `develop` is where work happens. See CLAUDE.md.
Never commit `api/config.php` or anything in `data/` (both are gitignored).
