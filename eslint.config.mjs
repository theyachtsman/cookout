import next from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * Deliberately narrow: the Rules of Hooks, and nothing else.
 *
 * A full Next/TypeScript preset over a codebase this size would print several
 * hundred pre-existing warnings, and a lint nobody can get to zero is a lint
 * nobody reads. This one rule has already cost us a production outage —
 * `useCollectionVisible()` placed below an early return took every public
 * profile down, and neither tsc nor the build can see that, because the error
 * only exists on the second render.
 *
 * Add rules here when they earn their place the same way.
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "contracts/artifacts/**",
      "contracts/cache/**",
    ],
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    // Registered so the `eslint-disable-next-line @next/next/...` comments
    // already in the source resolve rather than erroring as unknown rules.
    plugins: { "react-hooks": reactHooks, "@next/next": next },
    rules: {
      // The one that bit us. Never a warning.
      "react-hooks/rules-of-hooks": "error",
      // Genuinely useful but noisy on existing code; surfaced, not blocking.
      "react-hooks/exhaustive-deps": "warn",
      // On only so the deliberate `<img>` opt-outs already in the source read
      // as decisions rather than as dead directives.
      "@next/next/no-img-element": "warn",
    },
  },
);
