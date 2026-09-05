---
name: PMS Homestay
description: Hệ quản lý homestay Việt Nam — tinh gọn, đáng tin, hospitality hiện đại
colors:
  teal-lan-bien-som: "oklch(0.58 0.094 184)"
  teal-dam: "oklch(0.495 0.079 184)"
  teal-suong: "oklch(0.972 0.017 184)"
  xam-lanh-am: "oklch(0.985 0.002 95)"
  surface-trang: "oklch(1 0 0)"
  muc-dam: "oklch(0.225 0.004 95)"
  muc-nhat: "oklch(0.585 0.007 95)"
  vien-lanh: "oklch(0.928 0.004 95)"
  thanh-cong: "oklch(0.52 0.12 163)"
  canh-bao: "oklch(0.55 0.12 60)"
  nguy-hiem: "oklch(0.585 0.207 17)"
  thong-tin: "oklch(0.55 0.17 254)"
  booking-hold: "oklch(0.83 0.155 85)"
  booking-pending: "oklch(0.7 0.18 47)"
  booking-confirmed: "oklch(0.58 0.094 184)"
  booking-checkedin: "oklch(0.55 0.17 254)"
  booking-ota: "oklch(0.62 0.18 290)"
  hk-clean: "oklch(0.72 0.19 145)"
  hk-dirty: "oklch(0.64 0.21 25)"
  hk-cleaning: "oklch(0.79 0.15 75)"
  hk-inspection: "oklch(0.7 0.13 230)"
typography:
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.33
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  2xl: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.teal-lan-bien-som}"
    textColor: "{colors.surface-trang}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "8px 16px"
  button-outline:
    backgroundColor: "{colors.xam-lanh-am}"
    textColor: "{colors.muc-dam}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "8px 16px"
  button-ghost:
    textColor: "{colors.muc-dam}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "8px 16px"
  card:
    backgroundColor: "{colors.surface-trang}"
    textColor: "{colors.muc-dam}"
    rounded: "{rounded.xl}"
    padding: "24px"
  input:
    textColor: "{colors.muc-dam}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "4px 12px"
---

# Design System: PMS Homestay

## Overview

**Creative North Star: "The Quiet Concierge"**

Người quản gia thầm lặng: hệ thống nói ít, làm chuẩn, và không bao giờ chen giữa người lễ tân với công việc của họ. Giao diện phẳng và điềm tĩnh khi nghỉ, phản hồi nhẹ khi tương tác; số liệu tài chính và trạng thái phòng luôn là nhân vật chính, còn khung UI lùi lại phía sau. Sự "cao cấp" thể hiện bằng tiết chế — khoảng cách chuẩn, tương phản đủ, màu dùng có mục đích — chứ không bằng trang trí.

Toàn hệ màu chạy trên OKLCH với kiến trúc 2 tầng: primitive (`--p-*`, không component nào gọi trực tiếp) → semantic (`--primary`, `--surface`, `--booking-*`…). Ba theme (light mặc định, dark, warm) chỉ đổi tầng semantic. Nền là neutral ấm (hue 95) chứ không xám lạnh — chất hospitality nằm ở độ ấm kín đáo đó.

**Key Characteristics:**
- Điềm tĩnh, chuẩn xác, phục vụ mà không phô trương
- Nền ấm + accent teal dùng tiết kiệm, có chủ đích
- Trạng thái nghiệp vụ (booking/buồng phòng) là ngôn ngữ màu chung, bất biến theo theme
- Phẳng khi nghỉ, phản hồi nhẹ khi tương tác; motion tôn trọng `prefers-reduced-motion`

## Colors

Bảng màu ấm và trầm: một accent teal duy nhất trên nền linen, cộng một bộ màu trạng thái mang nghĩa nghiệp vụ.

