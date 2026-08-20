import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..");
const electronBin = resolve(desktopDir, "node_modules/.bin/electron");
const mainJs = resolve(desktopDir, "dist-electron/main.js");
const smokeHome = mkdtempSync(resolve(tmpdir(), "synara-desktop-smoke-"));
const backendLog = resolve(smokeHome, "userdata/logs/server-child.log");

console.log("\nLaunching Electron smoke test...");

const smokeEnv = { ...process.env };
delete smokeEnv.VITE_DEV_SERVER_URL;
Object.assign(smokeEnv, {
  SYNARA_DESKTOP_FLAVOR: "canary",
  SYNARA_HOME: smokeHome,
  ELECTRON_ENABLE_LOGGING: "1",
});

const child = spawn(electronBin, [mainJs], {
  stdio: ["pipe", "pipe", "pipe"],
  env: smokeEnv,
});

let output = "";
let backendReady = false;
const recordOutput = (chunk) => {
  output += chunk.toString();
  if (!backendReady && output.includes("Synara running")) {
    backendReady = true;
    clearInterval(readinessPoll);
    child.kill();
  }
};
child.stdout.on("data", (chunk) => {
  recordOutput(chunk);
});
child.stderr.on("data", (chunk) => {
  recordOutput(chunk);
});

const readinessPoll = setInterval(() => {
  let backendOutput = "";
  try {
    backendOutput = readFileSync(backendLog, "utf8");
  } catch {
    return;
  }
  if (!backendOutput.includes("Synara running")) {
    return;
  }
  backendReady = true;
  clearInterval(readinessPoll);
  child.kill();
}, 100);

const timeout = setTimeout(() => {
  clearInterval(readinessPoll);
  child.kill();
}, 15_000);

child.on("exit", () => {
  clearTimeout(timeout);
  clearInterval(readinessPoll);

  let backendOutput = "";
  try {
    backendOutput = readFileSync(backendLog, "utf8");
  } catch {
    // Missing log is reported by the readiness assertion below.
  }
  rmSync(smokeHome, { recursive: true, force: true });

  const fatalPatterns = [
    "Cannot find module",
    "MODULE_NOT_FOUND",
    "Refused to execute",
    "Uncaught Error",
    "Uncaught TypeError",
    "Uncaught ReferenceError",
  ];
  const failures = fatalPatterns.filter((pattern) => output.includes(pattern));
  if (!backendReady) {
    failures.push("Backend did not reach the Synara running state");
  }

  if (failures.length > 0) {
    console.error("\nDesktop smoke test failed:");
    for (const failure of failures) {
      console.error(` - ${failure}`);
    }
    console.error("\nDesktop output:\n" + output);
    console.error("\nBackend output:\n" + backendOutput);
    process.exit(1);
  }

  console.log("Desktop smoke test passed.");
  process.exit(0);
});
