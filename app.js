/* NYC Planner · vanilla JS, sin build. Estado → render() → innerHTML. El mapa (Leaflet) vive fuera del re-render. */
'use strict';

// ───────────────────────── utilidades ─────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fmt = (min) => { min = ((min % 1440) + 1440) % 1440; return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); };
const durTxt = (m) => (m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + String(m % 60).padStart(2, '0') : '') : m + ' min');
const money = (n) => '$' + Math.round(n).toLocaleString('es-CR');
const kmTxt = (km) => km.toFixed(1).replace('.', ',') + ' km';
const km = (a, b) => { const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180; const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const DIAS = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
const dateOf = (iso) => new Date(iso + 'T12:00:00-04:00');
const dayLabel = (iso) => { const d = dateOf(iso); return MESES[d.getUTCMonth()] + ' ' + String(d.getUTCDate()).padStart(2, '0'); };
const dow = (iso) => DIAS[new Date(iso + 'T12:00:00Z').getUTCDay()];
const isWeekend = (iso) => [0, 6].includes(new Date(iso + 'T12:00:00Z').getUTCDay());
const dirUrl = (a, b, mode = 'walking') => `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&travelmode=${mode}`;
const tagsOf = (p) => CAT_TAGS[p.cat] || [];
const slotOf = (t) => { const m = toMin(t); return m < 12 * 60 ? 'Mañana' : m < 16.5 * 60 ? 'Tarde' : m < 19 * 60 ? 'Atardecer' : 'Noche'; };
const hhLink = (hood) => HAPPY_HOUR.site + '/' + (HAPPY_HOUR.hoods[hood] || '') + '/';

// Sol (NOAA simplificado) para NYC, salida en hora local de Nueva York (maneja el fin del horario de verano el 1 nov).
function sunTimes(iso) {
  const lat = 40.7128, lng = -74.006;
  const d = new Date(iso + 'T12:00:00Z'), n = Math.floor((d - Date.UTC(2000, 0, 1, 12)) / 864e5);
  const calc = (rising) => {
    const Jstar = n - lng / 360, M = (357.5291 + 0.98560028 * Jstar) % 360, Mr = M * Math.PI / 180;
    const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
    const lam = (M + C + 180 + 102.9372) % 360, lr = lam * Math.PI / 180;
    const Jtransit = 2451545 + Jstar + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * lr);
    const dec = Math.asin(Math.sin(lr) * Math.sin(23.44 * Math.PI / 180));
    const cosH = (Math.sin(-0.833 * Math.PI / 180) - Math.sin(lat * Math.PI / 180) * Math.sin(dec)) / (Math.cos(lat * Math.PI / 180) * Math.cos(dec));
    const H = Math.acos(cosH) * 180 / Math.PI;
    const J = Jtransit + (rising ? -H : H) / 360;
    return new Date((J - 2440587.5) * 864e5);
  };
  const local = (dt) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(dt); return toMin(p.find((x) => x.type === 'hour').value.replace('24', '00') + ':' + p.find((x) => x.type === 'minute').value); };
  const sr = local(calc(true)), ss = local(calc(false));
  return { sunrise: sr, golden: ss - 45, sunset: ss, blue: ss + 25 };
}

// ───────────────────────── estado ─────────────────────────
const LS = 'nycplan.v1';
const saved = (() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } })();
const S = {
  screen: ['overview','planner','explore','photo','halloween'].includes(location.hash.replace('#', '')) ? location.hash.replace('#', '') : 'overview', day: 1, sel: 0, detail: null, conn: null, hover: null,
  filters: {}, layers: { Ruta: true, 'Satélite': false, Multitud: false }, whyOpen: true, budget: false,
  photoF: { Atardecer: true }, photoDay: null, photoSel: 'dumbo', xmode: 'Todo', mview: 'list', sheetFull: false, addTo: null,
  custom: saved.custom || {}, savedIds: saved.savedIds || [], theme: saved.theme || 'dark',
};
if (saved.day != null) S.day = saved.day;
const persist = () => localStorage.setItem(LS, JSON.stringify({ custom: S.custom, savedIds: S.savedIds, theme: S.theme, day: S.day }));
const set = (p) => { Object.assign(S, p); render(); };

// ───────────────────────── modelo del día ─────────────────────────
const dayActs = (i) => S.custom[i] || DAYS[i].acts;
const setDayActs = (i, acts) => { S.custom[i] = acts; persist(); };
const inDay = (i, id) => dayActs(i).some(([pid]) => pid === id);

// Conexión entre dos lugares. ponytail: heurística por distancia; cambiar a API de rutas si hace falta precisión.
const SPECIAL = { 'gct>foresthills': { mode: 'lirr', min: 25, cost: 7, label: 'LIRR', sub: 'GRAND CENTRAL MADISON', detail: 'LIRR dirección Jamaica, 20 min + 5 min a pie desde Station Square', lines: [] }, 'foresthills>gct': { mode: 'lirr', min: 25, cost: 7, label: 'LIRR', sub: 'GRAND CENTRAL MADISON', detail: 'LIRR desde Forest Hills a Grand Central Madison, 20 min', lines: [] }, 'gantry>twa': { mode: 'subway', min: 55, cost: 11.15, label: 'METRO + AIRTRAIN', sub: 'E → JAMAICA → T5', detail: 'E en Court Sq hasta Jamaica-Sutphin (35 min) + AirTrain a Terminal 5 (10 min)', lines: ['E'] } };
function connect(a, b, startMin) {
  const sp = SPECIAL[a.id + '>' + b.id]; if (sp) return { ...sp, km: km(a, b) };
  const d = km(a, b), late = startMin >= 23 * 60 || startMin < 5 * 60;
  if (d <= 1.7) { const min = Math.max(3, Math.round(d / 4.6 * 60)); return { mode: 'walk', min, km: d, cost: 0, label: min + ' MIN A PIE', sub: kmTxt(d), detail: 'Ruta a pie · Google Maps para el trazado', lines: [] }; }
  if (late || (a.cat === 'Club' || b.cat === 'Club' || b.cat === 'Hotel') && startMin >= 21 * 60) { const min = Math.round(8 + d * 2.4), cost = Math.round(12 + d * 3); return { mode: 'uber', min, km: d, cost, label: '~' + min + ' MIN UBER', sub: '$' + cost + ' — $' + (cost + 8), detail: 'Tráfico ligero a esta hora · precio por viaje, no por persona', lines: [] }; }
  const min = Math.round(11 + d * 2.6); return { mode: 'subway', min, km: d, cost: 2.9, label: min + ' MIN METRO', sub: kmTxt(d), detail: 'Incluye caminar a la estación · $2,90 por persona con OMNY (tarjeta contactless)', lines: [] };
}
function buildDay(i) {
  const day = DAYS[i], acts = dayActs(i).map(([id, t]) => ({ ...BY_ID[id], t })).filter((a) => a.name);
  const rows = acts.map((a, k) => {
    const start = toMin(a.t), end = start + a.dur, next = acts[k + 1];
    const conn = next ? connect(a, next, end) : null;
    return { ...a, i: k, num: k + 1, start, end, endT: fmt(end), conn };
  });
  const walkKm = rows.reduce((s, r) => s + (r.conn && r.conn.mode === 'walk' ? r.conn.km : 0), 0);
  const transit = rows.reduce((s, r) => s + (r.conn && r.conn.mode !== 'walk' ? r.conn.min : 0), 0);
  const subwayRides = rows.filter((r) => r.conn && (r.conn.mode === 'subway' || r.conn.mode === 'lirr')).length;
  const uber = rows.reduce((s, r) => s + (r.conn && r.conn.mode === 'uber' ? r.conn.cost / TRIP.people : 0), 0);
  const segs = rows.filter((r) => r.conn), shortWalks = segs.filter((r) => r.conn.mode === 'walk' && r.conn.min <= 15).length;
  const eff = segs.length ? Math.round(((shortWalks + 0.6 * (segs.length - shortWalks)) / segs.length) * 100) : 100;
  const wk = isWeekend(day.date), T = wk ? TRAINS.weekend : TRAINS.weekday;
  let out = null, back = null;
  if (rows.length && !['arrival', 'departure'].includes(day.window)) {
    const first = rows[0], c0 = connect(TRIP.gct, first, 0), need = first.start - c0.min + 2;
    out = [...T.toNYC].reverse().find((t) => toMin(t[1]) <= need && toMin(t[1]) > 240) || T.toNYC[0];
    if (day.window !== 'halloween') {
      const last = rows[rows.length - 1], c1 = last.id === 'twa' ? null : connect(last, TRIP.gct, last.end), ready = c1 ? last.end + c1.min + 10 : null;
      if (ready != null) { back = T.toDanbury.find((t) => { const dep = toMin(t[0]); return (dep < 300 ? dep + 1440 : dep) >= ready; }) || null; }
    }
  }
  const costs = { Comida: 0, Actividades: 0, Compras: 0, Transporte: 0 };
  rows.forEach((r) => { const g = BUDGET_SHARE.Comida.includes(r.cat) ? 'Comida' : BUDGET_SHARE.Compras.includes(r.cat) ? 'Compras' : 'Actividades'; costs[g] += r.cost; });
  const fareOf = (t, arriving) => !wk && t && (arriving ? toMin(t[1]) < 600 : toMin(t[0]) >= 960 && toMin(t[0]) < 1200) ? TRAINS.fare.peak : TRAINS.fare.offpeak;
  costs.Transporte = (out ? fareOf(out, true) : 0) + (back ? fareOf(back, false) : 0) + subwayRides * 2.9 + uber;
  const total = Object.values(costs).reduce((a, b) => a + b, 0);
  const crowdScore = rows.length ? rows.reduce((s, r) => s + ({ Baja: 1, Moderada: 2, Alta: 3, 'Muy alta': 4 }[r.crowd]), 0) / rows.length : 1;
  const crowd = crowdScore < 1.7 ? 'Baja' : crowdScore < 2.5 ? 'Moderada' : 'Alta';
  return { ...day, i, num: i + 1, rows, walkKm, transit, subwayRides, eff, out, back, wk, costs, total, crowd, label: dayLabel(day.date), dow: dow(day.date), week: i < 8 ? 1 : 2, win: WINDOWS[day.window] };
}

