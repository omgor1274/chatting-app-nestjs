import { AppRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AdminBootstrapService } from './admin-bootstrap.service';

describe('AdminBootstrapService', () => {
  let service: AdminBootstrapService;
  let prisma: {
    user: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  const originalEnv = {
    name: process.env.BOOTSTRAP_ADMIN_NAME,
    email: process.env.BOOTSTRAP_ADMIN_EMAIL,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
  };

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    service = new AdminBootstrapService(prisma as never);

    process.env.BOOTSTRAP_ADMIN_NAME = 'Configured Admin';
    process.env.BOOTSTRAP_ADMIN_EMAIL = 'admin@example.com';
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'SuperSecret123!';
  });

  afterEach(() => {
    if (originalEnv.name === undefined) {
      delete process.env.BOOTSTRAP_ADMIN_NAME;
    } else {
      process.env.BOOTSTRAP_ADMIN_NAME = originalEnv.name;
    }

    if (originalEnv.email === undefined) {
      delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    } else {
      process.env.BOOTSTRAP_ADMIN_EMAIL = originalEnv.email;
    }

    if (originalEnv.password === undefined) {
      delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    } else {
      process.env.BOOTSTRAP_ADMIN_PASSWORD = originalEnv.password;
    }
  });

  it('creates a bootstrap admin when configured credentials do not exist yet', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await service.onModuleInit();

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'admin@example.com',
          name: 'Configured Admin',
          role: AppRole.ADMIN,
          isApproved: true,
          isBanned: false,
        }),
      }),
    );

    const createdPassword = prisma.user.create.mock.calls[0][0].data.password;
    expect(await bcrypt.compare('SuperSecret123!', createdPassword)).toBe(true);
  });

  it('repairs an existing bootstrap admin account when access flags drift', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: AppRole.USER,
      isApproved: false,
      approvedAt: null,
      isBanned: true,
    });

    await service.onModuleInit();

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          role: AppRole.ADMIN,
          name: 'Configured Admin',
          isApproved: true,
          isBanned: false,
          tokenVersion: { increment: 1 },
        }),
      }),
    );
  });

  it('skips bootstrap creation when credentials are not configured and an admin already exists', async () => {
    delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    prisma.user.findFirst.mockResolvedValue({ id: 'admin-1' });

    await service.onModuleInit();

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { role: AppRole.ADMIN },
      select: { id: true },
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
