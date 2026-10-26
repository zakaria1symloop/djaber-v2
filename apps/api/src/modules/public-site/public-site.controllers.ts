// M11 — public site API (06 §12, route map §3.1): CMS pages, captcha config, published API docs (API-04).
import { Controller, Get, Header, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { createZodDto } from 'nestjs-zod';
import { CmsListQuerySchema, CmsPublicQuerySchema } from '@djaber/shared';
import { CurrentUser, Public, RequirePermission, type AuthUser } from '../../core/auth/decorators';
import { CaptchaService } from '../../core/captcha/captcha.service';
import { ConfigService } from '../../core/config/config.service';
import { RawResponse } from '../../core/http/envelope.interceptor';
import { AnnouncementsService } from './announcements.service';
import { CmsPublicService } from './cms-public.service';
import { buildOpenApi, toPostman, type OpenApiDoc } from './openapi';

class CmsQueryDto extends createZodDto(CmsPublicQuerySchema) {}
class CmsListQueryDto extends createZodDto(CmsListQuerySchema) {}

const lang = (q: { lang?: string }, req: any): 'fr' | 'ar' | 'en' => {
  const l = q.lang ?? req.locale;
  return l === 'ar' || l === 'en' ? l : 'fr';
};

@Controller('cms')
export class CmsPublicController {
  constructor(
    private readonly cms: CmsPublicService,
    private readonly announcements: AnnouncementsService,
  ) {}

  @Public()
  @Get()
  list(@Query() q: CmsListQueryDto, @Req() req: any) {
    return this.cms.list(q, lang(q, req));
  }

  /** Public site banner: live announcements of channel `web` meant for every workspace (before `:key`). */
  @Public()
  @Get('announcements')
  @Header('Cache-Control', 'public, max-age=60')
  publicAnnouncements(@Query() q: CmsQueryDto, @Req() req: any) {
    return this.announcements.publicList(lang(q, req));
  }

  @Public()
  @Get('preview/:token')
  @Header('Cache-Control', 'no-store')
  preview(@Param('token') token: string, @Query() q: CmsQueryDto, @Req() req: any) {
    return this.cms.preview(token, lang(q, req));
  }

  @Public()
  @Get(':key')
  get(@Param('key') key: string, @Query() q: CmsQueryDto, @Req() req: any) {
    return this.cms.get(key.slice(0, 120), lang(q, req), { preview: q.preview });
  }
}

/** 06 §8.1 — announcements in the merchant app (banner channel; `GET /announcements/:id` = the notification's target). */
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  @RequirePermission('workspace.read')
  list(@CurrentUser() user: AuthUser, @Query() q: CmsQueryDto, @Req() req: any) {
    return this.announcements.list(user.id, lang(q, req));
  }

  @Get(':id')
  @RequirePermission('workspace.read')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: CmsQueryDto, @Req() req: any) {
    return this.announcements.get(user.id, id, lang(q, req));
  }

  @Post(':id/dismiss')
  @HttpCode(204)
  @RequirePermission('workspace.read')
  async dismiss(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.announcements.dismiss(user.id, id);
  }
}

/** `GET /legal/:key` — the legal documents (`terms`, `privacy`, `account_deletion`, `content_rules`, `cookies`, `data-deletion`). */
@Controller('legal')
export class LegalPublicController {
  constructor(private readonly cms: CmsPublicService) {}

  @Public()
  @Get(':key')
  get(@Param('key') key: string, @Query() q: CmsQueryDto, @Req() req: any) {
    return this.cms.get(key.slice(0, 120), lang(q, req), { preview: q.preview, type: 'legal' });
  }
}

@Controller('captcha')
export class CaptchaController {
  constructor(private readonly captcha: CaptchaService) {}

  @Public()
  @Get('config')
  config() {
    return this.captcha.publicConfig();
  }
}

/** API-04: `/api/docs` (Swagger UI), `/api/docs/openapi.json`, `/api/docs/postman.json` — outside `/api/v1` (bootstrap excludes them). */
@Controller('api/docs')
export class ApiDocsController {
  private cached?: OpenApiDoc;
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly config: ConfigService,
  ) {}

  private doc(): OpenApiDoc {
    if (!this.config.get('SWAGGER_ENABLED')) throw new NotFoundException();
    this.cached ??= buildOpenApi(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- controller classes from Nest discovery
      this.discovery.getControllers().map((w) => ({ metatype: w.metatype as Function })),
      { serverUrl: this.config.get('PUBLIC_API_URL'), version: '1.0.0' },
    );
    return this.cached;
  }

  @Public()
  @Get('openapi.json')
  openapi() {
    return new RawResponse(this.doc());
  }

  @Public()
  @Get('postman.json')
  @Header('Content-Disposition', 'attachment; filename="djaber-api.postman_collection.json"')
  postman() {
    return new RawResponse(toPostman(this.doc()));
  }

  @Public()
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  ui(@Res({ passthrough: true }) res: any) {
    this.doc();
    const cdn = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14';
    // a CSP source with a path matches that exact path unless it ends with « / »: without it the browser refused
    // swagger-ui-bundle.js and the page showed only its two links (tester notes 25/10)
    const src = `${cdn}/`;
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' ${src} 'sha256-${UI_SCRIPT_HASH}'; style-src 'self' 'unsafe-inline' ${src}; img-src 'self' data: ${src}; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'`);
    return new RawResponse(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Djaber API</title>` +
        `<link rel="stylesheet" href="${cdn}/swagger-ui.css"></head><body><div id="ui"></div><p style="font:13px system-ui;margin:8px 16px"><a href="/api/docs/openapi.json">openapi.json</a> · <a href="/api/docs/postman.json">Postman collection</a></p>` +
        `<script src="${cdn}/swagger-ui-bundle.js" crossorigin></script><script>${UI_SCRIPT}</script></body></html>`,
    );
  }
}

const UI_SCRIPT = "window.ui=SwaggerUIBundle({url:'/api/docs/openapi.json',dom_id:'#ui',deepLinking:true,persistAuthorization:true});";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const UI_SCRIPT_HASH = (require('node:crypto') as typeof import('node:crypto')).createHash('sha256').update(UI_SCRIPT).digest('base64');
