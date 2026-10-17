const $ = id => document.getElementById(id);
const e = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const dt = v => /^\d{4}-\d\d-\d\d$/.test(v) ? v.split("-").reverse().join("/") : e(v);
const badge = (s, c) => `<span class="b ${c || ""}">${e(s)}</span>`;
let M = null, D = null, vue = "personnel", fiche = null, edit = null, q = "";
const cmd = () => M && (M.role === "commandement" || M.role === "officier");
const ROLES = [["gendarme", "Gendarme"], ["officier", "Officier"], ["commandement", "Commandement"]];
const roleNom = r => (ROLES.find(x => x[0] === r) || [0, r || ""])[1];
const GRADES = ["Gendarme adjoint volontaire", "Brigadier", "Brigadier-cHEF", "Gendarme Sous Contrat", "Gendarme de Carrière", "Maréchal des logis", "Maréchal des logis-chef",
  "Adjudant", "Adjudant-chef", "Major", "Aspirant", "Sous-lieutenant", "Lieutenant", "Capitaine", "Commandant",
  "Lieutenant-colonel", "Colonel", "Général de brigade"];
const gradeOpts = g => [["", "— Choisir un grade —"]].concat(g && !GRADES.includes(g) ? [g] : [], GRADES);

async function api(url, method, body){
  const r = await fetch(url, {method: method || "GET", credentials: "same-origin",
    headers: body ? {"Content-Type": "application/json"} : {}, body: body ? JSON.stringify(body) : undefined});
  let d = {}; try{ d = await r.json(); }catch(x){}
  if(d.expire) montrerConnexion();
  return d;
}
function montrerConnexion(){ M = D = fiche = edit = null; $("app").hidden = true; $("cnx").hidden = false; }
function erreur(t){ $("msg").textContent = t; $("alerte").classList.add("on"); }

async function charger(){
  const d = await api("/api/donnees");
  if(!d.ok){ montrerConnexion(); return false; }
  D = d; M = d.moi;
  if(!cmd() && d.personnel.length === 1 && fiche === null) fiche = d.personnel[0].id;
  $("qui").textContent = [M.grade, M.prenom, M.nom].filter(Boolean).join(" ");
  $("role").textContent = roleNom(M.role);
  $("cnx").hidden = true; $("app").hidden = false;
  render(); return true;
}

function render(){
  $("onglets").innerHTML = [["personnel", cmd() ? "Personnel" : "Ma fiche"], ["sanctions", "Sanctions"], ["absences", "Absences"]]
    .map(a => `<button type="button" role="tab" data-vue="${a[0]}" aria-selected="${vue === a[0]}">${a[1]}</button>`).join("");
  $("contenu").innerHTML = vue === "sanctions" ? vSanctions() : vue === "absences" ? vAbsences()
    : edit !== null ? vAgentForm(edit === "new" ? null : D.personnel.find(p => p.id === edit))
    : fiche !== null ? vFiche() : vListe();
}

const agent = id => D.personnel.find(p => p.id === id);
const nomDe = id => { const p = agent(id); return p ? e(p.prenom + " " + p.nom) : "—"; };
const lien = id => `<a href="#" data-id="${id}">${nomDe(id)}</a>`;

function vListe(){
  const f = D.personnel.filter(p => [p.nom, p.prenom, p.roblox, p.discord, p.identifiant].join(" ").toLowerCase().includes(q.toLowerCase()));
  return `<div class="haut"><input type="search" id="rech" placeholder="Rechercher (nom, NIGEND, pseudo Roblox, Discord…)" aria-label="Rechercher" value="${e(q)}">` +
    (cmd() ? `<button type="button" data-edit="new">Nouvel agent</button>` : "") + `</div>` +
    (f.length ? `<div class="tw"><table><thead><tr><th>Nom Prénom</th><th>NIGEND</th><th>Grade</th><th>Roblox</th><th>Discord</th><th>Statut</th></tr></thead><tbody>` +
    f.map(p => `<tr><td>${lien(p.id)}</td><td>${e(p.identifiant)}</td><td>${e(p.grade)}</td><td>${e(p.roblox)}</td><td>${e(p.discord)}</td><td>${e(p.statut)}</td></tr>`).join("") +
    `</tbody></table></div>` : `<p class="vide">Aucun agent trouvé.</p>`);
}

