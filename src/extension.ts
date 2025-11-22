import * as vscode from "vscode";
import { Ollama } from "ollama";
import { ChatHistoryManager, ChatMessage, ChatConversation } from "./chatHistory";
import { KnowledgeBaseManager } from "./rag";

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("localseek");
  const ollama = new Ollama({
    host: config.get("ollamaHost") || "http://localhost:11434",
  });

  const chatHistoryManager = new ChatHistoryManager(context);
  const knowledgeBaseManager = new KnowledgeBaseManager(context);

  let currentPanel: vscode.WebviewPanel | undefined;
  let sidebarWebviewView: vscode.WebviewView | undefined;

  context.subscriptions.push(
    vscode.commands.registerCommand("localseek.openChat", async () => {
      if (currentPanel) {
        currentPanel.reveal(vscode.ViewColumn.Beside);
        return;
      }

      currentPanel = createWebviewPanel(context);
      setupWebview(currentPanel, context, ollama, chatHistoryManager, knowledgeBaseManager, () => {
        currentPanel = undefined;
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("localseek.sendSelectedCode", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor found");
        return;
      }

      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);
      
      if (!selectedText.trim()) {
        vscode.window.showWarningMessage("No text selected");
        return;
      }

      const languageId = editor.document.languageId;
      const fileName = editor.document.fileName;
      const formattedCode = `Here's the selected code from \`${fileName}\`:\n\n\`\`\`${languageId}\n${selectedText}\n\`\`\``;
      
      const targetWebview = sidebarWebviewView || currentPanel;
      
      if (!targetWebview) {
        await vscode.commands.executeCommand('localseek-chat.focus');
        setTimeout(() => {
          if (sidebarWebviewView) {
            sidebarWebviewView.webview.postMessage({
              command: 'insertTextAtCursor',
              text: formattedCode
            });
          }
        }, 500);
      } else {
        targetWebview.webview.postMessage({
          command: 'insertTextAtCursor',
          text: formattedCode
        });
      }
      
      vscode.window.showInformationMessage("Selected code sent to LocalSeek Chat");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("localseek.indexKnowledgeBase", async () => {
      try {
        await knowledgeBaseManager.indexKnowledgeBase();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to index knowledge base: ${error}`);
      }
    })
  );

  const chatWebviewProvider = new ChatWebviewViewProvider(context, ollama, chatHistoryManager, knowledgeBaseManager, (view) => {
    sidebarWebviewView = view;
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "localseek-chat",
      chatWebviewProvider
    )
  );
}

function createWebviewPanel(
  context: vscode.ExtensionContext
): vscode.WebviewPanel {
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
  chatHistoryManager: ChatHistoryManager,
  knowledgeBaseManager: KnowledgeBaseManager,
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
  
  // Start with a new conversation
  let currentConversationId = chatHistoryManager.startNewConversation();
  let conversationHistory: ChatMessage[] = [];

  panel.webview.onDidReceiveMessage(async (message) => {
    await handleMessage(message, panel, conversationHistory, ollama, chatHistoryManager, currentConversationId, (newId) => {
      currentConversationId = newId;
    }, knowledgeBaseManager);
  });

  panel.onDidDispose(() => {
    onDispose();
  });
}

class ChatWebviewViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly ollama: Ollama,
    private readonly chatHistoryManager: ChatHistoryManager,
    private readonly knowledgeBaseManager: KnowledgeBaseManager,
    private readonly onViewReady: (view: vscode.WebviewView) => void
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    // Notify that the view is ready
    this.onViewReady(webviewView);

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

    // Start with a new conversation
    let currentConversationId = this.chatHistoryManager.startNewConversation();
    let conversationHistory: ChatMessage[] = [];

      webviewView.webview.onDidReceiveMessage(async (message) => {
      await handleMessage(message, webviewView, conversationHistory, this.ollama, this.chatHistoryManager, currentConversationId, (newId) => {
        currentConversationId = newId;
      }, this.knowledgeBaseManager);
    });
  }
}

async function postModelsList(webview: vscode.WebviewPanel | vscode.WebviewView, ollama: Ollama) {
  try {
    const response = await ollama.list();
    const models = (response.models || []).map((m: any) => ({
      name: m.name,
      size: m.size, // bytes (may be undefined in some versions)
      modifiedAt: m.modified_at || m.modifiedAt || undefined,
    }));
    webview.webview.postMessage({ command: "modelsList", models });
  } catch (err) {
    webview.webview.postMessage({ command: "ollamaError", error: "Failed to fetch models. Is Ollama running?" });
  }
}

async function handleMessage(
  message: any,
  webview: vscode.WebviewPanel | vscode.WebviewView,
  conversationHistory: ChatMessage[],
  ollama: Ollama,
  chatHistoryManager: ChatHistoryManager,
  currentConversationId: string,
  setConversationId: (id: string) => void,
  knowledgeBaseManager?: KnowledgeBaseManager
) {
  switch (message.command) {
    case "showInformationMessage":
      vscode.window.showInformationMessage(message.text || "");
      break;
    case "showWarningMessage":
      vscode.window.showWarningMessage(message.text || "");
      break;
    case "showErrorMessage":
      vscode.window.showErrorMessage(message.text || "");
      break;
    case "sendMessage":
      try {
        const userMessage: ChatMessage = {
          role: "user",
          content: message.text
        };

        conversationHistory.push(userMessage);
        
        // Save user message to history
        await chatHistoryManager.addMessage(currentConversationId, userMessage);

        // Prepare the messages for the chat API
        let messagesToSend = conversationHistory.map(msg => ({
          role: msg.role,
          content: msg.content
        }));

        // RAG enhancement: Search knowledge base and augment the latest user message
        if (message.useRAG && knowledgeBaseManager) {
          try {
            // Check if knowledge base path is configured
            const config = vscode.workspace.getConfiguration("localseek");
            const knowledgeBasePath = config.get("rag.knowledgeBasePath") as string;
            
            if (!knowledgeBasePath || knowledgeBasePath.trim() === "") {
              webview.webview.postMessage({
                command: 'showWarningMessage',
                text: 'Knowledge base path not configured. Please set "Knowledge Base Path" in settings to use RAG.'
              });
            } else {
              const isIndexed = await knowledgeBaseManager.isKnowledgeBaseIndexed();
              if (!isIndexed) {
                webview.webview.postMessage({
                  command: 'showWarningMessage',
                  text: 'Knowledge base not indexed. Please run "LocalSeek: Index Knowledge Base" command first.'
                });
              } else {
                const searchResults = await knowledgeBaseManager.search(message.text);
                if (searchResults && searchResults.length > 0) {
                  // Create an augmented version of the user's message with context
                  const context = searchResults.map(result => 
                    `**Source: ${result.metadata.source}**\n${result.content}`
                  ).join('\n\n---\n\n');
                  
                  const augmentedContent = `Context from knowledge base:\n\n${context}\n\n---\n\nUser Query: ${message.text}`;
                  
                  // Replace the last message (user's query) with the augmented version
                  messagesToSend[messagesToSend.length - 1] = {
                    role: "user",
                    content: augmentedContent
                  };
                  
                  // Optionally show a subtle indicator that RAG was used
                  webview.webview.postMessage({
                    command: "showInformationMessage",
                    text: `Enhanced with context from knowledge base.`
                  });
                }
              }
            }
          } catch (error) {
            console.warn('RAG search failed, continuing without context:', error);
            // Continue without RAG enhancement - don't break the chat functionality
          }
        }

        const response = await ollama.chat({
          model: message.model,
          messages: messagesToSend,
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
          const assistantMessage: ChatMessage = {
            role: "assistant",
            content: fullResponse
          };

          conversationHistory.push(assistantMessage);
          
          // Save assistant message to history
          await chatHistoryManager.addMessage(currentConversationId, assistantMessage);
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

    case "newChat":
      const newConversationId = chatHistoryManager.startNewConversation();
      setConversationId(newConversationId);
      conversationHistory.length = 0; // Clear current conversation
      webview.webview.postMessage({
        command: "clearChat"
      });
      break;

    case "getChatHistory":
      const conversations = chatHistoryManager.getAllConversations();
      webview.webview.postMessage({
        command: "chatHistoryList",
        conversations: conversations.map(conv => ({
          id: conv.id,
          title: conv.title,
          lastModified: chatHistoryManager.formatRelativeTime(conv.lastModified),
          messageCount: conv.messageCount
        }))
      });
      break;

    case "loadConversation":
      const conversation = chatHistoryManager.getConversation(message.conversationId);
      if (conversation) {
        setConversationId(message.conversationId);
        chatHistoryManager.setCurrentConversation(message.conversationId);
        conversationHistory.splice(0, conversationHistory.length, ...conversation.messages);
        
        webview.webview.postMessage({
          command: "loadConversationMessages",
          messages: conversation.messages
        });
      }
      break;

    case "deleteConversation":
      await chatHistoryManager.deleteConversation(message.conversationId);
      // Refresh the history list
      const updatedConversations = chatHistoryManager.getAllConversations();
      webview.webview.postMessage({
        command: "chatHistoryList",
        conversations: updatedConversations.map(conv => ({
          id: conv.id,
          title: conv.title,
          lastModified: chatHistoryManager.formatRelativeTime(conv.lastModified),
          messageCount: conv.messageCount
        }))
      });
      break;

    case "insertCodeToEditor":
      try {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage("No active editor found");
          return;
        }

        const selection = editor.selection;
        const codeToInsert = message.code;
        
        await editor.edit(editBuilder => {
          if (selection.isEmpty) {
            // Insert at cursor position
            editBuilder.insert(selection.active, codeToInsert);
          } else {
            // Replace selected text
            editBuilder.replace(selection, codeToInsert);
          }
        });

        // Position cursor at the end of inserted text
        const insertedLines = codeToInsert.split('\n');
        const newLine = selection.active.line + insertedLines.length - 1;
        const newCharacter = insertedLines.length > 1 
          ? insertedLines[insertedLines.length - 1].length
          : selection.active.character + codeToInsert.length;
        
        const newPosition = new vscode.Position(newLine, newCharacter);
        editor.selection = new vscode.Selection(newPosition, newPosition);
        editor.revealRange(new vscode.Range(newPosition, newPosition));
        
        vscode.window.showInformationMessage("Code inserted into editor");
      } catch (error) {
        vscode.window.showErrorMessage("Failed to insert code into editor");
      }
      break;

    case "getModels":
      await postModelsList(webview, ollama);
      break;

    case "downloadModel":
      try {
        const modelName = message.model?.trim();
        if (!modelName) {
          webview.webview.postMessage({ command: "ollamaError", error: "Please enter a model name." });
          break;
        }
        const stream = await ollama.pull({ model: modelName, stream: true });
        for await (const part of stream as any) {
          const total = part.total || part.total_size || 0;
          const completed = part.completed || part.completed_size || 0;
          const status = part.status || "downloading";
          const percent = total > 0 ? Math.floor((completed / total) * 100) : undefined;
          webview.webview.postMessage({
            command: "downloadProgress",
            model: modelName,
            status,
            total,
            completed,
            percent,
          });
        }
        webview.webview.postMessage({ command: "downloadComplete", model: modelName });
        await postModelsList(webview, ollama);
      } catch (err: any) {
        const msg = err?.message || "Failed to download model";
        webview.webview.postMessage({ command: "ollamaError", error: msg });
      }
      break;

    case "deleteModel":
      try {
        const modelName = message.model?.trim();
        if (!modelName) {
          webview.webview.postMessage({ command: "ollamaError", error: "No model specified." });
          break;
        }
        await ollama.delete({ model: modelName });
        await postModelsList(webview, ollama);
      } catch (err: any) {
        const msg = err?.message || "Failed to delete model";
        webview.webview.postMessage({ command: "ollamaError", error: msg });
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
            display: inline-block;
            text-decoration: none;
            background: linear-gradient(270deg, #6366f1, #10b981, #6366f1);
            background-size: 200% 200%;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            animation: gradientMove 5s ease infinite;
        }

        @keyframes gradientMove {
            0%, 100% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
        }
    </style>
</head>
<body>
    <div class="title">LocalSeek</div>
    <div class="tagline">Seek your answers <i>💯% LOCALLY</i> within VSCode </div>
    
    <div class="error-card">
        <div class="error-icon">⚠️</div>
        <h2>Model Connection Error</h2>
        <p>Please ensure Ollama is running in the background and has models installed.</p>
    </div>
    
    <footer>
        <p>Made with ❤️ by <a href="https://www.hariharen.site" target="_blank">HariHaren</a></p>
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
                --success: rgba(16, 185, 129, 0.9);
                --danger: rgba(239, 68, 68, 0.9);
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
                height: 75vh;
                background: var(--surface);
                border-radius: 1.5rem;
                border: 1px solid var(--border);
                backdrop-filter: blur(20px);
                box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.25);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                position: relative;
                margin-top: 2rem;
            }

            .chat-controls {
                display: flex;
                align-items: center;
                gap: 1rem;
                padding: 1rem;
                border-bottom: 1px solid var(--border);
                background: rgba(0, 0, 0, 0.2);
            }

            .model-selector-container {
                flex: 1;
            }

            #modelSelector {
                font-family: "Inter", "Arial", sans-serif;
                padding: 0.5rem 1rem;
                background: var(--surface);
                border: 1px solid var(--primary);
                border-radius: 0.5rem;
                color: white;
                font-size: 0.875rem;
                appearance: none;
                background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3e%3cpath d='M7 10l5 5 5-5z'/%3e%3c/svg%3e");
                background-repeat: no-repeat;
                background-position: right 0.75rem center;
                background-size: 1rem;
                width: 100%;
                max-width: 200px;
            }

            .chat-buttons {
                display: flex;
                gap: 0.5rem;
            }

            .btn {
                padding: 0.5rem;
                border: none;
                border-radius: 0.5rem;
                font-size: 0.875rem;
                cursor: pointer;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: 500;
                width: 32px;
                height: 32px;
            }

            .btn-primary {
                background: var(--primary);
                color: white;
            }

            .btn-success {
                background: var(--success);
                color: white;
            }

            .btn:hover {
                opacity: 0.9;
                transform: translateY(-1px);
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

            .send-btn {
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
                flex-shrink: 0;
            }

            .send-btn:hover {
                opacity: 0.9;
                transform: translateY(-1px);
            }

            /* Chat History Modal */
            .history-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.8);
                backdrop-filter: blur(4px);
                display: none;
                align-items: center;
                justify-content: center;
                z-index: 1000;
            }

            .history-modal.show {
                display: flex;
            }

            .history-content {
                background: var(--surface);
                border-radius: 1rem;
                border: 1px solid var(--border);
                width: 90%;
                max-width: 600px;
                max-height: 80vh;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }

            .history-header {
                padding: 1.5rem;
                border-bottom: 1px solid var(--border);
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .history-header h2 {
                margin: 0;
                font-size: 1.5rem;
                color: white;
            }

            .close-btn {
                background: none;
                border: none;
                color: rgba(255, 255, 255, 0.7);
                font-size: 1.5rem;
                cursor: pointer;
                padding: 0.5rem;
                border-radius: 0.5rem;
                transition: all 0.2s ease;
            }

            .close-btn:hover {
                background: rgba(255, 255, 255, 0.1);
                color: white;
            }

            .history-list {
                flex: 1;
                overflow-y: auto;
                padding: 1rem;
            }

            .conversation-item {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                padding: 1rem;
                margin-bottom: 0.5rem;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 0.75rem;
                cursor: pointer;
                transition: all 0.2s ease;
                border: 1px solid transparent;
            }

            .conversation-item:hover {
                background: rgba(255, 255, 255, 0.1);
                border-color: var(--primary);
            }

            .conversation-info {
                flex: 1;
            }

            .conversation-title {
                font-weight: 600;
                color: white;
                margin-bottom: 0.5rem;
                line-height: 1.3;
            }

            .conversation-meta {
                display: flex;
                gap: 1rem;
                color: rgba(255, 255, 255, 0.6);
                font-size: 0.875rem;
            }

            .delete-btn {
                background: var(--danger);
                color: white;
                border: none;
                padding: 0.25rem 0.5rem;
                border-radius: 0.375rem;
                cursor: pointer;
                font-size: 0.75rem;
                opacity: 0.8;
                transition: opacity 0.2s ease;
            }

            .delete-btn:hover {
                opacity: 1;
            }

            .empty-history {
                text-align: center;
                padding: 3rem;
                color: rgba(255, 255, 255, 0.6);
            }

            .empty-history h3 {
                margin: 0 0 1rem 0;
                color: rgba(255, 255, 255, 0.8);
            }

            .spinner {
                border: 2px solid rgba(255, 255, 255, 0.2);
                border-left-color: var(--primary);
                border-radius: 50%;
                width: 1rem;
                height: 1rem;
                animation: spin 1s linear infinite;
            }

            @keyframes spin {
                to { transform: rotate(360deg); }
            }

            /* Progress bar */
            .progress {
                width: 100%;
                background: rgba(255,255,255,0.08);
                border: 1px solid var(--border);
                border-radius: 0.5rem;
                height: 10px;
                overflow: hidden;
            }
            .progress-bar {
                height: 100%;
                background: var(--primary);
                width: 0%;
                transition: width 0.2s ease;
            }

            .rag-toggle-container {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                margin-left: 1rem;
            }
            .rag-label {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                font-size: 0.875rem;
                font-weight: 500;
                color: rgba(255, 255, 255, 0.7);
                cursor: pointer;
            }
            .rag-label:hover {
                color: white;
            }
            .switch {
                position: relative;
                display: inline-block;
                width: 34px;
                height: 20px;
            }
            .switch input { 
                opacity: 0;
                width: 0;
                height: 0;
            }
            .slider {
                position: absolute;
                cursor: pointer;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: rgba(255, 255, 255, 0.2);
                transition: .2s;
            }
            .slider:before {
                position: absolute;
                content: "";
                height: 14px;
                width: 14px;
                left: 3px;
                bottom: 3px;
                background-color: white;
                transition: .2s;
            }
            input:checked + .slider {
                background-color: var(--success);
            }
            input:checked + .slider:before {
                transform: translateX(14px);
            }
            .slider.round {
                border-radius: 20px;
            }
            .slider.round:before {
                border-radius: 50%;
            }

            /* Code styling */
            .copy-button, .insert-button {
                position: absolute;
                top: 0.5rem;
                padding: 0.25rem 0.5rem;
                border: none;
                border-radius: 0.375rem;
                color: white;
                font-size: 0.75rem;
                cursor: pointer;
                opacity: 0.8;
                transition: opacity 0.2s ease;
            }

            .copy-button {
                right: 0.5rem;
                background: rgba(99, 102, 241, 0.9);
            }

            .insert-button {
                right: 4rem;
                background: rgba(16, 185, 129, 0.9);
            }

            .copy-button:hover, .insert-button:hover {
                opacity: 1;
            }

            .code-block-wrapper {
                position: relative;
                margin: 1rem 0;
            }

            pre code {
                display: block;
                overflow-x: auto;
                padding: 1em;
                background: rgb(255, 255, 255) !important;
                border-radius: 0.5rem;
                margin: 0.5rem 0;
            }

            /* Scrollbar styling */
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

            @keyframes gradientMove {
                0%, 100% { background-position: 0% 50%; }
                50% { background-position: 100% 50%; }
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
                display: inline-block;
                text-decoration: none;
                background: linear-gradient(270deg, #6366f1, #10b981, #6366f1);
                background-size: 200% 200%;
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                animation: gradientMove 5s ease infinite;
            }

            @media (max-width: 400px) {
                .tagline {
                    font-size: 1rem;
                }

                .input-container {
                    padding: 0.5rem;
                    gap: 0.5rem;
                }

                .chat-controls {
                    flex-direction: column;
                    gap: 0.5rem;
                }

                .model-selector-container {
                    order: 1;
                }

                .chat-buttons {
                    order: 2;
                    justify-content: center;
                }
            }

            @media (min-width: 401px) and (max-width: 600px) {
                .tagline {
                    font-size: 1rem;
                }

                .input-container {
                    padding: 1rem;
                    gap: 0.75rem;
                }

                #modelSelector {
                    max-width: 150px;
                    font-size: 0.8rem;
                }

                .chat-controls {
                    gap: 0.75rem;
                }
            }
        </style>
    </head>
    <body>
        <div class="header">
            <div class="title">LocalSeek</div>
            <div class="tagline">Seek your answers <i>💯% LOCALLY</i> within VSCode</div>
        </div>

        <div class="chat-container">
            <div class="chat-controls">
                <div class="model-selector-container">
                    <select id="modelSelector">
                        ${models
      .map((model) => `<option value="${model}">${model}</option>`)
      .join("")}
                    </select>
                </div>
                <div class="rag-toggle-container">
                    <label for="ragToggle" class="rag-label" title="Use the indexed knowledge base as context for your query.">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0;">
                            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
                        </svg>
                        <span style="white-space: nowrap;">Use RAG</span>
                    </label>
                    <label class="switch">
                        <input type="checkbox" id="ragToggle">
                        <span class="slider round"></span>
                    </label>
                </div>
                <div class="chat-buttons">
                    <button class="btn btn-success" onclick="newChat()" title="New Chat">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 5v14M5 12h14"/>
                        </svg>
                    </button>
                    <button class="btn btn-primary" onclick="showChatHistory()" title="Chat History">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 8v4l3 3M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2s10 4.477 10 10z"/>
                        </svg>
                    </button>
                    <button class="btn btn-primary" onclick="showModelManager()" title="Manage Models">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 7l9-5 9 5-9 5-9-5z"/>
                            <path d="M3 17l9 5 9-5"/>
                            <path d="M3 12l9 5 9-5"/>
                        </svg>
                    </button>
                </div>
            </div>
            
            <div id="chatHistory"></div>
            
            <div class="input-container">
                <textarea id="userInput" placeholder="Ask me anything..." rows="1"></textarea>
                <button class="send-btn" onclick="sendMessage()">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
                    </svg>
                    <span>Send</span>
                </button>
            </div>
        </div>

        <!-- Chat History Modal -->
        <div class="history-modal" id="historyModal">
            <div class="history-content">
                <div class="history-header">
                    <h2>Chat History</h2>
                    <button class="close-btn" onclick="closeChatHistory()">×</button>
                </div>
                <div class="history-list" id="historyList">
                    <div class="empty-history">
                        <h3>No conversations yet</h3>
                        <p>Start chatting to see your conversation history here!</p>
                    </div>
                </div>
            </div>
        </div>

        <!-- Model Management Modal -->
        <div class="history-modal" id="modelsModal">
            <div class="history-content">
                <div class="history-header">
                    <h2>Model Management</h2>
                    <button class="close-btn" onclick="closeModelManager()">×</button>
                </div>
                <div style="padding: 1rem; border-bottom: 1px solid var(--border); display: flex; gap: 0.5rem; align-items: center;">
                    <input id="modelInput" type="text" placeholder="e.g., gpt-oss, deepseek-r1, qwen3, llama3, mistral..." style="flex:1; padding: 0.5rem 0.75rem; background: rgba(255,255,255,0.05); border: 1px solid var(--border); border-radius: 0.5rem; color: white;" />
                    <button class="btn btn-success" style="width:auto; height: auto; padding: 0.5rem 0.75rem;" onclick="startDownload()">Download</button>
                </div>
                <div class="history-list" id="modelsList">
                    <div class="empty-history">
                        <h3>No models found</h3>
                        <p>Connect to Ollama or download a model to get started.</p>
                    </div>
                </div>
            </div>
        </div>

        <footer>
            <p>Made with ❤️ by <a href="https://www.hariharen.site" target="_blank">HariHaren</a></p>
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
                const ragToggle = document.getElementById('ragToggle');
                const chatHistory = document.getElementById('chatHistory');
                const userMessage = input.value.trim();
                
                if (!userMessage) return;

                // Add user message
                chatHistory.innerHTML += \`
                    <div class="message user">
                        \${userMessage}
                    </div>
                \`;

                // Add loading indicator
                chatHistory.innerHTML += \`
                    <div class="message assistant" id="loading-indicator">
                        <div class="spinner"></div>
                    </div>
                \`;

                // Send to extension
                vscode.postMessage({
                    command: 'sendMessage',
                    text: userMessage,
                    model: modelSelector.value,
                    useRAG: ragToggle.checked
                });

                input.value = '';
                chatHistory.scrollTop = chatHistory.scrollHeight;
                isProcessingResponse = true;
            }

            function newChat() {
                vscode.postMessage({
                    command: 'newChat'
                });
            }

            function showChatHistory() {
                vscode.postMessage({
                    command: 'getChatHistory'
                });
            }

            function showModelManager() {
                vscode.postMessage({ command: 'getModels' });
                document.getElementById('modelsModal').classList.add('show');
            }

            function closeModelManager() {
                document.getElementById('modelsModal').classList.remove('show');
            }

            function closeChatHistory() {
                document.getElementById('historyModal').classList.remove('show');
            }

            function loadConversation(conversationId) {
                vscode.postMessage({
                    command: 'loadConversation',
                    conversationId: conversationId
                });
                closeChatHistory();
            }

            function deleteConversation(event, conversationId) {
                event.stopPropagation();
                vscode.postMessage({
                    command: 'deleteConversation',
                    conversationId: conversationId
                });
            }

            // Input handlers
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

            function formatBytes(bytes) {
                if (!bytes && bytes !== 0) return '—';
                const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
                if (bytes === 0) return '0 B';
                const i = Math.floor(Math.log(bytes) / Math.log(1024));
                return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
            }

            function renderModels(models) {
                const list = document.getElementById('modelsList');
                if (!models || models.length === 0) {
                    list.innerHTML = \`
                        \u003cdiv class="empty-history"\u003e
                            \u003ch3\u003eNo models found\u003c/h3\u003e
                            \u003cp\u003eConnect to Ollama or download a model to get started.\u003c/p\u003e
                        \u003c/div\u003e\`;
                    updateModelSelector([]);
                    return;
                }
                list.innerHTML = models.map(m => {
                    const dateStr = m.modifiedAt ? new Date(m.modifiedAt).toLocaleString() : '—';
                    const sizeStr = formatBytes(m.size);
                    return \`
                        \u003cdiv class="conversation-item"\u003e
                            \u003cdiv class="conversation-info"\u003e
                                \u003cdiv class="conversation-title"\u003e\${m.name}\u003c/div\u003e
                                \u003cdiv class="conversation-meta"\u003e
                                    \u003cspan\u003eSize: \${sizeStr}\u003c/span\u003e
                                    \u003cspan\u003eModified: \${dateStr}\u003c/span\u003e
                                \u003c/div\u003e
                                \u003cdiv class="progress" id="progress-\${CSS.escape(m.name)}" style="display:none; margin-top: 0.5rem;"\u003e
                                    \u003cdiv class="progress-bar" id="progress-bar-\${CSS.escape(m.name)}"\u003e\u003c/div\u003e
                                \u003c/div\u003e
                                \u003cdiv id="progress-status-\${CSS.escape(m.name)}" style="font-size: 0.8rem; color: rgba(255,255,255,0.7); margin-top: 0.25rem;"\u003e\u003c/div\u003e
                            \u003c/div\u003e
                            \u003cbutton class="delete-btn" onclick="removeModel('\${m.name.replace(/'/g, "\\\'")}')"\u003eRemove\u003c/button\u003e
                        \u003c/div\u003e\`;
                }).join('');
                // Update model selector options
                updateModelSelector(models.map(m => m.name));
            }

            function updateModelSelector(modelNames) {
                const selector = document.getElementById('modelSelector');
                if (!selector) return;
                selector.innerHTML = (modelNames || []).map(name => \`\u003coption value="\${name}"\u003e\${name}\u003c/option\u003e\`).join('');
            }

            function startDownload() {
                const input = document.getElementById('modelInput');
                const name = input.value.trim();
                if (!name) return;
                vscode.postMessage({ command: 'downloadModel', model: name });
                // Show a progress row even if not in the list yet
                const list = document.getElementById('modelsList');
                const idSafe = name.replace(/[^a-zA-Z0-9_.:-]/g, '_');
                const existing = document.getElementById('progress-' + idSafe);
                if (!existing) {
                    list.innerHTML = \`
                        \u003cdiv class="conversation-item"\u003e
                            \u003cdiv class="conversation-info"\u003e
                                \u003cdiv class="conversation-title"\u003e\${name}\u003c/div\u003e
                                \u003cdiv class="progress" id="progress-\${idSafe}" style="display:block; margin-top: 0.5rem;"\u003e
                                    \u003cdiv class="progress-bar" id="progress-bar-\${idSafe}"\u003e\u003c/div\u003e
                                \u003c/div\u003e
                                \u003cdiv id="progress-status-\${idSafe}" style="font-size: 0.8rem; color: rgba(255,255,255,0.7); margin-top: 0.25rem;"\u003eStarting download…\u003c/div\u003e
                            \u003c/div\u003e
                        \u003c/div\u003e\` + list.innerHTML;
                }
            }

            function removeModel(name) {
                vscode.postMessage({ command: 'deleteModel', model: name });
            }

            // Message handling
            window.addEventListener('message', async (event) => {
                const message = event.data;
                const chatHistory = document.getElementById('chatHistory');
                const historyModal = document.getElementById('historyModal');
                const historyList = document.getElementById('historyList');

                try {
                    switch (message.command) {
                        case 'appendResponseChunk':
                            const loadingIndicator = document.getElementById('loading-indicator');
                            if (loadingIndicator) {
                                loadingIndicator.remove();
                            }

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
                            tempContent.textContent += message.text;

                            // Auto-scroll
                            const isNearBottom = chatHistory.scrollHeight - chatHistory.clientHeight <= chatHistory.scrollTop + 100;
                            if (isNearBottom) {
                                chatHistory.scrollTop = chatHistory.scrollHeight;
                            }

                            if (message.isComplete) {
                                const finalText = tempContent.textContent;
                                const parsedHtml = marked.parse(finalText);
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
                                        
                                        const insertButton = document.createElement('button');
                                        insertButton.className = 'insert-button';
                                        insertButton.textContent = 'Insert';
                                        insertButton.onclick = () => insertCodeToEditor(codeBlock.textContent);
                                        
                                        codeBlock.parentNode.insertBefore(wrapper, codeBlock);
                                        wrapper.appendChild(codeBlock);
                                        wrapper.appendChild(insertButton);
                                        wrapper.appendChild(copyButton);

                                        hljs.highlightElement(codeBlock);
                                    });

                                currentAssistantMessageElement.replaceChild(finalContent, tempContent);

                                currentAssistantMessageElement = null;
                                isProcessingResponse = false;
                            }
                            break;

                        case 'clearChat':
                            chatHistory.innerHTML = '';
                            break;

                        case 'chatHistoryList':
                            if (message.conversations && message.conversations.length > 0) {
                                historyList.innerHTML = message.conversations.map(conv => \`
                                    <div class="conversation-item" onclick="loadConversation('\${conv.id}')">
                                        <div class="conversation-info">
                                            <div class="conversation-title">\${conv.title}</div>
                                            <div class="conversation-meta">
                                                <span>\${conv.lastModified}</span>
                                                <span>\${conv.messageCount} message\${conv.messageCount !== 1 ? 's' : ''}</span>
                                            </div>
                                        </div>
                                        <button class="delete-btn" onclick="deleteConversation(event, '\${conv.id}')">Delete</button>
                                    </div>
                                \`).join('');
                            } else {
                                historyList.innerHTML = \`
                                    <div class="empty-history">
                                        <h3>No conversations yet</h3>
                                        <p>Start chatting to see your conversation history here!</p>
                                    </div>
                                \`;
                            }
                            historyModal.classList.add('show');
                            break;

                        case 'loadConversationMessages':
                            chatHistory.innerHTML = '';
                            message.messages.forEach(msg => {
                                const messageDiv = document.createElement('div');
                                messageDiv.className = \`message \${msg.role}\`;
                                
                                if (msg.role === 'assistant') {
                                    messageDiv.innerHTML = marked.parse(msg.content);
                                    // Process code blocks
                                    messageDiv.querySelectorAll('pre code').forEach(codeBlock => {
                                        const wrapper = document.createElement('div');
                                        wrapper.className = 'code-block-wrapper';
                                        
                                        const copyButton = document.createElement('button');
                                        copyButton.className = 'copy-button';
                                        copyButton.textContent = 'Copy';
                                        copyButton.onclick = () => copyCodeToClipboard(codeBlock.textContent);
                                        
                                        const insertButton = document.createElement('button');
                                        insertButton.className = 'insert-button';
                                        insertButton.textContent = 'Insert';
                                        insertButton.onclick = () => insertCodeToEditor(codeBlock.textContent);
                                        
                                        codeBlock.parentNode.insertBefore(wrapper, codeBlock);
                                        wrapper.appendChild(codeBlock);
                                        wrapper.appendChild(insertButton);
                                        wrapper.appendChild(copyButton);

                                        hljs.highlightElement(codeBlock);
                                    });
                                } else {
                                    messageDiv.textContent = msg.content;
                                }
                                
                                chatHistory.appendChild(messageDiv);
                            });
                            chatHistory.scrollTop = chatHistory.scrollHeight;
                            break;

                        case 'insertTextAtCursor':
                            const input = document.getElementById('userInput');
                            const currentValue = input.value;
                            const cursorPos = input.selectionStart;
                            const textToInsert = message.text;
                            
                            // Insert text at cursor position
                            const newValue = currentValue.slice(0, cursorPos) + textToInsert + currentValue.slice(input.selectionEnd);
                            input.value = newValue;
                            
                            // Set cursor position after inserted text
                            input.focus();
                            input.setSelectionRange(cursorPos + textToInsert.length, cursorPos + textToInsert.length);
                            
                            // Update textarea height
                            input.style.height = 'auto';
                            input.style.height = (input.scrollHeight) + 'px';
                            
                            // Scroll chat into view if needed
                            input.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                            break;

                        case 'modelsList':
                            renderModels(message.models || []);
                            break;

                        case 'downloadProgress': {
                            const name = message.model;
                            const idSafe = name.replace(/[^a-zA-Z0-9_.:-]/g, '_');
                            const bar = document.getElementById('progress-bar-' + idSafe);
                            const wrap = document.getElementById('progress-' + idSafe);
                            const statusEl = document.getElementById('progress-status-' + idSafe);
                            if (wrap) wrap.style.display = 'block';
                            if (bar && typeof message.percent === 'number') {
                                bar.style.width = message.percent + '%';
                            }
                            if (statusEl) {
                                const totalStr = typeof message.total === 'number' ? \` of \${formatBytes(message.total)}\` : '';
                                const compStr = typeof message.completed === 'number' ? \`\${formatBytes(message.completed)}\` : '';
                                const pctStr = typeof message.percent === 'number' ? \` (\${message.percent}%)\` : '';
                                statusEl.textContent = \`\${message.status || 'downloading'}: \${compStr}\${totalStr}\${pctStr}\`;
                            }
                            break;
                        }

                        case 'downloadComplete':
                            // No-op here; modelsList will follow and refresh UI
                            break;

                        case 'ollamaError':
                            vscode.postMessage({ command: 'showErrorMessage', text: message.error });
                            break;
                    }
                } catch (error) {
                    console.error('Error handling message:', error);
                    isProcessingResponse = false;
                }
            });

            function copyCodeToClipboard(code) {
                navigator.clipboard.writeText(code).then(() => {
                    vscode.postMessage({
                        command: 'showInformationMessage',
                        text: 'Code copied to clipboard!'
                    });
                });
            }

            function insertCodeToEditor(code) {
                vscode.postMessage({
                    command: 'insertCodeToEditor',
                    code: code
                });
            }

            // Close modal when clicking outside
            document.getElementById('historyModal').addEventListener('click', (e) => {
                if (e.target === document.getElementById('historyModal')) {
                    closeChatHistory();
                }
            });
            document.getElementById('modelsModal').addEventListener('click', (e) => {
                if (e.target === document.getElementById('modelsModal')) {
                    closeModelManager();
                }
            });

            // Fetch models initially to populate selector
            vscode.postMessage({ command: 'getModels' });
        </script>
    </body>
    </html>
    `;
}

export function deactivate() {
  // No resources to clean up
}
