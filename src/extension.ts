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
                    retainContextWhenHidden: true,
                    localResourceRoots: [vscode.Uri.file(context.extensionPath)] // Add this line for CSP
                }
            );

            // Get initial list of models
            let models: string[] = [];
            try {
                const response = await ollama.list();
                models = response.models.map((model: any) => model.name);
            } catch (error) {
                console.error('Ollama connection error:', error);
                vscode.window.showErrorMessage('Failed to connect to Ollama. Make sure it\'s running.');
            }

            // Set webview HTML content
            currentPanel.webview.html = getWebviewContent(models);

            // Conversation history
            let conversationHistory: { role: string; content: string }[] = [];

            // Handle messages from the webview
            currentPanel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'sendMessage':
                        try {
                            // Add user message to the conversation history
                            conversationHistory.push({ role: 'user', content: message.text });

                            const response = await ollama.chat({
                                model: message.model,
                                messages: conversationHistory,
                                stream: true
                            });

                            let fullResponse = ''; // Buffer for the complete AI response

                            for await (const part of response) {
                                if (part.message?.content && part.message.content.trim() !== '') {
                                    fullResponse += part.message.content; // Append each part to the buffer
                                    currentPanel?.webview.postMessage({
                                        command: 'appendResponse',
                                        text: part.message.content,
                                        isComplete: false // Indicate this is not the final response
                                    });
                                }
                            }

                            // Skip adding empty responses to the conversation history
                            if (fullResponse.trim() !== '') {
                                conversationHistory.push({ role: 'assistant', content: fullResponse });
                            }

                            // Send a final message to indicate the response is complete
                            currentPanel?.webview.postMessage({
                                command: 'appendResponse',
                                text: '', // Empty text to signal completion
                                isComplete: true
                            });
                        } catch (streamError) {
                            console.error('Error during streaming response:', streamError);
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
    if (models.length === 0) {
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
            </style>
        </head>
        <body>
            <p>No models available. Please ensure Ollama is running and has models installed.</p>
        </body>
        </html>
        `;
    }

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
                <input type="text" id="userInput" placeholder="Type your message..." />
                <button onclick="sendMessage()">Send</button>
            </div>
        </div>
        <script>
            const vscode = acquireVsCodeApi();
            let currentAssistantMessageElement = null;

            // Function to send a message
            function sendMessage() {
                const input = document.getElementById('userInput');
                const modelSelector = document.getElementById('modelSelector');
                const chatHistory = document.getElementById('chatHistory');
                
                const userMessage = input.value.trim(); // Trim whitespace from input
                if (!userMessage) return; // Ignore empty messages

                // Add user message to history
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
                    const chatHistory = document.getElementById('chatHistory');

                    // Skip empty responses
                    if (!message.text && !message.isComplete) return;

                    if (!currentAssistantMessageElement || message.isComplete) {
                        // Create a new assistant message element if it doesn't exist or the response is complete
                        if (message.text.trim() !== '') {
                            currentAssistantMessageElement = document.createElement('div');
                            currentAssistantMessageElement.className = 'message assistant';
                            currentAssistantMessageElement.innerHTML = \`<strong>AI:</strong> \${message.text}\`;
                            chatHistory.appendChild(currentAssistantMessageElement);
                        }
                    } else {
                        // Append text to the current assistant message
                        currentAssistantMessageElement.innerHTML += message.text;
                    }

                    // Auto-scroll to bottom
                    setTimeout(() => {
                        chatHistory.scrollTop = chatHistory.scrollHeight;
                    }, 0);

                    // Reset the assistant message element when the response is complete
                    if (message.isComplete) {
                        currentAssistantMessageElement = null;
                    }
                }
            });

            // Add Enter key support
            document.getElementById('userInput').addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.keyCode === 13) {
                    event.preventDefault(); // Prevent default behavior (e.g., newline)
                    sendMessage(); // Trigger the send message function
                }
            });
        </script>
    </body>
    </html>
    `;
}

export function deactivate() {
    // No resources to clean up
}