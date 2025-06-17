import { Tool } from "langchain/tools";

export class DuplicateDetectorTool extends Tool {
  name = "duplicate_detector";
  description = "Detects duplicate code blocks and similar patterns in JavaScript/TypeScript code. The AI should identify exact duplicates and similar code patterns that could be refactored.";

  async _call(code: string): Promise<string> {
    return JSON.stringify({
      tool: "duplicate_detector",
      codeToAnalyze: code,
      requestType: "find_duplicates",
      instructions: "Analyze the code to find duplicate blocks (3+ lines) and similar patterns. Look for repeated logic, similar function structures, and code that could be extracted into reusable functions.",
      expectedFormat: {
        exactDuplicates: [
          {
            locations: [{ start: "line", end: "line" }],
            lines: "number of lines",
            occurrences: "count",
            severity: "high|medium|low"
          }
        ],
        similarPatterns: [
          {
            type: "pattern type",
            pattern: "description",
            lines: ["line numbers"],
            message: "suggestion"
          }
        ],
        summary: {
          totalDuplicateBlocks: "number",
          totalDuplicateLines: "number"
        }
      }
    });
  }
}