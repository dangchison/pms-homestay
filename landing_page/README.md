# Tracking page — deploy Vercel + HTTP Basic Auth

Trang tĩnh nội bộ, một file duy nhất (`index.html`), không dùng framework.
Toàn site chặn bằng HTTP Basic Auth qua Vercel Routing Middleware, và gắn
`X-Robots-Tag: noindex, nofollow` để search engine không index.

| File | Vai trò |
|---|---|
| `index.html` | Nội dung trang (tự chứa, không asset ngoài) |
| `middleware.ts` | Basic Auth — chạy trước mọi request, Edge runtime |
| `vercel.json` | Header `X-Robots-Tag`; rewrite `/` → `/index.html` (đã thừa, xem ghi chú cuối file) |
| `package.json` | Tối thiểu, không dependency; `"type": "module"` để Vercel nhận diện middleware ở dự án không framework |
| `.env.example` | Mẫu biến môi trường |

## Chạy local

```bash
cd landing_page
cp .env.example .env.local     # rồi sửa giá trị thật; .env.local đã bị gitignore
npx vercel dev
```

Mở http://localhost:3000 — trình duyệt sẽ hỏi user/mật khẩu.

Muốn kiểm nhanh riêng phần xác thực mà **không cần Vercel**, gọi thẳng middleware
bằng Node (Node 22.6+ tự đọc được `.ts`):

```bash
node --input-type=module -e "
import mw from './middleware.ts';
process.env.AUTH_USER='u'; process.env.AUTH_PASS='p';
const b64 = s => Buffer.from(s).toString('base64');
const call = h => mw(new Request('https://x/', { headers: h }));
console.log('không credential:', call({})?.status);              // 401
console.log('sai mật khẩu   :', call({ authorization:'Basic '+b64('u:sai') })?.status); // 401
console.log('đúng           :', call({ authorization:'Basic '+b64('u:p') }));           // undefined
"
```

`undefined` nghĩa là cho request đi tiếp — đúng như mong đợi.

## Biến môi trường

| Tên | Mô tả |
|---|---|
| `AUTH_USER` | Tên đăng nhập Basic Auth |
| `AUTH_PASS` | Mật khẩu Basic Auth |

Đặt trên Vercel: **Project → Settings → Environment Variables**, hoặc bằng CLI
(xem phần Deploy). Phải đặt cho **cả Production lẫn Preview** — môi trường nào
thiếu biến thì môi trường đó trả 401 với mọi credential.

> Middleware cố ý **khoá khi thiếu biến** thay vì cho qua: quên set env một lần
> không được phép biến trang nội bộ thành công khai.

## Deploy

```bash
npm i -g vercel
vercel login
cd landing_page
vercel link
```

Thêm biến môi trường (CLI sẽ hỏi giá trị, nhập trực tiếp — không lưu vào repo):

```bash
vercel env add AUTH_USER production
vercel env add AUTH_PASS production
vercel env add AUTH_USER preview
vercel env add AUTH_PASS preview
```

Deploy:

```bash
vercel --prod
```

> `vercel link` chạy **từ trong `landing_page/`** nên thư mục này chính là Root
> Directory của project. Không cần cấu hình gì thêm dù repo là monorepo.

## Test sau khi deploy

Thay `<domain>` bằng domain Vercel trả về.

Không có credential — phải là **401**:

```bash
curl -i https://<domain>/
```

Có credential — phải là **200**:

```bash
curl -i -u 'AUTH_USER_CỦA_BẠN:AUTH_PASS_CỦA_BẠN' https://<domain>/
```

Chỉ xem mã trạng thái:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<domain>/
curl -s -o /dev/null -w "%{http_code}\n" -u 'user:pass' https://<domain>/
```

Kiểm header chống index:

```bash
curl -sI -u 'user:pass' https://<domain>/ | grep -i x-robots-tag
```

## Ghi chú: rewrite `/` trong `vercel.json` đã thừa

Rewrite `/` → `/index.html` có từ lúc file còn tên khác. Nay file đã là `index.html`
nên Vercel tự phục vụ nó ở `/` — dòng rewrite không còn tác dụng gì, giữ lại cũng
vô hại. Xoá được nếu muốn gọn:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "headers": [
    {
      "source": "/(.*)",
      "headers": [{ "key": "X-Robots-Tag", "value": "noindex, nofollow" }]
    }
  ]
}
```

## Nếu request hợp lệ không đi tiếp được

Middleware dùng `return undefined` để cho request đi tiếp — cách này không cần
dependency nào. Nếu Vercel không diễn giải như vậy (trang trắng hoặc phản hồi lạ
dù credential đúng), chuyển sang helper chính thức:

```bash
npm install @vercel/functions
```

```ts
import { next } from '@vercel/functions';
// ...
return next();   // thay cho: return undefined;
```

Lúc đó `package.json` sẽ có dependency và Vercel chạy cài đặt khi build.
