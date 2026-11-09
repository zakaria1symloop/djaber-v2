-- Super admin notifications (owner request 09/11 « des notifications pour l'admin, pour tout, en temps réel »): one
-- row per platform user, no workspace, the event in data.kind (admin-notifier.service.ts).
ALTER TYPE "NotificationType" ADD VALUE 'platform_admin';
