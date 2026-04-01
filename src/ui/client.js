const dirSelect = document.getElementById("dirSelect");
const dirInfo = document.getElementById("dirInfo");
const renderBtn = document.getElementById("renderBtn");
const status = document.getElementById("status");
const loading = document.getElementById("loading");
const main = document.getElementById("main");
const noDirs = document.getElementById("noDirs");
const previewSection = document.getElementById("previewSection");
const previewPlaceholder = document.getElementById("previewPlaceholder");
const previewVideo = document.getElementById("previewVideo");
const previewIframe = document.getElementById("previewIframe");
const previewEmpty = document.getElementById("previewEmpty");
const tabs = document.querySelectorAll(".preview-tab");

const STUDIO_URL = "http://localhost:3000";

let dirs = [];
let currentTab = "preview";
let currentDirName = "";

function setPreviewSrc(src) {
  previewVideo.style.display = "";
  previewIframe.style.display = "none";
  previewEmpty.style.display = "none";
  previewVideo.src = src;
}

function showStudioPreview() {
  previewIframe.style.display = "";
  previewVideo.style.display = "none";
  previewEmpty.style.display = "none";
  previewIframe.src = STUDIO_URL;
}

function showPreviewEmpty(msg) {
  previewVideo.style.display = "none";
  previewIframe.style.display = "none";
  previewEmpty.style.display = "";
  previewEmpty.textContent = msg;
}

function updatePreview() {
  if (!currentDirName) return;
  if (currentTab === "source") {
    setPreviewSrc(`/api/preview/${encodeURIComponent(currentDirName)}`);
  } else {
    showStudioPreview();
  }
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    currentTab = tab.dataset.tab;
    updatePreview();
  });
});

async function loadDirs() {
  try {
    const res = await fetch("/api/dirs");
    dirs = await res.json();

    if (dirs.length === 0) {
      loading.style.display = "none";
      noDirs.style.display = "block";
      return;
    }

    loading.style.display = "none";
    main.style.display = "block";

    dirs.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d.name;
      opt.textContent = d.name;
      dirSelect.appendChild(opt);
    });

    renderBtn.disabled = false;
    updateInfo();
    onDirChange();
  } catch (err) {
    loading.textContent = "加载失败: " + err.message;
  }
}

function updateInfo() {
  const dir = dirs.find((d) => d.name === dirSelect.value);
  if (!dir) return;
  const tags = [];
  if (dir.hasComments) tags.push("评论");
  if (dir.hasSubtitles) tags.push("字幕");
  dirInfo.textContent = tags.length ? tags.join(" / ") : "无附加数据";
}

async function onDirChange() {
  currentDirName = dirSelect.value;
  currentTab = "preview";
  tabs.forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === "preview");
  });
  if (currentDirName) {
    previewPlaceholder.style.display = "none";
    previewSection.classList.add("visible");
    // Prepare files for Remotion Studio
    try {
      await fetch(`/api/prepare/${encodeURIComponent(currentDirName)}`, {
        method: "POST",
      });
    } catch {}
    updatePreview();
  } else {
    previewPlaceholder.style.display = "";
    previewSection.classList.remove("visible");
  }
}

dirSelect.addEventListener("change", () => {
  updateInfo();
  onDirChange();
});

renderBtn.addEventListener("click", async () => {
  const dirName = dirSelect.value;
  if (!dirName) return;

  renderBtn.disabled = true;
  status.className = "status rendering";
  status.textContent = "渲染中，请稍候...";

  try {
    const res = await fetch(`/api/render/${encodeURIComponent(dirName)}`, {
      method: "POST",
    });
    const data = await res.json();

    if (data.success) {
      status.className = "status success";
      status.textContent = `渲染完成: ${data.output} (${data.durationSec.toFixed(1)}秒)`;
    } else {
      status.className = "status error";
      status.textContent = "渲染失败: " + (data.error || "未知错误");
    }
  } catch (err) {
    status.className = "status error";
    status.textContent = "请求失败: " + err.message;
  }

  renderBtn.disabled = false;
});

loadDirs();
