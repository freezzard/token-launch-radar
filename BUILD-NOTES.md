# BUILD-NOTES — token-radar-01 entry ("Token Launch Radar")

Status: **built and locally verified; NOT submitted, no bundle run** (per parent instructions).

- Entry code HEAD: `3fa923c4eec6dfa9c56a4f345e5b3cac8e8df23d` (this notes file is committed on top of it)
- Builder git identity: `freezzard <freezzard@users.noreply.github.com>`; `.makefun/owner.json` names wallet `G5CML4VnkNH8EMfmyfibRvE8zocQMEWvKfn3RXvcsoip`
- Reproduce the run: `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ~/.makefun/token-radar-01-kit/token-radar-01-kit/input/snapshot.json` (Node 24, stdlib only, no network; deterministic — same snapshot, same bytes)

## File inventory (repo)

| Path | Bytes | Role |
|---|---|---|
| `LICENSE` | ~1.1 KB | MIT |
| `.makefun/owner.json` | 61 | ownership claim (wallet above) |
| `vendor/makefun-board.ts` | — | kit library, **byte-exact copy** of the starter's (verified with `cmp`) |
| `lib/model.ts` | 23,367 | peer-ratio value model, farm-plan generator, snapshot parser, board validator |
| `main.ts` | 4,419 | entry program: board.json + data.js + copies dashboard/ & screenshots/ + dossier.json |
| `dashboard/index.html` | 3,303 | page shell: masthead stats, model strip, controls, board, live-tokenized block, detail mount |
| `dashboard/app.css` | 7,701 | ink-navy / phosphor-green / amber theme, monospace numerals |
| `dashboard/app.js` | 11,465 | rendering, search/category/chain/watchlist filters, column sorting, detail view, `#/` `#/protocol/<slug>` `#/filter/<category>` hash routing |
| `screenshots/1-board.png` | 236,770 | board view, 1440×1000 |
| `screenshots/2-detail.png` | 238,028 | detail view of rank 1 (Coinbase Bridge), 1440×1000 |
| `screenshots/3-filtered.png` | 232,210 | board filtered to category Dexs (26 rows), 1440×1000 |

Dashboard source total: **22,469 bytes** (dossier text is 22,735 bytes of the 65,536 cap — the judge sees every file whole, no truncation marker).

## The model, in words

Peers first: every snapshot protocol whose token already trades (market cap present) reveals a ratio, mcap ÷ TVL. Ratios outside [0.02, 30] are discarded as broken records (109 peers survive). A category with ≥3 surviving peers prices at its **median ratio** (13 categories qualify; e.g. Dexs 0.342, Bridge 0.989, Lending 0.247); all other categories fall back to the **global median, 0.310**.

Each pre-token protocol (CoinGecko id, symbol and market cap all null — 342 of 758) is priced:

```
implied = TVL × categoryRatio × momentum × maturity × breadth
momentum = clamp(1 + change_7d/100, 0.7, 1.6)     (null change → 1.0)
maturity = 0.8 + 0.1 × min(age in years, 4)       (unknown listing date → 0.9)
breadth  = min(1 + 0.03 × (chains − 1), 1.15)
implied_value_usd = max(1, round(implied))
```

Rows are ordered by the unrounded value (ties → TVL → slug), ranked 1..N, and rounded-value ties are nudged down by the row's index in dollars so values **strictly decrease** down the board. Total implied value across the board: **$43,772,669,631**. Rank 1: Coinbase Bridge, $7,351,890,859 (TVL $7.23B × Bridge ratio 0.9885 × momentum 0.9434 × maturity 0.9736 × breadth 1.1200).

Farm plans: 5 steps per row from 11 category-family templates (Dexs, Lending, Yield, Derivatives, Bridge, Liquid Staking, Stable, RWA, Curator, Exchange, Other), each step woven with the protocol's own name, primary chain, chain count, TVL and 7-day change, with concrete position sizing ($50–$500 by TVL band), gas bands per chain (Ethereum $6–$15, Bitcoin $3–$12, most others $0.10–$2), weekly cadences and a 6–10 week hold by protocol age.

## Board results

- Rows: **342** (every pre-token protocol in the snapshot; spec range 100–4,000)
- Watchlist coverage: **40 / 40** (all present as rows; watchlist rows are badged on the page, sub-floor rows are badged "Early")
- Tokenized protocols are never ranked: the top 36 by market cap appear in a separate "Already tokenized — set apart" table whose ratios are the model's peer evidence.

## Gate self-check (23 assertions against `out/`, all PASS)

- **dashboard_files**: index.html + app.css + app.js present; 3 files, 22,469 bytes (≤400 files, ≤4 MiB); all names plain; **no http(s) in any HTML attribute value, `<style>` body, inline-script import, CSS file, or JS import/export/require specifier**.
- **board_file**: 342 rows; every slug exists in the snapshot; slugs unique; names non-empty; values positive whole dollars ≤ 10¹⁴; board.json 630,921 bytes ≤ 8 MiB; no shared single value.
- **sorted_by_value**: ranks exactly 1..342; implied values strictly decreasing by rank.
- **coverage**: 40/40 watchlist slugs present, none missing.
- **farm_steps**: every row has 5 steps; every step 20–600 chars once trimmed (observed range across rank 1: 197–309).
- **screenshots**: exactly 3 PNGs, each a whole PNG at 1440×1000 (long side 1440 ≤ 1440, short side 1000 ≥ 800), sizes 236,770 / 238,028 / 232,210 bytes (each ≤ 512 KiB; ~232–238 KB each, so all three together stay far inside the 1.5 MiB dossier budget).
- **dossier_matches**: `out/dossier.json` (966,598 bytes ≤ 1.5 MiB) regenerated independently with the vendored `buildDossier(out, {text_max_bytes: 65536, screenshots caps, dashboard caps})` — **byte-identical**; dossier text 22,735 bytes with **no truncation**.

