const vscode = acquireVsCodeApi();
let currentAssistantMessageElement = null;
let isProcessingResponse = false;
let workspaceFiles = [];
let attachedFiles = [];
let mentionIndex = -1;
let currentMentionFilter = '';
let mentionSelectedIndex = 0;

function renderAttachedFiles() {
    const container = document.getElementById('file-pills');
    container.innerHTML = attachedFiles.map((file, i) => `
        <div class="file-pill">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                <polyline points="13 2 13 9 20 9"></polyline>
            </svg>
            ${file.name}
            <span class="file-pill-remove" onclick="removeAttachedFile(${i})">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </span>
        </div>
    `).join('');
}

function removeAttachedFile(index) {
    attachedFiles.splice(index, 1);
    renderAttachedFiles();
}

function selectMention(filePath) {
    const parts = filePath.split('/');
    const name = parts.pop();
    
    if (!attachedFiles.some(f => f.path === filePath)) {
        attachedFiles.push({ name, path: filePath });
        renderAttachedFiles();
    }
    
    const input = document.getElementById('userInput');
    const value = input.value;
    const textBeforeMention = value.substring(0, mentionIndex);
    const textAfterCursor = value.substring(input.selectionStart);
    
    input.value = textBeforeMention + textAfterCursor;
    input.focus();
    
    document.getElementById('mention-dropdown').classList.remove('show');
    mentionIndex = -1;
    mentionSelectedIndex = 0;
}

