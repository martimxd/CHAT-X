import js from "@eslint/js";

export default [
  {
    ignores: ["coverage/**"]
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        Buffer: "readonly",
        console: "readonly",
        crypto: "readonly",
        fetch: "readonly",
        process: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setTimeout: "readonly",
        URL: "readonly"
      }
    },
    rules: {
      "no-console": ["error", { "allow": ["info", "warn", "error"] }]
    }
  }
];
