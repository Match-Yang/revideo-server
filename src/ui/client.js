const platforms = ["bilibili", "douyin", "youtube", "tiktok", "xiaohongshu"];

const state = {
  page: localStorage.getItem("uiPage") || "overview",
  jobs: [],
  queue: { active: null, queued: [], scheduled: [], recent: [] },
  browser: null,
  translate: null,
  settings: null,
  selectedJobId: localStorage.getItem("selectedJobId") || "",
  overviewBreakdown: "running",
  rendered: {},
  creatingJob: false,
};

const el = {
  updatedAt: document.getElementById("updatedAt"),
  navItems: [...document.querySelectorAll(".nav-item")],
  pages: [...document.querySelectorAll(".page")],
  overviewCards: document.getElementById("overviewCards"),
  overviewBreakdown: document.getElementById("overviewBreakdown"),
  recentFailures: document.getElementById("recentFailures"),
  queueSummary: document.getElementById("queueSummary"),
  createJobForm: document.getElementById("createJobForm"),
  sourceUrlInput: document.getElementById("sourceUrlInput"),
  repeatTimesInput: document.getElementById("repeatTimesInput"),
  targetDropdownLabel: document.getElementById("targetDropdownLabel"),
  targetPlatformChoices: document.getElementById("targetPlatformChoices"),
  createHint: document.getElementById("createHint"),
  jobSearch: document.getElementById("jobSearch"),
  jobStatusFilter: document.getElementById("jobStatusFilter"),
  refreshJobsBtn: document.getElementById("refreshJobsBtn"),
  pauseAllBtn: document.getElementById("pauseAllBtn"),
  resumeAllBtn: document.getElementById("resumeAllBtn"),
  jobsTable: document.getElementById("jobsTable"),
  jobDetail: document.getElementById("jobDetail"),
  settingsForm: document.getElementById("settingsForm"),
  defaultPlatformSettings: document.getElementById("defaultPlatformSettings"),
  browserPanel: document.getElementById("browserPanel"),
  startBrowserBtn: document.getElementById("startBrowserBtn"),
  toast: document.getElementById("toast"),
};

const stepLabels = {
  created: "已创建",
  "probing-source": "探测",
  "downloading-source": "下载",
  "normalizing-assets": "标准化",
  "translating-assets": "翻译审核",
  "moderating-assets": "审核",
  "rendering-video": "渲染",
  "generating-cover-image": "封面",
  "generating-platform-drafts": "草稿",
  "preflighting-targets": "发布预检",
  "publishing-targets": "发布",
  completed: "完成",
  failed: "异常",
  cancelled: "已取消",
};

const workflowOrder = [
  "probing-source",
  "downloading-source",
  "normalizing-assets",
  "translating-assets",
  "generating-cover-image",
  "rendering-video",
  "generating-platform-drafts",
  "preflighting-targets",
  "publishing-targets",
];

const statusFilters = [
  ["", "全部状态"],
  ["created", "已创建"],
  ["paused", "待继续"],
  ["running", "进行中"],
  ["publishing", "发布中"],
  ["completed", "已完成"],
  ["failed", "异常"],
  ["cancelled", "已取消"],
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split(".");
  let cursor = obj;
  for (const key of keys.slice(0, -1)) {
    cursor[key] ||= {};
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
}

function toast(message) {
  el.toast.querySelector("span").textContent = message;
  el.toast.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.toast.classList.add("hidden"), 2400);
}

function badge(text, kind = "default") {
  const classes = {
    completed: "badge-success",
    running: "badge-info",
    failed: "badge-error",
    warn: "badge-warning",
    default: "badge-ghost",
  };
  return `<span class="badge ${classes[kind] || classes.default} whitespace-nowrap">${escapeHtml(text)}</span>`;
}

function actionButton(label, attrs = "", tone = "default") {
  const cls = tone === "primary" ? "btn-primary" : tone === "danger" ? "btn-error" : "btn-outline";
  return `<button ${attrs} class="btn btn-sm ${cls}">${escapeHtml(label)}</button>`;
}

function currentStep(job) {
  return job.workflow?.currentStep || "created";
}

function currentStepStatus(job) {
  const step = currentStep(job);
  return job.workflow?.steps?.[step]?.status || (step === "completed" ? "completed" : "pending");
}

function queueStatusForJob(jobId) {
  if (state.queue?.active?.jobId === jobId) return state.queue.active.status || "running";
  if ((state.queue?.queued || []).some((run) => run.jobId === jobId)) return "queued";
  if ((state.queue?.scheduled || []).some((run) => run.jobId === jobId)) return "scheduled";
  return "";
}

