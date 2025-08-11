import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: Date;
}

export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  created: Date;
  lastModified: Date;
  workspaceFolder?: string;
  messageCount: number;
}

export class ChatHistoryManager {
  private static readonly MAX_CONVERSATIONS = 50;
  private static readonly HISTORY_FILE = "localseek-chat-history.json";
  private conversations: Map<string, ChatConversation> = new Map();
  private currentConversationId?: string;
  private storageUri: vscode.Uri;

  constructor(private context: vscode.ExtensionContext) {
    this.storageUri = vscode.Uri.joinPath(
      context.globalStorageUri,
      ChatHistoryManager.HISTORY_FILE
    );
    this.loadHistory();
  }

  private async ensureStorageExists(): Promise<void> {
    try {
      await vscode.workspace.fs.stat(this.context.globalStorageUri);
    } catch {
      await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
    }
  }

  private async loadHistory(): Promise<void> {
    try {
      await this.ensureStorageExists();
      const data = await vscode.workspace.fs.readFile(this.storageUri);
      const historyData = JSON.parse(data.toString());
      
      this.conversations.clear();
      historyData.conversations?.forEach((conv: any) => {
        const conversation: ChatConversation = {
          ...conv,
          created: new Date(conv.created),
          lastModified: new Date(conv.lastModified),
          messages: conv.messages.map((msg: any) => ({
            ...msg,
            timestamp: msg.timestamp ? new Date(msg.timestamp) : undefined
          }))
        };
        this.conversations.set(conversation.id, conversation);
      });
    } catch (error) {
      // File doesn't exist or is corrupted, start fresh
      console.log("No chat history found, starting fresh");
    }
  }

  private async saveHistory(): Promise<void> {
    try {
      await this.ensureStorageExists();
      const historyData = {
        conversations: Array.from(this.conversations.values()).map(conv => ({
          ...conv,
          created: conv.created.toISOString(),
          lastModified: conv.lastModified.toISOString(),
          messages: conv.messages.map(msg => ({
            ...msg,
            timestamp: msg.timestamp?.toISOString()
          }))
        }))
      };
      
      await vscode.workspace.fs.writeFile(
        this.storageUri,
        Buffer.from(JSON.stringify(historyData, null, 2))
      );
    } catch (error) {
      console.error("Failed to save chat history:", error);
    }
  }

  private generateTitle(firstMessage: string): string {
    // Clean and truncate the first message to create a meaningful title
    const cleaned = firstMessage
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    
    if (cleaned.length <= 50) {
      return cleaned;
    }
    
    // Find a good breaking point near 50 characters
    const truncated = cleaned.substring(0, 47);
    const lastSpace = truncated.lastIndexOf(" ");
    
    if (lastSpace > 30) {
      return truncated.substring(0, lastSpace) + "...";
    }
    
    return truncated + "...";
  }

  private getCurrentWorkspaceFolder(): string | undefined {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    return workspaceFolder?.name;
  }

  private generateConversationId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  public startNewConversation(): string {
    this.currentConversationId = this.generateConversationId();
    return this.currentConversationId;
  }

  public getCurrentConversationId(): string | undefined {
    return this.currentConversationId;
  }

  public async addMessage(
    conversationId: string,
    message: ChatMessage
  ): Promise<void> {
    let conversation = this.conversations.get(conversationId);
    
    if (!conversation) {
      // Create new conversation
      const title = message.role === "user" 
        ? this.generateTitle(message.content)
        : "New Conversation";
      
      conversation = {
        id: conversationId,
        title,
        messages: [],
        created: new Date(),
        lastModified: new Date(),
        workspaceFolder: this.getCurrentWorkspaceFolder(),
        messageCount: 0
      };
    }

    conversation.messages.push({
      ...message,
      timestamp: new Date()
    });
    
    conversation.lastModified = new Date();
    conversation.messageCount = conversation.messages.length;
    
    this.conversations.set(conversationId, conversation);
    
    // Maintain max conversation limit
    if (this.conversations.size > ChatHistoryManager.MAX_CONVERSATIONS) {
      const oldestConversation = Array.from(this.conversations.values())
        .sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime())[0];
      this.conversations.delete(oldestConversation.id);
    }
    
    await this.saveHistory();
  }

  public getConversation(conversationId: string): ChatConversation | undefined {
    return this.conversations.get(conversationId);
  }

  public getAllConversations(): ChatConversation[] {
    const currentWorkspace = this.getCurrentWorkspaceFolder();
    return Array.from(this.conversations.values())
      .filter(conv => conv.workspaceFolder === currentWorkspace)
      .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
  }

  public getConversationHistory(conversationId: string): ChatMessage[] {
    const conversation = this.conversations.get(conversationId);
    return conversation?.messages || [];
  }

  public async deleteConversation(conversationId: string): Promise<void> {
    this.conversations.delete(conversationId);
    if (this.currentConversationId === conversationId) {
      this.currentConversationId = undefined;
    }
    await this.saveHistory();
  }

  public async clearAllHistory(): Promise<void> {
    this.conversations.clear();
    this.currentConversationId = undefined;
    await this.saveHistory();
  }

  public setCurrentConversation(conversationId: string): void {
    if (this.conversations.has(conversationId)) {
      this.currentConversationId = conversationId;
    }
  }

  public formatRelativeTime(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor(diff / (1000 * 60));

    if (days > 7) {
      return date.toLocaleDateString();
    } else if (days > 1) {
      return `${days} days ago`;
    } else if (days === 1) {
      return "Yesterday";
    } else if (hours > 1) {
      return `${hours} hours ago`;
    } else if (minutes > 1) {
      return `${minutes} minutes ago`;
    } else {
      return "Just now";
    }
  }
}
