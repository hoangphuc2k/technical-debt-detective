import * as vscode from 'vscode';
import { AnalysisResult } from '../agents/codeAnalyzerAgent.js';
import { DiagnosticManager } from '../diagnostics/diagnosticManager.js';

export class DashboardProvider {
    public static currentPanel: DashboardProvider | undefined;
    private static analysisData = new Map<string, AnalysisResult>();
    
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    
    public static createOrShow(
        extensionUri: vscode.Uri,
        diagnosticManager: DiagnosticManager
    ) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        
        if (DashboardProvider.currentPanel) {
            DashboardProvider.currentPanel._panel.reveal(column);
            DashboardProvider.currentPanel.update(diagnosticManager);
            return;
        }
        
        const panel = vscode.window.createWebviewPanel(
            'techDebtDashboard',
            'Technical Debt Dashboard',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media')
                ]
            }
        );
        
        DashboardProvider.currentPanel = new DashboardProvider(
            panel,
            extensionUri,
            diagnosticManager
        );
    }
    
    public static updateData(analysis: AnalysisResult, fileName: string) {
        this.analysisData.set(fileName, analysis);
        if (this.currentPanel) {
            this.currentPanel._panel.webview.postMessage({
                type: 'update',
                data: Array.from(this.analysisData.entries())
            });
        }
    }
    
    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        diagnosticManager: DiagnosticManager
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        
        this.update(diagnosticManager);
        
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        
        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'refresh':
                        this.update(diagnosticManager);
                        return;
                    case 'openFile':
                        try {
                            let filePath = message.file;
                            
                            // Check if it's already a URI string
                            if (filePath.startsWith('file:///')) {
                                // Parse the URI and get the file system path
                                const uri = vscode.Uri.parse(filePath);
                                const doc = await vscode.workspace.openTextDocument(uri);
                                await vscode.window.showTextDocument(doc);
                            } else {
                                // It's a regular file path
                                const uri = vscode.Uri.file(filePath);
                                const doc = await vscode.workspace.openTextDocument(uri);
                                await vscode.window.showTextDocument(doc);
                            }
                        } catch (error) {
                            console.error('Error opening file:', error);
                            console.error('File path was:', message.file);
                            vscode.window.showErrorMessage(`Unable to open file: ${message.file}`);
                        }
                        return;
                }
            },
            null,
            this._disposables
        );
    }
    
    private update(diagnosticManager: DiagnosticManager) {
        const webview = this._panel.webview;
        this._panel.webview.html = this._getHtmlForWebview(webview, diagnosticManager);
    }
    
    private _getHtmlForWebview(
        webview: vscode.Webview,
        diagnosticManager: DiagnosticManager
    ) {
        const analyses = diagnosticManager.getAllAnalyses();
        let totalIssues = 0;
        let totalDebt = 0;
        let avgHealth = 0;
        
        analyses.forEach(analysis => {
            totalIssues += analysis.issues.length;
            totalDebt += analysis.issues.reduce((sum: any, issue: { fixTime: any; }) => sum + issue.fixTime, 0);
            avgHealth += analysis.healthScore;
        });
        
        if (analyses.size > 0) {
            avgHealth = avgHealth / analyses.size;
        }
        
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'dashboard.js')
        );
        
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'dashboard.css')
        );
        
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${styleUri}" rel="stylesheet">
            <title>Technical Debt Dashboard</title>
        </head>
        <body>
            <div class="container">
                <h1>🔍 Technical Debt Dashboard</h1>
                
                <div class="summary-cards">
                    <div class="card">
                        <h3>Average Health Score</h3>
                        <div class="score">${avgHealth.toFixed(1)}/10</div>
                        <div class="trend">${this.getHealthTrend(avgHealth)}</div>
                    </div>
                    
                    <div class="card">
                        <h3>Total Technical Debt</h3>
                        <div class="debt-hours">${(totalDebt / 60).toFixed(1)} hours</div>
                        <div class="breakdown">${totalDebt} minutes total</div>
                    </div>
                    
                    <div class="card">
                        <h3>Total Issues</h3>
                        <div class="issue-count">${totalIssues}</div>
                        <div class="breakdown">
                            Across ${analyses.size} files
                        </div>
                    </div>
                </div>
                
                <div class="files-section">
                    <h2>File Analysis</h2>
                    <table class="files-table">
                        <thead>
                            <tr>
                                <th>File</th>
                                <th>Health Score</th>
                                <th>Issues</th>
                                <th>Technical Debt</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.generateFileRows(analyses)}
                        </tbody>
                    </table>
                </div>
                
                <div class="actions">
                    <button onclick="refresh()">🔄 Refresh</button>
                    <button onclick="analyzeAll()">📊 Analyze All Files</button>
                </div>
            </div>
            
            <script>
                const vscode = acquireVsCodeApi();
                
                function refresh() {
                    vscode.postMessage({ command: 'refresh' });
                }
                
                function openFile(file) {
                    // Send the raw file path to the extension
                    vscode.postMessage({ 
                        command: 'openFile',
                        file: file
                    });
                }
                
                function analyzeAll() {
                    vscode.postMessage({ command: 'analyzeAll' });
                }
                
                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.type === 'update') {
                        // Update dashboard with new data
                        location.reload();
                    }
                });
            </script>
        </body>
        </html>`;
    }
    
    private generateFileRows(analyses: Map<string, AnalysisResult>): string {
        let rows = '';
        
        analyses.forEach((analysis, filePath) => {
            const fileName = filePath.split(/[/\\]/).pop() || filePath;
            const debt = analysis.issues.reduce((sum, issue) => sum + issue.fixTime, 0);
            // Escape the file path for HTML attributes and JavaScript
            const escapedFile = filePath
                .replace(/\\/g, '\\\\')  // Escape backslashes
                .replace(/'/g, "\\'")    // Escape single quotes
                .replace(/"/g, '\\"');   // Escape double quotes
            
            rows += `
                <tr>
                    <td><a href="#" onclick="openFile('${escapedFile}'); return false;">${this.escapeHtml(fileName)}</a></td>
                    <td class="${this.getHealthClass(analysis.healthScore)}">${analysis.healthScore}/10</td>
                    <td>${analysis.issues.length}</td>
                    <td>${debt} min</td>
                    <td><button onclick="openFile('${escapedFile}'); return false;">View</button></td>
                </tr>
            `;
        });
        
        return rows || '<tr><td colspan="5">No files analyzed yet</td></tr>';
    }
    
    private escapeHtml(text: string): string {
        const map: { [key: string]: string } = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }
    
    private getHealthClass(score: number): string {
        if (score >= 8) {return 'health-good';}
        if (score >= 6) {return 'health-medium';}
        return 'health-poor';
    }
    
    private getHealthTrend(score: number): string {
        if (score >= 8) {return '✅ Good';}
        if (score >= 6) {return '⚠️ Needs Attention';}
        return '🚨 Poor';
    }
    
    public dispose() {
        DashboardProvider.currentPanel = undefined;
        this._panel.dispose();
        
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}