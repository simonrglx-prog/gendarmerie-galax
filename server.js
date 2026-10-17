const express = require('express');
const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';

// ---------- Base de données ----------
// En ligne : base Turso (gratuite, données conservées). En local : simple fichier data.db.
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:' + (process.env.DB_FILE || path.join(__dirname, 'data.db')),
  authToken: process.env.TURSO_AUTH_TOKEN
});
const run = (sql, args = []) => db.execute({ sql, args });
const all = async (sql, args = []) => (await run(sql, args)).rows.map(r => ({ ...r }));
const one = async (sql, args = []) => (await all(sql, args))[0];

async function init() {
  await db.executeMultiple(`
CREATE TABLE IF NOT EXISTS agents(
  id INTEGER PRIMARY KEY, identifiant TEXT UNIQUE NOT NULL COLLATE NOCASE, mdp_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent', nom TEXT NOT NULL, prenom TEXT DEFAULT '', grade TEXT DEFAULT '',
  unite TEXT DEFAULT '', roblox TEXT DEFAULT '', discord TEXT DEFAULT '', date_entree TEXT DEFAULT '',
  statut TEXT NOT NULL DEFAULT 'En service');
CREATE TABLE IF NOT EXISTS sanctions(
  id INTEGER PRIMARY KEY, agent_id INTEGER NOT NULL REFERENCES agents(id),
  date TEXT, type TEXT, motif TEXT, par TEXT, annulee INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS absences(
  id INTEGER PRIMARY KEY, agent_id INTEGER NOT NULL REFERENCES agents(id),
  debut TEXT, fin TEXT, motif TEXT, statut TEXT);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, agent_id INTEGER NOT NULL REFERENCES agents(id), expire INTEGER);
`);
  if (!(await one('SELECT 1 AS x FROM agents LIMIT 1'))) {
    const mdp = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
    await run("INSERT INTO agents(identifiant,mdp_hash,role,nom,grade) VALUES('admin',?,'commandement','Administrateur','Commandement')", [bcrypt.hashSync(mdp, 10)]);
    console.log(`\n>>> Compte créé : identifiant "admin" – mot de passe "${mdp}" (changez-le dans l'interface)\n`);
  }
}

// ---------- Utilitaires ----------
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const txt = (v, max = 500) => String(v == null ? '' : v).trim().slice(0, max);
const dateOk = v => /^\d{4}-\d{2}-\d{2}$/.test(v);
const aujourdhui = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
const STATUTS = ['En service', 'En congé', 'Suspendu', 'Radié'];
const TYPES = ['Avertissement', 'Blâme', 'Mise à pied', 'Retrait de grade', 'Radiation'];
const CHAMPS = ['nom', 'prenom', 'grade', 'unite', 'roblox', 'discord', 'date_entree', 'statut'];
const DUMMY = bcrypt.hashSync('x', 10);
const err = (s, code, message) => s.status(code).json({ ok: false, message });
const h = fn => (q, s, next) => Promise.resolve(fn(q, s, next)).catch(next); // transmet les erreurs async

// ---------- Application ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '50kb' }));
app.use((q, s, next) => {
  s.set({
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src https://cdn.jsdelivr.net; frame-ancestors 'none'"
  });
  next();
});

const session = h(async (q, s, next) => {
  const m = (q.headers.cookie || '').match(/(?:^|; )sid=([0-9a-f]+)/);
  if (m) {
    const a = await one('SELECT a.* FROM sessions x JOIN agents a ON a.id=x.agent_id WHERE x.token=? AND x.expire>?', [sha(m[1]), Date.now()]);
    if (a && a.statut !== 'Radié') { q.moi = a; q.sid = sha(m[1]); }
  }
  if (!q.moi) return s.status(401).json({ ok: false, expire: true, message: 'Session expirée. Reconnectez-vous.' });
  next();
});
const cmd = (q, s, next) => q.moi.role === 'commandement' ? next() : err(s, 403, 'Action réservée au commandement.');

