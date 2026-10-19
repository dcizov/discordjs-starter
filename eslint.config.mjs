import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import globals from "globals";
const sourceFiles = ["src/**/*.ts"];
export default [
  {
    ignores: [
      "**/build/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/logs/**",
      "**/*.log",
      "**/.env",
      "**/.env.*",
      "!**/.env.example",
    ],
  },
  {
    ...js.configs.recommended,
    files: sourceFiles,
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: globals.node,
    },
  },
  ...tsPlugin.configs["flat/recommended-type-checked"].map((config) => ({
    ...config,
    files: sourceFiles,
  })),
  {
    files: sourceFiles,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: false,
        },
      ],
    },
  },
  eslintConfigPrettier,
];
