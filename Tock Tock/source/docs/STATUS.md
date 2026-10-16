# État réel du projet — testé / non testé

Légende : ✅ **testé automatiquement** · 🟡 **écrit et vérifié statiquement (types, compilation, rendu), jamais exécuté de bout en bout** · ⚪ **non implémenté / à faire**

## Ce qui a été réellement exécuté lors de la livraison

| Vérification | Résultat |
|---|---|
| 10 migrations SQL appliquées sur **PostgreSQL 16 réel** | ✅ |
| 674 assertions SQL/RLS (8 suites, dont 53 pour les tickets d'aide et 4 pour les comptes créés par téléphone) + création de 200 comptes en parallèle (identifiants uniques) | ✅ tout passe |
| Cohérence code ↔ schéma (`scripts/check_queries.py`) : 114 requêtes du front et des Edge Functions comparées aux tables, colonnes, RPC et privilèges réellement migrés (outil heuristique, pas un type-checker complet) | ✅ tout passe |
| 186 tests TypeScript (Bun) : relais de discussion (usurpation, blocage, limites), logique de discussion, formats e-mail/téléphone/code, client d'authentification (faux `fetch`), règles et principes, sauvegarde PDF (aller-retour), rapport de période PDF, version locale, moyennes, planning/DST, chronique, PDF (relu avec `pdftotext`), fichiers, crise, IA (faux `fetch`), e-mail (faux `fetch`), service de chronique, rendu de l'interface | ✅ tout passe |
| **Handlers des 7 Edge Functions exécutés** avec un faux Supabase en mémoire, un faux `fetch` (Resend/IA) et une horloge simulée (26 scénarios : crise sans appel IA, consentements, mémoire, idempotence des e-mails, PDF joint, fichiers dangereux, suppression de compte…) | ✅ tout passe — mais sous Bun, avec des doubles de test |
| Vérification de types (interface + 7 Edge Functions) | ✅ — avec des **déclarations minimales** de React/Deno/Supabase (les vrais paquets n'étaient pas installables : le registre npm était bloqué dans l'environnement de production du projet) |
| Interface compilée (esbuild) et chargée dans **Chromium** avec un Supabase factice : écran de connexion → étape « code » | ✅ |

## Ce qui N'A PAS pu être exécuté (à faire dès l'installation)

- `npm install`, `vite build`, `tsc --noEmit` strict (vrais `@types/react`, `@supabase/supabase-js`) → des erreurs de types mineures contre les vrais paquets sont possibles.
- **Les Edge Functions n'ont jamais tourné sous Deno ni contre un vrai Supabase.** Leur code a été exécuté sous Bun avec un faux Supabase : le vrai PostgREST peut différer (syntaxe `.or()`, relations imbriquées `table(*)`, formats renvoyés par Storage/RPC), et la RLS n'y est pas simulée (elle est testée à part, sur PostgreSQL).
- Aucun test avec un **vrai projet Supabase** (Auth OTP, SMTP Resend, Storage, pg_cron/pg_net), ni avec un vrai fournisseur d'IA, ni avec un antivirus.
- Interface : pas de test de bout en bout en navigateur avec de vraies données (seuls le rendu initial et le flux de connexion factice ont été exécutés). Les écrans qui chargent des données (bilan, communauté, historique…) sont donc **non testés interactivement**.
- Le job CI `sql-tests` (PostgreSQL en service GitHub) et le workflow de déploiement n'ont jamais été lancés.

## Fonctionnalités par phase

### Phase A — comptes, profils, identifiants, règles, confidentialité
| Fonction | État | Preuve / remarque |
|---|---|---|
| Inscription/connexion par code e-mail (OTP) | 🟡 | Côté interface : `signInWithOtp` / `verifyOtp` ; le code est vérifié **par Supabase Auth**. Exige le SMTP personnalisé (docs/SETUP.md). |
| Règles/confidentialité/limites de l'assistant versionnées, acceptation obligatoire, ré-acceptation si version importante | ✅ SQL · 🟡 écran | `accept_rules`, `rules_ok` testés ; règle miroir côté interface testée. **Textes juridiques = modèles à faire relire** (docs/LIMITS.md). |
| Pseudonyme validé (réservés, usurpation, mots interdits, fréquence de changement) | ✅ SQL | |
| Identifiant public unique `user#00001` (séquence atomique, jamais réutilisé, s'allonge après 99 999) | ✅ | 200 créations concurrentes sans doublon ; des trous sont possibles (assumé). |
| Déclaration d'âge ; < 15 ans : communauté fermée | ✅ SQL | Déclaration non vérifiée (limite connue). |
| Visibilité du profil, avatars prédéfinis, blocage/sourdine | ✅ SQL | Pas de téléversement d'avatar (prévu en phase ultérieure). |
| Export des données, désactivation/réactivation, suppression du compte | ✅ export/désactivation SQL · ✅ suppression (fonction exécutée avec faux Supabase) · 🟡 réel | |
| Rôles du personnel sans accès aux données privées | ✅ | Tests : modérateur, modérateur senior, admin ne lisent rien de privé. |

### Phase B — bilans, objectifs, moyennes, chroniques
| Fonction | État | Remarque |
|---|---|---|
| 20 indicateurs par défaut en 5 catégories, personnalisables, instantané figé dans chaque réponse | ✅ SQL | |
| Douleur séparée (hors moyennes), réglage « suivre la douleur » | ✅ SQL · ✅ calcul · 🟡 écran | |
| Moyennes exactes (vide ≠ 0 ; moyenne des moyennes de catégories ; « Moyenne indisponible ») | ✅ | docs/STATS.md |
| Historique, graphiques (trous ≠ zéro), regroupements jour/semaine/mois, périodes | ✅ calculs et graphique · 🟡 écran | |
| Objectifs, étapes, journal, partage titre seul | ✅ SQL · 🟡 écran | |
| Chronique de minuit (gabarit) sans invention de faits ; données insuffisantes → message honnête | ✅ | |
| Chronique par IA (consentement + clé requis ; sortie validée ; repli sur le gabarit) | ✅ logique avec faux fournisseur · ⚪ jamais appelée sur un vrai modèle | Désactivée par défaut. |
| Modifier / régénérer / supprimer / copier une chronique | 🟡 | |
| PDF (accents, pagination, exclusion de la douleur/notes si non autorisées) | ✅ | |
| Envoi planifié (fuseaux, heure d'été/hiver, rattrapage 36 h, idempotence, 3 essais) | ✅ planning, réservation SQL et fonction (faux Supabase) · 🟡 réel | |
| Envoi par e-mail via Resend | ✅ requête, échecs 429/5xx, idempotence (faux `fetch`) · 🟡 jamais envoyé pour de vrai | Sans clé configurée, rien n'est marqué « envoyé » (testé). |

### Phase C — communauté
| Fonction | État |
|---|---|
| Publications (types, catégories), commentaires, réactions positives anonymes agrégées, favoris, recherche | ✅ SQL · 🟡 écran |
| Aucun classement ni compteur de popularité | ✅ (pas de tri par réactions ; totaux sans noms) |
| Signalements (motifs fixes, regroupement des signalements sur un même contenu), blocage, traitement par les modérateurs, contestation | ✅ SQL · 🟡 écrans |
| Filtre de texte (accents/leet/répétitions, liens, mineurs plus stricts), pré-modération, limites de débit | ✅ SQL — **filtre volontairement minimal** (LIMITS) |

### Phase D — médias et modération
| Fonction | État |
|---|---|
| Types réels par octets magiques ; refus exécutables/SVG/HTML/polyglottes/PDF actifs ; extension/MIME incohérents | ✅ |
| Renommage serveur, buckets privés séparés, quarantaine, quotas, limites de taille et de durée | ✅ règles TS + SQL + fonctions (faux Supabase) · 🟡 réel |
| Aucune approbation automatique ; relecture humaine ; accès lecture par politiques de stockage | ✅ SQL (politiques) |
| Antivirus / modération d'image automatique | ⚪ **non implémenté** (point d'extension `scanFile`) |
| Durée audio/vidéo | Déclarée par le client, **non vérifiée** (LIMITS) |

### Phase E — assistant, bibliothèque, notifications
| Fonction | État |
|---|---|
| Détection de détresse/crise → message fixe + ressources (FR, BE, CH, CA, US), avant tout appel de modèle | ✅ |
| Accès aux données seulement selon consentements ; mémoire désactivée par défaut | ✅ contexte et fonction (faux Supabase/IA) |
| Mode guidé sans IA (FAQ) | ✅ |
| Réponses d'un vrai modèle | ⚪ non testées sur un fournisseur réel |
| Bibliothèque (ressources officielles/externes avec droits, parcours, progression, favoris) | ✅ SQL · 🟡 écran |
| Notifications (références uniquement, jamais de contenu de bien-être) | ✅ SQL · 🟡 écran |

### Phase F — sécurité et déploiement
| Fonction | État |
|---|---|
| RLS sur 100 % des tables ; `anon` sans droit ; liste blanche exacte des RPC publiques ; `search_path` fixé ; buckets non publics | ✅ test de catalogue |
| Tests d'abus : limites de débit, accès croisés entre membres, contournements de droits (voir `supabase/tests/sql/`) | ✅ SQL |
| CI (types, tests TS, tests SQL, build) et déploiement GitHub Pages | 🟡 écrits, jamais lancés |
| Connexion / inscription par code **e-mail** (serveur : Supabase Auth, composant `OtpFlow` partagé) | 🟡 écrit, format et parcours testés (tests TS, rendu, Chromium contre un **FAUX** serveur d'authentification) ; **jamais exécuté contre un vrai Supabase ni un vrai envoi d'e-mail** |
| Connexion / inscription par code **SMS** (désactivée par défaut : `VITE_ENABLE_PHONE_LOGIN`, `[auth.sms]`) | 🟡 écrit et testé de la même façon ; **aucun fournisseur de SMS n'a été configuré ni essayé** ; clés `config.toml` à vérifier avec votre CLI |
| Comptes créés par téléphone sans e-mail (profil créé, aucune donnée exposée) | ✅ 4 assertions SQL ; ⚪ chronique par e-mail indisponible pour ces comptes (grisée dans les Réglages) |
| **Discussion sans compte** (nom#, clé secrète d'appareil, relais Node `chat/`) : messages, demande et partage de bilan avec accord à chaque fois, blocage, reconnexion après redémarrage du relais | ✅ testé de bout en bout : vrai relais + 2 navigateurs Chromium (10 tests unitaires du relais + parcours complet) ; ⚪ jamais essayé sur Internet, à plus de 2 personnes, ni sur téléphone |
| **Page d'accueil**, 9 exercices guidés, suivi des exercices | ✅ testés (unitaires + navigateur) ; contenu des exercices non relu par un professionnel de santé |
| Rappels / alertes par **SMS** (hors connexion) | ⚪ étudié seulement, non implémenté (docs/LIMITS.md) |

## Version locale « Tock Tock.html » (un seul fichier)

| Élément | État |
|---|---|
| Parcours complet testé dans Chromium depuis `file://` (accueil et règles, bilan, enregistrement, historique, calendrier, observations, chroniques automatiques, PDF, objectifs, respiration, assistant avec détection de détresse, réglages, PIN, sauvegarde, CSV, thème sombre), sans erreur console | ✅ |
| Logique pure (séries de jours, corrélation, chroniques de rattrapage, CSV, indicateurs par défaut) | ✅ tests dans `tests/local.test.ts` |
| Stockage dans le navigateur uniquement (aucune requête réseau : CSP `connect-src 'none'`) | ✅ vérifié par la politique de la page |
| Code PIN | 🟡 masque l'écran à l'ouverture ; **ne chiffre pas** les données |
| Compatibilité Safari / Firefox / mobiles | ⚪ non testée (Chromium seulement) |
| Rappels / notifications | ⚪ non implémentés (pas de serveur) |
| Comptes, communauté, médias, e-mails, IA | ⚪ absents de cette version (voir version Supabase) |

### Ajouts de la dernière itération

| Élément | État |
|---|---|
| **Sauvegarde PDF** (lisible + données exactes jointes ; restauration depuis le PDF ; ancien JSON toujours accepté ; code PIN jamais exporté) | ✅ aller-retour testé (Bun) et dans Chromium (téléchargement, restauration, refus d'un faux PDF) |
| **Règles expliquées** (7 sections, chaque règle avec son « pourquoi ») + acceptation versionnée bloquante quand la version change + export des données possible sans accepter | ✅ testé dans Chromium |
| **Centre d'aide local** : écoute par pays, FAQ avec recherche, tickets (PDF, copie, e-mail préparé), diagnostic sans données personnelles, détection de détresse dans les tickets | ✅ testé dans Chromium. Un ticket local n'est **pas envoyé** : il est exporté puis transmis par la personne |
| Brouillon automatique du bilan, bilan rapide (5 questions), recherche dans les notes, rappel de sauvegarde après 14 jours | ✅ testé dans Chromium |
| **Tickets côté serveur** (migration 0010) : tables, RLS, 5 RPC, file du personnel (vues), notes internes, priorité relevée en cas de détresse, limites, informations techniques filtrées par liste blanche | ✅ 53 assertions SQL sur PostgreSQL 16 réel |
| Pages React des tickets serveur (`Support`, `StaffTickets`) | 🟡 vérifiées par le typage et par `check_queries.py` ; **jamais affichées** contre un vrai Supabase |
| Notification du membre quand le support répond, e-mail au support à la création d'un ticket, délais de réponse (SLA) | ⚪ non implémentés |
