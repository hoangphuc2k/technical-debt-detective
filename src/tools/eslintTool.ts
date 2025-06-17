import { Tool } from "@langchain/core/tools";

export class ESLintTool extends Tool {
  name = "eslint_analyzer";
  description = "Analyzes JavaScript/TypeScript code for quality issues, best practices violations, and potential bugs. The AI should analyze the code and return specific issues found including line numbers, severity, and fix suggestions.";

  async _call(input: string): Promise<string> {
    try {
      // Return the code for AI to analyze
      // The AI will identify issues like:
      // - var usage (should use let/const)
      // - console.log statements
      // - == instead of ===
      // - missing semicolons
      // - unused variables
      // - long lines
      // - high complexity
      return JSON.stringify({
        tool: "eslint",
        codeToAnalyze: input,
        requestType: "analyze_for_issues",
        expectedFormat: {
          issues: [
            {
              line: "number",
              column: "number", 
              severity: "high|medium|low",
              rule: "rule-name",
              message: "description",
              fixTime: "number in minutes"
            }
          ]
        }
      });
    } catch (error) {
      return JSON.stringify({
        tool: "eslint",
        status: "error",
        error: `ESLint analysis preparation failed: ${error}`
      });
    }
  }
}