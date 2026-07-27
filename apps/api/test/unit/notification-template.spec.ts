import { EVENT_TYPES } from '@pms/shared-types';
import { describe, expect, it } from 'vitest';
import { renderTemplate } from '../../src/modules/notifications/notification-targets';

/**
 * Nhãn thông báo hiển thị cho CHỦ CƠ SỞ, không phải lập trình viên.
 *
 * Từng có sự cố: event thiếu trong bảng ánh xạ rơi xuống nhánh mặc định và in ra
 * "Sự kiện cleaning_task.assigned." ngay trên trang /notifications. Kiểu
 * Record<EventType, …> đã chặn ở tầng biên dịch; test này chặn thêm ở tầng nội dung
 * (nhãn rỗng, hoặc lỡ nhét tên sự kiện vào chuỗi hiển thị).
 */
describe('renderTemplate', () => {
  it('mọi event trong catalog đều có nhãn tiếng Việt riêng', () => {
    for (const type of EVENT_TYPES) {
      const { title, body } = renderTemplate(type);
      expect(title.length, `${type} thiếu tiêu đề`).toBeGreaterThan(0);
      expect(body.length, `${type} thiếu nội dung`).toBeGreaterThan(0);
      // Không được lọt tên sự kiện kỹ thuật (dấu chấm ngăn cách aggregate.verb) ra UI.
      expect(`${title} ${body}`, `${type} lộ tên sự kiện kỹ thuật`).not.toContain(type);
    }
  });

  it('nhãn không trùng nhau — mỗi event phải phân biệt được trên inbox', () => {
    const titles = EVENT_TYPES.map((t) => renderTemplate(t).title);
    // booking.* dùng chung tiền tố nhưng tiêu đề phải khác nhau để người đọc phân biệt.
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('event ngoài catalog dùng câu chung, KHÔNG in tên sự kiện', () => {
    const { title, body } = renderTemplate('some.unknown_event');
    expect(title).toBe('Cập nhật từ hệ thống');
    expect(body).not.toContain('some.unknown_event');
  });
});
