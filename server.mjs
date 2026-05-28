import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const port = Number.parseInt(process.env.PORT || "4173", 10);

const defaultTarget = {
  owner: process.env.REPO_OWNER || "withcoral",
  repo: process.env.REPO_NAME || "coral",
};

function clean(value, fallback) {
  const normalized = String(value || fallback).trim();
  return /^[A-Za-z0-9_.-]+$/.test(normalized) ? normalized : fallback;
}

function queriesFor(target) {
  const { owner, repo } = target;
  return {
    workflowRuns: `
    SELECT display_title, status, conclusion, event, head_branch, actor__login,
      run_started_at, updated_at, html_url
    FROM github.repo_action_runs
    WHERE owner = '${owner}' AND repo = '${repo}'
    LIMIT 12
  `,
  pullRequests: `
    SELECT number, title, state, draft, created_at, updated_at, user__login,
      html_url, requested_reviewer_logins, label_names
    FROM github.pulls
    WHERE owner = '${owner}' AND repo = '${repo}'
    LIMIT 8
  `,
  issues: `
    SELECT number, title, state, created_at, updated_at, user__login, comments,
      html_url, labels
    FROM github.issues
    WHERE owner = '${owner}' AND repo = '${repo}'
    LIMIT 8
  `,
  };
}

function npmSearchQuery(searchTerm) {
  return `
    SELECT name, version, description, author_username, license, date, npm_url,
      repository_url, downloads_monthly
    FROM npm.search
    WHERE q = '${searchTerm}'
    ORDER BY downloads_monthly DESC
    LIMIT 8
  `;
}

const defaultPackageWatchlist = ["typescript", "vite", "express", "zod"];
const keywordPackages = new Map([
  ["github-actions", ["@actions/core", "@actions/github", "@actions/exec"]],
  ["ci", ["@actions/core", "is-ci", "ci-info"]],
  ["cd", ["@actions/core", "zx", "semantic-release"]],
  ["terraform", ["cdktf", "cdktf-cli", "@cdktf/provider-aws"]],
  ["ansible", ["zx", "yaml", "commander"]],
  ["monitoring", ["prom-client", "grafana", "@opentelemetry/api"]],
  ["alerting", ["prom-client", "@opentelemetry/api", "pino"]],
  ["prometheus", ["prom-client", "prometheus-query", "@opentelemetry/api"]],
  ["grafana", ["grafana", "prom-client", "@grafana/data"]],
  ["kubernetes", ["@kubernetes/client-node", "yaml", "zx"]],
  ["docker", ["dockerode", "zx", "yaml"]],
  ["aws", ["aws-sdk", "@aws-sdk/client-cloudwatch", "@aws-sdk/client-ecs"]],
  ["azure", ["@azure/identity", "@azure/arm-resources", "azure-devops-node-api"]],
  ["gcp", ["@google-cloud/storage", "@google-cloud/logging", "google-auth-library"]],
  ["multi-cloud", ["aws-sdk", "@azure/identity", "@google-cloud/storage"]],
]);

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

function riskItem(kind, title, score, reason, action, url, evidence) {
  return { kind, title, score, reason, action, url, evidence };
}

function parseLabels(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return parsed.map((item) => String(item.name || item).toLowerCase());
  } catch {
    return String(value || "").toLowerCase().match(/[a-z0-9][a-z0-9/-]+/g) || [];
  }
}

function hoursSince(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / 36e5));
}

