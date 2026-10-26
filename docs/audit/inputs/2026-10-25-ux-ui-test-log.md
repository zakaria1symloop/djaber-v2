# Djaber ai — UX / UI test log — 25/10/2026



### UX-001 — Products: adding an image triggers a preview request in the Super Admin dashboard before the client saves the product — à arbitrer par le fondateur

- Screen: Client workspace > Products > Edit product (`/en/products/{product-id}/edit`); Super Admin dashboard > Moderation (`/en/admin/moderation`)
- Type: UX / Functional
- Severity: Major
- Date found: 25/10/2026
- What happens: While editing an existing product, the client can add an image. As soon as the image is added, a preview request is triggered and appears in the Super Admin dashboard's Moderation section, even though the client has not saved the product yet. This creates a side effect before the editing process is completed: the Super Admin may receive a preview request for a product whose changes are still only a draft and may subsequently be modified or discarded by the client.
- What we expected: Adding an image while editing a product should only update the form's current draft and its image preview. The preview request should be triggered only after the client saves the product.
- Steps to reproduce: 1. Log in to a client workspace. 2. Navigate to Products and open an existing product for editing (`/en/products/{product-id}/edit`). 3. Add an image to the product. 4. Do not save the product. 5. Open the Super Admin dashboard and navigate to Moderation (`/en/admin/moderation`). 6. Verify that a preview request for the product has already appeared in Moderation despite the product not being saved.


### UX-002 — Help tickets: clients cannot attach files when replying to a support ticket

- Screen: Client workspace > Help > Tickets > Ticket details (`/en/help/tickets/{ticket-id}`)
- Type: UX / Functional
- Severity: Minor
- Date found: 25/10/2026
- What happens: When a client opens an existing support ticket and replies to a message, there is no option to attach a file to the reply. This prevents clients from directly sharing relevant screenshots, images, or documents that could help explain their issue and assist the support team in resolving it.
- What we expected: Clients should be able to attach files when replying to a support ticket, allowing them to provide relevant screenshots, images, or documents alongside their message. Attachments should be included in the ticket conversation and accessible to the support team.
- Steps to reproduce: 1. Log in to a client workspace. 2. Navigate to Help > Tickets and open a ticket (`/en/help/tickets/{ticket-id}`). 3. Enter a reply in the message field. 4. Look for an option to attach a file before sending the reply. 5. Verify that no attachment option is available.


### UX-003 — Products: editing a product variant does not trigger a review in the Super Admin dashboard — à arbitrer par le fondateur

- Screen: Client workspace > Products > Edit product (`/en/products/{product-id}/edit`); Super Admin dashboard > Moderation (`/en/admin/moderation`)
- Type: UX / Functional
- Severity: Major
- Date found: 25/10/2026
- What happens: When a client edits an existing product variant and saves the changes, no review request is triggered in the Super Admin dashboard. Unlike other product changes that can generate a moderation request, variant modifications do not appear in the Moderation section, preventing the Super Admin from reviewing these changes through the expected workflow.
- What we expected: Editing and saving an existing product variant should trigger a review request in the Super Admin dashboard, allowing the Super Admin to review the modifications through the Moderation section. 
- Steps to reproduce: 1. Log in to a client workspace. 2. Navigate to Products and open an existing product for editing (`/en/products/{product-id}/edit`). 3. Edit an existing variant, for example, change its name or price. 4. Save the product changes. 5. Log in as Super Admin and navigate to Moderation (`/en/admin/moderation`). 6. Verify that no review request has been generated for the variant modifications.

### UX-005 — Product moderation: the X button does not reject a product directly and behaves like « Open review »

