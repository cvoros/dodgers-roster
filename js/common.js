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

/**
 * MLB rule: at most 13 pitchers on a postseason roster. Two-way players
 * (Ohtani, "TWP") don't count; they're in the Position Players group, so
 * counting the 'P' group is exactly right. Must match MAX_PITCHERS in
 * api/lib.php, which enforces it on the server.
 */
const MAX_PITCHERS = 13;

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
 * "actual roster" page, so both sides group players identically.
 *
 * Interaction (SPEC §4.3):
 *   - tap a pool player  → added to the next open slot of their group
 *   - tap a filled slot  → removed, player returns to the pool
 *   - tapping a picked player in the pool also removes them (a natural undo)
 *   - total is capped at 26, and pitchers at 13 (MLB rule, SPEC §3);
 *     otherwise the P / POS split is up to the user
 *   - a tap that would break a limit is refused with a short message
 *
 * Usage:
 *   const picker = new RosterPicker({
 *     players,                    // from api/roster.php
 *     poolEl, slotsEl, countEl,   // containers to render into
 *     messageEl,                  // optional: where "can't add" messages go
 *     onChange(picker) { ... },   // called after every add/remove
 *   });
 *   picker.getIds(); picker.setIds([...]); picker.pitcherCount();
 */
class RosterPicker {
  constructor({ players, poolEl, slotsEl, countEl, messageEl, onChange }) {
    this.players = players;
    this.byId = new Map(players.map((p) => [p.id, p]));
    this.poolEl = poolEl;
    this.slotsEl = slotsEl;
    this.countEl = countEl;
    this.messageEl = messageEl || null;
    this.messageTimer = null;
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
   * Replace the picks (e.g. restoring a saved draft). Ids that can't be
   * added are silently skipped: players no longer in the pool (dropped from
   * the 40-man), duplicates, and anything past the 26 / 13-pitcher limits
   * (e.g. a draft saved before the pitcher limit existed).
   */
  setIds(ids) {
    this.picked = [];
    for (const id of ids) {
      if (this.byId.has(id) && !this.picked.includes(id) && this.whyCantAdd(id) === null) {
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

  /** True when the 13-pitcher limit is reached. */
  pitchersFull() {
    return this.pitcherCount() >= MAX_PITCHERS;
  }

  /**
   * Why this (unpicked) player can't be added right now, as a message for
   * the user — or null if they can.
   */
  whyCantAdd(id) {
    if (this.isFull()) {
      return 'Roster full (' + ROSTER_SIZE + '). Tap a player in your roster to remove them first.';
    }
    if (this.byId.get(id).group === 'P' && this.pitchersFull()) {
      return 'MLB rule: max ' + MAX_PITCHERS + ' pitchers. Remove a pitcher to swap in another.';
    }
    return null;
  }

  /** Add or remove a player — the pool's tap handler. */
  toggle(id) {
    if (this.picked.includes(id)) {
      this.remove(id);
      return;
    }
    const problem = this.whyCantAdd(id);
    if (problem !== null) {
      this.refuse(problem);
      return;
    }
    this.picked.push(id);
    this.changed();
  }

  remove(id) {
    this.picked = this.picked.filter((pickedId) => pickedId !== id);
    this.changed();
  }

  /** Re-render and notify the page after any change. */
  changed() {
    this.showMessage('');   // any "can't add" message is out of date now
    this.render();
    this.onChange(this);
  }

  /**
   * A tap was refused (roster full, or pitcher limit). Flash the count and
   * say why, so it doesn't look like the tap just didn't register.
   */
  refuse(message) {
    this.countEl.classList.remove('flash');
    // Reading offsetWidth forces a reflow so the CSS animation restarts.
    void this.countEl.offsetWidth;
    this.countEl.classList.add('flash');
    this.showMessage(message);
  }

  /** Show a message in messageEl for a few seconds ('' clears it). */
  showMessage(message) {
    if (!this.messageEl) return;
    this.messageEl.textContent = message;
    clearTimeout(this.messageTimer);
    if (message) {
      this.messageTimer = setTimeout(() => { this.messageEl.textContent = ''; }, 4000);
    }
  }

  render() {
    this.renderCount();
    this.renderPool();
    this.renderSlots();
  }

  /** "13 P / 13 POS · 26 / 26" */
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
        // Dim unpicked players who can't be added right now (limit reached).
        // Still tappable, so the tap can explain why.
        const blocked = !isPicked && this.whyCantAdd(player.id) !== null;
        return el('button', {
          type: 'button',
          className: 'pool-player' + (isPicked ? ' picked' : '') + (blocked ? ' blocked' : ''),
          onclick: () => this.toggle(player.id),
          'aria-pressed': String(isPicked),
        }, [
          el('span', { className: 'label', textContent: player.label }),
          statusTag(player.status),
        ]);
      });
      // Pitchers heading carries the rule, so it's visible while picking.
      const note = group === 'P' ? ' · max ' + MAX_PITCHERS + ' on roster' : '';
      return el('section', { className: 'pool-group' }, [
        el('h3', {}, [title + ' (' + inGroup.length + ')' + note]),
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
      // One dashed "open slot" per group while that group can still grow.
      const groupFull = this.isFull() || (group === 'P' && this.pitchersFull());
      if (!groupFull) {
        slots.push(el('div', { className: 'slot open' }, [hint]));
      }
      // "Pitchers (12 of 13 max)" vs "Position Players (13)"
      const countText = group === 'P'
        ? players.length + ' of ' + MAX_PITCHERS + ' max'
        : String(players.length);
      return el('section', { className: 'slot-group' }, [
        el('h3', {}, [title + ' (' + countText + ')']),
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
 * "Runs guess 8", plus "(off by 2)" once the Game 1 result is in.
 * Entries saved before the runs tie-breaker existed show "–".
 */
function runsGuessText(entry) {
  const guess = typeof entry.runsGuess === 'number' ? String(entry.runsGuess) : '–';
  const diff = typeof entry.runsDiff === 'number' ? ' (off by ' + entry.runsDiff + ')' : '';
  return 'Runs guess ' + guess + diff;
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
        el('span', { className: 'entry-meta', textContent: runsGuessText(entry) + ' · ' + formatTime(entry.submittedAt, timeZone) }),
      ]),
      renderRosterLists(entry.picks),
      extraControls ? extraControls(entry) : null,
    ])));
}

/**
 * "Dana", "Dana and Chris", "Dana, Chris, and Alex".
 */
function joinNames(names) {
  if (names.length <= 2) return names.join(' and ');
  return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1];
}

