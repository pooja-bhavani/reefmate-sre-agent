# ReefMate SRE

ReefMate SRE is a personal DevOps first mate. It reads live GitHub delivery signals and npm dependency movement through Coral SQL, then ranks what needs a DevOps engineer's attention first.

## What It Does

- Finds risky GitHub workflow runs.
- Highlights PRs that need review flow decisions.
- Surfaces active issues that need triage.
- Computes a release gate from pipeline, review, stale-work, and risk signals.
- Shows source health so empty GitHub Actions or PR data is clear instead of misleading.
- Derives npm search terms and package watchlists from the repository's live issues, PRs, labels, and workflow names.
- Shows the Coral SQL behind every panel.

## Sources

- `github.repo_action_runs`
- `github.pulls`
- `github.issues`
- `npm.search`
- `npm_stats.downloads`

## Run Locally

Install npm
```
npm install
```

Make sure Coral can access the required sources:

```bash
npm run test:coral
```

Start the app:

```bash
npm run dev
```

Open:

```text
http://localhost:4173
```

By default the app opens with `withcoral/coral`, a public repository with active PRs and workflow runs. You can enter any `owner/repo` or full GitHub repository URL in the app UI and click `Analyze`.

You can also set a default repository from the terminal:

```bash
REPO_OWNER=your-org REPO_NAME=your-repo npm run dev
```

## Coral SQL Commands

Recent GitHub Actions workflow runs:

```bash
coral sql --format json "SELECT display_title, status, conclusion, event, head_branch, actor__login, run_started_at, updated_at, html_url FROM github.repo_action_runs WHERE owner = 'withcoral' AND repo = 'coral' LIMIT 12"
```

Open pull requests:

```bash
coral sql --format json "SELECT number, title, state, draft, created_at, updated_at, user__login, html_url, requested_reviewer_logins, label_names FROM github.pulls WHERE owner = 'withcoral' AND repo = 'coral' LIMIT 8"
```

Open issues:

```bash
coral sql --format json "SELECT number, title, state, created_at, updated_at, user__login, comments, html_url, labels FROM github.issues WHERE owner = 'withcoral' AND repo = 'coral' LIMIT 8"
```

Repository-aware package discovery:

```bash
coral sql --format json "SELECT name, version, description, author_username, license, date, npm_url, repository_url, downloads_monthly FROM npm.search WHERE q = 'github-actions ci cd terraform ansible monitoring' ORDER BY downloads_monthly DESC LIMIT 8"
```

Package download telemetry:

```bash
coral sql --format json "SELECT package_name, downloads, start, \"end\" AS end_date FROM npm_stats.downloads WHERE package_name = '@actions/core' LIMIT 1"
```
