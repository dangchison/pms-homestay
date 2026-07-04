export const meta = {
  name: 'roadmap-phase-pipeline',
  description: 'Tự động hoá 1 Phase roadmap PMS-homestay: Planner→Coder→QA(≤3)→Reviewer(≤3)→commit dồn→1 PR (KHÔNG merge). Phi-tương-tác, Planner quyết thay user, chống treo (timeout+fail-fast+resumable).',
  phases: [
    { title: 'Setup', detail: 'preflight DB + chốt phạm vi Phase + tạo nhánh' },
    { title: 'Plan', detail: 'spec từng task (Planner session/max)' },
    { title: 'Implement', detail: 'code theo cadence repo (Coder session/max)' },
    { title: 'QA', detail: 'typecheck+lint+e2e+build (QA session/max), retry ≤3' },
    { title: 'Review', detail: 'chất lượng DRY/design (Reviewer session/max), retry ≤3' },
    { title: 'Ship', detail: 'commit dồn → 1 PR (không merge)' },
  ],
}

// ─────────────────────────── Schemas (structured output) ───────────────────────────
const S_PREFLIGHT = {
  type: 'object', additionalProperties: false, required: ['ok', 'detail'],
  properties: { ok: { type: 'boolean' }, detail: { type: 'string' } },
}
const S_BRANCH = {
  type: 'object', additionalProperties: false, required: ['ok', 'detail'],
  properties: { ok: { type: 'boolean' }, detail: { type: 'string' }, branch: { type: 'string' } },
}
const S_SCOPE = {
  type: 'object', additionalProperties: false, required: ['phase', 'branch', 'rationale', 'tasks', 'blocked'],
  properties: {
    phase: { type: 'string' }, branch: { type: 'string' }, rationale: { type: 'string' },
    blocked: { type: 'boolean' }, blockedReason: { type: 'string' },
    tasks: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['id', 'name', 'summary'],
        properties: { id: { type: 'string' }, name: { type: 'string' }, summary: { type: 'string' } },
      },
    },
  },
}
const S_SPEC = {
  type: 'object', additionalProperties: false, required: ['taskId', 'name', 'acceptance', 'files', 'risks', 'e2eScope'],
  properties: {
    taskId: { type: 'string' }, name: { type: 'string' }, e2eScope: { type: 'string' },
    acceptance: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
}
const S_IMPL = {
  type: 'object', additionalProperties: false, required: ['summary', 'changedFiles', 'migrationAdded', 'e2eSpec'],
  properties: {
    summary: { type: 'string' }, e2eSpec: { type: 'string' }, migrationAdded: { type: 'boolean' },
    changedFiles: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' },
  },
}
const S_QA = {
  type: 'object', additionalProperties: false, required: ['pass', 'ran', 'failures', 'coverageGaps'],
  properties: {
    pass: { type: 'boolean' },
    ran: { type: 'array', items: { type: 'string' } },
    failures: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'detail'], properties: { kind: { type: 'string' }, detail: { type: 'string' } } } },
    coverageGaps: { type: 'array', items: { type: 'string' } },
  },
}
const S_REVIEW = {
  type: 'object', additionalProperties: false, required: ['mustFix', 'niceToHave'],
  properties: {
    mustFix: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['file', 'issue', 'suggestion'], properties: { file: { type: 'string' }, line: { type: 'number' }, issue: { type: 'string' }, suggestion: { type: 'string' } } } },
    niceToHave: { type: 'array', items: { type: 'string' } },
  },
}
const S_SHIP = {
  type: 'object', additionalProperties: false, required: ['committed', 'sha'],
  properties: { committed: { type: 'boolean' }, sha: { type: 'string' }, notes: { type: 'string' } },
}
const S_PR = {
  type: 'object', additionalProperties: false, required: ['prUrl'],
  properties: { prUrl: { type: 'string' }, prNumber: { type: 'number' } },
}

