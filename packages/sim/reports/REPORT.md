# Simulation report

1000 simulated nights per party size per parameter set. Night length 300 min.

## Summary

| Set | 12 players | 20 players |
|---|---|---|
| baseline | 5/9 | 5/9 |
| tuned-fee | 9/9 | 9/9 |
| tuned-fee-cap30 **(recommended)** | 9/9 | 9/9 |
| tuned-slippage | 8/9 | 9/9 |

## baseline

Spec §20 defaults (Phase 1 build, with the crypto model fix).

### 12 players

| | Target | Result | Goal |
|---|---|---|---|
| ❌ | Market share of winner's final gold (mean) | 46% (median 45%) | 10–30% |
| ❌ | Solo pump with no rank change is unprofitable | 54% of runs | ≥80% of runs |
| ❌ | 3-player coalition pump (crypto/dead) makes a modest profit | ROI 20.0%, +22.1 gold/member/night, profitable in 94% of runs | ROI 2–15% and profitable in ≥55% of runs |
| ✅ | Bottom quartile at midpoint reaches top 3 | 6.9% | 5–15% of runs |
| ✅ | Midpoint leader wins | 52.4% | ≤60% |
| ❌ | Active traders vs inactive (final gold) | +55.3% | +5–15% |
| ✅ | Player stock mean |Δ| per tick | 0.20% | <2% |
| ✅ | Crypto mean |Δ| per tick | 8.3% | 5–15% |
| ✅ | Runs where any security sits at a band edge >20% of the night | 2.8% | ≤5% of runs |

- Winner gold (mean): 73.0
- Games per night (mean): 16.3
- Coalition on crypto: ROI 18.7%, +20.4/member, profitable 88%
- Coalition on dead stock: ROI 21.3%, +23.8/member, profitable 100%
- Pinned >20% by kind: player 2.8%, index 0.0%, crypto 0.0%, event 0.0%, dead 0.0%
- End-of-night profit fee (mean total): 0.4
- Bounty paid per night (mean total): 23.9
- Kingfalls per night (mean): 8.1
- Winner by agent type: holder 0%, trader 30%, selfPumper 0%, coalition 37%, gambler 32%, random 0%, inactive 0%
- Mean final gold by agent: holder 33.4, trader 51.9, selfPumper 30.5, coalition 54.2, gambler 54.6, random 33.9, inactive 33.4
- Mean trading P&L by agent: holder -0.4, trader +18.2, selfPumper -0.6, coalition +22.1, gambler +20.8, random +0.3, inactive +0.0

### 20 players

| | Target | Result | Goal |
|---|---|---|---|
| ❌ | Market share of winner's final gold (mean) | 52% (median 53%) | 10–30% |
| ❌ | Solo pump with no rank change is unprofitable | 46% of runs | ≥80% of runs |
| ❌ | 3-player coalition pump (crypto/dead) makes a modest profit | ROI 20.3%, +22.8 gold/member/night, profitable in 95% of runs | ROI 2–15% and profitable in ≥55% of runs |
| ✅ | Bottom quartile at midpoint reaches top 3 | 6.3% | 5–15% of runs |
| ✅ | Midpoint leader wins | 51.2% | ≤60% |
| ❌ | Active traders vs inactive (final gold) | +59.4% | +5–15% |
| ✅ | Player stock mean |Δ| per tick | 0.22% | <2% |
| ✅ | Crypto mean |Δ| per tick | 8.4% | 5–15% |
| ✅ | Runs where any security sits at a band edge >20% of the night | 2.4% | ≤5% of runs |

- Winner gold (mean): 83.0
- Games per night (mean): 26.6
- Coalition on crypto: ROI 19.2%, +21.5/member, profitable 89%
- Coalition on dead stock: ROI 21.3%, +24.1/member, profitable 100%
- Pinned >20% by kind: player 2.4%, index 0.0%, crypto 0.0%, event 0.0%, dead 0.0%
- End-of-night profit fee (mean total): 0.8
- Bounty paid per night (mean total): 57.3
- Kingfalls per night (mean): 13.4
- Winner by agent type: holder 0%, trader 33%, selfPumper 0%, coalition 19%, gambler 48%, random 0%, inactive 0%
- Mean final gold by agent: holder 34.5, trader 54.8, selfPumper 29.7, coalition 55.3, gambler 57.2, random 34.6, inactive 34.4
- Mean trading P&L by agent: holder -0.2, trader +20.3, selfPumper -0.9, coalition +22.8, gambler +22.3, random +0.4, inactive +0.0

## tuned-fee

3% trade fee, faster player-price reversion, calmer crypto, gentler dead stock. Uses only existing settings.

