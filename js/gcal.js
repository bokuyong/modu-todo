/* gcal.js — 구글 캘린더 양방향 동기화 (선택 기능)
   사용자가 설정에서 본인의 OAuth 클라이언트 ID + API 키를 입력하면 활성화됨.
   Google Identity Services(GIS) + gapi 클라이언트를 CDN에서 지연 로드. */
const GCal = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
  let tokenClient = null;
  let gapiReady = false;
  let accessToken = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('스크립트 로드 실패: ' + src));
      document.head.appendChild(s);
    });
  }

  async function init() {
    const { gClientId, gApiKey } = Store.data.settings;
    if (!gClientId || !gApiKey) throw new Error('클라이언트 ID와 API 키를 먼저 입력하세요');

    await Promise.all([
      loadScript('https://accounts.google.com/gsi/client'),
      loadScript('https://apis.google.com/js/api.js'),
    ]);

    if (!gapiReady) {
      await new Promise((res, rej) => gapi.load('client', { callback: res, onerror: rej }));
      await gapi.client.init({
        apiKey: gApiKey,
        discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
      });
      gapiReady = true;
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: gClientId,
      scope: SCOPE,
      callback: () => {},
    });
  }

  function requestToken() {
    return new Promise((resolve, reject) => {
      tokenClient.callback = (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        accessToken = resp.access_token;
        gapi.client.setToken({ access_token: accessToken });
        resolve();
      };
      tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
    });
  }

  async function connect() {
    await init();
    await requestToken();
    Store.data.settings.gConnected = true;
    Store.save();
  }

  function disconnect() {
    if (accessToken && typeof google !== 'undefined') {
      try { google.accounts.oauth2.revoke(accessToken, () => {}); } catch (e) {}
    }
    accessToken = null;
    Store.data.settings.gConnected = false;
    Store.data.gcalEvents = [];
    Store.save();
  }

  /* 양방향 동기화:
     1) 풀: 구글 캘린더의 향후 60일 이벤트 → 읽기전용 캐시(gcalEvents)
     2) 푸시: 날짜 있는 미완료 할 일 중 아직 안 올라간 것 → 구글 캘린더에 생성 */
  async function sync() {
    if (!gapiReady || !tokenClient) await init();
    await requestToken();

    // ---- 풀 ----
    const now = new Date();
    const max = new Date(now); max.setDate(max.getDate() + 60);
    const min = new Date(now); min.setDate(min.getDate() - 7);
    const resp = await gapi.client.calendar.events.list({
      calendarId: 'primary',
      timeMin: min.toISOString(),
      timeMax: max.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });

    const ourIds = new Set(Store.data.tasks.map(t => t.gcalId).filter(Boolean));
    Store.data.gcalEvents = (resp.result.items || [])
      .filter(ev => !ourIds.has(ev.id))  // 우리가 올린 이벤트는 제외 (중복 표시 방지)
      .map(ev => {
        const start = ev.start || {};
        let date = '', time = '';
        if (start.date) date = start.date;
        else if (start.dateTime) {
          const d = new Date(start.dateTime);
          date = Store.fmtDate(d);
          time = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        }
        return { id: ev.id, title: ev.summary || '(제목 없음)', date, time };
      })
      .filter(e => e.date);

    // ---- 푸시 ----
    let pushed = 0;
    const todayStr = Store.todayStr();
    for (const t of Store.data.tasks) {
      if (t.done || !t.date || t.gcalId || t.date < todayStr) continue;
      const resource = t.time
        ? (() => {
            const start = new Date(`${t.date}T${t.time}:00`);
            const end = new Date(start.getTime() + 60 * 60 * 1000);
            return {
              summary: t.title,
              description: t.notes || '',
              start: { dateTime: start.toISOString() },
              end: { dateTime: end.toISOString() },
            };
          })()
        : {
            summary: t.title,
            description: t.notes || '',
            start: { date: t.date },
            end: { date: t.date },
          };
      try {
        const created = await gapi.client.calendar.events.insert({ calendarId: 'primary', resource });
        t.gcalId = created.result.id;
        pushed++;
      } catch (e) {
        console.error('이벤트 푸시 실패:', t.title, e);
      }
    }

    Store.data.settings.lastSync = new Date().toISOString();
    Store.save();
    return { pulled: Store.data.gcalEvents.length, pushed };
  }

  return { connect, disconnect, sync };
})();
