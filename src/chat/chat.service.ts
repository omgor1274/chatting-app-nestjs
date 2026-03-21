//om
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GroupJoinRequestStatus,
  GroupMemberRole,
  MessageType,
} from '@prisma/client';
import { PushNotificationService } from '../notifications/push-notification.service';
import { PrismaService } from '../prisma/prisma.service';

const MESSAGE_PAGE_SIZE = 25;
const DELETE_FOR_EVERYONE_WINDOW_MS = 5 * 60 * 1000;

@Injectable()
export class ChatService {
  constructor(
    private prisma: PrismaService,
    private pushNotifications: PushNotificationService,
  ) {}

  private normalizeBefore(before?: string) {
    if (!before) return undefined;
    const beforeDate = new Date(before);
    if (Number.isNaN(beforeDate.getTime())) {
      throw new BadRequestException('Invalid before cursor');
    }
    return beforeDate;
  }

  private previewForMessage(message: {
    deletedForEveryoneAt?: Date | null;
    messageType: MessageType;
    fileName?: string | null;
    fileMimeType?: string | null;
    content?: string | null;
    ciphertext?: string | null;
    isEncrypted?: boolean;
  }) {
    if (message.deletedForEveryoneAt) return 'Message deleted';
    if (message.messageType === MessageType.IMAGE) return 'Sent you an image';
    if (message.messageType === MessageType.AUDIO)
      return 'Sent you a voice message';
    if (message.messageType === MessageType.DOCUMENT) {
      return message.fileMimeType?.startsWith('video/')
        ? 'Sent you a video'
        : `Sent you ${message.fileName ?? 'a file'}`;
    }
    if (message.isEncrypted) return 'Encrypted message';
    return message.content ?? message.ciphertext ?? 'New message';
  }

  private async getBlockState(currentUserId: string, otherUserId: string) {
    const blocks = await this.prisma.userBlock.findMany({
      where: {
        OR: [
          { blockerId: currentUserId, blockedUserId: otherUserId },
          { blockerId: otherUserId, blockedUserId: currentUserId },
        ],
      },
      select: { blockerId: true, blockedUserId: true },
    });

    return {
      blockedByMe: blocks.some(
        (block) =>
          block.blockerId === currentUserId &&
          block.blockedUserId === otherUserId,
      ),
      blockedByUser: blocks.some(
        (block) =>
          block.blockerId === otherUserId &&
          block.blockedUserId === currentUserId,
      ),
    };
  }

  private async getHiddenDirectUserIds(userId: string) {
    const blocks = await this.prisma.userBlock.findMany({
      where: { blockedUserId: userId },
      select: { blockerId: true },
    });
    return new Set(blocks.map((block) => block.blockerId));
  }

  private async ensureDirectPeer(
    currentUserId: string,
    otherUserEmail?: string,
    otherUserId?: string,
  ) {
    const otherUser = await this.prisma.user.findFirst({
      where: otherUserId
        ? { id: otherUserId }
        : otherUserEmail
          ? { email: otherUserEmail.trim().toLowerCase() }
          : undefined,
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        publicKey: true,
      },
    });

