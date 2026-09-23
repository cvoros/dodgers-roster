/*
 * app.js — the player page (index.html).
 *
 * Flow before lock:  name screen → picker → confirm modal → "You're in"
 * Flow after lock:   results screen (all entries, scoreboard once scored)
 *
 * Depends on common.js (api, el, RosterPicker, render helpers).
 *
 * Browser storage (localStorage) is a convenience only:
 *   - DRAFT_KEY    in-progress name + picks, so a refresh doesn't lose work
 *   - ENTRY_KEY    your submitted entry, so you can see it again before lock
 *                  (the server won't reveal picks to anyone until lock)
 * The server is always the source of truth.
 */

'use strict';

const DRAFT_KEY = 'nlds2026.draft';
const ENTRY_KEY = 'nlds2026.myEntry';

// Page-wide state, filled in by init().
let gameState = null;      // from api/state.php
let clockOffsetMs = 0;     // server clock minus this device's clock
let picker = null;         // RosterPicker, created on first visit to the picker
let playerName = '';       // the name the player chose (cleaned by the server)

/** Shorthand for document.getElementById. */
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// localStorage helpers — wrapped in try/catch because storage can be blocked
// (private browsing, strict settings). The game must still work without it.
// ---------------------------------------------------------------------------

function loadJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch (e) {
    return null;
  }
}

function saveJson(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // Storage unavailable: ignore, it's only a convenience.
  }
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

/** Show one .screen section and hide the rest. */
function showScreen(id) {
  for (const screen of document.querySelectorAll('.screen')) {
    screen.hidden = screen.id !== id;
  }
  // Instructions show only while someone can still enter.
  $('rules').hidden = !(id === 'screen-name' || id === 'screen-pick');
  window.scrollTo(0, 0);
}

