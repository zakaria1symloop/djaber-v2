// LST-03 / D42 — saved views (`/me/saved-views`) + the `?view=<id>` expansion of every list of 05 §16.
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SavedViewQueryInterceptor } from './saved-view-query.interceptor';
import { SavedViewsController } from './saved-views.controller';
import { SavedViewsService } from './saved-views.service';

@Module({
  controllers: [SavedViewsController],
  providers: [SavedViewsService, { provide: APP_INTERCEPTOR, useClass: SavedViewQueryInterceptor }],
  exports: [SavedViewsService],
})
export class SavedViewsModule {}
