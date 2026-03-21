const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const backendDir = path.resolve(__dirname, "..");
const tmpDir = path.join(backendDir, ".tmp");

if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

const tmpPkgJson = path.join(tmpDir, "package.json");
if (!fs.existsSync(tmpPkgJson)) {
  fs.writeFileSync(tmpPkgJson, JSON.stringify({ type: "commonjs" }, null, 2));
}

process.env.TMP = tmpDir;
process.env.TEMP = tmpDir;

const cmd = "ts-node-dev";

const child = spawn(cmd, ["src/server.ts"], {
  cwd: backendDir,
  stdio: "inherit",
  env: process.env,
  shell: true,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
