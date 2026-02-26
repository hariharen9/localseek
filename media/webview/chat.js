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
    chatHistory.innerHTML += `
        <div class="message user">
            ${userMessage}
        </div>
    `;

    // Add loading indicator
    chatHistory.innerHTML += `
        <div class="message assistant" id="loading-indicator">
            <div class="spinner"></div>
        </div>
    `;

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
        list.innerHTML = `
            <div class="empty-history">
                <h3>No models found</h3>
                <p>Connect to Ollama or download a model to get started.</p>
            </div>`;
        updateModelSelector([]);
        return;
    }
    list.innerHTML = models.map(m => {
        const dateStr = m.modifiedAt ? new Date(m.modifiedAt).toLocaleString() : '—';
        const sizeStr = formatBytes(m.size);
        return `
            <div class="conversation-item">
                <div class="conversation-info">
                    <div class="conversation-title">${m.name}</div>
                    <div class="conversation-meta">
                        <span>Size: ${sizeStr}</span>
                        <span>Modified: ${dateStr}</span>
                    </div>
                    <div class="progress" id="progress-${CSS.escape(m.name)}" style="display:none; margin-top: 0.5rem;">
                        <div class="progress-bar" id="progress-bar-${CSS.escape(m.name)}"></div>
                    </div>
                    <div id="progress-status-${CSS.escape(m.name)}" style="font-size: 0.8rem; color: rgba(255,255,255,0.7); margin-top: 0.25rem;"></div>
                </div>
                <button class="delete-btn" onclick="removeModel('${m.name.replace(/'/g, "'")}')">Remove</button>
            </div>`;
    }).join('');
    // Update model selector options
    updateModelSelector(models.map(m => m.name));
}

function updateModelSelector(modelNames) {
    const selector = document.getElementById('modelSelector');
    if (!selector) return;
    selector.innerHTML = (modelNames || []).map(name => `<option value="${name}">${name}</option>`).join('');
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
        list.innerHTML = `
            <div class="conversation-item">
                <div class="conversation-info">
                    <div class="conversation-title">${name}</div>
                    <div class="progress" id="progress-${idSafe}" style="display:block; margin-top: 0.5rem;">
                        <div class="progress-bar" id="progress-bar-${idSafe}"></div>
                    </div>
                    <div id="progress-status-${idSafe}" style="font-size: 0.8rem; color: rgba(255,255,255,0.7); margin-top: 0.25rem;">Starting download…</div>
                </div>
            </div>` + list.innerHTML;
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
                    historyList.innerHTML = message.conversations.map(conv => `
                        <div class="conversation-item" onclick="loadConversation('${conv.id}')">
                            <div class="conversation-info">
                                <div class="conversation-title">${conv.title}</div>
                                <div class="conversation-meta">
                                    <span>${conv.lastModified}</span>
                                    <span>${conv.messageCount} message${conv.messageCount !== 1 ? 's' : ''}</span>
                                </div>
                            </div>
                            <button class="delete-btn" onclick="deleteConversation(event, '${conv.id}')">Delete</button>
                        </div>
                    `).join('');
                } else {
                    historyList.innerHTML = `
                        <div class="empty-history">
                            <h3>No conversations yet</h3>
                            <p>Start chatting to see your conversation history here!</p>
                        </div>
                    `;
                }
                historyModal.classList.add('show');
                break;

            case 'loadConversationMessages':
                chatHistory.innerHTML = '';
                message.messages.forEach(msg => {
                    const messageDiv = document.createElement('div');
                    messageDiv.className = `message ${msg.role}`;
                    
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
                    const totalStr = typeof message.total === 'number' ? ` of ${formatBytes(message.total)}` : '';
                    const compStr = typeof message.completed === 'number' ? `${formatBytes(message.completed)}` : '';
                    const pctStr = typeof message.percent === 'number' ? ` (${message.percent}%)` : '';
                    statusEl.textContent = `${message.status || 'downloading'}: ${compStr}${totalStr}${pctStr}`;
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
