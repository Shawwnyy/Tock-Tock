# Sécurité et confidentialité — ce qui est en place, et comment le vérifier

## Modèle
- **Frontière de confiance = la base.** Les règles sont dans PostgreSQL (RLS, contraintes, déclencheurs, fonctions), pas dans l'interface. Les Edge Functions n'ajoutent que ce qui exige un secret ou un service externe.
- **Aucune clé secrète dans l'interface.** L'interface ne connaît que l'URL et la clé *anon* (publique). `service_role`, Resend, IA : secrets Supabase des fonctions uniquement. CORS restreint à `ALLOWED_ORIGINS` ; CSP dans `index.html`.
- **Aucun code de vérification inventé côté interface** : Supabase Auth émet et vérifie le code.

## Données privées
- Tables privées (bilans, réponses, objectifs, étapes, journal, chroniques, livraisons, indicateurs, réglages, conversations) : une politique « propriétaire uniquement », et **aucune** politique pour le personnel. Test de catalogue : aucune politique d'une table privée ne référence `has_permission`.
- Buckets **tous privés** (test) ; `chronicles` et `private-documents` : lecture limitée au dossier du propriétaire ; `temp-uploads` et `quarantine` : aucun accès client ; `community-media` : politique `can_read_media_object` (propriétaire, relecteur habilité pour ce qui est en attente, membre autorisé pour ce qui est approuvé et visible).
- Notifications et e-mails « notification » : **références seulement**, jamais de score, d'humeur, de douleur ni d'extrait de chronique. L'e-mail « PDF » est un choix explicite (non chiffré de bout en bout, dit à la personne).
- Export complet des données (`export_my_data`), désactivation, suppression (fichiers puis compte).

## Durcissement SQL
- RLS activée sur 100 % des tables du schéma `public` (test) ; `anon` n'a aucun droit sur les tables, vues ni séquences (test).
- Fonctions `SECURITY DEFINER` : `search_path` fixé (test) ; schéma `private` non exposé et inaccessible à `anon` (test) ; **liste blanche exacte** des RPC publiques (test) ; fonctions serveur (quotas, livraisons, notifications) **non exécutables** par les membres (test).
- Privilèges minimaux : `REVOKE` puis `GRANT` par colonne (un membre ne peut pas modifier `user_id`, instantanés, statuts de modération…).
- La colonne `moderation` des publications et commentaires (résultat du filtrage automatique, dont l'indicateur « la personne semble en détresse ») n'est lisible par aucun membre : `SELECT *` est donc volontairement refusé sur `posts` et `comments` (colonnes explicites obligatoires, testé).
- Politiques « ouvertes » (`using true`) : liste blanche explicite (test).
- Journal de modération **en ajout seul** ; chaque décision exige une explication ; un modérateur ne peut pas relire son propre fichier.
- Identifiants publics par séquence (pas de recherche par numéro, recherche de membres par préfixe ≥ 3 caractères, 20 résultats max.).

## Abus
- Limites de débit en base (publications, commentaires, signalements) et dans les fonctions (téléversements) ; quotas de stockage ; compteurs d'usage pour l'IA et l'assistant ; réservation atomique des envois (jamais deux e-mails identiques).
- Filtre de texte (normalisation accents/leet/répétitions, liens à liste blanche, raccourcisseurs refusés) ; mineurs : seuil plus strict, pré-modération ; détresse : message de soutien, jamais bloqué.
- Fichiers : type réel par octets magiques, refus des exécutables/archives/SVG/HTML, détection de polyglottes et de PDF actifs, renommage serveur, quarantaine, relecture humaine obligatoire.

## À faire par l'exploitant (non automatisable)
- Activer un CAPTCHA, surveiller les journaux, sauvegardes (plan payant : sauvegardes quotidiennes ; gratuit : exporter régulièrement).
- Faire valider les textes juridiques, la politique de conservation et le registre RGPD.
- Brancher un antivirus / une modération d'images si vous ouvrez le partage de médias au grand public.
- Relire le code des Edge Functions avant production : elles n'ont **pas** été exécutées sous Deno (voir STATUS).
- **Tickets d'aide** : un membre ne lit que ses tickets et les réponses publiques (jamais les notes internes, l'auteur des réponses, l'indicateur de détresse ni l'assignation : droits par colonne). Le personnel passe par des vues et des RPC, voit le pseudonyme (pas l'identifiant), et n'a aucun accès aux bilans, objectifs, chroniques ou conversations. Informations techniques jointes : liste blanche de clés. Limites : 5 tickets/jour, 10 ouverts, 30 messages/jour. Chaque changement de statut est tracé en note interne. Tout cela est testé (suite `70_support_tickets.sql`).

## Connexion par code (e-mail ou SMS)
- **Le code n'est jamais vu par l'interface** : il est envoyé et vérifié par Supabase Auth. Aucun code n'est généré, comparé, affiché ni simulé côté navigateur (`src/components/OtpFlow.tsx`, `src/pages/Login.tsx`).
- **Limites** : un envoi par minute (`max_frequency`), plafonds `email_sent` / `sms_sent` / `token_verifications` dans `supabase/config.toml`. Le verrou « 5 essais par code » de l'écran est une **aide à l'utilisateur, pas une protection** : seule la limite du serveur compte.
- **Pas d'énumération de comptes** : les messages sont identiques que le compte existe ou non (« Si l'adresse est correcte, un code vient de partir »).
- **Version fichier reliée à un serveur** : le fichier n'embarque que la clé **publique** (le script de fabrication refuse une clé `service_role` ou `sb_secret_`), la CSP n'autorise que ce seul serveur, le jeton de session renvoyé est ignoré et jamais stocké ; seule la forme masquée de l'identifiant est conservée.
- **Comptes sans e-mail** (SMS seul) : aucune colonne e-mail/téléphone n'est exposée par les tables publiques (test SQL) ; la chronique par e-mail est indisponible pour eux.

## Discussion sans compte (relais `chat/`)
- **Identité** : un numéro à 5 chiffres tiré au hasard + une clé secrète de 192 bits gardée sur l'appareil. Le relais retient l'empreinte SHA-256 de la **première** clé vue pour un numéro ; toute autre clé est refusée (409 à l'annonce, 403 ensuite). La clé n'est **jamais** dans la sauvegarde PDF.
- **Pas d'énumération** : un destinataire inexistant et un nom qui ne correspond pas renvoient exactement la même réponse. Le nom ET le numéro doivent correspondre (seconde vérification faible : les noms sont devinables).
- **Aucune donnée au repos** : le relais ne garde que des messages en mémoire (24 h au plus, effacés à la réception, perdus au redémarrage).
- **Bilan** : seulement après accord à chaque demande ; moyennes uniquement, douleur et note si cochées ; la donnée reçue est traitée comme **non fiable** (bornes, types, tailles) et rendue en texte, jamais en HTML.
- **Limites de débit** : 30 messages/minute, 10 demandes de bilan/heure, 20 annonces/heure, 1000 caractères, 20 Ko de bilan, 500 messages en attente.
- **À savoir** : HTTP simple (pas de TLS) et pas de chiffrement de bout en bout ; un numéro à 5 chiffres se devine (100 000 possibilités) : les protections réelles sont le nom, l'accord à chaque demande, le blocage et l'absence d'annuaire. Pas de modération humaine.
