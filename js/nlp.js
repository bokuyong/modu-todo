/* nlp.js — 한국어/영어 자연어 빠른 입력 파서
   예: "내일 3시 회의 #업무 @사이드프로젝트 !높음 매주"
*/
const NLP = (() => {
  const WEEKDAYS = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };

  function parse(input) {
    let text = input.trim();
    const out = { title: '', date: '', time: '', priority: 0, repeat: '', tags: [], projectName: '' };
    const today = new Date();

    const consume = (regex, fn) => {
      const m = text.match(regex);
      if (m) {
        fn(m);
        text = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).trim();
      }
      return !!m;
    };

    // 태그 (#태그) — 여러 개 허용
    while (consume(/#([^\s#@!]+)/, m => out.tags.push(m[1]))) {}

    // 프로젝트 (@프로젝트)
    consume(/@([^\s#@!]+)/, m => { out.projectName = m[1]; });

    // 우선순위 (!높음 !보통 !낮음 / !1 !2 !3 / !high...)
    consume(/!(높음|보통|낮음|high|medium|low|[123])/i, m => {
      const v = m[1].toLowerCase();
      out.priority = ({ '높음': 3, 'high': 3, '3': 3, '보통': 2, 'medium': 2, '2': 2, '낮음': 1, 'low': 1, '1': 1 })[v] || 0;
    });

    // 반복
    consume(/(매일|매주|매달|매월|매년|daily|weekly|monthly|yearly)/i, m => {
      const v = m[1].toLowerCase();
      out.repeat = ({ '매일': 'daily', 'daily': 'daily', '매주': 'weekly', 'weekly': 'weekly',
        '매달': 'monthly', '매월': 'monthly', 'monthly': 'monthly', '매년': 'yearly', 'yearly': 'yearly' })[v];
    });

    // ---- 날짜 ----
    const setDate = d => { out.date = Store.fmtDate(d); };

    // YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD
    if (!consume(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/, m => setDate(new Date(+m[1], +m[2] - 1, +m[3])))) {
      // M월 D일
      if (!consume(/(\d{1,2})월\s*(\d{1,2})일/, m => {
        const d = new Date(today.getFullYear(), +m[1] - 1, +m[2]);
        if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) d.setFullYear(d.getFullYear() + 1);
        setDate(d);
      })) {
        // M/D (시간과 혼동 방지: 콜론 없는 슬래시 형태)
        if (!consume(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?=\s|$)/, m => {
          const d = new Date(today.getFullYear(), +m[1] - 1, +m[2]);
          if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) d.setFullYear(d.getFullYear() + 1);
          setDate(d);
        })) {
          // 상대 날짜 키워드
          if (!consume(/(오늘|today)/i, () => setDate(today))) {
            if (!consume(/(내일|tomorrow)/i, () => { const d = new Date(today); d.setDate(d.getDate() + 1); setDate(d); })) {
              if (!consume(/(모레)/, () => { const d = new Date(today); d.setDate(d.getDate() + 2); setDate(d); })) {
                // 다음주 X요일 / 이번주 X요일 / X요일
                consume(/(다음\s*주|이번\s*주)?\s*([일월화수목금토])요일/, m => {
                  const target = WEEKDAYS[m[2]];
                  const d = new Date(today);
                  if (/다음/.test(m[1] || '')) {
                    // 다음주 = 다가오는 일요일부터 시작하는 주의 해당 요일
                    d.setDate(d.getDate() - d.getDay() + 7 + target);
                  } else if (/이번/.test(m[1] || '')) {
                    d.setDate(d.getDate() - d.getDay() + target);
                  } else {
                    // 요일만 쓰면 다가오는 가장 가까운 해당 요일
                    let diff = (target - d.getDay() + 7) % 7;
                    if (diff === 0) diff = 7;
                    d.setDate(d.getDate() + diff);
                  }
                  setDate(d);
                });
              }
            }
          }
        }
      }
    }

    // ---- 시간 ----
    // HH:MM
    if (!consume(/(\d{1,2}):(\d{2})/, m => {
      out.time = String(+m[1]).padStart(2, '0') + ':' + m[2];
    })) {
      // 오후 3시 / 오전 9시 반 / 15시 / 3시
      consume(/(오전|오후|저녁|밤|아침|새벽)?\s*(\d{1,2})시\s*(반|(\d{1,2})분)?/, m => {
        let h = +m[2];
        const ampm = m[1];
        if ((ampm === '오후' || ampm === '저녁' || ampm === '밤') && h < 12) h += 12;
        if (ampm === '새벽' && h === 12) h = 0;
        if (!ampm && h <= 7) h += 12; // 무지정 1~7시는 오후로 추정
        let min = 0;
        if (m[3] === '반') min = 30;
        else if (m[4]) min = +m[4];
        out.time = String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
      });
    }

    // 시간이 있는데 날짜가 없으면 오늘로
    if (out.time && !out.date) out.date = Store.todayStr();

    out.title = text.replace(/\s{2,}/g, ' ').trim();
    return out;
  }

  /* 파싱 결과 미리보기 문구 */
  function describe(p) {
    const parts = [];
    if (p.date) {
      const d = new Date(p.date + 'T00:00:00');
      const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
      parts.push(`📅 ${d.getMonth() + 1}월 ${d.getDate()}일(${dayNames[d.getDay()]})`);
    }
    if (p.time) parts.push(`⏰ ${p.time}`);
    if (p.priority) parts.push(['', '🔵 낮음', '🟡 보통', '🔴 높음'][p.priority]);
    if (p.repeat) parts.push('🔁 ' + ({ daily: '매일', weekly: '매주', monthly: '매월', yearly: '매년' })[p.repeat]);
    if (p.projectName) parts.push('📁 ' + p.projectName);
    if (p.tags.length) parts.push(p.tags.map(t => '#' + t).join(' '));
    return parts.join('  ');
  }

  return { parse, describe };
})();