function effectiveWorkflowCursor(job) {
  const runningIndex = workflowOrder.findIndex((step) => job.workflow?.steps?.[step]?.status === "running");
  if (runningIndex >= 0) return { step: workflowOrder[runningIndex], index: runningIndex, status: "running" };

  const failedIndex = workflowOrder.findIndex((step) => job.workflow?.steps?.[step]?.status === "failed");
  if (failedIndex >= 0) return { step: workflowOrder[failedIndex], index: failedIndex, status: "failed" };

  if (currentStep(job) === "completed") {
    return { step: "completed", index: workflowOrder.length, status: "completed" };
  }

  const index = workflowOrder.indexOf(currentStep(job));
  return {
    step: currentStep(job),
    index: index >= 0 ? index : -1,
    status: currentStepStatus(job),
  };
}

function displayStepStatus(job, step) {
  const cursor = effectiveWorkflowCursor(job);
  const stepIndex = workflowOrder.indexOf(step);
  if (cursor.index >= 0 && stepIndex > cursor.index && cursor.status !== "completed") return "pending";
  return job.workflow?.steps?.[step]?.status || "pending";
}

function derivedStatus(job) {
  const queueStatus = queueStatusForJob(job.id);
  if (queueStatus === "running" || queueStatus === "queued") {
    return job.targets?.some((target) => target.status === "publishing") ? "publishing" : "running";
  }
  if (queueStatus === "scheduled") return "paused";
  if (currentStep(job) === "completed") return "completed";
  if (currentStep(job) === "cancelled") return "cancelled";
  const cursor = effectiveWorkflowCursor(job);
  if (cursor.status === "failed" || currentStep(job) === "failed" || job.targets?.some((target) => target.status === "failed")) return "failed";
  if (cursor.step === "publishing-targets" || job.targets?.some((target) => target.status === "publishing")) return "publishing";
  if (cursor.status === "running") return "running";
  if (["created", "probing-source"].includes(currentStep(job))) return "created";
  if (
    (currentStep(job) === "preflighting-targets" || currentStep(job) === "publishing-targets") &&
    currentStepStatus(job) === "completed"
  ) {
    return "completed";
  }
  if (cursor.status === "completed" || cursor.status === "skipped" || cursor.status === "paused") return "paused";
  return currentStep(job) === "created" ? "created" : "paused";
}

function statusLabel(status) {
  return statusFilters.find(([key]) => key === status)?.[1] || status;
}

function statusKind(status) {
  if (status === "completed") return "completed";
  if (status === "failed" || status === "cancelled") return "failed";
  if (status === "running" || status === "publishing") return "running";
  return "warn";
}

function formatTime(ts) {
  return ts ? new Date(ts).toLocaleString() : "-";
}

function stableStringify(value) {
  return JSON.stringify(value);
}

function jobsSignature() {
  return stableStringify(
    state.jobs.map((job) => ({
      id: job.id,
      queueStatus: queueStatusForJob(job.id),
      updatedAt: job.updatedAt,
      currentStep: job.workflow?.currentStep,
      steps: job.workflow?.steps,
      targets: job.targets,
      outputVideo: job.artifacts?.outputVideo,
      title: job.source?.metadata?.title,
      repeatTimes: job.options?.repeatTimes,
      targetCommentCount: job.options?.targetCommentCount,
    }))
  );
}

function selectedJobSignature() {
  const job = state.jobs.find((item) => item.id === state.selectedJobId);
  if (!job) return "";
  return stableStringify({
    id: job.id,
    queueStatus: queueStatusForJob(job.id),
    updatedAt: job.updatedAt,
    workflow: job.workflow,
    targets: job.targets,
    artifacts: job.artifacts,
    options: job.options,
    title: job.source?.metadata?.title,
  });
}

function queueSignature() {
  return stableStringify(state.queue);
}

function browserSignature() {
  return stableStringify(state.browser);
}

async function jsonFetch(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || text || res.statusText);
  return data;
}

function switchPage(page) {
  state.page = page;
  localStorage.setItem("uiPage", page);
  el.navItems.forEach((item) => item.classList.toggle("active", item.dataset.page === page));
  el.pages.forEach((view) => view.classList.toggle("hidden", view.dataset.view !== page));
}

function reconcileSelectedJob() {
  if (state.selectedJobId && state.jobs.some((job) => job.id === state.selectedJobId)) return;
  state.selectedJobId = state.jobs[0]?.id || "";
  if (state.selectedJobId) localStorage.setItem("selectedJobId", state.selectedJobId);
  else localStorage.removeItem("selectedJobId");
}

