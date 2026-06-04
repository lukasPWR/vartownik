import { includeIgnoreFile } from "@eslint/compat";
import eslint from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import eslintPluginAstro from "eslint-plugin-astro";
import pluginVue from "eslint-plugin-vue";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";
import vueParser from "vue-eslint-parser";

// File path setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gitignorePath = path.resolve(__dirname, ".gitignore");

const baseConfig = tseslint.config({
  extends: [eslint.configs.recommended, tseslint.configs.strict, tseslint.configs.stylistic],
  languageOptions: {
    globals: {
      AbortController: "readonly",
      AbortSignal: "readonly",
      BeforeUnloadEvent: "readonly",
      clearInterval: "readonly",
      clearTimeout: "readonly",
      console: "readonly",
      document: "readonly",
      Event: "readonly",
      fetch: "readonly",
      FormData: "readonly",
      HTMLInputElement: "readonly",
      HTMLTextAreaElement: "readonly",
      Request: "readonly",
      Response: "readonly",
      sessionStorage: "readonly",
      setInterval: "readonly",
      setTimeout: "readonly",
      URL: "readonly",
      URLSearchParams: "readonly",
      window: "readonly",
    },
  },
  rules: {
    "no-console": "warn",
    "no-unused-vars": "off",
    "vue/multi-word-component-names": "off",
  },
});

export default tseslint.config(
  includeIgnoreFile(gitignorePath),
  {
    ignores: ["src/db/database.types.ts", "worker-configuration.d.ts"],
  },
  baseConfig,
  ...pluginVue.configs["flat/recommended"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".vue"],
        sourceType: "module",
      },
    },
  },
  ...eslintPluginAstro.configs["flat/recommended"],
  {
    rules: {
      "vue/multi-word-component-names": "off",
    },
  },
  eslintPluginPrettier
);
