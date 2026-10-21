-- Owner decision 2026-10-21 (tester report "choose which sections each member sees"): sections of the merchant app an
-- Owner hides from one member (`MEMBER_SECTIONS`, @djaber/shared permissions). Empty = everything the role allows.
ALTER TABLE "Membership" ADD COLUMN "hiddenSections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
