import { MessageType } from '@prisma/client';
import { extname } from 'path';

export const CHAT_ATTACHMENT_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-m4v',
  'video/x-matroska',
  'audio/webm',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];

const CHAT_MATROSKA_MIME_TYPES = new Set([
  'video/x-matroska',
  'video/matroska',
  'video/mkv',
  'application/x-matroska',
  'application/octet-stream',
]);

export const CHAT_UPLOAD_CHUNK_SIZE_BYTES = 5 * 1024 * 1024;

export function normalizeChatAttachmentMimeType(
  mimeType?: string | null,
  fileName?: string | null,
) {
  const normalizedMimeType = String(mimeType || '')
    .trim()
    .toLowerCase();
  if (CHAT_ATTACHMENT_ALLOWED_MIME_TYPES.includes(normalizedMimeType)) {
    return normalizedMimeType;
  }

  const normalizedExtension = extname(String(fileName || '')).toLowerCase();
  if (
    normalizedExtension === '.mkv' &&
    (!normalizedMimeType || CHAT_MATROSKA_MIME_TYPES.has(normalizedMimeType))
  ) {
    return 'video/x-matroska';
  }

  return normalizedMimeType || null;
}

export function isAllowedChatAttachmentMimeType(
  mimeType?: string | null,
  fileName?: string | null,
) {
  const normalizedMimeType = normalizeChatAttachmentMimeType(mimeType, fileName);
  return Boolean(
    normalizedMimeType &&
      CHAT_ATTACHMENT_ALLOWED_MIME_TYPES.includes(normalizedMimeType),
  );
}

export function resolveAttachmentMessageType(mimeType?: string | null) {
  if (mimeType?.startsWith('image/')) {
    return MessageType.IMAGE;
  }

  if (mimeType?.startsWith('audio/')) {
    return MessageType.AUDIO;
  }

  return MessageType.DOCUMENT;
}
