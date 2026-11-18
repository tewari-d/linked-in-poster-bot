const API_BASE = 'https://api.telegram.org';

class TelegramError extends Error {
  constructor({ method, code, description }) {
    super(`Telegram ${method} failed (${code}): ${description}`);
    this.name = 'TelegramError';
    this.code = code;
  }
}

// The bot token is part of every URL, so URLs are never put into errors or logs.
function createTelegramApi({ token, fetchFn = fetch }) {
  async function request(method, init) {
    let res;
    try {
      res = await fetchFn(`${API_BASE}/bot${token}/${method}`, { method: 'POST', ...init });
    } catch (err) {
      throw new Error(`Cannot reach Telegram (${method}): ${err.cause?.code ?? err.message}`, { cause: err });
    }
    const body = await res.json().catch(() => null);
    if (!body?.ok) {
      throw new TelegramError({ method, code: body?.error_code ?? res.status, description: body?.description ?? res.statusText });
    }
    return body.result;
  }

  const call = (method, params = {}) => request(method, {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });

  // Uploads `document.bytes` as a file. A file, not a photo, so Telegram keeps the image sharp:
  // its file_id is what Post later downloads and uploads to LinkedIn.
  function sendDocument({ document, ...params }) {
    const form = new FormData();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    form.append('document', new Blob([document.bytes], { type: document.mimeType }), document.fileName);
    return request('sendDocument', { body: form });
  }

  async function downloadFile(fileId) {
    const file = await call('getFile', { file_id: fileId });
    if (!file.file_path) throw new Error('Telegram returned no file path (bots cannot download files over 20 MB)');
    let res;
    try {
      res = await fetchFn(`${API_BASE}/file/bot${token}/${file.file_path}`);
    } catch (err) {
      throw new Error(`Cannot download file from Telegram: ${err.cause?.code ?? err.message}`, { cause: err });
    }
    if (!res.ok) throw new Error(`Telegram file download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  return {
    call,
    downloadFile,
    getMe: () => call('getMe'),
    getUpdates: (params) => call('getUpdates', params),
    sendMessage: (params) => call('sendMessage', params),
    sendDocument,
    answerCallbackQuery: (params) => call('answerCallbackQuery', params),
    editMessageReplyMarkup: (params) => call('editMessageReplyMarkup', params),
    deleteMessage: (params) => call('deleteMessage', params),
    setMyCommands: (params) => call('setMyCommands', params),
  };
}

// Private chats that have messaged the bot, newest message per chat.
function privateChatsFrom(updates) {
  const chats = new Map();
  for (const update of updates ?? []) {
    const message = update.message;
    if (message?.chat?.type !== 'private') continue;
    chats.set(message.chat.id, {
      id: message.chat.id,
      name: [message.chat.first_name, message.chat.last_name].filter(Boolean).join(' '),
      username: message.chat.username,
      lastText: message.text ?? '(non-text message)',
    });
  }
  return [...chats.values()];
}

module.exports = { createTelegramApi, privateChatsFrom, TelegramError };
