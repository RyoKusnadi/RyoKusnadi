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

async function findContributedPRs() {
  // "merged" + "open" covers real/active contributions; closed-and-unmerged
  // (rejected/abandoned) PRs are intentionally left out.
  const [merged, open] = await Promise.all([searchPRs("merged"), searchPRs("open")]);

  const prsByRepo = new Map();
  for (const [items, isMerged] of [[merged, true], [open, false]]) {
    for (const item of items) {
      const repo = item.repository_url.replace("https://api.github.com/repos/", "");
      if (repo.startsWith(`${USERNAME}/`)) continue;
      if (!prsByRepo.has(repo)) prsByRepo.set(repo, []);
      prsByRepo.get(repo).push({ number: item.number, url: item.html_url, merged: isMerged });
    }
  }
  return prsByRepo;
}

function renderRow(nameWithOwner, prs) {
  const [, repo] = nameWithOwner.split("/");
  const prLinks = prs
    .sort((a, b) => a.number - b.number)
    .map((pr) => `<a href="${pr.url}">#${pr.number}</a>${pr.merged ? "" : " (open)"}`)
    .join(", ");
  return `    <tr>
      <td><a href="https://github.com/${nameWithOwner}"><b>${repo}</b></a></td>
      <td><img alt="Stars" src="https://img.shields.io/github/stars/${nameWithOwner}?style=flat-square&labelColor=343b41"/></td>
      <td><img alt="Forks" src="https://img.shields.io/github/forks/${nameWithOwner}?style=flat-square&labelColor=343b41"/></td>
      <td><img alt="Issues" src="https://img.shields.io/github/issues/${nameWithOwner}?style=flat-square&labelColor=343b41"/></td>
      <td><img alt="Pull Requests" src="https://img.shields.io/github/issues-pr/${nameWithOwner}?style=flat-square&labelColor=343b41"/></td>
      <td>${prLinks}</td>
      <td><img alt="Contributor" src="https://img.shields.io/badge/role-Contributor-green"/></td>
    </tr>`;
}

async function main() {
  const prsByRepo = await findContributedPRs();

  const repos = await Promise.all(
    [...prsByRepo.entries()].map(async ([nameWithOwner, prs]) => {
      const info = await ghApi(`/repos/${nameWithOwner}`);
      return { nameWithOwner, stars: info.stargazers_count, prs };
    }),
  );
  repos.sort((a, b) => b.stars - a.stars);

  const rows = repos.map((r) => renderRow(r.nameWithOwner, r.prs)).join("\n");

  const table = repos.length
    ? `<table align="center">
  <thead align="center">
    <tr>
      <td><b>🎁 Projects</b></td>
      <td><b>⭐ Stars</b></td>
      <td><b>📚 Forks</b></td>
      <td><b>🛎 Issues</b></td>
      <td><b>📬 Pull requests</b></td>
      <td><b>🔀 My PRs</b></td>
      <td><b>💼 Role</b></td>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>`
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
  console.log(`Wrote ${repos.length} repositories into the contributions table.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
