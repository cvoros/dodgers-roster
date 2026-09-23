/*
 * common.js — code shared by the player page (app.js) and admin page (admin.js).
 *
 * Contents:
 *   - api():            fetch wrapper for our PHP endpoints
 *   - el():             tiny helper for building DOM nodes safely
 *   - formatting:       times in Mountain Time, countdowns
 *   - RosterPicker:     the tap-to-pick 26-man roster component
 *   - renderEntryList / renderScoreboard: read-only views of entries
 *
 * No frameworks: everything is plain DOM. User-supplied text (names) is only
 * ever set with textContent, never innerHTML, so nobody can inject HTML.
 */

'use strict';

/** Size of the roster being predicted. Must match ROSTER_SIZE in api/lib.php. */
const ROSTER_SIZE = 26;

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Call one of our API endpoints and return the parsed JSON.
 *
 *   path    e.g. 'state.php' or 'check-name.php?name=Chris'
 *   options { method, body (object → JSON), headers }
 *
 * Throws an Error whose message is the server's human-readable `error` text,
 * so callers can show it directly. err.status carries the HTTP status.
 */
async function api(path, options = {}) {
  const init = {
    method: options.method || 'GET',
    headers: Object.assign({}, options.headers),
  };
  if (options.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  let response;
  try {
    response = await fetch('api/' + path, init);
  } catch (networkError) {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }

  // Some hosting errors return HTML, not JSON — handle that gracefully.
  let data = null;
  try {
    data = await response.json();
  } catch (parseError) {
    data = null;
  }

  if (!response.ok) {
    const error = new Error((data && data.error) || 'Server error (' + response.status + ').');
    error.status = response.status;
    throw error;
  }
  return data;
}

// ---------------------------------------------------------------------------
// DOM helper
// ---------------------------------------------------------------------------

/**
 * Create an element in one line.
 *
 *   el('button', { className: 'slot', onclick: fn }, ['Tyler Glasnow RHP'])
 *
 * props are assigned as element properties (className, textContent, onclick,
 * disabled, ...), except keys starting with 'data-' or 'aria-', which become
 * attributes. children may be strings (added as safe text nodes), nodes, or
 * null/false (skipped — handy for conditional children).
 */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('data-') || key.startsWith('aria-')) {
      node.setAttribute(key, value);
    } else {
      node[key] = value;
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

/**
 * Format an ISO time for display in the game's time zone (Mountain Time),
 * whatever time zone the viewer's phone is in. E.g. "Sat, Oct 4, 10:00 AM MDT".
 */
function formatTime(iso, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'America/Denver',
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(iso));
}

/**
 * Human countdown for a number of milliseconds: "2d 3h", "4h 12m", "9m".
 */
function formatCountdown(ms) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return days + 'd ' + hours + 'h';
  if (hours > 0) return hours + 'h ' + mins + 'm';
  return mins + 'm';
}

// ---------------------------------------------------------------------------
// RosterPicker — the tap-to-pick component
// ---------------------------------------------------------------------------

/**
 * Renders the player pool (Pitchers / Position Players) and the 26 roster
 * slots, and keeps them in sync. Used by both the player page and the admin
 * "actual roster" page, so both sides group players identically (important
 * for the pitcher-count tie-breaker).
 *
 * Interaction (SPEC §4.3):
 *   - tap a pool player  → added to the next open slot of their group
 *   - tap a filled slot  → removed, player returns to the pool
 *   - tapping a picked player in the pool also removes them (a natural undo)
 *   - total is capped at 26; the P / POS split is up to the user
 *
 * Usage:
 *   const picker = new RosterPicker({
 *     players,                    // from api/roster.php
 *     poolEl, slotsEl, countEl,   // containers to render into
 *     onChange(picker) { ... },   // called after every add/remove
 *   });
 *   picker.getIds(); picker.setIds([...]); picker.pitcherCount();
 */
class RosterPicker {
  constructor({ players, poolEl, slotsEl, countEl, onChange }) {
    this.players = players;
    this.byId = new Map(players.map((p) => [p.id, p]));
    this.poolEl = poolEl;
    this.slotsEl = slotsEl;
    this.countEl = countEl;
    this.onChange = onChange || (() => {});
    // Picked player ids in the order they were picked (so "next open slot"
    // really is the next one down the list).
    this.picked = [];
    this.render();
  }

