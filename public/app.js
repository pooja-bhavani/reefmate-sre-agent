const state = { dashboard: null };
const fmt = new Intl.DateTimeFormat("en-IN", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const numberFmt = new Intl.NumberFormat("en-IN");
const compactFmt = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const repoInput = document.getElementById("repo-input");
const savedRepo = localStorage.getItem("reefmate_repo");
if (savedRepo) repoInput.value = savedRepo;

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.panel).classList.add("active");
  });
});

document.getElementById("refresh").addEventListener("click", () => load());
document.getElementById("copy-brief").addEventListener("click", async () => {
  if (!state.dashboard) return;
  const { data } = state.dashboard;
  const lines = [
    `Repository: ${data.target.owner}/${data.target.repo}`,
    `Release gate: ${data.releaseGate.state} (${data.releaseGate.score})`,
    `Reason: ${data.releaseGate.reason}`,
    "",
    "Top attention:",
    ...data.attention.slice(0, 5).map((item, index) => `${index + 1}. [${item.score}] ${item.title} - ${item.reason}`),
    "",
    "Live sources:",
    ...data.sourceHealth.map((item) => `${item.source}: ${item.detail}`),
  ];
  await navigator.clipboard.writeText(lines.join("\n"));
  document.getElementById("copy-brief").textContent = "Copied";
  setTimeout(() => {
    document.getElementById("copy-brief").textContent = "Copy brief";
  }, 1400);
});
document.getElementById("repo-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const parsed = parseRepoInput(repoInput.value);
  repoInput.value = `${parsed.owner}/${parsed.repo}`;
  localStorage.setItem("reefmate_repo", repoInput.value);
  load();
});
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

function sourceTone(state) {
  return state === "connected" ? "" : "warn";
}

