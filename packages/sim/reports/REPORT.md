# Simulation report

1000 simulated nights per party size per parameter set. Night length 300 min.

## Summary

| Set | 12 players | 20 players |
|---|---|---|
| baseline | 5/9 | 4/9 |
| old-x1-tuned | 9/9 | 9/9 |
| recommended **(recommended)** | 9/9 | 8/9 |
| slippage-alt | 8/9 | 9/9 |

## baseline

Spec §20 market defaults, game gold ×3.

### 12 players

| | Target | Result | Goal |
|---|---|---|---|
| ❌ | Market share of winner's final gold (mean) | 38% (median 38%) | 10–30% |
| ❌ | Solo pump with no rank change is unprofitable | 57% of runs | ≥80% of runs |
| ❌ | 3-player coalition pump (crypto/dead) makes a modest profit | ROI 19.5%, +21.6 gold/member/night, profitable in 93% of runs | ROI 2–15% and profitable in ≥55% of runs |
| ✅ | Bottom quartile at midpoint reaches top 3 | 7.1% | 5–15% of runs |
| ✅ | Midpoint leader wins | 54.9% | ≤60% |
| ❌ | Active traders vs inactive (final gold) | +55.0% | +5–15% |
| ✅ | Player stock mean |Δ| per tick | 0.20% | <2% |
| ✅ | Crypto mean |Δ| per tick | 8.3% | 5–15% |
| ✅ | Runs where any security sits at a band edge >20% of the night | 2.7% | ≤5% of runs |

- Winner gold (mean): 94.4
- Winner: from games / from trading (mean): 27.9 / 37.2
- Avg player: games / stake+other / final (mean): 21.0 / 25.7 / 58.1
- Games per night (mean): 16.3
- Coalition on crypto: ROI 17.7%, +19.3/member, profitable 86%
- Coalition on dead stock: ROI 21.3%, +23.8/member, profitable 100%
- Pinned >20% by kind: player 2.7%, index 0.0%, crypto 0.0%, event 0.0%, dead 0.0%
- End-of-night profit fee (mean total): 0.4
- Bounty paid per night (mean total): 22.1
- Kingfalls per night (mean): 8.2
- Winner by agent type: holder 1%, trader 43%, selfPumper 1%, coalition 28%, gambler 26%, random 1%, inactive 1%
- Mean final gold by agent: holder 47.2, trader 73.5, selfPumper 45.5, coalition 67.5, gambler 70.0, random 47.6, inactive 47.4
- Mean trading P&L by agent: holder -0.5, trader +26.0, selfPumper -0.1, coalition +21.6, gambler +22.3, random +0.0, inactive +0.0

### 20 players

| | Target | Result | Goal |
|---|---|---|---|
| ❌ | Market share of winner's final gold (mean) | 44% (median 44%) | 10–30% |
| ❌ | Solo pump with no rank change is unprofitable | 52% of runs | ≥80% of runs |
| ❌ | 3-player coalition pump (crypto/dead) makes a modest profit | ROI 20.2%, +22.7 gold/member/night, profitable in 94% of runs | ROI 2–15% and profitable in ≥55% of runs |
| ❌ | Bottom quartile at midpoint reaches top 3 | 3.6% | 5–15% of runs |
| ✅ | Midpoint leader wins | 47.9% | ≤60% |
| ❌ | Active traders vs inactive (final gold) | +62.6% | +5–15% |
| ✅ | Player stock mean |Δ| per tick | 0.22% | <2% |
| ✅ | Crypto mean |Δ| per tick | 8.4% | 5–15% |
| ✅ | Runs where any security sits at a band edge >20% of the night | 2.2% | ≤5% of runs |

