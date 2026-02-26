import * as vscode from "vscode";
import { Ollama } from "ollama";
import { ChatHistoryManager, ChatMessage, ChatConversation } from "./chatHistory";
import { KnowledgeBaseManager } from "./rag";
import { getWebviewContent } from "./webview/HtmlProvider";


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

  panel.webview.html = getWebviewContent(models, context, panel.webview);
  
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
        webviewView.webview.html = getWebviewContent(models, this.context, webviewView.webview);
      })
      .catch((error) => {
        webviewView.webview.html = getWebviewContent([], this.context, webviewView.webview);
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
    case "stopGeneration":
      ollama.abort();
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
        try {
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
        } catch (err: any) {
          if (err.name === 'AbortError') {
            console.log("Generation aborted by user");
          } else {
            throw err;
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

export function deactivate() {
  // No resources to clean up
}