// ───────────────────────── render ─────────────────────────
const SCREENS = [['overview', 'Resumen'], ['planner', 'Planificador'], ['explore', 'Explorar'], ['photo', 'Modo foto'], ['halloween', 'Halloween']];
const MNAV = [['overview', 'Resumen', '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'], ['planner', 'Plan', '<path d="M4 5h16M4 12h16M4 19h10"/>'], ['map', 'Mapa', '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15"/>'], ['explore', 'Explorar', '<circle cx="12" cy="12" r="9"/><path d="M15 9l-2 6-4 2 2-6z"/>'], ['halloween', 'Noche 31', '<path d="M12 3a7 7 0 0 0-7 7c0 3 2 5 2 8h10c0-3 2-5 2-8a7 7 0 0 0-7-7zM9 21h6M9 12l2 2M15 12l-2 2"/>']];

function render() {
  document.documentElement.dataset.theme = S.theme; $('#themeLabel').textContent = S.theme === 'dark' ? 'OSCURO' : 'CLARO';
  document.body.dataset.mview = S.screen === 'planner' ? S.mview : 'list';
  $('#nav').innerHTML = SCREENS.map(([id, l]) => `<button class="${S.screen === id ? 'on' : ''}" data-act="go" data-arg="${id}">${l}</button>`).join('');
  const mActive = S.screen === 'planner' ? (S.mview === 'map' ? 'map' : 'planner') : S.screen === 'photo' ? 'explore' : S.screen;
  $('#mnav').innerHTML = MNAV.map(([id, l, ic]) => `<button class="${mActive === id ? 'on' : ''}" data-act="mgo" data-arg="${id}"><svg viewBox="0 0 24 24">${ic}</svg>${l}</button>`).join('');
  const itin = $('.itin'), st = itin ? itin.scrollTop : 0, ds = $('.daystrip'), dsl = ds ? ds.scrollLeft : null, sheet = $('.sheet .list'), ssT = sheet ? sheet.scrollTop : 0;
  const view = $('#view');
  view.innerHTML = { overview: rOverview, planner: rPlanner, explore: rExplore, photo: rPhoto, halloween: rHalloween }[S.screen]();
  if (S.screen === 'planner') { mountMap(); const it = $('.itin'); if (it) it.scrollTop = st; const d = $('.daystrip'); if (d) { if (dsl != null) d.scrollLeft = dsl; else { const on = $('.daystrip .on'); if (on) d.scrollLeft = on.offsetLeft - 20; } } const sl = $('.sheet .list'); if (sl) sl.scrollTop = ssT; }
  if (S.detail && S.screen !== 'planner') view.insertAdjacentHTML('beforeend', rDrawer(S.detail, true));
  history.replaceState(null, '', '#' + S.screen);
}

