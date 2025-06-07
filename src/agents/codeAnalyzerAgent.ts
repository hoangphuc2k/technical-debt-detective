import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import * as vscode from "vscode";
import { ESLintTool } from "../tools/eslintTool.js";
import { ComplexityTool } from "../tools/complexityTool.js";
import { DuplicateDetectorTool } from "../tools/duplicateDetector.js";
import { SonarQubeTool } from "../tools/sonarTool.js";

export interface CodeIssue {
  type: string;
  severity: "high" | "medium" | "low";
  line: number;
  description: string;
  fixTime: number;
  suggestion?: string;
}

export interface AnalysisResult {
  healthScore: number;
  issues: CodeIssue[];
  suggestions: string[];
  metrics?: {
    complexity: number;
    duplicates: number;
    codeSmells: number;
  };
}

export class CodeAnalyzerAgent {
  private model: ChatGoogleGenerativeAI;
  private executor!: AgentExecutor;
  private initialized: Promise<void>;
  private config: vscode.WorkspaceConfiguration;

  constructor(config: vscode.WorkspaceConfiguration) {
    this.config = config;
    this.model = new ChatGoogleGenerativeAI({
      model: this.config.get<string>("geminiModel") || "gemini-1.5-pro-latest",
      apiKey: this.config.get<string>("geminiApiKey"),
      temperature: 0,
      maxOutputTokens: 2048,
    });

    this.initialized = this.initializeAgent();
  }

  private async initializeAgent() {
    const tools = [
      new ESLintTool(),
      new ComplexityTool(),
      new DuplicateDetectorTool(),
      new SonarQubeTool(),
    ];

    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        `You are a Technical Debt Detective, an expert code reviewer. 
        Use the available tools to analyze code for:
        - Code smells (God Class, Long Method, Duplicate Code, etc.)
        - Complexity issues
        - Best practice violations
        - Potential bugs
        
        IMPORTANT: You MUST use the tools to analyze the code before providing results.
        
        Always respond in valid JSON format:
        {{
            "healthScore": <number 1-10>,
            "issues": [
                {{
                    "type": "<issue type>",
                    "severity": "<high|medium|low>",
                    "line": <line number>,
                    "description": "<clear description>",
                    "fixTime": <estimated minutes>,
                    "suggestion": "<how to fix>"
                }}
            ],
            "suggestions": ["<actionable suggestion 1>", "<suggestion 2>"],
            "metrics": {{
                "complexity": <number>,
                "duplicates": <number>,
                "codeSmells": <number>
            }}
        }}`,
      ],
      ["user", "{input}"],
      new MessagesPlaceholder("agent_scratchpad"),
    ]);

    const agent = await createToolCallingAgent({
      llm: this.model,
      tools,
      prompt,
    });

    this.executor = new AgentExecutor({
      agent,
      tools,
      verbose: true,
      maxIterations: 5,
    });
  }

  async analyzeCode(code: string, filePath: string): Promise<AnalysisResult> {
    await this.initialized;

    const input = `Analyze this code from ${filePath} using ALL available tools.
    
    Code to analyze:
    \`\`\`javascript
    ${code}
    \`\`\`
    
    IMPORTANT: Use ESLintTool, ComplexityTool, DuplicateDetectorTool, and SonarQubeTool to analyze the code.
    Then provide a comprehensive assessment based on the tool results.`;

    try {
      const result = await this.executor.invoke({ input });
      return this.parseAnalysisResult(result.output);
    } catch (error) {
      return this.handleError(error, "analyzing code");
    }
  }

  async generateFix(code: string, issue: CodeIssue): Promise<string> {
    await this.initialized;

    const input = `Generate a code fix for this issue:
    
    Issue: ${issue.description} at line ${issue.line}
    Type: ${issue.type}
    
    Original code:
    \`\`\`javascript
    ${code}
    \`\`\`
    
    Provide ONLY the fixed code snippet for the problematic section. 
    Make minimal changes to fix the issue.`;

    try {
      const result = await this.executor.invoke({ input });
      return result.output || "Unable to generate fix";
    } catch (error) {
      console.error("Fix generation error:", error);
      return "Unable to generate fix";
    }
  }

  async explainIssue(code: string, issue: CodeIssue): Promise<string> {
    await this.initialized;

    const input = `Explain this code issue in detail:
    
    Issue: ${issue.description} at line ${issue.line}
    Type: ${issue.type}
    Severity: ${issue.severity}
    
    Code context:
    \`\`\`javascript
    ${this.getCodeContext(code, issue.line)}
    \`\`\`
    
    Provide:
    1. What this issue means
    2. Why it's problematic
    3. How to fix it with example
    4. Best practices to avoid it`;

    try {
      const result = await this.executor.invoke({ input });
      return result.output || "Unable to explain issue";
    } catch (error) {
      return this.handleError(error, "explaining issue").suggestions[0];
    }
  }

  private getCodeContext(
    code: string,
    line: number,
    context: number = 5
  ): string {
    const lines = code.split("\n");
    const start = Math.max(0, line - context - 1);
    const end = Math.min(lines.length, line + context);

    return lines
      .slice(start, end)
      .map((l, i) => `${start + i + 1} | ${l}`)
      .join("\n");
  }

  private parseAnalysisResult(output: string): AnalysisResult {
    try {
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(output);

      return {
        healthScore: Math.max(1, Math.min(10, parsed.healthScore ?? 5)),
        issues: Array.isArray(parsed.issues)
          ? parsed.issues.map((issue: any) => ({
              type: issue.type ?? "unknown",
              severity: issue.severity ?? "medium",
              line: parseInt(issue.line) || 1,
              description: issue.description ?? "No description",
              fixTime: parseInt(issue.fixTime) || 15,
              suggestion: issue.suggestion,
            }))
          : [],
        suggestions: parsed.suggestions ?? [],
        metrics: parsed.metrics,
      };
    } catch (err) {
      console.error("Failed to parse result:", err);
      return {
        healthScore: 5,
        issues: [],
        suggestions: ["Analysis completed but results could not be parsed"],
      };
    }
  }

  private handleError(error: unknown, context: string): AnalysisResult {
    console.error(`Error during ${context}:`, error);
    return {
      healthScore: 5,
      issues: [],
      suggestions: [`Error during ${context}. Check logs for details.`],
    };
  }
}
