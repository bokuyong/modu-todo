/* app.js — UI 메인 로직 */
(() => {
  Store.load();

  // ---- 상태 ----
  let view = 'today';            // today | upcoming | all | done | calendar | project:<id> | tag:<name>
  let searchQuery = '';
  let editingSubtasks = [];      // 모달에서 편집 중인 하위 할 일
  let undoTimer = null;
  let lastDeleted = null;

  // ---- 엘리먼트 ----
  const $ = id => document.getElementById(id);
  const listView = $('listView');
  const calendarView = $('calendarView');
  const viewTitle = $('viewTitle');

  const VIEW_TITLES = { today: '오늘', upcoming: '예정', all: '전체', done: '완료됨', calendar: '캘린더' };
  const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- 토스트 ----
  function toast(msg, undoFn) {
    const el = $('toast');
    el.innerHTML = escapeHtml(msg) + (undoFn ? ' <button id="undoBtn">실행 취소</button>' : '');
    el.classList.remove('hidden');
    if (undoFn) $('undoBtn').onclick = () => { undoFn(); el.classList.add('hidden'); };
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => el.classList.add('hidden'), 4500);
  }

  // ---- 날짜 라벨 ----
  function dateLabel(ds) {
    const today = Store.todayStr();
    const d = new Date(ds + 'T00:00:00');
    const t = new Date(today + 'T00:00:00');
    const diff = Math.round((d - t) / 86400000);
    if (diff === 0) return '오늘';
    if (diff === 1) return '내일';
    if (diff === -1) return '어제';
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY_NAMES[d.getDay()]})`;
  }

  // ---- 필터링 ----
  function visibleTasks() {
    const today = Store.todayStr();
    let tasks = Store.data.tasks;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return tasks.filter(t =>
        t.title.toLowerCase().includes(q) ||
        (t.notes || '').toLowerCase().includes(q) ||
        t.tags.some(tag => tag.toLowerCase().includes(q)));
    }

    if (view === 'today') return tasks.filter(t => !t.done && t.date && t.date <= today);
    if (view === 'upcoming') return tasks.filter(t => !t.done && t.date && t.date > today);
    if (view === 'all') return tasks.filter(t => !t.done);
    if (view === 'done') return tasks.filter(t => t.done);
    if (view.startsWith('project:')) {
      const pid = view.slice(8);
      return tasks.filter(t => !t.done && t.project === pid);
    }
    if (view.startsWith('tag:')) {
      const tag = view.slice(4);
      return tasks.filter(t => !t.done && t.tags.includes(tag));
    }
    return [];
  }

  // ---- 정렬 ----
  function sortTasks(tasks) {
    return [...tasks].sort((a, b) => {
      if ((a.date || '9999') !== (b.date || '9999')) return (a.date || '9999') < (b.date || '9999') ? -1 : 1;
      if ((a.time || '99:99') !== (b.time || '99:99')) return (a.time || '99:99') < (b.time || '99:99') ? -1 : 1;
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.createdAt < b.createdAt ? -1 : 1;
    });
  }

  // ---- 리스트 렌더링 ----
  function renderList() {
    const tasks = sortTasks(visibleTasks());
    const today = Store.todayStr();

    if (!tasks.length) {
      const msgs = {
        today: ['🎉', '오늘 할 일을 모두 끝냈어요!'],
        upcoming: ['🗓️', '예정된 할 일이 없습니다'],
        all: ['📝', '위 입력창에 할 일을 추가해 보세요'],
        done: ['💤', '아직 완료한 할 일이 없습니다'],
      };
      const [icon, msg] = msgs[view] || ['📂', '할 일이 없습니다'];
      listView.innerHTML = `<div class="empty-state"><span class="big">${icon}</span>${msg}</div>`;
      return;
    }

    // 그룹: 지연됨 / 날짜별 / 날짜 없음
    const groups = new Map();
    for (const t of tasks) {
      let key, label, cls = '';
      if (view === 'done') { key = 'done'; label = ''; }
      else if (!t.date) { key = 'nodate'; label = '날짜 없음'; }
      else if (t.date < today && !t.done) { key = 'overdue'; label = '⚠️ 지연됨'; cls = 'overdue'; }
      else { key = t.date; label = dateLabel(t.date); }
      if (!groups.has(key)) groups.set(key, { label, cls, items: [] });
      groups.get(key).items.push(t);
    }

    // 지연됨을 맨 앞으로, 날짜 없음을 맨 뒤로
    const ordered = [...groups.entries()].sort((a, b) => {
      const rank = k => k === 'overdue' ? 0 : k === 'nodate' ? 2 : 1;
      if (rank(a[0]) !== rank(b[0])) return rank(a[0]) - rank(b[0]);
      return a[0] < b[0] ? -1 : 1;
    });

    let html = '';
    for (const [, g] of ordered) {
      if (g.label) html += `<div class="group-label ${g.cls}">${g.label}</div>`;
      for (const t of g.items) html += taskHtml(t, today);
    }
    listView.innerHTML = html;

    listView.querySelectorAll('.task').forEach(el => {
      el.addEventListener('click', () => openTaskModal(el.dataset.id));
      el.querySelector('.task-check').addEventListener('click', e => {
        e.stopPropagation();
        Store.toggleDone(el.dataset.id);
        refresh();
      });
    });
  }

  function taskHtml(t, today) {
    const proj = Store.data.projects.find(p => p.id === t.project);
    const meta = [];
    if (t.date) {
      const overdue = t.date < today && !t.done;
      const timeStr = t.time ? ' ' + t.time : '';
      meta.push(`<span class="${overdue ? 'overdue' : ''}">📅 ${dateLabel(t.date)}${timeStr}</span>`);
    }
    if (t.repeat) meta.push('<span>🔁</span>');
    if (proj) meta.push(`<span class="badge proj">${escapeHtml(proj.name)}</span>`);
    t.tags.forEach(tag => meta.push(`<span class="badge">#${escapeHtml(tag)}</span>`));
    if (t.subtasks.length) {
      const done = t.subtasks.filter(s => s.done).length;
      meta.push(`<span class="sub-progress">☑ ${done}/${t.subtasks.length}</span>`);
    }
    if (t.gcalId) meta.push('<span title="구글 캘린더에 동기화됨">🔄</span>');

    return `<div class="task ${t.done ? 'done' : ''}" data-id="${t.id}">
      <button class="task-check p${t.priority}" title="완료"></button>
      <div class="task-body">
        <div class="task-title">${escapeHtml(t.title)}</div>
        ${meta.length ? `<div class="task-meta">${meta.join('')}</div>` : ''}
      </div>
    </div>`;
  }

  // ---- 사이드바 ----
  function renderSidebar() {
    const today = Store.todayStr();
    const tasks = Store.data.tasks;
    $('countToday').textContent = tasks.filter(t => !t.done && t.date && t.date <= today).length || '';
    $('countUpcoming').textContent = tasks.filter(t => !t.done && t.date && t.date > today).length || '';
    $('countAll').textContent = tasks.filter(t => !t.done).length || '';

    // 프로젝트
    const pl = $('projectList');
    pl.innerHTML = Store.data.projects.map(p => {
      const n = tasks.filter(t => !t.done && t.project === p.id).length;
      return `<button class="proj-item ${view === 'project:' + p.id ? 'active' : ''}" data-view="project:${p.id}">
        <span class="proj-dot" style="background:${p.color}"></span>${escapeHtml(p.name)}
        <span class="count" style="margin-left:auto">${n || ''}</span></button>`;
    }).join('');
    pl.querySelectorAll('.proj-item').forEach(el => {
      el.addEventListener('click', () => switchView(el.dataset.view, el.textContent.trim()));
      el.addEventListener('contextmenu', e => {
        e.preventDefault();
        const pid = el.dataset.view.slice(8);
        const p = Store.data.projects.find(x => x.id === pid);
        if (p && confirm(`프로젝트 "${p.name}"를 삭제할까요? (할 일은 유지됩니다)`)) {
          Store.deleteProject(pid);
          if (view === 'project:' + pid) switchView('all');
          refresh();
        }
      });
    });

    // 태그
    const tl = $('tagList');
    tl.innerHTML = Store.allTags().map(tag =>
      `<button class="tag-item ${view === 'tag:' + tag ? 'active' : ''}" data-view="tag:${tag}"># ${escapeHtml(tag)}</button>`
    ).join('') || '<div class="hint" style="padding:0 8px">할 일에 #태그를 붙여보세요</div>';
    tl.querySelectorAll('.tag-item').forEach(el => {
      el.addEventListener('click', () => switchView(el.dataset.view, el.textContent.trim()));
    });

    // 네비 활성화
    document.querySelectorAll('#nav .nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.view === view);
    });

    // 동기화 상태
    const s = Store.data.settings;
    if (Sync.isConnected()) {
      $('syncStatus').textContent = s.lastGistSync
        ? '🔁 ' + new Date(s.lastGistSync).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
        : '🔁 연결됨';
    } else if (s.gConnected) {
      $('syncStatus').textContent = s.lastSync ? '🔄 ' + new Date(s.lastSync).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '🔄 연결됨';
    } else {
      $('syncStatus').textContent = '';
    }
  }

  // ---- 뷰 전환 ----
  function switchView(v, customTitle) {
    view = v;
    searchQuery = '';
    $('searchInput').value = '';
    $('searchBar').classList.add('hidden');

    const isCal = v === 'calendar';
    listView.classList.toggle('hidden', isCal);
    calendarView.classList.toggle('hidden', !isCal);
    $('quickAdd').classList.toggle('hidden', isCal);

    if (v.startsWith('project:')) {
      const p = Store.data.projects.find(x => x.id === v.slice(8));
      viewTitle.textContent = p ? '📁 ' + p.name : '프로젝트';
    } else if (v.startsWith('tag:')) {
      viewTitle.textContent = '# ' + v.slice(4);
    } else {
      viewTitle.textContent = VIEW_TITLES[v] || customTitle || '';
    }
    $('sidebar').classList.remove('open');
    refresh();
  }

  function refresh() {
    renderSidebar();
    if (view === 'calendar') {
      $('calTitle').textContent = Cal.title();
      Cal.render($('calGrid'), {
        onDayClick: ds => {
          openTaskModal(null, ds);
        },
        onTaskClick: id => openTaskModal(id),
      });
    } else {
      renderList();
    }
  }

  // ---- 빠른 추가 ----
  const quickInput = $('quickInput');
  quickInput.addEventListener('input', () => {
    const p = NLP.parse(quickInput.value);
    const desc = NLP.describe(p);
    const hint = $('quickHint');
    if (desc && quickInput.value.trim()) {
      hint.textContent = desc;
      hint.classList.remove('hidden');
    } else hint.classList.add('hidden');
  });

  function quickAdd() {
    const raw = quickInput.value.trim();
    if (!raw) return;
    const p = NLP.parse(raw);
    if (!p.title) { toast('제목을 입력하세요'); return; }

    let projectId = '';
    if (p.projectName) {
      let proj = Store.data.projects.find(x => x.name === p.projectName);
      if (!proj) proj = Store.addProject(p.projectName);
      projectId = proj.id;
    } else if (view.startsWith('project:')) {
      projectId = view.slice(8);
    }
    const tags = [...p.tags];
    if (view.startsWith('tag:') && !tags.includes(view.slice(4))) tags.push(view.slice(4));

    let date = p.date;
    if (!date && view === 'today') date = Store.todayStr();

    Store.addTask({
      title: p.title, date, time: p.time,
      priority: p.priority, repeat: p.repeat,
      project: projectId, tags,
    });
    quickInput.value = '';
    $('quickHint').classList.add('hidden');
    refresh();
  }
  $('quickAddBtn').addEventListener('click', quickAdd);
  quickInput.addEventListener('keydown', e => { if (e.key === 'Enter') quickAdd(); });

  // ---- 할 일 모달 ----
  function openTaskModal(id, presetDate) {
    const t = id ? Store.data.tasks.find(x => x.id === id) : null;
    $('taskModalTitle').textContent = t ? '할 일 편집' : '새 할 일';
    $('fId').value = t ? t.id : '';
    $('fTitle').value = t ? t.title : '';
    $('fNotes').value = t ? t.notes : '';
    $('fDate').value = t ? t.date : (presetDate || '');
    $('fTime').value = t ? t.time : '';
    $('fPriority').value = t ? t.priority : 0;
    $('fRepeat').value = t ? t.repeat : '';
    $('fTags').value = t ? t.tags.join(', ') : '';

    const sel = $('fProject');
    sel.innerHTML = '<option value="">없음</option>' +
      Store.data.projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    sel.value = t ? t.project : (view.startsWith('project:') ? view.slice(8) : '');

    editingSubtasks = t ? t.subtasks.map(s => ({ ...s })) : [];
    renderSubtasks();

    $('deleteTaskBtn').classList.toggle('hidden', !t);
    $('taskModal').classList.remove('hidden');
    $('fTitle').focus();
  }

  function renderSubtasks() {
    $('subtaskList').innerHTML = editingSubtasks.map((s, i) => `
      <div class="subtask-row">
        <input type="checkbox" ${s.done ? 'checked' : ''} data-i="${i}" class="sub-done">
        <input type="text" value="${escapeHtml(s.title)}" data-i="${i}" class="sub-title" placeholder="하위 할 일">
        <button type="button" class="icon-btn sub-del" data-i="${i}">✕</button>
      </div>`).join('');
    $('subtaskList').querySelectorAll('.sub-done').forEach(el =>
      el.addEventListener('change', () => { editingSubtasks[+el.dataset.i].done = el.checked; }));
    $('subtaskList').querySelectorAll('.sub-title').forEach(el =>
      el.addEventListener('input', () => { editingSubtasks[+el.dataset.i].title = el.value; }));
    $('subtaskList').querySelectorAll('.sub-del').forEach(el =>
      el.addEventListener('click', () => { editingSubtasks.splice(+el.dataset.i, 1); renderSubtasks(); }));
  }

  $('addSubtaskBtn').addEventListener('click', () => {
    editingSubtasks.push({ id: Store.uid(), title: '', done: false });
    renderSubtasks();
    const inputs = $('subtaskList').querySelectorAll('.sub-title');
    inputs[inputs.length - 1].focus();
  });

  $('taskForm').addEventListener('submit', e => {
    e.preventDefault();
    const patch = {
      title: $('fTitle').value.trim(),
      notes: $('fNotes').value.trim(),
      date: $('fDate').value,
      time: $('fTime').value,
      priority: +$('fPriority').value,
      repeat: $('fRepeat').value,
      project: $('fProject').value,
      tags: $('fTags').value.split(',').map(s => s.trim()).filter(Boolean),
      subtasks: editingSubtasks.filter(s => s.title.trim()),
    };
    if (!patch.title) return;
    const id = $('fId').value;
    if (id) Store.updateTask(id, patch);
    else Store.addTask(patch);
    $('taskModal').classList.add('hidden');
    refresh();
  });

  $('deleteTaskBtn').addEventListener('click', () => {
    const id = $('fId').value;
    if (!id) return;
    lastDeleted = Store.deleteTask(id);
    $('taskModal').classList.add('hidden');
    refresh();
    toast('할 일을 삭제했습니다', () => {
      if (lastDeleted) { Store.restoreTask(lastDeleted); lastDeleted = null; refresh(); }
    });
  });

  // ---- 모달 닫기 공통 ----
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
    modal.querySelectorAll('.modal-close').forEach(btn =>
      btn.addEventListener('click', () => modal.classList.add('hidden')));
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  });

  // ---- 네비게이션 ----
  document.querySelectorAll('#nav .nav-item').forEach(el => {
    el.addEventListener('click', () => switchView(el.dataset.view));
  });
  $('menuBtn').addEventListener('click', () => $('sidebar').classList.add('open'));
  $('sidebarClose').addEventListener('click', () => $('sidebar').classList.remove('open'));

  $('addProjectBtn').addEventListener('click', () => {
    const name = prompt('새 프로젝트 이름');
    if (name && name.trim()) { Store.addProject(name.trim()); refresh(); }
  });

  // ---- 검색 ----
  $('searchBtn').addEventListener('click', () => {
    const bar = $('searchBar');
    bar.classList.toggle('hidden');
    if (!bar.classList.contains('hidden')) $('searchInput').focus();
    else { searchQuery = ''; refresh(); }
  });
  $('searchInput').addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    if (view === 'calendar') switchView('all');
    renderList();
  });

  // ---- 캘린더 컨트롤 ----
  $('calPrev').addEventListener('click', () => { Cal.move(-1); refresh(); });
  $('calNext').addEventListener('click', () => { Cal.move(1); refresh(); });
  $('calToday').addEventListener('click', () => { Cal.goToday(); refresh(); });
  $('calMonthBtn').addEventListener('click', () => {
    Cal.setMode('month');
    $('calMonthBtn').classList.add('active'); $('calWeekBtn').classList.remove('active');
    refresh();
  });
  $('calWeekBtn').addEventListener('click', () => {
    Cal.setMode('week');
    $('calWeekBtn').classList.add('active'); $('calMonthBtn').classList.remove('active');
    refresh();
  });

  // ---- 테마 ----
  function applyTheme() {
    const dark = Store.data.settings.theme === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    $('themeBtn').textContent = dark ? '☀️ 라이트 모드' : '🌙 다크 모드';
  }
  $('themeBtn').addEventListener('click', () => {
    Store.data.settings.theme = Store.data.settings.theme === 'dark' ? 'light' : 'dark';
    Store.save();
    applyTheme();
  });

  // ---- 설정 모달 ----
  $('settingsBtn').addEventListener('click', () => {
    $('gClientId').value = Store.data.settings.gClientId;
    $('gApiKey').value = Store.data.settings.gApiKey;
    $('ghToken').value = Store.data.settings.ghToken;
    updateGcalUI();
    updateGhUI();
    $('settingsModal').classList.remove('hidden');
  });

  // ---- GitHub Gist 멀티기기 동기화 ----
  function updateGhUI() {
    const connected = Sync.isConnected();
    $('ghConnectBtn').classList.toggle('hidden', connected);
    $('ghSyncBtn').classList.toggle('hidden', !connected);
    $('ghDisconnectBtn').classList.toggle('hidden', !connected);
    if (connected && !$('ghStatus').textContent) $('ghStatus').textContent = '✅ 자동 동기화가 켜져 있습니다.';
  }

  $('ghConnectBtn').addEventListener('click', async () => {
    const token = $('ghToken').value.trim();
    if (!token) { $('ghStatus').textContent = '토큰을 입력하세요'; return; }
    $('ghStatus').textContent = '연결 중…';
    try {
      const login = await Sync.connect(token);
      $('ghStatus').textContent = `✅ ${login} 계정에 연결됐습니다. 이제 모든 기기가 자동 동기화됩니다.`;
      updateGhUI();
      refresh();
    } catch (err) {
      $('ghStatus').textContent = '❌ 연결 실패: ' + err.message;
    }
  });
  $('ghSyncBtn').addEventListener('click', async () => {
    $('ghStatus').textContent = '동기화 중…';
    try {
      await Sync.sync();
      refresh();
      $('ghStatus').textContent = '✅ 동기화 완료';
    } catch (err) {
      $('ghStatus').textContent = '❌ 동기화 실패: ' + err.message;
    }
  });
  $('ghDisconnectBtn').addEventListener('click', () => {
    Sync.disconnect();
    $('ghToken').value = '';
    $('ghStatus').textContent = '';
    updateGhUI();
    refresh();
    toast('동기화 연결을 해제했습니다 (데이터는 이 기기에 유지)');
  });

  // 동기화 완료/실패 시 UI 갱신
  Sync.setStatusListener((state, msg) => {
    if (state === 'ok') refresh();
    if (state === 'syncing') $('syncStatus').textContent = '🔁 동기화 중…';
    if (state === 'error') $('syncStatus').textContent = '🔁 ⚠️';
  });

  // 앱 시작 시 + 창에 다시 돌아왔을 때 자동 동기화
  if (Sync.isConnected()) Sync.sync().catch(() => {});
  window.addEventListener('focus', () => { if (Sync.isConnected()) Sync.schedule(); });

  function updateGcalUI() {
    const connected = Store.data.settings.gConnected;
    $('gConnectBtn').classList.toggle('hidden', connected);
    $('gSyncBtn').classList.toggle('hidden', !connected);
    $('gDisconnectBtn').classList.toggle('hidden', !connected);
    $('gStatus').textContent = connected
      ? '✅ 구글 캘린더에 연결되어 있습니다.'
      : '';
  }

  // JSON 백업/복원
  $('exportJsonBtn').addEventListener('click', () => {
    ICS.download('modu-todo-backup-' + Store.todayStr() + '.json', Store.exportJSON(), 'application/json');
    toast('백업 파일을 다운로드했습니다');
  });
  $('importJsonBtn').addEventListener('click', () => $('importJsonFile').click());
  $('importJsonFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      Store.importJSON(await file.text());
      applyTheme();
      refresh();
      toast('백업을 복원했습니다');
    } catch (err) { toast('복원 실패: ' + err.message); }
    e.target.value = '';
  });

  // ICS 내보내기/가져오기
  $('exportIcsBtn').addEventListener('click', () => {
    const withDate = Store.data.tasks.filter(t => t.date && !t.done);
    if (!withDate.length) { toast('날짜가 있는 할 일이 없습니다'); return; }
    ICS.download('modu-todo-' + Store.todayStr() + '.ics', ICS.exportTasks(Store.data.tasks));
    toast(`${withDate.length}개 일정을 ICS로 내보냈습니다`);
  });
  $('importIcsBtn').addEventListener('click', () => $('importIcsFile').click());
  $('importIcsFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const items = ICS.parse(await file.text());
      let added = 0;
      for (const it of items) {
        // 같은 제목+날짜가 이미 있으면 건너뜀 (중복 방지)
        if (Store.data.tasks.some(t => t.title === it.title && t.date === it.date)) continue;
        Store.addTask({
          title: it.title, notes: it.notes, date: it.date, time: it.time,
          tags: it.tags || [], repeat: it.repeat || '',
        });
        added++;
      }
      refresh();
      toast(`${added}개 일정을 가져왔습니다 (중복 ${items.length - added}개 제외)`);
    } catch (err) { toast('가져오기 실패: ' + err.message); }
    e.target.value = '';
  });

  // 구글 캘린더
  $('gConnectBtn').addEventListener('click', async () => {
    Store.data.settings.gClientId = $('gClientId').value.trim();
    Store.data.settings.gApiKey = $('gApiKey').value.trim();
    Store.save();
    $('gStatus').textContent = '연결 중…';
    try {
      await GCal.connect();
      updateGcalUI();
      $('gStatus').textContent = '✅ 연결됐습니다. "지금 동기화"를 눌러보세요.';
    } catch (err) {
      $('gStatus').textContent = '❌ 연결 실패: ' + err.message;
    }
  });
  $('gSyncBtn').addEventListener('click', async () => {
    $('gStatus').textContent = '동기화 중…';
    try {
      const r = await GCal.sync();
      refresh();
      $('gStatus').textContent = `✅ 동기화 완료 — 가져옴 ${r.pulled}개, 올림 ${r.pushed}개`;
    } catch (err) {
      $('gStatus').textContent = '❌ 동기화 실패: ' + err.message;
    }
  });
  $('gDisconnectBtn').addEventListener('click', () => {
    GCal.disconnect();
    updateGcalUI();
    refresh();
    toast('구글 캘린더 연결을 해제했습니다');
  });

  // 데이터 초기화
  $('wipeBtn').addEventListener('click', () => {
    if (confirm('정말 모든 데이터를 삭제할까요? 되돌릴 수 없습니다.\n(먼저 JSON 백업을 권장합니다)')) {
      Store.wipe();
      applyTheme();
      refresh();
      $('settingsModal').classList.add('hidden');
    }
  });

  // ---- 단축키 ----
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === 'n' || e.key === 'ㅜ') { e.preventDefault(); quickInput.focus(); }
    if (e.key === '/') { e.preventDefault(); $('searchBar').classList.remove('hidden'); $('searchInput').focus(); }
    if (e.key === '1') switchView('today');
    if (e.key === '2') switchView('upcoming');
    if (e.key === '3') switchView('all');
    if (e.key === '4') switchView('calendar');
  });

  // ---- 시작 ----
  applyTheme();
  switchView('today');

  // 첫 실행 환영 데이터
  if (!Store.data.tasks.length && !localStorage.getItem('modu-todo-welcomed')) {
    localStorage.setItem('modu-todo-welcomed', '1');
    const today = Store.todayStr();
    Store.addTask({ title: '👋 환영합니다! 이 할 일을 눌러 편집해 보세요', date: today, priority: 2 });
    Store.addTask({ title: '위 입력창에 "내일 3시 회의 #업무 !높음" 처럼 입력해 보세요', date: today });
    Store.addTask({ title: '설정에서 ICS 내보내기로 모든 캘린더와 연동할 수 있어요', date: today, tags: ['팁'] });
    refresh();
  }
})();
