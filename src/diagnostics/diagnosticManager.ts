import * as vscode from 'vscode';
import { AnalysisResult } from '../agents/codeAnalyzerAgent.js';

export class DiagnosticManager {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private analysisCache = new Map<string, AnalysisResult>();
    
    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection(
            'techDebtDetective'
        );
    }
    
    updateDiagnostics(
        uri: vscode.Uri, 
        diagnostics: vscode.Diagnostic[],
        analysis: AnalysisResult
    ) {
        this.diagnosticCollection.set(uri, diagnostics);
        this.analysisCache.set(uri.toString(), analysis);
    }
    
    getAnalysis(uri: vscode.Uri): AnalysisResult | undefined {
        return this.analysisCache.get(uri.toString());
    }
    
    clearDiagnostics(uri: vscode.Uri) {
        this.diagnosticCollection.delete(uri);
        this.analysisCache.delete(uri.toString());
    }
    
    getAllAnalyses(): Map<string, AnalysisResult> {
        return this.analysisCache;
    }
    
    dispose() {
        this.diagnosticCollection.dispose();
        this.analysisCache.clear();
    }
}