- Winner gold (mean): 105.5
- Winner: from games / from trading (mean): 28.2 / 47.3
- Avg player: games / stake+other / final (mean): 21.5 / 26.3 / 59.4
- Games per night (mean): 26.6
- Coalition on crypto: ROI 19.1%, +21.4/member, profitable 87%
- Coalition on dead stock: ROI 21.3%, +24.1/member, profitable 100%
- Pinned >20% by kind: player 2.2%, index 0.0%, crypto 0.0%, event 0.0%, dead 0.0%
- End-of-night profit fee (mean total): 0.8
- Bounty paid per night (mean total): 52.1
- Kingfalls per night (mean): 13.5
- Winner by agent type: holder 0%, trader 55%, selfPumper 0%, coalition 12%, gambler 33%, random 0%, inactive 0%
- Mean final gold by agent: holder 48.3, trader 79.0, selfPumper 44.8, coalition 69.1, gambler 71.6, random 48.4, inactive 48.6
- Mean trading P&L by agent: holder -0.4, trader +30.2, selfPumper -0.3, coalition +22.7, gambler +22.8, random +0.3, inactive +0.0

## old-x1-tuned

Previous recommendation (game gold ×1, 3% fee, cap 30). For comparison only.

Changes from defaults:

```json
{
  "scoring": {
    "goldScale": 1
  },
  "market": {
    "feeFrac": 0.03,
    "player": {
      "reversion": 0.2
    },
    "crypto": {
      "sigma": 0.07,
      "reversion": 0.05,
      "kingfallFrac": 0.1
    },
    "impact": {
      "player": 0.02,
      "index": 0,
      "crypto": 0.06,
      "event": 0.02,
      "dead": 0.06
    },
    "dead": {
      "reversion": 0.02
    },
    "investCap": 30
  }
}
```

### 12 players

| | Target | Result | Goal |
|---|---|---|---|
| ✅ | Market share of winner's final gold (mean) | 21% (median 19%) | 10–30% |
| ✅ | Solo pump with no rank change is unprofitable | 100% of runs | ≥80% of runs |
| ✅ | 3-player coalition pump (crypto/dead) makes a modest profit | ROI 5.7%, +6.4 gold/member/night, profitable in 83% of runs | ROI 2–15% and profitable in ≥55% of runs |
| ✅ | Bottom quartile at midpoint reaches top 3 | 7.6% | 5–15% of runs |
| ✅ | Midpoint leader wins | 49.5% | ≤60% |
| ✅ | Active traders vs inactive (final gold) | +7.2% | +5–15% |
| ✅ | Player stock mean |Δ| per tick | 0.21% | <2% |
| ✅ | Crypto mean |Δ| per tick | 5.9% | 5–15% |
| ✅ | Runs where any security sits at a band edge >20% of the night | 3.8% | ≤5% of runs |

- Winner gold (mean): 51.2
- Winner: from games / from trading (mean): 9.3 / 11.7
- Avg player: games / stake+other / final (mean): 7.0 / 25.7 / 33.1
- Games per night (mean): 16.3
- Coalition on crypto: ROI 4.4%, +4.9/member, profitable 67%
- Coalition on dead stock: ROI 7.0%, +7.9/member, profitable 100%
- Pinned >20% by kind: player 3.8%, index 0.0%, crypto 0.0%, event 0.0%, dead 0.0%
- End-of-night profit fee (mean total): 0.2
- Bounty paid per night (mean total): 22.1
- Kingfalls per night (mean): 8.2
- Winner by agent type: holder 8%, trader 26%, selfPumper 0%, coalition 38%, gambler 20%, random 1%, inactive 7%
- Mean final gold by agent: holder 32.6, trader 35.9, selfPumper 15.1, coalition 38.5, gambler 34.6, random 30.4, inactive 33.5
- Mean trading P&L by agent: holder -0.9, trader +2.6, selfPumper -15.8, coalition +6.4, gambler +1.1, random -2.9, inactive +0.0

### 20 players

| | Target | Result | Goal |
|---|---|---|---|
| ✅ | Market share of winner's final gold (mean) | 28% (median 28%) | 10–30% |
| ✅ | Solo pump with no rank change is unprofitable | 100% of runs | ≥80% of runs |
| ✅ | 3-player coalition pump (crypto/dead) makes a modest profit | ROI 6.2%, +7.0 gold/member/night, profitable in 87% of runs | ROI 2–15% and profitable in ≥55% of runs |
| ✅ | Bottom quartile at midpoint reaches top 3 | 6.9% | 5–15% of runs |
| ✅ | Midpoint leader wins | 46.2% | ≤60% |
| ✅ | Active traders vs inactive (final gold) | +9.0% | +5–15% |
| ✅ | Player stock mean |Δ| per tick | 0.23% | <2% |
| ✅ | Crypto mean |Δ| per tick | 6.0% | 5–15% |
| ✅ | Runs where any security sits at a band edge >20% of the night | 3.5% | ≤5% of runs |

