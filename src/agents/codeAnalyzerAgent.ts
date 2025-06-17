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

    const input = `Fix this code issue and return the COMPLETE fixed code file.

Issue to fix:
- Type: ${issue.type}
- Line: ${issue.line}
- Description: ${issue.description}
- Suggestion: ${issue.suggestion}

Original code:
\`\`\`javascript
${code}
\`\`\`

IMPORTANT: 
1. Return the ENTIRE file with the issue fixed
2. Fix ONLY the specific issue mentioned above
3. Keep all other code exactly the same
4. Do NOT add any explanations or markdown
5. Return pure JavaScript/TypeScript code only`;

    const result = await this.executor.invoke({ input });
    let fixedCode = result.output || "";
    
    // Clean up any markdown formatting
    fixedCode = fixedCode
      .replace(/^```[a-z]*\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
    
    // Validate it's actual code
    if (fixedCode.includes('"healthScore"') || !fixedCode.includes('\n')) {
      // Apply simple fixes directly to the full code
      const lines = code.split('\n');
      const problemLine = lines[issue.line - 1] || '';
      
      if (issue.type === 'no-console') {
        lines[issue.line - 1] = '  // ' + problemLine.trim();
      } else if (issue.type === 'no-var') {
        lines[issue.line - 1] = problemLine.replace(/\bvar\b/, 'let');
      } else if (issue.type === 'eqeqeq') {
        lines[issue.line - 1] = problemLine.replace(/!=/g, '!==').replace(/==/g, '===');
      } else if (issue.type === 'semi') {
        lines[issue.line - 1] = problemLine.trimRight() + ';';
      }
      
      return lines.join('\n');
    }
    
    return fixedCode;
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
    // Extract JSON from the output
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    let jsonString = jsonMatch ? jsonMatch[0] : output;
    
    // Fix common JSON escaping issues from AI output
    // Replace improperly escaped regex patterns
    jsonString = jsonString.replace(/\\s/g, '\\\\s');
    jsonString = jsonString.replace(/\\"([^"]*?)\\"/g, (match, content) => {
      // Ensure proper escaping within strings
      return `"${content.replace(/\\/g, '\\\\')}"`;
    });
    
    // Try to parse with error recovery
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (parseError) {
      // If parsing fails, try to extract data manually
      console.warn("JSON parse failed, attempting recovery:", parseError);
      
      // Remove problematic codeSnippet fields and try again
      jsonString = jsonString.replace(/"codeSnippet":\s*"[^"]*"/g, '"codeSnippet": ""');
      parsed = JSON.parse(jsonString);
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
            codeSnippet: issue.codeSnippet || "",
          }))
        : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      metrics: parsed.metrics || {
        complexity: 1,
        duplicates: 0,
        codeSmells: 0
      },
    };
  }

  private normalizeSeverity(severity: any): "high" | "medium" | "low" {
    const sev = String(severity).toLowerCase();
    if (sev.includes("high") || sev.includes("error")) {return "high";}
    if (sev.includes("medium") || sev.includes("warn")) {return "medium";}
    return "low";
  }
}