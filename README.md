# The Majority That Slipped Away — India 2024 Lok Sabha

Scrollytelling web experience on India's 2024 general election, modelled on The Washington Post's 2024 US vote map.

**DATA STATUS: INCOMPLETE.** The map uses the local 2019 boundary GeoJSON and 2024 constituency data. The constituency winner file has gaps. National and state-level election metrics come from `data/national.json`; constituency candidate results and available margins come from `data/GE2024.json`. Unavailable constituency winners remain neutral.

## Project structure

```
index.html           # Main scrollytelling page
How India voted in 2024, vote by vote.html  # SVG map and accessible seat details
style.css            # Main page styles and theme palettes
script.js            # Three.js boundary map, CSV binding, camera and story chapters
data/india_pc_2019_simplified.geojson  # 543 parliamentary constituency boundaries
data/lok_sabha_2024_constituency_winners.csv  # Constituency winners and parties
data/lok_sabha_2024_party_results.csv  # Party seat totals and vote shares
data/lok_sabha_2024_state_seats.csv  # State/UT seat totals
data/GE2024.json   # Constituency winners, runners-up, and available margins
data/national.json # National, state-turnout, and polling-station coverage statistics
data/film.bin      # 24,000 sampled polling-station coordinates used by the map and particle sequence
data/constituencies.json   # Older placeholder sample; not used by the current map pages
vendor/              # Pinned Three.js and D3 builds used by the static pages
README.md            # This file
```

## Features implemented

- **North-up constituency map** — the 543 polygons use longitude/latitude coordinates from `data/india_pc_2019_simplified.geojson`, fitted to the viewport.
- **Full-screen Three.js backdrop** — the interactive map stays fixed across the viewport while translucent story cards scroll above it.
- **BJP result highlight** — verified BJP constituency winners are orange; other constituencies remain neutral.
- **Scroll-linked transitions** — the Three.js camera pans and zooms continuously between chapter views, while constituency fills fade between national and state focus.
- **Data-driven chapters** — election totals, party shares, state turnout, and polling-station coverage in the main story come from `data/national.json`; state constituency chapters also use the state-seat and winner files.
- **Scroll-scrubbed dot sequence** — the 24,000 mapped sample dots interpolate their positions, colours, and opacity with chapter scroll: polling-station map to state turnout, then the party-coloured 543-seat hemicycle, vote-share/seat-share comparison, and back to the national map. The hemicycle-to-share transition uses a staggered, arcing particle path and reverses smoothly when scrolling backward. The ECI total of 10,51,016 polling stations is shown separately from the mapped sample.
- **Post-margin data chapters** — verified electorate and polling-station totals, state turnout rankings, booth-atlas coverage, and seat/vote-share comparisons follow the victory-margin view.
- **Compact ranking charts** — D3 renders top/bottom five comparisons as compact, labelled SVG bar charts rather than tall stacks of HTML rows.
- **Lok Sabha seat chart** — one dot per seat, grouped by the official national and state party categories, follows the vote-share comparison.
- **Seat inspection** — the vote-by-vote page supports pointer and keyboard focus for constituency winner details.
- **Theme support** — the Light mode toggle replaces the north-up badge on both story pages; the selected theme is saved and shared between them.
- **Reduced-motion support** — map and chapter transitions respect the operating-system preference; the on-screen Particle motion toggle lets readers explicitly enable or disable scroll-linked motion.
- **Honest coverage reporting** — party totals and mapped constituency winner records are shown separately when their counts differ.

## Running locally

Serve the project locally so the browser can fetch the map and election data:

```bash
npm install
npm run dev
```

Then open `http://localhost:8080/`.

## Deploying to GitHub Pages

The site is fully static. `vendor/three.module.js` and `vendor/d3.min.js` are committed so Pages does not need `npm install`, and all asset URLs are relative so the site works from a project URL such as `https://<user>.github.io/<repo>/`.

1. Push `main` to a GitHub repository.
2. In the repository, open **Settings → Pages**.
3. Set **Source** to *Deploy from a branch*, branch `main`, folder `/ (root)`, then save.
4. The site publishes at `https://<user>.github.io/<repo>/`.

The `.nojekyll` file stops Jekyll from processing the data files. Pages on a private repository requires GitHub Pro, Team, or Enterprise; the published site is still publicly readable.

## Data pipeline (to build before publishing)

1. Download constituency-wise 2024 and 2019 results from **indiavotes.com** (Lok Sabha pages + identified CSV).
2. Verify and complete the constituency winner rows; the current file does not identify a winner for every boundary.
3. If adding vote piles or margins, source and join constituency-level candidate totals from verified ECI results. The current local CSVs do not contain those fields.
4. Keep `data/india_pc_2019_simplified.geojson` as the base boundary source and document seats affected by later delimitation.
5. Reconcile the constituency-level party records with `data/lok_sabha_2024_party_results.csv` before treating map coverage as complete.

## Narrative guardrails

- Never claim "Modi lost" or "BJP lost the election."
- Accurate framing: **NDA won a majority; BJP fell short of 272 on its own (240 seats).** Present figures neutrally.
- Show both alliances' gains and losses with equal prominence.

## Known data gaps (draft)

- Constituency winner data is incomplete: some seats have no verified candidate/party record.
- The constituency CSV does not provide complete candidate vote totals, runner-up, margin, turnout, or NOTA data; use `data/GE2024.json` for candidate results and margins where available.
- The constituency winner file remains incomplete, so mapped constituency winner counts can differ from official national totals in `data/national.json`.
- Polling-station geolocation coverage is partial: the source reports 789,904 geolocated stations of 1,051,016 ECI stations, with some states/UTs not yet represented.
- Party-level aggregates can differ from the count of mapped winners while constituency records are incomplete.

## Credits & sourcing

- Data: indiavotes.com; Election Commission of India.
- Boundaries: DataMeet parliamentary constituencies (simplified), CC BY-SA 2.5 India.
- Format inspired by The Washington Post's 2024 US vote map.
