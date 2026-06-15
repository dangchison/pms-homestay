import { SettingsNav } from '@/components/settings/SettingsNav';

/** Khu Settings (task 6.7, ui/01 S1–S6): tab điều hướng + nội dung từng trang. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <h1 className="text-lg font-semibold tracking-tight">Cài đặt</h1>
      <SettingsNav />
      {children}
    </div>
  );
}
