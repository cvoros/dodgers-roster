<?php
/**
 * config.example.php — TEMPLATE for the real config file.
 *
 * Copy this file to api/config.php and fill in real values.
 * api/config.php is gitignored: it holds the admin key, so it must never be
 * committed to the (public) repo. This template is the only committed copy.
 */

// Secret that unlocks the admin page: admin.html?key=<ADMIN_KEY>
// Use a long random string, e.g. the output of:  php -r "echo bin2hex(random_bytes(16));"
// The app refuses all admin requests while this is still the placeholder.
define('ADMIN_KEY', 'CHANGE-ME');

// When submissions lock, in TIMEZONE below. Format: 'YYYY-MM-DD HH:MM'.
// Leave as '' (empty) while the time is still to be announced:
// submissions then stay open and the page says "Lock time to be announced".
define('LOCK_AT', '');

// Time zone for LOCK_AT and for displayed times. America/Denver = Mountain Time
// (it follows daylight saving, so October is MDT, UTC-6).
define('TIMEZONE', 'America/Denver');

// Folder where entries and the cached roster are stored. Best practice is a
// folder OUTSIDE public_html so the web server can never serve it, e.g.
//   define('DATA_DIR', '/home/<cpanel-user>/dodgers-roster-data');
// The default below uses the repo's data/ folder, which ships with an
// .htaccess that blocks web access as a fallback.
define('DATA_DIR', __DIR__ . '/../data');

// How long (seconds) to reuse the cached 40-man roster before asking MLB again.
define('ROSTER_CACHE_SECONDS', 900);
