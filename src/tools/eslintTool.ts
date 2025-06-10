import { Tool } from "@langchain/core/tools";

export class ESLintTool extends Tool {
  name = "eslint_analyzer";
  description = "Analyzes JavaScript/TypeScript code for quality issues, best practices violations, and potential bugs using ESLint rules";

  async _call(input: string): Promise<string> {
    try {
      // Extract the actual code from numbered input if present
      const actualCode = this.extractCodeFromNumberedInput(input);
      const issues = this.analyzeCodeManually(actualCode, input);
      
      return JSON.stringify({
        tool: "eslint",
        status: issues.length > 0 ? "issues_found" : "clean",
        issuesFound: issues.length,
        issues: issues
      });
    } catch (error) {
      return JSON.stringify({
        tool: "eslint",
        status: "error",
        error: `ESLint analysis failed: ${error}`
      });
    }
  }

  private extractCodeFromNumberedInput(input: string): string {
    // Check if input has line numbers (format: "1: code", "2: code", etc.)
    const lines = input.split('\n');
    const numberedLines = lines.filter(line => /^\d+:\s/.test(line));
    
    if (numberedLines.length > 0) {
      // Extract code by removing line numbers
      return numberedLines
        .map(line => line.replace(/^\d+:\s/, ''))
        .join('\n');
    }
    
    // Return input as-is if no line numbers found
    return input;
  }

  private getOriginalLineNumber(input: string, codeLineIndex: number): number {
    // If input has line numbers, extract the original line number
    const lines = input.split('\n');
    const numberedLines = lines.filter(line => /^\d+:\s/.test(line));
    
    if (numberedLines.length > 0 && codeLineIndex < numberedLines.length) {
      const numberedLine = numberedLines[codeLineIndex];
      const match = numberedLine.match(/^(\d+):\s/);
      if (match) {
        return parseInt(match[1]);
      }
    }
    
    // Fallback: return 1-based line number
    return codeLineIndex + 1;
  }

  private analyzeCodeManually(code: string, originalInput: string): any[] {
    const issues: any[] = [];
    const lines = code.split('\n');

    lines.forEach((line, index) => {
      const originalLineNum = this.getOriginalLineNumber(originalInput, index);
      const trimmedLine = line.trim();

      // Check for var usage
      if (trimmedLine.includes('var ')) {
        issues.push({
          line: originalLineNum,
          column: line.indexOf('var') + 1,
          severity: "high",
          rule: "no-var",
          message: "Use 'let' or 'const' instead of 'var'",
          fixTime: 2
        });
      }

      // Check for console.log
      if (trimmedLine.includes('console.log')) {
        issues.push({
          line: originalLineNum,
          column: line.indexOf('console.log') + 1,
          severity: "medium",
          rule: "no-console",
          message: "Remove console.log statement",
          fixTime: 1
        });
      }

      // Check for == instead of ===
      if (trimmedLine.includes('==') && !trimmedLine.includes('===') && !trimmedLine.includes('!=')) {
        issues.push({
          line: originalLineNum,
          column: line.indexOf('==') + 1,
          severity: "medium",
          rule: "eqeqeq",
          message: "Use '===' instead of '=='",
          fixTime: 1
        });
      }

      // Check for != instead of !==
      if (trimmedLine.includes('!=') && !trimmedLine.includes('!==')) {
        issues.push({
          line: originalLineNum,
          column: line.indexOf('!=') + 1,
          severity: "medium",
          rule: "eqeqeq",
          message: "Use '!==' instead of '!='",
          fixTime: 1
        });
      }

      // Check for unused variables (simple detection)
      const varMatch = trimmedLine.match(/(?:let|const|var)\s+(\w+)/);
      if (varMatch) {
        const varName = varMatch[1];
        // Simple check: if variable name appears only once in entire code
        const usageCount = (code.match(new RegExp(`\\b${varName}\\b`, 'g')) || []).length;
        if (usageCount === 1) {
          issues.push({
            line: originalLineNum,
            column: line.indexOf(varName) + 1,
            severity: "medium",
            rule: "no-unused-vars",
            message: `'${varName}' is assigned but never used`,
            fixTime: 3
          });
        }
      }

      // Check for long lines
      if (line.length > 120) {
        issues.push({
          line: originalLineNum,
          column: 120,
          severity: "low",
          rule: "max-len",
          message: "Line exceeds maximum length",
          fixTime: 5
        });
      }

      // Check for missing semicolons (basic check)
      if (trimmedLine.length > 0 && 
          !trimmedLine.endsWith(';') && 
          !trimmedLine.endsWith('{') && 
          !trimmedLine.endsWith('}') &&
          !trimmedLine.startsWith('//') &&
          !trimmedLine.startsWith('*') &&
          !trimmedLine.includes('if') &&
          !trimmedLine.includes('else') &&
          !trimmedLine.includes('for') &&
          !trimmedLine.includes('while') &&
          (trimmedLine.includes('=') || trimmedLine.includes('('))) {
        issues.push({
          line: originalLineNum,
          column: line.length,
          severity: "low",
          rule: "semi",
          message: "Missing semicolon",
          fixTime: 1
        });
      }

      // Check for function complexity (basic check)
      if (trimmedLine.includes('function') || trimmedLine.match(/\w+\s*=>\s*{/)) {
        const openBraces = (line.match(/\{/g) || []).length;
        const closeBraces = (line.match(/\}/g) || []).length;
        
        // Simple heuristic for complex functions
        if (openBraces > 2) {
          issues.push({
            line: originalLineNum,
            column: 1,
            severity: "medium",
            rule: "complexity",
            message: "Function appears to be complex, consider refactoring",
            fixTime: 30
          });
        }
      }
    });

    return issues;
  }
}