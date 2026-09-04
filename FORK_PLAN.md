# Sleeper MCP fork audit and roadmap

## Executive recommendation

Fork this project, but treat version 1.1.1 as a useful Sleeper read layer rather than a finished fantasy decision engine. The transport and endpoint client are small and understandable. The draft endpoints already existed in the client, so the first fork milestone exposes them and adds one goal-oriented live draft tool.

Do not describe the current heuristic tools as projection-grade or AI-powered. They use Sleeper player metadata and `search_rank`, and the player-news feature returns fabricated placeholder search results. Until real projections, news, and rankings are integrated, outputs should label their basis explicitly.

## Repository audit

### Structure and architecture

- `src/index.ts`: stdio MCP server, tool listing, tool dispatch, and JSON text responses.
- `src/tools.ts`: Zod validation schemas plus a separately maintained array of JSON-schema tool definitions.
- `src/handlers.ts`: switch-based dispatcher and all orchestration/recommendation logic in one large module.
- `src/sleeper-client.ts`: Sleeper HTTP client, player-map cache, joins, and convenience methods.
- `src/types.ts`: Sleeper response types and enriched internal response types.
- `src/utils.ts`: heuristic fantasy helpers and placeholder web-search results; much of this is not connected to handlers.
- `test.mjs`: an end-to-end script that starts a new MCP process per test and calls the live Sleeper service.

The layering is serviceable for a small server, but schemas are duplicated, handlers are monolithic, and API access is coupled to a singleton. Those choices will make deterministic testing and additional data providers increasingly difficult.

### Current tool surface before this fork

The upstream registry exposed 18 tools:

- League/user: user info, user leagues, league info, rosters, league users.
- Matchups: current matchups, one user's matchup, NFL state.
- Players: search, trending, player details.
- Recommendations: player status research, lineup analysis, waiver suggestions, player comparison, start/sit.
- Activity/maintenance: transactions and clear cache.

The README claimed 19 tools and “comprehensive” coverage, but the registry contained 18 and only 8 were exercised by its integration script.

### Sleeper API coverage

The HTTP client already implemented nearly the complete documented public fantasy API:

- Users and user leagues.
- League details, rosters, users, matchups, transactions, traded picks, and playoff brackets.
- User drafts, league drafts, draft details, draft picks, and draft traded picks.
- NFL state, all players, and trending adds/drops.

The main coverage gap was exposure: league traded picks, brackets, user drafts, league drafts, and all draft reads had no MCP tool. Several response types were also `any[]`, discarding useful guarantees.

Sleeper's public API is read-only. Draft selections, waiver claims, trades, and lineup changes therefore require a separate browser-action layer with explicit user confirmation and careful UI verification.

## Important gaps and risks

1. **No trustworthy decision data.** Sleeper provides league state and player identity, not consensus rankings, projections, ADP, schedules, or advanced metrics. `search_rank` is not documented as fantasy rank or ADP.
2. **Placeholder research is presented as real.** Both `handlers.ts` and `utils.ts` synthesize mock search results. This should be removed or renamed before users rely on it.
3. **Recommendation logic is heuristic.** Lineup, waiver, comparison, and start/sit results infer value mainly from `search_rank` and injury flags. They do not calculate scoring-setting-specific projections.
4. **Error semantics are weak.** The handler catches validation/API failures and returns `{success:false}` as normal tool content, so the MCP layer generally does not set `isError` for failures.
5. **Tests depend on the network.** The upstream tests call live Sleeper data, use invalid IDs as assertions, and spawn a fresh server for each request. They can be slow or flaky and do not test draft behavior.
6. **HTTP resilience is minimal.** There is no timeout, retry/backoff, request coalescing, or short-lived cache for rapidly repeated league/draft reads.
7. **Stale defaults and versions.** User league lookup defaulted to the 2024 season, while the package and server reported different versions.
8. **SDK/tool metadata is old.** The MCP SDK is pinned to `^0.4.0`; tool output schemas and modern read-only annotations are absent.
9. **Player cache location is package-relative.** Global installations may be read-only or shared unexpectedly. Cache location should be configurable and atomic writes should prevent corruption.
10. **No configurable league strategy.** There is no persistence for custom ranks, keepers, positional tiers, roster-construction targets, risk tolerance, or scoring-derived strategy.

## Implemented first milestone

- Added typed draft-pick and traded-pick models.
- Exposed `get_league_drafts`, `get_draft`, and `get_draft_picks`.
- Added `get_live_draft_board`, which returns:
  - enriched completed picks;
  - overall progress and the current pick;
  - original and current on-the-clock roster ownership after traded picks;
  - manager identity when the draft belongs to a league;
  - each roster's picks and position counts;
  - an optional user's next owned pick;
  - draft traded picks;
  - a filtered available-player list.
