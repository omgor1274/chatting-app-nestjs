import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { PushNotificationService } from '../notifications/push-notification.service';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';

type CreateMessageInput = {
    senderId: string;
    receiverId: string;
    ciphertext?: string;
    plainText?: string;
    encryptedKey?: string;
    iv?: string;
    algorithm?: string;
    fileUrl?: string;
    fileName?: string;
    fileMimeType?: string;
    fileSize?: number;
    messageType?: MessageType;
};

@Injectable()
export class ChatService {
    constructor(
        private prisma: PrismaService,
        private pushNotifications: PushNotificationService,
        private redisService: RedisService,
    ) { }

    async getMessages(currentUserId: string, otherUserEmail: string) {
        if (!otherUserEmail) {
            throw new BadRequestException('Email query parameter is required');
        }

        const otherUser = await this.prisma.user.findUnique({
            where: { email: otherUserEmail },
            select: {
                id: true,
                email: true,
                name: true,
                avatar: true,
                publicKey: true,
            },
        });

        if (!otherUser) {
            throw new NotFoundException('User not found');
        }

        const messages = await this.prisma.message.findMany({
            where: {
                OR: [
                    {
                        senderId: currentUserId,
                        receiverId: otherUser.id,
                    },
                    {
                        senderId: otherUser.id,
                        receiverId: currentUserId,
                    },
                ],
            },
            orderBy: { createdAt: 'asc' },
        });

        return {
            otherUser,
            messages,
        };
    }

    async getPendingRequests(userId: string) {
        return this.prisma.chatRequest.findMany({
            where: {
                receiverId: userId,
                status: 'PENDING',
            },
            orderBy: { createdAt: 'desc' },
        });
    }

    async getChatPermission(currentUserId: string, otherUserId: string) {
        const [incomingRequest, outgoingRequest, acceptedRequest] = await Promise.all([
            this.prisma.chatRequest.findFirst({
                where: {
                    senderId: otherUserId,
                    receiverId: currentUserId,
                    status: 'PENDING',
                },
                orderBy: { createdAt: 'desc' },
            }),
            this.prisma.chatRequest.findFirst({
                where: {
                    senderId: currentUserId,
                    receiverId: otherUserId,
                    status: 'PENDING',
                },
                orderBy: { createdAt: 'desc' },
            }),
            this.prisma.chatRequest.findFirst({
                where: {
                    status: 'ACCEPTED',
                    OR: [
                        {
                            senderId: currentUserId,
                            receiverId: otherUserId,
                        },
                        {
                            senderId: otherUserId,
                            receiverId: currentUserId,
                        },
                    ],
                },
                orderBy: { createdAt: 'desc' },
            }),
        ]);

        return {
            canChat: Boolean(acceptedRequest),
            acceptedRequestId: acceptedRequest?.id ?? null,
            incomingRequestId: incomingRequest?.id ?? null,
            outgoingRequestId: outgoingRequest?.id ?? null,
        };
    }

    async getRecentChats(userId: string) {
        let entries: string[] = [];
        try {
            const redis = await this.redisService.getClient();
            entries = await redis.zrevrange(`recent-chats:${userId}`, 0, 49);
        } catch {
            return [];
        }

        if (entries.length === 0) {
            return [];
        }

        const recentChats = entries
            .map((entry) => {
                try {
                    return JSON.parse(entry);
                } catch {
                    return null;
                }
            })
            .filter(Boolean) as Array<{
                chatUserId: string;
                lastMessagePreview: string;
                lastMessageAt: string;
                lastMessageType: MessageType;
            }>;

        const userIds = recentChats.map((item) => item.chatUserId);
        const [users, preferences] = await Promise.all([
            this.prisma.user.findMany({
                where: { id: { in: userIds } },
                select: {
                    id: true,
                    email: true,
                    name: true,
                    avatar: true,
                },
            }),
            this.prisma.contactPreference.findMany({
                where: {
                    ownerId: userId,
                    contactUserId: { in: userIds },
                },
                select: {
                    contactUserId: true,
                    nickname: true,
                },
            }),
        ]);

        const userById = new Map(users.map((user) => [user.id, user]));
        const nicknameByUserId = new Map(preferences.map((item) => [item.contactUserId, item.nickname]));

        return recentChats
            .map((item) => {
                const user = userById.get(item.chatUserId);
                if (!user) {
                    return null;
                }

                const nickname = nicknameByUserId.get(user.id) ?? null;
                return {
                    ...user,
                    nickname,
                    displayName: nickname ?? user.name,
                    lastMessagePreview: item.lastMessagePreview,
                    lastMessageAt: item.lastMessageAt,
                    lastMessageType: item.lastMessageType,
                };
            })
            .filter(Boolean);
    }

    private async cacheRecentChat(userId: string, chatUserId: string, payload: {
        lastMessagePreview: string;
        lastMessageAt: string;
        lastMessageType: MessageType;
    }) {
        try {
            const redis = await this.redisService.getClient();
            const cacheKey = `recent-chats:${userId}`;

            const existingEntries = await redis.zrange(cacheKey, 0, -1);
            const chatEntries = existingEntries.filter((entry) => {
                try {
                    const parsed = JSON.parse(entry);
                    return parsed.chatUserId === chatUserId;
                } catch {
                    return false;
                }
            });

            if (chatEntries.length > 0) {
                await redis.zrem(cacheKey, ...chatEntries);
            }

            const score = new Date(payload.lastMessageAt).getTime();
            await redis.zadd(
                cacheKey,
                score,
                JSON.stringify({
                    chatUserId,
                    ...payload,
                }),
            );
            await redis.expire(cacheKey, 60 * 60 * 24 * 30);
        } catch {
            return;
        }
    }

