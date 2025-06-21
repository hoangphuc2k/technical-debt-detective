import * as vscode from "vscode";
import { CodeAnalyzerAgent } from "./agents/codeAnalyzerAgent.js";
import { DashboardProvider } from "./dashboard/dashboardProvider.js";
import { DiagnosticManager } from "./diagnostics/diagnosticManager.js";
import { ChatViewProvider } from "./providers/chatViewProvider.js";
import { CodeActionProvider, registerApplyFixCommand } from "./providers/codeActionProvider.js";
import { HoverProvider } from "./providers/hoverProvider.js";
import { Logger } from "./utils/logger.js";
import { debounce } from "./utils/debounce.js";
import { TechDebtChatParticipant } from "./providers/chatParticipant.js";

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

  // Register code action provider
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      ["javascript", "typescript", "javascriptreact", "typescriptreact"],
      codeActionProvider
    )
  );

  // Register hover provider
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      ["javascript", "typescript", "javascriptreact", "typescriptreact"],
      hoverProvider
    )
  );

  const chatParticipant = new TechDebtChatParticipant(context, codeAnalyzer, diagnosticManager);
  chatParticipant.register();

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "technicalDebtDetective.analyzeFile",
      analyzeCurrentFile
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "technicalDebtDetective.analyzeSpecificFile",
      async (document: vscode.TextDocument) => {
        if (document && isSupported(document)) {
          await performAnalysis(document);
        }
      }
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

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "techDebtDetective.applyFix",
      async (
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic,
        issueData: any
      ) => {
        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "Generating fix...",
              cancellable: false,
            },
            async () => {
              // Get the full fixed code from AI
              const fixedCode = await codeAnalyzer.generateFix(
                document.getText(),
                issueData
              );

              if (
                !fixedCode ||
                fixedCode.trim() === "" ||
                fixedCode === document.getText()
              ) {
                vscode.window.showErrorMessage("Unable to generate fix");
                return;
              }

              // Replace entire document content
              const edit = new vscode.WorkspaceEdit();
              const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(document.getText().length)
              );

              edit.replace(document.uri, fullRange, fixedCode);

              const success = await vscode.workspace.applyEdit(edit);

              if (success) {
                vscode.window.showInformationMessage("Fix applied successfully!");

                // Re-analyze after a short delay
                setTimeout(() => performAnalysis(document), 1000);
              } else {
                vscode.window.showErrorMessage("Failed to apply fix");
              }
            }
          );
        } catch (error) {
          console.error("Error applying fix:", error);
          vscode.window.showErrorMessage(`Failed to apply fix: ${error}`);
        }
      }
    )
  );

  // Status bar item
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

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: "Analyzing code...",
      cancellable: false
    }, async () => {
      const result = await codeAnalyzer.analyzeCode(code, filePath);

      const diagnostics: vscode.Diagnostic[] = [];
      
      // Process each issue and find its actual location in the code
      for (const issue of result.issues) {
        const diagnostic = await createDiagnosticForIssue(document, issue, code);
        if (diagnostic) {
          diagnostics.push(diagnostic);
        }
      }

      diagnosticManager.updateDiagnostics(document.uri, diagnostics, result);

      const elapsed = Date.now() - startTime;
      Logger.info(`Analysis completed in ${elapsed}ms for ${filePath}`);

      DashboardProvider.updateData(result, document.uri.fsPath);
      
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

async function createDiagnosticForIssue(
  document: vscode.TextDocument,
  issue: any,
  code: string
): Promise<vscode.Diagnostic | null> {
  try {
    let range: vscode.Range;
    
    // Try to find the exact location based on issue type and description
    if (issue.type === 'no-var' || issue.type === 'no-console' || issue.type === 'eqeqeq') {
      // Search for the pattern in the code
      const searchPattern = getSearchPatternForIssue(issue);
      const lineIndex = findLineWithPattern(document, searchPattern, issue.line);
      
      if (lineIndex >= 0) {
        const line = document.lineAt(lineIndex);
        const matchIndex = line.text.indexOf(searchPattern);
        
        if (matchIndex >= 0) {
          // Create a range that highlights just the problematic part
          range = new vscode.Range(
            lineIndex,
            matchIndex,
            lineIndex,
            matchIndex + searchPattern.length
          );
        } else {
          // Fallback to full line
          range = line.range;
        }
      } else {
        // Use the line number from AI if we can't find the pattern
        const line = Math.max(0, (issue.line || 1) - 1);
        const maxLine = document.lineCount - 1;
        const safeLine = Math.min(line, maxLine);
        range = document.lineAt(safeLine).range;
      }
    } else {
      // For other issue types, use the line number provided
      const line = Math.max(0, (issue.line || 1) - 1);
      const maxLine = document.lineCount - 1;
      const safeLine = Math.min(line, maxLine);
      range = document.lineAt(safeLine).range;
    }

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
  } catch (error) {
    console.error("Error creating diagnostic:", error);
    return null;
  }
}

function getSearchPatternForIssue(issue: any): string {
  switch (issue.type) {
    case 'no-var':
      return 'var ';
    case 'no-console':
      return 'console.log';
    case 'eqeqeq':
      if (issue.description.includes('!==')) {
        return '!=';
      }
      return '==';
    case 'semi':
      return ';'; // This is tricky, might need different approach
    default:
      return '';
  }
}

function findLineWithPattern(
  document: vscode.TextDocument,
  pattern: string,
  suggestedLine?: number
): number {
  if (!pattern) {
    return suggestedLine ? suggestedLine - 1 : -1;
  }

  // First, try around the suggested line
  if (suggestedLine) {
    const searchStart = Math.max(0, suggestedLine - 3);
    const searchEnd = Math.min(document.lineCount, suggestedLine + 2);
    
    for (let i = searchStart; i < searchEnd; i++) {
      if (document.lineAt(i).text.includes(pattern)) {
        return i;
      }
    }
  }

  // If not found around suggested line, search entire document
  for (let i = 0; i < document.lineCount; i++) {
    if (document.lineAt(i).text.includes(pattern)) {
      return i;
    }
  }

  return -1;
}

async function analyzeCurrentFile(filePath?: string) {
  let document: vscode.TextDocument;
  
  if (filePath) {
    // If a file path is provided, open that document
    try {
      const uri = vscode.Uri.file(filePath);
      document = await vscode.workspace.openTextDocument(uri);
    } catch (error) {
      vscode.window.showErrorMessage(`Unable to open file: ${filePath}`);
      return;
    }
  } else {
    // Otherwise, use the active editor
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage("No active editor");
      return;
    }
    document = editor.document;
  }

  if (!isSupported(document)) {
    vscode.window.showInformationMessage("File type not supported for analysis");
    return;
  }

  await performAnalysis(document);
  
  if (!filePath) {
    // Only show this message when manually triggered
    vscode.window.showInformationMessage("Analysis complete!");
  }
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
  
  await vscode.window.withProgress({
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