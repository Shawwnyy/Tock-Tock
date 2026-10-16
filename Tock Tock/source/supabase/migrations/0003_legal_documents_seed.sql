-- ============================================================================
-- Tock Tock — 0003 : textes légaux initiaux (version 1.0.0)
-- ⚠ Textes de travail rédigés pour le projet : à faire relire par un juriste (RGPD, mineurs,
--   mentions légales) et à compléter avec les informations de l'éditeur avant ouverture au public.
-- Pour publier une nouvelle version : INSERT d'une ligne avec une nouvelle `version`
-- (requires_reacceptance = true => tous les membres devront réaccepter).
-- ============================================================================

insert into public.legal_documents (kind, version, title, body_md, requires_reacceptance) values
('community_rules', '1.0.0', 'Bienvenue sur Tock Tock : nos règles pour une communauté bienveillante',
$md$
## Pourquoi ces règles ?

Tock Tock est un espace pour **avancer à son rythme, partager sans être jugé et garder une trace de son chemin**.
Pour que chacun s'y sente en sécurité, y compris les plus jeunes, voici ce que nous attendons de tous les membres.

## Ce que nous encourageons

- Partager une expérience, un conseil, une petite victoire, une question.
- Encourager les autres, sans comparaison ni compétition.
- Exprimer un désaccord **de façon respectueuse** : la critique argumentée et le débat sont les bienvenus.
- Demander de l'aide : parler d'un sujet difficile pour chercher du soutien n'est jamais sanctionné.

## Ce qui est interdit

- Les insultes et les attaques personnelles.
- Le harcèlement, l'intimidation et les menaces.
- Les propos discriminatoires.
- La divulgation d'informations personnelles sans consentement (adresse, numéro de téléphone, e-mail, établissement scolaire…).
- La publication de photos intimes ou de contenus sexuels explicites.
- Les contenus violents ou choquants.
- Les contenus dangereux ou qui encouragent des actes dangereux.
- L'usurpation d'identité.
- Le spam, les escroqueries et les tentatives d'hameçonnage (phishing).
- Les liens malveillants.
- Le partage de contenus protégés sans autorisation.
- Les messages destinés à humilier ou à manipuler les autres.
- Les comportements visant à contourner la modération.

## Protection des plus jeunes

Tock Tock accueille des personnes mineures. Il est interdit de demander à un membre ses coordonnées privées
(numéro, réseaux sociaux, adresse), de lui proposer un échange privé hors de l'application ou de lui adresser
des sollicitations à caractère sexuel. Il n'existe pas de messagerie privée ouverte à tous.
**Si un échange vous met mal à l'aise, signalez-le et bloquez le compte : vous n'avez rien à justifier.**

## Signaler, bloquer, contester

- Chaque publication, commentaire, média et profil peut être **signalé**. Votre identité n'est jamais révélée à la personne signalée.
- Vous pouvez **bloquer** un membre à tout moment : vous ne vous verrez plus mutuellement.
- Les contenus signalés ou détectés comme risqués peuvent être **mis en attente** puis examinés par une personne de l'équipe.
  La modération automatique est un filet de sécurité imparfait : elle ne détecte pas tout et peut se tromper.
- Les mesures sont **proportionnées, expliquées et traçables** : avertissement, masquage temporaire d'une publication,
  limitation temporaire des interactions, suspension, et bannissement en cas de violations graves ou répétées.
- Vous pouvez **contester** toute décision depuis votre espace « Mon compte ».

## Vos données personnelles

Vos bilans, objectifs, notes et chroniques sont **privés par défaut**. Rien n'est publié dans la communauté sans
une action explicite de votre part. Il n'existe aucun classement des membres selon leur moral, leur douleur ou leurs notes.
$md$, true),

