export default {
  "src/**/*.ts": ["eslint --fix", "prettier --write"],
  "*.mjs": "prettier --write",
  "package.json": "prettier --write",
  "tsconfig.json": "prettier --write",
  ".vscode/settings.json": "prettier --write",
};
