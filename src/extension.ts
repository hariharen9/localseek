import * as vscode from "vscode";
import { Ollama } from "ollama";

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("localseek");
  const ollama = new Ollama({
    host: config.get("ollamaHost") || "http://localhost:11434",
  });

  let currentPanel: vscode.WebviewPanel | undefined;

  // Register command to open chat panel
  context.subscriptions.push(
    vscode.commands.registerCommand("localseek.openChat", async () => {
      if (currentPanel) {
        currentPanel.reveal(vscode.ViewColumn.Beside);
        return;
      }

      currentPanel = createWebviewPanel(context);
      setupWebview(currentPanel, context, ollama, () => {
        currentPanel = undefined;
      });
    })
  );

  // Register sidebar webview view
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "localseek-chat",
      new ChatWebviewViewProvider(context, ollama)
    )
  );
}

function createWebviewPanel(
  context: vscode.ExtensionContext
): vscode.WebviewPanel {
  // Properly declare and initialize the panel
  const panel = vscode.window.createWebviewPanel(
    "localseekChat",
    "LocalSeek AI Chat",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [context.extensionUri],
    }
  );

  // Add icon to title bar
  panel.iconPath = {
    light: vscode.Uri.joinPath(context.extensionUri, "media", "sidebar.svg"),
    dark: vscode.Uri.joinPath(context.extensionUri, "media", "sidebar.svg"),
  };

  return panel;
}

async function setupWebview(
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
  ollama: Ollama,
  onDispose: () => void
) {
  let models: string[] = [];
  try {
    const response = await ollama.list();
    models = response.models.map((model: any) => model.name);
  } catch (error) {
    vscode.window.showErrorMessage(
      "Failed to connect to Ollama. Make sure it's running."
    );
  }

  panel.webview.html = getWebviewContent(models, context);
  let conversationHistory: { role: string; content: string }[] = [];

  panel.webview.onDidReceiveMessage(async (message) => {
    handleMessage(message, panel, conversationHistory, ollama);
  });

  panel.onDidDispose(() => {
    onDispose();
  });
}

class ChatWebviewViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly ollama: Ollama
  ) { }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    let models: string[] = [];
    this.ollama
      .list()
      .then((response) => {
        models = response.models.map((model: any) => model.name);
        webviewView.webview.html = getWebviewContent(models, this.context);
      })
      .catch((error) => {
        webviewView.webview.html = getWebviewContent([], this.context);
      });

    let conversationHistory: { role: string; content: string }[] = [];

    webviewView.webview.onDidReceiveMessage(async (message) => {
      handleMessage(message, webviewView, conversationHistory, this.ollama);
    });
  }
}

async function handleMessage(
  message: any,
  webview: vscode.WebviewPanel | vscode.WebviewView,
  conversationHistory: { role: string; content: string }[],
  ollama: Ollama
) {
  switch (message.command) {
    case "sendMessage":
      try {
        conversationHistory.push({ role: "user", content: message.text });

        const response = await ollama.chat({
          model: message.model,
          messages: conversationHistory,
          stream: true,
        });

        let fullResponse = "";
        let buffer = "";
        for await (const part of response) {
          if (part.message.content) {
            const chunk = part.message.content;
            fullResponse += chunk;
            buffer += chunk;

            if (buffer.length > 50 || chunk.includes('\n')) {
              webview.webview.postMessage({
                command: "appendResponseChunk",
                text: buffer,
                isComplete: false,
              });
              buffer = "";
            }
          }
        }

        // Send any remaining buffer
        if (buffer.length > 0) {
          webview.webview.postMessage({
            command: "appendResponseChunk",
            text: buffer,
            isComplete: false,
          });
        }

        if (fullResponse) {
          conversationHistory.push({
            role: "assistant",
            content: fullResponse,
          });
        }

        // Finalize the message
        webview.webview.postMessage({
          command: "appendResponseChunk",
          text: "",
          isComplete: true,
        });
      } catch (error) {
        vscode.window.showErrorMessage("Error generating response");
      }
      break;
  }
}