- Screen: Super Admin dashboard > Moderation (`/en/admin/moderation`)
- Type: UX / Functional
- Severity: Minor
- Date found: 25/10/2026
- What happens: In the Super Admin dashboard's Moderation section, clicking the X button on a product does not perform the expected rejection action. Instead, it behaves like clicking « Open review », requiring the Super Admin to select a rejection reason and then click the « Reject » button to complete the action. This makes the X button redundant, as it does not provide a direct rejection shortcut.
- What we expected: Clicking the X button should trigger the product rejection action directly, with a confirmation step if necessary. If selecting a rejection reason is mandatory, the X button should open a dedicated rejection flow rather than behave identically to « Open review ».
- Steps to reproduce: 1. Log in as Super Admin. 2. Navigate to Moderation (`/en/admin/moderation`). 3. Locate a product awaiting moderation. 4. Click the X button on the product. 5. Verify that the product is not rejected directly and that the interface instead requires selecting a reason and clicking « Reject », just like the « Open review » workflow.


### UX-006 — AI chatbot: products and variants pending moderation are still mentioned in Messenger responses — à arbitrer par le fondateur

- Screen: Client workspace > Products (`/en/products`); Super Admin dashboard > Moderation (`/en/admin/moderation`); Connected Facebook Page > Messenger chatbot
- Type: UX / Functional
- Severity: Major
- Date found: 25/10/2026
- What happens: The chatbot connected to a Facebook Page through Messenger can respond to customer questions about products and their variants that are still pending review in the Super Admin dashboard's Moderation section. This means product information can be exposed to customers through the chatbot before the Super Admin has completed the moderation process and approved the product or variant.
- What we expected: The chatbot should only use approved and active products and variants when answering customer questions or making recommendations. Products and variants awaiting moderation should remain excluded from chatbot responses until the Super Admin has reviewed and approved them.
- Steps to reproduce: 1. Log in to a client workspace. 2. Create a product or add a variant that triggers a moderation request. 3. Leave the product or variant pending review. 4. Log in as Super Admin and verify that the product or variant appears in Moderation (`/en/admin/moderation`) with a pending review status. 5. Open Messenger for the Facebook Page connected to the chatbot. 6. Ask the chatbot about the pending product or variant by name. 7. Verify that the chatbot responds with information about the product or variant despite it still awaiting moderation.


### UX-007 — Product moderation: review requests are triggered inconsistently when editing products or adding variants

- Screen: Client workspace > Products > Edit product (`/en/products/{product-id}/edit`); Super Admin dashboard > Moderation (`/en/admin/moderation`)
- Type: UX / Functional
- Severity: Major
- Date found: 25/10/2026
- What happens: The moderation workflow behaves inconsistently when clients modify existing products. Sometimes, editing a product triggers a review request that appears in the Super Admin dashboard. However, other modifications, such as editing a product by adding a new variant, do not trigger a review request at all. As a result, the Super Admin cannot reliably identify which product changes require approval, and some modifications may bypass the moderation workflow entirely.
- What we expected: Product modifications should follow a consistent moderation workflow. Whenever a change requires Super Admin approval, a review request should be generated and displayed in the Moderation section. This should apply consistently to relevant product edits, including adding, editing, or removing variants, according to the intended moderation rules. 
- Steps to reproduce: 1. Log in to a client workspace. 2. Navigate to Products and edit an existing product (`/en/products/{product-id}/edit`). 3. Modify and save the product, then check whether a review request appears in the Super Admin dashboard's Moderation section (`/en/admin/moderation`). 4. Edit another existing product and add a new variant. 5. Save the changes and return to Moderation (`/en/admin/moderation`). 6. Verify that the variant change may not generate a review request, even though other product modifications trigger one.

### UX-009 — ZR Express: customer orders do not appear in ZR Express

- Screen: Client workspace > Orders (`/en/orders`); ZR Express dashboard
- Type: Functional
- Severity: Major
- Date found: 25/10/2026
- What happens: After a customer places an order in the platform, the order does not appear in ZR Express. This prevents the client from locating the order in the delivery service's dashboard and may prevent them from processing the shipment through ZR Express.
- What we expected: Orders intended for delivery through ZR Express should be correctly transmitted to the delivery service and appear in the ZR Express dashboard, with the necessary customer, delivery address, phone number, and order details.
- Steps to reproduce: 1. Log in to a client workspace. 2. Place or receive a customer order intended for delivery through ZR Express. 3. Open the ZR Express dashboard. 4. Search for the order using its reference or customer details. 5. Verify that the order does not appear in ZR Express.