import { type Locator, type Page, expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

/**
 * Task 1.5 (docs/19 §2 Đợt 1) — board /cleaning: Kanban 4 cột theo status. Dữ liệu demo
 * (pnpm db:seed:dev, PR #65 · scripts/seed-dev.ts:454-474):
 *   102 PENDING · 202 IN_PROGRESS · 301 COMPLETED · 101 VERIFIED (mọi task gán "Buồng phòng Demo").
 *
 * Không assert ảnh before/after (seed rỗng ảnh). Test verify idempotent: nếu 301 đã VERIFIED
 * từ lần chạy trước thì chỉ assert-vị-trí, không bấm lại (COMPLETED→VERIFIED một chiều).
 */

/** Cột theo aria-label (section[aria-label] → role=region). */
function column(page: Page, label: string): Locator {
  return page.getByRole('region', { name: label, exact: true });
}
/** Card phòng trong 1 cột (article chứa "Phòng <n>"). */
function cardInColumn(page: Page, label: string, room: string): Locator {
  return column(page, label).locator('article').filter({ hasText: `Phòng ${room}` });
}

async function openCleaning(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Dọn phòng', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dọn phòng' })).toBeVisible();
  // Chờ board render xong DỮ LIỆU (không chỉ heading tĩnh): trước khi tải, page hiện
  // <Skeleton>, chưa có <article> nào → isVisible() ăn phải race. Card 101 (VERIFIED)
  // luôn có trong mọi lần chạy (không test nào đụng tới) nên là mốc "đã tải" ổn định.
  await expect(cardInColumn(page, 'Đã duyệt', '101')).toBeVisible();
}

test('board hiện task seed đúng cột + 4 tiêu đề cột', async ({ page }) => {
  await loginDemo(page);
  await openCleaning(page);

  const main = page.getByRole('main');
  // 4 tiêu đề cột (nhãn tiếng Việt) hiển thị.
  for (const label of ['Chờ', 'Đang dọn', 'Đã xong', 'Đã duyệt']) {
    await expect(main.getByRole('heading', { name: label, exact: true })).toBeVisible();
  }

  // Task seed nằm đúng cột theo status. (102 assign KHÔNG đổi status; 202/101 không đụng.)
  await expect(cardInColumn(page, 'Chờ', '102')).toBeVisible();
  await expect(cardInColumn(page, 'Đang dọn', '202')).toBeVisible();
  await expect(cardInColumn(page, 'Đã duyệt', '101')).toBeVisible();
  // 301 khởi đầu COMPLETED nhưng verify (test khác) đẩy nó sang VERIFIED một chiều; để
  // re-runnable trên cùng seed → chấp nhận 301 ở "Đã xong" HOẶC "Đã duyệt".
  await expect(cardInColumn(page, 'Đã xong', '301').or(cardInColumn(page, 'Đã duyệt', '301'))).toBeVisible();
});

test('nghiệm thu card COMPLETED (301) → chuyển sang cột Đã duyệt (idempotent)', async ({ page }) => {
  await loginDemo(page);
  await openCleaning(page);

  const inCompleted = cardInColumn(page, 'Đã xong', '301');
  const inVerified = cardInColumn(page, 'Đã duyệt', '301');

  // Chờ 301 SETTLE ở ĐÚNG một trong hai cột trước khi rẽ nhánh — bare isVisible() là kiểm
  // tra tức thời không auto-wait, dễ trả false khi board chưa tải xong (bug flaky cũ).
  await expect(inCompleted.or(inVerified)).toBeVisible();

  // Idempotent: nếu 301 đã ở "Đã duyệt" (lần chạy trước) → chỉ assert vị trí, không bấm.
  if (await inCompleted.isVisible().catch(() => false)) {
    await inCompleted.getByRole('button', { name: 'Nghiệm thu' }).click();
    // Sau invalidate ['cleaning'] → 301 rời cột "Đã xong", xuất hiện ở "Đã duyệt".
    await expect(inVerified).toBeVisible();
    await expect(inCompleted).toHaveCount(0);
  } else {
    await expect(inVerified).toBeVisible();
  }
});

test('đổi người dọn card PENDING (102) → vẫn ở cột Chờ, Select cập nhật giá trị', async ({ page }) => {
  await loginDemo(page);
  await openCleaning(page);

  const card = cardInColumn(page, 'Chờ', '102');
  await expect(card).toBeVisible();

  const trigger = card.getByRole('combobox', { name: 'Người dọn' });
  const current = (await trigger.innerText()).trim();

  // Chọn một người dọn KHÁC giá trị hiện tại (seed = "Buồng phòng Demo").
  // Option portal ra document.body (Radix) → không scope trong main.
  const target = current.includes('Buồng phòng') ? 'Lễ tân Demo' : 'Buồng phòng Demo';
  await trigger.click();
  await page.getByRole('option', { name: target, exact: true }).click();

  // Assign KHÔNG đổi status: card vẫn ở cột "Chờ" và Select hiển thị người mới.
  await expect(card).toBeVisible();
  await expect(cardInColumn(page, 'Chờ', '102').getByRole('combobox', { name: 'Người dọn' })).toContainText(
    target,
  );
  // Không lọt sang cột khác.
  await expect(cardInColumn(page, 'Đang dọn', '102')).toHaveCount(0);
});
