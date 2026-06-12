/* store.js — 데이터 저장 (로컬 우선, localStorage 기반) */
const Store = (() => {
  const KEY = 'modu-todo-v1';

  const defaults = () => ({
    tasks: [],          // {id,title,notes,date,time,priority,repeat,project,tags,done,subtasks,createdAt,updatedAt,completedAt,gcalId}
    projects: [],       // {id,name,color,updatedAt}
    deleted: {},        // 삭제 기록(tombstone) {id: 삭제시각ISO} — 기기 간 동기화 시 삭제 전파용
    settings: {
      theme: 'light',
      gClientId: '',
      gApiKey: '',
      gConnected: false,
      lastSync: null,
      ghToken: '',
      gistId: '',
      lastGistSync: null,
    },
    gcalEvents: [],     // 구글 캘린더에서 가져온 읽기전용 이벤트 캐시 {id,title,date,time,endTime}
  });

  let data = defaults();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) data = Object.assign(defaults(), JSON.parse(raw));
    } catch (e) { console.error('데이터 로드 실패', e); }
    return data;
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(data));
    // 데이터가 바뀌면 자동 동기화 예약 (동기화 적용 중 재귀 방지)
    if (typeof Sync !== 'undefined' && !Sync.isApplying()) Sync.schedule();
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---- 할 일 ---- */
  function addTask(t) {
    const now = new Date().toISOString();
    const task = Object.assign({
      id: uid(), title: '', notes: '', date: '', time: '',
      priority: 0, repeat: '', project: '', tags: [],
      done: false, subtasks: [], createdAt: now, updatedAt: now,
      completedAt: null, gcalId: null,
    }, t);
    data.tasks.push(task);
    save();
    return task;
  }

  function updateTask(id, patch) {
    const t = data.tasks.find(x => x.id === id);
    if (!t) return null;
    Object.assign(t, patch, { updatedAt: new Date().toISOString() });
    save();
    return t;
  }

  function deleteTask(id) {
    const idx = data.tasks.findIndex(x => x.id === id);
    if (idx >= 0) {
      const [removed] = data.tasks.splice(idx, 1);
      data.deleted[id] = new Date().toISOString();
      save();
      return removed;
    }
    return null;
  }

  function restoreTask(task) {
    delete data.deleted[task.id];
    task.updatedAt = new Date().toISOString();
    data.tasks.push(task);
    save();
  }

  /* 완료 토글 — 반복 일정이면 다음 회차를 자동 생성 */
  function toggleDone(id) {
    const t = data.tasks.find(x => x.id === id);
    if (!t) return;
    t.done = !t.done;
    t.updatedAt = new Date().toISOString();
    t.completedAt = t.done ? t.updatedAt : null;
    if (t.done && t.repeat && t.date) {
      const next = nextOccurrence(t.date, t.repeat);
      addTask({
        title: t.title, notes: t.notes, date: next, time: t.time,
        priority: t.priority, repeat: t.repeat, project: t.project,
        tags: [...t.tags],
        subtasks: t.subtasks.map(s => ({ id: uid(), title: s.title, done: false })),
      });
    }
    save();
    return t;
  }

  function nextOccurrence(dateStr, repeat) {
    const d = new Date(dateStr + 'T00:00:00');
    if (repeat === 'daily') d.setDate(d.getDate() + 1);
    else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
    else if (repeat === 'monthly') d.setMonth(d.getMonth() + 1);
    else if (repeat === 'yearly') d.setFullYear(d.getFullYear() + 1);
    return fmtDate(d);
  }

  /* ---- 프로젝트 ---- */
  const PALETTE = ['#4f6ef7', '#e5484d', '#2eb872', '#f0a020', '#9b59d0', '#16a8a8', '#e06aa3'];
  function addProject(name) {
    const p = { id: uid(), name, color: PALETTE[data.projects.length % PALETTE.length], updatedAt: new Date().toISOString() };
    data.projects.push(p);
    save();
    return p;
  }
  function deleteProject(id) {
    data.projects = data.projects.filter(p => p.id !== id);
    data.deleted[id] = new Date().toISOString();
    data.tasks.forEach(t => { if (t.project === id) t.project = ''; });
    save();
  }

  /* ---- 유틸 ---- */
  function fmtDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
  const todayStr = () => fmtDate(new Date());

  function allTags() {
    const set = new Set();
    data.tasks.forEach(t => t.tags.forEach(tag => set.add(tag)));
    return [...set].sort();
  }

  /* ---- 백업 ---- */
  function exportJSON() { return JSON.stringify(data, null, 2); }
  function importJSON(json) {
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.tasks)) throw new Error('형식이 올바르지 않습니다');
    data = Object.assign(defaults(), parsed);
    save();
  }
  function wipe() {
    data = defaults();
    save();
  }

  /* 동기화 결과(병합된 tasks/projects/deleted)를 통째로 적용 */
  function applySync(merged) {
    data.tasks = merged.tasks;
    data.projects = merged.projects;
    data.deleted = merged.deleted;
    save();
  }

  return {
    load, save, get data() { return data; },
    addTask, updateTask, deleteTask, restoreTask, toggleDone,
    addProject, deleteProject,
    fmtDate, todayStr, allTags, uid,
    exportJSON, importJSON, wipe, applySync,
  };
})();
