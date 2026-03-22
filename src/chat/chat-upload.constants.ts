import { MessageType } from '@prisma/client';

export const CHAT_ATTACHMENT_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-m4v',
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

export const CHAT_UPLOAD_CHUNK_SIZE_BYTES = 5 * 1024 * 1024;

export function isAllowedChatAttachmentMimeType(mimeType?: string | null) {
  return Boolean(
    mimeType && CHAT_ATTACHMENT_ALLOWED_MIME_TYPES.includes(mimeType),
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
