# UX-005 — Announcements are not displayed on the website, and client notifications lead nowhere

**Screen:** Superadmin Dashboard > Announcements / Client Workspace > Notifications / Website > Announcement display

**Type:** Functional / UI / Navigation

**Severity:** Major

**Date found:** 21/10/2026

**What happens:**

As a superadmin, when creating an announcement from the Superadmin Dashboard, the announcement record is successfully created and appears in the dashboard.

However, the announcement cannot be found anywhere on the website. Although it exists in the dashboard, it is not visible to users on the website.

Additionally, a notification related to the announcement appears in the client workspace. However, when the client clicks or opens this notification, it does not lead to any page or relevant content. The notification appears to be clickable, but no destination is opened and the client cannot access the announcement details.

This creates two related issues: the announcement is not visible on the website, and the notification intended to inform the client does not provide access to the relevant information.

As a result, superadmins cannot reliably communicate important information, updates, or notices, while clients receive notifications that do not lead anywhere.

**What we expected:**

When a superadmin creates and publishes an announcement, it should be displayed in the appropriate section of the website according to its configuration, audience, visibility, and publication status.

If an announcement generates a notification in the client workspace, clicking that notification should navigate the client to the corresponding announcement or to a relevant page where the announcement details can be viewed.

The announcement and its associated notification should be correctly linked, so the client can access the intended content directly.

The announcement feature should provide a clear distinction between draft, scheduled, published, and inactive announcements, where these statuses are supported.

If an announcement or notification cannot be accessed because of a missing configuration, publication status, or visibility restriction, the interface should clearly indicate the reason rather than presenting an apparently functional notification that leads nowhere.

**Steps to reproduce:**

**Scenario A — Announcement is not displayed on the website**

1. Log in to the Superadmin Dashboard.
2. Navigate to the content (cms) -> Announcements section.
3. Click the option to create a new announcement.
4. Enter the required announcement details.
5. Save or publish the announcement.
6. Return to the announcements list and verify that the new record appears.
7. Open the website in a separate browser tab.
8. Check the expected locations where announcements should be displayed.
9. Verify that the announcement is not visible anywhere on the website.

**Scenario B — Client notification has no destination**

1. Create an announcement from the Superadmin Dashboard.
2. Log in to the corresponding client workspace.
3. Locate the notification related to the announcement.
4. Click or open the notification.
5. Observe that no page, announcement details, or relevant destination is opened.
6. Verify that the client cannot access the announcement through the notification.

**Impact:**

- **Superadmin:** Cannot reliably confirm that announcements have been published and made accessible.
- **Client:** Receives a notification but cannot access the information it refers to.
- **Communication:** Important updates and notices may not reach their intended audience.
- **Usability:** Notifications appear interactive but provide no useful result when opened.
- **Business operations:** Clients may miss important announcements and lose confidence in the notification system.

**Suggested solution:**

Investigate the connection between announcement creation, website display, notification generation, and notification navigation.

Ensure that published announcements are correctly saved, exposed to their intended audience, and rendered in the appropriate website location.

For client notifications, ensure that each announcement-related notification contains a valid destination linked to the corresponding announcement or relevant page. Clicking the notification should open that destination reliably.

Verify that publication status, visibility settings, audience restrictions, and any start or end dates are handled consistently between the dashboard, website, and client workspace.

If an announcement requires an additional publishing action or visibility configuration, make this clear in the interface. Provide a reliable way for the superadmin to verify that an announcement is live and accessible, and ensure that clients can navigate from its notification to the relevant content.





# UX-006 — "+ Promo Code" button does not open the creation form or navigate to the Promo Codes section

**Screen:** Superadmin Dashboard > Credit & Promos

**Type:** UI / UX / Navigation / Functional

**Severity:** Minor

**Date found:** 21/10/2026

**What happens:**

As an admin, when opening the Credit & Promos page, clicking the **"+ Promo Code"** button located in the top-right corner does not automatically navigate to the Promo Codes section or open a form to create a new promo code.

