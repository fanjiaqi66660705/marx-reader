/**
 * Push local static-version source to main branch via Git Data API (IP direct).
 * Reuses unchanged remote blobs; excludes node_modules, .next, out, .git, data, dotenv files.
 * Run: node scripts/gh-push-main.js
 */
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const OWNER = "fanjiaqi66660705";
const REPO = "marx-reader";
const BRANCH = "main";
const TOKEN = process.env.GH_TOKEN;
const ROOT = path.resolve(__dirname, "..");
const EXCLUDE = new Set(["node_modules", ".next", "out", ".git", "data", ".turbo", "corpus"]);

function api(method, endpoint, body) {
  let tmp;
  const argsBase = [
    "-s", "-m", "300", "-X", method,
    `https://api.github.com${endpoint}`,
    "-H", `Authorization: token ${TOKEN}`,
    "-H", "Accept: application/vnd.github+json",
    "-H", "Content-Type: application/json",
  ];
  if (body !== undefined) {
    tmp = path.join(require("node:os").tmpdir(), `gh-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(tmp, JSON.stringify(body));
    argsBase.push("-d", `@${tmp}`);
  }
  const ips = ["140.82.113.6", "140.82.112.6", "140.82.114.6", "140.82.116.6", "140.82.121.6"];
  let lastErr = "";
  for (const ip of ips) {
    const args = [...argsBase, "--resolve", `api.github.com:443:${ip}`];
    try {
      const out = execFileSync("curl.exe", args, { maxBuffer: 128 * 1024 * 1024 }).toString();
      const j = JSON.parse(out);
      if (j.sha || j.ref || j.tree || j.html_url || (j.message && j.status !== 401)) return j;
      lastErr = out.slice(0, 200);
    } catch (e) {
      lastErr = e.message.slice(0, 200);
    }
  }
  throw new Error(`GitHub API 失败: ${lastErr}`);
}

function gitBlobSha(buf) {
  return crypto.createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest("hex");
}

function walk(dir, prefix = "") {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!prefix && EXCLUDE.has(name)) continue;
    if (/^\.env/.test(name)) continue;
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...walk(full, rel));
    else out.push({ full, rel });
  }
  return out;
}

// 1) 远端现状
const ref = api("GET", `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
const headSha = ref.object.sha;
console.log("main HEAD:", headSha);
const commit0 = api("GET", `/repos/${OWNER}/${REPO}/git/commits/${headSha}`);
const remoteTree = api("GET", `/repos/${OWNER}/${REPO}/git/trees/${commit0.tree.sha}?recursive=1`);
const remoteMap = new Map(remoteTree.tree.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]));
console.log("远端文件数:", remoteMap.size);

// 2) 本地清单与差异
const localFiles = walk(ROOT);
console.log("本地文件数:", localFiles.length);
const entries = [];
let uploaded = 0;
for (const f of localFiles) {
  const buf = fs.readFileSync(f.full);
  const sha = gitBlobSha(buf);
  let blobSha = remoteMap.get(f.rel) === sha ? sha : null;
  if (!blobSha) {
    const blob = api("POST", `/repos/${OWNER}/${REPO}/git/blobs`, { content: buf.toString("base64"), encoding: "base64" });
    if (!blob.sha) { console.error(`blob 失败: ${f.rel}`, JSON.stringify(blob).slice(0, 300)); process.exit(1); }
    blobSha = blob.sha;
    uploaded++;
    console.log(`上传: ${f.rel} (${(buf.length / 1024).toFixed(0)} KB)`);
  }
  entries.push({ path: f.rel, mode: "100644", type: "blob", sha: blobSha });
}
console.log(`复用 ${entries.length - uploaded} 个，上传 ${uploaded} 个`);

// 3) tree → commit → 更新 ref
const tree = api("POST", `/repos/${OWNER}/${REPO}/git/trees`, { tree: entries });
if (!tree.sha) { console.error("tree 失败", JSON.stringify(tree).slice(0, 300)); process.exit(1); }
const commit = api("POST", `/repos/${OWNER}/${REPO}/git/commits`, {
  message: "feat: 静态化改造（浏览器端 RAG），支持 GitHub Pages / Render 静态部署",
  tree: tree.sha,
  parents: [headSha],
});
if (!commit.sha) { console.error("commit 失败", JSON.stringify(commit).slice(0, 300)); process.exit(1); }
const refResult = api("PATCH", `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha });
if (!refResult.ref) { console.error("ref 失败", JSON.stringify(refResult).slice(0, 300)); process.exit(1); }
console.log("main 已更新:", commit.sha);
console.log("DONE");
