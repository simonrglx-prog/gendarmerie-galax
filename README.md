# Gestion du personnel – Gendarmerie nationale (jeu de rôle)

Site complet : fiches du personnel (Nom, Prénom, grade, unité, pseudo Roblox, Discord…),
dossiers disciplinaires et absences. Base de données SQLite (un seul fichier, `data.db`).

## Lancer en local
```
npm install
npm start
```
Ouvrez http://localhost:3000. Au premier démarrage, un compte `admin` (commandement) est créé :
son mot de passe s'affiche dans la console (ou définissez `ADMIN_PASSWORD` avant le lancement).

## Rôles
- **agent** : voit uniquement sa fiche, son dossier et ses absences ; peut déclarer une absence (« En attente »).
- **commandement** : voit tout le monde ; crée/modifie les agents, réinitialise les mots de passe,
  ajoute et annule des sanctions, valide ou refuse les absences.
- Un agent au statut **Radié** ne peut plus se connecter.

## Mettre en ligne
Il faut un hébergeur Node.js avec un **disque persistant** (sinon `data.db` est effacé à chaque redémarrage).
Variables d'environnement utiles :
- `NODE_ENV=production` (active le cookie « Secure » : le site doit être en HTTPS)
- `PORT` (fourni par la plupart des hébergeurs)
- `DB_FILE` : chemin du fichier de base, à placer sur le disque persistant (ex. `/data/data.db`)
- `ADMIN_PASSWORD` : mot de passe du compte admin créé au premier démarrage

Pensez à sauvegarder `data.db` régulièrement.
