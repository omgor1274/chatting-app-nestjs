import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { basename, extname } from 'path';
import { resolveWritableDataPath } from '../common/app-paths';

type DirectAttachmentInput = {
  buffer: Buffer;
  fileName: string;
  fileMimeType: string;
  userId: string;
};

type DirectManagedFileInput = DirectAttachmentInput & {
  localRelativePrefix: string;
  localStorageSegments: string[];
  remoteDirectory: string;
};

type MultipartUploadInput = {
  fileName: string;
  fileMimeType: string;
  userId: string;
};

type MultipartUploadPart = {
  partNumber: number;
  etag: string;
};

type StoredAttachment = {
  fileUrl: string;
  storageProvider: 'local' | 'cloudflare-r2';
};

type MultipartUploadDescriptor = StoredAttachment & {
  key: string;
  uploadId: string;
};

type R2Config = {
  accountId: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
  presignExpiresSeconds: number;
};

@Injectable()
export class ChatAttachmentStorageService {
  private readonly logger = new Logger(ChatAttachmentStorageService.name);
  private readonly r2Config = this.resolveR2Config();
  private readonly r2Client = this.r2Config
    ? new S3Client({
        region: 'auto',
        endpoint: `https://${this.r2Config.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: this.r2Config.accessKeyId,
          secretAccessKey: this.r2Config.secretAccessKey,
        },
      })
    : null;

  isR2Enabled() {
    return Boolean(this.r2Client && this.r2Config);
  }

  getUploadTransport() {
    return this.isR2Enabled() ? 'presigned-put' : 'server-relay';
  }

  getStorageProvider() {
    return this.isR2Enabled() ? 'cloudflare-r2' : 'local';
  }

  async storeDirectAttachment(input: DirectAttachmentInput) {
    return this.storeDirectFile({
      ...input,
      localRelativePrefix: '/uploads/chat/',
      localStorageSegments: ['uploads', 'chat'],
      remoteDirectory: 'chat',
    });
  }

  async storeUserAvatar(input: DirectAttachmentInput) {
    return this.storeDirectFile({
      ...input,
      localRelativePrefix: '/uploads/avatars/',
      localStorageSegments: ['uploads', 'avatars'],
      remoteDirectory: 'avatars',
    });
  }

  async createMultipartUpload(input: MultipartUploadInput) {
    if (!this.r2Client || !this.r2Config) {
      throw new Error('Cloudflare R2 is not configured');
    }

    const key = this.buildRemoteObjectKey(input.fileName, input.userId);
    const response = await this.r2Client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.r2Config.bucketName,
        Key: key,
        ContentType: input.fileMimeType,
      }),
    );

    if (!response.UploadId) {
      throw new Error('Failed to create a multipart upload in Cloudflare R2');
    }

    return {
      key,
      uploadId: response.UploadId,
      fileUrl: this.buildPublicFileUrl(key),
      storageProvider: 'cloudflare-r2',
    } satisfies MultipartUploadDescriptor;
  }

  async createMultipartPartUploadUrl(input: {
    key: string;
    uploadId: string;
    partNumber: number;
  }) {
    if (!this.r2Client || !this.r2Config) {
      throw new Error('Cloudflare R2 is not configured');
    }

    const uploadUrl = await getSignedUrl(
      this.r2Client,
      new UploadPartCommand({
        Bucket: this.r2Config.bucketName,
        Key: input.key,
        UploadId: input.uploadId,
        PartNumber: input.partNumber,
      }),
      { expiresIn: this.r2Config.presignExpiresSeconds },
    );

    return {
      uploadUrl,
      partNumber: input.partNumber,
      headers: {},
    };
  }

  async completeMultipartUpload(input: {
    key: string;
    uploadId: string;
    parts: MultipartUploadPart[];
  }) {
    if (!this.r2Client || !this.r2Config) {
      throw new Error('Cloudflare R2 is not configured');
    }

    await this.r2Client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.r2Config.bucketName,
        Key: input.key,
        UploadId: input.uploadId,
        MultipartUpload: {
          Parts: [...input.parts]
            .sort((left, right) => left.partNumber - right.partNumber)
            .map((part) => ({
              PartNumber: part.partNumber,
              ETag: `"${this.normalizeMultipartEtag(part.etag)}"`,
            })),
        },
      }),
    );

    return {
      fileUrl: this.buildPublicFileUrl(input.key),
      storageProvider: 'cloudflare-r2',
    } satisfies StoredAttachment;
  }

  async abortMultipartUpload(input: { key: string; uploadId: string }) {
    if (!this.r2Client || !this.r2Config) {
      return;
    }

    await this.r2Client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.r2Config.bucketName,
        Key: input.key,
        UploadId: input.uploadId,
      }),
    );
  }

  async deleteAttachment(fileUrl?: string | null) {
    if (!fileUrl) {
      return;
    }

    if (this.isR2Enabled()) {
      const remoteKey = this.extractRemoteObjectKey(fileUrl);
      if (remoteKey) {
        await this.deleteRemoteObject(remoteKey);
        return;
      }
    }

    const localFileName = this.extractLocalAttachmentFileName(fileUrl);
    if (!localFileName) {
      return;
    }

    await unlink(
      resolveWritableDataPath('uploads', 'chat', localFileName),
    ).catch(() => undefined);
  }

  private resolveR2Config() {
    const accountId = process.env.R2_ACCOUNT_ID?.trim() || '';
    const bucketName = process.env.R2_BUCKET_NAME?.trim() || '';
    const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() || '';
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim() || '';
    const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.trim() || '';
    const configuredValues = [
      accountId,
      bucketName,
      accessKeyId,
      secretAccessKey,
      publicBaseUrl,
    ];

    if (configuredValues.every((value) => !value)) {
      return null;
    }

    const missingFields = [
      !accountId ? 'R2_ACCOUNT_ID' : null,
      !bucketName ? 'R2_BUCKET_NAME' : null,
      !accessKeyId ? 'R2_ACCESS_KEY_ID' : null,
      !secretAccessKey ? 'R2_SECRET_ACCESS_KEY' : null,
      !publicBaseUrl ? 'R2_PUBLIC_BASE_URL' : null,
    ].filter(Boolean);

    if (missingFields.length) {
      this.logger.warn(
        `Cloudflare R2 upload support is disabled because these env vars are missing: ${missingFields.join(', ')}`,
      );
      return null;
    }

    const normalizedPublicBaseUrl = publicBaseUrl.replace(/\/+$/, '');
    const expiresInput = Number(process.env.R2_PRESIGN_EXPIRES_SECONDS);

    return {
      accountId,
      bucketName,
      accessKeyId,
      secretAccessKey,
      publicBaseUrl: normalizedPublicBaseUrl,
      presignExpiresSeconds:
        Number.isFinite(expiresInput) && expiresInput > 0
          ? Math.min(Math.trunc(expiresInput), 60 * 60)
          : 15 * 60,
    } satisfies R2Config;
  }

  private buildSafeFileName(fileName: string, userId: string) {
    const safeBaseName = basename(fileName || 'attachment').replace(
      /[^a-zA-Z0-9._-]/g,
      '_',
    );
    const extension = extname(safeBaseName);
    const baseWithoutExtension = safeBaseName.slice(
      0,
      safeBaseName.length - extension.length,
    );
    const uniqueSuffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;

    return `${userId}-${baseWithoutExtension || 'attachment'}-${uniqueSuffix}${extension}`;
  }

  private buildRemoteObjectKey(
    fileName: string,
    userId: string,
    remoteDirectory = 'chat',
  ) {
    const datePrefix = new Date()
      .toISOString()
      .slice(0, 10)
      .replaceAll('-', '/');
    return `${remoteDirectory}/${userId}/${datePrefix}/${this.buildSafeFileName(fileName, userId)}`;
  }

  private buildPublicFileUrl(key: string) {
    if (!this.r2Config) {
      throw new Error('Cloudflare R2 is not configured');
    }

    const encodedKey = key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');

    return `${this.r2Config.publicBaseUrl}/${encodedKey}`;
  }

  private normalizeMultipartEtag(etag: string) {
    return String(etag || '')
      .trim()
      .replace(/^"+|"+$/g, '');
  }

  private async storeDirectFile(input: DirectManagedFileInput) {
    if (this.isR2Enabled()) {
      return this.storeDirectFileInR2(input);
    }

    return this.storeDirectFileLocally(input);
  }

  private async storeDirectFileInR2(input: DirectManagedFileInput) {
    if (!this.r2Client || !this.r2Config) {
      throw new Error('Cloudflare R2 is not configured');
    }

    const key = this.buildRemoteObjectKey(
      input.fileName,
      input.userId,
      input.remoteDirectory,
    );
    await this.r2Client.send(
      new PutObjectCommand({
        Bucket: this.r2Config.bucketName,
        Key: key,
        Body: input.buffer,
        ContentType: input.fileMimeType,
      }),
    );

    return {
      fileUrl: this.buildPublicFileUrl(key),
      storageProvider: 'cloudflare-r2',
    } satisfies StoredAttachment;
  }

  private async storeDirectFileLocally(input: DirectManagedFileInput) {
    const fileName = this.buildSafeFileName(input.fileName, input.userId);
    const targetPath = resolveWritableDataPath(
      ...input.localStorageSegments,
      fileName,
    );
    await mkdir(resolveWritableDataPath(...input.localStorageSegments), {
      recursive: true,
    });
    await writeFile(targetPath, input.buffer);

    return {
      fileUrl: `${input.localRelativePrefix}${fileName}`,
      storageProvider: 'local',
    } satisfies StoredAttachment;
  }

  private extractRemoteObjectKey(fileUrl: string) {
    if (!this.r2Config) {
      return null;
    }

    const prefix = `${this.r2Config.publicBaseUrl}/`;
    if (!String(fileUrl).startsWith(prefix)) {
      return null;
    }

    return String(fileUrl)
      .slice(prefix.length)
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/');
  }

  private async deleteRemoteObject(key: string) {
    if (!this.r2Client || !this.r2Config) {
      return;
    }

    await this.r2Client.send(
      new DeleteObjectCommand({
        Bucket: this.r2Config.bucketName,
        Key: key,
      }),
    );
  }

  private extractLocalAttachmentFileName(fileUrl: string) {
    const relativePrefix = '/uploads/chat/';
    if (String(fileUrl).startsWith(relativePrefix)) {
      return basename(
        decodeURIComponent(String(fileUrl).slice(relativePrefix.length)),
      );
    }

    return null;
  }
}
