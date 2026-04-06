import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppService } from './app.service';
import { resolveAppRootPath } from './common/app-paths';

function setPublicConfigHeaders(res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Host, X-Forwarded-Host, X-Forwarded-Proto');
}

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

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

  @Get('admin')
  getAdmin(@Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(resolveAppRootPath('admin.html'));
  }

  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }

  @Get('config')
  getConfig(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    setPublicConfigHeaders(res);
    return this.appService.getPublicConfig(req);
  }

  @Get('runtime-config.js')
  getRuntimeConfig(@Req() req: Request, @Res() res: Response) {
    const config = this.appService.getPublicConfig(req);
    setPublicConfigHeaders(res);
    res.type('application/javascript');
    return res.send(
      `window.__OCHAT_RUNTIME_CONFIG__ = ${JSON.stringify({
        defaultApiOrigin: config.defaultApiOrigin,
      })};`,
    );
  }
}
