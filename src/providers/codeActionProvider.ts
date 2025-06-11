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
            if (!issueData) {continue;}

            // Quick Fix action - now directly applies the fix instead of using a command
            const fixAction = new vscode.CodeAction(
                `Fix: ${issueData.type}`,
                vscode.CodeActionKind.QuickFix
            );
            fixAction.diagnostics = [diagnostic];
            
            // Create the edit directly in the code action
            fixAction.edit = await this.createFixEdit(document, diagnostic, issueData);
            
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

    private async createFixEdit(
        document: vscode.TextDocument, 
        diagnostic: vscode.Diagnostic, 
        issueData: CodeIssue
    ): Promise<vscode.WorkspaceEdit> {
        const edit = new vscode.WorkspaceEdit();
        
        try {
            // Get the fix from the analyzer
            const fix = await this.analyzer.generateFix(document.getText(), issueData);
            
            // Parse the fix to determine how to apply it
            const fixLines = fix.split('\n');
            
            // Get the affected line range
            const startLine = Math.max(0, (issueData.line || 1) - 1);
            const endLine = startLine;
            
            // Get the original line
            const originalLine = document.lineAt(startLine);
            
            // Apply specific fixes based on issue type
            if (issueData.type === 'no-var') {
                // Replace var with let or const
                const lineText = originalLine.text;
                const newLineText = lineText.replace(/\bvar\b/, 'let');
                const fullRange = new vscode.Range(startLine, 0, startLine, lineText.length);
                edit.replace(document.uri, fullRange, newLineText);
            } else if (issueData.type === 'no-console') {
                // Remove or comment out console.log
                const lineText = originalLine.text;
                const newLineText = '// ' + lineText.trim();
                const fullRange = new vscode.Range(startLine, 0, startLine, lineText.length);
                edit.replace(document.uri, fullRange, newLineText);
            } else if (issueData.type === 'eqeqeq') {
                // Replace == with === or != with !==
                const lineText = originalLine.text;
                let newLineText = lineText;
                if (lineText.includes('!=') && !lineText.includes('!==')) {
                    newLineText = lineText.replace(/!=/g, '!==');
                } else if (lineText.includes('==') && !lineText.includes('===')) {
                    newLineText = lineText.replace(/==/g, '===');
                }
                const fullRange = new vscode.Range(startLine, 0, startLine, lineText.length);
                edit.replace(document.uri, fullRange, newLineText);
            } else if (issueData.type === 'semi') {
                // Add missing semicolon
                const lineText = originalLine.text;
                const newLineText = lineText.trimRight() + ';';
                const fullRange = new vscode.Range(startLine, 0, startLine, lineText.length);
                edit.replace(document.uri, fullRange, newLineText);
            } else if (fix && fix.trim() !== '') {
                // For other types, try to apply the AI-generated fix
                // Look for the specific line mentioned in the issue
                const lineToReplace = document.lineAt(startLine);
                const range = new vscode.Range(
                    startLine, 
                    0, 
                    startLine, 
                    lineToReplace.text.length
                );
                
                // If the fix is multi-line, replace the whole section
                if (fixLines.length > 1) {
                    edit.replace(document.uri, range, fix);
                } else {
                    // Single line fix
                    edit.replace(document.uri, range, fix.trim());
                }
            }
        } catch (error) {
            console.error('Error creating fix edit:', error);
            // If we can't generate a proper fix, at least add a comment
            const line = Math.max(0, (issueData.line || 1) - 1);
            const position = new vscode.Position(line, 0);
            edit.insert(document.uri, position, `// TODO: Fix ${issueData.type}: ${issueData.description}\n`);
        }
        
        return edit;
    }
}

// Register the apply fix command - simplified version
export function registerApplyFixCommand(context: vscode.ExtensionContext, analyzer: CodeAnalyzerAgent) {
    // This is now optional since we're using WorkspaceEdit directly in the code action
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'technicalDebtDetective.applyFix',
            async (document: vscode.TextDocument, diagnostic: vscode.Diagnostic, issueData: any) => {
                vscode.window.showInformationMessage('Please use the Quick Fix menu (Ctrl+.) to apply fixes.');
            }
        )
    );
}