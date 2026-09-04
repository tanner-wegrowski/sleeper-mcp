# Sleeper Fantasy Football MCP Server

[![npm version](https://badge.fury.io/js/sleeper-mcp.svg)](https://badge.fury.io/js/sleeper-mcp)
[![Downloads](https://img.shields.io/npm/dm/sleeper-mcp.svg)](https://npmjs.org/package/sleeper-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/sleeper-mcp.svg)](https://nodejs.org/en/)

A comprehensive Model Context Protocol (MCP) Server for integrating with Sleeper Fantasy Football. This server enables AI assistants like Claude to perform advanced fantasy football analysis and provide strategic recommendations.

## 📦 Installation

```bash
# Install globally (recommended)
npm install -g sleeper-mcp

# Or use with npx (no installation needed)
npx sleeper-mcp
```

## 🎯 What Can This Server Do?

### 📊 League Management
- **User Information**: Sleeper profiles and league memberships
- **League Details**: Scoring settings, roster positions, team overviews
- **Current Matchups**: Who's playing whom, scores, lineups

### 🏈 Player Analysis
- **Player Search**: Find any NFL player in the Sleeper database
- **Trending Players**: Hottest waiver wire pickups
- **Injury Status**: Current injury reports with web research
- **Player Comparisons**: Head-to-head analysis for trade decisions

### 🧠 AI-Powered Recommendations
- **Lineup Analysis**: Automatic start/sit recommendations
- **Waiver Wire Tips**: Personalized pickup suggestions
- **Matchup Strategies**: Opponent analysis and winning strategies
- **Transaction Tracking**: Follow league activity and trends

## 🚀 Quick Start

### 1. Installation

Choose one of these installation methods:

#### Option A: Global NPM Install (Recommended)
```bash
npm install -g sleeper-mcp
```

#### Option B: Using npx (No Installation)
```bash
npx sleeper-mcp
```

#### Option C: Local Development
```bash
git clone https://github.com/yourusername/sleeper-mcp.git
cd sleeper-mcp
npm install
npm run build
```

### 2. Claude Desktop Configuration

#### For Global Install or npx:
```json
{
  "mcpServers": {
    "sleeper-mcp": {
      "command": "sleeper-mcp",
      "args": [],
      "env": {}
    }
  }
}
```

#### For npx (alternative):
```json
{
  "mcpServers": {
    "sleeper-mcp": {
      "command": "npx",
      "args": ["sleeper-mcp"],
      "env": {}
    }
  }
}
```

#### For Local Development:
```json
{
  "mcpServers": {
    "sleeper-mcp": {
      "command": "node",
      "args": ["/full/path/to/sleeper-mcp/dist/index.js"],
      "env": {}
    }
  }
}
```

### 3. Test
```bash
npm test
npm run test:coverage  # Show detailed code coverage
```

## 🧪 Test Coverage

The server includes comprehensive tests covering:

### ✅ Core Infrastructure (100%)
- **MCP Protocol**: Server initialization and tool registration
- **Error Handling**: Invalid tools and malformed requests
- **JSON-RPC**: Proper request/response formatting

### ✅ API Integration (65%)
- **Basic API**: NFL state, player search, trending players
- **User Management**: Invalid user handling
- **League Data**: Invalid league ID handling
- **Cache System**: Clear cache confirmation logic

### ✅ Edge Cases & Validation (90%)
- **Empty Arrays**: Graceful handling of empty player lists
- **Missing Parameters**: Required field validation
- **Invalid IDs**: Non-existent user/league/player handling
- **Parameter Validation**: Type checking and bounds testing

### 📊 Real Coverage Metrics
```
File Coverage:   55.13% statements | 62.36% branches | 35.52% functions
Test Results:    13/13 passing (100%)
Tool Coverage:   8/19 tools tested (42%)
Edge Cases:      ~90% covered

Handler Functions: 27.35% (core logic)
Tools Registry:    93.06% (tool definitions)  
Sleeper Client:    51.21% (API integration)
Server Core:       100% (MCP protocol)
```

**Commands:**
```bash
npm test              # Run all tests
npm run test:coverage # Show detailed coverage report
npm run coverage      # Alias for test:coverage
```

**Key tested scenarios:**
- Server startup and MCP handshake
- Basic API functionality with real data
- Invalid input handling and error responses
- Cache management and confirmation flows
- Parameter validation and type checking

## 🎮 Get Started Immediately

Start a conversation with Claude and try:

```
"Show me my current lineup against my opponent this week"
"Which players are questionable this week and should I replace them?"
"Give me waiver wire recommendations based on trends"
```

## 🛠️ Available Tools

### League Management
- `get_user_info` - Retrieve user information
- `get_user_leagues` - Get all leagues for a user
- `get_league_info` - Details of a specific league
- `get_league_rosters` - All team rosters in a league
- `get_league_users` - All users/managers in a league

### Matchup Analysis
- `get_current_matchups` - Current week matchups
- `get_matchup_details` - Detailed matchup information
- `get_nfl_state` - Current NFL status (week, season)

### Live Draft Management
- `get_league_drafts` - Discover drafts and their status for a league
- `get_draft` - Draft format, order, roster mapping, and settings
- `get_draft_picks` - Completed picks with optional player details
- `get_live_draft_board` - On-the-clock ownership, traded picks, team builds, next user pick, and available-player pool
- `get_draft_recommendations` - Time-budgeted live recommendations using rank/market value, actual roster construction, dynamic replacement value, injury context, and the probability a player survives to your next pick
- `get_pick_decision` - Compact clock-aware output: realistic targets before your turn, dream outcomes separately, and immediate choices while on the clock
- `replay_draft` - Replay one manager's selections against that season's free ADP board and report availability, alternatives, reaches, and market regret
- `prepare_draft_data` - Pre-download free ADP, historical production, depth charts, and rookie inputs before draft day
- `backtest_projection_model` - Walk-forward test the projection baseline under the league's exact scoring and save position-specific calibration
- `import_draft_rankings` - Persist JSON or CSV rankings for a draft using replace or merge mode
- `get_saved_draft_rankings` - Inspect and verify the ranking set saved for a draft

Personal rankings are optional and can be supplied inline:

```json
{
  "draft_id": "123456789",
  "user_id": "987654321",
  "strategy": "balanced",
  "limit": 10,
  "rankings": [
    {
      "player_id": "11566",
      "rank": 1,
      "tier": "Elite",
      "projected_points": 302.4,
      "notes": "Preferred first-round target"
    },
    {
      "name": "Amon-Ra St. Brown",
      "rank": 2
    }
  ]
}
```

Rankings match by Sleeper player ID first and normalized player name second. Players not present in the supplied list fall back to Sleeper `search_rank`, and each recommendation identifies which source it used. Saved rankings load automatically; inline rankings override matching saved entries. Set `use_saved_rankings` to `false` to ignore persistence for one recommendation call.

Live recommendations default to a 3-second computation budget and report data-fetch, calculation, and total runtime separately. Set `calculation_mode` to `instant` for a deterministic sub-second fallback, or adjust `time_budget_ms` between 50 and 10,000 milliseconds. The current contextual engine evaluates at most the 250 strongest available candidates; time-bounded opponent simulations will build on this same interface.

By default, recommendations automatically use the free [Fantasy Football Calculator ADP API](https://help.fantasyfootballcalculator.com/article/42-adp-rest-api) as their market baseline. The provider selects standard, half-PPR, PPR, or 2QB data from the league settings, maps unsupported league sizes to the nearest available feed, and caches results for 24 hours. Player-level ADP standard deviation drives the next-pick survival estimate. If a refresh times out, the last cached snapshot remains available and is explicitly marked stale. Set `use_free_adp` to `false` to disable it or `source_timeout_ms` to cap an initial/expired refresh between 100 and 3,000 milliseconds.

Ranking precedence is: inline user rankings, saved user rankings, free ADP, then Sleeper search rank. The response identifies the source used for each recommendation and includes the ADP URL, format, draft count coverage, cache status, and refresh timestamp.

The live draft-room model also follows the actual pick owners before your next turn, including snake order and traded picks. For each manager it tracks current position counts, open starter positions, observed position preferences, upcoming selections, and average reach versus FFC ADP. Recent six-pick position runs and the combined demand of those specific managers adjust each candidate's survival probability. Manager preferences use a room-level prior so one or two early selections do not create an extreme profile.

When a league links to previous seasons, the model follows up to three years of `previous_league_id` history and matches returning managers by Sleeper user ID even when roster IDs change. It learns separate early-, middle-, and late-round QB/RB/WR/TE preferences; willingness and volatility when reaching versus archived FFC ADP; tendency to fill open starter slots; and whether the manager follows or fades position runs. Recent years and similar league formats receive more weight, while no more than 12 effective historical picks enter the live positional prior. Current-draft behavior progressively takes over, retrieval is cached in memory for 24 hours, and missing history falls back to the neutral room prior.

Use `get_pick_decision` for the normal draft-day interaction. It removes verbose Sleeper player metadata and returns a compact board with data freshness, timing, room pressure, historical sample coverage, and calibration status. Before the user's turn, candidate quality is combined with estimated survival to the target slot; players below 20% survival are separated as unlikely dream targets. While on the clock, it preserves the full decision engine's immediate ranking and treats survival as availability at the following pick.

`replay_draft` is a transparent historical audit. It reconstructs the market board before every pick made by the requested user and compares the selection with the best remaining archived FFC ADP alternatives. Its `market_regret` is an ADP-distance diagnostic, not an outcome score and not proof that the market's first player was the correct choice.

When the user is on the clock, `calculation_mode: "live"` runs deterministic-seeded, time-bounded Monte Carlo continuations through that roster's following pick. Each leading candidate is selected in its own scenario; the intervening managers draft from sampled ADP distributions adjusted for current roster needs, round-specific preferences, live and historical reach volatility, and response to the current position run. The result ranks the expected two-pick portfolio and reports rollouts, confidence, relative draft-equity score, opportunity cost, and the most common next-pick targets. The simulator stops at 5,000 rollouts or the remaining `time_budget_ms`, whichever comes first. Calls made before the user's turn return provisional deterministic guidance and preserve the simulation budget for the actual decision.

Run `prepare_draft_data` before draft day to cache three regular seasons of free [nflverse player statistics](https://github.com/nflverse/nflverse-data) alongside ADP. The historical model weights recent per-game production most heavily, adjusts for games of evidence, forecasts availability, and produces a position-calibrated uncertainty range. Current [nflverse depth charts](https://nflreadr.nflverse.com/articles/dictionary_depth_charts.html) apply bounded, position-specific role adjustments. Players drafted in the target season who lack NFL history receive wider-uncertainty rookie priors derived from NFL draft round/pick, combine testing, and depth-chart role. At recommendation time, projected passing, rushing, receiving, fumble, two-point, and special-teams statistics are translated through the league's Sleeper scoring settings to produce floor, median, and ceiling points. Unsupported settings—such as weekly yardage bonuses—are returned explicitly instead of being silently treated as modeled. Team defenses and remaining unmatched players retain ADP-based evaluation.

Run `backtest_projection_model` once for a draft after preparing its data. By default it evaluates the three completed seasons before the draft season. Every evaluation-season forecast is built strictly from that season's three preceding regular seasons, then compared with actual fantasy points under the current Sleeper league scoring. It reports sample count, mean absolute error, root mean squared error, bias, correlation, and floor-to-ceiling interval coverage overall and by position.

The backtest saves shrinkage-regularized QB/RB/WR/TE point and uncertainty multipliers under a fingerprint of the league scoring settings. Future `get_draft_recommendations` calls load these locally with no network cost and apply a position only when it has at least 20 observations. Point factors are bounded to 0.75–1.25 and uncertainty factors to 0.75–2.0. Both raw and calibration-fit metrics are returned; the latter measure fit on the calibration sample and should not be read as a separate holdout result. The evaluation is conditional on players who recorded stats in the target season, and it does not reconstruct historical point-in-time depth charts or rookie priors. Those current-season features remain deliberately outside this baseline calibration until suitable free historical snapshots are available.

A recommended pre-draft sequence is:

1. Call `prepare_draft_data` with the draft ID. This also warms up to three linked seasons of returning-manager history and archived ADP.
2. Call `backtest_projection_model` with the same draft ID.
3. Call `get_draft_recommendations` during the draft; it will use the cached inputs and matching calibration automatically.

To import CSV, pass the CSV text to `import_draft_rankings` with `format: "csv"`. The supported columns are:

```csv
rank,player_id,name,tier,projected_points,notes
1,11566,Example Player,Elite,302.4,Preferred first-round target
2,,Another Player,A,286.1,"Name matching works, too"
```

JSON imports accept either an array of ranking objects or an object with a `rankings` array. `mode: "replace"` replaces the draft's saved list; `mode: "merge"` updates matching player IDs/names and preserves other entries.

Ranking data is stored outside the package in `~/.sleeper-mcp/rankings` by default. Set `SLEEPER_MCP_DATA_DIR` to choose another private local data directory.

### Player Tools
- `search_players` - Search players in the database
- `get_trending_players` - Trending add/drop players
- `get_player_details` - Detailed player information
- `compare_players` - Head-to-head player comparisons

### Analysis & Recommendations
- `analyze_lineup` - AI-powered lineup analysis
- `research_player_status` - Web research on player status
- `get_waiver_suggestions` - Waiver wire recommendations
- `get_start_sit_advice` - Specific start/sit advice
- `get_transactions` - Recent league transactions

## 📋 Example Workflows

### Weekly Preparation
1. **Find Your User Info**: `get_user_info` with your Sleeper username
2. **Get Your Leagues**: `get_user_leagues` with your user ID
3. **Analyze Current Matchup**: `get_matchup_details` for your league
4. **Check Injured Players**: `research_player_status` for questionable players
5. **Find Waiver Pickups**: `get_waiver_suggestions` for improvements

### Trade Analysis
1. **Compare Players**: `compare_players` for trade targets
2. **Research Status**: `research_player_status` for injury concerns
3. **Analyze Impact**: `analyze_lineup` to model trade effects

## 🏆 Key Features

- **No API Keys Required** - Uses Sleeper's public API
- **Intelligent Caching** - Player data cached for 24 hours
- **Rate Limit Respecting** - Handles Sleeper's 1000 calls/minute limit
- **Comprehensive Error Handling** - Robust error recovery
- **Web Research Integration** - Automatic injury report research
- **Personalized Recommendations** - All advice tailored to your specific league

## 📖 Documentation

- **SETUP.md** - Detailed installation and configuration guide
- **EXAMPLES.md** - Comprehensive usage examples and scenarios
- **Inline Documentation** - Fully commented codebase

## ⚡ Technical Details

- **TypeScript** for type safety
- **Zod** for input validation
- **MCP SDK** for Claude integration
- **Read-only API** - Cannot modify lineups (Sleeper limitation)
- **Real-time Data** - Always current information

## 🔧 Development

### For Users
```bash
# Install globally
npm install -g sleeper-mcp

# Or use directly
npx sleeper-mcp
```

### For Contributors
```bash
# Clone the repository
git clone https://github.com/yourusername/sleeper-mcp.git
cd sleeper-mcp
npm install

# Development with hot reload
npm run dev

# Build for production
npm run build
npm start

# Watch mode (automatic rebuilding)
npm run watch

# Run tests
npm test
npm run test:coverage
```

## ⚠️ Limitations

- Sleeper API is read-only (no lineup modifications possible)
- Rate limit: Maximum 1000 API calls per minute
- Player data automatically cached (24h refresh)
- `get_live_draft_board` ranks available players by Sleeper `search_rank`; this is a useful fallback, not a substitute for configurable rankings, ADP, or projections
- Backtest calibration is scoring-specific and baseline-specific; material projection-model changes should be followed by a new backtest

## 📄 License

MIT License

## 🤝 Contributing

This server can be extended with:
- Additional Sleeper API endpoints
- Enhanced analysis and recommendations
- Integration with other fantasy platforms
- Historical data analysis

---

**Dominate your fantasy league with AI-powered analysis! 🏆**