// ─────────────────────────── Prompt builders ───────────────────────────
// Workflow tự-chứa: KHÔNG dùng agentType (custom agent chỉ nạp sau reload). Mỗi agent
// nhập vai bằng cách ĐỌC file role .claude/agents/*.md + skill nó tham chiếu.
const MEM = '~/.claude/projects/-Users-sondc-Desktop-PMS-homestay/memory'

function roleIntro(roleFile) {
  return [
    `Bạn là Agent trong pipeline roadmap PMS-homestay. TRƯỚC TIÊN đọc \`.claude/agents/${roleFile}.md\` và MỌI skill nó tham chiếu trong \`.claude/skills/\`, rồi TUÂN THEO ĐẦY ĐỦ vai trò + kỷ luật đó.`,
    'Sau đó thực hiện DUY NHẤT việc dưới đây và trả đúng JSON schema được yêu cầu:',
    '',
  ].join('\n')
}

function preflightPrompt() {
  return [
    'Preflight môi trường (mechanical — CHỈ đảm bảo container, TUYỆT ĐỐI KHÔNG chạm schema DB để không làm bẩn schema.prisma; setup-branch sẽ db:reset). Mỗi lệnh có timeout, non-interactive.',
    '1. Đảm bảo Docker/OrbStack chạy: `orbctl start` (bỏ qua lỗi nếu đã chạy).',
    '2. Đảm bảo container DB lên: `nc -z localhost 5432` — nếu chưa → `pnpm db:up` (timeout 180s) rồi lặp `nc` tối đa ~30s.',
    'KHÔNG chạy db:migrate / prisma pull ở đây. Sau 1 lần thử DB vẫn không lên → ok:false (không chờ vô hạn). Trả {ok, detail}.',
  ].join('\n')
}

function branchPrompt(scope) {
  return [
    'Chuẩn bị nhánh + DB SẠCH cho Phase (mechanical + safety). Mỗi lệnh có timeout, non-interactive.',
    '1. Kiểm thay đổi TRACKED: `git status --porcelain --untracked-files=no`. Nếu CÓ thay đổi tracked chưa commit → ok:false (KHÔNG stash/ép). File UNTRACKED (`.claude/`, `.codegraph/`, `.rooignore`, ảnh) KHÔNG tính là bẩn.',
    '2. Về main: nếu `git rev-parse --abbrev-ref HEAD` KHÁC "main" (tree tracked sạch) → `git switch main` (commit nhánh cũ đã an toàn, không mất). Rồi `git pull --ff-only` (timeout 60s; bỏ qua nếu offline/không remote).',
    `3. Tạo nhánh mới off main: \`git switch -c ${scope.branch}\` (đã tồn tại → \`git switch ${scope.branch}\`).`,
    '4. DB HYGIENE (tránh nhiễm schema từ nhánh trước CHƯA merge): `pnpm db:reset` (timeout 300s: down -v → up → migrate → seed) → DB khớp ĐÚNG migration của nhánh này (= main). Lỗi reset → ok:false.',
    'Trả {ok, detail, branch}.',
  ].join('\n')
}

function scopePrompt(userScope) {
  return roleIntro('roadmap-planner') + [
    'CHẾ ĐỘ: CHỐT PHẠM VI PHASE (bạn là Planner — quyết thay chủ dự án, KHÔNG hỏi người).',
    `Scope người dùng truyền vào: ${userScope ? '"' + userScope + '"' : '(TRỐNG — bạn TỰ chọn phase giá trị & an toàn nhất)'}.`,
    `Đọc: docs/14-roadmap-tasks.md (EPIC 9 + Checklist PR), docs/16-product-roadmap.md, PROGRESS.md, \`git log --oneline -15\`, ${MEM}/MEMORY.md + pms-homestay-status.md.`,
    'Chọn 2–6 task LIÊN QUAN (hoặc đúng số task người dùng yêu cầu), codeable KHÔNG cần creds ngoài, migration backward-compatible, không tạo lỗ hổng bảo mật/RLS/PII.',
    'Trả {phase, branch (feat/<kebab-slug>), rationale, blocked, tasks[]{id,name,summary}}. Không có task an toàn → blocked:true + blockedReason.',
  ].join('\n')
}

