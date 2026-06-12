/* store.js — 데이터 저장 (로컬 우선, localStorage 기반) */
const Store = (() => {
  const KEY = 'modu-todo-v1';

  const defaults = () => ({
    tasks: [],          // {id,title,notes,date,time,priority,repeat,project,tags,done,subtasks,createdAt,completedAt,gcalId}
    projects: [],       // {id,name,color}
    settings: {
      theme: 'light',
      gClientId: '',
      gApiKey: '',
      gConnected: false,
      lastSync: null,
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
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---- 할 일 ---- */
  function addTask(t) {
    const task = Object.assign({
      id: uid(), title: '', notes: '', date: '', time: '',
      priority: 0, repeat: '', project: '', tags: [],
      done: false, subtasks: [], createdAt: new Date().toISOString(),
      completedAt: null, gcalId: null,
    }, t);
    data.tasks.push(task);
    save();
    return task;
  }

  function updateTask(id, patch) {
    const t = data.tasks.find(x => x.id === id);
    if (!t) return null;
    Object.assign(t, patch);
    save();
    return t;
  }

  function deleteTask(id) {
    const idx = data.tasks.findIndex(x => x.id === id);
    if (idx >= 0) {
      const [removed] = data.tasks.splice(idx, 1);
      save();
      return removed;
    }
    return null;
  }

  function restoreTask(task) {
    data.tasks.push(task);
    save();
  }

  /* 완료 토글 — 반복 일정이면 다음 회차를 자동 생성 */
  function toggleDone(id) {
    const t = data.tasks.find(x => x.id === id);
    if (!t) return;
    t.done = !t.done;
    t.completedAt = t.done ? new Date().toISOString() : null;
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
    const p = { id: uid(), name, color: PALETTE[data.projects.length % PALETTE.length] };
    data.projects.push(p);
    save();
    return p;
  }
  function deleteProject(id) {
    data.projects = data.projects.filter(p => p.id !== id);
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

  return {
    load, save, get data() { return data; },
    addTask, updateTask, deleteTask, restoreTask, toggleDone,
    addProject, deleteProject,
    fmtDate, todayStr, allTags, uid,
    exportJSON, importJSON, wipe,
  };
})();