function handleInputForMentions(e) {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    
    // Check if we are typing a mention
    const textBeforeCursor = value.substring(0, cursorPos);
    const mentionMatch = textBeforeCursor.match(/@([a-zA-Z0-9_\-\.\/]*)$/);
    
    const dropdown = document.getElementById('mention-dropdown');
    
    if (mentionMatch) {
        currentMentionFilter = mentionMatch[1].toLowerCase();
        mentionIndex = mentionMatch.index;
        
        const filteredFiles = workspaceFiles
            .filter(f => f.toLowerCase().includes(currentMentionFilter))
            .slice(0, 10); // Show max 10
            
        if (filteredFiles.length > 0) {
            dropdown.innerHTML = filteredFiles.map((f, i) => {
                const parts = f.split('/');
                const name = parts.pop();
                const path = parts.join('/');
                return `
                    <div class="mention-item ${i === mentionSelectedIndex ? 'selected' : ''}" onclick="selectMention('${f.replace(/'/g, "\\'")}')" data-index="${i}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0;">
                            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                            <polyline points="13 2 13 9 20 9"></polyline>
                        </svg>
                        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${name}</span>
                        <span class="mention-item-path" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${path}</span>
                    </div>
                `;
            }).join('');
            dropdown.classList.add('show');
            
            // Adjust selection index if out of bounds
            if (mentionSelectedIndex >= filteredFiles.length) {
                mentionSelectedIndex = 0;
            }
        } else {
            dropdown.classList.remove('show');
        }
    } else {
        dropdown.classList.remove('show');
        mentionIndex = -1;
        mentionSelectedIndex = 0;
    }
}

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

    let attachedFilesHtml = '';
    if (attachedFiles.length > 0) {
        attachedFilesHtml = `
            <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem;">
                ${attachedFiles.map(file => `
                    <div style="background: rgba(0,0,0,0.2); padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; display: flex; align-items: center; gap: 0.25rem; border: 1px solid rgba(255,255,255,0.1);">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                            <polyline points="13 2 13 9 20 9"></polyline>
                        </svg>
                        ${file.name}
                    </div>
                `).join('')}
            </div>
        `;
    }

    // Add user message
    chatHistory.innerHTML += `
        <div class="message user">
            ${attachedFilesHtml}
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
        useRAG: ragToggle.checked,
        attachedFiles: attachedFiles
    });

    input.value = '';
    attachedFiles = [];
    renderAttachedFiles();
    chatHistory.scrollTop = chatHistory.scrollHeight;
    isProcessingResponse = true;
    toggleSendButton(true);
}

function toggleSendButton(isGenerating) {
    const btn = document.getElementById('sendButton');
    const icon = document.getElementById('sendIcon');
    const text = document.getElementById('sendBtnText');
    
    if (isGenerating) {
        btn.style.backgroundColor = 'var(--danger)';
        text.textContent = 'Stop';
        icon.innerHTML = '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>';
        btn.onclick = stopGeneration;
    } else {
        btn.style.backgroundColor = 'var(--primary)';
        text.textContent = 'Send';
        icon.innerHTML = '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>';
        btn.onclick = sendMessage;
    }
}

function stopGeneration() {
    vscode.postMessage({ command: 'stopGeneration' });
    isProcessingResponse = false;
    toggleSendButton(false);
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
    const dropdown = document.getElementById('mention-dropdown');
    
    if (dropdown.classList.contains('show')) {
        const items = dropdown.querySelectorAll('.mention-item');
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            mentionSelectedIndex = (mentionSelectedIndex + 1) % items.length;
            handleInputForMentions({ target: event.target });
            return;
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            mentionSelectedIndex = (mentionSelectedIndex - 1 + items.length) % items.length;
            handleInputForMentions({ target: event.target });
            return;
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const filteredFiles = workspaceFiles.filter(f => f.toLowerCase().includes(currentMentionFilter));
            if (filteredFiles[mentionSelectedIndex]) {
                selectMention(filteredFiles[mentionSelectedIndex]);
            }
            return;
        } else if (event.key === 'Escape') {
            dropdown.classList.remove('show');
            mentionIndex = -1;
            return;
        }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
});

const userInput = document.getElementById('userInput');
userInput.addEventListener('input', (e) => {
    handleInputForMentions(e);
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
                    tempContent.id = 'temp-streaming-raw';
                    // Store the raw text on the dataset so we don't lose markdown characters
                    tempContent.dataset.rawText = '';
                    currentAssistantMessageElement.appendChild(tempContent);
                }

                const tempContent = document.getElementById('temp-streaming-raw');
                tempContent.dataset.rawText += message.text;
                
                // Parse markdown live while streaming
                tempContent.innerHTML = marked.parse(tempContent.dataset.rawText);
                
                // Highlight code blocks quickly without full wrapper UI during stream to save performance
                tempContent.querySelectorAll('pre code').forEach(codeBlock => {
                    hljs.highlightElement(codeBlock);
                });

                // Auto-scroll
                const isNearBottom = chatHistory.scrollHeight - chatHistory.clientHeight <= chatHistory.scrollTop + 100;
                if (isNearBottom) {
                    chatHistory.scrollTop = chatHistory.scrollHeight;
                }

                if (message.isComplete) {
                    const finalText = tempContent.dataset.rawText;
                    const parsedHtml = marked.parse(finalText);
                    const finalContent = document.createElement('div');
                    finalContent.innerHTML = parsedHtml;

                    // Process code blocks
                    processCodeBlocks(finalContent);

                    currentAssistantMessageElement.replaceChild(finalContent, tempContent);

                    currentAssistantMessageElement = null;
                    isProcessingResponse = false;
                    toggleSendButton(false);
                }
                break;

            case 'clearChat':
                chatHistory.innerHTML = '';
                currentAssistantMessageElement = null;
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
                currentAssistantMessageElement = null;
                message.messages.forEach(msg => {
                    const messageDiv = document.createElement('div');
                    messageDiv.className = `message ${msg.role}`;
                    
                    if (msg.role === 'assistant') {
                        messageDiv.innerHTML = marked.parse(msg.content);
                        // Process code blocks
                        processCodeBlocks(messageDiv);
                    } else {
                        // Extract attached files from the raw content if they exist
                        let displayContent = msg.content;
                        if (displayContent.startsWith("Here are the contents of the attached files for context:\n\n")) {
                            const match = displayContent.match(/--- (.*?) ---/g);
                            if (match) {
                                const files = match.map(m => m.replace(/--- /g, '').replace(/ ---/g, '').trim());
                                const pillsHtml = `
                                    <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem;">
                                        ${files.map(name => `
                                            <div style="background: rgba(0,0,0,0.2); padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; display: flex; align-items: center; gap: 0.25rem; border: 1px solid rgba(255,255,255,0.1);">
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                                                    <polyline points="13 2 13 9 20 9"></polyline>
                                                </svg>
                                                ${name.split('/').pop()}
                                            </div>
                                        `).join('')}
                                    </div>
                                `;
                                
                                // Extract the actual user query
                                const queryMatch = displayContent.match(/User Query: ([\s\S]*)$/);
                                const actualQuery = queryMatch ? queryMatch[1] : displayContent;
                                
                                displayContent = pillsHtml + actualQuery;
                            }
                        }
                        
                        messageDiv.innerHTML = displayContent;
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

            case 'workspaceFiles':
                workspaceFiles = message.files || [];
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
// Fetch workspace files for @ mentions
vscode.postMessage({ command: 'getWorkspaceFiles' });
// Signal that the webview is ready
vscode.postMessage({ command: 'webviewReady' });

function processCodeBlocks(element) {
    element.querySelectorAll("pre code").forEach(codeBlock => {
        // Find language
        let language = "plaintext";
        const classList = Array.from(codeBlock.classList);
        const langClass = classList.find(c => c.startsWith("language-"));
        if (langClass) {
            language = langClass.replace("language-", "");
        }

        const wrapper = document.createElement("div");
        wrapper.className = "code-block-wrapper";
        
        // Create header
        const header = document.createElement("div");
        header.className = "code-block-header";
        
        const langSpan = document.createElement("span");
        langSpan.textContent = language;
        
        const actionsDiv = document.createElement("div");
        actionsDiv.className = "code-block-actions";
        
        const insertButton = document.createElement("button");
        insertButton.className = "code-action-btn";
        insertButton.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg> Insert`;
        insertButton.onclick = () => insertCodeToEditor(codeBlock.textContent);
        
        const copyButton = document.createElement("button");
        copyButton.className = "code-action-btn";
        copyButton.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Copy`;
        copyButton.onclick = (e) => {
            copyCodeToClipboard(codeBlock.textContent);
            const originalHtml = e.currentTarget.innerHTML;
            e.currentTarget.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!`;
            setTimeout(() => {
                e.currentTarget.innerHTML = originalHtml;
            }, 2000);
        };
        
        actionsDiv.appendChild(insertButton);
        actionsDiv.appendChild(copyButton);
        
        header.appendChild(langSpan);
        header.appendChild(actionsDiv);
        
        const pre = codeBlock.parentNode;
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(header);
        wrapper.appendChild(pre);

        hljs.highlightElement(codeBlock);
    });
}

