import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createReadStream, createWriteStream } from 'fs';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  truncate,
  unlink,
  writeFile,
} from 'fs/promises';
import { basename, extname, join } from 'path';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';
import { PrismaService } from '../prisma/prisma.service';
import { resolveWritableDataPath } from '../common/app-paths';
import { ChatAttachmentStorageService } from './chat-attachment-storage.service';
import { ChatService } from './chat.service';
import {
  CHAT_UPLOAD_CHUNK_SIZE_BYTES,
  isAllowedChatAttachmentMimeType,
  normalizeChatAttachmentMimeType,
  resolveAttachmentMessageType,
} from './chat-upload.constants';

type UploadSessionStatus = 'pending' | 'completed' | 'cancelled';
type UploadStorageMode = 'chunked' | 'stream' | 'r2-multipart';
type UploadTransport = 'server-relay' | 'presigned-put';
type UploadStorageProvider = 'local' | 'cloudflare-r2';

type UploadedMultipartPart = {
  partNumber: number;
  etag: string;
  size: number;
};

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
  uploadedParts: UploadedMultipartPart[];
  storageMode: UploadStorageMode;
  storageProvider: UploadStorageProvider;
  status: UploadSessionStatus;
  finalFileName: string | null;
  fileUrl: string | null;
  remoteObjectKey: string | null;
  remoteUploadId: string | null;
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
    private chatAttachmentStorage: ChatAttachmentStorageService,
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

  private getSessionAssembledDirPath() {
    return join(this.getSessionRootPath(), 'assembled');
  }

  private getSessionAssembledTempPath(sessionId: string) {
    return join(this.getSessionAssembledDirPath(), `${sessionId}.part`);
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

  private getResolvedFinalAttachmentPath(finalFileName: string) {
    return resolveWritableDataPath('uploads', 'chat', finalFileName);
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

  private normalizeSessionRecord(record: UploadSessionRecord) {
    const storageMode =
      record.storageMode === 'r2-multipart'
        ? 'r2-multipart'
        : record.storageMode || 'stream';
    const storageProvider =
      record.storageProvider ||
      (storageMode === 'r2-multipart' ? 'cloudflare-r2' : 'local');

    return {
      ...record,
      uploadedChunks: Array.isArray(record.uploadedChunks)
        ? [...new Set(record.uploadedChunks)]
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value >= 0)
            .sort((left, right) => left - right)
        : [],
      uploadedParts: Array.isArray(record.uploadedParts)
        ? record.uploadedParts
            .map((part) => ({
              partNumber: Number(part.partNumber),
              etag: String(part.etag || '').trim(),
              size: Number(part.size),
            }))
            .filter(
              (part) =>
                Number.isInteger(part.partNumber) &&
                part.partNumber > 0 &&
                part.etag &&
                Number.isFinite(part.size) &&
                part.size > 0,
            )
            .sort((left, right) => left.partNumber - right.partNumber)
        : [],
      storageMode,
      storageProvider,
      remoteObjectKey: record.remoteObjectKey ?? null,
      remoteUploadId: record.remoteUploadId ?? null,
      finalFileName: record.finalFileName ?? null,
      fileUrl: record.fileUrl ?? null,
    } satisfies UploadSessionRecord;
  }

  private getUploadTransport(record: UploadSessionRecord): UploadTransport {
    return record.storageMode === 'r2-multipart'
      ? 'presigned-put'
      : 'server-relay';
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
      return this.normalizeSessionRecord(
        JSON.parse(raw) as UploadSessionRecord,
      );
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
    if (record.storageMode !== 'r2-multipart') {
      await mkdir(this.getSessionChunksDirPath(record.id), { recursive: true });
      await mkdir(this.getSessionAssembledDirPath(), { recursive: true });
    }
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
        record.fileSize -
        record.chunkSize * Math.max(record.totalChunks - 1, 0);
      return Math.max(remaining, 0);
    }

    return Math.min(record.chunkSize, record.fileSize);
  }

  private getUploadedBytes(record: UploadSessionRecord) {
    return record.uploadedChunks.reduce(
      (total, chunkIndex) =>
        total + this.getChunkByteLength(record, chunkIndex),
      0,
    );
  }

  private getCompletedChunkPrefixForAssembledBytes(
    record: UploadSessionRecord,
    assembledBytes: number,
  ) {
    if (!Number.isFinite(assembledBytes) || assembledBytes < 0) {
      throw new BadRequestException('Upload assembly is invalid');
    }

    let completedBytes = 0;
    let completedChunkCount = 0;

    for (let index = 0; index < record.totalChunks; index += 1) {
      const nextCompletedBytes =
        completedBytes + this.getChunkByteLength(record, index);
      if (assembledBytes < nextCompletedBytes) {
        break;
      }

      completedBytes = nextCompletedBytes;
      completedChunkCount = index + 1;
    }

    return {
      completedBytes,
      completedChunkCount,
    };
  }

  private getCompletedChunkCountForAssembledBytes(
    record: UploadSessionRecord,
    assembledBytes: number,
  ) {
    const { completedBytes, completedChunkCount } =
      this.getCompletedChunkPrefixForAssembledBytes(record, assembledBytes);

    if (completedBytes === assembledBytes) {
      return completedChunkCount;
    }

    throw new BadRequestException('Upload assembly is incomplete');
  }

  private buildUploadedChunkList(count: number) {
    return Array.from({ length: Math.max(count, 0) }, (_, index) => index);
  }

  private areUploadedChunkListsEqual(left: number[], right: number[]) {
    return (
      left.length === right.length &&
      left.every((value, index) => value === right[index])
    );
  }

  private async syncStreamSessionRecord(record: UploadSessionRecord) {
    if (record.storageMode !== 'stream') {
      return record;
    }

    const assembledTempPath = this.getSessionAssembledTempPath(record.id);
    const expectedUploadedBytes = this.getUploadedBytes(record);

    let assembledBytes = 0;
    try {
      const assembledStat = await stat(assembledTempPath);
      assembledBytes = assembledStat.size;
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        if (record.uploadedChunks.length) {
          record.uploadedChunks = [];
          record.updatedAt = new Date().toISOString();
          await this.writeSessionRecord(record);
        }
        return record;
      }
      throw error;
    }

    const { completedBytes, completedChunkCount } =
      this.getCompletedChunkPrefixForAssembledBytes(record, assembledBytes);
    const expectedUploadedChunks =
      this.buildUploadedChunkList(completedChunkCount);
    const shouldTruncate = assembledBytes !== completedBytes;
    const shouldRewriteRecord =
      shouldTruncate ||
      !this.areUploadedChunkListsEqual(
        record.uploadedChunks,
        expectedUploadedChunks,
      ) ||
      expectedUploadedBytes !== completedBytes;

    if (!shouldRewriteRecord) {
      return record;
    }

    if (shouldTruncate) {
      await truncate(assembledTempPath, completedBytes);
    }

    record.uploadedChunks = expectedUploadedChunks;
    record.updatedAt = new Date().toISOString();
    await this.writeSessionRecord(record);
    return record;
  }

  private async syncSessionRecord(record: UploadSessionRecord) {
    if (record.storageMode === 'stream') {
      return this.syncStreamSessionRecord(record);
    }

    return record;
  }

  private getNextChunkIndex(record: UploadSessionRecord) {
    for (let index = 0; index < record.totalChunks; index += 1) {
      if (!record.uploadedChunks.includes(index)) {
        return index;
      }
    }

    return null;
  }

  private getMultipartPart(record: UploadSessionRecord, chunkIndex: number) {
    return record.uploadedParts.find(
      (part) => part.partNumber === chunkIndex + 1,
    );
  }

  private assertPendingUploadRecord(record: UploadSessionRecord) {
    if (record.status !== 'pending') {
      throw new BadRequestException('Only pending uploads can be modified');
    }
  }

  private assertChunkIndexInRange(
    record: UploadSessionRecord,
    chunkIndex: number,
  ) {
    if (chunkIndex >= record.totalChunks) {
      throw new BadRequestException('Chunk index is out of range');
    }
  }

  private assertNextChunk(record: UploadSessionRecord, chunkIndex: number) {
    const nextChunkIndex = this.getNextChunkIndex(record);
    if (nextChunkIndex === null) {
      return null;
    }
    if (chunkIndex !== nextChunkIndex) {
      throw new BadRequestException('Chunks must be uploaded in order');
    }
    return nextChunkIndex;
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
      uploadTransport: this.getUploadTransport(record),
      storageProvider: record.storageProvider,
    };
  }

  private async cleanupSessionArtifacts(record: UploadSessionRecord) {
    const chunksDir = this.getSessionChunksDirPath(record.id);
    const assembledTempPath = this.getSessionAssembledTempPath(record.id);

    try {
      const files = await readdir(chunksDir);
      await Promise.all(
        files.map((file) =>
          unlink(join(chunksDir, file)).catch(() => undefined),
        ),
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

    await unlink(assembledTempPath).catch(() => undefined);
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

    if (
      !fileMimeType ||
      !isAllowedChatAttachmentMimeType(fileMimeType, fileName)
    ) {
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
    let record: UploadSessionRecord;

    if (this.chatAttachmentStorage.isR2Enabled()) {
      const remoteUpload =
        await this.chatAttachmentStorage.createMultipartUpload({
          fileName,
          fileMimeType,
          userId,
        });
      record = {
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
        uploadedParts: [],
        storageMode: 'r2-multipart',
        storageProvider: 'cloudflare-r2',
        status: 'pending',
        finalFileName: null,
        fileUrl: remoteUpload.fileUrl,
        remoteObjectKey: remoteUpload.key,
        remoteUploadId: remoteUpload.uploadId,
        createdAt: now,
        updatedAt: now,
      };
    } else {
      record = {
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
        uploadedParts: [],
        storageMode: 'stream',
        storageProvider: 'local',
        status: 'pending',
        finalFileName: null,
        fileUrl: null,
        remoteObjectKey: null,
        remoteUploadId: null,
        createdAt: now,
        updatedAt: now,
      };
    }

    await this.writeSessionRecord(record);
    return this.serializeSession(record);
  }

  async getSessionStatus(sessionId: string, userId: string) {
    const record = await this.syncSessionRecord(
      await this.getOwnedSessionRecord(sessionId, userId),
    );
    return this.serializeSession(record);
  }

  async prepareChunkUpload(
    sessionId: string,
    userId: string,
    chunkIndexInput: string | number | undefined,
  ) {
    const chunkIndex = this.normalizeChunkIndex(chunkIndexInput);
    const record = await this.syncSessionRecord(
      await this.getOwnedSessionRecord(sessionId, userId),
    );

    this.assertPendingUploadRecord(record);
    this.assertChunkIndexInRange(record, chunkIndex);
    await this.ensureUploadConversationAccess(userId, {
      receiverId: record.receiverId,
      groupId: record.groupId,
    });

    if (record.storageMode !== 'r2-multipart') {
      throw new BadRequestException(
        'This upload does not support direct multipart part uploads',
      );
    }

    if (record.uploadedChunks.includes(chunkIndex)) {
      return {
        ...this.serializeSession(record),
        chunkIndex,
        partNumber: chunkIndex + 1,
        uploadUrl: null,
        alreadyUploaded: true,
      };
    }

    this.assertNextChunk(record, chunkIndex);

    if (!record.remoteObjectKey || !record.remoteUploadId) {
      throw new BadRequestException(
        'Upload session is missing remote metadata',
      );
    }

    const partUpload =
      await this.chatAttachmentStorage.createMultipartPartUploadUrl({
        key: record.remoteObjectKey,
        uploadId: record.remoteUploadId,
        partNumber: chunkIndex + 1,
      });

    return {
      ...this.serializeSession(record),
      chunkIndex,
      uploadUrl: partUpload.uploadUrl,
      uploadHeaders: partUpload.headers,
      partNumber: partUpload.partNumber,
      alreadyUploaded: false,
    };
  }

  async completeChunkUpload(
    sessionId: string,
    userId: string,
    chunkIndexInput: string | number | undefined,
    input: { etag?: string; size?: number },
  ) {
    const chunkIndex = this.normalizeChunkIndex(chunkIndexInput);
    const record = await this.syncSessionRecord(
      await this.getOwnedSessionRecord(sessionId, userId),
    );

    this.assertPendingUploadRecord(record);
    this.assertChunkIndexInRange(record, chunkIndex);
    await this.ensureUploadConversationAccess(userId, {
      receiverId: record.receiverId,
      groupId: record.groupId,
    });

    if (record.storageMode !== 'r2-multipart') {
      throw new BadRequestException(
        'This upload does not support direct multipart part uploads',
      );
    }

    const expectedSize = this.getChunkByteLength(record, chunkIndex);
    const uploadedSize = Number(input.size);
    if (!Number.isFinite(uploadedSize) || uploadedSize !== expectedSize) {
      throw new BadRequestException(
        'Chunk size does not match the upload plan',
      );
    }

    const etag = String(input.etag || '').trim();
    if (!etag) {
      throw new BadRequestException('Chunk ETag is required');
    }

    if (record.uploadedChunks.includes(chunkIndex)) {
      const savedPart = this.getMultipartPart(record, chunkIndex);
      if (savedPart?.etag === etag) {
        return this.serializeSession(record);
      }
      throw new BadRequestException('Chunk upload is out of sync');
    }

    this.assertNextChunk(record, chunkIndex);

    record.uploadedChunks = [...record.uploadedChunks, chunkIndex].sort(
      (left, right) => left - right,
    );
    record.uploadedParts = [
      ...record.uploadedParts.filter(
        (part) => part.partNumber !== chunkIndex + 1,
      ),
      {
        partNumber: chunkIndex + 1,
        etag,
        size: uploadedSize,
      },
    ].sort((left, right) => left.partNumber - right.partNumber);
    record.updatedAt = new Date().toISOString();

    await this.writeSessionRecord(record);
    return this.serializeSession(record);
  }

  async uploadChunk(
    sessionId: string,
    userId: string,
    chunkIndexInput: string | number | undefined,
    chunk: { path: string; size: number } | undefined,
  ) {
    if (!chunk?.path || !chunk.size) {
      throw new BadRequestException('Chunk file is required');
    }

    let uploadedChunkMoved = false;
    const chunkIndex = this.normalizeChunkIndex(chunkIndexInput);
    try {
      const record = await this.syncSessionRecord(
        await this.getOwnedSessionRecord(sessionId, userId),
      );

      this.assertPendingUploadRecord(record);
      this.assertChunkIndexInRange(record, chunkIndex);

      const expectedSize = this.getChunkByteLength(record, chunkIndex);
      if (chunk.size > record.chunkSize || chunk.size !== expectedSize) {
        throw new BadRequestException(
          'Chunk size does not match the upload plan',
        );
      }

      await this.ensureUploadConversationAccess(userId, {
        receiverId: record.receiverId,
        groupId: record.groupId,
      });

      if (record.storageMode === 'r2-multipart') {
        throw new BadRequestException(
          'This upload session expects direct multipart uploads',
        );
      }

      if (record.uploadedChunks.includes(chunkIndex)) {
        return this.serializeSession(record);
      }

      const nextChunkIndex = this.getNextChunkIndex(record);
      if (nextChunkIndex === null) {
        return this.serializeSession(record);
      }
      if (chunkIndex !== nextChunkIndex) {
        throw new BadRequestException('Chunks must be uploaded in order');
      }

      if (record.storageMode === 'stream') {
        const assembledTempPath = this.getSessionAssembledTempPath(record.id);
        const expectedUploadedBytes = this.getUploadedBytes(record);

        if (chunkIndex === 0 && expectedUploadedBytes === 0) {
          await unlink(assembledTempPath).catch(() => undefined);
          await rename(chunk.path, assembledTempPath);
          uploadedChunkMoved = true;
        } else {
          const assembledStat = await stat(assembledTempPath).catch(() => null);
          if (!assembledStat || assembledStat.size !== expectedUploadedBytes) {
            throw new BadRequestException(
              'Upload session is out of sync. Please retry the upload.',
            );
          }

          await pipeline(
            createReadStream(chunk.path),
            createWriteStream(assembledTempPath, { flags: 'a' }),
          );

          const nextAssembledStat = await stat(assembledTempPath);
          if (nextAssembledStat.size !== expectedUploadedBytes + expectedSize) {
            throw new BadRequestException(
              'Upload session is incomplete. Please retry the upload.',
            );
          }
        }
      } else {
        await mkdir(this.getSessionChunksDirPath(record.id), {
          recursive: true,
        });
        const chunkPath = this.getChunkPath(record.id, chunkIndex);
        await unlink(chunkPath).catch(() => undefined);
        await rename(chunk.path, chunkPath);
        uploadedChunkMoved = true;
      }

      record.uploadedChunks = [...record.uploadedChunks, chunkIndex].sort(
        (left, right) => left - right,
      );
      record.updatedAt = new Date().toISOString();

      await this.writeSessionRecord(record);
      return this.serializeSession(record);
    } finally {
      if (!uploadedChunkMoved) {
        await unlink(chunk.path).catch(() => undefined);
      }
    }
  }

  private async finalizeMultipartSession(record: UploadSessionRecord) {
    if (!record.remoteObjectKey || !record.remoteUploadId) {
      throw new BadRequestException(
        'Upload session is missing remote metadata',
      );
    }
    if (record.uploadedParts.length !== record.totalChunks) {
      throw new BadRequestException('Upload is not complete yet');
    }

    const completedUpload =
      await this.chatAttachmentStorage.completeMultipartUpload({
        key: record.remoteObjectKey,
        uploadId: record.remoteUploadId,
        parts: record.uploadedParts,
      });

    return {
      fileUrl: completedUpload.fileUrl,
      finalPath: null,
      finalFileName: null,
    };
  }

  private async finalizeLocalSession(
    record: UploadSessionRecord,
    userId: string,
  ) {
    if (!record.finalFileName) {
      const { finalFileName } = this.getFinalAttachmentPath(
        record.fileName,
        userId,
      );
      record.finalFileName = finalFileName;
      record.updatedAt = new Date().toISOString();
      await this.writeSessionRecord(record);
    }

    const finalFileName = record.finalFileName;
    const finalPath = this.getResolvedFinalAttachmentPath(finalFileName);
    const assembledTempPath = this.getSessionAssembledTempPath(record.id);
    const tempPath = `${finalPath}.part`;

    await mkdir(resolveWritableDataPath('uploads', 'chat'), {
      recursive: true,
    });
    let finalFileExists = false;
    try {
      const finalStat = await stat(finalPath);
      if (finalStat.size !== record.fileSize) {
        await unlink(finalPath).catch(() => undefined);
      } else {
        finalFileExists = true;
      }
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

    if (!finalFileExists && record.storageMode === 'stream') {
      const assembledStat = await stat(assembledTempPath).catch(() => null);
      if (!assembledStat || assembledStat.size !== record.fileSize) {
        throw new BadRequestException('Uploaded file is incomplete');
      }

      await unlink(finalPath).catch(() => undefined);
      await rename(assembledTempPath, finalPath);
    }

    if (!finalFileExists && record.storageMode !== 'stream') {
      let nextChunkIndex = 0;
      try {
        const tempStat = await stat(tempPath);
        if (tempStat.size > 0) {
          nextChunkIndex = this.getCompletedChunkCountForAssembledBytes(
            record,
            tempStat.size,
          );
        } else {
          await unlink(tempPath).catch(() => undefined);
        }
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

      try {
        if (nextChunkIndex === 0 && record.totalChunks > 0) {
          const firstChunkPath = this.getChunkPath(record.id, 0);
          const firstChunkStat = await stat(firstChunkPath);
          const expectedSize = this.getChunkByteLength(record, 0);
          if (firstChunkStat.size !== expectedSize) {
            throw new BadRequestException(
              'One or more uploaded chunks are incomplete',
            );
          }

          await unlink(tempPath).catch(() => undefined);
          await rename(firstChunkPath, tempPath);
          nextChunkIndex = 1;
        }

        for (
          let chunkIndex = nextChunkIndex;
          chunkIndex < record.totalChunks;
          chunkIndex += 1
        ) {
          const chunkPath = this.getChunkPath(record.id, chunkIndex);
          const chunkStat = await stat(chunkPath);
          const expectedSize = this.getChunkByteLength(record, chunkIndex);

          if (chunkStat.size !== expectedSize) {
            throw new BadRequestException(
              'One or more uploaded chunks are incomplete',
            );
          }

          await pipeline(
            createReadStream(chunkPath),
            createWriteStream(tempPath, { flags: 'a' }),
          );
          await unlink(chunkPath).catch(() => undefined);
        }

        await rename(tempPath, finalPath);
      } catch (error) {
        const finalStat = await stat(finalPath).catch(() => null);
        if (!finalStat || finalStat.size !== record.fileSize) {
          throw error;
        }
      }
    }

    return {
      fileUrl: `/uploads/chat/${finalFileName}`,
      finalPath,
      finalFileName,
    };
  }

  async finalizeSession(sessionId: string, userId: string) {
    const record = await this.syncSessionRecord(
      await this.getOwnedSessionRecord(sessionId, userId),
    );

    this.assertPendingUploadRecord(record);

    const nextChunkIndex = this.getNextChunkIndex(record);
    if (nextChunkIndex !== null) {
      throw new BadRequestException('Upload is not complete yet');
    }

    await this.ensureUploadConversationAccess(userId, {
      receiverId: record.receiverId,
      groupId: record.groupId,
    });

    const finalizedAttachment =
      record.storageMode === 'r2-multipart'
        ? await this.finalizeMultipartSession(record)
        : await this.finalizeLocalSession(record, userId);

    let message;
    try {
      message = await this.chatService.createEncryptedMessage({
        senderId: userId,
        receiverId: record.receiverId ?? undefined,
        groupId: record.groupId ?? undefined,
        fileUrl: finalizedAttachment.fileUrl,
        fileName: record.fileName,
        fileMimeType: record.fileMimeType,
        fileSize: record.fileSize,
        messageType: resolveAttachmentMessageType(record.fileMimeType),
      });
    } catch (error) {
      if (record.storageMode === 'r2-multipart') {
        await this.chatAttachmentStorage
          .deleteAttachment(finalizedAttachment.fileUrl)
          .catch(() => undefined);
      } else if (finalizedAttachment.finalPath) {
        await unlink(finalizedAttachment.finalPath).catch(() => undefined);
      }
      throw error;
    }

    record.status = 'completed';
    record.fileUrl = finalizedAttachment.fileUrl;
    record.finalFileName = finalizedAttachment.finalFileName;
    record.updatedAt = new Date().toISOString();

    await this.writeSessionRecord(record);
    await this.cleanupSessionArtifacts(record);

    return message;
  }

  async cancelSession(sessionId: string, userId: string) {
    const record = await this.syncSessionRecord(
      await this.getOwnedSessionRecord(sessionId, userId),
    );

    if (record.status === 'completed') {
      throw new BadRequestException('Completed uploads cannot be cancelled');
    }

    if (
      record.storageMode === 'r2-multipart' &&
      record.remoteObjectKey &&
      record.remoteUploadId
    ) {
      await this.chatAttachmentStorage
        .abortMultipartUpload({
          key: record.remoteObjectKey,
          uploadId: record.remoteUploadId,
        })
        .catch(() => undefined);
    }

    record.status = 'cancelled';
    record.updatedAt = new Date().toISOString();
    await this.writeSessionRecord(record);
    await this.cleanupSessionArtifacts(record);

    return this.serializeSession(record);
  }
}
