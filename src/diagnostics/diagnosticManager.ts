import * as vscode from 'vscode';
import { AnalysisResult } from '../agents/codeAnalyzerAgent.js';

export class DiagnosticManager {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private analysisCache = new Map<string, AnalysisResult>();
    
    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection(
            'technicalDebtDetective'
        );
    }
    
    updateDiagnostics(
        uri: vscode.Uri, 
        diagnostics: vscode.Diagnostic[],
        analysis: AnalysisResult
    ) {
        this.diagnosticCollection.set(uri, diagnostics);
        // Store using the file system path, not the URI string
        this.analysisCache.set(uri.fsPath, analysis);
    }
    
    getAnalysis(uri: vscode.Uri): AnalysisResult | undefined {
        return this.analysisCache.get(uri.fsPath);
    }
    
    clearDiagnostics(uri: vscode.Uri) {
        this.diagnosticCollection.delete(uri);
        this.analysisCache.delete(uri.fsPath);
    }
    
    getAllAnalyses(): Map<string, AnalysisResult> {
        return this.analysisCache;
    }
    
    dispose() {
        this.diagnosticCollection.dispose();
        this.analysisCache.clear();
    }
}