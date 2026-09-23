<?php
/**
 * GET api/entries.php — everyone's rosters, AFTER lock only.
 *
 * Before lock this refuses with 403, so nobody can peek at other picks
 * (SPEC §4.8). After lock:
 *   { entries: [...earliest first], actual: null|{...}, game1Runs: null|int,
 *     scoreboard: null|[...], result: null|{ status, names, ... } }
 * The scoreboard and result appear once the admin has entered the actual
 * roster; the runs tie-breaker applies once they've also entered the Game 1
 * result. See scoreboard() and scoreboard_result() in lib.php.
 */
require __DIR__ . '/lib.php';
require_method('GET');

if (!is_locked()) {
    json_error('Entries are hidden until submissions lock.', 403);
}

$store = read_store();
json_out(array_merge([
    'entries'   => sorted_by_submission($store['entries']),
    'actual'    => $store['actual'],
    'game1Runs' => $store['game1Runs'],
], results_payload($store)));
