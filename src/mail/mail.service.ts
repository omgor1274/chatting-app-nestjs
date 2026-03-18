import { Injectable, Logger } from '@nestjs/common';
import { appendFileSync, mkdirSync } from 'fs';
import nodemailer, { Transporter } from 'nodemailer';
import { join } from 'path';

type MailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter?: Transporter;
  private readonly mailboxPath = join(
    process.cwd(),
    'backups',
    'dev-mailbox.log',
  );

  constructor() {
    if (
      process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS
    ) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    } else {
      mkdirSync(join(process.cwd(), 'backups'), { recursive: true });
      this.logger.warn(
        'SMTP is not configured. Email previews will be written to backups/dev-mailbox.log',
      );
    }
  }

  get appOrigin() {
    return (
      process.env.APP_ORIGIN || `http://localhost:${process.env.PORT ?? 3000}`
    );
  }

  async sendMail(payload: MailPayload) {
    if (this.transporter) {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      });
      return;
    }

    appendFileSync(
      this.mailboxPath,
      [
        `\n[${new Date().toISOString()}]`,
        `To: ${payload.to}`,
        `Subject: ${payload.subject}`,
        payload.text,
        '',
      ].join('\n'),
      'utf-8',
    );
  }

  async sendVerificationEmail(email: string, otp: string, ttlMs: number) {
    const expiresInMinutes = Math.max(1, Math.round(ttlMs / 60000));

    await this.sendMail({
      to: email,
      subject: 'Verify your O-chat email',
      text: `Your O-chat verification code is ${otp}. It expires in ${expiresInMinutes} minutes.`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.6;">
          <h2>Verify your email</h2>
          <p>Use this OTP to verify your O-chat account.</p>
          <div style="margin: 18px 0; font-size: 32px; font-weight: 700; letter-spacing: 0.35em;">
            ${otp}
          </div>
          <p>This code expires in ${expiresInMinutes} minutes.</p>
        </div>
      `,
    });
  }

  async sendPasswordResetEmail(email: string, otp: string, ttlMs: number) {
    const expiresInMinutes = Math.max(1, Math.round(ttlMs / 60000));

    await this.sendMail({
      to: email,
      subject: 'Reset your O-chat password',
      text: `Your O-chat password reset code is ${otp}. It expires in ${expiresInMinutes} minutes.`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.6;">
          <h2>Reset your password</h2>
          <p>Use this OTP to set a new O-chat password.</p>
          <div style="margin: 18px 0; font-size: 32px; font-weight: 700; letter-spacing: 0.35em;">
            ${otp}
          </div>
          <p>This code expires in ${expiresInMinutes} minutes.</p>
        </div>
      `,
    });
  }
}
