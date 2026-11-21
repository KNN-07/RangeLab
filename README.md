# RangeLab

An installable, offline-first poker study app for no-limit Texas Hold’em. Explore preflop ranges, solve custom heads-up spots, drill decisions, and replay hand histories. All calculations and imported hands stay in the browser.

**[Open RangeLab on GitHub Pages](https://knn-07.github.io/RangeLab/)**

## Start studying

1. Open **Study**. The initial spot is a 100 bb big blind facing a 2.5 bb button open. Select any of the 169 starting-hand classes to inspect its mixed strategy, action values, and equity.
2. Choose **Explore a flop** to carry the opener’s raising range and defender’s calling range into the postflop solver. You can also enter a board and two weighted ranges directly in **Solver**.
3. Use **Train this spot** for a preflop drill, or practice a solved decision inside the postflop solver. Saved spots, setups, and practice records are local to the device.

## Feature coverage

The scope follows the study, custom solving, training, analysis, and reporting workflows in GTO Wizard’s public guides. RangeLab uses its own models and sampled data.

| Workflow | RangeLab implementation | Reference workflow |
| --- | --- | --- |
| Study | Interactive 13×13 matrix, action frequencies, equity and EV views, hand filters, table positions, action line, saved spots, and action-weighted export | [Study mode](https://help.gtowizard.com/study-mode/) |
| Custom solving | Flop, turn, and river boards, weighted ranges, custom pot and bet sizes, stack-capped advanced trees, per-combo strategy and EV, and solve export | [Custom solutions](https://help.gtowizard.com/how-to-build-custom-solutions/) |
| Opponent modeling | Hand-specific shove or call locks in preflop push/fold, plus an IP call-frequency lock facing opening bets in either postflop tree | [Nodelocking](https://help.gtowizard.com/how-to-use-nodelocking/) |
| Play through a line | Follow bets, calls, and raises, see the pot change, select the next community card, and re-solve from the resulting ranges | [Solution browser](https://help.gtowizard.com/study-mode/) |
| Practice | Combination-weighted preflop drills, hand and decision filters, saved drills, model frequency and EV feedback, history, and reach-weighted postflop practice | [Trainer](https://help.gtowizard.com/how-to-use-the-trainer/) |
| Review hands | Paste or import English PokerStars NLHE cash histories, rank supported preflop decisions by estimated EV loss, replay actions, and review eligible heads-up postflop decisions | [Analyze mode](https://help.gtowizard.com/analyze-mode-guide/) |
| Compare and report | Compare opposing ranges, inspect equities and hand classes, generate batch reports for up to 12 chosen flops, and export CSVs | [Aggregate reports](https://help.gtowizard.com/aggregate-reports-guide/) |
| Tournament study | Compare chip-EV and payout-aware push/fold strategies when a final table folds to the blinds. Enter up to nine stacks and a payout ladder. | [GTO Wizard feature overview](https://gtowizard.com/) |

## Reading solver results

- **Six-max preflop** uses position-based opening estimates, sampled showdown equity, and a postflop realization model. Treat the chart and its EV values as study estimates.
- **Heads-up push/fold** runs CFR+ on all 169 starting-hand classes with suit-combination and card-removal weights. Its payoff table uses 12,288 seeded samples per distinct class matchup. The engine reports the best-response gap in the sampled game.
- **Postflop** solves one betting street at a time. The standard tree allows a bet from either player, followed by a call or fold. The advanced tree allows two opening sizes and one raise. Remaining cards run to showdown. Wide range products and flop runouts are sampled. Turn and river showdown evaluations cover all remaining runouts for each selected matchup. The displayed convergence gap applies to that betting tree and sample.
- **Tournament ICM** models a shove-or-fold decision between the blinds with the remaining players already folded. The model handles split pots, unequal stacks, and ordinary payout ladders. Action values use percentage points of the prize pool.

The current scope is NLHE. Full multistreet equilibrium solutions, multiway postflop solving, Omaha, bounty models, a commercial presolved database, and cloud account synchronization are outside this release.

## Install and run offline

Open the hosted app once and let its offline cache finish. The download icon opens the installation prompt or platform-specific instructions. The engine-status control shows offline readiness. WebGPU accelerates simulations and bulk showdown-equity evaluation on compatible devices. CPU evaluation is available automatically.

On Windows, double-click **Run-RangeLab.cmd** with Python 3 installed. You can also launch the app from the repository root with this command.

```sh
python -m http.server 8734 --bind 127.0.0.1 --directory rangelab/dist
```

Open [the local app](http://127.0.0.1:8734/). The service worker requires HTTPS or localhost.

## Development

The static app is in `rangelab/dist/`. It has no installation or bundling step. Run the numerical regression suite with `node --test`. The seeded equity-table generator and updater live in `rangelab/tools/`. The GitHub Actions workflow publishes the static app and versions its offline cache for each deployed commit.