function tabSanc(a, avecNom){
  return a.length ? `<div class="tw"><table><thead><tr><th>Date</th>${avecNom ? "<th>Agent</th>" : ""}<th>Type</th><th>Motif</th><th>Par</th>${cmd() ? "<th></th>" : ""}</tr></thead><tbody>` +
    a.map(s => `<tr class="${s.annulee ? "ann" : ""}"><td>${dt(s.date)}</td>${avecNom ? `<td>${lien(s.agent_id)}</td>` : ""}<td>${e(s.type)}${s.annulee ? " " + badge("Annulée") : ""}</td><td>${e(s.motif)}</td><td>${e(s.par)}</td>` +
      (cmd() ? `<td>${s.annulee ? "" : `<button class="pt sec" data-annuler="${s.id}">Annuler</button>`}</td>` : "") + `</tr>`).join("") + `</tbody></table></div>` : `<p class="vide">Aucune sanction.</p>`;
}
function tabAbs(a, avecNom){
  return a.length ? `<div class="tw"><table><thead><tr>${avecNom ? "<th>Agent</th>" : ""}<th>Du</th><th>Au</th><th>Motif</th><th>Statut</th>${cmd() ? "<th></th>" : ""}</tr></thead><tbody>` +
    a.map(x => `<tr>${avecNom ? `<td>${lien(x.agent_id)}</td>` : ""}<td>${dt(x.debut)}</td><td>${dt(x.fin)}</td><td>${e(x.motif)}</td><td>${badge(x.statut, {"Validée":"v","Refusée":"r"}[x.statut])}</td>` +
      (cmd() ? `<td>${x.statut === "En attente" ? `<button class="pt" data-act="Validée" data-abs="${x.id}">Valider</button> <button class="pt sec" data-act="Refusée" data-abs="${x.id}">Refuser</button>` : ""}</td>` : "") + `</tr>`).join("") + `</tbody></table></div>` : `<p class="vide">Aucune absence.</p>`;
}
const vSanctions = () => `<h3 class="t0">Sanctions</h3>` + tabSanc(D.sanctions, true);
const vAbsences = () => `<h3 class="t0">Absences</h3>` + tabAbs(D.absences, true);

function vFiche(){
  const p = agent(fiche); if(!p){ fiche = null; return vListe(); }
  const mien = x => x.agent_id === fiche;
  return `<div class="haut">` + (cmd() ? `<button class="sec pt" type="button" data-retour="1">← Retour à la liste</button><button class="sec pt" type="button" data-edit="${p.id}">Modifier la fiche</button>` : "") + `</div>` +
    `<h2>${e(p.prenom)} ${e(p.nom)}</h2>` +
    `<dl><dt>NIGEND</dt><dd>${e(p.identifiant)}</dd><dt>Rôle</dt><dd>${e(roleNom(p.role))}</dd><dt>Grade</dt><dd>${e(p.grade)}</dd><dt>Pseudo Roblox</dt><dd>${e(p.roblox)}</dd><dt>Discord</dt><dd>${e(p.discord)}</dd><dt>Date d'entrée</dt><dd>${dt(p.date_entree)}</dd><dt>Statut</dt><dd>${e(p.statut)}</dd></dl>` +
    `<h3>Dossier disciplinaire</h3>` + tabSanc(D.sanctions.filter(mien), false) +
    `<h3>Absences</h3>` + tabAbs(D.absences.filter(mien), false) +
    `<div class="forms">` +
    (cmd() ? `<form class="bloc" data-a="sanction"><h3>Nouvelle sanction</h3><label for="s-type">Type</label><select id="s-type" name="type"><option>Avertissement</option><option>Blâme</option><option>Mise à pied</option><option>Retrait de grade</option><option>Radiation</option></select><label for="s-motif">Motif</label><textarea id="s-motif" name="motif" maxlength="500" required></textarea><button>Enregistrer la sanction</button><p class="msg" role="alert"></p></form>` : "") +
    `<form class="bloc" data-a="absence"><h3>${cmd() ? "Enregistrer une absence" : "Déclarer une absence"}</h3><label for="a-d">Du</label><input id="a-d" type="date" name="debut" required><label for="a-f">Au</label><input id="a-f" type="date" name="fin" required><label for="a-m">Motif</label><input id="a-m" type="text" name="motif" maxlength="200"><button>${cmd() ? "Enregistrer" : "Envoyer la demande"}</button><p class="msg" role="alert"></p></form></div>`;
}