- Winner gold (mean): 56.1
- Winner: from games / from trading (mean): 9.2 / 16.4
- Avg player: games / stake+other / final (mean): 7.1 / 26.3 / 33.4
- Games per night (mean): 26.6
- Coalition on crypto: ROI 5.4%, +6.0/member, profitable 73%
- Coalition on dead stock: ROI 7.0%, +7.9/member, profitable 100%
- Pinned >20% by kind: player 3.5%, index 0.0%, crypto 0.0%, event 0.0%, dead 0.0%
- End-of-night profit fee (mean total): 0.5
- Bounty paid per night (mean total): 53.1
- Kingfalls per night (mean): 13.5
- Winner by agent type: holder 4%, trader 37%, selfPumper 0%, coalition 23%, gambler 32%, random 1%, inactive 3%
- Mean final gold by agent: holder 33.5, trader 37.3, selfPumper 14.9, coalition 39.3, gambler 36.3, random 31.5, inactive 34.2
- Mean trading P&L by agent: holder -0.8, trader +2.9, selfPumper -15.7, coalition +7.0, gambler +2.0, random -2.6, inactive +0.0

## recommended

Game gold ×3, 3% trade fee, invest cap 25, faster player-price catch-up, calmer crypto, gentler dead stock.

Changes from defaults:

```json
{
  "market": {
    "feeFrac": 0.03,
    "player": {
      "reversion": 0.2
    },
    "crypto": {
      "sigma": 0.07,
      "reversion": 0.05,
      "kingfallFrac": 0.1
    },
    "impact": {
      "player": 0.02,
      "index": 0,
      "crypto": 0.06,
      "event": 0.02,
      "dead": 0.06
    },
    "dead": {
      "reversion": 0.02
    },
    "investCap": 25
  }
}
```

### 12 players

| | Target | Result | Goal |
|---|---|---|---|
| ✅ | Market share of winner's final gold (mean) | 14% (median 11%) | 10–30% |
| ✅ | Solo pump with no rank change is unprofitable | 100% of runs | ≥80% of runs |
| ✅ | 3-player coalition pump (crypto/dead) makes a modest profit | ROI 5.7%, +6.3 gold/member/night, profitable in 83% of runs | ROI 2–15% and profitable in ≥55% of runs |
| ✅ | Bottom quartile at midpoint reaches top 3 | 7.7% | 5–15% of runs |
| ✅ | Midpoint leader wins | 46.5% | ≤60% |
| ✅ | Active traders vs inactive (final gold) | +11.0% | +5–15% |
| ✅ | Player stock mean |Δ| per tick | 0.22% | <2% |
| ✅ | Crypto mean |Δ| per tick | 5.9% | 5–15% |
| ✅ | Runs where any security sits at a band edge >20% of the night | 3.8% | ≤5% of runs |

- Winner gold (mean): 71.7
- Winner: from games / from trading (mean): 31.2 / 10.2
- Avg player: games / stake+other / final (mean): 21.0 / 25.5 / 47.1
- Games per night (mean): 16.3
- Coalition on crypto: ROI 4.3%, +4.8/member, profitable 66%
- Coalition on dead stock: ROI 7.0%, +7.8/member, profitable 100%
- Pinned >20% by kind: player 3.8%, index 0.0%, crypto 0.0%, event 0.0%, dead 0.0%
- End-of-night profit fee (mean total): 0.2
- Bounty paid per night (mean total): 20.0
- Kingfalls per night (mean): 8.2
- Winner by agent type: holder 10%, trader 29%, selfPumper 0%, coalition 34%, gambler 14%, random 4%, inactive 9%
- Mean final gold by agent: holder 46.1, trader 52.6, selfPumper 26.4, coalition 52.4, gambler 48.4, random 44.2, inactive 47.4
- Mean trading P&L by agent: holder -1.2, trader +5.4, selfPumper -18.9, coalition +6.3, gambler +1.3, random -3.0, inactive +0.0

