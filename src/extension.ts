import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import ignore from "ignore";
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
  const knowledgeBaseManager = new KnowledgeBaseManager(context, ollama);

  // Track pending apply operations so "Accept" knows what to write
  let pendingApply: {
    originalUri: vscode.Uri;
    tempFileUri: vscode.Uri;
  } | undefined;

  function setPendingApply(pending: typeof pendingApply) {
    pendingApply = pending;
    vscode.commands.executeCommand('setContext', 'localseek.diffViewActive', !!pending);
  }

  // Accept command – reads the (possibly user-edited) temp file and writes to the original
  context.subscriptions.push(
    vscode.commands.registerCommand("localseek.acceptApply", async () => {
      if (!pendingApply) {
        vscode.window.showWarningMessage("No pending code apply to accept.");
        return;
      }

      const { originalUri, tempFileUri } = pendingApply;

      try {
        // Read the temp file (user may have edited it in the diff view)
        const proposedDoc = await vscode.workspace.openTextDocument(tempFileUri);
        const finalContent = proposedDoc.getText();

        // Close the diff tab without triggering a save prompt
        await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");

        // Write to the original file
        const edit = new vscode.WorkspaceEdit();
        const originalDoc = await vscode.workspace.openTextDocument(originalUri);
        const fullRange = new vscode.Range(
          originalDoc.positionAt(0),
          originalDoc.positionAt(originalDoc.getText().length)
        );
        edit.replace(originalUri, fullRange, finalContent);
        await vscode.workspace.applyEdit(edit);

        // Clean up temp file
        try { await vscode.workspace.fs.delete(tempFileUri); } catch {}
        setPendingApply(undefined);

        vscode.window.showInformationMessage("Changes applied successfully.");
      } catch (error) {
        vscode.window.showErrorMessage("Failed to apply changes.");
      }
    })
  );

  // Discard command – closes the diff without applying
  context.subscriptions.push(
    vscode.commands.registerCommand("localseek.discardApply", async () => {
      if (pendingApply) {
        try { await vscode.workspace.fs.delete(pendingApply.tempFileUri); } catch {}
        setPendingApply(undefined);
      }
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    })
  );

  let currentPanel: vscode.WebviewPanel | undefined;
  let sidebarWebviewView: vscode.WebviewView | undefined;

  context.subscriptions.push(
    vscode.commands.registerCommand("localseek.openChat", async () => {
      if (currentPanel) {
        currentPanel.reveal(vscode.ViewColumn.Beside);
        return;
      }

      currentPanel = createWebviewPanel(context);
      setupWebview(currentPanel, context, ollama, chatHistoryManager, knowledgeBaseManager, setPendingApply, () => {
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

  const chatWebviewProvider = new ChatWebviewViewProvider(context, ollama, chatHistoryManager, knowledgeBaseManager, setPendingApply, (view) => {
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
  setPendingApply: (pending: { originalUri: vscode.Uri; tempFileUri: vscode.Uri } | undefined) => void,
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
  
  let currentId = chatHistoryManager.getCurrentConversationId();
  if (!currentId || chatHistoryManager.getConversationHistory(currentId).length === 0) {
    currentId = chatHistoryManager.startNewConversation();
  }
  let currentConversationId: string = currentId;
  let conversationHistory: ChatMessage[] = [...chatHistoryManager.getConversationHistory(currentConversationId)];

  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === "webviewReady") {
      if (conversationHistory.length > 0) {
        panel.webview.postMessage({
          command: "loadConversationMessages",
          messages: conversationHistory
        });
      }
    }
    await handleMessage(message, panel, conversationHistory, ollama, chatHistoryManager, currentConversationId, (newId) => {
      currentConversationId = newId;
    }, knowledgeBaseManager, context, setPendingApply);
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
    private readonly setPendingApply: (pending: { originalUri: vscode.Uri; tempFileUri: vscode.Uri } | undefined) => void,
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

    let currentId = this.chatHistoryManager.getCurrentConversationId();
    if (!currentId || this.chatHistoryManager.getConversationHistory(currentId).length === 0) {
      currentId = this.chatHistoryManager.startNewConversation();
    }
    let currentConversationId: string = currentId;
    let conversationHistory: ChatMessage[] = [...this.chatHistoryManager.getConversationHistory(currentConversationId)];

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.command === "webviewReady") {
        if (conversationHistory.length > 0) {
          webviewView.webview.postMessage({
            command: "loadConversationMessages",
            messages: conversationHistory
          });
        }
      }
      await handleMessage(message, webviewView, conversationHistory, this.ollama, this.chatHistoryManager, currentConversationId, (newId) => {
        currentConversationId = newId;
      }, this.knowledgeBaseManager, this.context, this.setPendingApply);
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
  knowledgeBaseManager?: KnowledgeBaseManager,
  extensionContext?: vscode.ExtensionContext,
  setPendingApply?: (pending: { originalUri: vscode.Uri; tempFileUri: vscode.Uri } | undefined) => void
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

        // Handle attached files
        if (message.attachedFiles && message.attachedFiles.length > 0) {
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          if (workspaceFolder) {
            let attachedContent = "Here are the contents of the attached files for context:\n\n";
            for (const file of message.attachedFiles) {
              try {
                const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, file.path);
                const content = await vscode.workspace.fs.readFile(fileUri);
                attachedContent += `--- ${file.path} ---\n${content.toString()}\n\n`;
              } catch (err) {
                console.error(`Failed to read attached file: ${file.path}`, err);
              }
            }
            
            // Prepend the attached files content to the latest user message
            const lastMsg = messagesToSend[messagesToSend.length - 1];
            if (lastMsg && lastMsg.role === 'user') {
              lastMsg.content = `${attachedContent}\nUser Query: ${lastMsg.content}`;
            }
          }
        }

        // RAG enhancement: Search knowledge base and augment the latest user message
        if (message.useRAG && knowledgeBaseManager) {
          try {
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
        webview.webview.postMessage({
          command: "appendResponseChunk",
          text: "Error generating response. Please check your Ollama connection.",
          isComplete: true,
        });
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

    case "applyCodeToEditor":
      try {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage(
            "No active editor found. Open a file first to apply code."
          );
          return;
        }

        if (!extensionContext || !setPendingApply) {
          vscode.window.showWarningMessage("Apply feature is not available.");
          return;
        }

        const originalUri = editor.document.uri;
        const originalContent = editor.document.getText();
        const selection = editor.selection;
        const codeToApply = message.code;

        // Build the proposed content: insert at cursor or replace selection
        let proposedContent: string;
        if (selection.isEmpty) {
          const offset = editor.document.offsetAt(selection.active);
          proposedContent =
            originalContent.substring(0, offset) +
            codeToApply +
            originalContent.substring(offset);
        } else {
          const startOffset = editor.document.offsetAt(selection.start);
          const endOffset = editor.document.offsetAt(selection.end);
          proposedContent =
            originalContent.substring(0, startOffset) +
            codeToApply +
            originalContent.substring(endOffset);
        }

        // Write proposed content to a temp file in extension storage (editable!)
        const timestamp = Date.now();
        const fileName = path.basename(editor.document.fileName);
        const ext = path.extname(fileName);
        const baseName = path.basename(fileName, ext);
        const tempFileName = `${baseName}.localseek-proposed-${timestamp}${ext}`;

        // Ensure storage directory exists
        try {
          await vscode.workspace.fs.stat(extensionContext.globalStorageUri);
        } catch {
          await vscode.workspace.fs.createDirectory(extensionContext.globalStorageUri);
        }

        const tempFileUri = vscode.Uri.joinPath(extensionContext.globalStorageUri, tempFileName);
        await vscode.workspace.fs.writeFile(tempFileUri, Buffer.from(proposedContent));

        // Store pending apply for the accept/discard commands
        setPendingApply({ originalUri, tempFileUri });

        // Open the diff view — Accept/Discard buttons appear in the editor title bar
        await vscode.commands.executeCommand(
          "vscode.diff",
          originalUri,
          tempFileUri,
          `${fileName}: Review LocalSeek's Proposed Changes`
        );
      } catch (error) {
        vscode.window.showErrorMessage("Failed to open diff view for code.");
      }
      break;

    case "getWorkspaceFiles":
      try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
          const files = await vscode.workspace.findFiles('**/*', '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/.next/**}');
          let filePaths = files.map(f => vscode.workspace.asRelativePath(f, false));

          // Try to apply .gitignore if it exists
          try {
            const gitignorePath = vscode.Uri.joinPath(workspaceFolder.uri, '.gitignore').fsPath;
            if (fs.existsSync(gitignorePath)) {
              const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
              const ig = ignore().add(gitignoreContent);
              filePaths = ig.filter(filePaths);
            }
          } catch (err) {
            console.warn("Failed to parse .gitignore", err);
          }

          webview.webview.postMessage({
            command: 'workspaceFiles',
            files: filePaths
          });
        }
      } catch (error) {
        console.error("Error fetching workspace files:", error);
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