function vAgentForm(p){
  const nw = !p; p = p || {};
  const f = (k, l, t, x) => `<label for="f-${k}">${l}</label><input id="f-${k}" name="${k}" type="${t || "text"}" value="${e(p[k] || "")}" ${x || ""}>`;
  const sel = (k, l, o) => { const cur = p[k] || (Array.isArray(o[0]) ? o[0][0] : o[0]); return `<label for="f-${k}">${l}</label><select id="f-${k}" name="${k}">${o.map(v => { const [x, t] = Array.isArray(v) ? v : [v, v]; return `<option value="${e(x)}"${cur === x ? " selected" : ""}>${e(t)}</option>`; }).join("")}</select>`; };
  return `<button class="sec pt" type="button" data-retour="1">← Annuler</button><form class="bloc t12" data-a="${nw ? "agent-new" : "agent-edit"}"><h3>${nw ? "Nouvel agent" : "Modifier la fiche"}</h3><div class="grille">` +
    (nw ? f("identifiant", "NIGEND", "text", 'required autocapitalize="none"') : "") +
    f("mdp", nw ? "Mot de passe (6 caractères min.)" : "Nouveau mot de passe (vide = inchangé)", "text", `autocomplete="off" ${nw ? "required" : ""}`) +
    sel("role", "Rôle", ROLES) + f("nom", "Nom", "text", "required") + f("prenom", "Prénom") + sel("grade", "Grade", gradeOpts(p.grade)) +
    f("roblox", "Pseudo Roblox") + f("discord", "Discord") + f("date_entree", "Date d'entrée", "date") + sel("statut", "Statut", ["En service", "En congé", "Suspendu", "Radié"]) +
    `</div><button>Enregistrer</button><p class="msg" role="alert"></p></form>`;
}

$("voir").addEventListener("change", ev => { $("mdp").type = ev.target.checked ? "text" : "password"; });

$("fcnx").addEventListener("submit", async ev => {
  ev.preventDefault(); $("alerte").classList.remove("on");
  const identifiant = $("identifiant").value.trim(), mdp = $("mdp").value, b = $("btn");
  if(!identifiant || !mdp){ erreur("Renseignez votre NIGEND et votre mot de passe."); return; }
  b.disabled = true; b.textContent = "Vérification en cours…";
  try{
    const d = await api("/api/login", "POST", {identifiant, mdp});
    if(d.ok){ $("mdp").value = ""; await charger(); } else erreur(d.message || "Connexion refusée.");
  }catch(x){ erreur("Le serveur ne répond pas. Réessayez dans quelques instants."); }
  b.disabled = false; b.textContent = "Se connecter";
});

$("deco").addEventListener("click", async () => { await api("/api/logout", "POST"); montrerConnexion(); });

$("onglets").addEventListener("click", ev => {
  const b = ev.target.closest("[data-vue]"); if(!b) return;
  vue = b.dataset.vue; edit = null; if(vue === "personnel" && cmd()) fiche = null; render();
});

$("contenu").addEventListener("input", ev => {
  if(ev.target.id !== "rech") return;
  q = ev.target.value; const p = ev.target.selectionStart; render(); const r = $("rech"); r.focus(); r.setSelectionRange(p, p);
});

$("contenu").addEventListener("click", async ev => {
  const a = ev.target.closest("[data-id],[data-abs],[data-annuler],[data-retour],[data-edit]"); if(!a) return;
  ev.preventDefault();
  if(a.dataset.id){ fiche = Number(a.dataset.id); vue = "personnel"; edit = null; render(); }
  else if(a.dataset.retour){ if(edit !== null) edit = null; else fiche = null; render(); }
  else if(a.dataset.edit){ edit = a.dataset.edit === "new" ? "new" : Number(a.dataset.edit); render(); }
  else{
    let d;
    if(a.dataset.annuler){ if(!confirm("Annuler cette sanction ? Elle restera visible dans le dossier, barrée.")) return; a.disabled = true; d = await api(`/api/sanctions/${a.dataset.annuler}/annuler`, "POST"); }
    else{ a.disabled = true; d = await api(`/api/absences/${a.dataset.abs}/statut`, "POST", {statut: a.dataset.act}); }
    if(d.ok) await charger(); else { a.disabled = false; alert(d.message || "Échec."); }
  }
});

$("contenu").addEventListener("submit", async ev => {
  ev.preventDefault();
  const f = ev.target, b = f.querySelector("button"), m = f.querySelector(".msg"), a = f.dataset.a;
  const v = Object.fromEntries(new FormData(f)); m.textContent = ""; b.disabled = true;
  let d;
  if(a === "agent-new") d = await api("/api/agents", "POST", v);
  else if(a === "agent-edit") d = await api(`/api/agents/${edit}`, "PUT", v);
  else d = await api("/api/" + (a === "sanction" ? "sanctions" : "absences"), "POST", Object.assign({agent_id: fiche}, v));
  if(!d.ok){ m.textContent = d.message || "Échec de l'enregistrement."; b.disabled = false; return; }
  if(a === "agent-new") fiche = d.id;
  edit = null; await charger();
});

charger();
