import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppService } from './app.service';
import { resolveAppRootPath } from './common/app-paths';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) { }

  @Get()
  getIndex(@Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(resolveAppRootPath('index.html'));
  }

  @Get('chat')
  getChat(@Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(resolveAppRootPath('chat.html'));
  }

  @Get('auth')
  getAuth(@Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(resolveAppRootPath('auth.html'));
  }

  @Get('settings')
  getSettings(@Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(resolveAppRootPath('settings.html'));
  }

  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }

  @Get('config')
  getConfig(@Req() req: Request) {
    return this.appService.getPublicConfig(req);
  }
}