### Primary
- **Teal Lặn Biển Sớm** (`{colors.teal-lan-bien-som}`, ≈ #0d9488): accent duy nhất của hệ thống — nút primary, focus ring, link, trạng thái "Đã xác nhận". Dark theme sáng lên thành teal-400 để giữ tương phản.
- **Teal Đậm** (`{colors.teal-dam}`): hover của primary.
- **Teal Sương** (`{colors.teal-suong}`): nền tint nhẹ cho accent/hover ghost, `primary-muted`.

### Neutral
- **Xám Lanh Ấm** (`{colors.xam-lanh-am}`): nền trang (`--background`). Neutral hue 95, chroma cực thấp — ấm như vải lanh, không xám bệnh viện.
- **Surface Trắng** (`{colors.surface-trang}`): card, popover, bề mặt nổi.
- **Mực Đậm** (`{colors.muc-dam}`): chữ chính (`--foreground`).
- **Mực Nhạt** (`{colors.muc-nhat}`): chữ phụ (`--muted-foreground`).
- **Viền Lạnh** (`{colors.vien-lanh}`): border mặc định; dark theme chuyển thành trắng-alpha 10%.

### Semantic (feedback)
- **Thành công / Cảnh báo / Nguy hiểm / Thông tin**: mỗi màu có bản `-muted` sinh bằng `color-mix(... % , transparent)` làm nền tint — không bao giờ đặt chữ màu lên nền cùng màu đậm.

### Trạng thái nghiệp vụ (theme-invariant)
- **Booking**: hold = hổ phách · pending = cam · confirmed = teal · checked-in = xanh dương · OTA = tím · block = xám.
- **Buồng phòng**: sạch = xanh lá · bẩn = đỏ · đang dọn = hổ phách · chờ kiểm tra = xanh da trời.

### Named Rules
**The Two-Tier Rule.** Component và trang chỉ được nói ngôn ngữ semantic (`bg-primary`, `text-muted-foreground`, `bg-booking-hold`). Màu thô `--p-*` không map vào Tailwind nên gọi không được — đó là tính năng, không phải hạn chế.

**The Status Language Rule.** Màu trạng thái booking/buồng phòng là ngôn ngữ chung mọi màn hình và CỐ Ý bất biến theo theme — màu mang nghĩa. Chữ luôn là foreground neutral; màu trạng thái thể hiện qua chấm + viền + nền tint, không nhuộm chữ.

**The One Accent Rule.** Teal xuất hiện có chủ đích (hành động chính, focus, xác nhận). Màn hình bình thường phần lớn là neutral; teal hiếm nên teal có nghĩa.

## Typography

**Body Font:** Inter (subset latin + vietnamese, fallback ui-sans-serif/system-ui)

**Character:** Một font duy nhất, phân cấp bằng cỡ/độ đậm/màu chứ không bằng đổi font. Trung tính, máy móc vừa đủ để số liệu đáng tin, và render dấu tiếng Việt chuẩn.

### Hierarchy
- **Title** (600, 16px, tracking -0.025em): tiêu đề card, section, dialog.
- **Body** (400, 14px/1.43): cỡ chữ mặc định của toàn app — bảng, form, nội dung.
- **Label** (500, 12px): badge, chip, nhãn phụ, meta text.

### Named Rules
**The One Voice Rule.** Không thêm font thứ hai. Cần nhấn mạnh: tăng weight hoặc đổi màu mực, không đổi font.

## Layout

- Admin desktop-first ≥1280px (responsive xuống 768px); staff PWA mobile-first 360–430px, thao tác 1 tay.
- Mọi page dùng `PageContainer` (grid, gap 24px) + `PageHeader` — không tự chế khung trang.
- Card padding chuẩn 24px (`p-6`); nhịp spacing theo thang Tailwind 4/8/16/24.
- Calendar là màn hình trung tâm của admin; layout dashboard dùng `h-dvh` + vùng cuộn riêng, không cuộn cả body.

## Elevation & Depth

Hệ phẳng-ưu-tiên với bóng làm thì thầm: 3+1 bậc shadow tint neutral ấm, opacity 5–12%, không có bóng "material" đậm. Depth chủ yếu truyền đạt bằng màu bề mặt (background → surface → popover) và viền; bóng chỉ xác nhận thứ đang nổi.

### Shadow Vocabulary
- **elevation-xs** (`0 1px 2px 0 oklch(0.3 0.02 95 / 0.05)`): input, phần tử nhỏ.
- **elevation-sm** (`0 1px 3px … / 0.07, 0 1px 2px … / 0.05`): card mặc định (`elevation="low"`).
- **elevation-md** (`0 4px 10px … / 0.08, 0 2px 6px … / 0.05`): card nổi (`raised`), dropdown.
- **elevation-lg** (`0 12px 24px … / 0.10, 0 6px 12px … / 0.06`): dialog, hover của card interactive.

### Named Rules
**The Quiet Surface Rule.** Bề mặt phẳng khi nghỉ. Bóng lớn chỉ xuất hiện như phản hồi trạng thái (hover nhấc `-translate-y-0.5` + shadow-lg, dialog mở). Không bao giờ dùng shadow-lg cho phần tử tĩnh.

## Shapes

Bo góc mềm, nhất quán, sinh từ một radius gốc 12px: card/dialog 12px (`rounded-xl`), nút/input/badge 8px (`rounded-md`), chip nhỏ 6px. Viền 1px màu `Viền Lạnh` là ranh giới mặc định; không dùng viền đậm hay double-border. Chấm tròn (`rounded-full`) dành riêng cho dot trạng thái.

## Components

### Buttons
- **Shape:** bo mềm (8px), cao 36px (`h-9`), 32px cho `sm`, 40px cho `lg`.
- **Primary:** nền Teal Lặn Biển Sớm, chữ trắng; hover giảm opacity 90%.
- **Hover / Focus:** `transition-colors`; focus = ring 2px teal (`focus-visible:ring-2 ring-ring`), không outline mặc định.
- **Outline / Ghost / Secondary:** outline có viền input + nền background, hover chuyển nền Teal Sương; ghost chỉ hiện nền khi hover; disabled = opacity 50%.

### Cards / Containers
- **Corner Style:** 12px (`rounded-xl`).
- **Background:** Surface Trắng + viền 1px.
- **Shadow Strategy:** mặc định elevation-sm; biến thể `flat`/`raised`; `interactive` thêm hover nhấc nhẹ + shadow-lg.
- **Internal Padding:** 24px, header/content chia bằng `pt-0`.

### Inputs / Fields
- **Style:** cao 36px, viền 1px `--input`, nền trong suốt, bo 8px, shadow-xs.
- **Focus:** ring 2px teal, không đổi viền.
- **Error / Disabled:** disabled = opacity 50% + not-allowed; lỗi dùng `--destructive` cho message.

### Status Badges (signature)
- **BookingStatusBadge:** chấm màu 6px + viền `màu/40` + nền `màu/12`, chữ foreground neutral 12px medium — màu trạng thái không bao giờ nhuộm chữ.
- **HousekeepingDot:** chấm 10px + label muted tùy chọn; dùng trên calendar, room board, list.

### StatCard / Chips
- Icon chip dùng cặp token `--chip-{màu}` (chữ/icon) + `--chip-{màu}-soft` (nền tint mix 13–18%) — 5 màu: brand, blue, violet, amber, emerald.

## Do's and Don'ts

### Do:
- **Do** dùng utility semantic (`bg-surface`, `text-muted-foreground`, `bg-booking-confirmed`) cho mọi màu.
- **Do** giữ chữ trạng thái bằng foreground neutral; thể hiện màu qua dot + viền + tint (The Status Language Rule).
- **Do** touch target ≥44px trên web-staff (nút to, thao tác 1 tay/găng tay).
- **Do** tôn trọng `prefers-reduced-motion` cho mọi animation lặp.
- **Do** format tiền `1.500.000 ₫` (vi-VN), ngày `dd/MM/yyyy`, giờ 24h.

### Don't:
- **Don't** gọi màu thô — không hex/oklch inline trong component, không tự chế bảng màu trạng thái riêng cho màn hình nào.
- **Don't** thêm font thứ hai hay đổi radius gốc cục bộ.
- **Don't** dùng shadow đậm cho phần tử tĩnh, hay gradient trang trí — hệ này phẳng và điềm tĩnh.
- **Don't** để lọt chuỗi tiếng Anh ra UI người dùng (tiếng Việt mặc định).
- **Don't** thiết kế nút "Refresh" làm cơ chế chính — dữ liệu sống qua SSE.
