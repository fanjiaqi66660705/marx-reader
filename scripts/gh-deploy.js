/**
 * gh-pages 部署脚本：GitHub 主域名被 DNS 污染，通过 curl --resolve IP 直连 api.github.com
 * 流程：逐文件上传 blob(base64) → 创建 tree → 创建 commit → 更新 refs/heads/gh-pages → 启用 Pages
 * 运行：node scripts/gh-deploy.js
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const OWNER = "fanjiaqi66660705";
const REPO = "marx-reader";
const BRANCH = "gh-pages";
const TOKEN = process.env.GH_TOKEN;
const OUT = path.resolve(__dirname, "..", "out");
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

function api(method, endpoint, body) {
  const args = [
    "-s", "-m", "120", "-X", method,
    "--resolve", "api.github.com:443:140.82.112.6",
    `https://api.github.com${endpoint}`,
    "-H", `Authorization: token ${TOKEN}`,
    "-H", "Accept: application/vnd.github+json",
    "-H", "Content-Type: application/json",
  ];
  let tmp;
  if (body !== undefined) {
    tmp = path.join(require("node:os").tmpdir(), `gh-body-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(tmp, JSON.stringify(body));
    args.push("-d", `@${tmp}`);
  }
  try {
    const out = execFileSync("curl.exe", args, { maxBuffer: 64 * 1024 * 1024 }).toString();
    return JSON.parse(out);
  } finally {
    if (tmp) fs.unlink(tmp, () => {});
  }
}

function walk(dir, prefix = "") {
  const entries = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (fs.statSync(full).isDirectory()) entries.push(...walk(full, rel));
    else entries.push({ full, rel: rel.replace(/\\/g, "/") });
  }
  return entries;
}

const files = walk(OUT);
console.log(`待上传文件: ${files.length}`);

// 1) 上传 blob
const treeEntries = [];
files.forEach((f, i) => {
  const content = fs.readFileSync(f.full).toString("base64");
  const blob = api("POST", `/repos/${OWNER}/${REPO}/git/blobs`, { content, encoding: "base64" });
  if (!blob.sha) { console.error(`blob 失败: ${f.rel}`, JSON.stringify(blob).slice(0, 300)); process.exit(1); }
  treeEntries.push({ path: f.rel, mode: "100644", type: "blob", sha: blob.sha });
  console.log(`[${i + 1}/${files.length}] ${f.rel}`);
});

// 2) 创建 tree
const tree = api("POST", `/repos/${OWNER}/${REPO}/git/trees`, { tree: treeEntries });
if (!tree.sha) { console.error("tree 失败", JSON.stringify(tree).slice(0, 300)); process.exit(1); }
console.log("tree:", tree.sha);

// 3) 创建 commit
const commit = api("POST", `/repos/${OWNER}/${REPO}/git/commits`, {
  message: "deploy: static export for GitHub Pages",
  tree: tree.sha,
  parents: [],
});
if (!commit.sha) { console.error("commit 失败", JSON.stringify(commit).slice(0, 300)); process.exit(1); }
console.log("commit:", commit.sha);

// 4) 创建或更新 ref
let refExists = false;
try {
  const ref = api("GET", `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  refExists = !!ref.ref;
} catch { refExists = false; }

let refResult;
if (refExists) {
  refResult = api("PATCH", `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: true });
} else {
  refResult = api("POST", `/repos/${OWNER}/${REPO}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: commit.sha });
}
if (!refResult.ref) { console.error("ref 失败", JSON.stringify(refResult).slice(0, 300)); process.exit(1); }
console.log("ref:", refResult.ref);

// 5) 启用/更新 Pages
let pages;
try {
  pages = api("POST", `/repos/${OWNER}/${REPO}/pages`, { source: { branch: BRANCH, path: "/" } });
} catch (e) {
  pages = api("PUT", `/repos/${OWNER}/${REPO}/pages`, { source: { branch: BRANCH, path: "/" } });
}
console.log("pages:", JSON.stringify(pages.html_url ? { html_url: pages.html_url, status: pages.status } : pages).slice(0, 400));
console.log("DONE");