// ── Resumen ──
function rOverview() {
  const days = DAYS.map((_, i) => buildDay(i)), tot = days.reduce((s, d) => s + d.total, 0);
  const sum = (k) => days.reduce((s, d) => s + d.costs[k], 0);
  const f = TRIP.flights;
  return `<section class="rise">
  <div class="hero"><img src="assets/skyline.jpg" alt="Skyline de Manhattan al atardecer"><div class="shade"></div><div class="shade2"></div>
    <div class="in"><div class="meta"><span>NEW YORK CITY</span><span>16 DÍAS / 2 PERSONAS</span><span>OCT 24 — NOV 08</span><span>BASE: DANBURY, CT</span></div>
      <h1>La ciudad<br>es el <em>itinerario.</em></h1>
      <p>Explora Nueva York barrio por barrio, no por lista de pendientes. Cada día es una ruta que empieza y termina en Grand Central.</p>
      <div class="cta"><button class="btn" data-act="go" data-arg="planner">Ver itinerario</button><button class="btn ghost" data-act="go" data-arg="explore">Explorar NYC</button><button class="btn ghost" data-act="go" data-arg="halloween">Halloween · 31 oct</button></div>
      <div class="facts"><div><div class="k">VUELO</div><div class="v">SJO → JFK · ${TRIP.confirmation}</div></div><div><div class="k">BASE</div><div class="v">1 Waterview · Danbury</div></div><div><div class="k">TREN</div><div class="v">Metro-North · ~2 h 05</div></div><div><div class="k">PRESUPUESTO</div><div class="v">${money(tot)} / persona est.</div></div></div>
    </div></div>
  <div class="weeks">
    <div><div class="eyebrow acc">SEMANA 01 · OCT 24 — OCT 31</div><h3>Día completo</h3><div class="win"><b>08:00 → 23:30</b><span>Primer tren 05:28 · último 23:28</span></div><div class="bar"><i style="left:33.3%;width:62%;background:var(--acc)"></i></div><p>Landmarks, museos, barrios, fotografía y noches largas. Los trenes de ida llegan a Grand Central entre 09:40 y 10:15; las rutas arrancan ahí.</p></div>
    <div><div class="eyebrow turq">SEMANA 02 · NOV 01 — NOV 08</div><h3>After work</h3><div class="win"><b>15:00 → 23:30</b><span>Lun — Vie · fines de semana completos</span></div><div class="bar"><i style="left:62.5%;width:33%;background:var(--turq)"></i></div><p>Atardeceres (16:49 desde el 1 de noviembre), cenas, Broadway, rooftops, jazz y museos nocturnos. El tren de 13:27 llega a las 15:54; el de vuelta sale a las 23:28.</p></div>
  </div>
  <div class="section"><div class="section-h"><h2>Dieciséis días, catorce rutas</h2><span class="eyebrow">PULSA UN DÍA PARA ABRIR EL PLANIFICADOR</span></div>
    <div class="daygrid">${days.map((d) => `<button class="daycard" data-act="openday" data-arg="${d.i}"><div class="hd"><span>DÍA ${String(d.num).padStart(2, '0')} · ${d.dow}</span><span>${d.label}</span></div><div class="t">${esc(d.title)}</div><div class="c"><span class="dot" style="background:${CROWD[d.crowd]}"></span>${d.rows.length ? d.rows.length + ' actividades' : esc(d.win.label.toLowerCase())}</div><div class="u" style="background:${d.win.color}"></div></button>`).join('')}</div>
  </div>
  <div class="two">
    <div><div class="eyebrow">BASE</div><h3>1 Waterview Dr</h3><div class="sub">Danbury, Connecticut · a 10 min en coche de Danbury Station</div><div class="txt">Cada día sale en tren desde Danbury: Danbury Branch hasta South Norwalk y New Haven Line hasta Grand Central. Dentro de cada día, las distancias se calculan actividad → siguiente actividad, no desde la base.</div><a href="${TRIP.base.maps}" target="_blank" rel="noopener" style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;margin-top:6px">Abrir en Maps →</a></div>
    <div><div class="eyebrow">ESTIMADO 16 DÍAS · POR PERSONA</div><div class="kv"><span>Comida</span><span>${money(sum('Comida'))}</span><span>Actividades y entradas</span><span>${money(sum('Actividades'))}</span><span>Transporte (tren + metro)</span><span>${money(sum('Transporte'))}</span><span>Compras</span><span>${money(sum('Compras'))}</span><span class="tot">Total</span><span>${money(tot)}</span></div><div class="txt">Para dos: ${money(tot * 2)}. No incluye hotel del 31 ni TWA Hotel del 7. El pase semanal de Metro-North ($145) sale más barato que 10 boletos sencillos: compra uno por semana.</div></div>
  </div>
  <div class="section" style="border-top:1px solid var(--line)"><div class="section-h"><h2>Vuelos</h2><span class="eyebrow">JETBLUE · CONFIRMACIÓN ${TRIP.confirmation}</span></div>
    <div class="flights">${f.map((x) => `<div class="flight"><div class="route">${x.from}<i>→</i>${x.to}</div><div class="fl">${x.flight} · ${dow(x.date)} ${dayLabel(x.date)} · Terminal ${x.terminal}</div><div class="time">${x.dep} — ${x.arr}<small>${x.date === '2026-11-08' ? (x.from === 'JFK' ? 'LLEGAR 04:15 · T5' : 'CONEXIÓN 3 H EN FLL') : 'LLEGADA NOCTURNA'}</small></div></div>`).join('')}</div>
  </div>
  <div class="section" style="border-top:1px solid var(--line)"><div class="section-h"><h2>Tren Danbury ⇄ Grand Central</h2><a href="${TRAINS.link}" target="_blank" rel="noopener" class="eyebrow acc">HORARIO OFICIAL MTA →</a></div>
    <div class="fares"><div>Sencillo off-peak<b>$${TRAINS.fare.offpeak}</b></div><div>Sencillo peak (llegar 06-10 / salir 16-20 entre semana)<b>$${TRAINS.fare.peak}</b></div><div>Semanal ilimitado<b>$${TRAINS.fare.weekly}</b></div><div>Pase de día fin de semana<b>$${TRAINS.fare.dayWeekend}</b></div><div>Cambio de tren<b>South Norwalk</b></div></div>
    ${rTrainTables()}
    <p style="font-size:13px;color:var(--fg2);line-height:1.5;max-width:720px">Compra en la app TrainTime (MTA) para no hacer fila. "c" significa cambio en South Norwalk: bajas del tren del ramal y subes al de la línea principal en el mismo andén, 3-6 min de espera. Los fines de semana todo es off-peak.</p>
  </div></section>`;
}
function rTrainTables() {
  const col = (title, list) => `<div><h4>${title}</h4><ul>${list.map((t) => `<li><b>${t[0]}</b><span>→ ${t[1]}${t[2] ? ' <em>c</em>' : ''}</span></li>`).join('')}</ul></div>`;
  return `<div class="trains">${col('LUN — VIE · DANBURY → GCT', TRAINS.weekday.toNYC)}${col('LUN — VIE · GCT → DANBURY', TRAINS.weekday.toDanbury)}${col('SÁB — DOM · DANBURY → GCT', TRAINS.weekend.toNYC)}${col('SÁB — DOM · GCT → DANBURY', TRAINS.weekend.toDanbury)}</div>`;
}

