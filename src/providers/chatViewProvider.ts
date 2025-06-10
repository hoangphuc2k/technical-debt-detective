import * as vscode from "vscode";
import { CodeAnalyzerAgent } from "../agents/codeAnalyzerAgent.js";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "technicalDebtDetective.chatView";

  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private analyzer: CodeAnalyzerAgent
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "askQuestion":
          await this.handleQuestion(data.question);
          break;
        case "explainCode":
          await this.handleCodeExplanation(data.code);
          break;
      }
    });
  }

  private async handleQuestion(question: string) {
    try {
      // Show thinking message
      this.postMessage({
        type: "thinking",
        content: "Analyzing your question...",
      });

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        this.postMessage({
          type: "response",
          content:
            "Please open a JavaScript or TypeScript file to analyze, or ask a general coding question.",
        });
        return;
      }

      const code = editor.document.getText();

      // Determine response based on question type
      if (
        question.toLowerCase().includes("analyze") ||
        question.toLowerCase().includes("issues")
      ) {
        const result = await this.analyzer.analyzeCode(
          code,
          editor.document.fileName
        );
        let response = `**Code Analysis Results:**\n\n`;
        response += `**Health Score:** ${result.healthScore}/10\n`;
        response += `**Issues Found:** ${result.issues.length}\n\n`;

        if (result.issues.length > 0) {
          response += `**Top Issues:**\n`;
          result.issues.slice(0, 3).forEach((issue, i) => {
            response += `${i + 1}. ${issue.description} (Line ${issue.line})\n`;
          });
        }

        if (result.suggestions.length > 0) {
          response += `\n**Suggestions:**\n`;
          result.suggestions.slice(0, 3).forEach((suggestion, i) => {
            response += `${i + 1}. ${suggestion}\n`;
          });
        }

        this.postMessage({
          type: "response",
          content: response,
        });
      } else {
        // General question - use explanation capability
        const explanation = await this.analyzer.explainIssue(code, {
          type: "general-question",
          severity: "low",
          line: editor.selection.start.line + 1,
          description: question,
          fixTime: 0,
        });

        this.postMessage({
          type: "response",
          content: explanation,
        });
      }
    } catch (error) {
      console.error("Chat error:", error);
      this.postMessage({
        type: "error",
        content:
          "Sorry, I encountered an error. Please check that your API key is configured correctly.",
      });
    }
  }

  private async handleCodeExplanation(code: string) {
    try {
      this.postMessage({
        type: "thinking",
        content: "Analyzing code snippet...",
      });

      const result = await this.analyzer.analyzeCode(code, "code-snippet");

      let response = `**Code Analysis:**\n\n`;
      response += `**Health Score:** ${result.healthScore}/10\n`;
      response += `**Issues:** ${result.issues.length}\n\n`;

      if (result.issues.length > 0) {
        response += `**Issues Found:**\n`;
        result.issues.forEach((issue, i) => {
          response += `${i + 1}. ${issue.description}\n`;
        });
      }

      if (result.suggestions.length > 0) {
        response += `\n**Recommendations:**\n`;
        result.suggestions.forEach((suggestion, i) => {
          response += `${i + 1}. ${suggestion}\n`;
        });
      }

      this.postMessage({
        type: "response",
        content: response,
      });
    } catch (error) {
      this.postMessage({
        type: "error",
        content: "Failed to analyze code snippet",
      });
    }
  }

  public postMessage(message: any) {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>AI Assistant</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    padding: 10px;
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    margin: 0;
                    font-size: 13px;
                }
                .chat-container {
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                }
                .header {
                    padding: 10px 0;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    margin-bottom: 10px;
                }
                .header h3 {
                    margin: 0;
                    font-size: 16px;
                    color: var(--vscode-foreground);
                }
                .messages {
                    flex: 1;
                    overflow-y: auto;
                    margin-bottom: 10px;
                    padding: 5px;
                }
                .message {
                    margin: 10px 0;
                    padding: 10px;
                    border-radius: 6px;
                    max-width: 100%;
                    word-wrap: break-word;
                    line-height: 1.4;
                }
                .user-message {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    margin-left: 10px;
                }
                .ai-message {
                    background-color: var(--vscode-editor-selectionBackground);
                    margin-right: 10px;
                }
                .thinking {
                    font-style: italic;
                    opacity: 0.7;
                    border-left: 3px solid var(--vscode-progressBar-background);
                    padding-left: 10px;
                }
                .error {
                    color: var(--vscode-errorForeground);
                    background-color: var(--vscode-inputValidation-errorBackground);
                    border: 1px solid var(--vscode-inputValidation-errorBorder);
                }
                .input-container {
                    display: flex;
                    gap: 5px;
                    padding: 10px;
                    background: var(--vscode-editor-background);
                    border-top: 1px solid var(--vscode-panel-border);
                }
                input {
                    flex: 1;
                    padding: 8px 12px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    font-size: 13px;
                    outline: none;
                }
                input:focus {
                    border-color: var(--vscode-focusBorder);
                }
                button {
                    padding: 8px 16px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 13px;
                    white-space: nowrap;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                .suggestions {
                    margin: 10px 0;
                    padding: 0;
                }
                .suggestion-btn {
                    display: block;
                    width: 100%;
                    text-align: left;
                    margin: 5px 0;
                    padding: 8px;
                    background: var(--vscode-editor-inactiveSelectionBackground);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    color: var(--vscode-foreground);
                    cursor: pointer;
                    font-size: 12px;
                }
                .suggestion-btn:hover {
                    background: var(--vscode-list-hoverBackground);
                }
                strong {
                    color: var(--vscode-editor-foreground);
                    font-weight: 600;
                }
            </style>
        </head>
        <body>
            <div class="chat-container">
                <div class="header">
                    <h3>🤖 AI Code Assistant</h3>
                </div>
                <div class="messages" id="messages">
                    <div class="message ai-message">
                        Hi! I'm your AI assistant. I can help you with:
                        <br><br>
                        <strong>• Code quality analysis</strong>
                        <br><strong>• Best practices and suggestions</strong>  
                        <br><strong>• Issue explanations and fixes</strong>
                        <br><strong>• General coding questions</strong>
                    </div>
                    <div class="suggestions">
                        <button class="suggestion-btn" onclick="askSuggestion('Analyze my current file')">📊 Analyze current file</button>
                        <button class="suggestion-btn" onclick="askSuggestion('What issues does my code have?')">🔍 Find issues in my code</button>
                        <button class="suggestion-btn" onclick="askSuggestion('How can I improve code quality?')">💡 How to improve quality?</button>
                    </div>
                </div>
                <div class="input-container">
                    <input type="text" id="userInput" placeholder="Ask about your code..." />
                    <button id="sendBtn" onclick="sendMessage()">Send</button>
                </div>
            </div>
            
            <script>
                const vscode = acquireVsCodeApi();
                const messagesEl = document.getElementById('messages');
                const inputEl = document.getElementById('userInput');
                const sendBtn = document.getElementById('sendBtn');
                
                function sendMessage() {
                    const question = inputEl.value.trim();
                    if (!question) return;
                    
                    addMessage(question, 'user');
                    sendBtn.disabled = true;
                    
                    vscode.postMessage({
                        type: 'askQuestion',
                        question: question
                    });
                    
                    inputEl.value = '';
                }
                
                function askSuggestion(question) {
                    inputEl.value = question;
                    sendMessage();
                }
                
                function addMessage(text, sender, isThinking = false, isError = false) {
                    const messageEl = document.createElement('div');
                    let className = 'message ' + (sender === 'user' ? 'user-message' : 'ai-message');
                    if (isThinking) className += ' thinking';
                    if (isError) className += ' error';
                    messageEl.className = className;
                    
                    // Handle markdown-like formatting
                    const formatted = text
                        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                        .replace(/\n/g, '<br>');
                        
                    messageEl.innerHTML = formatted;
                    messagesEl.appendChild(messageEl);
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                    
                    return messageEl;
                }
                
                window.addEventListener('message', event => {
                    const message = event.data;
                    sendBtn.disabled = false;
                    
                    switch (message.type) {
                        case 'thinking':
                            addMessage(message.content, 'ai', true);
                            break;
                        case 'response':
                        case 'explanation':
                            addMessage(message.content, 'ai');
                            break;
                        case 'analysis':
                            const result = message.content;
                            const text = \`**Health Score:** \${result.healthScore}/10
**Issues Found:** \${result.issues.length}

**Top Suggestions:**
\${result.suggestions.slice(0, 3).map(s => '• ' + s).join('\\n')}\`;
                            addMessage(text, 'ai');
                            break;
                        case 'error':
                            addMessage('❌ ' + message.content, 'ai', false, true);
                            break;
                    }
                });
                
                inputEl.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter' && !sendBtn.disabled) {
                        sendMessage();
                    }
                });
                
                // Auto-focus input
                inputEl.focus();
            </script>
        </body>
        </html>`;
  }
}
