/*
 * admin.js — the admin page (admin.html?key=...).
 *
 * - Reads the admin key from the URL and sends it with every admin call in
 *   the X-Admin-Key header (a header, so it isn't written to server access
 *   logs the way a query string would be).
 * - Shows every entry, even before lock, with a Delete button on each.
 * - Lets the admin enter the actual 26-man roster with the same RosterPicker
 *   players use, optionally pre-filled from MLB's active roster.
 * - Once the actual roster is saved, shows the ranked scoreboard.
 *
 * Depends on common.js.
 */

'use strict';

const $ = (id) => document.getElementById(id);

const adminKey = new URLSearchParams(location.search).get('key') || '';
let picker = null;
let timeZone = 'America/Denver';

/** api() with the admin key attached. */
function adminApi(query, options = {}) {
  return api('admin.php' + query, Object.assign({}, options, {
    headers: { 'X-Admin-Key': adminKey },
  }));
}

async function init() {
  if (!adminKey) {
    showAuthError('Missing key. Open this page as admin.html?key=YOUR_KEY.');
    return;
  }

  let overview;
  let pool;
  try {
    // Overview first: it's the call that proves the key is right.
    overview = await adminApi('?action=overview');
    pool = await api('roster.php');
  } catch (error) {
    showAuthError(error.message);
    return;
  }

  $('admin-main').hidden = false;
  picker = new RosterPicker({
    players: pool.players,
    poolEl: $('pool'),
    slotsEl: $('slots'),
    countEl: $('pick-count'),
    onChange: () => { $('save-actual').disabled = !picker.isFull(); },
  });
  // Pre-fill the picker with the saved actual roster, if there is one.
  if (overview.actual) {
    picker.setIds(overview.actual.players.map((p) => p.id));
  }
  render(overview);
}

function showAuthError(message) {
  $('auth-error').textContent = message;
  $('auth-error').hidden = false;
}

/** Draw status line, entries/scoreboard, and actual-roster status. */
function render(overview) {
  const state = overview.state;
  timeZone = state.timezone;

  const lockText = state.lockAt
    ? (state.locked ? 'Locked since ' : 'Locks ') + formatTime(state.lockAt, timeZone)
    : 'Lock time not set (LOCK_AT in config.php)';
  $('admin-status').textContent = lockText + ' · ' + state.entryCount + ' entries';

  if (overview.scoreboard) {
    $('entries-heading').textContent = 'Scoreboard';
    $('entries').replaceChildren(renderScoreboard(overview.scoreboard, overview.actual, overview.game1Runs, timeZone, deleteButton));
  } else {
    $('entries-heading').textContent = 'Entries (' + overview.entries.length + ')';
    $('entries').replaceChildren(
      el('p', { className: 'muted small' }, ['Save the actual roster below to see the scoreboard.']),
      renderEntryList(overview.entries, timeZone, deleteButton),
    );
  }

  $('actual-status').textContent = overview.actual
    ? 'Saved ' + formatTime(overview.actual.savedAt, timeZone) + ' · ' + overview.actual.pitcherCount +
      ' pitchers. Change the picks below and save again to correct it; scores update automatically.'
    : 'Not entered yet.';

  // Game 1 runs: show the saved value, and pre-fill the box with it.
  const runs = overview.game1Runs;
  $('runs-status').textContent = runs === null
    ? 'Not entered yet. Enter it after Game 1 ends; until then ties are broken by earliest entry.'
    : 'Saved: ' + runs + ' runs. Ties are broken by closest guess to this.';
  $('admin-runs-input').value = runs === null ? '' : String(runs);
}

/** Save (or, with null, clear) the Game 1 total runs. */
async function saveRuns(runs) {
  const message = $('runs-message');
  try {
    await adminApi('', { method: 'POST', body: { action: 'saveGame1Runs', runs } });
    message.textContent = runs === null ? 'Cleared.' : 'Saved.';
    await refresh();
  } catch (error) {
    message.textContent = error.message;
  }
}

$('save-runs').addEventListener('click', () => {
  const text = $('admin-runs-input').value.trim();
  if (!/^\d{1,2}$/.test(text)) {
    $('runs-message').textContent = 'Enter a whole number from 0 to 99.';
    return;
  }
  saveRuns(Number(text));
});

$('clear-runs').addEventListener('click', () => {
  if (confirm('Clear the Game 1 runs? Tie-breaks go back to earliest entry.')) saveRuns(null);
});

/** Re-fetch everything after a change. */
async function refresh() {
  render(await adminApi('?action=overview'));
}

/** Delete control shown inside each expanded entry. */
function deleteButton(entry) {
  return el('button', {
    type: 'button',
    className: 'btn danger small-btn',
    textContent: 'Delete entry',
    onclick: async () => {
      if (!confirm('Delete ' + entry.name + '\'s entry? This cannot be undone.')) return;
      try {
        await adminApi('', { method: 'POST', body: { action: 'deleteEntry', name: entry.name } });
        await refresh();
      } catch (error) {
        alert(error.message);
      }
    },
  });
}

// Pre-fill the picker from MLB's active roster. Nothing is saved until the
// admin reviews it and presses Save (MLB may lag the postseason announcement).
$('pull-mlb').addEventListener('click', async () => {
  const message = $('actual-message');
  message.textContent = 'Asking MLB…';
  try {
    const result = await adminApi('?action=pullActive');
    // setIds silently stops at 26, so report what actually landed.
    picker.setIds(result.playerIds);
    const loaded = picker.getIds().length;
    let text = 'Loaded ' + loaded + ' players from MLB. Review, then Save.';
    if (result.count !== ROSTER_SIZE) {
      text += ' Note: MLB lists ' + result.count + ' active players, not ' + ROSTER_SIZE + '.';
    }
    if (result.playerIds.length > ROSTER_SIZE) {
      text += ' Only the first ' + ROSTER_SIZE + ' (alphabetically) were loaded — fix up by hand.';
    }
    if (result.unknown.length) text += ' Not on the 40-man list: ' + result.unknown.join(', ') + '.';
    message.textContent = text;
  } catch (error) {
    message.textContent = error.message;
  }
});

$('save-actual').addEventListener('click', async () => {
  if (!confirm('Save these 26 as the actual NLDS roster? Everyone will be scored against it.')) return;
  const message = $('actual-message');
  try {
    await adminApi('', { method: 'POST', body: { action: 'saveActual', playerIds: picker.getIds() } });
    message.textContent = 'Saved.';
    await refresh();
  } catch (error) {
    message.textContent = error.message;
  }
});

init();