async function refreshAll(options = {}) {
  const full = options.full !== false;
  const [browser, translate, jobs, queue, settings] = await Promise.all([
    jsonFetch("/api/browser/status"),
    jsonFetch("/api/translate/providers"),
    jsonFetch("/api/jobs"),
    jsonFetch("/api/jobs/queue"),
    jsonFetch("/api/settings"),
  ]);
  state.browser = browser;
  state.translate = translate;
  state.jobs = jobs.jobs || [];
  state.queue = queue;
  state.settings = settings.settings;
  reconcileSelectedJob();
  if (full) renderAll();
  else renderChanged();
  el.updatedAt.textContent = `刷新 ${new Date().toLocaleTimeString()}`;
}

function renderAll() {
  switchPage(state.page);
  renderOverview();
  renderTaskStats();
  renderCreateTask();
  renderJobFilters();
  renderJobs();
  renderJobDetail();
  renderSettings();
  renderBrowser();


  state.rendered.jobs = jobsSignature();
  state.rendered.detail = selectedJobSignature();
  state.rendered.queue = queueSignature();
  state.rendered.browser = browserSignature();
}

function renderChanged() {
  const nextQueue = queueSignature();
  const queueChanged = nextQueue !== state.rendered.queue;
  if (state.page === "overview" && (nextQueue !== state.rendered.queue || jobsSignature() !== state.rendered.jobs)) {
    renderOverview();
  }

  const nextJobs = jobsSignature();
  if (nextJobs !== state.rendered.jobs || (state.page === "tasks" && queueChanged)) {
    renderTaskStats();
    if (state.page === "tasks") {
      renderJobs();
    }
    state.rendered.jobs = nextJobs;
  }
  // Always update bulk action buttons when on tasks page
  if (state.page === "tasks") {
    const hasRunning = state.jobs.some((j) => ["running", "publishing"].includes(derivedStatus(j)));
    const hasPaused = state.jobs.some((j) => ["created", "paused", "failed"].includes(derivedStatus(j)));
    el.pauseAllBtn.style.display = hasRunning ? "" : "none";
    el.resumeAllBtn.style.display = !hasRunning && hasPaused ? "" : "none";
  } else {
    el.pauseAllBtn.style.display = "none";
    el.resumeAllBtn.style.display = "none";
  }

  const nextDetail = selectedJobSignature();
  if (state.page === "tasks" && nextDetail !== state.rendered.detail) {
    void renderJobDetail();
    state.rendered.detail = nextDetail;
  }
  state.rendered.queue = nextQueue;

  const nextBrowser = browserSignature();
  if (state.page === "settings" && nextBrowser !== state.rendered.browser) {
    renderBrowser();
    state.rendered.browser = nextBrowser;
  }
}

function renderTaskStats() {
  const total = document.getElementById("taskTotalStat");
  const running = document.getElementById("taskRunningStat");
  if (!total || !running) return;
  total.textContent = String(state.jobs.length);
  running.textContent = String(state.jobs.filter((job) => ["running", "publishing"].includes(derivedStatus(job))).length);
}

function groupCount(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item) || "-";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function renderOverview() {
  const total = state.jobs.length;
  const running = state.jobs.filter((job) => ["running", "publishing"].includes(derivedStatus(job))).length;
  const completed = state.jobs.filter((job) => derivedStatus(job) === "completed").length;
  const failed = state.jobs.filter((job) => derivedStatus(job) === "failed").length;
  const cards = [
    ["total", "总任务数", total, "来源/目标平台分布"],
    ["running", "进行中", running, "当前步骤分布"],
    ["completed", "已完成", completed, "来源/目标平台分布"],
    ["failed", "异常", failed, "失败步骤分布"],
  ];
  el.overviewCards.innerHTML = cards.map(([key, label, value, hint], index) => `
    <article class="card overview-card ${index === 1 ? "active" : ""}">
      <div class="card-body">
        <div class="metric-label">${label}</div>
        <div class="metric-value">${value}</div>
        <div class="metric-hint">${hint}</div>
        <div class="card-actions mt-2">
          <button data-breakdown="${key}" class="btn btn-sm ${index === 1 ? "btn-primary" : "btn-outline"}">查看分布</button>
        </div>
      </div>
    </article>
  `).join("");
  renderOverviewBreakdown();

  const failures = state.jobs.filter((job) => derivedStatus(job) === "failed").slice(0, 5);
  el.recentFailures.innerHTML = failures.length ? failures.map((job) => `
    <div class="soft-row">
      <div class="min-w-0">
        <div class="truncate" style="font-weight:700;">${escapeHtml(job.source?.metadata?.title || job.id)}</div>
        <div class="text-small" style="margin-top:4px;">${escapeHtml(stepLabels[currentStep(job)] || currentStep(job))} / ${formatTime(job.updatedAt)}</div>
      </div>
      ${actionButton("打开任务", `data-open-job="${escapeHtml(job.id)}"`)}
    </div>
  `).join("") : `<div class="empty-state">暂无异常任务</div>`;

  el.queueSummary.innerHTML = `
    <div class="queue-grid">
      <div class="stat"><div class="stat-value">${state.queue.active ? 1 : 0}</div><div class="stat-title">运行中</div></div>
      <div class="stat"><div class="stat-value">${state.queue.queued?.length || 0}</div><div class="stat-title">等待中</div></div>
    </div>
    <div class="empty-state">完整执行日志在任务详情的流程项中查看。</div>
  `;
}

