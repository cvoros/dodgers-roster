<?php
/**
 * api/admin.php — admin actions. Every request needs the X-Admin-Key header.
 *
 * GET  ?action=overview    → { state, entries, actual, scoreboard }
 *                            (all entries, even before lock)
 * GET  ?action=pullActive  → { playerIds, unknown[], count } from MLB's active
 *                            roster, to pre-fill the picker. Nothing is saved.
 * POST { action: "saveActual",  playerIds: [26 ids] } → save the real roster
 * POST { action: "deleteEntry", name: "..." }         → remove one entry
 */
require __DIR__ . '/lib.php';
require_method('GET', 'POST');
require_admin();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = $_GET['action'] ?? '';

    if ($action === 'overview') {
        $store = read_store();
        json_out([
            'state'      => public_state($store),
            'entries'    => sorted_by_submission($store['entries']),
            'actual'     => $store['actual'],
            'scoreboard' => $store['actual'] ? scoreboard($store['entries'], $store['actual']) : null,
        ]);
    }

    if ($action === 'pullActive') {
        $active = fetch_mlb_roster('active');
        if ($active === null) {
            json_error('Could not reach MLB. Try again, or enter the roster by hand.', 503);
        }
        // The picker only knows 40-man players; report anyone it can't show.
        $pool = pool_by_id();
        $ids = [];
        $unknown = [];
        foreach ($active as $player) {
            if (isset($pool[$player['id']])) {
                $ids[] = $player['id'];
            } else {
                $unknown[] = $player['label'];
            }
        }
        json_out(['playerIds' => $ids, 'unknown' => $unknown, 'count' => count($active)]);
    }

    json_error('Unknown action.');
}

// ---- POST actions ----
$body = read_json_body();
$action = $body['action'] ?? '';

if ($action === 'saveActual') {
    // Same validation as a player's entry: 26 unique 40-man players.
    $roster = build_roster($body['playerIds'] ?? null);
    $actual = [
        'savedAt'      => now_iso(),
        'pitcherCount' => $roster['pitcherCount'],
        'players'      => $roster['picks'],
    ];
    with_store(true, function (array &$store) use ($actual) {
        $store['actual'] = $actual;
    });
    json_out(['ok' => true, 'actual' => $actual]);
}

if ($action === 'deleteEntry') {
    $name = clean_name($body['name'] ?? '');
    $deleted = with_store(true, function (array &$store) use ($name) {
        $before = count($store['entries']);
        // Exact match: the admin clicked Delete on one specific entry.
        $store['entries'] = array_values(array_filter($store['entries'], function ($e) use ($name) {
            return $e['name'] !== $name;
        }));
        return $before - count($store['entries']);
    });
    if ($deleted === 0) {
        json_error('No entry with that name.', 404);
    }
    json_out(['ok' => true]);
}

json_error('Unknown action.');
