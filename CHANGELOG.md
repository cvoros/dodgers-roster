# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- SPEC.md and CLAUDE.md describing the game and project conventions.
- PHP JSON API: cached 40-man roster proxy (MLB Stats API, team 119), game
  state, name check, submit, post-lock entries, and admin actions. Storage is a
  single flock-guarded JSON file.
- Player page: unique name, tap-to-pick 26-man picker grouped Pitchers /
  Position Players with live count, auto pitcher-count tie-breaker, Play Ball
  confirm modal, lock countdown, and a post-lock view of all entries and
  standings. Drafts survive a page refresh.
- Admin page (secret key): list/delete entries, enter the actual roster with the
  same picker or pre-fill it from MLB's active roster, ranked scoreboard with
  per-entry hits and misses.
- Injury/minors status tags on players in the pool.
- README with local run and cPanel deployment steps.