const essais = new Map();
app.post('/api/login', h(async (q, s) => {
  const id = txt(q.body.identifiant, 40), mdp = String(q.body.mdp || '');
  if (!id || !mdp) return err(s, 400, 'Renseignez identifiant et mot de passe.');
  const cle = q.ip + '|' + id.toLowerCase(), e = essais.get(cle) || { n: 0, t: 0 };
  if (e.n >= 5 && Date.now() < e.t) return err(s, 429, 'Trop de tentatives. Réessayez dans 10 minutes.');
  const a = await one('SELECT * FROM agents WHERE identifiant=?', [id]);
  const ok = bcrypt.compareSync(mdp, a ? a.mdp_hash : DUMMY) && a && a.statut !== 'Radié';
  if (!ok) {
    essais.set(cle, { n: (Date.now() > e.t ? 0 : e.n) + 1, t: Date.now() + 600000 });
    return err(s, 401, 'Identifiant ou mot de passe incorrect.');
  }
  essais.delete(cle);
  await run('DELETE FROM sessions WHERE expire<?', [Date.now()]);
  const token = crypto.randomBytes(32).toString('hex');
  await run('INSERT INTO sessions(token,agent_id,expire) VALUES(?,?,?)', [sha(token), a.id, Date.now() + 8 * 3600e3]);
  s.set('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${PROD ? '; Secure' : ''}`);
  s.json({ ok: true });
}));

app.post('/api/logout', session, h(async (q, s) => {
  await run('DELETE FROM sessions WHERE token=?', [q.sid]);
  s.set('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  s.json({ ok: true });
}));

app.get('/api/donnees', session, h(async (q, s) => {
  const c = q.moi.role === 'commandement', p = c ? [] : [q.moi.id];
  const cols = 'id,identifiant,role,nom,prenom,grade,unite,roblox,discord,date_entree,statut';
  s.json({
    ok: true,
    moi: { id: q.moi.id, nom: q.moi.nom, prenom: q.moi.prenom, grade: q.moi.grade, role: q.moi.role },
    personnel: await all(`SELECT ${cols} FROM agents${c ? '' : ' WHERE id=?'} ORDER BY nom, prenom`, p),
    sanctions: await all(`SELECT * FROM sanctions${c ? '' : ' WHERE agent_id=?'} ORDER BY date DESC, id DESC`, p),
    absences: await all(`SELECT * FROM absences${c ? '' : ' WHERE agent_id=?'} ORDER BY debut DESC, id DESC`, p)
  });
}));

function lireAgent(b) {
  const o = {};
  CHAMPS.forEach(k => o[k] = txt(b[k], 100));
  if (!o.nom) return { erreur: 'Le nom est obligatoire.' };
  if (!STATUTS.includes(o.statut)) o.statut = 'En service';
  if (o.date_entree && !dateOk(o.date_entree)) return { erreur: "Date d'entrée invalide." };
  o.role = b.role === 'commandement' ? 'commandement' : 'agent';
  return { o };
}

app.post('/api/agents', session, cmd, h(async (q, s) => {
  const { o, erreur } = lireAgent(q.body), id = txt(q.body.identifiant, 40), mdp = String(q.body.mdp || '');
  if (erreur) return err(s, 400, erreur);
  if (!id) return err(s, 400, "L'identifiant est obligatoire.");
  if (mdp.length < 6) return err(s, 400, 'Mot de passe trop court (6 caractères minimum).');
  if (await one('SELECT 1 AS x FROM agents WHERE identifiant=?', [id])) return err(s, 409, 'Cet identifiant existe déjà.');
  const r = await run('INSERT INTO agents(identifiant,mdp_hash,role,nom,prenom,grade,unite,roblox,discord,date_entree,statut) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    [id, bcrypt.hashSync(mdp, 10), o.role, o.nom, o.prenom, o.grade, o.unite, o.roblox, o.discord, o.date_entree, o.statut]);
  s.json({ ok: true, id: Number(r.lastInsertRowid) });
}));

app.put('/api/agents/:id', session, cmd, h(async (q, s) => {
  const a = await one('SELECT * FROM agents WHERE id=?', [Number(q.params.id)]);
  if (!a) return err(s, 404, 'Agent introuvable.');
  const { o, erreur } = lireAgent(q.body), mdp = String(q.body.mdp || '');
  if (erreur) return err(s, 400, erreur);
  if (mdp && mdp.length < 6) return err(s, 400, 'Mot de passe trop court (6 caractères minimum).');
  if (a.id === q.moi.id && (o.role !== 'commandement' || o.statut === 'Radié')) return err(s, 400, 'Vous ne pouvez pas retirer vos propres droits.');
  await run('UPDATE agents SET role=?,nom=?,prenom=?,grade=?,unite=?,roblox=?,discord=?,date_entree=?,statut=? WHERE id=?',
    [o.role, o.nom, o.prenom, o.grade, o.unite, o.roblox, o.discord, o.date_entree, o.statut, a.id]);
  if (mdp) {
    await run('UPDATE agents SET mdp_hash=? WHERE id=?', [bcrypt.hashSync(mdp, 10), a.id]);
    if (a.id !== q.moi.id) await run('DELETE FROM sessions WHERE agent_id=?', [a.id]);
  }
  s.json({ ok: true });
}));

const existe = async id => !!(await one('SELECT 1 AS x FROM agents WHERE id=?', [id]));

app.post('/api/sanctions', session, cmd, h(async (q, s) => {
  const aid = Number(q.body.agent_id), type = txt(q.body.type, 40), motif = txt(q.body.motif);
  if (!(await existe(aid))) return err(s, 400, 'Agent inconnu.');
  if (!TYPES.includes(type) || !motif) return err(s, 400, 'Le type et le motif sont obligatoires.');
  await run('INSERT INTO sanctions(agent_id,date,type,motif,par) VALUES(?,?,?,?,?)',
    [aid, aujourdhui(), type, motif, `${q.moi.prenom} ${q.moi.nom}`.trim()]);
  s.json({ ok: true });
}));
app.post('/api/sanctions/:id/annuler', session, cmd, h(async (q, s) => {
  await run('UPDATE sanctions SET annulee=1 WHERE id=?', [Number(q.params.id)]);
  s.json({ ok: true });
}));

app.post('/api/absences', session, h(async (q, s) => {
  const c = q.moi.role === 'commandement', aid = c && q.body.agent_id ? Number(q.body.agent_id) : q.moi.id;
  const { debut, fin } = q.body, motif = txt(q.body.motif, 200);
  if (!(await existe(aid))) return err(s, 400, 'Agent inconnu.');
  if (!dateOk(debut) || !dateOk(fin) || fin < debut) return err(s, 400, 'Vérifiez les dates (la fin ne peut pas précéder le début).');
  await run('INSERT INTO absences(agent_id,debut,fin,motif,statut) VALUES(?,?,?,?,?)', [aid, debut, fin, motif, c ? 'Validée' : 'En attente']);
  s.json({ ok: true });
}));
app.post('/api/absences/:id/statut', session, cmd, h(async (q, s) => {
  if (!['Validée', 'Refusée'].includes(q.body.statut)) return err(s, 400, 'Statut invalide.');
  await run('UPDATE absences SET statut=? WHERE id=?', [q.body.statut, Number(q.params.id)]);
  s.json({ ok: true });
}));

app.get('/sante', (q, s) => s.send('ok')); // pour réveiller le site si besoin
// Les fichiers du site sont à la racine du dépôt : on ne sert que ces trois-là
const PAGES = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
app.get(Object.keys(PAGES), (q, s) => s.sendFile(path.join(__dirname, PAGES[q.path])));
app.use('/api', (q, s) => err(s, 404, 'Introuvable.'));
app.use((e, q, s, next) => {
  if (e.type === 'entity.parse.failed') return err(s, 400, 'Requête invalide.');
  console.error(e);
  err(s, 500, 'Erreur du serveur.');
});

init().then(() => app.listen(PORT, () => console.log(`Serveur démarré : http://localhost:${PORT}`)))
  .catch(e => { console.error('Impossible de démarrer :', e.message); process.exit(1); });
