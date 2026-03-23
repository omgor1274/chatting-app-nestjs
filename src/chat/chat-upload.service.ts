import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'fs/promises';
import { basename, extname, join } from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { resolveWritableDataPath } from '../common/app-paths';
import { ChatService } from './chat.service';
import {
  CHAT_UPLOAD_CHUNK_SIZE_BYTES,
  isAllowedChatAttachmentMimeType,
  normalizeChatAttachmentMimeType,
  resolveAttachmentMessageType,
} from './chat-upload.constants';

type UploadSessionStatus = 'pending' | 'completed' | 'cancelled';

type UploadSessionRecord = {
  id: string;
  senderId: string;
  receiverId: string | null;
  groupId: string | null;
  fileName: string;
  fileMimeType: string;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
  uploadedChunks: number[];
  status: UploadSessionStatus;
  finalFileName: string | null;
  fileUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

type CreateUploadSessionInput = {
  receiverId?: string;
  groupId?: string;
  fileName?: string;
  fileMimeType?: string;
  fileSize?: number;
};

@Injectable()
export class ChatUploadService {
  constructor(
    private prisma: PrismaService,
    private chatService: ChatService,
  ) {}

  private getSessionRootPath() {
    return resolveWritableDataPath('uploads', 'chat-sessions');
  }

  private getSessionMetaDirPath() {
    return join(this.getSessionRootPath(), 'meta');
  }

  private getSessionChunksDirPath(sessionId: string) {
    return join(this.getSessionRootPath(), 'chunks', sessionId);
  }

  private getSessionMetaPath(sessionId: string) {
    return join(this.getSessionMetaDirPath(), `${sessionId}.json`);
  }

  private getChunkPath(sessionId: string, chunkIndex: number) {
    return join(
      this.getSessionChunksDirPath(sessionId),
      `${String(chunkIndex).padStart(6, '0')}.part`,
    );
  }

  private getFinalAttachmentPath(fileName: string, userId: string) {
    const safeBaseName = basename(fileName || 'attachment').replace(
      /[^a-zA-Z0-9._-]/g,
      '_',
    );
    const extension = extname(safeBaseName);
    const baseWithoutExtension = safeBaseName.slice(
      0,
      safeBaseName.length - extension.length,
    );
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const finalFileName = `${userId}-${baseWithoutExtension || 'attachment'}-${uniqueSuffix}${extension}`;

    return {
      finalFileName,
      finalPath: resolveWritableDataPath('uploads', 'chat', finalFileName),
    };
  }

  private normalizeChunkIndex(value: string | number | undefined) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException('Invalid chunk index');
    }
    return parsed;
  }

  private async ensureUploadConversationAccess(
    userId: string,
    input: { receiverId?: string | null; groupId?: string | null },
  ) {
    if (!input.receiverId && !input.groupId) {
      throw new BadRequestException('Receiver or group is required');
    }

    if (input.receiverId && input.groupId) {
      throw new BadRequestException(
        'An upload session can target only one conversation',
      );
    }

    if (input.receiverId) {
      await this.chatService.assertUsersCanChat(userId, input.receiverId);
      return;
    }

    const membership = await this.prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId: input.groupId as string,
          userId,
        },
      },
      select: { groupId: true },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this group');
    }
  }

  private async readSessionRecord(sessionId: string) {
    const metaPath = this.getSessionMetaPath(sessionId);

    try {
      const raw = await readFile(metaPath, 'utf8');
      return JSON.parse(raw) as UploadSessionRecord;
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        throw new NotFoundException('Upload session not found');
      }
      throw error;
    }
  }

  private async writeSessionRecord(record: UploadSessionRecord) {
    await mkdir(this.getSessionMetaDirPath(), { recursive: true });
    await mkdir(this.getSessionChunksDirPath(record.id), { recursive: true });
    await writeFile(
      this.getSessionMetaPath(record.id),
      JSON.stringify(record, null, 2),
      'utf8',
    );
  }

  private async getOwnedSessionRecord(sessionId: string, userId: string) {
    const record = await this.readSessionRecord(sessionId);

    if (record.senderId !== userId) {
      throw new ForbiddenException('Unauthorized');
    }

    return record;
  }

  private getChunkByteLength(record: UploadSessionRecord, chunkIndex: number) {
    if (chunkIndex >= record.totalChunks - 1) {
      const remaining =
        record.fileSize - record.chunkSize * Math.max(record.totalChunks - 1, 0);
      return Math.max(remaining, 0);
    }

    return Math.min(record.chunkSize, record.fileSize);
  }

  private getUploadedBytes(record: UploadSessionRecord) {
    return record.uploadedChunks.reduce(
      (total, chunkIndex) => total + this.getChunkByteLength(record, chunkIndex),
      0,
    );
  }

  private getNextChunkIndex(record: UploadSessionRecord) {
    for (let index = 0; index < record.totalChunks; index += 1) {
      if (!record.uploadedChunks.includes(index)) {
        return index;
      }
    }

    return null;
  }

  private serializeSession(record: UploadSessionRecord) {
    return {
      sessionId: record.id,
      status: record.status,
      chunkSize: record.chunkSize,
      fileName: record.fileName,
      fileMimeType: record.fileMimeType,
      fileSize: record.fileSize,
      totalChunks: record.totalChunks,
      uploadedChunkCount: record.uploadedChunks.length,
      uploadedBytes: this.getUploadedBytes(record),
      nextChunkIndex: this.getNextChunkIndex(record),
      receiverId: record.receiverId,
      groupId: record.groupId,
      fileUrl: record.fileUrl,
    };
  }

  private async cleanupChunkFiles(record: UploadSessionRecord) {
    const chunksDir = this.getSessionChunksDirPath(record.id);

    try {
      const files = await readdir(chunksDir);
      await Promise.all(
        files.map((file) => unlink(join(chunksDir, file)).catch(() => undefined)),
      );
      await rm(chunksDir, { recursive: true, force: true });
    } catch (error) {
      if (
        !(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ENOENT'
        )
      ) {
        throw error;
      }
    }
  }

  async createSession(userId: string, input: CreateUploadSessionInput) {
    const fileName = basename((input.fileName || '').trim());
    const fileMimeType = normalizeChatAttachmentMimeType(
      input.fileMimeType,
      fileName,
    );
    const fileSize = Number(input.fileSize);

    if (!fileName) {
      throw new BadRequestException('File name is required');
    }

    if (!fileMimeType || !isAllowedChatAttachmentMimeType(fileMimeType, fileName)) {
      throw new BadRequestException('Unsupported file type');
    }

    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      throw new BadRequestException('Invalid file size');
    }

    await this.ensureUploadConversationAccess(userId, {
      receiverId: input.receiverId ?? null,
      groupId: input.groupId ?? null,
    });

    const totalChunks = Math.max(
      1,
      Math.ceil(fileSize / CHAT_UPLOAD_CHUNK_SIZE_BYTES),
    );
    const now = new Date().toISOString();
    const record: UploadSessionRecord = {
      id: randomUUID(),
      senderId: userId,
      receiverId: input.receiverId ?? null,
      groupId: input.groupId ?? null,
      fileName,
      fileMimeType,
      fileSize,
      chunkSize: CHAT_UPLOAD_CHUNK_SIZE_BYTES,
      totalChunks,
      uploadedChunks: [],
      status: 'pending',
      finalFileName: null,
      fileUrl: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.writeSessionRecord(record);
    return this.serializeSession(record);
  }

  async getSessionStatus(sessionId: string, userId: string) {
    const record = await this.getOwnedSessionRecord(sessionId, userId);
    return this.serializeSession(record);
  }

  async uploadChunk(
    sessionId: string,
    userId: string,
    chunkIndexInput: string | number | undefined,
    chunk: { buffer: Buffer; size: number } | undefined,
  ) {
    if (!chunk?.buffer || !chunk.size) {
      throw new BadRequestException('Chunk file is required');
    }

    const chunkIndex = this.normalizeChunkIndex(chunkIndexInput);
    const record = await this.getOwnedSessionRecord(sessionId, userId);

    if (record.status !== 'pending') {
      throw new BadRequestException('Only pending uploads can receive chunks');
    }

    if (chunkIndex >= record.totalChunks) {
      throw new BadRequestException('Chunk index is out of range');
    }

    const expectedSize = this.getChunkByteLength(record, chunkIndex);
    if (chunk.size > record.chunkSize || chunk.size !== expectedSize) {
      throw new BadRequestException('Chunk size does not match the upload plan');
    }

    await this.ensureUploadConversationAccess(userId, {
      receiverId: record.receiverId,
      groupId: record.groupId,
    });

    await mkdir(this.getSessionChunksDirPath(record.id), { recursive: true });
    await writeFile(this.getChunkPath(record.id, chunkIndex), chunk.buffer);

    if (!record.uploadedChunks.includes(chunkIndex)) {
      record.uploadedChunks = [...record.uploadedChunks, chunkIndex].sort(
        (left, right) => left - right,
      );
    }
    record.updatedAt = new Date().toISOString();

    await this.writeSessionRecord(record);
    return this.serializeSession(record);
  }

  async finalizeSession(sessionId: string, userId: string) {
    const record = await this.getOwnedSessionRecord(sessionId, userId);

    if (record.status !== 'pending') {
      throw new BadRequestException('Only pending uploads can be finalized');
    }

    const nextChunkIndex = this.getNextChunkIndex(record);
    if (nextChunkIndex !== null) {
      throw new BadRequestException('Upload is not complete yet');
    }

    await this.ensureUploadConversationAccess(userId, {
      receiverId: record.receiverId,
      groupId: record.groupId,
    });

    const { finalFileName, finalPath } = this.getFinalAttachmentPath(
      record.fileName,
      userId,
    );
    const tempPath = `${finalPath}.part`;

    await mkdir(resolveWritableDataPath('uploads', 'chat'), { recursive: true });
    await writeFile(tempPath, Buffer.alloc(0));

    try {
      for (let chunkIndex = 0; chunkIndex < record.totalChunks; chunkIndex += 1) {
        const chunkPath = this.getChunkPath(record.id, chunkIndex);
        const chunkStat = await stat(chunkPath);
        const expectedSize = this.getChunkByteLength(record, chunkIndex);

        if (chunkStat.size !== expectedSize) {
          throw new BadRequestException(
            'One or more uploaded chunks are incomplete',
          );
        }

        const buffer = await readFile(chunkPath);
        await writeFile(tempPath, buffer, { flag: 'a' });
      }

      await rename(tempPath, finalPath);
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }

    const message = await this.chatService.createEncryptedMessage({
      senderId: userId,
      receiverId: record.receiverId ?? undefined,
      groupId: record.groupId ?? undefined,
      fileUrl: `/uploads/chat/${finalFileName}`,
      fileName: record.fileName,
      fileMimeType: record.fileMimeType,
      fileSize: record.fileSize,
      messageType: resolveAttachmentMessageType(record.fileMimeType),
    });

    record.status = 'completed';
    record.finalFileName = finalFileName;
    record.fileUrl = `/uploads/chat/${finalFileName}`;
    record.updatedAt = new Date().toISOString();

    await this.writeSessionRecord(record);
    await this.cleanupChunkFiles(record);

    return message;
  }

  async cancelSession(sessionId: string, userId: string) {
    const record = await this.getOwnedSessionRecord(sessionId, userId);

    if (record.status === 'completed') {
      throw new BadRequestException('Completed uploads cannot be cancelled');
    }

    record.status = 'cancelled';
    record.updatedAt = new Date().toISOString();
    await this.writeSessionRecord(record);
    await this.cleanupChunkFiles(record);

    return this.serializeSession(record);
  }
}
