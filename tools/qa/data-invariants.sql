-- QA — data invariants (read-only). Each block must return no row; a row is a bug of the « derived state not
-- reconciled » family (docs/audit/2026-11-12-weak-points.md §2). Run against a copy or read-only:
--   docker exec -i djaber-v2-pg psql -U djaber -d djaber -q < tools/qa/data-invariants.sql
\pset footer off
\echo '== I1 finished order (delivered/cancelled/returned) with a parcel still on its way (a failed send is handled once the order is closed — UX-064)'
select o.number, o.status, o."deliveryStatus", (select string_agg(s.status::text, ',') from "Shipment" s where s."orderId"=o.id) shipments from "Order" o
where o.status in ('delivered','cancelled','returned') and (o."deliveryStatus" in ('pending','sent','in_transit','out_for_delivery') or exists (select 1 from "Shipment" s where s."orderId"=o.id and s.status in ('pending','sent','picked_up','in_transit','out_for_delivery'))) limit 20;
\echo '== I2 order status and delivery status disagree'
select o.status, o."deliveryStatus", count(*) from "Order" o where (o.status='shipped' and o."deliveryStatus" in ('not_sent','delivered','returned')) or (o.status in ('new','confirmed','preparing') and o."deliveryStatus" in ('in_transit','out_for_delivery','delivered','returned')) or (o.status='delivered' and o."deliveryStatus" in ('in_transit','out_for_delivery','returned')) group by 1,2;
\echo '== I3 delivered order not paid'
select o."paymentStatus", count(*) from "Order" o where o.status='delivered' group by 1;
\echo '== I4 client counters vs recomputed (orderCount = orders not cancelled + completed sales; totalSpent = delivered orders + completed sales)'
with r as (select c.id, c."orderCount" oc, c."totalSpent" ts, c."cancelCount" cc,
  (select count(*) from "Order" o where o."clientId"=c.id and o.status<>'cancelled') + (select count(*) from "Sale" s where s."clientId"=c.id and s.status='completed') oc2,
  (select coalesce(sum(o.total),0) from "Order" o where o."clientId"=c.id and o.status='delivered') + (select coalesce(sum(s.total),0) from "Sale" s where s."clientId"=c.id and s.status='completed') ts2,
  (select count(*) from "Order" o where o."clientId"=c.id and o.status='cancelled') cc2
  from "Client" c where c."deletedAt" is null)
select * from r where oc<>oc2 or ts<>ts2 or cc<>cc2 limit 20;
\echo '== I5 product with variants: stock vs sum of variant stock'
select p.name, p.stock, (select sum(v.stock) from "ProductVariant" v where v."productId"=p.id and v."deletedAt" is null) sumv from "Product" p where p."hasVariants" and p."deletedAt" is null and coalesce(p.stock,-1) <> coalesce((select sum(v.stock) from "ProductVariant" v where v."productId"=p.id and v."deletedAt" is null),0) limit 15;
\echo '== I6 product moderation status vs its current review item'
select p."moderationStatus", m.status item_status, count(*) from "Product" p left join "ModerationItem" m on m.id=p."moderationItemId" where p."deletedAt" is null group by 1,2 order by 1,2;
\echo '== I7 invoice paid flags'
select status, ("paidAt" is not null) has_paid_at, count(*) from "Invoice" group by 1,2 order by 1,2;
\echo '== I8 conversations needing a human with no assignee and no recent message (age)'
select status, count(*), min("updatedAt") oldest from "Conversation" where "deletedAt" is null group by 1;