function specPrompt(scope, t) {
  return roleIntro('roadmap-planner') + [
    `CHẾ ĐỘ: VIẾT SPEC 1 TASK (skill writing-plans). Phase "${scope.phase}".`,
    `Task: id=${t.id} · name=${t.name} · summary=${t.summary}.`,
    'Xem repo hiện tại: `git log --oneline main..HEAD` (task trước trong phase đã commit) + mục task tương ứng trong docs/14 nếu có.',
    'Tự quyết mọi lựa chọn thiết kế (proxy CEO). Trả {taskId, name, acceptance[] (test được), files[], risks[], e2eScope}.',
  ].join('\n')
}

function implPrompt(scope, spec) {
  return roleIntro('roadmap-coder') + [
    `CHẾ ĐỘ: IMPLEMENT (skill executing-plans + cadence repo). Phase "${scope.phase}".`,
    'SPEC:', JSON.stringify(spec),
    'Theo cadence: migration→shared-types(+build)→module(RBAC authorizeOnProperty)→`pnpm --filter @pms/api db:migrate`→e2e. Tuân Checklist PR (docs/14) + gotchas (typecheck cuối; $executeRaw cho void; field PII mới→redact audit.redact+pino; money BigInt+roundVnd; e2e cleanup FK order).',
    'KHÔNG commit ở bước này. KHÔNG lệnh tương tác. Trả {summary, changedFiles[], migrationAdded, e2eSpec (đường dẫn file spec), notes}.',
  ].join('\n')
}

function qaPrompt(spec, impl) {
  return roleIntro('roadmap-qa') + [
    'CHẾ ĐỘ: QA (skill verification-before-completion). Verify task WORKS — KHÔNG sửa code.',
    `e2e spec cần chạy: ${impl && impl.e2eSpec ? impl.e2eSpec : '(tự tìm spec mới trong apps/api/test/e2e; nếu task không có e2e — vd doc-only — ghi rõ và bỏ qua bước e2e)'}.`,
    'Chạy (timeout mỗi lệnh): preflight `nc -z localhost 5432` → (nếu shared-types đổi) build shared-types → `pnpm --filter @pms/api typecheck` → `pnpm --filter @pms/api lint` → e2e spec (`cd apps/api && ENABLE_SCHEDULERS=false LOG_LEVEL=fatal pnpm exec vitest run <spec> --no-file-parallelism`) → `pnpm --filter @pms/api build`.',
    'Đối chiếu acceptance với coverage:', JSON.stringify(spec.acceptance),
    'pass=true CHỈ khi mọi lệnh (áp dụng được) xanh. Trả {pass, ran[], failures[]{kind,detail}, coverageGaps[]}.',
  ].join('\n')
}

function fixPrompt(kind, spec, report) {
  return roleIntro('roadmap-coder') + [
    `CHẾ ĐỘ: FIX theo phản hồi ${kind} (skill systematic-debugging + receiving-code-review). Tìm root-cause TRƯỚC khi sửa; kiểm chứng phản hồi, không sửa hình thức.`,
    `Phản hồi ${kind}:`, JSON.stringify(report),
    'SPEC gốc:', JSON.stringify(spec),
    'Sửa ĐÚNG điểm, giữ cadence + conventions, KHÔNG mở rộng phạm vi, KHÔNG commit. Mô tả ngắn đã sửa gì.',
  ].join('\n')
}

