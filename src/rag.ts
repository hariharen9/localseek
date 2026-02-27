import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import { Ollama } from "ollama";
import * as fs from "fs";
import ignore from "ignore";

export interface SearchResult {
  content: string;
  metadata: {
    source: string;
    score?: number;
  };
}

interface Chunk {
  content: string;
  source: string;
  embedding: number[];
}

interface KnowledgeBase {
  chunks: Chunk[];
  lastUpdated: string;
  knowledgeBasePath: string;
}

export class KnowledgeBaseManager {
  constructor(private context: vscode.ExtensionContext, private ollama: Ollama) {}

  private getKnowledgeBasePath(): string {
    const config = vscode.workspace.getConfiguration("localseek.rag");
    const configuredPath = config.get<string>("knowledgeBasePath", "");
    
    if (configuredPath && configuredPath.trim() !== "") {
      return configuredPath;
    }
    
    // Default to workspace folder if not configured
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      return workspaceFolder.uri.fsPath;
    }
    
    return "";
  }

  private getEmbeddingModel(): string {
    const config = vscode.workspace.getConfiguration("localseek.rag");
    return config.get("embeddingModel", "nomic-embed-text");
  }

  private getChunkSettings(): { size: number; overlap: number } {
    const config = vscode.workspace.getConfiguration("localseek.rag");
    return {
      size: config.get("chunkSize", 1024),
      overlap: config.get("chunkOverlap", 200)
    };
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
    const data = Buffer.from(JSON.stringify(kb));
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

  private async getAllFiles(dirPath: string): Promise<vscode.Uri[]> {
    const files: vscode.Uri[] = [];
    const supportedExtensions = ['.md', '.txt', '.js', '.ts', '.py', '.java', '.cpp', '.c', '.h', '.css', '.html', '.json', '.xml', '.yml', '.yaml'];

    // Try to load .gitignore
    const ig = ignore();
    const gitignorePath = path.join(dirPath, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      try {
        const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
        ig.add(gitignoreContent);
      } catch (err) {
        console.warn("Failed to parse .gitignore", err);
      }
    }
    // Also ignore standard dirs
    ig.add(['.git', 'node_modules', '__pycache__', 'dist', 'out', 'build', '.next']);

    async function traverse(currentPath: string): Promise<void> {
      try {
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(currentPath));
        
        for (const [name, type] of entries) {
          const childPath = path.join(currentPath, name);
          const relativePath = path.relative(dirPath, childPath);
          
          if (ig.ignores(relativePath)) {
            continue;
          }
          
          if (type === vscode.FileType.Directory) {
            await traverse(childPath);
          } else if (type === vscode.FileType.File) {
            const ext = path.extname(name).toLowerCase();
            if (supportedExtensions.includes(ext)) {
              files.push(vscode.Uri.file(childPath));
            }
          }
        }
      } catch (error) {
        console.error(`Error traversing directory ${currentPath}:`, error);
      }
    }

    await traverse(dirPath);
    return files;
  }

  private chunkText(text: string, chunkSize: number, chunkOverlap: number): string[] {
    const chunks: string[] = [];
    if (!text) return chunks;

    // Simple word-boundary chunking
    const words = text.split(/\s+/);
    let currentChunk: string[] = [];
    let currentLength = 0;

    for (const word of words) {
      currentChunk.push(word);
      currentLength += word.length + 1; // +1 for space

      if (currentLength >= chunkSize) {
        chunks.push(currentChunk.join(" "));
        
        // Calculate overlap
        const overlapWords = [];
        let overlapLength = 0;
        for (let i = currentChunk.length - 1; i >= 0; i--) {
          const w = currentChunk[i];
          if (overlapLength + w.length + 1 > chunkOverlap) break;
          overlapWords.unshift(w);
          overlapLength += w.length + 1;
        }
        
        currentChunk = [...overlapWords];
        currentLength = overlapLength;
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(" "));
    }

    return chunks;
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  public async indexKnowledgeBase(): Promise<void> {
    const knowledgeBasePath = this.getKnowledgeBasePath();
    
    if (!knowledgeBasePath) {
      throw new Error("Could not determine knowledge base path. Open a workspace or set 'localseek.rag.knowledgeBasePath' in settings.");
    }

    const embeddingModel = this.getEmbeddingModel();

    // Check if the model exists locally
    try {
      await this.ollama.show({ model: embeddingModel });
    } catch (e) {
      throw new Error(`Embedding model '${embeddingModel}' not found. Please run 'ollama pull ${embeddingModel}' or specify a different model in settings.`);
    }

    const { size: chunkSize, overlap: chunkOverlap } = this.getChunkSettings();

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Indexing Knowledge Base",
        cancellable: true,
      },
      async (progress, token) => {
        try {
          progress.report({ message: "Scanning files..." });
          
          try {
            await vscode.workspace.fs.stat(vscode.Uri.file(knowledgeBasePath));
          } catch {
            throw new Error(`Knowledge base path does not exist: ${knowledgeBasePath}`);
          }

          const files = await this.getAllFiles(knowledgeBasePath);
          
          if (files.length === 0) {
            throw new Error("No supported files found in the knowledge base directory.");
          }

          progress.report({ message: `Chunking ${files.length} files...` });

          const allChunks: Chunk[] = [];
          
          // Phase 1: Chunking
          for (let i = 0; i < files.length; i++) {
            if (token.isCancellationRequested) throw new Error("Indexing cancelled.");
            const file = files[i];
            const content = await this.readFileContent(file);
            if (content.trim()) {
              const fileName = path.relative(knowledgeBasePath, file.fsPath);
              const textChunks = this.chunkText(content, chunkSize, chunkOverlap);
              
              for (const textChunk of textChunks) {
                if (textChunk.trim()) {
                  allChunks.push({
                    content: textChunk,
                    source: fileName,
                    embedding: [] // Will populate in next phase
                  });
                }
              }
            }
          }

          if (allChunks.length === 0) {
            throw new Error("No valid content found to index.");
          }

          // Phase 2: Embedding
          for (let i = 0; i < allChunks.length; i++) {
            if (token.isCancellationRequested) throw new Error("Indexing cancelled.");
            const chunk = allChunks[i];
            
            progress.report({ 
              message: `Generating embeddings ${i + 1}/${allChunks.length}...`,
              increment: (100 / allChunks.length)
            });

            const embedResponse = await this.ollama.embeddings({
              model: embeddingModel,
              prompt: chunk.content
            });
            
            chunk.embedding = embedResponse.embedding;
          }

          progress.report({ message: "Saving knowledge base..." });

          const kb: KnowledgeBase = {
            chunks: allChunks,
            lastUpdated: new Date().toISOString(),
            knowledgeBasePath,
          };

          await this.saveKnowledgeBase(kb);

          progress.report({ message: "Indexing complete!" });
          
          vscode.window.showInformationMessage(
            `Successfully indexed ${files.length} files (${allChunks.length} chunks) using ${embeddingModel}.`
          );

        } catch (error: any) {
          console.error("Error during indexing:", error);
          vscode.window.showErrorMessage(`Failed to index knowledge base: ${error.message || error}`);
          throw error;
        }
      }
    );
  }

  public async search(query: string, topK: number = 3): Promise<SearchResult[]> {
    try {
      const knowledgeBasePath = this.getKnowledgeBasePath();
      if (!knowledgeBasePath) {
        return [];
      }

      const kb = await this.loadKnowledgeBase();
      if (!kb || !kb.chunks || kb.chunks.length === 0) {
        return [];
      }

      const embeddingModel = this.getEmbeddingModel();

      // Get embedding for the query
      const queryEmbedResponse = await this.ollama.embeddings({
        model: embeddingModel,
        prompt: query
      });
      const queryEmbedding = queryEmbedResponse.embedding;

      // Calculate similarities
      const scoredChunks = kb.chunks.map(chunk => ({
        chunk,
        score: this.cosineSimilarity(queryEmbedding, chunk.embedding)
      }));

      // Sort by score descending
      scoredChunks.sort((a, b) => b.score - a.score);

      // Return top K
      return scoredChunks.slice(0, topK).map(sc => ({
        content: sc.chunk.content,
        metadata: {
          source: sc.chunk.source,
          score: sc.score
        }
      }));

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
      return kb !== null && kb.chunks !== undefined && kb.chunks.length > 0;
    } catch {
      return false;
    }
  }

  public async getIndexStats(): Promise<{ totalChunks: number; lastUpdated: string } | null> {
    try {
      const knowledgeBasePath = this.getKnowledgeBasePath();
      if (!knowledgeBasePath) {
        return null;
      }

      const kb = await this.loadKnowledgeBase();
      if (!kb || !kb.chunks) {
        return null;
      }
      
      return {
        totalChunks: kb.chunks.length,
        lastUpdated: kb.lastUpdated,
      };
    } catch {
      return null;
    }
  }
}
