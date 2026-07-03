---
description: "Chạy pipeline nhiều Agent tự động cho 1 Phase roadmap (Planner→Coder→QA→Reviewer→1 PR, KHÔNG merge). Phi-tương-tác, chống treo."
argument-hint: "[scope — vd 'Wave-1' | 'EPIC 9' | '1 task: regenerate openapi.json' | để trống cho Planner tự chọn]"
---

Khởi chạy pipeline roadmap tự động cho **một Phase**. Scope người dùng: `$ARGUMENTS` (rỗng ⇒ Planner tự chọn phase an toàn/giá trị nhất).

## Việc cần làm

1. Gọi Workflow (chạy nền, trả ngay task-id):
   `Workflow({ name: 'roadmap-phase-pipeline', args: { scope: "$ARGUMENTS" } })`
   - KHÔNG chờ đồng bộ; bạn sẽ nhận task-notification khi xong.
   - KHÔNG tự chạy lại các bước của pipeline bằng tay.

2. Khi Workflow trả kết quả:
   - **Có `prUrl`** → báo gọn: phase, số task, danh sách task (id + name), link PR, và `reviewNotes` còn lại (nếu có). Nhắc: PR **CHƯA merge** — chờ bạn/Codex review; bật toggle "Auto-fix CI" nếu CI đỏ. Kết thúc tin nhắn bằng marker ẩn:
     `<!-- CC_NOTIFY_DONE: <phase> xong <N> task | PR #<num> chờ review -->`
   - **Có `escalate`** → báo rõ: đã xong `N/M` task (liệt kê), task nào chặn, `reason`, trạng thái nhánh (committed tới đâu, CHƯA có PR). Gợi ý: sửa tay rồi resume (`Workflow` với `resumeFromRunId`), hoặc để Planner chọn lại. Kết thúc bằng:
     `<!-- CC_NOTIFY_ESCALATE: pipeline chặn ở <task> — <lý do ngắn> -->`

## Ràng buộc
- **KHÔNG tự merge** PR (dừng ở PR cho Codex review).
- **KHÔNG hỏi lại người dùng giữa chừng** — Planner đã được uỷ quyền quyết thay. Chỉ hỏi nếu chính Workflow trả về yêu cầu cần người (hiếm; mặc định không).
- Chỉ báo người dùng **khi Workflow kết thúc** (xong Phase hoặc escalate) — không báo tiến độ từng bước.
