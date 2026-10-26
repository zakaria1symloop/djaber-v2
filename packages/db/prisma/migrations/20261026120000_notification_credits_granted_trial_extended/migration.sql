-- tester report 22/10 UX-020 / UX-021: in-app notifications of an admin credit grant and of a trial extension
ALTER TYPE "NotificationType" ADD VALUE 'credits_granted';
ALTER TYPE "NotificationType" ADD VALUE 'subscription_trial_extended';
