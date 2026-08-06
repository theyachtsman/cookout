import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Refuse to run against a stale build of @cookout/shared.
 *
 * The server runs from TypeScript source via tsx, but `@cookout/shared`
 * resolves to its compiled `dist/`. A deploy that pulls new code and runs
 * `npm i` does NOT rebuild that package — `npm i` has nothing to do. So the
 * server can run today's code against a build from hours ago and, because the
 * two disagree only in field names, nothing throws: values read as `undefined`,
 * arithmetic yields NaN, NaN serialises to null, and the null is written back
 * into a live round. That is not a crash, it is silent corruption of the exact
 * data players are in the middle of trading.
 *
 * Failing to start is the lesser harm. A dead service is obvious in thirty
 * seconds; a poisoned round is discovered by whoever launched a coin into it.
 */
export function assertSharedBuildFresh(root: string): void {
  const pkg = join(root, "packages/shared");
  const newest = (dir: string): number => {
    let latest = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      latest = Math.max(latest, entry.isDirectory() ? newest(full) : statSync(full).mtimeMs);
    }
    return latest;
  };

  let src: number;
  let dist: number;
  try {
    src = newest(join(pkg, "src"));
    dist = newest(join(pkg, "dist"));
  } catch {
    // No checkout laid out this way (a packaged deploy, a test harness). Not
    // our business to guess — the check only exists for the repo-shaped case.
    return;
  }

  if (src > dist) {
    const behind = Math.round((src - dist) / 1000);
    console.error(
      `\n@cookout/shared is stale — its source is ${behind}s newer than its build.\n` +
        `The server would run new code against an old shared package and write\n` +
        `NaN into live rounds instead of failing. Build it and start again:\n\n` +
        `    npm run build -w @cookout/shared\n`,
    );
    process.exit(1);
  }
}
