# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.1] - 2026-09-23

### Added
- Results now name the winner. A banner says who won as soon as the real
  roster is saved if nobody is tied for first, without waiting for Game 1. If
  there's a tie for first, it lists who's tied and says Game 1 runs will
  decide it. Once decided, it says how (tie-breaker guess, or earlier entry).
- Baseball icon (in the style of the ⚾ emoji) for browser tabs and iPhone
  home screens, and a social card so shared links show the baseball with a
  title and description.

### Changed
- New look based on delayDay: `nldsRoster` wordmark, deeper navy palette,
  monospace labels, counts and scores, and outlined buttons with one blue
  primary button per screen. Uses the devices' built-in fonts, with no
  downloads. Text sizes, tap targets, and contrast kept phone-friendly.
- The site is always dark for everyone. Before, it followed each device's
  light/dark setting, and the light version was a stark white.
- Tied entries share a rank ("T-2") until the Game 1 runs are entered.
  Previously they were quietly ordered by entry time, which looked decided.
- The heading reads "Final standings" as soon as there's a winner, even
  before Game 1.

## [0.1.0] - 2026-09-23

First release, deployed at qxnllc.com/baseball.

### Added
- Player page: unique name (case-insensitive), then a tap-to-pick 26-man
  picker grouped Pitchers / Position Players with a live count and a sticky
  bar on phones. Then a Play Ball confirm modal and a lock countdown. After
  lock, everyone's entries are shown, plus standings once scored. Drafts
  survive a page refresh.
- MLB's 13-pitcher postseason limit: the picker won't add a 14th pitcher and
  says why, the rules explain it (Ohtani counts as a two-way/position
  player), and the server rejects rosters over the limit. See #2.
- Tie-breaker: each player guesses **total runs in NLDS Game 1** (both
  teams). Closest guess wins a tie, then earliest entry.
- Admin page (secret key): list and delete entries, enter the actual roster
  with the same picker or pre-fill it from MLB's active roster, enter the
  Game 1 total runs, and a ranked scoreboard with per-entry hits and misses.
- PHP JSON API: cached 40-man roster proxy (MLB Stats API, team 119), game
  state, name check, submit, post-lock entries, and admin actions. The server
  re-validates everything, and storage is a single flock-guarded JSON file.
- Injury/minors status tags on players in the pool.
- Pages and API are marked "noindex, nofollow" (meta tag, `.htaccess`
  header, and PHP header) so the game stays out of search results on the
  company domain. See #1.
- Cache-busting: CSS/JS carry a `?v=` version tag and are served with
  `Cache-Control: no-cache`, so browsers don't keep running old scripts after
  an update (the host's default is an 8-day cache).
- SPEC.md, CLAUDE.md, and a README with local run and cPanel deployment steps.

[Unreleased]: https://github.com/cvoros/dodgers-roster/compare/v0.1.1...develop
[0.1.1]: https://github.com/cvoros/dodgers-roster/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/cvoros/dodgers-roster/releases/tag/v0.1.0
