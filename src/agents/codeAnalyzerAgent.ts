import { ChatOllama } from '@langchain/ollama';
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
  codeSnippet?: string;
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
  private model: ChatOllama | ChatGoogleGenerativeAI;
  private executor!: AgentExecutor;
  private initialized: Promise<void>;
  private config: vscode.WorkspaceConfiguration;

  constructor(config: vscode.WorkspaceConfiguration) {
    this.config = config;

    // Check if using Ollama or Gemini
    const provider = this.config.get<string>("modelProvider") || "gemini";

    if (provider === "ollama") {
      this.model = new ChatOllama({
        model: this.config.get<string>("ollamaModel") || "llama3.2",
        baseUrl: this.config.get<string>("ollamaUrl") || "http://localhost:11434",
        temperature: 0,
      });
    } else {
      this.model = new ChatGoogleGenerativeAI({
        model: this.config.get<string>("geminiModel") || "gemini-2.0-flash",
        apiKey: this.config.get<string>("geminiApiKey"),
        temperature: 0,
        maxOutputTokens: 2048,
      });
    }

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
        `You are a Technical Debt Detective - an expert code analyzer that identifies quality issues, technical debt, and provides actionable recommendations.

IMPORTANT: You MUST analyze the code yourself based on the tool outputs. The tools return the code for you to analyze, not the results.

Your analysis process:
1. When eslint_analyzer returns code, YOU analyze it for:
   - var usage (should use let/const)
   - console.log statements (should be removed in production)
   - == instead of === (use strict equality)
   - != instead of !== (use strict inequality)
   - Missing semicolons (for consistency)
   - Unused variables
   - Long lines (>120 characters)
   
2. When complexity_analyzer returns code, YOU calculate:
   - Cyclomatic complexity for each function (count if, for, while, switch cases, etc.)
   - Flag functions with complexity > 10 as high risk
   - Overall file complexity

3. When duplicate_detector returns code, YOU find:
   - Exact duplicate code blocks (3+ lines)
   - Similar patterns that could be refactored
   - Repeated logic structures

4. When sonarqube_analyzer returns code, YOU identify:
   - Potential bugs and logic errors
   - Security vulnerabilities
   - Code smells (God classes, long methods, etc.)
   - Maintainability issues

5. You are not allowed to return or suggest any code that includes process.exit, eval, require, or spawn.
After analyzing with ALL tools, provide a comprehensive response in this EXACT JSON format:

{{
  "healthScore": <number 1-10 based on overall code quality>,
  "issues": [
    {{
      "type": "<specific issue type like no-var, no-console, complexity, duplicate-code, etc>",
      "severity": "<high|medium|low>",
      "line": <exact line number where issue occurs>,
      "description": "<clear description of the issue>",
      "fixTime": <estimated minutes to fix>,
      "suggestion": "<specific fix recommendation>",
      "codeSnippet": "<3-5 words from the problematic line to help locate it>"
    }}
  ],
  "suggestions": ["<overall improvement suggestion 1>", "<suggestion 2>"],
  "metrics": {{
    "complexity": <highest function complexity found>,
    "duplicates": <number of duplicate blocks>,
    "codeSmells": <total number of code smells>
  }}
}}

IMPORTANT: When returning codeSnippet, do NOT include escape sequences or special characters that would break JSON parsing. Keep it simple.

Remember: YOU must perform the actual analysis. The tools just give you the code to analyze.`,
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
      maxIterations: 10,
    });
  }

  async analyzeCode(code: string, filePath: string): Promise<AnalysisResult> {
    await this.initialized;

    // Add line numbers to help AI understand line positions
    const numberedCode = code.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n');

    const input = `Analyze this ${filePath} file for technical debt and code quality issues.

You MUST use ALL 4 tools to analyze the code, then provide your own analysis based on what each tool returns.

Code with line numbers:
\`\`\`
${numberedCode}
\`\`\`

Steps:
1. Call eslint_analyzer - then YOU identify linting issues
2. Call complexity_analyzer - then YOU calculate complexity 
3. Call duplicate_detector - then YOU find duplicates
4. Call sonarqube_analyzer - then YOU find bugs/vulnerabilities

Finally, compile all YOUR findings into the JSON response format.`;

    const result = await this.executor.invoke({ input });
    return this.parseAnalysisResult(result.output);
  }

  async generateFix(code: string, issue: CodeIssue): Promise<string> {
    await this.initialized;

    const lines = code.split('\n');
    const lineIndex = Math.max(0, issue.line - 1);
    const problemLine = lines[lineIndex] || '';

    // Get context around the problematic line
    const contextStart = Math.max(0, issue.line - 5);
    const contextEnd = Math.min(lines.length, issue.line + 5);
    const contextLines = lines.slice(contextStart, contextEnd);
    const markedContext = contextLines.map((line, i) => {
      const lineNum = contextStart + i + 1;
      return lineNum === issue.line ? `>>> ${lineNum}: ${line}` : `${lineNum}: ${line}`;
    }).join('\n');

    const input = `You are a code fixer. Fix this specific issue and return ONLY the corrected code.

Issue Type: ${issue.type}
Issue Description: ${issue.description}
Suggestion: ${issue.suggestion || 'Fix the issue'}

Code context (line ${issue.line} marked with >>>):
${markedContext}

IMPORTANT INSTRUCTIONS:
1. Fix the issue on line ${issue.line} based on the issue description
2. Return ONLY the fixed code - could be a single line or multiple lines if needed
3. Do NOT include line numbers, explanations, JSON, or markdown
4. Just return the actual fixed code that should replace the problematic code

For example:
- If it's a console.log issue, comment it out or remove it
- If it's a var issue, replace with let or const
- If it's a complexity issue, refactor the function
- If it's a code smell, apply the suggested fix`;

    try {
      const result = await this.executor.invoke({ input });
      let fixedCode = result.output || "";

      // Clean up the response
      fixedCode = fixedCode
        .replace(/^```[a-z]*\n?/, '') // Remove opening code block
        .replace(/\n?```$/, '') // Remove closing code block
        .replace(/^["']|["']$/g, '') // Remove quotes
        .trim();

      // Validate the response
      if (fixedCode.includes('"healthScore"') || fixedCode.includes('{') && fixedCode.includes('}') && fixedCode.includes('"issues"')) {
        console.error('AI returned JSON instead of fixed code, trying again with simpler prompt');

        // Try a simpler approach
        const simpleInput = `Fix this code issue:
${problemLine}

Issue: ${issue.description}
How to fix: ${issue.suggestion}

Return ONLY the fixed line of code, nothing else.`;

        const simpleResult = await this.executor.invoke({ input: simpleInput });
        fixedCode = simpleResult.output || problemLine;
        fixedCode = fixedCode.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
      }

      // If still getting JSON or empty response, apply a simple fix based on type
      if (!fixedCode || fixedCode.includes('"healthScore"')) {
        console.warn('Failed to get proper fix from AI, applying fallback');
        if (issue.type === 'no-console') {
          return '    // ' + problemLine.trim(); // Preserve some indentation
        } else if (issue.type === 'no-var') {
          return problemLine.replace(/\bvar\b/, 'let');
        } else if (issue.type === 'eqeqeq') {
          return problemLine.replace(/!=/g, '!==').replace(/==/g, '===');
        } else {
          return problemLine; // Return original if we can't fix
        }
      }

      return fixedCode;
    } catch (error) {
      console.error("Fix generation error:", error);
      return problemLine; // Return original line on error
    }
  }

  async explainIssue(code: string, issue: CodeIssue): Promise<string> {
    await this.initialized;

    const input = `Explain this code quality issue:
    
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

    const result = await this.executor.invoke({ input });
    return result.output || "Unable to explain issue";
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
            codeSnippet: issue.codeSnippet,
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
    if (sev.includes("high") || sev.includes("error")) { return "high"; }
    if (sev.includes("medium") || sev.includes("warn")) { return "medium"; }
    return "low";
  }

  private createFallbackResult(output: string): AnalysisResult {
    const issues: CodeIssue[] = [];

    // Try to extract issues from the output text
    const lines = output.split('\n');
    lines.forEach(line => {
      if (line.includes("line") && line.includes(":")) {
        const lineMatch = line.match(/line\s*(\d+)/i);
        const lineNum = lineMatch ? parseInt(lineMatch[1]) : 1;

        if (line.toLowerCase().includes("console.log")) {
          issues.push({
            type: "no-console",
            severity: "medium",
            line: lineNum,
            description: "Console.log statement found",
            fixTime: 2,
            suggestion: "Remove console.log statements from production code"
          });
        } else if (line.toLowerCase().includes("var")) {
          issues.push({
            type: "no-var",
            severity: "high",
            line: lineNum,
            description: "Use of 'var' keyword",
            fixTime: 2,
            suggestion: "Replace 'var' with 'let' or 'const'"
          });
        }
      }
    });

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