<?php
/**
 * lib.php — shared code for every API endpoint.
 *
 * Every endpoint file starts with `require __DIR__ . '/lib.php';` and then
 * uses the helpers below. Sections:
 *   1. Config loading + JSON response helpers
 *   2. Lock-time helpers
 *   3. Storage (one JSON file guarded by flock)
 *   4. Player roster (MLB Stats API, cached)
 *   5. Names
 *   6. Validation of a 26-player roster
 *   7. Scoring
 *   8. Admin auth
 *
 * Written for PHP 7.4+ (Namecheap shared hosting), so no PHP-8-only syntax.
 */

// ---------------------------------------------------------------------------
// 1. Config + JSON responses
// ---------------------------------------------------------------------------

// Every response from the API is JSON. Set this before anything can be output.
header('Content-Type: application/json; charset=utf-8');
// Never let a browser or proxy cache API answers: lock state and entries change.
header('Cache-Control: no-store');
// Keep API responses out of search engines (see the folder's .htaccess; this
// covers hosts where mod_headers is off).
header('X-Robots-Tag: noindex, nofollow');

// The real config holds the admin key and is gitignored. If it's missing the
// site was deployed without it — say so clearly instead of failing obscurely.
if (!file_exists(__DIR__ . '/config.php')) {
    http_response_code(500);
    echo json_encode(['error' => 'Server not configured: copy api/config.example.php to api/config.php.']);
    exit;
}
require __DIR__ . '/config.php';

date_default_timezone_set(TIMEZONE);

// The size of the roster being predicted.
const ROSTER_SIZE = 26;

// Dodgers team id in the MLB Stats API.
const MLB_TEAM_ID = 119;

// Highest allowed Game 1 total-runs number (tie-breaker). Generous: the
// postseason record for one game is well under this.
const MAX_RUNS = 99;

/**
 * Send a JSON success response and stop.
 */
function json_out($data, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Send a JSON error `{ "error": "..." }` and stop. The front end shows the
 * message to the user as-is, so write it for a human.
 */
function json_error(string $message, int $status = 400): void
{
    json_out(['error' => $message], $status);
}

/**
 * Only allow the listed HTTP method(s) for this endpoint.
 */
function require_method(string ...$allowed): void
{
    if (!in_array($_SERVER['REQUEST_METHOD'], $allowed, true)) {
        json_error('Method not allowed.', 405);
    }
}

/**
 * Decode the JSON body of a POST request into an array.
 */
function read_json_body(): array
{
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) {
        json_error('Request body must be JSON.');
    }
    return $body;
}

/**
 * The current time as an ISO-8601 string with microseconds, in TIMEZONE.
 * Microseconds make "earliest submission" tie-breaks effectively unambiguous.
 */
function now_iso(): string
{
    return (new DateTimeImmutable('now'))->format('Y-m-d\TH:i:s.uP');
}

// ---------------------------------------------------------------------------
// 2. Lock time
// ---------------------------------------------------------------------------

/**
 * When submissions lock, or null if LOCK_AT is still empty ("TBD").
 */
function lock_time(): ?DateTimeImmutable
{
    if (trim(LOCK_AT) === '') {
        return null;
    }
    $lock = DateTimeImmutable::createFromFormat('Y-m-d H:i', trim(LOCK_AT));
    if ($lock === false) {
        json_error('Server misconfigured: LOCK_AT must look like 2026-10-04 10:00.', 500);
    }
    return $lock;
}

/**
 * True once the lock time has passed. With no lock time set, never locked.
 * Always uses the SERVER clock — the browser's clock is never trusted.
 */
function is_locked(): bool
{
    $lock = lock_time();
    return $lock !== null && new DateTimeImmutable('now') >= $lock;
}

/**
 * Public summary of the game's state, shared by state.php and admin.php.
 * Names are public before lock (per SPEC); picks never are.
 */
