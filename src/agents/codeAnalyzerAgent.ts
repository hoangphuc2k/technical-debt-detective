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
      model: this.config.get<string>("geminiModel") || "gemini-2.0-flash",
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
        `You are a Technical Debt Detective. You MUST use ALL available tools to analyze code.

MANDATORY ANALYSIS STEPS:
1. FIRST: Use eslint_analyzer tool to check code quality
2. SECOND: Use complexity_analyzer tool to measure complexity  
3. THIRD: Use duplicate_detector tool to find duplicates
4. FOURTH: Use sonarqube_analyzer tool for additional analysis
5. ONLY AFTER using ALL 4 tools, provide your final analysis

IMPORTANT RULES:
- You MUST call all 4 tools before responding
- Combine all tool results into your analysis
- Always provide the response in this EXACT JSON format (no markdown, no extra text):

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
      maxIterations: 10, // Increased to ensure all tools are called
    });
  }

  async analyzeCode(code: string, filePath: string): Promise<AnalysisResult> {
    await this.initialized;

    const input = `Please analyze this code from ${filePath}. 

You MUST use ALL 4 tools (eslint_analyzer, complexity_analyzer, duplicate_detector, sonarqube_analyzer) before providing your response.

Code to analyze:
\`\`\`
${code}
\`\`\`

Remember: Call ALL tools first, then provide the JSON response.`;

    try {
      const result = await this.executor.invoke({ input });
      return this.parseAnalysisResult(result.output);
    } catch (error) {
      console.error("Analysis error:", error);
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
    
    Provide ONLY the fixed code snippet for the problematic section.`;

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
    
    Provide a clear explanation covering:
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

  private getCodeContext(code: string, line: number, context: number = 5): string {
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
      // Try to extract JSON from the output
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      let parsed;
      
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        // If no JSON found, try parsing the whole output
        parsed = JSON.parse(output);
      }

      return {
        healthScore: Math.max(1, Math.min(10, parsed.healthScore ?? 5)),
        issues: Array.isArray(parsed.issues)
          ? parsed.issues.map((issue: any) => ({
              type: issue.type ?? "unknown",
              severity: this.normalizeSeverity(issue.severity),
              line: parseInt(issue.line) || 1,
              description: issue.description ?? "No description",
              fixTime: parseInt(issue.fixTime) || 15,
              suggestion: issue.suggestion,
            }))
          : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
        metrics: parsed.metrics || {
          complexity: 1,
          duplicates: 0,
          codeSmells: 0
        },
      };
    } catch (err) {
      console.error("Failed to parse result:", err);
      console.error("Raw output:", output);
      
      // Fallback: try to extract issues from text
      return this.createFallbackResult(output);
    }
  }

  private normalizeSeverity(severity: any): "high" | "medium" | "low" {
    const sev = String(severity).toLowerCase();
    if (sev.includes("high") || sev.includes("error")) {return "high";}
    if (sev.includes("medium") || sev.includes("warn")) {return "medium";}
    return "low";
  }

  private createFallbackResult(output: string): AnalysisResult {
    const issues: CodeIssue[] = [];
    
    if (output.includes("console.log")) {
      issues.push({
        type: "console-usage",
        severity: "medium",
        line: 1,
        description: "Console.log statement found",
        fixTime: 2,
        suggestion: "Remove console.log statements"
      });
    }

    return {
      healthScore: 6,
      issues: issues,
      suggestions: ["Consider refactoring for better code quality"],
      metrics: {
        complexity: 1,
        duplicates: 0,
        codeSmells: issues.length
      }
    };
  }

  private handleError(error: unknown, context: string): AnalysisResult {
    console.error(`Error during ${context}:`, error);
    return {
      healthScore: 5,
      issues: [{
        type: "analysis-error",
        severity: "medium",
        line: 1,
        description: `Error during ${context}`,
        fixTime: 0,
        suggestion: "Check extension logs for details"
      }],
      suggestions: [`Error during ${context}. Check logs for details.`],
      metrics: {
        complexity: 1,
        duplicates: 0,
        codeSmells: 1
      }
    };
  }
}