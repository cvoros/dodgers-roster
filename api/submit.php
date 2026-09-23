<?php
/**
 * POST api/submit.php — submit a final roster.
 *
 * Body:     { name: string, playerIds: [26 MLB player ids], runsGuess: int }
 * Response: 201 with the stored entry, or 4xx { error }.
 *
 * Everything is re-checked on the server (SPEC §5): lock time, name, roster
 * size, duplicates, ids on the 40-man, the runs guess (tie-breaker), and the
 * pitcher count is recomputed.
 * Entries are final — there is no edit endpoint.
 */
require __DIR__ . '/lib.php';
require_method('POST');

if (is_locked()) {
    json_error('Sorry — submissions are closed.', 403);
}

$body = read_json_body();

$name = clean_name($body['name'] ?? '');
$problem = name_problem($name);
if ($problem !== null) {
    json_error($problem);
}

// Validate the roster BEFORE taking the write lock: it may call MLB, which
// can take seconds, and other requests shouldn't wait on that.
$roster = build_roster($body['playerIds'] ?? null);

// Tie-breaker: total runs (both teams) in Game 1. Required.
$runsGuess = parse_runs($body['runsGuess'] ?? null, 'Your Game 1 runs guess');

$entry = with_store(true, function (array &$store) use ($name, $roster, $runsGuess) {
    // Re-check under the exclusive lock: this is the check that actually
    // guarantees two people can't both claim the same name.
    if (name_taken($store, $name)) {
        json_error('That name was just taken by someone else. Pick another name — your roster is still here.', 409);
    }
    // Re-check the lock too, in case the clock ticked past it meanwhile.
    if (is_locked()) {
        json_error('Sorry — submissions are closed.', 403);
    }
    $entry = [
        'name'         => $name,
        'submittedAt'  => now_iso(),
        'pitcherCount' => $roster['pitcherCount'],   // shown for info; not a tie-breaker
        'runsGuess'    => $runsGuess,
        'picks'        => $roster['picks'],
    ];
    $store['entries'][] = $entry;
    return $entry;
});

json_out($entry, 201);