function buildAttention(data) {
  const items = [];

  for (const run of data.workflowRuns) {
    if (run.conclusion && run.conclusion !== "success") {
      items.push(riskItem(
        "CI/CD",
        run.display_title,
        95,
        `${run.conclusion} workflow on ${run.head_branch || "unknown branch"}`,
        "Open the run, inspect failing job logs, then decide fix-forward or revert.",
        run.html_url,
        `${run.event} by ${run.actor__login || "unknown"}`
      ));
    } else if (run.status !== "completed") {
      items.push(riskItem(
        "CI/CD",
        run.display_title,
        72,
        `Workflow is still ${run.status}`,
        "Watch until completion before merging related changes.",
        run.html_url,
        `${run.event} on ${run.head_branch || "unknown branch"}`
      ));
    }
  }

  for (const pr of data.pullRequests) {
    const waitingForReviewer = !pr.draft && !pr.requested_reviewer_logins;
    const draftPenalty = pr.draft ? 18 : 0;
    const reviewPenalty = waitingForReviewer ? 28 : 0;
    const score = 50 + draftPenalty + reviewPenalty + Math.min(20, hoursSince(pr.updated_at));
    items.push(riskItem(
      pr.draft ? "Draft PR" : "Review",
      `#${pr.number} ${pr.title}`,
      score,
      pr.draft ? "Draft change needs owner decision" : (waitingForReviewer ? "Ready PR has no requested reviewer" : "Open PR needs review flow"),
      pr.draft ? "Decide whether to finish, split, or close it." : "Request reviewer or verify CI status before merge.",
      pr.html_url,
      `author ${pr.user__login || "unknown"}`
    ));
  }

  for (const issue of data.issues.filter((item) => !String(item.html_url).includes("/pull/"))) {
    const labelNames = parseLabels(issue.labels);
    const labels = labelNames.join(" ");
    const labelBoost =
      (labels.includes("ci/cd") || labels.includes("github-actions") ? 22 : 0) +
      (labels.includes("monitoring") || labels.includes("alert") ? 18 : 0) +
      (labels.includes("ansible") || labels.includes("terraform") ? 12 : 0);
    const score = 58 + labelBoost + Math.min(20, Number(issue.comments || 0) * 4);
    items.push(riskItem(
      "Issue",
      `#${issue.number} ${issue.title}`,
      score,
      labels.includes("ci/cd") || labels.includes("github-actions")
        ? "Delivery pipeline work is waiting"
        : labels.includes("monitoring")
          ? "Observability work is waiting"
          : "Open repo work needs triage",
      "Classify impact, assign owner, and turn this into the next concrete change.",
      issue.html_url,
      `${issue.comments || 0} comments`
    ));
  }

  const totalDownloads = data.downloads.reduce((sum, item) => sum + Number(item.downloads || 0), 0);
  if (totalDownloads > 0) {
    items.push(riskItem(
      "Dependencies",
      "High-volume runtime dependency surface",
      38,
      "Context signal from common packages, not a repo-specific alert",
      "Use this as dependency background after repo-specific work is triaged.",
      "https://www.npmjs.com/",
      `${totalDownloads.toLocaleString("en-IN")} downloads across watchlist`
    ));
  }

  return items.sort((a, b) => b.score - a.score).slice(0, 10);
}

function deriveRepoContext(data, target) {
  const text = [
    target.repo,
    ...data.workflowRuns.map((item) => `${item.display_title} ${item.event} ${item.head_branch}`),
    ...data.pullRequests.map((item) => `${item.title} ${item.label_names}`),
    ...data.issues.map((item) => `${item.title} ${parseLabels(item.labels).join(" ")}`),
  ].join(" ").toLowerCase();
  const terms = [
    "github-actions", "ci", "cd", "terraform", "ansible", "monitoring", "alerting",
    "prometheus", "grafana", "kubernetes", "docker", "aws", "azure", "gcp", "multi-cloud",
  ].filter((term) => text.includes(term));
  const fallback = target.repo.replace(/[-_]/g, " ").split(/\s+/).filter(Boolean).slice(0, 3);
  const keywords = [...new Set([...terms, ...fallback])].slice(0, 6);
  return {
    keywords,
    npmSearch: keywords.length ? keywords.join(" ") : "devops sre ci cd observability",
  };
}

function deriveWatchlist(context) {
  const packages = context.keywords.flatMap((keyword) => keywordPackages.get(keyword) || []);
  return [...new Set([...packages, ...defaultPackageWatchlist])].slice(0, 8);
}

function buildSourceHealth(data) {
  return [
    {
      source: "GitHub Actions",
      state: data.workflowRuns.length ? "connected" : "empty",
      detail: data.workflowRuns.length
        ? `${data.workflowRuns.length} recent runs returned`
        : "No workflow runs returned for this repository",
    },
    {
      source: "Pull Requests",
      state: data.pullRequests.length ? "connected" : "empty",
      detail: data.pullRequests.length
        ? `${data.pullRequests.length} open pull requests returned`
        : "No open pull requests returned",
    },
    {
      source: "Issues",
      state: data.issues.length ? "connected" : "empty",
      detail: data.issues.length
        ? `${data.issues.filter((item) => !String(item.html_url).includes("/pull/")).length} open issues returned`
        : "No open issues returned",
    },
    {
      source: "npm",
      state: data.agentPackages.length || data.downloads.length ? "connected" : "empty",
      detail: data.agentPackages.length
        ? `${data.agentPackages.length} packages matched repository signals`
        : "No package matches returned",
    },
  ];
}