function parseRepoInput(value) {
  const raw = String(value || "").trim();
  const withoutGit = raw.replace(/\.git$/i, "");
  const githubMatch = withoutGit.match(/github\.com[:/]+([^/\s]+)\/([^/\s?#]+)/i);
  if (githubMatch) {
    return { owner: githubMatch[1], repo: githubMatch[2] };
  }
  const simpleMatch = withoutGit.match(/^([^/\s]+)\/([^/\s?#]+)$/);
  if (simpleMatch) {
    return { owner: simpleMatch[1], repo: simpleMatch[2] };
  }
  return { owner: "withcoral", repo: "coral" };
}

function actionTone(score) {
  if (score >= 90) return "danger";
  if (score >= 70) return "warn";
  return "";
}

function renderAttention(items) {
  document.getElementById("top-score").textContent = items[0]?.score ?? "0";
  document.getElementById("map-risks").textContent = String(items.length);
  document.getElementById("attention-list").innerHTML = items.length ? items.map((item, index) => `
    <article class="signal-row ${actionTone(item.score)}">
      <div class="rank">${String(index + 1).padStart(2, "0")}</div>
      <div class="score">${item.score}</div>
      <div>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.reason)}</p>
        <div class="chips">${chip(item.kind, actionTone(item.score))}${chip(item.evidence)}</div>
      </div>
      <div class="directive">
        <span>${escapeHtml(item.action)}</span>
        ${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Open evidence</a>` : ""}
      </div>
    </article>
  `).join("") : `<div class="loading">No attention items returned from the live sources.</div>`;
}

function renderCi(items) {
  const risky = items.filter((run) => run.conclusion && run.conclusion !== "success").length;
  document.getElementById("map-ci").textContent = items.length ? (risky ? `${risky} risky` : "green") : "none";
  document.getElementById("ci-list").innerHTML = items.length ? items.map((run) => {
    const tone = run.conclusion === "success" ? "" : "danger";
    return `
      <article class="card">
        <span class="meta-label">${escapeHtml(run.status)} · ${escapeHtml(run.conclusion || "running")}</span>
        <h3>${escapeHtml(run.display_title)}</h3>
        <p>${escapeHtml(run.head_branch || "unknown branch")} · ${escapeHtml(run.actor__login || "unknown")} · ${fmt.format(new Date(run.run_started_at))}</p>
        <div class="chips">${chip(run.event)}${chip(run.conclusion || run.status, tone)}</div>
      </article>
    `;
  }).join("") : `<div class="loading">No GitHub Actions runs found for this repository.</div>`;
}

function renderReview(prs, issues, summary) {
  const issueRows = issues.filter((item) => !String(item.html_url).includes("/pull/"));
  const workCount = prs.length + issueRows.length;
  document.getElementById("work-count").textContent = String(workCount);
  document.getElementById("map-prs").textContent = String(workCount);
  const rows = [
    ...prs.map((item) => ({ ...item, type: item.draft ? "Draft PR" : "PR", note: item.requested_reviewer_logins || "no reviewer requested" })),
    ...issueRows.slice(0, 8).map((item) => ({ ...item, type: "Issue", note: `${item.comments || 0} comments` })),
  ];
  document.getElementById("review-list").innerHTML = rows.length ? rows.map((item) => `
    <article class="card">
      <span class="meta-label">${escapeHtml(item.type)} · #${item.number}</span>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.user__login || "unknown")} · updated ${fmt.format(new Date(item.updated_at))}</p>
      <div class="chips">${chip(item.note)}${item.draft ? chip("draft", "warn") : ""}</div>
    </article>
  `).join("") : `<div class="loading">No open PRs or issues found for this repository.</div>`;
}

function renderDependencies(items, packages) {
  const total = items.reduce((sum, item) => sum + Number(item.downloads || 0), 0);
  document.getElementById("download-total").textContent = compactFmt.format(total);
  document.getElementById("map-deps").textContent = compactFmt.format(total);
  const downloadRows = items.map((item) => `
    <article class="timeline-item">
      <div>
        <div class="time">${escapeHtml(item.package_name)}</div>
        <p>${escapeHtml(item.start)} to ${escapeHtml(item.end_date)}</p>
      </div>
      <div>
        <h3>${numberFmt.format(item.downloads)} downloads</h3>
        <p>Package selected from repository signals and the current npm download window.</p>
      </div>
    </article>
  `).join("");
  const packageRows = packages.slice(0, 4).map((item) => `
    <article class="timeline-item">
      <div>
        <div class="time">${escapeHtml(item.name)}</div>
        <p>${numberFmt.format(item.downloads_monthly || 0)} monthly</p>
      </div>
      <div>
        <h3>${escapeHtml(item.version)}</h3>
        <p>${escapeHtml(item.description)}</p>
      </div>
    </article>
  `).join("");
  document.getElementById("dependency-list").innerHTML = downloadRows + packageRows;
}

function renderGate(gate, health) {
  document.getElementById("gate-score").textContent = String(gate.score);
  document.getElementById("gate-copy").textContent = `${gate.state}: ${gate.reason}`;
  document.getElementById("gate-state").textContent = gate.state;
  document.getElementById("gate-state").className = gate.state.toLowerCase();
  document.getElementById("gate-reason").textContent = gate.reason;
  document.getElementById("gate-checks").innerHTML = gate.checks.map((item) => `
    <div class="check-row ${item.ok ? "ok" : "warn"}">
      <span>${item.ok ? "OK" : "CHECK"}</span>
      <div>
        <strong>${escapeHtml(item.label)}</strong>
        <p>${escapeHtml(item.value)}</p>
      </div>
    </div>
  `).join("");
  document.getElementById("health-list").innerHTML = health.map((item) => `
    <div class="health-row">
      ${chip(item.state, sourceTone(item.state))}
      <div>
        <strong>${escapeHtml(item.source)}</strong>
        <p>${escapeHtml(item.detail)}</p>
      </div>
    </div>
  `).join("");
}

function renderSql(queries) {
  document.getElementById("sql-view").textContent = Object.entries(queries)
    .map(([name, sql]) => `-- ${name}\n${sql.trim()}`)
    .join("\n\n");
}

async function load(options = {}) {
  if (!options.silent) {
    ["attention-list", "ci-list", "review-list", "dependency-list"].forEach((id) => {
      document.getElementById(id).innerHTML = `<div class="loading">Running live Coral SQL...</div>`;
    });
    document.getElementById("gate-state").textContent = "...";
    document.getElementById("gate-reason").textContent = "Running live Coral SQL.";
    document.getElementById("gate-checks").innerHTML = "";
    document.getElementById("health-list").innerHTML = "";
    document.getElementById("repo-target").textContent = "Analyzing repository";
  }

  const { owner, repo } = parseRepoInput(repoInput.value);
  const params = new URLSearchParams({
    owner,
    repo,
  });
  const response = await fetch(`/api/dashboard?${params.toString()}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Dashboard failed");
  }

  state.dashboard = await response.json();
  const { data, queries } = state.dashboard;
  document.getElementById("repo-target").textContent = `${data.target.owner}/${data.target.repo}`;
  renderAttention(data.attention);
  renderCi(data.workflowRuns);
  renderReview(data.pullRequests, data.issues, data.summary);
  renderDependencies(data.downloads, data.agentPackages);
  renderGate(data.releaseGate, data.sourceHealth);
  renderSql(queries);
  document.getElementById("last-updated").textContent = `last pulse ${fmt.format(new Date(state.dashboard.generatedAt))}`;
}

load().catch((error) => {
  document.body.innerHTML = `<main class="app"><section class="panel active"><h1>ReefMate SRE could not start</h1><p>${escapeHtml(error.message)}</p><p>Run <code>npm run test:coral</code>, then restart <code>npm run dev</code>.</p></section></main>`;
});
