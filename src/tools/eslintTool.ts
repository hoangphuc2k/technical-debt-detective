import { Tool } from "@langchain/core/tools";
import { ESLint } from "eslint";

export class ESLintTool extends Tool {
  name = "eslint";
  description = "Run ESLint to find code quality issues and best practice violations";

  private eslint: ESLint;

  constructor() {
    super();
    this.eslint = new ESLint({
      overrideConfig: {
        languageOptions: {
          parser: require("@typescript-eslint/parser"),
        },
        plugins: {
          "@typescript-eslint": require("@typescript-eslint/eslint-plugin"),
        },
        rules: {
          "no-unused-vars": "warn",
          "no-console": "warn",
          "prefer-const": "error",
          "no-var": "error",
          "eqeqeq": "error",
          "no-eval": "error",
          "no-implied-eval": "error",
          "complexity": ["warn", 10],
          "max-lines-per-function": ["warn", 50],
          "max-params": ["warn", 5],
          "max-depth": ["warn", 4],
          "max-nested-callbacks": ["warn", 3]
        }
      },
    });
  }

  async _call(input: string): Promise<string> {
    try {
      const results = await this.eslint.lintText(input, { filePath: "temp.js" });
      
      if (results.length === 0 || results[0].messages.length === 0) {
        return "No ESLint issues found";
      }

      const issues = results[0].messages.map(msg => ({
        line: msg.line,
        severity: msg.severity === 2 ? "error" : "warning",
        rule: msg.ruleId,
        message: msg.message
      }));

      return JSON.stringify({
        tool: "eslint",
        issuesFound: issues.length,
        issues: issues
      });
    } catch (error) {
      return `ESLint error: ${error}`;
    }
  }
}