function getWebviewContent(
  models: string[],
  context: vscode.ExtensionContext
): string {
  if (models.length === 0) {
    return /*html*/ `
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
            flex-direction: column;
            justify-content: center;
            align-items: center;
            text-align: center;
        }

        .title {
            font-size: 2.5rem;
            font-weight: bold;
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
            margin-bottom: 1.5rem;
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
            display: flex;
            flex-direction: column;
        }

        .error-icon {
            font-size: 3rem;
            margin-bottom: 1rem;
            opacity: 0.8;
        }

        footer {
            width: 100%;
            text-align: center;
            position: fixed;
            bottom: 0.3px;
            color: rgba(255, 255, 255, 0.5);
            font-size: 0.875rem;
        }

        footer a {
            color: rgb(255, 0, 0);
            text-decoration: none;
        }
    </style>
</head>
<body>
    <div class="title">LocalSeek</div>
    <div class="tagline">Seek your answers <i>💯LOCALLY</i> within VSCode </div>
    
    <div class="error-card">
        <div class="error-icon">⚠️</div>
        <h2>Model Connection Error</h2>
        <p>Please ensure Ollama is running in the background and has models installed.</p>
    </div>
    
    <footer>
        <p>Made with ❤️ by <a href="https://www.linkedin.com/in/hariharen9/" target="_blank">Hariharen</a></p>
    </footer>
</body>
</html>`;
  }

  return /*html*/ `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>LocalSeek: "YOUR" AI Chat</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/default.min.css">
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.6/purify.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <script>
        marked.setOptions({
            highlight: function(code, lang) {
                const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                return hljs.highlight(code, { language }).value;
            }
        });
    </script>
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

            .copy-button {
                position: absolute;
                top: 0.5rem;
                right: 0.5rem;
                padding: 0.25rem 0.5rem;
                background: rgba(99, 102, 241, 0.9);
                border: none;
                border-radius: 0.375rem;
                color: white;
                font-size: 0.75rem;
                cursor: pointer;
                opacity: 0.8;
                transition: opacity 0.2s ease;
            }

            .copy-button:hover {
                opacity: 1;
            }

            .code-block-wrapper {
                position: relative;
                margin: 1rem 0;
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

            pre code {
                display: block;
                overflow-x: auto;
                padding: 1em;
                background: rgb(255, 255, 255) !important;
                border-radius: 0.5rem;
                margin: 0.5rem 0;
            }

            .code-block-wrapper {
                position: relative;
                margin: 1rem 0;
                background: rgba(255, 255, 255, 0);
                border-radius: 0.5rem;
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

            .message.user {
              animation: messageSlide 0.3s ease-out;
            }

            @keyframes messageSlide {
              from { transform: translateX(20px); opacity: 0; }
              to { transform: translateX(0); opacity: 1; }
            }

            .typing-indicator {
              display: flex;
              gap: 0.25rem;
              padding: 1rem;
            }

            .dot {
              width: 8px;
              height: 8px;
              border-radius: 50%;
              background: var(--primary);
              animation: bounce 1.4s infinite;
            }

            @keyframes bounce {
              0%, 80%, 100% { transform: translateY(0); }
              40% { transform: translateY(-6px); }
            }

            #modelSelector {
                font-family: "Inter", "Arial", sans-serif;
                margin: 1rem;
                padding: 0.75rem 1rem;
                background: var(--surface);
                border: 1px solid var(--primary);
                border-radius: 1rem;
                color: white;
                font-style: italic;
                text-transform: uppercase;
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
                min-width: 0;
                padding: 0.875rem 1.25rem;
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid var(--border);
                border-radius: 0.75rem;
                color: white;
                font-size: 0.9375rem;
                transition: all 0.2s ease;
                resize: none;
                font-family: inherit;
                line-height: 1.5;
                max-height: 150px;
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
                flex-shrink: 0; /* Add this */
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

            @media (max-width: 600px) {
                .tagline {
                    font-size: 1rem;
                }

                .input-container {
                    padding: 0.5rem;
                    gap: 0.5rem;
                }
            }

            @media (max-width: 400px) {
                .title {
                    font-size: 2rem;
                }

                button span {
                    display: none;
                }

                button {
                    padding: 0.875rem;
                }

                button svg {
                    margin-right: 0;
                }
            }
        </style>
    </head>
    <body>
        <div class="header">
            <div class="title">LocalSeek</div>
            <div class="tagline">Seek your answers <i>💯LOCALLY</i> within VSCode </div>
        </div>
        <div class="chat-container">
            <select id="modelSelector">
                ${models
      .map((model) => `<option value="${model}">${model}</option>`)
      .join("")}
            </select>
            
            <div id="chatHistory"></div>
            
            <div class="input-container">
                                <textarea id="userInput" placeholder="Ask me anything..." rows="1"></textarea>
                <button onclick="sendMessage()">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
            </svg>
                    <span>Send</span>
                </button>
            </div>
        </div>
        <footer>
            <p style="text-align: center; margin-top: 2rem; color: rgba(255, 255, 255, 0.5); font-size: 0.875rem;">
                Made with ❤️ by <a href="https://www.linkedin.com/in/hariharen9/" target="_blank" style="color: rgba(255, 255, 255, 0.5);">Hariharen</a>
            </p>
        </footer>
        <script>
    const vscode = acquireVsCodeApi();
    let currentAssistantMessageElement = null;
    let isProcessingResponse = false;

    function sendMessage() {
        if (isProcessingResponse) {
            vscode.postMessage({
                command: 'showWarningMessage',
                text: 'Please wait for current response to complete'
            });
            return;
        }

        const input = document.getElementById('userInput');
        const modelSelector = document.getElementById('modelSelector');
        const chatHistory = document.getElementById('chatHistory');
        const userMessage = input.value;
        
        if (!userMessage) return;

        // Add user message
        chatHistory.innerHTML += \`
            <div class="message user">
                \${userMessage}
            </div>
        \`;

        // Send to extension
        vscode.postMessage({
            command: 'sendMessage',
            text: userMessage,
            model: modelSelector.value
        });

        input.value = '';
        chatHistory.scrollTop = chatHistory.scrollHeight;
        isProcessingResponse = true;
    }

    // Original input handler
    document.getElementById('userInput').addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });

    const userInput = document.getElementById('userInput');
    userInput.addEventListener('input', () => {
        userInput.style.height = 'auto';
        userInput.style.height = (userInput.scrollHeight) + 'px';
    });

    
    window.addEventListener('message', async (event) => {
        const message = event.data;
        const chatHistory = document.getElementById('chatHistory');

        try {
            if (message.command === 'appendResponseChunk') {
                if (!currentAssistantMessageElement) {
                    currentAssistantMessageElement = document.createElement('div');
                    currentAssistantMessageElement.className = 'message assistant';
                    chatHistory.appendChild(currentAssistantMessageElement);
                    
                    const tempContent = document.createElement('div');
                    tempContent.style.whiteSpace = 'pre-wrap';
                    tempContent.id = 'temp-streaming-raw';
                    currentAssistantMessageElement.appendChild(tempContent);
                }

                const tempContent = document.getElementById('temp-streaming-raw');
                let chunkText = message.text;


                tempContent.textContent += chunkText;

                // Auto-scroll only if near bottom
                const isNearBottom = chatHistory.scrollHeight - chatHistory.clientHeight <= chatHistory.scrollTop + 100;
                if (isNearBottom) {
                    chatHistory.scrollTop = chatHistory.scrollHeight;
                }

                if (message.isComplete) {
                    // Final processing before Markdown conversion
                    const finalText = tempContent.textContent
                    
                    // Convert to Markdown
                    const parsedHtml = marked.parse(finalText);


                    // Create final content container
                    const finalContent = document.createElement('div');
                    finalContent.innerHTML = parsedHtml;

                    // Process code blocks
                    finalContent.querySelectorAll('pre code').forEach(codeBlock => {
                        const wrapper = document.createElement('div');
                        wrapper.className = 'code-block-wrapper';
                        
                        const copyButton = document.createElement('button');
                        copyButton.className = 'copy-button';
                        copyButton.textContent = 'Copy';
                        copyButton.onclick = () => copyCodeToClipboard(codeBlock.textContent);
                        
                        codeBlock.parentNode.insertBefore(wrapper, codeBlock);
                        wrapper.appendChild(codeBlock);
                        wrapper.appendChild(copyButton);
                    });

                    // Replace temporary content
                    currentAssistantMessageElement.replaceChild(
                        finalContent,
                        tempContent
                    );

                    // Apply syntax highlighting
                    hljs.highlightAll();

                    // Reset state
                    currentAssistantMessageElement = null;
                    isProcessingResponse = false;
                }
            }
        } catch (error) {
            console.error('Error handling message:', error);
            isProcessingResponse = false;
        }
    });

    // Copy function
    function copyCodeToClipboard(code) {
        navigator.clipboard.writeText(code).then(() => {
            vscode.postMessage({
                command: 'showInformationMessage',
                text: 'Code copied to clipboard!'
            });
        });
    }
</script>

    </body>
    </html>
    `;
}


export function deactivate() {
  // No resources to clean up
}