Changes from defaults:

```json
{
  "market": {
    "feeFrac": 0.03,
    "player": {
      "reversion": 0.3
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
    }
  }
}
```

### 12 players

| | Target | Result | Goal |
|---|---|---|---|
| ✅ | Market share of winner's final gold (mean) | 23% (median 21%) | 10–30% |
| ✅ | Solo pump with no rank change is unprofitable | 100% of runs | ≥80% of runs |
| ✅ | 3-player coalition pump (crypto/dead) makes a modest profit | ROI 5.7%, +6.3 gold/member/night, profitable in 83% of runs | ROI 2–15% and profitable in ≥55% of runs |
| ✅ | Bottom quartile at midpoint reaches top 3 | 8.7% | 5–15% of runs |
| ✅ | Midpoint leader wins | 50.2% | ≤60% |
| ✅ | Active traders vs inactive (final gold) | +12.4% | +5–15% |
| ✅ | Player stock mean |Δ| per tick | 0.22% | <2% |
| ✅ | Crypto mean |Δ| per tick | 5.9% | 5–15% |
| ✅ | Runs where any security sits at a band edge >20% of the night | 4.2% | ≤5% of runs |

- Winner gold (mean): 52.4
- Games per night (mean): 16.3
- Coalition on crypto: ROI 4.4%, +4.8/member, profitable 67%
- Coalition on dead stock: ROI 7.0%, +7.8/member, profitable 100%
- Pinned >20% by kind: player 4.2%, index 0.0%, crypto 0.0%, event 0.0%, dead 0.0%
- End-of-night profit fee (mean total): 0.3
- Bounty paid per night (mean total): 21.9
- Kingfalls per night (mean): 8.2
- Winner by agent type: holder 8%, trader 31%, selfPumper 0%, coalition 34%, gambler 19%, random 1%, inactive 6%
- Mean final gold by agent: holder 32.6, trader 37.6, selfPumper 14.9, coalition 38.3, gambler 34.7, random 30.4, inactive 33.5
- Mean trading P&L by agent: holder -0.9, trader +4.2, selfPumper -15.9, coalition +6.3, gambler +1.2, random -2.8, inactive +0.0

### 20 players

| | Target | Result | Goal |
|---|---|---|---|
| ✅ | Market share of winner's final gold (mean) | 29% (median 30%) | 10–30% |
| ✅ | Solo pump with no rank change is unprofitable | 100% of runs | ≥80% of runs |
| ✅ | 3-player coalition pump (crypto/dead) makes a modest profit | ROI 6.1%, +6.8 gold/member/night, profitable in 86% of runs | ROI 2–15% and profitable in ≥55% of runs |
| ✅ | Bottom quartile at midpoint reaches top 3 | 6.9% | 5–15% of runs |
| ✅ | Midpoint leader wins | 44.1% | ≤60% |
| ✅ | Active traders vs inactive (final gold) | +13.6% | +5–15% |
| ✅ | Player stock mean |Δ| per tick | 0.24% | <2% |
| ✅ | Crypto mean |Δ| per tick | 6.0% | 5–15% |
| ✅ | Runs where any security sits at a band edge >20% of the night | 3.5% | ≤5% of runs |

- Winner gold (mean): 57.8
- Games per night (mean): 26.6
- Coalition on crypto: ROI 5.2%, +5.7/member, profitable 72%
- Coalition on dead stock: ROI 7.0%, +7.9/member, profitable 100%
- Pinned >20% by kind: player 3.5%, index 0.0%, crypto 0.0%, event 0.0%, dead 0.0%
- End-of-night profit fee (mean total): 0.5
- Bounty paid per night (mean total): 52.5
- Kingfalls per night (mean): 13.4
- Winner by agent type: holder 4%, trader 42%, selfPumper 0%, coalition 22%, gambler 27%, random 1%, inactive 4%
- Mean final gold by agent: holder 33.5, trader 38.8, selfPumper 14.7, coalition 39.1, gambler 36.0, random 31.4, inactive 34.2
- Mean trading P&L by agent: holder -0.8, trader +4.6, selfPumper -15.9, coalition +6.8, gambler +1.6, random -2.6, inactive +0.0

## tuned-fee-cap30

As tuned-fee, with slower player reversion (0.2) and invest cap 30.

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
| ✅ | Bottom quartile at midpoint reaches top 3 | 7.5% | 5–15% of runs |
| ✅ | Midpoint leader wins | 49.2% | ≤60% |
| ✅ | Active traders vs inactive (final gold) | +7.4% | +5–15% |
| ✅ | Player stock mean |Δ| per tick | 0.21% | <2% |
| ✅ | Crypto mean |Δ| per tick | 5.9% | 5–15% |
| ✅ | Runs where any security sits at a band edge >20% of the night | 3.7% | ≤5% of runs |