function buildReleaseGate(data) {
  const failedRuns = data.workflowRuns.filter((run) => run.conclusion && run.conclusion !== "success");
  const runningRuns = data.workflowRuns.filter((run) => run.status !== "completed");
  const reviewGaps = data.pullRequests.filter((pr) => !pr.draft && !pr.requested_reviewer_logins);
  const staleIssues = data.issues.filter((issue) => !String(issue.html_url).includes("/pull/") && hoursSince(issue.updated_at) > 72);
  const topRisk = data.attention[0]?.score || 0;
  const missingPipelinePenalty = data.workflowRuns.length ? 0 : 14;
  const score = Math.max(
    0,
    100 -
      failedRuns.length * 28 -
      runningRuns.length * 10 -
      reviewGaps.length * 12 -
      Math.min(24, staleIssues.length * 4) -
      Math.max(0, topRisk - 70) -
      missingPipelinePenalty
  );
  const state = failedRuns.length || score < 55 ? "Blocked" : score < 78 ? "Guarded" : "Ready";
  const checks = [
    {
      label: "Pipeline confidence",
      value: failedRuns.length ? `${failedRuns.length} failed run${failedRuns.length === 1 ? "" : "s"}` : (data.workflowRuns.length ? "No failing runs returned" : "No runs returned"),
      ok: !failedRuns.length && !!data.workflowRuns.length,
    },
    {
      label: "Review control",
      value: reviewGaps.length ? `${reviewGaps.length} PR${reviewGaps.length === 1 ? "" : "s"} missing reviewer` : "No reviewer gaps returned",
      ok: !reviewGaps.length,
    },
    {
      label: "Open work pressure",
      value: staleIssues.length ? `${staleIssues.length} stale issue${staleIssues.length === 1 ? "" : "s"}` : "No stale issue pressure returned",
      ok: staleIssues.length < 3,
    },
  ];
  return {
    state,
    score,
    reason: state === "Ready"
      ? "Live sources do not show a release blocker"
      : state === "Guarded"
        ? "Proceed only after the highlighted owner decisions"
        : "Resolve the top attention item before shipping",
    checks,
  };
}

async function dashboard(target) {
  const queries = queriesFor(target);
  const entries = await Promise.all(Object.entries(queries).map(async ([key, sql]) => [key, await runCoral(sql)]));
  const data = Object.fromEntries(entries);
  data.context = deriveRepoContext(data, target);
  queries.agentPackages = npmSearchQuery(data.context.npmSearch);
  data.agentPackages = await runCoral(queries.agentPackages);
  const packageWatchlist = deriveWatchlist(data.context);
  data.downloads = (await Promise.all(packageWatchlist.map((name) => runCoral(`
    SELECT package_name, downloads, start, "end" AS end_date
    FROM npm_stats.downloads
    WHERE package_name = '${name}'
    LIMIT 1
  `).then((rows) => rows[0])))).filter(Boolean);
  data.attention = buildAttention(data);
  data.sourceHealth = buildSourceHealth(data);
  data.releaseGate = buildReleaseGate(data);
  data.summary = {
    workflowRuns: data.workflowRuns.length,
    pullRequests: data.pullRequests.length,
    issues: data.issues.filter((item) => !String(item.html_url).includes("/pull/")).length,
  };
  data.target = target;
  return { queries, data };
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
      const target = {
        owner: clean(url.searchParams.get("owner"), defaultTarget.owner),
        repo: clean(url.searchParams.get("repo"), defaultTarget.repo),
      };
      const body = await dashboard(target);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ generatedAt: new Date().toISOString(), ...body }));
      return;
    }

    const pathname = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(publicDir, pathname);
    if (!filePath.startsWith(publicDir)) throw new Error("Invalid path");
    const file = await readFile(filePath);
    response.writeHead(200, { "Content-Type": mime[extname(filePath)] || "application/octet-stream" });
    response.end(file);
  } catch (error) {
    if (!response.headersSent) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: error.message }));
    } else {
      response.end();
    }
  }
}).listen(port, () => {
  console.log(`ReefMate SRE is live at http://localhost:${port}`);
});
