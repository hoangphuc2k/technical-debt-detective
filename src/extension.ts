import * as vscode from "vscode";
import { CodeAnalyzerAgent } from "./agents/codeAnalyzerAgent.js";
import { DashboardProvider } from "./dashboard/dashboardProvider.js";
import { DiagnosticManager } from "./diagnostics/diagnosticManager.js";
import { ChatViewProvider } from "./providers/chatViewProvider.js";
import { CodeActionProvider } from "./providers/codeActionProvider.js";
import { HoverProvider } from "./providers/hoverProvider.js";
import { Logger } from "./utils/logger.js";
import { debounce } from "./utils/debounce.js";

let codeAnalyzer: CodeAnalyzerAgent;
let diagnosticManager: DiagnosticManager;
let chatProvider: ChatViewProvider;

export async function activate(context: vscode.ExtensionContext) {
  Logger.info("Technical Debt Detective activating...");
  const config = vscode.workspace.getConfiguration("techDebtDetective");

  if (!config.get("geminiApiKey")) {
    const apiKey = await vscode.window.showInputBox({
      prompt: "Enter your Google Gemini API key",
      password: true,
      ignoreFocusOut: true,
    });

    if (apiKey) {
      await config.update(
        "geminiApiKey",
        apiKey,
        vscode.ConfigurationTarget.Global
      );
    } else {
      vscode.window.showErrorMessage("Gemini API key is required");
      return;
    }
  }

  codeAnalyzer = new CodeAnalyzerAgent(config);
  diagnosticManager = new DiagnosticManager();

  const codeActionProvider = new CodeActionProvider(codeAnalyzer);
  const hoverProvider = new HoverProvider(codeAnalyzer, diagnosticManager);

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      ["javascript", "typescript", "javascriptreact", "typescriptreact"],
      codeActionProvider
    )
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      ["javascript", "typescript", "javascriptreact", "typescriptreact"],
      hoverProvider
    )
  );

  chatProvider = new ChatViewProvider(context.extensionUri, codeAnalyzer);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "techDebtDetective.chatView",
      chatProvider
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "techDebtDetective.analyzeFile",
      analyzeCurrentFile
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("techDebtDetective.showDashboard", () => {
      DashboardProvider.createOrShow(context.extensionUri, diagnosticManager);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "techDebtDetective.explainIssue",
      explainSelectedIssue
    )
  );

  const debouncedAnalysis = debounce(performAnalysis, 1000);

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (isSupported(document)) {
        debouncedAnalysis(document);
      }
    })
  );

  vscode.workspace.textDocuments.forEach((doc) => {
    if (isSupported(doc)) {
      performAnalysis(doc);
    }
  });

  Logger.info("Technical Debt Detective activated");
}

function isSupported(document: vscode.TextDocument): boolean {
  return [
    "javascript",
    "typescript",
    "javascriptreact",
    "typescriptreact",
  ].includes(document.languageId);
}

async function performAnalysis(document: vscode.TextDocument) {
  try {
    const startTime = Date.now();
    const code = document.getText();
    const filePath = document.fileName;

    const result = await codeAnalyzer.analyzeCode(code, filePath);

    // Convert to diagnostics
    const diagnostics: vscode.Diagnostic[] = result.issues.map((issue) => {
      const line = Math.max(0, issue.line - 1);
      const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);

      const diagnostic = new vscode.Diagnostic(
        range,
        `${issue.description} (Est. ${issue.fixTime} min to fix)`,
        issue.severity === "high"
          ? vscode.DiagnosticSeverity.Error
          : issue.severity === "medium"
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information
      );

      diagnostic.source = "Technical Debt Detective";
      diagnostic.code = issue.type;

      // Store issue data for hover and code actions
      (diagnostic as any).issueData = issue;

      return diagnostic;
    });

    diagnosticManager.updateDiagnostics(document.uri, diagnostics, result);

    const elapsed = Date.now() - startTime;
    Logger.info(`Analysis completed in ${elapsed}ms`);

    DashboardProvider.updateData(result, document.fileName);
  } catch (error) {
    Logger.error("Analysis failed:", error as Error);
    vscode.window.showErrorMessage(
      `Analysis failed: ${(error as Error).message}`
    );
  }
}

async function analyzeCurrentFile() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage("No active editor");
    return;
  }

  await performAnalysis(editor.document);
  vscode.window.showInformationMessage("Analysis complete!");
}

async function explainSelectedIssue() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const selection = editor.selection;
  const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);

  const diagnostic = diagnostics.find((d) => d.range.contains(selection.start));
  if (!diagnostic || !(diagnostic as any).issueData) {
    vscode.window.showInformationMessage("No issue found at cursor position");
    return;
  }

  const issue = (diagnostic as any).issueData;
  const explanation = await codeAnalyzer.explainIssue(
    editor.document.getText(),
    issue
  );

  chatProvider.postMessage({
    type: "explanation",
    content: explanation,
    issue: issue,
  });
}

export function deactivate() {
  diagnosticManager?.dispose();
}