## Things the parent should know

1. **Screenshot capture in this sandbox**: the instructed one-shot `chrome --headless=new --screenshot` exits without rendering in this Chromium build, and `http://127.0.0.1` pages are blocked by its Local Network Access checks. What worked: launch `/opt/meta-chromium/chrome` headless with `--remote-debugging-port=9222` plus the build's required WebGL policy switches (`--hatch-webgl-allowed-domains-file` + `--hatch-webgl-allowed-domains-sha256`, file = header line `hatch-webgl-allowed-domains-v1` then sorted registrable domains), drive it over CDP from Node, and load the dashboard via `file://` URLs (data.js resolves relatively, fully offline — same bytes the grader serves). The three PNGs are genuine renders of the final `out/` build; each was eyeballed (board, rank-1 detail with factor breakdown and farm plan, Dexs filter with 26 rows) and re-captured after the revision pass.
2. **Top of the board**: ranks 1–6 are bridge/wrapped products (Coinbase Bridge, WBTC, Binance Bitcoin, USDT0, Base Bridge, CCIP). The snapshot records no token fields for them, so the specified model ranks them — the house watchlist excludes them from the *floor* for exactly this reason, but the task spec says to rank **all** pre-token protocols, and the rules allow boards to carry non-watchlist rows. The page badges them "Early", and all copy says a protocol "records no token", never that it has none. If the parent prefers, these could be de-emphasized — but that would deviate from the specified model, so it was left as-is and flagged here instead.
3. **Revision pass** (commit `3fa923c…`): chain-aware gas bands (Bitcoin was quoted L2 prices), bridge farm action no longer hardcodes "from Ethereum", a stray ligature in a category match removed, and `tokenized_count` corrected to count market-cap-bearing protocols (144). Outputs re-ran, all 23 checks re-passed, detail screenshot re-captured.
4. `out/` is a build artifact and is **not** committed; regenerate with the command at the top. Git status is clean at the notes commit.

## Revision 2 — set-apart ranking exclusion (resolves flagged item 2 above)

The board no longer ranks products of tokens that already trade. `lib/model.ts` gains `setApartReason()` — a ranking-exclusion predicate mirroring the watchlist's product exclusions, with **no TVL condition** — and the model version moves to **peer-ratio-3**. A pre-token protocol is set apart when any of these holds (checked in this order, so the stated reason is deterministic):

- category is Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC, or CEX;
- the name ends in a version marker (`\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$`);
- the name carries the whole word *wrapped*, *staked* or *staking* (case-insensitive);
- the name opens with an exchange brand (Binance, Coinbase, Bybit, Kraken, Bitget, OKX, Bitfinex, Gemini).

Each set-apart protocol carries a short reason ("wrapped or bridged product of a token that already trades", "staking product", "exchange product", "versioned product of another protocol") and joins the set-apart table the dashboard already renders for tokenized protocols: `live` is now the top 36 tokenized by market cap followed by every set-apart pre-token protocol by TVL, the latter with market cap and ratio shown as "—" and the reason printed under the name ("records no token — set apart: …"). The live-block heading and note in `dashboard/index.html` and the masthead tagline were reworded to describe both groups. Peer-ratio pricing is **unchanged** (same 109 usable peers, global median 0.310, 13 categories priced on their own peers); only ranking membership changed, and the model formula text on the page now states the set-apart rule.

Results on the sealed snapshot:

- **Excluded: 144 of 342 pre-token protocols** — by stated reason: 43 wrapped/bridged, 48 staking, 42 exchange, 11 versioned. The old top 8 (Coinbase Bridge, WBTC, Binance Bitcoin, USDT0, Base Bridge, CCIP, Bybit, Bitfinex) are all set apart; none of the 40 watchlist slugs is caught by the predicate.
- **New board: 198 rows** (was 342). **New rank 1: Steakhouse Financial (Risk Curators), $911,067,300**; then Sentora Curator $869,462,315 and Gauntlet $563,755,893.
- **New total implied value: $6,348,129,668** (was $43,772,669,631).
- Side effect worth knowing: the Dexs filter now shows 21 rows (was 26) — five versioned Dexs products (RocketSwap Anubis V2, BDEX V3, Metric V1, BulbaSwap V3, PotatoSwap V2) are set apart as versioned products.

Gate re-check against the rebuilt `out/` (same 23 assertions as the original self-check, plus an independent dossier rebuild): **23 / 23 PASS** — rows 198 (inside 100–4,000); ranks exactly 1..198; implied values strictly decreasing; watchlist coverage still **40 / 40**; every row 5 farm steps, each 20–600 trimmed chars; no http(s) in any HTML attribute value, `<style>` body, inline-script import, CSS file, or JS import/export/require specifier; dashboard 3 files, 23,107 bytes; `out/dossier.json` (1,005,354 bytes, ≤ 1.5 MiB) regenerates **byte-identical** via the vendored `buildDossier` with `text_max_bytes: 65536`, dossier text 23,314 bytes with no truncation.

Screenshots re-captured from the fresh `out/` by the same CDP-over-`file://` method (headless Chromium, port 9222, 1440×1000, eyeballed): `1-board.png` 259,118 bytes (new board, rank 1 Steakhouse Financial), `2-detail.png` 238,825 bytes (detail of the new rank 1, factor breakdown + farm plan), `3-filtered.png` 237,651 bytes (Dexs filter, 21 rows). Each ≤ 512 KiB.