    async sendRequest(senderId: string, receiverEmail: string) {
        if (!receiverEmail) {
            throw new BadRequestException('Receiver email is required');
        }

        const receiver = await this.prisma.user.findUnique({
            where: { email: receiverEmail },
            select: { id: true, email: true, publicKey: true },
        });

        if (!receiver) {
            throw new NotFoundException('User not found');
        }

        if (receiver.id === senderId) {
            throw new BadRequestException('Cannot send request to yourself');
        }

        const existing = await this.prisma.chatRequest.findFirst({
            where: {
                OR: [
                    {
                        senderId,
                        receiverId: receiver.id,
                    },
                    {
                        senderId: receiver.id,
                        receiverId: senderId,
                    },
                ],
            },
            orderBy: { createdAt: 'desc' },
        });

        if (existing) {
            if (existing.status === 'PENDING') {
                throw new BadRequestException('A pending request already exists between these users');
            }

            if (existing.status === 'ACCEPTED') {
                throw new BadRequestException('Chat request already accepted');
            }

            return this.prisma.chatRequest.update({
                where: { id: existing.id },
                data: {
                    senderId,
                    receiverId: receiver.id,
                    status: 'PENDING',
                },
            });
        }

        return this.prisma.chatRequest.create({
            data: {
                senderId,
                receiverId: receiver.id,
                status: 'PENDING',
            },
        });
    }

    async acceptRequest(requestId: string, userId: string) {
        const request = await this.prisma.chatRequest.findUnique({
            where: { id: requestId },
        });

        if (!request) {
            throw new NotFoundException('Request not found');
        }

        if (request.receiverId !== userId) {
            throw new ForbiddenException('Unauthorized');
        }

        if (request.status !== 'PENDING') {
            throw new BadRequestException('Only pending requests can be accepted');
        }

        return this.prisma.chatRequest.update({
            where: { id: requestId },
            data: { status: 'ACCEPTED' },
        });
    }

    async rejectRequest(requestId: string, userId: string) {
        const request = await this.prisma.chatRequest.findUnique({
            where: { id: requestId },
        });

        if (!request) {
            throw new NotFoundException('Request not found');
        }

        if (request.receiverId !== userId) {
            throw new ForbiddenException('Unauthorized');
        }

        if (request.status !== 'PENDING') {
            throw new BadRequestException('Only pending requests can be rejected');
        }

        return this.prisma.chatRequest.update({
            where: { id: requestId },
            data: { status: 'REJECTED' },
        });
    }

    async createEncryptedMessage(input: CreateMessageInput) {
        const sender = await this.prisma.user.findUnique({
            where: { id: input.senderId },
            select: { id: true, name: true, email: true },
        });

        if (!sender) {
            throw new NotFoundException('Sender not found');
        }

        const receiver = await this.prisma.user.findUnique({
            where: { id: input.receiverId },
            select: { id: true, publicKey: true, name: true, email: true },
        });

        if (!receiver) {
            throw new NotFoundException('Receiver not found');
        }

        if (input.senderId === input.receiverId) {
            throw new BadRequestException('Cannot send a message to yourself');
        }

        const permission = await this.getChatPermission(input.senderId, receiver.id);

        if (!permission.canChat) {
            throw new ForbiddenException('Accept a chat request before messaging');
        }

        const messageType = input.messageType ?? MessageType.TEXT;
        const hasEncryptedText = Boolean(input.ciphertext?.trim());
        const hasPlainText = Boolean(input.plainText?.trim());
        const hasAttachment = Boolean(input.fileUrl);

        if (!hasEncryptedText && !hasPlainText && !hasAttachment) {
            throw new BadRequestException('Message content or attachment is required');
        }

        if (messageType === MessageType.TEXT && !hasEncryptedText && !hasPlainText) {
            throw new BadRequestException('Text messages require content');
        }

        const createdMessage = await this.prisma.message.create({
            data: {
                content: hasPlainText ? input.plainText?.trim() : null,
                ciphertext: hasEncryptedText ? input.ciphertext?.trim() : null,
                senderId: input.senderId,
                receiverId: receiver.id,
                messageType,
                fileUrl: input.fileUrl ?? null,
                fileName: input.fileName ?? null,
                fileMimeType: input.fileMimeType ?? null,
                fileSize: input.fileSize ?? null,
                encryptedKey: input.encryptedKey?.trim() || null,
                iv: input.iv?.trim() || null,
                algorithm: input.algorithm?.trim() || null,
                isEncrypted: hasEncryptedText || Boolean(input.encryptedKey) || Boolean(input.iv),
            },
        });

        const preview = createdMessage.messageType === MessageType.IMAGE
            ? 'Sent you an image'
            : createdMessage.messageType === MessageType.DOCUMENT
                ? `Sent you ${createdMessage.fileName ?? 'a file'}`
                : (createdMessage.content ?? createdMessage.ciphertext ?? 'New message');

        await Promise.all([
            this.cacheRecentChat(sender.id, receiver.id, {
                lastMessagePreview: preview,
                lastMessageAt: createdMessage.createdAt.toISOString(),
                lastMessageType: createdMessage.messageType,
            }),
            this.cacheRecentChat(receiver.id, sender.id, {
                lastMessagePreview: preview,
                lastMessageAt: createdMessage.createdAt.toISOString(),
                lastMessageType: createdMessage.messageType,
            }),
        ]);

        await this.pushNotifications.notifyUser(receiver.id, {
            title: sender.name || sender.email,
            body: preview,
            tag: `chat-${sender.id}-${receiver.id}`,
            url: `/?chat=${sender.id}`,
        });

        return createdMessage;
    }
}
