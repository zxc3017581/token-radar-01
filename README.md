# Token Radar — radar-2

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols, ranks every
pre-token protocol by implied value, and serves a static dashboard with a per-protocol farm plan.

## The model

Implied value follows only from the snapshot's own figures:

```
comparable = median(mcap_usd / tvl_usd) over the category's live protocols (n >= 3),
             else the global median; clamped to [0.05, 1.5], rounded to 4 decimals
base       = tvl_usd x comparable
growth     = clamp(change_7d, -60, 120) per cent
growthMult = 1 + (growth / 100) x 0.5
maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age unknown: 365 days)
chainMult  = 1 + min(max(chains - 1, 0), 10) x 0.02
implied    = max(1, round(base x growthMult x maturity x chainMult))
```

The base multiple is the category's own comparable: a pre-token DEX is worth what live DEXs
trade at per dollar of TVL in the same snapshot; a pre-token lender is worth what live lenders
trade at. Age is the time since first listing — how long the protocol has run with no token.
Chain breadth is a small premium for distribution, capped so a protocol on forty chains does
not outrank its own TVL. No protocol name is special-cased.

The board is the whole watchlist (40 protocols, the floor) plus every rankable pre-token
protocol below the floor — 226 rows in the 2026-11-14 snapshot. Live-token protocols are set
aside with their market caps shown, never mixed into the ranking.

## Run it

```sh
node main.ts --input /input/snapshot.json          # writes /output
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22, standard library only. `main.ts` writes `board.json`, `data.js`, copies
`dashboard/` and `screenshots/` to the output directory, and writes `dossier.json` with the
vendored make.fun library (`vendor/makefun-board.ts`, do not modify).

## The dashboard

`dashboard/` is a static page with no network: it reads `data.js` beside it and renders the
ranked board, a live-token view, search, category and chain filters, a watchlist-only toggle,
a per-protocol detail drawer (model breakdown plus farm plan), and a model sandbox that
re-scores the board under different assumptions without touching `board.json`.

Below the board, an "Implied value by category" table groups the board by category — how many
protocols, how many on the watchlist, the comparable multiple that priced them, their total
implied value, and the strongest protocol. Selecting a category filters the board to it. The
live-token view shows each live protocol's own market-cap / TVL ratio, the numbers the
comparables are medians of. Every detail drawer carries the row's derivation as one sentence,
so the arithmetic is readable without opening the code.

## How to read the board

Start at rank 1: the strongest implied value, not the biggest TVL. A protocol ranks high when
its category trades richly (a high comparable), its TVL is large, it has grown in the last
seven days, it has run a long time with no token, and it runs on many chains. The Comparable
column shows the multiple each row was priced at; a row on the global median (0.241 in this
snapshot) belongs to a category too thin to price itself. The sandbox lets you test the
ranking's sensitivity: scale the comparable, change the growth weight, switch the chain factor
off, and watch the board re-rank.

## Farm plans

Each row carries six steps derived from the protocol's own record — category, chains, TVL,
age. Capital scales with TVL ($50–$250); the weekly action fits the category (borrow for a
lender, swap for a DEX, bridge for a bridge); gas is priced by chain ($8 on Ethereum, $0.50
on the L2s, $0.10 on Solana).

## Layout

- `main.ts` — entrypoint: read the snapshot, score, write the output
- `lib/model.ts` — the model, the board, the farm plans, the snapshot parser
- `vendor/makefun-board.ts` — the vendored make.fun dossier builder (do not modify)
- `dashboard/` — `index.html`, `app.css`, `app.js`
- `screenshots/` — the three required screenshots: board, detail, filtered view
