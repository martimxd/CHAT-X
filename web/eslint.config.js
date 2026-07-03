import js from "@eslint/js";
import hooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: ["dist/**", "coverage/**"]
  },
  js.configs.recommended,
  {
    plugins: {
      "react-hooks": hooks
    },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true }
      },
      globals: {
        Blob: "readonly",
        CompressionStream: "readonly",
        DecompressionStream: "readonly",
        FileReader: "readonly",
        File: "readonly",
        FormData: "readonly",
        Headers: "readonly",
        Image: "readonly",
        Response: "readonly",
        TextDecoder: "readonly",
        TextEncoder: "readonly",
        URL: "readonly",
        atob: "readonly",
        btoa: "readonly",
        crypto: "readonly",
        document: "readonly",
        fetch: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        sessionStorage: "readonly",
        window: "readonly"
      }
    },
    rules: {
      ...hooks.configs.recommended.rules,
      "no-console": ["error", { "allow": ["warn", "error"] }]
    }
  }
];
