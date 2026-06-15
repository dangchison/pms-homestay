import { LoadingScreen } from '@pms/ui';

/** Fallback Suspense khi điều hướng giữa các trang dashboard (Next loading.tsx). */
export default function DashboardLoading() {
  return <LoadingScreen />;
}
