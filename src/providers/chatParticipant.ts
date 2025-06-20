import * as vscode from "vscode";
import {
  CodeAnalyzerAgent,
  CodeIssue,
  AnalysisResult,
} from "../agents/codeAnalyzerAgent.js";
import { DiagnosticManager } from "../diagnostics/diagnosticManager.js";

export class TechDebtChatParticipant {
  private static readonly ID = "technicalDebtDetective.chat";
  private participant: vscode.ChatParticipant | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    private analyzer: CodeAnalyzerAgent,
    private diagnosticManager: DiagnosticManager
  ) {}

  register() {
    // Create the chat participant
    this.participant = vscode.chat.createChatParticipant(
      TechDebtChatParticipant.ID,
      this.handler.bind(this)
    );

    // Set metadata
    this.participant.iconPath = vscode.Uri.joinPath(
      this.context.extensionUri,
      "media",
      "chatIcon.png"
    );

    this.participant.followupProvider = {
      provideFollowups: this.provideFollowups.bind(this),
    };

    this.context.subscriptions.push(this.participant);
  }

  private async handler(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    try {
      // Handle slash commands (if available)
      const command = (request as any).command;
      if (command) {
        await this.handleCommand(command, request, stream, token);
        return;
      }

      // Handle natural language requests
      const prompt = request.prompt.toLowerCase();

      if (
        prompt.includes("analyze") ||
        prompt.includes("check") ||
        prompt.includes("scan")
      ) {
        await this.handleAnalyzeRequest(request, stream, token);
      } else if (
        prompt.includes("explain") ||
        prompt.includes("what") ||
        prompt.includes("why")
      ) {
        await this.handleExplainRequest(request, stream, token);
      } else if (
        prompt.includes("fix") ||
        prompt.includes("solve") ||
        prompt.includes("resolve")
      ) {
        await this.handleFixRequest(request, stream, token);
      } else if (
        prompt.includes("dashboard") ||
        prompt.includes("report") ||
        prompt.includes("metrics")
      ) {
        await this.handleDashboardRequest(stream);
      } else if (prompt.includes("help") || prompt.includes("how")) {
        await this.handleHelpRequest(stream);
      } else {
        // General question about code quality
        await this.handleGeneralQuestion(request, stream, token);
      }
    } catch (error) {
      stream.markdown(
        `❌ **Error:** ${
          error instanceof Error ? error.message : "Unknown error occurred"
        }`
      );
    }
  }

  private async handleCommand(
    command: string,
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    switch (command) {
      case "analyze":
        await this.handleAnalyzeRequest(request, stream, token);
        break;
      case "explain":
        await this.handleExplainRequest(request, stream, token);
        break;
      case "fix":
        await this.handleFixRequest(request, stream, token);
        break;
      case "dashboard":
        await this.handleDashboardRequest(stream);
        break;
      case "help":
        await this.handleHelpRequest(stream);
        break;
      default:
        stream.markdown(`Unknown command: ${command}`);
    }
  }

  private async handleAnalyzeRequest(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    // Try to extract file references from the prompt
    const fileReferences = this.extractFileReferences(request.prompt);

    if (fileReferences.length > 0) {
      // Analyze referenced files
      for (const fileName of fileReferences) {
        const uri = await this.findFileUri(fileName);
        if (uri) {
          await this.analyzeFile(uri, stream, token);
        } else {
          stream.markdown(`⚠️ Could not find file: ${fileName}\n\n`);
        }
      }
    } else {
      // Analyze current file
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        stream.markdown(
          "📄 **No file open**\n\nPlease open a JavaScript or TypeScript file to analyze."
        );
        stream.markdown(
          "\n\n💡 **Tip:** You can also mention a file name in your message to analyze it."
        );
        return;
      }

      if (!this.isSupported(editor.document)) {
        stream.markdown(
          "⚠️ **File type not supported**\n\nTechnical Debt Detective supports JavaScript and TypeScript files."
        );
        return;
      }

      await this.analyzeFile(editor.document.uri, stream, token);
    }
  }

  private extractFileReferences(prompt: string): string[] {
    // Extract file names from prompt (e.g., "analyze utils.js" or "check #UserService.ts")
    const filePattern =
      /(?:analyze|check|scan|review)\s+([^\s]+\.[jt]sx?)|#([^\s]+\.[jt]sx?)|["']([^"']+\.[jt]sx?)["']/gi;
    const matches: string[] = [];
    let match;

    while ((match = filePattern.exec(prompt)) !== null) {
      const fileName = match[1] || match[2] || match[3];
      if (fileName) {
        matches.push(fileName);
      }
    }

    return matches;
  }

  private async findFileUri(fileName: string): Promise<vscode.Uri | undefined> {
    // Search for the file in the workspace
    const files = await vscode.workspace.findFiles(
      `**/${fileName}`,
      "**/node_modules/**",
      1
    );
    return files.length > 0 ? files[0] : undefined;
  }

  private async analyzeFile(
    uri: vscode.Uri,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const fileName = uri.fsPath.split(/[/\\]/).pop() || "Unknown file";

      // Show progress
      stream.progress(`Analyzing ${fileName}...`);

      const code = document.getText();
      const result = await this.analyzer.analyzeCode(code, document.fileName);

      // Stream the results
      stream.markdown(`## 📊 Analysis Results: ${fileName}\n\n`);
      stream.markdown(
        `### Health Score: ${this.getHealthEmoji(result.healthScore)} ${
          result.healthScore
        }/10\n\n`
      );

      // Summary statistics
      const totalDebt = result.issues.reduce(
        (sum, issue) => sum + issue.fixTime,
        0
      );
      const highPriority = result.issues.filter(
        (i) => i.severity === "high"
      ).length;
      const mediumPriority = result.issues.filter(
        (i) => i.severity === "medium"
      ).length;
      const lowPriority = result.issues.filter(
        (i) => i.severity === "low"
      ).length;

      stream.markdown(`**Summary:**\n`);
      stream.markdown(`- Total Issues: ${result.issues.length}\n`);
      stream.markdown(
        `- Technical Debt: ${totalDebt} minutes (${(totalDebt / 60).toFixed(
          1
        )} hours)\n`
      );
      stream.markdown(
        `- Priority: 🔴 ${highPriority} High, 🟡 ${mediumPriority} Medium, 🟢 ${lowPriority} Low\n\n`
      );

      // Detailed issues
      if (result.issues.length > 0) {
        stream.markdown(`### 🚨 Issues Found\n\n`);

        // Group by severity
        if (highPriority > 0) {
          stream.markdown(`#### 🔴 High Priority\n`);
          result.issues
            .filter((i) => i.severity === "high")
            .forEach((issue) => {
              stream.markdown(
                `- **Line ${issue.line}** - ${issue.type}: ${issue.description}\n`
              );
              stream.markdown(`  - ⏱️ Fix time: ${issue.fixTime} minutes\n`);
              if (issue.suggestion) {
                stream.markdown(`  - 💡 ${issue.suggestion}\n`);
              }
            });
          stream.markdown("\n");
        }

        if (mediumPriority > 0) {
          stream.markdown(`#### 🟡 Medium Priority\n`);
          result.issues
            .filter((i) => i.severity === "medium")
            .forEach((issue) => {
              stream.markdown(
                `- **Line ${issue.line}** - ${issue.type}: ${issue.description}\n`
              );
              stream.markdown(`  - ⏱️ Fix time: ${issue.fixTime} minutes\n`);
              if (issue.suggestion) {
                stream.markdown(`  - 💡 ${issue.suggestion}\n`);
              }
            });
          stream.markdown("\n");
        }

        if (lowPriority > 0) {
          stream.markdown(`#### 🟢 Low Priority\n`);
          result.issues
            .filter((i) => i.severity === "low")
            .forEach((issue) => {
              stream.markdown(
                `- **Line ${issue.line}** - ${issue.type}: ${issue.description}\n`
              );
              stream.markdown(`  - ⏱️ Fix time: ${issue.fixTime} minutes\n`);
              if (issue.suggestion) {
                stream.markdown(`  - 💡 ${issue.suggestion}\n`);
              }
            });
          stream.markdown("\n");
        }
      } else {
        stream.markdown(
          `✅ **No issues found!** Your code is looking great!\n\n`
        );
      }

      // Suggestions
      if (result.suggestions.length > 0) {
        stream.markdown(`### 💡 Improvement Suggestions\n\n`);
        result.suggestions.forEach((suggestion, i) => {
          stream.markdown(`${i + 1}. ${suggestion}\n`);
        });
        stream.markdown("\n");
      }

      // Metrics
      if (result.metrics) {
        stream.markdown(`### 📈 Code Metrics\n\n`);
        stream.markdown(`- Complexity Score: ${result.metrics.complexity}\n`);
        stream.markdown(`- Duplicate Blocks: ${result.metrics.duplicates}\n`);
        stream.markdown(`- Code Smells: ${result.metrics.codeSmells}\n\n`);
      }

      stream.button({
        command: "technicalDebtDetective.showDashboard",
        title: "📊 View Full Dashboard",
      });

      (stream as any).button({
        command: "workbench.action.problems.focus",
        title: "📋 View in Problems Panel",
      });

      // Store analysis for dashboard
      this.diagnosticManager.updateDiagnostics(uri, [], result);
    } catch (error) {
      stream.markdown(
        `❌ **Error analyzing file:** ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async handleExplainRequest(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      stream.markdown(
        "📄 **No file open**\n\nPlease open a file and position your cursor on an issue to explain."
      );
      return;
    }

    const selection = editor.selection;
    const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);

    // Find diagnostic at cursor position
    const diagnostic = diagnostics.find((d) =>
      d.range.contains(selection.start)
    );

    if (!diagnostic || !(diagnostic as any).issueData) {
      // Try to find the nearest issue
      const line = selection.start.line;
      const nearbyDiagnostic = diagnostics.find(
        (d) => Math.abs(d.range.start.line - line) <= 2
      );

      if (!nearbyDiagnostic || !(nearbyDiagnostic as any).issueData) {
        stream.markdown("❓ **No issue found at cursor position**\n\n");
        stream.markdown("Try:\n");
        stream.markdown("1. Position your cursor on a highlighted issue\n");
        stream.markdown("2. Run `analyze` first to detect issues\n");
        stream.markdown("3. Click on an issue in the Problems panel\n");
        return;
      }

      const issue = (nearbyDiagnostic as any).issueData;
      await this.explainIssue(issue, editor.document, stream);
    } else {
      const issue = (diagnostic as any).issueData;
      await this.explainIssue(issue, editor.document, stream);
    }
  }

  private async explainIssue(
    issue: CodeIssue,
    document: vscode.TextDocument,
    stream: vscode.ChatResponseStream
  ): Promise<void> {
    stream.markdown(`## 🔍 Explaining: ${issue.type}\n\n`);
    stream.markdown(`**Location:** Line ${issue.line}\n`);
    stream.markdown(
      `**Severity:** ${this.getSeverityEmoji(issue.severity)} ${
        issue.severity
      }\n`
    );
    stream.markdown(`**Description:** ${issue.description}\n\n`);

    stream.progress("Generating detailed explanation...");

    const explanation = await this.analyzer.explainIssue(
      document.getText(),
      issue
    );
    stream.markdown(explanation);

    // Add quick fix button if available
    if (issue.suggestion) {
      stream.markdown(`\n### 🔧 Quick Fix Available\n`);
      stream.markdown(`${issue.suggestion}\n\n`);

      stream.button({
        command: "editor.action.quickFix",
        title: "⚡ Apply Quick Fix",
      });
    }
  }

  private async handleFixRequest(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      stream.markdown(
        "📄 **No file open**\n\nPlease open a file to get fix suggestions."
      );
      return;
    }

    const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
    const issuesWithFixes = diagnostics.filter((d) => (d as any).issueData);

    if (issuesWithFixes.length === 0) {
      stream.markdown("✅ **No issues to fix**\n\n");
      stream.markdown("Run `analyze` first to detect issues in your code.");
      return;
    }

    stream.markdown(`## 🔧 Fix Suggestions\n\n`);
    stream.markdown(
      `Found ${issuesWithFixes.length} issues that can be fixed:\n\n`
    );

    // Group fixes by severity
    const highPriorityFixes = issuesWithFixes.filter(
      (d) => (d as any).issueData.severity === "high"
    );
    const mediumPriorityFixes = issuesWithFixes.filter(
      (d) => (d as any).issueData.severity === "medium"
    );
    const lowPriorityFixes = issuesWithFixes.filter(
      (d) => (d as any).issueData.severity === "low"
    );

    let fixIndex = 1;

    if (highPriorityFixes.length > 0) {
      stream.markdown(`### 🔴 High Priority Fixes\n`);
      for (const diagnostic of highPriorityFixes) {
        const issue = (diagnostic as any).issueData;
        stream.markdown(
          `**${fixIndex}.** Line ${issue.line} - ${issue.type}\n`
        );
        stream.markdown(`   - ${issue.description}\n`);
        if (issue.suggestion) {
          stream.markdown(`   - 💡 ${issue.suggestion}\n`);
        }
        stream.markdown("\n");
        fixIndex++;
      }
    }

    if (mediumPriorityFixes.length > 0) {
      stream.markdown(`### 🟡 Medium Priority Fixes\n`);
      for (const diagnostic of mediumPriorityFixes) {
        const issue = (diagnostic as any).issueData;
        stream.markdown(
          `**${fixIndex}.** Line ${issue.line} - ${issue.type}\n`
        );
        stream.markdown(`   - ${issue.description}\n`);
        if (issue.suggestion) {
          stream.markdown(`   - 💡 ${issue.suggestion}\n`);
        }
        stream.markdown("\n");
        fixIndex++;
      }
    }

    if (lowPriorityFixes.length > 0) {
      stream.markdown(`### 🟢 Low Priority Fixes\n`);
      for (const diagnostic of lowPriorityFixes) {
        const issue = (diagnostic as any).issueData;
        stream.markdown(
          `**${fixIndex}.** Line ${issue.line} - ${issue.type}\n`
        );
        stream.markdown(`   - ${issue.description}\n`);
        if (issue.suggestion) {
          stream.markdown(`   - 💡 ${issue.suggestion}\n`);
        }
        stream.markdown("\n");
        fixIndex++;
      }
    }

    stream.markdown(`### 📝 How to Apply Fixes\n\n`);
    stream.markdown(
      `1. **Quick Fix:** Place cursor on issue → Press \`Ctrl+.\` (or \`Cmd+.\` on Mac)\n`
    );
    stream.markdown(`2. **Manual Fix:** Follow the suggestions above\n`);
    stream.markdown(`3. **Bulk Fix:** Use "Fix All" in the Problems panel\n\n`);

    stream.button({
      command: "workbench.action.problems.focus",
      title: "📋 Open Problems Panel",
    });
  }

  private async handleDashboardRequest(
    stream: vscode.ChatResponseStream
  ): Promise<void> {
    stream.markdown(`## 📊 Technical Debt Dashboard\n\n`);

    const analyses = this.diagnosticManager.getAllAnalyses();

    if (analyses.size === 0) {
      stream.markdown(
        "No files analyzed yet. Run `analyze` on your files first.\n\n"
      );
      stream.button({
        command: "technicalDebtDetective.analyzeFile",
        title: "🔍 Analyze Current File",
      });
      return;
    }

    // Calculate overall metrics
    let totalIssues = 0;
    let totalDebt = 0;
    let totalHealth = 0;
    const fileStats: Array<{
      name: string;
      health: number;
      issues: number;
      debt: number;
    }> = [];

    analyses.forEach((analysis, filePath) => {
      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      const debt = analysis.issues.reduce(
        (sum, issue) => sum + issue.fixTime,
        0
      );

      totalIssues += analysis.issues.length;
      totalDebt += debt;
      totalHealth += analysis.healthScore;

      fileStats.push({
        name: fileName,
        health: analysis.healthScore,
        issues: analysis.issues.length,
        debt: debt,
      });
    });

    const avgHealth = totalHealth / analyses.size;

    stream.markdown(`### 📈 Overall Statistics\n\n`);
    stream.markdown(`- **Files Analyzed:** ${analyses.size}\n`);
    stream.markdown(
      `- **Average Health:** ${this.getHealthEmoji(
        avgHealth
      )} ${avgHealth.toFixed(1)}/10\n`
    );
    stream.markdown(`- **Total Issues:** ${totalIssues}\n`);
    stream.markdown(
      `- **Total Technical Debt:** ${totalDebt} minutes (${(
        totalDebt / 60
      ).toFixed(1)} hours)\n\n`
    );

    stream.markdown(`### 📁 File Breakdown\n\n`);

    // Sort by health score (worst first)
    fileStats.sort((a, b) => a.health - b.health);

    fileStats.forEach((file) => {
      stream.markdown(`**${file.name}**\n`);
      stream.markdown(
        `- Health: ${this.getHealthEmoji(file.health)} ${file.health}/10\n`
      );
      stream.markdown(`- Issues: ${file.issues}\n`);
      stream.markdown(`- Debt: ${file.debt} minutes\n\n`);
    });

    stream.button({
      command: "technicalDebtDetective.showDashboard",
      title: "📊 Open Full Dashboard",
    });
  }

  private async handleHelpRequest(
    stream: vscode.ChatResponseStream
  ): Promise<void> {
    stream.markdown(`## 🤖 Technical Debt Detective - Help\n\n`);

    stream.markdown(
      `I'm your AI-powered code quality assistant. I can help you:\n\n`
    );

    stream.markdown(`### 🔍 Available Commands\n\n`);
    stream.markdown(
      `- \`analyze\` - Analyze current file or mentioned files for technical debt\n`
    );
    stream.markdown(
      `- \`explain\` - Get detailed explanation of an issue at cursor position\n`
    );
    stream.markdown(`- \`fix\` - Get fix suggestions for detected issues\n`);
    stream.markdown(`- \`dashboard\` - View overall technical debt metrics\n`);
    stream.markdown(`- \`help\` - Show this help message\n\n`);

    stream.markdown(`### 💬 Natural Language\n\n`);
    stream.markdown(`You can also ask me questions naturally:\n`);
    stream.markdown(`- "What's wrong with my code?"\n`);
    stream.markdown(`- "How can I improve code quality?"\n`);
    stream.markdown(`- "Explain this error"\n`);
    stream.markdown(`- "Show me the technical debt"\n`);
    stream.markdown(`- "Analyze utils.js"\n\n`);

    stream.markdown(`### 📄 File References\n\n`);
    stream.markdown(`You can mention files in your message:\n`);
    stream.markdown(`- "analyze UserService.js"\n`);
    stream.markdown(`- "check utils.ts for issues"\n`);
    stream.markdown(`- "what's wrong with #auth.js"\n\n`);

    stream.markdown(`### 🎯 Quick Actions\n\n`);
    stream.markdown(`- **Quick Fix:** \`Ctrl+.\` on any issue\n`);
    stream.markdown(`- **Problems Panel:** \`Ctrl+Shift+M\`\n`);
    stream.markdown(`- **Command Palette:** \`Ctrl+Shift+P\`\n\n`);

    stream.markdown(`### 📊 Supported Languages\n\n`);
    stream.markdown(`- JavaScript (.js, .jsx)\n`);
    stream.markdown(`- TypeScript (.ts, .tsx)\n\n`);

    stream.button({
      command: "technicalDebtDetective.analyzeFile",
      title: "🔍 Try Analyzing Current File",
    });
  }

  private async handleGeneralQuestion(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor || !this.isSupported(editor.document)) {
      // General coding advice without context
      stream.markdown(`## 💡 Code Quality Advice\n\n`);
      stream.markdown(`I can provide more specific help if you:\n\n`);
      stream.markdown(`1. Open a JavaScript or TypeScript file\n`);
      stream.markdown(`2. Run \`analyze\` to detect issues\n`);
      stream.markdown(`3. Ask about specific code patterns\n\n`);

      // Provide general advice based on the question
      if (request.prompt.toLowerCase().includes("quality")) {
        stream.markdown(`### General Code Quality Tips:\n\n`);
        stream.markdown(
          `- **Keep functions small** - Each function should do one thing well\n`
        );
        stream.markdown(
          `- **Use meaningful names** - Variables and functions should be self-documenting\n`
        );
        stream.markdown(
          `- **Avoid deep nesting** - Consider early returns or extracting functions\n`
        );
        stream.markdown(
          `- **Remove dead code** - Delete commented out code and unused variables\n`
        );
        stream.markdown(
          `- **Follow consistent style** - Use a linter and formatter\n`
        );
      }

      return;
    }

    // Answer in context of current file
    stream.progress("Analyzing context and generating response...");

    const code = editor.document.getText();
    const analysis = this.diagnosticManager.getAnalysis(editor.document.uri);

    // Create context-aware response
    const contextInfo = analysis
      ? `The current file has a health score of ${analysis.healthScore}/10 with ${analysis.issues.length} issues.`
      : "The current file hasn't been analyzed yet.";

    stream.markdown(`## 💬 ${request.prompt}\n\n`);
    stream.markdown(
      `*Context: ${editor.document.fileName
        .split(/[/\\]/)
        .pop()} - ${contextInfo}*\n\n`
    );

    // Use AI to answer the specific question
    const response = await this.analyzer.explainIssue(code, {
      type: "general-question",
      severity: "low",
      line: editor.selection.start.line + 1,
      description: request.prompt,
      fixTime: 0,
    });

    stream.markdown(response);

    // Suggest relevant actions
    if (!analysis) {
      stream.markdown(
        `\n\n💡 **Tip:** Run \`analyze\` to get specific insights about this file.\n`
      );
      stream.button({
        command: "technicalDebtDetective.analyzeFile",
        title: "🔍 Analyze This File",
      });
    }
  }

  private provideFollowups(
    result: any,
    context: vscode.ChatContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<any[]> {
    const followups: any[] = [];

    // Context-aware follow-ups
    const lastResponse = result?.metadata?.responseType;

    if (lastResponse === "analysis") {
      followups.push(
        {
          prompt: "How can I fix the most critical issues?",
          label: "🔧 Get fixes",
          command: "fix",
        },
        {
          prompt: "Explain the most severe issue",
          label: "🔍 Explain top issue",
        }
      );
    } else if (lastResponse === "explanation") {
      followups.push(
        {
          prompt: "How do I fix this?",
          label: "🔧 Get fix",
        },
        {
          prompt: "Show me an example of good code",
          label: "📝 Show example",
        }
      );
    }

    // Always available follow-ups
    followups.push(
      {
        prompt: "Analyze current file",
        label: "📊 Full analysis",
        command: "analyze",
      },
      {
        prompt: "What are the best practices for this code?",
        label: "💡 Best practices",
      },
      {
        prompt: "Show technical debt dashboard",
        label: "📈 View dashboard",
        command: "dashboard",
      }
    );

    return followups;
  }

  private isSupported(document: vscode.TextDocument): boolean {
    return [
      "javascript",
      "typescript",
      "javascriptreact",
      "typescriptreact",
    ].includes(document.languageId);
  }

  private getHealthEmoji(score: number): string {
    if (score >= 8) {
      return "✅";
    }
    if (score >= 6) {
      return "⚠️";
    }
    return "🚨";
  }

  private getSeverityEmoji(severity: string): string {
    switch (severity) {
      case "high":
        return "🔴";
      case "medium":
        return "🟡";
      case "low":
        return "🟢";
      default:
        return "⚪";
    }
  }
}
