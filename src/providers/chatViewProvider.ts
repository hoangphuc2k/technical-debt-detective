import * as vscode from 'vscode';
import { CodeAnalyzerAgent } from '../agents/codeAnalyzerAgent.js';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'techDebtDetective.chatView';
    
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
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.type) {
                case 'askQuestion':
                    await this.handleQuestion(data.question);
                    break;
                case 'explainCode':
                    await this.handleCodeExplanation(data.code);
                    break;
            }
        });
    }

    private async handleQuestion(question: string) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            this.postMessage({
                type: 'response',
                content: 'Please open a file to analyze.'
            });
            return;
        }

        try {
            const response = await this.analyzer.explainIssue(
                editor.document.getText(),
                { 
                    type: 'general',
                    severity: 'low',
                    line: editor.selection.start.line + 1,
                    description: question,
                    fixTime: 0
                }
            );
            
            this.postMessage({
                type: 'response',
                content: response
            });
        } catch (error) {
            this.postMessage({
                type: 'error',
                content: 'Failed to get response'
            });
        }
    }

    private async handleCodeExplanation(code: string) {
        try {
            const result = await this.analyzer.analyzeCode(code, 'snippet');
            this.postMessage({
                type: 'analysis',
                content: result
            });
        } catch (error) {
            this.postMessage({
                type: 'error',
                content: 'Failed to analyze code'
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
                }
                .chat-container {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                }
                .messages {
                    flex: 1;
                    overflow-y: auto;
                    margin-bottom: 10px;
                }
                .message {
                    margin: 10px 0;
                    padding: 10px;
                    border-radius: 5px;
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                }
                .user-message {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    margin-left: 20px;
                }
                .ai-message {
                    background-color: var(--vscode-editor-selectionBackground);
                    margin-right: 20px;
                }
                .input-container {
                    display: flex;
                    gap: 5px;
                }
                input {
                    flex: 1;
                    padding: 8px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 3px;
                }
                button {
                    padding: 8px 16px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 3px;
                    cursor: pointer;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                pre {
                    background-color: var(--vscode-textBlockQuote-background);
                    padding: 8px;
                    border-radius: 3px;
                    overflow-x: auto;
                }
            </style>
        </head>
        <body>
            <div class="chat-container">
                <h3>🤖 AI Code Assistant</h3>
                <div class="messages" id="messages">
                    <div class="message ai-message">
                        Hi! I'm your AI assistant. Ask me about code quality, best practices, or paste code for analysis.
                    </div>
                </div>
                <div class="input-container">
                    <input type="text" id="userInput" placeholder="Ask a question..." />
                    <button onclick="sendMessage()">Send</button>
                </div>
            </div>
            
            <script>
                const vscode = acquireVsCodeApi();
                const messagesEl = document.getElementById('messages');
                const inputEl = document.getElementById('userInput');
                
                function sendMessage() {
                    const question = inputEl.value.trim();
                    if (!question) return;
                    
                    addMessage(question, 'user');
                    
                    vscode.postMessage({
                        type: 'askQuestion',
                        question: question
                    });
                    
                    inputEl.value = '';
                }
                
                function addMessage(text, sender) {
                    const messageEl = document.createElement('div');
                    messageEl.className = 'message ' + (sender === 'user' ? 'user-message' : 'ai-message');
                    messageEl.textContent = text;
                    messagesEl.appendChild(messageEl);
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                }
                
                window.addEventListener('message', event => {
                    const message = event.data;
                    
                    switch (message.type) {
                        case 'response':
                        case 'explanation':
                            addMessage(message.content, 'ai');
                            break;
                        case 'analysis':
                            const result = message.content;
                            const text = \`Health Score: \${result.healthScore}/10
Issues Found: \${result.issues.length}
Top Suggestions:
\${result.suggestions.join('\\n')}\`;
                            addMessage(text, 'ai');
                            break;
                        case 'error':
                            addMessage('Error: ' + message.content, 'ai');
                            break;
                    }
                });
                
                inputEl.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        sendMessage();
                    }
                });
            </script>
        </body>
        </html>`;
    }
}