As a result, the admin must manually scroll through the page to locate the relevant section and access the promo code creation functionality. This introduces unnecessary navigation and makes the button less intuitive.

Additionally, the behavior is inconsistent with the **"+ Pack"** button, which provides a more direct way to access its creation flow.

**What we expected:**

When the admin clicks the **"+ Promo Code"** button, the interface should provide a direct path to creating a promo code, following the same user experience pattern as the **"+ Pack"** button.

Either of the following behaviors would be acceptable:

- **Option 1 — Automatic scrolling:** Smoothly scroll the page to the Promo Codes section and position the relevant section and its creation controls clearly within the viewport.
- **Option 2 — Modal form:** Open a modal containing the promo code creation form directly, following the same interaction pattern used by the "+ Pack" button.

The preferred behavior should remain consistent with the existing UI patterns used throughout the dashboard, avoiding unnecessary navigation and making the creation process straightforward.

**Steps to reproduce:**

1. Log in to the Superadmin Dashboard.
2. Navigate to the Credit & Promos page.
3. Locate the **"+ Promo Code"** button in the top-right corner.
4. Click the button.
5. Observe that the page does not automatically scroll to the Promo Codes section or open a creation modal.
6. Manually scroll through the page to locate the Promo Codes section and access the creation functionality.
7. Compare this interaction with the behavior of the **"+ Pack"** button.

**Impact:**

- **Usability:** Admins must perform unnecessary manual navigation to reach the promo code creation functionality.
- **Consistency:** The interaction differs from the existing "+ Pack" workflow, reducing consistency across the dashboard.
- **User experience:** The button does not provide the direct action that admins would reasonably expect.

**Suggested solution:**

Update the **"+ Promo Code"** button so that clicking it either scrolls directly to the Promo Codes section or opens a promo code creation modal.

Preferably, reuse the same interaction pattern and design conventions as the **"+ Pack"** button to maintain a consistent user experience across the Credit & Promos page.

Ensure the form or destination is immediately accessible, correctly positioned, and usable on different screen sizes.



# UX-007 — "+ Manual Payment" button redirects to Invoices without providing a payment action

**Screen:** Superadmin Dashboard > Subscriptions & Invoices > Invoices / Manual Payments

**Type:** Functional / UI / UX / Navigation

**Severity:** Major

**Date found:** 21/10/2026

**What happens:**

As a superadmin, when clicking the **"+ Manual payment"** button in the top-right corner of the Subscriptions & Invoices page, the interface redirects to the **Invoices** tab instead of opening a form or providing a way to record a manual payment.

Once redirected, there is no visible action to create or record a manual payment. The Invoices tab only displays invoice-related information and filters, so the admin cannot complete the intended operation.

Additionally, the page contains a separate **Manual payments** tab, but this tab also does not provide any visible action to create, record, or otherwise manage a manual payment.

As a result, the admin has no clear way to initiate the manual payment workflow from either the top-right button or the dedicated Manual Payments tab. The button appears to be functional because it navigates to another tab, but it does not lead to the functionality its label promises.

The attached screenshot shows the Subscriptions & Invoices page, with the Invoices tab selected, the **"+ Manual payment"** button in the top-right corner, and the separate **Manual payments** tab.

**What we expected:**

Clicking the **"+ Manual payment"** button should open a manual payment creation form, either in a modal or on a dedicated page, allowing the superadmin to record a payment.

The form should provide the appropriate fields for the workflow, such as:

- The workspace or client associated with the payment.
- The amount and currency.
- The payment method, such as bank transfer, CCP, cash, or another supported method.
- The payment reference or transaction details, where applicable.
- The related invoice or subscription, if required.
- Any required receipt or supporting documentation, if supported.
- The payment status, including pending confirmation where applicable.

The **Manual payments** tab should also provide meaningful functionality, allowing the admin to review existing manual payment records and access the appropriate actions according to their status and permissions.

The interface should clearly distinguish between recording a manual payment, reviewing a submitted payment, confirming a payment, and settling an invoice, rather than redirecting the admin to a tab that does not support the requested operation.

