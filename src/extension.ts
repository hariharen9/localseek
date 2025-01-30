import * as vscode from 'vscode';
import { Ollama } from 'ollama';

export function activate(context: vscode.ExtensionContext) {
    const ollama = new Ollama({ host: 'http://localhost:11434' });
    let currentPanel: vscode.WebviewPanel | undefined;

    // Register the command to open the chat interface
    context.subscriptions.push(
        vscode.commands.registerCommand('localseek.openChat', async () => {
            if (currentPanel) {
                currentPanel.reveal(vscode.ViewColumn.Beside);
                return; 
            }

            // Create and configure the webview panel
            currentPanel = vscode.window.createWebviewPanel(
                'localseekChat',
                'LocalSeek AI Chat',
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            // Get initial list of models
            let models: string[] = [];
            try {
                const response = await ollama.list();
                models = response.models.map((model: any) => model.name);
            } catch (error) {
                vscode.window.showErrorMessage('Failed to connect to Ollama. Make sure it\'s running.');
            }

            // Set webview HTML content
            currentPanel.webview.html = getWebviewContent(models);

            // Handle messages from the webview
            currentPanel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'sendMessage':
                        try {
                            const response = await ollama.generate({
                                model: message.model,
                                prompt: message.text,
                                stream: true
                            });

                            for await (const part of response) {
                                currentPanel?.webview.postMessage({
                                    command: 'appendResponse',
                                    text: part.response
                                });
                            }
                        } catch (error) {
                            vscode.window.showErrorMessage('Error generating response');
                        }
                        break;
                }
            });

            // Clean up when panel is closed
            currentPanel.onDidDispose(() => {
                currentPanel = undefined;
            }, null, context.subscriptions);
        })
    );
}

function getWebviewContent(models: string[]): string {
    return /*html*/`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>LocalSeek AI Chat</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                padding: 10px;
                background-color: var(--vscode-editor-background);
                color: var(--vscode-editor-foreground);
            }
            .chat-container {
                display: flex;
                flex-direction: column;
                height: 95vh;
            }
            #modelSelector {
                margin-bottom: 10px;
                padding: 5px;
                background-color: var(--vscode-dropdown-background);
                color: var(--vscode-dropdown-foreground);
            }
            #chatHistory {
                flex: 1;
                overflow-y: auto;
                border: 1px solid var(--vscode-editorWidget-border);
                padding: 10px;
                margin-bottom: 10px;
            }
            .input-container {
                display: flex;
                gap: 10px;
            }
            #userInput {
                flex: 1;
                padding: 5px;
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border);
            }
            button {
                padding: 5px 15px;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                cursor: pointer;
            }
            .message {
                margin-bottom: 10px;
            }
            .user {
                color: var(--vscode-editor-foreground);
            }
            .assistant {
                color: var(--vscode-terminal-ansiGreen);
            }
        </style>
    </head>
    <body>
        <div class="chat-container">
            <select id="modelSelector">
                ${models.map(model => `<option value="${model}">${model}</option>`).join('')}
            </select>
            
            <div id="chatHistory"></div>
            
            <div class="input-container">
                <input type="text" id="userInput" placeholder="Type your message..."/>
                <button onclick="sendMessage()">Send</button>
            </div>
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            let responseBuffer = '';

            function sendMessage() {
                const input = document.getElementById('userInput');
                const modelSelector = document.getElementById('modelSelector');
                const chatHistory = document.getElementById('chatHistory');
                
                // Add user message to history
                const userMessage = input.value;
                chatHistory.innerHTML += \`
                    <div class="message user">
                        <strong>You:</strong> \${userMessage}
                    </div>
                \`;
                
                // Send message to extension
                vscode.postMessage({
                    command: 'sendMessage',
                    text: userMessage,
                    model: modelSelector.value
                });

                // Clear input
                input.value = '';
            }

            // Handle responses from extension
            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command === 'appendResponse') {
                    responseBuffer += message.text;
                    
                    // Update last assistant message
                    const chatHistory = document.getElementById('chatHistory');
                    const assistantMessages = document.getElementsByClassName('assistant');
                    if (assistantMessages.length > 0) {
                        assistantMessages[assistantMessages.length - 1].innerHTML = \`
                            <strong>AI:</strong> \${responseBuffer}
                        \`;
                    } else {
                        chatHistory.innerHTML += \`
                            <div class="message assistant">
                                <strong>AI:</strong> \${responseBuffer}
                            </div>
                        \`;
                    }
                    
                    // Auto-scroll to bottom
                    chatHistory.scrollTop = chatHistory.scrollHeight;

                    // Clear the buffer after the response is complete
                    if (message.text === '') {
                        responseBuffer = '';
                    }
                }
            });
        </script>
    </body>
    </html>
    `;
}

export function deactivate() {}