<?php
/**
 * GET api/state.php — public game state.
 *
 * Response: { now, lockAt, timezone, locked, entryCount, names[], hasActual, hasGame1Runs }
 * Names are public before lock; picks never are (see entries.php).
 */
require __DIR__ . '/lib.php';
require_method('GET');

json_out(public_state(read_store()));
