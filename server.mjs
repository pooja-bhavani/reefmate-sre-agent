import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const port = Number.parseInt(process.env.PORT || "4173", 10);

const queries = {
  earthquakes: `
    SELECT id, title, magnitude, place, event_time, updated_at, alert, tsunami,
      significance, latitude, longitude, depth_km, url
    FROM usgs_earthquakes.events
    WHERE min_magnitude = 4
    ORDER BY event_time DESC
    LIMIT 12
  `,
  severeEarthquakes: `
    SELECT id, title, magnitude, place, event_time, alert, tsunami, significance, url
    FROM usgs_earthquakes.events
    WHERE min_magnitude = 5
    ORDER BY significance DESC
    LIMIT 6
  `,
  packages: `
    SELECT name, version, description, author_username, license, date, npm_url,
      repository_url, downloads_monthly
    FROM npm.search
    WHERE q = 'ai agent framework'
    ORDER BY downloads_monthly DESC
    LIMIT 8
  `,
};

const packageWatchlist = ["react", "next", "vite", "typescript", "express", "zod"];

function runCoral(sql) {
  return new Promise((resolve, reject) => {
    execFile("coral", ["sql", "--format", "json", sql.replace(/\s+/g, " ").trim()], { cwd: root }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (parseError) {
        reject(new Error(`Could not parse Coral JSON: ${parseError.message}`));
      }
    });
  });
}

async function dashboard() {
  const entries = await Promise.all(Object.entries(queries).map(async ([key, sql]) => [key, await runCoral(sql)]));
  const downloads = await Promise.all(packageWatchlist.map((name) => runCoral(`
    SELECT package_name, downloads, start, "end" AS end_date
    FROM npm_stats.downloads
    WHERE package_name = '${name}'
    LIMIT 1
  `).then((rows) => rows[0])));
  return { ...Object.fromEntries(entries), downloads };
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);

  try {
    if (url.pathname === "/api/dashboard") {
      const body = await dashboard();
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ generatedAt: new Date().toISOString(), queries, data: body }));
      return;
    }

    const pathname = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(publicDir, pathname);
    if (!filePath.startsWith(publicDir)) throw new Error("Invalid path");
    response.writeHead(200, { "Content-Type": mime[extname(filePath)] || "application/octet-stream" });
    response.end(await readFile(filePath));
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error.message }));
  }
}).listen(port, () => {
  console.log(`ReefMate is live at http://localhost:${port}`);
});
