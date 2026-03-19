import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'path';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) { }

  @Get()
  getIndex(@Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(join(process.cwd(), 'index.html'));
  }

  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }

  @Get('config')
  getConfig() {
    return this.appService.getPublicConfig();
  }
}