  /** Ids of picked players, in pick order. */
  getIds() {
    return this.picked.slice();
  }

  /**
   * Replace the picks (e.g. restoring a saved draft). Ids that aren't in the
   * pool — say a player was dropped from the 40-man — are silently skipped.
   */
  setIds(ids) {
    this.picked = [];
    for (const id of ids) {
      if (this.byId.has(id) && !this.picked.includes(id) && this.picked.length < ROSTER_SIZE) {
        this.picked.push(id);
      }
    }
    this.changed();
  }

  /** Picked Player objects for one group ('P' or 'POS'). */
  pickedInGroup(group) {
    return this.picked.map((id) => this.byId.get(id)).filter((p) => p.group === group);
  }

  pitcherCount() {
    return this.pickedInGroup('P').length;
  }

  isFull() {
    return this.picked.length >= ROSTER_SIZE;
  }

  /** Add or remove a player — the pool's tap handler. */
  toggle(id) {
    if (this.picked.includes(id)) {
      this.remove(id);
    } else if (this.isFull()) {
      this.flashFull();
    } else {
      this.picked.push(id);
      this.changed();
    }
  }

  remove(id) {
    this.picked = this.picked.filter((pickedId) => pickedId !== id);
    this.changed();
  }

  /** Re-render and notify the page after any change. */
  changed() {
    this.render();
    this.onChange(this);
  }

  /** Briefly highlight the count when someone taps while the roster is full. */
  flashFull() {
    this.countEl.classList.remove('flash');
    // Reading offsetWidth forces a reflow so the CSS animation restarts.
    void this.countEl.offsetWidth;
    this.countEl.classList.add('flash');
  }

  render() {
    this.renderCount();
    this.renderPool();
    this.renderSlots();
  }

  /** "14 P / 12 POS · 26 / 26" */
  renderCount() {
    const pitchers = this.pitcherCount();
    const positions = this.picked.length - pitchers;
    this.countEl.textContent =
      pitchers + ' P / ' + positions + ' POS · ' + this.picked.length + ' / ' + ROSTER_SIZE;
    this.countEl.classList.toggle('complete', this.isFull());
  }

  /** The left side: every player, grouped, picked ones marked. */
  renderPool() {
    const groups = [
      ['P', 'Pitchers'],
      ['POS', 'Position Players'],
    ];
    const sections = groups.map(([group, title]) => {
      const inGroup = this.players.filter((p) => p.group === group);
      const buttons = inGroup.map((player) => {
        const isPicked = this.picked.includes(player.id);
        return el('button', {
          type: 'button',
          className: 'pool-player' + (isPicked ? ' picked' : ''),
          onclick: () => this.toggle(player.id),
          'aria-pressed': String(isPicked),
        }, [
          el('span', { className: 'label', textContent: player.label }),
          statusTag(player.status),
        ]);
      });
      return el('section', { className: 'pool-group' }, [
        el('h3', {}, [title + ' (' + inGroup.length + ')']),
        el('div', { className: 'pool-list' }, buttons),
      ]);
    });
    this.poolEl.replaceChildren(...sections);
  }

  /** The right side: filled slots per group, plus an open slot to tap into. */
  renderSlots() {
    const groups = [
      ['P', 'Pitchers', 'Tap a pitcher to add'],
      ['POS', 'Position Players', 'Tap a position player to add'],
    ];
    const sections = groups.map(([group, title, hint]) => {
      const players = this.pickedInGroup(group);
      const slots = players.map((player, index) =>
        el('button', {
          type: 'button',
          className: 'slot filled',
          onclick: () => this.remove(player.id),
          title: 'Tap to remove',
        }, [
          el('span', { className: 'slot-num', textContent: String(index + 1) }),
          el('span', { className: 'label', textContent: player.label }),
          el('span', { className: 'remove', 'aria-hidden': 'true', textContent: '×' }),
        ]));
      // One dashed "open slot" per group while there's room left.
      if (!this.isFull()) {
        slots.push(el('div', { className: 'slot open' }, [hint]));
      }
      return el('section', { className: 'slot-group' }, [
        el('h3', {}, [title + ' (' + players.length + ')']),
        el('div', { className: 'slot-list' }, slots),
      ]);
    });
    const openCount = ROSTER_SIZE - this.picked.length;
    const footer = el('p', { className: 'slots-left' }, [
      openCount === 0 ? 'Roster full.' : openCount + ' open slot' + (openCount === 1 ? '' : 's') + ' left',
    ]);
    this.slotsEl.replaceChildren(...sections, footer);
  }
}

