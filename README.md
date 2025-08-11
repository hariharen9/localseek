# LocalSeek 🤖💬

LocalSeek is a powerful, privacy-first AI chat extension for Visual Studio Code that brings conversational AI directly to your development environment - completely locally.
[WEBSITE](https://localseek.vercel.app/)

![LocalSeek Logo](./media/LOCALSEEK.png)

## 🌟 Key Features

### 💻 Fully Local AI Interaction

- **Zero Cloud Dependencies**: All AI processing happens 100% on your machine
- **Privacy-First Approach**: No external API calls or data transmission
- **Offline-Ready**: Works without internet connection
- **Local Model Management**: Seamlessly use any Ollama-compatible model

### 🌏 Visually Stunning

- **NeverBeforeSeen Look**: Beautiful UI with **Webview API** integrated directly within VSCode
- **Markdown Support**: Supports MD on the **STREAMED** AI's response, so it is easy to understand
- **Talk, Copy, Exit**: User friendly chat interface like mobile phones with many features

### 🚀 Seamless VSCode Integration

- Integrated sidebar AI chat view
- Standalone chat panel
- Instant model switching
- Lightweight and non-intrusive design

### 🔒 Local Processing Advantages

- **Enhanced Privacy**: Your conversations never leave your computer
- **Reduced Latency**: Direct local model access
- **Cost-Effective**: No subscription or per-token charges
- **Customizable**: Use any locally hosted AI model

## 📋 Prerequisites

### System Requirements

- Visual Studio Code (v1.96.0+)
- [Ollama](https://ollama.com/) installed locally
- Minimum 8GB RAM recommended
- At least one Ollama-compatible LLM model (DeepSeek R1 is preffered 😉)

### Recommended Model Installations

```bash
# Pull recommended models
ollama pull deepseek-r1:14b   # The best in my opinion
ollama pull mistral           # Balanced performance
ollama pull llama3.2          # Versatile model
ollama pull phi3              # Lightweight option
```

## 🔧 Installation

### Method 1: Visual Studio Code Marketplace

1. Open VSCode Extensions (Ctrl+Shift+X)
2. Search for "LocalSeek"
3. Click "Install"

### Method 2: Manual VSIX Installation

1. Download VSIX from [Releases](https://github.com/hariharen9/localseek/releases)
2. Open VSCode Extensions view
3. Click "..." menu
4. Select "Install from VSIX"
5. Choose downloaded file

## 🚀 Quick Start Guide

### Accessing LocalSeek

- **Sidebar Chat**: Click LocalSeek icon in Activity Bar 👈
- **Standalone Chat**:
  - Command Palette (Ctrl+Shift+P)
  - Type "LocalSeek AI Chat"

### Basic Usage

1. Select Ollama model from dropdown
2. Type your message
3. Press Enter or Send button
4. Receive instant, local AI responses

## ⚙️ Configuration

### Ollama Host Configuration

Customize Ollama connection in VSCode Settings:

- Open Settings (Ctrl+,)
- Search "LocalSeek"
- Modify "Ollama Host" if needed

## 🔬 Supported Models

LocalSeek works with any Ollama-compatible model including but not limited to:

- DeepSeek-R1
- Mistral
- Llama 3
- Phi-3
- CodeLlama
- Mixtral
- ...

## 🛡️ Privacy Commitment

- 100% Local Processing
- No External Data Transmission
- Full Control Over Your AI Interactions

## 🤝 Contributing

Contributions welcome!

- Report issues on GitHub
- Submit pull requests
- Suggest new features

## 📦 Troubleshooting

- Ensure Ollama is running
- Verify model installations
- Check VSCode and extension compatibility

## 📝 License

MIT License

**Developed with ❤️ by Hariharen**