### 20 players

| | Target | Result | Goal |
|---|---|---|---|
| ✅ | Market share of winner's final gold (mean) | 18% (median 17%) | 10–30% |
| ✅ | Solo pump with no rank change is unprofitable | 100% of runs | ≥80% of runs |
| ✅ | 3-player coalition pump (crypto/dead) makes a modest profit | ROI 6.0%, +6.7 gold/member/night, profitable in 84% of runs | ROI 2–15% and profitable in ≥55% of runs |
| ❌ | Bottom quartile at midpoint reaches top 3 | 4.9% | 5–15% of runs |
| ✅ | Midpoint leader wins | 40.0% | ≤60% |
| ✅ | Active traders vs inactive (final gold) | +13.7% | +5–15% |
| ✅ | Player stock mean |Δ| per tick | 0.23% | <2% |
| ✅ | Crypto mean |Δ| per tick | 6.0% | 5–15% |
| ✅ | Runs where any security sits at a band edge >20% of the night | 3.6% | ≤5% of runs |

- Winner gold (mean): 77.1
- Winner: from games / from trading (mean): 32.0 / 14.1
- Avg player: games / stake+other / final (mean): 21.5 / 26.0 / 47.7
- Games per night (mean): 26.6
- Coalition on crypto: ROI 4.9%, +5.5/member, profitable 68%
- Coalition on dead stock: ROI 7.0%, +7.9/member, profitable 100%
- Pinned >20% by kind: player 3.6%, index 0.0%, crypto 0.0%, event 0.0%, dead 0.0%
- End-of-night profit fee (mean total): 0.4
- Bounty paid per night (mean total): 47.9
- Kingfalls per night (mean): 13.5
- Winner by agent type: holder 5%, trader 42%, selfPumper 0%, coalition 20%, gambler 22%, random 3%, inactive 9%
- Mean final gold by agent: holder 47.4, trader 54.9, selfPumper 26.0, coalition 53.0, gambler 50.0, random 45.2, inactive 48.3
- Mean trading P&L by agent: holder -1.1, trader +6.5, selfPumper -19.0, coalition +6.7, gambler +1.8, random -2.6, inactive +0.0

## slippage-alt

NEW MECHANIC alternative: traders pay half their own price impact. Game gold ×3, 2% fee, fair range 20–80%, cap 25.

Changes from defaults:

```json
{
  "market": {
    "feeFrac": 0.02,
    "player": {
      "reversion": 0.3,
      "fairInnerLo": 0.2,
      "fairInnerHi": 0.8
    },
    "crypto": {
      "sigma": 0.07,
      "reversion": 0.05,
      "kingfallFrac": 0.1
    },
    "impact": {
      "player": 0.02,
      "index": 0,
      "crypto": 0.06,
      "event": 0.02,
      "dead": 0.08
    },
    "dead": {
      "reversion": 0.02
    },
    "slippage": 0.5,
    "investCap": 25
  }
}
```

### 12 players

| | Target | Result | Goal |
|---|---|---|---|
| ❌ | Market share of winner's final gold (mean) | 8% (median 7%) | 10–30% |
| ✅ | Solo pump with no rank change is unprofitable | 100% of runs | ≥80% of runs |
| ✅ | 3-player coalition pump (crypto/dead) makes a modest profit | ROI 2.7%, +3.0 gold/member/night, profitable in 75% of runs | ROI 2–15% and profitable in ≥55% of runs |
| ✅ | Bottom quartile at midpoint reaches top 3 | 8.1% | 5–15% of runs |
| ✅ | Midpoint leader wins | 47.2% | ≤60% |
| ✅ | Active traders vs inactive (final gold) | +6.8% | +5–15% |
| ✅ | Player stock mean |Δ| per tick | 0.20% | <2% |
| ✅ | Crypto mean |Δ| per tick | 5.9% | 5–15% |
| ✅ | Runs where any security sits at a band edge >20% of the night | 3.8% | ≤5% of runs |

