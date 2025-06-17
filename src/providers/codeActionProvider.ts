import * as vscode from 'vscode';
import { CodeAnalyzerAgent, CodeIssue } from '../agents/codeAnalyzerAgent.js';

export class CodeActionProvider implements vscode.CodeActionProvider {
    constructor(private analyzer: CodeAnalyzerAgent) {}

    async provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext
    ): Promise<vscode.CodeAction[]> {
        const actions: vscode.CodeAction[] = [];

        // Get diagnostics for the current range
        for (const diagnostic of context.diagnostics) {
            const issueData = (diagnostic as any).issueData;
            if (!issueData) continue;

            // Quick Fix action - command-based approach for async operations
            const fixAction = new vscode.CodeAction(
                `Fix: ${issueData.type}`,
                vscode.CodeActionKind.QuickFix
            );
            fixAction.diagnostics = [diagnostic];
            fixAction.command = {
                command: 'techDebtDetective.applyFix',
                title: 'Apply Fix',
                arguments: [document, diagnostic, issueData]
            };
            actions.push(fixAction);

            // Explain action
            const explainAction = new vscode.CodeAction(
                `Explain: ${issueData.type}`,
                vscode.CodeActionKind.Empty
            );
            explainAction.diagnostics = [diagnostic];
            explainAction.command = {
                command: 'technicalDebtDetective.explainIssue',
                title: 'Explain Issue',
                arguments: []
            };
            actions.push(explainAction);
        }

        return actions;
    }
}

// This function is no longer needed since we're using command-based approach
export function registerApplyFixCommand(context: vscode.ExtensionContext, analyzer: CodeAnalyzerAgent) {
    // The command registration is handled in extension.ts
}