/* ics.js — iCalendar(RFC 5545) 내보내기/가져오기
   구글·애플·아웃룩·네이버 등 모든 표준 캘린더와 호환되는 형식 */
const ICS = (() => {

  const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const pad = n => String(n).padStart(2, '0');

  function dtstamp() {
    const d = new Date();
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
      'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }

  // 75바이트 줄 접기(line folding)
  function fold(line) {
    const out = [];
    let s = line;
    while (s.length > 74) {
      out.push(s.slice(0, 74));
      s = ' ' + s.slice(74);
    }
    out.push(s);
    return out.join('\r\n');
  }

  const REPEAT_RRULE = { daily: 'FREQ=DAILY', weekly: 'FREQ=WEEKLY', monthly: 'FREQ=MONTHLY', yearly: 'FREQ=YEARLY' };

  /* 날짜 있는 할 일을 VEVENT 로 내보내기 (캘린더 앱 호환성이 VTODO보다 훨씬 좋음) */
  function exportTasks(tasks) {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//modu-todo//KO',
      'CALSCALE:GREGORIAN',
      'X-WR-CALNAME:모두의 할 일',
    ];
    const stamp = dtstamp();
    tasks.filter(t => t.date && !t.done).forEach(t => {
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + t.id + '@modu-todo');
      lines.push('DTSTAMP:' + stamp);
      if (t.time) {
        const dt = t.date.replace(/-/g, '') + 'T' + t.time.replace(':', '') + '00';
        lines.push('DTSTART:' + dt);
        // 기본 1시간
        const [h, m] = t.time.split(':').map(Number);
        const end = new Date(2000, 0, 1, h + 1, m);
        lines.push('DTEND:' + t.date.replace(/-/g, '') + 'T' + pad(end.getHours()) + pad(end.getMinutes()) + '00');
      } else {
        lines.push('DTSTART;VALUE=DATE:' + t.date.replace(/-/g, ''));
      }
      lines.push(fold('SUMMARY:' + esc(t.title)));
      if (t.notes) lines.push(fold('DESCRIPTION:' + esc(t.notes)));
      if (t.repeat && REPEAT_RRULE[t.repeat]) lines.push('RRULE:' + REPEAT_RRULE[t.repeat]);
      if (t.tags && t.tags.length) lines.push(fold('CATEGORIES:' + t.tags.map(esc).join(',')));
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  /* ICS 파일 파싱 → 할 일 배열 (VEVENT/VTODO 모두 지원) */
  function parse(icsText) {
    // 줄 펼치기 (folded lines)
    const raw = icsText.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
    const lines = raw.split(/\r?\n/);
    const items = [];
    let cur = null;
    let curType = null;

    const unesc = s => s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');

    for (const line of lines) {
      if (line === 'BEGIN:VEVENT' || line === 'BEGIN:VTODO') {
        cur = { title: '', notes: '', date: '', time: '', tags: [] };
        curType = line.slice(6);
        continue;
      }
      if ((line === 'END:VEVENT' || line === 'END:VTODO') && cur) {
        if (cur.title) items.push(cur);
        cur = null;
        continue;
      }
      if (!cur) continue;

      const ci = line.indexOf(':');
      if (ci < 0) continue;
      const left = line.slice(0, ci);
      const value = line.slice(ci + 1);
      const prop = left.split(';')[0].toUpperCase();

      if (prop === 'SUMMARY') cur.title = unesc(value);
      else if (prop === 'DESCRIPTION') cur.notes = unesc(value);
      else if (prop === 'CATEGORIES') cur.tags = value.split(',').map(unesc).map(s => s.trim()).filter(Boolean);
      else if (prop === 'DTSTART' || (curType === 'VTODO' && prop === 'DUE')) {
        const m = value.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
        if (m) {
          cur.date = `${m[1]}-${m[2]}-${m[3]}`;
          if (m[4]) cur.time = `${m[4]}:${m[5]}`;
        }
      }
      else if (prop === 'RRULE') {
        const f = value.match(/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/i);
        if (f) cur.repeat = f[1].toLowerCase();
      }
    }
    return items;
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return { exportTasks, parse, download };
})();
