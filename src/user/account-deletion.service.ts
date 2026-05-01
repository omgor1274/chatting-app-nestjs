import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { UserService } from './user.service';

const ACCOUNT_DELETION_DEFAULT_CRON = '0 * * * *';
const ACCOUNT_DELETION_JOB_NAME = 'account-deletion-cleanup';

@Injectable()
export class AccountDeletionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly userService: UserService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit() {
    const cronExpression = this.getCronExpression();
    this.registerCronJob(cronExpression);
    this.logger.log(
      `Account soft-delete cleanup is enabled with cron "${cronExpression}".`,
    );
    void this.runCleanupCycle();
  }

  onModuleDestroy() {
    this.deleteCronJobIfRegistered();
  }

  private async runCleanupCycle() {
    try {
      const result = await this.userService.cleanupExpiredDeletedAccounts();
      if (result.deletedCount > 0) {
        this.logger.log(
          `Permanently deleted ${result.deletedCount} expired soft-deleted account${result.deletedCount === 1 ? '' : 's'}.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Account soft-delete cleanup failed. ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private registerCronJob(cronExpression: string) {
    this.deleteCronJobIfRegistered();

    const job = CronJob.from({
      cronTime: cronExpression,
      onTick: () => {
        void this.runCleanupCycle();
      },
      start: false,
    });

    this.schedulerRegistry.addCronJob(ACCOUNT_DELETION_JOB_NAME, job);
    job.start();
  }

  private getCronExpression() {
    const configuredCron = process.env.ACCOUNT_DELETION_CRON?.trim();
    if (!configuredCron) {
      return ACCOUNT_DELETION_DEFAULT_CRON;
    }

    try {
      CronJob.from({
        cronTime: configuredCron,
        onTick: () => undefined,
        start: false,
      });
      return configuredCron;
    } catch (error) {
      this.logger.warn(
        `Invalid ACCOUNT_DELETION_CRON value "${configuredCron}". Falling back to "${ACCOUNT_DELETION_DEFAULT_CRON}". ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return ACCOUNT_DELETION_DEFAULT_CRON;
    }
  }

  private deleteCronJobIfRegistered() {
    try {
      const job = this.schedulerRegistry.getCronJob(ACCOUNT_DELETION_JOB_NAME);
      job.stop();
      this.schedulerRegistry.deleteCronJob(ACCOUNT_DELETION_JOB_NAME);
    } catch {
      // No existing cron job to delete.
    }
  }
}
