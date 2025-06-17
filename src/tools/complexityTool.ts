import { Tool } from "langchain/tools";

export class ComplexityTool extends Tool {
  name = "complexity_analyzer";
  description = "Analyzes cyclomatic and cognitive complexity of JavaScript/TypeScript code. The AI should calculate complexity scores for each function/method and identify areas that are too complex.";

  async _call(code: string): Promise<string> {
    return JSON.stringify({
      tool: "complexity",
      codeToAnalyze: code,
      requestType: "analyze_complexity",
      instructions: "Analyze each function/method for cyclomatic complexity (count decision points like if, for, while, case statements). Return complexity scores and flag functions with complexity > 10 as high risk.",
      expectedFormat: {
        totalComplexity: "number",
        functions: [
          {
            name: "function name",
            complexity: "number",
            line: "line number"
          }
        ]
      }
    });
  }
}