/**
 * The banner above the scoreboard: who won, or who's tied for first.
 * `result` comes from scoreboard_result() in api/lib.php (SPEC §6).
 */
function renderResultBanner(result) {
  if (!result) return null;
  const outOf = result.score + ' of ' + ROSTER_SIZE;

  if (result.status === 'tiedForFirst') {
    return el('div', { className: 'result-banner tied' }, [
      el('strong', {}, ['Tied for 1st: ' + joinNames(result.names) + ' (' + outOf + ')']),
      el('span', {}, ["The winner is whoever's closest to Game 1 total runs. Check back after the game."]),
    ]);
  }

  // A winner. The second line says how it was decided.
  let how;
  if (result.decidedBy === 'runs') {
    how = 'Won the tie-breaker: guessed ' + result.runsGuess + ', Game 1 had ' + result.game1Runs + ' runs.';
  } else if (result.decidedBy === 'entry') {
    how = 'Tied on players and on the runs tie-breaker, so the earlier entry wins.';
  } else if (result.game1Runs === null) {
    how = "No tie at the top, so Game 1 isn't needed.";
  } else {
    how = 'No tie at the top.';
  }
  return el('div', { className: 'result-banner winner' }, [
    el('strong', {}, [result.names[0] + ' wins with ' + outOf]),
    el('span', {}, [how]),
  ]);
}

/**
 * Heading for the results: "Final standings" once there's a winner (even
 * before Game 1, if nobody tied for first), otherwise "Standings".
 */
function standingsTitle(result) {
  return result && result.status === 'winner' ? 'Final standings' : 'Standings';
}

/**
 * Ranked scoreboard with the winner banner on top. Each row expands to show
 * that entry's hits and misses and the actual players they left out.
 *
 *   data           { scoreboard, result, actual, game1Runs } exactly as
 *                  api/entries.php and api/admin.php return them
 *   extraControls  optional (row) => node, added inside each expanded row
 *                  (the admin page's Delete button)
 *
 * Tied rows (row.tied, only possible before the Game 1 result) show a
 * shared rank like "T-2", followed by a note that Game 1 will order them.
 */
function renderScoreboard(data, timeZone, extraControls) {
  const { scoreboard: rows, result, actual, game1Runs } = data;

  const tiebreakText = game1Runs === null
    ? 'Ties are broken by closest guess at Game 1 total runs, then earliest entry.'
    : 'Game 1 total runs: ' + game1Runs + '. Ties broken by closest runs guess, then earliest entry.';
  const header = el('p', { className: 'muted small' }, [
    'Actual roster: ' + actual.pitcherCount + ' pitchers / ' + (ROSTER_SIZE - actual.pitcherCount) +
    ' position players. ' + tiebreakText,
  ]);

  const items = [];
  rows.forEach((row, index) => {
    items.push(el('li', {}, [
      el('details', { className: 'entry' }, [
        el('summary', {}, [
          el('span', { className: 'rank', textContent: (row.tied ? 'T-' : '') + row.rank }),
          el('span', { className: 'entry-name', textContent: row.name }),
          el('span', { className: 'score', textContent: row.score + ' / ' + ROSTER_SIZE }),
          el('span', { className: 'entry-meta', textContent: runsGuessText(row) }),
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
    ]));
    // After the last row of a tied group, explain that the order isn't final.
    const next = rows[index + 1];
    const endsTiedGroup = row.tied && (!next || next.score !== row.score);
    if (endsTiedGroup) {
      items.push(el('li', { className: 'tie-note' }, ['Tied. Game 1 total runs will set this order.']));
    }
  });

  return el('div', {}, [
    renderResultBanner(result),
    header,
    el('ol', { className: 'scoreboard' }, items),
  ]);
}
