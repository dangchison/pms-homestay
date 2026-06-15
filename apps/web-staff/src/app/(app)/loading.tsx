import { LoadingScreen } from '@pms/ui';

/** Fallback Suspense khi điều hướng giữa các trang nhân viên (Next loading.tsx). */
export default function AppLoading() {
  return <LoadingScreen title="PMS Staff" />;
}