// ── Planificador ──
const activeFilters = () => Object.keys(S.filters).filter((k) => S.filters[k]);
const matches = (r) => activeFilters().every((k) => tagsOf(r).includes(k) || r.price === k || slotOf(r.t) === k || r.crowd === k);
function rPlanner() {
  const D = buildDay(S.day), act = activeFilters();
  const strip = `<div class="daystrip">${DAYS.map((d, i) => { const b = buildDay(i); return `<button class="${i === S.day ? 'on' : ''}" data-act="openday" data-arg="${i}"><div class="hd"><span>DÍA ${String(i + 1).padStart(2, '0')}</span><span>${b.label}</span></div><div class="t">${esc(d.title)}</div><div class="c"><span class="dot" style="background:${CROWD[b.crowd]}"></span>${b.rows.length} act. · ${b.dow}</div><div class="u" style="background:${i === S.day ? b.win.color : 'transparent'}"></div></button>`; }).join('')}</div>`;
  const filters = `<div class="filters">${FILTERS.map(([label, items]) => `<div class="fgroup"><span class="tag">${label}</span>${items.map((f) => `<button class="chip ${S.filters[f] ? 'on' : ''}" data-act="filter" data-arg="${f}">${f}</button>`).join('')}<span class="sep"></span></div>`).join('')}<button class="reset ${act.length ? 'on' : ''}" data-act="resetf">RESTABLECER ${act.length ? '(' + act.length + ')' : ''}</button></div>`;
  return `<section class="planner">${strip}${filters}<div class="split"><div class="itin">${D.rows.length ? rItin(D) : rEmpty(D)}</div><div class="mapwrap" id="mapwrap">${rMapChrome(D)}</div></div>${rFoot(D)}${rSheet(D)}</section>`;
}
function rTrainBox(D) {
  if (D.window === 'halloween') return `<div class="trainbox one"><div><div class="k">TREN</div><div class="v">Sin vuelta · noche en Brooklyn</div><div class="s">Ida: ${D.out ? D.out[0] + ' Danbury → ' + D.out[1] + ' Grand Central' : '—'}. El domingo vuelven con el tren que quieran: 11:02, 14:02 o 17:02.</div></div></div>`;
  const o = D.out, b = D.back;
  return `<div class="trainbox"><div><div class="k">TREN DE IDA</div><div class="v">${o ? o[0] + ' → ' + o[1] : '—'}</div><div class="s">${o ? 'Danbury → Grand Central' + (o[2] ? ' · cambio en South Norwalk' : ' · directo') : 'Sin tren sugerido'}</div></div><div><div class="k">TREN DE VUELTA</div><div class="v">${b ? b[0] + ' → ' + b[1] : D.rows.some((r) => r.id === 'twa') ? 'TWA Hotel' : '—'}</div><div class="s">${b ? 'Grand Central → Danbury' + (b[2] ? ' · cambio en South Norwalk' : ' · directo') + (toMin(b[0]) >= 23 * 60 ? ' · último tren' : '') : D.rows.some((r) => r.id === 'twa') ? 'Noche junto a la Terminal 5 de JetBlue' : 'Sin tren sugerido'}</div></div></div>`;
}
function rItin(D) {
  const rows = D.rows, sel = S.sel;
  const segs = rows.filter((r) => r.conn), shortWalks = segs.filter((r) => r.conn.mode === 'walk' && r.conn.min <= 15).length, subway = segs.filter((r) => ['subway', 'lirr'].includes(r.conn.mode)).length;
  const head = `<div class="dayhead"><div class="row"><span class="eyebrow acc">DÍA ${String(D.num).padStart(2, '0')} · ${D.dow} ${D.label} · SEMANA 0${D.week}</span><span class="eyebrow">${D.win.label}</span></div>
    <h2>${esc(D.title).replace(/·|→/g, (m) => `<i>${m}</i>`)}</h2>
    <div class="stats"><div><b>${rows.length}</b><span>Actividades</span></div><div><b>${kmTxt(D.walkKm)}</b><span>A pie</span></div><div><b>${D.transit} min</b><span>Tránsito</span></div><div><b>${money(D.total)}</b><span>Estimado p/p</span></div></div>
    <div class="eff"><div class="row"><span>EFICIENCIA DE RUTA</span><b>${D.eff}%</b></div><div class="segs">${Array.from({ length: 10 }, (_, k) => `<i class="${k < Math.round(D.eff / 10) ? 'on' : ''}"></i>`).join('')}</div><p>${shortWalks} de ${segs.length} tramos son de menos de 15 min a pie${subway ? ' · ' + subway + ' en metro/LIRR' : ''}.</p></div>
    ${rTrainBox(D)}
    <button class="why" data-act="why"><div class="row"><span>¿POR QUÉ ESTA RUTA?</span><span>${S.whyOpen ? '−' : '+'}</span></div>${S.whyOpen ? `<p>${esc(D.why || '')}</p><div class="nums"><span><b>${kmTxt(D.walkKm)}</b> a pie</span><span><b>${D.transit} min</b> en tránsito</span><span>${D.wk ? 'fin de semana · off-peak' : 'entre semana'}</span></div>` : ''}</button></div>
    ${D.note ? `<div class="note" style="margin-top:16px">${esc(D.note)}</div>` : ''}`;
  const base = D.out ? `<div class="basecard"><span class="dia"></span><div><div class="n">Grand Central Terminal</div><div class="m">LLEGADA EN TREN ${D.out[1]}</div></div><div class="r">${(() => { const c = connect(TRIP.gct, rows[0], 0); return '↓ ' + c.label; })()}</div></div>` : '';
  const list = rows.map((r, k) => {
    const on = k === sel, ok = matches(r), c = r.conn;
    return `<div class="${ok ? '' : 'dimwrap'}"><button class="act ${on ? 'on' : ''} ${ok ? '' : 'dim'}" data-act="sel" data-arg="${k}"><div class="tcol"><span class="t">${r.t}</span><span class="num">${r.num}</span></div><div class="mid"><span class="tag">${esc(r.cat)}${r.mine ? ' · TU LISTA' : ''}</span><span class="name">${esc(r.name)}</span><span class="hood">${esc(r.hood)}</span><div class="meta"><span><span class="star">★</span> ${r.rating}</span><span class="mono">${esc(r.price)}</span><span style="display:inline-flex;align-items:center;gap:6px"><span class="dot" style="background:${CROWD[r.crowd]}"></span>${r.crowd}</span><span class="mono">${durTxt(r.dur)}</span></div></div><div class="end"><span class="e">${r.endT}</span><span class="d" data-act="detail" data-arg="${k}">Detalle</span></div></button>
    ${c ? `<button class="conn ${c.mode}" data-act="conn" data-arg="${k}"><div class="ln"><i></i></div><div class="lb"><span class="g">${{ walk: '↓', subway: '◉', uber: '◆', lirr: '◉' }[c.mode]}</span><span>${c.label}</span><span class="s">${c.sub}</span>${c.lines.map((l) => `<span class="bullet">${l}</span>`).join('')}<span class="pm">${S.conn === k ? '−' : '+'}</span></div></button>
    ${S.conn === k ? `<div class="conndet"><div><div class="k">SALIDA</div>${esc(r.name)} · ${r.endT}</div><div><div class="k">LLEGADA</div>${esc(rows[k + 1].name)} · ${rows[k + 1].t}</div><div><div class="k">DETALLE</div>${esc(c.detail)}</div><div><div class="k">COSTE</div>${c.cost ? '$' + c.cost.toFixed(2).replace('.', ',') + (c.mode === 'uber' ? ' por viaje' : ' por persona') : '—'}</div><a href="${dirUrl(r, rows[k + 1], c.mode === 'walk' ? 'walking' : c.mode === 'uber' ? 'driving' : 'transit')}" target="_blank" rel="noopener">Abrir indicaciones →</a></div>` : ''}` : ''}</div>`;
  }).join('');
  return head + `<div class="timeline">${base}${list}${rGap(D)}</div>`;
}
function rGap(D) {
  const last = D.rows[D.rows.length - 1]; if (!last || last.cat === 'Hotel' || last.cat === 'Club') return '';
  const limit = D.back ? (toMin(D.back[0]) < 300 ? toMin(D.back[0]) + 1440 : toMin(D.back[0])) - connect(last, TRIP.gct, last.end).min - 10 : toMin(D.win.end);
  const free = limit - last.end; if (free < 40) return '';
  const night = last.end >= 19.5 * 60;
  const cands = PLACES.filter((p) => !inDay(D.i, p.id) && !['Hotel', 'Club', 'Tránsito'].includes(p.cat) && p.dur <= free - 10 && p.dur > 0 && (!night || ['Bar', 'Jazz', 'Rooftop', 'Cena', 'Comedia', 'Mirador', 'Landmark', 'Paseo'].includes(p.cat)))
    .map((p) => ({ p, d: km(last, p) })).sort((a, b) => a.d - b.d).slice(0, 3);
  return `<div class="gap"><div class="row"><span class="eyebrow turq">${last.endT} → ${fmt(limit)} · TIENES ${durTxt(free)}${D.back ? ' ANTES DEL TREN DE ' + D.back[0] : ''}</span><span style="font-size:12px;color:var(--fg3)">${esc(last.hood)}</span></div><h3>¿Qué encaja aquí?</h3><div class="fits">${cands.map(({ p, d }) => `<button data-act="add" data-arg="${p.id}" data-day="${D.i}"><span class="n">${esc(p.name)}</span><span class="m">${durTxt(p.dur)} · ${d < 1.7 ? Math.max(3, Math.round(d / 4.6 * 60)) + ' min a pie' : Math.round(11 + d * 2.6) + ' min metro'}</span><span class="w">${esc(p.best)} · ${p.price}</span></button>`).join('')}</div><button class="btn ghost sm" data-act="go" data-arg="explore" style="align-self:flex-start">Explorar cerca</button></div>`;
}
function rEmpty(D) {
  const isArr = D.window === 'arrival', isDep = D.window === 'departure';
  return `<div class="empty"><span class="eyebrow acc">DÍA ${String(D.num).padStart(2, '0')} · ${D.dow} ${D.label} · SEMANA 0${D.week}</span><h2>${esc(D.title)}</h2>
  <div class="box"><div class="eyebrow turq">${D.win.label}${isArr ? ' · JFK 20:59' : isDep ? ' · JFK 06:00' : ' · DÍA SIN PLANIFICAR'}</div><h3>${isArr ? 'Del avión al tren.' : isDep ? 'Hasta la próxima, Nueva York.' : 'Nada encaja aquí todavía.'}</h3><p>${esc(D.note || 'Empieza por una ancla (un museo, una cena con reserva) y el sistema arma la ruta alrededor.')}</p>
  ${isArr ? rTrainBox({ ...D, out: null, back: TRAINS.weekend.toDanbury[7] }) : ''}
  <div class="row">${isArr ? `<a class="btn ghost sm" href="https://www.google.com/maps/dir/?api=1&origin=JFK+Terminal+5&destination=Grand+Central+Madison&travelmode=transit" target="_blank" rel="noopener">AirTrain + LIRR →</a><a class="btn ghost sm" href="https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[formatted_address]=1+Waterview+Dr+Danbury+CT" target="_blank" rel="noopener">Uber a Danbury →</a>` : isDep ? `<a class="btn ghost sm" href="https://www.jetblue.com" target="_blank" rel="noopener">JetBlue · ${TRIP.confirmation} →</a>` : `<button class="btn ghost sm" data-act="go" data-arg="explore">Explorar</button>`}<button class="btn sm" data-act="openday" data-arg="${isDep ? 14 : 1}">${isDep ? 'Volver al día 15' : 'Ir al día 02'}</button></div></div></div>`;
}
function rMapChrome(D) {
  const sel = D.rows[S.sel];
  return `<div class="layers">${Object.keys(S.layers).map((l) => `<button class="${S.layers[l] ? 'on' : ''}" data-act="layer" data-arg="${l}">${l}</button>`).join('')}</div>
  <div class="mctl"><button data-act="zoom" data-arg="1">+</button><button data-act="zoom" data-arg="-1">−</button><button data-act="recenter" title="Recentrar"><span class="c"></span></button></div>
  <div class="legend"><span><i class="w"></i>A PIE</span><span><i class="m"></i>METRO</span><span><i class="u"></i>UBER</span></div>
  ${sel ? `<div class="mnow"><div style="background:rgba(12,12,16,.85);color:#F2EFE9;padding:8px 12px;border:1px solid rgba(255,255,255,.1);display:flex;flex-direction:column;gap:2px"><span class="eyebrow" style="color:#C8775A">DÍA ${String(D.num).padStart(2, '0')} · ${sel.num} DE ${D.rows.length}</span><span style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(sel.name)}${sel.conn ? ' · ' + sel.conn.label.toLowerCase() : ''}</span></div></div>` : ''}
  ${S.detail != null && S.screen === 'planner' ? rDrawer(S.detail, false) : ''}`;
}
function rFoot(D) {
  return `<div class="footstats"><span>A PIE <b>${kmTxt(D.walkKm).toUpperCase()}</b></span><span>TRÁNSITO <b>${D.transit} MIN</b></span><span>ESTIMADO <b>${money(D.total)} P/P</b></span><span style="display:inline-flex;align-items:center;gap:8px">MULTITUD <span class="dot" style="background:${CROWD[D.crowd]}"></span><b>${D.crowd.toUpperCase()}</b></span><button data-act="budget">PRESUPUESTO DEL DÍA ${S.budget ? '−' : '+'}</button></div>
  ${S.budget ? `<div class="budget"><div><div class="k">COMIDA</div><div class="v">${money(D.costs.Comida)}</div></div><div><div class="k">ACTIVIDADES</div><div class="v">${money(D.costs.Actividades)}</div></div><div><div class="k">TRANSPORTE</div><div class="v">${money(D.costs.Transporte)}</div></div><div><div class="k">COMPRAS</div><div class="v">${money(D.costs.Compras)}</div></div><div class="tot"><div class="k">TOTAL P/P · ×2 = ${money(D.total * 2)}</div><div class="v">${money(D.total)}</div></div></div>` : ''}`;
}
function rSheet(D) {
  const sel = S.sel;
  return `<div class="sheet ${S.sheetFull ? 'full' : ''}"><button class="handle" data-act="sheet"><i></i><div class="row"><span>DÍA ${String(D.num).padStart(2, '0')} · ${D.rows.length ? (sel + 1) + ' DE ' + D.rows.length : D.win.label}</span><span>${D.dow} ${D.label}</span></div><h3>${esc(D.title)}</h3></button>
  <div class="list">${D.rows.map((r, k) => `<div class="${k < sel ? 'done' : ''} ${k === sel ? 'on' : ''}" data-act="sel" data-arg="${k}"><span class="t">${r.t}</span><div><div class="n">${esc(r.name)}</div><div class="m">${k === sel ? 'Ahora · ' : ''}${durTxt(r.dur)} · ${esc(r.price)} · ${r.crowd}</div></div><span class="nx">${k === sel ? 'AHORA' : r.conn ? ({ walk: '↓ A PIE', subway: '↓ METRO', uber: '↓ UBER', lirr: '↓ LIRR' }[r.conn.mode]) : ''}</span></div>`).join('') || `<div style="padding:12px 0;font-size:13px;color:var(--fg2)">${esc(D.note || 'Sin actividades.')}</div>`}</div>
  <div class="hint" data-act="sheet">${S.sheetFull ? '↓ TOCA PARA VER EL MAPA' : '↑ TOCA PARA EL ITINERARIO'}</div></div>`;
}
function rDrawer(key, fixed) {
  let p, r = null, D = null;
  if (typeof key === 'number') { D = buildDay(S.day); r = D.rows[key]; p = r; } else p = BY_ID[key];
  if (!p) return '';
  const prev = r && r.i > 0 ? D.rows[r.i - 1] : null, prevConn = r ? (prev ? prev.conn : (D.out ? connect(TRIP.gct, r, 0) : null)) : null;
  const img = { Museo: 'bryant', Parque: 'bryant', Mirador: 'skyline', Rooftop: 'skyline', Club: 'skyline', Barrio: 'street', Compras: 'street', Landmark: 'street', Foto: 'taxi', Paseo: 'skyline' }[p.cat] || 'taxi';
  const inThis = inDay(S.day, p.id), savedOn = S.savedIds.includes(p.id);
  const fc = p.forecast || [0, 0, 0, 0, 0, 0, 0], pop = Math.round(fc.reduce((a, b) => a + b, 0) / 28 * 10);
  return `<aside class="drawer ${fixed ? 'fixed' : ''}"><div class="ph"><div class="img" style="background-image:url(assets/${img}.jpg)"></div><div class="sh"></div><button class="x" data-act="close">×</button><div class="cap">${r ? `<span class="num">${r.num}</span><span>${r.t} — ${r.endT} · ${esc(p.cat).toUpperCase()}</span>` : `<span>${esc(p.cat).toUpperCase()}${p.mine ? ' · TU LISTA' : ''}</span>`}</div></div>
  <div class="body"><div><h3>${esc(p.name)}</h3><div class="sub">${esc(p.hood)} · ${esc(p.addr)}</div><div class="meta"><span><span class="star">★</span> ${p.rating}</span><span class="mono">${esc(p.price)}</span><span style="display:inline-flex;align-items:center;gap:6px"><span class="dot" style="background:${CROWD[p.crowd]}"></span>${p.crowd}</span>${p.dur ? `<span class="mono">${durTxt(p.dur)}</span>` : ''}</div></div>
  <p class="desc">${esc(p.desc)}</p>
  <div class="grid"><div><div class="k">HORARIO</div>${esc(p.hours)}</div><div><div class="k">MEJOR MOMENTO</div>${esc(p.best)}</div><div><div class="k">RESERVA</div>${esc(p.booking)}</div><div><div class="k">COSTE EST. P/P</div><span class="mono">${p.cost ? money(p.cost) : 'Gratis'}</span></div></div>
  <div class="tip"><div class="k">CONSEJO</div><p>${esc(p.tip)}</p></div>
  <div class="fc"><div class="row"><span>PRONÓSTICO DE MULTITUD</span><span>POPULARIDAD ${'█'.repeat(pop)}${'░'.repeat(10 - pop)}</span></div><div class="bars">${fc.map((v, k) => `<div><i style="height:${v === 0 ? 6 : v * 25}%;background:${['var(--s4)', 'var(--green)', 'var(--sand)', 'var(--acc2)', '#C23B2E'][v]}"></i><span>${['09', '11', '13', '15', '17', '19', '21'][k]}</span></div>`).join('')}</div></div>
  ${r ? `<div class="route"><div class="k">RUTA</div><div class="g"><span class="p"></span><span style="color:var(--fg2)">${esc(prev ? prev.name : 'Grand Central Terminal')}</span><span class="l"></span><span class="lb">${prevConn ? prevConn.label : '—'}</span><span class="c"></span><span style="font-weight:500">${esc(p.name)}</span></div></div>` : ''}
  <div class="actions"><a class="btn full" href="${r ? dirUrl(prev || TRIP.gct, p, prevConn && prevConn.mode === 'walk' ? 'walking' : 'transit') : p.maps}" target="_blank" rel="noopener">${r ? 'Indicaciones' : 'Abrir en Google Maps'}</a>
  ${r ? `<a class="btn ghost" href="${p.maps}" target="_blank" rel="noopener">Google Maps</a>` : ''}${p.link ? `<a class="btn ghost" href="${p.link}" target="_blank" rel="noopener">Entradas / web</a>` : ''}
  <button class="btn ghost" data-act="save" data-arg="${p.id}">${savedOn ? '★ Guardado' : 'Guardar'}</button>
  ${r ? `<button class="btn ghost" data-act="move" data-arg="-1">↑ Antes</button><button class="btn ghost" data-act="move" data-arg="1">↓ Después</button><button class="btn link full" data-act="remove" data-arg="${p.id}">Quitar del día</button>` : inThis ? `<button class="btn ghost full" data-act="openday" data-arg="${S.day}">Ya está en el día ${String(S.day + 1).padStart(2, '0')} →</button>` : `<button class="btn ghost full" data-act="add" data-arg="${p.id}" data-day="${S.addTo ?? S.day}">+ Añadir al día ${String((S.addTo ?? S.day) + 1).padStart(2, '0')}</button>`}
  </div></div></aside>`;
}

