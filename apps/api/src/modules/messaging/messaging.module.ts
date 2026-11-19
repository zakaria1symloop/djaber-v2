import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { BatchingService } from './batching.service';
import { ConversationResolver } from './conversation-resolver';
import { ConversationService } from './conversation.service';
import { DataLifecycleService } from './data-lifecycle.service';
import { HistorySyncService } from './history-sync.service';
import { InboundProcessor } from './inbound.processor';
import { ChannelMessagesController, ConversationsController, DataDeletionController, AdminDataDeletionController, DevSimulatorController, MessagesController, MetaWebhookController, SafetyController } from './messaging.controllers';
import { MetaWebhookService } from './meta-webhook.service';
import { OutboundSendService } from './outbound-send.service';
import { SafetyService } from './safety.service';

/**
 * 01-nest-module-map `messaging` (M3): Meta webhook intake, inbound processing, conversations and messages (inbox API),
 * outbound sends with the 24 h window rules, blocks and reports (merchant side), data deletion and retention,
 * history sync. `OutboundSendService`, `ConversationService` and `BatchingService` are exported for the AI pipeline (M4)
 * and for the order notifications (M5).
 */
@Module({
  imports: [ChannelsModule],
  controllers: [MetaWebhookController, DataDeletionController, AdminDataDeletionController, ConversationsController, MessagesController, ChannelMessagesController, SafetyController, DevSimulatorController],
  providers: [MetaWebhookService, ConversationResolver, SafetyService, OutboundSendService, ConversationService, BatchingService, InboundProcessor, HistorySyncService, DataLifecycleService],
  exports: [OutboundSendService, ConversationService, BatchingService, SafetyService, MetaWebhookService, InboundProcessor, HistorySyncService, DataLifecycleService],
})
export class MessagingModule {}
