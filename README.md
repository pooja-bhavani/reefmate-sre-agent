# ReefMate

ReefMate is a live Coral intelligence cockpit. It reads current public data through Coral sources and turns the stream into a ranked signal room.

The app runs real Coral SQL from a small Node server and renders the results into:

- live earthquake radar
- ranked signal queue
- npm package demand pulse
- agent tooling radar
- transparent SQL panel

Sources:

- `usgs_earthquakes.events`
- `npm.search`
- `npm_stats.downloads`

## Run Locally

Make sure Coral is installed and the public sources are available:

```bash
npm run test:coral
```

Start the app:

```bash
npm run dev
```

Open `http://localhost:4173`.

## Coral SQL Commands

Recent global seismic events:

```bash
coral sql --format json "SELECT id, title, magnitude, place, event_time, updated_at, alert, tsunami, significance, latitude, longitude, depth_km, url FROM usgs_earthquakes.events WHERE min_magnitude = 4 ORDER BY event_time DESC LIMIT 12"
```

Most significant recent seismic events:

```bash
coral sql --format json "SELECT id, title, magnitude, place, event_time, alert, tsunami, significance, url FROM usgs_earthquakes.events WHERE min_magnitude = 5 ORDER BY significance DESC LIMIT 6"
```

Agent tooling movement on npm:

```bash
coral sql --format json "SELECT name, version, description, author_username, license, date, npm_url, repository_url, downloads_monthly FROM npm.search WHERE q = 'ai agent framework' ORDER BY downloads_monthly DESC LIMIT 8"
```

Package demand pulse:

```bash
coral sql --format json "SELECT package_name, downloads, start, \"end\" AS end_date FROM npm_stats.downloads WHERE package_name = 'react' LIMIT 1"
```

```bash
coral sql --format json "SELECT package_name, downloads, start, \"end\" AS end_date FROM npm_stats.downloads WHERE package_name = 'typescript' LIMIT 1"
```

## Notes

This project intentionally avoids bundled sample data. The UI is powered by public live sources queried through Coral at request time.
