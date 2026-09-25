import { PageSkeleton } from "@/components/PageSkeleton";

// Makes the tabs prefetchable (a dynamic route with no loading boundary is not
// prefetched at all) and gives a tap something to show straight away.
export default function Loading() {
  return <PageSkeleton />;
}
