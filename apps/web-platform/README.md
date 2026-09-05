# @pms/web-platform — bảng điều khiển nền tảng

Console nội bộ của **nhà cung cấp**, không phải của khách hàng. Dùng để cấu hình
gói thuê bao, xem/sửa tenant và xác nhận thanh toán.

Đây là app riêng chứ không phải một route trong `web-admin` vì hai loại danh tính
khác nhau hoàn toàn: `platform_users` (bảng global, secret `JWT_PLATFORM_SECRET`,
claim `typ: 'platform'`) và `users` của tenant. Gộp chung một app thì token store,
guard và interceptor dùng lẫn — chỗ dễ sinh lỗi phân quyền nhất.

## Chạy local

```bash
pnpm --filter @pms/web-platform dev
```

Mở http://localhost:3003. Cần API chạy ở `NEXT_PUBLIC_API_URL` (mặc định
`http://localhost:3001`) và **`JWT_PLATFORM_SECRET` phải có trong `.env` của API**
— thiếu thì `/platform/auth/login` trả 503 `PLATFORM_AUTH_NOT_CONFIGURED`.

Tạo tài khoản nền tảng (chưa có UI đăng ký — cố ý):

```bash
pnpm exec tsx -e "import 'dotenv/config';import * as argon2 from 'argon2';import {Client} from 'pg';(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();await c.query(\"INSERT INTO platform_users (email,password_hash,full_name,is_active) VALUES (\$1,\$2,'Platform Admin',true) ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash\",[process.env.PA_EMAIL,await argon2.hash(process.env.PA_PASS,{type:argon2.argon2id})]);await c.end();})()"
```

Truyền `PA_EMAIL` / `PA_PASS` qua biến môi trường, đừng nhúng mật khẩu vào lệnh.

## Phiên đăng nhập

Access token nền tảng sống 1 giờ và BE **không có** endpoint refresh cho nó. Token
chỉ giữ trong bộ nhớ, không ghi `localStorage`/`sessionStorage` — hệ quả là **F5 hay
mở tab mới là phải đăng nhập lại**. Đây là đánh đổi có chủ ý: console này sửa được
hạn mức của mọi khách hàng, token của nó không nên sống lâu hơn tab.

## Trang

| Route | Việc |
|---|---|
| `/plans` | Sửa hạn mức + cờ tính năng từng gói. Có hiệu lực ngay (invalidate cache), không cần restart API. |
| `/tenants` | Tìm/lọc tenant. **Không** hiển thị usage — xem mục dưới. |
| `/tenants/[id]` | Gói, trạng thái, usage thật kèm số phòng từng cơ sở; đổi gói / tạm ngưng / kích hoạt. |
| `/payments` | Thanh toán thuê bao; xác nhận tay sau khi đối chiếu sao kê. |

### Vì sao danh sách tenant không có usage

`properties`/`rooms`/`users` đều bật RLS theo `app.current_tenant_id`. Đọc chéo
tenant mà không set GUC thì ra 0 chứ không phải số thật, còn đếm đúng thì phải mở
một transaction `withTenant` cho **từng** tenant — 50 transaction mỗi lần mở trang.
Nên usage nằm ở trang chi tiết, nơi chỉ cần một tenant.

## Ranh giới

Console này **không** phải chỗ đọc dữ liệu nghiệp vụ của khách (booking, khách
lưu trú, doanh thu). Nó chỉ chạm bảng global: `subscription_plans`, `tenants`,
`subscription_payments`. Muốn thêm gì đụng dữ liệu tenant thì cân nhắc lại — RLS
đang chặn có lý do.