function public_state(array $store): array
{
    $lock = lock_time();
    return [
        'now'        => now_iso(),
        'lockAt'     => $lock ? $lock->format(DATE_ATOM) : null,
        'timezone'   => TIMEZONE,
        'locked'     => is_locked(),
        'entryCount' => count($store['entries']),
        'names'      => array_map(function ($e) { return $e['name']; }, sorted_by_submission($store['entries'])),
        'hasActual'  => $store['actual'] !== null,
        'hasGame1Runs' => $store['game1Runs'] !== null,
    ];
}

// ---------------------------------------------------------------------------
// 3. Storage — one JSON file, guarded by flock()
// ---------------------------------------------------------------------------
//
// Shape of data/store.json:
//   {
//     "entries":   [ { name, submittedAt, pitcherCount, runsGuess, picks: [...] }, ... ],
//     "actual":    null | { savedAt, pitcherCount, players: [...] },
//     "game1Runs": null | int   (total runs, both teams, in NLDS Game 1)
//   }
//
// Why flock: two friends can press "Play Ball" at the same instant. Without an
// exclusive lock, both requests could read the file, each add their entry, and
// the second write would silently erase the first.

/**
 * Make sure DATA_DIR exists and is writable.
 */
function data_dir(): string
{
    if (!is_dir(DATA_DIR) && !@mkdir(DATA_DIR, 0750, true)) {
        json_error('Server misconfigured: cannot create DATA_DIR.', 500);
    }
    return rtrim(DATA_DIR, '/\\');
}

/**
 * Open the store file and hold a lock on it while $callback runs.
 *
 * $callback receives the decoded store BY REFERENCE. If $write is true the
 * (possibly modified) store is written back before the lock is released.
 * Whatever $callback returns is returned from here.
 */
function with_store(bool $write, callable $callback)
{
    $path = data_dir() . '/store.json';

    // 'c+' = open for read/write, create if missing, don't truncate.
    $handle = fopen($path, 'c+');
    if ($handle === false) {
        json_error('Server error: cannot open data file.', 500);
    }

    // Readers share the lock; a writer waits until it has the file to itself.
    flock($handle, $write ? LOCK_EX : LOCK_SH);

    $raw = stream_get_contents($handle);
    $store = $raw ? json_decode($raw, true) : null;
    if (!is_array($store)) {
        $store = [];   // brand-new file
    }
    // Fill in any missing keys, so files saved by older versions of the app
    // (e.g. before game1Runs existed) still have the full shape.
    $store += ['entries' => [], 'actual' => null, 'game1Runs' => null];

    $result = $callback($store);

    if ($write) {
        // Overwrite the file in place with the new contents.
        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, json_encode($store, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        fflush($handle);
    }

    flock($handle, LOCK_UN);
    fclose($handle);
    return $result;
}

/**
 * Read-only snapshot of the store.
 */
function read_store(): array
{
    return with_store(false, function (array &$store) { return $store; });
}

/**
 * Entries sorted earliest submission first.
 */
function sorted_by_submission(array $entries): array
{
    usort($entries, function ($a, $b) {
        return submission_time($a) <=> submission_time($b);
    });
    return $entries;
}

/**
 * An entry's submission time as a float of seconds (with microseconds), for
 * sorting. Parsing (rather than comparing strings) is safe across UTC offsets.
 */
function submission_time(array $entry): float
{
    return (float) (new DateTimeImmutable($entry['submittedAt']))->format('U.u');
}

// ---------------------------------------------------------------------------
// 4. Player roster (MLB Stats API)
// ---------------------------------------------------------------------------

/**
 * GET a URL and decode its JSON. Returns null on any failure.
 * Uses cURL when available (most reliable on shared hosts), otherwise
 * file_get_contents.
 */
function http_get_json(string $url): ?array
{
    $body = false;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_USERAGENT      => 'dodgers-roster-game',
        ]);
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($code !== 200) {
            $body = false;
        }
    } else {
        $context = stream_context_create(['http' => ['timeout' => 10, 'user_agent' => 'dodgers-roster-game']]);
        $body = @file_get_contents($url, false, $context);
    }
    if ($body === false) {
        return null;
    }
    $data = json_decode($body, true);
    return is_array($data) ? $data : null;
}

