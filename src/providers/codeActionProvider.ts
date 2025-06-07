import * as vscode from 'vscode';
import { CodeAnalyzerAgent } from '../agents/codeAnalyzerAgent.js';

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
            if (!issueData) {continue;}

            // Quick Fix action
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
                command: 'techDebtDetective.explainIssue',
                title: 'Explain Issue'
            };
            actions.push(explainAction);
        }

        return actions;
    }
}

// Register the apply fix command
export function registerApplyFixCommand(context: vscode.ExtensionContext, analyzer: CodeAnalyzerAgent) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'techDebtDetective.applyFix',
            async (document: vscode.TextDocument, diagnostic: vscode.Diagnostic, issueData: any) => {
                try {
                    const fix = await analyzer.generateFix(document.getText(), issueData);
                    
                    // Apply the fix
                    const edit = new vscode.WorkspaceEdit();
                    
                    // Simple replacement - in real implementation, parse the fix better
                    const line = diagnostic.range.start.line;
                    const lineText = document.lineAt(line).text;
                    const fullRange = new vscode.Range(line, 0, line, lineText.length);
                    
                    edit.replace(document.uri, fullRange, fix);
                    
                    await vscode.workspace.applyEdit(edit);
                    vscode.window.showInformationMessage('Fix applied successfully!');
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to apply fix: ${error}`);
                }
            }
        )
    );
}