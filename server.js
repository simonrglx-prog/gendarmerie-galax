const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data.db');
const PROD = process.env.NODE_ENV === 'production';

// ---------- Base de données ----------
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS agents(
  id INTEGER PRIMARY KEY, identifiant TEXT UNIQUE NOT NULL COLLATE NOCASE, mdp_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent', nom TEXT NOT NULL, prenom TEXT DEFAULT '', grade TEXT DEFAULT '',
  unite TEXT DEFAULT '', roblox TEXT DEFAULT '', discord TEXT DEFAULT '', date_entree TEXT DEFAULT '',
  statut TEXT NOT NULL DEFAULT 'En service');
CREATE TABLE IF NOT EXISTS sanctions(
  id INTEGER PRIMARY KEY, agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  date TEXT, type TEXT, motif TEXT, par TEXT, annulee INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS absences(
  id INTEGER PRIMARY KEY, agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  debut TEXT, fin TEXT, motif TEXT, statut TEXT);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE, expire INTEGER);
`);

if (!db.prepare('SELECT 1 FROM agents LIMIT 1').get()) {
  const mdp = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
  db.prepare("INSERT INTO agents(identifiant,mdp_hash,role,nom,grade) VALUES('admin',?,'commandement','Administrateur','Commandement')")
    .run(bcrypt.hashSync(mdp, 10));
  console.log(`\n>>> Compte créé : identifiant "admin" – mot de passe "${mdp}" (notez-le, puis changez-le dans l'interface)\n`);
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

function session(q, s, next) {
  const m = (q.headers.cookie || '').match(/(?:^|; )sid=([0-9a-f]+)/);
  if (m) {
    const a = db.prepare('SELECT a.* FROM sessions x JOIN agents a ON a.id=x.agent_id WHERE x.token=? AND x.expire>?').get(sha(m[1]), Date.now());
    if (a && a.statut !== 'Radié') { q.moi = a; q.sid = sha(m[1]); }
  }
  if (!q.moi) return s.status(401).json({ ok: false, expire: true, message: 'Session expirée. Reconnectez-vous.' });
  next();
}
const cmd = (q, s, next) => q.moi.role === 'commandement' ? next() : err(s, 403, 'Action réservée au commandement.');

const essais = new Map();
app.post('/api/login', (q, s) => {
  const id = txt(q.body.identifiant, 40), mdp = String(q.body.mdp || '');
  if (!id || !mdp) return err(s, 400, 'Renseignez identifiant et mot de passe.');
  const cle = q.ip + '|' + id.toLowerCase(), e = essais.get(cle) || { n: 0, t: 0 };
  if (e.n >= 5 && Date.now() < e.t) return err(s, 429, 'Trop de tentatives. Réessayez dans 10 minutes.');
  const a = db.prepare('SELECT * FROM agents WHERE identifiant=?').get(id);
  const ok = bcrypt.compareSync(mdp, a ? a.mdp_hash : DUMMY) && a && a.statut !== 'Radié';
  if (!ok) {
    essais.set(cle, { n: (Date.now() > e.t ? 0 : e.n) + 1, t: Date.now() + 600000 });
    return err(s, 401, 'Identifiant ou mot de passe incorrect.');
  }
  essais.delete(cle);
  db.prepare('DELETE FROM sessions WHERE expire<?').run(Date.now());
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token,agent_id,expire) VALUES(?,?,?)').run(sha(token), a.id, Date.now() + 8 * 3600e3);
  s.set('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${PROD ? '; Secure' : ''}`);
  s.json({ ok: true });
});

app.post('/api/logout', session, (q, s) => {
  db.prepare('DELETE FROM sessions WHERE token=?').run(q.sid);
  s.set('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  s.json({ ok: true });
});

app.get('/api/donnees', session, (q, s) => {
  const c = q.moi.role === 'commandement', p = c ? [] : [q.moi.id];
  const cols = 'id,identifiant,role,nom,prenom,grade,unite,roblox,discord,date_entree,statut';
  s.json({
    ok: true,
    moi: { id: q.moi.id, nom: q.moi.nom, prenom: q.moi.prenom, grade: q.moi.grade, role: q.moi.role },
    personnel: db.prepare(`SELECT ${cols} FROM agents${c ? '' : ' WHERE id=?'} ORDER BY nom, prenom`).all(...p),
    sanctions: db.prepare(`SELECT * FROM sanctions${c ? '' : ' WHERE agent_id=?'} ORDER BY date DESC, id DESC`).all(...p),
    absences: db.prepare(`SELECT * FROM absences${c ? '' : ' WHERE agent_id=?'} ORDER BY debut DESC, id DESC`).all(...p)
  });
});

function lireAgent(b) {
  const o = {};
  CHAMPS.forEach(k => o[k] = txt(b[k], 100));
  if (!o.nom) return { erreur: 'Le nom est obligatoire.' };
  if (!STATUTS.includes(o.statut)) o.statut = 'En service';
  if (o.date_entree && !dateOk(o.date_entree)) return { erreur: "Date d'entrée invalide." };
  o.role = b.role === 'commandement' ? 'commandement' : 'agent';
  return { o };
}

app.post('/api/agents', session, cmd, (q, s) => {
  const { o, erreur } = lireAgent(q.body), id = txt(q.body.identifiant, 40), mdp = String(q.body.mdp || '');
  if (erreur) return err(s, 400, erreur);
  if (!id) return err(s, 400, "L'identifiant est obligatoire.");
  if (mdp.length < 6) return err(s, 400, 'Mot de passe trop court (6 caractères minimum).');
  try {
    const r = db.prepare('INSERT INTO agents(identifiant,mdp_hash,role,nom,prenom,grade,unite,roblox,discord,date_entree,statut) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, bcrypt.hashSync(mdp, 10), o.role, o.nom, o.prenom, o.grade, o.unite, o.roblox, o.discord, o.date_entree, o.statut);
    s.json({ ok: true, id: Number(r.lastInsertRowid) });
  } catch (x) { err(s, 409, 'Cet identifiant existe déjà.'); }
});

app.put('/api/agents/:id', session, cmd, (q, s) => {
  const a = db.prepare('SELECT * FROM agents WHERE id=?').get(q.params.id);
  if (!a) return err(s, 404, 'Agent introuvable.');
  const { o, erreur } = lireAgent(q.body), mdp = String(q.body.mdp || '');
  if (erreur) return err(s, 400, erreur);
  if (mdp && mdp.length < 6) return err(s, 400, 'Mot de passe trop court (6 caractères minimum).');
  if (a.id === q.moi.id && (o.role !== 'commandement' || o.statut === 'Radié')) return err(s, 400, 'Vous ne pouvez pas retirer vos propres droits.');
  db.prepare('UPDATE agents SET role=?,nom=?,prenom=?,grade=?,unite=?,roblox=?,discord=?,date_entree=?,statut=? WHERE id=?')
    .run(o.role, o.nom, o.prenom, o.grade, o.unite, o.roblox, o.discord, o.date_entree, o.statut, a.id);
  if (mdp) {
    db.prepare('UPDATE agents SET mdp_hash=? WHERE id=?').run(bcrypt.hashSync(mdp, 10), a.id);
    if (a.id !== q.moi.id) db.prepare('DELETE FROM sessions WHERE agent_id=?').run(a.id);
  }
  s.json({ ok: true });
});

const existe = id => db.prepare('SELECT 1 FROM agents WHERE id=?').get(id);

app.post('/api/sanctions', session, cmd, (q, s) => {
  const aid = Number(q.body.agent_id), type = txt(q.body.type, 40), motif = txt(q.body.motif);
  if (!existe(aid)) return err(s, 400, 'Agent inconnu.');
  if (!TYPES.includes(type) || !motif) return err(s, 400, 'Le type et le motif sont obligatoires.');
  db.prepare('INSERT INTO sanctions(agent_id,date,type,motif,par) VALUES(?,?,?,?,?)')
    .run(aid, aujourdhui(), type, motif, `${q.moi.prenom} ${q.moi.nom}`.trim());
  s.json({ ok: true });
});
app.post('/api/sanctions/:id/annuler', session, cmd, (q, s) => {
  db.prepare('UPDATE sanctions SET annulee=1 WHERE id=?').run(q.params.id);
  s.json({ ok: true });
});

app.post('/api/absences', session, (q, s) => {
  const c = q.moi.role === 'commandement', aid = c && q.body.agent_id ? Number(q.body.agent_id) : q.moi.id;
  const { debut, fin } = q.body, motif = txt(q.body.motif, 200);
  if (!existe(aid)) return err(s, 400, 'Agent inconnu.');
  if (!dateOk(debut) || !dateOk(fin) || fin < debut) return err(s, 400, 'Vérifiez les dates (la fin ne peut pas précéder le début).');
  db.prepare('INSERT INTO absences(agent_id,debut,fin,motif,statut) VALUES(?,?,?,?,?)').run(aid, debut, fin, motif, c ? 'Validée' : 'En attente');
  s.json({ ok: true });
});
app.post('/api/absences/:id/statut', session, cmd, (q, s) => {
  if (!['Validée', 'Refusée'].includes(q.body.statut)) return err(s, 400, 'Statut invalide.');
  db.prepare('UPDATE absences SET statut=? WHERE id=?').run(q.body.statut, q.params.id);
  s.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (q, s) => err(s, 404, 'Introuvable.'));
app.use((e, q, s, next) => err(s, 400, 'Requête invalide.'));

app.listen(PORT, () => console.log(`Serveur démarré : http://localhost:${PORT}`));
