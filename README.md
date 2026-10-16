[README.md](https://github.com/user-attachments/files/33573746/README.md)
# Gestion du personnel – Gendarmerie nationale (jeu de rôle)

Fiches du personnel (Nom, Prénom, grade, unité, pseudo Roblox, Discord…), dossiers disciplinaires et absences.

## Tester sur votre ordinateur
```
npm install
npm start
```
Ouvrez http://localhost:3000. Un compte `admin` est créé au premier lancement
(mot de passe affiché dans la console, ou défini avec `ADMIN_PASSWORD`). Les données sont dans `data.db`.

## Mise en ligne 100 % gratuite
- **Base de données** : Turso (gratuit). Variables : `TURSO_DATABASE_URL` et `TURSO_AUTH_TOKEN`.
- **Hébergement** : Render, offre gratuite (le site se met en veille après 15 min sans visite ; les données restent dans Turso).
- Autres variables : `NODE_ENV=production`, `ADMIN_PASSWORD` (mot de passe du compte admin créé au premier démarrage).

## Rôles
- **agent** : voit sa fiche, son dossier et ses absences ; peut déclarer une absence (« En attente »).
- **commandement** : voit tout le monde ; crée/modifie les agents, réinitialise les mots de passe,
  ajoute et annule des sanctions, valide ou refuse les absences.
- Un agent au statut **Radié** ne peut plus se connecter.