function reviewPrompt(spec) {
  return roleIntro('roadmap-reviewer') + [
    'CHẾ ĐỘ: REVIEW CHẤT LƯỢNG (skill requesting-code-review) — KHÔNG săn bug chức năng (QA lo), KHÔNG sửa.',
    'Soi thay đổi CHƯA commit của task: `git --no-pager diff` + file untracked mới (`git status --porcelain`, Read các file trong danh sách files bên dưới).',
    'Files task:', JSON.stringify(spec.files),
    'Tiêu chí: DRY/tái-dùng-util, naming, design-pattern/altitude, đơn-giản-hoá, hiệu-năng (N+1), dead-code/import-thừa. Trả {mustFix[]{file,line,issue,suggestion}, niceToHave[]}.',
  ].join('\n')
}

function commitPrompt(scope, spec, reviewNotes) {
  const notes = reviewNotes && reviewNotes.length
    ? `Còn ${reviewNotes.length} mục chất lượng chưa xử lý — GHI vào commit body để reviewer người biết.`
    : ''
  return roleIntro('roadmap-coder') + [
    `CHẾ ĐỘ: COMMIT TASK trên nhánh ${scope.branch} (KHÔNG push, KHÔNG PR).`,
    `Task: ${spec.taskId} — ${spec.name}.`,
    'Stage ĐÚNG file của task (gồm apps/api/prisma/schema.prisma nếu migration đổi — CI gate cần) bằng `git add <path cụ thể>`. TUYỆT ĐỐI KHÔNG `git add -A/.`; KHÔNG stage rác/không-thuộc-task (`.claude/`, `.codegraph/`, `.rooignore`, ảnh *.png).',
    'Commit message vi conventional-commit + trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.',
    notes,
    'Trả {committed, sha, notes}.',
  ].join('\n')
}

function prPrompt(scope, tasksDone) {
  const list = tasksDone.map((t) => `${t.id} ${t.name}`).join('; ')
  return roleIntro('roadmap-coder') + [
    'CHẾ ĐỘ: SHIP (skill finishing-a-development-branch, ÉP "push + 1 PR, KHÔNG merge").',
    `Phase "${scope.phase}" xong ${tasksDone.length} task: ${list}.`,
    `Push nhánh: \`git push -u origin ${scope.branch}\` (timeout 60s). Mở 1 PR: \`gh pr create --base main --head ${scope.branch}\` (timeout 60s).`,
    'Title = tóm tắt phase. Body: liệt kê từng task + phần kiểm thử + review-notes còn lại (nếu có); kết thúc bằng "🤖 Generated with [Claude Code](https://claude.com/claude-code)".',
    'TUYỆT ĐỐI KHÔNG `gh pr merge`. Trả {prUrl, prNumber}.',
  ].join('\n')
}

// ─────────────────────────── Orchestration ───────────────────────────
const userScope = (args && args.scope && String(args.scope).trim()) ? String(args.scope).trim() : null

function escalate(scope, tasksDone, stage, failedTask, reason, details) {
  return {
    escalate: true, stage,
    phase: scope ? scope.phase : null, branch: scope ? scope.branch : null,
    tasksDone, failedTask: failedTask || null, reason, details: details || null,
  }
}

phase('Setup')
const pre = await agent(preflightPrompt(), { label: 'preflight-db', phase: 'Setup', effort: 'low', schema: S_PREFLIGHT })
if (!pre || !pre.ok) return escalate(null, [], 'preflight', null, pre ? pre.detail : 'preflight agent chết')

const scope = await agent(scopePrompt(userScope), { label: 'phase-scope', phase: 'Setup', effort: 'max', schema: S_SCOPE })
if (!scope) return escalate(null, [], 'scope', null, 'planner (scope) chết')
if (scope.blocked || !scope.tasks || scope.tasks.length === 0) return escalate(scope, [], 'scope', null, scope.blockedReason || 'không có task an toàn để làm')
log(`Phase "${scope.phase}" — ${scope.tasks.length} task trên nhánh ${scope.branch}`)

