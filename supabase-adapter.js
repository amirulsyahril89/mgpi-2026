// Adapter: meniru google.script.run supaya index.html tidak banyak berubah.
const SUPABASE_URL = 'https://bdzffqkecparivxaetdw.supabase.co/rest/v1';      // <-- tukar
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkemZmcWtlY3Bhcml2eGFldGR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3ODQzNjMsImV4cCI6MjEwODM2MDM2M30.qEh5jivExOorBYuJJ5NPU4Nq38FSoNq2-FEf9DhN59k';      // <-- tukar (anon key selamat didedahkan, RLS melindungi data)
const MAIN_ADMIN = 'amirsyah.1989@gmail.com';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const EVENT_CONFIG = {
  "Tilawah al-Quran": ["Tajwid (35)", "Tarannum (30)", "Fasahah (20)", "Suara (15)"],
  "Hafazan al-Quran": ["Hafaz & Lancar (40)", "Tajwid (30)", "Fasahah (20)", "Suara & Gaya (10)"],
  "Tahfiz al-Quran (Juzuk 1-10)": ["Hafaz & Lancar (40)", "Tajwid (30)", "Fasahah (20)", "Suara & Gaya (10)"],
  "Nasyid": ["Suara (35)", "Lagu (20)", "Persembahan (15)", "Muzik (15)", "Lirik (15)"],
  "Podcast": ["Penyampaian (25)", "Isi (45)", "Bahasa (30)"],
  "Tik Tok": ["Kreativiti & Persembahan (30)", "Penggunaan AI (10)", "Kandungan (35)", "Kualiti Video (25)"]
};

let me = { email: '', role: null, assignedEvent: 'Semua' };

// Lemparkan ralat Supabase supaya ditangkap withFailureHandler
async function q(promise) {
  const { data, error } = await promise;
  if (error) { const e = new Error(error.message); e.code = error.code; throw e; }
  return data;
}
// Escape semua '<' kecuali tag <strong> (pertahanan XSS untuk input awam)
const clean = s => String(s ?? '').trim().replace(/<(?!\/?strong>)/g, '&lt;');

function mountAuthButton(loggedIn) {
  let b = document.getElementById('btn-auth');
  if (!b) {
    b = document.createElement('button');
    b.id = 'btn-auth';
    b.className = 'text-[10px] font-bold bg-emerald-600 text-white px-3 py-1 rounded-full shadow-sm whitespace-nowrap';
    document.getElementById('user-info-display').parentElement.after(b);
  }
  b.textContent = loggedIn ? 'Log Keluar' : 'Log Masuk Juri/Admin';
  b.onclick = loggedIn
    ? () => sb.auth.signOut().then(() => location.reload())
    : () => sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
}