/**
 * Build the MLB Stats API URL for one of the team's rosters.
 * hydrate=person adds batSide / pitchHand / lastName to each player.
 */
function mlb_roster_url(string $rosterType): string
{
    return 'https://statsapi.mlb.com/api/v1/teams/' . MLB_TEAM_ID
        . '/roster?rosterType=' . urlencode($rosterType) . '&hydrate=person';
}

/**
 * Turn one MLB roster row into our compact player shape:
 *   { id, name, lastName, group: "P"|"POS", pos, throws, bats, label, status }
 *
 * Grouping rule (SPEC §3): primary position "P" is a pitcher; everything else,
 * including two-way players ("TWP", i.e. Ohtani), is a position player.
 */
function normalize_player(array $row): array
{
    $person = $row['person'];
    $pos    = $row['position']['abbreviation'] ?? '?';
    $group  = $pos === 'P' ? 'P' : 'POS';
    $throws = $person['pitchHand']['code'] ?? '?';
    $bats   = $person['batSide']['code'] ?? '?';
    $name   = $person['fullName'];

    // Display format from SPEC: "Tyler Glasnow RHP" / "Freddie Freeman 1B, L".
    $label = $group === 'P'
        ? $name . ' ' . $throws . 'HP'
        : $name . ' ' . $pos . ', ' . $bats;

    // Roster status, e.g. "Active", "Injured 10-Day". Shown as a small tag so
    // players know who's hurt — useful info for a roster prediction.
    $status = $row['status']['description'] ?? 'Active';

    return [
        'id'       => (int) $person['id'],
        'name'     => $name,
        'lastName' => $person['lastName'] ?? $name,
        'group'    => $group,
        'pos'      => $pos,
        'throws'   => $throws,
        'bats'     => $bats,
        'label'    => $label,
        'status'   => $status,
    ];
}

/**
 * Fetch a roster from MLB and normalize it, sorted by last name.
 * Returns null if MLB can't be reached.
 */
function fetch_mlb_roster(string $rosterType): ?array
{
    $data = http_get_json(mlb_roster_url($rosterType));
    if ($data === null || !isset($data['roster']) || !is_array($data['roster'])) {
        return null;
    }
    $players = array_map('normalize_player', $data['roster']);
    usort($players, function ($a, $b) {
        return [$a['lastName'], $a['name']] <=> [$b['lastName'], $b['name']];
    });
    return $players;
}

/**
 * The 40-man player pool, from cache when fresh.
 *
 * Returns ['players' => [...], 'fetchedAt' => iso, 'stale' => bool].
 * If MLB is down, serves the last cached copy (stale = true) rather than
 * breaking the game. Only fails if there has never been a successful fetch.
 */
