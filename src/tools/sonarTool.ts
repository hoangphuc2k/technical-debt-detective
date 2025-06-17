import { Tool } from "langchain/tools";

export class SonarQubeTool extends Tool {
  name = "sonarqube_analyzer";
  description = "Performs comprehensive code analysis including bugs, vulnerabilities, code smells, and security issues. The AI should analyze the code for various quality and security problems.";

  async _call(input: string): Promise<string> {
    return JSON.stringify({
      tool: "sonarqube",
      codeToAnalyze: input,
      requestType: "comprehensive_analysis",
      instructions: "Perform a comprehensive analysis looking for bugs, security vulnerabilities, code smells, and maintainability issues. Consider OWASP security risks, performance problems, and architectural issues.",
      expectedFormat: {
        bugs: ["description with line number"],
        vulnerabilities: ["security issue with severity"],
        codeSmells: ["code smell type and location"],
        securityHotspots: ["potential security risk"],
        status: "completed"
      }
    });
  }
}