- Labeled the available-player ordering honestly as Sleeper `search_rank`, not ADP/projections.
- Replaced the hard-coded 2024 user-league default with Sleeper's current season.
- Added deterministic tests for snake/linear order, traded picks, next-pick calculation, tool registration, and live-board aggregation.

## Concrete fork roadmap

### Milestone 2 — production-grade data layer

- Upgrade the MCP SDK and generate JSON Schema from Zod so contracts have one source of truth.
- Split handlers into `draft`, `league`, `players`, and `analysis` modules.
- Inject the Sleeper client into handlers; replace singleton monkey-patching with fixtures.
- Add HTTP timeouts, bounded exponential backoff for transient failures, request deduplication, and TTL caches tuned by endpoint.
- Return MCP errors correctly and add structured output schemas/read-only annotations.
- Make cache directory configurable and use atomic file replacement.

### Milestone 3 — draft intelligence

- ✅ Add an inline JSON ranking format with player-ID/name matching and transparent Sleeper fallbacks.
- ✅ Add `get_draft_recommendations` with selectable strategy and explicit rank, roster-need, and scarcity score components.
- ✅ Upgrade live recommendations with dynamic replacement levels, projected-point gaps, next-pick survival estimates, injury context, and a measured computation budget with an instant fallback.
- ✅ Add automatic free Fantasy Football Calculator ADP with league-format selection, daily caching, stale-cache fallback, source metadata, and player-level ADP dispersion.
- ✅ Model the managers selecting before the user's next pick using open starters, position preferences, recent position runs, traded-pick ownership, and reach/wait behavior versus market ADP.
- ✅ Seed returning-manager position preferences from the previous Sleeper league season, matched by user ID and bounded so live behavior takes over.
- ✅ Add a compact clock-aware pick tool that separates realistic target-slot choices from low-survival dream outcomes without returning verbose player records.
- ✅ Add historical draft replay against archived free ADP, including per-pick availability, alternatives, market regret, and explicit benchmark limitations.
- ✅ Add a deterministic-seeded, time-bounded Monte Carlo layer that compares leading candidates through the user's following pick and returns expected two-pick value, opportunity cost, confidence, and likely follow-up targets.
- ✅ Add pre-draft preparation of three free nflverse seasons, recency-weighted player stat forecasts, league-specific scoring translation, floor/median/ceiling ranges, cache-only live reads, and explicit unsupported-setting reporting.
- ✅ Enrich veteran projections with bounded current depth-chart role adjustments and add high-uncertainty rookie priors from NFL draft capital, combine testing, and depth-chart placement.
- ✅ Add walk-forward historical backtesting under exact league scoring, report raw and calibration-fit accuracy/coverage, persist scoring-fingerprinted position calibration, and apply it to live recommendations with evidence thresholds and bounded factors.
- ✅ Add persistent JSON/CSV import and a ranking-provider interface so large ranking sets do not need to be sent with every call.
- Add provider adapters for licensed projection/ADP sources after data-source selection.
- Add licensed/current ADP and projection providers only after choosing acceptable data sources and terms.
- Normalize league scoring and roster settings into a scoring profile.
- Calculate value over replacement, positional scarcity, roster need, tier drop-offs, and best-player-available scores.
- Add “likely available at my next pick” using ADP distributions or draft-history data, not a guessed threshold.
- Handle auction drafts separately: budgets, winning bids, roster dollars remaining, and value curves.
- Support keepers and supplemental/rookie drafts explicitly.

### Milestone 4 — season-long management

- Replace placeholder research with a real, cited news/injury provider.
- Add weekly projections, schedules, byes, scoring-specific lineup optimization, and confidence/uncertainty.
- Calculate true free agents by subtracting all rostered players from the player pool.
- Add waiver recommendations with drop candidates, FAAB ranges, priority effects, and contingency groups.
- Add trade analysis for players, FAAB, and future picks with redraft/dynasty modes.
- Add matchup, standings, playoff-odds, and roster-strength summaries.

### Milestone 5 — safe actions and operations

- Keep MCP data tools read-only.
- Implement Sleeper website actions as a separate browser workflow with preview, explicit confirmation, post-action verification, and an audit record.
- Add live-draft polling with change detection so only new picks trigger recomputation.
- Add CI for formatting, type-checking, unit tests, mocked contract tests, and an opt-in live API smoke test.

## Suggested next decision

Choose the ranking/projection data strategy before implementing recommendations. The pragmatic first option is a user-owned CSV import plus a provider interface. It makes the engine useful immediately without committing the fork to a paid or license-restricted feed, and it creates the seam needed to add a commercial projection/ADP source later.
