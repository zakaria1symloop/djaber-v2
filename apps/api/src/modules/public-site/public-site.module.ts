import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AnnouncementsService } from './announcements.service';
import { CmsPublicService } from './cms-public.service';
import { AnnouncementsController, ApiDocsController, CaptchaController, CmsPublicController, LegalPublicController } from './public-site.controllers';

/**
 * M11 public site (03 §36 PUB-01…07, 06 §12): CMS pages with locale fallback and admin preview, captcha configuration of the
 * public forms, the published API documentation (API-04). Registered after WorkspaceModule so `/legal/pending` keeps its route.
 */
@Module({
  imports: [DiscoveryModule],
  controllers: [CmsPublicController, AnnouncementsController, LegalPublicController, CaptchaController, ApiDocsController],
  providers: [CmsPublicService, AnnouncementsService],
  exports: [AnnouncementsService],
})
export class PublicSiteModule {}
