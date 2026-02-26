import * as vscode from "vscode";
import * as fs from "fs";

export function getWebviewContent(
  models: string[],
  context: vscode.ExtensionContext,
  webview: vscode.Webview
): string {
  if (models.length === 0) {
    const errorHtmlPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'webview', 'error.html');
    return fs.readFileSync(errorHtmlPath.fsPath, 'utf8');
  }

  const htmlPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'webview', 'chat.html');
  let html = fs.readFileSync(htmlPath.fsPath, 'utf8');

  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'webview', 'chat.css'));
  const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'webview', 'chat.js'));

  const modelsHtml = models.map((model) => `<option value="${model}">${model}</option>`).join("");

  html = html.replace('<!-- CSS_URI -->', cssUri.toString());
  html = html.replace('<!-- JS_URI -->', jsUri.toString());
  html = html.replace('<!-- MODELS -->', modelsHtml);

  return html;
}
