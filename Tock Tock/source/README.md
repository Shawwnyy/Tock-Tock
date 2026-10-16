# Tock Tock

## ▶ Démarrage en 10 secondes (sans rien installer)

Ouvre **`Tock Tock.html`** (à la racine du zip) par double-clic. C'est la version « locale » : un seul fichier, qui ne se connecte à rien (la page est même bloquée en réseau par sa politique de sécurité). Tes données restent dans ton navigateur ; pense à faire des sauvegardes (Réglages).

Elle contient : bilan quotidien complet ou rapide avec brouillon automatique (20 indicateurs, douleur séparée, indicateurs perso, étiquettes), moyennes exactes, historique (courbes avec trous, calendrier, observations prudentes, recherche, **rapport PDF de période** à montrer à un soignant), chroniques de minuit sans IA + PDF, objectifs et étapes, série de jours, respiration guidée, ancrage 5-4-3-2-1, petites victoires, assistant guidé avec détection de détresse, bibliothèque, **règles expliquées** (acceptation versionnée), **centre d'aide** (écoute par pays, FAQ, tickets exportables, diagnostic), code PIN, thème clair/sombre, **sauvegarde en PDF** (lisible et restaurable) et export CSV.

**Connexion ou inscription par code (e-mail ou SMS)** : l'écran existe dans le fichier, mais un code ne peut être envoyé que par un **serveur**. Par défaut le fichier est strictement hors ligne : il contrôle le format de l'adresse ou du numéro, le dit clairement, et propose « Continuer sans compte ». Pour activer l'envoi réel, voir `docs/SETUP.md` (section « Connexion par e-mail et par SMS »). Aucun code n'est jamais généré, affiché ni simulé par l'application.

**Page d'accueil, exercices et discussion** : l'accueil résume la journée (bilan, série, moyenne 7 jours, courbe 14 jours, objectifs, idée du jour). 9 exercices guidés dans l'onglet Bien-être. La **discussion** (sans compte, avec ton nom#, ex. `Léo#18428`) exige le petit serveur `chat/serveur.mjs` (Node 18+, sans dépendance) ; `TOCK_CHAT=1 npm run build:local` fabrique la version à servir. Les messages ne sont pas chiffrés de bout en bout (voir `docs/LIMITS.md`).

Pour la reconstruire après modification : `npm install` puis `npm run build:local`. Le code est dans `src/local/` et réutilise la logique testée de `supabase/functions/_shared/`.

Les fonctions qui exigent un **serveur** (comptes par e-mail, communauté et modération, partage de fichiers, e-mails, IA) sont dans la version Supabase décrite ci-dessous.

---

Application web de **bilans personnels privés**, d'**objectifs**, de **chroniques de minuit** (texte, PDF, e-mail), d'**entraide communautaire**, de **partage sécurisé de médias** et d'**accompagnement conversationnel** — où chaque personne garde le contrôle de ses données.

> **Lisez d'abord [`docs/STATUS.md`](docs/STATUS.md).** Il dit, fonctionnalité par fonctionnalité, ce qui a été **testé**, ce qui est **écrit mais jamais exécuté** (faute d'environnement dans lequel il a été produit), et ce qui **n'est pas implémenté**. Rien n'est présenté comme terminé sans l'avoir été.

## Pile technique

| Couche | Choix |
|---|---|
| Interface | React 18 + TypeScript + Vite, routage par `#` (compatible GitHub Pages), CSS sans dépendance |
| Données / auth / fichiers | Supabase : PostgreSQL + RLS, Auth (code e-mail à usage unique), Storage (5 buckets privés), Edge Functions (Deno) |
| E-mails | Resend (SMTP d'authentification + API pour les chroniques) |
| PDF | `pdf-lib` (pur JS, fonctionne dans le navigateur et dans Deno) |
| IA (optionnelle) | Fournisseur configurable (API « Anthropic » ou compatible « OpenAI ») — **désactivée par défaut** |
| Hébergement du site | GitHub Pages (workflow fourni) |

## Démarrage rapide

```bash
npm install
cp .env.example .env        # renseigner VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY
npm run dev
```

Sans ces variables, l'application affiche un écran de configuration honnête (aucune démo simulée).
Mise en place complète de Supabase, des e-mails, des tâches planifiées et du déploiement : [`docs/SETUP.md`](docs/SETUP.md).

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` / `build` / `preview` | Vite |
| `npm test` | Tests TypeScript (**Bun** requis : `curl -fsSL https://bun.sh/install \| bash`) — 186 tests |
| `npm run test:sql` | Migrations + 674 assertions RLS/sécurité sur un vrai PostgreSQL (initdb local ou `TEST_DATABASE_URL`), puis `scripts/check_queries.py` : vérifie que chaque requête `.from()/.rpc()` du front et des Edge Functions correspond à une table, des colonnes et des droits qui existent vraiment (Python 3 requis pour cette dernière étape) |
| `npm run typecheck` | Types (interface + Edge Functions), avec déclarations minimales de React/Deno/Supabase |
| `npm run typecheck:strict` | Types stricts avec les vrais `@types/*` (non exécuté lors de la livraison — voir STATUS) |

## Organisation

```
supabase/migrations/   9 migrations SQL (schéma, RLS, déclencheurs, fonctions, buckets, données de départ)
supabase/tests/        compatibilité Supabase + 7 suites de tests SQL/RLS
supabase/functions/    7 Edge Functions + _shared/ (logique pure testée : moyennes, planning, chronique, PDF, fichiers, crise, IA, e-mail)
src/                   interface React (pages, composants, accès Supabase)
tests/                 tests TypeScript (Bun) + tests de rendu de l'interface
scripts/               test-sql.sh, cron.sql (planification), bootstrap-admin.sql
docs/                  SETUP, STATUS, SECURITY, COSTS, STATS, LIMITS
```

## Principes non négociables (appliqués dans le code, pas seulement dans la doc)

- Bilans, objectifs, chroniques, douleur, conversations : **privés par RLS** ; ni les modérateurs ni les administrateurs n'ont de politique d'accès à ces tables (testé).
- Une réponse vide n'est **jamais** un zéro ; la moyenne générale est la **moyenne des moyennes de catégories** ; la douleur est exclue ; « Moyenne indisponible » quand il n'y a rien à moyenner (testé).
- Aucune clé secrète dans l'interface ; aucun code de vérification inventé côté interface (Supabase Auth vérifie le code).
- Aucun média approuvé automatiquement : type réel contrôlé, renommage, bucket privé, relecture humaine (testé).
- L'IA, l'envoi d'e-mails, l'antivirus : **jamais présentés comme actifs s'ils ne sont pas configurés**.
- Détresse/crise détectée **avant** tout appel à un modèle : message fixe + ressources d'aide (testé).

Ceci n'est ni un dispositif médical ni un service d'urgence. Voir [`docs/LIMITS.md`](docs/LIMITS.md) pour les limites connues et les points juridiques à faire valider.