function showFatal(message) {
  $('fatal-error').textContent = message;
  showScreen('screen-error');
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function init() {
  try {
    gameState = await api('state.php');
  } catch (error) {
    showFatal(error.message);
    return;
  }

  // Countdown math uses the server's clock, not the phone's (which may be off).
  clockOffsetMs = Date.parse(gameState.now) - Date.now();
  updateLockBanner();
  setInterval(updateLockBanner, 30 * 1000);

  if (gameState.locked) {
    showResults();
    return;
  }

  // Already submitted on this device? Show it — unless the admin removed the
  // entry, in which case forget it and let them enter again.
  const myEntry = loadJson(ENTRY_KEY);
  if (myEntry) {
    const stillThere = gameState.names.some((n) => n.toLowerCase() === myEntry.name.toLowerCase());
    if (stillThere) {
      showDone(myEntry);
      return;
    }
    saveJson(ENTRY_KEY, null);
  }

  showNameScreen();
}

/**
 * Top banner: countdown before lock, "closed" after. When the countdown
 * hits zero, reload so the page switches to the results view.
 */
function updateLockBanner() {
  const banner = $('lock-banner');
  if (!gameState.lockAt) {
    banner.textContent = 'Entries open · lock time to be announced';
    return;
  }
  const msLeft = Date.parse(gameState.lockAt) - (Date.now() + clockOffsetMs);
  if (gameState.locked || msLeft <= 0) {
    banner.textContent = 'Entries closed ' + formatTime(gameState.lockAt, gameState.timezone);
    banner.classList.add('closed');
    if (!gameState.locked) location.reload();   // just ticked over
    return;
  }
  banner.textContent = 'Entries lock ' + formatTime(gameState.lockAt, gameState.timezone) +
    ' · ' + formatCountdown(msLeft) + ' left';
}

// ---------------------------------------------------------------------------
// Step 1: name
// ---------------------------------------------------------------------------

function showNameScreen(errorMessage) {
  const draft = loadJson(DRAFT_KEY);
  if (!$('name-input').value && draft && draft.name) {
    $('name-input').value = draft.name;
  }
  $('name-error').textContent = errorMessage || '';

  // Show who's already in, so people can avoid their friends' names.
  const names = gameState.names;
  $('entrant-list').textContent = names.length
    ? names.length + ' in so far: ' + names.join(', ')
    : 'Nobody has entered yet. Be the first!';

  showScreen('screen-name');
  $('name-input').focus();
}

$('name-form').addEventListener('submit', async (event) => {
  event.preventDefault();   // stay on the page; we handle it in JS
  const button = $('name-continue');
  button.disabled = true;
  $('name-error').textContent = '';
  try {
    const result = await api('check-name.php?name=' + encodeURIComponent($('name-input').value));
    if (!result.available) {
      $('name-error').textContent = result.reason;
      return;
    }
    playerName = result.name;
    await showPicker();
  } catch (error) {
    if (error.status === 403) location.reload();   // locked meanwhile
    $('name-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('change-name').addEventListener('click', () => showNameScreen());

// ---------------------------------------------------------------------------
// Step 2: picker
// ---------------------------------------------------------------------------

async function showPicker() {
  $('picking-name').textContent = playerName;

  // Load the pool and build the picker the first time only.
  if (!picker) {
    const pool = await api('roster.php');
    picker = new RosterPicker({
      players: pool.players,
      poolEl: $('pool'),
      slotsEl: $('slots'),
      countEl: $('pick-count'),
      onChange: onPicksChanged,
    });
    const draft = loadJson(DRAFT_KEY);
    if (draft && Array.isArray(draft.ids)) picker.setIds(draft.ids);
    onPicksChanged(picker);

    $('roster-note').textContent = pool.stale
      ? 'Heads up: MLB could not be reached, so this roster is from ' + formatTime(pool.fetchedAt, gameState.timezone) + '.'
      : '';
  }
  saveDraft();
  showScreen('screen-pick');
}

/** Runs after every add/remove: tie-breaker, Play Ball button, draft. */
function onPicksChanged(currentPicker) {
  $('tiebreak-value').textContent = String(currentPicker.pitcherCount());
  $('play-ball').disabled = !currentPicker.isFull();
  saveDraft();
}

function saveDraft() {
  saveJson(DRAFT_KEY, { name: playerName || $('name-input').value, ids: picker ? picker.getIds() : [] });
}

// Mobile: the roster panel is a sticky bar; this expands/collapses its slots.
$('toggle-slots').addEventListener('click', () => {
  const panel = document.querySelector('.roster-panel');
  const open = panel.classList.toggle('open');
  $('toggle-slots').setAttribute('aria-expanded', String(open));
  $('toggle-slots').textContent = open ? 'Hide my roster ▴' : 'Show my roster ▾';
});

// ---------------------------------------------------------------------------
// Step 3: confirm + submit
// ---------------------------------------------------------------------------

$('play-ball').addEventListener('click', () => {
  if (!picker.isFull()) return;
  const picks = picker.getIds().map((id) => picker.byId.get(id));
  $('confirm-roster').replaceChildren(
    el('p', { className: 'small' }, [
      playerName + ' · ' + picker.pitcherCount() + ' pitchers (tie-breaker)',
    ]),
    renderRosterLists(picks),
  );
  $('confirm-error').textContent = '';
  $('confirm-dialog').showModal();
});

$('confirm-back').addEventListener('click', () => $('confirm-dialog').close());

$('confirm-submit').addEventListener('click', async () => {
  const button = $('confirm-submit');
  button.disabled = true;
  try {
    const entry = await api('submit.php', {
      method: 'POST',
      body: { name: playerName, playerIds: picker.getIds() },
    });
    saveJson(ENTRY_KEY, entry);
    saveJson(DRAFT_KEY, null);
    $('confirm-dialog').close();
    showDone(entry);
  } catch (error) {
    if (error.status === 409) {
      // Someone grabbed the name first. Picks are kept (still in the picker
      // and the draft); just ask for a new name.
      $('confirm-dialog').close();
      $('name-input').value = '';
      showNameScreen(error.message);
    } else if (error.status === 403) {
      $('confirm-error').textContent = error.message;
      setTimeout(() => location.reload(), 2500);   // locked: go to results
    } else {
      $('confirm-error').textContent = error.message;
    }
  } finally {
    button.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Done + results
// ---------------------------------------------------------------------------

function showDone(entry) {
  $('done-name').textContent = entry.name;
  $('done-roster').replaceChildren(
    el('p', { className: 'small' }, [
      'Submitted ' + formatTime(entry.submittedAt, gameState.timezone) +
      ' · ' + entry.pitcherCount + ' pitchers (tie-breaker)',
    ]),
    renderRosterLists(entry.picks),
  );
  showScreen('screen-done');
}

/** After lock: scoreboard if the real roster is in, otherwise all entries. */
async function showResults() {
  showScreen('screen-results');
  const container = $('results');
  container.replaceChildren(el('p', { className: 'muted' }, ['Loading entries…']));
  let data;
  try {
    data = await api('entries.php');
  } catch (error) {
    container.replaceChildren(el('p', { className: 'error' }, [error.message]));
    return;
  }

  if (data.scoreboard) {
    container.replaceChildren(
      el('h2', {}, ['Final standings']),
      renderScoreboard(data.scoreboard, data.actual, gameState.timezone),
      el('details', { className: 'card actual' }, [
        el('summary', {}, ['The actual NLDS roster']),
        renderRosterLists(data.actual.players),
      ]),
    );
  } else {
    container.replaceChildren(
      el('h2', {}, ['All entries (' + data.entries.length + ')']),
      el('p', { className: 'muted' }, ['Scores appear here once the real roster is announced. Tap a name to see their picks.']),
      renderEntryList(data.entries, gameState.timezone),
    );
  }
}

init();
