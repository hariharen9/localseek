# LocalSeek 🔍✨

**Seek your answers 💯% LOCALLY within VSCode**

LocalSeek is a powerful, privacy-first AI chat extension for Visual Studio Code that brings conversational AI directly to your development environment - completely locally. Chat with your code, leverage your knowledge base, and get AI assistance without ever leaving your editor or compromising your privacy.

[🌐 WEBSITE](https://localseek.vercel.app/)

![LocalSeek Logo](./media/LOCALSEEK.png)

---

## 🚀 What You Get

### 🤖 **Local AI Chat**
- Chat with AI models through Ollama without sending your data anywhere
- Choose between sidebar panel or standalone window
- Watch responses stream in real-time with full markdown rendering and syntax highlighting
- Switch between different models instantly

### 📖 **RAG Integration**
- Index your files to give AI context about your project
- Toggle "Use RAG" on/off per query
- AI automatically searches your Knowledge Base to provide relevant, project-specific answers instead of generic responses

### 💻 **Seamless Code Workflow**
- Select any code → right-click → "Send to LocalSeek Chat" for instant context
- AI responds with code? Click "Insert" to put it directly in your editor at cursor position
- Copy code blocks with one click
- All code gets proper syntax highlighting

### 💬 **Smart Conversation Management**
- All chats automatically saved with generated titles
- Resume any previous conversation exactly where you left off
- Browse your chat history with timestamps and message counts
- Clean up conversations you don't need anymore

### 🎛️ **Built-in Model Manager - OLLAMA**
- Download new Ollama models directly from the extension interface
- Watch real-time download progress with detailed status updates
- View model information like size and modification dates
- Remove unused models to free up disk space

### 🎨 **VSCode-Native Interface**
- Dark theme that matches your editor perfectly
- Responsive design that works on any screen size
- Smooth animations and intuitive controls
- Everything feels native to VSCode - no jarring external interfaces

---

## 🚀 Getting Started

### Prerequisites

#### System Requirements
- **Visual Studio Code** (latest version recommended)
- **[Ollama](https://ollama.com/)** installed and running locally
- **Minimum 8GB RAM** (16GB+ recommended for larger models)
- **Available Storage** for AI models (varies by model size)

#### Install Ollama
```bash
# Install Ollama (visit https://ollama.com for platform-specific instructions)
# Then pull some recommended models:
ollama pull gpt-oss            # Best model now
ollama pull deepseek-r1:14b    # Excellent reasoning model
ollama pull llama3.2:latest    # Versatile and reliable
ollama pull phi3:mini          # Lightweight and fast
ollama pull mistral:latest     # Great for coding tasks
ollama pull qwen2.5-coder      # Specialized for code generation
```

### Installation

#### Method 1: VSCode Marketplace (Recommended)
1. Open VSCode
2. Go to Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for "**LocalSeek**"
4. Click "Install"

#### Method 2: Manual Installation
1. Download the latest `.vsix` file from [GitHub Releases](https://github.com/hariharen9/localseek/releases)
2. Open VSCode Extensions view
3. Click the "..." menu → "Install from VSIX"
4. Select the downloaded file

---

## 📖 Usage Guide

### Opening LocalSeek

**Sidebar Panel** (Recommended)
- Click the LocalSeek icon in the Activity Bar (left sidebar)
- The chat panel opens in the sidebar for easy access while coding

**Standalone Window**
- Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
- Type "LocalSeek: Open AI Chat"
- Chat opens in a separate panel

### Basic Chat

1. **Select Model**: Choose your preferred Ollama model from the dropdown
2. **Enable Knowledge Base**: Toggle the "Use RAG" switch to include your indexed documents (off by default)
3. **Type Message**: Enter your question or request
4. **Send**: Press `Enter` or click the Send button
5. **View Response**: Watch the AI response stream in real-time

### Working with Code

**Send Code to Chat**
1. Select any code in your editor
2. Right-click → "Send Selected Code to LocalSeek Chat"
3. The code appears in your chat input with proper formatting
4. Add your question and send

**Insert AI Code**
1. Click "Insert" button on any code block in AI responses
2. Code is automatically inserted at your cursor position
3. Replaces selected text if you have a selection

### Knowledge Base Setup

1. **Configure Knowledge Base Path** (Required)
   - Open Settings (`Ctrl+,` / `Cmd+,`) and search "LocalSeek"
   - **Set "Knowledge Base Path" to a specific directory** - this is required to use RAG

2. **Index Your Documents**
   - Open Command Palette (`Ctrl+Shift+P`)
   - Type "LocalSeek: Index Knowledge Base"
   - Extension scans for files in the specified path

3. **Use in Chat**
   - Toggle the "Use RAG" switch on in the chat interface (off by default)
   - Ask questions related to your documentation
   - AI will automatically include relevant context from indexed files

### Managing Conversations

**View Chat History**
- Click the history button (clock icon) in the chat interface
- Browse all your previous conversations
- Click any conversation to resume it

**Start New Chat**
- Click the new chat button (+ icon)
- Starts a fresh conversation
- Previous chat is automatically saved

### Model Management

**Download New Models**
1. Click the models button (layers icon) in chat interface
2. Enter model name (e.g., "llama3.2", "deepseek-r1:7b")
3. Click "Download"
4. Monitor download progress in real-time

**Remove Models**
1. Open Model Management modal
2. Click "Remove" next to any installed model
3. Confirm deletion to free up disk space

---

## 🔧 Advanced Usage

### Command Palette Commands

- `LocalSeek: Open AI Chat` - Open standalone chat window
- `LocalSeek: Send Selected Code` - Send selected code to chat
- `LocalSeek: Index Knowledge Base` - Index workspace documents

### Tips & Tricks

1. **Context Management**: Use the KB toggle strategically - turn it off for general questions, on for project-specific queries

2. **Model Selection**: 
   - Use smaller models (phi3) for quick questions
   - Use larger models (deepseek-r1) for complex reasoning
   - Use code-specific models for programming tasks

3. **Efficient Workflows**:
   - Keep sidebar chat open while coding
   - Use "Send Selected Code" for quick code reviews
   - Leverage chat history to build on previous conversations

4. **Performance Optimization**:
   - Close unused models to free RAM
   - Index only essential documents for faster search
   - Use smaller models for better response times

---

## 🔒 Privacy & Security

### Privacy Guarantees

✅ **100% Local Processing** - All AI inference happens on your machine
✅ **No Data Transmission** - Your code and conversations never leave your computer
✅ **No Telemetry** - Zero tracking or analytics
✅ **Offline Capable** - Works completely without internet connection
✅ **Your Data, Your Control** - Full ownership of all conversations and data

### Security Features

- **No External Dependencies** for AI processing
- **Local Storage Only** for chat history and settings
- **No API Keys Required** - no risk of key exposure
- **Open Source** - transparent and auditable code

---

## 🤝 Contributing

We welcome contributions from the community!

### Ways to Contribute

- 🐛 **Report Bugs** - Help us identify and fix issues
- 💡 **Suggest Features** - Share ideas for new functionality
- 📖 **Improve Docs** - Help make documentation clearer
- 🛠️ **Submit Code** - Contribute bug fixes or new features
- ⭐ **Star the Repo** - Show your support


---

## 🌟 What's Next?

### Roadmap

- 📁 **More File Types** - Support for additional document formats
- 🔍 **Advanced Search** - Enhanced knowledge base search capabilities  
- 🎨 **Theme Customization** - Multiple UI themes and customization options
- 🔌 **Plugin System** - Extensible architecture for custom integrations
- 📊 **Analytics Dashboard** - Usage insights and conversation analytics
- 🌐 **Multi-language Support** - Interface localization

### Version History

Check the [Changelog](CHANGELOG.md) for detailed version history and updates.

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

**Developed with ❤️ by [Hariharen](https://www.linkedin.com/in/hariharen9/)**
---

*LocalSeek - Your local AI companion for VSCode. Seek your answers, locally and privately.* 🔍✨
