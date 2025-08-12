import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";

export interface SearchResult {
  content: string;
  metadata: {
    source: string;
  };
}

interface KnowledgeBase {
  content: string;
  lastUpdated: string;
  knowledgeBasePath: string;
}

export class KnowledgeBaseManager {
  constructor(private context: vscode.ExtensionContext) {
    // Simple knowledge base - no complex processing needed
  }

  private getKnowledgeBasePath(): string {
    const config = vscode.workspace.getConfiguration("localseek.rag");
    return config.get("knowledgeBasePath", "");
  }

  private getKnowledgeBaseStoragePath(): vscode.Uri {
    const knowledgeBasePath = this.getKnowledgeBasePath();
    const pathHash = crypto.createHash('md5').update(knowledgeBasePath).digest('hex');
    return vscode.Uri.joinPath(this.context.globalStorageUri, `knowledge_base_${pathHash}.json`);
  }

  private async loadKnowledgeBase(): Promise<KnowledgeBase | null> {
    try {
      const dbPath = this.getKnowledgeBaseStoragePath();
      const data = await vscode.workspace.fs.readFile(dbPath);
      return JSON.parse(data.toString());
    } catch {
      return null;
    }
  }

  private async saveKnowledgeBase(kb: KnowledgeBase): Promise<void> {
    try {
      await vscode.workspace.fs.stat(this.context.globalStorageUri);
    } catch {
      await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
    }
    
    const dbPath = this.getKnowledgeBaseStoragePath();
    const data = Buffer.from(JSON.stringify(kb, null, 2));
    await vscode.workspace.fs.writeFile(dbPath, data);
  }

  private async readFileContent(fileUri: vscode.Uri): Promise<string> {
    try {
      const content = await vscode.workspace.fs.readFile(fileUri);
      return content.toString();
    } catch (error) {
      console.error(`Error reading file ${fileUri.fsPath}:`, error);
      return "";
    }
  }

  private async getAllFiles(dirUri: vscode.Uri): Promise<vscode.Uri[]> {
    const files: vscode.Uri[] = [];
    const supportedExtensions = ['.md', '.txt', '.js', '.ts', '.py', '.java', '.cpp', '.c', '.h', '.css', '.html', '.json', '.xml', '.yml', '.yaml'
];

    async function traverse(currentUri: vscode.Uri): Promise<void> {
      try {
        const entries = await vscode.workspace.fs.readDirectory(currentUri);
        
        for (const [name, type] of entries) {
          const childUri = vscode.Uri.joinPath(currentUri, name);
          
          if (type === vscode.FileType.Directory) {
            // Skip hidden directories and common ignore patterns
            if (!name.startsWith('.') && name !== 'node_modules' && name !== '__pycache__') {
              await traverse(childUri);
            }
          } else if (type === vscode.FileType.File) {
            const ext = path.extname(name).toLowerCase();
            if (supportedExtensions.includes(ext)) {
              files.push(childUri);
            }
          }
        }
      } catch (error) {
        console.error(`Error traversing directory ${currentUri.fsPath}:`, error);
      }
    }

    await traverse(dirUri);
    return files;
  }

  public async indexKnowledgeBase(): Promise<void> {
    const knowledgeBasePath = this.getKnowledgeBasePath();
    
    if (!knowledgeBasePath) {
      throw new Error("Knowledge base path is not configured. Please set 'localseek.rag.knowledgeBasePath' in settings.");
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Indexing Knowledge Base",
        cancellable: false,
      },
      async (progress) => {
        try {
          progress.report({ message: "Initializing..." });

          const knowledgeBaseUri = vscode.Uri.file(knowledgeBasePath);
          
          // Check if the path exists
          try {
            await vscode.workspace.fs.stat(knowledgeBaseUri);
          } catch {
            throw new Error(`Knowledge base path does not exist: ${knowledgeBasePath}`);
          }

          progress.report({ message: "Scanning files..." });
          const files = await this.getAllFiles(knowledgeBaseUri);
          
          if (files.length === 0) {
            throw new Error("No supported files found in the knowledge base directory.");
          }

          progress.report({ message: `Reading ${files.length} files...` });

          let allContent = "";
          
          // Read all files and combine content
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            progress.report({ 
              message: `Reading file ${i + 1}/${files.length}: ${path.basename(file.fsPath)}`,
              increment: (100 / files.length)
            });

            const content = await this.readFileContent(file);
            if (content.trim()) {
              const fileName = path.relative(knowledgeBasePath, file.fsPath);
              allContent += `\n\n--- ${fileName} ---\n${content}`;
            }
          }

          if (!allContent.trim()) {
            throw new Error("No valid content found in the knowledge base files.");
          }

          progress.report({ message: "Saving knowledge base..." });

          // Create and save the knowledge base
          const kb: KnowledgeBase = {
            content: allContent.trim(),
            lastUpdated: new Date().toISOString(),
            knowledgeBasePath,
          };

          await this.saveKnowledgeBase(kb);

          progress.report({ message: "Indexing complete!" });
          
          vscode.window.showInformationMessage(
            `Successfully indexed ${files.length} files into knowledge base.`
          );

        } catch (error) {
          console.error("Error during indexing:", error);
          vscode.window.showErrorMessage(`Failed to index knowledge base: ${error}`);
          throw error;
        }
      }
    );
  }

  public async search(query: string): Promise<SearchResult[]> {
    try {
      const knowledgeBasePath = this.getKnowledgeBasePath();
      if (!knowledgeBasePath) {
        return [];
      }

      const kb = await this.loadKnowledgeBase();
      if (!kb || !kb.content) {
        return [];
      }

      // Simple search - just return the entire knowledge base content as context
      return [{
        content: kb.content,
        metadata: {
          source: "Knowledge Base"
        }
      }];

    } catch (error) {
      console.error("Error during search:", error);
      return [];
    }
  }

  public async isKnowledgeBaseIndexed(): Promise<boolean> {
    try {
      const knowledgeBasePath = this.getKnowledgeBasePath();
      if (!knowledgeBasePath) {
        return false;
      }

      const kb = await this.loadKnowledgeBase();
      return kb !== null && kb.content !== undefined && kb.content.length > 0;
    } catch {
      return false;
    }
  }

  public async getIndexStats(): Promise<{ totalFiles: number; contentLength: number } | null> {
    try {
      const knowledgeBasePath = this.getKnowledgeBasePath();
      if (!knowledgeBasePath) {
        return null;
      }

      const kb = await this.loadKnowledgeBase();
      if (!kb || !kb.content) {
        return null;
      }
      
      // Count files by counting "--- filename ---" markers
      const fileCount = (kb.content.match(/--- .+ ---/g) || []).length;
      
      return {
        totalFiles: fileCount,
        contentLength: kb.content.length,
      };
    } catch {
      return null;
    }
  }
}
