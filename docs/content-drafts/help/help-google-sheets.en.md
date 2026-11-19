---
key: help-google-sheets
type: help
category: orders_delivery
pages: [settings/integrations]
sortOrder: 33
locale: en
title: Send your orders to Google Sheets
---
Djaber can add every order to a Google Sheets spreadsheet and update it on every change (status, tracking, contact). Syncing goes one way: from Djaber to Sheets.

## Connect the sheet
- Open Settings › Integrations › Google Sheets.
- Click “Connect Google” and allow access with your Google account.
- Click “Choose the sheet”: pick an existing spreadsheet or create one.

Orders arrive in the “Commandes” tab of the sheet. A hidden column lets Djaber recognise each order: do not delete it.

## Choose which orders are sent
“Edit filters” limits the sync to some pages and some sources: AI, manual, mobile, API, import. By default every source is sent.

## Add older orders
“Export history (period)” adds or updates the orders of a period. The job runs in the background with a progress bar; orders already in the sheet are updated, never duplicated.

## When something goes wrong
- “Google removed Djaber’s access”: syncing is paused. Click “Reconnect Google” to resume it.
- “The sheet was deleted or is no longer accessible”: choose another sheet.
- A sync error is also reported to you by a notification.

Disconnecting Google Sheets stops the sync; the sheet itself is not deleted.

## Who can do it
The workspace owner and admins. Google Sheets depends on your plan: if “Google Sheets is not included in your plan” is shown, change plan in Settings › Plan & billing.