// ── Explorar ──
function rExplore() {
  const D = buildDay(S.day), tgt = S.addTo ?? S.day;
  const modeOk = (p) => S.xmode === 'Todo' || (S.xmode === 'Comida' ? tagsOf(p).includes('Comida') : S.xmode === 'Compras' ? tagsOf(p).includes('Compras') : S.xmode === 'Noche' ? tagsOf(p).includes('Nocturno') : true);
  const distToRoute = (p) => D.rows.length ? Math.min(...D.rows.map((r) => km(r, p))) : km(TRIP.gct, p);
  const card = (p) => { const d = distToRoute(p), inD = inDay(tgt, p.id); return `<button class="card" data-act="xdetail" data-arg="${p.id}"><div class="img"><span class="ini">${esc(p.name[0])}</span><span class="dist">${d < 1.7 ? Math.max(3, Math.round(d / 4.6 * 60)) + ' MIN A PIE' : Math.round(11 + d * 2.6) + ' MIN METRO'}</span>${p.mine ? '<span class="mine">DE TU LISTA</span>' : ''}</div><div class="bd"><span class="tag">${esc(p.cat)} · ${esc(p.hood)}</span><span class="n">${esc(p.name)}</span><span class="h">${esc(p.best)}</span><div class="m"><span><span class="star">★</span> ${p.rating}</span><span class="mono">${esc(p.price)}</span><span style="display:inline-flex;align-items:center;gap:5px"><span class="dot" style="background:${CROWD[p.crowd]}"></span>${p.crowd}</span><span class="add ${inD ? 'in' : ''}" data-act="${inD ? 'openday' : 'add'}" data-arg="${inD ? tgt : p.id}" data-day="${tgt}">${inD ? '✓ Día ' + String(tgt + 1).padStart(2, '0') : '+ Día ' + String(tgt + 1).padStart(2, '0')}</span></div></div></button>`; };
  const sec = (title, meta, items) => items.length ? `<div class="xsec"><div class="h"><h2>${title}</h2><span class="eyebrow">${meta}</span></div><div class="cards">${items.map(card).join('')}</div></div>` : '';
  const mine = PLACES.filter((p) => p.mine && modeOk(p));
  const near = PLACES.filter((p) => !inDay(S.day, p.id) && !['Hotel', 'Club'].includes(p.cat) && modeOk(p)).map((p) => ({ p, d: distToRoute(p) })).filter((x) => x.d <= 1.3).sort((a, b) => a.d - b.d).map((x) => x.p);
  const gems = PLACES.filter((p) => !p.mine && p.crowd === 'Baja' && p.rating >= 4.6 && modeOk(p));
  const night = PLACES.filter((p) => ['Bar', 'Jazz', 'Rooftop', 'Comedia', 'Teatro', 'Club'].includes(p.cat) && modeOk(p));
  const savedP = S.savedIds.map((id) => BY_ID[id]).filter(Boolean).filter(modeOk);
  const hoods = [...new Set(D.rows.map((r) => r.hood).filter((h) => HAPPY_HOUR.hoods[h]))];
  const daySel = `<select data-act="addto" style="background:var(--s2);color:var(--fg);border:1px solid var(--line2);font:inherit;font-size:12px;padding:6px 8px;border-radius:2px">${DAYS.map((d, i) => `<option value="${i}" ${i === tgt ? 'selected' : ''}>Día ${String(i + 1).padStart(2, '0')} · ${dayLabel(d.date)} · ${esc(d.title)}</option>`).join('')}</select>`;
  return `<section class="rise" style="display:flex;flex-direction:column">
  <div class="xhero"><img src="assets/bryant.jpg" alt=""><div class="sh"></div><div class="in"><div><span class="eyebrow" style="color:rgba(242,239,233,.65)">EXPLORAR NYC · RUTA DEL DÍA ${String(S.day + 1).padStart(2, '0')}</span><h1>Encuentra algo por lo que valga la pena <em>bajarse del tren.</em></h1><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="eyebrow" style="color:rgba(242,239,233,.65)">AÑADIR A</span>${daySel}</div></div>
    <div class="modes">${[['Todo', 'explore'], ['Comida', 'explore'], ['Compras', 'explore'], ['Noche', 'explore'], ['Foto', 'photo']].map(([l, s]) => `<button class="${S.xmode === l && s === 'explore' ? 'on' : ''}" data-act="${s === 'photo' ? 'go' : 'xmode'}" data-arg="${s === 'photo' ? 'photo' : l}">${l}</button>`).join('')}</div></div></div>
  ${sec('Tu lista de Google Maps', mine.length + ' LUGARES · ' + mine.filter((p) => DAYS.some((_, i) => inDay(i, p.id))).length + ' YA EN EL PLAN', mine)}
  ${sec('Cerca de tu ruta', 'A < 15 MIN DE LA RUTA DEL DÍA ' + String(S.day + 1).padStart(2, '0'), near)}
  ${savedP.length ? sec('Guardados', savedP.length + ' LUGARES', savedP) : ''}
  ${sec('Joyas escondidas', 'ALTA VALORACIÓN · BAJA MULTITUD', gems)}
  ${sec('Mejor esta noche', 'ABIERTO HASTA TARDE', night)}
  <div class="xsec"><div class="h"><h2>Happy hours</h2><span class="eyebrow">5PM.NYC · 2.600 BARES · POR BARRIO Y HORA</span><a href="${HAPPY_HOUR.site}" target="_blank" rel="noopener">Abrir 5pm.nyc →</a></div><div class="hh"><p>5pm.nyc lista las ofertas de happy hour de cada bar con horario y día; filtra por "HH Now" para ver las activas. Barrios de la ruta del día ${String(S.day + 1).padStart(2, '0')}:</p>${(hoods.length ? hoods : ['Midtown East', 'West Village', 'East Village', 'Lower East Side', 'Williamsburg']).map((h) => `<a href="${hhLink(h)}" target="_blank" rel="noopener">${esc(h)} →</a>`).join('')}<a href="${HAPPY_HOUR.site}/midtown-east/" target="_blank" rel="noopener">Cerca de Grand Central →</a></div></div>
  </section>`;
}

