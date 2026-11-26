import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ChannelsModule } from '../channels/channels.module';
import { MessagingModule } from '../messaging/messaging.module';
import { AgentService } from './agent.service';
import { AgentInsightsController, AgentsController, ChannelAgentController, SharedTestController } from './agents.controllers';
import { KnowledgeService } from './knowledge.service';
import { LearningService } from './learning.service';
import { PageService } from './page.service';
import { TestLinkService } from './test-link.service';

/**
 * 01-nest-module-map `agents` (M4): agents with the 5-step wizard, presets, versions with restore, FAQ, the insights
 * queue (resolution side), channel ↔ agent links, generate-from-page, FAQ extraction, page analysis (CHN-08), shared
 * test links. The turn itself (prompt, tools, runs, credits) is the `ai` module.
 */
@Module({
  imports: [AiModule, ChannelsModule, CatalogModule, MessagingModule],
  controllers: [AgentsController, AgentInsightsController, ChannelAgentController, SharedTestController],
  providers: [AgentService, KnowledgeService, LearningService, PageService, TestLinkService],
  exports: [AgentService, KnowledgeService, LearningService],
})
export class AgentsModule {}
