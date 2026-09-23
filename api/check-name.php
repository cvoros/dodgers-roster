<?php
/**
 * GET api/check-name.php?name=... — is this name free?
 *
 * Called when a player presses Continue on the name screen, so they learn
 * about a duplicate before building a roster. submit.php checks again under
 * the file lock, because someone could take the name in between.
 *
 * Response: { name: cleaned name, available: bool, reason: string|null }
 */
require __DIR__ . '/lib.php';
require_method('GET');

if (is_locked()) {
    json_error('Submissions are closed.', 403);
}

$name = clean_name($_GET['name'] ?? '');
$problem = name_problem($name);
if ($problem !== null) {
    json_out(['name' => $name, 'available' => false, 'reason' => $problem]);
}

$taken = name_taken(read_store(), $name);
json_out([
    'name'      => $name,
    'available' => !$taken,
    'reason'    => $taken ? 'That name is already taken. Try adding a last initial.' : null,
]);
