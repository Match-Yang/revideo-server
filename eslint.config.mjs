import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["build/**", "out/**", "node_modules/**", "public/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
    },
  },
  {
    files: ["src/**/*.ts", "scripts/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["src/ui/**/*.js"],
    languageOptions: {
      globals: {
        alert: "readonly",
        clearTimeout: "readonly",
        confirm: "readonly",
        document: "readonly",
        EventSource: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        localStorage: "readonly",
        location: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        URLSearchParams: "readonly",
        window: "readonly",
      },
    },
  },
];