function renderOverviewBreakdown() {
  const key = state.overviewBreakdown;
  let title = "进行中步骤分布";
  let rows = [];
  if (key === "running") {
    rows = Object.entries(groupCount(state.jobs.filter((job) => ["running", "publishing"].includes(derivedStatus(job))), (job) => stepLabels[currentStep(job)] || currentStep(job)));
  } else if (key === "failed") {
    title = "异常步骤分布";
    rows = Object.entries(groupCount(state.jobs.filter((job) => derivedStatus(job) === "failed"), (job) => stepLabels[currentStep(job)] || currentStep(job)));
  } else {
    title = key === "completed" ? "已完成来源和目标分布" : "总任务来源和目标分布";
    const base = key === "completed" ? state.jobs.filter((job) => derivedStatus(job) === "completed") : state.jobs;
    rows = [
      ...Object.entries(groupCount(base, (job) => `来源: ${job.source?.platform || "-"}`)),
      ...Object.entries(groupCount(base.flatMap((job) => job.targets || []), (target) => `目标: ${target.platform}`)),
    ];
  }
  el.overviewBreakdown.innerHTML = `
    <div class="card-body">
      <h3 class="card-title">${title}</h3>
      <p class="section-copy">只展示聚合结果，不把调试日志放到纵览页。</p>
      <div class="breakdown-grid">
        ${rows.length ? rows.map(([label, count]) => `
          <div class="stat">
            <div class="stat-title">${escapeHtml(label)}</div>
            <div class="stat-value">${count}</div>
          </div>
        `).join("") : `<div class="empty-state">暂无数据</div>`}
      </div>
    </div>
  `;
}

function selectedTargetPlatforms() {
  return [...el.targetPlatformChoices.querySelectorAll("input:checked")].map((input) => input.value);
}

function updateTargetDropdownLabel() {
  const selected = selectedTargetPlatforms();
  el.targetDropdownLabel.textContent = selected.length ? `目标平台: ${selected.join(", ")}` : "选择目标平台";
}

function renderCreateTask() {
  const defaults = state.settings?.publishing?.defaultPlatforms || ["bilibili"];
  el.targetPlatformChoices.innerHTML = platforms.map((platform) => `
    <label class="choice">
      <input type="checkbox" name="targetPlatform" value="${platform}" ${defaults.includes(platform) ? "checked" : ""}>
      <span>${platform}</span>
    </label>
  `).join("");
  updateTargetDropdownLabel();
  const seconds = Number(state.settings?.download?.commentSeconds || 2);
  const maxComments = Number(state.settings?.download?.maxComments || 800);
  el.createHint.textContent = `评论数会按 视频时长 * 重复次数 / ${seconds}s 计算，最多 ${maxComments} 条。`;
}

function renderJobFilters() {
  const current = el.jobStatusFilter.value;
  el.jobStatusFilter.innerHTML = statusFilters.map(([key, label]) => `<option value="${key}">${label}</option>`).join("");
  el.jobStatusFilter.value = statusFilters.some(([key]) => key === current) ? current : "";
}

function progressSegments(job) {
  const cursor = effectiveWorkflowCursor(job);
  return workflowOrder.map((step, index) => {
    const status = displayStepStatus(job, step);
    const isDone = status === "completed" || status === "skipped" || currentStep(job) === "completed";
    const isFailed = status === "failed";
    const cls = isFailed ? "seg-error" : isDone ? "seg-done" : index === cursor.index ? "seg-current" : "";
    return `<span class="progress-segment ${cls}" title="${escapeHtml(stepLabels[step])}"></span>`;
  }).join("");
}

