# Limites connues, points juridiques, étude SMS

## Limites techniques assumées
1. **Non exécuté de bout en bout** : Edge Functions (Deno), vrai Supabase Auth/SMTP/Storage/pg_cron, vrai fournisseur d'IA, build Vite, écrans interactifs dans un navigateur avec de vraies données (voir STATUS).
2. **Filtre de texte minimal** : mots-clés/expressions + liens ; il ne comprend pas le contexte (ironie, langues autres que le français, nouvelles formes d'évitement). Il aide la modération humaine, il ne la remplace pas. Risque de **faux positifs** (messages mis en relecture) et de **brigading** (signalements concertés qui masquent automatiquement un contenu).
3. **Détection de détresse par mots-clés** (français) : des faux négatifs existent. Ce n'est pas un outil clinique ; le message de soutien est fixe et renvoie vers des aides humaines.
4. **Âge déclaratif** : non vérifié. Les moins de 15 ans n'ont pas accès à la communauté ni aux fichiers (aucun mécanisme de consentement parental n'est implémenté).
5. **Durée audio/vidéo déclarée par le client**, non vérifiée (aucun décodeur multimédia côté serveur). Les limites de taille, elles, sont vérifiées sur les octets reçus.
6. **Pas d'antivirus ni de modération d'images automatique** : tout fichier valide passe en relecture humaine ; la charge de modération croît avec les téléversements.
7. **Identifiants `user#00001` séquentiels** : leur énumération est limitée (recherche par préfixe de pseudonyme ≥ 3 caractères, pas de liste de membres) mais pas impossible.
8. **Suppression de compte** : confirmation par saisie, sans ré-authentification récente.
9. **Chronique hebdomadaire/mensuelle** : non implémentée (chronique quotidienne uniquement). **Avatars** : prédéfinis seulement. **Visibilité « contacts »** : réservée, désactivée. **Anglais** : le champ de langue existe, l'interface est en français uniquement.
10. **Rattrapage des chroniques limité à 36 h** après une panne du planificateur ; au-delà, la chronique du jour manquant n'est pas créée automatiquement (elle peut l'être à la demande).
11. **Tests de charge** : non réalisés.
12. L'e-mail « PDF » transite par un service tiers non chiffré de bout en bout.
13. **Sauvegarde PDF** : non chiffrée (elle contient toutes les données, douleur comprise). La restauration exige le PDF d'origine : un PDF réimprimé, converti ou retouché perd les données jointes. Tous les lecteurs PDF ne montrent pas les pièces jointes, mais le contenu lisible reste affiché.
14. **Tickets locaux** : enregistrés sur l'appareil, jamais envoyés automatiquement ; aucun délai de réponse n'est promis. **Tickets serveur** : pas de notification au membre ni au support (à ajouter), pas de pièces jointes, pas de délai garanti.
15. **Version locale** : pas de synchronisation entre appareils, pas de rappels (aucun serveur), le code PIN ne chiffre pas, compatibilité testée sur Chromium uniquement.
16. Les publications et commentaires ne laissent plus lire la colonne `moderation` aux membres (indicateur de détresse), mais le texte lui-même d'une publication reste lisible par tous ceux qui y ont accès : rien n'est privé dans la communauté.

## Points juridiques à faire valider (ce projet n'est pas un avis juridique)
- **RGPD** : données de santé/bien-être = catégories sensibles ; base légale (consentement explicite), information, durées de conservation, registre des traitements, sous-traitants (Supabase, Resend, fournisseur d'IA) et transferts hors UE, droits d'accès/effacement (fournis), analyse d'impact probable.
- **Mineurs** : seuil de consentement numérique (15 ans en France), consentement parental, protection renforcée ; les mécanismes ici sont techniques, pas juridiques.
- **Hébergeur / éditeur** : mentions légales, contact, procédure de notification des contenus illicites (LCEN / DSA), politique de modération transparente.
- **Dispositif médical** : l'application ne diagnostique pas et le dit ; vérifiez la qualification de vos fonctionnalités si vous évoluez vers du suivi médical.
- **Droits d'auteur** des ressources et des médias partagés (attestation de droits exigée dans le code ; reste à encadrer contractuellement).
- Les trois textes fournis dans `0003_legal_documents_seed.sql` sont des **modèles de travail**.

## SMS : connexion par code (écrite, non testée en réel) et rappels (non implémentés)
- **Connexion par code SMS** : l'interface (format du numéro, saisie du code, limites d'essais) et la configuration Supabase sont écrites ; elle est **désactivée par défaut** et n'a **jamais été exécutée avec un vrai fournisseur**. Le code est toujours envoyé et vérifié par Supabase Auth : l'application ne le génère ni ne le simule.
- **Risques propres au SMS** (à connaître avant d'activer) : (1) **fraude au trafic SMS** (des robots demandent des codes vers des numéros surtaxés : activez un captcha, limitez les pays autorisés chez le fournisseur et plafonnez `sms_sent`) ; (2) **recyclage des numéros** : un numéro résilié puis réattribué peut ouvrir le compte de l'ancien titulaire ; (3) **échange de carte SIM** ; (4) **coût** à l'unité et délais d'acheminement variables ; (5) un SMS s'affiche sur l'écran verrouillé (il ne contient donc que le code). L'e-mail reste le moyen le plus sûr à proposer en premier.
- **Numéros** : le format est vérifié (mobile français 06/07 ou format international `+indicatif`) mais **l'existence du numéro n'est pas vérifiable** côté interface. Les numéros mobiles d'outre-mer (0690, 0694, 0696…) doivent être saisis avec leur indicatif (`+590`, `+594`, `+596`…).
- **Message d'erreur et énumération** : l'écran ne dit jamais si un compte existe déjà, mais les limites de débit et la réponse du serveur peuvent encore révéler des informations ; à contrôler lors de la mise en production.

## Étude SMS pour les rappels (non implémentée, volontairement)
- **Usage envisagé** : rappels de bilan ou alertes par SMS. **Non fourni** : il imposerait la collecte du numéro de téléphone (donnée personnelle de plus), une vérification par code (à ne **jamais** simuler côté interface), un fournisseur (Twilio, Vonage, OVH…), la gestion du consentement/désinscription (STOP), des coûts à l'unité et des règles d'expéditeur par pays.
- **Recommandation** : rester sur l'e-mail et les notifications dans l'application ; si le SMS devient nécessaire, utiliser les « fournisseurs téléphone » de Supabase Auth (vérification) et une Edge Function dédiée avec quotas stricts, journal d'envoi et désinscription, en n'envoyant **jamais** de donnée de bien-être par SMS (références seulement, comme pour les notifications).

## Discussion sans compte (relais `chat/`) : limites connues
- **Pas de chiffrement de bout en bout** et **pas de HTTPS** par défaut : à n'utiliser qu'entre personnes de confiance sur un réseau de confiance. Celui qui héberge le relais peut lire les messages en transit.
- **Pas de modération humaine** ni de signalement : seuls existent le blocage et l'absence d'annuaire.
- **Âge déclaratif** (15 ans et plus), non vérifié.
- **Perte de la clé** (données du navigateur effacées) = nouveau numéro ; l'ancien reste « pris » jusqu'au redémarrage du relais.
- **Disponibilité** : si le relais est éteint, rien ne part (l'écran l'indique). Un message n'est livré que si la personne ouvre l'application (relève toutes les 3 s) ; pas d'accusé de lecture.
- **Usage sur Internet non testé** : le relais n'a été essayé qu'en local (2 navigateurs). Avant de l'exposer, ajoutez HTTPS (proxy inverse) et surveillez les ressources.
