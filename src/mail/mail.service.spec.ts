import { Test, TestingModule } from '@nestjs/testing';

describe('MailService', () => {
  const appendFileSync = jest.fn();
  const mkdirSync = jest.fn();
  const sendMail = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'dev@example.com';
    process.env.SMTP_PASS = 'bad-password';
    process.env.SMTP_FROM = 'dev@example.com';
  });

  afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
  });

  it('falls back to the dev mailbox when smtp send fails', async () => {
    jest.doMock('fs', () => ({
      appendFileSync,
      mkdirSync,
    }));
    jest.doMock('nodemailer', () => ({
      __esModule: true,
      default: {
        createTransport: jest.fn(() => ({
          sendMail,
        })),
      },
    }));

    sendMail.mockRejectedValueOnce(new Error('SMTP auth failed'));
    let FreshMailService: typeof import('./mail.service').MailService;
    jest.isolateModules(() => {
      ({ MailService: FreshMailService } = require('./mail.service'));
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [FreshMailService],
    }).compile();
    const service = module.get(FreshMailService);

    await service.sendMail({
      to: 'user@example.com',
      subject: 'Subject',
      text: 'Plain text',
      html: '<b>Plain text</b>',
    });

    expect(sendMail).toHaveBeenCalled();
    expect(mkdirSync).toHaveBeenCalled();
    expect(appendFileSync).toHaveBeenCalled();
  });
});
