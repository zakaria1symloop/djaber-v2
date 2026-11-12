// Stores a GDS printout under `private/` and returns a signed link (same contract as `GET /orders/:id/print`).
import { Injectable } from '@nestjs/common';
import { prisma, TenantContext } from '@djaber/db';
import { StorageService } from '../../core/storage/storage.service';
import { renderGdsDocument, type GdsDocument, type GdsLang } from './gds-document.pdf';

const PRINT_URL_TTL_S = 24 * 3600;

@Injectable()
export class GdsPrintService {
  constructor(private readonly storage: StorageService) {}

  lang(l: string | undefined): GdsLang {
    // a document for the end customer: the shop's language by default, never the viewer's (07 §4 Language source)
    const t = l ?? TenantContext.get().locale;
    return t === 'ar' || t === 'en' ? t : 'fr';
  }

  async shopName() {
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: TenantContext.workspaceId() }, select: { name: true } });
    return ws.name;
  }

  async print(doc: GdsDocument, fileName: string) {
    const pdf = await renderGdsDocument(doc);
    const key = `private/ws/${TenantContext.workspaceId()}/prints/${fileName}-${Date.now()}.pdf`;
    await this.storage.put(key, pdf, 'application/pdf');
    return { url: this.storage.signedUrl(key, PRINT_URL_TTL_S), fileName: `${fileName}.pdf`, size: pdf.length, expiresAt: new Date(Date.now() + PRINT_URL_TTL_S * 1000).toISOString() };
  }
}
