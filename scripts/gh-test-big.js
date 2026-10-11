const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const TOKEN = process.env.GH_TOKEN;
const file = process.argv[2]; // 要上传的文件路径
const ips = process.argv.slice(3);

const content = fs.readFileSync(file).toString("base64");
const body = JSON.stringify({ content, encoding: "base64" });
const tmp = path.join(os.tmpdir(), `gh-big-${Date.now()}.json`);
fs.writeFileSync(tmp, body);
console.log(`body size: ${(body.length / 1048576).toFixed(1)} MB, testing IPs: ${ips.join(", ")}`);

for (const ip of ips) {
  try {
    const out = execFileSync("curl.exe", [
      "-s", "-m", "300", "-X", "POST",
      "--resolve", `api.github.com:443:${ip}`,
      "https://api.github.com/repos/fanjiaqi66660705/marx-reader/git/blobs",
      "-H", `Authorization: token ${TOKEN}`,
      "-H", "Accept: application/vnd.github+json",
      "-H", "Content-Type: application/json",
      "-d", `@${tmp}`,
    ], { maxBuffer: 128 * 1024 * 1024 }).toString();
    const j = JSON.parse(out);
    console.log(`${ip} => ${j.sha ? "OK " + j.sha : JSON.stringify(j).slice(0, 150)}`);
    if (j.sha) break;
  } catch (e) {
    console.log(`${ip} => curl error: ${e.message.slice(0, 120)}`);
  }
}
fs.unlink(tmp, () => {});
