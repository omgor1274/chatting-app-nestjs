import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('returns health details', () => {
    const health = appController.getHealth();

    expect(health.status).toBe('ok');
    expect(typeof health.timestamp).toBe('string');
  });

  it('serves the app shell without caching', () => {
    const sendFile = jest.fn();
    const setHeader = jest.fn();
    const response = {
      sendFile,
      setHeader,
    } as unknown as Response;

    appController.getIndex(response);

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(sendFile).toHaveBeenCalled();
  });

  it('serves public config with no-store and vary headers', () => {
    const setHeader = jest.fn();
    const response = {
      setHeader,
    } as unknown as Response;

    appController.getConfig(undefined as never, response);

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(setHeader).toHaveBeenCalledWith(
      'Vary',
      'Host, X-Forwarded-Host, X-Forwarded-Proto',
    );
  });
});