const api = {
  async getAppConfig() {
    const { data: { session } } = await sb.auth.getSession();
    mountAuthButton(!!session);
    if (!session) {
      me = { email: 'Tetamu', role: null, assignedEvent: 'Semua' };
      return { email: 'Tetamu', role: 'Awam', assignedEvent: 'Semua', eventConfig: EVENT_CONFIG };
    }
    const email = session.user.email.toLowerCase();
    const row = await q(sb.from('app_users').select('*').eq('email', email).maybeSingle());
    me = { email, role: row ? row.role : null, assignedEvent: row ? row.assigned_event : 'Semua' };
    return { email, role: row ? row.role : 'Awam', assignedEvent: me.assignedEvent, eventConfig: EVENT_CONFIG };
  },

  async getParticipants() {
    const rows = me.role
      ? await q(sb.from('participants').select('*').order('created_at'))
      : await q(sb.from('participants_public').select('*'));
    return rows.map(r => ({
      id: r.id, nama: r.nama, kontinjen: r.kontinjen,
      acara: r.acara, kategori: r.kategori, status: r.status, maklumatAhli: r.maklumat_ahli || ''
    }));
  },

  async registerParticipant(d) {
    const id = crypto.randomUUID();
    try {
      await q(sb.from('participants').insert({
        id, nama: clean(d.nama), kontinjen: clean(d.kontinjen),
        acara: d.acara, kategori: d.kategori, maklumat_ahli: clean(d.maklumatAhli)
      }));
    } catch (e) {
      if (e.code === '23505') throw new Error('Peserta ini sudah didaftarkan untuk acara tersebut.');
      if (e.code === '42501') throw new Error('Pendaftaran telah ditutup.');
      throw e;
    }
    return { success: true, id };
  },

  async updateParticipant(id, d) {
    let rows;
    try {
      rows = await q(sb.from('participants').update({
        nama: clean(d.nama), kontinjen: clean(d.kontinjen),
        kategori: d.kategori, maklumat_ahli: clean(d.maklumatAhli)
      }).eq('id', id).select('id'));
    } catch (e) {
      if (e.code === '23505') throw new Error('Peserta dengan nama, sekolah dan acara yang sama sudah wujud.');
      throw e;
    }
    if (!rows || !rows.length) throw new Error('Tiada kebenaran untuk mengedit peserta ini.');
    return true;
  },

  async verifyParticipant(id) {
    await q(sb.from('participants').update({ status: 'Disahkan' }).eq('id', id));
    return true;
  },

  async deleteParticipant(id) {
    await q(sb.from('participants').delete().eq('id', id));
    return true;
  },

  async getScores() {
    if (!me.role) return [];
    const rows = await q(sb.from('scores').select('*'));
    return rows.map(r => ({
      scoreId: r.id, participantId: r.participant_id, juriEmail: r.juri_email, acara: r.acara,
      c1: r.c1, c2: r.c2, c3: r.c3, c4: r.c4, c5: r.c5, total: r.total, status: r.status
    }));
  },

  async submitScore(d) {
    const c = [1, 2, 3, 4, 5].map(i => parseFloat(d['crit' + i]) || 0);
    await q(sb.from('scores').upsert({
      participant_id: d.participantId, juri_email: me.email, acara: d.acara,
      c1: c[0], c2: c[1], c3: c[2], c4: c[3], c5: c[4],
      total: c.reduce((a, b) => a + b, 0), status: 'Pending', updated_at: new Date().toISOString()
    }, { onConflict: 'participant_id,juri_email' }));
    return true;
  },

  async verifyScore(id) {
    await q(sb.from('scores').update({ status: 'Disahkan' }).eq('id', id));
    return true;
  },

  async getUsers() {
    const rows = await q(sb.from('app_users').select('*').order('email'));
    return rows.map(r => ({ email: r.email, role: r.role, assignedEvent: r.assigned_event }));
  },

  async getAudit() {
    return await q(sb.from('audit_log').select('*').order('at', { ascending: false }).limit(200));
  },

  async saveUser(email, role, event) {
    await q(sb.from('app_users').upsert({
      email: email.trim().toLowerCase(), role, assigned_event: event
    }));
    return true;
  },

  async deleteUser(email) {
    if (email.toLowerCase() === MAIN_ADMIN) return false;
    await q(sb.from('app_users').delete().eq('email', email.toLowerCase()));
    return true;
  }
};

// Kemas kini automatik. Staf: Supabase Realtime (ikut RLS). Tetamu: polling 30s
// (tetamu hanya membaca view, yang tidak menyokong realtime).
let liveStarted = false;
window.startLive = function (onChange) {
  if (liveStarted) return;
  liveStarted = true;
  let t;
  const fire = () => { clearTimeout(t); t = setTimeout(onChange, 700); };
  if (me.role) {
    sb.channel('mgpi-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, fire)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, fire)
      .subscribe();
  }
  // Polling sebagai sandaran jika sambungan realtime terputus
  setInterval(() => { if (!document.hidden) onChange(); }, me.role ? 60000 : 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) onChange(); });
};

// Rantai: google.script.run.withFailureHandler(f).withSuccessHandler(s).namaFungsi(...)
function runner() {
  let ok = () => {}, fail = e => console.error(e);
  const r = {
    withSuccessHandler(f) { ok = f; return r; },
    withFailureHandler(f) { fail = f; return r; }
  };
  Object.keys(api).forEach(k => {
    r[k] = (...a) => api[k](...a).then(ok).catch(e => fail(e));
  });
  return r;
}
window.google = { script: { get run() { return runner(); } } };