- Winner gold (mean): 69.1
- Winner: from games / from trading (mean): 32.3 / 6.0
- Avg player: games / stake+other / final (mean): 21.0 / 25.5 / 45.4
- Games per night (mean): 16.4
- Coalition on crypto: ROI 0.5%, +0.5/member, profitable 49%
- Coalition on dead stock: ROI 4.9%, +5.5/member, profitable 100%
- Pinned >20% by kind: player 3.8%, index 0.0%, crypto 0.0%, event 0.0%, dead 0.0%
- End-of-night profit fee (mean total): 0.2
- Bounty paid per night (mean total): 19.6
- Kingfalls per night (mean): 8.1
- Winner by agent type: holder 12%, trader 27%, selfPumper 0%, coalition 31%, gambler 9%, random 5%, inactive 15%
- Mean final gold by agent: holder 46.1, trader 50.6, selfPumper 26.3, coalition 49.1, gambler 42.6, random 43.8, inactive 47.4
- Mean trading P&L by agent: holder -1.0, trader +3.5, selfPumper -19.3, coalition +3.0, gambler -4.8, random -3.3, inactive +0.0

### 20 players

| | Target | Result | Goal |
|---|---|---|---|
| ✅ | Market share of winner's final gold (mean) | 12% (median 9%) | 10–30% |
| ✅ | Solo pump with no rank change is unprofitable | 100% of runs | ≥80% of runs |
| ✅ | 3-player coalition pump (crypto/dead) makes a modest profit | ROI 2.9%, +3.3 gold/member/night, profitable in 76% of runs | ROI 2–15% and profitable in ≥55% of runs |
| ✅ | Bottom quartile at midpoint reaches top 3 | 5.2% | 5–15% of runs |
| ✅ | Midpoint leader wins | 37.9% | ≤60% |
| ✅ | Active traders vs inactive (final gold) | +9.3% | +5–15% |
| ✅ | Player stock mean |Δ| per tick | 0.22% | <2% |
| ✅ | Crypto mean |Δ| per tick | 6.0% | 5–15% |
| ✅ | Runs where any security sits at a band edge >20% of the night | 3.8% | ≤5% of runs |

- Winner gold (mean): 73.4
- Winner: from games / from trading (mean): 33.1 / 9.0
- Avg player: games / stake+other / final (mean): 21.5 / 25.9 / 46.0
- Games per night (mean): 26.7
- Coalition on crypto: ROI 0.9%, +1.0/member, profitable 52%
- Coalition on dead stock: ROI 4.9%, +5.6/member, profitable 100%
- Pinned >20% by kind: player 3.8%, index 0.0%, crypto 0.0%, event 0.0%, dead 0.0%
- End-of-night profit fee (mean total): 0.4
- Bounty paid per night (mean total): 45.7
- Kingfalls per night (mean): 13.4
- Winner by agent type: holder 10%, trader 39%, selfPumper 0%, coalition 19%, gambler 14%, random 4%, inactive 15%
- Mean final gold by agent: holder 47.4, trader 52.6, selfPumper 25.7, coalition 49.7, gambler 43.7, random 45.2, inactive 48.1
- Mean trading P&L by agent: holder -1.0, trader +4.4, selfPumper -19.4, coalition +3.3, gambler -4.4, random -2.8, inactive +0.0

## Sensitivity of "recommended" to behavior assumptions

500 nights per cell. Cell = 12p / 20p.