// ── Modo foto ──
function rPhoto() {
  const di = S.photoDay ?? S.day, iso = DAYS[di].date, sun = sunTimes(iso), on = Object.keys(S.photoF).filter((k) => S.photoF[k]);
  const spots = PHOTO_SPOTS.map((s) => { const p = BY_ID[s.id], t = typeof sun[s.when] === 'number' ? sun[s.when] : toMin(s.when); return { ...s, p, t, ok: on.length === 0 || on.some((f) => s.tags.includes(f)) }; }).sort((a, b) => a.t - b.t);
  const cur = spots.find((s) => s.id === S.photoSel) || spots[0];
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
  const img = { dumbo: 'taxi', edge: 'skyline', topofrock: 'skyline', bbpark: 'skyline', queensbridge: 'skyline', gantry: 'skyline', brooklynheights: 'skyline', highline: 'bryant', tkts: 'street', gct: 'street', soho: 'street', chinatown: 'street', tudor: 'street', oculus: 'bryant', moynihan: 'bryant' }[cur.id] || 'taxi';
  return `<section class="photo rise"><div class="phero"><img src="assets/${img}.jpg" alt=""><div class="sh"></div>
    <div class="pf">${PHOTO_FILTERS.map((f) => `<button class="${S.photoF[f] ? 'on' : ''}" data-act="photof" data-arg="${f}">${f}</button>`).join('')}</div>
    <div class="in"><span class="eyebrow" style="color:#C9A87A">MODO FOTO · ${esc(cur.kind)} · DÍA ${String(di + 1).padStart(2, '0')}</span><h1>${esc(cur.p.name)}<em>${esc(cur.p.hood)} · ${esc(cur.p.addr)}</em></h1>
    <div class="pgrid"><div><div class="k">MEJOR LUZ</div><div class="v">${fmt(cur.t)}</div></div><div><div class="k">${cur.tags[0].toUpperCase()}</div><div class="s">${stars(cur.stars)}</div></div><div><div class="k">MULTITUD</div><div style="font-size:14px;margin-top:6px;display:flex;align-items:center;gap:7px"><span class="dot" style="background:${CROWD[cur.p.crowd]}"></span>${cur.p.crowd}</div></div><div><div class="k">CONSEJO</div><div style="font-size:12.5px;margin-top:5px;line-height:1.35">${esc(cur.p.tip)}</div></div></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn sm" href="${cur.p.maps}" target="_blank" rel="noopener" style="background:#F2EFE9;color:#0C0C10">Abrir en Maps</a><button class="btn ghost sm" data-act="xdetail" data-arg="${cur.id}" style="color:#F2EFE9;border-color:rgba(242,239,233,.35)">Detalle</button></div></div></div>
  <div class="pside"><div class="sun"><span class="eyebrow">LUZ · ${dow(iso)} ${dayLabel(iso)}${iso >= '2026-11-01' ? ' · HORARIO DE INVIERNO' : ''}</span>
    <div class="g"><div><b>${fmt(sun.sunrise)}</b><span>Amanecer</span></div><div><b>${fmt(sun.golden)}</b><span>Hora dorada</span></div><div><b>${fmt(sun.sunset)}</b><span>Atardecer</span></div><div><b>${fmt(sun.blue)}</b><span>Hora azul</span></div></div><div class="grad"></div>
    <div class="daysel">${DAYS.map((d, i) => `<button class="${i === di ? 'on' : ''}" data-act="photoday" data-arg="${i}">${dayLabel(d.date)}</button>`).join('')}</div></div>
  <div class="spots">${spots.map((s) => `<button class="spot ${s.id === cur.id ? 'on' : ''} ${s.ok ? '' : 'dim'}" data-act="photosel" data-arg="${s.id}"><span class="t">${fmt(s.t)}</span><div class="mid"><span class="tag">${esc(s.kind)}</span><span class="n">${esc(s.p.name)}</span><span class="h">${esc(s.p.hood)}${DAYS.some((_, i) => inDay(i, s.id)) ? ' · en el plan' : ''}</span></div><div class="end"><span class="st">${stars(s.stars)}</span><span class="cr"><span class="dot" style="background:${CROWD[s.p.crowd]}"></span>${s.p.crowd}</span></div></button>`).join('')}</div></div></section>`;
}