('privacy_policy', '1.0.0', 'Politique de confidentialité (résumé)',
$md$
## Qui est responsable de vos données ?

[À COMPLÉTER PAR L'ÉDITEUR : identité, adresse, contact, délégué à la protection des données le cas échéant.]

## Quelles données, pourquoi ?

| Donnée | Finalité | Visibilité |
|---|---|---|
| Adresse e-mail | Connexion par code, envoi des chroniques si vous l'activez | Jamais publique |
| Pseudonyme, avatar, identifiant `user#00000` | Vous identifier dans la communauté | Visibles par les membres |
| Bilans, notes, douleur, événements | Votre suivi personnel | **Privés** (vous seul) |
| Objectifs | Votre suivi personnel | Privés, sauf ceux que vous choisissez de montrer |
| Chroniques de minuit et PDF | Votre historique | **Privées** (vous seul) |
| Publications, commentaires, médias | Échanges communautaires | Selon votre choix de publication |
| Signalements, sanctions | Sécurité de la communauté | Équipe de modération habilitée |
| Conversations avec l'assistant | Vous aider | Privées ; conservées seulement si vous activez la mémoire |

## Vos droits

Vous pouvez à tout moment **télécharger vos données**, **supprimer vos publications**, **supprimer votre compte**
(effacement de vos données personnelles, les traces de modération pouvant être conservées sous forme anonymisée),
gérer vos notifications et retirer vos consentements.

## Services tiers

Les données sont hébergées chez Supabase (base de données et fichiers). Les e-mails sont envoyés via un prestataire d'envoi.
**Aucune donnée personnelle n'est envoyée à un fournisseur d'intelligence artificielle sans votre consentement explicite**
(réglage désactivé par défaut). L'équipe de modération n'a pas accès à vos bilans, objectifs, chroniques ou conversations privés.

## Âge

L'adresse e-mail prouve que vous avez accès à une boîte de réception : elle ne prouve ni votre identité ni votre âge.
L'âge est déclaré par vous. Les personnes de moins de 15 ans ont un accès restreint à l'espace personnel
et n'ont pas accès à la communauté, dans l'attente d'un dispositif de consentement parental.

[À COMPLÉTER : durées de conservation, hébergeur, transferts hors UE, coordonnées pour exercer vos droits, autorité de contrôle (CNIL).]
$md$, true),

('chatbot_limits', '1.0.0', 'Les limites de « Tock Tock Assistant »',
$md$
## Ce que l'assistant peut faire

Vous aider à comprendre votre bilan, réfléchir à vos objectifs, organiser vos journées, repérer vos réussites,
mettre des mots sur ce que vous ressentez, préparer une chronique ou une liste de petites étapes pour demain.

## Ce qu'il ne fait pas

- C'est **un programme informatique**, pas une personne.
- Il **ne pose aucun diagnostic**, médical ou psychologique, et ne remplace pas un professionnel de santé.
- Il ne peut **garantir aucun résultat** et peut se tromper : gardez votre esprit critique.
- Il **n'invente rien sur vous** : il n'utilise que ce que vous lui donnez ou autorisez.
- Il ne **surveille pas** vos conversations en permanence et **n'alerte personne** à votre place.

## Vos données

- Par défaut, l'assistant n'a **aucun accès** à vos bilans, objectifs ou chroniques. Vous pouvez l'autoriser, catégorie par catégorie, et le retirer à tout moment.
- Par défaut, la conversation **n'est pas conservée** (mémoire désactivée). Vous pouvez effacer l'historique quand vous le souhaitez.
- Le mode « guidé » fonctionne sans fournisseur d'IA externe. Le mode « IA » n'envoie vos messages à un fournisseur externe qu'avec votre **consentement explicite**.
- Vos confidences ne sont **jamais utilisées à des fins publicitaires** ni pour personnaliser des contenus publics.

## En cas de détresse

Si vous êtes en danger immédiat ou en grande détresse, contactez une personne de confiance ou un service d'urgence.
En France : **112** (urgences), **3114** (prévention du suicide, 24 h/24), **119** (enfance en danger), **3018** (cyberharcèlement).
$md$, true);
