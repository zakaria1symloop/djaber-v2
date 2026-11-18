// /s/[code] with an unknown code: the page's own « not found » state (PublicHeader + card), served with a real 404 status
// (full-test 15/11 deferred item — it answered 200).
import { PublicTrackingPage } from '@/features/delivery/public/tracking-page';

export default function TrackingNotFound() {
  return <PublicTrackingPage code="" notFound />;
}
