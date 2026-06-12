/* calendar.js — 월/주 캘린더 뷰 렌더링 */
const Cal = (() => {
  let mode = 'month';            // 'month' | 'week'
  let cursor = new Date();       // 현재 보고 있는 기준 날짜
  const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

  function setMode(m) { mode = m; }
  function getMode() { return mode; }
  function move(delta) {
    if (mode === 'month') cursor.setMonth(cursor.getMonth() + delta);
    else cursor.setDate(cursor.getDate() + delta * 7);
  }
  function goToday() { cursor = new Date(); }

  function title() {
    if (mode === 'month') return `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`;
    const start = weekStart(cursor);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    return `${start.getMonth() + 1}월 ${start.getDate()}일 – ${end.getMonth() + 1}월 ${end.getDate()}일`;
  }

  function weekStart(d) {
    const s = new Date(d);
    s.setDate(s.getDate() - s.getDay());
    s.setHours(0, 0, 0, 0);
    return s;
  }

  /* 해당 날짜의 항목(할 일 + 구글 이벤트) 수집 */
  function itemsOn(dateStr) {
    const tasks = Store.data.tasks
      .filter(t => t.date === dateStr)
      .sort((a, b) => (a.time || '99') < (b.time || '99') ? -1 : 1);
    const gevents = (Store.data.gcalEvents || [])
      .filter(e => e.date === dateStr);
    return { tasks, gevents };
  }

  /* 렌더링 — onDayClick(dateStr), onTaskClick(taskId) 콜백 */
  function render(container, { onDayClick, onTaskClick }) {
    const today = Store.todayStr();
    const cells = [];

    if (mode === 'month') {
      const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const start = weekStart(first);
      for (let i = 0; i < 42; i++) {
        const d = new Date(start); d.setDate(d.getDate() + i);
        cells.push(d);
      }
      // 마지막 줄이 전부 다음달이면 35칸으로 줄임
      if (cells[35].getMonth() !== cursor.getMonth()) cells.length = 35;
    } else {
      const start = weekStart(cursor);
      for (let i = 0; i < 7; i++) {
        const d = new Date(start); d.setDate(d.getDate() + i);
        cells.push(d);
      }
    }

    let html = '<div class="cal-weekdays">' +
      DAY_NAMES.map((n, i) => `<div class="${i === 0 ? 'sun' : ''}">${n}</div>`).join('') +
      '</div><div class="cal-cells">';

    const maxShow = mode === 'month' ? 3 : 8;

    for (const d of cells) {
      const ds = Store.fmtDate(d);
      const isOther = mode === 'month' && d.getMonth() !== cursor.getMonth();
      const isToday = ds === today;
      const { tasks, gevents } = itemsOn(ds);

      let evHtml = '';
      const shown = tasks.slice(0, maxShow);
      for (const t of shown) {
        const time = t.time ? t.time + ' ' : '';
        evHtml += `<div class="cal-ev ${t.done ? 'done' : ''}" data-task="${t.id}" title="${escapeHtml(t.title)}">${time}${escapeHtml(t.title)}</div>`;
      }
      const gShown = gevents.slice(0, Math.max(0, maxShow - shown.length));
      for (const e of gShown) {
        const time = e.time ? e.time + ' ' : '';
        evHtml += `<div class="cal-ev gcal" title="(구글) ${escapeHtml(e.title)}">${time}${escapeHtml(e.title)}</div>`;
      }
      const hidden = tasks.length + gevents.length - shown.length - gShown.length;
      if (hidden > 0) evHtml += `<div class="cal-more">+${hidden}개 더</div>`;

      html += `<div class="cal-cell ${isOther ? 'other' : ''} ${isToday ? 'today' : ''}" data-date="${ds}">
        <div class="cal-date ${d.getDay() === 0 ? 'sun' : ''}">${d.getDate()}</div>${evHtml}</div>`;
    }
    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('.cal-ev[data-task]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        onTaskClick(el.dataset.task);
      });
    });
    container.querySelectorAll('.cal-cell').forEach(el => {
      el.addEventListener('click', () => onDayClick(el.dataset.date));
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { render, move, goToday, title, setMode, getMode };
})();
