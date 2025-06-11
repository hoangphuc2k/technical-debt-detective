import * as vscode from "vscode";
import { CodeAnalyzerAgent, CodeIssue } from "../agents/codeAnalyzerAgent.js";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "technicalDebtDetective.chatView";

  private _view?: vscode.WebviewView;
  private _thinkingMessageId?: string;

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

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      console.log('Received message:', data); // Debug log
      
      switch (data.type) {
        case "askQuestion":
          await this.handleQuestion(data.question);
          break;
        case "explainCode":
          await this.handleCodeExplanation(data.code);
          break;
        case "analyzeCurrentFile":
          await this.handleAnalyzeCurrentFile();
          break;
        case "findIssues":
          await this.handleFindIssues();
          break;
        case "improveQuality":
          await this.handleImproveQuality();
          break;
        case "ready":
          console.log("Webview is ready");
          this.postMessage({
            type: "welcome",
            content: "Ready to help analyze your code!",
          });
          break;
      }
    });
  }

  private async handleQuestion(question: string) {
    try {
      // Generate a unique ID for the thinking message
      this._thinkingMessageId = Date.now().toString();
      
      // Show thinking message
      this.postMessage({
        type: "thinking",
        content: "Analyzing your question...",
        id: this._thinkingMessageId,
      });

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        this.removeThinkingMessage();
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

        this.removeThinkingMessage();
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

        this.removeThinkingMessage();
        this.postMessage({
          type: "response",
          content: explanation,
        });
      }
    } catch (error) {
      console.error("Chat error:", error);
      this.removeThinkingMessage();
      this.postMessage({
        type: "error",
        content:
          "Sorry, I encountered an error. Please check that your API key is configured correctly.",
      });
    }
  }

  private async handleCodeExplanation(code: string) {
    try {
      this._thinkingMessageId = Date.now().toString();
      this.postMessage({
        type: "thinking",
        content: "Analyzing code snippet...",
        id: this._thinkingMessageId,
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

      this.removeThinkingMessage();
      this.postMessage({
        type: "response",
        content: response,
      });
    } catch (error) {
      this.removeThinkingMessage();
      this.postMessage({
        type: "error",
        content: "Failed to analyze code snippet",
      });
    }
  }

  private async handleAnalyzeCurrentFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this.postMessage({
        type: "response",
        content: "No active file to analyze. Please open a JavaScript or TypeScript file.",
      });
      return;
    }

    // Trigger the analyze command
    await vscode.commands.executeCommand("technicalDebtDetective.analyzeFile");
    
    this.postMessage({
      type: "response",
      content: "Analysis triggered! Check the Problems panel for results.",
    });
  }

  private async handleFindIssues() {
    await this.handleQuestion("What issues does my code have?");
  }

  private async handleImproveQuality() {
    await this.handleQuestion("How can I improve code quality?");
  }

  private removeThinkingMessage() {
    if (this._thinkingMessageId) {
      this.postMessage({
        type: "removeThinking",
        id: this._thinkingMessageId,
      });
      this._thinkingMessageId = undefined;
    }
  }

  public postMessage(message: any) {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    // Use a nonce to only allow specific scripts to be run
    const nonce = getNonce();

    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
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
                    animation: fadeIn 0.3s ease-in;
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
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
                    animation: pulse 1.5s ease-in-out infinite;
                }
                @keyframes pulse {
                    0%, 100% { opacity: 0.7; }
                    50% { opacity: 0.4; }
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
                    transition: background-color 0.2s;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                button:active:not(:disabled) {
                    transform: scale(0.98);
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
                    transition: all 0.2s;
                }
                .suggestion-btn:hover {
                    background: var(--vscode-list-hoverBackground);
                    transform: translateX(2px);
                }
                strong {
                    color: var(--vscode-editor-foreground);
                    font-weight: 600;
                }
                .welcome-message {
                    opacity: 0.8;
                    font-style: italic;
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
                        <button class="suggestion-btn" id="analyzeBtn">📊 Analyze current file</button>
                        <button class="suggestion-btn" id="findIssuesBtn">🔍 Find issues in my code</button>
                        <button class="suggestion-btn" id="improveBtn">💡 How to improve quality?</button>
                    </div>
                </div>
                <div class="input-container">
                    <input type="text" id="userInput" placeholder="Ask about your code..." />
                    <button id="sendBtn">Send</button>
                </div>
            </div>
            
            <script nonce="${nonce}">
                (function() {
                    const vscode = acquireVsCodeApi();
                    const messagesEl = document.getElementById('messages');
                    const inputEl = document.getElementById('userInput');
                    const sendBtn = document.getElementById('sendBtn');
                    const analyzeBtn = document.getElementById('analyzeBtn');
                    const findIssuesBtn = document.getElementById('findIssuesBtn');
                    const improveBtn = document.getElementById('improveBtn');
                    
                    // Debug log
                    console.log('Chat view script loaded');
                    
                    // Send ready message
                    vscode.postMessage({ type: 'ready' });
                    
                    function sendMessage() {
                        const question = inputEl.value.trim();
                        if (!question) return;
                        
                        console.log('Sending message:', question);
                        
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
                    
                    function addMessage(text, sender, isThinking = false, isError = false, id = null) {
                        const messageEl = document.createElement('div');
                        let className = 'message ' + (sender === 'user' ? 'user-message' : 'ai-message');
                        if (isThinking) className += ' thinking';
                        if (isError) className += ' error';
                        messageEl.className = className;
                        
                        if (id) {
                            messageEl.setAttribute('data-message-id', id);
                        }
                        
                        // Handle markdown-like formatting
                        const formatted = text
                            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                            .replace(/\n/g, '<br>');
                            
                        messageEl.innerHTML = formatted;
                        messagesEl.appendChild(messageEl);
                        messagesEl.scrollTop = messagesEl.scrollHeight;
                        
                        return messageEl;
                    }
                    
                    function removeMessage(id) {
                        const element = document.querySelector('[data-message-id="' + id + '"]');
                        if (element) {
                            element.remove();
                        }
                    }
                    
                    // Event listeners with proper binding
                    sendBtn.addEventListener('click', function(e) {
                        e.preventDefault();
                        sendMessage();
                    });
                    
                    analyzeBtn.addEventListener('click', function(e) {
                        e.preventDefault();
                        askSuggestion('Analyze my current file');
                    });
                    
                    findIssuesBtn.addEventListener('click', function(e) {
                        e.preventDefault();
                        askSuggestion('What issues does my code have?');
                    });
                    
                    improveBtn.addEventListener('click', function(e) {
                        e.preventDefault();
                        askSuggestion('How can I improve code quality?');
                    });
                    
                    inputEl.addEventListener('keypress', function(e) {
                        if (e.key === 'Enter' && !sendBtn.disabled) {
                            e.preventDefault();
                            sendMessage();
                        }
                    });
                    
                    window.addEventListener('message', function(event) {
                        const message = event.data;
                        console.log('Received message:', message);
                        sendBtn.disabled = false;
                        
                        switch (message.type) {
                            case 'thinking':
                                addMessage(message.content, 'ai', true, false, message.id);
                                break;
                            case 'removeThinking':
                                removeMessage(message.id);
                                break;
                            case 'response':
                            case 'explanation':
                                addMessage(message.content, 'ai');
                                break;
                            case 'analysis':
                                const result = message.content;
                                const text = '**Health Score:** ' + result.healthScore + '/10\n' +
                                    '**Issues Found:** ' + result.issues.length + '\n\n' +
                                    '**Top Suggestions:**\n' +
                                    result.suggestions.slice(0, 3).map(s => '• ' + s).join('\n');
                                addMessage(text, 'ai');
                                break;
                            case 'error':
                                addMessage('❌ ' + message.content, 'ai', false, true);
                                break;
                            case 'welcome':
                                addMessage(message.content, 'ai', false, false, null);
                                break;
                        }
                    });
                    
                    // Auto-focus input
                    inputEl.focus();
                    
                    // Debug: Test if clicks work
                    document.body.addEventListener('click', function(e) {
                        console.log('Click detected on:', e.target);
                    });
                })();
            </script>
        </body>
        </html>`;
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}