function filteredJobs() {
  const q = el.jobSearch.value.trim().toLowerCase();
  const status = el.jobStatusFilter.value;
  return state.jobs
    .filter((job) => {
      const haystack = `${job.id} ${job.source?.url || ""} ${job.source?.metadata?.title || ""}`.toLowerCase();
      return (!q || haystack.includes(q)) && (!status || derivedStatus(job) === status);
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}


function renderJobs() {
  const jobs = filteredJobs();
  if (!jobs.length) {
    el.jobsTable.innerHTML = `<tr><td colspan="4" style="height:96px;text-align:center;color:var(--muted);">没有匹配的任务</td></tr>`;
    return;
  }
  el.jobsTable.innerHTML = jobs.map((job, index) => {
    return `
    <tr data-job-id="${escapeHtml(job.id)}" class="${job.id === state.selectedJobId ? "selected" : ""}">
      <td>${index + 1}</td>
      <td>${badge(statusLabel(derivedStatus(job)), statusKind(derivedStatus(job)))}</td>
      <td><div class="progress-bar">${progressSegments(job)}<span class="repeat-badge">×${job.options?.repeatTimes || 1}</span></div></td>
      <td>
        <div class="truncate" style="font-weight:700;">${escapeHtml(job.source?.metadata?.title || job.id)}</div>
        <div class="truncate text-small" style="margin-top:2px;">${escapeHtml(job.source?.url || "-")}</div>
      </td>
    </tr>`;
  }).join("");
}

function stepDetail(job, events, step) {
  const metadata = job.source?.metadata || {};
  const translation = metadata.translation || {};
  const comments = translation.comments || {};
  const subtitles = translation.subtitles || {};
  const stepEvents = events.filter((event) => event.step === step).slice(-4).reverse();
  const commonEvents = stepEvents.length ? stepEvents.map((event) => `<li>${formatTime(event.ts)} ${escapeHtml(event.message)}</li>`).join("") : "<li>暂无事件</li>";
  if (step === "probing-source") {
    return `<dl class="detail-dl"><dt>原始链接</dt><dd class="break-all">${escapeHtml(job.source?.url || "-")}</dd><dt>标题</dt><dd>${escapeHtml(metadata.title || "-")}</dd><dt>作者</dt><dd>${escapeHtml(job.source?.author || "-")}</dd><dt>时长</dt><dd>${metadata.durationSec || "-"} 秒</dd><dt>建议格式</dt><dd class="break-all">${escapeHtml(JSON.stringify(metadata.recommended || "-"))}</dd></dl>`;
  }
  if (step === "downloading-source") {
    return `<dl class="detail-dl"><dt>素材目录</dt><dd class="break-all">${escapeHtml(job.artifacts?.sourceDir || "-")}</dd><dt>下载质量</dt><dd>${escapeHtml(job.options?.downloadQuality || "auto")}</dd><dt>目标评论</dt><dd>${job.options?.targetCommentCount ?? "-"}</dd></dl>`;
  }
  if (step === "translating-assets" || step === "moderating-assets") {
    const subtitleReportId = `subtitle-report-${job.id}`;
    const subtitleReportHtml = (subtitles.failedCount > 0) ? `<dt>字幕报告</dt><dd><a href="#" id="${subtitleReportId}" class="break-all">${escapeHtml(subtitles.reportPath || "-")}</a></dd>` : "";
    return `<dl class="detail-dl"><dt>字幕翻译</dt><dd>输入 ${subtitles.inputCount ?? 0} 条 / 成功 ${subtitles.translatedCount ?? subtitles.inputCount - (subtitles.droppedCount ?? 0)} 条 / 失败 ${subtitles.failedCount ?? subtitles.droppedCount ?? 0} 条</dd>${subtitleReportHtml}<dt>评论翻译</dt><dd>输入 ${comments.inputCount ?? 0} / 拦截 ${comments.droppedCount ?? 0}</dd><dt>评论报告</dt><dd class="break-all">${escapeHtml(comments.reportPath || "-")}</dd></dl>`;
  }
  if (step === "rendering-video") {
    return `<dl class="detail-dl"><dt>重复次数</dt><dd>${job.options?.repeatTimes || 1}</dd><dt>使用素材</dt><dd class="break-all">${escapeHtml(job.artifacts?.sourceDir || "-")}</dd><dt>输出文件</dt><dd class="break-all">${escapeHtml(job.artifacts?.outputVideo || "-")}</dd></dl>`;
  }
  if (step === "generating-platform-drafts") {
    return `<div class="detail-stack">${(job.targets || []).map((target) => `<div class="info-tile">${badge(target.platform)} <span class="break-all info-value">${escapeHtml(JSON.stringify(target.draft || {}))}</span></div>`).join("") || "<div class=\"empty-state\">暂无草稿</div>"}</div>`;
  }
  if (step === "preflighting-targets" || step === "publishing-targets") {
    return `<div class="detail-stack">${(job.targets || []).map((target) => `<div class="info-tile">${badge(target.platform)} ${badge(target.status, target.status === "failed" ? "failed" : "default")} <span class="break-all info-value">${escapeHtml(target.error || target.result?.url || "")}</span></div>`).join("") || "<div class=\"empty-state\">暂无发布目标</div>"}</div>`;
  }
  return `<ul style="margin:0;padding-left:18px;color:var(--muted);font-size:13px;">${commonEvents}</ul>`;
}

async function renderJobDetail() {
  if (state.creatingJob) {
    el.jobDetail.innerHTML = `<div class="empty-state">正在创建任务，完成后会自动选中新任务。</div>`;
    return;
  }
  if (!state.selectedJobId) {
    el.jobDetail.innerHTML = `<div class="empty-state">尚未选择任务</div>`;
    return;
  }
  const job = state.jobs.find((item) => item.id === state.selectedJobId);
  if (!job) {
    el.jobDetail.innerHTML = `<div class="empty-state">任务不存在</div>`;
    return;
  }
  let events = [];
  try {
    events = (await jsonFetch(`/api/jobs/${encodeURIComponent(job.id)}/events`)).events || [];
  } catch {}
  const jobStatus = derivedStatus(job);
  const hasFailedStep = Object.values(job.workflow?.steps || {}).some((step) => step.status === "failed");
  const actionHtml = [
    ["running", "publishing"].includes(jobStatus)
      ? actionButton("暂停", `data-job-action="pause" data-job-id="${escapeHtml(job.id)}"`, "primary")
      : "",
    ["created", "paused", "failed", "cancelled"].includes(jobStatus)
      ? actionButton("恢复", `data-job-action="resume" data-job-id="${escapeHtml(job.id)}"`, "primary")
      : "",
    hasFailedStep ? actionButton("重试失败步骤", `data-job-action="retry" data-job-id="${escapeHtml(job.id)}"`) : "",
    actionButton("删除", `data-job-action="delete" data-job-id="${escapeHtml(job.id)}"`, "danger"),
  ].join("");
  el.jobDetail.innerHTML = `
    <div class="detail-summary">
      <div class="detail-id">${escapeHtml(job.id)}</div>
      <h4 class="detail-title">${escapeHtml(job.source?.metadata?.title || job.id)}</h4>
      <div class="detail-subtitle">${escapeHtml(job.source?.platform || "-")}</div>
      <div class="detail-actions">${actionHtml}</div>
    </div>
    <div class="detail-metrics">
      <div class="info-tile"><div class="info-label">当前状态</div><div class="info-value">${badge(statusLabel(derivedStatus(job)), statusKind(derivedStatus(job)))}</div></div>
      <div class="info-tile"><div class="info-label">目标平台</div><div class="info-value flex flex-wrap gap-2">${(job.targets || []).map((target) => badge(target.platform)).join("") || "-"}</div></div>
      <div class="info-tile"><div class="info-label">重复/评论</div><div class="info-value">重复 ${job.options?.repeatTimes || 1} 次，目标评论 ${job.options?.targetCommentCount ?? "-"}</div></div>
      <div class="info-tile"><div class="info-label">输出视频</div><div class="info-value break-all">${escapeHtml(job.artifacts?.outputVideo || "-")}</div></div>
    </div>
    <div class="flow-list">
      ${workflowOrder.map((step) => {
        const status = displayStepStatus(job, step);
        return `
          <details class="flow-item">
            <summary class="flow-summary">
              <span>${escapeHtml(stepLabels[step])}</span>
              ${badge(status, status === "completed" ? "completed" : status === "failed" ? "failed" : status === "running" ? "running" : "default")}
            </summary>
            <div class="flow-content">${stepDetail(job, events, step)}</div>
          </details>
        `;
      }).join("")}
    </div>
  `;

  const subtitleReportLink = document.getElementById(`subtitle-report-${job.id}`);
  if (subtitleReportLink) {
    subtitleReportLink.addEventListener("click", async (e) => {
      e.preventDefault();
      const reportPath = job.source?.metadata?.translation?.subtitles?.reportPath;
      if (!reportPath) return;
      try {
        const report = await jsonFetch(`/api/jobs/${encodeURIComponent(job.id)}/artifact?path=${encodeURIComponent(reportPath)}`);
        const items = report.items || [];
        const detail = items.map((item) =>
          `${item.id}  ${item.timestampRange}\n原文: ${item.originalText}\n原因: ${item.reason} - ${item.detail}`
        ).join("\n\n");
        alert(`字幕翻译失败报告 (${report.failedCount}/${report.inputCount})\n\n${detail}`);
      } catch {}
    });
  }
}

function renderSettings() {
  if (!state.settings) return;
  [...el.settingsForm.elements].forEach((control) => {
    if (!control.name || control.type === "checkbox" || control.name.startsWith("translation.")) return;
    const value = getPath(state.settings, control.name);
    if (value !== undefined) control.value = String(value);
  });
  el.settingsForm.elements["translation.targetLanguage"].value =
    state.settings.production?.subtitleTargetLanguage || state.settings.production?.commentTargetLanguage || "zh-CN";
  el.settingsForm.elements["translation.retranslateTargetLanguage"].value =
    String(Boolean(state.settings.production?.subtitleRetranslateTargetLanguage || state.settings.production?.commentRetranslateTargetLanguage));
  el.settingsForm.elements["translation.bilingualSubtitles"].value =
    String(Boolean(state.settings.production?.bilingualSubtitles));
  el.settingsForm.elements["translation.subtitlePrompt"].value =
    state.settings.production?.subtitlePrompt || "";
  el.settingsForm.elements["translation.commentPrompt"].value =
    state.settings.production?.commentPrompt || "";

  const defaults = state.settings.publishing?.defaultPlatforms || [];
  el.defaultPlatformSettings.innerHTML = platforms.map((platform) => `
    <label class="choice" style="border:1px solid var(--border);">
      <input type="checkbox" name="publishing.defaultPlatforms" value="${platform}" ${defaults.includes(platform) ? "checked" : ""}>
      <span>${platform}</span>
    </label>
  `).join("");
}

function renderBrowser() {
  if (!state.browser) return;
  el.browserPanel.innerHTML = `
    <div class="browser-grid">
      <div class="info-tile">
        <div class="flex flex-wrap gap-2">
          ${badge(`浏览器 ${state.browser.running ? "运行中" : state.browser.installed ? "可用" : "未发现"}`, state.browser.running ? "completed" : "warn")}
          ${badge(state.browser.cdpUrl || state.browser.executablePath || "-")}
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        ${actionButton("重启浏览器", `data-browser-action="restart"`)}
        ${actionButton("打开 B站登录", `data-browser-login="bilibili"`)}
        ${actionButton("打开抖音登录", `data-browser-login="douyin"`)}
      </div>
    </div>
  `;
}

function collectSettings() {
  const next = {};
  [...el.settingsForm.elements].forEach((control) => {
    if (!control.name || control.name === "publishing.defaultPlatforms" || control.name.startsWith("translation.")) return;
    const raw = control.value;
    const value = control.type === "number" ? Number(raw) : raw === "true" ? true : raw === "false" ? false : raw;
    setPath(next, control.name, value);
  });
  next.publishing ||= {};
  next.publishing.defaultPlatforms = [...el.settingsForm.querySelectorAll('input[name="publishing.defaultPlatforms"]:checked')].map((item) => item.value);

  const targetLanguage = el.settingsForm.elements["translation.targetLanguage"].value || "zh-CN";
  const retranslate = el.settingsForm.elements["translation.retranslateTargetLanguage"].value === "true";
  const bilingual = el.settingsForm.elements["translation.bilingualSubtitles"].value === "true";
  const subtitlePrompt = el.settingsForm.elements["translation.subtitlePrompt"].value || "";
  const commentPrompt = el.settingsForm.elements["translation.commentPrompt"].value || "";
  next.production ||= {};
  next.production.subtitleTargetLanguage = targetLanguage;
  next.production.commentTargetLanguage = targetLanguage;
  next.production.subtitleRetranslateTargetLanguage = retranslate;
  next.production.commentRetranslateTargetLanguage = retranslate;
  next.production.bilingualSubtitles = bilingual;
  next.production.subtitlePrompt = subtitlePrompt;
  next.production.commentPrompt = commentPrompt;
  return next;
}

async function runJobAction(jobId, action) {

  if (action === "retry") return jsonFetch(`/api/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST" });
  if (action === "pause") return jsonFetch(`/api/jobs/${encodeURIComponent(jobId)}/pause`, { method: "POST" });
  if (action === "resume") return jsonFetch(`/api/jobs/${encodeURIComponent(jobId)}/resume`, { method: "POST" });
  if (action === "delete") return jsonFetch(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
  return jsonFetch(`/api/jobs/${encodeURIComponent(jobId)}/${action}`, { method: "POST" });
}

el.navItems.forEach((item) => item.addEventListener("click", () => {
  switchPage(item.dataset.page);
  renderChanged();
}));


el.refreshJobsBtn.addEventListener("click", () => refreshAll({ full: false }).catch((err) => toast(err.message)));
el.pauseAllBtn.addEventListener("click", async () => {
  el.pauseAllBtn.disabled = true;
  const running = state.jobs.filter((j) => ["running", "publishing"].includes(derivedStatus(j)));
  await Promise.allSettled(running.map((j) => runJobAction(j.id, "pause")));
  toast(`已暂停 ${running.length} 个任务`);
  await refreshAll({ full: false });
});
el.resumeAllBtn.addEventListener("click", async () => {
  el.resumeAllBtn.disabled = true;
  const paused = state.jobs.filter((j) => ["created", "paused", "failed"].includes(derivedStatus(j)));
  await Promise.allSettled(paused.map((j) => runJobAction(j.id, "resume")));
  toast(`已恢复 ${paused.length} 个任务`);
  await refreshAll({ full: false });
});
el.jobSearch.addEventListener("input", renderJobs);
el.jobStatusFilter.addEventListener("change", renderJobs);
el.targetPlatformChoices.addEventListener("change", updateTargetDropdownLabel);

el.overviewCards.addEventListener("click", (event) => {
  const buttonEl = event.target.closest("[data-breakdown]");
  if (!buttonEl) return;
  state.overviewBreakdown = buttonEl.dataset.breakdown;
  renderOverviewBreakdown();
});

el.recentFailures.addEventListener("click", async (event) => {
  const buttonEl = event.target.closest("[data-open-job]");
  if (!buttonEl) return;
  state.selectedJobId = buttonEl.dataset.openJob;
  localStorage.setItem("selectedJobId", state.selectedJobId);
  switchPage("tasks");
  renderJobs();
  await renderJobDetail();
});

el.jobsTable.addEventListener("click", async (event) => {
  const row = event.target.closest("tr[data-job-id]");
  if (!row) return;
  state.selectedJobId = row.dataset.jobId;
  localStorage.setItem("selectedJobId", state.selectedJobId);
  renderJobs();
  await renderJobDetail();
});

el.jobDetail.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-job-action]");
  if (!action) return;
  action.disabled = true;
  try {
    await runJobAction(action.dataset.jobId, action.dataset.jobAction);
    toast("已提交");
    await refreshAll({ full: false });
  } catch (err) {
    toast(err.message);
  } finally {
    action.disabled = false;
  }
});

function extractYoutubeId(url) {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([^&?\s/]+)/);
  return m ? m[1] : null;
}

function findExistingJobByUrl(url) {
  const ytId = extractYoutubeId(url);
  if (!ytId) return null;
  const jobId = "youtube_" + ytId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
  return state.jobs.find((job) => job.id === jobId) || null;
}

el.createJobForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = el.sourceUrlInput.value.trim();
  if (!url) return;
  const targets = selectedTargetPlatforms().map((platform) => ({ platform }));
  const repeatTimes = Math.min(10, Math.max(1, Number(el.repeatTimesInput.value || 1)));
  const existing = findExistingJobByUrl(url);
  const force = !!existing;
  if (existing) {
    const title = existing.source?.metadata?.title || existing.id;
    if (!confirm(`该链接已有任务"${title}"，是否覆盖重新创建？`)) {
      toast("已取消");
      return;
    }
  }
  const submitButton = el.createJobForm.querySelector('button[type="submit"]');
  state.creatingJob = true;
  submitButton.disabled = true;
  await renderJobDetail();
  try {
    const result = await jsonFetch("/api/jobs" + (force ? "?force=true" : ""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: { url, platform: "auto" },
        targets,
        options: {
          repeatTimes,
          targetLanguage: state.settings?.production?.subtitleTargetLanguage || "zh-CN",
        },
      }),
    });
    state.selectedJobId = result.job.id;
    localStorage.setItem("selectedJobId", state.selectedJobId);
    el.sourceUrlInput.value = "";
    toast(force ? "任务已覆盖并加入队列" : "任务已创建并加入队列");
    await refreshAll({ full: true });
  } catch (err) {
    toast(err.message);
  }
  finally {
    state.creatingJob = false;
    submitButton.disabled = false;
    await renderJobDetail();
  }
});

el.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await jsonFetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectSettings()),
    });
    state.settings = result.settings;
    toast("设置已保存");
    renderAll();
  } catch (err) {
    toast(err.message);
  }
});

el.settingsForm.addEventListener("click", async (event) => {
  const browserButton = event.target.closest("[data-browser-action]");
  const loginButton = event.target.closest("[data-browser-login]");
  if (!browserButton && !loginButton) return;
  event.preventDefault();
  const target = browserButton || loginButton;
  target.disabled = true;
  try {
    if (browserButton) {
    await jsonFetch(`/api/browser/${browserButton.dataset.browserAction}`, { method: "POST" });
    } else {
      await jsonFetch(`/api/browser/open-login/${loginButton.dataset.browserLogin}`, { method: "POST" });
    }
    await refreshAll({ full: false });
  } catch (err) {
    toast(err.message);
  } finally {
    target.disabled = false;
  }
});

el.startBrowserBtn.addEventListener("click", async () => {
  el.startBrowserBtn.disabled = true;
  try {
    await jsonFetch("/api/browser/start", { method: "POST" });
    await refreshAll({ full: false });
  } catch (err) {
    toast(err.message);
  } finally {
    el.startBrowserBtn.disabled = false;
  }
});

refreshAll({ full: true }).catch((err) => toast(err.message));
setInterval(() => refreshAll({ full: false }).catch(() => {}), 6000);