// ── Halloween ──
function rHalloween() {
  const D = buildDay(7), clubs = ['circoloco', 'elsewhere', 'nowadays', 'publicrecords'].map((i) => BY_ID[i]), roofs = ['phd', 'refinery', 'superior', 'mrpurple'].map((i) => BY_ID[i]);
  const card = (p) => `<div class="hw-card"><span class="tag">${esc(p.cat)} · ${esc(p.hood)}${inDay(7, p.id) ? ' · EN EL PLAN' : ''}</span><div class="n">${esc(p.name)}</div><div class="h">${esc(p.addr)}</div><p>${esc(p.desc)}</p><div class="m"><span>${esc(p.hours)}</span><span>${esc(p.price)}</span><span>${esc(p.booking).toUpperCase()}</span></div><div class="links"><a href="${p.link || p.maps}" target="_blank" rel="noopener">Entradas →</a><a href="${p.maps}" target="_blank" rel="noopener">Maps →</a><button style="color:var(--fg2);font-size:11px;letter-spacing:.12em;text-transform:uppercase" data-act="xdetail" data-arg="${p.id}">Detalle</button>${inDay(7, p.id) ? `<button style="color:var(--fg3);font-size:11px;letter-spacing:.12em;text-transform:uppercase" data-act="remove" data-arg="${p.id}" data-day="7">Quitar</button>` : `<button style="color:var(--acc);font-size:11px;letter-spacing:.12em;text-transform:uppercase" data-act="add" data-arg="${p.id}" data-day="7">+ Al plan</button>`}</div></div>`;
  return `<section class="rise"><div class="hw-hero"><img src="assets/street.jpg" alt=""><div class="sh"></div><div class="in"><span class="eyebrow" style="color:#E07B60">SÁBADO 31 DE OCTUBRE · DÍA 08 · NOCHE EN NYC</span><h1>Halloween <em>sin tren de vuelta.</em></h1><p>Clubs de house y techno en Brooklyn más un rooftop con disfraz en Manhattan. Hotel en Williamsburg, taxi entre fiestas y el domingo un tren a la hora que sea.</p><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" data-act="openday" data-arg="7" style="background:#F2EFE9;color:#0C0C10">Ver el día 08 en el mapa</button><a class="btn ghost" href="https://www.circoloco.com" target="_blank" rel="noopener" style="color:#F2EFE9;border-color:rgba(242,239,233,.35)">Entradas Circoloco →</a></div></div></div>
  <div class="hw-plan"><div><span class="eyebrow acc">EL PLAN · HORA A HORA</span><div class="hw-tl">${D.rows.map((r) => `<div><span class="t">${r.t}</span><div><div class="n">${esc(r.name)}</div><div class="m">${esc(r.hood)} · ${durTxt(r.dur)} · ${esc(r.price)}${r.conn ? ' · luego ' + r.conn.label.toLowerCase() : ''}</div></div></div>`).join('')}<div><span class="t">~06:00</span><div><div class="n">Cierre del Storehouse</div><div class="m">Taxi al hotel (10 min). Domingo: brunch tarde y tren a Danbury a las 11:02, 14:02 o 17:02 (llegan 13:11 / 16:11 / 19:11).</div></div></div></div>
    <div class="hw-logi"><div><b>DÓNDE DORMIR</b>Williamsburg, Wythe Ave: Wythe Hotel, The William Vale o Moxy Williamsburg. Todo queda a 10 min en taxi del Brooklyn Storehouse y a 15 de Elsewhere y Nowadays. Reserven ya: Halloween en sábado se agota.</div><div><b>MOVERSE</b>Entre fiestas, Uber/Lyft ($15-25 por tramo). Metro L y G corren toda la noche si quieren ahorrar. Desde PHD (Meatpacking) al Storehouse: 20-25 min en taxi por el Williamsburg Bridge.</div><div><b>DISFRACES</b>Abracadabra NYC (19 W 21st St, Flatiron) y Halloween Adventure (104 4th Ave) son las tiendas clásicas; cómprenlos el miércoles 28, que están en Chelsea. Cómodo: son 8 horas de pie.</div><div><b>ENTRADAS</b>Circoloco (sábado: Dixon, ANOTR, Jimi Jules, Rossi, KROL) va primero: se agotó rápido en 2025. Elsewhere y PHD como respaldo. Todo 21+ con pasaporte físico.</div></div></div>
  <div><span class="eyebrow acc">CLUBS · HOUSE Y TECHNO</span><div class="hw-cards">${clubs.map(card).join('')}</div><span class="eyebrow sand" style="display:block;margin-top:34px">ROOFTOPS · CÓCTELES CON DISFRAZ</span><div class="hw-cards">${roofs.map(card).join('')}</div><span class="eyebrow" style="display:block;margin-top:34px">CALENTAMIENTO · GRATIS</span><div class="hw-cards">${card(BY_ID.parade)}</div></div></div>
  <div class="section" style="border-top:1px solid var(--line)"><div class="section-h"><h2>Viernes 30 también cuenta</h2><span class="eyebrow">CIRCOLOCO NOCHE 1</span></div><p style="font-size:14px;color:var(--fg2);line-height:1.55;max-width:720px">El viernes 30 tocan Seth Troxler, Rampa, &amp;ME, Carlita, Mochakk, Konstantin, Beltran y MAP.ACHE en el mismo Storehouse. Si prefieren ese cartel, cambien la noche de hotel al viernes: el último tren a Danbury sale 23:28 y Circoloco va de 22:00 a 06:00, así que también es noche en Brooklyn.</p></div></section>`;
}