**Steps to reproduce:**

1. Log in to the Superadmin Dashboard.
2. Navigate to **Subscriptions & Invoices**.
3. Locate the **"+ Manual payment"** button in the top-right corner.
4. Click the button.
5. Observe that the interface redirects to the Invoices tab instead of opening a manual payment form.
6. Inspect the available actions on the Invoices tab.
7. Verify that there is no visible action to create or record a manual payment.
8. Click the **Manual payments** tab.
9. Inspect the tab for available actions.
10. Observe that there is no visible action to initiate or manage a manual payment workflow.

**Impact:**

- **Superadmin:** Cannot easily initiate the manual payment workflow.
- **Billing operations:** Manually recorded payments may be delayed or impossible to process through the expected interface.
- **User experience:** The "+ Manual payment" button does not perform the action indicated by its label.
- **Consistency:** The dedicated Manual Payments tab does not provide an apparent workflow for the functionality it represents.
- **Financial management:** If no alternative workflow is available, admins may be unable to record payments accurately or associate them with the correct invoices and subscriptions.

**Suggested solution:**

Implement a functional manual payment workflow accessible through the **"+ Manual payment"** button.

The button should open a modal or dedicated page containing the required payment fields, allowing the superadmin to record and submit a manual payment.

Update the **Manual payments** tab to display existing manual payment records and provide appropriate actions for reviewing, confirming, rejecting, or otherwise processing them, depending on the payment status and the application's business rules.

Ensure that recording or confirming a manual payment correctly updates the relevant payment record and, where applicable, the associated invoice or subscription balance.

Finally, verify that the top-right button navigates directly to the intended workflow and that the Manual Payments tab provides meaningful functionality rather than acting as an empty destination.


# UX-008 — Agent presets support only French names and fall back to basic instructions in other languages

**Screen:** Superadmin Dashboard > AI Agent Presets > Create New Agent Preset / Client Workspace > AI Agent Configuration

**Type:** Functional / UX / Localization

**Severity:** Major

**Date found:** 21/10/2026

**What happens:**

As a superadmin, when creating a new agent preset, the form only provides the possibility to enter the preset name in French.

As a result, when the preset is used on the client side with a language other than French, the agent displays only the basic instruction, such as "Warm and friendly", instead of the intended language-specific instructions or configuration.

This limits the ability to configure and manage agent presets for clients operating in different languages. It also creates inconsistent agent behavior depending on the selected language.

**What we expected:**

The agent preset creation form should support the necessary language-specific fields for all languages supported by the application.

The preset name and instructions should be available in the appropriate language, or the application should provide a clearly defined fallback strategy when a translation is missing.

When a preset is selected on the client side, the agent should receive the correct instructions for the selected language rather than falling back to generic instructions unnecessarily.

**Steps to reproduce:**

1. Log in to the Superadmin Dashboard.
2. Navigate to AI Agent Presets.
3. Click Create New Agent Preset.
4. Inspect the available fields and verify that only a French name can be entered.
5. Create and save a preset with custom instructions.
6. Open the corresponding client workspace.
7. Configure or use the agent in a language other than French.
8. Inspect the instructions or behavior associated with the selected preset.
9. Observe that only the basic instruction, such as "Warm and friendly", is displayed or applied instead of the expected language-specific configuration.

**Impact:**

- **Superadmin:** Cannot configure localized agent presets adequately.
- **Client:** Receives generic instructions when using a language other than French.
- **AI agent behavior:** Agent responses may not follow the intended instructions for the selected language.
- **Internationalization:** The preset system does not provide a consistent multilingual configuration experience.

**Suggested solution:**

Extend the agent preset form to support localized names and instructions for all supported languages, or implement a clearly defined multilingual instruction structure.

Ensure that the client-side configuration loads the correct instructions for the selected language and that missing translations are handled through an intentional fallback mechanism, not an unexpected loss of custom instructions.

---

# UX-009 — Selected promo code effect is not displayed correctly in the creation form

**Screen:** Superadmin Dashboard > Credits & Promos > Create Promo Code

