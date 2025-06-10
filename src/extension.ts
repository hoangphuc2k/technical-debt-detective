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
  chatProvider = new ChatViewProvider(context.extensionUri, codeAnalyzer);

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

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "technicalDebtDetective.chatView",
      chatProvider
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "technicalDebtDetective.analyzeFile",
      analyzeCurrentFile
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("technicalDebtDetective.showDashboard", () => {
      DashboardProvider.createOrShow(context.extensionUri, diagnosticManager);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "technicalDebtDetective.explainIssue",
      explainSelectedIssue
    )
  );

  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.text = "$(graph) Tech Debt";
  statusBarItem.command = "technicalDebtDetective.showDashboard";
  statusBarItem.tooltip = "Open Technical Debt Dashboard";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const debouncedAnalysis = debounce(performAnalysis, 1000);

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (isSupported(document)) {
        debouncedAnalysis(document);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
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

    if (!code.trim()) {
      return;
    }

    vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: "Analyzing code...",
      cancellable: false
    }, async () => {
      const result = await codeAnalyzer.analyzeCode(code, filePath);


      const diagnostics: vscode.Diagnostic[] = result.issues.map((issue) => {
        const line = Math.max(0, (issue.line || 1) - 1);
        const maxLine = document.lineCount - 1;
        const safeLine = Math.min(line, maxLine);
        
        const lineText = document.lineAt(safeLine).text;
        const range = new vscode.Range(
          safeLine,
          0,
          safeLine,
          lineText.length || Number.MAX_SAFE_INTEGER
        );

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

        (diagnostic as any).issueData = issue;

        return diagnostic;
      });

      diagnosticManager.updateDiagnostics(document.uri, diagnostics, result);

      const elapsed = Date.now() - startTime;
      Logger.info(`Analysis completed in ${elapsed}ms for ${filePath}`);

      DashboardProvider.updateData(result, document.fileName);
      
      const issueCount = result.issues.length;
      const healthEmoji = result.healthScore >= 8 ? "✅" : result.healthScore >= 6 ? "⚠️" : "🚨";
      vscode.window.setStatusBarMessage(
        `${healthEmoji} Health: ${result.healthScore}/10, Issues: ${issueCount}`,
        5000
      );
    });

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

  if (!isSupported(editor.document)) {
    vscode.window.showInformationMessage("File type not supported for analysis");
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
  
  vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Explaining issue...",
    cancellable: false
  }, async () => {
    const explanation = await codeAnalyzer.explainIssue(
      editor.document.getText(),
      issue
    );

    chatProvider.postMessage({
      type: "explanation",
      content: explanation,
      issue: issue,
    });
  });
}

export function deactivate() {
  diagnosticManager?.dispose();
}