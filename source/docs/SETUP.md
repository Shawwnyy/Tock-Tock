# Installation et configuration

Durée estimée : 45 à 90 minutes la première fois. Prérequis : un compte [Supabase](https://supabase.com), un compte [Resend](https://resend.com) (e-mails), un dépôt GitHub, Node 20+, [Bun](https://bun.sh) (tests), le [CLI Supabase](https://supabase.com/docs/guides/cli).

> Rappel : **rien de cette procédure n'a pu être exécuté pendant la création du projet** (voir `STATUS.md`). Les migrations SQL, elles, ont été appliquées sur PostgreSQL 16. Notez les écarts que vous rencontrez : les premières exécutions réelles des Edge Functions et de la configuration e-mail sont les plus susceptibles de demander un ajustement.

## 1. Projet Supabase et migrations

1. Créez un projet Supabase (région proche de vos membres, ex. Paris/Francfort pour des données européennes).
2. Dans le dossier du projet : `supabase login`, puis `supabase link --project-ref VOTRE_REF`.
3. Appliquez les migrations : `supabase db push` (les 9 fichiers de `supabase/migrations/`, dans l'ordre).
4. Vérifiez dans **Table editor** que **chaque** table a la mention « RLS enabled », et dans **Storage** que 5 buckets existent et sont **tous privés** : `temp-uploads`, `quarantine`, `community-media`, `private-documents`, `chronicles`.
5. **Settings > API > Exposed schemas** : seulement `public` (et `storage`). Le schéma `private` ne doit **jamais** être exposé.

## 2. Authentification par code e-mail

1. **Authentication > Providers > Email** : activez « Confirm email » ; désactivez les autres fournisseurs dont vous n'avez pas besoin.
2. **Authentication > Emails > SMTP settings** : l'envoi intégré de Supabase est limité à quelques e-mails par heure et réservé aux tests. Configurez Resend en SMTP : hôte `smtp.resend.com`, port `465`, utilisateur `resend`, mot de passe = votre clé API Resend, expéditeur = une adresse d'un **domaine que vous avez vérifié** chez Resend (DNS SPF/DKIM).
3. **Authentication > Emails > Templates** : le code doit apparaître dans **deux** modèles — « Confirm signup » (nouveaux comptes) et « Magic Link » (comptes existants). Utilisez par exemple :

   ```html
   <h2>Ton code Tock Tock</h2>
   <p>Saisis ce code dans l'application : <strong style="font-size:24px;letter-spacing:4px">{{ .Token }}</strong></p>
   <p>Il expire dans 10 minutes. Si tu n'es pas à l'origine de cette demande, ignore ce message.</p>
   ```
4. **Authentication > Rate limits** : gardez des valeurs basses (voir `supabase/config.toml` : 1 envoi/min/adresse, expiration 10 min, 6 chiffres).
5. **Authentication > URL configuration** : « Site URL » = l'adresse GitHub Pages finale.
6. Activez la protection anti-bots (CAPTCHA, ex. hCaptcha/Turnstile) dans **Authentication > Attack protection** avant d'ouvrir au public. *(Non intégrée à l'interface : à ajouter si vous recevez des abus.)*

## 3. Secrets des Edge Functions (jamais dans le dépôt, jamais dans l'interface)

```bash
supabase secrets set \
  CRON_SECRET="$(openssl rand -hex 32)" \
  APP_URL="https://VOTRE-COMPTE.github.io/tock-tock" \
  ALLOWED_ORIGINS="https://VOTRE-COMPTE.github.io" \
  RESEND_API_KEY="re_..." \
  EMAIL_FROM="Tock Tock <bonjour@votre-domaine.fr>"
# Facultatif — IA (laisser vide = désactivée ; l'application utilise alors le modèle standard et le mode guidé) :
supabase secrets set AI_PROVIDER="anthropic" AI_API_KEY="..." AI_MODEL="nom-du-modele"
#   AI_PROVIDER = anthropic | openai (API compatible chat/completions) ; AI_BASE_URL pour un autre point d'accès.
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` sont fournis automatiquement aux fonctions.

## 4. Déployer les Edge Functions

```bash
supabase functions deploy scheduled-chronicles maintenance generate-chronicle media-upload-init media-upload-finalize assistant delete-account
```
`scheduled-chronicles` et `maintenance` sont déclarées sans vérification de jeton de membre (`verify_jwt = false` dans `config.toml`) car le planificateur n'en a pas : elles exigent l'en-tête secret `x-cron-secret` (comparaison à temps constant). Les cinq autres exigent un jeton valide.

## 5. Tâches planifiées

Ouvrez `scripts/cron.sql`, remplacez `PROJECT_REF` et `CRON_SECRET` (même valeur qu'à l'étape 3), puis exécutez-le dans **SQL editor**. Il crée deux tâches `pg_cron` : chroniques/rappels toutes les 5 minutes, maintenance quotidienne. Ce n'est volontairement pas une migration (valeurs propres au projet). Vérifiez ensuite dans **Edge Functions > Logs** que `scheduled-chronicles` répond `200`.

## 6. Premier administrateur

1. Connectez-vous une fois à l'application (e-mail + pseudonyme).
2. Éditez l'adresse dans `scripts/bootstrap-admin.sql` et exécutez-le dans le SQL editor.
3. Un administrateur **n'a accès à aucune donnée privée** (bilans, objectifs, chroniques, conversations) : c'est testé. Il gère les rôles et la configuration.

## 7. Interface et GitHub Pages

1. Dépôt GitHub > **Settings > Pages** : Source = « GitHub Actions ».
2. **Settings > Secrets and variables > Actions > Variables** : `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` (la clé *anon*, publique par conception).
3. Poussez sur `main` : le workflow `deploy.yml` construit et publie. Le routage par `#` évite toute configuration serveur.
4. Adaptez la CSP dans `index.html` si vous utilisez un domaine Supabase personnalisé.

## 8. Contenus à fournir avant l'ouverture

- Les **trois documents juridiques** (règles de la communauté, confidentialité, limites de l'assistant) sont fournis en **modèles** dans la migration `0003_legal_documents_seed.sql` : faites-les relire par un juriste, puis publiez de nouvelles versions (`legal_documents`, `requires_reacceptance = true` pour imposer une nouvelle acceptation).
- Des **ressources** pour la bibliothèque (`resources`, avec la mention de droits obligatoire).
- Des **mots/expressions à surveiller** (`moderation_terms`) et des domaines de liens autorisés (`allowed_link_domains`), adaptés à votre public.

## 9. Lancer les tests chez vous

```bash
curl -fsSL https://bun.sh/install | bash   # une fois
npm install
npm test                 # 186 tests TypeScript
npm run test:sql         # nécessite PostgreSQL (initdb) ou TEST_DATABASE_URL=postgresql://…/une_base_test
                         # (finit par scripts/check_queries.py : cohérence requêtes du code ↔ schéma, si python3 est présent)
npm run typecheck
npm run typecheck:strict # vrais @types : corrigez les éventuelles erreurs de types
npm run build
```
`pdftotext` (paquet `poppler-utils`) rend le test PDF plus strict ; sans lui, ce test se contente de vérifier la génération.

## Dépannage rapide

| Symptôme | Cause probable |
|---|---|
| Le code n'arrive pas | SMTP non configuré, domaine non vérifié, ou modèle sans `{{ .Token }}` |
| « Code incorrect » alors qu'il est bon | Code expiré (10 min) ou nouveau code demandé entre-temps |
| Aucune chronique n'est créée | `pg_cron` non planifié, `CRON_SECRET` différent entre `cron.sql` et les secrets, ou chronique non activée dans les réglages |
| E-mails de chronique absents | `RESEND_API_KEY`/`EMAIL_FROM` manquants (rien n'est alors marqué « envoyé »), quota Resend gratuit (100/jour) atteint |
| Téléversement refusé | Type/extension incohérents, taille/quota dépassés, compte sous sanction, ou < 15 ans |

## Tickets d'aide (version serveur)

La migration `0010_support_tickets.sql` ajoute la permission `tickets.handle` aux rôles modérateur, modérateur senior et administrateur : ils voient la file dans **Modération → Tickets d'aide**. Les membres écrivent depuis **Aide → Mes tickets**. Aucune notification ni aucun e-mail n'est envoyé aujourd'hui (voir `docs/LIMITS.md`). Les limites se règlent dans `app_config` : `tickets.max_per_day` (5), `tickets.max_open` (10), `tickets.messages_per_day` (30).

## Connexion par e-mail et par SMS

**E-mail (déjà décrit plus haut)** : le modèle d'e-mail doit contenir `{{ .Token }}` (code à 6 chiffres, valable 10 minutes, un envoi par minute).

**SMS (facultatif, désactivé par défaut)** — à ne faire que si vous acceptez les coûts et les risques décrits dans `docs/LIMITS.md` :
1. Supabase > **Authentication > Providers > Phone** : activer, choisir un fournisseur (Twilio, MessageBird, Vonage…) et saisir ses identifiants. Message conseillé : `Ton code Tock Tock : {{ .Code }}. Ne le partage avec personne.` (rien d'autre que le code).
2. Chez le fournisseur : **limiter les pays autorisés** (anti-fraude au trafic SMS) et activer un captcha dans Supabase (Authentication > Attack Protection).
3. `supabase/config.toml` : section `[auth.sms]` (passer `enable_signup = true`) et `sms_sent` dans `[auth.rate_limit]`. Les noms de clés sont à **vérifier avec votre version du CLI** (`supabase --version`) : ils n'ont pas pu être exécutés ici.
4. Dans `.env` : `VITE_ENABLE_PHONE_LOGIN=true`, puis reconstruire le site. Sans cela l'onglet « Téléphone » n'apparaît pas dans la version serveur.
5. Tester avec **votre propre numéro** avant d'ouvrir au public (réception, délai, mauvais code, renvoi, limitation).

**Relier le fichier `Tock Tock.html` à votre serveur** (facultatif) :
```bash
TOCK_AUTH_URL=https://VOTRE-PROJET.supabase.co TOCK_AUTH_KEY=VOTRE_CLE_PUBLIQUE_ANON npm run build:local
```
Le script refuse une clé secrète. Le fichier obtenu ne contacte que ce serveur, uniquement pour envoyer et vérifier un code ; ses bilans restent sur l'appareil. Dans ce fichier, un compte ne sert qu'à confirmer l'identifiant (aucune synchronisation).

## Héberger

le dossier `a-publier/` du zip contient `index.html` (l'application complète, prête à l'emploi) et `.nojekyll`. Envoie ces deux fichiers **à la racine** de ton hébergeur statique (GitHub Pages en mode « Deploy from a branch », Netlify « Drop », Cloudflare Pages…). Rien à compiler, rien à configurer ; les données restent dans le navigateur de chaque personne.

- **À ne pas publier tel quel** : `source/index.html` est le code source, il doit être compilé (il affiche maintenant un message au lieu d'une page blanche).
- **GitHub Pages avec Actions** : `.github/workflows/deploy.yml` publie la version autonome quand les variables `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` ne sont pas renseignées, et la version serveur sinon. Étape non essayée sur GitHub même (seulement les commandes, en local).
- **Discussion en ligne** : un site statique ne peut pas faire passer de messages. Il faut un hébergeur qui exécute Node.js (dossier `discussion/`, commande `npm start`, `PORT` et HTTPS fournis par l'hébergeur). Non essayé sur un vrai hébergeur.