**Type:** Functional / UI / UX

**Severity:** Major

**Date found:** 21/10/2026

**What happens:**

When creating a promo code in the Credits & Promos section, selecting an option in the Effect field does not display the selected choice correctly in the form.

This makes it difficult for the admin to verify which effect has been selected before saving the promo code. The interface therefore provides insufficient feedback about the current configuration.

Depending on how the selected value is handled internally, this may also create uncertainty about whether the intended effect will be applied when the promo code is used.

**What we expected:**

When an admin selects an effect in the promo code creation form, the selected option should remain clearly visible in the field.

The selected effect should be preserved when the admin interacts with other fields and should be saved correctly with the promo code.

When reviewing or editing the resulting promo code, the configured effect should be displayed accurately.

**Steps to reproduce:**

1. Log in to the Superadmin Dashboard.
2. Navigate to Credits & Promos.
3. Open the promo code creation form.
4. Locate the Effect field.
5. Select one of the available effect options.
6. Observe that the selected choice is not displayed correctly in the field.
7. Interact with other fields and check whether the selected effect remains visible.
8. Save the promo code, if possible, and verify whether the stored effect matches the selected option.

**Impact:**

- **Superadmin:** Cannot confidently verify the promo code configuration before saving.
- **Usability:** The form provides insufficient feedback after a selection is made.
- **Promotion configuration:** There is a risk of saving an unintended effect if the selected value is not preserved correctly.

**Suggested solution:**

Fix the Effect field so that the selected option is always displayed clearly and remains synchronized with the form state.

Ensure that the chosen effect is persisted correctly when the promo code is saved and accurately retrieved when the code is reopened for review or editing.

---

# UX-010 — Credit packs cannot be deleted even when they have never been purchased

**Screen:** Superadmin Dashboard > Credits & Promos > Credit Packs > Actions

**Type:** Functional / UX / Data Management

**Severity:** Major

**Date found:** 21/10/2026

**What happens:**

As a superadmin, when creating a credit pack in the Credits & Promos section, there is no way to delete the pack afterward, even when no client has purchased or used it.

This prevents admins from removing test packs, incorrectly configured packs, or outdated offers that have never been used.

As a result, unwanted credit packs remain in the dashboard and may create unnecessary clutter or confusion when managing available offers.

**What we expected:**

The system should allow a credit pack to be deleted when it has never been purchased, used, or referenced by a transaction that requires its historical record to be preserved.

If a credit pack has already been purchased or used, the system may prevent permanent deletion and offer an alternative, such as deactivation or archiving, to preserve transaction history.

The interface should clearly explain why deletion is unavailable when a pack cannot safely be removed.

**Steps to reproduce:**

1. Log in to the Superadmin Dashboard.
2. Navigate to Credits & Promos.
3. Create a new credit pack with test information.
4. Save the pack.
5. Verify that no client has purchased or used the pack.
6. Locate the newly created pack in the credit packs list.
7. Open its Actions menu or editing interface.
8. Look for a Delete or Remove action.
9. Observe that there is no way to delete the unused pack.

**Impact:**

- **Superadmin:** Cannot clean up unused or incorrectly configured credit packs.
- **Data management:** Test and obsolete records accumulate in the dashboard.
- **Usability:** Admins have limited control over credit pack lifecycle management.

**Suggested solution:**

Provide a deletion action for credit packs that have never been purchased, used, or associated with transactions.

Before deletion, display a confirmation dialog identifying the pack being removed. For packs with purchase or usage history, prevent destructive deletion where necessary and provide a clear alternative, such as deactivation or archiving.

Ensure that any deletion restrictions are enforced by the backend and explained clearly in the interface.

---

# UX-011 — Promo code redemption count displays 0 despite a successful redemption

**Screen:** Superadmin Dashboard > Credits & Promos > Promo Codes > Actions > Redemptions

**Type:** Functional / Data Integrity / UI

**Severity:** Major

**Date found:** 21/10/2026

**What happens:**