| Assumption | T1 | T2 | T3 | T4 | T5 | T6 | T7a | T7b | T8 |
|---|---|---|---|---|---|---|---|---|---|
| Players check phones twice as often mid-game | 14% / 18% | 100% / 100% | ROI 6.1% / ROI 5.9% | 9.2% / 6.0% | 44.0% / 41.8% | +7.1% / +5.5% | 0.22% / 0.24% | 5.9% / 6.0% | 4.8% / 3.0% |
| Players barely touch phones mid-game | 13% / 17% | 99% / 99% | ROI 5.5% / ROI 6.3% | 9.6% / ❌4.4% | 44.0% / 44.0% | ❌+16.8% / ❌+18.0% | 0.20% / 0.22% | 5.9% / 5.9% | 3.6% / 3.2% |
| Games are more luck than skill | 15% / 18% | 100% / 100% | ROI 5.6% / ROI 5.9% | 8.8% / 5.0% | 46.8% / 38.6% | +14.9% / +14.1% | 0.22% / 0.24% | 5.9% / 6.0% | 3.8% / 3.2% |
| Games are more skill than luck | 12% / 15% | 100% / 100% | ROI 5.9% / ROI 5.9% | 8.8% / ❌3.8% | 48.2% / 38.4% | +10.6% / +11.1% | 0.21% / 0.23% | 5.9% / 6.0% | 3.8% / 3.4% |
| Coalition pumps every 10–20 min | 18% / 20% | 100% / 100% | ROI 6.5% / ROI 6.5% | 6.2% / ❌2.6% | 50.4% / 40.0% | +11.2% / +12.8% | 0.22% / 0.23% | 6.0% / 6.0% | 3.6% / 2.4% |

## Recommended settings (full)

```json
{
  "scoring": {
    "placementMults": [
      1,
      0.5,
      0.25
    ],
    "tailFactor": 0.5,
    "tieRule": "average",
    "dnfMult": 0,
    "coopLossMult": 0.25,
    "goldScale": 3
  },
  "stake": {
    "startingGold": 20
  },
  "lateJoin": {
    "goldFraction": 0.75,
    "goldPenalty": 2,
    "stockPenalty": 0.05
  },
  "market": {
    "tickSeconds": 20,
    "maxChangeFrac": 0.3,
    "feeFrac": 0.03,
    "endSellProfitFeeFrac": 0.1,
    "investCap": 25,
    "minTrade": 1,
    "lockoutMinutes": 5,
    "bands": {
      "player": {
        "min": 30,
        "max": 80
      },
      "index": {
        "min": 30,
        "max": 80
      },
      "crypto": {
        "min": 5,
        "max": 150
      },
      "event": {
        "min": 10,
        "max": 100
      },
      "dead": {
        "min": 1,
        "max": 40
      }
    },
    "impact": {
      "player": 0.02,
      "index": 0,
      "crypto": 0.06,
      "event": 0.02,
      "dead": 0.06
    },
    "slippage": 0,
    "player": {
      "fairInnerLo": 0.15,
      "fairInnerHi": 0.85,
      "reversion": 0.2,
      "leaverDecay": 0.02,
      "espionageFrac": 0.03
    },
    "index": {
      "scale": 1,
      "smoothing": 0.3
    },
    "crypto": {
      "sigma": 0.07,
      "reversion": 0.05,
      "baselineAlpha": 0.002,
      "startFrac": 0.25,
      "kingfallFrac": 0.1,
      "kingfallHoldMinutes": 15
    },
    "event": {
      "startFrac": 0.35,
      "floorFrac": 0.1,
      "decay": 0.005,
      "bump": 0.08,
      "reversion": 0.1
    },
    "dead": {
      "baselineFrac": 0.05,
      "reversion": 0.02
    }
  },
  "votes": {
    "quarterCount": 4,
    "bufferFrac": 0.1,
    "windowMinutes": 5,
    "weighting": "equal",
    "bountyGold": 2,
    "topTwoMinPlayers": 16,
    "driftMax": 0.15
  },
  "mood": {
    "moodMax": 0.06,
    "decayPerTick": 0.01
  },
  "rerolls": {
    "perPlayer": 3
  },
  "achievements": {
    "gold": {
      "first_blood": 2,
      "hat_trick": 5,
      "regular": 2,
      "oracle": 1
    }
  },
  "prompts": {
    "tradingCloseMinutesBefore": 15
  },
  "minter": {
    "pauseMultiplier": 2,
    "tvCrawlMinutes": 10
  }
}
```

## Simulation assumptions

```json
{
  "lengthMinutes": 300,
  "skillWeight": 0.8,
  "lateJoinChance": 0.25,
  "leaverChance": 0.25,
  "inGameActivity": 0.25,
  "coalitionGapMinutes": [
    20,
    40
  ]
}
```