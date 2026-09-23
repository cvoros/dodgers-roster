<?php
/**
 * GET api/roster.php — the Dodgers 40-man player pool.
 *
 * Proxies the MLB Stats API through our server (cached, see get_pool in
 * lib.php) so the browser never depends on MLB's CORS rules, and so the
 * server validates submissions against exactly the list players saw.
 *
 * Response: { players: [...], fetchedAt: iso, stale: bool }
 */
require __DIR__ . '/lib.php';
require_method('GET');

json_out(get_pool());