When viewing the available actions for a promo code in the Credits & Promos section, the Redemptions action displays a count of 0 even though the promo code has already been redeemed by at least one client.

The displayed count does not reflect the actual redemption activity associated with the code.

This creates a discrepancy between the promo code's actual usage and the information presented in the admin interface, making it difficult to determine whether a promotion is being used correctly.

**What we expected:**

The redemption count should accurately reflect the number of successful redemptions associated with the promo code.

When an admin opens the Redemptions action, the system should display the appropriate redemption records or details, including the associated client and redemption information where supported.

The count should update correctly after a successful redemption and remain consistent across the promo code list, redemption details, and relevant reports.

Failed, rejected, or otherwise unsuccessful redemption attempts should not be counted as successful redemptions unless the application's business rules explicitly define them that way.

**Steps to reproduce:**

1. Log in to the Superadmin Dashboard.
2. Navigate to Credits & Promos.
3. Create or identify an existing promo code.
4. Apply the promo code through a valid client workflow.
5. Verify that the redemption is completed successfully.
6. Return to the Superadmin Dashboard.
7. Locate the corresponding promo code.
8. Open its Actions menu and inspect the Redemptions option.
9. Observe that the displayed count remains at 0 despite the successful redemption.
10. Open the redemption details, where available, and compare the records with the displayed count.

**Impact:**

- **Superadmin:** Cannot reliably monitor promo code usage.
- **Reporting:** Redemption counts may be inaccurate or misleading.
- **Promotion management:** Admins cannot confidently evaluate the performance of promotional campaigns.
- **Data integrity:** The displayed redemption count does not appear to match the underlying activity.

**Suggested solution:**

Investigate the redemption tracking and counting logic used by the promo code Actions menu.

Ensure that successful redemptions are persisted and correctly associated with the relevant promo code and client. Calculate or retrieve the displayed count from the authoritative redemption records, and refresh the count after a successful redemption.

Verify consistency between the action menu, redemption details, and any associated reports.

---

# UX-012 — Attaching a file or image to a client support message returns VALIDATION_ERRORS

**Screen:** Superadmin Dashboard > Support > Client Conversation > Send Message / Attach File

**Type:** Functional / UI / Validation / File Upload

**Severity:** Major

**Date found:** 21/10/2026

**What happens:**

When an admin attempts to attach a file or image to a message intended for a client through the Support section, the application returns the following error:

`Check the fields (VALIDATION_ERRORS)`

As a result, the admin cannot successfully send the message with its intended attachment.

The error message is generic and does not identify which field failed validation or whether the problem is related to the file type, file size, attachment format, or another required field.

This makes it difficult to identify the cause of the failure and prevents the admin from reliably sharing supporting documents or images with the client through the support workflow.

**What we expected:**

The system should accept valid file and image attachments that comply with the application's supported file types and size limits.

If an attachment is invalid, the interface should display a specific and actionable validation message explaining the reason, such as an unsupported file type or a file exceeding the permitted size.

When a valid file or image is attached, the admin should be able to send the message successfully, and the client should be able to access the attachment through the conversation.

The backend validation response should be mapped to an understandable error message in the interface rather than exposing only a generic VALIDATION_ERRORS message.

**Steps to reproduce:**

1. Log in to the Superadmin Dashboard.
2. Navigate to Support.
3. Open a conversation with a client.
4. Compose a message intended for the client.
5. Attach a valid image file.
6. Attempt to send the message.
7. Observe that the application displays `Check the fields (VALIDATION_ERRORS)`.
8. Repeat the test using another supported image format or a valid document, if documents are supported.
9. Verify whether the message and attachment are sent successfully.
10. Observe whether the interface identifies the field or validation rule causing the failure.

**Impact:**

- **Support team:** Cannot reliably send supporting files or images to clients.
- **Client communication:** Important evidence, instructions, screenshots, or documents may not reach the client.
- **Usability:** The generic error provides insufficient information to diagnose the problem.
- **Operational efficiency:** Admins may need to use external channels to share files that should be handled within the support system.

