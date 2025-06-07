import { Tool } from "langchain/tools";
import * as ts from "typescript";

export class ComplexityTool extends Tool {
  name = "complexity_analyzer";
  description =
    "Calculates cyclomatic complexity of JavaScript/TypeScript code";

  async _call(code: string): Promise<string> {
    const sourceFile = ts.createSourceFile(
      "temp.ts",
      code,
      ts.ScriptTarget.Latest,
      true
    );

    const complexityReport = this.analyzeComplexity(sourceFile);
    return JSON.stringify(complexityReport);
  }

  private analyzeComplexity(sourceFile: ts.SourceFile): any {
    let complexity = 1; // Base complexity
    const report = {
      totalComplexity: 0,
      functions: [] as any[],
    };

    const visit = (node: ts.Node) => {
      // Count decision points
      switch (node.kind) {
        case ts.SyntaxKind.IfStatement:
        case ts.SyntaxKind.ConditionalExpression:
        case ts.SyntaxKind.CaseClause:
        case ts.SyntaxKind.CatchClause:
        case ts.SyntaxKind.WhileStatement:
        case ts.SyntaxKind.DoStatement:
        case ts.SyntaxKind.ForStatement:
        case ts.SyntaxKind.ForInStatement:
        case ts.SyntaxKind.ForOfStatement:
          complexity++;
          break;
      }

      // Check for functions
      if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
        const name = node.name?.getText() || "anonymous";
        const funcComplexity = this.calculateFunctionComplexity(node);
        report.functions.push({
          name,
          complexity: funcComplexity,
          line: sourceFile.getLineAndCharacterOfPosition(node.pos).line + 1,
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    report.totalComplexity = complexity;
    return report;
  }

  private calculateFunctionComplexity(node: ts.Node): number {
    let complexity = 1;

    const visit = (node: ts.Node) => {
      switch (node.kind) {
        case ts.SyntaxKind.IfStatement:
        case ts.SyntaxKind.ConditionalExpression:
        case ts.SyntaxKind.CaseClause:
        case ts.SyntaxKind.CatchClause:
        case ts.SyntaxKind.WhileStatement:
        case ts.SyntaxKind.DoStatement:
        case ts.SyntaxKind.ForStatement:
        case ts.SyntaxKind.ForInStatement:
        case ts.SyntaxKind.ForOfStatement:
          complexity++;
          break;
      }
      ts.forEachChild(node, visit);
    };

    visit(node);
    return complexity;
  }
}
