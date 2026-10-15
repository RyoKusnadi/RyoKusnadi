#!/usr/bin/env node
// Regenerates the "Open Source Contribution" table in README.md from real
// pull requests (merged or still open), instead of a hand-maintained list
// of repos.

import fs from "node:fs";

const USERNAME = "RyoKusnadi";
const TOKEN = process.env.GITHUB_TOKEN;
const README_PATH = new URL("../README.md", import.meta.url);
const START_MARKER = "<!-- OSS-CONTRIBUTIONS:START -->";
const END_MARKER = "<!-- OSS-CONTRIBUTIONS:END -->";

if (!TOKEN) {
  console.error("GITHUB_TOKEN env var is required");
  process.exit(1);
}

async function ghApi(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function searchPRs(state) {
  const items = [];
  let page = 1;
  for (;;) {
    const query = `author:${USERNAME} type:pr is:${state}`;
    const data = await ghApi(
      `/search/issues?q=${encodeURIComponent(query)}&per_page=100&page=${page}`,
    );
    items.push(...data.items);
    if (data.items.length < 100) break;
    page += 1;
  }
  return items;
}

// Concise "what I fixed" blurbs, keyed by "owner/repo#number". Falls back to
// the PR title when a PR has no entry here.
const DESCRIPTIONS = {
  "stackql/stackql#847": "Added unit tests for the `sqlrewrite` package",
  "containers/kubernetes-mcp-server#1502": "Added a metric that tracks in-flight MCP requests",
  "dagucloud/dagu#3185": "Fixed the dirlock so only one contender can take over a stale lock",
  "OrlojHQ/orloj#179": "Added a built-in durable Postgres audit sink",
  "tailscale/tsidp#202": "Added a `-login-server` flag for custom control servers",
  "modelcontextprotocol/go-sdk#563": "Added PKCE check support to OAuth",
  "labstack/echo#2461": "Added Skipper unit tests for BasicAuth and clearer BasicAuthValidator docs",
  "daixiang0/gci#178": "Added an alias import section",
};

async function findContributedPRs() {
  // "merged" + "open" covers real/active contributions; closed-and-unmerged
  // (rejected/abandoned) PRs are intentionally left out.
  const [merged, open] = await Promise.all([searchPRs("merged"), searchPRs("open")]);

  const prs = [];
  for (const [items, isMerged] of [[merged, true], [open, false]]) {
    for (const item of items) {
      const repo = item.repository_url.replace("https://api.github.com/repos/", "");
      if (repo.startsWith(`${USERNAME}/`)) continue;
      const date = (isMerged ? item.pull_request?.merged_at ?? item.closed_at : item.updated_at).slice(0, 10);
      prs.push({
        repo,
        number: item.number,
        url: item.html_url,
        merged: isMerged,
        date,
        description: DESCRIPTIONS[`${repo}#${item.number}`] ?? item.title,
      });
    }
  }
  return prs.sort((a, b) => b.date.localeCompare(a.date));
}

function renderTable(prLabel, prs) {
  const rows = prs.map((pr, i) => {
    const [, name] = pr.repo.split("/");
    return `| ${i + 1} | [${name}](https://github.com/${pr.repo}) | [#${pr.number}](${pr.url}) | ${pr.description.replaceAll("|", "\\|")} | ${pr.date} |`;
  });
  return `| No | Project | ${prLabel} | Description | Last Update |
|---|---|---|---|---|
${rows.join("\n")}`;
}

async function main() {
  const prs = await findContributedPRs();

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const recentMerged = prs.filter((p) => p.merged && p.date >= cutoffDate);
  const opened = prs.filter((p) => !p.merged);
  const old = prs.filter((p) => p.merged && p.date < cutoffDate);

  const sections = [
    ["Merged PRs (Last 1 Year)", "My Merged PR", recentMerged],
    ["Opened PRs (Last 1 Year)", "My Opened PR", opened],
    ["Old PRs", "My Merged PR", old],
  ]
    .filter(([, , list]) => list.length)
    .map(([title, label, list]) => `<h4 align="center">${title}</h4>\n\n${renderTable(label, list)}`);

  const table = sections.length
    ? sections.join("\n\n")
    : `<p align="center"><sub>No pull requests to external repositories yet.</sub></p>`;

  const readme = fs.readFileSync(README_PATH, "utf8");
  const startIdx = readme.indexOf(START_MARKER);
  const endIdx = readme.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`Markers not found in README.md`);
  }

  const updated =
    readme.slice(0, startIdx + START_MARKER.length) +
    "\n" +
    table +
    "\n" +
    readme.slice(endIdx);

  fs.writeFileSync(README_PATH, updated);
  console.log(`Wrote ${prs.length} pull requests into the contributions tables.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