**Suggested solution:**

Investigate the backend validation response and attachment upload workflow used by the Support messaging interface.

Ensure that valid attachments are accepted and correctly linked to the outgoing message. Verify that frontend and backend validation rules agree on supported formats, file sizes, required fields, and attachment handling.

Return field-specific validation errors and display clear messages in the UI. After a successful send, confirm that the message and attachment are visible to the admin and accessible to the intended client.

---

# UX-013 — Groq API key is marked as Unreachable in AI Providers & Pricing

**Screen:** Superadmin Dashboard > AI Providers & Pricing > Groq Provider / API Key Configuration

**Type:** Functional / Integration / API Connectivity

**Severity:** Major

**Date found:** 21/10/2026

**What happens:**

When configuring the Groq provider in the AI Providers & Pricing section, the provider or API key is marked as **Unreachable**.

This status indicates that the application cannot establish or verify connectivity with the Groq service, but the interface does not, by itself, establish whether the issue is caused by the API key, the provider endpoint, network connectivity, or the application's connection-checking logic.

As a result, the admin cannot confidently determine whether the Groq integration is configured correctly or whether the provider is available for use by the AI agents.

**What we expected:**

When a valid Groq API key is configured and the service is reachable, the application should successfully verify the connection and display an accurate status.

If the connection fails, the interface should provide an actionable explanation that distinguishes between relevant failure categories, such as:

- Invalid or unauthorized API key.
- Network or connectivity failure.
- Incorrect endpoint or configuration.
- Provider service unavailable or request timeout.

The status should reflect the actual result of the connectivity check rather than incorrectly marking a working integration as unreachable.

The application should also avoid exposing the API key in error messages, logs, or the user interface.

**Steps to reproduce:**

1. Log in to the Superadmin Dashboard.
2. Navigate to AI Providers & Pricing.
3. Locate the Groq provider configuration.
4. Enter or inspect the configured Groq API key.
5. Use the available connection test or provider validation action, if present.
6. Observe that the provider or API key is marked as Unreachable.
7. Verify the key's validity and provider configuration through the appropriate secure process.
8. Repeat the connection test with a known-valid key, without exposing the key in screenshots or bug reports.
9. Observe whether the application continues to report the provider as unreachable.
10. Inspect any available error details or logs to identify the underlying connection failure.

**Impact:**

- **Superadmin:** Cannot confidently verify the status of the Groq integration.
- **AI functionality:** If the provider cannot actually be reached, agents depending on Groq may fail to respond or may be unable to use the configured provider.
- **Configuration and troubleshooting:** The lack of a clear diagnostic result makes it difficult to distinguish configuration errors from connectivity failures.
- **Reliability:** An inaccurate connection status may prevent admins from using a correctly configured provider or delay the identification of a genuine outage.

**Suggested solution:**

Investigate the Groq connectivity check, API key validation, provider endpoint configuration, and error handling.

Verify the integration using a known-valid API key and the currently supported Groq endpoint. Ensure the connection check distinguishes authentication failures, network issues, timeouts, and provider availability problems.

Display an accurate connection status with a useful diagnostic message, while keeping API keys secret. Confirm that a successfully configured and reachable provider can be selected and used by the AI agents as intended.



# UX-014 — Spam / Insults counter displays a count, but the corresponding record is missing from the table

**Screen:** Superadmin Dashboard > Signals & Security > Spam / Insults / Reports table

**Type:** Functional / UI / Data Consistency

**Severity:** Major

**Date found:** 21/10/2026

**What happens:**

As a superadmin, when accessing the Signals & Security module, the Spam / Insults summary card displays a count of **1**, but the corresponding information does not appear in the reports table.

As shown in the attached screenshot, the summary card displays a count of 1, while the selected "To process" tab indicates that there are 0 reports and displays the empty-state message "No reports to process."

This creates a discrepancy between the information displayed in the summary section and the records available in the main table. The admin cannot determine which record accounts for the displayed count or locate the corresponding report through the table.

