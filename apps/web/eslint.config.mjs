import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * eslint-config-next ships these as flat-config arrays already — importing
 * them directly (rather than through the legacy `FlatCompat` eslintrc shim)
 * avoids a circular-JSON crash in `@eslint/eslintrc`'s schema validator when
 * it tries to interpret an already-flat `eslint-plugin-react` config as
 * legacy eslintrc shape. See internal/product/DECISIONS.md for the note on
 * why this repo pins TypeScript to 6.x and ESLint to 9.x for the lint
 * toolchain specifically.
 */
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [".next/**", "node_modules/**"],
  },
];

export default eslintConfig;
