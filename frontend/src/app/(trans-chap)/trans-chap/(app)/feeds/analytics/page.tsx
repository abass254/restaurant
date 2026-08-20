import { FeedsAnalyticsDashboard } from "@/components/app/FeedsAnalyticsDashboard";
import { TransChapSocial } from "@/components/trans-chap/TransChapSocial";

export const dynamic = "force-dynamic";

export default function TransChapFeedsAnalyticsPage() {
  return (
    <TransChapSocial>
      <FeedsAnalyticsDashboard />
    </TransChapSocial>
  );
}