- Winner gold (mean): 51.2
- Games per night (mean): 16.3
- Coalition on crypto: ROI 4.4%, +4.9/member, profitable 66%
- Coalition on dead stock: ROI 7.0%, +7.8/member, profitable 100%
- Pinned >20% by kind: player 3.7%, index 0.0%, crypto 0.0%, event 0.0%, dead 0.0%
- End-of-night profit fee (mean total): 0.2
- Bounty paid per night (mean total): 22.1
- Kingfalls per night (mean): 8.2
- Winner by agent type: holder 8%, trader 26%, selfPumper 0%, coalition 38%, gambler 20%, random 1%, inactive 7%
- Mean final gold by agent: holder 32.5, trader 35.9, selfPumper 15.1, coalition 38.5, gambler 34.5, random 30.4, inactive 33.5
- Mean trading P&L by agent: holder -0.9, trader +2.6, selfPumper -15.8, coalition +6.4, gambler +1.0, random -2.9, inactive +0.0

### 20 players

| | Target | Result | Goal |
|---|---|---|---|
| ✅ | Market share of winner's final gold (mean) | 28% (median 28%) | 10–30% |
| ✅ | Solo pump with no rank change is unprofitable | 100% of runs | ≥80% of runs |
| ✅ | 3-player coalition pump (crypto/dead) makes a modest profit | ROI 6.2%, +6.9 gold/member/night, profitable in 87% of runs | ROI 2–15% and profitable in ≥55% of runs |
| ✅ | Bottom quartile at midpoint reaches top 3 | 6.8% | 5–15% of runs |
| ✅ | Midpoint leader wins | 46.0% | ≤60% |
| ✅ | Active traders vs inactive (final gold) | +9.1% | +5–15% |
| ✅ | Player stock mean |Δ| per tick | 0.23% | <2% |
| ✅ | Crypto mean |Δ| per tick | 6.0% | 5–15% |
| ✅ | Runs where any security sits at a band edge >20% of the night | 3.5% | ≤5% of runs |

- Winner gold (mean): 56.0
- Games per night (mean): 26.6
- Coalition on crypto: ROI 5.4%, +6.0/member, profitable 73%
- Coalition on dead stock: ROI 7.0%, +7.9/member, profitable 100%
- Pinned >20% by kind: player 3.5%, index 0.0%, crypto 0.0%, event 0.0%, dead 0.0%
- End-of-night profit fee (mean total): 0.5
- Bounty paid per night (mean total): 53.1
- Kingfalls per night (mean): 13.5
- Winner by agent type: holder 4%, trader 37%, selfPumper 0%, coalition 22%, gambler 32%, random 1%, inactive 3%
- Mean final gold by agent: holder 33.5, trader 37.3, selfPumper 14.9, coalition 39.2, gambler 36.2, random 31.5, inactive 34.2
- Mean trading P&L by agent: holder -0.8, trader +3.0, selfPumper -15.7, coalition +6.9, gambler +1.9, random -2.6, inactive +0.0

## tuned-slippage

