-- PV 28/10 « l'agent IA limite les commandes à 10 »: an empty `maxQtyPerOrder` / `maxAmountPerOrder` now means no
-- limit (as the agent page already showed it, ∞). The wizard used to prefill 10 units for every new agent, so the
-- agents still at exactly 10 are put back to « no limit »; a merchant who wants a cap sets it again on the agent page.
UPDATE "Agent" SET "maxQtyPerOrder" = NULL WHERE "maxQtyPerOrder" = 10;