function get_pool(): array
{
    $cachePath = data_dir() . '/roster-cache.json';
    $cached = file_exists($cachePath) ? json_decode(file_get_contents($cachePath), true) : null;

    $isFresh = is_array($cached)
        && isset($cached['fetchedTs'])
        && time() - $cached['fetchedTs'] < ROSTER_CACHE_SECONDS;
    if ($isFresh) {
        return ['players' => $cached['players'], 'fetchedAt' => $cached['fetchedAt'], 'stale' => false];
    }

    $players = fetch_mlb_roster('40Man');
    if ($players !== null && count($players) > 0) {
        $fresh = ['fetchedTs' => time(), 'fetchedAt' => now_iso(), 'players' => $players];
        // LOCK_EX so two simultaneous refreshes don't interleave their writes.
        file_put_contents($cachePath, json_encode($fresh, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
        return ['players' => $players, 'fetchedAt' => $fresh['fetchedAt'], 'stale' => false];
    }

    if (is_array($cached) && !empty($cached['players'])) {
        return ['players' => $cached['players'], 'fetchedAt' => $cached['fetchedAt'], 'stale' => true];
    }
    json_error('Could not load the Dodgers roster from MLB. Try again in a minute.', 503);
}

/**
 * The pool keyed by player id, for fast lookups during validation.
 */
function pool_by_id(): array
{
    $byId = [];
    foreach (get_pool()['players'] as $player) {
        $byId[$player['id']] = $player;
    }
    return $byId;
}

// ---------------------------------------------------------------------------
// 5. Names
// ---------------------------------------------------------------------------

/**
 * Tidy a display name: trim and collapse runs of whitespace to one space.
 */
function clean_name($name): string
{
    if (!is_string($name)) {
        return '';
    }
    return trim(preg_replace('/\s+/u', ' ', $name));
}

/**
 * Comparison key for uniqueness: case-insensitive, so "chris" == "Chris".
 * mb_strtolower handles accented letters; fall back if mbstring is missing.
 */
function name_key(string $name): string
{
    return function_exists('mb_strtolower') ? mb_strtolower($name, 'UTF-8') : strtolower($name);
}

/**
 * Return an error message if the name is unusable, or null if it's OK.
 * (Does not check uniqueness — see name_taken.)
 */
function name_problem(string $name): ?string
{
    $length = function_exists('mb_strlen') ? mb_strlen($name, 'UTF-8') : strlen($name);
    if ($length === 0) {
        return 'Please enter a name.';
    }
    if ($length > 30) {
        return 'Names can be at most 30 characters.';
    }
    return null;
}

/**
 * True if an entry with this name (case-insensitive) already exists.
 */
function name_taken(array $store, string $name): bool
{
    $key = name_key($name);
    foreach ($store['entries'] as $entry) {
        if (name_key($entry['name']) === $key) {
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// 6. Roster validation
// ---------------------------------------------------------------------------

/**
 * Check a submitted list of player ids and turn it into stored picks.
 *
 * Returns ['picks' => [...], 'pitcherCount' => n] or sends a JSON error.
 * The pitcher count is recomputed here from the ids — never taken from the
 * client (SPEC §5).
 */
function build_roster($playerIds): array
{
    if (!is_array($playerIds)) {
        json_error('Missing player list.');
    }
    $ids = array_map('intval', $playerIds);

    if (count($ids) !== ROSTER_SIZE) {
        json_error('A roster must have exactly ' . ROSTER_SIZE . ' players (got ' . count($ids) . ').');
    }
    if (count(array_unique($ids)) !== count($ids)) {
        json_error('The same player was picked twice.');
    }

    $pool = pool_by_id();
    $picks = [];
    $pitcherCount = 0;
    foreach ($ids as $id) {
        if (!isset($pool[$id])) {
            json_error('One of the picked players is no longer on the 40-man roster. Reload the page and try again.');
        }
        $player = $pool[$id];
        // Snapshot name/label so the entry still reads correctly if this
        // player later leaves the 40-man roster.
        $picks[] = [
            'id'    => $player['id'],
            'name'  => $player['name'],
            'group' => $player['group'],
            'label' => $player['label'],
        ];
        if ($player['group'] === 'P') {
            $pitcherCount++;
        }
    }
    return ['picks' => $picks, 'pitcherCount' => $pitcherCount];
}

/**
 * Check a Game 1 total-runs number (a player's tie-breaker guess, or the
 * admin's actual result) and return it as an int, or send a JSON error.
 *
 * Accepts a JSON number or a string of digits, 0 to MAX_RUNS. Anything else
 * (decimals, negatives, true/false, blank) is rejected. The explicit type
 * check matters: filter_var alone would turn JSON `true` into 1.
 */
function parse_runs($value, string $whatForErrors): int
{
    $looksLikeInt = is_int($value) || (is_string($value) && ctype_digit($value));
    $runs = $looksLikeInt
        ? filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => MAX_RUNS]])
        : false;
    if ($runs === false) {
        json_error($whatForErrors . ' must be a whole number from 0 to ' . MAX_RUNS . '.');
    }
    return $runs;
}

// ---------------------------------------------------------------------------
// 7. Scoring
// ---------------------------------------------------------------------------

/**
 * Score and rank every entry against the actual roster (SPEC §6).
 *
 *   score        = number of picks that are on the actual roster
 *   tie-break 1  = smallest |runs guess - actual Game 1 total runs|
 *   tie-break 2  = earliest submission
 *
 * $game1Runs is null until the admin enters the Game 1 result (the roster
 * is announced before Game 1 is played). Until then tie-break 1 is skipped
 * and each row's runsDiff is null.
 *
 * Because the tie-breaks end on a timestamp, every entry gets a distinct
 * rank. Each pick is marked hit: true/false, and each entry lists the actual
 * players it missed. Computed on every read, so fixing the actual roster
 * or the runs re-scores everyone.
 */
function scoreboard(array $entries, array $actual, ?int $game1Runs): array
{
    $actualIds = [];
    foreach ($actual['players'] as $player) {
        $actualIds[$player['id']] = true;
    }

    $rows = [];
    foreach ($entries as $entry) {
        $score = 0;
        $pickedIds = [];
        foreach ($entry['picks'] as &$pick) {
            $pick['hit'] = isset($actualIds[$pick['id']]);
            if ($pick['hit']) {
                $score++;
            }
            $pickedIds[$pick['id']] = true;
        }
        unset($pick);   // break the reference left by foreach-by-reference

        // Actual roster players this entry didn't pick.
        $missed = array_values(array_filter($actual['players'], function ($p) use ($pickedIds) {
            return !isset($pickedIds[$p['id']]);
        }));

        // How far off the runs guess was. null when the result isn't in yet,
        // or for an entry saved before the runs guess existed.
        $hasGuess = isset($entry['runsGuess']);
        $entry['runsDiff'] = ($game1Runs !== null && $hasGuess)
            ? abs($entry['runsGuess'] - $game1Runs)
            : null;

        $entry['score']  = $score;
        $entry['missed'] = $missed;
        $rows[] = $entry;
    }

    // For sorting, "no runsDiff" counts as infinitely far off. Before the
    // result is entered that's true of every row, so ties fall straight
    // through to earliest submission.
    $diffForSort = function ($row) {
        return $row['runsDiff'] === null ? PHP_INT_MAX : $row['runsDiff'];
    };
    usort($rows, function ($a, $b) use ($diffForSort) {
        return [$b['score'], $diffForSort($a), submission_time($a)]
           <=> [$a['score'], $diffForSort($b), submission_time($b)];
    });

    foreach ($rows as $i => &$row) {
        $row['rank'] = $i + 1;
    }
    unset($row);
    return $rows;
}

// ---------------------------------------------------------------------------
// 8. Admin auth
// ---------------------------------------------------------------------------

/**
 * Stop with 403 unless the request carries the right admin key in the
 * X-Admin-Key header. hash_equals compares in constant time so the key
 * can't be guessed character-by-character from response timing.
 */
function require_admin(): void
{
    $given = $_SERVER['HTTP_X_ADMIN_KEY'] ?? '';
    // Refuse outright if the key was never changed from the template.
    if (ADMIN_KEY === '' || ADMIN_KEY === 'CHANGE-ME') {
        json_error('Admin is disabled until ADMIN_KEY is set in config.php.', 403);
    }
    if (!is_string($given) || !hash_equals(ADMIN_KEY, $given)) {
        json_error('Not authorized.', 403);
    }
}