/**
 * Small tag for non-active players ("Injured 60-Day", "Reassigned to Minors")
 * — useful info when predicting. Returns null for active players.
 */
function statusTag(status) {
  if (!status || status === 'Active') return null;
  return el('span', { className: 'status-tag', textContent: status });
}

// ---------------------------------------------------------------------------
// Read-only views: entry list (before scoring) and scoreboard (after)
// ---------------------------------------------------------------------------

/**
 * A roster as two labelled lists. If picks carry `hit` (from scoring), each
 * line gets a ✓ or ✗.
 */
function renderRosterLists(picks) {
  const groups = [['P', 'Pitchers'], ['POS', 'Position Players']];
  return el('div', { className: 'roster-lists' }, groups.map(([group, title]) => {
    const inGroup = picks.filter((p) => p.group === group);
    return el('div', {}, [
      el('h4', {}, [title + ' (' + inGroup.length + ')']),
      el('ul', {}, inGroup.map((pick) => {
        const scored = typeof pick.hit === 'boolean';
        return el('li', { className: scored ? (pick.hit ? 'hit' : 'miss') : '' }, [
          scored ? el('span', { className: 'mark', textContent: pick.hit ? '✓' : '✗' }) : null,
          pick.label,
        ]);
      })),
    ]);
  }));
}

/**
 * List of entries (no scores yet), each expandable to show the roster.
 *   extraControls(entry) may return a node appended inside each entry
 *   (the admin page uses this for Delete buttons).
 */
function renderEntryList(entries, timeZone, extraControls) {
  if (entries.length === 0) {
    return el('p', { className: 'muted' }, ['No entries yet.']);
  }
  return el('div', { className: 'entry-list' }, entries.map((entry) =>
    el('details', { className: 'entry' }, [
      el('summary', {}, [
        el('span', { className: 'entry-name', textContent: entry.name }),
        el('span', { className: 'entry-meta', textContent: entry.pitcherCount + ' P · ' + formatTime(entry.submittedAt, timeZone) }),
      ]),
      renderRosterLists(entry.picks),
      extraControls ? extraControls(entry) : null,
    ])));
}

/**
 * Ranked scoreboard. Each row expands to show that entry's hits and misses
 * and the actual players they left out.
 */
function renderScoreboard(rows, actual, timeZone, extraControls) {
  const header = el('p', { className: 'muted' }, [
    'Actual roster: ' + actual.pitcherCount + ' pitchers / ' + (ROSTER_SIZE - actual.pitcherCount) +
    ' position players. Ties broken by closest pitcher count, then earliest entry.',
  ]);
  const list = el('ol', { className: 'scoreboard' }, rows.map((row) =>
    el('li', {}, [
      el('details', { className: 'entry' }, [
        el('summary', {}, [
          el('span', { className: 'rank', textContent: '#' + row.rank }),
          el('span', { className: 'entry-name', textContent: row.name }),
          el('span', { className: 'score', textContent: row.score + ' / ' + ROSTER_SIZE }),
          el('span', { className: 'entry-meta', textContent: 'P guess ' + row.pitcherCount + ' (off by ' + row.pitcherDiff + ')' }),
        ]),
        el('p', { className: 'muted small' }, ['Submitted ' + formatTime(row.submittedAt, timeZone)]),
        renderRosterLists(row.picks),
        row.missed.length
          ? el('div', { className: 'missed' }, [
            el('h4', {}, ['On the real roster, not picked (' + row.missed.length + ')']),
            el('ul', {}, row.missed.map((p) => el('li', {}, [p.label]))),
          ])
          : null,
        extraControls ? extraControls(row) : null,
      ]),
    ])));
  return el('div', {}, [header, list]);
}