// ───────────────────────── mapa (Leaflet) ─────────────────────────
let map, tiles = {}, mapLayers = { route: null, markers: [] };
const mapEl = document.createElement('div'); mapEl.id = 'map';
function mountMap() {
  const wrap = $('#mapwrap'); if (!wrap) return;
  wrap.insertBefore(mapEl, wrap.firstChild);
  if (!map) {
    map = L.map(mapEl, { zoomControl: false, attributionControl: true }).setView([40.74, -73.98], 12);
    tiles = { osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }), sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: '&copy; Esri' }) };
    map.on('click', () => { if (S.detail != null) set({ detail: null }); });
  }
  Object.values(tiles).forEach((t) => map.removeLayer(t));
  (S.layers['Satélite'] ? tiles.sat : tiles.osm).addTo(map);
  mapEl.classList.toggle('dark', S.theme === 'dark' && !S.layers['Satélite']);
  updateMap();
  setTimeout(() => map.invalidateSize(), 50);
}
let lastDay = -1;
function updateMap() {
  if (!map) return;
  const D = buildDay(S.day);
  if (mapLayers.route) map.removeLayer(mapLayers.route); mapLayers.markers.forEach((m) => map.removeLayer(m)); mapLayers.markers = [];
  const g = L.layerGroup().addTo(map); mapLayers.route = g;
  if (S.layers.Ruta) D.rows.forEach((r, k) => { if (!r.conn) return; const n = D.rows[k + 1], c = r.conn; const line = L.polyline([[r.lat, r.lng], [n.lat, n.lng]], { color: c.mode === 'subway' ? '#0039A6' : c.mode === 'uber' ? '#C9A87A' : c.mode === 'lirr' ? '#2F8FA0' : '#C8775A', weight: c.mode === 'walk' ? 2.5 : 4, dashArray: c.mode === 'walk' ? '2 7' : c.mode === 'uber' ? '10 7' : null, opacity: .85, lineCap: 'round' }).addTo(g); line.bindTooltip(c.label + ' · ' + c.sub, { sticky: true, className: 'segtip', direction: 'top' }); line.on('click', () => set({ conn: k, sel: k + 1 })); });
  if (D.out || S.day === 0) { const b = L.marker([TRIP.gct.lat, TRIP.gct.lng], { icon: L.divIcon({ className: 'mk base', html: '<i></i><span>GRAND CENTRAL</span>', iconSize: [90, 40], iconAnchor: [45, 8] }), interactive: false }).addTo(map); mapLayers.markers.push(b); }
  D.rows.forEach((r, k) => {
    const on = k === S.sel, ok = matches(r);
    const bg = S.layers.Multitud ? CROWD[r.crowd] : '';
    const m = L.marker([r.lat, r.lng], { icon: L.divIcon({ className: 'mk ' + (on ? 'on' : '') + (ok ? '' : ' dim'), html: (on ? '<span class="pulse"></span>' : '') + `<b style="${bg ? 'background:' + bg + ';color:#fff' : ''}">${r.num}</b>`, iconSize: [44, 44], iconAnchor: [22, 22] }), zIndexOffset: on ? 1000 : 0 }).addTo(map);
    m.on('click', (e) => { L.DomEvent.stop(e); set({ sel: k, detail: null }); });
    if (on && S.detail == null) m.bindTooltip(`<div class="mlabel"><b>${esc(r.name)}</b><span>${r.t} · ${durTxt(r.dur)} · ${r.crowd.toUpperCase()}</span></div>`, { permanent: true, direction: 'top', offset: [0, -16], className: 'mlabel', interactive: false }).openTooltip();
    mapLayers.markers.push(m);
  });
  if (lastDay !== S.day) { lastDay = S.day; recenter(); }
}
function recenter() {
  const D = buildDay(S.day); if (!map) return;
  if (D.rows.length) map.fitBounds(L.latLngBounds(D.rows.map((r) => [r.lat, r.lng])), { paddingTopLeft: [50, 110], paddingBottomRight: [50, S.mview === 'map' && innerWidth <= 860 ? Math.round(innerHeight * 0.42) : 60], maxZoom: 15 }); else map.setView([40.74, -73.98], 12);
}

// ───────────────────────── acciones ─────────────────────────
const toast = (msg) => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 1800); };
function addToDay(di, id) {
  if (inDay(di, id)) return toast('Ya está en el día ' + (di + 1));
  const acts = [...dayActs(di)], p = BY_ID[id];
  let t;
  if (acts.length) { const last = buildDay(di).rows.slice(-1)[0]; t = fmt(last.end + connect(last, p, last.end).min + 5); } else t = DAYS[di].window === 'after' ? '16:00' : '10:30';
  acts.push([id, t]); setDayActs(di, acts); toast('Añadido al día ' + (di + 1) + ' a las ' + t); set({ detail: null });
}
const ACTIONS = {
  go: (a) => set({ screen: a, detail: null, mview: 'list' }),
  mgo: (a) => a === 'map' ? (set({ screen: 'planner', mview: 'map', detail: null }), recenter()) : set({ screen: a, mview: 'list', detail: null }),
  openday: (a) => { S.day = +a; persist(); set({ screen: 'planner', sel: 0, detail: null, conn: null, mview: S.screen === 'planner' ? S.mview : 'list' }); window.scrollTo({ top: 0 }); },
  theme: () => { S.theme = S.theme === 'dark' ? 'light' : 'dark'; persist(); render(); },
  filter: (a) => set({ filters: { ...S.filters, [a]: !S.filters[a] } }),
  resetf: () => set({ filters: {} }),
  sel: (a) => set({ sel: +a, detail: null }),
  detail: (a, el, e) => { e.stopPropagation(); set({ sel: +a, detail: +a }); },
  xdetail: (a, el, e) => { e.stopPropagation(); set({ detail: a }); },
  close: () => set({ detail: null }),
  conn: (a) => set({ conn: S.conn === +a ? null : +a }),
  why: () => set({ whyOpen: !S.whyOpen }),
  budget: () => set({ budget: !S.budget }),
  layer: (a) => { S.layers[a] = !S.layers[a]; render(); },
  zoom: (a) => map && map.zoomIn(+a > 0 ? 1 : -1),
  recenter: () => recenter(),
  sheet: () => set({ sheetFull: !S.sheetFull }),
  xmode: (a) => set({ xmode: a }),
  addto: (a) => set({ addTo: +a }),
  photof: (a) => set({ photoF: { ...S.photoF, [a]: !S.photoF[a] } }),
  photoday: (a) => set({ photoDay: +a }),
  photosel: (a) => set({ photoSel: a }),
  save: (a) => { S.savedIds = S.savedIds.includes(a) ? S.savedIds.filter((x) => x !== a) : [...S.savedIds, a]; persist(); toast(S.savedIds.includes(a) ? 'Guardado' : 'Quitado de guardados'); render(); },
  add: (a, el, e) => { e.stopPropagation(); addToDay(+(el.dataset.day ?? S.day), a); },
  remove: (a, el) => { const di = +(el.dataset.day ?? S.day); setDayActs(di, dayActs(di).filter(([id]) => id !== a)); toast('Quitado del día ' + (di + 1)); set({ detail: null, sel: 0 }); },
  move: (a) => { const acts = [...dayActs(S.day)], i = S.sel, j = i + (+a); if (j < 0 || j >= acts.length) return; [acts[i], acts[j]] = [acts[j], acts[i]]; const t = acts[i][1]; acts[i][1] = acts[j][1]; acts[j][1] = t; setDayActs(S.day, acts); set({ sel: j, detail: j }); },
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el || el.tagName === 'SELECT') return;
  const fn = ACTIONS[el.dataset.act]; if (fn) fn(el.dataset.arg, el, e);
});
document.addEventListener('change', (e) => { const el = e.target.closest('select[data-act]'); if (el) ACTIONS[el.dataset.act](el.value, el, e); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.detail != null) set({ detail: null }); });
// Hoja inferior: arrastrar arriba/abajo
let touchY = null;
document.addEventListener('touchstart', (e) => { const h = e.target.closest('.sheet .handle'); touchY = h ? e.touches[0].clientY : null; }, { passive: true });
document.addEventListener('touchend', (e) => { if (touchY == null) return; const dy = e.changedTouches[0].clientY - touchY; touchY = null; if (dy < -40 && !S.sheetFull) set({ sheetFull: true }); else if (dy > 40 && S.sheetFull) set({ sheetFull: false }); }, { passive: true });
window.addEventListener('resize', () => { if (map) map.invalidateSize(); });
window.addEventListener('hashchange', () => { const s = location.hash.replace('#', ''); if (SCREENS.some(([id]) => id === s) && s !== S.screen) set({ screen: s }); });

// ponytail: auto-chequeo mínimo en consola (falla si el modelo del día se rompe)
console.assert(buildDay(1).rows.length === 8 && buildDay(1).out && buildDay(1).back, 'día 2 debe tener 8 actividades y trenes');
console.assert(fmt(toMin('23:28') + 121) === '01:29', 'aritmética de horas');
render();
