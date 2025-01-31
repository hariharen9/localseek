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
            <title>LocalSeek: "YOUR" AI Chat</title>
            <style>
                :root {
                    --primary: rgba(99, 102, 241, 0.9);
                    --surface: rgba(17, 24, 39, 0.95);
                    --border: rgba(255, 255, 255, 0.1);
                }
                
                body {
                    font-family: 'Inter', system-ui, -apple-system, sans-serif;
                    margin: 0;
                    padding: 2rem;
                    background: 
                        radial-gradient(circle at 100% 0%, rgba(99, 102, 241, 0.1) 0%, transparent 60%),
                        radial-gradient(circle at 0% 100%, rgba(16, 185, 129, 0.1) 0%, transparent 60%),
                        #0f172a;
                    height: 100vh;
                    color: rgba(255, 255, 255, 0.9);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                }

                .error-card {
                    background: var(--surface);
                    padding: 2rem;
                    border-radius: 1.5rem;
                    border: 1px solid var(--border);
                    backdrop-filter: blur(20px);
                    box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.25);
                    max-width: 400px;
                    text-align: center;
                }

                .error-icon {
                    font-size: 3rem;
                    margin-bottom: 1rem;
                    opacity: 0.8;
                }
            </style>
        </head>
        <body>
            <div class="error-card">
                <div class="error-icon">⚠️</div>
                <h2>Model Connection Error</h2>
                <p>Please ensure Ollama is running and has models installed.</p>
            </div>
        </body>
        </html>`;
    }

    return /*html*/`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>LocalSeek: "YOUR" AI Chat</title>
        <style>
            :root {
                --primary: rgba(99, 102, 241, 0.9);
                --surface: rgba(17, 24, 39, 0.95);
                --border: rgba(255, 255, 255, 0.1);
            }

            body {
                font-family: 'Inter', system-ui, -apple-system, sans-serif;
                margin: 0;
                padding: 2rem;
                background: 
                    radial-gradient(circle at 100% 0%, rgba(99, 102, 241, 0.1) 0%, transparent 60%),
                    radial-gradient(circle at 0% 100%, rgba(16, 185, 129, 0.1) 0%, transparent 60%),
                    #0f172a;
                height: 100vh;
                color: rgba(255, 255, 255, 0.9);
                display: flex;
                justify-content: center;
                align-items: center;
            }

            .header {
                width: 100%;
                text-align: center;
                position: absolute;
                top: 1rem;
                left: 50%;
                transform: translateX(-50%);
            }

            footer {
                width: 100%;
                text-align: center;
                bottom: 0.3px;
                left: 50%;
                transform: translateX(-50%);
                position: fixed;
                color: rgba(255, 255, 255, 0.5);
                
                font-size: 0.875rem;
            }

            footer a {
                color: rgb(255, 0, 0);
                text-decoration: none;
            }

            .chat-container {
                margin-top: 6rem; /* Push chatbox down */
            }

            .title {
                font-size: 2.5rem;
                font-weight: bold;
                text-align: center;
                text-transform: uppercase;
                letter-spacing: 2px;
                margin-bottom: 0.5rem;
                background: linear-gradient(270deg, #6366f1, #10b981, #6366f1);
                background-size: 200% 200%;
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                animation: gradientMove 5s ease infinite;
            }

            .tagline {
                font-size: 1.2rem;
                font-weight: 400;
                color: rgba(255, 255, 255, 0.8);
                text-align: center;
                margin-bottom: 1.5rem;
            }

            .chat-container {
                width: 100%;
                max-width: 800px;
                height: 90vh;
                background: var(--surface);
                border-radius: 1.5rem;
                border: 1px solid var(--border);
                backdrop-filter: blur(20px);
                box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.25);
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }

            #modelSelector {
                margin: 1rem;
                padding: 0.75rem 1rem;
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid var(--border);
                border-radius: 0.75rem;
                color: white;
                font-size: 0.875rem;
                appearance: none;
                background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3e%3cpath d='M7 10l5 5 5-5z'/%3e%3c/svg%3e");
                background-repeat: no-repeat;
                background-position: right 0.75rem center;
                background-size: 1.25rem;
            }

            #chatHistory {
                flex: 1;
                padding: 1.5rem;
                overflow-y: auto;
                background: rgba(0, 0, 0, 0.2);
                display: flex;
                flex-direction: column;
                gap: 1.5rem;
            }

            .message {
                max-width: 80%;
                padding: 1rem 1.25rem;
                border-radius: 1rem;
                position: relative;
                animation: messageEnter 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                line-height: 1.5;
                font-size: 0.9375rem;
            }

            .user {
                background: var(--primary);
                align-self: flex-end;
                border-bottom-right-radius: 0.25rem;
            }

            .assistant {
                background: rgba(31, 41, 55, 0.7);
                align-self: flex-start;
                border-bottom-left-radius: 0.25rem;
            }

            .input-container {
                padding: 1.5rem;
                background: rgba(0, 0, 0, 0.3);
                border-top: 1px solid var(--border);
                display: flex;
                gap: 1rem;
            }

            #userInput {
                flex: 1;
                padding: 0.875rem 1.25rem;
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid var(--border);
                border-radius: 0.75rem;
                color: white;
                font-size: 0.9375rem;
                transition: all 0.2s ease;
            }

            #userInput:focus {
                outline: none;
                border-color: var(--primary);
                box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
            }

            button {
                padding: 0.875rem 1.5rem;
                background: var(--primary);
                border: none;
                border-radius: 0.75rem;
                color: white;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                gap: 0.5rem;
            }

            button:hover {
                opacity: 0.9;
                transform: translateY(-1px);
            }

            @keyframes messageEnter {
                from {
                    opacity: 0;
                    transform: translateY(10px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            /* Scrollbar Styling */
            ::-webkit-scrollbar {
                width: 8px;
            }

            ::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.05);
                border-radius: 4px;
            }

            ::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.2);
                border-radius: 4px;
            }
        </style>
    </head>
    <body>
        <div class="header">
            <div class="title">LocalSeek</div>
            <div class="tagline">Your personal AI-powered chat assistant</div>
        </div>
        <div class="chat-container">
            <select id="modelSelector">
                ${models.map(model => `<option value="${model}">${model}</option>`).join('')}
            </select>
            
            <div id="chatHistory"></div>
            
            <div class="input-container">
                <input type="text" id="userInput" placeholder="Ask me anything..." />
                <button onclick="sendMessage()">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
                    </svg>
                    Send
                </button>
            </div>
        </div>
        <footer>
            <p style="text-align: center; margin-top: 2rem; color: rgba(255, 255, 255, 0.5); font-size: 0.875rem;">
                Made with ❤️ by <a href="https://www.linkedin.com/in/hariharen9/" target="_blank" style="color: rgba(255, 255, 255, 0.5);">Hariharen</a>
            </p>
        </footer>
        <script>
            // Existing JavaScript remains the same, with updated class names
            const vscode = acquireVsCodeApi();
            let currentAssistantMessageElement = null;

            function sendMessage() {
                const input = document.getElementById('userInput');
                const modelSelector = document.getElementById('modelSelector');
                const chatHistory = document.getElementById('chatHistory');
                
                const userMessage = input.value.trim();
                if (!userMessage) return;

                chatHistory.innerHTML += \`
                    <div class="message user">
                        \${userMessage}
                    </div>
                \`;
                
                vscode.postMessage({
                    command: 'sendMessage',
                    text: userMessage,
                    model: modelSelector.value
                });
                
                input.value = '';
                chatHistory.scrollTop = chatHistory.scrollHeight;
            }

            window.addEventListener('message', event => {
                const message = event.data;
                const chatHistory = document.getElementById('chatHistory');

                if (message.command === 'appendResponse') {
                    if (!currentAssistantMessageElement || message.isComplete) {
                        if (message.text.trim() !== '') {
                            currentAssistantMessageElement = document.createElement('div');
                            currentAssistantMessageElement.className = 'message assistant';
                            currentAssistantMessageElement.textContent = message.text;
                            chatHistory.appendChild(currentAssistantMessageElement);
                        }
                    } else {
                        currentAssistantMessageElement.textContent += message.text;
                    }

                    chatHistory.scrollTop = chatHistory.scrollHeight;

                    if (message.isComplete) {
                        currentAssistantMessageElement = null;
                    }
                }
            });

            document.getElementById('userInput').addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    sendMessage();
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