NEW MECHANIC: traders pay half their own price impact at execution. 2% fee, narrower fair range (20–80%), cap 30.

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
    "investCap": 30
  }
}
```

### 12 players

| | Target | Result | Goal |
|---|---|---|---|
| ✅ | Market share of winner's final gold (mean) | 14% (median 12%) | 10–30% |
| ✅ | Solo pump with no rank change is unprofitable | 100% of runs | ≥80% of runs |
| ✅ | 3-player coalition pump (crypto/dead) makes a modest profit | ROI 2.6%, +2.9 gold/member/night, profitable in 74% of runs | ROI 2–15% and profitable in ≥55% of runs |
| ✅ | Bottom quartile at midpoint reaches top 3 | 7.3% | 5–15% of runs |
| ✅ | Midpoint leader wins | 49.0% | ≤60% |
| ❌ | Active traders vs inactive (final gold) | +4.6% | +5–15% |
| ✅ | Player stock mean |Δ| per tick | 0.20% | <2% |
| ✅ | Crypto mean |Δ| per tick | 5.9% | 5–15% |
| ✅ | Runs where any security sits at a band edge >20% of the night | 3.6% | ≤5% of runs |

- Winner gold (mean): 47.7
- Games per night (mean): 16.4
- Coalition on crypto: ROI 0.3%, +0.3/member, profitable 48%
- Coalition on dead stock: ROI 4.9%, +5.5/member, profitable 100%
- Pinned >20% by kind: player 3.6%, index 0.0%, crypto 0.0%, event 0.0%, dead 0.0%
- End-of-night profit fee (mean total): 0.2
- Bounty paid per night (mean total): 21.3
- Kingfalls per night (mean): 8.1
- Winner by agent type: holder 12%, trader 30%, selfPumper 0%, coalition 32%, gambler 11%, random 3%, inactive 12%
- Mean final gold by agent: holder 32.4, trader 35.0, selfPumper 15.0, coalition 34.8, gambler 28.0, random 30.0, inactive 33.5
- Mean trading P&L by agent: holder -0.9, trader +1.6, selfPumper -15.9, coalition +2.9, gambler -5.4, random -3.2, inactive +0.0

### 20 players

| | Target | Result | Goal |
|---|---|---|---|
| ✅ | Market share of winner's final gold (mean) | 20% (median 19%) | 10–30% |
| ✅ | Solo pump with no rank change is unprofitable | 100% of runs | ≥80% of runs |
| ✅ | 3-player coalition pump (crypto/dead) makes a modest profit | ROI 2.9%, +3.3 gold/member/night, profitable in 76% of runs | ROI 2–15% and profitable in ≥55% of runs |
| ✅ | Bottom quartile at midpoint reaches top 3 | 6.9% | 5–15% of runs |
| ✅ | Midpoint leader wins | 42.3% | ≤60% |
| ✅ | Active traders vs inactive (final gold) | +5.8% | +5–15% |
| ✅ | Player stock mean |Δ| per tick | 0.22% | <2% |
| ✅ | Crypto mean |Δ| per tick | 6.0% | 5–15% |
| ✅ | Runs where any security sits at a band edge >20% of the night | 3.7% | ≤5% of runs |

- Winner gold (mean): 52.1
- Games per night (mean): 26.7
- Coalition on crypto: ROI 0.9%, +1.0/member, profitable 52%
- Coalition on dead stock: ROI 4.9%, +5.5/member, profitable 100%
- Pinned >20% by kind: player 3.7%, index 0.0%, crypto 0.0%, event 0.0%, dead 0.0%
- End-of-night profit fee (mean total): 0.4
- Bounty paid per night (mean total): 51.2
- Kingfalls per night (mean): 13.5
- Winner by agent type: holder 8%, trader 39%, selfPumper 0%, coalition 22%, gambler 21%, random 2%, inactive 7%
- Mean final gold by agent: holder 33.5, trader 36.0, selfPumper 14.6, coalition 35.5, gambler 29.7, random 31.2, inactive 34.0
- Mean trading P&L by agent: holder -0.8, trader +1.9, selfPumper -15.9, coalition +3.3, gambler -4.6, random -2.8, inactive +0.0

## Sensitivity of "tuned-fee-cap30" to behavior assumptions

500 nights per cell. Cell = 12p / 20p.

| Assumption | T1 | T2 | T3 | T4 | T5 | T6 | T7a | T7b | T8 |
|---|---|---|---|---|---|---|---|---|---|
| Players check phones twice as often mid-game | 20% / 27% | 100% / 100% | ROI 6.1% / ROI 6.4% | 7.8% / 6.4% | 49.2% / 44.0% | ❌-2.1% / ❌-7.2% | 0.22% / 0.24% | 5.9% / 6.0% | 4.4% / 2.8% |
| Players barely touch phones mid-game | 22% / 28% | 99% / 100% | ROI 5.4% / ROI 6.5% | 11.0% / 6.4% | 47.0% / 44.4% | ❌+18.1% / ❌+19.3% | 0.20% / 0.22% | 5.9% / 5.9% | 3.4% / 3.4% |
| Games are more luck than skill | 21% / 28% | 100% / 100% | ROI 5.4% / ROI 6.0% | 10.0% / 7.2% | 50.0% / 47.4% | +8.7% / +10.4% | 0.22% / 0.23% | 5.9% / 6.0% | 3.6% / 3.6% |
| Games are more skill than luck | 20% / 25% | 100% / 100% | ROI 5.8% / ROI 5.8% | 8.8% / 5.6% | 49.6% / 44.0% | +6.3% / +5.4% | 0.21% / 0.23% | 5.9% / 6.0% | 4.8% / 3.4% |
| Coalition pumps every 10–20 min | 27% / ❌31% | 100% / 100% | ROI 6.5% / ROI 6.8% | ❌4.8% / ❌4.6% | 48.0% / 45.6% | +6.3% / +8.1% | 0.21% / 0.23% | 6.0% / 6.0% | 3.6% / 3.0% |

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
    "coopLossMult": 0.25
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
    "investCap": 30,
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