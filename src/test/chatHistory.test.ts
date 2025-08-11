import * as assert from 'assert';
import * as vscode from 'vscode';
import { ChatHistoryManager, ChatMessage } from '../chatHistory';

// Mock VSCode extension context for testing
function createMockContext(): vscode.ExtensionContext {
  const mockUri = vscode.Uri.file('/tmp/test-storage');
  
  return {
    globalStorageUri: mockUri,
    subscriptions: [],
    workspaceState: {} as any,
    globalState: {} as any,
    secrets: {} as any,
    extensionUri: mockUri,
    extensionPath: '/tmp/test-extension',
    storageUri: mockUri,
    storagePath: '/tmp/test-storage',
    globalStoragePath: '/tmp/test-global-storage',
    logUri: mockUri,
    logPath: '/tmp/test-logs',
    extensionMode: vscode.ExtensionMode.Test,
    extension: {} as any,
    environmentVariableCollection: {} as any,
    languageModelAccessInformation: {} as any,
    asAbsolutePath: (relativePath: string) => '/tmp/test-extension/' + relativePath
  };
}

suite('ChatHistoryManager Tests', () => {
  let historyManager: ChatHistoryManager;

  setup(() => {
    const mockContext = createMockContext();
    historyManager = new ChatHistoryManager(mockContext);
  });

  test('Should create new conversation', () => {
    const conversationId = historyManager.startNewConversation();
    assert.ok(conversationId);
    assert.equal(typeof conversationId, 'string');
    assert.equal(historyManager.getCurrentConversationId(), conversationId);
  });

  test('Should add messages to conversation', async () => {
    const conversationId = historyManager.startNewConversation();
    
    const userMessage: ChatMessage = {
      role: 'user',
      content: 'Hello, how are you?'
    };
    
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: 'I am doing well, thank you!'
    };

    await historyManager.addMessage(conversationId, userMessage);
    await historyManager.addMessage(conversationId, assistantMessage);

    const conversation = historyManager.getConversation(conversationId);
    assert.ok(conversation);
    assert.equal(conversation.messages.length, 2);
    assert.equal(conversation.messages[0].content, userMessage.content);
    assert.equal(conversation.messages[1].content, assistantMessage.content);
  });

  test('Should generate conversation title from first user message', async () => {
    const conversationId = historyManager.startNewConversation();
    
    const userMessage: ChatMessage = {
      role: 'user',
      content: 'Can you help me write a Python function for sorting?'
    };

    await historyManager.addMessage(conversationId, userMessage);

    const conversation = historyManager.getConversation(conversationId);
    assert.ok(conversation);
    assert.equal(conversation.title, 'Can you help me write a Python function for sorting?');
  });

  test('Should truncate long conversation titles', async () => {
    const conversationId = historyManager.startNewConversation();
    
    const longMessage: ChatMessage = {
      role: 'user',
      content: 'This is a very long message that should be truncated when used as a conversation title because it exceeds the maximum length limit'
    };

    await historyManager.addMessage(conversationId, longMessage);

    const conversation = historyManager.getConversation(conversationId);
    assert.ok(conversation);
    assert.ok(conversation.title.length <= 50);
    assert.ok(conversation.title.endsWith('...'));
  });

  test('Should format relative time correctly', () => {
    const now = new Date();
    
    // Test "Just now"
    const justNow = new Date(now.getTime() - 30 * 1000); // 30 seconds ago
    assert.equal(historyManager.formatRelativeTime(justNow), 'Just now');
    
    // Test minutes
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    assert.equal(historyManager.formatRelativeTime(fiveMinutesAgo), '5 minutes ago');
    
    // Test hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    assert.equal(historyManager.formatRelativeTime(twoHoursAgo), '2 hours ago');
    
    // Test yesterday
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    assert.equal(historyManager.formatRelativeTime(yesterday), 'Yesterday');
    
    // Test days
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    assert.equal(historyManager.formatRelativeTime(threeDaysAgo), '3 days ago');
  });

  test('Should retrieve conversation history', async () => {
    const conversationId = historyManager.startNewConversation();
    
    const messages: ChatMessage[] = [
      { role: 'user', content: 'First message' },
      { role: 'assistant', content: 'First response' },
      { role: 'user', content: 'Second message' },
      { role: 'assistant', content: 'Second response' }
    ];

    for (const message of messages) {
      await historyManager.addMessage(conversationId, message);
    }

    const history = historyManager.getConversationHistory(conversationId);
    assert.equal(history.length, 4);
    assert.deepEqual(history.map(m => m.content), messages.map(m => m.content));
  });

  test('Should delete conversation', async () => {
    const conversationId = historyManager.startNewConversation();
    
    await historyManager.addMessage(conversationId, {
      role: 'user',
      content: 'Test message'
    });

    let conversation = historyManager.getConversation(conversationId);
    assert.ok(conversation);

    await historyManager.deleteConversation(conversationId);
    
    conversation = historyManager.getConversation(conversationId);
    assert.equal(conversation, undefined);
  });
});