const br = await agent(branchPrompt(scope), { label: 'setup-branch', phase: 'Setup', effort: 'low', schema: S_BRANCH })
if (!br || !br.ok) return escalate(scope, [], 'branch', null, br ? br.detail : 'setup-branch chết')

const tasksDone = []

for (let i = 0; i < scope.tasks.length; i++) {
  const t = scope.tasks[i]
  const tag = t.id

  phase('Plan')
  const spec = await agent(specPrompt(scope, t), { label: `spec:${tag}`, phase: 'Plan', effort: 'max', schema: S_SPEC })
  if (!spec) return escalate(scope, tasksDone, 'spec', tag, 'planner (spec) chết')

  phase('Implement')
  const impl = await agent(implPrompt(scope, spec), { label: `impl:${tag}`, phase: 'Implement', effort: 'max', schema: S_IMPL })
  if (!impl) return escalate(scope, tasksDone, 'implement', tag, 'coder (implement) chết')

  // QA loop ≤3 — fail sau 3 vòng → escalate (không ship code hỏng)
  phase('QA')
  let qaOk = false
  let lastQa = null
  for (let r = 1; r <= 3; r++) {
    lastQa = await agent(qaPrompt(spec, impl), { label: `qa:${tag}#${r}`, phase: 'QA', effort: 'max', schema: S_QA })
    if (lastQa && lastQa.pass) { qaOk = true; break }
    if (r === 3) break
    await agent(fixPrompt('QA', spec, lastQa), { label: `fix-qa:${tag}#${r}`, phase: 'QA', effort: 'max' })
  }
  if (!qaOk) return escalate(scope, tasksDone, 'qa', tag, 'QA fail sau 3 vòng', lastQa)

  // Review loop ≤3 — còn issue sau 3 vòng → ship kèm notes (chất lượng không chặn)
  phase('Review')
  let reviewNotes = []
  for (let r = 1; r <= 3; r++) {
    const rev = await agent(reviewPrompt(spec), { label: `review:${tag}#${r}`, phase: 'Review', effort: 'max', schema: S_REVIEW })
    if (!rev || !rev.mustFix || rev.mustFix.length === 0) break
    if (r === 3) { reviewNotes = rev.mustFix; log(`Task ${tag}: còn ${rev.mustFix.length} mục chất lượng sau 3 vòng — ship kèm notes`); break }
    await agent(fixPrompt('Review', spec, rev), { label: `fix-rev:${tag}#${r}`, phase: 'Review', effort: 'max' })
    const recheck = await agent(qaPrompt(spec, impl), { label: `reqa:${tag}#${r}`, phase: 'Review', effort: 'max', schema: S_QA })
    if (!recheck || !recheck.pass) return escalate(scope, tasksDone, 'review-reqa', tag, 'fix review làm vỡ QA', recheck)
  }

  // Commit task (KHÔNG push)
  phase('Ship')
  const ship = await agent(commitPrompt(scope, spec, reviewNotes), { label: `commit:${tag}`, phase: 'Ship', effort: 'max', schema: S_SHIP })
  if (!ship || !ship.committed) return escalate(scope, tasksDone, 'commit', tag, 'commit thất bại', ship)
  tasksDone.push({ id: t.id, name: t.name, sha: ship.sha, reviewNotes })
  log(`✔ Task ${tag} committed (${ship.sha || '?'}) — ${tasksDone.length}/${scope.tasks.length}`)
}

// Phase xong → mở ĐÚNG 1 PR (KHÔNG merge)
phase('Ship')
const pr = await agent(prPrompt(scope, tasksDone), { label: 'open-pr', phase: 'Ship', effort: 'max', schema: S_PR })
if (!pr || !pr.prUrl) return escalate(scope, tasksDone, 'pr', null, 'mở PR thất bại (đã commit đủ task, cần push/PR tay)')

return { ok: true, phase: scope.phase, branch: scope.branch, tasksDone, prUrl: pr.prUrl, prNumber: pr.prNumber || null }
