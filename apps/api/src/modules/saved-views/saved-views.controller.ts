// 06 §8.1 — GET /me/saved-views?page · POST /me/saved-views · PATCH|DELETE /me/saved-views/:id ·
// POST /me/saved-views/:id/share (Admin+, `views.share`). The views belong to the member in the current workspace
// (`X-Workspace-Id`): own views need only membership (`workspace.read`, every role — 01 §3.2 « own saved views need no
// key »); sharing needs `views.share`. Idempotency-Key optional (api-contract §1.7: not in the required list).
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { CreateSavedViewSchema, SavedViewsQuerySchema, ShareSavedViewSchema, UpdateSavedViewSchema } from '@djaber/shared';
import { Audited, Idempotent, RequirePermission } from '../../core/auth/decorators';
import { SavedViewsService } from './saved-views.service';

class CreateSavedViewDto extends createZodDto(CreateSavedViewSchema) {}
class UpdateSavedViewDto extends createZodDto(UpdateSavedViewSchema) {}
class ShareSavedViewDto extends createZodDto(ShareSavedViewSchema) {}
class SavedViewsQueryDto extends createZodDto(SavedViewsQuerySchema) {}

@Controller('me/saved-views')
export class SavedViewsController {
  constructor(private readonly svc: SavedViewsService) {}

  @Get()
  @RequirePermission('workspace.read')
  list(@Query() q: SavedViewsQueryDto) {
    return this.svc.list(q.page);
  }

  @Post()
  @RequirePermission('workspace.read')
  @Idempotent()
  create(@Body() dto: CreateSavedViewDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  @RequirePermission('workspace.read')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSavedViewDto) {
    return this.svc.update(id, dto);
  }

  @Post(':id/share')
  @RequirePermission('views.share')
  @HttpCode(200)
  @Idempotent()
  @Audited({ entity: 'SavedView', action: 'saved_view.share', idFrom: 'params.id' })
  share(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ShareSavedViewDto) {
    return this.svc.share(id, dto.isShared);
  }

  @Delete(':id')
  @RequirePermission('workspace.read')
  @HttpCode(204)
  @Audited({ entity: 'SavedView', action: 'saved_view.delete', idFrom: 'params.id' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.svc.remove(id);
  }
}