It is also unclear whether the counter represents spam reports, blocked clients, or another related metric, as the card subtitle appears to refer to clients blocked by merchants.

**What we expected:**

The summary counters and the corresponding tables should display consistent and understandable information.

If the Spam / Insults counter represents report records, the corresponding records should be available in the appropriate table or tab, with the relevant filters applied.

If the counter represents a different metric, such as clients blocked by merchants, its label should clearly identify what is being counted, and the admin should be able to access the relevant records where applicable.

The interface should not display a non-zero count without providing a clear explanation or a way to locate the underlying records.

**Steps to reproduce:**

1. Log in to the Superadmin Dashboard.
2. Navigate to Signals & Security.
3. Locate the Spam / Insults summary card.
4. Observe that the card displays a count of 1.
5. Inspect the selected "To process" tab.
6. Observe that the table indicates 0 reports and displays "No reports to process."
7. Check the other relevant tabs, including reported clients, reported merchants, and processed reports.
8. Verify whether the record associated with the displayed counter can be located.

**Impact:**

- **Superadmin:** Cannot identify or investigate the record represented by the counter.
- **Moderation:** Potential spam-related reports or related records may be difficult to locate and process.
- **Data consistency:** Summary metrics appear inconsistent with the information in the table.
- **Usability:** Admins cannot easily determine what the counter represents or where to find the corresponding records.

**Suggested solution:**

Investigate the data source and calculation used by the Spam / Insults summary card and compare it with the data displayed in the reports table.

Ensure that the counter accurately reflects the intended metric and that the corresponding records are accessible from the appropriate tab.

If the counter represents blocked clients rather than spam reports, update the label to make this distinction clear and provide access to the relevant records where appropriate.

Also verify that filters, report statuses, and data-fetching logic do not cause existing records to be excluded from the table while still being included in the summary count.



# UX-015 — Customer blocking is only available through Settings > Security, not from the Customers list

**Screen:** Client Workspace > Customers > Actions / Settings > Security

**Type:** UI / UX / Feature Improvement

**Severity:** Minor

**Date found:** 21/10/2026

**What happens:**

As a client admin, blocking a customer currently requires navigating to **Settings > Security** and manually entering the customer's unique identifier to block them.

Although the Customers section already provides a list of customers and an **Actions** button for each customer, there is no direct option to block a customer from this interface.

As a result, the admin must leave the customer list, navigate to the security settings, find or copy the customer's unique identifier, and enter it manually to complete the operation.

The existing functionality works, but the process is unnecessarily complicated for an action that could be performed directly from the relevant customer record.

**What we expected:**

The Customers list should provide a **Block customer** action within each customer's Actions menu.

When the admin selects this action, the system should display a confirmation dialog identifying the customer to be blocked. After confirmation, the customer should be blocked without requiring the admin to navigate to Settings > Security or manually enter a unique identifier.

The existing Settings > Security option can remain available as an alternative method.

The interface should also clearly indicate when a customer is already blocked and provide an appropriate unblock action where supported.

**Steps to reproduce:**

1. Log in to the Client Workspace as an admin.
2. Navigate to the Customers section.
3. Locate an existing customer.
4. Open the customer's Actions menu.
5. Observe that there is no direct Block customer option.
6. Navigate to Settings > Security.
7. Locate the customer using their unique identifier.
8. Enter the identifier and perform the blocking action.
9. Observe that the customer can only be blocked through the security settings workflow.

**Impact:**

- **Usability:** Blocking a customer requires unnecessary navigation and manual input.
- **Efficiency:** Admins must retrieve and enter a unique identifier even when the customer is already visible in the Customers list.
- **User experience:** The blocking functionality is not available where admins would naturally expect to find it.

**Suggested solution:**

Add a **Block customer** action to the Actions menu for each customer in the Customers section.

Display a confirmation dialog before applying the action to prevent accidental blocking. After confirmation, update the customer's status in the interface and ensure the change is reflected consistently in Settings > Security.

Retain the existing security settings workflow as an alternative. This is a minor usability improvement intended to make customer management quicker and more intuitive.