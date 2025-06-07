import * as vscode from 'vscode';
import { CodeAnalyzerAgent } from '../agents/codeAnalyzerAgent.js';
import { DiagnosticManager } from '../diagnostics/diagnosticManager.js';

export class HoverProvider implements vscode.HoverProvider {
    constructor(
        private analyzer: CodeAnalyzerAgent,
        private diagnosticManager: DiagnosticManager
    ) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        const diagnostics = vscode.languages.getDiagnostics(document.uri);
        const diagnostic = diagnostics.find(d => d.range.contains(position));
        
        if (!diagnostic || diagnostic.source !== 'Technical Debt Detective') {
            return undefined;
        }

        const issueData = (diagnostic as any).issueData;
        if (!issueData) {return undefined;}

        const analysis = this.diagnosticManager.getAnalysis(document.uri);
        if (!analysis) {return undefined;}

        const markdown = new vscode.MarkdownString();
        markdown.supportHtml = true;
        
        markdown.appendMarkdown(`## 🚨 ${issueData.type}\n\n`);
        markdown.appendMarkdown(`**Severity:** ${this.getSeverityBadge(issueData.severity)}\n\n`);
        markdown.appendMarkdown(`**Description:** ${issueData.description}\n\n`);
        markdown.appendMarkdown(`**Estimated fix time:** ${issueData.fixTime} minutes\n\n`);
        
        if (issueData.suggestion) {
            markdown.appendMarkdown(`### 💡 Suggestion\n${issueData.suggestion}\n\n`);
        }

        markdown.appendMarkdown(`### 📊 File Health\n`);
        markdown.appendMarkdown(`- **Health Score:** ${analysis.healthScore}/10\n`);
        markdown.appendMarkdown(`- **Total Issues:** ${analysis.issues.length}\n`);
        
        if (analysis.metrics) {
            markdown.appendMarkdown(`- **Complexity:** ${analysis.metrics.complexity}\n`);
            markdown.appendMarkdown(`- **Code Smells:** ${analysis.metrics.codeSmells}\n`);
        }

        markdown.appendMarkdown('\n---\n');
        markdown.appendMarkdown('💡 **Actions:** Use Quick Fix (Ctrl+.) to apply suggested fixes');

        return new vscode.Hover(markdown, diagnostic.range);
    }

    private getSeverityBadge(severity: string): string {
        const badges = {
            high: '🔴 High',
            medium: '🟡 Medium',
            low: '🟢 Low'
        };
        return badges[severity as keyof typeof badges] || severity;
    }
}