/* sync.js — 여러 기기 자동 동기화 (GitHub 비공개 Gist 사용)
   사용자의 GitHub 토큰(gist 권한만)으로 본인 계정의 비공개 Gist에 데이터를 저장.
   병합 규칙: 항목별 최신 수정(updatedAt) 우선 + 삭제 기록(tombstone) 전파. */
const Sync = (() => {
  const API = 'https://api.github.com';
  const FILE = 'modu-todo-data.json';
  let timer = null;
  let syncing = false;
  let applying = false;       // applySync로 인한 save가 다시 동기화를 예약하지 않도록
  let lastPushed = '';        // 마지막으로 올린 내용 (불필요한 PATCH 방지)
  let onStatus = null;        // 상태 변경 콜백 (UI 갱신용)

  const isApplying = () => applying;
  const isConnected = () => !!(Store.data.settings.ghToken && Store.data.settings.gistId);

  async function gh(path, options = {}) {
    const resp = await fetch(API + path, Object.assign({}, options, {
      headers: Object.assign({
        'Authorization': 'Bearer ' + Store.data.settings.ghToken,
        'Accept': 'application/vnd.github+json',
      }, options.headers || {}),
    }));
    if (!resp.ok) {
      const msg = resp.status === 401 ? '토큰이 유효하지 않습니다'
        : resp.status === 404 ? '대상을 찾을 수 없습니다 (토큰에 gist 권한이 있는지 확인)'
        : `GitHub API 오류 (HTTP ${resp.status})`;
      throw new Error(msg);
    }
    return resp.status === 204 ? null : resp.json();
  }

  function payload() {
    return JSON.stringify({
      version: 1,
      syncedAt: new Date().toISOString(),
      tasks: Store.data.tasks,
      projects: Store.data.projects,
      deleted: Store.data.deleted,
    });
  }

  /* ---- 병합 (충돌 해결: 항목별 최신 수정 우선) ---- */
  function stamp(item) { return item.updatedAt || item.createdAt || '1970-01-01'; }

  function mergeList(localList, remoteList, deleted) {
    const byId = new Map();
    for (const item of localList) byId.set(item.id, item);
    for (const item of remoteList || []) {
      const mine = byId.get(item.id);
      if (!mine || stamp(item) > stamp(mine)) byId.set(item.id, item);
    }
    // 삭제 기록이 항목의 마지막 수정보다 나중이면 삭제 확정
    return [...byId.values()].filter(item => {
      const delAt = deleted[item.id];
      return !delAt || delAt < stamp(item);
    });
  }

  function merge(remote) {
    const deleted = Object.assign({}, remote.deleted || {});
    for (const [id, at] of Object.entries(Store.data.deleted)) {
      if (!deleted[id] || deleted[id] < at) deleted[id] = at;
    }
    const tasks = mergeList(Store.data.tasks, remote.tasks, deleted);
    const projects = mergeList(Store.data.projects, remote.projects, deleted);
    // 살아남은 항목의 tombstone은 정리
    const alive = new Set([...tasks, ...projects].map(x => x.id));
    for (const id of Object.keys(deleted)) if (alive.has(id)) delete deleted[id];
    return { tasks, projects, deleted };
  }

  /* ---- 연결 ---- */
  async function connect(token) {
    Store.data.settings.ghToken = token.trim();
    const user = await gh('/user');
    // 기존 동기화 Gist 찾기 (다른 기기에서 이미 만든 경우)
    const gists = await gh('/gists?per_page=100');
    const found = gists.find(g => g.files && g.files[FILE]);
    if (found) {
      Store.data.settings.gistId = found.id;
    } else {
      const created = await gh('/gists', {
        method: 'POST',
        body: JSON.stringify({
          description: '모두의 할 일 — 자동 동기화 데이터 (삭제하지 마세요)',
          public: false,
          files: { [FILE]: { content: payload() } },
        }),
      });
      Store.data.settings.gistId = created.id;
      lastPushed = payload();
    }
    Store.save();
    await sync();
    return user.login;
  }

  function disconnect() {
    Store.data.settings.ghToken = '';
    Store.data.settings.gistId = '';
    Store.data.settings.lastGistSync = null;
    lastPushed = '';
    clearTimeout(timer);
    Store.save();
  }

  /* ---- 동기화 본체 ---- */
  async function sync() {
    if (!isConnected() || syncing) return false;
    syncing = true;
    if (onStatus) onStatus('syncing');
    try {
      const gist = await gh('/gists/' + Store.data.settings.gistId);
      const file = gist.files && gist.files[FILE];
      let remote = { tasks: [], projects: [], deleted: {} };
      if (file) {
        // 큰 파일은 내용이 잘려서 오므로 raw_url에서 다시 받음
        const content = file.truncated
          ? await fetch(file.raw_url).then(r => r.text())
          : file.content;
        try { remote = JSON.parse(content); } catch (e) { /* 손상 시 로컬 기준으로 덮어씀 */ }
      }

      const merged = merge(remote);
      applying = true;
      try { Store.applySync(merged); } finally { applying = false; }

      const body = payload();
      // 원격과 동일하면 PATCH 생략
      const remoteSame = file && !file.truncated &&
        JSON.stringify(JSON.parse(file.content).tasks) === JSON.stringify(merged.tasks) &&
        JSON.stringify(JSON.parse(file.content).projects) === JSON.stringify(merged.projects);
      if (!remoteSame || body !== lastPushed) {
        await gh('/gists/' + Store.data.settings.gistId, {
          method: 'PATCH',
          body: JSON.stringify({ files: { [FILE]: { content: body } } }),
        });
        lastPushed = body;
      }

      applying = true;
      try {
        Store.data.settings.lastGistSync = new Date().toISOString();
        Store.save();
      } finally { applying = false; }
      if (onStatus) onStatus('ok');
      return true;
    } catch (e) {
      console.error('동기화 실패:', e);
      if (onStatus) onStatus('error', e.message);
      throw e;
    } finally {
      syncing = false;
    }
  }

  /* 변경 후 4초 뒤 자동 동기화 (연타 묶음 처리) */
  function schedule() {
    if (!isConnected()) return;
    clearTimeout(timer);
    timer = setTimeout(() => sync().catch(() => {}), 4000);
  }

  function setStatusListener(fn) { onStatus = fn; }

  return { connect, disconnect, sync, schedule, isApplying, isConnected, setStatusListener, _merge: merge };
})();
