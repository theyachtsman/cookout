// Runs the hardhat CLI via require-resolution instead of npm's PATH bin
// injection, which breaks when the repo path contains a colon (see README).
const path = require("path");
const { spawnSync } = require("child_process");

const pkgPath = require.resolve("hardhat/package.json", { paths: [path.join(__dirname, "..")] });
const pkg = require(pkgPath);
const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.hardhat;
const result = spawnSync(process.execPath, [path.join(path.dirname(pkgPath), bin), ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: path.join(__dirname, ".."),
});
process.exit(result.status ?? 1);
