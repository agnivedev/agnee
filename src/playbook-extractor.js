'use strict';

const MAX_EXTRACTED_CHARS = 20_000;

function classifyKind(mimeType, filename) {
  const ext = String(filename || '').toLowerCase().split('.').pop();
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'document';
  if (mimeType.includes('word') || ['doc', 'docx'].includes(ext)) return 'document';
  if (mimeType.startsWith('text/') || ['md', 'txt', 'markdown'].includes(ext)) return 'document';
  return 'other';
}

function truncate(text) {
  const trimmed = String(text || '').trim();
  return trimmed.length > MAX_EXTRACTED_CHARS ? `${trimmed.slice(0, MAX_EXTRACTED_CHARS)}\n\n[...dipotong, dokumen terlalu panjang...]` : trimmed;
}

/**
 * Extracts plain text from an uploaded playbook asset where feasible.
 * Images/video/audio are stored for reference only — no text is extracted from them
 * since the app has no vision/transcription pipeline.
 * Returns { kind, text, status }.
 */
async function extractPlaybookText(buffer, mimeType, filename) {
  const kind = classifyKind(mimeType, filename);
  const ext = String(filename || '').toLowerCase().split('.').pop();

  if (kind !== 'document') {
    return { kind, text: null, status: 'unsupported' };
  }

  try {
    if (mimeType === 'application/pdf' || ext === 'pdf') {
      const { PDFParse } = require('pdf-parse');
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return { kind, text: truncate(result.text), status: 'ready' };
      } finally {
        await parser.destroy();
      }
    }
    if (mimeType.includes('word') || ext === 'docx') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return { kind, text: truncate(result.value), status: 'ready' };
    }
    if (ext === 'doc') {
      // Legacy binary .doc has no reliable pure-JS parser here.
      return { kind, text: null, status: 'unsupported' };
    }
    // text/*, .md, .txt, and anything else UTF-8 readable
    return { kind, text: truncate(buffer.toString('utf8')), status: 'ready' };
  } catch (error) {
    return { kind, text: null, status: 'failed', error: error.message };
  }
}

module.exports = { extractPlaybookText, classifyKind, MAX_EXTRACTED_CHARS };