    if (!otherUser) throw new NotFoundException('User not found');
    if (otherUser.id === currentUserId) {
      throw new BadRequestException('Cannot open a chat with yourself');
    }
    const blockState = await this.getBlockState(currentUserId, otherUser.id);
    if (blockState.blockedByUser) {
      throw new NotFoundException('User not found');
    }
    return otherUser;
  }

  private async ensureGroupMember(
    groupId: string,
    userId: string,
    adminRequired = false,
  ) {
    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      include: {
        group: {
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    avatar: true,
                    publicKey: true,
                  },
                },
              },
            },
            joinRequests: {
              where: { status: GroupJoinRequestStatus.PENDING },
              include: {
                invitedUser: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    avatar: true,
                  },
                },
              },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this group');
    }
    if (adminRequired && membership.role !== GroupMemberRole.ADMIN) {
      throw new ForbiddenException('Only group admins can do that');
    }
    return membership;
  }

  private pickNextGroupOwner(
    members: Array<{
      userId: string;
      role: GroupMemberRole;
      joinedAt: Date;
    }>,
  ) {
    return [...members].sort((left, right) => {
      if (
        left.role === GroupMemberRole.ADMIN &&
        right.role !== GroupMemberRole.ADMIN
      ) {
        return -1;
      }
      if (
        left.role !== GroupMemberRole.ADMIN &&
        right.role === GroupMemberRole.ADMIN
      ) {
        return 1;
      }
      return left.joinedAt.getTime() - right.joinedAt.getTime();
    })[0];
  }

  private serializeGroup(
    membership: Awaited<ReturnType<ChatService['ensureGroupMember']>>,
  ) {
    return {
      id: membership.group.id,
      chatType: 'group',
      name: membership.group.name,
      avatar: membership.group.avatar,
      createdById: membership.group.createdById,
      role: membership.role,
      memberCount: membership.group.members.length,
      members: membership.group.members.map((member) => ({
        userId: member.userId,
        role: member.role,
        joinedAt: member.joinedAt,
        lastReadAt: member.lastReadAt,
        name: member.user.name,
        email: member.user.email,
        avatar: member.user.avatar,
        publicKey: member.user.publicKey,
      })),
      pendingInvites:
        membership.role === GroupMemberRole.ADMIN
          ? membership.group.joinRequests.map((invite) => ({
              id: invite.id,
              invitedUserId: invite.invitedUserId,
              createdAt: invite.createdAt,
              invitedUser: invite.invitedUser,
            }))
          : [],
    };
  }

  private serializeDirectMessage(message: any, currentUserId: string) {
    return {
      ...message,
      readByCount: message.senderId === currentUserId && message.readAt ? 1 : 0,
      recipientCount: message.receiverId ? 1 : 0,
    };
  }

  private serializeGroupMessages(messages: any[], members: any[]) {
    return messages.map((message) => {
      const messageCreatedAt = new Date(message.createdAt).getTime();
      const others = members.filter(
        (member) =>
          member.userId !== message.senderId &&
          new Date(member.joinedAt).getTime() <= messageCreatedAt,
      );
      const readByCount = others.filter(
        (member) =>
          member.lastReadAt && member.lastReadAt.getTime() >= messageCreatedAt,
      ).length;
      return {
        ...message,
        readByCount,
        recipientCount: others.length,
      };
    });
  }

  async getMessages(
    currentUserId: string,
    options: {
      otherUserEmail?: string;
      otherUserId?: string;
      groupId?: string;
      before?: string;
    },
  ) {
    const beforeDate = this.normalizeBefore(options.before);
    if (options.groupId) {
      const membership = await this.ensureGroupMember(
        options.groupId,
        currentUserId,
      );
      const createdAtFilter = {
        gte: membership.joinedAt,
        ...(beforeDate ? { lt: beforeDate } : {}),
      };
      const messages = await this.prisma.message.findMany({
        where: {
          groupId: options.groupId,
          hiddenForUsers: { none: { userId: currentUserId } },
          createdAt: createdAtFilter,
        },
        orderBy: { createdAt: 'desc' },
        take: MESSAGE_PAGE_SIZE + 1,
      });
      const hasMore = messages.length > MESSAGE_PAGE_SIZE;
      const trimmed = (
        hasMore ? messages.slice(0, MESSAGE_PAGE_SIZE) : messages
      ).reverse();
      const group = this.serializeGroup(membership);
      return {
        conversation: group,
        group,
        otherUser: null,
        messages: this.serializeGroupMessages(
          trimmed,
          membership.group.members,
        ),
        hasMore,
        nextBefore: hasMore
          ? (trimmed[0]?.createdAt?.toISOString() ?? null)
          : null,
      };
    }

    const otherUser = await this.ensureDirectPeer(
      currentUserId,
      options.otherUserEmail,
      options.otherUserId,
    );
    const [messages, preference] = await Promise.all([
      this.prisma.message.findMany({
        where: {
          groupId: null,
          hiddenForUsers: { none: { userId: currentUserId } },
          OR: [
            { senderId: currentUserId, receiverId: otherUser.id },
            { senderId: otherUser.id, receiverId: currentUserId },
          ],
          ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: MESSAGE_PAGE_SIZE + 1,
      }),
      this.prisma.contactPreference.findUnique({
        where: {
          ownerId_contactUserId: {
            ownerId: currentUserId,
            contactUserId: otherUser.id,
          },
        },
      }),
    ]);
    const hasMore = messages.length > MESSAGE_PAGE_SIZE;
    const trimmed = (
      hasMore ? messages.slice(0, MESSAGE_PAGE_SIZE) : messages
    ).reverse();
    const conversation = {
      ...otherUser,
      chatType: 'direct',
      nickname: preference?.nickname ?? null,
      displayName: preference?.nickname ?? otherUser.name,
      chatTheme: preference?.chatTheme ?? null,
    };
    return {
      conversation,
      group: null,
      otherUser: conversation,
      messages: trimmed.map((message) =>
        this.serializeDirectMessage(message, currentUserId),
      ),
      hasMore,
      nextBefore: hasMore
        ? (trimmed[0]?.createdAt?.toISOString() ?? null)
        : null,
    };
  }

  async getPendingRequests(userId: string) {
    return this.prisma.chatRequest.findMany({
      where: { receiverId: userId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getGroupInvites(userId: string) {
    const invites = await this.prisma.groupJoinRequest.findMany({
      where: {
        invitedUserId: userId,
        status: GroupJoinRequestStatus.PENDING,
      },
      include: {
        group: true,
        invitedBy: {
          select: { id: true, name: true, email: true, avatar: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return invites.map((invite) => ({
      id: invite.id,
      createdAt: invite.createdAt,
      groupId: invite.groupId,
      group: {
        id: invite.group.id,
        name: invite.group.name,
        avatar: invite.group.avatar,
      },
      invitedBy: invite.invitedBy,
    }));
  }

  async getChatPermission(currentUserId: string, otherUserId: string) {
    const blockState = await this.getBlockState(currentUserId, otherUserId);
    if (blockState.blockedByMe || blockState.blockedByUser) {
      return {
        canChat: false,
        acceptedRequestId: null,
        incomingRequestId: null,
        outgoingRequestId: null,
        blockedByMe: blockState.blockedByMe,
        blockedByUser: blockState.blockedByUser,
      };
    }

    const [incomingRequest, outgoingRequest, acceptedRequest] =
      await Promise.all([
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
              { senderId: currentUserId, receiverId: otherUserId },
              { senderId: otherUserId, receiverId: currentUserId },
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
      blockedByMe: false,
      blockedByUser: false,
    };
  }

  async assertUsersCanChat(currentUserId: string, otherUserId: string) {
    const permission = await this.getChatPermission(currentUserId, otherUserId);
    if (permission.blockedByMe) {
      throw new ForbiddenException(
        'Unblock this user before using this feature',
      );
    }
    if (permission.blockedByUser) {
      throw new ForbiddenException('This user has blocked you');
    }
    if (!permission.canChat) {
      throw new ForbiddenException(
        'Accept a chat request before using this feature',
      );
    }
    return permission;
  }

  async getGroups(userId: string) {
    const memberships = await this.prisma.groupMember.findMany({
      where: { userId },
      include: {
        group: {
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    avatar: true,
                    publicKey: true,
                  },
                },
              },
            },
            joinRequests: {
              where: { status: GroupJoinRequestStatus.PENDING },
              include: {
                invitedUser: {
                  select: { id: true, name: true, email: true, avatar: true },
                },
              },
            },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    return memberships.map((membership) => this.serializeGroup(membership));
  }

  async getGroupDetails(userId: string, groupId: string) {
    return this.serializeGroup(await this.ensureGroupMember(groupId, userId));
  }

  async getRecentChats(userId: string) {
    const hiddenDirectUserIds = await this.getHiddenDirectUserIds(userId);
    const groupMemberships = await this.prisma.groupMember.findMany({
      where: { userId },
      include: {
        group: {
          include: { members: true },
        },
      },
    });
    const groupIds = groupMemberships.map((item) => item.groupId);
    const [directMessages, directUsers, preferences, groupMessages] =
      await Promise.all([
        this.prisma.message.findMany({
          where: {
            groupId: null,
            hiddenForUsers: { none: { userId } },
            OR: [{ senderId: userId }, { receiverId: userId }],
          },
          orderBy: { createdAt: 'desc' },
          take: 250,
        }),
        this.prisma.user.findMany({
          where: {
            id: {
              not: userId,
              notIn: Array.from(hiddenDirectUserIds),
            },
            emailVerified: true,
          },
          select: { id: true, email: true, name: true, avatar: true },
        }),
        this.prisma.contactPreference.findMany({
          where: { ownerId: userId },
          select: { contactUserId: true, nickname: true, chatTheme: true },
        }),
        groupIds.length
          ? this.prisma.message.findMany({
              where: {
                groupId: { in: groupIds },
                hiddenForUsers: { none: { userId } },
              },
              orderBy: { createdAt: 'desc' },
              take: 250,
            })
          : Promise.resolve([]),
      ]);
    const groupJoinedAtById = new Map(
      groupMemberships.map((membership) => [
        membership.groupId,
        membership.joinedAt.getTime(),
      ]),
    );

    const latestDirectByPeer = new Map();
    for (const message of directMessages) {
      const peerId =
        message.senderId === userId ? message.receiverId : message.senderId;
      if (peerId && !latestDirectByPeer.has(peerId))
        latestDirectByPeer.set(peerId, message);
    }
    const preferenceByUserId = new Map(
      preferences.map((item) => [item.contactUserId, item]),
    );
    const directEntries = directUsers.map((user) => {
      const latest = latestDirectByPeer.get(user.id);
      const preference = preferenceByUserId.get(user.id);
      return {
        id: user.id,
        chatType: 'direct',
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        nickname: preference?.nickname ?? null,
        displayName: preference?.nickname ?? user.name,
        chatTheme: preference?.chatTheme ?? null,
        lastMessagePreview: latest ? this.previewForMessage(latest) : '',
        lastMessageAt: latest?.createdAt?.toISOString() ?? null,
        lastMessageType: latest?.messageType ?? null,
      };
    });

    const latestGroupById = new Map();
    for (const message of groupMessages) {
      if (
        message.groupId &&
        groupJoinedAtById.has(message.groupId) &&
        new Date(message.createdAt).getTime() >=
          (groupJoinedAtById.get(message.groupId) ?? 0) &&
        !latestGroupById.has(message.groupId)
      ) {
        latestGroupById.set(message.groupId, message);
      }
    }
    const groupEntries = groupMemberships.map((membership) => {
      const latest = latestGroupById.get(membership.groupId);
      return {
        id: membership.group.id,
        chatType: 'group',
        name: membership.group.name,
        avatar: membership.group.avatar,
        role: membership.role,
        memberCount: membership.group.members.length,
        lastReadAt: membership.lastReadAt,
        lastMessagePreview: latest
          ? this.previewForMessage(latest)
          : 'You joined the group',
        lastMessageAt:
          latest?.createdAt?.toISOString() ?? membership.joinedAt.toISOString(),
        lastMessageType: latest?.messageType ?? null,
      };
    });

    return [...directEntries, ...groupEntries].sort((a, b) => {
      const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bTime - aTime;
    });
  }

  async sendRequest(senderId: string, receiverEmail: string) {
    if (!receiverEmail) {
      throw new BadRequestException('Receiver email is required');
    }
    const receiver = await this.prisma.user.findUnique({
      where: { email: receiverEmail.trim().toLowerCase() },
      select: { id: true },
    });
    if (!receiver) throw new NotFoundException('User not found');
    if (receiver.id === senderId) {
      throw new BadRequestException('Cannot send request to yourself');
    }

    const blockState = await this.getBlockState(senderId, receiver.id);
    if (blockState.blockedByMe) {
      throw new BadRequestException(
        'Unblock this user before sending a request',
      );
    }
    if (blockState.blockedByUser) {
      throw new ForbiddenException('This user has blocked you');
    }

    const existing = await this.prisma.chatRequest.findFirst({
      where: {
        OR: [
          { senderId, receiverId: receiver.id },
          { senderId: receiver.id, receiverId: senderId },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing?.status === 'PENDING') {
      throw new BadRequestException(
        'A pending request already exists between these users',
      );
    }
    if (existing?.status === 'ACCEPTED') {
      throw new BadRequestException('Chat request already accepted');
    }
    if (existing) {
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
    if (!request) throw new NotFoundException('Request not found');
    if (request.receiverId !== userId)
      throw new ForbiddenException('Unauthorized');
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
    if (!request) throw new NotFoundException('Request not found');
    if (request.receiverId !== userId)
      throw new ForbiddenException('Unauthorized');
    if (request.status !== 'PENDING') {
      throw new BadRequestException('Only pending requests can be rejected');
    }
    return this.prisma.chatRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED' },
    });
  }

  async createGroup(
    creatorId: string,
    data: { name: string; memberIds?: string[]; avatar?: string | null },
  ) {
    const name = data.name?.trim();
    if (!name) throw new BadRequestException('Group name is required');
    const memberIds = Array.from(
      new Set((data.memberIds ?? []).filter((id) => id && id !== creatorId)),
    );
    if (memberIds.length) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: memberIds }, emailVerified: true },
        select: { id: true },
      });
      if (users.length !== memberIds.length) {
        throw new BadRequestException('One or more selected users are invalid');
      }
    }

    const group = await this.prisma.group.create({
      data: {
        name,
        avatar: data.avatar ?? null,
        createdById: creatorId,
        members: {
          create: {
            userId: creatorId,
            role: GroupMemberRole.ADMIN,
          },
        },
      },
    });

    if (memberIds.length) {
      await this.prisma.groupJoinRequest.createMany({
        data: memberIds.map((memberId) => ({
          groupId: group.id,
          invitedById: creatorId,
          invitedUserId: memberId,
          status: GroupJoinRequestStatus.PENDING,
        })),
      });
    }

    return this.getGroupDetails(creatorId, group.id);
  }

  async updateGroup(
    userId: string,
    groupId: string,
    data: { name?: string; avatar?: string | null; clearAvatar?: boolean },
  ) {
    await this.ensureGroupMember(groupId, userId, true);
    const name = data.name?.trim();
    if (!name && data.avatar === undefined && !data.clearAvatar) {
      throw new BadRequestException('Group name or avatar change is required');
    }
    await this.prisma.group.update({
      where: { id: groupId },
      data: {
        ...(name ? { name } : {}),
        ...(data.clearAvatar ? { avatar: null } : {}),
        ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
      },
    });
    return this.getGroupDetails(userId, groupId);
  }

  async inviteGroupMembers(userId: string, groupId: string, userIds: string[]) {
    await this.ensureGroupMember(groupId, userId, true);
    const requestedIds = Array.from(
      new Set(userIds.filter((id) => Boolean(id && id !== userId))),
    );
    if (!requestedIds.length) {
      throw new BadRequestException('At least one user is required');
    }

    const [existingMembers, pendingInvites, users] = await Promise.all([
      this.prisma.groupMember.findMany({
        where: { groupId, userId: { in: requestedIds } },
        select: { userId: true },
      }),
      this.prisma.groupJoinRequest.findMany({
        where: {
          groupId,
          invitedUserId: { in: requestedIds },
          status: GroupJoinRequestStatus.PENDING,
        },
        select: { invitedUserId: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: requestedIds }, emailVerified: true },
        select: { id: true },
      }),
    ]);

    const blocked = new Set([
      ...existingMembers.map((member) => member.userId),
      ...pendingInvites.map((invite) => invite.invitedUserId),
    ]);
    const validIds = users
      .map((user) => user.id)
      .filter((id) => !blocked.has(id));
    if (!validIds.length) {
      throw new BadRequestException(
        'Everyone selected is already in the group or already invited',
      );
    }

    await this.prisma.groupJoinRequest.createMany({
      data: validIds.map((invitedUserId) => ({
        groupId,
        invitedById: userId,
        invitedUserId,
        status: GroupJoinRequestStatus.PENDING,
      })),
    });

    return this.getGroupDetails(userId, groupId);
  }

  async acceptGroupInvite(userId: string, inviteId: string) {
    const invite = await this.prisma.groupJoinRequest.findUnique({
      where: { id: inviteId },
    });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.invitedUserId !== userId)
      throw new ForbiddenException('Unauthorized');
    if (invite.status !== GroupJoinRequestStatus.PENDING) {
      throw new BadRequestException('Only pending invites can be accepted');
    }

    await this.prisma.$transaction([
      this.prisma.groupJoinRequest.update({
        where: { id: inviteId },
        data: {
          status: GroupJoinRequestStatus.ACCEPTED,
          respondedAt: new Date(),
        },
      }),
      this.prisma.groupMember.upsert({
        where: { groupId_userId: { groupId: invite.groupId, userId } },
        update: {},
        create: {
          groupId: invite.groupId,
          userId,
          role: GroupMemberRole.MEMBER,
        },
      }),
    ]);

    return this.getGroupDetails(userId, invite.groupId);
  }

  async rejectGroupInvite(userId: string, inviteId: string) {
    const invite = await this.prisma.groupJoinRequest.findUnique({
      where: { id: inviteId },
    });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.invitedUserId !== userId)
      throw new ForbiddenException('Unauthorized');
    if (invite.status !== GroupJoinRequestStatus.PENDING) {
      throw new BadRequestException('Only pending invites can be rejected');
    }
    return this.prisma.groupJoinRequest.update({
      where: { id: inviteId },
      data: {
        status: GroupJoinRequestStatus.REJECTED,
        respondedAt: new Date(),
      },
    });
  }

  async removeGroupMember(
    userId: string,
    groupId: string,
    memberUserId: string,
  ) {
    const membership = await this.ensureGroupMember(groupId, userId, true);
    if (memberUserId === userId) {
      throw new BadRequestException('Use leave group to remove yourself');
    }
    const target = membership.group.members.find(
      (member) => member.userId === memberUserId,
    );
    if (!target) throw new NotFoundException('Member not found');

    const adminCount = membership.group.members.filter(
      (member) => member.role === GroupMemberRole.ADMIN,
    ).length;
    if (target.role === GroupMemberRole.ADMIN && adminCount <= 1) {
      throw new BadRequestException('A group must keep at least one admin');
    }

    const remainingMembers = membership.group.members.filter(
      (member) => member.userId !== memberUserId,
    );
    const nextGroupOwner =
      membership.group.createdById === memberUserId
        ? this.pickNextGroupOwner(remainingMembers)
        : null;

    await this.prisma.$transaction([
      ...(nextGroupOwner
        ? [
            this.prisma.group.update({
              where: { id: groupId },
              data: { createdById: nextGroupOwner.userId },
            }),
          ]
        : []),
      this.prisma.groupMember.delete({
        where: { groupId_userId: { groupId, userId: memberUserId } },
      }),
    ]);

    return this.getGroupDetails(userId, groupId);
  }

  async promoteGroupMember(
    userId: string,
    groupId: string,
    memberUserId: string,
  ) {
    const membership = await this.ensureGroupMember(groupId, userId, true);
    const target = membership.group.members.find(
      (member) => member.userId === memberUserId,
    );
    if (!target) {
      throw new NotFoundException('Member not found');
    }
    if (target.role === GroupMemberRole.ADMIN) {
      throw new BadRequestException('This member is already an admin');
    }

    await this.prisma.groupMember.update({
      where: {
        groupId_userId: {
          groupId,
          userId: memberUserId,
        },
      },
      data: {
        role: GroupMemberRole.ADMIN,
      },
    });

    return this.getGroupDetails(userId, groupId);
  }

  async leaveGroup(userId: string, groupId: string) {
    const membership = await this.ensureGroupMember(groupId, userId);
    const remainingMembers = membership.group.members.filter(
      (member) => member.userId !== userId,
    );

    if (!remainingMembers.length) {
      await this.prisma.group.delete({
        where: { id: groupId },
      });

      return {
        success: true,
        groupId,
        deletedGroup: true,
        remainingMemberIds: [] as string[],
        promotedAdminUserId: null as string | null,
        message:
          'You left the group. The group was deleted because no members remained.',
      };
    }

    const adminCount = membership.group.members.filter(
      (member) => member.role === GroupMemberRole.ADMIN,
    ).length;
    let promotedAdminUserId: string | null = null;
    const nextGroupOwner = this.pickNextGroupOwner(remainingMembers);
    await this.prisma.$transaction(async (tx) => {
      if (
        membership.role === GroupMemberRole.ADMIN &&
        adminCount <= 1 &&
        nextGroupOwner
      ) {
        promotedAdminUserId = nextGroupOwner.userId;
        await tx.groupMember.update({
          where: {
            groupId_userId: {
              groupId,
              userId: nextGroupOwner.userId,
            },
          },
          data: { role: GroupMemberRole.ADMIN },
        });
      }

      if (membership.group.createdById === userId && nextGroupOwner) {
        await tx.group.update({
          where: { id: groupId },
          data: { createdById: nextGroupOwner.userId },
        });
      }

      await tx.groupMember.delete({
        where: { groupId_userId: { groupId, userId } },
      });
    });

    return {
      success: true,
      groupId,
      deletedGroup: false,
      remainingMemberIds: remainingMembers.map((member) => member.userId),
      promotedAdminUserId,
      message: promotedAdminUserId
        ? 'You left the group. Another member was promoted to admin automatically.'
        : 'You left the group.',
    };
  }

  async createEncryptedMessage(input: {
    senderId: string;
    receiverId?: string;
    groupId?: string;
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
  }) {
    if (!input.receiverId && !input.groupId) {
      throw new BadRequestException('Receiver or group is required');
    }
    if (input.receiverId && input.groupId) {
      throw new BadRequestException(
        'A message can target only one conversation',
      );
    }

    const sender = await this.prisma.user.findUnique({
      where: { id: input.senderId },
      select: { id: true, name: true, email: true },
    });
    if (!sender) throw new NotFoundException('Sender not found');

    let receiverId: string | null = null;
    let groupId: string | null = null;

    if (input.receiverId) {
      const receiver = await this.prisma.user.findUnique({
        where: { id: input.receiverId },
        select: { id: true },
      });
      if (!receiver) throw new NotFoundException('Receiver not found');
      if (receiver.id === input.senderId) {
        throw new BadRequestException('Cannot send a message to yourself');
      }
      await this.assertUsersCanChat(input.senderId, receiver.id);
      receiverId = receiver.id;
    } else if (input.groupId) {
      await this.ensureGroupMember(input.groupId, input.senderId);
      groupId = input.groupId;
    }

    const messageType = input.messageType ?? MessageType.TEXT;
    const hasEncryptedText = Boolean(input.ciphertext?.trim());
    const hasPlainText = Boolean(input.plainText?.trim());
    const hasAttachment = Boolean(input.fileUrl);
    const hasEncryptedEnvelope = Boolean(
      input.encryptedKey?.trim() && input.iv?.trim() && input.algorithm?.trim(),
    );
    if (!hasEncryptedText && !hasPlainText && !hasAttachment) {
      throw new BadRequestException(
        'Message content or attachment is required',
      );
    }
    if (messageType === MessageType.TEXT && !hasEncryptedText) {
      throw new BadRequestException(
        'Text messages must be end-to-end encrypted',
      );
    }
    if (hasEncryptedText && !hasEncryptedEnvelope) {
      throw new BadRequestException(
        'Encrypted messages require a key envelope and iv',
      );
    }

    const createdMessage = await this.prisma.message.create({
      data: {
        content: hasEncryptedText
          ? null
          : hasPlainText
            ? input.plainText?.trim()
            : null,
        ciphertext: hasEncryptedText ? input.ciphertext?.trim() : null,
        senderId: input.senderId,
        receiverId,
        groupId,
        messageType,
        fileUrl: input.fileUrl ?? null,
        fileName: input.fileName ?? null,
        fileMimeType: input.fileMimeType ?? null,
        fileSize: input.fileSize ?? null,
        encryptedKey: input.encryptedKey?.trim() || null,
        iv: input.iv?.trim() || null,
        algorithm: input.algorithm?.trim() || null,
        isEncrypted:
          hasEncryptedText || Boolean(input.encryptedKey) || Boolean(input.iv),
      },
    });

    const preview = this.previewForMessage(createdMessage);
    if (receiverId) {
      await this.pushNotifications.notifyUser(receiverId, {
        title: sender.name || sender.email,
        body: preview,
        tag: `chat-${sender.id}-${receiverId}`,
        url: `/?chat=${sender.id}`,
      });
      return this.serializeDirectMessage(createdMessage, input.senderId);
    }

    const members = await this.prisma.groupMember.findMany({
      where: { groupId: groupId as string },
      select: { userId: true },
    });
    const recipientIds = members
      .map((member) => member.userId)
      .filter((memberId) => memberId !== input.senderId);

    await Promise.all(
      recipientIds.map((memberId) =>
        this.pushNotifications.notifyUser(memberId, {
          title: sender.name || sender.email,
          body: preview,
          tag: `group-${groupId}`,
          url: `/?group=${groupId}`,
        }),
      ),
    );

    return {
      ...createdMessage,
      readByCount: 0,
      recipientCount: recipientIds.length,
    };
  }

  async markConversationRead(
    userId: string,
    input: { otherUserId?: string; groupId?: string },
  ) {
    if (!input.otherUserId && !input.groupId) {
      throw new BadRequestException('Conversation target is required');
    }
    if (input.otherUserId && input.groupId) {
      throw new BadRequestException('Only one conversation target is allowed');
    }

    const readAt = new Date();
    if (input.otherUserId) {
      await this.prisma.message.updateMany({
        where: {
          groupId: null,
          senderId: input.otherUserId,
          receiverId: userId,
          readAt: null,
          hiddenForUsers: { none: { userId } },
        },
        data: { readAt },
      });
      return {
        conversationType: 'direct',
        otherUserId: input.otherUserId,
        readAt,
      };
    }

    await this.ensureGroupMember(input.groupId as string, userId);
    await this.prisma.groupMember.update({
      where: {
        groupId_userId: {
          groupId: input.groupId as string,
          userId,
        },
      },
      data: { lastReadAt: readAt },
    });
    return {
      conversationType: 'group',
      groupId: input.groupId,
      readAt,
    };
  }

  private async getMessageForAction(messageId: string, userId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message) throw new NotFoundException('Message not found');
    if (message.groupId) {
      await this.ensureGroupMember(message.groupId, userId);
      return message;
    }
    if (message.senderId !== userId && message.receiverId !== userId) {
      throw new ForbiddenException('Unauthorized');
    }
    return message;
  }

  async deleteMessageForMe(userId: string, messageId: string) {
    const message = await this.getMessageForAction(messageId, userId);
    await this.prisma.messageHidden.upsert({
      where: { messageId_userId: { messageId: message.id, userId } },
      update: {},
      create: { messageId: message.id, userId },
    });
    return { success: true, messageId: message.id };
  }

  async deleteMessageForEveryone(userId: string, messageId: string) {
    const message = await this.getMessageForAction(messageId, userId);
    if (message.senderId !== userId) {
      throw new ForbiddenException('Only the sender can delete for everyone');
    }
    if (
      Date.now() - new Date(message.createdAt).getTime() >
      DELETE_FOR_EVERYONE_WINDOW_MS
    ) {
      throw new BadRequestException(
        'Delete for everyone is only available within 5 minutes of sending',
      );
    }

    const updated = await this.prisma.message.update({
      where: { id: message.id },
      data: {
        content: null,
        ciphertext: null,
        fileUrl: null,
        fileName: null,
        fileMimeType: null,
        fileSize: null,
        encryptedKey: null,
        iv: null,
        algorithm: null,
        deletedForEveryoneAt: new Date(),
        deletedForEveryoneById: userId,
      },
    });

    if (updated.groupId) {
      const membership = await this.ensureGroupMember(updated.groupId, userId);
      return this.serializeGroupMessages(
        [updated],
        membership.group.members,
      )[0];
    }
    return this.serializeDirectMessage(updated, userId);
  }
}
