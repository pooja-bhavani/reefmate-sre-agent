const state = { dashboard: null };
const fmt = new Intl.DateTimeFormat("en-IN", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const numberFmt = new Intl.NumberFormat("en-IN");
const canvas = document.getElementById("quake-map");
const ctx = canvas.getContext("2d");

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.panel).classList.add("active");
  });
});

document.getElementById("refresh").addEventListener("click", () => load());
setInterval(() => load({ silent: true }), 60_000);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function chip(text, tone = "") {
  return `<span class="chip ${tone}">${escapeHtml(text)}</span>`;
}

function signalScore(event) {
  return Math.round(
    event.magnitude * 18 +
    event.significance / 8 +
    (event.tsunami ? 60 : 0) +
    (event.alert && event.alert !== "green" ? 40 : 0)
  );
}

function directive(event) {
  if (event.tsunami) return "Escalate tsunami advisory watch";
  if (event.magnitude >= 6) return "Watch revisions and aftershocks";
  if (event.significance >= 500) return "Keep analyst eyes on this";
  return "Passive watch";
}

function rankedEvents() {
  return [...(state.dashboard?.data.earthquakes || [])]
    .map((event) => ({ ...event, score: signalScore(event) }))
    .sort((a, b) => b.score - a.score);
}

function drawRadar(events) {
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#071114";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(109, 236, 218, 0.08)";
  ctx.lineWidth = 1;
  for (let x = 40; x < width; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 36; y < height; y += 60) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255, 255, 255, 0.17)";
  [-60, -30, 0, 30, 60].forEach((lat) => {
    const y = ((90 - lat) / 180) * height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  });

  events.forEach((event) => {
    const x = ((event.longitude + 180) / 360) * width;
    const y = ((90 - event.latitude) / 180) * height;
    const radius = Math.max(7, event.magnitude * 3.2);
    const hot = event.magnitude >= 6 || event.tsunami;
    ctx.beginPath();
    ctx.arc(x, y, radius * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = hot ? "rgba(255, 91, 81, 0.16)" : "rgba(247, 194, 85, 0.12)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = hot ? "#ff5b51" : "#f7c255";
    ctx.fill();
    ctx.fillStyle = "#f7fffb";
    ctx.font = "700 11px Inter, sans-serif";
    ctx.fillText(`M${event.magnitude}`, x + radius + 4, y + 4);
  });
}

function renderSignals(events) {
  const ranked = events.slice(0, 7);
  document.getElementById("top-score").textContent = ranked[0]?.score ?? "0";
  document.getElementById("quake-count").textContent = String(state.dashboard.data.earthquakes.length);
  document.getElementById("signal-list").innerHTML = ranked.map((event, index) => `
    <article class="signal-row">
      <div class="rank">${String(index + 1).padStart(2, "0")}</div>
      <div class="score">${event.score}</div>
      <div>
        <h3>${escapeHtml(event.title)}</h3>
        <p>${escapeHtml(event.place)} · ${escapeHtml(fmt.format(new Date(event.event_time)))}</p>
        <div class="chips">
          ${chip(`M ${event.magnitude}`, event.magnitude >= 6 ? "danger" : "")}
          ${chip(`sig ${event.significance}`)}
          ${chip(event.alert || "no alert")}
          ${chip(event.tsunami ? "tsunami flag" : "no tsunami flag", event.tsunami ? "danger" : "")}
          ${chip(`${event.depth_km} km deep`)}
        </div>
      </div>
      <div class="directive">${escapeHtml(directive(event))}</div>
    </article>
  `).join("");
}

function renderSeismic(events) {
  document.getElementById("seismic-list").innerHTML = events.map((event) => `
    <article class="card">
      <span class="meta-label">M ${event.magnitude} · significance ${event.significance}</span>
      <h3>${escapeHtml(event.title)}</h3>
      <p>${escapeHtml(fmt.format(new Date(event.event_time)))} · ${escapeHtml(event.alert || "no alert")}</p>
      <div class="chips">${chip(event.tsunami ? "tsunami flag" : "no tsunami flag", event.tsunami ? "danger" : "")}${chip("USGS live")}</div>
    </article>
  `).join("");
}

function renderPackages(items) {
  const total = items.reduce((sum, item) => sum + Number(item.downloads || 0), 0);
  document.getElementById("download-total").textContent = numberFmt.format(total);
  document.getElementById("package-list").innerHTML = items.map((item) => `
    <article class="timeline-item">
      <div>
        <div class="time">${escapeHtml(item.package_name)}</div>
        <p>${escapeHtml(item.start)} to ${escapeHtml(item.end_date)}</p>
      </div>
      <div>
        <h3>${numberFmt.format(item.downloads)} downloads</h3>
        <p>Returned by the npm downloads source at request time.</p>
      </div>
    </article>
  `).join("");
}

function renderAgents(items) {
  document.getElementById("agent-list").innerHTML = items.map((item) => `
    <article class="card">
      <span class="meta-label">${numberFmt.format(item.downloads_monthly || 0)} monthly downloads</span>
      <h3>${escapeHtml(item.name)} <small>${escapeHtml(item.version)}</small></h3>
      <p>${escapeHtml(item.description)}</p>
      <div class="chips">${chip(item.license || "no license")}${chip(item.author_username || "unknown author")}${chip(new Date(item.date).getFullYear())}</div>
    </article>
  `).join("");
}

function renderSql(queries) {
  document.getElementById("sql-view").textContent = Object.entries(queries)
    .map(([name, sql]) => `-- ${name}\n${sql.trim()}`)
    .join("\n\n");
}

async function load(options = {}) {
  if (!options.silent) {
    ["signal-list", "seismic-list", "package-list", "agent-list"].forEach((id) => {
      document.getElementById(id).innerHTML = `<div class="loading">Running live Coral SQL...</div>`;
    });
  }

  const response = await fetch("/api/dashboard");
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Dashboard failed");
  }

  state.dashboard = await response.json();
  const events = rankedEvents();
  drawRadar(events);
  renderSignals(events);
  renderSeismic(state.dashboard.data.severeEarthquakes);
  renderPackages(state.dashboard.data.downloads);
  renderAgents(state.dashboard.data.packages);
  renderSql(state.dashboard.queries);
  document.getElementById("last-updated").textContent = `last pulse ${fmt.format(new Date(state.dashboard.generatedAt))}`;
}

load().catch((error) => {
  document.body.innerHTML = `<main class="app"><section class="panel active"><h1>ReefMate could not start</h1><p>${escapeHtml(error.message)}</p><p>Run <code>npm run test:coral</code>, then restart <code>npm run dev</code>.</p></section></main>`;
});
